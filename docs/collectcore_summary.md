# CollectCore – Development Summary

## 1. Backend schema changes

### tbl_items
- Shared core table — one row per work (photocard or book)
- Fields:
  - item_id
  - collection_type_id
  - top_level_category_id
  - ownership_status_id
  - reading_status_id (nullable FK → lkup_book_read_statuses; NULL for photocards)
  - notes
  - timestamps

### tbl_photocard_details
- New photocard-specific table
- Fields:
  - item_id
  - group_id
  - source_origin_id (nullable)
  - version
- Replaces old combined photocard record structure

### xref_photocard_members
- Many-to-many mapping
- Fields:
  - item_id
  - member_id
- Replaces single-member field

### lkup_collection_types
- New lookup
- Examples: photocard, book

### lkup_top_level_categories
- Shared lookup by collection type
- Examples:
  - Photocard: Album, Non-Album
  - Book: Fiction, Non-Fiction

### lkup_ownership_statuses
- Shared lookup
- Values:
  - Owned, Wanted, Trade, Formerly Owned, Pending, Borrowed (added for books)

### lkup_photocard_groups
- Photocard-specific lookup
- Fields:
  - group_id, group_code, group_name

### lkup_photocard_members
- Photocard-specific lookup
- Fields:
  - member_id, group_id, member_code, member_name

### lkup_photocard_source_origins
- New/reworked lookup
- Fields:
  - source_origin_id
  - group_id
  - top_level_category_id
  - source_origin_name

### Removed
- subcategory (replaced by source_origin + version)

---

### Books module schema (Phase 1 — implemented)

Three-layer architecture: `tbl_items` (work) → `tbl_book_details` (work metadata) → `tbl_book_copies` (edition/copy)

**Lookup tables**
- `lkup_book_read_statuses` — Read, Currently Reading, Want to Read, DNF
- `lkup_book_format_details` — format name + top_level_format (Physical/Digital/Audio); seeded with 8 formats
- `lkup_book_top_level_genres` — scoped to Fiction or Non-Fiction via category_scope_id; 11 genres seeded
- `lkup_book_sub_genres` — parented to top_level_genre; 33 subgenres seeded
- `lkup_book_age_levels` — Children's, Middle Grade, Young Adult, New Adult, Adult
- `lkup_book_authors` — author_name UNIQUE; upserted at ingest time
- `lkup_book_tags` — book-specific tags (cross-collection architecture deferred)

**Core tables**
- `tbl_book_details` — work-level metadata (title, description, age_level, star_rating, review, api_categories_raw); 1:1 with tbl_items
- `tbl_book_copies` — copy/edition (format_detail_id, isbn_13, isbn_10, publisher, published_date, page_count, language, cover_image_url); 1:many with tbl_items; UNIQUE(item_id, format_detail_id)
- `tbl_book_series` — series lookup; upserted at ingest time

**Xref tables** (all FK to tbl_book_details.item_id with CASCADE DELETE)
- `xref_book_item_authors` — many-to-many with author_order
- `xref_book_item_series` — with series_number REAL
- `xref_book_item_genres` — top_level_genre_id + optional sub_genre_id; partial unique indexes handle nullable sub_genre_id
- `xref_book_item_tags`

**Key constraints**
- `ux_book_copies_isbn13` — UNIQUE on isbn_13 WHERE NOT NULL (hard block on duplicate ISBN)
- UNIQUE(item_id, format_detail_id) on tbl_book_copies — one copy per format per work
- Duplicate work detection (title + primary author) enforced at application level in POST /books

---

## 2. Design decisions

- Shared core table + detail tables for each collection
- collection_type_id differentiates modules
- Lookup tables for reusable values
- Xref tables for many-to-many (members)
- Split source_origin vs version
- Allow nullable source_origin_id
- Books module shares core but not photocard tables

---

## 3. Implemented so far

All three collection modules are fully implemented.

### Photocards (v1 complete)
- Full library with filter sidebar, grid view (S/M/L), bulk select/edit/delete
- Two-phase image ingest workflow (inbox → front ingest → back candidate matching)
- Export page (filtered + sorted PDF via reportlab)
- Tri-state filter sidebar with searchable chips; shared `FilterSidebar.jsx` system

### Books (v1 complete, 4,724 Goodreads books migrated)
- Three-tab ingest: Manual Entry, ISBN Lookup, External Search (Google Books / Open Library fallback)
- Library with full filter sidebar, table and grid views, bulk select/edit/delete
- Goodreads CSV migration complete (`backend/migrate_goodreads.py`)

### Graphic Novels (v1 complete)
- ISBN lookup with multi-result picker (up to 5 editions)
- Library with resizable columns, table and grid views, cover thumbnails
- Multiple source series per item (xref table)

### Admin
- Backup (hot-copy ZIP of DB + images) and Restore with confirm step
- Module enable/disable settings (`tbl_app_settings`)

### Shared UI
- CollectCore brand + module-switching dropdown nav
- Dark/light mode with CSS variable system
- Shared `FilterSidebar.jsx` components used across all modules

---

## 4. Frontend mapping implications

- member → member_ids (create) / members[] (read)
- subcategory removed
- source_origin scoped by group + category
- source_origin_id nullable
- collection_type_id required
- API responses are joined display models, not raw DB rows

---

## 5. Endpoints

### Shared / Utility
- GET /health
- GET /categories
- GET /ownership-statuses
- GET /settings
- PUT /settings/{key}

### Photocards
- GET /photocards
- POST /photocards
- GET /photocards/{id}
- PUT /photocards/{id}
- DELETE /photocards/{id}
- PATCH /photocards/bulk
- POST /photocards/bulk-delete
- GET /photocards/groups
- GET /photocards/groups/{group_id}/members
- GET /photocards/source-origins
- POST /photocards/source-origins

### Ingest (photocards)
- GET /ingest/inbox
- POST /ingest/upload
- POST /ingest/front
- GET /ingest/candidates
- POST /ingest/attach-back
- POST /ingest/pair
- DELETE /ingest/inbox/{filename}
- POST /photocards/{id}/replace-front
- POST /photocards/{id}/replace-back

### Export
- POST /export/photocards

### Books
- GET /books
- POST /books

---

## Key Schema Decisions

> Moved here from `CLAUDE.md` 2026-05-15. These are settled decisions; the
> bug-preventing subset (LEFT JOIN nullable `source_origin_id`; `subcategory`
> stays removed; no tags on new modules) is digested in CLAUDE.md → Hard Rules.

- `subcategory` has been removed — **do not reintroduce it**
- `source_origin` and `version` are distinct concepts:
  - source_origin = release/event origin (e.g., `5-STAR`)
  - version = specific variation (e.g., `Soundwave POB`)
- `source_origin_id` is explicitly nullable — **all queries must use LEFT JOIN**
- `member` is no longer a scalar field — stored in `xref_photocard_members`
- Categories and ownership resolve through shared lookup tables
- Source origins are scoped by `group_id` + `top_level_category_id`
- `format` field: module-specific (not on `tbl_items`). Each module handles
  format via its own copy/edition sub-table or field.
- Tags: book-specific tags implemented (`lkup_book_tags`). Cross-collection
  tag architecture remains deferred — **do not add tags to new modules
  without explicit decision.**

---

## Known Shortcuts (Intentional Simplifications)

> Moved here from `CLAUDE.md` 2026-05-15. **Do not "fix" these unless
> explicitly instructed** — they are deliberate, not oversights.

- Direct image upload to R2 not implemented; admin tools sweep local-staged
  images to R2 in batches (`tools/publish_catalog.py`, `tools/sync_admin_images.py`)
- Option tables derived from card data, not authoritative lookups
- No virtualization or performance layer (lazy-load on `<img>` is the only
  perf concession; library "All" view of 10K+ cards still renders eagerly otherwise)
- Inline styling in many places (no full design system; CSS variables + Inter font
  + green palette is the baseline)
- Export logic is still photocard-specific
- GET /books/{id}
- PUT /books/{id}
- DELETE /books/{id}
- POST /books/bulk-delete
- PATCH /books/bulk
- GET /books/genres
- GET /books/format-details
- GET /books/age-levels
- GET /books/read-statuses
- GET /books/authors
- GET /books/series
- GET /books/tags
- GET /books/search-external
- GET /books/lookup-isbn

### Graphic Novels
- GET /graphicnovels
- POST /graphicnovels
- GET /graphicnovels/{id}
- PUT /graphicnovels/{id}
- DELETE /graphicnovels/{id}
- GET /graphicnovels/publishers
- GET /graphicnovels/format-types
- GET /graphicnovels/eras
- GET /graphicnovels/lookup-isbn

### Admin
- GET /admin/backup
- POST /admin/restore

---

## 6. Still deferred

- Ownership status dropdown — move to lookup-driven UI (currently hardcoded options in some places)
- Lookup admin/management UI (genres, source origins, members, etc.)
- Consistent validation rules and response shapes across all endpoints
- Return full object on create endpoints (currently returns minimal response for some)
- Image field schema finalization and image ingest rebuild (photocards use tbl_attachments; other modules deferred)
- Tags cross-collection architecture decision
- Photocard library filter sidebar spacing/style update to match books sidebar

---

## 7. Current state summary

CollectCore is a fully functional three-module collection tracker (photocards, books, graphic novels). All three modules have complete CRUD, library browsing with filter sidebars and table/grid views, bulk edit/delete, and ingest workflows. The books module includes 4,724 Goodreads-migrated records. A release pipeline (Inno Setup installer, PowerShell launcher) distributes the app to household users on Windows.
