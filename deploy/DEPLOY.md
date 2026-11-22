# Nexora — production deployment (Node host)

This package is the existing Nexora app: Express 4, native `node:sqlite`, no build step. Deploy it
**as a single long-running Node process on a host with persistent disk**. Do not deploy it as a
static site or as stateless serverless functions — the SQLite file must survive restarts.

## Package contents

- `package.json`, `package-lock.json`, `.env.example`, `.gitignore`
- `server/` — all Express routes, auth, DB, invoice logic and middleware
- `*.html` — the five served pages
- `assets/` — CSS, JS and self-hosted fonts
- `README.md`, `DEPLOY.md`

Deliberately excluded: `.env`, `private/` (database, leads, backups), `call_list/` (client PII),
`node_modules/`, `test/`, `test-support/`, `.opencode/`, audit/design docs and every `.db*` file.

## 1. Local smoke test

```powershell
cd nexora-production
npm ci --omit=dev
Copy-Item .env.example .env   # then edit .env and set a long ADMIN_PASSWORD
npm start
```

Open `http://127.0.0.1:3000/`, sign in at `/login`, and check `GET /api/health` returns
`{"ok":true,"service":"nexora"}`.

## 2. Environment variables

| Variable | Production value | Notes |
|---|---|---|
| `ADMIN_PASSWORD` | long unique passphrase, **14+ chars** | Required. Changing it revokes every session on next start. Never commit it. |
| `PORT` | host default (`3000`) or platform-provided | Render/Railway inject their own; the app reads `process.env.PORT`. |
| `HOST` | `0.0.0.0` in containers, `127.0.0.1` behind a local reverse proxy | Never bind publicly without TLS. |
| `COOKIE_SECURE` | `true` **only over HTTPS** | Enables `Secure` cookie + HSTS. `true` over plain HTTP breaks login. |
| `TRUST_PROXY` | `true` only behind a trusted reverse proxy | Lets rate limiting see the real IP via `X-Forwarded-For`. |
| `DB_PATH` | absolute path on a persistent volume, e.g. `/data/nexora.db` | If omitted, the app uses `private/data/nexora.db` inside the app folder. |

## 3. Persistent storage — critical

SQLite writes `nexora.db`, `nexora.db-wal` and `nexora.db-shm` next to `DB_PATH`. Mount a
**persistent block volume** there before first start, and make it writable by the runtime user.

- Keep the volume private; never put it under `assets/` or any served path.
- Do not use ephemeral container filesystems, NFS/SMB or object storage for the WAL files.
- Run **one instance only**. Rate limiting is in memory and SQLite has a single writer. Scaling out
  requires an external database plus a shared rate-limit store first.
- On first start with an empty volume the app creates the schema and seeds records labelled DEMO.
  It never overwrites an existing database; schema migrations run automatically on restart.

## 4. Render

1. Push the unzipped folder to a **private** Git repository (Render deploys from Git, not from ZIP).
2. Create **New → Web Service** from that repo.
3. Runtime: **Node 24+**. Build command: `npm ci --omit=dev`. Start command: `npm start`.
4. Add a **Persistent Disk**, mount path `/data` (1 GB is plenty to start).
5. Environment variables: `ADMIN_PASSWORD`, `DB_PATH=/data/nexora.db`, `HOST=0.0.0.0`,
   `COOKIE_SECURE=true`, `TRUST_PROXY=true`. Leave `PORT` to Render.
6. Health check path: `/api/health`.
7. Render's free web-service tier has no persistent disk — use a paid plan with a disk.

## 5. Railway

1. Create a service from the private repo, or run `railway up` inside the unzipped folder.
2. Add a **Volume** and mount it at `/data`.
3. Variables: same as Render — `DB_PATH=/data/nexora.db`, `HOST=0.0.0.0`, `COOKIE_SECURE=true`,
   `TRUST_PROXY=true`, plus a strong `ADMIN_PASSWORD`.
4. Railway supplies HTTPS and sets forwarding headers, so both proxy flags are correct.
5. Health check path: `/api/health`.

## 6. VPS (Ubuntu, systemd + nginx)

```bash
sudo mkdir -p /opt/nexora/data
# copy the unzipped files into /opt/nexora, then:
cd /opt/nexora
npm ci --omit=dev
```

Create `/etc/nexora.env` with mode `600`, owned by the service user:

```
ADMIN_PASSWORD=<long-unique-passphrase>
HOST=127.0.0.1
PORT=3000
DB_PATH=/opt/nexora/data/nexora.db
COOKIE_SECURE=true
TRUST_PROXY=true
```

`/etc/systemd/system/nexora.service`:

```ini
[Unit]
Description=Nexora
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/nexora
EnvironmentFile=/etc/nexora.env
ExecStart=/usr/bin/npm start
Restart=always
User=www-data
Group=www-data

[Install]
WantedBy=multi-user.target
```

Enable with `sudo systemctl daemon-reload && sudo systemctl enable --now nexora`. Put nginx in front
with TLS (certbot), `proxy_pass http://127.0.0.1:3000;`, and forward `X-Forwarded-For` and
`X-Forwarded-Proto`. Because nginx sets those headers, `TRUST_PROXY=true` is correct here.

## 7. Pre-deploy security checklist

- [ ] `ADMIN_PASSWORD` is 14+ chars, unique, and present only in the host's secret/env store.
- [ ] No `.env`, `.db`, `.db-wal`, `.db-shm`, lead CSV/PDF or backup file is in the upload.
- [ ] HTTPS is active; `COOKIE_SECURE=true`; HSTS is sent (the app adds it only with that flag).
- [ ] `TRUST_PROXY=true` only behind a trusted proxy; otherwise leave it `false`.
- [ ] Persistent volume is mounted, private and writable; `DB_PATH` points into it.
- [ ] Exactly one instance. Do not add replicas before replacing in-memory rate limiting.
- [ ] `npm ci --omit=dev` succeeds and `npm audit --omit=dev` reports 0 vulnerabilities.
- [ ] `/` and `/api/health` return 200; `/private/data/nexora.db`, `/index.html`, `/package.json`
      and `/.env` return 404.
- [ ] Login sets `HttpOnly; SameSite=Lax` (and `Secure` on HTTPS); dashboard/invoice pages send
      `Cache-Control: no-store`.
- [ ] CSP has no `'unsafe-inline'`; responses are Brotli/gzip compressed with `Vary: Accept-Encoding`.
- [ ] Contact inbox is `nexora7021@gmail.com` in the footer, onboarding aside and invoice footer.
- [ ] A backup job and a tested restore exist before any real client data is entered.

## 8. Backups and restore

While the server is running, use SQLite's online backup (safe with WAL):

```bash
sqlite3 /data/nexora.db ".backup /backup/nexora-$(date +%F).db"
```

Alternatively stop the service and copy `nexora.db`, `nexora.db-wal` and `nexora.db-shm` together.
Test a restore by starting a second copy of the app with `DB_PATH=/tmp/restore-test.db` pointing at
the restored file — never experiment on the production database.

## 9. Updating

Unzip the new package over the existing files, keep the `/data` volume untouched, run
`npm ci --omit=dev`, then restart. Schema migrations and the invoice sequence are applied at
startup. Re-run the checklist afterwards.
