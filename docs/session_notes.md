# CollectCore — Session Notes

_Format: ### YYYY-MM-DD (US CDT) — brief completed / next summary_
_Keep last 3-5 sessions. Collapse older entries into "Completed to date" block._

> Update this section at the end of each working session with a brief
> summary of what was completed and what is next.

### 2026-04-25 (later) — Photocard Inbox mobile layout

Mobile-only branch in
[InboxPage.jsx](frontend/src/pages/InboxPage.jsx) gated by
`useMediaQuery(MOBILE_BREAKPOINT)`; desktop layout untouched.

- Horizontal scrollable thumbnail strip replaces the desktop 220px left rail.
  Image-only thumbs (no filenames). F/B badge top-right (tap to toggle side
  without selecting), ✕ remove top-left, body tap selects.
- Selected thumb grows in-place to 100×154 (~2:3 photocard aspect ratio);
  unselected stay 64×64 square. Strip auto-grows to fit; smaller thumbs
  center-align against the larger one. Replaces a separate preview area
  entirely — saves vertical space for keyboard.
- Thin status row beneath strip shows just the Front/Back/Pair badge or the
  invalid-pair alert.
- Form fields stack single-column, full-width, with bumped tap targets.
  Sticky bottom action bar (`position: sticky; bottom: 0`) with full-width
  primary button (Ingest as Front / Attach Back / Ingest as Front + Back).

**Two unrelated bugs surfaced + fixed during this work:**
- `from main import _PHOTOCARD_SELECT, …` in
  [ingest.py:229](backend/routers/ingest.py#L229) and
  [export.py:140](backend/routers/export.py#L140) was stale — those helpers
  live in `routers/photocards.py`. ImportError at request time → 500 on
  `/ingest/candidates` and `/export/photocards`. Fixed both imports.
- `libraryImageUrl()` in
  [InboxPage.jsx](frontend/src/pages/InboxPage.jsx) was prepending
  `${API_BASE}/` to every `front_image_path`, but post-cutover those are full
  R2 URLs. Added a `^https?://` passthrough — same pattern as
  `resolveCardSrc()` in PhotocardGrid.

---

### 2026-04-25 (later) — Sort + Select icons in TopNav (photocards)

- New `PageActionsContext`
  ([PageActionsContext.jsx](frontend/src/contexts/PageActionsContext.jsx))
  with `usePageActions(actions, deps)` for pages and `usePageActionsList()`
  for TopNav. Action shape: `{ id, iconName, kind: 'menu' | 'toggle', label, … }`.
  TopNav owns the SVG icons (`sort`, `select`) and the popover renderer.
  Provider wraps the tree in
  [AppShell.jsx](frontend/src/components/layout/AppShell.jsx).
- TopNav renders registered actions in the mobile right cluster, before the
  filter icon. `kind: 'menu'` opens an anchored popover (click-outside +
  route-change dismiss); `kind: 'toggle'` is a stateful icon.
- [PhotocardLibraryPage.jsx](frontend/src/pages/PhotocardLibraryPage.jsx)
  registers Sort + Select via `usePageActions`. Desktop Sort dropdown +
  Select button got `desktop-only` so they hide on mobile. Select icon is a
  toggle: tapping while in select mode calls `exitSelectMode()`, doubling as
  Done.
- Layout fix: card count was getting bumped to the same wrapped row as the
  All/Clear/Bulk Edit/Done buttons on mobile. Split the select-mode buttons
  into their own `selectBar` row beneath the main controls bar so the card
  count stays anchored under the TopNav icons.

---

### 2026-04-25 (later) — Photocard bulk edit modal on mobile

- [PhotocardBulkEdit.jsx](frontend/src/components/photocard/PhotocardBulkEdit.jsx)
  was the only module still rendering bulk edit as an inline 420px flex sibling
  of the grid (`bulkEditArea` inside library `body`). On phones the right edge
  was cut off. Migrated to the shared `<Modal size="sm">` primitive — same
  pattern as the other 7 modules — which auto-fullscreens at ≤640px via
  `.cc-modal`. In [PhotocardLibraryPage.jsx](frontend/src/pages/PhotocardLibraryPage.jsx)
  the bulk edit now renders at top level next to `PhotocardDetailModal`; the
  `bulkEditArea` style entry was deleted.
- Audit of the other 7 modules confirmed they already use `<Modal>` for bulk
  edit, so no further fixes needed for next-step item #1.

---

### 2026-04-25 — Cloudflare Access live + responsive web Phase 1 (all 8 modules)

Two big landings: the auth gate is fully live, and responsive Phase 1 shipped
across every module library.

**Auth gate (Cloudflare Access):**
- Two Self-hosted Applications: main app (apex + `api.`) gated by Google IdP
  with 1-month sessions; secondary app (`api.collectcoreapp.com/catalog`) with
  Bypass policy. Cloudflare evaluates the more-specific destination first, so
  /catalog/* hits the bypass and everything else is gated. (Reusable Policies
  model has no path/hostname filter on the policy itself — destination-scoped
  only, which is why two apps are required.)
- CORS Allow Credentials ON, allowed origin `https://collectcoreapp.com`,
  "Allow all methods" (per-method list lacked OPTIONS, breaking preflight).
- Code: `allow_credentials=True` on backend CORSMiddleware; frontend
  [api.js](frontend/src/api.js#L5) shadows `fetch` to default
  `credentials: 'include'` (covers all 140 fetch calls).

**Responsive Phase 1 — mobile chrome:**
- TopNav on mobile: hamburger left, brand center, funnel-filter right (funnel
  only renders when current page has a filter sidebar). Filter sidebar moved
  into a slide-in drawer (right) and main nav into a slide-in drawer (left).
  Communication via `collectcore:filters-available` / `collectcore:filters-toggle`
  custom events — no shared store.
- Drawers dismiss via backdrop tap / ESC only (no close X — was confusing
  alongside filter-clear X). Drawer width 170px (40% trim from initial 280).
- `.cc-modal` primitive collapses to fullscreen at ≤640px — auto-applies
  to every detail modal across all 8 modules.

**Responsive Phase 1 — library grids (all 8 modules):**
- Cards-per-row stepper (− N +, range 2–8) replaces SIZE picker. Persisted
  to localStorage in
  [photocardPageState.js](frontend/src/photocardPageState.js#L1).
- Infinite scroll (30 initial, +30 per batch) replaces pagination. Uses
  IntersectionObserver with the closest scrollable ancestor as `root`
  (default viewport doesn't work — scrolling happens inside an inner
  `gridArea` div).
- Grid switches from flex-wrap to CSS grid; cells use `aspect-ratio` so
  heights derive from container width — no fixed pixel sizing on mobile.
- Photocard badges scale via container queries (`cqw` units).
- Forced fronts-only viewMode on mobile photocards (consistent column widths).

**Bugs fixed in Phase 1:**
- GN + Music wrap their FilterSidebarShell in a fixed-width 220px outer div.
  Inner shell goes `position: fixed` on mobile but the wrapper stayed in flex
  flow → 220px gap. Fix: `library-sidebar-wrap` class with
  `display: contents !important` on mobile.
- Ownership badge appeared upper-left on mobile (non-photocard modules).
  Cause: shared CSS rule `.cc-mobile-grid-cell__cover > div { 100%×100% }`
  was matching absolute-positioned overlays, overriding the wrapper's
  `bottom: 4` anchor. Fix: scoped to `> div:not([style*="absolute"])` so
  only the No-Cover placeholder stretches
  ([app.css:978](frontend/src/styles/app.css#L978)).

**Memory captured:**
[`project_guest_ui_simplifications.md`](C:/Users/world/.claude/projects/c--Dev-CollectCore/memory/project_guest_ui_simplifications.md)
tracks admin-only controls to hide in the guest build. First entry: photocard
SORT dropdown (filtering is the right primitive at 10K+ scale).

**Status:** Apex auth fully live. Responsive Phase 1 complete across all 8
modules — shared filter drawer, full-screen modals, cards-per-row + infinite
scroll on every library grid, mobile-correct ownership badges.

---

### Next steps

1. **Detail-page mobile pass.** Modals fullscreen automatically, but the form
   layouts inside (multi-column flex rows, side-by-side image upload widgets)
   need a per-module audit.
2. **Ingest flows on mobile.** Photocard Inbox done. Books ISBN lookup +
   Music Discogs / Video Games RAWG / Board Games BGG search modals still
   assumed desktop density. Untested on mobile.
3. **Admin page on mobile.** Mostly forms + buttons, probably fine, but
   unverified.
4. **Per-row stepper UX.** Swap for slider/dropdown if it feels clumsy in
   extended use.
5. **Guest webview** (separate track). Phase 1 admin responsive is the
   prerequisite that's now done. Wire WASM SQLite + catalog snapshot pull +
   `VITE_IS_ADMIN` simplifications.

_(Mobile table overflow intentionally kept as-is — horizontal scroll on
phones is acceptable for the table views.)_

---

### 2026-04-24 — Apex SPA cutover + auth pivot + mobile-vs-web architectural pivot

**Three architectural decisions landed in one session.** Canonical state lives
in `CLAUDE.md`; this entry preserves the reasoning.

1. **Desktop installer retired; SPA serves from Railway at apex.** Discovered
   the desktop-installer build script was dramatically out of date (only
   copied 6 backend files). User chose webview over fixing it: husband (and
   any admin) bookmarks `https://collectcoreapp.com`. Implementation: SPA
   built into `backend/frontend_dist/` (committed, ~640KB), served via
   `register_frontend_static()`. Critical piece is `spa_host_routing`
   middleware in [main.py](backend/main.py) — checks `Host` header, routes
   apex requests to `index.html` (else `/photocards` would hit the API
   router and return JSON). `api.*` and localhost pass through to API.
2. **Auth via Cloudflare Access + Google IdP.** Apex SPA was open to the
   internet after the cutover. Chose Cloudflare Access over Auth0/Clerk:
   already in CF ecosystem, free 50-user tier, zero code changes (gating at
   edge), trivially reversible. `/catalog/*` bypassed for future guests.
3. **Capacitor mobile indefinitely deferred; guests get web too.** Discovered
   WASM SQLite (sqlite-wasm/sql.js + OPFS) gives guests real local SQLite
   in-browser. Eliminates app-store distribution, instant updates, same
   codebase. iOS Safari storage policies fine at current ~10MB catalog.
   `mobile-shell` branch parked as reference (not deleted, not merged).

**Other completed work this session:**
- Lazy-load (`loading="lazy" decoding="async"`) added to
  [CoverThumb.jsx](frontend/src/components/primitives/CoverThumb.jsx#L17),
  cascading to all 7 non-photocard library + ingest covers.
- `api.collectcoreapp.com` custom domain on Railway via Cloudflare auto-config
  (orange cloud / Proxied works fine). All env files updated.
- `APP_ROOT → DATA_ROOT` fixes in [export.py:167,174](backend/routers/export.py#L167)
  and [ingest.py:407,457](backend/routers/ingest.py#L407) — local accident
  worked because `APP_ROOT == DATA_ROOT`; on Railway they diverge (`/` vs
  `/data`).

**Setup notes worth preserving:**
- Cloudflare Zero Trust team domain: `collectcore.cloudflareaccess.com`.
- Google OAuth client (project "CollectCore Auth"): Audience=External,
  Testing publishing status (Cloudflare allow-list is the actual gate;
  Testing avoids Google verification review). Test users: user + husband.
  Redirect URI: `https://collectcore.cloudflareaccess.com/cdn-cgi/access/callback`.
  Google IdP added under **Integrations → Identity providers** (Cloudflare
  moved this menu — NOT under Settings → Authentication).
- Railway env-var redeploy is flaky on auto; manual redeploy from the
  Deployments tab is more reliable.

---

### Completed to date (through 2026-04-24)

- All 8 modules v1-complete (Photocards, Books, Graphic Novels, Music,
  Video, Video Games, TTRPG, Board Games) — full CRUD, library, bulk edit,
  ingest. See `docs/collectcore_summary.md` for endpoint authority.
- Backend on Railway with `/data` volume; admin SQLite migrated from local;
  status-visibility seed bug fixed (was re-inserting deleted rows on every
  restart); 7 orphan xref rows from canonicalize migration cleaned up.
- All images on R2 via custom domain `images.collectcoreapp.com`:
  10,710 photocards under `catalog/images/`, 254 covers under `admin/images/`.
  CLI sweepers ([tools/publish_catalog.py](tools/publish_catalog.py),
  [tools/sync_admin_images.py](tools/sync_admin_images.py)) handle local→R2
  promotion (direct-to-R2 ingest is future work). Host-rewrite migration in
  `db.py` flipped 10,988 rows from `pub-*.r2.dev` to the custom domain.
- Catalog architecture: `catalog_item_id` + `catalog_version` on `tbl_items`,
  `Catalog` ownership status (photocards only), backend
  [catalog.py](backend/routers/catalog.py) endpoints, admin UI gated by
  `VITE_IS_ADMIN`.
- GN merge from husband's backup: 270 final items (246 + 25 new − 1 mine-only).
  Surfaced and fixed a `top_level_category_id` bug (every matched GN was
  pointing at "non-album" — leftover canonicalize-migration damage).
- `tbl_photocard_copies` migration: 10,015 photocards, 10,185 copies. Owned/
  Wanted mutual exclusion enforced. Grid badges, detail modal, filter/count,
  bulk edit all rewired to copies.
- Lookup admin/management UI on Admin page — view/edit/merge/re-activate/
  hard-delete for 38 lookup tables, with merge guards on 6 high-risk tables.
- Unified Status Visibility System (`xref_ownership_status_modules`,
  `xref_consumption_status_modules`); Admin grid for per-module visibility;
  per-module status endpoints removed in favor of `?collection_type_id=`.
- Shared FilterSidebar with tri-state toggles, CSS variable system, Inter
  font + green palette (light + dark mode), Admin Backup & Restore (SQLite
  hot-copy + images ZIP).
- Code quality Waves 1-4 (CORS hardened, file upload sanitization, dead-code
  purge, shared style constants/components, query consolidation, transactional
  error handling, `React.memo` on library item components).

**Disk leftovers safe to delete after a stable week:**
- `tmp_merge/`, `tools/merge_gn_from_backup.py`, `docs/collectcore_backup_20260424_192840.zip`
- `data/collectcore_pre_*.db` (pre-write backups)
- `images/library/` (~4 GB) — DB no longer references these
- `C:\Dev\CollectCore-Build\` — desktop installer scaffolding, retired
