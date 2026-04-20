import { useEffect, useRef, useState } from "react";
import PageContainer from "../components/layout/PageContainer";
import { MODULE_DEFS } from "../modules";
import { deactivateLookups, downloadBackup, fetchSettings, restoreBackup, scanUnusedLookups, updateSetting } from "../api";

export default function AdminPage() {
  const [enabledIds, setEnabledIds] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const [backupStatus, setBackupStatus] = useState(null); // null | "working" | "done" | "error"
  const [backupError, setBackupError] = useState(null);
  const [restoreStatus, setRestoreStatus] = useState(null); // null | "confirming" | "working" | "done" | "error"
  const [restoreError, setRestoreError] = useState(null);
  const [pendingRestoreFile, setPendingRestoreFile] = useState(null);
  const restoreInputRef = useRef(null);

  // Unused lookup cleanup
  const [unusedLookups, setUnusedLookups] = useState(null); // null = not scanned, [] = clean
  const [lookupScanStatus, setLookupScanStatus] = useState(null); // null | "scanning" | "done" | "error"
  const [lookupScanError, setLookupScanError] = useState(null);
  const [selectedForDeactivation, setSelectedForDeactivation] = useState({}); // { table: Set(ids) }
  const [deactivating, setDeactivating] = useState(false);

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

  async function handleBackup() {
    setBackupStatus("working");
    setBackupError(null);
    try {
      const { blob, filename } = await downloadBackup();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      setBackupStatus("done");
    } catch (e) {
      setBackupError(e.message || "Backup failed.");
      setBackupStatus("error");
    }
  }

  function handleRestoreSelect(e) {
    const file = e.target.files[0];
    if (!file) return;
    setPendingRestoreFile(file);
    setRestoreStatus("confirming");
    setRestoreError(null);
    // Reset the file input so the same file can be re-selected if needed
    if (restoreInputRef.current) restoreInputRef.current.value = "";
  }

  function handleRestoreCancel() {
    setPendingRestoreFile(null);
    setRestoreStatus(null);
    setRestoreError(null);
  }

  async function handleRestoreConfirm() {
    if (!pendingRestoreFile) return;
    setRestoreStatus("working");
    setRestoreError(null);
    try {
      await restoreBackup(pendingRestoreFile);
      setPendingRestoreFile(null);
      setRestoreStatus("done");
    } catch (e) {
      setRestoreError(e.message || "Restore failed.");
      setRestoreStatus("error");
    }
  }

  async function handleScanUnused() {
    setLookupScanStatus("scanning");
    setLookupScanError(null);
    setUnusedLookups(null);
    setSelectedForDeactivation({});
    try {
      const data = await scanUnusedLookups();
      setUnusedLookups(data);
      setLookupScanStatus("done");
      // Pre-select all values by default
      const sel = {};
      for (const group of data) {
        sel[group.table] = new Set(group.values.map(v => v.id));
      }
      setSelectedForDeactivation(sel);
    } catch (e) {
      setLookupScanError(e.message || "Scan failed.");
      setLookupScanStatus("error");
    }
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
        if (idArray.length > 0) {
          await deactivateLookups(table, idArray);
        }
      }
      // Re-scan to refresh
      await handleScanUnused();
    } catch (e) {
      setLookupScanError(e.message || "Deactivation failed.");
    } finally {
      setDeactivating(false);
    }
  }

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

      <section style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: "1rem", fontWeight: 600, margin: "0 0 10px" }}>Backup &amp; Restore</h2>
        <p style={{ color: "#555", fontSize: "0.9rem", margin: "0 0 12px" }}>
          Backup includes the full database (all modules) and all library images.
          Restoring will overwrite your current data — you will be asked to confirm.
        </p>

        {/* Backup */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
          <button
            onClick={handleBackup}
            disabled={backupStatus === "working"}
            style={{ padding: "5px 14px", cursor: backupStatus === "working" ? "default" : "pointer" }}
          >
            {backupStatus === "working" ? "Creating backup…" : "Download Backup"}
          </button>
          {backupStatus === "done" && (
            <span style={{ color: "#166534", fontSize: "0.9rem" }}>Backup downloaded.</span>
          )}
          {backupStatus === "error" && (
            <span style={{ color: "#9b1c1c", fontSize: "0.9rem" }}>{backupError}</span>
          )}
        </div>

        {/* Restore */}
        <div>
          <input
            ref={restoreInputRef}
            type="file"
            accept=".zip"
            style={{ display: "none" }}
            onChange={handleRestoreSelect}
          />
          {restoreStatus !== "confirming" && restoreStatus !== "working" && (
            <button
              onClick={() => restoreInputRef.current?.click()}
              style={{ padding: "5px 14px", cursor: "pointer" }}
            >
              Restore from Backup…
            </button>
          )}

          {restoreStatus === "confirming" && (
            <div style={{
              display: "inline-flex", alignItems: "center", gap: 10,
              background: "#fef3c7", border: "1px solid #d97706",
              padding: "6px 12px", borderRadius: 4,
            }}>
              <span style={{ fontSize: "0.9rem" }}>
                Replace all data with <strong>{pendingRestoreFile?.name}</strong>?
              </span>
              <button
                onClick={handleRestoreConfirm}
                style={{ padding: "3px 10px", background: "#b91c1c", color: "#fff", border: "none", borderRadius: 3, cursor: "pointer" }}
              >
                Yes, restore
              </button>
              <button
                onClick={handleRestoreCancel}
                style={{ padding: "3px 10px", cursor: "pointer" }}
              >
                Cancel
              </button>
            </div>
          )}

          {restoreStatus === "working" && (
            <span style={{ color: "#444", fontSize: "0.9rem" }}>Restoring…</span>
          )}
          {restoreStatus === "done" && (
            <span style={{ color: "#166534", fontSize: "0.9rem", marginLeft: 10 }}>
              Restore complete. Reload the page to continue.
            </span>
          )}
          {restoreStatus === "error" && (
            <span style={{ color: "#9b1c1c", fontSize: "0.9rem", marginLeft: 10 }}>{restoreError}</span>
          )}
        </div>
      </section>
      <section style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: "1rem", fontWeight: 600, margin: "0 0 10px" }}>Unused Lookup Cleanup</h2>
        <p style={{ color: "#555", fontSize: "0.9rem", margin: "0 0 12px" }}>
          Scan for lookup values (authors, tags, publishers, etc.) that are no longer
          associated with any records. Deactivating hides them from dropdowns without
          deleting them from the database.
        </p>

        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
          <button
            onClick={handleScanUnused}
            disabled={lookupScanStatus === "scanning" || deactivating}
            style={{ padding: "5px 14px", cursor: lookupScanStatus === "scanning" ? "default" : "pointer" }}
          >
            {lookupScanStatus === "scanning" ? "Scanning…" : "Scan for Unused Values"}
          </button>
          {lookupScanStatus === "error" && (
            <span style={{ color: "#9b1c1c", fontSize: "0.9rem" }}>{lookupScanError}</span>
          )}
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
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={() => toggleAllInTable(group.table, allIds)}
                      disabled={deactivating}
                    />
                    <strong style={{ fontSize: "0.9rem" }}>
                      {group.label} ({group.values.length})
                    </strong>
                  </div>
                  <div style={{ marginLeft: 24, display: "flex", flexDirection: "column", gap: 2 }}>
                    {group.values.map(v => (
                      <label key={v.id} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: "0.85rem" }}>
                        <input
                          type="checkbox"
                          checked={selected.has(v.id)}
                          onChange={() => toggleLookupValue(group.table, v.id)}
                          disabled={deactivating}
                        />
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
                style={{
                  padding: "5px 14px",
                  background: "#b91c1c",
                  color: "#fff",
                  border: "none",
                  borderRadius: 3,
                  cursor: deactivating ? "default" : "pointer",
                }}
              >
                {deactivating ? "Deactivating…" : "Deactivate Selected"}
              </button>
            </div>
          </div>
        )}
      </section>
    </PageContainer>
  );
}
