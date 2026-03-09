import { useEffect, useState } from "react";
import type { Theme } from "../theme";
import { getPrimaryButtonStyle, PAGE_LAYOUT } from "../theme";

type StockComparisonProps = { theme: Theme };

const TIMEFRAMES = ["1D", "1W", "1M", "3M", "6M", "1Y", "YTD"] as const;

type Returns = Record<(typeof TIMEFRAMES)[number], number>;

// API base for Schwab proxy (quotes/returns). Set VITE_SCHWAB_API_BASE in .env or Vercel to override.
const SCHWAB_API_BASE =
  (import.meta.env.VITE_SCHWAB_API_BASE as string) ||
  "https://rpghub-two.vercel.app";

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
  const [returnsMap, setReturnsMap] = useState<Record<string, Returns>>({});
  const [loading, setLoading] = useState(false);
  const [loadingTickers, setLoadingTickers] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [apiHint, setApiHint] = useState<string | null>(null); // server hint when no data (e.g. token expired)
  const [fetchKey, setFetchKey] = useState(0); // bump to force re-fetch (Refresh)

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

  useEffect(() => {
    if (tickers.length === 0) {
      setReturnsMap({});
      setLoadingTickers(new Set());
      setError(null);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    // Only show "Loading from Schwab…" for tickers we don't have data for yet (e.g. newly added).
    setLoadingTickers(new Set(tickers.filter((t) => !returnsMap[t])));
    setLoading(true);
    setError(null);
    setApiHint(null);

    async function loadReturns() {
      try {
        const symbolsParam = encodeURIComponent(tickers.join(","));
        const res = await fetch(
          `${SCHWAB_API_BASE}/api/schwab-returns?symbols=${symbolsParam}`,
          { signal: controller.signal }
        );
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error((body as { error?: string }).error || `Request failed with ${res.status}`);
        }
        const data = (await res.json()) as Record<string, Returns | string>;
        // Normalize keys to uppercase; skip _hint and non-object values
        const normalized: Record<string, Returns> = {};
        for (const [k, v] of Object.entries(data)) {
          if (k === "_hint" && typeof v === "string") {
            setApiHint(v);
            continue;
          }
          if (v && typeof v === "object") normalized[k.trim().toUpperCase()] = v as Returns;
        }
        if (Object.keys(normalized).length > 0) setApiHint(null);
        setReturnsMap((prev) => ({ ...prev, ...normalized }));
      } catch (e: unknown) {
        if (e instanceof Error && e.name === "AbortError") return;
        setError(e instanceof Error ? e.message : "Failed to load returns from Schwab");
        // Keep existing returnsMap on error so we don't wipe partial data
      } finally {
        setLoading(false);
        setLoadingTickers(new Set());
      }
    }

    void loadReturns();

    return () => controller.abort();
  }, [tickers, fetchKey]);

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
  const hasAnyReturns = tickers.some((t) => returnsMap[t]);
  const canCopyTable = tickers.length > 0 && selectedLookbacks.length > 0;

  function copyTableToClipboard() {
    if (!canCopyTable) return;
    const headerRow = ["Ticker", ...selectedLookbacks].join("\t");
    const dataRows = tickers.map((ticker) => {
      const returns = returnsMap[ticker];
      const cells = [
        ticker,
        ...selectedLookbacks.map((tf) => {
          const v = returns?.[tf];
          return v != null ? formatPct(v) : "—";
        }),
      ];
      return cells.join("\t");
    });
    const tsv = [headerRow, ...dataRows].join("\r\n");
    void navigator.clipboard.writeText(tsv);
    setCopyJustPressed(true);
    window.setTimeout(() => setCopyJustPressed(false), 2000);
  }

  function refreshReturns() {
    setFetchKey((k) => k + 1);
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
        Compare returns across multiple tickers using live Schwab market data. Add symbols to see returns and choose which timeframes to show.
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

      {/* Performance — live returns from Schwab */}
      <div className="page-card" style={cardStyle}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: t.spacing(3) }}>
          <h3 style={cardTitleStyle}>Performance</h3>
          <div style={{ display: "flex", alignItems: "center", gap: t.spacing(2) }}>
            {tickers.length > 0 && (
              <button
                type="button"
                onClick={refreshReturns}
                className="stock-comparison-refresh"
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
                title="Refresh returns"
                aria-label="Refresh returns from Schwab"
              >
                <span className="material-symbols-outlined" style={{ fontSize: 22 }} aria-hidden>refresh</span>
              </button>
            )}
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
        </div>
        {tickers.length === 0 ? (
          <div style={{ padding: t.spacing(6), textAlign: "center" as const, color: t.colors.textMuted, fontSize: "0.9rem", border: `1px dashed ${t.colors.border}`, borderRadius: t.radius.md, backgroundColor: t.colors.background }}>
            Add tickers above to see returns.
          </div>
        ) : loading && tickers.every((t) => !returnsMap[t]) ? (
          <div style={{ padding: t.spacing(6), textAlign: "center" as const, color: t.colors.textMuted, fontSize: "0.9rem", border: `1px dashed ${t.colors.border}`, borderRadius: t.radius.md, backgroundColor: t.colors.background }}>
            Loading returns from Schwab…
          </div>
        ) : error && !hasAnyReturns ? (
          <div style={{ padding: t.spacing(6), textAlign: "center" as const, color: t.colors.danger, fontSize: "0.9rem", border: `1px dashed ${t.colors.border}`, borderRadius: t.radius.md, backgroundColor: t.colors.background }}>
            {error}
          </div>
        ) : selectedLookbacks.length === 0 ? (
          <div style={{ padding: t.spacing(6), textAlign: "center" as const, color: t.colors.textMuted, fontSize: "0.9rem", border: `1px dashed ${t.colors.border}`, borderRadius: t.radius.md, backgroundColor: t.colors.background }}>
            Select at least one timeframe.
          </div>
        ) : (
          <>
            {error && hasAnyReturns && (
              <p style={{ marginBottom: t.spacing(2), fontSize: "0.875rem", color: t.colors.danger }}>
                {error} (showing partial data.)
              </p>
            )}
            {!loading && !hasAnyReturns && tickers.length > 0 && (
              <p style={{ marginBottom: t.spacing(2), fontSize: "0.875rem", color: t.colors.textMuted }}>
                {apiHint || "No return data for these symbols. This can happen when the market is closed, the Schwab token has expired, or the API returned no candles."}
                {" "}
                <a
                  href={`${SCHWAB_API_BASE}/api/schwab-auth`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: t.colors.primary, fontWeight: t.typography.headingWeight }}
                >
                  Authorize Schwab (log in to refresh token)
                </a>
              </p>
            )}
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
                  const returns = returnsMap[ticker];
                  const isLoadingRow = loadingTickers.has(ticker);
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
                      {isLoadingRow ? (
                        <td colSpan={selectedLookbacks.length} style={{ ...tdNumStyle, color: t.colors.textMuted, fontStyle: "italic" }}>
                          Loading from Schwab…
                        </td>
                      ) : (
                        selectedLookbacks.map((tf) => {
                          const value = returns != null ? (returns[tf] ?? null) : null;
                          const isPos = value !== null && value >= 0;
                          return (
                            <td key={tf} style={{ ...tdNumStyle, color: isPos ? t.colors.success : t.colors.danger }}>
                              {value === null ? "—" : formatPct(value)}
                            </td>
                          );
                        })
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          </>
        )}
      </div>
    </section>
  );
}
