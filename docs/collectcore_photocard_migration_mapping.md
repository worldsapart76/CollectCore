# CollectCore Photocard Migration Mapping Guide

## Purpose

This document maps the **original photocard tracker database** to the **new CollectCore multi-collection structure** for the photocard module. It focuses on field-level mapping, relationship changes, and any behavior that is explicitly different in the new schema.

---

## 1. High-level structural change

### Original structure
The original photocard tracker was effectively **photocard-specific**. A single card record held both:
- item-level/shared information
- photocard-specific information

### New structure
CollectCore splits that into:

- `tbl_items`  
  Shared item record used across all collection types

- `tbl_photocard_details`  
  Photocard-specific detail record keyed by `item_id`

- lookup tables  
  Shared and photocard-specific controlled vocabularies

- xref tables  
  Used where relationships are many-to-many

### Migration implication
A single original photocard record now becomes **at least two rows**:
1. one row in `tbl_items`
2. one row in `tbl_photocard_details`

It may also create:
- one or more rows in `xref_photocard_members`
- one or more lookup rows if referenced values do not already exist

---

## 2. Table-by-table mapping

## Original photocard record → `tbl_items`

### New destination
`tbl_items`

### Fields in new table
- `item_id`
- `collection_type_id`
- `top_level_category_id`
- `ownership_status_id`
- `notes`
- timestamps

### Mapping
| Original field | New field | Notes |
|---|---|---|
| card primary key / id | `item_id` | New primary key in CollectCore shared item layer |
| top-level category | `top_level_category_id` | Must map to shared top-level category lookup |
| ownership status | `ownership_status_id` | Must map to shared ownership lookup |
| notes | `notes` | Carries over directly |
| created_at | timestamps | If migrated, map into new timestamp fields as appropriate |

### Important difference
The original record was photocard-specific. In CollectCore, the base item row is **not photocard-specific**, so only shared/common fields belong here.

---

## Original photocard record → `tbl_photocard_details`

### New destination
`tbl_photocard_details`

### Fields in new table
- `item_id`
- `group_id`
- `source_origin_id`
- `version`

### Mapping
| Original field | New field | Notes |
|---|---|---|
| group / group_code | `group_id` | Must resolve to `lkup_photocard_groups.group_id` |
| source / subcategory / origin-related field | `source_origin_id` | Depends on original semantic meaning; see source-origin notes below |
| version / source detail / variation text | `version` | Use for variant information like POB/store/member variation |
| old card id linkage | `item_id` | Must point to row created in `tbl_items` |

### Important difference
The old structure mixed item-level and photocard-level values together. The new structure requires those values to be separated correctly.

---

## Original member field → `xref_photocard_members`

### New destination
`xref_photocard_members`

### New fields
- `item_id`
- `member_id`

### Mapping
| Original field | New destination | Notes |
|---|---|---|
| `member` | `xref_photocard_members.member_id` | Must resolve to one or more member IDs |

### Important difference
In the original app, `member` was a direct field on the card record. In CollectCore, members are stored as a **many-to-many relationship**.

### Migration rule
- If original card has one member: create one xref row
- If original card represents multiple members: create multiple xref rows
- If original app used a literal value like `Multiple`, decide whether to:
  - preserve it through a special `Multiple` member lookup row, or
  - convert into explicit member rows if the data is granular enough

---

## 3. Lookup table mapping

## Original group values → `lkup_photocard_groups`

### Destination lookup
`lkup_photocard_groups`

### Relevant fields
- `group_id`
- `group_code`
- `group_name`

### Mapping rule
Original group values must resolve to a valid `group_id`.

### Migration note
If the original DB stored group as a code such as `skz`, migration should:
1. find matching row in `lkup_photocard_groups`
2. use its `group_id` in `tbl_photocard_details`

---

## Original member values → `lkup_photocard_members`

### Destination lookup
`lkup_photocard_members`

### Relevant fields
- `member_id`
- `group_id`
- `member_code`
- `member_name`

### Mapping rule
Original member values must resolve to valid `member_id` rows tied to the correct `group_id`.

### Important difference
Member resolution now depends on both:
- the member value
- the group context

That is stricter and more normalized than the old direct text field approach.

---

## Original category values → `lkup_top_level_categories`

### Destination lookup
`lkup_top_level_categories`

### Relevant fields
- `top_level_category_id`
- `collection_type_id`
- `category_name`

### Mapping rule
Original photocard top-level categories should map into the shared category table for the `photocard` collection type.

### Known photocard values discussed
- `Album`
- `Non-Album`

### Important difference
Categories are no longer photocard-only infrastructure. They now live in a shared collection-aware lookup table.

---

## Original ownership values → `lkup_ownership_statuses`

### Destination lookup
`lkup_ownership_statuses`

### Relevant fields
- `ownership_status_id`
- status name

### Known values discussed
- `Owned`
- `Wanted`
- `Trade`
- `Formerly Owned`
- `Pending`

### Mapping rule
Original ownership text or codes must resolve to the correct `ownership_status_id`.

### Important difference
This lookup is now shared across collection types, not local to photocards.

---

## 4. Explicitly removed or redefined fields

## `subcategory` → removed

### Old state
The original app used `subcategory`.

### New state
`subcategory` does **not** exist in the new CollectCore photocard schema.

### Replacement
The original meaning must be split into one of two destinations:

- `source_origin_id`
- `version`

### How to decide
| If original value means... | New destination |
|---|---|
| the base album / event / merch line / release origin | `source_origin_id` |
| a variation of that origin, such as POB/store variant/member variant text | `version` |

### Example
| Original value | New mapping |
|---|---|
| `5-STAR` | `source_origin_id` |
| `Soundwave POB` | `version` |

### Important difference
This is one of the biggest semantic changes in the model. Do **not** do a blind 1:1 copy from old `subcategory` into new `source_origin_id`.

---

## `source` label → conceptually reworked

### Old state
The original app had a `source` field/label in the older photocard workflow.

### New state
The concept has been split and clarified:
- `source_origin` = origin of the card
- `version` = specific variation

### Migration implication
Any old field/value historically labeled `source` must be reviewed for actual meaning before mapping.

---

## 5. Nullability and requirement changes

## `source_origin_id` is now nullable

### Old assumption
The original workflow often treated origin/source-style classification as more required during card entry.

### New state
`tbl_photocard_details.source_origin_id` is explicitly nullable.

### Migration implication
If an original record does not have a trustworthy source-origin value:
- it is valid to migrate with `source_origin_id = NULL`

### Important downstream note
Because this field is nullable:
- backend list queries must use `LEFT JOIN`
- frontend must allow empty source-origin state

---

## Members are no longer a single required scalar field

### Old state
The original card schema used a direct `member` field.

### New state
Members are stored in `xref_photocard_members`.

### Migration implication
The migration must create xref rows rather than copying into a single destination column.

---

## Shared base item fields are now required for photocards

### New required shared references
A migrated photocard now depends on:
- `collection_type_id`
- `top_level_category_id`
- `ownership_status_id`

### Migration implication
Even though the original app was photocard-only, every migrated record must now be attached to:
- collection type = photocard
- a valid shared category row
- a valid shared ownership row

---

## 6. Field-by-field practical mapping

This section assumes a typical original photocard record shape based on the prior app design.

| Original photocard tracker field | New location | New field | Notes |
|---|---|---|---|
| `id` | `tbl_items` | `item_id` | New shared item primary key |
| `group_code` or group value | `tbl_photocard_details` | `group_id` | Resolve through `lkup_photocard_groups` |
| `member` | `xref_photocard_members` | `member_id` | One-to-many or many-to-many mapping |
| `top_level_category` | `tbl_items` | `top_level_category_id` | Resolve through shared top-level category lookup |
| `subcategory` | split | `source_origin_id` and/or `version` | Requires semantic review |
| `source` | split | `source_origin_id` and/or `version` | Requires semantic review |
| `version` | `tbl_photocard_details` | `version` | Carries forward if already true version data |
| `ownership_status` | `tbl_items` | `ownership_status_id` | Resolve through ownership lookup |
| `notes` | `tbl_items` | `notes` | Carry over directly |
| `created_at` | `tbl_items` timestamp field | timestamp | If preserved in migration |
| image fields from old app | unresolved in current CollectCore schema | unresolved | See deferred notes below |

---

## 7. Relationship changes

## Old: single-table-ish photocard model
The original app was centered on a direct photocard record.

## New: normalized multi-table model
A photocard now spans:
- one `tbl_items` row
- one `tbl_photocard_details` row
- zero or one `lkup_photocard_source_origins` row referenced by FK
- one or more `xref_photocard_members` rows

### Migration implication
Migration logic must be staged in this order:
1. resolve lookup IDs
2. insert `tbl_items`
3. insert `tbl_photocard_details`
4. insert `xref_photocard_members`

---

## 8. Source-origin migration strategy

This is the area most likely to need manual review.

## New lookup destination
`lkup_photocard_source_origins`

### Relevant fields
- `source_origin_id`
- `group_id`
- `top_level_category_id`
- `source_origin_name`

### Migration rule
A source origin is not global. It is scoped by:
- group
- top-level category

### Practical migration process
For each original record:
1. determine whether the old value really represents source origin
2. identify the card's `group_id`
3. identify the card's `top_level_category_id`
4. find or create matching row in `lkup_photocard_source_origins`
5. store its `source_origin_id` in `tbl_photocard_details`

### Important difference
The same text label could theoretically exist more than once across different groups or categories because source origins are context-scoped now.

---

## 9. API and frontend mapping implications

The schema changes affect migration targets and also the shape expected by the new app.

## Create payload shape changed
The current new app expects create payloads like:

- `collection_type_id`
- `top_level_category_id`
- `ownership_status_id`
- `notes`
- `group_id`
- `source_origin_id`
- `version`
- `member_ids`

### Migration implication
If writing an import tool through the API instead of direct DB insertion, the importer must transform original records into this payload shape.

---

## Read/list shape changed
The current list response is a joined display model with fields like:
- `item_id`
- `category`
- `ownership_status`
- `group`
- `source_origin`
- `version`
- `members`
- `notes`

### Migration implication
This is not a raw row dump of the new schema. Validation checks after migration should understand that create/import structures and read/list structures are different.

---

## 10. Image storage fields — RESOLVED

The original photocard tracker had `front_image_path` and `back_image_path` directly on the card record.

### Current state (CollectCore)
Images are stored in a shared `tbl_attachments` table:
- `item_id` FK, `attachment_type` ('front' / 'back'), `file_path`, timestamps
- The library query pivots this into `front_image_path` and `back_image_path` via LEFT JOIN
- Filename structure preserved: `{group_code}_{id:06d}_{side}.{ext}` (e.g. `skz_000123_f.jpg`)

### Migration outcome
The migration script (`backend/migrate_from_original.py`) copied images from `PhotocardTracker/images/library/` to `CollectCore/images/library/` and created `tbl_attachments` rows for each front and back. 1,891 attachment rows created for 1,036 migrated cards.

---

## 11. Suggested migration rules

## Rule 1
Every original photocard record should create:
- one `tbl_items` row
- one `tbl_photocard_details` row

## Rule 2
Resolve all controlled values through lookup tables instead of copying raw text into FK columns.

## Rule 3
Do not migrate old `subcategory` blindly. Review and split into:
- `source_origin_id`
- `version`

## Rule 4
If source origin is unknown or unreliable, set:
- `source_origin_id = NULL`

## Rule 5
Convert original member values into xref rows, not a scalar field.

## Rule 6
Use `collection_type_id` for photocard on every migrated photocard item.

---

## 12. Example migration mapping

### Example original record
- group: `skz`
- top_level_category: `Album`
- subcategory: `5-STAR`
- source/version detail: `Soundwave POB`
- member: `Felix`
- ownership_status: `Owned`
- notes: `pulled from sealed album`

### New mapping
#### `tbl_items`
- `collection_type_id` = photocard collection type ID
- `top_level_category_id` = Album category ID for photocard
- `ownership_status_id` = Owned status ID
- `notes` = `pulled from sealed album`

#### `tbl_photocard_details`
- `item_id` = new item ID
- `group_id` = SKZ group ID
- `source_origin_id` = lookup row for `5-STAR` scoped to SKZ + Album
- `version` = `Soundwave POB`

#### `xref_photocard_members`
- one row linking `item_id` to Felix's `member_id`

---

## 13. Summary of explicit differences from the old app

- The new system is **multi-collection**, not photocard-only.
- Common item fields moved into `tbl_items`.
- Photocard-specific fields moved into `tbl_photocard_details`.
- `member` is no longer a direct scalar field.
- `subcategory` was removed.
- `source_origin` and `version` are now distinct concepts.
- `source_origin_id` is explicitly nullable.
- Categories and ownership now resolve through shared lookup tables.
- Source origins are scoped by `group_id` and `top_level_category_id`.
- Image-field mapping is not yet finalized in the documented new schema.

---

## 14. Best-use note for continued development

If you build a migration script, the safest order is:

1. seed/verify all required lookup tables
2. resolve collection type/category/ownership/group/member IDs
3. insert `tbl_items`
4. insert `tbl_photocard_details`
5. insert `xref_photocard_members`
6. separately handle unresolved image-field migration if needed

This avoids foreign-key failures and keeps the semantic split between old and new fields explicit.
