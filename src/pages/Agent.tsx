import { useMemo, useState } from "react";
import type { Theme } from "../theme";
import { PAGE_LAYOUT } from "../theme";

type AgentProps = { theme: Theme };
type AgentMessage = { id: string; role: "assistant" | "user"; text: string };

export function Agent({ theme: t }: AgentProps) {
  const [scope, setScope] = useState<"options" | "stocks">("options");
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<AgentMessage[]>([
    {
      id: "assistant-seed",
      role: "assistant",
      text: "Ask me anything about options and I will answer with tool-assisted context once the API is connected.",
    },
    {
      id: "user-seed",
      role: "user",
      text: "What are the best put-selling opportunities this week for high-quality large caps?",
    },
  ]);

  const pageStyle: React.CSSProperties = {
    maxWidth: PAGE_LAYOUT.maxWidth,
    width: "100%",
    margin: "0 auto",
    padding: `${t.spacing(5)} ${t.spacing(PAGE_LAYOUT.pagePaddingH)} ${t.spacing(4)}`,
    boxSizing: "border-box",
    fontFamily: t.typography.fontFamily,
    color: t.colors.text,
    minHeight: "calc(100vh - 80px)",
    display: "flex",
    flexDirection: "column",
  };

  const titleStyle: React.CSSProperties = {
    fontWeight: t.typography.headingWeight,
    fontSize: "1.625rem",
    color: t.colors.text,
    marginBottom: t.spacing(1),
  };

  const descStyle: React.CSSProperties = {
    color: t.colors.textMuted,
    fontSize: "0.95rem",
    lineHeight: 1.5,
    marginBottom: t.spacing(3),
  };

  const shellStyle: React.CSSProperties = {
    flex: 1,
    minHeight: 0,
    backgroundColor: "transparent",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  };

  const selectedScopeLabel = useMemo(
    () => (scope === "options" ? "Options" : "Stocks"),
    [scope]
  );
  const canSend = draft.trim().length > 0;

  function sendDraft() {
    const text = draft.trim();
    if (!text) return;
    setMessages((prev) => [
      ...prev,
      { id: `${Date.now()}-user`, role: "user", text },
      {
        id: `${Date.now()}-assistant`,
        role: "assistant",
        text: "API is not connected yet. Once you add your key, I can reply and use tools behind the scenes.",
      },
    ]);
    setDraft("");
  }

  return (
    <section className="agent-page" style={pageStyle}>
      <h2 style={titleStyle}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: t.spacing(2) }}>
          <span className="material-symbols-outlined" style={{ fontSize: "1.5rem", color: t.colors.secondary }} aria-hidden>
            smart_toy
          </span>
          Agent
        </span>
      </h2>

      <p style={descStyle}>
        AI-first workspace for leadership Q&A. Tools run behind the scenes; users just chat.
      </p>

      <div style={shellStyle}>
        <div
          style={{
            padding: `${t.spacing(1)} 0 ${t.spacing(2)}`,
            borderBottom: `1px solid ${t.colors.border}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: t.spacing(2),
            flexWrap: "wrap",
            backgroundColor: "transparent",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: t.spacing(1.5), flexWrap: "wrap" }}>
            <span
              style={{
                fontSize: "0.75rem",
                color: t.colors.textMuted,
                textTransform: "uppercase",
                letterSpacing: "0.04em",
                fontWeight: 600,
              }}
            >
              Scope
            </span>
            {(["options", "stocks"] as const).map((value) => {
              const active = scope === value;
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => setScope(value)}
                  style={{
                    border: `1px solid ${active ? t.colors.primary : t.colors.border}`,
                    backgroundColor: active ? `${t.colors.primary}14` : t.colors.background,
                    color: active ? t.colors.primary : t.colors.textMuted,
                    borderRadius: 999,
                    padding: `${t.spacing(0.9)} ${t.spacing(2)}`,
                    fontSize: "0.8rem",
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                  aria-pressed={active}
                >
                  {value === "options" ? "Options" : "Stocks"}
                </button>
              );
            })}
          </div>
          <span style={{ fontSize: "0.8rem", color: t.colors.textMuted }}>
            API not connected yet
          </span>
        </div>

        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            padding: `${t.spacing(2)} 0`,
            display: "flex",
            flexDirection: "column",
            gap: t.spacing(2),
            backgroundColor: "transparent",
          }}
        >
          {messages.map((m) => {
            const isUser = m.role === "user";
            return (
              <div
                key={m.id}
                style={{
                  alignSelf: isUser ? "flex-end" : "flex-start",
                  maxWidth: "82%",
                  border: `1px solid ${t.colors.border}`,
                  borderRadius: 14,
                  padding: t.spacing(2.75),
                  backgroundColor: isUser ? `${t.colors.primary}10` : t.colors.surface,
                }}
              >
                <div style={{ fontSize: "0.78rem", color: t.colors.textMuted, marginBottom: t.spacing(0.75) }}>
                  {isUser ? "You" : "Agent"}
                </div>
                <div style={{ fontSize: "0.93rem", color: t.colors.text, lineHeight: 1.6 }}>
                  {m.role === "assistant" && m.id === "assistant-seed"
                    ? `Ask me anything about ${selectedScopeLabel.toLowerCase()} and I will answer with tool-assisted context once the API is connected.`
                    : m.text}
                </div>
              </div>
            );
          })}
        </div>

        <div
          style={{
            borderTop: `1px solid ${t.colors.border}`,
            padding: `${t.spacing(2)} 0 0`,
            backgroundColor: "transparent",
          }}
        >
          <div
            style={{
              display: "flex",
              gap: t.spacing(1.5),
              alignItems: "flex-end",
              border: `1px solid ${t.colors.border}`,
              borderRadius: 18,
              padding: t.spacing(1),
              backgroundColor: t.colors.surface,
            }}
          >
            <textarea
              id="agent-chat-input"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  sendDraft();
                }
              }}
              placeholder={`Message Agent about ${selectedScopeLabel.toLowerCase()}...`}
              rows={1}
              style={{
                flex: 1,
                minWidth: 220,
                border: "none",
                outline: "none",
                boxShadow: "none",
                background: "transparent",
                color: t.colors.text,
                fontFamily: t.typography.fontFamily,
                fontSize: "0.98rem",
                lineHeight: 1.5,
                resize: "none",
                padding: `${t.spacing(1.6)} ${t.spacing(2)}`,
                maxHeight: 140,
              }}
            />
            <button
              type="button"
              onClick={sendDraft}
              disabled={!canSend}
              title={canSend ? "Send message" : "Type a message"}
              style={{
                width: 42,
                height: 42,
                minWidth: 42,
                borderRadius: "50%",
                border: "none",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: canSend ? t.colors.primary : `${t.colors.border}`,
                color: canSend ? "#FFFFFF" : t.colors.textMuted,
                cursor: canSend ? "pointer" : "not-allowed",
                alignSelf: "flex-end",
                transition: "transform 0.15s ease, opacity 0.15s ease",
              }}
              aria-label="Send message"
            >
              <span className="material-symbols-outlined" style={{ fontSize: 20, lineHeight: 1 }} aria-hidden>
                arrow_upward
              </span>
            </button>
          </div>
          <div style={{ marginTop: t.spacing(1), fontSize: "0.74rem", color: t.colors.textMuted }}>
            Press Enter to send, Shift+Enter for a new line.
          </div>
        </div>
      </div>
    </section>
  );
}

