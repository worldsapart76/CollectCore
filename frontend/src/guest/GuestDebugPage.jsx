// Phase 1b proof-of-life debug page for the guest webview.
//
// Exercises the worker-backed SQLite service:
//   1. Init → installs SAHPool VFS in worker, reopens catalog.db if persisted.
//   2. Load seed → fetch /catalog/seed.db, importDb() into SAHPool (overwrite).
//   3. Reload from OPFS → call init again on a fresh page; verify the catalog
//      is still there without re-fetching.
//   4. Run COUNT / sample queries.
//   5. Clear OPFS → wipe catalog.db, prove init no longer finds it.
//
// This page is gated behind import.meta.env.DEV in routing so it never ships
// in a production admin or guest bundle.

import { useEffect, useState } from "react";
import {
  initSqlite,
  loadSeedFromUrl,
  query,
  clearCatalog,
  nukeOpfsAndReset,
  getGuestMeta,
  setGuestMeta,
} from "./sqliteService";

const GUEST_SURVIVAL_KEY = "phase2_survival_test";

const COUNT_PHOTOCARDS = `
  SELECT COUNT(*) AS n
  FROM tbl_items
  WHERE collection_type_id = 1
    AND catalog_item_id IS NOT NULL
`;

const SAMPLE_PHOTOCARDS = `
  SELECT i.item_id,
         i.catalog_item_id,
         i.catalog_version,
         g.group_name,
         tlc.category_name
  FROM tbl_items i
  LEFT JOIN tbl_photocard_details d ON d.item_id = i.item_id
  LEFT JOIN lkup_photocard_groups g ON g.group_id = d.group_id
  LEFT JOIN lkup_top_level_categories tlc ON tlc.top_level_category_id = i.top_level_category_id
  WHERE i.collection_type_id = 1
    AND i.catalog_item_id IS NOT NULL
  ORDER BY i.item_id DESC
  LIMIT 5
`;

export default function GuestDebugPage() {
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");
  const [seedSize, setSeedSize] = useState(null);
  const [count, setCount] = useState(null);
  const [sample, setSample] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [initInfo, setInitInfo] = useState(null);
  const [survivalValue, setSurvivalValue] = useState(null);
  const [survivalStatus, setSurvivalStatus] = useState("");

  // Auto-init on mount so we can immediately tell the user whether OPFS already
  // has a catalog from a prior session.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await initSqlite();
        if (cancelled) return;
        setInitInfo(r);
        setLoaded(!!r.hasCatalog);
        setStatus(r.hasCatalog ? "ready (catalog persisted from OPFS)" : "ready (no catalog yet)");
      } catch (err) {
        if (cancelled) return;
        console.error(err);
        setError(err.message || String(err));
        setStatus("init failed");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  async function handleReinit() {
    setStatus("re-initializing");
    setError("");
    setCount(null);
    setSample([]);
    try {
      // The service caches initSqlite(); to truly verify OPFS persistence
      // across a reload, hit reload in the browser. This button just confirms
      // the cached init still reports the persisted DB.
      const r = await initSqlite();
      setInitInfo(r);
      setLoaded(!!r.hasCatalog);
      setStatus(r.hasCatalog ? "init says: catalog present" : "init says: no catalog");
    } catch (err) {
      console.error(err);
      setError(err.message || String(err));
      setStatus("error");
    }
  }

  async function handleLoadSeed() {
    setStatus("loading seed");
    setError("");
    setCount(null);
    setSample([]);
    try {
      const { sizeBytes } = await loadSeedFromUrl();
      setSeedSize(sizeBytes);
      setLoaded(true);
      setStatus("seed imported into SAHPool (persisted)");
    } catch (err) {
      console.error(err);
      setError(err.message || String(err));
      setStatus("error");
    }
  }

  async function handleCount() {
    setError("");
    try {
      const rows = await query(COUNT_PHOTOCARDS);
      setCount(rows[0]?.n ?? 0);
    } catch (err) {
      console.error(err);
      setError(err.message || String(err));
    }
  }

  async function handleSample() {
    setError("");
    try {
      const rows = await query(SAMPLE_PHOTOCARDS);
      setSample(rows);
    } catch (err) {
      console.error(err);
      setError(err.message || String(err));
    }
  }

  async function handleNuke() {
    setError("");
    setStatus("nuking OPFS pool");
    try {
      const r = await nukeOpfsAndReset();
      setLoaded(false);
      setInitInfo(null);
      setSeedSize(null);
      setCount(null);
      setSample([]);
      if (r.removed) {
        setStatus(`OPFS pool dir removed (${r.dir}); click Re-check init to rebuild`);
      } else {
        setStatus(`OPFS removeEntry failed: ${r.error || "unknown"} — try DevTools > Application > Storage > Clear site data`);
      }
    } catch (err) {
      console.error(err);
      setError(err.message || String(err));
      setStatus("error");
    }
  }

  async function handleWriteSurvival() {
    setSurvivalStatus("");
    try {
      const stamp = new Date().toISOString();
      await setGuestMeta(GUEST_SURVIVAL_KEY, stamp);
      setSurvivalValue(stamp);
      setSurvivalStatus(`wrote ${stamp} — now reload the seed and re-read to prove the value survives a catalog refresh`);
    } catch (err) {
      console.error(err);
      setSurvivalStatus(`error: ${err.message || String(err)}`);
    }
  }

  async function handleReadSurvival() {
    setSurvivalStatus("");
    try {
      const v = await getGuestMeta(GUEST_SURVIVAL_KEY);
      setSurvivalValue(v);
      setSurvivalStatus(v ? "read OK" : "no value stored");
    } catch (err) {
      console.error(err);
      setSurvivalStatus(`error: ${err.message || String(err)}`);
    }
  }

  async function handleClear() {
    setError("");
    setStatus("clearing OPFS");
    try {
      const removed = await clearCatalog();
      setLoaded(false);
      setCount(null);
      setSample([]);
      setSeedSize(null);
      setStatus(removed ? "OPFS catalog cleared" : "no catalog to clear");
    } catch (err) {
      console.error(err);
      setError(err.message || String(err));
      setStatus("error");
    }
  }

  return (
    <div style={{ padding: 24, maxWidth: 720, margin: "0 auto", fontSize: 14 }}>
      <h2 style={{ marginTop: 0 }}>Guest webview — Phase 1b debug</h2>
      <p style={{ color: "var(--text-muted)" }}>
        SAHPool-backed SQLite in a worker. Status: <strong>{status}</strong>
        {initInfo && (
          <span style={{ marginLeft: 12, fontSize: 12 }}>
            mode=<strong>{initInfo.storageMode || "?"}</strong>, hasCatalog=
            <strong>{String(initInfo.hasCatalog)}</strong>, persist=
            <strong>{
              initInfo.persistGranted === true
                ? "granted"
                : initInfo.persistGranted === false
                ? "denied"
                : "n/a"
            }</strong>
          </span>
        )}
      </p>
      {initInfo?.storageMode === "memory" && (
        <div style={{
          padding: "8px 12px",
          background: "var(--warning-bg, #fff3cd)",
          border: "1px solid var(--warning-text, #856404)",
          color: "var(--warning-text, #856404)",
          borderRadius: 4,
          marginBottom: 12,
          fontSize: 13,
        }}>
          <strong>In-memory mode.</strong> Persistent storage (SAHPool) is
          unavailable — this usually means the page is open in another tab
          on the same origin, or a previous tab leaked OPFS handles. Data
          loaded here will not survive a reload. Close other tabs and click
          "Re-check init" to retry persistent mode.
          {initInfo.fallbackReason && (
            <div style={{ marginTop: 4, fontFamily: "monospace", fontSize: 11, opacity: 0.85 }}>
              {initInfo.fallbackReason}
            </div>
          )}
        </div>
      )}
      <p style={{ color: "var(--text-muted)", fontSize: 12, marginTop: -4 }}>
        Tip: after loading the seed in persisted mode, hit the browser
        reload button — the catalog should reopen from OPFS without a
        network fetch.
      </p>

      {error && (
        <div style={{ padding: "8px 12px", background: "var(--error-bg)", border: "1px solid var(--danger-text)", color: "var(--danger-text)", borderRadius: 4, marginBottom: 12 }}>
          <strong>Error:</strong> {error}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <section>
          <h3 style={{ marginBottom: 4 }}>1. Init / re-init</h3>
          <p style={{ color: "var(--text-muted)", fontSize: 12, margin: "0 0 8px" }}>
            Auto-runs on mount. Reports whether SAHPool already has a
            catalog.db from a previous session.
          </p>
          <button onClick={handleReinit}>Re-check init</button>
        </section>

        <section>
          <h3 style={{ marginBottom: 4 }}>2. Load seed.db (imports into SAHPool)</h3>
          <p style={{ color: "var(--text-muted)", fontSize: 12, margin: "0 0 8px" }}>
            GET /catalog/seed.db, importDb() into the pool. Overwrites any
            existing catalog.
            {seedSize !== null && (
              <span> Imported <strong>{(seedSize / 1024 / 1024).toFixed(2)} MB</strong>.</span>
            )}
          </p>
          <button onClick={handleLoadSeed}>Load seed</button>
        </section>

        <section>
          <h3 style={{ marginBottom: 4 }}>3. Count photocards</h3>
          <button onClick={handleCount} disabled={!loaded}>Run COUNT</button>
          {count !== null && (
            <div style={{ marginTop: 8 }}>Photocard count: <strong>{count}</strong></div>
          )}
        </section>

        <section>
          <h3 style={{ marginBottom: 4 }}>4. Sample 5 newest photocards</h3>
          <button onClick={handleSample} disabled={!loaded}>Run sample</button>
          {sample.length > 0 && (
            <table style={{ marginTop: 8, fontSize: 12, borderCollapse: "collapse", width: "100%" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border)" }}>
                  <th style={{ textAlign: "left", padding: 4 }}>item_id</th>
                  <th style={{ textAlign: "left", padding: 4 }}>catalog_item_id</th>
                  <th style={{ textAlign: "left", padding: 4 }}>cat ver</th>
                  <th style={{ textAlign: "left", padding: 4 }}>group</th>
                  <th style={{ textAlign: "left", padding: 4 }}>category</th>
                </tr>
              </thead>
              <tbody>
                {sample.map((r) => (
                  <tr key={r.item_id} style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={{ padding: 4 }}>{r.item_id}</td>
                    <td style={{ padding: 4 }}>{r.catalog_item_id}</td>
                    <td style={{ padding: 4 }}>{r.catalog_version}</td>
                    <td style={{ padding: 4 }}>{r.group_name || "—"}</td>
                    <td style={{ padding: 4 }}>{r.category_name || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section>
          <h3 style={{ marginBottom: 4 }}>5. Phase 2 — guest_meta survival test</h3>
          <p style={{ color: "var(--text-muted)", fontSize: 12, margin: "0 0 8px" }}>
            Writes a timestamp to the <code>guest_meta</code> table (a guest-owned
            table). The contract: catalog refreshes (Load seed / future delta sync)
            must leave this row untouched. To verify: Write → Load seed (step 2) →
            Read. The same timestamp should come back.
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={handleWriteSurvival} disabled={!loaded}>Write timestamp</button>
            <button onClick={handleReadSurvival} disabled={!loaded}>Read</button>
          </div>
          {(survivalValue || survivalStatus) && (
            <div style={{ marginTop: 8, fontSize: 12 }}>
              {survivalValue && (
                <div>value: <code>{survivalValue}</code></div>
              )}
              {survivalStatus && (
                <div style={{ color: "var(--text-muted)" }}>{survivalStatus}</div>
              )}
            </div>
          )}
        </section>

        <section>
          <h3 style={{ marginBottom: 4 }}>6. Clear OPFS catalog</h3>
          <p style={{ color: "var(--text-muted)", fontSize: 12, margin: "0 0 8px" }}>
            Removes catalog.db from the SAHPool. Reload after this to confirm
            init reports no catalog.
          </p>
          <button onClick={handleClear}>Clear OPFS</button>
        </section>

        <section>
          <h3 style={{ marginBottom: 4 }}>7. Nuke SAHPool directory (recovery)</h3>
          <p style={{ color: "var(--text-muted)", fontSize: 12, margin: "0 0 8px" }}>
            If init keeps failing with "Access Handles cannot be created…",
            the SAHPool slot files are holding leaked handles. This deletes
            the entire <code>{".guest-pool"}</code> directory via the raw
            OPFS API and respawns the worker. After this, click "Re-check
            init" to retry.
          </p>
          <button onClick={handleNuke}>Nuke OPFS pool</button>
        </section>
      </div>
    </div>
  );
}
