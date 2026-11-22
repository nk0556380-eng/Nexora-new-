'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const validate = require('../server/validate');

function rejects(fn, pattern) {
  assert.throws(fn, (err) => {
    assert.equal(err.name, 'ValidationError');
    assert.equal(err.status, 400);
    if (pattern) assert.match(err.message, pattern);
    return true;
  });
}

test('object accepts only JSON objects', () => {
  assert.deepEqual(validate.object({ a: 1 }), { a: 1 });
  rejects(() => validate.object(null), /must be a JSON object/);
  rejects(() => validate.object([1]), /must be a JSON object/);
  rejects(() => validate.object('text'), /must be a JSON object/);
});

test('only rejects unexpected fields', () => {
  assert.deepEqual(validate.only({ a: 1 }, ['a']), { a: 1 });
  rejects(() => validate.only({ a: 1, b: 2 }, ['a']), /Unexpected field "b"/);
});

test('string rejects non-text, enforces length and trims', () => {
  assert.equal(validate.string({ name: '  Ananya  ' }, 'name', { max: 20 }), 'Ananya');
  assert.equal(validate.string({}, 'name', { required: false }), '');
  rejects(() => validate.string({ name: { x: 1 } }, 'name', { max: 20 }), /must be text/);
  rejects(() => validate.string({ name: 12 }, 'name', { max: 20 }), /must be text/);
  rejects(() => validate.string({ name: [] }, 'name', { max: 20 }), /must be text/);
  rejects(() => validate.string({}, 'name', { max: 20 }), /required/);
  rejects(() => validate.string({ name: '' }, 'name', { max: 20 }), /required/);
  rejects(() => validate.string({ name: 'abcdef' }, 'name', { max: 3 }), /3 characters or fewer/);
});

test('email requires a plausible address', () => {
  assert.equal(validate.email({ email: 'a@b.co' }, 'email', { max: 100 }), 'a@b.co');
  assert.equal(validate.email({}, 'email', { max: 100, required: false }), '');
  rejects(() => validate.email({ email: 'not-an-email' }, 'email', { max: 100 }), /valid email/);
  rejects(() => validate.email({ email: 'a b@c.co' }, 'email', { max: 100 }), /valid email/);
});

test('phone accepts common formats and rejects junk', () => {
  assert.equal(validate.phone({ phone: '+91 98000 11101' }, 'phone'), '+91 98000 11101');
  assert.equal(validate.phone({}, 'phone'), '');
  rejects(() => validate.phone({ phone: 'call me' }, 'phone'), /valid phone/);
  rejects(() => validate.phone({ phone: { n: 1 } }, 'phone'), /must be text/);
});

test('date requires a real YYYY-MM-DD date', () => {
  assert.equal(validate.date({ d: '2026-02-28' }, 'd'), '2026-02-28');
  rejects(() => validate.date({ d: 'banana' }, 'd'), /at least 10 characters/);
  rejects(() => validate.date({ d: 'zzzz-zz-zz' }, 'd'), /YYYY-MM-DD/);
  rejects(() => validate.date({ d: '2026-02-30' }, 'd'), /not a valid date/);
  rejects(() => validate.date({ d: '2026-13-01' }, 'd'), /not a valid date/);
  rejects(() => validate.date({ d: '2026-2-3' }, 'd'), /at least 10 characters/);
});

test('numbers are never coerced from strings', () => {
  assert.equal(validate.fieldNumber({ n: 2 }, 'n', { min: 1, max: 5 }), 2);
  rejects(() => validate.fieldNumber({ n: '2' }, 'n', { min: 1, max: 5 }), /must be a number/);
  rejects(() => validate.fieldNumber({ n: Number.NaN }, 'n', { min: 1, max: 5 }), /must be a number/);
  rejects(() => validate.fieldNumber({ n: Infinity }, 'n', { min: 1, max: 5 }), /must be a number/);
  rejects(() => validate.fieldNumber({ n: 9 }, 'n', { min: 1, max: 5 }), /between 1 and 5/);
  rejects(() => validate.fieldNumber({ n: 1.5 }, 'n', { min: 1, max: 5, integer: true }), /integer/);
  rejects(() => validate.fieldNumber({}, 'n'), /required/);
});

test('optionalInteger allows absence but not strings', () => {
  assert.equal(validate.optionalInteger({}, 'id', { min: 1 }), null);
  assert.equal(validate.optionalInteger({ id: 4 }, 'id', { min: 1 }), 4);
  rejects(() => validate.optionalInteger({ id: '4' }, 'id', { min: 1 }), /must be a number/);
  rejects(() => validate.optionalInteger({ id: 4.5 }, 'id', { min: 1 }), /integer/);
});

test('enum values are limited to the allowed set', () => {
  assert.equal(validate.enumValue({ s: 'paid' }, 's', ['draft', 'sent', 'paid']), 'paid');
  rejects(() => validate.enumValue({ s: 'deleted' }, 's', ['draft', 'sent', 'paid']), /must be one of/);
  rejects(() => validate.enumValue({ s: 1 }, 's', ['draft']), /must be one of/);
});

test('consent accepts only the boolean true', () => {
  assert.equal(validate.booleanTrue({ consent: true }, 'consent'), true);
  for (const value of ['true', 'false', 1, '1', 0, null, undefined, {}, []]) {
    rejects(() => validate.booleanTrue({ consent: value }, 'consent'), /must be true/);
  }
  rejects(() => validate.booleanTrue({}, 'consent'), /must be true/);
});

test('arrays enforce type and bounds', () => {
  assert.deepEqual(validate.array([1], 'items', { min: 1, max: 2 }), [1]);
  rejects(() => validate.array('nope', 'items', { min: 1, max: 2 }), /must be an array/);
  rejects(() => validate.array([], 'items', { min: 1, max: 2 }), /at least 1/);
  rejects(() => validate.array([1, 2, 3], 'items', { min: 1, max: 2 }), /2 items or fewer/);
});

test('ids are positive integers in canonical form', () => {
  assert.equal(validate.id('1', 'Id'), 1);
  assert.equal(validate.id('1234567890', 'Id'), 1234567890);
  for (const value of ['0', '-1', '1.5', 'abc', '007', '12345678901', 1]) {
    rejects(() => validate.id(value, 'Id'), /positive integer/);
  }
});
