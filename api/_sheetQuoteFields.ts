// _sheetQuoteFields.ts
// Shared field map and value extraction for Google Sheets option quote handlers.

export type SheetOptFieldDef =
  | { src: "quote" | "reference"; key: string }
  | { src: "computed"; fn: (quote: any, ref: any) => any };

/** Fields accepted by SCHWAB_OPT(symbol, field) — case-insensitive. */
export const SHEET_OPT_FIELD_MAP: Record<string, SheetOptFieldDef> = {
  bid: { src: "quote", key: "bidPrice" },
  ask: { src: "quote", key: "askPrice" },
  mark: { src: "quote", key: "mark" },
  mid: { src: "quote", key: "mark" },
  last: { src: "quote", key: "lastPrice" },
  open: { src: "quote", key: "openPrice" },
  high: { src: "quote", key: "highPrice" },
  low: { src: "quote", key: "lowPrice" },
  close: { src: "quote", key: "closePrice" },
  theoretical: { src: "quote", key: "theoreticalOptionValue" },
  underlying: { src: "quote", key: "underlyingPrice" },
  bidsize: { src: "quote", key: "bidSize" },
  asksize: { src: "quote", key: "askSize" },
  lastsize: { src: "quote", key: "lastSize" },
  oi: { src: "quote", key: "openInterest" },
  openinterest: { src: "quote", key: "openInterest" },
  volume: { src: "quote", key: "totalVolume" },
  iv: { src: "quote", key: "volatility" },
  delta: { src: "quote", key: "delta" },
  gamma: { src: "quote", key: "gamma" },
  theta: { src: "quote", key: "theta" },
  vega: { src: "quote", key: "vega" },
  rho: { src: "quote", key: "rho" },
  intrinsic: { src: "quote", key: "moneyIntrinsicValue" },
  timevalue: { src: "quote", key: "timeValue" },
  netchange: { src: "quote", key: "netChange" },
  pctchange: { src: "quote", key: "netPercentChange" },
  markchange: { src: "quote", key: "markChange" },
  markpct: { src: "quote", key: "markPercentChange" },
  strike: { src: "reference", key: "strikePrice" },
  dte: { src: "reference", key: "daysToExpiration" },
  type: { src: "reference", key: "contractType" },
  exptype: { src: "reference", key: "expirationType" },
  settlement: { src: "reference", key: "settlementType" },
  multiplier: { src: "reference", key: "multiplier" },
  spread: { src: "computed", fn: (q) => round4((q?.askPrice ?? 0) - (q?.bidPrice ?? 0)) },
  limit: {
    src: "computed",
    fn: (q) => q?.mark ?? round4(((q?.bidPrice ?? 0) + (q?.askPrice ?? 0)) / 2),
  },
};

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

export function listSheetOptFields(): string[] {
  return Object.keys(SHEET_OPT_FIELD_MAP);
}

export function resolveQuoteSymbolData(
  data: Record<string, unknown>,
  symbol: string,
): any | null {
  const direct = data[symbol];
  if (direct && typeof direct === "object") return direct;
  const keys = Object.keys(data);
  if (keys.length === 0) return null;
  const normalized = symbol.replace(/\s+/g, "");
  for (const key of keys) {
    if (key.replace(/\s+/g, "") === normalized) return data[key];
  }
  return data[keys[0]];
}

export function extractSheetOptField(symbolData: any, fieldRaw: string): any {
  const fieldDef = SHEET_OPT_FIELD_MAP[fieldRaw];
  if (!fieldDef) return undefined;

  const quoteObj = symbolData?.quote;
  const refObj = symbolData?.reference;

  if (fieldDef.src === "computed") {
    return fieldDef.fn(quoteObj, refObj);
  }
  if (fieldDef.src === "quote") {
    return quoteObj?.[fieldDef.key];
  }
  return refObj?.[fieldDef.key];
}
