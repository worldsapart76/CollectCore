// Content script: reads listing data off React's fiber and draws capture dots.
//
// Standalone by necessity — manifest-declared content scripts cannot use ES
// module imports, so everything this needs lives in this file.
//
// Renders NOTHING until activated (plan doc -> Dormant by default).

(() => {
  // Supported sources, keyed by hostname.
  //
  // ADDING A SITE: an entry here is three edits, not one, and the extension
  // stays silently inert if any is missed —
  //   1. an entry below,
  //   2. the host in `host_permissions` AND in the capture.js
  //      `content_scripts` matches in manifest.json (plus its image CDN in
  //      host_permissions, or thumbnails cannot be fetched),
  //   3. the host in CAPTURE_HOSTS in background.js, or a tab opened on it
  //      never comes up capturing.
  // Only a React site needs
  // the second (MAIN-world) block and a selector in content/fiber.js; set
  // `hasFiber` for those. A server-rendered site is read from the DOM alone,
  // which is why `price`, `name` and a photo all have to be reachable from the
  // tile without any page-world help.
  //
  // Content scripts cannot import modules, so this registry lives inline
  // rather than in lib/. Keep it in step with lkup_mkt_marketplaces.
  // `price` is always in the site currency's MINOR units — cents on Mercari,
  // whole yen on Neokyo. JPY has no subunit, so ¥350 is 350 and dividing it by
  // 100 anywhere is the classic currency bug. The backend agrees (minor_exp).
  const SITES = {
    'www.mercari.com': {
      code: 'mercari_us',
      currency: 'USD',
      minorExponent: 2,
      // React app: content/fiber.js reads the real item object in the page
      // world and stamps it on the tile. The DOM read below is the fallback.
      hasFiber: true,
      tiles: 'a[href*="/item/m"]',
      idFrom: (href) => href.match(/\/item\/(m\d+)/)?.[1] || null,
      urlFor: (id) => `https://www.mercari.com/us/item/${id}/`,
      queryParam: 'keyword',
      priceFrom: (text) => money(text, /\$\s?([\d,]+(?:\.\d{2})?)/, 2),
      // A tile is short and its only "sold" is the badge, so a bare word is
      // safe there. A detail page is not: its description can say "sold out
      // elsewhere", and reading that as a sale would invent a comp out of
      // nothing. Two patterns, because the two surfaces carry different risks.
      tileSoldFrom: (text) => /\bsold\b/i.test(text),
      soldFrom: (text) =>
        /\bitem sold\b|\bsold\s+\d+\s*(h|m|d|hour|min|day)/i.test(text),
      photoHost: /mercdn\.net\/photos\//,
    },

    // Proxy for Mercari JP and Rakuma. Server-rendered, so there is no fiber to
    // read and content/fiber.js is deliberately not injected here — the DOM
    // path below is the ONLY path, which is why it has to stand on its own.
    //
    // Active-only by nature: a proxy lists what can still be bought, so no sold
    // comps come from here. That is not a gap, it is what the buy side is.
    'neokyo.com': {
      code: 'neokyo',
      currency: 'JPY',
      minorExponent: 0,
      // The path prefix is not hardcoded. Matching on `/product/` alone
      // survives a locale segment (`/en/`), a provider segment, and any
      // reshuffling of either — none of which change what the link IS.
      tiles: 'a[href*="/product/"]',
      idFrom: idFromLastSegment,
      // idFromLastSegment only knows "long, has a digit", which a category or
      // page-number segment can also satisfy. This says which paths are
      // actually listings, so a capture bar never appears on a browse page.
      detailPath: /\/product\//,
      // No urlFor: the anchor's own href is the URL, so nothing has to be
      // reconstructed from a shape this file would have to know.
      queryParam: 'keyword',
      // The listing name is NOT the h1, the og:title or the document title —
      // all three say "Item Details", Neokyo's generic page name, which is how
      // every early capture ended up filed under it.
      //
      // This net is deliberately broad. Narrow selectors returned a
      // cookie-consent banner and a mobile nav link; the ranking in
      // titleCandidates() is what narrows now, and this only has to make sure
      // the right element is in the room to be ranked.
      titleScope: [
        'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
        'p', 'span', 'div', 'b', 'strong', 'a', 'li', 'td',
      ],
      // The listing name, from the page source:
      //
      //   <h6 class="font-gothamRounded mb-0 translate">straykids ヒョンジン
      //   kms 樂star 店舗特典</h6>
      //
      // An h6 — which is why h1-h5 found nothing and the ranking was picking
      // between a cookie banner and a nav link.
      //
      // `translate` is Neokyo's own marker for text it machine-translates,
      // which is to say text the SELLER wrote rather than text the site did.
      // That is exactly the distinction being reached for, stated by the site
      // itself, so it beats any heuristic about size or position. A heading
      // carrying it is preferred outright; the size ranking stays underneath
      // as the fallback for when the class is not there.
      titlePrefer: [
        'h1.translate', 'h2.translate', 'h3.translate',
        'h4.translate', 'h5.translate', 'h6.translate',
      ].join(','),
      // A secondary filter only. It is English, and the page can be
      // machine-translated or set to another language, so nothing may DEPEND
      // on it — see titleCandidates() for the part that actually works.
      titleReject:
        /^(item details|item price|purchase request|about neokyo|new user guide|categories)\b/i,
      titleOrder: ['scope', 'og', 'doc', 'h1'],
      // Neokyo spells the unit out — "3399 Yen" — with no ¥ and no 円, which
      // is why the first version found no price at all and fell through to the
      // dollars. The symbol forms stay as fallbacks; the page has used both.
      //
      // Spelled-out "Yen" first is also what makes searching the whole page
      // safe: the header's points badges render as bare numbers next to a yen
      // glyph, and a symbol-first search would read one of those as the price.
      priceFrom: (text) =>
        money(text, /([\d,]+)\s*Yen\b/i, 0) ??
        money(text, /[¥￥]\s?([\d,]+)/, 0) ??
        money(text, /([\d,]+)\s*円/, 0),
      // "Approximately : US$ 21.07" — Neokyo's own conversion, beside the yen.
      // Its rate is the one actually charged, so it beats anything looked up.
      usdFrom: (text) => money(text, /\$\s?([\d,]+(?:\.\d{2})?)/, 2),
      // "Availability: In stock" is a field on every product page, so its
      // opposite is the reliable signal here rather than the word "sold".
      soldFrom: (text) =>
        /\bsold\s*out\b|\bout of stock\b|売り切れ|販売終了/i.test(text),
      photoHost: /img\.fril\.jp|mercdn\.net/,
    },

    // Server-rendered, so no fiber and content/fiber.js is not injected here.
    //
    // The first source that carries a sale DATE on the tile itself: a sold
    // search shows "Sold  Sep 12, 2025" beside the price, where Mercari gives
    // only a sold flag. That date is what the sold series has been missing.
    'www.ebay.com': {
      code: 'ebay',
      currency: 'USD',
      minorExponent: 2,
      tiles: 'a[href*="/itm/"]',
      // The id is the trailing number. A listing URL may or may not carry a
      // title slug before it (/itm/stray-kids-photocard/123456789012), so the
      // pattern reaches for the digits rather than assuming which segment.
      idFrom: (href) => href.match(/\/itm\/(?:[^/?#]*\/)?(\d{9,15})/)?.[1] || null,
      // Rebuilt rather than taken from the anchor: a search-results href
      // carries a long tail of tracking parameters, and two tiles for the same
      // listing would otherwise produce two different URLs for one row.
      urlFor: (id) => `https://www.ebay.com/itm/${id}`,
      detailPath: /\/itm\//,
      queryParam: '_nkw',
      priceScope: ['.x-price-primary', '[data-testid="x-price-primary"]',
                   '.x-bin-price__content', '.x-price-approx__price'],
      // eBay's h1 is the listing name, but it opens with a screen-reader-only
      // "Details about" label that textContent picks up. The bold span inside
      // holds the name alone, so it is preferred outright and the h1 is the
      // fallback for when that class name changes.
      titleScope: ['h1', 'h2', 'h3', 'span', 'div'],
      titlePrefer: 'h1 .ux-textspans, h1.x-item-title__mainTitle',
      titleReject: /^(details about|shop on ebay|opens in a new window)\b/i,
      titleOrder: ['scope', 'og', 'doc', 'h1'],
      // Both surfaces prefix or suffix the name with their own furniture:
      // "New Listing" on a search tile, "Details about" on a listing page.
      // Neither is part of what the seller wrote, and either welded on is
      // enough to stop the card index matching.
      titleClean: (t) =>
        t.replace(/^\s*(details about|new listing)\s*/i, '')
         .replace(/\s*opens in a new (window|tab).*$/i, '')
         .trim(),
      // Foreign-currency listings surface on ebay.com with their own prefix.
      // Reading "C $18.00" as eighteen US dollars is a silent ~30% error in a
      // comp, and it would look completely ordinary on screen.
      priceFrom: (text) => {
        const s = String(text || '');
        // Where a listing is priced in another currency eBay states the US
        // figure explicitly beside it, so that form wins outright -- taking
        // the first `$` on the page instead would read the foreign one.
        const us = money(s, /\bUS\s?\$\s?([\d,]+(?:\.\d{2})?)/i, 2);
        if (us !== null) return us;
        // A foreign prefix with no US figure beside it is refused rather than
        // guessed at.
        if (/\b(?:C|AU|NZ|S|HK)\s?\$|[£€]\s?[\d,]/.test(s)) return null;
        return money(s, /\$\s?([\d,]+(?:\.\d{2})?)/, 2);
      },
      // NOT a bare "sold". An ACTIVE eBay tile advertises how many have gone
      // -- "3 sold" -- so the bare word would file every popular live listing
      // as a sale at its asking price, which is the one kind of bad row that
      // quietly drags a card's median around. A real sale states its date.
      tileSoldFrom: (text) => /\bsold\s+\w+\s+\d{1,2},?\s*\d{4}/i.test(text),
      // Same date requirement, plus the auction wording. Deliberately NOT
      // "ended": a listing ended by its seller, or an auction that closed with
      // no bids, sold for nothing and is not a comp.
      soldFrom: (text) =>
        /\bsold\s+\w+\s+\d{1,2},?\s*\d{4}|\bthis listing sold\b|\bwinning bid\b/i
          .test(text),
      // WHEN it sold, which no other source tells us. A sold search returns
      // months of sales at once, and stamping them all with the capture time
      // would collapse the time dimension entirely -- a sale from March would
      // read as a day old, and the grid colours staleness off exactly that.
      soldDateFrom: (text) => {
        const m = String(text || '').match(
          /\bsold\s+(\w{3,9})\.?\s+(\d{1,2}),?\s*(\d{4})/i);
        if (!m) return null;
        const month = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase());
        if (month < 0) return null;
        const d = new Date(Date.UTC(+m[3], month, +m[2]));
        return Number.isNaN(d.getTime()) ? null : d.toISOString();
      },
      photoHost: /i\.ebayimg\.com/,
    },

    // Not built yet — see docs/photocard_market_intel_plan.md:
    //   pocamarket  (KRW)
  };

  const SITE = SITES[location.hostname] || SITES[location.hostname.replace(/^www\./, '')];
  if (!SITE) return; // not a supported source; stay entirely inert

  // --- Site helpers --------------------------------------------------------

  // Month abbreviations, for sites that print a sale date in words. Parsed
  // here rather than handed to `new Date(string)`, whose behaviour on partial
  // dates is implementation-defined and locale-sensitive.
  const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun',
                  'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

  // Pulls a number out of page text and returns it in minor units. `exponent`
  // is the currency's, not the match's: 2 turns 12.34 into 1234, 0 leaves 1234
  // alone.
  function money(text, re, exponent) {
    const m = String(text || '').match(re);
    if (!m) return null;
    const n = parseFloat(m[1].replace(/,/g, ''));
    if (!Number.isFinite(n)) return null;
    return Math.round(n * 10 ** exponent);
  }

  // What a price actually is, in the currency it was actually shown in.
  //
  // A marketplace's currency is not a fixed fact about the marketplace -- it is
  // whatever that site is displaying to YOU. Neokyo has a currency selector,
  // and with it set to USD a product page carries no yen at all, so insisting
  // the record be JPY produced captures with a USD figure and an empty price.
  //
  // So the symbol on the page decides. Native first (JPY here), and only if
  // there is none does the USD figure become the price in its own right rather
  // than a conversion of something.
  // `fallback` is the wider text to try when the narrow one came up empty --
  // on a detail page, the price element first and the whole page after it.
  // Narrowing alone was not enough: Neokyo renders the yen and the dollars in
  // separate elements, so scoping to one of them found the dollars and missed
  // the yen entirely.
  function readPrice(text, fallback = null) {
    const pick = (fn) => {
      if (!fn) return null;
      const a = fn(text);
      if (a !== null && a !== undefined) return a;
      return fallback === null ? null : fn(fallback);
    };
    const native = pick(SITE.priceFrom);
    const usd = pick(SITE.usdFrom);
    if (native !== null && native !== undefined) {
      // Both present: the site is showing its own conversion beside the
      // native price, and that conversion is the rate actually charged.
      return { price: native, currency: SITE.currency, priceUsd: usd };
    }
    if (usd !== null && usd !== undefined) {
      return { price: usd, currency: 'USD', priceUsd: null };
    }
    return { price: null, currency: SITE.currency, priceUsd: null };
  }

  // Text of the first element matching any of `selectors`. Used to read a
  // price from the element that holds it rather than from the whole page,
  // where a currency switcher or a shipping quote can appear above it.
  function scopedText(selectors) {
    for (const sel of selectors || []) {
      const el = document.querySelector(sel);
      const t = (el?.textContent || '').trim();
      if (t) return t;
    }
    return null;
  }

  // Last meaningful path segment, for sites whose listing id is the tail of
  // the URL and whose prefix we would otherwise have to guess. Guarded so a
  // nav link like /en/about never reads as a listing.
  function idFromLastSegment(href) {
    let path;
    try {
      path = new URL(href, location.origin).pathname;
    } catch {
      return null;
    }
    const seg = path.split('/').filter(Boolean).pop() || '';
    // An id is long and contains a digit. Category and locale segments are
    // neither, so this rejects them without knowing what they are called.
    if (seg.length < 6 || !/\d/.test(seg)) return null;
    return seg;
  }

  // The canonical URL for a listing. A site that can rebuild it from the id
  // does so; otherwise the anchor's own resolved href is used, which is always
  // right and needs no knowledge of the site's URL shape.
  function urlForListing(id, anchor) {
    if (SITE.urlFor) return SITE.urlFor(id);
    if (anchor) return new URL(anchor.getAttribute('href'), location.origin).href;
    return location.href.split('?')[0];
  }

  // A page is a listing's own page when its URL yields an id the same way a
  // tile href does. Nothing site-specific beyond idFrom, which already exists.
  function detailIdFromUrl() {
    if (SITE.detailPath && !SITE.detailPath.test(location.pathname)) return null;
    return SITE.idFrom(location.pathname) || null;
  }

  const DOT_CLASS = 'cc-capture-dot';

  let active = false;
  let orphaned = false;
  let captured = new Set();
  let observer = null;

  // Reloading the extension orphans this script: the DOM it injected survives,
  // but its chrome.runtime connection is severed, so every message throws and
  // clicking a dot silently does nothing. Surfacing it beats leaving someone to
  // wonder why a button stopped working.
  async function send(message) {
    if (orphaned) return null;
    try {
      return await chrome.runtime.sendMessage(message);
    } catch (err) {
      if (String(err).includes('Extension context invalidated')) showOrphaned();
      return null;
    }
  }

  function showOrphaned() {
    if (orphaned) return;
    orphaned = true;
    document.querySelectorAll(`.${DOT_CLASS}`).forEach((d) => {
      d.classList.add('cc-error');
      d.title = 'Extension was reloaded — refresh this page';
    });
    const bar = document.createElement('div');
    bar.className = 'cc-orphan-bar';
    bar.textContent =
      'CollectCore was reloaded — refresh this page to resume capturing.';
    bar.addEventListener('click', () => location.reload());
    document.body.appendChild(bar);
  }

  // --- Extraction ----------------------------------------------------------

  // Preferred path: the full item object Mercari hands the tile component,
  // read in the page world by content/fiber.js and passed across the isolated-
  // world boundary as a data attribute. A content script CANNOT read the fiber
  // itself — `__reactFiber$…` is an expando on the page's object, invisible
  // here. Do not move that walk back into this file.
  function itemFromStamp(anchor) {
    const raw = anchor.dataset.ccItem;
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  // Fallback for when React internals move under us. Gets less, but keeps the
  // extension working rather than failing silently on a Mercari deploy.
  //
  // On a site with no fiber at all — Neokyo is server-rendered — this is not a
  // fallback, it is the only reader. Hence _viaFallback below is set from
  // whether the site HAS a fiber path, not from having landed here.
  function itemFromDom(anchor) {
    const id = idFromHref(anchor);
    if (!id) return null;
    const text = anchor.textContent || '';
    return {
      id,
      // A tile's own text is the title on a server-rendered card and the alt
      // text on an image-only one. Neither is guaranteed, so try both.
      name:
        anchor.querySelector('img')?.getAttribute('alt') ||
        tileTitle(anchor) ||
        '',
      ...readPrice(text),
      status: (SITE.tileSoldFrom || SITE.soldFrom)(text) ? 'trading' : 'on_sale',
      // When the sale happened, where the tile says so. Null everywhere else,
      // and the capture time stands in.
      soldAt: SITE.soldDateFrom?.(text) ?? null,
      thumbnail: tilePhoto(anchor),
      itemCondition: null,
      category: null,
      categoryId: null,
      brand: null,
      _viaFallback: !!SITE.hasFiber,
    };
  }

  // The tile's visible heading. Falls back to its whole text only when there is
  // no element-level title, and drops the price line out of it — a title with
  // "¥1,200" welded onto the end matches nothing in the card index.
  function tileTitle(anchor) {
    const el = anchor.querySelector(
      'h1, h2, h3, h4, [class*="title"], [class*="name"]'
    );
    const raw = (el?.textContent || anchor.textContent || '').trim();
    return cleanTitle(
      raw
        .replace(/[¥￥$]\s?[\d,]+(?:\.\d{2})?/g, ' ')
        .replace(/[\d,]+\s*円/g, ' ')
        .replace(/[\d,]+\s*원/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    );
  }

  // Prefer a photo on the site's own image CDN; take any image rather than
  // none, since a wrong-looking thumbnail is visibly wrong in the panel while
  // a missing one just looks broken.
  function tilePhoto(anchor) {
    const imgs = [...anchor.querySelectorAll('img')];
    const hosted = imgs.find((i) => SITE.photoHost.test(i.currentSrc || i.src || ''));
    const pick = hosted || imgs[0];
    // Lazy-loaded tiles carry the real URL in data-src until they scroll in.
    return (
      pick?.currentSrc ||
      pick?.src ||
      pick?.dataset?.src ||
      pick?.getAttribute('data-original') ||
      null
    );
  }

  function readItem(anchor) {
    return itemFromStamp(anchor) || itemFromDom(anchor);
  }

  function idFromHref(anchor) {
    const href = anchor.getAttribute('href');
    return href ? SITE.idFrom(href) : null;
  }

  function keyFor(id) {
    return `${SITE.code}:${id}`;
  }

  function searchQuery() {
    return new URLSearchParams(location.search).get(SITE.queryParam) || null;
  }

  // --- Overlay -------------------------------------------------------------

  function decorate(anchor) {
    // The anchor's CURRENT href is the only source of truth for which listing
    // this tile shows. React recycles these nodes: scrolling or paginating
    // reuses the same <a> for a different item, changing href and children
    // while any child we appended survives. Caching the id on the dot meant a
    // recycled tile reported the previous listing — clicking one card
    // captured a different one.
    const id = idFromHref(anchor);
    if (!id) return;

    let dot = anchor.querySelector(`:scope > .${DOT_CLASS}`);
    if (!dot) {
      // Anchors are usually statically positioned; the dot needs a containing
      // block. Only touch it when it would otherwise escape the tile.
      if (getComputedStyle(anchor).position === 'static') {
        anchor.style.position = 'relative';
      }

      dot = document.createElement('button');
      dot.type = 'button';
      dot.className = DOT_CLASS;
      dot.title = 'Capture to CollectCore';
      dot.addEventListener('click', (e) => onDotClick(e, anchor, dot));
      anchor.appendChild(dot);
    }

    syncDot(anchor, dot);
  }

  async function onDotClick(e, anchor, dot) {
    // The dot lives inside the listing anchor — without this, capturing
    // navigates away from the search results.
    e.preventDefault();
    e.stopPropagation();

    // Re-read at click time, never from a value captured when the dot was
    // created: this anchor may have been recycled since.
    const id = idFromHref(anchor);
    if (!id) return;
    const key = keyFor(id);

    if (captured.has(key)) {
      await send({ type: 'UNCAPTURE', key });
      captured.delete(key);
      syncDot(anchor, dot);
      return;
    }

    const item = readItem(anchor);
    if (!item || item.id !== id) {
      // The page-world stamp belongs to a different listing than this anchor
      // now shows, so it has not been re-stamped yet. Refusing beats capturing
      // the wrong card.
      dot.classList.add('cc-error');
      dot.title = 'Could not read this listing — scroll away and back';
      return;
    }

    const res = await send({
      type: 'CAPTURE',
      payload: {
        item,
        marketplace: SITE.code,
        currency: SITE.currency,
        listingUrl: urlForListing(id, anchor),
        pageUrl: location.href,
        searchQuery: searchQuery(),
      },
    });
    if (!res) return; // orphaned, or the worker refused it
    captured.add(key);
    syncDot(anchor, dot);
  }

  function syncDot(anchor, dot) {
    const id = idFromHref(anchor);
    const on = id ? captured.has(keyFor(id)) : false;
    const label = on ? '✓' : '+';

    // Every write here must be conditional. Assigning textContent replaces the
    // text node even when the value is unchanged, and that is a childList
    // mutation the observer picks up — which called this again, forever, and
    // hung the page.
    if (dot.textContent !== label) dot.textContent = label;
    if (dot.classList.contains('cc-on') !== on) {
      dot.classList.toggle('cc-on', on);
    }
    if (dot.classList.contains('cc-error')) {
      dot.classList.remove('cc-error');
    }
  }

  // --- Detail page ---------------------------------------------------------
  //
  // A listing's own page is where shippingPayerCode, the description and the
  // full photo set live -- all null or empty in search tiles.
  //
  // This replaces the planned "enrich" tier. Enrich needed a queue, a
  // background fetcher, a throttle and session handling, all of it to make
  // AUTOMATED fetching defensible. None of that is required when the human
  // opened the tab, which is how these listings get looked at anyway.
  //
  // The button sits fixed on the page rather than inside a link, so unlike the
  // tile dot there is nothing to navigate away from.

  const BAR_ID = 'cc-detail-bar';

  function detailItem() {
    const raw = document.body.dataset.ccDetailItem;
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  // DOM fallback for a listing's own page.
  //
  // The fiber walk finds SOMETHING carrying the listing id on a detail page,
  // but not the full item -- the first attempt produced a row with a price and
  // a status but no name and no image. Rather than keep guessing at where
  // Mercari keeps the real object, read the page: the title, price and photo
  // are rendered, visible, and not going anywhere.
  //
  // Same posture as itemFromDom() for tiles, including the _viaFallback flag.
  // A degraded capture has to be visible as degraded -- silently bad data is
  // the failure mode this whole module is built to avoid.
  // The three places a listing's name can be found, each read the same way on
  // every site. Which order to TRY them in is per site, because it depends on
  // what the site puts in its h1: Mercari's is the listing name, Neokyo's is
  // the section heading "Item Details" -- taking h1 first there captured every
  // listing under the same useless title.
  // Every element that could be holding the listing's name, best first.
  //
  // Structure decides, not words. The page may be machine-translated in the
  // browser, which rewrites every text node -- so a list of English strings to
  // reject is a list that stops working the moment the translation is off, or
  // differs, or the site's own language selector is set to something else.
  // What survives translation is where an element SITS: a site's chrome lives
  // in its header, nav and footer, and a listing's name does not.
  //
  // Ranking is by length among what remains. A section heading is a couple of
  // words ("Item Details", "Purchase Request Form"); a listing title is a
  // sentence of specifics. That ordering holds in any language, and it is why
  // "About Neokyo" -- picked up from the footer once the English blocklist had
  // eliminated everything above it -- cannot win now on either count.
  // Site chrome, identified by class and id as well as by tag.
  //
  // Neokyo uses none of the semantic elements, so `closest('header, nav,
  // footer')` matched nothing at all and the exclusion did nothing -- a mobile
  // nav link and a cookie-consent modal both made the shortlist.
  const CHROME = [
    'header', 'nav', 'footer', 'dialog',
    '[class*="header"]', '[class*="navbar"]', '[class*="nav-"]',
    '[class*="footer"]', '[class*="modal"]', '[class*="cookie"]',
    '[class*="banner"]', '[class*="breadcrumb"]', '[role="dialog"]',
    '[id*="header"]', '[id*="footer"]', '[id*="modal"]',
  ].join(',');

  // Memoised per path. This runs from decorateDetail(), which the mutation
  // observer calls on every frame that changes the DOM, and it walks every
  // leaf element measuring type sizes -- cheap once, not cheap sixty times a
  // second. An empty result is never cached: the page may simply not have
  // rendered yet, and caching that would make the title permanently blank.
  let titleMemo = { path: null, list: null };

  function titleCandidates() {
    if (!SITE.titleScope) return [];
    if (titleMemo.path === location.pathname && titleMemo.list?.length) {
      return titleMemo.list;
    }
    const out = [];
    const scopeSel = SITE.titleScope.join(',');
    for (const el of document.querySelectorAll(scopeSel)) {
      if (el.closest?.(CHROME)) continue;
      const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (!text || text.length > 160) continue;

      // Innermost only: a wrapper carries the same text as the element inside
      // it, and keeping both fills the shortlist with duplicates of one node.
      //
      // "Has any children" was the wrong test. Chrome's page translation
      // rewrites each translated text node as a <font> wrapper, so the
      // listing's own <h6> acquired an element child and was dropped -- taking
      // the site's `translate` marker with it and leaving the shortlist to a
      // category menu. Untranslated furniture kept no wrapper and survived,
      // which is exactly backwards: the wrapper marks the SELLER's text.
      //
      // So the test is whether a candidate the ranking could pick instead sits
      // inside carrying the same text. A <font> is not one, so the h6 stays.
      const inner = el.querySelector?.(scopeSel);
      if (inner && (inner.textContent || '').replace(/\s+/g, ' ').trim() === text) {
        continue;
      }

      // The site's own marker for seller-written text. Where it exists it is
      // not a hint to be weighed against others -- it is the answer, so the
      // heuristics below are skipped rather than allowed to veto it. A short
      // title is still a title.
      const preferred =
        SITE.titlePrefer && el.matches?.(SITE.titlePrefer) ? 1 : 0;

      if (!preferred) {
        // Too short to be a listing name.
        if (text.length < 8) continue;
        if (SITE.titleReject?.test(text)) continue;
        // The price is the biggest text on the page and would otherwise win
        // the ranking outright. Anything short enough to be only a price is
        // not a title -- a listing whose whole name is a price does not exist.
        if (text.length <= 26 && SITE.priceFrom?.(text) !== null) continue;
      }
      out.push({
        text,
        // Sorted above everything else: a fact the page states about itself
        // beats an inference drawn from how it looks.
        preferred,
        size: fontSize(el),
        // Recorded for the panel's diagnostic: knowing WHICH element held the
        // name is the difference between fixing this and guessing at it again.
        where: `${el.tagName?.toLowerCase() || '?'}${
          el.className && typeof el.className === 'string'
            ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.')
            : ''
        }`,
      });
    }
    // Biggest type first, then longest.
    //
    // Font size is the ranking that survives everything else being unknown: a
    // page renders its subject larger than the furniture around it, and that
    // is true whatever the markup is called and whatever language the text has
    // been translated into. Length breaks the tie among same-size headings,
    // where a section heading is a couple of words and a listing name is a
    // sentence of specifics.
    out.sort(
      (a, b) =>
        b.preferred - a.preferred ||
        b.size - a.size ||
        b.text.length - a.text.length
    );
    titleMemo = { path: location.pathname, list: out };
    return out;
  }

  function fontSize(el) {
    try {
      return parseFloat(getComputedStyle(el).fontSize) || 0;
    } catch {
      return 0;
    }
  }

  const TITLE_SOURCES = {
    // Headings in DOM order, minus the page's own fixed furniture. Querying
    // every selector at once rather than in turn is deliberate: DOM order is
    // the signal — a listing's name is rendered before the panels beside it —
    // and taking selectors in turn would override that with my guess about
    // which class name is most likely to exist.
    scope: () => titleCandidates()[0]?.text ?? null,
    h1: () => document.querySelector('h1')?.textContent?.trim(),
    og: () =>
      document
        .querySelector('meta[property="og:title"]')
        ?.getAttribute('content')
        ?.trim(),
    // Always present, so whatever order a site uses, the chain terminates.
    // Every marketplace suffixes its own name onto the document title.
    doc: () =>
      (document.title || '')
        .replace(/\s*[|\-–]\s*(Mercari|Neokyo|eBay)[^|\-–]*$/i, '')
        .trim(),
  };

  // Furniture a site welds onto the name on every listing: eBay's screen-
  // reader "Details about" prefix, its "New Listing" flash. Applied to
  // whichever source won rather than inside any one of them, because the same
  // wrapper text shows up in the h1, the tile heading and the shortlist alike.
  //
  // Site-specific by necessity and secondary by design: nothing DEPENDS on it
  // -- a title that keeps its prefix still captures, it just matches the card
  // index worse.
  function cleanTitle(t) {
    const s = String(t || '').trim();
    if (!s || !SITE.titleClean) return s;
    // Never let a cleaner empty a title it was only supposed to trim.
    return SITE.titleClean(s) || s;
  }

  // Which source the last title came from. Recorded because "the title is
  // wrong" and "the title came from the wrong place" are the same bug, and
  // knowing which source won says immediately which one to fix.
  let lastTitleSource = null;

  function detailTitle() {
    for (const key of SITE.titleOrder || ['h1', 'og', 'doc']) {
      const t = cleanTitle(TITLE_SOURCES[key]?.());
      if (t) {
        lastTitleSource = key;
        return t;
      }
    }
    lastTitleSource = null;
    return '';
  }

  function detailPhoto() {
    // Largest photo on the site's own image CDN, EXCEPT that a not-yet-decoded
    // image reports zero dimensions -- so the first match is taken as a
    // baseline and only replaced by something measurably bigger. Requiring
    // area > 0 to win is what left the button unrendered on pages whose photos
    // had not loaded.
    let best = null;
    let bestArea = -1;
    for (const img of document.querySelectorAll('img')) {
      const src = img.currentSrc || img.src || '';
      if (!SITE.photoHost.test(src)) continue;
      const area =
        (img.naturalWidth || img.width || 0) * (img.naturalHeight || img.height || 0);
      if (area > bestArea) {
        bestArea = area;
        best = src;
      }
    }
    return best;
  }

  // DOM fallback for a listing's own page.
  //
  // The fiber walk finds SOMETHING carrying the listing id on a detail page
  // but not the full item, so the page itself is read instead: the title,
  // price and photo are rendered and are not going anywhere.
  //
  // Same posture as itemFromDom() for tiles, _viaFallback flag included. A
  // degraded capture has to be visible as degraded.
  function detailFromDom() {
    const id = detailIdFromUrl();
    if (!id) return null;

    const body = document.body.innerText || '';
    // Mercari renders the discounted price before the struck-through original,
    // so the FIRST match in the body is what the item actually costs. That
    // holds only where the body's first price IS the item's -- a page with a
    // currency switcher or a shipping quote above the fold needs the price
    // read from a narrower element, which is what priceScope is for.
    const scopedPrice = scopedText(SITE.priceScope);
    const sold = SITE.soldFrom(body);

    // What the page actually offered, recorded whether or not the read
    // succeeded. On a site with no fiber there is no scan to fall back on, and
    // "why is this one empty" is otherwise unanswerable without a screenshot
    // and a round of guessing. Truncated: this is a hint, not a page dump.
    const domScan = {
      priceText: (scopedPrice || body).replace(/\s+/g, ' ').trim().slice(0, 80),
      scoped: scopedPrice !== null,
      scope: (TITLE_SOURCES.scope() || '').slice(0, 60),
      // Whether the title came from the best source this site actually has:
      // the element the SITE marks as seller-written, where it publishes one.
      // Anything less is a guess that happened to win a ranking, and this is
      // the flag the panel shows the whole diagnostic on.
      //
      // Computed here rather than in the panel because only this file knows
      // what a given site offers.
      weak: SITE.titlePrefer ? !titleCandidates()[0]?.preferred : false,
      // The shortlist it chose from, each with the element it came off. This
      // is what turns "the title is wrong" into a selector rather than into
      // another round of guessing.
      cands: titleCandidates()
        .slice(0, 6)
        .map(
          (c) =>
            `${c.where} @${c.size}px${c.preferred ? ' *' : ''}: ` +
            c.text.slice(0, 40)
        ),
      h1: (TITLE_SOURCES.h1() || '').slice(0, 60),
      og: (TITLE_SOURCES.og() || '').slice(0, 60),
      doc: (TITLE_SOURCES.doc() || '').slice(0, 60),
    };

    // Being on a listing URL is enough to offer a capture. Bailing out when the
    // title or photo could not be read is what made the button vanish
    // entirely, which is far worse than a capture that needs a name later.
    // Before the object literal: domScan records which source won, and that is
    // only known once the title has actually been read.
    const name = detailTitle();
    domScan.titleFrom = lastTitleSource;

    return {
      id,
      name,
      // price, currency and priceUsd together -- the currency is whichever one
      // the page was actually showing, not an assumption about the site.
      // Price element first, whole page second: the two figures can live in
      // different elements.
      ...readPrice(scopedPrice, body),
      status: sold ? 'trading' : 'on_sale',
      soldAt: sold ? SITE.soldDateFrom?.(body) ?? null : null,
      thumbnail: detailPhoto(),
      itemCondition: null,
      category: null,
      categoryId: null,
      brand: null,
      shippingPayerCode: null,
      description: null,
      sellerId: null,
      photos: null,
      dates: null,
      // On a site with a fiber, having to read the page IS the fallback. On a
      // server-rendered one it is simply how the page is read, and flagging it
      // would mark every Neokyo capture degraded for no reason.
      _viaFallback: !!SITE.hasFiber,
      _domScan: domScan,
    };
  }

  // Prefer the fiber where it actually carried the listing; merge the DOM read
  // underneath to fill what it missed.
  function readDetailItem() {
    const urlId = detailIdFromUrl();
    if (!urlId) return null;

    const stamped = detailItem();
    const scraped = detailFromDom();
    let scan = null;
    try {
      scan = JSON.parse(document.body.dataset.ccDetailScan || 'null');
    } catch {
      scan = null;
    }

    // Explicit nulls in the stamp must not clobber a value the page DID have:
    // normalize() emits every field, so spreading it wholesale overwrote good
    // scraped values with null and then "borrowed" them straight back.
    const merged = { ...(scraped || {}) };
    for (const [k, v] of Object.entries(stamped || {})) {
      if (v !== null && v !== undefined && v !== '') merged[k] = v;
    }
    // The URL is authoritative for WHICH listing this is. The fiber may key on
    // a bare numeric id, and letting that through made the click-time identity
    // check fail against the URL and refuse the capture.
    merged.id = urlId;

    // Anything the fiber left empty, take from the page.
    const borrowed = [];
    for (const k of ['name', 'thumbnail', 'price', 'status']) {
      const missing =
        merged[k] === null || merged[k] === undefined || merged[k] === '';
      if (missing && scraped && scraped[k] !== null && scraped[k] !== '') {
        merged[k] = scraped[k];
        borrowed.push(k);
      }
    }

    // Degraded means the capture is actually WORSE, not merely sourced
    // differently: no name, or no price. Where those came from is irrelevant.
    const degraded = !merged.name || merged.price === null || merged.price === undefined;
    // Set both ways. This only ever set it TRUE, and the scraped read it
    // merges over always arrived true on a fiber site -- so every detail
    // capture was flagged degraded, including the clean ones.
    merged._viaFallback = degraded || (!!SITE.hasFiber && !stamped);
    // Recorded either way, so "why is this flagged" is answerable from the
    // panel instead of from another round of guessing.
    if (borrowed.length) merged._borrowed = borrowed;
    if (scan) merged._scanKeys = scan;
    return merged;
  }

  function decorateDetail() {
    const item = detailIdFromUrl() ? readDetailItem() : null;
    let bar = document.getElementById(BAR_ID);

    // Mercari is an SPA: navigating from a listing back to search leaves the
    // bar behind unless it is torn down when the stamp goes.
    if (!item) {
      bar?.remove();
      return;
    }

    if (!bar) {
      bar = document.createElement('button');
      bar.id = BAR_ID;
      bar.type = 'button';
      // Which corner is free differs per site, so the stylesheet needs to know
      // which site this is.
      bar.classList.add(`cc-site-${SITE.code}`);
      bar.addEventListener('click', onDetailClick);
      document.body.appendChild(bar);
    }
    syncDetailBar(bar, item);
  }

  function syncDetailBar(bar, item) {
    const on = captured.has(keyFor(item.id));
    // Two states only. There was a third, "(partial read)", which lit up
    // whenever any field came from reading the page instead of Mercari's
    // internal object -- including the photo, which is the same photo either
    // way. It warned about nothing, and four rounds went into tuning the
    // warning rather than the data. A capture missing its NAME or PRICE is a
    // real problem and shows up in the panel; everything else is noise.
    const label = on ? '✓ Captured' : '+ Capture';
    // Conditional writes only -- see syncDot. An unconditional textContent
    // assignment is a childList mutation, and the observer that calls this
    // watches for exactly that.
    if (bar.textContent !== label) bar.textContent = label;
    if (bar.classList.contains('cc-on') !== on) bar.classList.toggle('cc-on', on);
    if (bar.classList.contains('cc-error')) bar.classList.remove('cc-error');
  }

  async function onDetailClick(e) {
    e.preventDefault();
    e.stopPropagation();

    // Re-read at click time. The SPA can navigate between listings in place,
    // so anything read when the bar was created may describe a different card.
    const item = readDetailItem();
    const bar = document.getElementById(BAR_ID);
    if (!bar) return;
    if (!item || item.id !== detailIdFromUrl()) {
      bar.classList.add('cc-error');
      bar.textContent = 'Could not read this listing — reload';
      return;
    }

    const key = keyFor(item.id);
    if (captured.has(key)) {
      await send({ type: 'UNCAPTURE', key });
      captured.delete(key);
      syncDetailBar(bar, item);
      return;
    }

    const res = await send({
      type: 'CAPTURE',
      payload: {
        item,
        marketplace: SITE.code,
        currency: SITE.currency,
        listingUrl: urlForListing(item.id, null),
        pageUrl: location.href,
        searchQuery: null, // arrived at directly, not through a search
      },
    });
    if (!res) return; // orphaned, or the worker refused it
    captured.add(key);
    // The confirmation matters more here than on a tile: the whole workflow is
    // open a tab, capture, close it. Closing on an unconfirmed capture is how
    // a listing gets silently lost.
    syncDetailBar(bar, item);
  }

  function decorateAll() {
    document.querySelectorAll(SITE.tiles).forEach(decorate);
    decorateDetail();
  }

  let decoratePending = false;
  function scheduleDecorate() {
    if (decoratePending) return;
    decoratePending = true;
    requestAnimationFrame(() => {
      decoratePending = false;
      decorateAll();
    });
  }

  function syncAllDots() {
    document.querySelectorAll(SITE.tiles).forEach((anchor) => {
      const dot = anchor.querySelector(`:scope > .${DOT_CLASS}`);
      if (dot) syncDot(anchor, dot);
    });
    const bar = document.getElementById(BAR_ID);
    const di = detailIdFromUrl() ? readDetailItem() : null;
    if (bar && di) syncDetailBar(bar, di);
  }

  function removeOverlay() {
    document.querySelectorAll(`.${DOT_CLASS}`).forEach((d) => d.remove());
    document.getElementById(BAR_ID)?.remove();
  }

  // --- Activation ----------------------------------------------------------

  async function enable() {
    if (active) return;
    active = true;
    document.documentElement.classList.add('cc-active');

    const res = await send({ type: 'GET_KEYS' });
    captured = new Set(res?.keys || []);

    decorateAll();

    // Mercari renders results client-side and paginates in place, so tiles
    // arrive after load and after navigation within the SPA. href is watched
    // too: recycling an anchor onto a different listing may change only that
    // attribute, and a missed re-sync leaves a dot describing the wrong card.
    observer = new MutationObserver(scheduleDecorate);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      // data-cc-detail-item is watched so the bar appears once the page world
      // resolves the item, and is torn down on SPA navigation away from it.
      attributeFilter: ['href', 'data-cc-detail-item'],
    });

    document.addEventListener('keydown', onKeydown, true);
  }

  function disable() {
    if (!active) return;
    active = false;
    document.documentElement.classList.remove('cc-active');
    observer?.disconnect();
    observer = null;
    removeOverlay();
    document.removeEventListener('keydown', onKeydown, true);
  }

  // Esc is the escape hatch: one key and the page looks untouched again.
  function onKeydown(e) {
    if (e.key !== 'Escape' || !active) return;
    disable();
    send({ type: 'DEACTIVATE' });
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'ACTIVATION') {
      if (msg.active) enable();
      else disable();
    }
    if (msg.type === 'STORE_CHANGED' && active) {
      send({ type: 'GET_KEYS' }).then((res) => {
        if (!res) return;
        captured = new Set(res?.keys || []);
        syncAllDots();
      });
    }
  });

  // A reload of an already-active tab should come back up capturing.
  send({ type: 'IS_ACTIVE' }).then((res) => {
    if (res?.active) enable();
  });
})();
