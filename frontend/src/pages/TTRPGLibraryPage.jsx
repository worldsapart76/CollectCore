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
import { GRID_SIZES } from "../styles/commonStyles";
import NameList from "../components/shared/NameList";
import { ToggleButton, SegmentedButtons } from "../components/shared/SegmentedButtons";
import { COLLECTION_TYPE_IDS } from "../constants/collectionTypes";
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  ConfirmButton,
  CoverThumb,
  FormField,
  Grid,
  Input,
  Modal,
  RemoveButton,
  Row,
  Select,
  Stack,
  Textarea,
  ownershipToneFromInitial,
} from "../components/primitives";

function OwnershipBadge({ statusName }) {
  if (!statusName) return null;
  const initial = statusName[0].toUpperCase();
  const tone = ownershipToneFromInitial(initial);
  return (
    <div style={{ position: "absolute", bottom: 4, left: 4, zIndex: 2 }}>
      <Badge tone={tone}>{initial}</Badge>
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
    <Stack gap={4}>
      {copies.map((copy, i) => (
        <div
          key={i}
          style={{
            padding: "var(--space-4) var(--space-5)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-sm)",
            background: "var(--bg-surface)",
          }}
        >
          <Stack gap={3}>
            <Row justify="between">
              <span style={{ fontSize: "var(--text-xs)", fontWeight: 700, color: "var(--text-secondary)" }}>
                Copy {i + 1}
              </span>
              <RemoveButton showLabel label="Remove" onClick={() => remove(i)} />
            </Row>
            <Grid cols={2} gap={4}>
              <FormField label="Format">
                <Select value={copy.format_type_id || ""} onChange={e => update(i, "format_type_id", e.target.value)}>
                  <option value="">Select…</option>
                  {formatTypes.map(f => (
                    <option key={f.format_type_id} value={f.format_type_id}>{f.format_name}</option>
                  ))}
                </Select>
              </FormField>
              <FormField label="Ownership">
                <Select value={copy.ownership_status_id || ""} onChange={e => update(i, "ownership_status_id", e.target.value)}>
                  <option value="">None</option>
                  {ownershipStatuses.map(s => (
                    <option key={s.ownership_status_id} value={s.ownership_status_id}>{s.status_name}</option>
                  ))}
                </Select>
              </FormField>
            </Grid>
            <Grid cols={2} gap={4}>
              <FormField label="ISBN-13">
                <Input value={copy.isbn_13 || ""} onChange={e => update(i, "isbn_13", e.target.value)} placeholder="978-…" />
              </FormField>
              <FormField label="ISBN-10">
                <Input value={copy.isbn_10 || ""} onChange={e => update(i, "isbn_10", e.target.value)} placeholder="0-…" />
              </FormField>
            </Grid>
            <FormField label="Notes">
              <Input value={copy.notes || ""} onChange={e => update(i, "notes", e.target.value)} />
            </FormField>
          </Stack>
        </div>
      ))}
      <Button variant="secondary" size="sm" onClick={add} style={{ alignSelf: "flex-start" }}>
        + Add Copy
      </Button>
    </Stack>
  );
}

// ─── Grid item ────────────────────────────────────────────────────────────────

const TtrpgGridItem = memo(function TtrpgGridItem({ book, isSelected, onToggleSelect, onClick, gridSize, showCaptions }) {
  const { w, h } = GRID_SIZES[gridSize];
  return (
    <div onClick={(e) => { if (e.target.type !== "checkbox") onClick(); }} style={{
      position: "relative", cursor: "pointer", width: w, flexShrink: 0,
      outline: isSelected ? "2px solid var(--selection-border)" : "2px solid transparent",
      borderRadius: "var(--radius-sm)", boxSizing: "border-box",
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
          <img src={getImageUrl(book.cover_image_url)} alt="" style={{ width: w, height: h, objectFit: "cover", display: "block", borderRadius: "var(--radius-sm)" }} />
        ) : (
          <div style={{ width: w, height: h, background: "var(--bg-surface)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ fontSize: "10px", color: "var(--text-muted)" }}>No Cover</span>
          </div>
        )}
      </div>
      {showCaptions && (
        <div style={{ padding: "3px 2px 0", maxWidth: w }}>
          <div style={{ fontSize: "var(--text-xs)", fontWeight: 700, lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-primary)" }}>{book.title}</div>
          <div style={{ fontSize: "10px", color: "var(--text-muted)", lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{book.category_name || ""}</div>
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
    } finally {
      setDeleting(false);
    }
  }

  const footer = form ? (
    <Row justify="between" gap={4} style={{ width: "100%" }}>
      <ConfirmButton
        label="Delete"
        confirmLabel={deleting ? "Deleting…" : "Confirm"}
        promptText="Delete this book?"
        onConfirm={handleDelete}
        busy={deleting}
        disabled={saving}
      />
      <Row gap={4}>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={handleSave} disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </Row>
    </Row>
  ) : null;

  return (
    <Modal
      isOpen
      onClose={onClose}
      size="md"
      title={!form ? "Loading…" : form.title || "TTRPG Book Detail"}
      footer={footer}
      footerJustify="between"
    >
      {!form && !error && <div style={{ color: "var(--text-muted)" }}>Loading…</div>}
      {error && <Alert tone="error" style={{ marginBottom: "var(--space-5)" }}>{error}</Alert>}

      {form && (
        <Stack gap={5}>
          {form.coverImageUrl && (
            <Row gap={5} align="start">
              <CoverThumb src={getImageUrl(form.coverImageUrl)} alt="cover" size="md" />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: "var(--text-md)", marginBottom: 2 }}>{form.title}</div>
                <div style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>
                  {form.authors.filter(Boolean).join(", ")}
                </div>
              </div>
            </Row>
          )}

          <FormField label="Title" required>
            <Input value={form.title} onChange={e => set("title", e.target.value)} />
          </FormField>

          <Grid cols={2} gap={5}>
            <FormField label="Game System" required>
              <Select value={form.systemId} onChange={e => { set("systemId", e.target.value); set("systemEditionName", ""); set("lineName", ""); }}>
                {systems.map(s => (
                  <option key={s.top_level_category_id} value={s.top_level_category_id}>{s.category_name}</option>
                ))}
              </Select>
            </FormField>
            <FormField label="Ownership" required>
              <Select value={form.ownershipStatusId} onChange={e => set("ownershipStatusId", e.target.value)}>
                {ownershipStatuses.map(s => (
                  <option key={s.ownership_status_id} value={s.ownership_status_id}>{s.status_name}</option>
                ))}
              </Select>
            </FormField>
          </Grid>

          <Grid cols={2} gap={5}>
            <FormField label="System Edition">
              <Input value={form.systemEditionName} onChange={e => set("systemEditionName", e.target.value)} placeholder="e.g. 5e" list="edit-edition-list" />
              <datalist id="edit-edition-list">
                {systemEditions.map(ed => <option key={ed.edition_id} value={ed.edition_name} />)}
              </datalist>
            </FormField>
            <FormField label="Line / Setting">
              <Input value={form.lineName} onChange={e => set("lineName", e.target.value)} placeholder="e.g. Forgotten Realms" list="edit-line-list" />
              <datalist id="edit-line-list">
                {lines.map(ln => <option key={ln.line_id} value={ln.line_name} />)}
              </datalist>
            </FormField>
          </Grid>

          <Grid cols={2} gap={5}>
            <FormField label="Book Type">
              <Select value={form.bookTypeId} onChange={e => set("bookTypeId", e.target.value)}>
                <option value="">Select…</option>
                {bookTypes.map(bt => (
                  <option key={bt.book_type_id} value={bt.book_type_id}>{bt.book_type_name}</option>
                ))}
              </Select>
            </FormField>
            <FormField label="Release Date">
              <Input value={form.releaseDate} onChange={e => set("releaseDate", e.target.value)} placeholder="YYYY or YYYY-MM-DD" />
            </FormField>
          </Grid>

          <FormField label="Publisher">
            <Input value={form.publisherName} onChange={e => set("publisherName", e.target.value)} />
          </FormField>

          <FormField label="Author(s)">
            <NameList names={form.authors} onChange={v => set("authors", v)} addLabel="+ Author" placeholder="Author name" />
          </FormField>

          <FormField label="Cover Image URL">
            <Row gap={3} align="start">
              <Input
                value={form.coverImageUrl}
                onChange={e => set("coverImageUrl", e.target.value)}
                placeholder="https://…"
                style={{ flex: 1 }}
              />
              <input type="file" accept="image/*" ref={coverFileRef} onChange={handleCoverFile} style={{ display: "none" }} />
              <Button type="button" variant="secondary" size="sm" onClick={() => coverFileRef.current?.click()}>
                Add Image
              </Button>
              {form.coverImageUrl && <CoverThumb src={getImageUrl(form.coverImageUrl)} alt="cover" size="sm" />}
            </Row>
          </FormField>

          <FormField label="Description">
            <Textarea value={form.description} onChange={e => set("description", e.target.value)} rows={3} />
          </FormField>

          <FormField label="Notes">
            <Textarea value={form.notes} onChange={e => set("notes", e.target.value)} rows={2} />
          </FormField>

          <FormField label="Copies / Formats">
            <CopiesEditor
              copies={form.copies}
              formatTypes={formatTypes}
              ownershipStatuses={ownershipStatuses}
              onChange={v => set("copies", v)}
            />
          </FormField>
        </Stack>
      )}
    </Modal>
  );
}

// ─── Bulk edit modal ──────────────────────────────────────────────────────────

function BulkField({ label, enabled, onToggle, children }) {
  return (
    <Stack gap={2}>
      <Checkbox
        label={<span style={{ fontWeight: 700, fontSize: "var(--text-base)" }}>{label}</span>}
        checked={enabled}
        onChange={onToggle}
      />
      {enabled && <div style={{ paddingLeft: "var(--space-8)" }}>{children}</div>}
    </Stack>
  );
}

function TtrpgBulkEdit({ selectedIds, systems, ownershipStatuses, onClose, onSaved, onDeleted }) {
  const [updateOwnership, setUpdateOwnership] = useState(false);
  const [ownershipId, setOwnershipId] = useState(String(ownershipStatuses[0]?.ownership_status_id || ""));
  const [updateSystem, setUpdateSystem] = useState(false);
  const [systemId, setSystemId] = useState(String(systems[0]?.top_level_category_id || ""));

  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  const anyEnabled = updateOwnership || updateSystem;
  const noun = selectedIds.length === 1 ? "book" : "books";

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
    setDeleting(true);
    try { await bulkDeleteTtrpg(selectedIds); onDeleted(); }
    catch (err) { setError(err.message || "Failed to delete"); }
    finally { setDeleting(false); }
  }

  const footer = (
    <Row justify="between" gap={4} style={{ width: "100%" }}>
      <ConfirmButton
        label={`Delete ${selectedIds.length} ${noun}`}
        confirmLabel={deleting ? "…" : "Yes"}
        cancelLabel="No"
        promptText={`Delete ${selectedIds.length}?`}
        onConfirm={handleDelete}
        busy={deleting}
        disabled={saving}
      />
      <Row gap={4}>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={handleSave} disabled={saving || deleting}>
          {saving ? "Saving…" : `Apply to ${selectedIds.length}`}
        </Button>
      </Row>
    </Row>
  );

  return (
    <Modal
      isOpen
      onClose={onClose}
      size="sm"
      title={`Bulk Edit — ${selectedIds.length} ${noun}`}
      footer={footer}
      footerJustify="between"
    >
      <Stack gap={5}>
        {error && <Alert tone="error">{error}</Alert>}
        <BulkField label="Ownership" enabled={updateOwnership} onToggle={() => setUpdateOwnership((p) => !p)}>
          <Select value={ownershipId} onChange={(e) => setOwnershipId(e.target.value)}>
            {ownershipStatuses.map((s) => (
              <option key={s.ownership_status_id} value={s.ownership_status_id}>{s.status_name}</option>
            ))}
          </Select>
        </BulkField>
        <BulkField label="Game System" enabled={updateSystem} onToggle={() => setUpdateSystem((p) => !p)}>
          <Select value={systemId} onChange={(e) => setSystemId(e.target.value)}>
            {systems.map((s) => (
              <option key={s.top_level_category_id} value={s.top_level_category_id}>{s.category_name}</option>
            ))}
          </Select>
        </BulkField>
      </Stack>
    </Modal>
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
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden", fontSize: "var(--text-base)" }}>
      {/* Controls bar */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "var(--space-3) var(--space-6)", borderBottom: "1px solid var(--border)", background: "var(--bg-sidebar)", flexShrink: 0, gap: "var(--space-4)", flexWrap: "wrap" }}>
        <Row gap={5}>
          <span style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>
            {loading ? "Loading…" : `${sorted.length} book${sorted.length !== 1 ? "s" : ""}${sorted.length !== items.length ? ` of ${items.length}` : ""}`}
          </span>
          {selected.size > 0 && (
            <Row gap={3}>
              <span style={{ fontSize: "var(--text-sm)", color: "var(--btn-primary-bg)", fontWeight: 700 }}>
                {selected.size} selected
              </span>
              <Button variant="primary" size="sm" onClick={() => setBulkEditOpen(true)}>Edit</Button>
              <Button variant="secondary" size="sm" onClick={clearSelection}>Clear</Button>
            </Row>
          )}
        </Row>
        <Row gap={4}>
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
        </Row>
      </div>

      {error && (
        <div style={{ margin: "var(--space-4) var(--space-6)" }}>
          <Alert tone="error">{error}</Alert>
        </div>
      )}

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
            <p style={{ padding: "var(--space-8)", fontSize: "var(--text-base)" }}>Loading…</p>
          ) : sorted.length === 0 ? (
            <p style={{ padding: "var(--space-8)", fontSize: "var(--text-base)", color: "var(--text-secondary)" }}>No books found.</p>
          ) : viewMode === "grid" ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-5)", padding: "var(--space-6)", alignContent: "flex-start" }}>
              {sorted.map(b => (
                <TtrpgGridItem key={b.item_id} book={b}
                  isSelected={selected.has(b.item_id)}
                  onToggleSelect={toggleSelect}
                  onClick={() => setEditId(b.item_id)}
                  gridSize={gridSize} showCaptions={showCaptions} />
              ))}
            </div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--text-base)", tableLayout: "fixed" }}>
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
                            ? <img src={getImageUrl(b.cover_image_url)} alt="" style={{ width: 42, height: 60, objectFit: "cover", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)", display: "block" }} />
                            : <div style={{ width: 42, height: 60, background: "var(--bg-surface)", borderRadius: "var(--radius-sm)" }} />}
                        </td>
                      )}
                      <td style={{ padding: "3px 8px", fontWeight: 500, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{b.title}</td>
                      <td style={{ padding: "3px 8px", fontSize: "var(--text-sm)", color: "var(--text-secondary)", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{b.category_name}</td>
                      <td style={{ padding: "3px 8px", fontSize: "var(--text-sm)", color: "var(--text-secondary)", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
                        {[b.system_edition_name, b.line_name].filter(Boolean).join(" / ") || "—"}
                      </td>
                      <td style={{ padding: "3px 8px", fontSize: "var(--text-sm)", color: "var(--text-secondary)", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{b.book_type_name || "—"}</td>
                      <td style={{ padding: "3px 8px", fontSize: "var(--text-sm)", color: "var(--text-secondary)", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{b.authors?.length ? b.authors.join(", ") : "—"}</td>
                      <td style={{ padding: "3px 8px", fontSize: "var(--text-sm)", color: "var(--text-secondary)", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{b.copies_summary || (b.copy_count > 0 ? `${b.copy_count} cop${b.copy_count !== 1 ? "ies" : "y"}` : "—")}</td>
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
