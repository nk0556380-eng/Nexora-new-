---
version: 1.1
updated: 2026-11-22
name: Nexora
description: Warm cream SaaS identity for an outsourced sales partner. Cream canvas, white surfaces, coral accent, dark ink, editorial type and hairline structure across the site, client portal and admin dashboard.
colors:
  canvas: "#FBF3E8"
  canvas-alt: "#F5E9DA"
  surface: "#FFFFFF"
  surface-raised: "#FFFFFF"
  surface-sunken: "#F7EEE2"
  border: "#DCC9AE"
  border-strong: "#C9B393"
  text: "#0A1A1E"
  text-secondary: "#3A4A4C"
  text-muted: "#5B6B6D"
  accent: "#F4644C"
  accent-hover: "#C4442F"
  accent-text: "#C4442F"
  success: "#167A5A"
  warning: "#A86B00"
  danger: "#B3261E"
  info: "#2C6EAF"
  paper: "#FFFFFF"
  paper-alt: "#FBF3E8"
  invoice-ink: "#0A1A1E"
typography:
  display: "Space Grotesk"
  body: "DM Sans"
  label: "IBM Plex Mono"
rounded:
  xs: 4px
  sm: 6px
  md: 8px
  lg: 12px
  xl: 16px
  modal: 22px
  pill: 999px
spacing:
  base: 4px
  steps: [4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80, 96]
  section: "clamp(64px, 8vw, 104px)"
  gutter: "clamp(18px, 3.5vw, 36px)"
  container: 1160px
---

# Nexora Design Specification

**This document describes the system that ships.** The executable source of truth is
`assets/css/tokens.css`; if this file and the CSS ever disagree, the CSS wins and this file
must be corrected in the same change.

## 1. Direction

Nexora is a premium SaaS product for an outsourced sales partner. The visual idea is
**warm authority**: a cream canvas, white surfaces, dark ink type, one coral accent, thin borders
and controlled depth. It should read like a serious operating tool, not an agency landing
template.

The identity deliberately avoids:

- neon or multi-colour gradients, coloured glows and glassmorphism;
- decorative stock photography, oversized illustration and ornamental clutter;
- a second accent competing with coral;
- invented testimonials, clients, statistics or performance claims;
- light-grey text on cream surfaces or low-contrast coral-on-coral labels.

The invoice sheet shares the cream/coral family but stays a calm document, not an app theme.

### 1.1 Brand mark

The final mark is the approved warm-studio asset at `assets/brand/nexora-mark.svg`: a dark-ink
rounded tile with a cream cut-out N and a coral `#F4644C` dot. It is used for the favicon,
header/footer brand, dashboard and portal shells, the homepage workspace mock and the invoice
brand row. The wordmark is a system serif (`--font-brand`) with a coral period, followed by the
small mono `SALES DEVELOPMENT STUDIO` lockup line. Do not substitute the earlier violet, crest or
seal variants.

## 2. Source of truth and load order

| File | Responsibility |
|---|---|
| `assets/brand/nexora-mark.svg` | Final warm-studio brand mark; favicon and all in-app brand rows. |
| `assets/css/fonts.css` | Self-hosted `@font-face` declarations only. |
| `assets/css/tokens.css` | Three token layers: primitives, semantic roles, component values. |
| `assets/css/ui.css` | Reset, base elements, buttons, fields, status pills, brand, shared utilities. |
| `assets/css/premium.css` | Public site layout and page-specific components. |
| `assets/css/app.css` | Onboarding, login, dashboard and invoice layout. |

Every served page loads the layers in this order:

```html
<link rel="stylesheet" href="/assets/css/fonts.css">
<link rel="stylesheet" href="/assets/css/tokens.css">
<link rel="stylesheet" href="/assets/css/ui.css">
<link rel="stylesheet" href="/assets/css/app.css"><!-- or premium.css -->
```

Rules:

- No page stylesheet may declare another `:root`.
- New colours, shadows, radii, type sizes and timing values go into `tokens.css` first.
- `index.html`, `styles.css` and `main.js` are unreachable legacy files and are not part of this
  system; their removal belongs to Batch 5.
- Do not reintroduce the superseded dark-SaaS, light-teal or Swiss variants. There is one
  system across the public site, client portal and admin dashboard.

## 3. Colour

### 3.1 Primitive palette

| Ramp | Values |
|---|---|
| Cream | `#FBF3E8`, `#F5E9DA`, `#EADBC6`, `#DCC9AE` |
| Ink | `#0A1A1E`, `#1A2B2E`, `#3A4A4C`, `#5B6B6D`, `#607071` |
| Coral | `#C4442F`, `#F4644C` |
| Success | `#167A5A` / `#12674D` |
| Warning | `#A86B00` / `#8A5700` |
| Danger | `#B3261E` / `#9C2019` |
| Info | `#2C6EAF` / `#235A91` |
| Paper | `#FFFFFF`, `#FBF3E8`, `#DCC9AE`, `#C9B393` |
| Invoice ink | `#0A1A1E`, `#3A4A4C`, `#5B6B6D` |

### 3.2 Semantic roles

| Token | Value | Use |
|---|---|---|
| `--color-canvas` | `#FBF3E8` | Page floor. |
| `--color-canvas-alt` | `#F5E9DA` | Sidebar, alternate bands, public header/footer. |
| `--color-surface` | `#FFFFFF` | Cards, tables, modals. |
| `--color-surface-raised` | `#FFFFFF` | Nested panels, feature cards, raised rows. |
| `--color-surface-sunken` | `#F7EEE2` | Inputs, inset blocks, code-like detail cells. |
| `--color-surface-hover` | `#F2E4D3` | Hover fill for ghost rows and controls. |
| `--color-border` | `#DCC9AE` | Default 1px structure. |
| `--color-border-strong` | `#C9B393` | Hover, mock-window frame, emphasized edges. |
| `--color-border-subtle` | `rgba(10,26,30,.08)` | Internal dividers and quiet section rules. |
| `--color-text` | `#0A1A1E` | Headings, values, primary labels. |
| `--color-text-secondary` | `#3A4A4C` | Body copy, table cells. |
| `--color-text-muted` | `#5B6B6D` | Captions, metadata, placeholders, secondary UI. |
| `--color-text-faint` | `#607071` | Decorative icons and fine detail. |
| `--color-accent` | `#F4644C` | Primary button, active markers, accent marks. |
| `--color-accent-hover` | `#C4442F` | Primary hover. |
| `--color-accent-text` | `#C4442F` | Accent text and links on cream surfaces. |
| `--color-accent-soft` | `rgba(244,100,76,.14)` | Active nav fill, icon plates, focus halo. |
| `--color-accent-border` | `rgba(196,68,47,.32)` | Accent-bordered controls and active states. |
| `--color-focus` | `#C4442F` | Keyboard focus outline. |
| `--color-on-accent` | `#0A1A1E` | Text on accent fill. |
| `--color-overlay` | `rgba(10,26,30,.62)` | Modal scrim. |

One accent only. Success, warning, danger and info exist **for state**, never for decoration
or a second brand voice.

### 3.3 Status roles

| State | Soft fill | Border | Text | Used by |
|---|---|---|---|---|
| New / pending | `rgba(168,107,0,.12)` | `rgba(168,107,0,.28)` | `#8A5700` | Orders awaiting decision, pending onboarding |
| Accepted / approved / paid | `rgba(22,122,90,.12)` | `rgba(22,122,90,.28)` | `#12674D` | Successful, settled states |
| Sent | `rgba(44,110,175,.1)` | `rgba(44,110,175,.26)` | `#235A91` | Invoice issued to the client |
| Rejected / cancelled | `rgba(179,38,30,.1)` | `rgba(179,38,30,.28)` | `#9C2019` | Declined or voided |
| Draft | `rgba(10,26,30,.06)` | `--color-border` | `--color-text-secondary` | Not yet issued |

Every pill carries a word. Colour is never the only signal.

### 3.4 Invoice document roles

The invoice keeps separate semantic tokens so the document stays calm and print-ready within the
same cream/coral system:

| Token | Value | Use |
|---|---|---|
| `--invoice-paper` | `#FFFFFF` | Sheet background. |
| `--invoice-paper-alt` | `#FBF3E8` | Table head band. |
| `--invoice-border` | `#DCC9AE` | Row and note rules. |
| `--invoice-border-strong` | `#C9B393` | Sheet edge. |
| `--invoice-ink` | `#0A1A1E` | Headlines, totals, primary document text. |
| `--invoice-muted-strong` | `#3A4A4C` | Table cells, addresses, notes. |
| `--invoice-muted` | `#5B6B6D` | Metadata and fine print. |

## 4. Typography

Three self-hosted families in `assets/fonts/`; no runtime third-party requests.

| Role | Family | Size / weight | Tracking | Use |
|---|---|---|---|---|
| Display | Space Grotesk | `clamp(2.5rem, 5.2vw, 4.5rem)` / 700 | `-.05em` | Default `h1` |
| Hero display | Space Grotesk | `clamp(2.3rem, 9.2cqw, 3.5rem)` / 700 | `-.05em` | Homepage `h1`, sized to its column |
| Section heading | Space Grotesk | `clamp(1.95rem, 3.6vw, 3rem)` / 700 | `-.035em` | `h2` |
| Card heading | Space Grotesk | `1.125rem` / 700 | `-.02em` | `h3`, modal titles, panel heads |
| Body | DM Sans | `1rem` / 400 | 0 | Paragraphs, fields, table cells |
| UI | Space Grotesk | `.8125–.9375rem` / 500–600 | `-.01em` | Buttons, nav, table controls |
| Label | IBM Plex Mono | `.6875rem` / 500 | `.1em` | Kickers, table headers, refs, metadata |

Leading: `1.03` display, `1.12` headings, `1.35` snug, `1.6` body. Long copy caps at 62ch.
The homepage headline uses container units so it stays two lines in the desktop split hero
instead of growing into a third line on wider screens.

Headings are white. Body copy is `--color-text-secondary`; muted metadata is
`--color-text-muted`. Do not use accent colour for whole paragraphs.

## 5. Layout and spacing

- Container: `min(100% - 2 × gutter, 1160px)`; gutter `clamp(18px, 3.5vw, 36px)`.
- Section rhythm: `clamp(64px, 8vw, 104px)` vertical padding, with a subtle top border on
  landing sections.
- Spacing scale: 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80, 96. Macro rhythm uses tokens;
  component micro-spacing may refine by 1–2px where optical alignment requires it.
- Dashboard: `248px` sticky sidebar, `72px` topbar, `clamp(18px, 3vw, 32px)` view padding.
- Public header: `68px`; modal width: `640px`; invoice sheet: max `860px`.
- Landing grids: hero `1.04fr / .96fr`; bento 3-up with a 2×2 feature card; workflow 4-up;
  FAQ and CTA 2-up. Dashboard KPIs 4-up, overview `1.5fr / 1fr`.

## 6. Shape, elevation and motion

**Radii.** `4px` chips and focus corners, `6px` small controls, `8px` buttons and fields,
`12px` invoice sheet and mid panels, `16px` cards, `22px` modal, `999px` pills. Do not invent
intermediate radii.

**Elevation.** Borders carry structure at rest. Shadows are reserved for floating surfaces:

- `--shadow-md`: `0 16px 40px rgba(0,0,0,.32)` — panels and toast.
- `--shadow-lg`: `0 32px 80px rgba(0,0,0,.46)` — auth card, modal, invoice sheet.
- `--shadow-window`: `0 24px 60px rgba(0,0,0,.42), inset 0 1px 0 rgba(255,255,255,.04)` —
  homepage workspace mock.
- `--shadow-accent`: `0 8px 20px rgba(76,63,196,.22)` — primary button only.

**Motion.** `180ms` with `cubic-bezier(.2,.7,.2,1)` for colour, border, shadow and transform.
Buttons rise `1px`, cards rise `2px`; trailing arrows translate `2px` diagonally. There are no
bouncing, looping or scroll-hijacking effects. `prefers-reduced-motion: reduce` collapses all
animation and transition durations and disables smooth scrolling. Content is never hidden
pending a scroll observer.

## 7. Components

### 7.1 Buttons

| Variant | Fill | Border | Text | Use |
|---|---|---|---|---|
| `.btn-primary` | `--color-accent` | transparent | `--color-on-accent` | One primary action per view |
| `.btn-secondary` | `rgba(10,26,30,.04)` | `--color-border` | `--color-text` | Alternate action |
| `.btn-ghost` | transparent | transparent | secondary text | Low-emphasis icon/text action |
| `.btn-danger` | danger soft | danger border | danger text | Reject/cancel in context |

Geometry: `44px` default, `36px` small, `48px` large, `18px` horizontal padding, `8px` radius,
Space Grotesk 600. Hover darkens the accent to `#C4442F`; disabled is `opacity:.5` with
`pointer-events:none`. Focus uses the shared 2px outline. No gradients on buttons.

### 7.2 Fields

Inputs, textareas and selects share a `44px` control height, `8px` radius,
`--color-surface-sunken` fill, 1px border, DM Sans body size. Labels sit above the control in
600-weight secondary text; required marks use accent text. Placeholder text is
`--color-text-muted`, never a darker grey.

Focus order: border becomes accent, a 3px accent-soft halo appears, and keyboard focus keeps a
2px `--color-focus` outline with offset. Invalid fields use a danger border, a danger halo and
an inline `.field-error` message; do not rely on colour alone.

### 7.3 Cards, tables and pills

Cards use `--color-surface`, 1px border, `16px` radius, `24px` padding (`30px` for the bento
feature card). Hover changes the border and lifts `2px`; stat cards do not float.

Tables sit inside `.table-scroll` with horizontal containment, a `560px` minimum table width,
monospaced uppercase headers, 1px row rules and a subtle hover fill. Empty tables render a
single `.empty-row` message. Status pills use semantic soft/border/text triplets and a 5px dot;
the word is always present.

### 7.4 Navigation and shells

Public navigation is a `68px` sticky header with a translucent cream blur. Links use
secondary text and a 1.5px animated underline; the primary CTA is the only filled item. Below
`860px` the nav becomes a bordered dropdown panel with a 40px toggle and closes on link click,
outside click or Escape.

The dashboard shell is a `248px` sidebar plus a sticky `72px` topbar. The active sidebar item
uses accent-soft fill with an accent border; counts use small raised chips. Below `860px` the
sidebar becomes a fixed off-canvas panel with a visible menu button.

### 7.5 Modals, transitions and feedback

Modals use a 62% dark-ink scrim, `22px` radius, 1px border, `--shadow-lg`, a titled header
and a 34px close control. Maximum height is `88vh` with internal scrolling. **Batch 4 owns the
focus trap and focus restoration**; Batch 3 keeps the dialog labelled and closable with Escape.

Feedback states:

- **Empty:** centred muted text inside the table or panel.
- **Loading:** muted "Loading invoice…" inside the invoice sheet.
- **Error:** inline danger text for fields; toast for request failures.
- **Success:** green-tinted card for onboarding completion; success toast for admin actions.

A toast is fixed bottom-right, semantic-tinted, bordered and labelled with `role="status"`.

## 8. Page application

### 8.1 Homepage (`/`)

Order: announcement, sticky header, split hero, capability rail, product bento, workflow,
workspace panel, FAQ, enquiry CTA, footer. The hero pairs a container-sized headline with a
sample workspace mock; the mock is explicitly labelled "Sample workspace shown." Sample
figures inside the dashboard panel are labelled too. No claim is made about clients, revenue,
close rates or guaranteed meetings.

### 8.2 Onboarding (`/onboarding`)

Public header, intro with three-step progress, two form blocks (agency, outbound setup) and a
consent block, with a sticky aside for "what happens next" and rules. Submitting invalid data
adds `.field-error` messages and keeps the user on the page; success replaces the form with a
green success card and a reference.

### 8.3 Login (`/login`)

Centered `420px` card on the cream canvas: brand, "Welcome back.", one labelled password
field with a Show control, an inline error region, a full-width primary button and a back link.
The error message keeps its layout space so the card does not jump.

### 8.4 Dashboard (`/dashboard`)

Sidebar navigation, topbar title/subtitle and one primary "New invoice" action. Four KPI cards
(new requests, accepted, pending onboarding, total billed), recent requests and quick actions,
then orders, onboarding and invoices views with filters, tables and contextual actions.
Invoice creation and payment use modals with the shared field, button and feedback components.

### 8.5 Invoice (`/invoice/:id`)

A cream toolbar (back, status pill, print/save PDF) above a white A4-proportioned document:
brand and invoice number, billed-to and details, line-item table, subtotal/discount/tax/total,
optional notes, footer. All values are rendered from stored invoice data; the page never
recomputes money. The sheet uses the invoice token set and stays readable at 320px with no
horizontal overflow. Print removes the toolbar, page padding, border, radius and shadow.

### 8.6 Client portal (`/client/login`, `/client`, `/client/invoice/:id`)

Clients sign in with their purchase phone number and an admin-issued access code. The portal
uses the same cream/coral system as the public site and dashboard: coral active markers,
progress steps and primary buttons; dark ink on coral fills. Status pills keep their semantic
state colours. Data is scoped to the signed-in client only.

## 9. Responsive behaviour

| Width | Changes |
|---|---|
| `> 1024px` | Split hero, 3-up bento with 2×2 feature card, 4-up workflow, 4-up KPIs, 248px sidebar. |
| `≤ 1024px` | Hero stacks, visual caps at 640px; bento and workflow 2-up; overview and onboarding 1-column; KPIs 2-up. |
| `≤ 860px` | Public nav becomes a dropdown; dashboard sidebar becomes off-canvas; topbar 64px. |
| `≤ 640px` | Dashboard topbar wraps title onto its own row; card headers wrap; view padding 16px. |
| `≤ 560px` | Form grids, detail grids and invoice meta become 1-column; invoice toolbar stacks; sheet padding drops; footer 1-column; landing grids 1-column. |
| `≤ 420px` | KPIs become 1-column; modal padding tightens; invoice table type tightens while keeping all values. |

Verified at **320, 375, 768, 1024, 1440 and 1920px** across all served pages with zero
document-level horizontal overflow. Dashboard tables scroll inside their card rather than
widening the page. The homepage decorative ambients are capped at `100vw`.

## 10. Accessibility contract

Measured contrast for the shipped token pairs:

| Pair | Ratio |
|---|---|
| Primary text `#0A1A1E` on canvas `#FBF3E8` | 16.18:1 |
| Secondary text `#3A4A4C` on surface `#FFFFFF` | 9.28:1 |
| Muted text `#5B6B6D` on sunken `#F7EEE2` | 4.85:1 |
| Accent text `#C4442F` on canvas `#FBF3E8` | 4.53:1 |
| Dark ink `#0A1A1E` on accent `#F4644C` | 5.74:1 |
| Success text on success soft | 5.80:1 |
| Warning text on warning soft | 5.25:1 |
| Danger text on danger soft | 6.75:1 |
| Invoice ink `#0A1A1E` on paper `#FFFFFF` | 17.81:1 |
| Invoice muted `#5B6B6D` on paper | 5.57:1 |

Also required:

- A skip link precedes the homepage header.
- Every interactive element keeps a visible `:focus-visible` outline; inputs add a halo.
- Status is word + dot + colour, never colour alone.
- Buttons are `44px` tall (`36px` compact), fields `44px`, nav toggle `40px`; below the WCAG
  2.2 minimum target size of 24px is never acceptable.
- `prefers-reduced-motion` removes animation and smooth scrolling.
- Toasts and form status regions are live regions; form errors are inline text.

**Still owned by Batch 4:** modal focus trap and focus restoration, `aria-describedby` wiring
for dynamically generated line-item errors, landmark/caption/table-header refinement, `inert`
on the off-canvas sidebar, and the remaining audit findings. Batch 3 does not claim full
WCAG 2.2 AA conformance.

## 11. Content rules

- Describe activity **and its limits**. Never promise revenue, meetings, rankings or results.
- Never invent clients, testimonials, logos, statistics or case studies.
- Label sample workspaces, sample invoices and demo rows. Demo records keep the `DEMO` tag.
- Pricing is scoped after a conversation; do not publish plan figures.
- Use sentence case for headings and UI labels; uppercase only for monospaced metadata.
- Keep the public voice calm and declarative. Avoid hype, urgency theatre and exclamation marks.

## 12. Do and do not

**Do**

- Add new design values to `tokens.css` and consume them through semantic roles.
- Keep the invoice on warm paper and the application on cream.
- Use one primary action per view and reserve accent fill for it.
- Prefer borders and spacing over shadows.
- Keep every served page on the same component layer (`ui.css`).

**Do not**

- Add a second `:root`, a second accent or gradient body copy.
- Use glow, blur or neon beyond the two capped hero ambients and the header backdrop.
- Use light grey text below 4.5:1 on cream surfaces.
- Reuse status colours for decoration.
- Reintroduce the abandoned light-teal, Swiss or dark-SaaS variants.
- Claim a page exists because a section anchor exists: there is no separate About, Services or
  Contact route.

## 13. Known gaps

- The CSP is now `style-src 'self'` with no `'unsafe-inline'`. The hero chart bar heights are a
  stylesheet rule (`.bars i:nth-child(n)` setting `--bar-height`) and generated markup uses the
  `.modal-section-head` / `.modal-note` classes, so no page or script writes inline styles.
- The legacy `index.html`, `styles.css` and `main.js` were removed in Batch 5. The served pages are
  the only markup in the project.
- The contact inbox is `nexora7021@gmail.com` in the homepage footer, onboarding aside and invoice
  footer; update all three when the address changes.
- The invoice is a screen/print document; no email delivery exists.
