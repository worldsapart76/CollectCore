# CollectCore — Project Briefing for Claude Code

Cross-project decisions (Unraid, hosting path, strategy): `C:\Dev\ARCHITECTURE.md`

## Overview

Multi-collection tracker; 8 modules v1-complete (Photocards, Books, Graphic
Novels, Music, Video, Video Games, TTRPG, Board Games) — full CRUD, library
(filter sidebar + table/grid), bulk edit/delete, ingest. `docs/collectcore_summary.md`
is the authoritative built-state + schema + endpoint reference.

## Stack

- Backend: Python + FastAPI + SQLite, deployed on Railway (SQLite on a Railway
  volume at `/data`)
- Frontend: React + Vite SPA, built to `backend/frontend_dist/` (committed) and
  served by the backend
- Images: Cloudflare R2 via `images.collectcoreapp.com`
- Prod: `https://collectcoreapp.com` (admin) / `https://api.collectcoreapp.com` (API)
- Dev (Windows, `C:\Dev\CollectCore`): backend `:8001` + Vite `:5181` proxied to
  localhost. Dev only — production is cloud.

## Architecture & Hard Rules

Shared `tbl_items` + per-module detail/copy tables, discriminated by
`collection_type_id`. Per-module table inventory + full schema:
`docs/collectcore_summary.md`.

Bug-preventing rules (full schema-decision list + intentional simplifications
live in `docs/collectcore_summary.md` → Key Schema Decisions / Known Shortcuts):

- `source_origin_id` is nullable — **always LEFT JOIN it**
- `subcategory` is removed and `member` is an xref (`xref_photocard_members`),
  not a scalar — **do not reintroduce either**
- **No tags on new modules** without an explicit decision
- Photocard `ownership_status_id` holds **two orthogonal facts**: a standing
  *decision* about the card (`undecided`/`wanted`/`not_wanted`, at most one, and
  it outlives the copies) and *possession* facts about copies (`owned`/`trade`/
  `pending_*`). `not_wanted` + `trade` is legal on purpose. Bulk ownership
  sweeps must stay **row-scoped to the decision row** — a card-scoped
  `WHERE item_id = ...` flattens trade stacks. See the triage plan doc.
- **Lookup row ids are NOT stable between dev and prod, and names drift too** —
  dev id 77 was `This & That` while prod id 77 is `Season's Greetings 2025
  (Japan) Your Hero`, and prod has renamed ~15 origins dev still holds under old
  labels. Seed or migrate lookup data on **(id AND name) together**, write NULLs
  only, and log mismatches instead of guessing. `backend/seed_origin_dates.py`
  is the worked example.
- Photocard **ship dates live on the origin, never the card** —
  `lkup_photocard_source_origins.start_date` + `date_precision`. 88 origin rows
  date all 11,323 cards. `start_date` means *when the line started shipping*
  (tours and collab series span months), not a release date. Age is a **prior
  where comps are thin, never an override of a real comp**.
- **Nothing new goes on `tbl_photocard_details`** without checking the guest
  paths: `catalog.py` (`SELECT *`) and `seed_builder.py` (PRAGMA-driven copy)
  reflect that table, so a new column ships to the catalog delta and the guest
  seed with nothing in the diff to warn you. Admin-only facts belong in a side
  table — that's why pricing is `tbl_photocard_pricing`.
- Photocard price **tier and custom price are mutually exclusive**, enforced by
  a CHECK; the effective price is derived on read and **never denormalized**, so
  editing a tier reprices its cards. See the pricing plan doc.
- Intentional simplifications (no virtualization, inline styles, photocard-only
  export) are deliberate — **don't "fix" them unprompted**
- **Binder Designer** SPA route is `/binder-designer`, never `/binders` — that
  prefix belongs to the API and Vite's dev proxy matches on prefix, so sharing
  it makes a page load and the list endpoint indistinguishable. Layout codes
  read **across × down** (`4x3` = 12 pockets). Admin-only. See the plan doc.
- SQLite **FK cascades never fire** — `PRAGMA foreign_keys = ON` is only issued
  on `init_db`'s connection. Every delete path must clean up child rows
  explicitly; `FOREIGN KEY` clauses in `schema.sql` are documentation.

## UI Design Principles

Consistent across modules — **do NOT redesign UI structure without explicit
instruction.** Compact/dense, button-driven over free typing, guided inputs,
high-efficiency batch actions, two-panel layout (left filter sidebar + content).

## Reference Documentation

`docs/` unless an absolute path is given.

| File | Purpose |
|---|---|
| `docs/collectcore_summary.md` | **Authoritative** — schema, endpoints, built state, schema decisions, known shortcuts |
| `docs/catalog_architecture.md` | Catalog/guest-sync internals (delta endpoints, guest schema, backup format) |
| `docs/deployment_and_auth.md` | Hosting, Cloudflare Access auth, multi-user tier mechanics |
| `docs/image_handling.md` | Photocard image pipeline, R2 conventions, render helpers |
| `docs/photocard_triage_statuses_plan.md` | **Authoritative** — Undecided/Not Wanted triage statuses: decision-vs-possession split, co-occurrence rules, sweep semantics |
| `docs/photocard_binder_designer_plan.md` | **Authoritative** — Binder Designer: layouts, spread/mirroring, one-binder-per-card rule, fit-to-space sizing, Wanted sweep |
| `docs/photocard_pricing_and_trade_export_plan.md` | **Authoritative** — price tiers (tier XOR custom price), trade CSV export, Mercari title rules |
| `docs/new_module_checklist.md` | Reference-only checklist if a new module is ever added |
| `docs/collectcore_books_module_design.md` / `_plan.md` / `_v1_schema_proposal.md` | Books module design, plan, v1 schema |
| `docs/session_notes.md` | Session history; 2026-04-25 entry = apex-SPA cutover + auth + guest pivot |
| `docs/guest_deploy_runbook.md` | Deploy-time checklist for `/guest/` (CF bypass, smoke test, rollback) |
| `docs/photocard_market_intel_plan.md` | **Authoritative** — browser-extension price capture + resale ledger (box/purchase/line allocation). Supersedes the listing tracker for photocards (not built) |
| `docs/listing_tracker_design_plan_v3.md` / `_dev_plan.md` | Listing-tracker design + phased plan (not built). **Superseded for photocards** by `photocard_market_intel_plan.md`; still the reference for cross-module listing tracking |
| `docs/guest_cloud_accounts_plan.md` | **Authoritative** `/pcs/` tier replacing `/guest/` WASM (not built) |
| `docs/release-guide.md`, `plans\pure-inventing-whisper.md`, `plans\fancy-stirring-hollerith.md` | Historical/superseded — consult only for back-history |

## Deployment & Access

Railway + Cloudflare R2, live since 2026-04-24. Auth is **Cloudflare Access +
Google at the edge — zero auth code in the app.** Infra, custom domains, auth
setup, tier mechanics: `docs/deployment_and_auth.md`.

Guardrails:
- `/catalog/*` and `/guest` are Cloudflare Access **bypass** paths (public).
- The `/guest/` WASM-SQLite tier is **deprecated** — no new functionality there;
  being replaced by the authenticated `/pcs/` tier.
- Capacitor mobile is **indefinitely deferred** (`mobile-shell` branch = parked
  reference; don't merge/push). Mobile = responsive web.

## Catalog Architecture

Snapshot-plus-delta: admin `tbl_items` with `catalog_item_id IS NOT NULL` IS the
catalog; guests pull a snapshot then deltas. Everyday publishing = **Admin →
Backup & Restore** → *Publish Photocard Images* (after replacing/batch-adding)
and *Regenerate Guest Seed* (occasional baseline).

**Catalog membership = `catalog_item_id IS NOT NULL`, not ownership status, and
no longer requires an image.** Cards enter the catalog at a deliberate commit
step: *Publish Photocard Images* (when images exist) **or** `POST
/admin/commit-catalog` (imageless — for placeholder sets so `/pcs/` friends can
see/track cards before scans exist; assigns the deterministic
`{group_code}_{item_id:06d}` id + bumps `catalog_version`). Bulk-created cards are
admin-only drafts until committed.

**Catalog removals are allowed but rare** (mostly pre-workflow duplicate cleanup)
— reversed the old "monotonic / no removals" rule 2026-07-17. On `/pcs/` (live
server query) a deleted card just disappears; `bulk_delete_photocards` also drops
orphaned `pcs_card_copies` (silently). **No tombstones on `/pcs/`.** The
deprecated WASM `/guest/` tier can't reflect removals — accepted; it's frozen.
Delta endpoints, guest schema, backup format: `docs/catalog_architecture.md`.
Full design: `docs/photocard_bulk_create_and_batch_images_plan.md`.

## Build & Release

Desktop installer is retired — admins use the bookmark; no `.exe`.

1. `cd frontend && npm run build` → `backend/frontend_dist/` (`build:guest` for guest)
2. `git add backend/frontend_dist/ backend/ frontend/`
3. `git commit && git push`
4. Railway auto-deploys; users refresh

### `extension/` has NO build step

The Chrome extension in `extension/` is plain JS — **never bundled, compiled, or
built**, and it does **not** deploy to Railway. `npm run build` does not touch
it. After changing its code the only steps are: reload it at
`chrome://extensions`, then refresh the Mercari tab. Full instructions live in
[`extension/README.md`](extension/README.md) — point the user there rather than
reconstructing the steps.

## Roadmap (designed, not built)

Plan docs are authoritative — read before starting; don't duplicate decisions here.

- **Photocard market intel** — capture **BUILT** (Mercari US both sides, Neokyo
  buy side); comps, fees and cost basis live. `docs/photocard_market_intel_plan.md`.
  **Next: the v2 market workspace** — card grid (paid / buy / sell + flip and arb
  margins), lot analyzer with value-weighted allocation, wanted-sourcing view.
  It supersedes the card-first comp view as the entry point; that view stays as
  the drill-down. The resale ledger (box → purchase → line) is step 3 and owns
  per-copy cost basis. Admin-only, `mkt_*` tables, no `/pcs/` dependency.
- **Listing tracker** — cross-module price/listing tracking.
  `docs/listing_tracker_design_plan_v3.md` + `_dev_plan.md`. Phase 0A done.
  **Superseded for photocards** by the market-intel plan (which drops the
  Playwright/refresh-engine design); dormant unless another module needs it.
- **Guest access overhaul** — `/pcs/` authenticated tier replacing `/guest/` WASM
  (photocard-only). `docs/guest_cloud_accounts_plan.md`.

## Session Notes

`docs/session_notes.md` = full history. **Update it at the end of each working
session** (what was done / what's next; keep last 3-5, collapse older into a
"Completed to date" block).
