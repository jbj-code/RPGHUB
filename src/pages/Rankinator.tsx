// Rankinator.tsx
// Legacy route — RPG Atlas now lives at rpg-atlas.vercel.app (nav opens externally).

import { RPG_ATLAS_URL } from "../constants";
import type { Theme } from "../theme";
import { PAGE_LAYOUT, getPageCardStyle } from "../theme";

type RankinatorProps = { theme: Theme };

export function Rankinator({ theme: t }: RankinatorProps) {
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

  const cardStyle = getPageCardStyle(t);

  return (
    <section className="rankinator-page" style={pageStyle}>
      <h2 style={titleStyle}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: t.spacing(2) }}>
          <span
            className="material-symbols-outlined"
            style={{ fontSize: "1.5rem", color: t.colors.secondary, lineHeight: 1, display: "inline-flex" }}
            aria-hidden
          >
            leaderboard
          </span>
          RPG Atlas
        </span>
      </h2>
      <p style={descStyle}>
        Company data and rankings across fund investments. RPG Atlas now runs as a standalone app.
      </p>
      <div className="page-card" style={cardStyle}>
        <a
          href={RPG_ATLAS_URL}
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: t.colors.primary, fontWeight: 600 }}
        >
          Open RPG Atlas
        </a>
      </div>
    </section>
  );
}
