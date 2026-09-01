// Listing thumbnails, served by the capture extension rather than the network.
//
// `mkt_listing.thumbnail_url` is a hotlink to the marketplace's own CDN, and
// the marketplace drops the photo once the listing closes. Every comp and lot
// therefore goes blank with age — worst on the rows that need the picture most,
// since a Japanese title identifies nothing on its own.
//
// The capture extension already holds a 640px copy of every thumbnail it ever
// captured, in IndexedDB on this machine. `extension/content/appbridge.js` runs
// on this origin and hands them over as blob: URLs. Deliberately local-only:
// the images live in one browser profile on one desktop, are not backed up, and
// losing them puts this screen back exactly where it was before — hotlinks that
// work until they don't. See docs/photocard_market_intel_plan.md → Images.
//
// Everything here degrades to the hotlink: no extension, an older capture with
// no stored blob, or a bridge that never answers all end up rendering
// `thumbnail_url` exactly as before.

import { useEffect, useState } from "react";

const TAG = "__collectcore";

// Set by the bridge at document_start. Read live rather than cached at module
// load, because the module may evaluate before the content script has run.
function bridgePresent() {
  return document.documentElement.getAttribute("data-collectcore-ext") === "1";
}

let nextId = 1;
const pending = new Map();

// key -> blob: URL, or null once the extension has said it has no copy. Shared
// across every component so a listing appearing in the comp list, the lot list
// and a lot's own panel is fetched once.
const cache = new Map();

// Keys asked for but not yet sent, so a screen rendering forty rows in one pass
// makes one round trip instead of forty. Flushed on a microtask.
let queued = new Set();
let flushTimer = null;

function ensureListener() {
  if (ensureListener.done) return;
  ensureListener.done = true;
  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== window.location.origin) return;
    const msg = event.data;
    if (!msg || msg[TAG] !== "res") return;
    const resolve = pending.get(msg.id);
    if (!resolve) return;
    pending.delete(msg.id);
    resolve(msg);
  });
}

// A request that resolves to null if the bridge never answers. The extension
// being reloaded mid-session is the ordinary way that happens, and a promise
// left hanging would leave a row spinning on a fallback it could have shown
// immediately.
function ask(payload, timeoutMs = 4000) {
  ensureListener();
  const id = nextId++;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      resolve(null);
    }, timeoutMs);
    pending.set(id, (msg) => {
      clearTimeout(timer);
      resolve(msg);
    });
    window.postMessage({ [TAG]: "req", id, ...payload }, window.location.origin);
  });
}

async function flush() {
  flushTimer = null;
  const keys = [...queued];
  queued = new Set();
  if (!keys.length) return;

  // 200 is the bridge's own per-message cap; chunking here keeps a big sweep
  // from silently losing the tail of the batch.
  for (let i = 0; i < keys.length; i += 200) {
    const chunk = keys.slice(i, i + 200);
    const res = await ask({ kind: "images", keys: chunk });
    for (const key of chunk) {
      // null (no answer) is cached the same as "no copy". A retry loop against
      // a bridge that is not there costs a message per row per render and
      // buys nothing; a page reload re-asks.
      cache.set(key, res?.images?.[key] || null);
    }
    notify();
  }
}

const listeners = new Set();
function notify() {
  for (const fn of listeners) fn();
}

function request(key) {
  if (cache.has(key) || queued.has(key)) return;
  queued.add(key);
  if (!flushTimer) flushTimer = setTimeout(flush, 0);
}

export function imageKey(marketplace, externalId) {
  if (!marketplace || !externalId) return null;
  return `${marketplace}:${externalId}`;
}

/**
 * The src to render for one listing.
 *
 * Returns the extension's stored copy where there is one, otherwise the
 * marketplace hotlink, otherwise null. Never throws, never blocks a render.
 */
export function useListingImage(marketplace, externalId, fallbackUrl) {
  const key = imageKey(marketplace, externalId);
  const [, bump] = useState(0);

  useEffect(() => {
    // `has`, not a truthiness check: a cached null means the extension has
    // already said it holds no copy of this one. Re-subscribing on that would
    // leave a listener attached for the life of the page and re-ask on every
    // render, for an answer that is not going to change.
    if (!key || cache.has(key) || !bridgePresent()) return undefined;

    const onChange = () => bump((n) => n + 1);
    listeners.add(onChange);
    request(key);
    return () => listeners.delete(onChange);
  }, [key]);

  return (key && cache.get(key)) || fallbackUrl || null;
}

/** Whether the capture extension is available to serve stored images. */
export function useExtensionPresent() {
  const [present, setPresent] = useState(bridgePresent);
  useEffect(() => {
    if (present) return undefined;
    // The content script runs at document_start, so it is normally there before
    // React mounts. A single retry covers the case where it is not.
    const t = setTimeout(() => setPresent(bridgePresent()), 500);
    return () => clearTimeout(t);
  }, [present]);
  return present;
}
