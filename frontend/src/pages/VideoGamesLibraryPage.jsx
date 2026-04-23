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
  bulkDeleteVideoGames,
  bulkUpdateVideoGames,
  deleteVideoGame,
  fetchGameGenres,
  fetchGamePlatforms,
  fetchConsumptionStatuses,
  fetchOwnershipStatuses,
  getVideoGame,
  listVideoGames,
  updateVideoGame,
  uploadCover,
} from "../api";
import { getImageUrl } from "../utils/imageUrl";
import { labelStyle, inputStyle, selectStyle, btnPrimary, btnSecondary, btnSm, btnDanger, alertError, GRID_SIZES } from "../styles/commonStyles";
import NameList from "../components/shared/NameList";
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

function GameFilters({ items, ownershipStatuses, playStatuses, filters, onSectionChange, onClearAll }) {
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
        defaultShown={2}
        items={ownershipStatuses.map(s => ({ id: s.ownership_status_id, label: s.status_name }))}
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
        <div key={i} style={{ marginBottom: 8, padding: "8px 10px", border: "1px solid var(--border)", borderRadius: 3, background: "var(--bg-surface)" }}>
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

// ─── Grid item ────────────────────────────────────────────────────────────────

const VideoGameGridItem = memo(function VideoGameGridItem({ game, isSelected, onToggleSelect, onClick, gridSize, showCaptions }) {
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
            onChange={() => onToggleSelect(game.item_id)}
            onClick={(e) => e.stopPropagation()}
            style={{ margin: 0, cursor: "pointer" }} />
        </div>
        <OwnershipBadge statusName={game.ownership_status} />
        {game.cover_image_url ? (
          <img src={getImageUrl(game.cover_image_url)} alt="" style={{ width: w, height: h, objectFit: "cover", display: "block", borderRadius: 2 }} />
        ) : (
          <div style={{ width: w, height: h, background: "var(--bg-surface)", borderRadius: 2, border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ fontSize: 10, color: "var(--text-muted)" }}>No Cover</span>
          </div>
        )}
      </div>
      {showCaptions && (
        <div style={{ padding: "3px 2px 0", maxWidth: w }}>
          <div style={{ fontSize: 11, fontWeight: "700", lineHeight: "1.3", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-primary)" }}>{game.title}</div>
          <div style={{ fontSize: 10, color: "var(--text-muted)", lineHeight: "1.3", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{(game.platforms || []).join(", ")}</div>
        </div>
      )}
    </div>
  );
});

// ─── Detail modal ─────────────────────────────────────────────────────────────

function VideoGameDetailModal({ itemId, ownershipStatuses, playStatuses, allGenres, allPlatforms, onClose, onSaved, onDeleted }) {
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
    setDeleting(true);
    try {
      await deleteVideoGame(itemId);
      onDeleted();
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
          <div style={{ fontWeight: "bold", fontSize: 14 }}>{!form ? "Loading..." : form.title || "Game Detail"}</div>
          <button type="button" onClick={onClose} style={{ ...btnSm, fontSize: 14, padding: "2px 8px" }}>✕</button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
          {!form && !error && <div style={{ color: "#999" }}>Loading…</div>}
          {error && <div style={alertError}>{error}</div>}

          {form && (
            <>
              {form.coverImageUrl && (
                <div style={{ display: "flex", gap: 12, marginBottom: 14 }}>
                  <img src={getImageUrl(form.coverImageUrl)} alt="cover" style={{ height: 100, width: "auto", borderRadius: 3, border: "1px solid #ddd", flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: "bold", fontSize: 14, marginBottom: 2 }}>{form.title}</div>
                    <div style={{ fontSize: 12, color: "#555" }}>{form.developers.filter(Boolean).join(", ")}</div>
                  </div>
                </div>
              )}

              <div style={{ marginBottom: 10 }}>
                <label style={labelStyle}>Title *</label>
                <input value={form.title} onChange={e => set("title", e.target.value)} style={inputStyle} />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
                <div>
                  <label style={labelStyle}>Ownership *</label>
                  <select value={form.ownershipStatusId} onChange={e => set("ownershipStatusId", e.target.value)} style={selectStyle}>
                    {ownershipStatuses.map(s => <option key={s.ownership_status_id} value={s.ownership_status_id}>{s.status_name}</option>)}
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
                  {form.coverImageUrl && <img src={getImageUrl(form.coverImageUrl)} alt="cover" style={{ height: 40, width: "auto", borderRadius: 2, border: "1px solid #ddd", flexShrink: 0 }} />}
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
                  ownershipStatuses={ownershipStatuses}
                  onChange={v => set("copies", v)}
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
                    <span style={{ fontSize: 12, color: "#c62828" }}>Delete this game?</span>
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

function VideoGameBulkEdit({ selectedIds, ownershipStatuses, playStatuses, onClose, onSaved, onDeleted }) {
  const fieldStyle = { width: "100%", padding: "5px 6px", fontSize: 13, border: "1px solid #ccc", borderRadius: 3 };

  const [updateOwnership, setUpdateOwnership] = useState(false);
  const [ownershipId, setOwnershipId] = useState(String(ownershipStatuses[0]?.ownership_status_id || ""));
  const [updatePlayStatus, setUpdatePlayStatus] = useState(false);
  const [playStatusId, setPlayStatusId] = useState(String(playStatuses[0]?.play_status_id || ""));

  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState("");

  const anyEnabled = updateOwnership || updatePlayStatus;

  async function handleSave() {
    if (!anyEnabled) { setError("Select at least one field to update."); return; }
    const fields = {};
    if (updateOwnership) fields.ownership_status_id = Number(ownershipId);
    if (updatePlayStatus) fields.play_status_id = Number(playStatusId);
    setSaving(true); setError("");
    try { await bulkUpdateVideoGames(selectedIds, fields); onSaved(); }
    catch (err) { setError(err.message || "Failed to update"); }
    finally { setSaving(false); }
  }

  async function handleDelete() {
    if (!confirmDelete) { setConfirmDelete(true); return; }
    setDeleting(true);
    try { await bulkDeleteVideoGames(selectedIds); onDeleted(); }
    catch (err) { setError(err.message || "Failed to delete"); setConfirmDelete(false); }
    finally { setDeleting(false); }
  }

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: "#fff", border: "1px solid #ddd", borderRadius: 6, width: 420, maxHeight: "85vh", display: "flex", flexDirection: "column", boxShadow: "0 2px 12px rgba(0,0,0,0.15)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", borderBottom: "1px solid #e0e0e0", flexShrink: 0 }}>
          <span style={{ fontWeight: "bold", fontSize: 14 }}>Bulk Edit — {selectedIds.length} game{selectedIds.length !== 1 ? "s" : ""}</span>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 15, cursor: "pointer", color: "#666" }}>✕</button>
        </div>
        {error && <div style={{ margin: "8px 14px 0", padding: "7px 10px", background: "#ffebee", border: "1px solid #c62828", borderRadius: 3, fontSize: 13, color: "#c62828", flexShrink: 0 }}>{error}</div>}
        <div style={{ padding: "12px 14px", overflowY: "auto", flex: 1 }}>
          <BulkField label="Ownership" enabled={updateOwnership} onToggle={() => setUpdateOwnership((p) => !p)}>
            <select value={ownershipId} onChange={(e) => setOwnershipId(e.target.value)} style={fieldStyle}>
              {ownershipStatuses.map((s) => <option key={s.ownership_status_id} value={s.ownership_status_id}>{s.status_name}</option>)}
            </select>
          </BulkField>
          <BulkField label="Play Status" enabled={updatePlayStatus} onToggle={() => setUpdatePlayStatus((p) => !p)}>
            <select value={playStatusId} onChange={(e) => setPlayStatusId(e.target.value)} style={fieldStyle}>
              {playStatuses.map((s) => <option key={s.play_status_id} value={s.play_status_id}>{s.status_name}</option>)}
            </select>
          </BulkField>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", borderTop: "1px solid #e0e0e0", flexShrink: 0 }}>
          <div>
            {!confirmDelete
              ? <button onClick={handleDelete} disabled={deleting || saving} style={{ padding: "5px 12px", fontSize: 13, cursor: "pointer", border: "1px solid #c62828", borderRadius: 3, background: "#fff", color: "#c62828" }}>Delete {selectedIds.length} game{selectedIds.length !== 1 ? "s" : ""}</button>
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
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [editId, setEditId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [viewMode, setViewMode] = useState("table");
  const [showThumbnails, setShowThumbnails] = useState(false);
  const [gridSize, setGridSize] = useState("m");
  const [showCaptions, setShowCaptions] = useState(true);

  const [sortField, setSortField] = useState("title");
  const [sortDir, setSortDir] = useState("asc");

  const [colWidths, setColWidths] = useState({
    title: 220, platform: 150, developer: 150, genre: 150, playStatus: 110, ownership: 110,
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

  function loadGames() {
    return listVideoGames().then(setGames);
  }

  useEffect(() => {
    setLoading(true);
    Promise.all([
      listVideoGames(),
      fetchOwnershipStatuses(COLLECTION_TYPE_IDS.videogames),
      fetchConsumptionStatuses(COLLECTION_TYPE_IDS.videogames),
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

  const sortedGames = useMemo(() => {
    const arr = [...filteredGames];
    const flip = sortDir === "desc" ? -1 : 1;
    switch (sortField) {
      case "playStatus":
        return arr.sort((a, b) => flip * ((a.play_status || "").localeCompare(b.play_status || "")));
      case "ownership":
        return arr.sort((a, b) => flip * ((a.ownership_status || "").localeCompare(b.ownership_status || "")));
      default:
        return arr.sort((a, b) => flip * ((a.title_sort || a.title || "").localeCompare(b.title_sort || b.title || "")));
    }
  }, [filteredGames, sortField, sortDir]);

  function toggleSelect(id) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function clearSelection() { setSelectedIds(new Set()); }

  function toggleSelectAll() {
    if (sortedGames.length > 0 && sortedGames.every(g => selectedIds.has(g.item_id))) clearSelection();
    else setSelectedIds(new Set(sortedGames.map(g => g.item_id)));
  }

  const allVisibleSelected = sortedGames.length > 0 && sortedGames.every(g => selectedIds.has(g.item_id));

  if (loading) return <div style={{ padding: 24, fontSize: 13 }}>Loading…</div>;
  if (error) return <div style={{ padding: 24 }}><p style={alertError}>{error}</p></div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden", fontSize: 13 }}>
      {/* Controls bar */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 12px", borderBottom: "1px solid var(--border)", background: "var(--bg-sidebar)", flexShrink: 0, gap: 8, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>
            {sortedGames.length} game{sortedGames.length !== 1 ? "s" : ""}
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

      {/* Body */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        <GameFilters
          items={games}
          ownershipStatuses={ownershipStatuses}
          playStatuses={playStatuses}
          filters={filters}
          onSectionChange={handleSectionChange}
          onClearAll={handleClearAll}
        />

        <div style={{ flex: 1, overflowY: "auto", overflowX: "auto", padding: 0 }}>
          {sortedGames.length === 0 ? (
            <p style={{ padding: 20, fontSize: 13, color: "var(--text-secondary)" }}>No games match current filters.</p>
          ) : viewMode === "grid" ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, padding: 12, alignContent: "flex-start" }}>
              {sortedGames.map(g => (
                <VideoGameGridItem key={g.item_id} game={g}
                  isSelected={selectedIds.has(g.item_id)}
                  onToggleSelect={toggleSelect}
                  onClick={() => setEditId(g.item_id)}
                  gridSize={gridSize} showCaptions={showCaptions} />
              ))}
            </div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, tableLayout: "fixed" }}>
              <colgroup>
                <col style={{ width: 28 }} />
                {showThumbnails && <col style={{ width: 50 }} />}
                <col style={{ width: colWidths.title }} />
                <col style={{ width: colWidths.platform }} />
                <col style={{ width: colWidths.developer }} />
                <col style={{ width: colWidths.genre }} />
                <col style={{ width: colWidths.playStatus }} />
                <col style={{ width: colWidths.ownership }} />
              </colgroup>
              <thead style={{ position: "sticky", top: 0, zIndex: 2 }}>
                <tr style={{ background: "var(--bg-sidebar)", borderBottom: "1px solid var(--border)" }}>
                  <th style={{ padding: "5px 6px", textAlign: "center", borderRight: "1px solid var(--border)" }}>
                    <input type="checkbox" checked={allVisibleSelected} onChange={toggleSelectAll} style={{ margin: 0, cursor: "pointer" }} />
                  </th>
                  {showThumbnails && <th style={{ padding: "5px 6px", borderRight: "1px solid var(--border)" }} />}
                  {[
                    { key: "title", label: "Title", colKey: "title" },
                    { key: null, label: "Platform(s)", colKey: "platform" },
                    { key: null, label: "Developer", colKey: "developer" },
                    { key: null, label: "Genre", colKey: "genre" },
                    { key: "playStatus", label: "Play Status", colKey: "playStatus" },
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
                {sortedGames.map(g => {
                  const isSelected = selectedIds.has(g.item_id);
                  return (
                    <tr
                      key={g.item_id}
                      onClick={() => setEditId(g.item_id)}
                      style={{ cursor: "pointer", borderBottom: "1px solid var(--border)", background: isSelected ? "var(--green-light)" : undefined }}
                      onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = "var(--bg-surface)"; }}
                      onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = ""; }}
                    >
                      <td style={{ padding: "3px 6px", verticalAlign: "middle", width: 28 }} onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(g.item_id)} style={{ margin: 0, cursor: "pointer" }} />
                      </td>
                      {showThumbnails && (
                        <td style={{ padding: "3px 6px", verticalAlign: "middle", width: 50 }}>
                          {g.cover_image_url
                            ? <img src={getImageUrl(g.cover_image_url)} alt="" style={{ width: 42, height: 60, objectFit: "cover", borderRadius: 2, border: "1px solid var(--border)", display: "block" }} />
                            : <div style={{ width: 42, height: 60, background: "var(--bg-surface)", borderRadius: 2 }} />}
                        </td>
                      )}
                      <td style={{ padding: "3px 8px", fontWeight: 500, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{g.title}</td>
                      <td style={{ padding: "3px 8px", fontSize: 12, color: "var(--text-secondary)", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{(g.platforms || []).join(", ") || "—"}</td>
                      <td style={{ padding: "3px 8px", fontSize: 12, color: "var(--text-secondary)", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{(g.developers || []).join(", ") || "—"}</td>
                      <td style={{ padding: "3px 8px", fontSize: 12, color: "var(--text-secondary)", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
                        {(g.genres || []).slice(0, 2).join(", ")}{g.genres?.length > 2 ? "…" : ""}
                      </td>
                      <td style={{ padding: "3px 8px", fontSize: 12, color: "var(--text-secondary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{g.play_status || "—"}</td>
                      <td style={{ padding: "3px 8px", fontSize: 12, color: "var(--text-secondary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{g.ownership_status || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {editId && (
        <VideoGameDetailModal
          itemId={editId}
          ownershipStatuses={ownershipStatuses}
          playStatuses={playStatuses}
          allGenres={allGenres}
          allPlatforms={allPlatforms}
          onClose={() => setEditId(null)}
          onSaved={() => { setEditId(null); loadGames(); }}
          onDeleted={() => {
            setEditId(null);
            loadGames();
            setSelectedIds(prev => { const next = new Set(prev); next.delete(editId); return next; });
          }}
        />
      )}

      {bulkEditOpen && (
        <VideoGameBulkEdit
          selectedIds={[...selectedIds]}
          ownershipStatuses={ownershipStatuses}
          playStatuses={playStatuses}
          onClose={() => setBulkEditOpen(false)}
          onSaved={async () => { setBulkEditOpen(false); clearSelection(); loadGames(); }}
          onDeleted={async () => { setBulkEditOpen(false); clearSelection(); loadGames(); }}
        />
      )}
    </div>
  );
}
