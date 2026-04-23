import { useEffect, useRef, useState } from "react";
import {
  createGraphicNovel,
  createGnPublisher,
  fetchConsumptionStatuses,
  fetchGnEras,
  fetchGnFormatTypes,
  fetchGnPublishers,
  fetchOwnershipStatuses,
  lookupGnIsbn,
  searchGnExternal,
  fetchTopLevelCategories,
  uploadCover,
} from "../api";
import PageContainer from "../components/layout/PageContainer";
import NameList from "../components/shared/NameList";
import { COLLECTION_TYPE_IDS } from "../constants/collectionTypes";
import { getImageUrl } from "../utils/imageUrl";
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

const HALF_STAR_OPTIONS = [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5];
const GN_COLLECTION_TYPE_CODE = "graphicnovels";

// ─── Tag input ────────────────────────────────────────────────────────────────

function TagInput({ tags, onChange }) {
  const [input, setInput] = useState("");
  function add() {
    const v = input.trim();
    if (!v || tags.includes(v)) { setInput(""); return; }
    onChange([...tags, v]);
    setInput("");
  }
  return (
    <Stack gap={2}>
      <Row gap={2}>
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
          placeholder="e.g. Spider-Man, X-Men, Dark Phoenix Saga"
          style={{ flex: 1 }}
        />
        <Button variant="secondary" size="sm" onClick={add}>Add</Button>
      </Row>
      {tags.length > 0 && (
        <Row gap={2} wrap>
          {tags.map((t, i) => (
            <Badge key={i} tone="tag">
              {t}
              <RemoveButton onClick={() => onChange(tags.filter((_, j) => j !== i))} style={{ marginLeft: "var(--space-1)" }} />
            </Badge>
          ))}
        </Row>
      )}
    </Stack>
  );
}

// ─── Source series list ────────────────────────────────────────────────────────

function blankSourceSeries() {
  return { sourceSeriesName: "", startIssue: "", endIssue: "" };
}

function SourceSeriesList({ entries, onChange }) {
  function update(idx, key, val) {
    const next = entries.map((e, i) => i === idx ? { ...e, [key]: val } : e);
    onChange(next);
  }
  function add() { onChange([...entries, blankSourceSeries()]); }
  function remove(idx) { onChange(entries.filter((_, i) => i !== idx)); }

  return (
    <Stack gap={3}>
      {entries.map((entry, i) => (
        <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 80px 80px auto", gap: "var(--space-3)", alignItems: "center" }}>
          <Input
            value={entry.sourceSeriesName}
            onChange={(e) => update(i, "sourceSeriesName", e.target.value)}
            placeholder="e.g. Amazing Spider-Man vol. 1"
          />
          <Input
            type="number"
            min="0"
            value={entry.startIssue}
            onChange={(e) => update(i, "startIssue", e.target.value)}
            placeholder="Start #"
          />
          <Input
            type="number"
            min="0"
            value={entry.endIssue}
            onChange={(e) => update(i, "endIssue", e.target.value)}
            placeholder="End #"
          />
          {entries.length > 1
            ? <RemoveButton onClick={() => remove(i)} />
            : <span style={{ width: 26 }} />}
        </div>
      ))}
      <Row gap={4} align="center" style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>
        <Button variant="secondary" size="sm" onClick={add} style={{ alignSelf: "flex-start" }}>
          + Series
        </Button>
        <span>Series name · Start # · End #</span>
      </Row>
    </Stack>
  );
}

// ─── Publisher / category inference ──────────────────────────────────────────

function inferCategoryId(publisherName, categories) {
  if (!publisherName) return "";
  const lower = publisherName.toLowerCase();
  if (lower.includes("marvel")) {
    const match = categories.find((c) => c.category_name.toLowerCase().includes("marvel"));
    if (match) return String(match.top_level_category_id);
  }
  if (lower.includes("dc ") || lower === "dc" || lower.includes("dc comics")) {
    const match = categories.find((c) => c.category_name.toLowerCase().includes("dc"));
    if (match) return String(match.top_level_category_id);
  }
  const other = categories.find((c) => c.category_name.toLowerCase().includes("other"));
  return other ? String(other.top_level_category_id) : "";
}

function inferPublisherId(publisherName, publishers) {
  if (!publisherName) return "";
  const apiLower = publisherName.toLowerCase();
  let match = publishers.find((p) => {
    const pLower = p.publisher_name.toLowerCase();
    return pLower === apiLower || apiLower.includes(pLower) || pLower.includes(apiLower);
  });
  if (match) return String(match.publisher_id);
  const apiWords = apiLower.split(/\W+/).filter((w) => w.length >= 4);
  match = publishers.find((p) => {
    const pLower = p.publisher_name.toLowerCase();
    return apiWords.some((w) => pLower.includes(w));
  });
  return match ? String(match.publisher_id) : "";
}

// ─── Source series parser ──────────────────────────────────────────────────────

function _parseSingleSeriesEntry(entry) {
  const trimmed = entry.trim();
  if (!trimmed) return [];
  const hashIdx = trimmed.lastIndexOf("#");
  if (hashIdx === -1) return [{ sourceSeriesName: trimmed, startIssue: "", endIssue: "" }];
  const seriesName = trimmed.slice(0, hashIdx).replace(/,\s*$/, "").trim();
  const issueStr = trimmed.slice(hashIdx + 1).trim();
  const groups = issueStr.split(",").map((s) => s.trim()).filter(Boolean);
  if (groups.length === 0) return [{ sourceSeriesName: seriesName, startIssue: "", endIssue: "" }];
  return groups.map((group) => {
    const nums = (group.match(/\d+/g) || []).map(Number);
    if (nums.length === 0) return { sourceSeriesName: seriesName, startIssue: "", endIssue: "" };
    if (nums.length === 1) return { sourceSeriesName: seriesName, startIssue: String(nums[0]), endIssue: "" };
    return { sourceSeriesName: seriesName, startIssue: String(nums[0]), endIssue: String(nums[nums.length - 1]) };
  });
}

function _splitMultiSeries(entry) {
  const segments = entry.split(/,\s*(?=[A-Z])/);
  const parts = [];
  let current = segments[0];
  for (let i = 1; i < segments.length; i++) {
    if (/\(\d{4}\)/.test(segments[i])) {
      parts.push(current);
      current = segments[i];
    } else {
      current += ", " + segments[i];
    }
  }
  parts.push(current);
  return parts;
}

function parseCollectingText(text) {
  if (!text) return null;
  const match = text.match(/COLLECTING:\s*(.+?)(?:\n\n|$)/is);
  if (!match) return null;
  const collectingStr = match[1].replace(/\n/g, " ").trim();
  const rawEntries = collectingStr.split(";").map((s) => s.trim()).filter(Boolean);
  const results = [];
  for (let entry of rawEntries) {
    entry = entry.replace(/^material from\s+/i, "").trim();
    for (const sub of _splitMultiSeries(entry)) {
      for (const parsed of _parseSingleSeriesEntry(sub)) {
        if (parsed.sourceSeriesName) results.push(parsed);
      }
    }
  }
  return results.length > 0 ? results : null;
}

// ─── Blank form ───────────────────────────────────────────────────────────────

function blankForm(ownershipStatuses) {
  return {
    title: "",
    writers: [""],
    artists: [""],
    tags: [],
    topLevelCategoryId: "",
    ownershipStatusId: ownershipStatuses.length ? String(ownershipStatuses[0].ownership_status_id) : "",
    readingStatusId: "",
    publisherId: "",
    formatTypeId: "",
    eraId: "",
    seriesName: "",
    seriesNumber: "",
    sourceSeries: [blankSourceSeries()],
    issueNotes: "",
    pageCount: "",
    publishedDate: "",
    isbn13: "",
    isbn10: "",
    coverImageUrl: "",
    editionNotes: "",
    description: "",
    notes: "",
    starRating: "",
    apiSource: "",
    externalWorkId: "",
  };
}

// ─── Manual entry form ────────────────────────────────────────────────────────

function ManualForm({ publishers, formatTypes, eras, ownershipStatuses, readStatuses, categories, initialValues, onCreated }) {
  const [form, setForm] = useState(() => ({ ...blankForm(ownershipStatuses), ...initialValues }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [newPublisherName, setNewPublisherName] = useState("");
  const [addingPublisher, setAddingPublisher] = useState(false);
  const [localPublishers, setLocalPublishers] = useState(publishers);
  const coverFileRef = useRef(null);

  async function handleCoverFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const { url } = await uploadCover(file, "gn");
      set("coverImageUrl", url);
    } catch (err) {
      setError(err.message || "Cover upload failed.");
    }
    if (coverFileRef.current) coverFileRef.current.value = "";
  }

  useEffect(() => { setLocalPublishers(publishers); }, [publishers]);
  useEffect(() => {
    if (initialValues && Object.keys(initialValues).length > 0) {
      setForm((prev) => ({ ...prev, ...initialValues }));
      if (initialValues._publisherName && !initialValues.publisherId) {
        setNewPublisherName(initialValues._publisherName);
      } else {
        setNewPublisherName("");
      }
    }
  }, [initialValues]);

  function set(key, val) { setForm((prev) => ({ ...prev, [key]: val })); }

  async function addPublisher() {
    if (!newPublisherName.trim()) return;
    setAddingPublisher(true);
    try {
      const p = await createGnPublisher(newPublisherName.trim());
      setLocalPublishers((prev) => [...prev, p]);
      set("publisherId", String(p.publisher_id));
      setNewPublisherName("");
    } catch (e) {
      setError(e.message);
    } finally {
      setAddingPublisher(false);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.title.trim()) { setError("Title is required."); return; }
    if (!form.topLevelCategoryId) { setError("Publisher Group is required."); return; }
    if (!form.ownershipStatusId) { setError("Ownership status is required."); return; }
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const sourceSeriesPayload = (form.sourceSeries || [])
        .filter((s) => s.sourceSeriesName.trim())
        .map((s) => ({
          source_series_name: s.sourceSeriesName.trim(),
          start_issue: s.startIssue ? parseInt(s.startIssue) : null,
          end_issue: s.endIssue ? parseInt(s.endIssue) : null,
        }));

      const result = await createGraphicNovel({
        top_level_category_id: Number(form.topLevelCategoryId),
        ownership_status_id: Number(form.ownershipStatusId),
        reading_status_id: form.readingStatusId ? Number(form.readingStatusId) : null,
        notes: form.notes || null,
        title: form.title.trim(),
        description: form.description || null,
        publisher_id: form.publisherId ? Number(form.publisherId) : null,
        format_type_id: form.formatTypeId ? Number(form.formatTypeId) : null,
        era_id: form.eraId ? Number(form.eraId) : null,
        series_name: form.seriesName || null,
        series_number: form.seriesNumber ? parseFloat(form.seriesNumber) : null,
        source_series: sourceSeriesPayload,
        issue_notes: form.issueNotes || null,
        page_count: form.pageCount ? parseInt(form.pageCount) : null,
        published_date: form.publishedDate || null,
        isbn_13: form.isbn13 || null,
        isbn_10: form.isbn10 || null,
        cover_image_url: form.coverImageUrl || null,
        edition_notes: form.editionNotes || null,
        star_rating: form.starRating ? parseFloat(form.starRating) : null,
        review: null,
        writer_names: form.writers.filter((w) => w.trim()),
        artist_names: form.artists.filter((a) => a.trim()),
        tag_names: form.tags,
        api_source: form.apiSource || null,
        external_work_id: form.externalWorkId || null,
      });
      setSuccess(`Created: "${result.graphicnovel?.title || form.title}" (ID: ${result.item_id})`);
      setForm(blankForm(ownershipStatuses));
      onCreated?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card surface>
      <form onSubmit={handleSubmit}>
        <Stack gap={5}>
          {error && <Alert tone="error">{error}</Alert>}
          {success && <Alert tone="success">{success}</Alert>}

          {form.coverImageUrl && (
            <Row gap={5} align="start">
              <img
                src={getImageUrl(form.coverImageUrl)}
                alt="cover preview"
                style={{
                  height: 150, width: "auto", maxWidth: 110, objectFit: "contain",
                  borderRadius: "var(--radius-sm)", border: "1px solid var(--border)",
                  background: "var(--bg-surface)", flexShrink: 0,
                }}
              />
              <div style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)", lineHeight: 1.5 }}>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>Cover preview</div>
                <div style={{ wordBreak: "break-all" }}>{form.coverImageUrl}</div>
                <Button variant="secondary" size="sm" onClick={() => set("coverImageUrl", "")} style={{ marginTop: "var(--space-3)", color: "var(--danger-text)" }}>
                  Remove
                </Button>
              </div>
            </Row>
          )}

          <FormField label="Title" required>
            <Input value={form.title} onChange={(e) => set("title", e.target.value)} required />
          </FormField>

          <Grid cols={2} gap={5}>
            <FormField label="Publisher Group" required>
              <Select value={form.topLevelCategoryId} onChange={(e) => set("topLevelCategoryId", e.target.value)} required>
                <option value="">-- Select --</option>
                {categories.map((c) => <option key={c.top_level_category_id} value={c.top_level_category_id}>{c.category_name}</option>)}
              </Select>
            </FormField>
            <FormField label="Ownership" required>
              <Select value={form.ownershipStatusId} onChange={(e) => set("ownershipStatusId", e.target.value)} required>
                <option value="">-- Select --</option>
                {ownershipStatuses.map((s) => <option key={s.ownership_status_id} value={s.ownership_status_id}>{s.status_name}</option>)}
              </Select>
            </FormField>
          </Grid>

          <Grid cols={2} gap={5}>
            <FormField label="Format Type">
              <Select value={form.formatTypeId} onChange={(e) => set("formatTypeId", e.target.value)}>
                <option value="">-- None --</option>
                {formatTypes.map((f) => <option key={f.format_type_id} value={f.format_type_id}>{f.format_type_name}</option>)}
              </Select>
            </FormField>
            <FormField label="Era">
              <Select value={form.eraId} onChange={(e) => set("eraId", e.target.value)}>
                <option value="">-- None --</option>
                {eras.map((e) => <option key={e.era_id} value={e.era_id}>{e.era_name}{e.era_years ? ` (${e.era_years})` : ""}</option>)}
              </Select>
            </FormField>
          </Grid>

          <Grid cols={2} gap={5}>
            <FormField label="Read Status">
              <Select value={form.readingStatusId} onChange={(e) => set("readingStatusId", e.target.value)}>
                <option value="">-- None --</option>
                {readStatuses.map((s) => <option key={s.read_status_id} value={s.read_status_id}>{s.status_name}</option>)}
              </Select>
            </FormField>
            <FormField label="Volume #">
              <Input type="number" min="0" step="0.5" value={form.seriesNumber} onChange={(e) => set("seriesNumber", e.target.value)} />
            </FormField>
          </Grid>

          <div>
            <Row gap={3} align="baseline" style={{ marginBottom: "var(--space-1)" }}>
              <label className="cc-label" style={{ marginBottom: 0 }}>Series Name</label>
              {form.title.trim() && (
                <Button variant="secondary" size="sm" onClick={() => set("seriesName", form.title.trim())} title="Copy title to series name">
                  ← Copy Title
                </Button>
              )}
            </Row>
            <Input value={form.seriesName} onChange={(e) => set("seriesName", e.target.value)} placeholder="e.g. Amazing Spider-Man Omnibus" />
          </div>

          <FormField label="Source Series (comic run collected)">
            <SourceSeriesList entries={form.sourceSeries} onChange={(v) => set("sourceSeries", v)} />
          </FormField>

          <FormField label="Issue Notes (annuals, crossovers, one-shots)">
            <Input value={form.issueNotes} onChange={(e) => set("issueNotes", e.target.value)} placeholder="e.g. + Annual #1, King-Size Special #1" />
          </FormField>

          <FormField label="Writer(s)">
            <NameList names={form.writers} onChange={(v) => set("writers", v)} addLabel="+ Writer" placeholder="Writer name" />
          </FormField>
          <FormField label="Artist(s)">
            <NameList names={form.artists} onChange={(v) => set("artists", v)} addLabel="+ Artist" placeholder="Artist name" />
          </FormField>
          <FormField label="Tags (characters, teams, story arcs)">
            <TagInput tags={form.tags} onChange={(v) => set("tags", v)} />
          </FormField>

          <FormField label="Publisher">
            <Stack gap={2}>
              <Select value={form.publisherId} onChange={(e) => set("publisherId", e.target.value)}>
                <option value="">-- None --</option>
                {localPublishers.map((p) => <option key={p.publisher_id} value={p.publisher_id}>{p.publisher_name}</option>)}
              </Select>
              <Row gap={2}>
                <Input
                  value={newPublisherName}
                  onChange={(e) => setNewPublisherName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addPublisher(); } }}
                  placeholder="New publisher name…"
                  style={{ flex: 1, fontSize: "var(--text-xs)" }}
                />
                <Button variant="secondary" size="sm" onClick={addPublisher} disabled={addingPublisher}>
                  Add
                </Button>
              </Row>
            </Stack>
          </FormField>

          <Grid cols={2} gap={5}>
            <FormField label="Published Date">
              <Input value={form.publishedDate} onChange={(e) => set("publishedDate", e.target.value)} placeholder="YYYY or YYYY-MM-DD" />
            </FormField>
            <FormField label="Page Count">
              <Input type="number" min="0" value={form.pageCount} onChange={(e) => set("pageCount", e.target.value)} />
            </FormField>
          </Grid>

          <Grid cols={2} gap={5}>
            <FormField label="ISBN-13">
              <Input value={form.isbn13} onChange={(e) => set("isbn13", e.target.value)} />
            </FormField>
            <FormField label="ISBN-10">
              <Input value={form.isbn10} onChange={(e) => set("isbn10", e.target.value)} />
            </FormField>
          </Grid>

          <FormField label="Edition Notes">
            <Input value={form.editionNotes} onChange={(e) => set("editionNotes", e.target.value)} placeholder="e.g. First Printing, 2019 Reprint" />
          </FormField>

          <Grid cols={2} gap={5}>
            <FormField label="Star Rating">
              <Select value={form.starRating} onChange={(e) => set("starRating", e.target.value)}>
                <option value="">-- None --</option>
                {HALF_STAR_OPTIONS.map((v) => <option key={v} value={v}>{v}</option>)}
              </Select>
            </FormField>
            <FormField label="Cover Image URL">
              <Row gap={3} align="start">
                <Input value={form.coverImageUrl} onChange={(e) => set("coverImageUrl", e.target.value)} style={{ flex: 1 }} />
                <input type="file" accept="image/*" ref={coverFileRef} onChange={handleCoverFile} style={{ display: "none" }} />
                <Button type="button" variant="secondary" size="sm" onClick={() => coverFileRef.current?.click()}>
                  Add Image
                </Button>
              </Row>
            </FormField>
          </Grid>

          <FormField label="Description">
            <Textarea value={form.description} onChange={(e) => set("description", e.target.value)} rows={3} />
          </FormField>

          <FormField label="Notes">
            <Textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={2} />
          </FormField>

          <Row gap={4}>
            <Button type="submit" variant="primary" disabled={saving}>
              {saving ? "Saving…" : "Add Graphic Novel"}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setForm(blankForm(ownershipStatuses))}>
              Clear
            </Button>
          </Row>
        </Stack>
      </form>
    </Card>
  );
}

// ─── Lookup tab (ISBN + title search) ────────────────────────────────────────

function IsbnLookupTab({ publishers, formatTypes, eras, ownershipStatuses, readStatuses, categories, onCreated }) {
  const [lookupType, setLookupType] = useState("title");
  const [searchSource, setSearchSource] = useState("google");
  const [isbn, setIsbn] = useState("");
  const [titleQuery, setTitleQuery] = useState("");
  const [looking, setLooking] = useState(false);
  const [lookupError, setLookupError] = useState(null);
  const [prefill, setPrefill] = useState(null);
  const [multiResults, setMultiResults] = useState(null);
  const [titleResults, setTitleResults] = useState([]);
  const [showRaw, setShowRaw] = useState(false);

  function inferFormatTypeId(title, description) {
    const hay = `${title} ${description || ""}`.toLowerCase();
    if (hay.includes("omnibus")) {
      const match = formatTypes.find((f) => f.format_type_name.toLowerCase().includes("omnibus"));
      if (match) return String(match.format_type_id);
    }
    const gn = formatTypes.find((f) => f.format_type_name.toLowerCase().includes("graphic novel"));
    return gn ? String(gn.format_type_id) : "";
  }

  function inferSeriesNumber(title) {
    const m = title.match(/\bvol(?:ume)?\.?\s*(\d+(?:\.\d+)?)/i);
    return m ? m[1] : "";
  }

  function applyResult(result, fallbackIsbn) {
    const pubName = result.publisher_name || "";
    const parsedSeries = parseCollectingText(result.description);
    const inferredFormat = inferFormatTypeId(result.title || "", result.description || "");
    const inferredVolume = inferSeriesNumber(result.title || "");
    setPrefill({
      title: result.title || "",
      writers: result.writer_names?.length ? result.writer_names : [""],
      isbn13: result.isbn_13 || fallbackIsbn || "",
      isbn10: result.isbn_10 || "",
      publishedDate: result.published_date || "",
      pageCount: result.page_count ? String(result.page_count) : "",
      description: result.description || "",
      coverImageUrl: result.cover_image_url || "",
      apiSource: result.api_source || "",
      externalWorkId: result.external_work_id || "",
      _publisherName: pubName,
      _raw: result._raw || null,
      ...(inferPublisherId(pubName, publishers) && { publisherId: inferPublisherId(pubName, publishers) }),
      ...(inferCategoryId(pubName, categories) && { topLevelCategoryId: inferCategoryId(pubName, categories) }),
      ...(inferredFormat && { formatTypeId: inferredFormat }),
      ...(inferredVolume && { seriesNumber: inferredVolume }),
      ...(parsedSeries && { sourceSeries: parsedSeries }),
    });
    setShowRaw(false);
    setMultiResults(null);
    setTitleResults([]);
  }

  async function doIsbnLookup() {
    const cleaned = isbn.replace(/[-\s]/g, "");
    if (cleaned.length < 10) { setLookupError("Enter a valid ISBN (10 or 13 digits)."); return; }
    setLooking(true);
    setLookupError(null);
    setPrefill(null);
    setMultiResults(null);
    try {
      const results = await lookupGnIsbn(cleaned, searchSource === "comicvine" ? "all" : searchSource);
      if (!results || results.length === 0) {
        setLookupError("No results found for that ISBN in any source. You can fill in the form manually below.");
        setPrefill({});
        return;
      }
      if (results.length === 1) {
        applyResult(results[0], cleaned);
        if (!results[0].cover_image_url) {
          setLookupError("Found the book but no cover image is available from any source. You can paste a cover URL manually.");
        }
      } else {
        setMultiResults({ results, fallbackIsbn: cleaned });
      }
    } catch (e) {
      setLookupError(e.message);
      setPrefill({});
    } finally {
      setLooking(false);
    }
  }

  async function doTitleSearch() {
    const q = titleQuery.trim();
    if (!q) { setLookupError("Enter a title or keyword."); return; }
    setLooking(true);
    setLookupError(null);
    setTitleResults([]);
    setPrefill(null);
    try {
      const results = await searchGnExternal(q, searchSource);
      if (!results || results.length === 0) {
        setLookupError("No results found.");
      } else {
        setTitleResults(results);
      }
    } catch (e) {
      setLookupError(e.message);
    } finally {
      setLooking(false);
    }
  }

  const subTabStyle = (active) => ({
    fontSize: "var(--text-sm)",
    padding: "var(--space-2) var(--space-6)",
    border: "none",
    borderBottom: active ? "2px solid var(--btn-primary-bg)" : "2px solid transparent",
    background: "none",
    color: active ? "var(--btn-primary-bg)" : "var(--text-secondary)",
    fontWeight: active ? 700 : 400,
    cursor: "pointer",
  });

  return (
    <Stack gap={5}>
      <Card surface>
        <Stack gap={5}>
          <Row gap={0} style={{ borderBottom: "1px solid var(--border)" }}>
            <button type="button" style={subTabStyle(lookupType === "title")} onClick={() => { setLookupType("title"); setLookupError(null); setMultiResults(null); setPrefill(null); }}>Keyword</button>
            <button type="button" style={subTabStyle(lookupType === "isbn")} onClick={() => { setLookupType("isbn"); setLookupError(null); setTitleResults([]); }}>ISBN</button>
          </Row>

          {lookupType === "isbn" && (
            <Row gap={4} align="center" style={{ maxWidth: 520 }}>
              <Input
                value={isbn}
                onChange={(e) => setIsbn(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); doIsbnLookup(); } }}
                placeholder="ISBN-13 or ISBN-10"
                style={{ flex: 1 }}
              />
              <Select
                value={searchSource}
                onChange={(e) => { setSearchSource(e.target.value); setLookupError(null); setPrefill(null); setMultiResults(null); }}
                style={{ width: "auto", fontSize: "var(--text-sm)" }}
              >
                <option value="comicvine">Comic Vine + All</option>
                <option value="google">Google Books</option>
              </Select>
              <Button variant="primary" onClick={doIsbnLookup} disabled={looking}>
                {looking ? "Looking up…" : "Look up"}
              </Button>
            </Row>
          )}

          {lookupType === "title" && (
            <Stack gap={4}>
              <Row gap={4} align="center" style={{ maxWidth: 600 }}>
                <Input
                  value={titleQuery}
                  onChange={(e) => setTitleQuery(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); doTitleSearch(); } }}
                  placeholder="Title, author, or keyword…"
                  style={{ flex: 1 }}
                />
                <Select
                  value={searchSource}
                  onChange={(e) => { setSearchSource(e.target.value); setTitleResults([]); setLookupError(null); }}
                  style={{ width: "auto", fontSize: "var(--text-sm)" }}
                >
                  <option value="comicvine">Comic Vine</option>
                  <option value="google">Google Books</option>
                </Select>
                <Button variant="primary" onClick={doTitleSearch} disabled={looking}>
                  {looking ? "Searching…" : "Search"}
                </Button>
              </Row>
              {titleResults.length > 0 && (
                <Row gap={5} wrap>
                  {titleResults.map((r, i) => (
                    <div
                      key={i}
                      onClick={() => applyResult(r, "")}
                      style={{
                        width: 130, cursor: "pointer",
                        border: "2px solid var(--border)",
                        borderRadius: "var(--radius-md)",
                        overflow: "hidden",
                        background: "var(--bg-surface)",
                        display: "flex", flexDirection: "column",
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--green-vivid)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border)"; }}
                    >
                      {r.cover_image_url
                        ? <img src={r.cover_image_url} alt="" style={{ width: 130, height: 185, objectFit: "cover", display: "block", flexShrink: 0 }} />
                        : <div style={{ width: 130, height: 185, background: "var(--bg-surface)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                            <span style={{ fontSize: "10px", color: "var(--text-secondary)" }}>No Image</span>
                          </div>
                      }
                      <Stack gap={1} style={{ padding: "var(--space-3) var(--space-3)", flex: 1 }}>
                        <div style={{ fontSize: "var(--text-xs)", fontWeight: 700, lineHeight: 1.3, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{r.title}</div>
                        {r.publisher_name && <div style={{ fontSize: "10px", color: "var(--btn-primary-bg)", fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.publisher_name}</div>}
                        {r.writer_names?.filter(Boolean).length > 0 && <div style={{ fontSize: "10px", color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>✍ {r.writer_names.join(", ")}</div>}
                        {r.artist_names?.filter(Boolean).length > 0 && <div style={{ fontSize: "10px", color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>🎨 {r.artist_names.join(", ")}</div>}
                        {r.published_date && <div style={{ fontSize: "10px", color: "var(--text-secondary)" }}>{r.published_date}</div>}
                        {r.isbn_13 && <div style={{ fontSize: "9px", color: "var(--text-secondary)" }}>{r.isbn_13}</div>}
                        {r.page_count > 0 && <div style={{ fontSize: "9px", color: "var(--text-secondary)" }}>{r.page_count} pp.</div>}
                      </Stack>
                    </div>
                  ))}
                </Row>
              )}
            </Stack>
          )}

          {lookupError && <Alert tone="warn">{lookupError}</Alert>}

          {multiResults && (
            <Stack gap={4}>
              <div style={{ fontSize: "var(--text-base)", color: "var(--text-secondary)" }}>
                {multiResults.results.length} editions found — choose one:
              </div>
              <Row gap={5} wrap>
                {multiResults.results.map((r, i) => (
                  <div
                    key={i}
                    onClick={() => applyResult(r, multiResults.fallbackIsbn)}
                    style={{
                      width: 110, cursor: "pointer",
                      border: "2px solid var(--border)",
                      borderRadius: "var(--radius-md)",
                      overflow: "hidden",
                      background: "var(--bg-surface)",
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--green-vivid)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border)"; }}
                  >
                    {r.cover_image_url ? (
                      <img src={r.cover_image_url} alt="" style={{ width: 110, height: 160, objectFit: "cover", display: "block" }} />
                    ) : (
                      <div style={{ width: 110, height: 160, background: "var(--bg-surface)", border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <span style={{ fontSize: "10px", color: "var(--text-secondary)" }}>No Image</span>
                      </div>
                    )}
                    <div style={{ padding: "var(--space-2) var(--space-3)" }}>
                      <div style={{ fontSize: "var(--text-xs)", fontWeight: 700, lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.title || "—"}</div>
                      {r.writer_names?.length > 0 && (
                        <div style={{ fontSize: "10px", color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.writer_names.join(", ")}</div>
                      )}
                      {r.published_date && <div style={{ fontSize: "10px", color: "var(--text-secondary)" }}>{r.published_date}</div>}
                      {r.api_source && <div style={{ fontSize: "9px", color: "var(--text-secondary)", marginTop: 2 }}>{r.api_source}</div>}
                    </div>
                  </div>
                ))}
              </Row>
            </Stack>
          )}
        </Stack>
      </Card>

      {prefill !== null && (
        <Stack gap={4}>
          {prefill.title && (
            <Alert tone="success">
              Found: <strong>{prefill.title}</strong>
              {prefill.writers?.filter(Boolean).length ? ` — ${prefill.writers.filter(Boolean).join(", ")}` : ""}
              {prefill._publisherName ? ` — ${prefill._publisherName}` : ""}
              {prefill.apiSource ? <span style={{ fontSize: "var(--text-xs)", opacity: 0.7 }}> ({prefill.apiSource})</span> : ""}
              {" "}— review and complete the form below, then save.
            </Alert>
          )}
          {prefill._raw && (
            <div>
              <Button variant="secondary" size="sm" onClick={() => setShowRaw((v) => !v)}>
                {showRaw ? "Hide raw API data" : "Show raw API data"}
              </Button>
              {showRaw && (
                <pre style={{
                  marginTop: "var(--space-3)", padding: "var(--space-4) var(--space-5)",
                  background: "var(--bg-surface)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-sm)",
                  fontSize: "var(--text-xs)", lineHeight: 1.5,
                  overflowX: "auto", maxHeight: 400, overflowY: "auto",
                  whiteSpace: "pre-wrap", wordBreak: "break-all",
                }}>
                  {JSON.stringify(prefill._raw, null, 2)}
                </pre>
              )}
            </div>
          )}
          <ManualForm
            publishers={publishers}
            formatTypes={formatTypes}
            eras={eras}
            ownershipStatuses={ownershipStatuses}
            readStatuses={readStatuses}
            categories={categories}
            initialValues={prefill}
            onCreated={onCreated}
          />
        </Stack>
      )}
    </Stack>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function GraphicNovelsIngestPage() {
  const [tab, setTab] = useState("title");
  const [publishers, setPublishers] = useState([]);
  const [formatTypes, setFormatTypes] = useState([]);
  const [eras, setEras] = useState([]);
  const [ownershipStatuses, setOwnershipStatuses] = useState([]);
  const [readStatuses, setReadStatuses] = useState([]);
  const [categories, setCategories] = useState([]);
  const [createdCount, setCreatedCount] = useState(0);

  useEffect(() => {
    Promise.all([
      fetchGnPublishers().then(setPublishers),
      fetchGnFormatTypes().then(setFormatTypes),
      fetchGnEras().then(setEras),
      fetchOwnershipStatuses(COLLECTION_TYPE_IDS.graphicnovels).then(setOwnershipStatuses),
      fetchConsumptionStatuses(COLLECTION_TYPE_IDS.graphicnovels).then(setReadStatuses),
      fetchTopLevelCategories(GN_COLLECTION_TYPE_CODE).then(setCategories),
    ]).catch(() => {});
  }, []);

  const tabStyle = (active) => ({
    fontSize: "var(--text-base)",
    padding: "var(--space-3) var(--space-6)",
    cursor: "pointer",
    borderBottom: active ? "2px solid var(--btn-primary-bg)" : "2px solid transparent",
    color: active ? "var(--btn-primary-bg)" : "var(--text-secondary)",
    fontWeight: active ? 700 : 400,
    background: "none",
    border: "none",
  });

  return (
    <PageContainer title="Add Graphic Novel">
      <div style={{ maxWidth: 860, margin: "0 auto" }}>
        <div style={{ marginBottom: "var(--space-2)", color: "var(--text-secondary)", fontSize: "var(--text-base)" }}>
          {createdCount > 0 && `${createdCount} item${createdCount !== 1 ? "s" : ""} added this session.`}
        </div>
        <Row gap={0} style={{ borderBottom: "1px solid var(--border)", marginBottom: "var(--space-7)" }}>
          <button style={tabStyle(tab === "title")} onClick={() => setTab("title")}>Lookup</button>
          <button style={tabStyle(tab === "manual")} onClick={() => setTab("manual")}>Manual Entry</button>
        </Row>

        {tab === "manual" && (
          <ManualForm
            publishers={publishers}
            formatTypes={formatTypes}
            eras={eras}
            ownershipStatuses={ownershipStatuses}
            readStatuses={readStatuses}
            categories={categories}
            initialValues={{}}
            onCreated={() => setCreatedCount((n) => n + 1)}
          />
        )}

        {tab === "title" && (
          <IsbnLookupTab
            publishers={publishers}
            formatTypes={formatTypes}
            eras={eras}
            ownershipStatuses={ownershipStatuses}
            readStatuses={readStatuses}
            categories={categories}
            onCreated={() => setCreatedCount((n) => n + 1)}
          />
        )}
      </div>
    </PageContainer>
  );
}
