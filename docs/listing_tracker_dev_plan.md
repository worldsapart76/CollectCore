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

### 0B: ~~Standardized wanted query~~ — REMOVED 2026-05-15
Dropped. It existed only to power a wanted-validation gate that has been
removed (any item is trackable regardless of ownership status — see design
plan → No ownership gate). No `view_wanted_*` views, no
`get_wanted_items()` endpoint, no master `view_wanted_all`.

The only residual need — a per-module **display-label** resolver (photocards:
group + member(s) + source_origin + version, scoped by `collection_type_id`;
never `title`) — is built in **Phase 4** where it is consumed, not as a
prerequisite. It must be strictly additive (must not retrofit
`/admin/trade-ownership`, `_attach_copies`, or the catalog/seed builders).

### Milestone: Phase 0A (photocard copies) is done; Phase 0 has no remaining blocking work. Phase 1 can begin.

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
- `POST /listings/track` — create a tracked listing for any `item_id` +
  `collection_type_id` (+ optional `copy_id`). **No ownership-status
  validation** (gate removed 2026-05-15) — any item is trackable
- `GET /listings/` — list all tracked listings with filters (collection_type,
  marketplace, priority, status, is_active)
- `GET /listings/{id}` — single listing detail with snapshot history
- `PUT /listings/{id}` — update target price, priority, notes, copy assignment
- `DELETE /listings/{id}` — **soft delete** (sets `deleted_at`, hides from
  default view, retains row + snapshots). Resolved 2026-05-15; no hard-purge
  path. See design plan → Retention & Deletion.
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

> **Runtime (resolved 2026-05-15):** Playwright + Chromium run on Railway,
> built via a backend **Dockerfile** (replaces the current Procfile/Nixpacks
> build). No pre-spike — Railway viability is validated during this phase's
> real-URL testing. If datacenter-IP blocking or memory limits make Railway
> unworkable, fall back to the split deployment (scraper worker on the home
> network posting to Railway) per design plan → Cloud Hosting Decisions. Build
> the parser layer and refresh API behind a clean interface so that fallback
> needs no data-model change. Thumbnails upload to R2 (`listings/` prefix),
> not local disk.

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

### 2D: Thumbnail caching (R2)
- On successful parse: download the source thumbnail, upload to R2 at
  `listings/{listing_id}_thumb.{ext}` via the existing R2 client
- Store the full R2 URL in `tbl_tracked_listings.thumbnail_path`
- Re-upload only when the source URL changes between snapshots
- Served via `images.collectcoreapp.com` (no app static-file serving;
  Railway local FS is ephemeral). See design plan → Thumbnail Handling.

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
- Table columns: thumbnail, title, **open (↗ link to `listing_url`)**, module,
  marketplace, current price, lowest 30-day price, lowest ever price, target
  price, estimated total, priority, status, date added, last checked, next
  scheduled
- Sortable by any column
- **Group-by-card toggle** — collapse listings under their parent item so all
  of a card's tracked URLs sit together
- Row selection for bulk actions (refresh, delete, priority change, **"Open
  all" / "Copy all URLs"** for the selected rows)
- This screen is the "all my tracked URLs in one place" report; closed/sold
  listings remain visible (dimmed, filterable) as the historical archive

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
- Visible on **every** item detail view (no ownership precondition — gate
  removed 2026-05-15)
- Opens a small form: URL input + auto-detected marketplace
- Optional: copy picker dropdown (all of that item's copies/editions, from
  the data the detail page already loaded — not a wanted-filtered list)
- Optional: target price, priority, notes
- On submit: calls `POST /listings/track` → parse-on-add → redirect to
  listing tracker or show inline confirmation

### 5B: Item-level listing summary
- On item detail view: show count of tracked listings and their status
  (e.g., "3 listings tracked — 1 below target")
- Link to listing tracker filtered to that item

### 5C: Coverage view (discovery aid)
- On listing tracker screen: optional view of items that have NO tracked
  listings yet. Scope defaults to all items; user-filterable by module /
  ownership status if they want to narrow it (the app does not pre-restrict
  to "wanted")

### Milestone: users can start tracking from any item and see listing status in context.

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

## Phase 8: Guest-Visible Price Data (photocard-only, via `/pcs/` tier)

**Goal:** Photocard price summaries are optionally visible to authenticated
guests on the new `/pcs/` tier. Gated OFF by default.

Reference: design plan → Guest-Visible Price Data.

> **Retargeted 2026-05-15.** Original 8C/8D (extend `/catalog/delta` +
> `seed_builder.py`; add a `guest_catalog_listings` mirror + section into the
> old `frontend/src/guest/` tier) is **withdrawn** — the `/guest/` WASM tier
> is being deprecated and that infra is deleted at its sunset
> (`C:\Users\world\.claude\plans\guest-cloud-accounts.md` P8). No new
> functionality goes into `/guest/`. Phase 8 now targets the authenticated
> server-read `/pcs/` tier instead.

**Hard dependency:** the `/pcs/` tier must be built first (guest-cloud-accounts
plan — currently a draft, not started). Also requires real price data (after
Phase 3). The admin-side tracker (Phases 1–7) does **not** depend on this and
is unaffected.

### 8A: Schema
- `tbl_tracked_listings.deleted_at` only (already added in Phase 1B for
  soft-delete). **No `catalog_version`** — the delta-cursor mechanism is gone;
  the `/pcs/` tier reads live server-side.

### 8B: Publish gate
- Global admin setting `catalog_publish_listings` (default `0`), surfaced
  wherever the admin manages photocard/guest publishing
- All-or-nothing; no per-listing/per-card selection

### 8C: `/pcs/`-tier read
- Add a `/me/*`-namespace read (or extend the `/pcs/` photocard read) that
  LEFT JOINs the lean listing summary (`source_marketplace`, `listing_url`,
  `current_price`, `currency`, `lowest_price_ever`, `status`,
  `last_checked_at`, `thumbnail_path`) from `tbl_tracked_listings` to the
  photocard via `tbl_items.catalog_item_id`, **photocard-only**, **only when
  the toggle is on**
- No raw `listing_snapshots` ever exposed (admin-side only)
- Strictly additive to the **new** tier: touches no `/guest/` code, no
  `/catalog/*` endpoint, no `seed_builder.py`

### 8D: `/pcs/` UI (read-only)
- Read-only listings section on the `/pcs/` photocard detail view; no guest
  writes ever
- Optional later: a read-only `/pcs/` tracker page

### Milestone: with the toggle on, `/pcs/` guests see current price / lowest-ever / marketplace URL per photocard; with it off (default) the `/pcs/` read omits it and all tracking stays admin-side. Nothing is added to the deprecated `/guest/` tier.

---

## Dependency Graph

```
Phase 0A (photocard copies) ✅ DONE ── Phase 1 ── Phase 2 ── Phase 3
   (Phase 0B removed — no longer a prerequisite)                 │
                                                                 │
                                          Phase 4 + Phase 5 (parallel, after Phase 3)
                                                                 │
                                                   Phase 6 │ Phase 7+ │ Phase 8
```

- **Phase 0 has no open blocking work.** Phase 0A (photocard copies) shipped;
  Phase 0B (the wanted query) was removed 2026-05-15 with the ownership gate.
  **Phase 1 (schema & core backend) is the first open work item.**
- Phases 1 → 2 → 3 are sequential (each builds on the previous)
- Phases 4 and 5 can be built in parallel after Phase 3
- Phase 6 can be added at any point after Phase 1 but makes most sense after
  Phase 4 (when the UI exists to display it)
- Phase 7+ is independent per marketplace, after Phase 3
- Phase 8 (guest-visible price data) is after Phase 3 **and** depends on the
  `/pcs/` tier being built (guest-cloud-accounts plan — not started); targets
  `/pcs/`, never the deprecated `/guest/`; independent of Phases 4–7

---

## Deployment Notes (Railway — updated 2026-05-15)

- **Playwright + Chromium on Railway:** the backend build moves from
  Procfile/Nixpacks to a **Dockerfile** so Chromium's system deps are present
  (Playwright base image, or python base + `playwright install --with-deps
  chromium`). Local dev: `pip install playwright && playwright install
  chromium`. No pre-spike — see Phase 2 note and design plan → Cloud Hosting
  Decisions. Split-deployment fallback is the documented contingency if
  Railway datacenter IPs are blocked.
- **Scheduler:** in-process periodic sweep (hourly tick) inside the FastAPI
  app, driven by `next_scheduled_check_at` in SQLite — no separate worker
  service, resilient to Railway redeploys/restarts.
- **brotli** Python package required for Neokyo HTTP decompression.
- Add `/listings` (and `/fee-profiles`) to `PROXY_PATHS` in
  `frontend/vite.config.js` (standard new-module checklist item, local Vite
  dev only).
- **Thumbnails:** uploaded to Cloudflare R2 under the `listings/` prefix (not
  local disk — Railway FS is ephemeral). DB tables are auto-captured by the
  SQLite hot-copy backup; thumbnails are independently durable on R2 and not
  in the backup ZIP (self-heal on next refresh).
- **Frontend release** follows the standard flow: `cd frontend && npm run
  build` → commit `backend/frontend_dist/` → push → Railway auto-deploys
  (~5-6 min).
- After deploy, run the standard new-module backup checklist (CLAUDE.md →
  Backup & Restore): no backup code changes needed since all listing tables
  ride the SQLite hot-copy automatically.
