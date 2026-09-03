'use strict';

const express = require('express');
const db = require('../db/init');
const { authRequired } = require('../middleware/auth');
const { ok, bad, notFound, asyncHandler, parseBody } = require('../utils/http');
const { genLicenseKey } = require('../utils/crypto');

const router = express.Router();

function publicProduct(p) {
    return {
        id: p.id,
        title: p.title,
        slug: p.slug,
        description: p.description,
        full_description: p.full_description,
        category: p.category,
        price: p.price,
        image_url: p.image_url,
        partner: p.partner,
        popular: !!p.popular,
        is_new: !!p.is_new,
        stock: p.stock,
        min_role: p.min_role,
        product_type: p.product_type,
    };
}

router.get('/products', (req, res) => {
    const products = db.prepare('SELECT * FROM products ORDER BY id ASC').all();
    ok(res, { products: products.map(publicProduct) });
});

router.get('/reviews', (req, res) => {
    const reviews = db.prepare(`
        SELECT r.*, u.username, u.account_type, u.account_permissions, u.profile_picture, u.discord_avatar, u.avatar_decoration
        FROM reviews r
        LEFT JOIN users u ON u.id = r.user_id
        ORDER BY r.id DESC
        LIMIT 200
    `).all();
    ok(res, {
        reviews: reviews.map(r => ({
            id: r.id,
            product_id: r.product_id,
            rating: r.rating,
            title: r.title,
            body: r.body,
            likes: r.likes,
            created_at: r.created_at,
            username: r.username,
            account_type: r.account_type,
            account_permissions: r.account_permissions,
            profile_picture: r.profile_picture,
            discord_avatar: r.discord_avatar,
            avatar_decoration: r.avatar_decoration,
        })),
    });
});

router.post('/reviews/create', authRequired, asyncHandler(async (req, res) => {
    const { product_id, rating, title, body } = parseBody(req);
    if (!product_id || !rating) return bad(res, 'product_id and rating required');
    const r = parseInt(rating, 10);
    if (r < 1 || r > 5) return bad(res, 'rating must be 1-5');
    const exists = db.prepare('SELECT id FROM products WHERE id = ?').get(product_id);
    if (!exists) return notFound(res, 'Product not found');
    const info = db.prepare(`
        INSERT INTO reviews (user_id, product_id, rating, title, body, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
    `).run(req.user.id, product_id, r, title || null, body || null, Date.now());
    return ok(res, { id: info.lastInsertRowid });
}));

router.post('/reviews/like', authRequired, asyncHandler(async (req, res) => {
    const { id } = parseBody(req);
    if (!id) return bad(res, 'id required');
    db.prepare('UPDATE reviews SET likes = likes + 1 WHERE id = ?').run(id);
    return ok(res, { ok: true });
}));

router.post('/payment/create', authRequired, asyncHandler(async (req, res) => {
    const body = parseBody(req);
    const { product_id, payment_method, coupon_code, cart_items, coin, account_data } = body;

    const items = [];
    if (Array.isArray(cart_items) && cart_items.length > 0) {
        for (const ci of cart_items) {
            const pid = ci.product && (ci.product.id || ci.product.product_id);
            if (pid) items.push({ product_id: pid, qty: ci.qty || 1, name: ci.name, price: ci.price });
        }
    }
    if (product_id) items.push({ product_id, qty: 1 });

    if (items.length === 0) {
        return bad(res, 'product_id required (no items in cart)');
    }

    const isOwner = ['Owner', 'Admin'].includes(String(req.user.account_permissions || req.user.account_type || ''));
    const orders = [];
    for (const it of items) {
        const product = db.prepare('SELECT * FROM products WHERE id = ?').get(parseInt(it.product_id, 10));
        if (!product) return notFound(res, 'Product not found: ' + it.product_id);

        let finalAmount = isOwner ? 0 : product.price * (it.qty || 1);
        let appliedCoupon = null;
        if (coupon_code) {
            const coupon = db.prepare('SELECT * FROM coupons WHERE code = ?').get(String(coupon_code).toUpperCase());
            if (!coupon) return bad(res, 'Invalid coupon code', 400);
            if (!coupon.active) return bad(res, 'Coupon inactive', 400);
            if (coupon.expires_at && coupon.expires_at < Date.now()) return bad(res, 'Coupon expired', 400);
            if (coupon.max_uses !== -1 && coupon.used_count >= coupon.max_uses) return bad(res, 'Coupon usage limit reached', 400);
            if (coupon.product_id && coupon.product_id !== product.id) return bad(res, 'Coupon not valid for this product', 400);
            if (coupon.discount_percent > 0) {
                finalAmount = +(finalAmount * (1 - coupon.discount_percent / 100)).toFixed(2);
            } else if (coupon.discount_amount > 0) {
                finalAmount = Math.max(0, +(finalAmount - coupon.discount_amount).toFixed(2));
            }
            appliedCoupon = coupon;
        }

        const license = genLicenseKey();
        const info = db.prepare(`
            INSERT INTO orders (user_id, product_id, amount, currency, payment_method, status, license_key, created_at)
            VALUES (?, ?, ?, 'USD', ?, 'completed', ?, ?)
        `).run(req.user.id, product.id, finalAmount, payment_method || 'card', license, Date.now());

        if (appliedCoupon) {
            db.prepare('UPDATE coupons SET used_count = used_count + 1 WHERE id = ?').run(appliedCoupon.id);
            db.prepare('INSERT INTO coupon_redemptions (coupon_id, user_id, order_id, redeemed_at) VALUES (?, ?, ?, ?)')
                .run(appliedCoupon.id, req.user.id, info.lastInsertRowid, Date.now());
        }

        orders.push({
            order_id: info.lastInsertRowid,
            license_key: license,
            amount: finalAmount,
            original_amount: product.price * (it.qty || 1),
            discount_applied: appliedCoupon ? (product.price * (it.qty || 1) - finalAmount) : 0,
            coupon_code: appliedCoupon ? appliedCoupon.code : null,
            currency: 'USD',
            status: 'completed',
            product_id: product.id,
            product_title: product.title,
        });
    }

    return ok(res, {
        orders,
        amount: orders.reduce((s, o) => s + o.amount, 0),
        coupon_code: orders.find(o => o.coupon_code) ? orders.find(o => o.coupon_code).coupon_code : null,
        currency: 'USD',
        status: 'completed',
    });
}));

router.post('/payment/lc', authRequired, asyncHandler(async (req, res) => {
    const { product_id, lc_amount, coupon_code } = parseBody(req);
    let cost = parseInt(lc_amount, 10) || 0;
    if (!cost || cost < 1) return bad(res, 'lc_amount required');
    const isOwner = ['Owner', 'Admin'].includes(String(req.user.account_permissions || req.user.account_type || ''));
    if (coupon_code) {
        const coupon = db.prepare('SELECT * FROM coupons WHERE code = ?').get(String(coupon_code).toUpperCase());
        if (!coupon || !coupon.active) return bad(res, 'Invalid coupon', 400);
        if (coupon.expires_at && coupon.expires_at < Date.now()) return bad(res, 'Coupon expired', 400);
        if (coupon.max_uses !== -1 && coupon.used_count >= coupon.max_uses) return bad(res, 'Coupon limit reached', 400);
        if (coupon.product_id && coupon.product_id !== product_id) return bad(res, 'Coupon not valid for this product', 400);
        if (coupon.discount_percent > 0) cost = Math.max(1, Math.floor(cost * (1 - coupon.discount_percent / 100)));
        else if (coupon.discount_amount > 0) cost = Math.max(1, cost - Math.floor(coupon.discount_amount));
        db.prepare('UPDATE coupons SET used_count = used_count + 1 WHERE id = ?').run(coupon.id);
    }
    if (!isOwner && (req.user.lc_balance || 0) < cost) return bad(res, 'Insufficient LC balance', 402);
    const product = product_id ? db.prepare('SELECT * FROM products WHERE id = ?').get(product_id) : null;
    const license = product ? genLicenseKey() : null;
    if (product) {
        db.prepare(`
            INSERT INTO orders (user_id, product_id, amount, currency, payment_method, status, license_key, created_at)
            VALUES (?, ?, ?, 'LC', 'lc', 'completed', ?, ?)
        `).run(req.user.id, product.id, cost, license, Date.now());
    }
    if (!isOwner) {
        const r = db.prepare('UPDATE users SET lc_balance = lc_balance - ? WHERE id = ? AND lc_balance >= ?')
            .run(cost, req.user.id, cost);
        if (r.changes === 0) return bad(res, 'Insufficient LC balance', 402);
    }
    return ok(res, { ok: true, license_key: license, amount: cost });
}));

router.get('/forum', (req, res) => {
    const posts = db.prepare(`
        SELECT p.*, u.username, u.account_type, u.account_permissions, u.profile_picture, u.discord_avatar, u.avatar_decoration,
               (SELECT COUNT(*) FROM forum_comments c WHERE c.post_id = p.id) as comment_count
        FROM forum_posts p
        LEFT JOIN users u ON u.id = p.user_id
        ORDER BY p.pinned DESC, p.id DESC
        LIMIT 200
    `).all();
    const comments = db.prepare(`
        SELECT c.*, u.username, u.account_type, u.account_permissions, u.profile_picture, u.discord_avatar, u.avatar_decoration
        FROM forum_comments c
        LEFT JOIN users u ON u.id = c.user_id
        ORDER BY c.id ASC
        LIMIT 1000
    `).all();
    const replies = db.prepare(`
        SELECT r.*, u.username, u.account_type, u.account_permissions
        FROM forum_replies r
        LEFT JOIN users u ON u.id = r.user_id
        ORDER BY r.id ASC
        LIMIT 2000
    `).all();
    ok(res, { posts, comments, replies });
});

router.post('/forum/post', authRequired, asyncHandler(async (req, res) => {
    const { title, body, pinned, locked } = parseBody(req);
    if (!title) return bad(res, 'title required');
    const info =     db.prepare(`
        INSERT INTO forum_posts (user_id, title, body, pinned, locked, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
    `).run(req.user.id, title, body || null,
        (pinned === true || pinned === 1 || pinned === 'true' || pinned === '1') ? 1 : 0,
        (locked === true || locked === 1 || locked === 'true' || locked === '1') ? 1 : 0,
        Date.now());
    return ok(res, { id: info.lastInsertRowid });
}));

router.post('/forum/comment', authRequired, asyncHandler(async (req, res) => {
    const { post_id, body } = parseBody(req);
    if (!post_id || !body) return bad(res, 'post_id and body required');
    const info = db.prepare(`
        INSERT INTO forum_comments (post_id, user_id, body, created_at)
        VALUES (?, ?, ?, ?)
    `).run(post_id, req.user.id, body, Date.now());
    return ok(res, { id: info.lastInsertRowid });
}));

router.post('/forum/reply', authRequired, asyncHandler(async (req, res) => {
    const { comment_id, body } = parseBody(req);
    if (!comment_id || !body) return bad(res, 'comment_id and body required');
    const info = db.prepare(`
        INSERT INTO forum_replies (comment_id, user_id, body, created_at)
        VALUES (?, ?, ?, ?)
    `).run(comment_id, req.user.id, body, Date.now());
    return ok(res, { id: info.lastInsertRowid });
}));

router.post('/forum/like', authRequired, asyncHandler(async (req, res) => {
    const { id } = parseBody(req);
    if (!id) return bad(res, 'id required');
    db.prepare('UPDATE forum_posts SET likes = likes + 1 WHERE id = ?').run(id);
    return ok(res, { ok: true });
}));

router.post('/forum/comment/like', authRequired, asyncHandler(async (req, res) => {
    const { id } = parseBody(req);
    if (!id) return bad(res, 'id required');
    db.prepare('UPDATE forum_comments SET likes = likes + 1 WHERE id = ?').run(id);
    return ok(res, { ok: true });
}));

router.get('/orders', authRequired, asyncHandler(async (req, res) => {
    const rows = db.prepare(`
        SELECT o.*, p.title, p.category, p.image_url, p.product_type
        FROM orders o
        LEFT JOIN products p ON p.id = o.product_id
        WHERE o.user_id = ?
        ORDER BY o.id DESC LIMIT 200
    `).all(req.user.id);
    res.json({ orders: rows });
}));

router.get('/licenses', authRequired, asyncHandler(async (req, res) => {
    const rows = db.prepare(`
        SELECT o.id, o.license_key, o.amount, o.currency, o.status, o.created_at,
               p.title as product_name, p.product_type
        FROM orders o
        LEFT JOIN products p ON p.id = o.product_id
        WHERE o.user_id = ? AND o.license_key IS NOT NULL AND o.license_key != ''
        ORDER BY o.id DESC LIMIT 500
    `).all(req.user.id);
    const license_keys = rows.map(r => ({
        id: r.id,
        license_key: r.license_key,
        product_name: r.product_name,
        product_type: r.product_type,
        amount: r.amount,
        currency: r.currency,
        status: r.status,
        is_valid: r.status === 'completed',
        expires_at: 'Lifetime',
        duration: r.product_type || 'Tool',
        created_at: r.created_at,
    }));
    res.json({ license_keys });
}));

module.exports = router;