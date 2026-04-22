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
  bulkDeleteTtrpg,
  bulkUpdateTtrpg,
  deleteTtrpg,
  fetchOwnershipStatuses,
  fetchTtrpgBookTypes,
  fetchTtrpgFormatTypes,
  fetchTtrpgLines,
  fetchTtrpgSystems,
  fetchTtrpgSystemEditions,
  getTtrpg,
  listTtrpg,
  updateTtrpg,
  uploadCover,
} from "../api";
import { getImageUrl } from "../utils/imageUrl";
import { labelStyle, inputStyle, selectStyle, btnPrimary, btnSecondary, btnSm, btnDanger, alertError, alertSuccess, row2 } from "../styles/commonStyles";
import NameList from "../components/shared/NameList";
import { COLLECTION_TYPE_IDS } from "../constants/collectionTypes";

// ─── Filter sidebar ───────────────────────────────────────────────────────────

function TTRPGFilters({ items, systems, bookTypes, ownershipStatuses, filters, onSectionChange, onClearAll }) {


  const allAuthors = useMemo(() => {
    const seen = new Set();
    const result = [];
    for (const b of items) for (const a of (b.authors || [])) if (!seen.has(a)) { seen.add(a); result.push(a); }
    return result.sort().map(a => ({ id: a, label: a }));
  }, [items]);

  const allPublishers = useMemo(() => {
    const seen = new Set();
    const result = [];
    for (const b of items) if (b.publisher_name && !seen.has(b.publisher_name)) { seen.add(b.publisher_name); result.push(b.publisher_name); }
    return result.sort().map(p => ({ id: p, label: p }));
  }, [items]);

  const hasFilters = filters.search.trim() ||
    sectionActive(filters.ownership) || sectionActive(filters.system) ||
    sectionActive(filters.bookType) || sectionActive(filters.author) ||
    sectionActive(filters.publisher);

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
        items={ownershipStatuses.map(s => ({ id: s.ownership_status_id, label: s.status_name }))}
        section={filters.ownership}
        onChange={s => onSectionChange("ownership", s)}
      />
      <TriStateFilterSection
        title="Game System"
        items={systems.map(s => ({ id: s.top_level_category_id, label: s.category_name }))}
        section={filters.system}
        onChange={s => onSectionChange("system", s)}
      />
      <TriStateFilterSection
        title="Book Type"
        items={bookTypes.map(bt => ({ id: bt.book_type_id, label: bt.book_type_name }))}
        section={filters.bookType}
        onChange={s => onSectionChange("bookType", s)}
      />
      <SearchableTriStateSection
        title="Author"
        items={allAuthors}
        section={filters.author}
        onChange={s => onSectionChange("author", s)}
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

// ─── NameList ─────────────────────────────────────────────────────────────────

// ─── Copies editor (edit modal) ───────────────────────────────────────────────

function CopiesEditor({ copies, formatTypes, ownershipStatuses, onChange }) {
  function update(idx, key, val) {
    const next = [...copies];
    next[idx] = { ...next[idx], [key]: val };
    onChange(next);
  }
  function add() { onChange([...copies, { format_type_id: "", isbn_13: "", isbn_10: "", ownership_status_id: "", notes: "" }]); }
  function remove(idx) { onChange(copies.filter((_, i) => i !== idx)); }

  return (
    <div>
      {copies.map((copy, i) => (
        <div key={i} style={{ marginBottom: 8, padding: "8px 10px", border: "1px solid var(--border)", borderRadius: 3, background: "var(--surface-2)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <span style={{ fontSize: 11, fontWeight: "bold", color: "var(--text-secondary)" }}>Copy {i + 1}</span>
            <button type="button" onClick={() => remove(i)} style={{ ...btnSm, color: "#c62828" }}>✕ Remove</button>
          </div>
          <div style={row2}>
            <div>
              <label style={labelStyle}>Format</label>
              <select value={copy.format_type_id || ""} onChange={e => update(i, "format_type_id", e.target.value)} style={selectStyle}>
                <option value="">Select…</option>
                {formatTypes.map(f => <option key={f.format_type_id} value={f.format_type_id}>{f.format_name}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Ownership</label>
              <select value={copy.ownership_status_id || ""} onChange={e => update(i, "ownership_status_id", e.target.value)} style={selectStyle}>
                <option value="">None</option>
                {ownershipStatuses.map(s => <option key={s.ownership_status_id} value={s.ownership_status_id}>{s.status_name}</option>)}
              </select>
            </div>
          </div>
          <div style={row2}>
            <div>
              <label style={labelStyle}>ISBN-13</label>
              <input value={copy.isbn_13 || ""} onChange={e => update(i, "isbn_13", e.target.value)} style={inputStyle} placeholder="978-…" />
            </div>
            <div>
              <label style={labelStyle}>ISBN-10</label>
              <input value={copy.isbn_10 || ""} onChange={e => update(i, "isbn_10", e.target.value)} style={inputStyle} placeholder="0-…" />
            </div>
          </div>
          <div>
            <label style={labelStyle}>Notes</label>
            <input value={copy.notes || ""} onChange={e => update(i, "notes", e.target.value)} style={inputStyle} />
          </div>
        </div>
      ))}
      <button type="button" onClick={add} style={btnSm}>+ Add Copy</button>
    </div>
  );
}

// ─── Edit modal ───────────────────────────────────────────────────────────────

function EditModal({ itemId, systems, bookTypes, formatTypes, ownershipStatuses, onClose, onSaved, onDeleted }) {
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState("");
  const [systemEditions, setSystemEditions] = useState([]);
  const [lines, setLines] = useState([]);
  const coverFileRef = useRef(null);

  async function handleCoverFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const { url } = await uploadCover(file, "ttrpg", itemId);
      set("coverImageUrl", url);
    } catch (err) {
      setError(err.message || "Cover upload failed.");
    }
    if (coverFileRef.current) coverFileRef.current.value = "";
  }

  useEffect(() => {
    getTtrpg(itemId).then(d => {
      setForm({
        title: d.title || "",
        systemId: String(d.top_level_category_id),
        ownershipStatusId: String(d.ownership_status_id),
        systemEditionName: d.system_edition_name || "",
        lineName: d.line_name || "",
        bookTypeId: d.book_type_id ? String(d.book_type_id) : "",
        publisherName: d.publisher_name || "",
        authors: d.authors?.length ? d.authors.map(a => a.author_name) : [""],
        releaseDate: d.release_date || "",
        coverImageUrl: d.cover_image_url || "",
        description: d.description || "",
        notes: d.notes || "",
        copies: d.copies?.map(c => ({
          copy_id: c.copy_id,
          format_type_id: c.format_type_id ? String(c.format_type_id) : "",
          isbn_13: c.isbn_13 || "",
          isbn_10: c.isbn_10 || "",
          ownership_status_id: c.ownership_status_id ? String(c.ownership_status_id) : "",
          notes: c.notes || "",
        })) || [],
      });
      // Load scoped lookups for this system
      if (d.top_level_category_id) {
        Promise.all([
          fetchTtrpgSystemEditions(d.top_level_category_id),
          fetchTtrpgLines(d.top_level_category_id),
        ]).then(([eds, lns]) => { setSystemEditions(eds); setLines(lns); });
      }
    }).catch(() => setError("Failed to load TTRPG book."));
  }, [itemId]);

  // Reload editions + lines when system changes in edit modal
  useEffect(() => {
    if (!form?.systemId) { setSystemEditions([]); setLines([]); return; }
    const id = parseInt(form.systemId, 10);
    Promise.all([
      fetchTtrpgSystemEditions(id),
      fetchTtrpgLines(id),
    ]).then(([eds, lns]) => { setSystemEditions(eds); setLines(lns); });
  }, [form?.systemId]);

  function set(key, val) { setForm(f => ({ ...f, [key]: val })); }

  async function handleSave() {
    if (!form.title.trim()) { setError("Title is required."); return; }
    setSaving(true); setError("");
    try {
      await updateTtrpg(itemId, {
        title: form.title.trim(),
        top_level_category_id: parseInt(form.systemId, 10),
        ownership_status_id: parseInt(form.ownershipStatusId, 10),
        notes: form.notes || null,
        description: form.description || null,
        system_edition_name: form.systemEditionName.trim() || null,
        line_name: form.lineName.trim() || null,
        book_type_id: form.bookTypeId ? parseInt(form.bookTypeId, 10) : null,
        publisher_name: form.publisherName.trim() || null,
        author_names: form.authors.map(a => a.trim()).filter(Boolean),
        release_date: form.releaseDate || null,
        cover_image_url: form.coverImageUrl || null,
        copies: form.copies
          .filter(c => c.format_type_id || c.isbn_13 || c.isbn_10)
          .map(c => ({
            format_type_id: c.format_type_id ? parseInt(c.format_type_id, 10) : null,
            isbn_13: c.isbn_13 || null,
            isbn_10: c.isbn_10 || null,
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
      await deleteTtrpg(itemId);
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



  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: "var(--bg-surface)", borderRadius: 6, width: 680, maxWidth: "95vw", maxHeight: "90vh", overflow: "auto", boxShadow: "0 4px 24px rgba(0,0,0,0.3)" }}>
        {/* Header */}
        <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontWeight: 700, fontSize: 15 }}>Edit TTRPG Book</span>
          <button onClick={onClose} style={{ ...btnSm, fontSize: 14 }}>✕</button>
        </div>

        {form.coverImageUrl && (
          <div style={{ padding: "10px 16px 0" }}>
            <img src={getImageUrl(form.coverImageUrl)} alt="cover" style={{ width: 60, height: 85, objectFit: "cover", border: "1px solid var(--border)", borderRadius: 3 }} onError={() => {}} />
          </div>
        )}

        <div style={{ padding: 16 }}>
          {error && <div style={alertError}>{error}</div>}

          <div style={{ marginBottom: 10 }}>
            <label style={labelStyle}>Title *</label>
            <input value={form.title} onChange={e => set("title", e.target.value)} style={inputStyle} />
          </div>

          <div style={row2}>
            <div>
              <label style={labelStyle}>Game System *</label>
              <select value={form.systemId} onChange={e => { set("systemId", e.target.value); set("systemEditionName", ""); set("lineName", ""); }} style={selectStyle}>
                {systems.map(s => <option key={s.top_level_category_id} value={s.top_level_category_id}>{s.category_name}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Ownership *</label>
              <select value={form.ownershipStatusId} onChange={e => set("ownershipStatusId", e.target.value)} style={selectStyle}>
                {ownershipStatuses.map(s => <option key={s.ownership_status_id} value={s.ownership_status_id}>{s.status_name}</option>)}
              </select>
            </div>
          </div>

          <div style={row2}>
            <div>
              <label style={labelStyle}>System Edition</label>
              <input value={form.systemEditionName} onChange={e => set("systemEditionName", e.target.value)} style={inputStyle} placeholder="e.g. 5e" list="edit-edition-list" />
              <datalist id="edit-edition-list">
                {systemEditions.map(ed => <option key={ed.edition_id} value={ed.edition_name} />)}
              </datalist>
            </div>
            <div>
              <label style={labelStyle}>Line / Setting</label>
              <input value={form.lineName} onChange={e => set("lineName", e.target.value)} style={inputStyle} placeholder="e.g. Forgotten Realms" list="edit-line-list" />
              <datalist id="edit-line-list">
                {lines.map(ln => <option key={ln.line_id} value={ln.line_name} />)}
              </datalist>
            </div>
          </div>

          <div style={row2}>
            <div>
              <label style={labelStyle}>Book Type</label>
              <select value={form.bookTypeId} onChange={e => set("bookTypeId", e.target.value)} style={selectStyle}>
                <option value="">Select…</option>
                {bookTypes.map(bt => <option key={bt.book_type_id} value={bt.book_type_id}>{bt.book_type_name}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Release Date</label>
              <input value={form.releaseDate} onChange={e => set("releaseDate", e.target.value)} style={inputStyle} placeholder="YYYY or YYYY-MM-DD" />
            </div>
          </div>

          <div style={{ marginBottom: 10 }}>
            <label style={labelStyle}>Publisher</label>
            <input value={form.publisherName} onChange={e => set("publisherName", e.target.value)} style={inputStyle} />
          </div>

          <div style={{ marginBottom: 10 }}>
            <label style={labelStyle}>Author(s)</label>
            <NameList names={form.authors} onChange={v => set("authors", v)} addLabel="+ Author" placeholder="Author name" />
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
            <textarea value={form.description} onChange={e => set("description", e.target.value)} style={{ ...inputStyle, height: 70, resize: "vertical" }} />
          </div>

          <div style={{ marginBottom: 14 }}>
            <label style={labelStyle}>Notes</label>
            <textarea value={form.notes} onChange={e => set("notes", e.target.value)} style={{ ...inputStyle, height: 50, resize: "vertical" }} />
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={{ ...labelStyle, marginBottom: 6 }}>Copies / Formats</label>
            <CopiesEditor copies={form.copies} formatTypes={formatTypes} ownershipStatuses={ownershipStatuses} onChange={v => set("copies", v)} />
          </div>

          {/* Actions */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: 8, borderTop: "1px solid var(--border)" }}>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={handleSave} disabled={saving} style={btnPrimary}>{saving ? "Saving…" : "Save"}</button>
              <button onClick={onClose} style={btnSecondary}>Cancel</button>
            </div>
            <div>
              {!confirmDelete
                ? <button onClick={() => setConfirmDelete(true)} style={btnDanger}>Delete</button>
                : (
                  <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>Confirm?</span>
                    <button onClick={handleDelete} disabled={saving} style={btnDanger}>Yes, Delete</button>
                    <button onClick={() => setConfirmDelete(false)} style={btnSecondary}>No</button>
                  </span>
                )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Bulk edit modal ──────────────────────────────────────────────────────────

function BulkEditModal({ selectedIds, systems, ownershipStatuses, onClose, onSaved }) {
  const [ownershipId, setOwnershipId] = useState("");
  const [systemId, setSystemId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");


  async function handleSave() {
    if (!ownershipId && !systemId) { setError("Select at least one field to update."); return; }
    setSaving(true); setError("");
    try {
      const fields = {};
      if (ownershipId) fields.ownership_status_id = parseInt(ownershipId, 10);
      if (systemId) fields.top_level_category_id = parseInt(systemId, 10);
      await bulkUpdateTtrpg({ item_ids: selectedIds, fields });
      onSaved();
    } catch (err) {
      setError(err.message || "Bulk update failed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: "var(--bg-surface)", borderRadius: 6, width: 420, maxWidth: "95vw", boxShadow: "0 4px 24px rgba(0,0,0,0.3)" }}>
        <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between" }}>
          <span style={{ fontWeight: 700, fontSize: 15 }}>Bulk Edit ({selectedIds.length} items)</span>
          <button onClick={onClose} style={{ ...btnSm, fontSize: 14 }}>✕</button>
        </div>
        <div style={{ padding: 16 }}>
          {error && <div style={alertError}>{error}</div>}
          <div style={{ marginBottom: 10 }}>
            <label style={labelStyle}>Set Ownership</label>
            <select value={ownershipId} onChange={e => setOwnershipId(e.target.value)} style={selectStyle}>
              <option value="">No change</option>
              {ownershipStatuses.map(s => <option key={s.ownership_status_id} value={s.ownership_status_id}>{s.status_name}</option>)}
            </select>
          </div>
          <div style={{ marginBottom: 16 }}>
            <label style={labelStyle}>Set Game System</label>
            <select value={systemId} onChange={e => setSystemId(e.target.value)} style={selectStyle}>
              <option value="">No change</option>
              {systems.map(s => <option key={s.top_level_category_id} value={s.top_level_category_id}>{s.category_name}</option>)}
            </select>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={handleSave} disabled={saving} style={btnPrimary}>{saving ? "Saving…" : "Apply"}</button>
            <button onClick={onClose} style={btnSecondary}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function emptyFilters() {
  return {
    search: "",
    ownership: emptySection(),
    system: emptySection(),
    bookType: emptySection(),
    author: emptySection(),
    publisher: emptySection(),
  };
}

function matchesFilters(book, filters) {
  if (filters.search.trim()) {
    const q = filters.search.trim().toLowerCase();
    if (!book.title.toLowerCase().includes(q)) return false;
  }
  if (sectionActive(filters.ownership)) {
    const state = getItemState(filters.ownership, book.ownership_status_id);
    if (!applySection(state)) return false;
  }
  if (sectionActive(filters.system)) {
    const state = getItemState(filters.system, book.top_level_category_id);
    if (!applySection(state)) return false;
  }
  if (sectionActive(filters.bookType)) {
    const state = getItemState(filters.bookType, book.book_type_id);
    if (!applySection(state)) return false;
  }
  if (sectionActive(filters.author)) {
    const match = (book.authors || []).some(a => applySection(getItemState(filters.author, a)));
    if (!match) return false;
  }
  if (sectionActive(filters.publisher)) {
    const state = getItemState(filters.publisher, book.publisher_name);
    if (!applySection(state)) return false;
  }
  return true;
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function TTRPGLibraryPage() {
  const [items, setItems] = useState([]);
  const [systems, setSystems] = useState([]);
  const [bookTypes, setBookTypes] = useState([]);
  const [formatTypes, setFormatTypes] = useState([]);
  const [ownershipStatuses, setOwnershipStatuses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filters, setFilters] = useState(emptyFilters);
  const [showThumbs, setShowThumbs] = useState(false);
  const [editId, setEditId] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [showBulkEdit, setShowBulkEdit] = useState(false);
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false);
  const [actionMsg, setActionMsg] = useState("");

  const loadData = useCallback(() => {
    setLoading(true);
    Promise.all([
      listTtrpg(),
      fetchTtrpgSystems(),
      fetchTtrpgBookTypes(),
      fetchTtrpgFormatTypes(),
      fetchOwnershipStatuses(COLLECTION_TYPE_IDS.ttrpg),
    ]).then(([books, sys, bt, ft, own]) => {
      setItems(books);
      setSystems(sys);
      setBookTypes(bt);
      setFormatTypes(ft);
      setOwnershipStatuses(own);
      setLoading(false);
    }).catch(() => {
      setError("Failed to load TTRPG library.");
      setLoading(false);
    });
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const filtered = useMemo(() => items.filter(b => matchesFilters(b, filters)), [items, filters]);

  function handleSectionChange(key, val) {
    setFilters(f => ({ ...f, [key]: val }));
  }

  function toggleSelect(id) {
    setSelected(s => {
      const next = new Set(s);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selected.size === filtered.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map(b => b.item_id)));
    }
  }

  async function handleBulkDelete() {
    try {
      await bulkDeleteTtrpg({ item_ids: [...selected] });
      setSelected(new Set());
      setBulkDeleteConfirm(false);
      setActionMsg(`Deleted ${selected.size} item(s).`);
      loadData();
    } catch (err) {
      setActionMsg("Bulk delete failed.");
    }
  }

  const bookTypeMap = useMemo(() => Object.fromEntries(bookTypes.map(bt => [bt.book_type_id, bt.book_type_name])), [bookTypes]);

  return (
    <div style={{ display: "flex", height: "100%", overflow: "hidden" }}>
      {/* Sidebar */}
      <TTRPGFilters
        items={items}
        systems={systems}
        bookTypes={bookTypes}
        ownershipStatuses={ownershipStatuses}
        filters={filters}
        onSectionChange={handleSectionChange}
        onClearAll={() => setFilters(emptyFilters())}
      />

      {/* Main content */}
      <div style={{ flex: 1, overflow: "auto", padding: "12px 16px" }}>
        {/* Toolbar */}
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>
            {filtered.length} book{filtered.length !== 1 ? "s" : ""}
            {filtered.length !== items.length ? ` of ${items.length}` : ""}
          </span>
          <button onClick={() => setShowThumbs(t => !t)} style={btnSecondary}>
            {showThumbs ? "Hide Covers" : "Show Covers"}
          </button>
          {selected.size > 0 && (
            <>
              <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>{selected.size} selected</span>
              <button onClick={() => setShowBulkEdit(true)} style={btnSecondary}>Bulk Edit</button>
              {!bulkDeleteConfirm
                ? <button onClick={() => setBulkDeleteConfirm(true)} style={{ ...btnSm, color: "#c62828" }}>Delete Selected</button>
                : (
                  <>
                    <span style={{ fontSize: 12, color: "#c62828" }}>Delete {selected.size}?</span>
                    <button onClick={handleBulkDelete} style={{ ...btnSm, background: "#c62828", color: "#fff", border: "none" }}>Yes</button>
                    <button onClick={() => setBulkDeleteConfirm(false)} style={btnSm}>No</button>
                  </>
                )}
            </>
          )}
          {actionMsg && <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>{actionMsg}</span>}
        </div>

        {loading && <p style={{ fontSize: 13 }}>Loading…</p>}
        {error && <div style={alertError}>{error}</div>}

        {!loading && !error && (
          <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "var(--bg-sidebar)", borderBottom: "1px solid var(--border)" }}>
                <th style={{ width: 28, padding: "4px 6px", textAlign: "center" }}>
                  <input type="checkbox" checked={selected.size === filtered.length && filtered.length > 0} onChange={toggleSelectAll} />
                </th>
                {showThumbs && <th style={{ width: 44, padding: "4px 6px" }}></th>}
                <th style={{ padding: "4px 8px", textAlign: "left" }}>Title</th>
                <th style={{ padding: "4px 8px", textAlign: "left", whiteSpace: "nowrap" }}>System</th>
                <th style={{ padding: "4px 8px", textAlign: "left", whiteSpace: "nowrap" }}>Edition / Line</th>
                <th style={{ padding: "4px 8px", textAlign: "left", whiteSpace: "nowrap" }}>Book Type</th>
                <th style={{ padding: "4px 8px", textAlign: "left" }}>Authors</th>
                <th style={{ padding: "4px 8px", textAlign: "left" }}>Copies</th>
                <th style={{ width: 50, padding: "4px 6px" }}></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((book, idx) => (
                <tr
                  key={book.item_id}
                  style={{ background: selected.has(book.item_id) ? "var(--selection-bg, #e8f5e9)" : idx % 2 === 0 ? "var(--bg-surface)" : "var(--surface-2)", borderBottom: "1px solid var(--border)" }}
                >
                  <td style={{ padding: "4px 6px", textAlign: "center" }}>
                    <input type="checkbox" checked={selected.has(book.item_id)} onChange={() => toggleSelect(book.item_id)} />
                  </td>
                  {showThumbs && (
                    <td style={{ padding: "3px 6px" }}>
                      {book.cover_image_url
                        ? <img src={getImageUrl(book.cover_image_url)} alt="" style={{ width: 32, height: 45, objectFit: "cover", borderRadius: 2, border: "1px solid var(--border)" }} onError={e => { e.target.style.display = "none"; }} />
                        : <div style={{ width: 32, height: 45, background: "var(--border)", borderRadius: 2 }} />
                      }
                    </td>
                  )}
                  <td style={{ padding: "4px 8px", fontWeight: 500 }}>{book.title}</td>
                  <td style={{ padding: "4px 8px", color: "var(--text-secondary)" }}>{book.category_name}</td>
                  <td style={{ padding: "4px 8px", color: "var(--text-secondary)", fontSize: 12 }}>
                    {[book.system_edition_name, book.line_name].filter(Boolean).join(" / ") || "—"}
                  </td>
                  <td style={{ padding: "4px 8px", color: "var(--text-secondary)", fontSize: 12 }}>
                    {book.book_type_name || "—"}
                  </td>
                  <td style={{ padding: "4px 8px", color: "var(--text-secondary)", fontSize: 12 }}>
                    {book.authors?.length ? book.authors.join(", ") : "—"}
                  </td>
                  <td style={{ padding: "4px 8px", color: "var(--text-secondary)", fontSize: 12 }}>
                    {book.copies_summary || (book.copy_count > 0 ? `${book.copy_count} cop${book.copy_count !== 1 ? "ies" : "y"}` : "—")}
                  </td>
                  <td style={{ padding: "4px 6px", textAlign: "center" }}>
                    <button onClick={() => setEditId(book.item_id)} style={btnSm}>Edit</button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={showThumbs ? 9 : 8} style={{ padding: 20, textAlign: "center", color: "var(--text-secondary)", fontSize: 13 }}>
                    No books found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* Modals */}
      {editId && (
        <EditModal
          itemId={editId}
          systems={systems}
          bookTypes={bookTypes}
          formatTypes={formatTypes}
          ownershipStatuses={ownershipStatuses}
          onClose={() => setEditId(null)}
          onSaved={() => { setEditId(null); loadData(); }}
          onDeleted={() => { setEditId(null); loadData(); }}
        />
      )}
      {showBulkEdit && (
        <BulkEditModal
          selectedIds={[...selected]}
          systems={systems}
          ownershipStatuses={ownershipStatuses}
          onClose={() => setShowBulkEdit(false)}
          onSaved={() => { setShowBulkEdit(false); setSelected(new Set()); loadData(); }}
        />
      )}
    </div>
  );
}
