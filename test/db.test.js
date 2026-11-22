'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { tempDbPath, removeDb } = require('../test-support/helpers');

const dbPath = tempDbPath();
process.env.DB_PATH = dbPath;

const db = require('../server/db');

after(() => {
  db.close();
  removeDb(dbPath);
});

test('the application connection enables foreign keys and WAL', () => {
  assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
  assert.equal(String(db.prepare('PRAGMA journal_mode').get().journal_mode).toLowerCase(), 'wal');
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
});

test('the schema has the financial columns and foreign keys', () => {
  const columns = (table) => db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name);

  assert.ok(columns('invoices').includes('discount_percent'));
  assert.ok(columns('invoices').includes('discount_amount'));
  assert.ok(columns('invoice_items').includes('amount'));
  assert.ok(columns('payments').includes('paid_at'));
  assert.ok(columns('invoice_requests').includes('payload_hash'));

  assert.equal(db.prepare('PRAGMA foreign_key_list(invoices)').all().length, 2);
  assert.equal(db.prepare('PRAGMA foreign_key_list(invoice_items)').all().length, 1);
  assert.equal(db.prepare('PRAGMA foreign_key_list(payments)').all().length, 1);
  assert.equal(db.prepare('PRAGMA foreign_key_list(invoice_requests)').all().length, 1);
});

test('supporting indexes exist and the version is recorded', () => {
  const names = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL")
    .all()
    .map((row) => row.name);
  for (const name of [
    'idx_invoices_status',
    'idx_invoices_sample',
    'idx_invoice_items_invoice',
    'idx_sessions_expires'
  ]) {
    assert.ok(names.includes(name), name);
  }
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 3);
});

test('fresh databases receive the seed records and a starting sequence', () => {
  const count = (table) => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
  assert.equal(count('orders'), 3);
  assert.equal(count('clients'), 3);
  assert.equal(count('invoices'), 1);
  assert.equal(count('invoice_items'), 1);

  const invoice = db.prepare('SELECT * FROM invoices WHERE is_sample = 1').get();
  assert.equal(invoice.number, 'INV-2026-001');
  assert.equal(invoice.total, 59000);
  assert.equal(invoice.status, 'sent');

  const sequence = db.prepare("SELECT value FROM app_meta WHERE key = 'invoice_seq'").get();
  assert.equal(sequence.value, '1');
});

test('the connection rejects orphan invoice items and clients', () => {
  assert.throws(
    () => db.prepare(`
      INSERT INTO invoice_items (invoice_id, description, qty, rate, amount)
      VALUES (999999, 'Orphan', 1, 100, 100)
    `).run(),
    /FOREIGN KEY/i
  );
  assert.throws(
    () => db.prepare('UPDATE invoices SET client_id = 999999 WHERE id = 1').run(),
    /FOREIGN KEY/i
  );
});

test('one payment per invoice is enforced by the database', () => {
  const invoice = db.prepare('SELECT id, total FROM invoices WHERE is_sample = 1').get();
  db.prepare('INSERT INTO payments (invoice_id, amount, method) VALUES (?, ?, ?)')
    .run(invoice.id, invoice.total, 'bank_transfer');
  assert.throws(
    () => db.prepare('INSERT INTO payments (invoice_id, amount, method) VALUES (?, ?, ?)')
      .run(invoice.id, invoice.total, 'cash'),
    /UNIQUE/i
  );
  assert.equal(
    db.prepare('SELECT COUNT(*) AS n FROM payments WHERE invoice_id = ?').get(invoice.id).n,
    1
  );
});
