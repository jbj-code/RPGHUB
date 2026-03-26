import { createClient } from "@supabase/supabase-js";
import { toOCCSymbol, getValidAccessToken } from "./_schwab-utils";

type BuilderRowInput = {
  ticker: string;
  maturity: string; // YYYY-MM-DD
  strike: number;
  putCall: "Put" | "Call";
  action: "Sell to Open" | "Buy to Open";
  contracts: number;
  limitPriceMethod: "bid" | "mid";
};

type BuilderRowOutput = {
  ticker: string;
  maturity: string;
  daysToMaturity: number;
  strikePrice: number;
  currentPrice: number;
  moneynessPct: number;
  optionSide: string;
  pctOffBid: number;
  optionLimitPrice: number;
  currentBid: number;
  currentAsk: number;
  contracts: number;
  premiumReceived: number;
  yieldAtCurrentPrice: number;
  annualizedYieldPct: number;
  valueOfSharesAtStrike: number;
};


export default async function handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const rows: BuilderRowInput[] = Array.isArray(req.body?.rows)
    ? req.body.rows
    : [];
  if (rows.length === 0) {
    res.status(200).json({ rows: [] });
    return;
  }

  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !supabaseServiceKey) {
      res.status(500).json({
        error: "Server missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.",
      });
      return;
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const { data: tokenRow } = await supabase
      .from("schwab_tokens")
      .select("access_token, refresh_token, expires_at")
      .eq("id", "default")
      .single();

    if (!tokenRow?.access_token) {
      res.status(401).json({
        error:
          "Not authorized with Schwab. Run the Schwab login flow again, then try Builder.",
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

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    const distinctTickers = [
      ...new Set(
        rows
          .map((r) => r.ticker.trim().toUpperCase())
          .filter(Boolean)
      ),
    ];

    const quoteResp = await fetch(
      "https://api.schwabapi.com/marketdata/v1/quotes?" +
        new URLSearchParams({ symbols: distinctTickers.join(",") }).toString(),
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const quoteBody: any = quoteResp.ok ? await quoteResp.json() : {};
    const currentPriceByTicker: Record<string, number> = {};
    if (quoteBody && typeof quoteBody === "object") {
      const bySymbol = new Map<string, any>();
      if (Array.isArray(quoteBody)) {
        for (const q of quoteBody) {
          if (q?.symbol) bySymbol.set(String(q.symbol).trim(), q);
        }
      } else if (Array.isArray(quoteBody.quotes)) {
        for (const q of quoteBody.quotes) {
          if (q?.symbol) bySymbol.set(String(q.symbol).trim(), q);
        }
      } else {
        for (const [k, v] of Object.entries(quoteBody)) {
          if (v && typeof v === "object") bySymbol.set(String(k).trim(), v);
        }
      }
      for (const sym of distinctTickers) {
        const q =
          bySymbol.get(sym) ??
          bySymbol.get(sym.replace(/\s+/g, "")) ??
          (quoteBody as any)[sym];
        const src = q?.quote ?? q;
        const p =
          src?.regularMarketLast ??
          src?.lastPrice ??
          src?.last ??
          src?.close ??
          src?.regularMarketPrice;
        if (typeof p === "number" && p > 0) currentPriceByTicker[sym] = p;
      }
    }

    const occSymbols = rows.map((r) =>
      toOCCSymbol(
        r.ticker.trim().toUpperCase(),
        r.maturity,
        r.putCall === "Call" ? "C" : "P",
        r.strike
      )
    );

    const occResp = await fetch(
      "https://api.schwabapi.com/marketdata/v1/quotes?" +
        new URLSearchParams({ symbols: occSymbols.join(",") }).toString(),
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const occBody: any = occResp.ok ? await occResp.json() : {};

    const bySymbol = new Map<string, any>();
    if (occBody && typeof occBody === "object") {
      if (Array.isArray(occBody)) {
        for (const q of occBody) {
          if (q?.symbol) bySymbol.set(String(q.symbol).trim(), q);
        }
      } else if (Array.isArray(occBody.quotes)) {
        for (const q of occBody.quotes) {
          if (q?.symbol) bySymbol.set(String(q.symbol).trim(), q);
        }
      } else {
        for (const [k, v] of Object.entries(occBody)) {
          if (v && typeof v === "object") bySymbol.set(String(k).trim(), v);
        }
      }
    }

    const out: BuilderRowOutput[] = [];

    rows.forEach((row, idx) => {
      const ticker = row.ticker.trim().toUpperCase();
      const maturity = row.maturity;
      const strike = Number(row.strike);
      const contracts = Math.max(1, Number(row.contracts) || 0);
      const currentPrice = currentPriceByTicker[ticker];
      const occ = occSymbols[idx];
      const q =
        bySymbol.get(occ) ??
        bySymbol.get(occ.replace(/\s+/g, "")) ??
        (occBody && typeof occBody === "object" ? (occBody as any)[occ] : undefined);
      const src = q?.quote ?? q?.optionContract ?? q;
      const bid =
        typeof src?.bidPrice === "number"
          ? src.bidPrice
          : typeof src?.bid === "number"
            ? src.bid
            : undefined;
      const ask =
        typeof src?.askPrice === "number"
          ? src.askPrice
          : typeof src?.ask === "number"
            ? src.ask
            : undefined;

      const expiryDate = new Date(maturity + "T00:00:00Z");
      const dte = Math.max(
        0,
        Math.round(
          (expiryDate.getTime() - today.getTime()) / (24 * 60 * 60 * 1000)
        )
      );

      // Require an underlying price and a valid strike; an option quote is nice-to-have.
      if (!currentPrice || !strike) return;

      const isSell = row.action === "Sell to Open";
      let limitPrice: number | undefined;
      if (row.limitPriceMethod === "mid") {
        if (typeof bid === "number" && typeof ask === "number" && bid > 0 && ask > 0) {
          limitPrice = (bid + ask) / 2;
        } else if (typeof bid === "number" && bid > 0) {
          limitPrice = bid;
        } else if (typeof ask === "number" && ask > 0) {
          limitPrice = ask;
        }
      } else {
        if (typeof bid === "number" && bid > 0) limitPrice = bid;
        else if (typeof ask === "number" && ask > 0) limitPrice = ask;
      }

      if (!limitPrice || limitPrice <= 0) return;

      const notional = strike * contracts * 100;
      const premium = (isSell ? 1 : -1) * limitPrice * contracts * 100;
      const yieldAtCurrentPrice =
        notional !== 0 ? (premium / notional) * 100 : 0;
      const annualizedYieldPct =
        dte > 0 ? yieldAtCurrentPrice * (365 / dte) : 0;
      // Match boss's sheet: moneyness = Strike / Current Price (as %)
      const moneynessPct = (strike / currentPrice) * 100;

      const effectiveBid =
        typeof bid === "number" && bid > 0 ? bid : limitPrice;
      const pctOffBid =
        effectiveBid > 0 ? ((limitPrice / effectiveBid - 1) * 100) : 0;

      out.push({
        ticker,
        maturity,
        daysToMaturity: dte,
        strikePrice: strike,
        currentPrice,
        moneynessPct,
        optionSide: `${row.putCall.toUpperCase()} - ${row.action.toUpperCase()}`,
        pctOffBid,
        optionLimitPrice: limitPrice,
        currentBid: typeof bid === "number" && bid > 0 ? bid : limitPrice,
        currentAsk: typeof ask === "number" && ask > 0 ? ask : limitPrice,
        contracts,
        premiumReceived: premium,
        yieldAtCurrentPrice,
        annualizedYieldPct,
        valueOfSharesAtStrike: (isSell ? 1 : -1) * notional,
      });
    });

    if (out.length === 0) {
      res.status(422).json({
        error:
          "No valid option rows could be built. Check that the tickers, dates, strikes, and contracts are correct and that Schwab is returning quotes for these options.",
        rows: [],
      });
      return;
    }

    res.status(200).json({ rows: out });
  } catch (err) {
    console.error("options-builder error", err);
    res.status(500).json({
      error: "Unexpected error building options sheet",
      rows: [],
    });
  }
}

