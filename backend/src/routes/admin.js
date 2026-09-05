'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const db = require('../db/init');
const { authRequired, requireRole } = require('../middleware/auth');
const { ok, bad, notFound, asyncHandler, parseBody } = require('../utils/http');
const { randomToken, slugify } = require('../utils/crypto');

const router = express.Router();

router.use(authRequired, requireRole('Admin'));

const DOWNLOADS_DIR = path.resolve(__dirname, '..', '..', 'data', 'downloads');
if (!fs.existsSync(DOWNLOADS_DIR)) fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });

const launcherUpload = multer({
    storage: multer.diskStorage({
        destination: DOWNLOADS_DIR,
        filename: (req, file, cb) => {
            const platform = String(req.body.platform || 'windows').toLowerCase();
            const safe = platform === 'windows' ? 'UCHIHA-Launcher.exe'
                       : platform === 'macos' ? 'UCHIHA-Launcher-macOS'
                       : 'UCHIHA-Launcher-linux';
            cb(null, safe);
        },
    }),
    limits: { fileSize: 200 * 1024 * 1024 },
});

const productFileUpload = multer({
    storage: multer.diskStorage({
        destination: DOWNLOADS_DIR,
        filename: (req, file, cb) => {
            const pid = String(req.body.product_id || 'new');
            const ext = path.extname(file.originalname) || '.bin';
            cb(null, 'product-' + pid + ext);
        },
    }),
    limits: { fileSize: 500 * 1024 * 1024 },
});

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
        lc_balance: u.lc_balance || 0,
        user_discord_user_coin_amount: u.user_discord_user_coin_amount || 0,
        member_since: u.member_since,
        last_login: u.last_login,
        banned: !!u.banned,
    };
}

router.get('/stats', (req, res) => {
    const totalUsers = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
    const bannedUsers = db.prepare('SELECT COUNT(*) as c FROM users WHERE banned = 1').get().c;
    const totalOrders = db.prepare('SELECT COUNT(*) as c FROM orders').get().c;
    const totalRevenue = db.prepare(`SELECT COALESCE(SUM(amount),0) as s FROM orders WHERE currency = 'USD' AND status = 'completed'`).get().s;
    const totalCoupons = db.prepare('SELECT COUNT(*) as c FROM coupons').get().c;
    const activeCoupons = db.prepare('SELECT COUNT(*) as c FROM coupons WHERE active = 1').get().c;
    const totalProducts = db.prepare('SELECT COUNT(*) as c FROM products').get().c;
    const totalReviews = db.prepare('SELECT COUNT(*) as c FROM reviews').get().c;
    const totalForum = db.prepare('SELECT COUNT(*) as c FROM forum_posts').get().c;
    const recentUsers = db.prepare('SELECT id, username, email, account_type, account_permissions, created_at FROM users ORDER BY id DESC LIMIT 8').all();
    const recentOrders = db.prepare(`
        SELECT o.id, o.amount, o.currency, o.status, o.created_at, u.username, p.title
        FROM orders o
        LEFT JOIN users u ON u.id = o.user_id
        LEFT JOIN products p ON p.id = o.product_id
        ORDER BY o.id DESC LIMIT 8
    `).all();
    res.json({
        totalUsers, bannedUsers, totalOrders, totalRevenue, totalCoupons, activeCoupons,
        totalProducts, totalReviews, totalForum,
        recentUsers, recentOrders,
    });
});

router.get('/users', (req, res) => {
    const q = String(req.query.q || '').trim().toLowerCase();
    let rows;
    if (q) {
        rows = db.prepare(`
            SELECT * FROM users
            WHERE LOWER(username) LIKE ? OR LOWER(email) LIKE ? OR CAST(id AS TEXT) = ?
            ORDER BY id DESC LIMIT 200
        `).all('%' + q + '%', '%' + q + '%', q);
    } else {
        rows = db.prepare('SELECT * FROM users ORDER BY id DESC LIMIT 200').all();
    }
    res.json({ users: rows.map(publicUser) });
});

router.get('/users/:id', (req, res) => {
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(parseInt(req.params.id, 10));
    if (!u) return notFound(res);
    const orders = db.prepare(`
        SELECT o.*, p.title FROM orders o
        LEFT JOIN products p ON p.id = o.product_id
        WHERE o.user_id = ? ORDER BY o.id DESC LIMIT 50
    `).all(u.id);
    const notes = db.prepare(`
        SELECT n.*, a.username as author_name FROM user_notes n
        LEFT JOIN users a ON a.id = n.author_id
        WHERE n.user_id = ? ORDER BY n.id DESC LIMIT 50
    `).all(u.id);
    res.json({ user: publicUser(u), orders, notes });
});

router.post('/users/:id/update', (req, res) => {
    const id = parseInt(req.params.id, 10);
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!u) return notFound(res);
    const b = parseBody(req);
    const updates = [];
    const values = [];
    const allowed = ['email', 'phone', 'lc_balance', 'user_discord_user_coin_amount', 'account_type', 'account_permissions'];
    for (const k of allowed) {
        if (b[k] !== undefined) { updates.push(k + ' = ?'); values.push(b[k]); }
    }
    if (b.banned !== undefined) { updates.push('banned = ?'); values.push(b.banned ? 1 : 0); }
    if (updates.length) {
        values.push(id);
        db.prepare('UPDATE users SET ' + updates.join(', ') + ' WHERE id = ?').run(...values);
    }
    if (b.note) {
        db.prepare('INSERT INTO user_notes (user_id, author_id, body, created_at) VALUES (?, ?, ?, ?)')
            .run(id, req.user.id, String(b.note), Date.now());
    }
    const fresh = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    res.json(publicUser(fresh));
});

router.post('/users/:id/ban', (req, res) => {
    const id = parseInt(req.params.id, 10);
    db.prepare('UPDATE users SET banned = 1 WHERE id = ?').run(id);
    db.prepare('UPDATE sessions SET revoked = 1 WHERE user_id = ?').run(id);
    db.prepare('INSERT INTO audit_log (user_id, action, ip, created_at) VALUES (?, ?, ?, ?)')
        .run(req.user.id, 'ban_user:' + id, req.ip, Date.now());
    res.json({ ok: true });
});

router.post('/users/:id/unban', (req, res) => {
    const id = parseInt(req.params.id, 10);
    db.prepare('UPDATE users SET banned = 0 WHERE id = ?').run(id);
    db.prepare('INSERT INTO audit_log (user_id, action, ip, created_at) VALUES (?, ?, ?, ?)')
        .run(req.user.id, 'unban_user:' + id, req.ip, Date.now());
    res.json({ ok: true });
});

router.post('/users/:id/grant_lc', (req, res) => {
    const id = parseInt(req.params.id, 10);
    const amount = parseInt((parseBody(req)).amount, 10) || 0;
    if (!amount) return bad(res, 'amount required');
    db.prepare('UPDATE users SET lc_balance = lc_balance + ? WHERE id = ?').run(amount, id);
    db.prepare('INSERT INTO audit_log (user_id, action, ip, created_at) VALUES (?, ?, ?, ?)')
        .run(req.user.id, 'grant_lc:' + id + ':' + amount, req.ip, Date.now());
    const fresh = db.prepare('SELECT lc_balance FROM users WHERE id = ?').get(id);
    res.json({ ok: true, lc_balance: fresh.lc_balance });
});

router.get('/products', (req, res) => {
    const rows = db.prepare('SELECT * FROM products ORDER BY id DESC LIMIT 500').all();
    res.json({ products: rows });
});

router.post('/products/create', (req, res) => {
    const b = parseBody(req);
    if (!b.title) return bad(res, 'title required');
    const now = Date.now();
    const slug = b.slug || slugify(b.title);
    const info = db.prepare(`
        INSERT INTO products (title, slug, description, full_description, category, price, image_url, partner, popular, is_new, stock, min_role, product_type, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        b.title, slug, b.description || null, b.full_description || null,
        b.category || 'General Tools',
        parseFloat(b.price) || 0,
        b.image_url || null,
        b.partner || null,
        b.popular ? 1 : 0, b.is_new ? 1 : 0,
        parseInt(b.stock, 10) || -1,
        b.min_role || 'User',
        b.product_type || 'Tool',
        now
    );
    db.prepare('INSERT INTO audit_log (user_id, action, ip, created_at) VALUES (?, ?, ?, ?)')
        .run(req.user.id, 'create_product:' + info.lastInsertRowid, req.ip, now);
    res.json({ id: info.lastInsertRowid });
});

router.post('/products/:id/update', (req, res) => {
    const id = parseInt(req.params.id, 10);
    const b = parseBody(req);
    const allowed = ['title', 'description', 'full_description', 'category', 'price', 'image_url', 'partner', 'popular', 'is_new', 'stock', 'min_role', 'product_type'];
    const booleanKeys = ['popular', 'is_new'];
    const updates = []; const values = [];
    for (const k of allowed) {
        if (b[k] !== undefined) {
            updates.push(k + ' = ?');
            if (booleanKeys.includes(k)) values.push(b[k] ? 1 : 0);
            else values.push(b[k]);
        }
    }
    if (!updates.length) return bad(res, 'no fields');
    values.push(id);
    db.prepare('UPDATE products SET ' + updates.join(', ') + ' WHERE id = ?').run(...values);
    db.prepare('INSERT INTO audit_log (user_id, action, ip, created_at) VALUES (?, ?, ?, ?)')
        .run(req.user.id, 'update_product:' + id, req.ip, Date.now());
    res.json({ ok: true });
});

router.post('/products/:id/delete', (req, res) => {
    const id = parseInt(req.params.id, 10);
    db.prepare('DELETE FROM products WHERE id = ?').run(id);
    db.prepare('INSERT INTO audit_log (user_id, action, ip, created_at) VALUES (?, ?, ?, ?)')
        .run(req.user.id, 'delete_product:' + id, req.ip, Date.now());
    res.json({ ok: true });
});

router.post('/products/:id/upload_file', authRequired, requireRole('Admin'), productFileUpload.single('file'), asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
    if (!product) return notFound(res, 'Product not found');
    if (!req.file) return bad(res, 'No file uploaded');
    const url = '/api/downloads/' + path.basename(req.file.filename);
    db.prepare('UPDATE products SET file_url = ?, file_name = ? WHERE id = ?')
        .run(url, req.file.originalname, id);
    db.prepare('INSERT INTO audit_log (user_id, action, ip, created_at) VALUES (?, ?, ?, ?)')
        .run(req.user.id, 'upload_product_file:' + id, req.ip, Date.now());
    res.json({ ok: true, file_url: url, file_name: req.file.originalname });
}));

router.post('/products/:id/remove_file', authRequired, requireRole('Admin'), asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
    if (!product) return notFound(res, 'Product not found');
    if (product.file_url) {
        const filename = path.basename(product.file_url);
        const fp = path.join(DOWNLOADS_DIR, filename);
        if (fs.existsSync(fp)) { try { fs.unlinkSync(fp); } catch (e) {} }
    }
    db.prepare('UPDATE products SET file_url = NULL, file_name = NULL WHERE id = ?').run(id);
    db.prepare('INSERT INTO audit_log (user_id, action, ip, created_at) VALUES (?, ?, ?, ?)')
        .run(req.user.id, 'remove_product_file:' + id, req.ip, Date.now());
    res.json({ ok: true });
}));

router.get('/coupons', (req, res) => {
    const rows = db.prepare('SELECT * FROM coupons ORDER BY id DESC LIMIT 500').all();
    res.json({ coupons: rows });
});

router.post('/coupons/create', (req, res) => {
    const b = parseBody(req);
    if (!b.code) return bad(res, 'code required');
    const existing = db.prepare('SELECT id FROM coupons WHERE code = ?').get(String(b.code).toUpperCase());
    if (existing) return bad(res, 'coupon code already exists');
    const info = db.prepare(`
        INSERT INTO coupons (code, discount_percent, discount_amount, max_uses, min_role, product_id, expires_at, active, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        String(b.code).toUpperCase(),
        parseInt(b.discount_percent, 10) || 0,
        parseFloat(b.discount_amount) || 0,
        parseInt(b.max_uses, 10) || -1,
        b.min_role || 'User',
        b.product_id ? parseInt(b.product_id, 10) : null,
        b.expires_at ? parseInt(b.expires_at, 10) : null,
        b.active === false ? 0 : 1,
        req.user.id,
        Date.now()
    );
    db.prepare('INSERT INTO audit_log (user_id, action, ip, created_at) VALUES (?, ?, ?, ?)')
        .run(req.user.id, 'create_coupon:' + info.lastInsertRowid, req.ip, Date.now());
    res.json({ id: info.lastInsertRowid });
});

router.post('/coupons/:id/update', (req, res) => {
    const id = parseInt(req.params.id, 10);
    const b = parseBody(req);
    const allowed = ['discount_percent', 'discount_amount', 'max_uses', 'min_role', 'product_id', 'expires_at', 'active'];
    const booleanKeys = ['active'];
    const updates = []; const values = [];
    for (const k of allowed) {
        if (b[k] !== undefined) {
            updates.push(k + ' = ?');
            values.push(booleanKeys.includes(k) ? (b[k] ? 1 : 0) : b[k]);
        }
    }
    if (!updates.length) return bad(res, 'no fields');
    values.push(id);
    db.prepare('UPDATE coupons SET ' + updates.join(', ') + ' WHERE id = ?').run(...values);
    db.prepare('INSERT INTO audit_log (user_id, action, ip, created_at) VALUES (?, ?, ?, ?)')
        .run(req.user.id, 'update_coupon:' + id, req.ip, Date.now());
    res.json({ ok: true });
});

router.post('/coupons/:id/delete', (req, res) => {
    const id = parseInt(req.params.id, 10);
    db.prepare('DELETE FROM coupons WHERE id = ?').run(id);
    db.prepare('INSERT INTO audit_log (user_id, action, ip, created_at) VALUES (?, ?, ?, ?)')
        .run(req.user.id, 'delete_coupon:' + id, req.ip, Date.now());
    res.json({ ok: true });
});

router.get('/bank_packs', (req, res) => {
    const rows = db.prepare('SELECT * FROM bank_packs ORDER BY price ASC').all();
    res.json({ packs: rows });
});

router.post('/bank_packs/create', (req, res) => {
    const b = parseBody(req);
    if (!b.name || !b.price) return bad(res, 'name and price required');
    const info = db.prepare(`
        INSERT INTO bank_packs (name, description, price, lc_amount, badge, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
    `).run(b.name, b.description || null, parseFloat(b.price) || 0, parseInt(b.lc_amount, 10) || 0, b.badge || null, Date.now());
    res.json({ id: info.lastInsertRowid });
});

router.post('/bank_packs/:id/update', (req, res) => {
    const id = parseInt(req.params.id, 10);
    const b = parseBody(req);
    const allowed = ['name', 'description', 'price', 'lc_amount', 'badge'];
    const updates = []; const values = [];
    for (const k of allowed) {
        if (b[k] !== undefined) { updates.push(k + ' = ?'); values.push(b[k]); }
    }
    if (!updates.length) return bad(res, 'no fields');
    values.push(id);
    db.prepare('UPDATE bank_packs SET ' + updates.join(', ') + ' WHERE id = ?').run(...values);
    res.json({ ok: true });
});

router.post('/bank_packs/:id/delete', (req, res) => {
    db.prepare('DELETE FROM bank_packs WHERE id = ?').run(parseInt(req.params.id, 10));
    res.json({ ok: true });
});

router.get('/settings', (req, res) => {
    const rows = db.prepare('SELECT * FROM settings').all();
    const obj = {};
    for (const r of rows) obj[r.key] = r.value;
    res.json(obj);
});

router.post('/settings/update', (req, res) => {
    const b = parseBody(req);
    const upsert = db.prepare(`
        INSERT INTO settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by
    `);
    const tx = db.transaction((entries) => {
        const now = Date.now();
        for (const [k, v] of entries) upsert.run(k, String(v), now, req.user.id);
    });
    tx(Object.entries(b));
    db.prepare('INSERT INTO audit_log (user_id, action, ip, created_at) VALUES (?, ?, ?, ?)')
        .run(req.user.id, 'update_settings', req.ip, Date.now());
    res.json({ ok: true });
});

router.get('/audit_log', (req, res) => {
    const rows = db.prepare(`
        SELECT a.*, u.username FROM audit_log a
        LEFT JOIN users u ON u.id = a.user_id
        ORDER BY a.id DESC LIMIT 200
    `).all();
    res.json({ log: rows });
});

router.get('/orders', (req, res) => {
    const rows = db.prepare(`
        SELECT o.*, u.username, p.title FROM orders o
        LEFT JOIN users u ON u.id = o.user_id
        LEFT JOIN products p ON p.id = o.product_id
        ORDER BY o.id DESC LIMIT 200
    `).all();
    res.json({ orders: rows });
});

router.get('/forum', (req, res) => {
    const rows = db.prepare(`
        SELECT p.*, u.username FROM forum_posts p
        LEFT JOIN users u ON u.id = p.user_id
        ORDER BY p.id DESC LIMIT 200
    `).all();
    res.json({ posts: rows });
});

router.post('/forum/:id/delete', (req, res) => {
    db.prepare('DELETE FROM forum_posts WHERE id = ?').run(parseInt(req.params.id, 10));
    db.prepare('INSERT INTO audit_log (user_id, action, ip, created_at) VALUES (?, ?, ?, ?)')
        .run(req.user.id, 'delete_forum_post:' + req.params.id, req.ip, Date.now());
    res.json({ ok: true });
});

router.post('/forum/:id/pin', (req, res) => {
    const id = parseInt(req.params.id, 10);
    const cur = db.prepare('SELECT pinned FROM forum_posts WHERE id = ?').get(id);
    if (!cur) return notFound(res);
    db.prepare('UPDATE forum_posts SET pinned = ? WHERE id = ?').run(cur.pinned ? 0 : 1, id);
    res.json({ ok: true });
});

router.get('/news', (req, res) => {
    const rows = db.prepare('SELECT * FROM news_posts ORDER BY id DESC LIMIT 200').all();
    res.json({ news: rows });
});

router.post('/news/create', (req, res) => {
    const { title, body, image_url } = parseBody(req);
    if (!title) return bad(res, 'title required');
    const info = db.prepare(`
        INSERT INTO news_posts (title, body, image_url, created_at) VALUES (?, ?, ?, ?)
    `).run(title, body || null, image_url || null, Date.now());
    res.json({ id: info.lastInsertRowid });
});

router.post('/news/:id/update', (req, res) => {
    const id = parseInt(req.params.id, 10);
    const b = parseBody(req);
    const allowed = ['title', 'body', 'image_url'];
    const updates = []; const values = [];
    for (const k of allowed) if (b[k] !== undefined) { updates.push(k + ' = ?'); values.push(b[k]); }
    if (!updates.length) return bad(res, 'no fields');
    values.push(id);
    db.prepare('UPDATE news_posts SET ' + updates.join(', ') + ' WHERE id = ?').run(...values);
    res.json({ ok: true });
});

router.post('/news/:id/delete', (req, res) => {
    db.prepare('DELETE FROM news_posts WHERE id = ?').run(parseInt(req.params.id, 10));
    res.json({ ok: true });
});

router.get('/qa', (req, res) => {
    const rows = db.prepare('SELECT * FROM qa_entries ORDER BY sort_order ASC, id ASC').all();
    res.json({ qa: rows });
});

router.post('/qa/create', (req, res) => {
    const { question, answer, category, sort_order } = parseBody(req);
    if (!question) return bad(res, 'question required');
    const info = db.prepare(`
        INSERT INTO qa_entries (question, answer, category, sort_order) VALUES (?, ?, ?, ?)
    `).run(question, answer || null, category || null, parseInt(sort_order, 10) || 0);
    res.json({ id: info.lastInsertRowid });
});

router.post('/qa/:id/update', (req, res) => {
    const id = parseInt(req.params.id, 10);
    const b = parseBody(req);
    const allowed = ['question', 'answer', 'category', 'sort_order'];
    const updates = []; const values = [];
    for (const k of allowed) if (b[k] !== undefined) { updates.push(k + ' = ?'); values.push(b[k]); }
    if (!updates.length) return bad(res, 'no fields');
    values.push(id);
    db.prepare('UPDATE qa_entries SET ' + updates.join(', ') + ' WHERE id = ?').run(...values);
    res.json({ ok: true });
});

router.post('/qa/:id/delete', (req, res) => {
    db.prepare('DELETE FROM qa_entries WHERE id = ?').run(parseInt(req.params.id, 10));
    res.json({ ok: true });
});

router.get('/partners', (req, res) => {
    const rows = db.prepare('SELECT * FROM partners ORDER BY id ASC').all();
    res.json({ partners: rows });
});

router.post('/partners/create', (req, res) => {
    const { name, description, url, logo_url, discord } = parseBody(req);
    if (!name) return bad(res, 'name required');
    const info = db.prepare(`
        INSERT INTO partners (name, description, url, logo_url, discord, created_at) VALUES (?, ?, ?, ?, ?, ?)
    `).run(name, description || null, url || null, logo_url || null, discord || null, Date.now());
    res.json({ id: info.lastInsertRowid });
});

router.post('/partners/:id/update', (req, res) => {
    const id = parseInt(req.params.id, 10);
    const b = parseBody(req);
    const allowed = ['name', 'description', 'url', 'logo_url', 'discord'];
    const updates = []; const values = [];
    for (const k of allowed) if (b[k] !== undefined) { updates.push(k + ' = ?'); values.push(b[k]); }
    if (!updates.length) return bad(res, 'no fields');
    values.push(id);
    db.prepare('UPDATE partners SET ' + updates.join(', ') + ' WHERE id = ?').run(...values);
    res.json({ ok: true });
});

router.post('/partners/:id/delete', (req, res) => {
    db.prepare('DELETE FROM partners WHERE id = ?').run(parseInt(req.params.id, 10));
    res.json({ ok: true });
});

router.get('/audit_log', (req, res) => {
    const rows = db.prepare(`
        SELECT a.*, u.username FROM audit_log a
        LEFT JOIN users u ON u.id = a.user_id
        ORDER BY a.id DESC LIMIT 200
    `).all();
    res.json({ log: rows });
});

router.get('/orders', (req, res) => {
    const rows = db.prepare(`
        SELECT o.*, u.username, p.title FROM orders o
        LEFT JOIN users u ON u.id = o.user_id
        LEFT JOIN products p ON p.id = o.product_id
        ORDER BY o.id DESC LIMIT 200
    `).all();
    res.json({ orders: rows });
});

router.get('/forum', (req, res) => {
    const rows = db.prepare(`
        SELECT p.*, u.username FROM forum_posts p
        LEFT JOIN users u ON u.id = p.user_id
        ORDER BY p.id DESC LIMIT 200
    `).all();
    res.json({ posts: rows });
});

router.post('/forum/:id/delete', (req, res) => {
    db.prepare('DELETE FROM forum_posts WHERE id = ?').run(parseInt(req.params.id, 10));
    db.prepare('INSERT INTO audit_log (user_id, action, ip, created_at) VALUES (?, ?, ?, ?)')
        .run(req.user.id, 'delete_forum_post:' + req.params.id, req.ip, Date.now());
    res.json({ ok: true });
});

router.post('/forum/:id/pin', (req, res) => {
    const id = parseInt(req.params.id, 10);
    const cur = db.prepare('SELECT pinned FROM forum_posts WHERE id = ?').get(id);
    if (!cur) return notFound(res);
    db.prepare('UPDATE forum_posts SET pinned = ? WHERE id = ?').run(cur.pinned ? 0 : 1, id);
    res.json({ ok: true });
});

router.get('/news', (req, res) => {
    const rows = db.prepare('SELECT * FROM news_posts ORDER BY id DESC LIMIT 200').all();
    res.json({ news: rows });
});

router.post('/news/create', (req, res) => {
    const { title, body, image_url } = parseBody(req);
    if (!title) return bad(res, 'title required');
    const info = db.prepare(`
        INSERT INTO news_posts (title, body, image_url, created_at) VALUES (?, ?, ?, ?)
    `).run(title, body || null, image_url || null, Date.now());
    res.json({ id: info.lastInsertRowid });
});

router.post('/news/:id/update', (req, res) => {
    const id = parseInt(req.params.id, 10);
    const b = parseBody(req);
    const allowed = ['title', 'body', 'image_url'];
    const updates = []; const values = [];
    for (const k of allowed) if (b[k] !== undefined) { updates.push(k + ' = ?'); values.push(b[k]); }
    if (!updates.length) return bad(res, 'no fields');
    values.push(id);
    db.prepare('UPDATE news_posts SET ' + updates.join(', ') + ' WHERE id = ?').run(...values);
    res.json({ ok: true });
});

router.post('/news/:id/delete', (req, res) => {
    db.prepare('DELETE FROM news_posts WHERE id = ?').run(parseInt(req.params.id, 10));
    res.json({ ok: true });
});

router.get('/qa', (req, res) => {
    const rows = db.prepare('SELECT * FROM qa_entries ORDER BY sort_order ASC, id ASC').all();
    res.json({ qa: rows });
});

router.post('/qa/create', (req, res) => {
    const { question, answer, category, sort_order } = parseBody(req);
    if (!question) return bad(res, 'question required');
    const info = db.prepare(`
        INSERT INTO qa_entries (question, answer, category, sort_order) VALUES (?, ?, ?, ?)
    `).run(question, answer || null, category || null, parseInt(sort_order, 10) || 0);
    res.json({ id: info.lastInsertRowid });
});

router.post('/qa/:id/update', (req, res) => {
    const id = parseInt(req.params.id, 10);
    const b = parseBody(req);
    const allowed = ['question', 'answer', 'category', 'sort_order'];
    const updates = []; const values = [];
    for (const k of allowed) if (b[k] !== undefined) { updates.push(k + ' = ?'); values.push(b[k]); }
    if (!updates.length) return bad(res, 'no fields');
    values.push(id);
    db.prepare('UPDATE qa_entries SET ' + updates.join(', ') + ' WHERE id = ?').run(...values);
    res.json({ ok: true });
});

router.post('/qa/:id/delete', (req, res) => {
    db.prepare('DELETE FROM qa_entries WHERE id = ?').run(parseInt(req.params.id, 10));
    res.json({ ok: true });
});

router.get('/partners', (req, res) => {
    const rows = db.prepare('SELECT * FROM partners ORDER BY id ASC').all();
    res.json({ partners: rows });
});

router.post('/partners/create', (req, res) => {
    const { name, description, url, logo_url, discord } = parseBody(req);
    if (!name) return bad(res, 'name required');
    const info = db.prepare(`
        INSERT INTO partners (name, description, url, logo_url, discord, created_at) VALUES (?, ?, ?, ?, ?, ?)
    `).run(name, description || null, url || null, logo_url || null, discord || null, Date.now());
    res.json({ id: info.lastInsertRowid });
});

router.post('/partners/:id/update', (req, res) => {
    const id = parseInt(req.params.id, 10);
    const b = parseBody(req);
    const allowed = ['name', 'description', 'url', 'logo_url', 'discord'];
    const updates = []; const values = [];
    for (const k of allowed) if (b[k] !== undefined) { updates.push(k + ' = ?'); values.push(b[k]); }
    if (!updates.length) return bad(res, 'no fields');
    values.push(id);
    db.prepare('UPDATE partners SET ' + updates.join(', ') + ' WHERE id = ?').run(...values);
    res.json({ ok: true });
});

router.post('/partners/:id/delete', (req, res) => {
    db.prepare('DELETE FROM partners WHERE id = ?').run(parseInt(req.params.id, 10));
    res.json({ ok: true });
});

router.get('/maintenance', (req, res) => {
    const rows = db.prepare('SELECT * FROM maintenance_status').all();
    res.json({ statuses: rows });
});

router.post('/maintenance/update', (req, res) => {
    const { product_key, status, message } = parseBody(req);
    if (!product_key || !status) return bad(res, 'product_key and status required');
    db.prepare(`
        INSERT INTO maintenance_status (product_key, status, message, updated_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(product_key) DO UPDATE SET status = excluded.status, message = excluded.message, updated_at = excluded.updated_at
    `).run(product_key, status, message || null, Date.now());
    res.json({ ok: true });
});

router.get('/maintenance_categories', (req, res) => {
    const rows = db.prepare(`
        SELECT id, slug, title, description, enabled, reason, sort_order, updated_at
        FROM maintenance_categories
        ORDER BY sort_order ASC, id ASC
    `).all();
    res.json({
        categories: rows.map(r => ({
            ...r,
            enabled: !!r.enabled,
        })),
    });
});

router.post('/maintenance_categories/create', (req, res) => {
    const b = parseBody(req);
    const slug = String(b.slug || '').trim().toLowerCase();
    const title = String(b.title || '').trim();
    if (!slug || !title) return bad(res, 'slug and title are required');
    if (!/^[a-z0-9_-]{1,64}$/.test(slug)) return bad(res, 'slug must be lowercase letters, numbers, dash or underscore (1-64 chars)');
    const existing = db.prepare('SELECT id FROM maintenance_categories WHERE slug = ?').get(slug);
    if (existing) return bad(res, 'slug already exists', 409);
    const now = Date.now();
    const info = db.prepare(`
        INSERT INTO maintenance_categories (slug, title, description, enabled, reason, sort_order, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
        slug,
        title,
        b.description ? String(b.description) : null,
        (b.enabled === true || b.enabled === 1 || b.enabled === 'true' || b.enabled === '1') ? 1 : 0,
        b.reason ? String(b.reason) : null,
        Number(b.sort_order || 0) | 0,
        now
    );
    res.json({ ok: true, id: info.lastInsertRowid });
});

router.post('/maintenance_categories/:id/update', (req, res) => {
    const id = Number(req.params.id);
    if (!id) return bad(res, 'invalid id');
    const b = parseBody(req);
    const row = db.prepare('SELECT * FROM maintenance_categories WHERE id = ?').get(id);
    if (!row) return notFound(res, 'category not found');
    const title = b.title !== undefined ? String(b.title).trim() : row.title;
    const description = b.description !== undefined ? (b.description ? String(b.description) : null) : row.description;
    const enabled = b.enabled !== undefined
        ? (b.enabled === true || b.enabled === 1 || b.enabled === 'true' || b.enabled === '1' ? 1 : 0)
        : row.enabled;
    const reason = b.reason !== undefined ? (b.reason ? String(b.reason) : null) : row.reason;
    const sortOrder = b.sort_order !== undefined ? (Number(b.sort_order) | 0) : row.sort_order;
    db.prepare(`
        UPDATE maintenance_categories
        SET title = ?, description = ?, enabled = ?, reason = ?, sort_order = ?, updated_at = ?
        WHERE id = ?
    `).run(title, description, enabled, reason, sortOrder, Date.now(), id);
    res.json({ ok: true });
});

router.post('/maintenance_categories/:id/toggle', (req, res) => {
    const id = Number(req.params.id);
    if (!id) return bad(res, 'invalid id');
    const row = db.prepare('SELECT * FROM maintenance_categories WHERE id = ?').get(id);
    if (!row) return notFound(res, 'category not found');
    const newVal = row.enabled ? 0 : 1;
    const b = parseBody(req);
    const reason = b.reason !== undefined ? (b.reason ? String(b.reason) : null) : row.reason;
    db.prepare('UPDATE maintenance_categories SET enabled = ?, reason = ?, updated_at = ? WHERE id = ?')
        .run(newVal, reason, Date.now(), id);
    res.json({ ok: true, enabled: !!newVal });
});

router.post('/maintenance_categories/:id/delete', (req, res) => {
    const id = Number(req.params.id);
    if (!id) return bad(res, 'invalid id');
    db.prepare('DELETE FROM maintenance_categories WHERE id = ?').run(id);
    res.json({ ok: true });
});

function upsertSetting(key, value) {
    db.prepare(`
        INSERT INTO settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by
    `).run(key, String(value), Date.now(), null);
}

router.get('/launcher', (req, res) => {
    const settings = db.prepare("SELECT key, value FROM settings WHERE key IN ('launcher_version','launcher_changelog','launcher_required_role')").all();
    const obj = {};
    for (const r of settings) obj[r.key] = r.value;
    db.prepare(`CREATE TABLE IF NOT EXISTS launcher_downloads (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        platform TEXT NOT NULL,
        version TEXT,
        ip TEXT,
        user_agent TEXT,
        created_at INTEGER NOT NULL
    )`).run();
    const stats = db.prepare(`
        SELECT platform, COUNT(*) as count, MAX(created_at) as last_at
        FROM launcher_downloads
        GROUP BY platform
    `).all();
    const platforms = ['windows', 'macos', 'linux'];
    const fileInfo = {};
    for (const p of platforms) {
        const candidates = p === 'windows'
            ? ['UCHIHA-Launcher-portable.zip', 'UCHIHA-Launcher.exe']
            : [p === 'macos' ? 'UCHIHA-Launcher-macOS.zip' : 'UCHIHA-Launcher-linux.zip', p === 'macos' ? 'UCHIHA-Launcher-macOS' : 'UCHIHA-Launcher-linux'];
        let found = null;
        for (const n of candidates) {
            const fp = path.join(DOWNLOADS_DIR, n);
            if (fs.existsSync(fp)) { found = { fp, name: n }; break; }
        }
        if (found) {
            const stat = fs.statSync(found.fp);
            fileInfo[p] = { available: true, name: found.name, size_bytes: stat.size, uploaded_at: stat.mtimeMs };
        } else {
            fileInfo[p] = { available: false, name: null, size_bytes: 0, uploaded_at: null };
        }
    }
    res.json({
        version: obj.launcher_version || '1.0.0',
        changelog: obj.launcher_changelog || '',
        required_role: obj.launcher_required_role || 'User',
        files: fileInfo,
        stats: stats,
    });
});

router.post('/launcher/upload', launcherUpload.single('file'), (req, res) => {
    if (!req.file) return bad(res, 'file required (multipart field "file")');
    const { version, changelog, required_role } = parseBody(req);
    if (version !== undefined && version !== null && String(version) !== '') upsertSetting('launcher_version', String(version));
    if (changelog !== undefined) upsertSetting('launcher_changelog', String(changelog));
    if (required_role !== undefined && required_role !== null && String(required_role) !== '') upsertSetting('launcher_required_role', String(required_role));
    db.prepare('INSERT INTO audit_log (user_id, action, ip, created_at) VALUES (?, ?, ?, ?)')
        .run(req.user.id, 'launcher_upload:' + req.file.filename, req.ip, Date.now());
    res.json({
        ok: true,
        file: req.file.filename,
        size_bytes: req.file.size,
        version: version || null,
    });
});

router.post('/launcher/settings', (req, res) => {
    const b = parseBody(req);
    if (b.version) upsertSetting('launcher_version', b.version);
    if (b.changelog !== undefined) upsertSetting('launcher_changelog', b.changelog);
    if (b.required_role) upsertSetting('launcher_required_role', b.required_role);
    db.prepare('INSERT INTO audit_log (user_id, action, ip, created_at) VALUES (?, ?, ?, ?)')
        .run(req.user.id, 'launcher_settings_update', req.ip, Date.now());
    res.json({ ok: true });
});

router.get('/launcher/downloads', (req, res) => {
    db.prepare(`CREATE TABLE IF NOT EXISTS launcher_downloads (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        platform TEXT NOT NULL,
        version TEXT,
        ip TEXT,
        user_agent TEXT,
        created_at INTEGER NOT NULL
    )`).run();
    const limit = Math.min(parseInt(req.query.limit || '200', 10), 1000);
    const rows = db.prepare(`
        SELECT d.*, u.username
        FROM launcher_downloads d
        LEFT JOIN users u ON u.id = d.user_id
        ORDER BY d.id DESC
        LIMIT ?
    `).all(limit);
    res.json({ downloads: rows });
});

module.exports = router;