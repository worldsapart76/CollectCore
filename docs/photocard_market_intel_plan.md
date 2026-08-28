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

**Pre-build check (~30 min, before the capture design is finalized):** open a
Mercari US search page with network inspection and confirm what the search
response actually carries. Full item objects means sweeps are rich and detail
pages are never needed. Render-only means price + id + sold-state per tile —
still enough for comps, but it changes what the enrich tier is for.

### Enrich — opt-in, throttled

For the handful of listings seriously being considered, the extension queues
those ids and fetches detail pages in the background using the existing
session: condition, description, seller, shipping.

**This is automated fetching** and is paced accordingly — a few per minute,
jittered, capped per session. Reserved for buy candidates, never run across a
whole result set. Sweeping pages already being viewed at human pace is a
different posture from bulk background fetching, and the cap is what keeps that
distinction real.

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

## Arming a card, and the guard against mis-tying

1. **Arm a card** in the extension panel before sweeping, searched against a
   locally cached copy of the catalog index. The card's **thumbnail stays
   pinned** while sweeping — photocard versions differ subtly, and visual
   comparison is the actual matching mechanism.
2. **Nothing is captured by default.** Each result tile gets an overlay toggle.
   For a clean search, "select all → deselect the wrong ones"; for a noisy one,
   click-to-include.
3. **Batch commit** per page.

### The query-change guard

The armed card **persists across pagination but clears when the search query
changes.** Paging through 200 results for one card is safe; wandering into a
new search while still holding the previous card — and stamping it onto
strangers — is structurally prevented.

### Escape hatches

Neither of these loses data to indecision:

- **Unsure** — captures the observation with no card link, resolved later in
  the app.
- **Lot** — flags the listing as a multi-card bundle instead of forcing a
  single card link. Its own pipeline, not an error state.

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

### Thumbnails

Deferred. Source CDN URLs rot when listings close, but at this scale a broken
thumbnail on a historical comp is not worth an R2 upload path. If it becomes
annoying, follow v3's approach: R2 under a `listings/` prefix via
`images.collectcoreapp.com`, not in the backup ZIP, self-healing on recapture.

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

1. **What does the Mercari US search response actually carry?** Gates whether
   the enrich tier is a nice-to-have or a requirement. Resolved by the ~30
   minute check before the capture design is finalized.
2. **Does loading the admin SPA leave a valid Access cookie for the API host?**
   Only matters if Option A is chosen over B.
3. **Weight-class defaults** — the initial set of value-weight classes
   (regular / special / chase?) and their multipliers. Deferred until real
   boxes show where equal-split is wrong.
4. **Est. grams per line type** — a small default table (card 5g, album 300g,
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
