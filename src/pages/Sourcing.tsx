// Sourcing.tsx
// HNW prospect discovery: SEC Form 4 insider sale scans (export to Google Sheets).

import { useState, useCallback, useEffect, useRef, useMemo, Fragment, type CSSProperties } from "react";
import type { Theme } from "../theme";
import {
  getFixedRailsLayoutStyles,
  getPrimaryActionButtonStyle,
  getRailFooterActionButtonLayout,
  getPageCardStyle,
  PAGE_LAYOUT,
  shadows,
  zIndex,
} from "../theme";
import { SCHWAB_API_BASE } from "../constants";

type SourcingProps = { theme: Theme; sidebarWidth: number };

type Form4Lead = {
  filerName: string;
  filerCountry?: string;
  companyName: string;
  companyTicker: string | null;
  role: string;
  transactionValue: number;
  shares: number;
  pricePerShare: number | null;
  transactionDate: string;
  filedDate: string;
  transactionCode: string;
  filingUrl: string;
  filingAltUrl?: string;
  accessionNo: string;
};

type Form4ScanMeta = {
  days: number;
  minValueUsd: number;
  filingsSearched: number;
  filingsParsed: number;
  parseErrors: number;
  leadCount: number;
};

const SCAN_DEPTHS = [
  { id: "quick", label: "Quick", filings: 50, description: "Most recent ~50 Form 4s in range" },
  { id: "standard", label: "Standard", filings: 100, description: "Most recent ~100 Form 4s (default)" },
  { id: "deep", label: "Deep", filings: 200, description: "Up to ~200 — slowest, widest coverage" },
] as const;

type ScanDepthId = (typeof SCAN_DEPTHS)[number]["id"];

// --- Helpers ---

type Form4LeadGroup = {
  key: string;
  filerName: string;
  filerCountry: string;
  companyName: string;
  companyTicker: string | null;
  role: string;
  totalAmount: number;
  sales: Form4Lead[];
};

function formatUsd(n: number): string {
  return `$${n.toLocaleString("en-US")}`;
}

function decodeHtml(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function formatShortDate(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function groupLeads(leads: Form4Lead[]): Form4LeadGroup[] {
  const map = new Map<string, Form4LeadGroup>();
  for (const lead of leads) {
    const key = `${lead.filerName}\0${lead.companyTicker ?? lead.companyName}`;
    const existing = map.get(key);
    if (existing) {
      existing.sales.push(lead);
      existing.totalAmount += lead.transactionValue;
    } else {
      map.set(key, {
        key,
        filerName: lead.filerName,
        filerCountry: lead.filerCountry ?? "—",
        companyName: lead.companyName,
        companyTicker: lead.companyTicker,
        role: lead.role,
        totalAmount: lead.transactionValue,
        sales: [lead],
      });
    }
  }
  return Array.from(map.values())
    .map((g) => ({
      ...g,
      sales: [...g.sales].sort((a, b) => b.transactionValue - a.transactionValue),
    }))
    .sort((a, b) => b.totalAmount - a.totalAmount);
}

function latestFiledDate(sales: Form4Lead[]): string {
  return [...sales.map((s) => s.filedDate.slice(0, 10))].sort().reverse()[0] ?? "";
}

function txnSubtextForSales(sales: Form4Lead[], filedPrimary?: string): string | null {
  const dates = [...new Set(sales.map((s) => s.transactionDate.slice(0, 10)))].sort();
  if (dates.length === 0) return null;
  if (dates.length === 1) {
    if (filedPrimary && dates[0] === filedPrimary.slice(0, 10)) return null;
    return `Txn ${formatShortDate(dates[0])}`;
  }
  return `Txn ${formatShortDate(dates[0])} – ${formatShortDate(dates[dates.length - 1])}`;
}

function downloadForm4Csv(leads: Form4Lead[]) {
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const header = ["Name", "Country", "Company", "Ticker", "Role", "Amount USD", "Shares", "Price", "Transaction Date", "Filed", "Form 4 URL", "SEC viewer URL"];
  const rows = leads.map((r) => [
    r.filerName,
    r.filerCountry ?? "",
    r.companyName,
    r.companyTicker ?? "",
    r.role,
    String(r.transactionValue),
    String(r.shares),
    r.pricePerShare != null ? String(r.pricePerShare) : "",
    r.transactionDate,
    r.filedDate,
    r.filingUrl,
    r.filingAltUrl ?? "",
  ].map(esc).join(","));
  const csv = [header.join(","), ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `form4-sales-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// --- Main page ---

export function Sourcing({ theme: t, sidebarWidth }: SourcingProps) {
  const fixedRails = getFixedRailsLayoutStyles(t, {
    sidebarWidth,
    leftRailWidth: 286,
    rightRailWidth: 256,
    headerHeight: 104,
  });

  const [days, setDays] = useState(1);
  const [minValueM, setMinValueM] = useState(1);
  const [scanDepth, setScanDepth] = useState<ScanDepthId>("standard");
  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const scanWasRunning = useRef(false);
  const [hasScanned, setHasScanned] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [leads, setLeads] = useState<Form4Lead[]>([]);
  const [meta, setMeta] = useState<Form4ScanMeta | null>(null);
  const [lastScanAt, setLastScanAt] = useState<Date | null>(null);
  const [showInfoModal, setShowInfoModal] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (!showInfoModal) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setShowInfoModal(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showInfoModal]);

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
    const estimated = 75_000;
    const id = setInterval(() => {
      const ratio = (Date.now() - start) / estimated;
      setScanProgress(88 * (1 - Math.exp(-2.5 * ratio)));
    }, 250);
    return () => clearInterval(id);
  }, [scanning]);

  // --- Local styles (match Optimizer / Screener table patterns) ---

  const titleStyle: CSSProperties = {
    fontWeight: t.typography.headingWeight,
    fontSize: "1.5rem",
    color: t.colors.text,
    marginBottom: t.spacing(PAGE_LAYOUT.titleMarginBottom),
  };

  const descStyle: CSSProperties = {
    color: t.colors.textMuted,
    fontSize: t.typography.baseFontSize,
    lineHeight: 1.5,
    marginBottom: 0,
  };

  const sectionTitleStyle: CSSProperties = {
    fontSize: "0.75rem",
    color: t.colors.secondary,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    marginBottom: t.spacing(3),
    fontWeight: 700,
  };

  const labelStyle: CSSProperties = {
    fontSize: "0.72rem",
    fontWeight: 700,
    color: t.colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    marginBottom: t.spacing(1),
    display: "block",
  };

  const inputStyle: CSSProperties = {
    width: "100%",
    padding: `${t.spacing(2)} ${t.spacing(3)}`,
    height: 36,
    fontSize: "0.85rem",
    border: `1px solid ${t.colors.border}`,
    borderRadius: t.radius.md,
    backgroundColor: t.colors.background,
    color: t.colors.text,
    boxSizing: "border-box",
    fontFamily: t.typography.fontFamily,
  };

  const tableWrapStyle: CSSProperties = {
    overflowX: "auto",
    borderRadius: t.radius.md,
    border: `1px solid ${t.colors.border}`,
  };

  const tableStyle: CSSProperties = {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: "0.875rem",
    fontFamily: t.typography.fontFamily,
  };

  const thStyle: CSSProperties = {
    textAlign: "left",
    fontWeight: 600,
    padding: `${t.spacing(2)} ${t.spacing(3)}`,
    backgroundColor: t.colors.secondary,
    borderBottom: `1px solid ${t.colors.border}`,
    color: t.colors.secondaryText,
    fontSize: "0.8rem",
    whiteSpace: "nowrap",
  };

  const tdStyle: CSSProperties = {
    padding: `${t.spacing(2)} ${t.spacing(3)}`,
    borderBottom: `1px solid ${t.colors.border}`,
    color: t.colors.text,
    fontSize: "0.875rem",
  };

  const tableFooterStyle: CSSProperties = {
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
  };

  const cardStyle = getPageCardStyle(t, { padding: t.spacing(4), marginBottom: t.spacing(4) });
  const primaryBtn = getPrimaryActionButtonStyle(t);

  const runScan = useCallback(async () => {
    setScanning(true);
    setError(null);
    try {
      const res = await fetch(`${SCHWAB_API_BASE}/api/sourcing`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "form4_scan",
          days,
          minValueUsd: minValueM * 1_000_000,
          maxFilingsToParse: SCAN_DEPTHS.find((d) => d.id === scanDepth)?.filings ?? 100,
          titleKeywordsOnly: false,
        }),
      });
      const data = (await res.json()) as {
        leads?: Form4Lead[];
        error?: string;
        meta?: Form4ScanMeta;
      };
      if (!res.ok) {
        setLeads([]);
        setMeta(null);
        setHasScanned(true);
        setError(data.error ?? `Scan failed (${res.status})`);
        return;
      }
      setLeads(data.leads ?? []);
      setMeta(data.meta ?? null);
      setExpandedGroups(new Set());
      setHasScanned(true);
      setLastScanAt(new Date());
    } catch {
      setError("Network error. Try again.");
      setLeads([]);
      setMeta(null);
      setHasScanned(true);
    } finally {
      setScanning(false);
    }
  }, [days, minValueM, scanDepth]);

  const hasResults = leads.length > 0;
  const groupedLeads = useMemo(() => groupLeads(leads), [leads]);

  const toggleGroup = useCallback((key: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const subTextStyle: CSSProperties = {
    display: "block",
    fontSize: "0.72rem",
    color: t.colors.textMuted,
    fontWeight: 500,
  };

  const renderFilingLinks = (row: Form4Lead) => (
    <>
      <a
        href={row.filingUrl}
        target="_blank"
        rel="noopener noreferrer"
        style={{ color: t.colors.primary, fontWeight: 600 }}
      >
        Form 4
      </a>
      {row.filingAltUrl ? (
        <>
          <span style={{ color: t.colors.textMuted, margin: `0 ${t.spacing(0.5)}` }}>·</span>
          <a
            href={row.filingAltUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: t.colors.primary, fontWeight: 600 }}
          >
            SEC viewer
          </a>
        </>
      ) : (
        <span style={{ color: t.colors.textMuted, fontSize: "0.78rem" }}> · run a new scan for SEC viewer link</span>
      )}
    </>
  );

  return (
    <section className="sourcing-page" style={fixedRails.page}>

      {/* Fixed header */}
      <div style={fixedRails.topHeader}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
          <h2 style={{ ...titleStyle, marginBottom: 0 }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: t.spacing(2) }}>
              <span className="material-symbols-outlined" style={{ fontSize: "1.5rem", color: t.colors.secondary, lineHeight: 1 }} aria-hidden>
                person_search
              </span>
              Sourcing
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
            aria-label="How Sourcing works"
          >
            <span className="material-symbols-outlined" style={{ fontSize: 26 }} aria-hidden>info</span>
          </button>
        </div>
        <p style={{ ...descStyle, marginTop: t.spacing(1) }}>
          Daily SEC Form 4 insider <strong>sale</strong> scan for HNW prospecting. Default lookback is 1 day — widen for catch-up. Export CSV to your Google Sheet.
        </p>
      </div>

      {showInfoModal && (
        <>
          <div
            role="presentation"
            style={{ position: "fixed", inset: 0, backgroundColor: t.colors.overlay, zIndex: zIndex.modalBackdrop }}
            onClick={() => setShowInfoModal(false)}
          />
          <div
            role="dialog"
            aria-labelledby="sourcing-info-title"
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
              boxShadow: shadows.modal,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: t.spacing(3) }}>
              <h3 id="sourcing-info-title" style={{ ...sectionTitleStyle, marginBottom: 0, fontSize: "1rem", textTransform: "none", color: t.colors.secondary }}>
                How Sourcing works
              </h3>
              <button
                type="button"
                onClick={() => setShowInfoModal(false)}
                aria-label="Close"
                style={{ padding: t.spacing(0.5), border: "none", background: "none", color: t.colors.textMuted, cursor: "pointer" }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 22 }}>close</span>
              </button>
            </div>
            <div style={{ color: t.colors.text, fontSize: "0.88rem", lineHeight: 1.75 }}>
              <p style={{ fontWeight: 700, marginBottom: t.spacing(1), color: t.colors.primary }}>Form 4 scan</p>
              <p style={{ marginTop: 0, marginBottom: t.spacing(2) }}>
                Uses the free SEC EDGAR API (no API key). We search recent Form 4 filings, parse XML for open-market sales, and filter by your minimum dollar amount. LP funds, LLCs, and similar entity filers are excluded — only natural-person insiders (officers, directors, 10% owners).
              </p>
              <p style={{ marginBottom: t.spacing(2) }}>
                Export CSV and import into your team Google Sheet — that sheet is your prospect list, not a database in this app.
              </p>
              <p style={{ fontWeight: 700, marginBottom: t.spacing(1), color: t.colors.primary }}>Tips</p>
              <ul style={{ margin: 0, paddingLeft: t.spacing(5) }}>
                <li>Verify each person on the SEC filing link before outreach.</li>
                <li>Not every large sale is a prospect (10b5-1 plans, tax sales).</li>
                <li>If results are thin, widen lookback or lower the $M minimum.</li>
              </ul>
            </div>
          </div>
        </>
      )}

      {/* Left rail — scan parameters */}
      <aside style={fixedRails.leftRail}>
        <div className="sourcing-scan-card" style={{ ...fixedRails.railPanel, minHeight: 0, flex: 1 }}>
          <div style={{ ...fixedRails.railBody, display: "flex", flexDirection: "column", gap: t.spacing(4) }}>
            <h3 style={{ ...sectionTitleStyle, marginBottom: 0 }}>Scan parameters</h3>

            <div>
              <label style={labelStyle} htmlFor="sourcing-days">Lookback (days)</label>
              <input
                id="sourcing-days"
                type="number"
                min={1}
                max={30}
                value={days}
                onChange={(e) => setDays(Number(e.target.value) || 7)}
                style={inputStyle}
                disabled={scanning}
              />
            </div>

            <div>
              <label style={labelStyle} htmlFor="sourcing-min-m">Min sale ($M)</label>
              <input
                id="sourcing-min-m"
                type="number"
                min={0.1}
                step={0.5}
                value={minValueM}
                onChange={(e) => setMinValueM(Number(e.target.value) || 1)}
                style={inputStyle}
                disabled={scanning}
              />
            </div>

            <div>
              <label style={labelStyle} htmlFor="sourcing-scan-depth">Scan depth</label>
              <select
                id="sourcing-scan-depth"
                value={scanDepth}
                onChange={(e) => setScanDepth(e.target.value as ScanDepthId)}
                style={inputStyle}
                disabled={scanning}
              >
                {SCAN_DEPTHS.map((d) => (
                  <option key={d.id} value={d.id}>{d.label} — {d.filings} filings</option>
                ))}
              </select>
              <p style={{ margin: `${t.spacing(1)} 0 0`, fontSize: "0.72rem", color: t.colors.textMuted, lineHeight: 1.45 }}>
                {SCAN_DEPTHS.find((d) => d.id === scanDepth)?.description}
                {" "}Thousands of Form 4s file nationally each week — we scan the most recent in your lookback window.
              </p>
            </div>

            {scanning && (
              <p style={{ margin: 0, color: t.colors.textMuted, fontSize: "0.8rem", lineHeight: 1.5 }}>
                Searching EDGAR and parsing filings — usually 30–90 seconds. Keep this tab open.
              </p>
            )}

            {error && (
              <div style={{ color: t.colors.danger, fontSize: "0.82rem", lineHeight: 1.5, fontWeight: 600 }}>
                {error}
              </div>
            )}

            {meta && !scanning && !error && (
              <p style={{ margin: 0, color: t.colors.textMuted, fontSize: "0.78rem", lineHeight: 1.5 }}>
                Opened {meta.filingsParsed} Form 4{meta.filingsParsed !== 1 ? "s" : ""} (from {meta.filingsSearched} in date range)
                {meta.parseErrors > 0 ? ` · ${meta.parseErrors} skipped` : ""}
                {" · "}{meta.leadCount} sale line{meta.leadCount !== 1 ? "s" : ""} matched filters
              </p>
            )}
          </div>

          <div style={fixedRails.railFooter}>
            <button
              type="button"
              onClick={() => void runScan()}
              disabled={scanning}
              style={{
                ...primaryBtn,
                ...getRailFooterActionButtonLayout(),
                position: "relative",
                overflow: "hidden",
                ...(scanProgress > 0 ? {
                  backgroundColor: "transparent",
                  border: `2px solid ${t.colors.primary}`,
                  color: scanProgress >= 50 ? t.colors.onPrimary : t.colors.primary,
                } : {}),
              }}
            >
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
                {scanning ? "Scanning EDGAR…" : "Run Form 4 scan"}
              </span>
            </button>
          </div>
        </div>
      </aside>

      {/* Center — results */}
      <div style={fixedRails.contentWrap}>
        {!hasResults && !scanning && !error && !hasScanned && (
          <div
            className="page-card"
            style={{
              ...cardStyle,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              minHeight: 220,
              color: t.colors.textMuted,
              textAlign: "center",
              gap: t.spacing(2),
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 40, opacity: 0.4 }} aria-hidden>gavel</span>
            <p style={{ margin: 0, fontWeight: 600, color: t.colors.text }}>Configure parameters and run a scan</p>
            <p style={{ margin: 0, fontSize: "0.85rem" }}>
              Insider sales above ${minValueM}M from {days === 1 ? "the last day" : `the last ${days} days`} will appear here.
            </p>
          </div>
        )}

        {!hasResults && hasScanned && !scanning && !error && (
          <div className="page-card" style={{ ...cardStyle, textAlign: "center", color: t.colors.textMuted }}>
            <p style={{ margin: 0, fontSize: "0.9rem", lineHeight: 1.55 }}>
              No qualifying sales matched your filters. Widen lookback, lower the minimum, or use a deeper scan.
            </p>
          </div>
        )}

        {hasResults && (
          <>
            <div className="page-card" style={cardStyle}>
              <h3 style={{ ...sectionTitleStyle, marginBottom: t.spacing(2) }}>Form 4 scan results</h3>
              <p style={{ fontSize: "0.875rem", color: t.colors.textMuted, marginBottom: t.spacing(2), lineHeight: 1.55, marginTop: 0 }}>
                Insider open-market sales matching your filters, ranked by transaction size.{" "}
                <strong>Form 4</strong> opens the transaction table; <strong>SEC viewer</strong> shows issuer and reporting-owner details for identity checks.
              </p>
              <p style={{ fontSize: "0.85rem", color: t.colors.text, marginBottom: t.spacing(3), marginTop: 0 }}>
                <strong>Matches:</strong> {groupedLeads.length}
                {groupedLeads.length !== leads.length ? (
                  <>
                    {" · "}
                    <strong>Sales:</strong> {leads.length}
                  </>
                ) : null}
                {" · "}
                <strong>Lookback:</strong> {days} days
                {" · "}
                <strong>Min sale:</strong> ${minValueM}M+
              </p>
              <div style={tableWrapStyle}>
                <table style={tableStyle}>
                  <thead>
                    <tr>
                      {["Name", "Company", "Role", "Amount", "Filed", "Filing"].map((h, colIdx, arr) => (
                        <th
                          key={h}
                          style={{
                            ...thStyle,
                            ...(colIdx === 0 ? { borderTopLeftRadius: t.radius.md } : {}),
                            ...(colIdx === arr.length - 1 ? { borderTopRightRadius: t.radius.md, width: "1%" } : {}),
                          }}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {groupedLeads.map((group, i) => {
                      const multi = group.sales.length > 1;
                      const expanded = expandedGroups.has(group.key);
                      const filedPrimary = latestFiledDate(group.sales);
                      const txnSub = txnSubtextForSales(group.sales, filedPrimary);
                      const rowBg = i % 2 === 0 ? t.colors.surface : t.colors.background;

                      const detailBorder = `1px solid ${t.colors.border}`;

                      return (
                        <Fragment key={group.key}>
                          <tr style={{ backgroundColor: rowBg }}>
                            <td style={{ ...tdStyle, fontWeight: 600 }}>
                              <span>{group.filerName}</span>
                              {group.filerCountry !== "—" ? (
                                <span style={subTextStyle}>{group.filerCountry}</span>
                              ) : null}
                            </td>
                            <td style={tdStyle}>
                              {group.companyName}
                              {group.companyTicker ? (
                                <span style={{ color: t.colors.textMuted }}> ({group.companyTicker})</span>
                              ) : null}
                            </td>
                            <td style={tdStyle}>{decodeHtml(group.role)}</td>
                            <td style={{ ...tdStyle, fontWeight: 600, color: t.colors.primary }}>
                              <span>{formatUsd(group.totalAmount)}</span>
                              {multi ? (
                                <span style={subTextStyle}>{group.sales.length} sales</span>
                              ) : null}
                            </td>
                            <td style={tdStyle}>
                              <span style={{ fontWeight: 600 }}>{formatShortDate(filedPrimary)}</span>
                              {txnSub ? <span style={subTextStyle}>{txnSub}</span> : null}
                            </td>
                            <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>
                              {multi ? (
                                <button
                                  type="button"
                                  onClick={() => toggleGroup(group.key)}
                                  aria-expanded={expanded}
                                  aria-label={expanded ? "Collapse sales" : "Expand sales"}
                                  style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    padding: t.spacing(1),
                                    margin: `-${t.spacing(1)}`,
                                    border: "none",
                                    background: "none",
                                    color: t.colors.secondary,
                                    cursor: "pointer",
                                  }}
                                >
                                  <span
                                    className="material-symbols-outlined"
                                    style={{
                                      fontSize: 20,
                                      transform: expanded ? "rotate(90deg)" : "none",
                                      transition: "transform 0.15s ease",
                                    }}
                                    aria-hidden
                                  >
                                    chevron_right
                                  </span>
                                </button>
                              ) : (
                                renderFilingLinks(group.sales[0])
                              )}
                            </td>
                          </tr>
                          {multi && expanded
                            ? group.sales.map((sale, j) => (
                                <tr
                                  key={`${group.key}-${sale.accessionNo}-${j}`}
                                  style={{ backgroundColor: rowBg }}
                                >
                                  <td colSpan={3} style={{ ...tdStyle, paddingTop: t.spacing(1), paddingBottom: t.spacing(1), borderBottom: j === group.sales.length - 1 ? detailBorder : "none" }}>
                                    <span
                                      style={{
                                        display: "inline-block",
                                        marginLeft: t.spacing(2),
                                        paddingLeft: t.spacing(2),
                                        borderLeft: `2px solid ${t.colors.border}`,
                                        fontSize: "0.78rem",
                                        color: t.colors.textMuted,
                                      }}
                                    >
                                      Sale {j + 1}
                                    </span>
                                  </td>
                                  <td style={{ ...tdStyle, fontWeight: 600, color: t.colors.primary, paddingTop: t.spacing(1), paddingBottom: t.spacing(1), borderBottom: j === group.sales.length - 1 ? detailBorder : "none" }}>
                                    {formatUsd(sale.transactionValue)}
                                  </td>
                                  <td style={{ ...tdStyle, paddingTop: t.spacing(1), paddingBottom: t.spacing(1), borderBottom: j === group.sales.length - 1 ? detailBorder : "none" }}>
                                    <span style={{ fontWeight: 600 }}>{formatShortDate(sale.filedDate)}</span>
                                    {sale.transactionDate.slice(0, 10) !== sale.filedDate.slice(0, 10) ? (
                                      <span style={subTextStyle}>Txn {formatShortDate(sale.transactionDate)}</span>
                                    ) : null}
                                  </td>
                                  <td style={{ ...tdStyle, paddingTop: t.spacing(1), paddingBottom: t.spacing(1), borderBottom: j === group.sales.length - 1 ? detailBorder : "none" }}>
                                    {renderFilingLinks(sale)}
                                  </td>
                                </tr>
                              ))
                            : null}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
            <footer style={tableFooterStyle}>
              <span>Filings data provided by SEC EDGAR.</span>
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
          </>
        )}
      </div>

      {/* Right rail — export & workflow */}
      <aside style={fixedRails.rightRail}>
        <div className="page-card" style={{ ...fixedRails.railPanel, gap: t.spacing(3) }}>
          <h3 style={{ ...sectionTitleStyle, marginBottom: 0 }}>Workflow</h3>

          <div style={{ display: "flex", flexDirection: "column", gap: t.spacing(2) }}>
            <div style={{ padding: t.spacing(2), borderRadius: t.radius.md, backgroundColor: t.colors.background, border: `1px solid ${t.colors.border}` }}>
              <div style={{ fontSize: "0.72rem", color: t.colors.textMuted, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 4 }}>Prospects</div>
              <div style={{ fontSize: "1.4rem", fontWeight: 700, color: t.colors.text }}>{groupedLeads.length}</div>
              {groupedLeads.length !== leads.length ? (
                <div style={{ fontSize: "0.78rem", color: t.colors.textMuted, marginTop: 4 }}>{leads.length} qualifying sales</div>
              ) : null}
            </div>
            <div style={{ padding: t.spacing(2), borderRadius: t.radius.md, backgroundColor: t.colors.background, border: `1px solid ${t.colors.border}` }}>
              <div style={{ fontSize: "0.72rem", color: t.colors.textMuted, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 4 }}>Min threshold</div>
              <div style={{ fontSize: "1rem", fontWeight: 700, color: t.colors.text }}>${minValueM}M+</div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => downloadForm4Csv(leads)}
            disabled={leads.length === 0}
            style={{
              ...primaryBtn,
              width: "100%",
              opacity: leads.length === 0 ? 0.5 : 1,
              cursor: leads.length === 0 ? "not-allowed" : "pointer",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: t.spacing(1),
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 18 }} aria-hidden>download</span>
            Export CSV
          </button>
        </div>
      </aside>
    </section>
  );
}
