'use strict';

const express = require('express');
const compression = require('compression');
const path = require('node:path');
const db = require('./db');
const auth = require('./auth');
const validate = require('./validate');
const { createLoginGuard, createFixedWindowLimiter } = require('./rate-limit');
const { createErrorHandler } = require('./errors');
const invoiceService = require('./invoices');
const outreachService = require('./outreach');
const clientAccounts = require('./client-accounts');
const clientAuth = require('./client-auth');
const clientPortal = require('./client-portal');

const app = express();
const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC_ORIGIN = process.env.PUBLIC_ORIGIN || '';

if (PUBLIC_ORIGIN) {
  try {
    new URL(PUBLIC_ORIGIN);
  } catch (_) {
    throw new Error('PUBLIC_ORIGIN must be an absolute URL.');
  }
}

// Express 4 does not forward rejected promises from async middleware.
function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

// sha256 of the inline boot script in premium.html. Update if that script changes.
const INLINE_SCRIPT_HASH = 'sha256-/x7W7R75k8Roq0WaVRQX9blP4OufE5xbAdzklGxsgpw=';
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'none'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "img-src 'self' data: https://www.google-analytics.com https://www.googletagmanager.com",
  "font-src 'self'",
  // All page styling lives in served stylesheets. No inline style attributes
  // are used, so this directive does not need 'unsafe-inline'.
  "style-src 'self'",
  `script-src 'self' '${INLINE_SCRIPT_HASH}' https://www.googletagmanager.com`,
  "connect-src 'self' https://www.google-analytics.com https://www.googletagmanager.com https://*.google-analytics.com",
  "frame-src https://www.googletagmanager.com",
  "manifest-src 'self'"
].join('; ');

app.disable('x-powered-by');

// Only enable behind a reverse proxy. Trusting X-Forwarded-For without a proxy
// lets clients spoof their address and evade the IP rate limiters.
if (process.env.TRUST_PROXY === 'true') app.set('trust proxy', 1);

app.use((_req, res, next) => {
  res.setHeader('Content-Security-Policy', CONTENT_SECURITY_POLICY);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  if (auth.SECURE_COOKIE) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

// Brotli is offered first when the client supports it; gzip/deflate are the
// automatic fallbacks. Responses below 1 KB are left uncompressed.
app.use(compression({ threshold: 1024 }));

// Authenticated responses must never be cached by an intermediary.
app.use('/api', (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

// CSRF defence in depth on top of SameSite=Lax. Browsers send Origin and
// Sec-Fetch-Site on state-changing requests; non-browser API clients that send
// neither are unaffected.
app.use('/api', (req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();

  const origin = req.get('origin');
  if (origin) {
    let originHost = '';
    try {
      originHost = new URL(origin).host;
    } catch (_) {
      return res.status(403).json({ error: 'Cross-site request rejected.' });
    }
    const allowedHosts = [req.get('host'), req.hostname];
    if (PUBLIC_ORIGIN) allowedHosts.push(new URL(PUBLIC_ORIGIN).host);
    if (!allowedHosts.includes(originHost)) {
      return res.status(403).json({ error: 'Cross-site request rejected.' });
    }
  }

  const fetchSite = req.get('sec-fetch-site');
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') {
    return res.status(403).json({ error: 'Cross-site request rejected.' });
  }

  next();
});

app.use(express.json({ limit: '1mb' }));

// Never serve source files or the database.
app.use(['/data', '/server', '/package.json', '/package-lock.json', '/DESIGN.md', '/README.md'], (_req, res) => {
  res.sendStatus(404);
});

const loginGuard = createLoginGuard({ windowMs: 15 * 60 * 1000, maxFailures: 5 });
const clientLoginGuard = createLoginGuard({ windowMs: 15 * 60 * 1000, maxFailures: 5 });
const publicWriteLimiter = createFixedWindowLimiter({ windowMs: 60 * 60 * 1000, max: 40 });
// AI audits cost money per call, so they get their own generous-but-capped window.
const auditLimiter = createFixedWindowLimiter({
  windowMs: 60 * 60 * 1000,
  max: 30,
  message: 'Audit limit reached for this hour. Try again later.'
});

async function nextRef(prefix, table) {
  const n = (await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()).n + 1;
  return `${prefix}-2026-${String(n).padStart(3, '0')}`;
}

/* ------------------------------ public API ------------------------------ */

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'nexora' }));

app.get('/api/session', asyncRoute(async (req, res) => {
  const authed = await auth.isAuthed(req);
  res.json({ authenticated: authed, user: authed ? 'admin' : null });
}));

app.post('/api/login', asyncRoute(async (req, res) => {
  const body = validate.object(req.body);
  validate.only(body, ['password']);
  const password = validate.string(body, 'password', { max: 200 });
  const clientKey = req.ip;

  if (loginGuard.isBlocked(clientKey)) {
    res.setHeader('Retry-After', String(loginGuard.retryAfter(clientKey)));
    return res.status(429).json({ error: 'Too many sign-in attempts. Try again later.' });
  }

  if (!auth.passwordOk(password)) {
    loginGuard.recordFailure(clientKey);
    return res.status(401).json({ error: 'Invalid credentials.' });
  }

  loginGuard.clear(clientKey);
  await auth.login(res);
  res.json({ ok: true });
}));

app.post('/api/logout', asyncRoute(async (req, res) => {
  await auth.logout(req, res);
  res.json({ ok: true });
}));

/* ----------------------------- client auth API --------------------------- */

app.get('/api/client/session', asyncRoute(async (req, res) => {
  const account = await clientAuth.currentAccount(req);
  res.json(account
    ? { authenticated: true, account: { agency: account.agency, contact_name: account.contact_name } }
    : { authenticated: false, account: null });
}));

app.post('/api/client/login', asyncRoute(async (req, res) => {
  const body = validate.object(req.body);
  validate.only(body, ['phone', 'code']);
  const phone = validate.string(body, 'phone', { max: 30 });
  const code = validate.string(body, 'code', { max: 40 });
  const clientKey = `client:${req.ip}`;

  if (clientLoginGuard.isBlocked(clientKey)) {
    res.setHeader('Retry-After', String(clientLoginGuard.retryAfter(clientKey)));
    return res.status(429).json({ error: 'Too many sign-in attempts. Try again later.' });
  }

  const account = await clientAccounts.verifyLogin(phone, code);
  if (!account) {
    clientLoginGuard.recordFailure(clientKey);
    return res.status(401).json({ error: 'Invalid phone number or access code.' });
  }

  clientLoginGuard.clear(clientKey);
  await clientAuth.login(res, account.id);
  res.json({ ok: true, account: { agency: account.agency, contact_name: account.contact_name } });
}));

app.post('/api/client/logout', asyncRoute(async (req, res) => {
  await clientAuth.logout(req, res);
  res.json({ ok: true });
}));

app.post('/api/enquiries', publicWriteLimiter, asyncRoute(async (req, res) => {
  const body = validate.object(req.body);
  validate.only(body, ['name', 'agency', 'email', 'phone', 'service', 'message']);

  const name = validate.string(body, 'name', { max: 120 });
  const agency = validate.string(body, 'agency', { max: 160 });
  const email = validate.email(body, 'email', { max: 160 });
  const message = validate.string(body, 'message', { max: 2000 });
  const phone = validate.phone(body, 'phone');
  const service = validate.string(body, 'service', { max: 120, required: false });

  const ref = await nextRef('NXR', 'orders');
  await db.prepare(`
    INSERT INTO orders (ref, name, agency, email, phone, service, message)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(ref, name, agency, email, phone, service, message);

  res.status(201).json({ ok: true, ref });
}));

app.post('/api/onboarding', publicWriteLimiter, asyncRoute(async (req, res) => {
  const body = validate.object(req.body);
  validate.only(body, [
    'agency', 'contact_name', 'email', 'phone', 'website', 'city', 'services',
    'target_profile', 'list_source', 'monthly_volume', 'notes', 'consent'
  ]);

  const agency = validate.string(body, 'agency', { max: 160 });
  const contactName = validate.string(body, 'contact_name', { max: 120 });
  const email = validate.email(body, 'email', { max: 160 });
  const consent = validate.booleanTrue(body, 'consent');

  const result = await db.prepare(`
    INSERT INTO clients (agency, contact_name, email, phone, website, city, services, target_profile, list_source, monthly_volume, notes, consent)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    agency,
    contactName,
    email,
    validate.phone(body, 'phone'),
    validate.string(body, 'website', { max: 200, required: false }),
    validate.string(body, 'city', { max: 100, required: false }),
    validate.string(body, 'services', { max: 500, required: false }),
    validate.string(body, 'target_profile', { max: 800, required: false }),
    validate.string(body, 'list_source', { max: 300, required: false }),
    validate.string(body, 'monthly_volume', { max: 100, required: false }),
    validate.string(body, 'notes', { max: 2000, required: false }),
    consent ? 1 : 0
  );

  res.status(201).json({ ok: true, id: Number(result.lastInsertRowid) });
}));

/* ------------------------------ admin API ------------------------------- */

app.get('/api/stats', asyncRoute(auth.requireApi), asyncRoute(async (_req, res) => {
  const orderRows = await db.prepare('SELECT status, COUNT(*) AS n FROM orders GROUP BY status').all();
  const clientRows = await db.prepare('SELECT status, COUNT(*) AS n FROM clients GROUP BY status').all();
  const financial = await invoiceService.getStats();
  const tally = (rows) => rows.reduce((acc, row) => { acc[row.status] = row.n; return acc; }, {});

  const orders = tally(orderRows);
  const clients = tally(clientRows);

  res.json({
    orders: { new: orders.new || 0, accepted: orders.accepted || 0, rejected: orders.rejected || 0 },
    onboarding: { pending: clients.pending || 0, approved: clients.approved || 0, rejected: clients.rejected || 0 },
    invoices: financial.invoices,
    billed: financial.billed,
    collected: financial.collected,
    pending: financial.pending
  });
}));

app.get('/api/orders', asyncRoute(auth.requireApi), asyncRoute(async (_req, res) => {
  res.json(await db.prepare('SELECT * FROM orders ORDER BY datetime(created_at) DESC, id DESC').all());
}));

app.patch('/api/orders/:id', asyncRoute(auth.requireApi), asyncRoute(async (req, res) => {
  const id = validate.id(req.params.id, 'Order id');
  const body = validate.object(req.body);
  validate.only(body, ['status']);
  const status = validate.enumValue(body, 'status', ['new', 'accepted', 'rejected']);

  const result = await db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, id);
  if (!result.changes) return res.status(404).json({ error: 'Order not found.' });
  res.json(await db.prepare('SELECT * FROM orders WHERE id = ?').get(id));
}));

app.get('/api/onboarding', asyncRoute(auth.requireApi), asyncRoute(async (_req, res) => {
  res.json(await db.prepare('SELECT * FROM clients ORDER BY datetime(created_at) DESC, id DESC').all());
}));

app.patch('/api/onboarding/:id', asyncRoute(auth.requireApi), asyncRoute(async (req, res) => {
  const id = validate.id(req.params.id, 'Record id');
  const body = validate.object(req.body);
  validate.only(body, ['status']);
  const status = validate.enumValue(body, 'status', ['pending', 'approved', 'rejected']);

  const result = await db.prepare('UPDATE clients SET status = ? WHERE id = ?').run(status, id);
  if (!result.changes) return res.status(404).json({ error: 'Record not found.' });
  res.json(await db.prepare('SELECT * FROM clients WHERE id = ?').get(id));
}));

app.get('/api/invoices', asyncRoute(auth.requireApi), asyncRoute(async (_req, res) => {
  res.json(await invoiceService.listInvoices());
}));

app.get('/api/invoices/:id', asyncRoute(auth.requireApi), asyncRoute(async (req, res) => {
  const id = validate.id(req.params.id, 'Invoice id');
  const invoice = await invoiceService.readInvoice(id);
  if (!invoice) return res.status(404).json({ error: 'Invoice not found.' });
  res.json(invoice);
}));

app.post('/api/invoices', asyncRoute(auth.requireApi), asyncRoute(async (req, res) => {
  const body = validate.object(req.body);
  validate.only(body, [
    'client_name', 'client_email', 'issue_date', 'due_date', 'tax_percent',
    'discount_percent', 'notes', 'items', 'order_id', 'client_id'
  ]);

  const clientName = validate.string(body, 'client_name', { max: 160 });
  const clientEmail = validate.email(body, 'client_email', { max: 160, required: false });
  const issueDate = validate.date(body, 'issue_date');
  const dueDate = validate.date(body, 'due_date');
  if (dueDate < issueDate) {
    throw new validate.ValidationError('"due_date" cannot be before "issue_date".');
  }
  const taxPercent = body.tax_percent === undefined
    ? 0
    : validate.fieldNumber(body, 'tax_percent', { min: 0, max: 100 });
  const discountPercent = body.discount_percent === undefined
    ? 0
    : validate.fieldNumber(body, 'discount_percent', { min: 0, max: 100 });
  const notes = validate.string(body, 'notes', { max: 2000, required: false });
  const orderId = validate.optionalInteger(body, 'order_id', { min: 1 });
  const clientId = validate.optionalInteger(body, 'client_id', { min: 1 });

  const items = validate.array(body.items, 'items', { min: 1, max: 50 }).map((item) => {
    const row = validate.object(item, 'Each line item');
    validate.only(row, ['description', 'qty', 'rate']);
    return {
      description: validate.string(row, 'description', { max: 300 }),
      qty: validate.fieldNumber(row, 'qty', { min: 0, max: 100000 }),
      rate: validate.fieldNumber(row, 'rate', { min: 0, max: 1000000000 })
    };
  });

  const { invoice, created } = await invoiceService.createInvoice({
    input: {
      clientName,
      clientEmail,
      issueDate,
      dueDate,
      taxPercent,
      discountPercent,
      notes,
      orderId,
      clientId,
      items
    },
    idempotencyKey: req.get('Idempotency-Key')
  });

  if (!created) res.setHeader('Idempotent-Replayed', 'true');
  res.status(created ? 201 : 200).json(invoice);
}));

app.patch('/api/invoices/:id', asyncRoute(auth.requireApi), asyncRoute(async (req, res) => {
  const id = validate.id(req.params.id, 'Invoice id');
  const body = validate.object(req.body);
  validate.only(body, ['status', 'payment']);
  const status = validate.enumValue(body, 'status', invoiceService.STATUSES);

  let payment;
  if (body.payment !== undefined) {
    const raw = validate.object(body.payment, '"payment"');
    validate.only(raw, ['amount', 'method']);
    payment = {
      amount: validate.fieldNumber(raw, 'amount', { min: 1, max: 1000000000, integer: true }),
      method: validate.enumValue(raw, 'method', invoiceService.PAYMENT_METHODS)
    };
  }

  res.json(await invoiceService.changeStatus({ id, status, payment }));
}));

/* -------------------------- client account admin ------------------------- */

app.get('/api/client-accounts', asyncRoute(auth.requireApi), asyncRoute(async (_req, res) => {
  res.json(await clientAccounts.listAccounts());
}));

app.post('/api/client-accounts', asyncRoute(auth.requireApi), asyncRoute(async (req, res) => {
  const body = validate.object(req.body);
  validate.only(body, ['client_id', 'agency', 'contact_name', 'phone', 'email', 'code']);

  const clientId = validate.optionalInteger(body, 'client_id', { min: 1 });
  const agency = validate.string(body, 'agency', { max: 160, required: false });
  const contactName = validate.string(body, 'contact_name', { max: 120, required: false });
  const phone = validate.phone(body, 'phone');
  const email = validate.email(body, 'email', { max: 160, required: false });
  const code = validate.string(body, 'code', { max: 40, required: false });

  if (code) {
    const length = clientAccounts.normalizeCode(code).length;
    if (length < 8 || length > 24) {
      throw new validate.ValidationError('"code" must have 8 to 24 letters or numbers.');
    }
  }

  res.status(201).json(await clientAccounts.createAccount({ clientId, agency, contactName, phone, email, code }));
}));

app.post('/api/client-accounts/:id/regenerate', asyncRoute(auth.requireApi), asyncRoute(async (req, res) => {
  const id = validate.id(req.params.id, 'Account id');
  res.json({ code: await clientAccounts.regenerateCode(id) });
}));

app.patch('/api/client-accounts/:id', asyncRoute(auth.requireApi), asyncRoute(async (req, res) => {
  const id = validate.id(req.params.id, 'Account id');
  const body = validate.object(req.body);
  validate.only(body, ['status']);
  const status = validate.enumValue(body, 'status', ['active', 'disabled']);
  res.json(await clientAccounts.setStatus(id, status));
}));

/* ---------------------------- client portal API -------------------------- */

app.get('/api/client/overview', asyncRoute(clientAuth.requireApi), asyncRoute(async (req, res) => {
  res.json(await clientPortal.getOverview(req.clientAccount));
}));

app.get('/api/client/orders', asyncRoute(clientAuth.requireApi), asyncRoute(async (req, res) => {
  res.json(await clientPortal.listOrders(req.clientAccount));
}));

app.get('/api/client/invoices', asyncRoute(clientAuth.requireApi), asyncRoute(async (req, res) => {
  res.json(await clientPortal.listInvoices(req.clientAccount));
}));

app.get('/api/client/invoices/:id', asyncRoute(clientAuth.requireApi), asyncRoute(async (req, res) => {
  const id = validate.id(req.params.id, 'Invoice id');
  const invoice = await clientPortal.readInvoice(req.clientAccount, id);
  if (!invoice) return res.status(404).json({ error: 'Invoice not found.' });
  res.json(invoice);
}));

app.get('/api/client/profile', asyncRoute(clientAuth.requireApi), asyncRoute(async (req, res) => {
  res.json(await clientPortal.readProfile(req.clientAccount));
}));

/* ------------------------------- pages ---------------------------------- */

// Public HTML may be stored but must be revalidated on every navigation.
// Authenticated HTML must never be cached by a browser or intermediary.
function sendPage(file, { privatePage = false } = {}) {
  return (_req, res) => {
    res.setHeader('Cache-Control', privatePage ? 'no-store' : 'no-cache');
    res.sendFile(path.join(ROOT, file));
  };
}

app.get('/', sendPage('premium.html'));
app.get('/onboarding', sendPage('onboarding.html'));
app.get('/onboarding.html', sendPage('onboarding.html'));
app.get('/login', sendPage('login.html'));
app.get('/login.html', sendPage('login.html'));
app.get('/dashboard', asyncRoute(auth.requirePage), sendPage('dashboard.html', { privatePage: true }));
app.get('/dashboard.html', asyncRoute(auth.requirePage), sendPage('dashboard.html', { privatePage: true }));
app.get('/invoice/:id', asyncRoute(auth.requirePage), sendPage('invoice.html', { privatePage: true }));
app.get('/client/login', sendPage('client-login.html'));
app.get('/client/login.html', sendPage('client-login.html'));
app.get('/client/invoice/:id', asyncRoute(clientAuth.requirePage), sendPage('client-invoice.html', { privatePage: true }));
app.get('/client', asyncRoute(clientAuth.requirePage), sendPage('client-portal.html', { privatePage: true }));

// Only assets are public. Pages are served by the explicit routes above.
// Never mount ROOT here: that exposed the database, server source and private data.
// Font files are immutable by name; CSS/JS revalidate hourly so a deploy cannot
// leave a client on an old stylesheet for a year.
app.use('/assets', express.static(path.join(ROOT, 'assets'), {
  index: false,
  dotfiles: 'ignore',
  setHeaders(res, filePath) {
    const immutable = path.extname(filePath).toLowerCase() === '.woff2';
    res.setHeader(
      'Cache-Control',
      immutable ? 'public, max-age=31536000, immutable' : 'public, max-age=3600, must-revalidate'
    );
  }
}));

app.use((_req, res) => res.status(404).type('text').send('404 — page not found.'));

app.use(createErrorHandler({ logger: console }));

async function start() {
  await db.init();
  await auth.init();
  await clientAuth.init();
  app.listen(PORT, HOST, () => {
    console.log(`Nexora running at http://${HOST}:${PORT}`);
    console.log('Admin login: /login (password from ADMIN_PASSWORD)');
    console.log('Client portal: /client/login (phone + access code)');
  });
}

start().catch((error) => {
  console.error('Failed to start Nexora:', error);
  process.exitCode = 1;
});
