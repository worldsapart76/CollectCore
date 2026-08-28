# Photocard Market Intel — Design & Implementation Plan

**Status:** designed 2026-08-28, not built.
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
**resale paying for the collecting habit** — see The Pays-For-Itself Metric.

An immediate third payoff needs no purchase at all: US comp data prices the
**existing trade shelf** (89 cards carry a `trade` copy per the pricing plan),
feeding the price tiers and Mercari CSV export that are already built.

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

### Decision

**C first** — it dodges the auth and CORS work entirely while the extension is
being shaped, and the local buffer it needs is permanent architecture anyway.
**B for the real build.**

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

## The pays-for-itself metric

The end goal, stated plainly:

```
resale net profit  ≥  allocated landed cost of cards kept
```

Shown per box and rolling. This is what "buying and selling pays for the
collecting habit" means numerically, and it is computable precisely because
`kept` is a transfer at allocated cost rather than a write-off.

Secondary numbers, all free once the above exists:

- **Days-to-sell** (`date_listed` → `date_sold`) and **sell-through** (what
  fraction of listed cards ever sold). Margin without these is how resale
  hobbies convince people they are profitable.
- **Return per month of capital tied up** — a card netting $12 in eight months
  is worse than one netting $5 in a week.
- **Capital in flight** — cash sitting in unsold inventory and in-transit boxes.

---

## Data Model

All tables `mkt_*`. Column lists are the intent, not final DDL.

### mkt_observation

One sighting of one listing. Append-only.

| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| marketplace | TEXT NOT NULL | `neokyo`, `mercari_us` |
| external_id | TEXT | Native listing id from the URL; dedupe key with `marketplace` |
| listing_url | TEXT | |
| observed_at | TEXT NOT NULL | ISO 8601 |
| listing_state | TEXT NOT NULL | `active` / `sold` — **never blended** |
| price | REAL | |
| currency | TEXT | |
| price_usd | REAL | Marketplace-provided conversion where available (Neokyo) |
| title_raw | TEXT | Original, untranslated |
| thumbnail_url | TEXT | Source URL; see Thumbnails |
| result_position | INTEGER | Rank within the search page |
| search_query | TEXT | What was being searched |
| is_lot | INTEGER | |
| capture_tier | TEXT | `sweep` / `enrich` |

### mkt_observation_line

Contents of an observation. Also the lot decomposition.

| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| observation_id | INTEGER NOT NULL | |
| line_type | TEXT NOT NULL | `card` / `non_card` / `unidentified` |
| item_id | INTEGER | **Nullable** — LEFT JOIN, scope by `collection_type_id` |
| collection_type_id | INTEGER | Denormalized for the scoped join |
| label | TEXT | The allocation basis |
| qty | INTEGER NOT NULL | Default 1 |
| notes | TEXT | |

### mkt_shortlist

Saved buy candidates. A list, not a tracker.

| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| observation_id | INTEGER | |
| listing_url | TEXT NOT NULL | |
| added_at | TEXT NOT NULL | |
| notes | TEXT | |
| resolved_at | TEXT | Set when bought or dismissed |

### mkt_box

| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| label | TEXT | |
| ordered_at / shipped_at / received_at | TEXT | |
| intl_shipping_cost | REAL | Weight-basis allocation |
| consolidation_fee / insurance_cost / customs_cost | REAL | |
| currency | TEXT | |
| fx_rate_at_payment | REAL | **Snapshot, never a live rate** |
| notes | TEXT | |

### mkt_purchase

| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| box_id | INTEGER | Nullable until assigned to a box |
| marketplace | TEXT | |
| listing_url / external_id | TEXT | |
| purchased_at | TEXT | |
| item_price / item_currency | REAL / TEXT | |
| per_item_fees | REAL | Per-item basis allocation |
| domestic_shipping | REAL | If itemized separately |
| is_lot | INTEGER | |
| notes | TEXT | |

### mkt_purchase_line

Same shape as `mkt_observation_line`, plus allocation and outcome.

| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| purchase_id | INTEGER NOT NULL | |
| line_type | TEXT NOT NULL | `card` / `non_card` / `unidentified` |
| item_id / collection_type_id | INTEGER | Nullable; LEFT JOIN, scoped |
| label | TEXT | |
| qty | INTEGER NOT NULL | |
| weight_basis | REAL | Est. grams — drives shipping allocation |
| value_weight | REAL | Drives fee allocation; class default, overridable |
| alloc_override_amount | REAL | Explicit amount; pulls the line out of the sweep |
| allocated_cost | REAL | Derived; the per-card landed cost |
| outcome | TEXT | `listed` / `sold` / `unsold` / `kept` / `filler` |
| notes | TEXT | |

### mkt_sale

| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| purchase_line_id | INTEGER NOT NULL | |
| marketplace | TEXT | |
| listing_url | TEXT | |
| date_listed / date_sold | TEXT | Days-to-sell and sell-through derive from these |
| list_price / sale_price | REAL | Realized ≠ asked; offers matter |
| platform_fee / shipping_cost / other_fees | REAL | |
| currency | TEXT | |
| notes | TEXT | |

### Indexes

`(marketplace, external_id)` on observations; `observed_at`; `item_id` on both
line tables; `box_id` on purchases; `purchase_line_id` on sales.

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
- **Pruning, if ever needed:** an observation associated to a single catalog
  card has a library image already, so its captured image is the first
  candidate to drop. Unassociated and lot images are never pruned.

### Backup

New tables are captured automatically by the existing SQLite hot-copy backup.
No backup changes needed.

---

## Build Order

Sequenced by the actual purchase timeline, not by architectural tidiness.

### 1. Extension — Mercari US

Sweep active + sold. Local IndexedDB buffer, CSV/JSON export, no ingest, no
auth. Arm-a-card runs off a manually exported catalog index at first.

**Immediate payoff with zero capital at risk:** comps for the existing trade
shelf, informing the price tiers and Mercari CSV export that are already built.

Preceded by the ~30 minute search-response check.

### 2. Extension — Neokyo

Same capture UI, second parser, and the easier one — server-rendered, already
parsed by the POC. Feeds buy decisions for the first test run.

### 3. Backend

Order determined by whichever the calendar forces:

- **Observations + comp views** if still shopping — ingest endpoint, per-card
  price-over-time, active vs. sold series, supply depth, lot discount ratio.
- **Ledger** once a box is inbound — boxes, purchases, lines, allocation,
  outcomes, sales, the pays-for-itself number.

Both are one SPA route, admin-only, reusing the existing card picker.

### Not in v1

Comp charting beyond two simple series; price dispersion analysis; Yahoo
Auctions or other sources; thumbnail caching; any automated refresh; any
`/pcs/` exposure of price data.

---

## Open Questions

1. ~~**What does the Mercari US search response actually carry?**~~
   **RESOLVED 2026-08-28** — there is no observable search response; data is
   read off the React fiber. See Mercari US — extraction point verified. Enrich
   is **not** needed for comps, but **is** needed for buy decisions
   (`shippingPayerCode` is null in tiles).
2. **Does the sold filter return items carrying `status: "sold_out"`?** The
   field is per-item, so this is expected to work — outstanding only because
   the sold-filtered sweep has not been sampled yet. Low risk.
3. **Does loading the admin SPA leave a valid Access cookie for the API host?**
   Only matters if Option A is chosen over B.
4. **Weight-class defaults** — the initial set of value-weight classes
   (regular / special / chase?) and their multipliers. Deferred until real
   boxes show where equal-split is wrong.
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
