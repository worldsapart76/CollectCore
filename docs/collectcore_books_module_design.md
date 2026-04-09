# CollectCore – Books Module Design & Decisions

## 1. Purpose

The Books module is the first non-photocard collection type planned for CollectCore.
It is designed to reuse the shared item infrastructure while introducing book-specific
metadata and optional external data enrichment via public APIs.

---

## 2. Relationship to Core Architecture

### Shared with all collection types
Books will use:

- `tbl_items`
- `lkup_collection_types`
- `lkup_top_level_categories`
- `lkup_ownership_statuses`

### Book-specific (planned)
- `tbl_book_details` (not yet implemented)
- `lkup_book_genres` (not yet implemented — see Section 17)
- potential additional lookup tables (if needed)

### Explicitly NOT shared with photocards
- `lkup_photocard_groups`
- `lkup_photocard_members`
- `lkup_photocard_source_origins`
- `xref_photocard_members`

---

## 3. Core Design Philosophy for Books

The guiding principles:

- Minimal required manual input
- Maximize enrichment via APIs
- Avoid over-modeling too early
- Do not mirror Calibre's complexity
- Focus on usability over completeness

---

## 4. Proposed `tbl_book_details` Structure

### Core fields (discussed and likely to be included)

- `item_id` (FK to `tbl_items`)
- `title`
- `author`
- `isbn_10` (nullable)
- `isbn_13` (nullable)
- `publisher` (nullable)
- `published_date` (nullable)
- `page_count` (nullable)
- `language` (nullable)
- `description` (nullable)

### Classification fields (partially designed — see Sections 16 and 17)

- `genre_id` (FK to `lkup_book_genres`, nullable) — top-level genre
- `subgenre_id` (FK to `lkup_book_genres`, nullable) — scoped to parent genre
- `age_level` (TEXT, nullable) — fixed value set, see Section 17
- `tags` (TEXT, nullable) — comma-separated in v1, pending tags architecture
  decision (see CLAUDE.md deferred item 15)

### Optional / debated fields

- `series_name` (possibly)
- `series_number` (possibly)
- `cover_image_url` (likely via API, may or may not be stored)
- `api_source` (to track where data came from)
- `external_work_id` (source API identifier)

### Fields on `tbl_items` relevant to books (not on tbl_book_details)

- `format` — top-level Physical/Digital/Audio (placement decided, not
  yet implemented; sub-format detail still open — see Section 16)

### Fields intentionally NOT prioritized

- granular tagging systems (pending architecture decision)
- deep classification (Dewey, Library of Congress, etc.)
- overly complex relationship tables

---

## 5. Category Model for Books

Books will use:

`lkup_top_level_categories`

Expected values:
- Fiction
- Non-Fiction

### Important note
Unlike photocards:
- No secondary "subcategory" replacement is planned
- No equivalent to `source_origin`

Books rely more on:
- metadata (author, publisher, etc.)
- optional external enrichment
- genre/subgenre classification (see Section 17)

---

## 6. Ownership Model

Books use book-specific ownership statuses:

- Owned
- Wanted
- Borrowed
- Formerly Owned
- Pending

---

## 7. Public API Integration

### Primary goal
Reduce manual data entry by leveraging external book APIs.

### APIs discussed

#### Google Books API
- Most likely primary integration
- Supports:
  - ISBN lookup
  - title/author search
  - metadata enrichment

#### Open Library API (possible secondary)
- Backup or supplement
- Good for:
  - open/free metadata
  - alternative coverage

---

## 8. API Integration Strategy

### Input methods
User can:
- paste ISBN
- search by title/author
- scan ISBN via barcode (future — backend endpoint designed now,
  UI deferred; see Section 14)

### Workflow
1. User enters ISBN or search query
2. Frontend calls backend endpoint
3. Backend queries external API
4. Backend returns normalized book data
5. User confirms/edits before saving

---

## 9. Data Normalization Decisions

### Decision: Do NOT over-normalize authors (for now)

Options considered:
- separate `authors` table + xref
- single text field

Chosen approach:
- store `author` as text initially

Reason:
- avoids complexity early
- sufficient for most personal use cases
- can be refactored later if needed

---

### Decision: Do NOT over-normalize publishers (for now)

- stored as text
- no lookup table initially

---

### Decision: ISBN is the primary unique identifier (when available)

- `isbn_13` preferred
- `isbn_10` optional fallback

Important:
- Not all books will have ISBNs (edge cases allowed)
- ISBNs from Goodreads must NOT be used — they reflect the edition
  tracked on that platform, not necessarily the physical copy owned

---

## 10. Differences from Photocard Model

| Concept | Photocards | Books |
|---|---|---|
| Source classification | `source_origin` | none |
| Variation field | `version` | none |
| Many-to-many relationships | members | none initially |
| Lookup-heavy structure | yes | minimal |
| API enrichment | no | yes |
| Genre classification | no | yes (see Section 17) |
| Age level classification | no | yes |

---

## 11. Fields Deliberately Deferred

- series relationships (may need separate table later)
- multiple authors (if needed → future xref)
- ratings/reviews (not core to collection tracking)
- file attachments / EPUB linking (future consideration)
- reading status (open question — see Section 16)

---

## 12. Migration / Data Entry Considerations

### Books will differ from photocards in workflow:

Photocards:
- manual tagging
- structured lookup-driven fields
- image-first ingest

Books:
- Goodreads CSV migration for initial data seed (see Section 13)
- API-first ingestion for new books after migration
- minimal manual typing
- optional override/edit

---

## 13. Initial Data Migration — Goodreads Export

### Source
Goodreads CSV export (4,379 records).

### Dependency note
Migration cannot be fully implemented until open design items in
Section 16 are resolved (format sub-type, reading status, tags).
Do not write a migration script until those decisions are made.
Top-level format (Physical/Digital/Audio) CAN be populated during
migration from Goodreads library-* shelf tags.

### Migration philosophy
The Goodreads export seeds the collection with known titles and
available structured metadata. It is NOT treated as a source of
authoritative bibliographic metadata — that comes from external APIs
after migration.

### Fields to import from Goodreads CSV

#### Direct field mapping
- `title` → `tbl_book_details.title`
- `author` → `tbl_book_details.author`
- `series` → `tbl_book_details.series_name` (where present)
- `series_number` → `tbl_book_details.series_number` (where present)

#### Shelf tag mapping — ownership and format
Goodreads library-* shelf tags are a concatenation of ownership status
and format. They should be split as follows:

**Ownership status (→ tbl_items.ownership_status_id)**
- Any `library-*` tag → Owned
- `library-overdrive` → Borrowed
- `library-formerly-owned` → Formerly Owned
- `to-read` (with no library-* tag) → Wanted
- `currently-reading` → Owned (active)

**Top-level format (→ tbl_items.format — once implemented)**
- `library-paper` → Physical
- `library-kindle`, `library-kindle-unlimited`, `library-kobo`,
  `library-smashwords`, `library-glose`, `library-free-online` → Digital
- `library-audible`, `library-audio-file`, `library-audiocd`,
  `library-kobo-audio`, `library-chirp` → Audio
- `library-overdrive` → Digital
- `library-other` → flag for manual review
- `freebie`, `stripped-or-arc` → format unknown, flag for manual review

#### Fields intentionally NOT imported from Goodreads
- **ISBN** — Goodreads ISBNs reflect the tracked edition, not the
  owned copy. ISBNs must be captured separately per owned copy via
  manual entry or barcode scan after migration.
- **Genre/subgenre/age level** — Goodreads shelf tags do not map
  cleanly to CollectCore genre system. Set manually after migration.
- **Reading status** — deferred pending design decision (see Section 16)
- **Ratings** — deferred (reviews/ratings explicitly out of scope for v1)
- **Read dates, read count** — deferred pending reading status decision
- **TBR tags, challenge/readathon tags** — discard, no mapping
- **Tags** — pending tags architecture decision. Do not populate tags
  from Goodreads shelf data until decided. Preserve shelf data in
  import process so it is available for mapping once decided.

### Migration implementation notes
- A one-time import script should be written to parse the Goodreads CSV
- Records should be inserted via the same `POST /books` API pathway
  used for normal creation, not via direct DB insertion
- Title and author are required; all other fields optional
- Ownership status must be explicitly set — do not default silently
- Flag any records where shelf tags are ambiguous or unmappable
- Preserve original Goodreads shelf tag data in the import process
  for later reference

---

## 14. Barcode Scanning — ISBN Ingest (Planned)

### Purpose
Allow future barcode scanning (via mobile or USB scanner) to trigger
an external API lookup and auto-fill book metadata at ingest time.

### Design approach
The backend endpoint should be designed and implemented now.
The scanner UI is a future addition and should not block backend work.

### Backend endpoint to implement
`GET /books/lookup-isbn?isbn={isbn}`

This endpoint is a first-class implementation target, not optional.

### Expected behavior
1. Client submits an ISBN (13 or 10)
2. Backend queries external API (Google Books primary, Open Library fallback)
3. Backend returns normalized book data in the standard external result shape
4. Client presents result for user confirmation before saving
5. User adjusts category, ownership status, and notes
6. User confirms — record is saved via `POST /books`

### Relationship to Goodreads migration records
For books seeded from Goodreads without ISBNs, the barcode scan
workflow is the intended enrichment path. The lookup result should be
mappable back to an existing record (by title match or manual
selection) rather than always creating a new one.

### Scanner input compatibility
The backend endpoint accepts a plain ISBN string regardless of input
source — typed, pasted, or scanned. No scanner-specific handling is
needed in the backend. The frontend will handle input method
differences when the scanner UI is built.

### Implementation status
- Backend endpoint: to be implemented
- Frontend scanner UI: deferred (future mobile or desktop integration)

---

## 15. Future Expansion Possibilities

- Author normalization (xref_author table)
- Series table with ordering
- Integration with Calibre metadata
- Sync with external reading apps
- Cover image caching/storage
- Trade list / sharing features
- Reading progress tracking
- Ratings and reviews

---

## 16. Open Design Items — Requires Decision Before Implementation

The following items have been identified as necessary for the Books module
but have not yet been designed or decided. Claude Code should raise these
explicitly and must not proceed with any schema or UI that depends on
them until each is resolved. See also CLAUDE.md Books Module Prerequisites.

### Book format (sub-format detail and multi-format handling)
Partially resolved.

**Decided:**
- Format top-level values: Physical, Digital, Audio
- Format belongs on `tbl_items`, not `tbl_book_details`
- Goodreads library-* shelf tag mapping to top-level format is defined
  (see Section 13)

**Still open:**
- How platform detail is captured (Kindle, Audible, Kobo, etc.) —
  options are a sub-format lookup field, a free-text field, or folded
  into tags. Decide before implementing tbl_book_details.
- How to handle books owned in multiple formats — one record per
  format, or one record with multiple formats captured. This affects
  whether format is a simple field or requires a more flexible
  structure. Decide before implementing tbl_book_details.

### Reading status
Not decided.

**Known requirements:**
- Goodreads data includes: to-read, currently-reading, dnf-permanent,
  dnf-read-later, and read
- First read date and read count are available from Goodreads export
- Reading status may be relevant to future non-book collection types
  (e.g., "currently watching" for movies)

**Questions to resolve:**
- Does reading status belong on tbl_items (shared) or tbl_book_details
  (book-only)?
- Should first_read_date and read_count be captured in v1?
- How are DNF states handled — single status or separate flag?

### Tags architecture
Unresolved cross-collection decision. Affects all modules, not just books.

**Questions to resolve:**
- Are tags global across all collection types, or module-specific?
- Controlled vocabulary or fully freeform?
- Until decided: do not implement tags for any module

### API category handling
Whether to store, ignore, or convert Google Books / Open Library
categories to tags is not decided.

**Questions to resolve:**
- Should API-returned categories be stored on the book record?
- If stored, do they map to the CollectCore genre system or a
  separate field?
- If converted to tags, does this depend on the tags architecture
  decision above?

### Duplicate detection UX
Soft warning vs. hard block on ISBN duplicates is not decided.

**Questions to resolve:**
- Should the app allow duplicate ISBNs (e.g., two owned copies)?
- If duplicates are allowed, should the user receive a warning?
- Hard block at the DB level or application-level soft warning?

---

## 17. Genre System Design

### Structure
The genre system uses three distinct layers:

1. **Genre** — top-level classification, required
2. **Subgenre** — optional secondary classification, scoped to parent
   genre. A subgenre cannot exist without a parent genre. Available
   subgenre options in the UI filter to only those associated with the
   selected top-level genre.
3. **Tags** — freeform metadata labels for further classification
   (e.g., star-wars, queer, classics, king-arthur). Tags are
   independent and can be added regardless of genre or subgenre
   selection. Pending tags architecture decision (see Section 16).

### Important cross-genre behavior
The same concept can exist at multiple levels independently. Examples:
- Genre: Historical Fiction (standalone, no subgenre)
- Genre: Romance > Subgenre: Historical (different classification)
- Genre: Fantasy > Subgenre: Romance
- Genre: Romance > Subgenre: Fantasy

Fantasy > Romance and Romance > Fantasy are distinct classifications
and must both exist in the lookup tables independently.

### Age classification
Age level is a separate field from genre — not a subgenre or tag.

Expected values (fixed, no admin management needed):
- Children's
- Middle Grade
- Young Adult
- New Adult
- Adult

### Starter genre/subgenre list

This list is a starting point only. New genres and subgenres will be
added via the UI over time. Do not treat this list as exhaustive or
closed.

**Fiction:**
| Genre | Subgenres |
|---|---|
| Fantasy | Epic Fantasy, Urban Fantasy, Fairy Tale, Mythology |
| Science Fiction | Hard SF, Soft SF, Space Opera, Dystopian, Steampunk, Time Travel |
| Romance | Contemporary, Historical, Paranormal, Romantic Suspense, Fantasy, Dark, Sci-Fi |
| Crime | Mystery, Suspense/Thriller, Police Procedural, Historical |
| Historical Fiction | (none currently) |
| Horror | Gothic |

**Non-Fiction:**
| Genre | Subgenres |
|---|---|
| Biography | (none currently) |
| History | (none currently) |
| Self-Help | (none currently) |
| True Crime | (none currently) |
| Other | Cookbook, Art/Photography, Religion, Humor |

### Data model

#### `lkup_book_genres`
```sql
CREATE TABLE IF NOT EXISTS lkup_book_genres (
    genre_id INTEGER PRIMARY KEY AUTOINCREMENT,
    genre_name TEXT NOT NULL,
    parent_genre_id INTEGER NULL,
    collection_type_id INTEGER NOT NULL,
    FOREIGN KEY (parent_genre_id) REFERENCES lkup_book_genres(genre_id),
    FOREIGN KEY (collection_type_id) REFERENCES lkup_collection_types(collection_type_id)
);
```

- Top-level genres have `parent_genre_id = NULL`
- Subgenres reference their parent genre via `parent_genre_id`
- `collection_type_id` scopes genres to books (allows future reuse
  for other collection types if needed)

#### `tbl_book_details` genre fields
- `genre_id` INTEGER NULL — FK to `lkup_book_genres` (top-level only)
- `subgenre_id` INTEGER NULL — FK to `lkup_book_genres` (subgenre only)
- `age_level` TEXT NULL — stored as text from fixed value set
- `tags` TEXT NULL — comma-separated freeform in v1, pending
  tags architecture decision

### UI requirements
- Genre and subgenre dropdowns must be admin-manageable from the UI
- Adding a new genre or subgenre must not require a code change
- Subgenre dropdown filters to only show subgenres belonging to the
  selected parent genre
- Age level is a fixed dropdown — no admin management needed
- Tags are a free-text input in v1

### Migration note
Goodreads shelf tags will not auto-map to the genre system during
the initial Goodreads migration. Genre, subgenre, and age level will
be set manually after migration. Tags may be partially populated from
Goodreads shelf data once the tags architecture decision is made.

---

## 18. Current Implementation Status

### Implemented
- Nothing yet in code

### Designed / agreed
- Shared architecture usage
- Field philosophy
- API-first approach for new books
- Goodreads CSV as initial migration source
- Avoid over-normalization
- Genre/subgenre system (Section 17)
- Age level field
- Format top-level values (Physical/Digital/Audio) on tbl_items
- Goodreads shelf tag → ownership/format mapping
- Barcode scan backend endpoint as first-class target

### Not finalized
- Exact schema for `tbl_book_details`
- API endpoints for book lookup
- UI workflow for search/selection
- Image storage strategy
- Format sub-format detail and multi-format handling
- Reading status
- Tags architecture
- API category handling
- Duplicate detection UX

---

## 19. Summary

The Books module is designed to be:

- lighter than the photocard model
- API-assisted for new book ingest, migration-seeded for existing collection
- minimally normalized at first
- fully compatible with the shared item architecture

It prioritizes **ease of ingestion and flexibility** over strict structural
rigor, with room to evolve into more complex modeling if needed.
