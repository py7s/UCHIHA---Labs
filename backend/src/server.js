'use strict';

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');

const config = require('./config');

const DB_FILE = process.env.DB_FILE || './data/uchiha.db';
const ABS_DB = path.resolve(process.cwd(), DB_FILE);
fs.mkdirSync(path.dirname(ABS_DB), { recursive: true });

(async () => {
    const { restoreFromRemote, startAutoBackup } = require('./db/persist');
    await restoreFromRemote(ABS_DB).catch(() => {});

    require('./db/init');
    const db = require('./db/init');
    startAutoBackup(db, ABS_DB);

    const authRoutes = require('./routes/auth');
    const discordRoutes = require('./routes/discord');
    const userRoutes = require('./routes/users');
    const contentRoutes = require('./routes/content');
    const adminRoutes = require('./routes/admin');
    const publicRoutes = require('./routes/public');

    const app = express();

    app.disable('x-powered-by');
    app.set('trust proxy', 1);

    app.use(helmet({
        contentSecurityPolicy: false,
        crossOriginEmbedderPolicy: false,
    }));
    app.use(cors({
        origin: (origin, cb) => {
            cb(null, true);
        },
        credentials: true,
    }));
    app.use(express.json({ limit: '2mb' }));
    app.use(express.urlencoded({ extended: true, limit: '2mb' }));
    app.use(cookieParser());

    const limiter = rateLimit({
        windowMs: config.rateLimit.windowMs,
        max: config.rateLimit.max,
        standardHeaders: true,
        legacyHeaders: false,
        message: { detail: 'Too many requests, please slow down.' },
    });
    app.use('/api/', limiter);

    app.get('/health', (req, res) => res.json({ ok: true, ts: Date.now() }));

    // After DB is initialized, restore profile-picture links from the
    // GitHub manifest. Runs in the background so it does not block
    // startup.
    setTimeout(() => {
        if (typeof userRoutes.syncManifestIntoDb === 'function') {
            userRoutes.syncManifestIntoDb().catch(() => {});
        }
    }, 1500);

    app.use('/api', authRoutes);
    app.use('/api/auth', discordRoutes);
    app.use('/api', userRoutes);
    app.use('/api', contentRoutes);
    app.use('/api', publicRoutes);
    app.use('/api/admin', adminRoutes);

    app.use((req, res) => res.status(404).json({ detail: 'Not found' }));
    app.use((err, req, res, next) => {
        if (err && (err.type === 'entity.parse.failed' || err.statusCode === 400)) {
            return res.status(400).json({ detail: 'Invalid JSON body' });
        }
        if (err && err.type === 'entity.too.large') {
            return res.status(413).json({ detail: 'Payload too large' });
        }
        if (err && err.code === 'LIMIT_FILE_SIZE') {
            return res.status(413).json({ detail: 'File too large' });
        }
        if (err && err.message && err.message.indexOf('Only PNG, JPG or WebP allowed') === 0) {
            return res.status(400).json({ detail: err.message });
        }
        console.error('[err]', err);
        res.status(500).json({ detail: 'Internal server error' });
    });

    module.exports = app;

    if (require.main === module) {
        app.listen(config.port, () => {
            console.log(`[uchiha-backend] listening on http://localhost:${config.port}`);
            console.log(`[uchiha-backend] env=${config.nodeEnv} frontend=${config.frontendOrigin}`);
        });
    }
})();
