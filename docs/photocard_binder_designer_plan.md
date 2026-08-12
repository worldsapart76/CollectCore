# Binder Designer — Design & Implementation Notes

**Status:** built (2026-08-12). Ships to production, admin tier.
**Scope:** photocards, admin only. No `/pcs/` or `/guest/` behavior changes.

> Originally built dev-gated; un-gated the same day so binders track the real
> collection rather than a stale dev copy, and so the page can be used on a
> phone while filling binders physically.

## Goal

Plan how a physical photocard binder gets filled, on screen, before touching
plastic. Create a named binder, pick a pocket layout, add/remove pages, and drag
cards from a filtered tray into pockets. Doubles as a want-list generator: a
card you place but don't own can be swept to Wanted at save time.

## Where it runs

Admin tier only — `adminOnly: true` on the nav link, and `/binders` is not on the
Cloudflare Access bypass list or the `PCS_ADMIN_GATE` exempt prefixes, so the
endpoints require an admin identity. The page is route-split (`lazy()`) because
most sessions never open it.

Binders live in whichever database the app is talking to, so production binders
track the real collection. The three tables are created by `schema.sql` on
startup — additive and idempotent, nothing to run by hand.

## Decisions

### SPA route is `/binder-designer`, API is `/binders`

Not a cosmetic split. `vite.config.js` proxies to the backend by **path
prefix**, so a SPA route at `/binders` would collide with `GET /binders` (the
list endpoint) — two GETs on one path, and the dev proxy has no way to tell a
page load from a `fetch`. Different prefixes remove the ambiguity entirely.
`/binders` is registered in `PROXY_PATHS`; `/binder-designer` is not, so Vite
serves `index.html` for it.

### Layout is fixed per binder

`layout_code` reads **across × down** (columns × rows):

| Code | Across | Down | Pockets |
|---|---|---|---|
| `2x2` | 2 | 2 | 4 |
| `3x2` | 3 | 2 | 6 |
| `3x3` | 3 | 3 | 9 |
| `4x3` | 4 | 3 | 12 |

Slots are row-major, 0-based: `slot_index = row * cols + col`.

The 6- and 12-pocket layouts were first written transposed (`2x3`, `3x4`).
`db.py` rewrites stored codes on startup — idempotent, and it logs what it
touched. `normalizeLayoutCode()` in `binderLayout.js` maps the old codes
defensively so a page loaded against an un-migrated DB still renders. **Note the
rewrite transposes the sheet**, so a card already placed in one of those binders
lands in a different pocket; it only ever ran against empty rows.

Changing a binder's layout is rejected (400) while it holds cards. A different
pocket count has nowhere to put them, and silently re-flowing a hand-arranged
layout is worse than refusing.

### A card lives in one binder only

Enforced by `UNIQUE (item_id)` on `tbl_binder_slots` — across the whole table,
not per binder. A physical card can only be in one pocket. The tray subtracts
both this binder's staged placements and every other binder's saved ones, so a
card held elsewhere simply isn't offered.

`PUT /binders/{id}/pages` returns **409** with the conflicting `item_id`s and
their binder names if a save would place a card another binder holds. Only
reachable from a stale tab; the UNIQUE index is the backstop.

### Spread view is a true open binder

Spread `s` of a P-sheet binder (there are P+1 spreads):

| Spread | Left | Right |
|---|---|---|
| `0` | inside front cover | sheet 0 **fronts** |
| `1 … P-1` | sheet `s-1` **backs**, mirrored | sheet `s` **fronts** |
| `P` | sheet `P-1` **backs**, mirrored | inside back cover |

Flipping a sheet reverses columns but not rows, so the back of the card at
`(row, col)` shows at `(row, cols-1-col)` — `mirrorSlot()` in
[binderLayout.js](../frontend/src/components/binder/binderLayout.js). The
function is its own inverse. On a 3-wide sheet the middle column maps to itself,
so slot 7 stays at 7 while 0 ↔ 2.

**The left page is read-only.** It is the reverse of a sheet you edit from its
own front; accepting drops there would mean two coordinate systems for one
pocket. Clicking its label jumps to that sheet's own spread.

Spread is desktop-only — two sheets side by side don't fit a phone, so
`effectiveViewMode` forces `page` below 768px.

### Sheets are measured, not sized from presets

An earlier S/M/L toggle is gone. A `ResizeObserver` on the sheet area feeds
`fitPocketWidth()`, which returns the largest pocket width that fits the
container on **both** axes given the layout and how many sheets are on screen.
Everything that consumes space — sheet padding and border, slot gap, the sheet
label, the spread gap, canvas padding — is a named constant in `binderLayout.js`,
so the measurement and the rendering read from one source and can't drift.

The sheet area is `overflow: hidden` on purpose: a scrollbar there would mean the
measurement was wrong, so it fails loudly rather than quietly scrolling.

### The available tray is derived, not stored

```js
available = sortPhotocards(applyPhotocardFilters(cards, …))
              .filter(c => !placedHere.has(c.item_id) && !placedElsewhere.has(c.item_id))
```

This is what makes **"a card removed from a pocket returns to its sort position,
not the bottom"** true by construction — there is no list to append to. It also
means the tray and the library agree on sort order, which is why the filter/sort
logic was extracted to a shared module rather than reimplemented.

### Save is a full replace

`PUT /binders/{id}/pages` wipes and rewrites the binder's pages and slots in one
transaction. The editor stages everything client-side (the Batch Images model —
nothing hits the DB until Save), so at save time the client holds the
authoritative structure; reconciling add/move/remove deltas would be more code
for no benefit at a few hundred slots.

### FK cascades are decorative — clean up explicitly

`PRAGMA foreign_keys = ON` is issued only on `init_db`'s own connection
([db.py](../backend/db.py)); request sessions never enable it and SQLAlchemy's
sqlite dialect leaves it off. The `FOREIGN KEY` clauses in the schema are
documentation. So:

- Deleting a binder explicitly deletes its pages and slots.
- **Deleting a photocard explicitly frees its slot** —
  `_delete_binder_slots_for_items` in
  [photocards.py](../backend/routers/photocards.py), called from both
  `delete_photocard` and `bulk_delete_photocards`, guarded by a `sqlite_master`
  existence check so a DB without the table is unaffected. Without this, a
  deleted card's slot row would block that `item_id` forever via the UNIQUE
  constraint.
- Belt-and-braces: `GET /binders/{id}` inner-joins `tbl_items`, so a stale slot
  can never render a ghost card.

### The Wanted sweep

Offered after a successful save, never automatic — designing a card in is
planning, not a decision to chase it.

**Eligible:** placed cards with no copy in `owned` / `wanted` / `trade`. `trade`
is excluded because `wanted` cannot co-exist with it (see
[photocard_triage_statuses_plan.md](photocard_triage_statuses_plan.md)
co-occurrence table) — offering it would be a guaranteed skip.

Two paths, because `PATCH /photocards/bulk` only rewrites copy rows that already
hold a *decision* status:

| Card has | Action |
|---|---|
| a decision row (`undecided` / `not_wanted`) | one `PATCH /photocards/bulk` — row-scoped, possession copies untouched |
| no decision row (e.g. only `pending_incoming`) | `POST /photocards/{id}/copies` per card |

Without the second path those cards would match zero rows and be skipped
silently. `wanted`'s status id is resolved by `status_code` at runtime, never
hardcoded — ids are DB-assigned and differ between environments.

## Schema

Three tables in [schema.sql](../backend/sql/schema.sql), after `tbl_trades`:

- `tbl_binders` — `binder_id`, `binder_name`, `layout_code`, `notes`, timestamps
- `tbl_binder_pages` — `page_id`, `binder_id`, `page_index`, `UNIQUE(binder_id, page_index)`
- `tbl_binder_slots` — `slot_id`, `page_id`, `slot_index`, `item_id`,
  `UNIQUE(page_id, slot_index)`, `UNIQUE(item_id)`

## Endpoints — `backend/routers/binders.py`

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/binders` | List with `page_count` + `placed_count` |
| `POST` | `/binders` | Create; seeds N empty pages |
| `GET` | `/binders/placements` | Every placed card → its binder. Declared **before** `/{binder_id}` |
| `GET` | `/binders/{id}` | Full structure |
| `PATCH` | `/binders/{id}` | Rename / notes / layout (empty binders only) |
| `DELETE` | `/binders/{id}` | Binder + pages + slots |
| `PUT` | `/binders/{id}/pages` | Full-replace save |

## Frontend

| File | Role |
|---|---|
| `pages/BinderDesignerPage.jsx` | Page: binder picker, staging state, save, sweep |
| `components/binder/BinderSheet.jsx` | One sheet (front or mirrored back) + `BinderCover` |
| `components/binder/BinderSlot.jsx` | One pocket — drop target, drag source, ✕ |
| `components/binder/CardTray.jsx` | Available cards, 100 at a time |
| `components/binder/BinderManageModal.jsx` | Create / rename / delete |
| `components/binder/WantedSweepModal.jsx` | Post-save ownership sweep |
| `components/binder/binderLayout.js` | `LAYOUTS`, `pocketCount`, `mirrorSlot` |
| `binderPageState.js` | View state across navigation; last binder in localStorage |

**Extracted for reuse** (pure moves, no behavior change):

- `components/photocard/cardBadges.js` — `STATUS_LETTERS`,
  `BADGE_LETTER_COLORS`, `getCopyBadges`, previously private to `PhotocardGrid`.
- `components/photocard/photocardFiltering.js` — `DEFAULT_FILTERS`,
  `SORT_OPTIONS`, `applyPhotocardFilters`, `sortPhotocards`, the
  `deriveFilter*` helpers, previously inline in `PhotocardLibraryPage`.

### Two ways to move a card

HTML5 drag-and-drop doesn't fire on touch at all, so tapping is the whole
editing model on a phone — and it's easier on a trackpad too. Both routes call
the same two functions (`placeFromTray` / `moveSlot`):

| Gesture | Effect |
|---|---|
| drag tray card → pocket | place |
| drag pocket → pocket | move; **swaps** if the target is occupied |
| tap tray card, tap pocket | place |
| tap filled pocket | picks that card up (outlined); tap it again to put it down |
| tap a second pocket while holding | move / swap |

`armed` holds what's picked up — `{kind:'tray'}` or `{kind:'slot'}` — and is the
only state the two gestures share.

### Phone layout

Branches at 768px, desktop untouched:

- forced to single-page view (spread needs two sheets' width)
- the tray becomes a horizontal scrolling strip under the sheet instead of a
  full-height column
- filters use the existing off-canvas drawer — `FilterSidebarShell` already
  renders `position: fixed` below the breakpoint and wires itself to the TopNav
  filter icon, so nothing extra was needed
- the page bar keeps prev/next/backs/+page; insert and delete are desktop-only,
  so the bar stays one row

### Deliberate differences from the library grid

- **Stable image URLs.** `PhotocardGrid.resolveCardSrc` appends
  `?v=${Date.now()}`, which changes `src` on every render. Binder slots
  re-render on every dragover, so the designer uses a `cacheBust` value computed
  once per card load and passed down.
- **Broken images degrade quietly.** Some cards reference an R2 image that isn't
  there (never published, or removed). `onError` falls back to the same muted
  placeholder an image-less card gets, rather than a broken-image box with alt
  text spilling out of the pocket.

## Known gaps / deliberately not doing

- **No page reordering.** Add, insert-after, and delete only. Dragging whole
  sheets interacts with spread pairing and wasn't asked for.
- **No per-page layouts.** Fixed per binder, by decision.
- **No virtualization** in the tray (project-wide shortcut) — 100 at a time with
  a Show-more button instead.
- **No `/pcs/` exposure.** Binders are an admin planning tool.
- **No sheet zoom.** Sheets always fill the space; on a phone the width is the
  binding constraint, so a 12-pocket page leaves empty room above and below.
  Cropping columns or scrolling would both be worse.

## Verification performed (2026-08-12)

Backend, via curl against `:8001`: create / list / get / patch / delete, slot
range validation, duplicate-item rejection, non-photocard rejection,
cross-binder 409, layout-change guard on a non-empty binder.

Frontend, driven through the Chrome DevTools Protocol against `npm run dev`
(18 checks + 10 checks, all passing):

- initial load, tray excluding placed cards (10,021 of 10,024)
- drag tray → pocket; drag pocket → empty pocket; drag pocket → occupied pocket
  **swaps** rather than evicting
- click-to-arm placement
- ✕ removes, card returns to the tray **in sort order**
- spread 1 = cover + sheet 1; spread 2 mirrors sheet 1's backs
  (slots 0,5,7 → displayed 2,3,7) and is read-only
- save reports what landed; dirty flag clears
- no sweep offered when every placed card is Owned
- sweep offered, applied, and reflected in the DB for an Undecided card
  (then restored to Undecided)

Deletion: a photocard deleted via both `DELETE /photocards/{id}` and
`POST /photocards/bulk-delete` frees its slot; zero orphan slot rows afterwards.

Regression: the photocard library renders identically after the badge and
filter extractions (counts, filters, badges, sort all intact).

One bug found and fixed during testing: a `binder.lastBinderId` in localStorage
naming a deleted binder fired `getBinder` before the binder list had validated
it, and the resulting full-page error was sticky even after the fallback
selected a valid binder. The load effect is now gated on the initial fetch
completing, and a failed binder load is non-fatal.

### Round 2 — layouts, sizing, phone (same day, 16 + 6 checks)

- 12-pocket page renders 4 across × 3 down; migration rewrote the two stored
  legacy codes and logged both.
- At 1600×1000 a 12-pocket sheet renders 186×258px pockets using 88% of the
  canvas height, with **zero overflow** on the sheet area or `.app-main`.
- Spread 1 is cover + one sheet; spread 2 is two sheets; both fit, and spread
  pockets are correctly smaller than single-page ones (133 vs 186).
- Shrinking the window to 1000×620 re-fits (58px pockets) instead of scrolling.
- Emulated phone (390×844): one sheet, still 4 across, no overflow, no Spread
  toggle, horizontal tray.
- Touch path with no drag events at all: tap card → tap pocket places; tap
  filled pocket → outlined; tap another pocket → moves.
- Drag/swap/remove/save re-verified after the rework.
