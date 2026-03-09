// Vercel serverless: redirect to Schwab OAuth authorize URL so the user can log in.
// After they authorize, Schwab redirects to SCHWAB_REDIRECT_URI (your callback) with ?code=...
// Use this URL when the token has expired or you need to connect market data.

export default async function handler(req: any, res: any) {
  const clientId = process.env.SCHWAB_CLIENT_ID;
  const redirectUri = process.env.SCHWAB_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    res.status(500).send("Server missing SCHWAB_CLIENT_ID or SCHWAB_REDIRECT_URI. Set them in Vercel (and use the deployed callback URL as redirect, e.g. https://your-app.vercel.app/api/schwab-auth-callback).");
    return;
  }

  const authorizeUrl =
    "https://api.schwabapi.com/v1/oauth/authorize?" +
    new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
    }).toString();

  res.redirect(302, authorizeUrl);
}
