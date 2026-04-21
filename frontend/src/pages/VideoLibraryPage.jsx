import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  emptySection,
  cycleItem,
  getItemState,
  sectionActive,
  applySection,
  FilterSidebarShell,
  TriStateFilterSection,
  SearchableTriStateSection,
} from "../components/library/FilterSidebar";
import {
  bulkDeleteVideo,
  bulkUpdateVideo,
  deleteVideo,
  fetchOwnershipStatuses,
  fetchVideoCategories,
  fetchVideoFormatTypes,
  fetchVideoGenres,
  fetchVideoWatchStatuses,
  getVideo,
  listVideo,
  updateVideo,
  uploadCover,
} from "../api";
import { getImageUrl } from "../utils/imageUrl";

// ─── Styles ───────────────────────────────────────────────────────────────────

const labelStyle = { display: "block", fontSize: 12, fontWeight: "bold", marginBottom: 3, color: "var(--text-secondary)" };
const inputStyle = { fontSize: 13, padding: "3px 6px", borderRadius: 3, border: "1px solid var(--border-input)", width: "100%", boxSizing: "border-box" };
const selectStyle = { fontSize: 13, padding: "3px 6px", borderRadius: 3, border: "1px solid var(--border-input)", width: "100%" };
const btnPrimary = { fontSize: 13, padding: "6px 14px", background: "var(--btn-primary-bg)", color: "var(--btn-primary-text)", border: "none", borderRadius: 4, cursor: "pointer" };
const btnSecondary = { fontSize: 13, padding: "5px 12px", background: "var(--btn-secondary-bg)", color: "var(--btn-secondary-text)", border: "1px solid var(--btn-secondary-border)", borderRadius: 4, cursor: "pointer" };
const btnSm = { fontSize: 11, padding: "2px 7px", background: "var(--btn-secondary-bg)", border: "1px solid var(--btn-secondary-border)", borderRadius: 3, cursor: "pointer" };
const btnDanger = { fontSize: 13, padding: "5px 12px", background: "#c62828", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer" };
const alertError = { marginBottom: 10, padding: "8px 10px", border: "1px solid var(--error-border)", background: "var(--error-bg)", fontSize: 13, borderRadius: 3 };
const alertSuccess = { marginBottom: 10, padding: "8px 10px", border: "1px solid #2e7d32", background: "var(--green-light)", fontSize: 13, borderRadius: 3 };

const HIDDEN_OWNERSHIP_NAMES = new Set(["Trade", "Formerly Owned", "Pending", "Borrowed"]);
const TV_CATEGORY = "TV Series";

// ─── Filter sidebar ───────────────────────────────────────────────────────────

function VideoFilters({ items, ownershipStatuses, watchStatuses, categories, allGenres, filters, onSectionChange, onClearAll }) {
  const visibleOwnership = ownershipStatuses.filter(s => !HIDDEN_OWNERSHIP_NAMES.has(s.status_name));

  const allDirectors = useMemo(() => {
    const seen = new Set();
    const result = [];
    for (const v of items) for (const d of (v.directors || [])) if (!seen.has(d)) { seen.add(d); result.push(d); }
    return result.sort().map(d => ({ id: d, label: d }));
  }, [items]);

  const allGenreLabels = useMemo(() => {
    const seen = new Set();
    const result = [];
    for (const v of items) for (const g of (v.genres || [])) if (!seen.has(g)) { seen.add(g); result.push(g); }
    return result.sort().map(g => ({ id: g, label: g }));
  }, [items]);

  const hasFilters = filters.search.trim() ||
    sectionActive(filters.ownership) || sectionActive(filters.watchStatus) ||
    sectionActive(filters.category) || sectionActive(filters.director) ||
    sectionActive(filters.genre);

  return (
    <FilterSidebarShell onClearAll={hasFilters ? onClearAll : null}>
      <div style={{ marginBottom: 10 }}>
        <label style={{ display: "block", fontSize: 11, fontWeight: "bold", color: "var(--text-secondary)", marginBottom: 3 }}>Search</label>
        <input
          value={filters.search}
          onChange={e => onSectionChange("search", e.target.value)}
          placeholder="Title, director…"
          style={{ fontSize: 12, padding: "3px 6px", borderRadius: 3, border: "1px solid var(--border-input)", width: "100%", boxSizing: "border-box" }}
        />
      </div>
      <TriStateFilterSection
        title="Content Type"
        items={categories.map(c => ({ id: String(c.top_level_category_id), label: c.category_name }))}
        section={filters.category}
        onChange={s => onSectionChange("category", s)}
      />
      <TriStateFilterSection
        title="Ownership"
        items={visibleOwnership.map(s => ({ id: String(s.ownership_status_id), label: s.status_name }))}
        section={filters.ownership}
        onChange={s => onSectionChange("ownership", s)}
      />
      <TriStateFilterSection
        title="Watch Status"
        items={watchStatuses.map(s => ({ id: String(s.read_status_id), label: s.status_name }))}
        section={filters.watchStatus}
        onChange={s => onSectionChange("watchStatus", s)}
      />
      <SearchableTriStateSection
        title="Director"
        items={allDirectors}
        section={filters.director}
        onChange={s => onSectionChange("director", s)}
      />
      <SearchableTriStateSection
        title="Genre"
        items={allGenreLabels}
        section={filters.genre}
        onChange={s => onSectionChange("genre", s)}
      />
    </FilterSidebarShell>
  );
}

// ─── Name list ────────────────────────────────────────────────────────────────

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
            <option value="">— Subgenre —</option>
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

// ─── Copies editor ────────────────────────────────────────────────────────────

function CopiesEditor({ copies, onChange, formatTypes, ownershipStatuses }) {
  const visibleOwnership = ownershipStatuses.filter(s => !HIDDEN_OWNERSHIP_NAMES.has(s.status_name));
  function addCopy() { onChange([...copies, { format_type_id: null, ownership_status_id: null, notes: "" }]); }
  function updateCopy(idx, field, val) { onChange(copies.map((c, i) => i === idx ? { ...c, [field]: val } : c)); }
  function removeCopy(idx) { onChange(copies.filter((_, i) => i !== idx)); }
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

// ─── Seasons editor ───────────────────────────────────────────────────────────

function SeasonsEditor({ seasons, onChange, formatTypes, ownershipStatuses }) {
  const visibleOwnership = ownershipStatuses.filter(s => !HIDDEN_OWNERSHIP_NAMES.has(s.status_name));
  function addSeason() {
    const nextNum = seasons.length > 0 ? Math.max(...seasons.map(s => s.season_number)) + 1 : 1;
    onChange([...seasons, { season_number: nextNum, episode_count: null, format_type_id: null, ownership_status_id: null, notes: "" }]);
  }
  function updateSeason(idx, field, val) { onChange(seasons.map((s, i) => i === idx ? { ...s, [field]: val } : s)); }
  function removeSeason(idx) { onChange(seasons.filter((_, i) => i !== idx)); }
  return (
    <div>
      {seasons.map((s, i) => (
        <div key={i} style={{ display: "grid", gridTemplateColumns: "60px 80px 1fr 1fr auto", gap: 6, marginBottom: 6, alignItems: "end" }}>
          <div>
            <label style={labelStyle}>Season</label>
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

// ─── Edit modal ───────────────────────────────────────────────────────────────

function EditModal({ item, categories, formatTypes, allGenres, ownershipStatuses, watchStatuses, onSave, onClose }) {
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const coverFileRef = useRef(null);

  async function handleCoverFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const { url } = await uploadCover(file, "video", item.item_id);
      set("cover_image_url", url);
    } catch (err) {
      setError(err.message || "Cover upload failed.");
    }
    if (coverFileRef.current) coverFileRef.current.value = "";
  }

  useEffect(() => {
    getVideo(item.item_id).then(detail => {
      setForm({
        title: detail.title || "",
        top_level_category_id: String(detail.top_level_category_id),
        ownership_status_id: String(detail.ownership_status_id),
        reading_status_id: detail.reading_status_id ? String(detail.reading_status_id) : "",
        release_date: detail.release_date || "",
        runtime_minutes: detail.runtime_minutes ? String(detail.runtime_minutes) : "",
        description: detail.description || "",
        cover_image_url: detail.cover_image_url || "",
        notes: detail.notes || "",
        director_names: detail.director_names?.length ? detail.director_names : [""],
        cast_names: detail.cast_names?.length ? detail.cast_names : [""],
        genres: detail.genres || [],
        copies: detail.copies || [],
        seasons: detail.seasons || [],
      });
    }).catch(() => setError("Failed to load details."));
  }, [item.item_id]);

  if (!form) return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
      <div style={{ background: "var(--bg-surface)", borderRadius: 6, padding: 24, minWidth: 300 }}>
        {error ? <div style={alertError}>{error}</div> : <div>Loading…</div>}
        <button onClick={onClose} style={{ ...btnSecondary, marginTop: 12 }}>Close</button>
      </div>
    </div>
  );

  const visibleOwnership = ownershipStatuses.filter(s => !HIDDEN_OWNERSHIP_NAMES.has(s.status_name));
  const selectedCategory = categories.find(c => String(c.top_level_category_id) === String(form.top_level_category_id));
  const isTV = selectedCategory?.category_name === TV_CATEGORY;
  function set(field, val) { setForm(f => ({ ...f, [field]: val })); }

  async function handleSave() {
    if (!form.title.trim()) { setError("Title is required."); return; }
    setSaving(true);
    setError("");
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
        director_names: form.director_names.map(n => n.trim()).filter(Boolean),
        cast_names: form.cast_names.map(n => n.trim()).filter(Boolean),
        genres: form.genres,
        copies: isTV ? [] : form.copies,
        seasons: isTV ? form.seasons : [],
      };
      await updateVideo(item.item_id, payload);
      onSave();
    } catch (e) {
      setError(e.message || "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: "var(--bg-surface)", borderRadius: 6, padding: 20, width: "100%", maxWidth: 680, maxHeight: "90vh", overflow: "auto", boxShadow: "0 4px 24px rgba(0,0,0,0.3)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div style={{ fontWeight: "bold", fontSize: 15 }}>Edit: {item.title}</div>
          <button onClick={onClose} style={{ ...btnSm, fontSize: 14 }}>✕</button>
        </div>
        {error && <div style={alertError}>{error}</div>}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
          <div>
            <label style={labelStyle}>Content Type</label>
            <select value={form.top_level_category_id} onChange={e => setForm(f => ({ ...f, top_level_category_id: e.target.value, copies: [], seasons: [] }))} style={selectStyle}>
              {categories.map(c => <option key={c.top_level_category_id} value={c.top_level_category_id}>{c.category_name}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Ownership</label>
            <select value={form.ownership_status_id} onChange={e => set("ownership_status_id", e.target.value)} style={selectStyle}>
              {visibleOwnership.map(s => <option key={s.ownership_status_id} value={s.ownership_status_id}>{s.status_name}</option>)}
            </select>
          </div>
        </div>

        <div style={{ marginBottom: 10 }}>
          <label style={labelStyle}>Title</label>
          <input value={form.title} onChange={e => set("title", e.target.value)} style={inputStyle} />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 10 }}>
          <div>
            <label style={labelStyle}>Release Date</label>
            <input type="date" value={form.release_date} onChange={e => set("release_date", e.target.value)} style={inputStyle} />
          </div>
          {!isTV && (
            <div>
              <label style={labelStyle}>Runtime (min)</label>
              <input type="number" value={form.runtime_minutes} onChange={e => set("runtime_minutes", e.target.value)} style={inputStyle} min={1} />
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

        <div style={{ marginBottom: 10 }}>
          <label style={labelStyle}>Cover Image URL</label>
          <div style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
            <input value={form.cover_image_url} onChange={e => set("cover_image_url", e.target.value)} style={{ ...inputStyle, flex: 1 }} />
            <input type="file" accept="image/*" ref={coverFileRef} onChange={handleCoverFile} style={{ display: "none" }} />
            <button type="button" onClick={() => coverFileRef.current?.click()} style={{ padding: "4px 10px", fontSize: 12, whiteSpace: "nowrap" }}>Add Image</button>
            {form.cover_image_url && <img src={getImageUrl(form.cover_image_url)} alt="" style={{ height: 48, width: 32, objectFit: "cover", borderRadius: 2 }} />}
          </div>
        </div>

        <div style={{ marginBottom: 10 }}>
          <label style={labelStyle}>Genres</label>
          <GenrePicker allGenres={allGenres} selected={form.genres} onChange={v => set("genres", v)} />
        </div>

        {isTV ? (
          <div style={{ marginBottom: 10 }}>
            <label style={labelStyle}>Seasons</label>
            <SeasonsEditor seasons={form.seasons} onChange={v => set("seasons", v)} formatTypes={formatTypes} ownershipStatuses={ownershipStatuses} />
          </div>
        ) : (
          <div style={{ marginBottom: 10 }}>
            <label style={labelStyle}>Copies / Formats</label>
            <CopiesEditor copies={form.copies} onChange={v => set("copies", v)} formatTypes={formatTypes} ownershipStatuses={ownershipStatuses} />
          </div>
        )}

        <div style={{ marginBottom: 10 }}>
          <label style={labelStyle}>Description</label>
          <textarea value={form.description} onChange={e => set("description", e.target.value)} rows={3} style={{ ...inputStyle, resize: "vertical" }} />
        </div>
        <div style={{ marginBottom: 10 }}>
          <label style={labelStyle}>Notes</label>
          <textarea value={form.notes} onChange={e => set("notes", e.target.value)} rows={2} style={{ ...inputStyle, resize: "vertical" }} />
        </div>

        <div style={{ marginBottom: 10 }}>
          <label style={labelStyle}>Director(s) / Creator(s)</label>
          <NameList names={form.director_names} onChange={v => set("director_names", v)} addLabel="+ Director" placeholder="Director name" />
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={labelStyle}>Cast</label>
          <NameList names={form.cast_names} onChange={v => set("cast_names", v)} addLabel="+ Cast member" placeholder="Cast member name" />
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={handleSave} style={btnPrimary} disabled={saving}>{saving ? "Saving…" : "Save"}</button>
          <button onClick={onClose} style={btnSecondary}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

const EMPTY_FILTERS = {
  search: "",
  category: emptySection(),
  ownership: emptySection(),
  watchStatus: emptySection(),
  director: emptySection(),
  genre: emptySection(),
};

export default function VideoLibraryPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [categories, setCategories] = useState([]);
  const [formatTypes, setFormatTypes] = useState([]);
  const [allGenres, setAllGenres] = useState([]);
  const [ownershipStatuses, setOwnershipStatuses] = useState([]);
  const [watchStatuses, setWatchStatuses] = useState([]);

  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [showThumbs, setShowThumbs] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [editItem, setEditItem] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [bulkFields, setBulkFields] = useState({ ownership_status_id: "", reading_status_id: "" });
  const [bulkSaving, setBulkSaving] = useState(false);

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
    });
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    listVideo().then(data => {
      setItems(data);
      setLoading(false);
    }).catch(() => {
      setError("Failed to load video library.");
      setLoading(false);
    });
  }, []);

  useEffect(() => { load(); }, [load]);

  // ─── Filtering ───────────────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    let result = items;
    const q = filters.search.trim().toLowerCase();
    if (q) {
      result = result.filter(v =>
        v.title.toLowerCase().includes(q) ||
        (v.directors || []).some(d => d.toLowerCase().includes(q))
      );
    }
    if (sectionActive(filters.category)) {
      result = result.filter(v => applySection(filters.category, String(v.top_level_category_id)));
    }
    if (sectionActive(filters.ownership)) {
      result = result.filter(v => applySection(filters.ownership, String(v.ownership_status_id)));
    }
    if (sectionActive(filters.watchStatus)) {
      result = result.filter(v => applySection(filters.watchStatus, String(v.reading_status_id)));
    }
    if (sectionActive(filters.director)) {
      result = result.filter(v => (v.directors || []).some(d => applySection(filters.director, d)));
    }
    if (sectionActive(filters.genre)) {
      result = result.filter(v => (v.genres || []).some(g => applySection(filters.genre, g)));
    }
    return result;
  }, [items, filters]);

  function handleSectionChange(key, val) {
    setFilters(f => ({ ...f, [key]: val }));
    setSelected(new Set());
  }

  function clearAll() {
    setFilters(EMPTY_FILTERS);
    setSelected(new Set());
  }

  // ─── Selection ───────────────────────────────────────────────────────────────

  function toggleSelect(id) {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selected.size === filtered.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map(v => v.item_id)));
    }
  }

  // ─── Delete ──────────────────────────────────────────────────────────────────

  async function handleDelete(itemId) {
    try {
      await deleteVideo(itemId);
      setSuccess("Deleted.");
      setDeleteConfirm(null);
      load();
    } catch (e) {
      setError(e.message || "Delete failed.");
    }
  }

  async function handleBulkDelete() {
    setBulkSaving(true);
    try {
      await bulkDeleteVideo([...selected]);
      setSuccess(`Deleted ${selected.size} item(s).`);
      setSelected(new Set());
      load();
    } catch (e) {
      setError(e.message || "Bulk delete failed.");
    } finally {
      setBulkSaving(false);
    }
  }

  // ─── Bulk edit ───────────────────────────────────────────────────────────────

  async function handleBulkSave() {
    const fields = {};
    if (bulkFields.ownership_status_id) fields.ownership_status_id = parseInt(bulkFields.ownership_status_id);
    if (bulkFields.reading_status_id) fields.reading_status_id = parseInt(bulkFields.reading_status_id);
    if (!Object.keys(fields).length) return;

    setBulkSaving(true);
    try {
      await bulkUpdateVideo([...selected], fields);
      setSuccess(`Updated ${selected.size} item(s).`);
      setBulkEditOpen(false);
      setBulkFields({ ownership_status_id: "", reading_status_id: "" });
      setSelected(new Set());
      load();
    } catch (e) {
      setError(e.message || "Bulk update failed.");
    } finally {
      setBulkSaving(false);
    }
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  function formatSummary(v) {
    if (v.video_type === TV_CATEGORY) {
      return v.season_count > 0 ? `${v.season_count} season${v.season_count !== 1 ? "s" : ""}` : "—";
    }
    return v.copy_formats?.length ? v.copy_formats.join(", ") : (v.copy_count > 0 ? `${v.copy_count} copy` : "—");
  }

  const visibleOwnership = ownershipStatuses.filter(s => !HIDDEN_OWNERSHIP_NAMES.has(s.status_name));

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <div style={{ display: "flex", height: "100%", overflow: "hidden" }}>
      {/* Sidebar */}
      <div style={{ width: 200, flexShrink: 0, overflowY: "auto", borderRight: "1px solid var(--border)", padding: "10px 8px", background: "var(--bg-sidebar)" }}>
        <VideoFilters
          items={items}
          ownershipStatuses={ownershipStatuses}
          watchStatuses={watchStatuses}
          categories={categories}
          allGenres={allGenres}
          filters={filters}
          onSectionChange={handleSectionChange}
          onClearAll={clearAll}
        />
      </div>

      {/* Main */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {/* Toolbar */}
        <div style={{ padding: "8px 12px", borderBottom: "1px solid var(--border)", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", background: "var(--bg-surface)" }}>
          <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>
            {filtered.length} of {items.length}
          </span>
          <button onClick={() => setShowThumbs(t => !t)} style={btnSecondary}>
            {showThumbs ? "Hide Covers" : "Show Covers"}
          </button>
          {selected.size > 0 && (
            <>
              <span style={{ fontSize: 13 }}>{selected.size} selected</span>
              <button onClick={() => setBulkEditOpen(true)} style={btnSecondary}>Bulk Edit</button>
              <button onClick={handleBulkDelete} style={btnDanger} disabled={bulkSaving}>
                {bulkSaving ? "Deleting…" : `Delete ${selected.size}`}
              </button>
            </>
          )}
        </div>

        {error && <div style={{ ...alertError, margin: "8px 12px" }}>{error}</div>}
        {success && <div style={{ ...alertSuccess, margin: "8px 12px" }}>{success}</div>}

        {/* Table */}
        <div style={{ flex: 1, overflowY: "auto", padding: "0 12px 12px" }}>
          {loading ? (
            <div style={{ padding: 20, color: "var(--text-secondary)" }}>Loading…</div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: 20, color: "var(--text-secondary)" }}>No items found.</div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "var(--table-header-bg)" }}>
                  <th style={{ padding: "6px 8px", textAlign: "left", whiteSpace: "nowrap" }}>
                    <input type="checkbox" checked={selected.size > 0 && selected.size === filtered.length} onChange={toggleSelectAll} />
                  </th>
                  {showThumbs && <th style={{ padding: "6px 8px" }}></th>}
                  <th style={{ padding: "6px 8px", textAlign: "left" }}>Title</th>
                  <th style={{ padding: "6px 8px", textAlign: "left" }}>Type</th>
                  <th style={{ padding: "6px 8px", textAlign: "left" }}>Year</th>
                  <th style={{ padding: "6px 8px", textAlign: "left" }}>Director(s)</th>
                  <th style={{ padding: "6px 8px", textAlign: "left" }}>Watch Status</th>
                  <th style={{ padding: "6px 8px", textAlign: "left" }}>Ownership</th>
                  <th style={{ padding: "6px 8px", textAlign: "left" }}>Copies / Seasons</th>
                  <th style={{ padding: "6px 8px" }}></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((v, idx) => (
                  <tr
                    key={v.item_id}
                    style={{ background: selected.has(v.item_id) ? "var(--row-selected)" : idx % 2 === 0 ? "var(--table-row-even)" : "var(--table-row-odd)", cursor: "pointer" }}
                    onClick={() => setEditItem(v)}
                  >
                    <td style={{ padding: "5px 8px" }} onClick={e => e.stopPropagation()}>
                      <input type="checkbox" checked={selected.has(v.item_id)} onChange={() => toggleSelect(v.item_id)} />
                    </td>
                    {showThumbs && (
                      <td style={{ padding: "3px 6px" }}>
                        {getImageUrl(v.cover_image_url)
                          ? <img src={getImageUrl(v.cover_image_url)} alt="" style={{ width: 24, height: 36, objectFit: "cover", borderRadius: 2 }} />
                          : <div style={{ width: 24, height: 36, background: "var(--border)", borderRadius: 2 }} />
                        }
                      </td>
                    )}
                    <td style={{ padding: "5px 8px", fontWeight: 500 }}>{v.title}</td>
                    <td style={{ padding: "5px 8px", color: "var(--text-secondary)" }}>{v.video_type}</td>
                    <td style={{ padding: "5px 8px", color: "var(--text-secondary)" }}>{v.release_date ? v.release_date.slice(0, 4) : "—"}</td>
                    <td style={{ padding: "5px 8px" }}>{v.directors?.join(", ") || "—"}</td>
                    <td style={{ padding: "5px 8px" }}>{v.watch_status || "—"}</td>
                    <td style={{ padding: "5px 8px" }}>{v.ownership_status}</td>
                    <td style={{ padding: "5px 8px", color: "var(--text-secondary)" }}>{formatSummary(v)}</td>
                    <td style={{ padding: "5px 8px" }} onClick={e => e.stopPropagation()}>
                      <div style={{ display: "flex", gap: 4 }}>
                        <button onClick={() => setEditItem(v)} style={btnSm}>Edit</button>
                        <button onClick={() => setDeleteConfirm(v)} style={{ ...btnSm, color: "#c62828" }}>Del</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Edit modal */}
      {editItem && (
        <EditModal
          item={editItem}
          categories={categories}
          formatTypes={formatTypes}
          allGenres={allGenres}
          ownershipStatuses={ownershipStatuses}
          watchStatuses={watchStatuses}
          onSave={() => { setEditItem(null); setSuccess("Saved."); load(); }}
          onClose={() => setEditItem(null)}
        />
      )}

      {/* Delete confirm */}
      {deleteConfirm && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <div style={{ background: "var(--bg-surface)", borderRadius: 6, padding: 20, maxWidth: 360 }}>
            <div style={{ marginBottom: 12 }}>Delete <strong>{deleteConfirm.title}</strong>?</div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => handleDelete(deleteConfirm.item_id)} style={btnDanger}>Delete</button>
              <button onClick={() => setDeleteConfirm(null)} style={btnSecondary}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk edit panel */}
      {bulkEditOpen && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <div style={{ background: "var(--bg-surface)", borderRadius: 6, padding: 20, maxWidth: 400, width: "100%" }}>
            <div style={{ fontWeight: "bold", marginBottom: 12 }}>Bulk Edit ({selected.size} items)</div>
            <div style={{ marginBottom: 10 }}>
              <label style={labelStyle}>Ownership Status</label>
              <select value={bulkFields.ownership_status_id} onChange={e => setBulkFields(f => ({ ...f, ownership_status_id: e.target.value }))} style={selectStyle}>
                <option value="">— No change —</option>
                {visibleOwnership.map(s => <option key={s.ownership_status_id} value={s.ownership_status_id}>{s.status_name}</option>)}
              </select>
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={labelStyle}>Watch Status</label>
              <select value={bulkFields.reading_status_id} onChange={e => setBulkFields(f => ({ ...f, reading_status_id: e.target.value }))} style={selectStyle}>
                <option value="">— No change —</option>
                {watchStatuses.map(s => <option key={s.read_status_id} value={s.read_status_id}>{s.status_name}</option>)}
              </select>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={handleBulkSave} style={btnPrimary} disabled={bulkSaving}>{bulkSaving ? "Saving…" : "Apply"}</button>
              <button onClick={() => setBulkEditOpen(false)} style={btnSecondary}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
