# Photocard Bulk Create, Imageless Catalog & Batch Image Window — Design & Phased Plan

> **Status: DONE — all 4 phases built, deployed to Railway, and live in prod
> (2026-07-17).** Verified end-to-end incl. a prod /pcs upload test (cleaned up
> after). Commits `48a8c91` (P1–3), `b415486` (P4 + dev R2 kill-switch),
> `c0bb8b8` (pcs modal fix). Kept as the authoritative design record.
>
> Motivating use case: a new album era (e.g. Stray Kids) drops with new card sets
> that need to exist in the app *before* release day (as placeholders), then get
> real front/back scans attached en masse once the physical cards arrive and are
> photographed — with /pcs/ friends able to **track those cards in their own
> libraries before images exist**, and optionally help attach images.

## 1. Goals

1. **Mass-create placeholder cards** for a set without the inbox / dummy-image
   workaround. (Built — Phase 1.)
2. **Let /pcs/ friends see & track imageless cards.** Friends must be able to add
   a not-yet-photographed card to their own library (with their own ownership
   status) as soon as the admin commits the set to the catalog — images or not.
   This is the piece that was blocking everything else.
3. **Batch-attach / batch-replace** front and back images across many cards in a
   single inbox-style, drag-and-drop, fully-staged window — replacing the slow
   one-card-at-a-time detail-modal flow.
4. **Let /pcs/ friends fill missing images** so new eras onboard faster — a
   friend's upload becomes THE catalog image for everyone.

## 2. Key facts this design rests on

- `POST /photocards` (`backend/routers/photocards.py:259`) creates a complete
  card (item → details → first copy → member xrefs) with **zero image
  attachments**. A card with no attachment is valid; missing images are a *data
  condition* (no `tbl_attachments` row), not a sentinel file.
- **Catalog membership = `catalog_item_id IS NOT NULL`, NOT ownership status.**
  The /pcs/ library query filters on it (`backend/routers/pcs.py:112`); so do the
  guest seed (`backend/seed_builder.py:115`) and delta (`backend/routers/catalog.py:65`).
- **`catalog_item_id` is a deterministic string** `{group_code}_{item_id:06d}` —
  it does **not** require an image to exist. Today it is only assigned at *image
  publish* (`backend/catalog_publisher.py:169`, via `_assign_catalog_item_id` at
  `:87`), and publish only sweeps cards that have a **local** (non-`http`) image
  attachment (`catalog_publisher.py:147-158`). **That coupling is the reason
  imageless cards are invisible to /pcs/** — the single thing Phase 2 fixes.
- **Admin ownership status never leaks to /pcs/.** The /pcs/ view ignores admin's
  `tbl_photocard_copies` entirely; it joins each catalog card to *that user's*
  `pcs_card_copies`, and **synthesizes a "Catalog" status** for any card the user
  hasn't annotated (`pcs.py:185-206`). So the admin can mark placeholders "Wanted"
  freely — friends see "Catalog" until they add their own copy.
- **/pcs/ reads the live server DB directly** (no local mirror). So a deleted
  catalog card simply stops appearing for friends on next load — **removal needs
  no tombstones on /pcs/.** (The deprecated WASM `/guest/` tier mirrors locally
  and can't cleanly reflect removals, but no new functionality goes there.)
- Per-card image writes already exist and handle attach-new and replace (with
  R2-orphan scheduling + `image_version` bump): `_replace_image`
  (`backend/routers/ingest.py:426`) → `POST /photocards/{id}/replace-front|back`.
- Existing publish flow (`backend/catalog_publisher.py` + `POST /admin/publish-catalog`)
  sweeps local images to R2. Unchanged by this plan except where Phase 2 adds an
  imageless commit path.

## 3. Decisions locked (2026-07-17 session)

1. **Bulk create = two explicit buttons** — "Create separate cards" (one per
   checked member) and "Create one combined card" (all checked members on one
   card). Each fires immediately. *(Built.)*
2. **Imageless cards must reach the /pcs/ catalog.** Fix by **decoupling
   `catalog_item_id` from image presence** — assign it at an explicit
   *commit-to-catalog* step, image or not. Do **not** use a real sentinel
   placeholder-image attachment (it reintroduces a magic image, forces per-card
   R2 copies, and needs an `is_placeholder` flag to stay distinguishable —
   strictly more moving parts than decoupling).
3. **"Not blank" appearance is a client-side concern.** Render a shared
   placeholder *graphic* (static asset; may show album/source name) whenever a
   card's front is null. No attachment row, no storage cost.
4. **Attach gate = "front attachment is null."** Clean data condition; the same
   signal Phase 3's "Missing front" styling uses. No content comparison, no flag.
5. **Catalog is no longer strictly monotonic.** Rare admin removals (mostly
   pre-workflow duplicate mistakes) are allowed and **must propagate**. On /pcs/
   that is automatic (live query); the only added work is deleting orphaned
   `pcs_card_copies` for the removed card. **Reverses the standing "catalog is
   monotonic / no removals" guardrail** in CLAUDE.md + memory — both need syncing
   before ship. *(CLAUDE.md intentionally left untouched this session.)*
6. **Commit is deliberate, not silent.** Bulk-create makes admin-only *drafts*
   (freely deletable); an explicit "Publish set to catalog" action assigns
   `catalog_item_id` (+ bumps `catalog_version`) and makes the set permanent &
   friend-visible. Preserves an intentional "I'm committing this" moment.
7. **Batch image window works over *any* current library filter** (not only
   missing-image cards); every card in the filter is a valid replace target;
   front and back are separate drop targets.
8. **Two-pane, inbox-style, fully client-staged batch window.** To-do pool on the
   left, captioned card grid on the right; drag to assign, red-x to unassign
   (returns file to pool, reverts slot to its true prior state — empty *or*
   original image), nothing written until an explicit commit; **paginated**, pool
   + staged assignments persist across pages.
9. **Missing-front appearance = the Phase 2B "Awaiting photo" placeholder graphic**
   (icon + label), used for admin and /pcs/ alike. The originally-planned green
   border / bold-green "Missing front" admin treatment was **dropped 2026-07-17**
   — the neutral placeholder is fine for internal admin scanning too.
10. **Friend-attach (last):** becomes THE catalog image for everyone; **no review
    queue** (trusted allowlist); **first-write-wins**; gated to **null-front**
    cards only.

---

## Phase 1: Bulk placeholder create — ✅ BUILT (2026-07-17)

**Goal:** Spin up all the cards for a set in one screen, no images required.

- New admin page `frontend/src/pages/BulkCreatePage.jsx`; route `/bulk-create`;
  `adminOnly` nav link "Bulk Create" in `frontend/src/modules.js`.
- Set selectors (group · category · source origin · version · card type ·
  ownership · notes) + member checkboxes (All/None), mirroring the inbox form.
- **Two buttons:** *Create separate cards* → one `POST /photocards` per checked
  member; *Create one combined card* → one `POST /photocards` with all checked
  members. `is_special` added to the `createPhotocard` API wrapper.
- Persists across nav via `bulkCreateState` in `photocardPageState.js`.
- **Verified:** both modes create valid cards with no attachments; `is_special`
  honored; test rows cleaned up. Frontend build clean.

### Milestone: DONE — an entire set exists as admin-only placeholder cards in a few clicks.

---

## Phase 2: Imageless catalog membership + removal (NEW — do first)

**Goal:** Make imageless cards first-class catalog members so /pcs/ friends can
see and track them; allow rare catalog removals that propagate. This unblocks the
whole friend-onboarding flow and is the prerequisite for Phase 4.

### 2A: Commit-to-catalog for imageless cards — BUILT
- Assigns `catalog_item_id = {group_code}_{item_id:06d}` **regardless of image
  presence** (`_assign_catalog_item_id` already falls back to this) and bumps
  `catalog_version`. Idempotent; skips already-committed; ignores non-photocards.
- **Commit surface = Admin page button "Publish New Cards to Catalog"** — a
  durable, one-shot "grab every draft (catalog_item_id IS NULL) and publish it"
  action next to *Publish Photocard Images*. Backed by
  `commit_all_drafts()` / `POST /admin/publish-catalog-drafts`. (The per-item
  primitive `commit_items_to_catalog()` / `POST /admin/commit-catalog` also
  exists.) Chosen over a Bulk-Create session panel (fragile — died on nav) and
  over a library filter (user didn't want more library clutter).
- Bulk Create just shows a static hint pointing to the Admin button; new cards
  are admin-only drafts until published there.
- Verified: committing imageless cards makes them appear in the /pcs/ response
  (front null, status "Catalog"); "publish all drafts" commits every draft.

### 2B: Client-side placeholder graphic
- Static asset rendered in the front slot whenever `front_image_path` is null,
  in both admin and /pcs/ library grids (shared render helper / `ImageSlot`).
  May display the source-origin / album name to read as intentional.
- Purely presentational — no attachment row, no DB change.

### 2C: Catalog removal that propagates
- Admin **remove-from-catalog / delete** path: extend `bulk_delete_photocards`
  (`photocards.py:527`) so deleting a committed card also **deletes orphaned
  `pcs_card_copies` WHERE catalog_item_id = <removed>** (friends' annotations for
  a card that no longer exists).
- On /pcs/, the card then simply stops appearing (live query) — no tombstone.
- Note (accepted limitation): deprecated WASM `/guest/` mirrors won't reflect the
  removal; that tier is frozen.
- **Decided (2026-07-17): drop friend copies silently.** Removing a card deletes
  all `pcs_card_copies` for it with no warning/confirm, even if a friend marked it
  Owned — removals are rare and mostly duplicate cleanup. No orphaned-copy surface.

### 2D: Guardrail reversal bookkeeping
- Update CLAUDE.md "catalog is monotonic" guardrail and the
  `project_catalog_is_monotonic` memory to reflect "rare removals allowed &
  propagated on /pcs/." (Do at ship time.)

### Milestone: an admin can commit an imageless set to the catalog; /pcs/ friends see those cards (front = placeholder graphic, status = "Catalog"), add them to their libraries, and lose them cleanly if the admin later removes one.

---

## Phase 3: Inbox-style batch image window — ✅ BUILT (2026-07-17)

**Goal:** Attach/replace fronts and backs across a filtered set of cards fast,
fully staged and undoable, in one screen. (Admin self-attach; independent of
Phase 2 but naturally used after it.)

**Built:** `frontend/src/pages/BatchImagePage.jsx`; route `/batch-images`;
`adminOnly` nav "Batch Images". Two-pane: scope bar (Group · Category · Source
Origin · Version · Show all/missing-front/back/either) → paginated card grid
(24/page) with per-card front+back drop slots, captions, existing-image previews;
left to-do pool. Images **move** between pool and slots (never duplicated) —
drag pool→slot, ✕ or Discard All returns them to the pool; only the pool ✕ /
commit destroy them. Save commits staged files via `replace-front|back`, then
prompts to publish images to R2 (existing flow). Verified end-to-end by the user
in the UI (incl. drag-source fix: tile `<img draggable={false}>` so a native
image drag doesn't masquerade as an OS-file drop). 3A dropped; 3B not built.

### 3A: Missing-front styling — DROPPED (2026-07-17)
The Phase 2B "Awaiting photo" placeholder graphic serves admin scanning too, so
the green-border / bold-green treatment was cut. No work here.

### 3B: (Optional) "Missing image" filter
- Library filter for "missing front" (and/or back) to scope the batch window to
  just-created placeholders. No `missing_front` query exists today (only
  `missing_back_only`, `ingest.py:233`) — small additive filter. Not required
  (any filter works) but high-value for onboarding.

### 3C: Batch image window — layout
- New two-pane page modeled on `InboxPage.jsx`: left **to-do pool** (files added
  via drag-in / picker), right **card grid** = cards in the current library
  filter, **paginated**, each with a **caption** (member(s) · version ·
  source_origin) and **two drop targets** (front, back). Existing images render
  in-slot.

### 3D: Batch image window — staging behavior
- Drag pooled file → slot shows *pending* (object-URL preview); file leaves pool.
- **Red-x** → returns file to pool, reverts slot to prior state (empty → placeholder;
  had-image → original image).
- Assignments held client-side in `itemId → { front?, back? }`, persist across
  pagination.
- **Commit** ("Save / complete queue") iterates staged assignments via
  `POST /photocards/{id}/replace-front|back`. Only assigned files commit.
- Post-commit images are `storage_type='local'` until *Publish Photocard Images*
  (unchanged existing flow). (Optional later: one `batch-replace` multipart
  endpoint; not required for MVP.)

### Milestone: a full era's fronts+backs attach in one staged pass with per-image undo, then publish via the existing button.

---

## Phase 4 (last): /pcs/ friends fill missing images — ✅ BUILT (2026-07-17)

**Goal:** Let allowlisted /pcs/ friends attach images to empty front/back catalog
slots; the upload becomes THE catalog image for everyone.

**Built:** `POST /pcs/photocards/{item_id}/upload-front|back` (`backend/routers/pcs.py`,
`require_user`-gated) → validates catalog card + empty side (409 if filled),
resizes, publishes to R2 (prod) or writes local (dev), inserts the `hosted`/`local`
`tbl_attachments` row, bumps `catalog_version`, records attribution in new
`pcs_image_contributions` table. Frontend: `uploadPcsImage()` in `pcsData.js`;
"Add front/back photo" affordance on empty slots in `PcsPhotocardDetailModal`
(both slots always rendered). Verified end-to-end (upload → attachment → version
bump → contribution → first-write-wins 409 → appears in `/pcs/`).

**Dev R2 kill-switch (important):** `backend/.env` carries **prod** R2 creds and
`main.py` loads it, so the dev app would otherwise read/write/delete the
**production** bucket. `COLLECTCORE_DISABLE_R2=1` (dev `.env`, gitignored) now makes
dev fully R2-inert: `catalog_publisher._make_r2_client` and
`admin_image_publisher._make_r2_client` refuse (so both admin publish flows fail
loud, never touching R2), `sweep_r2_orphans` skips at startup (no auto-deletes),
and the pcs upload stores local. Prod (Railway) leaves the var unset → normal R2.
Verified: sweep skipped, both publishes refused, pcs upload local. (CLI tools in
`tools/` are separate manual scripts — not covered, not run by the server.)

> Still the guardrail-crossing piece (**first non-admin write into the catalog /
> to R2**). Its own careful sub-plan against `docs/guest_cloud_accounts_plan.md`.
> Now unblocked by Phase 2 (cards are already friend-visible before images exist).

### Locked rules (decisions 2026-07-17)
- **Empty slots only, front AND back** — a friend can fill either side that is
  currently missing; can **never overwrite** an existing image. Admin retains the
  normal replace flow to fix anything.
- **Becomes THE catalog image** for everyone (publish-on-attach).
- **No review queue** — trust-and-attach for the allowlist.
- **First-write-wins** — once a side has an image, further uploads to it are
  rejected (409). Enforced by re-checking "no attachment for this side" inside
  the write.
- **UI = per-card "Add photo" in the /pcs/ library** — cards with a null front
  and/or back show an upload/drop affordance on the empty slot(s), right in the
  existing library view. No separate page.

### Build plan
- **Backend:** `POST /pcs/photocards/{catalog_item_id}/image` (multipart `file` +
  `side`), gated by `require_user`. Validates: catalog card exists; that side is
  currently empty (else 409); file is a valid image within a size cap. Resizes +
  uploads straight to the catalog R2 key `catalog/images/{catalog_item_id}_{f|b}_v1.jpg`
  (reuse `catalog_publisher._resize_to_jpeg` / `_make_r2_client`), inserts the
  `tbl_attachments` row as `hosted`, bumps `catalog_version`. Records contributor
  (which pcs user). Publish-on-attach — friends can't run the admin publish button.
- **Frontend:** `uploadPcsImage(catalogItemId, side, file)` wrapper; per-card
  affordance on null-image slots in the /pcs/ library, pcs-build only.

### Milestone: a /pcs/ friend attaches a front/back to a null-front catalog card and it becomes the shared catalog image, published and propagated.

---

## Sequencing & dependencies

1. **Phase 1** — done.
2. **Phase 2** — do next; unblocks friend visibility/tracking and is the
   prerequisite for Phase 4. Touches the catalog invariant, so lock design before
   coding.
3. **Phase 3** — admin batch attach; independent of Phase 2, can proceed in
   parallel or after. 3A (styling) is a quick standalone win.
4. **Phase 4** — last; depends on Phase 2 + the /pcs/ tier.

## Explicit non-goals / reversed decisions

- **Reversed:** "no placeholder asset" → a placeholder *graphic* is rendered
  client-side (still no sentinel *attachment*).
- **Reversed:** "catalog is monotonic / no removals" → rare removals allowed &
  propagated on /pcs/ (CLAUDE.md + memory to sync at ship).
- No new "set" table — set stays group + source_origin (+ version).
- No change to *Publish Photocard Images* / *Regenerate Guest Seed* image flows.
- No virtualization — pagination only.
- No sentinel/`is_placeholder` attachment; missing = null-front data condition.
