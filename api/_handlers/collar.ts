// collar.ts
// Protective collar finder: given a target downside floor, finds the call strike that pairs
// closest to even (Schwab "Even" style, priced at mid) — a goal-driven recommendation, not a scanner.

import { createClient } from "@supabase/supabase-js";
import { toOCCSymbol, getValidAccessToken } from "../_schwab-utils.js";

type CollarRequest = {
  ticker: string;
  targetMode?: "days" | "expiry" | "month";
  days?: number;
  targetExpiry?: string;
  targetMonth?: string;
  monthly?: boolean;
  shareCount?: number;
  customPutStrike?: number;
  customCallStrike?: number;
  /** Desired downside floor, % from spot (negative), e.g. -15. */
  targetFloorPct?: number;
  /** Desired net per share at mid; 0 = even (default). Positive = willing to pay a debit, negative = want a credit. */
  targetNetPerShare?: number;
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
  /** Put ask − call bid (conservative executable debit). */
  netCostPerShare: number;
  netCostPerContract: number;
  /** Put mid − call mid — matches Schwab “Even” order estimate. */
  netMidPerShare: number;
  netMidPerContract: number;
  floorPct: number;
  capPct: number;
  bandWidthPct: number;
  /** |net mid − target net| — how close this pairing is to the requested budget. */
  evenScore: number;
  isEven: boolean;
  contractsFromShares: number;
};

/** Absolute sanity bounds on the floor a user can request. */
const ABS_FLOOR_PCT_MIN = -75;
const ABS_FLOOR_PCT_MAX = -1;
const DEFAULT_TARGET_FLOOR_PCT = -15;
/** Call strikes are scanned across this OTM band so the nearest-even match can be found. */
const CALL_OTM_PCT_MIN = 3;
const CALL_OTM_PCT_MAX = 80;
/** How many listed put strikes near the target floor to consider (hero + alternates). */
const PUT_CANDIDATE_COUNT = 3;
/** Reject put candidates farther than this from the requested floor (percentage points). */
const FLOOR_TOLERANCE_PCT = 10;
/** Ignore legs with midpoint below this — penny options create fake "even" collars. */
const MIN_LEG_MID = 0.15;
const EVEN_THRESHOLD = 0.15;
const MAX_RESULTS = 3;

function clampTargetFloorPct(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return DEFAULT_TARGET_FLOOR_PCT;
  return Math.min(ABS_FLOOR_PCT_MAX, Math.max(ABS_FLOOR_PCT_MIN, n));
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
    range: "ALL",
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
    usingMonthMode: boolean;
    targetMonth: string | null;
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
  if (opts.usingMonthMode && opts.targetMonth) {
    const monthPrefix = opts.targetMonth.trim();
    exps = exps.filter((e) => e.startsWith(monthPrefix));
    if (exps.length === 0) return [];
    // Prefer the standard monthly in that month; otherwise the latest shared expiry in-range.
    const monthly = exps.filter(isStandardMonthlyExpiry);
    const pool = monthly.length > 0 ? monthly : exps;
    return [pool.sort().at(-1)!];
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

/** Nearest listed put strikes to the target floor % (hero + a couple of alternates). */
function nearestPutStrikes(strikes: number[], spot: number, targetFloorPct: number, count: number): number[] {
  const ranked = strikes
    .map((s) => ({ s, floorPct: ((s - spot) / spot) * 100 }))
    .filter((x) => x.floorPct < 0)
    .map((x) => ({ ...x, dist: Math.abs(x.floorPct - targetFloorPct) }))
    .sort((a, b) => a.dist - b.dist);
  const within = ranked.filter((x) => x.dist <= FLOOR_TOLERANCE_PCT);
  if (within.length === 0) return [];
  return within.slice(0, count).map((x) => x.s);
}

/** Broad call OTM band so the nearest-even match can be found for whichever put strike was picked. */
function callStrikesInBand(strikes: number[], spot: number): number[] {
  const lo = spot * (1 + CALL_OTM_PCT_MIN / 100);
  const hi = spot * (1 + CALL_OTM_PCT_MAX / 100);
  return strikes.filter((s) => s > spot && s >= lo && s <= hi);
}

type RawCollar = Omit<CollarResult, "rank">;

function isMeaningfulCollar(r: RawCollar): boolean {
  return r.put.mid >= MIN_LEG_MID && r.call.mid >= MIN_LEG_MID;
}

/** For each candidate put strike, keep only the call strike nearest the target net (i.e. the best-even pairing). */
function pickGoalCollars(
  items: RawCollar[],
  targetFloorPct: number,
  targetNetPerShare: number
): RawCollar[] {
  const bestByPut = new Map<string, RawCollar>();
  for (const r of items) {
    const key = `${r.expiry}:${r.putStrike}`;
    const cur = bestByPut.get(key);
    if (!cur || Math.abs(r.netMidPerShare - targetNetPerShare) < Math.abs(cur.netMidPerShare - targetNetPerShare)) {
      bestByPut.set(key, r);
    }
  }
  const bests = Array.from(bestByPut.values());
  bests.sort((a, b) => {
    const da = Math.abs(a.floorPct - targetFloorPct);
    const db = Math.abs(b.floorPct - targetFloorPct);
    if (da !== db) return da - db;
    return Math.abs(a.netMidPerShare - targetNetPerShare) - Math.abs(b.netMidPerShare - targetNetPerShare);
  });
  return bests.slice(0, MAX_RESULTS);
}

export async function handler(req: any, res: any): Promise<void> {
  const body: CollarRequest = req.body ?? {};
  const ticker = (body.ticker ?? "").trim().toUpperCase();
  if (!ticker) {
    res.status(200).json({ results: [], message: "Enter a ticker to scan collars." });
    return;
  }

  const shareCount = Math.max(0, Number(body.shareCount) || 0);
  const contractsFromShares = shareCount > 0 ? Math.max(1, Math.floor(shareCount / 100)) : 0;
  const targetFloorPct = clampTargetFloorPct(body.targetFloorPct);
  const targetNetPerShareRaw = Number(body.targetNetPerShare);
  const targetNetPerShare = Number.isFinite(targetNetPerShareRaw) ? targetNetPerShareRaw : 0;

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
      usingMonthMode,
      targetMonth: usingMonthMode ? body.targetMonth!.trim() : null,
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

    const raw: RawCollar[] = [];

    for (const expiry of expiries) {
      const dte = daysBetween(today, new Date(expiry + "Z"));
      let putStrikes = nearestPutStrikes(strikesFromMap(putMap, expiry), spot, targetFloorPct, PUT_CANDIDATE_COUNT);
      let callStrikes = callStrikesInBand(strikesFromMap(callMap, expiry), spot);

      if (isCustom) {
        putStrikes = [customPut];
        callStrikes = [customCall];
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

          const netMidPerShare = putQ.mid - callQ.mid;
          const netCostPerShare = putQ.ask - callQ.bid;
          const netMidPerContract = netMidPerShare * 100;
          const netCostPerContract = netCostPerShare * 100;
          const floorPct = ((putStrike - spot) / spot) * 100;
          const capPct = ((callStrike - spot) / spot) * 100;
          const bandWidthPct = capPct - floorPct;
          const evenScore = Math.abs(netMidPerShare);

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
            netMidPerShare: Math.round(netMidPerShare * 100) / 100,
            netMidPerContract: Math.round(netMidPerContract),
            floorPct: Math.round(floorPct * 10) / 10,
            capPct: Math.round(capPct * 10) / 10,
            bandWidthPct: Math.round(bandWidthPct * 10) / 10,
            evenScore: Math.round(evenScore * 100) / 100,
            isEven: evenScore <= EVEN_THRESHOLD,
            contractsFromShares,
          });
        }
      }

      if (isCustom) break;
    }

    if (raw.length === 0) {
      res.status(200).json({
        results: [],
        message: isCustom
          ? "Could not quote that put/call pair. Check strikes and expiry."
          : `No strikes found near a ${targetFloorPct}% floor for that expiry. Try a different floor target or expiry.`,
      });
      return;
    }

    if (isCustom) {
      const r = raw[0];
      const top: CollarResult[] = [{ ...r, rank: 1 }];
      res.status(200).json({
        results: top,
        spot,
        message: "Custom collar quoted.",
      });
      return;
    }

    const meaningful = raw.filter(isMeaningfulCollar);
    if (meaningful.length === 0) {
      res.status(200).json({
        results: [],
        message: `Scanned ${raw.length} pairs near a ${targetFloorPct}% floor but none had tradeable quotes. Try a different floor target or use custom strikes.`,
      });
      return;
    }

    const picks = pickGoalCollars(meaningful, targetFloorPct, targetNetPerShare);
    const top: CollarResult[] = picks.map((r, i) => ({
      ...r,
      rank: i + 1,
    }));

    res.status(200).json({
      results: top,
      spot,
      message:
        top.length > 0
          ? `Best match to a ${targetFloorPct}% floor: ${formatStrike(top[0].putStrike)} put / ${formatStrike(top[0].callStrike)} call.`
          : "No matches found.",
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Collar scan failed." });
  }
}

function formatStrike(n: number): string {
  return Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`;
}
