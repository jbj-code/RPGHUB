import express from "express";
import axios from "axios";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = process.env.SCHWAB_SERVER_PORT || 3001;

const CLIENT_ID = process.env.SCHWAB_CLIENT_ID;
const CLIENT_SECRET = process.env.SCHWAB_CLIENT_SECRET;
const REDIRECT_URI = process.env.SCHWAB_REDIRECT_URI;

if (!CLIENT_ID || !CLIENT_SECRET || !REDIRECT_URI) {
  console.warn(
    "[Schwab] Missing SCHWAB_CLIENT_ID, SCHWAB_CLIENT_SECRET, or SCHWAB_REDIRECT_URI in .env"
  );
}

const TOKEN_PATH = path.join(process.cwd(), "schwab_tokens.json");

function loadTokens() {
  try {
    const raw = fs.readFileSync(TOKEN_PATH, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveTokens(tokens) {
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2), "utf8");
}

// Step 1: send user to Schwab consent page
app.get("/auth/schwab/login", (req, res) => {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID ?? "",
    redirect_uri: REDIRECT_URI ?? "",
    scope: "readonly",
  });

  const url = `https://api.schwabapi.com/v1/oauth/authorize?${params.toString()}`;
  res.redirect(url);
});

// Step 2 (manual): take an authorization code (from Schwab's hosted redirect page)
// and exchange it for tokens. Usage:
// 1) Go to /auth/schwab/login
// 2) Log in at Schwab; you'll land on https://developer.schwab.com/oauth2-redirect.html?code=...
// 3) Copy the `code` value from the URL
// 4) Visit http://localhost:3001/auth/schwab/manual?code=PASTE_CODE_HERE
app.get("/auth/schwab/manual", async (req, res) => {
  const code = req.query.code;
  if (!code || typeof code !== "string") {
    return res.status(400).send("Missing authorization code");
  }

  try {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT_URI ?? "",
    });

    const authHeader = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString(
      "base64"
    );

    const tokenResp = await axios.post(
      "https://api.schwabapi.com/v1/oauth/token",
      body.toString(),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${authHeader}`,
        },
      }
    );

    saveTokens(tokenResp.data);
    res.send(
      "Schwab authorization complete. You can close this tab and return to RPG HUB."
    );
  } catch (err) {
    console.error("Error exchanging Schwab code:", err?.response?.data ?? err);
    res.status(500).send("Failed to exchange code. Check server logs.");
  }
});

async function getAccessToken() {
  const tokens = loadTokens();
  if (!tokens) return null;

  // Very simple: assume token is valid. In production you'd refresh if expired.
  return tokens.access_token;
}

// Market data proxy - quotes
app.get("/api/schwab/quotes", async (req, res) => {
  const symbols = req.query.symbols;
  if (!symbols || typeof symbols !== "string") {
    return res.status(400).json({ error: "symbols query parameter is required" });
  }

  const accessToken = await getAccessToken();
  if (!accessToken) {
    return res
      .status(401)
      .json({ error: "Not authorized with Schwab. Visit /auth/schwab/login first." });
  }

  try {
    const resp = await axios.get(
      "https://api.schwabapi.com/marketdata/v1/quotes",
      {
        params: { symbols },
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );
    res.json(resp.data);
  } catch (err) {
    console.error("Error fetching Schwab quotes:", err?.response?.data ?? err);
    res.status(500).json({ error: "Failed to fetch quotes from Schwab" });
  }
});

app.listen(PORT, () => {
  console.log(`Schwab proxy server listening on http://localhost:${PORT}`);
});

