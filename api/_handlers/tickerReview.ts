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
      return otm >= minOtmPct && otm < maxOtmPct;
    }
    if (strike <= spot) return false;
    const otm = ((strike - spot) / spot) * 100;
    return otm >= minOtmPct && otm < maxOtmPct;
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
    const strike = Number(sk);
    if (!Number.isFinite(strike) || strike <= spot) continue;
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
    const strike = Number(sk);
    if (!Number.isFinite(strike) || strike >= spot) continue;
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

  const otmPctMin = clamp(Number(body.otmPctMin) || 5, 0, 39);
  const otmPctMax = clamp(Number(body.otmPctMax) || 40, otmPctMin + 0.5, 80);
  const topPerExpiry = Math.min(Math.max(1, Number(body.topPerExpiry) || 5), 15);
  const rankMode = parseRankMode(body.rankMode);
  const liquidityMode = parseLiquidityMode(body.liquidityMode);

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  if (maxExpDate.getTime() < today.getTime()) {
    res.status(400).json({ error: "maxExpiration must be today or later." });
    return;
  }

  const fromStr = today.toISOString().slice(0, 10);
  const toStr = maxExpiration;

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
      `Single-ticker review: ${rawTicker}, ${type === "P" ? "puts" : "calls"}, expiries through ${maxExpiration}, OTM ${otmPctMin}–${otmPctMax}%.`
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

    const chainParams = new URLSearchParams({
      symbol: rawTicker,
      contractType: "ALL",
      includeUnderlyingQuote: "FALSE",
      strategy: "SINGLE",
      fromDate: fromStr,
      toDate: toStr,
      strikeCount: "200",
    });
    const chainResp = await fetchSchwabWithRetry(
      `https://api.schwabapi.com/marketdata/v1/chains?${chainParams}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (chainResp.status === 429) {
      res.status(503).json({ error: "Schwab rate limit on option chain. Wait 30–60 s and retry." });
      return;
    }
    if (!chainResp.ok) {
      const t = await chainResp.text();
      res.status(502).json({ error: `Option chain failed for ${rawTicker}.`, detail: t.slice(0, 200) });
      return;
    }
    const chainBody: any = await chainResp.json();
    const callMap = chainBody?.callExpDateMap ?? {};
    const putMap = chainBody?.putExpDateMap ?? {};
    const primaryMap = type === "C" ? callMap : putMap;

    const skewPick = pickSkewExpiryMaps(callMap, putMap, today.getTime());
    const skewPct =
      skewPick != null
        ? computePutCallSkew(skewPick.callSO, skewPick.putSO, spot)
        : null;

    type Spec = {
      expiry: string;
      strike: number;
      impliedVolPctFromChain: number | null;
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
      if (expDate.getTime() < today.getTime()) continue;

      const strikesObj = primaryMap[expKey];
      if (!strikesObj || typeof strikesObj !== "object") continue;

      const strikes: number[] = [];
      for (const [strikeStr, contracts] of Object.entries<any>(strikesObj)) {
        const strike = Number(strikeStr);
        if (!Number.isFinite(strike) || strike <= 0) continue;
        if (Array.isArray(contracts) && contracts.length > 0) strikes.push(strike);
      }
      const validStrikes = getStrikesInRange(strikes, spot, otmPctMin, otmPctMax, type);
      for (const strike of validStrikes) {
        let contractsRaw: any = strikesObj[String(strike)];
        if (!Array.isArray(contractsRaw) || contractsRaw.length === 0) continue;
        const c0 = contractsRaw[0];
        if (c0?.isMini === true || c0?.isNonStandard === true) continue;
        specs.push({
          expiry,
          strike,
          impliedVolPctFromChain:
            c0 && typeof c0 === "object" ? impliedVolPercentFromQuote(c0) : null,
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
        `Large chain (${specs.length} contracts) — quoting in batches; this may take a moment.`
      );
    }

    type QuoteLite = {
      bid?: number;
      ask?: number;
      delta?: number;
      theta?: number;
      gamma?: number;
      openInterest?: number;
      totalVolume?: number;
      impliedVolPct?: number | null;
    };
    const optionQuotes: Record<string, QuoteLite> = {};
    const occEntries: { occ: string; key: string }[] = [];
    const seenOcc = new Set<string>();
    for (const s of specs) {
      const occ = toOCCSymbol(rawTicker, s.expiry, type, s.strike);
      const key = `${s.expiry} ${s.strike}`;
      if (seenOcc.has(occ)) continue;
      seenOcc.add(occ);
      occEntries.push({ occ, key });
    }

    const BATCH = 50;
    const batches: (typeof occEntries)[] = [];
    for (let i = 0; i < occEntries.length; i += BATCH) {
      batches.push(occEntries.slice(i, i + BATCH));
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
      for (const { occ, key } of batch) {
        const row = qBody[occ] ?? qBody[occ.replace(/\s+/g, "")];
        const qsrc =
          row?.quote && typeof row.quote === "object"
            ? row.quote
            : row?.optionContract && typeof row.optionContract === "object"
              ? row.optionContract
              : row?.option && typeof row.option === "object"
                ? row.option
                : row;
        if (!qsrc || typeof qsrc !== "object") continue;
        const num = (x: any): number | undefined =>
          typeof x === "number" && Number.isFinite(x) ? x : undefined;
        optionQuotes[key] = {
          bid: num(qsrc.bidPrice) ?? num(qsrc.bid),
          ask: num(qsrc.askPrice) ?? num(qsrc.ask),
          delta: num(qsrc.delta),
          theta: num(qsrc.theta),
          gamma: num(qsrc.gamma),
          openInterest: num(qsrc.openInterest) ?? num(qsrc.open_interest),
          totalVolume: num(qsrc.totalVolume) ?? num(qsrc.total_volume) ?? num(qsrc.volume),
          impliedVolPct: impliedVolPercentFromQuote(qsrc),
        };
      }
    });

    const byExpiry = new Map<string, ReviewRow[]>();
    const liquidityFiltered = { spread: 0, oi: 0 };

    for (const spec of specs) {
      const key = `${spec.expiry} ${spec.strike}`;
      const quote = optionQuotes[key];
      const bid = quote?.bid ?? 0;
      const ask = quote?.ask ?? 0;
      const optionPrice = isBuyToOpen ? (ask > 0 ? ask : bid) : bid > 0 ? bid : ask;
      if (optionPrice <= 0) continue;
      if (!isBuyToOpen && bid <= 0) {
        liquidityFiltered.spread++;
        continue;
      }
      if (isBuyToOpen && ask <= 0) {
        liquidityFiltered.spread++;
        continue;
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
      if (actualOtmPct < otmPctMin - BUFFER || actualOtmPct >= otmPctMax + BUFFER) continue;

      const otmForTier = actualOtmPct;
      const otmTierAdj =
        otmForTier <= 5 ? 0 : otmForTier <= 10 ? 0.12 : otmForTier <= 15 ? 0.25 : 0.45;
      let maxSpreadPct = (isBuyToOpen ? 0.42 : 0.35) + otmTierAdj;
      if (liquidityMode === "relaxed") maxSpreadPct += 0.12;
      const minOI = otmForTier <= 5 ? 25 : otmForTier <= 10 ? 12 : otmForTier <= 15 ? 6 : 3;
      const oi = quote?.openInterest ?? null;

      const liquidityFlags: string[] = [];
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
      const rawDelta = quote?.delta;
      const probITM =
        rawDelta != null
          ? clamp(Math.abs(rawDelta), 0.02, 0.98)
          : clamp(
              0.5 *
                Math.exp(-Math.abs(spot - spec.strike) / Math.max(spot, 1) * 12),
              0.02,
              0.98
            );
      const volume = quote?.totalVolume ?? 0;
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
      const ivPct = quote?.impliedVolPct ?? spec.impliedVolPctFromChain ?? null;
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
        const g = quote?.gamma;
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
        thetaPerDay: (() => {
          const th = quote?.theta;
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

    res.status(200).json({
      ticker: rawTicker,
      company: typeof company === "string" ? company : rawTicker,
      currentPrice: round2(spot),
      oneMonthPerfPct,
      realizedVol20dPct: realizedVol20dPct == null ? null : round2(realizedVol20dPct),
      skewPct,
      maxExpiration,
      optionType: type,
      positionSide: isBuyToOpen ? "buy" : "write",
      rankMode,
      otmRange: { min: otmPctMin, max: otmPctMax },
      topPerExpiry,
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
