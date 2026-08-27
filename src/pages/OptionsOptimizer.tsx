// OptionsOptimizer.tsx
// Rank and optimize options trades from portfolio criteria with Schwab quotes.

import { useState, useCallback, useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { Theme } from "../theme";
import {
  getFixedRailsLayoutStyles,
  getPrimaryActionButtonStyle,
  getModalBackdropStyle,
  PAGE_LAYOUT,
  getDropdownTriggerStyle,
  getFieldInputStyle,
  getDropdownOptionStyle,
  THEME_DROPDOWN_OPTION_CLASS,
  getTooltipBubbleStyle,
  rankingColors,
  shadows,
  zIndex,
} from "../theme";
import { SIDEBAR_WIDTH } from "../components/NavBar";
import { SCHWAB_API_BASE } from "../constants";
import { PayoffPanel } from "../components/options/PayoffPanel";
import type { PayoffLegInput } from "../lib/payoff";

// --- Types & exports ---

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
  /** Underlying equity CUSIP from Schwab reference data. */
  cusip?: string | null;
  /** Per-contract FIGI from OpenFIGI. */
  figi?: string | null;
};

/** One row in "Define what you want" */
export type PortfolioRow = {
  id: string;
  ticker: string;
  putCall: "Put" | "Call";
  action: "Sell to Open" | "Buy to Open" | "Sell to Close" | "Buy to Close";
  type: "Qty" | "Notional";
  value: number;
  targetMode?: "days" | "expiry" | "month";
  days: number;
  targetExpiry?: string; // YYYY-MM-DD
  targetMonth?: string;  // YYYY-MM
  /** How to narrow strikes: percent band vs absolute strike range. */
  strikeFilterMode?: "percent" | "strike";
  strikeMin?: number;
  strikeMax?: number;
  moneyness: "OTM" | "ITM";
  otmPctMin: number;
  otmPctMax: number;
  monthly: boolean;
  currentExpiry?: string; // YYYY-MM-DD
  currentStrike?: number;
  currentContracts?: number;
};

type OptimizerMode = "leg-finder" | "collar";

type CollarLegQuote = {
  strike: number;
  bid: number;
  ask: number;
  mid: number;
};

export type CollarResult = {
  rank: number;
  ticker: string;
  expiry: string;
  daysToMaturity: number;
  spot: number;
  putStrike: number;
  callStrike: number;
  put: CollarLegQuote;
  call: CollarLegQuote;
  netCostPerShare: number;
  netCostPerContract: number;
  /** Put mid − call mid (Schwab Even estimate). */
  netMidPerShare: number;
  netMidPerContract: number;
  floorPct: number;
  capPct: number;
  bandWidthPct: number;
  evenScore: number;
  isEven: boolean;
  contractsFromShares: number;
};

type CollarDraft = {
  ticker: string;
  targetMode: "days" | "expiry" | "month";
  days: number;
  targetExpiry: string;
  targetMonth: string;
  monthly: boolean;
  shareCount: number;
  /** "goal" auto-finds the best-even call for a target floor; "exact" quotes one specific put/call pair. */
  searchMode: "goal" | "exact";
  customPutStrike: string;
  customCallStrike: string;
  /** Desired downside floor, % from spot (negative), e.g. -15. Stored as text so "-" is typable. */
  targetFloorPctText: string;
  /** Desired net $/sh at mid; 0 = even. Optional, tucked behind "Advanced". */
  targetNetPerShare: number;
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
  delta?: number | null;
  gamma?: number | null;
  theta?: number | null;
  vega?: number | null;
  ivPct?: number | null;
  openInterest?: number | null;
  totalVolume?: number | null;
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

// --- Helpers ---

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

function collarPairKey(r: CollarResult): string {
  return `${r.expiry}:${r.putStrike}:${r.callStrike}`;
}

function collarLegToTrade(r: CollarResult, side: "put" | "call", contracts: number): OptionsTrade {
  const isPut = side === "put";
  const leg = isPut ? r.put : r.call;
  const strike = leg.strike;
  const exec = isPut ? leg.ask : leg.bid;
  return {
    id: makeId(),
    ticker: r.ticker,
    maturity: r.expiry,
    daysToMaturity: r.daysToMaturity,
    strikePrice: strike,
    currentPrice: r.spot,
    moneynessPct: Math.round((strike / r.spot) * 10000) / 100,
    optionSide: isPut ? "PUT - BUY to OPEN" : "CALL - SELL to OPEN",
    pctOffBid: 0,
    optionLimitPrice: leg.mid,
    currentBid: leg.bid,
    currentAsk: leg.ask,
    contracts,
    premiumReceived: isPut ? -exec * contracts * 100 : exec * contracts * 100,
    yieldAtCurrentPrice: 0,
    annualizedYieldPct: 0,
    valueOfSharesAtStrike: strike * contracts * 100,
  };
}

function formatDateForSheets(raw: string): string {
  if (!raw) return "";
  const normalized = raw.includes("T") ? raw : `${raw}T00:00:00Z`;
  const d = new Date(normalized);
  if (!Number.isFinite(d.getTime())) return raw;
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const yyyy = d.getUTCFullYear();
  return `${mm}/${dd}/${yyyy}`;
}

function formatSheetNumber(n: number): string {
  if (!Number.isFinite(n)) return "";
  return n.toFixed(2);
}

function toPlainTextCell(value: string): string {
  return value
    .replace(/\r?\n/g, " ")
    .replace(/\t/g, " ")
    .replace(/\*\*/g, "")
    .trim();
}

function formatTradeForSheetsExport(tr: OptionsTrade): string {
  return [
    toPlainTextCell(tr.figi ?? ""),
    toPlainTextCell(tr.ticker),
    toPlainTextCell(formatDateForSheets(tr.maturity)),
    toPlainTextCell(formatSheetNumber(tr.strikePrice)),
    toPlainTextCell(tr.optionSide),
    toPlainTextCell(formatSheetNumber(tr.currentBid)),
    toPlainTextCell(formatSheetNumber(tr.currentAsk)),
  ].join("\t");
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
  | "periodYield"
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

export function formatRankedRowForCopy(r: RankedResult): string {
  const values: string[] = [
    String(r.rank),
    r.ticker,
    r.trade.maturity,
    String(r.trade.daysToMaturity),
    r.trade.optionSide.startsWith("PUT") ? "Put" : "Call",
    r.strike.toFixed(2),
    r.limitPrice.toFixed(2),
  ];

  values.push(
    r.annYield.toFixed(2),
    r.premiumPerContract.toFixed(2),
    formatSchwabSymbol(r.trade),
    formatOptionKey(r.trade)
  );

  // Tab-separated row for direct paste across spreadsheet cells.
  return values.join("\t");
}



const MONTH_SELECT_WIDTH = 124;

const MONTH_OPTIONS = [
  { value: "01", label: "January" },
  { value: "02", label: "February" },
  { value: "03", label: "March" },
  { value: "04", label: "April" },
  { value: "05", label: "May" },
  { value: "06", label: "June" },
  { value: "07", label: "July" },
  { value: "08", label: "August" },
  { value: "09", label: "September" },
  { value: "10", label: "October" },
  { value: "11", label: "November" },
  { value: "12", label: "December" },
];

function parseTargetFloorPct(text: string): number {
  const n = Number(text.trim());
  if (Number.isFinite(n)) return n;
  return -15;
}

function formatCollarPositionTotal(r: CollarResult, shareCount: number): { label: string; value: number } {
  const netMid = collarNetMidPerShare(r);
  const netMidContract = collarNetMidPerContract(r);
  if (shareCount > 0) {
    return { label: "Total $", value: netMid * shareCount };
  }
  const contracts = r.contractsFromShares > 0 ? r.contractsFromShares : 1;
  return { label: "Net/ctr", value: netMidContract * contracts };
}

function legMid(leg: CollarLegQuote): number | null {
  if (Number.isFinite(leg.mid) && leg.mid > 0) return leg.mid;
  if (Number.isFinite(leg.bid) && Number.isFinite(leg.ask) && (leg.bid > 0 || leg.ask > 0)) {
    if (leg.bid > 0 && leg.ask > 0) return (leg.bid + leg.ask) / 2;
    return leg.bid > 0 ? leg.bid : leg.ask;
  }
  return null;
}

/** Schwab Even mid (put mid − call mid), with fallbacks when API omits computed fields. */
function collarNetMidPerShare(r: CollarResult): number {
  if (Number.isFinite(r.netMidPerShare)) return r.netMidPerShare;
  const putMid = legMid(r.put);
  const callMid = legMid(r.call);
  if (putMid != null && callMid != null) return putMid - callMid;
  if (Number.isFinite(r.netCostPerShare)) return r.netCostPerShare;
  return 0;
}

function collarNetMidPerContract(r: CollarResult): number {
  if (Number.isFinite(r.netMidPerContract)) return r.netMidPerContract;
  return collarNetMidPerShare(r) * 100;
}

const defaultCollarDraft = (): CollarDraft => {
  const now = new Date();
  const targetMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  return {
    ticker: "",
    targetMode: "month",
    days: 30,
    targetExpiry: "",
    targetMonth,
    monthly: true,
    shareCount: 0,
    searchMode: "goal",
    customPutStrike: "",
    customCallStrike: "",
    targetFloorPctText: "-15",
    targetNetPerShare: 0,
  };
};

const defaultPortfolioRow = (): PortfolioRow => {
  const now = new Date();
  const targetMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  return {
    id: makeId(),
    ticker: "",
    putCall: "Put",
    action: "Sell to Open",
    type: "Qty",
    value: 0,
    targetMode: "month",
    days: 30,
    targetExpiry: "",
    targetMonth,
    strikeFilterMode: "percent",
    strikeMin: 0,
    strikeMax: 0,
    moneyness: "OTM",
    otmPctMin: 5,
    otmPctMax: 15,
    monthly: false,
    currentExpiry: "",
    currentStrike: 0,
    currentContracts: 0,
  };
};

function clonePortfolioRow(row: PortfolioRow): PortfolioRow {
  return {
    ...row,
    id: makeId(),
    ticker: row.ticker.trim().toUpperCase(),
  };
}

function formatQueryStrikeBand(row: PortfolioRow): string {
  if ((row.strikeFilterMode ?? "percent") === "strike") {
    return `$${row.strikeMin ?? 0}–$${row.strikeMax ?? 0}`;
  }
  return `${row.moneyness} ${row.otmPctMin}–${row.otmPctMax}%`;
}

function formatQueryPositionLabel(row: PortfolioRow): string {
  if (row.type === "Qty") {
    const n = Math.max(1, Math.round(row.value || 1));
    return `${n.toLocaleString("en-US")} contract${n === 1 ? "" : "s"}`;
  }
  if (row.value > 0) {
    return `$${Math.round(row.value).toLocaleString("en-US")} notional`;
  }
  return "Notional";
}

function formatQueryExpiryHeadline(row: PortfolioRow): string {
  if (row.targetMode === "expiry" && row.targetExpiry) {
    return row.targetExpiry;
  }
  if (row.targetMode === "month" && row.targetMonth) {
    const [year, monthNum] = row.targetMonth.split("-");
    const monthLabel = MONTH_OPTIONS.find((o) => o.value === monthNum)?.label ?? monthNum;
    return `${monthLabel} ${year}`;
  }
  return `${row.days} days`;
}

function formatQueryChipSecondary(row: PortfolioRow): string {
  return `${row.putCall} · ${row.action} · ${formatQueryStrikeBand(row)}`;
}

type StrikeFilterKind = "OTM" | "ITM" | "strike";

function getStrikeFilterKind(row: PortfolioRow): StrikeFilterKind {
  if ((row.strikeFilterMode ?? "percent") === "strike") return "strike";
  return row.moneyness ?? "OTM";
}

function applyStrikeFilterKind(row: PortfolioRow, kind: StrikeFilterKind): PortfolioRow {
  if (kind === "strike") {
    return { ...row, strikeFilterMode: "strike" };
  }
  return { ...row, strikeFilterMode: "percent", moneyness: kind };
}

// --- UI subcomponents ---

type HelpTooltipProps = {
  theme: Theme;
  text: ReactNode;
  children: React.ReactNode;
  maxWidth?: number;
};

function HelpTooltip({ theme: t, text, children, maxWidth: tooltipWidth = 280 }: HelpTooltipProps) {
  const [open, setOpen] = useState(false);
  const [mouse, setMouse] = useState<{ x: number; y: number } | null>(null);

  function handleMouseEnter(e: React.MouseEvent) {
    setMouse({ x: e.clientX, y: e.clientY });
    setOpen(true);
  }

  function handleMouseMove(e: React.MouseEvent) {
    setMouse({ x: e.clientX, y: e.clientY });
  }
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
            minWidth: Math.min(180, tooltipWidth),
            whiteSpace: "normal",
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

/** Static copy for Options Optimizer “Yield” (period, not annualized) header. */
const periodYieldHeaderHelp: ReactNode = (
  <div style={{ lineHeight: 1.45 }}>
    <strong>Yield</strong> is the raw return on strike notional for this trade's actual holding period (premium ÷
    capital at risk) — not annualized. <strong>Ann. Yield</strong> extrapolates this to a 365-day basis so trades with
    different expiries can be compared apples-to-apples.
  </div>
);

/** Static copy for Options Optimizer “Ann. Yield” header (hover label to open). */
const annYieldHeaderHelp: ReactNode = (
  <div style={{ display: "flex", flexDirection: "column", gap: 8, lineHeight: 1.45 }}>
    <div>
      <strong>Ann. yield</strong> is return on strike notional (premium ÷ capital at risk for this leg), then{" "}
      <strong>annualized</strong> by × (365 ÷ DTE). Rough period return on that notional (not annualized) ≈ ann. × (DTE ÷
      365).
    </div>
    <div>
      <strong>Why writes look positive and buys look negative:</strong> Sell-to-open credits premium, so the figure is
      positive. Buy-to-open debits premium, so the same math is <strong>negative</strong> — it is the cost of the option
      vs. notional, not whether the trade might still profit from the stock.
    </div>
  </div>
);

type SortableOptimizerThProps = {
  theme: Theme;
  sortKey: OptimizerTableSortKey;
  tableSort: OptimizerTableSortState;
  onCycle: (key: OptimizerTableSortKey) => void;
  label: string;
  textAlign: "left" | "right" | "center";
  /** If set, the label text is wrapped in a help tooltip (no separate info icon). */
  labelHelp?: ReactNode;
  labelHelpMaxWidth?: number;
  cellPadding?: string;
  thStyle?: React.CSSProperties;
};

function SortableOptimizerTh({
  theme: t,
  sortKey,
  tableSort,
  onCycle,
  label,
  textAlign,
  labelHelp,
  labelHelpMaxWidth,
  cellPadding,
  thStyle,
}: SortableOptimizerThProps) {
  const active = tableSort.phase !== "none" && tableSort.key === sortKey;
  const ariaSort =
    !active ? "none" : tableSort.phase === "asc" ? "ascending" : "descending";

  const justify =
    textAlign === "right" ? "flex-end" : textAlign === "center" ? "center" : "flex-start";

  const sortIconReserve = (
    <span
      className="material-symbols-outlined options-optimizer-sort-icon"
      style={{
        fontSize: 16,
        lineHeight: 1,
        width: 16,
        height: 16,
        flexShrink: 0,
        opacity: 0,
      }}
      aria-hidden
    />
  );

  const btn = (
    <button
      type="button"
      className="options-optimizer-sort-th-btn"
      onClick={() => onCycle(sortKey)}
      title="Sort: default order → ascending → descending"
      style={{
        background: "none",
        border: "none",
        color: t.colors.secondaryText,
        fontWeight: 600,
        cursor: "pointer",
        display: "inline-flex",
        alignItems: "center",
        gap: 2,
        padding: 0,
        font: "inherit",
        textAlign,
        maxWidth: "100%",
        borderRadius: 4,
        whiteSpace: "nowrap",
        lineHeight: 1.2,
        verticalAlign: "middle",
      }}
    >
      {textAlign === "center" ? sortIconReserve : null}
      {labelHelp ? (
        <HelpTooltip theme={t} text={labelHelp} maxWidth={labelHelpMaxWidth ?? 280}>
          <span style={{ cursor: "help" }}>{label}</span>
        </HelpTooltip>
      ) : (
        <span>{label}</span>
      )}
      <span
        className="material-symbols-outlined options-optimizer-sort-icon"
        style={{
          fontSize: 16,
          lineHeight: 1,
          width: 16,
          height: 16,
          flexShrink: 0,
          opacity: active ? 0.95 : 0,
        }}
        aria-hidden
      >
        {tableSort.phase === "asc" ? "arrow_upward" : "arrow_downward"}
      </span>
    </button>
  );

  return (
    <th
      aria-sort={ariaSort}
      style={{
        textAlign,
        padding: cellPadding ?? t.spacing(2),
        color: t.colors.secondaryText,
        fontWeight: 600,
        verticalAlign: "middle",
        whiteSpace: "nowrap",
        ...thStyle,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: justify }}>
        {btn}
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
  fixedWidth?: number;
  dropdownMaxHeight?: number;
  variant?: "default" | "embedded";
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
  fixedWidth,
  dropdownMaxHeight,
  variant = "default",
}: ThemeSelectProps) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const open = openId === dropdownKey;
  const display = options.find((o) => o.value === value)?.label ?? value;
  const [panelRect, setPanelRect] = useState<{ top: number; left: number; width: number } | null>(null);
  const embedded = variant === "embedded";

  useEffect(() => {
    if (!open || !btnRef.current) {
      setPanelRect(null);
      return;
    }
    const update = () => {
      const rect = btnRef.current?.getBoundingClientRect();
      if (!rect) return;
      setPanelRect({ top: rect.bottom + 4, left: rect.left, width: Math.max(rect.width, minWidth ?? 120) });
    };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [open, minWidth]);

  useEffect(() => {
    if (!open || !panelRef.current) return;
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        const panel = panelRef.current;
        if (!panel) return;
        const selected = panel.querySelector<HTMLElement>(`[data-option-value="${value}"]`);
        if (!selected) return;
        panel.scrollTop = selected.offsetTop - panel.clientHeight / 2 + selected.offsetHeight / 2;
      });
    });
    return () => {
      cancelAnimationFrame(raf1);
      if (raf2) cancelAnimationFrame(raf2);
    };
  }, [open, value]);

  const triggerStyle: React.CSSProperties = embedded
    ? {
        ...getDropdownTriggerStyle(t),
        border: "none",
        borderRadius: 0,
        height: 40,
        minWidth: minWidth ?? 112,
        maxWidth: minWidth ?? 112,
        margin: 0,
        backgroundColor: t.colors.background,
        boxShadow: "none",
        padding: `${t.spacing(2)} ${t.spacing(2)}`,
        fontSize: t.typography.baseFontSize,
      }
    : {
        ...getDropdownTriggerStyle(t),
        minWidth: fixedWidth ?? minWidth ?? 120,
        ...(fixedWidth != null ? { width: fixedWidth, maxWidth: fixedWidth } : {}),
        margin: 0,
      };

  return (
    <div
      style={{
        position: "relative",
        minWidth: embedded ? 0 : fixedWidth ?? minWidth ?? 0,
        width: fixedWidth,
        flexShrink: embedded || fixedWidth != null ? 0 : undefined,
      }}
    >
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpenId(open ? null : dropdownKey)}
        style={triggerStyle}
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
      {open &&
        panelRect &&
        createPortal(
          <>
            <div
              role="presentation"
              style={{ position: "fixed", inset: 0, zIndex: zIndex.dropdownPortalBackdrop }}
              onClick={() => setOpenId(null)}
            />
            <div
              ref={panelRef}
              style={{
                position: "fixed",
                top: panelRect.top,
                left: panelRect.left,
                minWidth: panelRect.width,
                backgroundColor: t.colors.surface,
                border: `1px solid ${t.colors.border}`,
                borderRadius: t.radius.md,
                boxShadow: shadows.dropdown,
                zIndex: zIndex.dropdownPortal,
                overflow: "hidden",
                ...(dropdownMaxHeight != null
                  ? { maxHeight: dropdownMaxHeight, overflowY: "auto" }
                  : {}),
              }}
            >
              {options.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  data-option-value={o.value}
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
          </>,
          document.body
        )}
    </div>
  );
}

// --- Main page component ---

export function OptionsOptimizer({ theme: t, sidebarWidth = SIDEBAR_WIDTH }: OptionsOptimizerProps) {
  const [optimizerMode, setOptimizerMode] = useState<OptimizerMode>("leg-finder");
  const [draftRow, setDraftRow] = useState<PortfolioRow>(defaultPortfolioRow());
  const [collarDraft, setCollarDraft] = useState<CollarDraft>(defaultCollarDraft());
  const [collarAdvancedOpen, setCollarAdvancedOpen] = useState(false);
  const [payoffModal, setPayoffModal] = useState<{
    title: string;
    subtitle?: string;
    input: PayoffLegInput;
    shares: number;
    daysToMaturity: number;
  } | null>(null);
  const [queryContracts, setQueryContracts] = useState<PortfolioRow[]>([]);
  const [portfolioDropdownId, setPortfolioDropdownId] = useState<string | null>(null);
  const [rankedResults, setRankedResults] = useState<RankedResult[] | null>(null);
  const [collarResults, setCollarResults] = useState<CollarResult[] | null>(null);
  const [collarSpot, setCollarSpot] = useState<number | null>(null);
  const [collarLoading, setCollarLoading] = useState(false);
  const [collarMessage, setCollarMessage] = useState<string | null>(null);
  const [addedCollarKeys, setAddedCollarKeys] = useState<Set<string>>(() => new Set());
  const [optimizerTableSort, setOptimizerTableSort] = useState<OptimizerTableSortState>({
    phase: "none",
  });
  const [optimizeMessage, setOptimizeMessage] = useState<string | null>(null);
  const [optimizeLoading, setOptimizeLoading] = useState(false);
  const [trades, setTrades] = useState<OptionsTrade[]>([]);
  const [tradeListPanelOpen, setTradeListPanelOpen] = useState(false);
  const [showOptimizeForModal, setShowOptimizeForModal] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [lastCopiedTradeId, setLastCopiedTradeId] = useState<string | null>(null);
  const [expandedTradeId, setExpandedTradeId] = useState<string | null>(null);
  const [fetchingFigiForId, setFetchingFigiForId] = useState<string | null>(null);
  const [figiStatusById, setFigiStatusById] = useState<Record<string, { ok: boolean; msg: string }>>({});
  const [exportingTradeList, setExportingTradeList] = useState(false);
  const [tradeListExportCopied, setTradeListExportCopied] = useState(false);
  const inputsBarRef = useRef<HTMLDivElement>(null);
  const resultsTitleRef = useRef<HTMLDivElement>(null);
  const [contentTop, setContentTop] = useState(224);
  const [resultsTitleHeight, setResultsTitleHeight] = useState(0);

  useLayoutEffect(() => {
    const node = inputsBarRef.current;
    if (!node) return;
    const measure = () => {
      const rect = node.getBoundingClientRect();
      setContentTop(Math.ceil(rect.bottom));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [draftRow, optimizeMessage, queryContracts.length, optimizerMode, collarDraft, sidebarWidth]);

  useLayoutEffect(() => {
    const node = resultsTitleRef.current;
    if (!node) {
      setResultsTitleHeight(0);
      return;
    }
    const measure = () => setResultsTitleHeight(Math.ceil(node.getBoundingClientRect().height));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [optimizerMode, rankedResults, collarResults, optimizeMessage, collarMessage]);

  useEffect(() => {
    if (showOptimizeForModal) setPortfolioDropdownId(null);
  }, [showOptimizeForModal]);

  const requestTradeIdentifiers = useCallback(async (tr: OptionsTrade) => {
    try {
      const resp = await fetch("/api/schwab", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "figi",
          ticker: tr.ticker,
          expiry: tr.maturity,
          strike: tr.strikePrice,
          putCall: tr.optionSide.startsWith("CALL") ? "Call" : "Put",
        }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        return { ok: false as const, msg: data?.error ?? `Error ${resp.status}` };
      }
      if (data.figi) {
        return { ok: true as const, figi: data.figi as string, cusip: (data.cusip ?? null) as string | null, msg: "" };
      } else {
        const noMatchMsg = data?.occSymbol
          ? `No FIGI found for ${data.occSymbol}`
          : (data?.message ?? "No FIGI found for this contract.");
        return { ok: false as const, msg: noMatchMsg };
      }
    } catch (err: any) {
      return { ok: false as const, msg: `Fetch error: ${err?.message ?? String(err)}` };
    }
  }, []);

  const fetchTradeIdentifiers = useCallback(async (tradeId: string, tr: OptionsTrade) => {
    setFetchingFigiForId(tradeId);
    setFigiStatusById((prev) => ({ ...prev, [tradeId]: { ok: true, msg: "" } }));
    const result = await requestTradeIdentifiers(tr);
    if (result.ok) {
      setTrades((prev) =>
        prev.map((t) =>
          t.id === tradeId ? { ...t, figi: result.figi, cusip: result.cusip ?? t.cusip } : t
        )
      );
      setFigiStatusById((prev) => ({ ...prev, [tradeId]: { ok: true, msg: "" } }));
    } else {
      setFigiStatusById((prev) => ({ ...prev, [tradeId]: { ok: false, msg: result.msg } }));
    }
    setFetchingFigiForId(null);
  }, [requestTradeIdentifiers]);

  const exportTradesForSheets = useCallback(async () => {
    if (trades.length === 0 || exportingTradeList) return;
    setExportingTradeList(true);

    const statusUpdates: Record<string, { ok: boolean; msg: string }> = {};
    const figiUpdates = new Map<string, { figi: string; cusip: string | null }>();

    try {
      const missingFigiTrades = trades.filter((tr) => !tr.figi);
      for (const tr of missingFigiTrades) {
        let result = await requestTradeIdentifiers(tr);
        if (!result.ok) {
          // Quick retry to reduce transient API/network misses.
          result = await requestTradeIdentifiers(tr);
        }
        if (result.ok) {
          figiUpdates.set(tr.id, { figi: result.figi, cusip: result.cusip });
          statusUpdates[tr.id] = { ok: true, msg: "" };
        } else {
          statusUpdates[tr.id] = { ok: false, msg: result.msg };
        }
      }

      if (Object.keys(statusUpdates).length > 0) {
        setFigiStatusById((prev) => ({ ...prev, ...statusUpdates }));
      }

      const exportTrades = trades.map((tr) => {
        const update = figiUpdates.get(tr.id);
        if (!update) return tr;
        return { ...tr, figi: update.figi, cusip: update.cusip ?? tr.cusip };
      });

      const missingAfterFetch = exportTrades.filter((tr) => !tr.figi);
      if (missingAfterFetch.length > 0) {
        window.alert(
          `Could not fetch FIGI for ${missingAfterFetch.length} trade${missingAfterFetch.length === 1 ? "" : "s"} yet. Please retry export.`
        );
        return;
      }

      if (figiUpdates.size > 0) {
        setTrades((prev) =>
          prev.map((tr) => {
            const update = figiUpdates.get(tr.id);
            if (!update) return tr;
            return { ...tr, figi: update.figi, cusip: update.cusip ?? tr.cusip };
          })
        );
      }

      const text = exportTrades.map((tr) => formatTradeForSheetsExport(tr)).join("\n");
      await navigator.clipboard.writeText(text);
      setTradeListExportCopied(true);
      window.setTimeout(() => {
        setTradeListExportCopied(false);
      }, 1800);
    } finally {
      setExportingTradeList(false);
    }
  }, [trades, exportingTradeList, requestTradeIdentifiers]);

  useEffect(() => {
    if (!showOptimizeForModal) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowOptimizeForModal(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [showOptimizeForModal]);

  useEffect(() => {
    if (!payoffModal) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPayoffModal(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [payoffModal]);

  const addQueryContract = useCallback(() => {
    const ticker = draftRow.ticker.trim().toUpperCase();
    if (!ticker) {
      setOptimizeMessage("Enter a ticker before adding to the query.");
      return;
    }
    setOptimizeMessage(null);
    setQueryContracts((prev) => [clonePortfolioRow({ ...draftRow, ticker }), ...prev]);
  }, [draftRow]);

  const removeQueryContract = useCallback((id: string) => {
    setQueryContracts((prev) => prev.filter((r) => r.id !== id));
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
        case "periodYield":
          cmp =
            a.trade.yieldAtCurrentPrice === b.trade.yieldAtCurrentPrice
              ? 0
              : a.trade.yieldAtCurrentPrice < b.trade.yieldAtCurrentPrice
                ? -1
                : 1;
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

  const updateDraftRow = useCallback(
    (field: keyof PortfolioRow, value: string | number | boolean) => {
      setDraftRow((prev) => ({ ...prev, [field]: value }));
    },
    []
  );

  const updateCollarDraft = useCallback(
    (field: keyof CollarDraft, value: string | number | boolean) => {
      setCollarDraft((prev) => ({ ...prev, [field]: value }));
    },
    []
  );

  const runCollarScan = useCallback(async () => {
    const ticker = collarDraft.ticker.trim().toUpperCase();
    if (!ticker) {
      setCollarMessage("Enter a ticker to scan collars.");
      setCollarResults(null);
      return;
    }
    if (collarDraft.targetMode === "month") {
      const parts = (collarDraft.targetMonth ?? "").split("-");
      if (!/^\d{4}$/.test(parts[0] ?? "") || !/^\d{2}$/.test(parts[1] ?? "")) {
        setCollarMessage("Select a valid target month and year.");
        setCollarResults(null);
        return;
      }
    }
    if (collarDraft.searchMode === "goal") {
      const floor = parseTargetFloorPct(collarDraft.targetFloorPctText);
      if (!Number.isFinite(floor) || floor >= 0) {
        setCollarMessage("Enter a target floor below spot (e.g. -15 for 15% downside protection).");
        setCollarResults(null);
        return;
      }
    }
    if (collarDraft.searchMode === "exact") {
      const put = Number(collarDraft.customPutStrike.replace(/,/g, ""));
      const call = Number(collarDraft.customCallStrike.replace(/,/g, ""));
      if (!Number.isFinite(put) || put <= 0 || !Number.isFinite(call) || call <= 0) {
        setCollarMessage("Enter both a put strike and a call strike to quote an exact collar.");
        setCollarResults(null);
        return;
      }
    }
    setCollarLoading(true);
    setCollarMessage(null);
    try {
      const customPut = Number(collarDraft.customPutStrike.replace(/,/g, ""));
      const customCall = Number(collarDraft.customCallStrike.replace(/,/g, ""));
      const body: Record<string, unknown> = {
        action: "collar",
        ticker,
        targetMode: collarDraft.targetMode,
        days: collarDraft.days,
        targetExpiry: collarDraft.targetExpiry,
        targetMonth: collarDraft.targetMonth,
        monthly: collarDraft.monthly,
        shareCount: collarDraft.shareCount,
        targetFloorPct: parseTargetFloorPct(collarDraft.targetFloorPctText),
        targetNetPerShare: collarDraft.targetNetPerShare,
      };
      if (
        collarDraft.searchMode === "exact" &&
        Number.isFinite(customPut) && customPut > 0 &&
        Number.isFinite(customCall) && customCall > 0
      ) {
        body.customPutStrike = customPut;
        body.customCallStrike = customCall;
      }
      const resp = await fetch(`${SCHWAB_API_BASE}/api/schwab`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await resp.json();
      if (!resp.ok) {
        const err = data?.error ?? `Error ${resp.status}`;
        if (typeof err === "string" && err.includes('Unknown or missing action: "collar"')) {
          setCollarMessage(
            "Collar API is not on the server yet — deploy the latest code to Vercel (includes api/_handlers/collar.ts), then retry."
          );
        } else {
          setCollarMessage(err);
        }
        setCollarResults(null);
        return;
      }
      setCollarSpot(typeof data.spot === "number" ? data.spot : null);
      setLastUpdated(new Date());

      const rawResults: CollarResult[] = Array.isArray(data.results) ? data.results : [];
      if (collarDraft.searchMode === "goal") {
        const targetFloor = parseTargetFloorPct(collarDraft.targetFloorPctText);
        const floorTolerance = 10;
        const nearTarget = rawResults.filter(
          (r) => Math.abs(r.floorPct - targetFloor) <= floorTolerance
        );
        if (rawResults.length > 3) {
          setCollarResults(null);
          setCollarMessage(
            "Collar scan returned too many rows — the deployed API may be outdated. Deploy the latest code (goal-driven collar), then retry."
          );
          return;
        }
        if (rawResults.length > 0 && nearTarget.length === 0) {
          setCollarResults(null);
          setCollarMessage(
            typeof data.message === "string" && data.message.length > 0
              ? data.message
              : `No puts found near a ${targetFloor}% floor for that expiry. Try another month or adjust the floor target.`
          );
          return;
        }
        setCollarResults(nearTarget.length > 0 ? nearTarget : rawResults);
        setCollarMessage(data.message ?? null);
      } else {
        setCollarResults(rawResults);
        setCollarMessage(data.message ?? null);
      }
    } catch {
      setCollarMessage("Network error. Try again.");
      setCollarResults(null);
    } finally {
      setCollarLoading(false);
    }
  }, [collarDraft]);

  const addCollarToTradeList = useCallback((r: CollarResult) => {
    const contracts =
      r.contractsFromShares > 0
        ? r.contractsFromShares
        : collarDraft.shareCount > 0
          ? Math.max(1, Math.floor(collarDraft.shareCount / 100))
          : 1;
    setTrades((prev) => [
      ...prev,
      collarLegToTrade(r, "put", contracts),
      collarLegToTrade(r, "call", contracts),
    ]);
    setAddedCollarKeys((prev) => new Set(prev).add(collarPairKey(r)));
    setTradeListPanelOpen(true);
  }, [collarDraft.shareCount]);

  const runOptimize = useCallback(async () => {
    if (queryContracts.length === 0) {
      setOptimizeMessage("Add at least one contract to the query, then run Optimize.");
      setRankedResults(null);
      return;
    }
    const tickers = queryContracts.map((r) => r.ticker.trim().toUpperCase()).filter(Boolean);
    if (tickers.length === 0) {
      setOptimizeMessage("Add at least one ticker with a symbol to optimize.");
      setRankedResults(null);
      return;
    }
    // Validate month mode rows before sending
    for (const row of queryContracts) {
      if ((row.targetMode ?? "month") === "month") {
        const tm = row.targetMonth ?? "";
        const parts = tm.split("-");
        const yearOk = /^\d{4}$/.test(parts[0] ?? "");
        const monthOk = /^\d{2}$/.test(parts[1] ?? "");
        if (!yearOk || !monthOk) {
          setOptimizeMessage(
            `Please select a month and enter a valid 4-digit year for "${row.ticker || "your ticker"}".`
          );
          setRankedResults(null);
          return;
        }
      }
      if ((row.strikeFilterMode ?? "percent") === "strike") {
        const lo = row.strikeMin ?? 0;
        const hi = row.strikeMax ?? 0;
        if (
          !Number.isFinite(lo) ||
          !Number.isFinite(hi) ||
          lo <= 0 ||
          hi <= 0 ||
          lo > hi
        ) {
          setOptimizeMessage(
            `Enter a valid strike range (positive min and max, min ≤ max) for "${row.ticker.trim() || "your ticker"}".`
          );
          setRankedResults(null);
          return;
        }
      }
    }
    setOptimizeLoading(true);
    setOptimizeMessage(null);
    try {
      const res = await fetch(`${SCHWAB_API_BASE}/api/schwab`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "optimize",
          portfolioRows: queryContracts,
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
  }, [queryContracts]);

  const addToTradeList = useCallback((result: RankedResult) => {
    const trade = { ...result.trade, id: makeId(), sourceResultId: result.trade.id };
    setTrades((prev) => [...prev, trade]);
    setTradeListPanelOpen(true);
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

  const showCollarAuthHint =
    !!collarMessage &&
    (collarMessage.includes("Schwab token expired") ||
      collarMessage.includes("Not authorized with Schwab"));

  const showCollarResultsTable = collarResults != null && collarResults.length > 0;

  // --- Styles ---

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

  const primaryBtn = getPrimaryActionButtonStyle(t);

  const sectionTitleStyle: React.CSSProperties = {
    fontSize: "0.75rem",
    color: t.colors.secondary,
    textTransform: "uppercase" as const,
    letterSpacing: "0.04em",
    marginBottom: t.spacing(2),
  };

  const labelStyle: React.CSSProperties = {
    fontSize: "0.68rem",
    color: t.colors.textMuted,
    textTransform: "uppercase" as const,
    letterSpacing: "0.04em",
    marginBottom: t.spacing(0.5),
  };

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

  const fieldInput = (overrides?: React.CSSProperties): React.CSSProperties =>
    getFieldInputStyle(t, { maxWidth: 120, ...overrides });

  const inputSectionLabel: React.CSSProperties = {
    fontSize: "0.78rem",
    fontWeight: 700,
    color: t.colors.secondary,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    marginBottom: t.spacing(1),
    whiteSpace: "nowrap",
    lineHeight: 1.2,
  };

  const inputSectionBlockAuto: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    flex: "0 0 auto",
    alignSelf: "stretch",
    justifyContent: "center",
  };

  const POSITION_FIELD_WIDTH = 300;

  const inputSectionDivider: React.CSSProperties = {
    width: 1,
    alignSelf: "stretch",
    backgroundColor: t.colors.border,
    flexShrink: 0,
    margin: `0 ${t.spacing(2.5)}`,
  };

  const inputFieldCol: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    flex: "0 0 auto",
  };

  const inputFieldsRowInline: React.CSSProperties = {
    display: "flex",
    alignItems: "flex-end",
    gap: t.spacing(1.5),
    width: "auto",
  };

  const inputFieldsRow: React.CSSProperties = {
    display: "flex",
    alignItems: "flex-end",
    gap: t.spacing(1.5),
    width: "auto",
  };

  const actionBtnRow: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    alignItems: "stretch",
    alignSelf: "stretch",
    justifyContent: "center",
    gap: t.spacing(1),
    flex: "0 0 auto",
    minWidth: 260,
    marginLeft: t.spacing(2.5),
    paddingLeft: t.spacing(2.5),
    paddingRight: t.spacing(2),
    borderLeft: `1px solid ${t.colors.border}`,
  };

  const addContractBtn: React.CSSProperties = {
    ...secondaryBtnStyle,
    width: "100%",
    height: 40,
    minHeight: 40,
    padding: `${t.spacing(2)} ${t.spacing(3)}`,
    borderRadius: t.radius.md,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: t.spacing(1),
    fontSize: t.typography.baseFontSize,
    color: t.colors.text,
  };

  const optimizeBtnWide: React.CSSProperties = {
    ...primaryBtn,
    width: "100%",
    height: 40,
    minHeight: 40,
    padding: `${t.spacing(2)} ${t.spacing(3)}`,
    fontSize: t.typography.baseFontSize,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
  };

  const combinedFieldShell: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    height: 40,
    maxHeight: 40,
    flexShrink: 0,
    boxSizing: "border-box",
    border: `1px solid ${t.colors.border}`,
    borderRadius: t.radius.md,
    overflow: "hidden",
    backgroundColor: t.colors.surface,
    width: POSITION_FIELD_WIDTH,
    minWidth: POSITION_FIELD_WIDTH,
    maxWidth: POSITION_FIELD_WIDTH,
  };

  const combinedFieldInput: React.CSSProperties = {
    ...fieldInput({ maxWidth: "none", minWidth: 0, flex: 1, width: "100%", height: 40 }),
    border: "none",
    borderRadius: 0,
    boxShadow: "none",
  };

  const inputsBarPaddingY = t.spacing(2);
  const inputsBarPaddingX = t.spacing(8);
  const tradeListTabWidth = 40;
  /** Inset main content below the inputs bar so it ends at the collapsed trade-list tab, not under it. */
  const tradeListClearance = `${tradeListTabWidth}px`;

  const fixedRails = getFixedRailsLayoutStyles(t, {
    sidebarWidth,
    headerHeight: 104,
  });

  const tableCellPadY = t.spacing(1.5);
  const tableCellPadX = t.spacing(2.5);
  const tableCellPadding = `${tableCellPadY} ${tableCellPadX}`;
  const tableActionCellPadding = `${tableCellPadY} calc(${tableCellPadX} + ${t.spacing(2)}) ${tableCellPadY} ${tableCellPadX}`;
  const tableEdgePadRight = tableCellPadX;
  const tableFontSize = "0.84rem";
  const tableHeaderFontSize = "0.76rem";
  const tableThStyle: React.CSSProperties = {
    padding: tableCellPadding,
    color: t.colors.secondaryText,
    fontWeight: 600,
    fontSize: tableHeaderFontSize,
    whiteSpace: "nowrap",
    verticalAlign: "middle",
    textAlign: "center",
  };
  const tableTdStyle: React.CSSProperties = {
    padding: tableCellPadding,
    fontSize: tableFontSize,
    verticalAlign: "middle",
    textAlign: "center",
  };
  const tableNumThStyle: React.CSSProperties = {
    ...tableThStyle,
    textAlign: "center",
  };
  const tableNumTdStyle: React.CSSProperties = {
    ...tableTdStyle,
    textAlign: "center",
    whiteSpace: "nowrap",
  };
  const tradeListPanelWidth = 320;
  const showResultsTable = rankedResults != null && rankedResults.length > 0;
  const activeResultsTable = optimizerMode === "leg-finder" ? showResultsTable : showCollarResultsTable;
  const centerPanelMinHeight = `calc(100vh - ${contentTop}px)`;
  const mainTop = contentTop;
  const resultsStickyTop = contentTop;
  const resultsTheadStickyTop = contentTop + resultsTitleHeight;

  const resultsPanelStickyStyle: React.CSSProperties = {
    ["--optimizer-sticky-top" as string]: `${resultsStickyTop}px`,
    ["--optimizer-thead-sticky-top" as string]: `${resultsTheadStickyTop}px`,
    ["--optimizer-sticky-bg" as string]: t.colors.surface,
    ["--optimizer-thead-bg" as string]: t.colors.secondary,
  };

  const schwabAttribution = (
    <>
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
    </>
  );

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
          <div style={{ display: "flex", alignItems: "center", gap: t.spacing(2), flexShrink: 0 }}>
            <div
              role="tablist"
              aria-label="Optimizer mode"
              style={{
                display: "inline-flex",
                border: `1px solid ${t.colors.border}`,
                borderRadius: t.radius.md,
                overflow: "hidden",
                backgroundColor: t.colors.background,
              }}
            >
              {(
                [
                  { id: "leg-finder" as const, label: "Leg Finder" },
                  { id: "collar" as const, label: "Collar" },
                ] as const
              ).map((mode) => {
                const active = optimizerMode === mode.id;
                return (
                  <button
                    key={mode.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setOptimizerMode(mode.id)}
                    style={{
                      border: "none",
                      background: active ? t.colors.secondary : "transparent",
                      color: active ? t.colors.surface : t.colors.textMuted,
                      fontWeight: 600,
                      fontSize: "0.72rem",
                      letterSpacing: "0.04em",
                      textTransform: "uppercase",
                      padding: `${t.spacing(1)} ${t.spacing(2)}`,
                      cursor: "pointer",
                      fontFamily: t.typography.fontFamily,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {mode.label}
                  </button>
                );
              })}
            </div>
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
        </div>
        <p style={{ ...descStyle, marginTop: t.spacing(1), marginBottom: 0 }}>
          {optimizerMode === "leg-finder"
            ? "Define the tickers and parameters you want, run Optimize to fetch live options from Schwab, then add ideas to your trade list."
            : "Scan live Schwab chains for protective collars (buy put + sell call). Returns a small set of tradeable recommendations — not every theoretical pair."}
        </p>
      </div>

      {showOptimizeForModal && (
        <>
          <div
            role="presentation"
            style={getModalBackdropStyle(t)}
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
              zIndex: zIndex.modal,
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
                Schwab chains are fetched for your expiry and OTM/strike band. Up to <strong>100 strikes per row</strong> are quoted and ranked (all in band when possible). If a row has more than 100 strikes in band, we keep those closest to your OTM target and show a warning above the table. Yield and premium use realistic prices: <strong>bid for sell</strong> legs, <strong>ask for buy</strong> legs. Limit Px in the table is still the bid/ask midpoint as a target limit.
              </p>
              <p style={{ marginBottom: t.spacing(2) }}>
                Each candidate gets a score from the factors below (higher sorts to the top):
              </p>
              <ul style={{ margin: 0, marginBottom: t.spacing(3), paddingLeft: t.spacing(5) }}>
                <li><strong>Annualized Yield (50% of base)</strong> — premium ÷ strike notional × (365 ÷ DTE). For short premium this is income on capital at risk; for long premium it is negative (cost vs notional). Same formula, opposite sign.</li>
                <li><strong>Directional Momentum (50% of base)</strong> — the underlying's trailing ~1-month return (start: daily close from Schwab history; end: same live equity quote snapshot as spot), adjusted for trade direction. Upside helps short puts &amp; long calls; downside helps short calls &amp; long puts. Capped at ±50% so extreme single-month moves don't dominate.</li>
                <li><strong>Short-option risk adjustment</strong> — for sell-to-open legs we use <strong>Probability of Profit (PoP)</strong> from Schwab delta: <em>PoP = (1 − |delta|) × 100</em>. Above ~70% PoP gets a boost; below ~50% (near/in-the-money) is penalized. If delta is missing, we use tiered OTM-distance penalties.</li>
                <li><strong>Long premium add-on</strong> — for buy-to-open (and other non-short legs in the score), we blend in quote quality from Schwab: tighter bid/ask, delta &amp; gamma per premium dollar (exposure efficiency), theta bleed vs premium, a mild penalty for very high IV, and small lifts for open interest and volume.</li>
              </ul>

              <p style={{ fontWeight: 700, marginBottom: t.spacing(1), color: t.colors.primary }}>Understanding the columns</p>
              <ul style={{ margin: 0, marginBottom: t.spacing(3), paddingLeft: t.spacing(5) }}>
                <li><strong>1M Return</strong> — ~1-month total return: baseline close from daily history vs current price from the equity quote at request time (directional context for ranking).</li>
                <li><strong>Moneyness</strong> — strike ÷ current spot × 100 (same quote snapshot as the run). Below 100% is typically OTM for puts; above 100% is typically OTM for calls. At-the-money is near 100%.</li>
                <li><strong>Limit Px</strong> — midpoint of the Schwab bid/ask. This is your target fill price; real fills may differ.</li>
                <li><strong>Ann. Yield</strong> — annualized yield based on strike notional (see ranking explainer). Hover the column header for period vs annualized and why long premium shows negative yield.</li>
                <li><strong>PoP</strong> — probability the option expires worthless (you keep the full premium). Derived from delta: higher is better for short options.</li>
                <li><strong>Premium</strong> — executable price (bid/ask per side above) × 100 × contracts for ranking; the table shows midpoint-based limit premium. Positive = cash you receive (sell to open); negative = cash you pay (buy to open).</li>
              </ul>

              <p style={{ fontWeight: 700, marginBottom: t.spacing(1), color: t.colors.primary }}>Trade types &amp; pricing</p>
              <ul style={{ margin: 0, marginBottom: t.spacing(3), paddingLeft: t.spacing(5) }}>
                <li><strong>Put vs call</strong> — puts are OTM below spot; calls are OTM above spot (ITM is the opposite).</li>
                <li><strong>Sell to open / sell to close</strong> — ranked on <strong>bid</strong> (premium you can receive).</li>
                <li><strong>Buy to open / buy to close</strong> — ranked on <strong>ask</strong> (premium you pay).</li>
                <li><strong>Sell to Open</strong> — generates premium income. You take on the obligation to buy (put) or sell (call) shares if assigned. The optimizer scores these most often.</li>
                <li><strong>Buy to Open</strong> — pays premium upfront. Requires directional conviction. The momentum signal is automatically flipped to match your intended direction.</li>
                <li><strong>Sell/Buy to Close</strong> — exits an existing position.</li>
              </ul>

              <p style={{ fontWeight: 700, marginBottom: t.spacing(1), color: t.colors.primary }}>Assignment-aware ranking</p>
              <p style={{ marginBottom: 0 }}>
                Always on. Short puts near or below the current price carry meaningful assignment risk—you could be obligated to buy shares at the strike. The PoP score naturally penalises these by rewarding high-delta-distance (deeply OTM) options. The same logic applies to short calls: ITM calls risk having your position exercised against you.
              </p>

            </div>
          </div>
        </>
      )}

      {payoffModal && (
        <PayoffPanel
          theme={t}
          title={payoffModal.title}
          subtitle={payoffModal.subtitle}
          input={payoffModal.input}
          shares={payoffModal.shares}
          daysToMaturity={payoffModal.daysToMaturity}
          onClose={() => setPayoffModal(null)}
        />
      )}

      {/* —— Horizontal inputs bar —— */}
      <div
        ref={inputsBarRef}
        className="options-optimizer-inputs-bar"
        style={{
          position: "fixed",
          left: sidebarWidth,
          right: tradeListTabWidth,
          top: fixedRails.headerHeight,
          zIndex: zIndex.railDropdown,
          backgroundColor: t.colors.surface,
          borderBottom: `1px solid ${t.colors.border}`,
          padding: `${inputsBarPaddingY} ${inputsBarPaddingX}`,
          boxSizing: "border-box",
          overflow: "visible",
        }}
      >
        <div
          className="options-optimizer-inputs-inner"
          style={{
            display: "flex",
            width: "100%",
            alignItems: "stretch",
            gap: 0,
          }}
        >
          {optimizerMode === "leg-finder" ? (() => {
            const row = draftRow;
            const tmParts = (row.targetMonth ?? "").split("-");
            const tmYear = tmParts[0] ?? "";
            const tmMonth = tmParts[1] ?? "";
            return (
            <>
              {/* Contract details */}
              <div style={inputSectionBlockAuto}>
                <span style={inputSectionLabel}>Contract details</span>
                <div style={inputFieldsRowInline}>
                  <div style={inputFieldCol}>
                    <HelpTooltip
                      theme={t}
                      text="Underlying symbol for the option, e.g. SPY, AAPL, NVDA."
                    >
                      <label style={labelStyle}>Ticker</label>
                    </HelpTooltip>
                    <input
                      type="text"
                      placeholder="e.g. SPY"
                      style={fieldInput({ maxWidth: 96, minWidth: 96 })}
                      value={row.ticker}
                      onChange={(e) => updateDraftRow("ticker", e.target.value)}
                      aria-label="Ticker"
                    />
                  </div>
                  <div style={inputFieldCol}>
                    <label style={labelStyle}>Put / Call</label>
                    <OptimizerThemeSelect
                      theme={t}
                      value={row.putCall}
                      options={[
                        { value: "Put", label: "Put" },
                        { value: "Call", label: "Call" },
                      ]}
                      onChange={(v) => updateDraftRow("putCall", v as "Put" | "Call")}
                      dropdownKey={`${row.id}-putCall`}
                      openId={portfolioDropdownId}
                      setOpenId={setPortfolioDropdownId}
                      minWidth={100}
                    />
                  </div>
                  <div style={inputFieldCol}>
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
                        updateDraftRow(
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
                  <div style={inputFieldCol}>
                    <HelpTooltip
                      theme={t}
                      text="Quantity = number of contracts. Notional = target dollar amount of underlying shares at strike."
                    >
                      <label style={labelStyle}>Position</label>
                    </HelpTooltip>
                    <div style={combinedFieldShell}>
                      <OptimizerThemeSelect
                        theme={t}
                        variant="embedded"
                        value={row.type}
                        options={[
                          { value: "Qty", label: "Quantity" },
                          { value: "Notional", label: "Notional" },
                        ]}
                        onChange={(v) => updateDraftRow("type", v as "Qty" | "Notional")}
                        dropdownKey={`${row.id}-type`}
                        openId={portfolioDropdownId}
                        setOpenId={setPortfolioDropdownId}
                        minWidth={112}
                      />
                      <div
                        style={{ width: 1, backgroundColor: t.colors.border, flexShrink: 0, alignSelf: "stretch" }}
                        aria-hidden
                      />
                      {row.type === "Notional" ? (
                        <input
                          type="text"
                          inputMode="numeric"
                          style={combinedFieldInput}
                          value={
                            row.value > 0
                              ? `$${Math.round(row.value).toLocaleString("en-US")}`
                              : ""
                          }
                          onChange={(e) => {
                            const digits = e.target.value.replace(/[^\d]/g, "");
                            updateDraftRow("value", digits ? Number(digits) : 0);
                          }}
                          placeholder="$0"
                          aria-label="Position notional value"
                        />
                      ) : (
                        <input
                          type="text"
                          inputMode="numeric"
                          style={combinedFieldInput}
                          value={row.value > 0 ? Math.round(row.value).toLocaleString("en-US") : ""}
                          onChange={(e) => {
                            const digits = e.target.value.replace(/[^\d]/g, "");
                            updateDraftRow("value", digits ? Number(digits) : 0);
                          }}
                          placeholder="0"
                          aria-label="Position quantity"
                        />
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div style={inputSectionDivider} aria-hidden />

              <div className="options-optimizer-inputs-cluster" style={{ display: "flex", flex: "0 0 auto", alignSelf: "stretch", alignItems: "stretch" }}>
              {/* Expiration criteria */}
              <div style={inputSectionBlockAuto}>
                <span style={inputSectionLabel}>Expiration criteria</span>
                <div style={inputFieldsRow}>
                  <div style={inputFieldCol}>
                    <label style={labelStyle}>Target</label>
                    <OptimizerThemeSelect
                      theme={t}
                      value={row.targetMode ?? "month"}
                      options={[
                        { value: "month", label: "Month" },
                        { value: "days", label: "DTE" },
                        { value: "expiry", label: "Date" },
                      ]}
                      onChange={(v) => updateDraftRow("targetMode", v as "days" | "expiry" | "month")}
                      dropdownKey={`${row.id}-targetMode`}
                      openId={portfolioDropdownId}
                      setOpenId={setPortfolioDropdownId}
                      minWidth={96}
                    />
                  </div>
                  {(row.targetMode ?? "month") === "month" ? (
                    <>
                      <div style={inputFieldCol}>
                        <label style={labelStyle}>Month</label>
                        <OptimizerThemeSelect
                          theme={t}
                          value={tmMonth}
                          options={MONTH_OPTIONS}
                          onChange={(v) => {
                            const year = tmYear || String(new Date().getFullYear());
                            updateDraftRow("targetMonth", `${year}-${v}`);
                          }}
                          dropdownKey={`${row.id}-tmMonth`}
                          openId={portfolioDropdownId}
                          setOpenId={setPortfolioDropdownId}
                          fixedWidth={MONTH_SELECT_WIDTH}
                          dropdownMaxHeight={220}
                        />
                      </div>
                      <div style={inputFieldCol}>
                        <label style={labelStyle}>Year</label>
                        <input
                          type="text"
                          inputMode="numeric"
                          maxLength={4}
                          style={fieldInput({ maxWidth: 72, minWidth: 72 })}
                          value={tmYear}
                          onChange={(e) => {
                            const yr = e.target.value.replace(/\D/g, "").slice(0, 4);
                            const mo = tmMonth || "01";
                            updateDraftRow("targetMonth", `${yr}-${mo}`);
                          }}
                          placeholder={String(new Date().getFullYear())}
                          aria-label="Expiry year"
                        />
                      </div>
                      <div style={inputFieldCol}>
                        <label style={labelStyle} aria-hidden>
                          &nbsp;
                        </label>
                        <label
                          htmlFor={`monthly-${row.id}`}
                          title="Standard monthly expiry only (3rd Friday)"
                          style={{
                            ...getDropdownTriggerStyle(t),
                            minWidth: 112,
                            maxWidth: 112,
                            justifyContent: "flex-start",
                            gap: t.spacing(1.5),
                            fontSize: t.typography.baseFontSize,
                            fontWeight: 500,
                            cursor: "pointer",
                            userSelect: "none",
                            backgroundColor: row.monthly ? `${t.colors.primary}12` : t.colors.surface,
                            borderColor: row.monthly ? t.colors.primary : t.colors.border,
                          }}
                        >
                          <input
                            type="checkbox"
                            id={`monthly-${row.id}`}
                            checked={row.monthly}
                            onChange={(e) => updateDraftRow("monthly", e.target.checked)}
                            aria-label="Monthly expiration only"
                            style={{ margin: 0, cursor: "pointer", accentColor: t.colors.primary }}
                          />
                          Monthly
                        </label>
                      </div>
                    </>
                  ) : (row.targetMode ?? "month") === "days" ? (
                    <div style={inputFieldCol}>
                      <label style={labelStyle}>Days</label>
                      <input
                        type="number"
                        min={1}
                        style={fieldInput({ maxWidth: 72, minWidth: 72 })}
                        value={row.days || ""}
                        onChange={(e) => updateDraftRow("days", Number(e.target.value) || 0)}
                        placeholder="30"
                        aria-label="Days to expiration"
                      />
                    </div>
                  ) : (
                    <div style={inputFieldCol}>
                      <label style={labelStyle}>Expiry</label>
                      <input
                        type="date"
                        style={fieldInput({ maxWidth: 140, minWidth: 140 })}
                        value={row.targetExpiry ?? ""}
                        onChange={(e) => updateDraftRow("targetExpiry", e.target.value)}
                        aria-label="Target expiry date"
                      />
                    </div>
                  )}
                </div>
              </div>

              <div style={inputSectionDivider} aria-hidden />

              <div style={inputSectionBlockAuto}>
                <HelpTooltip
                  theme={t}
                  text="OTM/ITM filter by percent from spot, or an explicit strike price range."
                >
                  <span style={inputSectionLabel}>Strike filter</span>
                </HelpTooltip>
                <div style={inputFieldsRow}>
                  <div style={inputFieldCol}>
                    <label style={labelStyle}>Filter by</label>
                    <OptimizerThemeSelect
                      theme={t}
                      value={getStrikeFilterKind(row)}
                      options={[
                        { value: "OTM", label: "OTM" },
                        { value: "ITM", label: "ITM" },
                        { value: "strike", label: "Strike price" },
                      ]}
                      onChange={(v) => setDraftRow((prev) => applyStrikeFilterKind(prev, v as StrikeFilterKind))}
                      dropdownKey={`${row.id}-strikeFilterKind`}
                      openId={portfolioDropdownId}
                      setOpenId={setPortfolioDropdownId}
                      minWidth={108}
                    />
                  </div>
                  {getStrikeFilterKind(row) !== "strike" ? (
                    <>
                      <div style={inputFieldCol}>
                        <label style={labelStyle}>Min %</label>
                        <input
                          type="text"
                          inputMode="decimal"
                          style={fieldInput({ maxWidth: 64, minWidth: 64 })}
                          value={row.otmPctMin > 0 ? `${row.otmPctMin}%` : ""}
                          onChange={(e) => {
                            const raw = e.target.value.replace(/%/g, "");
                            updateDraftRow("otmPctMin", Number(raw) || 0);
                          }}
                          placeholder="5%"
                          aria-label="Minimum OTM/ITM percent"
                        />
                      </div>
                      <div style={inputFieldCol}>
                        <label style={labelStyle}>Max %</label>
                        <input
                          type="text"
                          inputMode="decimal"
                          style={fieldInput({ maxWidth: 64, minWidth: 64 })}
                          value={row.otmPctMax > 0 ? `${row.otmPctMax}%` : ""}
                          onChange={(e) => {
                            const raw = e.target.value.replace(/%/g, "");
                            updateDraftRow("otmPctMax", Number(raw) || 0);
                          }}
                          placeholder="15%"
                          aria-label="Maximum OTM/ITM percent"
                        />
                      </div>
                    </>
                  ) : (
                    <>
                      <div style={inputFieldCol}>
                        <label style={labelStyle}>Min $</label>
                        <input
                          type="text"
                          inputMode="decimal"
                          style={fieldInput({ maxWidth: 72, minWidth: 72 })}
                          value={row.strikeMin != null && row.strikeMin > 0 ? String(row.strikeMin) : ""}
                          onChange={(e) => {
                            const raw = e.target.value.replace(/,/g, "").trim();
                            updateDraftRow("strikeMin", raw === "" ? 0 : Number(raw) || 0);
                          }}
                          placeholder="75"
                          aria-label="Minimum strike price"
                        />
                      </div>
                      <div style={inputFieldCol}>
                        <label style={labelStyle}>Max $</label>
                        <input
                          type="text"
                          inputMode="decimal"
                          style={fieldInput({ maxWidth: 72, minWidth: 72 })}
                          value={row.strikeMax != null && row.strikeMax > 0 ? String(row.strikeMax) : ""}
                          onChange={(e) => {
                            const raw = e.target.value.replace(/,/g, "").trim();
                            updateDraftRow("strikeMax", raw === "" ? 0 : Number(raw) || 0);
                          }}
                          placeholder="85"
                          aria-label="Maximum strike price"
                        />
                      </div>
                    </>
                  )}
                </div>
              </div>
              </div>

              <div className="options-optimizer-action-btns" style={actionBtnRow}>
                <button
                  type="button"
                  className="options-optimizer-add-contract-btn"
                  style={addContractBtn}
                  onClick={addQueryContract}
                  aria-label="Add Contract"
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 20 }} aria-hidden>
                    add
                  </span>
                  Add Contract
                </button>
                <button
                  type="button"
                  style={optimizeBtnWide}
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
              </div>
            </>
            );
          })() : (() => {
            const cd = collarDraft;
            const tmParts = (cd.targetMonth ?? "").split("-");
            const tmYear = tmParts[0] ?? "";
            const tmMonth = tmParts[1] ?? "";
            return (
            <>
              <div style={inputSectionBlockAuto}>
                <span style={inputSectionLabel}>Collar setup</span>
                <div style={inputFieldsRowInline}>
                  <div style={inputFieldCol}>
                    <label style={labelStyle}>Ticker</label>
                    <input
                      type="text"
                      placeholder="e.g. SPCX"
                      style={fieldInput({ maxWidth: 96, minWidth: 96 })}
                      value={cd.ticker}
                      onChange={(e) => updateCollarDraft("ticker", e.target.value)}
                      aria-label="Ticker"
                    />
                  </div>
                  <div style={inputFieldCol}>
                    <HelpTooltip theme={t} text="Share count converts to contracts (÷ 100, rounded down) when adding to trade list.">
                      <label style={labelStyle}>Shares</label>
                    </HelpTooltip>
                    <input
                      type="text"
                      inputMode="numeric"
                      style={fieldInput({ maxWidth: 120, minWidth: 120 })}
                      value={cd.shareCount > 0 ? cd.shareCount.toLocaleString("en-US") : ""}
                      onChange={(e) => {
                        const raw = e.target.value.replace(/,/g, "").trim();
                        updateCollarDraft("shareCount", raw === "" ? 0 : Number(raw) || 0);
                      }}
                      placeholder="39,148"
                      aria-label="Share count"
                    />
                  </div>
                  <div style={inputFieldCol}>
                    <label style={labelStyle}>Mode</label>
                    <div
                      role="tablist"
                      aria-label="Collar search mode"
                      style={{
                        display: "inline-flex",
                        border: `1px solid ${t.colors.border}`,
                        borderRadius: t.radius.md,
                        overflow: "hidden",
                        height: 40,
                        boxSizing: "border-box",
                      }}
                    >
                      {(
                        [
                          { id: "goal" as const, label: "Find best" },
                          { id: "exact" as const, label: "Exact strikes" },
                        ] as const
                      ).map((m) => {
                        const active = cd.searchMode === m.id;
                        return (
                          <button
                            key={m.id}
                            type="button"
                            role="tab"
                            aria-selected={active}
                            onClick={() => updateCollarDraft("searchMode", m.id)}
                            style={{
                              border: "none",
                              background: active ? t.colors.secondary : t.colors.surface,
                              color: active ? t.colors.surface : t.colors.textMuted,
                              fontWeight: 600,
                              fontSize: "0.78rem",
                              padding: `0 ${t.spacing(2.5)}`,
                              cursor: "pointer",
                              fontFamily: t.typography.fontFamily,
                              whiteSpace: "nowrap",
                              height: "100%",
                            }}
                          >
                            {m.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
              <div style={inputSectionDivider} aria-hidden />
              <div style={inputSectionBlockAuto}>
                <span style={inputSectionLabel}>Expiration</span>
                <div style={inputFieldsRowInline}>
                  <div style={inputFieldCol}>
                    <label style={labelStyle}>Target</label>
                    <OptimizerThemeSelect
                      theme={t}
                      value={cd.targetMode}
                      options={[
                        { value: "month", label: "Month" },
                        { value: "days", label: "Days" },
                        { value: "expiry", label: "Exact date" },
                      ]}
                      onChange={(v) => updateCollarDraft("targetMode", v as CollarDraft["targetMode"])}
                      dropdownKey="collar-targetMode"
                      openId={portfolioDropdownId}
                      setOpenId={setPortfolioDropdownId}
                      minWidth={108}
                    />
                  </div>
                  {cd.targetMode === "month" ? (
                    <>
                      <div style={inputFieldCol}>
                        <label style={labelStyle}>Month</label>
                        <OptimizerThemeSelect
                          theme={t}
                          value={tmMonth}
                          options={MONTH_OPTIONS}
                          onChange={(v) => {
                            const year = tmYear || String(new Date().getFullYear());
                            updateCollarDraft("targetMonth", `${year}-${v}`);
                          }}
                          dropdownKey="collar-tmMonth"
                          openId={portfolioDropdownId}
                          setOpenId={setPortfolioDropdownId}
                          fixedWidth={MONTH_SELECT_WIDTH}
                          dropdownMaxHeight={220}
                        />
                      </div>
                      <div style={inputFieldCol}>
                        <label style={labelStyle}>Year</label>
                        <input
                          type="text"
                          inputMode="numeric"
                          maxLength={4}
                          style={fieldInput({ maxWidth: 72, minWidth: 72 })}
                          value={tmYear}
                          onChange={(e) => {
                            const yr = e.target.value.replace(/\D/g, "").slice(0, 4);
                            const mo = tmMonth || "01";
                            updateCollarDraft("targetMonth", `${yr}-${mo}`);
                          }}
                          placeholder={String(new Date().getFullYear())}
                          aria-label="Expiry year"
                        />
                      </div>
                      <div style={inputFieldCol}>
                        <label style={labelStyle} aria-hidden>&nbsp;</label>
                        <label
                          htmlFor="collar-monthly"
                          style={{
                            ...getDropdownTriggerStyle(t),
                            minWidth: 112,
                            maxWidth: 112,
                            justifyContent: "flex-start",
                            gap: t.spacing(1.5),
                            fontSize: t.typography.baseFontSize,
                            fontWeight: 500,
                            cursor: "pointer",
                            userSelect: "none",
                            backgroundColor: cd.monthly ? `${t.colors.primary}12` : t.colors.surface,
                            borderColor: cd.monthly ? t.colors.primary : t.colors.border,
                          }}
                        >
                          <input
                            type="checkbox"
                            id="collar-monthly"
                            checked={cd.monthly}
                            onChange={(e) => updateCollarDraft("monthly", e.target.checked)}
                            aria-label="Monthly expiration only"
                            style={{ margin: 0, cursor: "pointer", accentColor: t.colors.primary }}
                          />
                          Monthly
                        </label>
                      </div>
                    </>
                  ) : cd.targetMode === "days" ? (
                    <div style={inputFieldCol}>
                      <label style={labelStyle}>Days</label>
                      <input
                        type="number"
                        min={1}
                        style={fieldInput({ maxWidth: 72, minWidth: 72 })}
                        value={cd.days || ""}
                        onChange={(e) => updateCollarDraft("days", Number(e.target.value) || 0)}
                        placeholder="365"
                        aria-label="Days to expiration"
                      />
                    </div>
                  ) : (
                    <div style={inputFieldCol}>
                      <label style={labelStyle}>Expiry</label>
                      <input
                        type="date"
                        style={fieldInput({ maxWidth: 140, minWidth: 140 })}
                        value={cd.targetExpiry ?? ""}
                        onChange={(e) => updateCollarDraft("targetExpiry", e.target.value)}
                        aria-label="Target expiry date"
                      />
                    </div>
                  )}
                </div>
              </div>
              <div style={inputSectionDivider} aria-hidden />
              {cd.searchMode === "goal" ? (
                <div style={inputSectionBlockAuto}>
                  <HelpTooltip
                    theme={t}
                    text="How much downside protection do you want? We find the call strike that pairs closest to even (Schwab-style), given the expiry above."
                  >
                    <span style={inputSectionLabel}>Protection goal</span>
                  </HelpTooltip>
                  <div style={inputFieldsRowInline}>
                    <div style={inputFieldCol}>
                      <label style={labelStyle}>Target floor %</label>
                      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <input
                          type="text"
                          inputMode="decimal"
                          style={fieldInput({ maxWidth: 68, minWidth: 68 })}
                          value={cd.targetFloorPctText}
                          onChange={(e) => {
                            const raw = e.target.value.replace(/,/g, "");
                            if (raw === "" || /^-?\d*\.?\d*$/.test(raw)) {
                              updateCollarDraft("targetFloorPctText", raw);
                            }
                          }}
                          placeholder="-15"
                          aria-label="Target floor percent"
                        />
                        <span style={{ color: t.colors.textMuted, fontSize: "0.78rem" }}>from spot</span>
                      </div>
                    </div>
                    <div style={inputFieldCol}>
                      <label style={labelStyle} aria-hidden>&nbsp;</label>
                      <button
                        type="button"
                        onClick={() => setCollarAdvancedOpen((o) => !o)}
                        aria-expanded={collarAdvancedOpen}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 2,
                          border: "none",
                          background: "none",
                          color: t.colors.primary,
                          fontSize: "0.78rem",
                          fontWeight: 600,
                          cursor: "pointer",
                          padding: 0,
                          height: 40,
                          fontFamily: t.typography.fontFamily,
                          whiteSpace: "nowrap",
                        }}
                      >
                        {collarAdvancedOpen ? "Hide advanced" : "Advanced"}
                        <span className="material-symbols-outlined" style={{ fontSize: 18 }} aria-hidden>
                          {collarAdvancedOpen ? "expand_less" : "expand_more"}
                        </span>
                      </button>
                    </div>
                    {collarAdvancedOpen && (
                      <div style={inputFieldCol}>
                        <HelpTooltip theme={t} text="Leave at 0 for even ($0 net). Positive = you're willing to pay a debit; negative = you want a credit.">
                          <label style={labelStyle}>Target net $/sh</label>
                        </HelpTooltip>
                        <input
                          type="text"
                          inputMode="decimal"
                          style={fieldInput({ maxWidth: 72, minWidth: 72 })}
                          value={cd.targetNetPerShare !== 0 ? String(cd.targetNetPerShare) : ""}
                          onChange={(e) => {
                            const raw = e.target.value.replace(/,/g, "").trim();
                            updateCollarDraft("targetNetPerShare", raw === "" ? 0 : Number(raw) || 0);
                          }}
                          placeholder="0 (even)"
                          aria-label="Target net dollars per share"
                        />
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div style={inputSectionBlockAuto}>
                  <HelpTooltip theme={t} text="Quotes exactly this put/call pair — bypasses the floor-goal search.">
                    <span style={inputSectionLabel}>Exact strikes</span>
                  </HelpTooltip>
                  <div style={inputFieldsRowInline}>
                    <div style={inputFieldCol}>
                      <label style={labelStyle}>Buy put $</label>
                      <input
                        type="text"
                        inputMode="decimal"
                        style={fieldInput({ maxWidth: 88, minWidth: 88 })}
                        value={cd.customPutStrike}
                        onChange={(e) => updateCollarDraft("customPutStrike", e.target.value)}
                        placeholder="120"
                        aria-label="Custom put strike"
                      />
                    </div>
                    <div style={inputFieldCol}>
                      <label style={labelStyle}>Sell call $</label>
                      <input
                        type="text"
                        inputMode="decimal"
                        style={fieldInput({ maxWidth: 88, minWidth: 88 })}
                        value={cd.customCallStrike}
                        onChange={(e) => updateCollarDraft("customCallStrike", e.target.value)}
                        placeholder="190"
                        aria-label="Custom call strike"
                      />
                    </div>
                  </div>
                </div>
              )}
              <div className="options-optimizer-action-btns" style={actionBtnRow}>
                <button
                  type="button"
                  style={optimizeBtnWide}
                  onClick={runCollarScan}
                  disabled={collarLoading}
                  aria-label="Find best collar"
                >
                  {collarLoading ? (
                    <>
                      <span className="options-pricing-fetch-spinner" aria-hidden />
                      Scanning…
                    </>
                  ) : (
                    "Find Best Collar"
                  )}
                </button>
              </div>
            </>
            );
          })()}
        </div>
        {optimizerMode === "leg-finder" && optimizeMessage && (
          <p style={{ margin: `${t.spacing(1)} 0 0`, paddingBottom: 0, fontSize: "0.8rem", color: t.colors.danger }}>
            {optimizeMessage}{" "}
            {showSchwabAuthHint && (
              <a
                href={`${SCHWAB_API_BASE}/api/schwab?action=auth`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: t.colors.primary, fontWeight: t.typography.headingWeight }}
              >
                Click here to reauthorize Schwab and refresh the token.
              </a>
            )}
          </p>
        )}
        {optimizerMode === "collar" && collarMessage && (
          <p style={{ margin: `${t.spacing(1)} 0 0`, paddingBottom: 0, fontSize: "0.8rem", color: collarResults?.length ? t.colors.textMuted : t.colors.danger }}>
            {collarMessage}{" "}
            {showCollarAuthHint && (
              <a
                href={`${SCHWAB_API_BASE}/api/schwab?action=auth`}
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

      <div className="options-optimizer-main-below-inputs" style={{ marginRight: tradeListClearance }}>
        <div aria-hidden style={{ height: contentTop, pointerEvents: "none" }} />

        {optimizerMode === "leg-finder" && queryContracts.length > 0 && (
          <div
            className="options-optimizer-query-contracts"
            style={{
              padding: `${t.spacing(2)} ${inputsBarPaddingX}`,
              backgroundColor: t.colors.surface,
              borderBottom: `1px solid ${t.colors.border}`,
              boxSizing: "border-box",
              position: "relative",
              zIndex: 1,
            }}
          >
            <span style={{ ...inputSectionLabel, display: "block", marginBottom: t.spacing(1) }}>
              Optimizer queries
              <span style={{ marginLeft: t.spacing(1), color: t.colors.textMuted, fontWeight: 600 }}>
                ({queryContracts.length})
              </span>
            </span>
            <div className="options-optimizer-query-contracts-scroll">
              {queryContracts.map((qc) => (
                <div
                  key={qc.id}
                  className="options-optimizer-card options-optimizer-query-chip"
                  style={{
                    display: "inline-flex",
                    flexDirection: "column",
                    gap: 3,
                    padding: `${t.spacing(1.25)} ${t.spacing(2)}`,
                    backgroundColor: t.colors.background,
                    border: `1px solid ${t.colors.border}`,
                    borderRadius: t.radius.md,
                    boxSizing: "border-box",
                    flexShrink: 0,
                    width: 248,
                    minWidth: 248,
                    maxWidth: 248,
                    minHeight: 74,
                    height: 74,
                    fontSize: "0.78rem",
                    lineHeight: 1.35,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: t.spacing(1),
                      minWidth: 0,
                      flexShrink: 0,
                    }}
                  >
                    <span
                      style={{
                        fontWeight: 700,
                        color: t.colors.text,
                        flexShrink: 0,
                        letterSpacing: "0.02em",
                      }}
                    >
                      {qc.ticker}
                    </span>
                    <span
                      style={{
                        color: t.colors.textMuted,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        minWidth: 0,
                        flex: 1,
                      }}
                    >
                      {formatQueryExpiryHeadline(qc)}
                    </span>
                    {qc.monthly && (
                      <span
                        style={{
                          flexShrink: 0,
                          fontSize: "0.62rem",
                          fontWeight: 700,
                          letterSpacing: "0.04em",
                          textTransform: "uppercase",
                          color: t.colors.primary,
                          backgroundColor: `${t.colors.primary}14`,
                          borderRadius: t.radius.sm,
                          padding: "2px 5px",
                        }}
                      >
                        Mo
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => removeQueryContract(qc.id)}
                      aria-label={`Remove ${qc.ticker} query`}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        width: 24,
                        height: 24,
                        padding: 0,
                        marginLeft: t.spacing(0.5),
                        border: "none",
                        background: "none",
                        cursor: "pointer",
                        color: t.colors.textMuted,
                        flexShrink: 0,
                        borderRadius: t.radius.sm,
                      }}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 18 }} aria-hidden>
                        remove
                      </span>
                    </button>
                  </div>
                  <div
                    style={{
                      color: t.colors.textMuted,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      fontSize: "0.72rem",
                      flex: 1,
                      minHeight: "1.35em",
                    }}
                  >
                    {formatQueryChipSecondary(qc)}
                  </div>
                  <div
                    style={{
                      color: t.colors.text,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      fontSize: "0.72rem",
                      fontWeight: 600,
                      flex: 1,
                      minHeight: "1.35em",
                    }}
                  >
                    {formatQueryPositionLabel(qc)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div
          style={{
            minHeight: centerPanelMinHeight,
          }}
        >
        <div
          className="options-optimizer-center-panel"
          style={{
            backgroundColor: activeResultsTable ? t.colors.surface : t.colors.background,
            minHeight: centerPanelMinHeight,
            display: "flex",
            flexDirection: "column",
            ...resultsPanelStickyStyle,
          }}
        >
          {optimizerMode === "leg-finder" && showResultsTable && (
            <>
            <div style={{ backgroundColor: t.colors.surface }}>
              <div
                ref={resultsTitleRef}
                className="options-optimizer-results-title-sticky"
                style={{
                  padding: `${t.spacing(2)} ${t.spacing(3)}`,
                  borderBottom: `1px solid ${t.colors.border}`,
                  backgroundColor: t.colors.surface,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    justifyContent: "space-between",
                    gap: t.spacing(3),
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <h3 style={{ ...sectionTitleStyle, marginTop: 0, marginBottom: t.spacing(1) }}>
                      Ranked results (yield + upside + risk)
                    </h3>
                    <p style={{ fontSize: "0.8rem", color: t.colors.textMuted, margin: 0 }}>
                      Add rows to your trade list with the + action. Click column headers to sort.
                    </p>
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0, alignSelf: "flex-start" }}>
                    <p style={{ margin: 0, fontSize: "0.9rem", lineHeight: 1.45, color: t.colors.text }}>
                      <strong>Top yield:</strong> {Math.max(...rankedResults!.map((r) => r.annYield)).toFixed(2)}%
                    </p>
                    <p style={{ margin: `${t.spacing(0.5)} 0 0`, fontSize: "0.9rem", lineHeight: 1.45, color: t.colors.text }}>
                      <strong>Avg yield:</strong>{" "}
                      {(rankedResults!.reduce((s, r) => s + r.annYield, 0) / rankedResults!.length).toFixed(2)}%
                    </p>
                  </div>
                </div>
              </div>
              <table
                className="options-optimizer-results-table"
                style={{
                  borderCollapse: "collapse",
                  fontSize: tableFontSize,
                  width: "100%",
                  tableLayout: "fixed",
                  backgroundColor: t.colors.surface,
                }}
              >
                <colgroup>
                  {Array.from({ length: 16 }, (_, i) => (
                    <col key={i} style={{ width: `${100 / 16}%` }} />
                  ))}
                </colgroup>
                <thead className="options-optimizer-results-thead">
                  <tr style={{ borderBottom: `2px solid ${t.colors.border}`, backgroundColor: t.colors.secondary }}>
                    <th style={tableThStyle}>Rank</th>
                    <th style={tableThStyle}>Ticker</th>
                    <SortableOptimizerTh theme={t} sortKey="maturity" tableSort={optimizerTableSort} onCycle={cycleOptimizerTableSort} label="Maturity" textAlign="center" cellPadding={tableCellPadding} thStyle={{ whiteSpace: "nowrap", verticalAlign: "middle" }} />
                    <th style={tableThStyle}>Type</th>
                    <SortableOptimizerTh theme={t} sortKey="strike" tableSort={optimizerTableSort} onCycle={cycleOptimizerTableSort} label="Strike" textAlign="center" cellPadding={tableCellPadding} thStyle={{ whiteSpace: "nowrap", verticalAlign: "middle" }} />
                    <SortableOptimizerTh theme={t} sortKey="moneyness" tableSort={optimizerTableSort} onCycle={cycleOptimizerTableSort} label="Moneyness" textAlign="center" cellPadding={tableCellPadding} thStyle={{ whiteSpace: "nowrap", verticalAlign: "middle" }} />
                    <SortableOptimizerTh theme={t} sortKey="limitPx" tableSort={optimizerTableSort} onCycle={cycleOptimizerTableSort} label="Limit" textAlign="center" cellPadding={tableCellPadding} thStyle={{ whiteSpace: "nowrap", verticalAlign: "middle" }} />
                    <SortableOptimizerTh theme={t} sortKey="periodYield" tableSort={optimizerTableSort} onCycle={cycleOptimizerTableSort} label="Yield" textAlign="center" labelHelp={periodYieldHeaderHelp} labelHelpMaxWidth={320} cellPadding={tableCellPadding} thStyle={{ whiteSpace: "nowrap", verticalAlign: "middle" }} />
                    <SortableOptimizerTh theme={t} sortKey="annYield" tableSort={optimizerTableSort} onCycle={cycleOptimizerTableSort} label="Ann. Yield" textAlign="center" labelHelp={annYieldHeaderHelp} labelHelpMaxWidth={340} cellPadding={tableCellPadding} thStyle={{ whiteSpace: "nowrap", verticalAlign: "middle" }} />
                    <th style={tableNumThStyle}>
                      <HelpTooltip theme={t} text="Probability of Profit = (1 − |delta|) × 100 from Schwab option quote.">
                        <span style={{ cursor: "help" }}>PoP</span>
                      </HelpTooltip>
                    </th>
                    <th style={tableNumThStyle}>
                      <HelpTooltip
                        theme={t}
                        text="Implied volatility from the Schwab option quote, shown as a percentage. Higher IV generally means richer option premiums."
                      >
                        <span style={{ cursor: "help" }}>IV</span>
                      </HelpTooltip>
                    </th>
                    <th style={tableNumThStyle}>
                      <HelpTooltip
                        theme={t}
                        text="Option delta from Schwab — sensitivity to a $1 move in the underlying. Also used to derive PoP for short premium."
                      >
                        <span style={{ cursor: "help" }}>Δ</span>
                      </HelpTooltip>
                    </th>
                    <th style={tableNumThStyle}>
                      <HelpTooltip
                        theme={t}
                        text="Open interest: total outstanding contracts at this strike and expiry. Higher OI often indicates better liquidity."
                      >
                        <span style={{ cursor: "help" }}>OI</span>
                      </HelpTooltip>
                    </th>
                    <th style={tableNumThStyle}>
                      <HelpTooltip
                        theme={t}
                        text="Today's total option volume at this strike and expiry. Higher volume suggests more active trading."
                      >
                        <span style={{ cursor: "help" }}>Vol</span>
                      </HelpTooltip>
                    </th>
                    <SortableOptimizerTh theme={t} sortKey="premiumPerContract" tableSort={optimizerTableSort} onCycle={cycleOptimizerTableSort} label="Premium" textAlign="center" cellPadding={tableCellPadding} thStyle={{ whiteSpace: "nowrap", verticalAlign: "middle" }} />
                    <th style={{ ...tableNumThStyle, padding: tableActionCellPadding }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {displayedRankedResults.map((r) => (
                    <tr key={r.trade.id} style={{ borderBottom: `1px solid ${t.colors.border}`, backgroundColor: t.colors.surface }}>
                      <td style={{ ...tableTdStyle, fontWeight: 600, color: r.rank === 1 ? rankingColors.gold : r.rank === 2 ? rankingColors.silver : r.rank === 3 ? rankingColors.bronze : t.colors.text }}>#{r.rank}</td>
                      <td style={{ ...tableTdStyle, fontWeight: 600, color: t.colors.text }}>{r.ticker}</td>
                      <td style={{ ...tableTdStyle, color: t.colors.text }}>
                        <div style={{ whiteSpace: "nowrap", lineHeight: 1.3 }}>{r.trade.maturity}</div>
                        <div style={{ fontSize: "0.72rem", color: t.colors.textMuted, lineHeight: 1.25, marginTop: 2 }}>
                          {r.trade.daysToMaturity} DTE
                        </div>
                      </td>
                      <td style={{ ...tableTdStyle, color: t.colors.text }}>{r.trade.optionSide.startsWith("PUT") ? "Put" : "Call"}</td>
                      <td style={{ ...tableNumTdStyle, fontWeight: 700 }}>{formatPrice(r.strike)}</td>
                      <td style={{ ...tableNumTdStyle, color: (() => { const m = r.trade.moneynessPct; if (!Number.isFinite(m)) return t.colors.textMuted; const isPut = r.trade.optionSide.startsWith("PUT"); const otm = isPut ? m < 100 : m > 100; return otm ? t.colors.success : t.colors.danger; })(), fontWeight: 600 }}>{Number.isFinite(r.trade.moneynessPct) ? `${r.trade.moneynessPct.toFixed(1)}%` : "—"}</td>
                      <td style={{ ...tableNumTdStyle }}>
                        <div style={{ fontWeight: 700, lineHeight: 1.3 }}>${r.limitPrice.toFixed(2)}</div>
                        <div style={{ fontSize: "0.72rem", color: t.colors.textMuted, lineHeight: 1.25, marginTop: 2, whiteSpace: "nowrap" }}>
                          {r.trade.currentBid.toFixed(2)}/{r.trade.currentAsk.toFixed(2)}
                        </div>
                      </td>
                      <td style={{ ...tableNumTdStyle, fontWeight: 600, color: r.trade.yieldAtCurrentPrice >= 0 ? t.colors.success : t.colors.danger }}>{r.trade.yieldAtCurrentPrice}%</td>
                      <td style={{ ...tableNumTdStyle, fontWeight: 600, color: r.annYield >= 0 ? t.colors.success : t.colors.danger }}>{r.annYield}%</td>
                      <td style={{ ...tableNumTdStyle, fontWeight: 600, color: t.colors.textMuted }}>{r.delta != null ? `${((1 - Math.abs(r.delta)) * 100).toFixed(0)}%` : "—"}</td>
                      <td style={{ ...tableNumTdStyle, color: t.colors.textMuted }}>{r.ivPct != null ? `${r.ivPct.toFixed(1)}%` : "—"}</td>
                      <td style={{ ...tableNumTdStyle, color: t.colors.textMuted }}>{r.delta != null ? r.delta.toFixed(2) : "—"}</td>
                      <td style={{ ...tableNumTdStyle, color: t.colors.textMuted }}>{r.openInterest != null ? r.openInterest.toLocaleString() : "—"}</td>
                      <td style={{ ...tableNumTdStyle, color: t.colors.textMuted }}>{r.totalVolume != null ? r.totalVolume.toLocaleString() : "—"}</td>
                      <td style={{ ...tableNumTdStyle, color: r.premiumPerContract >= 0 ? t.colors.success : t.colors.danger, fontWeight: 600 }}>{formatMoneyFull(r.premiumPerContract)}</td>
                      <td style={{ ...tableNumTdStyle, padding: tableActionCellPadding }}>
                        <div style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: t.spacing(1) }}>
                          {(r.trade.optionSide === "PUT - SELL to OPEN" || r.trade.optionSide === "CALL - SELL to OPEN") && (
                            <button
                              type="button"
                              onClick={() => {
                                const isPut = r.trade.optionSide === "PUT - SELL to OPEN";
                                setPayoffModal({
                                  title: `${r.trade.ticker} ${isPut ? "cash-secured put" : "covered call"}`,
                                  subtitle: `${formatPrice(r.trade.strikePrice)} ${isPut ? "put" : "call"} · ${r.trade.maturity} · ${r.trade.daysToMaturity} DTE`,
                                  input: isPut
                                    ? { kind: "cashSecuredPut", spot: r.trade.currentPrice, putStrike: r.trade.strikePrice, premiumPerShare: r.trade.optionLimitPrice }
                                    : { kind: "coveredCall", spot: r.trade.currentPrice, callStrike: r.trade.strikePrice, premiumPerShare: r.trade.optionLimitPrice },
                                  shares: 0,
                                  daysToMaturity: r.trade.daysToMaturity,
                                });
                              }}
                              title="View payoff chart"
                              aria-label="View payoff chart"
                              style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 32, height: 32, padding: 0, border: "none", background: "none", cursor: "pointer", color: t.colors.textMuted, borderRadius: "50%" }}
                            >
                              <span className="material-symbols-outlined" style={{ fontSize: 20 }} aria-hidden>show_chart</span>
                            </button>
                          )}
                          <button type="button" onClick={() => addToTradeList(r)} title="Add to trade list" aria-label="Add to trade list" className="options-optimizer-add-trade" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 32, height: 32, padding: 0, border: "none", background: "none", cursor: "pointer", color: t.colors.primary, borderRadius: "50%", position: "relative" }}>
                            <span className="material-symbols-outlined" style={{ fontSize: 22, position: "absolute", opacity: addedResultIds.has(r.trade.id) ? 0 : 1, transition: "opacity 0.2s ease", pointerEvents: "none" }} aria-hidden>add_circle</span>
                            <span className="material-symbols-outlined" style={{ fontSize: 22, position: "absolute", opacity: addedResultIds.has(r.trade.id) ? 1 : 0, transition: "opacity 0.2s ease", pointerEvents: "none" }} aria-hidden>check_circle</span>
                          </button>
                          <button type="button" onClick={() => { const text = formatRankedRowForCopy(r); void navigator.clipboard.writeText(text); setLastCopiedTradeId(r.trade.id); window.setTimeout(() => setLastCopiedTradeId((prev) => (prev === r.trade.id ? null : prev)), 1200); }} title="Copy row details" aria-label="Copy row details" className="options-optimizer-copy-symbol" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 32, height: 32, padding: 0, border: "none", background: "none", cursor: "pointer", color: t.colors.textMuted, borderRadius: t.radius.sm, position: "relative" }}>
                            <span className="material-symbols-outlined" style={{ fontSize: 20, position: "absolute", opacity: lastCopiedTradeId === r.trade.id ? 0 : 1, transition: "opacity 0.2s ease", pointerEvents: "none" }} aria-hidden>content_copy</span>
                            <span className="material-symbols-outlined" style={{ fontSize: 20, position: "absolute", opacity: lastCopiedTradeId === r.trade.id ? 1 : 0, transition: "opacity 0.2s ease", pointerEvents: "none" }} aria-hidden>check</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <footer
              style={{
                padding: `${t.spacing(2)} ${tableCellPadX}`,
                paddingRight: tableEdgePadRight,
                fontSize: "0.78rem",
                color: t.colors.textMuted,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: t.spacing(2),
                flexWrap: "wrap",
                backgroundColor: t.colors.surface,
              }}
            >
              {schwabAttribution}
            </footer>
            </>
          )}

          {optimizerMode === "collar" && showCollarResultsTable && (
            <>
            <div style={{ backgroundColor: t.colors.surface }}>
              <div
                ref={resultsTitleRef}
                className="options-optimizer-results-title-sticky"
                style={{
                  padding: `${t.spacing(2)} ${t.spacing(3)}`,
                  borderBottom: `1px solid ${t.colors.border}`,
                  backgroundColor: t.colors.surface,
                }}
              >
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: t.spacing(3) }}>
                  <div style={{ minWidth: 0 }}>
                    <h3 style={{ ...sectionTitleStyle, marginTop: 0, marginBottom: t.spacing(1) }}>
                      Collar results
                    </h3>
                    <p style={{ fontSize: "0.8rem", color: t.colors.textMuted, margin: 0 }}>
                      {collarMessage ?? "Net/sh at mid (Schwab Even). Exec subline = put ask − call bid."}
                    </p>
                  </div>
                  {collarSpot != null && (
                    <div style={{ textAlign: "right", flexShrink: 0, alignSelf: "flex-start" }}>
                      <p style={{ margin: 0, fontSize: "0.9rem", lineHeight: 1.45, color: t.colors.text }}>
                        <strong>Spot:</strong> ${collarSpot.toFixed(2)}
                      </p>
                    </div>
                  )}
                </div>
              </div>
              <table
                className="options-optimizer-results-table"
                style={{
                  borderCollapse: "collapse",
                  fontSize: tableFontSize,
                  width: "100%",
                  tableLayout: "fixed",
                  backgroundColor: t.colors.surface,
                }}
              >
                <colgroup>
                  {Array.from({ length: 11 }, (_, i) => (
                    <col key={i} style={{ width: `${100 / 11}%` }} />
                  ))}
                </colgroup>
                <thead className="options-optimizer-results-thead">
                  <tr style={{ borderBottom: `2px solid ${t.colors.border}`, backgroundColor: t.colors.secondary }}>
                    <th style={tableThStyle}>Rank</th>
                    <th style={tableThStyle}>Expiry</th>
                    <th style={tableThStyle}>Put</th>
                    <th style={tableThStyle}>Call</th>
                    <th style={tableThStyle}>Net/sh</th>
                    <th style={tableThStyle}>Floor</th>
                    <th style={tableThStyle}>Cap</th>
                    <th style={tableThStyle}>Band</th>
                    <th style={tableThStyle}>
                      <HelpTooltip
                        theme={t}
                        text={collarDraft.shareCount > 0 ? "Total collar cost/credit at mid for your share count." : "Net at mid per option contract (×100 sh)."}
                      >
                        <span style={{ cursor: "help" }}>{collarDraft.shareCount > 0 ? "Total $" : "Net/ctr"}</span>
                      </HelpTooltip>
                    </th>
                    <th style={tableThStyle}>DTE</th>
                    <th style={{ ...tableNumThStyle, padding: tableActionCellPadding }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {collarResults!.map((r) => {
                    const positionTotal = formatCollarPositionTotal(r, collarDraft.shareCount);
                    const netMid = collarNetMidPerShare(r);
                    return (
                    <tr key={collarPairKey(r)} style={{ borderBottom: `1px solid ${t.colors.border}`, backgroundColor: t.colors.surface }}>
                      <td style={{ ...tableTdStyle, fontWeight: 600, color: r.rank === 1 ? rankingColors.gold : r.rank === 2 ? rankingColors.silver : r.rank === 3 ? rankingColors.bronze : t.colors.text }}>#{r.rank}</td>
                      <td style={{ ...tableTdStyle, color: t.colors.text }}>{r.expiry}</td>
                      <td style={{ ...tableNumTdStyle }}>
                        <div style={{ fontWeight: 700 }}>{formatPrice(r.putStrike)}</div>
                        <div style={{ fontSize: "0.72rem", color: t.colors.textMuted, marginTop: 2 }}>{r.put.bid.toFixed(2)}/{r.put.ask.toFixed(2)}</div>
                      </td>
                      <td style={{ ...tableNumTdStyle }}>
                        <div style={{ fontWeight: 700 }}>{formatPrice(r.callStrike)}</div>
                        <div style={{ fontSize: "0.72rem", color: t.colors.textMuted, marginTop: 2 }}>{r.call.bid.toFixed(2)}/{r.call.ask.toFixed(2)}</div>
                      </td>
                      <td style={{ ...tableNumTdStyle }}>
                        <div style={{ fontWeight: 600, color: r.isEven ? t.colors.success : netMid > 0 ? t.colors.danger : t.colors.text }}>
                          {netMid >= 0 ? "+" : "−"}${Math.abs(netMid).toFixed(2)}
                        </div>
                        <div style={{ fontSize: "0.72rem", color: t.colors.textMuted, marginTop: 2 }} title="Executable: put ask − call bid">
                          exec {(r.netCostPerShare >= 0 ? "+" : "−")}${Math.abs(r.netCostPerShare).toFixed(2)}
                        </div>
                      </td>
                      <td style={{ ...tableNumTdStyle, color: t.colors.danger, fontWeight: 600 }}>{r.floorPct}%</td>
                      <td style={{ ...tableNumTdStyle, color: t.colors.success, fontWeight: 600 }}>+{r.capPct}%</td>
                      <td style={{ ...tableNumTdStyle, color: t.colors.textMuted }}>{r.bandWidthPct}%</td>
                      <td style={{
                        ...tableNumTdStyle,
                        fontWeight: 600,
                        color: positionTotal.value > 0 ? t.colors.danger : positionTotal.value < 0 ? t.colors.success : t.colors.text,
                      }}>
                        {positionTotal.value >= 0 ? "+" : ""}
                        {Math.abs(positionTotal.value) >= 1000
                          ? formatMoney(positionTotal.value)
                          : formatMoneyFull(positionTotal.value)}
                      </td>
                      <td style={{ ...tableNumTdStyle, color: t.colors.textMuted }}>{r.daysToMaturity}</td>
                      <td style={{ ...tableNumTdStyle, padding: tableActionCellPadding }}>
                        <div style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: t.spacing(1) }}>
                          <button
                            type="button"
                            onClick={() =>
                              setPayoffModal({
                                title: `${r.ticker} collar`,
                                subtitle: `${formatPrice(r.putStrike)} put / ${formatPrice(r.callStrike)} call · ${r.expiry} · ${r.daysToMaturity} DTE`,
                                input: {
                                  kind: "collar",
                                  spot: r.spot,
                                  putStrike: r.putStrike,
                                  callStrike: r.callStrike,
                                  netPerShare: netMid,
                                },
                                shares: collarDraft.shareCount,
                                daysToMaturity: r.daysToMaturity,
                              })
                            }
                            title="View payoff chart"
                            aria-label="View payoff chart"
                            style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 32, height: 32, padding: 0, border: "none", background: "none", cursor: "pointer", color: t.colors.textMuted, borderRadius: "50%" }}
                          >
                            <span className="material-symbols-outlined" style={{ fontSize: 20 }} aria-hidden>show_chart</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => addCollarToTradeList(r)}
                            title="Add collar legs to trade list"
                            aria-label="Add collar to trade list"
                            className="options-optimizer-add-trade"
                            style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 32, height: 32, padding: 0, border: "none", background: "none", cursor: "pointer", color: t.colors.primary, borderRadius: "50%", position: "relative" }}
                          >
                            <span className="material-symbols-outlined" style={{ fontSize: 22, position: "absolute", opacity: addedCollarKeys.has(collarPairKey(r)) ? 0 : 1, transition: "opacity 0.2s ease", pointerEvents: "none" }} aria-hidden>add_circle</span>
                            <span className="material-symbols-outlined" style={{ fontSize: 22, position: "absolute", opacity: addedCollarKeys.has(collarPairKey(r)) ? 1 : 0, transition: "opacity 0.2s ease", pointerEvents: "none" }} aria-hidden>check_circle</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <footer
              style={{
                padding: `${t.spacing(2)} ${tableCellPadX}`,
                paddingRight: tableEdgePadRight,
                fontSize: "0.78rem",
                color: t.colors.textMuted,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: t.spacing(2),
                flexWrap: "wrap",
                backgroundColor: t.colors.surface,
              }}
            >
              {schwabAttribution}
            </footer>
            </>
          )}

          {((optimizerMode === "leg-finder" && !showResultsTable) ||
            (optimizerMode === "collar" && !showCollarResultsTable && !collarLoading)) && (
            <div
              style={{
                flex: queryContracts.length > 0 ? "0 0 auto" : 1,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                padding: t.spacing(6),
                textAlign: "center",
                color: t.colors.textMuted,
                minHeight: queryContracts.length > 0 ? 200 : 280,
              }}
            >
              <span
                className="material-symbols-outlined"
                style={{ fontSize: 40, opacity: 0.35, marginBottom: t.spacing(2) }}
                aria-hidden
              >
                {optimizerMode === "leg-finder"
                  ? queryContracts.length === 0
                    ? "playlist_add"
                    : rankedResults
                      ? "search_off"
                      : "tune"
                  : collarResults
                    ? "search_off"
                    : "shield"}
              </span>
              <p style={{ margin: 0, fontSize: "0.95rem", fontWeight: 600, color: t.colors.text }}>
                {optimizerMode === "leg-finder"
                  ? queryContracts.length === 0
                    ? "No contracts in query"
                    : rankedResults
                      ? "No ranked candidates"
                      : "Ready to optimize"
                  : collarResults
                    ? "No collar pairs found"
                    : "Ready to scan collars"}
              </p>
              <p style={{ margin: `${t.spacing(1.5)} 0 0`, fontSize: "0.875rem", maxWidth: 420, lineHeight: 1.5 }}>
                {optimizerMode === "leg-finder"
                  ? queryContracts.length === 0
                    ? "Fill in the inputs above, then click Add Contract to build your query."
                    : rankedResults
                      ? optimizeMessage ?? "No options matched your query settings. Try widening the strike band or expiry window."
                      : "Click Optimize Portfolio to fetch live Schwab chains and rank results here."
                  : collarResults
                    ? collarMessage ?? "Try another month, turn off Monthly-only, or enter custom put/call strikes."
                    : "Enter a ticker and expiry, then click Find Best Collar to scan live chains for protective collar pairs."}
              </p>
              <p
                style={{
                  margin: `${t.spacing(2)} 0 0`,
                  fontSize: "0.75rem",
                  color: t.colors.textMuted,
                  lineHeight: 1.4,
                }}
              >
                Market data provided by Charles Schwab.
                {lastUpdated && (
                  <>
                    {" "}
                    · Data as of{" "}
                    {lastUpdated.toLocaleString(undefined, {
                      year: "numeric",
                      month: "short",
                      day: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </>
                )}
              </p>
            </div>
          )}
        </div>

        </div>
      </div>

      <button
        type="button"
        onClick={() => setTradeListPanelOpen(true)}
        aria-label="Open trade list"
        className="options-optimizer-trade-tab"
        style={{
          position: "fixed",
          right: 0,
          top: mainTop,
          bottom: 0,
          width: 40,
          zIndex: 22,
          border: "none",
          borderLeft: `1px solid ${t.colors.border}`,
          backgroundColor: t.colors.surface,
          cursor: "pointer",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "flex-start",
          paddingTop: t.spacing(3),
          gap: t.spacing(1.5),
          fontFamily: t.typography.fontFamily,
          opacity: tradeListPanelOpen ? 0 : 1,
          pointerEvents: tradeListPanelOpen ? "none" : "auto",
        }}
      >
          <span className="material-symbols-outlined" style={{ fontSize: 20, color: t.colors.textMuted }} aria-hidden>
            chevron_left
          </span>
          <span
            style={{
              writingMode: "vertical-rl",
              transform: "rotate(180deg)",
              fontSize: "0.68rem",
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: t.colors.secondary,
            }}
          >
            Trade list
          </span>
          {trades.length > 0 && (
            <span
              className="options-optimizer-trade-tab-count"
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 24,
                height: 24,
                minWidth: 24,
                minHeight: 24,
                borderRadius: "50%",
                fontSize: "0.68rem",
                fontWeight: 700,
                color: t.colors.surface,
                backgroundColor: t.colors.primary,
                lineHeight: 1,
                flexShrink: 0,
                boxShadow: "0 1px 3px rgba(15, 42, 54, 0.18)",
              }}
            >
              {trades.length}
            </span>
          )}
        </button>

      <div
        role="presentation"
        className="options-optimizer-trade-backdrop"
        onClick={() => setTradeListPanelOpen(false)}
        style={{
          position: "fixed",
          left: sidebarWidth,
          right: 0,
          top: mainTop,
          bottom: 0,
          zIndex: 19,
          backgroundColor: "rgba(15, 42, 54, 0.12)",
          opacity: tradeListPanelOpen ? 1 : 0,
          pointerEvents: tradeListPanelOpen ? "auto" : "none",
        }}
      />
      <aside
        className="options-optimizer-trade-drawer"
        aria-hidden={!tradeListPanelOpen}
        inert={!tradeListPanelOpen ? true : undefined}
        style={{
          position: "fixed",
          right: 0,
          top: mainTop,
          width: tradeListPanelWidth,
          height: `calc(100vh - ${mainTop}px)`,
          zIndex: 20,
          borderLeft: `1px solid ${t.colors.border}`,
          backgroundColor: t.colors.surface,
          boxShadow: "-8px 0 24px rgba(15, 42, 54, 0.12)",
          display: "flex",
          flexDirection: "column",
          transform: tradeListPanelOpen ? "translateX(0)" : `translateX(${tradeListPanelWidth}px)`,
          pointerEvents: tradeListPanelOpen ? "auto" : "none",
        }}
      >
        <div
          className="page-card"
          style={{
            ...fixedRails.railPanel,
            gap: t.spacing(2),
            height: "100%",
            boxSizing: "border-box",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: t.spacing(1) }}>
            <div style={{ display: "flex", alignItems: "center", gap: t.spacing(1.5), minWidth: 0 }}>
              <h3 style={{ ...sectionTitleStyle, marginBottom: 0 }}>Trade list</h3>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: t.spacing(1) }}>
            <button
              type="button"
              onClick={() => void exportTradesForSheets()}
              title="Copy for Google Sheets"
              aria-label="Copy trade list for Google Sheets"
              disabled={trades.length === 0 || exportingTradeList}
              className="options-optimizer-copy-symbol"
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 30,
                height: 30,
                padding: 0,
                border: "none",
                background: "none",
                cursor: trades.length === 0 || exportingTradeList ? "not-allowed" : "pointer",
                color: "#000000",
                borderRadius: "50%",
                position: "relative",
                opacity: trades.length === 0 || exportingTradeList ? 0.45 : 1,
                flexShrink: 0,
              }}
            >
              {exportingTradeList ? (
                <span
                  className="options-pricing-fetch-spinner"
                  style={{
                    color: t.colors.primary,
                    marginRight: 0,
                    width: 18,
                    height: 18,
                    borderWidth: 2,
                  }}
                  aria-hidden
                />
              ) : (
                <>
                  <span
                    className="material-symbols-outlined"
                    style={{
                      fontSize: 20,
                      position: "absolute",
                      opacity: tradeListExportCopied ? 0 : 1,
                      transition: "opacity 0.2s ease",
                      pointerEvents: "none",
                      color: "#000000",
                    }}
                    aria-hidden
                  >
                    content_copy
                  </span>
                  <span
                    className="material-symbols-outlined"
                    style={{
                      fontSize: 20,
                      position: "absolute",
                      opacity: tradeListExportCopied ? 1 : 0,
                      transition: "opacity 0.2s ease",
                      pointerEvents: "none",
                      color: t.colors.primary,
                    }}
                    aria-hidden
                  >
                    check_circle
                  </span>
                </>
              )}
            </button>
            <button
              type="button"
              onClick={() => setTradeListPanelOpen(false)}
              aria-label="Close trade list"
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 30,
                height: 30,
                padding: 0,
                border: "none",
                background: "none",
                cursor: "pointer",
                color: t.colors.textMuted,
                borderRadius: t.radius.sm,
                flexShrink: 0,
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 22 }} aria-hidden>
                chevron_right
              </span>
            </button>
            </div>
          </div>
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
                        <div><div style={labelStyle}>Strike</div><div style={{ fontSize: "0.8rem", fontWeight: 700, color: t.colors.text }}>${tr.strikePrice.toFixed(2)}</div></div>
                        <div><div style={labelStyle}>Spot</div><div style={{ fontSize: "0.8rem", color: t.colors.text }}>${tr.currentPrice.toFixed(2)}</div></div>
                        <div><div style={labelStyle}>Limit Px</div><div style={{ fontSize: "0.8rem", fontWeight: 700, color: t.colors.primary }}>${tr.optionLimitPrice.toFixed(2)}</div></div>
                        <div><div style={labelStyle}>Bid / Ask</div><div style={{ fontSize: "0.8rem", color: t.colors.text }}>${tr.currentBid.toFixed(2)} / ${tr.currentAsk.toFixed(2)}</div></div>
                        <div><div style={labelStyle}>Contracts</div><div style={{ fontSize: "0.8rem", color: t.colors.text }}>{tr.contracts.toLocaleString()}</div></div>
                        <div><div style={labelStyle}>Moneyness</div><div style={{ fontSize: "0.8rem", color: t.colors.text }}>{Number.isFinite(tr.moneynessPct) ? `${tr.moneynessPct.toFixed(2)}%` : "—"}</div></div>
                        <div><div style={labelStyle}>Yield</div><div style={{ fontSize: "0.8rem", color: t.colors.text }}>{tr.yieldAtCurrentPrice}%</div></div>
                        <div><div style={labelStyle}>Notional</div><div style={{ fontSize: "0.8rem", color: t.colors.text }}>{formatNotionalCompact(tr.valueOfSharesAtStrike)}</div></div>
                        {tr.figi && (
                          <div style={{ gridColumn: "1 / -1" }}>
                            <div style={labelStyle}>FIGI</div>
                            <div style={{ fontFamily: "monospace", fontSize: "0.8rem", color: t.colors.text }}>{tr.figi}</div>
                          </div>
                        )}
                        {tr.cusip && (
                          <div style={{ gridColumn: "1 / -1" }}>
                            <div style={labelStyle}>Underlying CUSIP</div>
                            <div style={{ fontFamily: "monospace", fontSize: "0.8rem", color: t.colors.text }}>{tr.cusip}</div>
                          </div>
                        )}
                      </div>
                      <div style={{ marginTop: t.spacing(2), display: "flex", flexDirection: "column", alignItems: "center", gap: t.spacing(1) }}>
                        {figiStatusById[tr.id]?.msg && (
                          <div style={{ fontSize: "0.7rem", color: figiStatusById[tr.id].ok ? t.colors.success : t.colors.danger, textAlign: "center" }}>
                            {figiStatusById[tr.id].msg}
                          </div>
                        )}
                        <div style={{ display: "flex", justifyContent: "center", gap: t.spacing(1.5) }}>
                        <button
                          type="button"
                          onClick={() => fetchTradeIdentifiers(tr.id, tr)}
                          disabled={fetchingFigiForId === tr.id}
                          style={{ ...secondaryBtnStyle, padding: `${t.spacing(0.5)} ${t.spacing(2)}`, fontSize: "0.75rem", opacity: fetchingFigiForId === tr.id ? 0.6 : 1 }}
                          aria-label="Fetch FIGI"
                        >
                          {fetchingFigiForId === tr.id ? "Fetching…" : "Fetch FIGI"}
                        </button>
                        <button
                          type="button"
                          onClick={() => removeTrade(tr.id)}
                          style={{ ...secondaryBtnStyle, padding: `${t.spacing(0.5)} ${t.spacing(2)}`, fontSize: "0.75rem", color: t.colors.danger, borderColor: t.colors.danger }}
                          aria-label="Remove trade"
                        >
                          Remove
                        </button>
                        </div>
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
