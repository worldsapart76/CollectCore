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
import { labelStyle, inputStyle, selectStyle, btnPrimary, btnSecondary, btnSm, btnDanger, alertError, row2, GRID_SIZES } from "../styles/commonStyles";
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
        defaultShown={2}
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
        <div key={i} style={{ marginBottom: 8, padding: "8px 10px", border: "1px solid var(--border)", borderRadius: 3, background: "var(--bg-surface)" }}>
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

// ─── Grid item ────────────────────────────────────────────────────────────────

const TtrpgGridItem = memo(function TtrpgGridItem({ book, isSelected, onToggleSelect, onClick, gridSize, showCaptions }) {
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
            onChange={() => onToggleSelect(book.item_id)}
            onClick={(e) => e.stopPropagation()}
            style={{ margin: 0, cursor: "pointer" }} />
        </div>
        <OwnershipBadge statusName={book.ownership_status} />
        {book.cover_image_url ? (
          <img src={getImageUrl(book.cover_image_url)} alt="" style={{ width: w, height: h, objectFit: "cover", display: "block", borderRadius: 2 }} />
        ) : (
          <div style={{ width: w, height: h, background: "var(--bg-surface)", borderRadius: 2, border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ fontSize: 10, color: "var(--text-muted)" }}>No Cover</span>
          </div>
        )}
      </div>
      {showCaptions && (
        <div style={{ padding: "3px 2px 0", maxWidth: w }}>
          <div style={{ fontSize: 11, fontWeight: "700", lineHeight: "1.3", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-primary)" }}>{book.title}</div>
          <div style={{ fontSize: 10, color: "var(--text-muted)", lineHeight: "1.3", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{book.category_name || ""}</div>
        </div>
      )}
    </div>
  );
});

// ─── Detail modal ─────────────────────────────────────────────────────────────

function TtrpgDetailModal({ itemId, systems, bookTypes, formatTypes, ownershipStatuses, onClose, onSaved, onDeleted }) {
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
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
      if (d.top_level_category_id) {
        Promise.all([
          fetchTtrpgSystemEditions(d.top_level_category_id),
          fetchTtrpgLines(d.top_level_category_id),
        ]).then(([eds, lns]) => { setSystemEditions(eds); setLines(lns); });
      }
    }).catch(() => setError("Failed to load TTRPG book."));
  }, [itemId]);

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
    setDeleting(true);
    try {
      await deleteTtrpg(itemId);
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
          <div style={{ fontWeight: "bold", fontSize: 14 }}>{!form ? "Loading..." : form.title || "TTRPG Book Detail"}</div>
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
                    <div style={{ fontSize: 12, color: "#555" }}>{form.authors.filter(Boolean).join(", ")}</div>
                  </div>
                </div>
              )}

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
                  {form.coverImageUrl && <img src={getImageUrl(form.coverImageUrl)} alt="cover" style={{ height: 40, width: "auto", borderRadius: 2, border: "1px solid #ddd", flexShrink: 0 }} />}
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

              <div style={{ marginBottom: 4 }}>
                <label style={{ ...labelStyle, marginBottom: 6 }}>Copies / Formats</label>
                <CopiesEditor copies={form.copies} formatTypes={formatTypes} ownershipStatuses={ownershipStatuses} onChange={v => set("copies", v)} />
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
                    <span style={{ fontSize: 12, color: "#c62828" }}>Delete this book?</span>
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

function TtrpgBulkEdit({ selectedIds, systems, ownershipStatuses, onClose, onSaved, onDeleted }) {
  const fieldStyle = { width: "100%", padding: "5px 6px", fontSize: 13, border: "1px solid #ccc", borderRadius: 3 };

  const [updateOwnership, setUpdateOwnership] = useState(false);
  const [ownershipId, setOwnershipId] = useState(String(ownershipStatuses[0]?.ownership_status_id || ""));
  const [updateSystem, setUpdateSystem] = useState(false);
  const [systemId, setSystemId] = useState(String(systems[0]?.top_level_category_id || ""));

  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState("");

  const anyEnabled = updateOwnership || updateSystem;

  async function handleSave() {
    if (!anyEnabled) { setError("Select at least one field to update."); return; }
    const fields = {};
    if (updateOwnership) fields.ownership_status_id = Number(ownershipId);
    if (updateSystem) fields.top_level_category_id = Number(systemId);
    setSaving(true); setError("");
    try { await bulkUpdateTtrpg(selectedIds, fields); onSaved(); }
    catch (err) { setError(err.message || "Failed to update"); }
    finally { setSaving(false); }
  }

  async function handleDelete() {
    if (!confirmDelete) { setConfirmDelete(true); return; }
    setDeleting(true);
    try { await bulkDeleteTtrpg(selectedIds); onDeleted(); }
    catch (err) { setError(err.message || "Failed to delete"); setConfirmDelete(false); }
    finally { setDeleting(false); }
  }

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: "#fff", border: "1px solid #ddd", borderRadius: 6, width: 420, maxHeight: "85vh", display: "flex", flexDirection: "column", boxShadow: "0 2px 12px rgba(0,0,0,0.15)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", borderBottom: "1px solid #e0e0e0", flexShrink: 0 }}>
          <span style={{ fontWeight: "bold", fontSize: 14 }}>Bulk Edit — {selectedIds.length} book{selectedIds.length !== 1 ? "s" : ""}</span>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 15, cursor: "pointer", color: "#666" }}>✕</button>
        </div>
        {error && <div style={{ margin: "8px 14px 0", padding: "7px 10px", background: "#ffebee", border: "1px solid #c62828", borderRadius: 3, fontSize: 13, color: "#c62828", flexShrink: 0 }}>{error}</div>}
        <div style={{ padding: "12px 14px", overflowY: "auto", flex: 1 }}>
          <BulkField label="Ownership" enabled={updateOwnership} onToggle={() => setUpdateOwnership((p) => !p)}>
            <select value={ownershipId} onChange={(e) => setOwnershipId(e.target.value)} style={fieldStyle}>
              {ownershipStatuses.map((s) => <option key={s.ownership_status_id} value={s.ownership_status_id}>{s.status_name}</option>)}
            </select>
          </BulkField>
          <BulkField label="Game System" enabled={updateSystem} onToggle={() => setUpdateSystem((p) => !p)}>
            <select value={systemId} onChange={(e) => setSystemId(e.target.value)} style={fieldStyle}>
              {systems.map((s) => <option key={s.top_level_category_id} value={s.top_level_category_id}>{s.category_name}</option>)}
            </select>
          </BulkField>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", borderTop: "1px solid #e0e0e0", flexShrink: 0 }}>
          <div>
            {!confirmDelete
              ? <button onClick={handleDelete} disabled={deleting || saving} style={{ padding: "5px 12px", fontSize: 13, cursor: "pointer", border: "1px solid #c62828", borderRadius: 3, background: "#fff", color: "#c62828" }}>Delete {selectedIds.length} book{selectedIds.length !== 1 ? "s" : ""}</button>
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
    system: emptySection(),
    bookType: emptySection(),
    author: emptySection(),
    publisher: emptySection(),
  };
}

export default function TTRPGLibraryPage() {
  const [items, setItems] = useState([]);
  const [systems, setSystems] = useState([]);
  const [bookTypes, setBookTypes] = useState([]);
  const [formatTypes, setFormatTypes] = useState([]);
  const [ownershipStatuses, setOwnershipStatuses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filters, setFilters] = useState(emptyFilters);
  const [editId, setEditId] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [bulkEditOpen, setBulkEditOpen] = useState(false);

  const [viewMode, setViewMode] = useState("table");
  const [showThumbnails, setShowThumbnails] = useState(false);
  const [gridSize, setGridSize] = useState("m");
  const [showCaptions, setShowCaptions] = useState(true);

  const [sortField, setSortField] = useState("title");
  const [sortDir, setSortDir] = useState("asc");

  const [colWidths, setColWidths] = useState({
    title: 220, system: 140, edition: 160, bookType: 110, authors: 150, copies: 130,
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

  const filtered = useMemo(() => {
    return items.filter(b => {
      if (filters.search.trim()) {
        const q = filters.search.trim().toLowerCase();
        if (!b.title.toLowerCase().includes(q)) return false;
      }
      if (sectionActive(filters.ownership)
          && !applySection(filters.ownership, [b.ownership_status_id])) return false;
      if (sectionActive(filters.system)
          && !applySection(filters.system, [b.top_level_category_id])) return false;
      if (sectionActive(filters.bookType)
          && !applySection(filters.bookType, b.book_type_id != null ? [b.book_type_id] : [])) return false;
      if (sectionActive(filters.author)
          && !applySection(filters.author, b.authors || [])) return false;
      if (sectionActive(filters.publisher)
          && !applySection(filters.publisher, b.publisher_name ? [b.publisher_name] : [])) return false;
      return true;
    });
  }, [items, filters]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    const flip = sortDir === "desc" ? -1 : 1;
    switch (sortField) {
      case "system":
        return arr.sort((a, b) => flip * ((a.category_name || "").localeCompare(b.category_name || "")));
      case "bookType":
        return arr.sort((a, b) => flip * ((a.book_type_name || "").localeCompare(b.book_type_name || "")));
      default:
        return arr.sort((a, b) => flip * ((a.title_sort || a.title || "").localeCompare(b.title_sort || b.title || "")));
    }
  }, [filtered, sortField, sortDir]);

  function handleSectionChange(key, val) {
    setFilters(f => ({ ...f, [key]: val }));
  }

  function toggleSelect(id) {
    setSelected(s => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function clearSelection() { setSelected(new Set()); }

  function toggleSelectAll() {
    if (sorted.length > 0 && sorted.every(b => selected.has(b.item_id))) clearSelection();
    else setSelected(new Set(sorted.map(b => b.item_id)));
  }

  const allVisibleSelected = sorted.length > 0 && sorted.every(b => selected.has(b.item_id));

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden", fontSize: 13 }}>
      {/* Controls bar */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 12px", borderBottom: "1px solid var(--border)", background: "var(--bg-sidebar)", flexShrink: 0, gap: 8, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>
            {loading ? "Loading…" : `${sorted.length} book${sorted.length !== 1 ? "s" : ""}${sorted.length !== items.length ? ` of ${items.length}` : ""}`}
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

      {/* Body */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        <TTRPGFilters
          items={items}
          systems={systems}
          bookTypes={bookTypes}
          ownershipStatuses={ownershipStatuses}
          filters={filters}
          onSectionChange={handleSectionChange}
          onClearAll={() => setFilters(emptyFilters())}
        />

        <div style={{ flex: 1, overflowY: "auto", overflowX: "auto", padding: 0 }}>
          {loading ? (
            <p style={{ padding: 20, fontSize: 13 }}>Loading…</p>
          ) : sorted.length === 0 ? (
            <p style={{ padding: 20, fontSize: 13, color: "var(--text-secondary)" }}>No books found.</p>
          ) : viewMode === "grid" ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, padding: 12, alignContent: "flex-start" }}>
              {sorted.map(b => (
                <TtrpgGridItem key={b.item_id} book={b}
                  isSelected={selected.has(b.item_id)}
                  onToggleSelect={toggleSelect}
                  onClick={() => setEditId(b.item_id)}
                  gridSize={gridSize} showCaptions={showCaptions} />
              ))}
            </div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, tableLayout: "fixed" }}>
              <colgroup>
                <col style={{ width: 28 }} />
                {showThumbnails && <col style={{ width: 50 }} />}
                <col style={{ width: colWidths.title }} />
                <col style={{ width: colWidths.system }} />
                <col style={{ width: colWidths.edition }} />
                <col style={{ width: colWidths.bookType }} />
                <col style={{ width: colWidths.authors }} />
                <col style={{ width: colWidths.copies }} />
              </colgroup>
              <thead style={{ position: "sticky", top: 0, zIndex: 2 }}>
                <tr style={{ background: "var(--bg-sidebar)", borderBottom: "1px solid var(--border)" }}>
                  <th style={{ padding: "5px 6px", textAlign: "center", borderRight: "1px solid var(--border)" }}>
                    <input type="checkbox" checked={allVisibleSelected} onChange={toggleSelectAll} style={{ margin: 0, cursor: "pointer" }} />
                  </th>
                  {showThumbnails && <th style={{ padding: "5px 6px", borderRight: "1px solid var(--border)" }} />}
                  {[
                    { key: "title", label: "Title", colKey: "title" },
                    { key: "system", label: "System", colKey: "system" },
                    { key: null, label: "Edition / Line", colKey: "edition" },
                    { key: "bookType", label: "Book Type", colKey: "bookType" },
                    { key: null, label: "Authors", colKey: "authors" },
                    { key: null, label: "Copies", colKey: "copies" },
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
                {sorted.map(b => {
                  const isSelected = selected.has(b.item_id);
                  return (
                    <tr
                      key={b.item_id}
                      onClick={() => setEditId(b.item_id)}
                      style={{ cursor: "pointer", borderBottom: "1px solid var(--border)", background: isSelected ? "var(--green-light)" : undefined }}
                      onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = "var(--bg-surface)"; }}
                      onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = ""; }}
                    >
                      <td style={{ padding: "3px 6px", verticalAlign: "middle", width: 28 }} onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(b.item_id)} style={{ margin: 0, cursor: "pointer" }} />
                      </td>
                      {showThumbnails && (
                        <td style={{ padding: "3px 6px", verticalAlign: "middle", width: 50 }}>
                          {b.cover_image_url
                            ? <img src={getImageUrl(b.cover_image_url)} alt="" style={{ width: 42, height: 60, objectFit: "cover", borderRadius: 2, border: "1px solid var(--border)", display: "block" }} />
                            : <div style={{ width: 42, height: 60, background: "var(--bg-surface)", borderRadius: 2 }} />}
                        </td>
                      )}
                      <td style={{ padding: "3px 8px", fontWeight: 500, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{b.title}</td>
                      <td style={{ padding: "3px 8px", fontSize: 12, color: "var(--text-secondary)", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{b.category_name}</td>
                      <td style={{ padding: "3px 8px", fontSize: 12, color: "var(--text-secondary)", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
                        {[b.system_edition_name, b.line_name].filter(Boolean).join(" / ") || "—"}
                      </td>
                      <td style={{ padding: "3px 8px", fontSize: 12, color: "var(--text-secondary)", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{b.book_type_name || "—"}</td>
                      <td style={{ padding: "3px 8px", fontSize: 12, color: "var(--text-secondary)", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{b.authors?.length ? b.authors.join(", ") : "—"}</td>
                      <td style={{ padding: "3px 8px", fontSize: 12, color: "var(--text-secondary)", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{b.copies_summary || (b.copy_count > 0 ? `${b.copy_count} cop${b.copy_count !== 1 ? "ies" : "y"}` : "—")}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {editId && (
        <TtrpgDetailModal
          itemId={editId}
          systems={systems}
          bookTypes={bookTypes}
          formatTypes={formatTypes}
          ownershipStatuses={ownershipStatuses}
          onClose={() => setEditId(null)}
          onSaved={() => { setEditId(null); loadData(); }}
          onDeleted={() => {
            setEditId(null);
            loadData();
            setSelected(prev => { const next = new Set(prev); next.delete(editId); return next; });
          }}
        />
      )}

      {bulkEditOpen && (
        <TtrpgBulkEdit
          selectedIds={[...selected]}
          systems={systems}
          ownershipStatuses={ownershipStatuses}
          onClose={() => setBulkEditOpen(false)}
          onSaved={async () => { setBulkEditOpen(false); clearSelection(); loadData(); }}
          onDeleted={async () => { setBulkEditOpen(false); clearSelection(); loadData(); }}
        />
      )}
    </div>
  );
}
