import type { Theme } from "../theme";
import { PAGE_LAYOUT } from "../theme";

type ClientsProps = { theme: Theme };

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
    padding: t.spacing(5),
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

  return (
    <section className="clients-page page-card" style={pageStyle}>
      <h2 style={titleStyle}>Clients</h2>
      <p style={descStyle}>
        Client information and quick links. More tools can be added here later.
      </p>

      <div className="page-card" style={cardStyle}>
        <h3 style={cardTitleStyle}>Overview</h3>
        <p style={{ color: t.colors.textMuted, fontSize: "0.9rem", margin: 0 }}>
          This page is a placeholder for client-related content. You can add directories, search, or links to external systems (e.g. Addepar, CRM) when ready.
        </p>
      </div>
    </section>
  );
}
