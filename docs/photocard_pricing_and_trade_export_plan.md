# Photocard Pricing Tiers & Trade CSV Export — Design & Implementation Plan

**Status:** **built** 2026-08-17 — all six phases. Verification 1–15 below pass
against the dev DB; see the session notes entry for the run.
**Scope:** photocards only (admin tier). No `/pcs/` behavior changes, no new
ownership statuses.

Built as designed, with two notes:

- **Tier `POST` derives `tier_code` from the name** (`"Premium Chase"` →
  `premium_chase`, de-duplicated with a numeric suffix). The plan required
  runtime resolution by code but never said where a new tier's code comes
  from, and the Admin panel deliberately shows only name / price / sort /
  active.
- **The CSV's `notes` column draws from *all* copies, not just the trade
  ones.** The count in `copies` is trade-only as specified, but the
  client-side search that drives the selection matches any copy's notes, so
  scoping notes to trade copies would drop the very note that caused the match
  — the silent loss the "join with ` | `" rule exists to prevent.

## Goal

Two connected needs, both driven by starting to sell cards on Mercari:

1. **Price cards without pricing them one at a time.** Assign a price *tier* to
   many cards in one bulk sweep; override an individual card with a custom
   amount when it doesn't fit a tier.
2. **Get the trade shelf out of the app as a paste-ready worksheet.** A CSV with
   a pre-composed listing title and price per card, so listing on Mercari is
   copy/paste rather than retyping and concatenating fields by hand.

Measured against the dev library (10,024 cards): **89 distinct cards carry a
`trade` copy**, across **157 copy rows** — 34 of those cards are stacks of 2+.

## Decisions

### Tier and custom price are mutually exclusive, not layered

The obvious model is "override wins": store both, prefer the override. Rejected.
The requirement is that editing a card's price *removes* it from its tier, so a
later sweep over that tier doesn't silently reset it.

So a card is in exactly one of three states:

| State | `price_tier_id` | `price_cents` |
|---|---|---|
| Unpriced | — no row at all — | |
| Tiered | set | NULL |
| Custom | NULL | set |

This is enforceable in the schema rather than in application code:

```sql
CHECK ((price_tier_id IS NULL) <> (price_cents IS NULL))
```

Effective price = `price_cents` when custom, else the tier's `price_cents`.
Never denormalized — editing tier 3's amount reprices every tier-3 card on the
next read, and leaves custom-priced cards alone. That is the whole point of
tiers, and the reason the effective price must stay derived.

### Pricing lives in its own table, not on `tbl_photocard_details`

`tbl_photocard_details` is the natural-looking home and is the wrong one. Two
guest-facing paths copy that table by reflection, not by an explicit column list:

- [`catalog.py:185`](../backend/routers/catalog.py#L185) — `SELECT * FROM tbl_photocard_details`
- [`seed_builder.py:133-140`](../backend/seed_builder.py#L133-L140) — PRAGMA-driven column copy

Any column added there ships to the catalog delta endpoint and the guest seed
automatically, with nothing in the diff to warn you. A separate
`tbl_photocard_pricing` is invisible to both **by construction** rather than by
remembering to maintain a denylist.

It also keeps a commercial concern out of the descriptive detail table, and the
row is optional — unpriced cards cost zero rows.

### Card-level, not copy-level

One tier per card, applying to every copy. Copy-level pricing is not built:
the 34 stacked trade cards are the same card in the same condition, and
`tbl_photocard_copies.notes` already exists for anything copy-specific.

This falls out of the existing bulk endpoint for free — [`bulk_update_photocards`](../backend/routers/photocards.py#L521)
already takes `item_ids` and has no copy-level path for card-level fields.

### The export is driven by the client's selection

The notes search is **client-side** ([`photocardFiltering.js:194-205`](../frontend/src/components/photocard/photocardFiltering.js#L194-L205)),
and it searches copy notes as well as card notes:

```js
c.notes?.toLowerCase().includes(q) ||
c.copies?.some((cp) => cp.notes?.toLowerCase().includes(q)) || ...
```

A server-side "SELECT all trade copies" endpoint would be blind to it. Since the
intended workflow is *search `for sale` → export what I see*, the client must
post the ids it currently has selected/filtered and the backend must only format.

This is the same shape as the existing trade-page flow
([`TradeCreateModal`](../frontend/src/components/photocard/TradeCreateModal.jsx) →
`POST /trade` with `item_ids`), so it's an established pattern here, and it means
**zero new filtering logic on the backend**.

### One row per card

Each Mercari listing is one physical card and only one copy gets listed at a
time, so the export deduplicates to distinct cards: **89 rows, not 157**.

A `copies` count column is carried so a stack is visible as something to relist,
without the card appearing more than once.

Where a stack's copies carry different notes, distinct non-empty values are
joined with ` | ` so nothing is dropped silently. Today this is a no-op —
**all 89 trade cards have zero copy notes and zero card notes** — but it starts
mattering as soon as notes are used to mark cards for sale.

### Title generation: the "Official Photocard" literal must be conditional

**1,444 `version` values in the library already contain the word "Photocard"**
("Photocard (Jewel Case Version)", "Film Photocard Set (POB)", "Trading Unit
Photocard (POB)"). A template that unconditionally appends the phrase produces
visible redundancy and blows the title length budget:

```
Stray Kids Hyunjin Official Photocard - Rock Star Photocard (Postcard Version POB)   82
```

Across the 89 trade cards that naive template measures **44–88 chars, median 61,
2 over 80**. **Mercari caps listing titles at 80 characters** (confirmed) — that
is the constraint the rule is designed against.

Branching on whether `version` already says "photocard" fixes both problems:

| Condition | Template |
|---|---|
| `version` contains "photocard" | `{group} {member} {source} Official {version}` |
| otherwise | `{group} {member} {source} {version} Official Photocard` |

Measured across all 89 trade cards: **42–74 chars, median 58, zero over 80.**

```
Stray Kids Han ATE Lips Official Photocard                                   42
Stray Kids Changbin Oddinary Frankenstein Version Official Photocard         68
Stray Kids Seungmin Oddinary Official Photocard (Jewel Case Version)         68
Stray Kids Hyunjin Seungmin Oddinary Trading Unit Official Photocard (POB)   74
```

Multi-member cards (12 of the 89) join member names with a **space**, not a
comma — Mercari's search is token-based and "Hyunjin Seungmin" reads as two
keywords. Note this differs from `_build_caption` in
[`trades.py:36-44`](../backend/routers/trades.py#L36-L44), which joins with
`", "` for human display. Different consumers, deliberately different joins.

### Templates are settings, not code

Both templates live in `tbl_app_settings` and are edited through the existing
GET/PUT endpoints at [`export.py:17-37`](../backend/routers/export.py#L17-L37).
Listing-title conventions get tuned constantly once you are actually selling;
this avoids a redeploy per tweak, and needs no new table.

Two keys rather than one template with conditional-token syntax — the branch
above is a rule, and encoding it as a placeholder grammar would be more
machinery than the problem deserves:

| Key | Default |
|---|---|
| `photocard_title_template` | `{group} {member} {source} {version} Official Photocard` |
| `photocard_title_template_pc` | `{group} {member} {source} Official {version}` |
| `photocard_description_template` | `{title}. Ships in a toploader and sleeve inside a bubble mailer.` |

Unknown placeholders render empty rather than raising; a missing `source` or
`version` collapses without leaving double spaces.

## Schema

```sql
CREATE TABLE IF NOT EXISTS lkup_photocard_price_tiers (
    tier_id     INTEGER PRIMARY KEY AUTOINCREMENT,
    tier_code   TEXT NOT NULL UNIQUE,
    tier_name   TEXT NOT NULL,
    price_cents INTEGER NOT NULL,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    is_active   INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS tbl_photocard_pricing (
    item_id       INTEGER PRIMARY KEY,
    price_tier_id INTEGER,
    price_cents   INTEGER,
    updated_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CHECK ((price_tier_id IS NULL) <> (price_cents IS NULL)),
    FOREIGN KEY (item_id) REFERENCES tbl_items(item_id),
    FOREIGN KEY (price_tier_id) REFERENCES lkup_photocard_price_tiers(tier_id)
);

CREATE INDEX IF NOT EXISTS idx_photocard_pricing_tier
    ON tbl_photocard_pricing (price_tier_id);
```

Seed tiers (mirroring the existing lookup-seed comment convention):

| `tier_code` | `tier_name` | `price_cents` | `sort_order` |
|---|---|---|---|
| `t1` | Tier 1 | 400 | 1 |
| `t2` | Tier 2 | 600 | 2 |
| `t3` | Tier 3 | 900 | 3 |
| `t4` | Tier 4 | 1200 | 4 |

**Money is INTEGER cents throughout.** The parked listing-tracker tables used
`REAL`; do not inherit that.

**The `FOREIGN KEY` clauses are documentation.** Per CLAUDE.md, SQLite FK
cascades never fire here — `PRAGMA foreign_keys = ON` is only issued on
`init_db`'s connection. Deletes are handled explicitly in Phase 4.

## Phases

### Phase 1 — Schema & migration

- `backend/sql/schema.sql`: both tables + the four seed rows, following the
  existing `INSERT OR IGNORE` seed convention.
- New `backend/migrate_photocard_pricing.py`, modeled on
  `migrate_catalog_fields.py`: back up first, `CREATE TABLE IF NOT EXISTS` +
  `INSERT OR IGNORE`, idempotent and safe to re-run. Purely additive — it
  creates empty tables and touches no existing row.
- Resolve tier ids by `tier_code` at runtime, never by hardcoded integer. Dev
  and prod autoincrement independently (the triage plan hit exactly this — dev's
  `catalog` status is id 1572).

### Phase 2 — Backend read path

Both the list and single-card endpoints go through one shared query, so this is
a single edit that serves everything downstream:
[`_PHOTOCARD_SELECT`](../backend/routers/photocards.py#L70),
[`_PHOTOCARD_GROUP_BY`](../backend/routers/photocards.py#L108), and
[`_photocard_row_to_dict`](../backend/routers/photocards.py#L21).

```sql
LEFT JOIN tbl_photocard_pricing pr ON pr.item_id = i.item_id
LEFT JOIN lkup_photocard_price_tiers pt ON pt.tier_id = pr.price_tier_id
```

Both joins are `LEFT` — an unpriced card has no pricing row, and the same
never-inner-join discipline CLAUDE.md mandates for `source_origin_id` applies.

`_photocard_row_to_dict` indexes positionally (`row[0]`…`row[12]`), so **append
the new columns at the end** (13–15) rather than inserting — no renumbering, and
no risk to the twelve existing mappings. Add the three new selected columns to
`_PHOTOCARD_GROUP_BY` as well; the query aggregates (`MAX(CASE WHEN ...)` for
attachments) and will otherwise fail.

Emit three derived fields per card:

| Field | Value |
|---|---|
| `price_tier_id` | `pr.price_tier_id` (null when custom or unpriced) |
| `price_cents` | effective — `pr.price_cents` when custom, else `pt.price_cents` |
| `price_source` | `"custom"` \| `"tier"` \| `null` |

`price_source` exists so the UI can render "Tier 3 · $9.00" vs "$9.00 (custom)"
without re-deriving the state from two nullable fields.

This SELECT is admin-side only. `/pcs/` has its own query
([`pcs.py:109`](../backend/routers/pcs.py#L109)) and is untouched — prices do not
reach friends.

### Phase 3 — Tier CRUD

`GET` / `POST` / `PUT` / `DELETE` for tiers, alongside the existing dynamic
lookup creation precedent at
[`create_source_origin`](../backend/routers/photocards.py#L246).

**`PUT` covers `price_cents`, `tier_name` and `sort_order`** — editing a tier's
amount is a first-class, routine operation, not a one-time seed. Because the
effective price is derived and never denormalized (see Decisions), changing a
tier's amount reprices every card on that tier on the next read, with no sweep
and no migration. Adding tiers beyond the seeded four is the same `POST`.

**Delete is guarded**: if any `tbl_photocard_pricing` row references the tier,
return 409 rather than orphaning cards (FK cascades do not fire, so an
unguarded delete would leave dangling `price_tier_id` values that resolve to a
null price). Retiring a tier is `is_active = 0`, matching the other lookup
tables.

### Phase 4 — Write paths

**Bulk tier assignment.** Add `price_tier_id: Optional[int]` to
[`BulkUpdateFields`](../backend/schemas/photocards.py#L32) and handle it in
[`bulk_update_photocards`](../backend/routers/photocards.py#L521):

```sql
INSERT INTO tbl_photocard_pricing (item_id, price_tier_id, price_cents, updated_at)
VALUES (:item_id, :tier_id, NULL, CURRENT_TIMESTAMP)
ON CONFLICT(item_id) DO UPDATE SET
    price_tier_id = excluded.price_tier_id,
    price_cents   = NULL,                 -- assigning a tier clears any custom price
    updated_at    = CURRENT_TIMESTAMP
```

Count how many rows had a non-null `price_cents` before the write and return it:

```python
response["pricing"] = {"updated": n, "replaced_custom": m}
```

This mirrors the existing `ownership_result` sub-object at
[L613-616](../backend/routers/photocards.py#L613). It matters because
re-sweeping a selection to a tier **will** wipe a custom price set on one of
those cards — the intended semantics, but a silent loss otherwise. The UI
reports "42 cards set to Tier 3 (3 custom prices replaced)".

Sentinel for *unpricing* in bulk: `price_tier_id = 0` deletes the pricing row,
matching the `source_origin_id > 0` sentinel convention already used at
[L624](../backend/routers/photocards.py#L624).

**Single-card custom price.** A dedicated `PUT /photocards/{item_id}/price`
taking `{price_cents}` (or `null` to unprice), writing `price_tier_id = NULL`.
Kept off `PhotocardUpdate` because the tier-clearing side effect is a distinct
operation, not a field assignment, and the detail modal saves it independently
of the rest of the form.

**Delete cleanup — required.** Add to the explicit cleanup block in
[`bulk_delete_photocards:696-700`](../backend/routers/photocards.py#L696) and to
the single-card `delete_photocard` path:

```sql
DELETE FROM tbl_photocard_pricing WHERE item_id = :id
```

Without this, deleted cards leave orphaned pricing rows that a later `item_id`
reuse would silently inherit.

### Phase 5 — Frontend

- [`PhotocardBulkEdit.jsx`](../frontend/src/components/photocard/PhotocardBulkEdit.jsx)
  — a 7th field following the existing `update<Field>` checkbox + value pattern
  (Ownership, Category, Version, Members, Source Origin, Card Type → **Price
  Tier**). One `updatePriceTier` boolean, one `priceTierId` select, one more key
  in the `fields` object passed to `bulkUpdatePhotocards`. Surface the
  `replaced_custom` count in the result message.
- [`PhotocardDetailModal.jsx`](../frontend/src/components/photocard/PhotocardDetailModal.jsx)
  — display the effective amount with its source ("Tier 3 · $9.00" / "$9.00
  custom" / "—"), editable inline. Saving a value calls the price endpoint and
  flips the card to custom.
- [`api.js`](../frontend/src/api.js) — `fetchPriceTiers`, `updatePhotocardPrice`,
  and the export call, following the existing `handleJsonResponse` helpers.
- **Price Tiers editor** on [`AdminPage.jsx`](../frontend/src/pages/AdminPage.jsx),
  alongside the other lookup administration. A compact row per tier — name,
  dollar amount, sort order, active toggle — with the amount directly editable
  and an inline card count per tier ("Tier 3 · $9.00 · 214 cards"). Add and
  remove rows from the same panel.

  Because a tier edit silently reprices every card on it, the save confirms with
  the count: *"Change Tier 3 to $10.00? This reprices 214 cards."* The count is
  the same `GROUP BY price_tier_id` that feeds the inline display, so it costs
  nothing extra. This is the one place in the feature where a small edit has
  library-wide reach, and it should say so before committing.

  Deactivating (`is_active = 0`) is the safe alternative to deleting a tier that
  is in use; the editor surfaces that rather than presenting a delete that 409s.

### Phase 6 — Trade CSV export

`POST /export/photocard-trades.csv` in [`export.py`](../backend/routers/export.py)
— which currently holds only the settings endpoints and a comment noting the
retired PDF export, so this restores the router to its name. Body is
`{item_ids: [...]}`; response is `text/csv` via `StreamingResponse`, the pattern
already used at [`admin.py:145`](../backend/routers/admin.py#L145).

Rows are the distinct cards among `item_ids` that have at least one `trade`
copy, resolved by `status_code` at runtime (never a hardcoded id).

**Columns:**

```
item_id · title · price · group · member · source_origin · version · special · copies · notes · description
```

`title` and `price` lead because they are the two pasted most often.

- `price` is a bare decimal (`9.00`) with no currency symbol, so it pastes
  straight into Mercari's price field. Unpriced cards export **blank** rather
  than being excluded — the CSV then doubles as a "what still needs pricing"
  worklist.
- `member` joins with a space (search keywords), matching the title rule.
- `notes` joins distinct non-empty card + copy notes with ` | `.
- `copies` is the count of `trade` copies for that card.

**Practicalities:**

- Write with `utf-8-sig`. Excel on Windows mangles the encoding otherwise;
  [`migrate_goodreads.py:607`](../backend/migrate_goodreads.py#L607) already
  reads with it for the same reason.
- Use `csv.writer`, not manual joining — titles contain commas, colons and
  parens ("Cle: Levanter", "Photocard (Jewel Case Version)").
- A `POST` returning a file cannot be triggered by a plain `<a href>`; the
  library button must `fetch` → `blob()` → `URL.createObjectURL` → synthetic
  click, then revoke the object URL.

**Entry point:** a button in the photocard library select-mode toolbar
("Export CSV"), posting the selected ids — or the full filtered set when
nothing is explicitly selected.

## Deliberately not doing

- **No new ownership status and no for-sale flag.** The existing `trade` status
  plus a note carries it; the notes search already covers copy notes, verified
  above. This avoids putting a third orthogonal dimension into
  `ownership_status_id` — the conflation that the triage plan's Phase 5 exists
  to work around.
- **No tier filter section and no grid badge.** Price is a detail-modal fact.
- **No sales history.** Mercari is the system of record for what actually sold.
- **No per-copy pricing**, no buy/sell price split, no currency handling, no fee
  profiles, and nothing that fetches a listing page. Those are the listing
  tracker ([`listing_tracker_design_plan_v3.md`](listing_tracker_design_plan_v3.md)),
  which stays unbuilt and is not a dependency of this.
- **No `/pcs/`, `/guest/`, or catalog changes.** Prices are admin-only, which the
  side-table decision enforces structurally.
- **No pricing on other modules.**

## Pre-flight

Numbers in this doc were measured against the dev DB
(`c:/Dev/CollectCore/data/collectcore.db`), which has demonstrably diverged from
prod. Re-check before building against a different database:

```sql
-- trade cards / copies / stacks
SELECT COUNT(DISTINCT i.item_id), COUNT(*)
FROM tbl_items i
JOIN tbl_photocard_copies pc ON pc.item_id = i.item_id
JOIN lkup_ownership_statuses os ON os.ownership_status_id = pc.ownership_status_id
WHERE os.status_code = 'trade';                          -- dev: 89 cards / 157 copies

-- how many versions already contain "Photocard" (drives the title rule)
SELECT COUNT(*) FROM tbl_photocard_details
WHERE LOWER(version) LIKE '%photocard%';                 -- dev: 1,444
```

## Verification

1. `CHECK` holds: a direct `INSERT` setting both `price_tier_id` and
   `price_cents`, or neither, is rejected by SQLite.
2. Bulk-assign Tier 3 to a selection → all show $9.00 in the detail modal with
   source `tier`.
3. Edit one of those cards to a custom $15 → its `price_tier_id` is NULL,
   `price_source` is `custom`.
4. Change Tier 3's amount to $10 in Admin → Price Tiers → the confirmation
   reports the correct card count; on save every tiered card re-reads at $10
   with no sweep, and the custom $15 card is unchanged.
5. Add a fifth tier from the same panel and assign cards to it.
6. Re-sweep that same selection to Tier 3 → the custom card returns to $9.00 and
   the response reports `replaced_custom: 1`.
7. Delete a tier that is in use → 409, no rows orphaned. Set `is_active = 0`
   instead → it disappears from the bulk-edit dropdown, existing cards keep
   resolving.
8. Delete a priced card → no row remains in `tbl_photocard_pricing`.
9. `GET /catalog/...` and the guest seed contain **no** price fields; regenerate
   the seed and diff the table list.
10. Export with a card whose `version` contains "Photocard" → title reads
    `... Official Photocard (Jewel Case Version)`, not `... Official Photocard -
    ... Photocard ...`.
11. No exported title exceeds 80 characters across the full trade set.
12. Search notes for `for sale`, then export → only the matching cards appear,
    confirming the client drives the selection.
13. Open the CSV in Excel on Windows → member and album names render correctly
    (BOM), and titles containing commas stay in one cell.
14. A card with 3 trade copies appears **once**, with `copies = 3`.
15. An unpriced trade card exports with a blank `price` cell rather than being
    dropped.

## Suggested execution order

Back up the DB first. Then Phase 1 → 2 (schema + read path, verify prices
surface as null everywhere) → 3 → 4 → 5 (pricing usable end to end; price the
89 trade cards) → 6 last, so the CSV is exercised against real prices rather
than a shelf of blanks.
