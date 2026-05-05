// Agent page — premium chat interface powered by Anthropic with live Schwab tool calls.
// Streams tokens in real-time; parses ```chart blocks and renders them via Recharts.

import { useEffect, useRef, useState } from "react";
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
  series: { key: string; label: string; color: string }[];
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
    typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v.slice(5) : v;

  return (
    <div
      style={{
        backgroundColor: t.colors.background,
        borderRadius: t.radius.md,
        border: `1px solid ${t.colors.border}`,
        padding: `${t.spacing(2)} ${t.spacing(3)} ${t.spacing(3)}`,
        marginTop: t.spacing(2),
      }}
    >
      {spec.title && (
        <p style={{ margin: `0 0 ${t.spacing(1.5)}`, fontSize: "0.76rem", fontWeight: 700, color: t.colors.textMuted, textTransform: "uppercase", letterSpacing: "0.05em", fontFamily: t.typography.fontFamily }}>
          {spec.title}
        </p>
      )}
      <ResponsiveContainer width="100%" height={200}>
        {spec.type === "bar" ? (
          <BarChart data={spec.data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={t.colors.border} />
            <XAxis dataKey={spec.xKey} tick={tickStyle} />
            <YAxis tick={tickStyle} />
            <Tooltip contentStyle={tooltipStyle} />
            {spec.series.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
            {spec.series.map((s) => (
              <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color} radius={[3, 3, 0, 0]} />
            ))}
          </BarChart>
        ) : (
          <LineChart data={spec.data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={t.colors.border} />
            <XAxis dataKey={spec.xKey} tick={tickStyle} tickFormatter={dateFormat} />
            <YAxis tick={tickStyle} domain={["auto", "auto"]} />
            <Tooltip contentStyle={tooltipStyle} labelFormatter={(v) => dateFormat(String(v))} />
            {spec.series.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
            {spec.series.map((s) => (
              <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color} dot={false} strokeWidth={2} />
            ))}
          </LineChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}

// --- Thinking dots (shown while streaming with no text yet) ---

function ThinkingDots({ t }: { t: Theme }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 0" }}>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          style={{
            display: "inline-block",
            width: 6,
            height: 6,
            borderRadius: "50%",
            backgroundColor: t.colors.textMuted,
            animation: `agent-thinking-dot 1.2s ease-in-out ${i * 0.2}s infinite`,
          }}
        />
      ))}
    </span>
  );
}

// --- Message content renderer ---

function MessageContent({ text, isStreaming, t }: { text: string; isStreaming: boolean; t: Theme }) {
  const segments = parseSegments(text);

  if (segments.length === 0) {
    return isStreaming ? <ThinkingDots t={t} /> : null;
  }

  return (
    <>
      {segments.map((seg, i) =>
        seg.kind === "chart" ? (
          <AgentChart key={i} spec={seg.spec} t={t} />
        ) : (
          <span key={i} style={{ whiteSpace: "pre-wrap" }}>
            {seg.content}
            {isStreaming && i === segments.length - 1 && (
              <span
                style={{
                  display: "inline-block",
                  width: 7,
                  height: "0.85em",
                  backgroundColor: t.colors.textMuted,
                  borderRadius: 2,
                  marginLeft: 3,
                  verticalAlign: "text-bottom",
                  animation: "agent-blink 0.9s step-end infinite",
                }}
                aria-hidden
              />
            )}
          </span>
        )
      )}
    </>
  );
}

// --- Tool call status strip (Cursor-style: compact, icon + short label) ---

function ToolStrip({ calls, t }: { calls: ActiveToolCall[]; t: Theme }) {
  if (calls.length === 0) return null;
  return (
    <div
      className="agent-message"
      style={{ alignSelf: "flex-start", display: "flex", flexWrap: "wrap", gap: t.spacing(1) }}
    >
      {calls.map((tc, i) => (
        <div
          key={i}
          className="agent-tool-pill"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: t.spacing(1),
            padding: `${t.spacing(0.6)} ${t.spacing(1.5)}`,
            backgroundColor: tc.done
              ? `${t.colors.secondary}12`
              : `${t.colors.border}`,
            border: `1px solid ${tc.done ? t.colors.secondary + "40" : t.colors.border}`,
            borderRadius: 6,
            fontSize: "0.73rem",
            color: tc.done ? t.colors.secondary : t.colors.textMuted,
            fontFamily: t.typography.fontFamily,
            fontWeight: 500,
            letterSpacing: "0.01em",
          }}
        >
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

// --- Main Agent page ---

export function Agent({ theme: t }: AgentProps) {
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<AgentMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      text: "Ask me anything about options, stocks, or the market. I have live Schwab data and will use it automatically.",
    },
  ]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [activeToolCalls, setActiveToolCalls] = useState<ActiveToolCall[]>([]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, activeToolCalls]);

  // Auto-resize textarea as user types
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [draft]);

  const canSend = draft.trim().length > 0 && !isStreaming;

  async function sendDraft() {
    const text = draft.trim();
    if (!text || isStreaming) return;

    const userMsg: AgentMessage = { id: `${Date.now()}-user`, role: "user", text };
    const assistantId = `${Date.now()}-assistant`;

    const history = [...messages.filter((m) => m.id !== "welcome"), userMsg];

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
          prev.map((m) =>
            m.id === assistantId ? { ...m, text: `Error ${resp.status}: ${errText.slice(0, 200)}` } : m
          )
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
                setMessages((prev) =>
                  prev.map((m) => (m.id === assistantId ? { ...m, text: fullText } : m))
                );
                break;
              case "tool_start":
                setActiveToolCalls((prev) => [
                  ...prev,
                  { name: event.name ?? "", label: event.label ?? "Working...", done: false },
                ]);
                break;
              case "tool_done":
                setActiveToolCalls((prev) =>
                  prev.map((tc) => (tc.name === event.name ? { ...tc, done: true } : tc))
                );
                break;
              case "error":
                fullText = fullText || (event.message ?? "An error occurred.");
                setMessages((prev) =>
                  prev.map((m) => (m.id === assistantId ? { ...m, text: fullText } : m))
                );
                break;
            }
          } catch { /* skip malformed lines */ }
        }
      }
    } catch {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId ? { ...m, text: "Network error — could not reach the agent." } : m
        )
      );
    } finally {
      setIsStreaming(false);
      setActiveToolCalls([]);
    }
  }

  // --- Layout ---

  return (
    <section
      className="agent-page page-card"
      style={{
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
        // Override page-card hover box-shadow since this is a full-page layout, not a card
        border: "none",
        boxShadow: "none",
        backgroundColor: "transparent",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: t.spacing(4),
          paddingBottom: t.spacing(3),
          borderBottom: `1px solid ${t.colors.border}`,
        }}
      >
        <h2
          style={{
            margin: 0,
            fontWeight: t.typography.headingWeight,
            fontSize: "1.625rem",
            color: t.colors.text,
            display: "inline-flex",
            alignItems: "center",
            gap: t.spacing(2),
          }}
        >
          <span
            className="material-symbols-outlined"
            style={{ fontSize: "1.5rem", color: t.colors.secondary, lineHeight: 1 }}
            aria-hidden
          >
            smart_toy
          </span>
          Agent
        </h2>

        {/* Status indicator */}
        <div style={{ display: "flex", alignItems: "center", gap: t.spacing(1.5) }}>
          <span
            style={{
              display: "inline-block",
              width: 7,
              height: 7,
              borderRadius: "50%",
              backgroundColor: isStreaming ? t.colors.secondary : `${t.colors.secondary}60`,
              boxShadow: isStreaming ? `0 0 6px ${t.colors.secondary}` : "none",
              transition: "box-shadow 0.3s ease, background-color 0.3s ease",
            }}
          />
          <span style={{ fontSize: "0.78rem", color: t.colors.textMuted, fontWeight: 600 }}>
            {isStreaming ? "Thinking…" : "claude sonnet 4.6"}
          </span>
        </div>
      </div>

      {/* Message thread */}
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
          // Scrollbar subtle
          scrollbarWidth: "thin",
          scrollbarColor: `${t.colors.border} transparent`,
        }}
      >
        {messages.map((m) => {
          const isUser = m.role === "user";
          const isThisStreaming =
            isStreaming && m.id === messages[messages.length - 1]?.id && !isUser;

          return (
            <div
              key={m.id}
              className="agent-message"
              style={{
                display: "flex",
                flexDirection: isUser ? "row-reverse" : "row",
                alignItems: "flex-start",
                gap: t.spacing(2),
              }}
            >
              {/* Avatar dot */}
              {!isUser && (
                <div
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: "50%",
                    backgroundColor: `${t.colors.secondary}20`,
                    border: `1px solid ${t.colors.secondary}40`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                    marginTop: 2,
                  }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 14, color: t.colors.secondary, lineHeight: 1 }} aria-hidden>
                    smart_toy
                  </span>
                </div>
              )}

              {/* Bubble */}
              <div
                style={{
                  maxWidth: "78%",
                  borderRadius: isUser ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
                  padding: `${t.spacing(2.5)} ${t.spacing(3)}`,
                  backgroundColor: isUser
                    ? t.colors.primary
                    : t.colors.surface,
                  color: isUser ? "#ffffff" : t.colors.text,
                  border: isUser ? "none" : `1px solid ${t.colors.border}`,
                  boxShadow: isUser
                    ? `0 2px 8px ${t.colors.primary}30`
                    : "0 1px 3px rgba(0,0,0,0.05)",
                  fontSize: "0.93rem",
                  lineHeight: 1.65,
                }}
              >
                <MessageContent text={m.text} isStreaming={isThisStreaming} t={t} />
              </div>
            </div>
          );
        })}

        {/* Tool call status */}
        <ToolStrip calls={activeToolCalls} t={t} />

        <div ref={messagesEndRef} />
      </div>

      {/* Input bar */}
      <div style={{ marginTop: t.spacing(3) }}>
        <div
          className="agent-input-wrap"
          style={{
            display: "flex",
            alignItems: "flex-end",
            gap: t.spacing(1.5),
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
                void sendDraft();
              }
            }}
            placeholder="Ask about options, stocks, or the market…"
            rows={1}
            disabled={isStreaming}
            aria-label="Message input"
            style={{
              flex: 1,
              border: "none",
              outline: "none",
              boxShadow: "none",
              background: "transparent",
              color: t.colors.text,
              fontFamily: t.typography.fontFamily,
              fontSize: "0.95rem",
              lineHeight: 1.55,
              resize: "none",
              padding: `${t.spacing(0.75)} ${t.spacing(1)}`,
              minHeight: 34,
              maxHeight: 140,
              overflowY: "auto",
              cursor: isStreaming ? "not-allowed" : "text",
              opacity: isStreaming ? 0.6 : 1,
            }}
          />
          <button
            type="button"
            className="agent-send-btn"
            onClick={() => void sendDraft()}
            disabled={!canSend}
            aria-label="Send message"
            title={canSend ? "Send" : isStreaming ? "Waiting…" : "Type a message"}
            style={{
              width: 36,
              height: 36,
              borderRadius: "50%",
              border: "none",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: canSend ? t.colors.primary : t.colors.border,
              color: canSend ? "#ffffff" : t.colors.textMuted,
              cursor: canSend ? "pointer" : "not-allowed",
              flexShrink: 0,
              marginBottom: 1,
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 18, lineHeight: 1 }} aria-hidden>
              arrow_upward
            </span>
          </button>
        </div>
        <p style={{ margin: `${t.spacing(1)} 0 0`, fontSize: "0.72rem", color: t.colors.textMuted, textAlign: "center" }}>
          Enter to send · Shift+Enter for new line
        </p>
      </div>
    </section>
  );
}
