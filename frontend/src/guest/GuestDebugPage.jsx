// Phase 1 proof-of-life debug page for the guest webview.
//
// Manually exercises the SQLite service: download /catalog/seed.db,
// deserialize into an in-memory DB, run sample queries, display row counts.
// Persistence (OPFS) is NOT yet wired here — that's Phase 1b.
//
// This page is gated behind import.meta.env.DEV in routing so it never ships
// in a production admin or guest bundle. We can promote pieces of it into the
// real guest app once the unknowns are resolved.

import { useState } from "react";
import { initSqlite, loadSeedFromUrl, query, isLoaded } from "./sqliteService";

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

  async function handleInitOnly() {
    setStatus("initializing");
    setError("");
    try {
      await initSqlite();
      setStatus("sqlite ready (no DB loaded)");
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
      setStatus("seed loaded (in-memory)");
    } catch (err) {
      console.error(err);
      setError(err.message || String(err));
      setStatus("error");
    }
  }

  function handleCount() {
    setError("");
    try {
      const rows = query(COUNT_PHOTOCARDS);
      setCount(rows[0]?.n ?? 0);
    } catch (err) {
      console.error(err);
      setError(err.message || String(err));
    }
  }

  function handleSample() {
    setError("");
    try {
      const rows = query(SAMPLE_PHOTOCARDS);
      setSample(rows);
    } catch (err) {
      console.error(err);
      setError(err.message || String(err));
    }
  }

  return (
    <div style={{ padding: 24, maxWidth: 700, margin: "0 auto", fontSize: 14 }}>
      <h2 style={{ marginTop: 0 }}>Guest webview — Phase 1 debug</h2>
      <p style={{ color: "var(--text-muted)" }}>
        Proof-of-life for sqlite-wasm. Status: <strong>{status}</strong>
      </p>

      {error && (
        <div style={{ padding: "8px 12px", background: "var(--error-bg)", border: "1px solid var(--danger-text)", color: "var(--danger-text)", borderRadius: 4, marginBottom: 12 }}>
          <strong>Error:</strong> {error}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <section>
          <h3 style={{ marginBottom: 4 }}>1. Init sqlite-wasm</h3>
          <p style={{ color: "var(--text-muted)", fontSize: 12, margin: "0 0 8px" }}>
            Loads the WASM module. Verifies the package + Vite config work.
          </p>
          <button onClick={handleInitOnly}>Init only</button>
        </section>

        <section>
          <h3 style={{ marginBottom: 4 }}>2. Load seed.db</h3>
          <p style={{ color: "var(--text-muted)", fontSize: 12, margin: "0 0 8px" }}>
            GET /catalog/seed.db, deserialize into in-memory DB.
            {seedSize !== null && (
              <span> Loaded <strong>{(seedSize / 1024 / 1024).toFixed(2)} MB</strong>.</span>
            )}
          </p>
          <button onClick={handleLoadSeed}>Load seed</button>
        </section>

        <section>
          <h3 style={{ marginBottom: 4 }}>3. Count photocards</h3>
          <p style={{ color: "var(--text-muted)", fontSize: 12, margin: "0 0 8px" }}>
            SELECT COUNT(*) FROM tbl_items WHERE catalog_item_id IS NOT NULL.
          </p>
          <button onClick={handleCount} disabled={!isLoaded()}>Run COUNT</button>
          {count !== null && (
            <div style={{ marginTop: 8 }}>Photocard count: <strong>{count}</strong></div>
          )}
        </section>

        <section>
          <h3 style={{ marginBottom: 4 }}>4. Sample 5 newest photocards</h3>
          <button onClick={handleSample} disabled={!isLoaded()}>Run sample</button>
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
      </div>
    </div>
  );
}
