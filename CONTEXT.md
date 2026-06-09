# RPG H.U.B — Project Context

> **Read this first** in every session. Universal coding rules live in `GUIDELINES.md`; agent design in `AGENT_TOOLS.md`.

## What this is

**RPG H.U.B** (Resolute Partners Group Hub) is an internal web app for Resolute Partners Group. It bundles financial and operations tools in one password-protected SPA: options research, stock comparison, assignment monitoring, Schwab market-data access, AI assistant, document extraction, todos, and more.

**Users:** firm staff (not public). **Hosting:** Vercel (`therpghub.vercel.app`).

---

## Tech stack

| Layer | Choice |
|-------|--------|
| Frontend | React 18, TypeScript, Vite |
| Styling | `src/theme.ts` (light/dark tokens + helpers), `src/index.css` (global classes) |
| Charts | Recharts |
| Database | Supabase (service role on API routes only — no browser Supabase client) |
| Hosting | Vercel — static `dist/` + `api/` serverless functions |
| Market data | Charles Schwab API (OAuth, server-side token refresh) |
| Other APIs | Anthropic (Agent), OpenFIGI, Google Sheets, Addepar (assignment check) |
| PDF/OCR | pdfjs-dist, tesseract.js (Extractor) |

---

## Repository map

```
api/                    Vercel serverless entrypoints
  schwab.ts             Router: dispatches by `action` to _handlers/*
  _handlers/            Schwab + tool logic (optimize, screener, quotes, …)
  _handlers/sheetQuote.ts   Google Sheets SCHWAB_OPT() backend
  _handlers/sheetStock.ts   Google Sheets SCHWAB_STOCK() backend
  _schwab-utils.ts      Token refresh, rate limits, shared Schwab helpers
  _universe-sp500.ts    Static S&P 500 + ETF symbol list for screener
  _edgar-utils.ts       SEC EDGAR Form 4 search, XML parse, filing URLs
  sourcing.ts           POST form4_scan (maxDuration 120 via export config)
  agent.ts              Anthropic streaming agent
  site-password.ts      Site gate password check
  app-settings.ts       Supabase key/value settings (e.g. home todos URL)
src/
  App.tsx               Root: password gate, theme, nav, page routing
  components/           NavBar, PasswordGate
  pages/                One file per tool (OptionsOptimizer, OptionsScreener, …)
  theme.ts              Colors, spacing, z-index scale, shared UI helpers
  constants.ts          SCHWAB_API_BASE (single source)
  lib/                  Shared domain helpers (opportunityBuckets, fundScheduleExtract, …)
```

---

## How the app works (runtime)

1. **Boot** — `main.tsx` mounts `App`. If `sessionStorage` lacks unlock, `PasswordGate` shows; password validated via `POST /api/site-password`.
2. **Shell** — Fixed left `NavBar` (collapses to icons after 10s). `App.tsx` holds `page` state (no React Router). Main content scrolls to the right of the sidebar.
3. **Theming** — `lightTheme` / `darkTheme` from `theme.ts` passed as `theme` prop to every page.
4. **API calls** — Browser fetches `${SCHWAB_API_BASE}/api/...`. Default base is production Vercel even during local `npm run dev` unless `VITE_SCHWAB_API_BASE` is set.
5. **Schwab auth** — OAuth via `/api/schwab?action=auth`; tokens stored in Supabase; refreshed server-side. Most tools require a connected Schwab session.

---

## Pages (what each tool does)

| Nav label | `Page` id | File | Purpose |
|-----------|-----------|------|---------|
| Home | `home` | `Home.tsx` | Quick links (Drive, Schwab, Addepar, etc.), market snapshot, editable To-Dos URL |
| Agent | `agent` | `Agent.tsx` | Streaming chat with Anthropic; Schwab-aware tools |
| Stock Comparison | `stock-comparison` | `StockComparison.tsx` | Compare returns/metrics across tickers |
| Options Optimizer | `put-optimizer` | `OptionsOptimizer.tsx` | Define portfolio rows → rank strikes by yield, momentum, PoP |
| Options Screener | `options-screener` | `OptionsScreener.tsx` | Scan universe for top OTM puts/calls by yield band |
| Options Pricing | `options-pricing` | `OptionsPricing.tsx` | Price individual option legs |
| Sourcing | `sourcing` | `Sourcing.tsx` | SEC Form 4 insider sale scans; prospects tracked in **Google Sheets** (not Supabase) |
| Assignment Check | `assignment-check` | `AssignmentCheck.tsx` | Schwab + Addepar assignment monitoring |
| Extractor | `extractor` | `Extractor.tsx` | PDF/OCR fund schedule extraction |
| To-Dos | `todos` | `Todos.tsx` | Client-scoped task board (localStorage) |
| Rankinator | `rankinator` | `Rankinator.tsx` | Stub; external Looker link in nav |
| Raise.ai | `raise-ai` | `RaiseAi.tsx` | External Looker embed |
| Schwab Explorer | `schwab` | `Schwab.tsx` | Raw Schwab API explorer / debugger |
| Website | `website` | `Website.tsx` | Marketing site preview (hero page) |

**Layout patterns:** Optimizer, Screener, **Sourcing**, Schwab, Stock Comparison, Todos use **fixed rails** (`getFixedRailsLayoutStyles`) — left control panel, center table, optional right rail. Width accounts for `SIDEBAR_WIDTH` from `NavBar`.

---

## API architecture

**Schwab router** (`api/schwab.ts`) — single POST/GET entry; `action` in query (GET) or body (POST):

| Action | Handler | Used by |
|--------|---------|---------|
| `auth` | `_handlers/auth.ts` | OAuth start |
| `status` | `_handlers/status.ts` | Connection check |
| `quotes` | `_handlers/quotes.ts` | Equity quotes |
| `returns` | `_handlers/returns.ts` | Historical returns |
| `figi` | `_handlers/figi.ts` | OCC / FIGI lookup |
| `prices` | `_handlers/prices.ts` | Options pricing |
| `optimize` | `_handlers/optimize.ts` | Options Optimizer |
| `screener` | `_handlers/screener.ts` | Options Screener |
| `explorer` | `_handlers/explorer.ts` | Schwab Explorer |
| `sheetQuote` | `_handlers/sheetQuote.ts` | Google Sheets `SCHWAB_OPT()` |
| `sheetStock` | `_handlers/sheetStock.ts` | Google Sheets `SCHWAB_STOCK()` |

**Other routes:** `api/agent.ts`, `api/sourcing.ts`, `api/site-password.ts`, `api/app-settings.ts`, `api/schwab-auth-callback.ts`, `api/addepar-assignment-check.ts`.

**Sourcing API** (`POST /api/sourcing`, body `{ action: "form4_scan", days, minValueUsd, maxFilingsToParse }`):
- Handler: `api/sourcing.ts` → `api/_edgar-utils.ts` (`scanForm4Sales`)
- **No API key** — SEC requires `SEC_EDGAR_USER_AGENT` on Vercel (`"Resolute Partners Group email@domain.com"`); code fallback if unset
- **Not filterable by $ at search time** — free EDGAR/EFTS returns filing metadata only; dollar amounts come from parsing each Form 4 XML
- `export const config = { maxDuration: 120 }` in `sourcing.ts` (do not add `api/sourcing.ts` to `vercel.json` `functions` — pattern mismatch breaks deploy)

---

## Sourcing (Form 4 — live)

**Purpose:** HNW prospecting from large insider **open-market sales** (liquidity events). Prospects live in a **shared Google Sheet** (CSV export) — not Supabase.

**UI:** `src/pages/Sourcing.tsx` — fixed rails like Optimizer/Screener. Left: lookback, min $M, scan depth. Center: results table + SEC citations footer. Right: match stats + Export CSV.

**Defaults (2026-06):** **1-day lookback** (daily workflow), **$1M+** per sale line, **no senior-title filter** (any insider role), scan depth **Standard = 100 filings**.

**Scan depth:** Quick 50 / Standard 100 / Deep 200 — parses the most recent N Form 4s in the lookback window (national volume is huge; not every filing in range).

**Parsing:** One table row per **qualifying sale line** (not per filing). Value = shares × price from XML. Same filing can yield multiple rows.

**Filing links (per row):**
- **Form 4** → `wk-form4_*.html` (transaction table humans read)
- **SEC viewer** → legacy `cgi-bin/viewer` (owner/issuer identity; may show XBRL notice)

**Strategy (business context):** Multi-family office HNW prospecting ($15M+ liquid). **Form 4 large insider sales** are the live signal; future triggers include acquisitions, IPO lockups, funding rounds (likely **Exa AI** + **SEC EDGAR**). Prospects = **Google Sheet** (CSV export), not an in-app CRM. Outreach is **manual send** from a principal’s email after review — not automated LinkedIn/Facebook bots. Compliance: **public data only** (filings, press); no scraped PII databases.

**Planned:** Vercel Cron daily Form 4 scan + email digest (Resend); Apollo/Hunter for email enrichment; modest parallel SEC fetches. DIY in hub vs paid Clay/Smartlead stacks.

---

## Google Sheets (Schwab custom functions)

Team spreadsheets use **Apps Script** bound to the sheet (not in this repo). Functions call production:

`https://therpghub.vercel.app/api/schwab`

| Apps Script function | API action | Notes |
|---------------------|------------|-------|
| `SCHWAB_OCC(underlying, expiry, type, strike)` | *(none)* | Builds OCC symbol string locally — no HTTP |
| `SCHWAB_OPT(symbol, field)` | `sheetQuote` | Live option quote field (bid, iv, delta, …) |
| `SCHWAB_STOCK(symbol, field)` | `sheetStock` | Stock analytics: `rv30`, `iv30`, `beta`, `ivrv30`, … |
| Menu → Check Connection | `status` | Same token as RPG HUB |
| Menu → Reauthorize | `auth` | OAuth in browser |

**Response contract:** `{ value }` on success; `{ error }` on failure (Sheets shows `ERR: …`). Optional `SHEET_KEY` on Vercel + matching key in Apps Script.

**Auth:** Schwab OAuth token stored in Supabase — reauthorize via RPG HUB or the sheet menu when refresh token expires (~7 days).

**Performance:** Each `SCHWAB_OPT` / `SCHWAB_STOCK` formula cell = one HTTP round-trip (Sheets → Vercel → Schwab). Typical sheet: one contract per row, one field (e.g. `mid`) — 20 rows = 20 sequential-ish requests when **Refresh Data** re-runs formulas. Google throttles custom-function `UrlFetchApp` calls; they do not all fire truly in parallel. Schwab’s `/quotes` endpoint accepts **multiple symbols in one call**, but per-cell formulas cannot use that today. Real speed win (future): a **batch refresh** in Apps Script that collects unique OCC symbols from the sheet, one (or few) API calls, writes values back — instead of N separate `SCHWAB_OPT` calls.

---

## Options Optimizer (behavior)

- User defines **portfolio rows** (ticker, expiry, put/call, OTM band, trade type, contracts).
- Backend fetches Schwab chains + quotes; ranks up to **100 strikes per row** in the OTM band.
- If more than 100 strikes qualify, keeps those **closest to band center**; API returns a truncation warning.
- **Ranking prices:** bid for sell legs, ask for buy legs; table **Limit Px** stays bid/ask midpoint.
- Score blends annualized yield, 1M momentum (direction-adjusted), PoP / long-premium factors.
- **Trade list** in right rail; export/copy; FIGI fetch per trade.

---

## Options Screener (behavior)

- Scans **S&P 500 + ETFs** (`api/_universe-sp500.ts`, ~528 symbols). Update that file manually when constituents change.
- OTM buckets: 5–9%, 10–14%, 15–19%, 20–30%. Best contract per ticker surfaced once (best-scoring bucket).
- **Scan depth:** Quick (~280 vol history / 120 chains), Standard (~500 / 180), Deep (full / 250).
- **Liquidity mode:** Strict (drop wide spread + low OI), Relaxed / Show all (penalties + `liquidityFlags` badges).
- Write ranking favors IV > RV; buy ranking favors cheap premium vs realized vol.

---

## UI patterns

- **Theme:** Never hardcode colors in pages — use `t.colors.*`, `shadows`, `rankingColors`, `todoPalette`, `websiteHeroTokens` from `theme.ts`.
- **HelpTooltip:** Hover/focus explainer; dark secondary bubble via `getTooltipBubbleStyle`; rendered in `document.body` portal. Used heavily in Optimizer and Screener.
- **Z-index scale** (`theme.ts` → `zIndex`): rails (6) → dropdowns (4000) → modals (1000–1001) → **nav (10000)** → portaled dropdowns (10500+) → **help tooltips (11000)**. Do not put tooltips below 11000 or the nav covers them.
- **Interactive cards:** `INTERACTIVE_CARD_CLASS` in `index.css`.

---

## Environment & deployment

**Client** (`.env`, `VITE_` prefix, exposed to browser):
- `VITE_SCHWAB_API_BASE` — optional; defaults to `https://therpghub.vercel.app`

**Server** (Vercel env only): `SUPABASE_SERVICE_ROLE_KEY`, `SCHWAB_CLIENT_*`, `ANTHROPIC_API_KEY`, `OPENFIGI_API_KEY`, `SEC_EDGAR_USER_AGENT`, `SHEET_KEY` (optional — locks sheet endpoints), Addepar keys, etc. See `.env.example`.

**Deploy:** Push to `main` → Vercel builds frontend + API together. Local `npm run dev` only serves the UI; API changes require deploy (or `vercel dev`) to take effect.

**TypeScript:** `src/vite-env.d.ts` teaches the compiler about Vite (`import.meta.env`, `*.css`, `?url` imports). No runtime effect — IDE/`tsc` only.

---

## Security (ask before changing)

- Site password: server-validated against Supabase — not in client code.
- Schwab secrets + service role: **API routes only**, never `VITE_`.
- Sensitive files: `site-password.ts`, `schwab-auth-callback.ts`, `_handlers/auth.ts`, `_schwab-utils.ts`, Addepar handlers.

---

## Common commands

```powershell
npm install
npm run dev      # Vite dev server (frontend only)
npm run build    # Production build → dist/
npm run preview  # Preview production build locally
npx tsc --noEmit # Typecheck (requires vite-env.d.ts)
```

---

## Gotchas

- **Local dev hits production API** unless `VITE_SCHWAB_API_BASE` points elsewhere.
- **All Supabase access is server-side** — site password, app settings, Schwab tokens. No browser Supabase client.
- **SEC EDGAR / Sourcing:** `SEC_EDGAR_USER_AGENT` on Vercel; User-Agent required for automated requests. Sourcing scans hit production API from `npm run dev` by default. Cannot pre-filter Form 4 by dollar amount via free SEC search — parse-then-filter only.
- **vercel.json:** Only `api/**/*.ts` maxDuration 60 — per-route overrides for single files can fail deploy; use `export const config` in the route file instead (`sourcing.ts` uses 120s).
- **Windows/PowerShell:** `$env:VAR`; chain with `;` not `&&` (see `GUIDELINES.md` §15).
- **Large pages** (`OptionsOptimizer`, `Schwab`, `OptionsScreener`) are 2k–100k lines — use section headers when editing.
- **Nav auto-collapse** after 10s; user toggle disables auto-collapse permanently for the session.
