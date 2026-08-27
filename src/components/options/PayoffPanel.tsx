// PayoffPanel.tsx
// Reusable "return at expiration" payoff chart + scenario table, shared by Collar and Leg Finder.

import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Theme } from "../../theme";
import { getModalBackdropStyle, shadows, zIndex } from "../../theme";
import {
  buildAdaptiveReturnPoints,
  buildChartReturnPoints,
  buildPayoffScenarios,
  computePayoffStats,
  normalizePayoffInput,
  type PayoffLegInput,
  type PayoffScenario,
} from "../../lib/payoff";

export type PayoffPanelProps = {
  theme: Theme;
  title: string;
  subtitle?: string;
  input: PayoffLegInput;
  shares: number;
  daysToMaturity: number;
  onClose: () => void;
};

function floorPctOf(input: PayoffLegInput): number | undefined {
  if (input.kind === "collar") return ((input.putStrike - input.spot) / input.spot) * 100;
  if (input.kind === "cashSecuredPut") return ((input.putStrike - input.spot) / input.spot) * 100;
  return undefined;
}

function capPctOf(input: PayoffLegInput): number | undefined {
  if (input.kind === "collar") return ((input.callStrike - input.spot) / input.spot) * 100;
  if (input.kind === "coveredCall") return ((input.callStrike - input.spot) / input.spot) * 100;
  return undefined;
}

function fmtPct(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}

function fmtDollar(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return `${n >= 0 ? "+" : "−"}$${Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

type ChartTooltipProps = {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number; color?: string }>;
  label?: number;
  theme: Theme;
};

function PayoffTooltip({ active, payload, label, theme: t }: ChartTooltipProps) {
  if (!active || !payload?.length || label == null) return null;
  return (
    <div
      style={{
        backgroundColor: t.colors.surface,
        border: `1px solid ${t.colors.border}`,
        borderRadius: t.radius.md,
        padding: `${t.spacing(1.5)} ${t.spacing(2)}`,
        boxShadow: shadows.dropdown,
        fontSize: "0.78rem",
        minWidth: 160,
      }}
    >
      <div style={{ fontWeight: 700, marginBottom: t.spacing(1), color: t.colors.text }}>
        Stock return: {fmtPct(label)}
      </div>
      {payload.map((entry) => (
        <div
          key={entry.name}
          style={{ display: "flex", justifyContent: "space-between", gap: t.spacing(3), marginTop: 4 }}
        >
          <span style={{ color: entry.color ?? t.colors.textMuted }}>{entry.name}</span>
          <span style={{ fontWeight: 600, color: t.colors.text }}>{fmtPct(Number(entry.value))}</span>
        </div>
      ))}
    </div>
  );
}

export function PayoffPanel({ theme: t, title, subtitle, input, shares, daysToMaturity, onClose }: PayoffPanelProps) {
  const normalized = normalizePayoffInput(input);
  const floorPct = floorPctOf(normalized);
  const capPct = capPctOf(normalized);
  const chartPoints = buildChartReturnPoints(floorPct, capPct);
  const tablePoints = buildAdaptiveReturnPoints(floorPct, capPct);
  const chartData = buildPayoffScenarios(normalized, chartPoints);
  const tableScenarios = buildPayoffScenarios(normalized, tablePoints);
  const stats = computePayoffStats(normalized, shares, daysToMaturity);
  const positionValue = normalized.spot * (shares > 0 ? shares : 100);

  const strategyLabel =
    normalized.kind === "collar" ? "Collar" : normalized.kind === "coveredCall" ? "Covered call" : "Cash-secured put";

  const chartMin = Math.min(...chartData.flatMap((d) => [d.underlyingReturnPct, d.strategyReturnPct]));
  const chartMax = Math.max(...chartData.flatMap((d) => [d.underlyingReturnPct, d.strategyReturnPct]));
  const yPad = Math.max(5, Math.ceil((chartMax - chartMin) * 0.08));
  const yDomain: [number, number] = [Math.floor(chartMin - yPad), Math.ceil(chartMax + yPad)];

  const primaryColor = t.colors.primary;
  const stockColor = t.mode === "dark" ? "#737373" : "#64748b";

  return (
    <>
      <div role="presentation" style={getModalBackdropStyle(t)} onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{
          position: "fixed",
          left: "50%",
          top: "50%",
          transform: "translate(-50%, -50%)",
          zIndex: zIndex.modal,
          backgroundColor: t.colors.surface,
          borderRadius: t.radius.lg,
          padding: t.spacing(6),
          width: "min(1120px, 96vw)",
          maxHeight: "94vh",
          overflowY: "auto",
          boxShadow: shadows.modal,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: t.spacing(4) }}>
          <div>
            <h3 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 700, color: t.colors.text, letterSpacing: "-0.01em" }}>
              {title}
            </h3>
            {subtitle && (
              <p style={{ margin: `${t.spacing(0.75)} 0 0`, fontSize: "0.82rem", color: t.colors.textMuted }}>{subtitle}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              padding: t.spacing(0.75),
              border: `1px solid ${t.colors.border}`,
              borderRadius: t.radius.md,
              background: t.colors.background,
              color: t.colors.textMuted,
              cursor: "pointer",
              display: "inline-flex",
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 20 }}>close</span>
          </button>
        </div>

        <div style={{ display: "flex", gap: t.spacing(4), flexWrap: "wrap" }}>
          <div
            style={{
              flex: "0 0 190px",
              display: "flex",
              flexDirection: "column",
              gap: t.spacing(2),
              padding: t.spacing(2.5),
              backgroundColor: t.colors.background,
              borderRadius: t.radius.md,
              border: `1px solid ${t.colors.border}`,
            }}
          >
            {stats.map((s) => (
              <div key={s.label}>
                <div
                  style={{
                    fontSize: "0.65rem",
                    color: t.colors.textMuted,
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    fontWeight: 600,
                  }}
                >
                  {s.label}
                </div>
                <div
                  style={{
                    fontSize: "0.9rem",
                    fontWeight: 700,
                    marginTop: 3,
                    lineHeight: 1.35,
                    color:
                      s.tone === "success" ? t.colors.success : s.tone === "danger" ? t.colors.danger : t.colors.text,
                  }}
                >
                  {s.value}
                </div>
              </div>
            ))}
          </div>

          <div
            style={{
              flex: "1 1 640px",
              minWidth: 360,
              padding: t.spacing(2.5),
              backgroundColor: t.colors.background,
              borderRadius: t.radius.md,
              border: `1px solid ${t.colors.border}`,
            }}
          >
            <ResponsiveContainer width="100%" height={400}>
              <ComposedChart data={chartData} margin={{ top: 16, right: 20, bottom: 28, left: 4 }}>
                <defs>
                  <linearGradient id="payoffStrategyFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={primaryColor} stopOpacity={0.22} />
                    <stop offset="100%" stopColor={primaryColor} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke={t.colors.border} strokeDasharray="4 4" vertical={false} />
                <XAxis
                  dataKey="returnPct"
                  tickFormatter={(v: number) => `${v}%`}
                  stroke={t.colors.textMuted}
                  tick={{ fontSize: 11, fill: t.colors.textMuted }}
                  axisLine={{ stroke: t.colors.border }}
                  tickLine={false}
                  label={{
                    value: "Return at expiration",
                    position: "insideBottom",
                    offset: -16,
                    fontSize: 11,
                    fill: t.colors.textMuted,
                    fontWeight: 600,
                  }}
                />
                <YAxis
                  domain={yDomain}
                  tickFormatter={(v: number) => `${v}%`}
                  stroke={t.colors.textMuted}
                  tick={{ fontSize: 11, fill: t.colors.textMuted }}
                  axisLine={false}
                  tickLine={false}
                  width={44}
                  label={{
                    value: "Performance",
                    angle: -90,
                    position: "insideLeft",
                    offset: 12,
                    fontSize: 11,
                    fill: t.colors.textMuted,
                    fontWeight: 600,
                  }}
                />
                <ReferenceLine x={0} stroke={t.colors.border} strokeWidth={1.5} />
                <ReferenceLine y={0} stroke={t.colors.border} strokeWidth={1.5} />
                {Number.isFinite(floorPct) && (
                  <ReferenceLine
                    x={Math.round(floorPct!)}
                    stroke={t.colors.danger}
                    strokeDasharray="6 4"
                    strokeOpacity={0.55}
                    label={{ value: "Floor", position: "insideTopLeft", fontSize: 10, fill: t.colors.danger }}
                  />
                )}
                {Number.isFinite(capPct) && (
                  <ReferenceLine
                    x={Math.round(capPct!)}
                    stroke={t.colors.success}
                    strokeDasharray="6 4"
                    strokeOpacity={0.55}
                    label={{ value: "Cap", position: "insideTopRight", fontSize: 10, fill: t.colors.success }}
                  />
                )}
                <Tooltip content={<PayoffTooltip theme={t} />} />
                <Legend
                  wrapperStyle={{ fontSize: "0.78rem", paddingTop: 8 }}
                  iconType="plainline"
                  formatter={(value) => <span style={{ color: t.colors.textMuted }}>{value}</span>}
                />
                <Area
                  type="linear"
                  dataKey="strategyReturnPct"
                  name={`${strategyLabel} return`}
                  stroke="none"
                  fill="url(#payoffStrategyFill)"
                  isAnimationActive={false}
                />
                <Line
                  type="linear"
                  dataKey="underlyingReturnPct"
                  name="Stock return"
                  stroke={stockColor}
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
                <Line
                  type="linear"
                  dataKey="strategyReturnPct"
                  name={`${strategyLabel} return`}
                  stroke={primaryColor}
                  strokeWidth={3}
                  dot={false}
                  isAnimationActive={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div
          style={{
            marginTop: t.spacing(4),
            overflowX: "auto",
            borderRadius: t.radius.md,
            border: `1px solid ${t.colors.border}`,
          }}
        >
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.78rem", backgroundColor: t.colors.surface }}>
            <thead>
              <tr style={{ backgroundColor: t.colors.background, borderBottom: `1px solid ${t.colors.border}` }}>
                <th
                  style={{
                    textAlign: "left",
                    padding: `${t.spacing(1.25)} ${t.spacing(2)}`,
                    color: t.colors.textMuted,
                    fontWeight: 600,
                    whiteSpace: "nowrap",
                  }}
                >
                  Return at expiration
                </th>
                {tableScenarios.map((s) => (
                  <th
                    key={s.returnPct}
                    style={{
                      textAlign: "center",
                      padding: `${t.spacing(1.25)} ${t.spacing(1.5)}`,
                      color: t.colors.textMuted,
                      fontWeight: 600,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {fmtPct(s.returnPct)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <ScenarioRow label="Stock" scenarios={tableScenarios} valueKey="underlyingReturnPct" theme={t} />
              <ScenarioRow
                label={strategyLabel}
                scenarios={tableScenarios}
                valueKey="strategyReturnPct"
                theme={t}
                highlight
              />
              <tr style={{ backgroundColor: t.colors.background }}>
                <td
                  style={{
                    padding: `${t.spacing(1.25)} ${t.spacing(2)}`,
                    color: t.colors.textMuted,
                    whiteSpace: "nowrap",
                    fontWeight: 500,
                  }}
                >
                  {strategyLabel} $ ({shares > 0 ? shares.toLocaleString("en-US") : "100"} sh)
                </td>
                {tableScenarios.map((s) => {
                  const dollarPnl = (positionValue * s.strategyReturnPct) / 100;
                  return (
                    <td
                      key={s.returnPct}
                      style={{
                        textAlign: "center",
                        padding: `${t.spacing(1.25)} ${t.spacing(1.5)}`,
                        color: dollarPnl < 0 ? t.colors.danger : t.colors.textMuted,
                        fontWeight: 500,
                      }}
                    >
                      {fmtDollar(dollarPnl)}
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>
        </div>

        <p style={{ marginTop: t.spacing(3), marginBottom: 0, fontSize: "0.72rem", color: t.colors.textMuted, lineHeight: 1.5 }}>
          Illustrative at-expiration payoff only — ignores dividends, taxes, early exercise/assignment before expiry, and
          financing/borrow costs. Not investment advice.
        </p>
      </div>
    </>
  );
}

function ScenarioRow({
  label,
  scenarios,
  valueKey,
  theme: t,
  highlight = false,
}: {
  label: string;
  scenarios: PayoffScenario[];
  valueKey: "underlyingReturnPct" | "strategyReturnPct";
  theme: Theme;
  highlight?: boolean;
}) {
  return (
    <tr style={{ borderBottom: `1px solid ${t.colors.border}` }}>
      <td style={{ padding: `${t.spacing(1.25)} ${t.spacing(2)}`, color: t.colors.text, fontWeight: 600, whiteSpace: "nowrap" }}>
        {label}
      </td>
      {scenarios.map((s) => {
        const val = s[valueKey];
        const color = highlight
          ? val < 0
            ? t.colors.danger
            : t.colors.success
          : val < 0
            ? t.colors.danger
            : t.colors.text;
        return (
          <td
            key={s.returnPct}
            style={{
              textAlign: "center",
              padding: `${t.spacing(1.25)} ${t.spacing(1.5)}`,
              color,
              fontWeight: highlight ? 600 : 400,
            }}
          >
            {fmtPct(val)}
          </td>
        );
      })}
    </tr>
  );
}
