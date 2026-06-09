// Sourcing.tsx
// AI-assisted HNW prospect discovery for wealth management.
//
// API INTEGRATION POINTS (not yet connected):
//   Trigger events → Exa AI (exa.ai) or NewsAPI for event monitoring
//   SEC Form 4 filings → SEC EDGAR API (free, api.sec.gov/submissions)
//   Contact enrichment → Apollo.io or Hunter.io for email discovery
//   Scheduled scans → Vercel Cron (api/sourcing-scan.ts)
//   Email delivery → Resend (resend.com) for weekly digest

import { useState } from "react";
import type { Theme } from "../theme";
import { PAGE_LAYOUT } from "../theme";

type SourcingProps = { theme: Theme };

type TriggerType = "acquisition" | "ipo" | "funding" | "sec_filing" | "news";
type ProspectStatus = "new" | "draft" | "approved" | "sent" | "responded" | "qualified";
type TabId = "feed" | "prospects" | "pipeline" | "digest";

type TriggerEvent = {
  id: string;
  date: string;
  type: TriggerType;
  headline: string;
  source: string;
  estimatedValue?: string;
  prospectCount: number;
  apiSource?: string; // which API will power this
};

type Prospect = {
  id: string;
  triggerId: string;
  name: string;
  title: string;
  company: string;
  linkedinUrl?: string;
  email?: string;
  estimatedLiquidity: string;
  message: string;
  status: ProspectStatus;
  addedDate: string;
  notes?: string;
};

// --- Mock data (replace with live API calls) ---

const MOCK_TRIGGERS: TriggerEvent[] = [
  {
    id: "t1", date: "2026-05-05", type: "acquisition",
    headline: "GitHub acquires Cursor for $2.1B — 200+ employees eligible for equity payout",
    source: "TechCrunch", estimatedValue: "$2.1B", prospectCount: 4, apiSource: "Exa AI",
  },
  {
    id: "t2", date: "2026-05-03", type: "ipo",
    headline: "Databricks S-1 filing — 18 executives with $5M+ vested equity ahead of IPO",
    source: "SEC EDGAR", estimatedValue: "$43B valuation", prospectCount: 6, apiSource: "SEC EDGAR API",
  },
  {
    id: "t3", date: "2026-05-01", type: "sec_filing",
    headline: "NVDA insider sale: SVP sold $12M in shares — Form 4 filed",
    source: "SEC EDGAR", estimatedValue: "$12M transaction", prospectCount: 1, apiSource: "SEC EDGAR API",
  },
  {
    id: "t4", date: "2026-04-28", type: "funding",
    headline: "Anduril raises $2.5B Series F — 5 co-founders / early execs with large stakes",
    source: "Bloomberg", estimatedValue: "$2.5B round", prospectCount: 3, apiSource: "Exa AI",
  },
  {
    id: "t5", date: "2026-04-25", type: "news",
    headline: "SpaceX secondary share sale at $350/sh — early employees cashing out",
    source: "WSJ", estimatedValue: "~$60B implied valuation", prospectCount: 2, apiSource: "Exa AI",
  },
];

const MOCK_PROSPECTS: Prospect[] = [
  {
    id: "p1", triggerId: "t1", name: "Marcus Webb", title: "Staff Engineer",
    company: "Cursor → GitHub/Microsoft", linkedinUrl: "https://linkedin.com/in/marcuswebb",
    estimatedLiquidity: "$2–6M",
    message: `Hi Marcus,\n\nCongratulations on the GitHub acquisition — the Cursor team has built something remarkable, and it's exciting to see it recognized at this scale.\n\nI lead wealth advisory at [Firm Name], a boutique multi-family office that works exclusively with technology executives and founders navigating significant liquidity events. We specialize in the moments that matter most: tax-efficient liquidity planning, diversification strategy, and long-term wealth structuring — so the transition from equity to lasting financial security is handled thoughtfully.\n\nWould you be open to a 20-minute conversation? No pitch — just an honest discussion about what the next chapter looks like and whether our approach might be a fit.\n\nBest,\n[Your Name]`,
    status: "draft", addedDate: "2026-05-05",
  },
  {
    id: "p2", triggerId: "t1", name: "Priya Anand", title: "Head of Design",
    company: "Cursor → GitHub/Microsoft", linkedinUrl: "https://linkedin.com/in/priyaanand",
    email: "priya@cursor.sh",
    estimatedLiquidity: "$1.5–4M",
    message: `Hi Priya,\n\nThe Cursor acquisition is a testament to the product vision you and the team built — congratulations.\n\nI'm reaching out from [Firm Name], a multi-family office that helps technology leaders navigate exactly this kind of moment: translating equity gains into long-term financial security in a tax-efficient way.\n\nI'd love to connect briefly if you're thinking through your options. Happy to share how we've helped others in similar situations.\n\nBest,\n[Your Name]`,
    status: "approved", addedDate: "2026-05-05",
  },
  {
    id: "p3", triggerId: "t2", name: "David Liang", title: "VP of Engineering",
    company: "Databricks", linkedinUrl: "https://linkedin.com/in/davidliang",
    estimatedLiquidity: "$8–20M",
    message: `Hi David,\n\nWith Databricks' S-1 filing and the IPO on the horizon, I imagine you're thinking carefully about what comes next for your equity.\n\nAt [Firm Name], we specialize in pre-IPO and IPO liquidity planning — lockup strategy, 10b5-1 plan structuring, concentrated position management, and tax optimization. We've helped executives at several unicorn-to-public transitions preserve significantly more wealth than they would have otherwise.\n\nWould a brief call make sense? Happy to share specifics about our process.\n\nBest,\n[Your Name]`,
    status: "sent", addedDate: "2026-05-03",
  },
  {
    id: "p4", triggerId: "t3", name: "Jennifer Holt", title: "SVP, Product Strategy",
    company: "NVIDIA", linkedinUrl: "https://linkedin.com/in/jenniferholt",
    email: "jennifer.holt@nvidia.com",
    estimatedLiquidity: "$12M+ (recent sale)",
    message: `Hi Jennifer,\n\nI noticed your recent NVIDIA share sale — congratulations on the meaningful liquidity milestone.\n\nI lead wealth strategy at [Firm Name], a multi-family office that works with senior technology executives on exactly this kind of transition: reinvesting proceeds strategically, managing tax exposure, and building a long-term financial plan that doesn't depend entirely on a single company.\n\nIf you haven't already locked in an advisor for this, I'd welcome a brief conversation.\n\nBest,\n[Your Name]`,
    status: "new", addedDate: "2026-05-01",
  },
  {
    id: "p5", triggerId: "t4", name: "Brian Schimpf", title: "Co-Founder & CEO",
    company: "Anduril Industries",
    estimatedLiquidity: "$50M+",
    message: `Hi Brian,\n\nAnduril's Series F is a landmark — congratulations on building one of the most consequential defense technology companies of the decade.\n\nI lead a boutique multi-family office focused on founders and executives at this stage of wealth. At $2.5B raised, the complexity of your financial picture — founder equity, secondary liquidity, tax planning, estate structure — is significant. We work quietly and exclusively with a small number of clients at this level.\n\nIf you're evaluating advisory relationships, I'd welcome a confidential conversation.\n\nBest,\n[Your Name]`,
    status: "draft", addedDate: "2026-04-28",
  },
];

// --- Helpers ---

const TRIGGER_CONFIG: Record<TriggerType, { label: string; icon: string; color: string }> = {
  acquisition: { label: "Acquisition", icon: "handshake", color: "#f59e0b" },
  ipo:         { label: "IPO",         icon: "trending_up", color: "#8b5cf6" },
  funding:     { label: "Funding",     icon: "attach_money", color: "#3b82f6" },
  sec_filing:  { label: "SEC Filing",  icon: "gavel", color: "#10b981" },
  news:        { label: "News",        icon: "newspaper", color: "#6b7280" },
};

const STATUS_CONFIG: Record<ProspectStatus, { label: string; color: string; bg: string }> = {
  new:       { label: "New",       color: "#6b7280", bg: "#6b728018" },
  draft:     { label: "Draft",     color: "#f59e0b", bg: "#f59e0b18" },
  approved:  { label: "Approved",  color: "#3b82f6", bg: "#3b82f618" },
  sent:      { label: "Sent",      color: "#8b5cf6", bg: "#8b5cf618" },
  responded: { label: "Responded", color: "#10b981", bg: "#10b98118" },
  qualified: { label: "Qualified", color: "#44c1c1", bg: "#44c1c118" },
};

const PIPELINE_COLUMNS: ProspectStatus[] = ["new", "draft", "approved", "sent", "responded", "qualified"];

// --- Sub-components ---

function StatCard({ icon, value, label, t }: { icon: string; value: string | number; label: string; t: Theme }) {
  return (
    <div style={{
      flex: 1, minWidth: 110,
      backgroundColor: t.colors.surface,
      border: `1px solid ${t.colors.border}`,
      borderRadius: t.radius.md,
      padding: `${t.spacing(2.5)} ${t.spacing(3)}`,
      display: "flex", flexDirection: "column", gap: t.spacing(0.5),
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: t.spacing(1), color: t.colors.textMuted }}>
        <span className="material-symbols-outlined" style={{ fontSize: 16 }}>{icon}</span>
        <span style={{ fontSize: "0.75rem", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</span>
      </div>
      <div style={{ fontSize: "1.6rem", fontWeight: 700, color: t.colors.text, lineHeight: 1 }}>{value}</div>
    </div>
  );
}

function TriggerBadge({ type }: { type: TriggerType; t?: Theme }) {
  const cfg = TRIGGER_CONFIG[type];
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      padding: "2px 8px", borderRadius: 20, fontSize: "0.72rem", fontWeight: 600,
      backgroundColor: `${cfg.color}18`, color: cfg.color,
      border: `1px solid ${cfg.color}30`,
    }}>
      <span className="material-symbols-outlined" style={{ fontSize: 12 }}>{cfg.icon}</span>
      {cfg.label}
    </span>
  );
}

function StatusBadge({ status }: { status: ProspectStatus }) {
  const cfg = STATUS_CONFIG[status];
  return (
    <span style={{
      display: "inline-block", padding: "2px 10px", borderRadius: 20,
      fontSize: "0.72rem", fontWeight: 600,
      backgroundColor: cfg.bg, color: cfg.color,
    }}>
      {cfg.label}
    </span>
  );
}

// --- Feed tab ---

function FeedTab({ triggers, onSelectTrigger, t }: {
  triggers: TriggerEvent[];
  onSelectTrigger: (id: string) => void;
  t: Theme;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: t.spacing(2) }}>
      {/* Data sources panel */}
      <div style={{
        backgroundColor: t.colors.surface, border: `1px solid ${t.colors.border}`,
        borderRadius: t.radius.md, padding: t.spacing(3),
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: t.spacing(2) }}>
          <h3 style={{ margin: 0, fontSize: "0.85rem", fontWeight: 700, color: t.colors.text }}>
            Data Sources
          </h3>
          <span style={{ fontSize: "0.75rem", color: t.colors.textMuted }}>Connect APIs to enable automated scanning</span>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: t.spacing(1.5) }}>
          {[
            { name: "Exa AI", desc: "News + people search", icon: "travel_explore", status: "pending" },
            { name: "SEC EDGAR", desc: "Insider filings (Form 4, S-1)", icon: "gavel", status: "pending" },
            { name: "Apollo.io", desc: "Email + contact enrichment", icon: "contacts", status: "pending" },
            { name: "Crunchbase", desc: "Funding events", icon: "attach_money", status: "pending" },
          ].map((src) => (
            <div key={src.name} style={{
              display: "flex", alignItems: "center", gap: t.spacing(1.5),
              padding: `${t.spacing(1.25)} ${t.spacing(2)}`,
              backgroundColor: t.colors.background,
              border: `1px dashed ${t.colors.border}`,
              borderRadius: t.radius.sm, cursor: "pointer",
              flex: "1 1 180px",
            }}>
              <span className="material-symbols-outlined" style={{ fontSize: 16, color: t.colors.textMuted }}>{src.icon}</span>
              <div>
                <div style={{ fontSize: "0.82rem", fontWeight: 600, color: t.colors.text }}>{src.name}</div>
                <div style={{ fontSize: "0.72rem", color: t.colors.textMuted }}>{src.desc}</div>
              </div>
              <span style={{
                marginLeft: "auto", fontSize: "0.68rem", fontWeight: 600,
                color: "#f59e0b", backgroundColor: "#f59e0b15",
                padding: "1px 6px", borderRadius: 10,
              }}>Not connected</span>
            </div>
          ))}
        </div>
      </div>

      {/* Trigger events */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h3 style={{ margin: 0, fontSize: "0.85rem", fontWeight: 700, color: t.colors.text }}>
          Recent Trigger Events
        </h3>
        <button style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          padding: `${t.spacing(1)} ${t.spacing(2)}`,
          backgroundColor: t.colors.primary, color: "#fff",
          border: "none", borderRadius: t.radius.sm, cursor: "pointer",
          fontSize: "0.82rem", fontWeight: 600,
        }}>
          <span className="material-symbols-outlined" style={{ fontSize: 15 }}>bolt</span>
          Run Scan
        </button>
      </div>

      {triggers.map((ev) => {
        const cfg = TRIGGER_CONFIG[ev.type];
        return (
          <div key={ev.id} className="agent-message" style={{
            backgroundColor: t.colors.surface,
            border: `1px solid ${t.colors.border}`,
            borderRadius: t.radius.md,
            padding: t.spacing(3),
            display: "flex", alignItems: "flex-start", gap: t.spacing(3),
          }}>
            <div style={{
              width: 40, height: 40, borderRadius: t.radius.sm, flexShrink: 0,
              backgroundColor: `${cfg.color}15`, border: `1px solid ${cfg.color}30`,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <span className="material-symbols-outlined" style={{ fontSize: 18, color: cfg.color }}>{cfg.icon}</span>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: t.spacing(1.5), marginBottom: t.spacing(0.75) }}>
                <TriggerBadge type={ev.type} t={t} />
                <span style={{ fontSize: "0.75rem", color: t.colors.textMuted }}>{ev.date}</span>
                <span style={{ fontSize: "0.75rem", color: t.colors.textMuted }}>· {ev.source}</span>
                {ev.estimatedValue && (
                  <span style={{ fontSize: "0.75rem", fontWeight: 600, color: t.colors.primary }}>{ev.estimatedValue}</span>
                )}
              </div>
              <p style={{ margin: `0 0 ${t.spacing(1)}`, fontSize: "0.9rem", fontWeight: 600, color: t.colors.text, lineHeight: 1.4 }}>
                {ev.headline}
              </p>
              <div style={{ display: "flex", alignItems: "center", gap: t.spacing(2) }}>
                {ev.apiSource && (
                  <span style={{ fontSize: "0.72rem", color: t.colors.textMuted }}>
                    Source: {ev.apiSource}
                  </span>
                )}
                <span style={{ fontSize: "0.72rem", color: t.colors.secondary, fontWeight: 600 }}>
                  {ev.prospectCount} prospect{ev.prospectCount !== 1 ? "s" : ""} identified
                </span>
              </div>
            </div>
            <button
              onClick={() => onSelectTrigger(ev.id)}
              style={{
                flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 5,
                padding: `${t.spacing(1)} ${t.spacing(2)}`,
                backgroundColor: "transparent",
                color: t.colors.primary,
                border: `1px solid ${t.colors.primary}50`,
                borderRadius: t.radius.sm, cursor: "pointer",
                fontSize: "0.8rem", fontWeight: 600,
              }}
            >
              View Prospects
              <span className="material-symbols-outlined" style={{ fontSize: 14 }}>arrow_forward</span>
            </button>
          </div>
        );
      })}
    </div>
  );
}

// --- Prospects tab ---

function ProspectsTab({ prospects, triggers, filterTrigger, t }: {
  prospects: Prospect[];
  triggers: TriggerEvent[];
  filterTrigger: string | null;
  t: Theme;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [messages, setMessages] = useState<Record<string, string>>(
    Object.fromEntries(prospects.map((p) => [p.id, p.message]))
  );
  const [statuses, setStatuses] = useState<Record<string, ProspectStatus>>(
    Object.fromEntries(prospects.map((p) => [p.id, p.status]))
  );

  const filtered = filterTrigger
    ? prospects.filter((p) => p.triggerId === filterTrigger)
    : prospects;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: t.spacing(1.5) }}>
      {filtered.map((p) => {
        const trigger = triggers.find((tr) => tr.id === p.triggerId);
        const isExpanded = expanded === p.id;
        const status = statuses[p.id] ?? p.status;

        return (
          <div key={p.id} className="agent-message" style={{
            backgroundColor: t.colors.surface,
            border: `1px solid ${isExpanded ? t.colors.primary + "60" : t.colors.border}`,
            borderRadius: t.radius.md,
            overflow: "hidden",
            transition: "border-color 0.2s",
          }}>
            {/* Prospect row */}
            <div
              onClick={() => setExpanded(isExpanded ? null : p.id)}
              style={{
                padding: t.spacing(3), cursor: "pointer",
                display: "flex", alignItems: "center", gap: t.spacing(2.5),
              }}
            >
              {/* Avatar */}
              <div style={{
                width: 38, height: 38, borderRadius: "50%", flexShrink: 0,
                backgroundColor: `${t.colors.primary}20`,
                border: `1px solid ${t.colors.primary}30`,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: "0.85rem", fontWeight: 700, color: t.colors.primary,
              }}>
                {p.name.split(" ").map((n) => n[0]).join("").slice(0, 2)}
              </div>

              {/* Info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: t.spacing(1.5), flexWrap: "wrap" }}>
                  <span style={{ fontWeight: 700, fontSize: "0.93rem", color: t.colors.text }}>{p.name}</span>
                  <StatusBadge status={status} />
                  {trigger && <TriggerBadge type={trigger.type} t={t} />}
                </div>
                <div style={{ fontSize: "0.8rem", color: t.colors.textMuted, marginTop: 2 }}>
                  {p.title} · {p.company}
                </div>
              </div>

              <div style={{ textAlign: "right", flexShrink: 0 }}>
                <div style={{ fontSize: "0.85rem", fontWeight: 700, color: t.colors.secondary }}>{p.estimatedLiquidity}</div>
                <div style={{ fontSize: "0.72rem", color: t.colors.textMuted, marginTop: 2 }}>est. liquidity</div>
              </div>

              <span className="material-symbols-outlined" style={{
                fontSize: 18, color: t.colors.textMuted, flexShrink: 0,
                transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)",
                transition: "transform 0.2s",
              }}>expand_more</span>
            </div>

            {/* Expanded detail */}
            {isExpanded && (
              <div style={{ borderTop: `1px solid ${t.colors.border}`, padding: t.spacing(3) }}>
                {/* Contact row */}
                <div style={{ display: "flex", gap: t.spacing(2), marginBottom: t.spacing(2.5), flexWrap: "wrap" }}>
                  {p.linkedinUrl && (
                    <a href={p.linkedinUrl} target="_blank" rel="noopener noreferrer" style={{
                      display: "inline-flex", alignItems: "center", gap: 5,
                      fontSize: "0.8rem", color: "#0077b5", textDecoration: "none", fontWeight: 600,
                    }}>
                      <span className="material-symbols-outlined" style={{ fontSize: 14 }}>link</span>
                      LinkedIn
                    </a>
                  )}
                  {p.email ? (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: "0.8rem", color: t.colors.text }}>
                      <span className="material-symbols-outlined" style={{ fontSize: 14, color: t.colors.textMuted }}>mail</span>
                      {p.email}
                    </span>
                  ) : (
                    <span style={{
                      display: "inline-flex", alignItems: "center", gap: 5,
                      fontSize: "0.8rem", color: "#f59e0b", fontWeight: 500,
                    }}>
                      <span className="material-symbols-outlined" style={{ fontSize: 14 }}>mail</span>
                      Email not found — connect Apollo.io
                    </span>
                  )}
                </div>

                {/* Message editor */}
                <div style={{ marginBottom: t.spacing(2) }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: t.spacing(1) }}>
                    <label style={{ fontSize: "0.78rem", fontWeight: 700, color: t.colors.textMuted, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                      Personalized Outreach Message
                    </label>
                    <span style={{ fontSize: "0.72rem", color: t.colors.textMuted }}>AI-generated · edit as needed</span>
                  </div>
                  <textarea
                    value={messages[p.id] ?? p.message}
                    onChange={(e) => setMessages((prev) => ({ ...prev, [p.id]: e.target.value }))}
                    rows={12}
                    style={{
                      width: "100%", boxSizing: "border-box",
                      backgroundColor: t.colors.background,
                      border: `1px solid ${t.colors.border}`,
                      borderRadius: t.radius.sm,
                      padding: t.spacing(2), fontSize: "0.875rem",
                      color: t.colors.text, fontFamily: t.typography.fontFamily,
                      lineHeight: 1.65, resize: "vertical", outline: "none",
                    }}
                  />
                </div>

                {/* Actions */}
                <div style={{ display: "flex", gap: t.spacing(1.5), flexWrap: "wrap" }}>
                  <button
                    onClick={() => {
                      void navigator.clipboard.writeText(messages[p.id] ?? p.message);
                    }}
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 5,
                      padding: `${t.spacing(1)} ${t.spacing(2)}`,
                      backgroundColor: t.colors.background,
                      border: `1px solid ${t.colors.border}`,
                      borderRadius: t.radius.sm, cursor: "pointer",
                      fontSize: "0.8rem", color: t.colors.text, fontWeight: 500,
                    }}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 14 }}>content_copy</span>
                    Copy
                  </button>
                  <button
                    onClick={() => setStatuses((prev) => ({ ...prev, [p.id]: "approved" }))}
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 5,
                      padding: `${t.spacing(1)} ${t.spacing(2)}`,
                      backgroundColor: "#3b82f608",
                      border: "1px solid #3b82f640",
                      borderRadius: t.radius.sm, cursor: "pointer",
                      fontSize: "0.8rem", color: "#3b82f6", fontWeight: 600,
                    }}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 14 }}>check_circle</span>
                    Approve
                  </button>
                  <button
                    onClick={() => setStatuses((prev) => ({ ...prev, [p.id]: "sent" }))}
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 5,
                      padding: `${t.spacing(1)} ${t.spacing(2.5)}`,
                      backgroundColor: t.colors.primary, color: "#fff",
                      border: "none", borderRadius: t.radius.sm, cursor: "pointer",
                      fontSize: "0.8rem", fontWeight: 600,
                    }}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 14 }}>send</span>
                    Mark as Sent
                  </button>
                  {p.linkedinUrl && (
                    <a
                      href={p.linkedinUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        display: "inline-flex", alignItems: "center", gap: 5,
                        padding: `${t.spacing(1)} ${t.spacing(2)}`,
                        backgroundColor: "#0077b508",
                        border: "1px solid #0077b540",
                        borderRadius: t.radius.sm, cursor: "pointer",
                        fontSize: "0.8rem", color: "#0077b5", fontWeight: 600,
                        textDecoration: "none",
                      }}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 14 }}>open_in_new</span>
                      Open LinkedIn
                    </a>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// --- Pipeline tab ---

function PipelineTab({ prospects, t }: { prospects: Prospect[]; t: Theme }) {
  return (
    <div style={{ display: "flex", gap: t.spacing(2), overflowX: "auto", paddingBottom: t.spacing(2) }}>
      {PIPELINE_COLUMNS.map((col) => {
        const colProspects = prospects.filter((p) => p.status === col);
        const cfg = STATUS_CONFIG[col];
        return (
          <div key={col} style={{ minWidth: 220, flex: "0 0 220px" }}>
            <div style={{
              display: "flex", alignItems: "center", gap: t.spacing(1),
              marginBottom: t.spacing(1.5),
              padding: `${t.spacing(1)} ${t.spacing(1.5)}`,
              backgroundColor: cfg.bg, borderRadius: t.radius.sm,
            }}>
              <span style={{ fontWeight: 700, fontSize: "0.8rem", color: cfg.color }}>{cfg.label}</span>
              <span style={{
                marginLeft: "auto", backgroundColor: cfg.color,
                color: "#fff", borderRadius: 10, padding: "0px 7px",
                fontSize: "0.72rem", fontWeight: 700,
              }}>{colProspects.length}</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: t.spacing(1) }}>
              {colProspects.map((p) => (
                <div key={p.id} style={{
                  backgroundColor: t.colors.surface,
                  border: `1px solid ${t.colors.border}`,
                  borderRadius: t.radius.sm,
                  padding: t.spacing(2),
                }}>
                  <div style={{ fontWeight: 600, fontSize: "0.85rem", color: t.colors.text, marginBottom: 2 }}>{p.name}</div>
                  <div style={{ fontSize: "0.75rem", color: t.colors.textMuted, marginBottom: t.spacing(1) }}>
                    {p.title}
                  </div>
                  <div style={{ fontSize: "0.75rem", color: t.colors.secondary, fontWeight: 600 }}>{p.estimatedLiquidity}</div>
                </div>
              ))}
              {colProspects.length === 0 && (
                <div style={{
                  padding: t.spacing(3), textAlign: "center",
                  border: `1px dashed ${t.colors.border}`, borderRadius: t.radius.sm,
                  fontSize: "0.75rem", color: t.colors.textMuted,
                }}>Empty</div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// --- Digest tab ---

function DigestTab({ prospects, triggers, t }: {
  prospects: Prospect[];
  triggers: TriggerEvent[];
  t: Theme;
}) {
  const newThisWeek = prospects.filter((p) => p.status === "new" || p.status === "draft").length;
  const sentThisWeek = prospects.filter((p) => p.status === "sent" || p.status === "responded").length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: t.spacing(3), maxWidth: 680 }}>
      {/* Config */}
      <div style={{
        backgroundColor: t.colors.surface, border: `1px solid ${t.colors.border}`,
        borderRadius: t.radius.md, padding: t.spacing(3),
      }}>
        <h3 style={{ margin: `0 0 ${t.spacing(2)}`, fontSize: "0.9rem", fontWeight: 700, color: t.colors.text }}>
          Digest Settings
        </h3>
        <div style={{ display: "flex", flexDirection: "column", gap: t.spacing(1.5) }}>
          <div style={{ display: "flex", alignItems: "center", gap: t.spacing(2) }}>
            <label style={{ fontSize: "0.82rem", color: t.colors.textMuted, fontWeight: 500, minWidth: 120 }}>Recipient email</label>
            <input
              defaultValue="boss@firm.com"
              style={{
                flex: 1, padding: `${t.spacing(1)} ${t.spacing(1.5)}`,
                backgroundColor: t.colors.background, border: `1px solid ${t.colors.border}`,
                borderRadius: t.radius.sm, fontSize: "0.85rem",
                color: t.colors.text, fontFamily: t.typography.fontFamily, outline: "none",
              }}
            />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: t.spacing(2) }}>
            <label style={{ fontSize: "0.82rem", color: t.colors.textMuted, fontWeight: 500, minWidth: 120 }}>Frequency</label>
            <select style={{
              padding: `${t.spacing(1)} ${t.spacing(1.5)}`,
              backgroundColor: t.colors.background, border: `1px solid ${t.colors.border}`,
              borderRadius: t.radius.sm, fontSize: "0.85rem", color: t.colors.text,
              fontFamily: t.typography.fontFamily, outline: "none",
            }}>
              <option>Weekly — Monday 8am</option>
              <option>Daily — 8am</option>
              <option>Manual only</option>
            </select>
          </div>
        </div>
        <div style={{ marginTop: t.spacing(2), display: "flex", gap: t.spacing(1.5) }}>
          <button style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            padding: `${t.spacing(1)} ${t.spacing(2.5)}`,
            backgroundColor: t.colors.primary, color: "#fff",
            border: "none", borderRadius: t.radius.sm, cursor: "pointer",
            fontSize: "0.82rem", fontWeight: 600,
          }}>
            <span className="material-symbols-outlined" style={{ fontSize: 15 }}>send</span>
            Send Now — requires Resend API
          </button>
        </div>
      </div>

      {/* Preview */}
      <div style={{
        backgroundColor: t.colors.surface, border: `1px solid ${t.colors.border}`,
        borderRadius: t.radius.md, padding: t.spacing(3),
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: t.spacing(1), marginBottom: t.spacing(2.5) }}>
          <span className="material-symbols-outlined" style={{ fontSize: 16, color: t.colors.textMuted }}>preview</span>
          <h3 style={{ margin: 0, fontSize: "0.9rem", fontWeight: 700, color: t.colors.text }}>Digest Preview</h3>
        </div>
        <div style={{
          backgroundColor: t.colors.background, border: `1px solid ${t.colors.border}`,
          borderRadius: t.radius.sm, padding: t.spacing(3),
          fontSize: "0.87rem", lineHeight: 1.7, color: t.colors.text,
        }}>
          <p style={{ margin: `0 0 ${t.spacing(1.5)}`, fontWeight: 700, fontSize: "1rem" }}>
            Weekly Sourcing Digest — Week of {new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" })}
          </p>
          <p style={{ margin: `0 0 ${t.spacing(1)}`, color: t.colors.textMuted, fontSize: "0.8rem" }}>
            {triggers.length} trigger events · {prospects.length} total prospects · {newThisWeek} awaiting review · {sentThisWeek} outreaches sent
          </p>
          <hr style={{ border: "none", borderTop: `1px solid ${t.colors.border}`, margin: `${t.spacing(2)} 0` }} />
          <p style={{ margin: `0 0 ${t.spacing(1)}`, fontWeight: 700 }}>🏆 Top Prospects This Week</p>
          {prospects.filter((p) => p.status === "draft" || p.status === "new").slice(0, 3).map((p) => (
            <div key={p.id} style={{ marginBottom: t.spacing(1.5), paddingLeft: t.spacing(2), borderLeft: `3px solid ${t.colors.primary}` }}>
              <strong>{p.name}</strong> — {p.title}, {p.company}<br />
              <span style={{ color: t.colors.textMuted, fontSize: "0.8rem" }}>
                Est. liquidity: {p.estimatedLiquidity} · Status: {p.status}
              </span>
            </div>
          ))}
          <p style={{ margin: `${t.spacing(2)} 0 0`, fontSize: "0.78rem", color: t.colors.textMuted }}>
            Review and approve messages in the RPG HUB Sourcing dashboard.
          </p>
        </div>
      </div>
    </div>
  );
}

// --- Main page ---

export function Sourcing({ theme: t }: SourcingProps) {
  const [activeTab, setActiveTab] = useState<TabId>("feed");
  const [filterTrigger, setFilterTrigger] = useState<string | null>(null);

  const stats = {
    triggers: MOCK_TRIGGERS.length,
    prospects: MOCK_PROSPECTS.length,
    drafted: MOCK_PROSPECTS.filter((p) => p.status === "draft" || p.status === "approved").length,
    sent: MOCK_PROSPECTS.filter((p) => p.status === "sent" || p.status === "responded" || p.status === "qualified").length,
  };

  const tabs: { id: TabId; label: string; icon: string }[] = [
    { id: "feed",       label: "Trigger Feed",  icon: "rss_feed" },
    { id: "prospects",  label: "Prospects",     icon: "people" },
    { id: "pipeline",   label: "Pipeline",      icon: "view_kanban" },
    { id: "digest",     label: "Weekly Digest", icon: "mark_email_read" },
  ];

  const handleSelectTrigger = (id: string) => {
    setFilterTrigger(id);
    setActiveTab("prospects");
  };

  return (
    <section
      className="agent-page page-card"
      style={{
        maxWidth: PAGE_LAYOUT.maxWidth, width: "100%", margin: "0 auto",
        padding: `${t.spacing(5)} ${t.spacing(PAGE_LAYOUT.pagePaddingH)} ${t.spacing(5)}`,
        boxSizing: "border-box", fontFamily: t.typography.fontFamily, color: t.colors.text,
        border: "none", boxShadow: "none", backgroundColor: "transparent",
      }}
    >
      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        marginBottom: t.spacing(4), paddingBottom: t.spacing(3),
        borderBottom: `1px solid ${t.colors.border}`,
      }}>
        <h2 style={{
          margin: 0, fontWeight: t.typography.headingWeight,
          fontSize: "1.625rem", color: t.colors.text,
          display: "inline-flex", alignItems: "center", gap: t.spacing(2),
        }}>
          <span className="material-symbols-outlined" style={{ fontSize: "1.5rem", color: t.colors.secondary, lineHeight: 1 }} aria-hidden>
            person_search
          </span>
          Sourcing
        </h2>
        <div style={{ display: "flex", alignItems: "center", gap: t.spacing(1.5) }}>
          <span style={{
            display: "inline-block", width: 7, height: 7, borderRadius: "50%",
            backgroundColor: `${t.colors.secondary}60`,
          }} />
          <span style={{ fontSize: "0.78rem", color: t.colors.textMuted, fontWeight: 600 }}>
            HNW Prospect Discovery
          </span>
        </div>
      </div>

      {/* Stats */}
      <div style={{ display: "flex", gap: t.spacing(2), flexWrap: "wrap", marginBottom: t.spacing(4) }}>
        <StatCard icon="bolt"         value={stats.triggers}  label="Trigger Events" t={t} />
        <StatCard icon="person_add"   value={stats.prospects} label="Prospects"       t={t} />
        <StatCard icon="edit_note"    value={stats.drafted}   label="Drafts Ready"   t={t} />
        <StatCard icon="send"         value={stats.sent}      label="Outreaches Sent" t={t} />
      </div>

      {/* Tabs */}
      <div style={{
        display: "flex", gap: 0,
        borderBottom: `1px solid ${t.colors.border}`,
        marginBottom: t.spacing(3),
      }}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => {
              setActiveTab(tab.id);
              if (tab.id !== "prospects") setFilterTrigger(null);
            }}
            style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              padding: `${t.spacing(1.75)} ${t.spacing(2.5)}`,
              border: "none", background: "none", cursor: "pointer",
              fontSize: "0.85rem", fontWeight: activeTab === tab.id ? 700 : 500,
              color: activeTab === tab.id ? t.colors.primary : t.colors.textMuted,
              borderBottom: `2px solid ${activeTab === tab.id ? t.colors.primary : "transparent"}`,
              marginBottom: -1, transition: "color 0.15s, border-color 0.15s",
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 15 }}>{tab.icon}</span>
            {tab.label}
          </button>
        ))}
        {filterTrigger && activeTab === "prospects" && (
          <button
            onClick={() => setFilterTrigger(null)}
            style={{
              marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 4,
              padding: `${t.spacing(1)} ${t.spacing(1.5)}`,
              backgroundColor: `${t.colors.primary}15`, border: `1px solid ${t.colors.primary}40`,
              borderRadius: t.radius.sm, cursor: "pointer",
              fontSize: "0.75rem", color: t.colors.primary, fontWeight: 600,
              alignSelf: "center",
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 13 }}>filter_alt_off</span>
            Clear filter
          </button>
        )}
      </div>

      {/* Tab content */}
      {activeTab === "feed" && (
        <FeedTab triggers={MOCK_TRIGGERS} onSelectTrigger={handleSelectTrigger} t={t} />
      )}
      {activeTab === "prospects" && (
        <ProspectsTab
          prospects={MOCK_PROSPECTS}
          triggers={MOCK_TRIGGERS}
          filterTrigger={filterTrigger}
          t={t}
        />
      )}
      {activeTab === "pipeline" && (
        <PipelineTab prospects={MOCK_PROSPECTS} t={t} />
      )}
      {activeTab === "digest" && (
        <DigestTab prospects={MOCK_PROSPECTS} triggers={MOCK_TRIGGERS} t={t} />
      )}
    </section>
  );
}
