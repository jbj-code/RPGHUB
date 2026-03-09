// Vercel serverless function: proxy to Schwab Market Data /quotes.

import { getSchwabTokens } from "./schwab-auth-callback";

export default async function handler(req: any, res: any) {
  try {
    const symbols = req.query.symbols as string | undefined;
    if (!symbols) {
      res
        .status(400)
        .json({ error: "symbols query parameter is required, e.g. ?symbols=SPY,QQQ" });
      return;
    }

    const tokens = getSchwabTokens();
    if (!tokens || !tokens.access_token || Date.now() >= tokens.expires_at) {
      res.status(401).json({
        error:
          "Not authorized with Schwab on this server instance. Run the Schwab login flow again.",
      });
      return;
    }

    const resp = await fetch(
      "https://api.schwabapi.com/marketdata/v1/quotes?" +
        new URLSearchParams({ symbols }).toString(),
      {
        headers: {
          Authorization: `Bearer ${tokens.access_token}`,
        },
      }
    );

    const text = await resp.text();
    res.status(resp.status).setHeader("Content-Type", "application/json").send(text);
  } catch (err) {
    console.error("schwab-quotes error", err);
    res.status(500).json({ error: "Unexpected error calling Schwab /quotes" });
  }
}

