import { createClient } from "@supabase/supabase-js";
import { getValidAccessToken } from "../_schwab-utils";

export async function handler(req: any, res: any): Promise<void> {
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

    const accessToken = await getValidAccessToken(supabase, tokenRow);
    if (!accessToken) {
      res.status(200).json({ connected: false, expired: true, hasRefresh: hasRefresh || undefined });
      return;
    }

    const probeResp = await fetch(
      "https://api.schwabapi.com/marketdata/v1/quotes?" +
        new URLSearchParams({ symbols: "SPY" }).toString(),
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    if (!probeResp.ok) {
      res.status(200).json({
        connected: false,
        expired: probeResp.status === 401,
        hasRefresh: hasRefresh || undefined,
      });
      return;
    }

    res.status(200).json({ connected: true, hasRefresh: hasRefresh || undefined });
  } catch (err) {
    console.error("schwab status error", err);
    res.status(200).json({ connected: false });
  }
}
