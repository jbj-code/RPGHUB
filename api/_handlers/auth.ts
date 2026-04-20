export async function handler(req: any, res: any): Promise<void> {
  const clientId = process.env.SCHWAB_CLIENT_ID;
  const redirectUri = process.env.SCHWAB_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    res.status(500).send("Server missing SCHWAB_CLIENT_ID or SCHWAB_REDIRECT_URI.");
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
