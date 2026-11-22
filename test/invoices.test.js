'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const money = require('../assets/js/money');
const {
  tempDbPath, removeDb, startServer, stopServer, cookieFrom, jsonRequest
} = require('../test-support/helpers');

const PASSWORD = 'test-admin-password-1234';
const BASE_INVOICE = {
  client_name: 'Test Client',
  client_email: 'billing@example.com',
  issue_date: '2026-11-19',
  due_date: '2026-12-03',
  tax_percent: 18,
  discount_percent: 0,
  notes: 'Batch 2 test',
  items: [{ description: 'Retainer', qty: 1, rate: 1000 }]
};

let server;
let base;
let dbPath;
let cookie;
let keyCounter = 0;

function nextKey(label) {
  keyCounter += 1;
  return `batch2-${label}-${keyCounter}`;
}

function readDb(work) {
  const db = new DatabaseSync(dbPath);
  try {
    return work(db);
  } finally {
    db.close();
  }
}

function invoiceCount() {
  return readDb((db) => db.prepare('SELECT COUNT(*) AS n FROM invoices').get().n);
}

function paymentCount(invoiceId) {
  return readDb((db) =>
    db.prepare('SELECT COUNT(*) AS n FROM payments WHERE invoice_id = ?').get(invoiceId).n
  );
}

function storedStatus(invoiceId) {
  return readDb((db) =>
    db.prepare('SELECT status FROM invoices WHERE id = ?').get(invoiceId).status
  );
}

/** Independently re-derives the documented KPI definitions from raw rows. */
function financialSnapshot() {
  return readDb((db) => {
    const invoices = db.prepare('SELECT status, is_sample, total FROM invoices').all();
    const payments = db.prepare(`
      SELECT p.amount, i.is_sample
      FROM payments p JOIN invoices i ON i.id = p.invoice_id
    `).all();
    const billed = invoices
      .filter((row) => !row.is_sample && (row.status === 'sent' || row.status === 'paid'))
      .reduce((sum, row) => sum + row.total, 0);
    const collected = payments
      .filter((row) => !row.is_sample)
      .reduce((sum, row) => sum + row.amount, 0);
    return { billed, collected, pending: Math.max(0, billed - collected) };
  });
}

async function loginTo(targetBase) {
  const res = await jsonRequest(targetBase, '/api/login', {
    method: 'POST',
    body: { password: PASSWORD }
  });
  assert.equal(res.status, 200);
  return cookieFrom(res);
}

async function postInvoice(payload, key, targetBase = base) {
  const res = await jsonRequest(targetBase, '/api/invoices', {
    method: 'POST',
    body: payload,
    cookie,
    headers: { 'Idempotency-Key': key }
  });
  let body = null;
  try {
    body = await res.json();
  } catch (_) {
    // Error responses always have JSON, but keep the helper tolerant.
  }
  return { res, body, key, targetBase };
}

async function create(payload, key, targetBase = base) {
  const result = await postInvoice({ ...BASE_INVOICE, ...payload }, key, targetBase);
  return result;
}

async function createOk(payload, label) {
  const result = await create(payload, nextKey(label));
  assert.equal(result.res.status, 201, JSON.stringify(result.body));
  return result.body;
}

async function patchInvoice(id, body) {
  const res = await jsonRequest(base, `/api/invoices/${id}`, {
    method: 'PATCH',
    body,
    cookie
  });
  return { res, body: await res.json() };
}

async function send(id) {
  const result = await patchInvoice(id, { status: 'sent' });
  assert.equal(result.res.status, 200, JSON.stringify(result.body));
  return result.body;
}

before(async () => {
  dbPath = tempDbPath();
  server = await startServer({ password: PASSWORD, dbPath });
  base = server.base;
  cookie = await loginTo(base);
});

after(async () => {
  await stopServer(server);
  removeDb(dbPath);
});

/* ----------------------------- calculations ---------------------------- */

test('integer quantities are calculated on the server', async () => {
  const invoice = await createOk({
    tax_percent: 18,
    items: [{ description: 'Retainer', qty: 2, rate: 1250 }]
  }, 'integer');

  assert.equal(invoice.subtotal, 2500);
  assert.equal(invoice.tax_amount, 450);
  assert.equal(invoice.total, 2950);
  assert.equal(invoice.items.length, 1);
  assert.equal(invoice.items[0].amount, 2500);
  assert.equal(invoice.status, 'draft');
  assert.match(invoice.number, /^INV-2026-\d{3,}$/);
});

test('decimal quantities and the browser preview produce identical totals', async () => {
  const payload = {
    tax_percent: 18,
    items: [
      { description: 'Hours', qty: 1.5, rate: 100 },
      { description: 'Rounding', qty: 1.234, rate: 100 }
    ]
  };
  const preview = money.compute(payload);
  const invoice = await createOk(payload, 'decimal');

  assert.deepEqual(
    [invoice.subtotal, invoice.tax_amount, invoice.total],
    [preview.subtotal, preview.tax_amount, preview.total]
  );
  assert.deepEqual(
    invoice.items.map((item) => item.amount),
    preview.items.map((item) => item.amount)
  );
  assert.equal(invoice.subtotal, 273);
  assert.equal(invoice.tax_amount, 49);
  assert.equal(invoice.total, 322);
});

test('discounts are deducted before tax', async () => {
  const invoice = await createOk({
    tax_percent: 18,
    discount_percent: 10,
    items: [{ description: 'Retainer', qty: 1, rate: 20000 }]
  }, 'discount');

  assert.equal(invoice.subtotal, 20000);
  assert.equal(invoice.discount_amount, 2000);
  assert.equal(invoice.tax_amount, 3240);
  assert.equal(invoice.total, 21240);
});

test('client-submitted totals are rejected, never trusted', async () => {
  const beforeCount = invoiceCount();
  for (const field of ['total', 'subtotal', 'tax_amount', 'discount_amount']) {
    const result = await create({ [field]: 1 }, nextKey('untrusted'));
    assert.equal(result.res.status, 400, field);
    assert.match(result.body.error, new RegExp(`Unexpected field "${field}"`));
  }
  assert.equal(invoiceCount(), beforeCount);
});

test('negative, zero and over-precise quantities are rejected', async () => {
  const beforeCount = invoiceCount();
  for (const qty of [-1, 0, 1.2345, '2']) {
    const result = await create({
      items: [{ description: 'Bad qty', qty, rate: 100 }]
    }, nextKey('bad-qty'));
    assert.equal(result.res.status, 400, `qty=${JSON.stringify(qty)}`);
  }
  assert.equal(invoiceCount(), beforeCount);
});

test('invalid unit prices are rejected', async () => {
  for (const rate of [0, -100, 100.5, '100', 1000000001]) {
    const result = await create({
      items: [{ description: 'Bad rate', qty: 1, rate }]
    }, nextKey('bad-rate'));
    assert.equal(result.res.status, 400, `rate=${JSON.stringify(rate)}`);
  }
});

/* ------------------------------ idempotency ---------------------------- */

test('invoice creation requires an idempotency key', async () => {
  const res = await jsonRequest(base, '/api/invoices', {
    method: 'POST',
    body: BASE_INVOICE,
    cookie
  });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /Idempotency-Key/);
});

test('a repeated request returns the original invoice', async () => {
  const payload = { ...BASE_INVOICE, client_name: 'Replay Client' };
  const key = nextKey('replay');
  const beforeCount = invoiceCount();

  const first = await create(payload, key);
  assert.equal(first.res.status, 201);
  assert.equal(first.res.headers.get('idempotent-replayed'), null);

  const second = await create(payload, key);
  assert.equal(second.res.status, 200);
  assert.equal(second.res.headers.get('idempotent-replayed'), 'true');
  assert.equal(second.body.id, first.body.id);
  assert.equal(invoiceCount(), beforeCount + 1);
});

test('reusing a key with different invoice data is rejected', async () => {
  const key = nextKey('conflict');
  const first = await create({ ...BASE_INVOICE, client_name: 'Conflict Client' }, key);
  assert.equal(first.res.status, 201);

  const second = await create({
    ...BASE_INVOICE,
    client_name: 'Conflict Client',
    items: [{ description: 'Retainer', qty: 1, rate: 2000 }]
  }, key);
  assert.equal(second.res.status, 409);
  assert.match(second.body.error, /different invoice/);

  const stored = readDb((db) =>
    db.prepare("SELECT COUNT(*) AS n FROM invoices WHERE client_name = 'Conflict Client'").get().n
  );
  assert.equal(stored, 1);
});

test('invoice references are unique and sequential', async () => {
  const created = [];
  for (let index = 0; index < 3; index += 1) {
    created.push(await createOk({ client_name: `Sequence ${index}` }, 'sequence'));
  }

  const numbers = created.map((invoice) => invoice.number);
  assert.equal(new Set(numbers).size, 3);
  for (const number of numbers) assert.match(number, /^INV-2026-\d{3,}$/);

  const distinct = readDb((db) =>
    db.prepare('SELECT COUNT(DISTINCT number) AS n FROM invoices').get().n
  );
  const total = invoiceCount();
  assert.equal(distinct, total);
});

test('concurrent creation from two server processes yields unique invoices', async () => {
  const second = await startServer({ password: PASSWORD, dbPath });
  try {
    const secondCookie = await loginTo(second.base);
    const beforeCount = invoiceCount();
    const requests = Array.from({ length: 6 }, (_, index) => {
      const targetBase = index % 2 === 0 ? base : second.base;
      const targetCookie = targetBase === base ? cookie : secondCookie;
      const res = jsonRequest(targetBase, '/api/invoices', {
        method: 'POST',
        body: {
          ...BASE_INVOICE,
          client_name: `Concurrent ${index}`,
          items: [{ description: 'Work', qty: 1, rate: 1000 + index }]
        },
        cookie: targetCookie,
        headers: { 'Idempotency-Key': nextKey(`concurrent-${index}`) }
      });
      return res.then(async (response) => ({
        response,
        body: await response.json()
      }));
    });

    const results = await Promise.all(requests);
    for (const result of results) {
      assert.equal(result.response.status, 201, JSON.stringify(result.body));
    }
    assert.equal(new Set(results.map((result) => result.body.id)).size, 6);
    assert.equal(new Set(results.map((result) => result.body.number)).size, 6);
    assert.equal(invoiceCount(), beforeCount + 6);
  } finally {
    await stopServer(second);
  }
});

/* ------------------------------ transactions --------------------------- */

test('a failed line item rolls back the whole invoice', async () => {
  readDb((db) => {
    db.exec(`
      CREATE TRIGGER fail_invoice_item
      BEFORE INSERT ON invoice_items
      WHEN NEW.description = 'FAIL'
      BEGIN
        SELECT RAISE(ABORT, 'forced item failure');
      END
    `);
  });

  try {
    const beforeCount = invoiceCount();
    const beforeItems = readDb((db) => db.prepare('SELECT COUNT(*) AS n FROM invoice_items').get().n);
    const beforeSeq = readDb((db) =>
      db.prepare("SELECT value FROM app_meta WHERE key = 'invoice_seq'").get().value
    );

    const result = await create({
      client_name: 'Rollback Client',
      items: [
        { description: 'Good line', qty: 1, rate: 1000 },
        { description: 'FAIL', qty: 1, rate: 1000 }
      ]
    }, nextKey('rollback'));

    assert.equal(result.res.status, 500);
    assert.deepEqual(result.body, { error: 'Server error.' });

    const after = readDb((db) => ({
      count: db.prepare('SELECT COUNT(*) AS n FROM invoices').get().n,
      seq: db.prepare("SELECT value FROM app_meta WHERE key = 'invoice_seq'").get().value,
      client: db.prepare("SELECT COUNT(*) AS n FROM invoices WHERE client_name = 'Rollback Client'").get().n,
      items: db.prepare('SELECT COUNT(*) AS n FROM invoice_items').get().n
    }));

    assert.equal(after.count, beforeCount);
    assert.equal(after.seq, beforeSeq);
    assert.equal(after.client, 0);
    assert.equal(after.items, beforeItems);
  } finally {
    readDb((db) => db.exec('DROP TRIGGER fail_invoice_item'));
  }
});

/* --------------------------- status & payments ------------------------- */

test('draft can be sent and then paid with a payment record', async () => {
  const draft = await createOk({ client_name: 'Workflow Client' }, 'workflow');
  assert.equal(draft.status, 'draft');

  const sent = await send(draft.id);
  assert.equal(sent.status, 'sent');

  const paid = await patchInvoice(draft.id, {
    status: 'paid',
    payment: { amount: sent.total, method: 'bank_transfer' }
  });
  assert.equal(paid.res.status, 200, JSON.stringify(paid.body));
  assert.equal(paid.body.status, 'paid');
  assert.equal(paid.body.payment.amount, sent.total);
  assert.equal(paid.body.payment.method, 'bank_transfer');
  assert.match(paid.body.payment.paid_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
});

test('draft can be cancelled', async () => {
  const draft = await createOk({ client_name: 'Cancelled Draft' }, 'cancel-draft');
  const cancelled = await patchInvoice(draft.id, { status: 'cancelled' });
  assert.equal(cancelled.res.status, 200);
  assert.equal(cancelled.body.status, 'cancelled');
});

test('invalid status transitions are rejected server-side', async () => {
  const draft = await createOk({ client_name: 'Invalid Draft' }, 'invalid-draft');
  const draftToPaid = await patchInvoice(draft.id, {
    status: 'paid',
    payment: { amount: draft.total, method: 'upi' }
  });
  assert.equal(draftToPaid.res.status, 409);
  assert.equal(storedStatus(draft.id), 'draft');

  const sent = await send(draft.id);
  assert.equal(sent.status, 'sent');

  const sentToDraft = await patchInvoice(draft.id, { status: 'draft' });
  assert.equal(sentToDraft.res.status, 409);
  assert.equal(storedStatus(draft.id), 'sent');

  const paid = await patchInvoice(draft.id, {
    status: 'paid',
    payment: { amount: sent.total, method: 'upi' }
  });
  assert.equal(paid.res.status, 200);

  for (const status of ['draft', 'sent', 'paid']) {
    const body = { status };
    if (status === 'paid') body.payment = { amount: sent.total, method: 'upi' };
    const res = await patchInvoice(draft.id, body);
    assert.equal(res.res.status, 409, `paid -> ${status}`);
    assert.equal(storedStatus(draft.id), 'paid');
  }

  const cancelled = await createOk({ client_name: 'Terminal Cancelled' }, 'terminal-cancelled');
  assert.equal((await patchInvoice(cancelled.id, { status: 'cancelled' })).res.status, 200);
  const cancelledToPaid = await patchInvoice(cancelled.id, {
    status: 'paid',
    payment: { amount: cancelled.total, method: 'cash' }
  });
  assert.equal(cancelledToPaid.res.status, 409);
  assert.equal(storedStatus(cancelled.id), 'cancelled');
});

test('payment amount and method are validated before anything is recorded', async () => {
  const draft = await createOk({
    client_name: 'Payment Validation',
    items: [{ description: 'Work', qty: 1, rate: 1000 }]
  }, 'payment-validation');
  const sent = await send(draft.id);
  assert.equal(sent.total, 1180);

  const attempts = [
    { status: 'paid' },
    { status: 'paid', payment: { amount: 1000, method: 'upi' } },
    { status: 'paid', payment: { amount: 1180.5, method: 'upi' } },
    { status: 'paid', payment: { amount: 1180, method: 'crypto' } },
    { status: 'paid', payment: { amount: 1180 } }
  ];

  for (const body of attempts) {
    const result = await patchInvoice(draft.id, body);
    assert.equal(result.res.status, 400, JSON.stringify(body));
  }

  assert.equal(storedStatus(draft.id), 'sent');
  assert.equal(paymentCount(draft.id), 0);

  const paid = await patchInvoice(draft.id, {
    status: 'paid',
    payment: { amount: 1180, method: 'upi' }
  });
  assert.equal(paid.res.status, 200);
  assert.equal(paid.body.payment.amount, 1180);
});

test('a second payment cannot be recorded for the same invoice', async () => {
  const draft = await createOk({ client_name: 'Duplicate Payment' }, 'duplicate-payment');
  const sent = await send(draft.id);
  const payment = { amount: sent.total, method: 'cash' };

  const first = await patchInvoice(draft.id, { status: 'paid', payment });
  assert.equal(first.res.status, 200);

  const second = await patchInvoice(draft.id, { status: 'paid', payment });
  assert.equal(second.res.status, 409);
  assert.equal(paymentCount(draft.id), 1);
});

test('payment history is returned with the invoice', async () => {
  const draft = await createOk({ client_name: 'History Client' }, 'history');
  const sent = await send(draft.id);
  const paid = await patchInvoice(draft.id, {
    status: 'paid',
    payment: { amount: sent.total, method: 'cheque' }
  });
  assert.equal(paid.res.status, 200);

  const fetched = await jsonRequest(base, `/api/invoices/${draft.id}`, { cookie });
  const invoice = await fetched.json();
  assert.equal(invoice.payments.length, 1);
  assert.equal(invoice.payment.id, invoice.payments[0].id);
  assert.equal(invoice.payment.method, 'cheque');

  const row = readDb((db) =>
    db.prepare('SELECT * FROM payments WHERE invoice_id = ?').get(draft.id)
  );
  assert.equal(row.amount, sent.total);
  assert.ok(row.paid_at);
});

/* ------------------------------ dashboard ------------------------------ */

test('dashboard KPIs exclude drafts, cancellations and demo rows', async () => {
  const before = financialSnapshot();
  const statsBefore = await (await jsonRequest(base, '/api/stats', { cookie })).json();
  assert.deepEqual(
    { billed: statsBefore.billed, collected: statsBefore.collected, pending: statsBefore.pending },
    before
  );

  const draft = await createOk({ client_name: 'KPI Draft' }, 'kpi-draft');
  const toCancel = await createOk({ client_name: 'KPI Cancelled' }, 'kpi-cancelled');
  assert.equal((await patchInvoice(toCancel.id, { status: 'cancelled' })).res.status, 200);

  const afterExcluded = await (await jsonRequest(base, '/api/stats', { cookie })).json();
  assert.equal(afterExcluded.billed, before.billed, 'draft and cancelled must not be billed');

  const sent = await createOk({
    client_name: 'KPI Sent',
    items: [{ description: 'Retainer', qty: 1, rate: 2000 }]
  }, 'kpi-sent');
  await send(sent.id);

  const afterSent = await (await jsonRequest(base, '/api/stats', { cookie })).json();
  assert.equal(afterSent.billed, before.billed + sent.total);
  assert.equal(afterSent.collected, before.collected);
  assert.equal(afterSent.pending, Math.max(0, before.billed + sent.total - before.collected));

  const paid = await patchInvoice(sent.id, {
    status: 'paid',
    payment: { amount: sent.total, method: 'upi' }
  });
  assert.equal(paid.res.status, 200);

  const afterPaid = await (await jsonRequest(base, '/api/stats', { cookie })).json();
  assert.equal(afterPaid.collected, before.collected + sent.total);
  assert.equal(afterPaid.pending, Math.max(0, before.billed - before.collected));
  assert.deepEqual(financialSnapshot(), {
    billed: afterPaid.billed,
    collected: afterPaid.collected,
    pending: afterPaid.pending
  });

  const sample = readDb((db) =>
    db.prepare('SELECT * FROM invoices WHERE is_sample = 1').get()
  );
  assert.ok(sample && sample.total === 59000);
  const allSentAndPaid = readDb((db) =>
    db.prepare("SELECT COALESCE(SUM(total), 0) AS amt FROM invoices WHERE status IN ('sent', 'paid')").get().amt
  );
  assert.equal(afterPaid.billed, allSentAndPaid - sample.total, 'demo invoice must not be billed');
  assert.equal(draft.status, 'draft');
});

/* --------------------------- integrity & data -------------------------- */

test('client and order references must exist', async () => {
  const beforeCount = invoiceCount();
  const badClient = await create({ client_id: 999999 }, nextKey('bad-client'));
  assert.equal(badClient.res.status, 400);
  assert.match(badClient.body.error, /Client 999999 does not exist/);

  const badOrder = await create({ order_id: 999999 }, nextKey('bad-order'));
  assert.equal(badOrder.res.status, 400);
  assert.match(badOrder.body.error, /Order 999999 does not exist/);

  assert.equal(invoiceCount(), beforeCount);
});

test('the schema declares foreign keys and supporting indexes', () => {
  const schema = readDb((db) => ({
    invoiceFks: db.prepare('PRAGMA foreign_key_list(invoices)').all(),
    itemFks: db.prepare('PRAGMA foreign_key_list(invoice_items)').all(),
    paymentFks: db.prepare('PRAGMA foreign_key_list(payments)').all(),
    indexes: db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL").all()
  }));

  assert.equal(schema.invoiceFks.length, 2);
  assert.equal(schema.itemFks.length, 1);
  assert.equal(schema.paymentFks.length, 1);
  const indexNames = schema.indexes.map((row) => row.name);
  for (const name of ['idx_invoices_status', 'idx_invoices_sample', 'idx_invoice_items_invoice']) {
    assert.ok(indexNames.includes(name), name);
  }
});

test('stored totals match the returned invoice and its line items', async () => {
  const created = await createOk({
    client_name: 'Stored Totals',
    tax_percent: 18,
    discount_percent: 5,
    items: [
      { description: 'Design', qty: 2.5, rate: 2000 },
      { description: 'Build', qty: 1, rate: 750 }
    ]
  }, 'stored-totals');

  const fetched = await jsonRequest(base, `/api/invoices/${created.id}`, { cookie });
  assert.equal(fetched.status, 200);
  const invoice = await fetched.json();

  const row = readDb((db) =>
    db.prepare('SELECT * FROM invoices WHERE id = ?').get(created.id)
  );
  for (const field of ['number', 'subtotal', 'discount_amount', 'tax_amount', 'total', 'status']) {
    assert.equal(invoice[field], row[field], field);
  }

  const itemSum = invoice.items.reduce((sum, item) => sum + item.amount, 0);
  assert.equal(itemSum, invoice.subtotal);
  for (const item of invoice.items) {
    assert.equal(item.amount, money.compute({
      items: [{ qty: item.qty, rate: item.rate }],
      tax_percent: 0
    }).total);
  }

  const recomputed = money.compute({
    items: invoice.items,
    tax_percent: invoice.tax_percent,
    discount_percent: invoice.discount_percent
  });
  assert.equal(recomputed.subtotal, invoice.subtotal);
  assert.equal(recomputed.discount_amount, invoice.discount_amount);
  assert.equal(recomputed.tax_amount, invoice.tax_amount);
  assert.equal(recomputed.total, invoice.total);

  const page = await fetch(base + `/invoice/${created.id}`, {
    headers: { Cookie: cookie },
    redirect: 'manual'
  });
  assert.equal(page.status, 200);
});

test('existing clients, orders, invoices and items are preserved', () => {
  const preserved = readDb((db) => ({
    orders: db.prepare('SELECT COUNT(*) AS n FROM orders').get().n,
    clients: db.prepare('SELECT COUNT(*) AS n FROM clients').get().n,
    sampleInvoice: db.prepare('SELECT * FROM invoices WHERE is_sample = 1').get(),
    sampleItem: db.prepare('SELECT * FROM invoice_items WHERE invoice_id = 1').get(),
    invoicesWithoutItems: db.prepare(`
      SELECT COUNT(*) AS n FROM invoices i
      WHERE NOT EXISTS (SELECT 1 FROM invoice_items it WHERE it.invoice_id = i.id)
    `).get().n
  }));

  assert.equal(preserved.orders, 3);
  assert.equal(preserved.clients, 3);
  assert.ok(preserved.sampleInvoice);
  assert.equal(preserved.sampleInvoice.number, 'INV-2026-001');
  assert.equal(preserved.sampleInvoice.total, 59000);
  assert.equal(preserved.sampleInvoice.status, 'sent');
  assert.ok(preserved.sampleItem);
  assert.equal(preserved.sampleItem.amount, 50000);
  assert.equal(preserved.invoicesWithoutItems, 0);
});
