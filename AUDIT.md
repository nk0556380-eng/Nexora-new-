# Nexora — Combined Audit Report

**Date:** 19 November 2026
**Scope:** `server/`, all application pages, `assets/`, `DESIGN.md`, `package.json` and the deployed directory layout.
**Mode:** read-only audit. Five specialist audits were combined; nothing was modified during the audit itself.
**Line numbers** refer to the tree **before Batch 0 remediation** (see §13). Batch 0 changed `server/index.js`, `server/auth.js`, `server/db.js`, `package.json`, `README.md`, `login.html` and moved private files, so some references have shifted since.

---

## 1. Executive summary

The implementation is above average for a prototype. SQL is parameterised throughout, the password comparison is timing-safe, every HTML sink uses an escape helper, every admin route is guarded server-side, and `npm audit` reports zero vulnerabilities. The design language is coherent and `prefers-reduced-motion` is handled.

The problems are concentrated in three places:

1. **Exposure** — the static mount served the project root, so a `%2F` path bypassed the deny-list and published the live database (including session tokens), lead PII, application source and a source archive.
2. **Trust boundaries** — invoice totals and invoice status are computed or decided in the browser and merely submitted to the server.
3. **Missing invariants** — no transaction around invoice creation, no server-side session expiry, no rate limiting, no schema validation, and several accessibility contracts (focus management, error association) that exist on one page but not another.

**102 findings were raised. Seven were duplicate reports of the same defect across audits, leaving 95 unique: 3 Critical, 20 High, 42 Medium, 30 Low/Info.**

> Reconciliation note: an earlier chat summary rounded this to 92. The reconciled figure after explicit duplicate matching is 95.

---

## 2. Severity at a glance

| Domain | Findings | Critical | High | Medium | Low/Info |
|---|---|---|---|---|---|
| Security (`SEC`) | 13 | 2 | 1 | 4 | 6 |
| Code review (`CR`) | 31 | 1 | 7 | 10 | 13 |
| Accessibility (`A11Y`) | 38 | 2 | 8 | 17 | 11 |
| Design system (`DS`) | 10 | 0 | 3 | 3 | 4 |
| Performance (`PERF`) | 10 | 0 | 2 | 4 | 4 |
| **Raw total** | **102** | **5** | **21** | **38** | **38** |

### Cross-audit duplicates (counted once in the merged board)

| Merged item | Reported as |
|---|---|
| Public root served statically | SEC-01, SEC-03, CR-01 |
| Default admin password published | SEC-02, CR-06 |
| Sessions never expire | SEC-04, CR-05 |
| Login/write rate limiting missing | SEC-06, CR-05, CR-13 |
| No security headers | SEC-08, CR-27 |
| No error-handling middleware | SEC-09, CR-04 |
| Reference generation via `COUNT(*)` | SEC-10, CR-09 |

---

## 3. Critical — fix before anything else

| ID | Sources | File:Line | Finding |
|---|---|---|---|
| **NEX-01** | SEC-01, SEC-03, CR-01 | `server/index.js:16,244` | `express.static(ROOT)` served the project root. The deny-list matched the raw path, so `%2F` slipped past it. Verified live: `/data%2Fnexora.db` returned 200 (the DB, containing plaintext `sessions.token`), `/server%2Fauth.js` 200, `/leads%2Fleads.csv` 200 (25.7 KB of lead PII), `/nexora-project.zip` 200 (225 KB source). Downloading the DB alone grants admin without the password. |
| **NEX-02** | SEC-02, CR-06 | `auth.js:6`, `login.html:32`, `index.js:250` | The admin password fell back to `[redacted]`, was printed on the public login page, echoed to stdout at boot, and repeated in the README. |
| **NEX-03** | A11Y-01 | `app.js:278-287`, `dashboard.html:87-92` | `openModal()` never moved focus, trapped Tab, or restored focus on close, while `aria-modal="true"` claimed isolation. Keyboard and screen-reader users could not reliably create an invoice or review a client. |

---

## 4. High

### Security and data
| ID | Sources | Finding |
|---|---|---|
| NEX-04 | SEC-04, SEC-06, CR-05 | Sessions never expire server-side (`created_at` written, never read, never pruned); a password change does not revoke them; `/api/login` has no rate limit or lockout. |
| NEX-05 | SEC-05 | Session cookie has no `Secure` and `app.listen(PORT)` binds `0.0.0.0`, so tokens travel in cleartext over the LAN. |
| NEX-06 | SEC-07 | `if (!body.consent)` accepts the string `"false"` and stores `consent = 1` — a false consent record for prospect data. No schema validation; `text()` turns objects into `"[object Object]"`. |
| NEX-07 | SEC-09, CR-04 | No error middleware and no `NODE_ENV`, so Express returns HTML stack traces with absolute paths on 500. |

### Money correctness
| ID | Sources | Finding |
|---|---|---|
| NEX-08 | CR-03 | Invoice header and items are separate writes with no transaction. A failure at item 3 of 5 leaves a total for 5 and items for 2. No idempotency key, so retries create duplicate invoices and numbers. |
| NEX-09 | CR-02 | Client preview multiplies raw qty (`app.js:355`); the server rounds qty first (`index.js:182`). `1.5 × ₹100` previews ₹150 and stores ₹200. |
| NEX-10 | CR-07 | Invoice status accepts draft/sent/paid in any direction; "Mark paid" is only hidden client-side; `paid` records no `paid_at`/`paid_amount`. |
| NEX-11 | CR-08 | `billed` sums `total` across all statuses including drafts and demo rows, overstating the "TOTAL BILLED" KPI. |

### Accessibility (task-blocking)
| ID | Source | Finding |
|---|---|---|
| NEX-12 | A11Y-02 | Invoice line-item inputs use `<label>` with no `for`/`id` — Description/Qty/Rate have no accessible name. |
| NEX-13 | A11Y-04 | `.field input:focus{outline:none}` removes the focus ring; the replacement halo is 1.15:1 (1.04:1 in the light theme). |
| NEX-14 | A11Y-05 | `setError()` (`app.js:57-67`) never sets `aria-describedby`, so screen readers hear "invalid entry" but never the reason. `premium.js:88-94` already does this correctly. |
| NEX-15 | A11Y-07 | Accept/Reject/Mark-paid re-render all four `tbody` elements, destroying the focused button and dropping focus to `<body>` on every action. |
| NEX-16 | A11Y-08 | `--dim:#6d7486` on surface = 3.97:1, used for 9.3px table headers, `.cell-sub`, `.demo-tag`, `.auth-hint`. |
| NEX-17 | A11Y-09 | `.btn-primary` white label on the gradient start `#7c6cf6` = 3.94:1 — the primary call to action. |
| NEX-18 | A11Y-03 | Off-canvas sidebar at ≤860px is hidden with `transform` only; its six links stay focusable and precede the menu button, so the first Tab lands off-screen. |
| NEX-19 | A11Y-06 | Onboarding success replaces `form.parentNode` (the whole layout, including the aside), drops focus and is not announced. |

---

## 5. Root causes

Fixing these five removes roughly forty findings.

1. **No single token source of truth.** `premium.css:6-36` and `app.css:5-30` each declare the same tokens and have already drifted (`--line-soft` `.07` vs `.06`, `--shadow` `.45` vs `.5`, `--t` `200ms` vs `180ms`). `DESIGN.md` YAML frontmatter still declares the abandoned light-teal system (`canvas:#F6F5F1`, Inter).
2. **No shared client module.** `setError`/validation is implemented three times (`app.js`, `premium.js`, `main.js`); `fetch → JSON → throw` twice. Three different announcement behaviours.
3. **Server trusts the client for state.** Invoice status, paid flag and totals are decided in the browser and merely submitted.
4. **No transaction boundary.** Invoice creation and `COUNT(*)+1` reference generation assume nothing fails and nothing runs concurrently.
5. **Static mounted on the repository root.** One line caused NEX-01, the entire PII leak and source disclosure.

---

## 6. Security findings (full)

| ID | Severity | File:Line | Finding | Recommended fix | Effort |
|---|---|---|---|---|---|
| SEC-01 | Critical | `server/index.js:244` | Root served statically; encoded-path deny-list bypass exposes DB and source | Mount static on `assets/` only; move private files out of the served tree | S |
| SEC-02 | Critical | `server/auth.js:6` | Default password fallback published on login page and in logs | Remove fallback; require strong env var; delete hints | XS |
| SEC-03 | High | `server/index.js:244` | Root served statically exposes lead CSV, call-list JSON, source ZIP, `.opencode/` | Scope static root; remove private artefacts from the served tree | S |
| SEC-04 | Medium | `server/auth.js:37` | Sessions never expire or prune; password change does not revoke | Enforce `created_at` window; prune on login; revoke on password change | S |
| SEC-05 | Medium | `server/auth.js:43` | Cookie lacks `Secure`; server binds `0.0.0.0`; no HSTS | Bind `127.0.0.1`; add `Secure` behind TLS; use `__Host-` prefix | S |
| SEC-06 | Medium | `server/index.js:38` | No rate limit or lockout on login or public POST routes | Per-IP limiter (~5 login/15 min; ~10 writes/hour), return 429 | S |
| SEC-07 | Medium | `server/index.js:80` | Consent truthiness bug; no schema validation; unbounded items array | Schema validation (`consent: literal(true)`, bounded strings, capped items) | M |
| SEC-08 | Low | `server/index.js:12` | No security headers (CSP, frame-ancestors, nosniff, referrer) | Add helmet with CSP; hash/nonce the inline script | S |
| SEC-09 | Low | `server/index.js:246` | No error handler; stack traces returned with absolute paths | Terminal JSON error handler; set `NODE_ENV=production` | XS |
| SEC-10 | Low | `server/index.js:25` | Refs derived from `COUNT(*)`; table name interpolated; dead `column` param | Derive from inserted id inside a transaction; drop dead parameter | S |
| SEC-11 | Low | `server/auth.js:43` | CSRF relies solely on `SameSite=Lax`; no Origin/Sec-Fetch-Site check | Add same-origin guard for non-GET `/api/*` | S |
| SEC-12 | Info | `server/db.js:10` | No `.gitignore`: DB, sessions and future `.env` would be committed | Add `.gitignore`; keep data outside the web root or behind `DB_PATH` | XS |
| SEC-13 | Info | `server/index.js:240` | No client portal; invoices reachable only via shared admin session | Future portal needs per-client identity and object-level authorization | M |

---

## 7. Code review findings (full)

| ID | Severity | File:Line | Finding | Recommended fix | Effort |
|---|---|---|---|---|---|
| CR-01 | Critical | `server/index.js:244` | Root served statically; private files publicly reachable | Serve an explicit public directory | S |
| CR-02 | High | `index.js:191-193` vs `app.js:352-359` | Previewed total ≠ stored total for decimal quantities | One rounding rule; display the server-returned total | M |
| CR-03 | High | `server/index.js:196-216` | Invoice header and items not transactional; no idempotency | Transaction + idempotency key with UNIQUE | M |
| CR-04 | High | `server/index.js:246` | No error middleware; stack traces leak paths | JSON error handler + request id; `NODE_ENV=production` | S |
| CR-05 | High | `auth.js:34-38`, `db.js:75-78` | No session expiry; logout deletes only the presented token; no login rate limit | `expires_at`, enforce and prune, per-IP limiter and lockout | M |
| CR-06 | High | `login.html:32`, `index.js:250`, `auth.js:6` | Default password published on the login page and at boot | Fail startup when unset; never print it; delete the hint | S |
| CR-07 | High | `index.js:221-229`, `app.js:231` | Invoice status accepts any transition; no `paid_at`/`paid_amount` | Explicit transition map with predecessor check; record payment fields | M |
| CR-08 | High | `server/index.js:109,115` | `billed` includes drafts and demo rows | Sum `sent`+`paid` only, exclude `is_sample` | S |
| CR-09 | Medium | `server/index.js:24-27` | Ref = `COUNT(*)+1`: reuses numbers after deletion, collides concurrently | Derive from inserted id in-transaction; drop dead parameter | S |
| CR-10 | Medium | `server/index.js:173-174` | Dates are free text; `"banana"` accepted | Validate `YYYY-MM-DD` and `due >= issue` | S |
| CR-11 | Medium | `index.js:201-202`, `db.js:51-52,69` | `order_id`/`client_id` unchecked; no FKs; `foreign_keys` off | Verify existence in-transaction; add FKs; enable pragma | S |
| CR-12 | Medium | `index.js:175,180-184,216` | Unbounded items array; one synchronous INSERT per item | Cap at ~50; batch insert in one transaction | S |
| CR-13 | Medium | `index.js:51-69,71-102`, `db.js:29-46` | No rate limit/dedupe on public POSTs; `clients.email` not UNIQUE | Rate limit, UNIQUE email, honeypot or Turnstile | M |
| CR-14 | Medium | `index.js:126-128,140-142,154-161` | No pagination; `/api/invoices` loads all rows and filters in JS | Paginate; grouped JOIN; patch state from responses | M |
| CR-15 | Medium | `app.js:29-44` | `api()` swallows JSON parse errors; no network-error branch | Read `text()`, try-parse, typed error with status | S |
| CR-16 | Medium | `app.js:231,439-442` | "Mark paid" double-submit; tabs desync; no in-flight guard | Disable while pending; adopt response; gate on `updated_at` | S |
| CR-17 | Medium | `app.js:366-377` | Invoice form validates only `[required]`; silently drops rows with `rate <= 0` | Validate items explicitly; error instead of filtering | S |
| CR-18 | Medium | `app.js:22-27` | `toISOString().slice(0,10)` returns UTC dates; wrong default before 05:30 IST | Build local `YYYY-MM-DD` from `getFullYear/Month/Date` | S |
| CR-19 | Low | `app.js:438` | `reviewClient()` not awaited; floating `load()` | Await and make failures explicit | S |
| CR-20 | Low | `app.js:447-450` | Empty catch on logout; failed logout still redirects | Report failure or clear state and retry | S |
| CR-21 | Low | `app.js:57-81`, `premium.js:81-115`, `main.js:84-124` | Three `setError`/validation implementations with different ARIA behaviour | Shared form-errors module | M |
| CR-22 | Low | `app.js:100,277-287,421-423` | Page blocks assume nodes exist; one missing node disables the rest | Guard lookups or split per-page modules | M |
| CR-23 | Low | `index.js:130-138,144-152,221-229` | Status whitelists duplicated; no transition rules | Shared status map + transition table | S |
| CR-24 | Low | `auth.js:20-32` | Unguarded `decodeURIComponent` turns malformed cookies into 500s | try/catch per cookie pair | S |
| CR-25 | Low | `app.js:1-493` | One 23.8 KB IIFE shipped to every page, mostly unused | Split into per-page modules | M |
| CR-26 | Low | `index.html:12,476`, `main.js:1-148`, `styles.css` | Legacy page served but unreachable from the app; duplicates site logic | Delete all three (kept on disk after Batch 0; no longer served) | S |
| CR-27 | Low | `index.js:9-18,106-229` | No security headers; no `Cache-Control: no-store` on authenticated JSON | helmet + `no-store` for `/api` | M |
| CR-28 | Info | `package.json:6-12` | No test, lint, typecheck or format script | `node --test` + ESLint; tests named in the original review | M |
| CR-29 | Info | `db.js:81-111` | Seed rows share tables with real data and only gate on `orders` being empty | Explicit `npm run seed`, or exclude `is_sample` from aggregates | S |
| CR-30 | Info | `premium.js:130-137` | Duplicate fetch/JSON/error handling with different messages | Shared `http.js` and `site.js` | M |
| CR-31 | Info | `server/index.js:20` | `text()` silently truncates and can split surrogate pairs | Return 400 with per-field length errors | S |

### Duplication map

| Behaviour | Occurrences | Suggested home |
|---|---|---|
| `setError(field, message)` | `app.js:57-67`, `premium.js:81-95`, `main.js:84-98` | `assets/js/lib/form-errors.js` |
| Email regex | `index.js:21`, `app.js:75`, `premium.js:112`, `main.js:118` | Client module (server keeps its own copy) |
| Validation loop / `aria-invalid` | `app.js:69-81`, `premium.js:108-115`, `main.js:111-124` | `form-errors.js → validateFields` |
| Mobile nav open/close | `premium.js:8-36`, `main.js:9-49` | `site.js` |
| Scroll reveal | `premium.js:39-51`, `main.js:52-66` | `site.js` |
| FAQ accordion | `premium.js:69-73`, `main.js:69-74` | `site.js` |
| Header scroll shadow | `premium.js:12-16`, `main.js:10-14` | `site.js` |
| Footer year | `premium.js:148-149`, `main.js:146-147`, `app.js:491-492` | `site.js` |
| fetch → JSON → throw | `app.js:29-44`, `premium.js:130-137` | `http.js` |
| Status PATCH handler | `index.js:130-138,144-152,221-229` | `updateStatus()` helper |
| Invoice total math | `app.js:352-359`, `index.js:190-193` | Server-authoritative money module |
| Status pill markup | `app.js:193-195,465`, `invoice.html:15` | `pill()` |
| Active nav/sidebar | `app.js:183-191`, `premium.js:53-66` | Per-page view module |

---

## 8. Accessibility findings (full)

WCAG 2.2 AA. Contrast ratios are measured, not estimated.

| ID | Severity | SC | File:Line | Finding | Recommended fix | Effort |
|---|---|---|---|---|---|---|
| A11Y-01 | Critical | 2.4.3, 4.1.2 | `dashboard.html:87-92`, `app.js:278-287` | Modal never receives focus, no containment, no restore; `aria-modal` claims isolation it doesn't provide | Store trigger, focus dialog, `inert` the shell, trap Tab, restore on close | M |
| A11Y-02 | High | 1.3.1, 3.3.2, 4.1.2 | `app.js:343-345` | Invoice line-item inputs have no accessible name (label without `for`) | Unique `id`/`for` or wrapping label | L |
| A11Y-03 | High | 2.4.3, 2.4.11 | `dashboard.html:14-30`, `app.css:274` | Hidden sidebar remains focusable and precedes the menu button | Add `visibility`/`inert`; reorder DOM | L |
| A11Y-04 | High | 2.4.7, 1.4.11 | `premium.css:253`, `app.css:72`, `styles.css:333` | `outline:none` with a 3px halo at 1.15:1 (1.04:1 light) | Remove `outline:none`; add a ≥3:1 ring | L |
| A11Y-05 | High | 3.3.1, 4.1.3, 1.3.1 | `app.js:57-67` | Errors never linked via `aria-describedby` | Mirror `premium.js` implementation | L |
| A11Y-06 | High | 2.4.3, 4.1.3 | `app.js:157-164` | Success replaces the layout, drops focus, isn't announced | Replace only the form; focus the heading; live region | L |
| A11Y-07 | High | 2.4.3 | `app.js:249-252,433-434,440-442` | Row actions re-render the table and lose focus | Restore focus to the row action; announce result | M |
| A11Y-08 | High | 1.4.3 (3.97:1) | `app.css:14` (used 8 places), `premium.css:16` | `--dim` fails 4.5:1 on surface and canvas for normal text | Raise to ≈`#8a93a6` or use `--muted` | M |
| A11Y-09 | High | 1.4.3 (3.94:1) | `premium.css:78`, `app.css:55` | Primary button gradient start fails with white label | Darken start stop to ≥`#6a5ae8` | L |
| A11Y-10 | High | 1.4.3 (3.73:1) | `styles.css:10` (legacy `index.html`) | Muted text on canvas fails at 11.8–14px | Moot if legacy page removed | L |
| A11Y-11 | Medium | 1.4.3 (4.14:1) | `styles.css:118` | Light-theme CTA white on teal fails at rest | Darken resting fill | L |
| A11Y-12 | Medium | 3.3.1, 4.1.3 | `login.html:29`, `app.js:104-115` | `role="alert"` + `aria-live="polite"`; error not linked to the field | Keep one live semantic; add `aria-describedby` | L |
| A11Y-13 | Medium | 4.1.2, 1.4.1 | `dashboard.html:63`, `app.js:414-418` | Order filters expose state by colour only | `aria-pressed` / group label; announce count | L |
| A11Y-14 | Medium | 4.1.2, 4.1.3 | `dashboard.html:17-20`, `app.js:183-191` | Sidebar view state not exposed; view switch not announced | `aria-current`; move focus / announce | L |
| A11Y-15 | Medium | 1.3.1, 2.4.1 | `dashboard.html:13-33` | No `<main>` landmark and no skip link | Use `<main>`; add skip link | L |
| A11Y-16 | Medium | 1.3.1 | `dashboard.html:47,64,72,80`, `app.js:477` | Five tables lack captions, `scope`, action header | Captions/`aria-label`, `scope="col"` | L |
| A11Y-17 | Medium | 2.4.4, 2.4.6 | `app.js:201-204,225-226,230-231` | Bare repeated row actions lack entity context | `aria-label` with order/invoice reference | L |
| A11Y-18 | Medium | 4.1.2 | `premium.html:233-238`, `premium.css:235-238`, `premium.js:69-73` | Collapsed FAQ answers stay in the accessibility tree | `visibility:hidden`/`hidden`; `aria-controls` | L |
| A11Y-19 | Medium | 1.1.1, 1.3.1 | `premium.html:66-101` | Hero workspace mock is announced as real controls and data | `role="img"` + label, or `aria-hidden` | L |
| A11Y-20 | Medium | 1.4.3 (forced colors) | `premium.css:66`, `app.css:43` | Gradient text becomes invisible in forced-colors mode | `forced-colors` override to `CanvasText` | L |
| A11Y-21 | Medium | 3.3.1, 1.4.1 | `onboarding.html:58`, `app.js:135-141` | Consent error uses inline style, no `aria-invalid`/`aria-describedby` | Class-based error with ARIA | L |
| A11Y-22 | Medium | 4.1.3, 2.2.1 | `dashboard.html:94`, `app.js:46-55,358` | Toast written while hidden; auto-hides 3.6s; total not live | Unhide before writing; extend/control timeout; live total | L |
| A11Y-23 | Medium | 1.4.10, 1.4.3 (3.87:1) | `app.css:257,242` | Invoice totals force horizontal scroll at 320px; loading text fails contrast | `width:min(300px,100%)`; wrap table; darken text | M |
| A11Y-24 | Medium | 1.3.1, 4.1.3, 2.4.2 | `app.js:463-465,471-482`, `invoice.html:7,19` | Invoice skips h1→h3; no table caption; status not announced; static title | `h2`, caption, live region, per-invoice title | L |
| A11Y-25 | Medium | 2.4.3 | `premium.js:18-23,34` | Escape/outside-click closes nav without returning focus | Focus the toggle on Escape | L |
| A11Y-26 | Medium | 3.3.2 | `premium.html:255-259` | Required enquiry fields are not indicated | Visible marker + explanation | L |
| A11Y-27 | Medium | 1.4.3 (3.17:1) | `app.css:71`, `premium.css:252` | Placeholder text fails 4.5:1 | Raise to ≈`#8a93a6` | L |
| A11Y-28 | Medium | 2.1.1, 4.1.2 | `dashboard.html:30`, `app.js:410-413` | Escape doesn't close mobile sidebar; no `aria-controls` | Escape handler returning focus; `aria-controls` | L |
| A11Y-29 | Low | 3.3.2 | `onboarding.html:36-39` | `*` becomes part of the accessible name | `aria-hidden` marker + form note | L |
| A11Y-30 | Low | 1.3.5 | `onboarding.html:40-41`, `app.js:324` | Missing autocomplete on city, website, billing email | `address-level2`, `url`, `email` | L |
| A11Y-31 | Low | 2.5.8 / 2.5.5 | `app.css:177,194,200,217,59` | Targets 21–38px, below the documented 44px | Raise to 44×44 | L |
| A11Y-32 | Low | 1.3.1 | `onboarding.html:28` | `aria-label` on a generic div; step state colour-only | `<ol>` + `aria-current="step"` | L |
| A11Y-33 | Low | 1.3.1 | `onboarding.html:64` | Unnamed complementary landmark | `aria-labelledby` or demote | L |
| A11Y-34 | Low | 1.4.3 (4.04:1) | `app.css:61`, `premium.css:84` | Disabled label contrast 4.04:1 (exempt, but frequent) | Explicit disabled colours | L |
| A11Y-35 | Low | 2.2.2 | `premium.css:167`, `premium.html:104` | 40s infinite marquee with no pause control | Pause control or hover-only | L |
| A11Y-36 | Low | 1.4.12 | `premium.css:191,144`, `app.css:180` | Nowrap/ellipsis clusters at risk under text-spacing | Allow wrapping | L |
| A11Y-37 | Low | 1.4.10 | `premium.css:43` | `overflow-x:hidden` masks overflow; mock clipped at 320px | Remove; scroll inside the mock | L |
| A11Y-38 | Low | 1.3.1 | `premium.css:271` | Reveal animation hides content if JS fails | `noscript` override or apply class from JS | L |

**Per-page verdicts:** premium — conditional (CTA 3.94:1, focus halo 1.15:1). onboarding — fail (errors not linked or announced, success drops focus). login — conditional (error not associated). dashboard — fail (modal focus, focus lost after every action). invoice — conditional (320px horizontal scroll, status not announced).

---

## 9. Design system findings (full)

| ID | Severity | Finding |
|---|---|---|
| DS-01 | High | `DESIGN.md:1-120` frontmatter documents the abandoned light-teal system (`canvas:#F6F5F1`, Inter) while the product ships `#08090D` + Space Grotesk/DM Sans. Tools and agents reading tokens get the wrong system. |
| DS-02 | High | Three superseded variants are documented inline (`:290`, `:325`); no single authoritative spec for the current system. |
| DS-03 | High | `premium.css:6-36` and `app.css:5-30` duplicate the token block with real drift: `--line-soft` `.07` vs `.06`, `--shadow` `.45` vs `.5`, `--t` `200ms` vs `180ms`; `app.css` lacks `--bg-soft`, `--r-xl`, `--wrap`. |
| DS-04 | Medium | 65 raw hex and 66 rgba values inside components instead of tokens (`.btn-primary #6a5ae8`, inputs `#0b0e15`, placeholder `#5b6274`, `.status-sent #7cb8ff`). |
| DS-05 | Medium | Status tints re-declared as rgba literals six or more times; no `--amber-soft`/`--green-soft` tokens. |
| DS-06 | Medium | `.btn` differs between landing and app: 50px vs 46px height, 10px vs 9px radius, different shadows and tracking — not density, inconsistency. |
| DS-07 | Low | Radius scale (`8/14/20/26`) bypassed by hardcoded 5/6/7/9/10px. |
| DS-08 | Low | No theme layer; the white invoice sheet cannot reuse tokens. |
| DS-09 | Low | No spacing, type-scale or elevation tokens; 614 hardcoded `px` values across the two stylesheets. |
| DS-10 | Info | No component state matrix; `disabled` is `opacity:.6` only. |

---

## 10. Performance findings (full)

| ID | Severity | Finding |
|---|---|---|
| PERF-01 | High | **No compression.** Measured: `premium.css` 25.7 → 5.8 KB, `app.js` 23.2 → 6.5 KB, `premium.html` 18 → 5.0 KB, `app.css` 25.0 → 5.5 KB. Landing critical path is 49.2 KB raw but 12.7 KB gzipped, shipped uncompressed. |
| PERF-02 | High | No `Cache-Control` on `express.static`; assets revalidate on every navigation. |
| PERF-03 | Medium | No font `preload`; `font-display:swap` without a metric-matched fallback causes layout shift. |
| PERF-04 | Medium | Two render-blocking stylesheets per page (`fonts.css` + page CSS). |
| PERF-05 | Medium | `/api/invoices` (`index.js:154-161`) loads every item then filters per invoice in JS — O(n·m). Dashboard refetches four endpoints after every mutation. |
| PERF-06 | Medium | `nextRef` performs `COUNT(*)` per insert — O(n) and collision-prone. |
| PERF-07 | Low | No minification or bundling (acceptable given the no-build-step choice, but must be stated). |
| PERF-08 | Low | Legacy `index.html` + `styles.css` (382 lines) + `main.js` (124 lines) still present and previously served. |
| PERF-09 | Low | No index on `invoice_items.invoice_id`; ordering by `datetime(created_at)` defeats indexes. |
| PERF-10 | Info | No image assets exist; image optimisation is not applicable. |

---

## 11. Verified good — do not "fix" these

- Authorization is server-side on all nine admin JSON routes and three page routes; unauthenticated `/api/orders` returns 401, not a client-side redirect.
- Password comparison is timing-safe: both sides are SHA-256'd to fixed 32 bytes before `timingSafeEqual`.
- Session tokens are 256-bit `randomBytes(32)`, stored server-side, `HttpOnly`, `SameSite=Lax`, deleted on logout.
- Every SQL value is bound with `?`; no string interpolation of user input.
- `esc()` covers `& < > " '` at every `innerHTML` sink; `premium.js` uses `textContent`.
- `npm audit`: 0 vulnerabilities across 68 production dependencies; fonts self-hosted, no CDN.
- `PRAGMA journal_mode=WAL` is enabled; JSON body limit is 1 MB; `x-powered-by` disabled.
- `prefers-reduced-motion` rules exist in both stylesheets.
- Static forms have proper labels; the failure is specific to dynamically created line-item inputs.
- Status is never conveyed by colour alone; demo rows carry a `DEMO` tag.

---

## 12. Recommended fix sequence

The stated priority order was design → security. The evidence recommends inverting the first two: the security hotfix is about an hour and closes active PII exposure and admin takeover.

| Batch | Contents | Closes | Estimate |
|---|---|---|---|
| **0 — Hotfix** (done) | Scoped static root, private file relocation, mandatory password, session invalidation, `.gitignore` | NEX-01, NEX-02 | 1h |
| **1 — Security** (done) | Headers/CSP, error handler, session expiry, password-change revocation, rate limits, `Secure` + loopback bind, schema validation, consent fix | NEX-04→07, SEC-08/09/12, CR-04/05/06/10/12/13/24/31 | 4–5h |
| **2 — Money** (done) | Transaction + idempotency, single money module, transition map + payments, billed excludes drafts/demo, reference sequence, FKs/indexes, migration | NEX-08→11, SEC-10, CR-02/03/07/08/09/11/12/17/23/29 | 6h |
| **3 — Design system** (done) | Single three-layer `tokens.css`, deleted both `:root` blocks, rewrote `DESIGN.md`, fixed muted text/CTA/placeholder/focus contrast, unified buttons/fields/components | DS-01→10, NEX-13/16/17 | 8h |
| **4 — Accessibility** | Modal focus trap, `aria-describedby`, focus restoration, landmarks/captions/labels, `inert` sidebar, 320px reflow | NEX-03, 12→19 + 20 Medium | 10h |
| **5 — Performance & cleanup** | `compression`, cache headers, font preload, paginated/JOIN endpoints, split `app.js`, remove legacy files | PERF-01→09, CR-25/26 | 6h |

**Total ≈ 35 hours.** Batches 0–2 are about 11 hours and remove every Critical and every wrong-money path.

---

## 13. Remediation log

### Batch 0 — applied and verified

| Control | Change | Verification |
|---|---|---|
| Static exposure | `express.static` mounted at `/assets` on `assets/` only | `/data%2Fnexora.db`, `/server%2Fauth.js`, `/leads%2Fleads.csv`, `/nexora-project.zip` → **404**; traversal and encoded variants → 404 |
| Private data relocation | `data/`, `leads/`, `call_list_data.json`, `nexora-project.zip`, `*.ps1` moved to `private/` | Served tree contains only `assets/css`, `assets/js`, `assets/fonts` |
| Password fallback | Removed; startup throws if `ADMIN_PASSWORD` missing or under 16 chars | No-env and 11-char starts both exited with the required message |
| Password hints | Removed from `login.html`, boot log and `README.md` | Repo-wide grep for `[redacted]` / "demo password" returns nothing in the public tree |
| Session invalidation | `DELETE FROM sessions` executed | sessions 3 → 0 |
| Data preservation | Moves, not re-creation | DB SHA-256 identical before/after; orders 3, clients 3, invoices 1, items 1 unchanged |
| Backup | `private/backups/20261119-151030/` (DB + full project archive) | Backup DB hash matches live DB hash |
| `.gitignore` | Added; covers `.env*`, DB files, `private/`, `leads/`, archives | — |

### Batch 1 — applied and verified

| Control | Change | Verification |
|---|---|---|
| Security headers | CSP, `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-Policy` on every response; HSTS only when `COOKIE_SECURE=true` | Header assertions in `test/api.test.js`; browser console clean on `/`, `/login`, `/onboarding`, `/dashboard`, `/invoice/1` |
| CSP compatibility | `script-src 'self'` plus the SHA-256 hash of the single inline boot script; `style-src 'self' 'unsafe-inline'` for the hero chart style attributes | Hash recomputed from `premium.html` matched the served header; the inline script ran (`.js` class present); zero CSP console errors |
| Error handling | Central Express error handler: malformed JSON → 400, oversized body → 413, validation → 400, unknown → 500 with a generic message. Diagnostics logged server-side only | Unit tests assert no stack, path or SQL text in the body; live malformed JSON returned `Malformed JSON body.` |
| Session expiry | `expires_at` on `sessions`, 7-day TTL, `isAuthed` requires an unexpired row, pruned on startup and each login | Injected expired token → 401; row removed after the next login |
| Password-change revocation | Salted scrypt fingerprint stored in `app_meta`; a mismatch on startup deletes every session | Old cookie → 401 after a password change; restarting with the same password kept the session valid |
| Session migration | Pre-Batch-1 `sessions` table gains `expires_at`; existing rows are revoked once | Live DB columns now `token, created_at, expires_at`; `app_meta` created |
| Login protection | 5 failures per IP per 15 minutes → 429 + `Retry-After`; success clears the counter; failures return `Invalid credentials.` | 5 × 401 then 429; correct password also 429 while blocked; unit test proves the window resets |
| Public write limits | 40 requests per IP per hour on `/api/enquiries` and `/api/onboarding` | Limiter unit tests; quota then 429 |
| Network binding | `HOST` defaults to `127.0.0.1`, overridable | `netstat` showed `127.0.0.1:3110` only |
| Cookies | `HttpOnly`, `SameSite=Lax`, `Path=/`, `Max-Age`; `Secure` + HSTS only when `COOKIE_SECURE=true` | Plain HTTP cookie has no `Secure`; `COOKIE_SECURE=true` test showed `Secure` and HSTS |
| Request validation | New `server/validate.js`: object-only bodies, unknown-field rejection, type, length, enum, id, date, array and numeric checks. Objects/arrays are rejected, never stringified | 43 automated tests, including `{name:{}}` → 400 and `qty:"2"` → 400 |
| Consent | Accepted only as the boolean `true`; `"true"`, `"false"`, `1`, `"1"`, `0`, `null`, `{}`, `[]` and absent all rejected | Client row count unchanged across every rejected attempt; a real consent submission stored exactly one row |
| Proxy awareness | `TRUST_PROXY=true` enables `trust proxy` for deployments behind TLS termination | Documented; default off so a direct client cannot spoof `X-Forwarded-For` |

Automated coverage: `npm test` → 43 tests, 43 pass. Live verification against `private/data/nexora.db` → 54 checks, all pass, business rows unchanged (orders 3, clients 3, invoices 1, items 1). Browser verification: `/`, `/login`, `/onboarding`, `/dashboard` and `/invoice/1` loaded with zero console errors, fonts and styles applied, and the dashboard rendered 3 orders, 3 onboarding records and 1 invoice.

Remaining after Batch 1:

- No Origin/`Sec-Fetch-Site` check on non-GET `/api/*` (SEC-11); CSRF still relies on `SameSite=Lax`.
- Invoice money, transactions, status transitions, payment records, `billed` scope and reference generation were addressed in Batch 2 below.
- `order_id` / `client_id` are now checked against real rows and protected by foreign keys (Batch 2).
- Rate limiters are in-memory: per process, cleared on restart, and ineffective across multiple instances.
- `style-src 'unsafe-inline'` remains because the hero chart uses inline style attributes.
- `COOKIE_SECURE` defaults to false so local HTTP works; HTTPS deployments must set it to true.
- Sessions are not rotated on privilege change beyond password-change revocation.

### Batch 2 — applied and verified

| Control | Change | Verification |
|---|---|---|
| Single money implementation | `assets/js/money.js` is a UMD module loaded by `dashboard.html` and `require`d by `server/invoices.js`. Integer-scaled arithmetic with half-up rounding; money in whole rupees; qty ≤ 3 decimals; percentages ≤ 2 decimals | `test/invoice-math.test.js` proves decimals, half-up boundaries, discount-before-tax and rejection rules; server and preview returned identical totals for the same payload |
| Server authority | `POST /api/invoices` rejects client-sent `subtotal`, `tax_amount`, `discount_amount`, `total` and recomputes every line, discount and tax; total below ₹1 rejected | Forged-total requests returned 400 with `Unexpected field`; invoice row count unchanged; stored totals reproduced independently from line rows |
| Atomic creation | Invoice header and lines written inside `BEGIN IMMEDIATE`; sequence increment and idempotency record share the transaction | A `BEFORE INSERT` trigger forced a line failure; response 500, invoice count, item count and `invoice_seq` all unchanged |
| Idempotency | `Idempotency-Key` header (8–128 chars `[A-Za-z0-9_-]`); `invoice_requests` stores key, invoice and payload hash. Same key + same payload replays (`200`, `Idempotent-Replayed: true`); different payload → `409` | Repeated POST returned the same invoice ID with one row; conflicting payload returned 409 and still one row |
| Reference generation | `app_meta.invoice_seq` is incremented inside the same `BEGIN IMMEDIATE` transaction; year prefix comes from `issue_date`; `INV-2026-001` preserved | 6 concurrent POSTs across two server processes produced 6 unique IDs and numbers; distinct numbers equal total invoices |
| Status transitions | `server/invoices.js` transition map: `draft → sent/cancelled`, `sent → paid/cancelled`, `paid`/`cancelled` terminal; invalid transitions → `409` | `draft → paid`, `sent → draft`, `paid → sent/draft/paid` and `cancelled → paid` all rejected; database status unchanged after each |
| Payments | `payments` table with `invoice_id UNIQUE`, `amount`, `method`, server `paid_at`. `status: paid` requires a full payment; no partial payments; duplicate payment → `409` | Wrong amount, fractional amount, unknown method and missing payment returned 400 with no payment row; second payment returned 409 with exactly one row |
| KPI definitions | `billed` = real (`is_sample = 0`) `sent` + `paid` totals; `collected` = recorded payments on real invoices; `pending = max(0, billed − collected)`; drafts, cancelled and demo excluded | Automated snapshot re-derived the same values from raw rows; browser dashboard showed ₹0 billed while only the demo invoice existed, ₹15,930 after a real invoice was sent, and unchanged billed with collected updated after payment |
| Invoice page / print | Renders stored line `amount`, discount row when present, stored subtotal/tax/total, client details, status and payment date/method; no client-side recomputation | Browser flow: preview ₹15,930 → saved ₹15,930 → printed sheet Discount −₹1,500, Tax ₹2,430, Total ₹15,930, `Paid: 19 Nov 2026, 10:36 · UPI`; generated a real one-page A4 PDF (816 × 1056 pt) and confirmed every value, the `INV-2026-002` reference, client details and ₹ currency in the rendered page; zero console errors |
| Foreign keys | `PRAGMA foreign_keys = ON`, `busy_timeout = 5000`, WAL; rebuilt `invoices` and `invoice_items` with FKs to clients/orders/invoices; `payments` and `invoice_requests` FKs | Orphan item insert and orphan client update throw `FOREIGN KEY`; `PRAGMA foreign_key_check` clean on live DB |
| Migration | Versioned rebuild (`user_version = 2`) adds `discount_percent`, `discount_amount`, `invoice_items.amount`; nulls orphan links, refuses orphan line items before rebuilding | Rehearsed on a live copy and then applied live; orders, clients, sessions, password metadata and invoice header fields preserved; legacy line amount computed as `qty × rate`; second run is a no-op; orphan-item fixture aborts before any table is rebuilt |
| Indexes | Added `idx_invoices_status`, `idx_invoices_sample`, `idx_invoice_items_invoice`, `idx_sessions_expires` | Schema assertions in `test/db.test.js` |
| Validation | `discount_percent` added to strict invoice schema; qty accepts 3 decimals; rate must be a whole rupee; payment object strictly validated | Invalid qty/rate/discount cases returned 400 and created no rows |

Automated coverage after Batch 2: `npm test` → **86 tests, 86 pass**. Live verification against a copy of `private/data/nexora.db` → **58 checks, all pass**. Live migration backup: `private/backups/20261119-batch2/nexora-before-batch2.db`. Browser verification on a copy: dashboard KPIs, invoice creation with decimals and discount, send, payment modal, paid state, invoice page and a generated A4 PDF all matched the stored values with zero console errors.

Remaining after Batch 2:

- No partial payments, refunds, credit notes or invoice editing; content is immutable after creation by design.
- The dashboard preview refuses totals below ₹1 client-side; the server remains the authority.
- `billed` / `collected` / `pending` are lifetime totals with no date filter or period selector.
- The demo invoice stays excluded until it is deleted or converted; it still appears in the invoice list marked DEMO.
- Multi-process concurrency relies on SQLite `BEGIN IMMEDIATE` and a 5-second busy timeout; heavier write loads would need a different database.

Still open after Batch 2: CSRF origin checking, design-token work, accessibility work, compression and caching, pagination and query efficiency, order-reference generation, partial payments/refunds, and invoice editing.

### Batch 3 — applied and verified

| Control | Change | Verification |
|---|---|---|
| Token architecture | New `assets/css/tokens.css` with three layers: primitives (neutral, periwinkle, status, paper), semantic roles (canvas, surface, border, text, accent, status, invoice) and component values (buttons, fields, cards, sidebar, topbar, modal, focus). Both old `:root` blocks deleted from `premium.css` and `app.css` | All five served pages load `fonts.css → tokens.css → ui.css → page CSS`; no other `:root` remains in the served stylesheets; DS-01/02/03 closed |
| Shared component layer | New `assets/css/ui.css`: reset, base type, buttons (primary/secondary/ghost/danger, 36/44/48px), fields, labels, errors, hints, status pills, brand, kicker, skip link, focus and reduced-motion rules | Dashboard, onboarding, login, homepage and invoice now share one button/field/pill implementation; DS-04/05/06/07/10 closed |
| Contrast | Muted text raised to `#8F98AA`; accent text `#B1A4FF`; primary button `#6C5CE7` with white text; placeholders use muted; inputs no longer remove focus outlines | Measured: muted 6.65:1 on inputs, accent text 8.44:1 on surface, white on accent 4.86:1, invoice muted 5.78:1 on white; keyboard Tab focuses the password field with a 2px `#B1A4FF` outline |
| Page styling | Homepage hierarchy, container-sized two-line hero, CTA treatment, nav dropdown, bento spacing, workflow, dashboard panels, FAQ, footer; onboarding form blocks/aside; login card; dashboard shell/KPIs/tables/filters/modals/toasts; light invoice sheet | Browser pass on all five pages; sample workspace/financial figures remain labelled; no business claims added |
| Invoice light document | Invoice uses isolated paper/ink tokens; toolbar stays dark; table is fixed-layout; totals capped at 300px; print removes toolbar and sheet chrome | At 320px the sheet, table and totals stay inside the viewport; sheet remains white; A4 print rules preserved |
| Responsive containment | Decorative homepage ambients capped at `100vw`; bento/marquee wrap; tables scroll inside `.table-scroll`; dashboard topbar wraps below 640px; invoice toolbar stacks and type tightens below 560px | 48 screenshots (24 before, 24 after) at 320/375/768/1024/1440/1920 in `private/backups/20261119-batch3/screenshots/{before,after}`; all pages report document overflow 0 |
| Functional regression | No server, schema, invoice-math, status-transition or authentication changes | Browser flow on a temp DB copy: login error/success, dashboard views, accepted filter, invoice modal live total ₹5,900, create `INV-2026-002`, detail render, onboarding empty-submit blocked with 3 errors, enquiry blocked with 4 errors, mobile nav open/close; no unexpected console errors and no missing assets |
| Automated tests | Styles/HTML/JS only | `npm test` → **86 tests, 86 pass** |
| Documentation | `DESIGN.md` rewritten as one authoritative specification: tokens, type, layout, components, pages, responsive, contrast evidence, content rules and Batch 4 gaps. Superseded variants removed | No conflicting light-teal/Swiss/early-dark rules remain |

Browser verification notes: 37/40 scripted checks passed. Two "focus ring" failures were artifacts of programmatic `.focus()` not matching `:focus-visible`; a real `Tab` keypress produced a solid 2px outline, so both pass. The third was the expected `401` console entry from the deliberate wrong-password test. Invoice creation happened only in the temporary database copy; the live database and its 3 orders, 3 clients and 1 demo invoice were not modified.

Remaining after Batch 3:

- Modal focus trap, focus restoration, dynamic `aria-describedby` for generated line-item errors, landmark/table refinements and `inert` on the off-canvas sidebar remain Batch 4.
- `style-src 'unsafe-inline'` remains for the homepage chart and generated inline style attributes; CSP tightening belongs to Batch 5.
- Legacy `index.html`, `styles.css` and `main.js` remain on disk but are unreachable and unloaded; removal belongs to Batch 5.
- Mobile dashboard tables scroll horizontally inside their card by design; this is containment, not page overflow.
- `hello@nexora.in` remains a placeholder inbox.
- No client-portal route exists; About/Services/Contact are homepage sections, not separate pages.

### Batch 4 — applied and verified

| Control | Change | Verification |
|---|---|---|
| Modal dialog behaviour | `openModal()` records the opener, focuses the first field, traps Tab/Shift+Tab, closes on Escape and restores focus. The dashboard `.app-shell` is `inert` while the dialog is open, so the background cannot be tabbed or clicked. Dialog remains `role="dialog"`, `aria-modal="true"` and `aria-labelledby` | Browser: focus lands in `#i-client`; Tab from the last control wraps to Close; Shift+Tab from the first wraps to the final action; Escape closes, removes `inert` and returns focus to `#new-invoice-btn` |
| Field error wiring | `setError()` in `app.js` and the enquiry handler in `premium.js` create a unique error id, set `aria-invalid`, point `aria-describedby` at the message and remove the link when valid. Applied to login, onboarding consent, invoice line items, payment amount and enquiry fields | Browser: every invalid field exposes exactly one error id; fixing the value removes `aria-invalid` and the description; screen-reader text includes the reason, not just "invalid" |
| Invoice line items | Description/Qty/Rate inputs receive unique ids and matching `for` labels. Live validation covers description, qty > 0, whole-rupee rate ≥ 1 and line total; errors appear inline and the submit status region announces how many fields need attention. Server validation and arithmetic are untouched | Browser: create modal has three labelled inputs per row; empty description, qty `0` and rate `10.5` each produce a linked inline error and block creation; totals still match `money.js` |
| Dashboard semantics | Shell is `<main id="main-content">` with a skip link; sidebar is a labelled `complementary` landmark; view links expose `aria-current="page"`; filters expose `aria-pressed`; all five tables have captions, `scope="col"` and labelled scroll regions; row actions include the order/invoice reference; the view region reports `aria-busy` | Browser: one `main`, skip link targets it, active view and filters expose state, every table header is scoped, scroll regions are keyboard reachable, and action names include the record reference |
| Focus after re-render | Row actions capture `data-act`/`data-id` before the table re-renders and restore focus to the equivalent new control. A newly created invoice moves focus to its View link. If the action removed its own row, focus falls back to the view heading (`#page-title`) instead of `<body>` | Browser: accept/reject/mark-paid keep focus on the same logical action; invoice creation focuses the new View link; no action drops focus to the document |
| Off-canvas sidebar | At ≤860px the closed sidebar is `inert` and `visibility:hidden`; the menu button owns `aria-controls`/`aria-expanded`; opening focuses the first link; Escape, outside click and view selection close it and return focus to the menu button | Browser at 375px: Tab never enters the closed sidebar; open → first link focused; Escape → closed, focus on `#menu-btn`; view switch returns focus to the menu button |
| Onboarding and login | Consent error is a dedicated `#consent-error` linked from the checkbox; the status region switches between assertive errors and polite success; success focuses `#onboard-success`; submit sets `aria-busy`. Login error is `role="alert"`, linked to the password field, focuses the field and the Show toggle exposes `aria-pressed` | Browser: empty submit announces the field count and focuses the first invalid field; consent-only error is linked; success focus lands on the confirmation; wrong password is announced and focus stays in the form |
| Landing page | Nav Escape restores focus to the toggle and opening moves into the first link; FAQ answers start `inert`/`aria-hidden`, gain `aria-controls` and leave the accessibility tree when collapsed; section links expose `aria-current="location"`; enquiry errors are linked and announced assertively | Browser: nav keyboard open/close, FAQ expanded state and hidden answers, section highlighting and enquiry validation all behave without console errors |
| Invoice document | Heading order is `h1` → `h2`; the table has a caption and scoped headers; the document title includes the invoice number; load status is a live region; `aria-busy` clears after render; Print is disabled until the stored invoice has loaded | Browser: `INV-2026-00x` appears in `document.title`, two `h2` sections follow the `h1`, table semantics are complete, and Print enables only after load |
| Form metadata | Required asterisks are `aria-hidden` while native `required` remains; city/website use `address-level2`/`url` autocomplete; the onboarding aside is labelled; the progress strip is a labelled list with `aria-current="step"`; onboarding copy no longer adds "*" to accessible names | Automated: labels resolve to one control each, no accessible name contains a bare asterisk, and autocomplete values are present |

Automated coverage after Batch 4: `npm test` → **86 tests, 86 pass**. Browser interaction/accessibility suite → **68/68 checks pass**. Responsive sweep → **30/30 page/width combinations**, zero document overflow and no unexpected console errors or failed assets. Evidence screenshots: `private/backups/20261119-batch4/screenshots/` (dashboard modal 1440, dashboard sidebar 375, onboarding error 375, invoice 320). All interaction tests ran against a temporary copy of the database; `private/data/nexora.db` was not modified.

Closed by Batch 4: A11Y-01, 02, 03, 05, 06, 07, 12, 13, 14, 15, 16, 17, 18, 21, 22, 24, 25, 28, 29, 30, 32, 33. Closed earlier by Batch 3: A11Y-04, 08, 09, 23, 27. The remaining A11Y items are listed below.

Remaining after Batch 4:

- **A11Y-19 (Medium):** the landing-page hero workspace mock is still partly exposed as text/controls rather than a single labelled image; the inner sidebar is hidden, but the surrounding mock data is announced.
- **A11Y-20 (Medium):** gradient text still needs a `forced-colors` fallback to `CanvasText`.
- **A11Y-26 (Medium):** enquiry required fields have native `required` but no visible marker or "all fields required" note.
- **A11Y-31 (Low):** some icon and compact controls remain below the documented 44×44px target.
- **A11Y-34 (Low):** disabled button/label contrast is 4.04:1; exempt, but frequent.
- **A11Y-35 (Low):** the 40-second marquee has no pause control.
- **A11Y-36 (Low):** nowrap/ellipsis clusters may clip under increased text spacing.
- **A11Y-37 (Low):** `overflow-x: clip` on the landing page still masks overflow instead of containing it locally.
- **A11Y-38 (Low):** reveal animations hide content when JavaScript fails.
- **A11Y-10 / A11Y-11:** legacy `index.html` / `styles.css` only; not served.
- `hello@nexora.in` remains a placeholder and no client portal or separate About/Services/Contact routes exist.

Still open after Batch 4: CSRF origin checking, CSP tightening, compression and caching, pagination/query efficiency, order-reference generation, partial payments/refunds, invoice editing, and legacy-file cleanup (Batch 5).

### Batch 5 — applied and verified (20 November 2026)

Batch 5 is a hardening and cleanup pass. No page was redesigned, no route or business rule changed, and no real record was edited or migrated.

| Control | Change | Verification |
|---|---|---|
| CSP tightening | `style-src` reduced from `'self' 'unsafe-inline'` to `'self'`. The homepage hero chart no longer writes `style="--h:…"`; its heights are `.bars i:nth-child(n)` rules setting `--bar-height` in `premium.css`. The two generated invoice/payment modal styles were replaced by `.modal-section-head` and `.modal-note` classes in `app.css` | Served header has `style-src 'self'` and no `'unsafe-inline'`; a deliberate `style` attribute probe was blocked with a `style-src-attr` violation; all five pages report `document.querySelectorAll('[style]').length === 0`; no CSP console errors on normal navigation |
| Compression | `compression@1.8.2` mounted before the API and page routes with a 1 KB threshold. Brotli is preferred, gzip/deflate are automatic fallbacks, and `Vary: Accept-Encoding` is set | Raw HTTP: `/` returns `Content-Encoding: br`; `assets/css/app.css` returns `Content-Encoding: gzip` when Brotli is not offered; `.woff2` fonts are passed through uncompressed. File-level measurements: `premium.html` 18,831 B → 4,134 B Brotli; `premium.css` 27,574 B → 4,227 B; `app.js` 38,012 B → 8,342 B (−78%) |
| Cache policy | Public HTML `Cache-Control: no-cache` (store, always revalidate). Authenticated HTML and the unauthenticated redirect `no-store`. `assets/*.woff2` `public, max-age=31536000, immutable`. CSS/JS `public, max-age=3600, must-revalidate` because asset names are not fingerprinted. API responses stay `no-store` | Header checks on a temporary server: `/` `no-cache`, `/dashboard` and `/invoice/2` `no-store`, unauthenticated `/dashboard` redirect `no-store`, font `immutable`, CSS `max-age=3600, must-revalidate`, `/api/*` `no-store` |
| CSRF defence in depth | Non-GET `/api/*` requests with a present `Origin` must match the request `Host`; `Sec-Fetch-Site` of `cross-site`/`same-site` is rejected with `403`. Requests that send neither header (non-browser clients) are unaffected. `SameSite=Lax` on the session cookie is unchanged | Cross-origin `Origin` and `Sec-Fetch-Site: cross-site` logout calls return `403 {"error":"Cross-site request rejected."}` and do not consume the session; a same-origin logout returns `200` |
| Font loading | Preload hints for `space-grotesk-latin.woff2` and `dm-sans-latin.woff2` added to all five served pages, matching the two faces used above the fold | Network panel shows both fonts requested immediately, with no duplicate downloads and no missing files |
| Legacy removal | `index.html`, `assets/css/styles.css` and `assets/js/main.js` deleted after copying them to `private/backups/20261120-batch5/legacy/`. No route, page or script references them | `/index.html`, `/assets/css/styles.css` and `/assets/js/main.js` return `404`; repository search finds no live reference outside audit history and backups |
| Dependency hygiene | `express` refreshed to `4.22.3` (patched `body-parser`, `path-to-regexp` and `qs`); `compression` added | `npm ls --depth=0` shows only `express@4.22.3` and `compression@1.8.2`; `npm audit --omit=dev` reports **0 vulnerabilities** |
| Regression coverage | New `test/performance-security.test.js` covers CSP, absence of inline styles, Brotli/gzip negotiation, font pass-through, cache headers for public/private/static/API responses, CSRF rejection, legacy 404s and encoded traversal | `npm test` → **96 tests, 96 pass** (86 before Batch 5, 10 new) |
| Browser verification | Temporary copy of the database on `127.0.0.1:3210`; login error/success, dashboard views and filters, invoice create → send → mark paid, invoice detail, onboarding validation/success, enquiry validation/success, modal Escape/focus restore, mobile sidebar open/Escape | Zero unexpected console errors, zero failed requests, zero inline style attributes on every page. Screenshots for 5 pages × 3 viewports (375/768/1440) in `private/backups/20261120-batch5/screenshots/`; document overflow was 0 at every combination |
| Security headers | Existing CSP, `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy` and `Cross-Origin-Opener-Policy` retained; HSTS still only with `COOKIE_SECURE=true`; `X-Powered-By` still removed | `header-check.js` confirmed cookie `HttpOnly` + `SameSite=Lax`, no `Secure` over plain HTTP, and `404` for `/private/data/nexora.db`, encoded traversal, `/server%2Fauth.js`, `/package.json`, `/.env` and the removed legacy files |
| Lighthouse | Home: accessibility 0.94, best practices 1.00, SEO 1.00. Dashboard: accessibility 1.00, best practices 1.00, SEO 0.75 (no meta description on an authenticated, non-indexable page) | Report remaining home-page findings are the pre-existing Batch 4 items: low-contrast decorative text, heading order and a label/name mismatch on the mock workspace. No new Batch 5 regression |

Batch 5 closed: CR-26 (legacy files), the Batch 4 CSRF/CSP/compression/caching items, and the open CSP note in `DESIGN.md`.

Remaining after Batch 5:

- **Medium:** rate limiting is in memory, so multiple processes or instances do not share a window; move it to a shared store before scaling out.
- **Medium:** CSS/JS are served with a one-hour revalidating cache because filenames are not content-hashed. Content-hashing them and switching to `immutable` would be the next performance step; splitting `app.js` per page is optional at ~8 KB Brotli.
- **Medium:** order references still derive their sequence from `COUNT(*)` in a transaction; concurrent inserts are serialized by SQLite but the scheme would need a counter table on another database.
- **Low:** no CSP nonce infrastructure. The single 1 KB inline boot script keeps its SHA-256 hash; any future inline script needs the hash recomputed.
- **Low:** the dashboard has no meta description. This is intentional for an authenticated page and does not affect the public pages.
- **Low:** enquiry required fields still have native `required` without a visible marker (A11Y-26), and the other Batch 4 A11Y items remain open.
- **Low:** the placeholder inbox was replaced with `nexora7021@gmail.com` on 21 November 2026 in
  `premium.html`, `onboarding.html` and `assets/js/app.js`; there is still no client portal, email
  delivery or separate About/Services/Contact route.
- Partial payments, refunds and invoice editing remain out of scope for this version.
