// Options Optimizer: uses Schwab chains (expirations + strikes), quotes (underlying + options), and price history (1M return).
// POST body: { portfolioRows: PortfolioRow[], otmVariancePct: number }

import { createClient } from "@supabase/supabase-js";
import { toOCCSymbol, getValidAccessToken } from "./_schwab-utils";

type PortfolioRow = {
  id: string;
  ticker: string;
  putCall: "Put" | "Call";
  action: "Sell to Open" | "Buy to Open" | "Sell to Close" | "Buy to Close";
  type: "Qty" | "Notional";
  value: number;
  targetMode?: "days" | "expiry";
  days: number;
  targetExpiry?: string;
  moneyness?: "OTM" | "ITM";
  otmPct: number;
  monthly: boolean;
  currentExpiry?: string;
  currentStrike?: number;
  currentContracts?: number;
};

type OptionSide =
  | "PUT - SELL to OPEN"
  | "PUT - BUY to OPEN"
  | "PUT - SELL to CLOSE"
  | "PUT - BUY to CLOSE"
  | "CALL - SELL to OPEN"
  | "CALL - BUY to OPEN"
  | "CALL - SELL to CLOSE"
  | "CALL - BUY to CLOSE";

export type OptionsTrade = {
  id: string;
  ticker: string;
  maturity: string;
  daysToMaturity: number;
  strikePrice: number;
  currentPrice: number;
  moneynessPct: number;
  optionSide: OptionSide;
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

export type RankedResult = {
  rank: number;
  ticker: string;
  company: string;
  upsidePct: number;
  strike: number;
  limitPrice: number;
  annYield: number;
  premiumPerContract: number;
  delta?: number | null;
  btcAsk?: number | null;
  netRollPerContract?: number | null;
  netRollAnnualizedPct?: number | null;
  netRollTotal?: number | null;
  rollContractsUsed?: number | null;
  trade: OptionsTrade;
};

function makeId(): string {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

function toExpiryYYYYMMDD(expKey: string): string {
  const datePart = expKey.split(":")[0].trim();
  if (/^\d{8}$/.test(datePart)) {
    return `${datePart.slice(0, 4)}-${datePart.slice(4, 6)}-${datePart.slice(6, 8)}`;
  }
  return datePart;
}

function addDays(d: Date, days: number): Date {
  const out = new Date(d);
  out.setUTCDate(out.getUTCDate() + days);
  return out;
}

function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000));
}

/** Standard monthly equity options: 3rd Friday of the month (UTC date from chain YYYY-MM-DD). */
function isThirdFridayMonthlyExpiry(expiry: string): boolean {
  const parts = expiry.split("-");
  if (parts.length !== 3) return false;
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  const d = Number(parts[2]);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return false;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCDay() !== 5) return false;
  let fridayCount = 0;
  for (let day = 1; day <= d; day++) {
    if (new Date(Date.UTC(y, m - 1, day)).getUTCDay() === 5) fridayCount++;
  }
  return fridayCount === 3;
}

// Limit price = pure midpoint (bid + ask) / 2.
function modeledLimitPrice(bid?: number, ask?: number): number | null {
  const b = typeof bid === "number" && Number.isFinite(bid) && bid > 0 ? bid : null;
  const a = typeof ask === "number" && Number.isFinite(ask) && ask > 0 ? ask : null;
  if (b != null && a != null) return (b + a) / 2;
  if (b != null) return b;
  if (a != null) return a;
  return null;
}

/** Accept YYYY-MM-DD from date inputs or leading slice of ISO datetimes (fixes roll BTC lookup). */
function normalizeExpiryYMD(raw: string): string | null {
  const t = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const m = t.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1]! : null;
}

/**
 * Desk-modeled executable price from a Schwab option quote.
 * Near expiry, bid/ask are often missing; fall back to last or mark * 92% (same discount as midpoint model).
 */
function modeledPriceFromOptionQuote(src: any): number | null {
  if (!src || typeof src !== "object") return null;
  const bidRaw =
    typeof src.bidPrice === "number" && Number.isFinite(src.bidPrice)
      ? src.bidPrice
      : typeof src.bid === "number" && Number.isFinite(src.bid)
        ? src.bid
        : undefined;
  const askRaw =
    typeof src.askPrice === "number" && Number.isFinite(src.askPrice)
      ? src.askPrice
      : typeof src.ask === "number" && Number.isFinite(src.ask)
        ? src.ask
        : undefined;
  const bid = bidRaw != null && bidRaw > 0 ? bidRaw : undefined;
  const ask = askRaw != null && askRaw > 0 ? askRaw : undefined;
  const mid = modeledLimitPrice(bid, ask);
  if (mid != null && mid > 0) return mid;
  const last =
    typeof src.lastPrice === "number" && Number.isFinite(src.lastPrice) && src.lastPrice > 0
      ? src.lastPrice
      : typeof src.last === "number" && Number.isFinite(src.last) && src.last > 0
        ? src.last
        : undefined;
  if (last != null) return last;
  const mark =
    typeof src.markPrice === "number" && Number.isFinite(src.markPrice) && src.markPrice > 0
      ? src.markPrice
      : typeof src.mark === "number" && Number.isFinite(src.mark) && src.mark > 0
        ? src.mark
        : undefined;
  if (mark != null) return mark;
  return null;
}


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

  const body = req.body ?? {};
  const portfolioRows: PortfolioRow[] = Array.isArray(body.portfolioRows)
    ? body.portfolioRows
    : [];
  const otmVariancePct = Number(body.otmVariancePct) || 0;
  const rollMode = Boolean(body.rollMode);
  const rollCreditOnly = Boolean(body.rollCreditOnly);
  const assignmentAwareRanking = Boolean(body.assignmentAwareRanking);
  const rollObjective =
    body.rollObjective === "cashflow" || body.rollObjective === "yield" || body.rollObjective === "balanced"
      ? body.rollObjective
      : "balanced";

  const tickers = [
    ...new Set(
      portfolioRows
        .map((r) => r.ticker.trim().toUpperCase())
        .filter(Boolean)
    ),
  ];
  if (tickers.length === 0) {
    res.status(200).json({
      results: [],
      message: "Add at least one ticker with a symbol to optimize.",
    });
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
    const { data: tokenRow, error: tokenError } = await supabase
      .from("schwab_tokens")
      .select("access_token, refresh_token, expires_at")
      .eq("id", "default")
      .single();

    if (tokenError || !tokenRow?.access_token) {
      res.status(401).json({
        error:
          "Not authorized with Schwab. Run the Schwab login flow again, then try Optimize.",
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

    // 1) Underlying quotes (current price per ticker)
    const quoteResp = await fetch(
      "https://api.schwabapi.com/marketdata/v1/quotes?" +
        new URLSearchParams({ symbols: tickers.join(",") }).toString(),
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const quoteBody: any = quoteResp.ok ? await quoteResp.json() : {};
    const currentPriceByTicker: Record<string, number> = {};
    for (const sym of tickers) {
      const q = quoteBody[sym] ?? quoteBody[sym.replace(/\s+/g, "")];
      const src = q?.quote ?? q;
      const p =
        src?.regularMarketLast ??
        src?.lastPrice ??
        src?.last ??
        src?.close ??
        src?.regularMarketPrice;
      if (typeof p === "number" && p > 0) currentPriceByTicker[sym] = p;
    }

    // 2) 1M return per ticker (price history) — parallel, 2-month window is sufficient for 1M lookback
    const upsideByTicker: Record<string, number> = {};
    await Promise.allSettled(
      tickers.map(async (symbol) => {
        try {
          const params = new URLSearchParams({
            symbol,
            periodType: "month",
            period: "2",
            frequencyType: "daily",
            frequency: "1",
            needExtendedHoursData: "false",
          });
          const histResp = await fetch(
            `https://api.schwabapi.com/marketdata/v1/pricehistory?${params}`,
            { headers: { Authorization: `Bearer ${accessToken}` } }
          );
          if (!histResp.ok) return;
          const histBody: any = await histResp.json();
          const candles = histBody?.candles ?? [];
          if (candles.length < 2) return;
          const sorted = candles
            .slice()
            .sort((a: any, b: any) => (a.datetime ?? 0) - (b.datetime ?? 0));
          const latest = sorted[sorted.length - 1];
          const latestClose = latest?.close ?? 0;
          const oneMonthAgo = new Date(today);
          oneMonthAgo.setUTCMonth(oneMonthAgo.getUTCMonth() - 1);
          const targetMs = oneMonthAgo.getTime();
          const start = sorted.find((c: any) => (c.datetime ?? 0) >= targetMs) ?? sorted[0];
          const startClose = start?.close ?? 0;
          if (startClose > 0 && latestClose > 0) {
            upsideByTicker[symbol] = (latestClose / startClose - 1) * 100;
          }
        } catch {
          /* ignore per-ticker failures */
        }
      })
    );

    // 3) For each row: get expirations + strikes from chains, then build option list — parallel
    type OptSpec = {
      underlying: string;
      expiry: string;
      strike: number;
      type: "C" | "P";
      row: PortfolioRow;
      currentPrice: number;
      daysToMaturity: number;
    };
    const optionSpecs: OptSpec[] = [];
    const MAX_OPTIONS_PER_ROW = 24;

    const chainResults = await Promise.allSettled(
      portfolioRows.map(async (row): Promise<OptSpec[]> => {
        const collected: OptSpec[] = [];
        const ticker = row.ticker.trim().toUpperCase();
        if (!ticker) return collected;
        const currentPrice = currentPriceByTicker[ticker];
        if (!currentPrice || currentPrice <= 0) return collected;

        const type: "C" | "P" = row.putCall === "Call" ? "C" : "P";
        const usingExactExpiry =
          row.targetMode === "expiry" &&
          typeof row.targetExpiry === "string" &&
          /^\d{4}-\d{2}-\d{2}$/.test(row.targetExpiry);
        const fromDate = usingExactExpiry
          ? new Date(`${row.targetExpiry}T00:00:00.000Z`)
          : addDays(today, Math.max(1, row.days - 14));
        const toDate = usingExactExpiry
          ? new Date(`${row.targetExpiry}T00:00:00.000Z`)
          : addDays(today, row.days + 35);
        const fromStr = fromDate.toISOString().slice(0, 10);
        const toStr = toDate.toISOString().slice(0, 10);

        const params = new URLSearchParams({
          symbol: ticker,
          contractType: type === "C" ? "CALL" : "PUT",
          includeUnderlyingQuote: "FALSE",
          strategy: "SINGLE",
          fromDate: fromStr,
          toDate: toStr,
          // Slightly wider strike coverage improves match rates for ETFs/smaller names.
          strikeCount: "40",
        });
        const chainResp = await fetch(
          `https://api.schwabapi.com/marketdata/v1/chains?${params}`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        if (!chainResp.ok) return collected;

        const chainBody: any = await chainResp.json();
        const expMap = type === "C" ? chainBody?.callExpDateMap : chainBody?.putExpDateMap;
        if (!expMap || typeof expMap !== "object") return collected;

        // Variance is symmetric around the target (UI copy: 10% with 5% variance = 5% to 15%).
        const pctMin = Math.max(0, (row.otmPct - otmVariancePct) / 100);
        const pctMax = (row.otmPct + otmVariancePct) / 100;
        const isOTM = (row.moneyness ?? "OTM") === "OTM";

        for (const [expKey, strikesObj] of Object.entries<any>(expMap)) {
          const expiry = toExpiryYYYYMMDD(expKey);
          if (row.monthly && !isThirdFridayMonthlyExpiry(expiry)) continue;
          if (usingExactExpiry && expiry !== row.targetExpiry) continue;
          const expDate = new Date(expiry + "Z");
          const dte = daysBetween(today, expDate);
          if (!usingExactExpiry && (dte < Math.max(1, row.days - 14) || dte > row.days + 35)) continue;

          const strikeEntries = Object.entries(strikesObj ?? {});
          for (const [strikeStr, contracts] of strikeEntries) {
            const strike = Number(strikeStr);
            if (!Number.isFinite(strike) || strike <= 0) continue;
            const pctBelow = (currentPrice - strike) / currentPrice;
            const pctAbove = (strike - currentPrice) / currentPrice;
            // OTM: Put = strike below spot, Call = strike above spot. ITM: Put = strike above spot, Call = strike below spot.
            if (type === "P") {
              if (isOTM) {
                if (pctBelow < pctMin || pctBelow > pctMax) continue; // put OTM: strike < spot
              } else {
                if (pctAbove < pctMin || pctAbove > pctMax) continue; // put ITM: strike > spot
              }
            } else {
              if (isOTM) {
                if (pctAbove < pctMin || pctAbove > pctMax) continue; // call OTM: strike > spot
              } else {
                if (pctBelow < pctMin || pctBelow > pctMax) continue; // call ITM: strike < spot
              }
            }
            if (Array.isArray(contracts) && contracts.length > 0) {
              collected.push({
                underlying: ticker,
                expiry,
                strike,
                type,
                row,
                currentPrice,
                daysToMaturity: dte,
              });
            }
          }
        }

        collected.sort((a, b) => a.strike - b.strike);
        return collected.slice(0, MAX_OPTIONS_PER_ROW);
      })
    );

    for (const result of chainResults) {
      if (result.status === "fulfilled") optionSpecs.push(...result.value);
    }

    if (optionSpecs.length === 0) {
      res.status(200).json({
        results: [],
        message:
          "No options found for the given tickers and DTE/OTM range. Try widening OTM % or days.",
      });
      return;
    }

    // 4) Option quotes (OCC batch — 50 per request reduces round trips vs the old 30)
    const BATCH = 50;
    const optionQuoteSrc = (q: any): any => {
      if (!q || typeof q !== "object") return null;
      if (q.quote && typeof q.quote === "object") return q.quote;
      if (q.optionContract && typeof q.optionContract === "object") return q.optionContract;
      if (q.option && typeof q.option === "object") return q.option;
      return q.quote ?? q.optionContract ?? q;
    };
    const optionQuotes: Record<string, { bid: number; ask: number; modeled: number; delta: number | null }> = {};
    for (let i = 0; i < optionSpecs.length; i += BATCH) {
      const batch = optionSpecs.slice(i, i + BATCH);
      const occSymbols = batch.map((o) =>
        toOCCSymbol(o.underlying, o.expiry, o.type, o.strike)
      );
      const qUrl =
        "https://api.schwabapi.com/marketdata/v1/quotes?" +
        new URLSearchParams({ symbols: occSymbols.join(",") }).toString();
      const qResp = await fetch(qUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!qResp.ok) continue;
      const qBody: any = await qResp.json();
      for (let j = 0; j < batch.length; j++) {
        const spec = batch[j];
        const occ = occSymbols[j];
        const q = qBody[occ] ?? qBody[occ.replace(/\s+/g, "")];
        const src = optionQuoteSrc(q);
        if (!src || typeof src !== "object") continue;
        const modeled = modeledPriceFromOptionQuote(src);
        if (modeled == null || modeled <= 0) continue;
        const bid =
          typeof src.bidPrice === "number" && Number.isFinite(src.bidPrice)
            ? src.bidPrice
            : typeof src.bid === "number" && Number.isFinite(src.bid)
              ? src.bid
              : 0;
        const ask =
          typeof src.askPrice === "number" && Number.isFinite(src.askPrice)
            ? src.askPrice
            : typeof src.ask === "number" && Number.isFinite(src.ask)
              ? src.ask
              : 0;
        const delta =
          typeof src.delta === "number" && Number.isFinite(src.delta)
            ? src.delta
            : null;
        const key = `${spec.underlying} ${spec.expiry} ${spec.strike} ${spec.type}`;
        optionQuotes[key] = { bid, ask, modeled, delta };
      }
    }

    // 4b) Optional roll-mode BTC quote lookup for each row's current short leg.
    const closePriceByRowId: Record<string, number> = {};
    if (rollMode) {
      const btcRows = portfolioRows
        .map((row) => {
          const expiryNorm = normalizeExpiryYMD(row.currentExpiry ?? "");
          return {
            rowId: row.id,
            ticker: row.ticker.trim().toUpperCase(),
            type: row.putCall === "Call" ? "C" : ("P" as "C" | "P"),
            expiry: expiryNorm ?? "",
            strike: Number(row.currentStrike),
          };
        })
        .filter(
          (r) =>
            Boolean(r.rowId) &&
            Boolean(r.ticker) &&
            /^\d{4}-\d{2}-\d{2}$/.test(r.expiry) &&
            Number.isFinite(r.strike) &&
            r.strike > 0
        );

      const occByRowId: { rowId: string; occ: string }[] = btcRows.map((r) => ({
        rowId: r.rowId,
        occ: toOCCSymbol(r.ticker, r.expiry, r.type, r.strike),
      }));

      for (let i = 0; i < occByRowId.length; i += BATCH) {
        const batch = occByRowId.slice(i, i + BATCH);
        const occSymbols = batch.map((b) => b.occ);
        const qUrl =
          "https://api.schwabapi.com/marketdata/v1/quotes?" +
          new URLSearchParams({ symbols: occSymbols.join(",") }).toString();
        const qResp = await fetch(qUrl, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!qResp.ok) continue;
        const qBody: any = await qResp.json();
        for (const item of batch) {
          const q = qBody[item.occ] ?? qBody[item.occ.replace(/\s+/g, "")];
          const src = optionQuoteSrc(q);
          if (!src || typeof src !== "object") continue;
          const modeled = modeledPriceFromOptionQuote(src);
          if (modeled != null && modeled > 0) {
            closePriceByRowId[item.rowId] = modeled;
          }
        }
      }
    }

    // 5) Build RankedResult + OptionsTrade for each spec that has a quote
    const optionSideFromRow = (r: PortfolioRow): OptionSide => {
      if (r.putCall === "Put" && r.action === "Sell to Open") return "PUT - SELL to OPEN";
      if (r.putCall === "Put" && r.action === "Buy to Open") return "PUT - BUY to OPEN";
      if (r.putCall === "Put" && r.action === "Sell to Close") return "PUT - SELL to CLOSE";
      if (r.putCall === "Put" && r.action === "Buy to Close") return "PUT - BUY to CLOSE";
      if (r.putCall === "Call" && r.action === "Sell to Open") return "CALL - SELL to OPEN";
      if (r.putCall === "Call" && r.action === "Buy to Open") return "CALL - BUY to OPEN";
      if (r.putCall === "Call" && r.action === "Sell to Close") return "CALL - SELL to CLOSE";
      return "CALL - BUY to CLOSE";
    };

    const raw: RankedResult[] = [];
    for (const spec of optionSpecs) {
      const key = `${spec.underlying} ${spec.expiry} ${spec.strike} ${spec.type}`;
      const quote = optionQuotes[key];
      const bid = quote?.bid ?? 0;
      const ask = quote?.ask ?? bid;
      if (bid <= 0 && ask <= 0) continue;

      const row = spec.row;
      // In roll mode we always evaluate replacement candidates as SELL TO OPEN.
      const isSell = rollMode ? true : row.action.startsWith("Sell");
      const modeled = modeledLimitPrice(bid, ask);
      if (modeled == null || modeled <= 0) continue;
      const optionLimitPrice = modeled;
      const contracts =
        row.type === "Qty"
          ? Math.max(1, Math.round(row.value))
          : Math.floor(row.value / (spec.strike * 100));
      // In Notional mode, never exceed the requested notional by rounding up.
      // If notional cannot fund at least 1 contract at this strike, skip candidate.
      if (row.type === "Notional" && contracts < 1) continue;
      const notional = spec.strike * contracts * 100;
      const premiumReceived = (isSell ? 1 : -1) * optionLimitPrice * contracts * 100;
      // Yield on strike notional = premium / (strike × contracts × 100).
      // This reflects actual capital at risk (cash needed to cover assignment for short puts,
      // or shares needed for short calls), which is the standard industry convention.
      const yieldAtCurrentPrice =
        notional !== 0 ? (premiumReceived / notional) * 100 : 0;
      const annualizedYieldPct =
        spec.daysToMaturity > 0
          ? yieldAtCurrentPrice * (365 / spec.daysToMaturity)
          : 0;
      const moneynessPct = (spec.strike / spec.currentPrice) * 100;

      const trade: OptionsTrade = {
        id: makeId(),
        ticker: spec.underlying,
        maturity: spec.expiry,
        daysToMaturity: spec.daysToMaturity,
        strikePrice: spec.strike,
        currentPrice: spec.currentPrice,
        moneynessPct: Math.round(moneynessPct * 100) / 100,
        optionSide: rollMode
          ? row.putCall === "Put"
            ? "PUT - SELL to OPEN"
            : "CALL - SELL to OPEN"
          : optionSideFromRow(row),
        pctOffBid: 0,
        optionLimitPrice,
        currentBid: bid,
        currentAsk: ask,
        contracts,
        premiumReceived,
        yieldAtCurrentPrice: Math.round(yieldAtCurrentPrice * 100) / 100,
        annualizedYieldPct: Math.round(annualizedYieldPct * 100) / 100,
        valueOfSharesAtStrike: (isSell ? 1 : -1) * notional,
      };

      const upsidePct = upsideByTicker[spec.underlying] ?? 0;
      const rollContractsUsed = Math.max(
        1,
        Math.round(Number(row.currentContracts) > 0 ? Number(row.currentContracts) : contracts)
      );
      const netRollPerContract =
        rollMode && closePriceByRowId[row.id] != null
          ? Math.round(
              ((isSell ? 1 : -1) * optionLimitPrice * 100 - closePriceByRowId[row.id] * 100) *
                100
            ) / 100
          : null;
      raw.push({
        rank: 0,
        ticker: spec.underlying,
        company: spec.underlying,
        upsidePct: Math.round(upsidePct * 10) / 10,
        strike: spec.strike,
        limitPrice: optionLimitPrice,
        annYield: trade.annualizedYieldPct,
        // Signed per-contract premium/cost so buy actions display as negative cash flow.
        premiumPerContract: Math.round((isSell ? 1 : -1) * optionLimitPrice * 100),
        delta: quote?.delta ?? null,
        btcAsk: rollMode ? closePriceByRowId[row.id] ?? null : null,
        netRollPerContract,
        netRollAnnualizedPct: rollMode
          ? closePriceByRowId[row.id] != null && spec.daysToMaturity > 0
            ? Math.round(
                ((((isSell ? 1 : -1) * optionLimitPrice * 100 - closePriceByRowId[row.id] * 100) / (spec.strike * 100)) *
                  100 *
                  (365 / spec.daysToMaturity)) *
                  100
              ) / 100
            : null
          : null,
        netRollTotal:
          rollMode && netRollPerContract != null
            ? Math.round(netRollPerContract * rollContractsUsed * 100) / 100
            : null,
        rollContractsUsed: rollMode ? rollContractsUsed : null,
        trade,
      });
    }

    let ranked = raw;
    let message: string | null = null;
    if (rollMode && rollCreditOnly) {
      ranked = ranked.filter((r) => (r.netRollPerContract ?? -Infinity) > 0);
      if (ranked.length === 0) {
        message =
          "No credit roll candidates found for these settings. Try turning off Credit only, widening OTM variance, or increasing DTE.";
      }
    } else if (rollMode && ranked.length === 0) {
      message =
        "No roll candidates found for these settings. Try widening OTM variance or adjusting DTE.";
    }
    if (rollMode && raw.length > 0 && raw.every((r) => r.btcAsk == null)) {
      const warn =
        "Current-leg (BTC) modeled price missing: Net Roll and Roll metrics need a Schwab quote on your closing contract (bid/ask, last, or mark). Confirm Current expiry and strike match the option you hold.";
      message = message ? `${message} ${warn}` : warn;
    }

    const score = (r: RankedResult) => {
      if (rollMode) {
        const netAnn = r.netRollAnnualizedPct ?? -9999;
        const netPerC = r.netRollPerContract ?? -9999;
        if (rollObjective === "cashflow") return netPerC;
        if (rollObjective === "yield") return netAnn;
        return netAnn * 0.8 + netPerC * 0.2;
      }

      const isSell = r.trade.optionSide.includes("SELL");
      const isPut = r.trade.optionSide.startsWith("PUT");

      // Directional momentum: flip sign for trades that benefit from downside moves.
      // Short put / long call → upside is good. Short call / long put → downside is good.
      const benefitsFromUpside = (isPut && isSell) || (!isPut && !isSell);
      const directedUpside = benefitsFromUpside ? r.upsidePct : -r.upsidePct;
      // Cap at ±50 so an extreme single-month outlier can't dominate the ranking.
      const cappedUpside = Math.max(-50, Math.min(50, directedUpside));

      // Base: 50% yield (primary) + 50% directional momentum (secondary context)
      const base = r.annYield * 0.5 + (cappedUpside + 50) * 0.5;

      // Risk adjustment for short options — rewards high PoP, penalises near/in-the-money.
      if (isSell && r.delta != null) {
        // PoP = (1 - |delta|) × 100.  Neutral at 70%; above = reward, below = penalise.
        const pop = (1 - Math.abs(r.delta)) * 100;
        return base + (pop - 70) * 0.4;
      }

      // Fallback OTM penalty tiers used when Schwab did not return a delta value.
      if (isSell && r.trade.currentPrice > 0) {
        const otmPct = isPut
          ? ((r.trade.currentPrice - r.strike) / r.trade.currentPrice) * 100
          : ((r.strike - r.trade.currentPrice) / r.trade.currentPrice) * 100;
        if (otmPct < 0) return base - (40 + Math.abs(otmPct) * 4);
        if (otmPct < 2) return base - (22 - otmPct * 4);
        if (otmPct < 5) return base - (14 - (otmPct - 2) * 2);
        if (otmPct < 8) return base - (8 - (otmPct - 5));
      }

      return base;
    };
    ranked.sort((a, b) => score(b) - score(a));
    ranked.forEach((r, i) => {
      r.rank = i + 1;
    });

    res.status(200).json({ results: ranked, message });
  } catch (err) {
    console.error("schwab-option-optimizer error", err);
    res.status(500).json({
      error: "Unexpected error running optimizer",
      results: [],
      message: "Optimizer failed. Check connection and try again.",
    });
  }
}
