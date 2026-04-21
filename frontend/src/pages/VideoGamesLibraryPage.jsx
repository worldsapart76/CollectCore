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
  bulkDeleteVideoGames,
  bulkUpdateVideoGames,
  deleteVideoGame,
  fetchGameGenres,
  fetchGamePlatforms,
  fetchGamePlayStatuses,
  fetchOwnershipStatuses,
  getVideoGame,
  listVideoGames,
  updateVideoGame,
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

// ─── Filter sidebar ───────────────────────────────────────────────────────────

function GameFilters({ items, ownershipStatuses, playStatuses, allGenres, filters, onSectionChange, onClearAll }) {
  const visibleOwnership = ownershipStatuses.filter(s => !HIDDEN_OWNERSHIP_NAMES.has(s.status_name));

  const allPlatformOptions = useMemo(() => {
    const seen = new Set();
    const result = [];
    for (const g of items) for (const p of (g.platforms || [])) if (p && !seen.has(p)) { seen.add(p); result.push(p); }
    return result.sort().map(p => ({ id: p, label: p }));
  }, [items]);

  const allDevelopers = useMemo(() => {
    const seen = new Set();
    const result = [];
    for (const g of items) for (const d of (g.developers || [])) if (!seen.has(d)) { seen.add(d); result.push(d); }
    return result.sort().map(d => ({ id: d, label: d }));
  }, [items]);

  const allPublishers = useMemo(() => {
    const seen = new Set();
    const result = [];
    for (const g of items) for (const p of (g.publishers || [])) if (!seen.has(p)) { seen.add(p); result.push(p); }
    return result.sort().map(p => ({ id: p, label: p }));
  }, [items]);

  const allGenreLabels = useMemo(() => {
    const seen = new Set();
    const result = [];
    for (const g of items) for (const genre of (g.genres || [])) if (!seen.has(genre)) { seen.add(genre); result.push(genre); }
    return result.sort().map(g => ({ id: g, label: g }));
  }, [items]);

  const hasFilters = filters.search.trim() ||
    sectionActive(filters.ownership) || sectionActive(filters.playStatus) ||
    sectionActive(filters.platform) || sectionActive(filters.developer) ||
    sectionActive(filters.publisher) || sectionActive(filters.genre);

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
        title="Play Status"
        items={playStatuses.map(s => ({ id: s.play_status_id, label: s.status_name }))}
        section={filters.playStatus}
        onChange={s => onSectionChange("playStatus", s)}
      />
      <TriStateFilterSection
        title="Platform"
        items={allPlatformOptions}
        section={filters.platform}
        onChange={s => onSectionChange("platform", s)}
      />
      <SearchableTriStateSection
        title="Genre"
        items={allGenreLabels}
        section={filters.genre}
        onChange={s => onSectionChange("genre", s)}
      />
      <SearchableTriStateSection
        title="Developer"
        items={allDevelopers}
        section={filters.developer}
        onChange={s => onSectionChange("developer", s)}
      />
      <SearchableTriStateSection
        title="Publisher"
        items={allPublishers}
        section={filters.publisher}
        onChange={s => onSectionChange("publisher", s)}
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

// ─── NameList (edit modal) ────────────────────────────────────────────────────

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

// ─── Copies editor (edit modal) ───────────────────────────────────────────────

function CopiesEditor({ copies, allPlatforms, ownershipStatuses, onChange }) {
  function update(idx, key, val) {
    const next = [...copies];
    next[idx] = { ...next[idx], [key]: val };
    onChange(next);
  }
  function add() { onChange([...copies, { platform_id: "", edition: "", ownership_status_id: "", notes: "" }]); }
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
              <select value={copy.platform_id || ""} onChange={e => update(i, "platform_id", e.target.value)} style={selectStyle}>
                <option value="">Select platform…</option>
                {allPlatforms.map(p => <option key={p.platform_id} value={p.platform_id}>{p.platform_name}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Edition</label>
              <input value={copy.edition || ""} onChange={e => update(i, "edition", e.target.value)} style={inputStyle} placeholder="e.g. Collector's Edition" />
            </div>
          </div>
          <div>
            <label style={labelStyle}>Ownership</label>
            <select value={copy.ownership_status_id || ""} onChange={e => update(i, "ownership_status_id", e.target.value)} style={{ ...selectStyle, maxWidth: 200 }}>
              <option value="">None</option>
              {ownershipStatuses.map(s => <option key={s.ownership_status_id} value={s.ownership_status_id}>{s.status_name}</option>)}
            </select>
          </div>
        </div>
      ))}
      <button type="button" onClick={add} style={btnSm}>+ Add Copy</button>
    </div>
  );
}

// ─── Edit modal ───────────────────────────────────────────────────────────────

function EditModal({ itemId, ownershipStatuses, playStatuses, allGenres, allPlatforms, onClose, onSaved, onDeleted }) {
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState("");
  const coverFileRef = useRef(null);

  async function handleCoverFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const { url } = await uploadCover(file, "videogames", itemId);
      set("coverImageUrl", url);
    } catch (err) {
      setError(err.message || "Cover upload failed.");
    }
    if (coverFileRef.current) coverFileRef.current.value = "";
  }

  useEffect(() => {
    getVideoGame(itemId).then(d => {
      setForm({
        title: d.title || "",
        releaseDate: d.release_date || "",
        description: d.description || "",
        coverImageUrl: d.cover_image_url || "",
        ownershipStatusId: String(d.ownership_status_id),
        playStatusId: d.play_status_id ? String(d.play_status_id) : "",
        notes: d.notes || "",
        developers: d.developers?.length ? d.developers.map(dev => dev.developer_name) : [""],
        publishers: d.publishers?.length ? d.publishers.map(p => p.publisher_name) : [""],
        genres: d.genres?.map(g => ({ top_genre_id: g.top_genre_id, sub_genre_id: g.sub_genre_id })) || [],
        copies: d.copies?.map(c => ({
          platform_id: c.platform_id ? String(c.platform_id) : "",
          edition: c.edition || "",
          ownership_status_id: c.ownership_status_id ? String(c.ownership_status_id) : "",
          notes: c.notes || "",
        })) || [],
      });
    }).catch(() => setError("Failed to load game."));
  }, [itemId]);

  function set(key, val) { setForm(f => ({ ...f, [key]: val })); }

  async function handleSave() {
    if (!form.title.trim()) { setError("Title is required."); return; }
    setSaving(true); setError("");
    try {
      await updateVideoGame(itemId, {
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
      });
      onSaved();
    } catch (err) {
      setError(err.message || "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    setSaving(true);
    try {
      await deleteVideoGame(itemId);
      onDeleted();
    } catch (err) {
      setError(err.message || "Delete failed.");
      setSaving(false);
    }
  }

  if (!form) return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ background: "var(--bg-surface)", borderRadius: 6, padding: 24, minWidth: 300 }}>
        {error ? <p style={{ color: "red" }}>{error}</p> : <p style={{ fontSize: 13 }}>Loading…</p>}
        <button onClick={onClose} style={btnSecondary}>Close</button>
      </div>
    </div>
  );

  const visibleOwnership = ownershipStatuses.filter(s => !HIDDEN_OWNERSHIP_NAMES.has(s.status_name));

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: "var(--bg-surface)", borderRadius: 6, width: 700, maxWidth: "95vw", maxHeight: "90vh", overflow: "auto", boxShadow: "0 4px 24px rgba(0,0,0,0.3)" }}>
        {/* Header */}
        <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontWeight: 700, fontSize: 15 }}>Edit Game</span>
          <button onClick={onClose} style={{ ...btnSm, fontSize: 14 }}>✕</button>
        </div>

        {/* Cover banner */}
        {form.coverImageUrl && (
          <div style={{ padding: "10px 16px 0", display: "flex", gap: 12 }}>
            <img src={form.coverImageUrl} alt="cover" style={{ width: 60, height: 85, objectFit: "cover", border: "1px solid var(--border)", borderRadius: 3 }} onError={() => {}} />
          </div>
        )}

        <div style={{ padding: 16 }}>
          {error && <div style={alertError}>{error}</div>}

          <div style={{ marginBottom: 10 }}>
            <label style={labelStyle}>Title *</label>
            <input value={form.title} onChange={e => set("title", e.target.value)} style={inputStyle} />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
            <div>
              <label style={labelStyle}>Ownership *</label>
              <select value={form.ownershipStatusId} onChange={e => set("ownershipStatusId", e.target.value)} style={selectStyle}>
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

          <div style={{ marginBottom: 10 }}>
            <label style={labelStyle}>Release Date</label>
            <input value={form.releaseDate} onChange={e => set("releaseDate", e.target.value)} style={{ ...inputStyle, maxWidth: 180 }} placeholder="YYYY-MM-DD" />
          </div>

          <div style={{ marginBottom: 10 }}>
            <label style={labelStyle}>Developer(s)</label>
            <NameList names={form.developers} onChange={v => set("developers", v)} addLabel="+ Developer" placeholder="Developer name" />
          </div>

          <div style={{ marginBottom: 10 }}>
            <label style={labelStyle}>Publisher(s)</label>
            <NameList names={form.publishers} onChange={v => set("publishers", v)} addLabel="+ Publisher" placeholder="Publisher name" />
          </div>

          <div style={{ marginBottom: 10 }}>
            <label style={labelStyle}>Genre</label>
            <GenrePicker allGenres={allGenres} selected={form.genres} onChange={v => set("genres", v)} />
          </div>

          <div style={{ marginBottom: 10 }}>
            <label style={labelStyle}>Cover Image URL</label>
            <div style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
              <input value={form.coverImageUrl} onChange={e => set("coverImageUrl", e.target.value)} style={{ ...inputStyle, flex: 1 }} placeholder="https://…" />
              <input type="file" accept="image/*" ref={coverFileRef} onChange={handleCoverFile} style={{ display: "none" }} />
              <button type="button" onClick={() => coverFileRef.current?.click()} style={{ padding: "4px 10px", fontSize: 12, whiteSpace: "nowrap" }}>Add Image</button>
              {form.coverImageUrl && <img src={getImageUrl(form.coverImageUrl)} alt="cover" style={{ height: 48, width: 34, objectFit: "cover", borderRadius: 2, border: "1px solid var(--border)" }} onError={e => { e.target.style.display = "none"; }} />}
            </div>
          </div>

          <div style={{ marginBottom: 10 }}>
            <label style={labelStyle}>Description</label>
            <textarea value={form.description} onChange={e => set("description", e.target.value)} style={{ ...inputStyle, height: 60, resize: "vertical" }} />
          </div>

          <div style={{ marginBottom: 14 }}>
            <label style={labelStyle}>Notes</label>
            <textarea value={form.notes} onChange={e => set("notes", e.target.value)} style={{ ...inputStyle, height: 50, resize: "vertical" }} />
          </div>

          <div style={{ marginBottom: 4 }}>
            <label style={{ ...labelStyle, marginBottom: 6 }}>Copies</label>
            <CopiesEditor
              copies={form.copies}
              allPlatforms={allPlatforms}
              ownershipStatuses={visibleOwnership}
              onChange={v => set("copies", v)}
            />
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: "10px 16px", borderTop: "1px solid var(--border)", display: "flex", gap: 8, justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={handleSave} disabled={saving} style={btnPrimary}>{saving ? "Saving…" : "Save"}</button>
            <button onClick={onClose} style={btnSecondary}>Cancel</button>
          </div>
          {confirmDelete ? (
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <span style={{ fontSize: 12, color: "var(--error)" }}>Delete this game?</span>
              <button onClick={handleDelete} disabled={saving} style={{ ...btnDanger, fontSize: 12, padding: "3px 10px" }}>Yes, delete</button>
              <button onClick={() => setConfirmDelete(false)} style={{ ...btnSm }}>No</button>
            </div>
          ) : (
            <button onClick={() => setConfirmDelete(true)} style={{ ...btnSm, color: "var(--error)", border: "1px solid var(--error)" }}>Delete</button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Bulk edit panel ──────────────────────────────────────────────────────────

function BulkEditPanel({ selectedIds, ownershipStatuses, playStatuses, onDone, onDeleted }) {
  const [ownershipId, setOwnershipId] = useState("");
  const [playStatusId, setPlayStatusId] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState("");

  const visibleOwnership = ownershipStatuses.filter(s => !HIDDEN_OWNERSHIP_NAMES.has(s.status_name));

  async function handleApply() {
    if (!ownershipId && !playStatusId) return;
    setSaving(true); setError("");
    try {
      const fields = {};
      if (ownershipId) fields.ownership_status_id = parseInt(ownershipId, 10);
      if (playStatusId) fields.play_status_id = parseInt(playStatusId, 10);
      await bulkUpdateVideoGames(selectedIds, fields);
      onDone();
    } catch (err) {
      setError(err.message || "Bulk update failed.");
      setSaving(false);
    }
  }

  async function handleDelete() {
    setSaving(true);
    try {
      await bulkDeleteVideoGames(selectedIds);
      onDeleted();
    } catch (err) {
      setError(err.message || "Bulk delete failed.");
      setSaving(false);
    }
  }

  return (
    <div style={{ background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 4, padding: "8px 12px", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
      <span style={{ fontSize: 12, fontWeight: "bold", color: "var(--text-secondary)" }}>{selectedIds.length} selected</span>
      <select value={ownershipId} onChange={e => setOwnershipId(e.target.value)} style={{ ...selectStyle, width: "auto", minWidth: 120, fontSize: 12 }}>
        <option value="">Ownership…</option>
        {visibleOwnership.map(s => <option key={s.ownership_status_id} value={s.ownership_status_id}>{s.status_name}</option>)}
      </select>
      <select value={playStatusId} onChange={e => setPlayStatusId(e.target.value)} style={{ ...selectStyle, width: "auto", minWidth: 130, fontSize: 12 }}>
        <option value="">Play Status…</option>
        {playStatuses.map(s => <option key={s.play_status_id} value={s.play_status_id}>{s.status_name}</option>)}
      </select>
      <button onClick={handleApply} disabled={saving || (!ownershipId && !playStatusId)} style={{ ...btnPrimary, fontSize: 12, padding: "4px 10px" }}>Apply</button>
      {error && <span style={{ fontSize: 11, color: "var(--error)" }}>{error}</span>}
      <div style={{ marginLeft: "auto" }}>
        {confirmDelete ? (
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <span style={{ fontSize: 12, color: "var(--error)" }}>Delete {selectedIds.length} games?</span>
            <button onClick={handleDelete} disabled={saving} style={{ ...btnDanger, fontSize: 12, padding: "3px 10px" }}>Yes</button>
            <button onClick={() => setConfirmDelete(false)} style={btnSm}>No</button>
          </div>
        ) : (
          <button onClick={() => setConfirmDelete(true)} style={{ ...btnSm, color: "var(--error)", border: "1px solid var(--error)" }}>Delete {selectedIds.length}</button>
        )}
      </div>
    </div>
  );
}

// ─── Ownership badge ──────────────────────────────────────────────────────────

const OWNERSHIP_COLORS = { Owned: "#39ff14", Wanted: "#ffff00", Trade: "#00ffff" };
function OwnershipBadge({ label }) {
  const letter = label ? label[0] : "?";
  const color = OWNERSHIP_COLORS[label] || "#aaa";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 18, height: 18, borderRadius: "50%", background: "#111", color, fontSize: 10, fontWeight: "bold", border: `1px solid ${color}`, flexShrink: 0 }}>{letter}</span>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

const emptyFilters = () => ({
  search: "",
  ownership: emptySection(),
  playStatus: emptySection(),
  platform: emptySection(),
  genre: emptySection(),
  developer: emptySection(),
  publisher: emptySection(),
});

export default function VideoGamesLibraryPage() {
  const [games, setGames] = useState([]);
  const [ownershipStatuses, setOwnershipStatuses] = useState([]);
  const [playStatuses, setPlayStatuses] = useState([]);
  const [allGenres, setAllGenres] = useState([]);
  const [allPlatforms, setAllPlatforms] = useState([]);
  const [filters, setFilters] = useState(emptyFilters());
  const [selectedIds, setSelectedIds] = useState([]);
  const [editId, setEditId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showThumbnails, setShowThumbnails] = useState(false);

  function loadGames() {
    return listVideoGames().then(setGames);
  }

  useEffect(() => {
    setLoading(true);
    Promise.all([
      listVideoGames(),
      fetchOwnershipStatuses(),
      fetchGamePlayStatuses(),
      fetchGameGenres(),
      fetchGamePlatforms(),
    ]).then(([gs, own, play, genres, platforms]) => {
      setGames(gs);
      setOwnershipStatuses(own);
      setPlayStatuses(play);
      setAllGenres(genres);
      setAllPlatforms(platforms);
      setLoading(false);
    }).catch(err => {
      setError(err.message || "Failed to load.");
      setLoading(false);
    });
  }, []);

  function handleSectionChange(key, val) {
    setFilters(f => ({ ...f, [key]: val }));
  }

  function handleClearAll() { setFilters(emptyFilters()); }

  const filteredGames = useMemo(() => {
    let result = games;
    const q = filters.search.trim().toLowerCase();
    if (q) result = result.filter(g => g.title.toLowerCase().includes(q));
    if (sectionActive(filters.ownership))
      result = result.filter(g => applySection(filters.ownership, [g.ownership_status_id]));
    if (sectionActive(filters.playStatus))
      result = result.filter(g => applySection(filters.playStatus, g.play_status_id != null ? [g.play_status_id] : []));
    if (sectionActive(filters.platform))
      result = result.filter(g => applySection(filters.platform, g.platforms || []));
    if (sectionActive(filters.developer))
      result = result.filter(g => applySection(filters.developer, g.developers || []));
    if (sectionActive(filters.publisher))
      result = result.filter(g => applySection(filters.publisher, g.publishers || []));
    if (sectionActive(filters.genre))
      result = result.filter(g => applySection(filters.genre, g.genres || []));
    return result;
  }, [games, filters]);

  function toggleSelect(id) {
    setSelectedIds(ids => ids.includes(id) ? ids.filter(i => i !== id) : [...ids, id]);
  }

  function toggleSelectAll() {
    if (selectedIds.length === filteredGames.length) setSelectedIds([]);
    else setSelectedIds(filteredGames.map(g => g.item_id));
  }

  const allSelected = filteredGames.length > 0 && selectedIds.length === filteredGames.length;

  if (loading) return <div style={{ padding: 24, fontSize: 13 }}>Loading…</div>;
  if (error) return <div style={{ padding: 24 }}><p style={alertError}>{error}</p></div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden" }}>
      {/* Controls bar */}
      <div style={{ padding: "6px 12px", borderBottom: "1px solid var(--border)", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", background: "var(--surface)", flexShrink: 0 }}>
        <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>
          {filteredGames.length} game{filteredGames.length !== 1 ? "s" : ""}
          {selectedIds.length > 0 && ` · ${selectedIds.length} selected`}
        </span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          <button
            onClick={() => setShowThumbnails(t => !t)}
            style={{ ...btnSm, background: showThumbnails ? "var(--btn-primary-bg)" : undefined, color: showThumbnails ? "var(--btn-primary-text)" : undefined }}
          >
            Thumbnails
          </button>
        </div>
      </div>

      {/* Bulk edit */}
      {selectedIds.length > 0 && (
        <div style={{ padding: "6px 12px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
          <BulkEditPanel
            selectedIds={selectedIds}
            ownershipStatuses={ownershipStatuses}
            playStatuses={playStatuses}
            onDone={() => { loadGames(); setSelectedIds([]); }}
            onDeleted={() => { loadGames(); setSelectedIds([]); }}
          />
        </div>
      )}

      {/* Body */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        <GameFilters
          items={games}
          ownershipStatuses={ownershipStatuses}
          playStatuses={playStatuses}
          allGenres={allGenres}
          filters={filters}
          onSectionChange={handleSectionChange}
          onClearAll={handleClearAll}
        />

        <div style={{ flex: 1, overflow: "auto" }}>
          {filteredGames.length === 0 ? (
            <p style={{ padding: 20, fontSize: 13, color: "var(--text-secondary)" }}>No games match current filters.</p>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: "var(--surface-2)", borderBottom: "2px solid var(--border)" }}>
                  <th style={{ padding: "5px 8px", width: 28, textAlign: "center" }}>
                    <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} />
                  </th>
                  {showThumbnails && <th style={{ padding: "5px 6px", width: 44 }}></th>}
                  <th style={{ padding: "5px 8px", textAlign: "left" }}>Title</th>
                  <th style={{ padding: "5px 8px", textAlign: "left" }}>Platform(s)</th>
                  <th style={{ padding: "5px 8px", textAlign: "left" }}>Developer</th>
                  <th style={{ padding: "5px 8px", textAlign: "left" }}>Genre</th>
                  <th style={{ padding: "5px 8px", textAlign: "left" }}>Play Status</th>
                  <th style={{ padding: "5px 8px", width: 28, textAlign: "center" }}>Own</th>
                </tr>
              </thead>
              <tbody>
                {filteredGames.map(g => (
                  <tr
                    key={g.item_id}
                    onClick={() => setEditId(g.item_id)}
                    style={{
                      borderBottom: "1px solid var(--border)",
                      cursor: "pointer",
                      background: selectedIds.includes(g.item_id) ? "var(--row-selected, #e8f5e9)" : undefined,
                    }}
                    onMouseEnter={e => { if (!selectedIds.includes(g.item_id)) e.currentTarget.style.background = "var(--row-hover, #f5f5f5)"; }}
                    onMouseLeave={e => { e.currentTarget.style.background = selectedIds.includes(g.item_id) ? "var(--row-selected, #e8f5e9)" : ""; }}
                  >
                    <td style={{ padding: "4px 8px", textAlign: "center" }} onClick={e => { e.stopPropagation(); toggleSelect(g.item_id); }}>
                      <input type="checkbox" checked={selectedIds.includes(g.item_id)} onChange={() => {}} />
                    </td>
                    {showThumbnails && (
                      <td style={{ padding: "2px 4px" }}>
                        {getImageUrl(g.cover_image_url)
                          ? <img src={getImageUrl(g.cover_image_url)} alt="" style={{ width: 36, height: 50, objectFit: "cover", display: "block" }} />
                          : <div style={{ width: 36, height: 50, background: "var(--border)", borderRadius: 2 }} />}
                      </td>
                    )}
                    <td style={{ padding: "4px 8px", fontWeight: 500, color: "var(--text-primary)" }}>{g.title}</td>
                    <td style={{ padding: "4px 8px", color: "var(--text-secondary)" }}>
                      {(g.platforms || []).join(", ") || "—"}
                    </td>
                    <td style={{ padding: "4px 8px", color: "var(--text-secondary)" }}>{(g.developers || []).join(", ") || "—"}</td>
                    <td style={{ padding: "4px 8px", color: "var(--text-secondary)" }}>
                      {(g.genres || []).slice(0, 2).join(", ")}{g.genres?.length > 2 ? "…" : ""}
                    </td>
                    <td style={{ padding: "4px 8px", color: "var(--text-secondary)" }}>{g.play_status || "—"}</td>
                    <td style={{ padding: "4px 8px", textAlign: "center" }}>
                      <OwnershipBadge label={g.ownership_status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {editId && (
        <EditModal
          itemId={editId}
          ownershipStatuses={ownershipStatuses}
          playStatuses={playStatuses}
          allGenres={allGenres}
          allPlatforms={allPlatforms}
          onClose={() => setEditId(null)}
          onSaved={() => { setEditId(null); loadGames(); }}
          onDeleted={() => { setEditId(null); loadGames(); setSelectedIds(ids => ids.filter(i => i !== editId)); }}
        />
      )}
    </div>
  );
}
