// _schwab-utils.ts
// Shared Schwab utilities: OCC symbol builder, resilient HTTP fetch, and OAuth token refresh.

/** Thrown / compared when Schwab returns HTTP 429 after retries. */
export const SCHWAB_RATE_LIMIT = "SCHWAB_RATE_LIMIT";

const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);
const DEFAULT_BACKOFF_MS = [0, 800, 2000];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --- Adaptive rate limiter (token bucket, self-tuning via AIMD) ---
//
// Schwab does not publish an exact per-app request ceiling (it's gated behind the developer
// portal login), and community client libraries commonly default to ~120 requests/minute as
// a guess. Rather than trust that number blindly, this limiter starts conservative and learns
// this app's real ceiling from live traffic: a long clean streak nudges the rate up, a 429
// immediately cuts it in half. Every Schwab call in this process shares one limiter instance,
// so screener, optimizer, sheets, and agent requests all draw from the same paced budget
// instead of each guessing its own concurrency number.
class SchwabRateLimiter {
  private ratePerMin: number;
  private readonly minRatePerMin: number;
  private readonly maxRatePerMin: number;
  private tokens: number;
  private lastRefill: number;
  private cleanStreak = 0;

  constructor(startRatePerMin = 100, minRatePerMin = 30, maxRatePerMin = 170) {
    this.ratePerMin = startRatePerMin;
    this.minRatePerMin = minRatePerMin;
    this.maxRatePerMin = maxRatePerMin;
    this.tokens = startRatePerMin;
    this.lastRefill = Date.now();
  }

  private refill(): void {
    const now = Date.now();
    const elapsedMin = (now - this.lastRefill) / 60_000;
    this.tokens = Math.min(this.ratePerMin, this.tokens + elapsedMin * this.ratePerMin);
    this.lastRefill = now;
  }

  /** Blocks until a request slot is available, then consumes one. */
  async acquire(): Promise<void> {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return;
    }
    const waitMs = ((1 - this.tokens) / this.ratePerMin) * 60_000;
    await sleep(Math.max(waitMs, 15));
    this.refill();
    this.tokens = Math.max(0, this.tokens - 1);
  }

  /** Call after a non-429 response. Slowly climbs the rate on a long clean streak. */
  reportSuccess(): void {
    this.cleanStreak += 1;
    if (this.cleanStreak % 50 === 0 && this.ratePerMin < this.maxRatePerMin) {
      this.ratePerMin = Math.min(this.maxRatePerMin, this.ratePerMin + 10);
    }
  }

  /** Call after a 429. Immediately halves the rate and drains the bucket. */
  reportRateLimited(): void {
    this.cleanStreak = 0;
    this.ratePerMin = Math.max(this.minRatePerMin, Math.floor(this.ratePerMin * 0.5));
    this.tokens = 0;
  }

  get currentRatePerMin(): number {
    return this.ratePerMin;
  }
}

// One limiter per warm serverless instance, shared across every Schwab call it makes.
// Note: Vercel functions are per-instance, not globally shared across concurrent cold
// starts, so this self-tunes per warm lambda rather than app-wide. That's the right
// tradeoff for RPG HUB's internal, low-concurrency usage — a cross-instance limiter would
// need an external store (e.g. Upstash Redis), which isn't worth the complexity unless
// usage grows well beyond a small team.
let sharedLimiter: SchwabRateLimiter | null = null;
export function getSchwabRateLimiter(): SchwabRateLimiter {
  if (!sharedLimiter) sharedLimiter = new SchwabRateLimiter();
  return sharedLimiter;
}

/**
 * Fetch Schwab market-data endpoints with rate-limiter pacing and retries on transient
 * 429/5xx (Akamai edge hiccups). Returns the final Response — callers decide how to
 * handle non-OK statuses.
 */
export async function fetchSchwabWithRetry(
  url: string,
  init: RequestInit = {},
  opts?: { maxAttempts?: number; backoffMs?: number[] },
): Promise<Response> {
  const maxAttempts = opts?.maxAttempts ?? 3;
  const backoffMs = opts?.backoffMs ?? DEFAULT_BACKOFF_MS;
  const limiter = getSchwabRateLimiter();
  let last: Response | null = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const delay = backoffMs[Math.min(attempt, backoffMs.length - 1)] ?? 2000;
    if (attempt > 0 && delay > 0) await sleep(delay);

    await limiter.acquire();
    last = await fetch(url, init);

    if (last.status === 429) {
      limiter.reportRateLimited();
    } else {
      limiter.reportSuccess();
    }

    if (last.ok || !RETRYABLE_STATUSES.has(last.status)) return last;
  }

  return last!;
}

/**
 * Runs `worker` over every item using up to `concurrency` parallel workers, each pulling
 * the next item as soon as it finishes (no fixed-size batches waiting on the slowest
 * request). Pair with `fetchSchwabWithRetry` inside `worker` — the shared rate limiter
 * paces actual Schwab throughput; this just bounds how many requests are in flight at once.
 */
export async function runSchwabPool<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let next = 0;
  async function runWorker(): Promise<void> {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      await worker(items[index]!, index);
    }
  }
  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
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
