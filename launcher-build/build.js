'use strict';
/*
 * Build the UCHIHA Launcher as a portable Windows .exe.
 *
 * 1) Use electron-builder to create a single portable EXE that contains
 *    everything (Electron runtime + website). No installer, no extraction.
 * 2) Copy the portable EXE to:
 *      - launcher-build/UCHIHA-Launcher.exe
 *      - backend/data/downloads/UCHIHA-Launcher.exe
 *
 * The portable EXE launches directly when double-clicked. No admin rights,
 * no installation, no extraction. Works on any Windows 10/11 PC.
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const SITE = path.resolve(ROOT, '..');
const PKG  = path.join(ROOT, 'package.json');
const ICON = path.join(ROOT, 'icon.ico');
const ELECTRON_VER = '33.4.11';
const FINAL_NAME = 'UCHIHA-Launcher';

function rmrf(p) {
    if (!fs.existsSync(p)) return;
    try { fs.rmSync(p, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); } catch (e) {}
}

function copyFileSafe(src, dst) {
    try { fs.copyFileSync(src, dst); return true; } catch (e) { console.error('copy failed', src, '->', dst, e.message); return false; }
}

(function main() {
    console.log('[1/3] Build portable EXE with electron-builder');
    const stamp = String(Date.now());
    const safeOut = path.join(ROOT, 'out-' + stamp);
    rmrf(safeOut);
    fs.mkdirSync(safeOut, { recursive: true });

    const pkg = JSON.parse(fs.readFileSync(PKG, 'utf8'));
    const builderPkg = JSON.parse(JSON.stringify(pkg));
    builderPkg.build.directories.output = safeOut;
    builderPkg.build.artifactName = FINAL_NAME + '.exe';
    builderPkg.build.win.target = [{ target: 'portable', arch: ['x64'] }];
    delete builderPkg.build.nsis;
    fs.writeFileSync(path.join(ROOT, 'package-builder.json'), JSON.stringify(builderPkg, null, 2));

    try {
        execSync('npx --yes electron-builder --win --x64 -c package-builder.json', {
            cwd: ROOT,
            stdio: 'inherit',
            env: { ...process.env, ELECTRON_BUILDER_CACHE: path.join(ROOT, '.electron-builder-cache') }
        });
    } finally {
        try { fs.unlinkSync(path.join(ROOT, 'package-builder.json')); } catch (e) {}
    }

    const builtExe = path.join(safeOut, FINAL_NAME + '.exe');
    if (!fs.existsSync(builtExe)) throw new Error('Built EXE not found: ' + builtExe);
    console.log('Built portable EXE: ' + builtExe + ' (' + (fs.statSync(builtExe).size / 1024 / 1024).toFixed(1) + ' MB)');

    console.log('[2/3] Copy to launcher-build/');
    const rootExe = path.join(ROOT, FINAL_NAME + '.exe');
    if (fs.existsSync(rootExe)) { try { fs.unlinkSync(rootExe); } catch (e) {} }
    copyFileSafe(builtExe, rootExe);

    console.log('[3/3] Copy to backend/data/downloads/');
    const backendDownloads = path.resolve(ROOT, '..', 'backend', 'data', 'downloads');
    if (fs.existsSync(backendDownloads)) {
        const backendExe = path.join(backendDownloads, FINAL_NAME + '.exe');
        if (fs.existsSync(backendExe)) { try { fs.unlinkSync(backendExe); } catch (e) {} }
        copyFileSafe(builtExe, backendExe);
    }

    console.log('');
    console.log('Build complete: ' + rootExe);
    console.log('Size: ' + (fs.statSync(rootExe).size / 1024 / 1024).toFixed(1) + ' MB');
    console.log('');
    console.log('  ' + rootExe + ' is a portable Windows PE binary.');
    console.log('  Double-click to launch. No installation required.');
})();
