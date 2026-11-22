'use strict';

const crypto = require('node:crypto');
const db = require('./db');

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const GENERATED_CODE_LENGTH = 8;
const HASH_PREFIX = 'scrypt';
const SALT_BYTES = 16;
const KEY_BYTES = 32;

class ClientPortalError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'ClientPortalError';
    this.status = status;
    this.expose = true;
  }
}

function normalizePhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length > 10 ? digits.slice(-10) : digits;
}

function normalizeCode(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function formatCode(code) {
  return code.length === GENERATED_CODE_LENGTH
    ? `${code.slice(0, 4)}-${code.slice(4)}`
    : code;
}

function generateCode() {
  let code = '';
  for (let index = 0; index < GENERATED_CODE_LENGTH; index += 1) {
    code += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  }
  return code;
}

function hashCode(code) {
  const salt = crypto.randomBytes(SALT_BYTES).toString('hex');
  const key = crypto.scryptSync(code, salt, KEY_BYTES).toString('hex');
  return `${HASH_PREFIX}$${salt}$${key}`;
}

// A missing account still performs one scrypt so login timing does not reveal
// which phone numbers are registered.
const DUMMY_HASH = hashCode(generateCode());

function verifyCode(code, storedHash) {
  const parts = String(storedHash || '').split('$');
  if (parts.length !== 3 || parts[0] !== HASH_PREFIX) return false;
  const [, salt, expectedHex] = parts;
  if (!/^[0-9a-f]{32}$/.test(salt) || !/^[0-9a-f]{64}$/.test(expectedHex)) return false;

  const actual = crypto.scryptSync(code, salt, KEY_BYTES);
  const expected = Buffer.from(expectedHex, 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function publicAccount(row) {
  if (!row) return null;
  const { code_hash: _codeHash, ...safe } = row;
  return safe;
}

async function findById(id) {
  return db.prepare('SELECT * FROM client_accounts WHERE id = ?').get(id);
}

async function findByPhone(phone) {
  return db.prepare('SELECT * FROM client_accounts WHERE phone = ?').get(normalizePhone(phone));
}

async function listAccounts() {
  return db.prepare(`
    SELECT a.id, a.client_id, a.agency, a.contact_name, a.phone, a.email,
           a.status, a.created_at, c.status AS onboarding_status
    FROM client_accounts a
    LEFT JOIN clients c ON c.id = a.client_id
    ORDER BY datetime(a.created_at) DESC, a.id DESC
  `).all();
}

async function revokeSessions(accountId) {
  await db.prepare('DELETE FROM client_sessions WHERE account_id = ?').run(accountId);
}

async function createAccount({ clientId, agency, contactName, phone, email, code }) {
  return db.transaction(async () => {
    const client = clientId
      ? await db.prepare('SELECT * FROM clients WHERE id = ?').get(clientId)
      : null;
    if (clientId && !client) {
      throw new ClientPortalError(400, 'The selected client record does not exist.');
    }

    const resolvedAgency = agency || (client && client.agency);
    const resolvedContact = contactName || (client && client.contact_name);
    if (!resolvedAgency || !resolvedContact) {
      throw new ClientPortalError(400, 'Agency and contact name are required.');
    }

    const normalizedPhone = normalizePhone(phone);
    if (normalizedPhone.length !== 10) {
      throw new ClientPortalError(400, 'Enter a 10-digit phone number.');
    }
    if (await findByPhone(normalizedPhone)) {
      throw new ClientPortalError(409, 'An account already exists for this phone number.');
    }

    const plainCode = normalizeCode(code || generateCode());
    const result = await db.prepare(`
      INSERT INTO client_accounts (client_id, agency, contact_name, phone, email, code_hash)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      clientId || null,
      resolvedAgency,
      resolvedContact,
      normalizedPhone,
      email || (client && client.email) || null,
      hashCode(plainCode)
    );

    const account = await findById(Number(result.lastInsertRowid));
    return { account: publicAccount(account), code: formatCode(plainCode) };
  });
}

async function regenerateCode(id) {
  return db.transaction(async () => {
    const account = await findById(id);
    if (!account) throw new ClientPortalError(404, 'Client account not found.');

    const plainCode = generateCode();
    await db.prepare('UPDATE client_accounts SET code_hash = ? WHERE id = ?').run(hashCode(plainCode), id);
    await revokeSessions(id);
    return formatCode(plainCode);
  });
}

async function setStatus(id, status) {
  return db.transaction(async () => {
    const account = await findById(id);
    if (!account) throw new ClientPortalError(404, 'Client account not found.');

    await db.prepare('UPDATE client_accounts SET status = ? WHERE id = ?').run(status, id);
    if (status === 'disabled') await revokeSessions(id);
    return publicAccount(await findById(id));
  });
}

async function verifyLogin(phoneInput, codeInput) {
  const account = await findByPhone(phoneInput);
  const storedHash = account ? account.code_hash : DUMMY_HASH;
  const valid = verifyCode(normalizeCode(codeInput), storedHash);
  if (!account || !valid || account.status !== 'active') return null;
  return account;
}

module.exports = {
  ClientPortalError,
  normalizePhone,
  normalizeCode,
  generateCode,
  hashCode,
  verifyCode,
  publicAccount,
  findById,
  findByPhone,
  listAccounts,
  createAccount,
  regenerateCode,
  setStatus,
  verifyLogin
};
