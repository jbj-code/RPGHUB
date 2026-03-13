import React, { useState } from "react";
import type { Theme } from "../theme";
import { PAGE_LAYOUT } from "../theme";

type RaiseAiProps = { theme: Theme };

type Holding = { name: string; investedAmount: number; moic: number };

type Fund = {
  id: string;
  name: string;
  investedAmount: number;
  moic: number;
  investments: Holding[];
};

const KEY_METRICS = [
  { label: "MOIC", full: "Multiple on Invested Capital" },
  { label: "IRR", full: "Internal Rate of Return" },
  { label: "DPI", full: "Distributions to Paid-In" },
  { label: "Total investments", full: "Total number of fund + direct positions" },
] as const;

const MOCK_FUNDS: Fund[] = [
  {
    id: "f1",
    name: "Venture Growth Fund III",
    investedAmount: 2.5,
    moic: 1.42,
    investments: [
      { name: "Company A", investedAmount: 0.8, moic: 1.65 },
      { name: "Company B", investedAmount: 1.0, moic: 1.22 },
      { name: "Company C", investedAmount: 0.7, moic: 1.51 },
    ],
  },
  {
    id: "f2",
    name: "Tech Opportunities LP",
    investedAmount: 1.2,
    moic: 0.98,
    investments: [
      { name: "Company D", investedAmount: 0.5, moic: 0.85 },
      { name: "Company E", investedAmount: 0.7, moic: 1.05 },
    ],
  },
  {
    id: "f3",
    name: "Global Equity Fund",
    investedAmount: 3.0,
    moic: 1.68,
    investments: [
      { name: "Company F", investedAmount: 1.2, moic: 1.9 },
      { name: "Company G", investedAmount: 0.9, moic: 1.45 },
      { name: "Company H", investedAmount: 0.9, moic: 1.62 },
    ],
  },
];

const OVERALL_MOCK = { moic: 1.38, irr: "18.2%", dpi: "0.24", totalInvestments: 8 };

type DirectInvestment = { id: string; name: string; investedAmount: number; moic: number };

const MOCK_DIRECT: DirectInvestment[] = [
  { id: "d1", name: "Acme Corp", investedAmount: 0.5, moic: 1.82 },
  { id: "d2", name: "Beta Inc", investedAmount: 1.25, moic: 0.94 },
  { id: "d3", name: "Gamma Ltd", investedAmount: 0.75, moic: 1.33 },
  { id: "d4", name: "Delta Holdings", investedAmount: 2.0, moic: 1.15 },
];

type SortKey = "invested" | "moic";
type SortDir = "asc" | "desc";

function formatInvested(millions: number): string {
  return "$" + Math.round(millions * 1e6).toLocaleString();
}

function getTop10CompaniesByMoic(): { name: string; moic: number }[] {
  const companies: { name: string; moic: number }[] = [];
  MOCK_FUNDS.forEach((f) => f.investments.forEach((inv) => companies.push({ name: inv.name, moic: inv.moic })));
  MOCK_DIRECT.forEach((d) => companies.push({ name: d.name, moic: d.moic }));
  return companies
    .slice()
    .sort((a, b) => b.moic - a.moic)
    .slice(0, 10);
}

export function RaiseAi({ theme: t }: RaiseAiProps) {
  const [expandedFundIds, setExpandedFundIds] = useState<Set<string>>(() => new Set());
  const [sortBy, setSortBy] = useState<SortKey | null>("moic");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [directSortBy, setDirectSortBy] = useState<SortKey | null>("moic");
  const [directSortDir, setDirectSortDir] = useState<SortDir>("desc");
  const [moicPopupOpen, setMoicPopupOpen] = useState(false);
  const top10Moic = getTop10CompaniesByMoic();

  const pageStyle: React.CSSProperties = {
    maxWidth: PAGE_LAYOUT.maxWidth,
    width: "100%",
    margin: "0 auto",
    fontFamily: t.typography.fontFamily,
    color: t.colors.text,
    minHeight: 400,
    display: "block",
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
    padding: `${t.spacing(3)} ${t.spacing(5)} ${t.spacing(5)}`,
    marginBottom: t.spacing(4),
    boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
    border: `1px solid ${t.colors.border}`,
  };

  const cardTitleStyle: React.CSSProperties = {
    fontWeight: t.typography.headingWeight,
    fontSize: "0.875rem",
    color: t.colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    marginBottom: t.spacing(3),
  };

  const metricsGridStyle: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
    gap: t.spacing(4),
  };

  const metricBoxStyle: React.CSSProperties = {
    padding: t.spacing(4),
    backgroundColor: t.colors.background,
    borderRadius: t.radius.md,
    border: `1px solid ${t.colors.border}`,
  };

  const metricBoxClickableStyle: React.CSSProperties = {
    ...metricBoxStyle,
    cursor: "pointer",
  };

  const metricLabelStyle: React.CSSProperties = {
    fontSize: "0.8rem",
    color: t.colors.textMuted,
    marginBottom: t.spacing(1),
  };

  const metricValueStyle: React.CSSProperties = {
    fontSize: "1.5rem",
    fontWeight: t.typography.headingWeight,
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
  };

  const thFundClickableStyle: React.CSSProperties = {
    ...thStyle,
    cursor: "pointer",
    userSelect: "none",
  };

  const tdStyle: React.CSSProperties = {
    padding: `${t.spacing(2)} ${t.spacing(3)}`,
    borderBottom: `1px solid ${t.colors.border}`,
    color: t.colors.text,
  };

  const sortedFunds = [...MOCK_FUNDS].sort((a, b) => {
    if (!sortBy) return 0;
    const mult = sortDir === "asc" ? 1 : -1;
    if (sortBy === "invested") return (a.investedAmount - b.investedAmount) * mult;
    return (a.moic - b.moic) * mult;
  });

  const sortedDirect = [...MOCK_DIRECT].sort((a, b) => {
    if (!directSortBy) return 0;
    const mult = directSortDir === "asc" ? 1 : -1;
    if (directSortBy === "invested") return (a.investedAmount - b.investedAmount) * mult;
    return (a.moic - b.moic) * mult;
  });

  const handleSort = (key: SortKey) => {
    if (sortBy === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortBy(key);
      setSortDir("asc");
    }
  };

  const handleDirectSort = (key: SortKey) => {
    if (directSortBy === key) setDirectSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setDirectSortBy(key);
      setDirectSortDir("asc");
    }
  };

  const thSortStyle: React.CSSProperties = {
    ...thStyle,
    textAlign: "right",
    cursor: "pointer",
    userSelect: "none",
    whiteSpace: "nowrap",
  };

  const SortArrow = ({ column, activeSortBy, activeSortDir }: { column: SortKey; activeSortBy: SortKey | null; activeSortDir: SortDir }) => {
    const active = activeSortBy === column;
    const arrowUp = active && activeSortDir === "desc";
    return (
      <span
        className="material-symbols-outlined raise-ai-sort-arrow"
        style={{
          fontSize: 18,
          verticalAlign: "middle",
          marginLeft: 4,
          color: t.colors.textMuted,
          opacity: active ? 1 : 0.6,
          transform: arrowUp ? "rotate(180deg)" : "none",
          display: "inline-block",
          userSelect: "none",
          pointerEvents: "none",
        }}
        aria-hidden
      >
        expand_more
      </span>
    );
  };

  const keyMetricValues = [
    OVERALL_MOCK.moic.toFixed(2) + "x",
    OVERALL_MOCK.irr,
    OVERALL_MOCK.dpi,
    String(OVERALL_MOCK.totalInvestments),
  ];

  return (
    <section className="raise-ai-page" style={pageStyle}>
      <h2 style={titleStyle}>Raise.ai</h2>
      <p style={descStyle}>
        Our personal fund — fund of funds plus direct investments. Summary below; expand a fund to see its holdings.
      </p>

      {/* Key metrics — overall summary */}
      <div className="page-card" style={cardStyle}>
        <h3 style={cardTitleStyle}>Summary</h3>
        <div style={metricsGridStyle}>
          {KEY_METRICS.map(({ label, full }, i) => (
            <div
              key={label}
              style={label === "MOIC" ? metricBoxClickableStyle : metricBoxStyle}
              onClick={label === "MOIC" ? () => setMoicPopupOpen(true) : undefined}
              role={label === "MOIC" ? "button" : undefined}
              tabIndex={label === "MOIC" ? 0 : undefined}
              onKeyDown={label === "MOIC" ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setMoicPopupOpen(true); } } : undefined}
            >
              <div style={metricLabelStyle} title={full}>
                {label}
              </div>
              <div style={metricValueStyle}>{keyMetricValues[i]}</div>
            </div>
          ))}
        </div>
      </div>

      {/* MOIC top 10 popup */}
      {moicPopupOpen && (
        <div
          className="raise-ai-moic-popup-backdrop"
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(0,0,0,0.4)",
            zIndex: 1000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: t.spacing(4),
          }}
          onClick={() => setMoicPopupOpen(false)}
        >
          <div
            style={{
              backgroundColor: t.colors.surface,
              borderRadius: t.radius.lg,
              border: `1px solid ${t.colors.border}`,
              boxShadow: "0 8px 32px rgba(0,0,0,0.2)",
              maxWidth: 400,
              width: "100%",
              maxHeight: "80vh",
              overflow: "auto",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ padding: t.spacing(4), borderBottom: `1px solid ${t.colors.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ margin: 0, fontSize: "1.125rem", fontWeight: t.typography.headingWeight, color: t.colors.text }}>
                Top 10 MOIC — companies
              </h3>
              <button
                type="button"
                className="material-symbols-outlined"
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  padding: 4,
                  color: t.colors.textMuted,
                  fontSize: 24,
                }}
                onClick={() => setMoicPopupOpen(false)}
                aria-label="Close"
              >
                close
              </button>
            </div>
            <ul style={{ margin: 0, padding: t.spacing(2), listStyle: "none" }}>
              {top10Moic.map((c, i) => (
                <li
                  key={`${c.name}-${i}`}
                  style={{
                    padding: `${t.spacing(2)} ${t.spacing(3)}`,
                    borderBottom: i < top10Moic.length - 1 ? `1px solid ${t.colors.border}` : "none",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <span style={{ fontWeight: t.typography.headingWeight, color: t.colors.text }}>{c.name}</span>
                  <span style={{ color: t.colors.primary, fontWeight: 600 }}>{Math.round(c.moic * 100) / 100}x</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* Fund investments — expandable, sortable */}
      <div className="page-card" style={cardStyle}>
        <h3 style={cardTitleStyle}>Fund investments</h3>

        <div style={tableWrapStyle}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th
                  style={thFundClickableStyle}
                  onClick={() => {
                    if (expandedFundIds.size === MOCK_FUNDS.length) {
                      setExpandedFundIds(new Set());
                    } else {
                      setExpandedFundIds(new Set(MOCK_FUNDS.map((f) => f.id)));
                    }
                  }}
                >
                  Fund
                </th>
                <th style={{ ...thSortStyle, minWidth: 120 }} onClick={(e) => { e.preventDefault(); handleSort("invested"); }}>
                  Invested <SortArrow column="invested" activeSortBy={sortBy} activeSortDir={sortDir} />
                </th>
                <th style={{ ...thSortStyle, minWidth: 80 }} onClick={(e) => { e.preventDefault(); handleSort("moic"); }}>
                  MOIC <SortArrow column="moic" activeSortBy={sortBy} activeSortDir={sortDir} />
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedFunds.map((fund) => {
                const isExpanded = expandedFundIds.has(fund.id);
                return (
                  <React.Fragment key={fund.id}>
                    <tr
                      style={{ backgroundColor: t.colors.surface, cursor: "pointer", outline: "none" }}
                      onClick={() => {
                        setExpandedFundIds((prev) => {
                          const next = new Set(prev);
                          if (next.has(fund.id)) next.delete(fund.id);
                          else next.add(fund.id);
                          return next;
                        });
                      }}
                      tabIndex={-1}
                    >
                      <td style={{ ...tdStyle, fontWeight: t.typography.headingWeight }}>
                        {fund.name}
                      </td>
                      <td style={{ ...tdStyle, textAlign: "right" as const }}>{formatInvested(fund.investedAmount)}</td>
                      <td style={{ ...tdStyle, textAlign: "right" as const, fontWeight: 600 }}>{Math.round(fund.moic * 100) / 100}x</td>
                    </tr>
                    {isExpanded &&
                      fund.investments.map((inv, j) => (
                        <tr key={`${fund.id}-${j}`} style={{ backgroundColor: t.colors.background }} onClick={(e) => e.stopPropagation()}>
                          <td style={{ ...tdStyle, paddingLeft: t.spacing(6), color: t.colors.textMuted }}>
                            {inv.name}
                          </td>
                          <td style={{ ...tdStyle, textAlign: "right" as const }}>{formatInvested(inv.investedAmount)}</td>
                          <td style={{ ...tdStyle, textAlign: "right" as const }}>{Math.round(inv.moic * 100) / 100}x</td>
                        </tr>
                      ))}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Direct investments */}
      <div className="page-card" style={cardStyle}>
        <h3 style={cardTitleStyle}>Direct investments</h3>
        <div style={tableWrapStyle}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Company</th>
                <th style={{ ...thSortStyle, minWidth: 120 }} onClick={(e) => { e.preventDefault(); handleDirectSort("invested"); }}>
                  Invested <SortArrow column="invested" activeSortBy={directSortBy} activeSortDir={directSortDir} />
                </th>
                <th style={{ ...thSortStyle, minWidth: 80 }} onClick={(e) => { e.preventDefault(); handleDirectSort("moic"); }}>
                  MOIC <SortArrow column="moic" activeSortBy={directSortBy} activeSortDir={directSortDir} />
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedDirect.map((inv) => (
                <tr key={inv.id} style={{ backgroundColor: t.colors.surface }}>
                  <td style={{ ...tdStyle, fontWeight: t.typography.headingWeight }}>{inv.name}</td>
                  <td style={{ ...tdStyle, textAlign: "right" as const }}>{formatInvested(inv.investedAmount)}</td>
                  <td style={{ ...tdStyle, textAlign: "right" as const, fontWeight: 600 }}>{Math.round(inv.moic * 100) / 100}x</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
