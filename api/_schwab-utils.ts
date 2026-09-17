// _schwab-utils.ts
// Shared Schwab utilities: OCC symbol builder, resilient HTTP fetch, and OAuth token refresh.

/** Thrown / compared when Schwab returns HTTP 429 after retries. */
export const SCHWAB_RATE_LIMIT = "SCHWAB_RATE_LIMIT";

const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);
const DEFAULT_BACKOFF_MS = [0, 800, 2000];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch Schwab market-data endpoints with retries on transient 429/5xx (Akama edge hiccups).
 * Returns the final Response — callers decide how to handle non-OK statuses.
 */
export async function fetchSchwabWithRetry(
  url: string,
  init: RequestInit = {},
  opts?: { maxAttempts?: number; backoffMs?: number[] },
): Promise<Response> {
  const maxAttempts = opts?.maxAttempts ?? 3;
  const backoffMs = opts?.backoffMs ?? DEFAULT_BACKOFF_MS;
  let last: Response | null = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const delay = backoffMs[Math.min(attempt, backoffMs.length - 1)] ?? 2000;
    if (attempt > 0 && delay > 0) await sleep(delay);

    last = await fetch(url, init);
    if (last.ok || !RETRYABLE_STATUSES.has(last.status)) return last;
  }

  return last!;
}

/** User-facing message for Sheets / API errors — never pass raw HTML through. */
export function formatSchwabErrorMessage(status: number, bodyText: string): string {
  if (status === 429) {
    return "Schwab rate limit reached. Wait 30–60 seconds and try again.";
  }
  if (status === 502 || status === 503 || status === 504) {
    return `Schwab temporarily unavailable (${status}). Try again in a moment.`;
  }

  const trimmed = bodyText.trim();
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as { message?: string; error?: string };
      const detail = parsed.message ?? parsed.error;
      if (detail) return `Schwab error: ${detail}`;
    } catch {
      /* fall through */
    }
  }

  const titleMatch =
    trimmed.match(/<TITLE>([^<]+)<\/TITLE>/i) ?? trimmed.match(/<title>([^<]+)<\/title>/i);
  if (titleMatch?.[1]) return `Schwab error: ${titleMatch[1].trim()}`;

  if (trimmed.includes("<html") || trimmed.includes("<HTML")) {
    return `Schwab error (${status}). Try again in a moment.`;
  }

  if (trimmed) return `Schwab error: ${trimmed.slice(0, 200)}`;
  return `Schwab error (${status}).`;
}

export function throwIfSchwabRateLimited(resp: Response): void {
  if (resp.status === 429) throw new Error(SCHWAB_RATE_LIMIT);
}

// --- OCC symbol builder ---
/** Build an OCC option symbol: 6-char root + YYMMDD + C|P + 8-digit strike (strike × 1000). */
export function toOCCSymbol(
  underlying: string,
  expiry: string,
  type: "C" | "P",
  strike: number
): string {
  const root = underlying.trim().toUpperCase().padEnd(6).slice(0, 6);
  const [y, m, d] = expiry.split("-");
  const yymmdd = `${y!.slice(-2)}${m}${d}`;
  const strikeVal = Math.round(strike * 1000);
  const strikeStr = String(strikeVal).padStart(8, "0");
  return `${root}${yymmdd}${type}${strikeStr}`;
}

// --- Token refresh ---
/**
 * Returns a valid (non-expired) Schwab access token, automatically refreshing via
 * the OAuth token endpoint if the stored token is within the 5-minute expiry buffer.
 *
 * Returns null when:
 *  - Refresh fails (bad credentials / Schwab error)
 *  - Token is expired and no refresh token is stored
 */
export async function getValidAccessToken(
  supabase: any,
  tokenRow: {
    access_token: string;
    refresh_token?: string | null;
    expires_at?: string | null;
  }
): Promise<string | null> {
  const expiresAt =
    tokenRow.expires_at != null ? new Date(tokenRow.expires_at).getTime() : null;
  const now = Date.now();
  const bufferMs = 5 * 60 * 1000; // treat token as expired 5 min before actual expiry

  const needsRefresh = expiresAt != null && now >= expiresAt - bufferMs;

  // Token is valid and not approaching expiry — return immediately.
  if (!needsRefresh && tokenRow.access_token) return tokenRow.access_token;

  // No refresh token: return current access token if not hard-expired, else null.
  if (!tokenRow.refresh_token) {
    return expiresAt == null || now < expiresAt ? tokenRow.access_token : null;
  }

  const clientId = process.env.SCHWAB_CLIENT_ID;
  const clientSecret = process.env.SCHWAB_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  const authHeader = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  try {
    const refreshResp = await fetch("https://api.schwabapi.com/v1/oauth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${authHeader}`,
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: tokenRow.refresh_token,
      }),
    });

    if (!refreshResp.ok) return null;

    const refreshJson: any = await refreshResp.json();
    const newExpiresIn =
      typeof refreshJson.expires_in === "number" ? refreshJson.expires_in : 1800;
    const newExpiresAt = new Date(now + newExpiresIn * 1000).toISOString();

    await supabase
      .from("schwab_tokens")
      .update({
        access_token: refreshJson.access_token,
        expires_at: newExpiresAt,
        ...(refreshJson.refresh_token != null && {
          refresh_token: refreshJson.refresh_token,
        }),
      })
      .eq("id", "default");

    return refreshJson.access_token as string;
  } catch {
    return null;
  }
}
