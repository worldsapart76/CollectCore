// Runs in the PAGE world (manifest: "world": "MAIN"), which is the only place
// React's fiber is visible.
//
// Content scripts live in an isolated world and get a clean DOM wrapper, so
// `__reactFiber$…` expando properties set by page scripts are invisible to
// them. Reading the fiber therefore has to happen here, and the result is
// handed across the boundary as a `data-cc-item` attribute — DOM attributes are
// shared between worlds even though JS properties are not.
//
// This file must not use any chrome.* API: the page world has no access.

(() => {
  // Keep in step with SITES in content/capture.js.
  const TILES = {
    'www.mercari.com': 'a[href*="/item/m"]',
  };
  const TILE = TILES[location.hostname];
  if (!TILE) return; // not a React source we know how to read

  function itemFromFiber(anchor) {
    const fiberKey = Object.keys(anchor).find((k) =>
      k.startsWith('__reactFiber$')
    );
    if (!fiberKey) return null;
    let node = anchor[fiberKey];
    let hop = 0;
    while (node && hop < 30) {
      const item = node.memoizedProps?.item;
      if (item && typeof item === 'object' && item.id) return item;
      node = node.return;
      hop++;
    }
    return null;
  }

  function tryParse(json) {
    try {
      return JSON.parse(json);
    } catch {
      return null;
    }
  }

  // ── Detail page ────────────────────────────────────────────────────────────
  //
  // A listing's own page carries what tiles cannot: shippingPayerCode, the full
  // photo set, and the description. There is no result anchor to walk up from,
  // so the item is found by SHAPE instead of by position: scan the fiber tree
  // for any prop object whose id matches the one in the URL.
  //
  // Shape-matching rather than a fixed hop count on purpose. The detail page is
  // a different component tree from the search grid, and matching on identity
  // survives Mercari reorganising either one — there is nothing to re-measure.

  const DETAIL_ID_RE = /\/item\/(m\d+)/;

  function detailIdFromUrl() {
    return location.pathname.match(DETAIL_ID_RE)?.[1] || null;
  }

  function anyFiber() {
    // Any mounted element will do — every fiber can reach the root via .return.
    for (const el of document.querySelectorAll('div, main, section, span')) {
      const k = Object.keys(el).find((x) => x.startsWith('__reactFiber$'));
      if (k) return el[k];
    }
    return null;
  }

  function looksLikeItem(v, wantId) {
    return (
      v &&
      typeof v === 'object' &&
      v.id === wantId &&
      ('name' in v || 'price' in v || 'status' in v)
    );
  }

  // Bounded, cycle-safe walk. The cap matters: an unbounded fiber traversal on
  // a busy page is exactly the kind of thing that froze the tab once already.
  const MAX_NODES = 20000;

  function findDetailItem(wantId) {
    let root = anyFiber();
    if (!root) return null;
    while (root.return) root = root.return;

    const seen = new Set();
    const stack = [root];
    let visited = 0;

    while (stack.length && visited < MAX_NODES) {
      const node = stack.pop();
      if (!node || seen.has(node)) continue;
      seen.add(node);
      visited++;

      const props = node.memoizedProps;
      if (props && typeof props === 'object') {
        // The prop name differs between pages, so check the values rather than
        // guessing at `item`.
        for (const v of Object.values(props)) {
          if (looksLikeItem(v, wantId)) return v;
        }
        if (looksLikeItem(props, wantId)) return props;
      }
      if (node.child) stack.push(node.child);
      if (node.sibling) stack.push(node.sibling);
    }
    return null;
  }

  function stampDetail() {
    const wantId = detailIdFromUrl();
    if (!wantId) {
      if (document.body.dataset.ccDetailItem) delete document.body.dataset.ccDetailItem;
      return;
    }
    const stamped = document.body.dataset.ccDetailItem
      ? tryParse(document.body.dataset.ccDetailItem)?.id
      : null;
    if (stamped === wantId) return;

    const item = findDetailItem(wantId);
    if (!item) {
      // Nothing usable. Clear rather than leave a stamp describing the previous
      // listing -- Mercari is an SPA and navigates between items in place.
      if (stamped) delete document.body.dataset.ccDetailItem;
      return;
    }
    document.body.dataset.ccDetailItem = JSON.stringify({
      id: item.id,
      name: item.name ?? null,
      price: item.price ?? null,
      status: item.status ?? null,
      itemCondition: item.itemCondition ?? null,
      category: item.category ?? null,
      categoryId: item.categoryId ?? null,
      brand: item.brand ?? null,
      thumbnail: item.thumbnail ?? null,
      // The whole reason this surface exists -- all null in tiles.
      shippingPayerCode: item.shippingPayerCode ?? null,
      description: item.description ?? null,
      sellerId: item.seller?.id ?? item.sellerId ?? null,
      photos: Array.isArray(item.photos)
        ? item.photos.map((p) => (typeof p === 'string' ? p : p?.uri ?? null)).filter(Boolean)
        : null,
    });
  }

  function stamp() {
    // Dormant unless the content script has switched capture on, so ordinary
    // Mercari browsing does no work at all.
    if (!document.documentElement.classList.contains('cc-active')) return;

    for (const anchor of document.querySelectorAll(TILE)) {
      // A stamp is only valid while the anchor still points at the same
      // listing. React recycles these nodes, so a surviving stamp can describe
      // the item this tile used to show — re-stamp instead of skipping.
      const stampedId = anchor.dataset.ccItem
        ? tryParse(anchor.dataset.ccItem)?.id
        : null;
      const hrefId = (anchor.getAttribute('href') || '').match(/\/item\/(m\d+)/)?.[1];
      if (stampedId && stampedId === hrefId) continue;

      const item = itemFromFiber(anchor);
      if (!item) {
        // Stale stamp with nothing to replace it: clearing beats leaving a
        // wrong one in place, which the content script would happily capture.
        if (stampedId) delete anchor.dataset.ccItem;
        continue;
      }
      anchor.dataset.ccItem = JSON.stringify({
        id: item.id,
        name: item.name ?? null,
        price: item.price ?? null,
        status: item.status ?? null,
        itemCondition: item.itemCondition ?? null,
        category: item.category ?? null,
        categoryId: item.categoryId ?? null,
        brand: item.brand ?? null,
        thumbnail: item.thumbnail ?? null,
      });
    }

    // Detail pages also carry result tiles (related items), so both run.
    stampDetail();
  }

  // href is watched alongside childList so a recycled anchor gets re-stamped
  // even when only the link changed. data-cc-item is deliberately NOT watched:
  // stamping writes it, and observing it would retrigger this observer on its
  // own writes.
  let pending = false;
  function scheduleStamp() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      stamp();
    });
  }

  new MutationObserver(scheduleStamp).observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['href'],
  });

  // Re-stamp when capture is switched on, since nothing was stamped while
  // dormant.
  new MutationObserver(scheduleStamp).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class'],
  });

  stamp();
})();
