# Photocard Secondary Source Origins — Plan

**Status:** BUILT 2026-11-20 on branch `feature/secondary-origins` (backup tag
`backup/pre-secondary-origins` = the commit before). Drafted 2026-11-20.
**Scope:** photocards only. Admin library + `/pcs/`. Market section explicitly
out of scope.

## Problem

Some sets are officially tied to a tour, but the card backs match an album.
Example: the official set is **Non-Album → Dominate**, but the backs read
**Hollow**. Someone holding the card looks under Hollow and doesn't find it.

Requirement: one card can be **in two source origins at once**. It shows up
under either one and is found by either one, with **no duplicate card** and
**no third "combined" origin, note or badge** standing in for real membership.

## Model

- `tbl_photocard_details.source_origin_id` stays the card's **primary origin**,
  the official one (Dominate). Nothing about it changes.
- A new side table holds any **secondary origins** (Hollow):

```sql
CREATE TABLE IF NOT EXISTS xref_photocard_secondary_origins (
    item_id          INTEGER NOT NULL,
    source_origin_id INTEGER NOT NULL,

    FOREIGN KEY (item_id) REFERENCES tbl_items(item_id),
    FOREIGN KEY (source_origin_id) REFERENCES lkup_photocard_source_origins(source_origin_id),
    UNIQUE (item_id, source_origin_id)
);
CREATE INDEX IF NOT EXISTS idx_xpso_origin ON xref_photocard_secondary_origins(source_origin_id);
```

Same shape as `xref_photocard_members`. Created by `schema.sql`, so the change is
additive and idempotent, and existing databases pick it up on restart.

### Why primary + secondary, not a full many-to-many

`source_origin_id` has ~150 references across 38 files (ingest, trade captions,
trade CSV, Mercari titles, card book, market, catalog, guest seed). Most of them
need **exactly one** answer. Leaving the scalar alone means none of them change.
To the user, membership is equal wherever finding and filtering happen.
"Primary" only matters where the app has to print or sort by one name.

### Why a side table, not a column on `tbl_photocard_details`

CLAUDE.md rule: `catalog.py` (`SELECT *`) and `seed_builder.py` (PRAGMA copy)
reflect `tbl_photocard_details`. A side table ships to neither. That is the
intent: the WASM `/guest/` tier is frozen and won't get this feature. `/pcs/` gets
it from its live query instead (below).

### Invariants (enforced by the API, not the DB)

1. A card's secondary list **never contains its own primary**. Adding the
   primary as a secondary is a no-op.
2. Changing a card's primary to an origin it already holds as a secondary
   **deletes that secondary row** (the origin is promoted, not duplicated).
3. A secondary origin must be in the **same group** as the card
   (`lkup_photocard_source_origins.group_id = tbl_photocard_details.group_id`).
   **Category is unrestricted**: the whole point is Non-Album ↔ Album.
4. Every delete path removes the card's xref rows explicitly. FK cascades never
   fire (CLAUDE.md).

## Decisions (confirmed by the user, 2026-11-20)

1. **Trade captions and the trade CSV keep the primary origin only.** The card
   image does the identifying work, not the caption.
2. **Sort stays primary-based.** When filtered to Hollow, Dominate cards sort as
   their own block (Non-Album / Dominate), not mixed in with the Hollow cards.
3. **Secondaries must be bulk-editable and visible in the detail modal.**
4. **Market is out of scope.** It keeps reading the primary only. That includes
   ship dates and age priors, which are the tour's. Nothing there breaks.

## What changes

### Backend

| Where | Change |
|---|---|
| `backend/sql/schema.sql` | New table + index above. |
| `routers/photocards.py`: `_attach_secondary_origins(db, cards)` | New helper, same pattern as `_attach_copies`: one `IN (...)` query joining `lkup_photocard_source_origins` + `lkup_top_level_categories`. It attaches `secondary_origins: [{source_origin_id, source_origin_name, top_level_category_id, category_name}]` (sorted by name) to each card. Called by `list_photocards`, `get_photocard`, `_get_photocard`. |
| `PUT /photocards/{id}` | `PhotocardUpdate` gains `secondary_origin_ids: Optional[List[int]] = None`. `None` = leave untouched (callers that don't send it keep working). A list = replace the card's whole set, applying invariants 1–3. Always applies invariant 2 when the primary changes. |
| `PATCH /photocards/bulk` | `BulkUpdateFields` gains `secondary_origins_add` and `secondary_origins_remove` (both `Optional[List[int]]`). **Add/remove, not replace**: the cards in a selection can hold different secondaries, and replace would wipe them. Add uses `INSERT OR IGNORE` and skips cards where the origin is the primary or in another group. The response adds `secondary_origins: {added, removed, skipped}`. When `source_origin_id` is bulk-changed, invariant 2 runs per card. |
| `DELETE /photocards/{id}`, `POST /photocards/bulk-delete` | Add `DELETE FROM xref_photocard_secondary_origins WHERE item_id = ...` next to the member xref delete. |
| `routers/shared.py` `GET /photocards/source-origins` | Make `category_id` optional. Without it, return every origin in the group with `top_level_category_id` + `category_name` added to each row, ordered by category then `sort_order`, name. This feeds the "Also in" picker. Existing callers always send `category_id` and see no change. |
| `routers/pcs.py` card list | One more `IN (...)` query, same as members, adding `secondary_origins` to each card dict. Catalog cards only, which the outer query already restricts to. |
| `pdf_card_book.py` | See **Card book** below. |
| `docs/collectcore_summary.md` | Schema table + endpoint changes. |

No data migration and no seed script. Tagging happens **in prod through bulk
edit**. Origin ids and names drift between dev and prod, so ids from dev must
never be copied over.

### Shared filtering (`components/photocard/photocardFiltering.js`)

These are pure functions. The library, the Binder Designer tray and `/pcs/` all
get the change automatically.

Two helpers:

```js
export const cardOriginIds = (c) =>
  [c.source_origin_id, ...(c.secondary_origins || []).map(o => o.source_origin_id)]
    .filter(Boolean).map(String);
export const cardCategoryIds = (c) =>
  [c.top_level_category_id, ...(c.secondary_origins || []).map(o => o.top_level_category_id)]
    .filter(Boolean).map(String);   // dedupe via Set
```

| Function | Change |
|---|---|
| `applyPhotocardFilters`: sourceOrigin | `applySection(filters.sourceOrigin, cardOriginIds(c))` |
| `applyPhotocardFilters`: category | `applySection(filters.category, cardCategoryIds(c))`. Without this, **Album → Hollow** hides the Dominate cards, because their own category is Non-Album. |
| `applyPhotocardFilters`: text search | Also match any `secondary_origins[].source_origin_name`. |
| `deriveFilterSourceOrigins` | Also add each card's secondaries to the list, so Hollow appears even if every card currently visible under it is a Dominate card. |
| `deriveFilterVersions` | Scope check uses `cardOriginIds(c)`. A Dominate card's version (e.g. "Seoul") will therefore appear in Hollow's version list, which is correct since the card is in Hollow. |
| `sortPhotocards` | **Unchanged** (decision 2). |

Semantics that follow from `applySection` as it is, and are intended:
- **Exclude** Hollow → also hides Dominate cards that are in Hollow. Exclude
  Album → also hides them. "In both" means in both.
- **AND** mode with Dominate + Hollow selected → only the cards in both: a quick
  way to audit what has been tagged.

### Display

One helper, `originLabel(card)` → `"Dominate · Hollow"` (primary first, then
secondaries by name). It goes in `photocardFiltering.js` next to the others.

| Where | Shows |
|---|---|
| `PhotocardGrid.jsx` caption (line ~239) | `originLabel(card)` |
| `PhotocardDetailModal.jsx` | Editable **"Also in"** row, see below |
| `PcsPhotocardDetailModal.jsx` (line ~314) | Read-only `Field label="Also in"` under Source when the list is non-empty |
| Binder `BinderSlot.jsx`, `CardTray.jsx` tooltips, `WantedSweepModal.jsx` | `originLabel(card)` in place of `card.source_origin` |
| Trade captions, trade CSV, Mercari titles, market | **Unchanged**: primary only (decisions 1, 4) |
| `GuestPhotocardDetailModal.jsx` (WASM) | Unchanged. The tier is frozen and never receives the data |

### Editing

**Detail modal (`PhotocardDetailModal.jsx`)**: revised 2026-11-20 after the
user tried the first version (a primary dropdown plus a separate "Also in" row
felt clunky). There is now **one "Source Origins" row of chips**:

- **★ chip = primary.** It is styled stronger and has **no ×**: it can't be
  removed, only replaced by starring another chip.
- **Other chips** have a ☆ ("Make primary") and a ×. Starring swaps them: the
  old primary drops back to a normal chip rather than disappearing.
- **+ Add** opens a searchable list of the group's origins across **all
  categories**, grouped by category, leaving out those already on the card.
  **"Create new origin…"** at the bottom replaces the old separate + Add
  (name plus category). A pick becomes the primary if the card has none,
  otherwise it is added as a secondary.
- **Category follows the primary.** The Category row is read-only text showing
  the primary's category, and the save sends it. It is an editable dropdown only
  on a card with no origin at all. The old behaviour, where changing Category
  silently reset the origin, is gone. The user accepted that a card whose stored
  category disagrees with its origin flips on next save: that flags a misfiling.
- No click-to-replace on the primary chip. Changing a card's only origin is add
  → ☆ → ×, which the user accepted since re-filing is now rare.
- Edits save with the rest of the card in the existing `PUT`. Secondaries are
  sent only once touched.

**Bulk edit (`PhotocardBulkEdit.jsx`)**: a new toggled section, "Also in
origins", in the existing pattern:

- Mode: **Add** / **Remove**.
- An origin picker using the same all-categories `<optgroup>` list.
- Enabled when the selection is a **single group**. Unlike the primary origin
  field, this one does **not** require a single category.
- Sends `secondary_origins_add` / `secondary_origins_remove`. The result toast
  reports skipped cards, the same way ownership sweeps report theirs.

Tagging a whole tour set then takes one pass: filter to Dominate → select all →
Bulk edit → Also in → Add Hollow.

**Picker ordering (both pickers):** origins from the **other** category are
listed first: the card's primary category in the modal, the selection's shared
category in bulk edit. The usual second origin is the opposite kind (album ↔
tour). With the primary's own category first, about 29 album names pushed the
tour origins out of view, which read as "restricted to one category".

**Bulk edit row order** (2026-11-20) follows the card modal: Card Type →
Category → Source Origin → Also in → Version → Members → Ownership.

**Not touched:** Inbox, Bulk Create and Batch Image create cards with one
primary as now. Secondaries are added afterwards through bulk edit.

### Card book PDF

The book is grouped member → origin. **Recommendation: list a card under its
primary origin section and under each secondary.** It's a finding aid used while
holding the card, and the back is what you're holding. Decision 1 of the card
book plan already sets the precedent (unit cards repeat in every member's
section), and fpdf2 reuses the embedded image, so the repeats add almost no file
size.

Implementation: `load_cards` also reads the xref. The grouping loop (around
line 495) appends the card to `groups[secondary_id]` too. The origin band count
then includes it. Applies to the admin and `/pcs/` books, which share
`load_cards`.

*Confirmed by the user 2026-11-20: repeat the card in every origin it is in.*

## Build order

1. **Backend:** schema, `_attach_secondary_origins`, PUT, bulk PATCH, both delete
   paths, `source-origins` endpoint, `pcs.py`.
2. **Test script** `tools/test_secondary_origins.py` against a scratch copy of
   the dev DB: add/remove/replace; primary-as-secondary no-op; primary promotion
   deletes the secondary; cross-group add is skipped; single and bulk delete leave
   no orphan rows; a `PUT` without `secondary_origin_ids` leaves existing ones
   alone.
3. **Shared filtering + `originLabel`**, then the grid, binder and `/pcs/` modal
   display.
4. **Detail modal** "Also in" editor.
5. **Bulk edit** section.
6. **Card book** (if confirmed).
7. Browser check on dev (`npm run dev`): tag a set, then filter Hollow, Album →
   Hollow, Exclude Hollow, AND Dominate + Hollow, search "hollow", the binder
   tray, and the `/pcs/` modal.
8. `npm run build` **and** `npm run build:pcs`. Commit both `frontend_dist/` and
   `frontend_dist_pcs/`. No seed regen is needed, since nothing changes in
   the catalog or guest seed.
9. Docs: `collectcore_summary.md` (schema + endpoints), a CLAUDE.md reference
   row for this plan, session notes.

## Explicitly out of scope

- Market: comps, ship dates and age priors, lot analyzer, buy decisions, all of
  which stay primary.
- Trade captions, trade CSV, Mercari titles.
- WASM `/guest/` tier, catalog delta, guest seed.
- Mixing secondaries into the primary sort (decision 2).
- Secondaries set at create time (Inbox / Bulk Create / Batch Image).
