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

- **Backend:** Python + FastAPI + SQLite
- **Frontend:** React + Vite
- **Environment:** Windows, `C:\Dev\CollectCore` (local-first; Railway + Cloudflare R2 hosting planned — see Hosting section)

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

- Staging: `images/inbox/` → permanent: `images/library/`
- Filename convention: `{group_code}_{id:06d}_{f|b}.{ext}`
- Storage in `tbl_attachments` (photocards); `cover_image_url` field (all other modules)
- Other modules receive cover images via external API search (TMDB, Discogs, RAWG, etc.) or `POST /upload-cover`
- Cache busting via `?v=mtime`

---

## Known Shortcuts

The following are intentional simplifications. Do not "fix" these unless explicitly
instructed:

- Local file storage (no asset management system yet)
- Option tables derived from card data, not authoritative lookups
- No virtualization or performance layer
- Inline styling (no design system)
- Export logic is still photocard-specific

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

1. Ownership status dropdown — move to lookup-driven UI
3. Return full object on create endpoints (photocards done in Wave 4; other modules still return minimal response)
4. Lookup admin/management UI — soft-delete cleanup is implemented (Admin page "Unused Lookup Cleanup"); full management UI (view/edit/merge/re-activate/hard-delete) remains deferred
5. Validation improvements and consistent error handling across endpoints
6. Pagination — not designed or implemented for any module
7. Photocard library filter sidebar — update font size, spacing, and padding to match the books library sidebar style (user-preferred reference)
8. `lkup_book_read_statuses` rename to `lkup_consumption_statuses` — Video and Video Games now use this table; rename should happen soon. Also adds Watched/Playing/etc. statuses.
9. Dark mode — needs full design revision; current implementation is not usable
10. Distributed launcher — PowerShell window should be hidden on launch; add a "CollectCore is starting up…" popup (e.g., Windows Toast or a small splash) so the app doesn't appear unresponsive while backend initializes
11. Photocard filter/input state persistence — when navigating between Inbox, Library, and Export tabs, the filter selections and form inputs should be preserved (currently reset on each navigation)
12. Library pop-up modals — always offer an "Update image" option regardless of whether an image exists
13. Board Games BGG search — BGG XML API may require an approved API key (conflicting notes); search panel is built but may be non-functional. Needs verification. Endpoints: `/boardgames/bgg-search` and `/boardgames/bgg-detail/{id}`. Add `BGG_API_KEY` to `.env` if required.
14. Graphic Novels ingest — keyword search result selection causes white screen crash. Clicking a Comic Vine search result calls `applyResult()` which crashes React. Needs debugging in `GraphicNovelsIngestPage.jsx`. ISBN lookup and manual entry work fine.
15. Google Books API rate limiting — external search and ISBN lookup for Books and Graphic Novels modules intermittently return HTTP 429 (Too Many Requests). Consider adding retry-with-backoff, caching recent lookups, or switching to a different primary source.
16. Read/consumption status cross-contamination — Books shows video/game statuses (Played, Watched, etc.) and GN shows gaming statuses in their read status filters. All modules share `lkup_book_read_statuses` and statuses added for Video/Video Games bleed into Books and GN.
    **Design decision required before implementing:**
    - **Option A (quick):** Expand `HIDDEN_READ_STATUS_NAMES` per module in `frontend/src/constants/hiddenStatuses.js` — no schema change, but hides statuses in frontend only; bleed still exists at the API level.
    - **Option B (proper):** Add `module_scope` column to `lkup_book_read_statuses` (and `lkup_ownership_statuses` if back-applying — see below), filter at the API level so each module only receives relevant statuses. Removes all frontend hidden sets for those tables.
    **If Option B:** Decide whether to back-apply `module_scope` to the three existing frontend hidden sets, which would also move to DB-side filtering:
    - `HIDDEN_OWNERSHIP_NAMES` (`["Trade", "Formerly Owned", "Pending", "Borrowed"]`) — hidden in GN, Boardgames, Music, Video, VideoGames, TTRPG (but shown in Books/Photocards); scoping in the DB would be cleaner
    - `HIDDEN_READ_STATUS_NAMES` (`["Currently Reading", "DNF"]`) — hidden in GN (these are book-specific statuses that don't apply to GN)
    - `HIDDEN_ERA_NAMES` (`["Copper Age"]`) — hidden in GN; a data-quality issue rather than a module-scope issue (era probably shouldn't exist in the DB if unused)
    - Photocard/Inbox use a different, smaller `HIDDEN` set (`["Formerly Owned", "Borrowed"]`) — same ownership table, different subset

---

## Reference Documentation

All docs are in the `docs/` folder. Use these as authoritative references:

| File | Purpose |
|---|---|
| `docs/release-guide.md` | Build process, distribution, installer decisions, troubleshooting |
| `docs/collectcore_summary.md` | Schema changes, active endpoints, current implementation state |
| `docs/collectcore_books_module_design.md` | Books module design decisions and history |
| `docs/collectcore_books_module_plan.md` | Books implementation plan — finalized decisions, schema, phases, known gaps |
| `docs/collectcore_books_v1_schema_proposal.md` | Books module v1 schema reference |
| `C:\Users\world\.claude\plans\pure-inventing-whisper.md` | **Future modules plan** — full schema decisions for all 5 modules (all now implemented; plan file remains as schema reference) |
| `C:\Users\world\.claude\plans\fancy-stirring-hollerith.md` | **Mobile & hosting strategic plan** — Capacitor mobile app, Unraid self-hosting, Path A/B architecture, phased implementation |
| `docs/session_notes.md` | Working session history — completed work and next steps |

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
   Omitting this causes all API calls to return HTML instead of JSON, producing:
   `Unexpected token '<', "<!doctype "... is not valid JSON`
2. Verify that any module-specific file assets stored outside `images/library/`
   are covered by the backup. If a new module stores files in a different
   directory, update `GET /admin/backup` to include that directory in the ZIP.

---

## Hosting & Mobile Plan

**Hosting decided 2026-04-21: Cloud (Railway + Cloudflare R2).** Canonical detail
and fallback option in `C:\Dev\ARCHITECTURE.md` Decision A.

- **Backend:** FastAPI on Railway (user already runs a Discord app there)
- **Images:** Cloudflare R2; `tbl_attachments.storage_type = 'hosted' | 'local'`
- **Scope:** CollectCore only. MediaManager, Calibre Content Server, Jellyfin, and
  other projects still target Unraid.
- **Fallback:** Unraid self-hosting retained in ARCHITECTURE.md Decision A if the
  cloud path later proves unworkable.

**Prerequisites before Railway deployment** (blocking; see
`C:\Users\world\.claude\plans\fancy-stirring-hollerith.md` Phase 0c):
- Image field schema finalization — complete as of 2026-04-21 (photocard copy/edition refactor done)

Resolve against local SQLite before the DB leaves the machine; iterating on
migrations against a live Railway DB is much harder.

**Multi-user model** (ARCHITECTURE.md Decision B) is still UNDECIDED. With cloud
resolved, Option B (single instance + user accounts) fits more naturally than
per-user Railway services, but not yet committed.

**Collection sharing** (deferred pending multi-user model):
Ability to share a specific collection (e.g. Graphic Novels) with another user in
read-only view. The viewer sees the shared collection alongside their own without
it overriding their own records for the same module. Each user retains full
independent ownership of their own data.

**Mobile:** Full plan (Capacitor, thin-client API approach, Android APK, iOS
TestFlight or PWA via browser) is documented in
`C:\Users\world\.claude\plans\fancy-stirring-hollerith.md`.
- **Phase 0** (desktop code prep: API base URL externalization, imageUrl.js helper,
  VITE_ENABLED_MODULES config) — complete 2026-04-13
- **Phase 0b** (R2 bucket setup + seed DB preparation) — not yet started
- **Phase 0c** (backend schema prerequisites above) — not yet started
- PWA is viable since the Railway URL is reachable; TestFlight remains optional.

**Listing tracker impact on cloud:** open question — see `docs/listing_tracker_design_plan_v3.md`
("Open Question: Cloud Hosting Impact" section) for considerations around Playwright
on Railway, marketplace IP reputation, scheduler architecture, thumbnail storage,
and the split-deployment fallback.

---

## Build & Release

See `docs/release-guide.md` for the full build process, distribution
instructions, installer decisions, and troubleshooting guide (including
log file locations for diagnosing launch failures).

---

## Session Notes

See `docs/session_notes.md` for the full session history.

> Update `docs/session_notes.md` at the end of each working session with a brief
> summary of what was completed and what is next. Keep last 3-5 sessions;
> collapse older entries into a "Completed to date" block.
