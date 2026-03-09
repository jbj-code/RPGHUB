import { useState } from "react";
import type { Theme } from "../theme";
import { getPrimaryButtonStyle, PAGE_LAYOUT } from "../theme";

type StockComparisonProps = { theme: Theme };

const TIMEFRAMES = ["1D", "1W", "1M", "3M", "6M", "1Y", "YTD"] as const;

type MockReturns = Record<(typeof TIMEFRAMES)[number], number>;

/** Mock return sets — cycle by ticker index (first ticker = row 0, second = row 1, third = row 2, fourth = row 0, …). */
const MOCK_RETURNS: MockReturns[] = [
  { "1D": 0.52, "1W": 1.24, "1M": 2.18, "3M": 4.62, "6M": 7.41, "1Y": 12.35, YTD: 10.12 },
  { "1D": -0.31, "1W": 0.78, "1M": -0.54, "3M": 2.08, "6M": 4.92, "1Y": 8.66, YTD: 6.22 },
  { "1D": 1.08, "1W": 2.44, "1M": 3.92, "3M": 6.18, "6M": 9.34, "1Y": 15.21, YTD: 11.08 },
];

type Preset = { name: string; tickers: string[] };

const PRESETS: Preset[] = [
  { name: "Benchmarks", tickers: ["SPY", "QQQ", "DIA", "IWM"] },
  { name: "Tech", tickers: ["AAPL", "MSFT", "GOOGL", "AMZN", "META", "NVDA"] },
  { name: "Sector ETFs", tickers: ["XLK", "XLF", "XLE", "XLV", "XLY", "XLP"] },
  { name: "Mega cap", tickers: ["AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "META", "TSLA"] },
];

export function StockComparison({ theme: t }: StockComparisonProps) {
  const [tickers, setTickers] = useState<string[]>([]);
  const [tickerInput, setTickerInput] = useState("");
  const [lookbacks, setLookbacks] = useState<Set<string>>(new Set(TIMEFRAMES));
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dropTargetIndex, setDropTargetIndex] = useState<number | null>(null);
  const [copyJustPressed, setCopyJustPressed] = useState(false);

  const pageStyle: React.CSSProperties = {
    maxWidth: PAGE_LAYOUT.maxWidth,
    width: "100%",
    margin: "0 auto",
    fontFamily: t.typography.fontFamily,
    color: t.colors.text,
    minHeight: 400,
    display: "block",
  };

  const titleStyle: React.CSSProperties = {
    fontWeight: t.typography.headingWeight,
    fontSize: "1.5rem",
    color: t.colors.text,
    marginBottom: t.spacing(PAGE_LAYOUT.titleMarginBottom),
  };

  const descStyle: React.CSSProperties = {
    color: t.colors.textMuted,
    fontSize: t.typography.baseFontSize,
    lineHeight: 1.5,
    marginBottom: t.spacing(PAGE_LAYOUT.descMarginBottom),
  };

  const cardStyle: React.CSSProperties = {
    backgroundColor: t.colors.surface,
    borderRadius: t.radius.lg,
    padding: `${t.spacing(3)} ${t.spacing(5)} ${t.spacing(5)}`,
    marginBottom: t.spacing(4),
    boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
    border: `1px solid ${t.colors.border}`,
  };

  /* Card header: matches Options Optimizer (secondary color, small caps) */
  const cardTitleStyle: React.CSSProperties = {
    fontSize: "0.75rem",
    color: t.colors.secondary,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    marginBottom: t.spacing(3),
  };

  const cardTitleStyleNoMargin: React.CSSProperties = {
    ...cardTitleStyle,
    marginBottom: 0,
  };

  const presetsCardStyle: React.CSSProperties = {
    ...cardStyle,
    padding: `${t.spacing(3)} ${t.spacing(4)}`,
    marginBottom: t.spacing(4),
    alignSelf: "flex-start",
  };

  const labelStyle: React.CSSProperties = {
    fontSize: "0.875rem",
    color: t.colors.textMuted,
    marginBottom: t.spacing(1),
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    maxWidth: 160,
    padding: `${t.spacing(2)} ${t.spacing(3)}`,
    fontSize: t.typography.baseFontSize,
    border: `1px solid ${t.colors.border}`,
    borderRadius: t.radius.md,
    backgroundColor: t.colors.surface,
    color: t.colors.text,
  };

  const buttonStyle = getPrimaryButtonStyle(t);

  const checkboxRowStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: t.spacing(1),
    cursor: "pointer",
  };

  const checkboxLabelStyle: React.CSSProperties = {
    fontSize: "0.9rem",
    color: t.colors.text,
    cursor: "pointer",
    userSelect: "none",
  };

  const checkboxInputStyle: React.CSSProperties = {
    cursor: "pointer",
  };

  const chipStyle: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: t.spacing(1),
    padding: `${t.spacing(1)} ${t.spacing(2)}`,
    fontSize: "0.875rem",
    backgroundColor: t.colors.background,
    border: `1px solid ${t.colors.border}`,
    borderRadius: t.radius.sm,
    color: t.colors.text,
  };

  const tableWrapStyle: React.CSSProperties = {
    overflowX: "auto",
    borderRadius: t.radius.md,
    border: `1px solid ${t.colors.border}`,
  };

  const tableStyle: React.CSSProperties = {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: "0.9rem",
    fontFamily: t.typography.fontFamily,
  };

  const thStyle: React.CSSProperties = {
    textAlign: "left",
    fontWeight: t.typography.headingWeight,
    padding: `${t.spacing(2)} ${t.spacing(3)}`,
    backgroundColor: t.colors.background,
    borderBottom: `1px solid ${t.colors.border}`,
    color: t.colors.textMuted,
    fontSize: "0.8rem",
  };

  const thNumStyle: React.CSSProperties = { ...thStyle, textAlign: "right" };

  const tdStyle: React.CSSProperties = {
    padding: `${t.spacing(2)} ${t.spacing(3)}`,
    borderBottom: `1px solid ${t.colors.border}`,
    color: t.colors.text,
  };

  const tdNumStyle: React.CSSProperties = {
    ...tdStyle,
    textAlign: "right" as const,
    fontVariantNumeric: "tabular-nums",
    fontWeight: 600,
  };

  function formatPct(value: number): string {
    const sign = value >= 0 ? "+" : "";
    return `${sign}${value.toFixed(2)}%`;
  }

  function addTicker() {
    const raw = tickerInput.trim().toUpperCase();
    if (!raw) return;
    const next = raw.split(/[\s,]+/).filter(Boolean);
    const combined = [...new Set([...tickers, ...next])];
    setTickers(combined);
    setTickerInput("");
  }

  function removeTicker(ticker: string) {
    setTickers((prev) => prev.filter((x) => x !== ticker));
  }

  function toggleLookback(tf: string) {
    setLookbacks((prev) => {
      const next = new Set(prev);
      if (next.has(tf)) next.delete(tf);
      else next.add(tf);
      return next;
    });
  }

  function setAllLookbacks(checked: boolean) {
    setLookbacks(checked ? new Set(TIMEFRAMES) : new Set());
  }

  function handleDragStart(index: number) {
    setDraggedIndex(index);
  }

  function handleDragOver(e: React.DragEvent, index: number) {
    e.preventDefault();
    if (draggedIndex === null) return;
    setDropTargetIndex(index);
  }

  function handleDragLeave() {
    setDropTargetIndex(null);
  }

  function handleDragEnd() {
    setDraggedIndex(null);
    setDropTargetIndex(null);
  }

  function handleDrop(e: React.DragEvent, dropIndex: number) {
    e.preventDefault();
    setDropTargetIndex(null);
    if (draggedIndex === null || draggedIndex === dropIndex) {
      setDraggedIndex(null);
      return;
    }
    const newTickers = [...tickers];
    const [removed] = newTickers.splice(draggedIndex, 1);
    newTickers.splice(dropIndex, 0, removed);
    setTickers(newTickers);
    setDraggedIndex(null);
  }

  const selectedLookbacks = TIMEFRAMES.filter((tf) => lookbacks.has(tf));
  const allSelected = lookbacks.size === TIMEFRAMES.length;
  const canReorder = tickers.length > 1;
  const canCopyTable = tickers.length > 0 && selectedLookbacks.length > 0;

  function copyTableToClipboard() {
    if (!canCopyTable) return;
    const headerRow = ["Ticker", ...selectedLookbacks].join("\t");
    const dataRows = tickers.map((ticker, i) => {
      const returns = MOCK_RETURNS[i % MOCK_RETURNS.length];
      const cells = [ticker, ...selectedLookbacks.map((tf) => formatPct(returns[tf as keyof MockReturns]))];
      return cells.join("\t");
    });
    const tsv = [headerRow, ...dataRows].join("\r\n");
    void navigator.clipboard.writeText(tsv);
    setCopyJustPressed(true);
    window.setTimeout(() => setCopyJustPressed(false), 2000);
  }

  function applyPreset(preset: Preset) {
    setTickers([...preset.tickers]);
  }

  return (
    <section
      className="stock-comparison-page"
      style={{
        ...pageStyle,
        ["--checkbox-primary" as string]: t.colors.primary,
        ["--input-border" as string]: t.colors.border,
      }}
    >
      <h2 style={titleStyle}>Stock Comparison</h2>
      <p style={descStyle}>
        Compare returns across multiple tickers. Add symbols to see returns (mock data for now). Choose which timeframes to show.
      </p>

      {/* Inputs + Presets side by side */}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 220px", gap: t.spacing(4), marginBottom: t.spacing(4) }}>
        <div className="page-card" style={cardStyle}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: t.spacing(3) }}>
            <h3 style={cardTitleStyleNoMargin}>Inputs</h3>
            {tickers.length > 0 && (
              <button
                type="button"
                onClick={() => setTickers([])}
                className="stock-comparison-clear-tickers"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: t.spacing(1.5),
                  border: "none",
                  background: "none",
                  cursor: "pointer",
                  color: t.colors.textMuted,
                  borderRadius: t.radius.sm,
                }}
                title="Clear all tickers"
                aria-label="Clear all tickers"
              >
                <span className="material-symbols-outlined" style={{ fontSize: 22 }} aria-hidden>
                  clear_all
                </span>
              </button>
            )}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: t.spacing(4) }}>
            <div>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: t.spacing(2) }}>
                <input
                  type="text"
                  placeholder="Ticker"
                  style={{ ...inputStyle, textTransform: "uppercase" }}
                  value={tickerInput}
                  onChange={(e) => setTickerInput(e.target.value.toUpperCase())}
                  onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addTicker())}
                  aria-label="Add ticker symbol"
                />
                <button type="button" style={{ ...buttonStyle, display: "inline-flex", alignItems: "center", gap: t.spacing(1.5) }} onClick={addTicker}>
                  <span className="material-symbols-outlined" style={{ fontSize: 20 }} aria-hidden>add</span>
                  Add
                </button>
              </div>
              {tickers.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: t.spacing(2), marginTop: t.spacing(2) }}>
                  {tickers.map((ticker) => (
                    <span key={ticker} style={chipStyle}>
                      {ticker}
                      <button
                        type="button"
                        onClick={() => removeTicker(ticker)}
                        style={{
                          padding: 0,
                          margin: 0,
                          border: "none",
                          background: "none",
                          cursor: "pointer",
                          color: t.colors.textMuted,
                          fontSize: "1rem",
                          lineHeight: 1,
                        }}
                        aria-label={`Remove ${ticker}`}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: t.spacing(5) }}>
              <label style={checkboxRowStyle}>
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={(e) => setAllLookbacks(e.target.checked)}
                  style={checkboxInputStyle}
                />
                <span style={checkboxLabelStyle}>All</span>
              </label>
              {TIMEFRAMES.map((tf) => (
                <label key={tf} style={checkboxRowStyle}>
                  <input
                    type="checkbox"
                    checked={lookbacks.has(tf)}
                    onChange={() => toggleLookback(tf)}
                    style={checkboxInputStyle}
                  />
                  <span style={checkboxLabelStyle}>{tf}</span>
                </label>
              ))}
            </div>
          </div>
        </div>

        <div className="page-card" style={presetsCardStyle}>
          <h3 style={{ ...cardTitleStyleNoMargin, marginBottom: t.spacing(2) }}>Presets</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: t.spacing(2) }}>
            {PRESETS.map((preset) => (
              <button
                key={preset.name}
                type="button"
                onClick={() => applyPreset(preset)}
                style={{
                  padding: `${t.spacing(1.5)} ${t.spacing(2)}`,
                  fontSize: "0.85rem",
                  color: t.colors.text,
                  backgroundColor: t.colors.background,
                  border: `1px solid ${t.colors.border}`,
                  borderRadius: t.radius.sm,
                  cursor: "pointer",
                  fontFamily: t.typography.fontFamily,
                  textAlign: "left",
                }}
              >
                {preset.name}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Performance — one row per added ticker, mock data by index */}
      <div className="page-card" style={cardStyle}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: t.spacing(3) }}>
          <h3 style={cardTitleStyle}>Performance</h3>
          {canCopyTable && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
              {copyJustPressed && (
                <span style={{ fontSize: "0.7rem", color: t.colors.primary, fontWeight: t.typography.headingWeight }}>
                  Copied
                </span>
              )}
              <button
                type="button"
                onClick={copyTableToClipboard}
                className="stock-comparison-copy-table"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: t.spacing(1.5),
                  border: "none",
                  background: "none",
                  cursor: "pointer",
                  color: t.colors.textMuted,
                  borderRadius: t.radius.sm,
                }}
                title="Copy table (Excel / Google Sheets)"
                aria-label="Copy table to clipboard"
              >
                <span className="material-symbols-outlined" style={{ fontSize: 22 }} aria-hidden>
                  content_copy
                </span>
              </button>
            </div>
          )}
        </div>
        {tickers.length === 0 ? (
          <div style={{ padding: t.spacing(6), textAlign: "center" as const, color: t.colors.textMuted, fontSize: "0.9rem", border: `1px dashed ${t.colors.border}`, borderRadius: t.radius.md, backgroundColor: t.colors.background }}>
            Add tickers above to see returns.
          </div>
        ) : selectedLookbacks.length === 0 ? (
          <div style={{ padding: t.spacing(6), textAlign: "center" as const, color: t.colors.textMuted, fontSize: "0.9rem", border: `1px dashed ${t.colors.border}`, borderRadius: t.radius.md, backgroundColor: t.colors.background }}>
            Select at least one timeframe.
          </div>
        ) : (
          <div style={tableWrapStyle}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Ticker</th>
                  {selectedLookbacks.map((tf) => (
                    <th key={tf} style={thNumStyle}>
                      {tf}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tickers.map((ticker, i) => {
                  const returns = MOCK_RETURNS[i % MOCK_RETURNS.length];
                  const isDragging = draggedIndex === i;
                  const isDropTarget = dropTargetIndex === i;
                  return (
                    <tr
                      key={ticker}
                      draggable={canReorder}
                      onDragStart={() => canReorder && handleDragStart(i)}
                      onDragOver={(e) => canReorder && handleDragOver(e, i)}
                      onDragLeave={handleDragLeave}
                      onDragEnd={handleDragEnd}
                      onDrop={(e) => canReorder && handleDrop(e, i)}
                      style={{
                        cursor: canReorder ? "grab" : undefined,
                        opacity: isDragging ? 0.5 : 1,
                        backgroundColor: isDropTarget ? t.colors.background : undefined,
                      }}
                    >
                      <td style={{ ...tdStyle, fontWeight: t.typography.headingWeight }}>{ticker}</td>
                      {selectedLookbacks.map((tf) => {
                        const value = returns[tf as keyof MockReturns];
                        const isPos = value >= 0;
                        return (
                          <td key={tf} style={{ ...tdNumStyle, color: isPos ? t.colors.success : t.colors.danger }}>
                            {formatPct(value)}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
