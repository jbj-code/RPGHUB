import type { Theme } from "../theme";
import { assets, PAGE_LAYOUT, INTERACTIVE_CARD_CLASS } from "../theme";

const GOOGLE_DRIVE_FOLDER =
  "https://drive.google.com/drive/folders/1tlymeBDbGkdWzXDs0D_QHcB2nE0kC83Y?usp=drive_link";
const ADDEPAR_LOGIN =
  "https://id.addepar.com/login?continue=%7B%22targetName%22%3A%22oauth2.authorize%22%2C%22queryParams%22%3A%7B%22response_type%22%3A%22code%22%2C%22scope%22%3A%22session%22%2C%22client_id%22%3A%22iverson%22%2C%22state%22%3A%22%7B%7D%22%2C%22code_challenge%22%3A%22cd3ad6e1e27ec9851864f1c65b0da1f1ffc8bab28ecc6fde1e479839fad28cb8%22%2C%22redirect_uri%22%3A%22https%3A%2F%2Fresolute.addepar.com%2Foauth2%2Fcb%22%2C%22firm%22%3A%22resolute%22%7D%7D&firm=resolute";
const SCHWAB_LOGIN = "https://client.schwab.com/";

type HomeProps = { theme: Theme };

/** Google Drive icon — official Google brand colors (blue, green, yellow). */
function GoogleDriveIcon({ size = 48 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path
        fill="#4285F4"
        d="M12.63 4.93L7.5 2 2.36 10.07 7.5 13l5.13-8.07z"
      />
      <path
        fill="#34A853"
        d="M21.64 10.07L16.5 2 7.5 13l5.14 2.93 9-2.86z"
      />
      <path
        fill="#FBBC05"
        d="M2.36 10.07v8.86l5.14 2.93V13L2.36 10.07z"
      />
      <path
        fill="#EA4335"
        d="M12.63 19.93v-6.93l-5.13-3v9.93l5.13 3zM16.5 13l5.14 2.93v-5.86L16.5 13z"
      />
    </svg>
  );
}

export function Home({ theme: t }: HomeProps) {
  const wrapStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    minHeight: "50vh",
    gap: t.spacing(4),
  };

  const logoStyle: React.CSSProperties = {
    height: 80,
    width: "auto",
    maxWidth: 200,
    objectFit: "contain",
    objectPosition: "center",
  };

  const hubStyle: React.CSSProperties = {
    fontFamily: t.typography.fontFamily,
    fontWeight: t.typography.headingWeight,
    fontSize: "3rem",
    letterSpacing: "0.02em",
    color: t.colors.text,
  };

  const cardsWrapStyle: React.CSSProperties = {
    maxWidth: PAGE_LAYOUT.maxWidth,
    width: "100%",
    margin: "0 auto",
    padding: `0 ${t.spacing(4)} ${t.spacing(8)}`,
  };

  const cardsGridStyle: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: t.spacing(3),
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
      title: "Master folder",
      href: GOOGLE_DRIVE_FOLDER,
      icon: <GoogleDriveIcon size={iconSize} />,
    },
    {
      title: "Addepar",
      href: ADDEPAR_LOGIN,
      icon: (
        <img
          src="https://logo.clearbit.com/addepar.com"
          alt=""
          width={iconSize}
          height={iconSize}
          style={{ objectFit: "contain", flexShrink: 0 }}
        />
      ),
    },
    {
      title: "Schwab",
      href: SCHWAB_LOGIN,
      icon: (
        <img
          src="https://logo.clearbit.com/schwab.com"
          alt=""
          width={iconSize}
          height={iconSize}
          style={{ objectFit: "contain", flexShrink: 0 }}
        />
      ),
    },
  ];

  return (
    <>
      <section className="home-section home-hero" style={wrapStyle}>
        <img
          src={t.mode === "light" ? assets.logo : assets.logoWhite}
          alt=""
          className="home-hero-logo"
          style={logoStyle}
          aria-hidden
        />
        <span className="home-hero-hub" style={hubStyle}>HUB</span>
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
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                {link.icon}
              </div>
              <span style={cardTitleStyle}>{link.title}</span>
            </a>
          ))}
        </div>
      </section>
    </>
  );
}
