type NormalizedPosition = {
  id: string;
  family: string;
  account: string;
  underlying: string;
  expiry: string;
  strike: number;
  type: "C" | "P";
  raw: string;
};

const OPTION_LINE_RE =
  /^(call|put)\s+([A-Za-z.\-]+)\s*@?\s*\$?\s*([0-9]+(?:\.[0-9]+)?)\s*(?:exp|expiry|expiration)\s+([A-Za-z]{3,9})\s+([0-9]{1,2}),?\s+([0-9]{4})$/i;

function parseNaturalOptionLine(line: string): {
  underlying: string;
  expiry: string;
  strike: number;
  type: "C" | "P";
} | null {
  const m = line.trim().match(OPTION_LINE_RE);
  if (!m) return null;
  const monthMap: Record<string, number> = {
    jan: 1,
    january: 1,
    feb: 2,
    february: 2,
    mar: 3,
    march: 3,
    apr: 4,
    april: 4,
    may: 5,
    jun: 6,
    june: 6,
    jul: 7,
    july: 7,
    aug: 8,
    august: 8,
    sep: 9,
    sept: 9,
    september: 9,
    oct: 10,
    october: 10,
    nov: 11,
    november: 11,
    dec: 12,
    december: 12,
  };
  const type: "C" | "P" = m[1].toLowerCase().startsWith("c") ? "C" : "P";
  const underlying = m[2].toUpperCase();
  const strike = Number(m[3]);
  const month = monthMap[m[4].toLowerCase()];
  const day = Number(m[5]);
  const year = Number(m[6]);
  if (!underlying || !month || !Number.isFinite(strike) || strike <= 0) return null;
  const expiry = `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day
    .toString()
    .padStart(2, "0")}`;
  return { underlying, expiry, strike, type };
}

function normalizeDateYmd(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const s = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function normalizeType(value: unknown): "C" | "P" | null {
  if (typeof value !== "string") return null;
  const s = value.trim().toLowerCase();
  if (s === "c" || s === "call") return "C";
  if (s === "p" || s === "put") return "P";
  return null;
}

function normalizeOne(row: any, idx: number): NormalizedPosition | null {
  const family = String(row.family ?? row.familyName ?? row.clientFamily ?? "Unknown family").trim();
  const account = String(row.account ?? row.accountName ?? row.account_number ?? "Unknown account").trim();
  const underlying = String(row.underlying ?? row.ticker ?? row.symbol ?? "").trim().toUpperCase();
  const expiry = normalizeDateYmd(row.expiry ?? row.expiration ?? row.expirationDate);
  const strike = Number(row.strike ?? row.strikePrice);
  const type = normalizeType(row.type ?? row.optionType ?? row.putCall);
  if (!underlying || !expiry || !Number.isFinite(strike) || strike <= 0 || !type) return null;
  const raw = `${type === "C" ? "Call" : "Put"} ${underlying} @ $${strike} Exp ${expiry}`;
  return {
    id: `${family}|${account}|${underlying}|${expiry}|${strike}|${type}|${idx}`,
    family,
    account,
    underlying,
    expiry,
    strike,
    type,
    raw,
  };
}

function collectStringsDeep(node: unknown, out: string[], depth = 0): void {
  if (depth > 6 || out.length > 2000) return;
  if (typeof node === "string") {
    const s = node.trim();
    if (s) out.push(s);
    return;
  }
  if (Array.isArray(node)) {
    for (const v of node) collectStringsDeep(v, out, depth + 1);
    return;
  }
  if (node && typeof node === "object") {
    for (const v of Object.values(node as Record<string, unknown>)) collectStringsDeep(v, out, depth + 1);
  }
}

export default async function handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const addeparUrl = process.env.ADDEPAR_ASSIGNMENT_URL;
  const addeparKey = process.env.ADDEPAR_API_KEY;
  const addeparSecret = process.env.ADDEPAR_API_SECRET;
  const addeparToken = process.env.ADDEPAR_API_TOKEN;

  if (!addeparUrl) {
    res.status(503).json({
      error: "Missing ADDEPAR_ASSIGNMENT_URL in server environment.",
      positions: [],
    });
    return;
  }

  try {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (addeparToken) headers.Authorization = `Bearer ${addeparToken}`;
    if (addeparKey && addeparSecret) {
      headers.Authorization = `Basic ${Buffer.from(`${addeparKey}:${addeparSecret}`).toString("base64")}`;
      if (addeparToken) headers["X-API-Token"] = addeparToken;
    }
    if (addeparKey) headers["X-API-Key"] = addeparKey;
    if (addeparSecret) headers["X-API-Secret"] = addeparSecret;
    if (addeparToken) headers["X-Api-Token"] = addeparToken;

    const upstream = await fetch(addeparUrl, {
      method: "GET",
      headers,
    });
    if (!upstream.ok) {
      const text = await upstream.text();
      res.status(502).json({
        error: `Addepar request failed (${upstream.status}). ${text.slice(0, 220)}`,
        positions: [],
      });
      return;
    }

    const body: any = await upstream.json().catch(() => ({}));
    const rows = Array.isArray(body)
      ? body
      : Array.isArray(body?.positions)
      ? body.positions
      : Array.isArray(body?.data)
      ? body.data
      : [];
    const positionsFromRows = rows
      .map((r: any, i: number) => normalizeOne(r, i))
      .filter((x: NormalizedPosition | null): x is NormalizedPosition => Boolean(x));
    const positions: NormalizedPosition[] = [...positionsFromRows];

    if (positions.length === 0) {
      const allStrings: string[] = [];
      collectStringsDeep(body, allStrings);
      let family = "Imported family";
      let account = "Imported account";
      for (const s of allStrings) {
        if (/family/i.test(s) && !OPTION_LINE_RE.test(s)) {
          family = s;
          continue;
        }
        if (!OPTION_LINE_RE.test(s) && /account|schwab|pershing|ubp/i.test(s)) {
          account = s;
          continue;
        }
        const opt = parseNaturalOptionLine(s);
        if (!opt) continue;
        positions.push({
          id: `${family}|${account}|${opt.underlying}|${opt.expiry}|${opt.strike}|${opt.type}|${positions.length}`,
          family,
          account,
          raw: s,
          ...opt,
        });
      }
    }

    if (positions.length === 0) {
      const topKeys =
        body && typeof body === "object" && !Array.isArray(body) ? Object.keys(body).slice(0, 20) : [];
      res.status(200).json({
        positions: [],
        warnings: [
          "Addepar response received but no option positions were recognized yet.",
          `Response top-level keys: ${topKeys.join(", ") || "n/a"}`,
          "Need a sample JSON payload to finalize field mapping for your specific view.",
        ],
      });
      return;
    }

    res.status(200).json({ positions, warnings: [] });
  } catch (err: unknown) {
    res.status(500).json({
      error: err instanceof Error ? err.message : "Unexpected Addepar API error",
      positions: [],
    });
  }
}

