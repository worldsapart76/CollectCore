import { useCallback, useEffect, useMemo, useState } from "react";
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
  bulkDeleteBoardgames,
  bulkUpdateBoardgames,
  deleteBoardgame,
  fetchBoardgameCategories,
  fetchOwnershipStatuses,
  getBoardgame,
  listBoardgames,
  updateBoardgame,
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

function BoardgameFilters({ items, categories, ownershipStatuses, filters, onSectionChange, onClearAll }) {
  const visibleOwnership = ownershipStatuses.filter(s => !HIDDEN_OWNERSHIP_NAMES.has(s.status_name));

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
        items={visibleOwnership.map(s => ({ id: s.ownership_status_id, label: s.status_name }))}
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
        <div key={i} style={{ marginBottom: 8, padding: "8px 10px", border: "1px solid var(--border)", borderRadius: 3, background: "var(--surface-2)" }}>
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

// ─── Edit modal ───────────────────────────────────────────────────────────────

function EditModal({ itemId, categories, ownershipStatuses, onClose, onSaved, onDeleted }) {
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState("");

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
    setSaving(true);
    try {
      await deleteBoardgame(itemId);
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
      <div style={{ background: "var(--bg-surface)", borderRadius: 6, width: 680, maxWidth: "95vw", maxHeight: "90vh", overflow: "auto", boxShadow: "0 4px 24px rgba(0,0,0,0.3)" }}>
        {/* Header */}
        <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontWeight: 700, fontSize: 15 }}>Edit Board Game</span>
          <button onClick={onClose} style={{ ...btnSm, fontSize: 14 }}>✕</button>
        </div>

        {/* Cover banner */}
        {form.coverImageUrl && (
          <div style={{ padding: "10px 16px 0", display: "flex", gap: 12 }}>
            <img src={getImageUrl(form.coverImageUrl)} alt="cover" style={{ width: 60, height: 85, objectFit: "cover", border: "1px solid var(--border)", borderRadius: 3 }} onError={() => {}} />
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
              <label style={labelStyle}>Player Count *</label>
              <select value={form.categoryId} onChange={e => set("categoryId", e.target.value)} style={selectStyle}>
                {categories.map(c => <option key={c.top_level_category_id} value={c.top_level_category_id}>{c.category_name}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Ownership *</label>
              <select value={form.ownershipStatusId} onChange={e => set("ownershipStatusId", e.target.value)} style={selectStyle}>
                {visibleOwnership.map(s => <option key={s.ownership_status_id} value={s.ownership_status_id}>{s.status_name}</option>)}
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
            <input value={form.coverImageUrl} onChange={e => set("coverImageUrl", e.target.value)} style={inputStyle} placeholder="https://…" />
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
              ownershipStatuses={visibleOwnership}
              onChange={v => set("expansions", v)}
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
              <button onClick={() => setConfirmDelete(false)} style={btnSm}>No</button>
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

function BulkEditPanel({ selectedIds, categories, ownershipStatuses, onDone, onDeleted }) {
  const [ownershipId, setOwnershipId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState("");

  const visibleOwnership = ownershipStatuses.filter(s => !HIDDEN_OWNERSHIP_NAMES.has(s.status_name));

  async function handleApply() {
    if (!ownershipId && !categoryId) return;
    setSaving(true); setError("");
    try {
      const fields = {};
      if (ownershipId) fields.ownership_status_id = parseInt(ownershipId, 10);
      if (categoryId) fields.top_level_category_id = parseInt(categoryId, 10);
      await bulkUpdateBoardgames(selectedIds, fields);
      onDone();
    } catch (err) {
      setError(err.message || "Bulk update failed.");
      setSaving(false);
    }
  }

  async function handleDelete() {
    setSaving(true);
    try {
      await bulkDeleteBoardgames(selectedIds);
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
      <select value={categoryId} onChange={e => setCategoryId(e.target.value)} style={{ ...selectStyle, width: "auto", minWidth: 150, fontSize: 12 }}>
        <option value="">Player Count…</option>
        {categories.map(c => <option key={c.top_level_category_id} value={c.top_level_category_id}>{c.category_name}</option>)}
      </select>
      <button onClick={handleApply} disabled={saving || (!ownershipId && !categoryId)} style={{ ...btnPrimary, fontSize: 12, padding: "4px 10px" }}>Apply</button>
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
  category: emptySection(),
  designer: emptySection(),
  publisher: emptySection(),
});

export default function BoardgamesLibraryPage() {
  const [games, setGames] = useState([]);
  const [categories, setCategories] = useState([]);
  const [ownershipStatuses, setOwnershipStatuses] = useState([]);
  const [filters, setFilters] = useState(emptyFilters());
  const [selectedIds, setSelectedIds] = useState([]);
  const [editId, setEditId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showThumbnails, setShowThumbnails] = useState(false);

  function loadGames() {
    return listBoardgames().then(setGames);
  }

  useEffect(() => {
    setLoading(true);
    Promise.all([
      listBoardgames(),
      fetchBoardgameCategories(),
      fetchOwnershipStatuses(),
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
      result = result.filter(g => applySection(filters.ownership, g.ownership_status_id));
    }
    if (sectionActive(filters.category)) {
      result = result.filter(g => applySection(filters.category, g.top_level_category_id));
    }
    if (sectionActive(filters.designer)) {
      result = result.filter(g => (g.designers || []).some(d => applySection(filters.designer, d)));
    }
    if (sectionActive(filters.publisher)) {
      result = result.filter(g => g.publisher_name && applySection(filters.publisher, g.publisher_name));
    }
    return result;
  }, [games, filters]);

  // Selection
  const allFilteredIds = filteredGames.map(g => g.item_id);
  const allSelected = allFilteredIds.length > 0 && allFilteredIds.every(id => selectedIds.includes(id));

  function toggleSelectAll() {
    if (allSelected) setSelectedIds([]);
    else setSelectedIds(allFilteredIds);
  }

  function toggleSelect(id) {
    setSelectedIds(ids => ids.includes(id) ? ids.filter(i => i !== id) : [...ids, id]);
  }

  function handleEditClose() { setEditId(null); }

  function handleSaved() {
    setEditId(null);
    loadGames();
  }

  function handleDeleted() {
    setEditId(null);
    setSelectedIds([]);
    loadGames();
  }

  function handleBulkDone() {
    setSelectedIds([]);
    loadGames();
  }

  function handleBulkDeleted() {
    setSelectedIds([]);
    loadGames();
  }

  if (loading) return (
    <div style={{ display: "flex", height: "100%" }}>
      <div style={{ flex: 1, padding: 20, fontSize: 13 }}>Loading…</div>
    </div>
  );

  return (
    <div style={{ display: "flex", height: "100%", overflow: "hidden" }}>
      {/* Sidebar */}
      <BoardgameFilters
        items={games}
        categories={categories}
        ownershipStatuses={ownershipStatuses}
        filters={filters}
        onSectionChange={handleSectionChange}
        onClearAll={handleClearAll}
      />

      {/* Main content */}
      <div style={{ flex: 1, overflow: "auto", padding: "12px 16px" }}>
        {error && <div style={alertError}>{error}</div>}

        {/* Toolbar */}
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>
            {filteredGames.length} game{filteredGames.length !== 1 ? "s" : ""}
          </span>
          <button onClick={() => setShowThumbnails(t => !t)} style={btnSecondary}>
            {showThumbnails ? "Hide Thumbnails" : "Show Thumbnails"}
          </button>
        </div>

        {/* Bulk edit panel */}
        {selectedIds.length > 0 && (
          <div style={{ marginBottom: 10 }}>
            <BulkEditPanel
              selectedIds={selectedIds}
              categories={categories}
              ownershipStatuses={ownershipStatuses}
              onDone={handleBulkDone}
              onDeleted={handleBulkDeleted}
            />
          </div>
        )}

        {/* Table */}
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: "var(--surface-2)", borderBottom: "2px solid var(--border)" }}>
              <th style={{ width: 28, padding: "4px 6px" }}>
                <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} />
              </th>
              {showThumbnails && <th style={{ width: 40, padding: "4px 6px" }}></th>}
              <th style={{ textAlign: "left", padding: "4px 8px" }}>Title</th>
              <th style={{ textAlign: "left", padding: "4px 8px" }}>Year</th>
              <th style={{ textAlign: "left", padding: "4px 8px" }}>Players</th>
              <th style={{ textAlign: "left", padding: "4px 8px" }}>Player Count</th>
              <th style={{ textAlign: "left", padding: "4px 8px" }}>Designers</th>
              <th style={{ textAlign: "left", padding: "4px 8px" }}>Publisher</th>
              <th style={{ textAlign: "left", padding: "4px 8px" }}>Expansions</th>
              <th style={{ textAlign: "left", padding: "4px 8px" }}>Own.</th>
            </tr>
          </thead>
          <tbody>
            {filteredGames.map((g, idx) => (
              <tr
                key={g.item_id}
                style={{ borderBottom: "1px solid var(--border)", background: idx % 2 === 0 ? "var(--surface)" : "var(--surface-2)", cursor: "pointer" }}
                onClick={() => setEditId(g.item_id)}
              >
                <td style={{ padding: "4px 6px" }} onClick={e => { e.stopPropagation(); toggleSelect(g.item_id); }}>
                  <input type="checkbox" checked={selectedIds.includes(g.item_id)} onChange={() => toggleSelect(g.item_id)} />
                </td>
                {showThumbnails && (
                  <td style={{ padding: "2px 6px" }}>
                    {g.cover_image_url
                      ? <img src={getImageUrl(g.cover_image_url)} alt="" style={{ width: 28, height: 40, objectFit: "cover", borderRadius: 2 }} onError={e => { e.target.style.display = "none"; }} />
                      : <div style={{ width: 28, height: 40, background: "var(--border)", borderRadius: 2 }} />}
                  </td>
                )}
                <td style={{ padding: "4px 8px", fontWeight: 500 }}>{g.title}</td>
                <td style={{ padding: "4px 8px", color: "var(--text-secondary)" }}>{g.year_published || "—"}</td>
                <td style={{ padding: "4px 8px", color: "var(--text-secondary)" }}>
                  {g.min_players && g.max_players
                    ? g.min_players === g.max_players ? g.min_players : `${g.min_players}–${g.max_players}`
                    : g.min_players || g.max_players || "—"}
                </td>
                <td style={{ padding: "4px 8px", color: "var(--text-secondary)", fontSize: 12 }}>{g.category_name}</td>
                <td style={{ padding: "4px 8px", color: "var(--text-secondary)", fontSize: 12 }}>{g.designers?.join(", ") || "—"}</td>
                <td style={{ padding: "4px 8px", color: "var(--text-secondary)", fontSize: 12 }}>{g.publisher_name || "—"}</td>
                <td style={{ padding: "4px 8px", color: "var(--text-secondary)", fontSize: 12 }}>{g.expansion_count > 0 ? g.expansion_count : "—"}</td>
                <td style={{ padding: "4px 8px" }}>
                  <OwnershipBadge label={g.ownership_status} />
                </td>
              </tr>
            ))}
            {filteredGames.length === 0 && (
              <tr>
                <td colSpan={showThumbnails ? 10 : 9} style={{ padding: "20px 8px", textAlign: "center", color: "var(--text-secondary)", fontStyle: "italic" }}>
                  No board games found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Edit modal */}
      {editId && (
        <EditModal
          itemId={editId}
          categories={categories}
          ownershipStatuses={ownershipStatuses}
          onClose={handleEditClose}
          onSaved={handleSaved}
          onDeleted={handleDeleted}
        />
      )}
    </div>
  );
}
