import { useEffect, useState } from "react";
import {
  createVideoGame,
  fetchGameGenres,
  fetchGamePlatforms,
  fetchGamePlayStatuses,
  fetchOwnershipStatuses,
  rawgSearchGames,
} from "../api";
import PageContainer from "../components/layout/PageContainer";

// ─── Styles ───────────────────────────────────────────────────────────────────

const labelStyle = { display: "block", fontSize: 12, fontWeight: "bold", marginBottom: 3, color: "var(--text-secondary)" };
const inputStyle = { fontSize: 13, padding: "3px 6px", borderRadius: 3, border: "1px solid var(--border-input)", width: "100%", boxSizing: "border-box" };
const selectStyle = { fontSize: 13, padding: "3px 6px", borderRadius: 3, border: "1px solid var(--border-input)", width: "100%" };
const btnPrimary = { fontSize: 13, padding: "6px 14px", background: "var(--btn-primary-bg)", color: "var(--btn-primary-text)", border: "none", borderRadius: 4, cursor: "pointer" };
const btnSecondary = { fontSize: 13, padding: "5px 12px", background: "var(--btn-secondary-bg)", color: "var(--btn-secondary-text)", border: "1px solid var(--btn-secondary-border)", borderRadius: 4, cursor: "pointer" };
const btnSm = { fontSize: 11, padding: "2px 7px", background: "var(--btn-secondary-bg)", border: "1px solid var(--btn-secondary-border)", borderRadius: 3, cursor: "pointer" };
const alertError = { marginBottom: 10, padding: "8px 10px", border: "1px solid var(--error-border)", background: "var(--error-bg)", fontSize: 13, borderRadius: 3 };
const alertSuccess = { marginBottom: 10, padding: "8px 10px", border: "1px solid #2e7d32", background: "var(--green-light)", fontSize: 13, borderRadius: 3 };
const row2 = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 };

// Options hidden from this module
const HIDDEN_OWNERSHIP_NAMES = new Set(["Trade", "Formerly Owned", "Pending", "Borrowed"]);

// ─── Name list (for developers / publishers) ──────────────────────────────────

function NameList({ names, onChange, addLabel, placeholder }) {
  function update(idx, val) { const next = [...names]; next[idx] = val; onChange(next); }
  function add() { onChange([...names, ""]); }
  function remove(idx) { onChange(names.filter((_, i) => i !== idx)); }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {names.map((n, i) => (
        <div key={i} style={{ display: "flex", gap: 4, alignItems: "center" }}>
          <input value={n} onChange={(e) => update(i, e.target.value)} placeholder={placeholder} style={{ ...inputStyle, flex: 1 }} />
          {names.length > 1 && <button type="button" onClick={() => remove(i)} style={{ ...btnSm, color: "#c62828" }}>✕</button>}
        </div>
      ))}
      <button type="button" onClick={add} style={{ ...btnSm, alignSelf: "flex-start" }}>{addLabel}</button>
    </div>
  );
}

// ─── Genre picker ─────────────────────────────────────────────────────────────

function GenrePicker({ allGenres, selected, onChange }) {
  const [topSel, setTopSel] = useState("");
  const [subSel, setSubSel] = useState("");

  const topGenre = allGenres.find(g => String(g.top_genre_id) === topSel);
  const subGenres = topGenre?.sub_genres || [];

  function add() {
    if (!topSel) return;
    const topId = parseInt(topSel, 10);
    const subId = subSel ? parseInt(subSel, 10) : null;
    const key = `${topId}-${subId}`;
    if (selected.find(g => `${g.top_genre_id}-${g.sub_genre_id}` === key)) return;
    onChange([...selected, { top_genre_id: topId, sub_genre_id: subId }]);
    setTopSel(""); setSubSel("");
  }

  function remove(idx) { onChange(selected.filter((_, i) => i !== idx)); }

  function labelFor(g) {
    const top = allGenres.find(t => t.top_genre_id === g.top_genre_id);
    if (!top) return String(g.top_genre_id);
    if (!g.sub_genre_id) return top.genre_name;
    const sub = top.sub_genres.find(s => s.sub_genre_id === g.sub_genre_id);
    return sub ? `${top.genre_name} — ${sub.sub_genre_name}` : top.genre_name;
  }

  function handleTopChange(val) {
    setTopSel(val);
    setSubSel("");
    const found = allGenres.find(g => String(g.top_genre_id) === val);
    if (found && found.sub_genres.length === 0) {
      const topId = parseInt(val, 10);
      const key = `${topId}-null`;
      if (!selected.find(g => `${g.top_genre_id}-${g.sub_genre_id}` === key)) {
        onChange([...selected, { top_genre_id: topId, sub_genre_id: null }]);
      }
      setTopSel("");
    }
  }

  return (
    <div>
      <div style={{ display: "flex", gap: 6, marginBottom: 6, flexWrap: "wrap" }}>
        <select value={topSel} onChange={(e) => handleTopChange(e.target.value)} style={{ ...selectStyle, width: "auto", minWidth: 140 }}>
          <option value="">Genre…</option>
          {allGenres.map(g => <option key={g.top_genre_id} value={g.top_genre_id}>{g.genre_name}</option>)}
        </select>
        {subGenres.length > 0 && (
          <>
            <select value={subSel} onChange={(e) => setSubSel(e.target.value)} style={{ ...selectStyle, width: "auto", minWidth: 140 }}>
              <option value="">Subgenre…</option>
              {subGenres.map(s => <option key={s.sub_genre_id} value={s.sub_genre_id}>{s.sub_genre_name}</option>)}
            </select>
            <button type="button" onClick={add} style={btnSm}>Add</button>
          </>
        )}
      </div>
      {selected.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
          {selected.map((g, i) => (
            <span key={i} style={{ fontSize: 11, padding: "2px 6px", background: "var(--green-light)", border: "1px solid var(--border-input)", borderRadius: 10, display: "flex", alignItems: "center", gap: 4, color: "var(--green)" }}>
              {labelFor(g)}
              <button type="button" onClick={() => remove(i)} style={{ border: "none", background: "none", cursor: "pointer", fontSize: 11, color: "#555", padding: 0 }}>✕</button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Copies editor ────────────────────────────────────────────────────────────

function blankCopy() {
  return { platform_id: "", edition: "", ownership_status_id: "", notes: "" };
}

function CopiesEditor({ copies, allPlatforms, ownershipStatuses, onChange }) {
  function update(idx, key, val) {
    const next = [...copies];
    next[idx] = { ...next[idx], [key]: val };
    onChange(next);
  }
  function add() { onChange([...copies, blankCopy()]); }
  function remove(idx) { onChange(copies.filter((_, i) => i !== idx)); }

  return (
    <div>
      {copies.map((copy, i) => (
        <div key={i} style={{ marginBottom: 8, padding: "8px 10px", border: "1px solid var(--border)", borderRadius: 3, background: "var(--surface-2)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <span style={{ fontSize: 11, fontWeight: "bold", color: "var(--text-secondary)" }}>Copy {i + 1}</span>
            <button type="button" onClick={() => remove(i)} style={{ ...btnSm, color: "#c62828" }}>✕ Remove</button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 6 }}>
            <div>
              <label style={labelStyle}>Platform</label>
              <select value={copy.platform_id} onChange={e => update(i, "platform_id", e.target.value)} style={selectStyle}>
                <option value="">Select platform…</option>
                {allPlatforms.map(p => <option key={p.platform_id} value={p.platform_id}>{p.platform_name}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Edition</label>
              <input value={copy.edition} onChange={e => update(i, "edition", e.target.value)} style={inputStyle} placeholder="e.g. Collector's Edition" />
            </div>
          </div>
          <div>
            <label style={labelStyle}>Ownership</label>
            <select value={copy.ownership_status_id} onChange={e => update(i, "ownership_status_id", e.target.value)} style={{ ...selectStyle, maxWidth: 200 }}>
              <option value="">None</option>
              {ownershipStatuses.map(s => <option key={s.ownership_status_id} value={s.ownership_status_id}>{s.status_name}</option>)}
            </select>
          </div>
        </div>
      ))}
      <button type="button" onClick={add} style={{ ...btnSm, marginTop: copies.length > 0 ? 0 : 0 }}>+ Add Copy</button>
    </div>
  );
}

// ─── Blank form ───────────────────────────────────────────────────────────────

function blankForm(ownershipStatuses) {
  const owned = ownershipStatuses.find(s => s.status_code === "owned");
  return {
    title: "",
    developers: [""],
    publishers: [""],
    releaseDate: "",
    description: "",
    coverImageUrl: "",
    ownershipStatusId: owned ? String(owned.ownership_status_id) : "",
    playStatusId: "",
    notes: "",
    genres: [],
    copies: [],
  };
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function VideoGamesIngestPage() {
  const [ownershipStatuses, setOwnershipStatuses] = useState([]);
  const [playStatuses, setPlayStatuses] = useState([]);
  const [allGenres, setAllGenres] = useState([]);
  const [allPlatforms, setAllPlatforms] = useState([]);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [coverPreview, setCoverPreview] = useState(null);

  // RAWG search state
  const [rawgQuery, setRawgQuery] = useState("");
  const [rawgResults, setRawgResults] = useState(null);
  const [rawgSearching, setRawgSearching] = useState(false);
  const [rawgError, setRawgError] = useState("");

  useEffect(() => {
    Promise.all([
      fetchOwnershipStatuses(),
      fetchGamePlayStatuses(),
      fetchGameGenres(),
      fetchGamePlatforms(),
    ]).then(([own, play, genres, platforms]) => {
      const filteredOwn = own.filter(s => !HIDDEN_OWNERSHIP_NAMES.has(s.status_name));
      setOwnershipStatuses(filteredOwn);
      setPlayStatuses(play);
      setAllGenres(genres);
      setAllPlatforms(platforms);
      setForm(blankForm(filteredOwn));
    });
  }, []);

  function set(key, val) {
    setForm(f => ({ ...f, [key]: val }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(""); setSuccess("");
    if (!form.title.trim()) { setError("Title is required."); return; }
    if (!form.ownershipStatusId) { setError("Ownership status is required."); return; }

    setSaving(true);
    try {
      const payload = {
        title: form.title.trim(),
        ownership_status_id: parseInt(form.ownershipStatusId, 10),
        play_status_id: form.playStatusId ? parseInt(form.playStatusId, 10) : null,
        notes: form.notes || null,
        description: form.description || null,
        release_date: form.releaseDate || null,
        cover_image_url: form.coverImageUrl || null,
        developer_names: form.developers.map(d => d.trim()).filter(Boolean),
        publisher_names: form.publishers.map(p => p.trim()).filter(Boolean),
        genres: form.genres,
        copies: form.copies
          .filter(c => c.platform_id || c.edition)
          .map(c => ({
            platform_id: c.platform_id ? parseInt(c.platform_id, 10) : null,
            edition: c.edition || null,
            ownership_status_id: c.ownership_status_id ? parseInt(c.ownership_status_id, 10) : null,
            notes: c.notes || null,
          })),
      };
      await createVideoGame(payload);
      setSuccess(`"${form.title}" saved.`);
      setForm(blankForm(ownershipStatuses));
      setCoverPreview(null);
      setRawgQuery(""); setRawgResults(null);
    } catch (err) {
      setError(err.message || "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  function handleReset() {
    setForm(blankForm(ownershipStatuses));
    setError(""); setSuccess(""); setCoverPreview(null);
    setRawgQuery(""); setRawgResults(null); setRawgError("");
  }

  async function handleRawgSearch(e) {
    e.preventDefault();
    if (!rawgQuery.trim()) return;
    setRawgSearching(true); setRawgError(""); setRawgResults(null);
    try {
      const results = await rawgSearchGames(rawgQuery.trim());
      setRawgResults(results);
    } catch (err) {
      setRawgError(err.message || "Search failed.");
    } finally {
      setRawgSearching(false);
    }
  }

  function applyRawgResult(result) {
    setForm(f => ({
      ...f,
      title: result.title || f.title,
      releaseDate: result.released || f.releaseDate,
      coverImageUrl: result.cover_image_url || f.coverImageUrl,
    }));
    setCoverPreview(result.cover_image_url || null);
    setRawgResults(null);
    setRawgQuery("");
  }

  if (!form) return <PageContainer><p style={{ padding: 20, fontSize: 13 }}>Loading…</p></PageContainer>;

  const visibleOwnership = ownershipStatuses.filter(s => !HIDDEN_OWNERSHIP_NAMES.has(s.status_name));

  return (
    <PageContainer>
      <div style={{ maxWidth: 680, padding: "16px 0" }}>
        <h2 style={{ fontSize: 17, fontWeight: 700, marginBottom: 14, color: "var(--text-primary)" }}>Add Video Game</h2>

        {error && <div style={alertError}>{error}</div>}
        {success && <div style={alertSuccess}>{success}</div>}

        {/* RAWG Search */}
        <div style={{ marginBottom: 14, padding: "10px 12px", background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 4 }}>
          <div style={{ fontSize: 12, fontWeight: "bold", color: "var(--text-secondary)", marginBottom: 6 }}>Search RAWG</div>
          <form onSubmit={handleRawgSearch} style={{ display: "flex", gap: 6, marginBottom: rawgResults || rawgError ? 8 : 0 }}>
            <input
              value={rawgQuery}
              onChange={e => setRawgQuery(e.target.value)}
              style={{ ...inputStyle, flex: 1 }}
              placeholder="Game title…"
            />
            <button type="submit" disabled={rawgSearching || !rawgQuery.trim()} style={btnSecondary}>{rawgSearching ? "Searching…" : "Search"}</button>
          </form>
          {rawgError && <div style={{ fontSize: 12, color: "var(--error)", marginTop: 4 }}>{rawgError}</div>}
          {rawgResults && rawgResults.length === 0 && <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>No results found.</div>}
          {rawgResults && rawgResults.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              {rawgResults.map(r => (
                <button
                  key={r.rawg_id}
                  type="button"
                  onClick={() => applyRawgResult(r)}
                  style={{ display: "flex", gap: 8, alignItems: "center", background: "none", border: "1px solid var(--border-input)", borderRadius: 3, padding: "4px 8px", cursor: "pointer", textAlign: "left" }}
                >
                  {r.cover_image_url && <img src={r.cover_image_url} alt="" style={{ width: 28, height: 40, objectFit: "cover", borderRadius: 2, flexShrink: 0 }} />}
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text-primary)" }}>{r.title}</div>
                    {(r.released || r.platforms?.length > 0) && (
                      <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>
                        {r.released}{r.released && r.platforms?.length > 0 ? " · " : ""}{r.platforms?.slice(0, 3).join(", ")}
                      </div>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <form onSubmit={handleSubmit}>
          {/* Title */}
          <div style={{ marginBottom: 10 }}>
            <label style={labelStyle}>Title *</label>
            <input value={form.title} onChange={e => set("title", e.target.value)} style={inputStyle} placeholder="e.g. Hollow Knight" autoFocus />
          </div>

          {/* Ownership / Play status */}
          <div style={row2}>
            <div>
              <label style={labelStyle}>Ownership *</label>
              <select value={form.ownershipStatusId} onChange={e => set("ownershipStatusId", e.target.value)} style={selectStyle}>
                <option value="">Select…</option>
                {visibleOwnership.map(s => <option key={s.ownership_status_id} value={s.ownership_status_id}>{s.status_name}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Play Status</label>
              <select value={form.playStatusId} onChange={e => set("playStatusId", e.target.value)} style={selectStyle}>
                <option value="">None</option>
                {playStatuses.map(s => <option key={s.play_status_id} value={s.play_status_id}>{s.status_name}</option>)}
              </select>
            </div>
          </div>

          {/* Release date */}
          <div style={{ marginBottom: 10 }}>
            <label style={labelStyle}>Release Date</label>
            <input value={form.releaseDate} onChange={e => set("releaseDate", e.target.value)} style={{ ...inputStyle, maxWidth: 200 }} placeholder="YYYY-MM-DD" />
          </div>

          {/* Developer(s) */}
          <div style={{ marginBottom: 10 }}>
            <label style={labelStyle}>Developer(s)</label>
            <NameList names={form.developers} onChange={v => set("developers", v)} addLabel="+ Developer" placeholder="e.g. Team Cherry" />
          </div>

          {/* Publisher(s) */}
          <div style={{ marginBottom: 10 }}>
            <label style={labelStyle}>Publisher(s)</label>
            <NameList names={form.publishers} onChange={v => set("publishers", v)} addLabel="+ Publisher" placeholder="e.g. Team Cherry" />
          </div>

          {/* Genre */}
          <div style={{ marginBottom: 10 }}>
            <label style={labelStyle}>Genre</label>
            <GenrePicker allGenres={allGenres} selected={form.genres} onChange={v => set("genres", v)} />
          </div>

          {/* Cover image */}
          <div style={{ marginBottom: 10 }}>
            <label style={labelStyle}>Cover Image URL</label>
            <div style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
              <input
                value={form.coverImageUrl}
                onChange={e => { set("coverImageUrl", e.target.value); setCoverPreview(e.target.value || null); }}
                style={{ ...inputStyle, flex: 1 }}
                placeholder="https://…"
              />
              {coverPreview && (
                <img src={coverPreview} alt="cover preview" style={{ width: 50, height: 70, objectFit: "cover", border: "1px solid var(--border)", borderRadius: 3 }} onError={() => setCoverPreview(null)} />
              )}
            </div>
          </div>

          {/* Description */}
          <div style={{ marginBottom: 10 }}>
            <label style={labelStyle}>Description</label>
            <textarea value={form.description} onChange={e => set("description", e.target.value)} style={{ ...inputStyle, height: 70, resize: "vertical" }} />
          </div>

          {/* Notes */}
          <div style={{ marginBottom: 14 }}>
            <label style={labelStyle}>Notes</label>
            <textarea value={form.notes} onChange={e => set("notes", e.target.value)} style={{ ...inputStyle, height: 50, resize: "vertical" }} />
          </div>

          {/* Copies */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ ...labelStyle, marginBottom: 6 }}>Copies</label>
            <CopiesEditor
              copies={form.copies}
              allPlatforms={allPlatforms}
              ownershipStatuses={visibleOwnership}
              onChange={v => set("copies", v)}
            />
          </div>

          {/* Buttons */}
          <div style={{ display: "flex", gap: 8 }}>
            <button type="submit" disabled={saving} style={btnPrimary}>{saving ? "Saving…" : "Save Game"}</button>
            <button type="button" onClick={handleReset} style={btnSecondary}>Clear</button>
          </div>
        </form>
      </div>
    </PageContainer>
  );
}
