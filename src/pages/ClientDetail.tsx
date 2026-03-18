import type { Theme } from "../theme";
import { PAGE_LAYOUT } from "../theme";

type ClientDetailProps = { theme: Theme; clientName: string };

export function ClientDetail({ theme: t, clientName }: ClientDetailProps) {
  const pageStyle: React.CSSProperties = {
    maxWidth: PAGE_LAYOUT.maxWidth,
    width: "100%",
    margin: "0 auto",
    fontFamily: t.typography.fontFamily,
    color: t.colors.text,
    minHeight: 400,
  };

  const headerStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: t.spacing(4),
    marginBottom: t.spacing(4),
  };

  const leftHeaderStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: t.spacing(3),
  };

  const avatarStyle: React.CSSProperties = {
    width: 64,
    height: 64,
    borderRadius: "50%",
    background:
      "linear-gradient(135deg, rgba(68,193,193,0.18), rgba(15,42,54,0.9))",
    color: "#ffffff",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: 600,
    fontSize: "1.5rem",
    textTransform: "uppercase",
  };

  const nameStyle: React.CSSProperties = {
    fontWeight: t.typography.headingWeight,
    fontSize: "1.5rem",
    margin: 0,
  };

  const subtitleStyle: React.CSSProperties = {
    margin: 0,
    marginTop: t.spacing(0.5),
    fontSize: "0.9rem",
    color: t.colors.textMuted,
  };

  const cardStyle: React.CSSProperties = {
    backgroundColor: t.colors.surface,
    borderRadius: t.radius.lg,
    padding: t.spacing(4),
    marginBottom: t.spacing(4),
    boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
    border: `1px solid ${t.colors.border}`,
  };

  const sectionTitleStyle: React.CSSProperties = {
    fontSize: "0.75rem",
    color: t.colors.secondary,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    marginBottom: t.spacing(3),
  };

  const tabsWrapStyle: React.CSSProperties = {
    display: "flex",
    gap: t.spacing(2),
    borderBottom: `1px solid ${t.colors.border}`,
    marginBottom: t.spacing(3),
  };

  const tabStyle = (active: boolean): React.CSSProperties => ({
    padding: `${t.spacing(1.5)} ${t.spacing(2.5)}`,
    border: "none",
    borderBottom: active ? `2px solid ${t.colors.primary}` : "2px solid transparent",
    background: "none",
    cursor: "pointer",
    fontSize: "0.9rem",
    fontWeight: active ? 600 : 500,
    color: active ? t.colors.primary : t.colors.textMuted,
  });

  const initials =
    clientName
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0])
      .join("") || "C";

  return (
    <section className="client-detail-page" style={pageStyle}>
      <header style={headerStyle}>
        <div style={leftHeaderStyle}>
          <div style={avatarStyle} aria-hidden>
            {initials}
          </div>
          <div>
            <h2 style={nameStyle}>{clientName}</h2>
            <p style={subtitleStyle}>
              Relationship view for tasks, notes, and working files.
            </p>
          </div>
        </div>
      </header>

      <div style={cardStyle}>
        <div style={tabsWrapStyle}>
          <button type="button" style={tabStyle(true)} aria-selected>
            Overview
          </button>
          <button type="button" style={tabStyle(false)}>
            Files
          </button>
          <button type="button" style={tabStyle(false)}>
            Tasks
          </button>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1.2fr) minmax(0, 1.8fr)",
            gap: t.spacing(4),
          }}
        >
          <div>
            <h3 style={sectionTitleStyle}>Profile</h3>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(0, 1fr)",
                rowGap: t.spacing(2),
                fontSize: "0.9rem",
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: "0.75rem",
                    color: t.colors.textMuted,
                    textTransform: "uppercase",
                    letterSpacing: "0.04em",
                    marginBottom: t.spacing(0.5),
                  }}
                >
                  Primary contact
                </div>
                <div>Jane Doe</div>
              </div>
              <div>
                <div
                  style={{
                    fontSize: "0.75rem",
                    color: t.colors.textMuted,
                    textTransform: "uppercase",
                    letterSpacing: "0.04em",
                    marginBottom: t.spacing(0.5),
                  }}
                >
                  Email
                </div>
                <div>jane@example.com</div>
              </div>
              <div>
                <div
                  style={{
                    fontSize: "0.75rem",
                    color: t.colors.textMuted,
                    textTransform: "uppercase",
                    letterSpacing: "0.04em",
                    marginBottom: t.spacing(0.5),
                  }}
                >
                  Segment
                </div>
                <div>Top 20</div>
              </div>
            </div>
          </div>

          <div>
            <h3 style={sectionTitleStyle}>Working notes</h3>
            <p
              style={{
                fontSize: "0.9rem",
                color: t.colors.textMuted,
                lineHeight: 1.5,
                marginTop: 0,
              }}
            >
              Use this space as a scratchpad for what you’re doing next for this client:
              upcoming rolls, funding, talking points, or anything else you don’t want to
              lose between meetings.
            </p>
            <div
              style={{
                marginTop: t.spacing(2),
                padding: t.spacing(3),
                borderRadius: t.radius.md,
                border: `1px dashed ${t.colors.border}`,
                backgroundColor: t.colors.background,
                fontSize: "0.9rem",
                color: t.colors.textMuted,
              }}
            >
              Notes go here. (In a future version this could be a rich text area or link
              out to your CRM.)
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

