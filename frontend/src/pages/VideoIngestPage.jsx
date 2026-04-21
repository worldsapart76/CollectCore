import { useEffect, useRef, useState } from "react";
import {
  createVideo,
  fetchOwnershipStatuses,
  fetchVideoCategories,
  fetchVideoFormatTypes,
  fetchVideoGenres,
  fetchVideoWatchStatuses,
  tmdbDetail,
  tmdbSearch,
  uploadCover,
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
const sectionStyle = { marginBottom: 14, padding: "10px 12px", background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 4 };
const sectionLabel = { fontSize: 12, fontWeight: "bold", color: "var(--text-secondary)", marginBottom: 8 };

const HIDDEN_OWNERSHIP_NAMES = new Set(["Trade", "Formerly Owned", "Pending", "Borrowed"]);

// TV Series uses seasons sub-table; all others use copies
const TV_CATEGORY = "TV Series";

// ─── Name list (reusable for directors / cast) ────────────────────────────────

function NameList({ names, onChange, addLabel, placeholder }) {
  function update(idx, val) { const next = [...names]; next[idx] = val; onChange(next); }
  function add() { onChange([...names, ""]); }
  function remove(idx) { onChange(names.filter((_, i) => i !== idx)); }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {names.map((n, i) => (
        <div key={i} style={{ display: "flex", gap: 4, alignItems: "center" }}>
          <input value={n} onChange={e => update(i, e.target.value)} placeholder={placeholder} style={{ ...inputStyle, flex: 1 }} />
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

  return (
    <div>
      <div style={{ display: "flex", gap: 6, marginBottom: 6, alignItems: "center" }}>
        <select value={topSel} onChange={e => { setTopSel(e.target.value); setSubSel(""); }} style={{ ...selectStyle, flex: 1 }}>
          <option value="">— Genre —</option>
          {allGenres.map(g => <option key={g.top_genre_id} value={g.top_genre_id}>{g.genre_name}</option>)}
        </select>
        {subGenres.length > 0 && (
          <select value={subSel} onChange={e => setSubSel(e.target.value)} style={{ ...selectStyle, flex: 1 }}>
            <option value="">— Subgenre (optional) —</option>
            {subGenres.map(s => <option key={s.sub_genre_id} value={s.sub_genre_id}>{s.sub_genre_name}</option>)}
          </select>
        )}
        <button type="button" onClick={add} style={btnSm}>+ Add</button>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
        {selected.map((g, i) => (
          <span key={i} style={{ fontSize: 11, background: "var(--tag-bg)", border: "1px solid var(--tag-border)", borderRadius: 10, padding: "1px 8px", display: "flex", gap: 4, alignItems: "center" }}>
            {labelFor(g)}
            <button type="button" onClick={() => remove(i)} style={{ background: "none", border: "none", cursor: "pointer", padding: 0, fontSize: 11, color: "#c62828" }}>✕</button>
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── Copies editor (Movie / Miniseries / Concert) ─────────────────────────────

function CopiesEditor({ copies, onChange, formatTypes, ownershipStatuses }) {
  const visibleOwnership = ownershipStatuses.filter(s => !HIDDEN_OWNERSHIP_NAMES.has(s.status_name));

  function addCopy() {
    onChange([...copies, { format_type_id: null, ownership_status_id: null, notes: "" }]);
  }

  function updateCopy(idx, field, val) {
    const next = copies.map((c, i) => i === idx ? { ...c, [field]: val } : c);
    onChange(next);
  }

  function removeCopy(idx) {
    onChange(copies.filter((_, i) => i !== idx));
  }

  return (
    <div>
      {copies.map((c, i) => (
        <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr auto", gap: 6, marginBottom: 6, alignItems: "end" }}>
          <div>
            <label style={labelStyle}>Format</label>
            <select value={c.format_type_id || ""} onChange={e => updateCopy(i, "format_type_id", e.target.value ? parseInt(e.target.value) : null)} style={selectStyle}>
              <option value="">— Format —</option>
              {formatTypes.map(f => <option key={f.format_type_id} value={f.format_type_id}>{f.format_name}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Ownership</label>
            <select value={c.ownership_status_id || ""} onChange={e => updateCopy(i, "ownership_status_id", e.target.value ? parseInt(e.target.value) : null)} style={selectStyle}>
              <option value="">— Status —</option>
              {visibleOwnership.map(s => <option key={s.ownership_status_id} value={s.ownership_status_id}>{s.status_name}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Notes</label>
            <input value={c.notes || ""} onChange={e => updateCopy(i, "notes", e.target.value)} placeholder="Notes" style={inputStyle} />
          </div>
          <button type="button" onClick={() => removeCopy(i)} style={{ ...btnSm, color: "#c62828", alignSelf: "flex-end", marginBottom: 1 }}>✕</button>
        </div>
      ))}
      <button type="button" onClick={addCopy} style={btnSm}>+ Add Copy</button>
    </div>
  );
}

// ─── Seasons editor (TV Series) ───────────────────────────────────────────────

function SeasonsEditor({ seasons, onChange, formatTypes, ownershipStatuses }) {
  const visibleOwnership = ownershipStatuses.filter(s => !HIDDEN_OWNERSHIP_NAMES.has(s.status_name));

  function addSeason() {
    const nextNum = seasons.length > 0 ? Math.max(...seasons.map(s => s.season_number)) + 1 : 1;
    onChange([...seasons, { season_number: nextNum, episode_count: null, format_type_id: null, ownership_status_id: null, notes: "" }]);
  }

  function updateSeason(idx, field, val) {
    const next = seasons.map((s, i) => i === idx ? { ...s, [field]: val } : s);
    onChange(next);
  }

  function removeSeason(idx) {
    onChange(seasons.filter((_, i) => i !== idx));
  }

  return (
    <div>
      {seasons.map((s, i) => (
        <div key={i} style={{ display: "grid", gridTemplateColumns: "60px 80px 1fr 1fr auto", gap: 6, marginBottom: 6, alignItems: "end" }}>
          <div>
            <label style={labelStyle}>Season #</label>
            <input type="number" value={s.season_number} onChange={e => updateSeason(i, "season_number", parseInt(e.target.value) || 1)} style={inputStyle} min={1} />
          </div>
          <div>
            <label style={labelStyle}>Episodes</label>
            <input type="number" value={s.episode_count || ""} onChange={e => updateSeason(i, "episode_count", e.target.value ? parseInt(e.target.value) : null)} placeholder="—" style={inputStyle} min={1} />
          </div>
          <div>
            <label style={labelStyle}>Format</label>
            <select value={s.format_type_id || ""} onChange={e => updateSeason(i, "format_type_id", e.target.value ? parseInt(e.target.value) : null)} style={selectStyle}>
              <option value="">— Format —</option>
              {formatTypes.map(f => <option key={f.format_type_id} value={f.format_type_id}>{f.format_name}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Ownership</label>
            <select value={s.ownership_status_id || ""} onChange={e => updateSeason(i, "ownership_status_id", e.target.value ? parseInt(e.target.value) : null)} style={selectStyle}>
              <option value="">— Status —</option>
              {visibleOwnership.map(st => <option key={st.ownership_status_id} value={st.ownership_status_id}>{st.status_name}</option>)}
            </select>
          </div>
          <button type="button" onClick={() => removeSeason(i)} style={{ ...btnSm, color: "#c62828", alignSelf: "flex-end", marginBottom: 1 }}>✕</button>
        </div>
      ))}
      <button type="button" onClick={addSeason} style={btnSm}>+ Add Season</button>
    </div>
  );
}

// ─── TMDB search panel ────────────────────────────────────────────────────────

function TmdbSearchPanel({ videoTypeName, onSelect }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(null);
  const [error, setError] = useState("");

  const mediaType = videoTypeName === "TV Series" ? "tv" : "movie";

  async function doSearch() {
    if (!query.trim()) return;
    setLoading(true);
    setError("");
    setResults([]);
    try {
      const data = await tmdbSearch(query, mediaType);
      setResults(data);
    } catch (e) {
      setError(e.message || "TMDB search failed");
    } finally {
      setLoading(false);
    }
  }

  async function pickResult(r) {
    setLoadingDetail(r.tmdb_id);
    setError("");
    try {
      const detail = await tmdbDetail(r.tmdb_id, mediaType);
      onSelect(detail);
      setResults([]);
      setQuery("");
    } catch (e) {
      setError(e.message || "Failed to fetch TMDB detail");
    } finally {
      setLoadingDetail(null);
    }
  }

  return (
    <div style={sectionStyle}>
      <div style={sectionLabel}>Search TMDB</div>
      <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === "Enter" && doSearch()}
          placeholder={`Search TMDB for ${mediaType === "tv" ? "TV shows" : "movies"}…`}
          style={{ ...inputStyle, flex: 1 }}
        />
        <button type="button" onClick={doSearch} style={btnPrimary} disabled={loading}>
          {loading ? "Searching…" : "Search"}
        </button>
      </div>
      {error && <div style={alertError}>{error}</div>}
      {results.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {results.map(r => (
            <div
              key={r.tmdb_id}
              style={{ display: "flex", gap: 8, padding: "6px 8px", background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 3, cursor: "pointer", alignItems: "center" }}
              onClick={() => pickResult(r)}
            >
              {r.cover_image_url && (
                <img src={r.cover_image_url} alt="" style={{ width: 32, height: 48, objectFit: "cover", borderRadius: 2, flexShrink: 0 }} />
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: "bold" }}>{r.title}{r.year ? ` (${r.year})` : ""}</div>
                {r.overview && <div style={{ fontSize: 11, color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.overview}</div>}
              </div>
              {loadingDetail === r.tmdb_id
                ? <span style={{ fontSize: 11 }}>Loading…</span>
                : <span style={{ fontSize: 11, color: "var(--text-secondary)" }}>Select</span>
              }
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

const BLANK = {
  title: "",
  top_level_category_id: "",
  ownership_status_id: "",
  reading_status_id: "",
  release_date: "",
  runtime_minutes: "",
  description: "",
  cover_image_url: "",
  notes: "",
  director_names: [""],
  cast_names: [""],
  genres: [],
  copies: [],
  seasons: [],
};

export default function VideoIngestPage() {
  const [form, setForm] = useState(BLANK);
  const [categories, setCategories] = useState([]);
  const [formatTypes, setFormatTypes] = useState([]);
  const [allGenres, setAllGenres] = useState([]);
  const [ownershipStatuses, setOwnershipStatuses] = useState([]);
  const [watchStatuses, setWatchStatuses] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const coverFileRef = useRef(null);

  async function handleCoverFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const { url } = await uploadCover(file, "video");
      set("cover_image_url", url);
    } catch (err) {
      setError(err.message || "Cover upload failed.");
    }
    if (coverFileRef.current) coverFileRef.current.value = "";
  }

  useEffect(() => {
    Promise.all([
      fetchVideoCategories(),
      fetchVideoFormatTypes(),
      fetchVideoGenres(),
      fetchOwnershipStatuses(),
      fetchVideoWatchStatuses(),
    ]).then(([cats, fmts, genres, own, watch]) => {
      setCategories(cats);
      setFormatTypes(fmts);
      setAllGenres(genres);
      setOwnershipStatuses(own);
      setWatchStatuses(watch);
      if (cats.length > 0) setForm(f => ({ ...f, top_level_category_id: String(cats[0].top_level_category_id) }));
    }).catch(e => setError(e.message || "Failed to load lookup data. Is the backend running?"));
  }, []);

  const visibleOwnership = ownershipStatuses.filter(s => !HIDDEN_OWNERSHIP_NAMES.has(s.status_name));

  const selectedCategory = categories.find(c => String(c.top_level_category_id) === String(form.top_level_category_id));
  const isTV = selectedCategory?.category_name === TV_CATEGORY;

  function set(field, val) { setForm(f => ({ ...f, [field]: val })); }

  function handleTmdbSelect(detail) {
    setForm(f => ({
      ...f,
      title: detail.title || f.title,
      release_date: detail.release_date || f.release_date,
      runtime_minutes: detail.runtime_minutes ? String(detail.runtime_minutes) : f.runtime_minutes,
      description: detail.overview || f.description,
      cover_image_url: detail.cover_image_url || f.cover_image_url,
      director_names: detail.directors?.length ? detail.directors : f.director_names,
      cast_names: detail.cast?.length ? detail.cast : f.cast_names,
      api_source: "tmdb",
      external_work_id: String(detail.tmdb_id),
      // Pre-fill seasons for TV
      seasons: isTV && detail.seasons?.length
        ? detail.seasons.map(s => ({
            season_number: s.season_number,
            episode_count: s.episode_count || null,
            format_type_id: null,
            ownership_status_id: null,
            notes: "",
          }))
        : f.seasons,
    }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.title.trim()) { setError("Title is required."); return; }
    if (!form.top_level_category_id) { setError("Content type is required."); return; }
    if (!form.ownership_status_id) { setError("Ownership status is required."); return; }

    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const payload = {
        title: form.title.trim(),
        top_level_category_id: parseInt(form.top_level_category_id),
        ownership_status_id: parseInt(form.ownership_status_id),
        reading_status_id: form.reading_status_id ? parseInt(form.reading_status_id) : null,
        release_date: form.release_date || null,
        runtime_minutes: form.runtime_minutes ? parseInt(form.runtime_minutes) : null,
        description: form.description || null,
        cover_image_url: form.cover_image_url || null,
        notes: form.notes || null,
        api_source: form.api_source || null,
        external_work_id: form.external_work_id || null,
        director_names: form.director_names.map(n => n.trim()).filter(Boolean),
        cast_names: form.cast_names.map(n => n.trim()).filter(Boolean),
        genres: form.genres,
        copies: isTV ? [] : form.copies,
        seasons: isTV ? form.seasons : [],
      };
      await createVideo(payload);
      setSuccess(`"${form.title}" added.`);
      setForm(f => ({ ...BLANK, top_level_category_id: f.top_level_category_id }));
    } catch (e) {
      setError(e.message || "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <PageContainer title="Add Video">
      <div style={{ maxWidth: 700, margin: "0 auto" }}>
        {error && <div style={alertError}>{error}</div>}
        {success && <div style={alertSuccess}>{success}</div>}

        {/* TMDB search panel (shown when category is selected) */}
        {selectedCategory && (
          <TmdbSearchPanel videoTypeName={selectedCategory.category_name} onSelect={handleTmdbSelect} />
        )}

        <form onSubmit={handleSubmit}>
          {/* Content type + Ownership */}
          <div style={row2}>
            <div>
              <label style={labelStyle}>Content Type *</label>
              <select
                value={form.top_level_category_id}
                onChange={e => {
                  set("top_level_category_id", e.target.value);
                  // Reset sub-tables when switching category type
                  setForm(f => ({ ...f, top_level_category_id: e.target.value, copies: [], seasons: [] }));
                }}
                style={selectStyle}
                required
              >
                <option value="">— Select type —</option>
                {categories.map(c => <option key={c.top_level_category_id} value={c.top_level_category_id}>{c.category_name}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Ownership *</label>
              <select value={form.ownership_status_id} onChange={e => set("ownership_status_id", e.target.value)} style={selectStyle} required>
                <option value="">— Status —</option>
                {visibleOwnership.map(s => <option key={s.ownership_status_id} value={s.ownership_status_id}>{s.status_name}</option>)}
              </select>
            </div>
          </div>

          {/* Title */}
          <div style={{ marginBottom: 10 }}>
            <label style={labelStyle}>Title *</label>
            <input value={form.title} onChange={e => set("title", e.target.value)} placeholder="Title" style={inputStyle} required />
          </div>

          {/* Release date + Runtime + Watch status */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 10 }}>
            <div>
              <label style={labelStyle}>Release Date</label>
              <input type="date" value={form.release_date} onChange={e => set("release_date", e.target.value)} style={inputStyle} />
            </div>
            {!isTV && (
              <div>
                <label style={labelStyle}>Runtime (min)</label>
                <input type="number" value={form.runtime_minutes} onChange={e => set("runtime_minutes", e.target.value)} placeholder="e.g. 120" style={inputStyle} min={1} />
              </div>
            )}
            <div>
              <label style={labelStyle}>Watch Status</label>
              <select value={form.reading_status_id} onChange={e => set("reading_status_id", e.target.value)} style={selectStyle}>
                <option value="">— Status —</option>
                {watchStatuses.map(s => <option key={s.read_status_id} value={s.read_status_id}>{s.status_name}</option>)}
              </select>
            </div>
          </div>

          {/* Cover image URL */}
          <div style={{ marginBottom: 10 }}>
            <label style={labelStyle}>Cover Image URL</label>
            <div style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
              <input value={form.cover_image_url} onChange={e => set("cover_image_url", e.target.value)} placeholder="https://..." style={{ ...inputStyle, flex: 1 }} />
              <input type="file" accept="image/*" ref={coverFileRef} onChange={handleCoverFile} style={{ display: "none" }} />
              <button type="button" onClick={() => coverFileRef.current?.click()} style={{ padding: "4px 10px", fontSize: 12, whiteSpace: "nowrap" }}>Add Image</button>
              {form.cover_image_url && (
                <img src={form.cover_image_url} alt="" style={{ height: 48, width: 32, objectFit: "cover", borderRadius: 2, border: "1px solid var(--border)" }} />
              )}
            </div>
          </div>

          {/* Directors */}
          <div style={sectionStyle}>
            <div style={sectionLabel}>Director(s) / Creator(s)</div>
            <NameList names={form.director_names} onChange={v => set("director_names", v)} addLabel="+ Director" placeholder="Director name" />
          </div>

          {/* Cast */}
          <div style={sectionStyle}>
            <div style={sectionLabel}>Cast</div>
            <NameList names={form.cast_names} onChange={v => set("cast_names", v)} addLabel="+ Cast member" placeholder="Cast member name" />
          </div>

          {/* Genres */}
          <div style={sectionStyle}>
            <div style={sectionLabel}>Genres</div>
            <GenrePicker allGenres={allGenres} selected={form.genres} onChange={v => set("genres", v)} />
          </div>

          {/* Copies (non-TV) or Seasons (TV) */}
          {isTV ? (
            <div style={sectionStyle}>
              <div style={sectionLabel}>Seasons</div>
              <SeasonsEditor seasons={form.seasons} onChange={v => set("seasons", v)} formatTypes={formatTypes} ownershipStatuses={ownershipStatuses} />
            </div>
          ) : (
            <div style={sectionStyle}>
              <div style={sectionLabel}>Copies / Formats</div>
              <CopiesEditor copies={form.copies} onChange={v => set("copies", v)} formatTypes={formatTypes} ownershipStatuses={ownershipStatuses} />
            </div>
          )}

          {/* Description + Notes */}
          <div style={{ marginBottom: 10 }}>
            <label style={labelStyle}>Description</label>
            <textarea value={form.description} onChange={e => set("description", e.target.value)} rows={3} style={{ ...inputStyle, resize: "vertical" }} />
          </div>
          <div style={{ marginBottom: 14 }}>
            <label style={labelStyle}>Notes</label>
            <textarea value={form.notes} onChange={e => set("notes", e.target.value)} rows={2} style={{ ...inputStyle, resize: "vertical" }} />
          </div>

          <button type="submit" style={btnPrimary} disabled={saving}>
            {saving ? "Saving…" : "Add Video"}
          </button>
        </form>
      </div>
    </PageContainer>
  );
}
