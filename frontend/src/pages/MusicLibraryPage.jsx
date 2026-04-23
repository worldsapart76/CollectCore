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
  bulkDeleteMusic,
  bulkUpdateMusic,
  deleteMusicRelease,
  fetchMusicFormatTypes,
  fetchMusicGenres,
  fetchMusicReleaseTypes,
  fetchOwnershipStatuses,
  getMusicRelease,
  listMusicReleases,
  updateMusicRelease,
  uploadCover,
} from "../api";
import { getImageUrl } from "../utils/imageUrl";
import { labelStyle, inputStyle, selectStyle, btnPrimary, btnSecondary, btnSm, btnDanger, alertError, sectionStyle, sectionLabel, GRID_SIZES } from "../styles/commonStyles";
import { ToggleButton, SegmentedButtons } from "../components/shared/SegmentedButtons";
import { COLLECTION_TYPE_IDS } from "../constants/collectionTypes";

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

function MusicFilters({ items, ownershipStatuses, releaseTypes, filters, onSectionChange, onClearAll }) {
  const allArtists = useMemo(() => {
    const seen = new Set();
    const result = [];
    for (const r of items) for (const a of (r.artists || [])) if (a && !seen.has(a)) { seen.add(a); result.push(a); }
    return result.sort().map(a => ({ id: a, label: a }));
  }, [items]);

  const allGenreLabels = useMemo(() => {
    const seen = new Set();
    const result = [];
    for (const r of items) for (const g of (r.genres || [])) if (g && !seen.has(g)) { seen.add(g); result.push(g); }
    return result.sort().map(g => ({ id: g, label: g }));
  }, [items]);

  const allFormats = useMemo(() => {
    const seen = new Set();
    const result = [];
    for (const r of items) for (const f of (r.formats || [])) if (f && !seen.has(f)) { seen.add(f); result.push(f); }
    return result.sort().map(f => ({ id: f, label: f }));
  }, [items]);

  const hasFilters = filters.search.trim() ||
    sectionActive(filters.ownership) || sectionActive(filters.releaseType) ||
    sectionActive(filters.artist) || sectionActive(filters.genre) || sectionActive(filters.format);

  return (
    <FilterSidebarShell
      hasFilters={hasFilters}
      onClearAll={onClearAll}
      searchValue={filters.search}
      onSearch={v => onSectionChange("search", v)}
      searchPlaceholder="Search title…"
    >
      <TriStateFilterSection
        title="Ownership"
        defaultShown={2}
        items={ownershipStatuses.map(s => ({ id: s.ownership_status_id, label: s.status_name }))}
        section={filters.ownership}
        onChange={s => onSectionChange("ownership", s)}
      />
      <TriStateFilterSection
        title="Release Type"
        items={releaseTypes.map(r => ({ id: r.top_level_category_id, label: r.category_name }))}
        section={filters.releaseType}
        onChange={s => onSectionChange("releaseType", s)}
      />
      <TriStateFilterSection
        title="Format"
        items={allFormats}
        section={filters.format}
        onChange={s => onSectionChange("format", s)}
      />
      <SearchableTriStateSection
        title="Genre"
        items={allGenreLabels}
        section={filters.genre}
        onChange={s => onSectionChange("genre", s)}
      />
      <SearchableTriStateSection
        title="Artist"
        items={allArtists}
        section={filters.artist}
        onChange={s => onSectionChange("artist", s)}
      />
    </FilterSidebarShell>
  );
}

// ─── Genre picker (edit modal) ────────────────────────────────────────────────

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
      if (!selected.find(g => `${g.top_genre_id}-${g.sub_genre_id}` === `${topId}-null`)) {
        onChange([...selected, { top_genre_id: topId, sub_genre_id: null }]);
      }
      setTopSel("");
    }
  }

  return (
    <div>
      <div style={{ display: "flex", gap: 6, marginBottom: 6, flexWrap: "wrap" }}>
        <select value={topSel} onChange={e => handleTopChange(e.target.value)} style={{ ...selectStyle, width: "auto", minWidth: 130 }}>
          <option value="">Genre…</option>
          {allGenres.map(g => <option key={g.top_genre_id} value={g.top_genre_id}>{g.genre_name}</option>)}
        </select>
        {subGenres.length > 0 && (
          <>
            <select value={subSel} onChange={e => setSubSel(e.target.value)} style={{ ...selectStyle, width: "auto", minWidth: 130 }}>
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

// ─── Track list editor (edit modal) ──────────────────────────────────────────

function formatDuration(seconds) {
  if (!seconds) return "";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function parseDuration(str) {
  if (!str) return null;
  str = str.trim();
  if (/^\d+$/.test(str)) return parseInt(str, 10);
  const m = str.match(/^(\d+):(\d{1,2})$/);
  if (m) return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  return null;
}

function TrackListEditor({ songs, onChange }) {
  function update(idx, key, val) {
    const next = [...songs];
    next[idx] = { ...next[idx], [key]: val };
    onChange(next);
  }
  function add() { onChange([...songs, { title: "", duration_seconds: null, track_number: songs.length + 1, disc_number: 1 }]); }
  function remove(idx) { onChange(songs.filter((_, i) => i !== idx)); }

  return (
    <div>
      {songs.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "28px 1fr 60px 40px 24px", gap: 4, marginBottom: 4, alignItems: "center" }}>
          <span style={{ fontSize: 10, color: "var(--text-secondary)", textAlign: "center" }}>#</span>
          <span style={{ fontSize: 10, color: "var(--text-secondary)" }}>Title</span>
          <span style={{ fontSize: 10, color: "var(--text-secondary)" }}>Duration</span>
          <span style={{ fontSize: 10, color: "var(--text-secondary)" }}>Disc</span>
          <span />
        </div>
      )}
      {songs.map((s, i) => (
        <div key={i} style={{ display: "grid", gridTemplateColumns: "28px 1fr 60px 40px 24px", gap: 4, marginBottom: 4, alignItems: "center" }}>
          <input
            value={s.track_number || ""}
            onChange={e => update(i, "track_number", e.target.value)}
            style={{ ...inputStyle, textAlign: "center", padding: "2px 3px" }}
          />
          <input
            value={s.title}
            onChange={e => update(i, "title", e.target.value)}
            style={inputStyle}
            placeholder="Track title"
          />
          <input
            value={s.duration_seconds ? formatDuration(s.duration_seconds) : (s._durStr || "")}
            onChange={e => {
              const next = [...songs];
              const parsed = parseDuration(e.target.value);
              next[i] = { ...next[i], duration_seconds: parsed, _durStr: e.target.value };
              onChange(next);
            }}
            style={{ ...inputStyle, padding: "2px 4px" }}
            placeholder="m:ss"
          />
          <input
            value={s.disc_number || 1}
            onChange={e => update(i, "disc_number", parseInt(e.target.value, 10) || 1)}
            style={{ ...inputStyle, textAlign: "center", padding: "2px 3px" }}
          />
          <button type="button" onClick={() => remove(i)} style={{ ...btnSm, color: "#c62828", padding: "2px 5px" }}>✕</button>
        </div>
      ))}
      <button type="button" onClick={add} style={{ ...btnSm, marginTop: 2 }}>+ Track</button>
    </div>
  );
}

// ─── Editions editor (edit modal) ─────────────────────────────────────────────

function EditionsEditor({ editions, formatTypes, ownershipStatuses, onChange }) {
  function update(idx, key, val) {
    const next = [...editions];
    next[idx] = { ...next[idx], [key]: val };
    onChange(next);
  }
  function add() { onChange([...editions, { format_type_id: "", version_name: "", label: "", catalog_number: "", barcode: "", notes: "", ownership_status_id: "" }]); }
  function remove(idx) { onChange(editions.filter((_, i) => i !== idx)); }

  return (
    <div>
      {editions.map((e, i) => (
        <div key={i} style={{ marginBottom: 8, padding: "8px 10px", border: "1px solid var(--border)", borderRadius: 3, background: "var(--bg-surface)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <span style={{ fontSize: 11, fontWeight: "bold", color: "var(--text-secondary)" }}>Edition {i + 1}</span>
            <button type="button" onClick={() => remove(i)} style={{ ...btnSm, color: "#c62828" }}>✕ Remove</button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 6 }}>
            <div>
              <label style={labelStyle}>Format</label>
              <select value={e.format_type_id || ""} onChange={ev => update(i, "format_type_id", ev.target.value)} style={selectStyle}>
                <option value="">None</option>
                {formatTypes.map(f => <option key={f.format_type_id} value={f.format_type_id}>{f.format_name}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Version Name</label>
              <input value={e.version_name || ""} onChange={ev => update(i, "version_name", ev.target.value)} style={inputStyle} placeholder="e.g. Limited Edition" />
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 6 }}>
            <div>
              <label style={labelStyle}>Label</label>
              <input value={e.label || ""} onChange={ev => update(i, "label", ev.target.value)} style={inputStyle} placeholder="Record label" />
            </div>
            <div>
              <label style={labelStyle}>Catalog #</label>
              <input value={e.catalog_number || ""} onChange={ev => update(i, "catalog_number", ev.target.value)} style={inputStyle} />
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 6 }}>
            <div>
              <label style={labelStyle}>Barcode</label>
              <input value={e.barcode || ""} onChange={ev => update(i, "barcode", ev.target.value)} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Ownership</label>
              <select value={e.ownership_status_id || ""} onChange={ev => update(i, "ownership_status_id", ev.target.value)} style={selectStyle}>
                <option value="">None</option>
                {ownershipStatuses.map(s => <option key={s.ownership_status_id} value={s.ownership_status_id}>{s.status_name}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label style={labelStyle}>Notes</label>
            <input value={e.notes || ""} onChange={ev => update(i, "notes", ev.target.value)} style={inputStyle} />
          </div>
        </div>
      ))}
      <button type="button" onClick={add} style={btnSm}>+ Add Edition</button>
    </div>
  );
}

// ─── Grid item ────────────────────────────────────────────────────────────────

const MusicGridItem = memo(function MusicGridItem({ release, isSelected, onToggleSelect, onClick, gridSize, showCaptions }) {
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
            onChange={() => onToggleSelect(release.item_id)}
            onClick={(e) => e.stopPropagation()}
            style={{ margin: 0, cursor: "pointer" }} />
        </div>
        <OwnershipBadge statusName={release.ownership_status} />
        {release.cover_image_url ? (
          <img src={getImageUrl(release.cover_image_url)} alt="" style={{ width: w, height: h, objectFit: "cover", display: "block", borderRadius: 2 }} />
        ) : (
          <div style={{ width: w, height: h, background: "var(--bg-surface)", borderRadius: 2, border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ fontSize: 10, color: "var(--text-muted)" }}>No Cover</span>
          </div>
        )}
      </div>
      {showCaptions && (
        <div style={{ padding: "3px 2px 0", maxWidth: w }}>
          <div style={{ fontSize: 11, fontWeight: "700", lineHeight: "1.3", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-primary)" }}>{release.title}</div>
          <div style={{ fontSize: 10, color: "var(--text-muted)", lineHeight: "1.3", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{(release.artists || []).join(", ")}</div>
        </div>
      )}
    </div>
  );
});

// ─── Detail modal ─────────────────────────────────────────────────────────────

function MusicDetailModal({ itemId, ownershipStatuses, releaseTypes, formatTypes, allGenres, onClose, onSaved, onDeleted }) {
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState("");
  const [coverPreview, setCoverPreview] = useState(null);
  const coverFileRef = useRef(null);

  async function handleCoverFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const { url } = await uploadCover(file, "music", itemId);
      set("coverImageUrl", url);
      setCoverPreview(url);
    } catch (err) {
      setError(err.message || "Cover upload failed.");
    }
    if (coverFileRef.current) coverFileRef.current.value = "";
  }

  useEffect(() => {
    getMusicRelease(itemId).then(d => {
      setForm({
        title: d.title || "",
        releaseTypeId: String(d.top_level_category_id),
        ownershipStatusId: String(d.ownership_status_id),
        releaseDate: d.release_date || "",
        description: d.description || "",
        coverImageUrl: d.cover_image_url || "",
        notes: d.notes || "",
        artists: d.artist_names?.length ? [...d.artist_names] : [""],
        genres: d.genres?.map(g => ({ top_genre_id: g.top_genre_id, sub_genre_id: g.sub_genre_id })) || [],
        songs: d.songs?.map(s => ({ ...s })) || [],
        editions: d.editions?.map(e => ({
          ...e,
          format_type_id: e.format_type_id ? String(e.format_type_id) : "",
          ownership_status_id: e.ownership_status_id ? String(e.ownership_status_id) : "",
        })) || [],
      });
      setCoverPreview(d.cover_image_url || null);
    }).catch(() => setError("Failed to load release."));
  }, [itemId]);

  function set(key, val) { setForm(f => ({ ...f, [key]: val })); }

  async function handleSave() {
    setError("");
    if (!form.title.trim()) { setError("Title is required."); return; }
    setSaving(true);
    try {
      const payload = {
        title: form.title.trim(),
        top_level_category_id: parseInt(form.releaseTypeId, 10),
        ownership_status_id: parseInt(form.ownershipStatusId, 10),
        release_date: form.releaseDate || null,
        description: form.description || null,
        cover_image_url: form.coverImageUrl || null,
        notes: form.notes || null,
        artist_names: form.artists.map(a => a.trim()).filter(Boolean),
        genres: form.genres,
        songs: form.songs
          .filter(s => s.title?.trim())
          .map(s => ({
            title: s.title.trim(),
            duration_seconds: s.duration_seconds || null,
            track_number: s.track_number ? parseInt(s.track_number, 10) : null,
            disc_number: s.disc_number || 1,
          })),
        editions: form.editions
          .filter(e => e.format_type_id || e.version_name)
          .map(e => ({
            format_type_id: e.format_type_id ? parseInt(e.format_type_id, 10) : null,
            version_name: e.version_name || null,
            label: e.label || null,
            catalog_number: e.catalog_number || null,
            barcode: e.barcode || null,
            notes: e.notes || null,
            ownership_status_id: e.ownership_status_id ? parseInt(e.ownership_status_id, 10) : null,
          })),
      };
      await updateMusicRelease(itemId, payload);
      onSaved();
    } catch (err) {
      setError(err.message || "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      await deleteMusicRelease(itemId);
      onDeleted(itemId);
    } catch (err) {
      setError(err.message || "Delete failed.");
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
          <div style={{ fontWeight: "bold", fontSize: 14 }}>{!form ? "Loading..." : form.title || "Release Detail"}</div>
          <button type="button" onClick={onClose} style={{ ...btnSm, fontSize: 14, padding: "2px 8px" }}>✕</button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
          {!form && !error && <div style={{ color: "#999" }}>Loading…</div>}
          {error && <div style={alertError}>{error}</div>}

          {form && (
            <>
              {coverPreview && (
                <div style={{ display: "flex", gap: 12, marginBottom: 14 }}>
                  <img src={getImageUrl(coverPreview)} alt="cover" style={{ height: 100, width: "auto", borderRadius: 3, border: "1px solid #ddd", flexShrink: 0 }} onError={() => setCoverPreview(null)} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: "bold", fontSize: 14, marginBottom: 2 }}>{form.title}</div>
                    <div style={{ fontSize: 12, color: "#555" }}>{form.artists.filter(Boolean).join(", ")}</div>
                  </div>
                </div>
              )}

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
                <div style={{ gridColumn: "1 / -1" }}>
                  <label style={labelStyle}>Title *</label>
                  <input value={form.title} onChange={e => set("title", e.target.value)} style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>Release Type</label>
                  <select value={form.releaseTypeId} onChange={e => set("releaseTypeId", e.target.value)} style={selectStyle}>
                    {releaseTypes.map(r => <option key={r.top_level_category_id} value={r.top_level_category_id}>{r.category_name}</option>)}
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Ownership</label>
                  <select value={form.ownershipStatusId} onChange={e => set("ownershipStatusId", e.target.value)} style={selectStyle}>
                    {ownershipStatuses.map(s => <option key={s.ownership_status_id} value={s.ownership_status_id}>{s.status_name}</option>)}
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Release Date</label>
                  <input value={form.releaseDate} onChange={e => set("releaseDate", e.target.value)} style={inputStyle} placeholder="YYYY-MM-DD" />
                </div>
                <div>
                  <label style={labelStyle}>Cover Image URL</label>
                  <div style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
                    <input value={form.coverImageUrl} onChange={e => { set("coverImageUrl", e.target.value); setCoverPreview(e.target.value || null); }} style={{ ...inputStyle, flex: 1 }} placeholder="https://…" />
                    <input type="file" accept="image/*" ref={coverFileRef} onChange={handleCoverFile} style={{ display: "none" }} />
                    <button type="button" onClick={() => coverFileRef.current?.click()} style={{ padding: "4px 10px", fontSize: 12, whiteSpace: "nowrap" }}>Add Image</button>
                  </div>
                </div>
              </div>

              <div style={{ marginBottom: 10 }}>
                <label style={labelStyle}>Artist(s)</label>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {form.artists.map((a, i) => (
                    <div key={i} style={{ display: "flex", gap: 4, alignItems: "center" }}>
                      <input value={a} onChange={e => { const next = [...form.artists]; next[i] = e.target.value; set("artists", next); }} style={{ ...inputStyle, flex: 1 }} placeholder="Artist name" />
                      {form.artists.length > 1 && <button type="button" onClick={() => set("artists", form.artists.filter((_, x) => x !== i))} style={{ ...btnSm, color: "#c62828" }}>✕</button>}
                    </div>
                  ))}
                  <button type="button" onClick={() => set("artists", [...form.artists, ""])} style={{ ...btnSm, alignSelf: "flex-start" }}>+ Artist</button>
                </div>
              </div>

              <div style={{ marginBottom: 10 }}>
                <label style={labelStyle}>Genre</label>
                <GenrePicker allGenres={allGenres} selected={form.genres} onChange={v => set("genres", v)} />
              </div>

              <div style={{ marginBottom: 10 }}>
                <label style={labelStyle}>Description</label>
                <textarea value={form.description} onChange={e => set("description", e.target.value)} style={{ ...inputStyle, height: 60, resize: "vertical" }} />
              </div>

              <div style={{ marginBottom: 10 }}>
                <label style={labelStyle}>Notes</label>
                <textarea value={form.notes} onChange={e => set("notes", e.target.value)} style={{ ...inputStyle, height: 40, resize: "vertical" }} />
              </div>

              <div style={sectionStyle}>
                <div style={sectionLabel}>Track List</div>
                <TrackListEditor songs={form.songs} onChange={v => set("songs", v)} />
              </div>

              <div style={sectionStyle}>
                <div style={sectionLabel}>Editions / Versions</div>
                <EditionsEditor
                  editions={form.editions}
                  formatTypes={formatTypes}
                  ownershipStatuses={ownershipStatuses}
                  onChange={v => set("editions", v)}
                />
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
                    <span style={{ fontSize: 12, color: "#c62828" }}>Delete this release?</span>
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

function MusicBulkEdit({ selectedIds, ownershipStatuses, releaseTypes, onClose, onSaved, onDeleted }) {
  const fieldStyle = { width: "100%", padding: "5px 6px", fontSize: 13, border: "1px solid #ccc", borderRadius: 3 };

  const [updateOwnership, setUpdateOwnership] = useState(false);
  const [ownershipId, setOwnershipId] = useState(String(ownershipStatuses[0]?.ownership_status_id || ""));
  const [updateReleaseType, setUpdateReleaseType] = useState(false);
  const [releaseTypeId, setReleaseTypeId] = useState(String(releaseTypes[0]?.top_level_category_id || ""));

  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState("");

  const anyEnabled = updateOwnership || updateReleaseType;

  async function handleSave() {
    if (!anyEnabled) { setError("Select at least one field to update."); return; }
    const fields = {};
    if (updateOwnership) fields.ownership_status_id = Number(ownershipId);
    if (updateReleaseType) fields.top_level_category_id = Number(releaseTypeId);
    setSaving(true); setError("");
    try { await bulkUpdateMusic(selectedIds, fields); onSaved(); }
    catch (err) { setError(err.message || "Failed to update"); }
    finally { setSaving(false); }
  }

  async function handleDelete() {
    if (!confirmDelete) { setConfirmDelete(true); return; }
    setDeleting(true);
    try { await bulkDeleteMusic(selectedIds); onDeleted(); }
    catch (err) { setError(err.message || "Failed to delete"); setConfirmDelete(false); }
    finally { setDeleting(false); }
  }

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: "#fff", border: "1px solid #ddd", borderRadius: 6, width: 420, maxHeight: "85vh", display: "flex", flexDirection: "column", boxShadow: "0 2px 12px rgba(0,0,0,0.15)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", borderBottom: "1px solid #e0e0e0", flexShrink: 0 }}>
          <span style={{ fontWeight: "bold", fontSize: 14 }}>Bulk Edit — {selectedIds.length} release{selectedIds.length !== 1 ? "s" : ""}</span>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 15, cursor: "pointer", color: "#666" }}>✕</button>
        </div>
        {error && <div style={{ margin: "8px 14px 0", padding: "7px 10px", background: "#ffebee", border: "1px solid #c62828", borderRadius: 3, fontSize: 13, color: "#c62828", flexShrink: 0 }}>{error}</div>}
        <div style={{ padding: "12px 14px", overflowY: "auto", flex: 1 }}>
          <BulkField label="Ownership" enabled={updateOwnership} onToggle={() => setUpdateOwnership((p) => !p)}>
            <select value={ownershipId} onChange={(e) => setOwnershipId(e.target.value)} style={fieldStyle}>
              {ownershipStatuses.map((s) => <option key={s.ownership_status_id} value={s.ownership_status_id}>{s.status_name}</option>)}
            </select>
          </BulkField>
          <BulkField label="Release Type" enabled={updateReleaseType} onToggle={() => setUpdateReleaseType((p) => !p)}>
            <select value={releaseTypeId} onChange={(e) => setReleaseTypeId(e.target.value)} style={fieldStyle}>
              {releaseTypes.map((r) => <option key={r.top_level_category_id} value={r.top_level_category_id}>{r.category_name}</option>)}
            </select>
          </BulkField>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", borderTop: "1px solid #e0e0e0", flexShrink: 0 }}>
          <div>
            {!confirmDelete
              ? <button onClick={handleDelete} disabled={deleting || saving} style={{ padding: "5px 12px", fontSize: 13, cursor: "pointer", border: "1px solid #c62828", borderRadius: 3, background: "#fff", color: "#c62828" }}>Delete {selectedIds.length} release{selectedIds.length !== 1 ? "s" : ""}</button>
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

// ─── Main component ───────────────────────────────────────────────────────────

function emptyFilters() {
  return {
    search: "",
    ownership: emptySection(),
    releaseType: emptySection(),
    format: emptySection(),
    genre: emptySection(),
    artist: emptySection(),
  };
}

export default function MusicLibraryPage() {
  const [releases, setReleases] = useState([]);
  const [ownershipStatuses, setOwnershipStatuses] = useState([]);
  const [releaseTypes, setReleaseTypes] = useState([]);
  const [formatTypes, setFormatTypes] = useState([]);
  const [allGenres, setAllGenres] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState(emptyFilters);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);

  const [viewMode, setViewMode] = useState("table");
  const [showThumbnails, setShowThumbnails] = useState(false);
  const [gridSize, setGridSize] = useState("m");
  const [showCaptions, setShowCaptions] = useState(true);

  const [sortField, setSortField] = useState("title");
  const [sortDir, setSortDir] = useState("asc");

  const [colWidths, setColWidths] = useState({
    title: 220, artist: 160, type: 100, date: 70, editions: 150, genre: 150, ownership: 110,
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

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      listMusicReleases(),
      fetchOwnershipStatuses(COLLECTION_TYPE_IDS.music),
      fetchMusicReleaseTypes(),
      fetchMusicFormatTypes(),
      fetchMusicGenres(),
    ]).then(([data, own, types, fmts, genres]) => {
      setReleases(data);
      setOwnershipStatuses(own);
      setReleaseTypes(types);
      setFormatTypes(fmts);
      setAllGenres(genres);
      setLoading(false);
    });
  }, []);

  useEffect(() => { load(); }, [load]);

  function handleSectionChange(key, val) {
    setFilters(f => ({ ...f, [key]: val }));
  }

  function handleClearAll() {
    setFilters(emptyFilters());
  }

  const filtered = useMemo(() => {
    return releases.filter(r => {
      const search = filters.search.trim().toLowerCase();
      if (search && !r.title.toLowerCase().includes(search)
          && !(r.artists || []).some(a => a.toLowerCase().includes(search))) return false;

      if (sectionActive(filters.ownership)) {
        if (!applySection(filters.ownership, [r.ownership_status_id])) return false;
      }
      if (sectionActive(filters.releaseType)) {
        if (!applySection(filters.releaseType, [r.top_level_category_id])) return false;
      }
      if (sectionActive(filters.format)) {
        if (!applySection(filters.format, r.formats || [])) return false;
      }
      if (sectionActive(filters.genre)) {
        if (!applySection(filters.genre, r.genres || [])) return false;
      }
      if (sectionActive(filters.artist)) {
        if (!applySection(filters.artist, r.artists || [])) return false;
      }
      return true;
    });
  }, [releases, filters]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    const flip = sortDir === "desc" ? -1 : 1;
    switch (sortField) {
      case "artist":
        return arr.sort((a, b) =>
          flip * ((a.artists?.[0] || "").localeCompare(b.artists?.[0] || ""))
        );
      case "type":
        return arr.sort((a, b) =>
          flip * ((a.release_type || "").localeCompare(b.release_type || ""))
        );
      case "date":
        return arr.sort((a, b) =>
          flip * ((a.release_date || "").localeCompare(b.release_date || ""))
        );
      case "ownership":
        return arr.sort((a, b) =>
          flip * ((a.ownership_status || "").localeCompare(b.ownership_status || ""))
        );
      default: // title
        return arr.sort((a, b) =>
          flip * ((a.title_sort || a.title || "").localeCompare(b.title_sort || b.title || ""))
        );
    }
  }, [filtered, sortField, sortDir]);

  function toggleSelect(id) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function clearSelection() { setSelectedIds(new Set()); }
  function selectAll() { setSelectedIds(new Set(sorted.map(r => r.item_id))); }

  const allVisibleSelected = sorted.length > 0 && sorted.every(r => selectedIds.has(r.item_id));

  const selectedReleases = useMemo(
    () => sorted.filter(r => selectedIds.has(r.item_id)),
    [sorted, selectedIds]
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden", fontSize: 13 }}>
      {/* Controls bar */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 12px", borderBottom: "1px solid var(--border)", background: "var(--bg-sidebar)", flexShrink: 0, gap: 8, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>
            {loading ? "Loading…" : `${sorted.length} release${sorted.length !== 1 ? "s" : ""}`}
          </span>
          {selectedIds.size > 0 && (
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 12, color: "var(--btn-primary-bg)", fontWeight: "bold" }}>{selectedIds.size} selected</span>
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

      {/* Main layout */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        <div style={{ width: 220, flexShrink: 0, borderRight: "1px solid var(--border)", overflowY: "auto" }}>
          <MusicFilters
            items={releases}
            ownershipStatuses={ownershipStatuses}
            releaseTypes={releaseTypes}
            filters={filters}
            onSectionChange={handleSectionChange}
            onClearAll={handleClearAll}
          />
        </div>

        <div style={{ flex: 1, overflowY: "auto", overflowX: "auto", padding: 0 }}>
          {loading ? (
            <p style={{ padding: 20, fontSize: 13 }}>Loading…</p>
          ) : sorted.length === 0 ? (
            <p style={{ padding: 20, fontSize: 13, color: "var(--text-secondary)" }}>No releases found.</p>
          ) : viewMode === "grid" ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, padding: 12, alignContent: "flex-start" }}>
              {sorted.map(r => (
                <MusicGridItem key={r.item_id} release={r}
                  isSelected={selectedIds.has(r.item_id)}
                  onToggleSelect={toggleSelect}
                  onClick={() => setEditingId(r.item_id)}
                  gridSize={gridSize} showCaptions={showCaptions} />
              ))}
            </div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, tableLayout: "fixed" }}>
              <colgroup>
                <col style={{ width: 28 }} />
                {showThumbnails && <col style={{ width: 50 }} />}
                <col style={{ width: colWidths.title }} />
                <col style={{ width: colWidths.artist }} />
                <col style={{ width: colWidths.type }} />
                <col style={{ width: colWidths.date }} />
                <col style={{ width: colWidths.editions }} />
                <col style={{ width: colWidths.genre }} />
                <col style={{ width: colWidths.ownership }} />
              </colgroup>
              <thead style={{ position: "sticky", top: 0, zIndex: 2 }}>
                <tr style={{ background: "var(--bg-sidebar)", borderBottom: "1px solid var(--border)" }}>
                  <th style={{ padding: "5px 6px", textAlign: "center", borderRight: "1px solid var(--border)" }}>
                    <input type="checkbox" checked={allVisibleSelected}
                      onChange={() => allVisibleSelected ? clearSelection() : selectAll()}
                      style={{ margin: 0, cursor: "pointer" }} />
                  </th>
                  {showThumbnails && <th style={{ padding: "5px 6px", borderRight: "1px solid var(--border)" }} />}
                  {[
                    { key: "title", label: "Title", colKey: "title" },
                    { key: "artist", label: "Artist(s)", colKey: "artist" },
                    { key: "type", label: "Type", colKey: "type" },
                    { key: "date", label: "Date", colKey: "date" },
                    { key: null, label: "Editions", colKey: "editions" },
                    { key: null, label: "Genre(s)", colKey: "genre" },
                    { key: "ownership", label: "Ownership", colKey: "ownership" },
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
                {sorted.map(r => {
                  const isSelected = selectedIds.has(r.item_id);
                  return (
                    <tr
                      key={r.item_id}
                      onClick={() => setEditingId(r.item_id)}
                      style={{ cursor: "pointer", borderBottom: "1px solid var(--border)", background: isSelected ? "var(--green-light)" : undefined }}
                      onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = "var(--bg-surface)"; }}
                      onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = ""; }}
                    >
                      <td style={{ padding: "3px 6px", verticalAlign: "middle", width: 28 }}
                        onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(r.item_id)} style={{ margin: 0, cursor: "pointer" }} />
                      </td>
                      {showThumbnails && (
                        <td style={{ padding: "3px 6px", verticalAlign: "middle", width: 50 }}>
                          {r.cover_image_url
                            ? <img src={getImageUrl(r.cover_image_url)} alt="" style={{ width: 42, height: 42, objectFit: "cover", borderRadius: 2, border: "1px solid var(--border)", display: "block" }} />
                            : <div style={{ width: 42, height: 42, background: "var(--bg-surface)", borderRadius: 2 }} />}
                        </td>
                      )}
                      <td style={{ padding: "3px 8px", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis", fontWeight: 500 }}>{r.title}</td>
                      <td style={{ padding: "3px 8px", fontSize: 12, color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{(r.artists || []).join(", ")}</td>
                      <td style={{ padding: "3px 8px", fontSize: 12, color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.release_type}</td>
                      <td style={{ padding: "3px 8px", fontSize: 12, color: "var(--text-secondary)", whiteSpace: "nowrap" }}>{r.release_date?.slice(0, 4) || ""}</td>
                      <td style={{ padding: "3px 8px", fontSize: 12, color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.editions_summary || ""}</td>
                      <td style={{ padding: "3px 8px", fontSize: 12, color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{(r.genres || []).join(", ")}</td>
                      <td style={{ padding: "3px 8px", fontSize: 12, color: "var(--text-secondary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.ownership_status}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {editingId && (
        <MusicDetailModal
          itemId={editingId}
          ownershipStatuses={ownershipStatuses}
          releaseTypes={releaseTypes}
          formatTypes={formatTypes}
          allGenres={allGenres}
          onClose={() => setEditingId(null)}
          onSaved={() => { setEditingId(null); load(); }}
          onDeleted={id => {
            setEditingId(null);
            setReleases(prev => prev.filter(r => r.item_id !== id));
            setSelectedIds(prev => { const next = new Set(prev); next.delete(id); return next; });
          }}
        />
      )}

      {bulkEditOpen && (
        <MusicBulkEdit
          selectedIds={selectedReleases.map(r => r.item_id)}
          ownershipStatuses={ownershipStatuses}
          releaseTypes={releaseTypes}
          onClose={() => setBulkEditOpen(false)}
          onSaved={async () => { setBulkEditOpen(false); clearSelection(); load(); }}
          onDeleted={async () => { setBulkEditOpen(false); clearSelection(); load(); }}
        />
      )}
    </div>
  );
}
