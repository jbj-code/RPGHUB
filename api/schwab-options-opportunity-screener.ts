// Options Opportunity Screener
// Uses a hardcoded broad US equity universe (no external CSV) plus Schwab's live
// movers endpoint to capture high-volatility candidates. Sorts by market cap
// (largest/most-liquid first), fetches chains for the top underlyings, and ranks by annualised yield.

import { createClient } from "@supabase/supabase-js";
import { toOCCSymbol, getValidAccessToken } from "./_schwab-utils.js";

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
  "SQ","SHOP","ZM","DOCU","ABNB","UBER","LYFT","DASH","RBLX","COIN",
  "HOOD","SOFI","UPST","AFRM","BILL","MDB","GTLB","PCTY","PAYC","APP",
  "HIMS","DOCS","APPN","CSGP","ASAN","SMAR",
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
  "GNRC","TT","JCI","AME","FAST","GGG","XTSLA",
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
  "EA","TTWO","RBLX","U",
  // Travel / hospitality / airlines
  "MAR","HLT","H","LVS","MGM","WYNN","RCL","CCL","NCLH",
  "AAL","DAL","UAL","LUV","JBLU","CZR",
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
    const url =
      "https://api.schwabapi.com/marketdata/v1/quotes?" +
      new URLSearchParams({ symbols: batch.join(","), fields: "quote,fundamental,reference" }).toString();
    const quotesResp = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    throwIfRateLimited(quotesResp, "equity_quotes");
    if (!quotesResp.ok) {
      const t = await quotesResp.text();
      throw new Error(`SCHWAB_QUOTES_${quotesResp.status}:${t.slice(0, 240)}`);
    }
    const quotesBody = (await quotesResp.json()) as Record<string, unknown>;
    Object.assign(merged, quotesBody);
  }
  return merged;
}

type RankedOption = {
  rank: number;
  ticker: string;
  company: string;
  oneMonthPerfPct: number | null;
  otmPct: number;
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
  /** Internal composite score used for ranking (higher is better). */
  score: number;
  schwabSymbol: string;
  occSymbol: string;
};

type OptionQuoteLite = {
  bid?: number;
  ask?: number;
  delta?: number;
  openInterest?: number;
  totalVolume?: number;
  impliedVolPct?: number | null;
};

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function toEpochMs(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) {
    // Some feeds return epoch seconds for date-ish values.
    return v > 1e12 ? v : v > 1e9 ? v * 1000 : null;
  }
  if (typeof v === "string") {
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return d.getTime();
  }
  return null;
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
 * Sell: boost when IV > RV (rich premium). Buy: boost when RV > IV (implied relatively cheap vs recent move).
 */
function volIvRvMultiplier(isBuyToOpen: boolean, ivPct: number | null, rvPct: number | null): number {
  if (ivPct == null || rvPct == null || ivPct < 0.75 || rvPct < 0.75) return 1;
  if (isBuyToOpen) {
    const r = rvPct / ivPct;
    return clamp(1 + 0.24 * (r - 1), 0.78, 1.32);
  }
  const r = ivPct / rvPct;
  return clamp(1 + 0.24 * (r - 1), 0.78, 1.32);
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

export default async function handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") { res.status(200).end(); return; }
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

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

  const otmLevels =
    Array.isArray(body.otmLevels) && body.otmLevels.length > 0
      ? body.otmLevels
          .map((n: any) => Number(n))
          .filter((n: number) => Number.isFinite(n) && n > 0)
      : [5, 10, 15, 20];

  const topN = Number(body.topN) || 5;
  const strikeTolerancePct = Number(body.strikeTolerancePct) || 1.25;
  const minMarketCap = body.minMarketCap != null ? Number(body.minMarketCap) : null;
  const includeEarnings = Boolean(body.includeEarnings ?? false);
  // Internal cap prevents Schwab rate-limit (HTTP 429) and Vercel timeouts.
  // Not exposed to the UI — we always scan the broadest set we can safely handle.
  const MAX_UNDERLYINGS = 150;

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
      allRows = [
        ...UNIVERSE_SYMBOLS.map((s) => ({ symbol: s, company: "" })),
        ...moverSymbols.filter((m) => !baseSet.has(m.symbol)),
      ];
      for (const r of moverSymbols) companyBySymbol[r.symbol] = r.company;
    }

    const tickers = allRows.map((r) => r.symbol);

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const dte = Math.max(1, daysBetween(today, expiryDate));
    const fromStr = expiration;
    const toStr = expiration;

    // 2) Equity quotes: current price, market cap, company description
    const quotesBody: any = await fetchEquityQuotesBatched(tickers, accessToken);

    const currentPriceByTicker: Record<string, number> = {};
    const marketCapByTicker: Record<string, number | null> = {};
    const earningsDateMsByTicker: Record<string, number | null> = {};

    for (const sym of tickers) {
      const q = quotesBody[sym] ?? quotesBody[sym.replace(/\s+/g, "")];
      const src = q?.quote ?? q;
      const p =
        src?.regularMarketLast ??
        src?.lastPrice ??
        src?.last ??
        src?.close ??
        src?.regularMarketPrice;
      currentPriceByTicker[sym] = typeof p === "number" && p > 0 ? p : 0;

      // Schwab returns fundamentals at the top-level symbol key (q.fundamental),
      // not inside the nested quote object (src), so we check both paths.
      const fund: any = q?.fundamental ?? src?.fundamental;
      const mcCandidate =
        (typeof fund?.marketCap === "number" ? fund.marketCap : null) ??
        (typeof fund?.market_cap === "number" ? fund.market_cap : null) ??
        (typeof src?.marketCap === "number" ? src.marketCap : null) ??
        (typeof src?.market_cap === "number" ? src.market_cap : null);
      marketCapByTicker[sym] =
        typeof mcCandidate === "number" && Number.isFinite(mcCandidate) ? mcCandidate : null;

      const earningsCandidate =
        fund?.nextEarningsDate ??
        fund?.nextEarningDate ??
        src?.nextEarningsDate ??
        src?.nextEarningDate ??
        null;
      earningsDateMsByTicker[sym] = toEpochMs(earningsCandidate);

      // Extract company name from Schwab quote description (prefer mover name if already set)
      if (!companyBySymbol[sym]) {
        const desc =
          q?.reference?.description ??
          src?.description ??
          q?.description ??
          src?.securityStatus ??
          null;
        companyBySymbol[sym] = typeof desc === "string" && desc.length > 0 ? desc : sym;
      }
    }

    const warnings: string[] = [];
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
        effectiveTickers = effectiveTickers.filter(
          (t) => marketCapByTicker[t] == null || (marketCapByTicker[t] ?? 0) >= minMarketCap
        );
      }
    }

    // Sort by market cap descending so we always scan the largest/most liquid names first
    effectiveTickers.sort((a, b) => {
      const ma = marketCapByTicker[a] ?? -1;
      const mb = marketCapByTicker[b] ?? -1;
      return mb - ma;
    });

    // Safety cap to avoid Schwab rate-limits and Vercel timeouts
    if (effectiveTickers.length > MAX_UNDERLYINGS) {
      effectiveTickers = effectiveTickers.slice(0, MAX_UNDERLYINGS);
    }

    if (!includeEarnings) {
      const startMs = today.getTime();
      const endMs = expiryDate.getTime();
      const before = effectiveTickers.length;
      effectiveTickers = effectiveTickers.filter((t) => {
        const ems = earningsDateMsByTicker[t];
        if (ems == null) return true;
        return !(ems >= startMs && ems <= endMs);
      });
      const removed = before - effectiveTickers.length;
      if (removed > 0) {
        warnings.push(
          `Skipped ${removed} symbol${removed === 1 ? "" : "s"} with earnings before expiration.`
        );
      }
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
    const HISTORY_CONCURRENCY = 10;
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
            upsideByTicker[symbol] =
              startClose > 0 && latestClose > 0
                ? (latestClose / startClose - 1) * 100
                : null;
          } catch {
            upsideByTicker[symbol] = null;
            realizedVol20dPctByTicker[symbol] = null;
          }
        })
      );
    }

    // 5) Option chains per ticker, parallel batches of 10
    type OptionSpec = {
      ticker: string;
      expiry: string;
      type: "C" | "P";
      otmPct: number;
      strike: number;
      currentPrice: number;
      /** IV from chain contract when quote omits it (same normalization as quotes). */
      impliedVolPctFromChain?: number | null;
    };
    const specs: OptionSpec[] = [];

    /** Pick listed strike nearest target OTM; only true OTM legs (puts: strike < spot, calls: strike > spot). */
    const chooseStrike = (args: {
      strikes: number[];
      spot: number;
      targetOtmPct: number;
      side: "C" | "P";
      strikeTolerancePct: number;
    }): number | null => {
      const { strikes, spot, targetOtmPct, side, strikeTolerancePct } = args;
      if (strikes.length === 0 || spot <= 0) return null;
      let best: { strike: number; diff: number } | null = null;
      for (const strike of strikes) {
        const distPct =
          side === "P"
            ? ((spot - strike) / spot) * 100
            : ((strike - spot) / spot) * 100;
        if (!Number.isFinite(distPct)) continue;
        // Short-premium scan: only out-of-the-money by standard definition (not ITM).
        if (side === "P") {
          if (strike >= spot) continue;
        } else {
          if (strike <= spot) continue;
        }
        if (distPct <= 0) continue;
        const diff = Math.abs(distPct - targetOtmPct);
        if (!best || diff < best.diff) best = { strike, diff };
        if (diff === 0 && diff <= strikeTolerancePct) return strike;
      }
      if (!best) return null;
      if (best.diff > strikeTolerancePct) return null;
      return best.strike;
    };

    const CHAIN_CONCURRENCY = 10;
    for (let ci = 0; ci < effectiveTickers.length; ci += CHAIN_CONCURRENCY) {
      await Promise.allSettled(
        effectiveTickers.slice(ci, ci + CHAIN_CONCURRENCY).map(async (ticker) => {
          const spot = currentPriceByTicker[ticker];
          if (!spot || spot <= 0) return;

          const contractType = type === "C" ? "CALL" : "PUT";
          const params = new URLSearchParams({
            symbol: ticker,
            contractType,
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
          throwIfRateLimited(chainResp, "chains");
          if (!chainResp.ok) return;
          const chainBody: any = await chainResp.json();
          const expMap = type === "C" ? chainBody?.callExpDateMap : chainBody?.putExpDateMap;
          if (!expMap || typeof expMap !== "object") return;

          let strikesObjForExpiry: any = null;
          let bestExpiryDiffMs: number | null = null;

          for (const [expKey, strikesObj] of Object.entries<any>(expMap)) {
            const exp = toExpiryYYYYMMDD(expKey);
            if (!/^\d{4}-\d{2}-\d{2}$/.test(exp)) continue;
            const expDate = new Date(exp + "T00:00:00Z");
            if (Number.isNaN(expDate.getTime())) continue;
            const diffMs = Math.abs(expDate.getTime() - expiryDate.getTime());
            if (diffMs === 0) { strikesObjForExpiry = strikesObj; break; }
            if (bestExpiryDiffMs == null || diffMs < bestExpiryDiffMs) {
              bestExpiryDiffMs = diffMs;
              strikesObjForExpiry = strikesObj;
            }
          }

          if (!strikesObjForExpiry) {
            strikesObjForExpiry = Object.entries<any>(expMap)[0]?.[1] ?? null;
          }
          if (!strikesObjForExpiry || typeof strikesObjForExpiry !== "object") return;

          const strikes: number[] = [];
          for (const [strikeStr, contracts] of Object.entries<any>(strikesObjForExpiry)) {
            const strike = Number(strikeStr);
            if (!Number.isFinite(strike) || strike <= 0) continue;
            if (Array.isArray(contracts) && contracts.length > 0) strikes.push(strike);
          }
          if (strikes.length === 0) return;

          for (const otmPct of otmLevels) {
            const chosen = chooseStrike({
              strikes,
              spot,
              targetOtmPct: otmPct,
              side: type,
              strikeTolerancePct,
            });
            if (!chosen) continue;
            let contractsRaw: any = strikesObjForExpiry[String(chosen)];
            if (!Array.isArray(contractsRaw) || contractsRaw.length === 0) {
              for (const [sk, arr] of Object.entries<any>(strikesObjForExpiry)) {
                if (Number(sk) === chosen && Array.isArray(arr) && arr.length > 0) {
                  contractsRaw = arr;
                  break;
                }
              }
            }
            let impliedVolPctFromChain: number | null = null;
            if (Array.isArray(contractsRaw) && contractsRaw.length > 0) {
              const c0 = contractsRaw[0];
              impliedVolPctFromChain =
                c0 && typeof c0 === "object" ? impliedVolPercentFromQuote(c0) : null;
            }
            specs.push({
              ticker,
              expiry: expiration,
              type,
              otmPct,
              strike: chosen,
              currentPrice: spot,
              impliedVolPctFromChain,
            });
          }
        })
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
      const askUsed = ask > 0 ? ask : bid;
      const bidUsed = bid > 0 ? bid : ask;
      const spread = askUsed > 0 && bidUsed > 0 ? askUsed - bidUsed : 0;
      const mid = askUsed > 0 && bidUsed > 0 ? (askUsed + bidUsed) / 2 : optionPrice;
      const spreadPct = mid > 0 ? spread / mid : 0;
      const maxSpreadPct = isBuyToOpen ? 0.32 : 0.25;
      if (spreadPct > maxSpreadPct) {
        liquidityFiltered.spread++;
        continue;
      }
      const oi = quote?.openInterest ?? null;
      if (oi != null && oi < 50) {
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
      const liqScore = clamp(
        (1 - clamp(spreadPct / Math.max(maxSpreadPct, 0.0001), 0, 1)) * 0.55 +
          clamp((oi ?? 100) / 600, 0, 1) * 0.3 +
          clamp(volume / 300, 0, 1) * 0.15,
        0.05,
        1
      );
      const ivPct = quote?.impliedVolPct ?? spec.impliedVolPctFromChain ?? null;
      const rvPct = realizedVol20dPctByTicker[spec.ticker] ?? null;
      const volMult = volIvRvMultiplier(isBuyToOpen, ivPct, rvPct);
      const baseScore = isBuyToOpen
        ? ((probITM * 100) / Math.max(annAbs, 0.05)) * liqScore
        : annAbs * Math.pow(1 - probITM, 1.35) * liqScore;
      const score = baseScore * volMult;
      if (ivPct != null) rankedRowsWithIv++;
      else rankedRowsWithoutIv++;

      const occSymbol = toOCCSymbol(spec.ticker, spec.expiry, spec.type, spec.strike);
      const schwabSymbol = formatSchwabSymbol({
        ticker: spec.ticker,
        expiry: spec.expiry,
        type: spec.type,
        strike: spec.strike,
      });

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
        currentPrice: round2(spec.currentPrice),
        strike: round2(spec.strike),
        bid: round2(bid),
        ask: round2(ask > 0 ? ask : bid),
        limitPrice: round2(optionPrice),
        annYieldPct: round2(annYieldPct),
        premiumPerContract: round2(premiumPerContract),
        impliedVolPct: ivPct == null ? null : round2(ivPct),
        realizedVol20dPct: rvPct == null ? null : round2(rvPct),
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

    for (const otmPct of otmLevels) {
      const arr = resultsByOtmPct[otmPct] ?? [];
      arr.sort((a, b) =>
        b.score !== a.score
          ? b.score - a.score
          : isBuyToOpen
            ? a.annYieldPct - b.annYieldPct
            : b.annYieldPct - a.annYieldPct
      );
      arr.slice(0, topN).forEach((r, idx) => (r.rank = idx + 1));
      resultsByOtmPct[otmPct] = arr.slice(0, topN);
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
