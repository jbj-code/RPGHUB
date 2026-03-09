import type { Theme } from "../theme";
import { PAGE_LAYOUT } from "../theme";

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

  const cardStyle: React.CSSProperties = {
    backgroundColor: t.colors.surface,
    borderRadius: t.radius.lg,
    padding: t.spacing(5),
    boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
    border: `1px solid ${t.colors.border}`,
  };

  return (
    <section className="rankinator-page" style={pageStyle}>
      <h2 style={titleStyle}>Rankinator</h2>
      <p style={descStyle}>
        Company data on all our fund investments. Content and functionality will go here.
      </p>
      <div className="page-card" style={cardStyle}>
        <p style={{ margin: 0, color: t.colors.textMuted, fontSize: t.typography.baseFontSize }}>
          Placeholder for future content.
        </p>
      </div>
    </section>
  );
}
