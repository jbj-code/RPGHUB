// Options Opportunity Screener:
// Loads a broad US large-cap universe (default: S&P 500 constituents CSV, overridable via env),
// filters by Schwab quote + minimum market cap, scans up to N underlyings, then ranks yields.

import { createClient } from "@supabase/supabase-js";

const RATE_LIMIT_ERR = "SCHWAB_RATE_LIMIT";

function throwIfRateLimited(resp: Response, _context: string): void {
  if (resp.status === 429) {
    const err = new Error(RATE_LIMIT_ERR);
    throw err;
  }
}

/** CSV URL — not a ticker list in code; fetched at runtime. Override with SCREENER_UNIVERSE_CSV_URL. */
const DEFAULT_UNIVERSE_CSV_URL =
  process.env.SCREENER_UNIVERSE_CSV_URL ||
  "https://raw.githubusercontent.com/datasets/s-and-p-500-companies/main/data/constituents.csv";

type UniverseRow = { symbol: string; company: string };

let universeCache: { rows: UniverseRow[]; fetchedAt: number } | null = null;
const UNIVERSE_CACHE_MS = 6 * 60 * 60 * 1000;

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (c === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && c === ",") {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += c;
  }
  out.push(cur);
  return out;
}

async function fetchUniverseRows(): Promise<UniverseRow[]> {
  const now = Date.now();
  if (universeCache && now - universeCache.fetchedAt < UNIVERSE_CACHE_MS) {
    return universeCache.rows;
  }
  const resp = await fetch(DEFAULT_UNIVERSE_CSV_URL, {
    headers: { Accept: "text/csv", "User-Agent": "RPG-HUB-Screener/1" },
  });
  if (!resp.ok) {
    throw new Error(`UNIVERSE_FETCH_${resp.status}`);
  }
  const text = await resp.text();
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) throw new Error("UNIVERSE_EMPTY");
  const header = parseCsvLine(lines[0]!).map((h) => h.trim().toLowerCase());
  const symIdx = header.indexOf("symbol");
  const secIdx = header.indexOf("security");
  if (symIdx < 0) throw new Error("UNIVERSE_BAD_CSV");
  const rows: UniverseRow[] = [];
  for (let li = 1; li < lines.length; li++) {
    const parts = parseCsvLine(lines[li]!);
    const symbol = (parts[symIdx] ?? "").trim().toUpperCase();
    if (!symbol) continue;
    const company = secIdx >= 0 ? (parts[secIdx] ?? "").trim() : symbol;
    rows.push({ symbol, company });
  }
  if (rows.length === 0) throw new Error("UNIVERSE_EMPTY");
  universeCache = { rows, fetchedAt: now };
  return rows;
}

async function fetchEquityQuotesBatched(symbols: string[], accessToken: string): Promise<Record<string, unknown>> {
  const QUOTE_BATCH = 45;
  const merged: Record<string, unknown> = {};
  for (let i = 0; i < symbols.length; i += QUOTE_BATCH) {
    const batch = symbols.slice(i, i + QUOTE_BATCH);
    const url =
      "https://api.schwabapi.com/marketdata/v1/quotes?" +
      new URLSearchParams({ symbols: batch.join(",") }).toString();
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

function toOCCSymbol(underlying: string, expiry: string, type: "C" | "P", strike: number): string {
  const root = underlying.trim().toUpperCase().padEnd(6).slice(0, 6);
  const [y, m, d] = expiry.split("-");
  const yymmdd = `${y!.slice(-2)}${m}${d}`;
  const strikeVal = Math.round(strike * 1000);
  const strikeStr = String(strikeVal).padStart(8, "0");
  return `${root}${yymmdd}${type}${strikeStr}`;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function formatSchwabSymbol(args: {
  ticker: string;
  expiry: string; // YYYY-MM-DD
  type: "C" | "P";
  strike: number;
}): string {
  const d = new Date(args.expiry + "Z");
  const mm = (d.getUTCMonth() + 1).toString().padStart(2, "0");
  const dd = d.getUTCDate().toString().padStart(2, "0");
  const yyyy = d.getUTCFullYear();
  const t = args.type === "P" ? "P" : "C";
  const strike = Math.round(args.strike) === args.strike ? args.strike.toString() : args.strike.toFixed(2);
  return `${args.ticker} ${mm}/${dd}/${yyyy} ${strike} ${t}`;
}

async function getAccessToken(supabase: any, tokenRow: any): Promise<string | null> {
  const expiresAt = tokenRow.expires_at != null ? new Date(tokenRow.expires_at).getTime() : null;
  const now = Date.now();
  const bufferMs = 5 * 60 * 1000;
  const needsRefresh = expiresAt != null && now >= expiresAt - bufferMs;
  let accessToken = tokenRow.access_token as string;

  if (!needsRefresh && accessToken) return Promise.resolve(accessToken);
  if (!tokenRow.refresh_token) return Promise.resolve(accessToken);

  const clientId = process.env.SCHWAB_CLIENT_ID;
  const clientSecret = process.env.SCHWAB_CLIENT_SECRET;
  if (!clientId || !clientSecret) return Promise.resolve(null);

  const authHeader = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const refreshBody = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: tokenRow.refresh_token,
  });

  return fetch("https://api.schwabapi.com/v1/oauth/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${authHeader}`,
    },
    body: refreshBody,
  })
    .then((r) => r.json())
    .then(async (refreshJson: any) => {
      const newExpiresIn = typeof refreshJson.expires_in === "number" ? refreshJson.expires_in : 1800;
      const newExpiresAt = new Date(now + newExpiresIn * 1000).toISOString();
      await supabase
        .from("schwab_tokens")
        .update({
          access_token: refreshJson.access_token,
          expires_at: newExpiresAt,
          ...(refreshJson.refresh_token != null && { refresh_token: refreshJson.refresh_token }),
        })
        .eq("id", "default");
      return refreshJson.access_token as string;
    })
    .catch(() => null);
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

  const optionTypeRaw = body.optionType ?? "puts";
  const optionType = String(optionTypeRaw).toLowerCase();
  const type: "P" | "C" = optionType === "calls" || optionType === "call" || optionType === "c" ? "C" : "P";

  const expiration = typeof body.expiration === "string" ? body.expiration : "";
  const isValidExpiry = /^\d{4}-\d{2}-\d{2}$/.test(expiration);
  const expiryDate = isValidExpiry ? new Date(expiration + "T00:00:00Z") : null;
  if (!isValidExpiry || !expiryDate || Number.isNaN(expiryDate.getTime())) {
    res.status(400).json({ error: "expiration must be YYYY-MM-DD" });
    return;
  }

  const otmLevels =
    Array.isArray(body.otmLevels) && body.otmLevels.length > 0
      ? body.otmLevels.map((n: any) => Number(n)).filter((n: number) => Number.isFinite(n) && n > 0)
      : [5, 10, 15, 20];

  const topN = Number(body.topN) || 5;
  const strikeTolerancePct = Number(body.strikeTolerancePct) || 1.25;
  const minMarketCap = body.minMarketCap != null ? Number(body.minMarketCap) : null;
  const maxUnderlyingsRaw = Number(body.maxUnderlyingsToScan);
  const maxUnderlyingsToScan = Number.isFinite(maxUnderlyingsRaw)
    ? Math.min(150, Math.max(10, Math.round(maxUnderlyingsRaw)))
    : 50;

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
        error: "Not authorized with Schwab. Run the Schwab login flow again, then try Scan.",
      });
      return;
    }

    const accessToken = await getAccessToken(supabase, tokenRow);
    if (!accessToken) {
      res.status(401).json({
        error: "Schwab token expired. Run the Schwab login flow again.",
      });
      return;
    }

    const universeRows = await fetchUniverseRows();
    const companyBySymbol: Record<string, string> = {};
    const tickers: string[] = [];
    for (const row of universeRows) {
      if (!row.symbol) continue;
      companyBySymbol[row.symbol] = row.company;
      tickers.push(row.symbol);
    }

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const dte = Math.max(1, daysBetween(today, expiryDate));

    // Use the exact expiration date to minimize chain payload size.
    // We still have a fallback to nearest expiry key if Schwab doesn't return it.
    const fromStr = expiration;
    const toStr = expiration;

    // 1) Underlying quotes (current price + market cap), batched for large universes
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

      const mcCandidate =
        (typeof src?.marketCap === "number" ? src.marketCap : null) ??
        (typeof src?.market_cap === "number" ? src.market_cap : null) ??
        (typeof src?.fundamental?.marketCap === "number" ? src.fundamental.marketCap : null) ??
        (typeof src?.fundamental?.market_cap === "number" ? src.fundamental.market_cap : null);
      marketCapByTicker[sym] = typeof mcCandidate === "number" && Number.isFinite(mcCandidate) ? mcCandidate : null;
    }

    const warnings: string[] = [];
    let effectiveTickers = tickers.filter((t) => currentPriceByTicker[t] > 0);
    if (minMarketCap != null && Number.isFinite(minMarketCap) && minMarketCap > 0) {
      const withMarketCap = effectiveTickers.filter((t) => marketCapByTicker[t] != null);
      if (withMarketCap.length === 0) {
        warnings.push("Market cap not found in Schwab quote responses; skipping market cap filter.");
      } else {
        effectiveTickers = effectiveTickers.filter((t) => (marketCapByTicker[t] ?? 0) >= minMarketCap);
      }
    }

    effectiveTickers.sort((a, b) => {
      const ma = marketCapByTicker[a] ?? -1;
      const mb = marketCapByTicker[b] ?? -1;
      return mb - ma;
    });

    const beforeCap = effectiveTickers.length;
    if (beforeCap > maxUnderlyingsToScan) {
      warnings.push(
        `Scanning the top ${maxUnderlyingsToScan} names by market cap (${beforeCap} passed filters) to stay within API/time limits. Increase "Max symbols to scan" for a wider pass (may time out).`
      );
      effectiveTickers = effectiveTickers.slice(0, maxUnderlyingsToScan);
    }

    if (effectiveTickers.length === 0) {
      res.status(200).json({
        resultsByOtmPct: {},
        message: "No tickers passed the price/market cap filters.",
        warnings,
      });
      return;
    }

    // 2) 1M performance per ticker (used for the table "1M Perf")
    const upsideByTicker: Record<string, number | null> = {};
    for (const symbol of effectiveTickers) {
      try {
        const params = new URLSearchParams({
          symbol: symbol,
          periodType: "year",
          period: "1",
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
          continue;
        }
        const histBody: any = await histResp.json();
        const candles = histBody?.candles ?? [];
        if (!Array.isArray(candles) || candles.length < 2) {
          upsideByTicker[symbol] = null;
          continue;
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

        if (startClose > 0 && latestClose > 0) {
          upsideByTicker[symbol] = (latestClose / startClose - 1) * 100;
        } else {
          upsideByTicker[symbol] = null;
        }
      } catch {
        upsideByTicker[symbol] = null;
      }
    }

    // 3) Fetch chains per ticker and choose strikes by OTM level
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

      const targetStrike = side === "P" ? spot * (1 - targetOtmPct / 100) : spot * (1 + targetOtmPct / 100);
      let best: { strike: number; diff: number } | null = null;

      for (const strike of strikes) {
        const distPct = side === "P" ? ((spot - strike) / spot) * 100 : ((strike - spot) / spot) * 100;
        if (!Number.isFinite(distPct)) continue;

        const diff = Math.abs(distPct - targetOtmPct);
        const eligible = diff <= strikeTolerancePct;
        if (!best) best = { strike, diff };
        else if (diff < best.diff) best = { strike, diff };

        // If we found within tolerance, we can keep looking for a tighter match; don't early return.
        // (This keeps the choice stable.)
        if (eligible && diff === 0) return strike;
      }

      if (!best) return null;
      // Fallback: if nothing found within tolerance, pick nearest strike by OTM distance.
      return best.strike;
    };

    for (const ticker of effectiveTickers) {
      const spot = currentPriceByTicker[ticker];
      if (!spot || spot <= 0) continue;

      const contractType = type === "C" ? "CALL" : "PUT";
      const params = new URLSearchParams({
        symbol: ticker,
        contractType,
        includeUnderlyingQuote: "FALSE",
        strategy: "SINGLE",
        fromDate: fromStr,
        toDate: toStr,
        // Lower strikeCount reduces payload/time for each chain call.
        strikeCount: "20",
      });

      const chainResp = await fetch(
        `https://api.schwabapi.com/marketdata/v1/chains?${params}`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      throwIfRateLimited(chainResp, "chains");
      if (!chainResp.ok) continue;
      const chainBody: any = await chainResp.json();
      const expMap = type === "C" ? chainBody?.callExpDateMap : chainBody?.putExpDateMap;
      if (!expMap || typeof expMap !== "object") continue;

      let strikesObjForExpiry: any = null;
      let bestExpiryDiffMs: number | null = null;

      for (const [expKey, strikesObj] of Object.entries<any>(expMap)) {
        const exp = toExpiryYYYYMMDD(expKey);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(exp)) continue;

        const expDate = new Date(exp + "T00:00:00Z");
        if (Number.isNaN(expDate.getTime())) continue;

        const diffMs = Math.abs(expDate.getTime() - expiryDate.getTime());
        if (diffMs === 0) {
          strikesObjForExpiry = strikesObj;
          bestExpiryDiffMs = 0;
          break;
        }

        if (bestExpiryDiffMs == null || diffMs < bestExpiryDiffMs) {
          bestExpiryDiffMs = diffMs;
          strikesObjForExpiry = strikesObj;
        }
      }

      // Fallback: if we couldn't match any expiry key, take the first available.
      if (!strikesObjForExpiry) {
        const first = Object.entries<any>(expMap)[0];
        strikesObjForExpiry = first?.[1] ?? null;
      }
      if (!strikesObjForExpiry || typeof strikesObjForExpiry !== "object") continue;

      const strikes: number[] = [];
      for (const [strikeStr, contracts] of Object.entries<any>(strikesObjForExpiry)) {
        const strike = Number(strikeStr);
        if (!Number.isFinite(strike) || strike <= 0) continue;
        if (Array.isArray(contracts) && contracts.length > 0) strikes.push(strike);
      }
      if (strikes.length === 0) continue;

      for (const otmPct of otmLevels) {
        const chosen = chooseStrike({ strikes, spot, targetOtmPct: otmPct, side: type });
        if (!chosen) continue;
        specs.push({
          ticker,
          expiry: expiration,
          type,
          otmPct,
          strike: chosen,
          currentPrice: spot,
        });
      }
    }

    if (specs.length === 0) {
      res.status(200).json({
        resultsByOtmPct: {},
        message: "No options found for the chosen expiration and OTM levels.",
        warnings,
      });
      return;
    }

    // 4) Option quotes for all selected strikes (OCC batch)
    const optionQuotes: Record<string, { bid?: number; ask?: number }> = {};
    const BATCH = 30;

    // Deduplicate OCC symbols to avoid duplicate quote requests when the same
    // strike accidentally maps to multiple OTM buckets.
    const occToSpecKeyMap = new Map<string, string>(); // occ -> specKey
    for (const s of specs) {
      const occ = toOCCSymbol(s.ticker, s.expiry, s.type, s.strike);
      const key = `${s.ticker} ${s.expiry} ${s.strike} ${s.type}`;
      if (!occToSpecKeyMap.has(occ)) occToSpecKeyMap.set(occ, key);
    }
    const occToSpecKey: { occ: string; key: string }[] = Array.from(occToSpecKeyMap.entries()).map(
      ([occ, key]) => ({ occ, key })
    );

    for (let i = 0; i < occToSpecKey.length; i += BATCH) {
      const batch = occToSpecKey.slice(i, i + BATCH);
      const occSymbols = batch.map((b) => b.occ);

      const qUrl =
        "https://api.schwabapi.com/marketdata/v1/quotes?" +
        new URLSearchParams({ symbols: occSymbols.join(",") }).toString();

      const qResp = await fetch(qUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      throwIfRateLimited(qResp, "option_quotes");
      if (!qResp.ok) continue;
      const qBody: any = await qResp.json();

      for (let j = 0; j < batch.length; j++) {
        const specKey = batch[j].key;
        const occ = batch[j].occ;
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

        const num = (x: any): number | undefined => (typeof x === "number" && Number.isFinite(x) ? x : undefined);
        const bid = num(src.bidPrice) ?? num(src.bid);
        const ask = num(src.askPrice) ?? num(src.ask);
        optionQuotes[specKey] = { bid, ask };
      }
    }

    // 5) Build results grouped by OTM %
    const resultsByOtmPct: Record<number, RankedOption[]> = {};

    for (const spec of specs) {
      const key = `${spec.ticker} ${spec.expiry} ${spec.strike} ${spec.type}`;
      const quote = optionQuotes[key];
      const bid = quote?.bid ?? 0;
      const ask = quote?.ask ?? bid;

      if (bid <= 0 && ask <= 0) continue;
      const optionPrice = bid > 0 ? bid : ask; // Sell-to-open: use bid

      const premiumPerContract = optionPrice * 100;
      const notional = spec.strike * 100; // 1 contract = 100 shares
      const yieldAtCurrentPricePct = notional !== 0 ? (premiumPerContract / notional) * 100 : 0;
      const annYieldPct = yieldAtCurrentPricePct * (365 / dte);

      const oneMonthPerfPct = upsideByTicker[spec.ticker] ?? null;
      const company = companyBySymbol[spec.ticker] ?? spec.ticker;

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
        company,
        oneMonthPerfPct: oneMonthPerfPct == null ? null : round2(oneMonthPerfPct),
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

    res.status(200).json({
      resultsByOtmPct,
      message: null,
      warnings,
      expiration,
      optionType: type,
      dte,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === RATE_LIMIT_ERR) {
      res.status(503).json({
        error:
          "Schwab rate limit (HTTP 429). Wait a short time and try again, or reduce “Max symbols to scan” on the Opportunities page.",
        resultsByOtmPct: {},
        message: null,
        warnings: [],
      });
      return;
    }
    if (msg.startsWith("UNIVERSE_")) {
      res.status(503).json({
        error:
          "Could not load the stock universe CSV (S&P 500 list). Check SCREENER_UNIVERSE_CSV_URL or try again later.",
        resultsByOtmPct: {},
        message: msg,
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

