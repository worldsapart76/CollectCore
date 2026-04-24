import { useEffect, useRef, useState } from "react";
import {
  bggGetDetail,
  bggSearchGames,
  createBoardgame,
  fetchBoardgameCategories,
  fetchOwnershipStatuses,
  uploadCover,
} from "../api";
import PageContainer from "../components/layout/PageContainer";
import NameList from "../components/shared/NameList";
import { COLLECTION_TYPE_IDS } from "../constants/collectionTypes";
import {
  Alert,
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

// ─── Expansions editor ────────────────────────────────────────────────────────

function blankExpansion() {
  return { title: "", year_published: "", ownership_status_id: "" };
}

function ExpansionsEditor({ expansions, ownershipStatuses, onChange }) {
  function update(idx, key, val) {
    const next = [...expansions];
    next[idx] = { ...next[idx], [key]: val };
    onChange(next);
  }
  function add() { onChange([...expansions, blankExpansion()]); }
  function remove(idx) { onChange(expansions.filter((_, i) => i !== idx)); }

  return (
    <Stack gap={4}>
      {expansions.map((exp, i) => (
        <Card key={i} surface style={{ padding: "var(--space-4) var(--space-5)" }}>
          <Stack gap={3}>
            <Row justify="between">
              <span style={{ fontSize: "var(--text-xs)", fontWeight: 700, color: "var(--text-secondary)" }}>
                Expansion {i + 1}
              </span>
              <RemoveButton showLabel label="Remove" onClick={() => remove(i)} />
            </Row>
            <FormField label="Title">
              <Input value={exp.title} onChange={e => update(i, "title", e.target.value)} placeholder="Expansion name" />
            </FormField>
            <Grid cols={2} gap={4}>
              <FormField label="Year">
                <Input value={exp.year_published} onChange={e => update(i, "year_published", e.target.value)} placeholder="YYYY" />
              </FormField>
              <FormField label="Ownership">
                <Select value={exp.ownership_status_id} onChange={e => update(i, "ownership_status_id", e.target.value)}>
                  <option value="">None</option>
                  {ownershipStatuses.map(s => (
                    <option key={s.ownership_status_id} value={s.ownership_status_id}>{s.status_name}</option>
                  ))}
                </Select>
              </FormField>
            </Grid>
          </Stack>
        </Card>
      ))}
      <Button variant="secondary" size="sm" onClick={add} style={{ alignSelf: "flex-start" }}>
        + Add Expansion
      </Button>
    </Stack>
  );
}

// ─── Blank form ───────────────────────────────────────────────────────────────

function blankForm(ownershipStatuses) {
  const owned = ownershipStatuses.find(s => s.status_code === "owned");
  return {
    title: "",
    categoryId: "",
    ownershipStatusId: owned ? String(owned.ownership_status_id) : "",
    yearPublished: "",
    minPlayers: "",
    maxPlayers: "",
    designers: [""],
    publisherName: "",
    description: "",
    coverImageUrl: "",
    notes: "",
    expansions: [],
    bggId: "",
  };
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function BoardgamesIngestPage() {
  const [categories, setCategories] = useState([]);
  const [ownershipStatuses, setOwnershipStatuses] = useState([]);
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
      const { url } = await uploadCover(file, "boardgames");
      set("coverImageUrl", url);
      setCoverPreview(url);
    } catch (err) {
      setError(err.message || "Cover upload failed.");
    }
    if (coverFileRef.current) coverFileRef.current.value = "";
  }

  const [bggQuery, setBggQuery] = useState("");
  const [bggResults, setBggResults] = useState(null);
  const [bggSearching, setBggSearching] = useState(false);
  const [bggLoading, setBggLoading] = useState(false);
  const [bggError, setBggError] = useState("");

  useEffect(() => {
    Promise.all([
      fetchBoardgameCategories(),
      fetchOwnershipStatuses(COLLECTION_TYPE_IDS.boardgames),
    ]).then(([cats, own]) => {
      setCategories(cats);
      setOwnershipStatuses(own);
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
    if (!form.categoryId) { setError("Player count category is required."); return; }
    if (!form.ownershipStatusId) { setError("Ownership status is required."); return; }

    setSaving(true);
    try {
      const payload = {
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
          .filter(e => e.title.trim())
          .map(e => ({
            title: e.title.trim(),
            year_published: e.year_published ? parseInt(e.year_published, 10) : null,
            ownership_status_id: e.ownership_status_id ? parseInt(e.ownership_status_id, 10) : null,
            external_work_id: e.external_work_id || null,
          })),
      };
      await createBoardgame(payload);
      setSuccess(`"${form.title}" saved.`);
      setForm(blankForm(ownershipStatuses));
      setCoverPreview(null);
      setBggQuery(""); setBggResults(null);
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
    setBggQuery(""); setBggResults(null); setBggError("");
  }

  async function handleBggSearch(e) {
    e.preventDefault();
    if (!bggQuery.trim()) return;
    setBggSearching(true); setBggError(""); setBggResults(null);
    try {
      const results = await bggSearchGames(bggQuery.trim());
      setBggResults(results);
    } catch (err) {
      setBggError(err.message || "Search failed.");
    } finally {
      setBggSearching(false);
    }
  }

  async function applyBggResult(result) {
    setBggLoading(true); setBggError("");
    try {
      const detail = await bggGetDetail(result.bgg_id);
      setForm(f => ({
        ...f,
        title: detail.title || f.title,
        yearPublished: detail.year_published ? String(detail.year_published) : f.yearPublished,
        minPlayers: detail.min_players ? String(detail.min_players) : f.minPlayers,
        maxPlayers: detail.max_players ? String(detail.max_players) : f.maxPlayers,
        description: detail.description || f.description,
        coverImageUrl: detail.cover_image_url || f.coverImageUrl,
        designers: detail.designers?.length ? detail.designers : f.designers,
        publisherName: detail.publisher || f.publisherName,
        bggId: result.bgg_id,
        expansions: detail.expansions?.length
          ? detail.expansions.map(ex => ({ title: ex.title, year_published: "", ownership_status_id: "", external_work_id: ex.external_work_id }))
          : f.expansions,
      }));
      setCoverPreview(detail.cover_image_url || null);
      setBggResults(null);
      setBggQuery("");
    } catch (err) {
      setBggError(err.message || "Failed to load BGG details.");
    } finally {
      setBggLoading(false);
    }
  }

  if (!form) return (
    <PageContainer>
      <p style={{ padding: "var(--space-8)", fontSize: "var(--text-base)" }}>Loading…</p>
    </PageContainer>
  );

  return (
    <PageContainer>
      <div style={{ maxWidth: 680, padding: "var(--space-7) 0", margin: "0 auto" }}>
        <h2 style={{ fontSize: "var(--text-lg)", fontWeight: 700, marginBottom: "var(--space-7)", color: "var(--text-primary)" }}>
          Add Board Game
        </h2>

        <Stack gap={5}>
          {error && <Alert tone="error">{error}</Alert>}
          {success && <Alert tone="success">{success}</Alert>}

          {/* BGG Search */}
          <Card surface style={{ padding: "var(--space-5) var(--space-6)" }}>
            <Stack gap={3}>
              <div style={{ fontSize: "var(--text-sm)", fontWeight: 700, color: "var(--text-secondary)" }}>
                Search BoardGameGeek
              </div>
              <form onSubmit={handleBggSearch}>
                <Row gap={3} align="stretch">
                  <Input
                    value={bggQuery}
                    onChange={e => setBggQuery(e.target.value)}
                    placeholder="Game title…"
                    style={{ flex: 1 }}
                  />
                  <Button type="submit" variant="secondary" disabled={bggSearching || !bggQuery.trim()}>
                    {bggSearching ? "Searching…" : "Search"}
                  </Button>
                </Row>
              </form>
              {bggLoading && <div style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>Loading details…</div>}
              {bggError && <div style={{ fontSize: "var(--text-sm)", color: "var(--error-text)" }}>{bggError}</div>}
              {bggResults && bggResults.length === 0 && (
                <div style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>No results found.</div>
              )}
              {bggResults && bggResults.length > 0 && (
                <Stack gap={1}>
                  {bggResults.map(r => (
                    <button
                      key={r.bgg_id}
                      type="button"
                      onClick={() => applyBggResult(r)}
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
                      <div>
                        <div style={{ fontSize: "var(--text-base)", fontWeight: 500 }}>{r.title}</div>
                        {r.year_published && (
                          <div style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>{r.year_published}</div>
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
                <Input value={form.title} onChange={e => set("title", e.target.value)} placeholder="e.g. Pandemic" autoFocus />
              </FormField>

              <Grid cols={2} gap={5}>
                <FormField label="Player Count" required>
                  <Select value={form.categoryId} onChange={e => set("categoryId", e.target.value)}>
                    <option value="">Select…</option>
                    {categories.map(c => (
                      <option key={c.top_level_category_id} value={c.top_level_category_id}>{c.category_name}</option>
                    ))}
                  </Select>
                </FormField>
                <FormField label="Ownership" required>
                  <Select value={form.ownershipStatusId} onChange={e => set("ownershipStatusId", e.target.value)}>
                    <option value="">Select…</option>
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
                  <Input value={form.minPlayers} onChange={e => set("minPlayers", e.target.value)} placeholder="1" type="number" min="1" />
                </FormField>
                <FormField label="Max Players">
                  <Input value={form.maxPlayers} onChange={e => set("maxPlayers", e.target.value)} placeholder="4" type="number" min="1" />
                </FormField>
              </Grid>

              <FormField label="Designer(s)">
                <NameList names={form.designers} onChange={v => set("designers", v)} addLabel="+ Designer" placeholder="e.g. Matt Leacock" />
              </FormField>

              <FormField label="Publisher">
                <Input value={form.publisherName} onChange={e => set("publisherName", e.target.value)} placeholder="e.g. Z-Man Games" />
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
                  {coverPreview && (
                    <CoverThumb src={coverPreview} alt="cover preview" size="md" />
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

              <Row gap={4}>
                <Button type="submit" variant="primary" disabled={saving}>
                  {saving ? "Saving…" : "Save Game"}
                </Button>
                <Button type="button" variant="secondary" onClick={handleReset}>
                  Clear
                </Button>
              </Row>
            </Stack>
          </form>
        </Stack>
      </div>
    </PageContainer>
  );
}
