// Vercel serverless: compute simple percentage returns for multiple symbols
// using Schwab Market Data PriceHistory, then return a compact map suitable
// for the Stock Comparison page.

import { createClient } from "@supabase/supabase-js";

type Returns = {
  "1D": number;
  "1W": number;
  "1M": number;
  "3M": number;
  "6M": number;
  "1Y": number;
  YTD: number;
};

export default async function handler(req: any, res: any) {
  // Allow calls from the Vite dev server (localhost) as well as production.
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  try {
    const symbolsParam = req.query.symbols as string | undefined;
    if (!symbolsParam) {
      res.status(400).json({
        error: "symbols query parameter is required, e.g. ?symbols=SPY,QQQ",
      });
      return;
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !supabaseServiceKey) {
      res.status(500).json({
        error: "Server missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.",
      });
      return;
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const { data: tokenRow, error: tokenError } = await supabase
      .from("schwab_tokens")
      .select("access_token, expires_at")
      .eq("id", "default")
      .single();

    if (tokenError || !tokenRow?.access_token) {
      res.status(401).json({
        error:
          "Not authorized with Schwab. Run the Schwab login flow again, then try returns.",
      });
      return;
    }

    const expiresAt = tokenRow.expires_at
      ? new Date(tokenRow.expires_at).getTime()
      : 0;
    if (Date.now() >= expiresAt) {
      res.status(401).json({
        error: "Schwab token expired. Run the Schwab login flow again.",
      });
      return;
    }

    const accessToken = tokenRow.access_token as string;
    const symbols = symbolsParam
      .split(/[,\s]+/)
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);

    const results: Record<string, Returns> = {};

    for (const symbol of symbols) {
      try {
        const url =
          "https://api.schwabapi.com/marketdata/v1/pricehistory/" +
          encodeURIComponent(symbol) +
          "?" +
          new URLSearchParams({
            periodType: "year",
            period: "1",
            frequencyType: "daily",
            frequency: "1",
            needExtendedHoursData: "false",
          }).toString();

        const resp = await fetch(url, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });

        if (!resp.ok) {
          // Skip this symbol on failure, but log for debugging.
          const text = await resp.text();
          // eslint-disable-next-line no-console
          console.error("pricehistory error for", symbol, text);
          continue;
        }

        const body: any = await resp.json();
        const candles: { close: number; datetime: number }[] =
          body?.candles ?? [];
        if (!Array.isArray(candles) || candles.length < 2) continue;

        const sorted = candles
          .slice()
          .sort((a, b) => a.datetime - b.datetime);
        const latest = sorted[sorted.length - 1];
        const latestClose = latest.close;
        if (!latestClose || latestClose <= 0) continue;

        function pctChange(daysBack: number): number {
          const idx = Math.max(sorted.length - 1 - daysBack, 0);
          const past = sorted[idx];
          if (!past || !past.close || past.close <= 0) return 0;
          return ((latestClose / past.close - 1) * 100);
        }

        // Approximate trading-day offsets.
        const oneDay = 1;
        const oneWeek = 5;
        const oneMonth = 21;
        const threeMonths = 63;
        const sixMonths = 126;
        const oneYear = Math.min(sorted.length - 1, 252);

        // YTD: find first candle in current calendar year.
        const yearStart = new Date(latest.datetime);
        yearStart.setUTCMonth(0, 1);
        yearStart.setUTCHours(0, 0, 0, 0);
        const firstThisYear =
          sorted.find((c) => c.datetime >= yearStart.getTime()) ??
          sorted[0];
        const ytd =
          firstThisYear && firstThisYear.close > 0
            ? ((latestClose / firstThisYear.close - 1) * 100)
            : 0;

        results[symbol] = {
          "1D": pctChange(oneDay),
          "1W": pctChange(oneWeek),
          "1M": pctChange(oneMonth),
          "3M": pctChange(threeMonths),
          "6M": pctChange(sixMonths),
          "1Y": pctChange(oneYear),
          YTD: ytd,
        };
      } catch (innerErr) {
        // eslint-disable-next-line no-console
        console.error("schwab-returns per-symbol error", symbol, innerErr);
      }
    }

    res.status(200).json(results);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("schwab-returns error", err);
    res.status(500).json({ error: "Unexpected error computing returns" });
  }
}

