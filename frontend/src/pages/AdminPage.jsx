import { useEffect, useState } from "react";
import PageContainer from "../components/layout/PageContainer";
import { MODULE_DEFS } from "../modules";
import { fetchSettings, updateSetting } from "../api";

export default function AdminPage() {
  const [enabledIds, setEnabledIds] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchSettings()
      .then(settings => {
        try {
          setEnabledIds(JSON.parse(settings.modules_enabled || "[]"));
        } catch {
          setEnabledIds(Object.keys(MODULE_DEFS));
        }
      })
      .catch(() => setError("Failed to load settings."));
  }, []);

  async function handleToggle(moduleId) {
    const next = enabledIds.includes(moduleId)
      ? enabledIds.filter(id => id !== moduleId)
      : [...enabledIds, moduleId];

    setSaving(true);
    setError(null);
    try {
      await updateSetting("modules_enabled", JSON.stringify(next));
      setEnabledIds(next);
    } catch {
      setError("Failed to save settings.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <PageContainer title="Admin / Settings">
      <section style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: "1rem", fontWeight: 600, margin: "0 0 10px" }}>Modules</h2>
        {enabledIds === null && !error && <p style={{ color: "#444" }}>Loading…</p>}
        {error && <p style={{ color: "#9b1c1c" }}>{error}</p>}
        {enabledIds !== null && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {Object.values(MODULE_DEFS).map(mod => (
              <label key={mod.id} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={enabledIds.includes(mod.id)}
                  disabled={saving}
                  onChange={() => handleToggle(mod.id)}
                />
                <span style={{ fontWeight: 500 }}>{mod.label}</span>
                <span style={{ color: "#666", fontSize: "0.9rem" }}>{mod.description}</span>
              </label>
            ))}
          </div>
        )}
        {saving && <p style={{ color: "#444", marginTop: 8 }}>Saving…</p>}
      </section>
    </PageContainer>
  );
}
