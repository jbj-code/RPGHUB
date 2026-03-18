import { useState, useMemo } from "react";
import type { Theme } from "../theme";
import { PAGE_LAYOUT } from "../theme";

type ClientsProps = { theme: Theme };

type ClientStatus = "On track" | "Needs attention" | "Urgent";

type ClientTaskCategory =
  | "Capital calls"
  | "Distributions"
  | "Valuations"
  | "Bond rolls"
  | "Option maturities";

type ClientTask = {
  id: string;
  client: string;
  title: string;
  due: string;
  owner: string;
  status: ClientStatus;
  category: ClientTaskCategory;
};

const MOCK_CLIENTS = [
  { name: "Iverson Family", segment: "Top 20", aum: "$38.4M", status: "On track" as ClientStatus },
  { name: "Owl Peak Partners", segment: "OCIO", aum: "$112.0M", status: "Needs attention" as ClientStatus },
  { name: "Resolute Legacy LP", segment: "Alternatives", aum: "$24.7M", status: "On track" as ClientStatus },
  { name: "Northbridge Holdings", segment: "Core", aum: "$16.3M", status: "Urgent" as ClientStatus },
];

const MOCK_TASKS: ClientTask[] = [
  {
    id: "t1",
    client: "Iverson Family",
    title: "Fund Q3 capital call for OWL sidecar",
    due: "This week",
    owner: "Team",
    status: "Urgent",
    category: "Capital calls",
  },
  {
    id: "t2",
    client: "Owl Peak Partners",
    title: "Wire distribution from latest private credit repayment",
    due: "Next week",
    owner: "Research",
    status: "Needs attention",
    category: "Distributions",
  },
  {
    id: "t3",
    client: "Resolute Legacy LP",
    title: "Finalize YE valuation memo for core PE book",
    due: "This month",
    owner: "Desk",
    status: "On track",
    category: "Valuations",
  },
  {
    id: "t4",
    client: "Northbridge Holdings",
    title: "Roll ladder of IG bonds maturing next 60 days",
    due: "Overdue",
    owner: "Team",
    status: "Urgent",
    category: "Bond rolls",
  },
  {
    id: "t5",
    client: "Iverson Family",
    title: "Review next month’s option maturities and rolls",
    due: "Next month",
    owner: "Desk",
    status: "Needs attention",
    category: "Option maturities",
  },
];

export function Clients({ theme: t }: ClientsProps) {
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

  const cardTitleStyle: React.CSSProperties = {
    fontSize: "0.75rem",
    color: t.colors.secondary,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    marginBottom: t.spacing(3),
  };

  const chipStyle: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    padding: `${t.spacing(0.5)} ${t.spacing(1.5)}`,
    borderRadius: t.radius.sm,
    fontSize: "0.75rem",
    fontWeight: 500,
  };

  const statusToColors = (status: ClientStatus): React.CSSProperties => {
    if (status === "On track") {
      return {
        backgroundColor: "rgba(34,197,94,0.12)",
        color: t.colors.success,
      };
    }
    if (status === "Needs attention") {
      return {
        backgroundColor: "rgba(234,179,8,0.12)",
        color: "#B45309",
      };
    }
    return {
      backgroundColor: "rgba(239,68,68,0.12)",
      color: t.colors.danger,
    };
  };

  const CATEGORIES = [
    "All",
    "Capital calls",
    "Distributions",
    "Valuations",
    "Bond rolls",
    "Option maturities",
  ] as const;

  type Tab = (typeof CATEGORIES)[number];

  const [activeTab, setActiveTab] = useState<Tab>("All");

  const filteredTasks = useMemo(
    () =>
      activeTab === "All"
        ? MOCK_TASKS
        : MOCK_TASKS.filter((t) => t.category === activeTab),
    [activeTab]
  );

  return (
    <section className="clients-page" style={pageStyle}>
      <h2 style={titleStyle}>Clients</h2>
      <p style={descStyle}>
        Lightweight dashboard for **who needs what next**. Use it as a scratchpad for client to‑dos and
        ideas before they graduate into your spreadsheet or CRM.
      </p>

      {/* Top focus tabs */}
      <div style={cardStyle}>
        <h3 style={cardTitleStyle}>Focus</h3>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: t.spacing(1.5),
            marginBottom: t.spacing(2),
          }}
        >
          {CATEGORIES.map((cat) => {
            const active = activeTab === cat;
            return (
              <button
                key={cat}
                type="button"
                onClick={() => setActiveTab(cat)}
                style={{
                  padding: `${t.spacing(1)} ${t.spacing(2)}`,
                  borderRadius: 9999,
                  border: `1px solid ${
                    active ? t.colors.primary : t.colors.border
                  }`,
                  backgroundColor: active
                    ? "rgba(68,193,193,0.12)"
                    : t.colors.surface,
                  color: active ? t.colors.primary : t.colors.textMuted,
                  fontSize: "0.85rem",
                  fontWeight: active ? 600 : 500,
                  cursor: "pointer",
                }}
              >
                {cat}
              </button>
            );
          })}
        </div>
        <p
          style={{
            margin: 0,
            fontSize: "0.85rem",
            color: t.colors.textMuted,
          }}
        >
          Viewing{" "}
          <strong>
            {activeTab === "All" ? "all categories" : activeTab.toLowerCase()}
          </strong>{" "}
          across your client list.
        </p>
      </div>

      {/* Main dashboard: clients list + task board */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1.2fr) minmax(0, 1.8fr)",
          gap: t.spacing(4),
          alignItems: "flex-start",
        }}
      >
        {/* Clients list */}
        <div style={cardStyle}>
          <h3 style={cardTitleStyle}>Clients</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: t.spacing(2) }}>
            {MOCK_CLIENTS.map((c) => (
              <div
                key={c.name}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: t.spacing(2),
                  padding: t.spacing(2.5),
                  borderRadius: t.radius.md,
                  border: `1px solid ${t.colors.border}`,
                  backgroundColor: t.colors.background,
                }}
              >
                <div style={{ display: "flex", flexDirection: "column", gap: t.spacing(0.5) }}>
                  <span style={{ fontWeight: 600 }}>{c.name}</span>
                  <span style={{ fontSize: "0.8rem", color: t.colors.textMuted }}>
                    {c.segment} · {c.aum}
                  </span>
                </div>
                <span style={{ ...chipStyle, ...statusToColors(c.status) }}>{c.status}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Task board */}
        <div style={cardStyle}>
          <h3 style={cardTitleStyle}>Client tasks</h3>
          <p style={{ marginTop: 0, marginBottom: t.spacing(2), fontSize: "0.85rem", color: t.colors.textMuted }}>
            Quick view of what you’ve parked for each relationship: rolls, funding, reallocations, and notes.
          </p>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
              gap: t.spacing(2),
              marginBottom: t.spacing(2.5),
              fontSize: "0.8rem",
              color: t.colors.textMuted,
            }}
          >
            <span>Client</span>
            <span>Task</span>
            <span style={{ textAlign: "right" }}>Due / Owner</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: t.spacing(2) }}>
            {filteredTasks.map((task) => (
              <div
                key={task.id}
                style={{
                  padding: t.spacing(2.5),
                  borderRadius: t.radius.md,
                  border: `1px solid ${t.colors.border}`,
                  backgroundColor: t.colors.background,
                  display: "grid",
                  gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                  gap: t.spacing(2),
                  alignItems: "flex-start",
                }}
              >
                <div style={{ display: "flex", flexDirection: "column", gap: t.spacing(0.5) }}>
                  <span style={{ fontWeight: 600 }}>{task.client}</span>
                  <span style={{ fontSize: "0.8rem", color: t.colors.textMuted }}>
                    {MOCK_CLIENTS.find((c) => c.name === task.client)?.segment ?? "—"}
                  </span>
                </div>
                <div style={{ fontSize: "0.85rem" }}>{task.title}</div>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: t.spacing(0.5),
                    alignItems: "flex-end",
                    fontSize: "0.8rem",
                  }}
                >
                  <span style={{ color: t.colors.textMuted }}>{task.due}</span>
                  <span style={{ color: t.colors.text }}>{task.owner}</span>
                  <span style={{ ...chipStyle, ...statusToColors(task.status) }}>{task.status}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
