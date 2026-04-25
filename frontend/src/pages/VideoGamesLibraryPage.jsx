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
import { GRID_SIZES } from "../styles/commonStyles";
import {
  MOBILE_BREAKPOINT,
  useMediaQuery,
  useMobileCardsPerRow,
  useMobileInfiniteScroll,
  MobilePerRowStepper,
  MobileInfiniteSentinel,
} from "../components/library/mobileGrid";
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
    for (const g of items) for (const d of (g.developers || [])) if (d && !seen.has(d)) { seen.add(d); result.push(d); }
    return result.sort().map(d => ({ id: d, label: d }));
  }, [items]);

  const allPublishers = useMemo(() => {
    const seen = new Set();
    const result = [];
    for (const g of items) for (const p of (g.publishers || [])) if (p && !seen.has(p)) { seen.add(p); result.push(p); }
    return result.sort().map(p => ({ id: p, label: p }));
  }, [items]);

  const allGenreLabels = useMemo(() => {
    const seen = new Set();
    const result = [];
    for (const g of items) for (const genre of (g.genres || [])) if (genre && !seen.has(genre)) { seen.add(genre); result.push(genre); }
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
        items={playStatuses.map(s => ({ id: s.read_status_id, label: s.status_name }))}
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
    <Stack gap={2}>
      <Row gap={3} wrap>
        <Select value={topSel} onChange={e => handleTopChange(e.target.value)} style={{ width: "auto", minWidth: 130 }}>
          <option value="">Genre…</option>
          {allGenres.map(g => <option key={g.top_genre_id} value={g.top_genre_id}>{g.genre_name}</option>)}
        </Select>
        {subGenres.length > 0 && (
          <>
            <Select value={subSel} onChange={e => setSubSel(e.target.value)} style={{ width: "auto", minWidth: 130 }}>
              <option value="">Subgenre…</option>
              {subGenres.map(s => <option key={s.sub_genre_id} value={s.sub_genre_id}>{s.sub_genre_name}</option>)}
            </Select>
            <Button variant="secondary" size="sm" onClick={add}>Add</Button>
          </>
        )}
      </Row>
      {selected.length > 0 && (
        <Row gap={2} wrap>
          {selected.map((g, i) => (
            <Badge key={i} tone="tag">
              {labelFor(g)}
              <RemoveButton onClick={() => remove(i)} style={{ marginLeft: "var(--space-1)" }} />
            </Badge>
          ))}
        </Row>
      )}
    </Stack>
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
              <FormField label="Platform">
                <Select value={copy.platform_id || ""} onChange={e => update(i, "platform_id", e.target.value)}>
                  <option value="">Select platform…</option>
                  {allPlatforms.map(p => <option key={p.platform_id} value={p.platform_id}>{p.platform_name}</option>)}
                </Select>
              </FormField>
              <FormField label="Edition">
                <Input value={copy.edition || ""} onChange={e => update(i, "edition", e.target.value)} placeholder="e.g. Collector's Edition" />
              </FormField>
            </Grid>
            <FormField label="Ownership">
              <Select value={copy.ownership_status_id || ""} onChange={e => update(i, "ownership_status_id", e.target.value)} style={{ maxWidth: 200 }}>
                <option value="">None</option>
                {ownershipStatuses.map(s => <option key={s.ownership_status_id} value={s.ownership_status_id}>{s.status_name}</option>)}
              </Select>
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

const VideoGameGridItem = memo(function VideoGameGridItem({ game, isSelected, onToggleSelect, onClick, gridSize, showCaptions }) {
  const { w, h } = GRID_SIZES[gridSize];
  return (
    <div className="cc-mobile-grid-cell" onClick={(e) => { if (e.target.type !== "checkbox") onClick(); }} style={{
      position: "relative", cursor: "pointer", width: w, flexShrink: 0,
      outline: isSelected ? "2px solid var(--selection-border)" : "2px solid transparent",
      borderRadius: "var(--radius-sm)", boxSizing: "border-box",
    }}>
      <div className="cc-mobile-grid-cell__cover" style={{ position: "relative", width: w, height: h }}>
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
          <div style={{ fontSize: "10px", color: "var(--text-muted)", lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{(game.platforms || []).join(", ")}</div>
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
      title={!form ? "Loading…" : form.title || "Game Detail"}
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
                  {form.developers.filter(Boolean).join(", ")}
                </div>
              </div>
            </Row>
          )}

          <FormField label="Title" required>
            <Input value={form.title} onChange={e => set("title", e.target.value)} />
          </FormField>

          <Grid cols={2} gap={5}>
            <FormField label="Ownership" required>
              <Select value={form.ownershipStatusId} onChange={e => set("ownershipStatusId", e.target.value)}>
                {ownershipStatuses.map(s => <option key={s.ownership_status_id} value={s.ownership_status_id}>{s.status_name}</option>)}
              </Select>
            </FormField>
            <FormField label="Play Status">
              <Select value={form.playStatusId} onChange={e => set("playStatusId", e.target.value)}>
                <option value="">None</option>
                {playStatuses.map(s => <option key={s.play_status_id} value={s.play_status_id}>{s.status_name}</option>)}
              </Select>
            </FormField>
          </Grid>

          <FormField label="Release Date">
            <Input value={form.releaseDate} onChange={e => set("releaseDate", e.target.value)} placeholder="YYYY-MM-DD" style={{ maxWidth: 180 }} />
          </FormField>

          <FormField label="Developer(s)">
            <NameList names={form.developers} onChange={v => set("developers", v)} addLabel="+ Developer" placeholder="Developer name" />
          </FormField>

          <FormField label="Publisher(s)">
            <NameList names={form.publishers} onChange={v => set("publishers", v)} addLabel="+ Publisher" placeholder="Publisher name" />
          </FormField>

          <FormField label="Genre">
            <GenrePicker allGenres={allGenres} selected={form.genres} onChange={v => set("genres", v)} />
          </FormField>

          <FormField label="Cover Image URL">
            <Row gap={3} align="start">
              <Input value={form.coverImageUrl} onChange={e => set("coverImageUrl", e.target.value)} placeholder="https://…" style={{ flex: 1 }} />
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

          <FormField label="Copies">
            <CopiesEditor
              copies={form.copies}
              allPlatforms={allPlatforms}
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

function VideoGameBulkEdit({ selectedIds, ownershipStatuses, playStatuses, onClose, onSaved, onDeleted }) {
  const [updateOwnership, setUpdateOwnership] = useState(false);
  const [ownershipId, setOwnershipId] = useState(String(ownershipStatuses[0]?.ownership_status_id || ""));
  const [updatePlayStatus, setUpdatePlayStatus] = useState(false);
  const [playStatusId, setPlayStatusId] = useState(String(playStatuses[0]?.play_status_id || ""));

  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  const anyEnabled = updateOwnership || updatePlayStatus;
  const noun = selectedIds.length === 1 ? "game" : "games";

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
    setDeleting(true);
    try { await bulkDeleteVideoGames(selectedIds); onDeleted(); }
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
            {ownershipStatuses.map((s) => <option key={s.ownership_status_id} value={s.ownership_status_id}>{s.status_name}</option>)}
          </Select>
        </BulkField>
        <BulkField label="Play Status" enabled={updatePlayStatus} onToggle={() => setUpdatePlayStatus((p) => !p)}>
          <Select value={playStatusId} onChange={(e) => setPlayStatusId(e.target.value)}>
            {playStatuses.map((s) => <option key={s.play_status_id} value={s.play_status_id}>{s.status_name}</option>)}
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
  const [mobileCardsPerRow, setMobileCardsPerRow] = useMobileCardsPerRow("videogames.mobileCardsPerRow");
  const isMobile = useMediaQuery(MOBILE_BREAKPOINT);
  const sentinelRef = useRef(null);
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

  const mobileVisible = useMobileInfiniteScroll({
    enabled: isMobile && viewMode === "grid",
    totalCount: sortedGames.length,
    sentinelRef,
    resetKey: sortedGames,
  });

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

  if (loading) return <div style={{ padding: "var(--space-9)", fontSize: "var(--text-base)" }}>Loading…</div>;
  if (error) return <div style={{ padding: "var(--space-9)" }}><Alert tone="error">{error}</Alert></div>;

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
              <span className="desktop-only" style={{ display: "inline-flex", alignItems: "center" }}>
                <SegmentedButtons
                  options={[{ value: "s", label: "S" }, { value: "m", label: "M" }, { value: "l", label: "L" }]}
                  value={gridSize} onChange={setGridSize} />
              </span>
              <MobilePerRowStepper value={mobileCardsPerRow} onChange={setMobileCardsPerRow} />
              <ToggleButton active={showCaptions} onClick={() => setShowCaptions(p => !p)}>Captions</ToggleButton>
            </>
          )}
        </Row>
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
            <p style={{ padding: "var(--space-8)", fontSize: "var(--text-base)", color: "var(--text-secondary)" }}>No games match current filters.</p>
          ) : viewMode === "grid" ? (
            <>
              <div
                className="cc-mobile-grid"
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "var(--space-5)",
                  padding: "var(--space-6)",
                  alignContent: "flex-start",
                  "--mobile-cards-per-row": mobileCardsPerRow,
                  "--cell-aspect-ratio": "3 / 4",
                }}
              >
                {(isMobile ? sortedGames.slice(0, mobileVisible) : sortedGames).map(g => (
                  <VideoGameGridItem key={g.item_id} game={g}
                    isSelected={selectedIds.has(g.item_id)}
                    onToggleSelect={toggleSelect}
                    onClick={() => setEditId(g.item_id)}
                    gridSize={gridSize} showCaptions={showCaptions} />
                ))}
              </div>
              {isMobile && (
                <MobileInfiniteSentinel visible={mobileVisible} total={sortedGames.length} sentinelRef={sentinelRef} />
              )}
            </>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--text-base)", tableLayout: "fixed" }}>
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
                            ? <img src={getImageUrl(g.cover_image_url)} alt="" style={{ width: 42, height: 60, objectFit: "cover", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)", display: "block" }} />
                            : <div style={{ width: 42, height: 60, background: "var(--bg-surface)", borderRadius: "var(--radius-sm)" }} />}
                        </td>
                      )}
                      <td style={{ padding: "3px 8px", fontWeight: 500, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{g.title}</td>
                      <td style={{ padding: "3px 8px", fontSize: "var(--text-sm)", color: "var(--text-secondary)", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{(g.platforms || []).join(", ") || "—"}</td>
                      <td style={{ padding: "3px 8px", fontSize: "var(--text-sm)", color: "var(--text-secondary)", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{(g.developers || []).join(", ") || "—"}</td>
                      <td style={{ padding: "3px 8px", fontSize: "var(--text-sm)", color: "var(--text-secondary)", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
                        {(g.genres || []).slice(0, 2).join(", ")}{g.genres?.length > 2 ? "…" : ""}
                      </td>
                      <td style={{ padding: "3px 8px", fontSize: "var(--text-sm)", color: "var(--text-secondary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{g.play_status || "—"}</td>
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
