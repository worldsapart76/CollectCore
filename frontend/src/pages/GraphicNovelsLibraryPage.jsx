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
  bulkDeleteGraphicNovels,
  bulkUpdateGraphicNovels,
  deleteGraphicNovel,
  fetchConsumptionStatuses,
  fetchGnEras,
  fetchGnFormatTypes,
  fetchGnPublishers,
  fetchOwnershipStatuses,
  fixGnCovers,
  getGraphicNovel,
  listGraphicNovels,
  updateGraphicNovel,
  fetchTopLevelCategories,
  uploadCover,
} from "../api";
import { getImageUrl } from "../utils/imageUrl";
import { labelStyle, inputStyle, selectStyle, btnPrimary, btnSecondary, btnSm, btnDanger, alertError, alertSuccess, GRID_SIZES } from "../styles/commonStyles";
import NameList from "../components/shared/NameList";
import { ToggleButton, SegmentedButtons } from "../components/shared/SegmentedButtons";
import { COLLECTION_TYPE_IDS } from "../constants/collectionTypes";

const HALF_STAR_OPTIONS = [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5];
const GN_COLLECTION_TYPE_CODE = "graphicnovels";

const OWNERSHIP_BADGE_COLORS = {
  O: "#00ff66", W: "#ffd600", T: "#ff3b3b", B: "#00bfff",
};

function OwnershipBadge({ statusName }) {
  if (!statusName) return null;
  const initial = statusName[0].toUpperCase();
  const color = OWNERSHIP_BADGE_COLORS[initial] || "#ffffff";
  return (
    <div style={{
      position: "absolute", bottom: 4, left: 4,
      background: "#000", color,
      fontWeight: 700, fontSize: 12, lineHeight: "12px",
      padding: "3px 5px", borderRadius: 4, zIndex: 2,
    }}>
      {initial}
    </div>
  );
}

// ─── Filter sidebar ───────────────────────────────────────────────────────────

function GnFilters({ items, publishers, formatTypes, eras, ownershipStatuses, readStatuses, categories, filters, onSectionChange, onClearAll }) {


  const allWriters = useMemo(() => {
    const seen = new Set();
    const result = [];
    for (const g of items) for (const w of (g.writers || [])) if (!seen.has(w)) { seen.add(w); result.push(w); }
    return result.sort().map((w) => ({ id: w, label: w }));
  }, [items]);

  const allArtists = useMemo(() => {
    const seen = new Set();
    const result = [];
    for (const g of items) for (const a of (g.artists || [])) if (!seen.has(a)) { seen.add(a); result.push(a); }
    return result.sort().map((a) => ({ id: a, label: a }));
  }, [items]);

  const allSeries = useMemo(() => {
    const seen = new Set();
    const result = [];
    for (const g of items) if (g.series_name && !seen.has(g.series_name)) { seen.add(g.series_name); result.push(g.series_name); }
    return result.sort().map((s) => ({ id: s, label: s }));
  }, [items]);

  const allSourceSeries = useMemo(() => {
    const seen = new Set();
    const result = [];
    for (const g of items) for (const s of (g.source_series || [])) {
      const name = s.source_series_name;
      if (name && !seen.has(name)) { seen.add(name); result.push(name); }
    }
    return result.sort().map((s) => ({ id: s, label: s }));
  }, [items]);

  const allTags = useMemo(() => {
    const seen = new Set();
    const result = [];
    for (const g of items) for (const t of (g.tags || [])) if (!seen.has(t)) { seen.add(t); result.push(t); }
    return result.sort().map((t) => ({ id: t, label: t }));
  }, [items]);

  const hasFilters = filters.search.trim() ||
    ["category", "ownership", "readStatus", "publisher", "formatType", "era", "writer", "artist", "series", "sourceSeries", "tag"]
      .some((k) => sectionActive(filters[k]));

  return (
    <FilterSidebarShell
      hasFilters={!!hasFilters}
      onClearAll={onClearAll}
      searchValue={filters.search}
      onSearch={(v) => onSectionChange("search", v)}
      searchPlaceholder="Search title, series, writer..."
    >
      {categories.length > 0 && (
        <TriStateFilterSection title="Publisher Group"
          items={categories.map((c) => ({ id: String(c.top_level_category_id), label: c.category_name }))}
          section={filters.category} onChange={(s) => onSectionChange("category", s)} />
      )}
      {formatTypes.length > 0 && (
        <TriStateFilterSection title="Format"
          items={formatTypes.map((f) => ({ id: String(f.format_type_id), label: f.format_type_name }))}
          section={filters.formatType} onChange={(s) => onSectionChange("formatType", s)} />
      )}
      {eras.length > 0 && (
        <TriStateFilterSection title="Era"
          items={eras.map((e) => ({ id: String(e.era_id), label: e.era_name }))}
          section={filters.era} onChange={(s) => onSectionChange("era", s)} />
      )}
      {allWriters.length > 0 && (
        <SearchableTriStateSection title="Writer" items={allWriters} selectedOnly
          section={filters.writer} onChange={(s) => onSectionChange("writer", s)} />
      )}
      {allArtists.length > 0 && (
        <SearchableTriStateSection title="Artist" items={allArtists} selectedOnly
          section={filters.artist} onChange={(s) => onSectionChange("artist", s)} />
      )}
      <TriStateFilterSection title="Read Status"
        items={readStatuses.map((s) => ({ id: String(s.read_status_id), label: s.status_name }))}
        section={filters.readStatus} onChange={(s) => onSectionChange("readStatus", s)} />
      <TriStateFilterSection title="Ownership" defaultShown={2}
        items={ownershipStatuses.map((s) => ({ id: String(s.ownership_status_id), label: s.status_name }))}
        section={filters.ownership} onChange={(s) => onSectionChange("ownership", s)} />
      {allSeries.length > 0 && (
        <SearchableTriStateSection title="Series" items={allSeries} selectedOnly
          section={filters.series} onChange={(s) => onSectionChange("series", s)} />
      )}
      {allSourceSeries.length > 0 && (
        <SearchableTriStateSection title="Source Series" items={allSourceSeries} selectedOnly
          section={filters.sourceSeries} onChange={(s) => onSectionChange("sourceSeries", s)} />
      )}
      {publishers.length > 0 && (
        <SearchableTriStateSection title="Publisher" items={publishers.map((p) => ({ id: String(p.publisher_id), label: p.publisher_name }))} selectedOnly
          section={filters.publisher} onChange={(s) => onSectionChange("publisher", s)} />
      )}
      {allTags.length > 0 && (
        <SearchableTriStateSection title="Tags" items={allTags} selectedOnly
          section={filters.tag} onChange={(s) => onSectionChange("tag", s)} />
      )}
    </FilterSidebarShell>
  );
}

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
    <div>
      <div style={{ display: "flex", gap: 4, marginBottom: 4 }}>
        <input value={input} onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
          placeholder="Add tag (e.g. Spider-Man, X-Men)..." style={{ ...inputStyle, flex: 1 }} />
        <button type="button" onClick={add} style={btnSm}>Add</button>
      </div>
      {tags.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
          {tags.map((t, i) => (
            <span key={i} style={{ fontSize: 11, padding: "2px 6px", background: "var(--green-light)", border: "1px solid var(--border-input)", borderRadius: 10, display: "flex", alignItems: "center", gap: 4, color: "var(--green)" }}>
              {t}
              <button type="button" onClick={() => onChange(tags.filter((_, j) => j !== i))} style={{ border: "none", background: "none", cursor: "pointer", fontSize: 11, color: "#555", padding: 0, lineHeight: 1 }}>✕</button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Source series list (edit modal) ─────────────────────────────────────────

function blankSourceSeriesEntry() {
  return { sourceSeriesName: "", startIssue: "", endIssue: "" };
}

function SourceSeriesList({ entries, onChange }) {
  function update(idx, key, val) {
    const next = entries.map((e, i) => i === idx ? { ...e, [key]: val } : e);
    onChange(next);
  }
  function add() { onChange([...entries, blankSourceSeriesEntry()]); }
  function remove(idx) { onChange(entries.filter((_, i) => i !== idx)); }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {entries.map((entry, i) => (
        <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 80px 80px auto", gap: 6, alignItems: "center" }}>
          <input
            value={entry.sourceSeriesName}
            onChange={(e) => update(i, "sourceSeriesName", e.target.value)}
            placeholder="e.g. Amazing Spider-Man vol. 1"
            style={inputStyle}
          />
          <input type="number" min="0" value={entry.startIssue} onChange={(e) => update(i, "startIssue", e.target.value)} placeholder="Start #" style={inputStyle} />
          <input type="number" min="0" value={entry.endIssue} onChange={(e) => update(i, "endIssue", e.target.value)} placeholder="End #" style={inputStyle} />
          {entries.length > 1
            ? <button type="button" onClick={() => remove(i)} style={{ ...btnSm, color: "#c62828" }}>✕</button>
            : <span style={{ width: 26 }} />
          }
        </div>
      ))}
      <div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 11, color: "var(--text-secondary)" }}>
        <button type="button" onClick={add} style={{ ...btnSm, alignSelf: "flex-start" }}>+ Series</button>
        <span>Series name · Start # · End #</span>
      </div>
    </div>
  );
}

// ─── Detail / Edit modal ──────────────────────────────────────────────────────

function GnDetailModal({ itemId, publishers, formatTypes, eras, ownershipStatuses, readStatuses, categories, onClose, onSaved, onDeleted }) {


  const [gn, setGn] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [ownershipId, setOwnershipId] = useState("");
  const [readStatusId, setReadStatusId] = useState("");
  const [publisherId, setPublisherId] = useState("");
  const [formatTypeId, setFormatTypeId] = useState("");
  const [eraId, setEraId] = useState("");
  const [seriesName, setSeriesName] = useState("");
  const [seriesNumber, setSeriesNumber] = useState("");
  const [sourceSeries, setSourceSeries] = useState([blankSourceSeriesEntry()]);
  const [issueNotes, setIssueNotes] = useState("");
  const [pageCount, setPageCount] = useState("");
  const [publishedDate, setPublishedDate] = useState("");
  const [isbn13, setIsbn13] = useState("");
  const [isbn10, setIsbn10] = useState("");
  const [coverImageUrl, setCoverImageUrl] = useState("");
  const coverFileRef = useRef(null);

  async function handleCoverFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const { url } = await uploadCover(file, "gn", itemId);
      setCoverImageUrl(url);
    } catch (err) {
      setError(err.message || "Cover upload failed.");
    }
    if (coverFileRef.current) coverFileRef.current.value = "";
  }

  const [editionNotes, setEditionNotes] = useState("");
  const [starRating, setStarRating] = useState("");
  const [review, setReview] = useState("");
  const [notes, setNotes] = useState("");
  const [writers, setWriters] = useState([""]);
  const [artists, setArtists] = useState([""]);
  const [tags, setTags] = useState([]);

  useEffect(() => {
    getGraphicNovel(itemId).then((data) => {
      setGn(data);
      setTitle(data.title || "");
      setDescription(data.description || "");
      setCategoryId(String(data.top_level_category_id || ""));
      setOwnershipId(String(data.ownership_status_id || ""));
      setReadStatusId(data.reading_status_id ? String(data.reading_status_id) : "");
      setPublisherId(data.publisher_id ? String(data.publisher_id) : "");
      setFormatTypeId(data.format_type_id ? String(data.format_type_id) : "");
      setEraId(data.era_id ? String(data.era_id) : "");
      setSeriesName(data.series_name || "");
      setSeriesNumber(data.series_number != null ? String(data.series_number) : "");
      setSourceSeries(
        data.source_series?.length
          ? data.source_series.map((s) => ({
              sourceSeriesName: s.source_series_name || "",
              startIssue: s.start_issue != null ? String(s.start_issue) : "",
              endIssue: s.end_issue != null ? String(s.end_issue) : "",
            }))
          : [blankSourceSeriesEntry()]
      );
      setIssueNotes(data.issue_notes || "");
      setPageCount(data.page_count != null ? String(data.page_count) : "");
      setPublishedDate(data.published_date || "");
      setIsbn13(data.isbn_13 || "");
      setIsbn10(data.isbn_10 || "");
      setCoverImageUrl(data.cover_image_url || "");
      setEditionNotes(data.edition_notes || "");
      setStarRating(data.star_rating != null ? String(data.star_rating) : "");
      setReview(data.review || "");
      setNotes(data.notes || "");
      setWriters(data.writers?.length ? data.writers.map((w) => w.writer_name) : [""]);
      setArtists(data.artists?.length ? data.artists.map((a) => a.artist_name) : [""]);
      setTags(data.tags?.map((t) => t.tag_name) || []);
      setLoading(false);
    }).catch((e) => { setError(e.message); setLoading(false); });
  }, [itemId]);

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const sourceSeriesPayload = sourceSeries
        .filter((s) => s.sourceSeriesName.trim())
        .map((s) => ({
          source_series_name: s.sourceSeriesName.trim(),
          start_issue: s.startIssue ? parseInt(s.startIssue) : null,
          end_issue: s.endIssue ? parseInt(s.endIssue) : null,
        }));

      await updateGraphicNovel(itemId, {
        top_level_category_id: Number(categoryId),
        ownership_status_id: Number(ownershipId),
        reading_status_id: readStatusId ? Number(readStatusId) : null,
        notes: notes || null,
        title,
        description: description || null,
        publisher_id: publisherId ? Number(publisherId) : null,
        format_type_id: formatTypeId ? Number(formatTypeId) : null,
        era_id: eraId ? Number(eraId) : null,
        series_name: seriesName || null,
        series_number: seriesNumber ? parseFloat(seriesNumber) : null,
        source_series: sourceSeriesPayload,
        issue_notes: issueNotes || null,
        page_count: pageCount ? parseInt(pageCount) : null,
        published_date: publishedDate || null,
        isbn_13: isbn13 || null,
        isbn_10: isbn10 || null,
        cover_image_url: coverImageUrl || null,
        edition_notes: editionNotes || null,
        star_rating: starRating ? parseFloat(starRating) : null,
        review: review || null,
        writer_names: writers.filter((w) => w.trim()),
        artist_names: artists.filter((a) => a.trim()),
        tag_names: tags,
      });
      setSuccess("Saved.");
      onSaved?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!confirmDelete) { setConfirmDelete(true); return; }
    setDeleting(true);
    try {
      await deleteGraphicNovel(itemId);
      onDeleted?.();
    } catch (e) {
      setError(e.message);
      setDeleting(false);
    }
  }

  const row2 = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: "#fff", borderRadius: 6, width: 700, maxWidth: "95vw", maxHeight: "90vh", display: "flex", flexDirection: "column", boxShadow: "0 4px 24px rgba(0,0,0,0.18)" }}>
        <div style={{ padding: "12px 16px", borderBottom: "1px solid #e0e0e0", display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
          <div style={{ fontWeight: "bold", fontSize: 14 }}>{loading ? "Loading..." : title || "Graphic Novel Detail"}</div>
          <button type="button" onClick={onClose} style={{ ...btnSm, fontSize: 14, padding: "2px 8px" }}>✕</button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
          {loading && <div style={{ color: "#999" }}>Loading…</div>}
          {error && <div style={alertError}>{error}</div>}
          {success && <div style={alertSuccess}>{success}</div>}

          {!loading && (
            <form id="gn-edit-form" onSubmit={handleSave}>
              {coverImageUrl && (
                <div style={{ display: "flex", gap: 12, marginBottom: 14 }}>
                  <img src={getImageUrl(coverImageUrl)} alt="cover" style={{ height: 100, width: "auto", borderRadius: 3, border: "1px solid #ddd", flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: "bold", fontSize: 14, marginBottom: 2 }}>{title}</div>
                    <div style={{ fontSize: 12, color: "#555" }}>{writers.filter(Boolean).join(", ")}</div>
                  </div>
                </div>
              )}

              <div style={{ marginBottom: 10 }}>
                <label style={labelStyle}>Title *</label>
                <input value={title} onChange={(e) => setTitle(e.target.value)} required style={inputStyle} />
              </div>

              <div style={{ ...row2, marginBottom: 10 }}>
                <div>
                  <label style={labelStyle}>Publisher Group *</label>
                  <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} required style={selectStyle}>
                    <option value="">-- Select --</option>
                    {categories.map((c) => <option key={c.top_level_category_id} value={c.top_level_category_id}>{c.category_name}</option>)}
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Ownership *</label>
                  <select value={ownershipId} onChange={(e) => setOwnershipId(e.target.value)} required style={selectStyle}>
                    <option value="">-- Select --</option>
                    {ownershipStatuses.map((s) => <option key={s.ownership_status_id} value={s.ownership_status_id}>{s.status_name}</option>)}
                  </select>
                </div>
              </div>

              <div style={{ ...row2, marginBottom: 10 }}>
                <div>
                  <label style={labelStyle}>Publisher</label>
                  <select value={publisherId} onChange={(e) => setPublisherId(e.target.value)} style={selectStyle}>
                    <option value="">-- None --</option>
                    {publishers.map((p) => <option key={p.publisher_id} value={p.publisher_id}>{p.publisher_name}</option>)}
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Format Type</label>
                  <select value={formatTypeId} onChange={(e) => setFormatTypeId(e.target.value)} style={selectStyle}>
                    <option value="">-- None --</option>
                    {formatTypes.map((f) => <option key={f.format_type_id} value={f.format_type_id}>{f.format_type_name}</option>)}
                  </select>
                </div>
              </div>

              <div style={{ ...row2, marginBottom: 10 }}>
                <div>
                  <label style={labelStyle}>Era</label>
                  <select value={eraId} onChange={(e) => setEraId(e.target.value)} style={selectStyle}>
                    <option value="">-- None --</option>
                    {eras.map((e) => <option key={e.era_id} value={e.era_id}>{e.era_name}{e.era_years ? ` (${e.era_years})` : ""}</option>)}
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Read Status</label>
                  <select value={readStatusId} onChange={(e) => setReadStatusId(e.target.value)} style={selectStyle}>
                    <option value="">-- None --</option>
                    {readStatuses.map((s) => <option key={s.read_status_id} value={s.read_status_id}>{s.status_name}</option>)}
                  </select>
                </div>
              </div>

              <div style={{ ...row2, marginBottom: 10 }}>
                <div>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 3 }}>
                    <label style={{ ...labelStyle, marginBottom: 0 }}>Series Name</label>
                    {title.trim() && (
                      <button type="button" onClick={() => setSeriesName(title.trim())} style={{ ...btnSm, fontSize: 10 }} title="Copy title to series name">
                        ← Copy Title
                      </button>
                    )}
                  </div>
                  <input value={seriesName} onChange={(e) => setSeriesName(e.target.value)} placeholder="e.g. Amazing Spider-Man Omnibus" style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>Volume #</label>
                  <input type="number" min="0" step="0.5" value={seriesNumber} onChange={(e) => setSeriesNumber(e.target.value)} style={inputStyle} />
                </div>
              </div>

              <div style={{ marginBottom: 10 }}>
                <label style={labelStyle}>Source Series (comic run collected)</label>
                <SourceSeriesList entries={sourceSeries} onChange={setSourceSeries} />
              </div>

              <div style={{ marginBottom: 10 }}>
                <label style={labelStyle}>Issue Notes (annuals, crossovers, etc.)</label>
                <input value={issueNotes} onChange={(e) => setIssueNotes(e.target.value)} placeholder="e.g. + Annual #1, King-Size Special #1" style={inputStyle} />
              </div>

              <div style={{ marginBottom: 10 }}>
                <label style={labelStyle}>Writer(s)</label>
                <NameList names={writers} onChange={setWriters} placeholder="Writer name" />
              </div>
              <div style={{ marginBottom: 10 }}>
                <label style={labelStyle}>Artist(s)</label>
                <NameList names={artists} onChange={setArtists} placeholder="Artist name" />
              </div>
              <div style={{ marginBottom: 10 }}>
                <label style={labelStyle}>Tags (characters, teams, arcs)</label>
                <TagInput tags={tags} onChange={setTags} />
              </div>

              <div style={{ ...row2, marginBottom: 10 }}>
                <div>
                  <label style={labelStyle}>Published Date</label>
                  <input value={publishedDate} onChange={(e) => setPublishedDate(e.target.value)} placeholder="YYYY or YYYY-MM-DD" style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>Page Count</label>
                  <input type="number" min="0" value={pageCount} onChange={(e) => setPageCount(e.target.value)} style={inputStyle} />
                </div>
              </div>

              <div style={{ ...row2, marginBottom: 10 }}>
                <div>
                  <label style={labelStyle}>ISBN-13</label>
                  <input value={isbn13} onChange={(e) => setIsbn13(e.target.value)} style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>ISBN-10</label>
                  <input value={isbn10} onChange={(e) => setIsbn10(e.target.value)} style={inputStyle} />
                </div>
              </div>

              <div style={{ marginBottom: 10 }}>
                <label style={labelStyle}>Cover Image URL</label>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input value={coverImageUrl} onChange={(e) => setCoverImageUrl(e.target.value)} style={{ ...inputStyle, flex: 1 }} />
                  <input type="file" accept="image/*" ref={coverFileRef} onChange={handleCoverFile} style={{ display: "none" }} />
                  <button type="button" onClick={() => coverFileRef.current?.click()} style={{ padding: "4px 10px", fontSize: 12, whiteSpace: "nowrap" }}>Add Image</button>
                  {coverImageUrl && <img src={getImageUrl(coverImageUrl)} alt="cover" style={{ height: 40, width: "auto", borderRadius: 2, border: "1px solid #ddd", flexShrink: 0 }} />}
                </div>
              </div>

              <div style={{ marginBottom: 10 }}>
                <label style={labelStyle}>Edition Notes</label>
                <input value={editionNotes} onChange={(e) => setEditionNotes(e.target.value)} placeholder="e.g. First Printing, 2019 Reprint" style={inputStyle} />
              </div>

              <div style={{ ...row2, marginBottom: 10 }}>
                <div>
                  <label style={labelStyle}>Star Rating</label>
                  <select value={starRating} onChange={(e) => setStarRating(e.target.value)} style={selectStyle}>
                    <option value="">-- None --</option>
                    {HALF_STAR_OPTIONS.map((v) => <option key={v} value={v}>{v}</option>)}
                  </select>
                </div>
              </div>

              <div style={{ marginBottom: 10 }}>
                <label style={labelStyle}>Review</label>
                <textarea value={review} onChange={(e) => setReview(e.target.value)} rows={2} style={{ ...inputStyle, resize: "vertical" }} />
              </div>
              <div style={{ marginBottom: 10 }}>
                <label style={labelStyle}>Notes</label>
                <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} style={{ ...inputStyle, resize: "vertical" }} />
              </div>

              <div style={{ marginBottom: 10 }}>
                <label style={labelStyle}>Description</label>
                <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} style={{ ...inputStyle, resize: "vertical" }} />
              </div>
            </form>
          )}
        </div>

        {!loading && (
          <div style={{ padding: "10px 16px", borderTop: "1px solid #e0e0e0", display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
            <div>
              {!confirmDelete
                ? <button type="button" onClick={handleDelete} style={btnDanger}>Delete</button>
                : <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <span style={{ fontSize: 12, color: "#c62828" }}>Delete this item?</span>
                    <button type="button" onClick={handleDelete} disabled={deleting} style={btnDanger}>{deleting ? "Deleting..." : "Confirm"}</button>
                    <button type="button" onClick={() => setConfirmDelete(false)} style={btnSecondary}>Cancel</button>
                  </div>
              }
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" onClick={onClose} style={btnSecondary}>Cancel</button>
              <button type="submit" form="gn-edit-form" disabled={saving} style={btnPrimary}>{saving ? "Saving..." : "Save"}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Bulk edit panel ──────────────────────────────────────────────────────────

function BulkField({ label, enabled, onToggle, children }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ display: "flex", alignItems: "center", cursor: "pointer" }}>
        <input type="checkbox" checked={enabled} onChange={onToggle} style={{ marginRight: 8 }} />
        <span style={{ fontWeight: "bold", fontSize: 13 }}>{label}</span>
      </label>
      {enabled && <div style={{ marginTop: 5, paddingLeft: 24 }}>{children}</div>}
    </div>
  );
}

function GnBulkEdit({ selectedIds, publishers, formatTypes, eras, ownershipStatuses, readStatuses, onClose, onSaved, onDeleted }) {
  const fieldStyle = { width: "100%", padding: "5px 6px", fontSize: 13, border: "1px solid #ccc", borderRadius: 3 };

  const [updateOwnership, setUpdateOwnership] = useState(false);
  const [ownershipId, setOwnershipId] = useState(String(ownershipStatuses[0]?.ownership_status_id || ""));
  const [updateReadStatus, setUpdateReadStatus] = useState(false);
  const [readStatusId, setReadStatusId] = useState(String(readStatuses[0]?.read_status_id || ""));
  const [updatePublisher, setUpdatePublisher] = useState(false);
  const [publisherId, setPublisherId] = useState(String(publishers[0]?.publisher_id || ""));
  const [updateFormat, setUpdateFormat] = useState(false);
  const [formatTypeId, setFormatTypeId] = useState(String(formatTypes[0]?.format_type_id || ""));
  const [updateEra, setUpdateEra] = useState(false);
  const [eraId, setEraId] = useState(String(eras[0]?.era_id || ""));

  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState("");

  const anyEnabled = updateOwnership || updateReadStatus || updatePublisher || updateFormat || updateEra;

  async function handleSave() {
    if (!anyEnabled) { setError("Select at least one field to update."); return; }
    const fields = {};
    if (updateOwnership) fields.ownership_status_id = Number(ownershipId);
    if (updateReadStatus) fields.reading_status_id = Number(readStatusId);
    if (updatePublisher) fields.publisher_id = Number(publisherId);
    if (updateFormat) fields.format_type_id = Number(formatTypeId);
    if (updateEra) fields.era_id = Number(eraId);
    setSaving(true); setError("");
    try { await bulkUpdateGraphicNovels(selectedIds, fields); onSaved(); }
    catch (e) { setError(e.message || "Failed to update"); }
    finally { setSaving(false); }
  }

  async function handleDelete() {
    if (!confirmDelete) { setConfirmDelete(true); return; }
    setDeleting(true);
    try { await bulkDeleteGraphicNovels(selectedIds); onDeleted(); }
    catch (e) { setError(e.message || "Failed to delete"); setConfirmDelete(false); }
    finally { setDeleting(false); }
  }

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: "#fff", border: "1px solid #ddd", borderRadius: 6, width: 420, maxHeight: "85vh", display: "flex", flexDirection: "column", boxShadow: "0 2px 12px rgba(0,0,0,0.15)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", borderBottom: "1px solid #e0e0e0", flexShrink: 0 }}>
          <span style={{ fontWeight: "bold", fontSize: 14 }}>Bulk Edit — {selectedIds.length} items</span>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 15, cursor: "pointer", color: "#666" }}>✕</button>
        </div>
        {error && <div style={{ margin: "8px 14px 0", padding: "7px 10px", background: "#ffebee", border: "1px solid #c62828", borderRadius: 3, fontSize: 13, color: "#c62828", flexShrink: 0 }}>{error}</div>}
        <div style={{ padding: "12px 14px", overflowY: "auto", flex: 1 }}>
          <BulkField label="Ownership" enabled={updateOwnership} onToggle={() => setUpdateOwnership((p) => !p)}>
            <select value={ownershipId} onChange={(e) => setOwnershipId(e.target.value)} style={fieldStyle}>
              {ownershipStatuses.map((s) => <option key={s.ownership_status_id} value={s.ownership_status_id}>{s.status_name}</option>)}
            </select>
          </BulkField>
          <BulkField label="Read Status" enabled={updateReadStatus} onToggle={() => setUpdateReadStatus((p) => !p)}>
            <select value={readStatusId} onChange={(e) => setReadStatusId(e.target.value)} style={fieldStyle}>
              {readStatuses.map((s) => <option key={s.read_status_id} value={s.read_status_id}>{s.status_name}</option>)}
            </select>
          </BulkField>
          <BulkField label="Publisher" enabled={updatePublisher} onToggle={() => setUpdatePublisher((p) => !p)}>
            <select value={publisherId} onChange={(e) => setPublisherId(e.target.value)} style={fieldStyle}>
              {publishers.map((p) => <option key={p.publisher_id} value={p.publisher_id}>{p.publisher_name}</option>)}
            </select>
          </BulkField>
          <BulkField label="Format" enabled={updateFormat} onToggle={() => setUpdateFormat((p) => !p)}>
            <select value={formatTypeId} onChange={(e) => setFormatTypeId(e.target.value)} style={fieldStyle}>
              {formatTypes.map((f) => <option key={f.format_type_id} value={f.format_type_id}>{f.format_type_name}</option>)}
            </select>
          </BulkField>
          <BulkField label="Era" enabled={updateEra} onToggle={() => setUpdateEra((p) => !p)}>
            <select value={eraId} onChange={(e) => setEraId(e.target.value)} style={fieldStyle}>
              {eras.map((e) => <option key={e.era_id} value={e.era_id}>{e.era_name}</option>)}
            </select>
          </BulkField>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", borderTop: "1px solid #e0e0e0", flexShrink: 0 }}>
          <div>
            {!confirmDelete
              ? <button onClick={handleDelete} disabled={deleting || saving} style={{ padding: "5px 12px", fontSize: 13, cursor: "pointer", border: "1px solid #c62828", borderRadius: 3, background: "#fff", color: "#c62828" }}>Delete {selectedIds.length} item{selectedIds.length !== 1 ? "s" : ""}</button>
              : <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                  <span style={{ color: "#c62828", fontWeight: "bold" }}>Delete {selectedIds.length}?</span>
                  <button onClick={handleDelete} disabled={deleting} style={{ padding: "5px 10px", fontSize: 13, cursor: "pointer", border: "none", borderRadius: 3, background: "#c62828", color: "#fff" }}>{deleting ? "..." : "Yes"}</button>
                  <button onClick={() => setConfirmDelete(false)} style={{ padding: "5px 10px", fontSize: 13, cursor: "pointer", border: "1px solid #ccc", borderRadius: 3, background: "#fff" }}>No</button>
                </span>
            }
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={onClose} style={{ padding: "5px 12px", fontSize: 13, cursor: "pointer", border: "1px solid #ccc", borderRadius: 3, background: "#fff" }}>Cancel</button>
            <button onClick={handleSave} disabled={saving || deleting} style={{ padding: "5px 16px", fontSize: 13, cursor: "pointer", border: "1px solid #1565c0", borderRadius: 3, background: "#1565c0", color: "#fff", fontWeight: "bold" }}>{saving ? "Saving..." : `Apply to ${selectedIds.length}`}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Issue range display ──────────────────────────────────────────────────────

function SourceSeriesDisplay({ sourceSeries, issueNotes }) {
  if (!sourceSeries?.length && !issueNotes) return <span style={{ color: "var(--text-label)", fontSize: 11 }}>—</span>;
  return (
    <div style={{ fontSize: 11 }}>
      {sourceSeries?.map((s, i) => {
        const range = s.start_issue != null
          ? (s.end_issue != null && s.end_issue !== s.start_issue ? `#${s.start_issue}–${s.end_issue}` : `#${s.start_issue}`)
          : "";
        return (
          <div key={i}>{s.source_series_name}{range ? ` ${range}` : ""}</div>
        );
      })}
      {issueNotes && <div style={{ color: "var(--text-secondary)" }}>{issueNotes}</div>}
    </div>
  );
}

// ─── Grid view helpers ────────────────────────────────────────────────────────

const GnGridItem = memo(function GnGridItem({ gn, isSelected, onToggleSelect, onClick, gridSize, showCaptions }) {
  const { w, h } = GRID_SIZES[gridSize];
  return (
    <div onClick={(e) => { if (e.target.type !== "checkbox") onClick(); }} style={{
      position: "relative", cursor: "pointer", width: w, flexShrink: 0,
      outline: isSelected ? "2px solid var(--btn-primary-bg)" : "2px solid transparent",
      borderRadius: 3, boxSizing: "border-box",
    }}>
      <div style={{ position: "relative", width: w, height: h }}>
        <div style={{ position: "absolute", top: 4, left: 4, zIndex: 2 }}>
          <input type="checkbox" checked={isSelected}
            onChange={() => onToggleSelect(gn.item_id)}
            onClick={(e) => e.stopPropagation()}
            style={{ margin: 0, cursor: "pointer" }} />
        </div>
        <OwnershipBadge statusName={gn.ownership_status} />
        {gn.cover_image_url ? (
          <img src={getImageUrl(gn.cover_image_url)} alt="" style={{ width: w, height: h, objectFit: "cover", display: "block", borderRadius: 2 }} />
        ) : (
          <div style={{ width: w, height: h, background: "var(--bg-surface)", borderRadius: 2, border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ fontSize: 10, color: "var(--text-secondary)" }}>No Cover</span>
          </div>
        )}
      </div>
      {showCaptions && (
        <div style={{ padding: "3px 2px 0", maxWidth: w }}>
          <div style={{ fontSize: 11, fontWeight: "700", lineHeight: "1.3", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-primary)" }}>{gn.title}</div>
          {gn.series_name && (
            <div style={{ fontSize: 10, color: "var(--text-secondary)", lineHeight: "1.3", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {gn.series_name}{gn.series_number != null ? ` Vol. ${gn.series_number}` : ""}
            </div>
          )}
        </div>
      )}
    </div>
  );
});

// ─── Main page ────────────────────────────────────────────────────────────────

function makeEmptyFilters() {
  return {
    search: "",
    category: emptySection(),
    ownership: emptySection(),
    readStatus: emptySection(),
    publisher: emptySection(),
    formatType: emptySection(),
    era: emptySection(),
    writer: emptySection(),
    artist: emptySection(),
    series: emptySection(),
    sourceSeries: emptySection(),
    tag: emptySection(),
  };
}

export default function GraphicNovelsLibraryPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [publishers, setPublishers] = useState([]);
  const [formatTypes, setFormatTypes] = useState([]);
  const [eras, setEras] = useState([]);
  const [ownershipStatuses, setOwnershipStatuses] = useState([]);
  const [readStatuses, setReadStatuses] = useState([]);
  const [categories, setCategories] = useState([]);

  const [filters, setFilters] = useState(makeEmptyFilters);
  const [sortKey, setSortKey] = useState("title");
  const [sortDir, setSortDir] = useState("asc");
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [activeItemId, setActiveItemId] = useState(null);

  const [pageTab, setPageTab] = useState("library"); // "library" | "sourceSeries"
  const [viewMode, setViewMode] = useState("table");
  const [showThumbnails, setShowThumbnails] = useState(false);
  const [gridSize, setGridSize] = useState("m");
  const [showCaptions, setShowCaptions] = useState(true);
  const [sourceSeriesSearch, setSourceSeriesSearch] = useState("");

  const [colWidths, setColWidths] = useState({
    title: 220, writers: 130, artists: 110, publisher: 110, format: 90, era: 80, sourceSeries: 160, read: 90, own: 90,
  });
  const [ssColWidths, setSSColWidths] = useState({
    series: 200, issues: 90, title: 240, publisher: 130, format: 100, own: 90,
  });
  const [ssSortKey, setSSSort] = useState("series");
  const [ssSortDir, setSSSortDir] = useState("asc");
  const [fixingCovers, setFixingCovers] = useState(false);
  const [fixCoversResult, setFixCoversResult] = useState(null);
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

  const makeSSResizeHandler = useCallback((col) => (e) => {
    e.preventDefault();
    colResizingRef.current = true;
    const startX = e.clientX;
    const startW = ssColWidths[col];
    function onMove(ev) {
      setSSColWidths((prev) => ({ ...prev, [col]: Math.max(50, startW + ev.clientX - startX) }));
    }
    function onUp() {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      setTimeout(() => { colResizingRef.current = false; }, 0);
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [ssColWidths]);

  const load = useCallback(async () => {
    try {
      const data = await listGraphicNovels();
      setItems(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    Promise.all([
      load(),
      fetchGnPublishers().then(setPublishers),
      fetchGnFormatTypes().then(setFormatTypes),
      fetchGnEras().then(setEras),
      fetchOwnershipStatuses(COLLECTION_TYPE_IDS.graphicnovels).then(setOwnershipStatuses),
      fetchConsumptionStatuses(COLLECTION_TYPE_IDS.graphicnovels).then(setReadStatuses),
      fetchTopLevelCategories(GN_COLLECTION_TYPE_CODE).then(setCategories),
    ]).catch(err => console.error("Failed to load GN data:", err));
  }, [load]);

  function handleSectionChange(key, val) {
    setFilters((prev) => ({ ...prev, [key]: val }));
  }

  function clearAllFilters() {
    setFilters(makeEmptyFilters());
  }

  const filtered = useMemo(() => {
    return items.filter((g) => {
      const q = filters.search.trim().toLowerCase();
      if (q) {
        const hay = [g.title, g.series_name, ...(g.source_series || []).map((s) => s.source_series_name), ...(g.writers || []), ...(g.artists || [])].filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (!applySection(filters.category, [String(g.top_level_category_id)])) return false;
      if (!applySection(filters.ownership, [String(g.ownership_status_id)])) return false;
      if (!applySection(filters.readStatus, [g.reading_status_id != null ? String(g.reading_status_id) : ""])) return false;
      if (!applySection(filters.publisher, [g.publisher_id != null ? String(g.publisher_id) : ""])) return false;
      if (!applySection(filters.formatType, [g.format_type_id != null ? String(g.format_type_id) : ""])) return false;
      if (!applySection(filters.era, [g.era_id != null ? String(g.era_id) : ""])) return false;
      if (!applySection(filters.writer, g.writers || [])) return false;
      if (!applySection(filters.artist, g.artists || [])) return false;
      if (!applySection(filters.series, g.series_name ? [g.series_name] : [])) return false;
      if (!applySection(filters.sourceSeries, (g.source_series || []).map((s) => s.source_series_name).filter(Boolean))) return false;
      if (!applySection(filters.tag, g.tags || [])) return false;
      return true;
    });
  }, [items, filters]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      let va, vb;
      if (sortKey === "title") { va = a.title_sort || a.title || ""; vb = b.title_sort || b.title || ""; }
      else if (sortKey === "publisher") { va = a.publisher_name || ""; vb = b.publisher_name || ""; }
      else if (sortKey === "era") { va = a.era_name || ""; vb = b.era_name || ""; }
      else if (sortKey === "format") { va = a.format_type_name || ""; vb = b.format_type_name || ""; }
      else if (sortKey === "series") { va = `${a.series_name || ""}${String(a.series_number ?? 9999).padStart(6, "0")}`; vb = `${b.series_name || ""}${String(b.series_number ?? 9999).padStart(6, "0")}`; }
      else { va = ""; vb = ""; }
      const cmp = va.toString().toLowerCase().localeCompare(vb.toString().toLowerCase());
      return sortDir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [filtered, sortKey, sortDir]);

  const sourceSeriesRows = useMemo(() => {
    const rows = [];
    for (const g of filtered) {
      for (const s of (g.source_series || [])) {
        if (!s.source_series_name) continue;
        rows.push({ entry: s, gn: g });
      }
    }
    return rows;
  }, [filtered]);

  const visibleSourceSeriesRows = useMemo(() => {
    const q = sourceSeriesSearch.trim().toLowerCase();
    const base = q
      ? sourceSeriesRows.filter((r) => r.entry.source_series_name.toLowerCase().includes(q))
      : sourceSeriesRows;
    const sorted = [...base];
    sorted.sort((a, b) => {
      let va, vb;
      if (ssSortKey === "series") { va = a.entry.source_series_name; vb = b.entry.source_series_name; }
      else if (ssSortKey === "issues") { va = a.entry.start_issue ?? -1; vb = b.entry.start_issue ?? -1; }
      else if (ssSortKey === "title") { va = a.gn.title_sort || a.gn.title || ""; vb = b.gn.title_sort || b.gn.title || ""; }
      else if (ssSortKey === "publisher") { va = a.gn.publisher_name || ""; vb = b.gn.publisher_name || ""; }
      else { va = ""; vb = ""; }
      const cmp = typeof va === "number"
        ? va - vb
        : va.toString().toLowerCase().localeCompare(vb.toString().toLowerCase());
      return ssSortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [sourceSeriesRows, sourceSeriesSearch, ssSortKey, ssSortDir]);

  function toggleSSSort(key) {
    if (ssSortKey === key) setSSSortDir((d) => d === "asc" ? "desc" : "asc");
    else { setSSSort(key); setSSSortDir("asc"); }
  }

  async function handleFixCovers() {
    setFixingCovers(true);
    setFixCoversResult(null);
    try {
      const r = await fixGnCovers();
      setFixCoversResult(`Fixed ${r.fixed} cover${r.fixed !== 1 ? "s" : ""}${r.failed?.length ? ` (${r.failed.length} failed)` : ""}.`);
      load();
    } catch (e) {
      setFixCoversResult(`Error: ${e.message}`);
    } finally {
      setFixingCovers(false);
    }
  }

  function ssSortArrow(key) {
    if (ssSortKey !== key) return null;
    return <span style={{ marginLeft: 3, fontSize: 10 }}>{ssSortDir === "asc" ? "▲" : "▼"}</span>;
  }

  function toggleSort(key) {
    if (sortKey === key) setSortDir((d) => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("asc"); }
  }

  function toggleSelect(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function clearSelection() { setSelectedIds(new Set()); }

  function toggleSelectAll() {
    if (sorted.length > 0 && sorted.every((g) => selectedIds.has(g.item_id))) clearSelection();
    else setSelectedIds(new Set(sorted.map((g) => g.item_id)));
  }

  const allVisibleSelected = sorted.length > 0 && sorted.every((g) => selectedIds.has(g.item_id));

  function sortArrow(key) {
    if (sortKey !== key) return null;
    return <span style={{ marginLeft: 3, fontSize: 10 }}>{sortDir === "asc" ? "▲" : "▼"}</span>;
  }

  const colKeys = ["title", "writers", "artists", "publisher", "format", "era", "sourceSeries", "read", "own"];

  const thBase = {
    textAlign: "left",
    fontSize: 11,
    fontWeight: "bold",
    color: "var(--text-secondary)",
    padding: "4px 8px",
    whiteSpace: "nowrap",
    userSelect: "none",
    background: "var(--bg-sidebar)",
    borderBottom: "1px solid var(--border)",
    position: "relative",
    overflow: "hidden",
    borderRight: "1px solid var(--border)",
  };

  const tdStyle = { fontSize: 12, padding: "4px 8px", verticalAlign: "top", borderBottom: "1px solid var(--border)", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" };

  const headers = [
    { key: "title", label: "Title / Series", sortKey: "title" },
    { key: "writers", label: "Writer(s)", sortKey: null },
    { key: "artists", label: "Artist(s)", sortKey: null },
    { key: "publisher", label: "Publisher", sortKey: "publisher" },
    { key: "format", label: "Format", sortKey: "format" },
    { key: "era", label: "Era", sortKey: "era" },
    { key: "sourceSeries", label: "Source Series", sortKey: null },
    { key: "read", label: "Read", sortKey: null },
    { key: "own", label: "Own", sortKey: null },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Controls bar */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 12px", borderBottom: "1px solid var(--border-card)", background: "var(--bg-surface)", flexShrink: 0, gap: 8, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <SegmentedButtons
            options={[{ value: "library", label: "Library" }, { value: "sourceSeries", label: "Source Series" }]}
            value={pageTab} onChange={setPageTab} />
          <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>
            {loading ? "Loading…" : pageTab === "library"
              ? `${sorted.length} of ${items.length} items`
              : `${visibleSourceSeriesRows.length} entries`}
          </span>
          {pageTab === "library" && selectedIds.size > 0 && (
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 12, color: "var(--btn-primary-bg)", fontWeight: "bold" }}>{selectedIds.size} selected</span>
              <button onClick={() => setBulkEditOpen(true)} style={{ ...btnPrimary, fontSize: 12, padding: "3px 10px" }}>Edit</button>
              <button onClick={clearSelection} style={{ ...btnSecondary, fontSize: 12, padding: "3px 8px" }}>Clear</button>
            </span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {pageTab === "library" && (
            <>
              <SegmentedButtons
                options={[{ value: "table", label: "Table" }, { value: "grid", label: "Grid" }]}
                value={viewMode} onChange={setViewMode} />
              {viewMode === "table" && (
                <ToggleButton active={showThumbnails} onClick={() => setShowThumbnails((p) => !p)}>Thumbnails</ToggleButton>
              )}
              {viewMode === "grid" && (
                <>
                  <SegmentedButtons
                    options={[{ value: "s", label: "S" }, { value: "m", label: "M" }, { value: "l", label: "L" }]}
                    value={gridSize} onChange={setGridSize} />
                  <ToggleButton active={showCaptions} onClick={() => setShowCaptions((p) => !p)}>Captions</ToggleButton>
                </>
              )}
            </>
          )}
          <button onClick={handleFixCovers} disabled={fixingCovers} style={{ ...btnSecondary, fontSize: 12, padding: "3px 10px" }} title="Re-download all covers stored as external URLs">
            {fixingCovers ? "Fixing…" : "Fix Covers"}
          </button>
          {fixCoversResult && <span style={{ fontSize: 11, color: "var(--text-secondary)" }}>{fixCoversResult}</span>}
        </div>
      </div>

      {/* Main area */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {/* Sidebar */}
        <div style={{ width: 220, flexShrink: 0, overflowY: "auto", borderRight: "1px solid var(--border-card)", padding: 10 }}>
          <GnFilters
            items={items}
            publishers={publishers}
            formatTypes={formatTypes}
            eras={eras}
            ownershipStatuses={ownershipStatuses}
            readStatuses={readStatuses}
            categories={categories}
            filters={filters}
            onSectionChange={handleSectionChange}
            onClearAll={clearAllFilters}
          />
        </div>

        {/* Content — Library tab */}
        {pageTab === "library" && (
          <div style={{ flex: 1, overflowY: "auto", padding: 14 }}>
            {error && <div style={alertError}>{error}</div>}

            {!loading && sorted.length === 0 && (
              <div style={{ color: "var(--text-secondary)", fontSize: 13, padding: "20px 0" }}>No items match the current filters.</div>
            )}

            {sorted.length > 0 && viewMode === "grid" && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignContent: "flex-start" }}>
                {sorted.map((g) => (
                  <GnGridItem key={g.item_id} gn={g}
                    isSelected={selectedIds.has(g.item_id)}
                    onToggleSelect={toggleSelect}
                    onClick={() => setActiveItemId(g.item_id)}
                    gridSize={gridSize} showCaptions={showCaptions} />
                ))}
              </div>
            )}

            {sorted.length > 0 && viewMode === "table" && (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, tableLayout: "fixed" }}>
                <colgroup>
                  <col style={{ width: 28 }} />
                  {showThumbnails && <col style={{ width: 50 }} />}
                  {colKeys.map((k) => <col key={k} style={{ width: colWidths[k] }} />)}
                </colgroup>
                <thead style={{ position: "sticky", top: 0, zIndex: 2 }}>
                  <tr>
                    <th style={{ ...thBase, width: 28, padding: "4px 6px" }}>
                      <input type="checkbox" checked={allVisibleSelected} onChange={toggleSelectAll} style={{ margin: 0, cursor: "pointer" }} />
                    </th>
                    {showThumbnails && <th style={{ ...thBase, width: 50 }} />}
                    {headers.map((h) => (
                      <th
                        key={h.key}
                        style={{ ...thBase, cursor: h.sortKey ? "pointer" : "default" }}
                        onClick={h.sortKey ? () => { if (!colResizingRef.current) toggleSort(h.sortKey); } : undefined}
                      >
                        {h.label}{h.sortKey ? sortArrow(h.sortKey) : ""}
                        <div
                          onMouseDown={makeResizeHandler(h.key)}
                          style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: 5, cursor: "col-resize", zIndex: 1 }}
                        />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((g) => {
                    const isSelected = selectedIds.has(g.item_id);
                    return (
                      <tr
                        key={g.item_id}
                        onClick={() => setActiveItemId(g.item_id)}
                        style={{ cursor: "pointer", background: isSelected ? "var(--row-selected)" : "transparent" }}
                        onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = "var(--row-hover)"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = isSelected ? "var(--row-selected)" : "transparent"; }}
                      >
                        <td style={{ ...tdStyle, width: 28 }} onClick={(e) => e.stopPropagation()}>
                          <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(g.item_id)} style={{ margin: 0, cursor: "pointer" }} />
                        </td>
                        {showThumbnails && (
                          <td style={{ ...tdStyle, width: 50, verticalAlign: "middle" }}>
                            {g.cover_image_url
                              ? <img src={getImageUrl(g.cover_image_url)} alt="" style={{ width: 34, height: 50, objectFit: "cover", borderRadius: 2, border: "1px solid var(--border)", display: "block" }} />
                              : <div style={{ width: 34, height: 50, background: "var(--bg-surface)", borderRadius: 2, border: "1px solid var(--border)" }} />}
                          </td>
                        )}
                        <td style={tdStyle}>
                          <div style={{ fontWeight: "bold", fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{g.title}</div>
                          {g.series_name && (
                            <div style={{ fontSize: 11, color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {g.series_name}{g.series_number != null ? ` Vol. ${g.series_number}` : ""}
                            </div>
                          )}
                        </td>
                        <td style={tdStyle}>
                          {g.writers?.length ? g.writers.join(", ") : <span style={{ color: "var(--text-label)" }}>—</span>}
                        </td>
                        <td style={tdStyle}>
                          {g.artists?.length ? g.artists.join(", ") : <span style={{ color: "var(--text-label)" }}>—</span>}
                        </td>
                        <td style={tdStyle}>
                          {g.publisher_name || <span style={{ color: "var(--text-label)" }}>—</span>}
                        </td>
                        <td style={tdStyle}>
                          {g.format_type_name || <span style={{ color: "var(--text-label)" }}>—</span>}
                        </td>
                        <td style={tdStyle}>
                          {g.era_name || <span style={{ color: "var(--text-label)" }}>—</span>}
                        </td>
                        <td style={{ ...tdStyle, whiteSpace: "normal" }}>
                          <SourceSeriesDisplay sourceSeries={g.source_series} issueNotes={g.issue_notes} />
                        </td>
                        <td style={tdStyle}>
                          <span style={{ fontSize: 11, color: "var(--text-secondary)" }}>{g.reading_status || "—"}</span>
                        </td>
                        <td style={tdStyle}>
                          <span style={{ fontSize: 11, color: "var(--text-secondary)" }}>{g.ownership_status || "—"}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* Content — Source Series tab */}
        {pageTab === "sourceSeries" && (
          <div style={{ flex: 1, overflowY: "auto", padding: 14 }}>
            {error && <div style={alertError}>{error}</div>}
            <div style={{ marginBottom: 10, maxWidth: 400 }}>
              <input
                value={sourceSeriesSearch}
                onChange={(e) => setSourceSeriesSearch(e.target.value)}
                placeholder="Filter by source series name…"
                style={inputStyle}
              />
            </div>
            {visibleSourceSeriesRows.length === 0 && (
              <div style={{ color: "var(--text-secondary)", fontSize: 13, padding: "20px 0" }}>No source series entries match the current filters.</div>
            )}
            {visibleSourceSeriesRows.length > 0 && (() => {
              const ssHeaders = [
                { key: "series", label: "Source Series", col: "series", sortKey: "series" },
                { key: "issues", label: "Issues", col: "issues", sortKey: "issues" },
                { key: "title", label: "Title / Series", col: "title", sortKey: "title" },
                { key: "publisher", label: "Publisher", col: "publisher", sortKey: "publisher" },
                { key: "format", label: "Format", col: "format", sortKey: null },
                { key: "own", label: "Own", col: "own", sortKey: null },
              ];
              return (
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, tableLayout: "fixed" }}>
                  <colgroup>
                    {ssHeaders.map((h) => <col key={h.key} style={{ width: ssColWidths[h.col] }} />)}
                  </colgroup>
                  <thead style={{ position: "sticky", top: 0, zIndex: 2 }}>
                    <tr>
                      {ssHeaders.map((h) => (
                        <th
                          key={h.key}
                          style={{ ...thBase, cursor: h.sortKey ? "pointer" : "default" }}
                          onClick={h.sortKey ? () => { if (!colResizingRef.current) toggleSSSort(h.sortKey); } : undefined}
                        >
                          {h.label}{h.sortKey ? ssSortArrow(h.sortKey) : ""}
                          <div
                            onMouseDown={makeSSResizeHandler(h.col)}
                            style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: 5, cursor: "col-resize", zIndex: 1 }}
                          />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleSourceSeriesRows.map((row, i) => {
                      const { entry, gn } = row;
                      const issueRange = entry.start_issue != null
                        ? (entry.end_issue != null && entry.end_issue !== entry.start_issue
                            ? `#${entry.start_issue}–${entry.end_issue}`
                            : `#${entry.start_issue}`)
                        : "";
                      return (
                        <tr
                          key={i}
                          onClick={() => setActiveItemId(gn.item_id)}
                          style={{ cursor: "pointer", background: "transparent" }}
                          onMouseEnter={(e) => { e.currentTarget.style.background = "var(--row-hover)"; }}
                          onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                        >
                          <td style={tdStyle}><span style={{ fontWeight: "bold" }}>{entry.source_series_name}</span></td>
                          <td style={{ ...tdStyle, color: "var(--text-secondary)" }}>{issueRange || "—"}</td>
                          <td style={tdStyle}>
                            <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{gn.title}</div>
                            {gn.series_name && (
                              <div style={{ fontSize: 11, color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {gn.series_name}{gn.series_number != null ? ` Vol. ${gn.series_number}` : ""}
                              </div>
                            )}
                          </td>
                          <td style={{ ...tdStyle, color: "var(--text-secondary)" }}>{gn.publisher_name || <span style={{ color: "var(--text-label)" }}>—</span>}</td>
                          <td style={{ ...tdStyle, color: "var(--text-secondary)" }}>{gn.format_type_name || <span style={{ color: "var(--text-label)" }}>—</span>}</td>
                          <td style={{ ...tdStyle, color: "var(--text-secondary)" }}>{gn.ownership_status || "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              );
            })()}
          </div>
        )}
      </div>

      {/* Detail modal */}
      {activeItemId && (
        <GnDetailModal
          itemId={activeItemId}
          publishers={publishers}
          formatTypes={formatTypes}
          eras={eras}
          ownershipStatuses={ownershipStatuses}
          readStatuses={readStatuses}
          categories={categories}
          onClose={() => setActiveItemId(null)}
          onSaved={() => { load(); setActiveItemId(null); }}
          onDeleted={() => {
            load();
            setActiveItemId(null);
            setSelectedIds((prev) => { const next = new Set(prev); next.delete(activeItemId); return next; });
          }}
        />
      )}

      {bulkEditOpen && (
        <GnBulkEdit
          selectedIds={[...selectedIds]}
          publishers={publishers}
          formatTypes={formatTypes}
          eras={eras}
          ownershipStatuses={ownershipStatuses}
          readStatuses={readStatuses}
          onClose={() => setBulkEditOpen(false)}
          onSaved={async () => { setBulkEditOpen(false); clearSelection(); await load(); }}
          onDeleted={async () => { setBulkEditOpen(false); clearSelection(); await load(); }}
        />
      )}
    </div>
  );
}
