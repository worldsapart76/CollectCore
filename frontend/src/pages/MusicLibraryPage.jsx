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
  bulkDeleteMusic,
  bulkUpdateMusic,
  deleteMusicRelease,
  fetchMusicFormatTypes,
  fetchMusicGenres,
  fetchMusicReleaseTypes,
  fetchOwnershipStatuses,
  getMusicRelease,
  listMusicReleases,
  updateMusicRelease,
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
import { ToggleButton, SegmentedButtons } from "../components/shared/SegmentedButtons";
import { COLLECTION_TYPE_IDS } from "../constants/collectionTypes";
import {
  Alert,
  Badge,
  Button,
  Card,
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

function SectionBlock({ title, children }) {
  return (
    <Card surface>
      <Stack gap={3}>
        <div style={{ fontSize: "var(--text-sm)", fontWeight: 700, color: "var(--text-secondary)" }}>{title}</div>
        {children}
      </Stack>
    </Card>
  );
}

// ─── Filter sidebar ───────────────────────────────────────────────────────────

function MusicFilters({ items, ownershipStatuses, releaseTypes, filters, onSectionChange, onClearAll }) {
  const allArtists = useMemo(() => {
    const seen = new Set();
    const result = [];
    for (const r of items) for (const a of (r.artists || [])) if (a && !seen.has(a)) { seen.add(a); result.push(a); }
    return result.sort().map(a => ({ id: a, label: a }));
  }, [items]);

  const allGenreLabels = useMemo(() => {
    const seen = new Set();
    const result = [];
    for (const r of items) for (const g of (r.genres || [])) if (g && !seen.has(g)) { seen.add(g); result.push(g); }
    return result.sort().map(g => ({ id: g, label: g }));
  }, [items]);

  const allFormats = useMemo(() => {
    const seen = new Set();
    const result = [];
    for (const r of items) for (const f of (r.formats || [])) if (f && !seen.has(f)) { seen.add(f); result.push(f); }
    return result.sort().map(f => ({ id: f, label: f }));
  }, [items]);

  const hasFilters = filters.search.trim() ||
    sectionActive(filters.ownership) || sectionActive(filters.releaseType) ||
    sectionActive(filters.artist) || sectionActive(filters.genre) || sectionActive(filters.format);

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
        title="Release Type"
        items={releaseTypes.map(r => ({ id: r.top_level_category_id, label: r.category_name }))}
        section={filters.releaseType}
        onChange={s => onSectionChange("releaseType", s)}
      />
      <TriStateFilterSection
        title="Format"
        items={allFormats}
        section={filters.format}
        onChange={s => onSectionChange("format", s)}
      />
      <SearchableTriStateSection
        title="Genre"
        items={allGenreLabels}
        section={filters.genre}
        onChange={s => onSectionChange("genre", s)}
      />
      <SearchableTriStateSection
        title="Artist"
        items={allArtists}
        section={filters.artist}
        onChange={s => onSectionChange("artist", s)}
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
      if (!selected.find(g => `${g.top_genre_id}-${g.sub_genre_id}` === `${topId}-null`)) {
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

// ─── Track list editor (edit modal) ──────────────────────────────────────────

function formatDuration(seconds) {
  if (!seconds) return "";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function parseDuration(str) {
  if (!str) return null;
  str = str.trim();
  if (/^\d+$/.test(str)) return parseInt(str, 10);
  const m = str.match(/^(\d+):(\d{1,2})$/);
  if (m) return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  return null;
}

function TrackListEditor({ songs, onChange }) {
  function update(idx, key, val) {
    const next = [...songs];
    next[idx] = { ...next[idx], [key]: val };
    onChange(next);
  }
  function add() { onChange([...songs, { title: "", duration_seconds: null, track_number: songs.length + 1, disc_number: 1 }]); }
  function remove(idx) { onChange(songs.filter((_, i) => i !== idx)); }

  const rowGrid = { display: "grid", gridTemplateColumns: "28px 1fr 60px 40px 24px", gap: "var(--space-2)", alignItems: "center" };

  return (
    <Stack gap={2}>
      {songs.length > 0 && (
        <div style={rowGrid}>
          <span style={{ fontSize: "10px", color: "var(--text-secondary)", textAlign: "center" }}>#</span>
          <span style={{ fontSize: "10px", color: "var(--text-secondary)" }}>Title</span>
          <span style={{ fontSize: "10px", color: "var(--text-secondary)" }}>Duration</span>
          <span style={{ fontSize: "10px", color: "var(--text-secondary)" }}>Disc</span>
          <span />
        </div>
      )}
      {songs.map((s, i) => (
        <div key={i} style={rowGrid}>
          <Input
            value={s.track_number || ""}
            onChange={e => update(i, "track_number", e.target.value)}
            style={{ textAlign: "center", padding: "2px 3px" }}
          />
          <Input
            value={s.title}
            onChange={e => update(i, "title", e.target.value)}
            placeholder="Track title"
          />
          <Input
            value={s.duration_seconds ? formatDuration(s.duration_seconds) : (s._durStr || "")}
            onChange={e => {
              const next = [...songs];
              const parsed = parseDuration(e.target.value);
              next[i] = { ...next[i], duration_seconds: parsed, _durStr: e.target.value };
              onChange(next);
            }}
            style={{ padding: "2px 4px" }}
            placeholder="m:ss"
          />
          <Input
            value={s.disc_number || 1}
            onChange={e => update(i, "disc_number", parseInt(e.target.value, 10) || 1)}
            style={{ textAlign: "center", padding: "2px 3px" }}
          />
          <RemoveButton onClick={() => remove(i)} />
        </div>
      ))}
      <Button variant="secondary" size="sm" onClick={add} style={{ alignSelf: "flex-start", marginTop: "var(--space-1)" }}>
        + Track
      </Button>
    </Stack>
  );
}

// ─── Editions editor (edit modal) ─────────────────────────────────────────────

function EditionsEditor({ editions, formatTypes, ownershipStatuses, onChange }) {
  function update(idx, key, val) {
    const next = [...editions];
    next[idx] = { ...next[idx], [key]: val };
    onChange(next);
  }
  function add() { onChange([...editions, { format_type_id: "", version_name: "", label: "", catalog_number: "", barcode: "", notes: "", ownership_status_id: "" }]); }
  function remove(idx) { onChange(editions.filter((_, i) => i !== idx)); }

  return (
    <Stack gap={4}>
      {editions.map((e, i) => (
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
                Edition {i + 1}
              </span>
              <RemoveButton showLabel label="Remove" onClick={() => remove(i)} />
            </Row>
            <Grid cols={2} gap={4}>
              <FormField label="Format">
                <Select value={e.format_type_id || ""} onChange={ev => update(i, "format_type_id", ev.target.value)}>
                  <option value="">None</option>
                  {formatTypes.map(f => <option key={f.format_type_id} value={f.format_type_id}>{f.format_name}</option>)}
                </Select>
              </FormField>
              <FormField label="Version Name">
                <Input value={e.version_name || ""} onChange={ev => update(i, "version_name", ev.target.value)} placeholder="e.g. Limited Edition" />
              </FormField>
            </Grid>
            <Grid cols={2} gap={4}>
              <FormField label="Label">
                <Input value={e.label || ""} onChange={ev => update(i, "label", ev.target.value)} placeholder="Record label" />
              </FormField>
              <FormField label="Catalog #">
                <Input value={e.catalog_number || ""} onChange={ev => update(i, "catalog_number", ev.target.value)} />
              </FormField>
            </Grid>
            <Grid cols={2} gap={4}>
              <FormField label="Barcode">
                <Input value={e.barcode || ""} onChange={ev => update(i, "barcode", ev.target.value)} />
              </FormField>
              <FormField label="Ownership">
                <Select value={e.ownership_status_id || ""} onChange={ev => update(i, "ownership_status_id", ev.target.value)}>
                  <option value="">None</option>
                  {ownershipStatuses.map(s => <option key={s.ownership_status_id} value={s.ownership_status_id}>{s.status_name}</option>)}
                </Select>
              </FormField>
            </Grid>
            <FormField label="Notes">
              <Input value={e.notes || ""} onChange={ev => update(i, "notes", ev.target.value)} />
            </FormField>
          </Stack>
        </div>
      ))}
      <Button variant="secondary" size="sm" onClick={add} style={{ alignSelf: "flex-start" }}>
        + Add Edition
      </Button>
    </Stack>
  );
}

// ─── Grid item ────────────────────────────────────────────────────────────────

const MusicGridItem = memo(function MusicGridItem({ release, isSelected, onToggleSelect, onClick, gridSize, showCaptions }) {
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
            onChange={() => onToggleSelect(release.item_id)}
            onClick={(e) => e.stopPropagation()}
            style={{ margin: 0, cursor: "pointer" }} />
        </div>
        <OwnershipBadge statusName={release.ownership_status} />
        {release.cover_image_url ? (
          <img src={getImageUrl(release.cover_image_url)} alt="" style={{ width: w, height: h, objectFit: "cover", display: "block", borderRadius: "var(--radius-sm)" }} />
        ) : (
          <div style={{ width: w, height: h, background: "var(--bg-surface)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ fontSize: "10px", color: "var(--text-muted)" }}>No Cover</span>
          </div>
        )}
      </div>
      {showCaptions && (
        <div style={{ padding: "3px 2px 0", maxWidth: w }}>
          <div style={{ fontSize: "var(--text-xs)", fontWeight: 700, lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-primary)" }}>{release.title}</div>
          <div style={{ fontSize: "10px", color: "var(--text-muted)", lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{(release.artists || []).join(", ")}</div>
        </div>
      )}
    </div>
  );
});

// ─── Detail modal ─────────────────────────────────────────────────────────────

function MusicDetailModal({ itemId, ownershipStatuses, releaseTypes, formatTypes, allGenres, onClose, onSaved, onDeleted }) {
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const [coverPreview, setCoverPreview] = useState(null);
  const coverFileRef = useRef(null);

  async function handleCoverFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const { url } = await uploadCover(file, "music", itemId);
      set("coverImageUrl", url);
      setCoverPreview(url);
    } catch (err) {
      setError(err.message || "Cover upload failed.");
    }
    if (coverFileRef.current) coverFileRef.current.value = "";
  }

  useEffect(() => {
    getMusicRelease(itemId).then(d => {
      setForm({
        title: d.title || "",
        releaseTypeId: String(d.top_level_category_id),
        ownershipStatusId: String(d.ownership_status_id),
        releaseDate: d.release_date || "",
        description: d.description || "",
        coverImageUrl: d.cover_image_url || "",
        notes: d.notes || "",
        artists: d.artist_names?.length ? [...d.artist_names] : [""],
        genres: d.genres?.map(g => ({ top_genre_id: g.top_genre_id, sub_genre_id: g.sub_genre_id })) || [],
        songs: d.songs?.map(s => ({ ...s })) || [],
        editions: d.editions?.map(e => ({
          ...e,
          format_type_id: e.format_type_id ? String(e.format_type_id) : "",
          ownership_status_id: e.ownership_status_id ? String(e.ownership_status_id) : "",
        })) || [],
      });
      setCoverPreview(d.cover_image_url || null);
    }).catch(() => setError("Failed to load release."));
  }, [itemId]);

  function set(key, val) { setForm(f => ({ ...f, [key]: val })); }

  async function handleSave() {
    setError("");
    if (!form.title.trim()) { setError("Title is required."); return; }
    setSaving(true);
    try {
      const payload = {
        title: form.title.trim(),
        top_level_category_id: parseInt(form.releaseTypeId, 10),
        ownership_status_id: parseInt(form.ownershipStatusId, 10),
        release_date: form.releaseDate || null,
        description: form.description || null,
        cover_image_url: form.coverImageUrl || null,
        notes: form.notes || null,
        artist_names: form.artists.map(a => a.trim()).filter(Boolean),
        genres: form.genres,
        songs: form.songs
          .filter(s => s.title?.trim())
          .map(s => ({
            title: s.title.trim(),
            duration_seconds: s.duration_seconds || null,
            track_number: s.track_number ? parseInt(s.track_number, 10) : null,
            disc_number: s.disc_number || 1,
          })),
        editions: form.editions
          .filter(e => e.format_type_id || e.version_name)
          .map(e => ({
            format_type_id: e.format_type_id ? parseInt(e.format_type_id, 10) : null,
            version_name: e.version_name || null,
            label: e.label || null,
            catalog_number: e.catalog_number || null,
            barcode: e.barcode || null,
            notes: e.notes || null,
            ownership_status_id: e.ownership_status_id ? parseInt(e.ownership_status_id, 10) : null,
          })),
      };
      await updateMusicRelease(itemId, payload);
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
      await deleteMusicRelease(itemId);
      onDeleted(itemId);
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
        promptText="Delete this release?"
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
      title={!form ? "Loading…" : form.title || "Release Detail"}
      footer={footer}
      footerJustify="between"
    >
      {!form && !error && <div style={{ color: "var(--text-muted)" }}>Loading…</div>}
      {error && <Alert tone="error" style={{ marginBottom: "var(--space-5)" }}>{error}</Alert>}

      {form && (
        <Stack gap={5}>
          {coverPreview && (
            <Row gap={5} align="start">
              <CoverThumb src={getImageUrl(coverPreview)} alt="cover" size="md" onError={() => setCoverPreview(null)} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: "var(--text-md)", marginBottom: 2 }}>{form.title}</div>
                <div style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>
                  {form.artists.filter(Boolean).join(", ")}
                </div>
              </div>
            </Row>
          )}

          <FormField label="Title" required>
            <Input value={form.title} onChange={e => set("title", e.target.value)} />
          </FormField>

          <Grid cols={2} gap={5}>
            <FormField label="Release Type">
              <Select value={form.releaseTypeId} onChange={e => set("releaseTypeId", e.target.value)}>
                {releaseTypes.map(r => <option key={r.top_level_category_id} value={r.top_level_category_id}>{r.category_name}</option>)}
              </Select>
            </FormField>
            <FormField label="Ownership">
              <Select value={form.ownershipStatusId} onChange={e => set("ownershipStatusId", e.target.value)}>
                {ownershipStatuses.map(s => <option key={s.ownership_status_id} value={s.ownership_status_id}>{s.status_name}</option>)}
              </Select>
            </FormField>
            <FormField label="Release Date">
              <Input value={form.releaseDate} onChange={e => set("releaseDate", e.target.value)} placeholder="YYYY-MM-DD" />
            </FormField>
            <FormField label="Cover Image URL">
              <Row gap={3} align="start">
                <Input
                  value={form.coverImageUrl}
                  onChange={e => { set("coverImageUrl", e.target.value); setCoverPreview(e.target.value || null); }}
                  placeholder="https://…"
                  style={{ flex: 1 }}
                />
                <input type="file" accept="image/*" ref={coverFileRef} onChange={handleCoverFile} style={{ display: "none" }} />
                <Button type="button" variant="secondary" size="sm" onClick={() => coverFileRef.current?.click()}>
                  Add Image
                </Button>
              </Row>
            </FormField>
          </Grid>

          <FormField label="Artist(s)">
            <Stack gap={2}>
              {form.artists.map((a, i) => (
                <Row key={i} gap={2} align="center">
                  <Input
                    value={a}
                    onChange={e => { const next = [...form.artists]; next[i] = e.target.value; set("artists", next); }}
                    placeholder="Artist name"
                    style={{ flex: 1 }}
                  />
                  {form.artists.length > 1 && (
                    <RemoveButton onClick={() => set("artists", form.artists.filter((_, x) => x !== i))} />
                  )}
                </Row>
              ))}
              <Button variant="secondary" size="sm" onClick={() => set("artists", [...form.artists, ""])} style={{ alignSelf: "flex-start" }}>
                + Artist
              </Button>
            </Stack>
          </FormField>

          <FormField label="Genre">
            <GenrePicker allGenres={allGenres} selected={form.genres} onChange={v => set("genres", v)} />
          </FormField>

          <FormField label="Description">
            <Textarea value={form.description} onChange={e => set("description", e.target.value)} rows={3} />
          </FormField>

          <FormField label="Notes">
            <Textarea value={form.notes} onChange={e => set("notes", e.target.value)} rows={2} />
          </FormField>

          <SectionBlock title="Track List">
            <TrackListEditor songs={form.songs} onChange={v => set("songs", v)} />
          </SectionBlock>

          <SectionBlock title="Editions / Versions">
            <EditionsEditor
              editions={form.editions}
              formatTypes={formatTypes}
              ownershipStatuses={ownershipStatuses}
              onChange={v => set("editions", v)}
            />
          </SectionBlock>
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

function MusicBulkEdit({ selectedIds, ownershipStatuses, releaseTypes, onClose, onSaved, onDeleted }) {
  const [updateOwnership, setUpdateOwnership] = useState(false);
  const [ownershipId, setOwnershipId] = useState(String(ownershipStatuses[0]?.ownership_status_id || ""));
  const [updateReleaseType, setUpdateReleaseType] = useState(false);
  const [releaseTypeId, setReleaseTypeId] = useState(String(releaseTypes[0]?.top_level_category_id || ""));

  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  const anyEnabled = updateOwnership || updateReleaseType;
  const noun = selectedIds.length === 1 ? "release" : "releases";

  async function handleSave() {
    if (!anyEnabled) { setError("Select at least one field to update."); return; }
    const fields = {};
    if (updateOwnership) fields.ownership_status_id = Number(ownershipId);
    if (updateReleaseType) fields.top_level_category_id = Number(releaseTypeId);
    setSaving(true); setError("");
    try { await bulkUpdateMusic(selectedIds, fields); onSaved(); }
    catch (err) { setError(err.message || "Failed to update"); }
    finally { setSaving(false); }
  }

  async function handleDelete() {
    setDeleting(true);
    try { await bulkDeleteMusic(selectedIds); onDeleted(); }
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
        <BulkField label="Release Type" enabled={updateReleaseType} onToggle={() => setUpdateReleaseType((p) => !p)}>
          <Select value={releaseTypeId} onChange={(e) => setReleaseTypeId(e.target.value)}>
            {releaseTypes.map((r) => <option key={r.top_level_category_id} value={r.top_level_category_id}>{r.category_name}</option>)}
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
    releaseType: emptySection(),
    format: emptySection(),
    genre: emptySection(),
    artist: emptySection(),
  };
}

export default function MusicLibraryPage() {
  const [releases, setReleases] = useState([]);
  const [ownershipStatuses, setOwnershipStatuses] = useState([]);
  const [releaseTypes, setReleaseTypes] = useState([]);
  const [formatTypes, setFormatTypes] = useState([]);
  const [allGenres, setAllGenres] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState(emptyFilters);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);

  const [viewMode, setViewMode] = useState("table");
  const [showThumbnails, setShowThumbnails] = useState(false);
  const [gridSize, setGridSize] = useState("m");
  const [mobileCardsPerRow, setMobileCardsPerRow] = useMobileCardsPerRow("music.mobileCardsPerRow");
  const isMobile = useMediaQuery(MOBILE_BREAKPOINT);
  const sentinelRef = useRef(null);
  const [showCaptions, setShowCaptions] = useState(true);

  const [sortField, setSortField] = useState("title");
  const [sortDir, setSortDir] = useState("asc");

  const [colWidths, setColWidths] = useState({
    title: 220, artist: 160, type: 100, date: 70, editions: 150, genre: 150, ownership: 110,
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

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      listMusicReleases(),
      fetchOwnershipStatuses(COLLECTION_TYPE_IDS.music),
      fetchMusicReleaseTypes(),
      fetchMusicFormatTypes(),
      fetchMusicGenres(),
    ]).then(([data, own, types, fmts, genres]) => {
      setReleases(data);
      setOwnershipStatuses(own);
      setReleaseTypes(types);
      setFormatTypes(fmts);
      setAllGenres(genres);
      setLoading(false);
    });
  }, []);

  useEffect(() => { load(); }, [load]);

  function handleSectionChange(key, val) {
    setFilters(f => ({ ...f, [key]: val }));
  }

  function handleClearAll() {
    setFilters(emptyFilters());
  }

  const filtered = useMemo(() => {
    return releases.filter(r => {
      const search = filters.search.trim().toLowerCase();
      if (search && !r.title.toLowerCase().includes(search)
          && !(r.artists || []).some(a => a.toLowerCase().includes(search))) return false;

      if (sectionActive(filters.ownership)) {
        if (!applySection(filters.ownership, [r.ownership_status_id])) return false;
      }
      if (sectionActive(filters.releaseType)) {
        if (!applySection(filters.releaseType, [r.top_level_category_id])) return false;
      }
      if (sectionActive(filters.format)) {
        if (!applySection(filters.format, r.formats || [])) return false;
      }
      if (sectionActive(filters.genre)) {
        if (!applySection(filters.genre, r.genres || [])) return false;
      }
      if (sectionActive(filters.artist)) {
        if (!applySection(filters.artist, r.artists || [])) return false;
      }
      return true;
    });
  }, [releases, filters]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    const flip = sortDir === "desc" ? -1 : 1;
    switch (sortField) {
      case "artist":
        return arr.sort((a, b) =>
          flip * ((a.artists?.[0] || "").localeCompare(b.artists?.[0] || ""))
        );
      case "type":
        return arr.sort((a, b) =>
          flip * ((a.release_type || "").localeCompare(b.release_type || ""))
        );
      case "date":
        return arr.sort((a, b) =>
          flip * ((a.release_date || "").localeCompare(b.release_date || ""))
        );
      case "ownership":
        return arr.sort((a, b) =>
          flip * ((a.ownership_status || "").localeCompare(b.ownership_status || ""))
        );
      default:
        return arr.sort((a, b) =>
          flip * ((a.title_sort || a.title || "").localeCompare(b.title_sort || b.title || ""))
        );
    }
  }, [filtered, sortField, sortDir]);

  function toggleSelect(id) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function clearSelection() { setSelectedIds(new Set()); }
  function selectAll() { setSelectedIds(new Set(sorted.map(r => r.item_id))); }

  const allVisibleSelected = sorted.length > 0 && sorted.every(r => selectedIds.has(r.item_id));

  const mobileVisible = useMobileInfiniteScroll({
    enabled: isMobile && viewMode === "grid",
    totalCount: sorted.length,
    sentinelRef,
    resetKey: sorted,
  });

  const selectedReleases = useMemo(
    () => sorted.filter(r => selectedIds.has(r.item_id)),
    [sorted, selectedIds]
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden", fontSize: "var(--text-base)" }}>
      {/* Controls bar */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "var(--space-3) var(--space-6)", borderBottom: "1px solid var(--border)", background: "var(--bg-sidebar)", flexShrink: 0, gap: "var(--space-4)", flexWrap: "wrap" }}>
        <Row gap={5}>
          <span style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>
            {loading ? "Loading…" : `${sorted.length} release${sorted.length !== 1 ? "s" : ""}`}
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

      {/* Main layout */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        <div className="library-sidebar-wrap" style={{ width: 220, flexShrink: 0, borderRight: "1px solid var(--border)", overflowY: "auto" }}>
          <MusicFilters
            items={releases}
            ownershipStatuses={ownershipStatuses}
            releaseTypes={releaseTypes}
            filters={filters}
            onSectionChange={handleSectionChange}
            onClearAll={handleClearAll}
          />
        </div>

        <div style={{ flex: 1, overflowY: "auto", overflowX: "auto", padding: 0 }}>
          {loading ? (
            <p style={{ padding: "var(--space-8)", fontSize: "var(--text-base)" }}>Loading…</p>
          ) : sorted.length === 0 ? (
            <p style={{ padding: "var(--space-8)", fontSize: "var(--text-base)", color: "var(--text-secondary)" }}>No releases found.</p>
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
                  "--cell-aspect-ratio": "1 / 1",
                }}
              >
                {(isMobile ? sorted.slice(0, mobileVisible) : sorted).map(r => (
                  <MusicGridItem key={r.item_id} release={r}
                    isSelected={selectedIds.has(r.item_id)}
                    onToggleSelect={toggleSelect}
                    onClick={() => setEditingId(r.item_id)}
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
                <col style={{ width: colWidths.artist }} />
                <col style={{ width: colWidths.type }} />
                <col style={{ width: colWidths.date }} />
                <col style={{ width: colWidths.editions }} />
                <col style={{ width: colWidths.genre }} />
                <col style={{ width: colWidths.ownership }} />
              </colgroup>
              <thead style={{ position: "sticky", top: 0, zIndex: 2 }}>
                <tr style={{ background: "var(--bg-sidebar)", borderBottom: "1px solid var(--border)" }}>
                  <th style={{ padding: "5px 6px", textAlign: "center", borderRight: "1px solid var(--border)" }}>
                    <input type="checkbox" checked={allVisibleSelected}
                      onChange={() => allVisibleSelected ? clearSelection() : selectAll()}
                      style={{ margin: 0, cursor: "pointer" }} />
                  </th>
                  {showThumbnails && <th style={{ padding: "5px 6px", borderRight: "1px solid var(--border)" }} />}
                  {[
                    { key: "title", label: "Title", colKey: "title" },
                    { key: "artist", label: "Artist(s)", colKey: "artist" },
                    { key: "type", label: "Type", colKey: "type" },
                    { key: "date", label: "Date", colKey: "date" },
                    { key: null, label: "Editions", colKey: "editions" },
                    { key: null, label: "Genre(s)", colKey: "genre" },
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
                {sorted.map(r => {
                  const isSelected = selectedIds.has(r.item_id);
                  return (
                    <tr
                      key={r.item_id}
                      onClick={() => setEditingId(r.item_id)}
                      style={{ cursor: "pointer", borderBottom: "1px solid var(--border)", background: isSelected ? "var(--green-light)" : undefined }}
                      onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = "var(--bg-surface)"; }}
                      onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = ""; }}
                    >
                      <td style={{ padding: "3px 6px", verticalAlign: "middle", width: 28 }}
                        onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(r.item_id)} style={{ margin: 0, cursor: "pointer" }} />
                      </td>
                      {showThumbnails && (
                        <td style={{ padding: "3px 6px", verticalAlign: "middle", width: 50 }}>
                          {r.cover_image_url
                            ? <img src={getImageUrl(r.cover_image_url)} alt="" style={{ width: 42, height: 42, objectFit: "cover", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)", display: "block" }} />
                            : <div style={{ width: 42, height: 42, background: "var(--bg-surface)", borderRadius: "var(--radius-sm)" }} />}
                        </td>
                      )}
                      <td style={{ padding: "3px 8px", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis", fontWeight: 500 }}>{r.title}</td>
                      <td style={{ padding: "3px 8px", fontSize: "var(--text-sm)", color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{(r.artists || []).join(", ")}</td>
                      <td style={{ padding: "3px 8px", fontSize: "var(--text-sm)", color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.release_type}</td>
                      <td style={{ padding: "3px 8px", fontSize: "var(--text-sm)", color: "var(--text-secondary)", whiteSpace: "nowrap" }}>{r.release_date?.slice(0, 4) || ""}</td>
                      <td style={{ padding: "3px 8px", fontSize: "var(--text-sm)", color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.editions_summary || ""}</td>
                      <td style={{ padding: "3px 8px", fontSize: "var(--text-sm)", color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{(r.genres || []).join(", ")}</td>
                      <td style={{ padding: "3px 8px", fontSize: "var(--text-sm)", color: "var(--text-secondary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.ownership_status}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {editingId && (
        <MusicDetailModal
          itemId={editingId}
          ownershipStatuses={ownershipStatuses}
          releaseTypes={releaseTypes}
          formatTypes={formatTypes}
          allGenres={allGenres}
          onClose={() => setEditingId(null)}
          onSaved={() => { setEditingId(null); load(); }}
          onDeleted={id => {
            setEditingId(null);
            setReleases(prev => prev.filter(r => r.item_id !== id));
            setSelectedIds(prev => { const next = new Set(prev); next.delete(id); return next; });
          }}
        />
      )}

      {bulkEditOpen && (
        <MusicBulkEdit
          selectedIds={selectedReleases.map(r => r.item_id)}
          ownershipStatuses={ownershipStatuses}
          releaseTypes={releaseTypes}
          onClose={() => setBulkEditOpen(false)}
          onSaved={async () => { setBulkEditOpen(false); clearSelection(); load(); }}
          onDeleted={async () => { setBulkEditOpen(false); clearSelection(); load(); }}
        />
      )}
    </div>
  );
}
