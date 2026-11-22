'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const {
  tempDbPath, removeDb, startServer, stopServer, cookieFrom, jsonRequest
} = require('../test-support/helpers');

const PASSWORD = 'portal-test-password-1234';
const NORTHSTAR = { agency: 'Northstar Digital', contact_name: 'Ananya Rao', phone: '+91 98000 11101' };
const EDGECOMBE = { agency: 'Info Edgecombe', contact_name: 'Rohan Mehta', phone: '+91 98000 11102' };

let server;
let base;
let dbPath;
let adminCookie;
let edgecombeId;
let edgecombeCode;
let northstarId;
let northstarCode;

async function loginClient(phone, code) {
  const response = await jsonRequest(base, '/api/client/login', {
    method: 'POST',
    body: { phone, code }
  });
  return { response, cookie: cookieFrom(response) };
}

before(async () => {
  dbPath = tempDbPath();
  server = await startServer({ password: PASSWORD, dbPath });
  base = server.base;

  const admin = await jsonRequest(base, '/api/login', {
    method: 'POST',
    body: { password: PASSWORD }
  });
  adminCookie = cookieFrom(admin);

  const onboarding = await jsonRequest(base, '/api/onboarding', {
    method: 'POST', cookie: adminCookie,
    body: { ...EDGECOMBE, email: 'rohan@edgecombe.example', website: 'https://edgecombe.example', city: 'Pune', services: 'Cold calling', target_profile: 'Agencies', list_source: 'Own list', monthly_volume: '100', notes: 'Test', consent: true }
  });
  assert.equal(onboarding.status, 201);
  const clientId = (await onboarding.json()).id;

  const enquiry = await jsonRequest(base, '/api/enquiries', {
    method: 'POST',
    body: { name: EDGECOMBE.contact_name, agency: EDGECOMBE.agency, email: 'rohan@edgecombe.example', phone: EDGECOMBE.phone, service: 'Appointment setting', message: 'Pilot' }
  });
  assert.equal(enquiry.status, 201);
  const orderId = (await enquiry.json()).id;

  await jsonRequest(base, '/api/orders/' + orderId, {
    method: 'PATCH', cookie: adminCookie, body: { status: 'accepted' }
  });

  const invoice = await jsonRequest(base, '/api/invoices', {
    method: 'POST', cookie: adminCookie,
    headers: { 'Idempotency-Key': 'portal-seed-invoice' },
    body: { client_name: EDGECOMBE.agency, client_email: 'rohan@edgecombe.example', issue_date: '2026-11-10', due_date: '2026-11-25', client_id: clientId, order_id: orderId, items: [{ description: 'Pilot', qty: 1, rate: 1000 }] }
  });
  assert.equal(invoice.status, 201);
  const invoiceId = (await invoice.json()).id;

  await jsonRequest(base, '/api/onboarding/' + clientId, {
    method: 'PATCH', cookie: adminCookie, body: { status: 'approved' }
  });
  await jsonRequest(base, '/api/invoices/' + invoiceId, {
    method: 'PATCH', cookie: adminCookie, body: { status: 'sent' }
  });

  const first = await jsonRequest(base, '/api/client-accounts', {
    method: 'POST', cookie: adminCookie, body: { ...EDGECOMBE, client_id: clientId, email: 'rohan@edgecombe.example' }
  });
  assert.equal(first.status, 201);
  const firstBody = await first.json();
  edgecombeId = firstBody.account.id;
  edgecombeCode = firstBody.code;

  const second = await jsonRequest(base, '/api/client-accounts', {
    method: 'POST', cookie: adminCookie, body: NORTHSTAR
  });
  assert.equal(second.status, 201);
  const secondBody = await second.json();
  northstarId = secondBody.account.id;
  northstarCode = secondBody.code;
});

after(async () => {
  await stopServer(server);
  removeDb(dbPath);
});

test('admin creates client accounts without exposing stored codes', async () => {
  const response = await jsonRequest(base, '/api/client-accounts', { cookie: adminCookie });
  assert.equal(response.status, 200);
  const accounts = await response.json();
  assert.equal(accounts.length, 2);
  assert.match(edgecombeCode, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  for (const account of accounts) {
    assert.equal(account.code_hash, undefined);
    assert.equal(account.code, undefined);
    assert.equal(account.phone.length, 10);
  }
});

test('duplicate phone numbers are rejected', async () => {
  const response = await jsonRequest(base, '/api/client-accounts', {
    method: 'POST', cookie: adminCookie, body: { ...EDGECOMBE, agency: 'Other Agency' }
  });
  assert.equal(response.status, 409);
});

test('client login accepts a formatted phone and code without hyphens', async () => {
  const wrong = await loginClient('9800011102', 'WRONGCODE');
  assert.equal(wrong.response.status, 401);

  const correct = await loginClient('+91 98000 11102', edgecombeCode.replace('-', '').toLowerCase());
  assert.equal(correct.response.status, 200);
  const body = await correct.response.json();
  assert.equal(body.account.agency, 'Info Edgecombe');
  assert.match(correct.cookie, /^nexora_client=/);
});

test('client sees only their own orders, invoices and profile', async () => {
  const { cookie } = await loginClient('9800011102', edgecombeCode);

  const overview = await jsonRequest(base, '/api/client/overview', { cookie });
  assert.equal(overview.status, 200);
  const progress = (await overview.json()).progress;
  assert.equal(progress.total, 5);
  assert.equal(progress.completed, 4);
  assert.equal(progress.steps[4].state, 'current');

  const orders = await (await jsonRequest(base, '/api/client/orders', { cookie })).json();
  assert.equal(orders.length, 1);
  assert.equal(orders[0].agency, 'Info Edgecombe');

  const invoices = await (await jsonRequest(base, '/api/client/invoices', { cookie })).json();
  assert.equal(invoices.length, 1);
  assert.equal(invoices[0].client_name, 'Info Edgecombe');

  const profile = await (await jsonRequest(base, '/api/client/profile', { cookie })).json();
  assert.equal(profile.agency, 'Info Edgecombe');
  assert.equal(profile.status, 'approved');

  const ownInvoice = await jsonRequest(base, '/api/client/invoices/' + invoices[0].id, { cookie });
  assert.equal(ownInvoice.status, 200);
  const detail = await ownInvoice.json();
  assert.equal(detail.total, 1000);
  assert.equal(detail.items.length, 1);
});

test('client sessions cannot reach admin APIs or another client invoice', async () => {
  const { cookie } = await loginClient('9800011102', edgecombeCode);
  for (const path of ['/api/invoices', '/api/orders', '/api/stats', '/api/client-accounts']) {
    const response = await jsonRequest(base, path, { cookie });
    assert.equal(response.status, 401, path);
  }
  const missing = await jsonRequest(base, '/api/client/invoices/999', { cookie });
  assert.equal(missing.status, 404);
});

test('draft invoices stay hidden from the client', async () => {
  const draft = await jsonRequest(base, '/api/invoices', {
    method: 'POST',
    cookie: adminCookie,
    headers: { 'Idempotency-Key': 'draft-invisible-001' },
    body: {
      client_name: 'Northstar Digital',
      client_email: 'ananya@northstar.example',
      issue_date: '2026-11-20',
      due_date: '2026-12-04',
      client_id: 1,
      items: [{ description: 'Pilot', qty: 1, rate: 1000 }]
    }
  });
  assert.equal(draft.status, 201);

  const { cookie } = await loginClient('9800011101', northstarCode);
  const invoices = await (await jsonRequest(base, '/api/client/invoices', { cookie })).json();
  assert.deepEqual(invoices, []);
  const hidden = await jsonRequest(base, '/api/client/invoices/' + (await draft.json()).id, { cookie });
  assert.equal(hidden.status, 404);
});

test('regenerating a code revokes sessions and the old code stops working', async () => {
  const { cookie } = await loginClient('9800011101', northstarCode);
  const regenerated = await jsonRequest(base, '/api/client-accounts/' + northstarId + '/regenerate', {
    method: 'POST', cookie: adminCookie
  });
  assert.equal(regenerated.status, 200);
  const newCode = (await regenerated.json()).code;
  assert.notEqual(newCode, northstarCode);

  const revoked = await jsonRequest(base, '/api/client/overview', { cookie });
  assert.equal(revoked.status, 401);
  const old = await loginClient('9800011101', northstarCode);
  assert.equal(old.response.status, 401);
  const fresh = await loginClient('9800011101', newCode);
  assert.equal(fresh.response.status, 200);
});

test('disabling an account blocks login and revokes active sessions', async () => {
  const { cookie } = await loginClient('9800011102', edgecombeCode);
  const disabled = await jsonRequest(base, '/api/client-accounts/' + edgecombeId, {
    method: 'PATCH', cookie: adminCookie, body: { status: 'disabled' }
  });
  assert.equal(disabled.status, 200);

  const revoked = await jsonRequest(base, '/api/client/overview', { cookie });
  assert.equal(revoked.status, 401);
  const blocked = await loginClient('9800011102', edgecombeCode);
  assert.equal(blocked.response.status, 401);
});

test('client pages are private and never cached', async () => {
  const anonymous = await fetch(base + '/client', { redirect: 'manual' });
  assert.equal(anonymous.status, 302);
  assert.equal(anonymous.headers.get('location'), '/client/login');
  assert.equal(anonymous.headers.get('cache-control'), 'no-store');

  const loginPage = await fetch(base + '/client/login');
  assert.equal(loginPage.status, 200);
  assert.equal(loginPage.headers.get('cache-control'), 'no-cache');

  const assets = ['/assets/js/portal.js', '/assets/css/portal.css'];
  for (const path of assets) {
    const asset = await fetch(base + path);
    assert.equal(asset.status, 200, path);
    assert.match(asset.headers.get('cache-control'), /must-revalidate/);
  }
});
