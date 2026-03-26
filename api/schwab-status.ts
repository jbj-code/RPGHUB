// Vercel serverless: return whether a Schwab token exists and is not expired.
// Used by the password gate to show "Connect Schwab" or "You're all set". No token value is exposed.

import { createClient } from "@supabase/supabase-js";

export default async function handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !supabaseServiceKey) {
      res.status(200).json({ connected: false, error: "Server not configured" });
      return;
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const { data: tokenRow, error } = await supabase
      .from("schwab_tokens")
      .select("access_token, refresh_token, expires_at")
      .eq("id", "default")
      .single();

    const hasRefresh = !!tokenRow?.refresh_token;
    if (error || !tokenRow) {
      res.status(200).json({ connected: false });
      return;
    }

    const clientId = process.env.SCHWAB_CLIENT_ID;
    const clientSecret = process.env.SCHWAB_CLIENT_SECRET;

    async function tryRefresh(refreshToken: string): Promise<string | null> {
      if (!clientId || !clientSecret) return null;
      const authHeader = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
      const refreshBody = new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      });
      const refreshResp = await fetch("https://api.schwabapi.com/v1/oauth/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${authHeader}`,
        },
        body: refreshBody,
      });
      if (!refreshResp.ok) return null;
      const refreshJson: any = await refreshResp.json();
      const expiresInSec =
        typeof refreshJson.expires_in === "number" ? refreshJson.expires_in : 1800;
      const newExpiresAt = new Date(Date.now() + expiresInSec * 1000).toISOString();
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
      return refreshJson.access_token ?? null;
    }

    let accessToken = tokenRow.access_token as string | null;
    const expiresAt =
      tokenRow.expires_at != null ? new Date(tokenRow.expires_at).getTime() : null;
    const bufferMs = 5 * 60 * 1000; // 5 minutes: treat near-expiry as expired
    const expired = expiresAt != null && Date.now() >= expiresAt - bufferMs;

    // If missing or near-expired, attempt refresh now so status reflects real usable auth.
    if ((!accessToken || expired) && tokenRow.refresh_token) {
      accessToken = await tryRefresh(tokenRow.refresh_token);
    }

    if (!accessToken) {
      res.status(200).json({
        connected: false,
        expired: true,
        hasRefresh: hasRefresh || undefined,
      });
      return;
    }

    // Probe with a cheap quote request to verify token is actually accepted by Schwab.
    const probeResp = await fetch(
      "https://api.schwabapi.com/marketdata/v1/quotes?" +
        new URLSearchParams({ symbols: "SPY" }).toString(),
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    if (probeResp.status === 401 && tokenRow.refresh_token) {
      const refreshed = await tryRefresh(tokenRow.refresh_token);
      if (!refreshed) {
        res.status(200).json({
          connected: false,
          expired: true,
          hasRefresh: true,
        });
        return;
      }
      const secondProbe = await fetch(
        "https://api.schwabapi.com/marketdata/v1/quotes?" +
          new URLSearchParams({ symbols: "SPY" }).toString(),
        { headers: { Authorization: `Bearer ${refreshed}` } }
      );
      if (!secondProbe.ok) {
        res.status(200).json({
          connected: false,
          expired: true,
          hasRefresh: true,
        });
        return;
      }
    } else if (!probeResp.ok) {
      res.status(200).json({
        connected: false,
        expired: true,
        hasRefresh: hasRefresh || undefined,
      });
      return;
    }

    res.status(200).json({
      connected: true,
      hasRefresh: hasRefresh || undefined,
    });
  } catch (err) {
    console.error("schwab-status error", err);
    res.status(200).json({ connected: false });
  }
}
