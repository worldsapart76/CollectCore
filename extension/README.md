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
3. **Refresh the Mercari tab** (content scripts only reload with the page)

Skipping step 3 is the usual reason a change "didn't work."

## Using it

The extension is **dormant until you switch it on.** Browsing Mercari for
anything else looks completely normal — no overlays, no panel.

| Action | How |
|---|---|
| **Turn on** | Click the toolbar icon. The side panel opens; capture dots appear on results. |
| **Capture** | Click the **+** on any result tile. It turns green. |
| **Un-capture** | Click the **✓** again. |
| **Turn off** | Press **Esc**, or close the side panel with its **✕**. |
| **Export** | *Export JSON* in the panel. |

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
| `lib/db.js` | IndexedDB wrapper (service worker is the single writer) |
| `content/fiber.js` | **Page world** (`"world": "MAIN"`) — reads React's fiber, stamps `data-cc-item` on tiles |
| `content/capture.js` | Isolated world — tile overlay, reads the stamp. Standalone: content scripts cannot import modules |
| `content/overlay.css` | Capture dot styling |
| `panel/` | Side panel — session list and export |

## Not built yet

Card association, the lexicon pre-filter, the armed mode, lot line entry, and
sync to `api.collectcoreapp.com`. This slice proves the capture loop:
browse → click → stored → exported.
