// theme.ts
// Single source of truth for branding, layout tokens, and shared UI style helpers.

import type { CSSProperties } from "react";

/**
 * Stacking order for fixed/portal UI. Help tooltips must sit above the nav (`nav`).
 * When adding overlays, extend this scale — do not sprinkle magic numbers in pages.
 */
export const zIndex = {
  rails: 6,
  railsHeader: 8,
  railDropdown: 3000,
  dropdown: 4000,
  modalBackdrop: 1000,
  modal: 1001,
  nav: 10000,
  /** Full-screen click-away behind portaled dropdowns in fixed rails. */
  dropdownPortalBackdrop: 10500,
  /** Portaled dropdown panels (expiration pickers, etc.) — above nav, below tooltips. */
  dropdownPortal: 10501,
  /** Secondary-colored HelpTooltip bubbles and compact nav labels — top layer. */
  helpTooltip: 11000,
} as const;

/** Reusable box-shadow tokens (reference here — do not hardcode in pages). */
export const shadows = {
  card: "0 1px 3px rgba(0,0,0,0.06)",
  modal: "0 12px 40px rgba(15, 42, 54, 0.2)",
  dropdown: "0 4px 12px rgba(0,0,0,0.15)",
  elevatedCardLight: "0 2px 8px rgba(0,0,0,0.06)",
  elevatedCardDark: "0 2px 8px rgba(0,0,0,0.2)",
  stickyFooterLight: "0 -2px 8px rgba(0,0,0,0.06)",
} as const;

/** Client / assignee / status chip colors for the Todos board. */
export const todoPalette = {
  neutral: "#9ca3af",
  blue: "#3b82f6",
  green: "#22c55e",
  orange: "#f97316",
  pink: "#ec4899",
  status: {
    notStarted: "#6b7280",
    inProgress: "#2563eb",
    waiting: "#eab308",
    done: "#16a34a",
  },
} as const;

/** Marketing hero page (Website) — dark immersive shell separate from app chrome. */
export const websiteHeroTokens = {
  shellBg: "#041518",
  menuText: "#e8fcff",
  titleText: "#ecfeff",
  ctaText: "#0f2a36",
  menuBtnBg: "rgba(4, 20, 26, 0.60)",
  menuBtnBorder: "rgba(255,255,255,0.28)",
  dropdownBg: "rgba(4, 18, 26, 0.92)",
  dropdownBorder: "rgba(68, 193, 193, 0.22)",
  dropdownShadow: "0 16px 40px rgba(0,0,0,0.45)",
  menuItemActiveBg: "rgba(68, 193, 193, 0.14)",
  menuItemActiveText: "#7de8e8",
  menuItemText: "rgba(220, 247, 250, 0.80)",
  titleShadow: "0 8px 32px rgba(0,0,0,0.5)",
  ctaBg: "rgba(240, 253, 255, 0.94)",
  ctaBorder: "rgba(255, 255, 255, 0.28)",
  ctaShadow: "0 10px 32px rgba(0,0,0,0.4), 0 0 0 1px rgba(68,193,193,0.2)",
  footerMuted: "rgba(180, 230, 230, 0.50)",
  linkAccent: "rgba(68, 193, 193, 0.70)",
  logoDropShadow: "drop-shadow(0 3px 10px rgba(0,0,0,0.35))",
} as const;

/** Third-party brand accents used on Home quick links. */
export const brandAccents = {
  googleBlue: "#1a73e8",
} as const;

/** Rank badge colors (gold / silver / bronze). */
export const rankingColors = {
  gold: "#D4AF37",
  silver: "#C0C0C0",
  bronze: "#CD7F32",
} as const;

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
  maxWidth: 1360,
  appShellMaxWidth: 1440,
  pagePaddingH: 4,
  titleMarginBottom: 1,
  descMarginBottom: 5,
  /** Top margin when the first element is not an h2 (e.g. a wrapper div). Matches browser default h2 margin-top (0.83em of 1.5rem title font). */
  titleBlockMarginTop: "1.245rem",
} as const;

export type FixedRailsLayoutOptions = {
  sidebarWidth: number;
  leftRailWidth?: number;
  rightRailWidth?: number;
  headerHeight?: number;
  panelGapPx?: number;
};

export function getFixedRailsLayoutStyles(
  t: Theme,
  options: FixedRailsLayoutOptions
): {
  leftRailWidth: number;
  rightRailWidth: number;
  headerHeight: number;
  panelGapPx: number;
  page: CSSProperties;
  topHeader: CSSProperties;
  leftRail: CSSProperties;
  rightRail: CSSProperties;
  railPanel: CSSProperties;
  railBody: CSSProperties;
  railFooter: CSSProperties;
  contentWrap: CSSProperties;
} {
  const leftRailWidth = options.leftRailWidth ?? 286;
  const rightRailWidth = options.rightRailWidth ?? 256;
  const headerHeight = options.headerHeight ?? 104;
  const panelGapPx = options.panelGapPx ?? Number(t.spacing(3).replace("px", ""));

  return {
    leftRailWidth,
    rightRailWidth,
    headerHeight,
    panelGapPx,
    page: {
      width: "100%",
      margin: 0,
      minHeight: "100vh",
      display: "block",
      fontFamily: t.typography.fontFamily,
      color: t.colors.text,
    },
    topHeader: {
      position: "fixed",
      left: options.sidebarWidth,
      right: 0,
      top: 0,
      height: headerHeight,
      backgroundColor: t.colors.surface,
      borderBottom: `1px solid ${t.colors.border}`,
      padding: `${t.spacing(3)} ${t.spacing(8)}`,
      display: "flex",
      flexDirection: "column",
      justifyContent: "center",
      zIndex: 8,
      animation: "rails-fade-in 0.35s ease-out both",
    },
    leftRail: {
      position: "fixed",
      left: options.sidebarWidth,
      top: headerHeight,
      width: leftRailWidth,
      height: `calc(100vh - ${headerHeight}px)`,
      borderRight: `1px solid ${t.colors.border}`,
      backgroundColor: t.colors.surface,
      padding: 0,
      display: "flex",
      flexDirection: "column",
      zIndex: 6,
      animation: "rails-fade-in 0.4s ease-out 0.05s both",
    },
    rightRail: {
      position: "fixed",
      right: 0,
      top: headerHeight,
      width: rightRailWidth,
      height: `calc(100vh - ${headerHeight}px)`,
      borderLeft: `1px solid ${t.colors.border}`,
      backgroundColor: t.colors.surface,
      padding: 0,
      display: "flex",
      flexDirection: "column",
      zIndex: 6,
      animation: "rails-fade-in 0.4s ease-out 0.1s both",
    },
    railPanel: {
      margin: 0,
      borderRadius: 0,
      border: "none",
      boxShadow: "none",
      padding: t.spacing(3),
      display: "flex",
      flexDirection: "column",
      height: "100%",
      backgroundColor: t.colors.surface,
    },
    railBody: {
      flex: 1,
      overflowY: "auto",
      overflowX: "hidden",
      scrollbarWidth: "none",
    },
    railFooter: {
      padding: `${t.spacing(3)} 0 0`,
      backgroundColor: t.colors.surface,
      display: "flex",
      flexDirection: "column",
      alignItems: "stretch",
    },
    contentWrap: {
      marginTop: headerHeight + panelGapPx,
      marginLeft: leftRailWidth + panelGapPx,
      marginRight: rightRailWidth + panelGapPx,
    },
  };
}

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
    /** Text on primary-colored buttons and CTAs */
    onPrimary: string;
    /** Modal / drawer backdrop */
    overlay: string;
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
    full: string;
  };
};

/** Standard elevated card surface used across tool pages. */
export function getPageCardStyle(t: Theme, overrides?: CSSProperties): CSSProperties {
  return {
    backgroundColor: t.colors.surface,
    borderRadius: t.radius.lg,
    padding: t.spacing(5),
    boxShadow: shadows.card,
    border: `1px solid ${t.colors.border}`,
    ...overrides,
  };
}

/** Elevated card with stronger shadow — Todos panels and similar dense layouts. */
export function getElevatedCardStyle(t: Theme, overrides?: CSSProperties): CSSProperties {
  return {
    backgroundColor: t.colors.surface,
    borderRadius: t.radius.lg,
    padding: t.spacing(4),
    marginBottom: t.spacing(4),
    boxShadow: t.mode === "light" ? shadows.elevatedCardLight : shadows.elevatedCardDark,
    border: `1px solid ${t.colors.border}`,
    ...overrides,
  };
}

/** Fixed full-screen backdrop for modals and info panels. */
export function getModalBackdropStyle(t: Theme, zIndex = 1000): CSSProperties {
  return {
    position: "fixed",
    inset: 0,
    backgroundColor: t.colors.overlay,
    zIndex,
  };
}

/** Table header cell on secondary background — use secondaryText for correct light/dark contrast. */
export function getTableHeaderCellStyle(t: Theme, overrides?: CSSProperties): CSSProperties {
  return {
    textAlign: "left",
    padding: t.spacing(2),
    color: t.colors.secondaryText,
    fontWeight: 600,
    ...overrides,
  };
}

/** Primary button style: bold text on primary background. Use for Add, Compare, etc. */
export function getPrimaryButtonStyle(t: Theme): CSSProperties {
  return {
    padding: `${t.spacing(2)} ${t.spacing(4)}`,
    fontSize: "0.9rem",
    fontWeight: 700,
    color: t.colors.onPrimary,
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

/** Merge with primary or secondary rail-footer CTA styles so width matches across rail pages. */
export function getRailFooterActionButtonLayout(): CSSProperties {
  return {
    width: "100%",
    minWidth: 0,
    boxSizing: "border-box",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
  };
}

/** Universal hover for tappable cards: add this class for subtle lift + teal glow (same as Optimize portfolio button). */
export const INTERACTIVE_CARD_CLASS = "interactive-card";

/** Add this class to custom dropdown option buttons so they get consistent hover (see index.css). */
export const THEME_DROPDOWN_OPTION_CLASS = "theme-dropdown-option";

/** Trigger button for the reusable custom dropdown (same look as select inputs). */
export function getDropdownTriggerStyle(t: Theme): CSSProperties {
  return {
    padding: `${t.spacing(2)} ${t.spacing(3)}`,
    fontSize: t.typography.baseFontSize,
    border: `1px solid ${t.colors.border}`,
    borderRadius: t.radius.md,
    backgroundColor: t.colors.surface,
    color: t.colors.text,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: t.spacing(1),
    minWidth: 120,
    height: 40,
    cursor: "pointer",
    fontFamily: t.typography.fontFamily,
  };
}

/** Panel that contains dropdown options. Use position absolute; placement sets bottom/top so it opens up or down. */
export function getDropdownPanelStyle(t: Theme, placement: "up" | "down"): CSSProperties {
  return {
    position: "absolute",
    left: 0,
    ...(placement === "up"
      ? { bottom: "100%", marginBottom: t.spacing(1) }
      : { top: "100%", marginTop: t.spacing(1) }),
    minWidth: "100%",
    backgroundColor: t.colors.surface,
    border: `1px solid ${t.colors.border}`,
    borderRadius: t.radius.md,
    boxShadow: shadows.dropdown,
    zIndex: zIndex.dropdown,
    overflow: "hidden",
  };
}

/** Base style for each dropdown option button. Add THEME_DROPDOWN_OPTION_CLASS for hover. */
export function getDropdownOptionStyle(t: Theme, isSelected: boolean): CSSProperties {
  return {
    display: "block",
    width: "100%",
    padding: `${t.spacing(2)} ${t.spacing(3)}`,
    border: "none",
    background: isSelected ? t.colors.background : "transparent",
    color: t.colors.text,
    fontFamily: t.typography.fontFamily,
    fontSize: "0.875rem",
    textAlign: "left",
    cursor: "pointer",
  };
}

/** Tooltip bubble surface; position handled by caller. */
export function getTooltipBubbleStyle(t: Theme): CSSProperties {
  return {
    position: "absolute",
    top: "100%",
    left: 0,
    marginTop: t.spacing(1),
    maxWidth: 420,
    padding: `${t.spacing(1.5)} ${t.spacing(2)}`,
    borderRadius: t.radius.md,
    backgroundColor: t.colors.secondary,
    color: t.colors.secondaryText,
    fontSize: "0.75rem",
    lineHeight: 1.4,
    boxShadow: shadows.modal,
    zIndex: zIndex.helpTooltip,
  };
}

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
    full: "9999px",
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
    onPrimary: "#ffffff",
    overlay: "rgba(0,0,0,0.4)",
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
    onPrimary: "#ffffff",
    overlay: "rgba(0,0,0,0.55)",
  },
  ...baseTheme,
};
