'use strict';

const crypto = require('node:crypto');
const db = require('./db');

const PASSWORD = process.env.ADMIN_PASSWORD;
const MIN_PASSWORD_LENGTH = 14;

// Fail closed: never start with a guessable default password.
if (!PASSWORD || PASSWORD.length < MIN_PASSWORD_LENGTH) {
  throw new Error(
    `ADMIN_PASSWORD is required and must be at least ${MIN_PASSWORD_LENGTH} characters. ` +
      'Set it before starting, e.g.  $env:ADMIN_PASSWORD = "<long passphrase>"'
  );
}

const COOKIE = 'nexora_admin';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SECURE_COOKIE = process.env.COOKIE_SECURE === 'true';

function digest(value) {
  return crypto.createHash('sha256').update(String(value)).digest();
}

function passwordOk(input) {
  if (typeof input !== 'string') return false;
  const a = digest(input);
  const b = digest(PASSWORD);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

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

async function pruneSessions() {
  await db.prepare("DELETE FROM sessions WHERE expires_at IS NULL OR expires_at <= datetime('now')").run();
}

// Revoke every session when ADMIN_PASSWORD changes between restarts. A salted
// scrypt fingerprint is stored instead of the password itself.
async function syncPasswordFingerprint() {
  const saltRow = await db.prepare("SELECT value FROM app_meta WHERE key = 'password_salt'").get();
  const salt = saltRow ? saltRow.value : crypto.randomBytes(16).toString('hex');
  if (!saltRow) {
    await db.prepare("INSERT INTO app_meta (key, value) VALUES ('password_salt', ?)").run(salt);
  }

  const fingerprint = crypto.scryptSync(PASSWORD, salt, 32).toString('hex');
  const stored = await db.prepare("SELECT value FROM app_meta WHERE key = 'password_fingerprint'").get();

  if (!stored || stored.value !== fingerprint) {
    await db.exec('DELETE FROM sessions');
    await db.prepare(`
      INSERT INTO app_meta (key, value) VALUES ('password_fingerprint', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(fingerprint);
  }
}

/** Must be awaited once before the server accepts requests. */
async function init() {
  await pruneSessions();
  await syncPasswordFingerprint();
}

async function isAuthed(req) {
  const token = tokenFrom(req);
  if (!token) return false;
  return Boolean(
    await db.prepare("SELECT 1 FROM sessions WHERE token = ? AND expires_at > datetime('now')").get(token)
  );
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

async function login(res) {
  await pruneSessions();
  const token = crypto.randomBytes(32).toString('hex');
  await db.prepare('INSERT INTO sessions (token, expires_at) VALUES (?, ?)').run(
    token,
    sqlTimestamp(SESSION_TTL_MS)
  );
  res.setHeader('Set-Cookie', cookieHeader(token, Math.floor(SESSION_TTL_MS / 1000)));
}

async function logout(req, res) {
  const token = tokenFrom(req);
  if (token) await db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  res.setHeader('Set-Cookie', cookieHeader('', 0));
}

async function requireApi(req, res, next) {
  if (!(await isAuthed(req))) return res.status(401).json({ error: 'Not signed in.' });
  next();
}

async function requirePage(req, res, next) {
  if (!(await isAuthed(req))) {
    // Never let a proxy cache the redirect or the private page that follows.
    res.setHeader('Cache-Control', 'no-store');
    return res.redirect('/login.html');
  }
  next();
}

module.exports = {
  PASSWORD,
  COOKIE,
  SECURE_COOKIE,
  SESSION_TTL_MS,
  passwordOk,
  init,
  isAuthed,
  login,
  logout,
  requireApi,
  requirePage
};
