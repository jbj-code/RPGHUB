import { useState, useCallback, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import type { Theme } from "../theme";
import {
  getFixedRailsLayoutStyles,
  getPrimaryActionButtonStyle,
  getPrimaryButtonStyle,
  getRailFooterActionButtonLayout,
  PAGE_LAYOUT,
  getDropdownTriggerStyle,
  getDropdownPanelStyle,
  getDropdownOptionStyle,
  THEME_DROPDOWN_OPTION_CLASS,
  getTooltipIconStyle,
  getTooltipBubbleStyle,
} from "../theme";
import { SIDEBAR_WIDTH } from "../components/NavBar";

type OptionsOptimizerProps = { theme: Theme; sidebarWidth?: number };

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
  /** ID of the RankedResult row this trade was added from — used to show persistent ✓ in the results table. */
  sourceResultId?: string;
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
  targetMode?: "days" | "expiry";
  days: number;
  targetExpiry?: string; // YYYY-MM-DD
  moneyness: "OTM" | "ITM";
  otmPct: number;
  monthly: boolean;
  currentExpiry?: string; // YYYY-MM-DD
  currentStrike?: number;
  currentContracts?: number;
};

/** One row in the ranked optimization results */
export type RankedResult = {
  rank: number;
  ticker: string;
  company: string;
  upsidePct: number; // e.g. 1M performance; API-friendly alternative to analyst target
  strike: number;
  limitPrice: number;
  annYield: number;
  premiumPerContract: number;
  btcAsk?: number | null;
  netRollPerContract?: number | null;
  netRollAnnualizedPct?: number | null;
  netRollTotal?: number | null;
  rollContractsUsed?: number | null;
  trade: OptionsTrade;
};

export const TICKER_TO_COMPANY: Record<string, string> = {
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

export function makeId(): string {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

function formatMoney(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "−" : "";
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(2)}`;
}

/** Full currency formatting (no K/M compaction) for per-contract premium readability. */
function formatMoneyFull(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "−" : "";
  const isWhole = Math.abs(abs - Math.round(abs)) < 1e-9;
  return `${sign}$${abs.toLocaleString("en-US", {
    minimumFractionDigits: isWhole ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatNotionalCompact(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "−" : "";
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) {
    const k = (abs / 1_000).toFixed(1).replace(/\.0$/, "");
    return `${sign}$${k}K`;
  }
  return `${sign}$${abs.toFixed(0)}`;
}

function formatPrice(n: number): string {
  return Number.isInteger(n) ? `$${n.toFixed(0)}` : `$${n.toFixed(2)}`;
}

/** Schwab-style symbol: TICKER MM/DD/YYYY Strike C|P */
export function formatSchwabSymbol(tr: OptionsTrade): string {
  const d = new Date(tr.maturity + "Z");
  const mm = (d.getUTCMonth() + 1).toString().padStart(2, "0");
  const dd = d.getUTCDate().toString().padStart(2, "0");
  const yyyy = d.getUTCFullYear();
  const type = tr.optionSide.startsWith("PUT") ? "P" : "C";
  const strike = Math.round(tr.strikePrice) === tr.strikePrice ? tr.strikePrice.toString() : tr.strikePrice.toFixed(2);
  return `${tr.ticker} ${mm}/${dd}/${yyyy} ${strike} ${type}`;
}

/** Bloomberg-style option key: TICKER US MM/DD/YY C|P Strike Equity */
export function formatOptionKey(tr: OptionsTrade): string {
  const d = new Date(tr.maturity + "Z");
  const mm = (d.getUTCMonth() + 1).toString().padStart(2, "0");
  const dd = d.getUTCDate().toString().padStart(2, "0");
  const yy = d.getUTCFullYear().toString().slice(-2);
  const type = tr.optionSide.startsWith("PUT") ? "P" : "C";
  const strike = Math.round(tr.strikePrice) === tr.strikePrice ? tr.strikePrice.toString() : tr.strikePrice.toFixed(2);
  return `${tr.ticker} US ${mm}/${dd}/${yy} ${type}${strike} Equity`;
}

/** Sortable numeric columns in the ranked-results table (three-state: default → asc → desc). */
type OptimizerTableSortKey =
  | "maturity"
  | "strike"
  | "moneyness"
  | "limitPx"
  | "annYield"
  | "premiumPerContract";

type OptimizerTableSortState =
  | { phase: "none" }
  | { phase: "asc" | "desc"; key: OptimizerTableSortKey };

function getMoneynessPctForSort(r: RankedResult): number | null {
  const m = r.trade.moneynessPct;
  return typeof m === "number" && Number.isFinite(m) ? m : null;
}

function getMaturitySortValue(r: RankedResult): number {
  const dte = r.trade.daysToMaturity;
  if (Number.isFinite(dte) && dte >= 0) return dte;
  const raw = r.trade.maturity;
  const d = new Date(raw.endsWith("Z") ? raw : `${raw}Z`);
  const t = d.getTime();
  return Number.isFinite(t) ? t : 0;
}

export function formatRankedRowForCopy(r: RankedResult, rollMode: boolean): string {
  const values: string[] = [
    String(r.rank),
    r.ticker,
    r.trade.maturity,
    r.trade.optionSide.startsWith("PUT") ? "Put" : "Call",
    `${r.upsidePct}`,
    r.strike.toFixed(2),
    r.limitPrice.toFixed(2),
  ];

  if (rollMode) {
    values.push(
      r.btcAsk != null ? r.btcAsk.toFixed(2) : "",
      r.netRollPerContract != null ? r.netRollPerContract.toFixed(2) : "",
      r.netRollTotal != null ? r.netRollTotal.toFixed(2) : ""
    );
  }

  values.push(
    r.annYield.toFixed(2),
    r.premiumPerContract.toFixed(2),
    formatSchwabSymbol(r.trade),
    formatOptionKey(r.trade)
  );

  // Tab-separated row for direct paste across spreadsheet cells.
  return values.join("\t");
}



const defaultPortfolioRow = (): PortfolioRow => ({
  id: makeId(),
  ticker: "",
  putCall: "Put",
  action: "Sell to Open",
  type: "Qty",
  value: 0,
  targetMode: "days",
  days: 30,
  targetExpiry: "",
  moneyness: "OTM",
  otmPct: 10,
  monthly: false,
  currentExpiry: "",
  currentStrike: 0,
  currentContracts: 0,
});

type HelpTooltipProps = { theme: Theme; text: string; children: React.ReactNode };

function HelpTooltip({ theme: t, text, children }: HelpTooltipProps) {
  const [open, setOpen] = useState(false);
  const [mouse, setMouse] = useState<{ x: number; y: number } | null>(null);

  function handleMouseEnter(e: React.MouseEvent) {
    setMouse({ x: e.clientX, y: e.clientY });
    setOpen(true);
  }

  function handleMouseMove(e: React.MouseEvent) {
    setMouse({ x: e.clientX, y: e.clientY });
  }

  const tooltipWidth = 280;
  const offsetY = 22; // gap below cursor — enough to clear the pointer tip

  const left = mouse
    ? Math.max(8, Math.min(mouse.x - tooltipWidth / 2, window.innerWidth - tooltipWidth - 8))
    : 0;
  const top = mouse ? mouse.y + offsetY : 0;

  return (
    <span
      style={{ display: "inline-flex" }}
      onMouseEnter={handleMouseEnter}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => setOpen(false)}
      onFocus={(e) => { setMouse({ x: e.currentTarget.getBoundingClientRect().left, y: e.currentTarget.getBoundingClientRect().bottom }); setOpen(true); }}
      onBlur={() => setOpen(false)}
    >
      {children}
      {open && mouse && createPortal(
        <div
          style={{
            ...getTooltipBubbleStyle(t),
            position: "fixed",
            top,
            left,
            marginTop: 0,
            maxWidth: tooltipWidth,
            minWidth: 180,
            whiteSpace: "normal",
            zIndex: 9999,
            pointerEvents: "none",
            fontFamily: t.typography.fontFamily,
          }}
          role="tooltip"
        >
          {text}
        </div>,
        document.body
      )}
    </span>
  );
}

type SortableOptimizerThProps = {
  theme: Theme;
  sortKey: OptimizerTableSortKey;
  tableSort: OptimizerTableSortState;
  onCycle: (key: OptimizerTableSortKey) => void;
  label: string;
  textAlign: "left" | "right" | "center";
  helpText?: string;
};

function SortableOptimizerTh({
  theme: t,
  sortKey,
  tableSort,
  onCycle,
  label,
  textAlign,
  helpText,
}: SortableOptimizerThProps) {
  const active = tableSort.phase !== "none" && tableSort.key === sortKey;
  const ariaSort =
    !active ? "none" : tableSort.phase === "asc" ? "ascending" : "descending";

  const justify =
    textAlign === "right" ? "flex-end" : textAlign === "center" ? "center" : "flex-start";

  const btn = (
    <button
      type="button"
      className="options-optimizer-sort-th-btn"
      onClick={() => onCycle(sortKey)}
      title="Sort: default order → ascending → descending"
      style={{
        background: "none",
        border: "none",
        color: "#FFFFFF",
        fontWeight: 600,
        cursor: "pointer",
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: 0,
        font: "inherit",
        textAlign,
        maxWidth: "100%",
        borderRadius: 4,
      }}
    >
      <span>{label}</span>
      {active && (
        <span
          className="material-symbols-outlined"
          style={{ fontSize: 18, lineHeight: 1, opacity: 0.95 }}
          aria-hidden
        >
          {tableSort.phase === "asc" ? "arrow_upward" : "arrow_downward"}
        </span>
      )}
    </button>
  );

  return (
    <th
      aria-sort={ariaSort}
      style={{
        textAlign,
        padding: t.spacing(2),
        color: "#FFFFFF",
        fontWeight: 600,
        verticalAlign: "middle",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: justify,
          gap: 6,
          flexWrap: "wrap",
        }}
      >
        {btn}
        {helpText ? (
          <HelpTooltip theme={t} text={helpText}>
            <span
              style={{ ...getTooltipIconStyle(t), cursor: "help", flexShrink: 0 }}
              className="material-symbols-outlined"
              tabIndex={0}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") e.stopPropagation();
              }}
            >
              info
            </span>
          </HelpTooltip>
        ) : null}
      </div>
    </th>
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

export function OptionsOptimizer({ theme: t, sidebarWidth = SIDEBAR_WIDTH }: OptionsOptimizerProps) {
  const [portfolioRows, setPortfolioRows] = useState<PortfolioRow[]>([defaultPortfolioRow()]);
  const [portfolioDropdownId, setPortfolioDropdownId] = useState<string | null>(null);
  const [otmVariancePct, setOtmVariancePct] = useState(5);
  const [rankedResults, setRankedResults] = useState<RankedResult[] | null>(null);
  const [optimizerTableSort, setOptimizerTableSort] = useState<OptimizerTableSortState>({
    phase: "none",
  });
  const [optimizeMessage, setOptimizeMessage] = useState<string | null>(null);
  const [optimizeLoading, setOptimizeLoading] = useState(false);
  const [trades, setTrades] = useState<OptionsTrade[]>([]);
  const [showOptimizeForModal, setShowOptimizeForModal] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [lastAddedTradeId, setLastAddedTradeId] = useState<string | null>(null);
  const [lastCopiedTradeId, setLastCopiedTradeId] = useState<string | null>(null);
  const [expandedTradeId, setExpandedTradeId] = useState<string | null>(null);

  useEffect(() => {
    if (!showOptimizeForModal) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowOptimizeForModal(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [showOptimizeForModal]);

  const addPortfolioRow = useCallback(() => {
    setPortfolioRows((prev) => [defaultPortfolioRow(), ...prev]);
  }, []);

  const removePortfolioRow = useCallback((id: string) => {
    setPortfolioRows((prev) => (prev.length > 1 ? prev.filter((r) => r.id !== id) : prev));
  }, []);

  const cycleOptimizerTableSort = useCallback((key: OptimizerTableSortKey) => {
    setOptimizerTableSort((prev) => {
      if (prev.phase === "none" || prev.key !== key) return { phase: "asc", key };
      if (prev.phase === "asc") return { phase: "desc", key };
      return { phase: "none" };
    });
  }, []);

  const displayedRankedResults = useMemo(() => {
    if (!rankedResults || rankedResults.length === 0) return rankedResults ?? [];
    if (optimizerTableSort.phase === "none") return rankedResults;

    const arr = [...rankedResults];
    const sign = optimizerTableSort.phase === "asc" ? 1 : -1;
    const key = optimizerTableSort.key;

    arr.sort((a, b) => {
      let cmp = 0;
      switch (key) {
        case "maturity": {
          const va = getMaturitySortValue(a);
          const vb = getMaturitySortValue(b);
          cmp = va === vb ? 0 : va < vb ? -1 : 1;
          break;
        }
        case "strike":
          cmp = a.strike === b.strike ? 0 : a.strike < b.strike ? -1 : 1;
          break;
        case "moneyness": {
          const oa = getMoneynessPctForSort(a);
          const ob = getMoneynessPctForSort(b);
          if (oa == null && ob == null) cmp = 0;
          else if (oa == null) cmp = 1;
          else if (ob == null) cmp = -1;
          else cmp = oa === ob ? 0 : oa < ob ? -1 : 1;
          break;
        }
        case "limitPx":
          cmp = a.limitPrice === b.limitPrice ? 0 : a.limitPrice < b.limitPrice ? -1 : 1;
          break;
        case "annYield":
          cmp = a.annYield === b.annYield ? 0 : a.annYield < b.annYield ? -1 : 1;
          break;
        case "premiumPerContract":
          cmp =
            a.premiumPerContract === b.premiumPerContract
              ? 0
              : a.premiumPerContract < b.premiumPerContract
                ? -1
                : 1;
          break;
        default:
          cmp = 0;
      }
      return cmp * sign;
    });
    return arr;
  }, [rankedResults, optimizerTableSort]);

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
          assignmentAwareRanking: true,
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
      setOptimizerTableSort({ phase: "none" });
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
    const trade = { ...result.trade, id: makeId(), sourceResultId: result.trade.id };
    setTrades((prev) => [...prev, trade]);
    // Brief flash animation — the persistent ✓ is derived from the trades array below.
    setLastAddedTradeId(result.trade.id);
    window.setTimeout(() => {
      setLastAddedTradeId((prev) => (prev === result.trade.id ? null : prev));
    }, 800);
  }, []);

  const removeTrade = useCallback((id: string) => {
    setTrades((prev) => prev.filter((tr) => tr.id !== id));
  }, []);

  // Set of result IDs currently in the trade list — drives the persistent ✓ on the ranked row.
  const addedResultIds = useMemo(
    () => new Set(trades.map((tr) => tr.sourceResultId).filter(Boolean) as string[]),
    [trades]
  );

  const summaryPremium = trades.reduce((sum, tr) => sum + tr.premiumReceived, 0);
  const summaryTotal = trades.reduce((sum, tr) => sum + tr.valueOfSharesAtStrike, 0);

  const showSchwabAuthHint =
    !!optimizeMessage &&
    (optimizeMessage.includes("Schwab token expired") ||
      optimizeMessage.includes("Not authorized with Schwab"));

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
    fontSize: "0.72rem",
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

  const fixedRails = getFixedRailsLayoutStyles(t, {
    sidebarWidth,
    headerHeight: 104,
  });

  return (
    <section className="options-optimizer-page" style={fixedRails.page}>
      <div
        className="options-optimizer-header-row"
        style={fixedRails.topHeader}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
          <h2 style={titleStyle}>
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
        <p style={{ ...descStyle, marginTop: t.spacing(1), marginBottom: 0 }}>
          Define the tickers and parameters you want, run Optimize to fetch live options from Schwab, then add ideas to your trade list.
        </p>
      </div>

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
              maxWidth: 560,
              width: "90%",
              maxHeight: "85vh",
              overflowY: "auto",
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
            <div style={{ color: t.colors.text, fontSize: "0.88rem", lineHeight: 1.75 }}>

              <p style={{ fontWeight: 700, marginBottom: t.spacing(1), color: t.colors.primary }}>How ranking works</p>
              <p style={{ marginBottom: t.spacing(2) }}>
                Each candidate is scored on three factors and sorted highest to lowest:
              </p>
              <ul style={{ margin: 0, marginBottom: t.spacing(3), paddingLeft: t.spacing(5) }}>
                <li><strong>Annualized Yield (50%)</strong> — premium ÷ strike notional × (365 ÷ DTE). This is the return on actual capital at risk (cash to cover a short put, or shares for a short call), annualized. Higher is better.</li>
                <li><strong>Directional Momentum (50% of base)</strong> — the underlying's trailing ~1-month return (start: daily close from Schwab history; end: same live equity quote snapshot as spot), adjusted for trade direction. Upside helps short puts &amp; long calls; downside helps short calls &amp; long puts. Capped at ±50% so extreme single-month moves don't dominate.</li>
                <li><strong>Risk adjustment</strong> — for short options, we use <strong>Probability of Profit (PoP)</strong> from the Schwab-quoted delta: <em>PoP = (1 − |delta|) × 100</em>. Options above 70% PoP get a score boost; below 50% (near/in-the-money) get a penalty. When Schwab doesn't return a delta, we fall back to tiered OTM-distance penalties.</li>
              </ul>

              <p style={{ fontWeight: 700, marginBottom: t.spacing(1), color: t.colors.primary }}>Understanding the columns</p>
              <ul style={{ margin: 0, marginBottom: t.spacing(3), paddingLeft: t.spacing(5) }}>
                <li><strong>1M Performance</strong> — ~1-month total return: baseline close from daily history vs current price from the equity quote at request time (directional context for ranking).</li>
                <li><strong>Moneyness</strong> — strike ÷ spot × 100, using the same underlying quote snapshot as the rest of the run. �� Below 100% is typically OTM for puts; above 100% is typically OTM for calls. At-the-money is near 100%.</li>
                <li><strong>Limit Px</strong> — midpoint of the Schwab bid/ask. This is your target fill price; real fills may differ.</li>
                <li><strong>Ann. Yield</strong> — annualized yield based on strike notional (see above).</li>
                <li><strong>PoP</strong> — probability the option expires worthless (you keep the full premium). Derived from delta: higher is better for short options.</li>
                <li><strong>Premium</strong> — limit price × 100 × contracts. Positive = cash you receive (sell to open); negative = cash you pay (buy to open).</li>
              </ul>

              <p style={{ fontWeight: 700, marginBottom: t.spacing(1), color: t.colors.primary }}>Trade types</p>
              <ul style={{ margin: 0, marginBottom: t.spacing(3), paddingLeft: t.spacing(5) }}>
                <li><strong>Sell to Open</strong> — generates premium income. You take on the obligation to buy (put) or sell (call) shares if assigned. The optimizer scores these most often.</li>
                <li><strong>Buy to Open</strong> — pays premium upfront. Requires directional conviction. The momentum signal is automatically flipped to match your intended direction.</li>
                <li><strong>Sell/Buy to Close</strong> — exits an existing position. Useful for rolling analysis.</li>
              </ul>

              <p style={{ fontWeight: 700, marginBottom: t.spacing(1), color: t.colors.primary }}>Assignment-aware ranking</p>
              <p style={{ marginBottom: 0 }}>
                Always on. Short puts near or below the current price carry meaningful assignment risk—you could be obligated to buy shares at the strike. The PoP score naturally penalises these by rewarding high-delta-distance (deeply OTM) options. The same logic applies to short calls: ITM calls risk having your position exercised against you.
              </p>

            </div>
          </div>
        </>
      )}

      {/* —— Portfolio Tickers (Define what you want) —— */}
      <aside
        style={{
          ...fixedRails.leftRail,
          zIndex: portfolioDropdownId ? 3000 : 6,
        }}
      >
        <div
          className="options-optimizer-card"
          style={{
            ...fixedRails.railPanel,
            overflow: "visible",
            minHeight: 0,
            flex: 1,
          }}
        >
        <h3 style={sectionTitleStyle}>Inputs</h3>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: t.spacing(3),
            overflowY: "auto",
            overflowX: "hidden",
            flex: 1,
            scrollbarWidth: "none",
          }}
        >
          {portfolioRows.map((row) => {
            const rowTicker = row.ticker.trim().toUpperCase();
            const isOptimized =
              !!rankedResults &&
              rankedResults.length > 0 &&
              rowTicker.length > 0 &&
              rankedResults.some((r) => r.ticker === rowTicker);
            return (
            <div
              key={row.id}
              style={{
                position: "relative",
                display: "flex",
                flexWrap: "wrap",
                alignItems: "flex-end",
                gap: t.spacing(3),
                padding: t.spacing(3),
                paddingTop: portfolioRows.length > 1 ? t.spacing(5) : t.spacing(3),
                backgroundColor: isOptimized
                  ? `${t.colors.primary}22`
                  : t.colors.background,
                borderRadius: t.radius.md,
                border: `1px solid ${t.colors.border}`,
              }}
            >
              {portfolioRows.length > 1 && (
                <button
                  type="button"
                  onClick={() => removePortfolioRow(row.id)}
                  style={{
                    position: "absolute",
                    top: t.spacing(1.5),
                    right: t.spacing(1.5),
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 22,
                    height: 22,
                    padding: 0,
                    border: "none",
                    background: "none",
                    cursor: "pointer",
                    color: t.colors.danger,
                    borderRadius: "50%",
                  }}
                  aria-label="Remove row"
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 18 }} aria-hidden>close</span>
                </button>
              )}
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
              {/* Type + Value side-by-side */}
              <div style={{ display: "flex", gap: t.spacing(2), alignItems: "flex-end" }}>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: t.spacing(1) }}>
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
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: t.spacing(1) }}>
                  <HelpTooltip
                    theme={t}
                    text="If Type is Qty, this is contracts. If Notional, this is target notional of underlying at strike."
                  >
                    <label style={labelStyle}>Value</label>
                  </HelpTooltip>
                  {row.type === "Notional" ? (
                    <input
                      type="text"
                      inputMode="numeric"
                      style={{ ...inputStyle, maxWidth: 90 }}
                      value={row.value > 0 ? Math.round(row.value).toLocaleString("en-US") : ""}
                      onChange={(e) => {
                        const digits = e.target.value.replace(/[^\d]/g, "");
                        updatePortfolioRow(row.id, "value", digits ? Number(digits) : 0);
                      }}
                      placeholder="0"
                      aria-label="Value"
                    />
                  ) : (
                    <input
                      type="number"
                      min={0}
                      style={{ ...inputStyle, maxWidth: 90 }}
                      value={row.value || ""}
                      onChange={(e) => updatePortfolioRow(row.id, "value", Number(e.target.value) || 0)}
                      placeholder="0"
                      aria-label="Value"
                    />
                  )}
                </div>
              </div>
              <div
                style={{
                  display: "flex",
                  flexDirection: "row",
                  alignItems: "flex-end",
                  gap: t.spacing(1),
                }}
              >
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: t.spacing(1) }}>
                  <label style={labelStyle}>Target by</label>
                  <OptimizerThemeSelect
                    theme={t}
                    value={row.targetMode ?? "days"}
                    options={[
                      { value: "days", label: "Days (DTE)" },
                      { value: "expiry", label: "Expiry date" },
                    ]}
                    onChange={(v) => updatePortfolioRow(row.id, "targetMode", v as "days" | "expiry")}
                    dropdownKey={`${row.id}-targetMode`}
                    openId={portfolioDropdownId}
                    setOpenId={setPortfolioDropdownId}
                    minWidth={120}
                  />
                </div>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: t.spacing(1) }}>
                  {(row.targetMode ?? "days") === "days" ? (
                    <>
                      <HelpTooltip
                        theme={t}
                        text="Target days to expiration for this leg. Optimizer will look near this DTE."
                      >
                        <label style={labelStyle}>Days (DTE)</label>
                      </HelpTooltip>
                      <input
                        type="number"
                        min={1}
                        style={{ ...inputStyle, maxWidth: 90 }}
                        value={row.days || ""}
                        onChange={(e) => updatePortfolioRow(row.id, "days", Number(e.target.value) || 0)}
                        placeholder="30"
                        aria-label="Days to expiration"
                      />
                    </>
                  ) : (
                    <>
                      <HelpTooltip
                        theme={t}
                        text="Exact expiration date for this row. Optimizer will query this specific expiry."
                      >
                        <label style={labelStyle}>Expiry date</label>
                      </HelpTooltip>
                      <input
                        type="date"
                        style={{ ...inputStyle, maxWidth: 150 }}
                        value={row.targetExpiry ?? ""}
                        onChange={(e) => updatePortfolioRow(row.id, "targetExpiry", e.target.value)}
                        aria-label="Target expiry date"
                      />
                    </>
                  )}
                </div>
              </div>
              {/* OTM/ITM · OTM % · Variance % — all on one row */}
              <div style={{ display: "flex", gap: t.spacing(2), alignItems: "flex-end" }}>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: t.spacing(1) }}>
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
                    minWidth={72}
                  />
                </div>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: t.spacing(1) }}>
                  <HelpTooltip
                    theme={t}
                    text="How far OTM or ITM you want the strike, as a percent of current price."
                  >
                    <label style={labelStyle}>{row.moneyness ?? "OTM"}</label>
                  </HelpTooltip>
                  <input
                    type="text"
                    inputMode="decimal"
                    style={{ ...inputStyle, maxWidth: 62, minWidth: 52 }}
                    value={row.otmPct > 0 ? `${row.otmPct}%` : ""}
                    onChange={(e) => {
                      const raw = e.target.value.replace(/%/g, "");
                      updatePortfolioRow(row.id, "otmPct", Number(raw) || 0);
                    }}
                    placeholder="0%"
                    aria-label={`${row.moneyness} percent`}
                  />
                </div>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: t.spacing(1) }}>
                  <HelpTooltip
                    theme={t}
                    text="How wide a strike range to search around your OTM/ITM target."
                  >
                    <label style={labelStyle}>Variance</label>
                  </HelpTooltip>
                  <input
                    type="text"
                    inputMode="decimal"
                    style={{ ...inputStyle, maxWidth: 62, minWidth: 52 }}
                    value={otmVariancePct > 0 ? `${otmVariancePct}%` : ""}
                    onChange={(e) => {
                      const raw = e.target.value.replace(/%/g, "");
                      setOtmVariancePct(Number(raw) || 0);
                    }}
                    placeholder="0%"
                    aria-label="Variance percent"
                  />
                </div>
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
            </div>
            );
          })}
        </div>
        <div
          style={{
            ...fixedRails.railFooter,
            marginTop: t.spacing(3),
            display: "flex",
            flexDirection: "column",
            gap: t.spacing(2),
            position: "sticky",
            bottom: 0,
            zIndex: 2,
          }}
        >
          <button
            type="button"
            style={{ ...secondaryBtnStyle, ...getRailFooterActionButtonLayout() }}
            onClick={addPortfolioRow}
          >
            + Add Contract
          </button>
          <button
            type="button"
            style={{ ...primaryBtn, ...getRailFooterActionButtonLayout() }}
            onClick={runOptimize}
            disabled={optimizeLoading}
            aria-label="Optimize Portfolio"
          >
            {optimizeLoading ? (
              <>
                <span className="options-pricing-fetch-spinner" aria-hidden />
                Optimizing…
              </>
            ) : (
              "Optimize Portfolio"
            )}
          </button>
          {optimizeMessage && (
            <p style={{ margin: 0, fontSize: "0.85rem", color: t.colors.danger }}>
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
        </div>
      </aside>

      <div style={fixedRails.contentWrap}>
      {/* —— Ranked results —— */}
      {rankedResults && (
        <div
          className="options-optimizer-card"
          style={{
            ...cardStyle,
            position: "relative",
            zIndex: 1,
          }}
        >
          <h3 style={sectionTitleStyle}>Ranked results (yield + upside + risk)</h3>
          <p style={{ fontSize: "0.875rem", color: t.colors.textMuted, marginBottom: t.spacing(2) }}>
            Best options by combined yield and underlying upside. Add any row to your trade list below.{" "}
            <strong>Tip:</strong> click <strong>Maturity</strong>, <strong>Strike</strong>, <strong>Moneyness</strong>,{" "}
                    <strong>Limit Px</strong>, <strong>Ann. Yield</strong>, or <strong>Premium</strong> to cycle sort: default
            order → ascending → descending.
          </p>
          {rankedResults.length > 0 && (
            <p style={{ fontSize: "0.85rem", color: t.colors.text, marginBottom: t.spacing(3) }}>
              <strong>Top yield:</strong> {Math.max(...rankedResults.map((r) => r.annYield)).toFixed(1)}%
              {" · "}
              <strong>Avg yield:</strong> {(rankedResults.reduce((s, r) => s + r.annYield, 0) / rankedResults.length).toFixed(1)}%
            </p>
          )}
          {rankedResults.length === 0 && (
            <p style={{ fontSize: "0.9rem", color: t.colors.danger, marginBottom: t.spacing(3), fontWeight: 600 }}>
              {optimizeMessage ?? "No candidates matched your settings."}
            </p>
          )}
          {rankedResults.length > 0 && (
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
                  <SortableOptimizerTh
                    theme={t}
                    sortKey="maturity"
                    tableSort={optimizerTableSort}
                    onCycle={cycleOptimizerTableSort}
                    label="Maturity"
                    textAlign="left"
                  />
                  <th style={{ textAlign: "left", padding: t.spacing(2), color: "#FFFFFF", fontWeight: 600 }}>Type</th>
                  <th style={{ textAlign: "center", padding: t.spacing(2), color: "#FFFFFF", fontWeight: 600 }}>
                    <HelpTooltip
                      theme={t}
                      text="1M Performance is ~1-month total return: start from Schwab daily history (close on/after ~1 month ago), end from the live equity quote at request time (same snapshot as spot). Used in ranking."
                    >
                      <span style={{ cursor: "help" }}>1M Performance</span>
                    </HelpTooltip>
                  </th>
                  <SortableOptimizerTh
                    theme={t}
                    sortKey="strike"
                    tableSort={optimizerTableSort}
                    onCycle={cycleOptimizerTableSort}
                    label="Strike"
                    textAlign="right"
                  />
                  <SortableOptimizerTh
                    theme={t}
                    sortKey="moneyness"
                    tableSort={optimizerTableSort}
                    onCycle={cycleOptimizerTableSort}
                    label="Moneyness"
                    textAlign="center"
                  />
                  <SortableOptimizerTh
                    theme={t}
                    sortKey="limitPx"
                    tableSort={optimizerTableSort}
                    onCycle={cycleOptimizerTableSort}
                    label="Limit Px"
                    textAlign="center"
                  />
                  <SortableOptimizerTh
                    theme={t}
                    sortKey="annYield"
                    tableSort={optimizerTableSort}
                    onCycle={cycleOptimizerTableSort}
                    label="Ann. Yield"
                    textAlign="center"
                  />
                  <th style={{ textAlign: "center", padding: t.spacing(2), color: "#FFFFFF", fontWeight: 600 }}>
                    <HelpTooltip
                      theme={t}
                      text="Probability of Profit = (1 − |delta|) × 100. Delta is sourced from the Schwab option quote. For a short option, |delta| ≈ probability of expiring in-the-money (against you), so 1 − |delta| is the probability of keeping the full premium."
                    >
                      <span style={{ cursor: "help" }}>PoP</span>
                    </HelpTooltip>
                  </th>
                  <SortableOptimizerTh
                    theme={t}
                    sortKey="premiumPerContract"
                    tableSort={optimizerTableSort}
                    onCycle={cycleOptimizerTableSort}
                    label="Premium"
                    textAlign="center"
                  />
                  <th style={{ textAlign: "center", padding: t.spacing(2), color: "#FFFFFF", fontWeight: 600, borderTopRightRadius: t.radius.md }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {displayedRankedResults.map((r) => (
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
                    <td style={{ padding: t.spacing(2), textAlign: "right" }}>{formatPrice(r.strike)}</td>
                    <td
                      style={{
                        padding: t.spacing(2),
                        textAlign: "center",
                        color: (() => {
                          const spot = r.trade.currentPrice;
                          const m = r.trade.moneynessPct;
                          if (!Number.isFinite(spot) || spot <= 0 || !Number.isFinite(m)) return t.colors.textMuted;
                          const isPut = r.trade.optionSide.startsWith("PUT");
                          const otm = isPut ? m < 100 : m > 100;
                          return otm ? t.colors.success : t.colors.danger;
                        })(),
                        fontWeight: 600,
                      }}
                    >
                      {Number.isFinite(r.trade.moneynessPct) ? `${r.trade.moneynessPct.toFixed(2)}%` : "—"}
                    </td>
                    <td style={{ padding: t.spacing(2), textAlign: "center" }}>${r.limitPrice.toFixed(2)}</td>
                    <td style={{ padding: t.spacing(2), textAlign: "center", color: t.colors.success, fontWeight: 600 }}>
                      {r.annYield}%
                    </td>
                    <td style={{ padding: t.spacing(2), textAlign: "center", fontWeight: 600, color: t.colors.textMuted }}>
                      {r.delta != null
                        ? `${((1 - Math.abs(r.delta)) * 100).toFixed(0)}%`
                        : "—"}
                    </td>
                    <td
                      style={{
                        padding: t.spacing(2),
                        textAlign: "center",
                        color: r.premiumPerContract >= 0 ? t.colors.success : t.colors.danger,
                        fontWeight: 600,
                      }}
                    >
                      {formatMoneyFull(r.premiumPerContract)}
                    </td>
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
                              opacity: addedResultIds.has(r.trade.id) ? 0 : 1,
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
                              opacity: addedResultIds.has(r.trade.id) ? 1 : 0,
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
                            const text = formatRankedRowForCopy(r, false);
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
                          title="Copy row details"
                          aria-label="Copy row details"
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
          )}
        </div>
      )}

      {!rankedResults && (
        <div
          className="options-optimizer-card"
          style={{
            ...cardStyle,
            position: "relative",
            zIndex: 1,
            padding: t.spacing(5),
          }}
        >
          <h3 style={sectionTitleStyle}>Ranked results (yield + upside + risk)</h3>
          <div
            style={{
              marginTop: t.spacing(3),
              padding: t.spacing(6),
              textAlign: "center",
              color: t.colors.textMuted,
              border: `1px dashed ${t.colors.border}`,
              borderRadius: t.radius.md,
              backgroundColor: t.colors.background,
            }}
          >
            Run Optimize to see ranked options candidates here.
          </div>
        </div>
      )}
      <footer
        style={{
          marginTop: t.spacing(6),
          paddingTop: t.spacing(3),
          paddingBottom: t.spacing(6),
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
      </div>

      <aside style={fixedRails.rightRail}>
        <div
          className="page-card"
          style={{
            ...fixedRails.railPanel,
            gap: t.spacing(2),
          }}
        >
          <h3 style={{ ...sectionTitleStyle, marginBottom: t.spacing(1) }}>Trade list</h3>
          {trades.length > 0 && (
            <span style={{ fontSize: "0.875rem", color: t.colors.textMuted }}>
              {trades.length} trade{trades.length !== 1 ? "s" : ""}
            </span>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: t.spacing(2), overflowY: "auto", flex: 1, paddingRight: t.spacing(1) }}>
            {trades.length === 0 && (
              <div
                style={{
                  marginTop: t.spacing(1),
                  padding: t.spacing(4),
                  textAlign: "center",
                  color: t.colors.textMuted,
                  border: `1px dashed ${t.colors.border}`,
                  borderRadius: t.radius.md,
                  backgroundColor: t.colors.background,
                  fontSize: "0.9rem",
                }}
              >
                No trades yet. Add rows from Ranked results.
              </div>
            )}
            {trades.map((tr) => {
              const isExpanded = expandedTradeId === tr.id;
              return (
                <div
                  key={tr.id}
                  style={{
                    marginTop: t.spacing(1),
                    border: `1px solid ${t.colors.border}`,
                    borderRadius: t.radius.md,
                    backgroundColor: t.colors.background,
                  }}
                >
                  {/* Compact header row — always visible, click to expand */}
                  <button
                    type="button"
                    onClick={() => setExpandedTradeId(isExpanded ? null : tr.id)}
                    style={{
                      width: "100%",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: t.spacing(2),
                      padding: t.spacing(2),
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      textAlign: "left",
                    }}
                    aria-expanded={isExpanded}
                  >
                    <div>
                      <div style={{ fontSize: "0.95rem", fontWeight: 600, color: t.colors.text }}>{tr.ticker}</div>
                      <div style={{ fontSize: "0.75rem", color: t.colors.textMuted }}>{tr.optionSide}</div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: t.spacing(1.5), flexShrink: 0 }}>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontSize: "0.8rem", fontWeight: 600, color: tr.premiumReceived >= 0 ? t.colors.success : t.colors.danger }}>{formatMoney(tr.premiumReceived)}</div>
                        <div style={{ fontSize: "0.7rem", color: t.colors.textMuted }}>{tr.annualizedYieldPct}% ann.</div>
                      </div>
                      <span
                        className="material-symbols-outlined"
                        style={{ fontSize: 18, color: t.colors.textMuted, transition: "transform 0.15s", transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)" }}
                        aria-hidden
                      >
                        expand_more
                      </span>
                    </div>
                  </button>

                  {/* Expanded detail */}
                  {isExpanded && (
                    <div style={{ padding: `0 ${t.spacing(2)} ${t.spacing(2)}`, borderTop: `1px solid ${t.colors.border}` }}>
                      <div style={{ marginBottom: t.spacing(2), fontSize: "0.75rem", paddingTop: t.spacing(2) }}>
                        <div style={labelStyle}>Schwab symbol</div>
                        <div style={{ fontFamily: "monospace", color: t.colors.text, fontSize: "0.8rem" }}>{formatSchwabSymbol(tr)}</div>
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: `${t.spacing(2)} ${t.spacing(3)}` }}>
                        <div><div style={labelStyle}>Maturity</div><div style={{ fontSize: "0.8rem", color: t.colors.text }}>{tr.maturity}</div></div>
                        <div><div style={labelStyle}>DTE</div><div style={{ fontSize: "0.8rem", color: t.colors.text }}>{tr.daysToMaturity}</div></div>
                        <div><div style={labelStyle}>Strike</div><div style={{ fontSize: "0.8rem", color: t.colors.text }}>${tr.strikePrice.toFixed(2)}</div></div>
                        <div><div style={labelStyle}>Spot</div><div style={{ fontSize: "0.8rem", color: t.colors.text }}>${tr.currentPrice.toFixed(2)}</div></div>
                        <div><div style={labelStyle}>Limit Px</div><div style={{ fontSize: "0.8rem", color: t.colors.primary }}>${tr.optionLimitPrice.toFixed(2)}</div></div>
                        <div><div style={labelStyle}>Bid / Ask</div><div style={{ fontSize: "0.8rem", color: t.colors.text }}>${tr.currentBid.toFixed(2)} / ${tr.currentAsk.toFixed(2)}</div></div>
                        <div><div style={labelStyle}>Contracts</div><div style={{ fontSize: "0.8rem", color: t.colors.text }}>{tr.contracts}</div></div>
                        <div><div style={labelStyle}>Moneyness</div><div style={{ fontSize: "0.8rem", color: t.colors.text }}>{tr.moneynessPct}%</div></div>
                        <div><div style={labelStyle}>Yield</div><div style={{ fontSize: "0.8rem", color: t.colors.text }}>{tr.yieldAtCurrentPrice}%</div></div>
                        <div><div style={labelStyle}>Notional</div><div style={{ fontSize: "0.8rem", color: t.colors.text }}>{formatNotionalCompact(tr.valueOfSharesAtStrike)}</div></div>
                      </div>
                      <div style={{ marginTop: t.spacing(2), display: "flex", justifyContent: "center" }}>
                        <button
                          type="button"
                          onClick={() => removeTrade(tr.id)}
                          style={{ ...secondaryBtnStyle, padding: `${t.spacing(0.5)} ${t.spacing(3)}`, fontSize: "0.75rem", color: t.colors.danger, borderColor: t.colors.danger }}
                          aria-label="Remove trade"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {trades.length > 0 && (
            <div
              style={{
                marginTop: t.spacing(2),
                paddingTop: t.spacing(2),
                borderTop: `1px solid ${t.colors.border}`,
                backgroundColor: t.colors.surface,
                position: "sticky",
                bottom: 0,
              }}
            >
              <div style={{ fontSize: "0.75rem", color: t.colors.textMuted, marginBottom: t.spacing(1) }}>Summary</div>
              <div style={{ fontSize: "0.72rem", color: t.colors.textMuted, textTransform: "uppercase", letterSpacing: "0.04em" }}>Total premium</div>
              <div style={{ fontSize: "1.15rem", fontWeight: 700, color: summaryPremium >= 0 ? t.colors.success : t.colors.danger, marginBottom: t.spacing(1.5) }}>
                {formatMoneyFull(summaryPremium)}
              </div>
              <div style={{ fontSize: "0.72rem", color: t.colors.textMuted, textTransform: "uppercase", letterSpacing: "0.04em" }}>Total notional</div>
              <div style={{ fontSize: "1.05rem", fontWeight: 600, color: t.colors.text }}>
                {formatMoneyFull(summaryTotal)}
              </div>
            </div>
          )}
        </div>
      </aside>
    </section>
  );
}
