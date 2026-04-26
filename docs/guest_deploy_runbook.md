# Guest Webview Deploy Runbook

Step-by-step checklist to take `guest.collectcoreapp.com` live. Code changes
for this are already merged (Phase 6 prep, 2026-04-26). This runbook is the
sequence of clicks + commands you'll execute when you're ready to deploy.

**Pre-flight sanity checks:**
- [ ] A guest library page exists in the frontend (i.e. there's something
  useful to render at `/`). Currently the guest bundle only has the
  dev-only `_guest_debug` route. **If you deploy now, `guest.collectcoreapp.com/`
  is a blank page.** That's the main reason this runbook isn't auto-fired.
- [ ] You've decided whether Phase 4b (guest-added cards) lands before or
  after this deploy. Either is fine; the deploy doesn't depend on it.

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

Railway auto-deploys (~60-90s).

---

## Step 2 — Add the custom domain on Railway

1. Railway dashboard → CollectCore project → Settings → Networking.
2. Click **+ Custom Domain**.
3. Enter `guest.collectcoreapp.com`.
4. Railway gives you a CNAME target (something like
   `<service-id>.up.railway.app`). Copy it.

---

## Step 3 — DNS in Cloudflare

1. Cloudflare dashboard → `collectcoreapp.com` zone → DNS.
2. Add record:
   - **Type:** CNAME
   - **Name:** `guest`
   - **Target:** the Railway CNAME from Step 2
   - **Proxy status:** Proxied (orange cloud)
   - **TTL:** Auto
3. Save.

Wait 1-2 minutes for propagation. Test with `nslookup guest.collectcoreapp.com`.

---

## Step 4 — Cloudflare Access bypass for the entire host

The whole guest host is publicly accessible — that's the design. No login,
no Google auth.

1. Cloudflare Zero Trust dashboard → Access → Applications.
2. Click **Add an application** → **Self-hosted**.
3. Configure:
   - **Application name:** `CollectCore Guest`
   - **Session duration:** doesn't matter (bypass)
   - **Application domain:** `guest.collectcoreapp.com` (path empty)
4. Policies → **Add a policy**:
   - **Policy name:** `Bypass`
   - **Action:** **Bypass**
   - **Include:** Everyone
5. Save. No identity provider configuration needed for bypass.

Verify: in an incognito window, hit `https://guest.collectcoreapp.com/_guest_debug`.
You should land on the page with no Google login redirect.

---

## Step 5 — Update CORS on the backend

The guest bundle (`https://guest.collectcoreapp.com`) calls the API at
`https://api.collectcoreapp.com`. CORS must allow the new origin.

1. Railway dashboard → CollectCore → Variables.
2. Edit `CORS_ORIGINS`. Current value is something like
   `https://collectcoreapp.com`. Change to:
   ```
   https://collectcoreapp.com,https://guest.collectcoreapp.com
   ```
3. Save → Railway redeploys.

Verify: in browser devtools on `guest.collectcoreapp.com`, fetch
`https://api.collectcoreapp.com/catalog/version`. Should return JSON, not
a CORS error.

---

## Step 6 — Smoke test

In an incognito window:

1. Visit `https://guest.collectcoreapp.com/_guest_debug` (assuming the
   debug page is still in the build — it's gated behind `import.meta.env.DEV`,
   so a production guest build won't include it; test on a dev build instead).
2. For the actual production smoke test, visit
   `https://guest.collectcoreapp.com/` and verify whatever guest UI is live
   loads correctly.
3. DevTools → Network — confirm:
   - Initial HTML loads from `guest.collectcoreapp.com`
   - JS/CSS load from `/guest-assets/...` (NOT `/assets/...`)
   - Catalog seed loads from `https://api.collectcoreapp.com/catalog/seed.db`
     OR from R2 directly (302 redirect)
4. Application tab → Storage → IndexedDB / OPFS — confirm a `.guest-pool`
   directory appears after first visit (the SAHPool storage).

---

## Rollback

If something breaks and you need to take guest.* offline immediately:

- **Fastest:** Cloudflare DNS → set the `guest` CNAME to **DNS only** (gray
  cloud) or delete it. Site goes down within seconds.
- **Cleaner:** Railway → Networking → remove the custom domain. Cloudflare
  Access app can stay; it's harmless without a backing host.

The admin site is unaffected by anything in this runbook.

---

## What's already done in code (Phase 6 prep, 2026-04-26)

- [vite.config.js](../frontend/vite.config.js): guest build emits assets to
  `guest-assets/` instead of `assets/` so the two bundles don't fight over
  the `/assets/` URL prefix on the shared Railway service.
- [backend/main.py](../backend/main.py): `spa_host_routing` middleware now
  serves `frontend_dist_guest/index.html` when the request Host starts with
  `guest.`. `/guest-assets/` added to passthrough prefixes.
- [backend/routers/admin.py](../backend/routers/admin.py): `register_frontend_static`
  also mounts `/guest-assets` from `frontend_dist_guest/guest-assets/` when
  the dist exists. New `FRONTEND_DIST_GUEST` constant exported for the
  middleware.

Nothing in the live system has changed yet.
