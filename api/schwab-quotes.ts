// Vercel serverless: dual-purpose endpoint.
//   GET  ?symbols=...  — proxy to Schwab Market Data /quotes
//   POST { ticker, expiry, strike, putCall }  — fetch per-contract FIGI via OpenFIGI

import { createClient } from "@supabase/supabase-js";
import { getValidAccessToken } from "./_schwab-utils.js";

export default async function handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }

  // ── POST: OpenFIGI per-contract FIGI lookup ──────────────────────────────
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
      const figiResp = await fetch("https://api.openfigi.com/v3/mapping", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-OPENFIGI-APIKEY": apiKey },
        body: JSON.stringify([{
          idType: "TICKER",
          idValue: String(ticker).trim().toUpperCase(),
          exchCode: "US",
          securityType2: putCall === "Call" ? "Call" : "Put",
          strike: Number(strike),
          expiration: String(expiry),
        }]),
      });
      if (!figiResp.ok) {
        const errText = await figiResp.text().catch(() => "");
        res.status(502).json({ error: `OpenFIGI error ${figiResp.status}: ${errText}` });
        return;
      }
      const body: any[] = await figiResp.json();
      const matches: any[] = body?.[0]?.data ?? [];
      if (matches.length === 0) {
        res.status(200).json({ figi: null, cusip: null, message: "No match found in OpenFIGI." });
        return;
      }
      // Pick best match: prefer description containing the strike and expiry year.
      const strikeStr = String(Number(strike));
      const expiryYear = String(expiry).slice(2, 4);
      const scored = matches.map((m: any) => {
        const desc: string = (m.securityDescription ?? "").toUpperCase();
        return { ...m, _score: (desc.includes(strikeStr) ? 2 : 0) + (desc.includes(expiryYear) ? 1 : 0) };
      });
      scored.sort((a: any, b: any) => b._score - a._score);
      const best = scored[0];
      const figi = typeof best.figi === "string" && best.figi.length > 0 ? best.figi : null;
      res.status(200).json({ figi, cusip: null });
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
