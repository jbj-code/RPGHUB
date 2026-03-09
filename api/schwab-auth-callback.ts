// Vercel serverless: OAuth callback. Exchanges code for tokens and stores in Supabase.

import { createClient } from "@supabase/supabase-js";

export default async function handler(req: any, res: any) {
  try {
    const code = req.query.code as string | undefined;
    if (!code) {
      res.status(400).send("Missing ?code in query string.");
      return;
    }

    const clientId = process.env.SCHWAB_CLIENT_ID;
    const clientSecret = process.env.SCHWAB_CLIENT_SECRET;
    const redirectUri = process.env.SCHWAB_REDIRECT_URI;
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!clientId || !clientSecret || !redirectUri) {
      res
        .status(500)
        .send("Server missing SCHWAB_CLIENT_ID/SECRET/REDIRECT_URI env vars.");
      return;
    }
    if (!supabaseUrl || !supabaseServiceKey) {
      res
        .status(500)
        .send("Server missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
      return;
    }

    const authHeader = Buffer.from(`${clientId}:${clientSecret}`).toString(
      "base64"
    );

    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    });

    const tokenResp = await fetch("https://api.schwabapi.com/v1/oauth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${authHeader}`,
      },
      body,
    });

    if (!tokenResp.ok) {
      const text = await tokenResp.text();
      console.error("Schwab token error:", text);
      res.status(500).send("Failed to exchange code with Schwab.");
      return;
    }

    const json: any = await tokenResp.json();
    const expiresInSec =
      typeof json.expires_in === "number" ? json.expires_in : 3600;
    const expiresAt = new Date(
      Date.now() + expiresInSec * 1000
    ).toISOString();

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const { error } = await supabase
      .from("schwab_tokens")
      .upsert(
        {
          id: "default",
          access_token: json.access_token,
          refresh_token: json.refresh_token ?? null,
          expires_at: expiresAt,
        },
        { onConflict: "id" }
      );

    if (error) {
      console.error("Supabase upsert error:", error);
      res.status(500).send("Failed to save tokens. Check Vercel logs and Supabase table name/schema.");
      return;
    }

    res
      .status(200)
      .send(
        "Schwab authorization complete. You can close this tab and use RPG HUB."
      );
  } catch (err) {
    console.error("schwab-auth-callback error", err);
    res.status(500).send("Unexpected error handling Schwab callback.");
  }
}
