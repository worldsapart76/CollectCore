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

  // Mercari shows "Posted 08/27/26" and "Sold 20h ago" on a listing, so both
  // dates exist in the item object. Their FIELD NAMES are not known, and
  // guessing them wrong fails silently — a missing date looks the same as a
  // listing that has none.
  //
  // So collect by shape instead: any date-ish key carrying a plausible
  // timestamp. Mercari uses epoch SECONDS in places and milliseconds in
  // others, and the two differ by 1000x — treating one as the other yields
  // either 1970 or the year 55000, so the magnitude decides.
  //
  // Everything found is kept under its original key. Which one means "posted"
  // and which means "sold" is then read off real data instead of assumed.
  const DATE_KEY_RE = /(date|created|updated|published|posted|sold|expire|time)/i;

  function asIso(v) {
    if (typeof v === 'number' && Number.isFinite(v)) {
      // 1e11 sits between "seconds since 1970" (~1.7e9 today) and
      // "milliseconds" (~1.7e12), so it separates the two cleanly.
      const ms = v < 1e11 ? v * 1000 : v;
      const d = new Date(ms);
      const y = d.getUTCFullYear();
      return y >= 2000 && y <= 2100 ? d.toISOString() : null;
    }
    if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) {
      const d = new Date(v);
      return Number.isNaN(d.getTime()) ? null : d.toISOString();
    }
    return null;
  }

  function datesFrom(item) {
    const out = {};
    for (const [k, v] of Object.entries(item)) {
      if (!DATE_KEY_RE.test(k)) continue;
      const iso = asIso(v);
      if (iso) out[k] = iso;
    }
    return Object.keys(out).length ? out : null;
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

  // Several props on a detail page carry the right id while holding only a
  // fragment of the listing -- a price widget, a favourite button. Matching the
  // FIRST one produced a capture with a price and a status but no name and no
  // image, which is what shipped and had to be fixed.
  //
  // So candidates are scored by how much of the listing they actually carry and
  // the richest wins.
  const ITEM_KEYS = [
    'name', 'price', 'status', 'thumbnail', 'photos', 'itemCondition',
    'description', 'shippingPayerCode', 'brand', 'category', 'seller',
  ];

  function itemScore(v) {
    let n = 0;
    for (const k of ITEM_KEYS) {
      if (v[k] !== undefined && v[k] !== null && v[k] !== '') n++;
    }
    return n;
  }

  // Mercari's public id is 'm70832633154'; internal objects were observed
  // carrying only a fragment under that exact key, so the bare numeric form
  // and `itemId` are accepted too rather than assuming one spelling.
  function idVariants(wantId) {
    const bare = wantId.replace(/^m/, '');
    return new Set([wantId, bare, Number(bare)]);
  }

  function looksLikeItem(v, want) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
    const id = v.id ?? v.itemId;
    if (id === undefined || id === null) return false;
    if (!want.has(id) && !want.has(String(id))) return false;
    return ITEM_KEYS.some((k) => k in v);
  }

  // Bounded, cycle-safe walk. The cap matters: an unbounded fiber traversal on
  // a busy page is exactly the kind of thing that froze the tab once already.
  const MAX_NODES = 20000;

  // What the last scan found. Travels with the capture so a bad read is
  // diagnosable from the panel -- a page console full of Mercari's own errors
  // is not somewhere a diagnostic gets noticed.
  let lastScan = null;

  function findDetailItem(wantId) {
    let root = anyFiber();
    if (!root) return null;
    while (root.return) root = root.return;

    const seen = new Set();
    const stack = [root];
    let visited = 0;
    let best = null;
    let bestScore = 0;

    const want = idVariants(wantId);
    const seenCandidates = [];
    const consider = (v) => {
      if (!looksLikeItem(v, want)) return;
      seenCandidates.push(v);
      const score = itemScore(v);
      if (score > bestScore) {
        best = v;
        bestScore = score;
      }
    };

    while (stack.length && visited < MAX_NODES) {
      const node = stack.pop();
      if (!node || seen.has(node)) continue;
      seen.add(node);
      visited++;

      const props = node.memoizedProps;
      if (props && typeof props === 'object') {
        // The prop name differs between pages, so check the values rather than
        // guessing at `item`.
        for (const v of Object.values(props)) consider(v);
        consider(props);
      }
      if (node.child) stack.push(node.child);
      if (node.sibling) stack.push(node.sibling);
    }

    // Diagnostic. The detail page's real item object has not been located by
    // inspection, and a silent partial match is what produced a capture with a
    // price but no name. Printing what WAS found turns the next fix into a
    // reading rather than another guess.
    // Compose across candidates rather than picking one.
    //
    // Mercari spreads a listing over several objects: the richest carries name,
    // price, condition, shipping and the dates but NO photo, while a smaller
    // sibling carries photoUrl. Taking only the best-scoring object left the
    // image missing, which forced the DOM fallback and kept every detail
    // capture flagged as a partial read.
    //
    // Highest score wins any field it actually has; the rest fill gaps only.
    if (best) {
      const ranked = seenCandidates
        .map((c) => ({ c, score: itemScore(c) }))
        .sort((a, b) => b.score - a.score);
      const composite = {};
      for (const { c } of ranked) {
        for (const [k, v] of Object.entries(c)) {
          if (v === null || v === undefined || v === '') continue;
          if (composite[k] === undefined) composite[k] = v;
        }
      }
      best = composite;
      bestScore = itemScore(composite);
    }

    lastScan = {
      nodes: visited,
      candidates: seenCandidates.length,
      bestScore,
      keys: best ? Object.keys(best).slice(0, 30) : [],
      // Keys of the runner-up candidates, which is what says where the real
      // object might be hiding.
      others: seenCandidates.slice(0, 4).map((c) => Object.keys(c).slice(0, 20)),
    };
    try {
      console.warn(
        '[CollectCore] detail fiber scan:',
        {
          wantId,
          nodesVisited: visited,
          candidates: seenCandidates.length,
          bestScore,
          bestKeys: best ? Object.keys(best).slice(0, 40) : null,
        },
        seenCandidates.slice(0, 5).map((c) => Object.keys(c).slice(0, 25))
      );
    } catch {
      /* console unavailable — never let diagnostics break capture */
    }
    return best;
  }

  // Mercari's own field names, read off a real detail page 2026-08-29 via the
  // scan diagnostic. They differ from the search tile's in four places, which
  // is why the first detail captures came out unnamed and image-less:
  //
  //   tile            detail page
  //   id           -> itemId
  //   thumbnail    -> photoUrl
  //   (absent)     -> shippingPayer      (NOT shippingPayerCode)
  //   itemCondition is an OBJECT here, not a string
  //
  // Normalising here means nothing downstream has to know any of that.
  function textOf(v) {
    if (v === null || v === undefined) return null;
    if (typeof v === 'string') return v || null;
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    // { id, name } shapes — condition, brand, category all arrive this way.
    return v.name ?? v.label ?? v.title ?? null;
  }

  function photoList(item) {
    const raw = item.photos || item.imageUrls || item.images;
    if (Array.isArray(raw) && raw.length) {
      const urls = raw
        .map((p) =>
          typeof p === 'string' ? p : p?.uri ?? p?.url ?? p?.thumbnail ?? null
        )
        .filter(Boolean);
      if (urls.length) return urls;
    }
    // Detail pages carry a single photoUrl rather than a list.
    const one = item.photoUrl || item.thumbnail;
    return one ? [one] : null;
  }

  function normalize(item, id) {
    const photos = photoList(item);
    return {
      id,
      name: textOf(item.name),
      price: item.price ?? null,
      status: textOf(item.status),
      itemCondition: textOf(item.itemCondition),
      category: textOf(item.itemCategory ?? item.category),
      categoryId: item.categoryId ?? item.itemCategory?.id ?? null,
      brand: textOf(item.brand),
      thumbnail: item.photoUrl ?? item.thumbnail ?? photos?.[0] ?? null,
      // shippingPayer on a detail page; the tile's spelling kept as a fallback.
      shippingPayerCode: textOf(item.shippingPayer ?? item.shippingPayerCode),
      shippingMethod: textOf(item.shippingMethod),
      shippingFromArea: textOf(item.shippingFromArea),
      description: textOf(item.description),
      sellerId: textOf(item.seller?.id ?? item.sellerId),
      numLikes: item.numLikes ?? null,
      photos,
      dates: datesFrom(item),
      _scanKeys: lastScan,
    };
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
      // Nothing usable from the fiber. The content script's DOM fallback still
      // produces a capture, so publish the scan result for it rather than
      // leaving no trace of why the fiber came up empty.
      document.body.dataset.ccDetailScan = JSON.stringify(lastScan || {});
      if (stamped) delete document.body.dataset.ccDetailItem;
      return;
    }
    document.body.dataset.ccDetailItem = JSON.stringify(normalize(item, wantId));
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
        dates: datesFrom(item),
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
