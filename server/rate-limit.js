'use strict';

/**
 * In-memory rate limiting. Suitable for the single-process deployment this app
 * uses; behind multiple instances this must move to a shared store.
 */

function createLoginGuard({ windowMs = 15 * 60 * 1000, maxFailures = 5 } = {}) {
  const failures = new Map();

  function entryFor(key, now) {
    const existing = failures.get(key);
    if (!existing || existing.resetAt <= now) return { count: 0, resetAt: now + windowMs };
    return existing;
  }

  function prune(now) {
    if (failures.size < 5000) return;
    for (const [key, entry] of failures) {
      if (entry.resetAt <= now) failures.delete(key);
    }
  }

  return {
    isBlocked(key) {
      return entryFor(key, Date.now()).count >= maxFailures;
    },
    retryAfter(key) {
      const now = Date.now();
      const entry = entryFor(key, now);
      return Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
    },
    recordFailure(key) {
      const now = Date.now();
      prune(now);
      const entry = entryFor(key, now);
      entry.count += 1;
      failures.set(key, entry);
    },
    clear(key) {
      failures.delete(key);
    }
  };
}

function createFixedWindowLimiter({ windowMs, max, message = 'Too many requests. Try again later.' }) {
  const hits = new Map();

  return function rateLimit(req, res, next) {
    const key = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();

    let entry = hits.get(key);
    if (!entry || entry.resetAt <= now) entry = { count: 0, resetAt: now + windowMs };
    entry.count += 1;

    if (hits.size > 5000) {
      for (const [existingKey, existing] of hits) {
        if (existing.resetAt <= now) hits.delete(existingKey);
      }
    }
    hits.set(key, entry);

    if (entry.count > max) {
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil((entry.resetAt - now) / 1000))));
      return res.status(429).json({ error: message });
    }
    next();
  };
}

module.exports = { createLoginGuard, createFixedWindowLimiter };
