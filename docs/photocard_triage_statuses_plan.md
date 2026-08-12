# Photocard Triage Statuses — Design & Implementation Plan

**Status:** designed, not built
**Scope:** photocards only (admin tier). No `/pcs/` behavior changes.

## Goal

Make the admin photocard library express a deliberate collecting decision.
Today 9,314 of 10,024 cards (93%, measured in dev — see Pre-flight) carry a single
`wanted` copy row, because the 2026-04 migration and `BulkCreatePage` both stamp
Wanted on every card. "Wanted"
therefore means *"this card exists in my library"*, not *"I want this"*, and the
wanted list is unusable as a collecting tool.

Split that pile into an explicit triage decision, then hand-triage all ~10k cards
by member + source origin sweeps with some individual curation.

## Decisions

### Two new statuses (not one)

| Meaning | Status name | `status_code` | Badge letter |
|---|---|---|---|
| No decision made yet | **Undecided** | `undecided` | `U` |
| Actively decided against | **Not Wanted** | `not_wanted` | `N` |

One bucket would not work: without a terminal "no", every triage pass re-surfaces
cards already rejected, recreating the current noise one level down. Two states
also let the trade page distinguish *"I passed on this"* from *"I've never
evaluated this"* — different answers when a friend offers a card.

Post-triage, `Undecided` becomes the intake state for newly bulk-created sets
("new cards need triage"), so it keeps a permanent role.

### Why not reuse `catalog`

`catalog` stays exclusively a `/pcs/` word. On `/pcs/` it is **synthetic** —
[`pcs.py`](../backend/routers/pcs.py) injects a `copy_id: null` Catalog copy for
any catalog card the signed-in friend has not claimed. That is correct there:
materializing it would mean ~10,024 rows *per user*, backfilled on every
`commit-catalog` and publish, and cascade-deleted on catalog removal.

Admin is a single user whose copy rows already exist ~1:1 with cards (10,192 rows
/ 10,024 cards), so a real status row costs nothing. Same API contract, different
storage, no shared vocabulary to confuse. (`seed_builder.py` already writes real
Catalog copy rows into the guest seed, so "status as a real row" is an existing
representation here, not an invention.)

### Sort order — deliberate, not incidental

`TriStateFilterSection` renders only `defaultShown = 5` items before collapsing
([FilterSidebar.jsx:217-221](../frontend/src/components/library/FilterSidebar.jsx#L217-L221)).

The live admin sidebar currently shows exactly 5 ownership statuses — `Owned,
Wanted, Trade, Pending - Outgoing, Pending - Incoming` — because `Formerly Owned`,
`Borrowed`, and `Catalog` are toggled off for photocards via Admin → Status
Visibility (which inserts/deletes `xref_ownership_status_modules` rows,
[admin.py:421-432](../backend/routers/admin.py#L421-L432)). With exactly 5 items
`hasMore` is false, so there is no fold today.

Adding two statuses makes 7, which exceeds `defaultShown` and introduces a fold.
**The new statuses belong in that fold.** They are set-once-per-card decisions —
once a card is Not Wanted it is never touched again — whereas Owned / Wanted /
Trade / the pendings change repeatedly over a card's life. The frequently-mutated
statuses keep the visible slots.

So: **append at the end, no renumbering.**

| `status_code` | `sort_order` |
|---|---|
| `owned` | 1 |
| `wanted` | 2 |
| `trade` | 3 |
| `formerly_owned` | 4 *(hidden for photocards)* |
| `pending_outgoing` | 5 |
| `borrowed` | 6 *(hidden for photocards)* |
| `pending_incoming` | 7 |
| `catalog` | 8 *(hidden for photocards)* |
| **`undecided`** | **9** |
| **`not_wanted`** | **10** |

Resulting photocard sidebar: visible five stays exactly as today — `Owned, Wanted,
Trade, Pending - Outgoing, Pending - Incoming` — with the two new statuses behind
a `+2 more` button.

This touches no existing rows at all, so other modules are provably unaffected and
the migration loses a whole step.

### Two orthogonal dimensions in one column

`ownership_status_id` carries two different kinds of fact:

- **A standing decision about the card** — `undecided` / `wanted` / `not_wanted`.
  One per card, and it *persists independently of what copies are held*.
- **A possession fact about a copy** — `owned` / `trade` / `pending_*` /
  `formerly_owned` / `borrowed`. Zero or more per card.

The decision outlives the copies. A card can be `not_wanted` **and** carry a
`trade` copy: when the trade completes the trade row is deleted, and the
"I don't want this" record survives rather than being lost with it.

**Co-occurrence rules:**

| Combination | Allowed? |
|---|---|
| More than one of `undecided` / `wanted` / `not_wanted` | **No** — at most one decision per card |
| `wanted` + `owned` | **No** — already enforced by `_check_owned_wanted_conflict` |
| `wanted` + `trade` | **No** |
| `not_wanted` + `trade` | **Yes** — the motivating case |
| `not_wanted` / `undecided` + any other possession status | **Yes** |

> **Assumption to confirm:** the last row generalises from the stated rules — that a
> decision coexists freely with possession statuses, and only `wanted` conflicts
> (with `owned` and `trade`). If e.g. `undecided` + `trade` should also be
> forbidden, say so; it only changes the guard in Phase 3.

**There is no "sole copy row" invariant.** An earlier draft of this plan assumed
one; it is wrong and several sections below depend on it not being assumed.

## Phases

### Phase 1 — Schema & seed

- `backend/sql/schema.sql`: insert the two statuses with the new sort orders,
  and renumber the existing six. Follow the existing seed comment convention.
- `backend/db.py` (~L184-195): the fresh-DB seed cross-joins all statuses against
  all modules *except* `catalog`. Extend that exclusion to `undecided` and
  `not_wanted`, then add a targeted photocards-only xref insert mirroring the
  existing catalog block at L190-194.
- **Do not add these to any other module.** Photocards-only, same as `catalog`.

### Phase 2 — Migration script

New `backend/migrate_triage_statuses.py`, modeled on `migrate_catalog_fields.py`
(back up first, idempotent, safe to re-run):

```sql
-- statuses (appended; no existing row is modified)
INSERT OR IGNORE INTO lkup_ownership_statuses (status_code, status_name, sort_order)
VALUES ('undecided', 'Undecided', 9), ('not_wanted', 'Not Wanted', 10);

-- photocards-only visibility
INSERT OR IGNORE INTO xref_ownership_status_modules (ownership_status_id, collection_type_id)
SELECT s.ownership_status_id, c.collection_type_id
FROM lkup_ownership_statuses s, lkup_collection_types c
WHERE s.status_code IN ('undecided', 'not_wanted')
  AND c.collection_type_code = 'photocards';

-- reclassify every Wanted row to Undecided. Row-scoped, so any co-occurring
-- possession copy (trade, pending_*) on the same card is untouched by
-- construction — no card-level HAVING clause needed or wanted.
UPDATE tbl_photocard_copies
SET ownership_status_id =
      (SELECT ownership_status_id FROM lkup_ownership_statuses WHERE status_code = 'undecided')
WHERE ownership_status_id =
      (SELECT ownership_status_id FROM lkup_ownership_statuses WHERE status_code = 'wanted');
```

Expected: the solo-Wanted count from pre-flight (dev: 9,314), Wanted left at 0.

The xref insert is the same mechanism Admin → Status Visibility uses, so the two
statuses will appear there as normal toggles afterward and can be hidden again
without a code change.

**ID resolution:** do *not* hardcode the new ids in `constants.py`.
`OWNED_STATUS_ID = 1` / `WANTED_STATUS_ID = 2` only work because those were seeded
first; autoincrement will assign different ids in dev vs prod (dev's `catalog` is
already 1572). Resolve by `status_code` at runtime, mirroring the
`_resolve_collection_type_id` helper pattern already in `constants.py`.

### Phase 3 — Backend sweep

[`photocards.py:476-481`](../backend/routers/photocards.py#L476-L481) — the bulk
ownership update is item-scoped and rewrites *every* copy row on a card, bypassing
`_check_owned_wanted_conflict`. Two changes:

1. **Scope to triage statuses.** Sweepable: `undecided`, `wanted`, `not_wanted`.
   Immune: `owned`, `trade`, `pending_*`, `formerly_owned`, `borrowed`.
   ```sql
   UPDATE tbl_photocard_copies SET ownership_status_id = :oid
   WHERE item_id IN (:ids)
     AND ownership_status_id IN (:undecided, :wanted, :not_wanted)
   ```
   Being **row-scoped rather than card-scoped** is what makes this correct under
   co-occurrence: sweeping a `{not_wanted, trade}` card to Undecided rewrites only
   the decision row and leaves the trade copy intact. The current card-scoped
   `WHERE item_id = :item_id` would flatten both.

   Also extend `_check_owned_wanted_conflict` (or add a sibling) to enforce the
   co-occurrence table above: at most one of `undecided` / `wanted` / `not_wanted`
   per card, and `wanted` conflicting with `owned` and `trade`. Note the existing
   guard is bypassed entirely by the bulk path today.

2. **Collapse the per-item loop into one statement.** Measured against the real
   10,024-card library: per-item loop **1.60s**, equivalent set-based UPDATE
   **0.004s**. Not fatal, but it holds the SQLite write lock for the duration —
   same class of problem as the recent publish-sweep fix — and full-library sweeps
   are now routine. The inlined-literal `IN` clause is fine at this scale (tested
   at 10,024 ids / 55KB statement, instant).

Return the affected-row count so the UI can report what actually changed.

### Phase 4 — Frontend

- [`PhotocardGrid.jsx:51-73`](../frontend/src/components/photocard/PhotocardGrid.jsx#L51-L73)
  — add `Undecided: "U"` and `"Not Wanted": "N"` to `STATUS_LETTERS`, matching
  entries in `BADGE_LETTER_COLORS`, and append `U`, `N` to `OTHER_STATUS_ORDER`.
- [`app.css`](../frontend/src/styles/app.css) — add `--badge-undecided` and
  `--badge-not-wanted` to **both** palette blocks (L64-70 and L184-190). Suggested
  recessive values so non-collection states read as dim against the neon palette:
  `--badge-undecided: #9aa0a6`, `--badge-not-wanted: #6b5b5b`. Easily changed.
- [`primitives.css:246-249`](../frontend/src/styles/primitives.css#L246-L249) and
  [`Badge.jsx:1-6`](../frontend/src/components/primitives/Badge.jsx#L1-L6) — add the
  two tones if the triage states should render in `Badge` contexts too, otherwise
  they fall through to `neutral`.
- [`BulkCreatePage.jsx:126-129`](../frontend/src/pages/BulkCreatePage.jsx#L126-L129)
  — flip the hardcoded default from `wanted` to `undecided`, and update the
  comment. **Required**: without it every new bulk-created set re-pollutes Wanted
  and the cleanup decays.

### Phase 5 — Default filter

**The default must be a card-level predicate, not an ownership exclusion.**

The obvious implementation — defaulting `filters.ownership.exclude` to
`[undecided, not_wanted]` — is wrong under co-occurrence.
[`applySection`](../frontend/src/components/library/FilterSidebar.jsx#L56-L64)
applies `exclude` unconditionally and card-wide:

```js
if (exclude.length > 0 && vals.some((v) => exclude.includes(v))) return false;
```

A `{not_wanted, trade}` card has a `not_wanted` value among its copies, so it would
be **hidden from the default view** — removing active trade inventory from sight.
Exactly the card the co-occurrence rule exists to preserve. (Changing
`applySection` itself is not an option: it is shared by every filter section in
every module.)

Instead add a small card-level **Triage** filter section, following the existing
`imageStatus` pseudo-section precedent (synthetic values, not DB statuses):

| Item | Predicate | 
|---|---|
| **Tracked** | ≥1 copy whose status is neither `undecided` nor `not_wanted` |
| **Untracked** | no such copy — i.e. the triage queue |

Default on a fresh session: `include: ["tracked"]`, admin only.

This is the **same predicate as the header's `tracked` count** — one definition
serving both. It resolves the co-occurrence bug by construction (`{not_wanted,
trade}` is Tracked, so it stays visible), and to triage a specific decision you
combine sections: Triage = Untracked + Ownership include `Undecided`.

The existing `hadStoredFiltersRef` guard means the default only applies when no
per-session filter state was restored, so a triage session's filters persist and
the default won't fight the workflow.

Post-triage the default view is the real collection plus real wants, while
still showing anything you physically hold.

**Side benefit:** a dedicated Triage section also fixes the visibility problem the
old approach had. An ownership exclusion would have been near-invisible — the two
statuses sit behind `+2 more`, and a collapsed section gives no indication that its
hidden items are filtering
([FilterSidebar.jsx:235-243](../frontend/src/components/library/FilterSidebar.jsx#L235-L243));
the only cue is the `OR`/`AND` toggle appearing in the header
([L136-141](../frontend/src/components/library/FilterSidebar.jsx#L136-L141)). A
Triage section with `Tracked` lit up is self-evident, and switching to Untracked is
one click rather than expand-then-un-exclude.

Remaining trap: **after a bulk-create the new cards are Undecided and therefore
Untracked**, so they don't appear in the default view — "where did my 200 cards go?"

### Header counts (supersedes the earlier single hidden-count idea)

Turn the card count at
[L617-620](../frontend/src/pages/PhotocardLibraryPage.jsx#L617-L620) into a triage
progress readout — **on desktop only**:

```
desktop:   10,024 total  ·  710 tracked  ·  1,204 cards      [· 37 selected]
mobile:                                     1,204 cards      [· 37 selected]
```

| Number | Meaning | Source | Shown |
|---|---|---|---|
| **total** | every photocard in the library | `cards.length` | desktop |
| **tracked** | has ≥1 copy whose status is neither `undecided` nor `not_wanted` | derived from `cards` | desktop, admin only |
| **cards** | matches the current filters | `sortedCards.length` — rendered today | always |

All are client-side — the page already loads the full library into state and filters
in memory, so **no backend or endpoint change is needed**.

**Mobile stays byte-identical to today.** Major library management happens on
desktop, and the narrow mobile header shouldn't carry extra numbers. Keeping the
filtered count labelled `cards` (rather than renaming it `showing` on desktop) means
the two new numbers are a pure prefix — one `.desktop-only` wrapper, no
breakpoint-conditional wording, and the existing mobile string is untouched:

```jsx
<span style={styles.cardCount}>
  <span className="desktop-only">
    {cards.length} total{isAdmin ? ` · ${trackedCount} tracked` : ""} ·{" "}
  </span>
  {sortedCards.length} cards
  {selectMode && selectedIds.size > 0 ? ` · ${selectedIds.size} selected` : ""}
</span>
```

`.desktop-only` is an existing hardened utility — `display: none !important` below
the 768px breakpoint ([app.css:995-1001](../frontend/src/styles/app.css#L995-L1001)) —
so this branches in CSS and cannot affect the desktop layout or vice versa.

```js
// resolve by status_code, never by hardcoded id (see Phase 2)
const triageIds = useMemo(() => new Set(
  ownershipStatuses
    .filter((s) => s.status_code === "undecided" || s.status_code === "not_wanted")
    .map((s) => s.ownership_status_id)
), [ownershipStatuses]);

const trackedCount = useMemo(
  () => cards.filter((c) =>
    (c.copies || []).some((cp) => !triageIds.has(cp.ownership_status_id))
  ).length,
  [cards, triageIds]
);
```

Notes:

- **Gate `tracked` behind `isAdmin`.** `PhotocardLibraryPage` is shared with the
  `/pcs/` build, where `undecided` / `not_wanted` don't exist and every catalog card
  carries a synthetic Catalog copy — so `some()` would be true for everything and
  the number would read as 100% tracked. Render it admin-only.
- Under co-occurrence a `{not_wanted, trade}` card counts as **tracked** — you hold
  physical inventory, so it belongs in the tracked total and in the default view,
  even though the standing decision is "don't collect".
- This also covers the bulk-create trap **on desktop**: after a bulk-create the **total** jumps
  while the filtered count doesn't, surfacing a discrepancy that a bare filtered
  count hides. Mobile keeps no such cue — acceptable, since bulk-create is a desktop
  workflow.

Optional follow-up: after a successful bulk-create, link through to the library
pre-filtered to Undecided, which removes trap (1) at the source.

## Deliberately not doing

- **Nothing about the `catalog` xref row.** Catalog is already toggled off for
  photocards via Admin → Status Visibility in the live DB, so there is no dead
  option to clean up. Leave it alone. (Note that `/pcs/` would be unaffected either
  way — it has its own status endpoint that queries `lkup_ownership_statuses`
  directly without joining the xref.)
- **No changes to `/pcs/`**, including the import guard that skips `catalog` rows —
  still correct, different table (`pcs_card_copies`).
- **No new statuses on other modules** (per CLAUDE.md).

## Pre-flight: confirm the numbers against the target DB

**Every count in this doc came from the dev DB** (`c:/Dev/CollectCore/data/collectcore.db`).
That database has demonstrably diverged from the live one: dev has all 8 ownership
statuses enabled for photocards, the live sidebar shows 5. Status Visibility state
differs, so card/copy counts may differ too.

Before running the migration, re-check against the DB it will run on:

```sql
SELECT COUNT(*) FROM tbl_items WHERE collection_type_id = 1;                    -- dev: 10,024
SELECT os.status_code, COUNT(*) FROM tbl_photocard_copies pc
  JOIN lkup_ownership_statuses os USING(ownership_status_id) GROUP BY 1;        -- dev: wanted 9,314 / owned 690 / trade 157 / pending 31
SELECT COUNT(*) FROM (SELECT item_id FROM tbl_photocard_copies
  GROUP BY item_id HAVING COUNT(*) = 1
  AND MAX(ownership_status_id) = (SELECT ownership_status_id
    FROM lkup_ownership_statuses WHERE status_code='wanted'));                  -- solo-Wanted cards = rows the migration will touch
SELECT s.status_code FROM xref_ownership_status_modules x
  JOIN lkup_ownership_statuses s USING(ownership_status_id)
  WHERE x.collection_type_id = 1;                                              -- current photocard visibility set
```

The last query also tells you how many statuses the sidebar will show post-migration,
which is what determines whether the fold appears.

## Verification

1. `GET /ownership-statuses?collection_type_id=1` includes Undecided and Not Wanted
   at sort_order 9-10, listed last.
2. Another module (e.g. books) returns byte-identical results to before — no
   existing row was modified.
3. Sidebar Ownership section still shows `Owned, Wanted, Trade, Pending - Outgoing,
   Pending - Incoming` un-expanded, with a `+2 more` button revealing the new two.
4. Wanted count is 0; Undecided equals the solo-Wanted count measured in pre-flight;
   Owned/Trade/pending counts unchanged.
5. Sweep a member+source selection that deliberately includes an owned card →
   the owned card is untouched, response row-count reflects the skip.
6. The 84 cards with trade stacks still have their trade stacks.
7. **Co-occurrence:** set a card to Not Wanted while it has a Trade copy → both rows
   persist. Sweep that card to Undecided → only the decision row changes, the Trade
   copy survives. Delete the Trade copy → the Not Wanted record remains.
8. **Default view:** that `{not_wanted, trade}` card is still visible under the
   default Triage = Tracked filter.
7. Bulk-create a test set → new cards land in Undecided.

## Suggested execution order

Take a DB backup first. Then: Phase 1-2 (schema + migration) → Phase 3 (sweep
guard, **before any triage sweeps**) → Phase 4 → triage → Phase 5 last, so the
default filter doesn't hide the pile while you're working through it.
