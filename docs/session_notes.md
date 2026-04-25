# CollectCore — Session Notes

_Format: ### YYYY-MM-DD — brief completed / next summary_
_Keep last 3-5 sessions. Collapse older entries into "Completed to date" block._

> Update this section at the end of each working session with a brief
> summary of what was completed and what is next.

### 2026-04-26 — Cloudflare Access live (Phase 4/5 complete + credentials fix)

Finished the auth gate. The apex SPA + API are now gated by Google login at
Cloudflare's edge, with `/catalog/*` bypassed for the future guest webview.

**Cloudflare dashboard work:**
- Phase 4 — created the `collectcoreapp.com` Self-hosted Application: two
  destinations (apex + `api.` subdomain, both no path), Google IdP only
  with Instant Auth, 1-month session, CORS Allow Credentials ON, allowed
  origin `https://collectcoreapp.com`, "Allow all methods" (the per-method
  list lacked OPTIONS — required for CORS preflight). Attached two policies
  in order: `Catalog public bypass` (Bypass / Everyone) then `Household admins`
  (Allow / specific emails).
- Phase 5 verification surfaced a misconfiguration: Cloudflare's new Reusable
  Policies model has no path/hostname filter on the policy itself — those
  fields are destination-scoped now. So `Catalog public bypass` with
  `Include: Everyone` was bypassing the entire app (apex + api), and incognito
  could load the admin SPA without login. **Fix: split into two Applications.**
  Created a second app (`api.collectcoreapp.com/catalog`) with the bypass
  policy attached; detached the bypass from the main app. Cloudflare evaluates
  the more-specific destination first, so /catalog/* hits the bypass app and
  everything else falls through to the gated main app.
- Verification in fresh incognito: apex → Google login → SPA loads ✓,
  /catalog/version → JSON without login ✓, /photocards while authenticated → JSON ✓.

**Code changes (commit `3d264a6`):** SPA could load but every API fetch
returned "failed to fetch" because cross-origin requests weren't sending
the Cloudflare Access cookie. Two changes:
1. [backend/main.py:38-43](backend/main.py#L38) — `allow_credentials=True` on CORSMiddleware
2. [frontend/src/api.js:5-7](frontend/src/api.js#L5) — shadowed `fetch` with a wrapper
   that defaults `credentials: 'include'`. Covers all 140 fetch calls in api.js
   without touching each one. Also added explicit credentials to the one
   stray fetch in [TopNav.jsx:48](frontend/src/components/layout/TopNav.jsx#L48).

Built + pushed; Railway deployed; verified the SPA loads data after refresh.

**Status:** apex auth fully live. Mobile-friendly responsive web pass is
the next priority (Thread 9 from previous session).

**Next session:**
1. Begin responsive admin web work. Mobile-friendly layout pass on library +
   ingest pages. CSS variable system already in place; needs media queries +
   touch-target sizing + collapse-to-drawer for the filter sidebar.
2. After responsive admin lands: plan the guest webview. WASM SQLite library
   selection (sqlite-wasm vs sql.js vs libsql/client-wasm), guest build mode
   (probably `VITE_GUEST=true` toggling api.js to use local SQLite instead of
   fetch), `guest.collectcoreapp.com` Railway custom domain, Cloudflare Access
   bypass rule.

---

### 2026-04-25 — Apex SPA cutover + auth + mobile-vs-web architectural pivot

Massive session. Three independent threads landed (lazy-load sweep, Capacitor
mobile shell, custom API domain + APP_ROOT bug fixes), then a full architectural
re-think mid-session: the desktop installer is being retired entirely in favor
of a SPA served from Railway at the apex domain, gated by Cloudflare Access
with Google as the identity provider. As a side effect, the Capacitor mobile
build was indefinitely deferred in favor of responsive web for both admin and
guest tiers.

**Branch state when session opened:** `main`, with uncommitted lazy-load sweep
on photocard pages from yesterday. Working tree had assorted leftover scratch
from yesterday's GN merge that we left untracked.

---

#### Thread 1 — Lazy-load sweep across all 8 modules (10 min)

Yesterday's session added `loading="lazy" decoding="async"` to photocard `<img>`
tags only. Library pages for the other 7 modules still rendered covers eagerly.

All 7 non-photocard library pages route covers through the shared
[CoverThumb.jsx](frontend/src/components/primitives/CoverThumb.jsx#L17)
primitive (verified via grep for raw `<img>` in pages/), so a single edit
landed lazy-loading on every library + ingest cover instantly. The `{...rest}`
spread comes after the new attrs, so any caller can override `loading`/`decoding`
if they ever want eager-loading for above-the-fold imagery.

---

#### Thread 2 — Capacitor mobile shell (Phase 1) — created then DEFERRED

Set up Capacitor for Android on a new `mobile-shell` branch:
- Created branch off main carrying the lazy-load WIP edit
- `npm install @capacitor/core @capacitor/cli @capacitor/android` (81 packages, ~300MB node_modules growth)
- `npx cap init "CollectCore" "com.collectcoreapp.mobile" --web-dir dist`
  - App ID `com.collectcoreapp.mobile` matches the owned domain. Permanent identifier in Google Play once published; not changeable without filing a new app.
- `npx cap add android` — created full Gradle project under `frontend/android/`
- iOS skipped (Windows machine; user has Mac available for later)
- [vite.config.js](frontend/vite.config.js) made mode-aware: `npm run build:mobile`
  uses `base: './'` (relative paths required because the WebView loads index.html
  from device filesystem with no server) while default `npm run build` keeps
  `base: '/'` + dev-server proxies for desktop.
- Added `build:mobile`, `cap:sync`, `cap:open:android` scripts to [package.json](frontend/package.json)
- [frontend/.env.mobile](frontend/.env.mobile) points the mobile build at the
  Railway API + R2 with `VITE_ENABLED_MODULES=photocards`
- [frontend/.gitignore](frontend/.gitignore) excludes Gradle build outputs
  (`android/app/build/`, `android/.gradle/`), machine-local SDK paths
  (`android/local.properties`), and the cap-sync'd web bundle
  (`android/app/src/main/assets/public/`). Project source is tracked so
  Android Studio can open the project.
- Verified: `npm run build:mobile` produces relative asset paths, `cap sync android`
  copies dist into Android assets correctly. Desktop `npm run build` still
  produces absolute paths (no regression).
- Two commits on mobile-shell:
  - `4dd83d2` desktop-relevant changes (cherry-picked to main as `89add2d`)
  - `38b5051` Capacitor scaffold (mobile-shell only)

**Status: indefinitely deferred mid-session.** See Thread 6 below for why.
The branch sits parked. Reactivation would mean: open on Mac, run `npx cap add ios`,
build Android Studio APK, sideload to device, test against Railway. All work to
date is preserved, none of it is wasted as an architectural reference.

---

#### Thread 3 — `api.collectcoreapp.com` custom domain + Capacitor CORS prep

**CORS for the (then-planned) Capacitor WebView.** Capacitor's Android WebView
sends `Origin: https://localhost` on every fetch by default. Added that origin
to Railway's `CORS_ORIGINS` env var via the dashboard. First attempt missed
because Railway requires manual redeploy when env vars change (auto-redeploy
flaky); manual redeploy from the Deployments tab + the curl confirmed
`access-control-allow-origin: https://localhost` came back correctly. Diagnostic
that pinpointed the issue: testing a known-good origin (`http://localhost:5181`,
already in the list) returned ACAO; the new origin didn't. Confirmed middleware
worked, just needed the deploy to actually pick up the var.

**Custom API domain.** Bought nothing new — `collectcoreapp.com` was already
registered via Cloudflare Registrar yesterday. Added `api.collectcoreapp.com`
as a custom domain on Railway:
- Used Railway's "auto-configure Cloudflare DNS" button. It bounced through a
  confusing "domain marketplace" page after authorization (Railway tried to
  upsell a fresh domain) — ignore that page entirely; the auth flow had
  succeeded silently. Navigate back to Service → Settings → Networking.
- Result: CNAME `api` → `2jqmp6tm.up.railway.app` (Proxied — orange cloud),
  TXT `_railway-verify.api` for ownership verification.
- TLS cert issued by Railway in ~60 seconds. `curl https://api.collectcoreapp.com/health`
  returned the expected `{"status":"ok",...}`.
- Added `https://api.collectcoreapp.com` to `CORS_ORIGINS` on Railway.
- Updated three local env files to point at the new domain:
  - [frontend/.env.production](frontend/.env.production) (desktop installer build)
  - [frontend/.env.mobile](frontend/.env.mobile) (Capacitor — now dormant)
  - [backend/.env.example](backend/.env.example) (documentation)
- Greppped for any `collectcore-production.up.railway.app` references —
  only hits were in session_notes.md (historical, left as-is). No hardcoded
  URLs anywhere in `frontend/src`.

**Cloudflare proxy mode confirmed working in Proxied mode** — Railway's auto-config
defaults to orange-cloud now and they've engineered TLS issuance to work behind
Cloudflare. Earlier worry about needing to flip to DNS-only was unfounded.
Bonus: Cloudflare DDoS protection + edge caching come along for free. API
responses correctly bypass cache (`cf-cache-status: DYNAMIC`).

---

#### Thread 4 — `APP_ROOT → DATA_ROOT` bug fixes in routers/

Latent bugs flagged in yesterday's notes. Pattern: four sites in two files
resolved image file paths via `APP_ROOT / image_path`. Locally `APP_ROOT == DATA_ROOT`
so it worked by accident; on Railway `APP_ROOT` resolves to `/` (because
`Root Directory=backend` makes `db.py` live at `/app/db.py` so `parents[1]` = `/`)
while `DATA_ROOT` is `/data` (the volume mount). So `APP_ROOT / "images/..."`
on Railway = `/images/...` which doesn't exist; correct path is `/data/images/...`.

Fix: surgical swap of `APP_ROOT` for `DATA_ROOT` at all four sites:
- [routers/export.py:167,174](backend/routers/export.py#L167) — front_path / back_path resolution for PDF export
- [routers/ingest.py:407,457](backend/routers/ingest.py#L407) — old image cleanup paths in attach_back and replace_image flows

`admin.py` still uses `APP_ROOT` for `FRONTEND_DIST` — that's not a data path
so it stayed as-is in this commit, then was rewritten more thoroughly in Thread 5.

---

#### Thread 5 — `api.collectcoreapp.com` + clean main commit + Railway deploy

Branch hygiene: split the working-tree changes into two commits on
mobile-shell, then cherry-picked just the desktop-relevant commit to main:

- Commit A (desktop-relevant, both branches): cutover env URLs + lazy-load + APP_ROOT fixes
- Commit B (mobile-shell only): Capacitor scaffold

Cherry-picked A onto main as `89add2d`. main now has all desktop-relevant
changes; mobile-shell carries A+B. No dist commit yet.

(Originally planned a build-and-ship-installer-to-husband step here. Rerouted
mid-thread when investigating the build script — see Thread 6.)

---

#### Thread 6 — ARCHITECTURAL PIVOT: kill the desktop installer, serve SPA from Railway

While inspecting `C:\Dev\CollectCore-Build\build-release.bat` to ship the
installer, discovered the script is dramatically out of date — only copies
6 backend files, missing `routers/`, `dependencies.py`, `file_helpers.py`,
`requirements.txt`, all migrations, the schemas/ dir, etc. Husband's existing
installer must have been running on stale shimmed code that happened to work
for his read-only use of the cloud API.

Surfaced the question: **does the desktop installer still need a local backend
at all?** User's answer: no, pure webview. Then escalated: "He doesn't even
need a desktop icon if it's possible to just wire this up so that he goes to
a webpage he's got bookmarked."

This triggered the day's biggest design conversation. Result: **the desktop
installer is being retired entirely in favor of a SPA served from Railway at
the apex domain.**

**The implementation:**

1. **Apex custom domain on Railway.** Added `collectcoreapp.com` via the same
   auto-config Cloudflare flow as `api.` earlier. Cloudflare's "CNAME flattening"
   transparently handles the apex CNAME-at-root DNS-spec restriction.
   Verified: `curl https://collectcoreapp.com/health` returned API JSON
   (proving Railway routing works; the SPA serving was added next).

2. **Mode-aware Vite outDir.** [vite.config.js](frontend/vite.config.js) now
   writes to `../backend/frontend_dist/` for the default web build (which
   ships to Railway via git) and keeps writing to `dist/` for mobile mode
   (where Capacitor's `cap sync` expects it). `emptyOutDir: true` set
   explicitly to silence Vite's "outDir outside root" warning.

3. **`backend/frontend_dist/` committed to git.** ~640KB per release;
   gzipped JS is 144KB. Not worth a separate CDN. Railway's deploy picks
   it up automatically. [routers/admin.py](backend/routers/admin.py#L17)
   `FRONTEND_DIST` anchored to file location instead of `APP_ROOT` so the
   path resolves correctly on both local Windows and Railway's `/app/`
   layout.

4. **Host-based SPA routing middleware.** Critical and the trickiest piece.
   Added [main.py spa_host_routing](backend/main.py) middleware. The
   problem: API routes like `/photocards`, `/books/{id}` collide with SPA
   URLs like `/photocards`, `/books/library`. Without intervention,
   `https://collectcoreapp.com/books/library` would hit the books API
   router (matching `/books/{book_id}` with `id="library"`) and return
   JSON instead of the SPA HTML.

   Solution: middleware checks the `Host` header on every request. Requests
   to `api.*` or `localhost`/`127.0.0.1` pass straight through to the API
   routers as before. Requests to any other host (= apex SPA) get
   `index.html` for any GET that isn't a static asset (`/assets/`, `/images/`,
   `/vite.svg` are passed through). Six end-to-end tests verified — both
   locally with simulated Host headers and against live Railway after
   deploy:
   - api.* /health → JSON ✓
   - apex / → SPA HTML ✓
   - apex /photocards (collision) → SPA HTML, NOT JSON ✓
   - apex /books/library (deep collision) → SPA HTML ✓
   - apex /assets/* → JS file ✓
   - api.* /photocards → JSON (machine clients still work) ✓

5. **CORS update for apex.** Added `https://collectcoreapp.com` to Railway's
   `CORS_ORIGINS` so the SPA at apex can make cross-origin fetches to
   `api.collectcoreapp.com`. Final value:
   ```
   https://collectcore-production.up.railway.app,http://localhost:5181,http://localhost:5185,https://localhost,https://api.collectcoreapp.com,https://collectcoreapp.com
   ```

6. **Pushed to main, Railway auto-deployed**, all six tests passed against
   live URLs. Husband can now bookmark `https://collectcoreapp.com` and is
   done forever — future updates land on his next page refresh. The old
   desktop installer keeps working in parallel (it just calls
   `api.collectcoreapp.com` directly) until he uninstalls it.

**What was committed on main:**
- `89add2d` cutover: switch desktop + Railway backend to api.collectcoreapp.com
- `6fceae2` spa: serve React app from Railway at apex domain (collectcoreapp.com)

---

#### Thread 7 — SECURITY GAP surfaced + auth pivot

After confirming the SPA worked, user asked: "isn't my admin site and database
now just exposed to anyone on the internet with URL?"

YES, and it had been since yesterday's Railway cutover — today just made it
discoverable. Exposed:
- Reads: full library data via any module endpoint
- Writes: POST/PUT/DELETE on every endpoint
- `/admin/backup` could exfiltrate the entire SQLite DB
- `/admin/restore` could overwrite the entire DB
- `/admin/lookups/.../merge` could corrupt lookups

**Decision: Cloudflare Access with Google as identity provider** (over
HTTP basic auth, Auth0/Clerk/Firebase, or roll-your-own). Reasoning:
- Already in the Cloudflare ecosystem (DNS, R2, registrar, custom domains)
- Free tier (50 users — way over household needs)
- Zero code changes in CollectCore — gating happens at Cloudflare's edge
  before requests reach Railway
- Login with Google specifically: Cloudflare Access supports Google as a
  built-in IdP. User clicks login → Google OAuth → back to app.
- Trivially reversible — delete the Cloudflare Access app + Google OAuth
  client, gate disappears, no code to revert, no user data migration. ~5 min
  to unwind if migrating to Auth0/Clerk later.
- Future-proof: Cloudflare passes identity headers
  (`Cf-Access-Authenticated-User-Email`) through to FastAPI, so when in-app
  identity logic eventually lands, the user identity is already available.

**Setup in progress at session pause:**
- Cloudflare Zero Trust account created. Team name: `collectcore`. Team
  domain: `collectcore.cloudflareaccess.com`. Free plan.
- Google OAuth client (project "CollectCore Auth" in Google Cloud Console):
  - **Audience tab:** External, Testing publishing status, you + husband
    added as test users. (Testing chosen over In Production because the
    Cloudflare Access allow-list is the actual gate; Testing adds a redundant
    second layer at the Google side. In Production would expose the consent
    screen to all Google accounts — harmless because Cloudflare still rejects
    them, but pointless friction. Also avoids Google's app verification
    review which would be required for a polished consent screen in
    production mode.)
  - Branding tab: pending (App name CollectCore, support email, authorized
    domain `cloudflareaccess.com`)
  - Data Access tab: pending (scopes openid, userinfo.email, userinfo.profile)
  - Clients tab: pending (Web application, name "CollectCore Cloudflare
    Access", redirect URI `https://collectcore.cloudflareaccess.com/cdn-cgi/access/callback`)

**Phases status at session-end:**
- Phase 1 ✓ Cloudflare Zero Trust account created. Team: `collectcore`,
  team domain `collectcore.cloudflareaccess.com`.
- Phase 2 ✓ Google OAuth client created. Project "CollectCore Auth" under
  worldsapart76@gmail.com. Audience=External, Testing publishing status.
  Test users: worldsapart76@gmail.com + husband. Scopes: openid,
  userinfo.email, userinfo.profile. Web application client with redirect
  URI `https://collectcore.cloudflareaccess.com/cdn-cgi/access/callback`.
  Client ID + Secret in user's possession.
- Phase 3 ✓ Google IdP added to Cloudflare Zero Trust (under **Integrations
  → Identity providers**, NOT Settings → Authentication — Cloudflare moved
  the menu). Test connection succeeded — JSON returned name + email correctly.
- Phase 4 IN PROGRESS at session-end. Steps to complete:
  - Cloudflare Zero Trust → Access controls → Applications → +Add an
    application → **Self-hosted**
  - Application name: `CollectCore`
  - **Session duration: 1 month** (default 24h is too aggressive for a bookmark-and-go household app)
  - Application domains (TWO entries on a single app, so they share cookies):
    - `collectcoreapp.com` (apex, blank subdomain, blank path)
    - `api.collectcoreapp.com` (subdomain `api`, blank path)
  - Identity providers: **Google** only. Enable "Instant auth" if available
    to skip the IdP picker screen (only one IdP).
  - **CORS settings (CRITICAL — expand the section, it's collapsed by default):**
    - Allow credentials: ON
    - Allowed origins: `https://collectcoreapp.com`
    - Allowed methods: GET, POST, PUT, DELETE, OPTIONS
    - Allowed headers: all (or Content-Type, Authorization)
  - Two policies, IN ORDER (Bypass must come before Allow):
    1. **Bypass policy** — Action=Bypass, name=`Catalog public bypass`,
       Include=Everyone, Path=starts with `/catalog/`, Hostname=`api.collectcoreapp.com`.
       (If the policy editor doesn't have a Path field, may need a separate
       Application entry for `api.collectcoreapp.com/catalog/` with its own
       Bypass policy. Cloudflare's UI varies.)
    2. **Allow policy** — Action=Allow, name=`Household admins`,
       Include=Emails=[worldsapart76@gmail.com, husband's email],
       session duration=inherit (1 month).
- Phase 5 (verify, after Phase 4 saves):
  - Open incognito window
  - Visit `https://collectcoreapp.com` → expect Google sign-in flow → SPA
  - Visit `https://api.collectcoreapp.com/catalog/version` → expect JSON,
    no login (proves bypass works)
  - Visit `https://api.collectcoreapp.com/photocards` → expect login
    redirect (proves API is gated)
  - Keep main browser logged in; don't log out until incognito test passes

**KNOWN POST-AUTH CAVEATS — fix immediately after Phase 4 goes live:**

Once Cloudflare Access is gating `api.collectcoreapp.com`, the SPA at apex
will need to send cookies on its cross-origin fetches to api. Two changes
required (NOT YET MADE):

1. **Frontend:** the SPA's `api.js` fetch calls need `credentials: 'include'`.
   Without it, browsers don't send cross-origin cookies, so every API call
   from the SPA will hit Cloudflare Access and bounce back to login (infinite
   loop). Search for `fetch(` in `frontend/src/api.js` and add
   `credentials: 'include'` to the options. Build + deploy.
2. **Backend:** FastAPI's `CORSMiddleware` in `main.py` line 36-41 needs
   `allow_credentials=True` added. Without it, the browser refuses to
   trust the response from a credentialed request. After this change,
   `allow_origins=["*"]` is no longer permitted (CORS spec); the explicit
   list in `_cors_origins` already satisfies this.

If the apex SPA can't reach the API after Phase 4 lands, the credentials
caveats above are the first thing to check.

**Reversibility note:** Cloudflare Access is trivially reversible. Delete
the Access Application + the Google IdP + the Google OAuth client = gate
disappears, no code to revert, ~5 min to unwind. The credentials changes
in api.js + main.py are also harmless to leave in place even if Access is
removed (just unused capability).

---

#### Thread 8 — ARCHITECTURAL PIVOT #2: web-only guest tier (mobile permanently deferred)

Mid-Cloudflare-Access conversation, user asked: "is there any possibility for
skipping mobile apps altogether and just allowing guest users to log into a
streamlined web view? Obviously not my admin version, and their database would
still be local."

**Decision: yes, guests get a webview too. Mobile build indefinitely deferred.**

Rationale (the architecture wins):
- No app store distribution for guest tier (no Apple $99/yr, no Google Play
  review process, no APK sideloading)
- Instant guest onboarding — go to URL, no install
- Updates land instantly via `git push` → Railway redeploy → guest refreshes
- Same React codebase serves admin + guest, just different build flags
- WASM SQLite (sqlite-wasm or sql.js) gives guests a real persistent local
  SQLite database in the browser via OPFS / IndexedDB. Same SQLite as backend,
  same as Capacitor mobile would have used.
- ~10MB catalog easily fits in browser quotas (typically 1GB+ desktop, smaller
  on iOS Safari but well above need)
- PWA support via vite-plugin-pwa gives "install to home screen" if anyone
  wants the app-feel. Optional polish, not blocker.

Tradeoffs accepted:
- Browser storage CAN be cleared by user or evicted under storage pressure;
  Persistent Storage permission API mitigates. Worst case: guest re-pulls
  catalog on next visit (re-export from admin if they had local annotations
  via the future Trading flow).
- Native camera/file APIs limited via browser, but guests don't ingest
  (admin-only flow, and admin is web-only too in this model).
- iOS Safari has stricter storage policies than Chromium — fine at current
  catalog sizes; revisit if catalog grows past 100MB.

**Two-tier architecture (revised):**
```
collectcoreapp.com         → Admin SPA. Cloudflare Access + Google. Talks to Railway API.
guest.collectcoreapp.com   → Guest SPA (FUTURE). Public, no auth. WASM SQLite locally.
                             Pulls from R2 (seed.db) + Railway /catalog/* (deltas).
api.collectcoreapp.com     → API. Cloudflare Access gates everything except /catalog/*
                             (bypass rule for guests).
```

**The Capacitor `mobile-shell` branch is preserved as a reference, NOT deleted.**
If we ever want a true native mobile app (some Apple lockdown forces our hand,
or PWA capabilities prove insufficient), the work to date is a head-start.

---

#### Thread 9 — Priority order revised

User stated next-session priorities:
1. **Make admin web responsive for mobile screens.** Today's UI is desktop-density
   (sidebar + table layout). Phone/tablet usage needs at least responsive
   collapse, touch-friendly targets, mobile-appropriate filtering UX.
   This is the new top priority before guest webview.
2. **Build guest webview leveraging that responsive layout.** WASM SQLite,
   guest subdomain, bypass rule, PWA support.

---

**Disk state at session end:**
- main pushed to origin with two new commits: `89add2d` (cutover) + `6fceae2` (apex SPA)
- mobile-shell branch local only with `4dd83d2` + `38b5051` — NOT pushed, NOT merged. Sits parked.
- `frontend/android/` empty subdirs lingered after switching from mobile-shell to main; harmless cosmetic
- Untracked-and-leftover scratch from yesterday still untracked: `tools/merge_gn_from_backup.py`,
  `docs/collectcore_backup_20260424_192840.zip`, `tmp_merge/` — all safe to delete or keep
  per yesterday's notes
- Cloudflare Access Phase 1 done (Zero Trust account); Phase 2 in progress (Google OAuth client)

**Next session:**
1. **FIRST 30 min**: Finish Cloudflare Access setup (Phases 2-5 above). Without
   this the apex SPA is open to the internet. Critical.
2. **Then**: Begin responsive admin web work. Mobile-friendly layout pass on
   library + ingest pages. CSS variable system already in place; needs
   media queries + touch-target sizing + collapse-to-drawer for the filter
   sidebar.
3. **After responsive admin lands**: Plan the guest webview. WASM SQLite library
   selection (sqlite-wasm vs sql.js vs libsql/client-wasm — each has tradeoffs),
   guest build mode (probably `VITE_GUEST=true` toggling api.js to use local
   SQLite instead of fetch), guest.collectcoreapp.com Railway custom domain,
   Cloudflare Access bypass rule.
4. **Deferred:** PD1 (admin Catalog publish UI), PD2 (Trading export/import
   for guest data sharing), Capacitor mobile (no longer on roadmap).



**Backend on Railway, end-to-end.** Hobby plan + 5 GB volume mounted at `/data`. Service `collectcore-production.up.railway.app` builds via Railpack (Nixpacks now legacy), Root Directory=`backend`, Procfile boots uvicorn on `$PORT`. Local DB seeded onto the volume via a temporary `/admin/_bootstrap_db` endpoint (added, used, removed in three commits).

**Boot bugs surfaced and fixed during first deploy:**
- `db.py` resolved `SCHEMA_PATH` via `APP_ROOT / "backend" / ...` which assumed local layout — broke on Railway where `Root Directory=backend` puts `db.py` at `/app/db.py`. Anchored to `__file__.parent / "sql" / "schema.sql"` so it works in both layouts.
- `_run_migrations()` ran *before* `executescript(schema_sql)`, so on a fresh DB the Copper Age `UPDATE` crashed against a not-yet-created `lkup_graphicnovel_eras`. Added the same table-existence guard the rename migration uses.

**GN merge from husband's backup** (`docs/collectcore_backup_20260424_192840.zip`):
- 271 GN items in his vs 246 in mine → 25 new, 246 matched (mostly by ISBN; rest by title+series), 1 mine-only deletion ("Hack/Slash VS Chaos #1").
- Divergence report uncovered a real data-quality bug: **every matched item in mine had `top_level_category_id` pointing at "non-album"** (a music category) instead of Marvel/DC/Other. Leftover damage from the canonicalize migration. Merge replaced these with his correct values as a side effect.
- Policy: his = source of truth. Wrote [tools/merge_gn_from_backup.py](tools/merge_gn_from_backup.py) — pre-merge DB backup, name-keyed lookup remapping, full UPDATE of matched details + xrefs (writers/artists/tags), full INSERT of new items, image copy from his backup into `images/library/gn/` with new IDs. Single exception: `cover_image_url` on matched items kept (mine's R2 URLs) — overwriting with his local paths would have broken R2 routing.
- Final GN count: 246 + 25 − 1 = **270 items**. 25 new cover images uploaded to R2 via existing `tools/sync_admin_images.py`. All 270 GN items now serve from R2.
- Pre-merge backup at `data/collectcore_pre_gn_merge_20260424_195322.db`.

**Status visibility seed bug** (latent for weeks, exposed by Railway's frequent restarts):
- `schema.sql` lines 1727-1764 bulk-seeded `xref_ownership_status_modules` and `xref_consumption_status_modules` on every startup via `INSERT OR IGNORE ... CROSS JOIN`. `INSERT OR IGNORE` left existing rows alone, but every time a user *deleted* a row via Admin → Status Visibility (the way "uncheck this status from this module" is implemented), the next backend restart silently re-inserted it. Locally invisible since restarts are rare; on Railway every deploy reset toggles.
- Moved both seeds to [backend/db.py](backend/db.py) `_seed_status_visibility_xref()`, gated on the table being empty so the seed only fires on a truly fresh DB. Same function also cleans up 7 orphan `collection_type_id` rows (61, 62, 94, 155, 202, 258, 274) left in the Railway xref tables by the canonicalize migration. Guest mobile DBs are built by `tools/prepare_mobile_seed.py` and never run `init_db()`, so unaffected.

**Desktop client cutover:**
- `frontend/.env.production` → `VITE_API_BASE_URL=https://collectcore-production.up.railway.app` + `VITE_IS_ADMIN=true`. Loaded by Vite during `npm run build`/`preview` only; dev keeps using the Vite proxy to localhost.
- Deleted 5 dead library files (`CardGridItem`, `CardPairItem`, `CardDetailModal`, `LibraryGrid`, `libraryTransforms`) — leftover pre-rebuild library shells, the only remaining `127.0.0.1` hardcodes in `frontend/src/`.
- Validated end-to-end via `npm run build && npm run preview`: photocard library, all 8 modules, edit-and-persist round-trip all working against Railway+R2.

**Image performance — custom R2 domain:**
- Added `loading="lazy"` + `decoding="async"` to photocard grid + detail-modal `<img>` tags ([PhotocardGrid.jsx](frontend/src/components/photocard/PhotocardGrid.jsx#L254), [PhotocardDetailModal.jsx](frontend/src/components/photocard/PhotocardDetailModal.jsx#L532)). Helped initial paint but `PER PAGE = All` (10K+ cards) still surfaced broken images mid-page — Cloudflare's `pub-*.r2.dev` URL is throttled (development-only).
- Bought `collectcoreapp.com` via Cloudflare Registrar (~$10/yr, no markup). Connected `images.collectcoreapp.com` to the R2 bucket via Cloudflare dashboard → R2 → Custom Domains. Now serves the same content through the full Cloudflare CDN with edge caching.
- Added an idempotent host-rewrite migration to `db.py` that swaps `https://pub-8156609abf504c058e10ac0f5b7f6e95.r2.dev` → `https://images.collectcoreapp.com` across 7 tables / 10,988 rows on next startup. Rewrites both Railway and local DBs automatically; no-op on subsequent runs (LIKE filter).
- `R2_PUBLIC_BASE_URL` updated on Railway + `backend/.env` so future ingests write the new host.

**Known current state of disk:**
- `tmp_merge/` (his.db extract + cover cache + divergence_report.py) is local-only test scaffolding — safe to delete.
- `tools/merge_gn_from_backup.py` is uncommitted — worth keeping as a record of how the GN merge was performed.
- `docs/collectcore_backup_20260424_192840.zip` (his backup, 5 MB) untracked — keep or delete as preferred.
- `data/collectcore_pre_gn_merge_*.db` and `data/collectcore_pre_admin_sync_*.db` — pre-write backups from today's tools, safe to delete after a stable week.
- Cloud DB and local DB are again byte-similar (same schema and rows; only difference is the catalog_version is the same and any minor `updated_at` drift).

**Next:**
1. **Ship cutover installer to husband.** Rebuild via `C:\Dev\CollectCore-Build\build-release.bat`, hand him the new `.exe`. His old install keeps running locally as fallback until he installs the new one — at which point his data becomes the cloud data we just merged.
2. **Other modules' library pages** have inline `<img>` without lazy loading (Books, GN, Music, Video, Video Games, TTRPG, Board Games). Quick sweep — same `loading="lazy" decoding="async"` treatment.
3. **Phase 1 — Capacitor mobile shell.** `npx cap init` in `frontend/`, add Android+iOS, wire `.env.mobile` for guest thin-client. Already unblocked.
4. **Optional cleanups (low priority):** `api.collectcoreapp.com` to replace Railway's generated URL; `images/library/` (~4 GB local originals) safe to delete since nothing in DB references them anymore; latent `APP_ROOT / image_path` bugs in `routers/export.py` and `routers/ingest.py` should be remapped to `DATA_ROOT` before any export/re-ingest is attempted on Railway.

### 2026-04-24 (morning) — Phase 0b complete: Catalog + R2 image hosting (admin + guest)

**Scope clarification mid-session:** Initially built as photocard-Catalog-only (R2 hosts the guest-facing photocard subset). User clarified Path B intent: ALL admin images across all 8 modules must live in R2 so admin mobile can render them. Guest tier remains photocard-only. One bucket, two prefixes: `catalog/` (public, photocards) and `admin/` (unguessable URLs, all modules).

**Completed:**
- **Schema migration** ([backend/migrate_catalog_fields.py](backend/migrate_catalog_fields.py), idempotent; creates timestamped DB backup):
  - Added `tbl_items.catalog_item_id TEXT` + `catalog_version INTEGER`, partial UNIQUE index on catalog_item_id
  - Added `Catalog` ownership status, scoped to photocards only via `xref_ownership_status_modules`
  - Backfilled all 10,015 photocards with `catalog_item_id` derived from the existing attachment filename convention (preserves existing filenames; 866 legacy cards had filename-IDs drifted from `item_id` due to earlier consolidation migration — filename-driven derivation captures them correctly)
  - Fixed 3 pre-existing `schema.sql` drifts uncovered during seed build: added missing `date_read` column and `tbl_photocard_copies` table definition; relaxed `tbl_items.ownership_status_id` to nullable (all 10,015 photocards have NULL here since ownership moved to `tbl_photocard_copies` in the earlier copies migration)
- **New tools** (all idempotent, `--dry-run` supported, DB backup before writes):
  - [tools/publish_catalog.py](tools/publish_catalog.py): resizes photocard images to 600×924 JPEG 80%, uploads to R2 `catalog/images/{catalog_item_id}_{f|b}.jpg`, rewrites `tbl_attachments` to `storage_type='hosted'` with full R2 URL, bumps `catalog_version` globally. Skip rule: attachments already `storage_type='hosted'` are no-ops.
  - [tools/sync_admin_images.py](tools/sync_admin_images.py): migrates all non-photocard cover images (local paths AND remote 3rd-party URLs — Discogs, TMDB, RAWG, Amazon) to R2 `admin/images/{module}/{module}_{id:06d}.jpg`, resized to long-edge 1200px JPEG 85%. Covers books/gn/music/video/videogames/boardgames/ttrpg. Skip rule: `cover_image_url` already pointing at `R2_PUBLIC_BASE_URL` is a no-op.
  - [tools/prepare_mobile_seed.py](tools/prepare_mobile_seed.py): builds guest seed DB containing only photocards + exactly one `Catalog`-status copy each; no admin ownership state leaked. `--upload` flag pushes `seed.db` + `version.json` to R2.
- **Backend endpoints** ([backend/routers/catalog.py](backend/routers/catalog.py), publicly accessible, no auth):
  - `GET /catalog/version` → `{max_version, card_count}`
  - `GET /catalog/delta?since=N` → photocards with `catalog_version > N` (full metadata + R2 image URLs + member list)
  - `GET /catalog/seed.db` → 302 redirect to R2 if `R2_PUBLIC_BASE_URL` set, else `FileResponse` from `data/mobile_seed.db`
  - Registered in [backend/main.py](backend/main.py) and added to `PROXY_PATHS` in [frontend/vite.config.js](frontend/vite.config.js)
- **Admin UI gating** ([frontend/src/utils/env.js](frontend/src/utils/env.js), [frontend/.env.local](frontend/.env.local)): `VITE_IS_ADMIN=true` hides `Catalog` ownership status from all admin pickers via `api.js fetchOwnershipStatuses()` filter. Side effect: added `status_code` to `/ownership-statuses` response — fixed silent breakage in Boardgames/TTRPG/Music/VideoGames ingest pages that referenced `s.status_code === "owned"` (was always `undefined` before).
- **Photocard image rendering fix** — late-session bug found by user: [PhotocardGrid.jsx](frontend/src/components/photocard/PhotocardGrid.jsx#L238) and [PhotocardDetailModal.jsx](frontend/src/components/photocard/PhotocardDetailModal.jsx#L15) hardcoded `${API_BASE}/images/library/${filename}` with a regex that stripped R2 URLs down to just the filename. Replaced with a `resolveCardSrc()` helper that passes `https://` URLs through unchanged (hosted) and falls back to the original local-path + cache-buster behavior (for newly-ingested cards awaiting next publish). Non-photocard modules already used `getImageUrl()` correctly — they rendered R2 URLs fine with no change.
- **R2 initial upload (one-time):**
  - 10,710 photocard images → `catalog/images/`
  - 254 non-photocard covers → `admin/images/` (246 GN + 3 music + 2 VG + 1 video + 1 boardgame + 1 book copy; TTRPG has no covers yet)
  - 3.95 MB seed DB + `version.json` → `catalog/*`
  - Total R2 footprint: ~172 MB
  - Bucket: `collectcore` on account `5dd3976ce9d8e40c2862db2704dbb539.r2.cloudflarestorage.com`; public URL `https://pub-8156609abf504c058e10ac0f5b7f6e95.r2.dev`
- **End-to-end verification:** `/catalog/version` returns `{max_version: 3, card_count: 10015}`; `/catalog/delta?since=0` returns 10,015 cards with R2 URLs; `/catalog/delta?since=3` empty; all 10,710 photocard attachments now `storage_type='hosted'`; every populated non-photocard `cover_image_url` now points at R2.
- **Dependencies:** Added `boto3==1.35.0` to `backend/requirements.txt`.

**Known current state of disk:**
- Admin SQLite DB still local at `data/collectcore.db` (moves to Railway next phase)
- `images/library/` (~4 GB of originals) still on disk — nothing in the DB references them anymore; safe to delete once a week or two of stable running has passed. Pre-migration DB backups remain under `data/collectcore_pre_*.db`.
- Ingest flows still write local files + `storage_type='local'` rows. Sweep-to-R2 is manual via the two CLI tools until ingest is rewritten to upload directly during Railway deployment.

**Next:**
1. **Admin UI visual confirmation** (5 min): confirm `Catalog` is absent from photocard ownership dropdowns + filter sidebar. Code complete, not visually verified.
2. **Railway deployment** (biggest remaining piece): move `backend/` FastAPI + `data/collectcore.db` to Railway; set `VITE_API_BASE_URL` on the Electron desktop build to the Railway URL; once stable, ingest flows should be updated to write images directly to R2 (eliminates the "local fallback" window for newly-ingested cards).
3. **Phase 1 — Capacitor mobile shell** (can run in parallel with Railway): `npx cap init` in `frontend/`, add Android + iOS platforms, `.env.mobile` with `VITE_ENABLED_MODULES=photocards` and `VITE_API_BASE_URL=<railway-url>`. First build = guest thin-client against R2 Catalog. Admin mobile = same shell with `VITE_IS_ADMIN=true` + auth against Railway.
4. **Deferred (post-deployment):** PD1 (admin Catalog publish UI — currently CLI-only), PD2 (trading export/import), PWA offline cache.
5. **Cleanup candidate (low priority):** delete `images/library/` contents once R2 stability is confirmed.

### 2026-04-23 — Lookup admin/management UI (deferred #1)

**Completed:**
- **Deferred item #1 — Lookup admin/management UI.** Added view/edit/merge/re-activate/hard-delete for 38 managed lookup tables behind a new "Lookup Management" tab on the Admin page.
  - **New file:** [backend/routers/admin_lookups.py](backend/routers/admin_lookups.py) with a single `_LOOKUP_REGISTRY_LIST` (38 entries) as the source of truth for both the new management endpoints and the existing Unused Lookup Cleanup scanner. Each entry carries PK/name/sort/secondary columns, scope chain, refs (with per-ref `dedupe_cols` for xref uniqueness), and `cleanable`/`mergeable` flags.
  - **Endpoints:** `GET /admin/lookups/registry`, `GET /admin/lookups/{table}` (rows with usage counts + resolved scope names + scope_options), `PATCH /admin/lookups/{table}/{id}` (rename/sort/re-activate/secondary), `POST /admin/lookups/{table}/merge` (transactional FK rewrite with NULL-safe `IS` dedup), `DELETE /admin/lookups/{table}/{id}` (guarded: must be inactive + 0 refs).
  - **Merge guards:** 6 tables are flagged `mergeable=False` because a merge would cascade into child lookup tables or destroy rich copy-row data — `lkup_photocard_groups`, `lkup_book_format_details`, and the four top-level genre tables (book/game/music/video). Cross-scope merges return 400; UNIQUE rename conflicts return 409 with a "Consider merging" hint.
  - **Refactor:** `admin.py` scan/deactivate now derive their cleanable list from `cleanable_lookups_for_scan()` — the original Unused Lookup Cleanup behavior is preserved (verified: same 9 groups returned pre/post refactor).
  - **Frontend:** New "Lookup Management" tab in [AdminPage.jsx](frontend/src/pages/AdminPage.jsx) — table picker, name filter, show-inactive toggle, per-scope dropdowns, inline edit, active toggle, hard-delete button (gated on inactive + 0 refs), and a merge modal that only offers same-scope active candidates.
  - **E2E verified** against live SQLite: list/PATCH round-trip, UNIQUE conflict → 409, merge (unused→unused) rewrites+deactivates source, hard-delete of just-merged row succeeds, non-mergeable table → 400, cross-scope merge → 400, hard-delete of active row → 409.
- **CLAUDE.md:** Removed item #1; added a new deferred item for Admin UI polish — current layout is functional but clunky and needs design-pass after the broader CSS/design-system consolidation.

**Next:**
- Continue deferred items triage.

### 2026-04-22 — Unified Status Visibility System + deferred items triage

**Completed:**
- **Deferred items triage (partial):** Reviewed items #1–#2 from CLAUDE.md deferred list
  - **#1 (Image ingest rebuild):** Investigated, confirmed already implemented — removed from deferred list
  - **#2 (Ownership status dropdown) + #16 (Read/consumption status cross-contamination):** Identified as same root cause, designed and implemented unified solution (see Wave 4 below)
  - Items #3–#15 reviewed and categorized (defer vs fix) — awaiting user decisions
- **Wave 4: Unified Status Visibility System** (resolves former deferred #2, #8, #16):
  - **Schema:** Renamed `lkup_book_read_statuses` → `lkup_consumption_statuses` via migration in `db.py`; added `xref_ownership_status_modules` and `xref_consumption_status_modules` junction tables for per-module visibility scoping; seeded xref with all-modules-enabled defaults
  - **Backend:** Updated `GET /ownership-statuses` to accept optional `collection_type_id` filter via xref JOIN; added `GET /consumption-statuses?collection_type_id=` endpoint (replaces module-specific `/read-statuses`, `/play-statuses`, `/watch-statuses`); added `GET/PUT /admin/status-visibility` endpoints for Admin grid management
  - **Backend cleanup:** Updated all module routers (`books`, `graphic_novels`, `video`, `videogames`) to reference `lkup_consumption_statuses`; removed 3 module-specific status endpoints
  - **Frontend:** All 8 modules now pass `collection_type_id` when fetching ownership/consumption statuses; deleted `frontend/src/constants/hiddenStatuses.js` — all filtering is now DB-driven
  - **Admin page:** Rewrote with 4-tab layout (Modules, Backup & Restore, Lookup Cleanup, Status Visibility); Status Visibility tab has checkbox grid (statuses × modules) with optimistic UI updates and rollback on failure
  - **Migration:** Copper Age era deactivated via migration (removed from seed data)
- **CLAUDE.md updated:** Removed stale Image Ingest section, added accurate Image Handling section, removed resolved deferred items (#1, #8, #16), updated deferred #4 with Admin tab note, updated Railway prerequisites

**Next:**
- Continue deferred items triage: user decisions pending on #3–#15
- Bug fix candidates: #14 (GN ingest crash), #13 (BGG search verification)
- Test the new Status Visibility admin grid end-to-end

### 2026-04-21 — Photocard copies migration complete

**Completed:**
- **`tbl_photocard_copies` sub-table:** New table with `copy_id`, `item_id`, `ownership_status_id`, `notes`, `created_at`. Ownership now lives per-copy, not on `tbl_items`. Pattern mirrors `tbl_book_copies`.
- **Duplicate review tool:** Built `frontend/public/review-duplicates.html` — standalone HTML tool to review 111 duplicate groups (303 cards) with images side-by-side, select main vs sub-edition vs unique per group, export mapping JSON.
- **Data migration:** `backend/migrate_photocard_copies.py` — created copy rows for all 10,185 photocards, merged 170 sub-edition records into 99 main records (re-parented copies, deleted sub-edition items + 330 image files), nulled out `ownership_status_id` on `tbl_items` for all photocard rows. 28 unique cards identified and preserved. Final: 10,015 photocards, 10,185 copy rows.
- **Backend updates:** `_PHOTOCARD_SELECT` returns copies array via `_attach_copies()` helper; `POST /photocards` + ingest endpoints create first copy row; `PUT /photocards` no longer touches ownership/notes; `PATCH /photocards/bulk` ownership updates target `tbl_photocard_copies`; new copy CRUD: `POST/PUT/DELETE /photocards/{id}/copies/{copy_id}` with last-copy protection.
- **Owned/Wanted mutual exclusion:** Backend constraint prevents having both Owned and Wanted copies on the same card.
- **Grid badge overhaul:** Bottom-left shows `O` (green) or `W` (yellow) — mutually exclusive. Bottom-right shows other statuses concatenated (`T2P`, etc.). Special star moved to top-right.
- **Detail modal:** Ownership dropdown and notes field replaced with inline copies sub-table (ownership select + notes input per copy, add/delete copy buttons).
- **Library filter/count:** Ownership filter checks copies (card appears if any copy matches). Copy count shown alongside card count. Notes search includes copy notes.
- **Bulk edit:** Ownership update targets all copies; notes field removed; mixed-status warning dialog before applying.

**Next:**
- Update `docs/collectcore_summary.md` with new `tbl_photocard_copies` table and updated endpoints
- Update plan file status to reflect completion
- End-to-end testing of remaining flows (ingest, export, bulk operations)

### Completed to date (2026-04-08 through 2026-04-22)
- Photocard module: full rebuild (library, ingest, export, filters, bulk edit, modal nav/auto-save, filter state persistence, copies sub-table migration)
- Books module: v1 complete (schema, CRUD, ingest with ISBN/external search, library with filters/grid/bulk, Goodreads migration of 4,724 records)
- Graphic Novels module: v1 complete (multi-source series, ISBN lookup with multi-result picker, grid view, thumbnails, cover management)
- Video Games module: v1 complete (RAWG search, platform datalist, genre picker)
- Music module: v1 complete (Discogs search, 3-layer release/songs/editions, track list editor)
- Video module: v1 complete (TMDB integration, TV seasons vs movie copies routing)
- Board Games module: v1 complete (BGG search, expansions sub-editor, designer M:N)
- TTRPG module: v1 complete (system editions/lines scoped lookups, copies with per-copy ISBN)
- Shared filter sidebar system (FilterSidebar.jsx with tri-state toggles)
- CSS variable system + Inter font + green palette (light + dark mode)
- Admin: Backup & Restore (SQLite hot-copy + images ZIP)
- Build & release pipeline (Inno Setup installer, PowerShell launcher)
- Seed data for fresh installs
- Mobile Phase 0 (2026-04-13): API base URL externalization, imageUrl.js helper, VITE_ENABLED_MODULES config — no `127.0.0.1` hardcodes remain in active code
- Future module schemas fully designed (plan file: pure-inventing-whisper.md)
- Code quality overhaul Waves 1-4 (2026-04-22): CORS hardened, file upload sanitization, dead-code purge, shared style constants/components, collection-type + hidden-status constants, query consolidation (TTRPG/Boardgames detail joins), POST/PUT response standardization, transactional error handling on multi-step writes, `React.memo` on library item components
- GN ingest white-screen fix + collection-types canonicalize/resequence migrations (2026-04-21): `lkup_collection_types` cleaned to canonical IDs 1-8 matching schema.sql seed and `frontend/src/constants/collectionTypes.js`
