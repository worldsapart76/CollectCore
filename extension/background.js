// Service worker: activation state, capture writes, image fetching.
//
// Activation is PER TAB and defaults to OFF (plan doc -> Dormant by default).
// State lives in chrome.storage.session because MV3 workers are ephemeral —
// they terminate after ~30s idle and must rehydrate from storage, not memory.

import {
  obsKey,
  getObservation,
  putObservation,
  deleteObservation,
  allObservations,
  allKeys,
  putImage,
  clearAll,
} from './lib/db.js';

// Hosts the capture content script runs on. Must stay in step with `matches`
// in manifest.json -- a host listed there but missing here loads the script and
// then never gets told the session is active, so the page comes up with no
// buttons and nothing says why.
const CAPTURE_HOSTS =
  /^https:\/\/(www\.)?(mercari\.com|neokyo\.com|ebay\.com|pocamarket\.com)\//;

const ACTIVE_TABS = 'activeTabs';
const ARMED_CARD = 'armedCard';
const CAPTURE_ON = 'captureOn';

// Capture was activated PER TAB, which quietly broke the workflow the detail
// page exists for: open a handful of listings in tabs, capture the good ones,
// close them. Every one of those tabs came up dormant with no button, and
// nothing said why.
//
// So activation is a session-wide MODE. Dormant-by-default is unchanged --
// nothing happens until the toolbar icon is clicked once -- but after that any
// Mercari tab opened during the session comes up capturing, and Esc or closing
// the panel turns the whole session off.
let captureOn = false;

// Mirror of the persisted set, readable SYNCHRONOUSLY.
//
// chrome.sidePanel.open() only works while the user gesture is still live, and
// any `await` before it ends that window — so the click handler cannot afford
// an async storage read before deciding what to do. Storage remains the durable
// copy; this is the copy the gesture path is allowed to consult.
const activeTabs = new Set();

async function hydrate() {
  const got = await chrome.storage.session.get([ACTIVE_TABS, CAPTURE_ON]);
  for (const id of got[ACTIVE_TABS] || []) activeTabs.add(id);
  captureOn = !!got[CAPTURE_ON];
}
hydrate();
chrome.runtime.onStartup.addListener(hydrate);

// Mercari thumbnails carry their own dimensions in the query string, so a
// bigger image is free. 200px is unusable for comparing photocard versions.
const IMAGE_WIDTH = 640;

async function setActive(tabId, active) {
  if (active) activeTabs.add(tabId);
  else activeTabs.delete(tabId);
  await chrome.storage.session.set({ [ACTIVE_TABS]: [...activeTabs] });
  await paintBadge(tabId, active);
  return active;
}

async function setCaptureMode(on) {
  captureOn = on;
  await chrome.storage.session.set({ [CAPTURE_ON]: on });
}

function isActive(tabId) {
  return captureOn || activeTabs.has(tabId);
}

async function paintBadge(tabId, active) {
  try {
    await chrome.action.setBadgeText({ tabId, text: active ? 'ON' : '' });
    await chrome.action.setBadgeBackgroundColor({ tabId, color: '#1f9d55' });
  } catch {
    // Tab closed mid-flight; nothing to paint.
  }
}

async function tellTab(tabId, message) {
  try {
    await chrome.tabs.sendMessage(tabId, message);
  } catch {
    // No content script on this page (wrong host, or not loaded yet).
  }
}

// --- Activation ------------------------------------------------------------

// Let Chrome open the panel itself on toolbar click.
//
// Calling sidePanel.open() from an onClicked listener is a losing battle: it
// requires a live user gesture, and any await — or merely the worker being
// woken by the click — can end that window, leaving the icon apparently dead.
// With this behavior set, Chrome opens the panel natively and
// chrome.action.onClicked never fires at all.
function enablePanelOnActionClick() {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((err) => console.error('[CollectCore] setPanelBehavior:', err));
}
enablePanelOnActionClick();
chrome.runtime.onInstalled.addListener(enablePanelOnActionClick);
chrome.runtime.onStartup.addListener(enablePanelOnActionClick);

async function deactivate(tabId) {
  await setActive(tabId, false);
  await tellTab(tabId, { type: 'ACTIVATION', active: false });
}

// Closing the panel is what "Esc" ultimately means, and there is no close API.
// Disabling it for the tab closes it; re-enabling immediately after re-arms the
// toolbar icon, which would otherwise do nothing on this tab next time.
async function closePanel(tabId) {
  try {
    await chrome.sidePanel.setOptions({ tabId, enabled: false });
    await chrome.sidePanel.setOptions({
      tabId,
      path: 'panel/panel.html',
      enabled: true,
    });
  } catch {
    // Tab gone.
  }
}

// The panel holds a long-lived port purely so its lifetime is observable:
// connect = capture on, disconnect (panel closed) = capture off. This is what
// makes "the panel is the switch" literally true rather than a convention.
// A tab that navigates or opens while the mode is on gets told directly, so it
// does not depend on the content script winning a race with the page.
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status !== 'complete' || !captureOn) return;
  if (!CAPTURE_HOSTS.test(tab.url || '')) return;
  setActive(tabId, true).then(() =>
    tellTab(tabId, { type: 'ACTIVATION', active: true })
  );
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'panel') return;
  let boundTab = null;

  port.onMessage.addListener(async (msg) => {
    if (msg.type !== 'PANEL_INIT' || !msg.tabId) return;
    // Opening the panel switches capture on for the SESSION, not just for the
    // tab it was opened from. The workflow is a run of listings across several
    // tabs, and requiring the icon per tab meant most of them had no button.
    boundTab = msg.tabId;
    await setCaptureMode(true);
    await setActive(boundTab, true);
    await tellTab(boundTab, { type: 'ACTIVATION', active: true });
  });

  port.onDisconnect.addListener(() => {
    // Closing the panel ends the session everywhere, so no tab is left
    // quietly capturing after the switch is off.
    setCaptureMode(false);
    for (const id of [...activeTabs]) deactivate(id);
    if (boundTab) deactivate(boundTab);
  });
});

// A tab that navigates away or reloads goes dormant again. Capture sessions
// are deliberately short-lived; nothing should linger into unrelated browsing.
chrome.tabs.onRemoved.addListener((tabId) => setActive(tabId, false));
chrome.tabs.onUpdated.addListener(async (tabId, info) => {
  if (info.status === 'loading' && isActive(tabId)) {
    await tellTab(tabId, { type: 'ACTIVATION', active: true });
  }
});

// --- Armed card ------------------------------------------------------------

// Mode 2: a card is set, and every tile click seeds line 1 with it. Session
// storage, not memory — the worker dies between clicks.
async function getArmed() {
  const got = await chrome.storage.session.get(ARMED_CARD);
  return got[ARMED_CARD] || null;
}

async function setArmed(card) {
  if (card) await chrome.storage.session.set({ [ARMED_CARD]: card });
  else await chrome.storage.session.remove(ARMED_CARD);
  return card || null;
}

// --- Capture ---------------------------------------------------------------

// Mercari sizes its thumbnails from the query string, so a bigger one is free.
// That is a Mercari CDN behaviour, not a general one -- Rakuma's img.fril.jp
// serves Neokyo's images and an unknown `width` param there is at best ignored
// and at worst a cache miss or a 404. So the rewrite is scoped to the CDN it
// was learned from and every other host is left exactly as found.
function bigThumb(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    // eBay sizes in the FILENAME, not the query string: s-l225.jpg is the
    // search thumbnail and s-l500.jpg the same image larger. Same idea as
    // Mercari's `width`, a different mechanism, so it gets its own branch
    // rather than a shared one that would be wrong on both.
    if (/(^|\.)ebayimg\.com$/.test(u.hostname)) {
      u.pathname = u.pathname.replace(/\/s-l\d+(\.\w+)$/, '/s-l500$1');
      return u.toString();
    }
    if (!/mercdn\.net$/.test(u.hostname)) return url;
    u.searchParams.set('width', String(IMAGE_WIDTH));
    u.searchParams.delete('height');
    return u.toString();
  } catch {
    return url;
  }
}

// Capture is a one-shot opportunity: the CDN URL is dead once the listing
// closes, so the bytes are stored now rather than hotlinked later.
async function cacheImage(key, url) {
  const src = bigThumb(url);
  if (!src) return;
  try {
    const res = await fetch(src);
    if (!res.ok) return;
    await putImage(key, await res.blob());
  } catch {
    // A missing thumbnail must never fail the capture itself.
  }
}

// `status` is the source of truth for state, never which filter was running —
// the default Mercari search mixes `trading` (sold) rows in with `on_sale`.
// Anything-not-'on_sale' means sold was safe while tiles were the only source.
// It is not safe now: a detail page may spell the status differently, and that
// default turns every unrecognised value into a FAKE SALE -- the one kind of
// bad row that quietly drags a card's sold median around.
//
// So both ends are matched explicitly and the fallback is 'active', which at
// worst adds an ask to a panel the comp view already treats as the weaker
// evidence. rawStatus is stored alongside, so an unknown vocabulary shows up
// in the data instead of being silently absorbed.
function listingState(status) {
  const s = String(status || '').toLowerCase();
  if (/sold|trading|closed|completed/.test(s)) return 'sold';
  if (/on_sale|onsale|active|available|listed/.test(s)) return 'active';
  return 'active';
}

// Titles are the only bundle signal available at sweep time. A miss here is
// recoverable; a lot silently recorded as a single card is not.
const LOT_SIGNALS = [
  /\bbundle\b/i,
  /\blots?\b/i,
  /\bsets?\b/i,
  /\bbulk\b/i,
  /\bpc'?s\b/i,
  /\d+\s*(cards?|pcs?|photocards?)\b/i,
  /まとめ売り/,
  /まとめ/,
  /セット/,
  /\d+\s*枚/,
];

function looksLikeLot(name) {
  return LOT_SIGNALS.some((re) => re.test(name || ''));
}

async function capture({
  item,
  pageUrl,
  searchQuery,
  marketplace,
  currency,
  listingUrl,
}) {
  const armed = await getArmed();
  const key = obsKey(marketplace, item.id);
  const existing = await getObservation(key);

  const sighting = {
    // The sale's OWN date where the page states one -- eBay prints it on both
    // the tile and the listing page. A sold search returns months of sales in
    // one sweep, and stamping them all with the capture time would make a
    // March sale read as a day old, which is precisely what the grid's
    // staleness colouring keys on. Capture time is the fallback, not the rule.
    //
    // It also makes re-capture idempotent where capture time is not: the
    // server keys sightings on (listing, observed_at), so a fixed sale date
    // lands on the same row twice while a moving clock creates a second one.
    observedAt: item.soldAt || new Date().toISOString(),
    // Native MINOR units, whatever the currency: cents on Mercari, whole yen
    // on Neokyo. The name predates the second currency; the server reads it
    // through the currency's own exponent, so ¥350 must arrive as 350.
    priceCents: item.price,
    // The marketplace's own USD conversion, where it publishes one alongside
    // the native price. Recording it means that sighting needs no looked-up
    // rate at all, and the rate it implies is the one actually charged rather
    // than a daily average. Null when the page was already showing USD -- then
    // the price IS the USD figure and repeating it here would be a conversion
    // of nothing.
    priceUsd: item.priceUsd ?? null,
    // What the listing itself said postage costs, same currency and minor
    // units as priceCents. null is "not read", 0 is "free shipping" -- the
    // server treats them differently and conflating them understates cost.
    shippingCents: item.shipping ?? null,
    listingState: listingState(item.status),
    rawStatus: item.status,
  };

  if (existing) {
    // Same listing seen again — append a sighting rather than duplicating.
    existing.sightings.push(sighting);
    existing.priceCents = item.price;
    existing.listingState = sighting.listingState;
    existing.rawStatus = item.status;

    // A detail capture following a tile capture is the common path -- sweep a
    // page, then open the interesting ones. Without this the richer fields
    // would be silently dropped on exactly that path, which is the one that
    // matters. Upgrade-only: never let a later sweep null out detail data.
    if (item.shippingPayerCode !== undefined) {
      existing.captureTier = 'detail';
      existing.shippingPayerCode = item.shippingPayerCode ?? null;
      if (item.description) existing.description = item.description;
      if (item.sellerId != null) existing.sellerId = item.sellerId;
      if (item.photos?.length) existing.photos = item.photos;
      // A detail read is the best name available, so on this path it wins
      // outright rather than only filling a blank. Filling-only cannot repair
      // a name that is present but WRONG -- every Neokyo capture came in as
      // "Item Details", the page's section heading, and re-capturing left it
      // exactly as it was. Re-capturing is the obvious way to fix a bad row;
      // it should actually fix it.
      if (item.name) existing.name = item.name;
    }
    if (item.itemCondition && !existing.itemCondition) {
      existing.itemCondition = item.itemCondition;
    }
    // Repair, not just enrich. A record captured while the reader was broken
    // holds an empty name and no image, and nothing here used to touch either
    // -- so re-capturing the same listing left the bad row exactly as it was
    // and the only fix was deleting it by hand. Fill anything missing, and
    // let a real name replace a placeholder.
    if (item.name && !existing.name) existing.name = item.name;
    if (item.thumbnail && !existing.thumbnailUrl) {
      existing.thumbnailUrl = bigThumb(item.thumbnail);
      await cacheImage(key, item.thumbnail);
    }
    // Once a clean read lands, stop calling the record degraded.
    if (existing.viaFallback && !item._viaFallback) existing.viaFallback = false;
    if (item._scanKeys) existing.scanKeys = item._scanKeys;
    if (item._domScan) existing.domScan = item._domScan;
    // A re-read is the newer truth about what the page shows, currency
    // included. Sightings within one record share its currency, so a display
    // currency switched mid-session would mix them -- possible, not worth
    // modelling until it happens.
    if (item.currency) existing.currency = item.currency;
    existing.borrowed = item._borrowed || null;
    if (item.dates) existing.dates = { ...(existing.dates || {}), ...item.dates };
    // Re-seen means changed: a price move or a sale is exactly what a second
    // sighting records, so this needs pushing again.
    existing.syncedAt = null;

    await putObservation(existing);
    return { key, deduped: true, record: existing };
  }

  const record = {
    key,
    marketplace,
    externalId: item.id,
    // Built by the content script from its own site config — this worker
    // should not know any marketplace's URL shape.
    listingUrl: listingUrl || null,
    name: item.name || '',
    priceCents: item.price,
    // What the PAGE was showing, falling back to the marketplace's declared
    // currency. A site with a currency selector displays whatever the user set
    // it to -- Neokyo with it on USD carries no yen at all -- so taking the
    // marketplace's nominal currency on faith recorded a dollar figure as yen.
    currency: item.currency || currency || 'USD',
    rawStatus: item.status,
    listingState: sighting.listingState,
    itemCondition: item.itemCondition || null,
    category: item.category || null,
    categoryId: item.categoryId ?? null,
    brand: item.brand || null,
    thumbnailUrl: bigThumb(item.thumbnail),
    searchQuery: searchQuery || null,
    pageUrl: pageUrl || null,
    capturedAt: new Date().toISOString(),
    // 'detail' when the capture came from the listing's own page, which is the
    // only place these three exist -- tiles return null/empty for all of them.
    captureTier: item.shippingPayerCode !== undefined ? 'detail' : 'sweep',
    shippingPayerCode: item.shippingPayerCode ?? null,
    description: item.description || null,
    sellerId: item.sellerId ?? null,
    photos: item.photos || null,
    // Date-ish fields found on the item, under their original keys. Which one
    // means posted and which means sold is decided from real captures, not
    // guessed here — see datesFrom() in content/fiber.js.
    dates: item.dates || null,
    // What the detail fiber scan actually found, so a bad read can be
    // diagnosed from the panel instead of from a noisy page console.
    scanKeys: item._scanKeys || null,
    // The same, for a site with no fiber: what text the price was read from
    // and which title candidates the page offered.
    domScan: item._domScan || null,
    // Which fields the page had to supply because the fiber lacked them.
    borrowed: item._borrowed || null,
    // Set by the panel after a successful sync. Until then a record is the
    // only copy that exists, which is why Clear is destructive.
    syncedAt: null,
    // True when the page-world fiber read failed and the DOM tile scrape
    // carried the capture. Surfaced in the panel: a silent degrade here is
    // exactly how bad data got collected once already.
    viaFallback: !!item._viaFallback,
    // Every armed click captures as single; bundle-signal titles get routed to
    // a Confirm lots list rather than branching the fast path at click time.
    isLot: false,
    suspectedLot: looksLikeLot(item.name),
    // An armed click means the listing CONTAINS the card, not that it IS the
    // card — so this is line 1, not the whole story. A bundle keeps the
    // association and gains its other lines later.
    lines: armed
      ? [{ lineType: 'card', cardId: armed.id, label: armed.label, qty: 1 }]
      : [],
    sightings: [sighting],
  };

  await putObservation(record);
  await cacheImage(key, item.thumbnail);
  return { key, deduped: false, record };
}

// Store changes have to reach BOTH audiences, and they need different APIs:
// chrome.runtime.sendMessage only reaches extension pages (the panel), never
// content scripts — those require chrome.tabs.sendMessage per tab. Missing the
// second half is why cleared captures left green checkmarks on the page.
function broadcastStoreChanged() {
  chrome.runtime.sendMessage({ type: 'STORE_CHANGED' }).catch(() => {});
  for (const tabId of activeTabs) {
    tellTab(tabId, { type: 'STORE_CHANGED' });
  }
}

// --- Messaging -------------------------------------------------------------

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    switch (msg.type) {
      case 'CAPTURE': {
        const result = await capture(msg.payload);
        broadcastStoreChanged();
        sendResponse({ ok: true, ...result });
        break;
      }
      case 'UNCAPTURE': {
        await deleteObservation(msg.key);
        broadcastStoreChanged();
        sendResponse({ ok: true });
        break;
      }
      case 'ASSOCIATE': {
        const rec = await getObservation(msg.key);
        if (rec) {
          rec.lines = rec.lines || [];
          if (!rec.lines.some((l) => l.cardId === msg.card.id)) {
            rec.lines.push({
              lineType: 'card',
              cardId: msg.card.id,
              label: msg.card.label,
              qty: 1,
            });
          }
          await putObservation(rec);
          broadcastStoreChanged();
        }
        sendResponse({ ok: !!rec });
        break;
      }
      // A line that is not a card: the album in the bundle, or the four
      // photocards you cannot name yet.
      //
      // Kept separate from ASSOCIATE because that one keys on cardId, and
      // these have none -- two non-card lines on a listing are two different
      // things, not a duplicate. They are addressed by position instead.
      case 'ADD_LINE': {
        const rec = await getObservation(msg.key);
        if (rec) {
          rec.lines = rec.lines || [];
          rec.lines.push({
            lineType: msg.line.lineType,
            cardId: null,
            label: msg.line.label || null,
            qty: msg.line.qty || 1,
            // Per-unit, USD cents, net of selling fees. Null leaves it for the
            // lot analyzer -- which can price a card and cannot price an album.
            valueCents: msg.line.valueCents ?? null,
          });
          // A listing with more than one thing in it is a lot, and saying so
          // here saves the checkbox being the only place it is recorded.
          if (rec.lines.length > 1) rec.isLot = true;
          rec.syncedAt = null;
          await putObservation(rec);
          broadcastStoreChanged();
        }
        sendResponse({ ok: !!rec });
        break;
      }
      case 'REMOVE_LINE': {
        const rec = await getObservation(msg.key);
        if (rec?.lines?.[msg.index] !== undefined) {
          rec.lines.splice(msg.index, 1);
          rec.syncedAt = null;
          await putObservation(rec);
          broadcastStoreChanged();
        }
        sendResponse({ ok: !!rec });
        break;
      }
      case 'UNASSOCIATE': {
        const rec = await getObservation(msg.key);
        if (rec) {
          rec.lines = (rec.lines || []).filter((l) => l.cardId !== msg.cardId);
          await putObservation(rec);
          broadcastStoreChanged();
        }
        sendResponse({ ok: !!rec });
        break;
      }
      case 'SET_LOT': {
        const rec = await getObservation(msg.key);
        if (rec) {
          rec.isLot = !!msg.isLot;
          await putObservation(rec);
          broadcastStoreChanged();
        }
        sendResponse({ ok: !!rec });
        break;
      }
      case 'SET_ARMED':
        sendResponse({ ok: true, armed: await setArmed(msg.card) });
        chrome.runtime.sendMessage({ type: 'ARMED_CHANGED' }).catch(() => {});
        break;
      case 'GET_ARMED':
        sendResponse({ ok: true, armed: await getArmed() });
        break;
      case 'GET_KEYS':
        sendResponse({ ok: true, keys: await allKeys() });
        break;
      case 'GET_ALL':
        sendResponse({ ok: true, records: await allObservations() });
        break;
      case 'CLEAR_ALL':
        await clearAll();
        broadcastStoreChanged();
        sendResponse({ ok: true });
        break;
      // What the server holds for each listing after a sync.
      //
      // A listing re-captured after its local record was cleared arrives with
      // no lines -- the card associations live only here -- and reads in the
      // panel as unidentified work. It is not: a capture with no lines leaves
      // the server's alone. Recording the server's count is what lets the
      // panel say so instead of nagging for work that was never lost.
      case 'SET_SERVER_LINES': {
        let n = 0;
        for (const r of msg.results || []) {
          const rec = await getObservation(obsKey(r.marketplace, r.externalId));
          if (!rec) continue;
          rec.serverLines = r.linesOnServer ?? 0;
          rec.listingId = r.listingId ?? rec.listingId ?? null;
          await putObservation(rec);
          n++;
        }
        sendResponse({ ok: true, updated: n });
        break;
      }
      // Mark what a sync just pushed, so "clear the ones I am done with" can
      // mean something safer than "clear everything".
      case 'MARK_SYNCED': {
        const now = new Date().toISOString();
        let n = 0;
        for (const key of msg.keys || []) {
          const rec = await getObservation(key);
          if (!rec) continue;
          rec.syncedAt = now;
          await putObservation(rec);
          n++;
        }
        broadcastStoreChanged();
        sendResponse({ ok: true, marked: n });
        break;
      }
      // Only removes records the server already has. A capture that never
      // synced is the only copy in existence, so it is never swept by this.
      case 'CLEAR_SYNCED': {
        const all = await allObservations();
        let n = 0;
        for (const rec of all) {
          if (!rec.syncedAt) continue;
          await deleteObservation(rec.key);
          n++;
        }
        broadcastStoreChanged();
        sendResponse({ ok: true, removed: n });
        break;
      }
      case 'REMOVE_ONE': {
        await deleteObservation(msg.key);
        broadcastStoreChanged();
        sendResponse({ ok: true });
        break;
      }
      case 'IS_ACTIVE': {
        const tabId = msg.tabId ?? sender.tab?.id;
        const on = isActive(tabId);
        // A tab that loads while the mode is on enrolls itself here, so
        // broadcasts (STORE_CHANGED) reach it without a second click.
        if (on && tabId && !activeTabs.has(tabId)) await setActive(tabId, true);
        sendResponse({ ok: true, active: on });
        break;
      }
      case 'DEACTIVATE': {
        // Esc is the panic switch: it turns the session off, not one tab,
        // otherwise the other open listings keep their overlays.
        await setCaptureMode(false);
        for (const id of [...activeTabs]) {
          if (id !== (msg.tabId ?? sender.tab?.id)) await deactivate(id);
        }
        const tabId = msg.tabId ?? sender.tab?.id;
        if (tabId) {
          await deactivate(tabId);
          await closePanel(tabId);
        }
        sendResponse({ ok: true });
        break;
      }
      default:
        sendResponse({ ok: false, error: `unknown message ${msg.type}` });
    }
  })();
  return true; // keep the port open for the async reply
});
