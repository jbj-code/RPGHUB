import type { Theme, ThemeMode } from "../theme";
import { assets } from "../theme";
import type { Page } from "../App";

export const SIDEBAR_WIDTH = 240;

export type NavBarProps = {
  page: Page;
  onNavigate: (page: Page) => void;
  mode: ThemeMode;
  onToggleMode: () => void;
  theme: Theme;
};

export function NavBar({ page, onNavigate, mode, onToggleMode, theme: t }: NavBarProps) {
  const sidebarStyle: React.CSSProperties = {
    position: "fixed",
    left: 0,
    top: 0,
    width: SIDEBAR_WIDTH,
    minWidth: SIDEBAR_WIDTH,
    height: "100vh",
    backgroundColor: t.colors.surface,
    borderRight: `1px solid ${t.colors.border}`,
    boxShadow: "2px 0 8px rgba(0,0,0,0.04)",
    display: "flex",
    flexDirection: "column",
    fontFamily: t.typography.fontFamily,
    overflowY: "auto",
  };

  const headerStyle: React.CSSProperties = {
    padding: `${t.spacing(4)} ${t.spacing(6)}`,
    borderBottom: `1px solid ${t.colors.border}`,
  };

  const logoButtonStyle: React.CSSProperties = {
    padding: 0,
    border: "none",
    background: "none",
    cursor: "pointer",
    lineHeight: 0,
    display: "block",
  };

  const logoStyle: React.CSSProperties = {
    height: 36,
    width: 120,
    minWidth: 120,
    objectFit: "contain",
    objectPosition: "left center",
    display: "block",
  };

  const navStyle: React.CSSProperties = {
    flex: 1,
    padding: t.spacing(3),
    display: "flex",
    flexDirection: "column",
    gap: t.spacing(0.5),
  };

  const linkStyle = (active: boolean): React.CSSProperties => ({
    color: active ? t.colors.primary : t.colors.textMuted,
    textDecoration: "none",
    fontSize: "0.95rem",
    fontWeight: active ? 600 : 500,
    padding: `${t.spacing(2)} ${t.spacing(3)}`,
    borderRadius: t.radius.sm,
    display: "flex",
    alignItems: "center",
    gap: t.spacing(2),
    transition: "background-color 0.15s ease, color 0.15s ease",
  });

  const linkIconStyle: React.CSSProperties = { fontSize: 22, flexShrink: 0 };

  const footerStyle: React.CSSProperties = {
    padding: t.spacing(3),
    borderTop: `1px solid ${t.colors.border}`,
  };

  const toggleStyle: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: t.spacing(2),
    width: "100%",
    padding: `${t.spacing(2)} ${t.spacing(3)}`,
    borderRadius: t.radius.sm,
    border: `1px solid ${t.colors.border}`,
    backgroundColor: "transparent",
    color: t.colors.textMuted,
    cursor: "pointer",
    fontFamily: "inherit",
    fontSize: "0.9rem",
  };

  const links: { page: Page; label: string; icon: string; externalUrl?: string }[] = [
    { page: "put-optimizer", label: "Options Optimizer", icon: "tune" },
    { page: "options-pricing", label: "Options Pricing", icon: "paid" },
    { page: "stock-comparison", label: "Stock Comparison", icon: "compare_arrows" },
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
          style={logoButtonStyle}
          onClick={() => onNavigate("home")}
          aria-label="Go to home"
        >
          <img
            src={mode === "light" ? assets.logo : assets.logoWhite}
            alt="RPG H.U.B"
            className="app-nav-logo"
            style={logoStyle}
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
          >
            <span className="material-symbols-outlined" style={linkIconStyle} aria-hidden>
              {icon}
            </span>
            {label}
          </a>
        ))}
      </div>
      <div className="app-nav-footer" style={footerStyle}>
        <button
          type="button"
          className="app-nav-theme-toggle"
          style={toggleStyle}
          onClick={onToggleMode}
          aria-label={mode === "light" ? "Switch to dark mode" : "Switch to light mode"}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 22 }} aria-hidden>
            {mode === "light" ? "dark_mode" : "light_mode"}
          </span>
          {mode === "light" ? "Dark mode" : "Light mode"}
        </button>
        <div
          style={{
            marginTop: t.spacing(2),
            fontSize: "0.75rem",
            color: t.colors.textMuted,
            textAlign: "center",
          }}
        >
          Version 1.0.0
        </div>
      </div>
    </nav>
  );
}
