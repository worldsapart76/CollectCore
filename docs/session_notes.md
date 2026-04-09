# CollectCore — Session Notes

_Format: ### YYYY-MM-DD — brief completed / next summary_
_Keep last 3-5 sessions. Collapse older entries into "Completed to date" block._

> Update this section at the end of each working session with a brief
> summary of what was completed and what is next.

### 2026-04-09 — Books Phase 3: Frontend ingest + library

**Completed:**
- Added books API functions to `frontend/src/api.js`:
  - Lookups: `fetchBookGenres`, `fetchBookFormatDetails`, `fetchBookAgeLevels`, `fetchBookReadStatuses`, `searchBookAuthors`, `searchBookSeries`, `searchBookTags`, `searchBooksExternal`, `lookupBookIsbn`
  - CRUD: `listBooks`, `getBook`, `createBook`, `updateBook`, `deleteBook`
- `BooksIngestPage.jsx` (`/books/add`) — three-tab UI:
  - Manual Entry: full form with title, authors (multi), category, ownership, read status, format, age level, star rating, genres/subgenres picker, series, tags, ISBN-13/10, publisher, date, page count, language, cover URL, description, notes
  - ISBN Lookup: enter ISBN → Google Books prefill → edit form → save
  - External Search: keyword search → result list with cover thumbnails → select → prefill form → save
  - Soft dupe warning shown inline (not blocking); hard ISBN-13 conflict shown as error
- `BooksLibraryPage.jsx` (`/books/library`) — two-panel layout:
  - Filter sidebar: text search, category, ownership, read status, age level filters
  - Table view: cover thumbnail, title (+ series), author, category, ownership, read status, rating, ISBN-13
  - Row click → `BookDetailModal`: full edit form loaded from `GET /books/{id}`, save + delete with confirm step
- Wired routes in `App.jsx`: `/books/add`, `/books/library`
- Added "Add Book" and "Books" nav links to `TopNav.jsx` (separated from photocard links by a `|` divider)

**Known gaps vs. original plan** (see `docs/collectcore_books_module_plan.md` for full detail):
- Goodreads migration script (`backend/migrate_goodreads.py`) — not built; highest priority remaining item
- Backend: `POST /books/bulk-delete` and `PATCH /books/bulk` not implemented
- Library grid missing: Format badges column, Genre/Age level column
- Filter sidebar missing: Author, Format, Subgenre, Series, Tags filters
- Genre filter non-functional: genres not included in GET /books list response
- No bulk selection or bulk edit UI in library

### 2026-04-09 — Books Phase 4b: Library UX improvements

**Completed:**
- `star_rating` column changed to `REAL CHECK (BETWEEN 0.5 AND 5.0)` in schema.sql; Pydantic models updated to `Optional[float]`; SQLite stores REAL values in-place with no migration needed
- BooksIngestPage: star rating select now uses half-star values (1, 1.5 … 5), displayed as numbers
- BooksLibraryPage full overhaul:
  - Grid table: cover column removed by default; Age Level split into its own column; Genre column now shows "Genre — Subgenre" inline; cell padding reduced
  - Optional Thumbnail toggle in controls bar (42×60 thumbnails, 50% larger than previous)
  - Image grid view: Table/Grid toggle in controls bar; S/M/L size options; ownership badges (top-right overlay, color-coded by first letter); optional Captions toggle (title + author)
  - `GenrePicker`: auto-add on selection — genres without subgenres add immediately; genres with subgenres add when subgenre is selected; Add button shown only for genre-with-subgenres edge case
  - `StarRatingDisplay`: shows numeric value (e.g., "4.5") instead of star symbols
  - Sort options: added Rating ↓ and Rating ↑; unrated books always sort to bottom regardless of direction
- Filter sidebar full redesign: all sections use tri-state toggle (click cycles unselected → green + include → red − exclude → unselected); AND|OR pill appears in section header when any item is active; Author and Tags use searchable chip variant (search input + selected items shown as colored chips above list)

**Next:**
- Tags/Author filter UX decision + OR/AND/exclude tri-state per filter (pending user selection from options)
- Goodreads migration script

### 2026-04-09 — Books Phase 4: Library gaps closed

**Completed:**
- `GET /books` list response rebuilt with correlated subqueries — now returns `formats`, `genres`, `subgenres`, `tags`, `age_level_id` per book; eliminates JOIN-explosion author duplication bug
- Added `POST /books/bulk-delete` and `PATCH /books/bulk` (ownership + read status) backend endpoints
- Added `bulkUpdateBooks`, `bulkDeleteBooks` to `frontend/src/api.js`
- `BooksLibraryPage.jsx` full overhaul:
  - Grid columns updated to plan spec: checkbox | cover | title+series | author | format badges | genre+age level | read status | ownership | rating
  - Format badges color-coded by top-level format (Physical=grey, Digital=blue, Audio=green)
  - Filter sidebar now includes all planned filters: Author, Genre, Subgenre, Format (grouped by Physical/Digital/Audio), Age Level, Read Status, Ownership, Series, Tags — all derived from live library data
  - Genre/subgenre/format filters now functional (data included in list response)
  - Bulk selection: checkbox column + select-all in header, selected count in controls bar
  - `BookBulkEdit` panel: ownership + read status bulk update, bulk delete with confirm step

**Next:**
- Goodreads migration script (`backend/migrate_goodreads.py`)

### 2026-04-09 — Books Phase 2: Backend CRUD + lookup endpoints

**Completed:**
- Added all books backend endpoints to `backend/main.py`
- Lookup endpoints (all return active rows from seeded lookup tables):
  - `GET /books/genres` — returns top-level genres with nested sub_genres array; optional `?category_scope_id=` filter
  - `GET /books/format-details` — Physical/Digital/Audio formats
  - `GET /books/age-levels` — 5 age levels
  - `GET /books/read-statuses` — 4 read statuses
  - `GET /books/authors` — all authors; optional `?q=` fuzzy search (LIKE, max 20)
  - `GET /books/series` — all series; optional `?q=` fuzzy search
  - `GET /books/tags` — all tags; optional `?q=` fuzzy search
- External search (Google Books API, no key required):
  - `GET /books/search-external?q=...` — title/author search, returns up to 10 normalized results
  - `GET /books/lookup-isbn?isbn=...` — single ISBN lookup, returns normalized result or null
  - Both normalize to stable internal shape: title, author_names[], isbn_13, isbn_10, publisher, published_date, page_count, language, description, cover_image_url, api_source, external_work_id, api_categories_raw
- CRUD endpoints:
  - `POST /books` — soft dupe check (title+primary author); upserts authors/series/tags; returns full book object
  - `GET /books` — list view (joined, GROUP_CONCAT authors, ordered by title_sort)
  - `GET /books/{item_id}` — full detail with authors, series, genres, tags, copies arrays
  - `PUT /books/{item_id}` — full replace of all xref rows + copy; returns full book object
  - `DELETE /books/{item_id}` — manual cascade delete of all related rows
- Helpers: `_make_title_sort` (strips The/A/An prefix), `_upsert_author/series/tag`, `_insert_book_relationships`, `_get_book_detail`
- Hard ISBN-13 uniqueness handled at DB constraint level; caught and returned as 409

**Next:**
- Phase 3: Books frontend — ingest UI (manual entry + ISBN lookup + external search), library list view

### 2026-04-09 — Books Phase 1: Schema migration complete

**Completed:**
- Resolved all 6 Books module prerequisites; key decisions:
  - Tags: book-specific now (`lkup_book_tags`/`xref_book_item_tags`); cross-collection deferred
  - Format: lives entirely in books module (`lkup_book_format_details` + `tbl_book_copies`), NOT on `tbl_items`
  - Reading status: on `tbl_items.reading_status_id` (shared, NULL for photocards)
  - API categories: stored raw in `tbl_book_details.api_categories_raw`; not auto-assigned to genres
  - Duplicate detection: soft (application-level) for title+author; hard DB constraint for isbn_13
  - Genre/subgenre admin UI: deferred; seed list only
- Rewrote books section of `backend/sql/schema.sql` — 3-layer architecture:
  `tbl_items` (work) → `tbl_book_details` (work metadata) → `tbl_book_copies` (edition/copy)
- Added `reading_status_id` to `tbl_items` in schema.sql
- Added `category_scope_id` FK to `lkup_book_top_level_genres` to scope Fiction vs Non-Fiction genres
  (required to allow "Other" to exist in both scopes without UNIQUE constraint collision)
- Wrote and ran `backend/migrate_books_schema.py` against live DB:
  - Dropped old `tbl_book_works`-based tables (14 tables)
  - Added `reading_status_id` column to `tbl_items`
  - Created all new book tables and indexes
  - Seeded: book collection type (id=2), Fiction/Non-Fiction categories (id=3/4),
    Borrowed ownership status, 4 read statuses, 8 format details, 5 age levels,
    11 genres (Fiction+NF scoped), 33 subgenres
  - 1,036 existing photocard rows unaffected
- Updated `docs/collectcore_summary.md` with full books schema description

### 2026-04-08 — Phase 5 Migration complete

**Completed:**
- Written `backend/migrate_from_original.py` — migrates original PhotocardTracker → CollectCore
- Wipes test data before migrating (tbl_items, tbl_photocard_details, xref_photocard_members, tbl_attachments, lkup_photocard_source_origins)
- Seeds `lkup_collection_types` with photocard type (id=1)
- Migrated 1,036 cards, 0 skipped
- Result: 1,036 items, 1,036 photocard details, 1,036 member xrefs, 1,891 attachments (fronts+backs), 36 source origins auto-created
- Images copied from `PhotocardTracker/images/library/` → `CollectCore/images/library/`
- `Multiple` member mapped to Bang Chan per user decision
- ownership mapping: Owned→1, Want→Wanted(2), For Trade→Trade(3)
- sub_category → source_origin, source → version

**Next:**
- Phase 4 continued or further testing/verification of migrated data

### 2026-04-08 — Phase 4 UI tweaks batch 1

**Completed:**
- Backend: `DELETE /ingest/inbox/{filename}` (delete file from inbox), `POST /photocards/bulk-delete` (bulk delete photocards by id list)
- `api.js`: added `deleteFromInbox`, `bulkDeletePhotocards`
- `PhotocardFilters`: added left padding, independent sidebar scroll, per-section 5-item cap with overflow scroll (applies to both library and export sidebars)
- `InboxPage`: X button on each queue item (calls delete API), thumbnail size toggle (+/− button on preview image), taller drag/drop zone
- `PhotocardGrid`: ownership badges now dynamic — any status gets its first-letter badge with color by first letter; S/M/L thumbnail sizes increased 25% (s: 100×138, m: 150×206, l: 200×275)
- `PhotocardDetailModal`: restructured to two-panel — front+back images on left with individual Replace/Upload buttons; form on right; modal widened to 700px
- `PhotocardBulkEdit`: added "Delete N cards" button with confirm step in footer; wired `onDeleted` callback in library page
- **Open item confirmed:** price field does not exist in DB schema — deferred for future session
- **ATEEZ members:** code path is correct; if ATEEZ shows no members it is a data issue (no rows in `lkup_photocard_members` for that group_id) — needs manual DB seed or admin UI
- **Fix:** ownership badges were using colored text on black background — switched to colored background with white text, 20×20px fixed size for better contrast and clarity
- **Fix:** filter sidebar section scroll was splitting visible/overflow into two zones with a dividing line — now all items go into a single scrollable container when section exceeds 5 items

**Next:**
- Phase 4 continued: further testing/tweaks as directed
- Phase 5: Migration script (original photocard tracker → CollectCore schema)

### 2026-04-08 — Phase 3 Export complete

**Completed:**
- Backend: `POST /export/photocards` — accepts `item_ids` (ordered), `include_captions`, `include_backs`; generates PDF via reportlab (4-column grid, A4 portrait, 1.54 portrait ratio, caption below each image); returns as streaming binary
- `api.js`: added `exportPhotocards` (returns blob, not JSON)
- Rewrote `ExportPage.jsx` using CollectCore patterns: same data loading + filter state as `PhotocardLibraryPage`, reuses `PhotocardFilters` sidebar, export summary panel, downloads PDF on button click
- **Fix:** Export silently dropped cards with no front image (`if card["front_image_path"]:` guard); changed to always add an entry per card — missing image renders as grey placeholder so no card is ever excluded

**Next:**
- Phase 4: Full testing and tweaks
- Phase 5: Migration script (original photocard tracker → CollectCore schema)
  - See `docs/collectcore_photocard_migration_mapping.md` for field mapping

### 2026-04-08 — Phase 2 Image Ingest complete

**Completed:**
- Backend ingest endpoints: `GET /ingest/inbox`, `POST /ingest/upload`, `POST /ingest/front`, `GET /ingest/candidates` (member-filtered), `POST /ingest/attach-back`, `POST /ingest/pair`, `POST /photocards/{id}/replace-front`, `POST /photocards/{id}/replace-back`
- Rebuilt `InboxPage.jsx`: drag/drop upload zone, unified inbox queue with per-file F/B toggles, persistent metadata form (survives file changes), auto-select on upload
- Multi-select (max 2): single F → ingest front; single B → candidate grid + attach back; F+B pair → atomic pair ingest; same-side pair → error
- Candidate filtering includes member_ids (important for back matching accuracy)
- `api.js` legacy stubs replaced with real implementations

### 2026-04-08 — Phase 1 Library Foundation complete

**Completed:**
- Added backend endpoints: `GET /ownership-statuses`, `GET /photocards/{id}`, `PUT /photocards/{id}`, `DELETE /photocards/{id}`, `PATCH /photocards/bulk`
- Enhanced `GET /photocards` response to include `group_id`, `top_level_category_id`, `ownership_status_id`, `source_origin_id`, `front_image_path`, `back_image_path` (via `tbl_attachments` LEFT JOIN pivot)
- Confirmed image schema decision: use `tbl_attachments` for all modules
- Built fresh photocard library UI: `PhotocardLibraryPage`, `PhotocardFilters`, `PhotocardGrid`, `PhotocardDetailModal`, `PhotocardBulkEdit`
- Fixed `InboxManager`: ownership status now loads from API; member checkboxes added to form
- Wired `/library` route to new `PhotocardLibraryPage`

**Next:**
- Phase 2: Image ingest (`POST /ingest/front`, back candidate matching, `POST /ingest/attach-back`, replace-front/back endpoints, new `InboxPage.jsx`)
- Phase 3: Export (`POST /export/photocards`, new `ExportPage.jsx`)
