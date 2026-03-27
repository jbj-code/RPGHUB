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
  strike: number;
  bid: number;
  annYieldPct: number;
  premiumPerContract: number;
  schwabSymbol: string;
  occSymbol: string;
};

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

    // 1) Build universe: hardcoded base + live Schwab movers (parallel)
    const [moversRows] = await Promise.allSettled([fetchMovers(accessToken)]);
    const moverSymbols: UniverseRow[] =
      moversRows.status === "fulfilled" ? moversRows.value : [];

    // Merge: base universe first, then add any mover symbols not already present
    const baseSet = new Set(UNIVERSE_SYMBOLS);
    const allRows: UniverseRow[] = [
      ...UNIVERSE_SYMBOLS.map((s) => ({ symbol: s, company: "" })),
      ...moverSymbols.filter((m) => !baseSet.has(m.symbol)),
    ];

    const tickers = allRows.map((r) => r.symbol);
    const companyBySymbol: Record<string, string> = {};
    for (const r of moverSymbols) companyBySymbol[r.symbol] = r.company;

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const dte = Math.max(1, daysBetween(today, expiryDate));
    const fromStr = expiration;
    const toStr = expiration;

    // 2) Equity quotes: current price, market cap, company description
    const quotesBody: any = await fetchEquityQuotesBatched(tickers, accessToken);

    const currentPriceByTicker: Record<string, number> = {};
    const marketCapByTicker: Record<string, number | null> = {};

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

    if (effectiveTickers.length === 0) {
      res.status(200).json({
        resultsByOtmPct: {},
        message: "No tickers with valid prices found in the universe.",
        warnings,
      });
      return;
    }

    // 4) 1-month price performance, parallel batches of 10
    const upsideByTicker: Record<string, number | null> = {};
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
            if (!histResp.ok) { upsideByTicker[symbol] = null; return; }
            const histBody: any = await histResp.json();
            const candles = histBody?.candles ?? [];
            if (!Array.isArray(candles) || candles.length < 2) {
              upsideByTicker[symbol] = null;
              return;
            }
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
            upsideByTicker[symbol] =
              startClose > 0 && latestClose > 0
                ? (latestClose / startClose - 1) * 100
                : null;
          } catch {
            upsideByTicker[symbol] = null;
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
    };
    const specs: OptionSpec[] = [];

    const chooseStrike = (args: {
      strikes: number[];
      spot: number;
      targetOtmPct: number;
      side: "C" | "P";
    }): number | null => {
      const { strikes, spot, targetOtmPct, side } = args;
      if (strikes.length === 0 || spot <= 0) return null;
      let best: { strike: number; diff: number } | null = null;
      for (const strike of strikes) {
        const distPct =
          side === "P"
            ? ((spot - strike) / spot) * 100
            : ((strike - spot) / spot) * 100;
        if (!Number.isFinite(distPct)) continue;
        const diff = Math.abs(distPct - targetOtmPct);
        if (!best || diff < best.diff) best = { strike, diff };
        if (diff === 0) return strike;
      }
      return best?.strike ?? null;
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
            strikeCount: "20",
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
            const chosen = chooseStrike({ strikes, spot, targetOtmPct: otmPct, side: type });
            if (!chosen) continue;
            specs.push({ ticker, expiry: expiration, type, otmPct, strike: chosen, currentPrice: spot });
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
    const optionQuotes: Record<string, { bid?: number; ask?: number }> = {};
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
        };
      }
    }

    // 7) Build and rank results by OTM level
    const resultsByOtmPct: Record<number, RankedOption[]> = {};

    for (const spec of specs) {
      const key = `${spec.ticker} ${spec.expiry} ${spec.strike} ${spec.type}`;
      const quote = optionQuotes[key];
      const bid = quote?.bid ?? 0;
      const ask = quote?.ask ?? bid;
      if (bid <= 0 && ask <= 0) continue;

      const optionPrice = bid > 0 ? bid : ask;
      const premiumPerContract = optionPrice * 100;
      const notional = spec.strike * 100;
      const yieldPct = notional !== 0 ? (premiumPerContract / notional) * 100 : 0;
      const annYieldPct = yieldPct * (365 / dte);

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
        strike: round2(spec.strike),
        bid: round2(bid || ask),
        annYieldPct: round2(annYieldPct),
        premiumPerContract: round2(premiumPerContract),
        schwabSymbol,
        occSymbol,
      });
    }

    for (const otmPct of otmLevels) {
      const arr = resultsByOtmPct[otmPct] ?? [];
      arr.sort((a, b) => b.annYieldPct - a.annYieldPct);
      arr.slice(0, topN).forEach((r, idx) => (r.rank = idx + 1));
      resultsByOtmPct[otmPct] = arr.slice(0, topN);
    }

    res.status(200).json({ resultsByOtmPct, message: null, warnings, expiration, optionType: type, dte });
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
