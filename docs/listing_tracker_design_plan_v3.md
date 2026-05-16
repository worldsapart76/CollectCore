# Listing Tracker Design Plan v3

## Overview
A cross-module listing tracker for monitoring secondhand marketplace listings
tied to wanted items in CollectCore. Tracks prices, status changes, and
provides price history for purchase decision-making.

---

## Relationship to CollectCore

### Item linkage
- `item_id` (required) — every tracked listing must reference a wanted item in `tbl_items`
- `collection_type_id` (required) — denormalized for efficient filtering
- `copy_id` (optional) — links to the specific wanted copy/edition in the
  module's sub-table (e.g., `tbl_book_copies`, `tbl_game_copies`). Set
  automatically when adding from a copy row; NULL when adding from item header
  (assignable later)

### No ownership gate (decided 2026-05-15)
A listing can be created for **any** item regardless of ownership status —
owned, wanted, catalog, or anything else. The user curates what to track
manually; the app imposes no "must be wanted" precondition. (Supersedes the
earlier wanted-validation rule and the Standardized Wanted Query that backed
it — see below.)

### Entry point
"Add price tracking" button on the item detail view. All tracked listings
across modules are then reviewable in a dedicated Listing Tracker screen.

### No automatic actions
Purchasing a tracked listing does NOT automatically update ownership status
or create copies. That remains a manual step.

---

## Item/Copy Resolution (replaces the former Standardized Wanted Query)

The "Standardized Wanted Query" (per-module `view_wanted_*` + master
`view_wanted_all`) was designed solely to power the wanted-validation gate.
With the gate removed (see No ownership gate), it is **dropped** — no
`view_wanted_*` views are built, and the former development Phase 0B is no
longer a blocking prerequisite.

What the tracker actually needs instead:

1. **Attach flow — in-context, no cross-module query.** "Add price tracking"
   launches from a specific item's detail page, where that module's own item
   and copy data is already loaded by the existing module endpoint. The
   tracker records `item_id` + `collection_type_id` (+ optional `copy_id`)
   straight from that context. No `WHERE … wanted` filter, no shared query.
2. **Display label — per-module resolver, consumed in Phase 4.** The tracker
   screen and reporting need a human-readable label per tracked item. This is
   a small per-module label function, NOT a wanted filter, and is built where
   it is used (Phase 4 UI), not as a Phase 0 prerequisite. **Photocards have
   no `title`:** the label must be composed from group + member(s) +
   source_origin + version (see `tbl_photocard_details` /
   `xref_photocard_members`), and any cross-module join keyed on `item_id`
   must scope `collection_type_id` (item ids are global across all 8 modules).
3. **Reporting** — "items with vs. without tracked listings" is derived by
   joining `tbl_tracked_listings` back to `tbl_items` + the per-module label;
   it does not need an ownership concept.

### Hard safety rule (audit 2026-05-15)
The label resolver and any tracker query are **strictly additive**. They must
NOT refactor existing photocard/trade/catalog paths
(`/admin/trade-ownership`, `_attach_copies`, the catalog/seed builders) to
route through shared tracker code. Those paths are correct today; the only way
the listing tracker can break the trade page is by retrofitting them, so don't.

---

## Supported Marketplaces

### Phase 1 (POC validated — both confirmed working)
- **Mercari US** — requires Playwright (Cloudflare blocks plain HTTP); ~17s/listing;
  extracts from `__NEXT_DATA__` JSON; prices in integer USD cents (divide by 100)
- **Neokyo** (Mercari JP + Rakuten Rakuma via proxy) — plain HTTP tier 1; ~1s/listing;
  JPY price + native USD conversion provided; thumbnail from `img.fril.jp` CDN

### Phase 2
- Pocamarket

### Phase 3
- eBay
- Amazon

### Phase 4
- Alibris
- Pango Books
- Thrift Books
- AbeBooks
- Book Outlet

---

## Marketplace Handling Strategy

Each marketplace has a dedicated parser module.

### Parser responsibilities
- Extract title
- Extract price + currency
- Extract USD conversion (if marketplace provides it natively)
- Determine availability/status
- Extract thumbnail image URL

### Approach ladder (per marketplace)
1. **Tier 1** — plain HTTP + HTML/JSON parse (fastest, cheapest)
2. **Tier 3** — Playwright headless browser (fallback for JS-heavy or anti-bot sites)

### Fallback behavior
If parsing fails:
- `status = needs_review`
- Preserve last known data
- Log error for debugging

### Per-marketplace price decoding
Price field interpretation varies by marketplace. Each parser normalizes to
a standard `(price: float, currency: str)` tuple. Examples:
- Mercari US: integer cents → divide by 100, currency = USD
- Neokyo: integer yen, currency = JPY, plus marketplace-provided USD conversion

---

## Data Model

### tbl_tracked_listings
| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| item_id | INTEGER NOT NULL | FK → tbl_items |
| collection_type_id | INTEGER NOT NULL | FK → lkup_collection_types |
| copy_id | INTEGER | Optional FK → module-specific copy table |
| source_marketplace | TEXT NOT NULL | Marketplace code (e.g., `mercari_us`, `neokyo`) |
| listing_url | TEXT NOT NULL | |
| date_added | TEXT NOT NULL | ISO 8601 |
| title | TEXT | Extracted listing title |
| thumbnail_path | TEXT | Full R2 URL (`https://images.collectcoreapp.com/listings/...`), not hotlinked |
| first_seen_price | REAL | Price at time of first successful parse |
| current_price | REAL | Most recent parsed price |
| lowest_price_ever | REAL | Running minimum — updated on each refresh |
| currency | TEXT | ISO currency code |
| price_usd | REAL | Marketplace-provided USD conversion (if available) |
| status | TEXT | See Status Values |
| target_price | REAL | User-set target price for this listing |
| priority_level | TEXT | low / medium / high / urgent |
| fee_profile_id | INTEGER | FK → marketplace_fee_profiles |
| estimated_total_cost | REAL | Calculated: price + all applicable fees |
| notes | TEXT | |
| last_checked_at | TEXT | ISO 8601 |
| last_refresh_attempt_at | TEXT | ISO 8601 |
| refresh_lock_until | TEXT | ISO 8601 — cooldown |
| next_scheduled_check_at | TEXT | ISO 8601 |
| is_active_tracking | INTEGER | 1 = active, 0 = paused |
| deleted_at | TEXT | ISO 8601 — soft-delete tombstone; NULL = live (see Retention & Deletion) |

### listing_snapshots
| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| tracked_listing_id | INTEGER NOT NULL | FK → tbl_tracked_listings |
| checked_at | TEXT NOT NULL | ISO 8601 |
| title | TEXT | |
| price | REAL | |
| currency | TEXT | |
| price_usd | REAL | |
| status | TEXT | |
| thumbnail_url | TEXT | Original URL before local cache |
| page_hash | TEXT | For change detection |
| price_changed | INTEGER | Boolean |
| status_changed | INTEGER | Boolean |
| notes | TEXT | |

### Price history queries

**Lowest price in last 30 days** (computed from snapshots at display time):
```sql
SELECT MIN(price) AS lowest_30d
FROM listing_snapshots
WHERE tracked_listing_id = ?
  AND checked_at >= date('now', '-30 days')
  AND price IS NOT NULL;
```

At weekly refresh cadence, ~4 snapshots per listing per 30-day window.
Trivially fast, always accurate, no maintenance. No denormalization needed.

**Lowest price ever**: stored as `lowest_price_ever` on `tbl_tracked_listings`.
Updated on each refresh:
```sql
UPDATE tbl_tracked_listings
SET lowest_price_ever = MIN(lowest_price_ever, :new_price)
WHERE id = :listing_id;
```

### marketplace_fee_profiles
| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| marketplace_code | TEXT NOT NULL | |
| profile_name | TEXT | |
| is_default | INTEGER | |
| currency | TEXT | |
| sales_tax_percent | REAL | |
| platform_fee_fixed | REAL | |
| platform_fee_percent | REAL | |
| domestic_shipping_flat | REAL | |
| international_shipping_flat | REAL | |
| proxy_service_fee_flat | REAL | |
| proxy_service_fee_percent | REAL | |
| import_duties_percent | REAL | |
| other_fee_flat | REAL | |
| other_fee_notes | TEXT | |
| last_updated | TEXT | |

---

## Status Values
- `active` — listing is live and purchasable
- `sold_out` — item has been sold or is out of stock
- `removed` — listing deleted or page no longer exists
- `unavailable` — listing exists but cannot be purchased
- `error_temp` — temporary parse failure
- `error_auth` — authentication required
- `needs_review` — parser returned partial data

---

## Retention & Deletion (resolved 2026-05-15)

History is kept indefinitely for future price reference — closed listings are
**never auto-purged**.

- **Listing closes** (`sold_out` / `removed`): Phase 3D sets
  `is_active_tracking = 0`. The row and all its `listing_snapshots` are
  retained. It still appears in the tracker (filterable / dimmed) as a
  historical price record.
- **Manual delete** (`DELETE /listings/{id}`): **soft delete only.** Sets
  `deleted_at` and hides the row from the default active view; the row and its
  snapshots are preserved. (Resolves the "soft vs. hard delete TBD" left open
  in the dev plan.) A hard-purge path is intentionally not built.
- **Snapshots** are append-only and never trimmed. At weekly cadence the
  volume is trivial (~52 rows/listing/year).

## Scheduling Logic

- **On add:** `next_scheduled_check_at = date_added + 7 days`
- **On successful refresh:** `next_scheduled_check_at = last_checked_at + 7 days`

---

## Refresh Logic

### Manual refresh
- Single or multi-select from listing tracker screen
- Disabled if `now < refresh_lock_until`
- After refresh: `refresh_lock_until = now + 15 minutes`

### Refresh process
1. Check cooldown
2. Identify marketplace
3. Run marketplace parser (tier ladder)
4. Extract structured data
5. Compare with previous snapshot
6. Store snapshot (set `price_changed`, `status_changed` flags)
7. Update listing fields (`current_price`, `status`, `lowest_price_ever`, etc.)
8. Download and cache thumbnail locally if changed
9. Update timestamps

---

## Batch Safety
- Sequential processing within each marketplace
- Random delay between requests (1.5–3s)
- Group by marketplace: run all Neokyo first (fast HTTP), then Mercari (Playwright batch)
- Reuse single Playwright browser context across Mercari URLs (reduces per-URL overhead)

---

## Price Calculation

```
estimated_total_cost =
    current_price
    + sales_tax
    + platform_fees
    + shipping
    + proxy_fees
    + duties
```

---

## Priority Levels
- Low
- Medium
- High
- Urgent

---

## Thumbnail Handling

Thumbnails are copied to our own storage, not hotlinked (marketplace CDN URLs
rot once a listing closes). **Stored on Cloudflare R2** under the `listings/`
prefix, served via `images.collectcoreapp.com` — same R2 client and custom
domain used for `catalog/` and `admin/` images.

- On first successful parse: download the source thumbnail, upload to R2 at
  `listings/{listing_id}_thumb.{ext}`. Store the full R2 URL in
  `tbl_tracked_listings.thumbnail_path`.
- On subsequent refreshes: re-upload only if the source URL changed between
  snapshots.
- **Not** in the backup ZIP (Railway local FS is ephemeral; the old
  "backed up with `images/`" model no longer applies). R2 is independently
  durable; a lost thumbnail self-heals on the next successful refresh.

---

## Change Detection (Passive)

v1 uses passive indicators only:
- Column/badge in the listings table showing price deltas (e.g., "↓ $12 this week")
- Visual indicator when `current_price <= target_price` (target hit)
- Visual indicator when `current_price <= lowest_price_ever` (new all-time low)
- 30-day low badge when current price equals 30-day minimum

Future enhancement: in-app notifications, external push.

---

## UI Structure

### Entry point
"Add price tracking" button on item detail view (visible when item has
≥1 wanted copy/edition). Launches URL input + marketplace auto-detection.

### Main listing tracker screen
Accessible as a top-level tab. Shows all tracked listings across modules.

Columns:
- Thumbnail
- Title
- Open (↗ button — opens `listing_url` in a new tab directly from the row, no
  need to enter the detail modal)
- Module (collection type)
- Marketplace
- Current price
- Lowest 30-day price
- Lowest ever price
- Target price
- Estimated total cost
- Priority
- Status
- Date added
- Last checked
- Next scheduled

Filterable by: module, marketplace, priority, status, target hit (yes/no),
active/closed.

**URL access ergonomics** (this screen *is* the "all my tracked URLs in one
place" report):
- Per-row ↗ open button (above) for one-click access to any listing.
- **Group-by-card toggle** — collapse rows under their parent item so every
  listing URL for a card sits together (a card may have several marketplace
  listings tracked at once).
- **Bulk actions on selected rows:** "Open all" (opens each `listing_url` in a
  new tab) and "Copy all URLs" (newline-joined to clipboard).
- Closed/sold listings remain listed (filterable, dimmed) — the page doubles
  as the historical price-reference archive, never auto-pruned.
- Optional CSV export of the current filtered view (URLs + price columns) as a
  later enhancement; the page itself satisfies the "pull a report" need.

---

## Implementation Prerequisites

- Photocard copy/edition sub-table must be implemented before photocards
  can participate (other modules ready now)
- Playwright + Chromium required in deployment environment
- `brotli` Python package required for Neokyo HTTP decompression

---

## Cloud Hosting Decisions (resolved 2026-05-15)

Supersedes the prior "Open Question: Cloud Hosting Impact" (raised 2026-04-21,
when the listing tracker was designed against a local/Unraid deployment).
CollectCore is now Railway + Cloudflare R2 (ARCHITECTURE.md Decision A).
Decisions:

- **Playwright + Chromium on Railway — DECIDED: run on Railway, no pre-spike.**
  Built into a Railway **Dockerfile** (Playwright base image, or python base +
  `playwright install --with-deps chromium`). The current Procfile/Nixpacks
  build switches to a Dockerfile for the backend so Chromium's system deps are
  reliably present. **Accepted risk:** if datacenter IPs or memory limits prove
  unworkable in production, fall back to the split deployment below — this is
  the main rework exposure of the no-spike decision and is accepted knowingly.
- **Memory containment:** weekly batch only; reuse a single Playwright browser
  context across the Mercari batch (see Batch Safety). Chromium is ~200-400MB
  resident while a batch runs and idle otherwise — acceptable for the Railway
  Hobby plan at weekly cadence.
- **Scheduler architecture — DECIDED: in-process periodic sweep.** No separate
  worker service and no Railway cron. A periodic in-process task (hourly tick)
  queries listings where `next_scheduled_check_at <= now`. Schedule state lives
  in SQLite (`next_scheduled_check_at`), so the sweep is **resilient to Railway
  redeploys/restarts** — a restart just resumes from DB state on the next tick.
- **Marketplace IP reputation — accepted risk.** The POC succeeded from a
  residential IP; Railway runs on datacenter (GCP) IPs, which carry a higher
  block risk for Mercari behind Cloudflare. No pre-spike (per the no-spike
  decision). If production scraping is blocked, invoke the split-deployment
  fallback.
- **Scraped thumbnails — DECIDED: R2.** Stored on Cloudflare R2 under a
  `listings/` prefix (consistent with the `catalog/` and `admin/` image
  prefixes), served via `images.collectcoreapp.com`. Railway's local FS is
  ephemeral, so the design plan's original "local dir, backed up with
  `images/`" approach no longer holds — see Thumbnail Handling.
- **Backup:** `tbl_tracked_listings`, `listing_snapshots`, and
  `marketplace_fee_profiles` are captured automatically by the existing SQLite
  hot-copy backup (new tables need no backup changes — per CLAUDE.md Backup &
  Restore). Thumbnails are durable independently on R2 and are intentionally
  **not** in the backup ZIP (regenerable on next refresh if ever lost).
- **Split-deployment fallback (contingency, not initial build):** if Railway
  IPs are blocked, move only the scraper to a worker on the home network /
  Unraid (the environment the POC already validated from a residential IP),
  posting parsed results to Railway via an authenticated internal API. The rest
  of CollectCore stays on Railway. Documented here so the data model and
  refresh API are designed to allow it; not built unless triggered.

---

## Guest-Visible Price Data (photocard-only, resolved 2026-05-15; retargeted 2026-05-15)

Photocard price data can optionally be exposed to the guest tier. Gated OFF
by default — flip it on once there's enough listing data to be worth sharing.

> **Retargeted to the `/pcs/` tier.** The old WASM-SQLite `/guest/` tier is
> being deprecated (`C:\Users\world\.claude\plans\guest-cloud-accounts.md`,
> P8 sunset deletes `/catalog/*`, `seed_builder.py`, and the seed-regen
> path). **No new functionality is added to `/guest/`.** The earlier
> snapshot+delta / seed / `guest_catalog_listings`-mirror design here is
> withdrawn — it would have been built on infrastructure slated for deletion.
> This whole feature now targets the authenticated server-read `/pcs/` tier
> instead, and is therefore **dependent on the `/pcs/` tier being built
> first.**

### Scope
- **Photocard-only**, matching both the catalog and the `/pcs/` tier
  (photocard-only by charter). Book/game/etc. listings are admin-only and
  never exposed to guests. Keyed by `tbl_items.collection_type_id = photocards`.
- Closed listings are kept forever (see Retention & Deletion); a closed
  listing simply shows `status = sold_out/removed`. Read-only for guests —
  no guest writes, ever.

### What guests get — a lean per-card summary, not raw history
A **summary per tracked listing**: `source_marketplace`, `listing_url`,
`current_price`, `currency`, `lowest_price_ever`, `status`, `last_checked_at`,
`thumbnail_path`. Full `listing_snapshots` history stays admin-side only.

### Mechanism — plain server-side read on the `/pcs/` tier
No snapshot+delta, no seed extension, no mirror table, no
`catalog_version` on listings. The `/pcs/` tier already reads `tbl_items` +
`tbl_photocard_details` server-side and joins the caller's annotations by
`catalog_item_id` (per the guest-cloud-accounts plan, which explicitly does
*not* use the delta machinery). Guest-visible price data is just one more
read in that same path:

- A `/pcs/`-tier read endpoint (or an extension of its existing photocard
  read) LEFT JOINs the lean listing summary from `tbl_tracked_listings` to
  the photocard via `tbl_items.catalog_item_id`, **only when the global
  publish toggle is on**.
- Strictly additive to the **new** tier. Touches no `/guest/` code, no
  `/catalog/*` endpoint, no `seed_builder.py` — all of which are being
  retired.

### Publish gate — single global toggle, OFF by default
- One admin setting (e.g., `catalog_publish_listings`, default `0`),
  surfaced wherever the admin manages photocard/guest publishing.
- OFF (default): the `/pcs/` read omits all listing data. Tracking still
  works fully admin-side; nothing reaches guests.
- ON: every photocard tracked-listing summary is exposed via the `/pcs/`
  read (all-or-nothing — no per-listing/per-card selection). Because it's a
  live server read, turning the toggle off immediately stops exposure (no
  already-synced copies to worry about — there is no guest-side mirror).

### Dependencies
1. The `/pcs/` tier must exist (guest-cloud-accounts plan, currently a draft
   — not yet built).
2. Real listing/price data must exist — i.e. after the refresh engine
   (dev-plan Phase 3).
Tracked as dev-plan **Phase 8**. The admin-side tracker (Phases 1–7) has no
dependency on the guest tier and is unaffected.

## POC Validation (2026-04-16)

Proof of concept at `C:\Dev\listing-parser-poc\` validated both Phase 1
marketplaces against 10 real URLs:

| Marketplace | Tier | Time/URL | Fields | Status accuracy |
|---|---|---|---|---|
| Neokyo (5 URLs) | 1 (HTTP) | ~1s | 5/5 (incl. thumbnail) | 5/5 |
| Mercari US (5 URLs) | 3 (Playwright) | ~17s | 5/5 | 5/5 |

Key technical discoveries:
- Mercari US prices are integer USD cents in `__NEXT_DATA__` JSON
- Neokyo provides native USD conversion alongside JPY price
- Neokyo thumbnails come from `img.fril.jp` (Rakuma CDN), class `cloudzoom`
- Neokyo deleted listings: 403 + redirect to homepage
- No anti-bot challenges encountered on Playwright runs
