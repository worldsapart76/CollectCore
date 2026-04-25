import { useState, useEffect } from "react";
import TopNav from "./TopNav";
import { PageActionsProvider } from "../../contexts/PageActionsContext";

export default function AppShell({ children }) {
  const [theme, setTheme] = useState(() => localStorage.getItem("cc-theme") || "light");

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("cc-theme", theme);
  }, [theme]);

  function toggleTheme() {
    setTheme((t) => (t === "dark" ? "light" : "dark"));
  }

  return (
    <PageActionsProvider>
      <div className="app-shell">
        <TopNav theme={theme} toggleTheme={toggleTheme} />
        <main className="app-main">{children}</main>
      </div>
    </PageActionsProvider>
  );
}
