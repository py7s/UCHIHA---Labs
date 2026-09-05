'use strict';

const express = require('express');
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
const db = require('../db/init');
const { signToken } = require('../middleware/auth');
const { ok, bad, asyncHandler, parseBody } = require('../utils/http');
const { genResetCode, randomToken, safeEqualStr } = require('../utils/crypto');
const config = require('../config');

const router = express.Router();

const ROLES = ['User', 'VIP', 'Partner', 'Beta', 'UnlockAll', 'Admin', 'Owner'];

function publicUser(u) {
    if (!u) return null;
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
        user_discord_user_coin_amount: u.user_discord_user_coin_amount || 0,
        avatar_decoration: u.avatar_decoration,
        nameplate: u.nameplate,
        preferred_language: u.preferred_language,
        time_zone: u.time_zone,
        member_since: u.member_since,
        last_login: u.last_login,
        created_at: u.created_at,
    };
}

function persistSession(user, token, refreshToken, userAgent, ip, expiresMs) {
    db.prepare(`
        INSERT INTO sessions (token, user_id, refresh_token, ip, user_agent, created_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(token, user.id, refreshToken, ip || null, userAgent || null, Date.now(), Date.now() + expiresMs);
}

function issueTokens(user, req) {
    const token = signToken(user);
    const refreshToken = randomToken(24);
    const expiresMs = 7 * 24 * 60 * 60 * 1000;
    persistSession(user, token, refreshToken, req.headers['user-agent'], req.ip, expiresMs);
    db.prepare('UPDATE users SET last_login = ? WHERE id = ?').run(Date.now(), user.id);
    return { token, refresh_token: refreshToken, account: publicUser(user) };
}

router.post('/login', asyncHandler(async (req, res) => {
    const { username, password, user_agent, time_zone, fingerprint, browser } = parseBody(req);
    if (!username || !password) return bad(res, 'Username and password required');
    const user = db.prepare('SELECT * FROM users WHERE username = ? OR email = ?').get(username, username);
    if (!user || !user.password_hash) return bad(res, 'Invalid credentials', 401);
    const ok_pw = await bcrypt.compare(password, user.password_hash);
    if (!ok_pw) return bad(res, 'Invalid credentials', 401);
    if (user.banned) return bad(res, 'Account banned', 403);
    db.prepare('UPDATE users SET last_login = ? WHERE id = ?').run(Date.now(), user.id);
    const tokens = issueTokens(user, req);
    return ok(res, tokens);
}));

router.post('/register', asyncHandler(async (req, res) => {
    const { username, email, phone, password } = parseBody(req);
    if (!username || !password) return bad(res, 'Username and password required');
    if (!/^[A-Za-z][A-Za-z0-9._-]{6,19}$/.test(username)) return bad(res, 'Username must be 7-20 chars, start with a letter');
    if (password.length < 6) return bad(res, 'Password must be at least 6 characters');
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return bad(res, 'Invalid email');
    const existing = db.prepare('SELECT id FROM users WHERE username = ? OR email = ?').get(username, email || null);
    if (existing) return bad(res, 'Username or email already taken', 409);
    const now = Date.now();
    const hash = await bcrypt.hash(password, 12);
    const info = db.prepare(`
        INSERT INTO users (uuid, username, email, phone, password_hash, account_type, account_permissions, member_since, created_at)
        VALUES (?, ?, ?, ?, ?, 'User', 'User', ?, ?)
    `).run(uuidv4(), username, email || null, phone || null, hash, now, now);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
    const tokens = issueTokens(user, req);
    return ok(res, tokens);
}));

router.post('/forgot-password', asyncHandler(async (req, res) => {
    res.status(403).json({ detail: 'Password reset is disabled. Please use Discord to sign in.' });
}));

router.post('/reset-password', asyncHandler(async (req, res) => {
    res.status(403).json({ detail: 'Password reset is disabled. Please use Discord to sign in.' });
}));

router.get('/me', asyncHandler(async (req, res) => {
    const { username, password, user_agent, time_zone, fingerprint, browser } = parseBody(req);
    if (!username || !password) return bad(res, 'Username and password required');
    const user = db.prepare('SELECT * FROM users WHERE username = ? OR email = ?').get(username, username);
    if (!user || !user.password_hash) return bad(res, 'Invalid credentials', 401);
    const ok_pw = await bcrypt.compare(password, user.password_hash);
    if (!ok_pw) return bad(res, 'Invalid credentials', 401);
    if (user.banned) return bad(res, 'Account banned', 403);
    db.prepare('UPDATE users SET last_login = ? WHERE id = ?').run(Date.now(), user.id);
    const tokens = issueTokens(user, req);
    return ok(res, tokens);
}));

router.post('/forgot_password', asyncHandler(async (req, res) => {
    const { identifier } = parseBody(req);
    if (!identifier) return bad(res, 'Identifier required');
    const user = db.prepare('SELECT * FROM users WHERE username = ? OR email = ?').get(identifier, identifier);
    if (!user) return ok(res, { ok: true });
    if (user.banned) return ok(res, { ok: true });
    const code = genResetCode();
    const expires = Date.now() + 15 * 60 * 1000;
    db.prepare('INSERT INTO reset_codes (user_id, code, created_at, expires_at) VALUES (?, ?, ?, ?)')
        .run(user.id, code, Date.now(), expires);
    if (config.nodeEnv !== 'production') {
        console.log(`[dev] reset code for ${user.username}: ${code}`);
    }
    return ok(res, { ok: true });
}));

router.post('/confirm_reset', asyncHandler(async (req, res) => {
    const { identifier, code, new_password } = parseBody(req);
    if (!identifier || !code || !new_password) return bad(res, 'All fields required');
    if (new_password.length < 6) return bad(res, 'Password must be at least 6 characters');
    const user = db.prepare('SELECT * FROM users WHERE username = ? OR email = ?').get(identifier, identifier);
    if (!user) return bad(res, 'Invalid code', 400);
    if (user.banned) return bad(res, 'Account banned', 403);
    const row = db.prepare(`
        SELECT id FROM reset_codes
        WHERE user_id = ? AND code = ? AND used = 0 AND expires_at > ?
        ORDER BY id DESC LIMIT 1
    `).get(user.id, code, Date.now());
    if (!row) return bad(res, 'Invalid or expired code', 400);
    const hash = await bcrypt.hash(new_password, 12);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, user.id);
    db.prepare('UPDATE reset_codes SET used = 1 WHERE id = ?').run(row.id);
    db.prepare('UPDATE sessions SET revoked = 1 WHERE user_id = ?').run(user.id);
    return ok(res, { ok: true });
}));

router.post('/logout', asyncHandler(async (req, res) => {
    const header = req.headers['authorization'] || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (token) {
        db.prepare('UPDATE sessions SET revoked = 1 WHERE token = ?').run(token);
    }
    return ok(res, { ok: true });
}));

module.exports = router;
