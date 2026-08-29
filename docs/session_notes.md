# CollectCore — Session Notes

_Format: ### YYYY-MM-DD (US CDT) — brief completed / next summary_
_Keep last 3-5 sessions. Collapse older entries into "Completed to date" block._

> Update this section at the end of each working session with a brief
> summary of what was completed and what is next.

### 2026-08-29 (US CDT) — Origin ship dates + cost basis BUILT + DEPLOYED (`fd551e3`)

Same day as the capture/comps entry below, second working block. Turns the comp
view from "what does this sell for" into "what would I make on it". Plan doc
updated in the same pass.

- **Dates are an origin fact, not a card fact.** `start_date` +
  `date_precision` on `lkup_photocard_source_origins` — **88 origin rows date
  all 11,323 catalogued cards**, and no card has a null origin, so this was an
  evening rather than a data-entry project. 87/88 seeded (only `Merch`, which
  has no cards). Sourced from two fan-maintained spreadsheets reconciled
  against the 2026-08-28 prod backup, plus 8 dates supplied directly for the
  2025-26 tail the sheets do not reach. `sort_order` on that table turned out
  to be `0` on every row and read by nothing.
- **Lookup ids are NOT stable across databases — this nearly shipped a silent
  bug.** In the dev copy id 77 was `This & That`; in prod id 77 is
  `Season's Greetings 2025 (Japan) Your Hero`. Seeding on id alone would have
  written an album date onto a Season's Greetings row with nothing to notice it
  by. Names drift independently too (~15 origins renamed in prod:
  `Nacific` → `Collab: Nacific`), so name-only matching skips rows instead.
  The seed matches on **(id AND name) together**, writes **NULLs only** so a
  hand correction survives restarts, and logs any mismatch rather than
  guessing. Verified both directions: 87 seeded on a prod copy, 56 seeded and
  15 refused-with-reasons on dev.
- **Cost basis is scoped to the sale pile**, `trade`/`pending_outgoing`. The
  catalog is 11,323 cards but only **1,664 copies are actually held** — the
  rest are `undecided` reference rows. A catalog-wide basis would have been a
  large confident number about cards that were never owned. Real pile: **453
  copies over 243 cards, $1,342.50, $2.96/copy**, ~77% tier 3 (expected — that
  is where the buying and trading have been).
- **`mkt_cost_tier` + `mkt_item_cost`**, mirroring `tbl_photocard_pricing`'s
  tier-XOR-custom CHECK: derived on read, never denormalized, so editing a tier
  reprices every card on it with no backfill (verified $1,342.50 → $1,517.00 on
  a $3.00→$3.50 change). `mkt_` prefix rather than `tbl_photocard_*` keeps cost
  out of the catalog/guest sweeps; nothing reaches `/pcs/`.
- **`\bID\b` is a registered SQLite function, not `LIKE`.** SQLite has no
  word-boundary operator, and `version LIKE '%ID%'` matches 1,758 cards of
  which only **288** are ID cards — the other 1,470 are Polaroids, so the
  shortcut sweeps expensive cards into the cheapest tier. Preview is always on
  screen; only the assign button writes.
- **Fixed a latent ordering bug the change would have hit.**
  `_run_migrations` runs *before* the schema's `CREATE TABLE`s, so any seed
  guarded on a table existing silently skipped on the first boot that created
  it and only ran on the second restart. Both seeds now run post-schema;
  verified on a fresh DB and a prod copy.
- **Corrected my own overstatement:** these columns reach the catalog delta and
  guest seed, but **not `/pcs/`**, whose origins endpoint uses an explicit
  column list against the live DB and never reads a seed. Only the retired WASM
  `/guest/` tier would care, and nobody is on it. Confirmed by test that an old
  guest seed + new delta fails on the unknown column — moot, but now known.

**Next:** per-card basis override UI (the table stores `source='manual'` and
the sweep preserves it; only the editing surface is missing), then Neokyo
capture (buy side, first real exercise of the JPY path), thumbnail upload to
R2, and the ledger.

### 2026-08-29 (US CDT) — Market intel capture + comps BUILT + DEPLOYED + LIVE

Continues the 2026-08-28 design session below. Slices 1-5 of
`docs/photocard_market_intel_plan.md` (authoritative, reconciled against what
shipped): a Chrome extension that captures Mercari listings while browsing,
ingest, and a comp view at `/market-intel`. Admin only, `mkt_*` namespace, no
photocard/catalog/`/pcs/` behaviour changes.

- **Capture reads the React fiber, from the page world.** Mercari hands each
  result tile a full item object (`memoizedProps.item`, hop 5). Content scripts
  run in an **isolated world** and cannot see React's `__reactFiber$` expandos,
  so the walk lives in `content/fiber.js` under `"world": "MAIN"` and hands
  results over as a `data-cc-item` attribute — attributes cross the boundary,
  JS properties do not. Moving that walk back into `capture.js` silently
  degrades to DOM scraping, which is exactly what happened once.
- **`trading` is the sold marker**, not `sold_out` — a sold-filtered sweep
  returned 24/24 `trading`. The **default search also contains sold rows**, so
  state must come from the item's `status` field and never from which filter
  was running.
- **Sole-line rule.** A card's price series counts only listings where it is
  the only line; a 12-card bundle at $27 is not that card selling for $27.
  Verified against a card appearing in both singles and a lot.
- **Comp view leads with the SOLD median.** Real data made the case: one card,
  n=43, asks **$20.00-$47.00** against sales **$5.00-$26.60**. Ranges barely
  overlap — browsing active listings would price it at ~2x what it clears at.
  Quartile bands rather than min/max (meaningless at 5x spread), and the series
  renders with thumbnails so a mis-association is findable by eye.
- **Card index pulls live from prod and self-refreshes** (>12h old, on panel
  open). A hand-exported copy was rejected as a correctness problem, not a
  convenience one: a card catalogued since the last export fails to match and
  gets pushed down the create-the-card path, inviting a duplicate.
- **Multi-source + currency.** Four sources declared (`mercari_us`, `neokyo`,
  `pocamarket`, `ebay`); only Mercari US has a parser. Native amount is the
  record, USD derived and labelled with its rate and source. Rates are dated
  history, never one mutable value.

**Four bugs worth remembering, all found by use rather than review:**
- `sidePanel.open()` needs a live user gesture, and the worker being woken by
  the click ends it. Chrome opens the panel natively via `setPanelBehavior`
  instead; the extension never calls `open()`.
- Reloading the extension **orphans content scripts in open tabs** — injected
  DOM survives, messaging is dead. Now shows a red bar saying to refresh.
- **React recycles result tiles.** The dot cached its listing id at creation, so
  a recycled anchor captured the wrong card. The anchor's live href is now the
  only source of truth.
- `dot.textContent = x` replaces the text node even when unchanged → childList
  mutation → observer → hang. All observer-path writes are now conditional and
  coalesced through rAF.

**Known gap:** the extension stores thumbnail blobs locally as designed, but
sync sends only `thumbnailUrl`, so server-side thumbnails hotlink Mercari's CDN
and **will rot when listings close**. The bytes exist in the browser; nothing
ships them yet.

**Next / open:** Neokyo capture (buy side — server-rendered, no fiber read,
brings the Japanese lexicon in). Then thumbnail upload to R2, the ledger, and
ship-name aliases. Brainstorm pending on cost basis for cards pulled from album
purchases.

### 2026-08-28 (US CDT) — Photocard market intel DESIGNED (extension + resale ledger)

Design session only — no code. Resurfaced the parked listing tracker and
redesigned it around browser-extension capture plus a resale ledger, written up
as `docs/photocard_market_intel_plan.md` (authoritative). Driven by two real
needs: research prices while browsing hundreds of listings without copy/pasting
URLs, and track spend/revenue on a small number of resale cards riding along in
Neokyo boxes already being bought for personal collecting.

- **Extension replaces server-side Playwright.** v3's biggest exposure was
  Chromium on Railway behind datacenter IPs, with a documented split-deployment
  fallback for when Mercari blocked it. Capturing from the real browser removes
  the risk rather than mitigating it — and the whole contingency branch with it.
- **Card-level observations replace per-URL tracking.** The need is "Card A cost
  X on Neokyo on this date, listed at Z on Mercari US on that date," dozens of
  rows per card. So `listing_snapshots`, the refresh engine, cooldowns,
  `refresh_lock_until`, and the in-process scheduler sweep are all **dropped**.
  What survives from v3 is a plain buy shortlist — saved Neokyo URLs, no
  lifecycle.
- **Active and sold are both captured, tagged, never blended.** Sold comps alone
  miss a fluctuating market. The trade sides read different series: buy is
  inherently active-only (you can only purchase a live listing), sell leans
  sold. Falls out for free: **supply depth**, which predicts days-to-sell better
  than price.
- **One listing carries N lines** — cards, non-card items (album/magazine/merch),
  and unidentified cards, each labelled. This is one feature serving two
  consumers: on comps it yields the **implied per-card price** on lots (the
  arbitrage thesis, quantified); on purchases it is the allocation basis.
  Partial identification is a complete record, not a draft.
- **Allocation needs two bases, not one.** Weight for international shipping
  (cards ~5g and near-uniform; an album correctly eats a huge share), per-item
  or value for service fees. A single basis gives wrong per-card costs the
  moment a heavy non-card item is in the box. Overrides reuse the
  tier-XOR-custom pattern from `tbl_photocard_pricing` deliberately.
- **Full box costs allocate across every line, kept and flipped alike.** Letting
  resale freeload on shipping the personal purchase paid for is the exact false
  signal that would justify scaling into a dedicated box on an accounting
  artifact. `kept` is a first-class outcome and a transfer at allocated cost —
  the mechanism that makes "resale net ≥ landed cost of cards kept" computable.
- **Auth:** Option C (local IndexedDB export, no API) while the extension is
  shaped, Option B (CF Access service token scoped to `/ingest/*`, append-only)
  for the real build. A service token validates at the edge, so **the app still
  gains zero auth code**. CORS preflight from the extension origin — not the
  cookie — is the fiddly half either way.
- **Scope held down deliberately.** An earlier proposal for a multi-week
  sell-through measurement program was rejected as disproportionate; those
  numbers accrue on their own from `date_listed` / `date_sold` once the ledger
  is in use.
- CLAUDE.md updated: reference-table row for the new plan, roadmap entry, and
  the v3 listing tracker marked **superseded for photocards** (still the
  reference if another module ever needs listing tracking).

**Next / open:** the ~30 min check on what Mercari US's search response actually
carries — it decides whether the enrich tier is optional or required, and it
gates finalizing the capture design. Then the Mercari US capture extension,
whose first payoff needs no purchases at all: comps to price the existing trade
shelf. Left loose until a real box lands: value-weight class multipliers and
grams-per-line-type defaults.

### 2026-08-27 (US CDT) — Lomo/Fanmade ownership status (`/pcs/` request)

A `/pcs/` user asked for a status for unofficial fan-printed cards. Added as a
seed row, not a feature: statuses are data-driven end to end, so the badge
letter and one CSS variable were the only code the tiers needed.

- **`lomo_fanmade` / "Lomo/Fanmade", `sort_order` 11, photocards only.** A
  *possession* fact held **instead of** Owned, so it takes the primary
  (bottom-left) badge slot as **L**, directly below `O` in
  `PRIMARY_STATUS_ORDER`. New `--badge-lomo` (#ffffff) in both themes — white
  rather than a neon of its own, so it never competes with the green O.
- **Deliberately no co-occurrence rule and no derived behaviour**, per the
  request: it blocks nothing and nothing blocks it. `_conflicting_codes`
  returns `[]` for it. Owned + Lomo/Fanmade on one card is legal, just unusual;
  `O` wins the badge slot if it happens.
- **Appended rather than slotted in.** These lookup rows are shared with every
  other module's sidebar, so renumbering to place it under Owned would have
  shifted Books/Music/etc. too. Cost: it sits behind the sidebar's "+N more"
  fold, like Undecided/Not Wanted.
- **Migration guard is the once-only kind.** `_run_migrations` writes the status
  + xref rows only when the status is absent, and migrations run BEFORE
  `schema.sql` — so it fires on exactly one boot, which is what lets an admin
  switch it off in Admin > Status Visibility without it returning on restart.
  `_seed_status_visibility_xref` couldn't do this: it only seeds a fresh DB.
- Verified on a copy of the dev DB: one status row + one xref row, stable across
  three consecutive boots; fresh DB seeds it photocards-only.

**Known wrinkles (accepted, not bugs):**
- Admin **bulk edit** rewrites a card's *decision* row only, so sweeping to
  Lomo/Fanmade converts the decision to a possession copy and skips cards with
  no decision row — identical to picking Owned or Trade there today. The
  `/pcs/` bulk update has no such wrinkle: it sets every copy on the card.
- Trade share pages count a lomo copy as neither owned nor wanted, so it reads
  as "in catalog" to a viewer. Correct as far as it goes — it isn't the
  official card.

**Next / open:** nothing outstanding for this change. Roadmap is unchanged:
`/pcs/` cloud accounts, then listing tracker Phase 1.

### 2026-08-17 (US CDT) — Photocard price tiers + trade CSV export BUILT

Both halves of `docs/photocard_pricing_and_trade_export_plan.md` (authoritative),
all six phases, driven by starting to sell on Mercari: price many cards in one
sweep, then get the trade shelf out as a paste-ready worksheet.

- **Tier XOR custom price, enforced by a CHECK**, not by application code. Three
  states: no row = unpriced, `price_tier_id` = tiered, `price_cents` = custom.
  Setting a custom price drops the card out of its tier so a later sweep over
  that tier can't silently reset it.
- **Effective price is derived on read and never denormalized** — so editing
  Tier 3's amount reprices every tier-3 card with no sweep and no migration, and
  leaves custom-priced cards alone. That is the whole point of tiers.
- **Pricing is a side table (`tbl_photocard_pricing`), not columns on
  `tbl_photocard_details`.** `catalog.py` (`SELECT *`) and `seed_builder.py`
  (PRAGMA-driven copy) reflect the detail table, so a column there would ship to
  the catalog delta and the guest seed with nothing in the diff to warn you.
  Verified: catalog delta carries no price fields, and the seed's table list is
  explicit. Prices never reach `/pcs/` or `/guest/`.
- **Listing titles branch on the version text.** 1,444 `version` values already
  contain "Photocard", so appending the phrase unconditionally is both redundant
  and over Mercari's **80-char cap**. Two templates in `tbl_app_settings`
  (settings, not code — listing conventions get tuned constantly). Measured
  across the 89 trade cards: **42–74 chars, median 58, zero over 80.**
- **The client drives the export.** The notes search is client-side and covers
  copy notes, so a server-side "all trade copies" query would be blind to
  "search `for sale` → export what I see". Same shape as the trade-page flow;
  zero new filtering logic on the backend.
- **Bulk re-sweeps report `replaced_custom`** — assigning a tier genuinely wipes
  a custom price in the selection, which is intended but would otherwise be a
  silent loss. The Admin tier editor likewise confirms with the card count
  before a price edit ("This reprices 214 cards").
- Deleting an in-use tier **409s** rather than dangling `price_tier_id` values
  (FK cascades don't fire); retiring is `is_active = 0`. Both photocard delete
  paths now clean up `tbl_photocard_pricing`.

**Deviations from the plan** (both recorded at the top of the plan doc): tier
`POST` derives `tier_code` from the name, and the CSV's `notes` column draws
from all copies rather than only trade ones — scoping it to trade copies would
drop the note that caused the search match.

**Verified** with a 38-check script against a *copy* of the dev DB (`TestClient`,
scratchpad `COLLECTCORE_DATA_DIR`), covering plan verification items 1–15 plus
bad input, the unprice sentinel, and non-trade/unknown ids: CHECK rejects both
illegal states, tier→custom→re-sweep round trip with `replaced_custom: 1`, tier
edit repricing 9 cards while the custom card holds at $15, delete guard, both
delete paths, BOM, one row per card with 34 stacks counted, 81 unpriced rows
exporting blank. Then live against uvicorn. Admin/guest/pcs bundles all build;
zero new lint findings.

**Found along the way:** `/export` was missing from `vite.config.js`'s
`PROXY_PATHS`, so the CSV POST would have returned `index.html` in dev — exactly
what that file's comment warns about. Added.

**Next / open:**
1. ~~Not committed / not deployed.~~ **Committed + pushed 2026-08-27**, in the
   same push as the Lomo/Fanmade status below. No manual prod step: the tables,
   the four tier seeds and the three template settings are all in `schema.sql`,
   so `init_db` lays them down on the deploy's first boot.
   `backend/migrate_photocard_pricing.py` stays as belt-and-braces only.
2. **Your dev backend on :8001 predates these routes** — restart it or
   `/photocards/price-tiers` 422s against the `{item_id}` route.
3. Then do the actual work the feature exists for: price the 89 trade cards
   (bulk sweeps first, custom prices for the outliers), then export.

### 2026-08-12 (US CDT) — Binder Designer BUILT (admin tier, not committed)

New photocard tab for laying out physical binders on screen: create a named
binder, pick a pocket layout, add/remove pages, drag cards from a filtered tray
into pockets. Design doc: `docs/photocard_binder_designer_plan.md`
(authoritative).

- Built dev-gated first, then **un-gated the same session** — binders have to
  track the real collection (dev vs prod card tracking have diverged badly), and
  the page needs to work on a phone while filling binders physically.
- **SPA route is `/binder-designer`, not `/binders`.** Vite proxies by path
  prefix, so sharing the API's prefix would make the page load and the list
  endpoint two indistinguishable GETs.
- **Layout codes read across × down** — `3x2` is the 6-pocket page, `4x3` the
  12-pocket. First written transposed; `db.py` rewrites stored codes on startup
  (idempotent, logged) and the frontend maps legacy codes defensively.
- **Sheets are measured, not preset.** A ResizeObserver feeds `fitPocketWidth()`,
  which returns the largest pocket that fits both axes for the current layout and
  sheet count. The S/M/L toggle is gone. The sheet area is `overflow: hidden` on
  purpose — a scrollbar there means the measurement was wrong. Measured 186×258px
  pockets at 1600×1000, 88% of canvas height, zero overflow.
- **Phone support.** Forced single-page view, tray becomes a horizontal strip,
  filters reuse the existing off-canvas drawer. Tapping is the full editing
  model: tap a card then a pocket to place, tap a filled pocket to pick it up,
  tap another to move it — HTML5 drag events never fire on touch.
- **`UNIQUE(item_id)` on `tbl_binder_slots`** enforces "a card lives in one
  binder only" at the DB level; the save returns 409 naming the holding binder.
- **Spread view is a true open binder** — left = sheet N backs (columns
  mirrored, read-only), right = sheet N+1 fronts.
- **The available tray is derived**, not a stored list, which is what makes
  "a removed card returns to its sort position" true by construction. Required
  extracting the library's filter/sort logic (`photocardFiltering.js`) and badge
  vocabulary (`cardBadges.js`) — pure moves, library verified unchanged.
- **Post-save Wanted sweep** (opt-in) reuses `PATCH /photocards/bulk`; cards with
  no decision row get a new Wanted copy instead, since the bulk UPDATE would
  match zero rows and skip them silently.

**Found along the way:** SQLite **FK cascades never fire** in this app —
`PRAGMA foreign_keys = ON` is only issued on `init_db`'s connection, so every
`FOREIGN KEY` in `schema.sql` is documentation. Photocard deletion now frees
binder slots explicitly (both delete paths); recorded in CLAUDE.md + summary as
a general rule, since it applies to any future table.

**Verified** with curl (backend) and a Chrome DevTools Protocol driver against
`npm run dev` (Node 24's built-in WebSocket — no new dependencies) — 50 checks
across three rounds covering drag/move/swap/remove, tap-to-place and tap-to-move,
sort restoration, spread mirroring, fit-to-space sizing at three viewport sizes,
save, 409 conflicts, the sweep applied and rolled back, and slot cleanup on both
photocard delete paths. One bug found and fixed: a stale `binder.lastBinderId` in
localStorage produced a sticky full-page error.

**Next / open:**
1. **Not committed / not deployed** — review in `npm run dev`, then build + push.
   First prod load creates the three (empty) binder tables automatically.
2. Page reordering (dragging whole sheets) deferred; add/insert/delete only.

**Not an issue:** a couple of dev cards (6121, 6129) render as broken images
because the dev DB's `tbl_attachments.file_path` names an R2 object that no
longer exists — probably superseded by a re-publish, whose sweep removed the old
key. **Prod renders both fine**, so this is a stale-snapshot artifact of the dev
DB, not a data gap. Binder slots fall back to an "Image missing" placeholder
regardless, which is still worth having for cards awaiting a scan.

### 2026-08-12 (US CDT) — Photocard triage statuses (Undecided / Not Wanted) BUILT + DEPLOYED + LIVE

Split the meaningless Wanted pile into an explicit collecting decision. Commits
`f4facd1` (feature), `72951ec` (bulk-create fallback fix), `0298649` (CLAUDE.md).
Design doc: `docs/photocard_triage_statuses_plan.md` (authoritative).

**Motivator:** `wanted` had come to mean "this card exists in my library", not
"I want this" — the 2026-04 import and BulkCreatePage both stamped it on every
card, leaving ~93% of the library Wanted. Goal is to hand-triage the whole
library by member + source sweeps with individual curation.

> **All figures in this entry are DEV-measured** (9,314 Wanted of 10,024 cards;
> 690 owned / 157 trade / 84 trade stacks; the 1.60s → 0.004s sweep timing).
> The dev DB is a stale snapshot: **prod holds 11,306 photocards**. Don't treat
> the dev numbers as prod's.

- **Two new statuses, photocards-only** (`sort_order` 9/10, appended — no
  existing row renumbered, so other modules are untouched and the sidebar's
  visible five are unchanged). Deliberately behind the "+N more" fold: they're
  set once per card, unlike the frequently-changed possession statuses.
- **Decision vs possession.** `ownership_status_id` now carries two orthogonal
  facts. `not_wanted` + `trade` is legal on purpose — the trade copy row is
  deleted when a trade completes and the record must survive it. Enforced by
  `_check_status_conflict` (replaces `_check_owned_wanted_conflict`).
- **Bulk sweep rewritten.** Was card-scoped (`WHERE item_id = ...`), which
  rewrote *every* copy on the card — 84 cards with trade stacks would have been
  flattened by the very sweeps planned for triage. Now row-scoped to the
  decision row, conflicting cards excluded and counted, and collapsed from a
  per-item loop to one statement (**1.60s → 0.004s** over the full 10k library).
- **Frontend:** badge letters U/N (muted `#9aa0a6` / `#a05252`); primary badge
  slot is now an ordered chain `O → W → N → U`; BulkCreatePage defaults to
  Undecided; card-level **Triage** filter section (Tracked / Untracked);
  desktop-only header prefix `N total · N tracked` (mobile string unchanged).
- **Why Triage is a card-level section, not an Ownership exclusion:**
  `applySection`'s `exclude` is card-wide, so excluding `not_wanted` there would
  also hide `{not_wanted + trade}` cards — dropping live trade inventory out of
  view. Same predicate backs the header's `tracked` count.
- **Deploy is purely additive by design.** `_seed_status_visibility_xref` only
  seeds a *fresh* DB, so an existing DB never gets the xref rows; a simulated
  prod deploy confirmed the statuses stay invisible, no copy row is touched, and
  nothing one-shot runs at startup (restarts can't alter data). Caught that the
  old `os.find(undecided) || os[0]` fallback would have stamped new bulk-created
  cards **Owned** — now falls back to Wanted (`72951ec`).

**Prod migrated 2026-08-12** via the two manual admin steps (no script run
against the Railway volume): (a) Admin → Status Visibility, tick Undecided +
Not Wanted for Photocards — the code migration is additive-only, so an existing
DB never gets the xref rows from `_seed_status_visibility_xref`, which seeds a
*fresh* DB only; (b) library → filter Ownership = Wanted → Select All → Bulk
Edit → Undecided. `backend/migrate_triage_statuses.py` scripts both, and was how
dev was migrated, but it needs volume access the UI route avoids.

**Next / open:**
1. **Triage the library** by member + source sweeps — the actual point of all this.
2. **Default `Triage = Tracked` filter deliberately NOT enabled** — it would hide
   the pile mid-triage. Small addition to the `!isAdmin` block in
   `PhotocardLibraryPage.jsx` once triage is done.
3. Cosmetic: `_check_status_conflict`'s 400 message reads "already has a Owned
   copy" (article not inflected) — inherited from the original string.

### 2026-07-17 (US CDT) — Photocard bulk-create + imageless catalog + batch-image window + /pcs uploads DEPLOYED + LIVE

All 4 phases of `docs/photocard_bulk_create_and_batch_images_plan.md` **built,
deployed to Railway, and verified live in prod.** Commits `48a8c91` (P1–3),
`b415486` (P4 + dev R2 kill-switch), `c0bb8b8` (pcs modal image-stretch fix).
Phase 4 tested end-to-end in prod on throwaway cards (18102/18103), then cleaned
up (cards bulk-deleted; their R2 objects removed). Motivator: onboard a new album
era (Stray Kids) as placeholder cards before release, then attach scans en masse.

- **Phase 1 — Bulk Create** (`frontend/src/pages/BulkCreatePage.jsx`, route
  `/bulk-create`): set selectors + member checkboxes, two buttons — "Create
  separate cards" (one per member) / "Create one combined card". Ownership fixed
  to **Wanted** (admin's own annotation, invisible to /pcs/). Rides existing
  `POST /photocards` (now passes `is_special`).
- **Phase 2 — Imageless catalog membership + removal.** Reversed the "catalog is
  monotonic" guardrail (CLAUDE.md + `project_catalog_is_monotonic` memory + this
  doc synced). Catalog membership no longer needs an image: `commit_all_drafts()`
  / `POST /admin/publish-catalog-drafts`, surfaced as **Admin → Publish New Cards
  to Catalog** (grabs every `catalog_item_id IS NULL` photocard). Also
  `commit_items_to_catalog()` / `POST /admin/commit-catalog`. Removals now
  propagate: `bulk_delete_photocards` drops orphaned `pcs_card_copies` (silently);
  on /pcs/ the card just vanishes (live query, no tombstones). Null-front cards
  render an "Awaiting photo" placeholder graphic (admin + /pcs/).
- **Phase 3 — Batch Images** (`frontend/src/pages/BatchImagePage.jsx`, route
  `/batch-images`): inbox-style staged attach/replace — to-do pool + paginated
  captioned card grid with front/back drop slots; images move pool⇄slots, ✕ /
  Discard All return to pool, Save commits via `replace-front|back`. Verified in
  the UI by the user; dev-DB test edits reverted from a per-card snapshot.
- **Phase 4 — /pcs/ friends fill missing images** (`backend/routers/pcs.py`
  `POST /pcs/photocards/{item_id}/upload-front|back`, `pcs_image_contributions`
  table; `pcsData.uploadPcsImage`; "Add photo" on empty slots in
  `PcsPhotocardDetailModal`): friend fills an empty front/back → becomes THE
  catalog image, first-write-wins (409), attribution recorded, bumps
  `catalog_version`. **First non-admin write to catalog/R2.** Verified e2e.
- **Dev R2 kill-switch:** discovered `backend/.env` holds PROD R2 creds (loaded by
  `main.py`), so the dev app writes to the **prod** bucket (my first Phase 4 test
  did — objects deleted). Added `COLLECTCORE_DISABLE_R2` (dev `.env`): both
  `_make_r2_client`s refuse, `sweep_r2_orphans` skips, pcs upload goes local. Dev
  is now R2-inert; **prod must leave the var unset.**

**Nothing left open** on this work — all shipped. (Reference: the /pcs/ upload UI
lives in the pcs bundle, `build:pcs` → `backend/frontend_dist_pcs/`; prod must
leave `COLLECTCORE_DISABLE_R2` unset — it's dev-`.env` only.)

### 2026-07-10 (US CDT) — `/pcs/` authenticated guest tier BUILT + DEPLOYED + LIVE

The cloud guest tier is **live in production and safe to share.** Phases 1–3 of
`docs/guest_cloud_accounts_plan.md` built on branch `pcs-tier`, fast-forward
merged to **main**, deployed via Railway. Friends can now track their catalog in
the cloud (server-stored, so clearing browser data can't wipe their work) — the
original goal is met. Commits: `f652537` (P1 backend), `d51c073` (P2 frontend),
`32d1054` (P3 serving + JWT hardening + runbook), `7b703bc` (runbook fix),
`56e7229` (publish `limit` param).

**What's live & verified end-to-end:**
- **Auth**: Cloudflare Access + Google **email allowlist**, via a **path-scoped
  Access application** `CollectCore PCS` (domains `collectcoreapp.com` path `pcs`
  **and** `api.collectcoreapp.com` path `pcs`). CORS settings on that app mirror
  the admin app (allow-credentials ON, origin `https://collectcoreapp.com`, all
  methods/headers) — required so the JSON write preflights (`POST/PUT/DELETE
  /pcs/copies`) aren't challenged by CF Access. That CORS gap was the "Add as
  Owned → failed to fetch" bug; fixed.
- **Backend** (`backend/auth.py`, `routers/pcs.py`, `schemas/pcs.py`): `pcs_users`
  + `pcs_card_copies` tables, provision-on-first-hit `/pcs/me`, catalog joined
  with the caller's copies, per-user copy CRUD scoped server-side (cross-user →
  403). First app-layer authorization in the codebase.
- **Admin gate ENABLED** (`PCS_ADMIN_GATE=1` on Railway, `ADMIN_EMAILS=
  worldsapart76@gmail.com`): non-public, non-`/pcs` paths (admin SPA + all
  admin/module APIs) now require an admin email — a guest hitting
  `api.collectcoreapp.com/photocards` gets 403. Verified admin still works +
  guest is blocked. Rollback = unset the var.
- **JWT hardening ENABLED** (`CF_ACCESS_TEAM_DOMAIN=collectcore.cloudflareaccess.com`,
  `CF_ACCESS_AUD=<admin-aud>,<pcs-aud>` on Railway): the app now verifies the
  signed `Cf-Access-Jwt-Assertion` and IGNORES the forgeable plaintext email
  header, closing the raw-`*.up.railway.app`-origin spoof hole. Verified admin +
  guest both work under JWT. **Required a code fix** (`33c9023`): each Access
  application signs with its OWN aud tag, so `CF_ACCESS_AUD` is now
  comma-separated and a token passes if its aud matches ANY entry — single-aud
  would have locked out whichever app wasn't listed. Gotcha hit during setup: a
  wrong team-domain value → JWKS DNS failure (`Errno -2 Name or service not
  known`) → ALL verification fails (both apps 401/403); fix = correct the value,
  rollback = unset both vars. Rollback reverts to plaintext-header trust.
- **Frontend** (`frontend/src/pcs/*`, `.env.pcs`, `build:pcs`): reuses admin
  `PhotocardLibraryPage` via `pcsData.js` server-data adapter; env-flag
  tree-shaking (`VITE_IS_PCS`, derived `isGuestWasm`) keeps sqlite-wasm out of
  the pcs bundle. Served at `collectcoreapp.com/pcs/` by `spa_host_routing`.
- **"They should see everything admin can"**: drained the publish backlog (417
  images → R2), so **all 10,448 photocards** now carry `catalog_item_id` + R2
  URLs = full parity with admin. NOTE: this means every photocard is now in the
  monotonic catalog (no non-catalog/private photocards remain). 0 local paths
  left; card 6121 verified on R2.

**Also flagged this session:** admin has to *remember* to publish images to R2 →
user wants this automated (scheduled cron calling `/admin/publish-catalog`, or
publish-on-add). Parked as a follow-up, not built.

**Next (all optional, none blocking sharing):**
- **`PcsPhotocardDetailModal` image robustness** — resolve via `getImageUrl`
  like admin so future *unpublished* cards don't render broken. Small frontend
  patch + redeploy.
- **Auto-publish to R2** — design + build the scheduler/publish-on-add above.
- Phase 4 (WASM `/guest/` sunset: redirect `/guest/*` → `/pcs/`, optional
  backup-JSON importer) — deferred.

### 2026-06-28 (US CDT) — Guest `/pcs/` plan reconstructed + version filter shipped; listing-tracker parked

Two things shipped to **main** (deployed via Railway), one branch parked.

**Shipped — guest cloud accounts (`/pcs/`) plan reconstructed (commit `f134236`).**
The authoritative `/pcs/` plan referenced across the docs lived only at
`C:\Users\world\.claude\plans\guest-cloud-accounts.md`, which **no longer exists**
and was unrecoverable (checked transcripts, backups, Dropbox, Drive — all gone;
the whole `.claude\plans\` dir was wiped). Rebuilt it **in-repo** (durable,
version-controlled) at `docs/guest_cloud_accounts_plan.md` from surviving
references + this session's decisions, and repointed every dead `.claude\plans\`
reference (CLAUDE.md, deployment_and_auth.md, catalog_architecture.md, both
listing_tracker docs, this file). Key design (user-confirmed): reuse admin
photocard library via a server-data adapter (no Tailwind in CollectCore); CF
Access + Google with an **email allowlist**; mirror the multi-copy tracking
model (guest-added own cards → v2); photocard-only. The cloud tier is *simpler*
than the WASM `/guest/` it replaces — moving annotations server-side deletes the
WASM/OPFS/snapshot-delta/backup machinery. Notable: introduces the **first
app-layer authorization code** (admin-email gate; CF JWT verification
recommended as hardening over the plaintext email header).

**Shipped — photocard Version filter scoped to source origin (commit `51ee5cc`).**
Backlog item (was in `project_future_enhancements.md`). `filterVersions` in
[PhotocardLibraryPage.jsx](frontend/src/pages/PhotocardLibraryPage.jsx) now draws
only from cards passing the active source-origin filter (one-way, origin →
version), reusing `applySection`; no origin selected → all versions. Frontend
only, rebuilt `frontend_dist`. Benefits the future `/pcs/` UI for free (reuses
the same page).

**Parked — `listing-tracker` branch (local only, NOT pushed; decision pending).**
Holds 3 unpushed commits = Listing Tracker **Phases 1–3** (~2,100 lines, backend-
heavy): schema (`tbl_tracked_listings`, `listing_snapshots`,
`marketplace_fee_profiles`), CRUD/price-history endpoints, parsers
(`backend/parsers/` — Neokyo HTTP + Mercari Playwright), thumbnail→R2, refresh
engine (`listing_refresh.py`, `listing_scheduler.py`), and a **backend
Dockerfile** switching Railway's build to a Playwright/Chromium image. **State:**
code-complete but **never validated against real URLs or Railway** (no local
scraping stack — deferred to first deploy by design); **Phases 4 (UI) + 5
(item-detail integration) not built**, so unusable from the app; the Dockerfile
build-system change is the risky bit. Kept off main on purpose — pushing/merging
would put unproven scraping + a build change into prod. Its own build-session
history (2026-05-15→17) lives in this file *on that branch*. Branch is now behind
main by the 2 commits above → needs `git rebase main` when resumed (today's doc
edits were made to merge cleanly).

**Next:** Guest tier **Phase 1 (backend)** when ready — branch `pcs-tier` off
main: `pcs_users` / `pcs_card_copies` schema, CF-identity dependency, `/pcs/*`
endpoints, admin-authorization gate. Listing-tracker disposition is the user's
open decision.

### 2026-05-15 (US CDT) — Listing tracker plan: cloud-hosting resolved + wanted-gate removed

No code. Planning session — the listing tracker's tabled "Open Question:
Cloud Hosting Impact" (raised 2026-04-21, pre-Railway-cutover) was evaluated
against current hosting reality and resolved. Updated
`docs/listing_tracker_design_plan_v3.md`, `docs/listing_tracker_dev_plan.md`,
and the CLAUDE.md pointer.

**Decisions (user-confirmed):**
- **Scraper on Railway, no pre-spike.** Playwright + Chromium via a backend
  Dockerfile (replaces Procfile/Nixpacks). Accepted rework risk; split-to-home
  scraper is the documented contingency if datacenter IPs get blocked.
- **In-process weekly scheduler** (hourly tick, DB-driven, restart-resilient) —
  no separate worker / no Railway cron.
- **Thumbnails → R2** under `listings/` prefix (old "local dir backed up with
  images/" model is dead — Railway FS ephemeral). DB tables auto-captured by
  the SQLite hot-copy backup.
- **Retention:** closed listings kept forever; manual delete is soft-delete
  only (resolves the dev-plan "soft vs hard TBD"). New `deleted_at` +
  `catalog_version` columns on `tbl_tracked_listings`.
- **Guest-visible price data (NEW requirement):** photocard-only lean listing
  summaries, gated behind a single global admin toggle
  (`catalog_publish_listings`, OFF by default). Added as dev-plan **Phase 8**.
  (Originally designed against catalog snapshot+delta; **retargeted to `/pcs/`
  later this session** — see guest-deprecation note below.)
- **Tracker page** confirmed as the "all my URLs in one place" report; added
  per-row open button, group-by-card, and bulk open/copy-URLs ergonomics.

**Phase 0B audit → wanted-gate removed.** Stringent audit of Phase 0B against
the real photocard schema found the design plan's books template wrong for
photocards (`os.id/os.name` vs actual `ownership_status_id/status_code`;
ownership lives in `tbl_photocard_copies` not `tbl_items`; no `title`; owned-
precedence inconsistency with `/admin/trade-ownership`). User then decided
**any item is trackable regardless of ownership status — no validation gate**.
Consequences applied to both plan docs + CLAUDE.md:
- Wanted-validation rule struck; Standardized Wanted Query / all
  `view_wanted_*` views **dropped**; `get_wanted_items()` dropped.
- **Phase 0B removed entirely** — no longer a prerequisite. Phase 0A is the
  only Phase 0 work and it's done, so **Phase 1 is the first open item**.
- `POST /listings/track` takes any item; "Add price tracking" shows on every
  item detail view; Phase 5C reframed to a general coverage view.
- Residual photocard rule recorded as a **hard safety constraint**: the
  tracker must be strictly additive — never retrofit `/admin/trade-ownership`,
  `_attach_copies`, or the catalog/seed builders. Per-module display-label
  resolver (photocards: group+member(s)+source_origin+version, never `title`,
  `collection_type`-scoped) is built in Phase 4 where consumed.

**Guest deprecation → Phase 8 retargeted to `/pcs/`.** User flagged that the
old `/guest/` WASM tier is being deprecated (replacement = `/pcs/`
authenticated tier, plan at `docs/guest_cloud_accounts_plan.md`
— **a complete draft, last updated 2026-05-12, not started**; P8 sunset
deletes `/catalog/*` + `seed_builder.py`). Original Phase 8 (8C/8D) was built
on exactly that doomed infra. Rewrote Phase 8 across design plan v3 + dev plan
+ CLAUDE.md: dropped snapshot+delta / seed / `guest_catalog_listings` mirror /
`tbl_tracked_listings.catalog_version`; Phase 8 is now a plain server-side read
on the `/pcs/` tier, gated by the same toggle, **dependent on `/pcs/` being
built first**. No new functionality goes to `/guest/`. Admin-side tracker
(Phases 1–7) is unaffected.

**Next:** still not built. **Phase 1 (schema & core backend)** is the first
open work item — no remaining Phase 0 blockers.

### 2026-05-09 (US CDT) — Photocard trading v2 (Parts 1-4 shipped)

Full trade-page architecture landed. Plan at
`C:\Users\world\.claude\plans\photocard-trading-v2.md`. Supersedes the
old Phase 8 / PD2 design (downloadable HTML + import) which was tagged
historical-only — server-hosted URLs deliver the "open the link, see
your badges" UX that file:// origin couldn't.

**Part 1 — Image republish + cache busting.** New
`tbl_attachments.image_version` column + versioned R2 keys
(`{cat_id}_{f|b}_v{N}.jpg`). The replace-image flow bumps the version
and orphan-tracks the previous URL into `tbl_r2_orphans` with a 7-day
deletion window so in-flight trade pages and stale guest catalogs keep
working. Startup sweeper deletes expired orphan keys from R2 (404-
tolerant). Same versioning propagated to `tools/publish_catalog.py`.

**Part 2 — PDF export retired.** Removed `ExportPage.jsx`,
`POST /export/photocards`, `_generate_pdf`, `backend/export_pdf.py`
(orphan), `reportlab` from requirements. `Export` link gone from the
photocard nav.

**Part 3 — Trade backend.** New `tbl_trades` table + `routers/trades.py`:
`POST /trade` (admin or guest), `GET /trade/data/<slug>` (public, lazy-
expire on read), `GET /admin/trades`, `DELETE /admin/trade/<slug>`,
`GET /admin/me` (viewer-mode probe), `GET /admin/trade-ownership` (admin
badge lookup). Guest trades auto-expire after 30 days. CF Access bypass
documented as Step 6 in `docs/guest_deploy_runbook.md` —
`/trade/*` and `/assets/*` must be added to a fourth bypass app at
deploy time (the `/assets/*` exposure is the cost of putting the trade
page in the admin SPA bundle to keep architecture simple).

**Part 4 — Trade frontend.** New `TradeCreateModal` opens from library
multi-select (admin and guest both); modal prefills From / To / Notes
from saved defaults. New `TradePage` at `/trade/:slug` with three viewer
modes: admin (probe → `/admin/trade-ownership` badges), guest (lazy-load
sqliteService, query OPFS `guest_card_copies`), unauth (no badges). New
`TradesPage` at `/trades` lists active trades and edits the From/To/
Notes defaults; admin reads from server, guest reads from
`guest_meta.my_trades` JSON list. Defaults persisted in
`tbl_app_settings` (admin) or `guest_meta` (guest).

**Verified locally:** backend boots clean, both bundles build, all
endpoints round-trip correctly with real photocard data, defaults
persist via `/settings`.

**Deploy-time clicks:**
1. Push (this commit).
2. Cloudflare Zero Trust → Add fourth Access application: bypass for
   `collectcoreapp.com/trade`, `collectcoreapp.com/assets`,
   `api.collectcoreapp.com/trade`. See
   `docs/guest_deploy_runbook.md` Step 6.
3. Smoke test: replace a card front, run Publish Photocard Images,
   confirm new R2 URL has `_v2`. Multi-select cards, Generate Trade
   Page, open URL incognito → unauth grid renders.

**Next steps (open):**
- Roll out CF Access bypass for `/trade/*` + `/assets/*` (manual click).
- Real-device smoke test once CF Access is configured.
- Phase 4b (guest-added cards) — still deferred.

---

### 2026-04-27 (US CDT) — Admin cover-image publish button + tombstones closed

Short session, two outcomes — one item closed, one shipped.

**Tombstones in /catalog/delta — closed permanently.** User confirmed
the photocard catalog is monotonic by design (cards exist in the real
world, so they exist in the catalog forever). No remove-from-catalog
admin flow will ever be built; tombstones are not deferred, they're
not needed. Removed from session-notes open list. Saved as
`project_catalog_is_monotonic.md` in memory so it doesn't resurface.

**`POST /admin/publish-admin-images` + UI button shipped** (commit
`46de2dd`). Parallel to Publish Photocard Images but for the 7
non-photocard modules. Implementation:
- New backend module
  [backend/admin_image_publisher.py](backend/admin_image_publisher.py)
  with `publish_pending()` mirroring `catalog_publisher.py`'s shape.
  Iterates the same MODULES mapping as `tools/sync_admin_images.py`
  (books → tbl_book_copies.copy_id; the other 6 modules →
  tbl_*_details.item_id). Per row: skip if URL already on R2 prefix,
  else fetch (local path or external URL via urllib), resize to
  1200px long-edge JPEG q85, upload to
  `admin/images/{prefix}/{prefix}_{pk:06d}.jpg`, rewrite
  `cover_image_url`. Per-module summary in response. No
  catalog_version bump — these modules don't participate in guest
  sync.
- Endpoint at
  [backend/routers/admin.py](backend/routers/admin.py) immediately
  after `/admin/publish-catalog`.
- API client `publishAdminImagesToR2()` in
  [frontend/src/api.js](frontend/src/api.js).
- UI section on Admin → Backup tab between Publish Photocard Images
  and Guest Webview Seed.
  [frontend/src/pages/AdminPage.jsx](frontend/src/pages/AdminPage.jsx).
  Surfaces total uploaded / skipped-hosted / failed plus a per-module
  failure list (stage + pk) when anything fails.
- Missing tables (dev DBs without all modules migrated) are caught
  with `sqlite3.OperationalError` and recorded as `table_missing`,
  not fatal.
- Removes the desktop-only friction of running
  `tools/sync_admin_images.py` after adding/replacing covers from a
  phone or other non-desktop device. CLI script remains for
  offline/automation.

**Verification:** admin build clean (629KB main, no regressions). Python
syntax-checked. Pushed to origin/main; Railway auto-deploy.

**Status / open items:**

| # | Item | Status |
|---|---|---|
| Tombstones in /catalog/delta | **closed 2026-04-27** | catalog is monotonic |
| Phase 4b — guest-added cards | deferred | wait for real-world demand |
| Bundle slimming (lazy-load admin module pages) | deferred | low priority |

**Next steps (open):**
- Phase 4b (guest-added cards) — schema + UX decisions documented
  but not built. Wait for actual user demand.
- Bundle optimization: admin bundle still includes the 7 non-photocard
  module pages even in single-module mode for guest. Lazy-load by
  module would slim the bundle further. Low priority.

---

### 2026-04-26 (later) — Guest webview LIVE + admin publishing operations

Guest webview is **live and end-to-end tested on real device** at
`https://collectcoreapp.com/guest/`. Long, iterative session — first
real-hardware test exposed several issues + an architectural gap in
the catalog publishing flow. All resolved.

**Guest deploy execution:**
- Cloudflare Access bypass app added for `/guest` path (user dashboard).
- Multiple CORS spirals chasing seed.db delivery: tried R2 bucket-level
  CORS (doesn't apply to public custom-domain requests), Cloudflare
  Transform Rule (intermittent duplicate ACAO header under cache churn,
  then disappeared entirely), inline urllib proxy through API
  (crashed Railway with 502s, urllib failing in some way that didn't
  even produce a clean error).
- **Settled on baking `backend/data/mobile_seed.db` into the repo.**
  Backend serves via FileResponse (CORS via FastAPI's existing
  CORSMiddleware, no R2 dependency at request time, no edge-config
  dance). 4MB binary in git is acceptable. CLI tool
  `tools/prepare_mobile_seed.py` still exists for offline dev use.
- Path-anchored `/data/` in `.gitignore` (was `data/`) so
  `backend/data/mobile_seed.db` isn't excluded by the same rule that
  hides root-level dev DB.

**Real-device test fixes (in order of discovery):**
- Mobile chrome (hamburger / drawers / filter funnel) was completely
  hidden. The four classes shared a `display: none !important` base
  rule but their mobile-show rules in the @media block didn't have
  `!important` — same asymmetry I missed earlier with `.mobile-only`.
  Fixed all four.
- `listPhotocards` now synthesizes a Catalog row (`copy_id: null`) for
  any card the guest hasn't annotated. Mirrors what admin's seed does;
  without it, ownership-status filtering on untouched cards didn't work.
- Default-filter logic inverted: first-visit (zero real guest copies)
  shows full catalog. Once user has any real copy, subsequent loads
  default to excluding Catalog. Welcome copy rewritten by user to
  explain the transition.
- First-launch flow now waits for explicit user consent before
  downloading the seed. Welcome modal renders in **mandatory mode**
  (X / ESC / backdrop dismiss disabled) — only the "Get started"
  button closes it. WelcomeModal gained a `dismissable` prop; default
  true so Help re-show from hamburger stays dismissable. Dropped the
  `welcome_dismissed` guest_meta flag — `hasPersistedCatalog()` is the
  natural signal (avoids chicken-and-egg of reading guest_meta before
  the DB is loaded, which threw "DB not loaded" in an earlier attempt).
- Auto-refresh after background sync. `sqliteService.syncCatalog` now
  dispatches a `collectcore:guest-catalog-updated` event after a
  successful apply; `PhotocardLibraryPage` listens and re-fetches
  in place. `GuestBootstrap` shows a slim "⟳ Checking for updates…"
  banner while the background sync runs. Closes the race where the
  library mounted and read stale data before sync finished.

**Architectural additions — admin batch publishing operations:**
- `POST /admin/regenerate-seed` + UI button on Backup tab
  ([backend/seed_builder.py](backend/seed_builder.py)). Rebuilds the
  bundled `mobile_seed.db` from the live admin DB on Railway. Periodic
  baseline refresh (occasional use); not the primary path for
  everyday changes.
- `POST /admin/publish-catalog` + UI button on Backup tab
  ([backend/catalog_publisher.py](backend/catalog_publisher.py)).
  Sweeps any photocard attachment with a local `file_path` to R2
  (resize → 600x924 JPEG q80 → upload → rewrite DB to R2 URL),
  bumps catalog_version on touched items so guest delta sync picks
  up the new URLs. Run after replacing or batch-adding photocard
  images. Filter switched from `storage_type='local'` to
  `file_path NOT LIKE 'http%'` for robustness.
- `_replace_image` in [routers/ingest.py](backend/routers/ingest.py)
  fixed: now resets `storage_type='local'` and clears `mime_type`
  alongside the `file_path` rewrite. Was leaving hosted-row-with-
  local-path frankensteins that bypassed publish detection.

**Delta sync improvement:**
- `/catalog/delta` now ships **full lookup tables** on every call
  (lkup_collection_types, lkup_ownership_statuses,
  xref_ownership_status_modules, lkup_top_level_categories,
  lkup_photocard_groups, lkup_photocard_members,
  lkup_photocard_source_origins). Previously only shipped lookup
  rows referenced by changed items, which silently dropped lookup-
  only edits like status visibility toggles or group renames. Worker
  uses INSERT OR REPLACE for is_active-flagged tables;
  `xref_ownership_status_modules` (no is_active flag — admin
  "unchecks" by deleting the row) gets wipe-and-refill so removed
  visibility propagates.
- This makes Regenerate Guest Seed unnecessary for everyday changes.
  It's now positioned as occasional baseline refresh only.

**Current admin workflow for catalog updates:**
1. Add/replace photocards via admin UI (phone or desktop).
2. Click **Publish Photocard Images** in Admin → Backup tab.
3. Guest's auto-sync on next page load picks up changes; banner shows
   "Checking for updates…" then library refreshes in place.

**Memory updated:**
- `project_railway_deploy_time.md` — Railway incident resolved,
  deploys back to ~30-90s.

**Status:**

| # | Phase | Status |
|---|---|---|
| 0-5 | All earlier guest phases | done |
| 6 | Path-mounted guest at apex /guest/ | **LIVE 2026-04-26** |
| 7 | Full guest UI + first-real-device fixes | **LIVE 2026-04-26** |
| 4b | Guest-added cards | still deferred (no real-world signal yet) |

**Next steps (open):** (superseded — see 2026-04-27 entry above)

---

### 2026-04-26 (later) — Guest webview Phase 6 prep v2: pivot to path-based mount

User hit Railway's 2-custom-domain limit (api.* + apex are both consumed).
Adding `guest.collectcoreapp.com` as a third would have required a paid
tier upgrade. Pivoted from subdomain mount to path mount:
**`collectcoreapp.com/guest/`** instead of `guest.collectcoreapp.com`.

**Why path-based won the redesign decision:**
- Lower blast radius vs the alternative (drop `api.collectcoreapp.com`,
  same-origin everything) which would have touched all 140+ API call
  sites + the Host-disambiguation logic in spa_host_routing that keeps
  /photocards SPA route from colliding with /photocards API endpoint.
- Reversible — remove the CF Access bypass app and `/guest/*` re-gates
  itself. Easy git revert if the bundle itself breaks.
- ~3 small file edits, plus runbook + docs.
- Doesn't disturb the api/apex/CF-Access-cookie split that's been
  working since 2026-04-25.

**Code changes:**
- [vite.config.js](frontend/vite.config.js): guest mode now builds with
  `base: '/guest/'`. The bundle's `index.html` references
  `/guest/guest-assets/...` instead of `/guest-assets/...`.
- [main.jsx](frontend/src/main.jsx): `BrowserRouter` reads
  `import.meta.env.BASE_URL` (set by Vite from the `base` config) and
  passes it as `basename` (with trailing slash stripped). Admin gets
  `undefined`; guest gets `/guest`. React Router knows where it's mounted.
- [backend/main.py](backend/main.py): `spa_host_routing` middleware
  rewritten to route by **path prefix** instead of Host header. Any GET
  to `/guest` or `/guest/...` (that isn't a static asset) returns the
  guest bundle's `index.html`. Apex root continues to serve admin's.
  `_GUEST_HOST_PREFIXES` constant removed; `_GUEST_PATH_PREFIX = "/guest"`
  added. Passthrough prefixes updated: `/guest/guest-assets/` and
  `/guest/vite.svg` added.
- [backend/routers/admin.py](backend/routers/admin.py):
  `register_frontend_static` mounts `/guest/guest-assets` (was
  `/guest-assets`). New explicit `/guest/vite.svg` route serves the
  guest favicon (falls back to admin's if guest dist missing).
- [docs/guest_deploy_runbook.md](docs/guest_deploy_runbook.md):
  rewritten end-to-end. Steps 2 (DNS) and 4 (CORS) now no-ops; steps
  3 (CF Access) simplified to just adding one bypass app for the
  `/guest` path. Smoke test rewritten for the new URL shape.
- [CLAUDE.md](CLAUDE.md): custom-domains list, hosting section, and
  multi-user model section all updated to reflect path-based mount.
  `guest.collectcoreapp.com` references removed.

**Verified:** admin build (623KB main, no sqlite-wasm, references
`/assets/`); guest build (596KB main + 864KB wasm, references
`/guest/guest-assets/`). No URL collision, both bundles tree-shake
correctly.

**Untouched by this pivot:** Phase 2/3/4a/5/7 work all still applies.
Only the deploy plumbing changed.

---

### 2026-04-26 (later) — Guest webview Phase 7: full guest UI

Path A landed (one PhotocardLibraryPage with data-source adapters), with a
forked detail modal because the admin editor and guest annotator are
fundamentally different UX. **Untested on dev hardware** (leaked-SAH
state from Phase 1b/2/3 still present); verification waits for Phase 6
deploy + real-device session.

**7a — First-run + auto-launch flow** in
[GuestBootstrap.jsx](frontend/src/guest/GuestBootstrap.jsx):
- Wraps the entire app for `!VITE_IS_ADMIN` builds via lazy + env-gated
  import in [App.jsx](frontend/src/App.jsx). Constant-folds out of admin
  bundles (verified: admin dist still 623KB, no sqlite-wasm).
- Boot phases: init worker → if no catalog, fetch + import seed.db with
  splash + spinner → silent background `syncCatalog()` → if
  `guest_meta.welcome_dismissed` not set, show Welcome modal once.
- [WelcomeModal.jsx](frontend/src/guest/WelcomeModal.jsx) uses the
  approved 2026-04-24 copy (Q13 in `fancy-stirring-hollerith.md`),
  trimmed: dropped Inbox section (Phase 4b deferred) and Sharing section
  (PD2 Trading deferred). Same component re-used as the Help dialog
  from the hamburger menu.
- Memory-mode banner displayed at top of screen when SAHPool fell back.

**7b — Library data adapters** in
[guestData.js](frontend/src/guest/guestData.js) +
[api.js](frontend/src/api.js):
- 6 read functions adapted: `listPhotocards`, `fetchPhotocardGroups`,
  `fetchPhotocardMembers`, `fetchPhotocardSourceOrigins`,
  `fetchTopLevelCategories`, `fetchOwnershipStatuses`. Each delegates
  to `guestData.js` when `_guestData` is non-null (constant-folded
  per-build). Admin path unchanged; existing isAdmin Catalog-status
  filter preserved on the admin branch.
- `listPhotocards()` mirrors admin's denormalized response shape
  exactly so `PhotocardLibraryPage` doesn't branch on data shape, only
  on which adapter is called. Synthesizes `copies: []` (real copies
  come from `guest_card_copies`); a card with no guest copies just has
  empty copies, and the library renders accordingly.
- Library page changes: hide Sort dropdown (per
  `project_guest_ui_simplifications` memory), hide Select / Bulk Edit /
  Admin DetailModal when `!isAdmin`. Default ownership filter for guests
  excludes the Catalog status (per user requirement: "Catalog items are
  excluded from current view unless specifically filtered upon"). Only
  fires on first mount when no stored filter state — preserves user's
  later choices.

**7c — Guest detail modal** in
[GuestPhotocardDetailModal.jsx](frontend/src/guest/GuestPhotocardDetailModal.jsx):
- Read-only catalog metadata (group, members, source, version, category,
  notes, front + back covers).
- Writeable per-copy section: list existing `guest_card_copies`,
  status+notes editor per row, Remove button, "Add copy as: [status
  buttons]" footer.
- Owned/Wanted mutual exclusion enforced client-side, mirroring admin's
  server-side `_check_owned_wanted_conflict`. Pickers show the opposing
  status as disabled when the other already exists.

**7d — Hamburger menu items** in
[GuestMenuItems.jsx](frontend/src/guest/GuestMenuItems.jsx):
- Help → re-shows Welcome modal (with "Got it" CTA instead of "Get
  started"). Doesn't reset the dismissed flag.
- Refresh catalog → calls `syncCatalog()` with status feedback; manual
  fallback for the silent auto-sync that runs on every launch.
- Backup → builds JSON snapshot, triggers file download
  (`collectcore-guest-backup-{iso}.json`).
- Restore → file picker → `restoreGuestBackup()` after confirm prompt.
  Replace strategy with rollback-on-error (worker SAVEPOINT).
- Status line: storage mode warning, last catalog version synced, last
  backup timestamp (relative).
- TopNav also gates Admin link + Exit button on `isAdmin` (legacy
  desktop-installer shutdown). `fetchSettings()` skipped entirely for
  guest (single-module build, no `/admin/settings` to call — avoids
  401 noise on every page load).

**Deviations from Capacitor-era plan (Q13/Q14/Q15):**
- Q14 said no backup/restore UI in v1 → re-included for web because
  OPFS is more fragile than mobile app storage. User agreed.
- Q14 said no manual refresh button → re-included as fallback for
  silent auto-sync. User agreed.
- Q13 long-press cycle to set ownership → skipped for v1; tap → detail
  modal where status is editable. Touch-only ergonomics weaker on web
  with mixed mouse/touch users.
- Welcome copy trimmed: Inbox section removed (Phase 4b deferred,
  guest-added cards) and Sharing section removed (PD2 Trading deferred).

**Verified:**
- Admin: `npm run build` → 623KB, NO sqlite-wasm, NO guest chunks.
  Constant-fold elimination working as intended for every guest
  import (App, library page, TopNav).
- Guest: `npm run build:guest` → 596KB main + 864KB wasm + properly
  split chunks (WelcomeModal, GuestBootstrap, GuestMenuItems,
  sqliteService, guestData, GuestPhotocardDetailModal).

**Phase 4b (guest-added cards) still deferred** per user — first ship
read-only catalog + annotations, add guest-added in a follow-up once
real-world need is confirmed.

**Next:** Phase 6 deploy execution per
[guest_deploy_runbook.md](docs/guest_deploy_runbook.md). All code
prerequisites met.

---

### 2026-04-26 (later) — Guest webview Phase 6 prep: deploy plumbing

Code-side prep so a future deploy of `guest.collectcoreapp.com` is one
git push + a few CF/Railway clicks. **Nothing live yet** — guest bundle
is still untracked, no DNS, no CF Access app. Runbook
([docs/guest_deploy_runbook.md](docs/guest_deploy_runbook.md)) is the
deploy-time checklist.

- **Asset path collision avoided.** Both bundles previously emitted to
  `assets/`. The same Railway service can't serve `/assets/index-XXX.js`
  for two different files. Fix: guest build now uses `assetsDir:
  'guest-assets'` ([vite.config.js](frontend/vite.config.js)), so its
  index.html references `/guest-assets/index-XXX.js`. Admin unchanged.
- **Host-routed SPA fallback** in
  [backend/main.py](backend/main.py): `spa_host_routing` middleware now
  serves `frontend_dist_guest/index.html` when Host starts with `guest.`.
  `_GUEST_HOST_PREFIXES = ("guest.",)`; `/guest-assets/` added to
  `_SPA_PASSTHROUGH_PREFIXES`. Static assets are URL-disambiguated so
  the middleware only host-routes the catchall index.html, not every
  asset request.
- **Static mount** in
  [backend/routers/admin.py](backend/routers/admin.py):
  `register_frontend_static` extended to also mount `/guest-assets`
  from `frontend_dist_guest/guest-assets/` when that dir exists. New
  `FRONTEND_DIST_GUEST` constant exported for the middleware. Guarded
  on `.exists()` so deploys without the guest bundle still boot.
- **Verified both builds clean.** Admin: `frontend_dist/assets/` (623KB).
  Guest: `frontend_dist_guest/guest-assets/` (623KB). No collision —
  identical filenames coincidentally identical because the React app
  is the same; production guest will diverge once a real guest UI
  lands.

**Pre-deploy gate:** the guest bundle currently only has the dev-only
`/_guest_debug` route — production guest at `guest.collectcoreapp.com/`
would render a blank page. Don't deploy until either (a) an actual guest
library page exists, or (b) you're OK with a placeholder. The runbook
calls this out.

`npm run build` (admin) and `npm run build:guest` both clean.

---

### 2026-04-26 (later) — Guest webview Phase 5: backup / restore

JSON snapshot in/out for every `guest_%` table. No UI surface yet — same
service-layer-only pattern as Phases 3/4a. The future guest UI will wire
these to a file download + `<input type="file">` restore.

- **`exportGuestData` / `importGuestData` worker handlers** in
  [sqliteWorker.js](frontend/src/guest/sqliteWorker.js). Tables discovered
  dynamically from `sqlite_master WHERE name LIKE 'guest_%'` so Phase 4b's
  `guest_added_*` tables get included automatically when they land —
  no code change needed.
- **Snapshot format:** `{ version: 1, exported_at, tables: { table_name:
  [...rows] } }`. Versioned for future schema migrations. Rows are plain
  objects keyed by column name.
- **Restore is replace-strategy** (DELETE all guest_% tables, then INSERT
  from snapshot). SAVEPOINT-wrapped — a malformed payload rolls back and
  preserves existing data. Authoritative column list comes from the
  destination table (via `PRAGMA table_info`), not the payload, so old
  snapshots survive ALTER TABLE additions cleanly.
- **`guest_meta.last_backed_up_at`** stamped on successful export. Powers
  the future "Last backed up: N days ago" UI nudge.
- **Service exports** in [sqliteService.js](frontend/src/guest/sqliteService.js):
  `exportGuestBackup()`, `restoreGuestBackup(snapshot)`, `getLastBackupAt()`.

**Phase plan complete except Phase 6 (DNS + deploy) and Phase 7 (UI
polish).** Phase 7 needs a guest library page to polish; the actual
guest library page isn't on the plan yet — implicit assumption was that
guest reuses the admin React app gated by `VITE_IS_ADMIN`, but the admin
library hits the API and the guest has no API. Worth a session to scope
"build the guest library page" before Phase 7 makes sense. Phase 6 can
proceed independently whenever ready.

`npm run build:guest` clean (623KB / 149KB gzipped, no regression).

---

### 2026-04-26 (later) — Guest webview Phase 4a: per-card annotations

Schema + service helpers for guest's per-card ownership/notes overlay on
catalog cards. No UI surface yet — there's no guest library page to
consume it. Phase 4b (guest-added cards) deferred until that page exists.

- **`guest_card_copies` table** in
  [sqliteWorker.js:ensureGuestSchema](frontend/src/guest/sqliteWorker.js):
  mirrors admin's `tbl_photocard_copies` model (multi-copy per card with
  Owned/Wanted/etc.) but keyed by `catalog_item_id` (TEXT, the
  contractually-stable `{group_code}_{id:06d}` key) instead of `item_id`.
  Survives a full seed reset. FK into the synced `lkup_ownership_statuses`
  so guest pickers reuse admin's vocabulary.
- **`v_guest_library_photocards` view** — read target for the future
  guest library. Joins catalog `tbl_items` + `tbl_photocard_details`
  with LEFT JOIN `guest_card_copies` so untouched catalog cards still
  appear (with `guest_*` columns NULL). Phase 4b will UNION ALL
  guest-added cards in. The `collection_type_id` filter resolves the
  photocards id via subquery rather than hardcoding 1, since that ID
  isn't schema-guaranteed.
- **Service helpers** in
  [sqliteService.js](frontend/src/guest/sqliteService.js):
  `addGuestCardCopy`, `updateGuestCardCopy`, `deleteGuestCardCopy`,
  `listGuestCopiesForCard`. Standard CRUD; the eventual guest library
  + detail modal will consume these.
- **No debug-page exposure** — same call as Phase 3. User won't test on
  dev machine; verification waits for Phase 6 real-device session.

**Phase 4b scope decisions made (deferred until needed):**
- Flat `guest_added_photocards` table (not a parallel `guest_items` /
  `guest_photocard_details` mirror)
- `guest_added_attachments` for local-only images (R2 upload not in
  scope for guests, ever — local-only is the permanent design)
- `guest_added_members_xref` for member tags
- `v_guest_library_photocards` extended with UNION ALL of guest-added

`npm run build:guest` clean (623KB / 149KB gzipped, no regression vs
Phase 3). Next: Phase 5 (backup/restore of guest_* rows) per the plan,
or move to building the actual guest library page so Phase 4b has a
consumer.

---

### 2026-04-26 (later) — Guest webview Phase 3: delta sync

Catalog refresh path is now end-to-end code-complete. Untested on the dev
machine for the same reason as Phases 1b/2 (leaked SAH state forces
in-memory mode); will be verified together on real device at Phase 6.

- **`/catalog/delta?since=N` rewritten** in
  [backend/routers/catalog.py](backend/routers/catalog.py) to return raw
  table-row deltas instead of the original denormalized JSON. The
  pre-pivot shape (joined `category_name`, `source_origin_name`, member
  arrays, attachment URLs) was designed for a Capacitor render-from-JSON
  client that never shipped — confirmed via git blame (added 2026-04-24
  in phase 0b) and grep (zero frontend callers). Replaying it into the
  guest's normalized SQLite mirror would have required ugly reverse-joins;
  raw rows go straight through `INSERT OR REPLACE`.
- **Payload shape:** `{ since, max_version, tables: { tbl_items,
  tbl_photocard_details, xref_photocard_members, tbl_attachments,
  lkup_photocard_groups, lkup_photocard_source_origins,
  lkup_photocard_members, lkup_top_level_categories } }`. Lookup tables
  ship only the rows referenced by changed items (avoids re-shipping the
  full lookup set every sync).
- **Worker `applyCatalogDelta`** in
  [sqliteWorker.js](frontend/src/guest/sqliteWorker.js): wraps the
  apply in a SAVEPOINT for transactional rollback. Order: lookups →
  items → details → (delete-by-item then reinsert) xrefs + attachments.
  The delete-then-reinsert pattern handles removed members and replaced
  attachments correctly — the endpoint sends the full current set per
  touched item, so absence == removal.
- **Service `syncCatalog()`** in
  [sqliteService.js](frontend/src/guest/sqliteService.js): reads the
  cursor from `guest_meta.last_synced_catalog_version`, fetches the
  delta, calls the worker, advances the cursor to the server's
  `max_version`. Cursor only advances on successful apply, so a network
  or apply failure is safely retryable. First sync after a fresh seed
  derives the cursor from local `MAX(catalog_version)` so we don't
  redundantly re-fetch every row already in the seed. Also exports
  `getLastSyncedVersion()` for read-only inspection.
- **No debug-page UI added** — user will not exercise this path on the
  dev machine. The real "Refresh catalog" button lives in the actual
  guest UI in a later phase. Service-layer API is the only Phase 3
  surface.

**Tombstones deferred.** Admin has no remove-from-catalog flow today, so
items only ever get added/updated. When the admin publish UI lands (PD1),
a `tombstones` key carrying `catalog_item_id` values to delete locally
will be added. Documented in CLAUDE.md catalog architecture section as
a known limitation, plus the related lookup-edit-without-item-bump gap
(pure lookup edits like a group rename won't propagate until something
forces a related item's catalog_version to bump).

`npm run build:guest` clean (623KB / 149KB gzipped, no chunk-size
regression vs Phase 2). Phases 1b/2/3 all share the same real-device
verification window.

---

### 2026-04-26 (later) — Guest webview Phase 2: schema-separation contract + storage persist

Lays the foundation Phase 3 (delta sync) needs: a stable convention for which
tables sync is allowed to overwrite, plus a request for the browser to mark
our OPFS storage as durable.

- **Convention:** anything prefixed `guest_` is guest-owned and untouchable
  by sync. Everything else is catalog data and fair game for delta INSERT/
  UPDATE/DELETE. Catalog tables are NOT renamed — `tbl_items` etc. stay as
  they are; the prefix only applies to new guest-side tables. This matches
  the original 2026-04-23 catalog architecture decision (no separate
  `tbl_catalog_items`; admin's `tbl_items` IS the catalog).
- **`guest_meta(key TEXT PRIMARY KEY, value TEXT)`** — only guest table for
  now. Holds the `last_synced_catalog_version` marker that Phase 3 will
  read/write. Annotation tables (per-card ownership, notes) deferred to
  Phase 4 where they pair with UI.
- **Migration runner** in [sqliteWorker.js](frontend/src/guest/sqliteWorker.js):
  `ensureGuestSchema()` runs `CREATE TABLE IF NOT EXISTS` after both DB
  open paths — post-init reopen-from-OPFS AND post-loadSeed fresh import.
  Idempotent.
- **`navigator.storage.persist()`** called on first `initSqlite()` from the
  main thread (window-only API). Result surfaced as `persistGranted` in the
  init payload. Failures are non-fatal — guest still works, OPFS just
  becomes evictable under disk pressure.
- **New service exports** in [sqliteService.js](frontend/src/guest/sqliteService.js):
  `getGuestMeta(key)` / `setGuestMeta(key, value)` / `getPersistGranted()`.
- **Debug page** ([GuestDebugPage.jsx](frontend/src/guest/GuestDebugPage.jsx))
  gains: persist state in the header line, and a "Phase 2 — guest_meta
  survival test" section. Workflow: Write timestamp → Load seed (full
  catalog overwrite) → Read. Same timestamp must come back to prove the
  contract.

`npm run build:guest` confirms the changes compile; the guest production
bundle still excludes the debug page + worker chunk via the existing
`import.meta.env.DEV` gate. Phase 3 (delta sync) is unblocked.

**Survival test unverified on real hardware.** Dev machine still has the
leaked-SAH state from Phase 1b, so the worker keeps falling back to memory
mode and the survival test can't be exercised end-to-end here. Verify
during Phase 6 real-device testing alongside the Phase 1b persistence
check — the two checks share the same recovery path (close other tabs /
restart browser) and both confirm the same OPFS-survives-reload contract.

---

### 2026-04-26 (later) — Guest webview Phase 1b: SAHPool worker + memory fallback

Dedicated worker now owns the sqlite3 runtime and a SAHPool-backed catalog
DB. Persistence path is code-complete but **not yet verified on real
hardware** — see "Persistence verification" below.

- New [frontend/src/guest/sqliteWorker.js](frontend/src/guest/sqliteWorker.js):
  installs `OpfsSAHPoolVfs({ name: 'guest-pool' })`, opens existing
  `/catalog.db` from the pool on init if present, accepts seed bytes via
  `loadSeed` and `importDb()`s them. Includes retry-with-backoff on the
  install (handles leak briefly across HMR), `pauseVfs` on
  `import.meta.hot.dispose`, and a `nukeOpfs` escape hatch that deletes
  the pool directory via the raw OPFS API.
- [frontend/src/guest/sqliteService.js](frontend/src/guest/sqliteService.js)
  rewritten as a worker-RPC proxy. `query()` and `isLoaded()` are now
  async (forced by the worker boundary). New `getStorageMode()` /
  `getFallbackReason()` / `nukeOpfsAndReset()` exports. ArrayBuffer is
  transferred (not copied) on seed load.
- [frontend/vite.config.js](frontend/vite.config.js) gains
  `worker: { format: 'es' }` so production worker bundles stay ESM
  (default would be IIFE, which can't `import` sqlite-wasm).
- [frontend/src/guest/GuestDebugPage.jsx](frontend/src/guest/GuestDebugPage.jsx)
  auto-runs init on mount, surfaces `storageMode` + `hasCatalog`, shows a
  yellow "In-memory mode" banner when SAHPool fails. New "Re-check init",
  "Clear OPFS", and "Nuke OPFS pool" buttons.

**SAHPool single-tenant fallback (Option 1 from this session's discussion):**
SAHPool is single-tenant per origin/directory by design — a second tab on
the same origin can't acquire the slot SAHs. Rather than fight this, the
worker now catches the install error and falls back to a Phase-1a-style
in-memory DB. The page stays functional; the banner tells the user that
data won't survive a reload until the conflict clears. Same path covers
Chrome's occasional handle-leak behavior across HMR cycles.

**Persistence verification deferred:** dev environment is currently stuck
in the leaked-handles state and won't release without a full browser
restart, which the user opted not to do. The persistence code path is
~6 lines of SAHPool API calls with no runtime branching consumed by
downstream phases, so verification is safe to defer to real-device
testing. Phases 2–5 build against the in-memory fallback unchanged.

---

### 2026-04-26 — Guest webview Phase 1a: sqlite-wasm proof-of-life

In-memory load + query verified working in dev. Persistence (OPFS) deferred
to Phase 1b.

- Installed `@sqlite.org/sqlite-wasm@3.53.0-build1`. Added
  `optimizeDeps.exclude: ['@sqlite.org/sqlite-wasm']` to vite.config.js so
  Vite's pre-bundling doesn't break the package's relative WASM loader.
- New [frontend/src/guest/sqliteService.js](frontend/src/guest/sqliteService.js):
  init the runtime, fetch `/catalog/seed.db`, deserialize bytes into an
  in-memory DB via `sqlite3_deserialize`, expose `query()`. Returns plain
  row objects.
- New [frontend/src/guest/GuestDebugPage.jsx](frontend/src/guest/GuestDebugPage.jsx):
  4-step manual test (init / load seed / count / sample 5 newest). Used to
  prove out the integration; will be replaced as the real guest UI lands.
- Route mounted at `/_guest_debug` in App.jsx, gated behind
  `import.meta.env.DEV`. The lazy import is also gated:
  `import.meta.env.DEV ? lazy(() => import("./guest/GuestDebugPage")) : null`
  so production admin builds eliminate the dynamic import entirely — no
  GuestDebugPage chunk and no sqlite3.wasm asset emitted (verified).

**Bug fixed in passing:** `SEED_DB_PATH` in
[backend/routers/catalog.py](backend/routers/catalog.py) was
`DATA_ROOT / "mobile_seed.db"`, but the file actually lives at
`DATA_ROOT / "data" / "mobile_seed.db"` per the same convention as
`db.py:17` (`DB_PATH = DATA_ROOT / "data" / "collectcore.db"`). Fixed,
plus reordered the local-file check to come BEFORE the R2 redirect — so
local dev serves the file directly instead of redirecting cross-origin
to R2 (which would fail CORS on localhost). Production (Railway) has no
local file and falls through to the R2 redirect as before.

---

### 2026-04-25 — Guest webview Phase 0: build skeleton

Set up the scaffolding for a separate guest bundle so admin mutation code
physically cannot ship in the guest build (defense against accidental
writes, not adversarial).

- New `frontend/.env.guest` with `VITE_IS_ADMIN=false` +
  `VITE_API_BASE_URL=https://api.collectcoreapp.com`. Loads only when
  Vite's `--mode guest` is used; mode-specific files outrank `.env.local`
  per Vite's priority order.
- `npm run build:guest` script (`vite build --mode guest`).
- `vite.config.js` routes `mode === 'guest'` to
  `backend/frontend_dist_guest/` (separate from admin's `frontend_dist/`).
- [utils/env.js](frontend/src/utils/env.js) `isAdmin` simplified from
  `String(import.meta.env.VITE_IS_ADMIN ?? "").toLowerCase() === "true"` to
  `import.meta.env.VITE_IS_ADMIN === "true"` so Rollup can constant-fold
  it. Verified: the catalog-status filter at api.js:39-41 (gated on
  `isAdmin`) is dead-code-eliminated from the guest bundle (admin bundle
  has 2 occurrences of `'catalog'` literal, guest has 1 — the surviving
  one is just `/catalog/*` endpoint paths).
- `backend/frontend_dist_guest/` is untracked for now; will commit at
  Phase 6 deploy time.

Next (Phase 1): WASM SQLite proof-of-life. Pick library, download
`/catalog/seed.db`, persist to OPFS, render a minimal photocard library
reading from local DB.

---

### 2026-04-25 — Inbox upload icon + drawer freshness fix

- Photocard Inbox: drag-drop UploadZone removed on mobile (no use case on
  touch devices). Replaced with an Upload icon in the TopNav right cluster
  via the page-actions context. Tap → OS file chooser; icon shows active
  state during upload. Added `iconName: 'upload'` to TopNav's ICONS map.
- TopNav now refetches `modules_enabled` on drawer open AND on
  `visibilitychange`, in addition to the existing in-session
  `collectcore:modules-changed` listener. Fixes a stale-list bug where the
  drawer showed only the modules enabled at the time of the initial bundle
  load — toggles made in a different browser, before the latest deploy, or
  before the cached bundle hydrated weren't reflected.
- User confirmed forms look good across modules, no further detail-page
  tweaks needed at this time.

---

### 2026-04-25 (later) — Photocard Inbox mobile layout

Mobile-only branch in
[InboxPage.jsx](frontend/src/pages/InboxPage.jsx) gated by
`useMediaQuery(MOBILE_BREAKPOINT)`; desktop layout untouched.

- Horizontal scrollable thumbnail strip replaces the desktop 220px left rail.
  Image-only thumbs (no filenames). F/B badge top-right (tap to toggle side
  without selecting), ✕ remove top-left, body tap selects.
- Selected thumb grows in-place to 100×154 (~2:3 photocard aspect ratio);
  unselected stay 64×64 square. Strip auto-grows to fit; smaller thumbs
  center-align against the larger one. Replaces a separate preview area
  entirely — saves vertical space for keyboard.
- Thin status row beneath strip shows just the Front/Back/Pair badge or the
  invalid-pair alert.
- Form fields stack single-column, full-width, with bumped tap targets.
  Sticky bottom action bar (`position: sticky; bottom: 0`) with full-width
  primary button (Ingest as Front / Attach Back / Ingest as Front + Back).

**Two unrelated bugs surfaced + fixed during this work:**
- `from main import _PHOTOCARD_SELECT, …` in
  [ingest.py:229](backend/routers/ingest.py#L229) and
  [export.py:140](backend/routers/export.py#L140) was stale — those helpers
  live in `routers/photocards.py`. ImportError at request time → 500 on
  `/ingest/candidates` and `/export/photocards`. Fixed both imports.
- `libraryImageUrl()` in
  [InboxPage.jsx](frontend/src/pages/InboxPage.jsx) was prepending
  `${API_BASE}/` to every `front_image_path`, but post-cutover those are full
  R2 URLs. Added a `^https?://` passthrough — same pattern as
  `resolveCardSrc()` in PhotocardGrid.

---

### 2026-04-25 (later) — Sort + Select icons in TopNav (photocards)

- New `PageActionsContext`
  ([PageActionsContext.jsx](frontend/src/contexts/PageActionsContext.jsx))
  with `usePageActions(actions, deps)` for pages and `usePageActionsList()`
  for TopNav. Action shape: `{ id, iconName, kind: 'menu' | 'toggle', label, … }`.
  TopNav owns the SVG icons (`sort`, `select`) and the popover renderer.
  Provider wraps the tree in
  [AppShell.jsx](frontend/src/components/layout/AppShell.jsx).
- TopNav renders registered actions in the mobile right cluster, before the
  filter icon. `kind: 'menu'` opens an anchored popover (click-outside +
  route-change dismiss); `kind: 'toggle'` is a stateful icon.
- [PhotocardLibraryPage.jsx](frontend/src/pages/PhotocardLibraryPage.jsx)
  registers Sort + Select via `usePageActions`. Desktop Sort dropdown +
  Select button got `desktop-only` so they hide on mobile. Select icon is a
  toggle: tapping while in select mode calls `exitSelectMode()`, doubling as
  Done.
- Layout fix: card count was getting bumped to the same wrapped row as the
  All/Clear/Bulk Edit/Done buttons on mobile. Split the select-mode buttons
  into their own `selectBar` row beneath the main controls bar so the card
  count stays anchored under the TopNav icons.

---

### 2026-04-25 (later) — Photocard bulk edit modal on mobile

- [PhotocardBulkEdit.jsx](frontend/src/components/photocard/PhotocardBulkEdit.jsx)
  was the only module still rendering bulk edit as an inline 420px flex sibling
  of the grid (`bulkEditArea` inside library `body`). On phones the right edge
  was cut off. Migrated to the shared `<Modal size="sm">` primitive — same
  pattern as the other 7 modules — which auto-fullscreens at ≤640px via
  `.cc-modal`. In [PhotocardLibraryPage.jsx](frontend/src/pages/PhotocardLibraryPage.jsx)
  the bulk edit now renders at top level next to `PhotocardDetailModal`; the
  `bulkEditArea` style entry was deleted.
- Audit of the other 7 modules confirmed they already use `<Modal>` for bulk
  edit, so no further fixes needed for next-step item #1.

---

### 2026-04-25 — Cloudflare Access live + responsive web Phase 1 (all 8 modules)

Two big landings: the auth gate is fully live, and responsive Phase 1 shipped
across every module library.

**Auth gate (Cloudflare Access):**
- Two Self-hosted Applications: main app (apex + `api.`) gated by Google IdP
  with 1-month sessions; secondary app (`api.collectcoreapp.com/catalog`) with
  Bypass policy. Cloudflare evaluates the more-specific destination first, so
  /catalog/* hits the bypass and everything else is gated. (Reusable Policies
  model has no path/hostname filter on the policy itself — destination-scoped
  only, which is why two apps are required.)
- CORS Allow Credentials ON, allowed origin `https://collectcoreapp.com`,
  "Allow all methods" (per-method list lacked OPTIONS, breaking preflight).
- Code: `allow_credentials=True` on backend CORSMiddleware; frontend
  [api.js](frontend/src/api.js#L5) shadows `fetch` to default
  `credentials: 'include'` (covers all 140 fetch calls).

**Responsive Phase 1 — mobile chrome:**
- TopNav on mobile: hamburger left, brand center, funnel-filter right (funnel
  only renders when current page has a filter sidebar). Filter sidebar moved
  into a slide-in drawer (right) and main nav into a slide-in drawer (left).
  Communication via `collectcore:filters-available` / `collectcore:filters-toggle`
  custom events — no shared store.
- Drawers dismiss via backdrop tap / ESC only (no close X — was confusing
  alongside filter-clear X). Drawer width 170px (40% trim from initial 280).
- `.cc-modal` primitive collapses to fullscreen at ≤640px — auto-applies
  to every detail modal across all 8 modules.

**Responsive Phase 1 — library grids (all 8 modules):**
- Cards-per-row stepper (− N +, range 2–8) replaces SIZE picker. Persisted
  to localStorage in
  [photocardPageState.js](frontend/src/photocardPageState.js#L1).
- Infinite scroll (30 initial, +30 per batch) replaces pagination. Uses
  IntersectionObserver with the closest scrollable ancestor as `root`
  (default viewport doesn't work — scrolling happens inside an inner
  `gridArea` div).
- Grid switches from flex-wrap to CSS grid; cells use `aspect-ratio` so
  heights derive from container width — no fixed pixel sizing on mobile.
- Photocard badges scale via container queries (`cqw` units).
- Forced fronts-only viewMode on mobile photocards (consistent column widths).

**Bugs fixed in Phase 1:**
- GN + Music wrap their FilterSidebarShell in a fixed-width 220px outer div.
  Inner shell goes `position: fixed` on mobile but the wrapper stayed in flex
  flow → 220px gap. Fix: `library-sidebar-wrap` class with
  `display: contents !important` on mobile.
- Ownership badge appeared upper-left on mobile (non-photocard modules).
  Cause: shared CSS rule `.cc-mobile-grid-cell__cover > div { 100%×100% }`
  was matching absolute-positioned overlays, overriding the wrapper's
  `bottom: 4` anchor. Fix: scoped to `> div:not([style*="absolute"])` so
  only the No-Cover placeholder stretches
  ([app.css:978](frontend/src/styles/app.css#L978)).

**Memory captured:**
[`project_guest_ui_simplifications.md`](C:/Users/world/.claude/projects/c--Dev-CollectCore/memory/project_guest_ui_simplifications.md)
tracks admin-only controls to hide in the guest build. First entry: photocard
SORT dropdown (filtering is the right primitive at 10K+ scale).

**Status:** Apex auth fully live. Responsive Phase 1 complete across all 8
modules — shared filter drawer, full-screen modals, cards-per-row + infinite
scroll on every library grid, mobile-correct ownership badges.

---

### Next steps

**Active track: Guest webview.** Phase plan (in CLAUDE.md memory under the
guest project track):

| # | Phase | Status |
|---|---|---|
| 0 | Build skeleton (separate guest dist, VITE_IS_ADMIN gate, DCE-friendly isAdmin expression) | done 2026-04-25 |
| 1a | sqlite-wasm proof-of-life: download seed.db, deserialize, query | done 2026-04-26 |
| 1b | OPFS SAHPool persistence: dedicated worker + in-memory fallback for single-tenant conflicts | code-complete 2026-04-26; persistence unverified (dev machine has leaked handles) — verify on real device before Phase 6 |
| 2 | Schema separation: `guest_` prefix = sync-untouchable; rest is catalog. `guest_meta` table seeded. `navigator.storage.persist()` on first launch. | code-complete 2026-04-26; survival test unverified (dev stuck in memory-mode fallback) — verify on real device with Phase 1b |
| 3 | Delta sync — only touches catalog tables (i.e. anything not prefixed `guest_`). Service-layer `syncCatalog()` reads/writes `guest_meta.last_synced_catalog_version`; UI button deferred to Phase 7. Tombstones deferred (no admin remove-from-catalog flow). | code-complete 2026-04-26; verify with Phases 1b/2 on real device |
| 4a | Per-card annotations (`guest_card_copies` keyed by catalog_item_id, mirrors admin multi-copy model) + `v_guest_library_photocards` view. Service-layer CRUD only; no UI consumer yet. | code-complete 2026-04-26; verify with Phases 1b/2/3 on real device |
| 4b | Guest-added cards: flat `guest_added_photocards` + `guest_added_attachments` (local images only) + `guest_added_members_xref`. UNION ALL into the library view. | deferred until guest library page exists |
| 5 | Backup/restore: export `guest_*` rows as JSON, import inverse. Service-layer + `last_backed_up_at` cursor done; "Last backed up: N days ago" UI deferred to Phase 7 alongside the rest of guest UI work. | code-complete 2026-04-26; verify on real device |
| 6 | Path-mounted guest at `collectcoreapp.com/guest/` (pivoted from `guest.` subdomain — Railway free tier custom-domain limit). Code prep done 2026-04-26 v2 (vite base + assetsDir, basename'd BrowserRouter, path-routing middleware, static mount). Deploy is one CF Access bypass app per `docs/guest_deploy_runbook.md`. | code prep done; awaiting deploy clicks |
| 7 | Full guest UI: first-run flow + welcome modal (7a), library data adapters + filter defaults (7b), guest detail modal with copies CRUD (7c), hamburger menu Help/Refresh/Backup/Restore (7d). Path A — reuse PhotocardLibraryPage with data-source adapters; fork the detail modal. | code-complete 2026-04-26; verify on real device |

**Phase 1b implementation notes for resume:**
- SAHPool VFS is worker-only — needs a dedicated `sqliteWorker.js` in
  `frontend/src/guest/`.
- Worker installs SAHPool via `sqlite3.installOpfsSAHPoolVfs({ name: 'guest-pool' })`,
  then opens `'catalog.db'` from the pool.
- Seed import flow: main thread fetches `/catalog/seed.db` → posts bytes to
  worker → worker calls `sahPool.importDb('catalog.db', uint8Array)` → opens it.
- Subsequent loads: worker checks SAHPool for existing `catalog.db`, opens
  without import. Skip network entirely.
- Main-thread API stays the same shape (`init`, `loadSeed`, `query`,
  `isLoaded`) so `GuestDebugPage` only needs minor changes — add a "Reload
  from OPFS" button to verify persistence.

_(Closed 2026-04-25 — user has chosen not to pursue:_
- _Other ingest flows mobile pass (Books ISBN / Discogs / RAWG / BGG search modals)_
- _Admin page mobile pass_
- _Per-row stepper UX swap)_

_(Detail-page mobile pass: closed 2026-04-25 — user reviewed forms across
all modules and confirmed no tweaks needed.)_

_(Mobile table overflow intentionally kept as-is — horizontal scroll on
phones is acceptable for the table views.)_

---

### 2026-04-24 — Apex SPA cutover + auth pivot + mobile-vs-web architectural pivot

**Three architectural decisions landed in one session.** Canonical state lives
in `CLAUDE.md`; this entry preserves the reasoning.

1. **Desktop installer retired; SPA serves from Railway at apex.** Discovered
   the desktop-installer build script was dramatically out of date (only
   copied 6 backend files). User chose webview over fixing it: husband (and
   any admin) bookmarks `https://collectcoreapp.com`. Implementation: SPA
   built into `backend/frontend_dist/` (committed, ~640KB), served via
   `register_frontend_static()`. Critical piece is `spa_host_routing`
   middleware in [main.py](backend/main.py) — checks `Host` header, routes
   apex requests to `index.html` (else `/photocards` would hit the API
   router and return JSON). `api.*` and localhost pass through to API.
2. **Auth via Cloudflare Access + Google IdP.** Apex SPA was open to the
   internet after the cutover. Chose Cloudflare Access over Auth0/Clerk:
   already in CF ecosystem, free 50-user tier, zero code changes (gating at
   edge), trivially reversible. `/catalog/*` bypassed for future guests.
3. **Capacitor mobile indefinitely deferred; guests get web too.** Discovered
   WASM SQLite (sqlite-wasm/sql.js + OPFS) gives guests real local SQLite
   in-browser. Eliminates app-store distribution, instant updates, same
   codebase. iOS Safari storage policies fine at current ~10MB catalog.
   `mobile-shell` branch parked as reference (not deleted, not merged).

**Other completed work this session:**
- Lazy-load (`loading="lazy" decoding="async"`) added to
  [CoverThumb.jsx](frontend/src/components/primitives/CoverThumb.jsx#L17),
  cascading to all 7 non-photocard library + ingest covers.
- `api.collectcoreapp.com` custom domain on Railway via Cloudflare auto-config
  (orange cloud / Proxied works fine). All env files updated.
- `APP_ROOT → DATA_ROOT` fixes in [export.py:167,174](backend/routers/export.py#L167)
  and [ingest.py:407,457](backend/routers/ingest.py#L407) — local accident
  worked because `APP_ROOT == DATA_ROOT`; on Railway they diverge (`/` vs
  `/data`).

**Setup notes worth preserving:**
- Cloudflare Zero Trust team domain: `collectcore.cloudflareaccess.com`.
- Google OAuth client (project "CollectCore Auth"): Audience=External,
  Testing publishing status (Cloudflare allow-list is the actual gate;
  Testing avoids Google verification review). Test users: user + husband.
  Redirect URI: `https://collectcore.cloudflareaccess.com/cdn-cgi/access/callback`.
  Google IdP added under **Integrations → Identity providers** (Cloudflare
  moved this menu — NOT under Settings → Authentication).
- Railway env-var redeploy is flaky on auto; manual redeploy from the
  Deployments tab is more reliable.

---

### Completed to date (through 2026-04-24)

- All 8 modules v1-complete (Photocards, Books, Graphic Novels, Music,
  Video, Video Games, TTRPG, Board Games) — full CRUD, library, bulk edit,
  ingest. See `docs/collectcore_summary.md` for endpoint authority.
- Backend on Railway with `/data` volume; admin SQLite migrated from local;
  status-visibility seed bug fixed (was re-inserting deleted rows on every
  restart); 7 orphan xref rows from canonicalize migration cleaned up.
- All images on R2 via custom domain `images.collectcoreapp.com`:
  10,710 photocards under `catalog/images/`, 254 covers under `admin/images/`.
  CLI sweepers ([tools/publish_catalog.py](tools/publish_catalog.py),
  [tools/sync_admin_images.py](tools/sync_admin_images.py)) handle local→R2
  promotion (direct-to-R2 ingest is future work). Host-rewrite migration in
  `db.py` flipped 10,988 rows from `pub-*.r2.dev` to the custom domain.
- Catalog architecture: `catalog_item_id` + `catalog_version` on `tbl_items`,
  `Catalog` ownership status (photocards only), backend
  [catalog.py](backend/routers/catalog.py) endpoints, admin UI gated by
  `VITE_IS_ADMIN`.
- GN merge from husband's backup: 270 final items (246 + 25 new − 1 mine-only).
  Surfaced and fixed a `top_level_category_id` bug (every matched GN was
  pointing at "non-album" — leftover canonicalize-migration damage).
- `tbl_photocard_copies` migration: 10,015 photocards, 10,185 copies. Owned/
  Wanted mutual exclusion enforced. Grid badges, detail modal, filter/count,
  bulk edit all rewired to copies.
- Lookup admin/management UI on Admin page — view/edit/merge/re-activate/
  hard-delete for 38 lookup tables, with merge guards on 6 high-risk tables.
- Unified Status Visibility System (`xref_ownership_status_modules`,
  `xref_consumption_status_modules`); Admin grid for per-module visibility;
  per-module status endpoints removed in favor of `?collection_type_id=`.
- Shared FilterSidebar with tri-state toggles, CSS variable system, Inter
  font + green palette (light + dark mode), Admin Backup & Restore (SQLite
  hot-copy + images ZIP).
- Code quality Waves 1-4 (CORS hardened, file upload sanitization, dead-code
  purge, shared style constants/components, query consolidation, transactional
  error handling, `React.memo` on library item components).

**Disk leftovers safe to delete after a stable week:**
- `tmp_merge/`, `tools/merge_gn_from_backup.py`, `docs/collectcore_backup_20260424_192840.zip`
- `data/collectcore_pre_*.db` (pre-write backups)
- `images/library/` (~4 GB) — DB no longer references these
- `C:\Dev\CollectCore-Build\` — desktop installer scaffolding, retired
