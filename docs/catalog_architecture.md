# Catalog Architecture

> Split out of `CLAUDE.md` 2026-05-15 to keep the standing briefing lean. This
> is the authoritative deep reference for catalog/guest-sync internals. The
> durable guardrails (catalog is monotonic; new functionality goes to the
> `/pcs/` tier, never `/guest/`) remain summarized in CLAUDE.md.

Decision baseline unchanged from 2026-04-23.

Shared card set modeled as snapshot-plus-delta. Admin's `tbl_items` with
`catalog_item_id IS NOT NULL` IS the Catalog. Guests download full snapshot on
first visit, pull deltas thereafter. `catalog_item_id` uses the existing
`{group_code}_{id:06d}` image filename convention — no UUIDs needed. New
`Catalog` ownership status added to photocards only, hidden from admin UI via
`VITE_IS_ADMIN` flag.

## Admin catalog publish UI

In-app as of 2026-04-26 — Admin → Backup & Restore tab has two batch
operations:

- **Publish Photocard Images** — sweeps any photocard attachment with a
  local `file_path` to R2 (resize → upload → rewrite DB to R2 URL,
  bumps catalog_version). Run after replacing or batch-adding images.
  Backed by `backend/catalog_publisher.py` + `POST /admin/publish-catalog`.
  Filter is `file_path NOT LIKE 'http%'` (NOT `storage_type='local'` —
  the latter missed legacy "hosted-row-with-local-path" rows from a
  former `_replace_image` bug).
- **Regenerate Guest Seed** — rebuilds `backend/data/mobile_seed.db`
  from the live admin DB. Periodic baseline refresh only (occasional
  use). Backed by `backend/seed_builder.py` + `POST /admin/regenerate-seed`.
  Most everyday catalog/lookup edits propagate via `/catalog/delta`,
  not via the seed.

`tools/publish_catalog.py` and `tools/prepare_mobile_seed.py` remain as
CLI equivalents for offline/automation use.

## Backend endpoints (publicly accessible via Cloudflare Access bypass)

- `GET /catalog/version` → `{max_version, card_count}`
- `GET /catalog/delta?since=N` → raw table-row deltas the guest worker
  replays into its local SQLite mirror with `INSERT OR REPLACE`. Shape:
  `{ since, max_version, tables: { tbl_items, tbl_photocard_details,
  xref_photocard_members, tbl_attachments, lkup_photocard_groups,
  lkup_photocard_source_origins, lkup_photocard_members,
  lkup_top_level_categories } }`. Lookup tables only include rows
  referenced by changed items. **No tombstones yet** — admin has no
  remove-from-catalog flow today; tombstones land alongside the admin
  publish UI (PD1). A pure lookup edit (e.g. group rename) won't
  propagate until something bumps a related item's catalog_version —
  known limitation.
- `GET /catalog/seed.db` → FileResponse of `backend/data/mobile_seed.db`
  (committed to repo) OR `DATA_ROOT/data/mobile_seed.db` (volume copy,
  preferred when present — written by Regenerate Guest Seed). R2 redirect
  approach was abandoned 2026-04-26 — R2 bucket-level CORS doesn't apply
  to public custom-domain requests, and Cloudflare Transform Rules
  proved fragile under cache churn.

## Guest-side schema (`guest_` / `v_guest_` prefix = sync-untouchable)

- `guest_meta(key, value)` — KV store. Holds `last_synced_catalog_version`.
- `guest_card_copies(copy_id, catalog_item_id, ownership_status_id, notes, ...)`
  — per-card guest annotations. Mirrors admin's `tbl_photocard_copies` model
  (multi-copy per card with Owned/Wanted/etc. status) but keyed by the
  contractually-stable `catalog_item_id` so rows survive a full seed reset.
- `v_guest_library_photocards` — read target for the future guest library.
  Joins catalog `tbl_items` + `tbl_photocard_details` + LEFT JOIN
  `guest_card_copies` (catalog cards with no annotation surface as
  `guest_*` columns NULL). Phase 4b will UNION ALL guest-added cards into
  this view.
- **Guest-added cards (Phase 4b) deferred** until a real guest library page
  exists to consume them. Schema decisions made: flat `guest_added_photocards`
  table, separate `guest_added_attachments` for local-only images
  (R2 upload not in scope for guests, ever), `guest_added_members_xref`
  for member tags.

## Guest backup/restore (Phase 5)

Every `guest_%` table snapshots to JSON via `exportGuestBackup()` in
`sqliteService.js`. Tables are discovered dynamically from `sqlite_master`
so future guest tables are auto-included. Format:
`{ version: 1, exported_at, tables: { table_name: [...rows] } }`.
Restore is replace-strategy (DELETE all then INSERT, SAVEPOINT-wrapped) and
tolerates extra/missing columns by binding only what the destination table
declares. `guest_meta.last_backed_up_at` stamped on successful export so the
future UI can show "Last backed up: N days ago." OPFS is durable-on-best-
effort — the JSON snapshot is the only recovery path if site data is cleared
or the device is lost.

## Status note (2026-05-15)

The `/guest/` WASM-SQLite tier described above is **deprecated**. It remains
deployed but no new functionality goes there — it is being replaced by the
authenticated `/pcs/` tier (server-stored data, Google IdP; see
`C:\Users\world\.claude\plans\guest-cloud-accounts.md`). This document
describes the existing tier's mechanics for maintenance/reference only.
