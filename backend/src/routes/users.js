'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const db = require('../db/init');
const { authRequired } = require('../middleware/auth');
const { ok, bad, notFound, asyncHandler, parseBody } = require('../utils/http');

const router = express.Router();

const UPLOAD_DIR = path.resolve(__dirname, '..', '..', 'data', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const upload = multer({
    storage: multer.diskStorage({
        destination: UPLOAD_DIR,
        filename: (req, file, cb) => {
            const crypto = require('crypto');
            const safe = String(req.user.id || '0').replace(/[^0-9]/g, '') || '0';
            cb(null, 'u' + safe + '_' + crypto.randomBytes(8).toString('hex') + '.png');
        },
    }),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'image/png') cb(null, true);
        else cb(new Error('Only PNG allowed'));
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

router.post('/profile/upload_picture', authRequired, uploadMw, (req, res) => {
    if (!req.file) return bad(res, 'No file uploaded');
    const filename = req.file.filename;
    db.prepare('UPDATE users SET profile_picture = ? WHERE id = ?').run(filename, req.user.id);
    return ok(res, { profile_picture: filename });
});

router.get('/bank', authRequired, (req, res) => {
    const packs = db.prepare('SELECT * FROM bank_packs ORDER BY price ASC').all();
    const bal = effectiveBalance(req.user);
    res.json({
        lc_balance: bal.lc_balance,
        user_discord_user_coin_amount: bal.user_discord_user_coin_amount,
        packs: packs,
    });
});

router.get('/profile_picture/:filename', (req, res) => {
    const filename = path.basename(req.params.filename);
    if (!/^u\d+_[a-f0-9]{16}\.png$/.test(filename)) return notFound(res);
    const file = path.join(UPLOAD_DIR, filename);
    if (!fs.existsSync(file)) return notFound(res);
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.sendFile(file);
});

module.exports = router;