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

All completed as of 4/23/2026

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

**Prerequisites before Railway deployment** — all complete as of 2026-04-23.
Phase 0c (photocard copies, image field schema, validation + error handling)
is closed. See `fancy-stirring-hollerith.md` Phase 0c for the settled detail.

**Multi-user model** (ARCHITECTURE.md Decision B) — DECIDED 2026-04-23: two-tier
(admin cloud + guest local).
- **Admin tier** (household only): Railway API auth, full CRUD, images in R2
- **Guest tier** (friends): no account, local SQLite on device, no cloud writes;
  starter catalog pulled from R2 as read-only hosted data
- Keeps R2 + Railway costs bounded to the household; no subscription fees for
  external users. One codebase, one binary per platform; tier decided at login.

**Collection sharing** (Decision E): replaced by trading export/import
(`.html` with embedded JSON). **DEFERRED to post-deployment** — see
fancy-stirring-hollerith.md "Post-deployment roadmap" item PD2.

**Catalog architecture** (decided 2026-04-23): Shared card set modeled as
snapshot-plus-delta. Admin's `tbl_items` with `catalog_item_id IS NOT NULL`
IS the Catalog. Guests download full snapshot on first launch, pull deltas
thereafter. `catalog_item_id` uses the existing `{group_code}_{id:06d}` image
filename convention — no UUIDs needed. New `Catalog` ownership status added to
photocards only, hidden from admin UI via `VITE_IS_ADMIN` flag. Full detail in
`fancy-stirring-hollerith.md` "Catalog Architecture" section and Phase 0b.

**Admin catalog publish UI**: CLI-only for v1 (`tools/publish_catalog.py`).
In-app publish flow is item PD1 in the post-deployment roadmap.

**Mobile:** Full plan (Capacitor, thin-client for admin / embedded SQLite for
guest, Android APK, iOS TestFlight or PWA via browser) is documented in
`C:\Users\world\.claude\plans\fancy-stirring-hollerith.md`.
- **Phase 0** (desktop code prep) — complete 2026-04-13
- **Phase 0c** (backend schema prerequisites) — complete 2026-04-23
- **Phase 0b** (R2 bucket setup + seed DB preparation) — not yet started;
  now the only code blocker before Railway deployment
- Path A (embedded SQLite) is now permanent as the guest runtime, not
  transitional
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
