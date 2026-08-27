// payoff.ts
// Simplified option-overlay payoff modeling: collars, covered calls, cash-secured puts.
// No dividends, taxes, early exercise, or borrow costs — illustrative at-expiration math only.

export type PayoffLegInput =
  | { kind: "collar"; spot: number; putStrike: number; callStrike: number; netPerShare: number }
  | { kind: "coveredCall"; spot: number; callStrike: number; premiumPerShare: number }
  | { kind: "cashSecuredPut"; spot: number; putStrike: number; premiumPerShare: number };

export type PayoffScenario = {
  returnPct: number;
  underlyingValue: number;
  underlyingReturnPct: number;
  strategyValue: number;
  strategyReturnPct: number;
};

export type PayoffStat = {
  label: string;
  value: string;
  tone?: "success" | "danger" | "neutral";
};

/** Strategy value per share at a given underlying price. */
export function computeStrategyValue(input: PayoffLegInput, underlyingValue: number): number {
  switch (input.kind) {
    case "collar": {
      const clamped = Math.min(Math.max(underlyingValue, input.putStrike), input.callStrike);
      return clamped - input.netPerShare;
    }
    case "coveredCall": {
      const clamped = Math.min(underlyingValue, input.callStrike);
      return clamped + input.premiumPerShare;
    }
    case "cashSecuredPut": {
      const clamped = Math.min(underlyingValue, input.putStrike);
      return clamped + input.premiumPerShare;
    }
  }
}

function roundTo(value: number, step: number): number {
  return Math.round(value / step) * step;
}

/** Dense return points for smooth chart rendering. */
export function buildChartReturnPoints(floorPct?: number, capPct?: number): number[] {
  const extremes = [floorPct, capPct].filter((v): v is number => Number.isFinite(v as number));
  const maxAbs = extremes.length > 0 ? Math.max(...extremes.map((v) => Math.abs(v))) : 30;
  const bound = Math.max(30, roundTo(maxAbs + 15, 10));
  const step = bound > 70 ? 5 : 2;
  const points: number[] = [];
  for (let v = -bound; v <= bound; v += step) points.push(v);
  return points;
}

function safeNum(n: number, fallback = 0): number {
  return Number.isFinite(n) ? n : fallback;
}

/** Coerce leg inputs so missing API fields never produce NaN in charts/stats. */
export function normalizePayoffInput(input: PayoffLegInput): PayoffLegInput {
  const spot = safeNum(input.spot);
  switch (input.kind) {
    case "collar":
      return {
        kind: "collar",
        spot,
        putStrike: safeNum(input.putStrike),
        callStrike: safeNum(input.callStrike),
        netPerShare: safeNum(input.netPerShare),
      };
    case "coveredCall":
      return {
        kind: "coveredCall",
        spot,
        callStrike: safeNum(input.callStrike),
        premiumPerShare: safeNum(input.premiumPerShare),
      };
    case "cashSecuredPut":
      return {
        kind: "cashSecuredPut",
        spot,
        putStrike: safeNum(input.putStrike),
        premiumPerShare: safeNum(input.premiumPerShare),
      };
  }
}

/** Sparse return points for the scenario table — includes floor, cap, and 0%. */
export function buildAdaptiveReturnPoints(floorPct?: number, capPct?: number): number[] {
  const extremes = [floorPct, capPct].filter((v): v is number => Number.isFinite(v as number));
  const maxAbs = extremes.length > 0 ? Math.max(...extremes.map((v) => Math.abs(v))) : 30;
  const padded = Math.max(30, maxAbs + 15);
  const bound = roundTo(padded, 10);
  const step = bound > 70 ? 15 : 10;

  const points = new Set<number>();
  for (let v = -bound; v <= bound; v += step) points.add(v);
  points.add(0);
  if (Number.isFinite(floorPct as number)) points.add(Math.round(floorPct as number));
  if (Number.isFinite(capPct as number)) points.add(Math.round(capPct as number));
  return Array.from(points).sort((a, b) => a - b);
}

export function buildPayoffScenarios(input: PayoffLegInput, returnPoints: number[]): PayoffScenario[] {
  const spot = input.spot;
  return returnPoints.map((returnPct) => {
    const underlyingValue = spot * (1 + returnPct / 100);
    const strategyValue = computeStrategyValue(input, underlyingValue);
    const strategyReturnPct = ((strategyValue - spot) / spot) * 100;
    return {
      returnPct,
      underlyingValue: Math.round(underlyingValue * 100) / 100,
      underlyingReturnPct: returnPct,
      strategyValue: Math.round(strategyValue * 100) / 100,
      strategyReturnPct: Math.round(strategyReturnPct * 100) / 100,
    };
  });
}

/** Analytic breakeven return% (where strategy return crosses 0), clamped into the floor/cap band when applicable. */
export function computeBreakevenReturnPct(input: PayoffLegInput): number {
  const spot = input.spot;
  switch (input.kind) {
    case "collar": {
      const raw = (input.netPerShare / spot) * 100;
      const floorPct = ((input.putStrike - spot) / spot) * 100;
      const capPct = ((input.callStrike - spot) / spot) * 100;
      return Math.min(Math.max(raw, floorPct), capPct);
    }
    case "coveredCall": {
      const raw = (-input.premiumPerShare / spot) * 100;
      const capPct = ((input.callStrike - spot) / spot) * 100;
      return Math.min(raw, capPct);
    }
    case "cashSecuredPut": {
      const raw = (-input.premiumPerShare / spot) * 100;
      const floorPct = ((input.putStrike - spot) / spot) * 100;
      return Math.max(raw, floorPct);
    }
  }
}

function formatSignedMoney(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  const sign = n > 0 ? "+" : n < 0 ? "−" : "";
  return `${sign}$${abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatSignedPct(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : n < 0 ? "−" : "";
  return `${sign}${Math.abs(n).toFixed(1)}%`;
}

export function computePayoffStats(
  input: PayoffLegInput,
  shares: number,
  daysToMaturity: number
): PayoffStat[] {
  const spot = input.spot;
  const basisShares = shares > 0 ? shares : 100;
  const positionValue = spot * basisShares;
  const annFactor = daysToMaturity > 0 ? 365 / daysToMaturity : 0;
  const stats: PayoffStat[] = [];

  stats.push({
    label: shares > 0 ? "Position value" : "Notional (1 ctr)",
    value: `$${positionValue.toLocaleString("en-US", { maximumFractionDigits: 0 })}`,
  });

  if (input.kind === "collar") {
    const netTotal = input.netPerShare * basisShares;
    stats.push({
      label: input.netPerShare >= 0 ? "Net cost" : "Net credit",
      value: `${formatSignedMoney(input.netPerShare)}/sh · ${formatSignedMoney(netTotal)} total`,
      tone: input.netPerShare > 0 ? "danger" : input.netPerShare < 0 ? "success" : "neutral",
    });
    const floorPct = ((input.putStrike - spot) / spot) * 100;
    const capPct = ((input.callStrike - spot) / spot) * 100;
    stats.push({ label: "Downside floor", value: `${formatSignedPct(floorPct)} return`, tone: "danger" });
    stats.push({ label: "Upside cap", value: `${formatSignedPct(capPct)} return`, tone: "success" });
    if (annFactor > 0) {
      const annPct = (input.netPerShare / spot) * annFactor * 100;
      stats.push({
        label: annPct >= 0 ? "Annualized cost" : "Annualized yield",
        value: formatSignedPct(annPct),
        tone: annPct > 0 ? "danger" : "success",
      });
    }
  } else {
    const premiumTotal = input.premiumPerShare * basisShares;
    stats.push({
      label: "Premium collected",
      value: `$${input.premiumPerShare.toFixed(2)}/sh · $${premiumTotal.toLocaleString("en-US", { maximumFractionDigits: 0 })} total`,
      tone: "success",
    });
    if (input.kind === "coveredCall") {
      const capPct = ((input.callStrike - spot) / spot) * 100;
      stats.push({ label: "Upside cap", value: `${formatSignedPct(capPct)} return`, tone: "success" });
    } else {
      const floorPct = ((input.putStrike - spot) / spot) * 100;
      stats.push({ label: "Effective floor", value: `${formatSignedPct(floorPct)} return`, tone: "danger" });
    }
    if (annFactor > 0) {
      const annYield = (input.premiumPerShare / spot) * annFactor * 100;
      stats.push({ label: "Annualized yield", value: `${annYield.toFixed(1)}%`, tone: "success" });
    }
  }

  stats.push({ label: "Tenor", value: `${daysToMaturity} days` });
  const breakevenPct = computeBreakevenReturnPct(input);
  stats.push({ label: "Breakeven (stock return)", value: `${formatSignedPct(breakevenPct)}` });

  return stats;
}
