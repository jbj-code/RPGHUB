// Vercel serverless: proxy to Schwab Market Data /quotes. Reads token from Supabase.

import { createClient } from "@supabase/supabase-js";

export default async function handler(req: any, res: any) {
  try {
    const symbols = req.query.symbols as string | undefined;
    if (!symbols) {
      res
        .status(400)
        .json({
          error: "symbols query parameter is required, e.g. ?symbols=SPY,QQQ",
        });
      return;
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !supabaseServiceKey) {
      res.status(500).json({
        error: "Server missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.",
      });
      return;
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const { data, error } = await supabase
      .from("schwab_tokens")
      .select("access_token, expires_at")
      .eq("id", "default")
      .single();

    if (error || !data?.access_token) {
      res.status(401).json({
        error:
          "Not authorized with Schwab. Run the Schwab login flow again, then try quotes.",
      });
      return;
    }

    const expiresAt = data.expires_at
      ? new Date(data.expires_at).getTime()
      : 0;
    if (Date.now() >= expiresAt) {
      res.status(401).json({
        error: "Schwab token expired. Run the Schwab login flow again.",
      });
      return;
    }

    const resp = await fetch(
      "https://api.schwabapi.com/marketdata/v1/quotes?" +
        new URLSearchParams({ symbols }).toString(),
      {
        headers: {
          Authorization: `Bearer ${data.access_token}`,
        },
      }
    );

    const text = await resp.text();
    res
      .status(resp.status)
      .setHeader("Content-Type", "application/json")
      .send(text);
  } catch (err) {
    console.error("schwab-quotes error", err);
    res.status(500).json({ error: "Unexpected error calling Schwab /quotes" });
  }
}
