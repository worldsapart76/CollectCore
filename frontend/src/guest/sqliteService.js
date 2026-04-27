// Guest SQLite service — main-thread proxy over the sqliteWorker.
//
// Phase 1b: the actual sqlite3 runtime + SAHPool VFS run in
// ./sqliteWorker.js. The catalog DB is persisted to OPFS, so reloads of the
// page can skip the network fetch and reopen the existing file directly.
//
// All public APIs are async (the in-memory Phase 1a service exposed sync
// query/isLoaded; switching to a worker forces them to async).

// All catalog endpoints (/catalog/seed.db, /catalog/delta) live on
// api.collectcoreapp.com — that's the host with the Cloudflare Access
// bypass policy. Hitting them on the apex would resolve to the gated
// host and fail with "Failed to fetch" (CF redirects to Google login
// and the redirect response has no CORS headers, so the fetch errors
// out before completing).
//
// Guest builds set VITE_API_BASE_URL=https://api.collectcoreapp.com in
// .env.guest. Admin runs these adapters too in dev (via /_guest_debug)
// where API_BASE is "" — same-origin against the local backend works.
const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";
const SEED_URL = `${API_BASE}/catalog/seed.db`;
const DELTA_URL = (since) => `${API_BASE}/catalog/delta?since=${since}`;

let _worker = null;
let _nextId = 1;
const _pending = new Map();

let _initPromise = null;
let _hasCatalog = false;
let _storageMode = null;
let _fallbackReason = null;
// Phase 2: result of navigator.storage.persist() on first init. `true` means
// the browser has marked our origin's storage as durable (won't be evicted
// under disk pressure). `false` means the request was denied (e.g. user has
// not "installed" the PWA on Safari) and the storage is best-effort.
// `null` means the API is unavailable (very old browsers) or hasn't run yet.
let _persistGranted = null;

function ensureWorker() {
  if (_worker) return _worker;
  _worker = new Worker(new URL("./sqliteWorker.js", import.meta.url), {
    type: "module",
  });
  _worker.onmessage = (ev) => {
    const { id, ok, result, error } = ev.data || {};
    const entry = _pending.get(id);
    if (!entry) return;
    _pending.delete(id);
    if (ok) entry.resolve(result);
    else entry.reject(new Error(error));
  };
  _worker.onerror = (ev) => {
    console.error("[sqlite-worker] error", ev.message || ev);
  };
  // Free the SAHPool's SyncAccessHandles on tab unload so a quick reload
  // doesn't race with the next worker's install.
  if (typeof window !== "undefined") {
    window.addEventListener("beforeunload", () => {
      try { _worker?.terminate(); } catch { /* noop */ }
    });
  }
  return _worker;
}

function call(type, payload, transfer) {
  const w = ensureWorker();
  const id = _nextId++;
  return new Promise((resolve, reject) => {
    _pending.set(id, { resolve, reject });
    w.postMessage({ id, type, payload }, transfer || []);
  });
}

// Phase 2: ask the browser to mark our storage as durable so OPFS data won't
// be auto-evicted under disk pressure. This is a window-only API, so it has
// to run on the main thread (not in the worker). Idempotent — the browser
// caches the user's grant decision per origin. Failures are non-fatal: the
// guest still works, just with best-effort storage.
async function requestPersistentStorage() {
  if (typeof navigator === "undefined" || !navigator.storage?.persist) {
    return null;
  }
  try {
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch (err) {
    console.warn("[sqlite-service] navigator.storage.persist failed", err);
    return null;
  }
}

/**
 * Boot the worker, install the SAHPool VFS, and (if a catalog.db already
 * lives in the pool from a previous session) reopen it. Idempotent.
 * Resolves to `{ hasCatalog, storageMode, fallbackReason, persistGranted }`.
 */
export function initSqlite() {
  if (_initPromise) return _initPromise;
  _initPromise = Promise.all([call("init"), requestPersistentStorage()])
    .then(([r, persistGranted]) => {
      _hasCatalog = !!r.hasCatalog;
      _storageMode = r.storageMode || null;
      _fallbackReason = r.fallbackReason || null;
      _persistGranted = persistGranted;
      return { ...r, persistGranted };
    })
    .catch((e) => {
      _initPromise = null;
      throw e;
    });
  return _initPromise;
}

/**
 * Fetch the catalog seed and import it into the SAHPool, replacing any
 * existing catalog.db. Survives page reload.
 *
 * URL defaults to api.collectcoreapp.com/catalog/seed.db (via API_BASE)
 * because that host has the CF Access bypass policy — see SEED_URL note
 * above. Caller can override for tests; production should always use
 * the default.
 */
export async function loadSeedFromUrl(url = SEED_URL) {
  await initSqlite();
  // No `credentials: "include"` here. The api.* /catalog/seed.db endpoint
  // 302-redirects to the public R2 host (images.collectcoreapp.com) which
  // serves the file anonymously. Credentialed fetches require the response
  // to include Access-Control-Allow-Credentials: true, but R2's bucket-
  // level CORS config can't emit that header. Sending credentials would
  // force CORS to fail on the redirected response. The seed needs no auth
  // anyway — it's a public catalog snapshot.
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Seed fetch failed: ${res.status}`);
  const buf = await res.arrayBuffer();
  const bytes = new Uint8Array(buf);
  // Transfer the underlying ArrayBuffer to avoid copying ~10MB across the
  // worker boundary.
  const out = await call("loadSeed", { bytes }, [bytes.buffer]);
  _hasCatalog = true;
  return out;
}

export function query(sql, params = []) {
  return call("query", { sql, params });
}

export function isLoaded() {
  return call("isLoaded");
}

/**
 * Cached, synchronous accessor for whether init found (or load created) a
 * persisted catalog. Useful for UI gating without an extra round-trip.
 */
export function hasPersistedCatalog() {
  return _hasCatalog;
}

/** 'persisted' | 'memory' | null (before init). Synchronous, post-init. */
export function getStorageMode() {
  return _storageMode;
}

/** Error message that triggered memory-mode fallback, or null. */
export function getFallbackReason() {
  return _fallbackReason;
}

/**
 * Phase 2: result of navigator.storage.persist() during initSqlite.
 *   true  = browser granted persistent storage (OPFS won't be evicted)
 *   false = browser denied (best-effort eviction-eligible storage)
 *   null  = API unavailable, or init hasn't finished
 */
export function getPersistGranted() {
  return _persistGranted;
}

/**
 * Phase 2: read a single value from the guest_meta key/value store.
 * Returns the stored TEXT value or null when the key isn't present.
 */
export async function getGuestMeta(key) {
  const rows = await query("SELECT value FROM guest_meta WHERE key = ?", [key]);
  return rows.length ? rows[0].value : null;
}

/**
 * Phase 2: upsert a single guest_meta value. Stores everything as TEXT —
 * callers JSON.stringify if they need richer types.
 */
export async function setGuestMeta(key, value) {
  await query(
    "INSERT INTO guest_meta(key, value) VALUES(?, ?) " +
      "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    [key, value],
  );
}

const LAST_SYNCED_KEY = "last_synced_catalog_version";

/**
 * Phase 3: pull catalog deltas from the server and apply them to the local
 * SQLite mirror.
 *
 * Reads the cursor from `guest_meta.last_synced_catalog_version`, fetches
 * `/catalog/delta?since=N`, replays the table-row payload through the worker,
 * then advances the cursor to the server's reported `max_version`.
 *
 * Idempotent: if since == max_version on the server, the worker apply is a
 * no-op and the cursor stays put. The cursor only advances on a successful
 * apply, so a network or apply failure leaves the guest free to retry.
 *
 * Returns `{ since, newVersion, itemsApplied, counts }`.
 */
export async function syncCatalog() {
  await initSqlite();
  if (!_hasCatalog) {
    throw new Error("syncCatalog: no catalog loaded — call loadSeedFromUrl first");
  }
  // First sync after a seed load won't have a cursor yet; derive it from the
  // seed's own max(catalog_version) so we don't redundantly re-fetch every
  // row that's already present locally. Subsequent syncs read the persisted
  // cursor that the previous sync wrote.
  const sinceStr = await getGuestMeta(LAST_SYNCED_KEY);
  let since;
  if (sinceStr != null && Number.isFinite(Number(sinceStr))) {
    since = Number(sinceStr);
  } else {
    const rows = await query(
      "SELECT COALESCE(MAX(catalog_version), 0) AS v FROM tbl_items WHERE catalog_item_id IS NOT NULL",
    );
    since = rows[0]?.v ?? 0;
  }

  const res = await fetch(DELTA_URL(since), { credentials: "include" });
  if (!res.ok) throw new Error(`Delta fetch failed: ${res.status}`);
  const payload = await res.json();

  const result = await call("applyCatalogDelta", payload);
  await setGuestMeta(LAST_SYNCED_KEY, String(payload.max_version));

  // Notify any listening UI (e.g. PhotocardLibraryPage) that the local
  // SQLite was just updated. Lets the page auto-refresh its in-memory
  // card list without a manual reload — fixes the race where the page
  // mounts and reads stale data BEFORE the background syncCatalog
  // (fired from GuestBootstrap on every launch) finishes.
  // Centralized here so every syncCatalog caller benefits without
  // remembering to dispatch (manual Refresh from menu, future callers).
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("collectcore:guest-catalog-updated", {
        detail: {
          itemsApplied: result.itemsApplied,
          newVersion: payload.max_version,
        },
      }),
    );
  }

  return {
    since,
    newVersion: payload.max_version,
    itemsApplied: result.itemsApplied,
    counts: result.counts,
  };
}

/**
 * Phase 3: read the persisted "last synced catalog version" cursor without
 * triggering a sync. Returns null when no cursor is present (caller can
 * fall back to the seed's max(catalog_version)).
 */
export async function getLastSyncedVersion() {
  const v = await getGuestMeta(LAST_SYNCED_KEY);
  return v != null && Number.isFinite(Number(v)) ? Number(v) : null;
}

// ---------------------------------------------------------------------------
// Phase 4a: per-card guest annotations (guest_card_copies)
//
// Mirrors admin's tbl_photocard_copies model — multiple copies per card,
// each with an ownership_status_id and optional notes — but keyed by the
// stable catalog_item_id rather than item_id. Multiple rows with the same
// catalog_item_id are allowed (e.g. one Owned + one Wanted) and treated
// independently.
//
// Reads use the v_guest_library_photocards view, which the future guest
// library will query directly. The functions below are CRUD helpers for
// the eventual UI; no UI consumes them today.
// ---------------------------------------------------------------------------

/**
 * Insert a new guest copy row for a catalog card. Returns the new copy_id.
 */
export async function addGuestCardCopy({ catalogItemId, ownershipStatusId, notes = null }) {
  if (!catalogItemId) throw new Error("addGuestCardCopy: catalogItemId required");
  if (!ownershipStatusId) throw new Error("addGuestCardCopy: ownershipStatusId required");
  await query(
    "INSERT INTO guest_card_copies (catalog_item_id, ownership_status_id, notes) VALUES (?, ?, ?)",
    [catalogItemId, ownershipStatusId, notes],
  );
  const rows = await query("SELECT last_insert_rowid() AS id");
  return rows[0]?.id ?? null;
}

/**
 * Update an existing guest copy. Pass only the fields you want to change.
 */
export async function updateGuestCardCopy(copyId, { ownershipStatusId, notes } = {}) {
  if (!copyId) throw new Error("updateGuestCardCopy: copyId required");
  const sets = [];
  const params = [];
  if (ownershipStatusId !== undefined) {
    sets.push("ownership_status_id = ?");
    params.push(ownershipStatusId);
  }
  if (notes !== undefined) {
    sets.push("notes = ?");
    params.push(notes);
  }
  if (!sets.length) return;
  sets.push("updated_at = CURRENT_TIMESTAMP");
  params.push(copyId);
  await query(`UPDATE guest_card_copies SET ${sets.join(", ")} WHERE copy_id = ?`, params);
}

/**
 * Delete a guest copy by copy_id.
 */
export async function deleteGuestCardCopy(copyId) {
  if (!copyId) throw new Error("deleteGuestCardCopy: copyId required");
  await query("DELETE FROM guest_card_copies WHERE copy_id = ?", [copyId]);
}

/**
 * Fetch all guest copies for one catalog card, oldest first.
 */
export async function listGuestCopiesForCard(catalogItemId) {
  return query(
    `SELECT copy_id, ownership_status_id, notes, created_at, updated_at
     FROM guest_card_copies
     WHERE catalog_item_id = ?
     ORDER BY copy_id`,
    [catalogItemId],
  );
}

// ---------------------------------------------------------------------------
// Phase 5: backup / restore of guest_* tables
//
// Snapshot every guest-owned table to JSON so the guest can save their
// annotations + (eventually) guest-added cards somewhere outside OPFS. OPFS
// is browser-local and durable-on-best-effort; if the user clears site data
// or loses the device, this snapshot is the only recovery path.
//
// The eventual UI will:
//   - Trigger downloadGuestBackup() and stream the JSON to a file download.
//   - Accept a file via <input type="file"> and feed it to restoreGuestBackup().
//   - Render last-backed-up timestamp via getLastBackupAt() with a "back up
//     now" nudge after N days.
// ---------------------------------------------------------------------------

const LAST_BACKUP_KEY = "last_backed_up_at";

/**
 * Build a JSON-serializable snapshot of every guest_% table. After a
 * successful export, stamps `guest_meta.last_backed_up_at` with the
 * snapshot's timestamp so the UI can show "Last backed up: N days ago".
 *
 * Returns the snapshot object — the caller is responsible for serializing
 * + presenting it to the user (file download, share sheet, etc.).
 */
export async function exportGuestBackup() {
  await initSqlite();
  if (!_hasCatalog) {
    throw new Error("exportGuestBackup: no catalog loaded");
  }
  const snapshot = await call("exportGuestData");
  // Stamp after the export succeeds — if the worker call throws we don't
  // pretend a backup happened.
  await setGuestMeta(LAST_BACKUP_KEY, snapshot.exported_at);
  return snapshot;
}

/**
 * Replace-strategy restore. Pass the parsed JSON snapshot from a prior
 * exportGuestBackup() call. Wipes every existing guest_% table then inserts
 * the snapshot's rows. SAVEPOINT-wrapped on the worker side, so a malformed
 * payload rolls back and the user's existing data is preserved.
 */
export async function restoreGuestBackup(snapshot) {
  await initSqlite();
  if (!_hasCatalog) {
    throw new Error("restoreGuestBackup: no catalog loaded");
  }
  return call("importGuestData", snapshot);
}

/**
 * Read the persisted "last backed up at" ISO timestamp. Returns null if no
 * backup has ever been taken in this OPFS instance.
 */
export async function getLastBackupAt() {
  return getGuestMeta(LAST_BACKUP_KEY);
}

/** Remove the persisted catalog.db from the SAHPool. */
export async function clearCatalog() {
  const r = await call("clearCatalog");
  _hasCatalog = false;
  return r;
}

/**
 * Escape hatch for stuck OPFS state: ask the worker to delete the SAHPool
 * directory via the raw OPFS API, terminate the worker so any held handles
 * are released, and reset the service so the next initSqlite() spins up a
 * fresh worker against an empty pool directory.
 *
 * Recovery for the "Access Handles cannot be created..." failure that
 * persists across tab closes when the browser leaks SAHs.
 */
export async function nukeOpfsAndReset() {
  if (!_worker) {
    // Pool wasn't even up; just talk to OPFS via a transient worker call.
    ensureWorker();
  }
  let result;
  try {
    result = await call("nukeOpfs");
  } catch (err) {
    result = { removed: false, error: err?.message || String(err) };
  }
  try { _worker?.terminate(); } catch { /* noop */ }
  _worker = null;
  _pending.clear();
  _initPromise = null;
  _hasCatalog = false;
  _storageMode = null;
  _fallbackReason = null;
  _persistGranted = null;
  return result;
}
