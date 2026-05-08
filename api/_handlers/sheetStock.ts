import { createClient } from "@supabase/supabase-js";
import { getValidAccessToken } from "../_schwab-utils.js";

/**
 * Sheet-friendly endpoint for underlying stock analytics.
 * GET /api/schwab?action=sheetStock&symbol=<TICKER>&field=<name>[&key=<SHEET_KEY>]
 *
 * Returns: { value: number | null }
 *
 * Supported fields:
 *   beta    — Beta vs S&P 500 (from Schwab fundamentals)
 *   rv30    — 30-day annualized realized volatility (%) computed from daily closes
 *   rv90    — 90-day annualized realized volatility (%) computed from daily closes
 *   iv30    — ~30-day ATM implied volatility (%) from nearest option chain expiration
 *   iv90    — ~90-day ATM implied volatility (%) from nearest option chain expiration
 *   ivrv30  — iv30 minus rv30 (volatility premium)
 *   ivrv90  — iv90 minus rv90 (volatility premium)
 */

const VALID_FIELDS = ["beta", "rv30", "rv90", "iv30", "iv90", "ivrv30", "ivrv90"];

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
      res.status(400).json({ error: "symbol is required (e.g. ?symbol=SPY&field=rv30)" });
      return;
    }
    if (!fieldRaw || !VALID_FIELDS.includes(fieldRaw)) {
      res.status(400).json({ error: `field is required. Valid: ${VALID_FIELDS.join(", ")}` });
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

    const token = await getValidAccessToken(supabase, tokenRow);
    if (!token) {
      res.status(401).json({ error: "Schwab token expired. Re-authenticate via RPG HUB." });
      return;
    }

    let value: number | null = null;

    switch (fieldRaw) {
      case "beta":
        value = await fetchBeta(symbol, token);
        break;
      case "rv30":
        value = await fetchRV(symbol, 30, token);
        break;
      case "rv90":
        value = await fetchRV(symbol, 90, token);
        break;
      case "iv30":
        value = await fetchIV(symbol, 30, token);
        break;
      case "iv90":
        value = await fetchIV(symbol, 90, token);
        break;
      case "ivrv30": {
        const [iv, rv] = await Promise.all([fetchIV(symbol, 30, token), fetchRV(symbol, 30, token)]);
        value = iv !== null && rv !== null ? round2(iv - rv) : null;
        break;
      }
      case "ivrv90": {
        const [iv, rv] = await Promise.all([fetchIV(symbol, 90, token), fetchRV(symbol, 90, token)]);
        value = iv !== null && rv !== null ? round2(iv - rv) : null;
        break;
      }
    }

    res.status(200).json({ value });
  } catch (err) {
    console.error("sheetStock error", err);
    res.status(500).json({ error: "Unexpected error in sheetStock." });
  }
}

// ─── Beta ────────────────────────────────────────────────────────────────────

async function fetchBeta(symbol: string, token: string): Promise<number | null> {
  const resp = await fetch(
    "https://api.schwabapi.com/marketdata/v1/instruments?" +
      new URLSearchParams({ symbol, projection: "fundamental" }).toString(),
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!resp.ok) return null;
  const data: any = await resp.json();
  // Schwab returns { instruments: [...] } or a bare array depending on version.
  const instruments: any[] = data.instruments ?? (Array.isArray(data) ? data : []);
  return instruments[0]?.fundamental?.beta ?? null;
}

// ─── Realized Volatility ──────────────────────────────────────────────────────

async function fetchRV(symbol: string, tradingDays: number, token: string): Promise<number | null> {
  // We need tradingDays + 1 closes to compute tradingDays log returns.
  // Each calendar month has ~21 trading days, so we request enough months.
  const monthsNeeded = Math.ceil((tradingDays + 5) / 21) + 1;

  const resp = await fetch(
    "https://api.schwabapi.com/marketdata/v1/pricehistory?" +
      new URLSearchParams({
        symbol,
        periodType: "month",
        period: String(monthsNeeded),
        frequencyType: "daily",
        frequency: "1",
        needExtendedHoursData: "false",
      }).toString(),
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!resp.ok) return null;
  const data: any = await resp.json();

  const candles: any[] = data.candles ?? [];
  if (candles.length < tradingDays + 1) return null;

  // Take the most recent tradingDays + 1 closes.
  const closes = candles.slice(-(tradingDays + 1)).map((c: any) => c.close as number);
  return round2(annualizedRV(closes));
}

function annualizedRV(closes: number[]): number {
  const logReturns: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    logReturns.push(Math.log(closes[i]! / closes[i - 1]!));
  }
  const mean = logReturns.reduce((a, b) => a + b, 0) / logReturns.length;
  const variance =
    logReturns.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / (logReturns.length - 1);
  return Math.sqrt(variance * 252) * 100; // annualized, as a percentage
}

// ─── Implied Volatility at target DTE ────────────────────────────────────────

async function fetchIV(symbol: string, targetDte: number, token: string): Promise<number | null> {
  const today = new Date();
  const fromDate = offsetDate(today, targetDte - 10);
  const toDate = offsetDate(today, targetDte + 10);
  const fmt = (d: Date) => d.toISOString().split("T")[0];

  const resp = await fetch(
    "https://api.schwabapi.com/marketdata/v1/chains?" +
      new URLSearchParams({
        symbol,
        contractType: "CALL",
        strikeCount: "5",  // 5 NTM strikes — enough to get a good ATM IV sample
        range: "NTM",
        fromDate: fmt(fromDate),
        toDate: fmt(toDate),
      }).toString(),
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!resp.ok) return null;
  const data: any = await resp.json();
  if (data.status !== "SUCCESS") return null;

  const expDateMap: Record<string, Record<string, any[]>> = data.callExpDateMap ?? {};
  if (Object.keys(expDateMap).length === 0) return null;

  // Keys are "YYYY-MM-DD:DTE" — find the expiration closest to targetDte.
  let bestKey: string | null = null;
  let bestDiff = Infinity;
  for (const key of Object.keys(expDateMap)) {
    const dte = parseInt(key.split(":")[1] ?? "9999", 10);
    const diff = Math.abs(dte - targetDte);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestKey = key;
    }
  }
  if (!bestKey) return null;

  // Collect all IVs from that expiration's NTM strikes.
  const ivValues: number[] = [];
  for (const contracts of Object.values(expDateMap[bestKey]!)) {
    for (const contract of contracts) {
      if (typeof contract.volatility === "number" && contract.volatility > 0) {
        ivValues.push(contract.volatility);
      }
    }
  }
  if (ivValues.length === 0) return null;

  const avgIV = ivValues.reduce((a, b) => a + b, 0) / ivValues.length;
  return round2(avgIV);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function offsetDate(base: Date, days: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
