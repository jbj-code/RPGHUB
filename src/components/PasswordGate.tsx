import { useState, useCallback, useEffect } from "react";
import { lightTheme, assets } from "../theme";

const SESSION_KEY = "rpg-hub-unlocked";

const SCHWAB_API_BASE =
  (import.meta.env.VITE_SCHWAB_API_BASE as string) ||
  "https://rpghub-two.vercel.app";

type SchwabStatus = { connected: boolean; expired?: boolean; hasRefresh?: boolean } | null;

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
  const [step, setStep] = useState<"password" | "schwab">("password");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState(false);
  const [schwabStatus, setSchwabStatus] = useState<SchwabStatus>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const t = lightTheme;

  const refreshSchwabStatus = useCallback(() => {
    setStatusLoading(true);
    fetch(`${SCHWAB_API_BASE}/api/schwab-status`)
      .then((res) => res.json())
      .then((data: { connected?: boolean; expired?: boolean; hasRefresh?: boolean }) => {
        const connected =
          !!data.connected &&
          (!data.expired || !!data.hasRefresh);
        setSchwabStatus({
          connected,
          expired: data.expired,
          hasRefresh: data.hasRefresh,
        });
        if (connected) onUnlock();
      })
      .catch(() => setSchwabStatus({ connected: false }))
      .finally(() => setStatusLoading(false));
  }, [onUnlock]);

  // After password, check Schwab token status (Supabase). If already connected, skip the Schwab step and go in.
  useEffect(() => {
    if (step !== "schwab") return;
    refreshSchwabStatus();
  }, [step, refreshSchwabStatus]);

  // When user returns to this tab after authorizing in the other tab, re-check and let them in if connected
  useEffect(() => {
    if (step !== "schwab" || schwabStatus?.connected) return;
    const onFocus = () => {
      refreshSchwabStatus();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [step, schwabStatus, refreshSchwabStatus]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = password.trim();
      setError(false);
      setSubmitting(true);

      try {
        const resp = await fetch(`${SCHWAB_API_BASE}/api/site-password`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password: trimmed }),
        });

        if (resp.ok) {
          setUnlocked();
          setStep("schwab");
        } else {
          setError(true);
        }
      } catch {
        setError(true);
      } finally {
        setSubmitting(false);
      }
    },
    [password]
  );

  const handleContinue = useCallback(() => {
    onUnlock();
  }, [onUnlock]);

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

  const authorizeBtnStyle: React.CSSProperties = {
    ...enterBtnStyle,
    borderRadius: t.radius.md,
  };

  const smallBtnStyle: React.CSSProperties = {
    padding: `${t.spacing(1.5)} ${t.spacing(3)}`,
    fontSize: "0.875rem",
    fontWeight: 600,
    color: t.colors.textMuted,
    backgroundColor: "transparent",
    border: `1px solid ${t.colors.border}`,
    borderRadius: t.radius.md,
    cursor: "pointer",
    marginTop: t.spacing(2),
  };

  if (step === "schwab") {
    const connected =
      !!schwabStatus?.connected &&
      (!schwabStatus.expired || !!schwabStatus.hasRefresh);
    if (connected) return null;
    return (
      <div style={wrapStyle}>
        <div style={cardStyle}>
          <div style={logoWrapStyle}>
            <img src={assets.logo} alt="RPG H.U.B" style={logoImgStyle} />
          </div>
          <h1 style={titleStyle}>Schwab market data</h1>
          {statusLoading ? (
            <p style={instructionStyle}>Checking Schwab connection…</p>
          ) : connected ? (
            <>
              <p style={instructionStyle}>
                You're connected. Stock Comparison and Options Optimizer can use live market data.
              </p>
              <button type="button" style={{ ...enterBtnStyle, marginTop: t.spacing(2) }} onClick={handleContinue}>
                Continue
              </button>
            </>
          ) : (
            <>
              <p style={instructionStyle}>
                Connect Schwab to use live market data on Stock Comparison and Options Optimizer. You can also connect later from those pages.
              </p>
              <a
                href={`${SCHWAB_API_BASE}/api/schwab-auth`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ ...authorizeBtnStyle, display: "inline-block", textDecoration: "none", marginTop: t.spacing(2) }}
              >
                Authorize Schwab
              </a>
              <button
                type="button"
                style={smallBtnStyle}
                onClick={refreshSchwabStatus}
                disabled={statusLoading}
              >
                {statusLoading ? "Rechecking…" : "Recheck Schwab connection"}
              </button>
              <button type="button" style={smallBtnStyle} onClick={handleContinue}>
                Continue without connecting
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

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
            <button type="submit" style={enterBtnStyle} disabled={submitting}>
              {submitting ? (
                <span className="options-pricing-fetch-spinner" aria-hidden />
              ) : (
                "Enter"
              )}
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
