// Home.tsx
// Landing page with quick access to core research tools.

import type { Page } from "../App";
import type { Theme } from "../theme";
import {
  assets,
  getPageCardStyle,
  INTERACTIVE_CARD_CLASS,
  PAGE_LAYOUT,
} from "../theme";

type HomeProps = {
  theme: Theme;
  onNavigate: (page: Page) => void;
};

const TOOLS: {
  page: Page;
  label: string;
  icon: string;
  description: string;
}[] = [
  {
    page: "stock-comparison",
    label: "Stock Comparison",
    icon: "compare_arrows",
    description: "Compare returns and metrics across tickers.",
  },
  {
    page: "put-optimizer",
    label: "Options Optimizer",
    icon: "tune",
    description: "Rank strikes by yield, momentum, and probability of profit.",
  },
  {
    page: "options-screener",
    label: "Options Screener",
    icon: "search",
    description: "Scan the universe for top OTM puts and calls by yield band.",
  },
];

export function Home({ theme: t, onNavigate }: HomeProps) {
  const pageStyle: React.CSSProperties = {
    maxWidth: PAGE_LAYOUT.maxWidth,
    width: "100%",
    margin: "0 auto",
    fontFamily: t.typography.fontFamily,
    color: t.colors.text,
  };

  const heroStyle: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    textAlign: "center",
    gap: t.spacing(3),
    marginBottom: t.spacing(8),
    paddingTop: t.spacing(4),
  };

  const logoStyle: React.CSSProperties = {
    height: 96,
    width: "auto",
    maxWidth: 260,
    objectFit: "contain",
  };

  const taglineStyle: React.CSSProperties = {
    fontWeight: t.typography.headingWeight,
    fontSize: "1.5rem",
    letterSpacing: "0.02em",
    color: t.colors.textMuted,
    margin: 0,
  };

  const introStyle: React.CSSProperties = {
    margin: 0,
    maxWidth: 520,
    color: t.colors.textMuted,
    fontSize: t.typography.baseFontSize,
    lineHeight: 1.55,
  };

  const gridStyle: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
    gap: t.spacing(4),
  };

  const cardStyle = getPageCardStyle(t, {
    padding: t.spacing(5),
    marginBottom: 0,
    width: "100%",
    textAlign: "left",
    cursor: "pointer",
    fontFamily: t.typography.fontFamily,
  });

  return (
    <section className="home-page" style={pageStyle} aria-label="Home">
      <header className="home-section home-hero" style={heroStyle}>
        <img
          src={t.mode === "light" ? assets.logo : assets.logoWhite}
          alt=""
          className="home-hero-logo"
          style={logoStyle}
          aria-hidden
        />
        <p className="home-hero-tagline" style={taglineStyle}>
          Home of Useful Bits
        </p>
        <p style={introStyle}>Jump into the tools you use most.</p>
      </header>

      <div className="home-tools-grid" style={gridStyle}>
        {TOOLS.map((tool) => (
          <button
            key={tool.page}
            type="button"
            className={`home-tool-card page-card ${INTERACTIVE_CARD_CLASS}`}
            style={cardStyle}
            onClick={() => onNavigate(tool.page)}
          >
            <span
              className="material-symbols-outlined"
              style={{
                fontSize: 32,
                color: t.colors.primary,
                lineHeight: 1,
                display: "block",
                marginBottom: t.spacing(3),
              }}
              aria-hidden
            >
              {tool.icon}
            </span>
            <span
              style={{
                display: "block",
                fontWeight: t.typography.headingWeight,
                fontSize: "1.125rem",
                color: t.colors.text,
                marginBottom: t.spacing(1.5),
              }}
            >
              {tool.label}
            </span>
            <span
              style={{
                display: "block",
                fontSize: "0.9rem",
                lineHeight: 1.5,
                color: t.colors.textMuted,
              }}
            >
              {tool.description}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
