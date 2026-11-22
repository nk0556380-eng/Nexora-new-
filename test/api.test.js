'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const {
  tempDbPath, removeDb, startServer, stopServer, cookieFrom, jsonRequest
} = require('../test-support/helpers');

const PASSWORD = 'test-admin-password-1234';
const ONBOARDING = {
  agency: 'Test Agency',
  contact_name: 'Test Contact',
  email: 'test@example.com',
  phone: '+91 98000 11101',
  website: 'https://example.com',
  city: 'Pune',
  services: 'Cold calling',
  target_profile: 'SaaS founders',
  list_source: 'Own list',
  monthly_volume: '100',
  notes: 'Batch 1 test',
  consent: true
};

let server;
let base;
let dbPath;
let cookie;

function assertNoInternals(text) {
  for (const marker of ['node:internal', 'node_modules', 'C:\\', '.js:']) {
    assert.ok(!text.includes(marker), `response leaked "${marker}": ${text}`);
  }
}

function sessionCount() {
  const db = new DatabaseSync(dbPath);
  try {
    return db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n;
  } finally {
    db.close();
  }
}

before(async () => {
  dbPath = tempDbPath();
  server = await startServer({ password: PASSWORD, dbPath });
  base = server.base;
});

after(async () => {
  await stopServer(server);
  removeDb(dbPath);
});

/* ------------------------------ headers -------------------------------- */

test('pages and assets carry the security headers', async () => {
  for (const urlPath of ['/', '/assets/css/premium.css', '/assets/js/app.js', '/assets/fonts/dm-sans-latin.woff2']) {
    const res = await fetch(base + urlPath);
    assert.equal(res.status, 200, urlPath);
    const csp = res.headers.get('content-security-policy');
    assert.match(csp, /default-src 'self'/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.match(csp, /object-src 'none'/);
    assert.match(csp, /script-src 'self' 'sha256-/);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('x-frame-options'), 'DENY');
    assert.equal(res.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
    assert.match(res.headers.get('permissions-policy'), /camera=\(\)/);
    assert.equal(res.headers.get('cross-origin-opener-policy'), 'same-origin');
    assert.equal(res.headers.get('x-powered-by'), null);
  }
});

test('API responses are marked no-store and never include HSTS over plain HTTP', async () => {
  const res = await jsonRequest(base, '/api/health');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.headers.get('strict-transport-security'), null);
});

test('public pages load and private paths stay blocked', async () => {
  assert.equal((await fetch(base + '/')).status, 200);
  assert.equal((await fetch(base + '/onboarding')).status, 200);
  assert.equal((await fetch(base + '/login')).status, 200);

  for (const blocked of [
    '/private/data/nexora.db',
    '/private%2Fdata%2Fnexora.db',
    '/data%2Fnexora.db',
    '/server%2Fauth.js',
    '/assets%2F..%2Fprivate%2Fdata%2Fnexora.db',
    '/index.html'
  ]) {
    assert.equal((await fetch(base + blocked)).status, 404, blocked);
  }
});

/* --------------------------- authentication ---------------------------- */

test('admin routes reject unauthenticated callers', async () => {
  for (const urlPath of ['/api/orders', '/api/stats', '/api/invoices', '/api/onboarding']) {
    const res = await jsonRequest(base, urlPath);
    assert.equal(res.status, 401, urlPath);
    assert.deepEqual(await res.json(), { error: 'Not signed in.' });
  }
  for (const urlPath of ['/dashboard', '/invoice/1']) {
    const res = await fetch(base + urlPath, { redirect: 'manual' });
    assert.equal(res.status, 302, urlPath);
    assert.equal(res.headers.get('location'), '/login.html');
  }
});

test('malformed JSON is rejected without internals', async () => {
  const res = await jsonRequest(base, '/api/login', { method: 'POST', rawBody: '{"password":' });
  assert.equal(res.status, 400);
  const body = await res.text();
  assert.match(body, /Malformed JSON body/);
  assertNoInternals(body);
});

test('wrong credentials get a generic 401', async () => {
  const res = await jsonRequest(base, '/api/login', { method: 'POST', body: { password: 'definitely-wrong-passphrase' } });
  assert.equal(res.status, 401);
  assert.deepEqual(await res.json(), { error: 'Invalid credentials.' });
});

test('unexpected fields and non-text passwords are rejected', async () => {
  const extra = await jsonRequest(base, '/api/login', { method: 'POST', body: { password: PASSWORD, user: 'admin' } });
  assert.equal(extra.status, 400);
  assert.match((await extra.json()).error, /Unexpected field "user"/);

  const wrongType = await jsonRequest(base, '/api/login', { method: 'POST', body: { password: 1234567890123456 } });
  assert.equal(wrongType.status, 400);
  assert.match((await wrongType.json()).error, /must be text/);
});

test('correct credentials issue an HttpOnly SameSite session cookie', async () => {
  const res = await jsonRequest(base, '/api/login', { method: 'POST', body: { password: PASSWORD } });
  assert.equal(res.status, 200);
  const setCookie = res.headers.getSetCookie()[0];
  assert.match(setCookie, /^nexora_admin=[a-f0-9]{64}/);
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Lax/);
  assert.match(setCookie, /Path=\//);
  assert.match(setCookie, /Max-Age=\d+/);
  assert.ok(!/Secure/.test(setCookie), 'plain HTTP must not set Secure');
  cookie = cookieFrom(res);
  assert.ok(sessionCount() >= 1);
});

test('the session authorizes admin reads and pages', async () => {
  const orders = await jsonRequest(base, '/api/orders', { cookie });
  assert.equal(orders.status, 200);
  const rows = await orders.json();
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((row) => row.ref).sort(), ['NXR-2026-001', 'NXR-2026-002', 'NXR-2026-003']);

  assert.equal((await jsonRequest(base, '/api/stats', { cookie })).status, 200);
  assert.equal((await jsonRequest(base, '/api/onboarding', { cookie })).status, 200);
  assert.equal((await jsonRequest(base, '/api/invoices', { cookie })).status, 200);

  for (const urlPath of ['/dashboard', '/invoice/1']) {
    assert.equal((await fetch(base + urlPath, { headers: { Cookie: cookie }, redirect: 'manual' })).status, 200, urlPath);
  }
});

/* ---------------------------- validation ------------------------------- */

test('consent is accepted only as the boolean true', async () => {
  const db = new DatabaseSync(dbPath);
  const before = db.prepare('SELECT COUNT(*) AS n FROM clients').get().n;
  db.close();

  for (const consent of ['true', 'false', 1, '1', 0, null, {}, []]) {
    const res = await jsonRequest(base, '/api/onboarding', { method: 'POST', body: { ...ONBOARDING, consent } });
    assert.equal(res.status, 400, `consent=${JSON.stringify(consent)}`);
    assert.match((await res.json()).error, /"consent" must be true/);
  }

  const missing = { ...ONBOARDING };
  delete missing.consent;
  const res = await jsonRequest(base, '/api/onboarding', { method: 'POST', body: missing });
  assert.equal(res.status, 400);

  const afterDb = new DatabaseSync(dbPath);
  const after = afterDb.prepare('SELECT COUNT(*) AS n FROM clients').get().n;
  afterDb.close();
  assert.equal(after, before, 'no client row may be created without real consent');
});

test('a valid onboarding submission is stored once', async () => {
  const res = await jsonRequest(base, '/api/onboarding', { method: 'POST', body: ONBOARDING });
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(typeof body.id, 'number');
});

test('onboarding validation rejects bad emails, types and extra fields', async () => {
  const badEmail = await jsonRequest(base, '/api/onboarding', { method: 'POST', body: { ...ONBOARDING, email: 'nope' } });
  assert.equal(badEmail.status, 400);

  const badName = await jsonRequest(base, '/api/onboarding', { method: 'POST', body: { ...ONBOARDING, agency: { evil: true } } });
  assert.equal(badName.status, 400);
  assert.match((await badName.json()).error, /must be text/);

  const extra = await jsonRequest(base, '/api/onboarding', { method: 'POST', body: { ...ONBOARDING, admin: true } });
  assert.equal(extra.status, 400);
  assert.match((await extra.json()).error, /Unexpected field "admin"/);
});

test('enquiry validation rejects missing, mistyped and malformed input', async () => {
  const valid = { name: 'Ananya', agency: 'Northstar', email: 'ananya@northstar.example', message: 'Need a test run.' };

  const missing = await jsonRequest(base, '/api/enquiries', { method: 'POST', body: { name: 'Ananya', agency: 'Northstar', email: 'a@b.co' } });
  assert.equal(missing.status, 400);

  const objectName = await jsonRequest(base, '/api/enquiries', { method: 'POST', body: { ...valid, name: { first: 'X' } } });
  assert.equal(objectName.status, 400);
  assert.match((await objectName.json()).error, /must be text/);

  const badEmail = await jsonRequest(base, '/api/enquiries', { method: 'POST', body: { ...valid, email: 'not-an-email' } });
  assert.equal(badEmail.status, 400);

  const ok = await jsonRequest(base, '/api/enquiries', { method: 'POST', body: valid });
  assert.equal(ok.status, 201);
  assert.match((await ok.json()).ref, /^NXR-2026-\d{3}$/);
});

test('admin patches validate ids, enums and unknown fields', async () => {
  const badId = await jsonRequest(base, '/api/orders/abc', { method: 'PATCH', body: { status: 'accepted' }, cookie });
  assert.equal(badId.status, 400);
  assert.match((await badId.json()).error, /positive integer/);

  const badStatus = await jsonRequest(base, '/api/orders/1', { method: 'PATCH', body: { status: 'bogus' }, cookie });
  assert.equal(badStatus.status, 400);
  assert.match((await badStatus.json()).error, /must be one of/);

  const extra = await jsonRequest(base, '/api/orders/1', { method: 'PATCH', body: { status: 'accepted', note: 'x' }, cookie });
  assert.equal(extra.status, 400);

  const missing = await jsonRequest(base, '/api/orders/999999', { method: 'PATCH', body: { status: 'accepted' }, cookie });
  assert.equal(missing.status, 404);

  const ok = await jsonRequest(base, '/api/orders/1', { method: 'PATCH', body: { status: 'accepted' }, cookie });
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).status, 'accepted');
});

test('invoice input is validated strictly', async () => {
  const valid = {
    client_name: 'Test Client',
    client_email: 'billing@example.com',
    issue_date: '2026-11-19',
    due_date: '2026-12-03',
    tax_percent: 18,
    notes: 'Test invoice',
    items: [{ description: 'Retainer', qty: 1, rate: 1000 }, { description: 'Setup', qty: 2, rate: 1000 }]
  };

  const cases = [
    { ...valid, issue_date: 'banana' },
    { ...valid, due_date: '2026-11-01' },
    { ...valid, items: 'nope' },
    { ...valid, items: [] },
    { ...valid, items: [{ description: 'X', qty: '2', rate: 100 }] },
    { ...valid, items: [{ description: 'X', qty: 1, rate: -5 }] },
    { ...valid, items: [{ description: 'X', qty: 1, rate: 100, extra: true }] },
    { ...valid, total: 1 },
    { ...valid, tax_percent: 150 }
  ];

  for (const payload of cases) {
    const res = await jsonRequest(base, '/api/invoices', {
      method: 'POST',
      body: payload,
      cookie,
      headers: { 'Idempotency-Key': 'api-test-invalid-0001' }
    });
    assert.equal(res.status, 400, JSON.stringify(payload));
  }

  const badId = await jsonRequest(base, '/api/invoices/abc', { cookie });
  assert.equal(badId.status, 400);

  const created = await jsonRequest(base, '/api/invoices', {
    method: 'POST',
    body: valid,
    cookie,
    headers: { 'Idempotency-Key': 'api-test-valid-0001' }
  });
  assert.equal(created.status, 201);
  const invoice = await created.json();
  assert.equal(invoice.subtotal, 3000);
  assert.equal(invoice.tax_amount, 540);
  assert.equal(invoice.total, 3540);
  assert.equal(invoice.status, 'draft');

  const fetched = await jsonRequest(base, `/api/invoices/${invoice.id}`, { cookie });
  assert.equal(fetched.status, 200);
  assert.equal((await fetched.json()).items.length, 2);

  const sent = await jsonRequest(base, `/api/invoices/${invoice.id}`, { method: 'PATCH', body: { status: 'sent' }, cookie });
  assert.equal(sent.status, 200);
  assert.equal((await sent.json()).status, 'sent');
});

/* ---------------------------- sessions --------------------------------- */

test('expired sessions are rejected and pruned on the next login', async () => {
  const db = new DatabaseSync(dbPath);
  db.prepare("INSERT INTO sessions (token, expires_at) VALUES ('expired-token', datetime('now', '-1 day'))").run();
  db.close();

  const rejected = await jsonRequest(base, '/api/orders', { cookie: 'nexora_admin=expired-token' });
  assert.equal(rejected.status, 401);

  const login = await jsonRequest(base, '/api/login', { method: 'POST', body: { password: PASSWORD } });
  assert.equal(login.status, 200);

  const check = new DatabaseSync(dbPath);
  const expired = check.prepare("SELECT COUNT(*) AS n FROM sessions WHERE token = 'expired-token'").get().n;
  check.close();
  assert.equal(expired, 0, 'expired sessions must be pruned');
});

test('logout revokes the presented session', async () => {
  const login = await jsonRequest(base, '/api/login', { method: 'POST', body: { password: PASSWORD } });
  const sessionCookie = cookieFrom(login);
  assert.equal((await jsonRequest(base, '/api/orders', { cookie: sessionCookie })).status, 200);

  const out = await jsonRequest(base, '/api/logout', { method: 'POST', cookie: sessionCookie });
  assert.equal(out.status, 200);
  assert.match(out.headers.getSetCookie()[0], /Max-Age=0/);

  assert.equal((await jsonRequest(base, '/api/orders', { cookie: sessionCookie })).status, 401);
});
