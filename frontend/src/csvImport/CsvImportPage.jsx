/**
 * ONE-TIME CSV IMPORT TOOL — DELETABLE.
 *
 * Page UI for the bulk Movies / TV / Video Games / Music import. Mounted at
 * /admin/csv-import. Visible from AdminPage when the backend reports the
 * importer is mounted (CSV_IMPORT_ENABLED=1).
 *
 * To remove: run `python tools/remove_csv_importer.py` and follow prompts.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import PageContainer from "../components/layout/PageContainer";

const API = import.meta.env.VITE_API_BASE_URL ?? "";
const fetchJson = async (url, opts = {}) => {
  const res = await fetch(url, { credentials: "include", ...opts });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `HTTP ${res.status}`);
  }
  return res.json();
};

const MODULES = [
  { id: "video",      label: "Video (Movies + TV + Other)" },
  { id: "videogames", label: "Video Games" },
  { id: "music",      label: "Music" },
];

export default function CsvImportPage() {
  const [status, setStatus] = useState(null);   // /csv-import/status
  const [progress, setProgress] = useState(null);
  const [activeModule, setActiveModule] = useState("video");
  const [chunk, setChunk] = useState([]);       // queue items in current view
  const [chunkLoading, setChunkLoading] = useState(false);
  const [error, setError] = useState(null);
  const [includeDeferred, setIncludeDeferred] = useState(false);
  const [chunkSize, setChunkSize] = useState(10);

  // Initial load
  useEffect(() => {
    refreshStatus();
    refreshProgress();
  }, []);

  async function refreshStatus() {
    try {
      const s = await fetchJson(`${API}/csv-import/status`);
      setStatus(s);
    } catch (e) {
      setError(`Importer not mounted. Set CSV_IMPORT_ENABLED=1 in backend/.env and restart. (${e.message})`);
    }
  }

  async function refreshProgress() {
    try {
      const p = await fetchJson(`${API}/csv-import/progress`);
      setProgress(p);
    } catch {}
  }

  async function loadChunk() {
    setChunkLoading(true);
    setError(null);
    try {
      const data = await fetchJson(
        `${API}/csv-import/chunk?module=${activeModule}&size=${chunkSize}&include_deferred=${includeDeferred}`
      );
      setChunk(data.items || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setChunkLoading(false);
    }
  }

  async function seedTest() {
    setError(null);
    try {
      const r = await fetchJson(`${API}/csv-import/seed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preview: true }),
      });
      await refreshStatus();
      await refreshProgress();
      alert(`Seeded ${r.inserted} preview rows (${r.duplicates_flagged} flagged as duplicates).`);
    } catch (e) {
      setError(e.message);
    }
  }

  async function seedFull() {
    if (!confirm("Seed all CSV rows into the import queue? This is idempotent — safe to re-run.")) return;
    setError(null);
    try {
      const r = await fetchJson(`${API}/csv-import/seed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preview: false }),
      });
      await refreshStatus();
      await refreshProgress();
      alert(`Seeded ${r.inserted} new rows (${r.duplicates_flagged} flagged as duplicates).`);
    } catch (e) {
      setError(e.message);
    }
  }

  async function decide(queueId, action, extra = {}) {
    setError(null);
    try {
      const r = await fetchJson(`${API}/csv-import/decide`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ queue_id: queueId, action, ...extra }),
      });
      // Remove the decided row from the chunk
      setChunk(prev => prev.filter(it => it.queue_id !== queueId));
      refreshProgress();
      if (r.error) {
        alert(`Saved with error: ${r.error}`);
      }
    } catch (e) {
      setError(e.message);
    }
  }

  async function refine(queueId, refinedQuery, mediaType) {
    setError(null);
    try {
      const r = await fetchJson(`${API}/csv-import/refine/${queueId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refined_query: refinedQuery, media_type: mediaType }),
      });
      // Replace the row in-place with fresh results (and updated csv_data)
      setChunk(prev =>
        prev.map(it => (it.queue_id === queueId ? { ...it, csv_data: r.csv_data, results: r.results } : it))
      );
    } catch (e) {
      setError(e.message);
    }
  }

  async function loadMoreResults(queueId) {
    setError(null);
    try {
      const r = await fetchJson(`${API}/csv-import/results/${queueId}/more`, { method: "POST" });
      if (r.no_more) {
        alert("No more results from API for this query.");
        return;
      }
      setChunk(prev => prev.map(it => (it.queue_id === queueId ? { ...it, results: r.results } : it)));
    } catch (e) {
      setError(e.message);
    }
  }

  async function resetRow(queueId) {
    if (!confirm("Reset this row back to 'queued' for re-decision? Items already created in the modules are NOT removed.")) return;
    try {
      await fetchJson(`${API}/csv-import/reset-row/${queueId}`, { method: "POST" });
      await refreshProgress();
      loadChunk();
    } catch (e) { setError(e.message); }
  }

  return (
    <PageContainer title="CSV Import (one-time)">
      <div style={{ marginBottom: 16, padding: 12, background: "#fff7ed", border: "1px solid #fdba74", borderRadius: 6, fontSize: 13 }}>
        <strong>One-time import tool.</strong> Mass adds Movies, TV/Other, Video Games, and Music from
        the four CSVs in <code>docs/</code>. After the import is done, run
        <code> python tools/remove_csv_importer.py </code>to remove this tool.
      </div>

      {error && (
        <div style={{ marginBottom: 16, padding: 12, background: "#fee2e2", border: "1px solid #ef4444", borderRadius: 6, color: "#991b1b" }}>
          {error}
        </div>
      )}

      {status && (
        <div style={{ marginBottom: 16, display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button onClick={seedTest} style={btnStyle("#0ea5e9")}>Seed test rows (one per file)</button>
          <button onClick={seedFull} style={btnStyle("#0d9488")}>Seed full queue</button>
          <button onClick={refreshProgress} style={btnStyle("#6b7280")}>Refresh progress</button>
        </div>
      )}

      {progress && (
        <div style={{ marginBottom: 16, padding: 12, background: "#f3f4f6", borderRadius: 6, fontSize: 13 }}>
          <strong>Progress:</strong>
          <table style={{ marginTop: 8, borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr>
                <th style={th}>File</th>
                <th style={th}>Module</th>
                <th style={th}>Queued</th>
                <th style={th}>Saved</th>
                <th style={th}>Skipped</th>
                <th style={th}>Duplicate</th>
                <th style={th}>Deferred</th>
                <th style={th}>Failed</th>
                <th style={th}>Total</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(progress.files || {}).map(([file, info]) => (
                <tr key={file}>
                  <td style={td}>{file}</td>
                  <td style={td}>{info.module}</td>
                  <td style={td}>{info.counts.queued || 0}</td>
                  <td style={td}>{info.counts.saved || 0}</td>
                  <td style={td}>{info.counts.skipped || 0}</td>
                  <td style={td}>{info.counts.duplicate || 0}</td>
                  <td style={td}>{info.counts.deferred || 0}</td>
                  <td style={td}>{info.counts.failed || 0}</td>
                  <td style={td}><strong>{info.total}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ marginBottom: 12, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <label style={{ fontSize: 13 }}>
          Module:&nbsp;
          <select value={activeModule} onChange={e => setActiveModule(e.target.value)}>
            {MODULES.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </label>
        <label style={{ fontSize: 13 }}>
          Chunk size:&nbsp;
          <input
            type="number" min={1} max={50} value={chunkSize}
            onChange={e => setChunkSize(Math.max(1, Math.min(50, parseInt(e.target.value, 10) || 10)))}
            style={{ width: 60 }}
          />
        </label>
        <label style={{ fontSize: 13 }}>
          <input type="checkbox" checked={includeDeferred} onChange={e => setIncludeDeferred(e.target.checked)} />
          &nbsp;Include deferred
        </label>
        <button onClick={loadChunk} style={btnStyle("#1d4ed8")}>
          {chunkLoading ? "Loading…" : "Load next chunk"}
        </button>
      </div>

      {chunk.length === 0 && !chunkLoading && (
        <div style={{ padding: 24, color: "#6b7280", fontSize: 14 }}>
          No items loaded. Seed first if needed, then click "Load next chunk".
        </div>
      )}

      {chunk.map(item => (
        <QueueItemCard
          key={item.queue_id}
          item={item}
          onDecide={decide}
          onRefine={refine}
          onLoadMore={loadMoreResults}
          onReset={resetRow}
        />
      ))}
    </PageContainer>
  );
}

// ---------- Queue item card ----------
function QueueItemCard({ item, onDecide, onRefine, onLoadMore, onReset }) {
  const [refining, setRefining] = useState(false);
  const [refinedQuery, setRefinedQuery] = useState(item.csv_data.search_query || item.csv_data.title || "");
  const [refinedMediaType, setRefinedMediaType] = useState(item.csv_data.media_type || "movie");
  const [selectedSeasons, setSelectedSeasons] = useState(item.csv_data.seasons_detected || []);

  const allResults = useMemo(() => {
    return (item.results?.pages || []).flatMap(p => p.results || []);
  }, [item.results]);

  const isVideo = item.module === "video";
  const isVideogame = item.module === "videogames";
  const isMusic = item.module === "music";
  const isTV = isVideo && (item.csv_data.media_type === "tv" || item.csv_data.is_tv);

  function toggleSeason(n) {
    setSelectedSeasons(prev => prev.includes(n) ? prev.filter(x => x !== n) : [...prev, n].sort((a, b) => a - b));
  }

  function pickResult(r) {
    const extra = {};
    if (isVideo) {
      extra.tmdb_id = r.tmdb_id;
      extra.media_type = item.csv_data.media_type || "movie";
      if (isTV) extra.season_numbers = selectedSeasons;
    } else if (isVideogame) {
      extra.rawg_id = r.rawg_id;
    } else if (isMusic) {
      extra.discogs_id = r.discogs_id;
    }
    onDecide(item.queue_id, "pick", extra);
  }

  return (
    <div style={cardStyle}>
      {/* Header: CSV row info */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
        <div>
          <div style={{ fontSize: 13, color: "#6b7280" }}>
            {item.csv_file} (row {item.csv_row_index + 1}) · queue #{item.queue_id} · status: <strong>{item.status}</strong>
          </div>
          <div style={{ fontSize: 17, fontWeight: 600, marginTop: 4 }}>
            {item.csv_data.title || `${item.csv_data.artist || ""} — ${item.csv_data.album || ""}`}
            {item.csv_data.artist && isMusic && (
              <span style={{ fontWeight: 400, fontSize: 14, color: "#374151" }}> by {item.csv_data.artist}</span>
            )}
          </div>
          <div style={{ fontSize: 12, color: "#374151", marginTop: 4 }}>
            {item.csv_data.format && <>Format: <code>{item.csv_data.format}</code> · </>}
            {item.csv_data.style && <>Style: <code>{item.csv_data.style}</code> · </>}
            {item.csv_data.type && <>Type: <code>{item.csv_data.type}</code> · </>}
            {item.csv_data.series && <>Series: <code>{item.csv_data.series}</code> · </>}
            {item.csv_data.number && <>Number: <code>{item.csv_data.number}</code></>}
          </div>
        </div>
        <button onClick={() => onReset(item.queue_id)} style={{ ...btnStyle("#9ca3af"), fontSize: 11, padding: "4px 8px" }}>
          Reset
        </button>
      </div>

      {/* Duplicate banner */}
      {item.duplicate_item_id && (
        <div style={{ padding: 8, background: "#fef3c7", border: "1px solid #fbbf24", borderRadius: 4, fontSize: 12, marginBottom: 8 }}>
          <strong>Possible duplicate</strong> of existing item #{item.duplicate_item_id} in your library.
        </div>
      )}

      {/* TV merge banner */}
      {isTV && item.csv_data.seasons_detected?.length > 0 && (
        <div style={{ padding: 8, background: "#dbeafe", border: "1px solid #60a5fa", borderRadius: 4, fontSize: 12, marginBottom: 8 }}>
          <strong>TV detection:</strong> seasons {item.csv_data.seasons_detected.join(", ")} from "{item.csv_data.title}".
          Base title for search: <code>{item.csv_data.base_title}</code>
        </div>
      )}

      {/* Refine search */}
      <div style={{ marginBottom: 8 }}>
        {refining ? (
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input
              value={refinedQuery}
              onChange={e => setRefinedQuery(e.target.value)}
              style={{ flex: 1, padding: "4px 8px", fontSize: 13 }}
              placeholder="Refined search query"
              autoFocus
            />
            {isVideo && (
              <select value={refinedMediaType} onChange={e => setRefinedMediaType(e.target.value)} style={{ fontSize: 13 }}>
                <option value="movie">movie</option>
                <option value="tv">tv</option>
              </select>
            )}
            <button onClick={() => { onRefine(item.queue_id, refinedQuery, refinedMediaType); setRefining(false); }} style={btnStyle("#1d4ed8")}>
              Re-search
            </button>
            <button onClick={() => setRefining(false)} style={btnStyle("#6b7280")}>Cancel</button>
          </div>
        ) : (
          <button onClick={() => setRefining(true)} style={{ ...btnStyle("#7c3aed"), fontSize: 12 }}>
            Refine search
          </button>
        )}
      </div>

      {/* TV season selector */}
      {isTV && (
        <div style={{ marginBottom: 8, padding: 8, background: "#f9fafb", borderRadius: 4 }}>
          <div style={{ fontSize: 12, marginBottom: 4 }}>
            Seasons owned for this CSV row (used when picking):
          </div>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => (
              <label key={n} style={{ fontSize: 12, padding: "2px 6px", border: "1px solid #d1d5db", borderRadius: 3, cursor: "pointer" }}>
                <input type="checkbox" checked={selectedSeasons.includes(n)} onChange={() => toggleSeason(n)} />
                &nbsp;S{n}
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Results */}
      {item.results?.error && (
        <div style={{ padding: 8, background: "#fee2e2", border: "1px solid #ef4444", borderRadius: 4, fontSize: 12, marginBottom: 8, color: "#991b1b" }}>
          API error: {item.results.error}
        </div>
      )}

      {allResults.length === 0 && !item.results?.error && (
        <div style={{ padding: 8, fontSize: 12, color: "#6b7280" }}>
          No API results. Try refining the search, save title-only, or skip.
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 8, marginBottom: 8 }}>
        {allResults.map((r, idx) => (
          <ResultCard key={`${r.tmdb_id || r.rawg_id || r.discogs_id || idx}`} result={r} onPick={() => pickResult(r)} />
        ))}
      </div>

      {/* Show more / actions */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", paddingTop: 6, borderTop: "1px solid #e5e7eb" }}>
        {isVideo && item.results?.total_pages > (item.results?.pages?.length || 0) && (
          <button onClick={() => onLoadMore(item.queue_id)} style={btnStyle("#0ea5e9")}>
            Show more results ({item.results?.pages?.length || 0}/{item.results?.total_pages})
          </button>
        )}
        <button onClick={() => onDecide(item.queue_id, "save_title_only")} style={btnStyle("#475569")}>
          Save title + format only
        </button>
        <button onClick={() => onDecide(item.queue_id, "defer")} style={btnStyle("#a16207")}>
          Defer (revisit later)
        </button>
        <button onClick={() => onDecide(item.queue_id, "skip")} style={btnStyle("#dc2626")}>
          Skip (don't add)
        </button>
      </div>
    </div>
  );
}

function ResultCard({ result, onPick }) {
  const subtitle = result.year || result.released || result.platforms?.join(", ") || result.artists?.join(", ");
  const cover = result.cover_image_url || result.thumb_url;
  return (
    <div
      onClick={onPick}
      style={{
        border: "1px solid #d1d5db", borderRadius: 6, padding: 6, cursor: "pointer",
        background: "#fff", display: "flex", flexDirection: "column", gap: 4,
      }}
      onMouseEnter={e => e.currentTarget.style.borderColor = "#1d4ed8"}
      onMouseLeave={e => e.currentTarget.style.borderColor = "#d1d5db"}
    >
      {cover ? (
        <img src={cover} alt="" style={{ width: "100%", height: 180, objectFit: "cover", borderRadius: 4, background: "#f3f4f6" }} />
      ) : (
        <div style={{ width: "100%", height: 180, background: "#f3f4f6", borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, color: "#9ca3af" }}>
          No image
        </div>
      )}
      <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.2 }}>{result.title}</div>
      {subtitle && <div style={{ fontSize: 11, color: "#6b7280" }}>{subtitle}</div>}
      {result.overview && (
        <div style={{ fontSize: 11, color: "#374151", maxHeight: 60, overflow: "hidden" }}>
          {result.overview.slice(0, 140)}{result.overview.length > 140 ? "…" : ""}
        </div>
      )}
    </div>
  );
}

const btnStyle = (color) => ({
  padding: "6px 12px", fontSize: 13, background: color, color: "#fff",
  border: "none", borderRadius: 4, cursor: "pointer", fontWeight: 500,
});
const cardStyle = {
  border: "1px solid #d1d5db", borderRadius: 6, padding: 12, marginBottom: 12, background: "#fff",
};
const th = { padding: "4px 8px", textAlign: "left", borderBottom: "1px solid #d1d5db", fontWeight: 600 };
const td = { padding: "4px 8px", borderBottom: "1px solid #e5e7eb" };
