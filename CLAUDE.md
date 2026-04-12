# CollectCore — Project Briefing for Claude Code

## Project Overview

CollectCore is a multi-collection tracker application rebuilt from a
completed, fully functional photocard tracker. The goal is a generalized
system that supports multiple collection types while preserving the core
UI patterns and workflows from the original app.

**Implemented modules:** Photocards, Books, Graphic Novels

**Planned future modules:**
- Music
- Video (TV series, movies, miniseries, music videos)
- Video Games
- TTRPG
- Board Games

The original photocard tracker was built with ChatGPT and is complete.
CollectCore is an active rebuild/generalization — not a from-scratch app.

---

## Stack

- **Backend:** Python + FastAPI + SQLite
- **Frontend:** React + Vite
- **Environment:** WSL2 + Ubuntu (local-first, no cloud deployment yet)

---

## Core Architecture

CollectCore uses a shared item table + collection-specific detail tables:

- `tbl_items` — shared record for all collection types
- `tbl_photocard_details` — photocard-specific fields
- `tbl_book_details` + `tbl_book_copies` — book-specific fields (implemented)
- `tbl_graphicnovel_details` — graphic novel-specific fields (implemented)
- `xref_photocard_members` — many-to-many member relationships
- Shared lookup tables for collection types, categories, and ownership
- Collection-specific lookup tables for groups, members, source origins

`collection_type_id` differentiates modules throughout the system.

---

## Active Modules

All three implemented modules are v1-complete with full CRUD, library
(filter sidebar + table/grid views), bulk edit/delete, and ingest.

### Photocards
- v1 complete — image ingest, library, export

### Books
- v1 complete — manual entry, ISBN lookup, external search, Goodreads migration (4,724 records)

### Graphic Novels
- v1 complete — ISBN lookup with multi-result picker, library, cover image management

---

## UI Design Principles

The UI should remain consistent with the original photocard tracker across
all collection modules. Key principles from the original app:

- Compact and dense layout — minimal whitespace
- Button-driven interaction preferred over free typing
- Guided controls to prevent invalid input
- High efficiency for repeated actions (batch ingest, bulk edit)
- Two-panel layout: left sidebar filters, main content area

Do NOT redesign the UI structure without explicit instruction.

---

## Image Ingest Workflow — CRITICAL

The image ingest workflow is a core feature of CollectCore, not optional
or deferred. It is fully implemented in the original photocard tracker
and must be rebuilt in CollectCore.

### Mental model
> Front images create records. Back images attach to records.

This is a two-phase, front-first, human-confirmed attachment pipeline.

### Key behaviors to preserve
- Inbox staging area (`images/inbox/`) before permanent storage
- Deterministic filename structure: `{group_code}_{id:06d}_{side}.{ext}`
  - Example: `skz_000123_f.jpg`, `skz_000123_b.jpg`
- Candidate matching for back attachment (metadata-based, human-confirmed)
- Missing backs are a valid normal state (`back_image_path = NULL`)
- Image replacement preserves record identity
- Cache busting via file modification timestamp (`?v=mtime`)

### Items to re-evaluate in CollectCore rebuild
- Strict front/back model (may need multi-asset support)
- Path-based storage (cloud storage is a future consideration)
- Filesystem-based versioning

### Image schema status
Image fields are not yet finalized in the CollectCore schema. Do not
treat image handling as out of scope. Any schema work that touches
`tbl_items` or `tbl_photocard_details` should account for image fields.
Raise the image field question explicitly before finalizing those tables.

---

## Known Shortcuts from Original App (Carry-Forward Decisions)

The following are intentional simplifications from the original app.
Do not "fix" these unless explicitly instructed:

- `source` field not renamed to `version` in original DB (CollectCore
  has resolved this with the source_origin / version split: version in
  CollectCore was source in the original DB; source_origin in CollectCore
  replaces the concept of subcategory in the original DB)
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
- `format` field: decided to be module-specific (not on `tbl_items`).
  Each module handles format via its own copy/edition sub-table or field.
- Tags: book-specific tags implemented (`lkup_book_tags`). Cross-collection
  tag architecture remains deferred — do not add tags to new modules
  without explicit decision.

---


## Deferred Items (Prioritized)

These are intentionally not yet built. Do not implement without instruction:

1. Image field schema finalization and image ingest rebuild
2. Ownership status dropdown — move to lookup-driven UI
3. Return full object on create endpoints (currently returns minimal response for some)
4. Lookup admin/management UI
5. Validation improvements and consistent error handling across endpoints
6. Pagination — not designed or implemented for any module
7. Photocard library filter sidebar — update font size, spacing, and padding to match the books library sidebar style (user-preferred reference)
8. Future modules — see Future Modules section below (implement one at a time, recommended order: Video Games → Music → Video → Board Games → TTRPG)
9. `lkup_book_read_statuses` rename to `lkup_consumption_statuses` — when Video module is built, this table gains video/game watch statuses; rename at that point
10. External API integrations for deferred modules: Music (MusicBrainz/Discogs/Spotify TBD), Video Games (IGDB/RAWG TBD), TTRPG (TBD)

---

## Future Modules

Schema decisions are finalized for all five planned modules. Full details
in `C:\Users\world\.claude\plans\pure-inventing-whisper.md`.

### Shared patterns for all new modules
- Add row to `lkup_collection_types` + `lkup_top_level_categories`
- `tbl_{module}_details` (1:1 with tbl_items) as the core detail table
- Module-specific lookup tables + xref tables for M:N relationships
- Backend: `_resolve_collection_type_id()`, `_get_{module}_detail()`, `_insert_{module}_relationships()`
- Frontend: `{Module}IngestPage.jsx` + `{Module}LibraryPage.jsx` (GN module is the template)
- `tbl_items.reading_status_id` = NULL for modules that don't use a consumption status

### Music (code: `music`)
- **Top-level categories**: Album, EP, Single, Compilation, Live, Soundtrack
- **3-layer**: Release (work) → Songs (per-release) → Editions (copies/versions)
- **Editions**: format_type, version_name (K-pop variant name), label, catalog_number, barcode, per-edition `ownership_status_id`
- **Artists**: M:N lookup (`lkup_music_artists` / `xref_music_release_artists`)
- **Genre**: 2-level (`lkup_music_top_genres` + `lkup_music_sub_genres`)
- **Track listings**: release-level base (`xref_release_track_list`) + edition-level overrides (`xref_edition_track_list`)
- **No**: listening status, tags, rating/review
- **API**: Deferred (schema has api_source + external_work_id slots)

### Video (code: `video`)
- **Top-level categories**: Movie, TV Series, Miniseries, Concert/Live
- **TV Series**: seasons sub-table (`tbl_video_seasons`) with episode_count, format, per-season ownership
- **Movie/Miniseries/Concert**: copies sub-table (`tbl_video_copies`) for multi-format ownership
- **Watch status**: reuses `tbl_items.reading_status_id`; add Watched/Currently Watching/Want to Watch/Abandoned to status table
- **Talent**: Director + Cast, both M:N lookups; Cast = Performers for Concert/Live
- **Genre**: 2-level. No rating/review.
- **API**: TMDB (decided)

### Video Games (code: `videogames`)
- **Top-level category**: Single "Video Games" catch-all (not surfaced in UI)
- **Platform model**: Copy sub-table `tbl_game_copies` (1:many) — one game record, N platform copies, each with platform (lookup) + edition (text) + ownership_status. Mirrors `tbl_book_copies`.
- **Platform lookup**: `lkup_game_platforms` — seeded with common platforms (Xbox, PS5, Switch, PC storefronts, etc.)
- **Play status**: reuses `tbl_items.reading_status_id`; add Played/Playing/Want to Play/Abandoned
- **Developer/Publisher**: M:N free-form lookups
- **Genre**: 2-level. No rating/review, no tags.
- **API**: Deferred

### TTRPG (code: `ttrpg`)
- **Top-level categories**: Game systems (D&D, Pathfinder, etc.) — user-extensible via admin; seeded with common systems
- **System editions + lines**: scoped sub-lookups keyed to `top_level_category_id`, mirroring photocards' members/source_origins hierarchy
- **Book type**: `lkup_ttrpg_book_types` (Core Rulebook, Adventure Module, Sourcebook, Supplement, Campaign Setting, Other)
- **Format**: copy sub-table (`tbl_ttrpg_copies`) with per-copy ISBN + ownership_status
- **Authors**: M:N lookup with order
- **No**: read status (ownership only), tags, rating/review
- **API**: Deferred

### Board Games (code: `boardgames`)
- **Top-level categories**: Solo (1 player), 2-Player, Small Group (3–4), Large Group (5+)
- **Expansions**: sub-table (`tbl_boardgame_expansions`) with title, year, ownership_status_id, BGG expansion ID
- **Designer**: M:N free-form lookup with order; Publisher: single lookup
- **No**: genre/mechanic, play log, rating/review
- **API**: BoardGameGeek XML API (no key required)

---

## Reference Documentation

All docs are in the `docs/` folder. Use these as authoritative references:

| File | Purpose |
|---|---|
| `docs/release-guide.md` | Build process, distribution, installer decisions, troubleshooting |
| `docs/collectcore_summary.md` | Schema changes, active endpoints, current implementation state |
| `docs/collectcore_photocard_migration_mapping.md` | Field-level migration mapping from original to new schema |
| `docs/collectcore_books_module_design.md` | Books module design decisions and history |
| `docs/collectcore_books_module_plan.md` | Books implementation plan — finalized decisions, schema, phases, known gaps |
| `docs/collectcore_books_v1_schema_proposal.md` | Books module v1 schema reference |
| `C:\Users\world\.claude\plans\pure-inventing-whisper.md` | **Future modules plan** — full schema decisions for Music, Video, Video Games, TTRPG, Board Games |
| `docs/session_notes.md` | Working session history — completed work and next steps |

---

## Implementation Status Notes

- All three current modules (Photocards, Books, Graphic Novels) are v1-complete.
- The active endpoint list in `docs/collectcore_summary.md` is the
  authoritative source for what is currently built and working.
- Future module schemas are fully designed — see Future Modules section above
  and the plan file for full detail.

---

## Backup & Restore

The Admin page has Backup and Restore functions (`GET /admin/backup`,
`POST /admin/restore`).

**New modules require no changes to backup** — the SQLite backup is a
complete hot-copy of the entire database, so any tables added by future
modules are captured automatically. The images directory is also backed
up wholesale.

**Checklist item when building a new module:** Verify that any
module-specific file assets stored outside `images/library/` are covered
by the backup. If a new module stores files in a different directory,
update `GET /admin/backup` to include that directory in the ZIP.

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
