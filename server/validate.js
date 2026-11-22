'use strict';

/**
 * Strict request validation. Throws ValidationError with a user-safe message;
 * the central error handler turns that into a 400 without leaking internals.
 * Values are never coerced from objects or arrays into strings.
 */
class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
    this.status = 400;
  }
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^\+?[0-9][0-9\s().-]{4,24}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function fail(message) {
  throw new ValidationError(message);
}

function object(value, label) {
  const name = label || 'Request body';
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${name} must be a JSON object.`);
  }
  return value;
}

function only(body, allowed) {
  for (const key of Object.keys(body)) {
    if (!allowed.includes(key)) fail(`Unexpected field "${key}".`);
  }
  return body;
}

function string(body, key, options) {
  const { max, min = 1, required = true } = options || {};
  const raw = body[key];

  if (raw === undefined || raw === null || raw === '') {
    if (required) fail(`"${key}" is required.`);
    return '';
  }
  if (typeof raw !== 'string') fail(`"${key}" must be text.`);

  const value = raw.trim();
  if (!value) {
    if (required) fail(`"${key}" is required.`);
    return '';
  }
  if (value.length < min) fail(`"${key}" must be at least ${min} characters.`);
  if (value.length > max) fail(`"${key}" must be ${max} characters or fewer.`);
  return value;
}

function email(body, key, options) {
  const value = string(body, key, options);
  if (!value) return '';
  if (!EMAIL.test(value)) fail(`"${key}" must be a valid email address.`);
  return value;
}

function phone(body, key) {
  const value = string(body, key, { max: 30, required: false });
  if (!value) return '';
  if (!PHONE.test(value)) fail(`"${key}" must be a valid phone number.`);
  return value;
}

function date(body, key) {
  const value = string(body, key, { max: 10, min: 10 });
  if (!DATE.test(value)) fail(`"${key}" must be a date in YYYY-MM-DD format.`);
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    fail(`"${key}" is not a valid date.`);
  }
  return value;
}

function numberValue(value, label, options) {
  const { min = 0, max = Number.MAX_SAFE_INTEGER, integer = false } = options || {};
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(`"${label}" must be a number.`);
  if (integer && !Number.isInteger(value)) fail(`"${label}" must be an integer.`);
  if (value < min || value > max) fail(`"${label}" must be between ${min} and ${max}.`);
  return value;
}

function fieldNumber(body, key, options) {
  if (body[key] === undefined) fail(`"${key}" is required.`);
  return numberValue(body[key], key, options);
}

function optionalInteger(body, key, options) {
  if (body[key] === undefined || body[key] === null) return null;
  return numberValue(body[key], key, { ...(options || {}), integer: true });
}

function optionalBoolean(body, key, fallback = false) {
  const raw = body[key];
  if (raw === undefined || raw === null) return fallback;
  if (typeof raw !== 'boolean') fail(`"${key}" must be true or false.`);
  return raw;
}

function optionalDate(body, key) {
  if (body[key] === undefined || body[key] === null || body[key] === '') return '';
  return date(body, key);
}

/** Instagram handle without the leading @, normalised to lower case. */
function handle(body, key) {
  const raw = string(body, key, { max: 31 });
  const value = raw.replace(/^@+/, '').toLowerCase();
  if (!/^[a-z0-9._]{1,30}$/.test(value)) {
    fail(`"${key}" must be an Instagram handle: letters, numbers, dots or underscores, max 30.`);
  }
  return value;
}

function urlValue(body, key, options) {
  const value = string(body, key, options);
  if (!value) return '';
  if (!/^https?:\/\/[^\s]+$/i.test(value) || value.length > 300) {
    fail(`"${key}" must be http:// or https:// URL.`);
  }
  return value;
}

function enumValue(body, key, allowed) {
  const value = body[key];
  if (typeof value !== 'string' || !allowed.includes(value)) {
    fail(`"${key}" must be one of: ${allowed.join(', ')}.`);
  }
  return value;
}

function booleanTrue(body, key) {
  if (body[key] !== true) fail(`"${key}" must be true.`);
  return true;
}

function array(value, label, options) {
  const { min = 1, max = 100 } = options || {};
  if (!Array.isArray(value)) fail(`"${label}" must be an array.`);
  if (value.length < min) fail(`"${label}" must contain at least ${min} item(s).`);
  if (value.length > max) fail(`"${label}" must contain ${max} items or fewer.`);
  return value;
}

function id(value, label) {
  if (typeof value !== 'string' || !/^[1-9][0-9]{0,9}$/.test(value)) {
    fail(`${label} must be a positive integer.`);
  }
  return Number(value);
}

module.exports = {
  ValidationError,
  object,
  only,
  string,
  email,
  phone,
  date,
  fieldNumber,
  optionalInteger,
  optionalBoolean,
  optionalDate,
  handle,
  urlValue,
  enumValue,
  booleanTrue,
  array,
  id
};
