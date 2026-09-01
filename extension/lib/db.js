// IndexedDB store for captured observations and their thumbnail blobs.
//
// The service worker is the single writer; the panel reads. Keeping one writer
// avoids races between a content script capturing and the panel exporting.
//
// Key for both stores is `${marketplace}:${externalId}` — the dedupe key from
// the plan doc. Capturing the same listing twice in a session is a no-op;
// capturing it weeks later appends a new observation row (see `sightings`).
//
// ## The two stores have DIFFERENT lifetimes, on purpose
//
// An observation is a work item: capture it, identify it, sync it, clear it.
// An image is the RECORD — the app renders market listings from this store
// (see content/appbridge.js), because a marketplace CDN drops the photo when
// the listing closes and the capture is the only chance to hold onto it.
//
// So deleting an observation must NEVER delete its image. Clearing the panel
// used to take the blob with it, which meant the safest-looking button in the
// extension was the one that destroyed irreplaceable bytes.
//
// Nothing in here deletes image bytes at all. Reclaiming the space means
// removing the extension, which is the right amount of friction for an action
// that cannot be undone -- and no code path can reach it by accident.

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

// Observation only. The image survives — see the lifetime note at the top.
export function deleteObservation(key) {
  return tx(STORE_OBS, 'readwrite', (s) => s.delete(key));
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

export function imageKeys() {
  return tx(STORE_IMG, 'readonly', (s) => s.getAllKeys());
}

// How many images are held and what they weigh.
//
// Walked with a cursor rather than getAll(): the whole point of this store is
// that it grows to thousands of rows, and materialising every record to add up
// a size field is the one operation here that would not survive its own success.
export function imageStats() {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(STORE_IMG, 'readonly');
        const req = t.objectStore(STORE_IMG).openCursor();
        let count = 0;
        let bytes = 0;
        req.onsuccess = () => {
          const cur = req.result;
          if (!cur) return;
          count++;
          // Blob.size is metadata -- reading it does not pull the bytes off
          // disk.
          bytes += cur.value?.blob?.size || 0;
          cur.continue();
        };
        t.oncomplete = () => resolve({ count, bytes });
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      })
  );
}

// Observations only. Deliberately NOT the images: this is the "clear my work
// queue" button, and the images are not the work queue.
export function clearAll() {
  return tx(STORE_OBS, 'readwrite', (s) => s.clear());
}
