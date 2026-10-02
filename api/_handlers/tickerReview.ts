// tickerReview.ts
// Single-ticker options review: one chain fetch, all expiries through a max date, top picks per expiry.

import { createClient } from "@supabase/supabase-js";
import {
  fetchSchwabWithRetry,
  getValidAccessToken,
  runSchwabPool,
  SCHWAB_RATE_LIMIT,
  throwIfSchwabRateLimited,
  toOCCSymbol,
} from "../_schwab-utils.js";

type LiquidityMode = "strict" | "relaxed" | "all";
type RankMode = "score" | "yield";

type ReviewRow = {
  rank: number;
  ticker: string;
  company: string;
  expiration: string;
  dte: number;
  oneMonthPerfPct: number | null;
  actualOtmPct: number;
  currentPrice: number;
  strike: number;
  bid: number;
  ask: number;
  limitPrice: number;
  annYieldPct: number;
  periodYieldPct: number;
  premiumPerContract: number;
  impliedVolPct: number | null;
  realizedVol20dPct: number | null;
  skewPct: number | null;
  delta: number | null;
  thetaPerDay: number | null;
  openInterest: number | null;
  score: number;
  liquidityFlags?: string[];
  schwabSymbol: string;
  occSymbol: string;
};

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000));
}

function parseLiquidityMode(raw: unknown): LiquidityMode {
  const v = String(raw ?? "strict").toLowerCase();
  if (v === "relaxed" || v === "all") return v;
  return "strict";
}

function parseRankMode(raw: unknown): RankMode {
  const v = String(raw ?? "score").toLowerCase();
  if (v === "yield" || v === "yield_only" || v === "yieldonly") return "yield";
  return "score";
}

function parseExpKeyToIso(expKey: string): string | null {
  const datePart = expKey.split(":")[0].trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return datePart;
  if (/^\d{8}$/.test(datePart)) {
    return `${datePart.slice(0, 4)}-${datePart.slice(4, 6)}-${datePart.slice(6, 8)}`;
  }
  return null;
}

function addUtcDays(d: Date, days: number): Date {
  const x = new Date(d.getTime());
  x.setUTCDate(x.getUTCDate() + days);
  return x;
}

function mergeStrikeMaps(
  into: Record<string, Record<string, unknown>>,
  from: Record<string, Record<string, unknown>> | null | undefined,
): void {
  if (!from || typeof from !== "object") return;
  for (const [expKey, strikeObj] of Object.entries(from)) {
    if (!strikeObj || typeof strikeObj !== "object") continue;
    if (!into[expKey]) {
      into[expKey] = { ...(strikeObj as Record<string, unknown>) };
      continue;
    }
    for (const [sk, contracts] of Object.entries(strikeObj)) {
      if (!into[expKey][sk]) into[expKey][sk] = contracts;
    }
  }
}

type QuoteLite = {
  bid?: number;
  ask?: number;
  mark?: number;
  last?: number;
  delta?: number;
  theta?: number;
  gamma?: number;
  openInterest?: number;
  totalVolume?: number;
  impliedVolPct?: number | null;
};

function quoteLiteFromChainContract(src: unknown): QuoteLite {
  if (!src || typeof src !== "object") return {};
  const c = src as Record<string, unknown>;
  const num = (x: unknown): number | undefined =>
    typeof x === "number" && Number.isFinite(x) ? x : undefined;
  return {
    bid: num(c.bidPrice) ?? num(c.bid),
    ask: num(c.askPrice) ?? num(c.ask),
    mark: num(c.markPrice) ?? num(c.mark),
    last: num(c.lastPrice) ?? num(c.last),
    delta: num(c.delta),
    theta: num(c.theta),
    gamma: num(c.gamma),
    openInterest: num(c.openInterest) ?? num(c.open_interest),
    totalVolume: num(c.totalVolume) ?? num(c.total_volume) ?? num(c.volume),
    impliedVolPct: impliedVolPercentFromQuote(c),
  };
}

function parseStrikeFromKey(strikeStr: string): number | null {
  const head = strikeStr.split(":")[0]?.trim() ?? "";
  const n = Number(head);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function contractsAtStrike(
  strikesObj: Record<string, unknown>,
  strike: number,
): unknown[] | null {
  for (const [sk, arr] of Object.entries(strikesObj)) {
    if (parseStrikeFromKey(sk) === strike && Array.isArray(arr) && arr.length > 0) {
      return arr;
    }
  }
  return null;
}

type PriceSource = "bid" | "ask" | "mid" | "mark" | "last" | "none";

function mergeQuoteLites(chain: QuoteLite, live?: QuoteLite): QuoteLite {
  if (!live) return chain;
  return {
    bid: live.bid ?? chain.bid,
    ask: live.ask ?? chain.ask,
    mark: live.mark ?? chain.mark,
    last: live.last ?? chain.last,
    delta: live.delta ?? chain.delta,
    theta: live.theta ?? chain.theta,
    gamma: live.gamma ?? chain.gamma,
    openInterest: live.openInterest ?? chain.openInterest,
    totalVolume: live.totalVolume ?? chain.totalVolume,
    impliedVolPct: live.impliedVolPct ?? chain.impliedVolPct,
  };
}

/** Premium for yield/score — prefer bid/ask midpoint when both sides quote; else mark/last for LEAPS. */
function resolveOptionPrice(
  lite: QuoteLite,
  isBuyToOpen: boolean,
  liquidityMode: LiquidityMode,
): { price: number; source: PriceSource; displayBid: number; displayAsk: number } {
  const bid = lite.bid ?? 0;
  const ask = lite.ask ?? 0;
  const mark = lite.mark ?? 0;
  const last = lite.last ?? 0;
  const mid = bid > 0 && ask > 0 ? (bid + ask) / 2 : 0;
  const allowMark = liquidityMode !== "strict";

  // Desk-style fair premium for yield/score: midpoint whenever the quote is two-sided.
  if (mid > 0) return { price: mid, source: "mid", displayBid: bid, displayAsk: ask };

  if (isBuyToOpen) {
    if (ask > 0) return { price: ask, source: "ask", displayBid: bid, displayAsk: ask };
    if (allowMark && mark > 0) {
      return { price: mark, source: "mark", displayBid: mark, displayAsk: mark };
    }
    if (allowMark && last > 0) {
      return { price: last, source: "last", displayBid: last, displayAsk: last };
    }
    if (bid > 0) return { price: bid, source: "bid", displayBid: bid, displayAsk: ask };
    return { price: 0, source: "none", displayBid: bid, displayAsk: ask };
  }

  if (bid > 0) return { price: bid, source: "bid", displayBid: bid, displayAsk: ask > 0 ? ask : bid };
  if (allowMark && mark > 0) {
    return { price: mark, source: "mark", displayBid: mark, displayAsk: ask > 0 ? ask : mark };
  }
  if (allowMark && last > 0) {
    return { price: last, source: "last", displayBid: last, displayAsk: ask > 0 ? ask : last };
  }
  return { price: 0, source: "none", displayBid: bid, displayAsk: ask };
}

function buildMonthChainWindows(from: Date, through: Date): Array<{ from: string; to: string }> {
  const out: Array<{ from: string; to: string }> = [];
  let cursor = new Date(from);
  while (cursor.getTime() <= through.getTime()) {
    const monthEnd = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 0));
    const winEnd = monthEnd.getTime() > through.getTime() ? new Date(through) : monthEnd;
    out.push({
      from: cursor.toISOString().slice(0, 10),
      to: winEnd.toISOString().slice(0, 10),
    });
    cursor = addUtcDays(winEnd, 1);
  }
  return out;
}

const numField = (x: unknown): number | undefined =>
  typeof x === "number" && Number.isFinite(x) ? x : undefined;

function impliedVolPercentFromQuote(src: any): number | null {
  const candidates = [
    numField(src?.volatility),
    numField(src?.impliedVolatility),
    numField(src?.implied_volatility),
    numField(src?.theoreticalOptionVol),
  ];
  for (const v of candidates) {
    if (v == null || v <= 0) continue;
    if (v > 0 && v <= 3) return v * 100;
    if (v > 3 && v < 450) return v;
  }
  return null;
}

function volIvRvMultiplier(isBuyToOpen: boolean, ivPct: number | null, rvPct: number | null): number {
  if (ivPct == null || rvPct == null || ivPct < 0.75 || rvPct < 0.75) return 1;
  if (isBuyToOpen) {
    const r = rvPct / ivPct;
    return clamp(1 + 0.4 * (r - 1), 0.60, 1.50);
  }
  const r = ivPct / rvPct;
  if (r >= 1) return clamp(1 + 0.40 * (r - 1), 1.0, 1.50);
  const coeff = r >= 0.90 ? 1.20 : 2.50;
  return clamp(1 + coeff * (r - 1), 0.25, 1.0);
}

function getStrikesInRange(
  strikes: number[],
  spot: number,
  minOtmPct: number,
  maxOtmPct: number,
  side: "C" | "P",
): number[] {
  return strikes.filter((strike) => {
    if (side === "P") {
      if (strike >= spot) return false;
      const otm = ((spot - strike) / spot) * 100;
      return otm >= minOtmPct && otm <= maxOtmPct;
    }
    if (strike <= spot) return false;
    const otm = ((strike - spot) / spot) * 100;
    return otm >= minOtmPct && otm <= maxOtmPct;
  });
}

function annualizedRealizedVolPctFromCloses(closes: number[]): number | null {
  const c = closes.filter((x) => typeof x === "number" && x > 0);
  if (c.length < 12) return null;
  const tail = c.length > 22 ? c.slice(-22) : c;
  const rets: number[] = [];
  for (let i = 1; i < tail.length; i++) {
    const a = tail[i - 1]!;
    const b = tail[i]!;
    if (a <= 0 || b <= 0) continue;
    rets.push(Math.log(b / a));
  }
  if (rets.length < 10) return null;
  const n = rets.length;
  const mean = rets.reduce((s, x) => s + x, 0) / n;
  const v = rets.reduce((s, x) => s + (x - mean) ** 2, 0) / Math.max(n - 1, 1);
  return Math.sqrt(v) * Math.sqrt(252) * 100;
}

function formatSchwabSymbol(args: {
  ticker: string;
  expiry: string;
  type: "C" | "P";
  strike: number;
}): string {
  const d = new Date(args.expiry + "T00:00:00Z");
  const mm = (d.getUTCMonth() + 1).toString().padStart(2, "0");
  const dd = d.getUTCDate().toString().padStart(2, "0");
  const yyyy = d.getUTCFullYear();
  const t = args.type === "P" ? "P" : "C";
  const strike =
    Math.round(args.strike) === args.strike ? args.strike.toString() : args.strike.toFixed(2);
  return `${args.ticker} ${mm}/${dd}/${yyyy} ${strike} ${t}`;
}

/** Review matrix: at most this many OTM columns, so one screenshot stays readable. */
const MAX_OTM_LEVELS = 5;

/**
 * Fixed OTM columns shared by every expiration. Anchoring on the scan's min OTM (rather than
 * each expiry's best strike) is what lets a reviewer read down a column and compare the same
 * distance across dates.
 */
function buildOtmLevels(minPct: number, maxPct: number): number[] {
  const span = Math.max(0, maxPct - minPct);
  const step = span >= 15 ? 5 : Math.max(1, Math.round((span / 3) * 2) / 2);
  const levels: number[] = [];
  for (let v = minPct; v <= maxPct + 1e-6 && levels.length < MAX_OTM_LEVELS; v += step) {
    levels.push(Math.round(v * 10) / 10);
  }
  return levels.length > 0 ? levels : [minPct];
}

function pickNearestOtm(rows: ReviewRow[], level: number, tolerance: number): ReviewRow | null {
  let best: ReviewRow | null = null;
  let bestDist = Infinity;
  for (const r of rows) {
    const dist = Math.abs(r.actualOtmPct - level);
    if (dist > tolerance) continue;
    if (dist < bestDist || (dist === bestDist && best != null && r.periodYieldPct > best.periodYieldPct)) {
      best = r;
      bestDist = dist;
    }
  }
  return best;
}

function sortRows(rows: ReviewRow[], rankMode: RankMode): ReviewRow[] {
  return [...rows].sort((a, b) => {
    if (rankMode === "yield") {
      if (b.periodYieldPct !== a.periodYieldPct) return b.periodYieldPct - a.periodYieldPct;
      if (b.score !== a.score) return b.score - a.score;
      return b.annYieldPct - a.annYieldPct;
    }
    if (b.score !== a.score) return b.score - a.score;
    if (b.periodYieldPct !== a.periodYieldPct) return b.periodYieldPct - a.periodYieldPct;
    return b.annYieldPct - a.annYieldPct;
  });
}

function computePutCallSkew(
  callStrikesObj: Record<string, any> | null,
  putStrikesObj: Record<string, any> | null,
  spot: number,
): number | null {
  const MIN_OTM = 5;
  const MAX_OTM = 20;
  let callSum = 0;
  let callCnt = 0;
  let putSum = 0;
  let putCnt = 0;

  for (const [sk, contracts] of Object.entries(callStrikesObj ?? {})) {
    const strike = parseStrikeFromKey(sk);
    if (strike == null || strike <= spot) continue;
    const otm = ((strike - spot) / spot) * 100;
    if (otm < MIN_OTM || otm >= MAX_OTM) continue;
    if (Array.isArray(contracts) && contracts.length > 0) {
      const c = contracts[0];
      if (c?.isMini || c?.isNonStandard) continue;
      const iv = impliedVolPercentFromQuote(c);
      if (iv != null && iv > 0) {
        callSum += iv;
        callCnt++;
      }
    }
  }
  for (const [sk, contracts] of Object.entries(putStrikesObj ?? {})) {
    const strike = parseStrikeFromKey(sk);
    if (strike == null || strike >= spot) continue;
    const otm = ((spot - strike) / spot) * 100;
    if (otm < MIN_OTM || otm >= MAX_OTM) continue;
    if (Array.isArray(contracts) && contracts.length > 0) {
      const c = contracts[0];
      if (c?.isMini || c?.isNonStandard) continue;
      const iv = impliedVolPercentFromQuote(c);
      if (iv != null && iv > 0) {
        putSum += iv;
        putCnt++;
      }
    }
  }
  if (callCnt === 0 || putCnt === 0) return null;
  return round2(putSum / putCnt - callSum / callCnt);
}

/** Nearest expiry to today that has both call and put maps (for skew). */
function pickSkewExpiryMaps(
  callMap: Record<string, any>,
  putMap: Record<string, any>,
  todayMs: number,
): { callSO: any; putSO: any } | null {
  const keys = new Set([...Object.keys(callMap), ...Object.keys(putMap)]);
  let best: { diff: number; callSO: any; putSO: any } | null = null;
  for (const key of keys) {
    const iso = parseExpKeyToIso(key);
    if (!iso) continue;
    const ms = new Date(iso + "T00:00:00Z").getTime();
    if (Number.isNaN(ms) || ms < todayMs) continue;
    const callSO = callMap[key];
    const putSO = putMap[key];
    if (!callSO || !putSO) continue;
    const diff = Math.abs(ms - todayMs);
    if (!best || diff < best.diff) best = { diff, callSO, putSO };
  }
  return best ? { callSO: best.callSO, putSO: best.putSO } : null;
}

export async function handler(req: any, res: any): Promise<void> {
  const body = req.body ?? {};

  const rawTicker = String(body.ticker ?? body.symbol ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
  if (!rawTicker || !/^[A-Z][A-Z0-9.-]{0,14}$/.test(rawTicker)) {
    res.status(400).json({ error: "ticker is required (e.g. MDB, AAPL)." });
    return;
  }

  const maxExpiration = typeof body.maxExpiration === "string" ? body.maxExpiration : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(maxExpiration)) {
    res.status(400).json({ error: "maxExpiration must be YYYY-MM-DD (latest expiry to include)." });
    return;
  }
  const maxExpDate = new Date(maxExpiration + "T00:00:00Z");
  if (Number.isNaN(maxExpDate.getTime())) {
    res.status(400).json({ error: "maxExpiration is not a valid date." });
    return;
  }

  const minExpirationRaw = typeof body.minExpiration === "string" ? body.minExpiration.trim() : "";
  let minExpiration = minExpirationRaw;
  if (minExpiration && !/^\d{4}-\d{2}-\d{2}$/.test(minExpiration)) {
    res.status(400).json({ error: "minExpiration must be YYYY-MM-DD (earliest expiry to include)." });
    return;
  }

  const optionTypeRaw = body.optionType ?? "puts";
  const optionType = String(optionTypeRaw).toLowerCase();
  const type: "P" | "C" =
    optionType === "calls" || optionType === "call" || optionType === "c" ? "C" : "P";

  const positionRaw = body.positionSide ?? body.position ?? "write";
  const positionNorm = String(positionRaw).toLowerCase();
  const isBuyToOpen =
    positionNorm === "buy" ||
    positionNorm === "long" ||
    positionNorm === "buytoopen" ||
    positionNorm === "buy_to_open";

  const otmPctMin = clamp(Number(body.otmPctMin) || 5, 0, 79);
  const otmPctMax = clamp(Number(body.otmPctMax) || 40, otmPctMin + 0.5, 85);
  const topPerExpiry = Math.min(Math.max(1, Number(body.topPerExpiry) || 5), 15);
  const rankMode = parseRankMode(body.rankMode);
  const liquidityMode = parseLiquidityMode(body.liquidityMode);
  const otmLevels = buildOtmLevels(otmPctMin, otmPctMax);
  const otmLevelTolerance = Math.max(
    2,
    otmLevels.length > 1 ? (otmLevels[1]! - otmLevels[0]!) / 2 : 2.5,
  );

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  if (!minExpiration) {
    minExpiration = today.toISOString().slice(0, 10);
  }
  const minExpDate = new Date(minExpiration + "T00:00:00Z");
  if (Number.isNaN(minExpDate.getTime())) {
    res.status(400).json({ error: "minExpiration is not a valid date." });
    return;
  }
  if (maxExpDate.getTime() < today.getTime()) {
    res.status(400).json({ error: "maxExpiration must be today or later." });
    return;
  }
  if (minExpDate.getTime() < today.getTime()) {
    res.status(400).json({ error: "minExpiration must be today or later." });
    return;
  }
  if (minExpDate.getTime() > maxExpDate.getTime()) {
    res.status(400).json({ error: "minExpiration must be on or before maxExpiration." });
    return;
  }

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
      res.status(401).json({ error: "Not authorized with Schwab. Run the Schwab login flow again." });
      return;
    }

    const accessToken = await getValidAccessToken(supabase, tokenRow);
    if (!accessToken) {
      res.status(401).json({ error: "Schwab token expired. Run the Schwab login flow again." });
      return;
    }

    const warnings: string[] = [];
    warnings.push(
      `Single-ticker review: ${rawTicker}, ${type === "P" ? "puts" : "calls"}, expiries ${minExpiration} through ${maxExpiration}, OTM ${otmPctMin}–${otmPctMax}%.`
    );

    const quotesResp = await fetchSchwabWithRetry(
      "https://api.schwabapi.com/marketdata/v1/quotes?" +
        new URLSearchParams({ symbols: rawTicker, fields: "quote,reference" }).toString(),
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    throwIfSchwabRateLimited(quotesResp);
    if (!quotesResp.ok) {
      const t = await quotesResp.text();
      res.status(502).json({ error: `Could not load quote for ${rawTicker}.`, detail: t.slice(0, 200) });
      return;
    }
    const quotesBody: any = await quotesResp.json();
    const q = quotesBody[rawTicker] ?? quotesBody[rawTicker.replace(/\s+/g, "")];
    const src = q?.quote ?? q;
    const spot =
      src?.lastPrice ??
      src?.last ??
      src?.close ??
      src?.regularMarketPrice;
    if (typeof spot !== "number" || spot <= 0) {
      res.status(404).json({ error: `No live price for ${rawTicker}.` });
      return;
    }
    const company =
      q?.reference?.description ??
      src?.description ??
      q?.description ??
      rawTicker;

    let oneMonthPerfPct: number | null = null;
    let realizedVol20dPct: number | null = null;
    try {
      const params = new URLSearchParams({
        symbol: rawTicker,
        periodType: "month",
        period: "2",
        frequencyType: "daily",
        frequency: "1",
        needExtendedHoursData: "false",
      });
      const histResp = await fetchSchwabWithRetry(
        `https://api.schwabapi.com/marketdata/v1/pricehistory?${params}`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      if (histResp.ok) {
        const histBody: any = await histResp.json();
        const candles = histBody?.candles ?? [];
        if (Array.isArray(candles) && candles.length >= 2) {
          const sorted = candles
            .slice()
            .sort((a: any, b: any) => (a.datetime ?? 0) - (b.datetime ?? 0));
          const closes = sorted
            .map((c: any) => (typeof c?.close === "number" ? c.close : NaN))
            .filter((x: number) => Number.isFinite(x) && x > 0);
          realizedVol20dPct = annualizedRealizedVolPctFromCloses(closes);
          const oneMonthAgo = new Date(today);
          oneMonthAgo.setUTCMonth(oneMonthAgo.getUTCMonth() - 1);
          const targetMs = oneMonthAgo.getTime();
          const start = sorted.find((c: any) => (c.datetime ?? 0) >= targetMs) ?? sorted[0];
          const startClose = start?.close ?? 0;
          if (startClose > 0 && spot > 0) oneMonthPerfPct = round2((spot / startClose - 1) * 100);
        }
      }
    } catch {
      /* supplemental */
    }

    const callMap: Record<string, Record<string, unknown>> = {};
    const putMap: Record<string, Record<string, unknown>> = {};
    const chainWindows = buildMonthChainWindows(today, maxExpDate);
    let chainWindowFailures = 0;

    await runSchwabPool(chainWindows, 3, async (win) => {
      const chainParams = new URLSearchParams({
        symbol: rawTicker,
        contractType: type === "C" ? "CALL" : "PUT",
        includeUnderlyingQuote: "FALSE",
        strategy: "SINGLE",
        range: "OTM",
        fromDate: win.from,
        toDate: win.to,
        strikeCount: "200",
      });
      const chainResp = await fetchSchwabWithRetry(
        `https://api.schwabapi.com/marketdata/v1/chains?${chainParams}`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      if (chainResp.status === 429) {
        throw new Error(SCHWAB_RATE_LIMIT);
      }
      if (!chainResp.ok) {
        chainWindowFailures++;
        return;
      }
      const chainBody: any = await chainResp.json();
      if (type === "C") {
        mergeStrikeMaps(callMap, chainBody?.callExpDateMap);
      } else {
        mergeStrikeMaps(putMap, chainBody?.putExpDateMap);
      }
    });

    // Skew needs both sides near term — one short ALL window.
    try {
      const skewTo = addUtcDays(today, 75);
      const skewEnd =
        skewTo.getTime() > maxExpDate.getTime() ? new Date(maxExpDate) : skewTo;
      const skewParams = new URLSearchParams({
        symbol: rawTicker,
        contractType: "ALL",
        includeUnderlyingQuote: "FALSE",
        strategy: "SINGLE",
        fromDate: today.toISOString().slice(0, 10),
        toDate: skewEnd.toISOString().slice(0, 10),
        strikeCount: "80",
      });
      const skewResp = await fetchSchwabWithRetry(
        `https://api.schwabapi.com/marketdata/v1/chains?${skewParams}`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      if (skewResp.ok) {
        const skewBody: any = await skewResp.json();
        mergeStrikeMaps(callMap, skewBody?.callExpDateMap);
        mergeStrikeMaps(putMap, skewBody?.putExpDateMap);
      }
    } catch {
      /* skew is supplemental */
    }

    if (chainWindowFailures > 0) {
      warnings.push(
        `${chainWindowFailures} of ${chainWindows.length} monthly chain request(s) failed — expiries may be incomplete.`,
      );
    }
    const primaryMap = type === "C" ? callMap : putMap;
    const expKeysFound = Object.keys(primaryMap).length;
    if (expKeysFound === 0) {
      res.status(502).json({ error: `Option chain returned no expirations for ${rawTicker}.` });
      return;
    }
    warnings.push(
      `Loaded ${expKeysFound} expiration(s) from Schwab (${chainWindows.length} monthly OTM chain request(s) through ${maxExpiration}).`,
    );

    const skewPick = pickSkewExpiryMaps(callMap, putMap, today.getTime());
    const skewPct =
      skewPick != null
        ? computePutCallSkew(skewPick.callSO, skewPick.putSO, spot)
        : null;

    type Spec = {
      expiry: string;
      strike: number;
      impliedVolPctFromChain: number | null;
      chainContract: Record<string, unknown>;
    };
    const specs: Spec[] = [];

    const expKeys = Object.keys(primaryMap).sort((a, b) => {
      const da = parseExpKeyToIso(a);
      const db = parseExpKeyToIso(b);
      if (!da || !db) return 0;
      return da.localeCompare(db);
    });

    for (const expKey of expKeys) {
      const expiry = parseExpKeyToIso(expKey);
      if (!expiry) continue;
      const expDate = new Date(expiry + "T00:00:00Z");
      if (expDate.getTime() > maxExpDate.getTime()) continue;
      if (expDate.getTime() < minExpDate.getTime()) continue;

      const strikesObj = primaryMap[expKey];
      if (!strikesObj || typeof strikesObj !== "object") continue;

      const strikes: number[] = [];
      for (const [strikeStr, contracts] of Object.entries<any>(strikesObj)) {
        const strike = parseStrikeFromKey(strikeStr);
        if (strike == null) continue;
        if (Array.isArray(contracts) && contracts.length > 0) strikes.push(strike);
      }
      const validStrikes = getStrikesInRange(strikes, spot, otmPctMin, otmPctMax, type);
      for (const strike of validStrikes) {
        const contractsRaw = contractsAtStrike(strikesObj, strike);
        if (!contractsRaw || contractsRaw.length === 0) continue;
        const c0 = contractsRaw[0];
        if (c0?.isMini === true || c0?.isNonStandard === true) continue;
        specs.push({
          expiry,
          strike,
          impliedVolPctFromChain:
            c0 && typeof c0 === "object" ? impliedVolPercentFromQuote(c0) : null,
          chainContract: c0 && typeof c0 === "object" ? (c0 as Record<string, unknown>) : {},
        });
      }
    }

    if (specs.length === 0) {
      res.status(200).json({
        ticker: rawTicker,
        company,
        currentPrice: round2(spot),
        oneMonthPerfPct,
        realizedVol20dPct: realizedVol20dPct == null ? null : round2(realizedVol20dPct),
        skewPct,
        minExpiration,
        maxExpiration,
        optionType: type,
        positionSide: isBuyToOpen ? "buy" : "write",
        rankMode,
        otmRange: { min: otmPctMin, max: otmPctMax },
        expirations: [],
        message: "No OTM contracts in range for the selected dates and filters.",
        warnings,
      });
      return;
    }

    if (specs.length > 800) {
      warnings.push(
        `Scoring ${specs.length} OTM contracts from chain data; live quotes fetched only for top picks per expiry.`,
      );
    }

    const byExpiry = new Map<string, ReviewRow[]>();
    const liquidityFiltered = { spread: 0, oi: 0 };

    for (const spec of specs) {
      const chainLite = quoteLiteFromChainContract(spec.chainContract);
      const { price: optionPrice, source: priceSource, displayBid, displayAsk } = resolveOptionPrice(
        chainLite,
        isBuyToOpen,
        liquidityMode,
      );
      if (optionPrice <= 0) {
        liquidityFiltered.spread++;
        continue;
      }
      const bid = displayBid;
      const ask = displayAsk;
      const liquidityFlags: string[] = [];
      if (priceSource === "mark" || priceSource === "last") {
        liquidityFlags.push("mark_pricing");
      }

      const expDate = new Date(spec.expiry + "T00:00:00Z");
      const dte = Math.max(1, daysBetween(today, expDate));

      const spread = ask > 0 && bid > 0 ? ask - bid : Math.max(ask, bid);
      const mid = ask > 0 && bid > 0 ? (ask + bid) / 2 : optionPrice;
      const spreadPct = mid > 0 ? spread / mid : 1;

      const actualOtmPct = round2(
        type === "C"
          ? ((spec.strike - spot) / spot) * 100
          : ((spot - spec.strike) / spot) * 100
      );
      const BUFFER = 2;
      if (actualOtmPct < otmPctMin - BUFFER || actualOtmPct > otmPctMax + BUFFER) continue;

      const otmForTier = actualOtmPct;
      const otmTierAdj =
        otmForTier <= 5 ? 0 : otmForTier <= 10 ? 0.12 : otmForTier <= 15 ? 0.25 : 0.45;
      let maxSpreadPct = (isBuyToOpen ? 0.42 : 0.35) + otmTierAdj;
      if (liquidityMode === "relaxed") maxSpreadPct += 0.12;
      const minOI = otmForTier <= 5 ? 25 : otmForTier <= 10 ? 12 : otmForTier <= 15 ? 6 : 3;
      const oi = chainLite.openInterest ?? null;

      let spreadPenalty = 1;
      let oiPenalty = 1;
      if (spreadPct > maxSpreadPct) {
        liquidityFiltered.spread++;
        if (liquidityMode === "strict") continue;
        liquidityFlags.push("wide_spread");
        spreadPenalty = liquidityMode === "all" ? 0.35 : 0.55;
      }
      if (oi != null && oi < minOI) {
        liquidityFiltered.oi++;
        if (liquidityMode === "strict") continue;
        liquidityFlags.push("low_oi");
        oiPenalty = liquidityMode === "all" ? 0.4 : 0.65;
      }

      const premiumPerContract = (isBuyToOpen ? -1 : 1) * optionPrice * 100;
      const notional = spec.strike * 100;
      const yieldPct = notional !== 0 ? (premiumPerContract / notional) * 100 : 0;
      const annYieldPct = yieldPct * (365 / dte);
      const annAbs = Math.abs(annYieldPct);
      const rawDelta = chainLite.delta;
      const probITM =
        rawDelta != null
          ? clamp(Math.abs(rawDelta), 0.02, 0.98)
          : clamp(
              0.5 *
                Math.exp(-Math.abs(spot - spec.strike) / Math.max(spot, 1) * 12),
              0.02,
              0.98
            );
      const volume = chainLite.totalVolume ?? 0;
      const volOiRatio = oi != null && oi > 0 && volume > 0 ? volume / oi : 0;
      const liqScore = clamp(
        ((1 - clamp(spreadPct / Math.max(maxSpreadPct, 0.0001), 0, 1)) * 0.5 +
          clamp((oi ?? 100) / 600, 0, 1) * 0.25 +
          clamp(volume / 300, 0, 1) * 0.15 +
          clamp(volOiRatio / 0.5, 0, 1) * 0.1) *
          spreadPenalty *
          oiPenalty,
        0.05,
        1
      );
      const ivPct = chainLite.impliedVolPct ?? spec.impliedVolPctFromChain ?? null;
      const rvPct = realizedVol20dPct;
      const volMult = volIvRvMultiplier(isBuyToOpen, ivPct, rvPct);
      const ivBonus = (() => {
        if (ivPct == null || ivPct <= 0) return 1.0;
        if (isBuyToOpen) return clamp(Math.sqrt(30 / Math.max(ivPct, 5)), 0.45, 1.8);
        return clamp(Math.sqrt(ivPct / 30), 0.35, 2.5);
      })();
      const baseScore = isBuyToOpen
        ? ((probITM * 100) / Math.max(annAbs, 0.05)) * liqScore * ivBonus
        : Math.min(annAbs, 80) * Math.pow(1 - probITM, 1.35) * liqScore * ivBonus;
      const gammaPenalty = (() => {
        if (isBuyToOpen) return 1;
        const g = chainLite.gamma;
        if (g == null || g <= 0) return 1;
        return clamp(1 - g * 5, 0.85, 1.0);
      })();
      const skewMult = (() => {
        if (skewPct == null) return 1.0;
        const s = clamp(skewPct, -30, 30);
        if (!isBuyToOpen) {
          return type === "P"
            ? clamp(1 + s * 0.008, 0.9, 1.2)
            : clamp(1 - s * 0.004, 0.9, 1.05);
        }
        return type === "P"
          ? clamp(1 - s * 0.008, 0.8, 1.1)
          : clamp(1 + s * 0.004, 0.9, 1.15);
      })();
      const score = baseScore * volMult * gammaPenalty * skewMult;

      const row: ReviewRow = {
        rank: 0,
        ticker: rawTicker,
        company: typeof company === "string" ? company : rawTicker,
        expiration: spec.expiry,
        dte,
        oneMonthPerfPct,
        actualOtmPct,
        currentPrice: round2(spot),
        strike: round2(spec.strike),
        bid: round2(bid),
        ask: round2(ask > 0 ? ask : bid),
        limitPrice: round2(optionPrice),
        annYieldPct: round2(annYieldPct),
        periodYieldPct: round2(yieldPct),
        premiumPerContract: round2(premiumPerContract),
        impliedVolPct: ivPct == null ? null : round2(ivPct),
        realizedVol20dPct: rvPct == null ? null : round2(rvPct),
        skewPct,
        delta: rawDelta != null ? round2(clamp(Math.abs(rawDelta), 0, 1)) : null,
        openInterest: oi != null && Number.isFinite(oi) ? Math.round(oi) : null,
        thetaPerDay: (() => {
          const th = chainLite.theta;
          if (th == null || !Number.isFinite(th)) return null;
          const perContract = th * 100;
          return round2(isBuyToOpen ? perContract : -perContract);
        })(),
        score: round2(score),
        ...(liquidityFlags.length > 0 ? { liquidityFlags } : {}),
        schwabSymbol: formatSchwabSymbol({
          ticker: rawTicker,
          expiry: spec.expiry,
          type,
          strike: spec.strike,
        }),
        occSymbol: toOCCSymbol(rawTicker, spec.expiry, type, spec.strike),
      };

      const list = byExpiry.get(spec.expiry) ?? [];
      list.push(row);
      byExpiry.set(spec.expiry, list);
    }

    if (liquidityFiltered.spread > 0 && liquidityMode === "strict") {
      warnings.push(`Excluded ${liquidityFiltered.spread} contracts with wide spread or missing ${isBuyToOpen ? "ask" : "bid"}.`);
    }
    if (liquidityFiltered.oi > 0 && liquidityMode === "strict") {
      warnings.push(`Excluded ${liquidityFiltered.oi} contracts with low open interest.`);
    }

    const buildMatrix = () =>
      [...byExpiry.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([expiration, rows]) => {
          const expDate = new Date(expiration + "T00:00:00Z");
          // A sparse far-dated ladder can put two columns on the same strike; show it once.
          const usedStrikes = new Set<number>();
          const cells = otmLevels.map((otmLevel) => {
            const pick = pickNearestOtm(rows, otmLevel, otmLevelTolerance);
            if (!pick || usedStrikes.has(pick.strike)) return { otmLevel, pick: null };
            usedStrikes.add(pick.strike);
            return { otmLevel, pick };
          });
          return {
            expiration,
            dte: Math.max(1, daysBetween(today, expDate)),
            cells,
          };
        })
        .filter((r) => r.cells.some((c) => c.pick != null));

    const expirations = [...byExpiry.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([expiration, rows]) => {
        const deduped = sortRows(rows, rankMode).slice(0, topPerExpiry);
        deduped.forEach((r, idx) => {
          r.rank = idx + 1;
        });
        const expDate = new Date(expiration + "T00:00:00Z");
        return {
          expiration,
          dte: Math.max(1, daysBetween(today, expDate)),
          picks: deduped,
        };
      })
      .filter((e) => e.picks.length > 0);

    let matrix = buildMatrix();

    warnings.push(
      `${specs.length} OTM contract(s) scored across ${byExpiry.size} expiration(s); returning top ${topPerExpiry} per expiry (${expirations.length} date(s) with picks).`,
    );
    warnings.push(
      `Review grid: ${matrix.length} expiration(s) × ${otmLevels.map((l) => `${l}%`).join(" / ")} OTM columns (nearest listed strike, ±${otmLevelTolerance}%).`,
    );

    const quoteRowSet = new Set<ReviewRow>();
    for (const block of expirations) {
      for (const row of block.picks) quoteRowSet.add(row);
    }
    for (const r of matrix) {
      for (const cell of r.cells) {
        if (cell.pick) quoteRowSet.add(cell.pick);
      }
    }

    const liveQuoteTargets: { occ: string; row: ReviewRow }[] = [];
    for (const row of quoteRowSet) {
      if (row.occSymbol) liveQuoteTargets.push({ occ: row.occSymbol, row });
    }
    if (liveQuoteTargets.length > 0) {
      const batches: (typeof liveQuoteTargets)[] = [];
      for (let i = 0; i < liveQuoteTargets.length; i += 50) {
        batches.push(liveQuoteTargets.slice(i, i + 50));
      }
      await runSchwabPool(batches, 4, async (batch) => {
        const qUrl =
          "https://api.schwabapi.com/marketdata/v1/quotes?" +
          new URLSearchParams({ symbols: batch.map((b) => b.occ).join(",") }).toString();
        const qResp = await fetchSchwabWithRetry(qUrl, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!qResp.ok) return;
        const qBody: any = await qResp.json();
        for (const { occ, row } of batch) {
          const raw = qBody[occ] ?? qBody[occ.replace(/\s+/g, "")];
          const qsrc =
            raw?.quote && typeof raw.quote === "object"
              ? raw.quote
              : raw?.optionContract && typeof raw.optionContract === "object"
                ? raw.optionContract
                : raw?.option && typeof raw.option === "object"
                  ? raw.option
                  : raw;
          const live = quoteLiteFromChainContract(qsrc);
          const resolved = resolveOptionPrice(live, isBuyToOpen, liquidityMode);
          if (resolved.price <= 0) continue;
          row.bid = round2(resolved.displayBid);
          row.ask = round2(resolved.displayAsk > 0 ? resolved.displayAsk : resolved.displayBid);
          row.limitPrice = round2(resolved.price);
          const notional = row.strike * 100;
          const prem = (isBuyToOpen ? -1 : 1) * resolved.price * 100;
          row.premiumPerContract = round2(prem);
          row.periodYieldPct = round2(notional !== 0 ? (prem / notional) * 100 : 0);
          row.annYieldPct = round2(row.periodYieldPct * (365 / Math.max(1, row.dte)));
          if (live.delta != null) row.delta = round2(clamp(Math.abs(live.delta), 0, 1));
          if (live.impliedVolPct != null) row.impliedVolPct = round2(live.impliedVolPct);
          const liveOi = live.openInterest ?? null;
          if (liveOi != null && Number.isFinite(liveOi)) row.openInterest = Math.round(liveOi);
        }
      });
      for (const block of expirations) {
        const resorted = sortRows(block.picks, rankMode).slice(0, topPerExpiry);
        resorted.forEach((r, idx) => {
          r.rank = idx + 1;
        });
        block.picks = resorted;
      }
      matrix = buildMatrix();
    }

    res.status(200).json({
      ticker: rawTicker,
      company: typeof company === "string" ? company : rawTicker,
      currentPrice: round2(spot),
      oneMonthPerfPct,
      realizedVol20dPct: realizedVol20dPct == null ? null : round2(realizedVol20dPct),
      skewPct,
      minExpiration,
      maxExpiration,
      optionType: type,
      positionSide: isBuyToOpen ? "buy" : "write",
      rankMode,
      otmRange: { min: otmPctMin, max: otmPctMax },
      topPerExpiry,
      otmLevels,
      matrix,
      expirations,
      message: expirations.length === 0 ? "No liquid contracts matched filters." : null,
      warnings,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === SCHWAB_RATE_LIMIT) {
      res.status(503).json({ error: "Schwab rate limit. Wait a moment and retry." });
      return;
    }
    console.error("tickerReview error", err);
    res.status(500).json({ error: "Unexpected error reviewing ticker options." });
  }
}
