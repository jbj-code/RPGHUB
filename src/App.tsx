import { useState, useEffect } from "react";
import { lightTheme, darkTheme, type ThemeMode, type Theme } from "./theme";
import { NavBar, SIDEBAR_WIDTH } from "./components/NavBar";
import { PasswordGate, getIsUnlocked } from "./components/PasswordGate";
import { Home, OptionsOptimizer, StockComparison, Rankinator, RaiseAi, WeeklyHighlights } from "./pages";
import { OptionsPricing } from "./pages/OptionsPricing";

export type Page =
  | "home"
  | "put-optimizer"
  | "stock-comparison"
  | "options-pricing"
  | "rankinator"
  | "raise-ai"
  | "weekly-highlights";

const PAGE_PADDING_H = 9;

function App() {
  const [unlocked, setUnlocked] = useState(false);
  const [page, setPage] = useState<Page>("home");
  const [mode, setMode] = useState<ThemeMode>("light");

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
    marginLeft: SIDEBAR_WIDTH,
    backgroundColor: t.colors.background,
    fontFamily: t.typography.fontFamily,
    color: t.colors.text,
    fontSize: t.typography.baseFontSize,
  };

  const mainInnerStyle: React.CSSProperties = {
    maxWidth: 1280,
    margin: "0 auto",
    padding: `${t.spacing(6)} ${t.spacing(PAGE_PADDING_H)}`,
  };

  return (
    <div className="app-layout" style={layoutStyle}>
      <NavBar
        page={page}
        onNavigate={setPage}
        mode={mode}
        onToggleMode={() => setMode(mode === "light" ? "dark" : "light")}
        theme={t}
      />
      <main className="app-main" style={mainStyle}>
        <div className="app-main-inner" style={mainInnerStyle}>
          {page === "home" && <Home theme={t} />}
          {page === "put-optimizer" && <OptionsOptimizer theme={t} />}
          {page === "stock-comparison" && <StockComparison theme={t} />}
          {page === "options-pricing" && <OptionsPricing theme={t} />}
          {page === "rankinator" && <Rankinator theme={t} />}
          {page === "raise-ai" && <RaiseAi theme={t} />}
          {page === "weekly-highlights" && <WeeklyHighlights theme={t} />}
        </div>
      </main>
    </div>
  );
}

export default App;
