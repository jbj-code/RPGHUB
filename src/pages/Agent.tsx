// Agent.tsx
// Premium chat interface with live Schwab tool calls and Recharts chart rendering.

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import type { Theme } from "../theme";
import { PAGE_LAYOUT } from "../theme";

// --- Types ---

type AgentProps = { theme: Theme };

type AgentMessage = {
  id: string;
  role: "assistant" | "user";
  text: string;
};

type ActiveToolCall = {
  name: string;
  label: string;
  done: boolean;
};

type ChartSpec = {
  type: "line" | "bar";
  title?: string;
  xKey: string;
  series: { key: string; label: string; color?: string }[];
  data: Record<string, unknown>[];
};

type Segment = { kind: "text"; content: string } | { kind: "chart"; spec: ChartSpec };

// --- Helpers ---

function parseSegments(text: string): Segment[] {
  const segments: Segment[] = [];
  const regex = /```chart\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const before = text.slice(lastIndex, match.index).trim();
    if (before) segments.push({ kind: "text", content: before });
    try {
      segments.push({ kind: "chart", spec: JSON.parse(match[1].trim()) as ChartSpec });
    } catch { /* skip malformed */ }
    lastIndex = match.index + match[0].length;
  }
  const after = text.slice(lastIndex).trim();
  if (after) segments.push({ kind: "text", content: after });
  return segments;
}

// --- Chart component ---

function AgentChart({ spec, t }: { spec: ChartSpec; t: Theme }) {
  const tooltipStyle: React.CSSProperties = {
    backgroundColor: t.colors.surface,
    border: `1px solid ${t.colors.border}`,
    borderRadius: 8,
    fontSize: "0.78rem",
    fontFamily: t.typography.fontFamily,
  };
  const tickStyle = { fontSize: 11, fill: t.colors.textMuted, fontFamily: t.typography.fontFamily };
  const dateFormat = (v: string) =>
    typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v.slice(5) : String(v);

  // Max ~10 labels on x-axis to prevent squishing
  const xInterval = Math.max(0, Math.ceil(spec.data.length / 10) - 1);

  // Default series color to primary brand color if not specified
  const seriesWithColor = spec.series.map((s) => ({
    ...s,
    color: s.color && s.color !== "#6366f1" ? s.color : t.colors.primary,
  }));

  return (
    <div
      style={{
        backgroundColor: t.colors.background,
        borderRadius: t.radius.md,
        border: `1px solid ${t.colors.border}`,
        padding: `${t.spacing(2)} ${t.spacing(3)} ${t.spacing(3)}`,
        marginBottom: t.spacing(2),
      }}
    >
      {spec.title && (
        <p style={{
          margin: `0 0 ${t.spacing(1.5)}`,
          fontSize: "0.76rem",
          fontWeight: 700,
          color: t.colors.textMuted,
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          fontFamily: t.typography.fontFamily,
        }}>
          {spec.title}
        </p>
      )}
      <ResponsiveContainer width="100%" height={200}>
        {spec.type === "bar" ? (
          <BarChart data={spec.data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={t.colors.border} />
            <XAxis dataKey={spec.xKey} tick={tickStyle} interval={xInterval} tickFormatter={dateFormat} />
            <YAxis tick={tickStyle} />
            <Tooltip contentStyle={tooltipStyle} />
            {seriesWithColor.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
            {seriesWithColor.map((s) => (
              <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color} radius={[3, 3, 0, 0]} />
            ))}
          </BarChart>
        ) : (
          <LineChart data={spec.data} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={t.colors.border} />
            <XAxis dataKey={spec.xKey} tick={tickStyle} interval={xInterval} tickFormatter={dateFormat} />
            <YAxis tick={tickStyle} domain={["auto", "auto"]} />
            <Tooltip contentStyle={tooltipStyle} labelFormatter={(v) => dateFormat(String(v))} />
            {seriesWithColor.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
            {seriesWithColor.map((s) => (
              <Line key={s.key} type="monotone" dataKey={s.key} name={s.label}
                stroke={s.color} dot={false} strokeWidth={2.5} />
            ))}
          </LineChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}

// --- Thinking dots ---

function ThinkingDots({ t }: { t: Theme }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 0" }}>
      {[0, 1, 2].map((i) => (
        <span key={i} style={{
          display: "inline-block", width: 6, height: 6, borderRadius: "50%",
          backgroundColor: t.colors.textMuted,
          animation: `agent-thinking-dot 1.2s ease-in-out ${i * 0.2}s infinite`,
        }} />
      ))}
    </span>
  );
}

// --- Markdown renderer (replaces raw pre-wrap spans) ---

function MarkdownContent({ text, t }: { text: string; t: Theme }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        // Headings
        h1: ({ children }) => <h3 style={{ margin: "12px 0 6px", fontSize: "1rem", fontWeight: 700, color: t.colors.text }}>{children}</h3>,
        h2: ({ children }) => <h3 style={{ margin: "12px 0 6px", fontSize: "0.95rem", fontWeight: 700, color: t.colors.text }}>{children}</h3>,
        h3: ({ children }) => <p style={{ margin: "10px 0 4px", fontSize: "0.87rem", fontWeight: 700, color: t.colors.text, textTransform: "uppercase", letterSpacing: "0.04em" }}>{children}</p>,
        // Paragraphs
        p: ({ children }) => <p style={{ margin: "0 0 8px", lineHeight: 1.65 }}>{children}</p>,
        // Bold / italic
        strong: ({ children }) => <strong style={{ fontWeight: 700, color: t.colors.text }}>{children}</strong>,
        em: ({ children }) => <em style={{ fontStyle: "italic", color: t.colors.textMuted }}>{children}</em>,
        // Tables
        table: ({ children }) => (
          <div style={{ overflowX: "auto", margin: "8px 0" }}>
            <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.85rem", fontFamily: t.typography.fontFamily }}>
              {children}
            </table>
          </div>
        ),
        thead: ({ children }) => <thead>{children}</thead>,
        tbody: ({ children }) => <tbody>{children}</tbody>,
        tr: ({ children }) => <tr>{children}</tr>,
        th: ({ children }) => (
          <th style={{
            borderBottom: `2px solid ${t.colors.border}`,
            padding: "6px 12px",
            textAlign: "left",
            fontWeight: 600,
            color: t.colors.textMuted,
            whiteSpace: "nowrap",
            fontSize: "0.8rem",
            textTransform: "uppercase",
            letterSpacing: "0.04em",
          }}>{children}</th>
        ),
        td: ({ children }) => (
          <td style={{
            borderBottom: `1px solid ${t.colors.border}`,
            padding: "6px 12px",
            whiteSpace: "nowrap",
            color: t.colors.text,
          }}>{children}</td>
        ),
        // Lists
        ul: ({ children }) => <ul style={{ margin: "4px 0 8px", paddingLeft: 20 }}>{children}</ul>,
        ol: ({ children }) => <ol style={{ margin: "4px 0 8px", paddingLeft: 20 }}>{children}</ol>,
        li: ({ children }) => <li style={{ marginBottom: 3, lineHeight: 1.6 }}>{children}</li>,
        // Inline code
        code: ({ children }) => (
          <code style={{
            fontFamily: "monospace",
            fontSize: "0.85em",
            backgroundColor: t.colors.background,
            border: `1px solid ${t.colors.border}`,
            borderRadius: 3,
            padding: "1px 5px",
          }}>{children}</code>
        ),
        // Horizontal rules → thin separator
        hr: () => <hr style={{ border: "none", borderTop: `1px solid ${t.colors.border}`, margin: "10px 0" }} />,
      }}
    >
      {text}
    </ReactMarkdown>
  );
}

// --- Message content (text + chart segments) ---

function MessageContent({ text, isStreaming, t }: { text: string; isStreaming: boolean; t: Theme }) {
  const segments = parseSegments(text);

  if (segments.length === 0) {
    return isStreaming ? <ThinkingDots t={t} /> : null;
  }

  return (
    <div style={{ width: "100%" }}>
      {segments.map((seg, i) =>
        seg.kind === "chart" ? (
          <AgentChart key={i} spec={seg.spec} t={t} />
        ) : (
          <div key={i} style={{ position: "relative" }}>
            <MarkdownContent text={seg.content} t={t} />
            {isStreaming && i === segments.length - 1 && (
              <span style={{
                display: "inline-block", width: 7, height: "0.85em",
                backgroundColor: t.colors.textMuted, borderRadius: 2,
                marginLeft: 3, verticalAlign: "text-bottom",
                animation: "agent-blink 0.9s step-end infinite",
              }} aria-hidden />
            )}
          </div>
        )
      )}
    </div>
  );
}

// --- Tool call pills (Cursor-style) ---

function ToolStrip({ calls, t }: { calls: ActiveToolCall[]; t: Theme }) {
  if (calls.length === 0) return null;
  return (
    <div className="agent-message" style={{ alignSelf: "flex-start", display: "flex", flexWrap: "wrap", gap: t.spacing(1) }}>
      {calls.map((tc, i) => (
        <div key={i} className="agent-tool-pill" style={{
          display: "inline-flex", alignItems: "center", gap: t.spacing(1),
          padding: `${t.spacing(0.6)} ${t.spacing(1.5)}`,
          backgroundColor: tc.done ? `${t.colors.secondary}12` : t.colors.border,
          border: `1px solid ${tc.done ? t.colors.secondary + "40" : t.colors.border}`,
          borderRadius: 6, fontSize: "0.73rem",
          color: tc.done ? t.colors.secondary : t.colors.textMuted,
          fontFamily: t.typography.fontFamily, fontWeight: 500, letterSpacing: "0.01em",
        }}>
          {tc.done ? (
            <span className="material-symbols-outlined" style={{ fontSize: 12, lineHeight: 1, color: t.colors.secondary }} aria-hidden>check</span>
          ) : (
            <span style={{ display: "inline-flex", gap: 2, alignItems: "center" }}>
              {[0, 1, 2].map((j) => (
                <span key={j} style={{ width: 3, height: 3, borderRadius: "50%", backgroundColor: "currentColor", animation: `agent-thinking-dot 1.0s ease-in-out ${j * 0.2}s infinite` }} />
              ))}
            </span>
          )}
          {tc.label}
        </div>
      ))}
    </div>
  );
}

// --- Empty state hero (shown when conversation is empty) ---

function EmptyState({ t, onSuggestion }: { t: Theme; onSuggestion: (text: string) => void }) {
  const suggestions = [
    "Is now a good time to buy a put on Unity?",
    "What are the best covered call opportunities this month?",
    "Show me Unity's price trend for the last 3 months",
    "Find the highest yield cash-secured puts expiring in June",
  ];

  return (
    <div style={{
      flex: 1, display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      gap: t.spacing(4), padding: `${t.spacing(4)} ${t.spacing(2)}`,
      textAlign: "center",
    }}>
      <div style={{
        width: 56, height: 56, borderRadius: "50%",
        backgroundColor: `${t.colors.secondary}18`,
        border: `2px solid ${t.colors.secondary}40`,
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <span className="material-symbols-outlined" style={{ fontSize: 26, color: t.colors.secondary }} aria-hidden>
          smart_toy
        </span>
      </div>

      <div>
        <h3 style={{ margin: "0 0 8px", fontSize: "1.4rem", fontWeight: 700, color: t.colors.text, fontFamily: t.typography.fontFamily }}>
          What can I help with?
        </h3>
        <p style={{ margin: 0, fontSize: "0.92rem", color: t.colors.textMuted, fontFamily: t.typography.fontFamily, maxWidth: 380 }}>
          Ask about options, stocks, or the market. I have live Schwab data and use it automatically.
        </p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: t.spacing(1.5), width: "100%", maxWidth: 440 }}>
        {suggestions.map((s, i) => (
          <button
            key={i}
            type="button"
            style={{
              textAlign: "left", padding: `${t.spacing(1.5)} ${t.spacing(2.5)}`,
              backgroundColor: t.colors.surface,
              border: `1px solid ${t.colors.border}`,
              borderRadius: t.radius.md,
              cursor: "pointer",
              fontFamily: t.typography.fontFamily,
              fontSize: "0.875rem",
              color: t.colors.text,
              transition: "border-color 0.15s, background-color 0.15s",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.borderColor = t.colors.secondary;
              (e.currentTarget as HTMLButtonElement).style.backgroundColor = `${t.colors.secondary}08`;
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.borderColor = t.colors.border;
              (e.currentTarget as HTMLButtonElement).style.backgroundColor = t.colors.surface;
            }}
            onClick={() => onSuggestion(s)}
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

// --- Main Agent page ---

export function Agent({ theme: t }: AgentProps) {
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [activeToolCalls, setActiveToolCalls] = useState<ActiveToolCall[]>([]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, activeToolCalls]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [draft]);

  const canSend = draft.trim().length > 0 && !isStreaming;

  async function sendMessage(text: string) {
    const trimmed = text.trim();
    if (!trimmed || isStreaming) return;

    const userMsg: AgentMessage = { id: `${Date.now()}-user`, role: "user", text: trimmed };
    const assistantId = `${Date.now()}-assistant`;
    const history = [...messages, userMsg];

    setMessages((prev) => [...prev, userMsg, { id: assistantId, role: "assistant", text: "" }]);
    setDraft("");
    setIsStreaming(true);
    setActiveToolCalls([]);

    try {
      const resp = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: history.map((m) => ({ role: m.role, content: m.text })),
        }),
      });

      if (!resp.ok || !resp.body) {
        const errText = await resp.text().catch(() => "Unknown error");
        setMessages((prev) =>
          prev.map((m) => m.id === assistantId ? { ...m, text: `Error ${resp.status}: ${errText.slice(0, 200)}` } : m)
        );
        return;
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let fullText = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const event = JSON.parse(line) as { type: string; delta?: string; name?: string; label?: string; message?: string };
            switch (event.type) {
              case "text":
                fullText += event.delta ?? "";
                setMessages((prev) => prev.map((m) => m.id === assistantId ? { ...m, text: fullText } : m));
                break;
              case "tool_start":
                setActiveToolCalls((prev) => [...prev, { name: event.name ?? "", label: event.label ?? "Working...", done: false }]);
                break;
              case "tool_done":
                setActiveToolCalls((prev) => prev.map((tc) => tc.name === event.name ? { ...tc, done: true } : tc));
                break;
              case "error":
                fullText = fullText || (event.message ?? "An error occurred.");
                setMessages((prev) => prev.map((m) => m.id === assistantId ? { ...m, text: fullText } : m));
                break;
            }
          } catch { /* skip malformed lines */ }
        }
      }
    } catch {
      setMessages((prev) =>
        prev.map((m) => m.id === assistantId ? { ...m, text: "Network error — could not reach the agent." } : m)
      );
    } finally {
      setIsStreaming(false);
      setActiveToolCalls([]);
    }
  }

  // --- Layout: fixed-height column so messages scroll and input stays pinned at bottom ---

  return (
    <section
      className="agent-page page-card"
      style={{
        maxWidth: PAGE_LAYOUT.maxWidth,
        width: "100%",
        margin: "0 auto",
        padding: `${t.spacing(5)} ${t.spacing(PAGE_LAYOUT.pagePaddingH)} 0`,
        boxSizing: "border-box",
        fontFamily: t.typography.fontFamily,
        color: t.colors.text,
        height: "calc(100vh - 80px)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        border: "none",
        boxShadow: "none",
        backgroundColor: "transparent",
      }}
    >
      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        marginBottom: t.spacing(3), paddingBottom: t.spacing(3),
        borderBottom: `1px solid ${t.colors.border}`,
        flexShrink: 0,
      }}>
        <h2 style={{
          margin: 0, fontWeight: t.typography.headingWeight,
          fontSize: "1.625rem", color: t.colors.text,
          display: "inline-flex", alignItems: "center", gap: t.spacing(2),
        }}>
          <span className="material-symbols-outlined" style={{ fontSize: "1.5rem", color: t.colors.secondary, lineHeight: 1 }} aria-hidden>smart_toy</span>
          Agent
        </h2>
        <div style={{ display: "flex", alignItems: "center", gap: t.spacing(1.5) }}>
          <span style={{
            display: "inline-block", width: 7, height: 7, borderRadius: "50%",
            backgroundColor: isStreaming ? t.colors.secondary : `${t.colors.secondary}60`,
            boxShadow: isStreaming ? `0 0 6px ${t.colors.secondary}` : "none",
            transition: "box-shadow 0.3s ease, background-color 0.3s ease",
          }} />
          <span style={{ fontSize: "0.78rem", color: t.colors.textMuted, fontWeight: 600 }}>
            {isStreaming ? "Thinking…" : "claude sonnet 4.6"}
          </span>
        </div>
      </div>

      {/* Messages — scrollable, fills available space */}
      <div
        role="log"
        aria-live="polite"
        aria-label="Conversation"
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: t.spacing(2.5),
          paddingBottom: t.spacing(2),
          scrollbarWidth: "thin",
          scrollbarColor: `${t.colors.border} transparent`,
        }}
      >
        {messages.length === 0 ? (
          <EmptyState t={t} onSuggestion={(s) => void sendMessage(s)} />
        ) : (
          messages.map((m) => {
            const isUser = m.role === "user";
            const isThisStreaming = isStreaming && m.id === messages[messages.length - 1]?.id && !isUser;

            return (
              <div key={m.id} className="agent-message" style={{
                display: "flex", flexDirection: isUser ? "row-reverse" : "row",
                alignItems: "flex-start", gap: t.spacing(2),
              }}>
                {!isUser && (
                  <div style={{
                    width: 28, height: 28, borderRadius: "50%",
                    backgroundColor: `${t.colors.secondary}20`,
                    border: `1px solid ${t.colors.secondary}40`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    flexShrink: 0, marginTop: 2,
                  }}>
                    <span className="material-symbols-outlined" style={{ fontSize: 14, color: t.colors.secondary, lineHeight: 1 }} aria-hidden>smart_toy</span>
                  </div>
                )}
                <div style={{
                  maxWidth: "82%",
                  borderRadius: isUser ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
                  padding: `${t.spacing(2.5)} ${t.spacing(3)}`,
                  backgroundColor: isUser ? t.colors.primary : t.colors.surface,
                  color: isUser ? t.colors.onPrimary : t.colors.text,
                  border: isUser ? "none" : `1px solid ${t.colors.border}`,
                  boxShadow: isUser ? `0 2px 8px ${t.colors.primary}30` : "0 1px 3px rgba(0,0,0,0.05)",
                  fontSize: "0.93rem",
                  lineHeight: 1.65,
                  minWidth: isUser ? undefined : 0,
                  overflow: "hidden",
                }}>
                  {isUser ? (
                    <span>{m.text}</span>
                  ) : (
                    <MessageContent text={m.text} isStreaming={isThisStreaming} t={t} />
                  )}
                </div>
              </div>
            );
          })
        )}

        <ToolStrip calls={activeToolCalls} t={t} />
        <div ref={messagesEndRef} />
      </div>

      {/* Input bar — pinned at bottom, never scrolls away */}
      <div style={{
        flexShrink: 0,
        paddingBottom: t.spacing(3),
        paddingTop: t.spacing(2),
        backgroundColor: "transparent",
      }}>
        <div
          className="agent-input-wrap"
          style={{
            display: "flex", alignItems: "flex-end", gap: t.spacing(1.5),
            backgroundColor: t.colors.surface,
            border: `1px solid ${t.colors.border}`,
            borderRadius: 18,
            padding: `${t.spacing(1.25)} ${t.spacing(1.5)}`,
            boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
          }}
        >
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void sendMessage(draft);
              }
            }}
            placeholder="Ask about options, stocks, or the market…"
            rows={1}
            disabled={isStreaming}
            aria-label="Message input"
            style={{
              flex: 1, border: "none", outline: "none", boxShadow: "none",
              background: "transparent", color: t.colors.text,
              fontFamily: t.typography.fontFamily, fontSize: "0.95rem",
              lineHeight: 1.55, resize: "none",
              padding: `${t.spacing(0.75)} ${t.spacing(1)}`,
              minHeight: 34, maxHeight: 140, overflowY: "auto",
              cursor: isStreaming ? "not-allowed" : "text",
              opacity: isStreaming ? 0.6 : 1,
            }}
          />
          <button
            type="button"
            className="agent-send-btn"
            onClick={() => void sendMessage(draft)}
            disabled={!canSend}
            aria-label="Send message"
            style={{
              width: 36, height: 36, borderRadius: "50%", border: "none",
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              backgroundColor: canSend ? t.colors.primary : t.colors.border,
              color: canSend ? t.colors.onPrimary : t.colors.textMuted,
              cursor: canSend ? "pointer" : "not-allowed",
              flexShrink: 0, marginBottom: 1,
              transition: "background-color 0.15s",
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 18, lineHeight: 1 }} aria-hidden>arrow_upward</span>
          </button>
        </div>
        <p style={{ margin: `${t.spacing(1)} 0 0`, fontSize: "0.72rem", color: t.colors.textMuted, textAlign: "center" }}>
          Enter to send · Shift+Enter for new line
        </p>
      </div>
    </section>
  );
}
