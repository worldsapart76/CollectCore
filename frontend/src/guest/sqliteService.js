// Guest SQLite service — wraps sqlite-wasm for the guest webview.
//
// Phase 1 scope: load sqlite-wasm, fetch /catalog/seed.db, deserialize into
// an in-memory database, run queries. NO persistence yet (that's Phase 1b
// via OPFS SAHPool — added separately so any setup issues are isolated).
//
// All access goes through this module; pages call init / loadSeed / query.

import sqlite3InitModule from "@sqlite.org/sqlite-wasm";

let _sqlite3 = null;
let _db = null;

/**
 * One-shot init of the sqlite-wasm runtime. Idempotent.
 * Returns the sqlite3 namespace once ready.
 */
export async function initSqlite() {
  if (_sqlite3) return _sqlite3;
  _sqlite3 = await sqlite3InitModule({
    print: (msg) => console.log("[sqlite]", msg),
    printErr: (msg) => console.error("[sqlite]", msg),
  });
  return _sqlite3;
}

/**
 * Fetch the catalog seed and open it as an in-memory database.
 * Replaces any currently-open in-memory DB.
 */
export async function loadSeedFromUrl(url = "/catalog/seed.db") {
  const sqlite3 = await initSqlite();
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error(`Seed fetch failed: ${res.status}`);
  const buf = await res.arrayBuffer();
  const bytes = new Uint8Array(buf);

  // Close existing
  if (_db) {
    try { _db.close(); } catch { /* noop */ }
    _db = null;
  }

  // Allocate sqlite-managed memory and copy bytes in. sqlite3_deserialize then
  // takes ownership and treats it as the database file.
  const p = sqlite3.wasm.allocFromTypedArray(bytes);
  _db = new sqlite3.oo1.DB();
  const rc = sqlite3.capi.sqlite3_deserialize(
    _db.pointer,
    "main",
    p,
    bytes.length,
    bytes.length,
    sqlite3.capi.SQLITE_DESERIALIZE_FREEONCLOSE
      | sqlite3.capi.SQLITE_DESERIALIZE_RESIZEABLE,
  );
  if (rc !== 0) throw new Error(`sqlite3_deserialize failed: rc=${rc}`);
  return { sizeBytes: bytes.length };
}

/**
 * Run a query against the active in-memory database.
 * Returns rows as plain objects.
 */
export function query(sql, params = []) {
  if (!_db) throw new Error("DB not loaded — call loadSeedFromUrl() first");
  const rows = [];
  _db.exec({
    sql,
    bind: params,
    rowMode: "object",
    callback: (row) => rows.push(row),
  });
  return rows;
}

/** True if a DB has been deserialized into memory. */
export function isLoaded() {
  return _db !== null;
}
