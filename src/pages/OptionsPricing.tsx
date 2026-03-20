import { useState, useEffect } from "react";
import type { Theme } from "../theme";
import { getPrimaryActionButtonStyle, getPrimaryButtonStyle, PAGE_LAYOUT } from "../theme";

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
  underlyingPrice?: number;
  bid?: number;
  ask?: number;
  last?: number;
  mark?: number;
};

const SCHWAB_API_BASE =
  (import.meta.env.VITE_SCHWAB_API_BASE as string) ||
  "https://therpghub.vercel.app";

function parseLine(line: string): ParsedOption | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("#")) return null;
  const parts = trimmed.split(/\s+/);

  // Format A: TICKER MM/DD/YYYY STRIKE C|P (existing behavior)
  if (parts.length >= 4) {
    const underlying = parts[0].toUpperCase();
    const datePart = parts[1];
    const strikePart = parts[2];
    const typePart = parts[3].toUpperCase();
    const maybeType: "C" | "P" | null = typePart.startsWith("C")
      ? "C"
      : typePart.startsWith("P")
      ? "P"
      : null;
    if (maybeType) {
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
      const key = `${underlying} ${expiry} ${strike} ${maybeType}`;
      return { key, underlying, expiry, strike, type: maybeType, raw: line };
    }
  }

  // Format B: "Call DDOG @ $155.0 Exp Mar 20, 2026" (plus small variations)
  const natural = trimmed.match(
    /^(call|put)\s+([A-Za-z.\-]+)\s*@?\s*\$?\s*([0-9]+(?:\.[0-9]+)?)\s*(?:exp|expiry|expiration)\s+([A-Za-z]{3,9})\s+([0-9]{1,2}),?\s+([0-9]{4})$/i
  );
  if (natural) {
    const side = natural[1].toUpperCase();
    const underlying = natural[2].toUpperCase();
    const strike = Number(natural[3]);
    const monthRaw = natural[4].toLowerCase();
    const day = Number(natural[5]);
    const year = Number(natural[6]);
    if (!underlying || !Number.isFinite(strike) || strike <= 0) return null;
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
    const month = monthMap[monthRaw];
    if (!month || !Number.isFinite(day) || day < 1 || day > 31 || year < 1900) return null;
    const expiry = `${year.toString().padStart(4, "0")}-${month
      .toString()
      .padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
    const type: "C" | "P" = side.startsWith("C") ? "C" : "P";
    const key = `${underlying} ${expiry} ${strike} ${type}`;
    return { key, underlying, expiry, strike, type, raw: line };
  }

  return null;
}

export function OptionsPricing({ theme: t }: OptionsPricingProps) {
  const [input, setInput] = useState("");
  const [parsed, setParsed] = useState<ParsedOption[]>([]);
  const [resultOrder, setResultOrder] = useState<string[]>([]);
  const [prices, setPrices] = useState<Record<string, OptionPrice>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copyJustPressed, setCopyJustPressed] = useState(false);
  const [copiedColumn, setCopiedColumn] = useState<"bid" | "ask" | "last" | "mark" | null>(null);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dropTargetIndex, setDropTargetIndex] = useState<number | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  useEffect(() => {
    setResultOrder(parsed.map((p) => p.key));
  }, [parsed]);

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
  };
  const thNumStyle: React.CSSProperties = { ...thStyle, textAlign: "right" };
  const tdStyle: React.CSSProperties = {
    padding: `${t.spacing(2)} ${t.spacing(3)}`,
    borderBottom: `1px solid ${t.colors.border}`,
    color: t.colors.text,
  };
  const tdNumStyle: React.CSSProperties = {
    ...tdStyle,
    textAlign: "right" as const,
    fontVariantNumeric: "tabular-nums",
  };

  const canReorder = resultOrder.length > 1;
  function handleDragStart(index: number) {
    setDraggedIndex(index);
  }
  function handleDragOver(e: React.DragEvent, index: number) {
    e.preventDefault();
    if (draggedIndex === null) return;
    setDropTargetIndex(index);
  }
  function handleDragLeave() {
    setDropTargetIndex(null);
  }
  function handleDragEnd() {
    setDraggedIndex(null);
    setDropTargetIndex(null);
  }
  function handleDrop(e: React.DragEvent, dropIndex: number) {
    e.preventDefault();
    setDropTargetIndex(null);
    if (draggedIndex === null || draggedIndex === dropIndex) {
      setDraggedIndex(null);
      return;
    }
    const newOrder = [...resultOrder];
    const [removed] = newOrder.splice(draggedIndex, 1);
    newOrder.splice(dropIndex, 0, removed);
    setResultOrder(newOrder);
    setDraggedIndex(null);
  }

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

  const primaryBtn = getPrimaryActionButtonStyle(t);

  function canCopyTable(): boolean {
    return parsed.length > 0;
  }

  function copyTableToClipboard() {
    if (!canCopyTable()) return;
    const header = ["Input", "Schwab symbol", "Underlying", "Bid", "Ask", "Last", "Mark"].join("\t");
    const rows = resultOrder.map((key) => {
      const p = parsed.find((x) => x.key === key);
      if (!p) return "";
      const id = `${p.underlying} ${p.expiry} ${p.strike} ${p.type}`;
      const q = prices[id];
      const cells = [
        p.raw.trim(),
        q?.symbol ?? "",
        q?.underlyingPrice != null ? q.underlyingPrice.toFixed(2) : "",
        q?.bid != null ? q.bid.toFixed(2) : "",
        q?.ask != null ? q.ask.toFixed(2) : "",
        q?.last != null ? q.last.toFixed(2) : "",
        q?.mark != null ? q.mark.toFixed(2) : "",
      ];
      return cells.join("\t");
    }).filter(Boolean);
    const tsv = [header, ...rows].join("\r\n");
    void navigator.clipboard.writeText(tsv);
    setCopyJustPressed(true);
    window.setTimeout(() => setCopyJustPressed(false), 2000);
  }

  function copyColumnToClipboard(field: "bid" | "ask" | "last" | "mark") {
    if (parsed.length === 0) return;
    const lines = resultOrder.map((key) => {
      const p = parsed.find((x) => x.key === key);
      if (!p) return "";
      const id = `${p.underlying} ${p.expiry} ${p.strike} ${p.type}`;
      const q = prices[id];
      const value = q?.[field];
      return value != null && Number.isFinite(value) ? value.toString() : "";
    });
    const output = [field.toUpperCase(), ...lines].join("\r\n");
    void navigator.clipboard.writeText(output);
    setCopiedColumn(field);
    window.setTimeout(() => setCopiedColumn(null), 2000);
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
      setLastUpdated(new Date());
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
      <h2 style={titleStyle}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: t.spacing(2) }}>
          <span
            className="material-symbols-outlined"
            style={{ fontSize: "1.5rem", color: t.colors.secondary, lineHeight: 1, display: "inline-flex" }}
            aria-hidden
          >
            paid
          </span>
          Options Pricing
        </span>
      </h2>
      <p style={descStyle}>
        Drop in your option lines and fetch live Schwab quotes (bid / ask /
        last / mark) for each contract. Use one option per line, like:
        <br />
        <code>DDOG 03/20/2026 155 C</code>
      </p>

      <div className="page-card options-pricing-card" style={cardStyle}>
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
            {loading ? (
              <span style={{ display: "inline-flex", alignItems: "center", gap: t.spacing(2) }}>
                <span className="options-pricing-fetch-spinner" aria-hidden />
                Fetching
              </span>
            ) : (
              "Fetch prices"
            )}
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
        <div className="page-card options-pricing-card" style={cardStyle}>
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
                <button
                  type="button"
                  onClick={copyTableToClipboard}
                  className="options-pricing-copy-table"
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
                  title="Copy table (Excel / Google Sheets)"
                  aria-label="Copy table to clipboard"
                >
                  <span
                    className="material-symbols-outlined"
                    style={{
                      fontSize: 22,
                      position: "absolute",
                      opacity: copyJustPressed ? 0 : 1,
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
                      opacity: copyJustPressed ? 1 : 0,
                      transition: "opacity 0.2s ease",
                      pointerEvents: "none",
                    }}
                    aria-hidden
                  >
                    check
                  </span>
                </button>
              </div>
            )}
          </div>
          <div style={tableWrapStyle}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Input</th>
                  <th style={thStyle}>Schwab symbol</th>
                  <th style={thNumStyle}>Underlying</th>
                  <th
                    style={{
                      ...thNumStyle,
                  color: copiedColumn === "bid" ? t.colors.primary : "#FFFFFF",
                      cursor: "pointer",
                      transition: "color 0.2s ease",
                    }}
                    onClick={() => copyColumnToClipboard("bid")}
                    title="Copy Bid column"
                  >
                    Bid
                  </th>
                  <th
                    style={{
                      ...thNumStyle,
                  color: copiedColumn === "ask" ? t.colors.primary : "#FFFFFF",
                      cursor: "pointer",
                      transition: "color 0.2s ease",
                    }}
                    onClick={() => copyColumnToClipboard("ask")}
                    title="Copy Ask column"
                  >
                    Ask
                  </th>
                  <th
                    style={{
                      ...thNumStyle,
                  color: copiedColumn === "last" ? t.colors.primary : "#FFFFFF",
                      cursor: "pointer",
                      transition: "color 0.2s ease",
                    }}
                    onClick={() => copyColumnToClipboard("last")}
                    title="Copy Last column"
                  >
                    Last
                  </th>
                  <th
                    style={{
                      ...thNumStyle,
                  color: copiedColumn === "mark" ? t.colors.primary : "#FFFFFF",
                      cursor: "pointer",
                      transition: "color 0.2s ease",
                    }}
                    onClick={() => copyColumnToClipboard("mark")}
                    title="Copy Mark column"
                  >
                    Mark
                  </th>
                </tr>
              </thead>
              <tbody>
                {resultOrder.map((key, i) => {
                  const p = parsed.find((x) => x.key === key);
                  if (!p) return null;
                  const id = `${p.underlying} ${p.expiry} ${p.strike} ${p.type}`;
                  const q = prices[id];
                  const isDragging = draggedIndex === i;
                  const isDropTarget = dropTargetIndex === i;
                  return (
                    <tr
                      key={p.key}
                      draggable={canReorder}
                      onDragStart={() => canReorder && handleDragStart(i)}
                      onDragOver={(e) => canReorder && handleDragOver(e, i)}
                      onDragLeave={handleDragLeave}
                      onDragEnd={handleDragEnd}
                      onDrop={(e) => canReorder && handleDrop(e, i)}
                      style={{
                        cursor: canReorder ? "grab" : undefined,
                        opacity: isDragging ? 0.5 : 1,
                        backgroundColor: isDropTarget ? t.colors.background : undefined,
                      }}
                    >
                      <td style={{ ...tdStyle, fontFamily: "monospace" }}>{p.raw}</td>
                      <td style={{ ...tdStyle, fontFamily: "monospace" }}>{q?.symbol ?? "—"}</td>
                      <td style={tdNumStyle}>{q?.underlyingPrice != null ? q.underlyingPrice.toFixed(2) : "—"}</td>
                      <td style={tdNumStyle}>{q?.bid != null ? q.bid.toFixed(2) : "—"}</td>
                      <td style={tdNumStyle}>{q?.ask != null ? q.ask.toFixed(2) : "—"}</td>
                      <td style={tdNumStyle}>{q?.last != null ? q.last.toFixed(2) : "—"}</td>
                      <td style={tdNumStyle}>{q?.mark != null ? q.mark.toFixed(2) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
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

