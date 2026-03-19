import { useState } from "react";
import type { Theme, ThemeMode } from "../theme";
import { assets } from "../theme";
import type { Page } from "../App";

type NavSegment = "tools" | "clients";

export const SIDEBAR_WIDTH = 240;
/** Compact sidebar: icon-only nav, favicon in header. */
export const SIDEBAR_WIDTH_COMPACT = 72;

export type NavBarProps = {
  page: Page;
  onNavigate: (page: Page) => void;
  onSelectClient: (name: string) => void;
  selectedClient: string | null;
  mode: ThemeMode;
  onToggleMode: () => void;
  theme: Theme;
  compact: boolean;
  onToggleCompact: () => void;
};

const CLIENT_IDS = Array.from({ length: 10 }, (_, i) => i + 1);

export function NavBar({
  page,
  onNavigate,
  onSelectClient,
  selectedClient,
  mode,
  onToggleMode,
  theme: t,
  compact,
  onToggleCompact,
}: NavBarProps) {
  const [segment, setSegment] = useState<NavSegment>("tools");
  const width = compact ? SIDEBAR_WIDTH_COMPACT : SIDEBAR_WIDTH;

  const sidebarStyle: React.CSSProperties = {
    position: "fixed",
    left: 0,
    top: 0,
    width,
    minWidth: width,
    height: "100vh",
    backgroundColor: t.colors.surface,
    borderRight: `1px solid ${t.colors.border}`,
    boxShadow: "2px 0 8px rgba(0,0,0,0.04)",
    display: "flex",
    flexDirection: "column",
    fontFamily: t.typography.fontFamily,
    overflowX: "hidden",
    overflowY: "auto",
    transition: "width 0.25s ease, min-width 0.25s ease",
  };

  const headerStyle: React.CSSProperties = {
    minHeight: 68,
    padding: `${t.spacing(4)} ${compact ? t.spacing(2) : t.spacing(6)}`,
    borderBottom: `1px solid ${t.colors.border}`,
    display: "flex",
    alignItems: "center",
    justifyContent: compact ? "center" : "flex-start",
  };

  const logoButtonStyle: React.CSSProperties = {
    padding: 0,
    border: "none",
    background: "none",
    cursor: "pointer",
    lineHeight: 0,
    display: "block",
    width: "100%",
  };

  const logoStyle: React.CSSProperties = {
    height: 36,
    width: 120,
    minWidth: 120,
    objectFit: "contain",
    objectPosition: "left center",
    display: "block",
  };

  const faviconStyle: React.CSSProperties = {
    height: 32,
    width: 32,
    display: "block",
  };

  const pillWrapStyle: React.CSSProperties = {
    padding: `${t.spacing(2)} ${compact ? t.spacing(1) : t.spacing(3)}`,
    borderBottom: `1px solid ${t.colors.border}`,
  };

  const pillTrackStyle: React.CSSProperties = {
    display: "flex",
    borderRadius: 9999,
    backgroundColor: t.colors.background,
    padding: 2,
    border: `1px solid ${t.colors.border}`,
  };

  const pillOptionStyle = (active: boolean): React.CSSProperties => ({
    flex: 1,
    padding: `${t.spacing(1)} ${compact ? t.spacing(1) : t.spacing(2)}`,
    border: "none",
    borderRadius: 9999,
    backgroundColor: active ? t.colors.primary : "transparent",
    color: active ? "#ffffff" : t.colors.textMuted,
    fontSize: "0.8rem",
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: t.typography.fontFamily,
    transition: "background-color 0.2s ease, color 0.2s ease",
  });

  const navStyle: React.CSSProperties = {
    flex: 1,
    padding: compact ? t.spacing(2) : t.spacing(3),
    display: "flex",
    flexDirection: "column",
    gap: t.spacing(1),
  };

  const linkStyle = (active: boolean): React.CSSProperties => ({
    position: "relative",
    color: active ? t.colors.primary : t.colors.textMuted,
    textDecoration: "none",
    fontSize: "0.95rem",
    fontWeight: active ? 600 : 500,
    padding: compact ? t.spacing(2) : `${t.spacing(2)} ${t.spacing(3)}`,
    borderRadius: t.radius.sm,
    display: "flex",
    alignItems: "center",
    justifyContent: compact ? "center" : "flex-start",
    gap: compact ? 0 : t.spacing(2),
    transition: "background-color 0.15s ease, color 0.15s ease",
  });

  const linkIconStyle: React.CSSProperties = {
    fontSize: 22,
    flexShrink: 0,
  };

  const footerStyle: React.CSSProperties = {
    padding: t.spacing(3),
    borderTop: `1px solid ${t.colors.border}`,
  };

  const toggleStyle: React.CSSProperties = {
    position: "relative",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: compact ? 0 : t.spacing(2),
    width: "100%",
    padding: compact ? t.spacing(2) : `${t.spacing(2)} ${t.spacing(3)}`,
    borderRadius: t.radius.sm,
    border: `1px solid ${t.colors.border}`,
    backgroundColor: "transparent",
    color: t.colors.textMuted,
    cursor: "pointer",
    fontFamily: "inherit",
    fontSize: "0.9rem",
    whiteSpace: "nowrap",
  };

  const links: { page: Page; label: string; icon: string; externalUrl?: string }[] = [
    { page: "stock-comparison", label: "Stock Comparison", icon: "compare_arrows" },
    { page: "put-optimizer", label: "Options Optimizer", icon: "tune" },
    { page: "options-pricing", label: "Options Pricing", icon: "paid" },
    { page: "options-builder", label: "Options Builder", icon: "table_chart" },
    { page: "graph-tool", label: "Graph Tool", icon: "show_chart" },
    { page: "email-crm", label: "Email CRM", icon: "contacts" },
    { page: "todos", label: "To-Dos", icon: "checklist" },
    {
      page: "rankinator",
      label: "Rankinator",
      icon: "leaderboard",
      externalUrl: "https://lookerstudio.google.com/s/rvxCmaxCAYc",
    },
    {
      page: "raise-ai",
      label: "Raise.ai",
      icon: "rocket_launch",
      externalUrl: "https://lookerstudio.google.com/s/vnU0N-aINPg",
    },
  ];

  return (
    <nav className="app-nav app-nav-sidebar" style={sidebarStyle} aria-label="Main navigation">
      <div className="app-nav-header" style={headerStyle}>
        <button
          type="button"
          style={{
            ...logoButtonStyle,
            display: "flex",
            alignItems: "center",
            justifyContent: compact ? "center" : "flex-start",
          }}
          onClick={() => onNavigate("home")}
          aria-label="Go to home"
        >
          <img
            src={compact ? assets.favicon : mode === "light" ? assets.logo : assets.logoWhite}
            alt="RPG H.U.B"
            className="app-nav-logo"
            style={{
              ...logoStyle,
              height: compact ? 32 : logoStyle.height,
              width: compact ? 32 : logoStyle.width,
              minWidth: compact ? 32 : logoStyle.minWidth,
            }}
          />
        </button>
      </div>
      <div style={pillWrapStyle}>
        <div style={pillTrackStyle}>
          <button
            type="button"
            onClick={() => setSegment("tools")}
            style={pillOptionStyle(segment === "tools")}
            aria-pressed={segment === "tools"}
            aria-label="Tools"
          >
            <span className="material-symbols-outlined" style={{ fontSize: 18, verticalAlign: "middle" }}>
              construction
            </span>
            {!compact && " Tools"}
          </button>
          <button
            type="button"
            onClick={() => {
              setSegment("clients");
              onNavigate("clients");
            }}
            style={pillOptionStyle(segment === "clients")}
            aria-pressed={segment === "clients"}
            aria-label="Clients"
          >
            <span className="material-symbols-outlined" style={{ fontSize: 18, verticalAlign: "middle" }}>
              groups
            </span>
            {!compact && " Clients"}
          </button>
        </div>
      </div>
      <div className="app-nav-menu" style={navStyle}>
        {segment === "tools" && links.map(({ page: p, label, icon, externalUrl }) => (
          <a
            key={p}
            href="#"
            onClick={(e) => {
              e.preventDefault();
              if (externalUrl) {
                window.open(externalUrl, "_blank", "noopener,noreferrer");
              } else {
                onNavigate(p);
              }
            }}
            style={linkStyle(page === p)}
            title={compact ? label : undefined}
          >
            <span className="material-symbols-outlined" style={linkIconStyle} aria-hidden>
              {icon}
            </span>
            <span
              className={`app-nav-label${compact ? " app-nav-label--compact" : ""}`}
              aria-hidden={compact}
            >
              {label}
            </span>
          </a>
        ))}
        {segment === "clients" &&
          CLIENT_IDS.map((n) => {
            const label = `Client ${n}`;
            const isActive = page === "client-detail" && selectedClient === label;
            return (
              <a
                key={n}
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  onSelectClient(label);
                  onNavigate("client-detail");
                }}
                style={linkStyle(isActive)}
                title={compact ? label : undefined}
              >
                <span className="material-symbols-outlined" style={linkIconStyle} aria-hidden>
                  person
                </span>
                <span
                  className={`app-nav-label${compact ? " app-nav-label--compact" : ""}`}
                  aria-hidden={compact}
                >
                  {label}
                </span>
              </a>
            );
          })}
      </div>
      <div className="app-nav-footer" style={footerStyle}>
        <button
          type="button"
          className="app-nav-compact-toggle"
          style={toggleStyle}
          onClick={onToggleCompact}
          aria-label={compact ? "Expand sidebar" : "Collapse sidebar"}
        >
          <span
            className="material-symbols-outlined"
            style={{
              fontSize: 22,
              transform: compact ? "scaleX(-1)" : "none",
            }}
            aria-hidden
          >
            menu_open
          </span>
          <span
            className={`app-nav-label${compact ? " app-nav-label--compact" : ""}`}
            aria-hidden={compact}
          >
            Collapse
          </span>
        </button>
        <button
          type="button"
          className="app-nav-theme-toggle"
          style={{ ...toggleStyle, marginTop: t.spacing(1) }}
          onClick={onToggleMode}
          aria-label={mode === "light" ? "Switch to dark mode" : "Switch to light mode"}
        >
          <span className="material-symbols-outlined" style={{ fontSize: compact ? 22 : 22 }} aria-hidden>
            {mode === "light" ? "dark_mode" : "light_mode"}
          </span>
          <span
            className={`app-nav-label${compact ? " app-nav-label--compact" : ""}`}
            aria-hidden={compact}
          >
            {mode === "light" ? "Dark mode" : "Light mode"}
          </span>
        </button>
        <div
          style={{
            marginTop: t.spacing(2),
            fontSize: "0.75rem",
            color: t.colors.textMuted,
            textAlign: "center",
          }}
        >
          {compact ? "V 1.0.0" : "Version 1.0.0"}
        </div>
      </div>
    </nav>
  );
}
