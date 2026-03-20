import type { CSSProperties } from "react";
import type { Theme, ThemeMode } from "../theme";
import { assets } from "../theme";
import type { Page } from "../App";

export const SIDEBAR_WIDTH = 260;
/** Compact sidebar: icon-only nav, favicon in header. */
export const SIDEBAR_WIDTH_COMPACT = 72;

export type NavBarProps = {
  page: Page;
  onNavigate: (page: Page) => void;
  mode: ThemeMode;
  onToggleMode: () => void;
  theme: Theme;
  compact: boolean;
  onToggleCompact: () => void;
};

export function NavBar({
  page,
  onNavigate,
  mode,
  onToggleMode,
  theme: t,
  compact,
  onToggleCompact,
}: NavBarProps) {
  const width = compact ? SIDEBAR_WIDTH_COMPACT : SIDEBAR_WIDTH;

  const sidebarStyle: CSSProperties = {
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

  const headerStyle: CSSProperties = {
    minHeight: 68,
    padding: `${t.spacing(4)} ${compact ? t.spacing(2) : t.spacing(6)}`,
    borderBottom: `1px solid ${t.colors.border}`,
    display: "flex",
    alignItems: "center",
    justifyContent: compact ? "center" : "flex-start",
  };

  const logoButtonStyle: CSSProperties = {
    padding: 0,
    border: "none",
    background: "none",
    cursor: "pointer",
    lineHeight: 0,
    display: "block",
    width: compact ? "100%" : "auto",
  };

  const logoStyle: CSSProperties = {
    height: 36,
    width: 120,
    minWidth: 120,
    objectFit: "contain",
    objectPosition: "left center",
    display: "block",
  };

  const navStyle: CSSProperties = {
    flex: 1,
    padding: compact ? t.spacing(2) : t.spacing(3),
    display: "flex",
    flexDirection: "column",
    gap: t.spacing(1),
  };

  const linkStyle = (active: boolean): CSSProperties => ({
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

  const linkIconStyle: CSSProperties = {
    fontSize: 22,
    flexShrink: 0,
  };

  const footerStyle: CSSProperties = {
    padding: t.spacing(3),
    borderTop: `1px solid ${t.colors.border}`,
  };

  const toggleStyle: CSSProperties = {
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
    {
      page: "options-opportunities",
      label: "Options Opportunities",
      icon: "search",
    },
    {
      page: "options-roll",
      label: "Options Roll",
      icon: "auto_mode",
    },
    {
      page: "assignment-check",
      label: "Assignment Check",
      icon: "schedule",
    },
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
      <div className="app-nav-menu" style={navStyle}>
        {links.map(({ page: p, label, icon, externalUrl }) => (
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
