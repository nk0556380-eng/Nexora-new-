'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  tempDbPath, removeDb, startServer, stopServer, cookieFrom, jsonRequest
} = require('../test-support/helpers');

test('login is rate limited after repeated failures', async () => {
  const dbPath = tempDbPath();
  const server = await startServer({ password: 'rate-limit-password-1234', dbPath });
  try {
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const res = await jsonRequest(server.base, '/api/login', { method: 'POST', body: { password: 'wrong-password-000' } });
      assert.equal(res.status, 401, `attempt ${attempt}`);
    }

    const blocked = await jsonRequest(server.base, '/api/login', { method: 'POST', body: { password: 'wrong-password-000' } });
    assert.equal(blocked.status, 429);
    assert.deepEqual(await blocked.json(), { error: 'Too many sign-in attempts. Try again later.' });
    assert.ok(Number(blocked.headers.get('retry-after')) >= 1);

    const correctWhileBlocked = await jsonRequest(server.base, '/api/login', { method: 'POST', body: { password: 'rate-limit-password-1234' } });
    assert.equal(correctWhileBlocked.status, 429, 'the window must not be bypassed by guessing again');
  } finally {
    await stopServer(server);
    removeDb(dbPath);
  }
});

test('changing the admin password revokes existing sessions, an unchanged restart does not', async () => {
  const dbPath = tempDbPath();
  const first = await startServer({ password: 'first-password-abcdef123', dbPath });
  let cookie;
  try {
    const login = await jsonRequest(first.base, '/api/login', { method: 'POST', body: { password: 'first-password-abcdef123' } });
    assert.equal(login.status, 200);
    cookie = cookieFrom(login);
    assert.equal((await jsonRequest(first.base, '/api/orders', { cookie })).status, 200);
  } finally {
    await stopServer(first);
  }

  const second = await startServer({ password: 'second-password-abcdef12', dbPath });
  let newCookie;
  try {
    assert.equal((await jsonRequest(second.base, '/api/orders', { cookie })).status, 401, 'old session must be revoked');

    const login = await jsonRequest(second.base, '/api/login', { method: 'POST', body: { password: 'second-password-abcdef12' } });
    assert.equal(login.status, 200);
    newCookie = cookieFrom(login);
    assert.equal((await jsonRequest(second.base, '/api/orders', { cookie: newCookie })).status, 200);
  } finally {
    await stopServer(second);
  }

  const third = await startServer({ password: 'second-password-abcdef12', dbPath });
  try {
    assert.equal(
      (await jsonRequest(third.base, '/api/orders', { cookie: newCookie })).status,
      200,
      'restarting with the same password must not sign the admin out'
    );
  } finally {
    await stopServer(third);
    removeDb(dbPath);
  }
});

test('COOKIE_SECURE enables the Secure cookie flag and HSTS', async () => {
  const dbPath = tempDbPath();
  const server = await startServer({
    password: 'secure-cookie-password-1234',
    dbPath,
    env: { COOKIE_SECURE: 'true' }
  });
  try {
    const page = await fetch(server.base + '/');
    assert.equal(page.status, 200);
    assert.match(page.headers.get('strict-transport-security'), /max-age=31536000/);

    const login = await jsonRequest(server.base, '/api/login', { method: 'POST', body: { password: 'secure-cookie-password-1234' } });
    assert.equal(login.status, 200);
    assert.match(login.headers.getSetCookie()[0], /; Secure/);
  } finally {
    await stopServer(server);
    removeDb(dbPath);
  }
});
