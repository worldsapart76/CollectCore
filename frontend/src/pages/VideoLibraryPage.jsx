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
  bulkDeleteVideo,
  bulkUpdateVideo,
  deleteVideo,
  fetchOwnershipStatuses,
  fetchVideoCategories,
  fetchVideoFormatTypes,
  fetchVideoGenres,
  fetchConsumptionStatuses,
  getVideo,
  listVideo,
  updateVideo,
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

const TV_CATEGORY = "TV Series";

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

function VideoFilters({ items, ownershipStatuses, watchStatuses, categories, formatTypes, filters, onSectionChange, onClearAll }) {
  const allDirectors = useMemo(() => {
    const seen = new Set();
    const result = [];
    for (const v of items) for (const d of (v.directors || [])) if (!seen.has(d)) { seen.add(d); result.push(d); }
    return result.sort().map(d => ({ id: d, label: d }));
  }, [items]);

  const allGenreLabels = useMemo(() => {
    const seen = new Set();
    const result = [];
    for (const v of items) for (const g of (v.genres || [])) if (!seen.has(g)) { seen.add(g); result.push(g); }
    return result.sort().map(g => ({ id: g, label: g }));
  }, [items]);

  const hasFilters = filters.search.trim() ||
    sectionActive(filters.ownership) || sectionActive(filters.watchStatus) ||
    sectionActive(filters.category) || sectionActive(filters.director) ||
    sectionActive(filters.genre) || sectionActive(filters.format) ||
    sectionActive(filters.mediaServer);

  return (
    <FilterSidebarShell hasFilters={!!hasFilters} onClearAll={onClearAll}>
      <div style={{ marginBottom: "var(--space-5)" }}>
        <label style={{ display: "block", fontSize: "var(--text-xs)", fontWeight: 700, color: "var(--text-secondary)", marginBottom: "var(--space-1)" }}>Search</label>
        <Input
          size="sm"
          value={filters.search}
          onChange={e => onSectionChange("search", e.target.value)}
          placeholder="Title, director, notes…"
        />
      </div>
      <TriStateFilterSection
        title="Content Type"
        items={categories.map(c => ({ id: String(c.top_level_category_id), label: c.category_name }))}
        section={filters.category}
        onChange={s => onSectionChange("category", s)}
      />
      <TriStateFilterSection
        title="Ownership"
        defaultShown={2}
        items={ownershipStatuses.map(s => ({ id: String(s.ownership_status_id), label: s.status_name }))}
        section={filters.ownership}
        onChange={s => onSectionChange("ownership", s)}
      />
      <TriStateFilterSection
        title="Watch Status"
        items={watchStatuses.map(s => ({ id: String(s.read_status_id), label: s.status_name }))}
        section={filters.watchStatus}
        onChange={s => onSectionChange("watchStatus", s)}
      />
      <TriStateFilterSection
        title="Format"
        items={formatTypes.map(f => ({ id: String(f.format_type_id), label: f.format_name }))}
        section={filters.format}
        onChange={s => onSectionChange("format", s)}
      />
      <TriStateFilterSection
        title="Media Server"
        items={[{ id: "1", label: "On server" }, { id: "0", label: "Not on server" }]}
        section={filters.mediaServer}
        onChange={s => onSectionChange("mediaServer", s)}
      />
      <SearchableTriStateSection
        title="Director"
        items={allDirectors}
        section={filters.director}
        onChange={s => onSectionChange("director", s)}
      />
      <SearchableTriStateSection
        title="Genre"
        items={allGenreLabels}
        section={filters.genre}
        onChange={s => onSectionChange("genre", s)}
      />
    </FilterSidebarShell>
  );
}

// ─── Genre picker ─────────────────────────────────────────────────────────────

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

  return (
    <Stack gap={2}>
      <Row gap={3} align="center">
        <Select value={topSel} onChange={e => { setTopSel(e.target.value); setSubSel(""); }} style={{ flex: 1 }}>
          <option value="">— Genre —</option>
          {allGenres.map(g => <option key={g.top_genre_id} value={g.top_genre_id}>{g.genre_name}</option>)}
        </Select>
        {subGenres.length > 0 && (
          <Select value={subSel} onChange={e => setSubSel(e.target.value)} style={{ flex: 1 }}>
            <option value="">— Subgenre —</option>
            {subGenres.map(s => <option key={s.sub_genre_id} value={s.sub_genre_id}>{s.sub_genre_name}</option>)}
          </Select>
        )}
        <Button variant="secondary" size="sm" onClick={add}>+ Add</Button>
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

// ─── Copies editor ────────────────────────────────────────────────────────────

function CopiesEditor({ copies, onChange, formatTypes, ownershipStatuses }) {
  function addCopy() { onChange([...copies, { format_type_id: null, ownership_status_id: null, notes: "" }]); }
  function updateCopy(idx, field, val) { onChange(copies.map((c, i) => i === idx ? { ...c, [field]: val } : c)); }
  function removeCopy(idx) { onChange(copies.filter((_, i) => i !== idx)); }
  return (
    <Stack gap={3}>
      {copies.map((c, i) => (
        <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr auto", gap: "var(--space-3)", alignItems: "end" }}>
          <FormField label="Format">
            <Select value={c.format_type_id || ""} onChange={e => updateCopy(i, "format_type_id", e.target.value ? parseInt(e.target.value) : null)}>
              <option value="">— Format —</option>
              {formatTypes.map(f => <option key={f.format_type_id} value={f.format_type_id}>{f.format_name}</option>)}
            </Select>
          </FormField>
          <FormField label="Ownership">
            <Select value={c.ownership_status_id || ""} onChange={e => updateCopy(i, "ownership_status_id", e.target.value ? parseInt(e.target.value) : null)}>
              <option value="">— Status —</option>
              {ownershipStatuses.map(s => <option key={s.ownership_status_id} value={s.ownership_status_id}>{s.status_name}</option>)}
            </Select>
          </FormField>
          <FormField label="Notes">
            <Input value={c.notes || ""} onChange={e => updateCopy(i, "notes", e.target.value)} placeholder="Notes" />
          </FormField>
          <RemoveButton onClick={() => removeCopy(i)} style={{ alignSelf: "center", marginBottom: "var(--space-2)" }} />
        </div>
      ))}
      <Button variant="secondary" size="sm" onClick={addCopy} style={{ alignSelf: "flex-start" }}>+ Add Copy</Button>
    </Stack>
  );
}

// ─── Seasons editor ───────────────────────────────────────────────────────────

function SeasonsEditor({ seasons, onChange, formatTypes, ownershipStatuses }) {
  function addSeason() {
    const nextNum = seasons.length > 0 ? Math.max(...seasons.map(s => s.season_number)) + 1 : 1;
    onChange([...seasons, { season_number: nextNum, episode_count: null, notes: "", copies: [] }]);
  }
  function updateSeason(idx, field, val) { onChange(seasons.map((s, i) => i === idx ? { ...s, [field]: val } : s)); }
  function removeSeason(idx) { onChange(seasons.filter((_, i) => i !== idx)); }
  return (
    <Stack gap={3}>
      {seasons.map((s, i) => (
        <div key={i} style={{ border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "var(--space-3)", background: "var(--bg-base)" }}>
          <div style={{ display: "grid", gridTemplateColumns: "80px 100px auto", gap: "var(--space-3)", alignItems: "end", marginBottom: "var(--space-3)" }}>
            <FormField label="Season">
              <Input
                type="number"
                value={s.season_number ?? ""}
                onChange={e => updateSeason(i, "season_number", e.target.value === "" ? "" : parseInt(e.target.value, 10))}
                onBlur={e => {
                  const n = parseInt(e.target.value, 10);
                  if (!Number.isFinite(n) || n < 1) {
                    const used = seasons.filter((_, j) => j !== i).map(x => x.season_number).filter(Number.isFinite);
                    updateSeason(i, "season_number", used.length > 0 ? Math.max(...used) + 1 : 1);
                  }
                }}
                min={1}
              />
            </FormField>
            <FormField label="Episodes">
              <Input type="number" value={s.episode_count || ""} onChange={e => updateSeason(i, "episode_count", e.target.value ? parseInt(e.target.value) : null)} placeholder="—" min={1} />
            </FormField>
            <RemoveButton onClick={() => removeSeason(i)} style={{ alignSelf: "center", justifySelf: "end", marginBottom: "var(--space-2)" }} />
          </div>
          <div style={{ fontSize: "var(--text-xs)", fontWeight: 700, color: "var(--text-secondary)", marginBottom: "var(--space-2)" }}>Copies / Formats</div>
          <CopiesEditor
            copies={s.copies || []}
            onChange={v => updateSeason(i, "copies", v)}
            formatTypes={formatTypes}
            ownershipStatuses={ownershipStatuses}
          />
        </div>
      ))}
      <Button variant="secondary" size="sm" onClick={addSeason} style={{ alignSelf: "flex-start" }}>+ Add Season</Button>
    </Stack>
  );
}

// ─── Grid item ────────────────────────────────────────────────────────────────

const VideoGridItem = memo(function VideoGridItem({ video, isSelected, onToggleSelect, onClick, gridSize, showCaptions }) {
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
            onChange={() => onToggleSelect(video.item_id)}
            onClick={(e) => e.stopPropagation()}
            style={{ margin: 0, cursor: "pointer" }} />
        </div>
        <OwnershipBadge statusName={video.ownership_status} />
        {video.cover_image_url ? (
          <img src={getImageUrl(video.cover_image_url)} alt="" style={{ width: w, height: h, objectFit: "cover", display: "block", borderRadius: "var(--radius-sm)" }} />
        ) : (
          <div style={{ width: w, height: h, background: "var(--bg-surface)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ fontSize: "10px", color: "var(--text-muted)" }}>No Cover</span>
          </div>
        )}
      </div>
      {showCaptions && (
        <div style={{ padding: "3px 2px 0", maxWidth: w }}>
          <div style={{ fontSize: "var(--text-xs)", fontWeight: 700, lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-primary)" }}>{video.title}</div>
          <div style={{ fontSize: "10px", color: "var(--text-muted)", lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {(video.directors || []).join(", ") || (video.release_date?.slice(0, 4) || "")}
          </div>
        </div>
      )}
    </div>
  );
});

// ─── Detail modal ─────────────────────────────────────────────────────────────

function VideoDetailModal({ item, categories, formatTypes, allGenres, ownershipStatuses, watchStatuses, onSaved, onDeleted, onClose }) {
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const coverFileRef = useRef(null);

  async function handleCoverFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const { url } = await uploadCover(file, "video", item.item_id);
      set("cover_image_url", url);
    } catch (err) {
      setError(err.message || "Cover upload failed.");
    }
    if (coverFileRef.current) coverFileRef.current.value = "";
  }

  useEffect(() => {
    getVideo(item.item_id).then(detail => {
      setForm({
        title: detail.title || "",
        top_level_category_id: String(detail.top_level_category_id),
        ownership_status_id: String(detail.ownership_status_id),
        reading_status_id: detail.reading_status_id ? String(detail.reading_status_id) : "",
        release_date: detail.release_date || "",
        runtime_minutes: detail.runtime_minutes ? String(detail.runtime_minutes) : "",
        description: detail.description || "",
        cover_image_url: detail.cover_image_url || "",
        notes: detail.notes || "",
        on_media_server: !!detail.on_media_server,
        director_names: detail.director_names?.length ? detail.director_names : [""],
        cast_names: detail.cast_names?.length ? detail.cast_names : [""],
        genres: detail.genres || [],
        copies: detail.copies || [],
        seasons: (detail.seasons || []).map(s => ({
          season_id: s.season_id,
          season_number: s.season_number,
          episode_count: s.episode_count,
          notes: s.notes || "",
          copies: s.copies || [],
        })),
      });
    }).catch(() => setError("Failed to load details."));
  }, [item.item_id]);

  function set(field, val) { setForm(f => ({ ...f, [field]: val })); }

  const selectedCategory = form ? categories.find(c => String(c.top_level_category_id) === String(form.top_level_category_id)) : null;
  const isTV = selectedCategory?.category_name === TV_CATEGORY;

  async function handleSave() {
    if (!form.title.trim()) { setError("Title is required."); return; }
    if (isTV && form.seasons.some(s => !Number.isFinite(s.season_number) || s.season_number < 1)) {
      setError("Every season needs a number (1 or greater).");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const payload = {
        title: form.title.trim(),
        top_level_category_id: parseInt(form.top_level_category_id),
        ownership_status_id: parseInt(form.ownership_status_id),
        reading_status_id: form.reading_status_id ? parseInt(form.reading_status_id) : null,
        release_date: form.release_date || null,
        runtime_minutes: form.runtime_minutes ? parseInt(form.runtime_minutes) : null,
        description: form.description || null,
        cover_image_url: form.cover_image_url || null,
        notes: form.notes || null,
        on_media_server: !!form.on_media_server,
        director_names: form.director_names.map(n => n.trim()).filter(Boolean),
        cast_names: form.cast_names.map(n => n.trim()).filter(Boolean),
        genres: form.genres,
        copies: isTV ? [] : form.copies,
        seasons: isTV ? form.seasons : [],
      };
      await updateVideo(item.item_id, payload);
      onSaved();
    } catch (e) {
      setError(e.message || "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      await deleteVideo(item.item_id);
      onDeleted(item.item_id);
    } catch (e) {
      setError(e.message || "Delete failed.");
    } finally {
      setDeleting(false);
    }
  }

  const footer = form ? (
    <Row justify="between" gap={4} style={{ width: "100%" }}>
      <ConfirmButton
        label="Delete"
        confirmLabel={deleting ? "Deleting…" : "Confirm"}
        promptText="Delete this video?"
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
      title={!form ? "Loading…" : form.title || "Video Detail"}
      footer={footer}
      footerJustify="between"
    >
      {!form && !error && <div style={{ color: "var(--text-muted)" }}>Loading…</div>}
      {error && <Alert tone="error" style={{ marginBottom: "var(--space-5)" }}>{error}</Alert>}

      {form && (
        <Stack gap={5}>
          {form.cover_image_url && (
            <Row gap={5} align="start">
              <CoverThumb src={getImageUrl(form.cover_image_url)} alt="cover" size="md" />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: "var(--text-md)", marginBottom: 2 }}>{form.title}</div>
                <div style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>
                  {form.director_names.filter(Boolean).join(", ")}
                </div>
              </div>
            </Row>
          )}

          <Grid cols={2} gap={5}>
            <FormField label="Content Type">
              <Select value={form.top_level_category_id} onChange={e => setForm(f => ({ ...f, top_level_category_id: e.target.value, copies: [], seasons: [] }))}>
                {categories.map(c => <option key={c.top_level_category_id} value={c.top_level_category_id}>{c.category_name}</option>)}
              </Select>
            </FormField>
            <FormField label="Ownership">
              <Select value={form.ownership_status_id} onChange={e => set("ownership_status_id", e.target.value)}>
                {ownershipStatuses.map(s => <option key={s.ownership_status_id} value={s.ownership_status_id}>{s.status_name}</option>)}
              </Select>
            </FormField>
          </Grid>

          <FormField label="Title" required>
            <Input value={form.title} onChange={e => set("title", e.target.value)} />
          </FormField>

          <Grid cols={3} gap={5}>
            <FormField label="Release Date">
              <Input type="date" value={form.release_date} onChange={e => set("release_date", e.target.value)} />
            </FormField>
            {!isTV && (
              <FormField label="Runtime (min)">
                <Input type="number" value={form.runtime_minutes} onChange={e => set("runtime_minutes", e.target.value)} min={1} />
              </FormField>
            )}
            <FormField label="Watch Status">
              <Select value={form.reading_status_id} onChange={e => set("reading_status_id", e.target.value)}>
                <option value="">— Status —</option>
                {watchStatuses.map(s => <option key={s.read_status_id} value={s.read_status_id}>{s.status_name}</option>)}
              </Select>
            </FormField>
          </Grid>

          <Checkbox
            label="Added to media server"
            checked={!!form.on_media_server}
            onChange={e => set("on_media_server", e.target.checked)}
          />

          <FormField label="Cover Image URL">
            <Row gap={3} align="start">
              <Input value={form.cover_image_url} onChange={e => set("cover_image_url", e.target.value)} style={{ flex: 1 }} />
              <input type="file" accept="image/*" ref={coverFileRef} onChange={handleCoverFile} style={{ display: "none" }} />
              <Button type="button" variant="secondary" size="sm" onClick={() => coverFileRef.current?.click()}>
                Add Image
              </Button>
              {form.cover_image_url && <CoverThumb src={getImageUrl(form.cover_image_url)} alt="" size="sm" />}
            </Row>
          </FormField>

          <FormField label="Genres">
            <GenrePicker allGenres={allGenres} selected={form.genres} onChange={v => set("genres", v)} />
          </FormField>

          {isTV ? (
            <FormField label="Seasons">
              <SeasonsEditor seasons={form.seasons} onChange={v => set("seasons", v)} formatTypes={formatTypes} ownershipStatuses={ownershipStatuses} />
            </FormField>
          ) : (
            <FormField label="Copies / Formats">
              <CopiesEditor copies={form.copies} onChange={v => set("copies", v)} formatTypes={formatTypes} ownershipStatuses={ownershipStatuses} />
            </FormField>
          )}

          <FormField label="Description">
            <Textarea value={form.description} onChange={e => set("description", e.target.value)} rows={3} />
          </FormField>
          <FormField label="Notes">
            <Textarea value={form.notes} onChange={e => set("notes", e.target.value)} rows={2} />
          </FormField>

          <FormField label="Director(s) / Creator(s)">
            <NameList names={form.director_names} onChange={v => set("director_names", v)} addLabel="+ Director" placeholder="Director name" />
          </FormField>

          <FormField label="Cast">
            <NameList names={form.cast_names} onChange={v => set("cast_names", v)} addLabel="+ Cast member" placeholder="Cast member name" />
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

function VideoBulkEdit({ selectedIds, ownershipStatuses, watchStatuses, onClose, onSaved, onDeleted }) {
  const [updateOwnership, setUpdateOwnership] = useState(false);
  const [ownershipId, setOwnershipId] = useState(String(ownershipStatuses[0]?.ownership_status_id || ""));
  const [updateWatchStatus, setUpdateWatchStatus] = useState(false);
  const [watchStatusId, setWatchStatusId] = useState(String(watchStatuses[0]?.read_status_id || ""));

  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  const anyEnabled = updateOwnership || updateWatchStatus;
  const noun = selectedIds.length === 1 ? "video" : "videos";

  async function handleSave() {
    if (!anyEnabled) { setError("Select at least one field to update."); return; }
    const fields = {};
    if (updateOwnership) fields.ownership_status_id = Number(ownershipId);
    if (updateWatchStatus) fields.reading_status_id = Number(watchStatusId);
    setSaving(true); setError("");
    try { await bulkUpdateVideo(selectedIds, fields); onSaved(); }
    catch (err) { setError(err.message || "Failed to update"); }
    finally { setSaving(false); }
  }

  async function handleDelete() {
    setDeleting(true);
    try { await bulkDeleteVideo(selectedIds); onDeleted(); }
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
        <BulkField label="Watch Status" enabled={updateWatchStatus} onToggle={() => setUpdateWatchStatus((p) => !p)}>
          <Select value={watchStatusId} onChange={(e) => setWatchStatusId(e.target.value)}>
            {watchStatuses.map((s) => <option key={s.read_status_id} value={s.read_status_id}>{s.status_name}</option>)}
          </Select>
        </BulkField>
      </Stack>
    </Modal>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

const EMPTY_FILTERS = {
  search: "",
  category: emptySection(),
  ownership: emptySection(),
  watchStatus: emptySection(),
  format: emptySection(),
  mediaServer: emptySection(),
  director: emptySection(),
  genre: emptySection(),
};

export default function VideoLibraryPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [categories, setCategories] = useState([]);
  const [formatTypes, setFormatTypes] = useState([]);
  const [allGenres, setAllGenres] = useState([]);
  const [ownershipStatuses, setOwnershipStatuses] = useState([]);
  const [watchStatuses, setWatchStatuses] = useState([]);

  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [selected, setSelected] = useState(new Set());
  const [editItem, setEditItem] = useState(null);
  const [bulkEditOpen, setBulkEditOpen] = useState(false);

  const [viewMode, setViewMode] = useState("table");
  const [showThumbnails, setShowThumbnails] = useState(false);
  const [gridSize, setGridSize] = useState("m");
  const [mobileCardsPerRow, setMobileCardsPerRow] = useMobileCardsPerRow("video.mobileCardsPerRow");
  const isMobile = useMediaQuery(MOBILE_BREAKPOINT);
  const sentinelRef = useRef(null);
  const [showCaptions, setShowCaptions] = useState(true);

  const [sortField, setSortField] = useState("title");
  const [sortDir, setSortDir] = useState("asc");

  const [colWidths, setColWidths] = useState({
    title: 220, type: 90, year: 70, director: 150, watch: 110, ownership: 100, formats: 140,
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

  useEffect(() => {
    Promise.all([
      fetchVideoCategories(),
      fetchVideoFormatTypes(),
      fetchVideoGenres(),
      fetchOwnershipStatuses(COLLECTION_TYPE_IDS.video),
      fetchConsumptionStatuses(COLLECTION_TYPE_IDS.video),
    ]).then(([cats, fmts, genres, own, watch]) => {
      setCategories(cats);
      setFormatTypes(fmts);
      setAllGenres(genres);
      setOwnershipStatuses(own);
      setWatchStatuses(watch);
    });
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    listVideo().then(data => {
      setItems(data);
      setLoading(false);
    }).catch(() => {
      setError("Failed to load video library.");
      setLoading(false);
    });
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    let result = items;
    const q = filters.search.trim().toLowerCase();
    if (q) {
      result = result.filter(v =>
        v.title.toLowerCase().includes(q) ||
        (v.directors || []).some(d => d.toLowerCase().includes(q)) ||
        (v.notes || "").toLowerCase().includes(q)
      );
    }
    if (sectionActive(filters.category)) {
      result = result.filter(v => applySection(filters.category, [String(v.top_level_category_id)]));
    }
    if (sectionActive(filters.ownership)) {
      result = result.filter(v => {
        const ids = [String(v.ownership_status_id)];
        for (const id of v.season_ownership_status_ids || []) ids.push(String(id));
        for (const id of v.copy_ownership_status_ids || []) ids.push(String(id));
        return applySection(filters.ownership, ids);
      });
    }
    if (sectionActive(filters.watchStatus)) {
      result = result.filter(v => applySection(filters.watchStatus, [v.reading_status_id != null ? String(v.reading_status_id) : ""]));
    }
    if (sectionActive(filters.format)) {
      result = result.filter(v => applySection(filters.format, (v.all_format_type_ids || []).map(String)));
    }
    if (sectionActive(filters.mediaServer)) {
      result = result.filter(v => applySection(filters.mediaServer, [v.on_media_server ? "1" : "0"]));
    }
    if (sectionActive(filters.director)) {
      result = result.filter(v => applySection(filters.director, v.directors || []));
    }
    if (sectionActive(filters.genre)) {
      result = result.filter(v => applySection(filters.genre, v.genres || []));
    }
    return result;
  }, [items, filters]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    const flip = sortDir === "desc" ? -1 : 1;
    switch (sortField) {
      case "type":
        return arr.sort((a, b) => flip * ((a.video_type || "").localeCompare(b.video_type || "")));
      case "year":
        return arr.sort((a, b) => flip * ((a.release_date || "").localeCompare(b.release_date || "")));
      case "watch":
        return arr.sort((a, b) => flip * ((a.watch_status || "").localeCompare(b.watch_status || "")));
      case "ownership":
        return arr.sort((a, b) => flip * ((a.ownership_status || "").localeCompare(b.ownership_status || "")));
      default:
        return arr.sort((a, b) => flip * ((a.title_sort || a.title || "").localeCompare(b.title_sort || b.title || "")));
    }
  }, [filtered, sortField, sortDir]);

  const mobileVisible = useMobileInfiniteScroll({
    enabled: isMobile && viewMode === "grid",
    totalCount: sorted.length,
    sentinelRef,
    resetKey: sorted,
  });

  function handleSectionChange(key, val) {
    setFilters(f => ({ ...f, [key]: val }));
  }

  function clearAll() {
    setFilters(EMPTY_FILTERS);
  }

  function toggleSelect(id) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function clearSelection() { setSelected(new Set()); }

  function toggleSelectAll() {
    if (sorted.length > 0 && sorted.every(v => selected.has(v.item_id))) clearSelection();
    else setSelected(new Set(sorted.map(v => v.item_id)));
  }

  const allVisibleSelected = sorted.length > 0 && sorted.every(v => selected.has(v.item_id));

  function formatSummary(v) {
    if (v.video_type === TV_CATEGORY) {
      return v.season_count > 0 ? `${v.season_count} season${v.season_count !== 1 ? "s" : ""}` : "—";
    }
    return v.copy_formats?.length ? v.copy_formats.join(", ") : (v.copy_count > 0 ? `${v.copy_count} copy` : "—");
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden", fontSize: "var(--text-base)" }}>
      {/* Controls bar */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "var(--space-3) var(--space-6)", borderBottom: "1px solid var(--border)", background: "var(--bg-sidebar)", flexShrink: 0, gap: "var(--space-4)", flexWrap: "wrap" }}>
        <Row gap={5}>
          <span style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>
            {loading ? "Loading…" : `${sorted.length} of ${items.length}`}
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

      {error && (
        <div style={{ margin: "var(--space-4) var(--space-6)" }}>
          <Alert tone="error">{error}</Alert>
        </div>
      )}

      {/* Main layout */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        <VideoFilters
          items={items}
          ownershipStatuses={ownershipStatuses}
          watchStatuses={watchStatuses}
          categories={categories}
          formatTypes={formatTypes}
          filters={filters}
          onSectionChange={handleSectionChange}
          onClearAll={clearAll}
        />

        <div style={{ flex: 1, overflowY: "auto", overflowX: "auto", padding: 0 }}>
          {loading && items.length === 0 ? (
            <div style={{ padding: "var(--space-8)", color: "var(--text-secondary)" }}>Loading…</div>
          ) : sorted.length === 0 ? (
            <div style={{ padding: "var(--space-8)", color: "var(--text-secondary)" }}>No items found.</div>
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
                  "--cell-aspect-ratio": "2 / 3",
                }}
              >
                {(isMobile ? sorted.slice(0, mobileVisible) : sorted).map(v => (
                  <VideoGridItem key={v.item_id} video={v}
                    isSelected={selected.has(v.item_id)}
                    onToggleSelect={toggleSelect}
                    onClick={() => setEditItem(v)}
                    gridSize={gridSize} showCaptions={showCaptions} />
                ))}
              </div>
              {isMobile && (
                <MobileInfiniteSentinel visible={mobileVisible} total={sorted.length} sentinelRef={sentinelRef} />
              )}
            </>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--text-base)", tableLayout: "fixed" }}>
              <colgroup>
                <col style={{ width: 28 }} />
                {showThumbnails && <col style={{ width: 50 }} />}
                <col style={{ width: colWidths.title }} />
                <col style={{ width: colWidths.type }} />
                <col style={{ width: colWidths.year }} />
                <col style={{ width: colWidths.director }} />
                <col style={{ width: colWidths.watch }} />
                <col style={{ width: colWidths.ownership }} />
                <col style={{ width: colWidths.formats }} />
              </colgroup>
              <thead style={{ position: "sticky", top: 0, zIndex: 2 }}>
                <tr style={{ background: "var(--bg-sidebar)", borderBottom: "1px solid var(--border)" }}>
                  <th style={{ padding: "5px 6px", textAlign: "center", borderRight: "1px solid var(--border)" }}>
                    <input type="checkbox" checked={allVisibleSelected} onChange={toggleSelectAll} style={{ margin: 0, cursor: "pointer" }} />
                  </th>
                  {showThumbnails && <th style={{ padding: "5px 6px", borderRight: "1px solid var(--border)" }} />}
                  {[
                    { key: "title", label: "Title", colKey: "title" },
                    { key: "type", label: "Type", colKey: "type" },
                    { key: "year", label: "Year", colKey: "year" },
                    { key: null, label: "Director(s)", colKey: "director" },
                    { key: "watch", label: "Watch Status", colKey: "watch" },
                    { key: "ownership", label: "Ownership", colKey: "ownership" },
                    { key: null, label: "Copies / Seasons", colKey: "formats" },
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
                {sorted.map(v => {
                  const isSelected = selected.has(v.item_id);
                  return (
                    <tr
                      key={v.item_id}
                      onClick={() => setEditItem(v)}
                      style={{ cursor: "pointer", borderBottom: "1px solid var(--border)", background: isSelected ? "var(--green-light)" : undefined }}
                      onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = "var(--bg-surface)"; }}
                      onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = ""; }}
                    >
                      <td style={{ padding: "3px 6px", verticalAlign: "middle", width: 28 }} onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(v.item_id)} style={{ margin: 0, cursor: "pointer" }} />
                      </td>
                      {showThumbnails && (
                        <td style={{ padding: "3px 6px", verticalAlign: "middle", width: 50 }}>
                          {v.cover_image_url
                            ? <img src={getImageUrl(v.cover_image_url)} alt="" style={{ width: 42, height: 60, objectFit: "cover", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)", display: "block" }} />
                            : <div style={{ width: 42, height: 60, background: "var(--bg-surface)", borderRadius: "var(--radius-sm)" }} />}
                        </td>
                      )}
                      <td style={{ padding: "3px 8px", fontWeight: 500, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{v.title}</td>
                      <td style={{ padding: "3px 8px", fontSize: "var(--text-sm)", color: "var(--text-secondary)", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{v.video_type}</td>
                      <td style={{ padding: "3px 8px", fontSize: "var(--text-sm)", color: "var(--text-secondary)", whiteSpace: "nowrap" }}>{v.release_date ? v.release_date.slice(0, 4) : "—"}</td>
                      <td style={{ padding: "3px 8px", fontSize: "var(--text-sm)", color: "var(--text-secondary)", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{v.directors?.join(", ") || "—"}</td>
                      <td style={{ padding: "3px 8px", fontSize: "var(--text-sm)", color: "var(--text-secondary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{v.watch_status || "—"}</td>
                      <td style={{ padding: "3px 8px", fontSize: "var(--text-sm)", color: "var(--text-secondary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{v.ownership_status}</td>
                      <td style={{ padding: "3px 8px", fontSize: "var(--text-sm)", color: "var(--text-secondary)", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{formatSummary(v)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {editItem && (
        <VideoDetailModal
          item={editItem}
          categories={categories}
          formatTypes={formatTypes}
          allGenres={allGenres}
          ownershipStatuses={ownershipStatuses}
          watchStatuses={watchStatuses}
          onSaved={() => { setEditItem(null); load(); }}
          onDeleted={(id) => {
            setEditItem(null);
            setItems(prev => prev.filter(v => v.item_id !== id));
            setSelected(prev => { const next = new Set(prev); next.delete(id); return next; });
          }}
          onClose={() => setEditItem(null)}
        />
      )}

      {bulkEditOpen && (
        <VideoBulkEdit
          selectedIds={[...selected]}
          ownershipStatuses={ownershipStatuses}
          watchStatuses={watchStatuses}
          onClose={() => setBulkEditOpen(false)}
          onSaved={async () => { setBulkEditOpen(false); clearSelection(); load(); }}
          onDeleted={async () => { setBulkEditOpen(false); clearSelection(); load(); }}
        />
      )}
    </div>
  );
}
