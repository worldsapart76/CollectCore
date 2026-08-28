// Local copy of the photocard library, and the search over it.
//
// Lives in the panel rather than the service worker: the worker is ephemeral
// and rebuilding a 10k-card inverted index on every wake would be absurd. The
// panel holds it for as long as it is open, which is exactly the window in
// which anyone is picking cards.

import { buildIndex, matchTitle, tokenize } from './matcher.js';

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

const API_BASE = 'https://api.collectcoreapp.com';

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

/**
 * Pull the live index from prod.
 *
 * The panel is an extension page, so `host_permissions` grants it cross-origin
 * reads without a CORS preflight, and `credentials: 'include'` carries the
 * Cloudflare Access cookie from the browser's jar. Nothing to configure — but
 * the cookie does expire, and CF answers an expired one with a redirect to
 * Google that this request cannot follow.
 *
 * @returns {{ok: true, count: number} | {ok: false, reason: string}}
 */
export async function refreshFromServer() {
  let res;
  try {
    res = await fetch(`${API_BASE}/admin/card-index`, {
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });
  } catch {
    // A cross-origin redirect to the identity provider surfaces as a network
    // failure, so this is far more often an expired session than an outage.
    return { ok: false, reason: 'signin' };
  }

  if (!res.ok) return { ok: false, reason: `http ${res.status}` };

  const type = res.headers.get('content-type') || '';
  if (!type.includes('application/json')) {
    // A login page rendered where JSON was expected.
    return { ok: false, reason: 'signin' };
  }

  try {
    const saved = await save(await res.json());
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
 * to be found by hand. Ranked by how many query tokens each card matches, so
 * partial memory ("hyunjin karma") still lands.
 */
export async function search(query, { limit = 60 } = {}) {
  const store = await load();
  if (!store) return [];
  const tokens = tokenize(query);
  if (tokens.length === 0) return store.cards.slice(0, limit);

  const scored = [];
  for (const card of store.cards) {
    const hay = [
      ...(card.members || []),
      card.origin || '',
      card.version || '',
    ]
      .join(' ')
      .toLowerCase();
    let score = 0;
    for (const t of tokens) if (hay.includes(t)) score++;
    if (score === tokens.length) scored.push({ card, score });
  }
  scored.sort((a, b) => b.score - a.score || a.card.id - b.card.id);
  return scored.slice(0, limit).map((s) => s.card);
}

export function cardLabel(card) {
  const members = (card.members || []).join(' + ') || '—';
  return [members, card.origin, card.version].filter(Boolean).join(' · ');
}
