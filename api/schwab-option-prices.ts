import { createClient } from "@supabase/supabase-js";

type OptionInput = {
  underlying: string;
  expiry: string; // YYYY-MM-DD
  strike: number;
  type: "C" | "P";
};

type OptionPrice = {
  symbol: string;
  description?: string;
  underlyingPrice?: number;
  bid?: number;
  ask?: number;
  last?: number;
  mark?: number;
};

function parseBody(req: any): OptionInput[] {
  try {
    if (req.method === "GET") {
      const raw = req.query.options as string | undefined;
      if (!raw) return [];
      return JSON.parse(raw);
    }
    return Array.isArray(req.body) ? req.body : [];
  } catch {
    return [];
  }
}

/** Build OCC option symbol: 6-char root + YYMMDD + C|P + 8-digit strike (strike * 1000). */
function toOCCSymbol(opt: OptionInput): string {
  const root = opt.underlying.trim().toUpperCase().padEnd(6).slice(0, 6);
  const [y, m, d] = opt.expiry.split("-");
  const yymmdd = `${y!.slice(-2)}${m}${d}`;
  const strikeVal = Math.round(opt.strike * 1000);
  const strikeStr = String(strikeVal).padStart(8, "0");
  return `${root}${yymmdd}${opt.type}${strikeStr}`;
}

export default async function handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  if (req.method !== "POST" && req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const inputs = parseBody(req);
  if (!inputs || inputs.length === 0) {
    res.status(400).json({ error: "Request must contain an array of options." });
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
          "Not authorized with Schwab. Run the Schwab login flow again, then try quotes.",
      });
      return;
    }

    const expiresAt =
      tokenRow.expires_at != null
        ? new Date(tokenRow.expires_at).getTime()
        : null;
    const now = Date.now();
    const bufferMs = 5 * 60 * 1000;
    const needsRefresh = expiresAt != null && now >= expiresAt - bufferMs;

    let accessToken = tokenRow.access_token as string;

    if (needsRefresh && tokenRow.refresh_token) {
      const clientId = process.env.SCHWAB_CLIENT_ID;
      const clientSecret = process.env.SCHWAB_CLIENT_SECRET;
      if (!clientId || !clientSecret) {
        res
          .status(500)
          .json({ error: "Server missing Schwab client credentials." });
        return;
      }
      const authHeader = Buffer.from(`${clientId}:${clientSecret}`).toString(
        "base64"
      );
      const refreshBody = new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: tokenRow.refresh_token,
      });
      const refreshResp = await fetch(
        "https://api.schwabapi.com/v1/oauth/token",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Authorization: `Basic ${authHeader}`,
          },
          body: refreshBody,
        }
      );
      if (!refreshResp.ok) {
        console.error(
          "[schwab-option-prices] refresh failed",
          refreshResp.status
        );
        res.status(401).json({
          error: "Schwab token expired. Run the Schwab login flow again.",
        });
        return;
      }
      const refreshJson: any = await refreshResp.json();
      const newExpiresIn =
        typeof refreshJson.expires_in === "number"
          ? refreshJson.expires_in
          : 1800;
      const newExpiresAt = new Date(now + newExpiresIn * 1000).toISOString();
      await supabase
        .from("schwab_tokens")
        .update({
          access_token: refreshJson.access_token,
          expires_at: newExpiresAt,
          ...(refreshJson.refresh_token != null && {
            refresh_token: refreshJson.refresh_token,
          }),
        })
        .eq("id", "default");
      accessToken = refreshJson.access_token;
    } else if (expiresAt != null && now >= expiresAt) {
      res.status(401).json({
        error: "Schwab token expired. Run the Schwab login flow again.",
      });
      return;
    }

    const results: Record<string, OptionPrice> = {};
    const occToOpt = new Map<string, OptionInput>();

    for (const opt of inputs) {
      const u = opt.underlying.trim().toUpperCase();
      if (!u) continue;
      const occ = toOCCSymbol(opt);
      occToOpt.set(occ, opt);
    }

    const allOCC = [...occToOpt.keys()];
    const underlyingSymbols = [
      ...new Set(
        inputs
          .map((o) => o.underlying?.trim().toUpperCase())
          .filter((s): s is string => Boolean(s))
      ),
    ];
    const underlyingPriceBySymbol: Record<string, number> = {};
    const UNDERLYING_BATCH = 45;
    for (let i = 0; i < underlyingSymbols.length; i += UNDERLYING_BATCH) {
      const batch = underlyingSymbols.slice(i, i + UNDERLYING_BATCH);
      const uResp = await fetch(
        "https://api.schwabapi.com/marketdata/v1/quotes?" +
          new URLSearchParams({ symbols: batch.join(",") }).toString(),
        {
          headers: { Authorization: `Bearer ${accessToken}` },
        }
      );
      if (!uResp.ok) continue;
      const uBody: any = await uResp.json();
      for (const sym of batch) {
        const q = uBody[sym] ?? uBody[sym.replace(/\s+/g, "")];
        const src = q?.quote ?? q;
        const px =
          typeof src?.regularMarketLast === "number"
            ? src.regularMarketLast
            : typeof src?.lastPrice === "number"
            ? src.lastPrice
            : typeof src?.last === "number"
            ? src.last
            : typeof src?.close === "number"
            ? src.close
            : typeof src?.regularMarketPrice === "number"
            ? src.regularMarketPrice
            : undefined;
        if (typeof px === "number" && Number.isFinite(px) && px > 0) {
          underlyingPriceBySymbol[sym] = px;
        }
      }
    }
    const BATCH = 30;
    let firstResponseBody: any = null;
    for (let i = 0; i < allOCC.length; i += BATCH) {
      const batch = allOCC.slice(i, i + BATCH);
      const symbolsParam = batch.join(",");
      const url =
        "https://api.schwabapi.com/marketdata/v1/quotes?" +
        new URLSearchParams({ symbols: symbolsParam }).toString();
      const resp = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!resp.ok) {
        const text = await resp.text();
        console.error(
          "[schwab-option-prices] quotes error",
          resp.status,
          text.slice(0, 300)
        );
        continue;
      }
      const body: any = await resp.json();
      if (firstResponseBody === null) firstResponseBody = body;
      // Build map: response may be { [symbol]: quote } or { quotes: [ { symbol, ... } ] }
      const bySymbol = new Map<string, any>();
      if (body && typeof body === "object") {
        if (Array.isArray(body)) {
          for (const q of body) {
            if (q?.symbol) bySymbol.set(String(q.symbol).trim(), q);
          }
        } else if (Array.isArray(body.quotes)) {
          for (const q of body.quotes) {
            if (q?.symbol) bySymbol.set(String(q.symbol).trim(), q);
          }
        } else {
          for (const [k, v] of Object.entries(body)) {
            if (v && typeof v === "object") bySymbol.set(String(k).trim(), v);
          }
        }
      }
      for (const occ of batch) {
        const opt = occToOpt.get(occ);
        if (!opt) continue;
        const q =
          bySymbol.get(occ) ??
          bySymbol.get(occ.replace(/\s+/g, "")) ??
          body?.[occ];
        if (!q || typeof q !== "object") continue;
        // OptionContract / quote may be at top level or nested under .quote, .optionContract, .option
        const src =
          q.quote && typeof q.quote === "object"
            ? q.quote
            : q.optionContract && typeof q.optionContract === "object"
              ? q.optionContract
              : q.option && typeof q.option === "object"
                ? q.option
                : q;
        const num = (x: any): number | undefined =>
          typeof x === "number" && Number.isFinite(x) ? x : undefined;
        const bid = num(src.bidPrice) ?? num(src.bid);
        const ask = num(src.askPrice) ?? num(src.ask);
        const last = num(src.lastPrice) ?? num(src.last);
        const mark = num(src.markPrice) ?? num(src.mark);
        const id = `${opt.underlying.toUpperCase()} ${opt.expiry} ${opt.strike} ${opt.type}`;
        results[id] = {
          symbol: (q.symbol as string) ?? occ,
          description: q.description,
          underlyingPrice: underlyingPriceBySymbol[opt.underlying.toUpperCase()],
          bid,
          ask,
          last,
          mark,
        };
      }
    }

    if (Object.keys(results).length === 0 && allOCC.length > 0) {
      console.warn(
        "[schwab-option-prices] 0 results; first OCC sample:",
        allOCC[0],
        "Response keys:",
        typeof firstResponseBody === "object" && firstResponseBody !== null
          ? Object.keys(firstResponseBody).slice(0, 5)
          : "n/a"
      );
    }

    // If we have results but none have bid/ask/last/mark, attach debug so you can see response shape without server logs
    const hasAnyPrices = Object.values(results).some(
      (r) =>
        r.bid != null || r.ask != null || r.last != null || r.mark != null
    );
    const payload: Record<string, any> = { ...results };
    if (!hasAnyPrices && Object.keys(results).length > 0 && firstResponseBody) {
      const firstKey = Object.keys(firstResponseBody)[0];
      const firstQuote = firstKey
        ? (firstResponseBody as any)[firstKey]
        : null;
      payload._debug = {
        message:
          "No bid/ask/last/mark found; check structure below and share with dev.",
        firstResponseKey: firstKey,
        firstQuoteKeys:
          firstQuote && typeof firstQuote === "object"
            ? Object.keys(firstQuote)
            : null,
        firstQuoteNestedKeys:
          firstQuote?.quote && typeof firstQuote.quote === "object"
            ? Object.keys(firstQuote.quote)
            : firstQuote?.optionContract
              ? Object.keys(firstQuote.optionContract)
              : null,
      };
    }

    res.status(200).json(payload);
  } catch (err) {
    console.error("schwab-option-prices error", err);
    res.status(500).json({ error: "Unexpected error fetching option prices" });
  }
}

