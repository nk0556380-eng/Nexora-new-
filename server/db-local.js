'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const {
  SCHEMA_SQL,
  INVOICES_TABLE_SQL,
  INVOICE_ITEMS_TABLE_SQL,
  INDEXES_SQL
} = require('./schema');
const seedData = require('./seed-data');

/**
 * Local SQLite driver used for development and the test suite. It keeps the
 * synchronous node:sqlite API; callers await the facade, which is also valid
 * for the plain values returned here.
 */
function createLocalDriver() {
  const dataDir = path.join(__dirname, '..', 'private', 'data');
  fs.mkdirSync(dataDir, { recursive: true });

  const dbPath = process.env.DB_PATH
    ? path.resolve(process.env.DB_PATH)
    : path.join(dataDir, 'nexora.db');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const connection = new DatabaseSync(dbPath);
  connection.exec(SCHEMA_SQL);

  function columnsOf(table) {
    return connection.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name);
  }

  function foreignKeysOf(table) {
    return connection.prepare(`PRAGMA foreign_key_list(${table})`).all();
  }

  function migrateInvoiceSchema() {
    const invoiceColumns = columnsOf('invoices');
    const itemColumns = columnsOf('invoice_items');
    const needsInvoices = !invoiceColumns.includes('discount_amount') || foreignKeysOf('invoices').length < 2;
    const needsItems = !itemColumns.includes('amount') || foreignKeysOf('invoice_items').length < 1;
    if (!needsInvoices && !needsItems) return;

    const orphanItems = connection
      .prepare('SELECT COUNT(*) AS n FROM invoice_items WHERE invoice_id NOT IN (SELECT id FROM invoices)')
      .get().n;
    if (orphanItems > 0) {
      throw new Error(
        `${orphanItems} invoice item(s) reference missing invoices. ` +
          'Repair the data before starting; the migration will not delete rows.'
      );
    }

    const discountPercent = invoiceColumns.includes('discount_percent') ? 'discount_percent' : '0';
    const discountAmount = invoiceColumns.includes('discount_amount') ? 'discount_amount' : '0';
    const itemAmount = itemColumns.includes('amount')
      ? 'amount'
      : 'CAST(ROUND(qty * rate) AS INTEGER)';

    connection.exec('PRAGMA foreign_keys = OFF');
    try {
      connection.exec('BEGIN IMMEDIATE');
      if (needsInvoices) {
        connection.exec(INVOICES_TABLE_SQL);
        connection.exec(`
          INSERT INTO invoices_new (
            id, number, order_id, client_id, client_name, client_email, issue_date, due_date,
            tax_percent, subtotal, discount_percent, discount_amount, tax_amount, total,
            status, notes, is_sample, created_at
          )
          SELECT
            id, number,
            CASE WHEN order_id IN (SELECT id FROM orders) THEN order_id END,
            CASE WHEN client_id IN (SELECT id FROM clients) THEN client_id END,
            client_name, client_email, issue_date, due_date,
            tax_percent, subtotal, ${discountPercent}, ${discountAmount}, tax_amount, total,
            status, notes, is_sample, created_at
          FROM invoices
        `);
        connection.exec('DROP TABLE invoices');
        connection.exec('ALTER TABLE invoices_new RENAME TO invoices');
      }
      if (needsItems) {
        connection.exec(INVOICE_ITEMS_TABLE_SQL);
        connection.exec(`
          INSERT INTO invoice_items_new (id, invoice_id, description, qty, rate, amount)
          SELECT id, invoice_id, description, qty, rate, ${itemAmount}
          FROM invoice_items
        `);
        connection.exec('DROP TABLE invoice_items');
        connection.exec('ALTER TABLE invoice_items_new RENAME TO invoice_items');
      }
      connection.exec('COMMIT');
    } catch (error) {
      try {
        connection.exec('ROLLBACK');
      } catch (_) {
        // The transaction may already have rolled back.
      }
      throw error;
    } finally {
      connection.exec('PRAGMA foreign_keys = ON');
    }
  }

  migrateInvoiceSchema();
  connection.exec(INDEXES_SQL);

  const violations = connection.prepare('PRAGMA foreign_key_check').all();
  if (violations.length) {
    throw new Error(`Foreign key check failed for ${violations.length} row(s); refusing to start.`);
  }

  const sessionColumns = columnsOf('sessions');
  if (!sessionColumns.includes('expires_at')) {
    connection.exec('ALTER TABLE sessions ADD COLUMN expires_at TEXT');
    connection.exec('DELETE FROM sessions');
  }

  function initInvoiceSequence() {
    const existing = connection.prepare("SELECT value FROM app_meta WHERE key = 'invoice_seq'").get();
    if (existing) return;

    let maximum = 0;
    for (const row of connection.prepare('SELECT number FROM invoices').all()) {
      const match = /^INV-\d{4}-(\d+)$/.exec(row.number);
      if (match) maximum = Math.max(maximum, Number(match[1]));
    }
    connection.prepare("INSERT INTO app_meta (key, value) VALUES ('invoice_seq', ?)").run(String(maximum));
  }

  function seed() {
    const existing = connection.prepare(`
      SELECT
        (SELECT COUNT(*) FROM orders) +
        (SELECT COUNT(*) FROM clients) +
        (SELECT COUNT(*) FROM invoices) AS n
    `).get().n;
    if (existing > 0) return;

    const addOrder = connection.prepare(seedData.ORDER_SQL);
    for (const row of seedData.ORDERS) addOrder.run(...row);

    const addClient = connection.prepare(seedData.CLIENT_SQL);
    for (const row of seedData.CLIENTS) addClient.run(...row);

    const addInvoice = connection.prepare(seedData.INVOICE_SQL);
    const seeded = addInvoice.run(...seedData.INVOICE.row);
    connection.prepare(seedData.INVOICE_ITEM_SQL)
      .run(Number(seeded.lastInsertRowid), ...seedData.INVOICE.item);
  }

  function seedOutreach() {
    const existing = connection.prepare('SELECT COUNT(*) AS n FROM outreach_leads').get().n;
    if (existing > 0) return;
    const addLead = connection.prepare(seedData.OUTREACH_SQL);
    for (const row of seedData.OUTREACH_LEADS) addLead.run(...row);
  }

  seed();
  seedOutreach();
  initInvoiceSequence();
  connection.exec('PRAGMA user_version = 3');

  // Callers always await transactions, so the local driver must keep its
  // single connection inside the transaction across async boundaries. A small
  // queue prevents two concurrent requests from opening nested transactions.
  let transactionQueue = Promise.resolve();
  function transaction(work) {
    const current = transactionQueue.then(async () => {
      connection.exec('BEGIN IMMEDIATE');
      try {
        const result = await work();
        connection.exec('COMMIT');
        return result;
      } catch (error) {
        try {
          connection.exec('ROLLBACK');
        } catch (_) {
          // The transaction may already have rolled back.
        }
        throw error;
      }
    });
    transactionQueue = current.catch(() => {});
    return current;
  }

  return {
    isRemote: false,
    init: async () => {},
    prepare: (sql) => connection.prepare(sql),
    exec: (sql) => connection.exec(sql),
    transaction,
    close: () => connection.close()
  };
}

module.exports = { createLocalDriver };
