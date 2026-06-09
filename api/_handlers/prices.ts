// prices.ts
// Batch-fetches bid/ask/mark for a list of option legs via OCC symbols.

import { createClient } from "@supabase/supabase-js";
import { toOCCSymbol, getValidAccessToken } from "../_schwab-utils.js";

// --- Types ---
type OptionInput = {
  underlying: string;
  expiry: string;
  strike: number;
  type: "C" | "P";
};

type OptionPrice = {
  symbol: string;
  description?: string;
  underlyingPrice?: number;
  bid?: number;
  ask?: number;
  last?: number;
  mark?: number;
};

// --- Option prices handler ---
export async function handler(req: any, res: any): Promise<void> {
  // Body is { action: "prices", options: OptionInput[] }
  const inputs: OptionInput[] = Array.isArray(req.body?.options) ? req.body.options : [];
  if (!inputs || inputs.length === 0) {
    res.status(400).json({ error: "Request must contain options array." });
    return;
  }

  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !supabaseServiceKey) {
      res.status(500).json({ error: "Server missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY." });
      return;
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const { data: tokenRow, error: tokenError } = await supabase
      .from("schwab_tokens")
      .select("access_token, refresh_token, expires_at")
      .eq("id", "default")
      .single();

    if (tokenError || !tokenRow?.access_token) {
      res.status(401).json({ error: "Not authorized with Schwab. Run the Schwab login flow again." });
      return;
    }

    const accessToken = await getValidAccessToken(supabase, tokenRow);
    if (!accessToken) {
      res.status(401).json({ error: "Schwab token expired. Run the Schwab login flow again." });
      return;
    }

    const results: Record<string, OptionPrice> = {};
    const occToOpt = new Map<string, OptionInput>();

    for (const opt of inputs) {
      const u = opt.underlying.trim().toUpperCase();
      if (!u) continue;
      const occ = toOCCSymbol(opt.underlying, opt.expiry, opt.type, opt.strike);
      occToOpt.set(occ, opt);
    }

    const allOCC = [...occToOpt.keys()];
    const underlyingSymbols = [
      ...new Set(inputs.map((o) => o.underlying?.trim().toUpperCase()).filter((s): s is string => Boolean(s))),
    ];
    const underlyingPriceBySymbol: Record<string, number> = {};

    const UNDERLYING_BATCH = 45;
    for (let i = 0; i < underlyingSymbols.length; i += UNDERLYING_BATCH) {
      const batch = underlyingSymbols.slice(i, i + UNDERLYING_BATCH);
      const uResp = await fetch(
        "https://api.schwabapi.com/marketdata/v1/quotes?" +
          new URLSearchParams({ symbols: batch.join(",") }).toString(),
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      if (!uResp.ok) continue;
      const uBody: any = await uResp.json();
      for (const sym of batch) {
        const q = uBody[sym] ?? uBody[sym.replace(/\s+/g, "")];
        const src = q?.quote ?? q;
        const px =
          typeof src?.regularMarketLast === "number" ? src.regularMarketLast :
          typeof src?.lastPrice === "number" ? src.lastPrice :
          typeof src?.last === "number" ? src.last :
          typeof src?.close === "number" ? src.close :
          typeof src?.regularMarketPrice === "number" ? src.regularMarketPrice : undefined;
        if (typeof px === "number" && Number.isFinite(px) && px > 0) underlyingPriceBySymbol[sym] = px;
      }
    }

    const BATCH = 50;
    let firstResponseBody: any = null;
    for (let i = 0; i < allOCC.length; i += BATCH) {
      const batch = allOCC.slice(i, i + BATCH);
      const resp = await fetch(
        "https://api.schwabapi.com/marketdata/v1/quotes?" +
          new URLSearchParams({ symbols: batch.join(",") }).toString(),
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      if (!resp.ok) continue;
      const body: any = await resp.json();
      if (firstResponseBody === null) firstResponseBody = body;

      const bySymbol = new Map<string, any>();
      if (body && typeof body === "object") {
        if (Array.isArray(body)) {
          for (const q of body) { if (q?.symbol) bySymbol.set(String(q.symbol).trim(), q); }
        } else if (Array.isArray(body.quotes)) {
          for (const q of body.quotes) { if (q?.symbol) bySymbol.set(String(q.symbol).trim(), q); }
        } else {
          for (const [k, v] of Object.entries(body)) { if (v && typeof v === "object") bySymbol.set(String(k).trim(), v); }
        }
      }

      for (const occ of batch) {
        const opt = occToOpt.get(occ);
        if (!opt) continue;
        const q = bySymbol.get(occ) ?? bySymbol.get(occ.replace(/\s+/g, "")) ?? body?.[occ];
        if (!q || typeof q !== "object") continue;
        const src =
          q.quote && typeof q.quote === "object" ? q.quote :
          q.optionContract && typeof q.optionContract === "object" ? q.optionContract :
          q.option && typeof q.option === "object" ? q.option : q;
        const num = (x: any): number | undefined =>
          typeof x === "number" && Number.isFinite(x) ? x : undefined;
        const bid = num(src.bidPrice) ?? num(src.bid);
        const ask = num(src.askPrice) ?? num(src.ask);
        const last = num(src.lastPrice) ?? num(src.last);
        const mark = num(src.mark) ?? num(src.markPrice);
        const id = `${opt.underlying.toUpperCase()} ${opt.expiry} ${opt.strike} ${opt.type}`;
        results[id] = {
          symbol: (q.symbol as string) ?? occ,
          description: q.description,
          underlyingPrice: underlyingPriceBySymbol[opt.underlying.toUpperCase()],
          bid, ask, last, mark,
        };
      }
    }

    const hasAnyPrices = Object.values(results).some(
      (r) => r.bid != null || r.ask != null || r.last != null || r.mark != null
    );
    const payload: Record<string, any> = { ...results };
    if (!hasAnyPrices && Object.keys(results).length > 0 && firstResponseBody) {
      const firstKey = Object.keys(firstResponseBody)[0];
      const firstQuote = firstKey ? (firstResponseBody as any)[firstKey] : null;
      payload._debug = {
        message: "No bid/ask/last/mark found; check structure below.",
        firstResponseKey: firstKey,
        firstQuoteKeys: firstQuote && typeof firstQuote === "object" ? Object.keys(firstQuote) : null,
      };
    }

    res.status(200).json(payload);
  } catch (err) {
    console.error("schwab-option-prices error", err);
    res.status(500).json({ error: "Unexpected error fetching option prices" });
  }
}
