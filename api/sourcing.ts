// sourcing.ts
// Sourcing API: SEC Form 4 insider sale scans (manual trigger from Sourcing page).

import { scanForm4Sales } from "./_edgar-utils.js";

/** Form 4 scans can run 30–90s; override the 60s default from vercel.json. */
export const config = { maxDuration: 120 };

export default async function handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed. Use POST." });
    return;
  }

  const body = req.body ?? {};
  const action = body.action as string | undefined;

  if (action !== "form4_scan") {
    res.status(400).json({
      error: `Unknown action "${action ?? ""}". Valid: form4_scan`,
    });
    return;
  }

  const days = clampInt(body.days, 1, 1, 30);
  const minValueUsd = clampInt(body.minValueUsd, 1_000_000, 100_000, 100_000_000);
  const maxFilingsToParse = clampInt(body.maxFilingsToParse, 100, 20, 200);
  const titleKeywordsOnly = body.titleKeywordsOnly === true;

  try {
    const result = await scanForm4Sales({
      days,
      minValueUsd,
      maxFilingsToParse,
      titleKeywordsOnly,
    });

    res.status(200).json({
      leads: result.leads,
      message: null,
      meta: {
        days,
        minValueUsd,
        filingsSearched: result.filingsSearched,
        filingsParsed: result.filingsParsed,
        parseErrors: result.parseErrors,
        leadCount: result.leads.length,
      },
    });
  } catch (err) {
    console.error("sourcing form4_scan error", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Form 4 scan failed.",
      leads: [],
    });
  }
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}
