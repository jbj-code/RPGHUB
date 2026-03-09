// Vercel serverless function: OAuth callback from Schwab.
// Exchanges ?code for access token and stores it in memory on this lambda instance.

let schwabTokens: {
  access_token: string;
  refresh_token?: string;
  expires_at: number; // epoch ms
} | null = null;

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

    if (!clientId || !clientSecret || !redirectUri) {
      res
        .status(500)
        .send("Server missing SCHWAB_CLIENT_ID/SECRET/REDIRECT_URI env vars.");
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
    const now = Date.now();
    const expiresInSec =
      typeof json.expires_in === "number" ? json.expires_in : 3600;

    schwabTokens = {
      access_token: json.access_token,
      refresh_token: json.refresh_token,
      expires_at: now + expiresInSec * 1000,
    };

    res
      .status(200)
      .send(
        "Schwab authorization complete for this server instance. You can close this tab and use RPG HUB."
      );
  } catch (err) {
    console.error("schwab-auth-callback error", err);
    res.status(500).send("Unexpected error handling Schwab callback.");
  }
}

// Export a helper getter for other functions in this lambda to use.
export function getSchwabTokens() {
  return schwabTokens;
}

