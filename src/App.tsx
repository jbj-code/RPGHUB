import { useState, useEffect } from "react";
import { lightTheme, darkTheme, type ThemeMode, type Theme } from "./theme";
import { NavBar, SIDEBAR_WIDTH, SIDEBAR_WIDTH_COMPACT } from "./components/NavBar";
import { PasswordGate, getIsUnlocked } from "./components/PasswordGate";
import {
  Home,
  OptionsOptimizer,
  StockComparison,
  OptionsBuilder,
  Todos,
  Clients,
  Rankinator,
  RaiseAi,
  ClientDetail,
  GraphTool,
} from "./pages";
import { OptionsPricing } from "./pages/OptionsPricing";

export type Page =
  | "home"
  | "put-optimizer"
  | "stock-comparison"
  | "options-pricing"
  | "options-builder"
  | "todos"
  | "clients"
  | "client-detail"
  | "graph-tool"
  | "rankinator"
  | "raise-ai";

const PAGE_PADDING_H = 6;

function App() {
  const [unlocked, setUnlocked] = useState(false);
  const [page, setPage] = useState<Page>("home");
  const [mode, setMode] = useState<ThemeMode>("light");
  const [sidebarCompact, setSidebarCompact] = useState(false);
  const [selectedClient, setSelectedClient] = useState<string | null>(null);
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
    maxWidth: 1280,
    margin: "0 auto",
    padding: `${t.spacing(6)} ${t.spacing(PAGE_PADDING_H)}`,
  };

  return (
    <div className="app-layout" style={layoutStyle}>
      <NavBar
        page={page}
        onNavigate={setPage}
        onSelectClient={setSelectedClient}
        selectedClient={selectedClient}
        mode={mode}
        onToggleMode={() => setMode(mode === "light" ? "dark" : "light")}
        theme={t}
        compact={sidebarCompact}
        onToggleCompact={() => setSidebarCompact((c) => !c)}
      />
      <main className="app-main" style={mainStyle}>
        {page === "todos" ? (
          <Todos theme={t} sidebarWidth={sidebarWidth} />
        ) : (
          <div className="app-main-inner" style={mainInnerStyle}>
            {page === "home" && <Home theme={t} />}
            {page === "put-optimizer" && <OptionsOptimizer theme={t} />}
            {page === "stock-comparison" && <StockComparison theme={t} />}
            {page === "options-pricing" && <OptionsPricing theme={t} />}
            {page === "options-builder" && <OptionsBuilder theme={t} />}
            {page === "clients" && <Clients theme={t} />}
            {page === "client-detail" && (
              <ClientDetail theme={t} clientName={selectedClient ?? "Client"} />
            )}
            {page === "graph-tool" && <GraphTool theme={t} />}
            {page === "rankinator" && <Rankinator theme={t} />}
            {page === "raise-ai" && <RaiseAi theme={t} />}
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
