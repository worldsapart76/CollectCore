// Guest-side replacement for AdminPage. Same backup/restore behavior as
// the hamburger-drawer GuestMenuItems entry — both call exportGuestBackup /
// restoreGuestBackup from sqliteService — just rendered in page layout for
// guests who land on /admin (e.g. via the legacy admin-link bookmark or by
// typing the URL).
//
// Lazy-loaded by AdminPage.jsx behind a constant-folded VITE_IS_ADMIN guard
// so the admin bundle never pulls this (or sqliteService) into its chunk
// graph.

import { useEffect, useRef, useState } from "react";
import PageContainer from "../components/layout/PageContainer";
import {
  exportGuestBackup,
  getLastBackupAt,
  restoreGuestBackup,
} from "./sqliteService";

export default function GuestAdminPage() {
  const [busy, setBusy] = useState(false);
  const [backupStatus, setBackupStatus] = useState(null);
  const [backupError, setBackupError] = useState(null);
  const [restoreStatus, setRestoreStatus] = useState(null);
  const [restoreError, setRestoreError] = useState(null);
  const [lastBackup, setLastBackup] = useState(null);
  const restoreInputRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const b = await getLastBackupAt();
        if (!cancelled) setLastBackup(b);
      } catch {
        // non-fatal
      }
    })();
    return () => { cancelled = true; };
  }, [busy]);

  async function handleBackup() {
    setBusy(true);
    setBackupStatus("working");
    setBackupError(null);
    try {
      const snapshot = await exportGuestBackup();
      const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" });
      const filename = `collectcore-guest-backup-${snapshot.exported_at.replace(/[:.]/g, "-")}.json`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setBackupStatus("done");
    } catch (err) {
      setBackupError(err?.message || String(err));
      setBackupStatus("error");
    } finally {
      setBusy(false);
    }
  }

  function handleRestoreSelect(e) {
    const file = e.target.files?.[0];
    if (restoreInputRef.current) restoreInputRef.current.value = "";
    if (!file) return;
    if (!window.confirm(
      "Restoring will REPLACE all your current annotations with the backup's contents. " +
      "Catalog data is unaffected. Continue?",
    )) return;
    setBusy(true);
    setRestoreStatus("working");
    setRestoreError(null);
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const snapshot = JSON.parse(reader.result);
        const r = await restoreGuestBackup(snapshot);
        const totals = Object.values(r.counts || {}).reduce((a, b) => a + b, 0);
        setRestoreStatus(`Restored ${totals} row${totals === 1 ? "" : "s"} across ${r.tablesRestored} table(s).`);
      } catch (err) {
        setRestoreError(err?.message || String(err));
        setRestoreStatus("error");
      } finally {
        setBusy(false);
      }
    };
    reader.onerror = () => {
      setRestoreError("Couldn't read the file.");
      setRestoreStatus("error");
      setBusy(false);
    };
    reader.readAsText(file);
  }

  return (
    <PageContainer title="Backup &amp; Restore">
      <p style={{ color: "#555", fontSize: "0.9rem", margin: "0 0 16px" }}>
        Backup saves your card annotations (Owned, Wanted, etc. and notes) as a
        JSON file you can keep on your computer or in cloud storage. Restoring
        replaces your current annotations with the file's contents — the
        shared catalog is never affected.
      </p>

      {/* Backup */}
      <div style={{ marginBottom: 18 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <button
            onClick={handleBackup}
            disabled={busy}
            style={{ padding: "5px 14px", cursor: busy ? "default" : "pointer" }}
          >
            {backupStatus === "working" ? "Building backup…" : "Download Backup"}
          </button>
          {backupStatus === "done" && (
            <span style={{ color: "#166534", fontSize: "0.9rem" }}>Backup downloaded.</span>
          )}
          {backupStatus === "error" && (
            <span style={{ color: "#9b1c1c", fontSize: "0.9rem" }}>{backupError}</span>
          )}
        </div>
        {lastBackup && (
          <div style={{ fontSize: "0.8rem", color: "#666", marginTop: 6 }}>
            Last backup: {formatRelative(lastBackup)}
          </div>
        )}
      </div>

      {/* Restore */}
      <div>
        <input
          ref={restoreInputRef}
          type="file"
          accept="application/json,.json"
          style={{ display: "none" }}
          onChange={handleRestoreSelect}
        />
        <button
          onClick={() => restoreInputRef.current?.click()}
          disabled={busy}
          style={{ padding: "5px 14px", cursor: busy ? "default" : "pointer" }}
        >
          {restoreStatus === "working" ? "Restoring…" : "Restore from Backup…"}
        </button>
        {restoreStatus && restoreStatus !== "working" && restoreStatus !== "error" && (
          <span style={{ color: "#166534", fontSize: "0.9rem", marginLeft: 10 }}>{restoreStatus}</span>
        )}
        {restoreStatus === "error" && (
          <span style={{ color: "#9b1c1c", fontSize: "0.9rem", marginLeft: 10 }}>{restoreError}</span>
        )}
      </div>
    </PageContainer>
  );
}

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
