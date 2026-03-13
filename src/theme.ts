import type { CSSProperties } from "react";

/**
 * Single source of truth for branding and layout.
 * Change colors and asset paths here to update the whole app.
 * Primary: #44c1c1 (teal) | Secondary: #0f2a36 (dark navy)
 * Font: DM Sans — loaded via index.html.
 *
 * Assets: put favicon and logos in public/assets/. Used in index.html (favicon) and nav (logo).
 * - Light mode nav: logo
 * - Dark mode nav: logoWhite
 *
 * Design direction: "Modern trillion-dollar app" — clean, confident, premium.
 * - Generous whitespace; avoid clutter.
 * - Subtle shadows and soft radius; no harsh borders.
 * - Restrained color; use primary sparingly for emphasis.
 * - Typography-led hierarchy; let type and spacing do the work.
 */

/** Standard page layout: same max-width and spacing for every tool page. */
export const PAGE_LAYOUT = {
  maxWidth: 1200,
  titleMarginBottom: 1,
  descMarginBottom: 5,
  /** Top margin when the first element is not an h2 (e.g. a wrapper div). Matches browser default h2 margin-top (0.83em of 1.5rem title font). */
  titleBlockMarginTop: "1.245rem",
} as const;

/** Paths to assets in public/assets/ (favicon.png, logo.png, logo-white.png). */
export const assets = {
  favicon: "/assets/favicon.png",
  logo: "/assets/logo.png",
  logoWhite: "/assets/logo-white.png",
} as const;

export type ThemeMode = "light" | "dark";

export type Theme = {
  mode: ThemeMode;
  colors: {
    background: string;
    surface: string;
    primary: string;
    primaryText: string;
    secondary: string;
    secondaryText: string;
    text: string;
    textMuted: string;
    border: string;
    danger: string;
    success: string;
  };
  typography: {
    fontFamily: string;
    headingWeight: number;
    bodyWeight: number;
    baseFontSize: string;
  };
  spacing: (factor: number) => string;
  radius: {
    sm: string;
    md: string;
    lg: string;
  };
};

/** Primary button style: white bold text on primary background. Use for Add, Compare, etc. */
export function getPrimaryButtonStyle(t: Theme): CSSProperties {
  return {
    padding: `${t.spacing(2)} ${t.spacing(4)}`,
    fontSize: "0.9rem",
    fontWeight: 700,
    color: "#ffffff",
    backgroundColor: t.colors.primary,
    border: "none",
    borderRadius: t.radius.md,
    cursor: "pointer",
  };
}

/** Primary action button: slightly taller for main CTAs (Fetch, Optimize, Build, etc.). */
export function getPrimaryActionButtonStyle(t: Theme): CSSProperties {
  return {
    ...getPrimaryButtonStyle(t),
    padding: `${t.spacing(2.5)} ${t.spacing(4.5)}`,
  };
}

/** Universal hover for tappable cards: add this class for subtle lift + teal glow (same as Optimize portfolio button). */
export const INTERACTIVE_CARD_CLASS = "interactive-card";

// DM Sans: geometric, clean, friendly (free, Google Fonts)
const baseTheme = {
  typography: {
    fontFamily: '"DM Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    headingWeight: 600,
    bodyWeight: 400,
    baseFontSize: "14px",
  },
  spacing: (factor: number) => `${factor * 4}px`,
  radius: {
    sm: "4px",
    md: "8px",
    lg: "12px",
  },
};

export const lightTheme: Theme = {
  mode: "light",
  colors: {
    background: "#f8fafb",
    surface: "#ffffff",
    primary: "#44c1c1",
    primaryText: "#0f2a36",
    secondary: "#0f2a36",
    secondaryText: "#ffffff",
    text: "#0f2a36",
    textMuted: "#5a6c7a",
    border: "#e2e8f0",
    danger: "#b91c1c",
    success: "#15803d",
  },
  ...baseTheme,
};

export const darkTheme: Theme = {
  mode: "dark",
  colors: {
    background: "#141414",
    surface: "#1c1c1c",
    primary: "#44c1c1",
    primaryText: "#0f2a36",
    secondary: "#44c1c1",
    secondaryText: "#0f2a36",
    text: "#e5e5e5",
    textMuted: "#a3a3a3",
    border: "#2d2d2d",
    danger: "#fecaca",
    success: "#bbf7d0",
  },
  ...baseTheme,
};
