import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { Theme } from "../theme";
import {
  PAGE_LAYOUT,
  getPrimaryActionButtonStyle,
  getDropdownTriggerStyle,
  getDropdownPanelStyle,
  getDropdownOptionStyle,
  THEME_DROPDOWN_OPTION_CLASS,
} from "../theme";

type GraphToolProps = { theme: Theme };

type ParsedPoint = { x: string; y: number };
type ParsedSeries = { name: string; points: ParsedPoint[] };
type ChartType = "line" | "area" | "bar";

function parsePastedData(raw: string): string[][] {
  const rows = raw
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+$/, ""))
    .filter((l) => l.length > 0);
  return rows.map((row) => row.split(/\t|,/));
}

function gridToPoints(grid: string[][], valueColIndex: number): ParsedPoint[] {
  if (grid.length < 2 || valueColIndex <= 0) return [];
  const dataRows = grid.slice(1); // skip header
  const points: ParsedPoint[] = [];
  for (const row of dataRows) {
    if (row.length <= valueColIndex) continue;
    const x = (row[0] ?? "").trim();
    const yRaw = (row[valueColIndex] ?? "").replace(/[%,$]/g, "").trim();
    const y = Number(yRaw);
    if (!x || !Number.isFinite(y)) continue;
    points.push({ x, y });
  }
  return points;
}

export function GraphTool({ theme: t }: GraphToolProps) {
  const [grid, setGrid] = useState<string[][]>([
    ["Date", "Value"],
    ["2025-01-01", "100"],
    ["2025-02-01", "110"],
    ["2025-03-01", "108"],
  ]);
  const [chartType, setChartType] = useState<ChartType>("line");
  const [chartSeries, setChartSeries] = useState<ParsedSeries[]>([]);
  const [chartTypeApplied, setChartTypeApplied] = useState<ChartType>("line");
  const [chartError, setChartError] = useState<string | null>(null);
  const [chartDropdownOpen, setChartDropdownOpen] = useState(false);
  const [showPoints, setShowPoints] = useState(true);
  const [showGridlines, setShowGridlines] = useState(true);
  const [yMinOverride, setYMinOverride] = useState<string>("");
  const [yMaxOverride, setYMaxOverride] = useState<string>("");
  const [xLabelStep, setXLabelStep] = useState<number>(1);
  const [chartTitle, setChartTitle] = useState<string>("");
  const svgRef = useRef<SVGSVGElement | null>(null);

  const [yTickFormat, setYTickFormat] = useState<"number" | "percent" | "currency">("number");
  const [currencyCode, setCurrencyCode] = useState<string>("USD");

  const [legendColorMode, setLegendColorMode] = useState<"palette" | "custom">("palette");
  const [legendPalette, setLegendPalette] = useState<"teal" | "blue" | "warm" | "mono">("teal");
  const [customLegendColors, setCustomLegendColors] = useState<string[]>([]);

  const [yTickDropdownOpen, setYTickDropdownOpen] = useState(false);
  const [legendColorModeDropdownOpen, setLegendColorModeDropdownOpen] = useState(false);
  const [legendPaletteDropdownOpen, setLegendPaletteDropdownOpen] = useState(false);

  const [lineStrokeWidth, setLineStrokeWidth] = useState<number>(2);
  const [pointRadius, setPointRadius] = useState<number>(4);
  const [barWidth, setBarWidth] = useState<number>(20);

  const seriesPaletteSets: Record<typeof legendPalette, readonly string[]> = {
    teal: ["#14b8a6", "#6366f1", "#ec4899", "#f97316", "#22c55e", "#eab308"],
    blue: ["#2563eb", "#06b6d4", "#4f46e5", "#22c55e", "#f97316", "#ec4899"],
    warm: ["#f97316", "#f43f5e", "#eab308", "#22c55e", "#6366f1", "#14b8a6"],
    mono: ["#64748b", "#94a3b8", "#cbd5e1", "#475569", "#0f172a", "#334155"],
  };

  const getDefaultSeriesColor = (seriesIdx: number) => {
    const palette = seriesPaletteSets[legendPalette] ?? seriesPaletteSets.teal;
    return palette[seriesIdx % palette.length] ?? t.colors.primary;
  };

  const getSeriesColor = (seriesIdx: number) => {
    if (legendColorMode === "custom") {
      return customLegendColors[seriesIdx] ?? getDefaultSeriesColor(seriesIdx);
    }
    return getDefaultSeriesColor(seriesIdx);
  };

  useEffect(() => {
    if (legendColorMode !== "custom") return;
    const seriesCount = chartSeries.length;
    if (seriesCount <= 0) return;

    setCustomLegendColors((prev) => {
      const next = [...prev];
      for (let i = 0; i < seriesCount; i++) {
        if (!next[i]) next[i] = getDefaultSeriesColor(i);
      }
      return next.slice(0, Math.max(prev.length, seriesCount));
    });
  }, [legendColorMode, chartSeries.length, legendPalette]);

  const formatYAxisValue = (value: number) => {
    if (!Number.isFinite(value)) return "";
    switch (yTickFormat) {
      case "percent":
        return `${value.toFixed(1)}%`;
      case "currency":
        try {
          const code = (currencyCode || "USD").trim().toUpperCase();
          return new Intl.NumberFormat(undefined, {
            style: "currency",
            currency: code,
            maximumFractionDigits: 1,
          }).format(value);
        } catch {
          const code = (currencyCode || "USD").trim().toUpperCase();
          return `${code} ${value.toFixed(1)}`;
        }
      case "number":
      default:
        return value.toFixed(1);
    }
  };

  const { series, parseError } = useMemo(() => {
    if (!grid || grid.length === 0) {
      return { series: [] as ParsedSeries[], parseError: null as string | null };
    }

    if (grid.length < 2 || grid[0].length < 2) {
      return {
        series: [] as ParsedSeries[],
        parseError:
          "Add at least one numeric column (besides the first label column) with a header row and values.",
      };
    }

    const header = grid[0];
    const parsedSeries: ParsedSeries[] = [];

    for (let col = 1; col < header.length; col++) {
      const name = header[col] || `Series ${col}`;
      const points = gridToPoints(grid, col);
      if (points.length > 0) {
        parsedSeries.push({ name, points });
      }
    }

    if (parsedSeries.length === 0) {
      return {
        series: [] as ParsedSeries[],
        parseError:
          "Could not find any numeric columns. Make sure at least one value column has numbers (%, $ and commas are okay).",
      };
    }

    return { series: parsedSeries, parseError: null as string | null };
  }, [grid]);

  const activeSeries = chartSeries.length > 0 ? chartSeries : [];
  const allPoints = activeSeries.flatMap((s) => s.points);
  const values = allPoints.map((p) => p.y);
  const autoMin = values.length ? Math.min(...values) : 0;
  const autoMax = values.length ? Math.max(...values) : 0;
  const yPadding = values.length ? (autoMax - autoMin || Math.abs(autoMax) || 1) * 0.1 : 1;
  const computedMin = autoMin - yPadding;
  const computedMax = autoMax + yPadding;

  const overrideMin = yMinOverride.trim() === "" ? null : Number(yMinOverride);
  const overrideMax = yMaxOverride.trim() === "" ? null : Number(yMaxOverride);

  const chartMin =
    overrideMin != null && Number.isFinite(overrideMin) ? overrideMin : computedMin;
  const chartMax =
    overrideMax != null && Number.isFinite(overrideMax) ? overrideMax : computedMax;

  const primaryBtn = getPrimaryActionButtonStyle(t);

  const pageStyle: CSSProperties = {
    maxWidth: PAGE_LAYOUT.maxWidth,
    width: "100%",
    margin: "0 auto",
    fontFamily: t.typography.fontFamily,
    color: t.colors.text,
    minHeight: 400,
  };

  const titleStyle: CSSProperties = {
    fontWeight: t.typography.headingWeight,
    fontSize: "1.5rem",
    color: t.colors.text,
    marginBottom: t.spacing(PAGE_LAYOUT.titleMarginBottom),
  };

  const descStyle: CSSProperties = {
    color: t.colors.textMuted,
    fontSize: t.typography.baseFontSize,
    lineHeight: 1.5,
    marginBottom: t.spacing(PAGE_LAYOUT.descMarginBottom),
  };

  const cardStyle: CSSProperties = {
    backgroundColor: t.colors.surface,
    borderRadius: t.radius.lg,
    padding: t.spacing(4),
    marginBottom: t.spacing(4),
    boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
    border: `1px solid ${t.colors.border}`,
  };

  const sectionTitleStyle: CSSProperties = {
    fontSize: "0.75rem",
    color: t.colors.secondary,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    marginBottom: t.spacing(3),
  };

  const inputStyle: CSSProperties = {
    width: "100%",
    fontSize: t.typography.baseFontSize,
    borderRadius: t.radius.md,
    border: `1px solid ${t.colors.border}`,
    backgroundColor: t.colors.surface,
    color: t.colors.text,
    fontFamily: "monospace",
    padding: `${t.spacing(1.5)} ${t.spacing(2)}`,
  };

  const hasData = allPoints.length > 1;

  const handleCreateChart = () => {
    if (parseError) {
      setChartError(parseError);
      return;
    }
    const totalPoints = series.reduce((acc, s) => acc + s.points.length, 0);
    if (totalPoints < 2) {
      setChartError("Add at least two data rows with numeric values before creating a chart.");
      return;
    }
    setChartSeries(series);
    setChartTypeApplied(chartType);
    setChartError(null);
  };

  const handleCopyImage = async () => {
    try {
      const svgEl = svgRef.current;
      if (!svgEl) return;

      const serializer = new XMLSerializer();
      const svgString = serializer.serializeToString(svgEl);
      const svgBlob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
      const svgUrl = URL.createObjectURL(svgBlob);

      const img = new Image();
      img.src = svgUrl;

      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = (e) => reject(e);
      });

      const width = svgEl.viewBox.baseVal.width || 600;
      const height = svgEl.viewBox.baseVal.height || 260;

      const canvas = document.createElement("canvas");
      canvas.width = width * 2;
      canvas.height = height * 2;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      URL.revokeObjectURL(svgUrl);

      const blob: Blob | null = await new Promise((resolve) =>
        canvas.toBlob((b) => resolve(b), "image/png")
      );
      if (!blob) return;

      // Prefer modern async clipboard with image support
      if ((navigator as any).clipboard && (window as any).ClipboardItem) {
        const ClipboardItemCtor = (window as any).ClipboardItem;
        const item = new ClipboardItemCtor({ "image/png": blob });
        await (navigator as any).clipboard.write([item]);
      } else if ((navigator as any).clipboard && (navigator as any).clipboard.writeImage) {
        // Some environments expose writeImage directly
        await (navigator as any).clipboard.writeImage(blob);
      } else {
        // Fallback: open image in new tab for manual save
        const pngUrl = URL.createObjectURL(blob);
        window.open(pngUrl, "_blank", "noopener,noreferrer");
      }
    } catch {
      // Silent failure; future: surface a toast if you add a toast system
    }
  };

  return (
    <section className="graph-tool-page" style={pageStyle}>
      <h2 style={titleStyle}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: t.spacing(2) }}>
          <span
            className="material-symbols-outlined"
            style={{ fontSize: "1.5rem", color: t.colors.secondary, lineHeight: 1, display: "inline-flex" }}
            aria-hidden
          >
            show_chart
          </span>
          Graph Tool
        </span>
      </h2>
      <p style={descStyle}>
        Turn a small table into a premium, client‑ready chart. Use a header row, then at least two
        columns: label and numeric value.
      </p>

      {/* Chart first */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr)",
          gap: t.spacing(4),
          alignItems: "flex-start",
          marginBottom: t.spacing(4),
          // Leave room for the fixed right-side styling menu
          paddingRight: 320,
        }}
      >
          {/* Chart canvas and live preview (left) */}
          <div
            style={{
              ...cardStyle,
              marginBottom: 0,
            }}
          >
            <h3 style={sectionTitleStyle}>Chart</h3>
            {chartError && (
              <p
                style={{
                  marginTop: 0,
                  marginBottom: t.spacing(2),
                  fontSize: "0.85rem",
                  color: t.colors.danger,
                }}
              >
                {chartError}
              </p>
            )}
            {!hasData ? (
              <p
                style={{
                  padding: t.spacing(6),
                  textAlign: "center",
                  color: t.colors.textMuted,
                  fontSize: "0.9rem",
                  borderRadius: t.radius.md,
                  border: `1px dashed ${t.colors.border}`,
                  backgroundColor: t.colors.background,
                }}
              >
                Paste data below and click “Create chart” to see a live preview.
              </p>
            ) : (
              <div>
                <div
                  style={{
                    marginBottom: t.spacing(3),
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: t.spacing(2),
                  }}
                >
                  <span style={{ fontSize: "0.9rem", color: t.colors.textMuted }}>
                    {allPoints.length === 0
                      ? "No chart yet"
                      : `${allPoints.length} points · ${chartTypeApplied
                          .charAt(0)
                          .toUpperCase()}${chartTypeApplied.slice(1)} chart`}
                  </span>
                  <button
                    type="button"
                    onClick={handleCopyImage}
                    style={{
                      ...primaryBtn,
                      padding: `${t.spacing(1.5)} ${t.spacing(3)}`,
                      fontSize: "0.85rem",
                    }}
                  >
                    Copy image
                  </button>
                </div>
                <div
                  style={{
                    borderRadius: t.radius.lg,
                    border: `1px solid ${t.colors.border}`,
                    backgroundColor: "#ffffff",
                    padding: t.spacing(3),
                  }}
                >
                  <svg
                    ref={svgRef}
                    viewBox="0 0 600 320"
                    style={{ width: "100%", height: 300, fontFamily: t.typography.fontFamily }}
                  >
                    {/* Title */}
                    {chartTitle.trim() !== "" && (
                      <text
                        x={300}
                        y={22}
                        textAnchor="middle"
                        fontSize="14"
                        fill={t.colors.text}
                        fontFamily={t.typography.fontFamily}
                        fontWeight="600"
                      >
                        {chartTitle.trim()}
                      </text>
                    )}
                    {/* Axes */}
                    <line
                      x1={60}
                      y1={210}
                      x2={560}
                      y2={210}
                      stroke={t.colors.border}
                      strokeWidth={1}
                    />
                    <line
                      x1={60}
                      y1={40}
                      x2={60}
                      y2={210}
                      stroke={t.colors.border}
                      strokeWidth={1}
                    />
                    {/* Y ticks */}
                    {showGridlines &&
                      Array.from({ length: 4 }).map((_, i) => {
                        const ratio = i / 3;
                        const value = chartMax - (chartMax - chartMin) * ratio;
                        const y = 40 + (210 - 40) * ratio;
                        return (
                          <g key={i}>
                            <line
                              x1={55}
                              y1={y}
                              x2={560}
                              y2={y}
                              stroke={t.colors.border}
                              strokeWidth={0.5}
                              strokeDasharray="4 4"
                            />
                            <text
                              x={52}
                              y={y + 4}
                              textAnchor="end"
                              fontSize="10"
                              fill={t.colors.textMuted}
                              fontFamily={t.typography.fontFamily}
                            >
                              {formatYAxisValue(value)}
                            </text>
                          </g>
                        );
                      })}
                    {/* Line / area / bar series */}
                    {activeSeries.length > 0 && (
                      <>
                        {/* For line/area charts, draw one series per numeric column */}
                        {chartTypeApplied !== "bar" &&
                          activeSeries.map((s, seriesIdx) => {
                            const strokeColor = getSeriesColor(seriesIdx);

                            return (
                              <polyline
                                key={s.name}
                                fill={
                                  chartTypeApplied === "area"
                                    ? `${strokeColor}33`
                                    : "none"
                                }
                                stroke={strokeColor}
                                strokeWidth={lineStrokeWidth}
                                strokeLinejoin="round"
                                strokeLinecap="round"
                                points={s.points
                                  .map((p, idx) => {
                                    const x =
                                      60 +
                                      ((560 - 60) *
                                        (s.points.length === 1
                                          ? 0.5
                                          : idx / (s.points.length - 1)));
                                    const norm =
                                      (p.y - chartMin) / (chartMax - chartMin || 1);
                                    const y = 210 - (210 - 40) * norm;
                                    return `${x},${y}`;
                                  })
                                  .join(" ")}
                              />
                            );
                          })}

                        {/* Points or bars (use first series for bars to keep layout simple) */}
                        {activeSeries.map((s, seriesIdx) => {
                          const strokeColor = getSeriesColor(seriesIdx);

                          return s.points.map((p, idx) => {
                            const x =
                              60 +
                              ((560 - 60) *
                                (s.points.length === 1
                                  ? 0.5
                                  : idx / (s.points.length - 1)));
                            const norm =
                              (p.y - chartMin) / (chartMax - chartMin || 1);
                            const y = 210 - (210 - 40) * norm;

                            if (chartTypeApplied === "bar") {
                              // Only render bars for the first series to avoid stacked math
                              if (seriesIdx > 0) return null;
                              return (
                                <rect
                                  key={`${s.name}-${p.x}-${idx}`}
                                      x={x - barWidth / 2}
                                  y={y}
                                      width={barWidth}
                                  height={210 - y}
                                  fill={`${strokeColor}B3`}
                                />
                              );
                            }

                            if (!showPoints) return null;

                            return (
                              <circle
                                key={`${s.name}-${p.x}-${idx}`}
                                cx={x}
                                cy={y}
                                r={pointRadius}
                                fill={t.colors.surface}
                                stroke={strokeColor}
                                strokeWidth={lineStrokeWidth}
                              />
                            );
                          });
                        })}
                      </>
                    )}
                    {/* X labels (from first active series, with spacing) */}
                    {activeSeries[0]?.points.map((p, idx) => {
                      if (idx % xLabelStep !== 0) return null;
                      const pointsForX = activeSeries[0].points;
                      const x =
                        60 +
                        ((560 - 60) *
                          (pointsForX.length === 1 ? 0.5 : idx / (pointsForX.length - 1)));
                      return (
                        <text
                          key={p.x + idx}
                          x={x}
                          y={238}
                          textAnchor="middle"
                          fontSize="10"
                          fill={t.colors.textMuted}
                          fontFamily={t.typography.fontFamily}
                        >
                          {p.x}
                        </text>
                      );
                    })}

                    {/* Legend (inside SVG so copy includes it) */}
                    {activeSeries.length > 0 && (
                      <g>
                        {activeSeries.map((s, seriesIdx) => {
                          const itemsPerRow = 3;
                          const legendItemWidth = 170;
                          const legendStartX = 60;
                          const legendStartY = 260;
                          const itemX =
                            legendStartX + (seriesIdx % itemsPerRow) * legendItemWidth;
                          const itemY =
                            legendStartY + Math.floor(seriesIdx / itemsPerRow) * 18;
                          const strokeColor = getSeriesColor(seriesIdx);

                          return (
                            <g key={s.name}>
                              <circle
                                cx={itemX}
                                cy={itemY}
                                r={Math.max(2, pointRadius)}
                                fill={strokeColor}
                              />
                              <text
                                x={itemX + 10}
                                y={itemY + 4}
                                fontSize="10"
                                fill={t.colors.textMuted}
                                fontFamily={t.typography.fontFamily}
                              >
                                {s.name}
                              </text>
                            </g>
                          );
                        })}
                      </g>
                    )}
                  </svg>
                </div>
              </div>
            )}
          </div>

          {/* Chart styling + options (right) */}
          <div
            style={{
              backgroundColor: t.colors.surface,
              border: "none",
              borderRadius: 0,
              boxShadow: "none",
              padding: 0,
              marginBottom: 0,
              display: "flex",
              flexDirection: "column",
              gap: 0,
              position: "fixed",
              right: 16,
              top: 0,
              bottom: 0,
              overflowY: "hidden",
              overflowX: "hidden",
              width: 320,
              borderLeft: `1px solid ${t.colors.border}`,
              zIndex: 30,
            }}
          >
            <div
              style={{
                padding: t.spacing(4),
                paddingBottom: t.spacing(2),
                borderBottom: `1px solid ${t.colors.border}`,
                boxSizing: "border-box",
                flexShrink: 0,
              }}
            >
              <h3 style={{ ...sectionTitleStyle, marginBottom: 0 }}>Styling</h3>
            </div>

            <div
              style={{
                flex: 1,
                overflowY: "auto",
                overflowX: "hidden",
                padding: t.spacing(4),
                paddingTop: t.spacing(2),
                boxSizing: "border-box",
                display: "flex",
                flexDirection: "column",
                gap: t.spacing(2),
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: t.spacing(1) }}>
                <div
                  style={{
                    fontSize: "0.75rem",
                    color: t.colors.secondary,
                    textTransform: "uppercase",
                    letterSpacing: "0.04em",
                    fontWeight: 600,
                    marginBottom: t.spacing(1),
                  }}
                >
                  Chart
                </div>
                <span style={{ fontSize: "0.85rem", color: t.colors.textMuted }}>Type</span>
              <div style={{ position: "relative", minWidth: 140 }}>
                <button
                  type="button"
                  onClick={() => setChartDropdownOpen((o) => !o)}
                  style={{
                    ...getDropdownTriggerStyle(t),
                    minWidth: 140,
                    margin: 0,
                  }}
                  aria-haspopup="listbox"
                  aria-expanded={chartDropdownOpen}
                >
                  <span
                    style={{
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      flex: 1,
                      textAlign: "left",
                    }}
                  >
                    {chartType === "line"
                      ? "Line"
                      : chartType === "area"
                        ? "Area"
                        : "Bar"}
                  </span>
                  <span
                    className="material-symbols-outlined"
                    style={{ fontSize: 18, flexShrink: 0 }}
                  >
                    expand_more
                  </span>
                </button>
                {chartDropdownOpen && (
                  <>
                    <div
                      role="presentation"
                      style={{ position: "fixed", inset: 0, zIndex: 98 }}
                      onClick={() => setChartDropdownOpen(false)}
                    />
                    <div
                      style={{
                        ...getDropdownPanelStyle(t, "down"),
                        zIndex: 101,
                        minWidth: "100%",
                        width: "100%",
                        maxWidth: "100%",
                      }}
                    >
                      {[
                        { value: "line", label: "Line" },
                        { value: "area", label: "Area" },
                        { value: "bar", label: "Bar" },
                      ].map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          className={THEME_DROPDOWN_OPTION_CLASS}
                          onClick={() => {
                            setChartType(opt.value as ChartType);
                            setChartDropdownOpen(false);
                          }}
                          style={getDropdownOptionStyle(t, chartType === opt.value)}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </div>

            <div style={{ display: "flex", gap: t.spacing(2), fontSize: "0.8rem" }}>
              <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <input
                  type="checkbox"
                  checked={showPoints}
                  onChange={(e) => setShowPoints(e.target.checked)}
                />
                <span>Show points</span>
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <input
                  type="checkbox"
                  checked={showGridlines}
                  onChange={(e) => setShowGridlines(e.target.checked)}
                />
                <span>Gridlines</span>
              </label>
            </div>

            <div
              style={{
                fontSize: "0.75rem",
                color: t.colors.secondary,
                textTransform: "uppercase",
                letterSpacing: "0.04em",
                fontWeight: 600,
                marginTop: t.spacing(1),
                marginBottom: t.spacing(1),
              }}
            >
              Y Axis
            </div>

            <div style={{ display: "flex", gap: t.spacing(2), fontSize: "0.8rem" }}>
              <div style={{ flex: 1 }}>
                <div style={{ color: t.colors.textMuted, marginBottom: 4 }}>Y min</div>
                <input
                  type="text"
                  value={yMinOverride}
                  onChange={(e) => setYMinOverride(e.target.value)}
                  style={{ ...inputStyle, paddingTop: t.spacing(1), paddingBottom: t.spacing(1) }}
                  placeholder="Auto"
                />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ color: t.colors.textMuted, marginBottom: 4 }}>Y max</div>
                <input
                  type="text"
                  value={yMaxOverride}
                  onChange={(e) => setYMaxOverride(e.target.value)}
                  style={{ ...inputStyle, paddingTop: t.spacing(1), paddingBottom: t.spacing(1) }}
                  placeholder="Auto"
                />
              </div>
            </div>

            <div style={{ display: "flex", gap: t.spacing(2), fontSize: "0.8rem" }}>
              <div style={{ flex: 1 }}>
                <div style={{ color: t.colors.textMuted, marginBottom: 4 }}>Y tick format</div>
                <div style={{ position: "relative" }}>
                  <button
                    type="button"
                    onClick={() => {
                      setLegendColorModeDropdownOpen(false);
                      setLegendPaletteDropdownOpen(false);
                      setYTickDropdownOpen((o) => !o);
                    }}
                    style={{
                      ...getDropdownTriggerStyle(t),
                      minWidth: 160,
                      margin: 0,
                    }}
                    aria-haspopup="listbox"
                    aria-expanded={yTickDropdownOpen}
                  >
                    <span
                      style={{
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        flex: 1,
                        textAlign: "left",
                      }}
                    >
                      {yTickFormat === "number"
                        ? "Number"
                        : yTickFormat === "percent"
                          ? "Percent"
                          : "Currency"}
                    </span>
                    <span
                      className="material-symbols-outlined"
                      style={{ fontSize: 18, flexShrink: 0 }}
                    >
                      expand_more
                    </span>
                  </button>
                  {yTickDropdownOpen && (
                    <>
                      <div
                        role="presentation"
                        style={{ position: "fixed", inset: 0, zIndex: 98 }}
                        onClick={() => setYTickDropdownOpen(false)}
                      />
                      <div
                        style={{
                          ...getDropdownPanelStyle(t, "down"),
                          zIndex: 101,
                          minWidth: "100%",
                          width: "100%",
                          maxWidth: "100%",
                        }}
                      >
                        {[
                          { value: "number", label: "Number" },
                          { value: "percent", label: "Percent" },
                          { value: "currency", label: "Currency" },
                        ].map((opt) => (
                          <button
                            key={opt.value}
                            type="button"
                            className={THEME_DROPDOWN_OPTION_CLASS}
                            onClick={() => {
                              setYTickFormat(opt.value as "number" | "percent" | "currency");
                              setYTickDropdownOpen(false);
                            }}
                            style={getDropdownOptionStyle(t, yTickFormat === opt.value)}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </div>
              {yTickFormat === "currency" && (
                <div style={{ flex: 1 }}>
                  <div style={{ color: t.colors.textMuted, marginBottom: 4 }}>Currency code</div>
                  <input
                    type="text"
                    value={currencyCode}
                    onChange={(e) => setCurrencyCode(e.target.value)}
                    style={{ ...inputStyle, paddingTop: t.spacing(1), paddingBottom: t.spacing(1) }}
                    placeholder="USD"
                  />
                </div>
              )}
            </div>

            <div
              style={{
                fontSize: "0.75rem",
                color: t.colors.secondary,
                textTransform: "uppercase",
                letterSpacing: "0.04em",
                fontWeight: 600,
                marginTop: t.spacing(1),
                marginBottom: t.spacing(1),
              }}
            >
              X Axis
            </div>

            <div style={{ display: "flex", gap: t.spacing(2), fontSize: "0.8rem" }}>
              <div style={{ flex: 1 }}>
                <div style={{ color: t.colors.textMuted, marginBottom: 4 }}>X label spacing</div>
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={xLabelStep}
                  onChange={(e) => {
                    const raw = Number(e.target.value);
                    if (!Number.isFinite(raw) || raw <= 0) {
                      setXLabelStep(1);
                    } else {
                      setXLabelStep(Math.floor(raw));
                    }
                  }}
                  style={{ ...inputStyle, paddingTop: t.spacing(1), paddingBottom: t.spacing(1) }}
                />
              </div>
            </div>

            <div
              style={{
                fontSize: "0.75rem",
                color: t.colors.secondary,
                textTransform: "uppercase",
                letterSpacing: "0.04em",
                fontWeight: 600,
                marginTop: t.spacing(1),
                marginBottom: t.spacing(1),
              }}
            >
              Legend & Series
            </div>

            <div style={{ display: "flex", gap: t.spacing(2), fontSize: "0.8rem" }}>
              <div style={{ flex: 1 }}>
                <div style={{ color: t.colors.textMuted, marginBottom: 4 }}>Legend color mode</div>
                <div style={{ position: "relative" }}>
                  <button
                    type="button"
                    onClick={() => {
                      setYTickDropdownOpen(false);
                      setLegendPaletteDropdownOpen(false);
                      setLegendColorModeDropdownOpen((o) => !o);
                    }}
                    style={{
                      ...getDropdownTriggerStyle(t),
                      minWidth: 160,
                      margin: 0,
                    }}
                    aria-haspopup="listbox"
                    aria-expanded={legendColorModeDropdownOpen}
                  >
                    <span
                      style={{
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        flex: 1,
                        textAlign: "left",
                      }}
                    >
                      {legendColorMode === "palette" ? "Palette" : "Custom"}
                    </span>
                    <span
                      className="material-symbols-outlined"
                      style={{ fontSize: 18, flexShrink: 0 }}
                    >
                      expand_more
                    </span>
                  </button>
                  {legendColorModeDropdownOpen && (
                    <>
                      <div
                        role="presentation"
                        style={{ position: "fixed", inset: 0, zIndex: 98 }}
                        onClick={() => setLegendColorModeDropdownOpen(false)}
                      />
                      <div
                        style={{
                          ...getDropdownPanelStyle(t, "down"),
                          zIndex: 101,
                          minWidth: "100%",
                          width: "100%",
                          maxWidth: "100%",
                        }}
                      >
                        {[
                          { value: "palette", label: "Palette" },
                          { value: "custom", label: "Custom" },
                        ].map((opt) => (
                          <button
                            key={opt.value}
                            type="button"
                            className={THEME_DROPDOWN_OPTION_CLASS}
                            onClick={() => {
                              setLegendColorMode(opt.value as "palette" | "custom");
                              setLegendColorModeDropdownOpen(false);
                            }}
                            style={getDropdownOptionStyle(t, legendColorMode === opt.value)}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </div>

              {legendColorMode === "palette" && (
                <div style={{ flex: 1 }}>
                  <div style={{ color: t.colors.textMuted, marginBottom: 4 }}>Legend palette</div>
                  <div style={{ position: "relative" }}>
                    <button
                      type="button"
                      onClick={() => {
                        setYTickDropdownOpen(false);
                        setLegendColorModeDropdownOpen(false);
                        setLegendPaletteDropdownOpen((o) => !o);
                      }}
                      style={{
                        ...getDropdownTriggerStyle(t),
                        minWidth: 160,
                        margin: 0,
                      }}
                      aria-haspopup="listbox"
                      aria-expanded={legendPaletteDropdownOpen}
                    >
                      <span
                        style={{
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          flex: 1,
                          textAlign: "left",
                        }}
                      >
                        {legendPalette === "teal"
                          ? "Teal"
                          : legendPalette === "blue"
                            ? "Blue"
                            : legendPalette === "warm"
                              ? "Warm"
                              : "Mono"}
                      </span>
                      <span
                        className="material-symbols-outlined"
                        style={{ fontSize: 18, flexShrink: 0 }}
                      >
                        expand_more
                      </span>
                    </button>
                    {legendPaletteDropdownOpen && (
                      <>
                        <div
                          role="presentation"
                          style={{ position: "fixed", inset: 0, zIndex: 98 }}
                          onClick={() => setLegendPaletteDropdownOpen(false)}
                        />
                        <div
                          style={{
                            ...getDropdownPanelStyle(t, "down"),
                            zIndex: 101,
                            minWidth: "100%",
                            width: "100%",
                            maxWidth: "100%",
                          }}
                        >
                          {[
                            { value: "teal", label: "Teal" },
                            { value: "blue", label: "Blue" },
                            { value: "warm", label: "Warm" },
                            { value: "mono", label: "Mono" },
                          ].map((opt) => (
                            <button
                              key={opt.value}
                              type="button"
                              className={THEME_DROPDOWN_OPTION_CLASS}
                              onClick={() => {
                                setLegendPalette(opt.value as "teal" | "blue" | "warm" | "mono");
                                setLegendPaletteDropdownOpen(false);
                              }}
                              style={getDropdownOptionStyle(t, legendPalette === opt.value)}
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>

            {legendColorMode === "custom" && activeSeries.length > 0 && (
              <div style={{ marginTop: t.spacing(2) }}>
                <div style={{ color: t.colors.textMuted, marginBottom: t.spacing(1), fontSize: "0.8rem" }}>
                  Custom colors (each series)
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: t.spacing(2) }}>
                  {activeSeries.map((s, seriesIdx) => {
                    const colorValue = customLegendColors[seriesIdx] ?? getDefaultSeriesColor(seriesIdx);
                    return (
                      <label
                        key={s.name}
                        style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "0.8rem" }}
                      >
                        <input
                          type="color"
                          value={colorValue}
                          onChange={(e) => {
                            const next = [...customLegendColors];
                            next[seriesIdx] = e.target.value;
                            setCustomLegendColors(next);
                          }}
                          style={{ width: 26, height: 26, padding: 0, borderRadius: 6, border: "none" }}
                        />
                        <span style={{ color: t.colors.textMuted, maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {s.name}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

            <div
              style={{
                fontSize: "0.75rem",
                color: t.colors.secondary,
                textTransform: "uppercase",
                letterSpacing: "0.04em",
                fontWeight: 600,
                marginTop: t.spacing(1),
                marginBottom: t.spacing(1),
              }}
            >
              Appearance
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: t.spacing(2) }}>
              <div style={{ display: "flex", gap: t.spacing(2), fontSize: "0.8rem" }}>
                <div style={{ flex: 1 }}>
                  <div style={{ color: t.colors.textMuted, marginBottom: 4 }}>Line width</div>
                  <input
                    type="range"
                    min={1}
                    max={6}
                    step={1}
                    value={lineStrokeWidth}
                    onChange={(e) => setLineStrokeWidth(Number(e.target.value))}
                    style={{ width: "100%" }}
                  />
                </div>
              </div>

              <div style={{ display: "flex", gap: t.spacing(2), fontSize: "0.8rem" }}>
                <div style={{ flex: 1 }}>
                  <div style={{ color: t.colors.textMuted, marginBottom: 4 }}>Point size</div>
                  <input
                    type="range"
                    min={2}
                    max={8}
                    step={1}
                    value={pointRadius}
                    onChange={(e) => setPointRadius(Number(e.target.value))}
                    style={{ width: "100%" }}
                  />
                </div>
              </div>

              <div style={{ display: "flex", gap: t.spacing(2), fontSize: "0.8rem" }}>
                <div style={{ flex: 1 }}>
                  <div style={{ color: t.colors.textMuted, marginBottom: 4 }}>Bar width</div>
                  <input
                    type="range"
                    min={10}
                    max={30}
                    step={1}
                    value={barWidth}
                    onChange={(e) => setBarWidth(Number(e.target.value))}
                    style={{ width: "100%" }}
                  />
                </div>
              </div>
            </div>

            <div style={{ display: "flex", gap: t.spacing(2), fontSize: "0.8rem" }}>
              <div style={{ flex: 1 }}>
                <div style={{ color: t.colors.textMuted, marginBottom: 4 }}>Chart title</div>
                <input
                  type="text"
                  value={chartTitle}
                  onChange={(e) => setChartTitle(e.target.value)}
                  style={{ ...inputStyle, paddingTop: t.spacing(1), paddingBottom: t.spacing(1) }}
                  placeholder="Optional"
                />
              </div>
            </div>

            </div>

            <div
              style={{
                padding: t.spacing(4),
                borderTop: `1px solid ${t.colors.border}`,
                backgroundColor: t.colors.surface,
                boxSizing: "border-box",
                flexShrink: 0,
              }}
            >
              <button
                type="button"
                onClick={handleCreateChart}
                style={{
                  ...primaryBtn,
                  fontSize: "0.85rem",
                  width: "100%",
                }}
              >
                Create chart
              </button>
            </div>
          </div>

      {/* Data grid below */}
      <div style={cardStyle}>
        <h3 style={sectionTitleStyle}>Data</h3>
        <p
          style={{
            marginTop: 0,
            marginBottom: t.spacing(2),
            fontSize: "0.85rem",
            color: t.colors.textMuted,
          }}
        >
          Edit cells directly or paste from Excel / Sheets. First row is treated as a header.
        </p>
        <div
          style={{
            overflowX: "auto",
            borderRadius: t.radius.md,
            border: `1px solid ${t.colors.border}`,
            backgroundColor: t.colors.surface,
          }}
        >
          <table
            style={{
              borderCollapse: "collapse",
              width: "100%",
              minWidth: 360,
              fontSize: t.typography.baseFontSize,
              fontFamily: "monospace",
            }}
          >
            <tbody>
              {grid.map((row, rIdx) => (
                <tr key={rIdx}>
                  {row.map((cell, cIdx) => (
                    <td
                      key={cIdx}
                      style={{
                        borderBottom: `1px solid ${t.colors.border}`,
                        borderRight: `1px solid ${t.colors.border}`,
                        padding: 0,
                      }}
                    >
                      <input
                        value={cell}
                        onChange={(e) => {
                          const next = grid.map((r) => [...r]);
                          next[rIdx][cIdx] = e.target.value;
                          setGrid(next);
                        }}
                        onPaste={
                          rIdx === 0 && cIdx === 0
                            ? (e) => {
                                const text = e.clipboardData.getData("text");
                                if (!text) return;
                                e.preventDefault();
                                const parsed = parsePastedData(text);
                                if (parsed.length > 0) {
                                  setGrid(parsed);
                                }
                              }
                            : undefined
                        }
                        style={{
                          ...inputStyle,
                          borderRadius: 0,
                          border: "none",
                          width: "100%",
                          boxSizing: "border-box",
                        }}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        {parseError && (
          <p
            style={{
              marginTop: t.spacing(2),
              fontSize: "0.85rem",
              color: t.colors.danger,
            }}
          >
            {parseError}
          </p>
        )}
      </div>
      </div>
    </section>
  );
}

