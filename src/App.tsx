// App.tsx
// Root shell: password gate, theme mode, sidebar nav, and client-side page routing.

import { useState, useEffect, useRef } from "react";
import { lightTheme, darkTheme, PAGE_LAYOUT, type ThemeMode, type Theme } from "./theme";
import { NavBar, SIDEBAR_WIDTH, SIDEBAR_WIDTH_COMPACT } from "./components/NavBar";
import { PasswordGate, getIsUnlocked } from "./components/PasswordGate";
import {
  Home,
  OptionsOptimizer,
  StockComparison,
  Todos,
  OptionsScreener,
  Rankinator,
  RaiseAi,
  AssignmentCheck,
  Website,
  Extractor,
  Agent,
  Schwab,
  Sourcing,
} from "./pages";
import { OptionsPricing } from "./pages/OptionsPricing";

export type Page =
  | "home"
  | "put-optimizer"
  | "stock-comparison"
  | "options-pricing"
  | "todos"
  | "options-screener"
  | "rankinator"
  | "raise-ai"
  | "assignment-check"
  | "website"
  | "extractor"
  | "agent"
  | "schwab"
  | "sourcing";

function App() {
  const [unlocked, setUnlocked] = useState(false);
  const [page, setPage] = useState<Page>("home");
  const [mode, setMode] = useState<ThemeMode>("light");
  const [sidebarCompact, setSidebarCompact] = useState(false);
  const [autoCollapseArmed, setAutoCollapseArmed] = useState(true);
  const mainRef = useRef<HTMLElement | null>(null);
  const sidebarWidth = sidebarCompact ? SIDEBAR_WIDTH_COMPACT : SIDEBAR_WIDTH;

  useEffect(() => {
    setUnlocked(getIsUnlocked());
  }, []);

  // Auto-collapse the nav after 10 s so it's out of the way by default.
  // Disarmed permanently the first time the user manually toggles.
  useEffect(() => {
    if (!autoCollapseArmed) return;
    const timer = setTimeout(() => setSidebarCompact(true), 10_000);
    return () => clearTimeout(timer);
  }, [autoCollapseArmed]);

  const t: Theme = mode === "light" ? lightTheme : darkTheme;

  const handleNavigate = (nextPage: Page) => {
    setPage(nextPage);
    requestAnimationFrame(() => {
      window.scrollTo({ top: 0, behavior: "auto" });
      mainRef.current?.scrollTo({ top: 0, behavior: "auto" });
    });
  };

  if (!unlocked) {
    return <PasswordGate onUnlock={() => setUnlocked(true)} />;
  }

  const layoutStyle: React.CSSProperties = {
    display: "flex",
    minHeight: "100vh",
  };

  const mainStyle: React.CSSProperties = {
    flex: 1,
    minWidth: 0,
    marginLeft: sidebarWidth,
    backgroundColor: t.colors.background,
    fontFamily: t.typography.fontFamily,
    color: t.colors.text,
    fontSize: t.typography.baseFontSize,
    transition: "margin-left 0.25s ease",
  };

  const mainInnerStyle: React.CSSProperties = {
    maxWidth: PAGE_LAYOUT.appShellMaxWidth,
    margin: "0 auto",
    padding: `${t.spacing(6)} ${t.spacing(PAGE_LAYOUT.pagePaddingH)}`,
  };

  return (
    <div className="app-layout" style={layoutStyle}>
      <NavBar
        page={page}
        onNavigate={handleNavigate}
        mode={mode}
        onToggleMode={() => setMode(mode === "light" ? "dark" : "light")}
        theme={t}
        compact={sidebarCompact}
        onToggleCompact={() => {
          setAutoCollapseArmed(false);
          setSidebarCompact((c) => !c);
        }}
      />
      <main ref={mainRef} className="app-main" style={mainStyle}>
        {page === "todos" ? (
          <Todos theme={t} sidebarWidth={sidebarWidth} />
        ) : page === "stock-comparison" ? (
          <StockComparison theme={t} sidebarWidth={sidebarWidth} />
        ) : page === "put-optimizer" ? (
          <OptionsOptimizer theme={t} sidebarWidth={sidebarWidth} />
        ) : page === "options-screener" ? (
          <OptionsScreener theme={t} sidebarWidth={sidebarWidth} />
        ) : page === "agent" ? (
          <Agent theme={t} />
        ) : page === "sourcing" ? (
          <Sourcing theme={t} />
        ) : page === "schwab" ? (
          <Schwab theme={t} sidebarWidth={sidebarWidth} />
        ) : page === "website" ? (
          <Website theme={t} />
        ) : (
          <div className="app-main-inner" style={mainInnerStyle}>
            {page === "home" && <Home theme={t} />}
            {page === "options-pricing" && <OptionsPricing theme={t} />}
            {page === "rankinator" && <Rankinator theme={t} />}
            {page === "raise-ai" && <RaiseAi theme={t} />}
            {page === "assignment-check" && <AssignmentCheck theme={t} />}
            {page === "extractor" && <Extractor theme={t} />}
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
