# Listing Tracker — Development Plan

Reference: `docs/listing_tracker_design_plan_v3.md`

---

## Phase 0: Prerequisites

**Goal:** Establish the cross-module foundations the listing tracker depends on.

These are separate work items that must land before listing tracker development
begins. They have value independent of the listing tracker.

### 0A: Photocard copy/edition sub-table
- Design and implement `tbl_photocard_copies` (or equivalent) with
  per-copy `ownership_status_id`
- Migrate existing photocard ownership data into the new structure
- Update photocard CRUD endpoints and UI to use the new sub-table

### 0B: Standardized wanted query
- Create per-module SQL views (`view_wanted_books`, `view_wanted_graphicnovels`,
  `view_wanted_photocards`, `view_wanted_videogames`, etc.)
- Each view returns: `collection_type_id`, `item_id`, `copy_id`, `ownership_status_id`,
  `target_price`, `display_label`
- Create master `view_wanted_all` as UNION ALL of all module views
- Backend utility: `get_wanted_items(collection_type_id=None)` endpoint for
  the listing tracker and future wanted dashboard

### Milestone: all current modules expose wanted items through a single query interface.

---

## Phase 1: Schema & Core Backend

**Goal:** Database tables exist, basic CRUD works, no parsing or scheduling yet.

### 1A: Database tables
- `tbl_tracked_listings` — full schema per design plan
- `listing_snapshots` — snapshot history table
- `marketplace_fee_profiles` — fee profile table (seeded with empty defaults
  for `mercari_us` and `neokyo`)
- Indexes on `tracked_listing_id + checked_at` (snapshot queries),
  `item_id` (listing lookups), `next_scheduled_check_at` (scheduler)

### 1B: Listing CRUD endpoints
- `POST /listings/track` — create a tracked listing (validates item has wanted
  status via `view_wanted_all`)
- `GET /listings/` — list all tracked listings with filters (collection_type,
  marketplace, priority, status, is_active)
- `GET /listings/{id}` — single listing detail with snapshot history
- `PUT /listings/{id}` — update target price, priority, notes, copy assignment
- `DELETE /listings/{id}` — remove tracking (soft delete or hard delete TBD)
- `GET /listings/by-item/{item_id}` — all listings for a given item

### 1C: Price history endpoints
- `GET /listings/{id}/snapshots` — full snapshot history
- `GET /listings/{id}/price-summary` — returns `lowest_price_ever`,
  `lowest_price_30d`, `first_seen_price`, `current_price`
- `lowest_price_30d` computed from snapshots with 30-day window query

### Milestone: listings can be created, read, updated, and deleted via API. No parsing — title/price entered manually or left blank until Phase 2.

---

## Phase 2: Parser Integration

**Goal:** Port POC parsers into CollectCore, extract listing data from real URLs.

### 2A: Parser framework
- Create `backend/parsers/` module structure
- Base parser interface: `parse(url) -> ParseResult`
- Marketplace detection from URL (`detect_marketplace()`)
- Tier ladder: HTTP first, Playwright fallback
- Shared Playwright browser context manager (reuse across URLs in a batch)

### 2B: Neokyo parser
- Port from POC — plain HTTP, ~1s/listing
- Selectors: `h6.translate` (title), `span.product-price` (JPY),
  `span.product-price-converted` (USD), availability row (`text-success`/`text-danger`),
  `img.cloudzoom` (thumbnail from `img.fril.jp`)
- Deleted detection: 403 + redirect off product page
- Handle brotli decompression (`brotli` package dependency)

### 2C: Mercari US parser
- Port from POC — Playwright required, ~17s/listing
- Extract from `__NEXT_DATA__` JSON → `serverState.ItemDetail:<id>`
- Price decoding: integer cents ÷ 100 = USD
- Status mapping: `on_sale` → active, `trading`/`sold_out` → sold_out
- Thumbnail: `photos[0].imageUrl`

### 2D: Thumbnail caching
- On successful parse: download thumbnail to `images/listings/{listing_id}_thumb.{ext}`
- Store local path in `tbl_tracked_listings.thumbnail_path`
- Re-download only when source URL changes between snapshots
- Serve via existing static file serving

### 2E: Parse-on-add
- When a listing is created via `POST /listings/track`, immediately run the
  parser to populate title, price, status, thumbnail
- Store first snapshot
- Set `first_seen_price`, `current_price`, `lowest_price_ever`

### Milestone: adding a Mercari US or Neokyo URL auto-populates all listing fields and caches the thumbnail locally.

---

## Phase 3: Refresh Engine

**Goal:** Listings refresh on schedule and on demand, snapshots accumulate, price tracking works.

### 3A: Manual refresh
- `POST /listings/{id}/refresh` — single listing refresh
- `POST /listings/refresh-batch` — multi-select refresh
- Cooldown enforcement: reject if `now < refresh_lock_until`
- After refresh: set `refresh_lock_until = now + 15 minutes`

### 3B: Snapshot + change detection
- On each refresh: create snapshot row with extracted data
- Compare to previous snapshot: set `price_changed`, `status_changed` flags
- Update `tbl_tracked_listings`: `current_price`, `status`, `last_checked_at`
- Update `lowest_price_ever = MIN(lowest_price_ever, new_price)`
- Update `price_usd` if marketplace provides conversion

### 3C: Scheduled refresh
- Background task: query listings where `next_scheduled_check_at <= now`
  and `is_active_tracking = 1`
- Process in marketplace-grouped batches: all Neokyo first (fast HTTP sweep),
  then all Mercari (single Playwright session)
- Random delay between requests (1.5–3s)
- On success: `next_scheduled_check_at = last_checked_at + 7 days`
- On failure: `status = error_temp`, do NOT advance `next_scheduled_check_at`
  (retry on next cycle)

### 3D: Auto-deactivation
- When a listing's status becomes `removed` or `sold_out`, set
  `is_active_tracking = 0` (stop scheduling future refreshes)
- User can manually reactivate if desired

### Milestone: listings refresh weekly on their own, snapshots accumulate, price history is queryable.

---

## Phase 4: Listing Tracker UI

**Goal:** Dedicated screen for reviewing and managing all tracked listings.

### 4A: Main table view
- Table columns: thumbnail, title, module, marketplace, current price,
  lowest 30-day price, lowest ever price, target price, estimated total,
  priority, status, date added, last checked, next scheduled
- Sortable by any column
- Row selection for bulk actions (refresh, delete, priority change)

### 4B: Filters
- Filter sidebar (matching existing library pattern): module, marketplace,
  priority, status, target hit (current ≤ target), active/paused tracking
- Text search on title

### 4C: Price indicators (passive change detection)
- Badge/icon when `current_price <= target_price` (target hit)
- Badge/icon when `current_price == lowest_price_ever` (all-time low)
- Price delta display: show change since last snapshot (↑/↓ with amount)
- Color-coded: green for drops, red for increases

### 4D: Listing detail modal
- Full snapshot history (table or mini chart)
- Price trend over time
- Edit target price, priority, notes, copy assignment
- Manual refresh button (with cooldown indicator)
- Link to original listing URL (opens in new tab)

### Milestone: full listing tracker screen with filtering, price indicators, and detail view.

---

## Phase 5: Item Integration UI

**Goal:** Listings are accessible from the item they belong to, and creation is seamless.

### 5A: "Add price tracking" button
- Visible on item detail view when item has ≥1 wanted copy/edition
  (checked via `view_wanted_all`)
- Opens a small form: URL input + auto-detected marketplace
- Optional: copy picker dropdown (pre-populated with wanted copies)
- Optional: target price, priority, notes
- On submit: calls `POST /listings/track` → parse-on-add → redirect to
  listing tracker or show inline confirmation

### 5B: Item-level listing summary
- On item detail view: show count of tracked listings and their status
  (e.g., "3 listings tracked — 1 below target")
- Link to listing tracker filtered to that item

### 5C: Wanted items without listings
- On listing tracker screen: optional view showing wanted items that have
  NO tracked listings yet (discovery aid)

### Milestone: users can start tracking from any wanted item and see listing status in context.

---

## Phase 6: Fee Profiles

**Goal:** Estimated total cost accounts for marketplace-specific fees.

### 6A: Fee profile management
- `GET /fee-profiles/` — list all profiles
- `POST /fee-profiles/` — create profile
- `PUT /fee-profiles/{id}` — update profile
- Seed default profiles for Mercari US (sales tax, buyer protection fee)
  and Neokyo (proxy fee, international shipping, import duties)

### 6B: Cost calculation
- On each refresh (or fee profile update): recalculate `estimated_total_cost`
  using the listing's assigned fee profile
- Formula: `current_price + sales_tax + platform_fees + shipping + proxy_fees + duties`

### 6C: Fee profile UI
- Settings/admin page for managing fee profiles
- Per-listing fee profile assignment (default by marketplace, overridable)

### Milestone: listings show estimated total cost including all fees.

---

## Phase 7+: Future Marketplaces

Each new marketplace follows the same pattern: parser module → test against
real URLs → integrate into refresh engine → add to fee profile seed data.

| Phase | Marketplace | Parser approach | Notes |
|---|---|---|---|
| 7A | Pocamarket | TBD (investigate) | Photocard-specific; structured pages expected |
| 7B | eBay | Official API | Broadest cross-module coverage |
| 7C | Amazon | TBD | Complex; may need product page parsing |
| 7D | Alibris | HTTP parse likely | Book-focused |
| 7E | Pango Books | TBD | App-first; web parsing story unclear |
| 7F | Thrift Books | HTTP parse likely | Book-focused |
| 7G | AbeBooks | HTTP parse likely | Book-focused |
| 7H | Book Outlet | HTTP parse likely | New books / deals |

Each marketplace gets a POC spike before full integration, same as Phase 1
marketplaces were validated.

---

## Dependency Graph

```
Phase 0A (photocard copies) ──┐
                               ├── Phase 0B (wanted query) ── Phase 1 ── Phase 2 ── Phase 3
All other module sub-tables ──┘                                  │
                                                                 │
                                                          Phase 4 + Phase 5 (parallel, after Phase 3)
                                                                 │
                                                              Phase 6
                                                                 │
                                                             Phase 7+
```

- Phase 0A and 0B are sequential (wanted query depends on copy sub-tables)
- Phases 1 → 2 → 3 are sequential (each builds on the previous)
- Phases 4 and 5 can be built in parallel after Phase 3
- Phase 6 can be added at any point after Phase 1 but makes most sense after
  Phase 4 (when the UI exists to display it)
- Phase 7+ is independent per marketplace, after Phase 3

---

## Deployment Notes

- **Playwright + Chromium** must be available in the runtime environment.
  On Unraid: include in container build. Local dev: `pip install playwright &&
  playwright install chromium`.
- **brotli** Python package required for Neokyo HTTP decompression.
- Add `/listings` to `PROXY_PATHS` in `frontend/vite.config.js` (standard
  new-module checklist item).
- Thumbnail directory `images/listings/` is automatically included in backup
  (same parent as `images/library/`).
