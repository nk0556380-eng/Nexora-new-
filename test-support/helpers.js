'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

/** Returns a port that was free a moment ago. */
function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

function tempDbPath() {
  return path.join(os.tmpdir(), `nexora-test-${Date.now()}-${Math.random().toString(16).slice(2)}.db`);
}

function removeDb(dbPath) {
  for (const suffix of ['', '-wal', '-shm']) {
    fs.rmSync(dbPath + suffix, { force: true });
  }
}

/** Starts the real server against a throwaway database. */
async function startServer({ password, dbPath, env = {} }) {
  const port = await freePort();
  const proc = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      ADMIN_PASSWORD: password,
      DB_PATH: dbPath,
      HOST: '127.0.0.1',
      PORT: String(port),
      COOKIE_SECURE: '',
      NODE_ENV: 'test',
      ...env
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let output = '';
  proc.stdout.on('data', (chunk) => { output += chunk; });
  proc.stderr.on('data', (chunk) => { output += chunk; });

  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) {
      throw new Error(`Server exited with ${proc.exitCode}: ${output}`);
    }
    try {
      const res = await fetch(`${base}/api/health`);
      if (res.ok) return { proc, base, port, output: () => output };
    } catch (_) {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  proc.kill();
  throw new Error(`Server did not start: ${output}`);
}

function stopServer(server) {
  return new Promise((resolve) => {
    if (!server || server.proc.exitCode !== null) return resolve();
    server.proc.once('exit', () => resolve());
    server.proc.kill();
  });
}

function cookieFrom(response) {
  const header = response.headers.getSetCookie()[0];
  return header ? header.split(';')[0] : '';
}

function jsonRequest(base, urlPath, options = {}) {
  const { method = 'GET', body, cookie, rawBody, contentType = 'application/json', headers = {} } = options;
  const finalHeaders = { ...headers };
  if (body !== undefined || rawBody !== undefined) finalHeaders['Content-Type'] = contentType;
  if (cookie) finalHeaders.Cookie = cookie;
  return fetch(base + urlPath, {
    method,
    headers: finalHeaders,
    body: rawBody !== undefined ? rawBody : body !== undefined ? JSON.stringify(body) : undefined,
    redirect: 'manual'
  });
}

module.exports = {
  ROOT,
  freePort,
  tempDbPath,
  removeDb,
  startServer,
  stopServer,
  cookieFrom,
  jsonRequest
};
