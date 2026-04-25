import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  emptySection,
  sectionActive,
  applySection,
  FilterSidebarShell,
  TriStateFilterSection,
  SearchableTriStateSection,
  HierarchicalGenreSection,
  HierarchicalFormatSection,
} from "../components/library/FilterSidebar";
import {
  bulkDeleteBooks,
  bulkUpdateBooks,
  deleteBook,
  fetchBookAgeLevels,
  fetchBookFormatDetails,
  fetchBookGenres,
  fetchConsumptionStatuses,
  fetchOwnershipStatuses,
  getBook,
  listBooks,
  updateBook,
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

const BOOK_COLLECTION_TYPE_ID = COLLECTION_TYPE_IDS.books;

// Format tint palette — module-specific to Books (Physical/Digital/Audio color-coding).
// Kept as a local JS map (no matching design token since this palette is only used here).
const FORMAT_COLORS_LIGHT = {
  Physical: { background: "#f5f5f5", color: "#555",    border: "1px solid #ccc" },
  Digital:  { background: "#e3f2fd", color: "#1565c0", border: "1px solid #90caf9" },
  Audio:    { background: "#e8f5e9", color: "#2e7d32", border: "1px solid #a5d6a7" },
};

const FORMAT_COLORS_DARK = {
  Physical: { background: "#2a2a2a", color: "#aaa",    border: "1px solid #444" },
  Digital:  { background: "#0d2137", color: "#64b5f6", border: "1px solid #1565c0" },
  Audio:    { background: "#0d1f0d", color: "#9ced5a", border: "1px solid #377e00" },
};

function getFormatColors(format) {
  const isDark = document.documentElement.dataset.theme === "dark";
  const map = isDark ? FORMAT_COLORS_DARK : FORMAT_COLORS_LIGHT;
  return map[format] || map.Physical;
}

const HALF_STAR_OPTIONS = [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5];

// ─── Book filters sidebar ─────────────────────────────────────────────────────

function BookFilters({ books, genres, ownershipStatuses, readStatuses, ageLevels, filters, onSectionChange, onClearAll }) {
  const formatGroups = useMemo(() => {
    const byTopLevel = {};
    for (const b of books) for (const f of (b.formats || [])) {
      if (!byTopLevel[f.top_level_format]) byTopLevel[f.top_level_format] = new Set();
      byTopLevel[f.top_level_format].add(f.format_name);
    }
    return ["Physical", "Digital", "Audio"].filter((tl) => byTopLevel[tl]).map((tl) => ({
      groupLabel: tl,
      items: [...byTopLevel[tl]].sort().map((name) => ({ id: name, label: name })),
    }));
  }, [books]);

  const allAuthors = useMemo(() => {
    const seen = new Set();
    const result = [];
    for (const b of books) for (const a of (b.authors || [])) if (!seen.has(a)) { seen.add(a); result.push(a); }
    return result.sort().map((a) => ({ id: a, label: a }));
  }, [books]);

  const libraryGenreHierarchy = useMemo(() => {
    const genreNames = new Set(books.flatMap((b) => b.genres || []));
    const subGenreNames = new Set(books.flatMap((b) => b.subgenres || []));
    return genres
      .filter((g) => genreNames.has(g.genre_name))
      .map((g) => ({
        ...g,
        sub_genres: (g.sub_genres || []).filter((s) => subGenreNames.has(s.sub_genre_name)),
      }));
  }, [books, genres]);

  const allSeries = useMemo(() => {
    const seen = new Set();
    const result = [];
    for (const b of books) if (b.series_name && !seen.has(b.series_name)) { seen.add(b.series_name); result.push(b.series_name); }
    return result.sort().map((s) => ({ id: s, label: s }));
  }, [books]);

  const allTags = useMemo(() => {
    const seen = new Set();
    const result = [];
    for (const b of books) for (const t of (b.tags || [])) if (!seen.has(t)) { seen.add(t); result.push(t); }
    return result.sort().map((t) => ({ id: t, label: t }));
  }, [books]);

  const hasFilters = filters.search.trim() ||
    ["category", "ownership", "readStatus", "ageLevel", "genre", "subGenre", "format", "author", "series", "tag"]
      .some((k) => sectionActive(filters[k]));

  return (
    <FilterSidebarShell
      hasFilters={!!hasFilters}
      onClearAll={onClearAll}
      searchValue={filters.search}
      onSearch={(v) => onSectionChange("search", v)}
      searchPlaceholder="Search title, author..."
    >
      <TriStateFilterSection
        title="Category"
        items={[{ id: "3", label: "Fiction" }, { id: "4", label: "Non-Fiction" }]}
        section={filters.category} onChange={(s) => onSectionChange("category", s)} />

      {allAuthors.length > 0 && (
        <SearchableTriStateSection title="Author" items={allAuthors} selectedOnly
          section={filters.author} onChange={(s) => onSectionChange("author", s)} />
      )}
      {libraryGenreHierarchy.length > 0 && (
        <HierarchicalGenreSection
          title="Genre"
          genreHierarchy={libraryGenreHierarchy}
          genreSection={filters.genre}
          subGenreSection={filters.subGenre}
          onGenreChange={(s) => onSectionChange("genre", s)}
          onSubGenreChange={(s) => onSectionChange("subGenre", s)}
        />
      )}
      {formatGroups.length > 0 && (
        <HierarchicalFormatSection title="Format" groups={formatGroups}
          section={filters.format} onChange={(s) => onSectionChange("format", s)} />
      )}
      {ageLevels.length > 0 && (
        <TriStateFilterSection title="Age Level"
          items={ageLevels.map((a) => ({ id: String(a.age_level_id), label: a.age_level_name }))}
          section={filters.ageLevel} onChange={(s) => onSectionChange("ageLevel", s)} />
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
      {allTags.length > 0 && (
        <SearchableTriStateSection title="Tags" items={allTags} selectedOnly
          section={filters.tag} onChange={(s) => onSectionChange("tag", s)} />
      )}
    </FilterSidebarShell>
  );
}

// ─── Genre picker ─────────────────────────────────────────────────────────────

function GenrePicker({ genres, selected, onChange }) {
  const [topId, setTopId] = useState("");
  const [subId, setSubId] = useState("");
  const topGenre = genres.find((g) => String(g.top_level_genre_id) === topId);
  const subGenres = topGenre?.sub_genres || [];

  function doAdd(tId, sId) {
    if (!tId) return;
    const tg = genres.find((g) => String(g.top_level_genre_id) === tId);
    const sg = (tg?.sub_genres || []).find((s) => String(s.sub_genre_id) === sId);
    const entry = {
      top_level_genre_id: Number(tId),
      genre_name: tg?.genre_name || "",
      sub_genre_id: sg ? Number(sId) : null,
      sub_genre_name: sg?.sub_genre_name || null,
    };
    const key = `${entry.top_level_genre_id}-${entry.sub_genre_id}`;
    if (!selected.some((s) => `${s.top_level_genre_id}-${s.sub_genre_id}` === key)) {
      onChange([...selected, entry]);
    }
    setTopId("");
    setSubId("");
  }

  function handleTopChange(val) {
    setTopId(val);
    setSubId("");
    if (!val) return;
    const tg = genres.find((g) => String(g.top_level_genre_id) === val);
    if (!tg?.sub_genres?.length) doAdd(val, "");
  }

  function handleSubChange(val) {
    setSubId(val);
    if (val && topId) doAdd(topId, val);
  }

  const showAddButton = topId && subGenres.length > 0 && !subId;

  return (
    <Stack gap={2}>
      <Row gap={3} align="center">
        <Select value={topId} onChange={(e) => handleTopChange(e.target.value)} style={{ flex: 1 }}>
          <option value="">-- Genre --</option>
          {genres.map((g) => <option key={g.top_level_genre_id} value={g.top_level_genre_id}>{g.genre_name}</option>)}
        </Select>
        {subGenres.length > 0 && (
          <Select value={subId} onChange={(e) => handleSubChange(e.target.value)} style={{ flex: 1 }}>
            <option value="">-- Subgenre (optional) --</option>
            {subGenres.map((s) => <option key={s.sub_genre_id} value={s.sub_genre_id}>{s.sub_genre_name}</option>)}
          </Select>
        )}
        {showAddButton && (
          <Button variant="secondary" size="sm" onClick={() => doAdd(topId, "")} title="Add genre without subgenre">
            Add
          </Button>
        )}
      </Row>
      {selected.length > 0 && (
        <Row gap={2} wrap>
          {selected.map((s, i) => (
            <Badge key={i} tone="tag">
              {s.genre_name}{s.sub_genre_name ? ` / ${s.sub_genre_name}` : ""}
              <RemoveButton onClick={() => onChange(selected.filter((_, j) => j !== i))} style={{ marginLeft: "var(--space-1)" }} />
            </Badge>
          ))}
        </Row>
      )}
    </Stack>
  );
}

// ─── Display components ───────────────────────────────────────────────────────

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

function StarRatingDisplay({ rating }) {
  if (!rating) return <span style={{ color: "var(--text-label)", fontSize: "var(--text-sm)" }}>—</span>;
  return <span style={{ fontSize: "var(--text-sm)", color: "var(--accent-rating)", fontWeight: 700 }}>{rating}</span>;
}

function FormatBadges({ formats }) {
  if (!formats || formats.length === 0) return <span style={{ color: "var(--text-label)", fontSize: "var(--text-xs)" }}>—</span>;
  return (
    <Row gap={1} wrap>
      {formats.map((f, i) => {
        const colors = getFormatColors(f.top_level_format);
        return <span key={i} style={{ fontSize: "10px", padding: "1px 5px", borderRadius: "var(--radius-sm)", ...colors }}>{f.format_name}</span>;
      })}
    </Row>
  );
}

// ─── Grid view item ───────────────────────────────────────────────────────────

const BookGridItem = memo(function BookGridItem({ book, isSelected, onToggleSelect, onClick, gridSize, showCaptions }) {
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
            onChange={() => onToggleSelect(book.item_id)}
            style={{ margin: 0, cursor: "pointer" }} />
        </div>
        <OwnershipBadge statusName={book.ownership_status} />
        {book.cover_image_url ? (
          <img src={getImageUrl(book.cover_image_url)} alt="" style={{ width: w, height: h, objectFit: "cover", display: "block", borderRadius: "var(--radius-sm)" }} />
        ) : (
          <div style={{ width: w, height: h, background: "var(--bg-surface)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ fontSize: "10px", color: "var(--text-muted)" }}>No Cover</span>
          </div>
        )}
      </div>
      {showCaptions && (
        <div style={{ padding: "3px 2px 0", maxWidth: w }}>
          <div style={{ fontSize: "var(--text-xs)", fontWeight: 700, lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-primary)" }}>{book.title}</div>
          <div style={{ fontSize: "10px", color: "var(--text-muted)", lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{(book.authors || []).join(", ")}</div>
        </div>
      )}
    </div>
  );
});

// ─── Table row ────────────────────────────────────────────────────────────────

const BookRow = memo(function BookRow({ book, isSelected, onToggleSelect, onClick, showThumbnails }) {
  const genreText = book.genres?.length ? book.genres.join(", ") : null;
  const subgenreText = book.subgenres?.length ? book.subgenres.join(", ") : null;
  return (
    <tr onClick={onClick} style={{ cursor: "pointer", borderBottom: "1px solid var(--border)", background: isSelected ? "var(--green-light)" : undefined }}
      onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = "var(--bg-surface)"; }}
      onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = ""; }}>
      <td style={{ padding: "3px 6px", verticalAlign: "middle", width: 28 }} onClick={(e) => e.stopPropagation()}>
        <input type="checkbox" checked={isSelected} onChange={() => onToggleSelect(book.item_id)} style={{ margin: 0, cursor: "pointer" }} />
      </td>
      {showThumbnails && (
        <td style={{ padding: "3px 6px", verticalAlign: "middle", width: 50 }}>
          {book.cover_image_url
            ? <img src={getImageUrl(book.cover_image_url)} alt="" style={{ width: 42, height: 60, objectFit: "cover", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)", display: "block" }} />
            : <div style={{ width: 42, height: 60, background: "var(--bg-surface)", borderRadius: "var(--radius-sm)" }} />}
        </td>
      )}
      <td style={{ padding: "3px 8px", overflow: "hidden", whiteSpace: "nowrap" }}>
        <div style={{ fontWeight: 700, fontSize: "var(--text-base)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{book.title}</div>
        {book.series_name && (
          <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{book.series_name}{book.series_number ? ` #${book.series_number}` : ""}</div>
        )}
      </td>
      <td style={{ padding: "3px 8px", fontSize: "var(--text-sm)", color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{(book.authors || []).join(", ")}</td>
      <td style={{ padding: "3px 8px", overflow: "hidden", whiteSpace: "nowrap" }}><FormatBadges formats={book.formats} /></td>
      <td style={{ padding: "3px 8px", overflow: "hidden", whiteSpace: "nowrap" }}>
        {genreText
          ? <div style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{genreText}{subgenreText && <span style={{ color: "var(--text-muted)" }}>{" — "}{subgenreText}</span>}</div>
          : <span style={{ color: "var(--text-label)", fontSize: "var(--text-xs)" }}>—</span>}
      </td>
      <td style={{ padding: "3px 8px", fontSize: "var(--text-xs)", color: "var(--text-muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {book.age_level || <span style={{ color: "var(--text-label)" }}>—</span>}
      </td>
      <td style={{ padding: "3px 8px", fontSize: "var(--text-sm)", color: "var(--text-secondary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{book.reading_status || "—"}</td>
      <td style={{ padding: "3px 8px", fontSize: "var(--text-sm)", color: "var(--text-secondary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{book.ownership_status}</td>
      <td style={{ padding: "3px 8px", whiteSpace: "nowrap" }}><StarRatingDisplay rating={book.star_rating} /></td>
    </tr>
  );
});

// ─── Book detail modal ────────────────────────────────────────────────────────

function BookDetailModal({ book, genres, formatDetails, ageLevels, readStatuses, ownershipStatuses, onClose, onSaved, onDeleted }) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saveSuccess, setSaveSuccess] = useState("");

  const [title, setTitle] = useState("");
  const [authorNames, setAuthorNames] = useState([""]);
  const [categoryId, setCategoryId] = useState("");
  const [ownershipId, setOwnershipId] = useState("");
  const [readStatusId, setReadStatusId] = useState("");
  const [ageLevelId, setAgeLevelId] = useState("");
  const [formatDetailId, setFormatDetailId] = useState("");
  const [starRating, setStarRating] = useState("");
  const [seriesName, setSeriesName] = useState("");
  const [seriesNumber, setSeriesNumber] = useState("");
  const [tagNames, setTagNames] = useState("");
  const [genreList, setGenreList] = useState([]);
  const [isbn13, setIsbn13] = useState("");
  const [isbn10, setIsbn10] = useState("");
  const [publisher, setPublisher] = useState("");
  const [publishedDate, setPublishedDate] = useState("");
  const [pageCount, setPageCount] = useState("");
  const [language, setLanguage] = useState("en");
  const [coverUrl, setCoverUrl] = useState("");
  const [description, setDescription] = useState("");
  const [notes, setNotes] = useState("");
  const coverFileRef = useRef(null);

  async function handleCoverFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const { url } = await uploadCover(file, "books", book.item_id);
      setCoverUrl(url);
    } catch (err) {
      setSaveError(err.message || "Cover upload failed.");
    }
    if (coverFileRef.current) coverFileRef.current.value = "";
  }

  useEffect(() => {
    setLoading(true);
    getBook(book.item_id)
      .then((d) => {
        setDetail(d);
        setTitle(d.title || "");
        setAuthorNames(d.authors?.length ? d.authors.map((a) => a.author_name) : [""]);
        setCategoryId(String(d.top_level_category_id || ""));
        setOwnershipId(String(d.ownership_status_id || ""));
        setReadStatusId(d.reading_status_id ? String(d.reading_status_id) : "");
        setAgeLevelId(d.age_level_id ? String(d.age_level_id) : "");
        setStarRating(d.star_rating ? String(d.star_rating) : "");
        setSeriesName(d.series?.[0]?.series_name || "");
        setSeriesNumber(d.series?.[0]?.series_number ? String(d.series[0].series_number) : "");
        setTagNames(d.tags?.map((t) => t.tag_name).join(", ") || "");
        setGenreList(d.genres || []);
        const copy = d.copies?.[0];
        setFormatDetailId(copy?.format_detail_id ? String(copy.format_detail_id) : "");
        setIsbn13(copy?.isbn_13 || "");
        setIsbn10(copy?.isbn_10 || "");
        setPublisher(copy?.publisher || "");
        setPublishedDate(copy?.published_date || "");
        setPageCount(copy?.page_count ? String(copy.page_count) : "");
        setLanguage(copy?.language || "en");
        setCoverUrl(copy?.cover_image_url || "");
        setDescription(d.description || "");
        setNotes(d.notes || "");
      })
      .catch((err) => setError(err.message || "Failed to load book detail"))
      .finally(() => setLoading(false));
  }, [book.item_id]);

  async function handleSave() {
    setSaveError("");
    setSaveSuccess("");
    if (!title.trim()) { setSaveError("Title is required."); return; }
    if (!authorNames[0]?.trim()) { setSaveError("At least one author is required."); return; }

    const payload = {
      top_level_category_id: Number(categoryId),
      ownership_status_id: Number(ownershipId),
      reading_status_id: readStatusId ? Number(readStatusId) : null,
      notes: notes.trim() || null,
      title: title.trim(),
      description: description.trim() || null,
      age_level_id: ageLevelId ? Number(ageLevelId) : null,
      star_rating: starRating ? Number(starRating) : null,
      author_names: authorNames.map((n) => n.trim()).filter(Boolean),
      series_name: seriesName.trim() || null,
      series_number: seriesNumber ? parseFloat(seriesNumber) : null,
      genres: genreList.map((g) => ({ top_level_genre_id: g.top_level_genre_id, sub_genre_id: g.sub_genre_id || null })),
      tag_names: tagNames.split(",").map((t) => t.trim()).filter(Boolean),
      format_detail_id: formatDetailId ? Number(formatDetailId) : null,
      isbn_13: isbn13.trim() || null,
      isbn_10: isbn10.trim() || null,
      publisher: publisher.trim() || null,
      published_date: publishedDate.trim() || null,
      page_count: pageCount ? parseInt(pageCount, 10) : null,
      language: language.trim() || "en",
      cover_image_url: coverUrl.trim() || null,
      api_source: detail?.copies?.[0]?.api_source || null,
      external_work_id: detail?.copies?.[0]?.external_work_id || null,
      api_categories_raw: detail?.api_categories_raw || null,
    };

    setSaving(true);
    try {
      await updateBook(book.item_id, payload);
      setSaveSuccess("Saved.");
      onSaved();
    } catch (err) {
      setSaveError(err.message || "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      await deleteBook(book.item_id);
      onDeleted(book.item_id);
    } catch (err) {
      setSaveError(err.message || "Delete failed.");
    } finally {
      setDeleting(false);
    }
  }

  const footer = !loading && !error ? (
    <Row justify="between" gap={4} style={{ width: "100%" }}>
      <ConfirmButton
        label="Delete"
        confirmLabel={deleting ? "Deleting…" : "Confirm"}
        promptText="Delete this book?"
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
      title={loading ? "Loading…" : title || "Book Detail"}
      footer={footer}
      footerJustify="between"
    >
      {loading && <div style={{ color: "var(--text-muted)" }}>Loading…</div>}
      {error && <Alert tone="error" style={{ marginBottom: "var(--space-5)" }}>{error}</Alert>}
      {saveError && <Alert tone="error" style={{ marginBottom: "var(--space-5)" }}>{saveError}</Alert>}
      {saveSuccess && <Alert tone="success" style={{ marginBottom: "var(--space-5)" }}>{saveSuccess}</Alert>}

      {!loading && !error && (
        <Stack gap={5}>
          {coverUrl && (
            <Row gap={5} align="start">
              <CoverThumb src={coverUrl} alt="cover" size="md" />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: "var(--text-md)", marginBottom: 2 }}>{title}</div>
                <div style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>{authorNames.filter(Boolean).join(", ")}</div>
              </div>
            </Row>
          )}

          <FormField label="Title" required>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </FormField>

          <FormField label="Author(s)" required>
            <NameList names={authorNames} onChange={setAuthorNames} addLabel="+ Author" placeholder="Author name" />
          </FormField>

          <Grid cols={3} gap={5}>
            <FormField label="Category">
              <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                {[{ id: "3", label: "Fiction" }, { id: "4", label: "Non-Fiction" }].map((c) => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
              </Select>
            </FormField>
            <FormField label="Ownership">
              <Select value={ownershipId} onChange={(e) => setOwnershipId(e.target.value)}>
                {ownershipStatuses.map((s) => <option key={s.ownership_status_id} value={s.ownership_status_id}>{s.status_name}</option>)}
              </Select>
            </FormField>
            <FormField label="Read Status">
              <Select value={readStatusId} onChange={(e) => setReadStatusId(e.target.value)}>
                <option value="">-- None --</option>
                {readStatuses.map((s) => <option key={s.read_status_id} value={s.read_status_id}>{s.status_name}</option>)}
              </Select>
            </FormField>
            <FormField label="Format">
              <Select value={formatDetailId} onChange={(e) => setFormatDetailId(e.target.value)}>
                <option value="">-- None --</option>
                {formatDetails.map((f) => <option key={f.format_detail_id} value={f.format_detail_id}>{f.top_level_format} — {f.format_name}</option>)}
              </Select>
            </FormField>
            <FormField label="Age Level">
              <Select value={ageLevelId} onChange={(e) => setAgeLevelId(e.target.value)}>
                <option value="">-- None --</option>
                {ageLevels.map((a) => <option key={a.age_level_id} value={a.age_level_id}>{a.age_level_name}</option>)}
              </Select>
            </FormField>
            <FormField label="Star Rating">
              <Select value={starRating} onChange={(e) => setStarRating(e.target.value)}>
                <option value="">-- None --</option>
                {HALF_STAR_OPTIONS.map((n) => <option key={n} value={n}>{n}</option>)}
              </Select>
            </FormField>
          </Grid>

          <FormField label="Genres">
            <GenrePicker genres={genres} selected={genreList} onChange={setGenreList} />
          </FormField>

          <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "var(--space-5) var(--space-7)" }}>
            <FormField label="Series">
              <Input value={seriesName} onChange={(e) => setSeriesName(e.target.value)} placeholder="Series name" />
            </FormField>
            <div style={{ width: 90 }}>
              <FormField label="Book #">
                <Input value={seriesNumber} onChange={(e) => setSeriesNumber(e.target.value)} type="number" step="0.1" />
              </FormField>
            </div>
          </div>

          <FormField
            label={<>Tags <span style={{ fontWeight: 400, color: "var(--text-muted)" }}>(comma-separated)</span></>}
          >
            <Input value={tagNames} onChange={(e) => setTagNames(e.target.value)} />
          </FormField>

          <Grid cols={3} gap={5}>
            <FormField label="ISBN-13"><Input value={isbn13} onChange={(e) => setIsbn13(e.target.value)} /></FormField>
            <FormField label="ISBN-10"><Input value={isbn10} onChange={(e) => setIsbn10(e.target.value)} /></FormField>
            <FormField label="Language"><Input value={language} onChange={(e) => setLanguage(e.target.value)} /></FormField>
            <FormField label="Publisher"><Input value={publisher} onChange={(e) => setPublisher(e.target.value)} /></FormField>
            <FormField label="Published Date"><Input value={publishedDate} onChange={(e) => setPublishedDate(e.target.value)} placeholder="YYYY-MM-DD" /></FormField>
            <FormField label="Page Count"><Input value={pageCount} onChange={(e) => setPageCount(e.target.value)} type="number" /></FormField>
          </Grid>

          <FormField label="Cover Image URL">
            <Row gap={3} align="center">
              <Input value={coverUrl} onChange={(e) => setCoverUrl(e.target.value)} style={{ flex: 1 }} />
              <input type="file" accept="image/*" ref={coverFileRef} onChange={handleCoverFile} style={{ display: "none" }} />
              <Button type="button" variant="secondary" size="sm" onClick={() => coverFileRef.current?.click()}>
                Add Image
              </Button>
              {coverUrl && <CoverThumb src={getImageUrl(coverUrl)} alt="cover" size="sm" />}
            </Row>
          </FormField>

          <FormField label="Description">
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
          </FormField>

          <FormField label="Notes">
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </FormField>
        </Stack>
      )}
    </Modal>
  );
}

// ─── Bulk edit panel ──────────────────────────────────────────────────────────

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

function BookBulkEdit({ selectedBooks, ownershipStatuses, readStatuses, ageLevels, formatDetails, genres, onClose, onSaved, onDeleted }) {
  const [updateOwnership, setUpdateOwnership] = useState(false);
  const [ownershipStatusId, setOwnershipStatusId] = useState(String(ownershipStatuses[0]?.ownership_status_id || ""));
  const [updateReadStatus, setUpdateReadStatus] = useState(false);
  const [readStatusId, setReadStatusId] = useState(String(readStatuses[0]?.read_status_id || ""));
  const [updateCategory, setUpdateCategory] = useState(false);
  const [categoryId, setCategoryId] = useState("3");
  const [updateAgeLevel, setUpdateAgeLevel] = useState(false);
  const [ageLevelId, setAgeLevelId] = useState(String(ageLevels[0]?.age_level_id || ""));
  const [updateRating, setUpdateRating] = useState(false);
  const [starRating, setStarRating] = useState("3");
  const [updateFormat, setUpdateFormat] = useState(false);
  const [formatDetailId, setFormatDetailId] = useState(String(formatDetails[0]?.format_detail_id || ""));
  const [updateGenres, setUpdateGenres] = useState(false);
  const [genreList, setGenreList] = useState([]);

  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  const anyEnabled = updateOwnership || updateReadStatus || updateCategory || updateAgeLevel || updateRating || updateFormat || updateGenres;

  async function handleSave() {
    if (!anyEnabled) { setError("Select at least one field to update."); return; }
    const fields = {};
    if (updateOwnership) fields.ownership_status_id = Number(ownershipStatusId);
    if (updateReadStatus) fields.reading_status_id = Number(readStatusId);
    if (updateCategory) fields.top_level_category_id = Number(categoryId);
    if (updateAgeLevel) fields.age_level_id = Number(ageLevelId);
    if (updateRating) fields.star_rating = Number(starRating);
    if (updateFormat) fields.format_detail_id = Number(formatDetailId);
    if (updateGenres) fields.genres = genreList.map((g) => ({ top_level_genre_id: g.top_level_genre_id, sub_genre_id: g.sub_genre_id || null }));
    setSaving(true); setError("");
    try { await bulkUpdateBooks(selectedBooks.map((b) => b.item_id), fields); onSaved(); }
    catch (err) { setError(err.message || "Failed to update"); }
    finally { setSaving(false); }
  }

  async function handleDelete() {
    setDeleting(true);
    try { await bulkDeleteBooks(selectedBooks.map((b) => b.item_id)); onDeleted(); }
    catch (err) { setError(err.message || "Failed to delete"); }
    finally { setDeleting(false); }
  }

  const footer = (
    <Row justify="between" gap={4} style={{ width: "100%" }}>
      <ConfirmButton
        label={`Delete ${selectedBooks.length} books`}
        confirmLabel={deleting ? "…" : "Yes"}
        cancelLabel="No"
        promptText={`Delete ${selectedBooks.length}?`}
        onConfirm={handleDelete}
        busy={deleting}
        disabled={saving}
      />
      <Row gap={4}>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={handleSave} disabled={saving || deleting}>
          {saving ? "Saving…" : `Apply to ${selectedBooks.length}`}
        </Button>
      </Row>
    </Row>
  );

  return (
    <Modal
      isOpen
      onClose={onClose}
      size="sm"
      title={`Bulk Edit — ${selectedBooks.length} books`}
      footer={footer}
      footerJustify="between"
    >
      <Stack gap={5}>
        {error && <Alert tone="error">{error}</Alert>}
        <BulkField label="Ownership" enabled={updateOwnership} onToggle={() => setUpdateOwnership((p) => !p)}>
          <Select value={ownershipStatusId} onChange={(e) => setOwnershipStatusId(e.target.value)}>
            {ownershipStatuses.map((s) => <option key={s.ownership_status_id} value={s.ownership_status_id}>{s.status_name}</option>)}
          </Select>
        </BulkField>
        <BulkField label="Read Status" enabled={updateReadStatus} onToggle={() => setUpdateReadStatus((p) => !p)}>
          <Select value={readStatusId} onChange={(e) => setReadStatusId(e.target.value)}>
            {readStatuses.map((s) => <option key={s.read_status_id} value={s.read_status_id}>{s.status_name}</option>)}
          </Select>
        </BulkField>
        <BulkField label="Category" enabled={updateCategory} onToggle={() => setUpdateCategory((p) => !p)}>
          <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="3">Fiction</option>
            <option value="4">Non-Fiction</option>
          </Select>
        </BulkField>
        <BulkField label="Age Level" enabled={updateAgeLevel} onToggle={() => setUpdateAgeLevel((p) => !p)}>
          <Select value={ageLevelId} onChange={(e) => setAgeLevelId(e.target.value)}>
            {ageLevels.map((a) => <option key={a.age_level_id} value={a.age_level_id}>{a.age_level_name}</option>)}
          </Select>
        </BulkField>
        <BulkField label="Star Rating" enabled={updateRating} onToggle={() => setUpdateRating((p) => !p)}>
          <Select value={starRating} onChange={(e) => setStarRating(e.target.value)}>
            {HALF_STAR_OPTIONS.map((n) => <option key={n} value={n}>{n}</option>)}
          </Select>
        </BulkField>
        <BulkField label="Format" enabled={updateFormat} onToggle={() => setUpdateFormat((p) => !p)}>
          <Select value={formatDetailId} onChange={(e) => setFormatDetailId(e.target.value)}>
            {formatDetails.map((f) => <option key={f.format_detail_id} value={f.format_detail_id}>{f.top_level_format} — {f.format_name}</option>)}
          </Select>
        </BulkField>
        <BulkField label="Genre (replaces existing)" enabled={updateGenres} onToggle={() => setUpdateGenres((p) => !p)}>
          <GenrePicker genres={genres} selected={genreList} onChange={setGenreList} />
        </BulkField>
      </Stack>
    </Modal>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

const DEFAULT_FILTERS = {
  search: "",
  category: emptySection(),
  ownership: emptySection(),
  readStatus: emptySection(),
  ageLevel: emptySection(),
  genre: emptySection(),
  subGenre: emptySection(),
  format: emptySection(),
  author: emptySection(),
  series: emptySection(),
  tag: emptySection(),
};

export default function BooksLibraryPage() {
  const [books, setBooks] = useState([]);
  const [ownershipStatuses, setOwnershipStatuses] = useState([]);
  const [readStatuses, setReadStatuses] = useState([]);
  const [ageLevels, setAgeLevels] = useState([]);
  const [formatDetails, setFormatDetails] = useState([]);
  const [genres, setGenres] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [sortField, setSortField] = useState("title");
  const [sortDir, setSortDir] = useState("asc");
  const [detailBook, setDetailBook] = useState(null);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkEditOpen, setBulkEditOpen] = useState(false);

  const [viewMode, setViewMode] = useState("table");
  const [showThumbnails, setShowThumbnails] = useState(false);
  const [gridSize, setGridSize] = useState("m");
  const [mobileCardsPerRow, setMobileCardsPerRow] = useMobileCardsPerRow("books.mobileCardsPerRow");
  const isMobile = useMediaQuery(MOBILE_BREAKPOINT);
  const sentinelRef = useRef(null);
  const [showCaptions, setShowCaptions] = useState(true);

  const [colWidths, setColWidths] = useState({
    title: 220, author: 150, format: 120, genre: 150, age: 70, readStatus: 110, ownership: 100, rating: 60,
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
    if (field === sortField) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  }

  function sortIndicator(field) {
    if (field !== sortField) return " ⇅";
    return sortDir === "asc" ? " ▲" : " ▼";
  }

  useEffect(() => {
    async function loadAll() {
      setLoading(true); setError("");
      try {
        const [bookData, os, rs, al, fd, g] = await Promise.all([
          listBooks(), fetchOwnershipStatuses(BOOK_COLLECTION_TYPE_ID), fetchConsumptionStatuses(BOOK_COLLECTION_TYPE_ID),
          fetchBookAgeLevels(), fetchBookFormatDetails(), fetchBookGenres(),
        ]);
        setBooks(bookData); setOwnershipStatuses(os); setReadStatuses(rs);
        setAgeLevels(al); setFormatDetails(fd); setGenres(g);
      } catch (err) {
        setError(err.message || "Failed to load books");
      } finally {
        setLoading(false);
      }
    }
    loadAll();
  }, []);

  async function reloadBooks() {
    try { setBooks(await listBooks()); }
    catch (err) { setError(err.message || "Failed to refresh"); }
  }

  function handleSectionChange(key, value) {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }

  function handleClearAll() { setFilters(DEFAULT_FILTERS); }

  function toggleSelect(itemId) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId); else next.add(itemId);
      return next;
    });
  }

  function selectAll() { setSelectedIds(new Set(sortedBooks.map((b) => b.item_id))); }
  function clearSelection() { setSelectedIds(new Set()); }

  const filteredBooks = useMemo(() => {
    let result = books;

    if (filters.search.trim()) {
      const q = filters.search.toLowerCase();
      result = result.filter((b) =>
        b.title?.toLowerCase().includes(q) ||
        b.authors?.some((a) => a.toLowerCase().includes(q)) ||
        b.series_name?.toLowerCase().includes(q)
      );
    }

    if (sectionActive(filters.category)) {
      result = result.filter((b) => applySection(filters.category, [b.top_level_category_id]));
    }
    if (sectionActive(filters.ownership)) {
      result = result.filter((b) => applySection(filters.ownership, [b.ownership_status_id]));
    }
    if (sectionActive(filters.readStatus)) {
      result = result.filter((b) => applySection(filters.readStatus, [b.reading_status_id]));
    }
    if (sectionActive(filters.ageLevel)) {
      result = result.filter((b) => applySection(filters.ageLevel, [b.age_level_id]));
    }
    if (sectionActive(filters.genre)) {
      result = result.filter((b) => applySection(filters.genre, b.genres || []));
    }
    if (sectionActive(filters.subGenre)) {
      result = result.filter((b) => applySection(filters.subGenre, b.subgenres || []));
    }
    if (sectionActive(filters.format)) {
      result = result.filter((b) =>
        applySection(filters.format, (b.formats || []).flatMap((f) => [f.top_level_format, f.format_name]))
      );
    }
    if (sectionActive(filters.author)) {
      result = result.filter((b) => applySection(filters.author, b.authors || []));
    }
    if (sectionActive(filters.series)) {
      result = result.filter((b) => applySection(filters.series, b.series_name ? [b.series_name] : []));
    }
    if (sectionActive(filters.tag)) {
      result = result.filter((b) => applySection(filters.tag, b.tags || []));
    }

    return result;
  }, [books, filters]);

  const sortedBooks = useMemo(() => {
    const result = [...filteredBooks];
    const flip = sortDir === "desc" ? -1 : 1;
    switch (sortField) {
      case "author":
        return result.sort((a, b) =>
          flip * (a.authors?.[0] || "").localeCompare(b.authors?.[0] || "")
        );
      case "rating":
        return result.sort((a, b) => {
          if (!a.star_rating && !b.star_rating) return 0;
          if (!a.star_rating) return 1;
          if (!b.star_rating) return -1;
          return flip * (a.star_rating - b.star_rating);
        });
      case "ownership":
        return result.sort((a, b) =>
          flip * (a.ownership_status || "").localeCompare(b.ownership_status || "")
        );
      case "readStatus":
        return result.sort((a, b) =>
          flip * (a.reading_status || "").localeCompare(b.reading_status || "")
        );
      default:
        return result.sort((a, b) =>
          flip * (a.title_sort || a.title).localeCompare(b.title_sort || b.title)
        );
    }
  }, [filteredBooks, sortField, sortDir]);

  const selectedBooks = useMemo(
    () => sortedBooks.filter((b) => selectedIds.has(b.item_id)),
    [sortedBooks, selectedIds]
  );

  const allVisibleSelected = sortedBooks.length > 0 && sortedBooks.every((b) => selectedIds.has(b.item_id));

  const mobileVisible = useMobileInfiniteScroll({
    enabled: isMobile && viewMode === "grid",
    totalCount: sortedBooks.length,
    sentinelRef,
    resetKey: sortedBooks,
  });

  if (loading) return <div style={{ padding: "var(--space-9)" }}>Loading books...</div>;
  if (error) return <div style={{ padding: "var(--space-9)" }}><Alert tone="error">Error: {error}</Alert></div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden", fontSize: "var(--text-base)" }}>
      {/* Controls bar */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "var(--space-3) var(--space-6)", borderBottom: "1px solid var(--border)", background: "var(--bg-sidebar)", flexShrink: 0, gap: "var(--space-4)", flexWrap: "wrap" }}>
        <Row gap={5}>
          <span style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>
            {sortedBooks.length} book{sortedBooks.length !== 1 ? "s" : ""}
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
            <ToggleButton active={showThumbnails} onClick={() => setShowThumbnails((p) => !p)}>Thumbnails</ToggleButton>
          )}
          {viewMode === "grid" && (
            <>
              <span className="desktop-only" style={{ display: "inline-flex", alignItems: "center" }}>
                <SegmentedButtons
                  options={[{ value: "s", label: "S" }, { value: "m", label: "M" }, { value: "l", label: "L" }]}
                  value={gridSize} onChange={setGridSize} />
              </span>
              <MobilePerRowStepper value={mobileCardsPerRow} onChange={setMobileCardsPerRow} />
              <ToggleButton active={showCaptions} onClick={() => setShowCaptions((p) => !p)}>Captions</ToggleButton>
            </>
          )}
        </Row>
      </div>

      {/* Main content */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        <BookFilters
          books={books}
          genres={genres}
          ownershipStatuses={ownershipStatuses}
          readStatuses={readStatuses}
          ageLevels={ageLevels}
          filters={filters}
          onSectionChange={handleSectionChange}
          onClearAll={handleClearAll}
        />

        <div style={{ flex: 1, overflowY: "auto", overflowX: "auto", padding: 0 }}>
          {sortedBooks.length === 0 ? (
            <div style={{ padding: "var(--space-9)", color: "var(--text-muted)" }}>No books match the current filters.</div>
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
                {(isMobile ? sortedBooks.slice(0, mobileVisible) : sortedBooks).map((b) => (
                  <BookGridItem key={b.item_id} book={b}
                    isSelected={selectedIds.has(b.item_id)}
                    onToggleSelect={toggleSelect}
                    onClick={() => setDetailBook(b)}
                    gridSize={gridSize} showCaptions={showCaptions} />
                ))}
              </div>
              {isMobile && (
                <MobileInfiniteSentinel visible={mobileVisible} total={sortedBooks.length} sentinelRef={sentinelRef} />
              )}
            </>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--text-base)", tableLayout: "fixed" }}>
              <colgroup>
                <col style={{ width: 28 }} />
                {showThumbnails && <col style={{ width: 50 }} />}
                <col style={{ width: colWidths.title }} />
                <col style={{ width: colWidths.author }} />
                <col style={{ width: colWidths.format }} />
                <col style={{ width: colWidths.genre }} />
                <col style={{ width: colWidths.age }} />
                <col style={{ width: colWidths.readStatus }} />
                <col style={{ width: colWidths.ownership }} />
                <col style={{ width: colWidths.rating }} />
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
                    { key: "title", label: "Title" },
                    { key: "author", label: "Author" },
                    { key: null, label: "Format" },
                    { key: null, label: "Genre" },
                    { key: null, label: "Age" },
                    { key: "readStatus", label: "Read Status" },
                    { key: "ownership", label: "Ownership" },
                    { key: "rating", label: "Rating" },
                  ].map(({ key, label }, i) => {
                    const colKey = ["title", "author", "format", "genre", "age", "readStatus", "ownership", "rating"][i];
                    return (
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
                          style={{
                            position: "absolute",
                            right: 0,
                            top: 0,
                            bottom: 0,
                            width: 5,
                            cursor: "col-resize",
                            zIndex: 1,
                          }}
                        />
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {sortedBooks.map((b) => (
                  <BookRow key={b.item_id} book={b}
                    isSelected={selectedIds.has(b.item_id)}
                    onToggleSelect={toggleSelect}
                    onClick={() => setDetailBook(b)}
                    showThumbnails={showThumbnails} />
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {detailBook && (
        <BookDetailModal
          book={detailBook} genres={genres} formatDetails={formatDetails}
          ageLevels={ageLevels} readStatuses={readStatuses} ownershipStatuses={ownershipStatuses}
          onClose={() => setDetailBook(null)}
          onSaved={async () => { setDetailBook(null); await reloadBooks(); }}
          onDeleted={(itemId) => { setDetailBook(null); setBooks((prev) => prev.filter((b) => b.item_id !== itemId)); }}
        />
      )}

      {bulkEditOpen && (
        <BookBulkEdit
          selectedBooks={selectedBooks} ownershipStatuses={ownershipStatuses} readStatuses={readStatuses}
          ageLevels={ageLevels} formatDetails={formatDetails} genres={genres}
          onClose={() => setBulkEditOpen(false)}
          onSaved={async () => { setBulkEditOpen(false); clearSelection(); await reloadBooks(); }}
          onDeleted={() => { setBulkEditOpen(false); setBooks((prev) => prev.filter((b) => !selectedIds.has(b.item_id))); clearSelection(); }}
        />
      )}
    </div>
  );
}
