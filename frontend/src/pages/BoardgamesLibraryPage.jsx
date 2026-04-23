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
    <Stack gap={4}>
      {expansions.map((exp, i) => (
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
                Expansion {i + 1}
              </span>
              <RemoveButton showLabel label="Remove" onClick={() => remove(i)} />
            </Row>
            <FormField label="Title">
              <Input value={exp.title || ""} onChange={e => update(i, "title", e.target.value)} placeholder="Expansion name" />
            </FormField>
            <Grid cols={2} gap={4}>
              <FormField label="Year">
                <Input value={exp.year_published || ""} onChange={e => update(i, "year_published", e.target.value)} placeholder="YYYY" />
              </FormField>
              <FormField label="Ownership">
                <Select value={exp.ownership_status_id || ""} onChange={e => update(i, "ownership_status_id", e.target.value)}>
                  <option value="">None</option>
                  {ownershipStatuses.map(s => (
                    <option key={s.ownership_status_id} value={s.ownership_status_id}>{s.status_name}</option>
                  ))}
                </Select>
              </FormField>
            </Grid>
          </Stack>
        </div>
      ))}
      <Button variant="secondary" size="sm" onClick={add} style={{ alignSelf: "flex-start" }}>
        + Add Expansion
      </Button>
    </Stack>
  );
}

// ─── Grid item ────────────────────────────────────────────────────────────────

const BoardgameGridItem = memo(function BoardgameGridItem({ game, isSelected, onToggleSelect, onClick, gridSize, showCaptions }) {
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
            onChange={() => onToggleSelect(game.item_id)}
            onClick={(e) => e.stopPropagation()}
            style={{ margin: 0, cursor: "pointer" }} />
        </div>
        <OwnershipBadge statusName={game.ownership_status} />
        {game.cover_image_url ? (
          <img src={getImageUrl(game.cover_image_url)} alt="" style={{ width: w, height: h, objectFit: "cover", display: "block", borderRadius: "var(--radius-sm)" }} />
        ) : (
          <div style={{ width: w, height: h, background: "var(--bg-surface)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ fontSize: "10px", color: "var(--text-muted)" }}>No Cover</span>
          </div>
        )}
      </div>
      {showCaptions && (
        <div style={{ padding: "3px 2px 0", maxWidth: w }}>
          <div style={{ fontSize: "var(--text-xs)", fontWeight: 700, lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-primary)" }}>{game.title}</div>
          <div style={{ fontSize: "10px", color: "var(--text-muted)", lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
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
    } finally {
      setDeleting(false);
    }
  }

  const footer = form ? (
    <Row justify="between" gap={4} style={{ width: "100%" }}>
      <ConfirmButton
        label="Delete"
        confirmLabel={deleting ? "Deleting…" : "Confirm"}
        promptText="Delete this game?"
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
      title={!form ? "Loading…" : form.title || "Board Game Detail"}
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
                  {form.designers.filter(Boolean).join(", ")}
                </div>
              </div>
            </Row>
          )}

          <FormField label="Title" required>
            <Input value={form.title} onChange={e => set("title", e.target.value)} />
          </FormField>

          <Grid cols={2} gap={5}>
            <FormField label="Player Count" required>
              <Select value={form.categoryId} onChange={e => set("categoryId", e.target.value)}>
                {categories.map(c => (
                  <option key={c.top_level_category_id} value={c.top_level_category_id}>{c.category_name}</option>
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

          <Grid cols={3} gap={5}>
            <FormField label="Year Published">
              <Input value={form.yearPublished} onChange={e => set("yearPublished", e.target.value)} placeholder="YYYY" />
            </FormField>
            <FormField label="Min Players">
              <Input value={form.minPlayers} onChange={e => set("minPlayers", e.target.value)} type="number" min="1" />
            </FormField>
            <FormField label="Max Players">
              <Input value={form.maxPlayers} onChange={e => set("maxPlayers", e.target.value)} type="number" min="1" />
            </FormField>
          </Grid>

          <FormField label="Designer(s)">
            <NameList names={form.designers} onChange={v => set("designers", v)} addLabel="+ Designer" placeholder="Designer name" />
          </FormField>

          <FormField label="Publisher">
            <Input value={form.publisherName} onChange={e => set("publisherName", e.target.value)} placeholder="Publisher name" />
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
              {form.coverImageUrl && (
                <CoverThumb src={getImageUrl(form.coverImageUrl)} alt="cover" size="sm" />
              )}
            </Row>
          </FormField>

          <FormField label="Description">
            <Textarea value={form.description} onChange={e => set("description", e.target.value)} rows={3} />
          </FormField>

          <FormField label="Notes">
            <Textarea value={form.notes} onChange={e => set("notes", e.target.value)} rows={2} />
          </FormField>

          <FormField label="Expansions">
            <ExpansionsEditor
              expansions={form.expansions}
              ownershipStatuses={ownershipStatuses}
              onChange={v => set("expansions", v)}
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

function BoardgameBulkEdit({ selectedIds, categories, ownershipStatuses, onClose, onSaved, onDeleted }) {
  const [updateOwnership, setUpdateOwnership] = useState(false);
  const [ownershipId, setOwnershipId] = useState(String(ownershipStatuses[0]?.ownership_status_id || ""));
  const [updateCategory, setUpdateCategory] = useState(false);
  const [categoryId, setCategoryId] = useState(String(categories[0]?.top_level_category_id || ""));

  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  const anyEnabled = updateOwnership || updateCategory;
  const noun = selectedIds.length === 1 ? "game" : "games";

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
    setDeleting(true);
    try { await bulkDeleteBoardgames(selectedIds); onDeleted(); }
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
        <BulkField label="Player Count" enabled={updateCategory} onToggle={() => setUpdateCategory((p) => !p)}>
          <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            {categories.map((c) => (
              <option key={c.top_level_category_id} value={c.top_level_category_id}>{c.category_name}</option>
            ))}
          </Select>
        </BulkField>
      </Stack>
    </Modal>
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
    <div style={{ padding: "var(--space-8)", fontSize: "var(--text-base)" }}>Loading…</div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden", fontSize: "var(--text-base)" }}>
      {/* Controls bar */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "var(--space-3) var(--space-6)", borderBottom: "1px solid var(--border)", background: "var(--bg-sidebar)", flexShrink: 0, gap: "var(--space-4)", flexWrap: "wrap" }}>
        <Row gap={5}>
          <span style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>
            {sortedGames.length} game{sortedGames.length !== 1 ? "s" : ""}
          </span>
          {selectedIds.size > 0 && (
            <Row gap={3}>
              <span style={{ fontSize: "var(--text-sm)", color: "var(--btn-primary-bg)", fontWeight: 700 }}>
                {selectedIds.size} selected
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
            <p style={{ padding: "var(--space-8)", fontSize: "var(--text-base)", color: "var(--text-secondary)" }}>
              No board games found.
            </p>
          ) : viewMode === "grid" ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-5)", padding: "var(--space-6)", alignContent: "flex-start" }}>
              {sortedGames.map(g => (
                <BoardgameGridItem key={g.item_id} game={g}
                  isSelected={selectedIds.has(g.item_id)}
                  onToggleSelect={toggleSelect}
                  onClick={() => setEditId(g.item_id)}
                  gridSize={gridSize} showCaptions={showCaptions} />
              ))}
            </div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--text-base)", tableLayout: "fixed" }}>
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
                            ? <img src={getImageUrl(g.cover_image_url)} alt="" style={{ width: 42, height: 60, objectFit: "cover", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)", display: "block" }} />
                            : <div style={{ width: 42, height: 60, background: "var(--bg-surface)", borderRadius: "var(--radius-sm)" }} />}
                        </td>
                      )}
                      <td style={{ padding: "3px 8px", fontWeight: 500, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{g.title}</td>
                      <td style={{ padding: "3px 8px", fontSize: "var(--text-sm)", color: "var(--text-secondary)", whiteSpace: "nowrap" }}>{g.year_published || "—"}</td>
                      <td style={{ padding: "3px 8px", fontSize: "var(--text-sm)", color: "var(--text-secondary)", whiteSpace: "nowrap" }}>{players}</td>
                      <td style={{ padding: "3px 8px", fontSize: "var(--text-sm)", color: "var(--text-secondary)", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{g.category_name}</td>
                      <td style={{ padding: "3px 8px", fontSize: "var(--text-sm)", color: "var(--text-secondary)", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{g.designers?.join(", ") || "—"}</td>
                      <td style={{ padding: "3px 8px", fontSize: "var(--text-sm)", color: "var(--text-secondary)", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{g.publisher_name || "—"}</td>
                      <td style={{ padding: "3px 8px", fontSize: "var(--text-sm)", color: "var(--text-secondary)", whiteSpace: "nowrap" }}>{g.expansion_count > 0 ? g.expansion_count : "—"}</td>
                      <td style={{ padding: "3px 8px", fontSize: "var(--text-sm)", color: "var(--text-secondary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{g.ownership_status || "—"}</td>
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
