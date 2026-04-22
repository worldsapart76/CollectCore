import { useEffect, useRef, useState } from "react";
import PageContainer from "../components/layout/PageContainer";
import { MODULE_DEFS } from "../modules";
import {
  deactivateLookups,
  downloadBackupByToken,
  fetchSettings,
  fetchStatusVisibility,
  prepareBackup,
  restoreBackup,
  scanUnusedLookups,
  toggleStatusVisibility,
  updateSetting,
} from "../api";

const TAB_IDS = ["modules", "backup", "cleanup", "visibility"];
const TAB_LABELS = { modules: "Modules", backup: "Backup & Restore", cleanup: "Lookup Cleanup", visibility: "Status Visibility" };

const tabBarStyle = { display: "flex", gap: 0, borderBottom: "1px solid #d1d5db", marginBottom: 20 };
function tabStyle(active) {
  return {
    padding: "7px 18px",
    fontSize: "0.875rem",
    fontWeight: active ? 600 : 400,
    color: active ? "#1d4ed8" : "#555",
    background: "none",
    border: "none",
    borderBottom: active ? "2px solid #1d4ed8" : "2px solid transparent",
    cursor: "pointer",
    marginBottom: -1,
  };
}

export default function AdminPage() {
  const [activeTab, setActiveTab] = useState("modules");

  // ── Modules ──────────────────────────────────────────────────────────────────
  const [enabledIds, setEnabledIds] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  // ── Backup & Restore ─────────────────────────────────────────────────────────
  const [backupStatus, setBackupStatus] = useState(null);
  const [backupError, setBackupError] = useState(null);
  const [backupProgress, setBackupProgress] = useState(0);
  const [restoreStatus, setRestoreStatus] = useState(null);
  const [restoreError, setRestoreError] = useState(null);
  const [pendingRestoreFile, setPendingRestoreFile] = useState(null);
  const restoreInputRef = useRef(null);

  // ── Lookup Cleanup ────────────────────────────────────────────────────────────
  const [unusedLookups, setUnusedLookups] = useState(null);
  const [lookupScanStatus, setLookupScanStatus] = useState(null);
  const [lookupScanError, setLookupScanError] = useState(null);
  const [selectedForDeactivation, setSelectedForDeactivation] = useState({});
  const [deactivating, setDeactivating] = useState(false);

  // ── Status Visibility ─────────────────────────────────────────────────────────
  const [visibility, setVisibility] = useState(null); // { modules, ownership, consumption }
  const [visibilityLoading, setVisibilityLoading] = useState(false);
  const [visibilityError, setVisibilityError] = useState(null);

  useEffect(() => {
    fetchSettings()
      .then(settings => {
        try { setEnabledIds(JSON.parse(settings.modules_enabled || "[]")); }
        catch { setEnabledIds(Object.keys(MODULE_DEFS)); }
      })
      .catch(() => setError("Failed to load settings."));
  }, []);

  useEffect(() => {
    if (activeTab === "visibility" && !visibility && !visibilityLoading) {
      setVisibilityLoading(true);
      fetchStatusVisibility()
        .then(data => { setVisibility(data); setVisibilityLoading(false); })
        .catch(e => { setVisibilityError(e.message || "Failed to load status visibility."); setVisibilityLoading(false); });
    }
  }, [activeTab, visibility, visibilityLoading]);

  // ── Modules handlers ──────────────────────────────────────────────────────────
  async function handleToggle(moduleId) {
    const next = enabledIds.includes(moduleId)
      ? enabledIds.filter(id => id !== moduleId)
      : [...enabledIds, moduleId];
    setSaving(true); setError(null);
    try {
      await updateSetting("modules_enabled", JSON.stringify(next));
      setEnabledIds(next);
    } catch { setError("Failed to save settings."); }
    finally { setSaving(false); }
  }

  // ── Backup handlers ───────────────────────────────────────────────────────────
  async function handleBackup() {
    setBackupStatus("preparing"); setBackupError(null); setBackupProgress(0);
    try {
      const { token, filename, size_bytes } = await prepareBackup();
      setBackupStatus("downloading");
      const { blob } = await downloadBackupByToken(token, (received, total) => {
        setBackupProgress(Math.round((received / total) * 100));
      });
      if (window.showSaveFilePicker) {
        try {
          const handle = await window.showSaveFilePicker({
            suggestedName: filename,
            types: [{ description: "ZIP archive", accept: { "application/zip": [".zip"] } }],
          });
          const writable = await handle.createWritable();
          await writable.write(blob);
          await writable.close();
          setBackupStatus("done");
          return;
        } catch (pickerErr) {
          if (pickerErr.name === "AbortError") { setBackupStatus(null); return; }
        }
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
      setBackupStatus("done");
    } catch (e) { setBackupError(e.message || "Backup failed."); setBackupStatus("error"); }
  }

  function handleRestoreSelect(e) {
    const file = e.target.files[0];
    if (!file) return;
    setPendingRestoreFile(file);
    setRestoreStatus("confirming");
    setRestoreError(null);
    if (restoreInputRef.current) restoreInputRef.current.value = "";
  }
  function handleRestoreCancel() { setPendingRestoreFile(null); setRestoreStatus(null); setRestoreError(null); }
  async function handleRestoreConfirm() {
    if (!pendingRestoreFile) return;
    setRestoreStatus("working"); setRestoreError(null);
    try {
      await restoreBackup(pendingRestoreFile);
      setPendingRestoreFile(null);
      setRestoreStatus("done");
    } catch (e) { setRestoreError(e.message || "Restore failed."); setRestoreStatus("error"); }
  }

  // ── Lookup Cleanup handlers ───────────────────────────────────────────────────
  async function handleScanUnused() {
    setLookupScanStatus("scanning"); setLookupScanError(null); setUnusedLookups(null); setSelectedForDeactivation({});
    try {
      const data = await scanUnusedLookups();
      setUnusedLookups(data);
      setLookupScanStatus("done");
      const sel = {};
      for (const group of data) sel[group.table] = new Set(group.values.map(v => v.id));
      setSelectedForDeactivation(sel);
    } catch (e) { setLookupScanError(e.message || "Scan failed."); setLookupScanStatus("error"); }
  }
  function toggleLookupValue(table, id) {
    setSelectedForDeactivation(prev => {
      const next = { ...prev };
      const s = new Set(next[table] || []);
      if (s.has(id)) s.delete(id); else s.add(id);
      next[table] = s;
      return next;
    });
  }
  function toggleAllInTable(table, allIds) {
    setSelectedForDeactivation(prev => {
      const next = { ...prev };
      const current = next[table] || new Set();
      const allSelected = allIds.every(id => current.has(id));
      next[table] = allSelected ? new Set() : new Set(allIds);
      return next;
    });
  }
  async function handleDeactivateSelected() {
    setDeactivating(true);
    try {
      for (const [table, ids] of Object.entries(selectedForDeactivation)) {
        const idArray = [...ids];
        if (idArray.length > 0) await deactivateLookups(table, idArray);
      }
      await handleScanUnused();
    } catch (e) { setLookupScanError(e.message || "Deactivation failed."); }
    finally { setDeactivating(false); }
  }

  // ── Status Visibility handlers ────────────────────────────────────────────────
  async function handleVisibilityToggle(statusType, statusId, collectionTypeId, currentlyVisible) {
    const next = !currentlyVisible;
    // Optimistic update
    setVisibility(prev => {
      const key = statusType === "ownership" ? "ownership" : "consumption";
      const idKey = statusType === "ownership" ? "ownership_status_id" : "read_status_id";
      return {
        ...prev,
        [key]: prev[key].map(s => {
          if (s[idKey] !== statusId) return s;
          const moduleIds = next
            ? [...s.module_ids, collectionTypeId]
            : s.module_ids.filter(id => id !== collectionTypeId);
          return { ...s, module_ids: moduleIds };
        }),
      };
    });
    try {
      await toggleStatusVisibility(statusType, statusId, collectionTypeId, next);
    } catch {
      // Roll back on failure
      setVisibility(null);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <PageContainer title="Admin / Settings">
      {/* Tab bar */}
      <div style={tabBarStyle}>
        {TAB_IDS.map(id => (
          <button key={id} style={tabStyle(activeTab === id)} onClick={() => setActiveTab(id)}>
            {TAB_LABELS[id]}
          </button>
        ))}
      </div>

      {/* ── Modules tab ── */}
      {activeTab === "modules" && (
        <section>
          <h2 style={{ fontSize: "1rem", fontWeight: 600, margin: "0 0 10px" }}>Modules</h2>
          {enabledIds === null && !error && <p style={{ color: "#444" }}>Loading…</p>}
          {error && <p style={{ color: "#9b1c1c" }}>{error}</p>}
          {enabledIds !== null && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {Object.values(MODULE_DEFS).map(mod => (
                <label key={mod.id} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                  <input type="checkbox" checked={enabledIds.includes(mod.id)} disabled={saving} onChange={() => handleToggle(mod.id)} />
                  <span style={{ fontWeight: 500 }}>{mod.label}</span>
                  <span style={{ color: "#666", fontSize: "0.9rem" }}>{mod.description}</span>
                </label>
              ))}
            </div>
          )}
          {saving && <p style={{ color: "#444", marginTop: 8 }}>Saving…</p>}
        </section>
      )}

      {/* ── Backup & Restore tab ── */}
      {activeTab === "backup" && (
        <section>
          <h2 style={{ fontSize: "1rem", fontWeight: 600, margin: "0 0 10px" }}>Backup &amp; Restore</h2>
          <p style={{ color: "#555", fontSize: "0.9rem", margin: "0 0 12px" }}>
            Backup includes the full database (all modules) and all library images.
            Restoring will overwrite your current data — you will be asked to confirm.
          </p>

          {/* Backup */}
          <div style={{ marginBottom: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <button
                onClick={handleBackup}
                disabled={backupStatus === "preparing" || backupStatus === "downloading"}
                style={{ padding: "5px 14px", cursor: (backupStatus === "preparing" || backupStatus === "downloading") ? "default" : "pointer" }}
              >
                {backupStatus === "preparing" ? "Preparing backup…" : backupStatus === "downloading" ? "Downloading…" : "Download Backup"}
              </button>
              {backupStatus === "done" && <span style={{ color: "#166534", fontSize: "0.9rem" }}>Backup complete.</span>}
              {backupStatus === "error" && <span style={{ color: "#9b1c1c", fontSize: "0.9rem" }}>{backupError}</span>}
            </div>
            {(backupStatus === "preparing" || backupStatus === "downloading") && (
              <div style={{ marginTop: 6 }}>
                <div style={{ background: "#e5e7eb", borderRadius: 4, height: 14, width: 260, overflow: "hidden" }}>
                  <div style={{
                    background: backupStatus === "preparing" ? "#6b7280" : "#2563eb",
                    height: "100%",
                    width: backupStatus === "preparing" ? "100%" : `${backupProgress}%`,
                    transition: "width 0.2s",
                    animation: backupStatus === "preparing" ? "pulse 1.5s ease-in-out infinite" : "none",
                    opacity: backupStatus === "preparing" ? 0.6 : 1,
                  }} />
                </div>
                <span style={{ fontSize: "0.8rem", color: "#666", marginTop: 2, display: "block" }}>
                  {backupStatus === "preparing" ? "Building backup archive…" : `${backupProgress}%`}
                </span>
              </div>
            )}
          </div>

          {/* Restore */}
          <div>
            <input ref={restoreInputRef} type="file" accept=".zip" style={{ display: "none" }} onChange={handleRestoreSelect} />
            {restoreStatus !== "confirming" && restoreStatus !== "working" && (
              <button onClick={() => restoreInputRef.current?.click()} style={{ padding: "5px 14px", cursor: "pointer" }}>
                Restore from Backup…
              </button>
            )}
            {restoreStatus === "confirming" && (
              <div style={{ display: "inline-flex", alignItems: "center", gap: 10, background: "#fef3c7", border: "1px solid #d97706", padding: "6px 12px", borderRadius: 4 }}>
                <span style={{ fontSize: "0.9rem" }}>Replace all data with <strong>{pendingRestoreFile?.name}</strong>?</span>
                <button onClick={handleRestoreConfirm} style={{ padding: "3px 10px", background: "#b91c1c", color: "#fff", border: "none", borderRadius: 3, cursor: "pointer" }}>Yes, restore</button>
                <button onClick={handleRestoreCancel} style={{ padding: "3px 10px", cursor: "pointer" }}>Cancel</button>
              </div>
            )}
            {restoreStatus === "working" && <span style={{ color: "#444", fontSize: "0.9rem" }}>Restoring…</span>}
            {restoreStatus === "done" && <span style={{ color: "#166534", fontSize: "0.9rem", marginLeft: 10 }}>Restore complete. Reload the page to continue.</span>}
            {restoreStatus === "error" && <span style={{ color: "#9b1c1c", fontSize: "0.9rem", marginLeft: 10 }}>{restoreError}</span>}
          </div>
        </section>
      )}

      {/* ── Lookup Cleanup tab ── */}
      {activeTab === "cleanup" && (
        <section>
          <h2 style={{ fontSize: "1rem", fontWeight: 600, margin: "0 0 10px" }}>Unused Lookup Cleanup</h2>
          <p style={{ color: "#555", fontSize: "0.9rem", margin: "0 0 12px" }}>
            Scan for lookup values (authors, tags, publishers, etc.) that are no longer
            associated with any records. Deactivating hides them from dropdowns without
            deleting them from the database.
          </p>

          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
            <button onClick={handleScanUnused} disabled={lookupScanStatus === "scanning" || deactivating} style={{ padding: "5px 14px", cursor: lookupScanStatus === "scanning" ? "default" : "pointer" }}>
              {lookupScanStatus === "scanning" ? "Scanning…" : "Scan for Unused Values"}
            </button>
            {lookupScanStatus === "error" && <span style={{ color: "#9b1c1c", fontSize: "0.9rem" }}>{lookupScanError}</span>}
          </div>

          {lookupScanStatus === "done" && unusedLookups && unusedLookups.length === 0 && (
            <p style={{ color: "#166534", fontSize: "0.9rem" }}>No unused lookup values found.</p>
          )}

          {lookupScanStatus === "done" && unusedLookups && unusedLookups.length > 0 && (
            <div>
              {unusedLookups.map(group => {
                const selected = selectedForDeactivation[group.table] || new Set();
                const allIds = group.values.map(v => v.id);
                const allSelected = allIds.every(id => selected.has(id));
                return (
                  <div key={group.table} style={{ marginBottom: 14 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                      <input type="checkbox" checked={allSelected} onChange={() => toggleAllInTable(group.table, allIds)} disabled={deactivating} />
                      <strong style={{ fontSize: "0.9rem" }}>{group.label} ({group.values.length})</strong>
                    </div>
                    <div style={{ marginLeft: 24, display: "flex", flexDirection: "column", gap: 2 }}>
                      {group.values.map(v => (
                        <label key={v.id} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: "0.85rem" }}>
                          <input type="checkbox" checked={selected.has(v.id)} onChange={() => toggleLookupValue(group.table, v.id)} disabled={deactivating} />
                          {v.name}
                        </label>
                      ))}
                    </div>
                  </div>
                );
              })}
              <div style={{ marginTop: 8 }}>
                <button
                  onClick={handleDeactivateSelected}
                  disabled={deactivating || Object.values(selectedForDeactivation).every(s => s.size === 0)}
                  style={{ padding: "5px 14px", background: "#b91c1c", color: "#fff", border: "none", borderRadius: 3, cursor: deactivating ? "default" : "pointer" }}
                >
                  {deactivating ? "Deactivating…" : "Deactivate Selected"}
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      {/* ── Status Visibility tab ── */}
      {activeTab === "visibility" && (
        <section>
          <h2 style={{ fontSize: "1rem", fontWeight: 600, margin: "0 0 4px" }}>Status Visibility</h2>
          <p style={{ color: "#555", fontSize: "0.9rem", margin: "0 0 16px" }}>
            Control which ownership and consumption statuses appear in each module.
            Changes take effect immediately.
          </p>

          {visibilityLoading && <p style={{ color: "#444" }}>Loading…</p>}
          {visibilityError && <p style={{ color: "#9b1c1c" }}>{visibilityError}</p>}

          {visibility && (
            <>
              <StatusGrid
                title="Ownership Statuses"
                statuses={visibility.ownership}
                statusIdKey="ownership_status_id"
                modules={visibility.modules}
                statusType="ownership"
                onToggle={handleVisibilityToggle}
              />
              <StatusGrid
                title="Consumption Statuses"
                statuses={visibility.consumption}
                statusIdKey="read_status_id"
                modules={visibility.modules.filter(m => ["books", "graphicnovels", "videogames", "video"].includes(m.code))}
                statusType="consumption"
                onToggle={handleVisibilityToggle}
              />
            </>
          )}
        </section>
      )}
    </PageContainer>
  );
}

// ── Status visibility grid component ─────────────────────────────────────────

function StatusGrid({ title, statuses, statusIdKey, modules, statusType, onToggle }) {
  const thStyle = { padding: "4px 10px", fontSize: "0.8rem", fontWeight: 600, color: "#444", textAlign: "center", borderBottom: "1px solid #e5e7eb", whiteSpace: "nowrap" };
  const tdStyle = { padding: "4px 10px", fontSize: "0.85rem", borderBottom: "1px solid #f3f4f6", textAlign: "center" };
  const nameStyle = { ...tdStyle, textAlign: "left", whiteSpace: "nowrap", color: "#111" };

  return (
    <div style={{ marginBottom: 28 }}>
      <h3 style={{ fontSize: "0.9rem", fontWeight: 600, margin: "0 0 8px", color: "#333" }}>{title}</h3>
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", fontSize: "0.85rem", background: "#fff" }}>
          <thead>
            <tr>
              <th style={{ ...thStyle, textAlign: "left" }}>Status</th>
              {modules.map(m => (
                <th key={m.collection_type_id} style={thStyle}>{m.name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {statuses.map(s => (
              <tr key={s[statusIdKey]}>
                <td style={nameStyle}>{s.status_name}</td>
                {modules.map(m => {
                  const visible = s.module_ids.includes(m.collection_type_id);
                  return (
                    <td key={m.collection_type_id} style={tdStyle}>
                      <input
                        type="checkbox"
                        checked={visible}
                        onChange={() => onToggle(statusType, s[statusIdKey], m.collection_type_id, visible)}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
