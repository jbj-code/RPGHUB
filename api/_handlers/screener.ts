// Options Opportunity Screener
// Uses a hardcoded broad US equity universe (no external CSV) plus Schwab's live
// movers endpoint to capture high-volatility candidates. Fetches price history to
// compute 20-day realized vol, then focuses chain fetches on the top 100 most-volatile
// names. Ranks by a volatility-weighted composite score: annualised yield × ivBonus
// (sqrt of IV/30) × IV/RV ratio × put-call skew multiplier × gamma penalty.

import { createClient } from "@supabase/supabase-js";
import { toOCCSymbol, getValidAccessToken } from "../_schwab-utils.js";

const RATE_LIMIT_ERR = "SCHWAB_RATE_LIMIT";

function throwIfRateLimited(resp: Response, _context: string): void {
  if (resp.status === 429) throw new Error(RATE_LIMIT_ERR);
}

// ─── Broad US equity universe ──────────────────────────────────────────────
// Hardcoded so the screener never depends on an external CSV.
// Covers S&P 500 components + popular NASDAQ/growth + major liquid ETFs.
// Company names are fetched from Schwab quote `description` fields at scan time.
const UNIVERSE_SYMBOLS: string[] = [
  // Mega / large cap tech
  "AAPL","MSFT","NVDA","AMZN","META","GOOGL","GOOG","TSLA","AVGO","ORCL",
  "CRM","ADBE","AMD","INTC","QCOM","TXN","MU","AMAT","LRCX","KLAC",
  "MRVL","ADI","CDNS","SNPS","CSCO","IBM","ACN","NOW","INTU","WDAY",
  "HUBS","VEEV","ANSS","HPE","HPQ","DELL","NTAP","WDC","STX","JNPR",
  "FFIV","CTSH","EPAM",
  // SaaS / cloud / fintech
  "DDOG","ZS","NET","CRWD","PANW","FTNT","OKTA","SNOW","PLTR","TEAM",
  "SQ","SHOP","ZM","DOCU","ABNB","UBER","LYFT","DASH","COIN",
  "HOOD","SOFI","UPST","AFRM","BILL","MDB","GTLB","PCTY","PAYC","APP",
  "HIMS","DOCS","APPN","CSGP","ASAN","SMAR",
  "TWLO","PINS","PATH","DOCN","DUOL","MNDY","ZI","BRZE","OPEN","IOT",
  // Semiconductors (additional)
  "ON","SWKS","QRVO","MPWR","MCHP","AMKR","ENTG","ONTO","ACLS","UCTT",
  "MKSI","NVMI","COHU","FORM",
  // Media / streaming
  "NFLX","DIS","CMCSA","CHTR","T","VZ","TMUS","PARA","SPOT","WBD","ROKU",
  // Healthcare – pharma / biotech
  "UNH","LLY","JNJ","ABBV","MRK","ABT","TMO","DHR","BMY",
  "AMGN","GILD","VRTX","REGN","BIIB","ISRG","MDT","EW","SYK","BSX","BDX",
  "ZBH","HOLX","MTD","A","IDXX","IQV","MRNA","BNTX","ALNY","IONS",
  "EXEL","INCY","BMRN","DXCM","ALGN","PODD","NVCR","ACAD","BEAM","FATE",
  // Healthcare services
  "CVS","CI","HCA","HUM","CNC","ELV","MCK","ABC","CAH","TDOC",
  // Financials
  "V","MA","PYPL","SPGI","MCO","ICE","CME","CB","AON","MMC","TRV","ALL",
  "PGR","AIG","PRU","MET","AFL","BK","STT","NTRS","SCHW","FIS","FISV",
  "GPN","JPM","BAC","WFC","GS","MS","AXP","C","USB","PNC","TFC","COF",
  "DFS","ALLY","SYF","WEX","MKTX","RJF","SF","LPLA",
  // Consumer discretionary
  "COST","WMT","HD","LOW","TGT","MCD","SBUX","CMG","YUM","DPZ","NKE",
  "TJX","ROST","BURL","LULU","EL","W","CHWY","ETSY","EBAY","BBY","DKS",
  "ULTA","RH","ONON","CROX",
  // Consumer staples
  "PG","KO","PEP","PM","MO","MDLZ","HRL","HSY","K","KHC","GIS","CPB",
  "MKC","SJM","CLX","STZ","CHD","COTY","ELF",
  // Energy
  "XOM","CVX","COP","EOG","SLB","OXY","PSX","VLO","MPC","KMI","WMB",
  "DVN","FANG","HES","APA","MRO","PXD","HAL","BKR","RIG","HP",
  // Industrials
  "CAT","DE","HON","RTX","GE","LMT","BA","NOC","GD","LHX","TDG","ITW",
  "ETN","EMR","ROK","IR","GWW","MMM","UPS","FDX","NSC","CSX","UNP","WAB",
  "GNRC","TT","JCI","AME","FAST","GGG",
  // Materials
  "LIN","APD","SHW","FCX","NEM","GOLD","ALB","EMN","CF","MOS","NUE",
  "STLD","PKG","SEE","CCK","ATI",
  // Utilities
  "NEE","DUK","SO","D","AEP","EXC","SRE","PCG","ED","WEC","XEL","AWK",
  "ES","DTE","CEG","VST",
  // REITs
  "AMT","PLD","CCI","EQIX","SPG","O","WELL","PSA","EXR","AVB","EQR",
  "ARE","DLR","NNN","VICI","BXP","VNO","IRM","CBRE",
  // Auto / EV
  "F","GM","RIVN","LCID","NIO","LI","XPEV","RACE",
  // China ADRs (liquid options)
  "BABA","JD","PDD","BIDU","BILI","NTES","TME",
  // Gaming / entertainment
  "EA","TTWO","RBLX","U","CAVA",
  // Semiconductors (additional high-IV / AI-adjacent)
  "ARM","AXON",
  // Travel / hospitality / airlines
  "MAR","HLT","H","LVS","MGM","WYNN","RCL","CCL","NCLH",
  "AAL","DAL","UAL","LUV","JBLU","CZR",
  // High-vol narrative / crypto-adjacent
  "MARA","RIOT","DKNG","CELH","SNAP","SMCI",
  // S&P 500 additions — fills coverage gaps toward full index
  // Financials (regional banks + insurance + exchanges)
  "FITB","RF","CFG","HBAN","KEY","MTB","ZION",
  "HIG","WTW","CINF","AIZ","L","CBOE","MSCI","VRSK","FDS","AJG",
  // Technology / professional services
  "ADP","PAYX","CDW","GDDY","CTSH",
  // Consumer / retail / homebuilders
  "ORLY","AZO","LEN","DHI","PHM","NVR","TOL","TSCO","DECK","RL","PVH","TPR","VFC",
  // Industrials / transport / waste
  "CARR","OTIS","WM","RSG","CTAS","EXPD","CHRW","JBHT","XPO","SAIA","PWR","PCAR",
  // Materials / chemicals
  "PPG","IFF","LYB","BALL","OLN","FMC","RPM",
  // Healthcare / med-tech additions
  "STE","WAT","CRL","ZTS","RVTY","PODD",
  // Renewables / clean energy (high IV)
  "FSLR","ENPH","PLUG","BE",
  // Utilities additions
  "PEG","AES","CMS","PPL","LNT","AEE","ETR","FE","EIX",
  // REITs additions
  "HST","KIM","MAA","FRT","CPT","UDR","CUBE",
  // Liquid ETFs (broad options market)
  "SPY","QQQ","IWM","GLD","SLV","TLT","HYG","EFA","EEM","GDX",
  "XLF","XLK","XLE","XLV","XLI","XLY","XLP","XLU","XLB","XLRE",
  "ARKK","SMH","SOXX","VNQ","KWEB",
];

// ─── Schwab movers (live volatile stocks) ─────────────────────────────────
type UniverseRow = { symbol: string; company: string };

async function fetchMovers(accessToken: string): Promise<UniverseRow[]> {
  // Query movers for major indices — these are today's highest-moving stocks,
  // ideal candidates for elevated IV / premium.
  const indices = ["%24SPX", "%24COMPX", "%24DJI"];
  const sorts = ["PERCENT_CHANGE_UP", "PERCENT_CHANGE_DOWN"];
  const seen = new Set<string>();
  const out: UniverseRow[] = [];

  await Promise.allSettled(
    indices.flatMap((index) =>
      sorts.map(async (sort) => {
        try {
          const url = `https://api.schwabapi.com/marketdata/v1/movers/${index}?sort=${sort}&frequency=0`;
          const resp = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
          if (!resp.ok) return;
          const body: any = await resp.json();
          // Schwab can return { screeners: [...] } or just an array
          const movers: any[] = Array.isArray(body)
            ? body
            : Array.isArray(body?.screeners)
              ? body.screeners
              : [];
          for (const m of movers) {
            const sym = typeof m?.symbol === "string" ? m.symbol.toUpperCase().trim() : null;
            if (!sym || seen.has(sym)) continue;
            seen.add(sym);
            out.push({
              symbol: sym,
              company: typeof m?.description === "string" ? m.description : sym,
            });
          }
        } catch {
          // Movers are supplemental — silently skip on error
        }
      })
    )
  );
  return out;
}

async function fetchEquityQuotesBatched(
  symbols: string[],
  accessToken: string
): Promise<Record<string, unknown>> {
  const QUOTE_BATCH = 45;
  const merged: Record<string, unknown> = {};
  for (let i = 0; i < symbols.length; i += QUOTE_BATCH) {
    const batch = symbols.slice(i, i + QUOTE_BATCH);
    // Only request quote + reference — fundamental is not consumed here and bloats the payload.
    const url =
      "https://api.schwabapi.com/marketdata/v1/quotes?" +
      new URLSearchParams({ symbols: batch.join(","), fields: "quote,reference" }).toString();
    let quotesResp: Response | null = null;
    // One retry for transient 5xx / gateway errors (Schwab occasionally hiccups).
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 1500));
      quotesResp = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
      throwIfRateLimited(quotesResp, "equity_quotes");
      if (quotesResp.ok || quotesResp.status < 500) break; // only retry on 5xx
    }
    if (!quotesResp!.ok) {
      const t = await quotesResp!.text();
      throw new Error(`SCHWAB_QUOTES_${quotesResp!.status}:${t.slice(0, 240)}`);
    }
    const quotesBody = (await quotesResp!.json()) as Record<string, unknown>;
    Object.assign(merged, quotesBody);
  }
  return merged;
}

type RankedOption = {
  rank: number;
  ticker: string;
  company: string;
  oneMonthPerfPct: number | null;
  /** Broad frontend section key (5 | 10 | 15 | 20). */
  otmPct: number;
  /** 1 % sub-band label used for diversity selection (not sent to frontend). */
  subBandPct: number;
  /** Real OTM % computed from strike / spot price. */
  actualOtmPct: number;
  currentPrice: number;
  strike: number;
  bid: number;
  ask: number;
  /** Bid when selling to open, ask when buying to open — used for yield / cost %. */
  limitPrice: number;
  annYieldPct: number;
  premiumPerContract: number;
  /** Schwab implied vol when present (%), else null. */
  impliedVolPct: number | null;
  /** ~20 trading-day annualized realized vol from daily closes (%), else null. */
  realizedVol20dPct: number | null;
  /** Put-call skew (avg OTM put IV − avg OTM call IV) for this underlying, in percentage points. */
  skewPct: number | null;
  /** |delta| from option quote (0–1). Approximates probability of finishing ITM / being assigned. */
  delta: number | null;
  /** Theta from option quote: dollars of time-decay earned (write) or lost (buy) per calendar day per contract. */
  thetaPerDay: number | null;
  /** Internal composite score used for ranking (higher is better). */
  score: number;
  schwabSymbol: string;
  occSymbol: string;
};

type OptionQuoteLite = {
  bid?: number;
  ask?: number;
  delta?: number;
  theta?: number;
  gamma?: number;
  openInterest?: number;
  totalVolume?: number;
  impliedVolPct?: number | null;
};

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function toExpiryYYYYMMDD(expKey: string): string {
  const datePart = expKey.split(":")[0].trim();
  if (/^\d{8}$/.test(datePart)) {
    return `${datePart.slice(0, 4)}-${datePart.slice(4, 6)}-${datePart.slice(6, 8)}`;
  }
  return datePart;
}

function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Annualized realized vol (%) from daily closes: sample stdev of log returns × √252. */
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
  const sd = Math.sqrt(v);
  return sd * Math.sqrt(252) * 100;
}

const numField = (x: unknown): number | undefined =>
  typeof x === "number" && Number.isFinite(x) ? x : undefined;

/** Normalize Schwab IV to percent (e.g. 28.5). Accepts decimal (0–3) or percent (3–400). */
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

/**
 * Tilt score using IV vs short realized vol (same underlying).
 *
 * WRITES (sell to open):
 *   IV > RV (r > 1): coefficient 0.40 → up to +50 % boost, cap 1.50.
 *   IV < RV (r < 1): TWO-TIER steep penalty.
 *     r ≥ 0.90: coefficient 1.20 (moderate — premium is slightly cheap but still collectable)
 *     r < 0.90: coefficient 2.50 (severe  — stock is meaningfully out-moving implied vol;
 *               writing here is statistically negative-expectancy, essentially eliminate it)
 *   Floor 0.25 ensures even the worst case doesn't produce a negative score.
 *
 * BUYS (buy to open):
 *   RV > IV (r > 1): coefficient 0.40 → up to +50 % boost (cheap options vs realised move).
 *   RV < IV (r < 1): coefficient 0.40 → symmetric mild penalty.
 *   Both clamped [0.60, 1.50].
 */
function volIvRvMultiplier(isBuyToOpen: boolean, ivPct: number | null, rvPct: number | null): number {
  if (ivPct == null || rvPct == null || ivPct < 0.75 || rvPct < 0.75) return 1;
  if (isBuyToOpen) {
    const r = rvPct / ivPct;
    return clamp(1 + 0.4 * (r - 1), 0.60, 1.50);
  }
  const r = ivPct / rvPct;
  if (r >= 1) return clamp(1 + 0.40 * (r - 1), 1.0, 1.50);
  // Cheap-premium penalty for writes — two-tier steepness
  const coeff = r >= 0.90 ? 1.20 : 2.50;
  return clamp(1 + coeff * (r - 1), 0.25, 1.0);
}

/** Non-empty validated list from client → scan only these symbols (no movers merge). */
function normalizeClientUniverse(raw: unknown): string[] | null {
  if (raw == null) return null;
  if (!Array.isArray(raw)) return null;
  if (raw.length === 0) return null;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    const s = String(item ?? "")
      .trim()
      .toUpperCase()
      .replace(/\s+/g, "");
    if (!s || !/^[A-Z][A-Z0-9.-]{0,14}$/.test(s)) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out.length > 0 ? out : null;
}

function formatSchwabSymbol(args: {
  ticker: string;
  expiry: string;
  type: "C" | "P";
  strike: number;
}): string {
  const d = new Date(args.expiry + "Z");
  const mm = (d.getUTCMonth() + 1).toString().padStart(2, "0");
  const dd = d.getUTCDate().toString().padStart(2, "0");
  const yyyy = d.getUTCFullYear();
  const t = args.type === "P" ? "P" : "C";
  const strike =
    Math.round(args.strike) === args.strike ? args.strike.toString() : args.strike.toFixed(2);
  return `${args.ticker} ${mm}/${dd}/${yyyy} ${strike} ${t}`;
}

/**
 * Fetch market cap for each ticker via /instruments?projection=fundamental.
 * Schwab returns marketCap in full dollars (e.g. DDOG ≈ 45816670078 = $45.8B).
 *
 * Uses comma-separated batches of 20 symbols per request (confirmed working).
 * Response shape: { "instruments": [{ symbol, fundamental: { marketCap, ... } }] }
 */
async function fetchMarketCapsBatched(
  tickers: string[],
  accessToken: string,
): Promise<Record<string, number | null>> {
  const caps: Record<string, number | null> = {};
  const BATCH = 25;
  for (let i = 0; i < tickers.length; i += BATCH) {
    if (i > 0) await new Promise((r) => setTimeout(r, 80));
    const batch = tickers.slice(i, i + BATCH);
    try {
      const url =
        `https://api.schwabapi.com/marketdata/v1/instruments?` +
        new URLSearchParams({ symbol: batch.join(","), projection: "fundamental" }).toString();
      const resp = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!resp.ok) continue;
      const body: any = await resp.json();

      // Normalise to an array of instrument objects
      let instruments: any[];
      if (Array.isArray(body)) {
        instruments = body;
      } else if (Array.isArray(body?.instruments)) {
        instruments = body.instruments;               // most common: { "instruments": [...] }
      } else if (typeof body === "object" && body !== null) {
        // Symbol-keyed map: { "DDOG": { fundamental: {...} } }
        instruments = Object.entries(body).map(([sym, val]) => ({
          symbol: sym,
          ...((val as any) ?? {}),
        }));
      } else {
        continue;
      }

      for (const inst of instruments) {
        const sym = inst?.symbol?.toUpperCase?.();
        if (!sym) continue;
        const mc = inst?.fundamental?.marketCap;
        caps[sym] = typeof mc === "number" && Number.isFinite(mc) && mc > 0 ? mc : null;
      }
    } catch {
      // Mark batch as unavailable rather than crashing the whole scan
      for (const ticker of batch) {
        if (!(ticker in caps)) caps[ticker] = null;
      }
    }
  }
  return caps;
}

/**
 * OTM buckets for the screener. Each bucket covers a range of OTM distances so that
 * every listed strike within the band is evaluated and the best-ranked contract surfaces,
 * rather than locking onto one "closest" strike per target level.
 *
 *  5-bucket  →  5% – 9.9% OTM   (higher risk, higher yield)
 * 10-bucket  → 10% – 14.9% OTM  (aggressive)
 * 15-bucket  → 15% – 19.9% OTM  (moderate)
 * 20-bucket  → 20% – 30%   OTM  (conservative)
 */
// 1% granularity from 5 % through 29 % (upper bound of last bucket = 30 %).
// Finer bands let the diversity-selection step populate every OTM sub-level so the
// user sees options at 5 %, 6 %, 7 % … not just the "sweet-spot" 7–8 % cluster.
const OTM_BUCKETS = Array.from({ length: 25 }, (_, i) => ({ label: i + 5, min: i + 5, max: i + 6 }));

/** Map a 1 % bucket label to the broad frontend section key (5 | 10 | 15 | 20). */
function broadBucket(label: number): 5 | 10 | 15 | 20 {
  if (label >= 20) return 20;
  if (label >= 15) return 15;
  if (label >= 10) return 10;
  return 5;
}

/** Returns every OTM strike in [minOtmPct, maxOtmPct) for the given side. */
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
    } else {
      if (strike <= spot) return false;
      const otm = ((strike - spot) / spot) * 100;
      return otm >= minOtmPct && otm < maxOtmPct;
    }
  });
}

/**
 * Put-call skew: average IV of OTM puts (5–20 %) minus average IV of equidistant OTM calls.
 * Positive value = market is paying up for downside protection (normal / fearful market).
 * Uses whichever strikes are present in the chain response.
 */
function computePutCallSkew(
  callStrikesObj: Record<string, any> | null,
  putStrikesObj: Record<string, any> | null,
  spot: number,
): number | null {
  const MIN_OTM = 5, MAX_OTM = 20;
  let callSum = 0, callCnt = 0, putSum = 0, putCnt = 0;

  for (const [sk, contracts] of Object.entries(callStrikesObj ?? {})) {
    const strike = Number(sk);
    if (!Number.isFinite(strike) || strike <= spot) continue;
    const otm = ((strike - spot) / spot) * 100;
    if (otm < MIN_OTM || otm >= MAX_OTM) continue;
    if (Array.isArray(contracts) && contracts.length > 0) {
      const c = contracts[0];
      if (c?.isMini || c?.isNonStandard) continue;
      const iv = impliedVolPercentFromQuote(c);
      if (iv != null && iv > 0) { callSum += iv; callCnt++; }
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
      if (iv != null && iv > 0) { putSum += iv; putCnt++; }
    }
  }
  if (callCnt === 0 || putCnt === 0) return null;
  return round2(putSum / putCnt - callSum / callCnt);
}

export async function handler(req: any, res: any): Promise<void> {
  const body = req.body ?? {};

  const optionTypeRaw = body.optionType ?? "puts";
  const optionType = String(optionTypeRaw).toLowerCase();
  const type: "P" | "C" =
    optionType === "calls" || optionType === "call" || optionType === "c" ? "C" : "P";

  const positionRaw = body.positionSide ?? body.position ?? "write";
  const positionNorm = String(positionRaw).toLowerCase();
  /** Sell to open (collect premium) vs buy to open (pay debit). */
  const isBuyToOpen =
    positionNorm === "buy" ||
    positionNorm === "long" ||
    positionNorm === "buytoopen" ||
    positionNorm === "buy_to_open";

  const expiration = typeof body.expiration === "string" ? body.expiration : "";
  const isValidExpiry = /^\d{4}-\d{2}-\d{2}$/.test(expiration);
  const expiryDate = isValidExpiry ? new Date(expiration + "T00:00:00Z") : null;
  if (!isValidExpiry || !expiryDate || Number.isNaN(expiryDate.getTime())) {
    res.status(400).json({ error: "expiration must be YYYY-MM-DD" });
    return;
  }

  const _otmRaw = Array.isArray(body.otmLevels)
    ? body.otmLevels
        .map((n: any) => Number(n))
        .filter((n: number) => Number.isFinite(n) && n >= 5) // 5% is the minimum meaningful OTM level
    : [];
  const otmLevels = _otmRaw.length > 0 ? _otmRaw : [5, 10, 15, 20];

  const topN = Math.min(Math.max(1, Number(body.topN) || 5), 20);
  const minMarketCap = body.minMarketCap != null ? Number(body.minMarketCap) : null;
  // Two-tier cap: survey a wide universe through price history, then focus chain
  // fetches on the most volatile names (highest realized vol = richest options).
  // Price-history concurrency raised to 20 (vs 10) to keep the history step under ~8 s
  // even at 280 underlyings. Chain concurrency stays at 10 — each chain call is heavier.
  const MAX_HISTORY_UNDERLYINGS = 280;
  const MAX_CHAIN_UNDERLYINGS = 120;

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

    let clientUniverse: string[] | null = null;
    if (body.universeSymbols !== undefined && body.universeSymbols !== null) {
      if (!Array.isArray(body.universeSymbols)) {
        res.status(400).json({ error: "universeSymbols must be an array of ticker strings." });
        return;
      }
      clientUniverse = normalizeClientUniverse(body.universeSymbols);
      if (body.universeSymbols.length > 0 && (clientUniverse == null || clientUniverse.length === 0)) {
        res.status(400).json({ error: "No valid ticker symbols in universeSymbols." });
        return;
      }
    }

    const warnings: string[] = [];

    // 1) Build universe: custom ticker list OR hardcoded base + live Schwab movers
    let allRows: UniverseRow[];
    const companyBySymbol: Record<string, string> = {};

    if (clientUniverse && clientUniverse.length > 0) {
      allRows = clientUniverse.map((s) => ({ symbol: s, company: "" }));
    } else {
      const [moversRows] = await Promise.allSettled([fetchMovers(accessToken)]);
      const moverSymbols: UniverseRow[] =
        moversRows.status === "fulfilled" ? moversRows.value : [];
      const baseSet = new Set(UNIVERSE_SYMBOLS);
      const newMovers = moverSymbols.filter((m) => !baseSet.has(m.symbol));
      allRows = [
        ...UNIVERSE_SYMBOLS.map((s) => ({ symbol: s, company: "" })),
        ...newMovers,
      ];
      for (const r of moverSymbols) companyBySymbol[r.symbol] = r.company;
      if (moverSymbols.length > 0) {
        warnings.push(
          `Live Schwab movers: ${moverSymbols.length} fetched, ${newMovers.length} new (not already in base universe).`
        );
      } else if (moversRows.status === "rejected") {
        warnings.push("Schwab movers unavailable — scanning base universe only.");
      }
    }

    const tickers = allRows.map((r) => r.symbol);

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const dte = Math.max(1, daysBetween(today, expiryDate));
    // Widen the chain date window by ±3 days so holiday-shifted expirations are included
    // (e.g. Juneteenth shifts the June monthly from the 19th to the 18th in Schwab's chain).
    // The best-match logic below picks whichever returned expiry is closest to the requested date.
    const fromDateObj = new Date(expiryDate.getTime() - 3 * 24 * 60 * 60 * 1000);
    const toDateObj   = new Date(expiryDate.getTime() + 3 * 24 * 60 * 60 * 1000);
    const fromStr = fromDateObj.toISOString().slice(0, 10);
    const toStr   = toDateObj.toISOString().slice(0, 10);

    // 2) Equity quotes: current price + company description
    const quotesBody: any = await fetchEquityQuotesBatched(tickers, accessToken);

    const currentPriceByTicker: Record<string, number> = {};

    for (const sym of tickers) {
      const q = quotesBody[sym] ?? quotesBody[sym.replace(/\s+/g, "")];
      const src = q?.quote ?? q;
      const p =
        src?.lastPrice ??
        src?.last ??
        src?.close ??
        src?.regularMarketPrice;
      currentPriceByTicker[sym] = typeof p === "number" && p > 0 ? p : 0;

      // Extract company name from Schwab quote description (prefer mover name if already set)
      if (!companyBySymbol[sym]) {
        const desc =
          q?.reference?.description ??
          src?.description ??
          q?.description ??
          null;
        companyBySymbol[sym] = typeof desc === "string" && desc.length > 0 ? desc : sym;
      }
    }

    // 2b) Market cap — always fetched (fast with batch calls: ~2 s for 340 tickers).
    // Used for two purposes:
    //   a) Sorting the universe so the 200-ticker price-history cap always covers the
    //      most liquid/largest names (not arbitrary insertion order).
    //   b) Filtering by minMarketCap when that option is active.
    // ETFs / instruments with no market cap data (null) are kept through both sort and filter.
    const marketCapByTicker: Record<string, number | null> = {};
    if (!clientUniverse || clientUniverse.length === 0) {
      // Skip for custom buckets — user chose those symbols deliberately.
      const caps = await fetchMarketCapsBatched(tickers, accessToken);
      Object.assign(marketCapByTicker, caps);
    }

    if (clientUniverse && clientUniverse.length > 0) {
      warnings.push("Using a custom ticker bucket — Schwab index movers are not merged in.");
    }

    // 3) Filter by price and optionally market cap
    let effectiveTickers = tickers.filter((t) => currentPriceByTicker[t] > 0);
    if (minMarketCap != null && Number.isFinite(minMarketCap) && minMarketCap > 0) {
      const withMarketCap = effectiveTickers.filter((t) => marketCapByTicker[t] != null);
      if (withMarketCap.length === 0) {
        warnings.push(
          "Market cap data not returned by Schwab for these symbols; skipping market cap filter."
        );
      } else {
        // Null market cap (e.g. ETFs) is treated as passing the filter.
        effectiveTickers = effectiveTickers.filter(
          (t) => marketCapByTicker[t] == null || (marketCapByTicker[t] ?? 0) >= minMarketCap
        );
      }
    }

    // Sort by market cap descending so the 200-ticker price-history cap always covers the
    // largest / most-liquid names. Tickers with no market cap data sort to the end.
    effectiveTickers.sort((a, b) => {
      const ma = marketCapByTicker[a] ?? -1;
      const mb = marketCapByTicker[b] ?? -1;
      return mb - ma;
    });

    // Safety cap for price-history fetches (wider universe surveyed here)
    if (effectiveTickers.length > MAX_HISTORY_UNDERLYINGS) {
      effectiveTickers = effectiveTickers.slice(0, MAX_HISTORY_UNDERLYINGS);
    }

    if (effectiveTickers.length === 0) {
      res.status(200).json({
        resultsByOtmPct: {},
        message: "No tickers with valid prices found in the universe.",
        warnings,
      });
      return;
    }

    // 4) 1-month price performance + ~20d realized vol, parallel batches of 10
    const upsideByTicker: Record<string, number | null> = {};
    const realizedVol20dPctByTicker: Record<string, number | null> = {};
    const HISTORY_CONCURRENCY = 20;
    for (let hi = 0; hi < effectiveTickers.length; hi += HISTORY_CONCURRENCY) {
      await Promise.allSettled(
        effectiveTickers.slice(hi, hi + HISTORY_CONCURRENCY).map(async (symbol) => {
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
            throwIfRateLimited(histResp, "pricehistory");
            if (!histResp.ok) {
              upsideByTicker[symbol] = null;
              realizedVol20dPctByTicker[symbol] = null;
              return;
            }
            const histBody: any = await histResp.json();
            const candles = histBody?.candles ?? [];
            if (!Array.isArray(candles) || candles.length < 2) {
              upsideByTicker[symbol] = null;
              realizedVol20dPctByTicker[symbol] = null;
              return;
            }
            const sorted = candles
              .slice()
              .sort((a: any, b: any) => (a.datetime ?? 0) - (b.datetime ?? 0));
            const closes = sorted
              .map((c: any) => (typeof c?.close === "number" ? c.close : NaN))
              .filter((x: number) => Number.isFinite(x) && x > 0);
            realizedVol20dPctByTicker[symbol] = annualizedRealizedVolPctFromCloses(closes);

            const latest = sorted[sorted.length - 1];
            const latestClose = latest?.close ?? 0;
            const oneMonthAgo = new Date(today);
            oneMonthAgo.setUTCMonth(oneMonthAgo.getUTCMonth() - 1);
            const targetMs = oneMonthAgo.getTime();
            const start = sorted.find((c: any) => (c.datetime ?? 0) >= targetMs) ?? sorted[0];
            const startClose = start?.close ?? 0;
            const livePx = currentPriceByTicker[symbol];
            const endPx =
              typeof livePx === "number" && livePx > 0 ? livePx : latestClose;
            upsideByTicker[symbol] =
              startClose > 0 && endPx > 0 ? (endPx / startClose - 1) * 100 : null;
          } catch {
            upsideByTicker[symbol] = null;
            realizedVol20dPctByTicker[symbol] = null;
          }
        })
      );
    }

    // 4b) Re-rank for chain fetching: sort by realized vol descending, cap at MAX_CHAIN_UNDERLYINGS.
    // Low-vol names (ETFs, utilities) almost never produce competitive options; focusing chain
    // calls on the most volatile 100 names frees up budget to survey 200 names upfront.
    const chainTickers = [...effectiveTickers]
      .sort((a, b) => {
        const ra = realizedVol20dPctByTicker[a] ?? -1;
        const rb = realizedVol20dPctByTicker[b] ?? -1;
        return rb - ra;
      })
      .slice(0, MAX_CHAIN_UNDERLYINGS);

    // 5) Option chains per ticker, parallel batches of 10
    type OptionSpec = {
      ticker: string;
      expiry: string;
      type: "C" | "P";
      /** Broad frontend section key (5 | 10 | 15 | 20). */
      otmPct: number;
      /** 1 % sub-band label (5–29) used for diversity selection. */
      subBandPct: number;
      strike: number;
      currentPrice: number;
      /** IV from chain contract when quote omits it (same normalization as quotes). */
      impliedVolPctFromChain?: number | null;
    };
    const specs: OptionSpec[] = [];
    const skewPctByTicker: Record<string, number | null> = {};
    let chainRateLimitHits = 0;

    /** Find the closest-matching strikes object for a given expMap + target date. */
    function resolveExpiryStrikesObj(expMap: Record<string, any>): any {
      let best: any = null, bestDiffMs: number | null = null;
      for (const [expKey, strikesObj] of Object.entries(expMap)) {
        const exp = toExpiryYYYYMMDD(expKey);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(exp)) continue;
        const d = new Date(exp + "T00:00:00Z");
        if (Number.isNaN(d.getTime())) continue;
        const diff = Math.abs(d.getTime() - expiryDate!.getTime());
        if (diff === 0) return strikesObj;
        if (bestDiffMs == null || diff < bestDiffMs) { bestDiffMs = diff; best = strikesObj; }
      }
      return best ?? Object.values(expMap)[0] ?? null;
    }

    const CHAIN_CONCURRENCY = 10;
    for (let ci = 0; ci < chainTickers.length; ci += CHAIN_CONCURRENCY) {
      await Promise.allSettled(
        chainTickers.slice(ci, ci + CHAIN_CONCURRENCY).map(async (ticker) => {
          const spot = currentPriceByTicker[ticker];
          if (!spot || spot <= 0) return;

          // Request ALL so both maps are returned; non-primary side used for skew.
          const params = new URLSearchParams({
            symbol: ticker,
            contractType: "ALL",
            includeUnderlyingQuote: "FALSE",
            strategy: "SINGLE",
            fromDate: fromStr,
            toDate: toStr,
            // Wider ladder so 15–20% OTM isn’t forced onto the same few ITM/near-ATM strikes.
            strikeCount: "80",
          });

          const chainResp = await fetch(
            `https://api.schwabapi.com/marketdata/v1/chains?${params}`,
            { headers: { Authorization: `Bearer ${accessToken}` } }
          );
          if (chainResp.status === 429) { chainRateLimitHits++; return; }
          if (!chainResp.ok) return;
          const chainBody: any = await chainResp.json();

          const primaryExpMap = type === "C" ? chainBody?.callExpDateMap : chainBody?.putExpDateMap;
          if (!primaryExpMap || typeof primaryExpMap !== "object") return;
          const strikesObjForExpiry = resolveExpiryStrikesObj(primaryExpMap);
          if (!strikesObjForExpiry || typeof strikesObjForExpiry !== "object") return;

          // Compute put-call skew using both sides at the same expiry window.
          const otherExpMap = type === "C" ? chainBody?.putExpDateMap : chainBody?.callExpDateMap;
          const otherSO = otherExpMap && typeof otherExpMap === "object"
            ? resolveExpiryStrikesObj(otherExpMap) : null;
          skewPctByTicker[ticker] = computePutCallSkew(
            type === "C" ? strikesObjForExpiry : otherSO,
            type === "P" ? strikesObjForExpiry : otherSO,
            spot,
          );

          const strikes: number[] = [];
          for (const [strikeStr, contracts] of Object.entries<any>(strikesObjForExpiry)) {
            const strike = Number(strikeStr);
            if (!Number.isFinite(strike) || strike <= 0) continue;
            if (Array.isArray(contracts) && contracts.length > 0) strikes.push(strike);
          }
          if (strikes.length === 0) return;

          // Iterate 1 % sub-bands; diversity selection later ensures each OTM level represented.
          for (const bucket of OTM_BUCKETS) {
            const validStrikes = getStrikesInRange(strikes, spot, bucket.min, bucket.max, type);
            for (const strike of validStrikes) {
              let contractsRaw: any = strikesObjForExpiry[String(strike)];
              if (!Array.isArray(contractsRaw) || contractsRaw.length === 0) {
                for (const [sk, arr] of Object.entries<any>(strikesObjForExpiry)) {
                  if (Number(sk) === strike && Array.isArray(arr) && arr.length > 0) {
                    contractsRaw = arr;
                    break;
                  }
                }
              }
              let impliedVolPctFromChain: number | null = null;
              if (Array.isArray(contractsRaw) && contractsRaw.length > 0) {
                const c0 = contractsRaw[0];
                  if (c0?.isMini === true || c0?.isNonStandard === true) continue;
                impliedVolPctFromChain =
                  c0 && typeof c0 === "object" ? impliedVolPercentFromQuote(c0) : null;
              }
              specs.push({
                ticker,
                expiry: expiration,
                type,
                subBandPct: bucket.label,          // 1 % sub-band (5–29)
                otmPct: broadBucket(bucket.label),  // broad key   (5 | 10 | 15 | 20)
                strike,
                currentPrice: spot,
                impliedVolPctFromChain,
              });
            }
          }
        })
      );
    }

    // Surface chain-level rate limits properly instead of the misleading "no options found".
    if (chainRateLimitHits > 0) {
      if (specs.length === 0) {
        res.status(429).json({
          error: `Schwab API rate-limited on chain fetches (${chainRateLimitHits}/${chainTickers.length} tickers). Wait 30–60 s and try again.`,
        });
        return;
      }
      warnings.push(
        `Rate-limited on ${chainRateLimitHits} chain fetch(es) — results may be incomplete. Try again for full coverage.`,
      );
    }

    if (specs.length === 0) {
      res.status(200).json({
        resultsByOtmPct: {},
        message: "No options found for the chosen expiration and OTM levels.",
        warnings,
      });
      return;
    }

    // 6) Option quotes (batched, 50 per request)
    const optionQuotes: Record<string, OptionQuoteLite> = {};
    const BATCH = 50;

    const occToSpecKeyMap = new Map<string, string>();
    for (const s of specs) {
      const occ = toOCCSymbol(s.ticker, s.expiry, s.type, s.strike);
      const key = `${s.ticker} ${s.expiry} ${s.strike} ${s.type}`;
      if (!occToSpecKeyMap.has(occ)) occToSpecKeyMap.set(occ, key);
    }
    const occToSpecKey = Array.from(occToSpecKeyMap.entries()).map(([occ, key]) => ({ occ, key }));

    for (let i = 0; i < occToSpecKey.length; i += BATCH) {
      const batch = occToSpecKey.slice(i, i + BATCH);
      const qUrl =
        "https://api.schwabapi.com/marketdata/v1/quotes?" +
        new URLSearchParams({ symbols: batch.map((b) => b.occ).join(",") }).toString();
      const qResp = await fetch(qUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
      throwIfRateLimited(qResp, "option_quotes");
      if (!qResp.ok) continue;
      const qBody: any = await qResp.json();

      for (const { occ, key } of batch) {
        const q = qBody[occ] ?? qBody[occ.replace(/\s+/g, "")];
        const src =
          q?.quote && typeof q.quote === "object"
            ? q.quote
            : q?.optionContract && typeof q.optionContract === "object"
              ? q.optionContract
              : q?.option && typeof q.option === "object"
                ? q.option
                : q;
        if (!src || typeof src !== "object") continue;
        const num = (x: any): number | undefined =>
          typeof x === "number" && Number.isFinite(x) ? x : undefined;
        optionQuotes[key] = {
          bid: num(src.bidPrice) ?? num(src.bid),
          ask: num(src.askPrice) ?? num(src.ask),
          delta: num(src.delta),
          theta: num(src.theta),
          gamma: num(src.gamma),
          openInterest: num(src.openInterest) ?? num(src.open_interest),
          totalVolume: num(src.totalVolume) ?? num(src.total_volume) ?? num(src.volume),
          impliedVolPct: impliedVolPercentFromQuote(src),
        };
      }
    }

    // 7) Build and rank results by OTM level
    const resultsByOtmPct: Record<number, RankedOption[]> = {};
    const liquidityFiltered = { spread: 0, oi: 0 };
    let rankedRowsWithIv = 0;
    let rankedRowsWithoutIv = 0;

    for (const spec of specs) {
      const key = `${spec.ticker} ${spec.expiry} ${spec.strike} ${spec.type}`;
      const quote = optionQuotes[key];
      const bid = quote?.bid ?? 0;
      const ask = quote?.ask ?? 0;
      const optionPrice = isBuyToOpen
        ? ask > 0
          ? ask
          : bid
        : bid > 0
          ? bid
          : ask;
      if (optionPrice <= 0) continue;
      // For a write (sell to open), zero bid = no buyer exists → untradeable.
      // For a buy (buy to open), zero ask should never reach here (caught above).
      if (!isBuyToOpen && bid <= 0) { liquidityFiltered.spread++; continue; }
      if (isBuyToOpen && ask <= 0) { liquidityFiltered.spread++; continue; }

      // Use true bid/ask for spread (no fallback substitution — that masks wide markets).
      const spread = ask > 0 && bid > 0 ? ask - bid : Math.max(ask, bid);
      const mid = ask > 0 && bid > 0 ? (ask + bid) / 2 : optionPrice;
      const spreadPct = mid > 0 ? spread / mid : 1;

      // Adaptive thresholds: farther-OTM options have low absolute prices where even a $0.10
      // spread on a $0.25 option is 40%. Apply tiered (not linear) allowances so 15-20% OTM
      // tables aren't starved of candidates.
      // More forgiving spread thresholds: far-OTM options legitimately have wide markets.
      const otmTierAdj = spec.otmPct <= 5 ? 0 : spec.otmPct <= 10 ? 0.12 : spec.otmPct <= 15 ? 0.25 : 0.45;
      const maxSpreadPct = (isBuyToOpen ? 0.42 : 0.35) + otmTierAdj;
      if (spreadPct > maxSpreadPct) {
        liquidityFiltered.spread++;
        continue;
      }
      const minOI = spec.otmPct <= 5 ? 25 : spec.otmPct <= 10 ? 12 : spec.otmPct <= 15 ? 6 : 3;
      const oi = quote?.openInterest ?? null;
      if (oi != null && oi < minOI) {
        liquidityFiltered.oi++;
        continue;
      }

      const premiumPerContract = (isBuyToOpen ? -1 : 1) * optionPrice * 100;
      const notional = spec.strike * 100;
      const yieldPct = notional !== 0 ? (premiumPerContract / notional) * 100 : 0;
      const annYieldPct = yieldPct * (365 / dte);
      const annAbs = Math.abs(annYieldPct);
      const rawDelta = quote?.delta;
      const probITM = rawDelta != null
        ? clamp(Math.abs(rawDelta), 0.02, 0.98)
        : clamp(0.5 * Math.exp(-Math.abs(spec.currentPrice - spec.strike) / Math.max(spec.currentPrice, 1) * 12), 0.02, 0.98);
      const volume = quote?.totalVolume ?? 0;
      // Volume / OI ratio: elevated intraday volume relative to open interest signals unusual
      // option activity (smart money flow, hedging demand). Boosts liquidity score for active contracts.
      const volOiRatio = (oi != null && oi > 0 && volume > 0) ? volume / oi : 0;
      const liqScore = clamp(
        (1 - clamp(spreadPct / Math.max(maxSpreadPct, 0.0001), 0, 1)) * 0.50 +
          clamp((oi ?? 100) / 600, 0, 1) * 0.25 +
          clamp(volume / 300, 0, 1) * 0.15 +
          clamp(volOiRatio / 0.5, 0, 1) * 0.10,
        0.05,
        1
      );
      const ivPct = quote?.impliedVolPct ?? spec.impliedVolPctFromChain ?? null;
      const rvPct = realizedVol20dPctByTicker[spec.ticker] ?? null;
      const volMult = volIvRvMultiplier(isBuyToOpen, ivPct, rvPct);

      // IV bonus: volatility as a primary scoring factor, not just a multiplier.
      //
      // Writes: sqrt(IV / 30) — normalised to 1.0 at 30 % IV.
      //   80 % IV → ×1.63  |  120 % IV → ×2.0  |  15 % IV → ×0.71
      //   High raw IV is the primary signal for premium richness. The IV/RV ratio
      //   (volMult) then further rewards when that premium is also "rich" vs realised vol.
      //
      // Buys: sqrt(30 / IV) — inverse; rewards cheap options (low IV relative to 30 % norm).
      //   20 % IV → ×1.22  |  15 % IV → ×1.41  |  60 % IV → ×0.71
      //   volMult (RV/IV ratio) then further boosts when the stock is moving more than implied.
      const ivBonus = (() => {
        if (ivPct == null || ivPct <= 0) return 1.0;
        if (isBuyToOpen) {
          return clamp(Math.sqrt(30 / Math.max(ivPct, 5)), 0.45, 1.80);
        }
        return clamp(Math.sqrt(ivPct / 30), 0.35, 2.50);
      })();

      // IV bonus is baked directly into base score so vol is a first-class factor.
      // For writes, annYieldPct is already IV-driven (higher IV → more expensive options).
      // Cap it at 80 before multiplying by ivBonus so a 300 % annualised yield on MSTR
      // doesn't completely crowd out every other name — diversity across tickers is valuable.
      const baseScore = isBuyToOpen
        ? ((probITM * 100) / Math.max(annAbs, 0.05)) * liqScore * ivBonus
        : Math.min(annAbs, 80) * Math.pow(1 - probITM, 1.35) * liqScore * ivBonus;

      // Gamma penalty for writers: high gamma means delta can accelerate rapidly as the stock
      // moves toward the strike. Penalise high-gamma contracts up to 15%.
      const gammaPenalty = (() => {
        if (isBuyToOpen) return 1; // buyers want high gamma (convexity)
        const g = quote?.gamma;
        if (g == null || g <= 0) return 1;
        return clamp(1 - g * 5, 0.85, 1.0);
      })();

      // Put-call skew multiplier: market-structure signal for premium richness.
      //
      // Positive skew (puts > calls) = market paying extra for downside protection.
      //   Put writes: boost — you collect the richest premium side. +0.8% per pp, cap 1.20×.
      //   Call writes: slight discount — calls are relatively cheap. −0.4% per pp, floor 0.90×.
      //   Put buys: discount — buying the expensive side. −0.8% per pp, floor 0.80×.
      //   Call buys: bonus  — calls are cheap vs puts.   +0.4% per pp, cap 1.15×.
      const skewMult = (() => {
        const skew = skewPctByTicker[spec.ticker] ?? null;
        if (skew == null) return 1.0;
        const s = clamp(skew, -30, 30);
        if (!isBuyToOpen) {
          return type === "P"
            ? clamp(1 + s * 0.008, 0.90, 1.20)   // put write: boost for high put skew
            : clamp(1 - s * 0.004, 0.90, 1.05);   // call write: slight discount
        } else {
          return type === "P"
            ? clamp(1 - s * 0.008, 0.80, 1.10)   // put buy: penalise expensive puts
            : clamp(1 + s * 0.004, 0.90, 1.15);  // call buy: bonus when calls are cheap
        }
      })();

      const score = baseScore * volMult * gammaPenalty * skewMult;
      if (ivPct != null) rankedRowsWithIv++;
      else rankedRowsWithoutIv++;

      const occSymbol = toOCCSymbol(spec.ticker, spec.expiry, spec.type, spec.strike);
      const schwabSymbol = formatSchwabSymbol({
        ticker: spec.ticker,
        expiry: spec.expiry,
        type: spec.type,
        strike: spec.strike,
      });

      // Compute actual OTM % from real strike vs spot (used for display and diversity sorting).
      const actualOtmPct = round2(
        type === "C"
          ? ((spec.strike - spec.currentPrice) / spec.currentPrice) * 100
          : ((spec.currentPrice - spec.strike) / spec.currentPrice) * 100
      );

      if (!resultsByOtmPct[spec.otmPct]) resultsByOtmPct[spec.otmPct] = [];
      resultsByOtmPct[spec.otmPct].push({
        rank: 0,
        ticker: spec.ticker,
        company: companyBySymbol[spec.ticker] ?? spec.ticker,
        oneMonthPerfPct:
          upsideByTicker[spec.ticker] == null
            ? null
            : round2(upsideByTicker[spec.ticker]!),
        otmPct: spec.otmPct,
        subBandPct: spec.subBandPct,
        actualOtmPct,
        currentPrice: round2(spec.currentPrice),
        strike: round2(spec.strike),
        bid: round2(bid),
        ask: round2(ask > 0 ? ask : bid),
        limitPrice: round2(optionPrice),
        annYieldPct: round2(annYieldPct),
        premiumPerContract: round2(premiumPerContract),
        impliedVolPct: ivPct == null ? null : round2(ivPct),
        realizedVol20dPct: rvPct == null ? null : round2(rvPct),
        skewPct: skewPctByTicker[spec.ticker] ?? null,
        delta: rawDelta != null ? round2(clamp(Math.abs(rawDelta), 0, 1)) : null,
        // thetaPerDay: dollars of time decay per contract per day.
        // Schwab theta is negative (value decays); flip sign for writes so display is positive $ earned/day.
        thetaPerDay: (() => {
          const th = quote?.theta;
          if (th == null || !Number.isFinite(th)) return null;
          const perContract = th * 100;
          return round2(isBuyToOpen ? perContract : -perContract);
        })(),
        score: round2(score),
        schwabSymbol,
        occSymbol,
      });
    }

    if (rankedRowsWithoutIv > 0 && rankedRowsWithIv === 0) {
      warnings.push(
        "Implied volatility was not available on option quotes or chain contracts; IV vs 20d realized-vol adjustment was skipped."
      );
    }

    if (liquidityFiltered.spread > 0) {
      warnings.push(
        `Excluded ${liquidityFiltered.spread} illiquid contracts with wide bid/ask spread.`
      );
    }
    if (liquidityFiltered.oi > 0) {
      warnings.push(
        `Excluded ${liquidityFiltered.oi} contracts with very low open interest.`
      );
    }

    // Cross-OTM deduplication: each ticker appears in at most one bucket.
    // Collect all candidates across all levels, sort by score descending, then
    // greedily assign each ticker to the first (highest-scoring) level it appears in.
    // This prevents a single high-IV name from flooding every OTM table.
    {
      const allCandidates: Array<{ ticker: string; otmPct: number; score: number }> = [];
      for (const otmPct of otmLevels) {
        for (const row of resultsByOtmPct[otmPct] ?? []) {
          allCandidates.push({ ticker: row.ticker, otmPct, score: row.score });
        }
      }
      allCandidates.sort((a, b) => b.score - a.score);
      const tickerToOtm: Record<string, number> = {};
      for (const c of allCandidates) {
        if (!(c.ticker in tickerToOtm)) tickerToOtm[c.ticker] = c.otmPct;
      }
      for (const otmPct of otmLevels) {
        resultsByOtmPct[otmPct] = (resultsByOtmPct[otmPct] ?? []).filter(
          (r) => tickerToOtm[r.ticker] === otmPct
        );
      }
    }

    for (const otmPct of otmLevels) {
      const arr = resultsByOtmPct[otmPct] ?? [];
      // Keep the single best-scoring contract per ticker within the broad section.
      // The 7–8 % clustering within a 5–9 % band is correct — that IS the optimal yield/risk
      // point. actualOtmPct in the result lets users see the precise strike distance.
      const tickerBest = new Map<string, (typeof arr)[0]>();
      for (const row of arr) {
        const ex = tickerBest.get(row.ticker);
        if (!ex || row.score > ex.score) tickerBest.set(row.ticker, row);
      }
      const deduped = Array.from(tickerBest.values()).sort((a, b) =>
        b.score !== a.score ? b.score - a.score : b.annYieldPct - a.annYieldPct
      );
      deduped.slice(0, topN).forEach((r, idx) => (r.rank = idx + 1));
      resultsByOtmPct[otmPct] = deduped.slice(0, topN);
    }

    const positionSide = isBuyToOpen ? "buy" : "write";
    res.status(200).json({
      resultsByOtmPct,
      message: null,
      warnings,
      expiration,
      optionType: type,
      dte,
      positionSide,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);

    if (msg === RATE_LIMIT_ERR) {
      res.status(503).json({
        error:
          "Schwab rate limit (HTTP 429). Wait a moment and try again.",
        resultsByOtmPct: {},
        message: null,
        warnings: [],
      });
      return;
    }
    if (msg.startsWith("SCHWAB_QUOTES_")) {
      res.status(502).json({
        error: "Schwab equity quotes request failed while building the scan universe.",
        resultsByOtmPct: {},
        message: msg,
        warnings: [],
      });
      return;
    }

    console.error("schwab-options-opportunity-screener error", err);
    res.status(500).json({
      error: "Unexpected error running opportunity screener",
      resultsByOtmPct: {},
      message: "Screener failed. Check connection and try again.",
    });
  }
}
