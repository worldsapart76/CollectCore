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

### Wanted validation
A listing can only be created for an item that has at least one copy/edition
in "wanted" ownership status. Validated via a standardized wanted query
(see Standardized Wanted Query section below).

### Entry point
"Add price tracking" button on the item detail view. All tracked listings
across modules are then reviewable in a dedicated Listing Tracker screen.

### No automatic actions
Purchasing a tracked listing does NOT automatically update ownership status
or create copies. That remains a manual step.

---

## Standardized Wanted Query

Per-module SQL views emitting a common shape, plus a UNION'd master view:

```sql
-- Per-module view (example: books)
CREATE VIEW view_wanted_books AS
SELECT
    i.collection_type_id,
    i.id AS item_id,
    bc.id AS copy_id,
    bc.ownership_status_id,
    NULL AS target_price,
    i.title || ' — ' || COALESCE(bc.format, '') AS display_label
FROM tbl_items i
JOIN tbl_book_copies bc ON bc.item_id = i.id
JOIN lkup_ownership_statuses os ON os.id = bc.ownership_status_id
WHERE os.name = 'Wanted';

-- Master view
CREATE VIEW view_wanted_all AS
    SELECT * FROM view_wanted_books
    UNION ALL
    SELECT * FROM view_wanted_graphicnovels
    UNION ALL
    SELECT * FROM view_wanted_videogames
    -- ... one per module
;
```

Columns:
- `collection_type_id`
- `item_id`
- `copy_id` (NULL for modules without a copy sub-table, e.g., Graphic Novels)
- `ownership_status_id`
- `target_price` (NULL if not set)
- `display_label` (module-specific human-readable label)

Used by the listing tracker for:
1. **Validation gate** — can I add a listing for this item?
2. **Copy picker** — dropdown of wanted copies when adding from item header
3. **Reporting** — matched vs. orphaned listings, total wanted count

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
| thumbnail_path | TEXT | Local cached path (not hotlinked) |
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

Thumbnails are cached locally, not hotlinked. Stored in `images/listings/`
directory alongside the library images.

- On first successful parse: download thumbnail, store at
  `images/listings/{listing_id}_thumb.{ext}`
- On subsequent refreshes: re-download only if source URL changed
- Backed up automatically with the rest of `images/`

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

Filterable by: module, marketplace, priority, status, target hit (yes/no).

---

## Implementation Prerequisites

- Photocard copy/edition sub-table must be implemented before photocards
  can participate (other modules ready now)
- Playwright + Chromium required in deployment environment
- `brotli` Python package required for Neokyo HTTP decompression

---

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
