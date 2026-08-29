# Photocard Market Intel — Design & Implementation Plan

**Status:** capture + comps **BUILT** 2026-08-29 (slices 1-5, live in prod).
Ledger designed, not built. Neokyo / Pocamarket / eBay declared, no parsers yet.
**Scope:** admin only. A new `mkt_*` table namespace, a new SPA route, and a
browser extension. **No** photocard, catalog, `/pcs/`, or `/guest/` behavior
changes.

Two halves that ship in sequence:

1. **Capture extension** — grab listing data from search results while
   browsing, because copy/pasting URLs across hundreds of listings is the
   actual pain.
2. **Ledger** — where the money went and what came back: boxes, purchases, lot
   decomposition, cost allocation, sale outcomes.

## Goal

Two connected needs:

1. **Price research.** Know what a card is worth on both ends — what it can be
   bought for on the JP side, what it actually sells for on the US side — from
   data collected while browsing normally, not from a scraper.
2. **Resale bookkeeping.** Track spend and revenue for cards bought to flip,
   with honest cost allocation, so "is this financially beneficial" has an
   answer rather than a vibe.

The near-term shape is small: a few resale cards riding along in Neokyo boxes
already being bought for personal collecting. The end state worth aiming at is
**monthly break-even on flow** — this month's selling paying for this month's
collecting. See The goal.

An immediate third payoff needs no purchase at all: US comp data prices the
**existing trade shelf**. Note this is a read for the human, not a wiring —
market intel does not feed `tbl_photocard_pricing` or the Mercari CSV export.
See Decisions.

---

## Relationship to the listing tracker (v3)

`docs/listing_tracker_design_plan_v3.md` is **superseded for photocards** by
this document. It remains the reference for any future cross-module listing
tracking, but the photocard price-research need is served here instead.

What v3 got wrong for this use case, and what changes:

| v3 | Here |
|---|---|
| Server-side Playwright + Chromium on Railway | Browser extension — real session, real residential IP, human pacing |
| "Accepted risk" that datacenter IPs get blocked | Risk does not exist; you *are* the browser |
| Primitive = one tracked URL over time | Primitive = a card-level price observation; dozens per card |
| `listing_snapshots`, refresh engine, cooldowns, scheduler sweep | **All dropped** |
| One listing ↔ one item | One listing ↔ **many** lines (cards, non-card items, unidentified) |
| Neokyo as the parser target | Neokyo for buy-side capture; Mercari US direct for sell-side |

The POC findings in v3 still hold and carry over: Mercari US prices are integer
USD cents in `__NEXT_DATA__`; Neokyo is server-rendered, ~1s, with a native USD
conversion alongside JPY; Neokyo thumbnails come from `img.fril.jp` (Rakuma's
CDN). The `brotli` dependency note applies to any Neokyo HTTP parsing.

### What survives from v3

A lightweight **buy shortlist** — Neokyo URLs saved to maybe purchase later. A
list with a note and a date. Not a tracked entity, no refresh, no lifecycle.

---

## Relationship to the photocard module

**Strictly additive. Nothing here retrofits an existing path.**

- New `mkt_*` tables only. **Nothing goes on `tbl_photocard_details`** — per
  CLAUDE.md, that table is reflected by `catalog.py` (`SELECT *`) and
  `seed_builder.py` (PRAGMA-driven copy), so a column added there ships to the
  catalog delta and the guest seed with nothing in the diff to warn you.
- The link to the library is a **nullable `item_id`** — always `LEFT JOIN`,
  always scoped by `collection_type_id` (item ids are global across all 8
  modules). Most captured listings will *not* be in the catalog, and that is a
  normal state, not an error.
- New top-level SPA route, admin-only. Does not touch `/admin/trade-ownership`,
  `_attach_copies`, the catalog builders, or the pricing tables.
- Comp data does **not** write to `tbl_photocard_pricing`. If a
  "comp-suggested price" ever appears beside a tier, it is a later read-only
  join — not a dependency, and not in this plan.
- SQLite **FK cascades never fire** (CLAUDE.md). Every delete path here cleans
  up child rows explicitly.
- Migrations stay **additive and idempotent**.

---

# Part 1 — The Capture Extension

## Active vs. sold — both, never blended

Card prices fluctuate, so sold comps alone are not enough; active asks are the
live signal for what the market will currently accept. They answer different
questions, and the two sides of the trade use different ones:

- **Buy side is inherently active-only.** You can only purchase a live listing.
  JP active asks *are* the acquisition-cost distribution.
- **Sell side leans sold.** That is what actually clears.
- **The spread between current asks and recent solds is itself a signal** —
  asks drifting above recent solds means the market is heating (or sellers are
  getting greedy); asks at or below solds means softening.

Every observation is tagged `active` or `sold`. **They are never averaged
together.** Charted as two series.

**Supply depth** — the count of concurrent active listings for a card — falls
out of active sweeps for free and predicts days-to-sell better than price does.
Forty live listings of the same card means being fortieth in line.

## Capture tiers

### Sweep — cheap, no navigation

From a search results page: item id, price, currency, active/sold state,
thumbnail, title, result position. **This tier alone satisfies the core need**
(what a card cost on each marketplace on each date).

The richest source is usually not the rendered tile — modern marketplace SPAs
fetch results as JSON from their own internal API, and that payload routinely
carries more per-item metadata than the tile displays. Capture reads the site's
own response where possible, and falls back to DOM scraping the tiles.

### Mercari US — extraction point verified 2026-08-28

The pre-build investigation is **done**. Findings, in the order they were ruled
out:

- **No `__NEXT_DATA__` payload.** Present but a 227-char routing stub.
- **No GraphQL endpoint.** Apollo Client is on the page (per its console
  banner), but a `graphql` URL filter matched 0 of 1,091 requests.
- **No RSC flight data.** `self.__next_f` is undefined — not App Router.
- **No search payload on the wire at all.** With Fetch/XHR + `larger-than:20k`
  and cache disabled, every row was an image, font, or third-party script,
  all initiated by `workbox-*.js`. A DevTools content search for a visible item
  id matched **only image URLs** across 12 files — never a JSON body, never the
  document HTML.

The service worker is the likely explanation: **"Disable cache" does not bypass
a service worker**, so Workbox can serve the search payload from Cache Storage
with no network request to observe.

**The data is read off the React fiber instead.** Mercari passes each result
tile a full item object, reachable from the tile's anchor node:

```js
// from a result tile: a[href*="/item/m"]
// walk __reactFiber$ → f.memoizedProps.item   (found at hop 5)
```

No network interception, no request matching, no service-worker fight. This is
also **transport-independent** — it keeps working if Mercari changes how the
data arrives.

#### Verified field inventory (sweep tier)

| Field | Example | Verdict |
|---|---|---|
| `id` | `m70832633154` | Dedupe key → `external_id` |
| `name` | `STRAY KIDS HYUNJIN THIS & THAT PHOTOCARD KPOPNARA EXCLUSIVE` | **Full title, not truncated** |
| `price` | `3503` | **Integer USD cents** — divide by 100 |
| `status` | `on_sale` / `trading` | Per-item state — see below |
| `itemCondition` | `Like new` | Present in sweeps — expected to need enrich |
| `category` / `categoryId` | `Single Cards` / `3509` | Useful hint, **not trustworthy** |
| `brand` | `Stray Kids (SKZ)` | Useful hint, **not trustworthy** |
| `thumbnail` | `u-mercari-images.mercdn.net/photos/...` | Sized via query params |
| `description` | `""` | **Always empty in tiles** — enrich only |
| `shippingPayerCode` | `null` | **Always null in tiles** — enrich only |
| `color` | `null` | Irrelevant |

**Price is cents**, corroborated two ways: v3's POC found integer cents on the
detail page, and the sampled values carry odd amounts (`3503`, `1624`, `1125`,
`1020`, `463`) consistent with Mercari's automatic price-drop feature. Worth one
10-second confirmation against a listing's displayed price before shipping.

#### `status` semantics — verified against a sold-filtered sweep

**`status` is a field on the item, not an artifact of the search filter.** A
sold-filtered sweep of the same query returned **24 of 24 items as `trading`**;
`sold_out` was **never observed** in search tiles at all.

So the mapping is:

| `status` | Meaning | Treated as |
|---|---|---|
| `on_sale` | Live and purchasable | **active** |
| `trading` | No longer purchasable — the sold-state marker in search | **sold** |
| `sold_out` | Not observed in tiles; may appear elsewhere | **sold** |

**The consequence is a real trap:** the *default* (unfiltered) search **also
contains `trading` items** — item `m74208203513` appeared in both sweeps at the
same price, `trading` in each. Sweeping a default search and recording it all as
"current asking price" would silently contaminate the active distribution with
already-sold listings.

**State is therefore derived from the `status` field and never from which
filter was run.** That was already the design; this sweep proves it was load-
bearing rather than merely tidy.

**Not available in sweeps, and the cost of that:**

- **No timestamps.** Listing age cannot be read at capture, so days-on-market
  accrues only from our own repeated observation of the same `external_id`.
  Deferred, not lost.
- **No seller id.** Cannot detect one seller flooding the market with the same
  card. Enrich only.
- **No shipping payer.** Buyer-paid vs. seller-paid materially changes the real
  price, so **enrich matters more for buy decisions than first assumed.** Comps
  are unaffected.

#### Parser strategy: fiber first, DOM fallback

`__reactFiber$` is React internals, not a public API. It is stable in practice
and widely relied on, but it is the one part of the extension that a Mercari
deploy could break. **The parser tries fiber first and degrades to scraping the
tile** (id from the href, plus price, title, sold badge) rather than depending
on fiber alone.

### Enrich — opt-in, throttled

For the handful of listings seriously being considered, the extension queues
those ids and fetches detail pages in the background using the existing
session: condition, description, seller, shipping.

**This is automated fetching** and is paced accordingly — a few per minute,
jittered, capped per session. Reserved for buy candidates, never run across a
whole result set. Sweeping pages already being viewed at human pace is a
different posture from bulk background fetching, and the cap is what keeps that
distinction real.

**Enrich is on demand from the review queue, never automatic** (decided
2026-08-28). Capture stores the thumbnail only. Each queue row carries two
controls:

- **Open listing ↗** — opens `listing_url` in a new tab.
- **Fetch photos** — runs enrich now and stores the full photo set.

A tile carries only `thumbnail` (photo 1), so a 12-card bundle is identified
from photos 2-6 on the detail page. **Both controls only work while the listing
is live** — Mercari photocards can sell within days, and v3's POC recorded
Neokyo serving 403-plus-redirect for deleted listings. The accepted tradeoff:
capture stays cheap and fast, and the cost is that a speculative capture left
sitting too long may become unidentifiable. Working the queue promptly is the
mitigation, not more capture-time machinery.

## Sites

Capture happens **where browsing already happens.** A tool that requires
changing shopping habits to feed it stops getting used.

| Side | Site | States | Parser |
|---|---|---|---|
| Buy (JP) | **Neokyo** (proxies Mercari JP + Rakuten Rakuma) | active only | Server-rendered HTML — easy, POC-validated |
| Sell (US) | **Mercari US** direct | active + sold | SPA — search-response interception |

Neokyo is the checkout and consolidation layer, which is why buying happens
there; capturing there means the saved URL is the one that can actually be
purchased. Proxies generally surface only purchasable items, so JP-side sold
comps are unavailable — no real loss, since the buy side is active-only anyway.

Consequence: **only one SPA parser to build.** Yahoo Auctions JP and other
sources are deferred until the first run says whether this works.

## Dormant by default

The extension must be **invisible until deliberately switched on**. Browsing
Mercari for anything unrelated to photocards has to look exactly like browsing
Mercari, with no overlays, no dots, and no panel — and without the user
disabling the extension in `chrome://extensions`.

- **Off is the default state.** The content script loads on Mercari pages but
  renders nothing until activated. It never auto-opens, ever.
- **The side panel *is* the switch**, mechanically and not just by convention:
  the panel holds a long-lived `chrome.runtime` port, and its `onDisconnect` is
  what turns capture off. Panel open = capturing; panel closed by any means =
  fully inert.
- **Chrome opens the panel, the extension never does.**
  `sidePanel.setPanelBehavior({openPanelOnActionClick: true})` handles the
  toolbar click natively. `sidePanel.open()` is only legal inside a live user
  gesture — a single `await` before it, or the service worker being woken by
  the click itself, ends that window and the call rejects with nothing visible
  to the user. Do not reintroduce it.
- **Activation is per-tab.** Sweeping in one tab leaves a second Mercari tab
  clean, which is the whole point — casual browsing and capture sessions
  coexist.
- **`Esc` is the escape hatch.** One key removes every overlay immediately and
  closes the panel for that tab (`chrome.sidePanel.setOptions({enabled:false})`).
- **The toolbar icon carries a badge** showing on/off for the current tab, so
  the state is never ambiguous.

## Two capture modes

Both are real workflows, and the panel switches between them with one control:
a card chip that is either set or empty.

### Mode 1 — Collecting (no card armed)

A broad search, capturing anything interesting: cards priced oddly, ones rarely
seen, or on Neokyo cheap listings that US buyers might want. Each capture could
be a different card, or several, or none yet.

Tile click → **queued**, unassociated. Association happens afterward in the
panel, narrowed by the title pre-filter. This is the scan-then-associate flow:
clicking never interrupts scanning with a modal.

### Mode 2 — Armed (a card is set)

A targeted sweep for one specific card — click every result that matches and
associate them all in one pass.

Tile click → **captured, with line 1 seeded** for the armed card.

The key semantics: **an armed click means the listing *contains* the card, not
that it *is* the card.** So a bundle that happens to include the armed card
needs no special case — it is captured and associated, and the remaining lines
get added later from the panel. Same line editor as Mode 1.

The armed card's **thumbnail stays pinned** while sweeping. Photocard versions
differ subtly, and visual comparison is the actual matching mechanism.

### Shared rules

- **Nothing is captured by default. Opt-in per tile, never opt-out.** Each
  result tile gets an overlay toggle and you click the ones you want.
  **There is deliberately no "select all" affordance** — see below.
- **Clicks are instant** — no confirmation, no modal. Click again to undo.
- **The panel always shows the session list** of what has been captured. In
  Mode 1 those rows need association; in Mode 2 they are done but still
  openable to add lines.
- **Batch commit** per page.

### Lots must not poison the comps

A 12-card bundle at $27 that contains the armed card is **not** an observation
of that card at $27. Recording it as one corrupts the comp series far worse than
a missing observation would.

> **A card's price series includes only observations where that card is the
> sole line.** Multi-line observations feed the lot-discount metric instead.

`is_lot` is therefore captured explicitly rather than derived from line count —
the common case is one identified card and eleven unknowns never entered.

**Resolution: capture as single, auto-flag suspects** (decided 2026-08-28).
Rejected alternatives: deciding at click time (puts a branch in the mode built
for speed) and pure post-hoc cleanup (a wrongly-marked single *looks* finished,
so nothing ever prompts the fix — silent wrongness, unlike an unidentified card
which is visibly incomplete).

So every armed click captures as single, and the extension scans `name` for
bundle signals, routing matches to a short **Confirm lots** list:

| Signal | Examples |
|---|---|
| English | `bundle`, `lot`, `set`, `bulk`, `PC's`, `PCs`, `\d+\s*(cards?\|pcs?)` |
| Japanese | `まとめ売り`, `まとめ`, `セット`, `枚` |

The 2026-08-28 sample contained `♡ Stray Kids Photocard Bundle (7 PC's!) +
Freebies ♡` — trivially caught. The heuristic will miss some; a miss that
surfaces nothing is still strictly better than one nobody would have looked for.

### Opt-in is the requirement, not the cautious default

Searches are **intentionally kept broad** to catch listings where the seller
botched the keywords — which is routine on Mercari and worse on Neokyo, where a
translation barrier sits on top of it. The normal case is **1–2 wanted results
among 20+**, so a select-all-then-deselect flow inverts the work and invites
exactly the mis-tying the query-change guard exists to prevent.

Design consequences:

- **Single-tile capture must be one click** — no modal, no confirmation step.
  It is the highest-frequency action in the whole tool.
- **No bulk-select control**, at all. Not a shortcut worth its failure mode.
- **No ignore list, persistent or otherwise.** "Junk" is a property of the
  *current search intent*, not of the listing. A P1Harmony card is noise while
  hunting a Hyunjin card and is the target next week. Any stored ignore would
  eventually suppress a listing that has become wanted, so unwanted rows are
  simply not clicked.

### The query-change guard

The armed card **persists across pagination but clears when the search query
changes.** Paging through 200 results for one card is safe; wandering into a
new search while still holding the previous card — and stamping it onto
strangers — is structurally prevented.

### Escape hatches

Neither of these loses data to indecision:

- **Needs identification** — captures the observation with no card link.
- **Lot** — flags the listing as a multi-card bundle instead of forcing a
  single card link. Its own pipeline, not an error state.

### Unassociated is a work queue, not a resting state

An unidentified card is **never kept**. Every unassociated observation resolves
one of three ways:

1. **Associate** to an existing catalog card.
2. **Create the card**, then associate — the card exists in the market but not
   yet in the library.
3. **Delete** it as a tracking item.

So the app surfaces a **Needs identification** worklist with a count, worked
down toward zero — not a passive bucket that silently accumulates.

Path 2 respects the module wall: the extension **never writes photocards**. It
flags the observation, and resolution happens in the app by deep-linking to the
existing card-create flow, prefilled where the lexicon can prefill it. Nobody
wants to stop mid-sweep to catalog a new card, so the flag is the capture-time
action and creation happens later.

### What the 2026-08-28 sample confirms

A single search (`stray kids this that hyunjin`, 24 results) independently
validated three design choices:

- **Result sets are heavily contaminated.** The 24 rows included albums
  (`CD`), a necklace filed under `Stuffed Animals`, and an album explicitly
  sold *without* photocards. Auto-capturing a whole result set would be
  garbage in. Per-tile opt-in is required, not fastidious.
- **`category` and `brand` are hints, never filters.** Photocards appeared
  under three different categories (`Paper Collectibles` 1642, `Single Cards`
  3509, `Photocards` 3569), and a Stray Kids card was branded **`BTS`**.
  Sellers miscategorize freely.
- **The "same card" is really many cards, and that drives price far more than
  condition does.** Nominal "This & That Hyunjin photocard" listings ranged
  **$10.20 → $55.00** — a 5× spread — because they were different retailer
  exclusives (KPOPNARA, Walmart, Withmuu, Soundwave POB, HMV lucky draw, fans
  benefit). This is the strongest argument for the card-level primitive: a
  price series keyed to a *search concept* would be noise. It only means
  something keyed to a specific catalog card, which is exactly what
  `source_origin` + `version` already distinguish.

Also present: a 7-card bundle (`♡ Stray Kids Photocard Bundle (7 PC's!) +
Freebies ♡`, $27.00) and a two-member card (Hyunjin + I.N.) — the lot and
multi-member cases, in the first sample taken.

### The sold sweep adds two more

- **Sold results are *more* contaminated than active ones.** The same query,
  sold-filtered, returned P1Harmony, ENHYPEN, and assorted non-Hyunjin Stray
  Kids cards; one listing's entire title was `Photocard`. Mercari appears to
  broaden matching when the filtered set is thin, so **sold comps require more
  selection effort per useful row, not less**. A second Stray Kids item came
  back branded `BTS`.
- **Sold prices are frequently odd amounts** — `407`, `425`, `567`, `769`,
  `1045`, `1867`. That is accepted offers and auto price drops, and it is direct
  evidence for the ledger's `list_price` vs `sale_price` split: realized is not
  asked.

### No price reading is available from these samples

An earlier draft of this section compared the active sweep's price range against
the sold sweep's and read a clearing price off it. **That was invalid and has
been removed.** The two sets are not the same cards — the sold sweep contained
P1Harmony, ENHYPEN, and Stray Kids cards for Bang Chan, Felix, Changbin, Han,
and Lee Know. A range computed across a mixed result set is a range across
unrelated objects.

This is the same trap the card-level primitive exists to prevent, and it is
worth recording that it was easy to fall into even while designing against it:

> **A price statistic means nothing until every observation in it is tied to a
> specific catalog card.** Not a search phrase, not a result set, not a member
> name — a card, with its `source_origin` and `version`.

The diagnostic value of these two sweeps is real (field inventory, `status`
semantics, contamination rates). Their analytical value is zero, and no price
figure should be carried forward from them.

## The card index and title matcher

Implementation: `extension/lib/matcher.js` (pure, no chrome/DOM) and
`extension/lib/cardIndex.js`. Regression harness: `node tools/test_matcher.mjs`.

### The index

`GET /admin/card-index` returns identity fields only — id, group, members,
origin, version, special flag, front image. No ownership, no pricing. ~11,300
cards, ~2.4 MB.

The panel caches it in IndexedDB and **refreshes on open whenever the stored
copy is over 12 hours old**. Working from a hand-exported file was rejected as a
*correctness* problem, not a convenience one: a card catalogued since the last
export silently fails to match, gets pushed down the create-the-card path, and
invites a duplicate of a card already owned. `tools/export_card_index.py`
remains the offline path, and must be pointed at a **prod** database — dev lags.

### Filters, never selects

Every inference is a removable chip, and **the candidate list is never empty** —
chips get dropped rather than returning nothing. A filter that hides the right
card without saying why is worse than no filter.

`lowConfidence` is set when no member matched at all, since that usually means
the listing is another group entirely (the sample contained P1Harmony and
ENHYPEN rows).

### Four tuning decisions, each forced by real data

Tuned against real captured Mercari titles. All four are counterintuitive enough
to be worth recording:

1. **Document frequency decides what may filter** (`MAX_DF_RATIO = 0.15`).
   `photocard` spans 1,410 cards and discriminates nothing; `withmuu` appears
   once and pins a card exactly. Frequency, not a hand-maintained stopword list.

2. **Origin outranks version** (`FIELD_BOOST` 2.2 vs 1.0). Without the boost,
   *"Han KARMA Double Sided"* discarded KARMA to keep the format words and
   returned Han cards from three unrelated eras — precisely backwards. Origin is
   identity; version is mostly format.

3. **Joined forms are indexed.** Sellers write `Rockstar` where the library says
   `Rock Star`. Indexing the concatenation took that case from 212 junk results
   to 4 correct ones.

4. **Title stopwords, because DF cannot catch them.** `skz` is rare in the
   library but ubiquitous in listing titles, so it scored as highly
   discriminating and buried the real signal (`hop`, `hmv`). Words that are
   generic in *titles* need their own list regardless of library frequency.

### Aliases are the compounding part

`ALIASES` maps fan shorthand to member names — `jisung`, `lino`, `binnie`,
`innie`. Every confirmed association whose title used an unknown alias is a
candidate row.

`I.N` is handled by alias only and never by token: it tokenizes to nothing
usable, and `in` is a preposition that would tag half the library.

**This table is also the seam for Neokyo.** Japanese titles need segmentation
plus a kana/kanji layer (`ヒョンジン` → Hyunjin, `スキズ` → Stray Kids), which
plugs in here rather than needing a second matcher.

**Not yet handled: ship names.** `Minsung`, `Hyunlix`, `Seungjin`, `Changlix`
appear constantly in titles and map to member *pairs*, which the current alias
format cannot express.

### Measured quality

12/12 correct top-hit origin across the regression corpus, which includes
deliberately unmatchable cases — a bare `Photocard`, a bundle, and a P1Harmony
card absent from the library — that must degrade rather than pretend. Rerun
`tools/test_matcher.mjs` after touching the matcher or adding aliases.

## Multi-line contents

A listing contains N things. The observation → card relationship is **1:N**,
and each line is a card link, a non-card component, or an unidentified card.

**Labels are the allocation basis, not decoration.** Naming the eight cards you
recognize in a twelve-card lot is what makes the cost split meaningful later.

**Partial identification is a complete record**, not a draft. "12 cards, 5
recognized, 7 unknown" is valid and final; unknown lines still carry allocation
weight. A tool that demands full identification gets abandoned at the third lot.

Line entry is never a precondition for capture — capture the listing in one
click, then build lines in a compact panel with quick-add from recent/frequent
cards plus a bare "+N unknown" counter.

### The lot discount ratio

Once a lot observation carries a line count, the **implied per-card price**
falls out: ¥4,000 ÷ 12 = ¥333/card against a singles median of ¥800. That
ratio, tracked over time and by card tier, is the arbitrage thesis quantified.
It cannot be derived from a listing price alone, which is why the contents
model earns its place on the capture side and not just in the ledger.

## Local buffer and sync

The extension writes to **IndexedDB first, always**, and syncs in batches.
Browsing never blocks on the network, and a sweep is never lost to an API
hiccup. This is the permanent architecture, not scaffolding — building it
before the ingest endpoint exists costs nothing later.

**Sync is a button, not automatic** (as built). Safe to press repeatedly: the
server keys listings on `(marketplace, external_id)` and sightings on
`(listing, observed_at)`, so a re-sync updates rather than duplicates and the
extension never has to track what it has already sent. Nothing is deleted
locally on success — until sync is automatic, the local copy is the safety net.

**Captured image blobs are NOT sent** — see the gap noted under Images. Sync
posts `thumbnailUrl` only.

The extension also caches a **catalog index** (card identity fields only — no
ownership, no pricing) to power arming. At ~10k cards a compact index is a
couple of MB of JSON; cache in IndexedDB, refresh on demand.

Dedupe key is `(marketplace, external_id)` — the native listing id parsed from
the URL. Seeing the same tile twice in one sweep records once. Seeing the same
listing three weeks later records a second observation, which is a useful
staleness signal (still unsold) rather than a lifecycle to manage.

## Auth — getting past Cloudflare Access

`api.collectcoreapp.com` sits behind CF Access. Requests need a valid Access
JWT, obtained through an interactive Google redirect that sets a
`CF_Authorization` cookie. The app has zero auth code because CF rejects
unauthenticated requests at the edge.

An extension is not a person clicking through Google. Three doors:

### Option A — ride the existing cookie

An MV3 background-worker fetch uses the browser's cookie jar, so with host
permission the extension sends a live `CF_Authorization` automatically.

- The cookie lives in the **profile**, not in a tab. A tab open for three days
  does not help; a **reload** does, because that re-runs the Access check and
  reissues the cookie (silently, if the Google session is live). "Reload the
  site when it starts failing" is a workable manual step.
- Access issues cookies **per application**, and `collectcoreapp.com` /
  `api.collectcoreapp.com` are different hosts. Verify that loading the admin
  SPA leaves a valid cookie for the API host.
- **CORS is the harder half.** The extension origin is
  `chrome-extension://<id>`, so a JSON POST triggers a preflight `OPTIONS`. CF
  Access must be configured to let the preflight through (per-application CORS
  settings) or it gets bounced to the Google redirect and the POST never
  happens. FastAPI must return the **specific** origin with
  `Access-Control-Allow-Credentials: true` — credentialed requests cannot use a
  wildcard.

### Option B — CF Access service token

A client id + secret pair sent as `CF-Access-Client-Id` /
`CF-Access-Client-Secret`, with an Access policy scoped to **only** `/ingest/*`.
No Google flow, no cookie, no expiry (tokens last ~1 year, rotatable).

**Validation stays entirely at the edge, so the app gains zero auth code** —
the "zero auth code in the app" property is preserved. Both A and B need the
same CORS work; B additionally removes the expiry failure mode, for roughly
half an hour of extra setup.

Exposure is a secret in extension storage on a personal machine, contained by
scoping the policy to the ingest path alone and making that endpoint
**append-only and idempotent**: it can add rows to a staging table and nothing
else. No reads, no deletes, nowhere near photocard data.

### Option C — no API call

Extension writes to IndexedDB, exports a file, imported through the admin UI in
a normally authenticated tab. Zero new surface, one manual step per session.

### Decision — AS BUILT: Option A, no service token

**Option A is what shipped**, for both the card-index read and the capture
sync. No service token exists and none is needed.

The earlier plan called for C then B because of an expected CORS fight. That
analysis was wrong in one specific way: **extension *pages* keep cross-origin
access via `host_permissions`** — a plain `fetch` with `credentials: 'include'`
carries the Access cookie and faces no preflight negotiation. Only *content
scripts* lost that privilege in MV3, and the panel is a page.

So the app still gains **zero auth code**: Cloudflare validates at the edge
exactly as it does for the SPA.

The one wrinkle is expiry. CF answers an expired cookie with a redirect to
Google that the request cannot follow, which surfaces as a network failure
rather than an HTTP status — so a thrown fetch is reported as *"sign-in
expired — open collectcoreapp.com in a tab"* rather than an outage. Capture
keeps working throughout; only server calls need the session.

**Option B (service token) stays the answer for unattended sync** — a
background or scheduled push with no human present to renew a session. Not
needed while syncing is a button someone presses. Option C (file export)
survives as the offline path.

---

# Part 2 — The Ledger

The mixed box is the actual use case, and the thing that is genuinely miserable
in a spreadsheet: one Neokyo box holding some cards to keep and some to flip,
shared shipping across both, containing a lot that decomposes into eight cards
and an album.

## Objects

- **Box** — a Neokyo consolidated shipment. International shipping,
  consolidation/repack fee, insurance, customs, plus the **FX rate snapshot at
  payment**.
- **Purchase** — one listing bought. Item price, per-item Neokyo fees, optional
  source URL, optional link back to the buy shortlist.
- **Line** — what is inside a purchase. Same structure as capture-side lines: a
  card link, a non-card component, or an unidentified card; each with a label,
  quantity, and allocation weights.
- **Sale** — a realized sale. Sale price, marketplace fees, shipping cost,
  `date_listed`, `date_sold`.

`date_listed` and `date_sold` are two columns, and they mean **sell-through and
days-to-sell accumulate on their own** from the first real sale. No separate
measurement exercise is needed to produce them.

## Allocation — three levels, two bases

Costs chain down:

```
box costs  →  purchases  →  lines  →  per-card landed cost
```

Each level reconciles **exactly**. The UI shows a residual and requires it to
reach zero (rounding absorbed on the largest row).

### Every line absorbs cost, including personal ones

**Full box costs allocate across every line — cards kept and cards flipped
alike.** If resale freeloads on shipping the personal purchase paid for, resale
looks profitable when it is not, and that is the exact false signal that would
justify scaling into a dedicated box on an accounting artifact.

The kept cards' allocated share is a real and independently useful number: it
is what the collection actually cost, landed.

### Two bases, because one is wrong

Different cost types want different allocation bases:

| Cost type | Basis | Effect |
|---|---|---|
| **Weight-driven** — international shipping | weight | Cards are ~5g and near-uniform, so roughly equal-split among cards; an album or photobook correctly eats an enormous share |
| **Per-item / value-driven** — service fees, per-item handling | per item, or by value | Supports "special cards absorb a higher %" |

Lumped into a single weight, a heavy non-card item either under-absorbs
shipping or over-absorbs fees. Non-card lines are precisely where a
single-basis model produces wrong per-card costs.

Both bases are **overridable per line**. Setting an explicit amount pulls that
line out of the weighted sweep and redistributes the remainder across the
still-weighted rows — the same tier-XOR-custom pattern already used by
`tbl_photocard_pricing`, deliberately, so it behaves the way you expect.

Defaults can start simple (equal weight within a class) and gain the weight
classes once real boxes show where equal-split is wrong.

### Lot-level P&L is the truth

Value-weighted allocation is a **margin-analysis device**, not real cost — a
chase card does not weigh more. It makes per-card cost a management estimate.
Lot-level and box-level P&L remain the authoritative numbers. If tax cost basis
is ever needed, equal-split or by-item-price is the conventional method.

## Outcomes

Every line resolves to exactly one outcome:

- `listed` / `sold` / `unsold` — the resale path
- **`kept`** — moved to the personal collection
- `filler` — discarded or worthless; cost genuinely absorbed

**`kept` is the main path, not an edge case.** Buying a lot for the two cards
wanted and flipping eighteen is the normal shape. Those two are not shrinkage —
they are a purchase at allocated cost, transferred out of resale inventory and
credited to the resale P&L. Without this, resale numbers look dismal while the
collection quietly does well, and the wrong conclusion gets drawn.

Non-card lines (album, magazine, merch) take the same outcomes — they can be
resold, kept, or absorbed. Allocating a share away from the cards without
giving it somewhere to land just leaks it.

## Album purchases — the other acquisition path

Most cards do not arrive as a Neokyo purchase. They come out of albums bought
many at a time, and the reason for costing them at all is narrow and specific:
**assigning a basis to the duplicates that get sold.**

### An album is a lot

Same shape as a Neokyo bundle — one price, several components — so it needs no
new machinery. It is a purchase with lines:

```
This & That · & Version · Withmuu            $15.00
  album shell   (non_card)  $3.00 fixed  → kept
  ID card       weight 2                 → $2.00
  album card    weight 3                 → $3.00
  first-run POB weight 3                 → $3.00
  store POB     weight 4                 → $4.00
```

**The shell is a line with outcome `kept`**, exactly like a card you keep, so
card P&L excludes it automatically — not by a special rule, but because that is
what `kept` already means. There is no separate "residual" concept.

It takes an **explicit amount** rather than a weight (the tier-XOR-custom
pattern: an explicit amount pulls a line out of the weighted sweep and the
remainder redistributes). That amount is **per album config, not global** — a
$25 standard album ships a larger photobook and posters than a $15 member
version, so its shell really is worth more.

### Slot weights

Derived from the author's own hand-allocation, which turned out to be one
consistent system applied twice: $12 across four slots gave $2/$3/$3/$4, and
$12 across three (no store POB) gave $3/$4.50/$4.50 — the same weights, minus
one.

| Slot | Weight |
|---|---|
| ID card | 2 |
| Album card | 3 |
| First-run POB | 3 |
| Store POB | 4 |

Defaults, not law — older eras shift, and each config can override. Weights beat
fixed amounts here because a cheaper album shrinks the pool and reprices every
slot automatically.

### Slots are costed, not cards

Album cards are **random pulls**, so every member had identical expected cost.
Allocating more to the card you happened to pull would bake luck into the basis
and hide the very thing worth seeing — a lucky pull showing a fat margin, an
unlucky one a loss.

This is a deliberate departure from lot allocation, where value-weighting *is*
right because the cards are identified before purchase. Random draw: split
evenly. Identified purchase: split by value.

The practical consequence is that **no physical card ever has to be traced to a
specific album.** Six albums produce six ID slots at $2; selling three consumes
three. So basis is assigned **at sale time from a pool**, not recorded at pull
time — which matters, because opening six albums and logging 24 pulls is exactly
the friction that kills the habit.

**Duplicates are not cheaper.** Three Hyunjin IDs from three albums cost $2
each; selling one at $5 is a real $3 gain. And dupes that never sell still
consumed cost.

## Origin ship dates — AS BUILT 2026-08-29

Older cards are worth more, sometimes a great deal more. Age does not *cause*
that — scarcity does, and age is a proxy for it (smaller fandom at release →
smaller print run → fewer surviving copies). The correlation is real but noisy:
`I am NOT` and `SKZ2020` are both old with very different scarcity, while a
current-era Chinese-store POB outprices both. So a date is a **prior where comps
are thin, never an override of an actual comp** — the same role, and the same
limits, as a cost tier.

### It is an origin fact, not a card fact

`start_date` and `date_precision` live on `lkup_photocard_source_origins`.
**88 origin rows date all 11,323 catalogued cards**, and no card has a null
origin, so this is an evening's work rather than a data-entry project. A new
origin costs one field at creation and never becomes a backlog again.

This placement is also what keeps it out of trouble: nothing new goes on
`tbl_photocard_details` without checking the guest paths, and the origin lookup
is both the correct normalization and the safe side of that rule.

### `start_date` means when the line STARTED SHIPPING

Not a release date. Look at what is actually in the list — `Fan Club Gen 2`,
`Maniac World Tour`, `Dicon`, `SHIBUYA109`. Those are not point events; they run
for weeks or months. The date is the **opening of the window**, and
`date_precision` says how much of it to trust:

| value | meaning | stored as |
|---|---|---|
| `day` | exact known date | the date |
| `month` | known to the month | the 1st |
| `year` | approximate, year only | Jan 1 |

Both columns are nullable. A dateless origin is legal and means *unknown*.

### Coverage

**87 of 88 origins = 11,323 of 11,323 cards.** The only undated origin is
`Merch`, which has no cards. Sources were two fan-maintained spreadsheets (an
album release list and a photocard event timeline) reconciled against the prod
backup of 2026-08-28, plus eight dates supplied directly for the 2025–26 tail
the sheets do not reach.

Two judgement calls, both the user's: **Nacific** is a 22-round collab series
running Sep 2021 – Nov 2023 and takes the earliest date (its cards are tier 1
anyway, so the loss does not propagate); **Dominate** spans many drops and takes
the earliest, the Aug 2024 dominATE SEOUL pop-up.

### The seeding rule, and why it is not negotiable

`backend/seed_origin_dates.py` + `_seed_origin_start_dates()` match on
**(id AND name) together**, and write **only where `start_date IS NULL`**.

Both halves are load-bearing, and this is the part worth remembering:

- **Lookup row ids are NOT stable across databases.** In the 2026-08 dev copy,
  id 77 was `This & That`; in prod, id 77 is `Season's Greetings 2025 (Japan)
  Your Hero`. Seeding on id alone would have silently written an album date onto
  a Season's Greetings row, with nothing to notice it by.
- **Names drift too.** Prod had since renamed ~15 origins that dev still held
  under the old label (`Nacific` → `Collab: Nacific`, `Fan Club Gen 4` →
  `Fan Club Gen 4 STAY HIDEOUT`), so name-only matching would have skipped them.
- **NULL-only** means a date corrected by hand in the admin UI survives every
  later restart.

A row whose id and name disagree is **skipped and logged**, never guessed at.
Verified both ways before shipping: 87 seeded against a prod backup; 56 seeded
and 15 refused-with-reasons against dev.

One accepted wart: clearing a date in the UI lets the seed refill it on the next
restart, because `NULL` means "unknown" and the seed knows it. Correct a date by
setting it, not by blanking it.

### Editing, and where the columns travel

Editing rides the generic lookup admin — the two columns are registry
`secondary_cols`, so list, patch and UI came for free. Secondary columns now get
light validation, because a malformed date would be stored silently and then
skew every era comparison that read it.

`catalog.py` `SELECT *`s this table and `seed_builder` copies it PRAGMA-driven,
so both columns **do** reach the catalog delta and the guest seed. That is
intended and benign — a ship date is public fact, unlike pricing — and it does
not touch `/pcs/`, whose origins endpoint uses an explicit column list against
the live DB and never reads a seed. The only consumer that would care is the
retired WASM `/guest/` tier, which is nobody.

## Cost basis for the backlog — AS BUILT 2026-08-29

Cards already in the collection have no receipts — albums bought months ago,
opened, sorted into keeps and trades. They still need *something*, or every sale
from the existing pile reads as pure profit.

### Scope: the sale pile, not the catalog

Basis is assigned only to copies held for **`trade` / `pending_outgoing`**
(`SALE_STATUSES` in `market.py`). A card that was never owned has no basis to
speak of, and a card being kept is a collecting cost rather than a trading one.

This is not a detail. The catalog is **11,323 cards but only 1,664 copies are
actually held** — the rest are `undecided` reference rows for cards that exist.
A catalog-wide assignment would have produced a large, confident, meaningless
number. Measured on the real pile instead: **453 copies over 243 distinct cards,
$1,342.50 estimated, $2.96/copy.**

`SALE_STATUSES` is a named constant because the monthly-flow metric below
eventually wants `owned` too — its *out* side is the cost of cards moved to KEEP
in a month, which cannot be computed while the scope stops at the sale pile.
Widening it is a deliberate call, not an accident.

The distribution runs ~77% tier 3, which is expected rather than a flaw in the
rules: current-era cards are where the buying and trading have been focused.

### Precedence, derived on read

```
real basis   (logged album or marketplace purchase)  → exact
cost tier    (backlog estimate)                      → ESTIMATED
neither                                              → unknown
```

Mirrors how effective price already works in `tbl_photocard_pricing`: derived on
read, never denormalized. **Estimated is labelled**, so a blended figure is never
mistaken for a measured one.

### Blended on purpose, and what that costs

A $15 member version and a $25 standard album with the same card count produce
very different true costs per card. Against real costs, member-version cards
show fat margins and standard-album cards show losses; blended, it comes out
roughly even. For cards already pooled and untraceable, blended is the only
honest option.

The consequence, which must be visible in the UI: **with a blended basis, an
individual card's P&L is noise.** Only the aggregate is sound, because the over-
and under-statements cancel across the pile. Per-card margin is meaningful only
for cards with a real basis.

### Assignment — use the flag, not the text

Four tiers matching the ranking already in use for sale prices. **The assignment
is separate from the price-tier assignment** (see Decisions), even though the
ranking is the same shape.

| Tier | Contents | Selector |
|---|---|---|
| 1 | ID cards, common non-album | `\bID\b`, hand-adjusted |
| 2 | Older-era album cards | `start_date <= 2020-12-31` |
| 3 | Current-era album + first-run, older-era first-run | `start_date >= 2021-01-01` |
| 4 | **Store POBs** | `is_special = 1` |

**"POB" is a misnomer covering two different things**, and the distinction is
what tier 4 turns on:

- **Store POB** — a benefit card from a specific retailer. Higher value, varies
  a lot by issuer (Chinese-store POBs resell high). Flagged `is_special`.
- **First-run / album POB** — the extra card included during a first press run.
  Ordinary value. Not flagged.

So `is_special` is the selector for tier 4, and it is **more reliable than the
version text** — version naming is inconsistent (a store name alone often
implies POB), while the flag encodes the judgement directly.

> **Do not bulk-assign by substring.** Measured against the real library:
> `version LIKE '%ID%'` matches **1,758** cards but only **288** are actually ID
> cards. The other 1,470 are Polaroids — `Polaroid POB`, `Polaroid SKZOO POB`,
> `Seoul Polaroid POB` — i.e. it sweeps expensive cards into the cheapest tier.
> Word boundaries, and a preview count before committing.

As built, `ID` is a **registered SQLite function** (`cc_is_id_version`)
rather than a `LIKE` pattern, because SQLite has no word-boundary operator and
the approximation is exactly the trap above. The era boundary is a request
parameter, not a constant, so it can be slid and re-previewed: at `2019-12-31`
tier 2 holds 13 copies, at `2020-12-31` 15, at `2022-12-31` 96.

**The preview is always on screen and only the assign button writes.** A bad
rule's damage is invisible once written — a wrong assignment looks exactly like
a right one — so the dry run is a safety property, not decoration. Assignment
writes one row per *item*, not per copy, and leaves `source = 'manual'` rows
alone unless `overwrite_manual` is passed.

### The tier is a floor, not an answer

Store POBs vary enormously by issuer, so one tier cannot price them. It does not
need to: **each store's POB is already a separate card with its own `item_id`**,
so comps segment by issuer automatically. The tier only fills the gap for cards
with neither a purchase record nor comp volume, and gets displaced card by card
as better data arrives.

## The goal — monthly break-even on flow

Not cumulative break-even. The backlog represents years of album spend that will
never be earned back, and aiming at it would be discouraging and useless.

The goal is **this month's selling paid for this month's collecting**:

```
for each month:
  in   = net proceeds from cards SOLD that month
  out  = allocated cost of cards moved to KEEP that month
  net  = in - out            break-even when net >= 0
```

Flow-based and periodic. It ignores the backlog by construction, and it does not
require every card to sell.

**Schema consequence:** this needs *when* an outcome was set, not just what it
is. A card kept in March costs March even if bought in January, so
`mkt_purchase_line` carries `outcome_at`.

### The companion number

This metric cannot see unsold inventory. Sell $50, keep $50 of cards, and it
reads break-even even while 200 unsold dupes that cost $400 stack up. That is
not a flaw in the goal — it is what the goal deliberately excludes — so it sits
beside it rather than inside it:

> **August: +$12** · unsold inventory 214 cards / $438 basis

The headline stays the flow number; the companion stops it becoming a lie.

### Three levels, kept distinct

| | Measures | Role |
|---|---|---|
| Monthly flow | sold-that-month net − kept-that-month cost | **The goal** |
| Card trading P&L | resale net − basis of cards sold | Flatters; ignores dead stock |
| Total outlay | all cash out vs all revenue | Honest hobby cost; will not break even |

The third exists precisely *because* it will not break even. Album spend is a
collecting cost, not a trading one, and showing it separately keeps it from
leaking into a metric that is supposed to be about cards.

---

## Data Model — as built

Diverged from the original two-table sketch in one structural way, noted below.
Full DDL with rationale is in `backend/sql/schema.sql`.

### Three tables, not two

The plan had `mkt_observation` + `mkt_observation_line`. Building it showed the
observation was doing two jobs: **a listing is seen more than once.** Identity
and contents belong to the listing; price and state belong to each sighting.
Folding them together duplicates a listing's title, thumbnail, and card lines on
every re-capture and makes "which lines does this listing have" ambiguous.

| Table | Holds |
|---|---|
| `mkt_listing` | Identity: marketplace, external_id, url, title, condition, category, brand, thumbnail, `is_lot`, `suspected_lot`, `via_fallback`, first/last seen. `UNIQUE (marketplace, external_id)` |
| `mkt_listing_line` | Contents: `line_type` (card / non_card / unidentified), **nullable** `item_id` + `collection_type_id`, label, qty. Also the lot decomposition |
| `mkt_sighting` | One row per sighting: `observed_at`, `listing_state`, `raw_status`, `price_cents`, `currency`, `price_usd`, `fx_rate`, `fx_source`. `UNIQUE (listing_id, observed_at)` |

Both UNIQUE constraints exist so **ingest is idempotent** — the extension cannot
know what the server already holds, so re-syncing an overlapping batch has to be
a no-op rather than a duplicate.

### Sources and currency

| Table | Holds |
|---|---|
| `lkup_mkt_marketplaces` | `mercari_us` (USD), `neokyo` (JPY), `pocamarket` (KRW), `ebay` (USD) — code, name, currency, side. Currency is declared per source, not guessed per row |
| `mkt_fx_rate` | `(currency, as_of_date)` → `usd_per_unit`, source, note |

**`price_cents` holds MINOR units of its currency, not literally cents.** USD
$40.00 is 4000; ¥2500 is 2500, because JPY has no subdivision. Assuming 2
decimal places everywhere produced a live 100x bug (¥2500 converted to $0.17),
so conversion routes through major units. `CURRENCY_EXPONENT` in
`backend/routers/market.py` is the authority.

Rates are **dated history, never one mutable current value** — a single value
would silently rewrite the USD of every past observation each time it changed.
A marketplace's own conversion wins where present (Neokyo shows USD beside the
yen, and that is the amount actually charged). `GET /market/fx` names currencies
with no rate on file so a gap is visible rather than quietly shrinking the
sample.

### Endpoints

| Route | Purpose |
|---|---|
| `GET /admin/card-index` | The library the extension matches titles against |
| `POST /market/captures` | Ingest, idempotent |
| `GET /market/comps` | Every card with usable comp data |
| `GET /market/comps/{item_id}` | One card's series + excluded lots |
| `GET /market/marketplaces` | Declared sources |
| `GET /market/fx` · `PUT /market/fx` · `POST /market/fx/backfill` | Rates |

SPA route is **`/market-intel`**, never `/market` — that is the API prefix and
Vite's dev proxy matches on prefix. Same trap as `/binders`.

### Cost tables — as built

`mkt_cost_tier` (tier_code, tier_name, cost_cents, sort_order) and
`mkt_item_cost` (item_id PK, cost_tier_id, cost_cents, source, updated_at).

The `CHECK ((cost_tier_id IS NULL) <> (cost_cents IS NULL))` mirrors
`tbl_photocard_pricing` exactly: **tier XOR explicit amount**, effective figure
derived on read and never denormalized, so editing a tier reprices every card
sitting on it with no backfill. `source` is `rule` or `manual`.

The `mkt_` prefix rather than `tbl_photocard_*` is deliberate — cost is an
admin-only fact and the prefix keeps it out of the catalog and guest paths that
sweep `tbl_photocard_*`. Nothing here reaches `/pcs/`.

Endpoints: `GET /market/cost-tiers`, `PUT /market/cost-tiers/{id}`,
`GET /market/cost-basis/preview`, `POST /market/cost-basis/assign`.

### Ledger tables

`mkt_box`, `mkt_purchase`, `mkt_purchase_line`, `mkt_sale`, `mkt_shortlist` are
**designed above but not built.** The column sketches earlier in this document
stand; expect the same listing/sighting-style split to shake out during
construction.

### Images — stored, not hotlinked (reverses the earlier deferral)

An earlier draft deferred image storage on the grounds that a broken thumbnail
on a historical comp is cosmetic. **That reasoning holds for comps and fails for
identification.** Where a card has not been identified yet — and especially for
lots — the image *is* the payload. Nobody identifies twelve cards from
`トレカ まとめ売り`, and the CDN URL is dead by the time the queue gets worked.

**The governing asymmetry: capture is a one-shot opportunity.** Grabbing an
image now is nearly free; grabbing it after the listing closes is impossible.
So the extension is **greedy at capture and lazy at cleanup** — store bytes for
everything, prune later if volume ever justifies it.

- **Request a usable size.** The thumbnail URL carries its own dimensions
  (`...m22825719402_1.jpg?1787769379&width=200&height=200`), so capture
  rewrites it to `width=640` rather than storing a 200px postage stamp.
- **Store blobs in IndexedDB** at capture, alongside the observation. A 640px
  JPEG is roughly 60-100KB; several hundred captures is tens of MB, which
  IndexedDB handles comfortably.
- **Thumbnail only at capture.** The full photo set is fetched on demand from
  the review queue (see Enrich), not automatically.
- **On sync, upload to R2** under the `listings/` prefix via
  `images.collectcoreapp.com` — the same client and custom domain used for
  `catalog/` and `admin/`. Not in the backup ZIP; R2 is independently durable.

> **NOT BUILT — known gap.** The extension stores the blob locally as designed,
> but `POST /market/captures` sends only `thumbnailUrl`, so server-side
> thumbnails are hotlinked to Mercari's CDN and **will rot when listings
> close**. The bytes exist in the browser; nothing ships them. Closing this
> means posting the blobs on sync and uploading to R2 — worth doing before the
> comp view's audit thumbnails start going blank.
- **Pruning, if ever needed:** an observation associated to a single catalog
  card has a library image already, so its captured image is the first
  candidate to drop. Unassociated and lot images are never pruned.

### Backup

New tables are captured automatically by the existing SQLite hot-copy backup.
No backup changes needed.

---

## Build Order

### Built (2026-08-29, live in prod)

1. **Capture extension, Mercari US** — dormant until switched on; the side panel
   holds a runtime port and its disconnect turns capture off.
2. **Card index + title matcher** — 11,323 cards pulled live from prod,
   auto-refreshing when over 12h old. 12/12 correct top-hit origin on the
   regression corpus (`node tools/test_matcher.mjs`).
3. **Card picker, both capture modes** — Collecting and Armed, chips, lot
   flagging.
4. **Ingest + comps** — idempotent, sole-line rule enforced, multi-currency.
5. **Comp view** at `/market-intel` — sold-median headline, quartile bands,
   auditable series with thumbnails, excluded lots.
6. **Origin ship dates** — 87/88 origins, 100% of catalogued cards, editable
   through the generic lookup admin.
7. **Cost tiers** — `mkt_cost_tier` + `mkt_item_cost`, scoped to the sale pile,
   preview-before-assign.

### Next

- **Per-card basis override UI.** The table stores `source = 'manual'` and the
  assign sweep already preserves it; only the editing surface is missing. Small,
  and it is what lets a comp displace a tier card by card.
- **Neokyo capture** (buy side). Server-rendered HTML per v3's POC, so no fiber
  read — plain DOM parsing, more brittle but simpler. Brings the Japanese
  lexicon into play and is the first live exercise of the JPY path.
- **Thumbnail upload to R2** — see the known gap under Images.
- **Ledger** — box → purchase → line → outcome → sale.
- **Ship-name aliases** (`Minsung`, `Hyunlix`, `Seungjin`). Sellers use them
  constantly; needs the alias table to map to member *pairs*, not single
  members.

### Not planned for v1

Comp charting beyond the quartile bands; Pocamarket and eBay parsers (declared
only); automatic sync; any `/pcs/` exposure of price data.

## Open Questions

1. ~~**What does the Mercari US search response actually carry?**~~
   **RESOLVED 2026-08-28** — there is no observable search response; data is
   read off the React fiber. See Mercari US — extraction point verified. Enrich
   is **not** needed for comps, but **is** needed for buy decisions
   (`shippingPayerCode` is null in tiles).
2. ~~**Does the sold filter return `status: "sold_out"`?**~~
   **RESOLVED 2026-08-28** — no. A sold-filtered sweep returned 24/24
   `trading`; `sold_out` was never observed in tiles. `trading` is the
   sold-state marker, and the default search contains it too.
3. ~~**Does loading the admin SPA leave a valid Access cookie for the API
   host?**~~ **RESOLVED 2026-08-29** — yes. Both the card-index read and the
   capture sync work from the panel on the browser's Access cookie, with no
   service token. Extension *pages* keep cross-origin access via
   `host_permissions`; only content scripts lost it in MV3.
4. **Value-weight classes for Neokyo LOTS** — album slot weights are settled
   (ID 2 / album 3 / first-run 3 / store POB 4), but lots are a different case:
   the cards are identified before purchase, so they split by value rather than
   evenly. Deferred until real boxes show where equal-split is wrong.
5. **Est. grams per line type** — a small default table (card 5g, album 300g,
   photobook 500g) is enough to start; refine against a real box's actual
   shipping charge.

---

## Decisions Log

- **2026-08-28** — Card-level observations replace v3's per-URL tracking.
  `listing_snapshots`, the refresh engine, cooldowns, and the scheduler sweep
  are dropped.
- **2026-08-28** — Browser extension replaces server-side Playwright. Removes
  v3's accepted datacenter-IP blocking risk and the split-deployment
  contingency entirely.
- **2026-08-28** — Active and sold are both captured, tagged, and never
  blended. Buy side reads active; sell side reads sold.
- **2026-08-28** — JP side is active-only via Neokyo (proxies surface only
  purchasable items); US side is active + sold via Mercari US direct. One SPA
  parser to build.
- **2026-08-28** — Observations carry N lines. Multi-card tying, non-card
  components, and unidentified cards are one feature, serving both comps
  (implied per-card price) and purchases (allocation).
- **2026-08-28** — Armed card clears on search-query change; nothing is
  captured by default; partial identification is a complete record.
- **2026-08-28** — Full box costs allocate across every line, including cards
  kept for the personal collection. Marginal-cost-is-near-zero is a fair read
  of first-run *risk* but wrong as an accounting rule.
- **2026-08-28** — Allocation uses two bases: weight for shipping, per-item or
  value for fees. A single basis produces wrong per-card costs whenever a heavy
  non-card item is in the box.
- **2026-08-28** — `kept` is a first-class outcome and a transfer at allocated
  cost, not a write-off.
- **2026-08-28** — Auth: Option C (local export) during extension development,
  Option B (CF Access service token, `/ingest/*` scoped, append-only) for the
  real build. A service token keeps validation at the edge, so the app still
  gains zero auth code.
- **2026-08-28** — No multi-week measurement program. Sell-through and
  days-to-sell accrue as a byproduct of `date_listed` / `date_sold` once the
  ledger is in use.
- **2026-08-29** — **Cost basis is scoped to the sale pile**
  (`trade`/`pending_outgoing`), not the catalog. Only 1,664 of 11,323 catalogued
  cards are actually held, so a catalog-wide basis would be a large confident
  number about cards that were never owned. Kept cards are a collecting cost,
  not a trading one. Consequence to revisit: the monthly-flow metric's *out*
  side needs `owned` too, so `SALE_STATUSES` is a constant rather than inlined.
- **2026-08-29** — **Era boundary is 2020-12-31**: 2020 and earlier is older,
  2021 forward is current. It is a request parameter, not a constant, so it can
  be slid and re-previewed. Small lever in practice — it moves 15 copies at the
  chosen cutoff.
- **2026-08-29** — **Origin ship dates are seeded on (id AND name), NULLs only.**
  Lookup ids are not stable across databases and names drift independently, so
  neither key alone is safe: dev id 77 was `This & That` where prod id 77 is
  `Season's Greetings 2025 (Japan) Your Hero`. Mismatches are logged and skipped,
  never guessed at.
- **2026-08-29** — **Age is a prior, not an answer.** Age proxies scarcity but
  noisily, so a ship date may fill a gap where comps are thin and must never
  override an actual comp — the same rule already applied to cost tiers.
- **2026-08-29** — **Album purchases are lots.** The shell is a line with
  outcome `kept`, taking an explicit per-config amount, so card P&L excludes it
  because that is what `kept` means — no separate "residual" concept. Slot
  weights ID 2 / album 3 / first-run 3 / store POB 4, reverse-engineered from
  the author's own hand-allocation, which proved to be one consistent system
  applied twice.
- **2026-08-29** — **Album slots split evenly, unlike lots.** A random pull
  means every member had identical expected cost; value-weighting would bake
  luck into the basis. Identified purchases still split by value. Basis is
  therefore assigned at SALE time from a slot pool — no physical card is ever
  traced to a specific album, because logging 24 pulls per six albums is the
  friction that kills the habit.
- **2026-08-29** — **Backlog gets blended cost tiers, labelled ESTIMATED.**
  Individual card P&L on a blended basis is noise; only the aggregate is sound,
  and the UI must say so. Tier 4 selects on `is_special`, which is more reliable
  than version text: "POB" covers both store POBs (valuable, flagged) and
  first-run POBs (ordinary, not flagged), and version naming is inconsistent.
  Substring assignment is banned — `LIKE '%ID%'` matches 1,758 cards of which
  only 288 are ID cards, sweeping 1,470 Polaroids into the cheapest tier.
- **2026-08-29** — **The goal is monthly flow break-even**, not cumulative:
  proceeds from cards sold this month vs allocated cost of cards kept this
  month. Ignores the backlog by construction. Requires `outcome_at` on the
  line, and an unsold-inventory companion number, since the metric cannot see
  dead stock.
- **2026-08-29** — **No integration with `tbl_photocard_pricing`.** Market
  intel reads nothing from and writes nothing to it; the only link anywhere
  remains a nullable `item_id` on a line. Cost and price share a ranking shape
  but never an assignment: price tiering is a selling opinion that gets revised,
  and letting cost ride on it would silently rewrite cost history — the same
  failure rejected for FX rates. Superseding the price tiers entirely is a
  later decision, not one to make on 43 data points.
- **2026-08-29** — Built as three tables, not two: a listing is seen more than
  once, so identity/contents belong to the listing and price/state to each
  sighting. Ingest is idempotent on both keys.
- **2026-08-29** — `price_cents` is MINOR units of its currency. Assuming two
  decimals everywhere produced a live 100x error (¥2500 → $0.17); conversion
  routes through major units.
- **2026-08-29** — SPA route is `/market-intel`, never `/market` — the API
  prefix, and the dev proxy matches on prefix. Same trap as `/binders`.
- **2026-08-29** — Comp view leads with the **sold** median. Measured on one
  card, n=43: asks $20.00-$47.00 against sales $5.00-$26.60. The ranges barely
  overlap, so active listings alone would have priced it at roughly double what
  it clears at. Distributions render as quartile bands because min/max is
  meaningless at that spread, and the series renders with thumbnails because a
  statistic you cannot audit is one you stop trusting.
- **2026-08-28** — Mercari US capture reads the **React fiber**
  (`memoizedProps.item` off a result tile's anchor), not the network. Ruled
  out first: `__NEXT_DATA__` (227-char stub), GraphQL (0/1091 matches), RSC
  flight (`__next_f` undefined), and any observable XHR payload — the service
  worker appears to serve search results from Cache Storage, which "Disable
  cache" does not bypass.
- **2026-08-28** — Parser degrades **fiber first, DOM tile second**. Fiber is
  React internals and could break on a Mercari deploy; the fallback keeps
  price, id, title, and sold state.
- **2026-08-28** — `status` is a per-item field, and **`trading` is the
  sold-state marker in search tiles** — a sold-filtered sweep returned 24/24
  `trading` and zero `sold_out`. The **default search also contains `trading`
  items**, so state must be read from `status` and never inferred from which
  filter was run; doing otherwise contaminates the active distribution with
  sold listings.
- **2026-08-28** — Capture is **opt-in per tile with no bulk-select control**.
  Searches are deliberately broad to catch seller keyword errors (worse on
  Neokyo, where translation compounds it), so the normal case is 1–2 wanted
  results among 20+. **No ignore list** — junk is a property of the current
  search intent, not of the listing, so anything stored would eventually
  suppress a listing that has since become wanted.
- **2026-08-28** — **No price statistic is computed over unassociated
  observations.** Ranges taken across a raw result set mix unrelated cards and
  mean nothing; every comp figure is scoped to a specific catalog card.
- **2026-08-28** — Two capture modes: **Collecting** (no card armed, tile click
  queues for later association) and **Armed** (card set, tile click captures
  *and* seeds line 1). An armed click means the listing **contains** the card,
  not that it *is* the card — so lots need no special case, just extra lines.
- **2026-08-28** — **A card's price series includes only observations where
  that card is the sole line.** A 12-card bundle at $27 must never enter a
  single card's comps as $27; multi-line observations feed the lot-discount
  metric instead. `is_lot` is therefore captured explicitly, not derived from
  line count — the common case is one identified card and eleven never-entered
  unknowns. **Armed clicks capture as single and auto-flag bundle-signal titles
  into a Confirm lots list** — chosen over a per-click toggle (branches the fast
  path) and over pure post-hoc cleanup (silently wrong, since a mis-marked
  single looks finished).
- **2026-08-28** — **Unassociated observations are a work queue, not a resting
  state.** An unidentified card is never kept: associate, create-then-associate,
  or delete. The extension never writes photocards; card creation deep-links to
  the existing admin flow.
- **2026-08-28** — **Image storage reversed from deferred to required.** Capture
  is one-shot and CDN URLs rot, so images are stored as blobs at capture
  (rewritten to `width=640`) and uploaded to R2 on sync.
- **2026-08-28** — **Enrich is on demand, never automatic.** Capture stores the
  thumbnail only; the review queue carries *Open listing ↗* and *Fetch photos*
  per row. Both depend on the listing still being live, so a speculative capture
  left too long may become unidentifiable — accepted in exchange for keeping
  capture cheap.
- **2026-08-28** — Sweeps carry `itemCondition` (better than expected) but
  **not** timestamps, seller, or shipping payer. Listing age therefore accrues
  from repeated observation rather than being read at capture; enrich is
  needed for buy decisions, not for comps.
