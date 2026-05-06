// Streaming AI agent endpoint.
// Runs the full Anthropic tool-use loop server-side and streams newline-delimited
// JSON events: { type: "text"|"tool_start"|"tool_done"|"error"|"done" }.

import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import { getValidAccessToken } from "./_schwab-utils.js";
import { handler as screenerHandler } from "./_handlers/screener.js";
import { handler as quotesHandler } from "./_handlers/quotes.js";

// System prompt: dense but minimal. Every token earns its place.
// "Do not" rules waste tokens — instead the data structure enforces correct behavior:
//   rank:1 in each list is the best pick by that metric. snap{} gives instant headline numbers.
const SYSTEM_PROMPT = `You are RPG HUB's financial assistant. Live Schwab data via tools.

TOOLS: Batch all calls in ONE parallel request — no text before or between them.
Single stock → get_options_chain. Multiple tickers → find_best_options.
"Best option" default: get_options_chain(dte_range:[14,60]) + get_price_history("3m") together.
Specify option_type=PUT or CALL when known.

DATA — get_options_chain:
snap: {atm_iv_pct, best_write_yield_pct, top_oi, expected_move} — use all in opening sentence.
  expected_move = 1σ dollar move to expiry (underlying × IV × √(DTE/365)); cite as "±$X expected move".
  iv_rv_ratio = IV/20-day realized vol. >1.2 = rich premium (good to sell), <0.8 = cheap (good to buy).
top_for_writing: rank:1 = highest yield_ann. For CSP/covered call. OI≥50 filter applied.
top_for_buying: rank:1 = closest to ATM. Sorted OTM% asc = spectrum from near-ATM → speculative. Low OI is normal and fine for a new OTM position — OI builds as the stock moves. Capped at 70% OTM.
Fields: rank, k=strike, exp, mark=(bid+ask)/2, iv=IV%, delta=Δ(sensitivity/$1 move), theta=$/day, oi, dte, yield_ann=ann.yield%, otm_pct=OTM%+(positive=OTM), breakeven=strike∓mark

DATA — find_best_options:
ranked[]: rank:1 = best. Fields: rank, ticker, current_price, k, mark, breakeven, yield_ann, iv, otm_pct, dte, oi.

DATA — get_fundamentals:
market_cap_b, pe, eps_ttm, rev_growth_yoy, gross/net_margin_pct, beta, short_float_pct

OUTPUT:
"[TICKER] at $[price]." + 1 sentence directional context.
[chart spec here if price history available — BEFORE tables]
Writing table: Strike | Exp | Mark | OTM% | IV% | Yield/yr | Breakeven | OI | Notes
Buying table: Strike | Exp | Mark | OTM% | Delta | IV% | Breakeven | OI | Notes
1 sentence: best pick + why.

Chart: \`\`\`chart\n{"type":"line","title":"TICKER — 3M","xKey":"date","series":[{"key":"close","label":"Close"}],"data":[...]}\`\`\`
≤60 data points. No color field. No dividers. No filler. ≤150 words prose.`;

// --- Round to 2 decimal places ---
function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

// --- Tool result compressors ---
// Each one strips the Schwab blob down to only what Claude needs for quality analysis.
// Shorthand keys (k, d, g, iv) save tokens without losing meaning — the system prompt names them.

function compressQuotes(raw: any): any {
  if (!raw || raw.error) return raw;
  const out: Record<string, any> = {};
  for (const [sym, data] of Object.entries(raw as Record<string, any>)) {
    if (sym.startsWith("_")) continue;
    const q = (data as any)?.quote ?? data;
    const ref = (data as any)?.reference ?? {};
    const price = q?.lastPrice ?? q?.last ?? q?.mark ?? q?.close;
    if (typeof price !== "number") continue;
    out[sym] = {
      name: ref?.description ?? null,
      price: r2(price),
      chg_pct: q?.netPercentChangeInDouble != null ? r2(q.netPercentChangeInDouble) : null,
      prev_close: q?.closePrice != null ? r2(q.closePrice) : null,
      volume: q?.totalVolume ?? null,
      high52w: q?.["52WeekHigh"] ?? q?.fiftyTwoWkHigh ?? null,
      low52w: q?.["52WeekLow"] ?? q?.fiftyTwoWkLow ?? null,
    };
  }
  return Object.keys(out).length > 0 ? out : { error: "No valid quotes returned" };
}

// compressOptionsChain: "deterministic pipeline" pattern.
// Pre-computes yield_ann + otm_pct for every contract in TypeScript (100% accurate),
// then returns two pre-ranked flat lists instead of the raw nested structure.
// Claude receives a leaderboard — it never needs to re-sort or re-calculate.
function compressOptionsChain(raw: any): any {
  if (!raw || raw.error) return raw;
  const underlyingPrice: number | null = raw?.underlyingPrice ?? raw?.underlying?.last ?? null;

  const all: any[] = [];

  for (const side of ["call", "put"] as const) {
    const expDateMap = raw[`${side}ExpDateMap`];
    if (!expDateMap || typeof expDateMap !== "object") continue;

    for (const [expKey, strikesObj] of Object.entries(expDateMap as Record<string, any>)) {
      const expDate = expKey.split(":")[0];

      for (const [strikeStr, arr] of Object.entries(strikesObj as Record<string, any>)) {
        if (!Array.isArray(arr) || arr.length === 0) continue;
        const c = arr[0];
        if (c?.mini || c?.nonStandard || c?.isMini || c?.isNonStandard) continue;
        const bid = c?.bid ?? 0;
        const ask = c?.ask ?? 0;
        if (bid <= 0 && ask <= 0) continue;

        const strike = parseFloat(strikeStr);
        const mark = r2(c?.mark ?? c?.theoreticalOptionValue ?? (bid + ask) / 2);
        const dte: number | null = c?.daysToExpiration ?? null;
        const oi: number | null = c?.openInterest ?? null;
        const itm: boolean = c?.inTheMoney ?? false;

        // ── Pre-computed metrics (deterministic TypeScript, not LLM) ──────────
        // otm_pct: positive = OTM (good for writing), negative = ITM
        const otm_pct: number | null =
          underlyingPrice != null && strike > 0
            ? side === "put"
              ? r2((underlyingPrice - strike) / underlyingPrice * 100)
              : r2((strike - underlyingPrice) / underlyingPrice * 100)
            : null;

        // yield_ann: annualized premium yield % based on mark / strike (writing perspective)
        const yield_ann: number | null =
          dte != null && dte > 0 && strike > 0 && mark > 0
            ? r2((mark / strike) * (365 / dte) * 100)
            : null;

        // breakeven: price the underlying must stay above (put write) / below (call write)
        // or move past (for buyers). Same formula regardless of buy/sell direction.
        const breakeven: number | null =
          mark > 0 ? (side === "put" ? r2(strike - mark) : r2(strike + mark)) : null;

        all.push({
          k: strike,
          exp: expDate,
          side: side === "put" ? "P" : "C",
          mark,
          iv: c?.volatility != null ? r2(c.volatility) : null,
          delta: c?.delta != null ? r2(c.delta) : null,
          theta: c?.theta != null ? r2(c.theta) : null,
          oi,
          dte,
          itm,
          yield_ann,
          otm_pct,
          breakeven,
        });
      }
    }
  }

  // ── Headline snap — Claude reads these numbers in its opening sentence ───────
  // ATM IV: closest OTM contract to the underlying price
  const atmContract = all
    .filter((c) => c.otm_pct != null && c.otm_pct >= 0 && c.iv != null)
    .sort((a, b) => (a.otm_pct ?? 99) - (b.otm_pct ?? 99))[0] ?? null;
  const atm_iv_pct = atmContract?.iv ?? null;

  // ── Pre-ranked lists — rank:1 = best pick for that strategy ──────────────

  // Writing (CSP / covered call): OTM (>2%), decent OI, sorted by yield_ann desc
  const writingCandidates = all
    .filter((c) => !c.itm && (c.otm_pct ?? 0) >= 2 && c.yield_ann != null && (c.oi ?? 0) >= 50)
    .sort((a, b) => (b.yield_ann ?? 0) - (a.yield_ann ?? 0));

  const top_for_writing = writingCandidates.slice(0, 12).map((c, i) => ({ rank: i + 1, ...c }));

  // Buying (directional): OTM 0–70%, real premium, sorted by OTM% asc.
  // OI is intentionally NOT used for ranking — low OI on OTM options is expected when initiating
  // a new directional position. If the thesis plays out, OI will build as the stock moves.
  // Sorting by OTM% gives Claude a natural risk/reward spectrum: ATM (rank 1) → speculative (last).
  // Cap at 70% OTM to exclude deep-OTM contracts with legacy OI from prior price levels.
  const buyingCandidates = all
    .filter(
      (c) =>
        (c.otm_pct ?? -1) >= 0 &&        // OTM only (negative otm_pct = ITM, different thesis)
        (c.otm_pct ?? 999) <= 70 &&       // exclude dead deep-OTM contracts (e.g. DOCN $155 calls)
        c.mark > 0.01                     // must have non-trivial premium
    )
    .sort((a, b) => (a.otm_pct ?? 999) - (b.otm_pct ?? 999)); // closest-to-money first

  const top_for_buying = buyingCandidates.slice(0, 15).map((c, i) => ({ rank: i + 1, ...c }));

  const snap: Record<string, any> = {};
  if (atm_iv_pct != null) snap.atm_iv_pct = atm_iv_pct;
  if (top_for_writing[0]?.yield_ann != null) snap.best_write_yield_pct = top_for_writing[0].yield_ann;
  if (top_for_buying[0]?.oi != null) snap.top_oi = top_for_buying[0].oi;

  // expected_move: 1σ dollar range to the nearest expiration using ATM IV
  if (atmContract && underlyingPrice != null && atm_iv_pct != null && atmContract.dte != null && atmContract.dte > 0) {
    snap.expected_move = r2(underlyingPrice * (atm_iv_pct / 100) * Math.sqrt(atmContract.dte / 365));
  }

  return {
    underlying_price: underlyingPrice,
    snap,
    top_for_writing,
    top_for_buying,
  };
}

function compressScreener(raw: any): any {
  if (!raw || raw.error) return raw;
  const resultsByOtmPct = raw?.resultsByOtmPct;
  if (!resultsByOtmPct) return raw;

  // Flatten all rows across OTM buckets, sort by yield_ann descending (pre-ranked leaderboard)
  const allRows: any[] = [];
  for (const rows of Object.values(resultsByOtmPct as Record<string, any[]>)) {
    if (!rows?.length) continue;
    for (const r of rows) {
      const mark = r.mark ?? null;
      const strike = r.strike;
      const optType: string = raw.optionType ?? "P";
      const breakeven = mark != null
        ? (optType === "C" ? r2(strike + mark) : r2(strike - mark))
        : null;

      allRows.push({
        ticker: r.ticker,
        k: strike,
        current_price: r.currentPrice,
        mark,
        yield_ann: r.annYieldPct,
        iv: r.impliedVolPct,
        theta: r.thetaPerDay,
        otm_pct: r.actualOtmPct,
        dte: r.dte ?? raw.dte,
        oi: r.openInterest ?? null,
        breakeven,
      });
    }
  }

  allRows.sort((a, b) => (b.yield_ann ?? 0) - (a.yield_ann ?? 0));

  return {
    exp: raw.expiration,
    type: raw.optionType,
    dte: raw.dte,
    side: raw.positionSide,
    ranked: allRows.slice(0, 20).map((r, i) => ({ rank: i + 1, ...r })),
    ...(raw.warnings?.length > 0 ? { warnings: raw.warnings } : {}),
  };
}

// Schwab fundamentals → keep only the fields that drive investment decisions.
// market_cap/beta/short_float are critical for options sizing and volatility context.
function compressFundamentals(raw: any): any {
  if (!raw || raw.error) return raw;
  const out: Record<string, any> = {};
  for (const [sym, data] of Object.entries(raw as Record<string, any>)) {
    if (sym.startsWith("_")) continue;
    const f = (data as any)?.fundamental ?? data?.fundamentalData ?? data;
    if (!f) continue;
    const mcap = f?.marketCap ?? f?.marketCapFloat ?? null;
    out[sym] = {
      name: (data as any)?.description ?? null,
      market_cap_b: mcap != null ? r2(mcap / 1e9) : null,  // in billions
      pe: f?.peRatio != null ? r2(f.peRatio) : null,
      eps_ttm: f?.epsTTM != null ? r2(f.epsTTM) : null,
      rev_growth_yoy: f?.revChangeYear != null ? r2(f.revChangeYear * 100) : null,  // as %
      gross_margin_pct: f?.grossMarginTTM != null ? r2(f.grossMarginTTM * 100) : null,
      net_margin_pct: f?.netProfitMarginTTM != null ? r2(f.netProfitMarginTTM * 100) : null,
      beta: f?.beta != null ? r2(f.beta) : null,
      short_float_pct: f?.shortIntToFloat != null ? r2(f.shortIntToFloat * 100) : null,
      shares_out_m: f?.sharesOutstanding != null ? Math.round(f.sharesOutstanding / 1e6) : null,
      avg_vol_10d: f?.vol10DayAvg ?? null,
      debt_to_equity: f?.totalDebtToEquity != null ? r2(f.totalDebtToEquity) : null,
      book_value: f?.bookValuePerShare != null ? r2(f.bookValuePerShare) : null,
      high52w: f?.high52 ?? null,
      low52w: f?.low52 ?? null,
    };
  }
  return Object.keys(out).length > 0 ? out : { error: "No fundamentals returned" };
}

// --- Build a compact, Cursor-style tool label from the tool's input ---
function toolLabel(name: string, input: Record<string, any>): string {
  switch (name) {
    case "get_quotes": {
      const syms = ((input.symbols as string[]) ?? []).slice(0, 4).join(", ");
      return `Quotes · ${syms}`;
    }
    case "get_price_history":
      return `Price history · ${input.symbol} · ${input.period}`;
    case "get_options_chain": {
      const exp = input.expiration_date
        ? ` · ${String(input.expiration_date).slice(0, 7)}`
        : "";
      return `Options chain · ${input.symbol}${exp}`;
    }
    case "get_fundamentals": {
      const syms = ((input.symbols as string[]) ?? []).slice(0, 4).join(", ");
      return `Fundamentals · ${syms}`;
    }
    case "find_best_options": {
      const tickers = ((input.tickers as string[]) ?? []).slice(0, 3).join(", ");
      return `Scanning options · ${tickers}`;
    }
    default:
      return name.replace(/_/g, " ");
  }
}

// --- Adapter: call Express-style handlers with a fake req/res ---
function callHandler(
  handler: (req: any, res: any) => Promise<void>,
  opts: { method?: string; body?: object; query?: Record<string, string> }
): Promise<any> {
  return new Promise((resolve) => {
    const req = { method: opts.method ?? "POST", body: opts.body ?? {}, query: opts.query ?? {} };
    const res = {
      status(code: number) { void code; return this; },
      json(data: any) { resolve(data); },
      send(data: any) { resolve(data); },
      end() { resolve({}); },
      setHeader() { return this; },
    };
    Promise.resolve((handler as any)(req, res)).catch((err: unknown) =>
      resolve({ error: String(err) })
    );
  });
}

// --- Get a valid Schwab access token from Supabase ---
async function getSchwabToken(): Promise<string | null> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  const supabase = createClient(url, key);
  const { data: row } = await supabase
    .from("schwab_tokens")
    .select("access_token, refresh_token, expires_at")
    .eq("id", "default")
    .single();
  if (!row?.access_token) return null;
  return getValidAccessToken(supabase, row);
}

// Tool definitions: descriptions drive token cost every call — keep them precise and short.
const TOOLS: Anthropic.Messages.Tool[] = [
  {
    name: "get_quotes",
    description: "Real-time price, change%, volume, 52w range. Fast.",
    input_schema: {
      type: "object" as const,
      properties: {
        symbols: { type: "array", items: { type: "string" } },
      },
      required: ["symbols"],
    },
  },
  {
    name: "get_price_history",
    description: "Historical OHLCV for charting/trends. Fast.",
    input_schema: {
      type: "object" as const,
      properties: {
        symbol: { type: "string" },
        period: {
          type: "string",
          enum: ["1m", "3m", "6m", "1y", "2y"],
          description: "1m/3m/6m/1y/2y",
        },
      },
      required: ["symbol", "period"],
    },
  },
  {
    name: "get_options_chain",
    description:
      "Pre-ranked options chain for one stock (by yield & liquidity). Fast (2-3s). Supply expiration_date OR dte_range [min,max] e.g.[14,60]. Specify option_type=PUT or CALL when known.",
    input_schema: {
      type: "object" as const,
      properties: {
        symbol: { type: "string" },
        expiration_date: { type: "string", description: "YYYY-MM-DD" },
        dte_range: {
          type: "array",
          items: { type: "number" },
          description: "[minDTE, maxDTE]",
        },
        option_type: {
          type: "string",
          enum: ["ALL", "CALL", "PUT"],
        },
        strike_count: { type: "number", description: "Default 12, max 30." },
      },
      required: ["symbol"],
    },
  },
  {
    name: "get_fundamentals",
    description:
      "Market cap, P/E, EPS, growth, margins, beta, short float for stocks. Fast.",
    input_schema: {
      type: "object" as const,
      properties: {
        symbols: {
          type: "array",
          items: { type: "string" },
        },
      },
      required: ["symbols"],
    },
  },
  {
    name: "find_best_options",
    description:
      "Screen & rank options across 2+ stocks by yield/IV/liquidity. SLOW (15-30s). Multi-ticker only — use get_options_chain for a single stock.",
    input_schema: {
      type: "object" as const,
      properties: {
        tickers: { type: "array", items: { type: "string" } },
        expiration_date: { type: "string", description: "YYYY-MM-DD" },
        option_type: { type: "string", enum: ["puts", "calls"] },
        otm_levels: {
          type: "array",
          items: { type: "number" },
          description: "OTM bands [5,10,15,20] = 5-10%, 10-15%, etc.",
        },
        top_n: { type: "number", description: "Per OTM level (default 3)" },
        position_side: { type: "string", enum: ["write", "buy"] },
      },
      required: ["tickers", "expiration_date", "option_type"],
    },
  },
];

// --- Execute a tool and return compressed result ---
async function executeTool(name: string, input: Record<string, any>): Promise<unknown> {
  switch (name) {
    case "get_quotes": {
      const symbols = (input.symbols as string[]).map((s) => String(s).toUpperCase().trim()).join(",");
      const raw = await callHandler(quotesHandler, { method: "GET", query: { symbols }, body: {} });
      return compressQuotes(raw);
    }

    case "get_price_history": {
      const token = await getSchwabToken();
      if (!token) return { error: "Schwab not authorized" };
      const periodMap: Record<string, Record<string, string>> = {
        "1m": { periodType: "month", period: "1", frequencyType: "daily", frequency: "1" },
        "3m": { periodType: "month", period: "3", frequencyType: "daily", frequency: "1" },
        "6m": { periodType: "month", period: "6", frequencyType: "daily", frequency: "1" },
        "1y": { periodType: "year", period: "1", frequencyType: "weekly", frequency: "1" },
        "2y": { periodType: "year", period: "2", frequencyType: "weekly", frequency: "1" },
      };
      const p = periodMap[input.period as string] ?? periodMap["3m"]!;
      const params = new URLSearchParams({
        symbol: String(input.symbol).toUpperCase().trim(),
        ...p,
        needExtendedHoursData: "false",
      });
      try {
        const resp = await fetch(
          `https://api.schwabapi.com/marketdata/v1/pricehistory?${params}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (!resp.ok) return { error: `Schwab price history ${resp.status}` };
        const body: any = await resp.json();
        const candles = (body?.candles ?? []) as any[];
        return {
          symbol: input.symbol,
          period: input.period,
          candles: candles
            .filter((c) => c.close != null)
            .map((c) => ({
              date: new Date(c.datetime).toISOString().slice(0, 10),
              close: r2(c.close),
              vol: c.volume,
            })),
        };
      } catch (e) {
        return { error: String(e) };
      }
    }

    case "get_options_chain": {
      const token = await getSchwabToken();
      if (!token) return { error: "Schwab not authorized" };
      const { symbol, expiration_date, dte_range, option_type = "ALL", strike_count = 12 } = input;

      // Resolve date window: specific date > dte_range > default 7-50 days
      let fromDate: string;
      let toDate: string;
      const today = new Date();
      const iso = (d: Date) => d.toISOString().slice(0, 10);
      if (expiration_date) {
        fromDate = toDate = String(expiration_date);
      } else if (Array.isArray(dte_range) && dte_range.length >= 2) {
        fromDate = iso(new Date(today.getTime() + Number(dte_range[0]) * 86400000));
        toDate = iso(new Date(today.getTime() + Number(dte_range[1]) * 86400000));
      } else {
        // Smart default: 7-50 days covers weeklies + monthly expirations
        fromDate = iso(new Date(today.getTime() + 7 * 86400000));
        toDate = iso(new Date(today.getTime() + 50 * 86400000));
      }

      try {
        const sym = String(symbol).toUpperCase().trim();

        // Fetch chain + 20-day price history in parallel — history is needed for IV/RV ratio
        const chainParams = new URLSearchParams({
          symbol: sym,
          contractType: String(option_type),
          strikeCount: String(Math.min(Number(strike_count) || 12, 30)),
          includeUnderlyingQuote: "TRUE",
          strategy: "SINGLE",
          fromDate,
          toDate,
        });
        const rvHistoryParams = new URLSearchParams({
          symbol: sym,
          periodType: "month",
          period: "2",
          frequencyType: "daily",
          frequency: "1",
          needExtendedHoursData: "false",
        });

        const [chainResp, histResp] = await Promise.all([
          fetch(`https://api.schwabapi.com/marketdata/v1/chains?${chainParams}`, { headers: { Authorization: `Bearer ${token}` } }),
          fetch(`https://api.schwabapi.com/marketdata/v1/pricehistory?${rvHistoryParams}`, { headers: { Authorization: `Bearer ${token}` } }),
        ]);

        if (!chainResp.ok) return { error: `Schwab chains ${chainResp.status}` };
        const raw = await chainResp.json();

        // Compute 20-day annualized realized vol from daily closes
        let rv20d: number | null = null;
        if (histResp.ok) {
          try {
            const hist: any = await histResp.json();
            const closes: number[] = (hist?.candles ?? [])
              .map((c: any) => c?.close)
              .filter((x: unknown): x is number => typeof x === "number" && x > 0);
            if (closes.length >= 12) {
              const tail = closes.slice(-22);
              const rets: number[] = [];
              for (let i = 1; i < tail.length; i++) rets.push(Math.log(tail[i]! / tail[i - 1]!));
              const mean = rets.reduce((s, x) => s + x, 0) / rets.length;
              const variance = rets.reduce((s, x) => s + (x - mean) ** 2, 0) / Math.max(rets.length - 1, 1);
              rv20d = r2(Math.sqrt(variance) * Math.sqrt(252) * 100);
            }
          } catch { /* RV is supplemental — ignore errors */ }
        }

        const result = compressOptionsChain(raw);

        // Attach IV/RV ratio to snap — tells Claude whether premium is rich or cheap
        if (rv20d != null && result?.snap?.atm_iv_pct != null) {
          result.snap.rv_20d = rv20d;
          result.snap.iv_rv_ratio = r2(result.snap.atm_iv_pct / rv20d);
        }

        return result;
      } catch (e) {
        return { error: String(e) };
      }
    }

    case "get_fundamentals": {
      const token = await getSchwabToken();
      if (!token) return { error: "Schwab not authorized" };
      const symbols = (input.symbols as string[]).map((s) => String(s).toUpperCase().trim());
      try {
        const results: Record<string, any> = {};
        await Promise.all(
          symbols.map(async (sym) => {
            const params = new URLSearchParams({ symbol: sym, projection: "fundamental" });
            const resp = await fetch(
              `https://api.schwabapi.com/marketdata/v1/instruments?${params}`,
              { headers: { Authorization: `Bearer ${token}` } }
            );
            if (!resp.ok) { results[sym] = { error: `HTTP ${resp.status}` }; return; }
            const body: any = await resp.json();
            const instruments = Array.isArray(body) ? body : Object.values(body);
            const match = instruments.find((i: any) => i?.symbol === sym) ?? instruments[0];
            if (match) results[sym] = match;
          })
        );
        return compressFundamentals(results);
      } catch (e) {
        return { error: String(e) };
      }
    }

    case "find_best_options": {
      const raw = await callHandler(screenerHandler, {
        method: "POST",
        body: {
          expiration: input.expiration_date,
          optionType: input.option_type,
          otmLevels: Array.isArray(input.otm_levels) ? input.otm_levels : [5, 10, 15, 20],
          topN: Math.min(Number(input.top_n) || 3, 10),
          positionSide: input.position_side ?? "write",
          universeSymbols: (input.tickers as string[]).map((s) => String(s).toUpperCase().trim()),
        },
      });
      return compressScreener(raw);
    }

    default:
      return { error: `Unknown tool: ${name}` };
  }
}

// --- Core agent loop ---
async function runAgent(
  messages: Anthropic.Messages.MessageParam[],
  emit: (line: string) => void
): Promise<void> {
  // anthropic-beta header enables prompt caching — must be on the client, not in the request body.
  // Anthropic charges 0.1× for cache reads vs full price, saving ~90% on system prompt tokens
  // across the 3-5 API calls in a single agent loop.
  const client = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    defaultHeaders: { "anthropic-beta": "prompt-caching-2024-07-31" },
  });
  const allMessages = [...messages];

  const cachedSystem = [{ type: "text" as const, text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" as const } }];

  for (let step = 0; step < 5; step++) {
    let textContent = "";
    const pending = new Map<number, { id: string; name: string; inputJson: string }>();
    const completedToolUses: { id: string; name: string; input: Record<string, any> }[] = [];
    let stopReason = "";

    const stream = client.messages.stream({
      model: "claude-sonnet-4-6",
      max_tokens: 2048,
      system: cachedSystem as any,
      tools: TOOLS,
      messages: allMessages,
    } as any);

    for await (const event of stream) {
      switch (event.type) {
        case "content_block_start": {
          if (event.content_block.type === "tool_use") {
            pending.set(event.index, {
              id: event.content_block.id,
              name: event.content_block.name,
              inputJson: "",
            });
          }
          break;
        }
        case "content_block_delta": {
          if (event.delta.type === "text_delta") {
            textContent += event.delta.text;
            emit(JSON.stringify({ type: "text", delta: event.delta.text }));
          } else if (event.delta.type === "input_json_delta") {
            const p = pending.get(event.index);
            if (p) p.inputJson += event.delta.partial_json;
          }
          break;
        }
        case "content_block_stop": {
          const p = pending.get(event.index);
          if (p) {
            let parsedInput: Record<string, any> = {};
            try { parsedInput = JSON.parse(p.inputJson || "{}") as Record<string, any>; } catch { /* */ }
            completedToolUses.push({ id: p.id, name: p.name, input: parsedInput });
            pending.delete(event.index);
            // Emit tool_start only after input is assembled — lets us build a meaningful label
            emit(JSON.stringify({
              type: "tool_start",
              name: p.name,
              label: toolLabel(p.name, parsedInput),
            }));
          }
          break;
        }
        case "message_delta": {
          stopReason = event.delta.stop_reason ?? "";
          break;
        }
      }
    }

    if (completedToolUses.length === 0 || stopReason === "end_turn") {
      emit(JSON.stringify({ type: "done" }));
      return;
    }

    const assistantContent: any[] = [];
    if (textContent) assistantContent.push({ type: "text", text: textContent });
    for (const tu of completedToolUses) {
      assistantContent.push({ type: "tool_use", id: tu.id, name: tu.name, input: tu.input });
    }
    allMessages.push({ role: "assistant", content: assistantContent });

    const toolResults = await Promise.all(
      completedToolUses.map(async (tu) => {
        const result = await executeTool(tu.name, tu.input);
        emit(JSON.stringify({ type: "tool_done", name: tu.name }));
        return {
          type: "tool_result" as const,
          tool_use_id: tu.id,
          content: JSON.stringify(result),
        };
      })
    );

    allMessages.push({ role: "user", content: toolResults });
  }

  emit(JSON.stringify({ type: "done" }));
}

// --- Vercel serverless handler ---
export default async function handler(req: any, res: any): Promise<void> {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method Not Allowed" });
    return;
  }

  const body = req.body ?? {};
  const messages: Anthropic.Messages.MessageParam[] = Array.isArray(body?.messages)
    ? body.messages
    : [];

  if (messages.length === 0) {
    res.status(400).json({ error: "No messages provided" });
    return;
  }

  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-store");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const emit = (line: string) => {
    try { res.write(line + "\n"); } catch { /* client disconnected */ }
  };

  try {
    await runAgent(messages, emit);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    emit(JSON.stringify({ type: "error", message: msg }));
  } finally {
    res.end();
  }
}
