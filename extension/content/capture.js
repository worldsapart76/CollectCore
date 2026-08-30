// Content script: reads listing data off React's fiber and draws capture dots.
//
// Standalone by necessity — manifest-declared content scripts cannot use ES
// module imports, so everything this needs lives in this file.
//
// Renders NOTHING until activated (plan doc -> Dormant by default).

(() => {
  // Supported sources, keyed by hostname.
  //
  // ADDING A SITE: add an entry here, add its host to `matches` in both
  // content_scripts blocks in manifest.json, and add the same selector to
  // content/fiber.js. If the site is not React, fiber.js finds nothing and the
  // DOM fallback in this file carries it — which is why `price` has to be
  // extractable from the tile.
  //
  // Content scripts cannot import modules, so this registry lives inline
  // rather than in lib/. Keep it in step with lkup_mkt_marketplaces.
  const SITES = {
    'www.mercari.com': {
      code: 'mercari_us',
      currency: 'USD',
      tiles: 'a[href*="/item/m"]',
      idFrom: (href) => href.match(/\/item\/(m\d+)/)?.[1] || null,
      urlFor: (id) => `https://www.mercari.com/us/item/${id}/`,
      queryParam: 'keyword',
    },
    // Not built yet — see docs/photocard_market_intel_plan.md:
    //   neokyo      (JPY, buy side, server-rendered so no fiber read)
    //   pocamarket  (KRW)
    //   ebay        (USD)
  };

  const SITE = SITES[location.hostname];
  if (!SITE) return; // not a supported source; stay entirely inert

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
  function itemFromDom(anchor) {
    const id = idFromHref(anchor);
    if (!id) return null;
    const text = anchor.textContent || '';
    const dollars = text.match(/\$\s?([\d,]+(?:\.\d{2})?)/)?.[1];
    return {
      id,
      name: anchor.querySelector('img')?.getAttribute('alt') || '',
      price: dollars ? Math.round(parseFloat(dollars.replace(/,/g, '')) * 100) : null,
      status: /\bsold\b/i.test(text) ? 'trading' : 'on_sale',
      thumbnail: anchor.querySelector('img')?.src || null,
      itemCondition: null,
      category: null,
      categoryId: null,
      brand: null,
      _viaFallback: true,
    };
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
        listingUrl: SITE.urlFor(id),
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
  function detailTitle() {
    // h1 first, but never rely on it alone -- Mercari does not guarantee one
    // and it can render after the button is wanted. document.title always
    // exists and carries the listing name, so the chain always terminates.
    const h1 = document.querySelector('h1')?.textContent?.trim();
    if (h1) return h1;
    const og = document
      .querySelector('meta[property="og:title"]')
      ?.getAttribute('content')
      ?.trim();
    if (og) return og;
    return (document.title || '').replace(/\s*[|\-–]\s*Mercari.*$/i, '').trim();
  }

  function detailPhoto() {
    // Largest Mercari-CDN photo, EXCEPT that a not-yet-decoded image reports
    // zero dimensions -- so the first match is taken as a baseline and only
    // replaced by something measurably bigger. Requiring area > 0 to win is
    // what left the button unrendered on pages whose photos had not loaded.
    let best = null;
    let bestArea = -1;
    for (const img of document.querySelectorAll('img')) {
      const src = img.currentSrc || img.src || '';
      if (!/mercdn\.net\/photos\//.test(src)) continue;
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
    // so the FIRST match is what the item actually costs.
    const dollars = body.match(/\$\s?([\d,]+(?:\.\d{2})?)/)?.[1];
    const sold = /\bitem sold\b|\bsold\s+\d+\s*(h|m|d|hour|min|day)/i.test(body);

    // Being on a listing URL is enough to offer a capture. Bailing out when the
    // title or photo could not be read is what made the button vanish
    // entirely, which is far worse than a capture that needs a name later.
    return {
      id,
      name: detailTitle(),
      price: dollars ? Math.round(parseFloat(dollars.replace(/,/g, '')) * 100) : null,
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
      _viaFallback: true,
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

    const merged = { ...(scraped || {}), ...(stamped || {}) };
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

    // Only a borrowed NAME or PRICE is a degraded read. A thumbnail taken from
    // the page's own img tag is the same photo by another route, and flagging
    // the whole capture over it made every detail capture look degraded while
    // its actual data was complete.
    const degraded = !stamped || borrowed.some((k) => k === 'name' || k === 'price');
    if (degraded) merged._viaFallback = true;
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
      bar.addEventListener('click', onDetailClick);
      document.body.appendChild(bar);
    }
    syncDetailBar(bar, item);
  }

  function syncDetailBar(bar, item) {
    const on = captured.has(keyFor(item.id));
    const label = on
      ? '✓ Captured'
      : item._viaFallback
        ? '+ Capture (partial read)'
        : '+ Capture';
    // "partial read" now means the NAME or PRICE came from the page rather
    // than the item object -- a borrowed thumbnail is the same photo by
    // another route and no longer counts.
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
        listingUrl: SITE.urlFor(item.id),
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

  function detailIdFromUrl() {
    return location.pathname.match(/\/item\/(m\d+)/)?.[1] || null;
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
