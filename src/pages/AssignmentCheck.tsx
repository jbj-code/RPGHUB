import { useMemo, useState } from "react";
import type { Theme } from "../theme";
import { PAGE_LAYOUT, getPrimaryActionButtonStyle } from "../theme";

type AssignmentCheckProps = { theme: Theme };

type OptionSide = "C" | "P";
type SourceMode = "manual" | "addepar";

type ParsedPosition = {
  id: string;
  family: string;
  account: string;
  underlying: string;
  expiry: string;
  strike: number;
  type: OptionSide;
  raw: string;
};

type OptionQuote = {
  symbol: string;
  underlyingPrice?: number;
};

const SCHWAB_API_BASE =
  (import.meta.env.VITE_SCHWAB_API_BASE as string) || "https://therpghub.vercel.app";

const SAMPLE_INPUT = `Client 1 family
UBP Account
Call DDOG @ $155.0 Exp Mar 20, 2026
Call IBIT @ $56.0 Exp Mar 20, 2026
Put QQQ @ $575.0 Exp Mar 20, 2026
Put SPY @ $635.0 Exp Mar 20, 2026`;

function parseNaturalOptionLine(line: string): {
  underlying: string;
  expiry: string;
  strike: number;
  type: OptionSide;
} | null {
  const trimmed = line.trim();
  const m = trimmed.match(
    /^(call|put)\s+([A-Za-z.\-]+)\s*@?\s*\$?\s*([0-9]+(?:\.[0-9]+)?)\s*(?:exp|expiry|expiration)\s+([A-Za-z]{3,9})\s+([0-9]{1,2}),?\s+([0-9]{4})$/i
  );
  if (!m) return null;

  const monthMap: Record<string, number> = {
    jan: 1,
    january: 1,
    feb: 2,
    february: 2,
    mar: 3,
    march: 3,
    apr: 4,
    april: 4,
    may: 5,
    jun: 6,
    june: 6,
    jul: 7,
    july: 7,
    aug: 8,
    august: 8,
    sep: 9,
    sept: 9,
    september: 9,
    oct: 10,
    october: 10,
    nov: 11,
    november: 11,
    dec: 12,
    december: 12,
  };

  const type: OptionSide = m[1].toLowerCase().startsWith("c") ? "C" : "P";
  const underlying = m[2].toUpperCase();
  const strike = Number(m[3]);
  const month = monthMap[m[4].toLowerCase()];
  const day = Number(m[5]);
  const year = Number(m[6]);
  if (!underlying || !month || !Number.isFinite(strike) || strike <= 0) return null;
  const expiry = `${year.toString().padStart(4, "0")}-${month
    .toString()
    .padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
  return { underlying, expiry, strike, type };
}

function parseGroupedText(input: string): ParsedPosition[] {
  const lines = input
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  let family = "Uncategorized family";
  let account = "Uncategorized account";
  const out: ParsedPosition[] = [];

  for (const line of lines) {
    if (/family/i.test(line) && !/^call\b|^put\b/i.test(line)) {
      family = line;
      continue;
    }
    if (!/^call\b|^put\b/i.test(line)) {
      account = line;
      continue;
    }
    const opt = parseNaturalOptionLine(line);
    if (!opt) continue;
    out.push({
      id: `${family}|${account}|${opt.underlying}|${opt.expiry}|${opt.strike}|${opt.type}|${out.length}`,
      family,
      account,
      raw: line,
      ...opt,
    });
  }
  return out;
}

function daysToExpiry(expiry: string): number {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const exp = new Date(`${expiry}T00:00:00.000Z`);
  return Math.max(0, Math.round((exp.getTime() - today.getTime()) / (24 * 60 * 60 * 1000)));
}

function getMoneynessPct(type: OptionSide, strike: number, spot: number): number {
  if (!Number.isFinite(spot) || spot <= 0 || !Number.isFinite(strike) || strike <= 0) return NaN;
  if (type === "P") return ((strike - spot) / strike) * 100;
  return ((spot - strike) / strike) * 100;
}

function getRiskLabel(moneynessPct: number, dte: number): "Low" | "Medium" | "Elevated" | "High" | "Unknown" {
  if (!Number.isFinite(moneynessPct)) return "Unknown";
  const nearExpiryBoost = dte <= 1 ? 1.2 : dte <= 3 ? 1.1 : 1;
  const score = moneynessPct * nearExpiryBoost;
  if (score >= 2.5) return "High";
  if (score >= 0.8) return "Elevated";
  if (score >= -1.0) return "Medium";
  return "Low";
}

export function AssignmentCheck({ theme: t }: AssignmentCheckProps) {
  const [sourceMode, setSourceMode] = useState<SourceMode>("manual");
  const [input, setInput] = useState(SAMPLE_INPUT);
  const [positions, setPositions] = useState<ParsedPosition[]>([]);
  const [quotesByKey, setQuotesByKey] = useState<Record<string, OptionQuote>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

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
  const tableWrapStyle: React.CSSProperties = {
    overflowX: "auto",
    borderRadius: t.radius.md,
    border: `1px solid ${t.colors.border}`,
  };
  const tableStyle: React.CSSProperties = {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: "0.88rem",
    fontFamily: t.typography.fontFamily,
  };
  const thStyle: React.CSSProperties = {
    textAlign: "left",
    padding: `${t.spacing(2)} ${t.spacing(3)}`,
    backgroundColor: t.colors.secondary,
    color: "#fff",
    fontSize: "0.8rem",
    borderBottom: `1px solid ${t.colors.border}`,
    whiteSpace: "nowrap",
  };
  const tdStyle: React.CSSProperties = {
    padding: `${t.spacing(2)} ${t.spacing(3)}`,
    borderBottom: `1px solid ${t.colors.border}`,
    color: t.colors.text,
  };
  const thNumStyle: React.CSSProperties = { ...thStyle, textAlign: "right" };
  const tdNumStyle: React.CSSProperties = { ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" };

  const primaryBtn = getPrimaryActionButtonStyle(t);

  const grouped = useMemo(() => {
    const m = new Map<string, ParsedPosition[]>();
    for (const p of positions) {
      const key = `${p.family}|||${p.account}`;
      const arr = m.get(key) ?? [];
      arr.push(p);
      m.set(key, arr);
    }
    return Array.from(m.entries()).map(([key, arr]) => {
      const [family, account] = key.split("|||");
      return { family, account, rows: arr };
    });
  }, [positions]);

  async function enrichWithSchwab(rows: ParsedPosition[]): Promise<Record<string, OptionQuote>> {
    if (rows.length === 0) return {};
    const payload = rows.map((r) => ({
      underlying: r.underlying,
      expiry: r.expiry,
      strike: r.strike,
      type: r.type,
    }));
    const res = await fetch(`${SCHWAB_API_BASE}/api/schwab-option-prices`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body?.error ?? `Schwab quote request failed (${res.status})`);
    }
    return (await res.json()) as Record<string, OptionQuote>;
  }

  async function loadFromAddepar() {
    const res = await fetch(`${SCHWAB_API_BASE}/api/addepar-assignment-check`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(json?.error ?? `Addepar request failed (${res.status})`);
    }
    setWarnings(Array.isArray(json?.warnings) ? json.warnings.map((w: unknown) => String(w)) : []);
    const rows = Array.isArray(json?.positions) ? (json.positions as ParsedPosition[]) : [];
    return rows;
  }

  async function runCheck() {
    setLoading(true);
    setError(null);
    setWarnings([]);
    try {
      const rows = sourceMode === "manual" ? parseGroupedText(input) : await loadFromAddepar();
      if (rows.length === 0) {
        setPositions([]);
        setQuotesByKey({});
        setError("No option lines found. Use 'Call/Put TICKER @ $STRIKE Exp Mon DD, YYYY'.");
        return;
      }
      setPositions(rows);
      const quotes = await enrichWithSchwab(rows);
      setQuotesByKey(quotes);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to run assignment check.");
      setPositions([]);
      setQuotesByKey({});
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="assignment-check-page" style={pageStyle}>
      <h2 style={titleStyle}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: t.spacing(2) }}>
          <span className="material-symbols-outlined" style={{ fontSize: "1.5rem", color: t.colors.secondary }} aria-hidden>
            schedule
          </span>
          Assignment Check
        </span>
      </h2>
      <p style={descStyle}>
        Weekly assignment monitor for expiring options by family/account. Pull from Addepar (server-side) or paste grouped
        lines, then enrich with Schwab spot prices and compute moneyness-based assignment risk.
      </p>

      <div className="page-card" style={cardStyle}>
        <h3 style={sectionTitleStyle}>Source & Input</h3>
        <div style={{ display: "flex", gap: t.spacing(2), flexWrap: "wrap", marginBottom: t.spacing(3) }}>
          <button
            type="button"
            onClick={() => setSourceMode("manual")}
            style={{
              ...primaryBtn,
              backgroundColor: sourceMode === "manual" ? t.colors.primary : t.colors.surface,
              color: sourceMode === "manual" ? "#fff" : t.colors.text,
              border: `1px solid ${sourceMode === "manual" ? t.colors.primary : t.colors.border}`,
            }}
          >
            Manual paste
          </button>
          <button
            type="button"
            onClick={() => setSourceMode("addepar")}
            style={{
              ...primaryBtn,
              backgroundColor: sourceMode === "addepar" ? t.colors.primary : t.colors.surface,
              color: sourceMode === "addepar" ? "#fff" : t.colors.text,
              border: `1px solid ${sourceMode === "addepar" ? t.colors.primary : t.colors.border}`,
            }}
          >
            Addepar API
          </button>
        </div>

        {sourceMode === "manual" && (
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            style={{
              width: "100%",
              minHeight: 180,
              padding: t.spacing(3),
              borderRadius: t.radius.md,
              border: `1px solid ${t.colors.border}`,
              backgroundColor: t.colors.background,
              color: t.colors.text,
              fontFamily: "monospace",
              fontSize: "0.85rem",
              resize: "vertical",
              marginBottom: t.spacing(3),
            }}
            placeholder={SAMPLE_INPUT}
          />
        )}

        {sourceMode === "addepar" && (
          <p style={{ margin: `0 0 ${t.spacing(3)}`, color: t.colors.textMuted, fontSize: "0.9rem" }}>
            Addepar data is fetched through a backend endpoint so credentials stay in Vercel server env vars. No secrets are
            exposed to the browser.
          </p>
        )}

        <button
          type="button"
          onClick={runCheck}
          style={{ ...primaryBtn, display: "inline-flex", alignItems: "center", gap: t.spacing(2) }}
          disabled={loading}
        >
          {loading ? (
            <>
              <span className="options-pricing-fetch-spinner" aria-hidden />
              Running...
            </>
          ) : (
            "Run assignment check"
          )}
        </button>
        {error && <p style={{ marginTop: t.spacing(2), color: t.colors.danger, fontWeight: 600 }}>{error}</p>}
        {warnings.length > 0 && (
          <div style={{ marginTop: t.spacing(2), color: t.colors.textMuted, fontSize: "0.85rem", lineHeight: 1.5 }}>
            {warnings.map((w, idx) => (
              <div key={idx}>• {w}</div>
            ))}
          </div>
        )}
      </div>

      {grouped.map((g) => (
        <div key={`${g.family}-${g.account}`} className="page-card" style={cardStyle}>
          <h3 style={{ ...sectionTitleStyle, marginBottom: t.spacing(1) }}>{g.family}</h3>
          <p style={{ margin: `0 0 ${t.spacing(3)}`, color: t.colors.textMuted, fontSize: "0.9rem" }}>{g.account}</p>
          <div style={tableWrapStyle}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Position</th>
                  <th style={thNumStyle}>Strike</th>
                  <th style={thNumStyle}>Spot</th>
                  <th style={thNumStyle}>DTE</th>
                  <th style={thNumStyle}>Moneyness</th>
                  <th style={thStyle}>Assignment risk</th>
                </tr>
              </thead>
              <tbody>
                {g.rows.map((r) => {
                  const key = `${r.underlying} ${r.expiry} ${r.strike} ${r.type}`;
                  const q = quotesByKey[key];
                  const spot = q?.underlyingPrice;
                  const dte = daysToExpiry(r.expiry);
                  const m = spot != null ? getMoneynessPct(r.type, r.strike, spot) : NaN;
                  const risk = getRiskLabel(m, dte);
                  return (
                    <tr key={r.id}>
                      <td style={tdStyle}>
                        {r.type === "C" ? "Call" : "Put"} {r.underlying} Exp {r.expiry}
                      </td>
                      <td style={tdNumStyle}>${r.strike.toFixed(2)}</td>
                      <td style={tdNumStyle}>{spot != null ? `$${spot.toFixed(2)}` : "—"}</td>
                      <td style={tdNumStyle}>{dte}</td>
                      <td style={tdNumStyle}>
                        {Number.isFinite(m) ? `${m >= 0 ? "+" : ""}${m.toFixed(2)}%` : "—"}
                      </td>
                      <td
                        style={{
                          ...tdStyle,
                          color:
                            risk === "High"
                              ? t.colors.danger
                              : risk === "Elevated"
                              ? "#d97706"
                              : risk === "Medium"
                              ? t.colors.text
                              : risk === "Low"
                              ? t.colors.success
                              : t.colors.textMuted,
                          fontWeight: 600,
                        }}
                      >
                        {risk}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </section>
  );
}

