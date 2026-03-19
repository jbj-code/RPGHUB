import { useCallback, useState, type ReactNode } from "react";
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

type OptionsRollProps = { theme: Theme };

type RollObjective = "balanced" | "cashflow" | "yield";

type OptionSide =
  | "PUT - SELL to OPEN"
  | "PUT - BUY to OPEN"
  | "PUT - SELL to CLOSE"
  | "PUT - BUY to CLOSE"
  | "CALL - SELL to OPEN"
  | "CALL - BUY to OPEN"
  | "CALL - SELL to CLOSE"
  | "CALL - BUY to CLOSE";

type OptionsTrade = {
  id: string;
  ticker: string;
  maturity: string;
  daysToMaturity: number;
  strikePrice: number;
  currentPrice: number;
  optionSide: OptionSide;
};

type RankedResult = {
  rank: number;
  ticker: string;
  upsidePct: number;
  strike: number;
  limitPrice: number;
  annYield: number;
  premiumPerContract: number;
  btcAsk?: number | null;
  netRollPerContract?: number | null;
  netRollTotal?: number | null;
  trade: OptionsTrade;
};

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

  const update = useCallback(<K extends keyof RollInput>(k: K, v: RollInput[K]) => {
    setInput((prev) => ({ ...prev, [k]: v }));
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
      setResults(Array.isArray(data.results) ? data.results : []);
      setMessage(data?.message ?? null);
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

  return (
    <section className="options-roll-page" style={pageStyle}>
      <h2 style={{ ...titleStyle, marginTop: PAGE_LAYOUT.titleBlockMarginTop, display: "flex", alignItems: "center", gap: t.spacing(2) }}>
        <span className="material-symbols-outlined" style={{ fontSize: "1.5rem", color: t.colors.secondary, lineHeight: 1 }} aria-hidden>
          auto_mode
        </span>
        Options Roll
      </h2>
      <p style={descStyle}>
        Enter your current expiring leg, set candidate search parameters, then analyze roll. Results use midpoint × 92% pricing and Schwab live data.
      </p>

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
          <button type="button" onClick={run} style={primaryBtn} disabled={loading}>
            {loading ? "Fetching..." : "Analyze roll"}
          </button>
        </div>
        {message && <p style={{ marginTop: t.spacing(2), color: t.colors.danger, fontWeight: 600 }}>{message}</p>}
      </div>

      {results && results.length > 0 && (
        <div className="options-roll-card" style={cardStyle}>
          <h3 style={{ fontSize: "0.75rem", color: t.colors.secondary, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: t.spacing(2) }}>Ranked roll candidates</h3>
          <div style={{ overflowX: "auto", border: `1px solid ${t.colors.border}`, borderRadius: t.radius.md }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}>
              <thead>
                <tr style={{ background: t.colors.secondary }}>
                  {["Rank", "Ticker", "Maturity", "Strike", "Limit Px", "BTC Px", "Net / sh", "Net Total", "Ann. Yield", "1M Upside %"].map((h) => (
                    <th key={h} style={{ padding: t.spacing(2), textAlign: h === "Ticker" || h === "Maturity" ? "left" : "right", color: "#fff", fontWeight: 700 }}>
                      {h === "Ann. Yield" ? (
                        <HelpTooltip theme={t} text="Annualized from yield at current underlying price: (modeled premium/current price) × (365/DTE).">
                          <span style={{ cursor: "help" }}>{h}</span>
                        </HelpTooltip>
                      ) : h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {results.map((r) => (
                  <tr key={r.trade.id} style={{ borderBottom: `1px solid ${t.colors.border}` }}>
                    <td style={{ padding: t.spacing(2), fontWeight: 700 }}>{r.rank}</td>
                    <td style={{ padding: t.spacing(2), fontWeight: 700 }}>{r.ticker}</td>
                    <td style={{ padding: t.spacing(2) }}>{r.trade.maturity}</td>
                    <td style={{ padding: t.spacing(2), textAlign: "right" }}>${r.strike.toFixed(2)}</td>
                    <td style={{ padding: t.spacing(2), textAlign: "right" }}>${r.limitPrice.toFixed(2)}</td>
                    <td style={{ padding: t.spacing(2), textAlign: "right" }}>{r.btcAsk != null ? `$${r.btcAsk.toFixed(2)}` : "—"}</td>
                    <td style={{ padding: t.spacing(2), textAlign: "right", color: (r.netRollPerContract ?? 0) >= 0 ? t.colors.success : t.colors.danger, fontWeight: 700 }}>{r.netRollPerContract != null ? formatMoney(r.netRollPerContract) : "—"}</td>
                    <td style={{ padding: t.spacing(2), textAlign: "right", color: (r.netRollTotal ?? 0) >= 0 ? t.colors.success : t.colors.danger, fontWeight: 700 }}>{r.netRollTotal != null ? formatMoney(r.netRollTotal) : "—"}</td>
                    <td style={{ padding: t.spacing(2), textAlign: "right", color: t.colors.success, fontWeight: 700 }}>{r.annYield.toFixed(2)}%</td>
                    <td style={{ padding: t.spacing(2), textAlign: "right", color: r.upsidePct >= 0 ? t.colors.success : t.colors.danger }}>{r.upsidePct >= 0 ? "+" : ""}{r.upsidePct}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}

