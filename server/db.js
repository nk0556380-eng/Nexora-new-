'use strict';

const { createLocalDriver } = require('./db-local');

const remoteUrl = process.env.TURSO_DATABASE_URL || process.env.LIBSQL_URL || '';
const authToken = process.env.TURSO_AUTH_TOKEN || process.env.LIBSQL_AUTH_TOKEN || '';

// Local SQLite keeps the test suite and `npm start` fully offline. Setting
// TURSO_DATABASE_URL switches the same call sites to hosted SQLite on Render,
// where the free tier has no persistent disk.
const driver = remoteUrl
  ? require('./db-turso').createRemoteDriver({ url: remoteUrl, authToken })
  : createLocalDriver();

module.exports = {
  isRemote: driver.isRemote,
  init: driver.init,
  prepare: driver.prepare,
  exec: driver.exec,
  transaction: driver.transaction,
  close: driver.close
};
