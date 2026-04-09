import { useEffect, useRef, useState } from "react";
import {
  createBook,
  fetchBookAgeLevels,
  fetchBookFormatDetails,
  fetchBookGenres,
  fetchBookReadStatuses,
  fetchOwnershipStatuses,
  lookupBookIsbn,
  searchBooksExternal,
} from "../api";
import PageContainer from "../components/layout/PageContainer";

// ─── Styles ──────────────────────────────────────────────────────────────────

const labelStyle = { display: "block", fontSize: 12, fontWeight: "bold", marginBottom: 3, color: "#444" };
const inputStyle = { fontSize: 13, padding: "3px 6px", borderRadius: 3, border: "1px solid #ccc", width: "100%", boxSizing: "border-box" };
const selectStyle = { fontSize: 13, padding: "3px 6px", borderRadius: 3, border: "1px solid #ccc", width: "100%" };
const btnPrimary = { fontSize: 13, padding: "6px 14px", background: "#1976d2", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer" };
const btnSecondary = { fontSize: 13, padding: "5px 12px", background: "#f5f5f5", color: "#333", border: "1px solid #ccc", borderRadius: 4, cursor: "pointer" };
const btnSm = { fontSize: 11, padding: "2px 7px", background: "#f5f5f5", border: "1px solid #ccc", borderRadius: 3, cursor: "pointer" };
const alertError = { marginBottom: 10, padding: "8px 10px", border: "1px solid #c62828", background: "#ffebee", fontSize: 13, borderRadius: 3 };
const alertSuccess = { marginBottom: 10, padding: "8px 10px", border: "1px solid #2e7d32", background: "#e8f5e9", fontSize: 13, borderRadius: 3 };
const alertWarn = { marginBottom: 10, padding: "8px 10px", border: "1px solid #e65100", background: "#fff3e0", fontSize: 13, borderRadius: 3 };

const BOOK_COLLECTION_TYPE_ID = 2;

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
    genres: [], // [{top_level_genre_id, genre_name, sub_genre_id, sub_genre_name}]
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
    // hidden API fields
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
    // avoid duplicates
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
    <div>
      <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 4 }}>
        <select value={topId} onChange={(e) => { setTopId(e.target.value); setSubId(""); }} style={{ ...selectStyle, width: "auto", flex: 1 }}>
          <option value="">-- Genre --</option>
          {genres.map((g) => (
            <option key={g.top_level_genre_id} value={g.top_level_genre_id}>{g.genre_name}</option>
          ))}
        </select>
        {subGenres.length > 0 && (
          <select value={subId} onChange={(e) => setSubId(e.target.value)} style={{ ...selectStyle, width: "auto", flex: 1 }}>
            <option value="">-- Subgenre --</option>
            {subGenres.map((s) => (
              <option key={s.sub_genre_id} value={s.sub_genre_id}>{s.sub_genre_name}</option>
            ))}
          </select>
        )}
        <button type="button" onClick={handleAdd} style={btnSm} disabled={!topId}>Add</button>
      </div>
      {selected.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
          {selected.map((s, i) => (
            <span key={i} style={{ fontSize: 11, padding: "2px 6px", background: "#e3f2fd", border: "1px solid #90caf9", borderRadius: 10, display: "flex", alignItems: "center", gap: 4 }}>
              {s.genre_name}{s.sub_genre_name ? ` / ${s.sub_genre_name}` : ""}
              <button type="button" onClick={() => handleRemove(i)} style={{ border: "none", background: "none", cursor: "pointer", fontSize: 11, color: "#555", padding: 0, lineHeight: 1 }}>✕</button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Author list editor ───────────────────────────────────────────────────────

function AuthorList({ names, onChange }) {
  function update(idx, val) {
    const next = [...names];
    next[idx] = val;
    onChange(next);
  }
  function add() { onChange([...names, ""]); }
  function remove(idx) { onChange(names.filter((_, i) => i !== idx)); }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {names.map((n, i) => (
        <div key={i} style={{ display: "flex", gap: 4, alignItems: "center" }}>
          <input
            value={n}
            onChange={(e) => update(i, e.target.value)}
            placeholder={i === 0 ? "Primary author" : "Additional author"}
            style={{ ...inputStyle, flex: 1 }}
          />
          {names.length > 1 && (
            <button type="button" onClick={() => remove(i)} style={{ ...btnSm, color: "#c62828" }}>✕</button>
          )}
        </div>
      ))}
      <button type="button" onClick={add} style={{ ...btnSm, alignSelf: "flex-start" }}>+ Author</button>
    </div>
  );
}

// ─── External search results ──────────────────────────────────────────────────

function ExternalSearchResults({ results, onSelect }) {
  if (!results.length) return <div style={{ color: "#999", fontSize: 13 }}>No results.</div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {results.map((r, i) => (
        <div
          key={i}
          onClick={() => onSelect(r)}
          style={{
            display: "flex", gap: 10, alignItems: "flex-start",
            padding: "8px 10px", border: "1px solid #ddd", borderRadius: 4,
            cursor: "pointer", background: "#fff",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "#e3f2fd"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "#fff"; }}
        >
          {r.cover_image_url ? (
            <img src={r.cover_image_url} alt="" style={{ width: 44, height: 60, objectFit: "cover", borderRadius: 2, flexShrink: 0, border: "1px solid #ddd" }} />
          ) : (
            <div style={{ width: 44, height: 60, background: "#eee", borderRadius: 2, flexShrink: 0 }} />
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: "bold", fontSize: 13 }}>{r.title}</div>
            <div style={{ fontSize: 12, color: "#555" }}>{(r.author_names || []).join(", ")}</div>
            {r.published_date && <div style={{ fontSize: 11, color: "#888" }}>{r.published_date}</div>}
            {r.isbn_13 && <div style={{ fontSize: 11, color: "#888" }}>ISBN-13: {r.isbn_13}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function BooksIngestPage() {
  const [mode, setMode] = useState("manual"); // "manual" | "isbn" | "search"

  // Lookups
  const [ownershipStatuses, setOwnershipStatuses] = useState([]);
  const [readStatuses, setReadStatuses] = useState([]);
  const [ageLevels, setAgeLevels] = useState([]);
  const [formatDetails, setFormatDetails] = useState([]);
  const [genres, setGenres] = useState([]);
  const [loadingLookups, setLoadingLookups] = useState(true);
  const [lookupError, setLookupError] = useState("");

  // Form state
  const [form, setForm] = useState(null); // null until lookups arrive

  // ISBN lookup
  const [isbnInput, setIsbnInput] = useState("");
  const [isbnLoading, setIsbnLoading] = useState(false);
  const [isbnError, setIsbnError] = useState("");

  // External search
  const [searchInput, setSearchInput] = useState("");
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [searchResults, setSearchResults] = useState([]);

  // Submit state
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saveSuccess, setSaveSuccess] = useState("");
  const [dupeWarning, setDupeWarning] = useState("");

  // Load lookups
  useEffect(() => {
    Promise.all([
      fetchOwnershipStatuses(),
      fetchBookReadStatuses(),
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
        setForm(blankForm(os));
      })
      .catch((err) => setLookupError(err.message || "Failed to load lookups"))
      .finally(() => setLoadingLookups(false));
  }, []);

  function setField(key, val) {
    setForm((prev) => ({ ...prev, [key]: val }));
  }

  function resetForm() {
    setForm(blankForm(ownershipStatuses));
    setSaveError("");
    setSaveSuccess("");
    setDupeWarning("");
  }

  // Fill form from external result
  function applyExternalResult(r) {
    setForm((prev) => ({
      ...prev,
      title: r.title || prev.title,
      authorNames: r.author_names?.length ? r.author_names : prev.authorNames,
      isbn13: r.isbn_13 || prev.isbn13,
      isbn10: r.isbn_10 || prev.isbn10,
      publisher: r.publisher || prev.publisher,
      publishedDate: r.published_date || prev.publishedDate,
      pageCount: r.page_count ? String(r.page_count) : prev.pageCount,
      language: r.language || prev.language,
      coverImageUrl: r.cover_image_url || prev.coverImageUrl,
      description: r.description || prev.description,
      apiSource: r.api_source || prev.apiSource,
      externalWorkId: r.external_work_id || prev.externalWorkId,
      apiCategoriesRaw: r.api_categories_raw || prev.apiCategoriesRaw,
    }));
    setSaveError("");
    setSaveSuccess("");
    setDupeWarning("");
    setMode("manual");
    setSearchResults([]);
  }

  // ISBN lookup
  async function handleIsbnLookup() {
    const isbn = isbnInput.trim().replace(/[-\s]/g, "");
    if (!isbn) { setIsbnError("Enter an ISBN."); return; }
    setIsbnError("");
    setIsbnLoading(true);
    try {
      const result = await lookupBookIsbn(isbn);
      if (!result) { setIsbnError("No book found for that ISBN."); return; }
      applyExternalResult(result);
    } catch (err) {
      setIsbnError(err.message || "Lookup failed.");
    } finally {
      setIsbnLoading(false);
    }
  }

  // External search
  async function handleSearch() {
    const q = searchInput.trim();
    if (!q) { setSearchError("Enter a search query."); return; }
    setSearchError("");
    setSearchLoading(true);
    setSearchResults([]);
    try {
      const results = await searchBooksExternal(q);
      setSearchResults(results);
      if (!results.length) setSearchError("No results found.");
    } catch (err) {
      setSearchError(err.message || "Search failed.");
    } finally {
      setSearchLoading(false);
    }
  }

  // Submit
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

  if (loadingLookups) return <PageContainer><div style={{ padding: 20 }}>Loading...</div></PageContainer>;
  if (lookupError) return <PageContainer><div style={{ padding: 20, color: "#c62828" }}>{lookupError}</div></PageContainer>;
  if (!form) return null;

  const fictionCategory = genres.find((g) => g.category_scope_id === 3); // category_scope_id for Fiction
  // derive category options from ownership statuses patterns — just use Fiction=3/NonFiction=4
  const categoryOptions = [
    { id: 3, label: "Fiction" },
    { id: 4, label: "Non-Fiction" },
  ];

  return (
    <PageContainer>
      <div style={{ padding: 16, maxWidth: 860, margin: "0 auto" }}>
        <h2 style={{ marginTop: 0, marginBottom: 12, fontSize: 18 }}>Add Book</h2>

        {/* Mode tabs */}
        <div style={{ display: "flex", gap: 0, marginBottom: 16, borderBottom: "1px solid #ddd" }}>
          {[
            { key: "manual", label: "Manual Entry" },
            { key: "isbn", label: "ISBN Lookup" },
            { key: "search", label: "External Search" },
          ].map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setMode(tab.key)}
              style={{
                padding: "7px 16px",
                fontSize: 13,
                border: "none",
                borderBottom: mode === tab.key ? "2px solid #1976d2" : "2px solid transparent",
                background: "none",
                color: mode === tab.key ? "#1976d2" : "#555",
                fontWeight: mode === tab.key ? "bold" : "normal",
                cursor: "pointer",
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* ISBN Lookup panel */}
        {mode === "isbn" && (
          <div style={{ marginBottom: 16, padding: 12, border: "1px solid #e0e0e0", borderRadius: 6, background: "#fafafa" }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                value={isbnInput}
                onChange={(e) => setIsbnInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleIsbnLookup()}
                placeholder="ISBN-13 or ISBN-10"
                style={{ ...inputStyle, flex: 1 }}
              />
              <button type="button" onClick={handleIsbnLookup} disabled={isbnLoading} style={btnPrimary}>
                {isbnLoading ? "Looking up..." : "Lookup"}
              </button>
            </div>
            {isbnError && <div style={{ ...alertError, marginTop: 8, marginBottom: 0 }}>{isbnError}</div>}
            <div style={{ fontSize: 11, color: "#888", marginTop: 6 }}>
              Fills the form below from Google Books. You can edit before saving.
            </div>
          </div>
        )}

        {/* External Search panel */}
        {mode === "search" && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
              <input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                placeholder="Title, author, or keyword..."
                style={{ ...inputStyle, flex: 1 }}
              />
              <button type="button" onClick={handleSearch} disabled={searchLoading} style={btnPrimary}>
                {searchLoading ? "Searching..." : "Search"}
              </button>
            </div>
            {searchError && <div style={{ ...alertError, marginBottom: 8 }}>{searchError}</div>}
            <ExternalSearchResults results={searchResults} onSelect={applyExternalResult} />
          </div>
        )}

        {/* Form */}
        {(mode === "manual" || mode === "isbn") && (
          <div style={{ border: "1px solid #e0e0e0", borderRadius: 6, padding: 16, background: "#fff" }}>
            {saveError && <div style={alertError}>{saveError}</div>}
            {dupeWarning && <div style={alertWarn}>{dupeWarning} <button type="button" onClick={() => setDupeWarning("")} style={{ ...btnSm, marginLeft: 8 }}>Dismiss</button></div>}
            {saveSuccess && <div style={alertSuccess}>{saveSuccess}</div>}

            {/* Row 1: Title */}
            <div style={{ marginBottom: 10 }}>
              <label style={labelStyle}>Title *</label>
              <input value={form.title} onChange={(e) => setField("title", e.target.value)} style={inputStyle} placeholder="Book title" />
            </div>

            {/* Row 2: Authors */}
            <div style={{ marginBottom: 10 }}>
              <label style={labelStyle}>Author(s) *</label>
              <AuthorList names={form.authorNames} onChange={(v) => setField("authorNames", v)} />
            </div>

            {/* Row 3: 3-col grid */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "10px 16px", marginBottom: 10 }}>
              <div>
                <label style={labelStyle}>Category *</label>
                <select value={form.topLevelCategoryId} onChange={(e) => setField("topLevelCategoryId", e.target.value)} style={selectStyle}>
                  <option value="">-- Select --</option>
                  {categoryOptions.map((c) => (
                    <option key={c.id} value={c.id}>{c.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={labelStyle}>Ownership</label>
                <select value={form.ownershipStatusId} onChange={(e) => setField("ownershipStatusId", e.target.value)} style={selectStyle}>
                  {ownershipStatuses.map((s) => (
                    <option key={s.ownership_status_id} value={s.ownership_status_id}>{s.status_name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={labelStyle}>Read Status</label>
                <select value={form.readingStatusId} onChange={(e) => setField("readingStatusId", e.target.value)} style={selectStyle}>
                  <option value="">-- None --</option>
                  {readStatuses.map((s) => (
                    <option key={s.read_status_id} value={s.read_status_id}>{s.status_name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label style={labelStyle}>Format</label>
                <select value={form.formatDetailId} onChange={(e) => setField("formatDetailId", e.target.value)} style={selectStyle}>
                  <option value="">-- None --</option>
                  {formatDetails.map((f) => (
                    <option key={f.format_detail_id} value={f.format_detail_id}>{f.top_level_format} — {f.format_name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={labelStyle}>Age Level</label>
                <select value={form.ageLevelId} onChange={(e) => setField("ageLevelId", e.target.value)} style={selectStyle}>
                  <option value="">-- None --</option>
                  {ageLevels.map((a) => (
                    <option key={a.age_level_id} value={a.age_level_id}>{a.age_level_name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={labelStyle}>Star Rating</label>
                <select value={form.starRating} onChange={(e) => setField("starRating", e.target.value)} style={selectStyle}>
                  <option value="">-- None --</option>
                  {[1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5].map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Genres */}
            <div style={{ marginBottom: 10 }}>
              <label style={labelStyle}>Genres</label>
              <GenrePicker genres={genres} selected={form.genres} onChange={(v) => setField("genres", v)} />
            </div>

            {/* Series */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "10px 16px", marginBottom: 10 }}>
              <div>
                <label style={labelStyle}>Series</label>
                <input value={form.seriesName} onChange={(e) => setField("seriesName", e.target.value)} style={inputStyle} placeholder="Series name" />
              </div>
              <div style={{ width: 90 }}>
                <label style={labelStyle}>Book #</label>
                <input value={form.seriesNumber} onChange={(e) => setField("seriesNumber", e.target.value)} style={inputStyle} placeholder="e.g. 1" type="number" step="0.1" />
              </div>
            </div>

            {/* Tags */}
            <div style={{ marginBottom: 10 }}>
              <label style={labelStyle}>Tags <span style={{ fontWeight: "normal", color: "#888" }}>(comma-separated)</span></label>
              <input value={form.tagNames} onChange={(e) => setField("tagNames", e.target.value)} style={inputStyle} placeholder="e.g. magic system, cozy" />
            </div>

            {/* ISBN / Publisher row */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "10px 16px", marginBottom: 10 }}>
              <div>
                <label style={labelStyle}>ISBN-13</label>
                <input value={form.isbn13} onChange={(e) => setField("isbn13", e.target.value)} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>ISBN-10</label>
                <input value={form.isbn10} onChange={(e) => setField("isbn10", e.target.value)} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Language</label>
                <input value={form.language} onChange={(e) => setField("language", e.target.value)} style={inputStyle} placeholder="en" />
              </div>
              <div>
                <label style={labelStyle}>Publisher</label>
                <input value={form.publisher} onChange={(e) => setField("publisher", e.target.value)} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Published Date</label>
                <input value={form.publishedDate} onChange={(e) => setField("publishedDate", e.target.value)} style={inputStyle} placeholder="YYYY-MM-DD" />
              </div>
              <div>
                <label style={labelStyle}>Page Count</label>
                <input value={form.pageCount} onChange={(e) => setField("pageCount", e.target.value)} style={inputStyle} type="number" />
              </div>
            </div>

            {/* Cover URL */}
            <div style={{ marginBottom: 10 }}>
              <label style={labelStyle}>Cover Image URL</label>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input value={form.coverImageUrl} onChange={(e) => setField("coverImageUrl", e.target.value)} style={{ ...inputStyle, flex: 1 }} placeholder="https://..." />
                {form.coverImageUrl && (
                  <img src={form.coverImageUrl} alt="cover" style={{ height: 48, width: "auto", borderRadius: 2, border: "1px solid #ddd", flexShrink: 0 }} />
                )}
              </div>
            </div>

            {/* Description */}
            <div style={{ marginBottom: 10 }}>
              <label style={labelStyle}>Description</label>
              <textarea value={form.description} onChange={(e) => setField("description", e.target.value)} style={{ ...inputStyle, height: 60, resize: "vertical", fontFamily: "inherit" }} />
            </div>

            {/* Notes */}
            <div style={{ marginBottom: 16 }}>
              <label style={labelStyle}>Notes</label>
              <input value={form.notes} onChange={(e) => setField("notes", e.target.value)} style={inputStyle} />
            </div>

            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" onClick={handleSubmit} disabled={saving} style={btnPrimary}>
                {saving ? "Saving..." : "Add Book"}
              </button>
              <button type="button" onClick={resetForm} style={btnSecondary}>Clear</button>
            </div>
          </div>
        )}
      </div>
    </PageContainer>
  );
}
