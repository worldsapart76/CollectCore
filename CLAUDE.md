# CollectCore — Project Briefing for Claude Code

## Project Overview

CollectCore is a multi-collection tracker application rebuilt from a
completed, fully functional photocard tracker. The goal is a generalized
system that supports multiple collection types (photocards, books, and
future types such as movies, music, and graphic novels) while preserving
the core UI patterns and workflows from the original app.

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
- `tbl_book_details` — book-specific fields (not yet implemented)
- `xref_photocard_members` — many-to-many member relationships
- Shared lookup tables for collection types, categories, and ownership
- Collection-specific lookup tables for groups, members, source origins

`collection_type_id` differentiates modules throughout the system.

---

## Active Modules

### Photocards
- Fully implemented for version 1.0

### Books
- Backend: not yet implemented
- Frontend: not yet implemented
- Design partially specified — see docs below
- ⚠️ Prerequisites must be resolved before development begins —
  see Books Module Prerequisites section below

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
- `format` field belongs on `tbl_items` (shared across all collection
  types, not module-specific) — placement decided, not yet implemented
- Tags scope (global vs. module-specific) is an unresolved
  cross-collection architecture decision — do not implement tags
  for any module until this is decided

---

## Books Module — Prerequisites Before Development

The following items MUST be discussed and decided before any Books
module schema, backend, or frontend work begins. Claude Code should
raise these explicitly at the start of any session where Books
development is requested, and should not proceed until each item
is resolved or explicitly deferred by the user.

### 1. Tags architecture (global vs. module-specific)
Unresolved cross-collection decision. Affects tbl_book_details schema
and all future modules. Do not implement tags for any module until
decided. See deferred item 12.

### 2. Format field implementation
Top-level values (Physical, Digital, Audio) are decided and belong on
tbl_items. Sub-format detail (Kindle, Audible, Kobo, etc.) and
multi-format handling are not yet decided. Affects tbl_items schema
and Goodreads migration. See deferred items 9 and 11.

### 3. Reading status
Not decided. May belong on tbl_items (shared) or tbl_book_details
(book-only). Affects schema and Goodreads migration.
See collectcore_books_module_design.md Section 16.

### 4. API category handling
Whether to store, ignore, or convert Google Books / Open Library
categories to tags is not decided. Affects the API normalization
layer. Must be decided before building external search endpoints.

### 5. Duplicate detection UX
Soft warning vs. hard block on ISBN duplicates not decided.
Must be decided before POST /books is finalized.

### 6. Genre/subgenre lookup admin UI
Genre system is designed but the UI for adding new genres and
subgenres from within the app must be scoped before frontend work
begins. See collectcore_books_module_design.md Section 17.

---

## Deferred Items (Prioritized)

These are intentionally not yet built. Do not implement without instruction:

1. Image field schema finalization and image ingest rebuild
2. Ownership status dropdown — move to lookup-driven UI
3. Books module — full backend and frontend implementation
   ⚠️ See Books Module Prerequisites above before starting
4. Return full object on create endpoints (currently returns minimal response)
5. Lookup admin/management UI
6. Validation improvements and consistent error handling across endpoints
7. Full Library UI (binder view, filtering, editing, bulk actions)
8. Books module — genre/subgenre lookup admin UI
9. Books module — book format sub-format detail and multi-format
   handling (top-level Physical/Digital/Audio decided; platform detail
   and multi-format record strategy still open — decide before
   implementing tbl_book_details)
10. Books module — reading status field design and implementation
    (open question: shared tbl_items vs. book-specific;
    see collectcore_books_module_design.md Section 16)
11. Format field implementation on tbl_items (placement decided,
    sub-format detail and multi-format handling still open)
12. Tags architecture — global vs. module-specific decision required
    before implementing tags for any module
13. API category handling — decide whether to store, ignore, or
    convert to tags before building API normalization layer
14. Duplicate detection UX — soft warning vs. hard block on ISBN
15. Pagination — not designed or implemented for any module
16. Consistent validation rules and response shapes across all endpoints
17. Photocard library filter sidebar — update font size, spacing, and padding to match the books library sidebar style (user-preferred reference)
18. ~~Collection type seed data~~ — DONE. All three collection types, top-level categories, ownership statuses, and all books lookup tables (read statuses, format details, age levels, genres, subgenres) are now seeded in schema.sql. Fresh installs produce correct IDs matching the dev machine (photocards=1, books=2, graphicnovels=3).

---

## Reference Documentation

All docs are in the `docs/` folder. Use these as authoritative references:

| File | Purpose |
|---|---|
| `docs/release-guide.md` | Build process, distribution, installer decisions, troubleshooting |
| `docs/collectcore_summary.md` | Schema changes, active endpoints, current implementation state |
| `docs/collectcore_photocard_migration_mapping.md` | Field-level migration mapping from original to new schema |
| `docs/collectcore_books_module_design.md` | Books module design decisions, philosophy, and open items |
| `docs/collectcore_books_module_plan.md` | **Authoritative books implementation plan** — finalized decisions, schema, phases, known gaps vs. what was built |
| `docs/collectcore_books_v1_schema_proposal.md` | Books module v1 schema, SQL, API endpoints, request/response shapes |
| `docs/session_notes.md` | Working session history — completed work and next steps |

---

## Implementation Status Notes

- `docs/collectcore_books_module_design.md` and
  `docs/collectcore_books_v1_schema_proposal.md` are **design documents
  only** — nothing in the Books module has been implemented yet.
- The active endpoint list in `docs/collectcore_summary.md` is the
  authoritative source for what is currently built and working.

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
