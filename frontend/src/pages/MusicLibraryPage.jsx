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
import { labelStyle, inputStyle, selectStyle, btnPrimary, btnSecondary, btnSm, btnDanger, alertError, alertSuccess, sectionStyle, sectionLabel } from "../styles/commonStyles";
import { HIDDEN_OWNERSHIP_NAMES } from "../constants/hiddenStatuses";

// ─── Filter sidebar ───────────────────────────────────────────────────────────

function MusicFilters({ items, ownershipStatuses, releaseTypes, filters, onSectionChange, onClearAll }) {
  const visibleOwnership = ownershipStatuses.filter(s => !HIDDEN_OWNERSHIP_NAMES.has(s.status_name));

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
        items={visibleOwnership.map(s => ({ id: s.ownership_status_id, label: s.status_name }))}
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

// ─── Edit modal ───────────────────────────────────────────────────────────────

function EditModal({ itemId, ownershipStatuses, releaseTypes, formatTypes, allGenres, onClose, onSaved, onDeleted }) {
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
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

  const visibleOwnership = ownershipStatuses.filter(s => !HIDDEN_OWNERSHIP_NAMES.has(s.status_name));

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
    try {
      await deleteMusicRelease(itemId);
      onDeleted(itemId);
    } catch (err) {
      setError(err.message || "Delete failed.");
    }
  }

  const overlayStyle = {
    position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
    display: "flex", alignItems: "flex-start", justifyContent: "center",
    zIndex: 1000, overflowY: "auto", padding: "20px 0",
  };
  const modalStyle = {
    background: "var(--bg-surface)", borderRadius: 6, padding: 20,
    width: 680, maxWidth: "95vw", position: "relative",
  };

  if (!form) return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={modalStyle} onClick={e => e.stopPropagation()}>
        {error ? <div style={alertError}>{error}</div> : <p style={{ fontSize: 13 }}>Loading…</p>}
      </div>
    </div>
  );

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={modalStyle} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>Edit Release</h3>
          <button type="button" onClick={onClose} style={{ ...btnSm, fontSize: 14, lineHeight: 1 }}>✕</button>
        </div>

        {error && <div style={alertError}>{error}</div>}

        {/* Cover preview banner */}
        {coverPreview && (
          <div style={{ marginBottom: 12, textAlign: "center" }}>
            <img src={coverPreview} alt="cover" style={{ maxHeight: 80, maxWidth: 80, objectFit: "cover", borderRadius: 3, border: "1px solid var(--border)" }} onError={() => setCoverPreview(null)} />
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
              {visibleOwnership.map(s => <option key={s.ownership_status_id} value={s.ownership_status_id}>{s.status_name}</option>)}
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
            ownershipStatuses={visibleOwnership}
            onChange={v => set("editions", v)}
          />
        </div>

        {!confirmDelete ? (
          <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
            <button type="button" onClick={handleSave} disabled={saving} style={btnPrimary}>{saving ? "Saving…" : "Save"}</button>
            <button type="button" onClick={onClose} style={btnSecondary}>Cancel</button>
            <button type="button" onClick={() => setConfirmDelete(true)} style={{ ...btnDanger, marginLeft: "auto" }}>Delete</button>
          </div>
        ) : (
          <div style={{ display: "flex", gap: 8, marginTop: 4, alignItems: "center" }}>
            <span style={{ fontSize: 13, color: "#c62828" }}>Delete this release?</span>
            <button type="button" onClick={handleDelete} style={btnDanger}>Yes, delete</button>
            <button type="button" onClick={() => setConfirmDelete(false)} style={btnSecondary}>Cancel</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Bulk edit panel ──────────────────────────────────────────────────────────

function BulkEditPanel({ selectedIds, ownershipStatuses, releaseTypes, onDone, onDeleted }) {
  const [ownershipId, setOwnershipId] = useState("");
  const [releaseTypeId, setReleaseTypeId] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const visibleOwnership = ownershipStatuses.filter(s => !HIDDEN_OWNERSHIP_NAMES.has(s.status_name));

  async function handleUpdate() {
    const fields = {};
    if (ownershipId) fields.ownership_status_id = parseInt(ownershipId, 10);
    if (releaseTypeId) fields.top_level_category_id = parseInt(releaseTypeId, 10);
    if (!Object.keys(fields).length) return;
    setSaving(true);
    try {
      await bulkUpdateMusic(selectedIds, fields);
      onDone();
    } catch (err) {
      setError(err.message || "Update failed.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    setSaving(true);
    try {
      await bulkDeleteMusic(selectedIds);
      onDeleted(selectedIds);
    } catch (err) {
      setError(err.message || "Delete failed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ padding: "8px 12px", background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 4, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
      <span style={{ fontSize: 12, fontWeight: "bold", color: "var(--text-secondary)" }}>{selectedIds.length} selected</span>
      <select value={ownershipId} onChange={e => setOwnershipId(e.target.value)} style={{ ...selectStyle, width: "auto", minWidth: 130, fontSize: 12 }}>
        <option value="">Ownership…</option>
        {visibleOwnership.map(s => <option key={s.ownership_status_id} value={s.ownership_status_id}>{s.status_name}</option>)}
      </select>
      <select value={releaseTypeId} onChange={e => setReleaseTypeId(e.target.value)} style={{ ...selectStyle, width: "auto", minWidth: 130, fontSize: 12 }}>
        <option value="">Release Type…</option>
        {releaseTypes.map(r => <option key={r.top_level_category_id} value={r.top_level_category_id}>{r.category_name}</option>)}
      </select>
      <button type="button" onClick={handleUpdate} disabled={saving || (!ownershipId && !releaseTypeId)} style={{ ...btnSecondary, fontSize: 12 }}>Apply</button>
      {error && <span style={{ fontSize: 12, color: "var(--error)" }}>{error}</span>}
      {!confirmDelete ? (
        <button type="button" onClick={() => setConfirmDelete(true)} style={{ ...btnDanger, fontSize: 12, marginLeft: "auto" }}>Delete {selectedIds.length}</button>
      ) : (
        <>
          <span style={{ fontSize: 12, color: "#c62828", marginLeft: "auto" }}>Delete {selectedIds.length} releases?</span>
          <button type="button" onClick={handleDelete} disabled={saving} style={{ ...btnDanger, fontSize: 12 }}>Confirm</button>
          <button type="button" onClick={() => setConfirmDelete(false)} style={{ ...btnSecondary, fontSize: 12 }}>Cancel</button>
        </>
      )}
    </div>
  );
}

// ─── Empty section helper ─────────────────────────────────────────────────────

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

// ─── Main component ───────────────────────────────────────────────────────────

export default function MusicLibraryPage() {
  const [releases, setReleases] = useState([]);
  const [ownershipStatuses, setOwnershipStatuses] = useState([]);
  const [releaseTypes, setReleaseTypes] = useState([]);
  const [formatTypes, setFormatTypes] = useState([]);
  const [allGenres, setAllGenres] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState(emptyFilters);
  const [selectedIds, setSelectedIds] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [showThumbnails, setShowThumbnails] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      listMusicReleases(),
      fetchOwnershipStatuses(),
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
    setSelectedIds([]);
  }

  function handleClearAll() {
    setFilters(emptyFilters());
    setSelectedIds([]);
  }

  const filtered = useMemo(() => {
    return releases.filter(r => {
      const search = filters.search.trim().toLowerCase();
      if (search && !r.title.toLowerCase().includes(search)) return false;

      if (sectionActive(filters.ownership)) {
        const match = applySection(filters.ownership, [r.ownership_status_id]);
        if (!match) return false;
      }
      if (sectionActive(filters.releaseType)) {
        const match = applySection(filters.releaseType, [r.top_level_category_id]);
        if (!match) return false;
      }
      if (sectionActive(filters.format)) {
        const match = applySection(filters.format, r.formats || []);
        if (!match) return false;
      }
      if (sectionActive(filters.genre)) {
        const match = applySection(filters.genre, r.genres || []);
        if (!match) return false;
      }
      if (sectionActive(filters.artist)) {
        const match = applySection(filters.artist, r.artists || []);
        if (!match) return false;
      }
      return true;
    });
  }, [releases, filters]);

  function toggleSelect(id) {
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  }

  function toggleSelectAll() {
    if (selectedIds.length === filtered.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(filtered.map(r => r.item_id));
    }
  }

  const allSelected = filtered.length > 0 && selectedIds.length === filtered.length;

  const tdStyle = { padding: "4px 8px", fontSize: 12, borderBottom: "1px solid var(--border)", verticalAlign: "middle" };
  const thStyle = { padding: "5px 8px", fontSize: 11, fontWeight: "bold", textAlign: "left", borderBottom: "2px solid var(--border)", background: "#f5f5f5", color: "var(--text-secondary)", whiteSpace: "nowrap" };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Controls bar */}
      <div style={{ padding: "8px 12px", borderBottom: "1px solid var(--border)", display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
        <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>
          {loading ? "Loading…" : `${filtered.length} release${filtered.length !== 1 ? "s" : ""}${selectedIds.length > 0 ? ` · ${selectedIds.length} selected` : ""}`}
        </span>
        <button
          type="button"
          onClick={() => setShowThumbnails(v => !v)}
          style={{ ...btnSm, marginLeft: "auto", background: showThumbnails ? "var(--green-light)" : undefined, borderColor: showThumbnails ? "var(--green)" : undefined }}
        >
          Thumbnails
        </button>
        <a href="/music/add" style={{ ...btnPrimary, textDecoration: "none", fontSize: 12 }}>+ Add</a>
      </div>

      {/* Bulk edit panel */}
      {selectedIds.length > 0 && (
        <div style={{ padding: "6px 12px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
          <BulkEditPanel
            selectedIds={selectedIds}
            ownershipStatuses={ownershipStatuses}
            releaseTypes={releaseTypes}
            onDone={() => { setSelectedIds([]); load(); }}
            onDeleted={ids => { setSelectedIds([]); setReleases(prev => prev.filter(r => !ids.includes(r.item_id))); }}
          />
        </div>
      )}

      {/* Main layout */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {/* Sidebar */}
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

        {/* Table */}
        <div style={{ flex: 1, overflowY: "auto" }}>
          {loading ? (
            <p style={{ padding: 20, fontSize: 13 }}>Loading…</p>
          ) : filtered.length === 0 ? (
            <p style={{ padding: 20, fontSize: 13, color: "var(--text-secondary)" }}>No releases found.</p>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={{ ...thStyle, width: 28, textAlign: "center" }}>
                    <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} style={{ cursor: "pointer" }} />
                  </th>
                  {showThumbnails && <th style={{ ...thStyle, width: 42 }}></th>}
                  <th style={thStyle}>Title</th>
                  <th style={thStyle}>Artist(s)</th>
                  <th style={thStyle}>Type</th>
                  <th style={thStyle}>Date</th>
                  <th style={thStyle}>Editions</th>
                  <th style={thStyle}>Genre(s)</th>
                  <th style={thStyle}>Ownership</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => {
                  const isSelected = selectedIds.includes(r.item_id);
                  const rowBg = isSelected ? "var(--green-light)" : undefined;
                  return (
                    <tr
                      key={r.item_id}
                      style={{ background: rowBg, cursor: "pointer" }}
                      onClick={() => setEditingId(r.item_id)}
                    >
                      <td style={{ ...tdStyle, textAlign: "center" }} onClick={e => { e.stopPropagation(); toggleSelect(r.item_id); }}>
                        <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(r.item_id)} style={{ cursor: "pointer" }} />
                      </td>
                      {showThumbnails && (
                        <td style={{ ...tdStyle, padding: "2px 4px" }}>
                          {r.cover_image_url
                            ? <img src={getImageUrl(r.cover_image_url)} alt="" style={{ width: 34, height: 34, objectFit: "cover", borderRadius: 2, display: "block" }} />
                            : <div style={{ width: 34, height: 34, background: "var(--surface-2)", borderRadius: 2 }} />}
                        </td>
                      )}
                      <td style={{ ...tdStyle, fontWeight: 500 }}>{r.title}</td>
                      <td style={{ ...tdStyle, color: "var(--text-secondary)" }}>{(r.artists || []).join(", ")}</td>
                      <td style={tdStyle}>{r.release_type}</td>
                      <td style={{ ...tdStyle, color: "var(--text-secondary)" }}>{r.release_date?.slice(0, 4) || ""}</td>
                      <td style={{ ...tdStyle, color: "var(--text-secondary)" }}>{r.editions_summary || ""}</td>
                      <td style={{ ...tdStyle, color: "var(--text-secondary)" }}>{(r.genres || []).join(", ")}</td>
                      <td style={tdStyle}>{r.ownership_status}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Edit modal */}
      {editingId && (
        <EditModal
          itemId={editingId}
          ownershipStatuses={ownershipStatuses}
          releaseTypes={releaseTypes}
          formatTypes={formatTypes}
          allGenres={allGenres}
          onClose={() => setEditingId(null)}
          onSaved={() => { setEditingId(null); load(); }}
          onDeleted={id => { setEditingId(null); setReleases(prev => prev.filter(r => r.item_id !== id)); }}
        />
      )}
    </div>
  );
}
