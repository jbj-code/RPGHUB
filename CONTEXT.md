# RPG H.U.B — Project Context

> **Read this first** in every session. Universal coding rules live in `GUIDELINES.md`; domain notes for sourcing live in `SOURCING.md`; agent design in `AGENT_TOOLS.md`.

## What this is

**RPG H.U.B** (Resolute Project Group Hub) is an internal web app for Resolute Project Group. It bundles financial and operations tools in one password-protected SPA: options research, stock comparison, assignment monitoring, Schwab market-data access, AI assistant, document extraction, todos, and more.

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
  _schwab-utils.ts      Token refresh, rate limits, shared Schwab helpers
  _universe-sp500.ts    Static S&P 500 + ETF symbol list for screener
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
| Sourcing | `sourcing` | `Sourcing.tsx` | Deal sourcing workflow (see `SOURCING.md`) |
| Assignment Check | `assignment-check` | `AssignmentCheck.tsx` | Schwab + Addepar assignment monitoring |
| Extractor | `extractor` | `Extractor.tsx` | PDF/OCR fund schedule extraction |
| To-Dos | `todos` | `Todos.tsx` | Client-scoped task board (localStorage) |
| Rankinator | `rankinator` | `Rankinator.tsx` | Stub; external Looker link in nav |
| Raise.ai | `raise-ai` | `RaiseAi.tsx` | External Looker embed |
| Schwab Explorer | `schwab` | `Schwab.tsx` | Raw Schwab API explorer / debugger |
| Website | `website` | `Website.tsx` | Marketing site preview (hero page) |

**Layout patterns:** Optimizer, Screener, Schwab, Stock Comparison, Todos use **fixed rails** (`getFixedRailsLayoutStyles`) — left control panel, center table, optional right rail. Width accounts for `SIDEBAR_WIDTH` from `NavBar`.

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

**Other routes:** `api/agent.ts`, `api/site-password.ts`, `api/app-settings.ts`, `api/schwab-auth-callback.ts`, `api/addepar-assignment-check.ts`.

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

**Server** (Vercel env only): `SUPABASE_SERVICE_ROLE_KEY`, `SCHWAB_CLIENT_*`, `ANTHROPIC_API_KEY`, `OPENFIGI_API_KEY`, Addepar keys, etc. See `.env.example`.

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
- **All Supabase access is server-side** — site password, app settings, Schwab tokens. No `supabaseClient` in the frontend.
- **Windows/PowerShell:** `$env:VAR`; chain with `;` not `&&` (see `GUIDELINES.md` §15).
- **Large pages** (`OptionsOptimizer`, `Schwab`, `OptionsScreener`) are 2k–100k lines — use section headers when editing.
- **Nav auto-collapse** after 10s; user toggle disables auto-collapse permanently for the session.
