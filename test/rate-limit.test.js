'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createLoginGuard, createFixedWindowLimiter } = require('../server/rate-limit');

function fakeExchange() {
  const headers = {};
  const result = { statusCode: 200, body: null, headers };
  return {
    result,
    res: {
      status(code) { result.statusCode = code; return this; },
      json(payload) { result.body = payload; return this; },
      setHeader(key, value) { headers[key] = value; }
    }
  };
}

test('login guard blocks after the failure limit and clears on success', () => {
  const guard = createLoginGuard({ windowMs: 1000, maxFailures: 3 });

  assert.equal(guard.isBlocked('ip'), false);
  guard.recordFailure('ip');
  guard.recordFailure('ip');
  assert.equal(guard.isBlocked('ip'), false);
  guard.recordFailure('ip');
  assert.equal(guard.isBlocked('ip'), true);
  assert.ok(guard.retryAfter('ip') >= 1);

  guard.clear('ip');
  assert.equal(guard.isBlocked('ip'), false);
});

test('login guard tracks each client separately', () => {
  const guard = createLoginGuard({ windowMs: 1000, maxFailures: 1 });
  guard.recordFailure('a');
  assert.equal(guard.isBlocked('a'), true);
  assert.equal(guard.isBlocked('b'), false);
});

test('login guard releases the client when the window expires', async () => {
  const guard = createLoginGuard({ windowMs: 60, maxFailures: 1 });
  guard.recordFailure('ip');
  assert.equal(guard.isBlocked('ip'), true);
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.equal(guard.isBlocked('ip'), false);
});

test('fixed window limiter allows the quota then returns 429 with Retry-After', async () => {
  const limiter = createFixedWindowLimiter({ windowMs: 1000, max: 2 });
  const { result, res } = fakeExchange();
  let passed = 0;

  for (let i = 0; i < 2; i += 1) {
    limiter({ ip: '127.0.0.1' }, res, () => { passed += 1; });
  }
  assert.equal(passed, 2);
  assert.equal(result.statusCode, 200);

  let leaked = false;
  limiter({ ip: '127.0.0.1' }, res, () => { leaked = true; });
  assert.equal(leaked, false);
  assert.equal(result.statusCode, 429);
  assert.match(result.body.error, /Too many requests/);
  assert.ok(Number(result.headers['Retry-After']) >= 1);
});

test('fixed window limiter resets after the window', async () => {
  const limiter = createFixedWindowLimiter({ windowMs: 50, max: 1 });
  const { result, res } = fakeExchange();
  let passed = 0;

  limiter({ ip: 'ip' }, res, () => { passed += 1; });
  limiter({ ip: 'ip' }, res, () => { passed += 1; });
  assert.equal(passed, 1);
  assert.equal(result.statusCode, 429);

  await new Promise((resolve) => setTimeout(resolve, 90));
  limiter({ ip: 'ip' }, res, () => { passed += 1; });
  assert.equal(passed, 2);
});
