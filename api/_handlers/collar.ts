// collar.ts
// Protective collar scanner: pairs OTM puts + calls for a ticker/expiry; ranks by net cost (Even).

import { createClient } from "@supabase/supabase-js";
import { toOCCSymbol, getValidAccessToken } from "../_schwab-utils.js";

type CollarRankBy = "even" | "widest" | "best_floor";

type CollarRequest = {
  ticker: string;
  targetMode?: "days" | "expiry" | "month";
  days?: number;
  targetExpiry?: string;
  targetMonth?: string;
  monthly?: boolean;
  rankBy?: CollarRankBy;
  shareCount?: number;
  /** Manual test: skip scan and quote this put/call pair only. */
  customPutStrike?: number;
  customCallStrike?: number;
};

export type CollarLegQuote = {
  strike: number;
  bid: number;
  ask: number;
  mid: number;
};

export type CollarResult = {
  rank: number;
  ticker: string;
  expiry: string;
  daysToMaturity: number;
  spot: number;
  putStrike: number;
  callStrike: number;
  put: CollarLegQuote;
  call: CollarLegQuote;
  /** Buy put @ ask, sell call @ bid — per share (×100 per contract). Positive = net debit. */
  netCostPerShare: number;
  netCostPerContract: number;
  floorPct: number;
  capPct: number;
  bandWidthPct: number;
  evenScore: number;
  isEven: boolean;
  contractsFromShares: number;
};

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

function isStandardMonthlyExpiry(expiry: string): boolean {
  const parts = expiry.split("-");
  if (parts.length !== 3) return false;
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  const d = Number(parts[2]);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return false;
  const date = new Date(Date.UTC(y, m - 1, d));
  const dow = date.getUTCDay();
  if (dow === 5) {
    let fridayCount = 0;
    for (let day = 1; day <= d; day++) {
      if (new Date(Date.UTC(y, m - 1, day)).getUTCDay() === 5) fridayCount++;
    }
    if (fridayCount === 3) return true;
  }
  if (dow === 4) {
    const fridayD = d + 1;
    const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
    if (fridayD <= daysInMonth) {
      let fridayCount = 0;
      for (let day = 1; day <= fridayD; day++) {
        if (new Date(Date.UTC(y, m - 1, day)).getUTCDay() === 5) fridayCount++;
      }
      if (fridayCount === 3) return true;
    }
  }
  return false;
}

function midPrice(bid: number, ask: number): number {
  if (bid > 0 && ask > 0) return (bid + ask) / 2;
  if (bid > 0) return bid;
  if (ask > 0) return ask;
  return 0;
}

function optionQuoteSrc(q: any): any {
  if (!q || typeof q !== "object") return null;
  if (q.quote && typeof q.quote === "object") return q.quote;
  if (q.optionContract && typeof q.optionContract === "object") return q.optionContract;
  if (q.option && typeof q.option === "object") return q.option;
  return q.quote ?? q.optionContract ?? q;
}

function parseBidAsk(src: any): { bid: number; ask: number } {
  const bid =
    typeof src?.bidPrice === "number" && Number.isFinite(src.bidPrice)
      ? src.bidPrice
      : typeof src?.bid === "number" && Number.isFinite(src.bid)
        ? src.bid
        : 0;
  const ask =
    typeof src?.askPrice === "number" && Number.isFinite(src.askPrice)
      ? src.askPrice
      : typeof src?.ask === "number" && Number.isFinite(src.ask)
        ? src.ask
        : 0;
  return { bid, ask };
}

type StrikeLeg = { strike: number; type: "P" | "C" };

async function fetchChain(
  accessToken: string,
  ticker: string,
  contractType: "PUT" | "CALL",
  fromStr: string,
  toStr: string
): Promise<Record<string, Record<string, unknown[]>>> {
  const params = new URLSearchParams({
    symbol: ticker,
    contractType,
    includeUnderlyingQuote: "FALSE",
    strategy: "SINGLE",
    fromDate: fromStr,
    toDate: toStr,
    strikeCount: "200",
  });
  const chainResp = await fetch(
    `https://api.schwabapi.com/marketdata/v1/chains?${params}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!chainResp.ok) return {};
  const chainBody: any = await chainResp.json();
  const expMap = contractType === "CALL" ? chainBody?.callExpDateMap : chainBody?.putExpDateMap;
  return expMap && typeof expMap === "object" ? expMap : {};
}

async function quoteLegs(
  accessToken: string,
  ticker: string,
  expiry: string,
  legs: StrikeLeg[]
): Promise<Map<string, CollarLegQuote>> {
  const out = new Map<string, CollarLegQuote>();
  if (legs.length === 0) return out;
  const BATCH = 50;
  for (let i = 0; i < legs.length; i += BATCH) {
    const batch = legs.slice(i, i + BATCH);
    const occSymbols = batch.map((l) => toOCCSymbol(ticker, expiry, l.type, l.strike));
    const qUrl =
      "https://api.schwabapi.com/marketdata/v1/quotes?" +
      new URLSearchParams({ symbols: occSymbols.join(",") }).toString();
    const qResp = await fetch(qUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!qResp.ok) continue;
    const qBody: any = await qResp.json();
    for (let j = 0; j < batch.length; j++) {
      const leg = batch[j];
      const occ = occSymbols[j];
      const q = qBody[occ] ?? qBody[occ.replace(/\s+/g, "")];
      const src = optionQuoteSrc(q);
      if (!src) continue;
      const { bid, ask } = parseBidAsk(src);
      if (bid <= 0 && ask <= 0) continue;
      const mid = midPrice(bid, ask);
      if (mid <= 0) continue;
      out.set(`${leg.type}:${leg.strike}`, { strike: leg.strike, bid, ask, mid });
    }
    if (i + BATCH < legs.length) await new Promise((r) => setTimeout(r, 80));
  }
  return out;
}

function resolveDateWindow(body: CollarRequest, today: Date): {
  fromStr: string;
  toStr: string;
  usingExactExpiry: boolean;
  usingMonthMode: boolean;
  targetExpDate: Date | null;
} {
  const usingExactExpiry =
    body.targetMode === "expiry" &&
    typeof body.targetExpiry === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(body.targetExpiry);
  const usingMonthMode =
    body.targetMode === "month" &&
    typeof body.targetMonth === "string" &&
    /^\d{4}-\d{2}$/.test(body.targetMonth.trim());
  const targetExpDate = usingExactExpiry ? new Date(`${body.targetExpiry}T00:00:00.000Z`) : null;

  let fromDate: Date;
  let toDate: Date;
  if (usingExactExpiry) {
    fromDate = addDays(targetExpDate!, -7);
    toDate = addDays(targetExpDate!, 7);
  } else if (usingMonthMode) {
    const [ymYear, ymMonth] = body.targetMonth!.split("-").map(Number);
    fromDate = new Date(Date.UTC(ymYear, ymMonth - 1, 1));
    toDate = new Date(Date.UTC(ymYear, ymMonth, 0));
  } else {
    const days = Math.max(1, Number(body.days) || 30);
    fromDate = addDays(today, Math.max(1, days - 14));
    toDate = addDays(today, days + 35);
  }
  return {
    fromStr: fromDate.toISOString().slice(0, 10),
    toStr: toDate.toISOString().slice(0, 10),
    usingExactExpiry,
    usingMonthMode,
    targetExpDate,
  };
}

function pickExpirations(
  putMap: Record<string, Record<string, unknown[]>>,
  callMap: Record<string, Record<string, unknown[]>>,
  opts: {
    monthly: boolean;
    usingExactExpiry: boolean;
    targetExpDate: Date | null;
    today: Date;
  }
): string[] {
  const putExps = new Set(Object.keys(putMap).map(toExpiryYYYYMMDD));
  const shared = [...putExps].filter((e) =>
    Object.keys(callMap).some((k) => toExpiryYYYYMMDD(k) === e)
  );
  let exps = shared.filter((e) => daysBetween(opts.today, new Date(e + "Z")) > 0);
  if (opts.monthly) exps = exps.filter(isStandardMonthlyExpiry);
  if (opts.usingExactExpiry && opts.targetExpDate) {
    let closest: string | null = null;
    let minDiff = Infinity;
    for (const exp of exps) {
      const diff = Math.abs(new Date(exp + "Z").getTime() - opts.targetExpDate!.getTime());
      if (diff < minDiff) {
        minDiff = diff;
        closest = exp;
      }
    }
    return closest ? [closest] : [];
  }
  return exps.sort();
}

function strikesFromMap(
  expMap: Record<string, Record<string, unknown[]>>,
  expiry: string
): number[] {
  const entry = Object.entries(expMap).find(([k]) => toExpiryYYYYMMDD(k) === expiry);
  if (!entry) return [];
  const [, strikesObj] = entry;
  return Object.keys(strikesObj ?? {})
    .map(Number)
    .filter((s) => Number.isFinite(s) && s > 0)
    .sort((a, b) => a - b);
}

function trimStrikes(strikes: number[], max: number): number[] {
  if (strikes.length <= max) return strikes;
  const step = strikes.length / max;
  const out: number[] = [];
  for (let i = 0; i < max; i++) {
    out.push(strikes[Math.min(strikes.length - 1, Math.floor(i * step))]);
  }
  return [...new Set(out)].sort((a, b) => a - b);
}

export async function handler(req: any, res: any): Promise<void> {
  const body: CollarRequest = req.body ?? {};
  const ticker = (body.ticker ?? "").trim().toUpperCase();
  if (!ticker) {
    res.status(200).json({ results: [], message: "Enter a ticker to scan collars." });
    return;
  }

  const rankBy: CollarRankBy =
    body.rankBy === "widest" || body.rankBy === "best_floor" ? body.rankBy : "even";
  const shareCount = Math.max(0, Number(body.shareCount) || 0);
  const contractsFromShares = shareCount > 0 ? Math.max(1, Math.floor(shareCount / 100)) : 0;

  try {
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
      res.status(401).json({
        error: "Not authorized with Schwab. Run the Schwab login flow again, then try Collar scan.",
      });
      return;
    }

    const accessToken = await getValidAccessToken(supabase, tokenRow);
    if (!accessToken) {
      res.status(401).json({ error: "Schwab token expired. Run the Schwab login flow again." });
      return;
    }

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    const quoteResp = await fetch(
      "https://api.schwabapi.com/marketdata/v1/quotes?" +
        new URLSearchParams({ symbols: ticker, fields: "quote" }).toString(),
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const quoteBody: any = quoteResp.ok ? await quoteResp.json() : {};
    const q = quoteBody[ticker] ?? quoteBody[ticker.replace(/\s+/g, "")];
    const src = q?.quote ?? q;
    const spot =
      src?.regularMarketLast ??
      src?.lastPrice ??
      src?.last ??
      src?.close ??
      src?.regularMarketPrice;
    if (typeof spot !== "number" || spot <= 0) {
      res.status(200).json({ results: [], message: `Could not get a live quote for ${ticker}.` });
      return;
    }

    const customPut = Number(body.customPutStrike);
    const customCall = Number(body.customCallStrike);
    const isCustom =
      Number.isFinite(customPut) && customPut > 0 && Number.isFinite(customCall) && customCall > 0;

    const { fromStr, toStr, usingExactExpiry, usingMonthMode, targetExpDate } = resolveDateWindow(
      body,
      today
    );

    if (body.targetMode === "month" && !usingMonthMode && !isCustom) {
      res.status(200).json({ results: [], message: "Select a valid target month." });
      return;
    }

    const [putMap, callMap] = await Promise.all([
      fetchChain(accessToken, ticker, "PUT", fromStr, toStr),
      fetchChain(accessToken, ticker, "CALL", fromStr, toStr),
    ]);

    const expiries = pickExpirations(putMap, callMap, {
      monthly: !!body.monthly,
      usingExactExpiry,
      targetExpDate,
      today,
    });

    if (expiries.length === 0) {
      res.status(200).json({
        results: [],
        message: "No shared put/call expiries found for that window. Try another month or turn off Monthly-only.",
      });
      return;
    }

    type RawCollar = Omit<CollarResult, "rank">;
    const raw: RawCollar[] = [];

    for (const expiry of expiries) {
      const dte = daysBetween(today, new Date(expiry + "Z"));
      let putStrikes = strikesFromMap(putMap, expiry).filter((s) => s < spot);
      let callStrikes = strikesFromMap(callMap, expiry).filter((s) => s > spot);

      if (isCustom) {
        putStrikes = putStrikes.includes(customPut) ? [customPut] : [customPut];
        callStrikes = callStrikes.includes(customCall) ? [customCall] : [customCall];
      } else {
        putStrikes = trimStrikes(putStrikes, 35);
        callStrikes = trimStrikes(callStrikes, 35);
      }

      if (putStrikes.length === 0 || callStrikes.length === 0) continue;

      const legsToQuote: StrikeLeg[] = [
        ...putStrikes.map((strike) => ({ strike, type: "P" as const })),
        ...callStrikes.map((strike) => ({ strike, type: "C" as const })),
      ];
      const quotes = await quoteLegs(accessToken, ticker, expiry, legsToQuote);

      for (const putStrike of putStrikes) {
        const putQ = quotes.get(`P:${putStrike}`);
        if (!putQ || putQ.ask <= 0) continue;
        for (const callStrike of callStrikes) {
          if (callStrike <= putStrike) continue;
          const callQ = quotes.get(`C:${callStrike}`);
          if (!callQ || callQ.bid <= 0) continue;

          const netCostPerShare = putQ.ask - callQ.bid;
          const netCostPerContract = netCostPerShare * 100;
          const floorPct = ((putStrike - spot) / spot) * 100;
          const capPct = ((callStrike - spot) / spot) * 100;
          const bandWidthPct = capPct - floorPct;
          const evenScore = Math.abs(netCostPerShare);

          raw.push({
            ticker,
            expiry,
            daysToMaturity: dte,
            spot: Math.round(spot * 100) / 100,
            putStrike,
            callStrike,
            put: putQ,
            call: callQ,
            netCostPerShare: Math.round(netCostPerShare * 100) / 100,
            netCostPerContract: Math.round(netCostPerContract),
            floorPct: Math.round(floorPct * 10) / 10,
            capPct: Math.round(capPct * 10) / 10,
            bandWidthPct: Math.round(bandWidthPct * 10) / 10,
            evenScore: Math.round(evenScore * 100) / 100,
            isEven: evenScore <= 0.15,
            contractsFromShares,
          });
        }
      }

      if (isCustom) break;
    }

    if (raw.length === 0) {
      res.status(200).json({
        results: [],
        message: "No collar pairs had usable bid/ask quotes. Try another expiry or strikes.",
      });
      return;
    }

    raw.sort((a, b) => {
      if (rankBy === "widest") {
        if (b.bandWidthPct !== a.bandWidthPct) return b.bandWidthPct - a.bandWidthPct;
        return a.evenScore - b.evenScore;
      }
      if (rankBy === "best_floor") {
        if (b.floorPct !== a.floorPct) return b.floorPct - a.floorPct;
        return a.evenScore - b.evenScore;
      }
      if (a.evenScore !== b.evenScore) return a.evenScore - b.evenScore;
      return b.bandWidthPct - a.bandWidthPct;
    });

    const top = raw.slice(0, 30).map((r, i) => ({ ...r, rank: i + 1 }));
    res.status(200).json({
      results: top,
      spot,
      message: isCustom ? "Custom collar quoted." : `Found ${raw.length} collar pairs; showing top ${top.length}.`,
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Collar scan failed." });
  }
}
