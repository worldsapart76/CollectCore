# CollectCore — Session Notes

_Format: ### YYYY-MM-DD — brief completed / next summary_
_Keep last 3-5 sessions. Collapse older entries into "Completed to date" block._

> Update this section at the end of each working session with a brief
> summary of what was completed and what is next.

### 2026-04-24 (continued) — Railway live + GN merge + R2 custom domain

**Backend on Railway, end-to-end.** Hobby plan + 5 GB volume mounted at `/data`. Service `collectcore-production.up.railway.app` builds via Railpack (Nixpacks now legacy), Root Directory=`backend`, Procfile boots uvicorn on `$PORT`. Local DB seeded onto the volume via a temporary `/admin/_bootstrap_db` endpoint (added, used, removed in three commits).

**Boot bugs surfaced and fixed during first deploy:**
- `db.py` resolved `SCHEMA_PATH` via `APP_ROOT / "backend" / ...` which assumed local layout — broke on Railway where `Root Directory=backend` puts `db.py` at `/app/db.py`. Anchored to `__file__.parent / "sql" / "schema.sql"` so it works in both layouts.
- `_run_migrations()` ran *before* `executescript(schema_sql)`, so on a fresh DB the Copper Age `UPDATE` crashed against a not-yet-created `lkup_graphicnovel_eras`. Added the same table-existence guard the rename migration uses.

**GN merge from husband's backup** (`docs/collectcore_backup_20260424_192840.zip`):
- 271 GN items in his vs 246 in mine → 25 new, 246 matched (mostly by ISBN; rest by title+series), 1 mine-only deletion ("Hack/Slash VS Chaos #1").
- Divergence report uncovered a real data-quality bug: **every matched item in mine had `top_level_category_id` pointing at "non-album"** (a music category) instead of Marvel/DC/Other. Leftover damage from the canonicalize migration. Merge replaced these with his correct values as a side effect.
- Policy: his = source of truth. Wrote [tools/merge_gn_from_backup.py](tools/merge_gn_from_backup.py) — pre-merge DB backup, name-keyed lookup remapping, full UPDATE of matched details + xrefs (writers/artists/tags), full INSERT of new items, image copy from his backup into `images/library/gn/` with new IDs. Single exception: `cover_image_url` on matched items kept (mine's R2 URLs) — overwriting with his local paths would have broken R2 routing.
- Final GN count: 246 + 25 − 1 = **270 items**. 25 new cover images uploaded to R2 via existing `tools/sync_admin_images.py`. All 270 GN items now serve from R2.
- Pre-merge backup at `data/collectcore_pre_gn_merge_20260424_195322.db`.

**Status visibility seed bug** (latent for weeks, exposed by Railway's frequent restarts):
- `schema.sql` lines 1727-1764 bulk-seeded `xref_ownership_status_modules` and `xref_consumption_status_modules` on every startup via `INSERT OR IGNORE ... CROSS JOIN`. `INSERT OR IGNORE` left existing rows alone, but every time a user *deleted* a row via Admin → Status Visibility (the way "uncheck this status from this module" is implemented), the next backend restart silently re-inserted it. Locally invisible since restarts are rare; on Railway every deploy reset toggles.
- Moved both seeds to [backend/db.py](backend/db.py) `_seed_status_visibility_xref()`, gated on the table being empty so the seed only fires on a truly fresh DB. Same function also cleans up 7 orphan `collection_type_id` rows (61, 62, 94, 155, 202, 258, 274) left in the Railway xref tables by the canonicalize migration. Guest mobile DBs are built by `tools/prepare_mobile_seed.py` and never run `init_db()`, so unaffected.

**Desktop client cutover:**
- `frontend/.env.production` → `VITE_API_BASE_URL=https://collectcore-production.up.railway.app` + `VITE_IS_ADMIN=true`. Loaded by Vite during `npm run build`/`preview` only; dev keeps using the Vite proxy to localhost.
- Deleted 5 dead library files (`CardGridItem`, `CardPairItem`, `CardDetailModal`, `LibraryGrid`, `libraryTransforms`) — leftover pre-rebuild library shells, the only remaining `127.0.0.1` hardcodes in `frontend/src/`.
- Validated end-to-end via `npm run build && npm run preview`: photocard library, all 8 modules, edit-and-persist round-trip all working against Railway+R2.

**Image performance — custom R2 domain:**
- Added `loading="lazy"` + `decoding="async"` to photocard grid + detail-modal `<img>` tags ([PhotocardGrid.jsx](frontend/src/components/photocard/PhotocardGrid.jsx#L254), [PhotocardDetailModal.jsx](frontend/src/components/photocard/PhotocardDetailModal.jsx#L532)). Helped initial paint but `PER PAGE = All` (10K+ cards) still surfaced broken images mid-page — Cloudflare's `pub-*.r2.dev` URL is throttled (development-only).
- Bought `collectcoreapp.com` via Cloudflare Registrar (~$10/yr, no markup). Connected `images.collectcoreapp.com` to the R2 bucket via Cloudflare dashboard → R2 → Custom Domains. Now serves the same content through the full Cloudflare CDN with edge caching.
- Added an idempotent host-rewrite migration to `db.py` that swaps `https://pub-8156609abf504c058e10ac0f5b7f6e95.r2.dev` → `https://images.collectcoreapp.com` across 7 tables / 10,988 rows on next startup. Rewrites both Railway and local DBs automatically; no-op on subsequent runs (LIKE filter).
- `R2_PUBLIC_BASE_URL` updated on Railway + `backend/.env` so future ingests write the new host.

**Known current state of disk:**
- `tmp_merge/` (his.db extract + cover cache + divergence_report.py) is local-only test scaffolding — safe to delete.
- `tools/merge_gn_from_backup.py` is uncommitted — worth keeping as a record of how the GN merge was performed.
- `docs/collectcore_backup_20260424_192840.zip` (his backup, 5 MB) untracked — keep or delete as preferred.
- `data/collectcore_pre_gn_merge_*.db` and `data/collectcore_pre_admin_sync_*.db` — pre-write backups from today's tools, safe to delete after a stable week.
- Cloud DB and local DB are again byte-similar (same schema and rows; only difference is the catalog_version is the same and any minor `updated_at` drift).

**Next:**
1. **Ship cutover installer to husband.** Rebuild via `C:\Dev\CollectCore-Build\build-release.bat`, hand him the new `.exe`. His old install keeps running locally as fallback until he installs the new one — at which point his data becomes the cloud data we just merged.
2. **Other modules' library pages** have inline `<img>` without lazy loading (Books, GN, Music, Video, Video Games, TTRPG, Board Games). Quick sweep — same `loading="lazy" decoding="async"` treatment.
3. **Phase 1 — Capacitor mobile shell.** `npx cap init` in `frontend/`, add Android+iOS, wire `.env.mobile` for guest thin-client. Already unblocked.
4. **Optional cleanups (low priority):** `api.collectcoreapp.com` to replace Railway's generated URL; `images/library/` (~4 GB local originals) safe to delete since nothing in DB references them anymore; latent `APP_ROOT / image_path` bugs in `routers/export.py` and `routers/ingest.py` should be remapped to `DATA_ROOT` before any export/re-ingest is attempted on Railway.

### 2026-04-24 (morning) — Phase 0b complete: Catalog + R2 image hosting (admin + guest)

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

### Completed to date (2026-04-08 through 2026-04-22)
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
- Mobile Phase 0 (2026-04-13): API base URL externalization, imageUrl.js helper, VITE_ENABLED_MODULES config — no `127.0.0.1` hardcodes remain in active code
- Future module schemas fully designed (plan file: pure-inventing-whisper.md)
- Code quality overhaul Waves 1-4 (2026-04-22): CORS hardened, file upload sanitization, dead-code purge, shared style constants/components, collection-type + hidden-status constants, query consolidation (TTRPG/Boardgames detail joins), POST/PUT response standardization, transactional error handling on multi-step writes, `React.memo` on library item components
- GN ingest white-screen fix + collection-types canonicalize/resequence migrations (2026-04-21): `lkup_collection_types` cleaned to canonical IDs 1-8 matching schema.sql seed and `frontend/src/constants/collectionTypes.js`
