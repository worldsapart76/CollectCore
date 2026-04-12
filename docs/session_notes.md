# CollectCore — Session Notes

_Format: ### YYYY-MM-DD — brief completed / next summary_
_Keep last 3-5 sessions. Collapse older entries into "Completed to date" block._

> Update this section at the end of each working session with a brief
> summary of what was completed and what is next.

### 2026-04-11 — Video Games: testing fixes + RAWG API integration

**Completed:**
- **Fix: Edit modal background** — modal used `var(--surface)` (gray, matches grid background); changed to `var(--bg-surface)` to match GN modal pattern
- **Platform datalist** — Platform field (both ingest and edit modal) now uses `<input list=...>` + `<datalist>` populated from existing records; allows free typing but offers dropdown of existing platforms. Backend: added `GET /videogames/platforms` endpoint (distinct values from `tbl_game_details`). `api.js`: added `fetchGamePlatforms()`
- **RAWG API integration** — Added RAWG game search:
  - Backend: `RAWG_API_KEY` env var (optional; RAWG works with rate limits without a key); `GET /videogames/rawg-search?q=...` proxy endpoint returns title, released, cover_image_url, platforms array per result
  - Frontend `api.js`: added `rawgSearchGames(q)`
  - `VideoGamesIngestPage.jsx`: "Search RAWG" panel above the form — search field + Search button; results show title, year, platforms, cover thumbnail; clicking a result populates title, release date, and cover image URL

**Next:**
- Get RAWG API key (free, improves rate limits): rawg.io — add to `.env` as `RAWG_API_KEY=...` then restart backend
- Music module (next in build order)

### 2026-04-11 — Video Games module v1 complete

**Completed:**
- **Schema:** Added `lkup_game_developers`, `lkup_game_publishers`, `lkup_game_top_genres`, `lkup_game_sub_genres`, `tbl_game_details`, `xref_game_developers`, `xref_game_publishers`, `xref_game_genres` to `schema.sql` with indexes and seed data
- **Seed data:** Collection type `videogames` (id=94 on live DB); single catch-all category "Video Games" (not surfaced in UI); play statuses Played/Playing/Want to Play/Abandoned added to `lkup_book_read_statuses`; 9 top genres seeded
- **Migration script:** `backend/migrate_videogames_schema.py` — idempotent, updates `modules_enabled` to include `videogames`
- **Backend (`main.py`):** `VIDEOGAMES_COLLECTION_TYPE_ID` constant; Pydantic models (`VideoGameCreate`, `VideoGameUpdate`, `GameBulkUpdatePayload`); helpers (`_upsert_game_developer`, `_upsert_game_publisher`, `_insert_game_relationships`, `_get_game_detail`); endpoints: `GET /videogames/genres`, `/developers`, `/publishers`, `/play-statuses`, `GET /videogames`, `GET /videogames/{id}`, `POST /videogames`, `PUT /videogames/{id}`, `DELETE /videogames/{id}`, `PATCH /videogames/bulk`, `POST /videogames/bulk-delete`
- **Frontend:** `api.js` — all video games API functions; `modules.js` + `App.jsx` wired; `VideoGamesIngestPage.jsx` (add game form: title, platform, edition, ownership, play status, release date, developers, publishers, genres, cover URL, description, notes); `VideoGamesLibraryPage.jsx` (filter sidebar, table view, thumbnails toggle, edit modal, bulk edit/delete)
- Architecture note: `top_level_category_id` is auto-resolved from the single catch-all category at create time — not a user-facing field

**Next:**
- Test Video Games module end-to-end
- Music module (next in build order)

### 2026-04-11 — Future module schemas designed (Music, Video, Video Games, TTRPG, Board Games)

**Completed:**
- Gathered requirements for all five planned future modules via Q&A session
- Finalized schema decisions for each module — full detail in `C:\Users\world\.claude\plans\pure-inventing-whisper.md`
- Updated `CLAUDE.md`: added Future Modules section with per-module schema summaries, cleaned up stale Books prerequisites, updated Active Modules, updated Deferred Items list
- Key decisions per module:
  - **Music**: 3-layer (Release → Songs → Editions); release type as top-level category (Album/EP/Single/etc.); artists M:N; 2-level genre; edition-level ownership_status alongside release-level; track listings at both release and edition level
  - **Video**: Movie/TV Series/Miniseries/Concert/Live as top-level categories; TV gets seasons sub-table; movies/miniseries/concerts get copies sub-table; Director + Cast M:N; watch status via existing `reading_status_id` slot; TMDB API decided
  - **Video Games**: single catch-all top-level category (not shown in UI); platform + edition as free-form text; developer/publisher M:N; 2-level genre; play status via `reading_status_id`; API deferred
  - **TTRPG**: game system as top-level category (user-extensible); system editions + lines as scoped sub-lookups (mirrors photocards group→member hierarchy); copy sub-table for format + per-copy ISBN; authors M:N; book type lookup
  - **Board Games**: player count as top-level category; expansions sub-table with per-expansion ownership; designer M:N; BGG XML API (no key needed)
- Recommended build order: Video Games → Music → Video → Board Games → TTRPG

**Next:**
- API enrichment pass (cover art, bibliographic data for the 181 Goodreads books flagged `read_without_library_tag`)
- Begin first future module implementation (Video Games recommended as simplest)

### 2026-04-11 — Seed data complete; fresh installs fully functional

**Completed:**
- Added full seed data to `schema.sql` for all three modules — fresh installs now produce a working app without any migration scripts:
  - **Shared:** `lkup_ownership_statuses` — Owned, Wanted, Trade, Formerly Owned, Pending, Borrowed
  - **Photocards:** collection type (id=1) + top-level categories Album (id=1), Non-Album (id=2)
  - **Books:** collection type (id=2) + top-level categories Fiction (id=3), Non-Fiction (id=4); read statuses (4), format details (8), age levels (5), genres (11), subgenres (33)
  - **Graphic Novels:** collection type (id=3) — was already seeded; categories/publishers/format types/eras unchanged
  - All IDs on fresh installs match dev machine (hardcoded IDs in main.py are safe)
  - All inserts are `INSERT OR IGNORE` / subquery-based — idempotent, no hardcoded integer IDs
  - Validated against in-memory SQLite: schema + seed runs clean
- Resolved deferred item 18 (collection type seed data)

### 2026-04-11 — Build & release pipeline finalized

**Completed:**
- Fixed Inno Setup installer: changed Desktop shortcut from `{commondesktop}` to `{userdesktop}` to resolve access denied error on machines without admin rights (`PrivilegesRequired=lowest` conflict)
- Replaced `launcher.vbs` and `stop.vbs` with `launcher.ps1` and `stop.ps1` — VBScript is deprecated/disabled on Windows 11; PowerShell is always available
- Fixed `build-release.bat` step 3: PowerShell version-update command used `^` line continuation inside a double-quoted string (works in cmd but breaks when run from PowerShell terminal); collapsed to a single line
- Added backend startup logging to `launcher.ps1`: stdout → `%APPDATA%\CollectCore\backend-out.log`, stderr → `backend-err.log`; error dialog now shows log paths
- Fixed `schema.sql` FK crash on fresh installs: GN seed data hardcoded `collection_type_id = 3` for top-level categories, but on a fresh DB `graphicnovels` gets AUTOINCREMENT ID=1 (only collection type seeded in schema). Replaced hardcoded IDs with subquery lookups by `collection_type_code`
- Added Build & Release section to `CLAUDE.md` covering build steps, installer decisions, launcher behavior, and troubleshooting log locations
- Added deferred item 18: photocards and books collection types not seeded in schema.sql (only exist on dev machine via old migration scripts) — fresh installs won't have them; must fix before next distributed build

**Next:**
- API enrichment pass (cover art, bibliographic data for the 181 Goodreads-imported books flagged `read_without_library_tag`)
- Books library UI verification with real data

### 2026-04-10 — GN module: image support (grid view, thumbnails, ISBN image picker)

**Completed:**
- **Backend `GET /graphicnovels/lookup-isbn`:** Changed from returning a single result to returning a list (up to 5 from Google Books, or 1 from Open Library fallback). Returns `[]` if nothing found.
- **GN Ingest — ISBN lookup multi-result picker:** When lookup returns multiple editions, displays a clickable image grid (book cover + title + author + date). Selecting one populates the form. Single result still auto-populates as before.
- **GN Library — Cover image URL in edit modal:** Added `coverImageUrl` state, loads from `data.cover_image_url`, shown as a preview banner at the top of the modal, editable URL field with inline thumbnail preview. Included in PUT payload (previously it was silently cleared on every save — bug fixed).
- **GN Library — Thumbnail column (table mode):** "Thumbnails" toggle button in controls bar shows/hides a cover image column (34×50px) in table view. Default off.
- **GN Library — Grid view:** Table/Grid segmented control in controls bar. Grid mode renders `GnGridItem` cards with S/M/L size selector and Captions toggle (images-only when off). Default table view, grid default size M with captions on.
- **GN Library — Layout restructure:** Added controls bar at top (count, view mode, thumbnail/grid controls, + Add button). Sidebar + content now in flex row below the bar, matching Books library structure.

**Next:**
- API enrichment pass (cover art, bibliographic data for the 181 Goodreads-imported books flagged `read_without_library_tag`)
- Books library UI verification with real data

### 2026-04-10 — Graphic novels module adjustments

**Completed:**
- **Multiple source series:** Added `xref_gn_source_series` table (item_id, source_series_name, start_issue, end_issue, sort_order). Backend create/update/get/list all updated; old flat `source_series_name/start_issue/end_issue` fields removed from API payloads. Both ingest and library modal now show a multi-entry source series editor (series name · start # · end #).
- **Copy title → series name:** Small "← Copy Title" button appears next to Series Name label when title is non-empty (both ingest and edit modal).
- **ISBN lookup fallback:** Added Open Library API fallback when Google Books returns HTTP 429 (Too Many Requests). Lookup now silently retries Open Library before raising an error.
- **Hidden options (not deleted):** In ingest page, library filter sidebar, and edit modal — ownership options Trade/Formerly Owned/Pending/Borrowed are filtered out; read status options Currently Reading/DNF are filtered out; Era "Copper Age" is filtered out.
- **Publisher filter moved:** In library sidebar, Publisher moved to bottom and changed to `SearchableTriStateSection` with `selectedOnly` (options only appear when selected, like tags).
- **Library grid:** Added resizable columns (drag handle on each header), subtle row borders (`var(--border)`), sticky header row with `#f5f5f5` background and column dividers matching books library style. Source Series column now shows multi-entry display with issue ranges.

**Next:**
- API enrichment pass (cover art, bibliographic data for the 181 Goodreads-imported books flagged `read_without_library_tag`)
- Books library UI verification with real data

### 2026-04-10 — Admin: Backup & Restore

**Completed:**
- Added `GET /admin/backup` — streams a timestamped ZIP containing a hot-copy of the SQLite database (`collectcore.db`) plus all files in `images/library/`. Uses the SQLite backup API (safe for live DB). No module-specific code required; new modules are covered automatically.
- Added `POST /admin/restore` — accepts a ZIP upload, validates it contains `collectcore.db`, atomically replaces the DB file, optionally restores `images/library/` if present in the ZIP. Calls `engine.dispose()` to reset the SQLAlchemy connection pool after restore.
- Added `downloadBackup` and `restoreBackup` functions to `frontend/src/api.js`.
- Added "Backup & Restore" section to `AdminPage.jsx`: Download Backup button + Restore from Backup with a destructive-action confirm step (yellow warning banner with filename shown before committing).
- Added a "Backup & Restore" section to `CLAUDE.md` with a checklist item for future module builds: verify any module-specific file assets outside `images/library/` are added to the backup endpoint.

**Next:**
- API enrichment pass (cover art, bibliographic data for the 181 Goodreads-imported books flagged `read_without_library_tag`)
- Books library UI verification with real data

### 2026-04-10 — Photocard library improvements + duplicate member bug (RESOLVED)

**Completed:**
- Fixed `ExportPage` crash (white screen on nav): `PhotocardFilters` had been updated to tri-state API (`filters.group`, `onSectionChange`) but ExportPage still passed old flat shape (`filters.groupIds`, `onFilterChange`). `sectionActive(undefined)` threw on render. Fixed by updating ExportPage to import `emptySection/sectionActive/applySection` and matching the new filter shape.
- Photocard library + export page improvements (all files: `PhotocardGrid.jsx`, `PhotocardFilters.jsx`, `PhotocardLibraryPage.jsx`, `ExportPage.jsx`):
  - Ownership badge: now black background with neon-colored letter (O=`#39ff14`, W=`#ffff00`, F=`#ff3131`, T=`#00ffff`, S=`#bf00ff`)
  - Member sort order: `MEMBER_ORDER = [Bang Chan, Lee Know, Changbin, Hyunjin, Han, Felix, Seungmin, I.N]` used in sidebar and grid sort; multi-member cards sort to bottom
  - Filter sidebar member list sorted by MEMBER_ORDER (not alphabetical)
  - Source origin filter: `TriStateFilterSection` → `SearchableTriStateSection` (search-first with chips)
  - Version filter added: `SearchableTriStateSection`, derived from card data, applied in `filteredCards`
  - Per-page selector added to controls bar: 30 / 60 / 120 / All (`pageSize` prop on `PhotocardGrid`, `0` = show all)
  - Card count display in header: "{N} cards · {N} selected"
  - All changes applied to both `PhotocardLibraryPage` and `ExportPage`
- Script consolidation:
  - `Start-CollectCore.bat`: now kills both ports (with `/T` for process tree) before starting; opens browser
  - `Start-CollectCore-Hidden.vbs`: kills both ports (`/T`), starts backend + frontend hidden inline (no longer references separate bat files); opens app in Edge/Chrome `--app=` mode
  - `Stop-CollectCore.bat`: fixed wrong port (5173→5181), added `/T` flag
  - Files to delete (user must do manually): `Start-CollectCore-Hidden-Backend.bat`, `Start-CollectCore-Hidden-Frontend.bat`, `Start-Backend-Hidden.vbs`, `Restart-CollectCore-Backend.bat`
- **Duplicate member bug — RESOLVED:**
  - The SQL and Python fixes (correlated subquery + `dict.fromkeys` dedup) were correct and had been applied. The bug persisted because orphaned uvicorn worker processes from previous sessions were still running with old code.
  - Root cause: closing the PowerShell window kills the uvicorn reloader (parent) but leaves the spawned worker process running in the background. After many sessions, 10+ orphaned workers accumulated on port 8001; the oldest worker (started April 9, running pre-fix code) was the one winning connections.
  - Fix: created `Kill-CollectCore.ps1` which kills uvicorn reloaders AND their spawned worker processes (matched via `multiprocessing.spawn` + parent PID). Updated `Start-CollectCore.bat` and `Stop-CollectCore.bat` to use it.

### 2026-04-09 — Goodreads migration complete

**Completed:**
- Added `date_read TEXT` column to `tbl_items` (via ALTER TABLE in migration script, guarded by PRAGMA check)
- Ran `backend/migrate_goodreads.py` against `docs/goodreads_library_export.csv` → `data/collectcore.db`
- Fixed two bugs during run:
  - `format_detail_id NOT NULL` error: books with no library-* tags had a copy row inserted with NULL format; fixed by skipping copy insert when no format entries (bibliographic data enrichable via API later)
  - Duplicate author UNIQUE constraint: same name appearing in both Author and Additional Authors columns; fixed by deduplicating author list before insert
  - Series number parse error on `0.2.1` style numbers; fixed with try/except fallback to None
  - Duplicate format entry UNIQUE constraint (e.g. library-hardback + library-hardcover both = id 1); fixed with INSERT OR IGNORE on copies
- Final result: **4,724 books** in DB; 0 errors; 5 true duplicates skipped
  - Format: Paperback 2,913 | Kindle 1,292 | Other Audio 321 | Audible 207 | Other Ebook 139 | Kobo 3
  - Read status: Want to Read 3,185 | Read 878 | DNF 57
  - 181 books flagged `read_without_library_tag` (imported, no copy record — read on Goodreads without a library-* shelf)

**Next:**
- API enrichment pass (cover art, bibliographic data for the 181 flagged + format-missing books)
- Books library UI verification with real data

### 2026-04-09 — Shared filter sidebar system

**Completed:**
- Created `frontend/src/components/library/FilterSidebar.jsx` — shared module for all library filter sidebars:
  - State helpers: `emptySection`, `cycleItem`, `getItemState`, `sectionActive`, `applySection`
  - UI components: `FilterSidebarShell` (outer wrapper), `TriStateFilterSection`, `SearchableTriStateSection`, `GroupedTriStateSection`
  - All components extracted from `BooksLibraryPage.jsx` where they were previously defined inline
- Rewrote `PhotocardFilters.jsx` to use shared components:
  - All checkbox filters replaced with tri-state +/− toggle (same pattern as books sidebar)
  - `backStatus` radio replaced with `TriStateFilterSection` (Has Back / Missing Back)
  - Style/spacing now matches books sidebar
  - Prop renamed `onFilterChange` → `onSectionChange`
- Updated `PhotocardLibraryPage.jsx`:
  - Filter state changed from `groupIds: []` arrays to `group: emptySection()` sections
  - Filter logic now uses `applySection()` instead of `.includes()` checks
  - `handleFilterChange` → `handleSectionChange`
- Updated `BooksLibraryPage.jsx`:
  - All filter state helpers and UI components removed from file (now imported from shared module)
  - `BookFilters` sidebar now uses `FilterSidebarShell` instead of inline div wrapper
- New module pattern for future modules: import from `FilterSidebar.jsx`, wrap with `FilterSidebarShell`, add `TriStateFilterSection` / `SearchableTriStateSection` per field

**Next:**
- Verify Inter font loads correctly (requires network access for Google Fonts)
- Further dark mode spot-checks on modal and ingest pages

### 2026-04-09 — Phase 8 Styling Refresh (full pass 2)

**Completed:**
- CSS variable system overhauled: rich hunter green (`#166534`) in light mode; vivid neon green (`#4ade80`) + glow shadows in dark mode
- Font upgraded from Arial → Inter (Google Fonts import with Segoe UI fallback)
- Light mode: green-tinted borders (`#d4e8d8`), surfaces (`#f8fdf9`/`#f0faf2`), green-tinted card shadows
- Dark mode: near-black base (`#080e08`), vivid text (`#f0fdf4` primary, `#d1d5db` secondary), neon green glow on card hover
- Active nav link: bottom indicator bar (`box-shadow: inset 0 -2px 0 var(--green)`) + green text
- Home tile count text changed to `--green-vivid` for pop
- All remaining blue hardcoded colors in `BooksLibraryPage.jsx` replaced with vars: `BookRow` hover/selected, `BookGridItem` selected outline, `TriStateItem` text/bg, `SectionHeader` labels, sidebar Filters label, `SearchableTriStateSection` chips, `GenrePicker` chips, table cell text colors
- `GroupedTriStateSection` sub-header label → `var(--text-muted)` (was `#bbb`, unreadable in dark)
- `FORMAT_COLORS` split into light/dark maps with `getFormatColors()` reading `data-theme` at render time
- Transition animations added to home tiles and card items (translateY on hover)

**Next:**
- Verify Inter font loads correctly (requires network access for Google Fonts)
- Further dark mode spot-checks on modal and ingest pages

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
