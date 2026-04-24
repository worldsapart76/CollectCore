import { useEffect, useRef, useState } from "react";
import {
  createVideoGame,
  fetchGameGenres,
  fetchGamePlatforms,
  fetchConsumptionStatuses,
  fetchOwnershipStatuses,
  rawgSearchGames,
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
        <Select value={topSel} onChange={(e) => handleTopChange(e.target.value)} style={{ width: "auto", minWidth: 140 }}>
          <option value="">Genre…</option>
          {allGenres.map(g => <option key={g.top_genre_id} value={g.top_genre_id}>{g.genre_name}</option>)}
        </Select>
        {subGenres.length > 0 && (
          <>
            <Select value={subSel} onChange={(e) => setSubSel(e.target.value)} style={{ width: "auto", minWidth: 140 }}>
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

// ─── Copies editor ────────────────────────────────────────────────────────────

function blankCopy() {
  return { platform_id: "", edition: "", ownership_status_id: "", notes: "" };
}

function CopiesEditor({ copies, allPlatforms, ownershipStatuses, onChange }) {
  function update(idx, key, val) {
    const next = [...copies];
    next[idx] = { ...next[idx], [key]: val };
    onChange(next);
  }
  function add() { onChange([...copies, blankCopy()]); }
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
                <Select value={copy.platform_id} onChange={e => update(i, "platform_id", e.target.value)}>
                  <option value="">Select platform…</option>
                  {allPlatforms.map(p => <option key={p.platform_id} value={p.platform_id}>{p.platform_name}</option>)}
                </Select>
              </FormField>
              <FormField label="Edition">
                <Input value={copy.edition} onChange={e => update(i, "edition", e.target.value)} placeholder="e.g. Collector's Edition" />
              </FormField>
            </Grid>
            <FormField label="Ownership">
              <Select value={copy.ownership_status_id} onChange={e => update(i, "ownership_status_id", e.target.value)} style={{ maxWidth: 200 }}>
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

// ─── Blank form ───────────────────────────────────────────────────────────────

function blankForm(ownershipStatuses) {
  const owned = ownershipStatuses.find(s => s.status_code === "owned");
  return {
    title: "",
    developers: [""],
    publishers: [""],
    releaseDate: "",
    description: "",
    coverImageUrl: "",
    ownershipStatusId: owned ? String(owned.ownership_status_id) : "",
    playStatusId: "",
    notes: "",
    genres: [],
    copies: [],
  };
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function VideoGamesIngestPage() {
  const [ownershipStatuses, setOwnershipStatuses] = useState([]);
  const [playStatuses, setPlayStatuses] = useState([]);
  const [allGenres, setAllGenres] = useState([]);
  const [allPlatforms, setAllPlatforms] = useState([]);
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
      const { url } = await uploadCover(file, "videogames");
      set("coverImageUrl", url);
      setCoverPreview(url);
    } catch (err) {
      setError(err.message || "Cover upload failed.");
    }
    if (coverFileRef.current) coverFileRef.current.value = "";
  }

  const [rawgQuery, setRawgQuery] = useState("");
  const [rawgResults, setRawgResults] = useState(null);
  const [rawgSearching, setRawgSearching] = useState(false);
  const [rawgError, setRawgError] = useState("");

  useEffect(() => {
    Promise.all([
      fetchOwnershipStatuses(COLLECTION_TYPE_IDS.videogames),
      fetchConsumptionStatuses(COLLECTION_TYPE_IDS.videogames),
      fetchGameGenres(),
      fetchGamePlatforms(),
    ]).then(([own, play, genres, platforms]) => {
      setOwnershipStatuses(own);
      setPlayStatuses(play);
      setAllGenres(genres);
      setAllPlatforms(platforms);
      setForm(blankForm(own));
    });
  }, []);

  function set(key, val) {
    setForm(f => ({ ...f, [key]: val }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(""); setSuccess("");
    if (!form.title.trim()) { setError("Title is required."); return; }
    if (!form.ownershipStatusId) { setError("Ownership status is required."); return; }

    setSaving(true);
    try {
      const payload = {
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
      };
      await createVideoGame(payload);
      setSuccess(`"${form.title}" saved.`);
      setForm(blankForm(ownershipStatuses));
      setCoverPreview(null);
      setRawgQuery(""); setRawgResults(null);
      document.querySelector(".app-main")?.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      setError(err.message || "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  function handleReset() {
    setForm(blankForm(ownershipStatuses));
    setError(""); setSuccess(""); setCoverPreview(null);
    setRawgQuery(""); setRawgResults(null); setRawgError("");
  }

  async function handleRawgSearch(e) {
    e.preventDefault();
    if (!rawgQuery.trim()) return;
    setRawgSearching(true); setRawgError(""); setRawgResults(null);
    try {
      const results = await rawgSearchGames(rawgQuery.trim());
      setRawgResults(results);
    } catch (err) {
      setRawgError(err.message || "Search failed.");
    } finally {
      setRawgSearching(false);
    }
  }

  function applyRawgResult(result) {
    setForm(f => ({
      ...f,
      title: result.title || f.title,
      releaseDate: result.released || f.releaseDate,
      coverImageUrl: result.cover_image_url || f.coverImageUrl,
    }));
    setCoverPreview(result.cover_image_url || null);
    setRawgResults(null);
    setRawgQuery("");
  }

  if (!form) return <PageContainer><p style={{ padding: "var(--space-8)", fontSize: "var(--text-base)" }}>Loading…</p></PageContainer>;

  return (
    <PageContainer>
      <div style={{ maxWidth: 680, padding: "var(--space-7) 0", margin: "0 auto" }}>
        <h2 style={{ fontSize: "var(--text-lg)", fontWeight: 700, marginBottom: "var(--space-7)", color: "var(--text-primary)" }}>
          Add Video Game
        </h2>

        <Stack gap={5}>
          {error && <Alert tone="error">{error}</Alert>}
          {success && <Alert tone="success">{success}</Alert>}

          <Card surface>
            <Stack gap={3}>
              <div style={{ fontSize: "var(--text-sm)", fontWeight: 700, color: "var(--text-secondary)" }}>
                Search RAWG
              </div>
              <form onSubmit={handleRawgSearch}>
                <Row gap={3}>
                  <Input
                    value={rawgQuery}
                    onChange={e => setRawgQuery(e.target.value)}
                    placeholder="Game title…"
                    style={{ flex: 1 }}
                  />
                  <Button type="submit" variant="secondary" disabled={rawgSearching || !rawgQuery.trim()}>
                    {rawgSearching ? "Searching…" : "Search"}
                  </Button>
                </Row>
              </form>
              {rawgError && <div style={{ fontSize: "var(--text-sm)", color: "var(--error-text)" }}>{rawgError}</div>}
              {rawgResults && rawgResults.length === 0 && (
                <div style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>No results found.</div>
              )}
              {rawgResults && rawgResults.length > 0 && (
                <Stack gap={1}>
                  {rawgResults.map(r => (
                    <button
                      key={r.rawg_id}
                      type="button"
                      onClick={() => applyRawgResult(r)}
                      style={{
                        display: "flex", gap: "var(--space-4)", alignItems: "center",
                        background: "none",
                        border: "1px solid var(--border-input)",
                        borderRadius: "var(--radius-sm)",
                        padding: "var(--space-2) var(--space-4)",
                        cursor: "pointer",
                        textAlign: "left",
                        color: "var(--text-primary)",
                        font: "inherit",
                      }}
                    >
                      {r.cover_image_url && <img src={r.cover_image_url} alt="" style={{ width: 28, height: 40, objectFit: "cover", borderRadius: "var(--radius-sm)", flexShrink: 0 }} />}
                      <div>
                        <div style={{ fontSize: "var(--text-base)", fontWeight: 500 }}>{r.title}</div>
                        {(r.released || r.platforms?.length > 0) && (
                          <div style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>
                            {r.released}{r.released && r.platforms?.length > 0 ? " · " : ""}{r.platforms?.slice(0, 3).join(", ")}
                          </div>
                        )}
                      </div>
                    </button>
                  ))}
                </Stack>
              )}
            </Stack>
          </Card>

          <form onSubmit={handleSubmit}>
            <Stack gap={5}>
              <FormField label="Title" required>
                <Input value={form.title} onChange={e => set("title", e.target.value)} placeholder="e.g. Hollow Knight" autoFocus />
              </FormField>

              <Grid cols={2} gap={5}>
                <FormField label="Ownership" required>
                  <Select value={form.ownershipStatusId} onChange={e => set("ownershipStatusId", e.target.value)}>
                    <option value="">Select…</option>
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
                <Input value={form.releaseDate} onChange={e => set("releaseDate", e.target.value)} placeholder="YYYY-MM-DD" style={{ maxWidth: 200 }} />
              </FormField>

              <FormField label="Developer(s)">
                <NameList names={form.developers} onChange={v => set("developers", v)} addLabel="+ Developer" placeholder="e.g. Team Cherry" />
              </FormField>

              <FormField label="Publisher(s)">
                <NameList names={form.publishers} onChange={v => set("publishers", v)} addLabel="+ Publisher" placeholder="e.g. Team Cherry" />
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
                  {coverPreview && <CoverThumb src={coverPreview} alt="cover preview" size="md" />}
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

              <Row gap={4}>
                <Button type="submit" variant="primary" disabled={saving}>
                  {saving ? "Saving…" : "Save Game"}
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
