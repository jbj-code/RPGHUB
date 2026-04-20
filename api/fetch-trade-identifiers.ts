// Fetches FIGI (per-contract) and CUSIP for a specific option trade via OpenFIGI.
// POST body: { ticker: string; expiry: string; strike: number; putCall: "Put" | "Call" }
// Returns:   { figi: string | null; cusip: string | null }

export default async function handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

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
      headers: {
        "Content-Type": "application/json",
        "X-OPENFIGI-APIKEY": apiKey,
      },
      body: JSON.stringify([
        {
          idType: "TICKER",
          idValue: String(ticker).trim().toUpperCase(),
          exchCode: "US",
          securityType2: putCall === "Call" ? "Call" : "Put",
          strike: Number(strike),
          expiration: String(expiry),
        },
      ]),
    });

    if (!figiResp.ok) {
      const errText = await figiResp.text().catch(() => "");
      res.status(502).json({ error: `OpenFIGI error ${figiResp.status}: ${errText}` });
      return;
    }

    const body: any[] = await figiResp.json();
    // Response is an array with one entry (one per request item).
    const matches: any[] = body?.[0]?.data ?? [];

    if (matches.length === 0) {
      res.status(200).json({ figi: null, cusip: null, message: "No match found in OpenFIGI for these contract details." });
      return;
    }

    // OpenFIGI may return several series (e.g. weekly vs monthly). Pick the best match:
    // prefer the one whose securityDescription contains the expiry year and strike.
    const strikeStr = String(Number(strike));
    const expiryYear = String(expiry).slice(2, 4); // "26" from "2026-07-17"
    const scored = matches.map((m: any) => {
      const desc: string = (m.securityDescription ?? "").toUpperCase();
      let score = 0;
      if (desc.includes(strikeStr)) score += 2;
      if (desc.includes(expiryYear)) score += 1;
      return { ...m, _score: score };
    });
    scored.sort((a: any, b: any) => b._score - a._score);
    const best = scored[0];

    const figi = typeof best.figi === "string" && best.figi.length > 0 ? best.figi : null;
    // OpenFIGI does not return CUSIP in the mapping response; FIGI is the identifier it provides.
    // The underlying equity CUSIP is surfaced separately via Schwab reference data.
    res.status(200).json({ figi, cusip: null });
  } catch (err) {
    console.error("fetch-trade-identifiers error", err);
    res.status(500).json({ error: "Unexpected error calling OpenFIGI." });
  }
}
