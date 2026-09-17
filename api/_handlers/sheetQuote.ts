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
// Pair with: sheetBatch.ts (Refresh Data), sheetStock.ts (SCHWAB_STOCK).
// Auth: Schwab OAuth token in Supabase (same as RPG HUB). Optional SHEET_KEY env locks the endpoint.

import { createClient } from "@supabase/supabase-js";
import {
  extractSheetOptField,
  listSheetOptFields,
  resolveQuoteSymbolData,
  SHEET_OPT_FIELD_MAP,
} from "../_sheetQuoteFields.js";
import {
  fetchSchwabWithRetry,
  formatSchwabErrorMessage,
  getValidAccessToken,
} from "../_schwab-utils.js";

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
        error: `field is required. Valid: ${listSheetOptFields().join(", ")}`,
      });
      return;
    }

    if (!SHEET_OPT_FIELD_MAP[fieldRaw]) {
      res.status(400).json({
        error: `Unknown field "${fieldRaw}". Valid: ${listSheetOptFields().join(", ")}`,
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

    const schwabResp = await fetchSchwabWithRetry(
      "https://api.schwabapi.com/marketdata/v1/quotes?" +
        new URLSearchParams({ symbols: symbol, fields: "quote,reference" }).toString(),
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );

    if (!schwabResp.ok) {
      const errText = await schwabResp.text();
      const clientStatus = schwabResp.status >= 500 ? 503 : schwabResp.status;
      res.status(clientStatus).json({ error: formatSchwabErrorMessage(schwabResp.status, errText) });
      return;
    }

    const data: any = await schwabResp.json();
    const symbolData = resolveQuoteSymbolData(data, symbol);
    if (!symbolData || symbolData.assetMainType === undefined) {
      res.status(404).json({ error: `Symbol "${symbol}" not found or returned no data.` });
      return;
    }

    const value = extractSheetOptField(symbolData, fieldRaw);

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
