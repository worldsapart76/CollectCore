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
    if (anchor.querySelector(`:scope > .${DOT_CLASS}`)) return;
    // Only the id is needed to draw the dot. The item payload is read at click
    // time instead, which sidesteps a race with the page-world script that
    // stamps it — the dot can appear before the stamp lands.
    const id = idFromHref(anchor);
    if (!id) return;

    // Anchors are usually statically positioned; the dot needs a containing
    // block. Only touch it when it would otherwise escape the tile.
    if (getComputedStyle(anchor).position === 'static') {
      anchor.style.position = 'relative';
    }

    const dot = document.createElement('button');
    dot.type = 'button';
    dot.className = DOT_CLASS;
    dot.dataset.ccId = id;
    dot.title = 'Capture to CollectCore';
    syncDot(dot);

    dot.addEventListener('click', async (e) => {
      // The dot lives inside the listing anchor — without this, capturing
      // navigates away from the search results.
      e.preventDefault();
      e.stopPropagation();

      const key = keyFor(id);
      if (captured.has(key)) {
        await send({ type: 'UNCAPTURE', key });
        captured.delete(key);
        syncDot(dot);
        return;
      }

      const item = readItem(anchor);
      if (!item) {
        dot.classList.add('cc-error');
        dot.title = 'Could not read this listing';
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
      syncDot(dot);
    });

    anchor.appendChild(dot);
  }

  function syncDot(dot) {
    const on = captured.has(keyFor(dot.dataset.ccId));
    dot.classList.toggle('cc-on', on);
    dot.textContent = on ? '✓' : '+';
  }

  function decorateAll() {
    document.querySelectorAll(SITE.tiles).forEach(decorate);
  }

  function syncAllDots() {
    document.querySelectorAll(`.${DOT_CLASS}`).forEach(syncDot);
  }

  function removeOverlay() {
    document.querySelectorAll(`.${DOT_CLASS}`).forEach((d) => d.remove());
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
    // arrive after load and after navigation within the SPA.
    observer = new MutationObserver(() => decorateAll());
    observer.observe(document.body, { childList: true, subtree: true });

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
