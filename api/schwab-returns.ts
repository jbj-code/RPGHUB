// Vercel serverless: compute simple percentage returns for multiple symbols
// using Schwab Market Data PriceHistory, then return a compact map suitable
// for the Stock Comparison page.

import { createClient } from "@supabase/supabase-js";
import { getValidAccessToken } from "./_schwab-utils";

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

    const accessToken = await getValidAccessToken(supabase, tokenRow);
    if (!accessToken) {
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
    const anchorsBySymbol: Record<
      string,
      {
        latestClose: number;
        prevClose?: number;
        w1?: number;
        m1?: number;
        m3?: number;
        m6?: number;
        y1?: number;
        ytd?: number;
      }
    > = {};
    let had404 = false;

    // Fetch all price histories in parallel — each symbol is independent.
    await Promise.allSettled(
      symbols.map(async (symbol) => {
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
            return;
          }

          const body: any = await resp.json();
          if (symbols.indexOf(symbol) === 0) {
            console.log("[schwab-returns] first symbol response keys:", Object.keys(body || {}), "candles?", Array.isArray(body?.candles) ? body.candles.length : "n/a");
          }
          const rawCandles = body?.candles ?? body?.priceHistory ?? [];
          const candles: { close: number; datetime: number }[] = Array.isArray(rawCandles)
            ? rawCandles.map((c: any) => ({
                close: c.close ?? c.Close,
                datetime: c.datetime ?? c.date ?? c.timestamp ?? 0,
              })).filter((c: any) => c.close > 0 && c.datetime > 0)
            : [];
          if (candles.length < 2) {
            console.warn("[schwab-returns] not enough candles for", symbol, "response keys:", Object.keys(body || {}), "rawCandles length:", Array.isArray(rawCandles) ? rawCandles.length : 0);
            return;
          }

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
          const prev =
            sorted.length >= 2 && sorted[sorted.length - 2].close > 0
              ? sorted[sorted.length - 2].close
              : null;

          const w1Anchor = anchorCloseOnOrBefore(
            new Date(latestDate.getTime() - 7 * 24 * 60 * 60 * 1000)
          );
          const m1Date = new Date(latestDate.getTime());
          m1Date.setUTCMonth(m1Date.getUTCMonth() - 1);
          const m3Date = new Date(latestDate.getTime());
          m3Date.setUTCMonth(m3Date.getUTCMonth() - 3);
          const m6Date = new Date(latestDate.getTime());
          m6Date.setUTCMonth(m6Date.getUTCMonth() - 6);
          const y1Date = new Date(latestDate.getTime());
          y1Date.setUTCFullYear(y1Date.getUTCFullYear() - 1);

          const m1Anchor = anchorCloseOnOrBefore(m1Date);
          const m3Anchor = anchorCloseOnOrBefore(m3Date);
          const m6Anchor = anchorCloseOnOrBefore(m6Date);
          const y1Anchor = anchorCloseOnOrBefore(y1Date);

          const yearStart = new Date(latest.datetime);
          yearStart.setUTCMonth(0, 1);
          yearStart.setUTCHours(0, 0, 0, 0);
          const firstThisYear =
            sorted.find((c) => c.datetime >= yearStart.getTime()) ?? sorted[0];
          const ytdAnchor =
            firstThisYear && firstThisYear.close > 0 ? firstThisYear.close : null;

          anchorsBySymbol[symbol] = {
            latestClose,
            prevClose: prev ?? undefined,
            w1: w1Anchor ?? undefined,
            m1: m1Anchor ?? undefined,
            m3: m3Anchor ?? undefined,
            m6: m6Anchor ?? undefined,
            y1: y1Anchor ?? undefined,
            ytd: ytdAnchor ?? undefined,
          };
        } catch (innerErr) {
          console.error("schwab-returns per-symbol error", symbol, innerErr);
        }
      })
    );

    // Use Schwab quotes for current price; compute all returns as currentPrice / anchorClose - 1
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

            const anchors = anchorsBySymbol[symbol];
            if (!anchors) continue;

            // Current price for display and return calculations
            const rawPrice =
              typeof src.regularMarketLast === "number"
                ? src.regularMarketLast
                : typeof src.lastPrice === "number"
                  ? src.lastPrice
                  : typeof src.closePrice === "number"
                    ? src.closePrice
                    : typeof src.close === "number"
                      ? src.close
                      : typeof src.regularMarketPrice === "number"
                        ? src.regularMarketPrice
                        : null;

            const currentPrice =
              rawPrice != null && Number.isFinite(rawPrice) && rawPrice > 0
                ? rawPrice
                : anchors.latestClose;

            if (currentPrice == null || !Number.isFinite(currentPrice) || currentPrice <= 0)
              continue;

            const mkReturn = (anchor?: number): number => {
              if (anchor == null || !Number.isFinite(anchor) || anchor <= 0) return 0;
              return ((currentPrice / anchor - 1) * 100);
            };

            // Prefer Schwab's own regularMarketPercentChange for 1D when available.
            const regular1D =
              typeof (src as any).regularMarketPercentChange === "number"
                ? (src as any).regularMarketPercentChange * 100
                : null;

            results[symbol] = {
              // 1D: use Schwab's regularMarketPercentChange when available; otherwise current vs latest close.
              "1D":
                regular1D != null && Number.isFinite(regular1D)
                  ? regular1D
                  : mkReturn(anchors.latestClose),
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
      } catch {
        // ignore quote errors; we'll fall through and potentially return empty results
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

