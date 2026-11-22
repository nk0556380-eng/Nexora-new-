'use strict';

/*
 * Invoice domain service.
 *
 * The server owns invoice arithmetic, numbering, status transitions and
 * payment records. The browser uses the same `assets/js/money.js` module for
 * its preview, so there is exactly one rounding rule.
 */

const crypto = require('node:crypto');
const db = require('./db');
const money = require('../assets/js/money');
const { ValidationError } = require('./validate');

const STATUSES = Object.freeze(['draft', 'sent', 'paid', 'cancelled']);

// Money is only collected after an invoice has been sent. Paid and cancelled
// are terminal for this version: refunds and re-issuing are out of scope.
const TRANSITIONS = Object.freeze({
  draft: Object.freeze(['sent', 'cancelled']),
  sent: Object.freeze(['paid', 'cancelled']),
  paid: Object.freeze([]),
  cancelled: Object.freeze([])
});

const PAYMENT_METHODS = Object.freeze(['bank_transfer', 'upi', 'card', 'cash', 'cheque', 'other']);
const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{8,128}$/;

/** A safe, deliberately exposed domain error. */
class InvoiceError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'InvoiceError';
    this.status = status;
    this.expose = true;
  }
}

async function readInvoice(id) {
  const invoice = await db.prepare('SELECT * FROM invoices WHERE id = ?').get(id);
  if (!invoice) return null;

  const items = await db
    .prepare('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY id')
    .all(id);
  const payments = await db
    .prepare('SELECT * FROM payments WHERE invoice_id = ? ORDER BY id')
    .all(id);

  return { ...invoice, items, payment: payments[0] || null, payments };
}

async function listInvoices() {
  const invoices = await db
    .prepare('SELECT * FROM invoices ORDER BY datetime(created_at) DESC, id DESC')
    .all();
  const items = await db.prepare('SELECT * FROM invoice_items ORDER BY id').all();
  const payments = await db.prepare('SELECT * FROM payments ORDER BY id').all();

  const itemsByInvoice = new Map();
  for (const item of items) {
    const list = itemsByInvoice.get(item.invoice_id) || [];
    list.push(item);
    itemsByInvoice.set(item.invoice_id, list);
  }

  const paymentByInvoice = new Map();
  for (const payment of payments) {
    const list = paymentByInvoice.get(payment.invoice_id) || [];
    list.push(payment);
    paymentByInvoice.set(payment.invoice_id, list);
  }

  return invoices.map((invoice) => {
    const invoicePayments = paymentByInvoice.get(invoice.id) || [];
    return {
      ...invoice,
      items: itemsByInvoice.get(invoice.id) || [],
      payment: invoicePayments[0] || null,
      payments: invoicePayments
    };
  });
}

function assertIdempotencyKey(value) {
  if (typeof value !== 'string' || !IDEMPOTENCY_KEY.test(value)) {
    throw new ValidationError(
      'Idempotency-Key header must be 8-128 characters using letters, numbers, hyphen or underscore.'
    );
  }
  return value;
}

async function assertExists(table, id, label) {
  if (id === null || id === undefined) return;
  const row = await db.prepare(`SELECT id FROM ${table} WHERE id = ?`).get(id);
  if (!row) throw new InvoiceError(400, `${label} ${id} does not exist.`);
}

/**
 * Consumes the next number from app_meta inside the caller's write
 * transaction. The year prefix follows the issue date; the counter is global
 * and monotonic, so two invoices can never share a number.
 */
async function nextInvoiceNumber(issueDate) {
  const year = issueDate.slice(0, 4);
  const row = await db.prepare("SELECT value FROM app_meta WHERE key = 'invoice_seq'").get();
  let counter = row ? Number.parseInt(row.value, 10) : 0;
  if (!Number.isSafeInteger(counter) || counter < 0) {
    throw new Error('Invoice sequence in app_meta is corrupt.');
  }

  let number;
  do {
    counter += 1;
    number = `INV-${year}-${String(counter).padStart(3, '0')}`;
  } while (await db.prepare('SELECT 1 FROM invoices WHERE number = ?').get(number));

  const write = row
    ? db.prepare("UPDATE app_meta SET value = ? WHERE key = 'invoice_seq'")
    : db.prepare("INSERT INTO app_meta (key, value) VALUES ('invoice_seq', ?)");
  await write.run(String(counter));
  return number;
}

function requestHash(data) {
  // Fixed key order: the same invoice always produces the same hash.
  return crypto
    .createHash('sha256')
    .update(JSON.stringify([
      data.clientId,
      data.orderId,
      data.clientName,
      data.clientEmail,
      data.issueDate,
      data.dueDate,
      data.taxPercent,
      data.discountPercent,
      data.notes,
      data.items.map((item) => [item.description, item.qty, item.rate])
    ]))
    .digest('hex');
}

async function createInvoice({ input, idempotencyKey }) {
  const key = assertIdempotencyKey(idempotencyKey);
  const totals = money.compute({
    items: input.items,
    tax_percent: input.taxPercent,
    discount_percent: input.discountPercent
  });

  const hash = requestHash({
    clientId: input.clientId,
    orderId: input.orderId,
    clientName: input.clientName,
    clientEmail: input.clientEmail,
    issueDate: input.issueDate,
    dueDate: input.dueDate,
    taxPercent: totals.tax_percent,
    discountPercent: totals.discount_percent,
    notes: input.notes,
    items: totals.items
  });

  return db.transaction(async () => {
    const previous = await db
      .prepare('SELECT invoice_id, payload_hash FROM invoice_requests WHERE key = ?')
      .get(key);
    if (previous) {
      if (previous.payload_hash !== hash) {
        throw new InvoiceError(
          409,
          'This Idempotency-Key was already used for a different invoice.'
        );
      }
      return { invoice: await readInvoice(previous.invoice_id), created: false };
    }

    await assertExists('clients', input.clientId, 'Client');
    await assertExists('orders', input.orderId, 'Order');

    const number = await nextInvoiceNumber(input.issueDate);
    const result = await db.prepare(`
      INSERT INTO invoices (
        number, order_id, client_id, client_name, client_email, issue_date, due_date,
        tax_percent, subtotal, discount_percent, discount_amount, tax_amount, total,
        status, notes
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?)
    `).run(
      number,
      input.orderId,
      input.clientId,
      input.clientName,
      input.clientEmail,
      input.issueDate,
      input.dueDate,
      totals.tax_percent,
      totals.subtotal,
      totals.discount_percent,
      totals.discount_amount,
      totals.tax_amount,
      totals.total,
      input.notes
    );

    const id = Number(result.lastInsertRowid);
    const addItem = db.prepare(
      'INSERT INTO invoice_items (invoice_id, description, qty, rate, amount) VALUES (?, ?, ?, ?, ?)'
    );
    for (const item of totals.items) {
      await addItem.run(id, item.description, item.qty, item.rate, item.amount);
    }

    await db.prepare(
      'INSERT INTO invoice_requests (key, invoice_id, payload_hash) VALUES (?, ?, ?)'
    ).run(key, id, hash);

    return { invoice: await readInvoice(id), created: true };
  });
}

async function recordPayment(invoice, payment) {
  if (!payment) {
    throw new ValidationError('Payment details are required to mark an invoice paid.');
  }
  if (!Number.isInteger(payment.amount) || payment.amount < 1) {
    throw new ValidationError('"payment.amount" must be a positive whole number of rupees.');
  }
  if (payment.amount !== invoice.total) {
    throw new ValidationError(
      `Payment amount must equal the invoice total (₹${invoice.total}); partial payments are not supported.`
    );
  }
  if (!PAYMENT_METHODS.includes(payment.method)) {
    throw new ValidationError(`"payment.method" must be one of: ${PAYMENT_METHODS.join(', ')}.`);
  }

  const existing = await db.prepare('SELECT id FROM payments WHERE invoice_id = ?').get(invoice.id);
  if (existing) {
    throw new InvoiceError(409, 'A payment is already recorded for this invoice.');
  }

  await db.prepare('INSERT INTO payments (invoice_id, amount, method) VALUES (?, ?, ?)').run(
    invoice.id,
    payment.amount,
    payment.method
  );
}

async function changeStatus({ id, status, payment }) {
  return db.transaction(async () => {
    const invoice = await db.prepare('SELECT * FROM invoices WHERE id = ?').get(id);
    if (!invoice) throw new InvoiceError(404, 'Invoice not found.');

    const allowed = TRANSITIONS[invoice.status];
    if (!allowed) throw new Error(`Invoice ${id} has unknown status "${invoice.status}".`);
    if (!allowed.includes(status)) {
      const suffix = allowed.length ? ` Allowed next: ${allowed.join(', ')}.` : ' This status is final.';
      throw new InvoiceError(
        409,
        `Invoice cannot move from "${invoice.status}" to "${status}".${suffix}`
      );
    }

    if (status === 'paid') {
      await recordPayment(invoice, payment);
    } else if (payment !== undefined && payment !== null) {
      throw new ValidationError('Payment details are only accepted when marking an invoice paid.');
    }

    await db.prepare('UPDATE invoices SET status = ? WHERE id = ?').run(status, id);
    return await readInvoice(id);
  });
}

/**
 * Financial KPIs.
 *
 * billed    sum of totals for real invoices in sent or paid state.
 * collected sum of recorded payment amounts on real invoices.
 * pending   billed minus collected; the genuine unpaid balance.
 *
 * Drafts, cancelled invoices and sample/demo rows are never revenue.
 */
async function getStats() {
  const rows = await db
    .prepare(`
      SELECT status, is_sample, COUNT(*) AS n, COALESCE(SUM(total), 0) AS amt
      FROM invoices
      GROUP BY status, is_sample
    `)
    .all();

  const counts = {};
  for (const row of rows) counts[row.status] = (counts[row.status] || 0) + row.n;

  const billed = rows
    .filter((row) => !row.is_sample && (row.status === 'sent' || row.status === 'paid'))
    .reduce((sum, row) => sum + row.amt, 0);

  const collected = (await db
    .prepare(`
      SELECT COALESCE(SUM(p.amount), 0) AS amt
      FROM payments p
      JOIN invoices i ON i.id = p.invoice_id
      WHERE i.is_sample = 0
    `)
    .get()).amt;

  return {
    invoices: {
      draft: counts.draft || 0,
      sent: counts.sent || 0,
      paid: counts.paid || 0,
      cancelled: counts.cancelled || 0
    },
    billed,
    collected,
    pending: Math.max(0, billed - collected)
  };
}

module.exports = {
  STATUSES,
  TRANSITIONS,
  PAYMENT_METHODS,
  InvoiceError,
  readInvoice,
  listInvoices,
  createInvoice,
  changeStatus,
  getStats
};
