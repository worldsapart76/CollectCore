// Phase 7d: guest-specific items rendered inside TopNav's hamburger drawer.
//
// Lives in its own file so admin builds can tree-shake the entire chunk
// (it imports sqliteService → worker → wasm). TopNav renders this only
// when !VITE_IS_ADMIN; the lazy() import in TopNav is gated by the same
// constant-folded env literal used elsewhere in the guest stack.
//
// What it surfaces:
//   - Help → re-show the Welcome modal (guest_meta.welcome_dismissed is
//     not cleared — Help is a one-shot view, not a reset).
//   - Refresh catalog → manual trigger of syncCatalog(); silent auto-sync
//     also runs on every page load via GuestBootstrap.
//   - Backup → download guest_* tables as JSON (file save dialog).
//   - Restore → file picker → import JSON snapshot (replace strategy).
//   - Storage line → mode (persisted/memory) + last sync + last backup.

import { useEffect, useState } from "react";
import {
  syncCatalog,
  getLastSyncedVersion,
  exportGuestBackup,
  restoreGuestBackup,
  getLastBackupAt,
  getStorageMode,
} from "./sqliteService";
import WelcomeModal from "./WelcomeModal";

export default function GuestMenuItems({ itemClassName }) {
  const [helpOpen, setHelpOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [lastSync, setLastSync] = useState(null);
  const [lastBackup, setLastBackup] = useState(null);
  const [storageMode, setStorageMode] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [v, b] = await Promise.all([getLastSyncedVersion(), getLastBackupAt()]);
        if (cancelled) return;
        setLastSync(v);
        setLastBackup(b);
        setStorageMode(getStorageMode());
      } catch {
        // Non-fatal — just leave status fields null.
      }
    })();
    return () => { cancelled = true; };
  }, [busy]); // refresh after any action completes

  async function handleRefresh() {
    setBusy(true);
    setStatus("Checking for updates…");
    try {
      const r = await syncCatalog();
      const applied = r.itemsApplied || 0;
      setStatus(applied > 0 ? `Updated ${applied} card${applied === 1 ? "" : "s"}.` : "Up to date.");
    } catch (err) {
      setStatus(`Refresh failed: ${err?.message || String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleBackup() {
    setBusy(true);
    setStatus("Building backup…");
    try {
      const snapshot = await exportGuestBackup();
      const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `collectcore-guest-backup-${snapshot.exported_at.replace(/[:.]/g, "-")}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setStatus("Backup downloaded.");
    } catch (err) {
      setStatus(`Backup failed: ${err?.message || String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  function handleRestore(file) {
    if (!file) return;
    if (!window.confirm(
      "Restoring will REPLACE all your current annotations with the backup's contents. " +
      "Catalog data is unaffected. Continue?",
    )) return;
    setBusy(true);
    setStatus("Restoring…");
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const snapshot = JSON.parse(reader.result);
        const r = await restoreGuestBackup(snapshot);
        const totals = Object.values(r.counts || {}).reduce((a, b) => a + b, 0);
        setStatus(`Restored ${totals} row${totals === 1 ? "" : "s"} across ${r.tablesRestored} table(s).`);
      } catch (err) {
        setStatus(`Restore failed: ${err?.message || String(err)}`);
      } finally {
        setBusy(false);
      }
    };
    reader.onerror = () => {
      setStatus("Restore failed: couldn't read the file.");
      setBusy(false);
    };
    reader.readAsText(file);
  }

  return (
    <>
      <button
        type="button"
        className={itemClassName}
        onClick={() => setHelpOpen(true)}
      >
        Help
      </button>

      <button
        type="button"
        className={itemClassName}
        onClick={handleRefresh}
        disabled={busy}
      >
        Refresh catalog
      </button>

      <button
        type="button"
        className={itemClassName}
        onClick={handleBackup}
        disabled={busy}
      >
        Backup
      </button>

      <label
        className={itemClassName}
        style={{ cursor: busy ? "not-allowed" : "pointer", opacity: busy ? 0.6 : 1 }}
      >
        Restore from file…
        <input
          type="file"
          accept="application/json,.json"
          onChange={(e) => handleRestore(e.target.files?.[0])}
          disabled={busy}
          style={{ display: "none" }}
        />
      </label>

      {/* Status line — collapses to nothing when there's no message + no
          ambient state worth showing. Keeps the drawer compact otherwise. */}
      {(status || lastSync != null || lastBackup || storageMode === "memory") && (
        <div
          style={{
            padding: "8px 14px",
            fontSize: 12,
            color: "var(--text-muted)",
            borderTop: "1px solid var(--border)",
            lineHeight: 1.5,
          }}
        >
          {status && <div style={{ marginBottom: 4 }}>{status}</div>}
          {storageMode === "memory" && (
            <div style={{ color: "var(--warning-text, #856404)" }}>
              ⚠ In-memory mode — back up before reload
            </div>
          )}
          {lastSync != null && lastSync > 0 && (
            <div>Last update: catalog v{lastSync}</div>
          )}
          {lastBackup && (
            <div>Last backup: {formatRelative(lastBackup)}</div>
          )}
        </div>
      )}

      <WelcomeModal isOpen={helpOpen} onClose={() => setHelpOpen(false)} ctaLabel="Got it" />
    </>
  );
}

// Quick relative-time formatter; avoids pulling in a date library for one
// bit of UI text. Falls back to ISO date if older than 30 days.
function formatRelative(iso) {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return iso;
  const diffMs = Date.now() - t;
  const day = 86400000;
  if (diffMs < 60_000) return "just now";
  if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)} min ago`;
  if (diffMs < day) return `${Math.floor(diffMs / 3_600_000)} hr ago`;
  if (diffMs < day * 30) return `${Math.floor(diffMs / day)} days ago`;
  return new Date(iso).toISOString().slice(0, 10);
}
