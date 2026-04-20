// Vercel serverless: dual-purpose endpoint.
//   GET  ?symbols=...  — proxy to Schwab Market Data /quotes
//   POST { ticker, expiry, strike, putCall }  — fetch per-contract FIGI via OpenFIGI

import { createClient } from "@supabase/supabase-js";
import { getValidAccessToken } from "./_schwab-utils.js";

/**
 * Builds a 21-character OCC option symbol.
 * Format: TTTTTT YYMMDD C/P SSSSSSSS
 *   TTTTTT  — ticker left-justified, space-padded to 6 chars
 *   YYMMDD  — expiry (expiry arg must be YYYY-MM-DD)
 *   C or P  — call/put
 *   SSSSSSSS — strike * 1000, zero-padded to 8 digits
 * Example: SPY $674 Call 2025-11-06 → "SPY   251106C00674000"
 */
function buildOccSymbol(ticker: string, expiry: string, strike: number, cp: "C" | "P"): string {
  const tickerPadded = ticker.slice(0, 6).padEnd(6, " ");
  const [yyyy, mm, dd] = expiry.split("-");
  const yy = yyyy.slice(2);
  const strikeStr = Math.round(strike * 1000).toString().padStart(8, "0");
  return `${tickerPadded}${yy}${mm}${dd}${cp}${strikeStr}`;
}

export default async function handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }

  // ── POST: OpenFIGI per-contract FIGI lookup via OCC symbol ───────────────
  if (req.method === "POST") {
    const { ticker, expiry, strike, putCall } = req.body ?? {};
    if (!ticker || !expiry || strike == null || !putCall) {
      res.status(400).json({ error: "Missing required fields: ticker, expiry, strike, putCall" });
      return;
    }
    const apiKey = process.env.OPENFIGI_API_KEY;
    if (!apiKey) {
      res.status(500).json({ error: "OPENFIGI_API_KEY not configured on server." });
      return;
    }
    try {
      // Build the OCC 21-char option symbol, e.g. "SPY   251106C00674000"
      // expiry is YYYY-MM-DD from Schwab
      const occSymbol = buildOccSymbol(
        String(ticker).trim().toUpperCase(),
        String(expiry),
        Number(strike),
        putCall === "Call" ? "C" : "P"
      );
      const figiResp = await fetch("https://api.openfigi.com/v3/mapping", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-OPENFIGI-APIKEY": apiKey },
        body: JSON.stringify([{ idType: "OCC_SYMBOL", idValue: occSymbol }]),
      });
      if (!figiResp.ok) {
        const errText = await figiResp.text().catch(() => "");
        res.status(502).json({ error: `OpenFIGI error ${figiResp.status}: ${errText}` });
        return;
      }
      const body: any[] = await figiResp.json();
      const matches: any[] = body?.[0]?.data ?? [];
      if (matches.length === 0) {
        res.status(200).json({ figi: null, cusip: null, occSymbol, message: `No match found in OpenFIGI for OCC symbol: ${occSymbol}` });
        return;
      }
      const best = matches[0];
      const figi = typeof best.figi === "string" && best.figi.length > 0 ? best.figi : null;
      res.status(200).json({ figi, cusip: null, occSymbol });
    } catch (err) {
      console.error("schwab-quotes FIGI error", err);
      res.status(500).json({ error: "Unexpected error calling OpenFIGI." });
    }
    return;
  }

  // ── GET: Schwab /quotes proxy ─────────────────────────────────────────────
  if (req.method !== "GET") { res.status(405).json({ error: "Method not allowed" }); return; }

  try {
    const symbols = req.query.symbols as string | undefined;
    if (!symbols) {
      res.status(400).json({ error: "symbols query parameter is required, e.g. ?symbols=SPY,QQQ" });
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
      res.status(401).json({ error: "Not authorized with Schwab. Run the Schwab login flow again, then try quotes." });
      return;
    }

    const accessToken = await getValidAccessToken(supabase, tokenRow);
    if (!accessToken) {
      res.status(401).json({ error: "Schwab token expired. Run the Schwab login flow again." });
      return;
    }

    const resp = await fetch(
      "https://api.schwabapi.com/marketdata/v1/quotes?" + new URLSearchParams({ symbols }).toString(),
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const text = await resp.text();
    res.status(resp.status).setHeader("Content-Type", "application/json").send(text);
  } catch (err) {
    console.error("schwab-quotes error", err);
    res.status(500).json({ error: "Unexpected error calling Schwab /quotes" });
  }
}
