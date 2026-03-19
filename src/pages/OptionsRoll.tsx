import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { Theme } from "../theme";
import {
  PAGE_LAYOUT,
  getDropdownOptionStyle,
  getDropdownPanelStyle,
  getDropdownTriggerStyle,
  getPrimaryActionButtonStyle,
  getTooltipBubbleStyle,
  THEME_DROPDOWN_OPTION_CLASS,
} from "../theme";
import type { RankedResult } from "./OptionsOptimizer";
import { formatRankedRowForCopy } from "./OptionsOptimizer";

type OptionsRollProps = { theme: Theme };

type RollObjective = "balanced" | "cashflow" | "yield";

function daysBetweenUTC(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000));
}

type RollInput = {
  ticker: string;
  putCall: "Put" | "Call";
  type: "Qty" | "Notional";
  value: number;
  days: number;
  moneyness: "OTM" | "ITM";
  otmPct: number;
  monthly: boolean;
  currentExpiry: string;
  currentStrike: number;
  currentContracts: number;
};

const SCHWAB_API_BASE =
  (import.meta.env.VITE_SCHWAB_API_BASE as string) || "https://therpghub.vercel.app";

const defaultInput: RollInput = {
  ticker: "",
  putCall: "Put",
  type: "Qty",
  value: 0,
  days: 60,
  moneyness: "OTM",
  otmPct: 10,
  monthly: true,
  currentExpiry: "",
  currentStrike: 0,
  currentContracts: 0,
};

function formatMoney(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "−" : "";
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(2)}`;
}

/** Consistent leg line for roll metrics: "Put - Buy to Close" / "Put - Sell to Open". */
function formatRollLegLabel(putCall: "Put" | "Call", action: "buyToClose" | "sellToOpen"): string {
  const p = putCall === "Put" ? "Put" : "Call";
  return action === "buyToClose" ? `${p} - Buy to Close` : `${p} - Sell to Open`;
}

function HelpTooltip({ theme: t, text, children }: { theme: Theme; text: string; children: ReactNode }) {
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

function ThemeSelect({
  theme: t,
  value,
  options,
  onChange,
}: {
  theme: Theme;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const display = options.find((o) => o.value === value)?.label ?? value;
  return (
    <div style={{ position: "relative", minWidth: 120 }}>
      <button type="button" style={getDropdownTriggerStyle(t)} onClick={() => setOpen((o) => !o)}>
        <span>{display}</span>
        <span className="material-symbols-outlined" style={{ fontSize: 18, opacity: 0.8 }} aria-hidden>
          expand_more
        </span>
      </button>
      {open && (
        <>
          <button
            type="button"
            aria-label="Close dropdown"
            onClick={() => setOpen(false)}
            style={{ position: "fixed", inset: 0, background: "transparent", border: "none", zIndex: 3999 }}
          />
          <div style={{ ...getDropdownPanelStyle(t, "down"), minWidth: 140 }}>
            {options.map((o) => (
              <button
                key={o.value}
                type="button"
                className={THEME_DROPDOWN_OPTION_CLASS}
                onClick={() => {
                  onChange(o.value);
                  setOpen(false);
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

export function OptionsRoll({ theme: t }: OptionsRollProps) {
  const [input, setInput] = useState<RollInput>(defaultInput);
  const [results, setResults] = useState<RankedResult[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [variance, setVariance] = useState(5);
  const [creditOnly, setCreditOnly] = useState(false);
  const [objective, setObjective] = useState<RollObjective>("balanced");
  const [showRollInfoModal, setShowRollInfoModal] = useState(false);
  const [lastSelectedRollRowId, setLastSelectedRollRowId] = useState<string | null>(null);
  const [lastCopiedTradeId, setLastCopiedTradeId] = useState<string | null>(null);
  /** Candidate row shown in Roll metrics (set when you use + on a ranked row). */
  const [selectedRollResult, setSelectedRollResult] = useState<RankedResult | null>(null);
  const rollMetricsCardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showRollInfoModal) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowRollInfoModal(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [showRollInfoModal]);

  const update = useCallback(<K extends keyof RollInput>(k: K, v: RollInput[K]) => {
    setInput((prev) => ({ ...prev, [k]: v }));
  }, []);

  const selectCandidateForRollMetrics = useCallback((result: RankedResult) => {
    setSelectedRollResult(result);
    setLastSelectedRollRowId(result.trade.id);
    window.setTimeout(() => {
      setLastSelectedRollRowId((prev) => (prev === result.trade.id ? null : prev));
    }, 1200);
    // After paint so the Roll metrics card exists (first selection mounts it).
    window.setTimeout(() => {
      rollMetricsCardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 100);
  }, []);

  const run = useCallback(async () => {
    if (!input.ticker.trim()) {
      setMessage("Enter a ticker to run roll analysis.");
      setResults(null);
      return;
    }
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch(`${SCHWAB_API_BASE}/api/schwab-option-optimizer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          portfolioRows: [
            {
              id: "roll-row",
              ticker: input.ticker.toUpperCase().trim(),
              putCall: input.putCall,
              action: "Sell to Open",
              type: input.type,
              value: input.value,
              days: input.days,
              moneyness: input.moneyness,
              otmPct: input.otmPct,
              monthly: input.monthly,
              currentExpiry: input.currentExpiry,
              currentStrike: input.currentStrike,
              currentContracts: input.currentContracts,
            },
          ],
          otmVariancePct: variance,
          rollMode: true,
          rollCreditOnly: creditOnly,
          rollObjective: objective,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setResults(null);
        setMessage(data?.error ?? "Roll fetch failed.");
        return;
      }
      const list: RankedResult[] = Array.isArray(data.results) ? data.results : [];
      setResults(list);
      setMessage(data?.message ?? null);
      setSelectedRollResult(null);
    } catch {
      setResults(null);
      setMessage("Network error. Try again.");
    } finally {
      setLoading(false);
    }
  }, [creditOnly, input, objective, variance]);

  const primaryBtn = getPrimaryActionButtonStyle(t);
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
    marginBottom: t.spacing(2),
  };
  const labelStyle: React.CSSProperties = {
    fontSize: "0.75rem",
    color: t.colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    marginBottom: t.spacing(0.5),
  };
  /** Match Options Optimizer text/number fields (dropdowns use ThemeSelect). */
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
    boxSizing: "border-box",
  };
  const valueStyle: React.CSSProperties = {
    fontSize: "0.95rem",
    fontWeight: 500,
    color: t.colors.text,
  };
  return (
    <section className="options-roll-page" style={pageStyle}>
      <div
        className="options-roll-header-row"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginTop: PAGE_LAYOUT.titleBlockMarginTop,
          marginBottom: t.spacing(PAGE_LAYOUT.titleMarginBottom),
        }}
      >
        <h2 style={{ ...titleStyle, margin: 0, lineHeight: 1.3 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: t.spacing(2) }}>
            <span className="material-symbols-outlined" style={{ fontSize: "1.5rem", color: t.colors.secondary, lineHeight: 1 }} aria-hidden>
              auto_mode
            </span>
            Options Roll
          </span>
        </h2>
        <button
          type="button"
          onClick={() => setShowRollInfoModal(true)}
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
          aria-label="How Options Roll works"
        >
          <span className="material-symbols-outlined options-roll-info-icon" style={{ fontSize: 26 }} aria-hidden>
            info
          </span>
        </button>
      </div>
      <p style={descStyle}>
        Enter your current expiring leg, set candidate search parameters, then analyze roll. Results use midpoint × 92% pricing and Schwab live data.
      </p>

      {showRollInfoModal && (
        <>
          <div
            role="presentation"
            style={{
              position: "fixed",
              inset: 0,
              backgroundColor: "rgba(0,0,0,0.4)",
              zIndex: 1000,
            }}
            onClick={() => setShowRollInfoModal(false)}
            onKeyDown={(e) => e.key === "Escape" && setShowRollInfoModal(false)}
          />
          <div
            role="dialog"
            aria-labelledby="options-roll-info-title"
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
              maxWidth: 520,
              width: "90%",
              maxHeight: "85vh",
              overflowY: "auto",
              boxShadow: "0 12px 40px rgba(15, 42, 54, 0.2)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: t.spacing(3) }}>
              <h3 id="options-roll-info-title" style={{ ...sectionTitleStyle, marginBottom: 0, color: t.colors.secondary, fontSize: "0.85rem" }}>
                How Options Roll works
              </h3>
              <button
                type="button"
                onClick={() => setShowRollInfoModal(false)}
                style={{
                  padding: t.spacing(0.5),
                  border: "none",
                  background: "none",
                  color: t.colors.textMuted,
                  cursor: "pointer",
                }}
                aria-label="Close"
              >
                <span className="material-symbols-outlined" style={{ fontSize: 22 }}>
                  close
                </span>
              </button>
            </div>
            <ul style={{ margin: 0, paddingLeft: t.spacing(5), color: t.colors.text, fontSize: "0.9rem", lineHeight: 1.7 }}>
              <li>
                <strong>Two legs:</strong> A roll closes an existing position and opens a new one. This page assumes your <strong>current leg</strong> is the one at{" "}
                <strong>Current expiry</strong> and <strong>Current strike</strong> — we price closing it as a <strong>buy to close</strong> (shown as <strong>BTC Px</strong>).
              </li>
              <li>
                <strong>Candidate rows</strong> in the table are <strong>sell to open</strong> replacement options (same put/call you selected) that match your DTE, OTM/ITM, and variance settings.
              </li>
              <li>
                <strong>Limit Px</strong> on each row is the desk model: <strong>(bid + ask) ÷ 2 × 92%</strong>. <strong>BTC Px</strong> uses the same model for your current leg.
              </li>
              <li>
                <strong>Net / sh</strong> is net cash per contract in dollars: modeled STO premium minus modeled BTC cost (positive = net credit roll, negative = net debit).{" "}
                <strong>Net Total</strong> scales by <strong>Contracts</strong> (or falls back to sizing from Qty/Notional if contracts is 0).
              </li>
              <li>
                <strong>Ann. Yield</strong> is annualized from the <em>candidate</em> leg: yield vs <strong>current underlying price</strong>, then scaled by days to that candidate&apos;s expiry.
              </li>
              <li>
                <strong>Objective:</strong> <em>Cash Flow</em> ranks by net roll per contract; <em>Yield</em> by net-roll annualized % (new-leg horizon); <em>Balanced</em> blends both. <strong>Credit only</strong> hides debit rolls.
              </li>
              <li>
                <strong>Roll metrics</strong> (after you tap <strong>+</strong> on a row): compares current vs new leg. <strong>Net roll / day extended</strong> is net roll per contract divided by (new DTE − current DTE)—a steadier read than annualizing when your closing leg is almost expired.
              </li>
              <li>
                <strong>Monthly</strong> limits candidates to standard <strong>3rd-Friday</strong> expirations when checked.
              </li>
              <li>
                <strong>Data:</strong> Live Schwab quotes; off-hours or wide spreads can make modeled prices differ from what you see in Advisor Center at a snapshot in time.
              </li>
            </ul>
          </div>
        </>
      )}

      <div className="options-roll-card" style={cardStyle}>
        <h3 style={sectionTitleStyle}>Roll configuration</h3>
        <p style={{ fontSize: "0.875rem", color: t.colors.textMuted, marginBottom: t.spacing(3) }}>
          Set variance and how to rank candidates. Your main roll parameters (ticker, current leg, replacement targets) are in the panel below.
        </p>
        <div style={{ display: "flex", alignItems: "center", gap: t.spacing(2), flexWrap: "wrap", marginBottom: t.spacing(3) }}>
          <HelpTooltip
            theme={t}
            text="How wide a strike range to consider around your target OTM/ITM %. For example 5% with 10% target = 5–15% strikes."
          >
            <label style={{ ...labelStyle, marginBottom: 0, cursor: "help" }}>Variance % (strike range)</label>
          </HelpTooltip>
          <input
            type="number"
            min={0}
            max={50}
            step={1}
            value={variance}
            onChange={(e) => setVariance(Number(e.target.value) || 0)}
            style={{ ...inputStyle, maxWidth: 64 }}
            aria-label="Variance percent"
          />
          <span style={{ fontSize: "0.8rem", color: t.colors.textMuted }}>e.g. 5% with 10% target = 5–15% strikes</span>
          <label style={{ display: "inline-flex", alignItems: "center", gap: t.spacing(1.5), marginLeft: t.spacing(1), cursor: "pointer" }}>
            <input type="checkbox" checked={creditOnly} onChange={(e) => setCreditOnly(e.target.checked)} />
            <span style={{ fontSize: "0.85rem", color: t.colors.text, fontWeight: 600 }}>Credit only</span>
          </label>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: t.spacing(0.5) }}>
            <label style={labelStyle}>Objective</label>
            <ThemeSelect
              theme={t}
              value={objective}
              options={[
                { value: "balanced", label: "Balanced" },
                { value: "cashflow", label: "Cash Flow" },
                { value: "yield", label: "Yield" },
              ]}
              onChange={(v) => setObjective(v as RollObjective)}
            />
          </div>
        </div>

        <div
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
              style={{ ...inputStyle, maxWidth: 100 }}
              placeholder="e.g. XME"
              value={input.ticker}
              onChange={(e) => update("ticker", e.target.value)}
            />
          </div>
          <div>
            <div style={labelStyle}>Put / Call</div>
            <ThemeSelect theme={t} value={input.putCall} options={[{ value: "Put", label: "Put" }, { value: "Call", label: "Call" }]} onChange={(v) => update("putCall", v as "Put" | "Call")} />
          </div>
          <div>
            <div style={labelStyle}>Type</div>
            <ThemeSelect theme={t} value={input.type} options={[{ value: "Qty", label: "Qty" }, { value: "Notional", label: "Notional" }]} onChange={(v) => update("type", v as "Qty" | "Notional")} />
          </div>
          <div>
            <div style={labelStyle}>Value</div>
            {input.type === "Notional" ? (
              <input
                style={{ ...inputStyle, maxWidth: 130 }}
                value={input.value > 0 ? Math.round(input.value).toLocaleString("en-US") : ""}
                onChange={(e) => update("value", Number(e.target.value.replace(/[^\d]/g, "")) || 0)}
              />
            ) : (
              <input type="number" min={0} style={{ ...inputStyle, maxWidth: 110 }} value={input.value || ""} onChange={(e) => update("value", Number(e.target.value) || 0)} />
            )}
          </div>
          <div>
            <div style={labelStyle}>Days (DTE)</div>
            <input type="number" min={1} style={{ ...inputStyle, maxWidth: 90 }} value={input.days || ""} onChange={(e) => update("days", Number(e.target.value) || 0)} />
          </div>
          <div>
            <div style={labelStyle}>OTM / ITM</div>
            <ThemeSelect theme={t} value={input.moneyness} options={[{ value: "OTM", label: "OTM" }, { value: "ITM", label: "ITM" }]} onChange={(v) => update("moneyness", v as "OTM" | "ITM")} />
          </div>
          <div>
            <div style={labelStyle}>OTM %</div>
            <input type="number" min={0} max={100} style={{ ...inputStyle, maxWidth: 90 }} value={input.otmPct || ""} onChange={(e) => update("otmPct", Number(e.target.value) || 0)} />
          </div>
          <label style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: t.spacing(0.5), marginBottom: t.spacing(0.5), cursor: "pointer" }}>
            <span style={labelStyle}>Monthly</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: t.spacing(1) }}>
              <input type="checkbox" checked={input.monthly} onChange={(e) => update("monthly", e.target.checked)} />
              <span style={{ fontSize: "0.85rem", color: t.colors.text }}>3rd Fri expirations only</span>
            </span>
          </label>
          <div>
            <div style={labelStyle}>Current Expiry</div>
            <input type="date" style={{ ...inputStyle, maxWidth: 150 }} value={input.currentExpiry} onChange={(e) => update("currentExpiry", e.target.value)} />
          </div>
          <div>
            <div style={labelStyle}>Current Strike</div>
            <input type="number" min={0} step={0.5} style={{ ...inputStyle, maxWidth: 110 }} value={input.currentStrike || ""} onChange={(e) => update("currentStrike", Number(e.target.value) || 0)} />
          </div>
          <div>
            <div style={labelStyle}>Contracts</div>
            <input type="number" min={0} style={{ ...inputStyle, maxWidth: 100 }} value={input.currentContracts || ""} onChange={(e) => update("currentContracts", Number(e.target.value) || 0)} />
          </div>
        </div>

        <div style={{ marginTop: t.spacing(3) }}>
          <button
            type="button"
            onClick={run}
            style={{
              ...primaryBtn,
              display: "inline-flex",
              alignItems: "center",
              gap: t.spacing(2),
            }}
            disabled={loading}
          >
            {loading ? (
              <>
                <span className="options-pricing-fetch-spinner" aria-hidden />
                Fetching…
              </>
            ) : (
              "Analyze roll"
            )}
          </button>
        </div>
        {message && (!results || results.length === 0) && (
          <p style={{ marginTop: t.spacing(2), color: t.colors.danger, fontWeight: 600 }}>{message}</p>
        )}
      </div>

      {results && (
        <div
          className="options-roll-card"
          style={{
            ...cardStyle,
            position: "relative",
            zIndex: 1,
          }}
        >
          <h3 style={sectionTitleStyle}>Ranked roll candidates</h3>
          <p style={{ fontSize: "0.875rem", color: t.colors.textMuted, marginBottom: t.spacing(2) }}>
            Best roll candidates ranked by your objective. Use <strong>+</strong> on a row to compare it in <strong>Roll metrics</strong> below.
          </p>
          {results.length > 0 && (
            <p style={{ fontSize: "0.85rem", color: t.colors.text, marginBottom: t.spacing(3) }}>
              <strong>Top yield:</strong> {Math.max(...results.map((r) => r.annYield)).toFixed(1)}%
              {" · "}
              <strong>Avg yield:</strong> {(results.reduce((s, r) => s + r.annYield, 0) / results.length).toFixed(1)}%
            </p>
          )}
          {results.length > 0 && message && (
            <p
              role="status"
              style={{
                fontSize: "0.875rem",
                color: t.colors.danger,
                marginBottom: t.spacing(3),
                fontWeight: 600,
                padding: t.spacing(2),
                borderRadius: t.radius.md,
                border: `1px solid ${t.colors.border}`,
                backgroundColor: t.colors.background,
              }}
            >
              {message}
            </p>
          )}
          {results.length === 0 && (
            <p style={{ fontSize: "0.9rem", color: t.colors.danger, marginBottom: t.spacing(3), fontWeight: 600 }}>
              {message ?? "No roll candidates matched your settings."}
            </p>
          )}
          {results.length > 0 && (
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
                    <th style={{ textAlign: "center", padding: t.spacing(2), color: "#FFFFFF", fontWeight: 600 }}>
                      <HelpTooltip
                        theme={t}
                        text="1M Upside % is the underlying ticker's trailing 1-month price performance from Schwab price history. It is used as a directional context signal in ranking."
                      >
                        <span style={{ cursor: "help" }}>1M Upside %</span>
                      </HelpTooltip>
                    </th>
                    <th style={{ textAlign: "right", padding: t.spacing(2), color: "#FFFFFF", fontWeight: 600 }}>Strike</th>
                    <th style={{ textAlign: "right", padding: t.spacing(2), color: "#FFFFFF", fontWeight: 600 }}>
                      <HelpTooltip
                        theme={t}
                        text="Limit Px uses the desk model: midpoint × 92%, where midpoint = (bid + ask) / 2. This modeled execution price drives premium and yield calculations."
                      >
                        <span style={{ cursor: "help" }}>Limit Px</span>
                      </HelpTooltip>
                    </th>
                    <th style={{ textAlign: "right", padding: t.spacing(2), color: "#FFFFFF", fontWeight: 600 }}>BTC Px</th>
                    <th style={{ textAlign: "right", padding: t.spacing(2), color: "#FFFFFF", fontWeight: 600 }}>
                      <HelpTooltip
                        theme={t}
                        text="Ann. Yield is annualized from yield at current underlying price (not strike): (modeled premium / current underlying value) × (365 / days to maturity)."
                      >
                        <span style={{ cursor: "help" }}>Ann. Yield</span>
                      </HelpTooltip>
                    </th>
                    <th style={{ textAlign: "right", padding: t.spacing(2), color: "#FFFFFF", fontWeight: 600 }}>Net Roll / c</th>
                    <th style={{ textAlign: "right", padding: t.spacing(2), color: "#FFFFFF", fontWeight: 600 }}>Net Roll Total</th>
                    <th style={{ textAlign: "center", padding: t.spacing(2), color: "#FFFFFF", fontWeight: 600 }}>Premium / contract</th>
                    <th style={{ textAlign: "center", padding: t.spacing(2), color: "#FFFFFF", fontWeight: 600, borderTopRightRadius: t.radius.md }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((r) => (
                    <tr key={r.trade.id} style={{ borderBottom: `1px solid ${t.colors.border}` }}>
                      <td
                        style={{
                          padding: t.spacing(2),
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
                      <td style={{ padding: t.spacing(2), fontWeight: 600, color: t.colors.text }}>{r.ticker}</td>
                      <td style={{ padding: t.spacing(2), fontSize: "0.8rem", color: t.colors.text }}>{r.trade.maturity}</td>
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
                        {r.upsidePct >= 0 ? "+" : ""}
                        {r.upsidePct}%
                      </td>
                      <td style={{ padding: t.spacing(2), textAlign: "right" }}>${r.strike.toFixed(2)}</td>
                      <td style={{ padding: t.spacing(2), textAlign: "right" }}>${r.limitPrice.toFixed(2)}</td>
                      <td style={{ padding: t.spacing(2), textAlign: "right" }}>{r.btcAsk != null ? `$${r.btcAsk.toFixed(2)}` : "—"}</td>
                      <td style={{ padding: t.spacing(2), textAlign: "right", color: t.colors.success, fontWeight: 600 }}>{r.annYield}%</td>
                      <td
                        style={{
                          padding: t.spacing(2),
                          textAlign: "right",
                          color: (r.netRollPerContract ?? 0) >= 0 ? t.colors.success : t.colors.danger,
                          fontWeight: 600,
                        }}
                      >
                        {r.netRollPerContract != null ? formatMoney(r.netRollPerContract) : "—"}
                      </td>
                      <td
                        style={{
                          padding: t.spacing(2),
                          textAlign: "right",
                          color: (r.netRollTotal ?? 0) >= 0 ? t.colors.success : t.colors.danger,
                          fontWeight: 600,
                        }}
                        title={r.rollContractsUsed != null ? `${r.rollContractsUsed} contracts` : undefined}
                      >
                        {r.netRollTotal != null ? formatMoney(r.netRollTotal) : "—"}
                      </td>
                      <td
                        style={{
                          padding: t.spacing(2),
                          textAlign: "center",
                          color: r.premiumPerContract >= 0 ? t.colors.success : t.colors.danger,
                          fontWeight: 600,
                        }}
                      >
                        {formatMoney(r.premiumPerContract)}
                      </td>
                      <td style={{ padding: t.spacing(2), textAlign: "center" }}>
                        <div style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: t.spacing(3) }}>
                          <button
                            type="button"
                            onClick={() => selectCandidateForRollMetrics(r)}
                            title="Compare in Roll metrics"
                            aria-label="Select candidate for Roll metrics"
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
                              position: "relative",
                            }}
                          >
                            <span
                              className="material-symbols-outlined"
                              style={{
                                fontSize: 24,
                                position: "absolute",
                                opacity: lastSelectedRollRowId === r.trade.id ? 0 : 1,
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
                                opacity: lastSelectedRollRowId === r.trade.id ? 1 : 0,
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
                              void navigator.clipboard.writeText(formatRankedRowForCopy(r, true));
                              setLastCopiedTradeId(r.trade.id);
                              window.setTimeout(
                                () => setLastCopiedTradeId((prev) => (prev === r.trade.id ? null : prev)),
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

      {/* Roll metrics: current leg vs selected candidate */}
      {selectedRollResult && results && results.length > 0 && (
        <div
          ref={rollMetricsCardRef}
          className="options-roll-card"
          style={{
            ...cardStyle,
            position: "relative",
            zIndex: 1,
            scrollMarginTop: "5.5rem",
          }}
        >
          <h3 style={sectionTitleStyle}>Roll metrics</h3>
          <p style={{ fontSize: "0.875rem", color: t.colors.textMuted, marginBottom: t.spacing(3) }}>
            Comparison for the candidate you selected with <strong>+</strong> in the table (vs. your <strong>Current expiry</strong> and <strong>Current strike</strong> inputs). Pricing is modeled (midpoint × 92%).
          </p>
          {(() => {
            const r = selectedRollResult;
            const spot = r.trade.currentPrice;
            const btc = r.btcAsk;
            const sto = r.limitPrice;
            const today = new Date();
            today.setUTCHours(0, 0, 0, 0);
            const currentDte =
              input.currentExpiry && /^\d{4}-\d{2}-\d{2}$/.test(input.currentExpiry)
                ? Math.max(0, daysBetweenUTC(today, new Date(`${input.currentExpiry}T00:00:00.000Z`)))
                : null;
            const netPerShare = btc != null && Number.isFinite(sto) && Number.isFinite(btc) ? sto - btc : null;
            const yieldBtcPct = btc != null && spot > 0 ? (btc / spot) * 100 : null;
            const yieldStoPct = spot > 0 ? (sto / spot) * 100 : null;
            const annBtcPct =
              yieldBtcPct != null && currentDte != null && currentDte > 0 ? yieldBtcPct * (365 / currentDte) : null;
            const contractsUsed = r.rollContractsUsed ?? r.trade.contracts;
            const premBtc = btc != null ? -(btc * 100) : null;
            const premSto = sto * 100;
            const strikeDelta = input.currentStrike > 0 ? r.strike - input.currentStrike : null;
            const dteDelta = currentDte != null ? r.trade.daysToMaturity - currentDte : null;
            const netRollPerDayExtended =
              r.netRollPerContract != null && dteDelta != null && dteDelta > 0
                ? r.netRollPerContract / dteDelta
                : null;

            return (
              <div style={{ display: "flex", flexDirection: "column", gap: t.spacing(4) }}>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "row",
                    flexWrap: "wrap",
                    gap: t.spacing(3),
                    alignItems: "stretch",
                    justifyContent: "center",
                  }}
                >
                  <div
                    style={{
                      flex: "1 1 280px",
                      minWidth: 240,
                      padding: t.spacing(3),
                      backgroundColor: t.colors.background,
                      borderRadius: t.radius.md,
                      border: `1px solid ${t.colors.border}`,
                    }}
                  >
                    <div style={{ ...labelStyle, color: t.colors.secondary, marginBottom: t.spacing(2) }}>Current leg (close)</div>
                    <div style={{ fontSize: "0.85rem", color: t.colors.textMuted, marginBottom: t.spacing(2) }}>
                      {formatRollLegLabel(input.putCall, "buyToClose")}
                    </div>
                    <div style={{ display: "grid", gap: t.spacing(2), fontSize: "0.9rem" }}>
                      <div>
                        <span style={{ color: t.colors.textMuted }}>Expiry</span>{" "}
                        <strong>{input.currentExpiry || "—"}</strong>
                      </div>
                      <div>
                        <span style={{ color: t.colors.textMuted }}>Strike</span>{" "}
                        <strong>{input.currentStrike > 0 ? `$${input.currentStrike.toFixed(2)}` : "—"}</strong>
                      </div>
                      <div>
                        <span style={{ color: t.colors.textMuted }}>DTE</span>{" "}
                        <strong>{currentDte != null ? currentDte : "—"}</strong>
                      </div>
                      <div>
                        <span style={{ color: t.colors.textMuted }}>Limit px (BTC)</span>{" "}
                        <strong>{btc != null ? `$${btc.toFixed(2)}` : "—"}</strong>
                      </div>
                      <div>
                        <span style={{ color: t.colors.textMuted }}>Premium / contract</span>{" "}
                        <strong style={{ color: premBtc != null && premBtc < 0 ? t.colors.danger : t.colors.text }}>
                          {premBtc != null ? formatMoney(premBtc) : "—"}
                        </strong>
                      </div>
                      <div>
                        <span style={{ color: t.colors.textMuted }}>Yield @ spot</span>{" "}
                        <strong>{yieldBtcPct != null ? `${yieldBtcPct.toFixed(2)}%` : "—"}</strong>
                      </div>
                      <div>
                        <span style={{ color: t.colors.textMuted }}>Ann. yield</span>{" "}
                        <strong>{annBtcPct != null ? `${annBtcPct.toFixed(1)}%` : "—"}</strong>
                      </div>
                    </div>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flex: "0 0 auto",
                      alignSelf: "center",
                      padding: t.spacing(1),
                    }}
                    aria-hidden
                  >
                    <span
                      className="material-symbols-outlined"
                      style={{ fontSize: 40, color: t.colors.secondary, opacity: 0.85 }}
                    >
                      arrow_forward
                    </span>
                  </div>
                  <div
                    style={{
                      flex: "1 1 280px",
                      minWidth: 240,
                      padding: t.spacing(3),
                      backgroundColor: t.colors.background,
                      borderRadius: t.radius.md,
                      border: `1px solid ${t.colors.border}`,
                    }}
                  >
                    <div style={{ ...labelStyle, color: t.colors.secondary, marginBottom: t.spacing(2) }}>New leg (open)</div>
                    <div style={{ fontSize: "0.85rem", color: t.colors.textMuted, marginBottom: t.spacing(2) }}>
                      {formatRollLegLabel(input.putCall, "sellToOpen")}
                    </div>
                    <div style={{ display: "grid", gap: t.spacing(2), fontSize: "0.9rem" }}>
                      <div>
                        <span style={{ color: t.colors.textMuted }}>Expiry</span> <strong>{r.trade.maturity}</strong>
                      </div>
                      <div>
                        <span style={{ color: t.colors.textMuted }}>Strike</span> <strong>${r.strike.toFixed(2)}</strong>
                      </div>
                      <div>
                        <span style={{ color: t.colors.textMuted }}>DTE</span> <strong>{r.trade.daysToMaturity}</strong>
                      </div>
                      <div>
                        <span style={{ color: t.colors.textMuted }}>Limit px (STO)</span> <strong>${sto.toFixed(2)}</strong>
                      </div>
                      <div>
                        <span style={{ color: t.colors.textMuted }}>Premium / contract</span>{" "}
                        <strong style={{ color: t.colors.success }}>{formatMoney(premSto)}</strong>
                      </div>
                      <div>
                        <span style={{ color: t.colors.textMuted }}>Yield @ spot</span>{" "}
                        <strong>{yieldStoPct != null ? `${yieldStoPct.toFixed(2)}%` : "—"}</strong>
                      </div>
                      <div>
                        <span style={{ color: t.colors.textMuted }}>Ann. yield</span> <strong>{r.annYield.toFixed(2)}%</strong>
                      </div>
                    </div>
                  </div>
                </div>

                <div
                  style={{
                    padding: t.spacing(3),
                    backgroundColor: t.mode === "light" ? "rgba(68, 193, 193, 0.08)" : "rgba(68, 193, 193, 0.12)",
                    borderRadius: t.radius.md,
                    border: `1px solid ${t.colors.border}`,
                  }}
                >
                  <div style={{ ...labelStyle, marginBottom: t.spacing(2) }}>Roll economics (modeled)</div>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
                      gap: t.spacing(3),
                    }}
                  >
                    <div>
                      <div style={labelStyle}>Net $/share</div>
                      <div
                        style={{
                          ...valueStyle,
                          fontSize: "1.1rem",
                          fontWeight: 700,
                          color: netPerShare != null && netPerShare >= 0 ? t.colors.success : t.colors.danger,
                        }}
                      >
                        {netPerShare != null ? `${netPerShare >= 0 ? "+" : ""}$${netPerShare.toFixed(2)}/sh` : "—"}
                      </div>
                    </div>
                    <div>
                      <div style={labelStyle}>Net roll / contract</div>
                      <div
                        style={{
                          ...valueStyle,
                          fontSize: "1.1rem",
                          fontWeight: 700,
                          color: (r.netRollPerContract ?? 0) >= 0 ? t.colors.success : t.colors.danger,
                        }}
                      >
                        {r.netRollPerContract != null ? formatMoney(r.netRollPerContract) : "—"}
                      </div>
                    </div>
                    <div>
                      <div style={labelStyle}>Net roll total</div>
                      <div
                        style={{
                          ...valueStyle,
                          fontSize: "1.1rem",
                          fontWeight: 700,
                          color: (r.netRollTotal ?? 0) >= 0 ? t.colors.success : t.colors.danger,
                        }}
                      >
                        {r.netRollTotal != null ? formatMoney(r.netRollTotal) : "—"}
                      </div>
                    </div>
                    <div>
                      <div style={labelStyle}>Contracts (for total)</div>
                      <div style={valueStyle}>{contractsUsed}</div>
                    </div>
                    <div>
                      <div style={labelStyle}>Strike change</div>
                      <div style={valueStyle}>
                        {strikeDelta != null ? `${strikeDelta >= 0 ? "+" : ""}${strikeDelta.toFixed(2)}` : "—"}
                      </div>
                    </div>
                    <div>
                      <div style={labelStyle}>DTE extension</div>
                      <div style={valueStyle}>{dteDelta != null ? `${dteDelta >= 0 ? "+" : ""}${dteDelta} days` : "—"}</div>
                    </div>
                    <div>
                      <HelpTooltip
                        theme={t}
                        text="Net roll per contract divided by how many calendar days you extend (new DTE − current DTE). Unlike a single annualized %, this doesn’t depend on the closing leg having almost no time left."
                      >
                        <span
                          style={{
                            ...labelStyle,
                            display: "inline-block",
                            cursor: "help",
                            borderBottom: `1px dotted ${t.colors.textMuted}`,
                          }}
                        >
                          Net roll / day extended
                        </span>
                      </HelpTooltip>
                      <div
                        style={{
                          ...valueStyle,
                          fontSize: "1.1rem",
                          fontWeight: 700,
                          color:
                            netRollPerDayExtended != null
                              ? netRollPerDayExtended >= 0
                                ? t.colors.success
                                : t.colors.danger
                              : t.colors.text,
                        }}
                      >
                        {netRollPerDayExtended != null ? `${netRollPerDayExtended >= 0 ? "+" : ""}${formatMoney(netRollPerDayExtended)}/day` : "—"}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
      )}
    </section>
  );
}

