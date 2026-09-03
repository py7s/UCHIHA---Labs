'use strict';

const crypto = require('crypto');

function genResetCode() {
    return String(Math.floor(100000 + Math.random() * 900000));
}

function randomToken(bytes = 32) {
    return crypto.randomBytes(bytes).toString('hex');
}

function safeEqualStr(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    const ab = Buffer.from(a);
    const bb = Buffer.from(b);
    if (ab.length !== bb.length) return false;
    return crypto.timingSafeEqual(ab, bb);
}

function slugify(str) {
    return String(str || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80);
}

function genLicenseKey() {
    const segments = [];
    for (let i = 0; i < 4; i++) segments.push(crypto.randomBytes(4).toString('hex').toUpperCase());
    return 'UCHIHA-' + segments.join('-');
}

module.exports = { genResetCode, randomToken, safeEqualStr, slugify, genLicenseKey };