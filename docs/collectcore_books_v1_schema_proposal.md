# CollectCore – Books Module v1 Schema Proposal

## Purpose

This document proposes a concrete **v1 implementation schema** for the Books module in CollectCore. It is based on the previously discussed design direction:

- books use the shared multi-collection architecture
- books share `tbl_items` and common lookup tables
- book-specific metadata lives in a dedicated detail table
- ingestion should be API-assisted where possible
- normalization should stay light in v1

This proposal is intended to be implementation-ready enough to guide backend schema creation, API development, and frontend mapping.

---

# 1. Architectural Position

## Shared tables used by Books

Books should use the existing shared infrastructure:

- `tbl_items`
- `lkup_collection_types`
- `lkup_top_level_categories`
- `lkup_ownership_statuses`

## Book-specific tables proposed for v1

- `tbl_book_details`

## Not included in v1 unless later needed

- `xref_book_authors`
- `lkup_publishers`
- `tbl_book_series`
- `xref_book_tags`
- review/rating tables
- reading-progress tables

---

# 2. Shared `tbl_items` usage for books

Each book record should create one row in `tbl_items`.

## Expected shared fields

- `item_id`
- `collection_type_id`
- `top_level_category_id`
- `ownership_status_id`
- `notes`
- timestamps

## Rules for books

### `collection_type_id`
Must resolve to the `book` row in `lkup_collection_types`.

### `top_level_category_id`
Must resolve to a book-specific shared category row in `lkup_top_level_categories`.

Expected v1 values:
- `Fiction`
- `Non-Fiction`

### `ownership_status_id`
Uses the shared ownership lookup.

Expected v1 values:
- `Owned`
- `Wanted`
- `Trade`
- `Formerly Owned`
- `Pending`

### `notes`
Free-text, optional.

---

# 3. Proposed `tbl_book_details`

## Table definition concept

`tbl_book_details` stores metadata specific to books and links 1:1 to `tbl_items`.

## Proposed fields

- `item_id` INTEGER PRIMARY KEY / FK to `tbl_items.item_id`
- `title` TEXT NOT NULL
- `author` TEXT NOT NULL
- `isbn_10` TEXT NULL
- `isbn_13` TEXT NULL
- `publisher` TEXT NULL
- `published_date` TEXT NULL
- `page_count` INTEGER NULL
- `language` TEXT NULL
- `description` TEXT NULL
- `series_name` TEXT NULL
- `series_number` REAL NULL
- `cover_image_url` TEXT NULL
- `api_source` TEXT NULL
- `external_work_id` TEXT NULL

---

# 4. Field-by-field rationale

## `item_id`
- Required
- 1:1 relationship with `tbl_items`
- Keeps book-specific data separated from shared item data

## `title`
- Required
- Primary display field
- Should be manually editable even if populated by API

## `author`
- Required in v1
- Stored as text, not normalized into separate author tables
- Chosen to avoid premature complexity

### Note
If multiple authors exist, store them in a readable text format in v1, such as:
- `Author One`
- `Author One; Author Two`

A future migration could split this into xref relationships if needed.

## `isbn_10`
- Optional
- Useful for older records or incomplete API results

## `isbn_13`
- Optional but preferred when available
- Best candidate for dedupe/search in v1

## `publisher`
- Optional
- Stored as text
- No publisher lookup table in v1

## `published_date`
- Optional
- Store as text in v1 instead of forcing full date normalization

### Recommended format
Use the most precise value available from the source:
- `2021`
- `2021-05`
- `2021-05-14`

This preserves imperfect API data without inventing missing precision.

## `page_count`
- Optional integer

## `language`
- Optional text
- Could store ISO code or plain language text depending on source normalization choice

### Recommendation
Prefer normalized short codes when available, such as:
- `en`
- `ko`
- `ja`

But allow raw text fallback if needed.

## `description`
- Optional
- Long-form summary or API description

## `series_name`
- Optional
- Kept as text in v1

## `series_number`
- Optional
- Use numeric type to allow:
  - `1`
  - `2`
  - `1.5`

## `cover_image_url`
- Optional
- Stores remote source URL if using external APIs
- Does not yet imply image downloading or caching

## `api_source`
- Optional
- Identifies where auto-filled data came from

### Examples
- `google_books`
- `open_library`

## `external_work_id`
- Optional
- Stores the identifier from the source API when useful

### Examples
- Google Books volume ID
- Open Library work or edition key

---

# 5. Proposed SQL shape

This is a practical SQLite-style proposal, aligned with current app direction.

```sql
CREATE TABLE IF NOT EXISTS tbl_book_details (
    item_id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    author TEXT NOT NULL,
    isbn_10 TEXT,
    isbn_13 TEXT,
    publisher TEXT,
    published_date TEXT,
    page_count INTEGER,
    language TEXT,
    description TEXT,
    series_name TEXT,
    series_number REAL,
    cover_image_url TEXT,
    api_source TEXT,
    external_work_id TEXT,
    FOREIGN KEY (item_id) REFERENCES tbl_items(item_id)
);
```

---

# 6. Recommended indexes

These are not all mandatory on day one, but they are sensible for v1.

## ISBN indexes
```sql
CREATE INDEX IF NOT EXISTS idx_book_details_isbn10
ON tbl_book_details(isbn_10);

CREATE INDEX IF NOT EXISTS idx_book_details_isbn13
ON tbl_book_details(isbn_13);
```

## Title index
```sql
CREATE INDEX IF NOT EXISTS idx_book_details_title
ON tbl_book_details(title);
```

## Author index
```sql
CREATE INDEX IF NOT EXISTS idx_book_details_author
ON tbl_book_details(author);
```

## Optional uniqueness guard
If you want to prevent duplicate ISBN-13 entries when present:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS ux_book_details_isbn13_nonnull
ON tbl_book_details(isbn_13)
WHERE isbn_13 IS NOT NULL;
```

### Caution
Do this only if the app should treat ISBN-13 as effectively unique in the collection. For personal libraries with duplicate owned copies, you may *not* want this uniqueness rule at the detail-table level.

---

# 7. Recommendation on duplicate handling

## Safer v1 approach
Do **not** enforce hard uniqueness on ISBN initially.

### Why
A collector may own:
- multiple copies of the same book
- different editions with missing/inconsistent metadata
- duplicates intentionally

## Better behavior
Use ISBNs for:
- search
- autofill
- duplicate warnings

But do not block insertion at the DB level in v1 unless a stricter collection rule is desired.

---

# 8. Proposed API endpoints for v1

## Core CRUD-ish book endpoints

### `POST /books`
Create a new book item.

### `GET /books`
List saved books.

### `GET /books/{item_id}`
Return a single book detail record.

### `PUT /books/{item_id}`
Update a saved book.

### `DELETE /books/{item_id}`
Optional for v1. Can be deferred.

---

## Lookup/shared endpoints books will use

### `GET /categories?collection_type_id=<book_id>`
Reuse shared category endpoint.

### `GET /ownership-statuses`
Recommended new shared endpoint if ownership dropdowns move to lookup-driven UI.

---

## API-assisted search endpoints

### `GET /books/search-external?q=...`
Search external source by title/author/general query.

### `GET /books/lookup-isbn?isbn=...`
Lookup one book by ISBN.

### `GET /books/external-sources`
Optional helper endpoint if frontend needs source availability/config later.

---

# 9. Proposed request/response shapes

## `POST /books` request

```json
{
  "collection_type_id": 2,
  "top_level_category_id": 3,
  "ownership_status_id": 1,
  "notes": "Gift copy",
  "title": "The Name of the Wind",
  "author": "Patrick Rothfuss",
  "isbn_10": "0756404746",
  "isbn_13": "9780756404741",
  "publisher": "DAW Books",
  "published_date": "2007-03-27",
  "page_count": 662,
  "language": "en",
  "description": "An epic fantasy novel...",
  "series_name": "The Kingkiller Chronicle",
  "series_number": 1,
  "cover_image_url": "https://example.com/cover.jpg",
  "api_source": "google_books",
  "external_work_id": "abc123"
}
```

## `POST /books` response

### Minimal version
```json
{
  "item_id": 42,
  "status": "created"
}
```

### Better version
```json
{
  "item_id": 42,
  "status": "created",
  "book": {
    "item_id": 42,
    "category": "Fiction",
    "ownership_status": "Owned",
    "notes": "Gift copy",
    "title": "The Name of the Wind",
    "author": "Patrick Rothfuss",
    "isbn_10": "0756404746",
    "isbn_13": "9780756404741",
    "publisher": "DAW Books",
    "published_date": "2007-03-27",
    "page_count": 662,
    "language": "en",
    "description": "An epic fantasy novel...",
    "series_name": "The Kingkiller Chronicle",
    "series_number": 1,
    "cover_image_url": "https://example.com/cover.jpg",
    "api_source": "google_books",
    "external_work_id": "abc123"
  }
}
```

### Recommendation
The “better version” is more frontend-friendly and reduces immediate refetching.

---

## `GET /books` response proposal

```json
[
  {
    "item_id": 42,
    "category": "Fiction",
    "ownership_status": "Owned",
    "notes": "Gift copy",
    "title": "The Name of the Wind",
    "author": "Patrick Rothfuss",
    "isbn_10": "0756404746",
    "isbn_13": "9780756404741",
    "publisher": "DAW Books",
    "published_date": "2007-03-27",
    "page_count": 662,
    "language": "en",
    "series_name": "The Kingkiller Chronicle",
    "series_number": 1,
    "cover_image_url": "https://example.com/cover.jpg"
  }
]
```

## `GET /books/{item_id}` response proposal

```json
{
  "item_id": 42,
  "category": "Fiction",
  "ownership_status": "Owned",
  "notes": "Gift copy",
  "title": "The Name of the Wind",
  "author": "Patrick Rothfuss",
  "isbn_10": "0756404746",
  "isbn_13": "9780756404741",
  "publisher": "DAW Books",
  "published_date": "2007-03-27",
  "page_count": 662,
  "language": "en",
  "description": "An epic fantasy novel...",
  "series_name": "The Kingkiller Chronicle",
  "series_number": 1,
  "cover_image_url": "https://example.com/cover.jpg",
  "api_source": "google_books",
  "external_work_id": "abc123"
}
```

---

# 10. External API normalization contract

The backend should normalize external results into a stable internal shape so the frontend does not have to care whether the data came from Google Books or Open Library.

## Proposed normalized external result shape

```json
[
  {
    "title": "The Name of the Wind",
    "author": "Patrick Rothfuss",
    "isbn_10": "0756404746",
    "isbn_13": "9780756404741",
    "publisher": "DAW Books",
    "published_date": "2007-03-27",
    "page_count": 662,
    "language": "en",
    "description": "An epic fantasy novel...",
    "series_name": null,
    "series_number": null,
    "cover_image_url": "https://example.com/cover.jpg",
    "api_source": "google_books",
    "external_work_id": "abc123"
  }
]
```

## Recommendation
Normalize:
- authors list → a single author string for v1
- language → short code if possible
- ISBN arrays → split into `isbn_10` and `isbn_13`
- date → most precise available string

---

# 11. Suggested backend creation logic

For `POST /books`:

1. validate shared item fields
2. insert row into `tbl_items`
3. insert row into `tbl_book_details`
4. return `item_id` or joined created object

## Example validation rules

### Required
- `collection_type_id`
- `top_level_category_id`
- `ownership_status_id`
- `title`
- `author`

### Optional
- everything else

### Soft validation recommendations
- trim title/author
- normalize blank strings to null for optional fields
- warn, but do not block, if both ISBN fields are missing
- warn, but do not block, if no category selected

---

# 12. Suggested frontend form mapping

## Manual entry mode
Fields to show:
- top-level category
- ownership status
- title
- author
- ISBN-13
- ISBN-10
- publisher
- published date
- page count
- language
- series name
- series number
- description
- notes

## API-assisted mode
Fields to show:
- search bar or ISBN input
- result picker
- editable confirmation form
- save button

## Recommended UX pattern
1. user searches by ISBN or title
2. results appear
3. user selects one
4. form auto-fills
5. user adjusts category/ownership/notes
6. user saves

---

# 13. What is intentionally excluded from v1

## Author normalization
No `tbl_authors` or xref in v1.

## Publisher normalization
No publisher lookup in v1.

## Series normalization
No separate series table in v1.

## Reading-status tracking
Not part of book collection v1 unless later merged with a reading workflow.

## Ratings/reviews
Deferred.

## File/library attachment management
Deferred.

## Cover image caching/download storage
Deferred.

---

# 14. Migration implications if added later

If future complexity is needed, this v1 schema can evolve into:

- `tbl_authors`
- `xref_book_authors`
- `tbl_series`
- `xref_book_tags`
- local image caching/storage tables
- edition/work-level separation

The v1 structure is intentionally simple enough to build now without painting the project into a corner.

---

# 15. Recommended seed data requirements

## `lkup_collection_types`
Must include:
- `photocard`
- `book`

## `lkup_top_level_categories`
Must include book rows:
- `Fiction`
- `Non-Fiction`

## `lkup_ownership_statuses`
Must be seeded already for shared item creation.

---

# 16. Suggested implementation order

## Backend
1. seed `book` collection type
2. seed book categories
3. create `tbl_book_details`
4. add `POST /books`
5. add `GET /books`
6. add `GET /books/{item_id}`
7. add optional external lookup endpoints

## Frontend
1. basic manual-entry tester
2. list saved books
3. ISBN lookup UI
4. external search UI
5. confirmation/edit flow

---

# 17. Summary recommendation

The best v1 Books implementation is:

- one shared `tbl_items` row per book
- one `tbl_book_details` row per book
- minimal normalization
- strong support for optional API enrichment
- no complex relationship tables unless real use cases demand them

This keeps the module aligned with CollectCore’s architecture while making books lighter and easier to ingest than photocards.
