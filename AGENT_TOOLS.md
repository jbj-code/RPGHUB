# Agent — Tool Design, Vision & Brainstorm

A reference document for building the RPG HUB Agent: a natural language chat interface that sits on top of all existing hub tools and APIs, fetches real data, and returns rich insights. This replaces form-filling workflows with plain English queries.

---

## The Vision — The Hub's Chat Face

Instead of navigating to Options Optimizer and manually entering scan parameters, the agent makes the whole hub conversational:

> "Find the best put-selling opportunities for Unity stock this week."

> "Show me the highest annualized yield call-writing options for Unity expiring May 2026 that are at least 20% OTM."

> "Compare the 30-day returns on AAPL vs SPY and show me a chart."

The agent receives the message, decides which tools it needs, calls the underlying APIs (Schwab, screener, etc.), processes the results using the LLM, and returns something beautiful — a short insight paragraph plus a rendered chart or table. No forms, no copy-paste.

This is the hub's primary competitive moat. It becomes a proprietary, firm-specific financial intelligence layer.

---

## The Quality-vs-Quantity Problem

The more tools you expose to an LLM agent, the harder it is for the model to:
1. Pick the right tool for the job (tool selection error)
2. Chain tools correctly across a multi-step plan
3. Stay within context limits — every tool definition burns tokens

**Target:** 6–8 high-quality, non-overlapping tools. If two tools overlap, merge them. Every tool must earn its place by enabling a class of questions the agent genuinely can't answer without it.

---

## Tool Design Principles

- **One tool = one data domain.** A tool fetches options, or quotes, or history — not all three.
- **Tools return structured data, not prose.** The LLM synthesizes and explains; tools just fetch and filter.
- **Keep descriptions short.** The tool `description` field (what the LLM reads) should be one sentence. Parameters should use short, clear names. Verbose descriptions waste context on every call.
- **Every tool is a thin wrapper** over an existing `/api/_handlers/*.ts` endpoint — no business logic lives inside tool definitions.

---

## Proposed Tools (Prioritized)

### Tier 1 — Build these first (core capability)

#### `get_options_chain`
- **What it does:** Fetches the full options chain for a ticker on a given expiration date. Returns strikes, bids, asks, IV, delta, theta, OI, and volume.
- **Inputs:** `ticker`, `expiration_date` (YYYY-MM-DD), `option_type` (call/put/both)
- **Data source:** Schwab API (`/marketdata/v1/chains`)
- **Natural language examples it enables:**
  - "Best put-selling opportunities for AAPL expiring June 20"
  - "Highest annualized yield calls for Unity 20% OTM in May 2026"

#### `get_quote`
- **What it does:** Returns real-time quote for one or many tickers (price, % change, 52-week range, volume).
- **Inputs:** `tickers` (string or array, max ~20 at once)
- **Data source:** Schwab API (`/marketdata/v1/quotes`)
- **Natural language examples:** "What's Unity trading at right now?" / "Compare AAPL, MSFT, NVDA prices."

#### `screen_stocks`
- **What it does:** Returns a filtered list of tickers matching criteria (IV rank, price range, sector, market cap, etc.). Narrows the universe before deeper analysis.
- **Inputs:** `filters` object (iv_rank_min, price_min/max, sector, market_cap_min, etc.)
- **Data source:** Extends existing `/api/_handlers/screener.ts`
- **Natural language examples:** "High-IV large-cap tech stocks" / "Find stocks under $50 with IV rank above 60."

#### `get_price_history`
- **What it does:** Returns OHLCV data for a ticker over a date range at a given frequency.
- **Inputs:** `ticker`, `start_date`, `end_date`, `frequency` (daily/weekly/monthly)
- **Data source:** Schwab API — already partially wired in `/api/_handlers/prices.ts`
- **Natural language examples:** "Show me Unity's price over the last 3 months" / "Chart AAPL vs SPY this year."

---

### Tier 2 — High value, build after Tier 1

#### `rank_options` (the Rankinator tool)
- **What it does:** Fetches the options chain for a ticker + expiration, applies Rankinator scoring (IV rank, annualized premium yield, delta, DTE, liquidity), and returns a ranked list of the top N contracts.
- **Inputs:** `ticker`, `expiration_date`, `option_type` (call/put), `otm_min_pct` (optional, e.g. 0.10 for 10% OTM minimum), `top_n` (default 5)
- **Data source:** Combines `get_options_chain` + Rankinator scoring logic extracted to `src/lib/rankinatorScore.ts`
- **Note on DRY:** The scoring function must be extracted from `Rankinator.tsx` into a shared lib so both the page UI and this tool use the exact same logic.
- **Natural language examples:**
  - "Rank the top 5 put-sell candidates for Unity this week."
  - "Best call-writing opportunities for large caps expiring in 30 days."

#### `get_portfolio_positions`
- **What it does:** Returns current holdings (symbol, quantity, cost basis, current value, unrealized P&L). Used to contextualize recommendations against existing exposure.
- **Inputs:** `account_id` (optional)
- **Data source:** Schwab API (`/trader/v1/accounts/{accountHash}/positions`)
- **Natural language examples:** "What do we currently hold?" / "Are we already in Unity?"

---

### Tier 3 — Lower urgency, add later

#### `get_earnings_calendar`
- **What it does:** Upcoming earnings dates + consensus EPS estimates for a list of tickers.
- **Inputs:** `tickers`, `days_ahead` (default 30)
- **Data source:** Financial Modeling Prep API (free tier)
- **Why it matters:** Essential context before selling options — avoid going short vol into earnings.

---

## Tools to Deliberately NOT Build

| Tool idea | Why to skip |
|---|---|
| Trade execution ("place an order") | Hallucinations + auto-execution = catastrophic. Humans approve all trades. |
| "Summarize this PDF / document" | Use Rankinator LLM (NotebookLM) for document Q&A — that's what it's for. |
| General web search | Too broad, adds noise, burns context. Keep the agent scoped to structured financial data. |
| One big "analyze everything" tool | Destroys the agent's reasoning quality. Keep concerns separated. |

---

## Rich Output Design

The agent should never return raw JSON or a wall of numbers. For every response:

1. **One-paragraph insight** — the LLM synthesizes the data into plain English with a clear takeaway.
2. **A structured result** — a small table or ranked list (top 3–5 contracts, not 50).
3. **A chart when relevant** — rendered inline in the chat UI using Recharts (already available in the stack). Price history = line chart. Options comparison = bar chart sorted by annualized yield.

This is what makes it feel like a proprietary tool, not a chatbot.

---

## Architecture

```
User message (chat)
       ↓
/api/agent.ts  (Vercel AI SDK — streamText + tools)
       ↓
LLM picks tool(s)  →  calls /api/_handlers/*.ts  →  returns structured JSON
       ↓
LLM synthesizes result into prose + passes data for chart rendering
       ↓
Agent.tsx streams response + renders chart component inline
```

### Runtime recommendation: Vercel AI SDK + Claude Opus 4.7

- **Why Vercel AI SDK:** Zero infrastructure changes — fits directly into the existing serverless setup. `streamText` with `tools` maps cleanly to what's already built.
- **Why Claude Opus 4.7:** Leads the [Vals AI Finance Agent benchmark](https://www.vals.ai/benchmarks/finance_agent) at 64.37%. Strongest financial reasoning of any model right now.
- **Streaming:** Use `streamText` so responses appear word-by-word in the chat — feels fast even on multi-tool calls.

---

## Anthropic Financial Services Templates — What's Relevant for Us

Anthropic released 10 ready-to-run agent templates on May 5, 2026. They're available as plugins for Claude Cowork/Code or as cookbooks on GitHub at [`anthropics/financial-services`](https://github.com/anthropics/financial-services).

**Important constraint:** We cannot pass client PII, account numbers, NDA-protected materials, or identifying client information to any external AI service. This rules out several templates and shapes how we use the ones that remain viable.

### Templates we can actually use

| Template | What it does | How it helps us | Compliance risk |
|---|---|---|---|
| **Market researcher** | Tracks sector/issuer developments, synthesizes news, filings, broker research | Morning brief: "What happened in tech/financials overnight that matters?" — all public data | Low — public sources only |
| **Earnings reviewer** | Reads transcripts and filings, updates models, flags thesis-relevant changes | "Summarize Unity's last earnings call and flag any guidance changes" — public filings | Low — public sources only |
| **Pitch builder** | Creates target lists, runs comparables, drafts pitchbooks | Internal investment thesis drafts using public comps — useful if no client data included | Low if no client data; medium otherwise |
| **Valuation reviewer** | Checks valuations against comps and methodology | Sanity-check our internal option pricing or stock valuations against market data | Low — internal models only |
| **Model builder** | Creates financial models from public filings and data feeds | Build a quick comparable model for a stock we're analyzing | Low — public filings |

### Templates to avoid (compliance reasons)

| Template | Why to skip |
|---|---|
| **KYC screener** | Directly processes client onboarding documents and source files — PII, identity documents |
| **Meeting preparer** | Assembles client and counterparty briefs — likely contains client names, relationships, identifying info |
| **General ledger reconciler** | Reconciles GL accounts and runs NAV calculations — contains actual financial positions and client data |
| **Month-end closer** | Runs close checklist, journal entries — touches firm financial data |
| **Statement auditor** | Reviews financial statements — contains sensitive firm or client financials |

### How to actually use the viable templates

These templates are open-source cookbooks. The workflow is:
1. Go to [`anthropics/financial-services`](https://github.com/anthropics/financial-services) on GitHub.
2. Find the template (e.g. Market Researcher).
3. Adapt the system prompt + tool definitions to call our own data sources (Schwab, Financial Modeling Prep) instead of their default connectors.
4. Run it either as a Claude Cowork plugin (manual, alongside your desktop) or wire it into the hub's agent backend as a named "mode."

**Practical suggestion:** Start with Market Researcher as a morning briefing mode. You open the Agent page, click "Morning Brief," and it fetches the latest news/filings for your current holdings, synthesizes what matters, and flags anything that affects your options positions. All public data, no PII, immediately useful.

### Architecture patterns (reference: [`anthropics/financial-services`](https://github.com/anthropics/financial-services))

The repo is file-based (markdown + YAML, no build). Useful patterns to steal when hardening our hub agent:

- **Two runtimes, one source.** The same system prompts and skills ship as **Claude Cowork / Claude Code plugins** and as **Claude Managed Agents** (`POST /v1/agents`). Cookbooks live under `managed-agent-cookbooks/` with `agent.yaml` manifests that mirror the plugin agent.
- **Layered packaging.** **Agents** (`plugins/agent-plugins/`) bundle an end-to-end workflow. **Vertical plugins** (`plugins/vertical-plugins/`) hold shared **skills**, **slash commands**, and **MCP** config. Agents sync copies of the skills they need.
- **Fine-grained tool sets.** Manifests use typed toolsets (e.g. `agent_toolset_20260401`) with **per-tool enablement** — e.g. read/grep/glob on, bash/write off — instead of an all-or-nothing tool dump.
- **MCP per integration.** Separate `mcp_toolset` blocks per server (env-based URLs), read-only vs read-write by policy, aligned with a central `.mcp.json` in the core plugin.
- **`callable_agents` (leaf workers).** Subagents get **minimal tools** (e.g. read-only document extraction with no MCP). **Output schemas** validate worker JSON before the orchestrator sees it — reduces prompt injection from untrusted inputs and keeps parent context clean.
- **Handoffs.** `scripts/orchestrate.py` is a reference loop: stream the parent session, parse structured `handoff_request` payloads, **allowlist** target agent slugs, **JSON Schema**–validate payloads, then `steer` the target session. Comments warn against trusting handoff blobs echoed from document text; production should prefer typed tool events.

**Applying this to RPG HUB:** separate “interpret user ask / read context” from “call Schwab or mutate hub state”; document hub rules in **skills**; expose **narrow** tool surfaces per step; if we add multi-agent flows, use **allowlists + schema-validated** worker outputs and avoid security-sensitive routing driven by unparsed model prose.

---

## Next Steps (ordered)

1. Extract Rankinator scoring from `Rankinator.tsx` → `src/lib/rankinatorScore.ts` (DRY first).
2. Build `get_quote` — simplest tool, proves the pipeline works end-to-end.
3. Build `get_options_chain` + wire up Schwab auth (already partially done via `_schwab-utils.ts`).
4. Stand up `/api/agent.ts` using Vercel AI SDK `streamText` with those two tools.
5. Connect `Agent.tsx` to real backend — replace stub `sendDraft` with streaming fetch, add basic chart rendering.
6. Add `rank_options` once the base pipeline is solid.
7. Adapt the Anthropic Market Researcher cookbook as a "Morning Brief" mode.
