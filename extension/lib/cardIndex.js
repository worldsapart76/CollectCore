// Local copy of the photocard library, and the search over it.
//
// Lives in the panel rather than the service worker: the worker is ephemeral
// and rebuilding a 10k-card inverted index on every wake would be absurd. The
// panel holds it for as long as it is open, which is exactly the window in
// which anyone is picking cards.

import { buildIndex, matchTitle, searchCards } from './matcher.js';
import { apiFetch } from './api.js';

const DB_NAME = 'collectcore-cards';
const DB_VERSION = 1;
const STORE = 'index';
const KEY = 'current';

let cached = null; // { meta, cards, index }

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(mode, fn) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = fn(t.objectStore(STORE));
        t.oncomplete = () => resolve(req && req.result);
        t.onerror = () => reject(t.error);
      })
  );
}

/** Persist a freshly imported index and make it live. */
export async function save(payload) {
  const cards = payload?.cards;
  if (!Array.isArray(cards) || cards.length === 0) {
    throw new Error('not a card index: expected a non-empty "cards" array');
  }
  const record = {
    cards,
    importedAt: new Date().toISOString(),
    count: cards.length,
  };
  await tx('readwrite', (s) => s.put(record, KEY));
  cached = null;
  return record;
}

/** Load and index the stored library. Built once per panel session. */
export async function load() {
  if (cached) return cached;
  const record = await tx('readonly', (s) => s.get(KEY));
  if (!record) return null;
  cached = {
    meta: { importedAt: record.importedAt, count: record.count },
    cards: record.cards,
    index: buildIndex(record.cards),
  };
  return cached;
}

export async function clear() {
  await tx('readwrite', (s) => s.delete(KEY));
  cached = null;
}

// --- Refresh from production ----------------------------------------------

// Anything older than this gets refreshed automatically when the panel opens.
// A stale index does not merely inconvenience: a card catalogued yesterday
// fails to match, gets pushed down the create-the-card path, and invites a
// duplicate of a card already owned. Remembering to refresh cannot be the
// mechanism that prevents that.
const MAX_AGE_MS = 12 * 60 * 60 * 1000;

export async function age() {
  const store = await load();
  if (!store) return null;
  return Date.now() - new Date(store.meta.importedAt).getTime();
}

/** Pull the live index from prod. */
export async function refreshFromServer() {
  const res = await apiFetch('/admin/card-index');
  if (!res.ok) return res;
  try {
    const saved = await save(res.data);
    return { ok: true, count: saved.count };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

/** Refresh if stale or absent; stay quiet when the stored copy is fine. */
export async function refreshIfStale() {
  const current = await age();
  if (current !== null && current < MAX_AGE_MS) return { ok: true, skipped: true };
  return refreshFromServer();
}

/**
 * Candidates for a listing, narrowed by its title.
 *
 * `drop` carries the tokens whose chips the user switched off, so removing a
 * chip re-runs the same match minus that constraint.
 */
export async function suggest(title, { drop = [], limit = 60 } = {}) {
  const store = await load();
  if (!store) return null;
  return matchTitle(title, store.index, { drop, limit });
}

/**
 * Free-text search, for when the title inferred nothing useful and the card has
 * to be found by hand. Scoring lives in matcher.js, which is pure and testable
 * against the real 11k index without stubbing IndexedDB.
 */
export async function search(query, { limit = 60 } = {}) {
  const store = await load();
  if (!store) return { cards: [], total: 0 };
  return searchCards(store.cards, query, { limit });
}

export function cardLabel(card) {
  const members = (card.members || []).join(' + ') || '—';
  return [members, card.origin, card.version].filter(Boolean).join(' · ');
}
