import { useState, useCallback, useEffect } from "react";
import type { Theme } from "../theme";
import {
  getPrimaryActionButtonStyle,
  getPrimaryButtonStyle,
  PAGE_LAYOUT,
  getDropdownTriggerStyle,
  getDropdownPanelStyle,
  getDropdownOptionStyle,
  THEME_DROPDOWN_OPTION_CLASS,
  getTooltipIconStyle,
  getTooltipBubbleStyle,
} from "../theme";

type OptionsOptimizerProps = { theme: Theme };

type OptionSide =
  | "PUT - SELL to OPEN"
  | "PUT - BUY to OPEN"
  | "PUT - SELL to CLOSE"
  | "PUT - BUY to CLOSE"
  | "CALL - SELL to OPEN"
  | "CALL - BUY to OPEN"
  | "CALL - SELL to CLOSE"
  | "CALL - BUY to CLOSE";

export type OptionsTrade = {
  id: string;
  ticker: string;
  maturity: string;
  daysToMaturity: number;
  strikePrice: number;
  currentPrice: number;
  moneynessPct: number;
  optionSide: OptionSide;
  pctOffBid: number;
  optionLimitPrice: number;
  currentBid: number;
  currentAsk: number;
  contracts: number;
  premiumReceived: number;
  yieldAtCurrentPrice: number;
  annualizedYieldPct: number;
  valueOfSharesAtStrike: number;
};

/** One row in "Define what you want" */
export type PortfolioRow = {
  id: string;
  ticker: string;
  putCall: "Put" | "Call";
  action: "Sell to Open" | "Buy to Open" | "Sell to Close" | "Buy to Close";
  type: "Qty" | "Notional";
  value: number;
  days: number;
  moneyness: "OTM" | "ITM";
  otmPct: number;
  monthly: boolean;
};

/** One row in the ranked optimization results */
export type RankedResult = {
  rank: number;
  ticker: string;
  company: string;
  upsidePct: number; // e.g. 1M performance; API-friendly alternative to analyst target
  strike: number;
  bid: number;
  annYield: number;
  premiumPerContract: number;
  trade: OptionsTrade;
};

const TICKER_TO_COMPANY: Record<string, string> = {
  OIH: "Oil Services ETF",
  SPY: "S&P 500 ETF",
  QQQ: "Nasdaq 100 ETF",
  IWM: "Russell 2000 ETF",
  XLE: "Energy Select Sector",
  XLF: "Financial Select Sector",
  AAPL: "Apple Inc.",
  MSFT: "Microsoft Corp.",
  NVDA: "NVIDIA Corp.",
  GOOGL: "Alphabet Inc.",
};

const SCHWAB_API_BASE =
  (import.meta.env.VITE_SCHWAB_API_BASE as string) ||
  "https://therpghub.vercel.app";

function makeId(): string {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

function formatMoney(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "−" : "";
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(2)}`;
}

/** Schwab-style symbol: TICKER MM/DD/YYYY Strike C|P */
function formatSchwabSymbol(tr: OptionsTrade): string {
  const d = new Date(tr.maturity + "Z");
  const mm = (d.getUTCMonth() + 1).toString().padStart(2, "0");
  const dd = d.getUTCDate().toString().padStart(2, "0");
  const yyyy = d.getUTCFullYear();
  const type = tr.optionSide.startsWith("PUT") ? "P" : "C";
  const strike = Math.round(tr.strikePrice) === tr.strikePrice ? tr.strikePrice.toString() : tr.strikePrice.toFixed(2);
  return `${tr.ticker} ${mm}/${dd}/${yyyy} ${strike} ${type}`;
}

/** Bloomberg-style option key: TICKER US MM/DD/YY C|P Strike Equity */
function formatOptionKey(tr: OptionsTrade): string {
  const d = new Date(tr.maturity + "Z");
  const mm = (d.getUTCMonth() + 1).toString().padStart(2, "0");
  const dd = d.getUTCDate().toString().padStart(2, "0");
  const yy = d.getUTCFullYear().toString().slice(-2);
  const type = tr.optionSide.startsWith("PUT") ? "P" : "C";
  const strike = Math.round(tr.strikePrice) === tr.strikePrice ? tr.strikePrice.toString() : tr.strikePrice.toFixed(2);
  return `${tr.ticker} US ${mm}/${dd}/${yy} ${type}${strike} Equity`;
}



const defaultPortfolioRow = (): PortfolioRow => ({
  id: makeId(),
  ticker: "",
  putCall: "Put",
  action: "Sell to Open",
  type: "Qty",
  value: 0,
  days: 30,
  moneyness: "OTM",
  otmPct: 10,
  monthly: false,
});

type HelpTooltipProps = { theme: Theme; text: string; children: React.ReactNode };

function HelpTooltip({ theme: t, text, children }: HelpTooltipProps) {
  const [open, setOpen] = useState(false);
  return (
    <span
      style={{ position: "relative", display: "inline-flex" }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {children}
      {open && (
        <div style={getTooltipBubbleStyle(t)} role="tooltip">
          {text}
        </div>
      )}
    </span>
  );
}

type ThemeSelectOption = { value: string; label: string };

type ThemeSelectProps = {
  theme: Theme;
  value: string;
  options: ThemeSelectOption[];
  onChange: (v: string) => void;
  dropdownKey: string;
  openId: string | null;
  setOpenId: (id: string | null) => void;
  minWidth?: number;
};

function OptimizerThemeSelect({
  theme: t,
  value,
  options,
  onChange,
  dropdownKey,
  openId,
  setOpenId,
  minWidth,
}: ThemeSelectProps) {
  const open = openId === dropdownKey;
  const display = options.find((o) => o.value === value)?.label ?? value;
  return (
    <div style={{ position: "relative", minWidth: minWidth ?? 0 }}>
      <button
        type="button"
        onClick={() => setOpenId(open ? null : dropdownKey)}
        style={{ ...getDropdownTriggerStyle(t), minWidth: minWidth ?? 120, margin: 0 }}
        aria-expanded={open}
        aria-haspopup="listbox"
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
          {display}
        </span>
        <span className="material-symbols-outlined" style={{ fontSize: 18, flexShrink: 0 }}>
          expand_more
        </span>
      </button>
      {open && (
        <>
          <div
            role="presentation"
            style={{ position: "fixed", inset: 0, zIndex: 3998 }}
            onClick={() => setOpenId(null)}
          />
          <div style={{ ...getDropdownPanelStyle(t, "down"), zIndex: 3999, minWidth: "100%" }}>
            {options.map((o) => (
              <button
                key={o.value}
                type="button"
                className={THEME_DROPDOWN_OPTION_CLASS}
                onClick={() => {
                  onChange(o.value);
                  setOpenId(null);
                }}
                style={getDropdownOptionStyle(t, value === o.value)}
              >
                {o.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export function OptionsOptimizer({ theme: t }: OptionsOptimizerProps) {
  const [portfolioRows, setPortfolioRows] = useState<PortfolioRow[]>([defaultPortfolioRow()]);
  const [portfolioDropdownId, setPortfolioDropdownId] = useState<string | null>(null);
  const [otmVariancePct, setOtmVariancePct] = useState(5);
  const [rankedResults, setRankedResults] = useState<RankedResult[] | null>(null);
  const [optimizeMessage, setOptimizeMessage] = useState<string | null>(null);
  const [optimizeLoading, setOptimizeLoading] = useState(false);
  const [trades, setTrades] = useState<OptionsTrade[]>([]);
  const [showOptimizeForModal, setShowOptimizeForModal] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [lastAddedTradeId, setLastAddedTradeId] = useState<string | null>(null);
  const [lastCopiedTradeId, setLastCopiedTradeId] = useState<string | null>(null);

  useEffect(() => {
    if (!showOptimizeForModal) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowOptimizeForModal(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [showOptimizeForModal]);

  const addPortfolioRow = useCallback(() => {
    setPortfolioRows((prev) => [...prev, defaultPortfolioRow()]);
  }, []);

  const removePortfolioRow = useCallback((id: string) => {
    setPortfolioRows((prev) => (prev.length > 1 ? prev.filter((r) => r.id !== id) : prev));
  }, []);

  const updatePortfolioRow = useCallback(
    (id: string, field: keyof PortfolioRow, value: string | number | boolean) => {
      setPortfolioRows((prev) =>
        prev.map((r) => (r.id === id ? { ...r, [field]: value } : r))
      );
    },
    []
  );

  const runOptimize = useCallback(async () => {
    const tickers = portfolioRows.map((r) => r.ticker.trim().toUpperCase()).filter(Boolean);
    if (tickers.length === 0) {
      setOptimizeMessage("Add at least one ticker with a symbol to optimize.");
      setRankedResults(null);
      return;
    }
    setOptimizeLoading(true);
    setOptimizeMessage(null);
    try {
      const res = await fetch(`${SCHWAB_API_BASE}/api/schwab-option-optimizer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          portfolioRows,
          otmVariancePct,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setRankedResults(null);
        setOptimizeMessage(data?.error ?? "Optimizer request failed. Check Schwab connection.");
        return;
      }
      const results: RankedResult[] = Array.isArray(data.results) ? data.results : [];
      const message: string | null = data.message ?? null;
      setRankedResults(results);
      setOptimizeMessage(message);
      if (results.length > 0) {
        setLastUpdated(new Date());
      }
    } catch (err) {
      setRankedResults(null);
      setOptimizeMessage("Network error. Try again.");
    } finally {
      setOptimizeLoading(false);
    }
  }, [portfolioRows, otmVariancePct]);

  const addToTradeList = useCallback((result: RankedResult) => {
    const trade = { ...result.trade, id: makeId() };
    setTrades((prev) => [...prev, trade]);
    setLastAddedTradeId(result.trade.id);
    window.setTimeout(() => {
      setLastAddedTradeId((prev) => (prev === result.trade.id ? null : prev));
    }, 1200);
  }, []);

  const removeTrade = useCallback((id: string) => {
    setTrades((prev) => prev.filter((tr) => tr.id !== id));
  }, []);

  const summaryPremium = trades.reduce((sum, tr) => sum + tr.premiumReceived, 0);
  const summaryTotal = trades.reduce((sum, tr) => sum + tr.valueOfSharesAtStrike, 0);

  const showSchwabAuthHint =
    !!optimizeMessage &&
    (optimizeMessage.includes("Schwab token expired") ||
      optimizeMessage.includes("Not authorized with Schwab"));

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

  const valueStyle: React.CSSProperties = {
    fontSize: "0.95rem",
    fontWeight: 500,
    color: t.colors.text,
  };

  const primaryBtn = getPrimaryActionButtonStyle(t);
  const secondaryBtnStyle: React.CSSProperties = {
    padding: `${t.spacing(2.5)} ${t.spacing(3)}`,
    fontSize: "0.875rem",
    fontWeight: 600,
    color: t.colors.textMuted,
    background: "none",
    border: `1px solid ${t.colors.border}`,
    borderRadius: t.radius.md,
    cursor: "pointer",
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    maxWidth: 120,
    padding: `${t.spacing(2)} ${t.spacing(3)}`,
    height: 40,
    fontSize: t.typography.baseFontSize,
    border: `1px solid ${t.colors.border}`,
    borderRadius: t.radius.md,
    backgroundColor: t.colors.surface,
    color: t.colors.text,
  };

  return (
    <section className="options-optimizer-page" style={pageStyle}>
      <div className="options-optimizer-header-row" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: PAGE_LAYOUT.titleBlockMarginTop, marginBottom: t.spacing(PAGE_LAYOUT.titleMarginBottom) }}>
        <h2 style={{ ...titleStyle, margin: 0, lineHeight: 1.3 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: t.spacing(2) }}>
            <span
              className="material-symbols-outlined"
              style={{ fontSize: "1.5rem", color: t.colors.secondary, lineHeight: 1, display: "inline-flex" }}
              aria-hidden
            >
              tune
            </span>
            Options Optimizer
          </span>
        </h2>
        <button
          type="button"
          onClick={() => setShowOptimizeForModal(true)}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 28,
            height: 28,
            padding: 0,
            border: "none",
            borderRadius: "50%",
            backgroundColor: "transparent",
            color: t.colors.secondary,
            cursor: "pointer",
            flexShrink: 0,
            verticalAlign: "middle",
          }}
          aria-label="What we optimize for"
        >
          <span className="material-symbols-outlined options-optimizer-info-icon" style={{ fontSize: 26 }} aria-hidden>info</span>
        </button>
      </div>
      <p style={descStyle}>
        Define the tickers and parameters you want, run Optimize to fetch live options from Schwab, then add ideas to your trade list.
      </p>

      {showOptimizeForModal && (
        <>
          <div
            role="presentation"
            style={{
              position: "fixed",
              inset: 0,
              backgroundColor: "rgba(0,0,0,0.4)",
              zIndex: 1000,
            }}
            onClick={() => setShowOptimizeForModal(false)}
            onKeyDown={(e) => e.key === "Escape" && setShowOptimizeForModal(false)}
          />
          <div
            role="dialog"
            aria-labelledby="optimize-for-title"
            aria-modal="true"
            style={{
              position: "fixed",
              left: "50%",
              top: "50%",
              transform: "translate(-50%, -50%)",
              zIndex: 1001,
              backgroundColor: t.colors.surface,
              borderRadius: t.radius.lg,
              padding: t.spacing(5),
              maxWidth: 420,
              width: "90%",
              boxShadow: "0 12px 40px rgba(15, 42, 54, 0.2)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: t.spacing(3) }}>
              <h3 id="optimize-for-title" style={{ ...sectionTitleStyle, marginBottom: 0, color: t.colors.secondary }}>What we optimize for</h3>
              <button
                type="button"
                onClick={() => setShowOptimizeForModal(false)}
                style={{
                  padding: t.spacing(0.5),
                  border: "none",
                  background: "none",
                  color: t.colors.textMuted,
                  cursor: "pointer",
                }}
                aria-label="Close"
              >
                <span className="material-symbols-outlined" style={{ fontSize: 22 }}>close</span>
              </button>
            </div>
            <ul style={{ margin: 0, paddingLeft: t.spacing(5), color: t.colors.text, fontSize: "0.9rem", lineHeight: 1.7 }}>
              <li><strong>Income:</strong> We rank options by <strong>annualized yield</strong> so you can find the best premium income for your clients.</li>
              <li><strong>Strike &amp; contracts:</strong> The table shows the <strong>specific options</strong> that score best—each row is a concrete strike, DTE, and size. The better strikes and contract counts are the ones at the top.</li>
              <li><strong>Less assignment risk:</strong> We combine yield with <strong>underlying upside</strong> (e.g. 1M performance). So you get high yield without favoring names that are falling—where high yield often means higher assignment risk.</li>
            </ul>
          </div>
        </>
      )}

      {/* —— Portfolio Tickers (Define what you want) —— */}
      <div
        className="options-optimizer-card"
        style={{
          ...cardStyle,
          position: "relative",
          zIndex: portfolioDropdownId ? 3000 : 2,
        }}
      >
        <h3 style={sectionTitleStyle}>Portfolio tickers</h3>
        <p style={{ fontSize: "0.875rem", color: t.colors.textMuted, marginBottom: t.spacing(3) }}>
          Enter ticker, type (Qty or Notional), value, target days to maturity, and OTM or ITM %. Optionally set variance to consider a strike range. Then run Optimize.
        </p>
        <div style={{ display: "flex", alignItems: "center", gap: t.spacing(2), marginBottom: t.spacing(3) }}>
          <HelpTooltip
            theme={t}
            text="How wide a strike range to consider around your target OTM/ITM %. For example 5% with 10% target = 5–15% strikes."
          >
            <label style={{ ...labelStyle, marginBottom: 0 }}>Variance % (strike range)</label>
          </HelpTooltip>
          <input
            type="number"
            min={0}
            max={50}
            step={1}
            style={{ ...inputStyle, maxWidth: 64 }}
            value={otmVariancePct}
            onChange={(e) => setOtmVariancePct(Number(e.target.value) || 0)}
            aria-label="Variance percent"
          />
          <span style={{ fontSize: "0.8rem", color: t.colors.textMuted }}>e.g. 5% with 10% target = 5–15% strikes</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: t.spacing(3) }}>
          {portfolioRows.map((row) => (
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
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "flex-start",
                  gap: t.spacing(1),
                }}
              >
                <HelpTooltip
                  theme={t}
                  text="Underlying symbol for the option, e.g. SPY, AAPL, NVDA."
                >
                  <label style={labelStyle}>Ticker</label>
                </HelpTooltip>
                <input
                  type="text"
                  placeholder="e.g. SPY"
                  style={{ ...inputStyle, maxWidth: 90 }}
                  value={row.ticker}
                  onChange={(e) => updatePortfolioRow(row.id, "ticker", e.target.value)}
                  aria-label="Ticker"
                />
              </div>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "flex-start",
                  gap: t.spacing(1),
                }}
              >
                <label style={labelStyle}>Put / Call</label>
                <OptimizerThemeSelect
                  theme={t}
                  value={row.putCall}
                  options={[
                    { value: "Put", label: "Put" },
                    { value: "Call", label: "Call" },
                  ]}
                  onChange={(v) => updatePortfolioRow(row.id, "putCall", v as "Put" | "Call")}
                  dropdownKey={`${row.id}-putCall`}
                  openId={portfolioDropdownId}
                  setOpenId={setPortfolioDropdownId}
                  minWidth={100}
                />
              </div>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "flex-start",
                  gap: t.spacing(1),
                }}
              >
                <label style={labelStyle}>Action</label>
                <OptimizerThemeSelect
                  theme={t}
                  value={row.action}
                  options={[
                    { value: "Sell to Open", label: "Sell to Open" },
                    { value: "Buy to Open", label: "Buy to Open" },
                    { value: "Sell to Close", label: "Sell to Close" },
                    { value: "Buy to Close", label: "Buy to Close" },
                  ]}
                  onChange={(v) =>
                    updatePortfolioRow(
                      row.id,
                      "action",
                      v as "Sell to Open" | "Buy to Open" | "Sell to Close" | "Buy to Close"
                    )
                  }
                  dropdownKey={`${row.id}-action`}
                  openId={portfolioDropdownId}
                  setOpenId={setPortfolioDropdownId}
                  minWidth={130}
                />
              </div>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "flex-start",
                  gap: t.spacing(1),
                }}
              >
                <HelpTooltip
                  theme={t}
                  text="Qty = number of contracts. Notional = target dollar amount of underlying shares at strike."
                >
                  <label style={labelStyle}>Type</label>
                </HelpTooltip>
                <OptimizerThemeSelect
                  theme={t}
                  value={row.type}
                  options={[
                    { value: "Qty", label: "Qty" },
                    { value: "Notional", label: "Notional" },
                  ]}
                  onChange={(v) => updatePortfolioRow(row.id, "type", v as "Qty" | "Notional")}
                  dropdownKey={`${row.id}-type`}
                  openId={portfolioDropdownId}
                  setOpenId={setPortfolioDropdownId}
                  minWidth={90}
                />
              </div>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "flex-start",
                  gap: t.spacing(1),
                }}
              >
                <HelpTooltip
                  theme={t}
                  text="If Type is Qty, this is contracts. If Notional, this is target notional of underlying at strike."
                >
                  <label style={labelStyle}>Value</label>
                </HelpTooltip>
                <input
                  type="number"
                  min={0}
                  style={inputStyle}
                  value={row.value || ""}
                  onChange={(e) => updatePortfolioRow(row.id, "value", Number(e.target.value) || 0)}
                  placeholder="0"
                  aria-label="Value"
                />
              </div>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "flex-start",
                  gap: t.spacing(1),
                }}
              >
                <HelpTooltip
                  theme={t}
                  text="Target days to expiration for this leg. Optimizer will look near this DTE."
                >
                  <label style={labelStyle}>Days (DTE)</label>
                </HelpTooltip>
                <input
                  type="number"
                  min={1}
                  style={{ ...inputStyle, maxWidth: 70 }}
                  value={row.days || ""}
                  onChange={(e) => updatePortfolioRow(row.id, "days", Number(e.target.value) || 0)}
                  placeholder="30"
                  aria-label="Days to expiration"
                />
              </div>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "flex-start",
                  gap: t.spacing(1),
                }}
              >
                <HelpTooltip
                  theme={t}
                  text="Whether you want strikes out of the money (OTM) or in the money (ITM) relative to current price."
                >
                  <label style={labelStyle}>OTM / ITM</label>
                </HelpTooltip>
                <OptimizerThemeSelect
                  theme={t}
                  value={row.moneyness ?? "OTM"}
                  options={[
                    { value: "OTM", label: "OTM" },
                    { value: "ITM", label: "ITM" },
                  ]}
                  onChange={(v) => updatePortfolioRow(row.id, "moneyness", v as "OTM" | "ITM")}
                  dropdownKey={`${row.id}-moneyness`}
                  openId={portfolioDropdownId}
                  setOpenId={setPortfolioDropdownId}
                  minWidth={90}
                />
              </div>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "flex-start",
                  gap: t.spacing(1),
                }}
              >
                <HelpTooltip
                  theme={t}
                  text="How far OTM or ITM you want the strike, as a percent of current price."
                >
                  <label style={labelStyle}>{row.moneyness ?? "OTM"} %</label>
                </HelpTooltip>
                <input
                  type="number"
                  min={0}
                  step={0.5}
                  style={{ ...inputStyle, maxWidth: 70 }}
                  value={row.otmPct || ""}
                  onChange={(e) => updatePortfolioRow(row.id, "otmPct", Number(e.target.value) || 0)}
                  placeholder="10"
                  aria-label={`${row.moneyness} percent`}
                />
              </div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: t.spacing(1) }}>
                <HelpTooltip
                  theme={t}
                  text="If checked, only monthly expirations are considered instead of all weeklys."
                >
                  <label
                    htmlFor={`monthly-${row.id}`}
                    style={{ ...labelStyle, marginBottom: 0, textTransform: "none" }}
                  >
                    Monthly
                  </label>
                </HelpTooltip>
                <input
                  type="checkbox"
                  id={`monthly-${row.id}`}
                  checked={row.monthly}
                  onChange={(e) => updatePortfolioRow(row.id, "monthly", e.target.checked)}
                  aria-label="Monthly expiration only"
                />
              </div>
              {portfolioRows.length > 1 && (
                <button
                  type="button"
                  onClick={() => removePortfolioRow(row.id)}
                  style={{ ...secondaryBtnStyle, padding: `${t.spacing(1)} ${t.spacing(2)}`, fontSize: "0.8rem" }}
                  aria-label="Remove row"
                >
                  Remove
                </button>
              )}
            </div>
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: t.spacing(3), marginTop: t.spacing(3), flexWrap: "wrap" }}>
          <button
            type="button"
            style={{
              ...primaryBtn,
              display: "inline-flex",
              alignItems: "center",
              gap: t.spacing(2),
            }}
            onClick={runOptimize}
            disabled={optimizeLoading}
            aria-label="Optimize portfolio"
          >
            {optimizeLoading ? "Optimizing…" : "Optimize portfolio"}
            <span className="material-symbols-outlined" style={{ fontSize: 20 }} aria-hidden>
              auto_fix_high
            </span>
          </button>
          <button type="button" style={secondaryBtnStyle} onClick={addPortfolioRow}>
            + Add contract
          </button>
        </div>
        {optimizeMessage && (
          <p style={{ marginTop: t.spacing(3), fontSize: "0.875rem", color: t.colors.danger }}>
            {optimizeMessage}{" "}
            {showSchwabAuthHint && (
              <a
                href={`${SCHWAB_API_BASE}/api/schwab-auth`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: t.colors.primary, fontWeight: t.typography.headingWeight }}
              >
                Click here to reauthorize Schwab and refresh the token.
              </a>
            )}
          </p>
        )}
      </div>

      {/* —— Ranked results —— */}
      {rankedResults && rankedResults.length > 0 && (
        <div
          className="options-optimizer-card"
          style={{
            ...cardStyle,
            position: "relative",
            zIndex: 1,
          }}
        >
          <h3 style={sectionTitleStyle}>Ranked results (yield + upside)</h3>
          <p style={{ fontSize: "0.875rem", color: t.colors.textMuted, marginBottom: t.spacing(2) }}>
            Best options by combined yield and underlying upside. Add any row to your trade list below.
          </p>
          <p style={{ fontSize: "0.85rem", color: t.colors.text, marginBottom: t.spacing(3) }}>
            <strong>Top yield:</strong> {Math.max(...rankedResults.map((r) => r.annYield)).toFixed(1)}%
            {" · "}
            <strong>Avg yield:</strong> {(rankedResults.reduce((s, r) => s + r.annYield, 0) / rankedResults.length).toFixed(1)}%
          </p>
          <div style={{ overflowX: "auto", borderRadius: t.radius.md, border: `1px solid ${t.colors.border}` }}>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: "0.875rem",
                overflow: "hidden",
                borderRadius: t.radius.md,
              }}
            >
              <thead>
                <tr style={{ borderBottom: `2px solid ${t.colors.border}`, backgroundColor: t.colors.secondary }}>
                  <th style={{ textAlign: "left", padding: t.spacing(2), color: "#FFFFFF", fontWeight: 600, borderTopLeftRadius: t.radius.md }}>Rank</th>
                  <th style={{ textAlign: "left", padding: t.spacing(2), color: "#FFFFFF", fontWeight: 600 }}>Ticker</th>
                  <th style={{ textAlign: "left", padding: t.spacing(2), color: "#FFFFFF", fontWeight: 600 }}>Maturity</th>
                  <th style={{ textAlign: "left", padding: t.spacing(2), color: "#FFFFFF", fontWeight: 600 }}>Type</th>
                  <th style={{ textAlign: "center", padding: t.spacing(2), color: "#FFFFFF", fontWeight: 600 }}>1M Upside %</th>
                  <th style={{ textAlign: "right", padding: t.spacing(2), color: "#FFFFFF", fontWeight: 600 }}>Strike</th>
                  <th style={{ textAlign: "right", padding: t.spacing(2), color: "#FFFFFF", fontWeight: 600 }}>Bid</th>
                  <th style={{ textAlign: "right", padding: t.spacing(2), color: "#FFFFFF", fontWeight: 600 }}>Ann. Yield</th>
                  <th style={{ textAlign: "center", padding: t.spacing(2), color: "#FFFFFF", fontWeight: 600 }}>Premium / contract</th>
                  <th style={{ textAlign: "center", padding: t.spacing(2), color: "#FFFFFF", fontWeight: 600, borderTopRightRadius: t.radius.md }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {rankedResults.map((r) => (
                  <tr
                    key={r.trade.id}
                    style={{ borderBottom: `1px solid ${t.colors.border}` }}
                  >
                    <td
                      style={{
                        padding: t.spacing(2),
                        fontWeight: 600,
                        color:
                          r.rank === 1
                            ? "#D4AF37" // gold
                            : r.rank === 2
                              ? "#C0C0C0" // silver
                              : r.rank === 3
                                ? "#CD7F32" // bronze
                                : t.colors.text,
                      }}
                    >
                      #{r.rank}
                    </td>
                    <td style={{ padding: t.spacing(2), fontWeight: 600, color: t.colors.text }}>{r.ticker}</td>
                    <td style={{ padding: t.spacing(2), fontSize: "0.8rem", color: t.colors.text }}>
                      {r.trade.maturity}
                    </td>
                    <td style={{ padding: t.spacing(2), color: t.colors.text }}>
                      {r.trade.optionSide.startsWith("PUT") ? "Put" : "Call"}
                    </td>
                    <td
                      style={{
                        padding: t.spacing(2),
                        textAlign: "center",
                        color: r.upsidePct >= 0 ? t.colors.success : t.colors.danger,
                      }}
                    >
                      {r.upsidePct >= 0 ? "+" : ""}{r.upsidePct}%
                    </td>
                    <td style={{ padding: t.spacing(2), textAlign: "right" }}>${r.strike.toFixed(2)}</td>
                    <td style={{ padding: t.spacing(2), textAlign: "right" }}>${r.bid.toFixed(2)}</td>
                    <td style={{ padding: t.spacing(2), textAlign: "right", color: t.colors.success, fontWeight: 600 }}>
                      {r.annYield}%
                    </td>
                    <td style={{ padding: t.spacing(2), textAlign: "center" }}>${r.premiumPerContract.toFixed(0)}</td>
                    <td style={{ padding: t.spacing(2), textAlign: "center" }}>
                      <div style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: t.spacing(3) }}>
                        <button
                          type="button"
                          onClick={() => addToTradeList(r)}
                          title="Add to trade list"
                          aria-label="Add to trade list"
                          className="options-optimizer-add-trade"
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            width: 34,
                            height: 34,
                            padding: 0,
                            border: "none",
                            background: "none",
                            cursor: "pointer",
                            color: t.colors.primary,
                            borderRadius: "50%",
                          }}
                        >
                          <span
                            className="material-symbols-outlined"
                            style={{
                              fontSize: 24,
                              position: "absolute",
                              opacity: lastAddedTradeId === r.trade.id ? 0 : 1,
                              transition: "opacity 0.2s ease",
                              pointerEvents: "none",
                            }}
                            aria-hidden
                          >
                            add_circle
                          </span>
                          <span
                            className="material-symbols-outlined"
                            style={{
                              fontSize: 24,
                              position: "absolute",
                              opacity: lastAddedTradeId === r.trade.id ? 1 : 0,
                              transition: "opacity 0.2s ease",
                              pointerEvents: "none",
                            }}
                            aria-hidden
                          >
                            check_circle
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const text = formatSchwabSymbol(r.trade);
                            void navigator.clipboard.writeText(text);
                            setLastCopiedTradeId(r.trade.id);
                            window.setTimeout(
                              () =>
                                setLastCopiedTradeId((prev) =>
                                  prev === r.trade.id ? null : prev
                                ),
                              1200
                            );
                          }}
                          title="Copy Schwab symbol"
                          aria-label="Copy Schwab symbol"
                          className="options-optimizer-copy-symbol"
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            width: 34,
                            height: 34,
                            padding: 0,
                            border: "none",
                            background: "none",
                            cursor: "pointer",
                            color: t.colors.textMuted,
                            borderRadius: t.radius.sm,
                            position: "relative",
                          }}
                        >
                          <span
                            className="material-symbols-outlined"
                            style={{
                              fontSize: 22,
                              position: "absolute",
                              opacity: lastCopiedTradeId === r.trade.id ? 0 : 1,
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
                              opacity: lastCopiedTradeId === r.trade.id ? 1 : 0,
                              transition: "opacity 0.2s ease",
                              pointerEvents: "none",
                            }}
                            aria-hidden
                          >
                            check
                          </span>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* —— Trade list —— */}
      <div
        className="options-optimizer-card"
        style={{
          ...cardStyle,
          position: "relative",
          zIndex: 1,
        }}
      >
        <h3 style={sectionTitleStyle}>Trade list</h3>
        <div style={{ display: "flex", alignItems: "center", gap: t.spacing(3), marginBottom: t.spacing(4), flexWrap: "wrap" }}>
          {trades.length > 0 && (
            <span style={{ fontSize: "0.875rem", color: t.colors.textMuted }}>
              {trades.length} trade{trades.length !== 1 ? "s" : ""}
            </span>
          )}
        </div>

        {trades.length === 0 && (
          <div
            style={{
              padding: t.spacing(6),
              textAlign: "center",
              color: t.colors.textMuted,
              border: `1px dashed ${t.colors.border}`,
              borderRadius: t.radius.md,
              backgroundColor: t.colors.background,
            }}
          >
            <p style={{ margin: 0, fontSize: "0.95rem" }}>
              No trades yet. Run Optimize above, then use “Add to list” on any ranked result.
            </p>
          </div>
        )}

        {trades.map((tr) => (
          <div
            key={tr.id}
            style={{
              ...cardStyle,
              padding: t.spacing(4),
              marginBottom: t.spacing(4),
              backgroundColor: t.colors.background,
              border: `1px solid ${t.colors.border}`,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: t.spacing(2) }}>
              <div style={{ display: "flex", alignItems: "center", gap: t.spacing(3), flexWrap: "wrap" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: t.spacing(0.5) }}>
                  <span style={{ fontSize: "1.125rem", fontWeight: 600, color: t.colors.text }}>{tr.ticker}</span>
                  <span style={{ fontSize: "0.8rem", color: t.colors.textMuted }}>
                    {TICKER_TO_COMPANY[tr.ticker] ?? tr.ticker}
                  </span>
                </div>
                <span
                  style={{
                    fontSize: "0.8rem",
                    padding: `${t.spacing(0.5)} ${t.spacing(2)}`,
                    borderRadius: t.radius.sm,
                    backgroundColor: tr.optionSide.includes("PUT")
                      ? "rgba(34, 197, 94, 0.12)" // green-ish for puts
                      : tr.optionSide.includes("SELL")
                        ? "rgba(234, 179, 8, 0.14)" // amber for call writes
                        : "rgba(59, 130, 246, 0.14)", // blue for call buys
                    color: t.colors.text,
                  }}
                >
                  {tr.optionSide}
                </span>
              </div>
              <button
                type="button"
                onClick={() => removeTrade(tr.id)}
                style={{ ...secondaryBtnStyle, padding: `${t.spacing(1)} ${t.spacing(2)}`, fontSize: "0.8rem" }}
                aria-label="Remove trade"
              >
                Remove
              </button>
            </div>
            <div style={{ marginBottom: t.spacing(3), fontSize: "0.8rem" }}>
              <div style={labelStyle}>Schwab symbol</div>
              <div style={{ fontFamily: "monospace", color: t.colors.text }}>{formatSchwabSymbol(tr)}</div>
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
                gap: t.spacing(4),
              }}
            >
              {/* Economics first */}
              <div>
                <div style={labelStyle}>Premium</div>
                <div
                  style={{
                    ...valueStyle,
                    fontSize: "1.05rem",
                    fontWeight: 600,
                    color: tr.premiumReceived >= 0 ? t.colors.success : t.colors.danger,
                  }}
                >
                  {formatMoney(tr.premiumReceived)}
                </div>
              </div>
              <div>
                <div style={labelStyle}>Annualized yield</div>
                <div
                  style={{
                    ...valueStyle,
                    fontSize: "1.05rem",
                    fontWeight: 600,
                    color:
                      tr.annualizedYieldPct >= 15
                        ? t.colors.success
                        : tr.annualizedYieldPct < 10
                          ? t.colors.danger
                          : t.colors.text,
                  }}
                >
                  {tr.annualizedYieldPct}%
                </div>
              </div>
              <div>
                <div style={labelStyle}>Yield</div>
                <div style={valueStyle}>{tr.yieldAtCurrentPrice}%</div>
              </div>
              <div>
                <div style={labelStyle}>Contracts</div>
                <div style={valueStyle}>{tr.contracts}</div>
              </div>

              {/* Structure and risk */}
              <div>
                <div style={labelStyle}>Maturity</div>
                <div style={valueStyle}>{tr.maturity}</div>
              </div>
              <div>
                <div style={labelStyle}>Days to maturity</div>
                <div style={valueStyle}>{tr.daysToMaturity}</div>
              </div>
              <div>
                <div style={labelStyle}>Strike</div>
                <div style={valueStyle}>${tr.strikePrice.toFixed(2)}</div>
              </div>
              <div>
                <div style={labelStyle}>Current price</div>
                <div style={valueStyle}>${tr.currentPrice.toFixed(2)}</div>
              </div>
              <div>
                <div style={labelStyle}>Moneyness</div>
                <div style={valueStyle}>{tr.moneynessPct}%</div>
              </div>
              <div>
                <div style={labelStyle}>Value of shares at strike</div>
                <div style={valueStyle}>{formatMoney(tr.valueOfSharesAtStrike)}</div>
              </div>

              {/* Execution details */}
              <div>
                <div style={labelStyle}>Limit price</div>
                <div style={{ ...valueStyle, color: t.colors.primary }}>${tr.optionLimitPrice.toFixed(2)}</div>
              </div>
              <div>
                <div style={labelStyle}>Bid / Ask</div>
                <div style={valueStyle}>${tr.currentBid.toFixed(2)} / ${tr.currentAsk.toFixed(2)}</div>
              </div>
              <div>
                <div style={labelStyle}>% off bid</div>
                <div style={valueStyle}>{tr.pctOffBid > 0 ? "+" : ""}{tr.pctOffBid}%</div>
              </div>
            </div>
          </div>
        ))}

        {trades.length > 0 && (
          <div style={{ marginTop: t.spacing(4), paddingTop: t.spacing(4), borderTop: `1px solid ${t.colors.border}` }}>
            <div style={{ ...labelStyle, marginBottom: t.spacing(2) }}>Summary</div>
            <div style={{ display: "flex", gap: t.spacing(6), flexWrap: "wrap" }}>
              <div>
                <div style={labelStyle}>Premium</div>
                <div
                  style={{
                    fontSize: "1.25rem",
                    fontWeight: 600,
                    color: summaryPremium >= 0 ? t.colors.success : t.colors.danger,
                  }}
                >
                  {formatMoney(summaryPremium)}
                </div>
              </div>
              <div>
                <div style={labelStyle}>Total</div>
                <div style={{ fontSize: "1.25rem", fontWeight: 600, color: t.colors.text }}>
                  {formatMoney(summaryTotal)}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
      <footer
        style={{
          marginTop: t.spacing(6),
          paddingTop: t.spacing(3),
          borderTop: `1px solid ${t.colors.border}`,
          fontSize: "0.75rem",
          color: t.colors.textMuted,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: t.spacing(2),
        }}
      >
        <span>Market data provided by Charles Schwab.</span>
        {lastUpdated && (
          <span>
            Data as of{" "}
            {lastUpdated.toLocaleString(undefined, {
              year: "numeric",
              month: "short",
              day: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        )}
      </footer>
    </section>
  );
}
