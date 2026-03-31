import { useEffect, useMemo, useState } from "react";
import type { Theme } from "../theme";
import {
  getFixedRailsLayoutStyles,
  getPrimaryActionButtonStyle,
  getRailFooterActionButtonLayout,
  getDropdownTriggerStyle,
  getDropdownPanelStyle,
  getDropdownOptionStyle,
  getTooltipIconStyle,
  getTooltipBubbleStyle,
  THEME_DROPDOWN_OPTION_CLASS,
  PAGE_LAYOUT,
} from "../theme";
import { createPortal } from "react-dom";
import { OPPORTUNITY_BUCKETS, type OpportunityBucket } from "../lib/opportunityBuckets";

const SCHWAB_API_BASE =
  (import.meta.env.VITE_SCHWAB_API_BASE as string) || "https://therpghub.vercel.app";

type OptionType = "puts" | "calls";

type RankedOption = {
  rank: number;
  ticker: string;
  company: string;
  oneMonthPerfPct: number | null;
  otmPct: number;
  strike: number;
  bid: number;
  annYieldPct: number;
  premiumPerContract: number;
  schwabSymbol: string;
  occSymbol: string;
};

type ScreenerResponse = {
  resultsByOtmPct: Record<number, RankedOption[]>;
  message: string | null;
  warnings?: string[];
  expiration?: string;
  optionType?: "P" | "C";
  dte?: number;
};

const OTM_LEVELS = [5, 10, 15, 20] as const;

function formatMoney(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "−" : "";
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(2)}`;
}

/** Premium per contract: dollar sign, plain integer, no K abbreviation. e.g. $2,275 or $340 */
function formatPremium(n: number): string {
  const rounded = Math.round(Math.abs(n));
  return (n < 0 ? "−$" : "$") + rounded.toLocaleString("en-US");
}

function formatPct(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

function toISODateUTC(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function getThirdFridayUTC(year: number, monthIndex0: number): Date {
  const first = new Date(Date.UTC(year, monthIndex0, 1));
  const day = first.getUTCDay();
  const offset = (5 - day + 7) % 7;
  return new Date(Date.UTC(year, monthIndex0, 1 + offset + 14));
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

function ExpirationDropdown(props: {
  theme: Theme;
  value: string;
  options: DropdownOption[];
  onChange: (v: string) => void;
  openId: string | null;
  setOpenId: (id: string | null) => void;
  dropdownKey: string;
}) {
  const { theme: t, value, options, onChange, openId, setOpenId, dropdownKey } = props;
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
            style={{ position: "fixed", inset: 0, zIndex: 4998 }}
            onClick={() => setOpenId(null)}
          />
          <div style={{ ...getDropdownPanelStyle(t, "down"), zIndex: 20000 }}>
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

export type OptionsOpportunitiesProps = { theme: Theme; sidebarWidth: number };

const otmLabels: Record<number, { headline: string; detail: string }> = {
  5:  { headline: "5% OTM",  detail: "Higher risk, higher yield" },
  10: { headline: "10% OTM", detail: "Aggressive" },
  15: { headline: "15% OTM", detail: "Moderate" },
  20: { headline: "20% OTM", detail: "Conservative, lower yield" },
};

export function OptionsOpportunities({ theme: t, sidebarWidth }: OptionsOpportunitiesProps) {
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
    color: "#FFFFFF",
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

  const cardStyle: React.CSSProperties = {
    backgroundColor: t.colors.surface,
    borderRadius: t.radius.lg,
    padding: t.spacing(4),
    marginBottom: t.spacing(4),
    border: `1px solid ${t.colors.border}`,
    boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
  };

  const primaryBtn = getPrimaryActionButtonStyle(t);

  const expirations = useMemo(() => getMonthlyThirdFridayExpirations(18), []);

  const [optionType, setOptionType] = useState<OptionType>("puts");
  const [monthlyOnly, setMonthlyOnly] = useState(true);
  const [expiration, setExpiration] = useState<string>(expirations[0]?.value ?? "");
  const [openId, setOpenId] = useState<string | null>(null);
  const [minMarketCap, setMinMarketCap] = useState<number>(500_000_000);
  const minMarketCapText = useMemo(() => minMarketCap.toLocaleString("en-US"), [minMarketCap]);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [resultsByOtmPct, setResultsByOtmPct] = useState<Record<number, RankedOption[]>>({});
  const [lastCopiedOpportunityKey, setLastCopiedOpportunityKey] = useState<string | null>(null);
  const [lastScanAt, setLastScanAt] = useState<Date | null>(null);
  const [showInfoModal, setShowInfoModal] = useState(false);
  const [bucketId, setBucketId] = useState<string>(OPPORTUNITY_BUCKETS[0]!.id);

  const activeBucket: OpportunityBucket = useMemo(
    () => OPPORTUNITY_BUCKETS.find((b) => b.id === bucketId) ?? OPPORTUNITY_BUCKETS[0]!,
    [bucketId]
  );

  useEffect(() => {
    if (!showInfoModal) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setShowInfoModal(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showInfoModal]);

  const hasResults = OTM_LEVELS.some((l) => (resultsByOtmPct[l] ?? []).length > 0);

  async function onScan() {
    if (!expiration) return;
    setScanError(null);
    setWarnings([]);
    setResultsByOtmPct({});
    setScanning(true);
    try {
      const payload: Record<string, unknown> = {
        optionType,
        expiration,
        otmLevels: Array.from(OTM_LEVELS),
        topN: 10,
        minMarketCap,
        // % points: listed strike OTM distance must be within this of target (wider grid / $ strikes).
        strikeTolerancePct: 3,
        monthlyOnly,
      };
      if (activeBucket.symbols.length > 0) {
        payload.universeSymbols = activeBucket.symbols;
      }

      const res = await fetch(`${SCHWAB_API_BASE}/api/schwab-options-opportunity-screener`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      let json: ScreenerResponse & { error?: string } = { resultsByOtmPct: {}, message: null, warnings: [] };
      try { json = await res.json(); } catch { /* non-JSON body */ }

      if (!res.ok) {
        setScanError(
          (typeof json.error === "string" && json.error) ||
          (json.message != null ? String(json.message) : null) ||
          `Scan failed (${res.status})`
        );
        return;
      }
      setWarnings(json.warnings ?? []);
      setScanError(json.message ? String(json.message) : null);
      setResultsByOtmPct(json.resultsByOtmPct ?? {});
      if (res.ok) {
        const hasAnyOtm = OTM_LEVELS.some((l) => (json.resultsByOtmPct?.[l] ?? []).length > 0);
        if (hasAnyOtm) setLastScanAt(new Date());
      }
    } catch (err: any) {
      setScanError(err?.message ? String(err.message) : "Unexpected error scanning from Schwab.");
    } finally {
      setScanning(false);
    }
  }

  return (
    <section className="options-opportunities-page" style={fixedRails.page}>

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
              Options Opportunities
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
          Scan US equities for highest annualized option yields at 5%, 10%, 15%, and 20% OTM levels using live Schwab data.
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
            aria-labelledby="opportunities-info-title"
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
              <h3 id="opportunities-info-title" style={{ ...sectionTitleStyle, marginBottom: 0, color: t.colors.secondary }}>How Options Opportunities works</h3>
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

              <p style={{ fontWeight: 700, marginBottom: t.spacing(1), color: t.colors.primary }}>What this page does</p>
              <p style={{ marginBottom: t.spacing(3) }}>
                Options Opportunities scans a broad universe of US equities (S&P 500, NASDAQ 100, major ETFs, and live Schwab movers) for the highest-yielding short option opportunities at four standard OTM levels: <strong>5%, 10%, 15%, and 20%</strong> out-of-the-money. Results are ranked by annualized yield within each OTM bucket.
              </p>

              <p style={{ fontWeight: 700, marginBottom: t.spacing(1), color: t.colors.primary }}>How the scan works</p>
              <ul style={{ margin: 0, marginBottom: t.spacing(3), paddingLeft: t.spacing(5) }}>
                <li><strong>Universe</strong> — default scan uses ~660 hardcoded tickers (S&P 500, NASDAQ 100, major ETFs) plus live Schwab top movers. You can narrow to a <strong>bucket</strong> from the right panel (e.g. Climate / Energy transition); buckets do not add movers.</li>
                <li><strong>Market cap filter</strong> — symbols are sorted by market cap (largest first) so the most liquid names are always scanned first. You can set a minimum market cap to exclude smaller, less-liquid stocks.</li>
                <li><strong>Option chain fetch</strong> — for each symbol, we pull the option chain for your chosen expiration and locate the strike closest to each OTM % target (5/10/15/20% away from the current price).</li>
                <li><strong>Limit price</strong> — the midpoint of the bid/ask spread for that strike, representing the realistic fill price.</li>
              </ul>

              <p style={{ fontWeight: 700, marginBottom: t.spacing(1), color: t.colors.primary }}>How ranking works</p>
              <ul style={{ margin: 0, marginBottom: t.spacing(3), paddingLeft: t.spacing(5) }}>
                <li><strong>Annualized Yield</strong> — <em>(limit price ÷ strike) × (365 ÷ DTE)</em>. Normalizes premium across different expirations so a 30-day and a 60-day option can be compared fairly.</li>
                <li><strong>1M Performance</strong> — the underlying's trailing 1-month price return. Useful context when deciding if a stock's recent momentum aligns with selling puts (bullish) or calls (bearish).</li>
                <li>Within each OTM bucket, results are sorted by annualized yield — highest yield at the top.</li>
              </ul>

              <p style={{ fontWeight: 700, marginBottom: t.spacing(1), color: t.colors.primary }}>Scan parameters</p>
              <ul style={{ margin: 0, marginBottom: t.spacing(3), paddingLeft: t.spacing(5) }}>
                <li><strong>Option Type</strong> — Puts (most common for cash-secured selling) or Calls (for covered calls).</li>
                <li><strong>Expiration</strong> — the target expiry date. Monthly expirations (3rd Friday) tend to have the best liquidity.</li>
                <li><strong>Monthly Only</strong> — filters the expiry dropdown to standard monthly expirations only.</li>
                <li><strong>Min Market Cap</strong> — exclude micro/small caps with potentially wide bid/ask spreads. Default $500M.</li>
              </ul>

              <p style={{ fontWeight: 700, marginBottom: t.spacing(1), color: t.colors.primary }}>Table columns</p>
              <ul style={{ margin: 0, marginBottom: t.spacing(2), paddingLeft: t.spacing(5) }}>
                <li><strong>Company</strong> — ticker and company name from Schwab.</li>
                <li><strong>1M Perf</strong> — trailing 1-month price return of the underlying.</li>
                <li><strong>Strike</strong> — the option strike closest to the target OTM %.</li>
                <li><strong>Bid</strong> — current bid price for the option (per share).</li>
                <li><strong>Ann. Yield</strong> — annualized yield based on limit price (mid of bid/ask) and strike notional.</li>
                <li><strong>Premium</strong> — total premium received per contract (limit price × 100 shares), rounded to the nearest dollar.</li>
              </ul>

            </div>
          </div>
        </>
      )}

      {/* ── Left rail: Scan Parameters ── */}
      <aside style={fixedRails.leftRail}>
        <div
          className="options-opportunities-scan-card"
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
              <div style={{ marginTop: t.spacing(1) }}>Full list + Schwab movers. Change buckets in the right panel.</div>
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
              <input
                type="date"
                value={expiration}
                onChange={(e) => setExpiration(e.target.value)}
                style={inputStyle}
                aria-label="Expiration date"
              />
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

          {/* Min Market Cap */}
          <div>
            <span style={labelStyle}>
              <HelpTooltip
                theme={t}
                text="Only scan stocks with at least this market cap. Larger companies tend to have tighter bid/ask spreads and better option liquidity."
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
            style={{ ...primaryBtn, ...getRailFooterActionButtonLayout() }}
            onClick={onScan}
            disabled={scanning}
            aria-disabled={scanning}
          >
            {scanning ? (
              <span style={{ display: "inline-flex", alignItems: "center", gap: t.spacing(2) }}>
                <span className="options-pricing-fetch-spinner" aria-hidden />
                Scanning…
              </span>
            ) : (
              "Scan for Highest Yields"
            )}
          </button>
        </div>
        </div>
      </aside>

      {/* ── Content area: OTM tables ── */}
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
            <p style={{ margin: 0, fontWeight: 600 }}>Configure your scan parameters and click Scan for Highest Yields</p>
            <p style={{ margin: 0, fontSize: "0.85rem" }}>
              Results will appear here grouped by OTM level (5%, 10%, 15%, 20%)
            </p>
          </div>
        )}

        {OTM_LEVELS.map((otmPct) => {
          const arr = resultsByOtmPct[otmPct] ?? [];
          if (!hasResults && !scanning) return null;
          return (
            <div key={otmPct} className="page-card" style={cardStyle}>
              <div style={{ display: "flex", alignItems: "baseline", gap: t.spacing(3), marginBottom: t.spacing(3) }}>
                <h3 style={{ ...sectionTitleStyle, marginBottom: 0 }}>{otmLabels[otmPct].headline}</h3>
                <span style={{ fontSize: "0.8rem", color: t.colors.textMuted }}>{otmLabels[otmPct].detail}</span>
              </div>

              {scanning && arr.length === 0 ? (
                <div style={{ color: t.colors.textMuted, fontSize: "0.85rem", padding: t.spacing(2) }}>
                  Scanning…
                </div>
              ) : (
                <div style={tableWrapStyle}>
                  <table style={tableStyle}>
                    <thead>
                      <tr>
                        <th style={{ ...thStyle, borderTopLeftRadius: t.radius.md }}>Rank</th>
                        <th style={thStyle}>Ticker</th>
                        <th style={thStyle}>Company</th>
                        <th style={thNumStyle}>1M Perf</th>
                        <th style={thNumStyle}>Strike</th>
                        <th style={thNumStyle}>Bid</th>
                        <th style={thNumStyle}>Ann. Yield</th>
                        <th style={thNumStyle}>Premium</th>
                        <th style={{ ...thStyle, textAlign: "center", borderTopRightRadius: t.radius.md }}>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {arr.length === 0 ? (
                        <tr>
                          <td colSpan={9} style={{ ...tdStyle, color: t.colors.textMuted }}>
                            No results for this OTM level
                          </td>
                        </tr>
                      ) : (
                        arr.map((r) => {
                          const copyKey = `${otmPct}-${r.ticker}-${r.strike}`;
                          return (
                            <tr key={`${r.ticker}-${r.strike}-${r.otmPct}`} style={{ borderBottom: `1px solid ${t.colors.border}` }}>
                              <td
                                style={{
                                  ...tdStyle,
                                  fontWeight: 600,
                                  color:
                                    r.rank === 1 ? "#D4AF37" :
                                    r.rank === 2 ? "#C0C0C0" :
                                    r.rank === 3 ? "#CD7F32" :
                                    t.colors.text,
                                }}
                              >
                                #{r.rank}
                              </td>
                              <td style={{ ...tdStyle, fontWeight: 600 }}>{r.ticker}</td>
                              <td style={tdStyle}>{r.company}</td>
                              <td
                                style={{
                                  ...tdNumStyle,
                                  color: r.oneMonthPerfPct == null
                                    ? t.colors.textMuted
                                    : r.oneMonthPerfPct >= 0
                                      ? t.colors.success
                                      : t.colors.danger,
                                }}
                              >
                                {formatPct(r.oneMonthPerfPct)}
                              </td>
                              <td style={tdNumStyle}>${r.strike.toFixed(2)}</td>
                              <td style={tdNumStyle}>${r.bid.toFixed(2)}</td>
                              <td style={{ ...tdNumStyle, color: t.colors.success }}>
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
                                  title="Copy Schwab order symbol"
                                  aria-label="Copy Schwab order symbol"
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
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}

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
