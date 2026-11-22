'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  tempDbPath, removeDb, startServer, stopServer, cookieFrom, jsonRequest
} = require('../test-support/helpers');

const PASSWORD = 'turso-driver-password-1234';
const INVOICE = {
  client_name: 'Hosted Client',
  issue_date: '2026-11-21',
  due_date: '2026-12-05',
  tax_percent: 18,
  items: [{ description: 'Hosted work', qty: 2, rate: 1000 }]
};

function libsqlUrl(dbPath) {
  return `file:${dbPath.replace(/\\/g, '/')}`;
}

test('the hosted driver serves the API from a libSQL database', async () => {
  const dbPath = tempDbPath();
  const server = await startServer({
    password: PASSWORD,
    dbPath,
    env: { TURSO_DATABASE_URL: libsqlUrl(dbPath) }
  });

  try {
    const health = await jsonRequest(server.base, '/api/health');
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { ok: true, service: 'nexora' });

    const login = await jsonRequest(server.base, '/api/login', {
      method: 'POST',
      body: { password: PASSWORD }
    });
    assert.equal(login.status, 200);
    const cookie = cookieFrom(login);
    assert.ok(cookie.startsWith('nexora_admin='));

    const seeded = await (await jsonRequest(server.base, '/api/stats', { cookie })).json();
    assert.equal(seeded.orders.new, 2);
    assert.equal(seeded.invoices.sent, 1);

    const headers = { Cookie: cookie, 'Idempotency-Key': 'libsql-test-key-0001' };
    const first = await jsonRequest(server.base, '/api/invoices', {
      method: 'POST',
      body: INVOICE,
      headers
    });
    assert.equal(first.status, 201);
    const invoice = await first.json();
    assert.equal(invoice.total, 2360);
    assert.equal(invoice.number, 'INV-2026-002');

    const replay = await jsonRequest(server.base, '/api/invoices', {
      method: 'POST',
      body: INVOICE,
      headers
    });
    assert.equal(replay.status, 200);
    assert.equal(replay.headers.get('idempotent-replayed'), 'true');

    const sent = await jsonRequest(server.base, `/api/invoices/${invoice.id}`, {
      method: 'PATCH',
      body: { status: 'sent' },
      headers: { Cookie: cookie }
    });
    assert.equal(sent.status, 200);

    const paid = await jsonRequest(server.base, `/api/invoices/${invoice.id}`, {
      method: 'PATCH',
      body: { status: 'paid', payment: { amount: invoice.total, method: 'upi' } },
      headers: { Cookie: cookie }
    });
    assert.equal(paid.status, 200);

    const stats = await (await jsonRequest(server.base, '/api/stats', { cookie })).json();
    assert.equal(stats.invoices.paid, 1);
    assert.equal(stats.billed, 2360);
    assert.equal(stats.collected, 2360);
  } finally {
    await stopServer(server);
    removeDb(dbPath);
  }
});
