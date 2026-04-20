# Listing Tracker Design Plan (Updated with Marketplace Support)

## Overview
A lightweight tracking tool for monitoring individual marketplace listings by URL. 
Focuses on manual input, low-frequency updates, and fee-aware price comparison.

---

## Supported Marketplaces (Initial Targets)

### Tier 1 (Best Support / First Implementation)
- eBay (official API support available)
- Pocamarket (structured pages, visible transaction data)

### Tier 2 (Moderate Complexity)
- Mercari US (no official API, requires page parsing)
- Mercari Japan (via direct links or proxy references)

### Tier 3 (Advanced / Later Phase)
- Neokyo (proxy service over JP marketplaces)

---

## Marketplace Handling Strategy

Each marketplace will have a dedicated parser module:

### Parser Responsibilities
- Extract title
- Extract price + currency
- Determine availability/status
- Extract thumbnail image
- Normalize data into common format

### Fallback Behavior
If parsing fails:
- status = needs_review
- preserve last known data
- log error for debugging

---

## Core Features
- Manual URL-based tracking
- Weekly staggered updates
- Manual refresh with cooldown protection
- Fee-adjusted price comparison
- Snapshot history tracking
- Priority and target price management

---

## Data Model

### tracked_listings
- id
- source_marketplace
- listing_url
- date_added
- title
- thumbnail_url
- first_seen_price
- current_price
- currency
- status
- target_price
- priority_level
- fee_profile_id
- estimated_total_cost
- notes
- last_checked_at
- last_refresh_attempt_at
- refresh_lock_until
- next_scheduled_check_at
- is_active_tracking

---

### listing_snapshots
- id
- tracked_listing_id
- checked_at
- title
- price
- currency
- status
- thumbnail_url
- page_hash
- price_changed (boolean)
- status_changed (boolean)
- notes

---

### marketplace_fee_profiles
- id
- marketplace_code
- profile_name
- is_default
- currency
- sales_tax_percent
- platform_fee_fixed
- platform_fee_percent
- domestic_shipping_flat
- international_shipping_flat
- proxy_service_fee_flat
- proxy_service_fee_percent
- import_duties_percent
- other_fee_flat
- other_fee_notes
- last_updated

---

## Status Values
- active
- sold_out
- unavailable
- removed
- error_temp
- error_auth
- needs_review

---

## Scheduling Logic
- On add:
  next_scheduled_check_at = date_added + 7 days

- On successful refresh:
  next_scheduled_check_at = last_checked_at + 7 days

---

## Refresh Logic

### Manual Refresh
- Single or multi-select
- Disabled if:
  now < refresh_lock_until

- After refresh:
  refresh_lock_until = now + 15 minutes

### Refresh Process
1. Check cooldown
2. Identify marketplace
3. Run marketplace parser
4. Extract structured data
5. Compare with previous snapshot
6. Store snapshot
7. Update listing fields
8. Update timestamps

---

## Batch Safety
- Sequential processing
- Random delay between requests
- Group by marketplace when possible

---

## Price Calculation

estimated_total_cost = 
    current_price
    + sales_tax
    + platform fees
    + shipping
    + proxy fees
    + duties

---

## Priority Levels
- Low
- Medium
- High
- Urgent

---

## UI Structure

### Main List View
Columns:
- thumbnail
- title
- marketplace
- raw price
- estimated total
- target price
- priority
- status
- date added
- last checked
- next scheduled

---

## Summary
Adds clear marketplace strategy and phased support model while keeping the system lightweight and scalable.
