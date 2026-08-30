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

const ACTIVE_TABS = 'activeTabs';
const ARMED_CARD = 'armedCard';

// Mirror of the persisted set, readable SYNCHRONOUSLY.
//
// chrome.sidePanel.open() only works while the user gesture is still live, and
// any `await` before it ends that window — so the click handler cannot afford
// an async storage read before deciding what to do. Storage remains the durable
// copy; this is the copy the gesture path is allowed to consult.
const activeTabs = new Set();

async function hydrate() {
  const got = await chrome.storage.session.get(ACTIVE_TABS);
  for (const id of got[ACTIVE_TABS] || []) activeTabs.add(id);
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

function isActive(tabId) {
  return activeTabs.has(tabId);
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
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'panel') return;
  let boundTab = null;

  port.onMessage.addListener(async (msg) => {
    if (msg.type !== 'PANEL_INIT' || !msg.tabId) return;
    // Bound once, on open. Switching tabs deliberately does NOT follow — other
    // tabs must stay clean unless the icon is clicked on them.
    boundTab = msg.tabId;
    await setActive(boundTab, true);
    await tellTab(boundTab, { type: 'ACTIVATION', active: true });
  });

  port.onDisconnect.addListener(() => {
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

function bigThumb(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
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
function listingState(status) {
  return status === 'on_sale' ? 'active' : 'sold';
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
    observedAt: new Date().toISOString(),
    priceCents: item.price,
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
    }
    if (item.itemCondition && !existing.itemCondition) {
      existing.itemCondition = item.itemCondition;
    }

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
    currency: currency || 'USD',
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
      case 'IS_ACTIVE':
        sendResponse({
          ok: true,
          active: isActive(msg.tabId ?? sender.tab?.id),
        });
        break;
      case 'DEACTIVATE': {
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
