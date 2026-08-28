// IndexedDB store for captured observations and their thumbnail blobs.
//
// The service worker is the single writer; the panel reads. Keeping one writer
// avoids races between a content script capturing and the panel exporting.
//
// Key for both stores is `${marketplace}:${externalId}` — the dedupe key from
// the plan doc. Capturing the same listing twice in a session is a no-op;
// capturing it weeks later appends a new observation row (see `sightings`).

const DB_NAME = 'collectcore-market';
const DB_VERSION = 1;

export const STORE_OBS = 'observations';
export const STORE_IMG = 'images';

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_OBS)) {
        const obs = db.createObjectStore(STORE_OBS, { keyPath: 'key' });
        obs.createIndex('capturedAt', 'capturedAt');
        obs.createIndex('marketplace', 'marketplace');
      }
      if (!db.objectStoreNames.contains(STORE_IMG)) {
        db.createObjectStore(STORE_IMG, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(store, mode, fn) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = fn(t.objectStore(store));
        t.oncomplete = () => resolve(req && req.result);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      })
  );
}

export function obsKey(marketplace, externalId) {
  return `${marketplace}:${externalId}`;
}

export function getObservation(key) {
  return tx(STORE_OBS, 'readonly', (s) => s.get(key));
}

export function putObservation(record) {
  return tx(STORE_OBS, 'readwrite', (s) => s.put(record));
}

export function deleteObservation(key) {
  return Promise.all([
    tx(STORE_OBS, 'readwrite', (s) => s.delete(key)),
    tx(STORE_IMG, 'readwrite', (s) => s.delete(key)),
  ]);
}

export function allObservations() {
  return tx(STORE_OBS, 'readonly', (s) => s.getAll());
}

export function allKeys() {
  return tx(STORE_OBS, 'readonly', (s) => s.getAllKeys());
}

export function putImage(key, blob) {
  return tx(STORE_IMG, 'readwrite', (s) => s.put({ key, blob }));
}

export function getImage(key) {
  return tx(STORE_IMG, 'readonly', (s) => s.get(key));
}

export function clearAll() {
  return Promise.all([
    tx(STORE_OBS, 'readwrite', (s) => s.clear()),
    tx(STORE_IMG, 'readwrite', (s) => s.clear()),
  ]);
}
