import { useEffect, useRef, useState } from "react";
import {
  createBook,
  fetchBookAgeLevels,
  fetchBookFormatDetails,
  fetchBookGenres,
  fetchConsumptionStatuses,
  fetchOwnershipStatuses,
  lookupBookIsbn,
  searchBooksExternal,
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
  FormField,
  Grid,
  Input,
  RemoveButton,
  Row,
  Select,
  Stack,
  Textarea,
} from "../components/primitives";

const BOOK_COLLECTION_TYPE_ID = COLLECTION_TYPE_IDS.books;

const categoryOptions = [
  { id: 3, label: "Fiction" },
  { id: 4, label: "Non-Fiction" },
];

// ─── Blank form state ─────────────────────────────────────────────────────────

function blankForm(ownershipStatuses) {
  return {
    title: "",
    authorNames: [""],
    seriesName: "",
    seriesNumber: "",
    topLevelCategoryId: "",
    ownershipStatusId: ownershipStatuses.length ? String(ownershipStatuses[0].ownership_status_id) : "",
    readingStatusId: "",
    ageLevelId: "",
    formatDetailId: "",
    genres: [],
    tagNames: "",
    isbn13: "",
    isbn10: "",
    publisher: "",
    publishedDate: "",
    pageCount: "",
    language: "en",
    coverImageUrl: "",
    description: "",
    notes: "",
    starRating: "",
    apiSource: "",
    externalWorkId: "",
    apiCategoriesRaw: "",
  };
}

// ─── Genre picker ─────────────────────────────────────────────────────────────

function GenrePicker({ genres, selected, onChange }) {
  const [topId, setTopId] = useState("");
  const [subId, setSubId] = useState("");

  const topGenre = genres.find((g) => String(g.top_level_genre_id) === topId);
  const subGenres = topGenre?.sub_genres || [];

  function handleAdd() {
    if (!topId) return;
    const tg = genres.find((g) => String(g.top_level_genre_id) === topId);
    const sg = subGenres.find((s) => String(s.sub_genre_id) === subId);
    const entry = {
      top_level_genre_id: Number(topId),
      genre_name: tg?.genre_name || "",
      sub_genre_id: sg ? Number(subId) : null,
      sub_genre_name: sg?.sub_genre_name || null,
    };
    const key = `${entry.top_level_genre_id}-${entry.sub_genre_id}`;
    if (!selected.some((s) => `${s.top_level_genre_id}-${s.sub_genre_id}` === key)) {
      onChange([...selected, entry]);
    }
    setSubId("");
  }

  function handleRemove(idx) {
    onChange(selected.filter((_, i) => i !== idx));
  }

  return (
    <Stack gap={2}>
      <Row gap={3}>
        <Select value={topId} onChange={(e) => { setTopId(e.target.value); setSubId(""); }} style={{ flex: 1 }}>
          <option value="">-- Genre --</option>
          {genres.map((g) => (
            <option key={g.top_level_genre_id} value={g.top_level_genre_id}>{g.genre_name}</option>
          ))}
        </Select>
        {subGenres.length > 0 && (
          <Select value={subId} onChange={(e) => setSubId(e.target.value)} style={{ flex: 1 }}>
            <option value="">-- Subgenre --</option>
            {subGenres.map((s) => (
              <option key={s.sub_genre_id} value={s.sub_genre_id}>{s.sub_genre_name}</option>
            ))}
          </Select>
        )}
        <Button variant="secondary" size="sm" onClick={handleAdd} disabled={!topId}>Add</Button>
      </Row>
      {selected.length > 0 && (
        <Row gap={2} wrap>
          {selected.map((s, i) => (
            <Badge key={i} tone="tag">
              {s.genre_name}{s.sub_genre_name ? ` / ${s.sub_genre_name}` : ""}
              <RemoveButton onClick={() => handleRemove(i)} style={{ marginLeft: "var(--space-1)" }} />
            </Badge>
          ))}
        </Row>
      )}
    </Stack>
  );
}

// ─── Manual form ─────────────────────────────────────────────────────────────

function ManualForm({ ownershipStatuses, readStatuses, ageLevels, formatDetails, genres, initialValues, onCreated }) {
  const [form, setForm] = useState(() => ({ ...blankForm(ownershipStatuses), ...initialValues }));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saveSuccess, setSaveSuccess] = useState("");
  const [dupeWarning, setDupeWarning] = useState("");
  const coverFileRef = useRef(null);

  async function handleCoverFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const { url } = await uploadCover(file, "books");
      setField("coverImageUrl", url);
    } catch (err) {
      setSaveError(err.message || "Cover upload failed.");
    }
    if (coverFileRef.current) coverFileRef.current.value = "";
  }

  useEffect(() => {
    if (initialValues && Object.keys(initialValues).length > 0) {
      setForm({ ...blankForm(ownershipStatuses), ...initialValues });
      setSaveError("");
      setSaveSuccess("");
      setDupeWarning("");
    }
  }, [initialValues]); // eslint-disable-line react-hooks/exhaustive-deps

  function setField(key, val) {
    setForm((prev) => ({ ...prev, [key]: val }));
  }

  function resetForm() {
    setForm(blankForm(ownershipStatuses));
    setSaveError("");
    setSaveSuccess("");
    setDupeWarning("");
  }

  async function handleSubmit() {
    setSaveError("");
    setSaveSuccess("");
    setDupeWarning("");

    if (!form.title.trim()) { setSaveError("Title is required."); return; }
    if (!form.authorNames[0]?.trim()) { setSaveError("At least one author is required."); return; }
    if (!form.topLevelCategoryId) { setSaveError("Category (Fiction/Non-Fiction) is required."); return; }

    const payload = {
      collection_type_id: BOOK_COLLECTION_TYPE_ID,
      top_level_category_id: Number(form.topLevelCategoryId),
      ownership_status_id: Number(form.ownershipStatusId),
      reading_status_id: form.readingStatusId ? Number(form.readingStatusId) : null,
      notes: form.notes.trim() || null,
      title: form.title.trim(),
      description: form.description.trim() || null,
      age_level_id: form.ageLevelId ? Number(form.ageLevelId) : null,
      star_rating: form.starRating ? Number(form.starRating) : null,
      author_names: form.authorNames.map((n) => n.trim()).filter(Boolean),
      series_name: form.seriesName.trim() || null,
      series_number: form.seriesNumber ? parseFloat(form.seriesNumber) : null,
      genres: form.genres.map((g) => ({
        top_level_genre_id: g.top_level_genre_id,
        sub_genre_id: g.sub_genre_id || null,
      })),
      tag_names: form.tagNames.split(",").map((t) => t.trim()).filter(Boolean),
      format_detail_id: form.formatDetailId ? Number(form.formatDetailId) : null,
      isbn_13: form.isbn13.trim() || null,
      isbn_10: form.isbn10.trim() || null,
      publisher: form.publisher.trim() || null,
      published_date: form.publishedDate.trim() || null,
      page_count: form.pageCount ? parseInt(form.pageCount, 10) : null,
      language: form.language.trim() || "en",
      cover_image_url: form.coverImageUrl.trim() || null,
      api_source: form.apiSource || null,
      external_work_id: form.externalWorkId || null,
      api_categories_raw: form.apiCategoriesRaw || null,
    };

    setSaving(true);
    try {
      const result = await createBook(payload);
      setSaveSuccess(`Added "${result.title}" (item #${result.item_id})`);
      resetForm();
      onCreated?.();
      document.querySelector(".app-main")?.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      const msg = err.message || "Failed to save.";
      if (msg.includes("already exists")) {
        setDupeWarning(msg);
      } else {
        setSaveError(msg);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card surface>
      <Stack gap={5}>
        {saveError && <Alert tone="error">{saveError}</Alert>}
        {dupeWarning && (
          <Alert tone="warn">
            {dupeWarning}
            <Button variant="secondary" size="sm" onClick={() => setDupeWarning("")} style={{ marginLeft: "var(--space-4)" }}>
              Dismiss
            </Button>
          </Alert>
        )}
        {saveSuccess && <Alert tone="success">{saveSuccess}</Alert>}

        {form.coverImageUrl && (
          <Row gap={5} align="start">
            <img
              src={form.coverImageUrl}
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
              <Button variant="secondary" size="sm" onClick={() => setField("coverImageUrl", "")} style={{ marginTop: "var(--space-3)", color: "var(--danger-text)" }}>
                Remove
              </Button>
            </div>
          </Row>
        )}

        <FormField label="Title" required>
          <Input value={form.title} onChange={(e) => setField("title", e.target.value)} placeholder="Book title" />
        </FormField>

        <FormField label="Author(s)" required>
          <NameList names={form.authorNames} onChange={(v) => setField("authorNames", v)} addLabel="+ Author" placeholder="Author name" />
        </FormField>

        <Grid cols={3} gap={5}>
          <FormField label="Category" required>
            <Select value={form.topLevelCategoryId} onChange={(e) => setField("topLevelCategoryId", e.target.value)}>
              <option value="">-- Select --</option>
              {categoryOptions.map((c) => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </Select>
          </FormField>
          <FormField label="Ownership">
            <Select value={form.ownershipStatusId} onChange={(e) => setField("ownershipStatusId", e.target.value)}>
              {ownershipStatuses.map((s) => (
                <option key={s.ownership_status_id} value={s.ownership_status_id}>{s.status_name}</option>
              ))}
            </Select>
          </FormField>
          <FormField label="Read Status">
            <Select value={form.readingStatusId} onChange={(e) => setField("readingStatusId", e.target.value)}>
              <option value="">-- None --</option>
              {readStatuses.map((s) => (
                <option key={s.read_status_id} value={s.read_status_id}>{s.status_name}</option>
              ))}
            </Select>
          </FormField>
          <FormField label="Format">
            <Select value={form.formatDetailId} onChange={(e) => setField("formatDetailId", e.target.value)}>
              <option value="">-- None --</option>
              {formatDetails.map((f) => (
                <option key={f.format_detail_id} value={f.format_detail_id}>{f.top_level_format} — {f.format_name}</option>
              ))}
            </Select>
          </FormField>
          <FormField label="Age Level">
            <Select value={form.ageLevelId} onChange={(e) => setField("ageLevelId", e.target.value)}>
              <option value="">-- None --</option>
              {ageLevels.map((a) => (
                <option key={a.age_level_id} value={a.age_level_id}>{a.age_level_name}</option>
              ))}
            </Select>
          </FormField>
          <FormField label="Star Rating">
            <Select value={form.starRating} onChange={(e) => setField("starRating", e.target.value)}>
              <option value="">-- None --</option>
              {[1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5].map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </Select>
          </FormField>
        </Grid>

        <FormField label="Genres">
          <GenrePicker genres={genres} selected={form.genres} onChange={(v) => setField("genres", v)} />
        </FormField>

        <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "var(--space-5) var(--space-7)" }}>
          <FormField label="Series">
            <Input value={form.seriesName} onChange={(e) => setField("seriesName", e.target.value)} placeholder="Series name" />
          </FormField>
          <div style={{ width: 90 }}>
            <FormField label="Book #">
              <Input value={form.seriesNumber} onChange={(e) => setField("seriesNumber", e.target.value)} placeholder="e.g. 1" type="number" step="0.1" />
            </FormField>
          </div>
        </div>

        <FormField
          label={<>Tags <span style={{ fontWeight: 400, color: "var(--text-secondary)" }}>(comma-separated)</span></>}
        >
          <Input value={form.tagNames} onChange={(e) => setField("tagNames", e.target.value)} placeholder="e.g. magic system, cozy" />
        </FormField>

        <Grid cols={3} gap={5}>
          <FormField label="ISBN-13">
            <Input value={form.isbn13} onChange={(e) => setField("isbn13", e.target.value)} />
          </FormField>
          <FormField label="ISBN-10">
            <Input value={form.isbn10} onChange={(e) => setField("isbn10", e.target.value)} />
          </FormField>
          <FormField label="Language">
            <Input value={form.language} onChange={(e) => setField("language", e.target.value)} placeholder="en" />
          </FormField>
          <FormField label="Publisher">
            <Input value={form.publisher} onChange={(e) => setField("publisher", e.target.value)} />
          </FormField>
          <FormField label="Published Date">
            <Input value={form.publishedDate} onChange={(e) => setField("publishedDate", e.target.value)} placeholder="YYYY-MM-DD" />
          </FormField>
          <FormField label="Page Count">
            <Input value={form.pageCount} onChange={(e) => setField("pageCount", e.target.value)} type="number" />
          </FormField>
        </Grid>

        <FormField label="Cover Image URL">
          <Row gap={3} align="start">
            <Input value={form.coverImageUrl} onChange={(e) => setField("coverImageUrl", e.target.value)} placeholder="https://..." style={{ flex: 1 }} />
            <input type="file" accept="image/*" ref={coverFileRef} onChange={handleCoverFile} style={{ display: "none" }} />
            <Button type="button" variant="secondary" size="sm" onClick={() => coverFileRef.current?.click()}>
              Add Image
            </Button>
            {form.coverImageUrl && (
              <img
                src={form.coverImageUrl}
                alt="cover preview"
                style={{ width: 50, height: 70, objectFit: "cover", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)" }}
                onError={(e) => { e.target.style.display = "none"; }}
              />
            )}
          </Row>
        </FormField>

        <FormField label="Description">
          <Textarea value={form.description} onChange={(e) => setField("description", e.target.value)} rows={3} />
        </FormField>

        <FormField label="Notes">
          <Input value={form.notes} onChange={(e) => setField("notes", e.target.value)} />
        </FormField>

        <Row gap={4}>
          <Button type="button" variant="primary" onClick={handleSubmit} disabled={saving}>
            {saving ? "Saving..." : "Add Book"}
          </Button>
          <Button type="button" variant="secondary" onClick={resetForm}>Clear</Button>
        </Row>
      </Stack>
    </Card>
  );
}

// ─── Lookup panel ─────────────────────────────────────────────────────────────

function LookupPanel({ ownershipStatuses, readStatuses, ageLevels, formatDetails, genres, onCreated }) {
  const [lookupType, setLookupType] = useState("title");
  const [isbnInput, setIsbnInput] = useState("");
  const [isbnLoading, setIsbnLoading] = useState(false);
  const [isbnError, setIsbnError] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [prefill, setPrefill] = useState(null);
  const [showRaw, setShowRaw] = useState(false);

  function applyResult(r) {
    setPrefill({
      title: r.title || "",
      authorNames: r.author_names?.length ? r.author_names : [""],
      isbn13: r.isbn_13 || "",
      isbn10: r.isbn_10 || "",
      publisher: r.publisher || "",
      publishedDate: r.published_date || "",
      pageCount: r.page_count ? String(r.page_count) : "",
      language: r.language || "en",
      coverImageUrl: r.cover_image_url || "",
      description: r.description || "",
      apiSource: r.api_source || "",
      externalWorkId: r.external_work_id || "",
      apiCategoriesRaw: r.api_categories_raw || "",
      _raw: r._raw || null,
    });
    setShowRaw(false);
    setSearchResults([]);
  }

  async function handleIsbnLookup() {
    const isbn = isbnInput.trim().replace(/[-\s]/g, "");
    if (!isbn) { setIsbnError("Enter an ISBN."); return; }
    setIsbnError("");
    setIsbnLoading(true);
    try {
      const result = await lookupBookIsbn(isbn);
      if (!result) { setIsbnError("No book found for that ISBN."); return; }
      applyResult(result);
    } catch (err) {
      setIsbnError(err.message || "Lookup failed.");
    } finally {
      setIsbnLoading(false);
    }
  }

  async function handleSearch() {
    const q = searchInput.trim();
    if (!q) { setSearchError("Enter a search query."); return; }
    setSearchError("");
    setSearchLoading(true);
    setSearchResults([]);
    try {
      const results = await searchBooksExternal(q);
      setSearchResults(results || []);
      if (!results?.length) setSearchError("No results found.");
    } catch (err) {
      setSearchError(err.message || "Search failed.");
    } finally {
      setSearchLoading(false);
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
        <Stack gap={4}>
          <Row gap={0} style={{ borderBottom: "1px solid var(--border)" }}>
            <button type="button" style={subTabStyle(lookupType === "title")} onClick={() => { setLookupType("title"); setSearchError(""); setSearchResults([]); }}>Keyword</button>
            <button type="button" style={subTabStyle(lookupType === "isbn")} onClick={() => { setLookupType("isbn"); setIsbnError(""); }}>ISBN</button>
          </Row>

          {lookupType === "title" && (
            <Stack gap={4}>
              <Row gap={4} align="center">
                <Input
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                  placeholder="Title, author, or keyword…"
                  style={{ flex: 1 }}
                />
                <Button type="button" variant="primary" onClick={handleSearch} disabled={searchLoading}>
                  {searchLoading ? "Searching…" : "Search"}
                </Button>
              </Row>
              {searchError && <Alert tone="error">{searchError}</Alert>}
              {searchResults.length > 0 && (
                <Row gap={5} wrap>
                  {searchResults.map((r, i) => (
                    <div
                      key={i}
                      onClick={() => applyResult(r)}
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
                          </div>}
                      <Stack gap={1} style={{ padding: "var(--space-3) var(--space-3)", flex: 1 }}>
                        <div style={{ fontSize: "var(--text-xs)", fontWeight: 700, lineHeight: 1.3, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{r.title}</div>
                        {r.author_names?.length > 0 && <div style={{ fontSize: "10px", color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>✍ {r.author_names.join(", ")}</div>}
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

          {lookupType === "isbn" && (
            <Stack gap={3}>
              <Row gap={4} align="center">
                <Input
                  value={isbnInput}
                  onChange={(e) => setIsbnInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleIsbnLookup()}
                  placeholder="ISBN-13 or ISBN-10"
                  style={{ flex: 1 }}
                />
                <Button type="button" variant="primary" onClick={handleIsbnLookup} disabled={isbnLoading}>
                  {isbnLoading ? "Looking up…" : "Look up"}
                </Button>
              </Row>
              {isbnError && <Alert tone="error">{isbnError}</Alert>}
              <div style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>
                Fills the form from Google Books. You can edit before saving.
              </div>
            </Stack>
          )}
        </Stack>
      </Card>

      {prefill !== null && (
        <Stack gap={4}>
          {prefill.title && (
            <Alert tone="success">
              Found: <strong>{prefill.title}</strong>
              {prefill.authorNames?.filter(Boolean).length ? ` — ${prefill.authorNames.filter(Boolean).join(", ")}` : ""}
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
            ownershipStatuses={ownershipStatuses}
            readStatuses={readStatuses}
            ageLevels={ageLevels}
            formatDetails={formatDetails}
            genres={genres}
            initialValues={prefill}
            onCreated={onCreated}
          />
        </Stack>
      )}
    </Stack>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function BooksIngestPage() {
  const [tab, setTab] = useState("lookup");
  const [ownershipStatuses, setOwnershipStatuses] = useState([]);
  const [readStatuses, setReadStatuses] = useState([]);
  const [ageLevels, setAgeLevels] = useState([]);
  const [formatDetails, setFormatDetails] = useState([]);
  const [genres, setGenres] = useState([]);
  const [loadingLookups, setLoadingLookups] = useState(true);
  const [lookupError, setLookupError] = useState("");
  const [createdCount, setCreatedCount] = useState(0);

  useEffect(() => {
    Promise.all([
      fetchOwnershipStatuses(BOOK_COLLECTION_TYPE_ID),
      fetchConsumptionStatuses(BOOK_COLLECTION_TYPE_ID),
      fetchBookAgeLevels(),
      fetchBookFormatDetails(),
      fetchBookGenres(),
    ])
      .then(([os, rs, al, fd, g]) => {
        setOwnershipStatuses(os);
        setReadStatuses(rs);
        setAgeLevels(al);
        setFormatDetails(fd);
        setGenres(g);
      })
      .catch((err) => setLookupError(err.message || "Failed to load lookups"))
      .finally(() => setLoadingLookups(false));
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

  if (loadingLookups) return <PageContainer><div style={{ padding: "var(--space-8)" }}>Loading...</div></PageContainer>;
  if (lookupError) return <PageContainer><Alert tone="error">{lookupError}</Alert></PageContainer>;

  return (
    <PageContainer title="Add Book">
      <div style={{ maxWidth: 860, margin: "0 auto" }}>
        <div style={{ marginBottom: "var(--space-2)", color: "var(--text-secondary)", fontSize: "var(--text-base)" }}>
          {createdCount > 0 && `${createdCount} item${createdCount !== 1 ? "s" : ""} added this session.`}
        </div>
        <Row gap={0} style={{ borderBottom: "1px solid var(--border)", marginBottom: "var(--space-7)" }}>
          <button style={tabStyle(tab === "lookup")} onClick={() => setTab("lookup")}>Lookup</button>
          <button style={tabStyle(tab === "manual")} onClick={() => setTab("manual")}>Manual Entry</button>
        </Row>

        {tab === "lookup" && (
          <LookupPanel
            ownershipStatuses={ownershipStatuses}
            readStatuses={readStatuses}
            ageLevels={ageLevels}
            formatDetails={formatDetails}
            genres={genres}
            onCreated={() => setCreatedCount((n) => n + 1)}
          />
        )}

        {tab === "manual" && (
          <ManualForm
            ownershipStatuses={ownershipStatuses}
            readStatuses={readStatuses}
            ageLevels={ageLevels}
            formatDetails={formatDetails}
            genres={genres}
            initialValues={{}}
            onCreated={() => setCreatedCount((n) => n + 1)}
          />
        )}
      </div>
    </PageContainer>
  );
}
