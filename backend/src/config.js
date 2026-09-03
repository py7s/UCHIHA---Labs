'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '..', '..', '.env') });

const crypto = require('crypto');

let requiredSecret = process.env.JWT_SECRET;
if (!requiredSecret || requiredSecret.length < 32) {
    console.warn('[config] WARNING: JWT_SECRET is missing or too short. Set a 32+ char random string in .env');
} else if (requiredSecret === 'change-this-to-a-long-random-string-please-rotate-me') {
    requiredSecret = crypto.randomBytes(48).toString('hex');
    console.warn('[config] Auto-generated temporary JWT_SECRET for this session. Set a permanent one in .env');
}

module.exports = {
    port: parseInt(process.env.PORT || '3000', 10),
    nodeEnv: process.env.NODE_ENV || 'development',
    jwtSecret: requiredSecret || 'dev-only-insecure-secret-please-rotate',
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
    frontendOrigin: process.env.FRONTEND_ORIGIN || 'http://localhost:8080',
    discord: {
        clientId: process.env.DISCORD_CLIENT_ID || '',
        clientSecret: process.env.DISCORD_CLIENT_SECRET || '',
        redirectUri: process.env.DISCORD_REDIRECT_URI || '',
        guildId: process.env.DISCORD_GUILD_ID || '',
        botToken: process.env.DISCORD_BOT_TOKEN || '',
    },
    rateLimit: {
        windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),
        max: parseInt(process.env.RATE_LIMIT_MAX || '120', 10),
    },
};