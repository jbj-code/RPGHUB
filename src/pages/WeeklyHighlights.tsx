import { useMemo, useState } from "react";
import type { Theme } from "../theme";
import { PAGE_LAYOUT } from "../theme";

type WeeklyHighlightsProps = { theme: Theme };

function buildPrompt(weekEnding: string, extraNotes: string): string {
  const datePart = weekEnding
    ? ` for the week ending ${weekEnding}`
    : " for the past week";

  const base = `You are a calm, neutral financial writer.
Write 4 short, self-contained paragraphs that could be used as the "weekly highlights" section at the top of a client letter${datePart}.

Constraints:
- Neutral, non-sensational tone. No predictions, no recommendations, no advice.
- Explain what happened and why it matters in plain English.
- Focus on big-picture themes across markets and the economy, not ticker-by-ticker moves.
- Each paragraph should stand alone around a single theme or story.
- Avoid jargon where possible; if you use a term, briefly explain it.
- Keep the total length around 400–600 words.

Output format:
- Paragraph 1
- Paragraph 2
- Paragraph 3
- Paragraph 4`;

  const trimmedNotes = extraNotes.trim();

  if (!trimmedNotes) return base;

  return `${base}

Additional context to reflect in the choice of stories and framing (do not quote this section, just use it as background): ${trimmedNotes}`;
}

export function WeeklyHighlights({ theme: t }: WeeklyHighlightsProps) {
  const [weekEnding, setWeekEnding] = useState("");
  const [notes, setNotes] = useState("");
  const [copied, setCopied] = useState(false);

  const prompt = useMemo(() => buildPrompt(weekEnding, notes), [weekEnding, notes]);

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
    display: "grid",
    gridTemplateColumns: "minmax(0, 1.1fr) minmax(0, 1.4fr)",
    gap: t.spacing(5),
  };

  const labelStyle: React.CSSProperties = {
    display: "block",
    fontSize: "0.8rem",
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    color: t.colors.textMuted,
    marginBottom: t.spacing(1),
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: `${t.spacing(1.5)} ${t.spacing(2)}`,
    borderRadius: t.radius.sm,
    border: `1px solid ${t.colors.border}`,
    backgroundColor: t.colors.background,
    color: t.colors.text,
    fontFamily: t.typography.fontFamily,
    fontSize: t.typography.baseFontSize,
  };

  const textareaStyle: React.CSSProperties = {
    ...inputStyle,
    minHeight: 120,
    resize: "vertical",
  };

  const promptBoxStyle: React.CSSProperties = {
    ...inputStyle,
    minHeight: 260,
    whiteSpace: "pre-wrap",
    overflowY: "auto",
    backgroundColor: t.colors.background,
  };

  const buttonRowStyle: React.CSSProperties = {
    display: "flex",
    flexWrap: "wrap",
    gap: t.spacing(2),
    marginTop: t.spacing(2),
  };

  const primaryButtonStyle: React.CSSProperties = {
    padding: `${t.spacing(1.75)} ${t.spacing(3.5)}`,
    borderRadius: t.radius.sm,
    border: "none",
    backgroundColor: t.colors.primary,
    color: "#fff",
    fontFamily: t.typography.fontFamily,
    fontWeight: 600,
    cursor: "pointer",
    fontSize: "0.95rem",
    display: "inline-flex",
    alignItems: "center",
    gap: t.spacing(1),
  };

  const secondaryButtonStyle: React.CSSProperties = {
    ...primaryButtonStyle,
    backgroundColor: "transparent",
    color: t.colors.text,
    border: `1px solid ${t.colors.border}`,
  };

  const handleCopyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section className="weekly-highlights-page" style={pageStyle}>
      <h2 style={titleStyle}>Weekly Highlights</h2>
      <p style={descStyle}>
        This is a prompt builder only. Set the week (optional), add any extra context,
        then copy the prompt into Gemini, ChatGPT, or another model to get your
        3–5 weekly highlight paragraphs. Partners can then drop in their own voice.
      </p>

      <div className="page-card" style={cardStyle}>
        <div style={{ display: "flex", flexDirection: "column", gap: t.spacing(3) }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: t.spacing(3) }}>
            <div>
              <label style={labelStyle} htmlFor="wh-week-ending">
                Week ending (optional)
              </label>
              <input
                id="wh-week-ending"
                type="date"
                value={weekEnding}
                onChange={(e) => setWeekEnding(e.target.value)}
                style={inputStyle}
              />
            </div>
          </div>

          <div>
            <label style={labelStyle} htmlFor="wh-notes">
              Extra context for this week (optional)
            </label>
            <textarea
              id="wh-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              style={textareaStyle}
              placeholder="E.g. big Fed meeting, notable sector moves, anything you definitely want mentioned or avoided."
            />
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: t.spacing(2) }}>
          <label style={labelStyle}>Prompt to paste into your AI tool</label>
          <div style={promptBoxStyle}>{prompt}</div>
          <div style={buttonRowStyle}>
            <button type="button" style={primaryButtonStyle} onClick={handleCopyPrompt}>
              <span className="material-symbols-outlined" style={{ fontSize: 20 }} aria-hidden>
                content_copy
              </span>
              {copied ? "Copied" : "Copy prompt"}
            </button>
            <a
              href="https://chat.openai.com/"
              target="_blank"
              rel="noopener noreferrer"
              style={secondaryButtonStyle}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 20 }} aria-hidden>
                open_in_new
              </span>
              Open ChatGPT
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

