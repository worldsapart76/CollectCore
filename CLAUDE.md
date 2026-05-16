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
- Intentional simplifications (no virtualization, inline styles, photocard-only
  export) are deliberate — **don't "fix" them unprompted**

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
| `docs/new_module_checklist.md` | Reference-only checklist if a new module is ever added |
| `docs/collectcore_books_module_design.md` / `_plan.md` / `_v1_schema_proposal.md` | Books module design, plan, v1 schema |
| `docs/session_notes.md` | Session history; 2026-04-25 entry = apex-SPA cutover + auth + guest pivot |
| `docs/guest_deploy_runbook.md` | Deploy-time checklist for `/guest/` (CF bypass, smoke test, rollback) |
| `docs/listing_tracker_design_plan_v3.md` / `_dev_plan.md` | **Authoritative** listing-tracker design + phased plan (not built) |
| `C:\Users\world\.claude\plans\guest-cloud-accounts.md` | **Authoritative** `/pcs/` tier replacing `/guest/` WASM (not built) |
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

**Guardrail: the catalog is monotonic** — cards never leave it; no tombstones,
soft-delete, or remove-from-catalog flows. Delta endpoints, guest schema, backup
format: `docs/catalog_architecture.md`.

## Build & Release

Desktop installer is retired — admins use the bookmark; no `.exe`.

1. `cd frontend && npm run build` → `backend/frontend_dist/` (`build:guest` for guest)
2. `git add backend/frontend_dist/ backend/ frontend/`
3. `git commit && git push`
4. Railway auto-deploys; users refresh

## Roadmap (designed, not built)

Plan docs are authoritative — read before starting; don't duplicate decisions here.

- **Listing tracker** — price/listing tracking. `docs/listing_tracker_design_plan_v3.md`
  + `_dev_plan.md`. Phase 0A done; **Phase 1 (schema & core backend) is the first
  open item**; depends on `/pcs/` first.
- **Guest access overhaul** — `/pcs/` authenticated tier replacing `/guest/` WASM
  (photocard-only). `C:\Users\world\.claude\plans\guest-cloud-accounts.md`.

## Session Notes

`docs/session_notes.md` = full history. **Update it at the end of each working
session** (what was done / what's next; keep last 3-5, collapse older into a
"Completed to date" block).
