'use strict';

const express = require('express');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const db = require('../db/init');
const { signToken } = require('../middleware/auth');
const { ok, bad, asyncHandler } = require('../utils/http');
const config = require('../config');

const router = express.Router();

const oauthStates = new Map();

function genState() {
    const s = crypto.randomBytes(24).toString('hex');
    oauthStates.set(s, Date.now() + 10 * 60 * 1000);
    return s;
}

function consumeState(s) {
    const exp = oauthStates.get(s);
    if (!exp) return false;
    oauthStates.delete(s);
    return exp > Date.now();
}

router.get('/discord', (req, res) => {
    if (!config.discord.clientId) return res.status(500).send('Discord OAuth not configured');
    const state = genState();
    const returnTo = String(req.query.return_to || '/');
    const params = new URLSearchParams({
        client_id: config.discord.clientId,
        redirect_uri: config.discord.redirectUri,
        response_type: 'code',
        scope: 'identify email',
        state: state + ':' + Buffer.from(returnTo).toString('base64'),
        prompt: 'consent',
    });
    res.redirect('https://discord.com/api/oauth2/authorize?' + params.toString());
});

router.get('/discord/callback', asyncHandler(async (req, res) => {
    const { code, state, error } = req.query;
    const returnTo = (() => {
        try {
            const raw = String(state || '').split(':')[1] || '';
            return raw ? Buffer.from(raw, 'base64').toString('utf8') : '/';
        } catch (e) { return '/'; }
    })();
    if (error) return redirectWithError(res, returnTo, String(error));
    const stateOnly = String(state || '').split(':')[0];
    if (!code || !consumeState(stateOnly)) return redirectWithError(res, returnTo, 'invalid_state');

    const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: config.discord.clientId,
            client_secret: config.discord.clientSecret,
            grant_type: 'authorization_code',
            code: String(code),
            redirect_uri: config.discord.redirectUri,
        }),
    });
    if (!tokenRes.ok) return redirectWithError(res, returnTo, 'token_exchange_failed');
    const tokenJson = await tokenRes.json();
    const accessToken = tokenJson.access_token;

    const meRes = await fetch('https://discord.com/api/users/@me', {
        headers: { Authorization: 'Bearer ' + accessToken },
    });
    if (!meRes.ok) return redirectWithError(res, returnTo, 'profile_fetch_failed');
    const me = await meRes.json();

    let user = db.prepare('SELECT * FROM users WHERE discord_user_id = ?').get(me.id);
    const now = Date.now();
    if (!user) {
        const baseUsername = (me.global_name || me.username || 'user').toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 16) || 'user';
        let username = baseUsername;
        let n = 0;
        while (db.prepare('SELECT id FROM users WHERE username = ?').get(username)) {
            n++; username = baseUsername + n;
        }
        const info = db.prepare(`
            INSERT INTO users (uuid, username, email, password_hash, discord_user_id, discord_username, discord_avatar, discord_email, account_type, account_permissions, member_since, created_at)
            VALUES (?, ?, ?, NULL, ?, ?, ?, ?, 'User', 'User', ?, ?)
        `).run(uuidv4(), username, me.email || null, me.id, me.username, me.avatar, me.email || null, now, now);
        user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
    } else {
        db.prepare('UPDATE users SET discord_username = ?, discord_avatar = ?, discord_email = ?, last_login = ? WHERE id = ?')
            .run(me.username, me.avatar, me.email || null, now, user.id);
        user = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
    }

    const token = signToken(user);
    const expiresMs = 7 * 24 * 60 * 60 * 1000;
    db.prepare(`
        INSERT INTO sessions (token, user_id, ip, user_agent, created_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?)
    `).run(token, user.id, req.ip, req.headers['user-agent'] || null, now, now + expiresMs);

    const publicAccount = publicUser(user);
    const params2 = new URLSearchParams({
        discord_token: token,
        discord_account: JSON.stringify(publicAccount),
    });
    const target = returnTo + (returnTo.includes('?') ? '&' : '?') + params2.toString();
    res.redirect(target);
}));

function redirectWithError(res, returnTo, msg) {
    const params = new URLSearchParams({ auth_error: msg });
    const target = returnTo + (returnTo.includes('?') ? '&' : '?') + params.toString();
    return res.redirect(target);
}

function publicUser(u) {
    if (!u) return null;
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

module.exports = router;