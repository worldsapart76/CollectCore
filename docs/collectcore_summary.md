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
  - Catalog (photocards only; synthetic on `/pcs/`)
  - **Undecided, Not Wanted** (photocards only; added 2026-08-12) —
    `sort_order` 9/10, appended so they sit behind the filter sidebar's
    "+N more" fold. Visibility is per-module via
    `xref_ownership_status_modules`, same targeted treatment as Catalog.
  - **Lomo/Fanmade** (`lomo_fanmade`, photocards only; added 2026-08-27) —
    `sort_order` 11, same targeted xref treatment. A *possession* fact for an
    unofficial fan-printed card, held **instead of** Owned. Requested by a
    `/pcs/` user; set by hand only. Deliberately carries **no co-occurrence
    rule and no derived behaviour** — nothing blocks it and it blocks nothing
    (a card holding both Owned and Lomo/Fanmade is legal, just unusual).
    Badge letter **L**, primary (bottom-left) slot directly below `O`.
- **Ids are DB-assigned and differ per environment** (dev seeded Undecided as
  2429; prod differs) — resolve by `status_code`, never hardcode. The literals
  in `constants.py` (`OWNED_STATUS_ID`, `WANTED_STATUS_ID`) only work because
  those rows were seeded first.

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

### Binder Designer tables
Admin-only photocard binder layout planner (`/binder-designer`).
Full design: `docs/photocard_binder_designer_plan.md`.

- **tbl_binders** — binder_id, binder_name, layout_code
  (`2x2`/`3x2`/`3x3`/`4x3`, read **across × down** — `4x3` is the 12-pocket
  page), notes, created_at, updated_at
- **tbl_binder_pages** — page_id, binder_id, page_index (0-based),
  UNIQUE(binder_id, page_index)
- **tbl_binder_slots** — slot_id, page_id, slot_index (row-major, 0-based),
  item_id, UNIQUE(page_id, slot_index), **UNIQUE(item_id)**

`UNIQUE(item_id)` is global: a card lives in at most one pocket of one binder.
Because FK cascades don't fire (see Key Schema Decisions), deleting a photocard
must free its slot explicitly — `_delete_binder_slots_for_items` in
`routers/photocards.py`, called from both delete paths.

### Photocard pricing tables (admin-only)
Sell-price tiers for the trade shelf, plus the Mercari CSV worksheet.
Full design: `docs/photocard_pricing_and_trade_export_plan.md`.

- **lkup_photocard_price_tiers** — tier_id, tier_code (UNIQUE), tier_name,
  price_cents, sort_order, is_active. Seeded t1–t4 ($4 / $6 / $9 / $12).
  Resolve by `tier_code`, never by hardcoded id.
- **tbl_photocard_pricing** — item_id (PK), price_tier_id, price_cents,
  updated_at, `CHECK ((price_tier_id IS NULL) <> (price_cents IS NULL))`

Three states, enforced by the CHECK rather than by application code: **no row =
unpriced**, **price_tier_id set = tiered**, **price_cents set = custom**.
Effective price is derived on read (`COALESCE(pr.price_cents, pt.price_cents)`)
and **never denormalized**, so editing a tier's amount reprices every card on it
with no sweep. Deliberately a **side table, not columns on
`tbl_photocard_details`** — `catalog.py` (`SELECT *`) and `seed_builder.py`
(PRAGMA-driven copy) reflect that table, so anything added there would ship to
guests silently. Money is INTEGER cents throughout.

Three `tbl_app_settings` keys hold the listing templates:
`photocard_title_template`, `photocard_title_template_pc` (used when `version`
already contains "Photocard"), `photocard_description_template`.

Migration: `backend/migrate_photocard_pricing.py` (additive, idempotent).

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
- Tri-state filter sidebar with searchable chips; shared `FilterSidebar.jsx` system
- Sell pricing: bulk tier assignment (Bulk Edit) + per-card custom price
  (detail modal) + a Price Tiers editor on the Admin page
- Trade CSV export from the library select-mode toolbar — one paste-ready
  Mercari row per trade card
- ~~Export page (filtered + sorted PDF via reportlab)~~ — retired 2026-05-09

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
- PATCH /photocards/bulk — ownership changes are row-scoped to the decision row;
  response adds `ownership: {updated, skipped}` when ownership was in the payload,
  and `pricing: {updated, replaced_custom}` when `price_tier_id` was
  (`price_tier_id: 0` unprices, matching the `source_origin_id > 0` sentinel)
- POST /photocards/bulk-delete
- GET /photocards/groups
- GET /photocards/groups/{group_id}/members
- GET /photocards/source-origins
- POST /photocards/source-origins
- PUT /photocards/{id}/price — `{price_cents}` sets a **custom** price and
  clears the tier; `null` unprices. Separate from PUT /photocards/{id} because
  the tier-clearing side effect isn't a field assignment
- GET /photocards/price-tiers — includes inactive tiers + a live `card_count`
- POST /photocards/price-tiers — `tier_code` derived from the name when omitted
- PUT /photocards/price-tiers/{tier_id} — name / price_cents / sort_order /
  is_active. Changing the price reprices every card on the tier on next read
- DELETE /photocards/price-tiers/{tier_id} — **409** if any card uses the tier
  (FK cascades don't fire, so an unguarded delete would dangle). Retire with
  `is_active = 0` instead

The photocard read path emits `price_tier_id`, `price_cents` (effective) and
`price_source` (`"tier"` | `"custom"` | `null`). Admin-side only — `/pcs/` has
its own query and never sees prices.

### Binders (admin-only)
- GET /binders
- POST /binders
- GET /binders/placements — every placed card → its binder. Declared *before*
  `/{binder_id}` so the literal path isn't parsed as an int
- GET /binders/{id}
- PATCH /binders/{id} — layout changes rejected (400) while the binder holds cards
- DELETE /binders/{id}
- PUT /binders/{id}/pages — full replace of pages+slots in one transaction;
  **409** with conflicting item_ids if a card is already in another binder

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
- POST /export/photocard-trades.csv — Mercari worksheet. Body `{item_ids}`;
  the **client** decides the scope (the notes search is client-side and covers
  copy notes, so a server-side "all trade copies" query would be blind to it).
  One row per distinct card that has ≥1 `trade` copy; unpriced cards export a
  blank price rather than being dropped. `utf-8-sig` for Excel on Windows.
- ~~POST /export/photocards~~ — PDF export, retired 2026-05-09 in favor of
  trade pages

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
- **Photocard `ownership_status_id` carries two orthogonal facts** (2026-08-12):
  - a standing **decision** about the card — `undecided` / `wanted` /
    `not_wanted`. At most one per card, and it *outlives the copies*.
  - a **possession** fact about a copy — `owned` / `trade` / `pending_*` /
    `formerly_owned` / `borrowed` / `lomo_fanmade`. Zero or more per card.

  Co-occurrence: at most one decision per card; `wanted` excludes `owned` and
  `trade`; **`not_wanted` + `trade` is legal on purpose** — the trade copy row
  is deleted when a trade completes and the "don't collect this" record has to
  survive it. Enforced by `_check_status_conflict` in `routers/photocards.py`.
  `lomo_fanmade` is deliberately outside all of it — it conflicts with nothing,
  so `_conflicting_codes` returns `[]` for it and it never blocks another
  status.
- **Bulk ownership sweeps are row-scoped to the decision row** — possession
  copies are never touched in bulk, and cards whose target would conflict are
  excluded and reported as `skipped` rather than corrupted. A card-scoped
  `WHERE item_id = ...` (the pre-2026-08-12 behaviour) flattened every copy on
  the card, destroying trade stacks. Full rationale:
  `docs/photocard_triage_statuses_plan.md`.
- **SQLite foreign keys are never enforced at runtime** (2026-08-12).
  `PRAGMA foreign_keys = ON` is issued only on `init_db`'s own connection
  (`db.py`); the SQLAlchemy pool's per-connection pragmas set WAL + busy_timeout
  and nothing else, and the sqlite dialect leaves FK enforcement off. Every
  `FOREIGN KEY` clause in `schema.sql` is therefore **documentation only** —
  nothing cascades, nothing is rejected. Delete paths must remove child rows
  explicitly, which is what `bulk_delete_photocards` has always done by hand.
- **Photocard price tier and custom price are mutually exclusive, not layered**
  (2026-08-17). The obvious "store both, prefer the override" model was
  rejected: editing a card's price must *remove* it from its tier so a later
  sweep over that tier can't silently reset it. Enforced by a CHECK, not by
  application code. The effective price stays derived on read — never
  denormalized — which is what makes a tier edit reprice its cards for free.
  Full rationale: `docs/photocard_pricing_and_trade_export_plan.md`.
- **Pricing lives in `tbl_photocard_pricing`, not on `tbl_photocard_details`**
  (2026-08-17). Two guest-facing paths copy the detail table *by reflection*
  rather than by an explicit column list — `catalog.py`'s `SELECT *` and
  `seed_builder.py`'s PRAGMA-driven copy — so a column added there ships to the
  catalog delta and the guest seed with nothing in the diff to warn you. A side
  table is invisible to both **by construction** instead of by remembering to
  maintain a denylist.

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
