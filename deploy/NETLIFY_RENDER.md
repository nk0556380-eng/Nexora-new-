# Nexora — Netlify (frontend) + Render free tier (API) + Turso (database)

This is the split deployment. The browser only talks to Netlify; Netlify proxies `/api/*` to the
Express service on Render. That keeps the API same-origin, so the `HttpOnly; SameSite=Lax` session
cookie, the `connect-src 'self'` CSP rule and the CSRF `Origin` check all keep working without
changing the frontend JavaScript.

```
browser ──► Netlify (static HTML/CSS/JS)
              │  /api/*  (rewrite, 200)
              ▼
            Render (Express, free web service)
              │  libSQL/Hrafts protocol
              ▼
            Turso (hosted SQLite)
```

**Why Turso is mandatory here:** Render's free web service has no persistent disk. The app writes a
SQLite database; without hosted SQLite, every restart or redeploy would wipe orders, onboarding and
invoices. Locally (`npm start`, `npm test`) the app still uses `private/data/nexora.db` through
`node:sqlite`, so development and the 96 tests stay fully offline.

---

## 1. Turso

1. Sign up at <https://turso.tech> and create a database (pick the region closest to your Render
   region). Free limits change — check the pricing page before committing.
2. Create an auth token for the database.
3. Note the two values:
   - `TURSO_DATABASE_URL` — looks like `libsql://your-db-name.turso.io`
   - `TURSO_AUTH_TOKEN` — the token string

A brand-new database is empty. On first start the API creates the schema, indexes and the DEMO seed
rows automatically.

### Importing an existing local database (optional)

If `private/data/nexora.db` already holds real data, dump and import it instead of using the seed:

```bash
sqlite3 private/data/nexora.db .dump > nexora-dump.sql
turso db shell <database-name> < nexora-dump.sql
```

Remove `PRAGMA journal_mode=WAL;` from the dump if your SQLite emits it, and consider deleting the
`sessions` table rows so old cookies do not carry over. After an import, the API's schema check will
see the current columns and skip seeding. Legacy invoice schemas (missing `discount_amount` or
`invoice_items.amount`) are **not** migrated on Turso — migrate a local copy first, then import it.

---

## 2. Render (API)

1. Push this repository to a private Git host. Render deploys from Git, not from a ZIP.
2. Create **New → Web Service** and select the repo. `render.yaml` is included as a blueprint, or set
   the fields manually:
   - Runtime: **Node 24+**
   - Build command: `npm ci`
   - Start command: `npm start`
   - Health check path: `/api/health`
   - Plan: **Free** (one instance only)
3. Add these environment variables:

| Variable | Example | Notes |
|---|---|---|
| `ADMIN_PASSWORD` | long unique passphrase | Required, 14+ chars. Changing it revokes all sessions. |
| `TURSO_DATABASE_URL` | `libsql://nexora-xxxx.turso.io` | From step 1. |
| `TURSO_AUTH_TOKEN` | token string | From step 1. Never commit it. |
| `PUBLIC_ORIGIN` | `https://your-site.netlify.app` | The Netlify URL. Allows the proxied `Origin` through the CSRF guard. |
| `COOKIE_SECURE` | `true` | Required: Netlify is HTTPS. |
| `TRUST_PROXY` | `true` | Render sets forwarding headers; rate limiting needs the real IP. |
| `HOST` | `0.0.0.0` | Required for Render's container. |
| `PORT` | leave unset | Render injects it. |

4. Do **not** set `DB_PATH` on Render. With `TURSO_DATABASE_URL` present, the hosted driver is used
   and `DB_PATH` is ignored.
5. Wait for the deploy to finish, then open `https://your-api.onrender.com/api/health`. Expect
   `{"ok":true,"service":"nexora"}`.

**Render free tier caveats:** the instance sleeps after inactivity, so the first request after a pause
can take about a minute (cold start). The login/IP rate limits are in memory and reset on restart;
keep a single instance. If you ever add replicas, move the rate-limit counters to a shared store.

---

## 3. Netlify (frontend)

1. Create **New site from Git** and select the same repo.
2. Build settings come from `netlify.toml`:
   - Build command: `npm ci && npm run build`
   - Publish directory: `public`
   - Node version: 24
3. Add one environment variable in Netlify:
   - `RENDER_API_URL` = `https://your-api.onrender.com` (no trailing slash, HTTPS only)
4. Deploy. `scripts/build-static.js` copies only the five HTML files and `assets/` into `public/`
   and writes `_redirects` + `_headers` from the templates in `deploy/netlify/`. No server source,
   `.env` or database file is published.

The generated `_redirects` does two jobs:

```
/api/*   https://your-api.onrender.com/api/:splat   200
/        /premium.html   200
/login   /login.html   200
/onboarding  /onboarding.html  200
/dashboard  /dashboard.html  200
/invoice/*  /invoice.html  200
```

The `200` rewrites keep the clean URL in the address bar, which matters because `invoice.html` reads
the invoice id from `window.location.pathname`.

---

## 4. Verify

- [ ] `/api/health` on Render returns `{"ok":true,"service":"nexora"}`.
- [ ] `https://your-site.netlify.app/` loads and `/api/health` through Netlify returns the same JSON.
- [ ] Sign in at `/login`; the dashboard loads with data and no console errors.
- [ ] Refresh `/dashboard` and open an invoice directly — both still work.
- [ ] Sign out, then open `/dashboard` — the page shell is visible for a moment and the JS sends you
      to `/login.html` once the API returns 401.
- [ ] Response headers include the CSP with the inline-script hash, `X-Frame-Options: DENY` and
      `no-store` on API/private-page responses.
- [ ] `https://your-site.netlify.app/server/index.js`, `/package.json` and `/.env` return 404.

---

## 5. Things to know

- **Private pages are static on Netlify.** `/dashboard` and `/invoice/:id` are rewrites of plain HTML;
  Netlify cannot check the session cookie before serving them. They contain no business data — every
  table is filled by authenticated `/api/*` calls, and a 401 redirects to `/login.html`. If you need
  the HTML itself to be private, proxy those two routes to Render instead (Express already enforces
  `requirePage` on them).
- **The CSP hash is duplicated on purpose.** It appears in `server/index.js` (`INLINE_SCRIPT_HASH`)
  and in `deploy/netlify/_headers`. If the inline boot script in `premium.html` changes, update both.
- **Sessions are still stored in the database**, not in a signed cookie. Turso is persistent, so this
  keeps the existing 7-day expiry, logout revocation and "password change revokes all sessions"
  behaviour with no extra code.
- **Free limits change.** Check current Netlify build minutes/bandwidth and Turso row/storage limits
  before using this for real client data, and keep a backup/export of the Turso database.
- **Local development is unchanged:** `npm run dev` uses `node:sqlite` and needs no Turso account.
  `npm test` runs the full 96-test suite offline.
