import { useEffect, useRef, useState } from "react";
import {
  createVideo,
  fetchOwnershipStatuses,
  fetchVideoCategories,
  fetchVideoFormatTypes,
  fetchVideoGenres,
  fetchConsumptionStatuses,
  tmdbDetail,
  tmdbSearch,
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
  Checkbox,
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

const TV_CATEGORY = "TV Series";

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
            <option value="">— Subgenre (optional) —</option>
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

// ─── Copies editor (Movie / Miniseries / Concert) ─────────────────────────────

function CopiesEditor({ copies, onChange, formatTypes, ownershipStatuses }) {
  function addCopy() {
    onChange([...copies, { format_type_id: null, ownership_status_id: null, notes: "" }]);
  }
  function updateCopy(idx, field, val) {
    onChange(copies.map((c, i) => i === idx ? { ...c, [field]: val } : c));
  }
  function removeCopy(idx) {
    onChange(copies.filter((_, i) => i !== idx));
  }

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

// ─── Seasons editor (TV Series) ───────────────────────────────────────────────

function SeasonsEditor({ seasons, onChange, formatTypes, ownershipStatuses }) {
  function addSeason() {
    const nextNum = seasons.length > 0 ? Math.max(...seasons.map(s => s.season_number)) + 1 : 1;
    onChange([...seasons, { season_number: nextNum, episode_count: null, notes: "", copies: [] }]);
  }
  function updateSeason(idx, field, val) {
    onChange(seasons.map((s, i) => i === idx ? { ...s, [field]: val } : s));
  }
  function removeSeason(idx) {
    onChange(seasons.filter((_, i) => i !== idx));
  }

  return (
    <Stack gap={3}>
      {seasons.map((s, i) => (
        <div key={i} style={{ border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "var(--space-3)", background: "var(--bg-base)" }}>
          <div style={{ display: "grid", gridTemplateColumns: "80px 100px auto", gap: "var(--space-3)", alignItems: "end", marginBottom: "var(--space-3)" }}>
            <FormField label="Season #">
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

// ─── TMDB search panel ────────────────────────────────────────────────────────

function TmdbSearchPanel({ videoTypeName, onSelect }) {
  const defaultMediaType = videoTypeName === "TV Series" ? "tv" : "movie";
  const [query, setQuery] = useState("");
  const [year, setYear] = useState("");
  const [mediaType, setMediaType] = useState(defaultMediaType);
  const [results, setResults] = useState([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [totalResults, setTotalResults] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => { setMediaType(defaultMediaType); }, [defaultMediaType]);

  async function doSearch(requestedPage = 1) {
    if (!query.trim()) return;
    setLoading(true);
    setError("");
    if (requestedPage === 1) setResults([]);
    try {
      const data = await tmdbSearch(query, mediaType, { year, page: requestedPage });
      setResults(data.results || []);
      setPage(data.page || requestedPage);
      setTotalPages(data.total_pages || 0);
      setTotalResults(data.total_results || 0);
    } catch (e) {
      setError(e.message || "TMDB search failed");
    } finally {
      setLoading(false);
    }
  }

  async function pickResult(r) {
    setLoadingDetail(r.tmdb_id);
    setError("");
    try {
      const detail = await tmdbDetail(r.tmdb_id, mediaType);
      onSelect(detail);
      setResults([]);
      setQuery("");
      setYear("");
      setPage(1);
      setTotalPages(0);
      setTotalResults(0);
    } catch (e) {
      setError(e.message || "Failed to fetch TMDB detail");
    } finally {
      setLoadingDetail(null);
    }
  }

  return (
    <SectionBlock title="Search TMDB">
      <Row gap={3}>
        <Select value={mediaType} onChange={e => setMediaType(e.target.value)} style={{ width: 100 }}>
          <option value="movie">Movie</option>
          <option value="tv">TV</option>
        </Select>
        <Input
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === "Enter" && doSearch(1)}
          placeholder={`Search TMDB for ${mediaType === "tv" ? "TV shows" : "movies"}…`}
          style={{ flex: 1 }}
        />
        <Input
          type="number"
          value={year}
          onChange={e => setYear(e.target.value)}
          onKeyDown={e => e.key === "Enter" && doSearch(1)}
          placeholder="Year"
          min={1800}
          max={new Date().getFullYear() + 5}
          style={{ width: 90 }}
        />
        <Button type="button" variant="primary" onClick={() => doSearch(1)} disabled={loading}>
          {loading ? "Searching…" : "Search"}
        </Button>
      </Row>
      {error && <Alert tone="error">{error}</Alert>}
      {results.length > 0 && (
        <Stack gap={2}>
          <div style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>
            Showing {results.length} of {totalResults} result{totalResults === 1 ? "" : "s"}
            {totalPages > 1 && ` (page ${page} of ${totalPages})`}
          </div>
          {results.map(r => (
            <div
              key={r.tmdb_id}
              style={{
                display: "flex", gap: "var(--space-4)",
                padding: "var(--space-3) var(--space-4)",
                background: "var(--bg-base)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-sm)",
                cursor: "pointer", alignItems: "center",
              }}
              onClick={() => pickResult(r)}
            >
              {r.cover_image_url && (
                <img src={r.cover_image_url} alt="" style={{ width: 32, height: 48, objectFit: "cover", borderRadius: "var(--radius-sm)", flexShrink: 0 }} />
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: "var(--text-base)", fontWeight: 700 }}>{r.title}{r.year ? ` (${r.year})` : ""}</div>
                {r.overview && <div style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.overview}</div>}
              </div>
              {loadingDetail === r.tmdb_id
                ? <span style={{ fontSize: "var(--text-xs)" }}>Loading…</span>
                : <span style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>Select</span>
              }
            </div>
          ))}
          {totalPages > 1 && (
            <Row gap={2} style={{ justifyContent: "center", marginTop: "var(--space-2)" }}>
              <Button type="button" variant="secondary" size="sm" disabled={loading || page <= 1} onClick={() => doSearch(page - 1)}>
                ← Prev
              </Button>
              <span style={{ fontSize: "var(--text-xs)", alignSelf: "center" }}>Page {page} / {totalPages}</span>
              <Button type="button" variant="secondary" size="sm" disabled={loading || page >= totalPages} onClick={() => doSearch(page + 1)}>
                Next →
              </Button>
            </Row>
          )}
        </Stack>
      )}
    </SectionBlock>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

const BLANK = {
  title: "",
  top_level_category_id: "",
  ownership_status_id: "",
  reading_status_id: "",
  release_date: "",
  runtime_minutes: "",
  description: "",
  cover_image_url: "",
  notes: "",
  on_media_server: false,
  director_names: [""],
  cast_names: [""],
  genres: [],
  copies: [],
  seasons: [],
};

export default function VideoIngestPage() {
  const [form, setForm] = useState(BLANK);
  const [categories, setCategories] = useState([]);
  const [formatTypes, setFormatTypes] = useState([]);
  const [allGenres, setAllGenres] = useState([]);
  const [ownershipStatuses, setOwnershipStatuses] = useState([]);
  const [watchStatuses, setWatchStatuses] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const coverFileRef = useRef(null);

  async function handleCoverFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const { url } = await uploadCover(file, "video");
      set("cover_image_url", url);
    } catch (err) {
      setError(err.message || "Cover upload failed.");
    }
    if (coverFileRef.current) coverFileRef.current.value = "";
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
      if (cats.length > 0) setForm(f => ({ ...f, top_level_category_id: String(cats[0].top_level_category_id) }));
    }).catch(e => setError(e.message || "Failed to load lookup data. Is the backend running?"));
  }, []);

  const selectedCategory = categories.find(c => String(c.top_level_category_id) === String(form.top_level_category_id));
  const isTV = selectedCategory?.category_name === TV_CATEGORY;

  function set(field, val) { setForm(f => ({ ...f, [field]: val })); }

  function handleTmdbSelect(detail) {
    const isTvDetail = detail.media_type === "tv";
    const tvCategory = categories.find(c => c.category_name === TV_CATEGORY);
    setForm(f => {
      const switchToTv = isTvDetail && tvCategory && String(tvCategory.top_level_category_id) !== String(f.top_level_category_id);
      const targetCategoryId = switchToTv ? String(tvCategory.top_level_category_id) : f.top_level_category_id;
      const targetIsTv = isTvDetail || (categories.find(c => String(c.top_level_category_id) === String(targetCategoryId))?.category_name === TV_CATEGORY);
      return {
        ...f,
        top_level_category_id: targetCategoryId,
        copies: switchToTv ? [] : f.copies,
        title: detail.title || f.title,
        release_date: detail.release_date || f.release_date,
        runtime_minutes: detail.runtime_minutes ? String(detail.runtime_minutes) : f.runtime_minutes,
        description: detail.overview || f.description,
        cover_image_url: detail.cover_image_url || f.cover_image_url,
        director_names: detail.directors?.length ? detail.directors : f.director_names,
        cast_names: detail.cast?.length ? detail.cast : f.cast_names,
        api_source: "tmdb",
        external_work_id: String(detail.tmdb_id),
        seasons: targetIsTv && detail.seasons?.length
          ? detail.seasons.map(s => ({
              season_number: s.season_number,
              episode_count: s.episode_count || null,
              notes: "",
              copies: [],
            }))
          : f.seasons,
      };
    });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.title.trim()) { setError("Title is required."); return; }
    if (!form.top_level_category_id) { setError("Content type is required."); return; }
    if (!form.ownership_status_id) { setError("Ownership status is required."); return; }
    if (isTV && form.seasons.some(s => !Number.isFinite(s.season_number) || s.season_number < 1)) {
      setError("Every season needs a number (1 or greater).");
      return;
    }

    setSaving(true);
    setError("");
    setSuccess("");
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
        api_source: form.api_source || null,
        external_work_id: form.external_work_id || null,
        director_names: form.director_names.map(n => n.trim()).filter(Boolean),
        cast_names: form.cast_names.map(n => n.trim()).filter(Boolean),
        genres: form.genres,
        copies: isTV ? [] : form.copies,
        seasons: isTV ? form.seasons : [],
      };
      await createVideo(payload);
      setSuccess(`"${form.title}" added.`);
      setForm(f => ({ ...BLANK, top_level_category_id: f.top_level_category_id }));
      document.querySelector(".app-main")?.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      setError(e.message || "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <PageContainer title="Add Video">
      <div style={{ maxWidth: 700, margin: "0 auto" }}>
        <Stack gap={5}>
          {error && <Alert tone="error">{error}</Alert>}
          {success && <Alert tone="success">{success}</Alert>}

          {selectedCategory && (
            <TmdbSearchPanel videoTypeName={selectedCategory.category_name} onSelect={handleTmdbSelect} />
          )}

          <form onSubmit={handleSubmit}>
            <Stack gap={5}>
              <Grid cols={2} gap={5}>
                <FormField label="Content Type" required>
                  <Select
                    value={form.top_level_category_id}
                    onChange={e => {
                      setForm(f => ({ ...f, top_level_category_id: e.target.value, copies: [], seasons: [] }));
                    }}
                    required
                  >
                    <option value="">— Select type —</option>
                    {categories.map(c => <option key={c.top_level_category_id} value={c.top_level_category_id}>{c.category_name}</option>)}
                  </Select>
                </FormField>
                <FormField label="Ownership" required>
                  <Select value={form.ownership_status_id} onChange={e => set("ownership_status_id", e.target.value)} required>
                    <option value="">— Status —</option>
                    {ownershipStatuses.map(s => <option key={s.ownership_status_id} value={s.ownership_status_id}>{s.status_name}</option>)}
                  </Select>
                </FormField>
              </Grid>

              <FormField label="Title" required>
                <Input value={form.title} onChange={e => set("title", e.target.value)} placeholder="Title" required />
              </FormField>

              <Grid cols={3} gap={5}>
                <FormField label="Release Date">
                  <Input type="date" value={form.release_date} onChange={e => set("release_date", e.target.value)} />
                </FormField>
                {!isTV && (
                  <FormField label="Runtime (min)">
                    <Input type="number" value={form.runtime_minutes} onChange={e => set("runtime_minutes", e.target.value)} placeholder="e.g. 120" min={1} />
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
                  <Input value={form.cover_image_url} onChange={e => set("cover_image_url", e.target.value)} placeholder="https://..." style={{ flex: 1 }} />
                  <input type="file" accept="image/*" ref={coverFileRef} onChange={handleCoverFile} style={{ display: "none" }} />
                  <Button type="button" variant="secondary" size="sm" onClick={() => coverFileRef.current?.click()}>
                    Add Image
                  </Button>
                  {form.cover_image_url && (
                    <CoverThumb src={form.cover_image_url} alt="" size="sm" />
                  )}
                </Row>
              </FormField>

              <SectionBlock title="Director(s) / Creator(s)">
                <NameList names={form.director_names} onChange={v => set("director_names", v)} addLabel="+ Director" placeholder="Director name" />
              </SectionBlock>

              <SectionBlock title="Cast">
                <NameList names={form.cast_names} onChange={v => set("cast_names", v)} addLabel="+ Cast member" placeholder="Cast member name" />
              </SectionBlock>

              <SectionBlock title="Genres">
                <GenrePicker allGenres={allGenres} selected={form.genres} onChange={v => set("genres", v)} />
              </SectionBlock>

              {isTV ? (
                <SectionBlock title="Seasons">
                  <SeasonsEditor seasons={form.seasons} onChange={v => set("seasons", v)} formatTypes={formatTypes} ownershipStatuses={ownershipStatuses} />
                </SectionBlock>
              ) : (
                <SectionBlock title="Copies / Formats">
                  <CopiesEditor copies={form.copies} onChange={v => set("copies", v)} formatTypes={formatTypes} ownershipStatuses={ownershipStatuses} />
                </SectionBlock>
              )}

              <FormField label="Description">
                <Textarea value={form.description} onChange={e => set("description", e.target.value)} rows={3} />
              </FormField>

              <FormField label="Notes">
                <Textarea value={form.notes} onChange={e => set("notes", e.target.value)} rows={2} />
              </FormField>

              <Row>
                <Button type="submit" variant="primary" disabled={saving}>
                  {saving ? "Saving…" : "Add Video"}
                </Button>
              </Row>
            </Stack>
          </form>
        </Stack>
      </div>
    </PageContainer>
  );
}
