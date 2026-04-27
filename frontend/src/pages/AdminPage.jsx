import { useEffect, useMemo, useRef, useState } from "react";
import PageContainer from "../components/layout/PageContainer";
import { MODULE_DEFS } from "../modules";
import {
  createLookupRow,
  deactivateLookups,
  deleteLookupRow,
  downloadBackupByToken,
  fetchLookupRegistry,
  fetchLookupRows,
  fetchSettings,
  fetchStatusVisibility,
  mergeLookupRows,
  patchLookupRow,
  prepareBackup,
  publishCatalogToR2,
  regenerateGuestSeed,
  restoreBackup,
  scanUnusedLookups,
  toggleStatusVisibility,
  updateSetting,
} from "../api";

const TAB_IDS = ["modules", "backup", "cleanup", "management", "visibility"];
const TAB_LABELS = {
  modules: "Modules",
  backup: "Backup & Restore",
  cleanup: "Lookup Cleanup",
  management: "Lookup Management",
  visibility: "Status Visibility",
};

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

  // ── Guest seed regeneration ──────────────────────────────────────────────────
  const [seedStatus, setSeedStatus] = useState(null);
  const [seedInfo, setSeedInfo] = useState(null);
  const [seedError, setSeedError] = useState(null);

  // ── Catalog image publish (Railway local → R2) ───────────────────────────────
  const [publishStatus, setPublishStatus] = useState(null);
  const [publishInfo, setPublishInfo] = useState(null);
  const [publishError, setPublishError] = useState(null);
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
      window.dispatchEvent(new CustomEvent("collectcore:modules-changed", { detail: next }));
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

  async function handleRegenerateSeed() {
    setSeedStatus("working"); setSeedInfo(null); setSeedError(null);
    try {
      const info = await regenerateGuestSeed();
      setSeedInfo(info);
      setSeedStatus("done");
    } catch (e) {
      setSeedError(e.message || "Seed regeneration failed.");
      setSeedStatus("error");
    }
  }

  async function handlePublishCatalog() {
    setPublishStatus("working"); setPublishInfo(null); setPublishError(null);
    try {
      const info = await publishCatalogToR2();
      setPublishInfo(info);
      setPublishStatus("done");
    } catch (e) {
      setPublishError(e.message || "Publish failed.");
      setPublishStatus("error");
    }
  }
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

          {/* Catalog image publish */}
          <hr style={{ border: "none", borderTop: "1px solid #e5e7eb", margin: "20px 0" }} />
          <h3 style={{ fontSize: "0.95rem", fontWeight: 600, margin: "0 0 6px" }}>Publish Photocard Images to R2</h3>
          <p style={{ color: "#555", fontSize: "0.9rem", margin: "0 0 10px" }}>
            New or replaced photocard images are saved to Railway local
            storage by default. Guests can't load them from there (they're
            behind Cloudflare Access). This sweeps any unpublished images to
            R2 (the public CDN), rewrites the database to point at the new
            URLs, and bumps the catalog version so guests pick up the
            change on their next sync.
          </p>
          <p style={{ color: "#555", fontSize: "0.9rem", margin: "0 0 10px" }}>
            <strong>When to run this:</strong> after replacing a photocard
            image, or after batch-adding cards from your phone. Skipped
            entirely for images already on R2.
          </p>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button
              onClick={handlePublishCatalog}
              disabled={publishStatus === "working"}
              style={{ padding: "5px 14px", cursor: publishStatus === "working" ? "default" : "pointer" }}
            >
              {publishStatus === "working" ? "Publishing…" : "Publish Photocard Images"}
            </button>
            {publishStatus === "done" && publishInfo && (
              <span style={{ color: "#166534", fontSize: "0.9rem" }}>
                Uploaded {publishInfo.uploaded} image{publishInfo.uploaded === 1 ? "" : "s"}
                {publishInfo.items_touched > 0 && ` across ${publishInfo.items_touched} card${publishInfo.items_touched === 1 ? "" : "s"}`}.
                {publishInfo.skipped_hosted > 0 && ` ${publishInfo.skipped_hosted} already on R2.`}
                {publishInfo.missing_files?.length > 0 && (
                  <span style={{ color: "#9b1c1c" }}> {publishInfo.missing_files.length} file(s) missing on disk.</span>
                )}
              </span>
            )}
            {publishStatus === "error" && (
              <span style={{ color: "#9b1c1c", fontSize: "0.9rem" }}>{publishError}</span>
            )}
          </div>

          {/* Guest seed */}
          <hr style={{ border: "none", borderTop: "1px solid #e5e7eb", margin: "20px 0" }} />
          <h3 style={{ fontSize: "0.95rem", fontWeight: 600, margin: "0 0 6px" }}>Guest Webview Seed</h3>
          <p style={{ color: "#555", fontSize: "0.9rem", margin: "0 0 10px" }}>
            Rebuilds the starter catalog snapshot bundled with the deploy.
            Brand-new guests download this on first visit; existing guests
            don't need it (their app silently syncs new cards, image swaps,
            and lookup updates from the live API on every launch).
          </p>
          <p style={{ color: "#555", fontSize: "0.9rem", margin: "0 0 10px" }}>
            <strong>When to run this:</strong> occasionally — every few weeks,
            or after a large batch of catalog changes — so a fresh guest
            doesn't have to apply thousands of updates on their first visit.
            It is <em>not</em> required for everyday catalog edits.
          </p>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button
              onClick={handleRegenerateSeed}
              disabled={seedStatus === "working"}
              style={{ padding: "5px 14px", cursor: seedStatus === "working" ? "default" : "pointer" }}
            >
              {seedStatus === "working" ? "Regenerating…" : "Regenerate Guest Seed"}
            </button>
            {seedStatus === "done" && seedInfo && (
              <span style={{ color: "#166534", fontSize: "0.9rem" }}>
                Rebuilt: {seedInfo.card_count} cards, {(seedInfo.size_bytes / (1024 * 1024)).toFixed(2)} MB.
              </span>
            )}
            {seedStatus === "error" && (
              <span style={{ color: "#9b1c1c", fontSize: "0.9rem" }}>{seedError}</span>
            )}
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

      {/* ── Lookup Management tab ── */}
      {activeTab === "management" && <LookupManagementTab />}

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

// ── Lookup Management tab component ──────────────────────────────────────────

function LookupManagementTab() {
  const [registry, setRegistry] = useState(null);
  const [registryError, setRegistryError] = useState(null);
  const [selectedTable, setSelectedTable] = useState("");
  const [tableData, setTableData] = useState(null);       // { rows, scope_options, ... }
  const [tableLoading, setTableLoading] = useState(false);
  const [tableError, setTableError] = useState(null);
  const [filter, setFilter] = useState("");
  const [showInactive, setShowInactive] = useState(true);
  const [scopeFilter, setScopeFilter] = useState({});      // { scope_col: scope_id or "" }
  const [editingId, setEditingId] = useState(null);        // row id being edited
  const [editDraft, setEditDraft] = useState(null);        // { name, sort_order, secondary }
  const [rowBusy, setRowBusy] = useState(null);            // row id currently saving/deleting
  const [mergeState, setMergeState] = useState(null);      // { sourceId, targetId } or null
  const [merging, setMerging] = useState(false);
  const [toast, setToast] = useState(null);                // { kind, msg }
  const [addDraft, setAddDraft] = useState(null);          // { name, sort_order, secondary, scope } or null
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    fetchLookupRegistry()
      .then(data => {
        setRegistry(data);
        if (data.length > 0) setSelectedTable(data[0].table);
      })
      .catch(e => setRegistryError(e.message || "Failed to load registry."));
  }, []);

  useEffect(() => {
    if (!selectedTable) return;
    loadTable(selectedTable);
    setFilter("");
    setScopeFilter({});
    setEditingId(null);
    setEditDraft(null);
    setAddDraft(null);
  }, [selectedTable]);

  async function loadTable(table) {
    setTableLoading(true);
    setTableError(null);
    try {
      const data = await fetchLookupRows(table);
      setTableData(data);
    } catch (e) {
      setTableError(e.message || "Failed to load rows.");
      setTableData(null);
    } finally {
      setTableLoading(false);
    }
  }

  const selectedEntry = useMemo(
    () => registry?.find(e => e.table === selectedTable),
    [registry, selectedTable]
  );

  const filteredRows = useMemo(() => {
    if (!tableData) return [];
    const q = filter.trim().toLowerCase();
    return tableData.rows.filter(row => {
      if (!showInactive && !row.is_active) return false;
      if (q && !row.name.toLowerCase().includes(q)) return false;
      for (const [col, val] of Object.entries(scopeFilter)) {
        if (val === "" || val == null) continue;
        if (String(row.scope?.[col]?.id) !== String(val)) return false;
      }
      return true;
    });
  }, [tableData, filter, showInactive, scopeFilter]);

  function beginEdit(row) {
    setEditingId(row.id);
    setEditDraft({
      name: row.name || "",
      sort_order: row.sort_order ?? "",
      secondary: { ...(row.secondary || {}) },
    });
  }
  function cancelEdit() { setEditingId(null); setEditDraft(null); }

  async function saveEdit(row) {
    if (!editDraft) return;
    const patch = {};
    if (editDraft.name.trim() !== (row.name || "")) patch.name = editDraft.name.trim();
    if (selectedEntry.sort_col) {
      const n = editDraft.sort_order === "" ? null : Number(editDraft.sort_order);
      if (n !== row.sort_order && n !== null && !Number.isNaN(n)) patch.sort_order = n;
    }
    const secPatch = {};
    for (const { col } of selectedEntry.secondary_cols) {
      const a = editDraft.secondary[col] ?? null;
      const b = row.secondary?.[col] ?? null;
      if (a !== b) secPatch[col] = a === "" ? null : a;
    }
    if (Object.keys(secPatch).length > 0) patch.secondary = secPatch;

    if (Object.keys(patch).length === 0) { cancelEdit(); return; }

    setRowBusy(row.id);
    try {
      await patchLookupRow(selectedTable, row.id, patch);
      await loadTable(selectedTable);
      cancelEdit();
      setToast({ kind: "ok", msg: "Saved." });
    } catch (e) {
      setToast({ kind: "error", msg: e.message || "Save failed." });
    } finally {
      setRowBusy(null);
    }
  }

  async function toggleActive(row) {
    setRowBusy(row.id);
    try {
      await patchLookupRow(selectedTable, row.id, { is_active: !row.is_active });
      await loadTable(selectedTable);
      setToast({ kind: "ok", msg: row.is_active ? "Deactivated." : "Re-activated." });
    } catch (e) {
      setToast({ kind: "error", msg: e.message || "Toggle failed." });
    } finally {
      setRowBusy(null);
    }
  }

  async function hardDelete(row) {
    if (!confirm(`Permanently delete "${row.name}"? This cannot be undone.`)) return;
    setRowBusy(row.id);
    try {
      await deleteLookupRow(selectedTable, row.id);
      await loadTable(selectedTable);
      setToast({ kind: "ok", msg: "Row hard-deleted." });
    } catch (e) {
      setToast({ kind: "error", msg: e.message || "Delete failed." });
    } finally {
      setRowBusy(null);
    }
  }

  function beginAdd() {
    if (!selectedEntry) return;
    setAddDraft({
      name: "",
      sort_order: selectedEntry.sort_col ? "0" : "",
      secondary: Object.fromEntries(selectedEntry.secondary_cols.map(c => [c.col, ""])),
      scope: Object.fromEntries(selectedEntry.scope.map(s => [s.col, ""])),
    });
  }
  function cancelAdd() { setAddDraft(null); }
  async function saveAdd() {
    if (!addDraft || !selectedEntry) return;
    const name = addDraft.name.trim();
    if (!name) { setToast({ kind: "error", msg: "Name is required." }); return; }
    const payload = { name };
    if (selectedEntry.sort_col && addDraft.sort_order !== "") {
      const n = Number(addDraft.sort_order);
      if (!Number.isNaN(n)) payload.sort_order = n;
    }
    const sec = {};
    for (const { col } of selectedEntry.secondary_cols) {
      const v = addDraft.secondary[col];
      if (v !== "" && v != null) sec[col] = v;
    }
    if (Object.keys(sec).length > 0) payload.secondary = sec;
    if (selectedEntry.scope.length > 0) {
      const scope = {};
      for (const s of selectedEntry.scope) {
        const v = addDraft.scope[s.col];
        if (!v) { setToast({ kind: "error", msg: `${s.label} is required.` }); return; }
        scope[s.col] = Number(v);
      }
      payload.scope = scope;
    }
    setAdding(true);
    try {
      await createLookupRow(selectedTable, payload);
      await loadTable(selectedTable);
      setAddDraft(null);
      setToast({ kind: "ok", msg: "Added." });
    } catch (e) {
      setToast({ kind: "error", msg: e.message || "Add failed." });
    } finally {
      setAdding(false);
    }
  }

  function startMerge(row) { setMergeState({ sourceId: row.id, targetId: "" }); }
  function cancelMerge() { setMergeState(null); }
  async function confirmMerge() {
    if (!mergeState?.sourceId || !mergeState?.targetId) return;
    const src = tableData.rows.find(r => r.id === mergeState.sourceId);
    const tgt = tableData.rows.find(r => r.id === Number(mergeState.targetId));
    if (!tgt) return;
    if (!confirm(
      `Merge "${src.name}" into "${tgt.name}"?\n\n` +
      `All references will be rewritten to "${tgt.name}" and "${src.name}" will be deactivated. ` +
      `Items linked to both will collapse into one link.`
    )) return;
    setMerging(true);
    try {
      const res = await mergeLookupRows(selectedTable, src.id, tgt.id);
      await loadTable(selectedTable);
      setMergeState(null);
      setToast({ kind: "ok", msg: `Merged. Rewrote ${res.rewritten}, deduped ${res.deduped}.` });
    } catch (e) {
      setToast({ kind: "error", msg: e.message || "Merge failed." });
    } finally {
      setMerging(false);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  if (registryError) {
    return <p style={{ color: "#9b1c1c" }}>{registryError}</p>;
  }
  if (!registry) {
    return <p style={{ color: "#444" }}>Loading…</p>;
  }

  return (
    <section>
      <h2 style={{ fontSize: "1rem", fontWeight: 600, margin: "0 0 10px" }}>Lookup Management</h2>
      <p style={{ color: "#555", fontSize: "0.9rem", margin: "0 0 12px" }}>
        View, rename, re-activate, merge, and hard-delete lookup values. Merging rewrites
        every reference from the source value to the target value, then deactivates the source.
        Hard-delete is only allowed on deactivated rows with zero remaining references.
      </p>

      {/* Table picker + global filters */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
        <label style={{ fontSize: "0.85rem", color: "#333" }}>
          Lookup:&nbsp;
          <select
            value={selectedTable}
            onChange={e => setSelectedTable(e.target.value)}
            style={{ padding: "3px 6px", fontSize: "0.85rem" }}
          >
            {registry.map(e => (
              <option key={e.table} value={e.table}>{e.label}</option>
            ))}
          </select>
        </label>
        <input
          type="text"
          placeholder="Filter by name…"
          value={filter}
          onChange={e => setFilter(e.target.value)}
          style={{ padding: "3px 6px", fontSize: "0.85rem", minWidth: 180 }}
        />
        <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: "0.85rem" }}>
          <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} />
          Show inactive
        </label>
      </div>

      {/* Per-scope dropdowns */}
      {tableData?.scope && tableData.scope.length > 0 && (
        <div style={{ display: "flex", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
          {tableData.scope.map((s, i) => {
            const opts = tableData.scope_options[i]?.options || [];
            return (
              <label key={s.col} style={{ fontSize: "0.85rem", color: "#333" }}>
                {s.label}:&nbsp;
                <select
                  value={scopeFilter[s.col] ?? ""}
                  onChange={e => setScopeFilter(prev => ({ ...prev, [s.col]: e.target.value }))}
                  style={{ padding: "3px 6px", fontSize: "0.85rem" }}
                >
                  <option value="">(all)</option>
                  {opts.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              </label>
            );
          })}
        </div>
      )}

      {/* Add new row */}
      {selectedEntry?.creatable && (
        <div style={{ marginBottom: 10 }}>
          {!addDraft ? (
            <button
              onClick={beginAdd}
              style={{ padding: "4px 10px", fontSize: "0.85rem", cursor: "pointer" }}
            >
              + Add new
            </button>
          ) : (
            <div style={{
              display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center",
              padding: 8, background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 3,
            }}>
              <input
                type="text"
                autoFocus
                placeholder={`New ${selectedEntry.label} name…`}
                value={addDraft.name}
                onChange={e => setAddDraft(d => ({ ...d, name: e.target.value }))}
                onKeyDown={e => { if (e.key === "Enter") saveAdd(); if (e.key === "Escape") cancelAdd(); }}
                style={{ padding: "3px 6px", fontSize: "0.85rem", minWidth: 200 }}
              />
              {selectedEntry.sort_col && (
                <label style={{ fontSize: "0.8rem", color: "#555" }}>
                  Sort:&nbsp;
                  <input
                    type="number"
                    value={addDraft.sort_order}
                    onChange={e => setAddDraft(d => ({ ...d, sort_order: e.target.value }))}
                    style={{ padding: "3px 6px", fontSize: "0.85rem", width: 70 }}
                  />
                </label>
              )}
              {selectedEntry.secondary_cols.map(sc => (
                <label key={sc.col} style={{ fontSize: "0.8rem", color: "#555" }}>
                  {sc.label}:&nbsp;
                  <input
                    type="text"
                    value={addDraft.secondary[sc.col] ?? ""}
                    onChange={e => setAddDraft(d => ({ ...d, secondary: { ...d.secondary, [sc.col]: e.target.value } }))}
                    style={{ padding: "3px 6px", fontSize: "0.85rem" }}
                  />
                </label>
              ))}
              {selectedEntry.scope.map((s, i) => {
                const opts = tableData?.scope_options?.[i]?.options || [];
                return (
                  <label key={s.col} style={{ fontSize: "0.8rem", color: "#555" }}>
                    {s.label}:&nbsp;
                    <select
                      value={addDraft.scope[s.col] ?? ""}
                      onChange={e => setAddDraft(d => ({ ...d, scope: { ...d.scope, [s.col]: e.target.value } }))}
                      style={{ padding: "3px 6px", fontSize: "0.85rem" }}
                    >
                      <option value="">(select)</option>
                      {opts.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                    </select>
                  </label>
                );
              })}
              <button onClick={saveAdd} disabled={adding} style={{ padding: "3px 10px", fontSize: "0.85rem" }}>
                {adding ? "Saving…" : "Save"}
              </button>
              <button onClick={cancelAdd} disabled={adding} style={{ padding: "3px 10px", fontSize: "0.85rem" }}>
                Cancel
              </button>
            </div>
          )}
        </div>
      )}

      {tableLoading && <p style={{ color: "#444" }}>Loading…</p>}
      {tableError && <p style={{ color: "#9b1c1c" }}>{tableError}</p>}

      {toast && (
        <div style={{
          padding: "4px 10px", marginBottom: 8, borderRadius: 3, fontSize: "0.85rem",
          background: toast.kind === "ok" ? "#dcfce7" : "#fee2e2",
          color: toast.kind === "ok" ? "#166534" : "#9b1c1c",
          display: "inline-block",
        }}>
          {toast.msg}
          <button onClick={() => setToast(null)} style={{ marginLeft: 8, border: "none", background: "none", cursor: "pointer" }}>×</button>
        </div>
      )}

      {tableData && !tableLoading && (
        <LookupRowTable
          entry={selectedEntry}
          tableData={tableData}
          rows={filteredRows}
          editingId={editingId}
          editDraft={editDraft}
          setEditDraft={setEditDraft}
          rowBusy={rowBusy}
          onBeginEdit={beginEdit}
          onCancelEdit={cancelEdit}
          onSaveEdit={saveEdit}
          onToggleActive={toggleActive}
          onHardDelete={hardDelete}
          onStartMerge={startMerge}
        />
      )}

      {/* Merge modal */}
      {mergeState && tableData && (
        <MergeModal
          sourceRow={tableData.rows.find(r => r.id === mergeState.sourceId)}
          candidates={tableData.rows.filter(r =>
            r.id !== mergeState.sourceId
            && r.is_active
            && scopesMatch(tableData.rows.find(rr => rr.id === mergeState.sourceId), r)
          )}
          targetId={mergeState.targetId}
          setTargetId={id => setMergeState(s => ({ ...s, targetId: id }))}
          merging={merging}
          onConfirm={confirmMerge}
          onCancel={cancelMerge}
        />
      )}
    </section>
  );
}

function scopesMatch(a, b) {
  if (!a || !b) return false;
  const aKeys = Object.keys(a.scope || {});
  for (const k of aKeys) {
    if (String(a.scope?.[k]?.id ?? "") !== String(b.scope?.[k]?.id ?? "")) return false;
  }
  return true;
}

function LookupRowTable({
  entry, tableData, rows, editingId, editDraft, setEditDraft,
  rowBusy, onBeginEdit, onCancelEdit, onSaveEdit, onToggleActive, onHardDelete, onStartMerge,
}) {
  const th = { padding: "4px 8px", fontSize: "0.8rem", fontWeight: 600, color: "#444", textAlign: "left", borderBottom: "1px solid #e5e7eb", whiteSpace: "nowrap" };
  const td = { padding: "4px 8px", fontSize: "0.85rem", borderBottom: "1px solid #f3f4f6", verticalAlign: "middle" };
  const hasScope = entry.scope.length > 0;
  const hasSort = !!entry.sort_col;
  const secondary = entry.secondary_cols;

  if (rows.length === 0) {
    return <p style={{ color: "#666", fontSize: "0.9rem" }}>No rows match.</p>;
  }

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ borderCollapse: "collapse", fontSize: "0.85rem", background: "#fff", width: "100%" }}>
        <thead>
          <tr>
            <th style={th}>Name</th>
            {secondary.map(c => <th key={c.col} style={th}>{c.label}</th>)}
            {hasScope && entry.scope.map(s => <th key={s.col} style={th}>{s.label}</th>)}
            {hasSort && <th style={th}>Sort</th>}
            <th style={{ ...th, textAlign: "center" }}>Usage</th>
            <th style={{ ...th, textAlign: "center" }}>Active</th>
            <th style={{ ...th, textAlign: "right" }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => {
            const editing = editingId === row.id;
            const busy = rowBusy === row.id;
            return (
              <tr key={row.id} style={{ opacity: row.is_active ? 1 : 0.55 }}>
                <td style={td}>
                  {editing ? (
                    <input
                      type="text"
                      value={editDraft.name}
                      onChange={e => setEditDraft(d => ({ ...d, name: e.target.value }))}
                      style={{ padding: "2px 6px", fontSize: "0.85rem", width: "100%", minWidth: 160 }}
                    />
                  ) : row.name}
                </td>
                {secondary.map(c => (
                  <td key={c.col} style={td}>
                    {editing ? (
                      <input
                        type="text"
                        value={editDraft.secondary[c.col] ?? ""}
                        onChange={e => setEditDraft(d => ({
                          ...d, secondary: { ...d.secondary, [c.col]: e.target.value }
                        }))}
                        style={{ padding: "2px 6px", fontSize: "0.85rem", minWidth: 100 }}
                      />
                    ) : (row.secondary?.[c.col] ?? "")}
                  </td>
                ))}
                {hasScope && entry.scope.map(s => (
                  <td key={s.col} style={{ ...td, color: "#666" }}>
                    {row.scope?.[s.col]?.name ?? ""}
                  </td>
                ))}
                {hasSort && (
                  <td style={{ ...td, width: 60 }}>
                    {editing ? (
                      <input
                        type="number"
                        value={editDraft.sort_order}
                        onChange={e => setEditDraft(d => ({ ...d, sort_order: e.target.value }))}
                        style={{ padding: "2px 6px", fontSize: "0.85rem", width: 50 }}
                      />
                    ) : (row.sort_order ?? "")}
                  </td>
                )}
                <td style={{ ...td, textAlign: "center", color: row.usage_count > 0 ? "#111" : "#999" }}>
                  {row.usage_count}
                </td>
                <td style={{ ...td, textAlign: "center" }}>
                  <input
                    type="checkbox"
                    checked={row.is_active}
                    disabled={busy}
                    onChange={() => onToggleActive(row)}
                    title={row.is_active ? "Click to deactivate" : "Click to re-activate"}
                  />
                </td>
                <td style={{ ...td, textAlign: "right", whiteSpace: "nowrap" }}>
                  {editing ? (
                    <>
                      <button onClick={() => onSaveEdit(row)} disabled={busy} style={btnStyle}>Save</button>
                      <button onClick={onCancelEdit} disabled={busy} style={btnStyle}>Cancel</button>
                    </>
                  ) : (
                    <>
                      <button onClick={() => onBeginEdit(row)} disabled={busy} style={btnStyle}>Edit</button>
                      {entry.mergeable && row.is_active && (
                        <button onClick={() => onStartMerge(row)} disabled={busy} style={btnStyle}>Merge…</button>
                      )}
                      {!row.is_active && row.usage_count === 0 && (
                        <button
                          onClick={() => onHardDelete(row)}
                          disabled={busy}
                          style={{ ...btnStyle, color: "#9b1c1c" }}
                        >Delete</button>
                      )}
                    </>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p style={{ color: "#666", fontSize: "0.8rem", marginTop: 6 }}>
        Showing {rows.length} of {tableData.rows.length} rows.
        {!entry.mergeable && " (Merging disabled for this lookup — changes would cascade into other tables.)"}
      </p>
    </div>
  );
}

const btnStyle = {
  padding: "2px 8px",
  fontSize: "0.8rem",
  marginLeft: 4,
  cursor: "pointer",
  border: "1px solid #d1d5db",
  background: "#fff",
  borderRadius: 3,
};

function MergeModal({ sourceRow, candidates, targetId, setTargetId, merging, onConfirm, onCancel }) {
  const overlay = {
    position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", zIndex: 50,
    display: "flex", alignItems: "center", justifyContent: "center",
  };
  const modal = {
    background: "#fff", padding: 20, borderRadius: 6, minWidth: 380, maxWidth: 520,
    boxShadow: "0 10px 30px rgba(0,0,0,0.25)",
  };
  return (
    <div style={overlay} onClick={onCancel}>
      <div style={modal} onClick={e => e.stopPropagation()}>
        <h3 style={{ fontSize: "0.95rem", fontWeight: 600, margin: "0 0 10px" }}>
          Merge "{sourceRow?.name}"
        </h3>
        <p style={{ fontSize: "0.85rem", color: "#444", margin: "0 0 10px" }}>
          Choose the target. All references to "{sourceRow?.name}" will be rewritten to the target,
          and "{sourceRow?.name}" will be deactivated. Items linked to both will collapse into one link.
        </p>
        {candidates.length === 0 ? (
          <p style={{ color: "#9b1c1c", fontSize: "0.85rem" }}>
            No eligible target (must share the same scope and be active).
          </p>
        ) : (
          <select
            value={targetId}
            onChange={e => setTargetId(e.target.value)}
            style={{ width: "100%", padding: "4px 6px", fontSize: "0.9rem", marginBottom: 12 }}
          >
            <option value="">Select target…</option>
            {candidates.map(c => (
              <option key={c.id} value={c.id}>
                {c.name} {c.usage_count ? `(${c.usage_count} refs)` : ""}
              </option>
            ))}
          </select>
        )}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button onClick={onCancel} disabled={merging} style={btnStyle}>Cancel</button>
          <button
            onClick={onConfirm}
            disabled={merging || !targetId}
            style={{ ...btnStyle, background: "#b91c1c", color: "#fff", borderColor: "#b91c1c" }}
          >
            {merging ? "Merging…" : "Merge"}
          </button>
        </div>
      </div>
    </div>
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
