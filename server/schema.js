'use strict';

// Shared SQLite schema. Both the local node:sqlite driver and the hosted
// libSQL/Turso driver create the same database shape from these statements.

const SCHEMA_SQL = `
  PRAGMA busy_timeout = 5000;
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS orders (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    ref         TEXT NOT NULL UNIQUE,
    name        TEXT NOT NULL,
    agency      TEXT NOT NULL,
    email       TEXT NOT NULL,
    phone       TEXT,
    service     TEXT,
    message     TEXT,
    status      TEXT NOT NULL DEFAULT 'new',
    is_sample   INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS clients (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    agency          TEXT NOT NULL,
    contact_name    TEXT NOT NULL,
    email           TEXT NOT NULL,
    phone           TEXT,
    website         TEXT,
    city            TEXT,
    services       TEXT,
    target_profile  TEXT,
    list_source     TEXT,
    monthly_volume  TEXT,
    notes           TEXT,
    consent         INTEGER NOT NULL DEFAULT 0,
    status          TEXT NOT NULL DEFAULT 'pending',
    is_sample       INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS invoices (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    number           TEXT NOT NULL UNIQUE,
    order_id         INTEGER REFERENCES orders(id) ON DELETE SET NULL,
    client_id        INTEGER REFERENCES clients(id) ON DELETE SET NULL,
    client_name      TEXT NOT NULL,
    client_email     TEXT,
    issue_date       TEXT NOT NULL,
    due_date         TEXT NOT NULL,
    tax_percent      REAL NOT NULL DEFAULT 0,
    subtotal         INTEGER NOT NULL DEFAULT 0,
    discount_percent REAL NOT NULL DEFAULT 0,
    discount_amount  INTEGER NOT NULL DEFAULT 0,
    tax_amount       INTEGER NOT NULL DEFAULT 0,
    total            INTEGER NOT NULL DEFAULT 0,
    status           TEXT NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft', 'sent', 'paid', 'cancelled')),
    notes            TEXT,
    is_sample        INTEGER NOT NULL DEFAULT 0,
    created_at       TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS invoice_items (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id  INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    description TEXT NOT NULL,
    qty         REAL NOT NULL DEFAULT 1,
    rate        INTEGER NOT NULL DEFAULT 0,
    amount      INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS payments (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id INTEGER NOT NULL UNIQUE REFERENCES invoices(id) ON DELETE RESTRICT,
    amount     INTEGER NOT NULL CHECK (amount > 0),
    method     TEXT NOT NULL DEFAULT 'unspecified',
    paid_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS invoice_requests (
    key          TEXT PRIMARY KEY,
    invoice_id   INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    payload_hash TEXT NOT NULL,
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token       TEXT PRIMARY KEY,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS client_accounts (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id     INTEGER REFERENCES clients(id) ON DELETE SET NULL,
    agency        TEXT NOT NULL,
    contact_name  TEXT NOT NULL,
    phone         TEXT NOT NULL UNIQUE,
    email         TEXT,
    code_hash     TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active', 'disabled')),
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS client_sessions (
    token       TEXT PRIMARY KEY,
    account_id  INTEGER NOT NULL REFERENCES client_accounts(id) ON DELETE CASCADE,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS app_meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS outreach_leads (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    handle          TEXT NOT NULL UNIQUE,
    agency          TEXT NOT NULL,
    city            TEXT,
    niche           TEXT,
    website         TEXT,
    followers       INTEGER NOT NULL DEFAULT 0 CHECK (followers >= 0),
    post_count      INTEGER NOT NULL DEFAULT 0 CHECK (post_count >= 0),
    last_post_on    TEXT,
    avg_likes       INTEGER NOT NULL DEFAULT 0 CHECK (avg_likes >= 0),
    bio             TEXT,
    has_link        INTEGER NOT NULL DEFAULT 0 CHECK (has_link IN (0, 1)),
    has_cta         INTEGER NOT NULL DEFAULT 0 CHECK (has_cta IN (0, 1)),
    highlight_count INTEGER NOT NULL DEFAULT 0 CHECK (highlight_count >= 0),
    reels_share     INTEGER CHECK (reels_share BETWEEN 0 AND 100),
    status          TEXT NOT NULL DEFAULT 'new'
                    CHECK (status IN ('new', 'audited', 'dm_sent', 'replied', 'converted', 'skipped')),
    score           INTEGER CHECK (score BETWEEN 0 AND 100),
    problems        TEXT NOT NULL DEFAULT '[]',
    summary         TEXT,
    drafts          TEXT NOT NULL DEFAULT '[]',
    audit_model     TEXT,
    ai_used         INTEGER NOT NULL DEFAULT 0 CHECK (ai_used IN (0, 1)),
    audited_at      TEXT,
    is_sample       INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
  CREATE INDEX IF NOT EXISTS idx_client_sessions_expires ON client_sessions(expires_at);
  CREATE INDEX IF NOT EXISTS idx_outreach_status ON outreach_leads(status);
  CREATE INDEX IF NOT EXISTS idx_outreach_score ON outreach_leads(score);
`;

// Turso does not let tenants change journaling or connection pragmas.
const HOSTED_SCHEMA_SQL = SCHEMA_SQL
  .replace('PRAGMA busy_timeout = 5000;', '')
  .replace('PRAGMA journal_mode = WAL;', '')
  .replace('PRAGMA foreign_keys = ON;', '');

const INVOICES_TABLE_SQL = `
  CREATE TABLE invoices_new (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    number           TEXT NOT NULL UNIQUE,
    order_id         INTEGER REFERENCES orders(id) ON DELETE SET NULL,
    client_id        INTEGER REFERENCES clients(id) ON DELETE SET NULL,
    client_name      TEXT NOT NULL,
    client_email     TEXT,
    issue_date       TEXT NOT NULL,
    due_date         TEXT NOT NULL,
    tax_percent      REAL NOT NULL DEFAULT 0,
    subtotal         INTEGER NOT NULL DEFAULT 0,
    discount_percent REAL NOT NULL DEFAULT 0,
    discount_amount  INTEGER NOT NULL DEFAULT 0,
    tax_amount       INTEGER NOT NULL DEFAULT 0,
    total            INTEGER NOT NULL DEFAULT 0,
    status           TEXT NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft', 'sent', 'paid', 'cancelled')),
    notes            TEXT,
    is_sample        INTEGER NOT NULL DEFAULT 0,
    created_at       TEXT NOT NULL DEFAULT (datetime('now'))
  )
`;

const INVOICE_ITEMS_TABLE_SQL = `
  CREATE TABLE invoice_items_new (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id  INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    description TEXT NOT NULL,
    qty         REAL NOT NULL DEFAULT 1,
    rate        INTEGER NOT NULL DEFAULT 0,
    amount      INTEGER NOT NULL DEFAULT 0
  )
`;

const INDEXES_SQL = `
  CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
  CREATE INDEX IF NOT EXISTS idx_invoices_sample ON invoices(is_sample);
  CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice ON invoice_items(invoice_id);
`;

module.exports = {
  SCHEMA_SQL,
  HOSTED_SCHEMA_SQL,
  INVOICES_TABLE_SQL,
  INVOICE_ITEMS_TABLE_SQL,
  INDEXES_SQL
};
