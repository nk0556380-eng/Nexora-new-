'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const zlib = require('node:zlib');
const {
  tempDbPath, removeDb, startServer, stopServer, cookieFrom, jsonRequest
} = require('../test-support/helpers');

const PASSWORD = 'test-admin-password-1234';

let server;
let base;
let dbPath;
let cookie;

/** Raw GET so the test can inspect the encoded bytes before decompression. */
function rawGet(urlPath, headers = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request(base + urlPath, { method: 'GET', headers }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({
        status: response.statusCode,
        headers: response.headers,
        body: Buffer.concat(chunks)
      }));
    });
    request.on('error', reject);
    request.end();
  });
}

before(async () => {
  dbPath = tempDbPath();
  server = await startServer({ password: PASSWORD, dbPath });
  base = server.base;

  const login = await jsonRequest(base, '/api/login', { method: 'POST', body: { password: PASSWORD } });
  assert.equal(login.status, 200);
  cookie = cookieFrom(login);
});

after(async () => {
  await stopServer(server);
  removeDb(dbPath);
});

test('CSP forbids inline styles and keeps only the boot-script hash', async () => {
  const page = await fetch(base + '/');
  const csp = page.headers.get('content-security-policy');

  assert.match(csp, /style-src 'self'(;|$)/);
  assert.ok(!csp.includes("'unsafe-inline'"), csp);
  assert.match(csp, /script-src 'self' 'sha256-/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /frame-ancestors 'none'/);
});

test('served pages contain no inline style attributes', async () => {
  for (const urlPath of ['/', '/onboarding', '/login']) {
    const html = await (await fetch(base + urlPath)).text();
    assert.ok(!/\sstyle\s*=/.test(html), `${urlPath} still contains an inline style attribute`);
  }
});

test('Brotli compression is used when the client offers it', async () => {
  const response = await rawGet('/', { 'Accept-Encoding': 'br, gzip' });
  assert.equal(response.status, 200);
  assert.equal(response.headers['content-encoding'], 'br');
  assert.match(response.headers.vary, /Accept-Encoding/);

  const html = zlib.brotliDecompressSync(response.body).toString('utf8');
  assert.match(html, /<!DOCTYPE html>/);
  assert.match(html, /Nexora/);
});

test('gzip is used as the fallback when Brotli is not offered', async () => {
  const response = await rawGet('/assets/css/app.css', { 'Accept-Encoding': 'gzip' });
  assert.equal(response.status, 200);
  assert.equal(response.headers['content-encoding'], 'gzip');
  assert.match(response.headers.vary, /Accept-Encoding/);

  const css = zlib.gunzipSync(response.body).toString('utf8');
  assert.match(css, /\.modal/);
});

test('already-compressed fonts are not recompressed', async () => {
  const response = await rawGet('/assets/fonts/dm-sans-latin.woff2', { 'Accept-Encoding': 'br, gzip' });
  assert.equal(response.status, 200);
  assert.equal(response.headers['content-encoding'], undefined);
  assert.match(response.headers['content-type'], /font\/woff2/);
});

test('HTML revalidates, immutable fonts cache, and API stays no-store', async () => {
  const publicPage = await fetch(base + '/');
  assert.equal(publicPage.headers.get('cache-control'), 'no-cache');

  const css = await fetch(base + '/assets/css/app.css');
  assert.equal(css.headers.get('cache-control'), 'public, max-age=3600, must-revalidate');

  const font = await fetch(base + '/assets/fonts/dm-sans-latin.woff2');
  assert.equal(font.headers.get('cache-control'), 'public, max-age=31536000, immutable');

  const api = await fetch(base + '/api/health');
  assert.equal(api.headers.get('cache-control'), 'no-store');
});

test('authenticated pages and redirects are never cacheable', async () => {
  for (const urlPath of ['/dashboard', '/invoice/1']) {
    const res = await fetch(base + urlPath, { headers: { Cookie: cookie }, redirect: 'manual' });
    assert.equal(res.status, 200, urlPath);
    assert.equal(res.headers.get('cache-control'), 'no-store', urlPath);
  }

  const redirect = await fetch(base + '/dashboard', { redirect: 'manual' });
  assert.equal(redirect.status, 302);
  assert.equal(redirect.headers.get('cache-control'), 'no-store');
});

test('cross-site state changes are rejected before authentication', async () => {
  const crossOrigin = await jsonRequest(base, '/api/logout', {
    method: 'POST',
    cookie,
    headers: { Origin: 'https://evil.example' }
  });
  assert.equal(crossOrigin.status, 403);
  assert.deepEqual(await crossOrigin.json(), { error: 'Cross-site request rejected.' });

  const crossSite = await jsonRequest(base, '/api/logout', {
    method: 'POST',
    cookie,
    headers: { 'Sec-Fetch-Site': 'cross-site' }
  });
  assert.equal(crossSite.status, 403);

  // The rejected requests must not have consumed the session.
  assert.equal((await jsonRequest(base, '/api/orders', { cookie })).status, 200);

  const sameOrigin = await jsonRequest(base, '/api/logout', {
    method: 'POST',
    cookie,
    headers: { Origin: base }
  });
  assert.equal(sameOrigin.status, 200);
});

test('legacy files remain unreachable', async () => {
  for (const urlPath of ['/index.html', '/assets/css/styles.css', '/assets/js/main.js']) {
    assert.equal((await fetch(base + urlPath)).status, 404, urlPath);
  }
});

test('private paths and encoded traversal stay blocked', async () => {
  for (const urlPath of [
    '/private/data/nexora.db',
    '/private%2Fdata%2Fnexora.db',
    '/assets%2F..%2Fprivate%2Fdata%2Fnexora.db',
    '/server%2Fauth.js',
    '/.env'
  ]) {
    assert.equal((await fetch(base + urlPath)).status, 404, urlPath);
  }
});
