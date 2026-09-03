'use strict';

function ok(res, data) {
    return res.json(data);
}

function created(res, data) {
    return res.status(201).json(data);
}

function bad(res, msg, code = 400) {
    return res.status(code).json({ detail: msg });
}

function notFound(res, msg = 'Not found') {
    return res.status(404).json({ detail: msg });
}

function serverError(res, err) {
    console.error('[err]', err);
    return res.status(500).json({ detail: 'Internal server error' });
}

function asyncHandler(fn) {
    return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function parseBody(req) {
    return req.body && typeof req.body === 'object' ? req.body : {};
}

module.exports = { ok, created, bad, notFound, serverError, asyncHandler, parseBody };