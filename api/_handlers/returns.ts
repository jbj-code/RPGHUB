// returns.ts
// Computes multi-horizon price returns (1D–YTD) from Schwab price history + live quotes.

import { createClient } from "@supabase/supabase-js";
import { getValidAccessToken } from "../_schwab-utils.js";

// --- Types ---
type Returns = {
  "1D": number;
  "1W": number;
  "1M": number;
  "3M": number;
  "6M": number;
  "1Y": number;
  YTD: number;
  price?: number;
};

// --- Returns computation handler ---
export async function handler(req: any, res: any): Promise<void> {
  try {
    const symbolsParam = req.query.symbols as string | undefined;
    if (!symbolsParam) {
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
    const { data: tokenRow, error: tokenError } = await supabase
      .from("schwab_tokens")
      .select("access_token, refresh_token, expires_at")
      .eq("id", "default")
      .single();

    if (tokenError || !tokenRow?.access_token) {
      res.status(401).json({ error: "Not authorized with Schwab. Run the Schwab login flow again." });
      return;
    }

    const accessToken = await getValidAccessToken(supabase, tokenRow);
    if (!accessToken) {
      res.status(401).json({ error: "Schwab token expired. Run the Schwab login flow again." });
      return;
    }

    const symbols = symbolsParam
      .split(/[,\s]+/)
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);

    const results: Record<string, Returns> = {};
    const anchorsBySymbol: Record<string, {
      latestClose: number;
      prevClose?: number;
      w1?: number;
      m1?: number;
      m3?: number;
      m6?: number;
      y1?: number;
      ytd?: number;
    }> = {};
    let had404 = false;

    await Promise.allSettled(
      symbols.map(async (symbol) => {
        try {
          const params = new URLSearchParams({
            symbol,
            periodType: "year",
            period: "1",
            frequencyType: "daily",
            frequency: "1",
            needExtendedHoursData: "false",
          });
          const resp = await fetch(
            `https://api.schwabapi.com/marketdata/v1/pricehistory?${params.toString()}`,
            { headers: { Authorization: `Bearer ${accessToken}` } }
          );
          if (!resp.ok) {
            if (resp.status === 404) had404 = true;
            return;
          }
          const body: any = await resp.json();
          const rawCandles = body?.candles ?? body?.priceHistory ?? [];
          const candles: { close: number; datetime: number }[] = Array.isArray(rawCandles)
            ? rawCandles
                .map((c: any) => ({ close: c.close ?? c.Close, datetime: c.datetime ?? c.date ?? c.timestamp ?? 0 }))
                .filter((c: any) => c.close > 0 && c.datetime > 0)
            : [];
          if (candles.length < 2) return;

          const sorted = candles.slice().sort((a, b) => a.datetime - b.datetime);
          const latest = sorted[sorted.length - 1];
          const latestClose = latest.close;
          if (!latestClose || latestClose <= 0) return;

          function anchorCloseOnOrBefore(startDate: Date): number | null {
            const targetMs = startDate.getTime();
            const eligible = sorted.filter((c) => c.datetime <= targetMs);
            const start = eligible.length > 0 ? eligible[eligible.length - 1] : sorted[0];
            if (!start || !start.close || start.close <= 0) return null;
            return start.close;
          }

          const latestDate = new Date(latest.datetime);
          const prev = sorted.length >= 2 && sorted[sorted.length - 2].close > 0 ? sorted[sorted.length - 2].close : null;
          const w1Anchor = anchorCloseOnOrBefore(new Date(latestDate.getTime() - 7 * 24 * 60 * 60 * 1000));
          const m1Date = new Date(latestDate.getTime()); m1Date.setUTCMonth(m1Date.getUTCMonth() - 1);
          const m3Date = new Date(latestDate.getTime()); m3Date.setUTCMonth(m3Date.getUTCMonth() - 3);
          const m6Date = new Date(latestDate.getTime()); m6Date.setUTCMonth(m6Date.getUTCMonth() - 6);
          const y1Date = new Date(latestDate.getTime()); y1Date.setUTCFullYear(y1Date.getUTCFullYear() - 1);
          const yearStart = new Date(latest.datetime);
          yearStart.setUTCMonth(0, 1); yearStart.setUTCHours(0, 0, 0, 0);
          const firstThisYear = sorted.find((c) => c.datetime >= yearStart.getTime()) ?? sorted[0];

          anchorsBySymbol[symbol] = {
            latestClose,
            prevClose: prev ?? undefined,
            w1: w1Anchor ?? undefined,
            m1: anchorCloseOnOrBefore(m1Date) ?? undefined,
            m3: anchorCloseOnOrBefore(m3Date) ?? undefined,
            m6: anchorCloseOnOrBefore(m6Date) ?? undefined,
            y1: anchorCloseOnOrBefore(y1Date) ?? undefined,
            ytd: firstThisYear && firstThisYear.close > 0 ? firstThisYear.close : undefined,
          };
        } catch (innerErr) {
          console.error("schwab-returns per-symbol error", symbol, innerErr);
        }
      })
    );

    if (symbols.length > 0) {
      try {
        const quotesResp = await fetch(
          "https://api.schwabapi.com/marketdata/v1/quotes?" +
            new URLSearchParams({ symbols: symbols.join(",") }).toString(),
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        if (quotesResp.ok) {
          const quotesBody: any = await quotesResp.json();
          for (const symbol of symbols) {
            const q = quotesBody[symbol] ?? quotesBody[symbol.replace(/\s+/g, "")];
            if (!q) continue;
            const src = q.quote && typeof q.quote === "object" ? q.quote : q;
            const anchors = anchorsBySymbol[symbol];
            if (!anchors) continue;
            const rawPrice =
              typeof src.regularMarketLast === "number" ? src.regularMarketLast :
              typeof src.lastPrice === "number" ? src.lastPrice :
              typeof src.closePrice === "number" ? src.closePrice :
              typeof src.close === "number" ? src.close :
              typeof src.regularMarketPrice === "number" ? src.regularMarketPrice : null;
            const currentPrice =
              rawPrice != null && Number.isFinite(rawPrice) && rawPrice > 0 ? rawPrice : anchors.latestClose;
            if (currentPrice == null || !Number.isFinite(currentPrice) || currentPrice <= 0) continue;
            const mkReturn = (anchor?: number): number => {
              if (anchor == null || !Number.isFinite(anchor) || anchor <= 0) return 0;
              return (currentPrice / anchor - 1) * 100;
            };
            const regular1D =
              typeof (src as any).regularMarketPercentChange === "number"
                ? (src as any).regularMarketPercentChange * 100 : null;
            results[symbol] = {
              "1D": regular1D != null && Number.isFinite(regular1D) ? regular1D : mkReturn(anchors.latestClose),
              "1W": mkReturn(anchors.w1),
              "1M": mkReturn(anchors.m1),
              "3M": mkReturn(anchors.m3),
              "6M": mkReturn(anchors.m6),
              "1Y": mkReturn(anchors.y1),
              YTD: mkReturn(anchors.ytd),
              price: currentPrice,
            };
          }
        }
      } catch { /* ignore quote errors */ }
    }

    const isEmpty = Object.keys(results).length === 0;
    if (isEmpty) {
      const hint = had404
        ? "Schwab returned 404 for price history. Ensure your app is approved for Market Data."
        : "No candle data from Schwab for any symbol. Token may be expired. Run the Schwab OAuth flow again.";
      res.status(200).json({ ...results, _hint: hint });
    } else {
      res.status(200).json(results);
    }
  } catch (err) {
    console.error("schwab-returns error", err);
    res.status(500).json({ error: "Unexpected error computing returns" });
  }
}
