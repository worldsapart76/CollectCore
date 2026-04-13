import { useEffect, useState } from "react";
import PageContainer from "../components/layout/PageContainer";
import HomeTile from "../components/home/HomeTile";
import { MODULE_DEFS } from "../modules";
import { fetchSettings } from "../api";

export default function HomePage() {
  const [modules, setModules] = useState([]);

  useEffect(() => {
    fetchSettings()
      .then(settings => {
        try {
          const ids = JSON.parse(settings.modules_enabled || "[]");
          setModules(ids.map(id => MODULE_DEFS[id]).filter(Boolean).sort((a, b) => a.label.localeCompare(b.label)));
        } catch {
          setModules(Object.values(MODULE_DEFS).sort((a, b) => a.label.localeCompare(b.label)));
        }
      })
      .catch(() => setModules(Object.values(MODULE_DEFS).sort((a, b) => a.label.localeCompare(b.label))));
  }, []);

  return (
    <PageContainer>
      <div className="home-grid">
        {modules.map(mod => (
          <HomeTile
            key={mod.id}
            title={mod.label}
            description={mod.description}
            to={mod.primaryPath}
          />
        ))}
      </div>
    </PageContainer>
  );
}
