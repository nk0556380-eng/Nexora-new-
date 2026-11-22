# Nexora platform

A local full-stack app built from `Nexora_Business_Plan.pdf`: a warm cream/coral landing page,
public client onboarding, a client portal, and an admin dashboard for orders, approvals and invoicing.

## Run it

Set a strong admin password first — the server refuses to start without one (minimum 14 characters):

```powershell
$env:ADMIN_PASSWORD = "choose-a-long-unique-passphrase"
npm install
npm start
```

Or put it in a local `.env` file, which `npm start` loads automatically and Git ignores:

```
ADMIN_PASSWORD=choose-a-long-unique-passphrase
```

Open **http://127.0.0.1:3000**. No build step. Node 24+ is required for the built-in `node:sqlite`.

Admin sign in: **http://127.0.0.1:3000/login**.

Client portal: **http://127.0.0.1:3000/client/login**. Clients sign in with the phone number used
for the purchase plus the access code you issue from **Dashboard → Client logins**. Each client sees
only their own progress steps, orders, issued invoices and profile. Draft invoices stay hidden.

### Configuration

| Variable | Default | Purpose |
|---|---|---|
| `ADMIN_PASSWORD` | — (required) | Admin passphrase, minimum 14 characters |
| `PORT` | `3000` | Listen port |
| `HOST` | `127.0.0.1` | Bind address. Set `0.0.0.0` only when a reverse proxy fronts the app |
| `COOKIE_SECURE` | `false` | Set `true` on HTTPS deployments: marks the session cookie `Secure` and sends HSTS |
| `TRUST_PROXY` | `false` | Set `true` only behind a reverse proxy, so rate limiting uses the real client IP |
| `DB_PATH` | `private/data/nexora.db` | Alternate database file, used by tests and deployments |
| `TURSO_DATABASE_URL` | — | Hosted SQLite URL. Set on Render; omit locally to use `node:sqlite` |
| `TURSO_AUTH_TOKEN` | — | Turso auth token, only with `TURSO_DATABASE_URL` |
| `PUBLIC_ORIGIN` | — | Netlify site URL, so the API accepts the proxied request's `Origin` |
| `RENDER_API_URL` | — | Render service URL, used by `npm run build` to write Netlify `_redirects` |

Local HTTP development works with the defaults. `COOKIE_SECURE=true` requires HTTPS, otherwise the
browser will not send the session cookie.

### Deploy

Two supported layouts:

1. **Single long-running Node host** (below) — Express serves the pages and owns a local SQLite file
   on a persistent disk. This is the original deployment.
2. **Split hosting** — static pages on Netlify, API on the Render free tier, database on Turso.
   Render's free tier has no persistent disk, so the database must be hosted. Full steps are in
   [`deploy/NETLIFY_RENDER.md`](deploy/NETLIFY_RENDER.md).

#### Single Node host

1. Use Node 24+ and copy the project without `node_modules`; run `npm ci --omit=dev`.
2. Set `ADMIN_PASSWORD` to a long unique passphrase and keep `.env` out of version control.
3. Put the app behind an HTTPS reverse proxy. Set `HOST=127.0.0.1`, `TRUST_PROXY=true` and
   `COOKIE_SECURE=true` so the cookie is `Secure`, HSTS is sent and rate limiting sees the real IP.
4. Back up `private/data/nexora.db` before each deploy. There is no build step; restarting the
   process applies the schema migrations on startup.
5. After deploy, check `GET /api/health` returns `{"ok":true,"service":"nexora"}` and that `/login`
   loads with the CSP and cache headers above.

### Security behaviour

- Sessions expire server-side after 7 days; expired rows are pruned on startup and on each login.
- Changing `ADMIN_PASSWORD` revokes every existing session on the next start (a salted fingerprint
  is stored in the `app_meta` table; the password itself is never stored).
- `/api/login` and `/api/client/login` each allow 5 failed attempts per IP per 15 minutes, then
  return `429` with `Retry-After`. A successful login clears the counter. The window is in memory,
  so a restart clears it.
- Client access codes are hashed with scrypt (random salt) and are shown only once when created or
  regenerated. Admin and client sessions are separate 7-day cookies; disabling an account or
  regenerating its code revokes its sessions immediately.
- Public write endpoints (`/api/enquiries`, `/api/onboarding`) are limited to 40 requests per IP per hour.
- Non-GET `/api/*` requests are also checked for a same-origin `Origin`/`Sec-Fetch-Site`. A browser
  request from another site gets `403` even before authentication. Non-browser clients that send
  neither header are unaffected.
- Every request carries a strict Content Security Policy plus `nosniff`, `X-Frame-Options`,
  `Referrer-Policy`, `Permissions-Policy` and `Cross-Origin-Opener-Policy` headers. `style-src` is
  `'self'`; the only inline script is the small theme boot script in `premium.html`, allowed by its
  SHA-256 hash.

### Performance

- Responses are Brotli-compressed when the client supports it, with gzip/deflate fallback and
  `Vary: Accept-Encoding`. Responses below 1 KB are left uncompressed.
- Public pages are `no-cache` (revalidated on every navigation); dashboard and invoice pages are
  `no-store`; API responses are `no-store`.
- Fonts are cached for a year with `immutable`. CSS and JS are cached for one hour with
  `must-revalidate` because their names are not content-hashed, so a deploy reaches clients quickly.
- The two fonts used above the fold are preloaded on all five pages. At file level, Brotli reduces
  `app.js` from 38 KB to 8.3 KB and `premium.css` from 27.6 KB to 4.2 KB.

Data lives in `private/data/nexora.db` (SQLite), outside the public asset root and never served
over HTTP. It is created on first run and seeded with records labelled **DEMO** so the dashboard
is not empty. To reset to a clean seed: stop the server, delete `private/data/nexora.db*` and
start again.

`private/` also holds lead exports, call lists, the source archive, maintenance scripts and
backups. It is git-ignored and is never exposed by the web server.

### Invoicing rules

- **One arithmetic module.** `assets/js/money.js` is loaded by the dashboard preview and by the
  server, so the preview, saved invoice and printed invoice use identical rules.
- **Units.** Money is whole rupees. Quantities allow up to 3 decimal places (0.001–100000), unit
  rates are whole rupees (1–1,000,000,000), and percentages allow up to 2 decimals (0–100).
- **Order of calculation.** Each line is `round_half_up(qty × rate)`. `subtotal` is the sum of line
  amounts. `discount_amount` is `round_half_up(subtotal × discount_percent / 100)`. Tax is
  `round_half_up((subtotal − discount) × tax_percent / 100)`. `total` is the discounted subtotal
  plus tax. A total below ₹1 is rejected.
- **Server authority.** The browser may not send `subtotal`, `tax_amount`, `discount_amount` or
  `total`; unexpected fields are rejected. The server returns the calculated values.
- **Idempotency.** `POST /api/invoices` requires an `Idempotency-Key` header of 8–128 letters,
  numbers, hyphens or underscores. A retry with the same key and payload returns the original
  invoice (`200`, `Idempotent-Replayed: true`). The same key with different data returns `409`.
- **Numbering.** References are `INV-<issue year>-<sequence>` where the sequence is read from
  `app_meta.invoice_seq` and incremented inside the same transaction as the invoice. Existing
  numbers are never reused or renumbered.
- **Status transitions.** `draft → sent`, `draft → cancelled`, `sent → paid`, `sent → cancelled`.
  `paid` and `cancelled` are final. Invalid transitions return `409` even for direct API calls.
- **Payments.** Marking an invoice paid requires `payment: { amount, method }`. `amount` must equal
  the invoice total, and `method` must be one of `bank_transfer`, `upi`, `card`, `cash`, `cheque`,
  `other`. One payment is recorded per invoice, with a server-generated `paid_at`. Partial payments
  and refunds are not supported in this version.
- **KPIs.** `billed` is the sum of real (non-demo) invoice totals in `sent` or `paid` state.
  `collected` is the sum of recorded payment amounts on real invoices. `pending` is
  `max(0, billed − collected)`. Drafts, cancelled invoices and **DEMO** rows never count as revenue.
- **Invoices are immutable after creation.** Content corrections require cancelling and issuing a
  new invoice; this avoids silently changing an amount that a client has already seen.
- **Print / Save PDF.** The invoice page renders the stored subtotal, discount, tax, total, line
  amounts, client details and payment status returned by the API. There is no second calculation
  and no separate PDF generator.

### Tests

`npm test` runs the built-in Node test runner (no extra dependencies). The suite covers security
headers, CSP and inline-style policy, compression negotiation, cache headers, CSRF rejection,
request validation, consent handling, session expiry and revocation, rate limiting, the error
handler, invoice arithmetic, decimals, tax and discounts, idempotency, concurrent creation,
transaction rollback, status transitions, payment validation, KPI definitions, foreign keys and
legacy migrations, using throwaway databases under the system temp directory. It never touches
`private/data/nexora.db`. Current count: **96 tests, 96 pass**.

### Accessibility and interaction

The interface targets WCAG 2.2 AA for the served pages:

- **Dialogs** trap Tab/Shift+Tab, close on Escape, focus the first field and restore focus to the
  opener. The dashboard shell is `inert` while a dialog is open.
- **Dynamic errors** are linked with `aria-describedby`/`aria-invalid` in the dashboard, onboarding,
  login, invoice and enquiry forms. Line-item and payment errors update live as values change.
- **Focus is preserved** when tables re-render after accept/reject/mark-paid. New invoices focus their
  View link; a removed row falls back to the page heading.
- **The mobile sidebar** is `inert` when closed, focuses its first link when opened, and closes on
  Escape, outside click or view selection with focus returned to the menu button.
- **Landmarks and tables** use `main`, a skip link, labelled navigation/complementary regions,
  captions, `scope="col"` and labelled scroll regions. Active views and filters expose
  `aria-current`/`aria-pressed`.
- **Announcements** use `role="alert"` for errors and `role="status"` for success; busy regions report
  `aria-busy`.
- **Forms** label every control, hide decorative required asterisks from accessible names, and set
  appropriate `autocomplete` values.

Automated browser checks cover 68 interaction/accessibility assertions plus a 30-combination
responsive sweep (320–1920px) with zero overflow and no unexpected console errors. Evidence is in
`private/backups/20261119-batch4/screenshots/`. Batch 5 added a 15-combination sweep
(5 pages × 375/768/1440), the full login → dashboard → invoice → onboarding → enquiry flows, a CSP
violation probe and header/compression checks; evidence is in
`private/backups/20261120-batch5/screenshots/`. Remaining lower-priority findings are tracked in
`AUDIT.md`.

## Pages

| URL | What it does |
|---|---|
| `/` | Landing page with live-style workspace mock and quick enquiry form |
| `/onboarding` | Public client onboarding form (agency, target profile, list source, consent) |
| `/login` | Admin sign in |
| `/dashboard` | Overview, orders (accept/reject), onboarding approvals, invoices, client logins |
| `/invoice/:id` | Printable invoice view — Print / Save PDF (admin) |
| `/client/login` | Client sign in with phone number + access code |
| `/client` | Client portal: progress tracker, overview, orders, invoices, profile |
| `/client/invoice/:id` | Printable invoice view scoped to the signed-in client |

## The flow

1. A visitor submits the enquiry form → `POST /api/enquiries` → a **new order** appears in the dashboard.
2. Admin **accepts** or rejects the order. Accepted orders can be turned into an invoice in one click.
3. A client submits `/onboarding` → a **pending** record. Admin reviews details and approves or rejects.
4. Admin creates an invoice with line items, discount and tax → sends it → views/prints it → records
   a payment to mark it **paid**.
5. Admin opens **Dashboard → Client logins**, creates a login for the client's 10-digit phone number
   and shares the generated code. The client signs in at `/client/login` and follows the five steps
   (enquiry → details → approved → invoice → payment) in their own portal. Regenerating a code or
   disabling a login immediately revokes all of that client's sessions.

## Files

- `server/index.js` — Express API, page routes, static serving, security headers
- `server/db.js` — SQLite schema, migrations, seed data
- `server/invoices.js` — invoice arithmetic service, transactions, numbering, statuses, payments, KPIs
- `server/auth.js` — expiring cookie sessions, timing-safe password check, password-change revocation
- `server/validate.js` — strict request validation and `ValidationError`
- `server/rate-limit.js` — login guard and fixed-window limiter for public writes
- `server/errors.js` — central error handler; client-safe messages, server-side diagnostics
- `premium.html` / `assets/css/premium.css` / `assets/js/premium.js` — landing page
- `onboarding.html`, `login.html`, `dashboard.html`, `invoice.html` — app pages
- `assets/css/tokens.css` — three-layer design tokens; single source of truth for colour, type, space, radius, shadow and motion
- `assets/css/ui.css` — shared base elements and components (buttons, fields, status pills, focus)
- `assets/css/app.css` / `assets/js/app.js` — dashboard, onboarding, login and invoice layout/logic
- `assets/js/money.js` — shared invoice arithmetic for browser and server
- `assets/css/fonts.css` / `assets/fonts/` — self-hosted Space Grotesk, DM Sans, IBM Plex Mono
- `private/` — database, lead exports, scripts, archives and backups (never served, git-ignored)
- `DESIGN.md` — authoritative design system specification

## Design references used

- **ui-ux-pro-max** — style/color/typography data; final direction is warm cream and coral with dark ink.
- **getdesign.md** — `DESIGN.md` token format with rationale.
- Accessibility: visible focus rings, labelled inputs, inline validation, reduced-motion support, keyboard-operable dialogs/navigation and live status announcements.

## Before launch

1. The contact inbox is `nexora7021@gmail.com` in the homepage footer, onboarding aside and invoice
   footer. Update all three if that address changes.
2. Keep `ADMIN_PASSWORD` set to a long unique value (14+ chars) and serve over HTTPS.
3. Add backups for `private/data/nexora.db`. Rate limiting is in-memory; move it to a shared store if
   the app ever runs as more than one process.
4. Add a privacy policy and terms — onboarding collects business contact details and consent.
5. Keep sample figures labelled; pricing is scoped after discovery, never published from the plan's illustrative numbers.
