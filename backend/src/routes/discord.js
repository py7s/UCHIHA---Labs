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
    try {
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

        if (!config.discord.clientId || !config.discord.clientSecret || !config.discord.redirectUri) {
            return redirectWithError(res, returnTo, 'discord_not_configured');
        }

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
        if (!tokenRes.ok) {
            const text = await tokenRes.text().catch(() => '');
            console.error('[discord] token exchange failed:', tokenRes.status, text);
            return redirectWithError(res, returnTo, 'token_exchange_failed');
        }
        let tokenJson;
        try {
            tokenJson = await tokenRes.json();
        } catch (e) {
            console.error('[discord] token response parse failed:', e && e.message);
            return redirectWithError(res, returnTo, 'token_parse_failed');
        }
        const accessToken = tokenJson.access_token;
        if (!accessToken) {
            console.error('[discord] no access_token in response:', JSON.stringify(tokenJson));
            return redirectWithError(res, returnTo, 'no_access_token');
        }

        const meRes = await fetch('https://discord.com/api/users/@me', {
            headers: { Authorization: 'Bearer ' + accessToken },
        });
        if (!meRes.ok) return redirectWithError(res, returnTo, 'profile_fetch_failed');
        const me = await meRes.json();

        let user = db.prepare('SELECT * FROM users WHERE discord_user_id = ?').get(me.id);
        const now = Date.now();
        const avatarUrl = me.avatar
            ? 'https://cdn.discordapp.com/avatars/' + me.id + '/' + me.avatar + (me.avatar.startsWith('a_') ? '.gif' : '.png')
            : null;

        let accountType = 'User';
        let accountPermissions = 'User';
        let isOnServer = false;
        if (config.discord.guildId && config.discord.botToken) {
            try {
                const guildRes = await fetch('https://discord.com/api/guilds/' + config.discord.guildId + '/members/' + me.id, {
                    headers: { Authorization: 'Bot ' + config.discord.botToken },
                });
                if (guildRes.ok) {
                    isOnServer = true;
                    const member = await guildRes.json();
                    const roleIds = (member.roles || []);
                    const roleMap = config.discord.roleMap || {};
                    const mapped = roleIds.map(id => roleMap[id]).filter(Boolean);
                    const priority = { Owner: 6, Admin: 5, Beta: 3, Partner: 2, VIP: 1, User: 0 };
                    if (mapped.length) {
                        mapped.sort((a, b) => (priority[b] || 0) - (priority[a] || 0));
                        accountType = mapped[0];
                        accountPermissions = mapped[0];
                    }
                }
            } catch (e) {
                console.error('[discord] role fetch failed:', e && e.message);
            }
        }

        if (!isOnServer) {
            return redirectWithError(res, returnTo, 'You must be a member of the Discord server to sign in.');
        }

        if (!user) {
            const existingByEmail = me.email ? db.prepare('SELECT * FROM users WHERE email = ?').get(me.email) : null;
            if (existingByEmail) {
                db.prepare('UPDATE users SET discord_user_id = ?, discord_username = ?, discord_avatar = ?, discord_email = ?, last_login = ?, account_type = ?, account_permissions = ? WHERE id = ?')
                    .run(me.id, me.username, avatarUrl, me.email || null, now, accountType, accountPermissions, existingByEmail.id);
                user = db.prepare('SELECT * FROM users WHERE id = ?').get(existingByEmail.id);
            } else {
                const baseUsername = (me.global_name || me.username || 'discord_user').toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 16) || 'discord_user';
                let username = baseUsername;
                let n = 0;
                while (db.prepare('SELECT id FROM users WHERE username = ?').get(username)) {
                    n++; username = baseUsername + n;
                }
                const info = db.prepare(`
                    INSERT INTO users (uuid, username, email, password_hash, discord_user_id, discord_username, discord_avatar, discord_email, account_type, account_permissions, member_since, created_at)
                    VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)
                `).run(uuidv4(), username, me.email || null, me.id, me.username, avatarUrl, me.email || null, accountType, accountPermissions, now, now);
                user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
            }
        } else {
            db.prepare('UPDATE users SET discord_username = ?, discord_avatar = ?, discord_email = ?, last_login = ?, account_type = ?, account_permissions = ? WHERE id = ?')
                .run(me.username, avatarUrl, me.email || null, now, accountType, accountPermissions, user.id);
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
    } catch (e) {
        console.error('[discord] callback error:', e && (e.stack || e.message || e));
        const returnTo = '/';
        return redirectWithError(res, returnTo, 'callback_failed');
    }
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

module.exports = router;