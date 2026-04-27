// Guest SQLite worker — owns the sqlite3 runtime and the SAHPool-backed
// catalog DB. The SAHPool VFS only works in a worker context (it pre-acquires
// SyncAccessHandles), so all SQLite work funnels through here.
//
// Phase 1b scope:
//   - Install the SAHPool VFS once on init.
//   - Open existing /catalog.db from the pool if present (offline-restart path).
//   - Accept seed bytes from the main thread and importDb() them into the pool.
//   - Run queries against the open DB.
//
// Phase 2 additions:
//   - Schema separation contract: tables prefixed `guest_` are guest-owned and
//     must survive any catalog refresh. Everything else is catalog data and
//     can be replaced by Phase 3 delta sync.
//   - `ensureGuestSchema()` runs after every DB open (post-init reopen AND
//     post-loadSeed import) so guest tables are always present.
//   - `guest_meta(key, value)` is the only guest table for now; holds the
//     `last_synced_catalog_version` marker that Phase 3 will read/write.
//
// Phase 3 additions:
//   - `applyCatalogDelta` replays a table-row delta payload from
//     `GET /catalog/delta?since=N` into the local catalog tables. Wraps the
//     whole apply in a transaction so a failure leaves the DB unchanged.
//     Touches only catalog tables (anything not prefixed `guest_`).
//
// Phase 5 additions:
//   - `exportGuestData` / `importGuestData` snapshot every `guest_%` table
//     in the DB to/from a JSON-serializable object. Tables are discovered
//     dynamically from sqlite_master so future guest tables (Phase 4b's
//     `guest_added_*` set) are included with no code change.
//
// Wire format on the message bus:
//   in  : { id, type, payload }
//   out : { id, ok: true, result } | { id, ok: false, error }
//
// Types: init | loadSeed | query | isLoaded | clearCatalog | nukeOpfs |
//        applyCatalogDelta | exportGuestData | importGuestData

import sqlite3InitModule from "@sqlite.org/sqlite-wasm";

// SAHPool requires absolute paths (leading slash) for filenames.
const CATALOG_DB_NAME = "/catalog.db";
const POOL_NAME = "guest-pool";
// installOpfsSAHPoolVfs synthesizes the OPFS directory name as "." + POOL_NAME
// when no `directory` option is passed. Hard-coding it lets us nuke the pool
// directory via the raw OPFS API as an escape hatch when the SAH handles are
// stuck (Chrome sometimes leaks them across tab closes).
const POOL_DIRECTORY = "." + POOL_NAME;

let _sqlite3 = null;
let _sahPool = null;
let _db = null;
// 'persisted' = SAHPool-backed catalog.db survives reload.
// 'memory'    = in-memory DB (Phase 1a fallback) — used when the SAHPool
//                install fails because another tab/zombie worker holds the
//                slot SAHs. The guest UI surfaces this so the user knows
//                their annotations won't persist in this tab.
let _storageMode = null;
let _fallbackReason = null;

async function installPoolWithRetry(attempts = 6, baseDelayMs = 250) {
  // SAHPool acquires SyncAccessHandles on every slot file at install time.
  // If a prior worker (e.g. killed by Vite HMR or a hung tab) hasn't fully
  // released its handles yet, install throws "Access Handles cannot be
  // created if there is another open Access Handle...". The browser releases
  // those handles asynchronously, so back off and retry.
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await _sqlite3.installOpfsSAHPoolVfs({ name: POOL_NAME });
    } catch (err) {
      lastErr = err;
      const msg = err?.message || String(err);
      if (!/Access Handle/i.test(msg)) throw err;
      await new Promise((r) => setTimeout(r, baseDelayMs * (i + 1)));
    }
  }
  throw lastErr;
}

// Phase 2/4a: ensure guest-owned tables + views exist after any DB open. Runs
// against both freshly-imported seeds (which contain only catalog data) and
// reopened OPFS catalogs from prior sessions (already had guest tables but
// CREATE IF NOT EXISTS / CREATE VIEW IF NOT EXISTS are safe). The contract:
// anything under the `guest_` / `v_guest_` prefix is sacred and Phase 3 sync
// must never touch it.
//
// Tables:
//   guest_meta            - key/value store (Phase 2). Holds the
//                           last_synced_catalog_version cursor.
//   guest_card_copies     - per-card guest annotations (Phase 4a). Mirror of
//                           admin's tbl_photocard_copies but keyed by the
//                           contractually-stable catalog_item_id (TEXT) so
//                           rows survive a full seed reset. Multi-row per
//                           card supported (guest can own + want at once
//                           for the same card across copies).
//
// Views:
//   v_guest_library_photocards - the future guest library's read target.
//                                Catalog cards LEFT JOIN'd to their guest
//                                copies (LEFT JOIN so untouched catalog
//                                cards still show up with NULL ownership).
//                                Phase 4b will UNION ALL guest-added cards
//                                in here once that schema lands.
function ensureGuestSchema() {
  if (!_db) return;
  _db.exec(`
    CREATE TABLE IF NOT EXISTS guest_meta (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS guest_card_copies (
      copy_id             INTEGER PRIMARY KEY AUTOINCREMENT,
      catalog_item_id     TEXT NOT NULL,
      ownership_status_id INTEGER NOT NULL,
      notes               TEXT,
      created_at          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (ownership_status_id) REFERENCES lkup_ownership_statuses(ownership_status_id)
    );

    CREATE INDEX IF NOT EXISTS idx_guest_card_copies_catalog_item_id
      ON guest_card_copies(catalog_item_id);

    -- Library read target. Joining on catalog_item_id rather than item_id
    -- keeps the contract: guest annotations follow the stable key, not
    -- admin's autoincrement. LEFT JOIN keeps catalog rows with no annotation
    -- visible (their ownership column is NULL — caller renders as default).
    CREATE VIEW IF NOT EXISTS v_guest_library_photocards AS
    SELECT
      i.item_id,
      i.catalog_item_id,
      i.catalog_version,
      i.top_level_category_id,
      i.notes              AS catalog_notes,
      d.group_id,
      d.source_origin_id,
      d.version,
      d.is_special,
      gc.copy_id           AS guest_copy_id,
      gc.ownership_status_id AS guest_ownership_status_id,
      gc.notes             AS guest_notes,
      gc.updated_at        AS guest_updated_at
    FROM tbl_items i
    JOIN tbl_photocard_details d ON d.item_id = i.item_id
    LEFT JOIN guest_card_copies gc ON gc.catalog_item_id = i.catalog_item_id
    WHERE i.collection_type_id = (
      SELECT collection_type_id FROM lkup_collection_types
      WHERE collection_type_code = 'photocards'
    )
      AND i.catalog_item_id IS NOT NULL;
  `);
}

async function init() {
  if (_storageMode) {
    return {
      hasCatalog: _db !== null,
      storageMode: _storageMode,
      fallbackReason: _fallbackReason,
    };
  }
  _sqlite3 = await sqlite3InitModule({
    print: (msg) => console.log("[sqlite-worker]", msg),
    printErr: (msg) => console.error("[sqlite-worker]", msg),
  });
  try {
    _sahPool = await installPoolWithRetry();
    if (_sahPool.getFileNames().includes(CATALOG_DB_NAME)) {
      _db = new _sahPool.OpfsSAHPoolDb(CATALOG_DB_NAME);
      ensureGuestSchema();
    }
    _storageMode = "persisted";
  } catch (err) {
    // SAHPool is single-tenant per origin. Falling back to an in-memory
    // database keeps the page functional when another tab (or a leaked
    // worker from a prior session) is holding the slot handles. The seed
    // gets loaded via sqlite3_deserialize on next loadSeed.
    console.warn("[sqlite-worker] SAHPool install failed; falling back to in-memory", err);
    _sahPool = null;
    _storageMode = "memory";
    _fallbackReason = err?.message || String(err);
  }
  return {
    hasCatalog: _db !== null,
    storageMode: _storageMode,
    fallbackReason: _fallbackReason,
  };
}

async function loadSeedBytes(bytes) {
  if (!_storageMode) throw new Error("init() must run before loadSeed");
  if (_db) {
    try { _db.close(); } catch { /* noop */ }
    _db = null;
  }
  if (_storageMode === "persisted") {
    await _sahPool.importDb(CATALOG_DB_NAME, bytes);
    _db = new _sahPool.OpfsSAHPoolDb(CATALOG_DB_NAME);
  } else {
    // In-memory fallback: deserialize bytes into a transient DB. Same
    // approach as the Phase 1a service.
    const p = _sqlite3.wasm.allocFromTypedArray(bytes);
    _db = new _sqlite3.oo1.DB();
    const rc = _sqlite3.capi.sqlite3_deserialize(
      _db.pointer,
      "main",
      p,
      bytes.byteLength,
      bytes.byteLength,
      _sqlite3.capi.SQLITE_DESERIALIZE_FREEONCLOSE
        | _sqlite3.capi.SQLITE_DESERIALIZE_RESIZEABLE,
    );
    if (rc !== 0) throw new Error(`sqlite3_deserialize failed: rc=${rc}`);
  }
  // Seed.db ships only catalog tables; the guest schema lives outside the
  // seed and must be re-created after every fresh import.
  ensureGuestSchema();
  return { sizeBytes: bytes.byteLength, storageMode: _storageMode };
}

// Phase 3: replay a /catalog/delta payload into the local catalog tables.
//
// Order matters because of FKs:
//   1. Lookup tables first (groups, top-level cats, source origins, members) —
//      items + xrefs reference these.
//   2. tbl_items, then tbl_photocard_details (1:1 with items).
//   3. xref_photocard_members and tbl_attachments are delete-by-item then
//      reinsert — that way removed members or replaced attachments propagate
//      correctly. The endpoint always sends the full current set per touched
//      item, so absence == removal.
//
// Wrapped in a SAVEPOINT so a mid-apply failure rolls everything back; the
// guest_meta version cursor is only advanced by the service layer after this
// returns successfully.
function applyCatalogDelta(payload) {
  if (!_db) throw new Error("DB not loaded — call loadSeed first");
  const tables = payload?.tables || {};
  const items = tables.tbl_items || [];
  const details = tables.tbl_photocard_details || [];
  const xrefs = tables.xref_photocard_members || [];
  const atts = tables.tbl_attachments || [];

  const counts = {
    tbl_items: 0, tbl_photocard_details: 0,
    xref_photocard_members: 0, tbl_attachments: 0,
    lkup_photocard_groups: 0, lkup_photocard_source_origins: 0,
    lkup_photocard_members: 0, lkup_top_level_categories: 0,
    lkup_collection_types: 0, lkup_ownership_statuses: 0,
    xref_ownership_status_modules: 0,
  };

  // INSERT OR REPLACE on a row whose PK matches an existing row deletes the
  // old row and inserts the new one. Safe for our lookups (single-column PK)
  // and for tbl_items / tbl_photocard_details (single-column PK).
  function upsert(table, rows) {
    if (!rows.length) return 0;
    const cols = Object.keys(rows[0]);
    const colList = cols.join(",");
    const placeholders = cols.map(() => "?").join(",");
    const sql = `INSERT OR REPLACE INTO ${table} (${colList}) VALUES (${placeholders})`;
    const stmt = _db.prepare(sql);
    try {
      for (const row of rows) {
        stmt.bind(cols.map((c) => row[c]));
        stmt.stepReset();
      }
    } finally {
      stmt.finalize();
    }
    return rows.length;
  }

  _db.exec("SAVEPOINT catalog_delta");
  try {
    // Lookups first — items + xrefs reference these via FK. The endpoint
    // ships these in FULL on every delta so lookup edits (status visibility
    // toggles, group renames, etc.) propagate correctly.
    counts.lkup_collection_types = upsert(
      "lkup_collection_types", tables.lkup_collection_types || [],
    );
    counts.lkup_ownership_statuses = upsert(
      "lkup_ownership_statuses", tables.lkup_ownership_statuses || [],
    );
    // xref_ownership_status_modules has no is_active flag — admin
    // "unchecks" status visibility by DELETING the row. INSERT OR REPLACE
    // alone never catches removed rows, so wipe-and-refill matches the
    // server state exactly. Cost is trivial (~50 rows total).
    _db.exec("DELETE FROM xref_ownership_status_modules");
    counts.xref_ownership_status_modules = upsert(
      "xref_ownership_status_modules", tables.xref_ownership_status_modules || [],
    );
    counts.lkup_top_level_categories = upsert(
      "lkup_top_level_categories", tables.lkup_top_level_categories || [],
    );
    counts.lkup_photocard_groups = upsert(
      "lkup_photocard_groups", tables.lkup_photocard_groups || [],
    );
    counts.lkup_photocard_source_origins = upsert(
      "lkup_photocard_source_origins", tables.lkup_photocard_source_origins || [],
    );
    counts.lkup_photocard_members = upsert(
      "lkup_photocard_members", tables.lkup_photocard_members || [],
    );

    counts.tbl_items = upsert("tbl_items", items);
    counts.tbl_photocard_details = upsert("tbl_photocard_details", details);

    // For xrefs and attachments, the endpoint sends the full current set per
    // touched item, so wipe-then-reinsert by item_id correctly mirrors removals.
    if (items.length) {
      const itemIds = items.map((r) => r.item_id);
      const ph = itemIds.map(() => "?").join(",");
      _db.exec({
        sql: `DELETE FROM xref_photocard_members WHERE item_id IN (${ph})`,
        bind: itemIds,
      });
      _db.exec({
        sql: `DELETE FROM tbl_attachments
              WHERE item_id IN (${ph}) AND attachment_type IN ('front', 'back')`,
        bind: itemIds,
      });
      counts.xref_photocard_members = upsert("xref_photocard_members", xrefs);
      counts.tbl_attachments = upsert("tbl_attachments", atts);
    }

    _db.exec("RELEASE SAVEPOINT catalog_delta");
  } catch (err) {
    _db.exec("ROLLBACK TO SAVEPOINT catalog_delta");
    _db.exec("RELEASE SAVEPOINT catalog_delta");
    throw err;
  }
  return { counts, itemsApplied: items.length };
}

// Phase 5: discover every guest-owned table in the current DB. Used by both
// export (read each one) and import (truth-source for what to wipe + restore).
// Excludes views and the sqlite_sequence bookkeeping table.
function listGuestTables() {
  if (!_db) throw new Error("DB not loaded");
  const rows = [];
  _db.exec({
    sql: `SELECT name FROM sqlite_master
          WHERE type = 'table' AND name LIKE 'guest_%'
          ORDER BY name`,
    rowMode: "object",
    callback: (r) => rows.push(r.name),
  });
  return rows;
}

// Phase 5: snapshot every guest_% table to a JSON-serializable object. Read-only
// against the DB. Returns rows as plain objects keyed by column name so the
// import side can survive future ALTER TABLE additions (it just re-binds the
// columns it knows about).
function exportGuestData() {
  const tables = {};
  for (const tname of listGuestTables()) {
    const rows = [];
    _db.exec({
      sql: `SELECT * FROM ${tname}`,
      rowMode: "object",
      callback: (r) => rows.push(r),
    });
    tables[tname] = rows;
  }
  return {
    version: 1,
    exported_at: new Date().toISOString(),
    tables,
  };
}

// Phase 5: replace-strategy restore. Wipes every guest_% table, then inserts
// the rows from the snapshot. Wrapped in a SAVEPOINT — an invalid payload
// rolls back and the user's existing data is preserved. Tables present in
// the DB but missing from the snapshot are still wiped (deliberate: the
// snapshot is the source of truth at restore time, same as admin's restore
// flow).
//
// AUTOINCREMENT note: we DELETE rather than DROP, so SQLite's
// sqlite_sequence rowid counters keep advancing past the restored max.
// That's fine — copy_id and similar AUTOINCREMENT columns just need to be
// monotonic, not contiguous.
function importGuestData(payload) {
  if (!_db) throw new Error("DB not loaded");
  if (!payload || typeof payload !== "object") {
    throw new Error("importGuestData: payload must be an object");
  }
  if (payload.version !== 1) {
    throw new Error(`importGuestData: unsupported version ${payload.version}`);
  }
  const incoming = payload.tables || {};
  const guestTables = listGuestTables();
  const counts = {};

  _db.exec("SAVEPOINT guest_restore");
  try {
    // Wipe in reverse-name order — guest_added_* tables (when 4b lands) may
    // have FKs pointing at other guest_* tables; alphabetical reverse is a
    // simple heuristic that works for the current shape and is harmless if
    // there are no inter-guest FKs.
    for (const tname of [...guestTables].reverse()) {
      _db.exec(`DELETE FROM ${tname}`);
    }

    for (const tname of guestTables) {
      const rows = incoming[tname] || [];
      counts[tname] = rows.length;
      if (!rows.length) continue;

      // Authoritative column list comes from the destination table, not the
      // payload. Lets us tolerate extra/stale columns in older snapshots.
      const cols = [];
      _db.exec({
        sql: `PRAGMA table_info(${tname})`,
        rowMode: "object",
        callback: (r) => cols.push(r.name),
      });
      const colList = cols.join(",");
      const placeholders = cols.map(() => "?").join(",");
      const stmt = _db.prepare(
        `INSERT INTO ${tname} (${colList}) VALUES (${placeholders})`,
      );
      try {
        for (const row of rows) {
          stmt.bind(cols.map((c) => (c in row ? row[c] : null)));
          stmt.stepReset();
        }
      } finally {
        stmt.finalize();
      }
    }

    _db.exec("RELEASE SAVEPOINT guest_restore");
  } catch (err) {
    _db.exec("ROLLBACK TO SAVEPOINT guest_restore");
    _db.exec("RELEASE SAVEPOINT guest_restore");
    throw err;
  }
  return { counts, tablesRestored: guestTables.length };
}

function runQuery(sql, params = []) {
  if (!_db) throw new Error("DB not loaded — call loadSeed first");
  const rows = [];
  _db.exec({
    sql,
    bind: params,
    rowMode: "object",
    callback: (row) => rows.push(row),
  });
  return rows;
}

async function clearCatalog() {
  if (_db) {
    try { _db.close(); } catch { /* noop */ }
    _db = null;
  }
  if (_storageMode === "persisted" && _sahPool) {
    return _sahPool.unlink(CATALOG_DB_NAME);
  }
  // memory mode: closing the DB is the entire teardown.
  return true;
}

// Last-ditch recovery for when installOpfsSAHPoolVfs keeps failing because
// the OPFS slot files are holding leaked SyncAccessHandles. Tears down
// whatever pool we have, then deletes the entire pool directory from OPFS
// via the raw FileSystem API. Caller should restart the worker after this.
async function nukeOpfs() {
  if (_db) {
    try { _db.close(); } catch { /* noop */ }
    _db = null;
  }
  if (_sahPool) {
    try { await _sahPool.removeVfs(); } catch { /* noop */ }
    _sahPool = null;
  }
  const root = await navigator.storage.getDirectory();
  try {
    await root.removeEntry(POOL_DIRECTORY, { recursive: true });
    return { removed: true, dir: POOL_DIRECTORY };
  } catch (err) {
    return { removed: false, dir: POOL_DIRECTORY, error: err?.message || String(err) };
  }
}

// Vite HMR replaces the worker module; the previous worker is going away,
// so release handles + close the DB to free SAH slots before the new module
// instance attempts to install the pool. Without this, the next install can
// race and trip the "another open Access Handle" guard.
if (import.meta.hot) {
  import.meta.hot.dispose(async () => {
    try { if (_db) _db.close(); } catch { /* noop */ }
    try { await _sahPool?.pauseVfs?.(); } catch { /* noop */ }
  });
}

self.onmessage = async (ev) => {
  const { id, type, payload } = ev.data || {};
  try {
    let result;
    switch (type) {
      case "init":
        result = await init();
        break;
      case "loadSeed":
        result = await loadSeedBytes(payload.bytes);
        break;
      case "query":
        result = runQuery(payload.sql, payload.params);
        break;
      case "isLoaded":
        result = _db !== null;
        break;
      case "clearCatalog":
        result = await clearCatalog();
        break;
      case "nukeOpfs":
        result = await nukeOpfs();
        break;
      case "applyCatalogDelta":
        result = applyCatalogDelta(payload);
        break;
      case "exportGuestData":
        result = exportGuestData();
        break;
      case "importGuestData":
        result = importGuestData(payload);
        break;
      default:
        throw new Error(`Unknown worker message type: ${type}`);
    }
    self.postMessage({ id, ok: true, result });
  } catch (err) {
    self.postMessage({ id, ok: false, error: err?.message || String(err) });
  }
};
