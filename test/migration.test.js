'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const { ROOT, tempDbPath, removeDb } = require('../test-support/helpers');

function runMigrations(dbPath) {
  return spawnSync(process.execPath, ['-e', "require('./server/db')"], {
    cwd: ROOT,
    env: { ...process.env, DB_PATH: dbPath },
    encoding: 'utf8'
  });
}

function createLegacyDb(dbPath, { orphanItem = false } = {}) {
  const db = new DatabaseSync(dbPath);
  try {
    db.exec(`
      CREATE TABLE invoices (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        number      TEXT NOT NULL UNIQUE,
        order_id    INTEGER,
        client_id   INTEGER,
        client_name TEXT NOT NULL,
        client_email TEXT,
        issue_date  TEXT NOT NULL,
        due_date    TEXT NOT NULL,
        tax_percent REAL NOT NULL DEFAULT 0,
        subtotal    INTEGER NOT NULL DEFAULT 0,
        tax_amount  INTEGER NOT NULL DEFAULT 0,
        total       INTEGER NOT NULL DEFAULT 0,
        status      TEXT NOT NULL DEFAULT 'draft',
        notes       TEXT,
        is_sample   INTEGER NOT NULL DEFAULT 0,
        created_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE invoice_items (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        invoice_id  INTEGER NOT NULL,
        description TEXT NOT NULL,
        qty         REAL NOT NULL DEFAULT 1,
        rate        INTEGER NOT NULL DEFAULT 0
      );
    `);

    db.prepare(`
      INSERT INTO invoices (
        id, number, client_name, client_email, issue_date, due_date,
        tax_percent, subtotal, tax_amount, total, status, notes
      ) VALUES (7, 'INV-2026-007', 'Legacy Co', 'legacy@example.com',
        '2026-01-01', '2026-01-15', 18, 150, 27, 177, 'sent', 'Migrated invoice')
    `).run();

    db.prepare(`
      INSERT INTO invoice_items (invoice_id, description, qty, rate)
      VALUES (?, 'Legacy work', 1.5, 100)
    `).run(orphanItem ? 99 : 7);
  } finally {
    db.close();
  }
}

function read(dbPath, work) {
  const db = new DatabaseSync(dbPath);
  try {
    return work(db);
  } finally {
    db.close();
  }
}

test('legacy invoices migrate without losing rows or amounts', () => {
  const dbPath = tempDbPath();
  try {
    createLegacyDb(dbPath);

    const migration = runMigrations(dbPath);
    assert.equal(migration.status, 0, migration.stderr || migration.stdout);

    const state = read(dbPath, (db) => ({
      invoice: db.prepare('SELECT * FROM invoices WHERE id = 7').get(),
      item: db.prepare('SELECT * FROM invoice_items WHERE invoice_id = 7').get(),
      invoiceColumns: db.prepare('PRAGMA table_info(invoices)').all().map((row) => row.name),
      itemColumns: db.prepare('PRAGMA table_info(invoice_items)').all().map((row) => row.name),
      invoiceFks: db.prepare('PRAGMA foreign_key_list(invoices)').all(),
      itemFks: db.prepare('PRAGMA foreign_key_list(invoice_items)').all(),
      sequence: db.prepare("SELECT value FROM app_meta WHERE key = 'invoice_seq'").get(),
      version: db.prepare('PRAGMA user_version').get(),
      violations: db.prepare('PRAGMA foreign_key_check').all(),
      counts: {
        orders: db.prepare('SELECT COUNT(*) AS n FROM orders').get().n,
        clients: db.prepare('SELECT COUNT(*) AS n FROM clients').get().n,
        invoices: db.prepare('SELECT COUNT(*) AS n FROM invoices').get().n
      }
    }));

    assert.equal(state.invoice.number, 'INV-2026-007');
    assert.equal(state.invoice.total, 177);
    assert.equal(state.invoice.status, 'sent');
    assert.equal(state.item.description, 'Legacy work');
    assert.equal(state.item.amount, 150);
    assert.ok(state.invoiceColumns.includes('discount_amount'));
    assert.ok(state.itemColumns.includes('amount'));
    assert.equal(state.invoiceFks.length, 2);
    assert.equal(state.itemFks.length, 1);
    assert.equal(state.sequence.value, '7');
    assert.equal(state.version.user_version, 3);
    assert.deepEqual(state.violations, []);
    // No demo rows are injected into a database that already holds business data.
    assert.equal(state.counts.orders, 0);
    assert.equal(state.counts.clients, 0);
    assert.equal(state.counts.invoices, 1);
  } finally {
    removeDb(dbPath);
  }
});

test('running the migration twice is idempotent', () => {
  const dbPath = tempDbPath();
  try {
    createLegacyDb(dbPath);
    assert.equal(runMigrations(dbPath).status, 0);

    const snapshot = () => read(dbPath, (db) => JSON.stringify({
      invoice: db.prepare('SELECT * FROM invoices ORDER BY id').all(),
      items: db.prepare('SELECT * FROM invoice_items ORDER BY id').all(),
      sequence: db.prepare("SELECT value FROM app_meta WHERE key = 'invoice_seq'").get(),
      fks: db.prepare('PRAGMA foreign_key_list(invoices)').all()
    }));

    const first = snapshot();
    const secondRun = runMigrations(dbPath);
    assert.equal(secondRun.status, 0, secondRun.stderr || secondRun.stdout);
    assert.equal(snapshot(), first);
  } finally {
    removeDb(dbPath);
  }
});

test('orphan items abort the migration before any table is rebuilt', () => {
  const dbPath = tempDbPath();
  try {
    createLegacyDb(dbPath, { orphanItem: true });

    const migration = runMigrations(dbPath);
    assert.notEqual(migration.status, 0);
    assert.match(migration.stderr, /reference missing invoices/);

    const state = read(dbPath, (db) => ({
      invoice: db.prepare('SELECT * FROM invoices WHERE id = 7').get(),
      orphan: db.prepare('SELECT * FROM invoice_items WHERE invoice_id = 99').get(),
      invoiceColumns: db.prepare('PRAGMA table_info(invoices)').all().map((row) => row.name),
      itemColumns: db.prepare('PRAGMA table_info(invoice_items)').all().map((row) => row.name),
      counts: {
        invoices: db.prepare('SELECT COUNT(*) AS n FROM invoices').get().n,
        items: db.prepare('SELECT COUNT(*) AS n FROM invoice_items').get().n
      }
    }));

    assert.equal(state.invoice.number, 'INV-2026-007');
    assert.equal(state.invoice.total, 177);
    assert.equal(state.orphan.description, 'Legacy work');
    assert.ok(!state.invoiceColumns.includes('discount_amount'));
    assert.ok(!state.itemColumns.includes('amount'));
    assert.equal(state.counts.invoices, 1);
    assert.equal(state.counts.items, 1);
  } finally {
    removeDb(dbPath);
  }
});
