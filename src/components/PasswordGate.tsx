import { useState, useCallback } from "react";
import { lightTheme, assets } from "../theme";

const SESSION_KEY = "rpg-hub-unlocked";
const SITE_PASSWORD = "RPGHUB";

export function getIsUnlocked(): boolean {
  try {
    return sessionStorage.getItem(SESSION_KEY) === "1";
  } catch {
    return false;
  }
}

export function setUnlocked(): void {
  try {
    sessionStorage.setItem(SESSION_KEY, "1");
  } catch {
    // ignore
  }
}

type PasswordGateProps = {
  onUnlock: () => void;
};

export function PasswordGate({ onUnlock }: PasswordGateProps) {
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState(false);
  const t = lightTheme;

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = password.trim();
      if (trimmed === SITE_PASSWORD) {
        setError(false);
        setUnlocked();
        onUnlock();
      } else {
        setError(true);
      }
    },
    [password, onUnlock]
  );

  const wrapStyle: React.CSSProperties = {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#eef1f4",
    fontFamily: t.typography.fontFamily,
    padding: t.spacing(4),
  };

  const cardStyle: React.CSSProperties = {
    backgroundColor: t.colors.surface,
    borderRadius: "12px",
    boxShadow: "0 4px 24px rgba(0,0,0,0.08)",
    padding: t.spacing(5),
    maxWidth: 420,
    width: "100%",
    aspectRatio: "1",
    maxHeight: "min(420px, 85vh)",
    minHeight: 380,
    textAlign: "center",
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
  };

  const logoWrapStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: t.spacing(4),
  };

  const logoImgStyle: React.CSSProperties = {
    height: 72,
    width: "auto",
    maxWidth: 220,
    objectFit: "contain",
    objectPosition: "center",
    display: "block",
  };

  const titleStyle: React.CSSProperties = {
    fontWeight: t.typography.headingWeight,
    fontSize: "1.25rem",
    color: t.colors.text,
    marginBottom: t.spacing(1.5),
  };

  const instructionStyle: React.CSSProperties = {
    fontSize: t.typography.baseFontSize,
    color: t.colors.textMuted,
    marginBottom: t.spacing(3),
    lineHeight: 1.5,
  };

  const formStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "stretch",
    gap: 0,
    maxWidth: 320,
    margin: "0 auto",
  };

  const inputWrapStyle: React.CSSProperties = {
    flex: 1,
    position: "relative",
    display: "flex",
    alignItems: "center",
    border: `1px solid ${t.colors.border}`,
    borderRight: "none",
    borderRadius: `${t.radius.md} 0 0 ${t.radius.md}`,
    backgroundColor: t.colors.surface,
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: `${t.spacing(2)} ${t.spacing(3)}`,
    paddingRight: 40,
    fontSize: t.typography.baseFontSize,
    border: "none",
    borderRadius: "inherit",
    outline: "none",
    fontFamily: "inherit",
  };

  const visibilityBtnStyle: React.CSSProperties = {
    position: "absolute",
    right: t.spacing(2),
    top: "50%",
    transform: "translateY(-50%)",
    padding: 0,
    border: "none",
    background: "none",
    color: t.colors.textMuted,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  };

  const enterBtnStyle: React.CSSProperties = {
    padding: `${t.spacing(2)} ${t.spacing(4)}`,
    fontSize: "0.9rem",
    fontWeight: 600,
    color: "#ffffff",
    backgroundColor: t.colors.secondary,
    border: "none",
    borderRadius: `0 ${t.radius.md} ${t.radius.md} 0`,
    cursor: "pointer",
    whiteSpace: "nowrap",
  };

  return (
    <div style={wrapStyle}>
      <div style={cardStyle}>
        <div style={logoWrapStyle}>
          <img
            src={assets.logo}
            alt="RPG H.U.B"
            style={logoImgStyle}
          />
        </div>
        <h1 style={titleStyle}>RPG Secured Site</h1>
        <p style={instructionStyle}>
          Enter the password shared with you to continue.
        </p>
        <form onSubmit={handleSubmit}>
          <div style={formStyle}>
            <div style={inputWrapStyle}>
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setError(false);
                }}
                placeholder="Site password"
                style={inputStyle}
                autoComplete="current-password"
                autoFocus
                aria-label="Site password"
                aria-invalid={error}
              />
              <button
                type="button"
                onClick={() => setShowPassword((s) => !s)}
                style={visibilityBtnStyle}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                <span
                  className="material-symbols-outlined"
                  style={{ fontSize: 22 }}
                  aria-hidden
                >
                  {showPassword ? "visibility_off" : "visibility"}
                </span>
              </button>
            </div>
            <button type="submit" style={enterBtnStyle}>
              Enter
            </button>
          </div>
          {error && (
            <p
              style={{
                marginTop: t.spacing(2),
                fontSize: "0.875rem",
                color: t.colors.danger,
              }}
            >
              Incorrect password. Please try again.
            </p>
          )}
        </form>
      </div>
    </div>
  );
}
