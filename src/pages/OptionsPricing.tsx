import { useState } from "react";
import type { Theme } from "../theme";
import { getPrimaryButtonStyle, PAGE_LAYOUT } from "../theme";

type OptionsPricingProps = { theme: Theme };

type ParsedOption = {
  key: string;
  underlying: string;
  expiry: string; // YYYY-MM-DD
  strike: number;
  type: "C" | "P";
  raw: string;
};

type OptionPrice = {
  symbol: string;
  description?: string;
  bid?: number;
  ask?: number;
  last?: number;
  mark?: number;
};

const SCHWAB_API_BASE =
  (import.meta.env.VITE_SCHWAB_API_BASE as string) ||
  "https://rpghub-two.vercel.app";

function parseLine(line: string): ParsedOption | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("#")) return null;
  const parts = trimmed.split(/\s+/);
  // Expect at least: TICKER DATE STRIKE TYPE
  if (parts.length < 4) return null;
  const underlying = parts[0].toUpperCase();
  const datePart = parts[1];
  const strikePart = parts[2];
  const typePart = parts[3].toUpperCase();
  const type: "C" | "P" = typePart.startsWith("C") ? "C" : "P";

  // Accept MM/DD/YYYY or YYYY-MM-DD
  let expiry: string;
  if (datePart.includes("/")) {
    const [mm, dd, yyyy] = datePart.split("/");
    if (!yyyy || !mm || !dd) return null;
    expiry = `${yyyy.padStart(4, "0")}-${mm.padStart(2, "0")}-${dd.padStart(
      2,
      "0"
    )}`;
  } else {
    expiry = datePart;
  }

  const strike = Number(strikePart);
  if (!strike || !isFinite(strike)) return null;

  const key = `${underlying} ${expiry} ${strike} ${type}`;
  return { key, underlying, expiry, strike, type, raw: line };
}

export function OptionsPricing({ theme: t }: OptionsPricingProps) {
  const [input, setInput] = useState("");
  const [parsed, setParsed] = useState<ParsedOption[]>([]);
  const [prices, setPrices] = useState<Record<string, OptionPrice>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copyJustPressed, setCopyJustPressed] = useState(false);

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

  const textareaStyle: React.CSSProperties = {
    width: "100%",
    minHeight: 160,
    padding: t.spacing(3),
    fontFamily: "monospace",
    fontSize: "0.85rem",
    borderRadius: t.radius.md,
    border: `1px solid ${t.colors.border}`,
    backgroundColor: t.colors.background,
    color: t.colors.text,
    resize: "vertical" as const,
  };

  const primaryBtn = getPrimaryButtonStyle(t);

  function canCopyTable(): boolean {
    return parsed.length > 0;
  }

  function copyTableToClipboard() {
    if (!canCopyTable()) return;
    const header = ["Input", "Schwab symbol", "Bid", "Ask", "Last", "Mark"].join("\t");
    const rows = parsed.map((p) => {
      const id = `${p.underlying} ${p.expiry} ${p.strike} ${p.type}`;
      const q = prices[id];
      const cells = [
        p.raw.trim(),
        q?.symbol ?? "",
        q?.bid != null ? q.bid.toFixed(2) : "",
        q?.ask != null ? q.ask.toFixed(2) : "",
        q?.last != null ? q.last.toFixed(2) : "",
        q?.mark != null ? q.mark.toFixed(2) : "",
      ];
      return cells.join("\t");
    });
    const tsv = [header, ...rows].join("\r\n");
    void navigator.clipboard.writeText(tsv);
    setCopyJustPressed(true);
    window.setTimeout(() => setCopyJustPressed(false), 2000);
  }

  async function handleFetch() {
    const lines = input.split(/\r?\n/);
    const parsedLines: ParsedOption[] = [];
    for (const line of lines) {
      const p = parseLine(line);
      if (p) parsedLines.push(p);
    }
    if (parsedLines.length === 0) {
      setError("Paste one option per line using: TICKER MM/DD/YYYY STRIKE C|P");
      setParsed([]);
      setPrices({});
      return;
    }
    setError(null);
    setParsed(parsedLines);
    setLoading(true);
    try {
      const payload = parsedLines.map((p) => ({
        underlying: p.underlying,
        expiry: p.expiry,
        strike: p.strike,
        type: p.type,
      }));
      const res = await fetch(`${SCHWAB_API_BASE}/api/schwab-option-prices`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          (body as { error?: string }).error ||
            `Request failed with ${res.status}`
        );
      }
      const data = (await res.json()) as Record<string, OptionPrice>;
      setPrices(data);
    } catch (e: unknown) {
      setError(
        e instanceof Error
          ? e.message
          : "Failed to fetch option prices from Schwab"
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="options-pricing-page" style={pageStyle}>
      <h2 style={titleStyle}>Options Pricing</h2>
      <p style={descStyle}>
        Drop in your option lines and fetch live Schwab quotes (bid / ask /
        last / mark) for each contract. Use one option per line, like:
        <br />
        <code>DDOG 03/20/2026 155 C</code>
      </p>

      <div className="options-pricing-card" style={cardStyle}>
        <h3 style={sectionTitleStyle}>Paste options</h3>
        <textarea
          style={textareaStyle}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={"DDOG 03/20/2026 155 C\nAAPL 01/17/2025 200 P"}
        />
        <div
          style={{
            marginTop: t.spacing(3),
            display: "flex",
            alignItems: "center",
            gap: t.spacing(2),
            flexWrap: "wrap",
          }}
        >
          <button
            type="button"
            style={primaryBtn}
            onClick={handleFetch}
            disabled={loading}
          >
            {loading ? "Fetching from Schwab…" : "Fetch prices"}
          </button>
          {error && (
            <span
              style={{
                fontSize: "0.85rem",
                color: t.colors.danger,
              }}
            >
              {error}
            </span>
          )}
        </div>
      </div>

      {parsed.length > 0 && (
        <div className="options-pricing-card" style={cardStyle}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: t.spacing(2),
            }}
          >
            <h3 style={sectionTitleStyle}>Results</h3>
            {canCopyTable() && (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "flex-end",
                  gap: 2,
                }}
              >
                {copyJustPressed && (
                  <span
                    style={{
                      fontSize: "0.7rem",
                      color: t.colors.primary,
                      fontWeight: t.typography.headingWeight,
                    }}
                  >
                    Copied
                  </span>
                )}
                <button
                  type="button"
                  onClick={copyTableToClipboard}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: t.spacing(1.5),
                    border: "none",
                    background: "none",
                    cursor: "pointer",
                    color: t.colors.textMuted,
                    borderRadius: t.radius.sm,
                  }}
                  title="Copy table (Excel / Google Sheets)"
                  aria-label="Copy table to clipboard"
                >
                  <span
                    className="material-symbols-outlined"
                    style={{ fontSize: 22 }}
                    aria-hidden
                  >
                    content_copy
                  </span>
                </button>
              </div>
            )}
          </div>
          <div style={{ overflowX: "auto" }}>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: "0.85rem",
              }}
            >
              <thead>
                <tr>
                  <th
                    style={{
                      textAlign: "left",
                      padding: t.spacing(2),
                      color: t.colors.textMuted,
                      fontWeight: 600,
                    }}
                  >
                    Input
                  </th>
                  <th
                    style={{
                      textAlign: "left",
                      padding: t.spacing(2),
                      color: t.colors.textMuted,
                      fontWeight: 600,
                    }}
                  >
                    Schwab symbol
                  </th>
                  <th
                    style={{
                      textAlign: "right",
                      padding: t.spacing(2),
                      color: t.colors.textMuted,
                      fontWeight: 600,
                    }}
                  >
                    Bid
                  </th>
                  <th
                    style={{
                      textAlign: "right",
                      padding: t.spacing(2),
                      color: t.colors.textMuted,
                      fontWeight: 600,
                    }}
                  >
                    Ask
                  </th>
                  <th
                    style={{
                      textAlign: "right",
                      padding: t.spacing(2),
                      color: t.colors.textMuted,
                      fontWeight: 600,
                    }}
                  >
                    Last
                  </th>
                  <th
                    style={{
                      textAlign: "right",
                      padding: t.spacing(2),
                      color: t.colors.textMuted,
                      fontWeight: 600,
                    }}
                  >
                    Mark
                  </th>
                </tr>
              </thead>
              <tbody>
                {parsed.map((p) => {
                  const id = `${p.underlying} ${p.expiry} ${p.strike} ${p.type}`;
                  const q = prices[id];
                  return (
                    <tr
                      key={p.key}
                      style={{ borderBottom: `1px solid ${t.colors.border}` }}
                    >
                      <td
                        style={{
                          padding: t.spacing(2),
                          fontFamily: "monospace",
                        }}
                      >
                        {p.raw}
                      </td>
                      <td
                        style={{
                          padding: t.spacing(2),
                          fontFamily: "monospace",
                        }}
                      >
                        {q?.symbol ?? "—"}
                      </td>
                      <td
                        style={{
                          padding: t.spacing(2),
                          textAlign: "right",
                        }}
                      >
                        {q?.bid != null ? q.bid.toFixed(2) : "—"}
                      </td>
                      <td
                        style={{
                          padding: t.spacing(2),
                          textAlign: "right",
                        }}
                      >
                        {q?.ask != null ? q.ask.toFixed(2) : "—"}
                      </td>
                      <td
                        style={{
                          padding: t.spacing(2),
                          textAlign: "right",
                        }}
                      >
                        {q?.last != null ? q.last.toFixed(2) : "—"}
                      </td>
                      <td
                        style={{
                          padding: t.spacing(2),
                          textAlign: "right",
                        }}
                      >
                        {q?.mark != null ? q.mark.toFixed(2) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}

