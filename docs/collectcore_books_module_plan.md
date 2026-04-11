# Books Module — Design & Implementation Plan

_This is the authoritative design document for the books module. Captured from the planning session and saved 2026-04-09._

---

## Context

CollectCore is rebuilding a photocard tracker into a multi-collection app. The books module is the second collection type. The primary view is a dense text grid (not image thumbnails). The user has ~4,379 books in a Goodreads CSV export to migrate.

---

## Key Design Decisions (Finalized)

### Collection model
One row per work. "The Wizard of Oz" is one item record regardless of how many formats are owned. Format (Hardcover, Kindle, Audiobook) is a multi-select tracked via a xref table.

- `tbl_items` = the work record (one per unique title)
- `tbl_book_details` = 1:1 with tbl_items, holds book-specific metadata
- `xref_book_item_formats` = formats owned per work (with ISBNs attached per format entry)

This means tbl_book_works as a separate entity is not needed — tbl_items IS the work.

> **Note:** Implementation used `tbl_book_copies` (not `xref_book_item_formats` as originally planned). `tbl_book_copies` holds edition metadata (publisher, page_count, dates, cover URL) per format entry in addition to ISBNs. This is the authoritative structure.

### Format
Format lives entirely in the books module (not on tbl_items). The CLAUDE.md decision to put Physical/Digital/Audio on tbl_items is overridden. Rationale: photocards have no format concept; format is book-specific.

- `lkup_book_format_details` — Hardcover, Paperback, Kindle, Kobo, Audible, etc. Each has a `top_level_format` (Physical / Digital / Audio) for grouping.
- `xref_book_item_formats` — (item_id, format_detail_id, isbn_13, isbn_10). ISBN is edition-specific, lives here.

### ISBN & duplicate detection
- ISBN stored per format entry (not on the work record)
- Hard block: if isbn_13 already exists in xref_book_item_formats → reject
- If no isbn_13: block if title + author combination already exists

### Reading status
On `tbl_items` (shared). Will be NULL for photocards. Values: Read, Currently Reading, Want to Read, DNF.

- `lkup_book_read_statuses` seeded at init
- `tbl_items.reading_status_id` FK (nullable) — new column needed

### Authors and series
Normalized via xref tables (not plain text):

- `lkup_book_authors` (author_id, author_name, author_sort)
- `xref_book_item_authors` (item_id, author_id, author_order) — supports co-authors
- `tbl_book_series` (series_id, series_name, series_sort)
- `xref_book_item_series` (item_id, series_id, series_number)

### Genre
Hierarchical: top-level genre → optional subgenre.

- `lkup_book_top_level_genres` (top_level_genre_id, genre_name)
- `lkup_book_sub_genres` (sub_genre_id, sub_genre_name, top_level_genre_id FK)
- `xref_book_item_genres` (item_id, top_level_genre_id, sub_genre_id nullable)
- Seeded list only — no in-app admin UI in v1

Genre seed values: Fantasy, Science Fiction, Thriller/Mystery, Romance, Literary Fiction, Historical Fiction, Horror (Fiction), Biography/Memoir, History, Science, Self-Help, Business (Non-Fiction)

> **Note:** Implementation added `category_scope_id` FK to `lkup_book_top_level_genres` to scope Fiction vs Non-Fiction genres (required to avoid UNIQUE constraint collision for genres like "Other" that exist in both scopes). This is an intentional schema improvement over the plan.

### Age level
`tbl_book_details.age_level_id` FK → `lkup_book_age_levels`. Values: Children's, Middle Grade, Young Adult, New Adult, Adult

### Tags
Book-specific for now (`lkup_book_tags`, `xref_book_item_tags`). Accepted technical debt — may need rework when cross-collection tags are decided.

### API categories (Google Books)
Store raw API categories as a text field on `tbl_book_details.api_categories_raw`. Surface as suggestions in the UI when assigning genre — do not auto-assign.

### Star rating
On `tbl_book_details.star_rating` (REAL 0.5–5.0, nullable). Book-specific, not shared. Half-star values supported (1, 1.5, 2 … 5).

### Ingest priority
Goodreads CSV migration first, then API-assisted new book entry.

---

## Full Schema

### Changes to existing shared tables
```sql
ALTER TABLE tbl_items ADD COLUMN reading_status_id INTEGER REFERENCES lkup_book_read_statuses(read_status_id);
```

### New lookup tables
```sql
CREATE TABLE lkup_book_read_statuses (
    read_status_id   INTEGER PRIMARY KEY AUTOINCREMENT,
    status_name      TEXT NOT NULL UNIQUE
);
-- Seed: Read, Currently Reading, Want to Read, DNF

CREATE TABLE lkup_book_format_details (
    format_detail_id  INTEGER PRIMARY KEY AUTOINCREMENT,
    format_name       TEXT NOT NULL UNIQUE,
    top_level_format  TEXT NOT NULL CHECK (top_level_format IN ('Physical', 'Digital', 'Audio'))
);
-- Seed: Hardcover (Physical), Paperback (Physical), Mass Market Paperback (Physical),
--        Kindle (Digital), Kobo (Digital), Other Ebook (Digital),
--        Audible (Audio), Other Audio (Audio)

CREATE TABLE lkup_book_top_level_genres (
    top_level_genre_id INTEGER PRIMARY KEY AUTOINCREMENT,
    genre_name         TEXT NOT NULL UNIQUE
);

CREATE TABLE lkup_book_sub_genres (
    sub_genre_id        INTEGER PRIMARY KEY AUTOINCREMENT,
    sub_genre_name      TEXT NOT NULL,
    top_level_genre_id  INTEGER NOT NULL REFERENCES lkup_book_top_level_genres(top_level_genre_id),
    UNIQUE (sub_genre_name, top_level_genre_id)
);

CREATE TABLE lkup_book_age_levels (
    age_level_id    INTEGER PRIMARY KEY AUTOINCREMENT,
    age_level_name  TEXT NOT NULL UNIQUE,
    sort_order      INTEGER
);
-- Seed in order: Children's, Middle Grade, Young Adult, New Adult, Adult

CREATE TABLE lkup_book_authors (
    author_id    INTEGER PRIMARY KEY AUTOINCREMENT,
    author_name  TEXT NOT NULL UNIQUE,
    author_sort  TEXT   -- "Last, First" format for sorting
);

CREATE TABLE tbl_book_series (
    series_id    INTEGER PRIMARY KEY AUTOINCREMENT,
    series_name  TEXT NOT NULL UNIQUE,
    series_sort  TEXT
);

CREATE TABLE lkup_book_tags (
    tag_id    INTEGER PRIMARY KEY AUTOINCREMENT,
    tag_name  TEXT NOT NULL UNIQUE
);
```

### New core tables
```sql
CREATE TABLE tbl_book_details (
    item_id           INTEGER PRIMARY KEY REFERENCES tbl_items(item_id) ON DELETE CASCADE,
    title             TEXT NOT NULL,
    title_sort        TEXT,
    description       TEXT,
    publisher         TEXT,
    published_date    TEXT,  -- flexible: YYYY, YYYY-MM, or YYYY-MM-DD
    page_count        INTEGER,
    language          TEXT DEFAULT 'en',
    age_level_id      INTEGER REFERENCES lkup_book_age_levels(age_level_id),
    star_rating       INTEGER CHECK (star_rating BETWEEN 1 AND 5),
    review            TEXT,
    api_source        TEXT,  -- 'google_books' or 'open_library'
    external_work_id  TEXT,
    api_categories_raw TEXT  -- raw JSON from API, surfaced as genre suggestions
);
```

### New xref tables
All book-specific xref tables FK to `tbl_book_details.item_id` (not tbl_items directly). This scopes them to the book module at the DB level.

```sql
CREATE TABLE xref_book_item_authors (
    item_id       INTEGER NOT NULL REFERENCES tbl_book_details(item_id) ON DELETE CASCADE,
    author_id     INTEGER NOT NULL REFERENCES lkup_book_authors(author_id),
    author_order  INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (item_id, author_id)
);

CREATE TABLE xref_book_item_series (
    item_id        INTEGER NOT NULL REFERENCES tbl_book_details(item_id) ON DELETE CASCADE,
    series_id      INTEGER NOT NULL REFERENCES tbl_book_series(series_id),
    series_number  REAL,  -- allows 1.5, 0.5, etc.
    PRIMARY KEY (item_id, series_id)
);

CREATE TABLE xref_book_item_formats (
    item_id           INTEGER NOT NULL REFERENCES tbl_book_details(item_id) ON DELETE CASCADE,
    format_detail_id  INTEGER NOT NULL REFERENCES lkup_book_format_details(format_detail_id),
    isbn_13           TEXT,
    isbn_10           TEXT,
    PRIMARY KEY (item_id, format_detail_id)
);

CREATE TABLE xref_book_item_genres (
    item_id             INTEGER NOT NULL REFERENCES tbl_book_details(item_id) ON DELETE CASCADE,
    top_level_genre_id  INTEGER NOT NULL REFERENCES lkup_book_top_level_genres(top_level_genre_id),
    sub_genre_id        INTEGER REFERENCES lkup_book_sub_genres(sub_genre_id),
    PRIMARY KEY (item_id, top_level_genre_id, COALESCE(sub_genre_id, 0))
);

CREATE TABLE xref_book_item_tags (
    item_id   INTEGER NOT NULL REFERENCES tbl_book_details(item_id) ON DELETE CASCADE,
    tag_id    INTEGER NOT NULL REFERENCES lkup_book_tags(tag_id),
    PRIMARY KEY (item_id, tag_id)
);
```

---

## Backend API Endpoints

### CRUD
| Method | Path | Description |
|---|---|---|
| GET | /books | List books with full joined display model |
| GET | /books/{item_id} | Single book detail |
| POST | /books | Create book (with nested format, author, series, genre) |
| PUT | /books/{item_id} | Update book |
| DELETE | /books/{item_id} | Delete book |
| POST | /books/bulk-delete | Bulk delete |
| PATCH | /books/bulk | Bulk update (ownership/read status) |

### Lookups
| Method | Path | Description |
|---|---|---|
| GET | /books/genres | Top-level genres + subgenres |
| GET | /books/format-details | Format lookup with top_level_format grouping |
| GET | /books/age-levels | Age level lookup |
| GET | /books/read-statuses | Read status lookup |
| GET | /books/authors | Author list (for autocomplete) |
| GET | /books/series | Series list (for autocomplete) |
| GET | /books/tags | Tag list |

### External API
| Method | Path | Description |
|---|---|---|
| GET | /books/search-external?q=... | Proxy to Google Books (primary), Open Library (fallback) |
| GET | /books/lookup-isbn?isbn=... | ISBN lookup via external API |

### Display model (GET /books response shape)
Each book row includes:
- item_id, title, title_sort, description
- authors (list: author_name, author_order)
- series (list: series_name, series_number)
- formats (list: format_name, top_level_format, isbn_13, isbn_10)
- genres (list: top_level_genre_name, sub_genre_name nullable)
- tags (list: tag_name)
- age_level_name, star_rating, review
- top_level_category (Fiction/Non-Fiction)
- ownership_status (name + id)
- reading_status (name + id)
- notes, created_at, updated_at

---

## Frontend

### Pages
- `frontend/src/pages/BooksLibraryPage.jsx` — main library (two-panel: filter sidebar + text grid)
- `frontend/src/pages/BooksIngestPage.jsx` — add book (manual entry, ISBN lookup, external search tabs)

### Specified grid columns
Title + series info | Author(s) | Format badges | Genre / Age level | Read status | Ownership status | Star rating

### Specified filter sidebar dimensions
Author | Genre + Subgenre | Format (top-level: Physical/Digital/Audio, then sub-format) | Age level | Read status | Ownership status | Series | Tags

### Reuse from photocard module
- FilterSection pattern — reuse directly
- CardDetailModal base layout pattern
- api.js centralized client pattern (add book functions)
- Two-panel AppShell layout
- Ownership status dropdown (shared lookup, same endpoint)
- Top-level category filter (shared)
- Bulk selection/edit UX pattern

---

## Goodreads Migration Script

File: `backend/migrate_goodreads.py`

### Field mapping
| Goodreads field | → | Book schema |
|---|---|---|
| Title | → | tbl_book_details.title |
| Author | → | lkup_book_authors + xref_book_item_authors |
| Series (parsed) | → | tbl_book_series + xref_book_item_series |
| Bookshelves (library-paper) | → | format: Paperback |
| Bookshelves (library-kindle) | → | format: Kindle |
| Bookshelves (library-audible) | → | format: Audible |
| Bookshelves (to-read) | → | ownership: Wanted |
| Bookshelves (currently-reading) | → | ownership: Owned + reading_status: Currently Reading |
| My Rating | → | tbl_book_details.star_rating (0 → NULL) |
| My Review | → | tbl_book_details.review |
| Exclusive Shelf (read) | → | reading_status: Read |

### ISBNs
NOT imported from Goodreads. The Goodreads ISBN reflects the edition tracked there, not the owned copy.

### Duplicate handling
Title + first-author match → skip with a logged warning (not error). Migration should be idempotent.

### Approach
Import via API pathway (POST /books) to exercise the same validation and xref creation logic, not direct DB insertion. Migration script should report: imported count, skipped (duplicate) count, error count.

---

## Implementation Phases

| Phase | Description | Status |
|---|---|---|
| Phase 1 | Schema migration | ✓ Done |
| Phase 2 | Backend CRUD + lookups | ✓ Done |
| Phase 3 | Goodreads migration script | ✓ Done — 4,724 books imported |
| Phase 4 | Frontend library view | ✓ Done |
| Phase 5 | API-assisted book entry | ✓ Done (merged into Phase 4 frontend) |

---

## Known Gaps vs. Plan — All Resolved

All items from the original gaps list were resolved in subsequent sessions (see session_notes.md for detail):

- **Goodreads migration** — `backend/migrate_goodreads.py` built and run; 4,724 books imported, 0 errors
- **Bulk endpoints** — `POST /books/bulk-delete` and `PATCH /books/bulk` implemented
- **Library grid columns** — Format badges, Genre/Age level columns added; GET /books rebuilt with correlated subqueries to include genres, formats, tags
- **Filter sidebar** — All planned filters implemented: Author, Genre+Subgenre, Format (grouped Physical/Digital/Audio), Age Level, Read Status, Ownership, Series, Tags; all use tri-state toggle with AND/OR pill
- **Bulk edit UI** — Checkbox column, select-all, `BookBulkEdit` panel (ownership + read status bulk update, bulk delete with confirm)

---

## Verification Checklist

- [x] Goodreads migration script runs clean against dev DB, counts match export
- [x] GET /books returns full display model including genres, formats, tags in list response
- [x] Hard block fires on duplicate isbn_13 (DB constraint); soft warning on title+author duplicate
- [x] Grid displays all specified columns with format badges
- [x] Filter sidebar reduces results correctly across all dimensions
- [x] Detail modal shows + allows editing all fields
- [x] Bulk ownership/read status update works
- [x] Bulk delete works
- [x] Shared lookups (ownership statuses, top-level categories) reused correctly

---

## Open Items / Deferred

- Tags cross-collection architecture (book-specific tags implemented as tech debt; cross-collection decision still open)
- Star rating: implemented as REAL (half-stars, 0.5–5.0) — resolved
- Cover images: URL stored, thumbnail column in library with toggle — resolved
- Genre/subgenre admin UI: seed list only; adding new genres requires direct DB edit or code change
