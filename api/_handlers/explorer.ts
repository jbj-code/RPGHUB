// explorer.ts
// Generic Schwab Market Data proxy for the Explorer page (path + params in request body).

import { createClient } from "@supabase/supabase-js";
import { getValidAccessToken } from "../_schwab-utils.js";

// --- API explorer handler ---
/** Body: { action: "explorer", explorePath: string, explorerParams?: Record<string, string> } */
export async function handler(req: any, res: any): Promise<void> {
  try {
    const { explorePath, explorerParams } = req.body as {
      explorePath: string;
      explorerParams?: Record<string, string>;
    };

    if (!explorePath || typeof explorePath !== "string") {
      res.status(400).json({ error: "explorePath is required (e.g. /marketdata/v1/quotes)" });
      return;
    }

    // Block anything that isn't a Schwab market-data or trader path to avoid abuse.
    if (!explorePath.startsWith("/marketdata/") && !explorePath.startsWith("/trader/")) {
      res
        .status(400)
        .json({ error: "explorePath must start with /marketdata/ or /trader/" });
      return;
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !supabaseServiceKey) {
      res.status(500).json({ error: "Server missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY." });
      return;
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const { data: tokenRow, error } = await supabase
      .from("schwab_tokens")
      .select("access_token, refresh_token, expires_at")
      .eq("id", "default")
      .single();

    if (error || !tokenRow?.access_token) {
      res.status(401).json({ error: "Not authorized with Schwab. Run the Schwab login flow again." });
      return;
    }

    const accessToken = await getValidAccessToken(supabase, tokenRow);
    if (!accessToken) {
      res.status(401).json({ error: "Schwab token expired. Re-authenticate via the Schwab login flow." });
      return;
    }

    // Build URL, strip empty params
    let url = `https://api.schwabapi.com${explorePath}`;
    if (explorerParams && typeof explorerParams === "object") {
      const filtered = Object.fromEntries(
        Object.entries(explorerParams).filter(([, v]) => v !== "" && v != null)
      );
      if (Object.keys(filtered).length > 0) {
        url += "?" + new URLSearchParams(filtered).toString();
      }
    }

    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    const text = await resp.text();
    res.status(resp.status).setHeader("Content-Type", "application/json").send(text);
  } catch (err) {
    console.error("schwab explorer error", err);
    res.status(500).json({ error: "Unexpected error in Schwab API explorer" });
  }
}
