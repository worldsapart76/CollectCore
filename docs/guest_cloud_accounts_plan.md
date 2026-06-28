# Guest Cloud Accounts — `/pcs/` Tier (Design & Phased Plan)

> **Status: reconstructed 2026-06-28.** The original `guest-cloud-accounts.md`
> (formerly referenced at `C:\Users\world\.claude\plans\guest-cloud-accounts.md`)
> was lost — the `.claude\plans\` directory no longer exists and the file was
> not recoverable from transcripts, backups, Dropbox, or Drive. This document
> reconstructs the design from the surviving references (CLAUDE.md,
> `deployment_and_auth.md`, `catalog_architecture.md`, the live `frontend/src/guest/`
> code) plus decisions taken in the 2026-06-28 working session. **This file is now
> the authoritative plan** and lives in-repo (version-controlled) deliberately, so
> it can't be lost the same way again.

## 1. Goal

Let friends ("guests") track their photocard catalog **in the cloud**, with their
data **stored server-side** and tied to their Google identity — so that clearing
browser data, switching devices, or losing a device never destroys their work.

This replaces the deprecated `/guest/` WASM-SQLite tier, whose annotations lived
in the browser (OPFS) and were only as durable as the browser's site storage.

### Why this is *simpler* than the tier it replaces

The deprecated tier's entire machinery — WASM SQLite, OPFS persistence, the
snapshot+delta sync (`/catalog/version`, `/catalog/delta`, `/catalog/seed.db`),
and the backup/restore JSON export — existed **only because the guest's
annotations were trapped in the browser**. The shared catalog already lives
server-side (it's admin's `tbl_items` where `catalog_item_id IS NOT NULL`).

Moving annotations to the server **deletes all of that**:

| Deprecated `/guest/` (WASM)                          | New `/pcs/` (cloud)                              |
| ---------------------------------------------------- | ----------------------------------------------- |
| WASM SQLite + OPFS in browser                        | No client DB — reads the live server DB         |
| Snapshot + delta sync to mirror the catalog locally  | Reads the live catalog directly via API         |
| `guest_card_copies` rows in browser SQLite           | `pcs_card_copies` rows in the server SQLite      |
| Backup/restore JSON as the only recovery path        | Server is the source of truth; backed up server-side |
| No login (CF Access bypass on `/guest`)              | **Google login via Cloudflare Access** (no bypass) |

The new tier is a thin authenticated read/write layer over the catalog the admin
already publishes. **The `/pcs/` UI reuses the same photocard library components
as admin** (via a server-data adapter), exactly as the WASM guest reused them via
`guestData.js`.

## 2. Decisions locked (2026-06-28 session)

1. **Frontend:** Reuse the admin photocard library components via a server-data
   adapter (`pcsData.js`, mirroring the existing `guestData.js` shape). Inline
   styles, consistent with admin. **No Tailwind** is introduced into CollectCore
   (StoryHub uses Tailwind; CollectCore stays inline-styled per its standing
   "intentional simplifications" rule).
2. **Access control:** **Allowlist** — only Google emails explicitly added to the
   Cloudflare Access policy can sign in. Fits the "known set of friends" use case
   and the CF Access free-tier 50-user limit.
3. **Tracking model:** **Mirror the current model** — multiple copies per catalog
   card, each with an ownership status (Owned / Wanted / etc.) + notes. Matches
   admin exactly. **Guest-added own cards (cards not in the catalog) are deferred
   to v2** (they require per-user image upload — out of scope for v1, same as the
   WASM tier's deferral).
4. **Scope:** Photocards only (consistent with the catalog being photocard-only).

## 3. Architecture

### 3.1 Identity & authorization (the one genuinely new piece)

CollectCore today has **zero auth/authorization code** — Cloudflare Access gates
the apex + api hosts at the edge and the app trusts whoever arrives. The `/pcs/`
tier changes that, because we are now letting *non-admin* Google accounts through
the edge, and we must (a) identify each guest to scope their rows and (b) stop a
signed-in guest from reaching admin endpoints.

**Model: Cloudflare Access authenticates; the app authorizes.**

- **Cloudflare Access** proves identity and enforces the allowlist at the edge.
  Two policies on the existing apex+api Access application:
  - *Admin policy* — allow only the admin email(s). Applies to everything that
    isn't `/pcs/*` or `/catalog/*`.
  - *Guest policy* — allow the guest email allowlist. Needed for `/pcs/*` (SPA)
    and the `/pcs/*` API paths.
- **The app reads the verified identity** and authorizes per request:
  - `/catalog/*`, `/guest*` → public (existing bypass; unchanged).
  - `/pcs/*` → any authenticated email (CF Access already enforced the allowlist).
    Rows are scoped to that email's `user_id`. **Never trust a client-supplied
    user id.**
  - Everything else (admin SPA, all module/admin/mutation routers) → email must
    be in `ADMIN_EMAILS` (new env var). Implemented as a single default-deny
    authorization gate (middleware or shared dependency), mirroring the existing
    `spa_host_routing` middleware pattern.

> **Hardening (recommended improvement over the current docs):** trust the signed
> **`Cf-Access-Jwt-Assertion`** JWT, not the plaintext `Cf-Access-Authenticated-User-Email`
> header. The plaintext header is forgeable by anyone who can reach the Railway
> origin directly (the public `*.up.railway.app` URL bypasses Cloudflare). Verifying
> the CF Access JWT (signed by the team's public keys at
> `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`) closes that hole.
> This matters now that the header drives *authorization*, not just attribution.
> Alternative/*and*: restrict the Railway origin to Cloudflare IP ranges. Pick JWT
> verification as primary; it's self-contained in the app.

**Local dev:** no CF headers exist on `localhost`. The identity dependency treats
the localhost host (already special-cased in `spa_host_routing`) as the admin
user, with an optional `DEV_USER_EMAIL` env to simulate a guest.

### 3.2 Data model (server-side, new tables)

Additive tables in the existing SQLite DB. `pcs_` prefix marks them as the cloud
guest tier's own tables (parallel to the deprecated `guest_` prefix).

```sql
CREATE TABLE IF NOT EXISTS pcs_users (
  user_id        INTEGER PRIMARY KEY AUTOINCREMENT,
  email          TEXT NOT NULL UNIQUE,        -- from verified CF Access identity
  display_name   TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at   TEXT
);

CREATE TABLE IF NOT EXISTS pcs_card_copies (
  copy_id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id            INTEGER NOT NULL REFERENCES pcs_users(user_id),
  catalog_item_id    TEXT NOT NULL,           -- stable contract key {group_code}_{id:06d}
  ownership_status_id INTEGER NOT NULL REFERENCES lkup_ownership_statuses(ownership_status_id),
  notes              TEXT,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_pcs_copies_user ON pcs_card_copies(user_id);
CREATE INDEX IF NOT EXISTS ix_pcs_copies_user_card ON pcs_card_copies(user_id, catalog_item_id);
```

Notes:
- Keyed by **`catalog_item_id`** (the published, monotonic contract key), matching
  the deprecated tier's `guest_card_copies` contract — robust if catalog item rows
  are ever rebuilt. (Keying by `item_id` would also work since it's the same DB;
  `catalog_item_id` is chosen for contract-stability and parity.)
- Reuses `lkup_ownership_statuses` — admin's vocabulary is the source of truth.
  Guests see **all** statuses including `Catalog` (per the existing decision:
  "guest filters to Catalog to see what they could collect").
- Brand-new additive tables → no `migrate_*.py`; `CREATE IF NOT EXISTS` in
  `schema.sql` covers fresh + existing DBs (same approach the listing tracker used).
- **No photocard / trade / catalog / module code is modified.** Strictly additive.

### 3.3 Backend endpoints (`/pcs/*`, authenticated, identity-scoped)

All scope by the verified user; all reject unauthenticated callers.

- `GET  /pcs/me` — provision-on-first-hit; returns `{ email, display_name, is_admin }`.
- `GET  /pcs/photocards` — catalog cards joined with **this user's** copies.
  Server-side port of `guestData.listPhotocards` (same response shape the admin
  `listPhotocards` returns, so the reused page needs no shape branching). Includes
  the synthetic `Catalog`-status row (`copy_id: null`) for untouched cards.
- `GET  /pcs/photocards/groups` · `/members` · `/source-origins` ·
  `/ownership-statuses` — read-only lookups the adapter needs, namespaced under
  `/pcs/` so the whole guest surface sits behind one authorization rule.
- `POST   /pcs/copies` — `{ catalog_item_id, ownership_status_id, notes }` → insert for caller.
- `PUT    /pcs/copies/{copy_id}` — partial update; ownership-checked (`copy.user_id == caller`).
- `DELETE /pcs/copies/{copy_id}` — delete; ownership-checked.

New router `backend/routers/pcs.py` + schemas `backend/schemas/pcs.py`; identity
dependency in something like `backend/auth.py`. Wire into `main.py` `include_router`.

### 3.4 Frontend (`/pcs/` SPA)

- New Vite build mode `pcs` (alongside `guest`/`mobile`/admin):
  - `base = '/pcs/'`, `assetsDir = 'pcs-assets'`, `outDir = backend/frontend_dist_pcs`.
  - `npm run build:pcs` → `vite build --mode pcs`; loads `.env.pcs`
    (`VITE_IS_ADMIN=false`, `VITE_IS_PCS=true`).
- `frontend/src/pcs/pcsData.js` — server-data adapter mirroring `guestData.js`'s
  exported read functions, but hitting `/pcs/*` endpoints over `fetch` instead of
  local SQLite. Write paths (`addCopy` / `updateCopy` / `deleteCopy`) call the
  `/pcs/copies` endpoints.
- Reuse admin's `PhotocardLibraryPage` + detail modal via the adapter + `isAdmin`/
  `isPcs` gating (the WASM guest already established this "Path A" reuse pattern).
- No login UI — Cloudflare Access handles the Google sign-in before the SPA loads.
  Small "Signed in as {email}" affordance, sourced from `GET /pcs/me`.

### 3.5 Serving & infra wiring

- **`main.py` `spa_host_routing`**: add `/pcs` alongside `/guest` — a `/pcs[/...]`
  GET on the apex host returns `frontend_dist_pcs/index.html` (React Router with
  `basename='/pcs'` takes over). Add `/pcs/pcs-assets/` to `_SPA_PASSTHROUGH_PREFIXES`.
- **`admin.register_frontend_static`**: mount `/pcs/pcs-assets` →
  `frontend_dist_pcs/pcs-assets` (parallel to the guest-assets mount).
- **`vite.config.js` `PROXY_PATHS`**: add `/pcs` (dev proxy → `:8001`).
- **Cloudflare Access**: add the guest allowlist policy scoped to `/pcs/*` (apex +
  api). Keep `/catalog/*` and `/guest` bypass policies as-is.
- **Railway env**: `ADMIN_EMAILS` (comma-sep). Confirm Railway origin isn't usable
  to bypass CF (see JWT hardening note).

## 4. Phased plan

- **Phase 1 — Backend (schema + identity + endpoints).** `pcs_users` /
  `pcs_card_copies` in `schema.sql`; identity dependency (CF JWT verify + localhost
  dev fallback); default-deny admin authorization gate; `/pcs/*` read + write
  endpoints; `ADMIN_EMAILS`. Locally testable by simulating the identity header.
- **Phase 2 — Frontend (`/pcs/` SPA).** `pcs` build mode + `.env.pcs`; `pcsData.js`
  adapter; reuse `PhotocardLibraryPage`; "signed in as" affordance. Dev via
  `npm run dev` (proxy → `:8001`).
- **Phase 3 — Infra & deploy.** `spa_host_routing` + static mount + `PROXY_PATHS`;
  CF Access guest policy; `build:pcs`; deploy; smoke test with a real friend email.
- **Phase 4 — Sunset `/guest/`.** Redirect `/guest/*` → `/pcs/` (or freeze
  read-only); update docs. **Optional one-time importer**: accept the old tier's
  backup JSON (`exportGuestBackup` format) and load it into `pcs_card_copies` for
  the signed-in user — only if any real guest data exists (likely none).

## 5. Risks / open items

- **Authorization correctness is now load-bearing.** The default-deny gate must be
  right, or a signed-in guest could reach admin mutation endpoints. Mitigate:
  single gate, deny-by-default for any path not in `{/pcs/*, /catalog/*, /guest,
  static assets}`; tests for guest→admin-endpoint = 403.
- **Header trust / origin exposure.** Resolve via CF Access JWT verification
  (§3.1) — primary hardening before exposing `/pcs/` to non-admins.
- **CF Access free tier = 50 users.** Fine for an allowlist of friends; revisit if
  it grows.
- **Catalog completeness.** Guests only see what admin has published to the catalog
  (`catalog_item_id IS NOT NULL`) — unchanged from today.

## 6. Relationship to other work

- **Independent of the listing tracker** except listing-tracker Phase 8
  (guest-visible prices), which depends on this `/pcs/` tier existing.
- Supersedes the `/guest/` WASM tier and the relevant parts of
  `deployment_and_auth.md` §Multi-User Model and `catalog_architecture.md`
  (those describe the deprecated tier for maintenance reference only).
