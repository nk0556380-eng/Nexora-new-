'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createErrorHandler } = require('../server/errors');
const { ValidationError } = require('../server/validate');

function fakeResponse({ headersSent = false } = {}) {
  const result = { statusCode: 0, contentType: null, body: null, headersSent };
  const res = {
    get headersSent() { return result.headersSent; },
    status(code) { result.statusCode = code; return res; },
    json(payload) { result.body = payload; return res; },
    type(value) { result.contentType = value; return res; },
    send(payload) { result.body = payload; return res; }
  };
  return { res, result };
}

function fakeLogger() {
  const calls = [];
  return { calls, error: (...args) => calls.push(args) };
}

const API_REQUEST = { method: 'POST', path: '/api/login', originalUrl: '/api/login' };

test('validation errors return 400 with the safe message', () => {
  const { res, result } = fakeResponse();
  const logger = fakeLogger();
  createErrorHandler({ logger })(new ValidationError('"password" is required.'), API_REQUEST, res, () => {});

  assert.equal(result.statusCode, 400);
  assert.deepEqual(result.body, { error: '"password" is required.' });
  assert.equal(logger.calls.length, 0);
});

test('malformed JSON returns a generic 400', () => {
  const { res, result } = fakeResponse();
  const error = Object.assign(new SyntaxError('Unexpected token { in JSON at position 1'), { type: 'entity.parse.failed' });
  createErrorHandler({ logger: fakeLogger() })(error, API_REQUEST, res, () => {});

  assert.equal(result.statusCode, 400);
  assert.deepEqual(result.body, { error: 'Malformed JSON body.' });
  assert.ok(!JSON.stringify(result.body).includes('Unexpected token'));
});

test('oversized bodies return 413', () => {
  const { res, result } = fakeResponse();
  const error = Object.assign(new Error('too large'), { type: 'entity.too.large' });
  createErrorHandler({ logger: fakeLogger() })(error, API_REQUEST, res, () => {});

  assert.equal(result.statusCode, 413);
  assert.deepEqual(result.body, { error: 'Request body is too large.' });
});

test('unexpected errors return 500 without stack traces or internals', () => {
  const { res, result } = fakeResponse();
  const logger = fakeLogger();
  const error = new Error('SQLITE_ERROR: no such table: private_sessions at C:\\secret\\path.js:12');
  error.stack = 'Error: boom\n    at C:\\secret\\path.js:12:3';

  createErrorHandler({ logger })(error, API_REQUEST, res, () => {});

  assert.equal(result.statusCode, 500);
  assert.deepEqual(result.body, { error: 'Server error.' });
  const serialized = JSON.stringify(result.body);
  assert.ok(!serialized.includes('SQLITE'));
  assert.ok(!serialized.includes('C:\\'));
  assert.ok(!serialized.includes('at C:'));
  assert.equal(logger.calls.length, 1, 'diagnostics must still be logged server-side');
  assert.equal(logger.calls[0][1], error);
});

test('non-API errors return plain text, not JSON', () => {
  const { res, result } = fakeResponse();
  const request = { method: 'GET', path: '/dashboard', originalUrl: '/dashboard' };
  createErrorHandler({ logger: fakeLogger() })(new Error('boom'), request, res, () => {});

  assert.equal(result.statusCode, 500);
  assert.equal(result.contentType, 'text');
  assert.equal(result.body, 'Something went wrong.');
});

test('the handler defers when headers were already sent', () => {
  const { res } = fakeResponse({ headersSent: true });
  const error = new Error('boom');
  let received = null;
  createErrorHandler({ logger: fakeLogger() })(error, API_REQUEST, res, (err) => { received = err; });

  assert.equal(received, error);
});
