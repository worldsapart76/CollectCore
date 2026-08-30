// Content script: reads listing data off React's fiber and draws capture dots.
//
// Standalone by necessity — manifest-declared content scripts cannot use ES
// module imports, so everything this needs lives in this file.
//
// Renders NOTHING until activated (plan doc -> Dormant by default).

(() => {
  // Supported sources, keyed by hostname.
  //
  // ADDING A SITE: add an entry here and add its host to `matches` in the
  // capture.js content_scripts block in manifest.json. Only a React site needs
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
      // The listing name is a heading in the left column. It is NOT the h1,
      // the og:title or the document title — all three say "Item Details",
      // Neokyo's generic page name, which is how every capture ended up filed
      // under it. Headings are read in DOM order and the page's own section
      // headings are rejected by name, since they are fixed furniture.
      titleScope: [
        '[class*="product-title"]',
        '[class*="item-title"]',
        'h1',
        'h2',
        'h3',
      ],
      titleReject:
        /^(item details|item price|purchase request|new user guide|categories)\b/i,
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

    // Not built yet — see docs/photocard_market_intel_plan.md:
    //   pocamarket  (KRW)
    //   ebay        (USD)
  };

  const SITE = SITES[location.hostname] || SITES[location.hostname.replace(/^www\./, '')];
  if (!SITE) return; // not a supported source; stay entirely inert

  // --- Site helpers --------------------------------------------------------

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
    return raw
      .replace(/[¥￥$]\s?[\d,]+(?:\.\d{2})?/g, ' ')
      .replace(/[\d,]+\s*円/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
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
  const TITLE_SOURCES = {
    // Headings in DOM order, minus the page's own fixed furniture. Querying
    // every selector at once rather than in turn is deliberate: DOM order is
    // the signal — a listing's name is rendered before the panels beside it —
    // and taking selectors in turn would override that with my guess about
    // which class name is most likely to exist.
    scope: () => {
      if (!SITE.titleScope) return null;
      for (const el of document.querySelectorAll(SITE.titleScope.join(','))) {
        const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
        if (t.length < 3 || t.length > 200) continue;
        if (SITE.titleReject?.test(t)) continue;
        return t;
      }
      return null;
    },
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
        .replace(/\s*[|\-–]\s*(Mercari|Neokyo)[^|\-–]*$/i, '')
        .trim(),
  };

  // Which source the last title came from. Recorded because "the title is
  // wrong" and "the title came from the wrong place" are the same bug, and
  // knowing which source won says immediately which one to fix.
  let lastTitleSource = null;

  function detailTitle() {
    for (const key of SITE.titleOrder || ['h1', 'og', 'doc']) {
      const t = TITLE_SOURCES[key]?.();
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
