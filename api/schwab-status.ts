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

    if (error || !tokenRow?.access_token) {
      // No usable access token; only report "connected" if we at least have a refresh token.
      const hasRefresh = !!tokenRow?.refresh_token;
      res.status(200).json({
        connected: hasRefresh,
        expired: hasRefresh || undefined,
        hasRefresh: hasRefresh || undefined,
      });
      return;
    }

    const expiresAt =
      tokenRow.expires_at != null ? new Date(tokenRow.expires_at).getTime() : null;
    const expired = expiresAt != null && Date.now() >= expiresAt;
    const hasRefresh = !!tokenRow.refresh_token;

    res.status(200).json({
      connected: true,
      expired: expired || undefined,
      hasRefresh: hasRefresh || undefined,
    });
  } catch (err) {
    console.error("schwab-status error", err);
    res.status(200).json({ connected: false });
  }
}
