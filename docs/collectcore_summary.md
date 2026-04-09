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

### Backend
- POST /photocards
- GET /photocards
- GET /photocards/groups
- GET /photocards/groups/{group_id}/members
- GET /photocards/source-origins
- POST /photocards/source-origins
- GET /categories
- GET /health

### Frontend
- InboxManager tester UI
- Group/category/member/source origin selection
- Multi-member support
- Create photocard
- List photocards
- Dynamic source origin creation (inline)

### Fixes completed
- DB mismatch resolved
- Ownership status seeding
- LEFT JOIN fix for nullable source_origin
- Port standardization

---

## 4. Frontend mapping implications

- member → member_ids (create) / members[] (read)
- subcategory removed
- source_origin scoped by group + category
- source_origin_id nullable
- collection_type_id now required
- ownership_status currently hardcoded (temporary)
- API responses are joined display models, not raw DB rows

---

## 5. Endpoints

### Active
- GET /health
- GET /photocards
- POST /photocards
- GET /photocards/groups
- GET /photocards/groups/{group_id}/members
- GET /photocards/source-origins
- POST /photocards/source-origins
- GET /categories

### Legacy (not implemented)
- fetchInbox
- fetchSubcategoryOptions
- fetchSourceOptions
- ingestFront
- fetchCardCandidates
- attachBack

---

## 6. Unresolved / deferred

- Ownership status dropdown (lookup-driven UI)
- Books module schema
- Lookup admin management
- Validation improvements
- Return full object on create endpoints
- Rebuild image ingest workflow
- Final UI (binder, filtering, editing, bulk actions)

---

## 7. Current state summary

CollectCore has transitioned to a multi-collection architecture using a shared item table with collection-specific detail tables. The photocard module supports creation, listing, lookup-driven relationships, nullable source origins, and inline source origin creation. Future modules are planned but not implemented.
