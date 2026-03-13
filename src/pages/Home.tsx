import type { Theme } from "../theme";
import { assets, PAGE_LAYOUT, INTERACTIVE_CARD_CLASS } from "../theme";

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

export function Home({ theme: t }: HomeProps) {
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

  const quickLinks = [
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
          {quickLinks.map((link) => (
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
    </div>
  );
}
