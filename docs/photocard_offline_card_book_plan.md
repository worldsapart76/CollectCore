# Photocard Offline Card Book (PDF) — Plan

**Status:** designed, not built. Drafted 2026-09-27.
**Trigger:** two weeks in Korea + Japan from 2026-10-02. Shopping for photocards
in person with unreliable signal and a metered international plan.

## Goal

One downloadable PDF that answers **"do I already have this card?"** while
standing in a shop with no connection. Generated in prod, by the admin app and
(later) by `/pcs/`, so other users get the same thing for their own collections.

## Non-goals — deliberately dropped

An earlier design in this same conversation grew an offline SPA (service worker,
snapshot in IndexedDB, image pre-cache, a synced trip-purchase list, a bulk
review screen that wrote statuses back). **All of it is out.** It solved a
problem the user reframed away: the requirement is only (a) don't burn roaming
data and (b) don't be without the card list when signal drops.

Specifically not built: offline app shell, offline status editing, purchase
logging, cross-device sync, R2 CORS rules, browser storage of any kind.

Purchases made on the trip get entered in the real app when signal exists (it is
cheap — see Measured facts) or jotted in a notes app when it doesn't.

## Measured facts (2026-09-10 / 2026-09-27, this conversation)

These are why the design looks the way it does. Re-measure before trusting them
later.

| Fact | Value | Source |
|---|---|---|
| `GET /photocards` | 4.58 MB raw / **155 KB gzipped**, 10,024 cards | dev backend on :8011 |
| Prod compresses JSON | yes — 163 KB → **12 KB** gzip at the edge | `api.collectcoreapp.com/catalog/delta?since=700` |
| Prod catalog size | 11,835 cards | `/catalog/version` |
| Front images | avg **10.9 KB**, median 6.9 KB, p90 9.4 KB, max 116 KB | 295 HEADs to R2 |
| Back images | avg 62.9 KB, only ~695 cards have one | 60 HEADs |
| All fronts | **~130 MB** | extrapolated |
| Multi-member cards | **473** | dev DB `xref_photocard_members` |
| Non-ASCII in labels | **none** across 73 origins, 626 versions, 8 members | dev DB |
| PDF library installed | **none**. Pillow 12.1.1 + boto3 1.35.0 are present | `backend/requirements.txt` |
| Public image domain vs scripts | **403** to Python's default UA; fine with a browser UA | 360 HEADs |

Conclusion on (a): the app is already frugal. A library load costs ~0.2 MB, and
images/JS carry one-year immutable cache headers. A realistic two-week trip is
well under 100–200 MB. **No app change is needed for (a).**

## Decisions (confirmed by the user)

1. **Unit / OT8 cards repeat in every member's section**, with a small "unit"
   tag. fpdf2 reuses an already-embedded image, so the 473 repeats add
   negligible bytes.
2. **`/pcs/` books use the same status rules as the admin book** — no per-user
   status semantics to design.
3. **One PDF, bookmarked by member** (not one file per member).
4. Backs are excluded. 99% of cards with backs are already owned, and they cost
   ~45 MB for ~695 cards.
5. **Have it = an `owned` or `pending_incoming` copy.** A card whose only copy is
   `trade` reads as not held. This is intentional; the user keeps statuses
   accurate before generating.

## Output shape

- **One PDF**, estimated **70–80 MB** for the full catalog at ~5–8 KB per
  thumbnail.
- **Bookmarks:** member → source origin. Origins in ship-date order
  (`lkup_photocard_source_origins.start_date` + `date_precision`, NULLs last).
- **Cards with no member xref** go in a final `No member` section.
- **Page header:** member · origin · **the generation date** (it is a snapshot,
  and must say so on every page).
- **Tiles:** thumbnail, version caption, `is_special` marker, and a status mark.
- **Status marks + legend:** Owned (`owned`/`pending_incoming`), Wanted, Trade,
  Not Wanted. Undecided gets no mark.
- **Options:** which members; and which cards — all / hide Not Wanted / Wanted
  only / Owned only.

## Design

### 1. Thumbnail cache (on the Railway volume) — BUILT 2026-09-27

`backend/pdf_thumbs.py` (module + CLI) and `POST /admin/build-pdf-thumbs`,
driven by **Admin → Offline Card Book Thumbnails → Build Thumbnails**.

`DATA_ROOT/pdf_thumbs/{item_id}_{sha1(file_path)[:10]}.jpg`. **Keyed on a hash
of the image URL, not `catalog_version`** as this plan first said: prod holds
both the old unversioned R2 key (`skz_000003_f.jpg`) and the newer versioned one
(`..._f_v2.jpg`) that `_replace_image` introduced, so the URL is the only value
guaranteed to change when the picture does.

Measured on dev while building this: **source images are already small** — a
25-image sample averaged 200 px wide, many at 100–150 px. So the resize caps
width at 180 px and **never upscales** (upscaling cost ~17% more bytes for no
detail), and an already-small JPEG is **stored byte-for-byte** rather than
re-encoded. Expect **~7–10 KB per card, so roughly 85–115 MB** for the full
library; the exact figure lands after the prod run.

- **Reads come from R2 via boto3**, not `images.collectcoreapp.com` — the public
  domain 403s non-browser user agents (measured). Prod already has creds.
- **Dev** sets `COLLECTCORE_DISABLE_R2=1`, so dev falls back to fetching the
  public URL with a browser UA. Read-only either way: this feature never writes
  to R2.
- Attachments with `storage_type='local'` (admin drafts) come from the local
  library path instead.
- **Chunked, not one long sweep.** The endpoint caps work per call (default 300)
  and returns `remaining`; `AdminPage` loops until it hits 0. A single ~11.8k
  sweep would never survive Cloudflare's ~100s cap. `limit` applies to the
  *outstanding* rows, not to the SQL query — the first version limited the query
  and so re-processed the same cached rows forever without progressing.
- **Stop condition:** the loop also stops when a pass builds 0, which means
  every remaining row has an unreadable image and retrying would loop forever.
- **Writes are temp-file + rename**, so an interrupted run can't leave a
  truncated JPEG that a later run counts as done.
- **CLI equivalent** for local runs: `python pdf_thumbs.py [--limit N] [--force]
  [--prune]`. It loads `backend/.env` itself, mirroring main.py — without that,
  `COLLECTCORE_DISABLE_R2` is unset and the dev kill-switch silently stops
  guarding the production bucket.
- **Incremental:** *Publish Photocard Images* should write the thumbnail for each
  card it publishes (Phase 3), so the cache stays warm.

### 2. Generator — BUILT 2026-09-29

`backend/pdf_card_book.py` + `POST /export/photocard-book.pdf`, driven by
**Admin → Offline Card Book (PDF)**.

**Two page presets, added after seeing a real page.** An A4 page on a phone
shrinks each tile to about a sixth of the screen, so reading the book means
pinch-zooming every row. `phone` (95×185mm, 3 columns) makes fit-to-width show
tiles big enough to identify a card; `a4` (6 columns) stays for printing and
desktop. **Phone is the UI default.** Measured on dev (10,024 cards, 2,800
thumbnails cached): a4 = 530 pages, phone = 1,337 pages, both ~2.5s.

Generation is fast enough that the `prepare` → token → `download` fallback is
not needed: the full book renders in seconds because embedding is a byte-copy.

`backend/pdf_card_book.py`, pure function of (cards, status-per-card, options)
→ PDF bytes. New dependency: **fpdf2** (pure Python, small, supports outlines).
Embed a small Unicode TTF so a future non-ASCII rename can't crash generation.

- Resolve statuses **by `status_code`, never by hardcoded id** — ids drift
  between dev and prod.
- **LEFT JOIN `source_origin_id`** — it is nullable.
- Thumbnails are embedded as-is (no re-encode), which is what keeps generation
  to seconds.

### 3. Endpoints

- Admin: `POST /export/photocard-book.pdf` (alongside the existing trade CSV in
  `backend/routers/export.py`), body = options.
- `/pcs/`: `POST /pcs/export/photocard-book.pdf`, statuses from
  `pcs_card_copies` for `Depends(require_user)`. **Never accept a user id as a
  parameter.** Catalog cards only.
- If generation ever approaches ~60 s, switch to the existing
  `prepare` → token → `download` pattern (`backend/routers/admin.py:50,129`).
  **Cloudflare kills a proxied request at ~100 s with a 524.**

### 4. UI

One shared options modal, reached from the admin menu and from
`frontend/src/pcs/PcsMenuItems.jsx`. Help text: save it to Files on the phone,
and generate on wifi.

## Phases

1. ~~**Thumbnail cache + backfill script.**~~ **Done 2026-09-27** — module, CLI,
   chunked admin endpoint and the admin button. Still to do on prod: deploy,
   click Build Thumbnails, and record the real count and cache size.
2. ~~**Generator + admin endpoint + modal.**~~ **Done 2026-09-29.** Options are
   card filter + page size; member selection is supported by the endpoint
   (`member_ids`) but not exposed, since the decision was one book for everyone.
3. ~~**Hook into Publish Photocard Images.**~~ **Done 2026-09-29** —
   `catalog_publisher.publish_pending` writes the thumbnail from the bytes it
   already resized, so publishing never leaves the cache cold. Fronts only;
   failures are logged, never fatal (Build Thumbnails picks them up).
4. ~~**`/pcs/` endpoint + menu entry.**~~ **Done 2026-09-29** —
   `POST /pcs/export/photocard-book.pdf` + "Download card book (PDF)" in the
   /pcs/ menu. Same generator; only the status source differs, scoped to the
   caller's `user_id` from Cloudflare Access and to catalog cards.

## Gotchas

- **Rebuild both bundles.** Shared frontend changes need `npm run build` **and**
  `npm run build:pcs`; `/pcs/` serves `backend/frontend_dist_pcs/`.
- **No schema change.** The thumbnail cache is files on the volume, nothing in
  SQLite — and in particular nothing new on `tbl_photocard_details`, which
  `catalog.py` and `seed_builder.py` reflect into the guest paths.
- **Memory:** fpdf2 holds the document in memory; the full book is ~70–80 MB
  plus overhead. Watch the Railway instance on the first full run.
- **Concurrency:** PDF building is CPU-bound in-process. If `/pcs/` ever has
  several users, serialize generation behind a lock.
- **Source data:** generate from prod. The dev DB lags (10,024 vs 11,835 cards)
  and lookup ids/names drift between the two.
- **Dev 404s are expected.** Dev rows point at R2 URLs prod has since replaced,
  so a dev backfill reports a few unreadable images (~1–2%). On prod that count
  should be ~0; anything higher means real missing images worth investigating.

## Test checklist

1. Backfill on prod: thumbnail count matches card count; total size as expected.
2. Generate the full book; confirm it returns in well under 100 s.
3. Open on the iPhone, save to Files, **turn on airplane mode**, and confirm it
   opens and bookmarks navigate.
4. Spot-check status marks against the app for: an owned card, a wanted card, a
   `pending_incoming` card, a `{not_wanted, trade}` card, and a unit card
   appearing under several members.
5. Confirm a card with a NULL origin and a card with no member both render.
6. **Carry it for a real day before departure** and adjust thumbnail size or
   grid density based on how it reads on the phone.

## Fixed after first real /pcs/ use (2026-09-30)

A friend account with two cards downloaded a 90MB, 1,601-page book of the whole
catalog, and the confirmation said "0 cards, 0 pages".

- **Scope.** `/pcs/` defaulted to `all`. It now defaults to a new **`mine`**
  filter (cards the user has actually marked), matching what their library page
  already shows; the full catalog is a separate, confirm-gated menu entry. Two
  cards now produce a 4-page book instead of 11,828.
- **The zeros were CORS.** Every SPA is served from `collectcoreapp.com` but
  calls `api.collectcoreapp.com`, so custom response headers are invisible to JS
  unless named in `Access-Control-Expose-Headers`. Added in `main.py`. This had
  also been silently breaking the **trade CSV's** row count and the download
  filename.
- **`lomo_fanmade` had no mark**, so a card the user holds read as "you don't
  have this". It now has its own LOMO mark rather than counting as HAVE: a
  fan-printed copy is not the official card, and folding it into HAVE could talk
  you out of one you still want. Flip it into `HELD_CODES` if that judgement is
  wrong.

## Open

- Thumbnail size/grid density are guesses until step 6 of the checklist.
- Whether `/pcs/` books should be rate-limited or cached per user, once there
  are real users.
- Whether `lomo_fanmade` should count as held (currently its own mark).
