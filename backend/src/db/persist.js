'use strict';
/*
 * Persistence layer — makes ALL data survive Render's ephemeral disk.
 *
 * Render free tier wipes the filesystem on every restart, which deletes
 * the SQLite file (accounts, orders, bank, forum …). This module mirrors
 * the whole database to a PRIVATE GitHub repository:
 *
 *   restoreFromRemote()  →  called at boot, downloads the latest snapshot
 *   startAutoBackup()    →  pushes a compact copy every N seconds, but only
 *                           when something actually changed
 *
 * ⚠️  IMPORTANT: DB_BACKUP_REPO must be a PRIVATE repository. It contains
 * user data (e-mails, password hashes). Never use a public repo.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const https = require('https');

const REPO = (process.env.DB_BACKUP_REPO || 'py7s/uchiha-assets').trim();
const TOKEN = process.env.GITHUB_TOKEN || '';
const BRANCH = process.env.DB_BACKUP_BRANCH || (process.env.ASSETS_BRANCH || 'main');
const DB_PATH_IN_REPO = process.env.DB_BACKUP_PATH || 'database/uchiha.db';
const BACKUP_INTERVAL_MS = parseInt(process.env.DB_BACKUP_INTERVAL_MS || '60000', 10);
// GitHub's contents API hard limit is 100 MB per file.
const MAX_BACKUP_BYTES = 95 * 1024 * 1024;

function githubRequest(method, apiPath, body) {
    return new Promise((resolve, reject) => {
        const opts = {
            hostname: 'api.github.com',
            port: 443,
            path: apiPath,
            method,
            headers: {
                'User-Agent': 'uchiha-backend',
                'Accept': 'application/vnd.github+json',
                'Authorization': 'token ' + TOKEN,
                'Content-Type': 'application/json',
            },
        };
        const req = https.request(opts, (res) => {
            let data = '';
            res.on('data', (c) => { data += c; });
            res.on('end', () => {
                try { resolve({ status: res.statusCode, body: data ? JSON.parse(data) : null }); }
                catch (e) { resolve({ status: res.statusCode, body: data }); }
            });
        });
        req.on('error', reject);
        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

function repoContentsPath() {
    return `/repos/${REPO}/contents/${DB_PATH_IN_REPO}`;
}

function configured() {
    return !!(REPO && TOKEN);
}

// Read-only peek at an existing SQLite file to decide if a restore is needed.
function countLocalUsers(dbFile) {
    try {
        if (!fs.existsSync(dbFile)) return null;
        const Database = require('better-sqlite3');
        const conn = new Database(dbFile, { readonly: true, fileMustExist: true });
        try {
            const tbl = conn.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'").get();
            if (!tbl) return 0;
            return conn.prepare('SELECT COUNT(*) AS c FROM users').get().c;
        } finally {
            conn.close();
        }
    } catch (e) {
        console.error('[persist] countLocalUsers failed:', e && e.message);
        return null;
    }
}

// Whether a previous snapshot exists in the backup repo.
async function hasRemote() {
    if (!configured()) return false;
    try {
        const res = await githubRequest('GET', repoContentsPath());
        return res.status === 200 && !!res.body && !!res.body.sha;
    } catch (e) {
        console.error('[persist] hasRemote failed:', e && e.message);
        return false;
    }
}

// Download the latest snapshot and replace the local DB file.
async function restoreFromRemote(dbFile) {
    if (!configured()) return false;
    try {
        const res = await githubRequest('GET', repoContentsPath());
        if (res.status !== 200 || !res.body || !res.body.content) return false;
        const buf = Buffer.from(res.body.content, 'base64');
        if (!buf.length) return false;
        fs.mkdirSync(path.dirname(dbFile), { recursive: true });
        fs.writeFileSync(dbFile, buf);
        for (const suffix of ['-wal', '-shm']) {
            const p = dbFile + suffix;
            if (fs.existsSync(p)) fs.unlinkSync(p);
        }
        console.log(`[persist] restored database from ${REPO}/${DB_PATH_IN_REPO} (${(buf.length / 1024).toFixed(1)} KB)`);
        return true;
    } catch (e) {
        console.error('[persist] restore failed (server stays usable, but data is volatile):', e && e.message);
        return false;
    }
}

async function sqliteBackup(db, dest) {
    return new Promise((resolve, reject) => {
        try {
            const p = db.backup(dest);
            if (p && typeof p.then === 'function') p.then(() => resolve(), reject);
            else resolve();
        } catch (e) { reject(e); }
    });
}

async function uploadBackup(dbFile, buf) {
    if (!configured()) return false;
    if (buf.length > MAX_BACKUP_BYTES) {
        console.warn(`[persist] backup skipped: ${(buf.length / 1024 / 1024).toFixed(1)} MB exceeds limit`);
        return false;
    }
    const apiPath = repoContentsPath();
    const content = buf.toString('base64');
    const body = {
        message: 'Auto-backup uchiha.db',
        branch: BRANCH,
        content,
    };
    let sha = null;
    try {
        const head = await githubRequest('GET', apiPath);
        if (head.status === 200 && head.body && head.body.sha) {
            sha = head.body.sha;
        }
    } catch (e) { /* ignore */ }
    if (sha) body.sha = sha;
    const res = await githubRequest('PUT', apiPath, body);
    if (res.status >= 200 && res.status < 300) {
        console.log(`[persist] backup uploaded (${(buf.length / 1024).toFixed(1)} KB)`);
        return true;
    }
    console.error('[persist] backup upload failed:', res.status, res.body);
    return false;
}

// Periodically push the DB to GitHub when it has changed.
function startAutoBackup(db, dbFile) {
    if (!configured()) {
        console.log('[persist] auto-backup disabled: set DB_BACKUP_REPO to enable');
        return;
    }
    let lastStat = null;
    let timer = null;

    async function tick() {
        try {
            let stat;
            try { stat = fs.statSync(dbFile); } catch (e) { return; }
            if (stat.size > MAX_BACKUP_BYTES) {
                console.warn(`[persist] DB too large for backup: ${(stat.size / 1024 / 1024).toFixed(1)} MB`);
                return;
            }
            if (lastStat && stat.size === lastStat.size && stat.mtimeMs === lastStat.mtimeMs) {
                return;
            }
            lastStat = stat;
            const tmp = dbFile + '.backup-tmp';
            await sqliteBackup(db, tmp);
            const buf = fs.readFileSync(tmp);
            fs.unlinkSync(tmp);
            await uploadBackup(dbFile, buf);
        } catch (e) {
            console.error('[persist] backup tick failed:', e && e.message);
        }
    }

    timer = setInterval(tick, BACKUP_INTERVAL_MS);
    console.log(`[persist] auto-backup started (interval: ${BACKUP_INTERVAL_MS}ms, repo: ${REPO})`);
    return () => clearInterval(timer);
}

module.exports = {
    restoreFromRemote,
    startAutoBackup,
    configured,
    hasRemote,
};
