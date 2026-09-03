'use strict';
/*
 * Build the UCHIHA Launcher as a real, native Windows .exe.
 *
 * 1) Use @electron/packager to wrap a clean Electron runtime into a directory
 *    build (UCHIHA-Launcher-win32-x64/). The inner UCHIHA-Launcher.exe is a
 *    real Windows PE binary that launches directly when double-clicked.
 * 2) Copy the website into resources/site/ so the runtime can load it.
 * 3) Copy the inner UCHIHA-Launcher.exe to:
 *      - launcher-build/UCHIHA-Launcher.exe  (instant launch — no SFX)
 *      - backend/data/downloads/UCHIHA-Launcher.exe
 * 4) Also copy the FULL build directory to:
 *      - backend/data/downloads/UCHIHA-Launcher-portable/
 *    so the inner .exe can find its required resources/ and locales/ folders
 *    when launched.
 *
 * No 7z SFX, no NSIS installer, no temp extraction. The downloaded file is
 * a real Windows PE binary that opens and runs the launcher immediately.
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const SITE = path.resolve(ROOT, '..', 'UCHIHA - Launcher', 'Launcher');
const PKG  = path.join(ROOT, 'package.json');
const ICON = path.join(ROOT, 'icon.ico');
const ELECTRON_VER = '33.4.11';
const FINAL_NAME = 'UCHIHA-Launcher';

function rmrf(p) {
    if (!fs.existsSync(p)) return;
    try { fs.rmSync(p, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); } catch (e) {}
}

function copyDir(src, dst) {
    fs.mkdirSync(dst, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        const s = path.join(src, entry.name);
        const d = path.join(dst, entry.name);
        if (entry.isDirectory()) copyDir(s, d);
        else fs.copyFileSync(s, d);
    }
}

function run(cmd, opts = {}) {
    console.log('> ' + cmd);
    execSync(cmd, { stdio: 'inherit', ...opts });
}

function copyFileSafe(src, dst) {
    try { fs.copyFileSync(src, dst); return true; } catch (e) { console.error('copy failed', src, '->', dst, e.message); return false; }
}

(function main() {
    console.log('[1/5] Stage build dirs (timestamped to dodge AV locks)');
    const stamp = String(Date.now());
    const safeOut = path.join(ROOT, 'release_' + stamp);
    rmrf(safeOut);
    fs.mkdirSync(safeOut, { recursive: true });
    const STAGE  = path.join(safeOut, 'stage');
    const APPDIR = path.join(safeOut, FINAL_NAME + '-win32-x64');
    fs.mkdirSync(STAGE, { recursive: true });

    console.log('[2/5] Stage electron app sources');
    fs.writeFileSync(path.join(STAGE, 'package.json'), JSON.stringify({
        name: 'uchiha-launcher',
        version: JSON.parse(fs.readFileSync(PKG, 'utf8')).version,
        main: 'main.js',
    }, null, 2));
    for (const f of ['main.js', 'preload.js', 'icon.ico', 'icon.png']) {
        if (fs.existsSync(path.join(ROOT, f))) {
            fs.copyFileSync(path.join(ROOT, f), path.join(STAGE, f));
        }
    }

    console.log('[3/5] electron-packager (build directory)');
    run(`npx --yes @electron/packager "${STAGE}" ${FINAL_NAME} --platform=win32 --arch=x64 --electron-version=${ELECTRON_VER} --out="${safeOut}" --overwrite --icon="${ICON}" --app-bundle-id=com.uchihalabs.launcher --app-version=1.0.0 --win32metadata.ProductName="UCHIHA-Launcher" --win32metadata.CompanyName="UCHIHA Labs" --win32metadata.FileDescription="UCHIHA Labs Desktop Launcher"`);
    if (!fs.existsSync(APPDIR)) throw new Error('Packager output missing: ' + APPDIR);

    console.log('[4/5] Copy website into resources/site/');
    const siteDst = path.join(APPDIR, 'resources', 'site');
    copyDir(SITE, siteDst);

    // The inner Electron .exe is a real Windows PE binary.
    const innerExe = path.join(APPDIR, FINAL_NAME + '.exe');
    if (!fs.existsSync(innerExe)) throw new Error('Inner exe missing: ' + innerExe);

    console.log('[5/5] Copy inner .exe + portable folder + zip');
    const rootExe = path.join(ROOT, FINAL_NAME + '.exe');
    if (fs.existsSync(rootExe)) { try { fs.unlinkSync(rootExe); } catch (e) {} }
    copyFileSafe(innerExe, rootExe);

    const backendDownloads = path.resolve(ROOT, '..', 'backend', 'data', 'downloads');
    if (fs.existsSync(backendDownloads)) {
        const backendExe = path.join(backendDownloads, FINAL_NAME + '.exe');
        if (fs.existsSync(backendExe)) { try { fs.unlinkSync(backendExe); } catch (e) {} }
        copyFileSafe(innerExe, backendExe);

        // Also copy the full build directory (the .exe needs resources/ and
        // locales/ alongside it) so the launcher can be launched from the
        // backend downloads folder without any extraction.
        const portableDir = path.join(backendDownloads, FINAL_NAME + '-portable');
        rmrf(portableDir);
        copyDir(APPDIR, portableDir);
        console.log('  - copied portable folder to ' + portableDir);

        // Also create a .zip of the portable folder so the website can
        // serve a single file that contains everything (unzip once, then
        // double-click UCHIHA-Launcher.exe for instant launch).
        try {
            const AdmZip = require('adm-zip');
            const zipPath = path.join(backendDownloads, FINAL_NAME + '-portable.zip');
            if (fs.existsSync(zipPath)) { try { fs.unlinkSync(zipPath); } catch (e) {} }
            const zip = new AdmZip();
            zip.addLocalFolder(portableDir, FINAL_NAME + '-portable');
            zip.writeZip(zipPath);
            console.log('  - created ' + zipPath + ' (' + (fs.statSync(zipPath).size / 1024 / 1024).toFixed(1) + ' MB)');
        } catch (e) {
            console.error('  - zip creation failed:', e.message);
        }
    }

    console.log('');
    console.log('Build complete: ' + rootExe);
    console.log('Size: ' + (fs.statSync(rootExe).size / 1024 / 1024).toFixed(1) + ' MB');
    console.log('');
    console.log('  ' + rootExe + ' is a real Windows PE binary. It launches');
    console.log('  directly when double-clicked. It needs the contents of');
    console.log('  ' + APPDIR + ' alongside it (resources/, locales/, *.dll).');
})();
