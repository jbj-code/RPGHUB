// OptionsScreener.tsx
// Market-wide options screener: scan US equities for top OTM put/call ideas by yield band.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Theme } from "../theme";
import {
  getFixedRailsLayoutStyles,
  getPrimaryActionButtonStyle,
  getRailFooterActionButtonLayout,
  getDropdownTriggerStyle,
  getDropdownPanelStyle,
  getDropdownOptionStyle,
  getTooltipBubbleStyle,
  zIndex,
  THEME_DROPDOWN_OPTION_CLASS,
  PAGE_LAYOUT,
  getPageCardStyle,
  rankingColors,
} from "../theme";
import { createPortal } from "react-dom";
import { OPPORTUNITY_BUCKETS, type OpportunityBucket } from "../lib/opportunityBuckets";

import { SCHWAB_API_BASE } from "../constants";

// --- Types ---

type OptionType = "puts" | "calls";
type PositionSide = "write" | "buy";

type RankedOption = {
  rank: number;
  ticker: string;
  company: string;
  oneMonthPerfPct: number | null;
  otmPct: number;
  /** Real OTM % from strike vs spot (e.g. 7.3 % for a strike $7.30 OTM on a $100 stock). */
  actualOtmPct?: number;
  currentPrice: number;
  strike: number;
  bid: number;
  ask?: number;
  limitPrice?: number;
  annYieldPct: number;
  /** Premium ÷ strike notional for this expiry (not annualized). */
  periodYieldPct?: number;
  premiumPerContract: number;
  impliedVolPct?: number | null;
  realizedVol20dPct?: number | null;
  /** Put-call skew (avg OTM put IV − avg OTM call IV) in percentage points. Positive = puts pricier. */
  skewPct?: number | null;
  /** |delta| from option quote — probability of finishing ITM / being assigned. */
  delta?: number | null;
  /** Theta: dollars of time decay per contract per day (positive = earned for writes). */
  thetaPerDay?: number | null;
  schwabSymbol: string;
  occSymbol: string;
  liquidityFlags?: string[];
};

type ScanDepth = "quick" | "standard" | "deep";
type LiquidityMode = "strict" | "relaxed" | "all";

const SCAN_DEPTH_OPTIONS: { value: ScanDepth; label: string; hint: string }[] = [
  { value: "quick", label: "Quick", hint: "~280 names · 120 chains" },
  { value: "standard", label: "Standard", hint: "~500 names · 180 chains" },
  { value: "deep", label: "Deep", hint: "Full S&P · 250 chains" },
];

const LIQUIDITY_MODE_OPTIONS: { value: LiquidityMode; label: string }[] = [
  { value: "strict", label: "Strict" },
  { value: "relaxed", label: "Relaxed" },
  { value: "all", label: "Show all" },
];

type ScreenerResponse = {
  resultsByOtmPct: Record<number, RankedOption[]>;
  message: string | null;
  warnings?: string[];
  expiration?: string;
  optionType?: "P" | "C";
  dte?: number;
  positionSide?: "write" | "buy";
  otmLayout?: OtmLayout;
  otmRange?: { min: number; max: number };
};

const OTM_LEVELS = [5, 10, 15, 20] as const;
/** Backend key for custom min–max OTM range (single results table). */
const CUSTOM_OTM_KEY = 0;

type OtmLayout = "bands" | "range";

const MONTH_OPTIONS: DropdownOption[] = [
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

// --- Helpers ---

/** Premium per contract: dollar sign, plain integer, no K abbreviation. e.g. $2,275 or $340 */
function formatPremium(n: number): string {
  const rounded = Math.round(Math.abs(n));
  return (n < 0 ? "−$" : "$") + rounded.toLocaleString("en-US");
}

function formatPct(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

function formatVolPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n.toFixed(1)}%`;
}

/** Build a tab-separated string for the given bucket — paste directly into Excel.
 *  IV, RV and Ann.Yield are in decimal form (0.83 = 83%) for easy Excel calculations. */
function buildBucketTsv(rows: RankedOption[], positionSide: PositionSide, dte?: number | null): string {
  const n = (v: number | null | undefined, d = 2) => (v == null || !Number.isFinite(v) ? "" : v.toFixed(d));
  const pct = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? "" : (v / 100).toFixed(4));
  const headers = [
    "Rank", "Ticker", "Company", "1M Return", "Price", "Strike", "OTM %",
    "IV", "RV 20d", "Skew", "Bid", "Ask",
    positionSide === "buy" ? "Period debit %" : "Period yield %",
    positionSide === "buy" ? "Ann. Debit" : "Ann. Yield",
    positionSide === "buy" ? "Debit ($)" : "Premium ($)",
  ];
  const dataRows = rows.map((r) => [
    r.rank,
    r.ticker,
    r.company,
    pct(r.oneMonthPerfPct),
    n(r.currentPrice),
    n(r.strike),
    n(r.actualOtmPct),
    pct(r.impliedVolPct),
    pct(r.realizedVol20dPct),
    r.skewPct != null ? n(r.skewPct, 1) : "",
    n(r.bid),
    n(r.ask ?? r.bid),
    pct(periodYieldFromRow(r, dte)),
    pct(r.annYieldPct),
    n(r.premiumPerContract),
  ].join("\t"));
  return [headers.join("\t"), ...dataRows].join("\n");
}

function formatStrikePrice(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return Number.isInteger(n) ? `$${n.toLocaleString("en-US")}` : `$${n.toFixed(2)}`;
}

function toISODateUTC(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// NYSE is closed on Good Friday. When Good Friday falls on the 3rd Friday of a month,
// the standard monthly option expiration shifts to that Thursday instead.
const HOLIDAY_FRIDAYS = new Set([
  "2025-04-18", // Good Friday 2025 → April expiry shifts to Apr 17
  "2030-04-19", // Good Friday 2030 → April expiry shifts to Apr 18
]);

function getThirdFridayUTC(year: number, monthIndex0: number): Date {
  const first = new Date(Date.UTC(year, monthIndex0, 1));
  const day = first.getUTCDay();
  const offset = (5 - day + 7) % 7;
  const thirdFriday = new Date(Date.UTC(year, monthIndex0, 1 + offset + 14));
  // Shift to Thursday if the 3rd Friday is a market holiday
  const iso = toISODateUTC(thirdFriday);
  if (HOLIDAY_FRIDAYS.has(iso)) {
    return new Date(thirdFriday.getTime() - 24 * 60 * 60 * 1000);
  }
  return thirdFriday;
}

function getMonthlyThirdFridayExpirations(maxMonthsAhead: number): { value: string; label: string }[] {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const out: { value: string; label: string }[] = [];
  for (let i = 0; i <= maxMonthsAhead; i++) {
    const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1));
    const thirdFriday = getThirdFridayUTC(d.getUTCFullYear(), d.getUTCMonth());
    if (thirdFriday.getTime() < start.getTime()) continue;
    const value = toISODateUTC(thirdFriday);
    const label = thirdFriday.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "2-digit",
      timeZone: "UTC",
    });
    out.push({ value, label });
  }
  return out;
}

type DropdownOption = { value: string; label: string };

// --- Dropdowns ---

function ExpirationDropdown(props: {
  theme: Theme;
  value: string;
  options: DropdownOption[];
  onChange: (v: string) => void;
  openId: string | null;
  setOpenId: (id: string | null) => void;
  dropdownKey: string;
  dropdownMaxHeight?: number;
}) {
  const { theme: t, value, options, onChange, openId, setOpenId, dropdownKey, dropdownMaxHeight } = props;
  const open = openId === dropdownKey;
  const display =
    options.find((o) => o.value === value)?.label ?? (value ? value : "— Select Expiration —");

  return (
    <div style={{ position: "relative", width: "100%" }}>
      <button
        type="button"
        onClick={() => setOpenId(open ? null : dropdownKey)}
        style={{ ...getDropdownTriggerStyle(t), width: "100%" }}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, textAlign: "left" }}>
          {display}
        </span>
        <span className="material-symbols-outlined" style={{ fontSize: 18, flexShrink: 0 }}>expand_more</span>
      </button>

      {open && (
        <>
          <div
            role="presentation"
            style={{ position: "fixed", inset: 0, zIndex: zIndex.dropdownPortalBackdrop }}
            onClick={() => setOpenId(null)}
          />
          <div style={{
            ...getDropdownPanelStyle(t, "down"),
            zIndex: zIndex.dropdownPortal,
            ...(dropdownMaxHeight != null ? { maxHeight: dropdownMaxHeight, overflowY: "auto" } : {}),
          }}>
            {options.map((o) => (
              <button
                key={o.value}
                type="button"
                className={THEME_DROPDOWN_OPTION_CLASS}
                onClick={() => { onChange(o.value); setOpenId(null); }}
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

// Portal-based tooltip for reliable positioning across fixed panels
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
  const offsetY = 22;
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
      onFocus={(e) => {
        setMouse({ x: e.currentTarget.getBoundingClientRect().left, y: e.currentTarget.getBoundingClientRect().bottom });
        setOpen(true);
      }}
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

type ResultsView = "bands" | "leaderboard";

type ScreenerTableSortKey = "periodYield" | "annYield";

type ScreenerTableSortState =
  | { phase: "none" }
  | { phase: "asc" | "desc"; key: ScreenerTableSortKey };

function periodYieldFromRow(r: RankedOption, dte?: number | null): number {
  if (r.periodYieldPct != null && Number.isFinite(r.periodYieldPct)) return r.periodYieldPct;
  if (dte != null && dte > 0 && Number.isFinite(r.annYieldPct)) return r.annYieldPct * (dte / 365);
  return r.annYieldPct;
}

function sortScreenerRows(
  rows: RankedOption[],
  sort: ScreenerTableSortState,
  dte?: number | null,
): RankedOption[] {
  if (sort.phase === "none") return rows;
  const arr = [...rows];
  const sign = sort.phase === "asc" ? 1 : -1;
  arr.sort((a, b) => {
    let cmp = 0;
    if (sort.key === "periodYield") {
      const va = periodYieldFromRow(a, dte);
      const vb = periodYieldFromRow(b, dte);
      cmp = va === vb ? 0 : va < vb ? -1 : 1;
    } else {
      cmp = a.annYieldPct === b.annYieldPct ? 0 : a.annYieldPct < b.annYieldPct ? -1 : 1;
    }
    return cmp * sign;
  });
  return arr;
}

type SortableScreenerThProps = {
  theme: Theme;
  sortKey: ScreenerTableSortKey;
  tableSort: ScreenerTableSortState;
  onCycle: (key: ScreenerTableSortKey) => void;
  label: string;
  labelHelp?: string;
};

function SortableScreenerTh({
  theme: t,
  sortKey,
  tableSort,
  onCycle,
  label,
  labelHelp,
}: SortableScreenerThProps) {
  const active = tableSort.phase !== "none" && tableSort.key === sortKey;
  const ariaSort =
    !active ? "none" : tableSort.phase === "asc" ? "ascending" : "descending";

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
        gap: 4,
        padding: 0,
        font: "inherit",
        textAlign: "right",
        maxWidth: "100%",
        borderRadius: 4,
        marginLeft: "auto",
      }}
    >
      {labelHelp ? (
        <HelpTooltip theme={t} text={labelHelp}>
          <span style={{ cursor: "help" }}>{label}</span>
        </HelpTooltip>
      ) : (
        <span>{label}</span>
      )}
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
      style={{
        textAlign: "right",
        fontWeight: 600,
        padding: `${t.spacing(2)} ${t.spacing(3)}`,
        backgroundColor: t.colors.secondary,
        borderBottom: `1px solid ${t.colors.border}`,
        color: t.colors.secondaryText,
        fontSize: "0.8rem",
        whiteSpace: "nowrap",
      }}
      aria-sort={ariaSort}
    >
      {btn}
    </th>
  );
}

export type OptionsScreenerProps = { theme: Theme; sidebarWidth: number };

const otmLabels: Record<number, { headline: string; detail: string }> = {
  5:  { headline: "5–9% OTM",   detail: "Higher risk, higher yield" },
  10: { headline: "10–14% OTM", detail: "Aggressive" },
  15: { headline: "15–19% OTM", detail: "Moderate" },
  20: { headline: "20–30% OTM", detail: "Conservative, lower yield" },
};

function formatOtmBandLabel(
  key: number,
  range: { min: number; max: number } | null,
): { headline: string; detail: string } {
  if (key === CUSTOM_OTM_KEY && range) {
    return {
      headline: `${range.min}–${range.max}% OTM`,
      detail: "Custom range — best ideas within your min/max band",
    };
  }
  return otmLabels[key] ?? { headline: `${key}% OTM`, detail: "" };
}

// --- Main page component ---

export function OptionsScreener({ theme: t, sidebarWidth }: OptionsScreenerProps) {
  const fixedRails = getFixedRailsLayoutStyles(t, {
    sidebarWidth,
    leftRailWidth: 286,
    rightRailWidth: 256,
    headerHeight: 104,
  });

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

  const sectionTitleStyle: React.CSSProperties = {
    fontSize: "0.75rem",
    color: t.colors.secondary,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    marginBottom: t.spacing(3),
    fontWeight: 700,
  };

  const labelStyle: React.CSSProperties = {
    fontSize: "0.72rem",
    fontWeight: 700,
    color: t.colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    marginBottom: t.spacing(1),
    display: "block",
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: `${t.spacing(2)} ${t.spacing(3)}`,
    height: 36,
    fontSize: "0.85rem",
    border: `1px solid ${t.colors.border}`,
    borderRadius: t.radius.md,
    backgroundColor: t.colors.background,
    color: t.colors.text,
    boxSizing: "border-box",
  };

  const tableWrapStyle: React.CSSProperties = {
    overflowX: "auto",
    borderRadius: t.radius.md,
    border: `1px solid ${t.colors.border}`,
  };

  const tableStyle: React.CSSProperties = {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: "0.875rem",
    fontFamily: t.typography.fontFamily,
  };

  const thStyle: React.CSSProperties = {
    textAlign: "left",
    fontWeight: 600,
    padding: `${t.spacing(2)} ${t.spacing(3)}`,
    backgroundColor: t.colors.secondary,
    borderBottom: `1px solid ${t.colors.border}`,
    color: t.colors.secondaryText,
    fontSize: "0.8rem",
    whiteSpace: "nowrap",
  };

  const thNumStyle: React.CSSProperties = { ...thStyle, textAlign: "right" };

  const tdStyle: React.CSSProperties = {
    padding: `${t.spacing(2)} ${t.spacing(3)}`,
    borderBottom: `1px solid ${t.colors.border}`,
    color: t.colors.text,
  };

  const tdNumStyle: React.CSSProperties = {
    ...tdStyle,
    textAlign: "right",
    fontVariantNumeric: "tabular-nums",
    fontWeight: 600,
  };

  const cardStyle = getPageCardStyle(t, { padding: t.spacing(4), marginBottom: t.spacing(4) });

  const primaryBtn = getPrimaryActionButtonStyle(t);

  const expirations = useMemo(() => getMonthlyThirdFridayExpirations(18), []);

  const [optionType, setOptionType] = useState<OptionType>("puts");
  const [positionSide, setPositionSide] = useState<PositionSide>("write");
  const [monthlyOnly, setMonthlyOnly] = useState(true);
  const [expiration, setExpiration] = useState<string>(expirations[0]?.value ?? "");
  const [openId, setOpenId] = useState<string | null>(null);
  const [minMarketCap, setMinMarketCap] = useState<number>(500_000_000);
  const minMarketCapText = useMemo(() => minMarketCap.toLocaleString("en-US"), [minMarketCap]);
  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const scanWasRunning = useRef(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [resultsByOtmPct, setResultsByOtmPct] = useState<Record<number, RankedOption[]>>({});
  const [lastCopiedOpportunityKey, setLastCopiedOpportunityKey] = useState<string | null>(null);
  const [lastCopiedBucketKey, setLastCopiedBucketKey] = useState<string | null>(null);
  const [lastScanAt, setLastScanAt] = useState<Date | null>(null);
  /** Matches the scan that produced current tables (so labels stay correct if you change controls). */
  const [outcomePositionSide, setOutcomePositionSide] = useState<PositionSide>("write");
  /** Matches the scan that produced current tables. */
  const [outcomeOtmLayout, setOutcomeOtmLayout] = useState<OtmLayout>("bands");
  const [outcomeOtmRange, setOutcomeOtmRange] = useState<{ min: number; max: number } | null>(null);
  const [showInfoModal, setShowInfoModal] = useState(false);
  const [bucketId, setBucketId] = useState<string>(OPPORTUNITY_BUCKETS[0]!.id);
  const [scanDepth, setScanDepth] = useState<ScanDepth>("standard");
  const [liquidityMode, setLiquidityMode] = useState<LiquidityMode>("strict");
  const [otmLayout, setOtmLayout] = useState<OtmLayout>("bands");
  const [otmPctMin, setOtmPctMin] = useState(5);
  const [otmPctMax, setOtmPctMax] = useState(15);
  const [resultsView, setResultsView] = useState<ResultsView>("bands");
  const [tableSort, setTableSort] = useState<ScreenerTableSortState>({ phase: "none" });
  const [lastScanDte, setLastScanDte] = useState<number | null>(null);
  // Year input state for the Month/Year expiration picker (non-monthly mode)
  const [expYearInput, setExpYearInput] = useState<string>(
    () => expirations[0]?.value?.slice(0, 4) ?? String(new Date().getFullYear())
  );

  const activeBucket: OpportunityBucket = useMemo(
    () => OPPORTUNITY_BUCKETS.find((b) => b.id === bucketId) ?? OPPORTUNITY_BUCKETS[0]!,
    [bucketId]
  );
  const isFullUniverse = activeBucket.symbols.length === 0;

  useEffect(() => {
    if (!showInfoModal) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setShowInfoModal(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showInfoModal]);

  // Scan button progress bar — animates from 0 → ~88% during scan, then jumps to 100% on finish.
  useEffect(() => {
    if (!scanning) {
      if (scanWasRunning.current) {
        scanWasRunning.current = false;
        setScanProgress(100);
        const tid = setTimeout(() => setScanProgress(0), 700);
        return () => clearTimeout(tid);
      }
      return;
    }
    scanWasRunning.current = true;
    setScanProgress(0);
    const start = Date.now();
    const estimated = scanDepth === "quick" ? 28_000 : scanDepth === "deep" ? 52_000 : 38_000;
    const id = setInterval(() => {
      const ratio = (Date.now() - start) / estimated;
      setScanProgress(88 * (1 - Math.exp(-2.5 * ratio)));
    }, 250);
    return () => clearInterval(id);
  }, [scanning, scanDepth]);

  const hasResults = Object.values(resultsByOtmPct).some((rows) => rows.length > 0);

  const outcomeBandLevels = useMemo(() => {
    if (outcomeOtmLayout === "range") {
      return (resultsByOtmPct[CUSTOM_OTM_KEY] ?? []).length > 0 ? [CUSTOM_OTM_KEY] : [];
    }
    return OTM_LEVELS.filter((l) => (resultsByOtmPct[l] ?? []).length > 0);
  }, [resultsByOtmPct, outcomeOtmLayout]);

  const bandLevelsForDisplay = useMemo(() => {
    if (scanning) {
      return otmLayout === "range" ? [CUSTOM_OTM_KEY] : [...OTM_LEVELS];
    }
    return outcomeBandLevels;
  }, [scanning, otmLayout, outcomeBandLevels]);

  const rangeForBandLabels =
    (scanning ? otmLayout : outcomeOtmLayout) === "range"
      ? scanning
        ? { min: otmPctMin, max: otmPctMax }
        : outcomeOtmRange
      : null;

  const tableQuotePrimary = outcomePositionSide === "buy" ? "Ask" : "Bid";
  const tableQuoteSecondary = outcomePositionSide === "buy" ? "Bid" : "Ask";
  const tableAnnLabel = outcomePositionSide === "buy" ? "Ann. debit %" : "Ann. yield";
  const tablePremLabel = outcomePositionSide === "buy" ? "Debit" : "Premium";
  const tablePeriodLabel = outcomePositionSide === "buy" ? "Period debit %" : "Period yield";

  const cycleTableSort = useCallback((key: ScreenerTableSortKey) => {
    setTableSort((prev) => {
      if (prev.phase === "none" || prev.key !== key) return { phase: "asc", key };
      if (prev.phase === "asc") return { phase: "desc", key };
      return { phase: "none" };
    });
  }, []);

  const allLeaderboardCandidates = useMemo(() => {
    const out: RankedOption[] = [];
    for (const rows of Object.values(resultsByOtmPct)) out.push(...rows);
    return out;
  }, [resultsByOtmPct]);

  const leaderboardRows = useMemo(() => {
    let arr = [...allLeaderboardCandidates];
    if (tableSort.phase === "none") {
      arr.sort((a, b) => periodYieldFromRow(b, lastScanDte) - periodYieldFromRow(a, lastScanDte));
    } else {
      arr = sortScreenerRows(arr, tableSort, lastScanDte);
    }
    return arr.slice(0, 5);
  }, [allLeaderboardCandidates, tableSort, lastScanDte]);

  const sortBucketRows = useCallback(
    (rows: RankedOption[]) => sortScreenerRows(rows, tableSort, lastScanDte),
    [tableSort, lastScanDte],
  );

  const renderScreenerResultRows = (
    rows: RankedOption[],
    copyKeyPrefix: string,
    rankOverride?: (index: number) => number,
  ) =>
    rows.map((r, rowIdx) => {
      const copyKey = `${copyKeyPrefix}-${r.ticker}-${r.strike}`;
      const displayRank = rankOverride ? rankOverride(rowIdx) : r.rank;
      return (
        <tr key={`${copyKeyPrefix}-${r.ticker}-${r.strike}-${r.otmPct}`} style={{ borderBottom: `1px solid ${t.colors.border}` }}>
          <td
            style={{
              ...tdStyle,
              fontWeight: 600,
              color:
                displayRank === 1 ? rankingColors.gold :
                displayRank === 2 ? rankingColors.silver :
                displayRank === 3 ? rankingColors.bronze :
                t.colors.text,
            }}
          >
            #{displayRank}
          </td>
          <td style={{ ...tdStyle, fontWeight: 600 }}>
            {r.ticker}
            {r.liquidityFlags && r.liquidityFlags.length > 0 && (
              <span style={{ display: "block", fontSize: "0.65rem", color: t.colors.textMuted, fontWeight: 500, marginTop: 2 }}>
                {r.liquidityFlags.includes("wide_spread") ? "Wide spread" : ""}
                {r.liquidityFlags.includes("wide_spread") && r.liquidityFlags.includes("low_oi") ? " · " : ""}
                {r.liquidityFlags.includes("low_oi") ? "Low OI" : ""}
              </span>
            )}
          </td>
          <td style={{ ...tdStyle, maxWidth: 180 }}>
            <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {r.company}
            </div>
            {copyKeyPrefix === "leaderboard" && (
              <span style={{ display: "block", fontSize: "0.68rem", color: t.colors.textMuted, fontWeight: 500 }}>
                {formatOtmBandLabel(r.otmPct, outcomeOtmRange).headline}
              </span>
            )}
          </td>
          <td style={tdNumStyle}>
            {formatStrikePrice(r.currentPrice)}
            <span
              style={{
                display: "block",
                fontSize: "0.7rem",
                fontWeight: 500,
                color:
                  r.oneMonthPerfPct == null
                    ? t.colors.textMuted
                    : r.oneMonthPerfPct >= 0
                      ? t.colors.success
                      : t.colors.danger,
              }}
            >
              1M {formatPct(r.oneMonthPerfPct)}
            </span>
          </td>
          <td style={tdNumStyle}>
            {formatStrikePrice(r.strike)}
            {r.actualOtmPct != null && (
              <span style={{ display: "block", fontSize: "0.7rem", color: t.colors.textMuted, fontWeight: 500 }}>
                {r.actualOtmPct.toFixed(1)}% OTM
              </span>
            )}
          </td>
          <td style={{
            ...tdNumStyle,
            color: r.delta == null
              ? t.colors.textMuted
              : outcomePositionSide === "buy"
                ? r.delta >= 0.30 ? t.colors.success : r.delta >= 0.15 ? t.colors.text : t.colors.danger
                : r.delta <= 0.15 ? t.colors.success : r.delta <= 0.30 ? t.colors.text : t.colors.danger,
          }}>
            {r.delta == null ? "—" : `${(r.delta * 100).toFixed(0)}%`}
          </td>
          <td style={tdNumStyle}>
            <span>
              {formatVolPct(r.impliedVolPct ?? null)}
              {r.realizedVol20dPct != null && (
                <span style={{ color: t.colors.textMuted, fontWeight: 400 }}>
                  {" / "}{formatVolPct(r.realizedVol20dPct)}
                </span>
              )}
            </span>
            {r.impliedVolPct != null && r.realizedVol20dPct != null && r.realizedVol20dPct > 0 && (() => {
              const ratio = r.impliedVolPct / r.realizedVol20dPct;
              const isRich = outcomePositionSide === "write" ? ratio >= 1.0 : ratio < 1.0;
              const color = isRich
                ? t.colors.success
                : ratio < 0.85
                  ? t.colors.danger
                  : t.colors.textMuted;
              return (
                <span style={{ display: "block", fontSize: "0.7rem", fontWeight: 600, color }}>
                  {ratio.toFixed(2)}× IV/RV
                </span>
              );
            })()}
          </td>
          <td style={tdNumStyle}>
            {r.skewPct == null ? (
              <span style={{ color: t.colors.textMuted }}>—</span>
            ) : (() => {
              const skew = r.skewPct;
              const isWrite = outcomePositionSide === "write";
              const isPutSide = optionType === "puts";
              const isGood = isWrite ? (isPutSide ? skew > 0 : skew < 0) : (!isPutSide ? skew < 0 : skew > 0);
              const color = Math.abs(skew) < 2
                ? t.colors.textMuted
                : isGood ? t.colors.success : t.colors.danger;
              return (
                <span style={{ fontWeight: 600, color }}>
                  {skew > 0 ? "+" : ""}{skew.toFixed(1)}
                </span>
              );
            })()}
          </td>
          <td style={tdNumStyle}>
            {(() => {
              const bid = r.bid;
              const ask = r.ask ?? r.bid;
              const primary = outcomePositionSide === "buy" ? ask : bid;
              const secondary = outcomePositionSide === "buy" ? bid : ask;
              return (
                <>
                  <span style={{ fontWeight: 700 }}>${primary.toFixed(2)}</span>
                  <span
                    style={{
                      display: "block",
                      fontSize: "0.72rem",
                      color: t.colors.textMuted,
                      fontWeight: 500,
                    }}
                  >
                    {tableQuoteSecondary} ${secondary.toFixed(2)}
                  </span>
                </>
              );
            })()}
          </td>
          <td
            style={{
              ...tdNumStyle,
              color: outcomePositionSide === "buy" ? t.colors.text : t.colors.success,
            }}
          >
            {periodYieldFromRow(r, lastScanDte).toFixed(2)}%
          </td>
          <td
            style={{
              ...tdNumStyle,
              color: outcomePositionSide === "buy" ? t.colors.text : t.colors.success,
            }}
          >
            {r.annYieldPct.toFixed(2)}%
          </td>
          <td style={tdNumStyle}>{formatPremium(r.premiumPerContract)}</td>
          <td style={{ ...tdStyle, textAlign: "center" }}>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(r.schwabSymbol);
                setLastCopiedOpportunityKey(copyKey);
                window.setTimeout(
                  () => setLastCopiedOpportunityKey((prev) => prev === copyKey ? null : prev),
                  1200
                );
              }}
              title={`Copy order symbol: ${r.schwabSymbol}`}
              aria-label={`Copy order symbol: ${r.schwabSymbol}`}
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
                style={{ fontSize: 22, position: "absolute", opacity: lastCopiedOpportunityKey === copyKey ? 0 : 1, transition: "opacity 0.2s ease", pointerEvents: "none" }}
                aria-hidden
              >
                content_copy
              </span>
              <span
                className="material-symbols-outlined"
                style={{ fontSize: 22, position: "absolute", opacity: lastCopiedOpportunityKey === copyKey ? 1 : 0, transition: "opacity 0.2s ease", pointerEvents: "none" }}
                aria-hidden
              >
                check
              </span>
            </button>
          </td>
        </tr>
      );
    });

  const renderScreenerTableHead = (options?: { leftRadius?: boolean; rightRadius?: boolean }) => (
    <thead>
      <tr>
        <th style={{ ...thStyle, ...(options?.leftRadius ? { borderTopLeftRadius: t.radius.md } : {}) }}>Rank</th>
        <th style={thStyle}>Ticker</th>
        <th style={thStyle}>Company</th>
        <th style={thNumStyle}>Px</th>
        <th style={thNumStyle}>Strike</th>
        <th style={thNumStyle}>
          <HelpTooltip
            theme={t}
            text={outcomePositionSide === "buy"
              ? "Probability of the option finishing in-the-money (expiring with value). Derived from delta. Higher = more likely to profit for long buyers. Green ≥30%, red ≤15%."
              : "Probability of the option finishing in-the-money (being assigned on a short). Derived from delta. Lower = safer for premium sellers. Green ≤15%, red >30%."}
          >
            <span style={{ cursor: "help" }}>Δ Prob</span>
          </HelpTooltip>
        </th>
        <th style={thNumStyle}>
          <HelpTooltip
            theme={t}
            text={outcomePositionSide === "buy"
              ? "IV / RV ratio — compares what the option market implies will happen (IV) to what the stock has actually done over the past 20 trading days (RV). For buying: below 1.0 (green) means options are cheap relative to real movement — you're getting more bang for your buck. Above 1.0 (red) means options are expensive. The ratio is a key ranking signal alongside raw IV."
              : "IV / RV ratio — compares what the option market implies will happen (IV) to what the stock has actually done over the past 20 trading days (RV). For selling: above 1.0 (green) means options are rich relative to real movement — you collect more premium than the stock's actual risk justifies. This is the core 'free lunch' signal. Below 0.90 (red) means the stock is moving more than options imply — avoid writing these."}
          >
            <span style={{ cursor: "help" }}>IV / RV ratio</span>
          </HelpTooltip>
        </th>
        <th style={thNumStyle}>
          <HelpTooltip
            theme={t}
            text={outcomePositionSide === "buy"
              ? "Skew — measures whether puts or calls are more expensive. Calculated as (avg IV of OTM puts) minus (avg IV of OTM calls), 5–20% range. Positive = puts pricier (market fears a drop). Negative = calls pricier (market expects a rally). For buying calls: negative skew is good — calls are relatively cheap. For buying puts: positive skew means you're paying a premium for downside protection."
              : "Skew — measures whether puts or calls are more expensive. Calculated as (avg IV of OTM puts) minus (avg IV of OTM calls), 5–20% range. Positive = puts pricier (market fears a drop) — great for put writes since you collect richer premium. Negative = calls pricier or near-neutral — typical for most stocks, fine for call writes. Small values near 0pp mean puts and calls are priced similarly."}
          >
            <span style={{ cursor: "help" }}>Skew</span>
          </HelpTooltip>
        </th>
        <th style={thNumStyle}>{tableQuotePrimary}</th>
        <SortableScreenerTh
          theme={t}
          sortKey="periodYield"
          tableSort={tableSort}
          onCycle={cycleTableSort}
          label={tablePeriodLabel}
          labelHelp={
            outcomePositionSide === "buy"
              ? "Debit as % of strike notional for this expiry (not annualized). Click to sort."
              : "Premium as % of strike notional if held to expiration (not annualized). Click to sort."
          }
        />
        <SortableScreenerTh
          theme={t}
          sortKey="annYield"
          tableSort={tableSort}
          onCycle={cycleTableSort}
          label={tableAnnLabel}
          labelHelp={
            outcomePositionSide === "buy"
              ? "Annualized debit as % of strike (× 365 ÷ DTE). Click to sort."
              : "Annualized yield as % of strike (× 365 ÷ DTE). Click to sort."
          }
        />
        <th style={thNumStyle}>{tablePremLabel}</th>
        <th style={{ ...thStyle, textAlign: "center", ...(options?.rightRadius ? { borderTopRightRadius: t.radius.md } : {}) }}>Action</th>
      </tr>
    </thead>
  );

  async function onScan() {
    if (!expiration) return;
    if (otmLayout === "range" && otmPctMax <= otmPctMin) {
      setScanError("Max OTM % must be greater than Min OTM %.");
      return;
    }
    setScanError(null);
    setWarnings([]);
    setResultsByOtmPct({});
    setTableSort({ phase: "none" });
    setScanning(true);
    try {
      const payload: Record<string, unknown> = {
        optionType,
        positionSide,
        expiration,
        otmLayout,
        topN: 10,
        scanDepth,
        liquidityMode,
        monthlyOnly,
      };
      if (otmLayout === "range") {
        payload.otmPctMin = otmPctMin;
        payload.otmPctMax = otmPctMax;
      } else {
        payload.otmLevels = Array.from(OTM_LEVELS);
      }
      if (isFullUniverse) payload.minMarketCap = minMarketCap;
      if (activeBucket.symbols.length > 0) {
        payload.universeSymbols = activeBucket.symbols;
      }

      const res = await fetch(`${SCHWAB_API_BASE}/api/schwab`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "screener", ...payload }),
      });

      let json: ScreenerResponse & { error?: string } = { resultsByOtmPct: {}, message: null, warnings: [] };
      try { json = await res.json(); } catch { /* non-JSON body */ }

      if (!res.ok) {
        const userMsg = typeof json.error === "string" && json.error ? json.error : `Scan failed (HTTP ${res.status})`;
        const rawDetail = json.message != null ? String(json.message) : null;
        setScanError(rawDetail ? `${userMsg} — ${rawDetail}` : userMsg);
        return;
      }
      setWarnings(json.warnings ?? []);
      setScanError(json.message ? String(json.message) : null);
      setResultsByOtmPct(json.resultsByOtmPct ?? {});
      setLastScanDte(typeof json.dte === "number" && Number.isFinite(json.dte) ? json.dte : null);
      if (res.ok) {
        const hasAny = Object.values(json.resultsByOtmPct ?? {}).some((rows) => rows.length > 0);
        if (hasAny) {
          setLastScanAt(new Date());
          setOutcomePositionSide(positionSide);
          setOutcomeOtmLayout(json.otmLayout === "range" ? "range" : otmLayout);
          setOutcomeOtmRange(
            json.otmLayout === "range" && json.otmRange
              ? { min: json.otmRange.min, max: json.otmRange.max }
              : otmLayout === "range"
                ? { min: otmPctMin, max: otmPctMax }
                : null
          );
        }
      }
    } catch (err: any) {
      setScanError(err?.message ? String(err.message) : "Unexpected error scanning from Schwab.");
    } finally {
      setScanning(false);
    }
  }

  return (
    <section className="options-screener-page" style={fixedRails.page}>

      {/* ── Fixed header ── */}
      <div style={fixedRails.topHeader}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
          <h2 style={titleStyle}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: t.spacing(2) }}>
              <span
                className="material-symbols-outlined"
                style={{ fontSize: "1.5rem", color: t.colors.secondary, lineHeight: 1, display: "inline-flex" }}
                aria-hidden
              >
                search
              </span>
              Options Screener
            </span>
          </h2>
          <button
            type="button"
            onClick={() => setShowInfoModal(true)}
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
            }}
            aria-label="How this page works"
          >
            <span className="material-symbols-outlined" style={{ fontSize: 26 }} aria-hidden>info</span>
          </button>
        </div>
        <p style={{ ...descStyle, marginTop: t.spacing(1), marginBottom: 0 }}>
          Scan the S&P 500 (+ liquid ETFs) and live Schwab movers across 5–9%, 10–14%, 15–19%, and 20–30% OTM bands. Pick scan depth and liquidity mode in the left panel.
          {activeBucket.symbols.length > 0 ? (
            <>
              {" "}
              <strong>Universe:</strong> {activeBucket.label} ({activeBucket.symbols.length} tickers).
            </>
          ) : null}
        </p>
      </div>

      {showInfoModal && (
        <>
          <div
            role="presentation"
            style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.4)", zIndex: 1000 }}
            onClick={() => setShowInfoModal(false)}
          />
          <div
            role="dialog"
            aria-labelledby="screener-info-title"
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
              <h3 id="screener-info-title" style={{ ...sectionTitleStyle, marginBottom: 0, color: t.colors.secondary }}>How Options Screener works</h3>
              <button
                type="button"
                onClick={() => setShowInfoModal(false)}
                style={{ padding: t.spacing(0.5), border: "none", background: "none", color: t.colors.textMuted, cursor: "pointer" }}
                aria-label="Close"
              >
                <span className="material-symbols-outlined" style={{ fontSize: 22 }}>close</span>
              </button>
            </div>
            <div style={{ color: t.colors.text, fontSize: "0.88rem", lineHeight: 1.75 }}>

              <p style={{ fontWeight: 700, marginBottom: t.spacing(1), color: t.colors.primary }}>What this does</p>
              <p style={{ marginBottom: t.spacing(3) }}>
                Scans the <strong>S&amp;P 500</strong> (~528 symbols + ETFs) and live Schwab movers across <strong>5–9%, 10–14%, 15–19%, and 20–30% OTM bands</strong>. Every strike in each band is scored; the top contract per ticker is surfaced. Each ticker appears in exactly one OTM bucket — the level where it scores best.
              </p>

              <p style={{ fontWeight: 700, marginBottom: t.spacing(1), color: t.colors.primary }}>Scan depth</p>
              <ul style={{ margin: 0, marginBottom: t.spacing(3), paddingLeft: t.spacing(5) }}>
                <li><strong>Quick</strong> — vol history on ~280 names, option chains on top 120 (fastest).</li>
                <li><strong>Standard</strong> — ~500 names surveyed, chains on top 180 (default).</li>
                <li><strong>Deep</strong> — full universe, chains on top 250 (slowest, widest coverage).</li>
              </ul>

              <p style={{ fontWeight: 700, marginBottom: t.spacing(1), color: t.colors.primary }}>Liquidity mode</p>
              <ul style={{ margin: 0, marginBottom: t.spacing(3), paddingLeft: t.spacing(5) }}>
                <li><strong>Strict</strong> — excludes wide spreads and very low open interest (tradeable-only).</li>
                <li><strong>Relaxed</strong> — includes flagged names but ranks them lower (badges: wide spread / low OI).</li>
                <li><strong>Show all</strong> — only excludes untradeable quotes (no bid for writes, no ask for buys).</li>
              </ul>

              <p style={{ fontWeight: 700, marginBottom: t.spacing(1), color: t.colors.primary }}>Write (sell to open) — "free lunch" signal</p>
              <p style={{ marginBottom: t.spacing(3) }}>
                When <strong>IV &gt; RV</strong> (implied vol exceeds realized vol), the market pays you more premium than the stock is actually moving — the <em>volatility risk premium</em>. The <strong>IV/RV ratio</strong> shows this: green ≥1.0 (rich, good to sell), red &lt;0.85 (cheap). The ★ Best IV/RV badge highlights the highest-ratio opportunity across all OTM levels.
              </p>

              <p style={{ fontWeight: 700, marginBottom: t.spacing(1), color: t.colors.primary }}>Buy (long to open) — cheap premium signal</p>
              <p style={{ marginBottom: t.spacing(3) }}>
                When <strong>RV &gt; IV</strong>, options are priced below the stock's actual movement — favorable for buyers. IV/RV colors invert: green &lt;1.0 (cheap), red ≥1.15 (expensive). ★ Best IV/RV highlights the <em>lowest</em>-ratio opportunity. Ann. debit % shows the annualised cost; Δ Prob colors invert too — green ≥30% (high chance of profit), red ≤15%.
              </p>

              <p style={{ fontWeight: 700, marginBottom: t.spacing(1), color: t.colors.primary }}>Ranking formula</p>
              <p style={{ marginBottom: t.spacing(1) }}>
                <strong>Write:</strong> <code style={{ fontSize: "0.8rem", background: "rgba(0,0,0,0.06)", padding: "2px 5px", borderRadius: 4 }}>AnnYield × (1 − Prob)^1.35 × Liq × IV/RV mult × Gamma penalty</code>
              </p>
              <p style={{ marginBottom: t.spacing(1) }}>
                <strong>Buy:</strong> <code style={{ fontSize: "0.8rem", background: "rgba(0,0,0,0.06)", padding: "2px 5px", borderRadius: 4 }}>(Prob × 100 ÷ AnnDebit) × Liq × RV/IV mult</code>
              </p>
              <ul style={{ margin: 0, marginBottom: t.spacing(3), paddingLeft: t.spacing(5) }}>
                <li><strong>LiqScore</strong> — spread tightness (50%), open interest (25%), volume (15%), vol/OI activity ratio (10%). Spread matters because wide markets cost money on entry and exit.</li>
                <li><strong>IV/RV multiplier (write)</strong> — asymmetric: up to +50% boost when IV rich vs RV; steeper penalty (up to −55%) when IV cheap vs RV. Selling cheap premium is penalised harder than the reward for rich premium.</li>
                <li><strong>IV/RV multiplier (buy)</strong> — symmetric ±40%: boost when options are cheap vs realized moves.</li>
                <li><strong>Gamma penalty</strong> (write only) — mild discount for high-gamma contracts near the strike.</li>
              </ul>

              <p style={{ fontWeight: 700, marginBottom: t.spacing(1), color: t.colors.primary }}>OTM filter</p>
              <ul style={{ margin: 0, marginBottom: t.spacing(3), paddingLeft: t.spacing(5) }}>
                <li><strong>Risk bands</strong> — four tables at 5–9%, 10–14%, 15–19%, and 20–30% OTM. Each ticker appears in one band only.</li>
                <li><strong>Custom range</strong> — set Min/Max OTM % (like Options Optimizer) and get one ranked table of the best ideas within that strike distance.</li>
              </ul>

              <p style={{ fontWeight: 700, marginBottom: t.spacing(1), color: t.colors.primary }}>Results views</p>
              <ul style={{ margin: 0, marginBottom: t.spacing(3), paddingLeft: t.spacing(5) }}>
                <li><strong>Risk bands</strong> — top ideas grouped by OTM level (5–9%, 10–14%, etc.), ranked by composite score within each band.</li>
                <li><strong>Yield leaderboard</strong> — flat top 5 across all bands, sorted by period yield (best for &ldquo;give me the highest-yield names&rdquo; requests).</li>
              </ul>

              <p style={{ fontWeight: 700, marginBottom: t.spacing(1), color: t.colors.primary }}>Key columns</p>
              <ul style={{ margin: 0, marginBottom: t.spacing(2), paddingLeft: t.spacing(5) }}>
                <li><strong>Δ Prob</strong> — |delta| as proxy for probability ITM. Write: green ≤15% (safe), red &gt;30%. Buy: green ≥30% (likely to profit), red ≤15%.</li>
                <li><strong>IV / RV column</strong> — shows <em>IV / RV 20d</em> on one line (implied vol / annualised ~20-day realized vol), with the IV/RV ratio badge below. The ratio is the core signal for both strategies.</li>
                <li><strong>Period yield / Period debit %</strong> — premium (or debit) as % of strike for this expiry only — the number to use when someone asks &ldquo;yield over the next ~3 months.&rdquo;</li>
                <li><strong>Ann. yield / Ann. debit %</strong> — same figure annualized (× 365 ÷ DTE). Click column headers to sort ascending, descending, or back to default rank.</li>
                <li><strong>Premium / Debit</strong> — dollars per contract (100 shares). Negative = debit for buys.</li>
                <li><strong>Action</strong> — copies the Schwab-formatted order symbol to clipboard.</li>
              </ul>

            </div>
          </div>
        </>
      )}

      {/* ── Left rail: Scan Parameters ── */}
      <aside style={fixedRails.leftRail}>
        <div
          className="options-screener-scan-card"
          style={{
            ...fixedRails.railPanel,
            minHeight: 0,
            flex: 1,
          }}
        >
        <div
          style={{
            ...fixedRails.railBody,
            display: "flex",
            flexDirection: "column",
            gap: t.spacing(4),
          }}
        >
          <h3 style={{ ...sectionTitleStyle, marginBottom: 0 }}>Scan Parameters</h3>

          <div
            style={{
              fontSize: "0.78rem",
              color: t.colors.textMuted,
              lineHeight: 1.45,
              padding: `${t.spacing(2)} ${t.spacing(2)}`,
              borderRadius: t.radius.md,
              border: `1px solid ${t.colors.border}`,
              backgroundColor: t.colors.background,
            }}
          >
            <strong style={{ color: t.colors.text }}>Universe</strong>
            <div>{activeBucket.label}</div>
            {activeBucket.symbols.length === 0 ? (
              <div style={{ marginTop: t.spacing(1) }}>S&amp;P 500 + ETFs + movers. Change buckets in the right panel.</div>
            ) : (
              <div style={{ marginTop: t.spacing(1) }}>{activeBucket.symbols.length} tickers — movers excluded.</div>
            )}
          </div>

          {/* Option Type */}
          <div>
            <span style={labelStyle}>Option Type</span>
            <div style={{ display: "flex", gap: t.spacing(2) }}>
              {(["puts", "calls"] as OptionType[]).map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setOptionType(type)}
                  aria-pressed={optionType === type}
                  style={{
                    flex: 1,
                    padding: `${t.spacing(2)} ${t.spacing(2)}`,
                    borderRadius: t.radius.md,
                    border: `1px solid ${optionType === type ? t.colors.primary : t.colors.border}`,
                    backgroundColor: optionType === type ? `${t.colors.primary}18` : t.colors.background,
                    color: optionType === type ? t.colors.primary : t.colors.text,
                    fontWeight: 700,
                    cursor: "pointer",
                    fontSize: "0.85rem",
                    textTransform: "capitalize",
                  }}
                >
                  {type.charAt(0).toUpperCase() + type.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {/* Write vs buy */}
          <div>
            <span style={labelStyle}>
              <HelpTooltip
                theme={t}
                text="Write (sell to open): rank by highest annualized premium collected — uses bid. Buy (buy to open): rank by lowest annualized debit vs strike — uses ask, best for comparing opening long premium at each OTM."
              >
                <span style={{ cursor: "help" }}>Position</span>
              </HelpTooltip>
            </span>
            <div style={{ display: "flex", gap: t.spacing(2) }}>
              {(
                [
                  { v: "write" as const, label: "Write (sell)" },
                  { v: "buy" as const, label: "Buy (long)" },
                ] as const
              ).map(({ v, label }) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setPositionSide(v)}
                  aria-pressed={positionSide === v}
                  style={{
                    flex: 1,
                    padding: `${t.spacing(2)} ${t.spacing(2)}`,
                    borderRadius: t.radius.md,
                    border: `1px solid ${positionSide === v ? t.colors.primary : t.colors.border}`,
                    backgroundColor: positionSide === v ? `${t.colors.primary}18` : t.colors.background,
                    color: positionSide === v ? t.colors.primary : t.colors.text,
                    fontWeight: 700,
                    cursor: "pointer",
                    fontSize: "0.78rem",
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* OTM filter: risk bands vs custom range */}
          <div>
            <span style={labelStyle}>
              <HelpTooltip
                theme={t}
                text="Risk bands splits results into 5–9%, 10–14%, 15–19%, and 20–30% OTM tables. Custom range scans one min–max OTM band (like Options Optimizer) and returns the best ideas within that range."
              >
                <span style={{ cursor: "help" }}>OTM filter</span>
              </HelpTooltip>
            </span>
            <div style={{ display: "flex", gap: t.spacing(2), marginBottom: otmLayout === "range" ? t.spacing(2) : 0 }}>
              {(
                [
                  { v: "bands" as const, label: "Risk bands" },
                  { v: "range" as const, label: "Custom range" },
                ] as const
              ).map(({ v, label }) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setOtmLayout(v)}
                  aria-pressed={otmLayout === v}
                  style={{
                    flex: 1,
                    padding: `${t.spacing(2)} ${t.spacing(2)}`,
                    borderRadius: t.radius.md,
                    border: `1px solid ${otmLayout === v ? t.colors.primary : t.colors.border}`,
                    backgroundColor: otmLayout === v ? `${t.colors.primary}18` : t.colors.background,
                    color: otmLayout === v ? t.colors.primary : t.colors.text,
                    fontWeight: 700,
                    cursor: "pointer",
                    fontSize: "0.78rem",
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            {otmLayout === "range" && (
              <div style={{ display: "flex", gap: t.spacing(2), alignItems: "flex-end" }}>
                <div style={{ flex: 1 }}>
                  <HelpTooltip
                    theme={t}
                    text="Minimum OTM distance as a percent of current price. Only strikes at or beyond this level are included."
                  >
                    <label style={{ ...labelStyle, display: "block" }}>Min OTM %</label>
                  </HelpTooltip>
                  <input
                    type="text"
                    inputMode="decimal"
                    style={inputStyle}
                    value={otmPctMin > 0 ? `${otmPctMin}%` : ""}
                    onChange={(e) => {
                      const raw = e.target.value.replace(/%/g, "");
                      setOtmPctMin(Number(raw) || 0);
                    }}
                    placeholder="5%"
                    aria-label="Minimum OTM percent"
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <HelpTooltip
                    theme={t}
                    text="Maximum OTM distance as a percent of current price. Only strikes within this level are included."
                  >
                    <label style={{ ...labelStyle, display: "block" }}>Max OTM %</label>
                  </HelpTooltip>
                  <input
                    type="text"
                    inputMode="decimal"
                    style={inputStyle}
                    value={otmPctMax > 0 ? `${otmPctMax}%` : ""}
                    onChange={(e) => {
                      const raw = e.target.value.replace(/%/g, "");
                      setOtmPctMax(Number(raw) || 0);
                    }}
                    placeholder="15%"
                    aria-label="Maximum OTM percent"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Target Expiration */}
          <div>
            <span style={labelStyle}>Target Expiration</span>
            {monthlyOnly ? (
              <ExpirationDropdown
                theme={t}
                value={expiration}
                options={expirations}
                onChange={(v) => setExpiration(v)}
                openId={openId}
                setOpenId={setOpenId}
                dropdownKey="expiration"
              />
            ) : (
              /* Month / Year picker — resolves to 3rd Friday, same as Options Optimizer */
              <div style={{ display: "flex", gap: t.spacing(2), alignItems: "flex-end" }}>
                <div style={{ flex: 1 }}>
                  <span style={{ ...labelStyle, display: "block", marginBottom: t.spacing(1) }}>Month</span>
                  <ExpirationDropdown
                    theme={t}
                    value={expiration.slice(5, 7) || "01"}
                    options={MONTH_OPTIONS}
                    onChange={(v) => {
                      const y = expYearInput.length === 4 ? Number(expYearInput) : new Date().getFullYear();
                      const thirdFri = getThirdFridayUTC(y, Number(v) - 1);
                      setExpiration(toISODateUTC(thirdFri));
                    }}
                    openId={openId}
                    setOpenId={setOpenId}
                    dropdownKey="expMonth"
                    dropdownMaxHeight={220}
                  />
                </div>
                <div style={{ flex: "0 0 76px" }}>
                  <span style={{ ...labelStyle, display: "block", marginBottom: t.spacing(1) }}>Year</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={4}
                    value={expYearInput}
                    onChange={(e) => {
                      const yr = e.target.value.replace(/\D/g, "").slice(0, 4);
                      setExpYearInput(yr);
                      if (yr.length === 4 && !isNaN(Number(yr))) {
                        const m = Number(expiration.slice(5, 7) || "1") - 1;
                        const thirdFri = getThirdFridayUTC(Number(yr), m);
                        setExpiration(toISODateUTC(thirdFri));
                      }
                    }}
                    placeholder={String(new Date().getFullYear())}
                    style={{
                      ...getDropdownTriggerStyle(t),
                      width: 76,
                      maxWidth: 76,
                      display: "block",
                      boxSizing: "border-box",
                      fontFamily: t.typography.fontFamily,
                    }}
                    aria-label="Expiry year"
                  />
                </div>
              </div>
            )}
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: t.spacing(2),
                marginTop: t.spacing(2),
                cursor: "pointer",
                fontSize: "0.82rem",
                color: t.colors.textMuted,
              }}
            >
              <input
                type="checkbox"
                checked={monthlyOnly}
                onChange={(e) => setMonthlyOnly(e.target.checked)}
              />
              <HelpTooltip
                theme={t}
                text="Monthly options only (3rd Friday expirations). When enabled, the expiry dropdown shows only standard monthly expirations."
              >
                <span style={{ cursor: "help" }}>Monthly expirations only</span>
              </HelpTooltip>
            </label>
          </div>

          {isFullUniverse ? (
          <div>
            <span style={labelStyle}>Scan depth</span>
            <div style={{ display: "flex", flexDirection: "column", gap: t.spacing(1) }}>
              {SCAN_DEPTH_OPTIONS.map(({ value, label, hint }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setScanDepth(value)}
                  aria-pressed={scanDepth === value}
                  style={{
                    padding: `${t.spacing(2)} ${t.spacing(2)}`,
                    borderRadius: t.radius.md,
                    border: `1px solid ${scanDepth === value ? t.colors.primary : t.colors.border}`,
                    backgroundColor: scanDepth === value ? `${t.colors.primary}18` : t.colors.background,
                    color: scanDepth === value ? t.colors.primary : t.colors.text,
                    cursor: "pointer",
                    textAlign: "left",
                    fontSize: "0.82rem",
                  }}
                >
                  <div style={{ fontWeight: 700 }}>{label}</div>
                  <div style={{ fontSize: "0.72rem", color: t.colors.textMuted, marginTop: 2 }}>{hint}</div>
                </button>
              ))}
            </div>
          </div>
          ) : null}

          <div>
            <span style={labelStyle}>
              <HelpTooltip
                theme={t}
                text="Strict hides wide spreads and low OI. Relaxed and Show all keep more names but rank illiquid contracts lower — look for wide spread / low OI badges."
              >
                <span style={{ cursor: "help" }}>Liquidity</span>
              </HelpTooltip>
            </span>
            <div style={{ display: "flex", gap: t.spacing(1) }}>
              {LIQUIDITY_MODE_OPTIONS.map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setLiquidityMode(value)}
                  aria-pressed={liquidityMode === value}
                  style={{
                    flex: 1,
                    padding: `${t.spacing(2)} ${t.spacing(1)}`,
                    borderRadius: t.radius.md,
                    border: `1px solid ${liquidityMode === value ? t.colors.primary : t.colors.border}`,
                    backgroundColor: liquidityMode === value ? `${t.colors.primary}18` : t.colors.background,
                    color: liquidityMode === value ? t.colors.primary : t.colors.text,
                    fontWeight: 700,
                    cursor: "pointer",
                    fontSize: "0.72rem",
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Min Market Cap (full universe only) */}
          {isFullUniverse ? (
          <div>
            <span style={labelStyle}>
              <HelpTooltip
                theme={t}
                text="Filters out names whose market cap from Schwab is below this level (when cap is available). Sorting always prefers larger-cap names first up to the scan limit. ETFs and missing cap: rows with no cap data still pass the filter — for a small ETF-only bucket, min cap often does little; for the full stock universe it mainly drops small names and improves average liquidity."
              >
                <span style={{ cursor: "help" }}>
                  Min Market Cap ($)
                </span>
              </HelpTooltip>
            </span>
            <div style={{ display: "flex", alignItems: "center", gap: t.spacing(1) }}>
              <span style={{ fontWeight: 800, color: t.colors.primary, fontSize: "0.9rem" }}>$</span>
              <input
                type="text"
                inputMode="numeric"
                value={minMarketCapText}
                onChange={(e) => {
                  const digits = e.target.value.replace(/[^0-9]/g, "");
                  setMinMarketCap(digits.length ? Number(digits) : 0);
                }}
                style={{ ...inputStyle }}
                aria-label="Minimum market cap"
              />
            </div>
          </div>
          ) : null}

          {/* Warnings */}
          {warnings.length > 0 && (
            <div style={{ fontSize: "0.78rem", color: t.colors.textMuted, lineHeight: 1.5 }}>
              {warnings.map((w, idx) => <div key={idx}>• {w}</div>)}
            </div>
          )}

          {/* Error */}
          {scanError && (
            <div
              role="alert"
              style={{ color: t.colors.danger, fontWeight: 600, fontSize: "0.82rem", lineHeight: 1.5 }}
            >
              {scanError}
            </div>
          )}
        </div>

        {/* Sticky footer: scan button */}
        <div
          style={fixedRails.railFooter}
        >
          <button
            type="button"
            style={{
              ...primaryBtn,
              ...getRailFooterActionButtonLayout(),
              position: "relative",
              overflow: "hidden",
              ...(scanProgress > 0 ? {
                backgroundColor: "transparent",
                border: `2px solid ${t.colors.primary}`,
                color: scanProgress >= 50 ? "#fff" : t.colors.primary,
              } : {}),
            }}
            onClick={onScan}
            disabled={scanning}
            aria-disabled={scanning}
          >
            {/* Progress fill — slides in from the left */}
            {scanProgress > 0 && (
              <span
                aria-hidden
                style={{
                  position: "absolute",
                  inset: 0,
                  width: `${scanProgress}%`,
                  backgroundColor: t.colors.primary,
                  transition: "width 0.25s ease",
                  zIndex: 0,
                }}
              />
            )}
            <span style={{ position: "relative", zIndex: 1, display: "inline-flex", alignItems: "center", gap: t.spacing(2) }}>
              {scanning && <span className="options-pricing-fetch-spinner" aria-hidden />}
              {scanning
                ? "Scanning…"
                : positionSide === "buy"
                ? "Run scan (buy to open)"
                : "Run scan (sell to open)"}
            </span>
          </button>
        </div>
        </div>
      </aside>

      {/* --- Results tables --- */}
      <div style={fixedRails.contentWrap}>
        {!hasResults && !scanning && !scanError && (
          <div
            className="page-card"
            style={{
              ...cardStyle,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              minHeight: 200,
              color: t.colors.textMuted,
              textAlign: "center",
              gap: t.spacing(2),
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 36, opacity: 0.4 }} aria-hidden>
              search
            </span>
            <p style={{ margin: 0, fontWeight: 600 }}>Configure parameters and click Run scan</p>
            <p style={{ margin: 0, fontSize: "0.85rem" }}>
              Results will appear here grouped by OTM band (5–9%, 10–14%, 15–19%, 20–30%)
            </p>
          </div>
        )}

        {hasResults && (
          <div
            className="page-card"
            style={{
              ...cardStyle,
              marginBottom: t.spacing(4),
              padding: t.spacing(3),
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: t.spacing(3),
              flexWrap: "wrap",
            }}
          >
            <div>
              <div style={{ fontSize: "0.72rem", fontWeight: 700, color: t.colors.textMuted, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: t.spacing(1) }}>
                Results view
              </div>
              <div style={{ display: "flex", gap: t.spacing(2) }}>
                {(
                  [
                    { v: "bands" as const, label: "Risk bands" },
                    { v: "leaderboard" as const, label: "Yield leaderboard" },
                  ] as const
                ).map(({ v, label }) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setResultsView(v)}
                    aria-pressed={resultsView === v}
                    style={{
                      padding: `${t.spacing(2)} ${t.spacing(3)}`,
                      borderRadius: t.radius.md,
                      border: `1px solid ${resultsView === v ? t.colors.primary : t.colors.border}`,
                      backgroundColor: resultsView === v ? `${t.colors.primary}18` : t.colors.background,
                      color: resultsView === v ? t.colors.primary : t.colors.text,
                      fontWeight: 700,
                      cursor: "pointer",
                      fontSize: "0.82rem",
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            {resultsView === "leaderboard" && lastScanDte != null && (
              <span style={{ fontSize: "0.78rem", color: t.colors.textMuted }}>
                Top 5 by period yield · {lastScanDte} DTE
              </span>
            )}
          </div>
        )}

        {/* ── Top Picks summary card ── */}
        {hasResults && resultsView === "bands" && outcomeOtmLayout === "bands" && (() => {
          const picks = OTM_LEVELS.map((lvl) => ({ lvl, row: resultsByOtmPct[lvl]?.[0] ?? null })).filter((p) => p.row != null) as Array<{ lvl: number; row: RankedOption }>;
          if (picks.length === 0) return null;

          // Find the "best free lunch" pick = highest IV/RV for write, lowest for buy
          let bestFreeLunchIdx = -1;
          let bestRatio = outcomePositionSide === "write" ? -Infinity : Infinity;
          picks.forEach(({ row }, i) => {
            const iv = row.impliedVolPct ?? null;
            const rv = row.realizedVol20dPct ?? null;
            if (iv == null || rv == null || rv <= 0) return;
            const ratio = iv / rv;
            if (outcomePositionSide === "write" ? ratio > bestRatio : ratio < bestRatio) {
              bestRatio = ratio;
              bestFreeLunchIdx = i;
            }
          });

          return (
            <div style={{ ...cardStyle, marginBottom: t.spacing(4) }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: t.spacing(2), marginBottom: t.spacing(3), flexWrap: "nowrap", overflow: "hidden" }}>
                <h3 style={{ ...sectionTitleStyle, marginBottom: 0, flexShrink: 0 }}>Top Picks</h3>
                <span style={{ fontSize: "0.78rem", color: t.colors.textMuted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>Best-scoring opportunity at each OTM level — no ticker repeats across levels</span>
              </div>
              <div style={{ display: "flex", gap: t.spacing(3), flexWrap: "wrap" }}>
                {picks.map(({ lvl, row }, i) => {
                  const iv = row.impliedVolPct ?? null;
                  const rv = row.realizedVol20dPct ?? null;
                  const ratio = iv != null && rv != null && rv > 0 ? iv / rv : null;
                  const isFreeLunch = i === bestFreeLunchIdx;
                  return (
                    <div
                      key={lvl}
                      style={{
                        flex: "1 1 170px",
                        minWidth: 160,
                        borderRadius: t.radius.md,
                        border: `1.5px solid ${isFreeLunch ? rankingColors.gold : t.colors.border}`,
                        backgroundColor: isFreeLunch ? "rgba(212,175,55,0.06)" : t.colors.background,
                        padding: t.spacing(3),
                        display: "flex",
                        flexDirection: "column",
                        gap: t.spacing(1),
                      }}
                    >
                      {/* OTM badge */}
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <span style={{
                          fontSize: "0.68rem",
                          fontWeight: 700,
                          color: t.colors.secondary,
                          textTransform: "uppercase",
                          letterSpacing: "0.05em",
                        }}>
                          {{ 5: "5–9%", 10: "10–14%", 15: "15–19%", 20: "20–30%" }[lvl] ?? `${lvl}%`} OTM
                        </span>
                        {isFreeLunch && (
                          <span style={{
                            fontSize: "0.62rem",
                            fontWeight: 700,
                            color: rankingColors.gold,
                            textTransform: "uppercase",
                            letterSpacing: "0.04em",
                          }}>
                            ★ Best IV/RV
                          </span>
                        )}
                      </div>

                      {/* Ticker */}
                      <div style={{ fontWeight: 800, fontSize: "1.25rem", color: t.colors.text, lineHeight: 1 }}>
                        {row.ticker}
                      </div>

                      {/* Company */}
                      <div style={{ fontSize: "0.72rem", color: t.colors.textMuted, lineHeight: 1.3, overflow: "hidden" }}>
                        <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.company}</div>
                      </div>

                      {/* Key stats */}
                      <div style={{ marginTop: t.spacing(1), display: "flex", flexDirection: "column", gap: 3 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.75rem" }}>
                          <span style={{ color: t.colors.textMuted }}>{outcomePositionSide === "buy" ? "Ann. debit %" : "Ann. yield"}</span>
                          <span style={{ fontWeight: 700, color: outcomePositionSide === "buy" ? t.colors.text : t.colors.success }}>
                            {row.annYieldPct.toFixed(1)}%
                          </span>
                        </div>
                        {ratio != null && (
                          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.75rem" }}>
                            <span style={{ color: t.colors.textMuted }}>IV/RV</span>
                            <span style={{ fontWeight: 700, color: (() => {
                              if (outcomePositionSide === "buy") {
                                return ratio < 1.0 ? t.colors.success : ratio >= 1.15 ? t.colors.danger : t.colors.textMuted;
                              }
                              return ratio >= 1.0 ? t.colors.success : ratio < 0.85 ? t.colors.danger : t.colors.textMuted;
                            })() }}>
                              {ratio.toFixed(2)}×
                            </span>
                          </div>
                        )}
                        {row.delta != null && (
                          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.75rem" }}>
                            <span style={{ color: t.colors.textMuted }}>Δ Prob</span>
                            <span style={{ fontWeight: 600, color: t.colors.text }}>{(row.delta * 100).toFixed(0)}%</span>
                          </div>
                        )}
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.75rem" }}>
                          <span style={{ color: t.colors.textMuted }}>Strike</span>
                          <span style={{ fontWeight: 600, color: t.colors.text }}>{formatStrikePrice(row.strike)}</span>
                        </div>
                      </div>

                      {/* Schwab symbol display + copy */}
                      {(() => {
                        const copyKey = `summary-${lvl}-${row.ticker}`;
                        const copied = lastCopiedOpportunityKey === copyKey;
                        return (
                          <button
                            type="button"
                            onClick={() => {
                              void navigator.clipboard.writeText(row.schwabSymbol);
                              setLastCopiedOpportunityKey(copyKey);
                              window.setTimeout(() => setLastCopiedOpportunityKey((p) => p === copyKey ? null : p), 1200);
                            }}
                            title={`Copy: ${row.schwabSymbol}`}
                            style={{
                              marginTop: t.spacing(1),
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              gap: 4,
                              width: "100%",
                              padding: `${t.spacing(1)} ${t.spacing(2)}`,
                              border: `1px solid ${copied ? t.colors.success : t.colors.border}`,
                              borderRadius: t.radius.sm,
                              background: copied ? `${t.colors.success}12` : "none",
                              cursor: "pointer",
                              fontFamily: "ui-monospace, monospace",
                              transition: "border-color 0.15s ease, background 0.15s ease",
                            }}
                          >
                            <span style={{
                              fontSize: "0.68rem",
                              color: copied ? t.colors.success : t.colors.text,
                              fontWeight: 600,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                              flex: 1,
                              textAlign: "left",
                            }}>
                              {row.schwabSymbol}
                            </span>
                            <span
                              className="material-symbols-outlined"
                              style={{ fontSize: 13, flexShrink: 0, color: copied ? t.colors.success : t.colors.textMuted }}
                              aria-hidden
                            >
                              {copied ? "check" : "content_copy"}
                            </span>
                          </button>
                        );
                      })()}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}

        {resultsView === "bands" && bandLevelsForDisplay.map((otmPct) => {
          const arr = sortBucketRows(resultsByOtmPct[otmPct] ?? []);
          const bandLabel = formatOtmBandLabel(otmPct, rangeForBandLabels);
          if (!hasResults && !scanning) return null;
          return (
            <div key={otmPct} className="page-card" style={cardStyle}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: t.spacing(3) }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: t.spacing(3) }}>
                  <h3 style={{ ...sectionTitleStyle, marginBottom: 0 }}>{bandLabel.headline}</h3>
                  <span style={{ fontSize: "0.8rem", color: t.colors.textMuted }}>{bandLabel.detail}</span>
                </div>
                {arr.length > 0 && (() => {
                  const bucketKey = `bucket-${otmPct}`;
                  const bucketCopied = lastCopiedBucketKey === bucketKey;
                  return (
                    <button
                      type="button"
                      title="Copy table to clipboard (Excel format)"
                      aria-label="Copy table to clipboard"
                      onClick={() => {
                        void navigator.clipboard.writeText(buildBucketTsv(arr, outcomePositionSide, lastScanDte));
                        setLastCopiedBucketKey(bucketKey);
                        window.setTimeout(
                          () => setLastCopiedBucketKey((p) => p === bucketKey ? null : p),
                          1500
                        );
                      }}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: t.spacing(1),
                        padding: `${t.spacing(1)}px ${t.spacing(2)}px`,
                        border: `1px solid ${bucketCopied ? t.colors.success : t.colors.border}`,
                        borderRadius: t.radius.sm,
                        background: bucketCopied ? `${t.colors.success}12` : "none",
                        color: bucketCopied ? t.colors.success : t.colors.textMuted,
                        fontSize: "0.78rem",
                        fontWeight: 500,
                        cursor: "pointer",
                        transition: "color 0.15s, border-color 0.15s, background 0.15s",
                        flexShrink: 0,
                      }}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 15 }} aria-hidden>
                        {bucketCopied ? "check" : "content_copy"}
                      </span>
                      {bucketCopied ? "Copied!" : "Copy table"}
                    </button>
                  );
                })()}
              </div>

              {scanning && arr.length === 0 ? (
                <div style={{ color: t.colors.textMuted, fontSize: "0.85rem", padding: t.spacing(2) }}>
                  Scanning…
                </div>
              ) : (
                <div style={tableWrapStyle}>
                  <table style={tableStyle}>
                    {renderScreenerTableHead({ leftRadius: true, rightRadius: true })}
                    <tbody>
                      {arr.length === 0 ? (
                        <tr>
                          <td colSpan={13} style={{ ...tdStyle, color: t.colors.textMuted }}>
                            No results for this OTM level
                          </td>
                        </tr>
                      ) : (
                        renderScreenerResultRows(arr, `bucket-${otmPct}`)
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}

        {hasResults && resultsView === "leaderboard" && (
          <div className="page-card" style={cardStyle}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: t.spacing(3) }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: t.spacing(3), flexWrap: "wrap" }}>
                <h3 style={{ ...sectionTitleStyle, marginBottom: 0 }}>Top 5 Yield Leaderboard</h3>
                <span style={{ fontSize: "0.8rem", color: t.colors.textMuted }}>
                  Highest period yield across all OTM bands — one row per ticker
                  {lastScanDte != null ? ` · ${lastScanDte} DTE` : ""}
                </span>
              </div>
              {leaderboardRows.length > 0 && (() => {
                const bucketKey = "leaderboard";
                const bucketCopied = lastCopiedBucketKey === bucketKey;
                return (
                  <button
                    type="button"
                    title="Copy table to clipboard (Excel format)"
                    aria-label="Copy leaderboard to clipboard"
                    onClick={() => {
                      void navigator.clipboard.writeText(buildBucketTsv(leaderboardRows, outcomePositionSide, lastScanDte));
                      setLastCopiedBucketKey(bucketKey);
                      window.setTimeout(
                        () => setLastCopiedBucketKey((p) => p === bucketKey ? null : p),
                        1500
                      );
                    }}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: t.spacing(1),
                      padding: `${t.spacing(1)}px ${t.spacing(2)}px`,
                      border: `1px solid ${bucketCopied ? t.colors.success : t.colors.border}`,
                      borderRadius: t.radius.sm,
                      background: bucketCopied ? `${t.colors.success}12` : "none",
                      color: bucketCopied ? t.colors.success : t.colors.textMuted,
                      fontSize: "0.78rem",
                      fontWeight: 500,
                      cursor: "pointer",
                      transition: "color 0.15s, border-color 0.15s, background 0.15s",
                      flexShrink: 0,
                    }}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 15 }} aria-hidden>
                      {bucketCopied ? "check" : "content_copy"}
                    </span>
                    {bucketCopied ? "Copied!" : "Copy table"}
                  </button>
                );
              })()}
            </div>

            {scanning && leaderboardRows.length === 0 ? (
              <div style={{ color: t.colors.textMuted, fontSize: "0.85rem", padding: t.spacing(2) }}>
                Scanning…
              </div>
            ) : (
              <div style={tableWrapStyle}>
                <table style={tableStyle}>
                  {renderScreenerTableHead({ leftRadius: true, rightRadius: true })}
                  <tbody>
                    {leaderboardRows.length === 0 ? (
                      <tr>
                        <td colSpan={13} style={{ ...tdStyle, color: t.colors.textMuted }}>
                          No results for this scan
                        </td>
                      </tr>
                    ) : (
                      renderScreenerResultRows(leaderboardRows, "leaderboard", (i) => i + 1)
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        {hasResults && (
          <footer
            style={{
              marginTop: t.spacing(3),
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
            {lastScanAt && (
              <span>
                Data as of{" "}
                {lastScanAt.toLocaleString(undefined, {
                  year: "numeric",
                  month: "short",
                  day: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            )}
          </footer>
        )}
      </div>

      <aside style={fixedRails.rightRail}>
        <div
          className="page-card"
          style={{
            ...fixedRails.railPanel,
            gap: t.spacing(2),
            overflow: "hidden",
          }}
        >
          <h3 style={{ ...sectionTitleStyle, marginBottom: 0 }}>Universe buckets</h3>
          <p style={{ margin: 0, fontSize: "0.78rem", color: t.colors.textMuted, lineHeight: 1.45 }}>
            Choose a ticker set for this scan. Buckets restrict the scan to those symbols only (no index movers).
          </p>
          <div
            style={{
              flex: 1,
              overflowY: "auto",
              display: "flex",
              flexDirection: "column",
              gap: t.spacing(2),
              paddingRight: t.spacing(1),
              scrollbarWidth: "thin",
            }}
          >
            {OPPORTUNITY_BUCKETS.map((bucket) => {
              const selected = bucket.id === bucketId;
              return (
                <div key={bucket.id}>
                  <button
                    type="button"
                    onClick={() => setBucketId(bucket.id)}
                    style={{
                      width: "100%",
                      textAlign: "left",
                      padding: `${t.spacing(2)} ${t.spacing(2)}`,
                      borderRadius: t.radius.md,
                      border: `1px solid ${selected ? t.colors.primary : t.colors.border}`,
                      backgroundColor: selected ? `${t.colors.primary}14` : t.colors.background,
                      cursor: "pointer",
                      fontFamily: t.typography.fontFamily,
                      transition: "border-color 0.15s ease, background-color 0.15s ease",
                    }}
                  >
                    <div style={{ fontWeight: 700, fontSize: "0.88rem", color: t.colors.text }}>{bucket.label}</div>
                    <div style={{ fontSize: "0.75rem", color: t.colors.textMuted, marginTop: t.spacing(0.5) }}>
                      {bucket.description}
                    </div>
                    <div style={{ fontSize: "0.72rem", color: t.colors.primary, marginTop: t.spacing(1), fontWeight: 600 }}>
                      {bucket.symbols.length === 0 ? "Full universe + movers" : `${bucket.symbols.length} tickers`}
                    </div>
                  </button>
                  {bucket.symbols.length > 0 ? (
                    <details style={{ marginTop: t.spacing(1), marginLeft: t.spacing(1) }}>
                      <summary
                        style={{
                          fontSize: "0.72rem",
                          color: t.colors.textMuted,
                          cursor: "pointer",
                          userSelect: "none",
                        }}
                      >
                        View tickers
                      </summary>
                      <div
                        style={{
                          marginTop: t.spacing(1),
                          fontSize: "0.7rem",
                          color: t.colors.textMuted,
                          fontFamily: "ui-monospace, monospace",
                          lineHeight: 1.5,
                          maxHeight: 120,
                          overflowY: "auto",
                        }}
                      >
                        {bucket.symbols.join(", ")}
                      </div>
                    </details>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      </aside>

    </section>
  );
}
