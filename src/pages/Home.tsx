import { useEffect, useState } from "react";
import type { Theme } from "../theme";
import { assets, PAGE_LAYOUT, INTERACTIVE_CARD_CLASS } from "../theme";

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
    padding: `0 ${t.spacing(4)} ${t.spacing(6)}`,
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

  const quickLinks: QuickLinkItem[] = [
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
    { title: "To-Dos", href: todosUrl, icon: "document-blue" },
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
          {quickLinks.map((link) => {
            const isTodos = link.title === "To-Dos";
            const href = isTodos ? (link.href.trim() || "#") : link.href;
            return (
            <a
              key={link.title}
              href={href}
              target={isTodos && !link.href.trim() ? undefined : "_blank"}
              rel={isTodos && !link.href.trim() ? undefined : "noopener noreferrer"}
              onClick={isTodos && !link.href.trim() ? (e) => e.preventDefault() : undefined}
              aria-disabled={isTodos && !link.href.trim() ? true : undefined}
              className={`home-quick-link-card page-card ${INTERACTIVE_CARD_CLASS}`}
              style={cardStyle}
            >
              {"icon" in link && link.icon === "document-blue" ? (
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
              ) : (
                <img
                  src={faviconUrl((link as { faviconDomain: string }).faviconDomain)}
                  alt=""
                  width={iconSize}
                  height={iconSize}
                  style={{ objectFit: "contain", flexShrink: 0 }}
                />
              )}
              <span style={cardTitleStyle}>{link.title}</span>
            </a>
            );
          })}
        </div>
      </section>
    </div>
  );
}
