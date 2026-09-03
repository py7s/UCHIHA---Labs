'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const SETTINGS_FILE = () => path.join(app.getPath('userData'), 'launcher-settings.json');
// The backend is hosted on Render.com. There is no local-only
// fallback — every install talks to the same public instance.
const DEFAULT_API = 'https://uchiha-backend-d1n7.onrender.com';

function loadSettings() {
    try {
        if (fs.existsSync(SETTINGS_FILE())) {
            const raw = JSON.parse(fs.readFileSync(SETTINGS_FILE(), 'utf8'));
            // Reset any old localhost setting that previous versions
            // of the launcher used. We only ever talk to Render.
            if (raw.apiBase && /^https?:\/\/(localhost|127\.0\.0\.1)/i.test(raw.apiBase)) {
                raw.apiBase = DEFAULT_API;
            }
            return raw;
        }
    } catch (e) {}
    return { apiBase: DEFAULT_API, token: null, user: null };
}

// Probe the backend. Returns a promise that resolves true if the
// /health endpoint responds with { ok: true } within `ms`
// milliseconds, false otherwise. Never throws.
function probeBackend(base, ms) {
    return new Promise(resolve => {
        const url = String(base || '').replace(/\/+$/, '') + '/health';
        let done = false;
        const finish = (ok) => { if (!done) { done = true; resolve(ok); } };
        const timer = setTimeout(() => finish(false), ms || 3000);
        try {
            const lib = url.startsWith('https') ? require('https') : require('http');
            const u = new URL(url);
            const opts = { hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80), path: u.pathname, method: 'GET', timeout: ms || 3000, headers: { 'User-Agent': 'uchiha-launcher' } };
            const r = lib.request(opts, res => {
                let data = '';
                res.on('data', c => data += c);
                res.on('end', () => {
                    clearTimeout(timer);
                    try {
                        const j = JSON.parse(data);
                        finish(res.statusCode >= 200 && res.statusCode < 300 && j && j.ok === true);
                    } catch (e) { finish(false); }
                });
            });
            r.on('error', () => { clearTimeout(timer); finish(false); });
            r.on('timeout', () => { try { r.destroy(); } catch (e) {} clearTimeout(timer); finish(false); });
            r.end();
        } catch (e) {
            clearTimeout(timer);
            finish(false);
        }
    });
}

// Verify the configured backend is reachable at startup. If the
// saved URL is different from the default, we still prefer it
// (the user explicitly set it) but only after it answers /health.
async function resolveApiBase() {
    const candidates = [];
    if (settings.apiBase && settings.apiBase !== DEFAULT_API) candidates.push(settings.apiBase);
    candidates.push(DEFAULT_API);
    for (const c of candidates) {
        if (await probeBackend(c, 2500)) {
            settings.apiBase = c;
            saveSettings(settings);
            return c;
        }
    }
    // Nothing answered; keep what we have and let the in-app
    // "Backend" button surface the error to the user.
    return settings.apiBase || DEFAULT_API;
}

function saveSettings(s) {
    try {
        fs.mkdirSync(path.dirname(SETTINGS_FILE()), { recursive: true });
        fs.writeFileSync(SETTINGS_FILE(), JSON.stringify(s, null, 2));
    } catch (e) {
        console.error('[settings save]', e);
    }
}

let settings = loadSettings();
let mainWindow = null;

function resolveIndexHtml() {
    const candidates = [
        // Dev: sibling project root (one level up from launcher-build, in repo root)
        path.resolve(__dirname, '..', 'index.html'),
        // Production: extraResources copies Launcher/ folder to resources/site/
        path.join(process.resourcesPath || '', 'site', 'index.html'),
        // Production fallback: some packagers copy into resources/app
        path.join(process.resourcesPath || '', 'app', 'site', 'index.html'),
    ];
    for (const p of candidates) {
        if (p && fs.existsSync(p)) return p;
    }
    return null;
}

function resolveIcon() {
    const candidates = [
        path.join(__dirname, 'icon.ico'),
        path.join(__dirname, 'icon.png'),
        path.join(process.resourcesPath || '', 'site', 'images', 'main', 'r_l_logo_1.webp'),
    ];
    for (const p of candidates) {
        if (p && fs.existsSync(p)) return p;
    }
    return null;
}

function createWindow() {
    const indexPath = resolveIndexHtml();
    if (!indexPath) {
        dialog.showErrorBox(
            'UCHIHA Launcher - missing website',
            'Could not find index.html in the expected locations.\n\n' +
            'Please reinstall the application or contact support.'
        );
        app.quit();
        return;
    }

    const startUrl = pathToFileURL(indexPath).toString();
    const iconPath = resolveIcon();

    mainWindow = new BrowserWindow({
        width: 1280,
        height: 820,
        minWidth: 1024,
        minHeight: 700,
        backgroundColor: '#0a0a0a',
        title: 'UCHIHA Labs Launcher',
        autoHideMenuBar: true,
        icon: iconPath || undefined,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false,
            webSecurity: true,
        },
    });

    Menu.setApplicationMenu(null);

    // Disable video hardware acceleration that may crash on some Windows
    // setups with the stub ffmpeg.dll (which is missing proprietary codecs).
    // The site uses <video> for the nameplate background only; falling back
    // to software decoding is fine.
    try {
        mainWindow.webContents.on('console-message', (e, level, msg) => {
            // Suppress noisy ffmpeg errors in the dev console.
            if (typeof msg === 'string' && (msg.indexOf('ffmpeg') >= 0 || msg.indexOf('Decoder') >= 0)) {
                e.preventDefault && e.preventDefault();
            }
        });
        mainWindow.webContents.on('render-process-gone', (event, details) => {
            console.error('[renderer gone]', details);
        });
    } catch (e) {}

    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        try { shell.openExternal(url); } catch (e) {}
        return { action: 'deny' };
    });

    mainWindow.webContents.on('will-navigate', (event, url) => {
        if (url === startUrl || url.startsWith('file://')) return;
        event.preventDefault();
        try { shell.openExternal(url); } catch (e) {}
    });

    mainWindow.loadURL(startUrl);

    // Push the resolved apiBase into the renderer as soon as the
    // page is ready so js/main.js can read it via currentApiBase()
    // before its first network request. Also fires immediately for
    // ipc-driven re-resolution.
    const pushApiBase = () => {
        const base = String(settings.apiBase || DEFAULT_API).replace(/\/+$/, '');
        const script = `window.__UCHIHA_API_BASE__ = ${JSON.stringify(base)};`;
        mainWindow.webContents.executeJavaScript(script).catch(() => {});
    };
    mainWindow.webContents.once('did-finish-load', pushApiBase);
    mainWindow.webContents.on('did-frame-finish-load', pushApiBase);

    mainWindow.on('closed', () => { mainWindow = null; });
}

ipcMain.handle('launcher:getInfo', () => ({
    isDesktop: true,
    version: app.getVersion(),
    apiBase: settings.apiBase || DEFAULT_API,
    token: settings.token || null,
    user: settings.user || null,
}));

ipcMain.handle('launcher:setApiBase', (_e, apiBase) => {
    settings.apiBase = String(apiBase || DEFAULT_API).replace(/\/+$/, '') || DEFAULT_API;
    saveSettings(settings);
    if (mainWindow) {
        const script = `window.__UCHIHA_API_BASE__ = ${JSON.stringify(settings.apiBase)};`;
        mainWindow.webContents.executeJavaScript(script).catch(() => {});
    }
    return { ok: true, apiBase: settings.apiBase };
});

ipcMain.handle('launcher:setAuth', (_e, payload) => {
    settings.token = (payload && payload.token) || null;
    settings.user = (payload && payload.user) || null;
    saveSettings(settings);
    return { ok: true };
});

ipcMain.handle('launcher:openExternal', (_e, url) => {
    try { shell.openExternal(String(url)); return true; } catch (e) { return false; }
});

ipcMain.handle('launcher:downloadLauncherExe', async () => {
    try {
        const res = await fetch(settings.apiBase + '/api/launcher/info');
        if (!res.ok) throw new Error('Backend not reachable');
        const info = await res.json();
        const win = info.platforms && info.platforms.windows;
        if (!win || !win.download_url) throw new Error('No Windows build available');
        const url = settings.apiBase + win.download_url + (settings.token ? '?token=' + encodeURIComponent(settings.token) : '');
        const dl = await fetch(url);
        if (!dl.ok) throw new Error('Download failed: HTTP ' + dl.status);
        const buf = Buffer.from(await dl.arrayBuffer());
        const result = await dialog.showSaveDialog(mainWindow, {
            title: 'Save UCHIHA-Launcher.exe',
            defaultPath: path.join(app.getPath('downloads'), 'UCHIHA-Launcher.exe'),
            filters: [{ name: 'Executable', extensions: ['exe'] }],
        });
        if (result.canceled || !result.filePath) return { ok: false, canceled: true };
        fs.writeFileSync(result.filePath, buf);
        return { ok: true, path: result.filePath };
    } catch (e) {
        return { ok: false, error: String(e.message || e) };
    }
});

app.whenReady().then(async () => {
    try { await resolveApiBase(); } catch (e) { /* keep default */ }
    createWindow();
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
