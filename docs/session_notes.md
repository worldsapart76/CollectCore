# CollectCore — Session Notes

_Format: ### YYYY-MM-DD — brief completed / next summary_
_Keep last 3-5 sessions. Collapse older entries into "Completed to date" block._

> Update this section at the end of each working session with a brief
> summary of what was completed and what is next.

### 2026-04-24 — Phase 0b complete: Catalog + R2 image hosting (admin + guest)

**Scope clarification mid-session:** Initially built as photocard-Catalog-only (R2 hosts the guest-facing photocard subset). User clarified Path B intent: ALL admin images across all 8 modules must live in R2 so admin mobile can render them. Guest tier remains photocard-only. One bucket, two prefixes: `catalog/` (public, photocards) and `admin/` (unguessable URLs, all modules).

**Completed:**
- **Schema migration** ([backend/migrate_catalog_fields.py](backend/migrate_catalog_fields.py), idempotent; creates timestamped DB backup):
  - Added `tbl_items.catalog_item_id TEXT` + `catalog_version INTEGER`, partial UNIQUE index on catalog_item_id
  - Added `Catalog` ownership status, scoped to photocards only via `xref_ownership_status_modules`
  - Backfilled all 10,015 photocards with `catalog_item_id` derived from the existing attachment filename convention (preserves existing filenames; 866 legacy cards had filename-IDs drifted from `item_id` due to earlier consolidation migration — filename-driven derivation captures them correctly)
  - Fixed 3 pre-existing `schema.sql` drifts uncovered during seed build: added missing `date_read` column and `tbl_photocard_copies` table definition; relaxed `tbl_items.ownership_status_id` to nullable (all 10,015 photocards have NULL here since ownership moved to `tbl_photocard_copies` in the earlier copies migration)
- **New tools** (all idempotent, `--dry-run` supported, DB backup before writes):
  - [tools/publish_catalog.py](tools/publish_catalog.py): resizes photocard images to 600×924 JPEG 80%, uploads to R2 `catalog/images/{catalog_item_id}_{f|b}.jpg`, rewrites `tbl_attachments` to `storage_type='hosted'` with full R2 URL, bumps `catalog_version` globally. Skip rule: attachments already `storage_type='hosted'` are no-ops.
  - [tools/sync_admin_images.py](tools/sync_admin_images.py): migrates all non-photocard cover images (local paths AND remote 3rd-party URLs — Discogs, TMDB, RAWG, Amazon) to R2 `admin/images/{module}/{module}_{id:06d}.jpg`, resized to long-edge 1200px JPEG 85%. Covers books/gn/music/video/videogames/boardgames/ttrpg. Skip rule: `cover_image_url` already pointing at `R2_PUBLIC_BASE_URL` is a no-op.
  - [tools/prepare_mobile_seed.py](tools/prepare_mobile_seed.py): builds guest seed DB containing only photocards + exactly one `Catalog`-status copy each; no admin ownership state leaked. `--upload` flag pushes `seed.db` + `version.json` to R2.
- **Backend endpoints** ([backend/routers/catalog.py](backend/routers/catalog.py), publicly accessible, no auth):
  - `GET /catalog/version` → `{max_version, card_count}`
  - `GET /catalog/delta?since=N` → photocards with `catalog_version > N` (full metadata + R2 image URLs + member list)
  - `GET /catalog/seed.db` → 302 redirect to R2 if `R2_PUBLIC_BASE_URL` set, else `FileResponse` from `data/mobile_seed.db`
  - Registered in [backend/main.py](backend/main.py) and added to `PROXY_PATHS` in [frontend/vite.config.js](frontend/vite.config.js)
- **Admin UI gating** ([frontend/src/utils/env.js](frontend/src/utils/env.js), [frontend/.env.local](frontend/.env.local)): `VITE_IS_ADMIN=true` hides `Catalog` ownership status from all admin pickers via `api.js fetchOwnershipStatuses()` filter. Side effect: added `status_code` to `/ownership-statuses` response — fixed silent breakage in Boardgames/TTRPG/Music/VideoGames ingest pages that referenced `s.status_code === "owned"` (was always `undefined` before).
- **Photocard image rendering fix** — late-session bug found by user: [PhotocardGrid.jsx](frontend/src/components/photocard/PhotocardGrid.jsx#L238) and [PhotocardDetailModal.jsx](frontend/src/components/photocard/PhotocardDetailModal.jsx#L15) hardcoded `${API_BASE}/images/library/${filename}` with a regex that stripped R2 URLs down to just the filename. Replaced with a `resolveCardSrc()` helper that passes `https://` URLs through unchanged (hosted) and falls back to the original local-path + cache-buster behavior (for newly-ingested cards awaiting next publish). Non-photocard modules already used `getImageUrl()` correctly — they rendered R2 URLs fine with no change.
- **R2 initial upload (one-time):**
  - 10,710 photocard images → `catalog/images/`
  - 254 non-photocard covers → `admin/images/` (246 GN + 3 music + 2 VG + 1 video + 1 boardgame + 1 book copy; TTRPG has no covers yet)
  - 3.95 MB seed DB + `version.json` → `catalog/*`
  - Total R2 footprint: ~172 MB
  - Bucket: `collectcore` on account `5dd3976ce9d8e40c2862db2704dbb539.r2.cloudflarestorage.com`; public URL `https://pub-8156609abf504c058e10ac0f5b7f6e95.r2.dev`
- **End-to-end verification:** `/catalog/version` returns `{max_version: 3, card_count: 10015}`; `/catalog/delta?since=0` returns 10,015 cards with R2 URLs; `/catalog/delta?since=3` empty; all 10,710 photocard attachments now `storage_type='hosted'`; every populated non-photocard `cover_image_url` now points at R2.
- **Dependencies:** Added `boto3==1.35.0` to `backend/requirements.txt`.

**Known current state of disk:**
- Admin SQLite DB still local at `data/collectcore.db` (moves to Railway next phase)
- `images/library/` (~4 GB of originals) still on disk — nothing in the DB references them anymore; safe to delete once a week or two of stable running has passed. Pre-migration DB backups remain under `data/collectcore_pre_*.db`.
- Ingest flows still write local files + `storage_type='local'` rows. Sweep-to-R2 is manual via the two CLI tools until ingest is rewritten to upload directly during Railway deployment.

**Next:**
1. **Admin UI visual confirmation** (5 min): confirm `Catalog` is absent from photocard ownership dropdowns + filter sidebar. Code complete, not visually verified.
2. **Railway deployment** (biggest remaining piece): move `backend/` FastAPI + `data/collectcore.db` to Railway; set `VITE_API_BASE_URL` on the Electron desktop build to the Railway URL; once stable, ingest flows should be updated to write images directly to R2 (eliminates the "local fallback" window for newly-ingested cards).
3. **Phase 1 — Capacitor mobile shell** (can run in parallel with Railway): `npx cap init` in `frontend/`, add Android + iOS platforms, `.env.mobile` with `VITE_ENABLED_MODULES=photocards` and `VITE_API_BASE_URL=<railway-url>`. First build = guest thin-client against R2 Catalog. Admin mobile = same shell with `VITE_IS_ADMIN=true` + auth against Railway.
4. **Deferred (post-deployment):** PD1 (admin Catalog publish UI — currently CLI-only), PD2 (trading export/import), PWA offline cache.
5. **Cleanup candidate (low priority):** delete `images/library/` contents once R2 stability is confirmed.

### 2026-04-23 — Lookup admin/management UI (deferred #1)

**Completed:**
- **Deferred item #1 — Lookup admin/management UI.** Added view/edit/merge/re-activate/hard-delete for 38 managed lookup tables behind a new "Lookup Management" tab on the Admin page.
  - **New file:** [backend/routers/admin_lookups.py](backend/routers/admin_lookups.py) with a single `_LOOKUP_REGISTRY_LIST` (38 entries) as the source of truth for both the new management endpoints and the existing Unused Lookup Cleanup scanner. Each entry carries PK/name/sort/secondary columns, scope chain, refs (with per-ref `dedupe_cols` for xref uniqueness), and `cleanable`/`mergeable` flags.
  - **Endpoints:** `GET /admin/lookups/registry`, `GET /admin/lookups/{table}` (rows with usage counts + resolved scope names + scope_options), `PATCH /admin/lookups/{table}/{id}` (rename/sort/re-activate/secondary), `POST /admin/lookups/{table}/merge` (transactional FK rewrite with NULL-safe `IS` dedup), `DELETE /admin/lookups/{table}/{id}` (guarded: must be inactive + 0 refs).
  - **Merge guards:** 6 tables are flagged `mergeable=False` because a merge would cascade into child lookup tables or destroy rich copy-row data — `lkup_photocard_groups`, `lkup_book_format_details`, and the four top-level genre tables (book/game/music/video). Cross-scope merges return 400; UNIQUE rename conflicts return 409 with a "Consider merging" hint.
  - **Refactor:** `admin.py` scan/deactivate now derive their cleanable list from `cleanable_lookups_for_scan()` — the original Unused Lookup Cleanup behavior is preserved (verified: same 9 groups returned pre/post refactor).
  - **Frontend:** New "Lookup Management" tab in [AdminPage.jsx](frontend/src/pages/AdminPage.jsx) — table picker, name filter, show-inactive toggle, per-scope dropdowns, inline edit, active toggle, hard-delete button (gated on inactive + 0 refs), and a merge modal that only offers same-scope active candidates.
  - **E2E verified** against live SQLite: list/PATCH round-trip, UNIQUE conflict → 409, merge (unused→unused) rewrites+deactivates source, hard-delete of just-merged row succeeds, non-mergeable table → 400, cross-scope merge → 400, hard-delete of active row → 409.
- **CLAUDE.md:** Removed item #1; added a new deferred item for Admin UI polish — current layout is functional but clunky and needs design-pass after the broader CSS/design-system consolidation.

**Next:**
- Continue deferred items triage.

### 2026-04-21 — GN ingest fix, deferred list cleanup, collection type canonicalization

**Completed:**
- **Deferred item #2 (GN ingest white screen crash):** Root cause was a missing `getImageUrl` import in `frontend/src/pages/GraphicNovelsIngestPage.jsx`. The `ManualForm` cover preview called `getImageUrl(form.coverImageUrl)` but the helper was never imported, throwing a `ReferenceError` that React surfaced as a white screen whenever a cover URL was set. Triggered reliably by Comic Vine keyword results (which always include a cover); masked for manual entry and Google Books lookups without covers. Fixed with a one-line import from `../utils/imageUrl`.
- **Deferred item #3 (Google Books rate limiting):** Already resolved — `GOOGLE_BOOKS_API_KEY` is now applied to both Books and Graphic Novels routers via the shared `external_apis.py` helpers (previously only GN had keyed access). Removed from deferred list.
- **Deferred items #1 (ownership status dropdown) and #2 (consumption status rename + cross-contamination):** Already resolved by the 2026-04-22 Wave 4 Unified Status Visibility System — `lkup_consumption_statuses` rename is in `schema.sql`, both `xref_ownership_status_modules` and `xref_consumption_status_modules` junctions exist, all 8 modules filter by `collection_type_id`, and `hiddenStatuses.js` was deleted. Removed both from deferred list.
- **Deferred item #1 (collection type ID resolution):** Fully canonicalized `lkup_collection_types` so the live DB matches what `schema.sql` seeds on a fresh install.
    - `migrate_collection_types_canonicalize.py`: deleted the zero-reference orphan duplicates (IDs 61/62 for `photocards`/`books`) plus four orphan `lkup_top_level_categories` rows (IDs 8–11); renamed the surviving legacy singular codes `photocard`→`photocards` and `book`→`books` (with matching `collection_type_name` updates).
    - `migrate_collection_types_resequence.py`: remapped the non-sequential IDs 94/155/202/258/274 to 4/5/6/7/8 for videogames/music/video/boardgames/ttrpg; updated all FK references in `tbl_items` and `lkup_top_level_categories`, then the PK in `lkup_collection_types`; reset `sqlite_sequence` so new rows continue from 9.
    - Updated `backend/constants.py` to look up by the new plural codes.
    - Updated `frontend/src/constants/collectionTypes.js` to IDs 1–8, matching both the live DB and any fresh install going forward.
    - Pre-migration backup: `F:/Dropbox/Apps/CollectCore/data/backups/collectcore_pre_collection_types_canonicalize_20260422_200932.db`.
- **CLAUDE.md:** Five resolved items removed in total; deferred list renumbered (now 1–4).

**Next:**
- Continue deferred items triage.

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

### 2026-04-22 — Unified Status Visibility System + deferred items triage

**Completed:**
- **Deferred items triage (partial):** Reviewed items #1–#2 from CLAUDE.md deferred list
  - **#1 (Image ingest rebuild):** Investigated, confirmed already implemented — removed from deferred list
  - **#2 (Ownership status dropdown) + #16 (Read/consumption status cross-contamination):** Identified as same root cause, designed and implemented unified solution (see Wave 4 below)
  - Items #3–#15 reviewed and categorized (defer vs fix) — awaiting user decisions
- **Wave 4: Unified Status Visibility System** (resolves former deferred #2, #8, #16):
  - **Schema:** Renamed `lkup_book_read_statuses` → `lkup_consumption_statuses` via migration in `db.py`; added `xref_ownership_status_modules` and `xref_consumption_status_modules` junction tables for per-module visibility scoping; seeded xref with all-modules-enabled defaults
  - **Backend:** Updated `GET /ownership-statuses` to accept optional `collection_type_id` filter via xref JOIN; added `GET /consumption-statuses?collection_type_id=` endpoint (replaces module-specific `/read-statuses`, `/play-statuses`, `/watch-statuses`); added `GET/PUT /admin/status-visibility` endpoints for Admin grid management
  - **Backend cleanup:** Updated all module routers (`books`, `graphic_novels`, `video`, `videogames`) to reference `lkup_consumption_statuses`; removed 3 module-specific status endpoints
  - **Frontend:** All 8 modules now pass `collection_type_id` when fetching ownership/consumption statuses; deleted `frontend/src/constants/hiddenStatuses.js` — all filtering is now DB-driven
  - **Admin page:** Rewrote with 4-tab layout (Modules, Backup & Restore, Lookup Cleanup, Status Visibility); Status Visibility tab has checkbox grid (statuses × modules) with optimistic UI updates and rollback on failure
  - **Migration:** Copper Age era deactivated via migration (removed from seed data)
- **CLAUDE.md updated:** Removed stale Image Ingest section, added accurate Image Handling section, removed resolved deferred items (#1, #8, #16), updated deferred #4 with Admin tab note, updated Railway prerequisites

**Next:**
- Continue deferred items triage: user decisions pending on #3–#15
- Bug fix candidates: #14 (GN ingest crash), #13 (BGG search verification)
- Test the new Status Visibility admin grid end-to-end

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
