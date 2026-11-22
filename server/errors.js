'use strict';

const { ValidationError } = require('./validate');

/**
 * Central error handler. Client-safe messages only; diagnostics stay on the
 * server. Request bodies are never logged, so passwords cannot leak into logs.
 */
function createErrorHandler({ logger = console } = {}) {
  return function errorHandler(err, req, res, next) {
    if (res.headersSent) return next(err);

    const isApi = req.path.startsWith('/api');

    if (err && err.type === 'entity.parse.failed') {
      return isApi
        ? res.status(400).json({ error: 'Malformed JSON body.' })
        : res.status(400).type('text').send('Malformed request.');
    }
    if (err && err.type === 'entity.too.large') {
      return isApi
        ? res.status(413).json({ error: 'Request body is too large.' })
        : res.status(413).type('text').send('Request too large.');
    }
    if (err instanceof ValidationError) {
      return isApi
        ? res.status(400).json({ error: err.message })
        : res.status(400).type('text').send(err.message);
    }
    // Deliberately exposed domain errors (conflicts, missing records) carry a
    // safe message and a 4xx status. Everything else stays generic.
    if (err && err.expose === true && Number.isInteger(err.status) && err.status >= 400 && err.status < 500) {
      return isApi
        ? res.status(err.status).json({ error: err.message })
        : res.status(err.status).type('text').send(err.message);
    }

    logger.error(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`, err);

    return isApi
      ? res.status(500).json({ error: 'Server error.' })
      : res.status(500).type('text').send('Something went wrong.');
  };
}

module.exports = { createErrorHandler };
