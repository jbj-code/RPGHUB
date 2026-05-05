// Streaming AI agent endpoint.
// Runs the full Anthropic tool-use loop server-side and streams newline-delimited
// JSON events: { type: "text"|"tool_start"|"tool_done"|"error"|"done" }.

import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import { getValidAccessToken } from "./_schwab-utils.js";
import { handler as screenerHandler } from "./_handlers/screener.js";
import { handler as quotesHandler } from "./_handlers/quotes.js";

// --- System prompt ---
// Key rules:
//  1. No reasoning/thinking text between tool calls — output text only in the FINAL response.
//  2. Prefer get_options_chain (fast, 2-3s) over find_best_options (slow, 15-30s) for single-ticker queries.
//  3. Keep final responses concise and structured.
const SYSTEM_PROMPT = `You are the RPG HUB financial assistant. You have live Schwab market data via tools.

TOOL CALLING RULES (critical):
- Do NOT output any text before making tool calls. Call tools immediately and silently.
- Do NOT output reasoning, "let me...", "now I have...", or thinking text between tool calls.
- Call ALL needed tools in ONE batch (parallel). Never make a tool call, get results, then make another tool call you could have made up front. Output your final response ONLY after all tools return.
- Single-stock options → get_options_chain (fast, 2-3s). Multi-ticker screening → find_best_options.
- For "best option" queries: get_options_chain with dte_range [14, 60] + get_price_history (90d, daily) in ONE parallel batch.
- Always set option_type = "PUT" or "CALL" when known — halves the data size.
- For "best put/call to buy": 20-45 DTE, delta -0.3 to -0.5 (puts) / 0.3 to 0.5 (calls), OI > 500.
- For covered calls / CSPs: 21-45 DTE, 5-15% OTM, theta > 0.

FIELD KEY:
- Options: k=strike, d=delta, iv=implied vol%, theta=daily decay, oi=open interest, itm=in-the-money
- Fundamentals: market_cap_b=billions, pe=P/E, eps_ttm=EPS TTM, rev_growth_yoy=%, beta=market sensitivity

OUTPUT FORMAT (strict):
1. One sentence: price + directional context.
2. If you have price history: put the chart spec HERE (immediately after the opening sentence), before any table.
3. Options table: Strike | Exp | Mark | Delta | IV% | Theta | OI | Notes
4. One sentence recommendation. Done.

Chart format:
\`\`\`chart
{"type":"line","title":"TICKER — N MONTH PRICE","xKey":"date","series":[{"key":"close","label":"Close"}],"data":[{"date":"2026-01-15","close":24.5}]}
\`\`\`

Chart rules: omit "color" field (system applies brand color automatically). Keep data ≤ 60 pts (use weekly candles for > 90 days).
No "Bottom Line" sections. No "---" dividers. No apologies. No filler. Max 200 words of prose total.`;

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
      prev_close: q?.closePrice != null ? r2(q.closePrice) : null,
      open: q?.openPrice != null ? r2(q.openPrice) : null,
      high: q?.highPrice != null ? r2(q.highPrice) : null,
      low: q?.lowPrice != null ? r2(q.lowPrice) : null,
      chg_pct: q?.netPercentChangeInDouble != null ? r2(q.netPercentChangeInDouble) : null,
      volume: q?.totalVolume ?? null,
      high52w: q?.["52WeekHigh"] ?? q?.fiftyTwoWkHigh ?? null,
      low52w: q?.["52WeekLow"] ?? q?.fiftyTwoWkLow ?? null,
    };
  }
  return Object.keys(out).length > 0 ? out : { error: "No valid quotes returned" };
}

function compressOptionsChain(raw: any): any {
  if (!raw || raw.error) return raw;
  const underlyingPrice = raw?.underlyingPrice ?? raw?.underlying?.last ?? null;
  const result: any = { underlying_price: underlyingPrice };

  for (const side of ["call", "put"] as const) {
    const expDateMap = raw[`${side}ExpDateMap`];
    if (!expDateMap || typeof expDateMap !== "object") continue;
    const sideKey = `${side}s`;
    result[sideKey] = {};

    for (const [expKey, strikesObj] of Object.entries(expDateMap as Record<string, any>)) {
      const expDate = expKey.split(":")[0];
      const contracts: any[] = [];

      for (const [strikeStr, arr] of Object.entries(strikesObj as Record<string, any>)) {
        if (!Array.isArray(arr) || arr.length === 0) continue;
        const c = arr[0];
        if (c?.mini || c?.nonStandard || c?.isMini || c?.isNonStandard) continue;
        const bid = c?.bid ?? 0;
        const ask = c?.ask ?? 0;
        if (bid <= 0 && ask <= 0) continue;
        const mark = c?.mark ?? c?.theoreticalOptionValue ?? r2((bid + ask) / 2);
        contracts.push({
          k: parseFloat(strikeStr),                                    // strike
          bid: r2(bid),
          ask: r2(ask),
          mark: r2(mark),                                              // mid price (best fill estimate)
          d: c?.delta != null ? r2(c.delta) : null,                   // delta
          g: c?.gamma != null ? r2(c.gamma) : null,                   // gamma (risk of delta change)
          iv: c?.volatility != null ? r2(c.volatility) : null,        // implied vol %
          vega: c?.vega != null ? r2(c.vega) : null,                  // $ change per 1% IV move
          theta: c?.theta != null ? r2(c.theta) : null,               // daily time decay
          oi: c?.openInterest ?? null,                                 // open interest (liquidity)
          vol: c?.totalVolume ?? null,                                 // today's volume
          dte: c?.daysToExpiration ?? null,
          itm: c?.inTheMoney ?? null,                                  // in-the-money flag
        });
      }

      if (contracts.length > 0) {
        contracts.sort((a, b) => a.k - b.k);
        result[sideKey][expDate] = contracts;
      }
    }
  }
  return result;
}

function compressScreener(raw: any): any {
  if (!raw || raw.error) return raw;
  const resultsByOtmPct = raw?.resultsByOtmPct;
  if (!resultsByOtmPct) return raw;

  const compressed: Record<string, any[]> = {};
  for (const [otmPct, rows] of Object.entries(resultsByOtmPct as Record<string, any[]>)) {
    if (!rows?.length) continue;
    compressed[`otm_${otmPct}pct`] = rows.map((r) => ({
      ticker: r.ticker,
      company: r.company ?? null,
      k: r.strike,
      bid: r.bid,
      ask: r.ask,
      mark: r.mark ?? null,
      yield_ann: r.annYieldPct,
      d: r.delta,
      iv: r.impliedVolPct,
      theta: r.thetaPerDay,
      actual_otm: r.actualOtmPct,
      dte: r.dte ?? raw.dte,
    }));
  }

  return {
    exp: raw.expiration,
    type: raw.optionType,
    dte: raw.dte,
    side: raw.positionSide,
    results: compressed,
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

// --- Anthropic tool definitions ---
// Descriptions are short and include speed hints so Claude picks the right tool.
const TOOLS: Anthropic.Messages.Tool[] = [
  {
    name: "get_quotes",
    description: "Real-time price, % change, volume, 52-week range for one or more stocks. Fast (~1s).",
    input_schema: {
      type: "object" as const,
      properties: {
        symbols: {
          type: "array",
          items: { type: "string" },
          description: 'Uppercase tickers, e.g. ["U", "AAPL"]',
        },
      },
      required: ["symbols"],
    },
  },
  {
    name: "get_price_history",
    description: "Historical daily OHLCV prices for a stock. Use for charting or trend analysis. Fast (~2s).",
    input_schema: {
      type: "object" as const,
      properties: {
        symbol: { type: "string", description: "Ticker" },
        period: {
          type: "string",
          enum: ["1m", "3m", "6m", "1y", "2y"],
          description: "1m=1 month, 3m=3 months, 1y=1 year",
        },
      },
      required: ["symbol", "period"],
    },
  },
  {
    name: "get_options_chain",
    description:
      "Options chain for a specific stock: strikes, bid/ask, delta, IV, OI, theta. FAST (2-3s). Use for single-stock analysis. Supply EITHER expiration_date (specific date) OR dte_range [min, max] (e.g. [14,60] for all expirations 14-60 days out in one call). Omit both to auto-fetch the 7-50 day window. Always set option_type to CALL or PUT when you know the type — halves the data.",
    input_schema: {
      type: "object" as const,
      properties: {
        symbol: { type: "string", description: "Underlying ticker, e.g. 'U'" },
        expiration_date: {
          type: "string",
          description: "Specific YYYY-MM-DD expiration. Use this OR dte_range, not both.",
        },
        dte_range: {
          type: "array",
          items: { type: "number" },
          description:
            "e.g. [14, 60] fetches all expirations 14-60 DTE in a single call. Ideal for open-ended 'best option right now' queries.",
        },
        option_type: {
          type: "string",
          enum: ["ALL", "CALL", "PUT"],
          description: "Always specify CALL or PUT when you know the type. Default ALL.",
        },
        strike_count: {
          type: "number",
          description: "Strikes around ATM (default 12, max 30). 12 is sufficient for most analysis.",
        },
      },
      required: ["symbol"],
    },
  },
  {
    name: "get_fundamentals",
    description:
      "Key fundamentals for one or more stocks: market cap, P/E, EPS, revenue growth, gross margin, net margin, beta, short float %, average volume, debt/equity, book value. Fast (~1s). Use when the user asks about valuation, company size, or when context about the company enriches an options recommendation.",
    input_schema: {
      type: "object" as const,
      properties: {
        symbols: {
          type: "array",
          items: { type: "string" },
          description: 'Uppercase tickers, e.g. ["U", "AAPL"]',
        },
      },
      required: ["symbols"],
    },
  },
  {
    name: "find_best_options",
    description:
      "Screen and rank options across multiple stocks by yield, IV, and liquidity. SLOW (15-30s). Only use when comparing options across several tickers, not for a single stock.",
    input_schema: {
      type: "object" as const,
      properties: {
        tickers: {
          type: "array",
          items: { type: "string" },
          description: "Stocks to scan (use 2+ tickers — for 1 stock use get_options_chain instead)",
        },
        expiration_date: { type: "string", description: "YYYY-MM-DD" },
        option_type: { type: "string", enum: ["puts", "calls"] },
        otm_levels: {
          type: "array",
          items: { type: "number" },
          description: "OTM % bands: 5=5-10% OTM, 10=10-15%, 15=15-20%, 20=20-30%. Default [5,10,15,20].",
        },
        top_n: { type: "number", description: "Top N per OTM level (default 3)" },
        position_side: { type: "string", enum: ["write", "buy"], description: "Default: write" },
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
        const params = new URLSearchParams({
          symbol: String(symbol).toUpperCase().trim(),
          contractType: String(option_type),
          strikeCount: String(Math.min(Number(strike_count) || 12, 30)),
          includeUnderlyingQuote: "TRUE",
          strategy: "SINGLE",
          fromDate,
          toDate,
        });
        const resp = await fetch(
          `https://api.schwabapi.com/marketdata/v1/chains?${params}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (!resp.ok) return { error: `Schwab chains ${resp.status}` };
        const raw = await resp.json();
        return compressOptionsChain(raw);
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
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const allMessages = [...messages];

  for (let step = 0; step < 5; step++) {
    let textContent = "";
    const pending = new Map<number, { id: string; name: string; inputJson: string }>();
    const completedToolUses: { id: string; name: string; input: Record<string, any> }[] = [];
    let stopReason = "";

    const stream = client.messages.stream({
      model: "claude-sonnet-4-6",
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      tools: TOOLS,
      messages: allMessages,
    });

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
