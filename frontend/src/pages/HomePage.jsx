import { useEffect, useState } from "react";
import PageContainer from "../components/layout/PageContainer";
import HomeTile from "../components/home/HomeTile";
import { MODULE_DEFS } from "../modules";
import { fetchSettings } from "../api";

export default function HomePage() {
  const [modules, setModules] = useState([]);

  useEffect(() => {
    function applyIds(ids) {
      setModules(ids.map(id => MODULE_DEFS[id]).filter(Boolean).sort((a, b) => a.label.localeCompare(b.label)));
    }
    function load() {
      fetchSettings()
        .then(settings => {
          try { applyIds(JSON.parse(settings.modules_enabled || "[]")); }
          catch { setModules(Object.values(MODULE_DEFS).sort((a, b) => a.label.localeCompare(b.label))); }
        })
        .catch(() => setModules(Object.values(MODULE_DEFS).sort((a, b) => a.label.localeCompare(b.label))));
    }
    load();
    function handleChange(e) {
      if (Array.isArray(e.detail)) applyIds(e.detail); else load();
    }
    window.addEventListener("collectcore:modules-changed", handleChange);
    return () => window.removeEventListener("collectcore:modules-changed", handleChange);
  }, []);

  return (
    <PageContainer>
      <div className="home-grid">
        {modules.map(mod => (
          <HomeTile
            key={mod.id}
            title={mod.label}
            to={mod.primaryPath}
          />
        ))}
      </div>
    </PageContainer>
  );
}
