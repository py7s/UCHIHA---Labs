'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');

const ENV_PATH = path.resolve(__dirname, '..', '..', '.env');
if (fs.existsSync(ENV_PATH)) {
    require('dotenv').config({ path: ENV_PATH });
}

const DB_FILE = process.env.DB_FILE || './data/uchiha.db';
const ABS_DB = path.resolve(process.cwd(), DB_FILE);
fs.mkdirSync(path.dirname(ABS_DB), { recursive: true });

const db = new Database(ABS_DB);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('synchronous = NORMAL');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uuid TEXT UNIQUE NOT NULL,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE,
    phone TEXT,
    password_hash TEXT,
    discord_user_id TEXT UNIQUE,
    discord_username TEXT,
    discord_avatar TEXT,
    discord_email TEXT,
    profile_picture TEXT,
    profile_picture_data TEXT,
    profile_picture_url TEXT,
    account_type TEXT NOT NULL DEFAULT 'User',
    account_permissions TEXT NOT NULL DEFAULT 'User',
    lc_balance INTEGER NOT NULL DEFAULT 0,
    user_discord_user_coin_amount INTEGER NOT NULL DEFAULT 0,
    banned INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    last_login INTEGER,
    member_since INTEGER,
    avatar_decoration TEXT,
    nameplate TEXT,
    email_verified INTEGER NOT NULL DEFAULT 0,
    two_factor_enabled INTEGER NOT NULL DEFAULT 0,
    newsletter_opt_in INTEGER NOT NULL DEFAULT 0,
    preferred_language TEXT DEFAULT 'en',
    time_zone TEXT,
    show_online_status INTEGER NOT NULL DEFAULT 1,
    allow_data_collection INTEGER NOT NULL DEFAULT 1,
    email_notifications INTEGER NOT NULL DEFAULT 1,
    product_updates INTEGER NOT NULL DEFAULT 1,
    promotional_emails INTEGER NOT NULL DEFAULT 0,
    discord_notifications INTEGER NOT NULL DEFAULT 1,
    auto_install INTEGER NOT NULL DEFAULT 0,
    pause_downloads INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    refresh_token TEXT,
    ip TEXT,
    user_agent TEXT,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    revoked INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS reset_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    code TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    used INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    slug TEXT UNIQUE,
    description TEXT,
    full_description TEXT,
    category TEXT,
    price REAL NOT NULL DEFAULT 0,
    image_url TEXT,
    partner TEXT,
    popular INTEGER NOT NULL DEFAULT 0,
    is_new INTEGER NOT NULL DEFAULT 0,
    stock INTEGER NOT NULL DEFAULT -1,
    min_role TEXT NOT NULL DEFAULT 'User',
    product_type TEXT,
    file_url TEXT,
    file_name TEXT,
    created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    amount REAL NOT NULL,
    currency TEXT NOT NULL DEFAULT 'USD',
    payment_method TEXT,
    status TEXT NOT NULL DEFAULT 'completed',
    license_key TEXT,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);

CREATE TABLE IF NOT EXISTS reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    rating INTEGER NOT NULL,
    title TEXT,
    body TEXT,
    likes INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS forum_posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    body TEXT,
    likes INTEGER NOT NULL DEFAULT 0,
    pinned INTEGER NOT NULL DEFAULT 0,
    locked INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS forum_comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    body TEXT NOT NULL,
    likes INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (post_id) REFERENCES forum_posts(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS forum_replies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    comment_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    body TEXT NOT NULL,
    likes INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (comment_id) REFERENCES forum_comments(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS qa_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    question TEXT NOT NULL,
    answer TEXT,
    category TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS news_posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    body TEXT,
    image_url TEXT,
    created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS partners (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    url TEXT,
    logo_url TEXT,
    discord TEXT,
    created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS bank_packs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    price REAL NOT NULL,
    lc_amount INTEGER NOT NULL,
    badge TEXT,
    created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS rate_limits (
    key TEXT PRIMARY KEY,
    count INTEGER NOT NULL,
    reset_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    action TEXT NOT NULL,
    meta TEXT,
    ip TEXT,
    created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS coupons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,
    discount_percent INTEGER NOT NULL DEFAULT 0,
    discount_amount REAL NOT NULL DEFAULT 0,
    max_uses INTEGER NOT NULL DEFAULT -1,
    used_count INTEGER NOT NULL DEFAULT 0,
    min_role TEXT NOT NULL DEFAULT 'User',
    product_id INTEGER,
    expires_at INTEGER,
    active INTEGER NOT NULL DEFAULT 1,
    created_by INTEGER,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS coupon_redemptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    coupon_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    order_id INTEGER,
    redeemed_at INTEGER NOT NULL,
    FOREIGN KEY (coupon_id) REFERENCES coupons(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_coupons_code ON coupons(code);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at INTEGER NOT NULL,
    updated_by INTEGER
);

CREATE TABLE IF NOT EXISTS user_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    author_id INTEGER NOT NULL,
    body TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS launcher_downloads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    platform TEXT NOT NULL,
    version TEXT,
    ip TEXT,
    user_agent TEXT,
    created_at INTEGER NOT NULL
);
`;

db.exec(SCHEMA);

// Lightweight migration: ensure columns that may have been added
// after the initial schema. SQLite ALTER TABLE ADD COLUMN is
// idempotent if we check first.
function ensureColumn(table, column, type) {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all();
    if (!cols.find(c => c.name === column)) {
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    }
}
ensureColumn('users', 'profile_picture_data', 'TEXT');
ensureColumn('users', 'profile_picture_url', 'TEXT');
ensureColumn('users', 'avatar_decoration', 'TEXT');
ensureColumn('users', 'nameplate', 'TEXT');

// Seed admin if missing
function seedAdmin() {
    const username = process.env.ADMIN_USERNAME;
    const password = process.env.ADMIN_PASSWORD;
    const email = process.env.ADMIN_EMAIL;
    if (!username || !password) return;
    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (existing) return;
    const password_hash = bcrypt.hashSync(password, 12);
    const now = Date.now();
    db.prepare(`
        INSERT INTO users (uuid, username, email, password_hash, account_type, account_permissions, member_since, created_at)
        VALUES (?, ?, ?, ?, 'Owner', 'Owner', ?, ?)
    `).run(uuidv4(), username, email || null, password_hash, now, now);
    console.log('[db] seeded admin user:', username);
}

function seedSettings() {
    const defaults = {
        site_name: 'UCHIHA Labs',
        site_tagline: '300+ Tools in one Launcher Ecosystem',
        default_currency: 'USD',
        discord_invite: 'https://discord.gg/Wk7d8mJgyN',
        maintenance_mode: 'off',
        maintenance_reason: '',
        registration_enabled: 'true',
        default_lc_new_user: '0',
        store_tab: 'true',
        customer_panel_tab: 'true',
        lab_pass_tab: 'true',
        inventory_tab: 'true',
        reviews_tab: 'true',
        partner_tab: 'true',
        forum_tab: 'true',
        bank_tab: 'true',
        q_and_a_tab: 'true',
        github_page: 'false',
        status_page: 'true',
        download_button: 'true',
        join_discord_button: 'true',
        github_username: '',
        launcher_version: '1.0.0',
        launcher_changelog: 'Initial UCHIHA Labs desktop launcher release.',
        launcher_required_role: 'User',
    };
    const insert = db.prepare('INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES (?, ?, ?)');
    const now = Date.now();
    const tx = db.transaction((rows) => {
        for (const [k, v] of Object.entries(rows)) insert.run(k, v, now);
    });
    tx(defaults);
    console.log('[db] seeded default settings');
}

function seedSamples() {
    const count = db.prepare('SELECT COUNT(*) as c FROM products').get().c;
    if (count > 0) return;
    const now = Date.now();
    const insert = db.prepare(`
        INSERT INTO products (title, slug, description, category, price, image_url, popular, is_new, product_type, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const samples = [
        ['Discord Token Generator', 'discord-token-gen', 'Generate Discord tokens securely.', 'Discord Tools', 9.99, null, 1, 1, 'Tool', now],
        ['Auto Advertiser Pro', 'auto-advertiser-pro', 'Automate advertising across platforms.', 'Advertising Tools', 19.99, null, 1, 0, 'Tool', now],
        ['Forum Viewer', 'forum-viewer', 'Read forums with custom themes.', 'General Tools', 4.99, null, 0, 1, 'Tool', now],
        ['Lab-Pass Season 1', 'lab-pass-s1', 'Unlock all seasonal perks.', 'Season Passes', 24.99, null, 1, 1, 'Subscription', now],
    ];
    const tx = db.transaction((rows) => {
        for (const r of rows) insert.run(...r);
    });
    tx(samples);

    const qa = db.prepare('INSERT INTO qa_entries (question, answer, category, sort_order) VALUES (?, ?, ?, ?)');
    qa.run('How do I get a license key?', 'After purchase, your key appears in Order History.', 'General', 0);
    qa.run('Is there a refund policy?', 'All sales are final. Contact support for special cases.', 'Billing', 1);

    const news = db.prepare('INSERT INTO news_posts (title, body, image_url, created_at) VALUES (?, ?, ?, ?)');
    news.run('Welcome to UCHIHA Labs Launcher', 'We launched! Explore 300+ tools and seasonal passes.', null, now);

    const partners = db.prepare('INSERT INTO partners (name, description, url, logo_url, discord, created_at) VALUES (?, ?, ?, ?, ?, ?)');
    partners.run('Sample Partner', 'Trusted community partner.', 'https://example.com', null, null, now);

    const pack = db.prepare('INSERT INTO bank_packs (name, description, price, lc_amount, badge, created_at) VALUES (?, ?, ?, ?, ?, ?)');
    pack.run('Starter Pack', '100 LC', 4.99, 100, null, now);
    pack.run('Pro Pack', '500 LC + 10% bonus', 19.99, 550, 'popular', now);

    console.log('[db] seeded sample content');
}

    seedAdmin();
    seedSamples();
    seedSettings();

    module.exports = db;