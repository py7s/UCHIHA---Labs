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
    'maintenance_mode', 'registration_enabled', 'default_lc_new_user',
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
const LAUNCHER_FILES = {
    // Served by the download endpoint. We ship the NSIS setup .exe which
    // installs the launcher into %LOCALAPPDATA%\Programs\uchiha-launcher\
    // and creates a desktop + start-menu shortcut on double-click.
    windows: { name: 'UCHIHA-Launcher-Setup.exe', display: 'UCHIHA-Launcher-Setup.exe' },
    macos:   { name: 'UCHIHA-Launcher-macOS.zip',   display: 'UCHIHA-Launcher' },
    linux:   { name: 'UCHIHA-Launcher-linux.zip',   display: 'UCHIHA-Launcher' },
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
    const ver = (db.prepare('SELECT value FROM settings WHERE key = ?').get('launcher_version') || {}).value || '1.0.0';
    const changelog = (db.prepare('SELECT value FROM settings WHERE key = ?').get('launcher_changelog') || {}).value || '';
    const requiredRole = (db.prepare('SELECT value FROM settings WHERE key = ?').get('launcher_required_role') || {}).value || 'User';
    const platforms = {};
    for (const p of Object.keys(LAUNCHER_FILES)) {
        const f = getLauncherFile(p);
        platforms[p] = {
            available: f.exists,
            size_bytes: f.exists ? fs.statSync(f.filePath).size : 0,
            download_url: f.exists ? '/api/launcher/download?platform=' + p : null,
        };
    }
    res.json({
        version: ver,
        changelog: changelog,
        required_role: requiredRole,
        platforms: platforms,
    });
});

router.get('/launcher/download', (req, res) => {
    const platform = String(req.query.platform || 'windows').toLowerCase();
    if (!LAUNCHER_FILES[platform]) {
        return res.status(400).json({ detail: 'Unknown platform. Use windows, macos, or linux.' });
    }
    const { info, filePath, exists } = getLauncherFile(platform);
    if (!exists) {
        return res.status(404).json({
            detail: 'Launcher build is not available for this platform yet. Ask the admin to upload the binary to data/downloads/' + info.name,
        });
    }
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || req.query.token;
    let userId = null;
    if (token) {
        try {
            const jwt = require('jsonwebtoken');
            const config = require('../config');
            const decoded = jwt.verify(token, config.jwtSecret);
            userId = decoded.sub;
        } catch (e) {}
    }
    logDownload(userId, platform, req.ip, req.headers['user-agent']);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', 'attachment; filename="' + info.display + '"');
    res.setHeader('X-Launcher-Version', (db.prepare('SELECT value FROM settings WHERE key = ?').get('launcher_version') || {}).value || '1.0.0');
    fs.createReadStream(filePath).pipe(res);
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

router.get('/maintenance_status', (req, res) => {
    const rows = db.prepare('SELECT product_key, status, message, updated_at FROM maintenance_status').all();
    res.json({ statuses: rows });
});

router.get('/maintenance/categories', (req, res) => {
    // Optional auth: if the caller has a valid token AND is Admin/Owner,
    // return every category (including disabled). Otherwise hide disabled
    // categories from the public — only Owner/Admin can see them.
    let isPrivileged = false;
    const auth = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (auth) {
        try {
            const jwt = require('jsonwebtoken');
            const config = require('../config');
            const decoded = jwt.verify(auth, config.jwtSecret);
            const rank = ['User','VIP','Partner','Beta','UnlockAll','Admin','Owner']
                .indexOf(String(decoded.permissions || decoded.account_type || 'User'));
            if (rank >= 5) isPrivileged = true;
        } catch (e) {}
    }
    const rows = db.prepare(`
        SELECT id, slug, title, description, enabled, reason, sort_order, updated_at
        FROM maintenance_categories
        ORDER BY sort_order ASC, id ASC
    `).all();
    let categories = rows.map(r => ({
        id: r.id,
        slug: r.slug,
        title: r.title,
        description: r.description,
        enabled: r.enabled === 1 || r.enabled === true,
        reason: r.reason || null,
        sort_order: r.sort_order,
        updated_at: r.updated_at,
    }));
    if (!isPrivileged) {
        categories = categories.filter(c => c.enabled);
    }
    res.json({ categories, privileged: isPrivileged });
});

module.exports = router;