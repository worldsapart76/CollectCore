// Serves captured listing images to the CollectCore app.
//
// ## Why this exists
//
// `mkt_listing.thumbnail_url` is a hotlink to the marketplace's own CDN, and
// the marketplace drops the photo when the listing closes. So every historical
// comp and every lot eventually renders as a blank square — worst on the rows
// that need the picture most, because a Japanese title tells you nothing about
// which card it is.
//
// The bytes already exist: the extension fetches a 640px copy at capture and
// keeps it in IndexedDB. They were simply unreachable from the app, which runs
// on a different origin. This bridge closes that gap without hosting anything.
//
// ## Why a content script rather than `externally_connectable`
//
// Messaging the extension directly from page JS requires the page to know the
// extension's id, and an unpacked extension's id changes whenever the folder
// moves. Pinning it means generating a manifest `key`, which is a packaging
// step this extension deliberately does not have (see extension/README.md —
// there is no build). A content script has no id to know.
//
// It also buys the blob: URL. `chrome.runtime` messaging serialises as JSON, so
// a Blob cannot cross it and the worker sends a data: URL instead. Rebuilding
// the blob HERE means the page gets a `blob:https://collectcoreapp.com/...`
// URL — a short string — instead of ~107KB of base64 per row sitting in React
// state and in the DOM.

(() => {
  const TAG = '__collectcore';
  const origin = window.location.origin;

  // Presence flag. The app checks this to decide whether to bother asking —
  // without it, every listing row on a machine with no extension would wait on
  // a reply that is never coming before falling back to the hotlink.
  //
  // On documentElement rather than a window property because the page's own JS
  // lives in a different world and cannot see variables set here.
  document.documentElement.setAttribute('data-collectcore-ext', '1');

  // key -> blob: URL. Held for the page's lifetime: these are small strings,
  // the same listing is asked for repeatedly as the user moves between tabs and
  // overlays, and revoking one that a React element still points at turns a
  // working thumbnail into a broken one.
  const urls = new Map();

  // key -> true, for keys the worker has already said it does not hold. Without
  // this, a listing captured before images were kept is re-requested on every
  // render for the rest of the session.
  const missing = new Set();

  async function resolve(keys) {
    const out = {};
    const ask = [];
    for (const key of keys) {
      if (urls.has(key)) out[key] = urls.get(key);
      else if (!missing.has(key)) ask.push(key);
    }
    if (!ask.length) return out;

    let res;
    try {
      res = await chrome.runtime.sendMessage({ type: 'GET_IMAGES', keys: ask });
    } catch {
      // Extension reloaded out from under this page. The app falls back to the
      // hotlink on its own; nothing here needs to shout about it.
      return out;
    }

    for (const key of ask) {
      const dataUrl = res?.images?.[key];
      if (!dataUrl) {
        missing.add(key);
        continue;
      }
      try {
        const blob = await (await fetch(dataUrl)).blob();
        const url = URL.createObjectURL(blob);
        urls.set(key, url);
        out[key] = url;
      } catch {
        missing.add(key);
      }
    }
    return out;
  }

  window.addEventListener('message', async (event) => {
    // Same-page, same-origin only. This bridge hands out nothing sensitive —
    // photos of listings the user captured themselves — but a message channel
    // that answers anyone is still a bad habit to leave lying around.
    if (event.source !== window || event.origin !== origin) return;
    const msg = event.data;
    if (!msg || msg[TAG] !== 'req' || typeof msg.id !== 'number') return;

    if (msg.kind === 'ping') {
      window.postMessage({ [TAG]: 'res', id: msg.id, ready: true }, origin);
      return;
    }
    if (msg.kind !== 'images') return;

    const images = await resolve(
      Array.isArray(msg.keys) ? msg.keys.slice(0, 200) : []
    );
    window.postMessage({ [TAG]: 'res', id: msg.id, images }, origin);
  });
})();
