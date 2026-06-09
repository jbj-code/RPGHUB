// schwab.ts
// Single Vercel entry routing Schwab + OpenFIGI actions by `action` query/body param.

import { handler as handleAuth } from "./_handlers/auth.js";
import { handler as handleStatus } from "./_handlers/status.js";
import { handler as handleQuotes } from "./_handlers/quotes.js";
import { handler as handleReturns } from "./_handlers/returns.js";
import { handler as handleFigi } from "./_handlers/figi.js";
import { handler as handlePrices } from "./_handlers/prices.js";
import { handler as handleOptimize } from "./_handlers/optimize.js";
import { handler as handleScreener } from "./_handlers/screener.js";
import { handler as handleExplorer } from "./_handlers/explorer.js";

// --- Action router ---
export default async function handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }

  const action: string | undefined =
    req.method === "GET" ? (req.query.action as string | undefined) : req.body?.action;

  switch (action) {
    case "auth":     return handleAuth(req, res);
    case "status":   return handleStatus(req, res);
    case "quotes":   return handleQuotes(req, res);
    case "returns":  return handleReturns(req, res);
    case "figi":     return handleFigi(req, res);
    case "prices":   return handlePrices(req, res);
    case "optimize": return handleOptimize(req, res);
    case "screener": return handleScreener(req, res);
    case "explorer": return handleExplorer(req, res);
    default:
      res.status(400).json({
        error: `Unknown or missing action: "${action}". Valid: auth, status, quotes, returns, figi, prices, optimize, screener, explorer`,
      });
  }
}
