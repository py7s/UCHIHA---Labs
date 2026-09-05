'use strict';

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const db = require('../db/init');
const config = require('../config');

function signToken(user) {
    return jwt.sign(
        {
            sub: user.id,
            uuid: user.uuid,
            username: user.username,
            email: user.email,
            account_type: user.account_type,
            account_permissions: user.account_permissions,
            jti: crypto.randomBytes(16).toString('hex'),
        },
        config.jwtSecret,
        { expiresIn: config.jwtExpiresIn }
    );
}

function verifyToken(token) {
    try {
        return jwt.verify(token, config.jwtSecret);
    } catch (e) {
        return null;
    }
}

function authRequired(req, res, next) {
    const header = req.headers['authorization'] || '';
    const bearer = header.startsWith('Bearer ') ? header.slice(7) : null;
    const token = bearer || req.query.token || null;
    if (!token) return res.status(401).json({ detail: 'Authentication required' });

    const decoded = verifyToken(token);
    if (!decoded) return res.status(401).json({ detail: 'Invalid or expired token' });

    const session = db.prepare('SELECT revoked, expires_at FROM sessions WHERE token = ?').get(token);
    if (!session || session.revoked) return res.status(401).json({ detail: 'Session revoked' });
    if (session.expires_at < Date.now()) return res.status(401).json({ detail: 'Session expired' });

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(decoded.sub);
    if (!user || user.banned) return res.status(403).json({ detail: 'Account unavailable' });

    req.user = user;
    req.token = token;
    next();
}

function requireRole(minRank) {
    const ranks = { User: 0, VIP: 1, Partner: 2, Beta: 3, UnlockAll: 4, Admin: 5, Owner: 6 };
    return (req, res, next) => {
        const perms = String(req.user.account_permissions || req.user.account_type || 'User');
        const rank = ranks[perms] !== undefined ? ranks[perms] : 0;
        if (rank < (ranks[minRank] || 0)) {
            return res.status(403).json({ detail: 'Insufficient permissions' });
        }
        next();
    };
}

module.exports = { signToken, verifyToken, authRequired, requireRole };