'use strict';

const { AsyncLocalStorage } = require('node:async_hooks');
const { createClient } = require('@libsql/client');
const { HOSTED_SCHEMA_SQL, INDEXES_SQL } = require('./schema');
const seedData = require('./seed-data');

// libSQL rejects undefined and boolean bind parameters, while node:sqlite
// tolerates them. Normalising here keeps every SQL call site identical.
function normalizeArgs(args) {
  return (args || []).map((value) => {
    if (value === undefined) return null;
    if (typeof value === 'boolean') return value ? 1 : 0;
    return value;
  });
}

function normalizeRow(row) {
  const result = {};
  for (const [key, value] of Object.entries(row)) {
    result[key] = typeof value === 'bigint' ? Number(value) : value;
  }
  return result;
}

/**
 * Hosted SQLite driver. Uses one libSQL connection per statement and an
 * AsyncLocalStorage-backed transaction context so nested prepare() calls from
 * the domain services run on the same write transaction.
 */
function createRemoteDriver({ url, authToken }) {
  const client = createClient({ url, authToken: authToken || undefined });
  const transactionStorage = new AsyncLocalStorage();
  const runner = () => transactionStorage.getStore() || client;

  async function get(sql, args) {
    const result = await runner().execute({ sql, args: normalizeArgs(args) });
    return result.rows.length ? normalizeRow(result.rows[0]) : undefined;
  }

  async function all(sql, args) {
    const result = await runner().execute({ sql, args: normalizeArgs(args) });
    return result.rows.map(normalizeRow);
  }

  async function run(sql, args) {
    const result = await runner().execute({ sql, args: normalizeArgs(args) });
    return {
      changes: Number(result.rowsAffected),
      lastInsertRowid: Number(result.lastInsertRowid)
    };
  }

  async function transaction(work) {
    const tx = await client.transaction('write');
    try {
      const result = await transactionStorage.run(tx, work);
      await tx.commit();
      return result;
    } catch (error) {
      await tx.rollback();
      throw error;
    }
  }

  async function assertCurrentSchema() {
    const invoiceColumns = (await all('PRAGMA table_info(invoices)')).map((row) => row.name);
    const itemColumns = (await all('PRAGMA table_info(invoice_items)')).map((row) => row.name);
    const missing = [];
    if (!invoiceColumns.includes('discount_amount')) missing.push('invoices.discount_amount');
    if (!itemColumns.includes('amount')) missing.push('invoice_items.amount');
    if (missing.length) {
      throw new Error(
        `Turso database has a legacy schema (missing ${missing.join(', ')}). ` +
          'Import a migrated local database or create a fresh Turso database.'
      );
    }
  }

  async function seedIfEmpty() {
    const existing = (await get(`
      SELECT
        (SELECT COUNT(*) FROM orders) +
        (SELECT COUNT(*) FROM clients) +
        (SELECT COUNT(*) FROM invoices) AS n
    `)).n;
    if (existing > 0) return;

    for (const row of seedData.ORDERS) await run(seedData.ORDER_SQL, row);
    for (const row of seedData.CLIENTS) await run(seedData.CLIENT_SQL, row);
    const seeded = await run(seedData.INVOICE_SQL, seedData.INVOICE.row);
    await run(seedData.INVOICE_ITEM_SQL, [seeded.lastInsertRowid, ...seedData.INVOICE.item]);
  }

  async function seedOutreachIfEmpty() {
    const existing = (await get('SELECT COUNT(*) AS n FROM outreach_leads')).n;
    if (existing > 0) return;
    for (const row of seedData.OUTREACH_LEADS) await run(seedData.OUTREACH_SQL, row);
  }

  async function initInvoiceSequence() {
    if (await get("SELECT value FROM app_meta WHERE key = 'invoice_seq'")) return;

    let maximum = 0;
    for (const row of await all('SELECT number FROM invoices')) {
      const match = /^INV-\d{4}-(\d+)$/.exec(row.number);
      if (match) maximum = Math.max(maximum, Number(match[1]));
    }
    await run("INSERT INTO app_meta (key, value) VALUES ('invoice_seq', ?)", [String(maximum)]);
  }

  let initPromise;
  function init() {
    if (!initPromise) {
      initPromise = (async () => {
        await client.executeMultiple(HOSTED_SCHEMA_SQL);
        await assertCurrentSchema();
        await client.executeMultiple(INDEXES_SQL);
        await seedIfEmpty();
        await seedOutreachIfEmpty();
        await initInvoiceSequence();
      })();
    }
    return initPromise;
  }

  return {
    isRemote: true,
    init,
    prepare: (sql) => ({
      get: (...args) => get(sql, args),
      all: (...args) => all(sql, args),
      run: (...args) => run(sql, args)
    }),
    exec: (sql) => client.executeMultiple(sql),
    transaction,
    close: () => client.close()
  };
}

module.exports = { createRemoteDriver };
