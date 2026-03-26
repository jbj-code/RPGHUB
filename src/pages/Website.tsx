import { useState, useEffect, useRef } from "react";
import type { Theme } from "../theme";
import { assets } from "../theme";

type WebsiteProps = { theme: Theme };
type WebsiteSection = "home" | "mission" | "contact" | "viewpoints" | "compliance";

const NAV_ITEMS: { key: WebsiteSection; label: string }[] = [
  { key: "home",        label: "Home" },
  { key: "mission",     label: "Our Mission" },
  { key: "contact",     label: "Contact" },
  { key: "viewpoints",  label: "Viewpoints" },
  { key: "compliance",  label: "Compliance" },
];

export function Website({ theme: t }: WebsiteProps) {
  const [section, setSection] = useState<WebsiteSection>("home");
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu when clicking outside
  useEffect(() => {
    if (!menuOpen) return;
    function onClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [menuOpen]);

  // Close menu on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const heroShellStyle: React.CSSProperties = {
    position: "relative",
    overflow: "hidden",
    width: "100%",
    height: "100vh",
    backgroundColor: "#041518",
    display: "flex",
    flexDirection: "column",
  };

  const heroTopBarStyle: React.CSSProperties = {
    position: "absolute",
    top: t.spacing(5),
    left: t.spacing(5),
    right: t.spacing(5),
    zIndex: 10,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  };

  const heroLogoStyle: React.CSSProperties = {
    height: 30,
    width: "auto",
    objectFit: "contain",
    filter: "drop-shadow(0 3px 10px rgba(0,0,0,0.35))",
  };

  const heroMenuBtnStyle: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: t.spacing(1.5),
    borderRadius: 999,
    border: "1px solid rgba(255,255,255,0.28)",
    backgroundColor: "rgba(4, 20, 26, 0.60)",
    color: "#e8fcff",
    fontSize: "0.82rem",
    fontWeight: 600,
    padding: `${t.spacing(1.25)} ${t.spacing(2.5)}`,
    cursor: "pointer",
    fontFamily: "inherit",
    backdropFilter: "blur(8px)",
    WebkitBackdropFilter: "blur(8px)",
    transition: "background-color 0.2s ease, border-color 0.2s ease",
  };

  const menuDropdownStyle: React.CSSProperties = {
    position: "absolute",
    top: "calc(100% + 8px)",
    right: 0,
    minWidth: 200,
    backgroundColor: "rgba(4, 18, 26, 0.92)",
    backdropFilter: "blur(16px)",
    WebkitBackdropFilter: "blur(16px)",
    border: "1px solid rgba(68, 193, 193, 0.22)",
    borderRadius: 14,
    padding: `${t.spacing(1.5)} ${t.spacing(1.5)}`,
    boxShadow: "0 16px 40px rgba(0,0,0,0.45)",
    zIndex: 20,
  };

  const menuItemStyle = (active: boolean): React.CSSProperties => ({
    display: "block",
    width: "100%",
    padding: `${t.spacing(1.75)} ${t.spacing(2.5)}`,
    borderRadius: 10,
    border: "none",
    backgroundColor: active ? "rgba(68, 193, 193, 0.14)" : "transparent",
    color: active ? "#7de8e8" : "rgba(220, 247, 250, 0.80)",
    fontSize: "0.88rem",
    fontWeight: active ? 700 : 500,
    textAlign: "left",
    cursor: "pointer",
    fontFamily: "inherit",
    transition: "background-color 0.15s ease, color 0.15s ease",
    letterSpacing: "0.01em",
  });

  const heroInnerStyle: React.CSSProperties = {
    position: "relative",
    zIndex: 2,
    flex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: `${t.spacing(8)} ${t.spacing(8)} ${t.spacing(12)}`,
  };

  const heroTitleStyle: React.CSSProperties = {
    position: "relative",
    zIndex: 2,
    fontSize: "3.4rem",
    lineHeight: 1.08,
    margin: 0,
    marginBottom: t.spacing(5),
    color: "#ecfeff",
    maxWidth: 820,
    textAlign: "center",
    fontWeight: 800,
    textShadow: "0 8px 32px rgba(0,0,0,0.5)",
    letterSpacing: "-0.01em",
  };

  const ctaStyle: React.CSSProperties = {
    borderRadius: 999,
    border: "1px solid rgba(255, 255, 255, 0.28)",
    backgroundColor: "rgba(240, 253, 255, 0.94)",
    color: "#0f2a36",
    boxShadow: "0 10px 32px rgba(0,0,0,0.4), 0 0 0 1px rgba(68,193,193,0.2)",
    padding: `${t.spacing(2.25)} ${t.spacing(6)}`,
    fontSize: "0.92rem",
    fontWeight: 700,
    cursor: "pointer",
    fontFamily: "inherit",
    letterSpacing: "0.02em",
    transition: "transform 0.15s ease, box-shadow 0.15s ease",
  };

  const sectionPageStyle: React.CSSProperties = {
    width: "100%",
    height: "100vh",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: t.colors.background,
    color: t.colors.text,
    fontFamily: t.typography.fontFamily,
    gap: t.spacing(4),
  };

  const sectionTitleStyle: React.CSSProperties = {
    fontSize: "2rem",
    fontWeight: 700,
    color: t.colors.text,
    margin: 0,
  };

  const backBtnStyle: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: t.spacing(1.5),
    padding: `${t.spacing(1.5)} ${t.spacing(3)}`,
    borderRadius: 999,
    border: `1px solid ${t.colors.border}`,
    backgroundColor: t.colors.surface,
    color: t.colors.primary,
    fontSize: "0.85rem",
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "inherit",
  };

  if (section !== "home") {
    const label = NAV_ITEMS.find((n) => n.key === section)?.label ?? section;
    return (
      <div style={sectionPageStyle}>
        <h2 style={sectionTitleStyle}>{label}</h2>
        <p style={{ color: t.colors.textMuted, fontSize: "0.95rem", margin: 0 }}>
          This section is coming soon.
        </p>
        <button type="button" style={backBtnStyle} onClick={() => setSection("home")}>
          <span className="material-symbols-outlined" style={{ fontSize: 16 }} aria-hidden>arrow_back</span>
          Back to Home
        </button>
      </div>
    );
  }

  return (
    <div className="website-home-hero" style={heroShellStyle}>
      {/* Animated gradient layers */}
      <div className="website-gradient-layer website-gradient-layer-a" />
      <div className="website-gradient-layer website-gradient-layer-b" />
      <div className="website-gradient-layer website-gradient-layer-c" />
      <div className="website-gradient-layer website-gradient-layer-d" />
      <div className="website-gradient-layer website-gradient-layer-e" />
      <div className="website-caustic-layer" />
      <div className="website-wave-layer" />
      <div className="website-noise-layer" />
      <div className="website-grain-layer" />

      {/* Top bar: logo + hamburger */}
      <div style={heroTopBarStyle}>
        <img src={assets.logoWhite} alt="Resolute Project Group" style={heroLogoStyle} />

        <div ref={menuRef} style={{ position: "relative" }}>
          <button
            type="button"
            style={heroMenuBtnStyle}
            onClick={() => setMenuOpen((o) => !o)}
            aria-expanded={menuOpen}
            aria-haspopup="menu"
          >
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 18, lineHeight: 1, transition: "transform 0.2s ease", transform: menuOpen ? "rotate(90deg)" : "none" }}
              aria-hidden
            >
              {menuOpen ? "close" : "menu"}
            </span>
            Menu
          </button>

          {menuOpen && (
            <div style={menuDropdownStyle} role="menu">
              {NAV_ITEMS.map(({ key, label }) => (
                <button
                  key={key}
                  type="button"
                  role="menuitem"
                  style={menuItemStyle(section === key)}
                  onClick={() => { setSection(key); setMenuOpen(false); }}
                  className="website-menu-item"
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Hero content */}
      <div style={heroInnerStyle}>
        <h2 style={heroTitleStyle}>
          With the world's coolest clients,<br />we invest to improve the world
        </h2>
        <button
          type="button"
          style={ctaStyle}
          className="website-cta-btn"
          onClick={() => setSection("mission")}
        >
          Explore Resolute
        </button>
        <p style={{ marginTop: t.spacing(3), fontSize: "0.75rem", color: "rgba(180, 230, 230, 0.50)", position: "relative", zIndex: 2 }}>
          Inspiration:{" "}
          <a
            href="https://bluefyn.ai"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "rgba(68, 193, 193, 0.70)", textDecoration: "none", fontWeight: 600 }}
          >
            bluefyn.ai
          </a>
        </p>
      </div>
    </div>
  );
}
