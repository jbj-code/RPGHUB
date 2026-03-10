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

    const byUnderlying: Record<string, OptionInput[]> = {};
    for (const opt of inputs) {
      const u = opt.underlying.trim().toUpperCase();
      if (!u) continue;
      if (!byUnderlying[u]) byUnderlying[u] = [];
      byUnderlying[u].push(opt);
    }

    const results: Record<string, OptionPrice> = {};

    for (const [underlying, opts] of Object.entries(byUnderlying)) {
      const params = new URLSearchParams({
        symbol: underlying,
        contractType: "ALL",
        includeUnderlyingQuote: "FALSE",
        strategy: "SINGLE",
      });
      const url =
        "https://api.schwabapi.com/marketdata/v1/optionchains?" +
        params.toString();
      const resp = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!resp.ok) {
        const text = await resp.text();
        console.error(
          "[schwab-option-prices] optionchains error for",
          underlying,
          resp.status,
          text.slice(0, 400)
        );
        continue;
      }
      const body: any = await resp.json();
      const chain =
        body?.callExpDateMap || body?.putExpDateMap
          ? body
          : body?.optionChain || body;

      function normalizeExpiryKey(expiry: string): string {
        return expiry; // we will match by date parts below
      }

      const targetMap = new Map<string, OptionInput>();
      for (const opt of opts) {
        const key = `${opt.expiry}|${opt.strike}|${opt.type}`;
        targetMap.set(key, opt);
      }

      const expMaps: { [k: string]: any }[] = [];
      if (chain.callExpDateMap) expMaps.push(chain.callExpDateMap);
      if (chain.putExpDateMap) expMaps.push(chain.putExpDateMap);

      for (const expMap of expMaps) {
        for (const [expKey, strikes] of Object.entries<any>(expMap)) {
          const [datePart] = (expKey as string).split(":");
          const expDate = datePart; // YYYY-MM-DD
          for (const [strikeStr, contracts] of Object.entries<any>(strikes)) {
            const strike = Number(strikeStr);
            const list: any[] = Array.isArray(contracts) ? contracts : [];
            if (!list.length) continue;
            const c = list[0];
            const type: "C" | "P" =
              c.putCall === "CALL" || c.putCall === "C" ? "C" : "P";
            const key = `${expDate}|${strike}|${type}`;
            const match = targetMap.get(key);
            if (!match) continue;
            const id = `${match.underlying.toUpperCase()} ${match.expiry} ${
              match.strike
            } ${match.type}`;
            results[id] = {
              symbol: c.symbol ?? id,
              description: c.description,
              bid: typeof c.bid === "number" ? c.bid : undefined,
              ask: typeof c.ask === "number" ? c.ask : undefined,
              last: typeof c.last === "number" ? c.last : undefined,
              mark: typeof c.mark === "number" ? c.mark : undefined,
            };
          }
        }
      }
    }

    res.status(200).json(results);
  } catch (err) {
    console.error("schwab-option-prices error", err);
    res.status(500).json({ error: "Unexpected error fetching option prices" });
  }
}

