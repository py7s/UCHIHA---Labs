'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');
const https = require('https');
const multer = require('multer');
const crypto = require('crypto');
const db = require('../db/init');
const { authRequired } = require('../middleware/auth');
const { ok, bad, notFound, asyncHandler, parseBody } = require('../utils/http');

const router = express.Router();

// Use in-memory storage; we then push the bytes to the GitHub
// "uchiha-assets" repo via the GitHub Contents API. This works
// around the Render free tier not having a persistent disk and
// means profile pictures survive deploys, restarts, and crashes.
const GITHUB_REPO = process.env.ASSETS_REPO || 'py7s/uchiha-assets';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const GITHUB_BRANCH = process.env.ASSETS_BRANCH || 'main';
const ASSETS_DIR = 'profile-pictures';
const MANIFEST_PATH = `${ASSETS_DIR}/_manifest.json`;

// Local fallback copy (works on local/dev backends where GitHub
// storage is not configured; on Render this disk is ephemeral but
// harmless because the GitHub push remains the source of truth).
const UPLOADS_DIR = path.resolve(__dirname, '..', '..', 'data', 'uploads');

const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const EXT_BY_MIME = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

function publicUrl(filename) {
    return `https://raw.githubusercontent.com/${GITHUB_REPO}/${GITHUB_BRANCH}/${ASSETS_DIR}/${filename}`;
}

function githubRequest(method, apiPath, body) {
    return new Promise((resolve, reject) => {
        const opts = {
            hostname: 'api.github.com',
            port: 443,
            path: apiPath,
            method: method,
            headers: {
                'User-Agent': 'uchiha-backend',
                'Accept': 'application/vnd.github+json',
                'Authorization': 'token ' + GITHUB_TOKEN,
                'Content-Type': 'application/json',
            },
        };
        const req = https.request(opts, res => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                try { resolve({ status: res.statusCode, body: data ? JSON.parse(data) : null }); }
                catch (e) { resolve({ status: res.statusCode, body: data }); }
            });
        });
        req.on('error', reject);
        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

// GET the manifest from GitHub (returns {entries: {[userId]: {filename, url, sha}}, sha})
async function readManifest() {
    if (!GITHUB_TOKEN) return { entries: {}, sha: null };
    const apiPath = `/repos/${GITHUB_REPO}/contents/${MANIFEST_PATH}`;
    const res = await githubRequest('GET', apiPath);
    if (res.status === 200 && res.body && res.body.content) {
        try {
            const decoded = JSON.parse(Buffer.from(res.body.content, 'base64').toString('utf8'));
            return { entries: decoded || {}, sha: res.body.sha };
        } catch (e) { return { entries: {}, sha: res.body.sha }; }
    }
    return { entries: {}, sha: null };
}

// PUT a new manifest, optionally updating the existing blob.
// On 422 ("sha wasn't supplied") we refetch the current sha and
// retry once — that can happen if another writer updated the
// file between readManifest and writeManifest.
async function writeManifest(entries, sha, depth = 0) {
    if (!GITHUB_TOKEN) return false;
    const apiPath = `/repos/${GITHUB_REPO}/contents/${MANIFEST_PATH}`;
    const body = {
        message: 'Update profile-picture manifest',
        branch: GITHUB_BRANCH,
        content: Buffer.from(JSON.stringify(entries, null, 2)).toString('base64'),
    };
    if (sha) body.sha = sha;
    const res = await githubRequest('PUT', apiPath, body);
    if (res.status >= 200 && res.status < 300) return true;
    if (res.status === 422 && depth === 0) {
        const fresh = await readManifest();
        if (fresh.sha) return writeManifest(entries, fresh.sha, depth + 1);
    }
    return false;
}

async function uploadToGitHub(filename, buffer) {
    if (!GITHUB_TOKEN) throw new Error('GITHUB_TOKEN not configured on server');
    const apiPath = `/repos/${GITHUB_REPO}/contents/${ASSETS_DIR}/${filename}`;
    // First, look up the existing blob (if any) so we can include
    // its sha in the PUT — required by GitHub to overwrite.
    let sha = null;
    try {
        const head = await githubRequest('GET', apiPath);
        if (head.status === 200 && head.body && head.body.sha) {
            sha = head.body.sha;
        }
    } catch (e) { /* ignore */ }
    const body = {
        message: `Upload profile picture ${filename}`,
        branch: GITHUB_BRANCH,
        content: buffer.toString('base64'),
    };
    if (sha) body.sha = sha;
    const res = await githubRequest('PUT', apiPath, body);
    if (res.status >= 200 && res.status < 300) {
        return res.body && res.body.content && res.body.content.download_url;
    }
    throw new Error('GitHub upload failed: ' + res.status + ' ' + JSON.stringify(res.body));
}

// Restore the per-user profile_picture / profile_picture_url columns
// from the GitHub manifest, so that after a fresh DB the user data
// is back without losing the picture. Idempotent.
async function syncManifestIntoDb() {
    if (!GITHUB_TOKEN) return;
    try {
        const { entries } = await readManifest();
        if (!entries || !Object.keys(entries).length) return;
        const stmt = db.prepare('UPDATE users SET profile_picture = ?, profile_picture_url = ? WHERE id = ?');
        const tx = db.transaction(() => {
            for (const [uid, info] of Object.entries(entries)) {
                if (!info || !info.filename) continue;
                stmt.run(info.filename, info.url, Number(uid));
            }
        });
        tx();
        console.log('[users] synced', Object.keys(entries).length, 'profile pictures from GitHub manifest');
    } catch (e) {
        console.error('[users] manifest sync failed:', e && e.message);
    }
}

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (ALLOWED_IMAGE_TYPES.includes(file.mimetype)) cb(null, true);
        else cb(new Error('Only PNG, JPG or WebP allowed'));
    },
});

function uploadMw(req, res, next) {
    upload.single('file')(req, res, err => {
        if (err) return bad(res, err.message || 'Upload failed', 400);
        next();
    });
}

function effectiveBalance(user) {
    const perms = String(user.account_permissions || user.account_type || 'User');
    const isOwner = ['Owner', 'Admin'].includes(perms);
    return {
        lc_balance: isOwner ? 999999999 : (user.lc_balance || 0),
        user_discord_user_coin_amount: isOwner ? 999999999 : (user.user_discord_user_coin_amount || 0),
    };
}

function publicUser(u) {
    if (!u) return null;
    const perms = String(u.account_permissions || u.account_type || 'User');
    const isOwner = ['Owner', 'Admin'].includes(perms);
    return {
        id: u.id,
        uuid: u.uuid,
        username: u.username,
        email: u.email,
        phone: u.phone,
        profile_picture: u.profile_picture,
        profile_picture_url: u.profile_picture_url,
        account_type: u.account_type,
        account_permissions: u.account_permissions,
        discord_user_id: u.discord_user_id,
        discord_username: u.discord_username,
        discord_avatar: u.discord_avatar,
        user_discord_user_coin_amount: isOwner ? 999999999 : (u.user_discord_user_coin_amount || 0),
        lc_balance: isOwner ? 999999999 : (u.lc_balance || 0),
        avatar_decoration: u.avatar_decoration,
        nameplate: u.nameplate,
        preferred_language: u.preferred_language,
        time_zone: u.time_zone,
        member_since: u.member_since,
        last_login: u.last_login,
        created_at: u.created_at,
    };
}

router.get('/user', authRequired, (req, res) => ok(res, publicUser(req.user)));

router.post('/profile/update', authRequired, asyncHandler(async (req, res) => {
    const b = parseBody(req);
    const allowed = ['username', 'email', 'phone', 'preferred_language', 'time_zone',
        'show_online_status', 'allow_data_collection', 'email_notifications',
        'product_updates', 'promotional_emails', 'discord_notifications',
        'auto_install', 'pause_downloads', 'newsletter_opt_in', 'nameplate'];
    const booleanFields = ['show_online_status', 'allow_data_collection', 'email_notifications',
        'product_updates', 'promotional_emails', 'discord_notifications',
        'auto_install', 'pause_downloads', 'newsletter_opt_in'];
    const updates = [];
    const values = [];
    for (const key of allowed) {
        if (b[key] !== undefined) {
            updates.push(key + ' = ?');
            if (booleanFields.includes(key)) {
                const v = b[key];
                values.push(v === true || v === 1 || v === 'true' || v === '1' ? 1 : 0);
            } else {
                values.push(b[key]);
            }
        }
    }
    if (b.username) {
        if (!/^[A-Za-z][A-Za-z0-9._-]{6,19}$/.test(b.username)) return bad(res, 'Invalid username format');
        const exists = db.prepare('SELECT id FROM users WHERE username = ? AND id != ?').get(b.username, req.user.id);
        if (exists) return bad(res, 'Username already taken');
    }
    if (b.email) {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.email)) return bad(res, 'Invalid email');
    }
    if (b.currentPassword || b.newPassword) {
        if (!b.currentPassword || !b.newPassword) return bad(res, 'Current and new password required');
        const u = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
        const bcrypt = require('bcrypt');
        const ok_pw = await bcrypt.compare(b.currentPassword, u.password_hash || '');
        if (!ok_pw) return bad(res, 'Current password incorrect');
        if (b.newPassword.length < 6) return bad(res, 'New password too short');
        const hash = await bcrypt.hash(b.newPassword, 12);
        db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, req.user.id);
    }
    if (updates.length) {
        values.push(req.user.id);
        db.prepare('UPDATE users SET ' + updates.join(', ') + ' WHERE id = ?').run(...values);
    }
    const fresh = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    return ok(res, publicUser(fresh));
}));

router.post('/profile/upload_picture', authRequired, uploadMw, asyncHandler(async (req, res) => {
    try {
        if (!req.file) return bad(res, 'No file uploaded');
        // Keep a stable filename per user so subsequent uploads replace
        // the same blob (and the public URL never changes for a user).
        const ext = EXT_BY_MIME[req.file.mimetype] || 'png';
        const filename = 'u' + req.user.id + '.' + ext;

        // Local fallback copy (the persistence source in development).
        try {
            fs.mkdirSync(UPLOADS_DIR, { recursive: true });
            fs.writeFileSync(path.join(UPLOADS_DIR, filename), req.file.buffer);
        } catch (e) {
            console.error('[upload_picture] local copy failed:', e.message);
        }

        // Push to GitHub (durable storage on Render). If that fails we still
        // save the picture in the DB below, so the user can always see it.
        let url = '';
        let githubOk = false;
        if (!GITHUB_TOKEN) {
            console.warn('[upload_picture] GITHUB_TOKEN not set — picture stored in the database only (lost on Render restarts).');
        } else {
            try {
                await uploadToGitHub(filename, req.file.buffer);
                url = publicUrl(filename);
                githubOk = true;
            } catch (e) {
                console.error('[upload_picture] GitHub upload failed:', e && e.message);
            }
        }

        // Persist in the local DB (still functional while the process runs,
        // and is the fallback the /api/profile_picture endpoint serves).
        db.prepare('UPDATE users SET profile_picture = ?, profile_picture_url = ?, profile_picture_data = ? WHERE id = ?')
            .run(filename, url, req.file.buffer.toString('base64'), req.user.id);

        // Keep the GitHub manifest in sync (optional).
        if (githubOk) {
            try {
                const { entries, sha } = await readManifest();
                entries[String(req.user.id)] = { filename, url, updatedAt: Date.now() };
                await writeManifest(entries, sha);
            } catch (e) {
                console.error('[upload_picture] manifest write failed:', e && e.message);
            }
        }

        return ok(res, { profile_picture: filename, url: url });
    } catch (err) {
        console.error('[upload_picture] error:', err && err.message, err && err.stack);
        return res.status(500).json({ detail: 'Upload failed: ' + (err && err.message ? err.message : 'unknown') });
    }
}));

router.get('/bank', authRequired, (req, res) => {
    const packs = db.prepare('SELECT * FROM bank_packs ORDER BY price ASC').all();
    const bal = effectiveBalance(req.user);
    res.json({
        lc_balance: bal.lc_balance,
        user_discord_user_coin_amount: bal.user_discord_user_coin_amount,
        packs: packs,
    });
});

// Public image endpoint. Priority: local file (dev) → embedded DB copy →
// 302 redirect to the canonical GitHub URL.
router.get('/profile_picture/:filename', (req, res) => {
    const filename = path.basename(req.params.filename);
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*\.(png|jpe?g|webp)$/i.test(filename)) return notFound(res);
    // 1. Local fallback file (present on local-heavy backends).
    if (fs.existsSync(path.join(UPLOADS_DIR, filename))) {
        return res.sendFile(path.join(UPLOADS_DIR, filename));
    }
    const row = db.prepare('SELECT profile_picture_data, profile_picture_url FROM users WHERE profile_picture = ?').get(filename);
    // 2. Embedded DB copy — served directly (no GitHub dependency).
    if (row && row.profile_picture_data) {
        const mime = /\.(jpe?g)$/i.test(filename) ? 'image/jpeg' : (/\.webp$/i.test(filename) ? 'image/webp' : 'image/png');
        res.setHeader('Content-Type', mime);
        res.setHeader('Cache-Control', 'public, max-age=86400');
        return res.send(Buffer.from(row.profile_picture_data, 'base64'));
    }
    // 3. Canonical GitHub URL stored in the DB (302).
    if (row && row.profile_picture_url) {
        return res.redirect(302, row.profile_picture_url);
    }
    return notFound(res);
});

module.exports = router;
module.exports.syncManifestIntoDb = syncManifestIntoDb;