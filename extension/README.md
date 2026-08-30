# CollectCore Market Capture — Chrome Extension

Captures photocard listing data from Mercari search results while browsing.
Design doc: [`docs/photocard_market_intel_plan.md`](../docs/photocard_market_intel_plan.md).

## There is no build step

**This extension is plain JavaScript. It is never bundled, compiled, or built.**

- `cd frontend && npm run build` does **not** touch it and never needs to.
- Nothing here goes into `backend/frontend_dist/`.
- Nothing here deploys to Railway. It runs only in your local Chrome.

After any code change: **reload the extension, then refresh the Mercari tab.**
That is the whole workflow.

## Install (once)

1. Open `chrome://extensions`
2. Turn on **Developer mode** (toggle, top right)
3. Click **Load unpacked**
4. Select the `extension/` folder in this repo — the one containing
   `manifest.json`
5. Pin it: click the puzzle-piece icon in the toolbar, then the pin next to
   *CollectCore Market Capture*

## After I change the code

1. Go to `chrome://extensions`
2. Click the **↻ reload** icon on the CollectCore card
3. **Refresh every open Mercari tab**

**Step 3 is required after *any* reload**, not just when content-script files
changed. Reloading the extension orphans the content script already running in
an open page: the capture dots it drew stay on screen, but its connection to the
extension is severed, so clicking one does nothing at all.

The page now says so rather than failing silently — a red bar appears across the
top reading *"CollectCore was reloaded — refresh this page to resume
capturing"*, and clicking it reloads the page.

## Using it

The extension is **dormant until you switch it on.** Browsing Mercari for
anything else looks completely normal — no overlays, no panel.

| Action | How |
|---|---|
| **Turn on** | Click the toolbar icon. The side panel opens; capture is on for the **whole session**. |
| **Capture** | Click the **+** on any result tile. It turns green. |
| **Capture a listing you opened** | Click **+ Capture**, bottom-right of the listing's own page. |
| **Un-capture** | Click the **✓** again, on either surface. |
| **Identify** | *Identify →* on a captured row, then click the matching card. |
| **Arm a card** | The Mode button. Every capture then auto-associates to it. |
| **Turn off** | Press **Esc**, or close the side panel with its **✕**. Ends the session everywhere, not just that tab. |
| **Sync** | *Sync* pushes captures to CollectCore. Safe to press repeatedly. |
| **Clear** | Removes **synced** captures only. Unsynced ones are kept unless you confirm a second prompt. |
| **Remove one** | The **✕** on a row. Warns first if that row has never synced. |
| **Export** | *Export JSON* — downloads your **captures** as a backup. |
| **Import** | Loads a **card index** file. *Not* the inverse of Export — see below. |

### Capture is a session, not a tab

Switching on once covers **every Mercari tab you open afterwards**, which is
what the tab-at-a-time workflow needs — open several listings, capture the good
ones, close them. Activation used to be per tab, so each newly opened listing
came up dormant with no button and nothing explaining why.

Dormant-by-default is unchanged: nothing happens on any tab until you click the
toolbar icon once. **Esc** or closing the panel ends the session on every tab at
once, so nothing is left quietly capturing.

### Keeping the queue clean

The panel is a **work queue**, not storage. The lifecycle is:

1. **Capture** — from a tile or a listing page
2. **Identify** — associate it to a card
3. **Sync** — CollectCore now has it permanently, keyed on
   `marketplace:externalId`
4. **Clear** — removes the synced ones from the queue

Every row shows **synced** or **not synced**, and *Clear* only touches the
synced ones. That distinction is the whole safety property: an unsynced capture
is **the only copy that exists**, so nothing removes it without a specific
confirmation.

Re-capturing a listing you have already synced resets it to *not synced*, which
is correct — a new sighting means the price moved or it sold, and that needs
pushing again.

> **Export and Import are not a pair**, despite sitting next to each other.
> *Export* downloads your captures. *Import* loads a **card index** file, the
> offline fallback for when the index cannot be fetched from prod. There is no
> capture-import; the server copy is the restore path.

## The card index

The picker matches against a local copy of your library, pulled straight from
production.

**It refreshes itself.** The panel fetches a fresh copy on open whenever the
stored one is more than 12 hours old, and *Refresh cards* forces it. There is
nothing to remember and nothing to keep in sync by hand — a stale index would
silently fail to match cards catalogued since the last refresh and push them
down the create-the-card path, which is how duplicates get made.

It reads `GET /admin/card-index` on `api.collectcoreapp.com`. The panel is an
extension page, so `host_permissions` lets it read cross-origin and the
Cloudflare Access cookie rides along from the browser.

If the status line says **sign-in expired**, open `collectcoreapp.com` in a tab
to renew the Access session, then hit *Refresh cards*. Capture keeps working
throughout — only the picker needs the index.

### Offline fallback

*Import index* loads a file produced by:

```
python tools/export_card_index.py --db <path to a database>
```

For working against a backup, or when the server is unreachable. Source it from
prod: dev lags, so a dev-built index makes cards you own fail to match.

### Two capture modes

**Collecting** (default) — a broad search where each result might be a different
card. Click the interesting ones, then work the *Identify* queue afterward. The
listing title pre-filters the picker: matched tokens show as chips you can click
off, and the candidate list is never empty — chips get dropped rather than
returning nothing.

**Armed** — a targeted sweep for one card. Arm it, then every tile click
captures *and* associates in one action. An armed click means the listing
**contains** the card, not that it *is* the card, so a bundle keeps the
association and you add its other cards from the panel.

Titles matching bundle signals (`bundle`, `lot`, `set`, `PC's`, `まとめ売り`, and
similar) are flagged **possible lot?** rather than interrupting the sweep to
ask. Confirm them with the *This is a lot / bundle* checkbox — it matters
because **a card's price series only counts listings where that card is the
sole line**, so a 12-card bundle at $27 must never register as that card
selling for $27.

Cards with no image are shown with a hatched placeholder and are still
pickable — that state is usually a short window between cataloguing a card and
its scan landing, and hiding them would make the newest era unpickable exactly
when you are sweeping it.

**The panel is literally the switch.** It holds an open port to the service
worker, so capture is on exactly while the panel is open — closing it by any
means turns capture off. Chrome opens the panel natively on the toolbar click
(`openPanelOnActionClick`); the extension never calls `sidePanel.open()`, which
can only run inside a live user gesture and fails silently when it doesn't.

Activation is **per tab**, so a second Mercari tab stays clean for ordinary
browsing.

The toolbar badge reads **ON** while the current tab is capturing.

## Two places to capture from

**Search results** — a **+** on each tile. Fast for noting many listings without
opening anything.

**A listing's own page** — a **+ Capture** button, bottom right. Use it when you
have opened the listing anyway to look at the photos or read the description.
Open tabs while browsing, capture the ones worth tracking, close them.

You never need both. Capturing a tile and later capturing that same listing's
page produces **one record**, not two — everything keys on
`marketplace:externalId` — and the second capture fills in what the first could
not see.

## What it captures

Read off React's fiber (tiles verified 2026-08-28, detail pages 2026-08-29):

`id` · `name` · `price` (integer USD cents) · `status` · `itemCondition` ·
`category` / `categoryId` · `brand` · `thumbnail`

**Only from a listing's own page:** `shippingPayerCode` (who pays shipping),
the full `description`, the seller id, and the complete photo set. All of these
are null or empty in search tiles, which is the entire reason that second
surface exists — you cannot work out a real margin without knowing who paid for
shipping.

A row's `capture_tier` says which surface it came from. On a `sweep` row a null
shipping payer means **"not looked at yet"**, never "no shipping".

**The two surfaces do not use the same field names**, which is why the first
detail captures came out unnamed and image-less. Normalised in
`content/fiber.js`; recorded here so the next surface starts from fact:

| tile | listing page |
|---|---|
| `id` | `itemId` |
| `thumbnail` | `photoUrl` |
| — | `shippingPayer` (not `shippingPayerCode`) |
| `itemCondition` is a string | `itemCondition` is an **object** |

Dates arrive as `created` (posted), `lastSoldAt` (sold), and `updated`.

Plus, added at capture: the search query, page URL, timestamp, a
`suspectedLot` flag from title keywords, and the thumbnail re-requested at
640px and stored as a blob.

**`status` is the source of truth for active vs. sold** — never which filter was
running. Mercari's default search mixes `trading` (sold) rows in with `on_sale`,
so inferring state from context silently corrupts the data.

### Why the fiber read lives in its own file

Content scripts run in an **isolated world** and get a clean DOM wrapper, so
React's `__reactFiber$…` expando properties — set by page scripts — are
invisible to them. The walk therefore runs in `content/fiber.js`, declared
`"world": "MAIN"`, which stamps the item object onto each tile as a
`data-cc-item` attribute. Attributes cross the world boundary; JS properties do
not. **Do not move that walk into `capture.js`** — it will silently fall back to
DOM scraping, which is exactly what happened on 2026-08-28.

### If a detail capture reads "(partial read)"

The button says **+ Capture (partial read)** when the page's own DOM had to
supply the title or image because the fiber scan did not. The capture still
works and is tagged `DOM fallback` in the panel — it is flagged rather than
hidden, because a silently degraded capture is worse than a loud one.

To help fix it: open DevTools on that listing (F12 → Console) and look for a
line starting `[CollectCore] detail fiber scan:`. It prints how many candidate
objects carried the listing id and what keys each had. That says where Mercari
actually keeps the item, which is the one thing guessing has not settled.

### If Mercari changes and captures stop working

The fiber walk uses React internals, which are not a public API. When it fails,
capture falls back to scraping the tile — you still get id, name, price, and
sold state, but lose condition, category, and brand, and `name` picks up a
` - Brand` suffix from the image alt text.

**That fallback is now visible:** any row using it shows a **DOM fallback** tag
in the panel, and `viaFallback: true` in the export. If you see those, re-check
the fiber walk against a live page. A red dot means neither path could read the
tile at all.

## Files

| Path | Role |
|---|---|
| `manifest.json` | MV3 manifest, permissions, content-script matches |
| `background.js` | Service worker — activation state, capture writes, image fetch |
| `lib/db.js` | IndexedDB wrapper for captures (service worker is the single writer) |
| `lib/api.js` | Talking to CollectCore — CF Access cookie, sign-in detection |
| `lib/cardIndex.js` | Local card library — storage, server refresh, search |
| `lib/matcher.js` | Title → candidate cards. Pure; `node tools/test_matcher.mjs` exercises it |
| `content/fiber.js` | **Page world** (`"world": "MAIN"`) — reads React's fiber, stamps `data-cc-item` on tiles |
| `content/capture.js` | Isolated world — tile overlay, reads the stamp. Standalone: content scripts cannot import modules |
| `content/overlay.css` | Capture dot styling |
| `panel/` | Side panel — capture list, associate view, armed mode |

## Syncing to CollectCore

*Sync* posts every capture to `POST /market/captures`. **Idempotent** — listings
key on `(marketplace, external_id)` and sightings on `(listing, observed_at)`, so
pressing it twice updates rather than duplicates, and there is no need to track
what has already gone up.

Nothing is deleted locally on success. Until syncing is automatic, the local
copy stays the safety net.

Comps are then available at `GET /market/comps` (every card with data) and
`GET /market/comps/{item_id}` (one card's full series). **Lots are excluded from
single-card prices** and returned separately as `excluded_lots` — a three-card
bundle at $60 is real market signal, it just is not that card selling for $60.

## Sources and currency

`marketplace` is recorded on every listing, and the DB knows four sources —
`mercari_us` (USD), `neokyo` (JPY), `pocamarket` (KRW), `ebay` (USD). Only
Mercari US has a capture parser so far; the rest are declared so the schema,
comps, and currency handling are ready.

**Adding a site** means: an entry in `SITES` at the top of
`content/capture.js`, its host in `matches` in *both* content-script blocks in
`manifest.json`, and its tile selector in `content/fiber.js`. Nothing else in
the extension knows any marketplace's URL shape.

### Currency

**The native amount is the record; USD is derived and labelled.** Prices are
stored in the source's own currency and converted for comparison, never
replaced — so a JPY comp can be re-derived at a different rate later, which
matters because "what would this have cost me then" and "what should I pay
now" are different questions that disagree whenever a currency moves.

- Rates are set per currency with an effective date via `PUT /market/fx`, kept
  as history rather than one mutable current value.
- `POST /market/fx/backfill` fills USD on sightings captured before a rate
  existed. A capture is never blocked on a missing rate.
- When a site does its own conversion (Neokyo shows USD beside the yen), that
  figure wins — it is what actually gets charged.
- `GET /market/fx` lists rates and names any currency with **no rate on file**,
  so a gap is visible rather than silently dropping those sightings out of
  comps.

Amounts are stored in **minor units of their currency** — USD $40.00 is 4000,
but ¥2500 is 2500, because JPY has no subdivision. Dividing by 100 to display
is a USD-only assumption.

## Not built yet

Capture parsers for Neokyo, Pocamarket, and eBay. Lot line entry beyond a
card list (quantities, non-card items, unidentified placeholders). Automatic
sync. Image blobs still stay local — sync sends the thumbnail URL only.

The planned **enrich** tier — queueing ids and fetching detail pages in the
background — was dropped rather than deferred. Its queue, throttle and session
handling existed only to make automated fetching defensible, and none of it is
needed when you open the tab yourself.
