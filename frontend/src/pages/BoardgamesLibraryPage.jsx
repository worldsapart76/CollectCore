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
  bulkDeleteBoardgames,
  bulkUpdateBoardgames,
  deleteBoardgame,
  fetchBoardgameCategories,
  fetchOwnershipStatuses,
  getBoardgame,
  listBoardgames,
  updateBoardgame,
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

function BoardgameFilters({ items, categories, ownershipStatuses, filters, onSectionChange, onClearAll }) {
  const allDesigners = useMemo(() => {
    const seen = new Set();
    const result = [];
    for (const g of items) for (const d of (g.designers || [])) if (!seen.has(d)) { seen.add(d); result.push(d); }
    return result.sort().map(d => ({ id: d, label: d }));
  }, [items]);

  const allPublishers = useMemo(() => {
    const seen = new Set();
    const result = [];
    for (const g of items) if (g.publisher_name && !seen.has(g.publisher_name)) { seen.add(g.publisher_name); result.push(g.publisher_name); }
    return result.sort().map(p => ({ id: p, label: p }));
  }, [items]);

  const hasFilters = filters.search.trim() ||
    sectionActive(filters.ownership) || sectionActive(filters.category) ||
    sectionActive(filters.designer) || sectionActive(filters.publisher);

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
        title="Player Count"
        items={categories.map(c => ({ id: c.top_level_category_id, label: c.category_name }))}
        section={filters.category}
        onChange={s => onSectionChange("category", s)}
      />
      <SearchableTriStateSection
        title="Designer"
        items={allDesigners}
        section={filters.designer}
        onChange={s => onSectionChange("designer", s)}
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

// ─── Expansions editor (edit modal) ──────────────────────────────────────────

function ExpansionsEditor({ expansions, ownershipStatuses, onChange }) {
  function update(idx, key, val) {
    const next = [...expansions];
    next[idx] = { ...next[idx], [key]: val };
    onChange(next);
  }
  function add() { onChange([...expansions, { title: "", year_published: "", ownership_status_id: "" }]); }
  function remove(idx) { onChange(expansions.filter((_, i) => i !== idx)); }

  return (
    <div>
      {expansions.map((exp, i) => (
        <div key={i} style={{ marginBottom: 8, padding: "8px 10px", border: "1px solid var(--border)", borderRadius: 3, background: "var(--bg-surface)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <span style={{ fontSize: 11, fontWeight: "bold", color: "var(--text-secondary)" }}>Expansion {i + 1}</span>
            <button type="button" onClick={() => remove(i)} style={{ ...btnSm, color: "#c62828" }}>✕ Remove</button>
          </div>
          <div style={{ marginBottom: 6 }}>
            <label style={labelStyle}>Title</label>
            <input value={exp.title || ""} onChange={e => update(i, "title", e.target.value)} style={inputStyle} placeholder="Expansion name" />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <div>
              <label style={labelStyle}>Year</label>
              <input value={exp.year_published || ""} onChange={e => update(i, "year_published", e.target.value)} style={inputStyle} placeholder="YYYY" />
            </div>
            <div>
              <label style={labelStyle}>Ownership</label>
              <select value={exp.ownership_status_id || ""} onChange={e => update(i, "ownership_status_id", e.target.value)} style={selectStyle}>
                <option value="">None</option>
                {ownershipStatuses.map(s => <option key={s.ownership_status_id} value={s.ownership_status_id}>{s.status_name}</option>)}
              </select>
            </div>
          </div>
        </div>
      ))}
      <button type="button" onClick={add} style={btnSm}>+ Add Expansion</button>
    </div>
  );
}

// ─── Grid item ────────────────────────────────────────────────────────────────

const BoardgameGridItem = memo(function BoardgameGridItem({ game, isSelected, onToggleSelect, onClick, gridSize, showCaptions }) {
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
          <div style={{ fontSize: 10, color: "var(--text-muted)", lineHeight: "1.3", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {(game.designers || []).join(", ") || (game.year_published ? String(game.year_published) : "")}
          </div>
        </div>
      )}
    </div>
  );
});

// ─── Detail modal ─────────────────────────────────────────────────────────────

function BoardgameDetailModal({ itemId, categories, ownershipStatuses, onClose, onSaved, onDeleted }) {
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
      const { url } = await uploadCover(file, "boardgames", itemId);
      set("coverImageUrl", url);
    } catch (err) {
      setError(err.message || "Cover upload failed.");
    }
    if (coverFileRef.current) coverFileRef.current.value = "";
  }

  useEffect(() => {
    getBoardgame(itemId).then(d => {
      setForm({
        title: d.title || "",
        categoryId: String(d.top_level_category_id),
        ownershipStatusId: String(d.ownership_status_id),
        yearPublished: d.year_published ? String(d.year_published) : "",
        minPlayers: d.min_players ? String(d.min_players) : "",
        maxPlayers: d.max_players ? String(d.max_players) : "",
        designers: d.designers?.length ? d.designers.map(x => x.designer_name) : [""],
        publisherName: d.publisher_name || "",
        description: d.description || "",
        coverImageUrl: d.cover_image_url || "",
        notes: d.notes || "",
        bggId: d.external_work_id || "",
        expansions: d.expansions?.map(e => ({
          expansion_id: e.expansion_id,
          title: e.title,
          year_published: e.year_published ? String(e.year_published) : "",
          ownership_status_id: e.ownership_status_id ? String(e.ownership_status_id) : "",
          external_work_id: e.external_work_id || "",
        })) || [],
      });
    }).catch(() => setError("Failed to load board game."));
  }, [itemId]);

  function set(key, val) { setForm(f => ({ ...f, [key]: val })); }

  async function handleSave() {
    if (!form.title.trim()) { setError("Title is required."); return; }
    setSaving(true); setError("");
    try {
      await updateBoardgame(itemId, {
        title: form.title.trim(),
        top_level_category_id: parseInt(form.categoryId, 10),
        ownership_status_id: parseInt(form.ownershipStatusId, 10),
        notes: form.notes || null,
        description: form.description || null,
        year_published: form.yearPublished ? parseInt(form.yearPublished, 10) : null,
        min_players: form.minPlayers ? parseInt(form.minPlayers, 10) : null,
        max_players: form.maxPlayers ? parseInt(form.maxPlayers, 10) : null,
        publisher_name: form.publisherName.trim() || null,
        designer_names: form.designers.map(d => d.trim()).filter(Boolean),
        cover_image_url: form.coverImageUrl || null,
        api_source: form.bggId ? "bgg" : null,
        external_work_id: form.bggId || null,
        expansions: form.expansions
          .filter(e => e.title?.trim())
          .map(e => ({
            title: e.title.trim(),
            year_published: e.year_published ? parseInt(e.year_published, 10) : null,
            ownership_status_id: e.ownership_status_id ? parseInt(e.ownership_status_id, 10) : null,
            external_work_id: e.external_work_id || null,
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
      await deleteBoardgame(itemId);
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
          <div style={{ fontWeight: "bold", fontSize: 14 }}>{!form ? "Loading..." : form.title || "Board Game Detail"}</div>
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
                    <div style={{ fontSize: 12, color: "#555" }}>{form.designers.filter(Boolean).join(", ")}</div>
                  </div>
                </div>
              )}

              <div style={{ marginBottom: 10 }}>
                <label style={labelStyle}>Title *</label>
                <input value={form.title} onChange={e => set("title", e.target.value)} style={inputStyle} />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
                <div>
                  <label style={labelStyle}>Player Count *</label>
                  <select value={form.categoryId} onChange={e => set("categoryId", e.target.value)} style={selectStyle}>
                    {categories.map(c => <option key={c.top_level_category_id} value={c.top_level_category_id}>{c.category_name}</option>)}
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Ownership *</label>
                  <select value={form.ownershipStatusId} onChange={e => set("ownershipStatusId", e.target.value)} style={selectStyle}>
                    {ownershipStatuses.map(s => <option key={s.ownership_status_id} value={s.ownership_status_id}>{s.status_name}</option>)}
                  </select>
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 10 }}>
                <div>
                  <label style={labelStyle}>Year Published</label>
                  <input value={form.yearPublished} onChange={e => set("yearPublished", e.target.value)} style={inputStyle} placeholder="YYYY" />
                </div>
                <div>
                  <label style={labelStyle}>Min Players</label>
                  <input value={form.minPlayers} onChange={e => set("minPlayers", e.target.value)} style={inputStyle} type="number" min="1" />
                </div>
                <div>
                  <label style={labelStyle}>Max Players</label>
                  <input value={form.maxPlayers} onChange={e => set("maxPlayers", e.target.value)} style={inputStyle} type="number" min="1" />
                </div>
              </div>

              <div style={{ marginBottom: 10 }}>
                <label style={labelStyle}>Designer(s)</label>
                <NameList names={form.designers} onChange={v => set("designers", v)} addLabel="+ Designer" placeholder="Designer name" />
              </div>

              <div style={{ marginBottom: 10 }}>
                <label style={labelStyle}>Publisher</label>
                <input value={form.publisherName} onChange={e => set("publisherName", e.target.value)} style={inputStyle} placeholder="Publisher name" />
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
                <label style={{ ...labelStyle, marginBottom: 6 }}>Expansions</label>
                <ExpansionsEditor
                  expansions={form.expansions}
                  ownershipStatuses={ownershipStatuses}
                  onChange={v => set("expansions", v)}
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

function BoardgameBulkEdit({ selectedIds, categories, ownershipStatuses, onClose, onSaved, onDeleted }) {
  const fieldStyle = { width: "100%", padding: "5px 6px", fontSize: 13, border: "1px solid #ccc", borderRadius: 3 };

  const [updateOwnership, setUpdateOwnership] = useState(false);
  const [ownershipId, setOwnershipId] = useState(String(ownershipStatuses[0]?.ownership_status_id || ""));
  const [updateCategory, setUpdateCategory] = useState(false);
  const [categoryId, setCategoryId] = useState(String(categories[0]?.top_level_category_id || ""));

  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState("");

  const anyEnabled = updateOwnership || updateCategory;

  async function handleSave() {
    if (!anyEnabled) { setError("Select at least one field to update."); return; }
    const fields = {};
    if (updateOwnership) fields.ownership_status_id = Number(ownershipId);
    if (updateCategory) fields.top_level_category_id = Number(categoryId);
    setSaving(true); setError("");
    try { await bulkUpdateBoardgames(selectedIds, fields); onSaved(); }
    catch (err) { setError(err.message || "Failed to update"); }
    finally { setSaving(false); }
  }

  async function handleDelete() {
    if (!confirmDelete) { setConfirmDelete(true); return; }
    setDeleting(true);
    try { await bulkDeleteBoardgames(selectedIds); onDeleted(); }
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
          <BulkField label="Player Count" enabled={updateCategory} onToggle={() => setUpdateCategory((p) => !p)}>
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} style={fieldStyle}>
              {categories.map((c) => <option key={c.top_level_category_id} value={c.top_level_category_id}>{c.category_name}</option>)}
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
  category: emptySection(),
  designer: emptySection(),
  publisher: emptySection(),
});

export default function BoardgamesLibraryPage() {
  const [games, setGames] = useState([]);
  const [categories, setCategories] = useState([]);
  const [ownershipStatuses, setOwnershipStatuses] = useState([]);
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
    title: 220, year: 70, players: 80, category: 120, designers: 140, publisher: 130, expansions: 80, ownership: 110,
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
    return listBoardgames().then(setGames);
  }

  useEffect(() => {
    setLoading(true);
    Promise.all([
      listBoardgames(),
      fetchBoardgameCategories(),
      fetchOwnershipStatuses(COLLECTION_TYPE_IDS.boardgames),
    ]).then(([gs, cats, own]) => {
      setGames(gs);
      setCategories(cats);
      setOwnershipStatuses(own);
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

    if (sectionActive(filters.ownership)) {
      result = result.filter(g => applySection(filters.ownership, [g.ownership_status_id]));
    }
    if (sectionActive(filters.category)) {
      result = result.filter(g => applySection(filters.category, [g.top_level_category_id]));
    }
    if (sectionActive(filters.designer)) {
      result = result.filter(g => applySection(filters.designer, g.designers || []));
    }
    if (sectionActive(filters.publisher)) {
      result = result.filter(g => applySection(filters.publisher, g.publisher_name ? [g.publisher_name] : []));
    }
    return result;
  }, [games, filters]);

  const sortedGames = useMemo(() => {
    const arr = [...filteredGames];
    const flip = sortDir === "desc" ? -1 : 1;
    switch (sortField) {
      case "year":
        return arr.sort((a, b) => flip * ((a.year_published || 0) - (b.year_published || 0)));
      case "category":
        return arr.sort((a, b) => flip * ((a.category_name || "").localeCompare(b.category_name || "")));
      case "publisher":
        return arr.sort((a, b) => flip * ((a.publisher_name || "").localeCompare(b.publisher_name || "")));
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

  if (loading) return (
    <div style={{ padding: 20, fontSize: 13 }}>Loading…</div>
  );

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

      {error && <div style={{ ...alertError, margin: "8px 12px" }}>{error}</div>}

      {/* Body */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        <BoardgameFilters
          items={games}
          categories={categories}
          ownershipStatuses={ownershipStatuses}
          filters={filters}
          onSectionChange={handleSectionChange}
          onClearAll={handleClearAll}
        />

        <div style={{ flex: 1, overflowY: "auto", overflowX: "auto", padding: 0 }}>
          {sortedGames.length === 0 ? (
            <p style={{ padding: 20, fontSize: 13, color: "var(--text-secondary)" }}>No board games found.</p>
          ) : viewMode === "grid" ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, padding: 12, alignContent: "flex-start" }}>
              {sortedGames.map(g => (
                <BoardgameGridItem key={g.item_id} game={g}
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
                <col style={{ width: colWidths.year }} />
                <col style={{ width: colWidths.players }} />
                <col style={{ width: colWidths.category }} />
                <col style={{ width: colWidths.designers }} />
                <col style={{ width: colWidths.publisher }} />
                <col style={{ width: colWidths.expansions }} />
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
                    { key: "year", label: "Year", colKey: "year" },
                    { key: null, label: "Players", colKey: "players" },
                    { key: "category", label: "Player Count", colKey: "category" },
                    { key: null, label: "Designers", colKey: "designers" },
                    { key: "publisher", label: "Publisher", colKey: "publisher" },
                    { key: null, label: "Expansions", colKey: "expansions" },
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
                  const players = g.min_players && g.max_players
                    ? (g.min_players === g.max_players ? g.min_players : `${g.min_players}–${g.max_players}`)
                    : (g.min_players || g.max_players || "—");
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
                      <td style={{ padding: "3px 8px", fontSize: 12, color: "var(--text-secondary)", whiteSpace: "nowrap" }}>{g.year_published || "—"}</td>
                      <td style={{ padding: "3px 8px", fontSize: 12, color: "var(--text-secondary)", whiteSpace: "nowrap" }}>{players}</td>
                      <td style={{ padding: "3px 8px", fontSize: 12, color: "var(--text-secondary)", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{g.category_name}</td>
                      <td style={{ padding: "3px 8px", fontSize: 12, color: "var(--text-secondary)", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{g.designers?.join(", ") || "—"}</td>
                      <td style={{ padding: "3px 8px", fontSize: 12, color: "var(--text-secondary)", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{g.publisher_name || "—"}</td>
                      <td style={{ padding: "3px 8px", fontSize: 12, color: "var(--text-secondary)", whiteSpace: "nowrap" }}>{g.expansion_count > 0 ? g.expansion_count : "—"}</td>
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
        <BoardgameDetailModal
          itemId={editId}
          categories={categories}
          ownershipStatuses={ownershipStatuses}
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
        <BoardgameBulkEdit
          selectedIds={[...selectedIds]}
          categories={categories}
          ownershipStatuses={ownershipStatuses}
          onClose={() => setBulkEditOpen(false)}
          onSaved={async () => { setBulkEditOpen(false); clearSelection(); loadGames(); }}
          onDeleted={async () => { setBulkEditOpen(false); clearSelection(); loadGames(); }}
        />
      )}
    </div>
  );
}
