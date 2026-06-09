// sheetQuote.ts
// Backend for Google Sheets SCHWAB_OPT() — returns one live option field per request.
//
// Apps Script calls:
//   GET https://therpghub.vercel.app/api/schwab?action=sheetQuote&symbol=<OCC>&field=<name>[&key=<SHEET_KEY>]
//
// Contract (must stay stable for Sheets):
//   - Success: { value: number | string | null }
//   - Failure: { error: string }  → Apps Script surfaces as "ERR: …"
//
// Pair with: sheetStock.ts (SCHWAB_STOCK). SCHWAB_OCC() is built client-side in Apps Script only.
// Auth: Schwab OAuth token in Supabase (same as RPG HUB). Optional SHEET_KEY env locks the endpoint.

import { createClient } from "@supabase/supabase-js";
import { getValidAccessToken } from "../_schwab-utils.js";

type FieldDef =
  | { src: "quote" | "reference"; key: string }
  | { src: "computed"; fn: (quote: any, ref: any) => any };

/** Fields accepted by SCHWAB_OPT(symbol, field) — case-insensitive. */
const FIELD_MAP: Record<string, FieldDef> = {
  bid:           { src: "quote",     key: "bidPrice" },
  ask:           { src: "quote",     key: "askPrice" },
  mark:          { src: "quote",     key: "mark" },
  mid:           { src: "quote",     key: "mark" },
  last:          { src: "quote",     key: "lastPrice" },
  open:          { src: "quote",     key: "openPrice" },
  high:          { src: "quote",     key: "highPrice" },
  low:           { src: "quote",     key: "lowPrice" },
  close:         { src: "quote",     key: "closePrice" },
  theoretical:   { src: "quote",     key: "theoreticalOptionValue" },
  underlying:    { src: "quote",     key: "underlyingPrice" },
  bidsize:       { src: "quote",     key: "bidSize" },
  asksize:       { src: "quote",     key: "askSize" },
  lastsize:      { src: "quote",     key: "lastSize" },
  oi:            { src: "quote",     key: "openInterest" },
  openinterest:  { src: "quote",     key: "openInterest" },
  volume:        { src: "quote",     key: "totalVolume" },
  iv:            { src: "quote",     key: "volatility" },
  delta:         { src: "quote",     key: "delta" },
  gamma:         { src: "quote",     key: "gamma" },
  theta:         { src: "quote",     key: "theta" },
  vega:          { src: "quote",     key: "vega" },
  rho:           { src: "quote",     key: "rho" },
  intrinsic:     { src: "quote",     key: "moneyIntrinsicValue" },
  timevalue:     { src: "quote",     key: "timeValue" },
  netchange:     { src: "quote",     key: "netChange" },
  pctchange:     { src: "quote",     key: "netPercentChange" },
  markchange:    { src: "quote",     key: "markChange" },
  markpct:       { src: "quote",     key: "markPercentChange" },
  strike:        { src: "reference", key: "strikePrice" },
  dte:           { src: "reference", key: "daysToExpiration" },
  type:          { src: "reference", key: "contractType" },
  exptype:       { src: "reference", key: "expirationType" },
  settlement:    { src: "reference", key: "settlementType" },
  multiplier:    { src: "reference", key: "multiplier" },
  spread:        { src: "computed",  fn: (q) => round4((q?.askPrice ?? 0) - (q?.bidPrice ?? 0)) },
  limit:         { src: "computed",  fn: (q) => q?.mark ?? round4(((q?.bidPrice ?? 0) + (q?.askPrice ?? 0)) / 2) },
};

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function resolveSymbolData(data: Record<string, unknown>, symbol: string): any | null {
  const direct = data[symbol];
  if (direct && typeof direct === "object") return direct;
  const keys = Object.keys(data);
  if (keys.length === 0) return null;
  const normalized = symbol.replace(/\s+/g, "");
  for (const key of keys) {
    if (key.replace(/\s+/g, "") === normalized) return data[key];
  }
  return data[keys[0]];
}

export async function handler(req: any, res: any): Promise<void> {
  try {
    const sheetKey = process.env.SHEET_KEY;
    if (sheetKey && req.query.key !== sheetKey) {
      res.status(401).json({ error: "Invalid or missing key." });
      return;
    }

    const symbol = (req.query.symbol as string | undefined)?.trim().toUpperCase();
    const fieldRaw = (req.query.field as string | undefined)?.trim().toLowerCase();

    if (!symbol) {
      res.status(400).json({
        error: "symbol is required. Example: ?symbol=SPY   250117C00450000&field=bid",
      });
      return;
    }
    if (!fieldRaw) {
      res.status(400).json({
        error: `field is required. Valid: ${Object.keys(FIELD_MAP).join(", ")}`,
      });
      return;
    }

    const fieldDef = FIELD_MAP[fieldRaw];
    if (!fieldDef) {
      res.status(400).json({
        error: `Unknown field "${fieldRaw}". Valid: ${Object.keys(FIELD_MAP).join(", ")}`,
      });
      return;
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !supabaseServiceKey) {
      res.status(500).json({ error: "Server missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY." });
      return;
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const { data: tokenRow, error } = await supabase
      .from("schwab_tokens")
      .select("access_token, refresh_token, expires_at")
      .eq("id", "default")
      .single();

    if (error || !tokenRow?.access_token) {
      res.status(401).json({ error: "Not authorized with Schwab. Re-authenticate via RPG HUB." });
      return;
    }

    const accessToken = await getValidAccessToken(supabase, tokenRow);
    if (!accessToken) {
      res.status(401).json({ error: "Schwab token expired. Re-authenticate via RPG HUB." });
      return;
    }

    const schwabResp = await fetch(
      "https://api.schwabapi.com/marketdata/v1/quotes?" +
        new URLSearchParams({ symbols: symbol }).toString(),
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    if (!schwabResp.ok) {
      const errText = await schwabResp.text();
      res.status(schwabResp.status).json({ error: `Schwab error: ${errText}` });
      return;
    }

    const data: any = await schwabResp.json();
    const symbolData = resolveSymbolData(data, symbol);
    if (!symbolData || symbolData.assetMainType === undefined) {
      res.status(404).json({ error: `Symbol "${symbol}" not found or returned no data.` });
      return;
    }

    const quoteObj = symbolData.quote;
    const refObj = symbolData.reference;

    let value: any;
    if (fieldDef.src === "computed") {
      value = (fieldDef as { src: "computed"; fn: (quote: any, ref: any) => any }).fn(quoteObj, refObj);
    } else if (fieldDef.src === "quote") {
      value = quoteObj?.[(fieldDef as { src: "quote"; key: string }).key];
    } else {
      value = refObj?.[(fieldDef as { src: "reference"; key: string }).key];
    }

    if (value === undefined || value === null) {
      res.status(200).json({ value: null, note: `Field "${fieldRaw}" is null for this symbol.` });
      return;
    }

    res.status(200).json({ value });
  } catch (err) {
    console.error("sheetQuote error", err);
    res.status(500).json({ error: "Unexpected error in sheetQuote." });
  }
}
