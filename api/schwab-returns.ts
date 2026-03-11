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
    console.log("[schwab-returns] invoked", symbolsParam || "(no symbols)");
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
      .select("access_token, refresh_token, expires_at")
      .eq("id", "default")
      .single();

    if (tokenError || !tokenRow?.access_token) {
      res.status(401).json({
        error:
          "Not authorized with Schwab. Run the Schwab login flow again, then try returns.",
      });
      return;
    }

    const expiresAt = tokenRow.expires_at != null
      ? new Date(tokenRow.expires_at).getTime()
      : null;
    const now = Date.now();
    const bufferMs = 5 * 60 * 1000; // refresh 5 min before expiry
    const needsRefresh = expiresAt != null && now >= expiresAt - bufferMs;

    let accessToken = tokenRow.access_token as string;

    if (needsRefresh && tokenRow.refresh_token) {
      const clientId = process.env.SCHWAB_CLIENT_ID;
      const clientSecret = process.env.SCHWAB_CLIENT_SECRET;
      if (!clientId || !clientSecret) {
        res.status(500).json({ error: "Server missing Schwab client credentials." });
        return;
      }
      const authHeader = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
      const refreshBody = new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: tokenRow.refresh_token,
      });
      const refreshResp = await fetch("https://api.schwabapi.com/v1/oauth/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${authHeader}`,
        },
        body: refreshBody,
      });
      if (!refreshResp.ok) {
        const errText = await refreshResp.text();
        console.error("[schwab-returns] refresh failed", refreshResp.status, errText);
        res.status(401).json({
          error: "Schwab token expired. Run the Schwab login flow again.",
        });
        return;
      }
      const refreshJson: any = await refreshResp.json();
      const newExpiresIn = typeof refreshJson.expires_in === "number" ? refreshJson.expires_in : 1800;
      const newExpiresAt = new Date(now + newExpiresIn * 1000).toISOString();
      await supabase
        .from("schwab_tokens")
        .update({
          access_token: refreshJson.access_token,
          expires_at: newExpiresAt,
          ...(refreshJson.refresh_token != null && { refresh_token: refreshJson.refresh_token }),
        })
        .eq("id", "default");
      accessToken = refreshJson.access_token;
    } else if (expiresAt != null && now >= expiresAt) {
      res.status(401).json({
        error: "Schwab token expired. Run the Schwab login flow again.",
      });
      return;
    }
    const symbols = symbolsParam
      .split(/[,\s]+/)
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);

    const results: Record<string, Returns> = {};
    let had404 = false;

    for (const symbol of symbols) {
      try {
        const basePath = "https://api.schwabapi.com/marketdata/v1";
        const params = new URLSearchParams({
          symbol,
          periodType: "year",
          period: "1",
          frequencyType: "daily",
          frequency: "1",
          needExtendedHoursData: "false",
        });
        const url = `${basePath}/pricehistory?${params.toString()}`;

        const resp = await fetch(url, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });

        if (!resp.ok) {
          if (resp.status === 404) had404 = true;
          const text = await resp.text();
          console.error("[schwab-returns] pricehistory error for", symbol, resp.status, text.slice(0, 400));
          continue;
        }

        const body: any = await resp.json();
        if (symbols.indexOf(symbol) === 0) {
          console.log("[schwab-returns] first symbol response keys:", Object.keys(body || {}), "candles?", Array.isArray(body?.candles) ? body.candles.length : "n/a");
        }
        // Schwab returns { candles: [ { open, high, low, close, volume, datetime } ], ... } — we use daily closes.
        const rawCandles = body?.candles ?? body?.priceHistory ?? [];
        const candles: { close: number; datetime: number }[] = Array.isArray(rawCandles)
          ? rawCandles.map((c: any) => ({
              close: c.close ?? c.Close,
              datetime: c.datetime ?? c.date ?? c.timestamp ?? 0,
            })).filter((c: any) => c.close > 0 && c.datetime > 0)
          : [];
        if (candles.length < 2) {
          console.warn("[schwab-returns] not enough candles for", symbol, "response keys:", Object.keys(body || {}), "rawCandles length:", Array.isArray(rawCandles) ? rawCandles.length : 0);
          continue;
        }

        const sorted = candles
          .slice()
          .sort((a, b) => a.datetime - b.datetime);
        const latest = sorted[sorted.length - 1];
        const latestClose = latest.close;
        if (!latestClose || latestClose <= 0) continue;

        // Helper: percentage change from the last candle ON or BEFORE the given date
        function pctFromDate(startDate: Date): number {
          const targetMs = startDate.getTime();
          const eligible = sorted.filter((c) => c.datetime <= targetMs);
          const start = eligible.length > 0 ? eligible[eligible.length - 1] : sorted[0];
          if (!start || !start.close || start.close <= 0) return 0;
          return ((latestClose / start.close - 1) * 100);
        }

        const latestDate = new Date(latest.datetime);

        // 1D: one trading day = previous candle vs latest (avoids calendar/same-candle 0% issue)
        const oneDayPct =
          sorted.length >= 2 && sorted[sorted.length - 2].close > 0
            ? ((latestClose / sorted[sorted.length - 2].close - 1) * 100)
            : 0;

        // 1W: calendar 7 days back (use last close on or before that date)
        const oneWeekPct = pctFromDate(
          new Date(latestDate.getTime() - 7 * 24 * 60 * 60 * 1000)
        );

        // 1M, 3M, 6M, 1Y: calendar lookbacks using months/years
        const m1Date = new Date(latestDate.getTime());
        m1Date.setUTCMonth(m1Date.getUTCMonth() - 1);
        const m3Date = new Date(latestDate.getTime());
        m3Date.setUTCMonth(m3Date.getUTCMonth() - 3);
        const m6Date = new Date(latestDate.getTime());
        m6Date.setUTCMonth(m6Date.getUTCMonth() - 6);
        const y1Date = new Date(latestDate.getTime());
        y1Date.setUTCFullYear(y1Date.getUTCFullYear() - 1);

        const oneMonthPct = pctFromDate(m1Date);
        const threeMonthPct = pctFromDate(m3Date);
        const sixMonthPct = pctFromDate(m6Date);
        const oneYearPct = pctFromDate(y1Date);

        // YTD: first candle in current calendar year
        const yearStart = new Date(latest.datetime);
        yearStart.setUTCMonth(0, 1);
        yearStart.setUTCHours(0, 0, 0, 0);
        const firstThisYear =
          sorted.find((c) => c.datetime >= yearStart.getTime()) ?? sorted[0];
        const ytd =
          firstThisYear && firstThisYear.close > 0
            ? (latestClose / firstThisYear.close - 1) * 100
            : 0;

        results[symbol] = {
          "1D": oneDayPct,
          "1W": oneWeekPct,
          "1M": oneMonthPct,
          "3M": threeMonthPct,
          "6M": sixMonthPct,
          "1Y": oneYearPct,
          YTD: ytd,
        };
      } catch (innerErr) {
        // eslint-disable-next-line no-console
        console.error("schwab-returns per-symbol error", symbol, innerErr);
      }
    }

    // Refine 1D returns using Schwab quotes netPercentChange when available
    if (symbols.length > 0) {
      try {
        const quotesResp = await fetch(
          "https://api.schwabapi.com/marketdata/v1/quotes?" +
            new URLSearchParams({ symbols: symbols.join(",") }).toString(),
          {
            headers: { Authorization: `Bearer ${accessToken}` },
          }
        );
        if (quotesResp.ok) {
          const quotesBody: any = await quotesResp.json();
          for (const symbol of symbols) {
            const q = quotesBody[symbol] ?? quotesBody[symbol.replace(/\s+/g, "")];
            if (!q) continue;
            const src = q.quote && typeof q.quote === "object" ? q.quote : q;
            const pct =
              typeof src.netPercentChange === "number"
                ? src.netPercentChange * 100
                : typeof src.markPercentChange === "number"
                  ? src.markPercentChange * 100
                  : null;
            if (pct == null || !Number.isFinite(pct)) continue;
            if (results[symbol]) {
              results[symbol]["1D"] = pct;
            }
          }
        }
      } catch {
        // ignore quote refinement errors; keep candle-based 1D
      }
    }

    const isEmpty = Object.keys(results).length === 0;
    if (isEmpty) {
      const hint = had404
        ? "Schwab returned 404 for price history. In the Schwab Developer Portal, ensure your app is approved for Market Data and that Price History / historical data is enabled. If your app is in Pilot, confirm you're using the correct API base URL."
        : "No candle data from Schwab for any symbol. Token may be expired or market data restricted. Run the Schwab OAuth flow again from the deployed app (Vercel), then retry. Check Vercel function logs for each symbol.";
      res.status(200).json({
        ...results,
        _hint: hint,
      });
    } else {
      res.status(200).json(results);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("schwab-returns error", err);
    res.status(500).json({ error: "Unexpected error computing returns" });
  }
}

