# CollectCore Market Capture — Chrome Extension

Captures photocard listing data from **Mercari US** (sell side and buy side),
**Neokyo** (buy side, proxying Mercari JP and Rakuma), **eBay** (both sides) and
**Pocamarket** (buy side) while browsing.
Design doc: [`docs/photocard_market_intel_plan.md`](../docs/photocard_market_intel_plan.md).

## There is no build step

**This extension is plain JavaScript. It is never bundled, compiled, or built.**

- `cd frontend && npm run build` does **not** touch it and never needs to.
- Nothing here goes into `backend/frontend_dist/`.
- Nothing here deploys to Railway. It runs only in your local Chrome.

After any code change: **reload the extension, then refresh the marketplace
tab.** That is the whole workflow.

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
3. **Refresh every open Mercari, Neokyo, eBay and Pocamarket tab**

**Step 3 is required after *any* reload**, not just when content-script files
changed. Reloading the extension orphans the content script already running in
an open page: the capture dots it drew stay on screen, but its connection to the
extension is severed, so clicking one does nothing at all.

The page now says so rather than failing silently — a red bar appears across the
top reading *"CollectCore was reloaded — refresh this page to resume
capturing"*, and clicking it reloads the page.

## Using it

The extension is **dormant until you switch it on.** Browsing either site for
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

Switching on once covers **every supported tab you open afterwards**, which is
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

> **Searching by hand:** every word you type must match somewhere, so adding
> words narrows. The count is the **true** total — *"1,579 match "hyunjin" —
> showing the closest 60"* means keep typing; *"66 match"* means you can stop.
> Results are ordered by how tightly each one matched, so an exact hit is
> first rather than merely somewhere in the set.

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

The toolbar badge reads **ON** while the current tab is capturing.

### Breaking out a lot while you capture it

Beside the *This is a lot* checkbox: **+ non-card** and **+ unidentified**.

- **+ non-card** takes a label and a value — the album, the photobook, the
  keychain. The value is asked for **here**, at capture, because it is a
  judgement made looking at the listing: the photos, the condition, the set it
  belongs to. The lot analyzer's value ladder can price a card from its own
  comps; nothing can tell it what an album is worth.
- **+ unidentified** takes a count. No value is asked for — the analyzer prices
  an unidentified card at its era's median, which beats a guess made from a
  thumbnail. What matters is that the cost gets split across *everything* in
  the box rather than only the cards that were named.

**A lot can hold two of the same card**, so picking a card that is already on
the listing counts its line **up** rather than doing nothing. The chip shows
`×2` with a `−` beside it to count back down; `×` removes the line outright.
Counted on the line rather than added as a second one, because the line already
carries a `qty` and everything downstream sums it — units in a lot, the divisor
for per-card cost, the value of the line.

Either one marks the listing a lot. Lines are removed by position, not by card
id: two non-card lines are two different things.

**Lines can be created in two places, and they have two lifetimes.** Ingest
replaces a listing's lines wholesale, because the extension holds the current
answer for what is in it and a card removed here must actually disappear. That
replace is scoped to lines the *extension* created — a non-card line added in
the app's lot analyzer survives an ordinary re-sync, which it would otherwise be
erased by, silently, through a workflow that looks like re-identification.

### Refreshing a capture

On a listing page you have already captured, a **↻** button appears above the
capture bar. It re-reads the page and updates the record — a dropped price, a
field an older parser was missing — **keeping the cards you linked to it**.

That is not the same as clicking the bar twice. Clicking a captured bar removes
the capture, so off-then-on does reach the same place but destroys the record in
between and takes its card associations with it. Re-identifying a card to pick
up a shipping figure is not a workflow, which is why the two are separate
buttons rather than one button with two meanings.

The store merges by key: capturing a listing it already holds appends a
sighting, refreshes the fields, keeps the lines, and clears `syncedAt` so the
next **Sync** pushes it.

**A refresh cannot unidentify a listing.** The card associations live only in
the extension, so a listing re-captured after its local record was cleared comes
back with **no lines** — and the server leaves its own alone in that case.
Replacing wholesale there would destroy the identification through an omission
rather than a decision. A capture that *does* bring lines is still
authoritative: removing a card in the extension removes it on the server.

The sync response says which happened per listing, and the panel tags a record
`N on server` when its cards are recorded there but not here. Those rows are
also left out of the *needs identifying* count — nagging about a listing whose
cards are already on file invites re-doing work that was never lost. **`0 new
listings` in the sync result is the evidence a refresh merged into the listing
it was meant to** rather than creating a second row beside it. On the server the same thing happens one level up —
listings are keyed on `(marketplace, external_id)` — so a refreshed capture
updates the existing listing and adds a sighting rather than creating a second
row. **The older observation is kept**; it really was seen at that price, and
the buy side reads only the newest.

## What differs on Neokyo

It is a **proxy**, and that shapes the data rather than just the parsing.

- **Buy side only, and active only.** A proxy lists what can still be bought, so
  no sold comps come from there. That is not a gap in the parser; it is what the
  buy side *is*. Sold comps come from Mercari US.
- **The unit is spelled out.** A product page reads `3399 Yen`, not `¥3399` and
  not `3399円`, with `Approximately : US$ 21.07` beneath it. Looking only for
  the symbols found no price at all.
- **Its listing name is an `h6`,** and the page's own source names it for you:

  ```html
  <h6 class="font-gothamRounded mb-0 translate">straykids ヒョンジン kms 樂star 店舗特典</h6>
  ```

  `translate` is Neokyo's marker for text it machine-translates — seller
  content, not site furniture — which is exactly the distinction being reached
  for, stated by the site itself. A heading carrying it wins outright and the
  heuristics below are skipped rather than allowed to veto it.

  **Chrome's page translation rewrites each translated text node as a `<font>`
  wrapper**, so a translated element *has* element children. Rejecting
  candidates on "has children" therefore threw away the listing title — marker
  and all — while leaving untouched site furniture in place, which is exactly
  backwards. A candidate is skipped only when another element the ranking could
  pick sits inside it carrying the same text; a `<font>` is not one of those.

  Everything else on the page misleads: the `h1` is empty, and `og:title` and
  the document title both say *Item Details*, which is what every early capture
  got filed under.

  The ranking underneath is the fallback for when the marker is not there. The
  net is cast very wide and narrowed by:

  1. Drop anything inside site chrome — `header`, `nav`, `footer`, modals,
     banners, breadcrumbs — matched by class and id as well as by tag, because
     Neokyo uses none of the semantic elements and a tag-only test excluded
     nothing at all.
  2. Drop anything short enough to be only a price. The price is the largest
     text on the page and would otherwise win outright.
  3. **Rank by rendered font size, then by length.** A page renders its subject
     larger than the furniture around it, and among same-size headings a
     section heading is a couple of words while a listing name is a sentence of
     specifics.

  Every one of those rules holds whatever the markup is called and whatever
  language the text is in, which matters — see below. The walk is memoised per
  path; it measures every leaf element, and the mutation observer would
  otherwise re-run it on every frame.
- **The page may be machine-translated in your browser**, which rewrites every
  text node. Any rule that keys on English strings stops working the moment the
  translation is off or differs, so the title logic must not depend on one. The
  blocklist of section-heading names is a secondary filter only.

  One upside: a translated title is *English*, so the card picker can actually
  tokenize it. An untranslated Japanese title cannot be matched yet.
- **What was captured is the translated title, not the seller's.** Fine for
  matching cards, worth knowing if you ever compare a stored title against the
  live listing.
- **The currency is whatever the page is showing you.** Neokyo has a currency
  selector, and with it set to USD a product page carries no yen at all. The
  symbol on the page decides: yen found → the record is JPY (and Neokyo's own
  USD conversion rides along beside it); only dollars found → the record is USD
  and those dollars *are* the price. Taking the marketplace's nominal currency
  on faith produced captures reading `— ($4.33)` with no price at all.
- **Yen has no subunit.** ¥1,200 is stored as `1200`, not `120000`. Every
  display goes through the currency's own exponent.
- **No React fiber.** The page is server-rendered, so `content/fiber.js` is
  deliberately not injected there and the DOM read is the whole parser.
- **The listing id is the tail of the URL** and the URL is recorded as found.
  Neokyo's path layout is not hardcoded anywhere, so a locale or provider
  segment moving does not break capture.
- **Titles are Japanese**, so the picker cannot pre-filter them yet — see
  *Not built yet*.
- **The capture button sits higher up the right edge**, not in the corner —
  Neokyo's help-chat launcher owns that corner and the two overlapped. Its
  position is per site, in `content/overlay.css`, because which corner is free
  is a fact about the site.

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

On Mercari, read off React's fiber (tiles verified 2026-08-28, detail pages
2026-08-29). On Neokyo there is no fiber — the page is server-rendered and the
DOM read below is the only path, not a fallback:

`id` · `name` · `price` (integer **minor units of the site's currency** — see
Currency below) · `status` · `itemCondition` · `category` / `categoryId` ·
`brand` · `thumbnail`

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

### When a capture comes back thin

A DOM-read row whose title came from anywhere other than the site's own marker
carries a **page read:** line in the panel: which source the title came from,
the text the price was read from, `h1` / `og:title` / document title, and the
shortlist it chose between — each entry tagged with the element it came off, its
rendered font size, and a `*` if the site marked it as seller content.

The condition is deliberately *weak read*, not *missing*. Gating it on "the
title or price is missing" hid the failure that actually happened three times
over: a title that is present, plausible, and identical on every listing —
*Item Details*, then *About Neokyo*, then a category-menu entry. Nothing about
those rows looked wrong, so nothing asked to be looked at. A row that got the
good source stays quiet.

**Re-capturing a bad row repairs it.** A detail read is the best name available,
so on that path it replaces whatever is there rather than only filling a blank —
otherwise a row captured as "Item Details" would keep that title forever.


A capture is flagged **DOM fallback** only when it is genuinely worse — no
title, or no price. Where a field was *read from* is not itself a problem: on
Neokyo, reading the page is the only way, because the site is server-rendered
and there is no React fiber to read.

There used to be a **(partial read)** badge on the detail button that lit up
whenever any single field came off the page rather than out of Mercari's
internal object — including the photo, which is the same photo either way. It
warned about nothing and was removed.

### Only rewrite a dimension the URL already declares

`bigThumb` asks a CDN for a bigger rendition of an image it already has. It was
scoped to the *host* and not to the *URL shape*, and that shipped a silent 403:

```
Mercari US thumbnail   …_1.jpg?1787769379&width=200&height=200   → width=640 ✔
Neokyo / Mercari JP    …_1.jpg?1787925462                        → 403 ✘
```

Same host. The second is `/item/detail/orig/` — it carries no dimensions
*because it already is the full-size image* — so `URLSearchParams.set` turned
the bare cache-buster into `?1787925462=&width=640`, which the CDN refuses.
**Every Mercari-JP capture stored a thumbnail URL that could not load**, while
Rakuma's `img.fril.jp` images were left alone and worked fine. That was the
whole of the Rakuma-works/Mercari-doesn't split.

Adding a parameter a URL never had is inventing an API contract; rewriting one
it already declares is reading the contract it published. The edit is also done
as a **string**, never re-serialised, because Mercari's query begins with a bare
cache-buster token that `URLSearchParams` would rewrite to `1787769379=` — a
different URL, on a CDN already shown to be strict about exactly this.

`tools/test_thumb_urls.mjs` covers it. It had none, which is how a 403 shipped
looking entirely ordinary.

**A re-capture now replaces a thumbnail rather than only filling an empty one.**
A wrong image used to be permanent — fixable only by deleting the row — which
made the refresh button useless for the case it most obviously applies to. A
search sweep still cannot downgrade a listing page's photo.

### The primary photo, not the biggest one

`detailPhoto` takes the **earliest** image in DOM order within half the area of
the biggest — not simply the largest. A listing renders its main photo first and
a strip of alternates after it, frequently at the same resolution, so "largest"
was decided by whichever decoded to a pixel more and regularly landed on the
**back of the card**. Size still filters, so a 40px site logo cannot win on
position; DOM order decides among the real photos.

**A CDN that numbers its photos has already answered the question.**

```
.../photos/m47235147985_1.jpg?1787925462   <- the listing's first photo
.../photos/m47235147985_2.jpg?1787925462
```

Mercari's own convention, stated in the URL, and it survives everything the
markup does to confuse the issue: carousel clones, lazy loading, a hidden
gallery, DOM order. Every other strategy is an inference about how the page
*looks*; this is a fact the site published, which is the same reason Neokyo's
title comes from an element the site marks itself and Pocamarket's comes from
`<title>`. Declared per site as `photoPrimary` — Neokyo carries the same pattern
because those *are* Mercari's images, served straight off `static.mercdn.net`.

`_1.` requires the dot, so a ten-photo listing's `_10.jpg` cannot be mistaken
for the first.

**DOM order cannot settle it on its own.** A looping carousel clones its
slides, so the first `<img>` in the document is routinely a copy of the *last*
photo — which is why a two-image Neokyo gallery captured photo 2. Two answers to
that, one automatic and one not:

- **`ogAmong`** — `og:image`, but only when it is one of the images the page is
  actually showing, matched by *filename* since the same image carries different
  cache-busters in the two places. The match requirement is what makes it safe
  to try first: a site whose `og:image` is a logo or a share card matches
  nothing and is skipped, rather than putting the same generic picture on every
  capture.
- **Click the thumbnail in the panel** to step through the other images the page
  offered. Automatic selection cannot be made reliable across four marketplaces
  and whatever gallery plugin each one ships, and one click beats another round
  of guessing at plugin internals — it also works on the next marketplace, which
  no amount of guessing does. A thumbnail with alternates behind it is drawn
  stacked; its tooltip says *image 2 of 4*. Only rows captured since this
  shipped carry the alternates — re-capture (**↻**) to collect them.

Per-site `photoOrder` picks the strategy: `numbered` (the CDN's own index),
`ogAmong`, `og` (the page's own declaration),
`portrait` (largest image taller than wide — a photocard is 55×85mm), and
`largest`. Neokyo runs `['numbered', 'ogAmong', 'largest', 'portrait']` because it fronts several
Japanese marketplaces and each brings its own image host, so its `photoHost`
list is the hosts *seen* rather than a rule; `portrait` falls back to every
image on the page when none of them match.

**A photo URL is not always in `src`.** A lazy-loaded image holds the real one
in `data-src` / `srcset` until it scrolls in, and `src` is meanwhile empty or a
spacer — so a host test against `src` rejects the very image being looked for.
`imgSrc()` resolves all the forms and both the tile and detail paths use it.
Neokyo's Mercari-JP listings were captured with no image at all for this reason
while its Rakuma ones worked.

An image that has not decoded reports `0x0`, so nothing about it can be called
portrait and every shape-based strategy passes over it. There is a last-resort
pass for exactly that case.

A row with no photo shows a **dashed placeholder**, not the browser's
broken-image icon. When one is missing the panel also prints **what the photo
search saw** — every image on the page with its dimensions, and which strategy
won — beside the title candidates. "The image is broken" and "the image is the
wrong one" are the same question, *which element did it read*, and answering it
from a screenshot is a round of guessing. Those are different claims — "nothing was read" points at the
parser, "captured but will not load" points at the CDN — and they must not look
alike.

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
| — | `node tools/test_capture_parsing.mjs` runs every site's price, currency, title and id rules against real page strings, with no browser |
| — | `node tools/test_search.mjs` ranks the free-text card search against the real 11k index |
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

## What differs on eBay

Server-rendered like Neokyo, but it is the first source that carries a **sale
date on the tile itself** — a sold search shows `Sold  Sep 12, 2025` beside the
price, where Mercari gives only a sold flag.

- **"Sold" alone means nothing here.** A *live* eBay tile advertises how many
  have gone: `3 sold`, `1,204 sold`. A bare `/sold/` test would file every
  popular active listing as a sale at its asking price, which is the one kind
  of bad row that quietly drags a card's median around. So the test requires a
  **date** — `Sold Sep 12, 2025` — on tiles and on listing pages alike.
- **Ended is not sold either.** A listing pulled by its seller, or an auction
  that closed with no bids, sold for nothing. Only `Sold <date>`, `This listing
  sold` and `Winning bid` count.
- **Foreign prices are refused, not converted.** International listings surface
  on ebay.com priced in their own currency. Where eBay states the US figure
  beside it (`C $18.00 (US $13.20)`) that figure wins; where it does not, the
  price is left empty rather than read as dollars — `C $18.00` taken as
  eighteen US dollars is a silent ~30% error that looks entirely ordinary.
- **The name has eBay's furniture on it.** The listing page's `h1` opens with a
  screen-reader-only `Details about`, and search tiles prefix `New Listing` and
  suffix `Opens in a new window or tab`. None of it is what the seller wrote,
  and any of it welded on stops the card index matching, so `titleClean` strips
  them from whichever source won.
- **Postage rides on the listing, not on an average.** eBay states shipping per
  listing, and a $6.00 card with $5.48 postage costs nearly twice a $6.00 card
  without — no per-marketplace estimate can tell those apart. Where the page
  states it, the figure **replaces** the fee model's shipping line rather than
  adding to it; charging both double-counts. `0` is a real answer ("Free
  shipping") and switches the estimate off; `null` means the page was not read
  for it and the estimate stands.
- **Bigger thumbnails are free, differently.** eBay sizes in the *filename* —
  `s-l225.jpg` → `s-l500.jpg` — where Mercari sizes in the query string.
  Separate branches in `bigThumb`, since one mechanism applied to the other
  host produces a 404 rather than a bigger image. **Both branches only rewrite
  a dimension the URL already declares** — see below.

## What differs on Pocamarket

A structured photocard catalogue rather than a general marketplace: a listing
names the origin, the group and the member as separate fields instead of a
seller-written sentence.

- **It renders as a mobile app frame even on desktop**, with the marketing
  landing page still in the DOM beside it. That is not cosmetic — "The
  Marketplace for K-Pop Photocards" is set in display type, so it is the
  largest text on the page and wins the font-size ranking outright. The landing
  copy is in `titleReject` for that reason.
- **Three USD figures sit on one listing page and only the middle one is the
  price**: `Save 1.40 USD before price increases!` above it, `7.00 USD`, and
  `Ship to United States from 12.00 USD` below. Taking the first match buys the
  card for its discount; taking the largest buys it for the postage. Both
  non-price lines are stripped before the price is read.
- **Numbers come before the unit** — `7.00 USD`, `12,000원` — where every other
  source puts a symbol in front.
- **Declared USD, parses won.** It quotes a US buyer in dollars throughout, so
  that is what its fee amounts are entered in and what it actually charges; but
  `priceFrom` still reads won for a switched display, and `nativeCurrency`
  keeps the two apart. Labelling a won figure USD is a ~1,300x error.
- **The photo comes from `og:image`, then from shape — never from size.**
  "Largest image on the site's CDN" works everywhere else and fails here: the
  landing page shares the DOM with the app frame, and its hero of two tilted
  cards is the biggest image on the page, so every capture got the same
  picture. `photoOrder: ['og', 'portrait']` — the page's own declaration first,
  then the largest image *taller than it is wide*, since a photocard is 55x85mm
  and a marketing composition laid across a hero is not.

  There is **no `largest` fallback** for this site on purpose. A generic image
  on every row reads as data; a missing one reads as missing.

- **Its postage is per SHIPMENT, so it is deliberately not captured.** "Ship to
  United States from 12.00 USD — same fee up to 40 items" is a box cost, and
  recording it per listing would charge $12 forty times. It belongs in the fee
  model as a `per_shipment` component with `typical_items_per_shipment = 40` —
  exactly the Neokyo box case.
- **The name comes from the document title, and only from there.** Confirmed
  against the page source:

  ```html
  <title>Pocamarket, Stray Kids HYUNJIN THIS &amp; THAT THIS VER. K-pop Photocard</title>
  ```

  On the page itself the identity is split across separate fields — the version
  on one line, `Stray Kids | HYUNJIN` on the next — so the heuristic ranking can
  only ever return half of it. Measured against the real card index, the full
  title lands on **Hyunjin · This & That**; the version alone lands on **Bang
  Chan · This & That**. Half a name is not a weaker match, it is a wrong one.

  The site name **leads** rather than trails, so the generic suffix strip in
  `TITLE_SOURCES.doc` does not reach it — `titleClean` takes off the prefix and
  the trailing `K-pop Photocard`, which is on every listing.

## Sources and currency

`marketplace` is recorded on every listing, and the DB knows four sources —
`mercari_us` (USD), `neokyo` (JPY), `pocamarket` (USD), `ebay` (USD).
**All four have capture parsers.** Pocamarket's title selector is not yet
confirmed against a live page — see below.

**Adding a site** is three edits, and the extension stays silently inert if any
is missed:

1. an entry in `SITES` at the top of `content/capture.js`;
2. the host in **both** `host_permissions` and the `capture.js`
   content-script `matches` in `manifest.json` — plus the site's image CDN in
   `host_permissions`, or thumbnails cannot be fetched;
3. the host in `CAPTURE_HOSTS` in `background.js`, or a tab opened on that site
   never comes up capturing.

A **React** site additionally needs `hasFiber: true`, its host in the second
(`"world": "MAIN"`) block, and its tile selector in `content/fiber.js`.

Set **`titleUnverified: true`** on a new site until its name element has been
checked against a live page. It forces the panel's page-read diagnostic on for
every capture, so the ranked shortlist and the element each candidate came off
are visible instead of a guess presenting itself as an answer. Drop it once the
real source is known. No site carries it today.

**`titleReject` applies to every title source**, not only to the ranked
shortlist — Neokyo's `og:title` and document title both say *Item Details*, the
exact generic name the ranking exists to avoid, so filtering only `scope` meant
a page where the ranking found nothing fell straight back onto it. A capture
that ends with **no** name is flagged in the panel; one that ends with a
plausible name that is identical on every row is not. A server-rendered site needs none of that — but everything
the capture requires (price, title, a photo) has to be reachable from the DOM,
since there is no page-world object to fall back to.

Nothing else in the extension knows any marketplace's URL shape. Where a site
can rebuild a listing URL from its id it declares `urlFor`; otherwise the
anchor's own `href` is recorded, which is always right and needs no knowledge
of the path layout.

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
- **That conversion also puts a rate on file.** Syncing a Neokyo capture records
  the rate its own USD figure implies, so yen *fees* start converting to USD
  without anyone entering a rate by hand. Per currency per day it keeps the rate
  implied by the **largest** listing — the published USD figure is rounded, so
  ¥12,000 → $79.20 pins the rate far more tightly than ¥350 → $2.31 — and it
  never overwrites a rate already on file for that day.
- `GET /market/fx` lists rates and names any currency with **no rate on file**,
  so a gap is visible rather than silently dropping those sightings out of
  comps.

Amounts are stored in **minor units of their currency** — USD $40.00 is 4000,
but ¥2500 is 2500, because JPY has no subdivision. Dividing by 100 to display
is a USD-only assumption.

## Not built yet

Capture parsers for Pocamarket and eBay. Lot line entry beyond a card list
(quantities, non-card items, unidentified placeholders). Automatic sync. Image
blobs still stay local — sync sends the thumbnail URL only.

**Japanese titles do not filter the card picker.** `lib/matcher.js` tokenizes
Latin only, so a Neokyo title produces no chips and the panel says
*"Japanese title — not readable yet, search for the card"* rather than
presenting the whole library as if it had matched something. Use the search box.
Segmentation plus a kana/kanji alias layer is the fix, and `ALIASES` is the seam
it hangs off.

The planned **enrich** tier — queueing ids and fetching detail pages in the
background — was dropped rather than deferred. Its queue, throttle and session
handling existed only to make automated fetching defensible, and none of it is
needed when you open the tab yourself.
