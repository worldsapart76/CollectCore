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
| **Turn on** | Click the toolbar icon. The side panel opens; capture dots appear on results. |
| **Capture** | Click the **+** on any result tile. It turns green. |
| **Un-capture** | Click the **✓** again. |
| **Identify** | *Identify →* on a captured row, then click the matching card. |
| **Arm a card** | The Mode button. Every capture then auto-associates to it. |
| **Turn off** | Press **Esc**, or close the side panel with its **✕**. |
| **Export** | *Export JSON* in the panel. |

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

## What it captures

Read off React's fiber on each result tile (verified 2026-08-28):

`id` · `name` · `price` (integer USD cents) · `status` · `itemCondition` ·
`category` / `categoryId` · `brand` · `thumbnail`

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
| `lib/cardIndex.js` | Local card library — storage, server refresh, search |
| `lib/matcher.js` | Title → candidate cards. Pure; `node tools/test_matcher.mjs` exercises it |
| `content/fiber.js` | **Page world** (`"world": "MAIN"`) — reads React's fiber, stamps `data-cc-item` on tiles |
| `content/capture.js` | Isolated world — tile overlay, reads the stamp. Standalone: content scripts cannot import modules |
| `content/overlay.css` | Capture dot styling |
| `panel/` | Side panel — capture list, associate view, armed mode |

## Not built yet

Lot line entry beyond a card list (quantities, non-card items, unidentified
placeholders), Neokyo capture, and pushing captures to the server — everything
still leaves via *Export JSON*.
