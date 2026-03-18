import React, { useState, useEffect } from "react";
import type { Theme } from "../theme";
import {
  getPrimaryButtonStyle,
  PAGE_LAYOUT,
  getDropdownTriggerStyle,
  getDropdownPanelStyle,
  getDropdownOptionStyle,
  THEME_DROPDOWN_OPTION_CLASS,
} from "../theme";
import { SIDEBAR_WIDTH } from "../components/NavBar";

const CLIENT_LIST_WIDTH = 200;
const ADD_BAR_HEIGHT = 64;

type TodosProps = { theme: Theme; sidebarWidth?: number };

type TodoStatus = "not-started" | "in-progress" | "waiting" | "done";
type ClientId = "client-1" | "client-2" | "client-3" | "client-4" | "";
type EmployeeId = "employee-1" | "employee-2" | "employee-3" | "employee-4" | "";

type TodoSubtask = {
  id: string;
  text: string;
  done: boolean;
};

type TodoItem = {
  id: string;
  header: string;
  description: string;
  done: boolean;
  createdAt: number;
  clientId: ClientId;
  assigneeId: EmployeeId;
  status: TodoStatus;
  dueAt?: string; // YYYY-MM-DD or ISO
  linkUrl?: string;
  linkLabel?: string;
  subtasks: TodoSubtask[];
};

const STORAGE_KEY = "rpg-hub-todos";

const CLIENTS: { id: ClientId; label: string; color: string }[] = [
  { id: "", label: "Unassigned", color: "#9ca3af" },
  { id: "client-1", label: "Client 1", color: "#3b82f6" },
  { id: "client-2", label: "Client 2", color: "#22c55e" },
  { id: "client-3", label: "Client 3", color: "#f97316" },
  { id: "client-4", label: "Client 4", color: "#ec4899" },
];

const EMPLOYEES: { id: EmployeeId; label: string; initials: string; color: string }[] = [
  { id: "", label: "Unassigned", initials: "—", color: "#9ca3af" },
  { id: "employee-1", label: "Employee 1", initials: "E1", color: "#3b82f6" },
  { id: "employee-2", label: "Employee 2", initials: "E2", color: "#22c55e" },
  { id: "employee-3", label: "Employee 3", initials: "E3", color: "#f97316" },
  { id: "employee-4", label: "Employee 4", initials: "E4", color: "#ec4899" },
];

const STATUS_OPTIONS: { id: TodoStatus; label: string; color: string }[] = [
  { id: "not-started", label: "Not started", color: "#6b7280" },
  { id: "in-progress", label: "In progress", color: "#2563eb" },
  { id: "waiting", label: "Waiting", color: "#eab308" },
  { id: "done", label: "Done", color: "#16a34a" },
];

/** Pills for "normal to dos" Google Docs — replace # with your doc URLs. */
const DOC_PILLS: { label: string; url: string }[] = [
  { label: "Client list", url: "#" },
  { label: "RPG To-Dos", url: "#" },
  { label: "Bond maturities", url: "#" },
  { label: "Options expiry", url: "#" },
];

const GOOGLE_FAVICONS: Record<string, string> = {
  document: "https://www.gstatic.com/images/branding/product/1x/docs_2020q4_48dp.png",
  spreadsheet: "https://www.gstatic.com/images/branding/product/1x/sheets_2020q4_48dp.png",
  presentation: "https://www.gstatic.com/images/branding/product/1x/slides_2020q4_48dp.png",
  drive: "https://www.gstatic.com/images/branding/product/1x/drive_2020q4_48dp.png",
};

function loadTodos(): TodoItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed.map((item: any) => {
      const header =
        typeof item.header === "string" && item.header.trim()
          ? item.header
          : String(item.text ?? "").trim();
      const description = typeof item.description === "string" ? item.description : "";
      const clientId: ClientId =
        (["client-1", "client-2", "client-3", "client-4"].includes(item.clientId)
          ? item.clientId
          : "") as ClientId;
      const status: TodoStatus =
        ["not-started", "in-progress", "waiting", "done"].includes(item.status)
          ? (item.status as TodoStatus)
          : item.done
          ? "done"
          : "not-started";
      const dueAt =
        typeof item.dueAt === "string" && item.dueAt.length >= 10
          ? item.dueAt
          : typeof item.dueDate === "string" && item.dueDate.length >= 8
            ? `${item.dueDate}T23:59:00`
            : undefined;
      const linkUrl = typeof item.linkUrl === "string" && item.linkUrl.trim() ? item.linkUrl.trim() : undefined;
      const linkLabel = typeof item.linkLabel === "string" ? item.linkLabel.trim() : undefined;
      const assigneeId: EmployeeId =
        (["employee-1", "employee-2", "employee-3", "employee-4"].includes(item.assigneeId)
          ? item.assigneeId
          : "") as EmployeeId;
      const rawSubtasks = item.subtasks;
      const subtasks: TodoSubtask[] = Array.isArray(rawSubtasks)
        ? rawSubtasks.map((st: any) => ({
            id: String(st?.id ?? crypto.randomUUID()),
            text: String(st?.text ?? "").trim(),
            done: Boolean(st?.done),
          }))
        : [];

      return {
        id: String(item.id ?? crypto.randomUUID()),
        header,
        description,
        done: Boolean(item.done),
        createdAt: typeof item.createdAt === "number" ? item.createdAt : Date.now(),
        clientId,
        assigneeId,
        status,
        dueAt,
        linkUrl,
        linkLabel: linkLabel || undefined,
        subtasks,
      };
    });
  } catch {
    return [];
  }
}

function saveTodos(items: TodoItem[]) {
  try {
    const payload = items.map((item) => ({
      id: item.id,
      header: item.header,
      description: item.description,
      done: item.done,
      createdAt: item.createdAt,
      clientId: item.clientId,
      assigneeId: item.assigneeId,
      status: item.status,
      dueAt: item.dueAt,
      linkUrl: item.linkUrl,
      linkLabel: item.linkLabel,
      subtasks: item.subtasks,
    }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // ignore
  }
}

export function Todos({ theme: t, sidebarWidth = SIDEBAR_WIDTH }: TodosProps) {
  const [items, setItems] = useState<TodoItem[]>(loadTodos);
  const [headerInput, setHeaderInput] = useState("");
  const [descriptionInput, setDescriptionInput] = useState("");
  const [clientIdInput, setClientIdInput] = useState<ClientId>("");
  const [assigneeIdInput, setAssigneeIdInput] = useState<EmployeeId>("");
  const [dueDateInput, setDueDateInput] = useState("");
  const [linkUrlInput, setLinkUrlInput] = useState("");
  const [linkLabelInput, setLinkLabelInput] = useState("");
  const [clientFilter, setClientFilter] = useState<ClientId | "all">("all");
  const [viewingMonth, setViewingMonth] = useState(() => new Date());
  const [clientsCollapsed, setClientsCollapsed] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [clientDropdownOpen, setClientDropdownOpen] = useState(false);
  const [employeeDropdownOpen, setEmployeeDropdownOpen] = useState(false);
  const [subtaskInputByParent, setSubtaskInputByParent] = useState<Record<string, string>>({});

  useEffect(() => {
    saveTodos(items);
  }, [items]);

  const taskCountByClient = (() => {
    const map: Record<string, number> = {};
    CLIENTS.forEach((c) => {
      map[c.id || "unassigned"] = items.filter((i) => i.clientId === c.id).length;
    });
    return map;
  })();

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
    backgroundColor: t.mode === "light" ? "#ffffff" : t.colors.surface,
    borderRadius: t.radius.lg,
    padding: t.spacing(4),
    marginBottom: t.spacing(4),
    boxShadow: t.mode === "light" ? "0 2px 8px rgba(0,0,0,0.06)" : "0 2px 8px rgba(0,0,0,0.2)",
    border: `1px solid ${t.colors.border}`,
  };

  const cardTitleStyle: React.CSSProperties = {
    fontSize: "0.75rem",
    color: t.colors.secondary,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    marginBottom: t.spacing(3),
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    maxWidth: 360,
    padding: `${t.spacing(2)} ${t.spacing(3)}`,
    fontSize: t.typography.baseFontSize,
    border: `1px solid ${t.colors.border}`,
    borderRadius: t.radius.md,
    backgroundColor: t.colors.surface,
    color: t.colors.text,
  };

  const buttonStyle = getPrimaryButtonStyle(t);

  const selectStyle: React.CSSProperties = {
    padding: `${t.spacing(2)} ${t.spacing(3)}`,
    fontSize: t.typography.baseFontSize,
    border: `1px solid ${t.colors.border}`,
    borderRadius: t.radius.md,
    backgroundColor: t.colors.surface,
    color: t.colors.text,
  };

  const secondaryTextStyle: React.CSSProperties = {
    fontSize: "0.8rem",
    color: t.colors.textMuted,
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

  const activeItems = items.filter((i) => !i.done);

  const upcomingItems = activeItems
    .filter((i) => i.dueAt)
    .sort((a, b) => (a.dueAt! < b.dueAt! ? -1 : a.dueAt! > b.dueAt! ? 1 : 0))
    .slice(0, 5);

  const summaryItems = upcomingItems.length > 0 ? upcomingItems : activeItems.slice(0, 5);

  const filteredItems =
    clientFilter === "all"
      ? items
      : items.filter((i) => i.clientId === clientFilter);

  function addTodo() {
    const header = headerInput.trim();
    if (!header) return;
    const description = descriptionInput.trim();
    const linkUrl = linkUrlInput.trim() || undefined;
    const linkLabel = linkLabelInput.trim() || undefined;
    const dueAt = dueDateInput ? dueDateInput : undefined;
    setItems((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        header,
        description,
        done: false,
        createdAt: Date.now(),
        clientId: clientIdInput,
        assigneeId: assigneeIdInput,
        status: "not-started",
        dueAt,
        linkUrl,
        linkLabel,
        subtasks: [],
      },
    ]);
    setHeaderInput("");
    setDescriptionInput("");
    setClientIdInput("");
    setAssigneeIdInput("");
    setDueDateInput("");
    setLinkUrlInput("");
    setLinkLabelInput("");
  }

  function toggleTodo(id: string) {
    setItems((prev) =>
      prev.map((item) =>
        item.id === id
          ? {
              ...item,
              done: !item.done,
              status: !item.done ? "done" : "not-started",
            }
          : item
      )
    );
  }

  function removeTodo(id: string) {
    setItems((prev) => prev.filter((item) => item.id !== id));
  }

  function setStatus(id: string, status: TodoStatus) {
    setItems((prev) =>
      prev.map((item) =>
        item.id === id
          ? {
              ...item,
              status,
              done: status === "done",
            }
          : item
      )
    );
  }

  function formatDueLabel(dueAt?: string) {
    if (!dueAt) return "No due date";
    try {
      const d = new Date(dueAt);
      return d.toLocaleDateString(undefined, {
        month: "short",
        day: "2-digit",
        year: "numeric",
      });
    } catch {
      return dueAt;
    }
  }

  function addSubtask(parentId: string, text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    setItems((prev) =>
      prev.map((item) =>
        item.id === parentId
          ? {
              ...item,
              subtasks: [
                ...item.subtasks,
                { id: crypto.randomUUID(), text: trimmed, done: false },
              ],
            }
          : item
      )
    );
    setSubtaskInputByParent((p) => ({ ...p, [parentId]: "" }));
  }

  function toggleSubtask(parentId: string, subtaskId: string) {
    setItems((prev) =>
      prev.map((item) =>
        item.id === parentId
          ? {
              ...item,
              subtasks: item.subtasks.map((st) =>
                st.id === subtaskId ? { ...st, done: !st.done } : st
              ),
            }
          : item
      )
    );
  }

  function removeSubtask(parentId: string, subtaskId: string) {
    setItems((prev) =>
      prev.map((item) =>
        item.id === parentId
          ? {
              ...item,
              subtasks: item.subtasks.filter((st) => st.id !== subtaskId),
            }
          : item
      )
    );
  }

  type GoogleLinkType = "document" | "spreadsheet" | "presentation" | "drive" | null;
  function getGoogleLinkType(url: string): GoogleLinkType {
    try {
      const u = new URL(url);
      const host = u.hostname.toLowerCase();
      const path = u.pathname.toLowerCase();
      if (host.includes("docs.google.com")) {
        if (path.includes("/document/")) return "document";
        if (path.includes("/spreadsheets/")) return "spreadsheet";
        if (path.includes("/presentation/")) return "presentation";
      }
      if (host.includes("drive.google.com")) return "drive";
      return null;
    } catch {
      return null;
    }
  }

  function getLinkDisplay(item: TodoItem): { faviconUrl: string | null; label: string } {
    if (!item.linkUrl) return { faviconUrl: null, label: "Open link" };
    const type = getGoogleLinkType(item.linkUrl);
    const faviconUrl = type ? GOOGLE_FAVICONS[type] ?? null : null;
    const label =
      item.linkLabel ||
      (type === "document"
        ? "Google Doc"
        : type === "spreadsheet"
          ? "Google Sheet"
          : type === "presentation"
            ? "Google Slides"
            : type === "drive"
              ? "Google Drive"
              : "Open link");
    if (!faviconUrl && type === null) {
      try {
        const domain = new URL(item.linkUrl).hostname;
        return {
          faviconUrl: `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=32`,
          label: item.linkLabel || "Open link",
        };
      } catch {
        return { faviconUrl: null, label: "Open link" };
      }
    }
    return { faviconUrl, label };
  }

  function prevMonth() {
    setViewingMonth((d) => {
      const next = new Date(d.getFullYear(), d.getMonth() - 1);
      return next;
    });
  }
  function nextMonth() {
    setViewingMonth((d) => {
      const next = new Date(d.getFullYear(), d.getMonth() + 1);
      return next;
    });
  }
  const monthTitle = viewingMonth.toLocaleString(undefined, { month: "long" }) + " To-Dos";
  const addBarLeft = sidebarWidth + CLIENT_LIST_WIDTH;

  return (
    <div className="todos-page" style={{ display: "flex", width: "100%", minHeight: "100vh" }}>
      {/* Client list — left of content, no gap from nav */}
      <aside
        style={{
          width: CLIENT_LIST_WIDTH,
          flexShrink: 0,
          borderRight: `1px solid ${t.colors.border}`,
          backgroundColor: t.colors.surface,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <button
          type="button"
          onClick={() => setClientsCollapsed((c) => !c)}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            width: "100%",
            padding: `${t.spacing(3)} ${t.spacing(3)}`,
            border: "none",
            background: "none",
            cursor: "pointer",
            color: t.colors.text,
            fontFamily: t.typography.fontFamily,
            fontSize: "0.75rem",
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.04em",
          }}
        >
          Clients
          <span className="material-symbols-outlined" style={{ fontSize: 20, transform: clientsCollapsed ? "rotate(-90deg)" : "rotate(0deg)" }}>
            expand_more
          </span>
        </button>
        {!clientsCollapsed && (
          <nav style={{ flex: 1, overflowY: "auto", padding: `0 ${t.spacing(2)} ${t.spacing(2)}` }}>
            <button
              type="button"
              className="todos-client-list-item"
              onClick={() => setClientFilter("all")}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                width: "100%",
                padding: `${t.spacing(2)} ${t.spacing(2)}`,
                border: "none",
                background: clientFilter === "all" ? t.colors.background : "transparent",
                borderRadius: t.radius.sm,
                cursor: "pointer",
                color: t.colors.text,
                fontFamily: t.typography.fontFamily,
                fontSize: "0.875rem",
                textAlign: "left",
              }}
            >
              All
              <span style={{ ...secondaryTextStyle, marginLeft: t.spacing(1) }}>{items.length}</span>
            </button>
            {CLIENTS.map((c) => {
              const key = c.id || "unassigned";
              const count = taskCountByClient[key] ?? 0;
              const isSelected = clientFilter === c.id;
              return (
                <button
                  key={key}
                  type="button"
                  className="todos-client-list-item"
                  onClick={() => setClientFilter(c.id)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    width: "100%",
                    padding: `${t.spacing(2)} ${t.spacing(2)}`,
                    border: "none",
                    background: isSelected ? t.colors.background : "transparent",
                    borderRadius: t.radius.sm,
                    cursor: "pointer",
                    color: t.colors.text,
                    fontFamily: t.typography.fontFamily,
                    fontSize: "0.875rem",
                    textAlign: "left",
                  }}
                >
                  <span style={{ display: "flex", alignItems: "center", gap: t.spacing(1) }}>
                    <span style={{ width: 8, height: 8, borderRadius: "999px", backgroundColor: c.color, flexShrink: 0 }} />
                    {c.label}
                  </span>
                  <span style={{ ...secondaryTextStyle, marginLeft: t.spacing(1) }}>{count}</span>
                </button>
              );
            })}
          </nav>
        )}
      </aside>

      {/* Main content */}
      <section style={{ flex: 1, minWidth: 0, padding: t.spacing(6), paddingBottom: ADD_BAR_HEIGHT + t.spacing(6), ...pageStyle }}>
      <h2 style={titleStyle}>{monthTitle}</h2>

      {/* Month nav + doc pills */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: t.spacing(3),
          marginBottom: t.spacing(5),
          flexWrap: "wrap",
        }}
      >
        <button
          type="button"
          className="todos-month-arrow"
          onClick={prevMonth}
          style={{
            padding: t.spacing(1.5),
            border: "none",
            borderRadius: t.radius.sm,
            background: "transparent",
            color: t.colors.textMuted,
            cursor: "pointer",
          }}
          aria-label="Previous month"
        >
          <span className="material-symbols-outlined" style={{ fontSize: 28 }}>
            chevron_left
          </span>
        </button>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: t.spacing(2),
            flexWrap: "wrap",
            justifyContent: "center",
            flex: 1,
          }}
        >
          {DOC_PILLS.map((pill) => (
            <a
              key={pill.label}
              href={pill.url}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: t.spacing(1.5),
                padding: `${t.spacing(1.5)} ${t.spacing(3)}`,
                borderRadius: t.radius.full,
                border: `1px solid ${t.colors.border}`,
                backgroundColor: t.colors.surface,
                color: t.colors.text,
                fontSize: "0.875rem",
                textDecoration: "none",
              }}
            >
              <img
                src="https://www.gstatic.com/images/branding/product/1x/docs_2020q4_48dp.png"
                alt=""
                width={20}
                height={20}
                style={{ display: "block" }}
              />
              {pill.label}
            </a>
          ))}
        </div>

        <button
          type="button"
          className="todos-month-arrow"
          onClick={nextMonth}
          style={{
            padding: t.spacing(1.5),
            border: "none",
            borderRadius: t.radius.sm,
            background: "transparent",
            color: t.colors.textMuted,
            cursor: "pointer",
          }}
          aria-label="Next month"
        >
          <span className="material-symbols-outlined" style={{ fontSize: 28 }}>
            chevron_right
          </span>
        </button>
      </div>

      {/* Next up — single card full width */}
      <div className="page-card" style={{ ...cardStyle, marginBottom: t.spacing(4) }}>
        <h3 style={cardTitleStyle}>Next up</h3>
        {summaryItems.length === 0 ? (
          <p style={{ color: t.colors.textMuted, fontSize: "0.9rem" }}>
            No open items yet. Use the bar at the bottom to add tasks and set due dates.
          </p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {summaryItems.map((item) => {
              const clientMeta = CLIENTS.find((c) => c.id === item.clientId) ?? CLIENTS[0];
              return (
                <li
                  key={item.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: t.spacing(2),
                    padding: `${t.spacing(1.5)} ${t.spacing(0)}`,
                    borderBottom: `1px solid ${t.colors.border}`,
                  }}
                >
                  <div style={{ display: "flex", flexDirection: "column", gap: t.spacing(0.5) }}>
                    <div style={{ display: "flex", alignItems: "center", gap: t.spacing(1.5) }}>
                      <span
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: "999px",
                          backgroundColor: clientMeta.color,
                        }}
                      />
                      <span style={{ ...secondaryTextStyle, fontWeight: t.typography.headingWeight }}>
                        {clientMeta.label}
                      </span>
                    </div>
                    <span
                      style={{
                        fontWeight: t.typography.headingWeight,
                        color: t.colors.text,
                      }}
                    >
                      {item.header}
                    </span>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={secondaryTextStyle}>Due {formatDueLabel(item.dueAt)}</div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Tasks section: header row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: t.spacing(3),
          marginBottom: t.spacing(3),
          flexWrap: "wrap",
        }}
      >
        <h3 style={{ ...cardTitleStyle, marginBottom: 0 }}>Tasks</h3>
        <span style={secondaryTextStyle}>
          {activeItems.length} open / {items.length} total
        </span>
      </div>

      {filteredItems.length === 0 ? (
        <p
          style={{
            color: t.colors.textMuted,
            fontSize: "0.9rem",
            padding: t.spacing(4),
            border: `1px dashed ${t.colors.border}`,
            borderRadius: t.radius.md,
            backgroundColor: t.colors.background,
          }}
        >
          No items match this filter. Use the bar at the bottom to add a task.
        </p>
      ) : (
        <div className="todos-spreadsheet-wrap" style={{ overflowX: "auto", borderRadius: t.radius.md, border: `1px solid ${t.colors.border}`, backgroundColor: t.mode === "light" ? "#ffffff" : t.colors.surface }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem", fontFamily: t.typography.fontFamily }}>
            <thead>
              <tr>
                <th style={thStyle}>Task</th>
                <th style={{ ...thStyle, whiteSpace: "nowrap" }}>Assignee</th>
                <th style={{ ...thStyle, whiteSpace: "nowrap" }}>Due Date</th>
                <th style={{ ...thStyle, whiteSpace: "nowrap" }}>Status</th>
                <th style={{ ...thStyle, width: 48 }} />
              </tr>
            </thead>
            <tbody>
              {filteredItems.map((item) => {
                const employeeMeta = EMPLOYEES.find((e) => e.id === item.assigneeId) ?? EMPLOYEES[0];
                const statusMeta = STATUS_OPTIONS.find((s) => s.id === item.status) ?? STATUS_OPTIONS[0];
                const linkDisplay = item.linkUrl ? getLinkDisplay(item) : null;
                const isExpanded = expandedId === item.id;
                const subtaskInput = subtaskInputByParent[item.id] ?? "";
                return (
                  <React.Fragment key={item.id}>
                    <tr
                      className="todos-task-row"
                      style={{
                        backgroundColor: t.mode === "light" ? "#ffffff" : t.colors.surface,
                        borderBottom: `1px solid ${t.colors.border}`,
                      }}
                    >
                      <td style={{ padding: `${t.spacing(2)} ${t.spacing(3)}`, verticalAlign: "middle" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: t.spacing(2), minWidth: 0 }}>
                          <button
                            type="button"
                            onClick={() => toggleTodo(item.id)}
                            style={{
                              padding: 0,
                              border: "none",
                              background: "none",
                              cursor: "pointer",
                              color: item.done ? t.colors.success : t.colors.textMuted,
                              flexShrink: 0,
                            }}
                            aria-label={item.done ? "Mark incomplete" : "Mark done"}
                          >
                            <span className="material-symbols-outlined" style={{ fontSize: 20 }}>
                              {item.done ? "check_circle" : "radio_button_unchecked"}
                            </span>
                          </button>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 500, color: item.done ? t.colors.textMuted : t.colors.text, textDecoration: item.done ? "line-through" : "none" }}>
                              {item.header}
                            </div>
                            {linkDisplay && item.linkUrl && (
                              <a
                                href={item.linkUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="todos-task-link"
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: t.spacing(0.5),
                                  marginTop: t.spacing(0.5),
                                  fontSize: "0.75rem",
                                  color: t.colors.textMuted,
                                  textDecoration: "none",
                                }}
                              >
                                {linkDisplay.faviconUrl ? (
                                  <img src={linkDisplay.faviconUrl} alt="" width={14} height={14} style={{ display: "block" }} />
                                ) : (
                                  <span className="material-symbols-outlined" style={{ fontSize: 14 }}>link</span>
                                )}
                                {linkDisplay.label}
                              </a>
                            )}
                          </div>
                        </div>
                      </td>
                      <td style={{ padding: `${t.spacing(2)} ${t.spacing(3)}`, verticalAlign: "middle" }}>
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            width: 28,
                            height: 28,
                            borderRadius: "999px",
                            backgroundColor: employeeMeta.color,
                            color: "#fff",
                            fontSize: "0.7rem",
                            fontWeight: 600,
                          }}
                        >
                          {employeeMeta.initials}
                        </span>
                      </td>
                      <td style={{ padding: `${t.spacing(2)} ${t.spacing(3)}`, verticalAlign: "middle", fontSize: "0.875rem", color: t.colors.text }}>
                        {formatDueLabel(item.dueAt)}
                      </td>
                      <td style={{ padding: `${t.spacing(2)} ${t.spacing(3)}`, verticalAlign: "middle" }}>
                        <select
                          value={item.status}
                          onChange={(e) => setStatus(item.id, e.target.value as TodoStatus)}
                          style={{
                            padding: `${t.spacing(0.5)} ${t.spacing(2)}`,
                            fontSize: "0.75rem",
                            fontWeight: 600,
                            border: "none",
                            borderRadius: t.radius.full,
                            backgroundColor: `${statusMeta.color}22`,
                            color: statusMeta.color,
                            cursor: "pointer",
                            fontFamily: "inherit",
                          }}
                        >
                          {STATUS_OPTIONS.map((s) => (
                            <option key={s.id} value={s.id}>{s.label}</option>
                          ))}
                        </select>
                      </td>
                      <td style={{ padding: t.spacing(2), verticalAlign: "middle" }}>
                        <button
                          type="button"
                          onClick={() => setExpandedId(isExpanded ? null : item.id)}
                          style={{
                            padding: t.spacing(0.5),
                            border: "none",
                            background: "none",
                            cursor: "pointer",
                            color: t.colors.textMuted,
                            transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)",
                            transition: "transform 0.2s ease",
                          }}
                          aria-label={isExpanded ? "Collapse" : "Expand"}
                        >
                          <span className="material-symbols-outlined" style={{ fontSize: 20 }}>expand_more</span>
                        </button>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr style={{ backgroundColor: t.mode === "light" ? "#f8fafb" : t.colors.background, borderBottom: `1px solid ${t.colors.border}` }}>
                        <td colSpan={5} style={{ padding: t.spacing(3), verticalAlign: "top" }}>
                          <div style={{ display: "flex", flexDirection: "column", gap: t.spacing(3), maxWidth: 560 }}>
                            {item.description ? (
                              <div style={{ fontSize: "0.95rem", lineHeight: 1.5, color: t.colors.text }}>{item.description}</div>
                            ) : (
                              <div style={{ fontSize: "0.875rem", color: t.colors.textMuted }}>No description.</div>
                            )}
                            <div>
                              <div style={{ ...secondaryTextStyle, marginBottom: t.spacing(1) }}>Subtasks</div>
                              {item.subtasks.length > 0 && (
                                <ul style={{ listStyle: "none", padding: 0, margin: 0, marginBottom: t.spacing(2) }}>
                                  {item.subtasks.map((st) => (
                                    <li key={st.id} style={{ display: "flex", alignItems: "center", gap: t.spacing(2), marginBottom: t.spacing(1) }}>
                                      <button
                                        type="button"
                                        onClick={() => toggleSubtask(item.id, st.id)}
                                        style={{ padding: 0, border: "none", background: "none", cursor: "pointer", color: st.done ? t.colors.success : t.colors.textMuted }}
                                        aria-label={st.done ? "Mark incomplete" : "Mark done"}
                                      >
                                        <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                                          {st.done ? "check_circle" : "radio_button_unchecked"}
                                        </span>
                                      </button>
                                      <span style={{ flex: 1, textDecoration: st.done ? "line-through" : "none", color: st.done ? t.colors.textMuted : t.colors.text, fontSize: "0.875rem" }}>{st.text}</span>
                                      <button type="button" onClick={() => removeSubtask(item.id, st.id)} style={{ padding: 0, border: "none", background: "none", cursor: "pointer", color: t.colors.textMuted }} aria-label="Remove subtask">
                                        <span className="material-symbols-outlined" style={{ fontSize: 18 }}>close</span>
                                      </button>
                                    </li>
                                  ))}
                                </ul>
                              )}
                              <div style={{ display: "flex", gap: t.spacing(2), alignItems: "center" }}>
                                <input
                                  type="text"
                                  placeholder="Add subtask..."
                                  value={subtaskInput}
                                  onChange={(e) => setSubtaskInputByParent((p) => ({ ...p, [item.id]: e.target.value }))}
                                  onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addSubtask(item.id, subtaskInput))}
                                  style={{ ...inputStyle, flex: 1, margin: 0, maxWidth: 320 }}
                                />
                                <button type="button" onClick={() => addSubtask(item.id, subtaskInput)} style={{ ...buttonStyle, padding: `${t.spacing(1.5)} ${t.spacing(3)}` }}>Add subtask</button>
                              </div>
                            </div>
                            <div>
                              <button
                                type="button"
                                onClick={() => { removeTodo(item.id); setExpandedId(null); }}
                                style={{
                                  padding: `${t.spacing(1.5)} ${t.spacing(3)}`,
                                  fontSize: "0.875rem",
                                  color: t.colors.danger,
                                  backgroundColor: "transparent",
                                  border: `1px solid ${t.colors.danger}`,
                                  borderRadius: t.radius.md,
                                  cursor: "pointer",
                                  fontWeight: 600,
                                }}
                              >
                                Delete task
                              </button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Fixed bottom add-task bar (full width of content area, not over nav) */}
      <div
        style={{
          position: "fixed",
          bottom: 0,
          left: addBarLeft,
          right: 0,
          height: ADD_BAR_HEIGHT,
          display: "flex",
          alignItems: "center",
          gap: t.spacing(3),
          padding: `0 ${t.spacing(4)}`,
          backgroundColor: t.mode === "light" ? "#ffffff" : t.colors.surface,
          borderTop: `1px solid ${t.colors.border}`,
          boxShadow: "0 -2px 8px rgba(0,0,0,0.06)",
          zIndex: 100,
        }}
      >
        <input
          type="text"
          placeholder="Add a task..."
          style={{
            ...inputStyle,
            flex: 1,
            maxWidth: "none",
            margin: 0,
          }}
          value={headerInput}
          onChange={(e) => setHeaderInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addTodo())}
          aria-label="Task header"
        />
        <div style={{ position: "relative" }}>
          <button
            type="button"
            onClick={() => { setClientDropdownOpen((o) => !o); setEmployeeDropdownOpen(false); }}
            style={{ ...getDropdownTriggerStyle(t), margin: 0, minWidth: 120 }}
          >
            {CLIENTS.find((c) => c.id === clientIdInput)?.label ?? "Client"}
            <span className="material-symbols-outlined" style={{ fontSize: 18, transform: clientDropdownOpen ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.2s ease" }}>expand_more</span>
          </button>
          {clientDropdownOpen && (
            <>
              <div role="presentation" style={{ position: "fixed", inset: 0, zIndex: 99 }} onClick={() => setClientDropdownOpen(false)} />
              <div style={getDropdownPanelStyle(t, "up")}>
                {CLIENTS.map((c) => (
                  <button
                    key={c.id || "none"}
                    type="button"
                    className={THEME_DROPDOWN_OPTION_CLASS}
                    onClick={() => { setClientIdInput(c.id); setClientDropdownOpen(false); }}
                    style={getDropdownOptionStyle(t, clientIdInput === c.id)}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        <div style={{ position: "relative" }}>
          <button
            type="button"
            onClick={() => { setEmployeeDropdownOpen((o) => !o); setClientDropdownOpen(false); }}
            style={{ ...getDropdownTriggerStyle(t), margin: 0, minWidth: 140 }}
          >
            {EMPLOYEES.find((e) => e.id === assigneeIdInput)?.label ?? "Employee"}
            <span className="material-symbols-outlined" style={{ fontSize: 18, transform: employeeDropdownOpen ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.2s ease" }}>expand_more</span>
          </button>
          {employeeDropdownOpen && (
            <>
              <div role="presentation" style={{ position: "fixed", inset: 0, zIndex: 99 }} onClick={() => setEmployeeDropdownOpen(false)} />
              <div style={getDropdownPanelStyle(t, "up")}>
                {EMPLOYEES.map((e) => (
                  <button
                    key={e.id || "none"}
                    type="button"
                    className={THEME_DROPDOWN_OPTION_CLASS}
                    onClick={() => { setAssigneeIdInput(e.id); setEmployeeDropdownOpen(false); }}
                    style={getDropdownOptionStyle(t, assigneeIdInput === e.id)}
                  >
                    {e.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        <input
          type="date"
          value={dueDateInput}
          onChange={(e) => setDueDateInput(e.target.value)}
          style={{ ...selectStyle, margin: 0, paddingRight: t.spacing(2) }}
        />
        <button type="button" style={buttonStyle} onClick={addTodo}>
          Add
        </button>
      </div>
    </section>
    </div>
  );
}

