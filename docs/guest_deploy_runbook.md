# Guest Webview Deploy Runbook (path-based)

Step-by-step checklist to take **`collectcoreapp.com/guest/`** live. Code
changes for this are already merged (Phase 6 prep v2, 2026-04-26 — pivoted
from `guest.collectcoreapp.com` subdomain to a path mount on the apex
because the Railway free tier limits custom domains to two and they're
already used by `api.*` + apex). This runbook is the sequence of clicks +
commands to execute when ready.

**Pre-flight sanity checks:**
- [ ] A guest library page exists in the frontend (the bundle renders
  something useful at `/guest/`). Phase 7 landed the full guest UI; ✓.
- [ ] Custom-domain quota is fine — this design adds **zero new domains**.
  Both admin and guest share `collectcoreapp.com`.

---

## Step 1 — Build + commit the guest bundle

The dist is `.gitignore`d while in development. Per the original Phase 0
plan, it gets committed at deploy time so Railway picks it up.

```bash
cd frontend
npm run build:guest
cd ..
git add backend/frontend_dist_guest/
git commit -m "deploy: ship guest webview bundle"
git push
```

Railway auto-deploys (~5-6 min — see `project_railway_deploy_time` memory).

---

## Step 2 — DNS / Railway custom domain

**Skip — nothing to do.** The guest bundle is served from the existing
apex (`collectcoreapp.com`), no new DNS record, no new Railway custom
domain. The path-routing middleware (`spa_host_routing` in
[backend/main.py](../backend/main.py)) handles `/guest/*` requests by
serving the guest bundle's `index.html`; React Router takes over with
basename `/guest`.

---

## Step 3 — Cloudflare Access bypass for /guest/*

The apex domain is currently behind Cloudflare Access (Google IdP). The
guest webview must NOT require login — anonymous visitors should reach
`collectcoreapp.com/guest/` directly.

The existing setup has two Self-hosted Applications:
1. **Main app** — `api.collectcoreapp.com` + apex root, gated by Google.
2. **Catalog bypass** — `api.collectcoreapp.com/catalog`, Bypass for
   everyone (so guest can fetch `/catalog/*` without login).

Add a third app for the guest path:

1. Cloudflare Zero Trust dashboard → Access → Applications.
2. Click **Add an application** → **Self-hosted**.
3. Configure:
   - **Application name:** `CollectCore Guest Webview`
   - **Application domain:** `collectcoreapp.com`
   - **Path:** `/guest` (and Cloudflare's "include subpaths" should be
     on — verify by reading the help text near the path field)
4. Policies → **Add a policy**:
   - **Policy name:** `Bypass`
   - **Action:** **Bypass**
   - **Include:** Everyone
5. Save.

Cloudflare Access evaluates more-specific destination matches first, so
`/guest/*` hits this bypass app and everything else on the apex still
hits the gated main app.

Verify in an incognito window: `https://collectcoreapp.com/guest/` —
should NOT redirect to Google login. `https://collectcoreapp.com/` —
should still redirect to Google login.

---

## Step 4 — CORS

**Skip — nothing to do.** The guest bundle's origin is
`https://collectcoreapp.com` (already an allowed origin in the existing
`CORS_ORIGINS` env var on Railway). Same-origin admin and guest, both
make cross-origin calls to `api.collectcoreapp.com` with credentials.

---

## Step 5 — Smoke test

In an incognito window:

1. Visit `https://collectcoreapp.com/guest/`. Should:
   - Skip Google login (the bypass app at `/guest` is matched first)
   - Render the splash → welcome modal flow on first visit
   - Show the photocard library with "Catalog" excluded by default
2. DevTools → Network — confirm:
   - Initial HTML loads from `collectcoreapp.com/guest/`
   - JS/CSS load from `/guest/guest-assets/...`
   - Catalog seed loads from `https://api.collectcoreapp.com/catalog/seed.db`
     (or 302 to R2)
   - The browser sends Cloudflare Access cookies on the API fetches
     (the `_nativeFetch` shadow in api.js sets `credentials: 'include'`,
     and CF allows credentials for `https://collectcoreapp.com`)
3. Application tab → Storage → IndexedDB / OPFS — confirm a
   `.guest-pool` directory appears after first visit (the SAHPool
   storage).
4. Open a card → confirm guest detail modal renders with read-only
   catalog metadata + add-copy buttons.
5. Hamburger menu → Help, Refresh catalog, Backup, Restore — each
   should respond. Backup downloads a JSON file.
6. Visit `https://collectcoreapp.com/` → should still hit Google login
   (admin gate intact).

---

## Step 6 — Cloudflare Access bypass for /trade/* (Trading v2)

> **Only required when the trade-page architecture
> (`plans/photocard-trading-v2.md`) ships.** Independent of the guest
> webview rollout above; can be done before, after, or in parallel.

The trade page (`collectcoreapp.com/trade/<slug>`) and the public
trade-data API (`api.collectcoreapp.com/trade` + `/trade/data/<slug>`)
must be reachable without login so trade recipients — including
non-CollectCore users — can view shared lists. Admin-only management
endpoints (`/admin/trades`, `/admin/trade/<slug>` DELETE) stay behind
the default gated policy.

Because the trade page lives in the **admin SPA bundle** (no separate
build), the admin asset path also needs bypassing — otherwise the HTML
loads but the JS chunks 401 and the page renders blank for unauth viewers.

Add a fourth Self-hosted Application (mirrors Step 3):

1. Cloudflare Zero Trust dashboard → Access → Applications → Add an
   application → Self-hosted.
2. Configure with **two domain entries** (use the "Add domain" button
   inside the application config):
   - `collectcoreapp.com/trade`
   - `collectcoreapp.com/assets` (admin SPA chunks; required for the
     trade page to render for unauthenticated viewers)
   - `api.collectcoreapp.com/trade`
3. Policies → Add a policy → **Bypass**, **Include: Everyone**.
4. Save.

**Caveat:** exposing `/assets/*` makes the admin SPA bundle publicly
downloadable. The bundle contains no secrets and the admin API host
remains gated, so a curious viewer can read JSX but cannot read your
data. Documented as an accepted trade-off in
`plans/photocard-trading-v2.md`.

Verify in an incognito window:
- `https://collectcoreapp.com/trade/<known-slug>` → loads HTML + JS,
  shows the trade page (no login prompt).
- `https://api.collectcoreapp.com/trade/data/<known-slug>` → returns
  JSON.
- `https://collectcoreapp.com/admin/trades` → still bounces to Google
  login (admin management remains gated).

---

## Rollback

If something breaks and you need to take guest offline immediately:

- **Fastest:** Cloudflare Zero Trust → Access → delete the bypass app
  for `/guest`. Within ~30s `/guest/*` becomes gated by the main app,
  so anonymous visitors get bounced to Google login. Admin unaffected.
- **Cleaner (if the guest bundle itself is broken):** revert the deploy
  commit on git (`git revert <sha> && git push`). Railway redeploys
  without the guest dist; `/guest/*` 404s on the static side and the
  middleware falls through to admin's index.html (admin still works).

The admin site is **completely unaffected** by anything in this runbook.
The bypass app addition only adds a public exemption; removing it just
re-gates the path.

---

## What's already done in code (Phase 6 prep v2, 2026-04-26)

- [vite.config.js](../frontend/vite.config.js): guest build uses
  `base: '/guest/'` + `assetsDir: 'guest-assets'` so the index.html
  references `/guest/guest-assets/...` and React knows its mount point.
- [main.jsx](../frontend/src/main.jsx): `BrowserRouter` reads
  `import.meta.env.BASE_URL` (set by Vite from the `base` config) and
  passes it as `basename`. Admin gets `/`, guest gets `/guest`.
- [backend/main.py](../backend/main.py): `spa_host_routing` middleware
  routes by path prefix — any `/guest/...` GET (that isn't a static
  asset) returns the guest bundle's index.html so React Router can take
  over. Apex root continues to serve admin's index.html.
- [backend/routers/admin.py](../backend/routers/admin.py):
  `register_frontend_static` mounts `/guest/guest-assets` from
  `frontend_dist_guest/guest-assets/`. New explicit `/guest/vite.svg`
  route serves the guest favicon.

Nothing in the live system has changed beyond what was already deployed
for path-routing prep.
