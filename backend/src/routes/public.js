'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');
const db = require('../db/init');
const { ok, asyncHandler } = require('../utils/http');

const router = express.Router();

const PUBLIC_KEYS = [
    'site_name', 'site_tagline', 'default_currency', 'discord_invite',
    'github_username',
    'maintenance_mode', 'maintenance_reason', 'registration_enabled', 'default_lc_new_user',
    'store_tab', 'customer_panel_tab', 'lab_pass_tab', 'inventory_tab',
    'reviews_tab', 'partner_tab', 'forum_tab', 'bank_tab', 'q_and_a_tab',
    'github_page', 'status_page', 'download_button', 'join_discord_button',
    'launcher_version', 'launcher_changelog', 'launcher_required_role',
];

const STATIC_DEFAULTS = {
    default_per_page: 9,
    default_product_filter: 'All Products',
    default_name_color: '#ffffff',
    default_nameplate: 'spirit_blossom_petrals.webp',
    default_avatar_decoration: 'chromawave.png',
    macos_launcher_file_path: null,
    linux_launcher_file_path: null,
    windows_launcher_file_path: null,
};

function loadStaticConfig() {
    const candidates = [
        path.resolve(__dirname, '..', '..', 'data', 'config.json'),
        path.resolve(process.cwd(), 'data', 'config.json'),
        path.resolve(process.cwd(), 'config.json'),
    ];
    for (const p of candidates) {
        if (fs.existsSync(p)) {
            try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) {}
        }
    }
    return {};
}

const DOWNLOADS_DIR = path.resolve(__dirname, '..', '..', 'data', 'downloads');
const GITHUB_RELEASE_DOWNLOAD = 'https://github.com/py7s/UCHIHA---Labs/releases/latest/download';
const LAUNCHER_FILES = {
    windows: {
        name: 'UCHIHA-Launcher.exe',
        display: 'UCHIHA-Launcher.exe',
        fallbackUrl: 'https://github.com/py7s/UCHIHA---Labs/releases/latest/download/UCHIHA-Launcher.exe',
    },
    macos: {
        name: 'UCHIHA-Launcher-macOS.dmg',
        display: 'UCHIHA-Launcher-macOS.dmg',
        fallbackUrl: GITHUB_RELEASE_DOWNLOAD + '/UCHIHA-Launcher-macOS.dmg',
    },
    linux: {
        name: 'UCHIHA-Launcher-linux.AppImage',
        display: 'UCHIHA-Launcher-linux.AppImage',
        fallbackUrl: GITHUB_RELEASE_DOWNLOAD + '/UCHIHA-Launcher-linux.AppImage',
    },
};

function getLauncherFile(platform) {
    const info = LAUNCHER_FILES[platform] || LAUNCHER_FILES.windows;
    const filePath = path.join(DOWNLOADS_DIR, info.name);
    return { info, filePath, exists: fs.existsSync(filePath) };
}

function logDownload(userId, platform, ip, userAgent) {
    try {
        const ver = (db.prepare('SELECT value FROM settings WHERE key = ?').get('launcher_version') || {}).value || '1.0.0';
        db.prepare('INSERT INTO launcher_downloads (user_id, platform, version, ip, user_agent, created_at) VALUES (?, ?, ?, ?, ?, ?)')
            .run(userId || null, platform, ver, ip || null, userAgent || null, Date.now());
    } catch (e) {
        console.error('[launcher download log]', e.message);
    }
}

router.get('/config', (req, res) => {
    const settingsRows = db.prepare('SELECT key, value FROM settings').all();
    const fromDb = {};
    for (const r of settingsRows) {
        if (!PUBLIC_KEYS.includes(r.key)) continue;
        if (r.value === 'true') fromDb[r.key] = true;
        else if (r.value === 'false') fromDb[r.key] = false;
        else if (/^-?\d+(\.\d+)?$/.test(r.value)) fromDb[r.key] = Number(r.value);
        else fromDb[r.key] = r.value;
    }
    const ver = fromDb.launcher_version || '1.0.0';
    const merged = Object.assign({}, STATIC_DEFAULTS, loadStaticConfig(), fromDb);
    merged.launcher = {
        version: ver,
        changelog: merged.launcher_changelog || '',
        required_role: merged.launcher_required_role || 'User',
        download_url: '/api/launcher/download?platform=windows',
        size_bytes: (() => {
            try {
                const f = getLauncherFile('windows');
                return f.exists ? fs.statSync(f.filePath).size : 0;
            } catch (e) { return 0; }
        })(),
    };
    if (!merged.windows_launcher_file_path) {
        merged.windows_launcher_file_path = '/api/launcher/download?platform=windows';
    }
    res.json(merged);
});

router.get('/launcher/info', (req, res) => {
    res.json({ version: '1.0.0', platforms: {} });
});

router.get('/launcher/download', (req, res) => {
    res.status(410).json({ detail: 'Launcher downloads are no longer available. Use the website at https://uchiha-market.com' });
});

router.get('/news', (req, res) => {
    const rows = db.prepare('SELECT id, title, body, image_url, created_at FROM news_posts ORDER BY id DESC LIMIT 50').all();
    res.json({ news: rows });
});

router.get('/qa', (req, res) => {
    const rows = db.prepare('SELECT id, question, answer, category, sort_order FROM qa_entries ORDER BY sort_order ASC, id ASC').all();
    res.json({ qa: rows });
});

router.get('/partners', (req, res) => {
    const rows = db.prepare('SELECT id, name, description, url, logo_url, discord, created_at FROM partners ORDER BY id ASC').all();
    res.json({ partners: rows });
});

router.get('/downloads/:filename', (req, res) => {
    const filename = path.basename(req.params.filename);
    const fp = path.join(DOWNLOADS_DIR, filename);
    if (!fs.existsSync(fp)) return res.status(404).json({ detail: 'File not found' });
    res.download(fp, filename);
});

module.exports = router;