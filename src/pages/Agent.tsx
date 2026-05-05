// Agent page — chat interface powered by Anthropic with live Schwab tool calls.
// Streams tokens in real-time; parses ```chart blocks and renders them via Recharts.

import { useEffect, useRef, useState } from "react";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
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

/** Split message text into text segments and embedded chart specs. */
function parseSegments(text: string): Segment[] {
  const segments: Segment[] = [];
  const regex = /```chart\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const before = text.slice(lastIndex, match.index).trim();
    if (before) segments.push({ kind: "text", content: before });
    try {
      const spec = JSON.parse(match[1].trim()) as ChartSpec;
      segments.push({ kind: "chart", spec });
    } catch {
      // Malformed chart JSON — skip silently
    }
    lastIndex = match.index + match[0].length;
  }

  const after = text.slice(lastIndex).trim();
  if (after) segments.push({ kind: "text", content: after });
  return segments;
}

// --- Chart component ---

function AgentChart({ spec, t }: { spec: ChartSpec; t: Theme }) {
  const chartStyle: React.CSSProperties = {
    backgroundColor: t.colors.background,
    borderRadius: t.radius.md,
    border: `1px solid ${t.colors.border}`,
    padding: `${t.spacing(2)} ${t.spacing(3)} ${t.spacing(3)}`,
    marginTop: t.spacing(2),
  };

  const titleStyle: React.CSSProperties = {
    margin: `0 0 ${t.spacing(2)}`,
    fontSize: "0.78rem",
    fontWeight: 600,
    color: t.colors.textMuted,
    fontFamily: t.typography.fontFamily,
  };

  const tooltipStyle: React.CSSProperties = {
    backgroundColor: t.colors.surface,
    border: `1px solid ${t.colors.border}`,
    borderRadius: 8,
    fontSize: "0.78rem",
    fontFamily: t.typography.fontFamily,
  };

  const tickStyle = { fontSize: 11, fill: t.colors.textMuted, fontFamily: t.typography.fontFamily };

  // Shorten YYYY-MM-DD date labels on the X axis to MM/DD for line charts
  const dateTickFormatter = (v: string) =>
    typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v.slice(5) : v;

  return (
    <div style={chartStyle}>
      {spec.title && <p style={titleStyle}>{spec.title}</p>}
      <ResponsiveContainer width="100%" height={200}>
        {spec.type === "bar" ? (
          <BarChart data={spec.data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={t.colors.border} />
            <XAxis dataKey={spec.xKey} tick={tickStyle} />
            <YAxis tick={tickStyle} />
            <Tooltip contentStyle={tooltipStyle} />
            {spec.series.length > 1 && (
              <Legend wrapperStyle={{ fontSize: 11, fontFamily: t.typography.fontFamily }} />
            )}
            {spec.series.map((s) => (
              <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color} radius={[3, 3, 0, 0]} />
            ))}
          </BarChart>
        ) : (
          <LineChart data={spec.data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={t.colors.border} />
            <XAxis dataKey={spec.xKey} tick={tickStyle} tickFormatter={dateTickFormatter} />
            <YAxis tick={tickStyle} domain={["auto", "auto"]} />
            <Tooltip contentStyle={tooltipStyle} labelFormatter={(v) => dateTickFormatter(String(v))} />
            {spec.series.length > 1 && (
              <Legend wrapperStyle={{ fontSize: 11, fontFamily: t.typography.fontFamily }} />
            )}
            {spec.series.map((s) => (
              <Line
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={s.label}
                stroke={s.color}
                dot={false}
                strokeWidth={2}
              />
            ))}
          </LineChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}

// --- Message bubble content ---

function MessageContent({ text, isStreaming, t }: { text: string; isStreaming: boolean; t: Theme }) {
  const segments = parseSegments(text);

  if (segments.length === 0) {
    // Show cursor while streaming and no text yet
    return isStreaming ? (
      <span
        style={{
          display: "inline-block",
          width: 8,
          height: "1em",
          backgroundColor: t.colors.textMuted,
          borderRadius: 2,
          animation: "agent-blink 1s step-end infinite",
        }}
        aria-label="typing"
      />
    ) : null;
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
                  marginLeft: 2,
                  verticalAlign: "text-bottom",
                  animation: "agent-blink 1s step-end infinite",
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

// --- Main Agent page ---

export function Agent({ theme: t }: AgentProps) {
  const [scope, setScope] = useState<"options" | "stocks">("options");
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<AgentMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      text: "Ask me anything about options or stocks and I'll pull live Schwab data to answer.",
    },
  ]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [activeToolCalls, setActiveToolCalls] = useState<ActiveToolCall[]>([]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom when new content arrives
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, activeToolCalls]);

  // Auto-resize textarea
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
    const assistantMsg: AgentMessage = { id: assistantId, role: "assistant", text: "" };

    // Build the conversation history for the API (exclude the welcome message)
    const history = [...messages.filter((m) => m.id !== "welcome"), userMsg];

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setDraft("");
    setIsStreaming(true);
    setActiveToolCalls([]);

    try {
      const resp = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scope,
          messages: history.map((m) => ({ role: m.role, content: m.text })),
        }),
      });

      if (!resp.ok || !resp.body) {
        const errText = await resp.text().catch(() => "Unknown error");
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, text: `Error ${resp.status}: ${errText.slice(0, 200)}` }
              : m
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
            const event = JSON.parse(line) as {
              type: string;
              delta?: string;
              name?: string;
              label?: string;
              message?: string;
            };

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
                  prev.map((tc) =>
                    tc.name === event.name ? { ...tc, done: true } : tc
                  )
                );
                break;

              case "error":
                fullText = fullText || (event.message ?? "An unexpected error occurred.");
                setMessages((prev) =>
                  prev.map((m) => (m.id === assistantId ? { ...m, text: fullText } : m))
                );
                break;

              case "done":
                break;
            }
          } catch {
            // Skip any malformed lines
          }
        }
      }
    } catch {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? { ...m, text: "Network error — could not reach the agent." }
            : m
        )
      );
    } finally {
      setIsStreaming(false);
      setActiveToolCalls([]);
    }
  }

  // --- Styles (all from theme — no magic values) ---

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
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  };

  const toolbarStyle: React.CSSProperties = {
    padding: `${t.spacing(1)} 0 ${t.spacing(2)}`,
    borderBottom: `1px solid ${t.colors.border}`,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: t.spacing(2),
    flexWrap: "wrap",
  };

  const messagesStyle: React.CSSProperties = {
    flex: 1,
    minHeight: 0,
    overflowY: "auto",
    padding: `${t.spacing(2)} 0`,
    display: "flex",
    flexDirection: "column",
    gap: t.spacing(2),
  };

  const inputBarStyle: React.CSSProperties = {
    borderTop: `1px solid ${t.colors.border}`,
    padding: `${t.spacing(2)} 0 0`,
  };

  return (
    <>
      {/* Blinking cursor animation */}
      <style>{`@keyframes agent-blink { 0%,100%{opacity:1} 50%{opacity:0} }`}</style>

      <section className="agent-page" style={pageStyle}>
        <h2 style={titleStyle}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: t.spacing(2) }}>
            <span
              className="material-symbols-outlined"
              style={{ fontSize: "1.5rem", color: t.colors.secondary }}
              aria-hidden
            >
              smart_toy
            </span>
            Agent
          </span>
        </h2>

        <p style={descStyle}>
          Chat with the hub. Ask about options, stocks, or your portfolio — tools run in the background.
        </p>

        <div style={shellStyle}>
          {/* Scope selector + status */}
          <div style={toolbarStyle}>
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
                    disabled={isStreaming}
                    style={{
                      border: `1px solid ${active ? t.colors.primary : t.colors.border}`,
                      backgroundColor: active ? `${t.colors.primary}14` : t.colors.background,
                      color: active ? t.colors.primary : t.colors.textMuted,
                      borderRadius: 999,
                      padding: `${t.spacing(0.9)} ${t.spacing(2)}`,
                      fontSize: "0.8rem",
                      fontWeight: 700,
                      cursor: isStreaming ? "not-allowed" : "pointer",
                      opacity: isStreaming ? 0.6 : 1,
                    }}
                    aria-pressed={active}
                  >
                    {value === "options" ? "Options" : "Stocks"}
                  </button>
                );
              })}
            </div>
            <span style={{ fontSize: "0.8rem", color: isStreaming ? t.colors.secondary : t.colors.textMuted }}>
              {isStreaming ? "Thinking..." : "Claude 3.5 Sonnet"}
            </span>
          </div>

          {/* Message thread */}
          <div style={messagesStyle} role="log" aria-live="polite" aria-label="Conversation">
            {messages.map((m) => {
              const isUser = m.role === "user";
              const isThisStreaming = isStreaming && m.id === messages[messages.length - 1]?.id && !isUser;
              return (
                <div
                  key={m.id}
                  style={{
                    alignSelf: isUser ? "flex-end" : "flex-start",
                    maxWidth: "85%",
                    border: `1px solid ${t.colors.border}`,
                    borderRadius: 14,
                    padding: t.spacing(2.75),
                    backgroundColor: isUser ? `${t.colors.primary}10` : t.colors.surface,
                  }}
                >
                  <div
                    style={{
                      fontSize: "0.78rem",
                      color: t.colors.textMuted,
                      marginBottom: t.spacing(0.75),
                      fontWeight: 600,
                    }}
                  >
                    {isUser ? "You" : "Agent"}
                  </div>
                  <div
                    style={{
                      fontSize: "0.93rem",
                      color: t.colors.text,
                      lineHeight: 1.65,
                    }}
                  >
                    <MessageContent text={m.text} isStreaming={isThisStreaming} t={t} />
                  </div>
                </div>
              );
            })}

            {/* Tool call status pills (shown while tools are running) */}
            {activeToolCalls.length > 0 && (
              <div
                style={{
                  alignSelf: "flex-start",
                  display: "flex",
                  flexDirection: "column",
                  gap: t.spacing(1),
                }}
              >
                {activeToolCalls.map((tc, i) => (
                  <div
                    key={i}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: t.spacing(1.5),
                      padding: `${t.spacing(1)} ${t.spacing(2)}`,
                      backgroundColor: tc.done ? `${t.colors.secondary}14` : `${t.colors.primary}10`,
                      border: `1px solid ${tc.done ? t.colors.secondary : t.colors.primary}40`,
                      borderRadius: 999,
                      fontSize: "0.78rem",
                      color: tc.done ? t.colors.secondary : t.colors.primary,
                      fontFamily: t.typography.fontFamily,
                      fontWeight: 600,
                    }}
                  >
                    <span
                      className="material-symbols-outlined"
                      style={{ fontSize: 14, lineHeight: 1 }}
                      aria-hidden
                    >
                      {tc.done ? "check_circle" : "data_thresholding"}
                    </span>
                    {tc.done ? tc.label.replace(/\.\.\.$/, " ✓") : tc.label}
                  </div>
                ))}
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input bar */}
          <div style={inputBarStyle}>
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
                ref={textareaRef}
                id="agent-chat-input"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void sendDraft();
                  }
                }}
                placeholder={`Ask about ${scope === "options" ? "options" : "stocks"}…`}
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
                  overflowY: "auto",
                }}
                disabled={isStreaming}
                aria-label="Message input"
              />
              <button
                type="button"
                onClick={() => void sendDraft()}
                disabled={!canSend}
                title={canSend ? "Send" : isStreaming ? "Waiting for response…" : "Type a message"}
                style={{
                  width: 42,
                  height: 42,
                  minWidth: 42,
                  borderRadius: "50%",
                  border: "none",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: canSend ? t.colors.primary : t.colors.border,
                  color: canSend ? "#FFFFFF" : t.colors.textMuted,
                  cursor: canSend ? "pointer" : "not-allowed",
                  alignSelf: "flex-end",
                  transition: "transform 0.15s ease, opacity 0.15s ease",
                  flexShrink: 0,
                }}
                aria-label="Send message"
              >
                <span className="material-symbols-outlined" style={{ fontSize: 20, lineHeight: 1 }} aria-hidden>
                  {isStreaming ? "stop_circle" : "arrow_upward"}
                </span>
              </button>
            </div>
            <div style={{ marginTop: t.spacing(1), fontSize: "0.74rem", color: t.colors.textMuted }}>
              Enter to send · Shift+Enter for new line
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
