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

export async function handler(req: any, res: any): Promise<void> {
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
    const occSymbol = buildOccSymbol(
      String(ticker).trim().toUpperCase(),
      String(expiry),
      Number(strike),
      putCall === "Call" ? "C" : "P"
    );
    const figiResp = await fetch("https://api.openfigi.com/v3/mapping", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-OPENFIGI-APIKEY": apiKey },
      body: JSON.stringify([{ idType: "OCC_SYMBOL", idValue: occSymbol, exchCode: "US" }]),
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
    console.error("schwab figi error", err);
    res.status(500).json({ error: "Unexpected error calling OpenFIGI." });
  }
}
