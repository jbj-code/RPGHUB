import { useState } from "react";
import type { Theme } from "../theme";
import { getPrimaryActionButtonStyle, getPrimaryButtonStyle, PAGE_LAYOUT } from "../theme";

type OptionsBuilderProps = { theme: Theme };

type BuilderRow = {
  id: string;
  ticker: string;
  maturity: string;
  strike: string;
  putCall: "Put" | "Call";
  action: "Sell to Open" | "Buy to Open";
  contracts: string;
  limitPriceMethod: "bid" | "mid";
};

type BuiltRow = {
  ticker: string;
  maturity: string;
  daysToMaturity: number;
  strikePrice: number;
  currentPrice: number;
  moneynessPct: number;
  optionSide: string;
  optionLimitPrice: number;
  currentBid: number;
  currentAsk: number;
  contracts: number;
  premiumReceived: number;
  yieldAtCurrentPrice: number;
  annualizedYieldPct: number;
  valueOfSharesAtStrike: number;
};

const SCHWAB_API_BASE =
  (import.meta.env.VITE_SCHWAB_API_BASE as string) ||
  "https://therpghub.vercel.app";

export function OptionsBuilder({ theme: t }: OptionsBuilderProps) {
  const pageStyle: React.CSSProperties = {
    maxWidth: PAGE_LAYOUT.maxWidth,
    width: "100%",
    margin: "0 auto",
    fontFamily: t.typography.fontFamily,
    color: t.colors.text,
    minHeight: 400,
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
    padding: t.spacing(4),
    marginBottom: t.spacing(4),
    boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
    border: `1px solid ${t.colors.border}`,
  };

  const tableHeaderStyle: React.CSSProperties = {
    padding: t.spacing(1.5),
    borderBottom: `1px solid ${t.colors.border}`,
    backgroundColor: t.colors.secondary,
    color: "#FFFFFF",
    fontSize: "0.8rem",
    textAlign: "left",
  };

  const tableHeaderNumStyle: React.CSSProperties = {
    ...tableHeaderStyle,
    textAlign: "right",
  };

  const sectionTitleStyle: React.CSSProperties = {
    fontSize: "0.75rem",
    color: t.colors.secondary,
    textTransform: "uppercase" as const,
    letterSpacing: "0.04em",
    marginBottom: t.spacing(2),
  };

  const labelStyle: React.CSSProperties = {
    fontSize: "0.75rem",
    color: t.colors.textMuted,
    textTransform: "uppercase" as const,
    letterSpacing: "0.04em",
    marginBottom: t.spacing(0.5),
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    maxWidth: 140,
    padding: `${t.spacing(1.5)} ${t.spacing(2)}`,
    fontSize: t.typography.baseFontSize,
    border: `1px solid ${t.colors.border}`,
    borderRadius: t.radius.sm,
    backgroundColor: t.colors.surface,
    color: t.colors.text,
  };

  const primaryBtn = getPrimaryActionButtonStyle(t);

  const [rows, setRows] = useState<BuilderRow[]>([
    {
      id: "row-1",
      ticker: "",
      maturity: "",
      strike: "",
      putCall: "Put",
      action: "Sell to Open",
      contracts: "",
      limitPriceMethod: "bid",
    },
  ]);
  const [builtRows, setBuiltRows] = useState<BuiltRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copyJustPressed, setCopyJustPressed] = useState(false);

  return (
    <section className="options-builder-page" style={pageStyle}>
      <h2 style={titleStyle}>Options Builder</h2>
      <p style={descStyle}>
        Draft trade tickets for individual options and bundles, then copy the fully formatted rows
        into Excel. This page mirrors the structure of your existing spreadsheet so you can move
        faster and reduce manual data entry.
      </p>

      <div className="page-card" style={cardStyle}>
        <h3 style={sectionTitleStyle}>Define trades</h3>
        <p style={{ fontSize: "0.875rem", color: t.colors.textMuted, marginBottom: t.spacing(3) }}>
          Enter the key details for each contract and click Build sheet to fetch live Schwab quotes
          and calculate yields. You can then copy the table to Excel or export as CSV.
        </p>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: t.spacing(3),
            marginBottom: t.spacing(3),
          }}
        >
          {rows.map((row, index) => (
            <div
              key={row.id}
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "flex-end",
                gap: t.spacing(3),
                padding: t.spacing(3),
                backgroundColor: t.colors.background,
                borderRadius: t.radius.md,
                border: `1px solid ${t.colors.border}`,
              }}
            >
              <div>
                <div style={labelStyle}>Ticker</div>
                <input
                  type="text"
                  placeholder="e.g. OWL"
                  style={{ ...inputStyle, maxWidth: 90 }}
                  value={row.ticker}
                  onChange={(e) => {
                    const next = [...rows];
                    next[index] = { ...row, ticker: e.target.value.toUpperCase() };
                    setRows(next);
                  }}
                />
              </div>
              <div>
                <div style={labelStyle}>Maturity</div>
                <input
                  type="date"
                  style={inputStyle}
                  value={row.maturity}
                  onChange={(e) => {
                    const next = [...rows];
                    next[index] = { ...row, maturity: e.target.value };
                    setRows(next);
                  }}
                />
              </div>
              <div>
                <div style={labelStyle}>Strike Price</div>
                <input
                  type="number"
                  placeholder="0.00"
                  style={inputStyle}
                  value={row.strike}
                  onChange={(e) => {
                    const next = [...rows];
                    next[index] = { ...row, strike: e.target.value };
                    setRows(next);
                  }}
                />
              </div>
              <div>
                <div style={labelStyle}>Put / Call</div>
                <select
                  style={{ ...inputStyle, maxWidth: 110 }}
                  value={row.putCall}
                  onChange={(e) => {
                    const next = [...rows];
                    next[index] = { ...row, putCall: e.target.value as "Put" | "Call" };
                    setRows(next);
                  }}
                >
                  <option value="Put">Put</option>
                  <option value="Call">Call</option>
                </select>
              </div>
              <div>
                <div style={labelStyle}>Action</div>
                <select
                  style={{ ...inputStyle, maxWidth: 150 }}
                  value={row.action}
                  onChange={(e) => {
                    const next = [...rows];
                    next[index] = {
                      ...row,
                      action: e.target.value as "Sell to Open" | "Buy to Open",
                    };
                    setRows(next);
                  }}
                >
                  <option value="Sell to Open">Sell to Open</option>
                  <option value="Buy to Open">Buy to Open</option>
                </select>
              </div>
              <div>
                <div style={labelStyle}>Contracts</div>
                <input
                  type="number"
                  min={1}
                  placeholder="e.g. 10"
                  style={inputStyle}
                  value={row.contracts}
                  onChange={(e) => {
                    const next = [...rows];
                    next[index] = { ...row, contracts: e.target.value };
                    setRows(next);
                  }}
                />
              </div>
              <div>
                <div style={labelStyle}>Limit price method</div>
                <select
                  style={{ ...inputStyle, maxWidth: 160 }}
                  value={row.limitPriceMethod}
                  onChange={(e) => {
                    const next = [...rows];
                    next[index] = {
                      ...row,
                      limitPriceMethod: e.target.value as "bid" | "mid",
                    };
                    setRows(next);
                  }}
                >
                  <option value="bid">Use bid</option>
                  <option value="mid">Use midpoint</option>
                </select>
              </div>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: t.spacing(2), flexWrap: "wrap" }}>
          <button
            type="button"
            style={{ ...primaryBtn, paddingLeft: t.spacing(3), paddingRight: t.spacing(3) }}
            onClick={async () => {
              setError(null);
              setBuiltRows([]);
              const cleanRows = rows.filter(
                (r) => r.ticker && r.maturity && r.strike && r.contracts
              );
              if (cleanRows.length === 0) {
                setError("Add at least one row with ticker, date, strike, and contracts.");
                return;
              }
              setLoading(true);
              try {
                const payload = cleanRows.map((r) => ({
                  ticker: r.ticker.trim().toUpperCase(),
                  maturity: r.maturity,
                  strike: Number(r.strike),
                  putCall: r.putCall,
                  action: r.action,
                  contracts: Number(r.contracts),
                  limitPriceMethod: r.limitPriceMethod,
                }));
                const res = await fetch(`${SCHWAB_API_BASE}/api/options-builder`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ rows: payload }),
                });
                const data = await res.json();
                if (!res.ok) {
                  throw new Error(data?.error || `Request failed with ${res.status}`);
                }
                setBuiltRows(Array.isArray(data.rows) ? data.rows : []);
              } catch (e: unknown) {
                setError(
                  e instanceof Error
                    ? e.message
                    : "Failed to build sheet from Schwab data"
                );
              } finally {
                setLoading(false);
              }
            }}
            disabled={loading}
          >
            {loading ? "Building…" : "Build sheet"}
          </button>
          <button
            type="button"
            style={{
              ...primaryBtn,
              backgroundColor: "transparent",
              color: t.colors.textMuted,
              border: `1px solid ${t.colors.border}`,
            }}
            onClick={() => {
              setRows((prev) => [
                ...prev,
                {
                  id: `row-${prev.length + 1}`,
                  ticker: "",
                  maturity: "",
                  strike: "",
                  putCall: "Put",
                  action: "Sell to Open",
                  contracts: "",
                  limitPriceMethod: "bid",
                },
              ]);
            }}
          >
            + Add row
          </button>
        </div>
        {error && (
          <p
            style={{
              marginTop: t.spacing(3),
              fontSize: "0.875rem",
              color: t.colors.danger,
            }}
          >
            {error}
          </p>
        )}
      </div>

      <div className="page-card" style={cardStyle}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: t.spacing(2),
          }}
        >
          <h3 style={{ ...sectionTitleStyle, marginBottom: 0 }}>Excel-style output</h3>
          <div style={{ display: "flex", alignItems: "center", gap: t.spacing(2) }}>
            <button
              type="button"
              disabled={builtRows.length === 0}
              onClick={() => {
                if (builtRows.length === 0) return;
                const header = [
                  "Ticker",
                  "Maturity",
                  "Days to Maturity",
                  "Strike Price",
                  "Current Price",
                  "Moneyness",
                  "Option Side",
                  "Option Limit Price",
                  "Current Bid",
                  "Current Ask",
                  "Contracts",
                  "Premium Received",
                  "Yield at Current Price",
                  "Annualized Yield %",
                  "Value of Shares at Strike",
                ];
                const rowsTsv = builtRows.map((r) =>
                  [
                    r.ticker,
                    r.maturity,
                    r.daysToMaturity.toString(),
                    r.strikePrice.toFixed(2),
                    r.currentPrice.toFixed(2),
                    `${r.moneynessPct.toFixed(2)}%`,
                    r.optionSide,
                    r.optionLimitPrice.toFixed(2),
                    r.currentBid.toFixed(2),
                    r.currentAsk.toFixed(2),
                    r.contracts.toString(),
                    r.premiumReceived.toFixed(2),
                    r.yieldAtCurrentPrice.toFixed(2),
                    r.annualizedYieldPct.toFixed(2),
                    r.valueOfSharesAtStrike.toFixed(2),
                  ].join("\t")
                );
                const tsv = [header.join("\t"), ...rowsTsv].join("\r\n");
                void navigator.clipboard.writeText(tsv);
                setCopyJustPressed(true);
                window.setTimeout(() => setCopyJustPressed(false), 2000);
              }}
              style={{
                width: 34,
                height: 34,
                padding: 0,
                border: "none",
                background: "none",
                cursor: builtRows.length === 0 ? "default" : "pointer",
                color: t.colors.textMuted,
                borderRadius: t.radius.sm,
                position: "relative",
                marginTop: -4,
              }}
              title="Copy table (Excel / Google Sheets)"
              aria-label="Copy table to clipboard"
            >
              <span
                className="material-symbols-outlined"
                style={{
                  fontSize: 22,
                  position: "absolute",
                  opacity: copyJustPressed ? 0 : 1,
                  transition: "opacity 0.2s ease",
                  pointerEvents: "none",
                }}
                aria-hidden
              >
                content_copy
              </span>
              <span
                className="material-symbols-outlined"
                style={{
                  fontSize: 22,
                  position: "absolute",
                  opacity: copyJustPressed ? 1 : 0,
                  transition: "opacity 0.2s ease",
                  pointerEvents: "none",
                }}
                aria-hidden
              >
                check
              </span>
            </button>
            <button
              type="button"
              disabled={builtRows.length === 0}
              onClick={() => {
                if (builtRows.length === 0) return;
                const header = [
                  "Ticker",
                  "Maturity",
                  "Days to Maturity",
                  "Strike Price",
                  "Current Price",
                  "Moneyness",
                  "Option Side",
                  "Option Limit Price",
                  "Current Bid",
                  "Current Ask",
                  "Contracts",
                  "Premium Received",
                  "Yield at Current Price",
                  "Annualized Yield %",
                  "Value of Shares at Strike",
                ];
                const rowsCsv = builtRows.map((r) =>
                  [
                    r.ticker,
                    r.maturity,
                    r.daysToMaturity.toString(),
                    r.strikePrice.toFixed(2),
                    r.currentPrice.toFixed(2),
                    `${r.moneynessPct.toFixed(2)}%`,
                    r.optionSide,
                    r.optionLimitPrice.toFixed(2),
                    r.currentBid.toFixed(2),
                    r.currentAsk.toFixed(2),
                    r.contracts.toString(),
                    r.premiumReceived.toFixed(2),
                    r.yieldAtCurrentPrice.toFixed(2),
                    r.annualizedYieldPct.toFixed(2),
                    r.valueOfSharesAtStrike.toFixed(2),
                  ]
                    .map((cell) => `"${cell.replace(/"/g, '""')}"`)
                    .join(",")
                );
                const csv = [header.join(","), ...rowsCsv].join("\r\n");
                const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
                const url = URL.createObjectURL(blob);
                const link = document.createElement("a");
                link.href = url;
                link.download = "options-builder.csv";
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                URL.revokeObjectURL(url);
              }}
              style={{
                width: 34,
                height: 34,
                padding: 0,
                border: "none",
                background: "none",
                cursor: builtRows.length === 0 ? "default" : "pointer",
                color: t.colors.textMuted,
                borderRadius: t.radius.sm,
                position: "relative",
                marginTop: -4,
              }}
              title="Download CSV"
              aria-label="Download CSV"
            >
              <span
                className="material-symbols-outlined"
                style={{
                  fontSize: 22,
                  position: "absolute",
                  opacity: 1,
                  pointerEvents: "none",
                }}
                aria-hidden
              >
                download
              </span>
            </button>
          </div>
        </div>
        <div
          style={{
            overflowX: "auto",
            borderRadius: t.radius.md,
            border: `1px solid ${t.colors.border}`,
          }}
        >
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: "0.8rem",
              fontFamily: t.typography.fontFamily,
            }}
          >
            <thead>
              <tr>
                <th style={tableHeaderStyle}>
                  Ticker
                </th>
                <th style={tableHeaderStyle}>
                  Maturity
                </th>
                <th style={tableHeaderNumStyle}>
                  Days to Maturity
                </th>
                <th style={tableHeaderNumStyle}>
                  Strike Price
                </th>
                <th style={tableHeaderNumStyle}>
                  Current Price
                </th>
                <th style={tableHeaderNumStyle}>
                  Moneyness
                </th>
                <th style={tableHeaderStyle}>
                  Option Side
                </th>
                <th style={tableHeaderNumStyle}>
                  Option Limit Price
                </th>
                <th style={tableHeaderNumStyle}>
                  Current Bid
                </th>
                <th style={tableHeaderNumStyle}>
                  Current Ask
                </th>
                <th style={tableHeaderNumStyle}>
                  Contracts
                </th>
                <th style={tableHeaderNumStyle}>
                  Premium Received
                </th>
                <th style={tableHeaderNumStyle}>
                  Yield at Current Price
                </th>
                <th style={tableHeaderNumStyle}>
                  Annualized Yield %
                </th>
                <th style={tableHeaderNumStyle}>
                  Value of Shares at Strike
                </th>
              </tr>
            </thead>
            <tbody>
              {builtRows.map((r) => (
                <tr key={`${r.ticker}-${r.maturity}-${r.strikePrice}-${r.optionSide}`}>
                  <td style={{ padding: t.spacing(1.5), borderBottom: `1px solid ${t.colors.border}` }}>{r.ticker}</td>
                  <td style={{ padding: t.spacing(1.5), borderBottom: `1px solid ${t.colors.border}` }}>{r.maturity}</td>
                  <td style={{ padding: t.spacing(1.5), borderBottom: `1px solid ${t.colors.border}`, textAlign: "right" }}>
                    {r.daysToMaturity}
                  </td>
                  <td style={{ padding: t.spacing(1.5), borderBottom: `1px solid ${t.colors.border}`, textAlign: "right" }}>
                    ${r.strikePrice.toFixed(2)}
                  </td>
                  <td style={{ padding: t.spacing(1.5), borderBottom: `1px solid ${t.colors.border}`, textAlign: "right" }}>
                    ${r.currentPrice.toFixed(2)}
                  </td>
                  <td style={{ padding: t.spacing(1.5), borderBottom: `1px solid ${t.colors.border}`, textAlign: "right" }}>
                    {r.moneynessPct.toFixed(2)}%
                  </td>
                  <td style={{ padding: t.spacing(1.5), borderBottom: `1px solid ${t.colors.border}` }}>
                    {r.optionSide}
                  </td>
                  <td style={{ padding: t.spacing(1.5), borderBottom: `1px solid ${t.colors.border}`, textAlign: "right" }}>
                    ${r.optionLimitPrice.toFixed(2)}
                  </td>
                  <td style={{ padding: t.spacing(1.5), borderBottom: `1px solid ${t.colors.border}`, textAlign: "right" }}>
                    ${r.currentBid.toFixed(2)}
                  </td>
                  <td style={{ padding: t.spacing(1.5), borderBottom: `1px solid ${t.colors.border}`, textAlign: "right" }}>
                    ${r.currentAsk.toFixed(2)}
                  </td>
                  <td style={{ padding: t.spacing(1.5), borderBottom: `1px solid ${t.colors.border}`, textAlign: "right" }}>
                    {r.contracts}
                  </td>
                  <td style={{ padding: t.spacing(1.5), borderBottom: `1px solid ${t.colors.border}`, textAlign: "right" }}>
                    ${r.premiumReceived.toFixed(2)}
                  </td>
                  <td style={{ padding: t.spacing(1.5), borderBottom: `1px solid ${t.colors.border}`, textAlign: "right" }}>
                    {r.yieldAtCurrentPrice.toFixed(2)}%
                  </td>
                  <td style={{ padding: t.spacing(1.5), borderBottom: `1px solid ${t.colors.border}`, textAlign: "right" }}>
                    {r.annualizedYieldPct.toFixed(2)}%
                  </td>
                  <td style={{ padding: t.spacing(1.5), borderBottom: `1px solid ${t.colors.border}`, textAlign: "right" }}>
                    ${r.valueOfSharesAtStrike.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <footer
        style={{
          marginTop: t.spacing(6),
          paddingTop: t.spacing(3),
          borderTop: `1px solid ${t.colors.border}`,
          fontSize: "0.75rem",
          color: t.colors.textMuted,
        }}
      >
        Market data provided by Charles Schwab.
      </footer>
    </section>
  );
}

