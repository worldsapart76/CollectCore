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

  function stamp() {
    // Dormant unless the content script has switched capture on, so ordinary
    // Mercari browsing does no work at all.
    if (!document.documentElement.classList.contains('cc-active')) return;

    for (const anchor of document.querySelectorAll(TILE)) {
      if (anchor.dataset.ccItem) continue;
      const item = itemFromFiber(anchor);
      if (!item) continue;
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
  }

  // childList only — stamping writes attributes, and observing those too would
  // retrigger this observer on its own writes.
  new MutationObserver(stamp).observe(document.body, {
    childList: true,
    subtree: true,
  });

  // Re-stamp when capture is switched on, since nothing was stamped while
  // dormant.
  new MutationObserver(stamp).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class'],
  });

  stamp();
})();
