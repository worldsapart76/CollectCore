# CollectCore — Session Notes

_Format: ### YYYY-MM-DD (US CDT) — brief completed / next summary_
_Keep last 3-5 sessions. Collapse older entries into "Completed to date" block._

> Update this section at the end of each working session with a brief
> summary of what was completed and what is next.

### 2026-09-03 (US CDT) — The ledger's buy side: how Neokyo purchases get logged

Started as a question — "how am I supposed to log actual Neokyo purchases?" —
whose honest answer was **you can't**. The ledger was step 3 of the v2 build and
`market.py` said so in two places (`real logged purchase -> exact (ledger; not
built yet)`). The only real number available was a hand-entered manual cost
basis, still flagged an estimate.

**The designed model was wrong, not just unbuilt.** Part 2 had Box → Purchase →
Line with "the FX rate snapshot at payment" on the box. The real Neokyo flow has
two payment moments weeks apart at two different rates, and the box's own is
*last*: buy requests → a PayPal batch is paid (one exact USD total, one FX
moment) → items sit in the warehouse under a 45-day clock → a packing request
quotes shipping, duties and fees for the whole shipment. **A box does not exist
until packing**, so purchases cannot hang off one; their resting state is the
warehouse.

Re-specified, then built:

- **`mkt_charge` is the new object** and the only place exact money lives. Three
  kinds: `items` (a paid batch), `domestic_shipping` (the occasional later bill
  against one purchase), `packing` (a box's quote).
- **The charge holds the money; the purchase holds the weight.** Per-card USD is
  allocated *down* from the batch total by native price, never converted *up*
  from the yen — converting drops PayPal's cut and the FX spread silently, in
  the flattering direction. The implied rate is an output.
- **Cancellations refund as store credit**, so a credit-funded batch allocates
  `paid + credit_applied`, and credit issued inside a batch leaves that batch's
  pool. The cancelled purchase is excluded outright, not zero-weighted.
- **Three-level allocation**, each reconciling exactly: charge → purchases →
  lines, plus the packing charge → lines with **two bases** (shipping by weight,
  duties and fees by value).
- **Cost completeness became a four-rung state** — `exact` / `partial` /
  `estimated` / `unknown` — replacing `effective_basis()`'s hardcoded
  `estimated: True`. A logged purchase now outranks a cost tier in
  `effective_basis()`, `/market/grid` and `/market/summary`.
- **`mkt_purchase_line` is a copy of the listing's lines, not a reference** —
  capture ingest replaces a listing's lines wholesale on every sync and would
  otherwise erase outcomes and allocation overrides.
- **UI:** Warehouse and Boxes tabs. Batch entry is one form for the whole
  payment, with rows picked from captured Neokyo listings (`GET
  /market/purchasable`) so identification already done in the lot analyzer is
  not done twice, and the per-row share shown live before saving.

Verified end to end against a scratch copy of the dev DB — 37 checks over the
weighted split, the credit round trip, both allocation bases, the residual and
the rungs in `comps`/`grid`/`summary`.

Two knock-on changes: the grid's scope gained bought cards (a purchase is market
data even with no comps), and `GET /market/comps/{item_id}` stopped 404ing for
one, or the grid would have listed rows it could not open.

**Next.** Not committed or deployed yet — `frontend_dist` is rebuilt and the
tree is dirty. The sell side (`mkt_sale`, line outcomes, sell-through,
days-to-sell) is still designed only; `mkt_purchase_line.outcome` accepts values
but nothing writes it. Per-copy basis still needs copies linked to purchase
lines. Open questions 6-8 on the plan doc: whether buy requests get logged
before payment (currently no), whether declared value really equals item price
for duties, and whether a purchase could ever split across two boxes.

### 2026-09-01 (US CDT) — Listing photos served from the extension, not hosted

Started as a question about the capture extension's ✓ state and ended somewhere
more useful. Two findings, one shipped fix.

**Why cards stop showing as logged.** The tile ✓ is derived live from the
observation store (`GET_KEYS` → `allKeys()`), and *Clear* genuinely deleted the
record — so clearing the panel erased the extension's memory of ever having seen
a listing. An archive design was sketched (keep the record, mark `archivedAt`,
third grey-✓ dot state, re-capture on click) but **not built** — the
conversation moved to images and that is what shipped. Still worth doing.

**Why market listings render blank.** `mkt_listing.thumbnail_url` is a hotlink
to the marketplace CDN, which drops the photo when the listing closes. Worst on
Japanese-titled rows, where the picture is the only identifier, and on the lot
list, which showed **no image at all**. This was the documented revisit
condition on the plan doc's declined R2 upload — so the decision was reopened.

**R2 was reconsidered and rejected on scope, not cost.** 8GB of 640px JPEGs sits
inside R2's free tier; the hosting was ~$0 either way. But the extension already
downloads a 640px copy at capture, the work is admin-only on one desktop, and
`lib/db.js`'s `getImage` was **dead code** — blobs were written and never read.
The bytes were already in the right place; only delivery was missing.

Built instead:

- `extension/content/appbridge.js` — runs on `collectcoreapp.com`, answers
  batched `window.postMessage` key requests with `blob:` URLs. A content script
  rather than `externally_connectable`, which would need a pinned extension id
  and therefore a packaging step this extension deliberately does not have.
- `frontend/src/marketImages.js` — batches on-screen keys into one round trip,
  caches per key, **always falls back to `thumbnail_url`**. No extension → the
  page renders exactly what it did before.
- **Image lifetime split from observation lifetime** (`extension/lib/db.js`).
  `deleteObservation` and `clearAll` used to take the blob too, which made the
  safest-looking button in the extension the one that destroyed irreplaceable
  bytes. Nothing removes image bytes implicitly now.
- `navigator.storage.persist()` at startup — unpersisted IndexedDB is evictable
  under disk pressure, and these are one-shot captures.
- `GET /market/listings/images` + panel **Images** button: backfills a local copy
  of every thumbnail still alive on a CDN. One-shot rescue; more rots daily.
- `external_id` added beside `thumbnail_url` on all five market query sites, so
  the app can rebuild the extension's `(marketplace, external_id)` key.
- Photos now render in the **lot list** and **lot analyzer** (96px), which had
  none, as well as the comps evidence list. The panel's own thumbnails upgrade
  to the stored blob too — they were hotlinking and rotting the same way.

Accepted explicitly: one profile, one machine, no backup. Losing them returns
the screen to hotlinks that work until they don't.

**Next:** the archive/grey-✓ design above; then the v2 market workspace.

### 2026-08-31 (US CDT) — Money vocabulary + library↔market integration BUILT (phases 0-4)

Plan: `docs/photocard_market_library_integration_plan.md` (**authoritative**).
Shipped as `b923916` → `810d9eb`.

Started as "let me see from the library which cards have comps", and the first
real finding was that the module could not be *discussed*, let alone extended,
because one word meant two things.

**The vocabulary, now enforced end to end.** Four rungs, and no word covers two:

```
cost  →  list price  −offer discount→  sell price  −fees→  net proceeds
profit = net proceeds − cost
```

Every quantity was already computed correctly — `list_price_for` even had an
intermediate literally named `gross`, which *is* the sell price. Only the naming
was broken, and visibly so: the grid column labelled **`sell` held net
proceeds**, while the actual sell price had no column at all, and the `flip` /
`arb` tooltips said "sell − paid" while both computed against net.

**Phase 0 — a live defect, found by taking the vocabulary seriously.**
`_net_sold_by_item` pooled sold sightings from *every* marketplace. Not via the
sold/gone feature (never used) — **the capture extension sets sold state from
page text**, so Neokyo's "out of stock" and Pocamarket's "sold out" arrived as
`listing_state = 'sold'` with no user action. JPY/KRW domestic prices, below US
resale, were dragging the sell price **down**, understating every flip and arb
margin and the era median that ~7,900 cards inherit.

`comps_for_card` already applied the right rule to the *competition* set; the
sold set never got it. Fixed in three places — the pooling, the detail's sold
stats, and its **sell fee-model pick** (a card seen only on Neokyo resolved to
`fee_model('neokyo','sell')`, a marketplace with no sell components, so every
rate read zero and net proceeds came back *equal to* the sell price — silently
fee-free, worse than absent). Pocamarket moved `side` `both` → `buy`.

It is a **pooling rule, not a data fix**: the sightings stay, so it corrects
history as well as new captures, and the Pocamarket popularity signal those same
rows carry survives intact.

**Phase 1** — the rename, plus a `sell` column beside `net`; the gap between
them is the fee bite. **Phase 2** — `GET /market/summary`, one sparse payload
feeding four library surfaces so they cannot disagree, and so opening a card
costs no extra request (`/market/comps/{id}` 404s on a card with no data and
must never be called speculatively). **Phase 3** — `$` badge replacing the
back-image `B` (the Image filter answers that better and is untouched), a Market
filter section, a caption value line, a cost/sell/net block in the detail modal,
and a deep link that uses `useNavigate` rather than an anchor because library
filter state lives in a module store a page load would reset.

**Phase 4 — sell price tiers retired.** Built 2026-08-17, **never used in
practice**; superseded by observed comps. The one live consumer, the trade CSV's
`price` column, becomes `list_price` derived from sold data and padded for
offers. Blank still means "needs pricing" — now "no comp yet".

Two things worth remembering from that removal:

- **No drop migration, deliberately.** A `DROP TABLE` on boot is exactly the
  restart-alters-data behaviour this project forbids. The code removal *orphans*
  the tables; `backend/drop_photocard_pricing.py` disposes of them by hand,
  dry-run by default. Its guard ignores `lkup_photocard_price_tiers` (four
  seeded rows in every database ever created) — a guard that trips every time
  only teaches you to force past it.
- **Both card-delete paths carried a `DELETE FROM tbl_photocard_pricing`.** With
  the table gone from `schema.sql` those would have raised *no such table* on
  every card deletion on a fresh database. Found by a reference sweep, **not by
  the tests** — nothing covered it.

`mkt_cost_tier` / `mkt_item_cost` **stay**: acquisition *cost*, not ask price.
The shared tier-XOR-custom shape and `t1..t4` codes are what made the two look
related.

**Next**

1. **The era rung (defect 1) — still distorting lot numbers.** `_value_ladder`
   falls back to a two-way era median split at 2020-12-31: dev-measured, **78%
   of cards land in one bucket**, including 806 whose origin has no date and
   silently read as `new`. The fix is a fallback chain that reports *which* rung
   it used and how thin it was, not a better bucket.
2. **`_sold_landed` (defect 3)**, surfaced during phase 0 and deliberately left
   alone: it is a buy-side figure, and a Neokyo sale really did happen — but a
   Pocamarket official "sold out" is a restock cycle with no buyer. The
   distinction it needs is not `side` but *whether a marketplace's sold state
   is a transaction*, which has no column today.
3. **Fee components still need real values** (eBay final value / payment
   processing / sales tax; Pocamarket box size 40). Until then every margin is
   optimistic.
4. Take before/after sell-price medians on prod when convenient — that also
   says how much of the era problem was phase 0 rather than bucket coarseness.

### 2026-08-30 (US CDT) — eBay + Pocamarket parsers, and per-listing postage

All four declared sources now have capture parsers. Two of the three things
built here came out of eBay being unlike anything already handled.

**eBay** (build-log entry 17). Both sides, server-rendered.

- **"Sold" alone is dangerous here.** A *live* eBay tile advertises how many
  have gone — `3 sold`, `1,204 sold` — so Mercari's bare-word test would file
  every popular active listing as a sale at its asking price. The state test
  requires a **date**. "Ended" is excluded for the same reason: a listing
  pulled by its seller, or an auction closing with no bids, sold for nothing.
- **The sale states its own date, and that becomes `observed_at`.** No other
  source tells us when. A sold search returns months of sales in one sweep, and
  stamping them all with capture time would make a March sale read as a day
  old — exactly what the grid colours staleness on. It also makes re-capture
  idempotent, since sightings key on `(listing, observed_at)`.
- **Foreign prices are refused, not converted.** `C $18.00` read as eighteen US
  dollars is a silent ~30% error that looks entirely ordinary on screen.

**Per-listing postage** (entry 18), reported as a gap on a captured eBay lot.
`mkt_sighting` gained `shipping_cents` / `shipping_usd`. Where the listing
states postage it **replaces** the fee model's shipping line rather than adding
to it — the standing estimate exists because the per-listing figure is usually
unavailable, and charging both double-counts. `0` is a real answer ("free
shipping") and switches the estimate off; `NULL` means unread and the estimate
stands. A *per_shipment* line is never replaced: consolidated freight is a
different cost from a listing's own postage, and it enters `total_fixed` as a
share of a box rather than at face value. The comp view and the lot header both
say which figure is in there.

**Pocamarket** (entry 18), awkward in three ways:

- It renders as a **mobile app frame even on desktop**, with the marketing
  landing page still in the DOM beside it in display type — so the largest text
  on the page is "The Marketplace for K-Pop Photocards" and it wins the
  font-size ranking outright.
- **Three USD figures on one listing page**, only the middle one the price: a
  "Save 1.40 USD" discount above and "Ship to United States from 12.00 USD"
  below. First-match buys the card for its discount; largest-match buys it for
  the postage.
- **Declared USD, parses won.** It quotes a US buyer in dollars throughout, so
  that is what its fee amounts are entered in — but the won parser stays for a
  switched display. `nativeCurrency` keeps them apart; without it a won figure
  is stamped USD, a ~1,300x error. The seeded row moved KRW → USD under a
  migration guarded on nothing having been captured there.

Its postage is **per shipment** ("same fee up to 40 items"), so it is
deliberately not captured per listing — that belongs in the fee model as a
`per_shipment` component with `typical_items_per_shipment = 40`.

Also new: **`titleUnverified`**, which forces the panel's page-read diagnostic
on for a site whose name element has not been confirmed against a live page. A
new site's title is a guess that won a ranking, and a guess presenting itself as
an answer is what four rounds of Neokyo went into. Pocamarket carries the flag.

107 cases in `tools/test_capture_parsing.mjs`; 5 more in
`tools/test_market_grid.py` for the postage arithmetic.

**Pocamarket's title, resolved the same day** (entry 19). Its name is the
**document title** — `Pocamarket, Stray Kids HYUNJIN THIS & THAT THIS VER.
K-pop Photocard` — which is the only place the identity appears whole; on the
page it is split across separate fields, so the ranking could only ever return
half of it. Against the real card index the full title lands on Hyunjin · This
& That and the version alone lands on **Bang Chan** · This & That. Half a name
is not a weaker match, it is a wrong one.

The **photo had the same bug**: `detailPhoto` took the largest image on the
site's CDN, and the landing page's hero of two tilted cards is the biggest
image on the page — so every Pocamarket capture carried the same picture. Photo
selection is now a per-site order like the title's: `og:image` first, then the
largest image *taller than it is wide*. No `largest` fallback on that site — a
generic image on every row reads as data, a missing one reads as missing.

`titleReject` now guards **every** title source rather than just the ranked
shortlist — a fix for Neokyo too, whose og:title and document title both say
"Item Details". A capture with no name is flagged in the panel; a plausible
name identical on every row is not.

**Refreshing and deleting captures** (entry 20). A **↻** button beside the
capture bar re-reads a listing page and updates the record, keeping its card
associations — clicking the bar twice reaches the same place but destroys the
record in between. Nothing else had to change: the extension store merges by
key and the server keys listings on `(marketplace, external_id)`, so a refresh
updates the listing and appends a sighting, keeping the older observation.
`DELETE /market/listings/{id}` is the other half, for captures that should not
exist at all; it removes children explicitly, since FK cascades never fire here.

The first real refresh surfaced two more. A listing re-captured after its local
record was cleared comes back with **no lines** — associations live only in the
extension — and the ingest's `if cap.lines:` guard already kept the server's,
but nothing said so, so a row reading *needs identifying* looked like lost work.
Ingest now returns per capture what the server holds; the panel tags those rows
`N on server` and drops them from the nag count. And the **sync result was
unreadable**: written to the status line after the list re-rendered, then
destroyed twice over (`renderList()` un-awaited, plus the `STORE_CHANGED`
broadcast from marking synced), so a sync that worked looked like one never
pressed. The note is held in state now and survives re-renders — failures
included.

**Fee seeding was overwriting user settings** (entry 21). `_seed_fee_components`
runs every boot and re-applied the seeded `scope`, which has a UI control — so
Pocamarket shipping set by hand to one $12 charge *per box* would have reverted
to $12 *per card* on the next deploy, a 40x overstatement arriving with no edit.
Seeds now write only the label and sort order on an existing row. Pocamarket
also seeds **one** fee line rather than four: shipping is its only charge, and
three permanently blank rows read as "still to fill in" forever. The other three
are retired only when empty. `tools/test_fee_seeding.py`, 13 cases across
simulated restarts.

Also settled: **storage terms set the box size.** Pocamarket stores
indefinitely and you choose when to ship, so boxes go out full and 40 against
"$12 up to 40 items" is honest. Neokyo's 45-day clock ships whatever
accumulated, so its capacity is a fiction there.

**Four backlog items declined 2026-08-30**, recorded in the plan doc's new
*Declined* table rather than deleted, so they stop being re-proposed as
remaining work: Japanese title matching (the picker says outright that it
cannot filter, and the search box covers it), thumbnail upload to R2 (blobs
live in the browser where identification happens; what is lost is portability
between machines), ship-name aliases, and a distinct "Wanted, no source" view
(the grid's `wanted` filter covers it). Each row carries a *revisit when*.

**Capture-session fixes (entry 22).** *+ non-card* and *+ unidentified* now sit
beside the lot checkbox in the panel, so a lot can be broken out while you are
looking at it; the non-card line asks for its **value** there, because that is a
judgement made from the listing and no ladder can derive it. That gave lines two
creation paths, so `mkt_listing_line.source` (`capture` | `app`) now scopes
ingest's wholesale replace — otherwise an album added in the analyzer was erased
by the next ordinary sync, silently.

Also: **the photo was the largest, not the primary.** A listing renders its main
photo first and alternates after it, often the same size, so the winner was
whichever decoded a pixel bigger — regularly the back of the card. Size now only
filters; DOM order decides. Neokyo gained `photoOrder: ['largest', 'portrait']`
because it fronts several marketplaces and its `photoHost` list is hosts *seen*
rather than a rule, which is why one listing captured with no image at all. A
row with no photo shows a dashed placeholder now, not a broken-image icon.

**The Neokyo image bug, round three (entry 23).** Rakuma listings captured
their image and Mercari-JP ones did not, on the same page type — so never the
host pattern. A **lazy-loaded** image holds its real URL in `data-src`/`srcset`
until it scrolls in, and every strategy was testing the host against an empty
`src`. `imgSrc()` now resolves all the forms; `tilePhoto()` always knew this and
`detailPhoto()` did not. Undecoded images (`0x0`) also passed through every
shape-based strategy, so there is a last-resort pass for them.

The panel now **prints what the photo search saw** — every image with its
dimensions and which strategy won — whenever a row has no photo. Three rounds
went into guessing this from screenshots; the title diagnostic already showed
that answering it in the panel ends it in one.

**The Mercari-JP image bug, actually found (entry 24).** Not the host pattern
and not lazy loading — `bigThumb` was mangling the URL after a correct read. A
Mercari US thumbnail carries `?…&width=200&height=200` and asking it for 640 is
free; Neokyo's Mercari-JP `/item/detail/orig/` URL carries a bare cache-buster
and no dimensions, because it already IS the full-size image. `URLSearchParams`
turned it into `?1787925462=&width=640` and the CDN answers **403**. Confirmed
by request rather than reasoning: original 200, rewritten 403. Rakuma's
`img.fril.jp` was never touched, which was the whole of the split.

Both branches now rewrite only a dimension the URL already declares, as a
string. And a re-capture **replaces** a thumbnail instead of only filling an
empty one — a wrong image was otherwise permanent, which made the refresh
button useless for the case it most obviously applies to.
`tools/test_thumb_urls.mjs`, 12 cases; it had none.

**Which photo is primary (entry 25).** With the 403 fixed the image loaded and
it was the *second* of two. DOM order cannot settle it — a looping carousel
clones its slides, so the first `<img>` is routinely a copy of the last photo.
Added `ogAmong` (og:image, but only when it matches an image the page is
actually showing, by filename) and made **the panel thumbnail clickable** to
step through every candidate the page offered. Then the actual answer, which was in the URL
all along: **Mercari numbers its photos** — `m47235147985_1.jpg` is the primary
— so `photoPrimary` declares the pattern and `numbered` runs first. It survives
carousel clones, lazy loading, hidden galleries and DOM order, because it is a
fact the site publishes rather than an inference about how the page looks.

Five rounds went into inferring what the URL was stating. The module had already
learned this twice (Neokyo's title from an element the site marks itself,
Pocamarket's from `<title>`): **look for the fact the site publishes before
reasoning about how the page renders.** The click-to-cycle override stays — it
is what makes the next unnumbered marketplace a click rather than a round.

**A lot can hold two of the same card (entry 26).** Picking an
already-associated card was a no-op, so the second copy was uncountable and the
lot's cost split across one fewer card than it held. It now counts the line up
— `qty` on the existing line, which is what units, per-card cost and line value
all already sum — with a `−` on the chip to walk it back.

**Grid columns split, plus a last-seen date (entry 27).** Member, origin and
version are now separate sortable columns and wanted is its own column rather
than a star prefix — none of "everything from Rock Star" / "every POB" is
expressible by sorting one composed string. Empty parts return null rather than
"—" so they sort last. `last_seen` is the newest observation from any source,
amber past a fortnight. **No backfill needed**: `observed_at` is NOT NULL, so
the date was already in every sighting and only missing from the view.

**The decision views (entry 28).** The grid answers "what should I act on";
opening a row now answers "so should I buy it, and why". Fees and cost basis
became tabs rather than bars pinned above the grid. A card opens **over** the
grid on double-click, so filters and sort survive; a lot opens over the card,
stacked. **Buy to keep** puts singles and lots in one table with card count and
wanted count as columns, two medians of the asks side by side, and the sold
median **landed** so it compares with the landed asks. **Buy to resell** is
Neokyo against Mercari US, showing a lot's per-card share by the same
allocation the lot screen uses; with no comps it inverts to the price needed to
clear the target profit, in red. The **lot verdict** gives % useful with
deliberately no pass mark, and states how many cards were judged on their era's
median rather than their own comps. Raw Listings is collapsed at the bottom.

`tools/test_buy_decisions.py`, 38 cases, run with real fees on both sides — the
claim is landed-against-net and a zeroed suite would pass on code that ignored
fees entirely.

**Next: data collection, not code.** The remaining outstanding item is filling
in the fee components — until they carry real numbers, "landed" is price plus
captured shipping and every margin in the grid is optimistic. v2 step 3, the
ledger, is deferred by decision until there is enough real data to judge
whether the current shape of the analysis is sufficient. Capture is done for
now: all four sources are built and verified against real pages.

### 2026-08-30 (US CDT) — v2 step 2 BUILT: the lot analyzer

`GET /market/lots` and `/market/lots/{id}`, POST/PATCH/DELETE on a lot's lines,
and a Cards/Lots switch on the Market page. A card-first view cannot answer "is
this 8-card lot worth $118?" — that question is about the whole listing at
once — and this is the view that can.

- **Value-weighted allocation**, largest-remainder so the lines sum to the
  landed cost exactly. Weighting matters: $100 over ten cards where one sells
  $75 and nine sell $10, split evenly, says the nine are worthless and the one
  is a lottery win. Weighting by value shows a uniform ~65% margin — the truth
  about a fairly-priced lot — and surfaces that 45% of the cost rides on one
  card selling, which the totals hide.
- **Two rungs on the value ladder**, both in *sale*-value units: the card's own
  net sold median, else its era's median (the ≤2020 / 2021+ split the cost
  tiers already use). Cost tiers are deliberately not a rung — a tier is an
  acquisition cost ($1–3) and a comp is a sale value ($10–75), and mixing the
  scales would crush no-comp cards toward zero and make them look free. Each
  line says which rung priced it.
- **Unidentified lines value at the era median, not $0**, borrowing the lot's
  own era. Zero would make the identified cards absorb the whole cost,
  overstating their basis and making the lot look worse than it is.
- **Keep/flip defaults from library ownership status** — Wanted → keep — so
  most lots need no toggling; overrides are per line and marked as typed.
- **The residual is the line that decides it:** flips net $A, the lot costs $B,
  so the keepers cost $C — against $D to buy them separately. Shown **only**
  when every kept card has a single-card listing to price against; a partial
  total reads as the whole answer and understates the alternative, which is the
  direction that talks you into the lot.

Two correctness fixes fell out of the build and apply to the grid too:

- **Units, not rows.** One line of `qty: 3` is three cards for one price. The
  old `COUNT(*)` tests called that a single-card listing, so its price became a
  comp for that card and a lot's cost divided by the wrong number. Everything
  now reads `SUM(qty)`.
- **`is_lot` belongs in the sole-line rule.** `/comps` already excluded flagged
  lots; the grid's copy of the rule did not, so the commonest lot shape — one
  identified card, N unknowns never entered — counted as a sole comp and its
  whole bundle price landed in that card's sold series. Both paths now share
  one helper.

Schema: `mkt_listing_line.value_cents` and `.disposition`, additive migrations.
`tools/test_lot_analyzer.py` — 56 cases on a fresh DB with real photocard rows
across both eras; the grid's 30 still pass.

**Next (superseded — see the entry above):** v2 step 3, per-copy cost basis and the ledger — the largest of the
three, and the only thing that sharpens `paid` for cards held in multiples.
Steps 1 and 2 are first cuts to review against real captured lots first.

### 2026-08-30 (US CDT) — v2 step 1 BUILT: the card grid is the front door

`GET /market/grid` plus `POST /market/listings/{id}/outcome`, and the Market
page now leads with a sortable grid instead of a card list. The per-card comp
view survives as its drill-down, which is the inversion v2 is about: you no
longer have to already know which card you came to look up.

- **Nine columns**, default sort arb-margin descending. Buy is deliberately
  **two** columns — cheapest single and cheapest per-card inside a lot — with
  the lot's full commitment in the tooltip, since acting on a $12.50 per-card
  figure inside an 8-card lot costs $118.
- **Nulls sort last in both directions.** A card with no margin is an unknown,
  not the worst margin; letting unknowns win either end of the sort buries
  exactly the rows the grid exists to surface.
- **Comps render per source with an age**, amber past a fortnight — an
  "active" listing that old may simply be gone and the row would rank on a
  price nobody can pay. Sold medians built on fewer than three comps get the
  same treatment.
- **Labels are rebuilt from the library**, not read off `mkt_listing_line`,
  which holds whatever the label was when captured. A card renamed since would
  otherwise appear under its old name in a view whose whole job is browsing.
- **Sold and gone are separate outcomes.** Sold takes a price and becomes a
  real comp; gone only removes a buying option. A sale with no price is refused
  by the server rather than guessed — a proxy listing that vanishes says
  nothing about what it fetched, and a guessed price becomes a comp and drags
  the median. Both set `delisted_at`, now filtered in all three places that
  read buy options.
- Scope is cards with market data **plus every Wanted card**, including bare
  ones — those being the reminder of where to browse next. Not the whole
  catalog: 11,347 rows in a table with no virtualization is not a view.

`tools/test_market_grid.py` — 30 cases on a fresh DB built with real photocard
rows (groups, members, origins, copies), so a wrong join fails the test rather
than reaching the screen.

**Next:** v2 step 2, the lot analyzer — built the same day, above.

### 2026-08-30 (US CDT) — Market workspace v2 DESIGNED (no code)

Deliberate pause to redesign before building further. The v1 comp view answers
"what is this one card worth" well, and that turned out to be the wrong
question to organise around.

- **The unit was wrong.** v1 is card-first, so you must already know which card
  to look up. Every real decision is about a *listing* — you buy a listing, not
  a card — which is also why lots read as second-class. Not a display bug.
- **Three views** replace one: a **card grid** (paid / cheapest-buy / net-sell,
  plus flip and arb margins, per-source comp counts and ages), a **lot
  analyzer**, and **wanted-with-no-source** as a browsing to-do list. The v1
  comp view survives as the drill-down.
- **Cheapest-to-buy is two numbers.** The cheapest source for a card is often
  inside a lot, and one card cannot be bought out of an 8-card lot. A blended
  column would rank listings that cannot be acted on.
- **Sold and gone are different events.** Sold-with-a-price is a new comp and
  free price discovery; gone just drops out. Merging them would let every
  vanished proxy listing inflate the sold median.
- **I was wrong about allocation.** I argued it cannot change a buy decision
  since totals are unchanged however cost is split. The counter-example is
  ordinary: a $100 lot of ten where one card sells for $75. Even allocation
  reports nine worthless cards and one lottery win; value-weighting reports a
  uniform ~65% margin, which is the truth — and shows that 45% of the cost
  rides on one card selling. Same totals, different risk.
- **The value ladder stays in value units.** Cost tiers are acquisition costs
  ($1-3) and comps are sale values ($10-75); borrowing tiers as weights would
  crush no-comp cards toward zero. Two rungs only — own comp, else era median —
  with finer rungs deferred until real lots prove them needed.
- **Keep/flip defaults from library ownership status**, so most lots need no
  toggling: the standing decision about a card is already recorded.

Feedback taken on board: the lot analysis may be over-built for the decision it
serves. v1 of it is deliberately minimal and the doc says so outright, with the
elaborations parked until real captured lots show they are wanted.

Written to `docs/photocard_market_intel_plan.md` -> *v2 — the market
workspace*, with `CLAUDE.md`'s roadmap and the plan's Next section pointed at
it. Three additive columns are all it needs schema-wise
(`mkt_listing_line.value_cents`, `.disposition`, `mkt_listing.delisted_at`).

**Next:** build step 1 — card grid + sold/gone marking.

---

### Completed to date (2026-04-25 → 2026-08-30)

Collapsed 2026-08-31 from 32 individual entries, per the 3-5 session rule at the
top of this file. Full text of every one remains in git history — the last
commit holding them is `23820f4`. Where a plan doc is named it is authoritative
and was kept current, so the detail lives there rather than only here.

**Market intel — extension capture, comps, and the v2 workspace (2026-08-27 → 08-30)**

- **2026-08-30 — Neokyo capture verified against the live site.** Four rounds of
  fixes, all the same category of error: assumptions about markup never actually
  seen. First real listing through the pipe end to end.
- **2026-08-29 — Neokyo capture built** (second source, first *server-rendered*
  one). Mercari is a React app read through its fiber; Neokyo has no fiber at
  all, so the DOM read that was a fallback there is the whole parser here. Drove
  the per-site rules registry the later sources reuse.
- **2026-08-29 — Detail-page capture built**, superseding and deleting the
  "enrich" tier. Capture from a listing's own page, singles and lots.
- **2026-08-29 — Origin ship dates + cost basis built** (`fd551e3`). Turned the
  comp view from "what does this sell for" into "what would I make on it".
  Dates live on the ORIGIN, never the card.
- **2026-08-29 — Market intel capture + comps built, deployed, live.** Slices
  1-5 of `docs/photocard_market_intel_plan.md` (authoritative).
- **2026-08-28 — Market intel designed.** Resurfaced the parked listing tracker
  and redesigned it around extension capture plus a resale ledger. No code.

**Photocard features (2026-08-12 → 08-27)**

- **2026-08-27 — Lomo/Fanmade ownership status**, added as a seed row rather
  than a feature: statuses are data-driven end to end, so a badge letter and one
  CSS variable were the only code.
- **2026-08-17 — Price tiers + trade CSV export built.**
  ⚠️ *The price-tier half was removed 2026-08-31* — see the top entry. The CSV
  and its Mercari title rules are still live;
  `docs/photocard_pricing_and_trade_export_plan.md` remains their reference.
- **2026-08-12 — Binder Designer built.** Plan:
  `docs/photocard_binder_designer_plan.md` (authoritative).
- **2026-08-12 — Triage statuses (Undecided / Not Wanted) built, deployed,
  live** (`f4facd1`, `72951ec`, `0298649`). Split the meaningless Wanted pile
  into an explicit collecting decision. Plan:
  `docs/photocard_triage_statuses_plan.md` (authoritative).

**Catalog and the `/pcs/` tier (2026-06-28 → 07-17)**

- **2026-07-17 — Bulk-create + imageless catalog + batch-image window + `/pcs/`
  uploads deployed and live** (`48a8c91`, `b415486`, `c0bb8b8`). This is where
  the monotonic-catalog rule was reversed and catalog membership stopped
  requiring an image. Plan:
  `docs/photocard_bulk_create_and_batch_images_plan.md`.
- **2026-07-10 — `/pcs/` authenticated guest tier built, deployed, live.**
  Phases 1-3 of `docs/guest_cloud_accounts_plan.md`, branch `pcs-tier`
  fast-forwarded to main.
- **2026-06-28 — `/pcs/` plan reconstructed** (`f134236`) after the original
  `.claude/plans/` copy was lost; moved in-repo. Version filter shipped;
  listing tracker parked.

**Planning sessions, no code (2026-05-09 → 05-15)**

- **2026-05-15 — Listing tracker:** cloud-hosting question resolved against
  post-Railway reality, wanted-gate removed.
- **2026-05-09 — Photocard trading v2, parts 1-4 shipped.** Superseded the old
  downloadable-HTML trade design.

**Auth, responsive web, and the guest webview (2026-04-25 → 04-27)**

The `/guest/` WASM tier is **deprecated** — replaced by `/pcs/`. These entries
are kept as one bullet each because the tier is frozen, not evolving.

- **2026-04-27 — Admin cover-image publish button;** catalog tombstones closed
  as unnecessary. *(That monotonic-catalog reasoning was later reversed on
  2026-07-17 — see above.)*
- **2026-04-26 — Guest webview live** on `collectcoreapp.com/guest/`, verified
  on real hardware, plus the admin publishing operations that feed it.
- **2026-04-26 — Guest webview phases 0-7**, built across one long day:
  build skeleton → sqlite-wasm proof-of-life → SAHPool worker + memory fallback
  → schema-separation contract + storage persist → delta sync → per-card
  annotations → backup/restore → deploy plumbing → full guest UI. Two course
  corrections worth remembering: the **pivot from a `guest.` subdomain to a
  path mount**, forced by Railway's 2-custom-domain limit, and the decision to
  **fork the detail modal** because an admin editor and a guest annotator are
  different UX rather than one component with flags. Runbook:
  `docs/guest_deploy_runbook.md`.
- **2026-04-25 — Cloudflare Access live + responsive web phase 1 across all 8
  module libraries.** Two Self-hosted Applications (apex + `api.`), auth at the
  edge with zero auth code in the app — still the model. Followed by four
  mobile-only passes: bulk-edit modal, Sort/Select icons in TopNav via a new
  `PageActionsContext`, Inbox layout, and the Inbox upload icon.
- **2026-04-24 — Apex SPA cutover + auth pivot + the mobile-vs-web
  architectural pivot.** The decision that Capacitor mobile is indefinitely
  deferred and mobile means responsive web; `mobile-shell` parked as reference.


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
