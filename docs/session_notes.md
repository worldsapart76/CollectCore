# CollectCore — Session Notes

_Format: ### YYYY-MM-DD — brief completed / next summary_
_Keep last 3-5 sessions. Collapse older entries into "Completed to date" block._

> Update this section at the end of each working session with a brief
> summary of what was completed and what is next.

### 2026-04-21 — Code quality overhaul Wave 4 complete

**Completed (Wave 4 — Query Optimization & Consistency):**
- **4A — TTRPG detail query consolidation:** `_get_ttrpg_detail()` reduced from 8 queries to 3 — folded 4 conditional single-row lookups (system_edition, line, book_type, publisher) into LEFT JOINs on the main query. Column indices updated in the return dict.
- **4A — BoardGames detail query consolidation:** `_get_boardgame_detail()` reduced from 4 queries to 3 — folded conditional publisher lookup into a LEFT JOIN on the main query.
- **4B — Photocards POST/PUT full object return:** Added `_get_photocard()` helper; `create_photocard` and `update_photocard` now return `{"item_id": ..., "status": ..., "photocard": <full object>}`, matching all other modules. Frontend only reads `item_id` so this is backwards-compatible.
- **4C — Videogames error handling:** Wrapped multi-step writes in `create_videogame` and `update_videogame` with `try/except + db.rollback()`, preventing partial writes on error.
- **4C — Boardgames error handling:** Same pattern applied to `create_boardgame` and `update_boardgame`.
- **4D — React.memo on library item components:** `BookGridItem`, `BookRow` (BooksLibraryPage), and `GnGridItem` (GraphicNovelsLibraryPage) wrapped with `memo()` to skip re-renders when props are unchanged. Added `memo` to named React imports in both files.

**Next:**
- CLAUDE.md Deferred Items #1 (image field schema finalization) and #3 (photocard copy/edition sub-table refactor) are the blocking prerequisites for Railway deployment

### 2026-04-22 — Code quality overhaul Waves 1-3 complete

**Completed (Wave 3 — Frontend Structural Refactor):**
- **3A — Shared style constants:** Created `frontend/src/styles/commonStyles.js` with 14 shared style objects (labelStyle, inputStyle, selectStyle, btnPrimary, btnSecondary, btnSm, btnDanger, alertError, alertSuccess, alertWarn, row2, sectionStyle, sectionLabel, GRID_SIZES). Removed duplicate definitions from 14 pages (7 library + 7 ingest).
- **3B — Shared NameList component:** Created `frontend/src/components/shared/NameList.jsx` with unified `addLabel` + `placeholder` props (defaults to "+ Add"). Replaced 12 local definitions (NameList, AuthorList, ArtistList) across library and ingest pages.
- **3C — Shared SegmentedButtons/ToggleButton:** Created `frontend/src/components/shared/SegmentedButtons.jsx` using CSS variables (adopted the GN variant over Books' hard-coded colors). Removed duplicates from BooksLibraryPage and GraphicNovelsLibraryPage.
- **3D — Collection type constants:** Created `frontend/src/constants/collectionTypes.js` with `COLLECTION_TYPE_IDS` map. Updated PhotocardLibraryPage, InboxPage, ExportPage, InboxManager, and BooksIngestPage to use centralized constants.
- **3E — Hidden status sets:** Created `frontend/src/constants/hiddenStatuses.js` with `HIDDEN_OWNERSHIP_NAMES`, `HIDDEN_READ_STATUS_NAMES`, `HIDDEN_ERA_NAMES`. Removed 14 duplicate definitions across library and ingest pages.
- InboxPage retains its own style block (uses hard-coded colors, not CSS variables — intentional photocard-specific variant).

**Next:**
- Wave 4: Query optimization & consistency (N+1 queries, standardize API responses, error handling)

### 2026-04-22 — Code quality overhaul Wave 1 complete

**Completed (Wave 1 — Safety & Cleanup):**
- **Code audit:** Full backend + frontend + infrastructure audit identifying 20+ issues across security, duplication, dead code, hard-coded values, and missing infrastructure. 4-wave remediation plan created (`C:\Users\world\.claude\plans\streamed-greeting-plum.md`).
- **CORS hardened (1A):** Replaced `allow_origins=["*"]` with `["http://localhost:5181"]`, configurable via `CORS_ORIGINS` env var. Removed `allow_credentials=True`.
- **File upload sanitized (1B):** Ingest upload now uses `Path(file.filename).name` to strip directory traversal. `_replace_image` validates old file paths stay within `IMAGES_DIR` before deletion.
- **Dead code removed (1C):** Deleted `frontend/src/services/` (unused API layer with hard-coded localhost), `frontend/src/pages/LibraryPage.jsx` (unrouted legacy page), `backend/models.py` (unused ORM models). Removed empty `allMembers` useMemo from PhotocardLibraryPage.
- **Error handling fixed (1D):** GN library `Promise.all` silent `.catch(() => {})` replaced with `console.error` logging.
- **`.env.example` added (1E):** Documents all required/optional env vars.
- **Logging added (1F):** Replaced `print()` calls in `main.py` and `db.py` with Python `logging` module.
- **Vite proxy bypass (bugfix):** Direct URL navigation to `/{module}/library` or `/{module}/add` was broken (Vite proxied to backend, which returned 422). Added `bypass` function to vite proxy config to serve `index.html` for frontend sub-paths.
- **Grid cache busting (bugfix):** PhotocardGrid image URLs now include `?v=${Date.now()}` cache buster (modal already had this; grid was showing stale images after front replacement).

**Next:**
- Wave 2: Backend structural refactor (dependency injection, generic helpers, split main.py into routers)
- Wave 3: Frontend structural refactor (shared styles, shared components, centralized constants)
- Wave 4: Query optimization & consistency

### 2026-04-21 — Photocard copies migration complete

**Completed:**
- **`tbl_photocard_copies` sub-table:** New table with `copy_id`, `item_id`, `ownership_status_id`, `notes`, `created_at`. Ownership now lives per-copy, not on `tbl_items`. Pattern mirrors `tbl_book_copies`.
- **Duplicate review tool:** Built `frontend/public/review-duplicates.html` — standalone HTML tool to review 111 duplicate groups (303 cards) with images side-by-side, select main vs sub-edition vs unique per group, export mapping JSON.
- **Data migration:** `backend/migrate_photocard_copies.py` — created copy rows for all 10,185 photocards, merged 170 sub-edition records into 99 main records (re-parented copies, deleted sub-edition items + 330 image files), nulled out `ownership_status_id` on `tbl_items` for all photocard rows. 28 unique cards identified and preserved. Final: 10,015 photocards, 10,185 copy rows.
- **Backend updates:** `_PHOTOCARD_SELECT` returns copies array via `_attach_copies()` helper; `POST /photocards` + ingest endpoints create first copy row; `PUT /photocards` no longer touches ownership/notes; `PATCH /photocards/bulk` ownership updates target `tbl_photocard_copies`; new copy CRUD: `POST/PUT/DELETE /photocards/{id}/copies/{copy_id}` with last-copy protection.
- **Owned/Wanted mutual exclusion:** Backend constraint prevents having both Owned and Wanted copies on the same card.
- **Grid badge overhaul:** Bottom-left shows `O` (green) or `W` (yellow) — mutually exclusive. Bottom-right shows other statuses concatenated (`T2P`, etc.). Special star moved to top-right.
- **Detail modal:** Ownership dropdown and notes field replaced with inline copies sub-table (ownership select + notes input per copy, add/delete copy buttons).
- **Library filter/count:** Ownership filter checks copies (card appears if any copy matches). Copy count shown alongside card count. Notes search includes copy notes.
- **Bulk edit:** Ownership update targets all copies; notes field removed; mixed-status warning dialog before applying.

**Next:**
- Update `docs/collectcore_summary.md` with new `tbl_photocard_copies` table and updated endpoints
- Update plan file status to reflect completion
- End-to-end testing of remaining flows (ingest, export, bulk operations)

### 2026-04-13 — Mobile Phase 0: desktop code prep

**Completed:**
- **API base URL externalized** — `api.js` and all pages now derive the base URL from `VITE_API_BASE_URL` env var (defaults to `''` → Vite proxy unchanged for desktop). No `http://127.0.0.1:8001` hardcodes remain in active code.
- **`imageUrl.js` helper created** — `frontend/src/utils/imageUrl.js` exports `API_BASE` and `getImageUrl(filePath, storageType)`. Handles local (default) and hosted (R2) image types transparently.
- **All hardcoded URLs replaced** — `InboxPage.jsx`, `PhotocardDetailModal.jsx`, `PhotocardGrid.jsx`, `GraphicNovelsLibraryPage.jsx`, `GraphicNovelsIngestPage.jsx`, `VideoLibraryPage.jsx`, `MusicLibraryPage.jsx`, `VideoGamesLibraryPage.jsx`, `TTRPGLibraryPage.jsx`, `BoardgamesLibraryPage.jsx` all now use `API_BASE` / `getImageUrl`. `TopNav.jsx` shutdown call fixed (was using wrong port 8000); `/shutdown` added to Vite proxy paths.
- **`VITE_ENABLED_MODULES` config** — `modules.js` exports `activeModules`, filtered by env var. Desktop default (unset) = all modules shown, alphabetically sorted. Mobile: set `VITE_ENABLED_MODULES=photocards` to show only photocards.
- **Single-module redirect** — `App.jsx` redirects `/` to the module's `primaryPath` when only one module is active. Multi-module builds unchanged.

**Next:**
- Design Phase — resolve 16 design questions (see plan) before Phase 1 (Capacitor setup)
- Phase 0b — R2 setup + seed DB prep can start in parallel once design questions are answered

### Completed to date (2026-04-08 through 2026-04-13)
- Photocard module: full rebuild (library, ingest, export, filters, bulk edit, modal nav/auto-save, filter state persistence, copies sub-table migration)
- Books module: v1 complete (schema, CRUD, ingest with ISBN/external search, library with filters/grid/bulk, Goodreads migration of 4,724 records)
- Graphic Novels module: v1 complete (multi-source series, ISBN lookup with multi-result picker, grid view, thumbnails, cover management)
- Video Games module: v1 complete (RAWG search, platform datalist, genre picker)
- Music module: v1 complete (Discogs search, 3-layer release/songs/editions, track list editor)
- Video module: v1 complete (TMDB integration, TV seasons vs movie copies routing)
- Board Games module: v1 complete (BGG search, expansions sub-editor, designer M:N)
- TTRPG module: v1 complete (system editions/lines scoped lookups, copies with per-copy ISBN)
- Shared filter sidebar system (FilterSidebar.jsx with tri-state toggles)
- CSS variable system + Inter font + green palette (light + dark mode)
- Admin: Backup & Restore (SQLite hot-copy + images ZIP)
- Build & release pipeline (Inno Setup installer, PowerShell launcher)
- Seed data for fresh installs
- Mobile Phase 0: API base URL externalization, imageUrl.js helper, VITE_ENABLED_MODULES config
- Future module schemas fully designed (plan file: pure-inventing-whisper.md)
