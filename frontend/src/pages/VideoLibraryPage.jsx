import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  emptySection,
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
  fetchConsumptionStatuses,
  getVideo,
  listVideo,
  updateVideo,
  uploadCover,
} from "../api";
import { getImageUrl } from "../utils/imageUrl";
import { labelStyle, inputStyle, selectStyle, btnPrimary, btnSecondary, btnSm, btnDanger, alertError, GRID_SIZES } from "../styles/commonStyles";
import NameList from "../components/shared/NameList";
import { ToggleButton, SegmentedButtons } from "../components/shared/SegmentedButtons";
import { COLLECTION_TYPE_IDS } from "../constants/collectionTypes";

const TV_CATEGORY = "TV Series";

const OWNERSHIP_BADGE_COLORS = {
  O: "#00ff66", W: "#ffd600", T: "#ff3b3b", B: "#00bfff",
};

function OwnershipBadge({ statusName }) {
  if (!statusName) return null;
  const initial = statusName[0].toUpperCase();
  const color = OWNERSHIP_BADGE_COLORS[initial] || "#ffffff";
  return (
    <div style={{
      position: "absolute", bottom: 4, left: 4,
      background: "#000", color,
      fontWeight: 700, fontSize: 12, lineHeight: "12px",
      padding: "3px 5px", borderRadius: 4, zIndex: 2,
    }}>
      {initial}
    </div>
  );
}

// ─── Filter sidebar ───────────────────────────────────────────────────────────

function VideoFilters({ items, ownershipStatuses, watchStatuses, categories, filters, onSectionChange, onClearAll }) {
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
        defaultShown={2}
        items={ownershipStatuses.map(s => ({ id: String(s.ownership_status_id), label: s.status_name }))}
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
          <span key={i} style={{ fontSize: 11, background: "var(--green-light)", border: "1px solid var(--border-input)", borderRadius: 10, padding: "1px 8px", display: "flex", gap: 4, alignItems: "center", color: "var(--green)" }}>
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
              {ownershipStatuses.map(s => <option key={s.ownership_status_id} value={s.ownership_status_id}>{s.status_name}</option>)}
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
              {ownershipStatuses.map(st => <option key={st.ownership_status_id} value={st.ownership_status_id}>{st.status_name}</option>)}
            </select>
          </div>
          <button type="button" onClick={() => removeSeason(i)} style={{ ...btnSm, color: "#c62828", alignSelf: "flex-end", marginBottom: 1 }}>✕</button>
        </div>
      ))}
      <button type="button" onClick={addSeason} style={btnSm}>+ Add Season</button>
    </div>
  );
}

// ─── Grid item ────────────────────────────────────────────────────────────────

const VideoGridItem = memo(function VideoGridItem({ video, isSelected, onToggleSelect, onClick, gridSize, showCaptions }) {
  const { w, h } = GRID_SIZES[gridSize];
  return (
    <div onClick={(e) => { if (e.target.type !== "checkbox") onClick(); }} style={{
      position: "relative", cursor: "pointer", width: w, flexShrink: 0,
      outline: isSelected ? "2px solid var(--selection-border)" : "2px solid transparent",
      borderRadius: 3, boxSizing: "border-box",
    }}>
      <div style={{ position: "relative", width: w, height: h }}>
        <div style={{ position: "absolute", top: 4, left: 4, zIndex: 2 }}>
          <input type="checkbox" checked={isSelected}
            onChange={() => onToggleSelect(video.item_id)}
            onClick={(e) => e.stopPropagation()}
            style={{ margin: 0, cursor: "pointer" }} />
        </div>
        <OwnershipBadge statusName={video.ownership_status} />
        {video.cover_image_url ? (
          <img src={getImageUrl(video.cover_image_url)} alt="" style={{ width: w, height: h, objectFit: "cover", display: "block", borderRadius: 2 }} />
        ) : (
          <div style={{ width: w, height: h, background: "var(--bg-surface)", borderRadius: 2, border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ fontSize: 10, color: "var(--text-muted)" }}>No Cover</span>
          </div>
        )}
      </div>
      {showCaptions && (
        <div style={{ padding: "3px 2px 0", maxWidth: w }}>
          <div style={{ fontSize: 11, fontWeight: "700", lineHeight: "1.3", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-primary)" }}>{video.title}</div>
          <div style={{ fontSize: 10, color: "var(--text-muted)", lineHeight: "1.3", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {(video.directors || []).join(", ") || (video.release_date?.slice(0, 4) || "")}
          </div>
        </div>
      )}
    </div>
  );
});

// ─── Detail modal ─────────────────────────────────────────────────────────────

function VideoDetailModal({ item, categories, formatTypes, allGenres, ownershipStatuses, watchStatuses, onSaved, onDeleted, onClose }) {
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
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

  function set(field, val) { setForm(f => ({ ...f, [field]: val })); }

  const selectedCategory = form ? categories.find(c => String(c.top_level_category_id) === String(form.top_level_category_id)) : null;
  const isTV = selectedCategory?.category_name === TV_CATEGORY;

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
      onSaved();
    } catch (e) {
      setError(e.message || "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      await deleteVideo(item.item_id);
      onDeleted(item.item_id);
    } catch (e) {
      setError(e.message || "Delete failed.");
      setConfirmDelete(false);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: "#fff", borderRadius: 6, width: 700, maxWidth: "95vw", maxHeight: "90vh", display: "flex", flexDirection: "column", boxShadow: "0 4px 24px rgba(0,0,0,0.18)" }}>
        <div style={{ padding: "12px 16px", borderBottom: "1px solid #e0e0e0", display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
          <div style={{ fontWeight: "bold", fontSize: 14 }}>{!form ? "Loading..." : form.title || "Video Detail"}</div>
          <button type="button" onClick={onClose} style={{ ...btnSm, fontSize: 14, padding: "2px 8px" }}>✕</button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
          {!form && !error && <div style={{ color: "#999" }}>Loading…</div>}
          {error && <div style={alertError}>{error}</div>}

          {form && (
            <>
              {form.cover_image_url && (
                <div style={{ display: "flex", gap: 12, marginBottom: 14 }}>
                  <img src={getImageUrl(form.cover_image_url)} alt="cover" style={{ height: 100, width: "auto", borderRadius: 3, border: "1px solid #ddd", flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: "bold", fontSize: 14, marginBottom: 2 }}>{form.title}</div>
                    <div style={{ fontSize: 12, color: "#555" }}>{form.director_names.filter(Boolean).join(", ")}</div>
                  </div>
                </div>
              )}

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
                    {ownershipStatuses.map(s => <option key={s.ownership_status_id} value={s.ownership_status_id}>{s.status_name}</option>)}
                  </select>
                </div>
              </div>

              <div style={{ marginBottom: 10 }}>
                <label style={labelStyle}>Title *</label>
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
                  {form.cover_image_url && <img src={getImageUrl(form.cover_image_url)} alt="" style={{ height: 40, width: "auto", borderRadius: 2, border: "1px solid #ddd", flexShrink: 0 }} />}
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

              <div style={{ marginBottom: 10 }}>
                <label style={labelStyle}>Cast</label>
                <NameList names={form.cast_names} onChange={v => set("cast_names", v)} addLabel="+ Cast member" placeholder="Cast member name" />
              </div>
            </>
          )}
        </div>

        {form && (
          <div style={{ padding: "10px 16px", borderTop: "1px solid #e0e0e0", display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
            <div>
              {!confirmDelete
                ? <button type="button" onClick={() => setConfirmDelete(true)} style={btnDanger}>Delete</button>
                : <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <span style={{ fontSize: 12, color: "#c62828" }}>Delete this video?</span>
                    <button type="button" onClick={handleDelete} disabled={deleting} style={btnDanger}>{deleting ? "Deleting..." : "Confirm"}</button>
                    <button type="button" onClick={() => setConfirmDelete(false)} style={btnSecondary}>Cancel</button>
                  </div>
              }
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" onClick={onClose} style={btnSecondary}>Cancel</button>
              <button type="button" onClick={handleSave} disabled={saving} style={btnPrimary}>{saving ? "Saving..." : "Save"}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Bulk edit modal ──────────────────────────────────────────────────────────

function BulkField({ label, enabled, onToggle, children }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ display: "flex", alignItems: "center", cursor: "pointer" }}>
        <input type="checkbox" checked={enabled} onChange={onToggle} style={{ marginRight: 8 }} />
        <span style={{ fontWeight: "bold", fontSize: 13 }}>{label}</span>
      </label>
      {enabled && <div style={{ marginTop: 5, paddingLeft: 24 }}>{children}</div>}
    </div>
  );
}

function VideoBulkEdit({ selectedIds, ownershipStatuses, watchStatuses, onClose, onSaved, onDeleted }) {
  const fieldStyle = { width: "100%", padding: "5px 6px", fontSize: 13, border: "1px solid #ccc", borderRadius: 3 };

  const [updateOwnership, setUpdateOwnership] = useState(false);
  const [ownershipId, setOwnershipId] = useState(String(ownershipStatuses[0]?.ownership_status_id || ""));
  const [updateWatchStatus, setUpdateWatchStatus] = useState(false);
  const [watchStatusId, setWatchStatusId] = useState(String(watchStatuses[0]?.read_status_id || ""));

  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState("");

  const anyEnabled = updateOwnership || updateWatchStatus;

  async function handleSave() {
    if (!anyEnabled) { setError("Select at least one field to update."); return; }
    const fields = {};
    if (updateOwnership) fields.ownership_status_id = Number(ownershipId);
    if (updateWatchStatus) fields.reading_status_id = Number(watchStatusId);
    setSaving(true); setError("");
    try { await bulkUpdateVideo(selectedIds, fields); onSaved(); }
    catch (err) { setError(err.message || "Failed to update"); }
    finally { setSaving(false); }
  }

  async function handleDelete() {
    if (!confirmDelete) { setConfirmDelete(true); return; }
    setDeleting(true);
    try { await bulkDeleteVideo(selectedIds); onDeleted(); }
    catch (err) { setError(err.message || "Failed to delete"); setConfirmDelete(false); }
    finally { setDeleting(false); }
  }

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: "#fff", border: "1px solid #ddd", borderRadius: 6, width: 420, maxHeight: "85vh", display: "flex", flexDirection: "column", boxShadow: "0 2px 12px rgba(0,0,0,0.15)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", borderBottom: "1px solid #e0e0e0", flexShrink: 0 }}>
          <span style={{ fontWeight: "bold", fontSize: 14 }}>Bulk Edit — {selectedIds.length} video{selectedIds.length !== 1 ? "s" : ""}</span>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 15, cursor: "pointer", color: "#666" }}>✕</button>
        </div>
        {error && <div style={{ margin: "8px 14px 0", padding: "7px 10px", background: "#ffebee", border: "1px solid #c62828", borderRadius: 3, fontSize: 13, color: "#c62828", flexShrink: 0 }}>{error}</div>}
        <div style={{ padding: "12px 14px", overflowY: "auto", flex: 1 }}>
          <BulkField label="Ownership" enabled={updateOwnership} onToggle={() => setUpdateOwnership((p) => !p)}>
            <select value={ownershipId} onChange={(e) => setOwnershipId(e.target.value)} style={fieldStyle}>
              {ownershipStatuses.map((s) => <option key={s.ownership_status_id} value={s.ownership_status_id}>{s.status_name}</option>)}
            </select>
          </BulkField>
          <BulkField label="Watch Status" enabled={updateWatchStatus} onToggle={() => setUpdateWatchStatus((p) => !p)}>
            <select value={watchStatusId} onChange={(e) => setWatchStatusId(e.target.value)} style={fieldStyle}>
              {watchStatuses.map((s) => <option key={s.read_status_id} value={s.read_status_id}>{s.status_name}</option>)}
            </select>
          </BulkField>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", borderTop: "1px solid #e0e0e0", flexShrink: 0 }}>
          <div>
            {!confirmDelete
              ? <button onClick={handleDelete} disabled={deleting || saving} style={{ padding: "5px 12px", fontSize: 13, cursor: "pointer", border: "1px solid #c62828", borderRadius: 3, background: "#fff", color: "#c62828" }}>Delete {selectedIds.length} video{selectedIds.length !== 1 ? "s" : ""}</button>
              : <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                  <span style={{ color: "#c62828", fontWeight: "bold" }}>Delete {selectedIds.length}?</span>
                  <button onClick={handleDelete} disabled={deleting} style={{ padding: "5px 10px", fontSize: 13, cursor: "pointer", border: "none", borderRadius: 3, background: "#c62828", color: "#fff" }}>{deleting ? "..." : "Yes"}</button>
                  <button onClick={() => setConfirmDelete(false)} style={{ padding: "5px 10px", fontSize: 13, cursor: "pointer", border: "1px solid #ccc", borderRadius: 3, background: "#fff" }}>No</button>
                </span>
            }
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={onClose} style={{ padding: "5px 12px", fontSize: 13, cursor: "pointer", border: "1px solid #ccc", borderRadius: 3, background: "#fff" }}>Cancel</button>
            <button onClick={handleSave} disabled={saving || deleting} style={{ padding: "5px 16px", fontSize: 13, cursor: "pointer", border: "1px solid #1565c0", borderRadius: 3, background: "#1565c0", color: "#fff", fontWeight: "bold" }}>{saving ? "Saving..." : `Apply to ${selectedIds.length}`}</button>
          </div>
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

  const [categories, setCategories] = useState([]);
  const [formatTypes, setFormatTypes] = useState([]);
  const [allGenres, setAllGenres] = useState([]);
  const [ownershipStatuses, setOwnershipStatuses] = useState([]);
  const [watchStatuses, setWatchStatuses] = useState([]);

  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [selected, setSelected] = useState(new Set());
  const [editItem, setEditItem] = useState(null);
  const [bulkEditOpen, setBulkEditOpen] = useState(false);

  const [viewMode, setViewMode] = useState("table");
  const [showThumbnails, setShowThumbnails] = useState(false);
  const [gridSize, setGridSize] = useState("m");
  const [showCaptions, setShowCaptions] = useState(true);

  const [sortField, setSortField] = useState("title");
  const [sortDir, setSortDir] = useState("asc");

  const [colWidths, setColWidths] = useState({
    title: 220, type: 90, year: 70, director: 150, watch: 110, ownership: 100, formats: 140,
  });
  const colResizingRef = useRef(false);

  const makeResizeHandler = useCallback((col) => (e) => {
    e.preventDefault();
    colResizingRef.current = true;
    const startX = e.clientX;
    const startW = colWidths[col];
    function onMove(ev) {
      setColWidths((prev) => ({ ...prev, [col]: Math.max(50, startW + ev.clientX - startX) }));
    }
    function onUp() {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      setTimeout(() => { colResizingRef.current = false; }, 0);
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [colWidths]);

  function handleHeaderSort(field) {
    if (field === sortField) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortField(field); setSortDir("asc"); }
  }

  function sortIndicator(field) {
    if (field !== sortField) return " ⇅";
    return sortDir === "asc" ? " ▲" : " ▼";
  }

  useEffect(() => {
    Promise.all([
      fetchVideoCategories(),
      fetchVideoFormatTypes(),
      fetchVideoGenres(),
      fetchOwnershipStatuses(COLLECTION_TYPE_IDS.video),
      fetchConsumptionStatuses(COLLECTION_TYPE_IDS.video),
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

  const sorted = useMemo(() => {
    const arr = [...filtered];
    const flip = sortDir === "desc" ? -1 : 1;
    switch (sortField) {
      case "type":
        return arr.sort((a, b) => flip * ((a.video_type || "").localeCompare(b.video_type || "")));
      case "year":
        return arr.sort((a, b) => flip * ((a.release_date || "").localeCompare(b.release_date || "")));
      case "watch":
        return arr.sort((a, b) => flip * ((a.watch_status || "").localeCompare(b.watch_status || "")));
      case "ownership":
        return arr.sort((a, b) => flip * ((a.ownership_status || "").localeCompare(b.ownership_status || "")));
      default:
        return arr.sort((a, b) => flip * ((a.title_sort || a.title || "").localeCompare(b.title_sort || b.title || "")));
    }
  }, [filtered, sortField, sortDir]);

  function handleSectionChange(key, val) {
    setFilters(f => ({ ...f, [key]: val }));
  }

  function clearAll() {
    setFilters(EMPTY_FILTERS);
  }

  function toggleSelect(id) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function clearSelection() { setSelected(new Set()); }

  function toggleSelectAll() {
    if (sorted.length > 0 && sorted.every(v => selected.has(v.item_id))) clearSelection();
    else setSelected(new Set(sorted.map(v => v.item_id)));
  }

  const allVisibleSelected = sorted.length > 0 && sorted.every(v => selected.has(v.item_id));

  function formatSummary(v) {
    if (v.video_type === TV_CATEGORY) {
      return v.season_count > 0 ? `${v.season_count} season${v.season_count !== 1 ? "s" : ""}` : "—";
    }
    return v.copy_formats?.length ? v.copy_formats.join(", ") : (v.copy_count > 0 ? `${v.copy_count} copy` : "—");
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden", fontSize: 13 }}>
      {/* Controls bar */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 12px", borderBottom: "1px solid var(--border)", background: "var(--bg-sidebar)", flexShrink: 0, gap: 8, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>
            {loading ? "Loading…" : `${sorted.length} of ${items.length}`}
          </span>
          {selected.size > 0 && (
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 12, color: "var(--btn-primary-bg)", fontWeight: "bold" }}>{selected.size} selected</span>
              <button onClick={() => setBulkEditOpen(true)} style={{ ...btnPrimary, fontSize: 12, padding: "3px 10px" }}>Edit</button>
              <button onClick={clearSelection} style={{ ...btnSecondary, fontSize: 12, padding: "3px 8px" }}>Clear</button>
            </span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <SegmentedButtons
            options={[{ value: "table", label: "Table" }, { value: "grid", label: "Grid" }]}
            value={viewMode} onChange={setViewMode} />
          {viewMode === "table" && (
            <ToggleButton active={showThumbnails} onClick={() => setShowThumbnails(p => !p)}>Thumbnails</ToggleButton>
          )}
          {viewMode === "grid" && (
            <>
              <SegmentedButtons
                options={[{ value: "s", label: "S" }, { value: "m", label: "M" }, { value: "l", label: "L" }]}
                value={gridSize} onChange={setGridSize} />
              <ToggleButton active={showCaptions} onClick={() => setShowCaptions(p => !p)}>Captions</ToggleButton>
            </>
          )}
        </div>
      </div>

      {error && <div style={{ ...alertError, margin: "8px 12px" }}>{error}</div>}

      {/* Main layout */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        <VideoFilters
          items={items}
          ownershipStatuses={ownershipStatuses}
          watchStatuses={watchStatuses}
          categories={categories}
          filters={filters}
          onSectionChange={handleSectionChange}
          onClearAll={clearAll}
        />

        <div style={{ flex: 1, overflowY: "auto", overflowX: "auto", padding: 0 }}>
          {loading ? (
            <div style={{ padding: 20, color: "var(--text-secondary)" }}>Loading…</div>
          ) : sorted.length === 0 ? (
            <div style={{ padding: 20, color: "var(--text-secondary)" }}>No items found.</div>
          ) : viewMode === "grid" ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, padding: 12, alignContent: "flex-start" }}>
              {sorted.map(v => (
                <VideoGridItem key={v.item_id} video={v}
                  isSelected={selected.has(v.item_id)}
                  onToggleSelect={toggleSelect}
                  onClick={() => setEditItem(v)}
                  gridSize={gridSize} showCaptions={showCaptions} />
              ))}
            </div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, tableLayout: "fixed" }}>
              <colgroup>
                <col style={{ width: 28 }} />
                {showThumbnails && <col style={{ width: 50 }} />}
                <col style={{ width: colWidths.title }} />
                <col style={{ width: colWidths.type }} />
                <col style={{ width: colWidths.year }} />
                <col style={{ width: colWidths.director }} />
                <col style={{ width: colWidths.watch }} />
                <col style={{ width: colWidths.ownership }} />
                <col style={{ width: colWidths.formats }} />
              </colgroup>
              <thead style={{ position: "sticky", top: 0, zIndex: 2 }}>
                <tr style={{ background: "var(--bg-sidebar)", borderBottom: "1px solid var(--border)" }}>
                  <th style={{ padding: "5px 6px", textAlign: "center", borderRight: "1px solid var(--border)" }}>
                    <input type="checkbox" checked={allVisibleSelected} onChange={toggleSelectAll} style={{ margin: 0, cursor: "pointer" }} />
                  </th>
                  {showThumbnails && <th style={{ padding: "5px 6px", borderRight: "1px solid var(--border)" }} />}
                  {[
                    { key: "title", label: "Title", colKey: "title" },
                    { key: "type", label: "Type", colKey: "type" },
                    { key: "year", label: "Year", colKey: "year" },
                    { key: null, label: "Director(s)", colKey: "director" },
                    { key: "watch", label: "Watch Status", colKey: "watch" },
                    { key: "ownership", label: "Ownership", colKey: "ownership" },
                    { key: null, label: "Copies / Seasons", colKey: "formats" },
                  ].map(({ key, label, colKey }) => (
                    <th
                      key={label}
                      onClick={key ? () => { if (!colResizingRef.current) handleHeaderSort(key); } : undefined}
                      style={{
                        padding: "5px 8px",
                        textAlign: "left",
                        position: "relative",
                        userSelect: "none",
                        cursor: key ? "pointer" : "default",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        borderRight: "1px solid var(--border)",
                      }}
                    >
                      {label}{key ? sortIndicator(key) : ""}
                      <div
                        onMouseDown={makeResizeHandler(colKey)}
                        style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: 5, cursor: "col-resize", zIndex: 1 }}
                      />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map(v => {
                  const isSelected = selected.has(v.item_id);
                  return (
                    <tr
                      key={v.item_id}
                      onClick={() => setEditItem(v)}
                      style={{ cursor: "pointer", borderBottom: "1px solid var(--border)", background: isSelected ? "var(--green-light)" : undefined }}
                      onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = "var(--bg-surface)"; }}
                      onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = ""; }}
                    >
                      <td style={{ padding: "3px 6px", verticalAlign: "middle", width: 28 }} onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(v.item_id)} style={{ margin: 0, cursor: "pointer" }} />
                      </td>
                      {showThumbnails && (
                        <td style={{ padding: "3px 6px", verticalAlign: "middle", width: 50 }}>
                          {v.cover_image_url
                            ? <img src={getImageUrl(v.cover_image_url)} alt="" style={{ width: 42, height: 60, objectFit: "cover", borderRadius: 2, border: "1px solid var(--border)", display: "block" }} />
                            : <div style={{ width: 42, height: 60, background: "var(--bg-surface)", borderRadius: 2 }} />}
                        </td>
                      )}
                      <td style={{ padding: "3px 8px", fontWeight: 500, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{v.title}</td>
                      <td style={{ padding: "3px 8px", fontSize: 12, color: "var(--text-secondary)", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{v.video_type}</td>
                      <td style={{ padding: "3px 8px", fontSize: 12, color: "var(--text-secondary)", whiteSpace: "nowrap" }}>{v.release_date ? v.release_date.slice(0, 4) : "—"}</td>
                      <td style={{ padding: "3px 8px", fontSize: 12, color: "var(--text-secondary)", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{v.directors?.join(", ") || "—"}</td>
                      <td style={{ padding: "3px 8px", fontSize: 12, color: "var(--text-secondary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{v.watch_status || "—"}</td>
                      <td style={{ padding: "3px 8px", fontSize: 12, color: "var(--text-secondary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{v.ownership_status}</td>
                      <td style={{ padding: "3px 8px", fontSize: 12, color: "var(--text-secondary)", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{formatSummary(v)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {editItem && (
        <VideoDetailModal
          item={editItem}
          categories={categories}
          formatTypes={formatTypes}
          allGenres={allGenres}
          ownershipStatuses={ownershipStatuses}
          watchStatuses={watchStatuses}
          onSaved={() => { setEditItem(null); load(); }}
          onDeleted={(id) => {
            setEditItem(null);
            setItems(prev => prev.filter(v => v.item_id !== id));
            setSelected(prev => { const next = new Set(prev); next.delete(id); return next; });
          }}
          onClose={() => setEditItem(null)}
        />
      )}

      {bulkEditOpen && (
        <VideoBulkEdit
          selectedIds={[...selected]}
          ownershipStatuses={ownershipStatuses}
          watchStatuses={watchStatuses}
          onClose={() => setBulkEditOpen(false)}
          onSaved={async () => { setBulkEditOpen(false); clearSelection(); load(); }}
          onDeleted={async () => { setBulkEditOpen(false); clearSelection(); load(); }}
        />
      )}
    </div>
  );
}
