# CollectCore — Project Briefing for Claude Code

## Cross-Project Architecture

Decisions spanning multiple projects (Unraid infrastructure, hosting path, open
strategic decisions): `C:\Dev\ARCHITECTURE.md`

---

## Project Overview

CollectCore is a multi-collection tracker application supporting multiple
collection types with consistent UI patterns and workflows across all modules.

**All 8 modules implemented:** Photocards, Books, Graphic Novels, Music, Video,
Video Games, TTRPG, Board Games

---

## Stack

- **Backend:** Python + FastAPI + SQLite — DEPLOYED on Railway
- **Frontend:** React + Vite — SPA served from Railway at apex domain
- **Image hosting:** Cloudflare R2 (custom domain `images.collectcoreapp.com`)
- **Auth:** Cloudflare Access + Google IdP (in-progress as of 2026-04-25; see Auth section)
- **Production URL (admin):** `https://collectcoreapp.com`
- **Production URL (API direct, machine-to-machine):** `https://api.collectcoreapp.com`
- **Dev environment:** Windows, `C:\Dev\CollectCore`. Local backend on port 8001 + Vite dev server on port 5181 with proxy to localhost. Used for development only — production is cloud.

---

## Core Architecture

CollectCore uses a shared item table + collection-specific detail tables:

- `tbl_items` — shared record for all collection types
- `tbl_photocard_details` + `tbl_photocard_copies` — photocard fields + per-copy ownership
- `tbl_book_details` + `tbl_book_copies` — book fields + per-copy ownership
- `tbl_graphicnovel_details` — graphic novel fields
- `tbl_music_releases` + `tbl_music_editions` + `tbl_music_songs` — 3-layer music model
- `tbl_video_details` + `tbl_video_seasons` + `tbl_video_copies` — video fields
- `tbl_videogame_details` + `tbl_game_copies` — video game fields + per-platform copies
- `tbl_ttrpg_details` + `tbl_ttrpg_copies` — TTRPG fields + per-copy ownership
- `tbl_boardgame_details` + `tbl_boardgame_expansions` — board game fields
- Shared lookup tables for collection types, categories, and ownership
- Collection-specific lookup tables for groups, members, source origins, platforms, etc.

`collection_type_id` differentiates modules throughout the system.

---

## Active Modules

All 8 modules are v1-complete with full CRUD, library (filter sidebar + table/grid
views), bulk edit/delete, and ingest.

- **Photocards** — image ingest, library, export; copies sub-table (per-copy ownership)
- **Books** — manual entry, ISBN lookup, external search, Goodreads migration (4,724 records)
- **Graphic Novels** — ISBN lookup with multi-result picker, cover image management
- **Music** — Discogs search, 3-layer release/songs/editions model, track list editor
- **Video** — TMDB integration, TV seasons vs. movie copies routing
- **Video Games** — RAWG search, platform copies (`tbl_game_copies`), genre picker
- **TTRPG** — system editions/lines scoped lookups, per-copy ISBN
- **Board Games** — BGG search (see Deferred #13), expansions sub-editor, designer M:N

---

## UI Design Principles

Key UI principles — consistent across all modules:

- Compact and dense layout — minimal whitespace
- Button-driven interaction preferred over free typing
- Guided controls to prevent invalid input
- High efficiency for repeated actions (batch ingest, bulk edit)
- Two-panel layout: left sidebar filters, main content area

Do NOT redesign the UI structure without explicit instruction.

---

## Image Handling

Photocards use a two-phase inbox pipeline: front images create records, back
images attach to existing records. Implemented in `InboxPage.jsx` +
`backend/routers/ingest.py`.

**Production state (post-cutover 2026-04-24):**
- All photocard images live in R2 under `catalog/images/{catalog_item_id}_{f|b}.jpg`
  (resized to 600×924 JPEG q80). `tbl_attachments.storage_type = 'hosted'`,
  `file_path` is the full R2 URL via `images.collectcoreapp.com`.
- All non-photocard cover images live in R2 under
  `admin/images/{module}/{module}_{id:06d}.jpg` (long-edge 1200px JPEG q85).
  `cover_image_url` is the full R2 URL.
- Local-tier ingest still writes files to `images/library/` and rows with
  `storage_type='local'` initially, but admin tools (`tools/publish_catalog.py`
  for photocards, `tools/sync_admin_images.py` for cover images) sweep them
  to R2 and rewrite the DB rows. Direct-to-R2 ingest is future work.
- Local-only paths to know:
  - Staging during ingest: `images/inbox/` → `images/library/` (then swept to R2)
  - Filename convention: `{group_code}_{id:06d}_{f|b}.{ext}`
  - Cache busting via `?v=mtime` (relevant for local-mode rows only; R2 URLs
    use immutable filenames)

**Image rendering helpers:**
- Photocards: `resolveCardSrc()` in [PhotocardGrid.jsx](frontend/src/components/photocard/PhotocardGrid.jsx)
  passes `https://` URLs through and falls back to local-path + cache-buster
  for newly-ingested cards awaiting next publish.
- Non-photocards: `getImageUrl()` shared helper. Renders R2 URLs unchanged.

---

## Known Shortcuts

The following are intentional simplifications. Do not "fix" these unless explicitly
instructed:

- Direct image upload to R2 not implemented; admin tools sweep local-staged
  images to R2 in batches (`tools/publish_catalog.py`, `tools/sync_admin_images.py`)
- Option tables derived from card data, not authoritative lookups
- No virtualization or performance layer (lazy-load on `<img>` is the only
  perf concession; library "All" view of 10K+ cards still renders eagerly otherwise)
- Inline styling in many places (no full design system; CSS variables + Inter font
  + green palette is the baseline)
- Export logic is still photocard-specific
- UI is desktop-density (sidebar + table). Responsive/mobile-friendly layout
  is the next priority and a prerequisite for the guest webview.

---

## Key Schema Decisions

- `subcategory` has been removed — do not reintroduce it
- `source_origin` and `version` are now distinct concepts
  - source_origin = release/event origin (e.g., `5-STAR`)
  - version = specific variation (e.g., `Soundwave POB`)
- `source_origin_id` is explicitly nullable — all queries must use LEFT JOIN
- `member` is no longer a scalar field — stored in `xref_photocard_members`
- Categories and ownership resolve through shared lookup tables
- Source origins are scoped by `group_id` + `top_level_category_id`
- `format` field: module-specific (not on `tbl_items`). Each module handles
  format via its own copy/edition sub-table or field.
- Tags: book-specific tags implemented (`lkup_book_tags`). Cross-collection
  tag architecture remains deferred — do not add tags to new modules
  without explicit decision.

---

## Deferred Items (Prioritized)

These are intentionally not yet built. Do not implement without instruction:

All completed as of 4/23/2026

---

## Reference Documentation

All docs are in the `docs/` folder. Use these as authoritative references:

| File | Purpose |
|---|---|
| `docs/release-guide.md` | **HISTORICAL** — describes the now-retired desktop installer flow. Cloud release flow is documented inline in CLAUDE.md → Build & Release. |
| `docs/collectcore_summary.md` | Schema changes, active endpoints, current implementation state |
| `docs/collectcore_books_module_design.md` | Books module design decisions and history |
| `docs/collectcore_books_module_plan.md` | Books implementation plan — finalized decisions, schema, phases, known gaps |
| `docs/collectcore_books_v1_schema_proposal.md` | Books module v1 schema reference |
| `C:\Users\world\.claude\plans\pure-inventing-whisper.md` | **Future modules plan** — full schema decisions for all 5 modules (all now implemented; plan file remains as schema reference) |
| `C:\Users\world\.claude\plans\fancy-stirring-hollerith.md` | **PARTIALLY SUPERSEDED 2026-04-25** — Capacitor mobile sections shelved (mobile build deferred indefinitely in favor of responsive web); hosting + Path A/B sections still useful as architectural context. Use only for historical reference; current state is in CLAUDE.md → Hosting / Auth / Multi-User Model sections. |
| `docs/session_notes.md` | Working session history — completed work and next steps. **2026-04-25 entry** documents the apex-SPA cutover, Cloudflare Access auth, and web-only guest pivot in detail. |
| `docs/guest_deploy_runbook.md` | Step-by-step checklist for taking `collectcoreapp.com/guest/` live (build, Cloudflare Access bypass for `/guest/*`, smoke test, rollback). No new domain or DNS — guest shares the apex via path mount. Code prep landed 2026-04-26; runbook is the deploy-time clicks. |

---

## Implementation Status

All 8 modules are v1-complete. The active endpoint list in `docs/collectcore_summary.md`
is the authoritative source for what is currently built and working.

---

## Backup & Restore

The Admin page has Backup and Restore functions (`GET /admin/backup`,
`POST /admin/restore`).

**New modules require no changes to backup** — the SQLite backup is a
complete hot-copy of the entire database, so any tables added by future
modules are captured automatically. The images directory is also backed
up wholesale.

**Checklist items when building a new module:**
1. Add the module's route prefix to `PROXY_PATHS` in `frontend/vite.config.js`.
   Used by the local Vite dev server only, but omitting it causes all API
   calls during `npm run dev` to return HTML instead of JSON, producing:
   `Unexpected token '<', "<!doctype "... is not valid JSON`
2. Verify that any module-specific file assets stored outside `images/library/`
   are covered by the backup. If a new module stores files in a different
   directory, update `GET /admin/backup` to include that directory in the ZIP.
3. If the module's API path could collide with a SPA route name
   (e.g., `/photocards/library` matching both an API and a SPA path), the
   `spa_host_routing` middleware in `main.py` already handles this correctly
   for the apex host. No changes needed; just be aware.
4. After deploying: rebuild dist (`npm run build`) and commit
   `backend/frontend_dist/` so the SPA picks up the new module.

---

## Hosting

**LIVE on Railway + Cloudflare R2 as of 2026-04-24.** Originally decided
2026-04-21 (canonical history in `C:\Dev\ARCHITECTURE.md` Decision A).

- **Backend:** FastAPI on Railway. `Root Directory=backend`, Procfile boots
  uvicorn on `$PORT`. SQLite DB on a 5GB Railway Volume mounted at `/data`.
- **Frontend (admin):** React SPA built into `backend/frontend_dist/`,
  committed to git, served from Railway via `register_frontend_static()`
  in `routers/admin.py`. SPA renders at the apex domain;
  `spa_host_routing` middleware in `main.py` routes by `Host` header so
  apex paths return `index.html` (avoiding API route collisions like
  `/photocards/library` matching the books detail route).
- **Frontend (guest):** Separate React build via `npm run build:guest`,
  outputs to `backend/frontend_dist_guest/` with `base='/guest/'` and
  `assetsDir='guest-assets'` — bundle ships at
  `collectcoreapp.com/guest/` with assets under `/guest/guest-assets/`.
  Same `spa_host_routing` middleware in `backend/main.py` does
  path-based routing — `/guest/*` GETs return the guest bundle's
  `index.html`, everything else returns admin's. **Path-based mount,
  not a subdomain** — Railway free tier is capped at 2 custom domains
  (api + apex) and the design intentionally avoids needing a third.
  Bundle is NOT yet committed to git or deployed — see
  `docs/guest_deploy_runbook.md` for the deploy sequence (just one
  step: add a Cloudflare Access bypass app for the `/guest` path).
  Guest UI lives in `frontend/src/guest/` (GuestBootstrap, WelcomeModal,
  GuestPhotocardDetailModal, GuestMenuItems, guestData adapter,
  sqliteService + worker). Reuses admin's `PhotocardLibraryPage` with
  data-source branching and isAdmin-gated controls (Path A).
- **Images:** Cloudflare R2, served via custom domain
  `images.collectcoreapp.com`. `tbl_attachments.storage_type = 'hosted' | 'local'`
  but in practice all production rows are 'hosted'.
- **Custom domains (all on Cloudflare proxy / orange cloud):**
  - `collectcoreapp.com` — admin SPA at `/`, guest SPA at `/guest/*`
    (path-mounted to stay within the Railway free-tier 2-custom-domain limit)
  - `api.collectcoreapp.com` — API (also used for machine-to-machine and
    by the lingering desktop installer until users uninstall)
  - `images.collectcoreapp.com` — R2 public asset CDN
  - `collectcore-production.up.railway.app` — Railway's auto-generated URL.
    Marked as the "primary service domain" by Railway, so leave it in place;
    deletion has unclear side effects per the dashboard warning.
- **Scope:** CollectCore only. MediaManager, Calibre Content Server, Jellyfin
  still target Unraid.
- **Fallback:** Unraid self-hosting retained in ARCHITECTURE.md Decision A
  if cloud ever becomes unworkable.

---

## Auth

**DECIDED 2026-04-25: Cloudflare Access with Google as identity provider.**

- Gates `collectcoreapp.com` and `api.collectcoreapp.com` at Cloudflare's edge
  before requests reach Railway
- Free tier (50 users) — household scale
- ZERO code changes in CollectCore. Auth happens at the network layer.
- Single Cloudflare Access Application covering both apex + api subdomain so
  cookies are shared cross-subdomain (SPA at apex can fetch from api.* without
  re-authentication)
- **Bypass policy for `/catalog/*` paths** so the guest webview (future) and any
  guest mobile clients (further future) can hit the read-only catalog endpoints
  without authentication
- Identity headers (`Cf-Access-Authenticated-User-Email`) passed through to
  FastAPI so when in-app identity logic eventually lands (per-user
  attribution, etc.), the user identity is available without rebuilding auth
- Trivially reversible: delete the Access app + Google OAuth client = gate gone,
  no code to revert, no user data migration. Migration path to Auth0/Clerk later
  is open.
- **Status as of 2026-04-25:** Cloudflare Zero Trust account created (team:
  `collectcore`). Google OAuth client setup in progress. Full setup steps in
  `docs/session_notes.md` 2026-04-25 Thread 7.

---

## Multi-User Model

**Two-tier model, both web-only as of 2026-04-25 pivot.** ARCHITECTURE.md
Decision B was originally for cloud admin + local-mobile guest; the local-mobile
guest is now a local-web guest instead. See `docs/session_notes.md` 2026-04-25
Thread 8 for the full reasoning.

- **Admin tier** (household only): Cloudflare Access auth via Google, full CRUD
  against Railway, all images on R2. Uses `https://collectcoreapp.com`.
- **Guest tier** (friends, future): no account, no login. Webview at
  `https://collectcoreapp.com/guest/` (path-mounted on the apex, code-
  complete as of Phase 7 2026-04-26 but not yet deployed — the only
  remaining step is adding a Cloudflare Access bypass app for the
  `/guest` path; see `docs/guest_deploy_runbook.md`). WASM SQLite in
  browser (`@sqlite.org/sqlite-wasm`, persisted to OPFS via SAHPool VFS)
  holds the guest's local catalog + annotations. Pulls catalog snapshot
  from R2 on first visit, pulls deltas from Railway `/catalog/*`
  endpoints (Cloudflare Access bypass) thereafter. No writes against the
  cloud DB ever.

**Capacitor mobile is INDEFINITELY DEFERRED.** The `mobile-shell` branch holds
the Phase 1 scaffold (Capacitor + Android Gradle project + mode-aware Vite
config + `.env.mobile`) as a reference if we ever need it. Mobile users get
the responsive web app instead — same URL, same data, no app store.

---

## Catalog Architecture (unchanged from 2026-04-23 decision)

Shared card set modeled as snapshot-plus-delta. Admin's `tbl_items` with
`catalog_item_id IS NOT NULL` IS the Catalog. Guests download full snapshot on
first visit, pull deltas thereafter. `catalog_item_id` uses the existing
`{group_code}_{id:06d}` image filename convention — no UUIDs needed. New
`Catalog` ownership status added to photocards only, hidden from admin UI via
`VITE_IS_ADMIN` flag.

**Admin catalog publish UI**: CLI-only for v1 (`tools/publish_catalog.py`).
In-app publish flow is item PD1 in the post-deployment roadmap.

**Backend endpoints** (publicly accessible via Cloudflare Access bypass):
- `GET /catalog/version` → `{max_version, card_count}`
- `GET /catalog/delta?since=N` → raw table-row deltas the guest worker
  replays into its local SQLite mirror with `INSERT OR REPLACE`. Shape:
  `{ since, max_version, tables: { tbl_items, tbl_photocard_details,
  xref_photocard_members, tbl_attachments, lkup_photocard_groups,
  lkup_photocard_source_origins, lkup_photocard_members,
  lkup_top_level_categories } }`. Lookup tables only include rows
  referenced by changed items. **No tombstones yet** — admin has no
  remove-from-catalog flow today; tombstones land alongside the admin
  publish UI (PD1). A pure lookup edit (e.g. group rename) won't
  propagate until something bumps a related item's catalog_version —
  known limitation.
- `GET /catalog/seed.db` → 302 redirect to R2 `catalog/seed.db`

**Guest-side schema (`guest_` / `v_guest_` prefix = sync-untouchable):**
- `guest_meta(key, value)` — KV store. Holds `last_synced_catalog_version`.
- `guest_card_copies(copy_id, catalog_item_id, ownership_status_id, notes, ...)`
  — per-card guest annotations. Mirrors admin's `tbl_photocard_copies` model
  (multi-copy per card with Owned/Wanted/etc. status) but keyed by the
  contractually-stable `catalog_item_id` so rows survive a full seed reset.
- `v_guest_library_photocards` — read target for the future guest library.
  Joins catalog `tbl_items` + `tbl_photocard_details` + LEFT JOIN
  `guest_card_copies` (catalog cards with no annotation surface as
  `guest_*` columns NULL). Phase 4b will UNION ALL guest-added cards into
  this view.
- **Guest-added cards (Phase 4b) deferred** until a real guest library page
  exists to consume them. Schema decisions made: flat `guest_added_photocards`
  table, separate `guest_added_attachments` for local-only images
  (R2 upload not in scope for guests, ever), `guest_added_members_xref`
  for member tags.

**Guest backup/restore (Phase 5):** every `guest_%` table snapshots to JSON
via `exportGuestBackup()` in `sqliteService.js`. Tables are discovered
dynamically from `sqlite_master` so future guest tables are auto-included.
Format: `{ version: 1, exported_at, tables: { table_name: [...rows] } }`.
Restore is replace-strategy (DELETE all then INSERT, SAVEPOINT-wrapped) and
tolerates extra/missing columns by binding only what the destination table
declares. `guest_meta.last_backed_up_at` stamped on successful export so the
future UI can show "Last backed up: N days ago." OPFS is durable-on-best-
effort — the JSON snapshot is the only recovery path if site data is cleared
or the device is lost.

---

## Build & Release

**The desktop installer is RETIRED as of 2026-04-25.** Husband (and any
admin user) bookmarks `https://collectcoreapp.com` instead. No more `.exe`
distribution.

**Frontend release flow:**
1. `cd frontend && npm run build` → outputs to `backend/frontend_dist/`
2. `git add backend/frontend_dist/ backend/ frontend/`
3. `git commit && git push`
4. Railway auto-deploys (~60-90s)
5. Users refresh — done

Mobile build (`npm run build:mobile`) still works on the `mobile-shell`
branch but is not part of the production release flow.

The legacy installer build script `C:\Dev\CollectCore-Build\build-release.bat`
and the supporting `app/`, `python-embed/`, etc. directories under
`C:\Dev\CollectCore-Build\` are obsolete and can be deleted whenever convenient.
`docs/release-guide.md` is similarly historical now — accurate for the old
desktop installer flow that is no longer used.

---

## Listing tracker open question

`docs/listing_tracker_design_plan_v3.md` ("Open Question: Cloud Hosting Impact")
remains the canonical place for considerations around Playwright on Railway,
marketplace IP reputation, scheduler architecture, thumbnail storage, and the
split-deployment fallback. Not yet built.

---

## Session Notes

See `docs/session_notes.md` for the full session history.

> Update `docs/session_notes.md` at the end of each working session with a brief
> summary of what was completed and what is next. Keep last 3-5 sessions;
> collapse older entries into a "Completed to date" block.
