import { useState, useEffect, lazy, Suspense } from "react";
import { lightTheme, darkTheme, type ThemeMode, type Theme } from "./theme";
import { PAGE_LAYOUT } from "./theme";
import { NavBar, SIDEBAR_WIDTH, SIDEBAR_WIDTH_COMPACT } from "./components/NavBar";
import { PasswordGate, getIsUnlocked } from "./components/PasswordGate";
import {
  Home,
  OptionsOptimizer,
  StockComparison,
  OptionsBuilder,
  Todos,
  OptionsOpportunities,
  OptionsRoll,
  Rankinator,
  RaiseAi,
  AssignmentCheck,
  Website,
  Extractor,
} from "./pages";
import { OptionsPricing } from "./pages/OptionsPricing";

const EmailCrm = lazy(() =>
  import("./pages/EmailCrm").then((m) => ({ default: m.EmailCrm }))
);

export type Page =
  | "home"
  | "put-optimizer"
  | "stock-comparison"
  | "options-pricing"
  | "options-builder"
  | "todos"
  | "options-opportunities"
  | "options-roll"
  | "rankinator"
  | "raise-ai"
  | "email-crm"
  | "assignment-check"
  | "website"
  | "extractor";

function App() {
  const [unlocked, setUnlocked] = useState(false);
  const [page, setPage] = useState<Page>("home");
  const [mode, setMode] = useState<ThemeMode>("light");
  const [sidebarCompact, setSidebarCompact] = useState(false);
  const sidebarWidth = sidebarCompact ? SIDEBAR_WIDTH_COMPACT : SIDEBAR_WIDTH;

  useEffect(() => {
    setUnlocked(getIsUnlocked());
  }, []);

  const t: Theme = mode === "light" ? lightTheme : darkTheme;

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
        onNavigate={setPage}
        mode={mode}
        onToggleMode={() => setMode(mode === "light" ? "dark" : "light")}
        theme={t}
        compact={sidebarCompact}
        onToggleCompact={() => setSidebarCompact((c) => !c)}
      />
      <main className="app-main" style={mainStyle}>
        {page === "todos" ? (
          <Todos theme={t} sidebarWidth={sidebarWidth} />
        ) : page === "stock-comparison" ? (
          <StockComparison theme={t} sidebarWidth={sidebarWidth} />
        ) : page === "put-optimizer" ? (
          <OptionsOptimizer theme={t} sidebarWidth={sidebarWidth} />
        ) : page === "options-opportunities" ? (
          <OptionsOpportunities theme={t} sidebarWidth={sidebarWidth} />
        ) : page === "website" ? (
          <Website theme={t} />
        ) : (
          <div className="app-main-inner" style={mainInnerStyle}>
            {page === "home" && <Home theme={t} />}
            {page === "options-pricing" && <OptionsPricing theme={t} />}
            {page === "options-builder" && <OptionsBuilder theme={t} />}
            {page === "options-roll" && <OptionsRoll theme={t} />}
            {page === "rankinator" && <Rankinator theme={t} />}
            {page === "raise-ai" && <RaiseAi theme={t} />}
            {page === "assignment-check" && <AssignmentCheck theme={t} />}
            {page === "extractor" && <Extractor theme={t} />}
            {page === "email-crm" && (
              <Suspense
                fallback={
                  <p style={{ color: t.colors.textMuted, padding: t.spacing(4) }}>
                    Loading Email CRM…
                  </p>
                }
              >
                <EmailCrm theme={t} />
              </Suspense>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
