import { useEffect, useRef, useState } from "react";
import {
  createMusicRelease,
  discogsFetchMaster,
  discogsSearchMusic,
  fetchMusicFormatTypes,
  fetchMusicGenres,
  fetchMusicReleaseTypes,
  fetchOwnershipStatuses,
  uploadCover,
} from "../api";
import PageContainer from "../components/layout/PageContainer";
import NameList from "../components/shared/NameList";
import { COLLECTION_TYPE_IDS } from "../constants/collectionTypes";
import {
  Alert,
  Badge,
  Button,
  Card,
  CoverThumb,
  FormField,
  Grid,
  Input,
  RemoveButton,
  Row,
  Select,
  Stack,
  Textarea,
} from "../components/primitives";

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
        <Select value={topSel} onChange={e => handleTopChange(e.target.value)} style={{ width: "auto", minWidth: 140 }}>
          <option value="">Genre…</option>
          {allGenres.map(g => <option key={g.top_genre_id} value={g.top_genre_id}>{g.genre_name}</option>)}
        </Select>
        {subGenres.length > 0 && (
          <>
            <Select value={subSel} onChange={e => setSubSel(e.target.value)} style={{ width: "auto", minWidth: 140 }}>
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

// ─── Track list editor ────────────────────────────────────────────────────────

function blankSong() { return { title: "", duration_seconds: "", track_number: "", disc_number: 1 }; }

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
  function add() { onChange([...songs, { ...blankSong(), track_number: songs.length + 1 }]); }
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
            value={s.track_number}
            onChange={e => update(i, "track_number", e.target.value)}
            style={{ textAlign: "center", padding: "2px 3px" }}
            placeholder="#"
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
            value={s.disc_number}
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

// ─── Editions editor ──────────────────────────────────────────────────────────

function blankEdition() {
  return { format_type_id: "", version_name: "", label: "", catalog_number: "", barcode: "", notes: "", ownership_status_id: "" };
}

function EditionsEditor({ editions, formatTypes, ownershipStatuses, onChange }) {
  function update(idx, key, val) {
    const next = [...editions];
    next[idx] = { ...next[idx], [key]: val };
    onChange(next);
  }
  function add() { onChange([...editions, blankEdition()]); }
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
                <Select value={e.format_type_id} onChange={ev => update(i, "format_type_id", ev.target.value)}>
                  <option value="">None</option>
                  {formatTypes.map(f => <option key={f.format_type_id} value={f.format_type_id}>{f.format_name}</option>)}
                </Select>
              </FormField>
              <FormField label="Version Name">
                <Input value={e.version_name} onChange={ev => update(i, "version_name", ev.target.value)} placeholder="e.g. Limited Edition" />
              </FormField>
            </Grid>
            <Grid cols={2} gap={4}>
              <FormField label="Label">
                <Input value={e.label} onChange={ev => update(i, "label", ev.target.value)} placeholder="Record label" />
              </FormField>
              <FormField label="Catalog #">
                <Input value={e.catalog_number} onChange={ev => update(i, "catalog_number", ev.target.value)} placeholder="e.g. SKZ-9988" />
              </FormField>
            </Grid>
            <Grid cols={2} gap={4}>
              <FormField label="Barcode">
                <Input value={e.barcode} onChange={ev => update(i, "barcode", ev.target.value)} placeholder="UPC / EAN" />
              </FormField>
              <FormField label="Ownership">
                <Select value={e.ownership_status_id} onChange={ev => update(i, "ownership_status_id", ev.target.value)}>
                  <option value="">None</option>
                  {ownershipStatuses.map(s => <option key={s.ownership_status_id} value={s.ownership_status_id}>{s.status_name}</option>)}
                </Select>
              </FormField>
            </Grid>
            <FormField label="Notes">
              <Input value={e.notes} onChange={ev => update(i, "notes", ev.target.value)} placeholder="Edition notes" />
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

// ─── Blank form ───────────────────────────────────────────────────────────────

function blankForm(ownershipStatuses, releaseTypes) {
  const owned = ownershipStatuses.find(s => s.status_code === "owned");
  const album = releaseTypes.find(r => r.category_name === "Album");
  return {
    title: "",
    releaseTypeId: album ? String(album.top_level_category_id) : "",
    ownershipStatusId: owned ? String(owned.ownership_status_id) : "",
    releaseDate: "",
    description: "",
    coverImageUrl: "",
    notes: "",
    artists: [""],
    genres: [],
    songs: [],
    editions: [],
  };
}

// ─── Section block (replaces commonStyles.sectionStyle) ───────────────────────

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

// ─── Main component ───────────────────────────────────────────────────────────

export default function MusicIngestPage() {
  const [ownershipStatuses, setOwnershipStatuses] = useState([]);
  const [releaseTypes, setReleaseTypes] = useState([]);
  const [formatTypes, setFormatTypes] = useState([]);
  const [allGenres, setAllGenres] = useState([]);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [coverPreview, setCoverPreview] = useState(null);
  const coverFileRef = useRef(null);

  async function handleCoverFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const { url } = await uploadCover(file, "music");
      set("coverImageUrl", url);
      setCoverPreview(url);
    } catch (err) {
      setError(err.message || "Cover upload failed.");
    }
    if (coverFileRef.current) coverFileRef.current.value = "";
  }

  const [discogsQuery, setDiscogsQuery] = useState("");
  const [discogsResults, setDiscogsResults] = useState([]);
  const [discogsSearching, setDiscogsSearching] = useState(false);
  const [discogsLoading, setDiscogsLoading] = useState(false);
  const [discogsError, setDiscogsError] = useState("");

  useEffect(() => {
    Promise.all([
      fetchOwnershipStatuses(COLLECTION_TYPE_IDS.music),
      fetchMusicReleaseTypes(),
      fetchMusicFormatTypes(),
      fetchMusicGenres(),
    ]).then(([own, types, fmts, genres]) => {
      setOwnershipStatuses(own);
      setReleaseTypes(types);
      setFormatTypes(fmts);
      setAllGenres(genres);
      setForm(blankForm(own, types));
    }).catch(err => {
      setError(err.message || "Failed to load page data. Has the music migration been run?");
      setForm({});
    });
  }, []);

  function set(key, val) { setForm(f => ({ ...f, [key]: val })); }

  async function handleDiscogsSearch() {
    if (!discogsQuery.trim()) return;
    setDiscogsSearching(true);
    setDiscogsError("");
    setDiscogsResults([]);
    try {
      const results = await discogsSearchMusic(discogsQuery);
      setDiscogsResults(results);
      if (results.length === 0) setDiscogsError("No results found.");
    } catch (err) {
      setDiscogsError(err.message || "Search failed.");
    } finally {
      setDiscogsSearching(false);
    }
  }

  async function handleDiscogsSelect(result) {
    setDiscogsLoading(true);
    setDiscogsError("");
    try {
      const detail = await discogsFetchMaster(result.discogs_id);
      const newCover = detail.cover_image_url || null;
      setForm(f => ({
        ...f,
        title: detail.title || f.title,
        releaseDate: detail.year ? String(detail.year) : f.releaseDate,
        coverImageUrl: newCover || f.coverImageUrl,
        artists: detail.artists.length > 0 ? detail.artists : f.artists,
        songs: detail.tracklist.map((t, i) => ({
          title: t.title,
          duration_seconds: t.duration_seconds,
          _durStr: t.duration_seconds ? formatDuration(t.duration_seconds) : "",
          track_number: t.track_number || (i + 1),
          disc_number: t.disc_number || 1,
        })),
      }));
      setCoverPreview(newCover);
      setDiscogsResults([]);
      setDiscogsQuery("");
    } catch (err) {
      setDiscogsError(err.message || "Failed to load release details.");
    } finally {
      setDiscogsLoading(false);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(""); setSuccess("");
    if (!form.title.trim()) { setError("Title is required."); return; }
    if (!form.releaseTypeId) { setError("Release type is required."); return; }
    if (!form.ownershipStatusId) { setError("Ownership status is required."); return; }

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
          .filter(s => s.title.trim())
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
      await createMusicRelease(payload);
      const typeLabel = releaseTypes.find(r => String(r.top_level_category_id) === form.releaseTypeId)?.category_name || "Release";
      setSuccess(`${typeLabel} "${form.title}" saved.`);
      setForm(blankForm(ownershipStatuses, releaseTypes));
      setCoverPreview(null);
      document.querySelector(".app-main")?.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      setError(err.message || "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  function handleReset() {
    setForm(blankForm(ownershipStatuses, releaseTypes));
    setError(""); setSuccess(""); setCoverPreview(null);
  }

  if (!form) return <PageContainer><p style={{ padding: "var(--space-8)", fontSize: "var(--text-base)" }}>Loading…</p></PageContainer>;
  if (error && !form.title && form.title !== "") return <PageContainer><div style={{ margin: "var(--space-8)" }}><Alert tone="error">{error}</Alert></div></PageContainer>;

  return (
    <PageContainer>
      <div style={{ maxWidth: 680, padding: "var(--space-7) 0", margin: "0 auto" }}>
        <h2 style={{ fontSize: "var(--text-lg)", fontWeight: 700, marginBottom: "var(--space-7)", color: "var(--text-primary)" }}>
          Add Music Release
        </h2>

        <Stack gap={5}>
          {error && <Alert tone="error">{error}</Alert>}
          {success && <Alert tone="success">{success}</Alert>}

          {/* Discogs Search */}
          <SectionBlock title="Search Discogs">
            <Row gap={3}>
              <Input
                value={discogsQuery}
                onChange={e => setDiscogsQuery(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleDiscogsSearch()}
                placeholder="Artist, title, or both…"
                style={{ flex: 1 }}
              />
              <Button type="button" variant="primary" onClick={handleDiscogsSearch} disabled={discogsSearching || discogsLoading}>
                {discogsSearching ? "Searching…" : "Search"}
              </Button>
            </Row>
            {discogsLoading && <div style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>Loading release…</div>}
            {discogsError && <div style={{ fontSize: "var(--text-sm)", color: "var(--error-text)" }}>{discogsError}</div>}
            {discogsResults.length > 0 && (
              <div style={{ maxHeight: 260, overflowY: "auto", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)" }}>
                {discogsResults.map(r => (
                  <div
                    key={r.discogs_id}
                    onClick={() => handleDiscogsSelect(r)}
                    style={{
                      display: "flex", gap: "var(--space-4)",
                      padding: "var(--space-3) var(--space-4)",
                      borderBottom: "1px solid var(--border)",
                      cursor: "pointer", alignItems: "center",
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = "var(--bg-surface)"; }}
                    onMouseLeave={e => { e.currentTarget.style.background = ""; }}
                  >
                    {r.thumb_url
                      ? <img src={r.thumb_url} alt="" style={{ width: 38, height: 38, objectFit: "cover", borderRadius: "var(--radius-sm)", flexShrink: 0 }} />
                      : <div style={{ width: 38, height: 38, background: "var(--bg-surface)", borderRadius: "var(--radius-sm)", flexShrink: 0 }} />
                    }
                    <div>
                      <div style={{ fontSize: "var(--text-base)", fontWeight: 600 }}>{r.title}</div>
                      <div style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>
                        {r.artists?.join(", ")}{r.year ? ` · ${r.year}` : ""}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SectionBlock>

          <form onSubmit={handleSubmit}>
            <Stack gap={5}>
              <FormField label="Title" required>
                <Input value={form.title} onChange={e => set("title", e.target.value)} placeholder="e.g. MIROH" autoFocus />
              </FormField>

              <Grid cols={2} gap={5}>
                <FormField label="Release Type" required>
                  <Select value={form.releaseTypeId} onChange={e => set("releaseTypeId", e.target.value)}>
                    <option value="">Select…</option>
                    {releaseTypes.map(r => <option key={r.top_level_category_id} value={r.top_level_category_id}>{r.category_name}</option>)}
                  </Select>
                </FormField>
                <FormField label="Ownership" required>
                  <Select value={form.ownershipStatusId} onChange={e => set("ownershipStatusId", e.target.value)}>
                    <option value="">Select…</option>
                    {ownershipStatuses.map(s => <option key={s.ownership_status_id} value={s.ownership_status_id}>{s.status_name}</option>)}
                  </Select>
                </FormField>
              </Grid>

              <FormField label="Release Date">
                <Input value={form.releaseDate} onChange={e => set("releaseDate", e.target.value)} placeholder="YYYY-MM-DD" style={{ maxWidth: 200 }} />
              </FormField>

              <FormField label="Artist(s)">
                <NameList names={form.artists} onChange={v => set("artists", v)} addLabel="+ Artist" placeholder="Artist name" />
              </FormField>

              <FormField label="Genre">
                <GenrePicker allGenres={allGenres} selected={form.genres} onChange={v => set("genres", v)} />
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
                  {coverPreview && <CoverThumb src={coverPreview} alt="cover preview" size="sm" />}
                </Row>
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

              <Row gap={4}>
                <Button type="submit" variant="primary" disabled={saving}>
                  {saving ? "Saving…" : "Save Release"}
                </Button>
                <Button type="button" variant="secondary" onClick={handleReset}>Clear</Button>
              </Row>
            </Stack>
          </form>
        </Stack>
      </div>
    </PageContainer>
  );
}
