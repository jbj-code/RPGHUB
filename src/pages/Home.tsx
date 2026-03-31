import { useEffect, useState } from "react";
import type { Theme } from "../theme";
import { assets, PAGE_LAYOUT, INTERACTIVE_CARD_CLASS, getPrimaryActionButtonStyle } from "../theme";

const API_BASE =
  (import.meta.env.VITE_SCHWAB_API_BASE as string) || "https://therpghub.vercel.app";

const GOOGLE_DRIVE_FOLDER =
  "https://drive.google.com/drive/folders/1tlymeBDbGkdWzXDs0D_QHcB2nE0kC83Y?usp=drive_link";
const ADDEPAR_LOGIN =
  "https://id.addepar.com/login?continue=%7B%22targetName%22%3A%22oauth2.authorize%22%2C%22queryParams%22%3A%7B%22response_type%22%3A%22code%22%2C%22scope%22%3A%22session%22%2C%22client_id%22%3A%22iverson%22%2C%22state%22%3A%22%7B%7D%22%2C%22code_challenge%22%3A%22cd3ad6e1e27ec9851864f1c65b0da1f1ffc8bab28ecc6fde1e479839fad28cb8%22%2C%22redirect_uri%22%3A%22https%3A%2F%2Fresolute.addepar.com%2Foauth2%2Fcb%22%2C%22firm%22%3A%22resolute%22%7D%7D&firm=resolute";
const SCHWAB_LOGIN = "https://client.schwab.com/";
const PERSHING_LOGIN = "https://www2.netx360.com/plus/login";
const TRINET_LOGIN =
  "https://identity.trinet.com/oauth2/aus590q9hSMIGGWxx4x6/v1/authorize?client_id=0oa590aagPaPtb3JL4x6&response_type=code&scope=profile%20email%20openid%20offline_access&redirect_uri=https://trinet.hrpassport.com/api-trinet-auth/authorization&message=Success_ui-home&state=ui-home";
const EMPOWER_LOGIN =
  "https://trinet401k.empower-retirement.com/participant/home/#/dashboard/retirement-income";

/** Favicon URL for a domain (Google S2 favicon service). */
function faviconUrl(domain: string, size = 64): string {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=${size}`;
}

type HomeProps = { theme: Theme };

type QuickLinkItem =
  | { title: string; href: string; faviconDomain: string }
  | { title: "To-Dos"; href: string; icon: "document-blue" };

export function Home({ theme: t }: HomeProps) {
  /** URL from Supabase via server API (`app_settings.home_todos_url`) — same pattern as site password. */
  const [todosUrl, setTodosUrl] = useState("");
  const [todosEditorOpen, setTodosEditorOpen] = useState(false);
  const [todosDraft, setTodosDraft] = useState("");
  const [todosPassword, setTodosPassword] = useState("");
  const [todosEditError, setTodosEditError] = useState<string | null>(null);
  const [todosSaving, setTodosSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function loadTodosUrl() {
      try {
        const res = await fetch(
          `${API_BASE}/api/app-settings?key=${encodeURIComponent("home_todos_url")}`
        );
        if (cancelled || !res.ok) return;
        const data = (await res.json()) as { value?: string | null };
        const next =
          typeof data?.value === "string" && data.value.trim().length > 0
            ? data.value.trim()
            : "";
        setTodosUrl(next);
      } catch {
        /* ignore */
      }
    }
    void loadTodosUrl();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!todosEditorOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !todosSaving) setTodosEditorOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [todosEditorOpen, todosSaving]);

  async function saveTodosUrl() {
    setTodosEditError(null);
    setTodosSaving(true);
    try {
      const res = await fetch(`${API_BASE}/api/app-settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: "home_todos_url",
          value: todosDraft.trim(),
          password: todosPassword,
        }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string; value?: string };
      if (!res.ok) {
        setTodosEditError(typeof j.error === "string" ? j.error : "Could not save.");
        return;
      }
      const next = typeof j.value === "string" && j.value.trim() ? j.value.trim() : todosDraft.trim();
      setTodosUrl(next);
      setTodosPassword("");
      setTodosEditorOpen(false);
    } catch {
      setTodosEditError("Network error.");
    } finally {
      setTodosSaving(false);
    }
  }

  const primaryBtn = getPrimaryActionButtonStyle(t);

  function openTodosEditor() {
    setTodosDraft(todosUrl);
    setTodosEditError(null);
    setTodosPassword("");
    setTodosEditorOpen(true);
  }

  const wrapStyle: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    minHeight: "30vh",
    gap: t.spacing(3),
    marginBottom: t.spacing(2),
  };

  const logoStyle: React.CSSProperties = {
    height: 112,
    width: "auto",
    maxWidth: 280,
    objectFit: "contain",
    objectPosition: "center",
  };

  const taglineStyle: React.CSSProperties = {
    fontFamily: t.typography.fontFamily,
    fontWeight: t.typography.headingWeight,
    fontSize: "1.875rem",
    letterSpacing: "0.02em",
    color: t.colors.textMuted,
  };

  const cardsWrapStyle: React.CSSProperties = {
    maxWidth: PAGE_LAYOUT.maxWidth,
    width: "100%",
    margin: "0 auto",
    /* Extra horizontal inset so the To-Dos edit control (absolute, left of the first card) stays inside the padded area. */
    padding: `0 ${t.spacing(12)} ${t.spacing(6)}`,
  };

  const cardsGridStyle: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: "repeat(5, 1fr)",
    gap: t.spacing(3),
    maxWidth: 900,
    marginLeft: "auto",
    marginRight: "auto",
  };

  const cardStyle: React.CSSProperties = {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing(3),
    padding: `${t.spacing(2.5)} ${t.spacing(4)}`,
    backgroundColor: t.colors.surface,
    borderRadius: t.radius.lg,
    border: `1px solid ${t.colors.border}`,
    color: t.colors.text,
    fontFamily: t.typography.fontFamily,
  };

  const cardTitleStyle: React.CSSProperties = {
    fontWeight: t.typography.headingWeight,
    fontSize: "1.0625rem",
    margin: 0,
  };

  const iconSize = 40;

  const todosLink: QuickLinkItem = { title: "To-Dos", href: todosUrl, icon: "document-blue" };

  const quickLinksAfterTodos: Extract<QuickLinkItem, { title: string }>[] = [
    {
      title: "Drive",
      href: GOOGLE_DRIVE_FOLDER,
      faviconDomain: "drive.google.com",
    },
    {
      title: "Addepar",
      href: ADDEPAR_LOGIN,
      faviconDomain: "addepar.com",
    },
    {
      title: "Schwab",
      href: SCHWAB_LOGIN,
      faviconDomain: "schwab.com",
    },
    {
      title: "Pershing",
      href: PERSHING_LOGIN,
      faviconDomain: "netx360.com",
    },
    {
      title: "TriNet",
      href: TRINET_LOGIN,
      faviconDomain: "trinet.com",
    },
    {
      title: "Empower",
      href: EMPOWER_LOGIN,
      faviconDomain: "empower-retirement.com",
    },
    {
      title: "Arena AI",
      href: "https://arena.ai/leaderboard",
      faviconDomain: "arena.ai",
    },
  ];

  const pageCenterWrap: React.CSSProperties = {
    minHeight: "100vh",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    paddingBottom: "12vh",
  };

  return (
    <div style={pageCenterWrap}>
      <section className="home-section home-hero" style={wrapStyle}>
        <img
          src={t.mode === "light" ? assets.logo : assets.logoWhite}
          alt=""
          className="home-hero-logo"
          style={logoStyle}
          aria-hidden
        />
        <span className="home-hero-tagline" style={taglineStyle}>
          Home of Useful Bits
        </span>
      </section>

      <section className="home-section home-quick-links" style={cardsWrapStyle} aria-label="Quick links">
        <div style={cardsGridStyle}>
          <div style={{ position: "relative", minWidth: 0, width: "100%" }}>
            <button
              type="button"
              onClick={openTodosEditor}
              className="home-todos-edit-btn"
              aria-label="Edit To-Dos link"
              title="Edit To-Dos link"
              style={{
                position: "absolute",
                right: "100%",
                marginRight: t.spacing(2),
                top: 0,
                bottom: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 44,
                minWidth: 44,
                padding: 0,
                border: "none",
                background: "none",
                cursor: "pointer",
                color: t.colors.textMuted,
                fontFamily: t.typography.fontFamily,
                zIndex: 1,
                borderRadius: t.radius.md,
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 28, lineHeight: 1 }} aria-hidden>
                edit
              </span>
            </button>
            <a
              href={todosLink.href.trim() || "#"}
              target={!todosLink.href.trim() ? undefined : "_blank"}
              rel={!todosLink.href.trim() ? undefined : "noopener noreferrer"}
              onClick={!todosLink.href.trim() ? (e) => e.preventDefault() : undefined}
              aria-disabled={!todosLink.href.trim() ? true : undefined}
              className={`home-quick-link-card page-card ${INTERACTIVE_CARD_CLASS}`}
              style={cardStyle}
            >
              <span
                className="material-symbols-outlined"
                style={{
                  fontSize: iconSize,
                  width: iconSize,
                  height: iconSize,
                  lineHeight: 1,
                  color: "#1a73e8",
                  flexShrink: 0,
                  fontVariationSettings: '"FILL" 0, "wght" 400, "GRAD" 0, "opsz" 40',
                }}
                aria-hidden
              >
                description
              </span>
              <span style={cardTitleStyle}>{todosLink.title}</span>
            </a>
          </div>

          {quickLinksAfterTodos.map((link) => (
            <a
              key={link.title}
              href={link.href}
              target="_blank"
              rel="noopener noreferrer"
              className={`home-quick-link-card page-card ${INTERACTIVE_CARD_CLASS}`}
              style={cardStyle}
            >
              <img
                src={faviconUrl(link.faviconDomain)}
                alt=""
                width={iconSize}
                height={iconSize}
                style={{ objectFit: "contain", flexShrink: 0 }}
              />
              <span style={cardTitleStyle}>{link.title}</span>
            </a>
          ))}
        </div>
      </section>

      {todosEditorOpen && (
        <>
          <div
            role="presentation"
            style={{
              position: "fixed",
              inset: 0,
              backgroundColor: "rgba(0,0,0,0.4)",
              zIndex: 1000,
            }}
            onClick={() => {
              if (!todosSaving) setTodosEditorOpen(false);
            }}
            onKeyDown={(e) => e.key === "Escape" && !todosSaving && setTodosEditorOpen(false)}
          />
          <div
            role="dialog"
            aria-labelledby="home-todos-edit-title"
            aria-modal="true"
            style={{
              position: "fixed",
              left: "50%",
              top: "50%",
              transform: "translate(-50%, -50%)",
              zIndex: 1001,
              backgroundColor: t.colors.surface,
              borderRadius: t.radius.lg,
              padding: t.spacing(5),
              maxWidth: 480,
              width: "90%",
              maxHeight: "85vh",
              overflowY: "auto",
              boxShadow: "0 12px 40px rgba(15, 42, 54, 0.2)",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                marginBottom: t.spacing(3),
              }}
            >
              <h3
                id="home-todos-edit-title"
                style={{
                  fontFamily: t.typography.fontFamily,
                  fontWeight: t.typography.headingWeight,
                  fontSize: "0.85rem",
                  margin: 0,
                  color: t.colors.secondary,
                }}
              >
                Update To-Dos link
              </h3>
              <button
                type="button"
                disabled={todosSaving}
                onClick={() => setTodosEditorOpen(false)}
                style={{
                  padding: t.spacing(0.5),
                  border: "none",
                  background: "none",
                  color: t.colors.textMuted,
                  cursor: todosSaving ? "not-allowed" : "pointer",
                  opacity: todosSaving ? 0.5 : 1,
                }}
                aria-label="Close"
              >
                <span className="material-symbols-outlined" style={{ fontSize: 22 }}>
                  close
                </span>
              </button>
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: t.spacing(3),
                textAlign: "left",
              }}
            >
              <p style={{ margin: 0, fontSize: "0.875rem", color: t.colors.textMuted, lineHeight: 1.5 }}>
                Paste the new Google Doc URL. You must enter the same site password you use to log in.
              </p>
              <label style={{ display: "flex", flexDirection: "column", gap: t.spacing(1) }}>
                <span
                  style={{
                    fontSize: "0.72rem",
                    color: t.colors.textMuted,
                    textTransform: "uppercase",
                    letterSpacing: "0.04em",
                    fontWeight: 600,
                  }}
                >
                  To-Dos URL
                </span>
                <input
                  type="url"
                  value={todosDraft}
                  onChange={(e) => setTodosDraft(e.target.value)}
                  placeholder="https://docs.google.com/..."
                  autoComplete="off"
                  style={{
                    width: "100%",
                    boxSizing: "border-box",
                    padding: `${t.spacing(2)} ${t.spacing(3)}`,
                    borderRadius: t.radius.md,
                    border: `1px solid ${t.colors.border}`,
                    fontSize: t.typography.baseFontSize,
                    fontFamily: t.typography.fontFamily,
                    backgroundColor: t.colors.background,
                    color: t.colors.text,
                  }}
                />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: t.spacing(1) }}>
                <span
                  style={{
                    fontSize: "0.72rem",
                    color: t.colors.textMuted,
                    textTransform: "uppercase",
                    letterSpacing: "0.04em",
                    fontWeight: 600,
                  }}
                >
                  Site password
                </span>
                <input
                  type="password"
                  value={todosPassword}
                  onChange={(e) => setTodosPassword(e.target.value)}
                  autoComplete="current-password"
                  style={{
                    width: "100%",
                    boxSizing: "border-box",
                    padding: `${t.spacing(2)} ${t.spacing(3)}`,
                    borderRadius: t.radius.md,
                    border: `1px solid ${t.colors.border}`,
                    fontSize: t.typography.baseFontSize,
                    fontFamily: t.typography.fontFamily,
                    backgroundColor: t.colors.background,
                    color: t.colors.text,
                  }}
                />
              </label>
              {todosEditError && (
                <p style={{ margin: 0, fontSize: "0.85rem", color: t.colors.danger, fontWeight: 600 }}>
                  {todosEditError}
                </p>
              )}
              <div style={{ display: "flex", flexWrap: "wrap", gap: t.spacing(2) }}>
                <button
                  type="button"
                  disabled={todosSaving}
                  onClick={() => void saveTodosUrl()}
                  style={{ ...primaryBtn, opacity: todosSaving ? 0.7 : 1, cursor: todosSaving ? "wait" : "pointer" }}
                >
                  {todosSaving ? "Saving…" : "Save link"}
                </button>
                <button
                  type="button"
                  disabled={todosSaving}
                  onClick={() => setTodosEditorOpen(false)}
                  style={{
                    padding: `${t.spacing(2.5)} ${t.spacing(3)}`,
                    fontSize: "0.875rem",
                    fontWeight: 600,
                    color: t.colors.textMuted,
                    background: "none",
                    border: `1px solid ${t.colors.border}`,
                    borderRadius: t.radius.md,
                    cursor: "pointer",
                    fontFamily: t.typography.fontFamily,
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
