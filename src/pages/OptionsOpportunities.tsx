import { useMemo, useState } from "react";
import type { Theme } from "../theme";
import {
  PAGE_LAYOUT,
  getPrimaryActionButtonStyle,
  getDropdownTriggerStyle,
  getDropdownPanelStyle,
  getDropdownOptionStyle,
  getTooltipIconStyle,
  getTooltipBubbleStyle,
  THEME_DROPDOWN_OPTION_CLASS,
} from "../theme";

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

function formatPct(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n >= 0 ? "" : "−"}${Math.abs(n).toFixed(2)}%`;
}

function toISODateUTC(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function getThirdFridayUTC(year: number, monthIndex0: number): Date {
  const first = new Date(Date.UTC(year, monthIndex0, 1));
  const day = first.getUTCDay();
  const friday = 5; // Friday
  const offset = (friday - day + 7) % 7;
  const date = 1 + offset + 2 * 7; // 3rd Friday
  return new Date(Date.UTC(year, monthIndex0, date));
}

function getMonthlyThirdFridayExpirations(maxMonthsAhead: number): { value: string; label: string }[] {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const out: { value: string; label: string }[] = [];

  for (let i = 0; i <= maxMonthsAhead; i++) {
    const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1));
    const year = d.getUTCFullYear();
    const month = d.getUTCMonth();
    const thirdFriday = getThirdFridayUTC(year, month);
    if (thirdFriday.getTime() < start.getTime()) continue;

    const value = toISODateUTC(thirdFriday);
    // Expiry is stored as UTC calendar date; format label in UTC too — otherwise US timezones
    // show the previous local day (e.g. Mar 20 expiry displays as "Mar 19").
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
    options.find((o) => o.value === value)?.label ?? (value ? value : "-- Select Expiration --");

  return (
    <div style={{ position: "relative", minWidth: 0 }}>
      <button
        type="button"
        onClick={() => setOpenId(open ? null : dropdownKey)}
        style={{ ...getDropdownTriggerStyle(t), minWidth: 240 }}
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
            style={{ position: "fixed", inset: 0, zIndex: 4998 }}
            onClick={() => setOpenId(null)}
          />
          <div style={{ ...getDropdownPanelStyle(t, "down"), zIndex: 20000 }}>
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

type OptionsOpportunitiesProps = { theme: Theme };

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
        <div
          style={{
            ...getTooltipBubbleStyle(t),
            // Make tooltip readable and prevent it from looking "skinny".
            maxWidth: 560,
            minWidth: 280,
            whiteSpace: "normal",
          }}
          role="tooltip"
        >
          {text}
        </div>
      )}
    </span>
  );
}

export function OptionsOpportunities({ theme: t }: OptionsOpportunitiesProps) {
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
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    marginBottom: t.spacing(3),
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: `${t.spacing(2)} ${t.spacing(3)}`,
    height: 40,
    fontSize: t.typography.baseFontSize,
    border: `1px solid ${t.colors.border}`,
    borderRadius: t.radius.md,
    backgroundColor: t.colors.surface,
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

  const primaryBtn = getPrimaryActionButtonStyle(t);

  const expirations = useMemo(() => getMonthlyThirdFridayExpirations(18), []);

  const [optionType, setOptionType] = useState<OptionType>("puts");
  const [monthlyOnly, setMonthlyOnly] = useState(true);
  const [expiration, setExpiration] = useState<string>(expirations[0]?.value ?? "");
  const [openId, setOpenId] = useState<string | null>(null);

  const [minMarketCap, setMinMarketCap] = useState<number>(500_000_000);
  const minMarketCapText = useMemo(() => minMarketCap.toLocaleString("en-US"), [minMarketCap]);
  /** How many underlyings to pull chains for after market-cap filter (API / timeout tradeoff). */
  const [maxUnderlyingsToScan, setMaxUnderlyingsToScan] = useState(50);

  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [resultsByOtmPct, setResultsByOtmPct] = useState<Record<number, RankedOption[]>>({});
  const [lastCopiedOpportunityKey, setLastCopiedOpportunityKey] = useState<string | null>(null);

  async function onScan() {
    if (!expiration) return;
    setScanError(null);
    setWarnings([]);
    setResultsByOtmPct({});

    setScanning(true);
    try {
      const payload = {
        optionType,
        expiration,
        otmLevels: Array.from(OTM_LEVELS),
        topN: 5,
        minMarketCap,
        maxUnderlyingsToScan,
        strikeTolerancePct: 1.25,
        monthlyOnly,
      };

      const res = await fetch(`${SCHWAB_API_BASE}/api/schwab-options-opportunity-screener`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      let json: ScreenerResponse & { error?: string } = {
        resultsByOtmPct: {},
        message: null,
        warnings: [],
      };
      try {
        json = await res.json();
      } catch {
        /* non-JSON body */
      }

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
    } catch (err: any) {
      setScanError(err?.message ? String(err.message) : "Unexpected error scanning from Schwab.");
    } finally {
      setScanning(false);
    }
  }

  const otmLabels: Record<number, { headline: string; detail: string }> = {
    5: { headline: "5% OTM", detail: "Higher risk, higher yield" },
    10: { headline: "10% OTM", detail: "Aggressive" },
    15: { headline: "15% OTM", detail: "Moderate" },
    20: { headline: "20% OTM", detail: "Conservative, lower yield" },
  };

  return (
    <section className="options-opportunities-page" style={pageStyle}>
      <div
        className="options-opportunities-header-row"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginTop: PAGE_LAYOUT.titleBlockMarginTop,
          marginBottom: t.spacing(PAGE_LAYOUT.titleMarginBottom),
          gap: t.spacing(2),
        }}
      >
        <h2 style={{ ...titleStyle, margin: 0, lineHeight: 1.3 }}>
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
      </div>

      <p style={descStyle}>
        Scan options chains for the highest annualized yields at different OTM levels using live Schwab data.{" "}
        <strong>Universe:</strong> constituents are loaded from a public{" "}
        <strong>S&amp;P 500–style CSV</strong> at scan time (URL overridable server-side with{" "}
        <code style={{ fontSize: "0.85em" }}>SCREENER_UNIVERSE_CSV_URL</code>), then filtered by your{" "}
        <strong>minimum market cap</strong> using Schwab quotes. Only the largest names (by market cap) are
        chain-scanned per run so we stay within Schwab rate limits and server timeouts—raise{" "}
        <strong>Max symbols to scan</strong> for broader coverage if needed.
      </p>

      <div
        className="page-card options-opportunities-card options-opportunities-scan-card"
        style={cardStyle}
      >
        <h3 style={sectionTitleStyle}>Scan Parameters</h3>

        <div style={{ display: "flex", flexWrap: "wrap", gap: t.spacing(3) }}>
          <div style={{ minWidth: 220, flex: "1 1 100%" }}>
            <div
              style={{
                fontSize: "0.85rem",
                fontWeight: 700,
                color: t.colors.secondary,
                marginBottom: t.spacing(1.5),
              }}
            >
              Option Type
            </div>
            <div style={{ display: "flex", gap: t.spacing(2) }}>
              <button
                type="button"
                onClick={() => setOptionType("puts")}
                style={{
                  padding: `${t.spacing(2)} ${t.spacing(3)}`,
                  borderRadius: t.radius.md,
                  border: `1px solid ${optionType === "puts" ? t.colors.primary : t.colors.border}`,
                  backgroundColor: optionType === "puts" ? "rgba(68,193,193,0.12)" : t.colors.surface,
                  color: optionType === "puts" ? t.colors.primary : t.colors.text,
                  fontWeight: 800,
                  cursor: "pointer",
                  flex: 1,
                }}
                aria-pressed={optionType === "puts"}
              >
                Puts
              </button>
              <button
                type="button"
                onClick={() => setOptionType("calls")}
                style={{
                  padding: `${t.spacing(2)} ${t.spacing(3)}`,
                  borderRadius: t.radius.md,
                  border: `1px solid ${optionType === "calls" ? t.colors.primary : t.colors.border}`,
                  backgroundColor: optionType === "calls" ? "rgba(68,193,193,0.12)" : t.colors.surface,
                  color: optionType === "calls" ? t.colors.primary : t.colors.text,
                  fontWeight: 800,
                  cursor: "pointer",
                  flex: 1,
                }}
                aria-pressed={optionType === "calls"}
              >
                Calls
              </button>
            </div>
          </div>

          <div style={{ minWidth: 260, flex: 1 }}>
            <div
              style={{
                fontSize: "0.85rem",
                fontWeight: 700,
                color: t.colors.secondary,
                marginBottom: t.spacing(1.5),
              }}
            >
              Target Expiration
            </div>
            <div style={{ display: "flex", alignItems: "flex-start", gap: t.spacing(3) }}>
              <div style={{ flex: 1, minWidth: 200 }}>
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

                {monthlyOnly && (
                  <div style={{ marginTop: t.spacing(1), fontSize: "0.85rem", color: t.colors.textMuted }}>
                    Showing all expirations up to 18 months out
                  </div>
                )}
              </div>

              <div style={{ minWidth: 260 }}>
                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: t.spacing(2),
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={monthlyOnly}
                    onChange={(e) => setMonthlyOnly(e.target.checked)}
                  />
                  <HelpTooltip
                    theme={t}
                    text="Monthly options only (3rd Friday expirations). When enabled, the expiry dropdown limits to monthly expirations."
                  >
                    <span
                      style={{ fontSize: "0.9rem", fontWeight: 700, color: t.colors.textMuted, display: "inline-flex", alignItems: "center" }}
                    >
                      Monthly
                    </span>
                  </HelpTooltip>
                </label>
              </div>
            </div>
          </div>

          <div style={{ minWidth: 260, flex: 1 }}>
            <div
              style={{
                fontSize: "0.85rem",
                fontWeight: 700,
                color: t.colors.secondary,
                marginBottom: t.spacing(1.5),
              }}
            >
              Minimum Market Cap
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: t.spacing(1) }}>
              <span style={{ fontWeight: 800, color: t.colors.primary }}>$</span>
              <input
                type="text"
                inputMode="numeric"
                value={minMarketCapText}
                onChange={(e) => {
                  const digits = e.target.value.replace(/[^0-9]/g, "");
                  setMinMarketCap(digits.length ? Number(digits) : 0);
                }}
                style={{ ...inputStyle, paddingLeft: t.spacing(3), paddingRight: t.spacing(3) }}
                aria-label="Minimum market cap"
              />
            </div>
          </div>

          <div style={{ minWidth: 200, flex: 1 }}>
            <div
              style={{
                fontSize: "0.85rem",
                fontWeight: 700,
                color: t.colors.secondary,
                marginBottom: t.spacing(1.5),
              }}
            >
              <HelpTooltip
                theme={t}
                text="After filtering by market cap, we only request option chains for this many symbols (highest market cap first). Lower = faster and gentler on Schwab rate limits; higher = wider scan but may time out or hit 429."
              >
                <span style={{ cursor: "help", borderBottom: `1px dotted ${t.colors.textMuted}` }}>
                  Max symbols to scan
                </span>
              </HelpTooltip>
            </div>
            <input
              type="number"
              min={10}
              max={150}
              step={5}
              value={maxUnderlyingsToScan}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (!Number.isFinite(n)) return;
                setMaxUnderlyingsToScan(Math.min(150, Math.max(10, Math.round(n))));
              }}
              style={{ ...inputStyle, maxWidth: 120 }}
              aria-label="Max symbols to scan"
            />
            <div style={{ marginTop: t.spacing(1), fontSize: "0.8rem", color: t.colors.textMuted }}>
              10–150 (default 50)
            </div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: t.spacing(3), marginTop: t.spacing(4) }}>
          <button
            type="button"
            style={primaryBtn}
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
          {scanError && (
            <div
              role="alert"
              style={{
                color: t.colors.danger,
                fontWeight: 700,
                fontSize: "0.9rem",
              }}
            >
              {scanError}
            </div>
          )}
        </div>

        {warnings.length > 0 && (
          <div style={{ marginTop: t.spacing(3), color: t.colors.textMuted, fontSize: "0.85rem", lineHeight: 1.5 }}>
            {warnings.map((w, idx) => (
              <div key={idx}>• {w}</div>
            ))}
          </div>
        )}
      </div>

      {OTM_LEVELS.map((otmPct) => {
        const arr = resultsByOtmPct[otmPct] ?? [];
        return (
          <div key={otmPct} className="page-card options-opportunities-card" style={cardStyle}>
            <h3 style={sectionTitleStyle}>{otmLabels[otmPct].headline}</h3>
            <div
              style={{
                marginTop: -t.spacing(2),
                marginBottom: t.spacing(3),
                color: t.colors.textMuted,
                fontSize: "0.85rem",
              }}
            >
              {otmLabels[otmPct].detail}
            </div>

            <div style={tableWrapStyle}>
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th
                      style={{
                        ...thStyle,
                        borderTopLeftRadius: t.radius.md,
                      }}
                    >
                      Rank
                    </th>
                    <th style={thStyle}>Ticker</th>
                    <th style={thStyle}>Company</th>
                    <th style={thNumStyle}>1M Perf</th>
                    <th style={thNumStyle}>Strike</th>
                    <th style={thNumStyle}>Bid</th>
                    <th style={thNumStyle}>Ann. Yield</th>
                    <th style={thNumStyle}>Premium (1 contract)</th>
                    <th
                      style={{
                        ...thStyle,
                        borderTopRightRadius: t.radius.md,
                      }}
                    >
                      Action
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {arr.length === 0 ? (
                    <tr>
                      <td colSpan={9} style={{ ...tdStyle, color: t.colors.textMuted }}>
                        No results yet
                      </td>
                    </tr>
                  ) : (
                    arr.map((r) => {
                      const copyKey = `${otmPct}-${r.ticker}-${r.strike}`;
                      return (
                      <tr key={`${r.ticker}-${r.strike}-${r.otmPct}`}>
                        <td
                          style={{
                            ...tdStyle,
                            textAlign: "left",
                            fontWeight: 600,
                            color:
                              r.rank === 1
                                ? "#D4AF37"
                                : r.rank === 2
                                  ? "#C0C0C0"
                                  : r.rank === 3
                                    ? "#CD7F32"
                                    : t.colors.text,
                          }}
                        >
                          #{r.rank}
                        </td>
                        <td style={{ ...tdStyle, fontWeight: 600 }}>{r.ticker}</td>
                        <td style={tdStyle}>{r.company}</td>
                        <td style={tdNumStyle}>{formatPct(r.oneMonthPerfPct)}</td>
                        <td style={tdNumStyle}>{r.strike.toFixed(2)}</td>
                        <td style={tdNumStyle}>${r.bid.toFixed(2)}</td>
                        <td
                          style={{
                            ...tdNumStyle,
                            color: r.annYieldPct >= 0 ? t.colors.success : t.colors.danger,
                            fontWeight: 600,
                          }}
                        >
                          {r.annYieldPct.toFixed(2)}%
                        </td>
                        <td style={tdNumStyle}>{formatMoney(r.premiumPerContract)}</td>
                        <td style={{ ...tdStyle, textAlign: "center" }}>
                          <div
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              justifyContent: "center",
                            }}
                          >
                            <button
                              type="button"
                              onClick={() => {
                                void navigator.clipboard.writeText(r.schwabSymbol);
                                setLastCopiedOpportunityKey(copyKey);
                                window.setTimeout(
                                  () =>
                                    setLastCopiedOpportunityKey((prev) =>
                                      prev === copyKey ? null : prev
                                    ),
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
                                style={{
                                  fontSize: 22,
                                  position: "absolute",
                                  opacity: lastCopiedOpportunityKey === copyKey ? 0 : 1,
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
                                  opacity: lastCopiedOpportunityKey === copyKey ? 1 : 0,
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
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </section>
  );
}

