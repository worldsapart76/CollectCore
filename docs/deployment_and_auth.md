# Deployment, Auth & Multi-User Model

> Split out of `CLAUDE.md` 2026-05-15. Operational/infra detail needed when
> deploying or debugging hosting/auth — not every session. CLAUDE.md keeps a
> short "Deployment & Access" digest with the always-true facts and guardrails.

## Hosting

**LIVE on Railway + Cloudflare R2 since 2026-04-24.** Canonical history in
`C:\Dev\ARCHITECTURE.md` Decision A. Scope: CollectCore only (MediaManager,
Calibre, Jellyfin still target Unraid). Unraid self-hosting retained as fallback.

- **Backend:** FastAPI on Railway. `Root Directory=backend`, Procfile boots
  uvicorn on `$PORT`. SQLite DB on a 5GB Railway Volume mounted at `/data`.
- **Frontend (admin):** React SPA built into `backend/frontend_dist/`, committed
  to git, served via `register_frontend_static()` in `routers/admin.py`.
  `spa_host_routing` middleware in `main.py` routes by `Host` header / path so
  apex paths return `index.html` (avoiding API route collisions like
  `/photocards/library` matching the books detail route).
- **Frontend (guest):** separate `npm run build:guest` → `backend/frontend_dist_guest/`
  (`base='/guest/'`, `assetsDir='guest-assets'`); `/guest/*` GETs return the
  guest bundle.
- **Custom domains** (all on Cloudflare proxy / orange cloud):
  - `collectcoreapp.com` — admin SPA at `/`, guest SPA at `/guest/*`
    (path-mounted to stay within Railway free-tier 2-custom-domain limit)
  - `api.collectcoreapp.com` — API (also machine-to-machine + lingering desktop installer)
  - `images.collectcoreapp.com` — R2 public asset CDN
  - `collectcore-production.up.railway.app` — Railway's auto URL; marked
    "primary service domain" — leave in place (deletion has unclear side effects)

## Auth

**DECIDED 2026-04-25: Cloudflare Access with Google as identity provider.**
Live; gates `collectcoreapp.com` + `api.collectcoreapp.com` at Cloudflare's edge
before requests reach Railway. Free tier (50 users), household scale. Team:
`collectcore`. Full setup history in `docs/session_notes.md` 2026-04-25 Thread 7.

- ZERO code changes in CollectCore — auth happens at the network layer.
- Single Cloudflare Access Application covering apex + api subdomain so cookies
  are shared cross-subdomain (SPA at apex fetches from api.* without re-auth).
- **Bypass policy for `/catalog/*` and `/guest` paths** so the guest webview can
  hit read-only catalog endpoints without authentication.
- Identity headers (`Cf-Access-Authenticated-User-Email`) passed through to
  FastAPI for future per-user attribution without rebuilding auth.
- Trivially reversible: delete the Access app + Google OAuth client = gate gone.
  Migration path to Auth0/Clerk later is open.

## Multi-User Model

**Two-tier model, both web-only** (2026-04-25 pivot; ARCHITECTURE.md Decision B
originally had a local-mobile guest). Full reasoning: `docs/session_notes.md`
2026-04-25 Thread 8.

- **Admin tier** (household only): Cloudflare Access auth via Google, full CRUD
  against Railway, all images on R2. `https://collectcoreapp.com`.
- **Guest tier** (friends): no account, no login. Webview at
  `https://collectcoreapp.com/guest/` — WASM SQLite in browser
  (`@sqlite.org/sqlite-wasm`, persisted to OPFS via SAHPool VFS) holds the
  guest's catalog + annotations; pulls snapshot then deltas from `/catalog/*`.
  No writes against the cloud DB ever. Code-complete (Phase 7, 2026-04-26);
  deploy clicks in `docs/guest_deploy_runbook.md`. Guest UI in
  `frontend/src/guest/`, reuses admin's `PhotocardLibraryPage` with
  data-source branching and `isAdmin`-gated controls (Path A).
  **This `/guest/` WASM tier is deprecated** — being replaced by the
  authenticated `/pcs/` tier (`C:\Users\world\.claude\plans\guest-cloud-accounts.md`);
  no new functionality goes to `/guest/`.

**Capacitor mobile is INDEFINITELY DEFERRED.** The `mobile-shell` branch holds
the Phase 1 scaffold as reference. Mobile users get the responsive web app —
same URL, same data, no app store.
