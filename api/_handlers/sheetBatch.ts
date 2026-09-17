// sheetBatch.ts
// Batch option quotes for Google Sheets Refresh Data — one Schwab /quotes call per chunk.
//
// Apps Script calls:
//   GET  ...?action=sheetBatch&symbols=OCC1,OCC2&fields=mid,bid&key=...
//   POST ...?action=sheetBatch  body: { symbols: ["OCC1", ...], fields: ["mid"] }
//
// Response: { values: { "OCC1": { mid: 1.23 }, ... }, errors: { "OCCx": "reason" } }

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

const QUOTE_BATCH_SIZE = 50;
const MAX_SYMBOLS = 200;

function parseSymbolList(req: any): string[] {
  const fromQuery = (req.query.symbols as string | undefined)?.trim();
  const fromBody = req.body?.symbols;
  const raw: string[] = [];

  if (fromQuery) raw.push(...fromQuery.split(","));
  if (Array.isArray(fromBody)) raw.push(...fromBody.map(String));

  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of raw) {
    const sym = String(s).trim().toUpperCase();
    if (!sym || seen.has(sym)) continue;
    seen.add(sym);
    out.push(sym);
    if (out.length >= MAX_SYMBOLS) break;
  }
  return out;
}

function parseFieldList(req: any): string[] {
  const fromQuery = (req.query.fields as string | undefined)?.trim();
  const fromBody = req.body?.fields;
  const raw: string[] = [];

  if (fromQuery) raw.push(...fromQuery.split(","));
  if (Array.isArray(fromBody)) raw.push(...fromBody.map(String));

  const out: string[] = [];
  const seen = new Set<string>();
  for (const f of raw) {
    const field = String(f).trim().toLowerCase();
    if (!field || seen.has(field) || !SHEET_OPT_FIELD_MAP[field]) continue;
    seen.add(field);
    out.push(field);
  }
  return out;
}

export async function handler(req: any, res: any): Promise<void> {
  try {
    const sheetKey = process.env.SHEET_KEY;
    if (sheetKey && req.query.key !== sheetKey) {
      res.status(401).json({ error: "Invalid or missing key." });
      return;
    }

    const symbols = parseSymbolList(req);
    const fields = parseFieldList(req);

    if (symbols.length === 0) {
      res.status(400).json({ error: "symbols is required (comma-separated OCC symbols or JSON array)." });
      return;
    }
    if (fields.length === 0) {
      res.status(400).json({
        error: `fields is required. Valid: ${listSheetOptFields().join(", ")}`,
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

    const values: Record<string, Record<string, unknown>> = {};
    const errors: Record<string, string> = {};

    for (let i = 0; i < symbols.length; i += QUOTE_BATCH_SIZE) {
      const batch = symbols.slice(i, i + QUOTE_BATCH_SIZE);
      const schwabResp = await fetchSchwabWithRetry(
        "https://api.schwabapi.com/marketdata/v1/quotes?" +
          new URLSearchParams({ symbols: batch.join(","), fields: "quote,reference" }).toString(),
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );

      if (!schwabResp.ok) {
        const errText = await schwabResp.text();
        const msg = formatSchwabErrorMessage(schwabResp.status, errText);
        for (const sym of batch) errors[sym] = msg;
        continue;
      }

      const data = (await schwabResp.json()) as Record<string, unknown>;

      for (const sym of batch) {
        const symbolData = resolveQuoteSymbolData(data, sym);
        if (!symbolData || symbolData.assetMainType === undefined) {
          errors[sym] = `Symbol "${sym}" not found or returned no data.`;
          continue;
        }

        const row: Record<string, unknown> = {};
        for (const field of fields) {
          const value = extractSheetOptField(symbolData, field);
          if (value !== undefined && value !== null) row[field] = value;
        }

        if (Object.keys(row).length === 0) {
          errors[sym] = "No requested fields returned data for this symbol.";
        } else {
          values[sym] = row;
        }
      }
    }

    res.status(200).json({
      values,
      errors,
      symbolCount: symbols.length,
      fieldCount: fields.length,
    });
  } catch (err) {
    console.error("sheetBatch error", err);
    res.status(500).json({ error: "Unexpected error in sheetBatch." });
  }
}
