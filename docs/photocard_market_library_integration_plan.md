# Photocard Market ↔ Library Integration — Design & Implementation Plan

**Status:** **BUILT 2026-08-31** — phases 0-4 complete. One item stays open and
deliberately deferred: the value ladder's era rung (defect 1), plus the
`_sold_landed` question (defect 3) that surfaced during phase 0.
**Scope:** photocards, admin only. No `/pcs/` behavior change, no catalog or
guest-seed change, no new ownership statuses.

Three connected pieces:

1. **A shared vocabulary** for the four money quantities, and a rename pass to
   make the code and the screen agree with it.
2. **Removing the sell price tier system** (`tbl_photocard_pricing` +
   `lkup_photocard_price_tiers`), replacing the one thing that consumed it —
   the trade CSV's price column — with a comp-derived list price.
3. **Wiring the library to the market module**: a `$` badge, a has-comps
   filter, a value block in the card detail modal, and a deep link into the
   market workspace.

Two known defects are documented under [Open defects](#open-defects). Both
distort numbers currently being used to make purchase decisions. One is **live
and fixed here in phase 0** (buy-side marketplaces are polluting the sell-price
median); the other — the era rung — is **deferred to its own pass**, because it
needs to be isolated enough to compare before and after.

---

## Vocabulary

The confusion this plan exists to end: one word, "sell", currently means two
different quantities depending on which screen you read it on. Four rungs, and
every one of them is already computed correctly somewhere in `market.py` — only
the naming is broken.

| Term | Means | Direction |
|---|---|---|
| **Cost** | What I pay, or have previously paid, for a card — landed, including proxy fees and shipping. Includes backfilled estimates for the existing trades pile. | buy |
| **List price** | What I actually type into Mercari. Grossed up so an accepted offer still clears the sell price. | sell |
| **Sell price** | What the card actually sells for on **Mercari US**. This is what a sold comp observes. | sell |
| **Net proceeds** | What lands in my account: sell price minus marketplace fees. | sell |

The chain, in both directions:

```
list price  −offer discount→  sell price  −marketplace fees→  net proceeds
net proceeds  −cost  =  profit
```

`list_price_for(target_net, fm)` already walks the whole chain in one hop, and
its intermediate variable is literally named `gross` — that value *is* the sell
price. Nothing about the arithmetic needs to change.

### Rename pass

API field names and column labels move to the vocabulary. This is the part that
makes the module discussable; it is not cosmetic, because today's grid column
labelled `sell` holds net proceeds while the actual sell price has no column at
all.

Applied 2026-08-31:

| Today | Becomes | Rung |
|---|---|---|
| `paid_cents`, and the `paid` container | `cost_cents`, `cost` | cost |
| `landed_cents`, `per_card_cents` | unchanged — already cost, landed | cost |
| `_sold_landed`'s `median_cents` | `landed_median_cents` | cost |
| `sold_median_cents`, `_net_sold_by_item`'s `median_cents` | `sell_price_cents` | sell price |
| `sell_net_cents`, `net_cents`, `sold_median_net` | `net_proceeds_cents` | net proceeds |
| `required_list_cents` | `list_price_cents` | list price |
| `flip_cents` | `flip_profit_cents` | profit (held) |
| `arb_cents` | `resell_profit_cents` | profit (sourced) |
| `target_profit_cents` | unchanged | profit |

Two deviations from the table as first drafted:

- **`sold_stats.median` kept its name.** It comes from a generic `stats()`
  helper shared with the *active* series, so renaming the key would have put a
  sell-price name on active asks. Its container already disambiguates it —
  `d["sold"]["median"]` beside `d["active"]["median"]` reads correctly.
- **`_sold_landed`'s `median_cents` was renamed** though the table did not ask.
  It is a landed-**cost** median, and leaving a bare `median_cents` sitting
  beside a newly-named `sell_price_cents` would have preserved exactly the
  ambiguity this phase exists to remove.

Grid columns become `… cost · buy · sell · net · flip · arb …` — **sell and net
sit adjacent on purpose**, because the gap between them is the fee bite and
that is the number people misjudge. `paid` is renamed `cost`.

Tooltips get corrected in the same pass: `flip` and `arb` currently say
"sell − paid" and "sell − cheapest buy" while both are computed against net
proceeds.

Blast radius is `market.py`, `MarketIntelPage.jsx`, and the three market test
suites. The capture extension does not read any of these fields.

---

## Decision 1 — remove the sell price tier system

### Why it goes

Built 2026-08-17 as a minimal stand-in so there would be *some* price to do
analytics against. **It has never been used in practice** — no card has ever
carried a tier or a custom price. The comp capture that replaced its purpose is
now live and answers the same question from observed data.

Verified before proposing removal:

- **`market.py` has zero references** to `tbl_photocard_pricing` or
  `lkup_photocard_price_tiers`. Nothing in the market module reads them.
- **`mkt_cost_tier` / `mkt_item_cost` is a different table pair.** It shares the
  tier-XOR-custom shape and the `t1..t4` code vocabulary — which is exactly why
  it looks derived — but holds acquisition **cost** ($2.00–$4.00), not ask price
  ($4.00–$12.00). It **stays**: it is the cost column in the grid and the cost
  side of the lot analyzer.
- **Pricing never reaches guest.** No references in `seed_builder.py`,
  `catalog.py`, or `pcs.py`. Removal cannot touch `/pcs/` or the catalog delta.

### What comes out

| Surface | File |
|---|---|
| `lkup_photocard_price_tiers`, `tbl_photocard_pricing` | `backend/sql/schema.sql` |
| Tier CRUD + `/{id}/price` endpoints | `backend/routers/photocards.py` |
| `price_tier_id` / `price_cents` / `price_source` in the row shape | `backend/routers/photocards.py` |
| "Price Tiers" admin tab | `frontend/src/pages/AdminPage.jsx` |
| Tier dropdown in bulk edit | `frontend/src/components/photocard/PhotocardBulkEdit.jsx` |
| Price row in the detail modal | `frontend/src/components/photocard/PhotocardDetailModal.jsx` |
| 5 pricing functions | `frontend/src/api.js` |
| `migrate_photocard_pricing.py` | `backend/` |
| `photocard_pricing_and_trade_export_plan.md` → marked superseded | `docs/` |

**The tables are NOT dropped automatically.** This was planned as a migration
and changed during the build, because a `DROP TABLE` on boot is precisely the
restart-alters-data behaviour this project forbids — it would fire on every
environment the moment a deploy landed, including ones this repo cannot inspect.
"It was empty in dev" is not evidence about prod.

So the code removal simply **orphans** them: nothing reads or writes them any
more, and `backend/drop_photocard_pricing.py` disposes of them as a deliberate
manual act against a database you can see. It is dry-run by default and refuses
to proceed if `tbl_photocard_pricing` holds rows unless forced — that guard
ignores `lkup_photocard_price_tiers`, which carries four seeded rows in every
database ever created, because a guard that trips every time just teaches you to
force past it.

Both delete paths in `photocards.py` had to drop their
`DELETE FROM tbl_photocard_pricing` regardless: `schema.sql` no longer defines
the table, so on any newly created database those statements would have raised
*no such table* on every card deletion.

### What replaces it

The only live consumer is the trade CSV's `price` column
([`export.py:179-198`](../backend/routers/export.py#L179-L198)). Because no tier
was ever assigned, **that column has been exporting blank since the day it
shipped** — so nothing regresses.

It becomes **`list_price`**, derived per card from comps:

```
list_price = list_price_for(net_proceeds_median, sell_fee_model)
```

Padded for offers rather than the raw sell price, because the CSV exists to be
pasted into a Mercari listing and an unpadded ask does not survive an accepted
offer.

The existing semantics are preserved exactly: **a card with no comps exports
blank**, so the CSV keeps doubling as a "what still needs pricing" worklist. The
meaning of blank simply shifts from "no tier assigned" to "no comp yet" — which
is the more useful of the two.

---

## Decision 2 — library integration

Not scrimped: several hundred comps are planned in the near term (cards to sell,
cards wanted, plus resale candidates), so this is built as a real surface rather
than a link.

### `GET /market/summary`

One new endpoint. A **sparse** map — only cards that have market data — loaded
once alongside the library and joined client-side.

```json
{ "cards": { "8823": { "n_sold": 3, "sell_price_cents": 1400,
                       "net_proceeds_cents": 1153, "n_active": 5,
                       "last_seen": "2026-08-29T…", "cost_cents": 300 } } }
```

This is the load-bearing choice, for two reasons:

- **One source.** The badge, the filter, the caption and the modal all read the
  same map, so they cannot disagree about whether a card has comps.
- **No per-open call.** `/market/comps/{item_id}` **404s** for a card with no
  data ([`market.py:800`](../backend/routers/market.py#L800)), so the modal must
  never call it speculatively. Reading from a preloaded map sidesteps that
  entirely.

**Scope is cards with a market line — not `/grid`'s scope.** `/grid` also
includes Wanted cards with no data, as a reminder of where to go browsing. The
library must not badge those: a `$` on a card with nothing behind it is a claim
the user cannot check without clicking. A proxy-only card *does* appear — a live
Neokyo ask is a place to buy it, which is market data even with no sell price.

**`n_active` counts every marketplace**, unlike `vs_active` in the card detail.
The two answer different questions on purpose: in the library it is "can I get
one right now", which a proxy answers, while competition is "who am I up against
where I would list", which a proxy never is.

**Corrected 2026-08-31, after the first cut shipped:**

- **The payload carries the buy price.** The first version omitted buy-option
  resolution as a leanness win, and that was wrong. A card that has never sold
  but sits inside a live lot has no sell price and no cost basis, so the modal
  showed three dashes while `/grid` knew perfectly well it was buyable at $19 a
  card. For that card the cheapest route is the *whole* answer. `buy_lot_size`
  and `buy_landed_cents` travel with it, because a per-card figure inside a
  12-card lot is a $228 decision, not a $19 one.
- **`n_active` counts DISTINCT listings whose latest sighting is active.** It
  summed sightings, so one listing captured on three days read as three
  listings on the shelf; and "has ever been active" kept sold-out listings
  counted forever. Now the same rule `_buy_options` uses — it is the same
  question, and the two must not disagree.
- **Marketplaces resolve to names.** `mercari_us` was reaching the modal as
  written, the same wart already fixed once in the resell view.

Admin-gated — the library is shared with `/pcs/`, and `mkt_*` must never reach
it. There is no app-level auth check: `/market/*` is not a Cloudflare Access
bypass path, so it is already admin-only at the edge, and auth code in the app
is what the deployment model exists to avoid. `getMarketSummary()` returns an
empty map on a non-admin bundle instead of throwing — absence from the map is
already the "no data" answer, so it degrades to exactly the right behaviour
(no badge, no filter matches, no value block) without a guard at each caller.

The library already loads all cards in one call and filters client-side
([`PhotocardLibraryPage.jsx:132-180`](../frontend/src/pages/PhotocardLibraryPage.jsx#L132-L180)),
so a sparse join costs one request and no pagination work.

### `$` badge, replacing `B`

All four thumbnail corners are occupied: bottom-left ownership, bottom-right
other statuses, top-left `B` (has back image), top-right `★` (special). The
back-image badge is the least useful of the four and is **replaced by `$`** when
comp data is present.

**The back-image filter is unaffected and stays exactly as it is.** Verified:
the filter reads `card.back_image_path` directly in
[`filterUtils.js:61-63`](../frontend/src/utils/filterUtils.js#L61-L63); the badge
is three lines in `PhotocardGrid.jsx` (the `hasBack` prop at 220, the parameter
at 255, the render at 307). They share nothing. Only those three lines change.

### Filter, caption, modal, link

- **"Has comps"** in the filter sidebar. This is the actual verb behind "see what
  cards have comps" — one click, with a count in the header.
- **Caption value line** (captions are on by default) showing the sell price and
  comp count.
- **Detail modal**: the removed Price row is replaced by a three-figure block —
  **cost** / **sell price** / **net proceeds** — with n and last-seen, plus the
  current asking range. A card with no comps gets one quiet line saying so, not
  an empty state with machinery in it.
- **Deep link** to `/market-intel?item={item_id}`, opening straight into the
  card overlay. Offered only when comps exist. The market grid's scope is
  cards-with-data ∪ wanted, so a comped card is always reachable. The param is
  stripped from the URL on arrival, so closing and reopening the overlay is not
  fought by a param that keeps reasserting itself.

  **Client-side navigation, never an anchor.** The return trip depends on
  library filter state living in a module-level store, and a full page load
  resets it — you would come back to a different list than the one you left. So
  the link is a `useNavigate()` call, not an `<a href>`.

**Not covered by automated tests.** Phase 3 is entirely UI, and the repo has no
frontend unit harness — the `.mjs` suites cover the extension's pure libraries,
and `photocardFiltering.js` imports a `.jsx` component, so Node cannot load it
without a bundler. Verified instead by: all three bundles building (admin,
guest, `pcs`), a clean ESLint parse, and the phase 2 contract tests underneath.
The visible behaviour needs eyes on it.

---

## Decision 3 — Pocamarket is buy-only

`lkup_mkt_marketplaces.side` for `pocamarket` moves `both` → `buy`. It is a
place to source cards for the personal collection, never somewhere listings are
posted.

### Pocamarket official listings are persistent, not transactional

A structural difference from every other source, and it changes what its data
means. In Pocamarket's **official** section there is **one listing per card**,
and its price and availability fluctuate over time. It is not a Mercari-style
listing — one physical item, sold once, terminal.

So on an official Pocamarket listing:

- **"Out of stock" is a restock cycle, not a transaction.** No quantity, no
  buyer, no sale price. It means the shop's inventory ran out — most likely
  because people bought it.
- **The listing comes back.** It must never be marked `gone` / `delisted_at`
  when out of stock; that would permanently remove a card's cheapest buy route
  over a temporary condition.
- **Repeat captures build a genuine time series.** Because the listing id is
  stable, each capture adds a `mkt_sighting` row against the same
  `mkt_listing` — price and availability over time for one card. That is a
  richer shape than any other source provides, and the schema already stores
  it with no change.

Already handled correctly: [`_buy_options`](../backend/routers/market.py#L1849)
scopes to the **latest** sighting per listing, so an oscillating listing leaves
the buy options when captured out of stock and returns when captured back in
stock. No change needed.

### The used (third-party) marketplace is out of scope — deliberately

Used listings live at `pocamarket.com/used/item/229291`, not
`pocamarket.com/search/detail/498832`. They behave conventionally: individual
sellers, individual items, and a sold-out listing there *is* a real sale — but a
KRW sale in Korea, still not a US sell comp.

**Decision: not captured.** Used items are not handled the same way as official
cards, and are not a sourcing route. The current behaviour already matches that,
so nothing is built and nothing is disabled — but the reason is recorded here
because the *way* it is currently excluded is accidental, and the obvious fix if
it is ever revisited is a trap.

**They cannot be captured at all today, silently.**
`detailPath: /\/search\/detail\//`
([`capture.js:274`](../extension/content/capture.js#L274)) rejects the used
path, so `detailIdFromUrl()` returns null and the page is never recognised as a
listing. The `tiles` selector `a[href*="/search/detail/"]` misses used tiles for
the same reason. The content script loads — host permissions cover all of
`pocamarket.com` — it just never finds anything. No error, no capture.

**Widening the regex naively would merge listings.** `mkt_listing` is
`UNIQUE (marketplace, external_id)`, and the two sections have independent
sequential id namespaces. A single pattern matching both would file
`/used/item/229291` and `/search/detail/229291` as the same listing — two
different cards' price and availability histories collapsed into one row, which
would then read as a wildly oscillating price on whichever card won. Compounding
it, `urlForListing` prefers `SITE.urlFor(id)` over the anchor's own href
([`capture.js:437-438`](../extension/content/capture.js#L437-L438)), so every
rebuilt URL would point at the official section regardless of origin. (Neokyo
deliberately has no `urlFor` for exactly this class of reason.)

**So if used capture is ever revisited**, widening the regex is the wrong move.
The id must be namespaced at the source — `used:229291` against a bare `498832`,
or a prefix on both — with `urlFor` branching on it, making the collision
structurally impossible rather than a thing to remember. And settle first
**whether used items ship under the same consolidated box** ($12 up to 40
cards): the fee model is per-marketplace, so if used ships separately it needs
its own marketplace code rather than sharing one with namespaced ids.

None of this affects phase 0 — both regimes are `side = buy`, so neither can
reach the sell-price median either way.

Consequences of `side = buy`, all correct:

- stays in buy options (`side IN ('buy','both')` at market.py 644, 847, 1867)
- leaves the active-competition set (`side IN ('sell','both')` at 778) — asks
  there were never competing with a Mercari US listing
- **orphans no fee rows**: Pocamarket already carries only buy-side components
  (a single "Shipping + handling" line), the sell-side rows having been removed
  earlier as intentionally inapplicable

---

## Open defects

Flagged with numbers so they are not rediscovered from scratch. **Both are
actively distorting current estimates.** Neither is fixed in this plan.

### 1. The value ladder's era rung is too coarse to carry its weight

`_value_ladder` falls back to "net proceeds median of the card's era", where era
is a two-way split at `DEFAULT_ERA_CUTOFF = 2020-12-31`.

Dev-measured (dev lags prod; treat as shape, not exact):

| bucket | origins | cards |
|---|---|---|
| new (2021+) | 34 | 7,071 |
| **no start_date — silently reads as `new`** | 16 | 806 |
| old (≤2020) | 22 | 2,147 |

**78% of the catalog lands in one bucket**, including 806 cards whose origin
carries no date at all. Several hundred comps will therefore produce a single
median standing in for ~7,900 cards regardless of member, origin, rarity, or
version type. This is the flatness making the lot numbers wrong.

The fix is not a better bucket but a **fallback chain that reports which rung it
used and how thin it was**: own comps → same origin (n≥3) → version-type × era
(n≥5) → era → pooled. "Estimated from 4 comps in this origin" is actionable; a
bare median from an invisible bucket is not.

### 2. The sell-price pool has no side filter — ✅ FIXED, phase 0, 2026-08-31

[`_net_sold_by_item`](../backend/routers/market.py#L1803) pools sold sightings
from **every** marketplace and then picks the modal one for the fee model.

`comps_for_card` already applies the right rule to the *competition* set —
active asks are restricted to `side IN ('sell','both')`, on the reasoning that a
proxy is somewhere you buy and never somewhere you list. The **sold** set never
got the same treatment.

This is not hypothetical and it does not depend on the sold/gone outcome
endpoint (which has never been used). **The capture extension sets sold state
itself, from page text:**

- Neokyo — [`capture.js:132`](../extension/content/capture.js#L132) matches
  `out of stock` / 売り切れ / 販売終了
- Pocamarket — [`capture.js:323`](../extension/content/capture.js#L323) matches
  `sold out` / 판매완료 / 품절

Both emit `status: 'trading'`, which
[`background.js:273`](../extension/background.js#L273) maps to
`listing_state = 'sold'`. So every out-of-stock proxy listing captured so far
has entered the sell-price median as a JPY-denominated Japanese domestic price
converted to USD. Domestic JP levels run **below** US resale, so the error
drags sell price **down** — understating every flip and arb margin, and
understating the era median that ~7,900 cards inherit.

**Why it can be fixed cheaply and early:** this is a *read-time pooling* error,
not corrupted data. The sightings are accurate records of what they are. Adding
`AND m.side IN ('sell','both')` to `_net_sold_by_item` corrects every existing
row retroactively with no migration.

Worse than a currency mismatch on the Pocamarket side: an **official** Pocamarket
listing is persistent and its stock fluctuates (see Decision 3), so "sold out"
there is not a sale at *any* price — it is a restock cycle with no quantity and
no transaction. Pooling it into a median of sale prices is not merely the wrong
market, it is not a sale.

Capture behavior stays as-is on purpose: "sold out on a proxy" is real signal —
it is exactly the input the Pocamarket popularity idea in the backlog wants. It
just must never count as a US sale.

Promoted out of the deferred work into **phase 0**, because every further
capture adds more contamination. The era rung (defect 1) stays deferred.

---

### 3. `_sold_landed` pools across marketplaces — left alone, on purpose

Found while doing phase 0 and **deliberately not changed**, because it is a
different question with a defensible current answer.

[`_sold_landed`](../backend/routers/market.py#L1946) feeds Buy to Keep with
"what buyers actually paid for this card, all in". It is explicitly a **buy**-side
figure — it uses `fee_model(..., "buy")` — and it pools sold sightings from every
marketplace. For Neokyo that is *correct*: a proxy listing going out of stock
means the underlying Mercari JP item really sold, and somebody really paid that.
Applying the phase 0 side filter here would delete true information.

But it is wrong for Pocamarket's **official** section, where "sold out" is a
restock cycle and nobody paid anything at a known price.

So the distinction `_sold_landed` actually needs is not `side` at all — it is
**whether a marketplace's sold state represents a transaction**. That is a
per-marketplace property with no column today, and inventing one mid-phase-0
would have been scope creep on a change whose whole value was being small and
measurable. Left for the era pass, which is already touching how sold data is
weighed.

Live impact is bounded: it affects the Buy-to-Keep comparison only, never the
sell price, and only for Pocamarket official rows.

## Phases

| # | Work | Ships with |
|---|---|---|
| **0** | ✅ **BUILT 2026-08-31** — side filter on `_net_sold_by_item`, on `comps_for_card`'s sold stats and its sell fee-model pick, + Pocamarket `side` → `buy` | additive guarded migration in `db.py` |
| 1 | ✅ **BUILT 2026-08-31** — vocabulary rename across `market.py`, `MarketIntelPage.jsx` and four test suites; sell price gains its own column beside net | frontend rebuild |
| 2 | ✅ **BUILT 2026-08-31** — `GET /market/summary` + `getMarketSummary()` | — |
| 3 | ✅ **BUILT 2026-08-31** — `$` badge (replacing `B`), Market filter section, caption value line, modal value block, deep link | rebuild of all three bundles |
| 4 | ✅ **BUILT 2026-08-31** — price tier system removed; CSV `price` → comp-derived `list_price` | **no** drop migration — see below |
| — | **Deferred:** era ladder rung (defect 1) | own pass, measured before/after |

Phase 0 goes first because every further capture adds contaminated sell comps,
and because the two halves are the same idea — a buy-side marketplace is not a
place your card sells. Doing them together means one before/after comparison
rather than two.

Phase 4 goes last so the CSV never sits without a price source.

---

## Verification

0. **Phase 0, measured before and after:** count sold sightings on buy-side
   marketplaces, and record the sell price + era medians on both sides of the
   change. A non-zero count confirms the contamination was real; the medians
   should rise. Capture is unchanged — the same sightings still exist, they are
   simply no longer pooled as US sales.
1. `market.py` still has zero references to `tbl_photocard_pricing` after the rename pass.
2. The grid shows sell price and net proceeds as separate columns, and they differ by exactly the sell fee model.
3. `list_price_for(net) → sell price → net` round-trips within a cent.
4. Back-image filter returns identical card sets before and after the badge swap.
5. A card with comps shows `$`; a card without shows no badge; a `/pcs/` build shows neither and issues no `/market/*` request.
6. Opening a comped card's modal issues **no** additional request.
7. The deep link opens the market overlay on the right card, and returning to the library preserves filters and sort.
8. Trade CSV: a comped card exports a padded `list_price`; an uncomped card exports blank.
9. Pocamarket disappears from active-competition asks and remains in buy options.
10. Dropping the pricing tables leaves the catalog delta and guest seed byte-identical.

---

## Backlog

Not built, not scheduled.

- **Some price info exposed to `/pcs/` users.** Probably the current available
  purchase price plus links — *not* cost, and not the resale analytics. Needs
  its own review and scoping before anything is designed.

  Recorded here because it cuts directly against a standing rule: `mkt_*` is
  admin-only **by construction**, and cost in particular is an admin fact. Any
  exposure must be a **curated projection** built for `/pcs/` — never widening
  an existing table or endpoint, and never a column on
  `tbl_photocard_details`, which `catalog.py` (`SELECT *`) and `seed_builder.py`
  (PRAGMA-driven copy) would ship to guests automatically with nothing in the
  diff to warn you. Decide which single figure and which links, then design the
  projection around exactly those.

- **Pocamarket as a popularity signal.** Sold-out status plus save counts as a
  way to direct buy/resell research.

  Better positioned than it first looked. Because an official listing is
  persistent (Decision 3), the real signal is not the current flag but the
  **stock-out transitions over time** — how often a card has gone
  active → sold out → active. That is derivable from `mkt_sighting` rows
  already being captured, with no schema change, and after phase 0 those rows
  are no longer masquerading as US sales.

  **The actual gap is capture cadence, not data model.** One capture is one
  point; a transition needs at least two, and nothing currently prompts a
  re-capture of a listing already seen. Whatever gets built here has to answer
  that first. Save counts are separately unexamined — needs a look at whether
  the extension can see them at all.
- **Bulk "list prices from comps" sweep** over the trade shelf. Worth it once
  coverage is broad; with a few dozen comps the per-card path covers it.
- **`sell_price` column in the trade CSV** beside `list_price`, so the worksheet
  carries the evidence next to the ask.
