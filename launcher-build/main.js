'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const SETTINGS_FILE = () => path.join(app.getPath('userData'), 'launcher-settings.json');
const DEFAULT_API = 'https://uchiha-backend-d1n7.onrender.com';

function loadSettings() {
    try {
        if (fs.existsSync(SETTINGS_FILE())) {
            return JSON.parse(fs.readFileSync(SETTINGS_FILE(), 'utf8'));
        }
    } catch (e) {}
    return { apiBase: DEFAULT_API, token: null, user: null };
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

app.whenReady().then(() => {
    createWindow();
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
