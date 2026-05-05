// Streaming AI agent endpoint.
// Runs the full Anthropic tool-use loop server-side and streams newline-delimited
// JSON events to the client: { type: "text"|"tool_start"|"tool_done"|"error"|"done" }.

import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import { getValidAccessToken } from "./_schwab-utils.js";
import { handler as screenerHandler } from "./_handlers/screener.js";
import { handler as quotesHandler } from "./_handlers/quotes.js";

// --- Tool labels shown in the UI while the tool runs ---
const TOOL_LABELS: Record<string, string> = {
  get_quotes: "Fetching live quotes...",
  get_price_history: "Loading price history...",
  get_options_chain: "Pulling options chain...",
  find_best_options: "Scanning and ranking options (may take ~10s)...",
};

const SYSTEM_PROMPT = `You are the RPG HUB financial assistant — sharp, concise, data-first. You have live Schwab market data via tools.

Call tools proactively whenever the question needs current data. After tools return, synthesize into a clear answer.

Output format:
- Lead with 1-2 sentence insight/summary.
- For options results: present the top contracts as a compact markdown table with columns: Strike | Bid | Ann Yield % | Delta | DTE.
- For price/return data: include a chart spec (see below) when a visual adds value.
- Keep responses concise — no fluff, no apologies.

Chart spec format (append after your text when useful, never mid-sentence):
\`\`\`chart
{"type":"line","title":"Unity (U) — 3-Month Price","xKey":"date","series":[{"key":"close","label":"Close","color":"#6366f1"}],"data":[{"date":"2026-02-15","close":24.5},...]}
\`\`\`

Chart rules:
- type: "line" for price/time series, "bar" for comparisons and rankings.
- colors: #6366f1 (indigo/primary), #10b981 (green), #f59e0b (amber), #ef4444 (red), #3b82f6 (blue).
- xKey for line charts: "date" (YYYY-MM-DD strings). xKey for bar charts: a label field.
- Keep data arrays ≤ 60 points (sample or aggregate if needed).
- Only include a chart when it genuinely adds value over a table.`;

// --- Adapter: call an Express-style handler with a fake req/res ---
function callHandler(
  handler: (req: any, res: any) => Promise<void>,
  opts: { method?: string; body?: object; query?: Record<string, string> }
): Promise<any> {
  return new Promise((resolve) => {
    const req = {
      method: opts.method ?? "POST",
      body: opts.body ?? {},
      query: opts.query ?? {},
    };
    const res = {
      _status: 200,
      status(code: number) { this._status = code; return this; },
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
const TOOLS: Anthropic.Messages.Tool[] = [
  {
    name: "get_quotes",
    description:
      "Get real-time quotes for one or more stocks: last price, % change, 52-week high/low, volume.",
    input_schema: {
      type: "object" as const,
      properties: {
        symbols: {
          type: "array",
          items: { type: "string" },
          description: 'Uppercase ticker symbols, e.g. ["AAPL", "U"]',
        },
      },
      required: ["symbols"],
    },
  },
  {
    name: "get_price_history",
    description:
      "Get historical daily OHLCV prices for a stock. Use for trend analysis, return calculations, or charting.",
    input_schema: {
      type: "object" as const,
      properties: {
        symbol: { type: "string", description: 'Ticker, e.g. "U"' },
        period: {
          type: "string",
          enum: ["1m", "3m", "6m", "1y", "2y"],
          description: "Time period: 1m=1 month, 3m=3 months, 6m=6 months, 1y=1 year, 2y=2 years.",
        },
      },
      required: ["symbol", "period"],
    },
  },
  {
    name: "get_options_chain",
    description:
      "Fetch the raw options chain for a specific stock and expiration date. Use for inspecting individual strikes and greeks — not for ranking (use find_best_options for that).",
    input_schema: {
      type: "object" as const,
      properties: {
        symbol: { type: "string", description: "Underlying ticker" },
        expiration_date: { type: "string", description: "Expiration in YYYY-MM-DD format" },
        option_type: {
          type: "string",
          enum: ["ALL", "CALL", "PUT"],
          description: "Which side to return (default ALL)",
        },
        strike_count: {
          type: "number",
          description: "Number of strikes centered around ATM (default 20, max 60)",
        },
      },
      required: ["symbol", "expiration_date"],
    },
  },
  {
    name: "find_best_options",
    description:
      "Screen and rank options for specific stocks by annualized yield, IV, delta, and liquidity. Use for 'find the best puts/calls for X' or 'what options should I sell on Y?' queries.",
    input_schema: {
      type: "object" as const,
      properties: {
        tickers: {
          type: "array",
          items: { type: "string" },
          description: 'Stocks to scan, e.g. ["U", "AAPL"]',
        },
        expiration_date: {
          type: "string",
          description: "Target expiration in YYYY-MM-DD format",
        },
        option_type: {
          type: "string",
          enum: ["puts", "calls"],
          description: "puts or calls",
        },
        otm_levels: {
          type: "array",
          items: { type: "number" },
          description:
            "OTM % bands to scan: 5=5-10% OTM, 10=10-15% OTM, 15=15-20% OTM, 20=20-30% OTM. Default [5,10,15,20].",
        },
        top_n: {
          type: "number",
          description: "Top N results per OTM level (default 3, max 10)",
        },
        position_side: {
          type: "string",
          enum: ["write", "buy"],
          description: "write=sell to collect premium, buy=pay debit to go long. Default: write.",
        },
      },
      required: ["tickers", "expiration_date", "option_type"],
    },
  },
];

// --- Execute a tool call and return its result ---
async function executeTool(
  name: string,
  input: Record<string, any>
): Promise<unknown> {
  switch (name) {
    case "get_quotes": {
      const symbols = (input.symbols as string[])
        .map((s) => String(s).toUpperCase().trim())
        .join(",");
      return callHandler(quotesHandler, { method: "GET", query: { symbols }, body: {} });
    }

    case "get_price_history": {
      const token = await getSchwabToken();
      if (!token) return { error: "Schwab not authorized. Run the Schwab login flow." };
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
        if (!resp.ok) return { error: `Schwab price history returned ${resp.status}` };
        const body: any = await resp.json();
        const candles = (body?.candles ?? []) as any[];
        // Return compact candles so the LLM can build a chart spec
        return {
          symbol: input.symbol,
          period: input.period,
          candles: candles
            .filter((c) => c.close != null)
            .map((c) => ({
              date: new Date(c.datetime).toISOString().slice(0, 10),
              open: Math.round(c.open * 100) / 100,
              high: Math.round(c.high * 100) / 100,
              low: Math.round(c.low * 100) / 100,
              close: Math.round(c.close * 100) / 100,
              volume: c.volume,
            })),
        };
      } catch (e) {
        return { error: String(e) };
      }
    }

    case "get_options_chain": {
      const token = await getSchwabToken();
      if (!token) return { error: "Schwab not authorized. Run the Schwab login flow." };
      const {
        symbol,
        expiration_date,
        option_type = "ALL",
        strike_count = 20,
      } = input;
      try {
        const params = new URLSearchParams({
          symbol: String(symbol).toUpperCase().trim(),
          contractType: String(option_type),
          strikeCount: String(Math.min(Number(strike_count) || 20, 60)),
          includeUnderlyingQuote: "TRUE",
          strategy: "SINGLE",
          fromDate: String(expiration_date),
          toDate: String(expiration_date),
        });
        const resp = await fetch(
          `https://api.schwabapi.com/marketdata/v1/chains?${params}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (!resp.ok) return { error: `Schwab chains returned ${resp.status}` };
        return await resp.json();
      } catch (e) {
        return { error: String(e) };
      }
    }

    case "find_best_options": {
      return callHandler(screenerHandler, {
        method: "POST",
        body: {
          expiration: input.expiration_date,
          optionType: input.option_type,
          otmLevels: Array.isArray(input.otm_levels) ? input.otm_levels : [5, 10, 15, 20],
          topN: Math.min(Number(input.top_n) || 3, 10),
          positionSide: input.position_side ?? "write",
          universeSymbols: (input.tickers as string[]).map((s) =>
            String(s).toUpperCase().trim()
          ),
        },
      });
    }

    default:
      return { error: `Unknown tool: ${name}` };
  }
}

// --- Core agent loop: streams events via the emit callback ---
async function runAgent(
  messages: Anthropic.Messages.MessageParam[],
  scope: string,
  emit: (line: string) => void
): Promise<void> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const scopeNote =
    scope === "stocks"
      ? "\n\nActive scope: STOCKS — focus on equities, ETFs, and stock analysis."
      : "\n\nActive scope: OPTIONS — focus on options strategies, premium, and derivatives.";

  const allMessages = [...messages];

  // Up to 5 rounds of tool calls before forcing a final response
  for (let step = 0; step < 5; step++) {
    let textContent = "";
    // Map from content_block index → pending tool use
    const pending = new Map<number, { id: string; name: string; inputJson: string }>();
    const completedToolUses: { id: string; name: string; input: Record<string, any> }[] = [];
    let stopReason = "";

    // Model ID — update to the latest Claude version you want to use.
    // claude-3-5-sonnet-20241022 is battle-tested for tool use and financial reasoning.
    const stream = client.messages.stream({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 4096,
      system: SYSTEM_PROMPT + scopeNote,
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
            emit(
              JSON.stringify({
                type: "tool_start",
                name: event.content_block.name,
                label: TOOL_LABELS[event.content_block.name] ?? "Working...",
              })
            );
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
            try {
              completedToolUses.push({
                id: p.id,
                name: p.name,
                input: JSON.parse(p.inputJson || "{}") as Record<string, any>,
              });
            } catch {
              completedToolUses.push({ id: p.id, name: p.name, input: {} });
            }
            pending.delete(event.index);
          }
          break;
        }

        case "message_delta": {
          stopReason = event.delta.stop_reason ?? "";
          break;
        }
      }
    }

    // No tools called, or LLM decided it's done → finish
    if (completedToolUses.length === 0 || stopReason === "end_turn") {
      emit(JSON.stringify({ type: "done" }));
      return;
    }

    // Build the assistant turn with all content blocks
    const assistantContent: any[] = [];
    if (textContent) assistantContent.push({ type: "text", text: textContent });
    for (const tu of completedToolUses) {
      assistantContent.push({ type: "tool_use", id: tu.id, name: tu.name, input: tu.input });
    }
    allMessages.push({ role: "assistant", content: assistantContent });

    // Execute all tool calls in parallel
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

// --- Vercel Web API handler ---
export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON body", { status: 400 });
  }

  const messages: Anthropic.Messages.MessageParam[] = Array.isArray(body?.messages)
    ? body.messages
    : [];
  const scope: string = typeof body?.scope === "string" ? body.scope : "options";

  if (messages.length === 0) {
    return new Response("No messages provided", { status: 400 });
  }

  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  const emit = (line: string) => {
    try {
      writer.write(encoder.encode(line + "\n"));
    } catch {
      // Writer already closed — ignore
    }
  };

  // Run the agent loop; always close the stream when finished or on error
  runAgent(messages, scope, emit)
    .catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      emit(JSON.stringify({ type: "error", message: msg }));
    })
    .finally(() => {
      writer.close().catch(() => {});
    });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache, no-store",
      // Disable buffering on proxies so tokens stream immediately
      "X-Accel-Buffering": "no",
    },
  });
}
