'use strict';

const crypto = require('node:crypto');
const db = require('./db');

const COOKIE = 'nexora_client';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SECURE_COOKIE = process.env.COOKIE_SECURE === 'true';

function parseCookies(header) {
  return String(header || '').split(';').reduce((acc, part) => {
    const index = part.indexOf('=');
    if (index === -1) return acc;
    const key = part.slice(0, index).trim();
    if (!key) return acc;
    try {
      acc[key] = decodeURIComponent(part.slice(index + 1).trim());
    } catch (_) {
      // Ignore malformed cookie values instead of failing the request.
    }
    return acc;
  }, {});
}

function tokenFrom(req) {
  return parseCookies(req.headers.cookie)[COOKIE];
}

function sqlTimestamp(msFromNow) {
  return new Date(Date.now() + msFromNow).toISOString().slice(0, 19).replace('T', ' ');
}

async function init() {
  await db.prepare("DELETE FROM client_sessions WHERE expires_at <= datetime('now')").run();
}

async function currentAccount(req) {
  const token = tokenFrom(req);
  if (!token) return null;
  return db.prepare(`
    SELECT a.* FROM client_sessions s
    JOIN client_accounts a ON a.id = s.account_id
    WHERE s.token = ? AND s.expires_at > datetime('now') AND a.status = 'active'
  `).get(token) || null;
}

async function isAuthed(req) {
  return Boolean(await currentAccount(req));
}

function cookieHeader(value, maxAgeSeconds) {
  const parts = [
    `${COOKIE}=${value}`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/',
    `Max-Age=${maxAgeSeconds}`
  ];
  if (SECURE_COOKIE) parts.push('Secure');
  return parts.join('; ');
}

async function login(res, accountId) {
  await init();
  const token = crypto.randomBytes(32).toString('hex');
  await db.prepare('INSERT INTO client_sessions (token, account_id, expires_at) VALUES (?, ?, ?)').run(
    token,
    accountId,
    sqlTimestamp(SESSION_TTL_MS)
  );
  res.setHeader('Set-Cookie', cookieHeader(token, Math.floor(SESSION_TTL_MS / 1000)));
}

async function logout(req, res) {
  const token = tokenFrom(req);
  if (token) await db.prepare('DELETE FROM client_sessions WHERE token = ?').run(token);
  res.setHeader('Set-Cookie', cookieHeader('', 0));
}

async function requireApi(req, res, next) {
  const account = await currentAccount(req);
  if (!account) return res.status(401).json({ error: 'Not signed in.' });
  req.clientAccount = account;
  next();
}

async function requirePage(req, res, next) {
  const account = await currentAccount(req);
  if (!account) {
    res.setHeader('Cache-Control', 'no-store');
    return res.redirect('/client/login');
  }
  req.clientAccount = account;
  next();
}

module.exports = {
  COOKIE,
  SECURE_COOKIE,
  SESSION_TTL_MS,
  init,
  currentAccount,
  isAuthed,
  login,
  logout,
  requireApi,
  requirePage
};
