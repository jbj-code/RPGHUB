import { createClient } from "@supabase/supabase-js";
import { getValidAccessToken } from "../_schwab-utils.js";

/**
 * Sheet-friendly Schwab quote endpoint.
 * GET /api/schwab?action=sheetQuote&symbol=<OCC>&field=<name>[&key=<SHEET_KEY>]
 *
 * Returns: { value: number | string | null }
 *
 * All supported fields (case-insensitive) — see FIELD_MAP below.
 */

type FieldDef =
  | { src: "quote" | "reference"; key: string }
  | { src: "computed"; fn: (quote: any, ref: any) => any };

const FIELD_MAP: Record<string, FieldDef> = {
  // ── Pricing ──────────────────────────────────────────────────────────────
  bid:           { src: "quote",     key: "bidPrice" },
  ask:           { src: "quote",     key: "askPrice" },
  mark:          { src: "quote",     key: "mark" },
  mid:           { src: "quote",     key: "mark" },
  last:          { src: "quote",     key: "lastPrice" },
  open:          { src: "quote",     key: "openPrice" },
  high:          { src: "quote",     key: "highPrice" },
  low:           { src: "quote",     key: "lowPrice" },
  close:         { src: "quote",     key: "closePrice" },     // previous day close
  theoretical:   { src: "quote",     key: "theoreticalOptionValue" },
  underlying:    { src: "quote",     key: "underlyingPrice" }, // underlying stock price
  // ── Size / liquidity ─────────────────────────────────────────────────────
  bidsize:       { src: "quote",     key: "bidSize" },
  asksize:       { src: "quote",     key: "askSize" },
  lastsize:      { src: "quote",     key: "lastSize" },
  oi:            { src: "quote",     key: "openInterest" },
  openinterest:  { src: "quote",     key: "openInterest" },
  volume:        { src: "quote",     key: "totalVolume" },
  // ── Greeks ───────────────────────────────────────────────────────────────
  iv:            { src: "quote",     key: "volatility" },
  delta:         { src: "quote",     key: "delta" },
  gamma:         { src: "quote",     key: "gamma" },
  theta:         { src: "quote",     key: "theta" },
  vega:          { src: "quote",     key: "vega" },
  rho:           { src: "quote",     key: "rho" },
  // ── Value breakdown ──────────────────────────────────────────────────────
  intrinsic:     { src: "quote",     key: "moneyIntrinsicValue" },
  timevalue:     { src: "quote",     key: "timeValue" },
  // ── Change ───────────────────────────────────────────────────────────────
  netchange:     { src: "quote",     key: "netChange" },
  pctchange:     { src: "quote",     key: "netPercentChange" },
  markchange:    { src: "quote",     key: "markChange" },
  markpct:       { src: "quote",     key: "markPercentChange" },
  // ── Contract metadata (from reference object) ────────────────────────────
  strike:        { src: "reference", key: "strikePrice" },
  dte:           { src: "reference", key: "daysToExpiration" },
  type:          { src: "reference", key: "contractType" },      // CALL or PUT
  exptype:       { src: "reference", key: "expirationType" },    // W M Q S
  settlement:    { src: "reference", key: "settlementType" },    // A (AM) or P (PM)
  multiplier:    { src: "reference", key: "multiplier" },        // usually 100
  // ── Computed ─────────────────────────────────────────────────────────────
  spread:        { src: "computed",  fn: (q) => round4((q?.askPrice ?? 0) - (q?.bidPrice ?? 0)) },
  limit:         { src: "computed",  fn: (q) => q?.mark ?? round4(((q?.bidPrice ?? 0) + (q?.askPrice ?? 0)) / 2) },
};

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

export async function handler(req: any, res: any): Promise<void> {
  try {
    // Optional shared secret — set SHEET_KEY in Vercel env vars to lock the endpoint.
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

    // Schwab keys the response by the symbol — try exact match first, then first key.
    const symbolData: any = data[symbol] ?? data[Object.keys(data)[0]];
    if (!symbolData || symbolData.assetMainType === undefined) {
      res.status(404).json({ error: `Symbol "${symbol}" not found or returned no data.` });
      return;
    }

    const quoteObj = symbolData.quote;
    const refObj   = symbolData.reference;

    let value: any;
    if (fieldDef.src === "computed") {
      value = (fieldDef as any).fn(quoteObj, refObj);
    } else if (fieldDef.src === "quote") {
      value = quoteObj?.[(fieldDef as any).key];
    } else {
      value = refObj?.[(fieldDef as any).key];
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
