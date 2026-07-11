// Trade-related per-user state. Bundle-aware:
//   admin → tbl_app_settings (server-persisted, single shared admin user)
//   guest → guest_meta KV (browser-local, per-OPFS instance)
//
// The dynamic import of "../guest/sqliteService" tree-shakes out of admin
// builds because `isAdmin` is a Vite-inlined literal, so the import lives
// inside an `if (false)` branch that Rollup eliminates.

import { isAdmin, isGuestWasm, isPcs } from "./env";
import { fetchSettings, updateSetting } from "../api";

const ADMIN_KEYS = {
  from: "trade_default_from",
  to: "trade_default_to",
  notes: "trade_default_notes",
};
const GUEST_DEFAULTS_KEY = "trade_defaults";
const GUEST_TRADES_KEY = "my_trades";

let _guestSqlitePromise = null;
function _loadGuestSqlite() {
  // Only the legacy WASM /guest/ build has local SQLite. Guarding on the
  // constant-folded isGuestWasm makes the dynamic import dead code (hence
  // eliminated) in admin AND /pcs builds, keeping sqlite-wasm out of both.
  if (!isGuestWasm) return Promise.reject(new Error("No local SQLite in this build"));
  if (!_guestSqlitePromise) {
    _guestSqlitePromise = import("../guest/sqliteService");
  }
  return _guestSqlitePromise;
}

let _pcsDataPromise = null;
function _loadPcsData() {
  // Only the /pcs build talks to the server trade endpoints. Guarding on the
  // constant-folded isPcs makes this import dead code in admin/guest builds.
  if (!isPcs) return Promise.reject(new Error("Not the /pcs build"));
  if (!_pcsDataPromise) {
    _pcsDataPromise = import("../pcs/pcsData");
  }
  return _pcsDataPromise;
}

export async function loadTradeDefaults() {
  if (isAdmin) {
    try {
      const all = await fetchSettings();
      return {
        from: all[ADMIN_KEYS.from] || "",
        to: all[ADMIN_KEYS.to] || "",
        notes: all[ADMIN_KEYS.notes] || "",
      };
    } catch {
      return { from: "", to: "", notes: "" };
    }
  }
  if (isPcs) {
    try {
      const m = await _loadPcsData();
      const d = await m.getPcsTradeDefaults();
      return { from: d.from_name || "", to: d.to_name || "", notes: d.notes || "" };
    } catch {
      return { from: "", to: "", notes: "" };
    }
  }
  try {
    const m = await _loadGuestSqlite();
    const raw = await m.getGuestMeta(GUEST_DEFAULTS_KEY);
    if (!raw) return { from: "", to: "", notes: "" };
    const parsed = JSON.parse(raw);
    return {
      from: parsed.from || "",
      to: parsed.to || "",
      notes: parsed.notes || "",
    };
  } catch {
    return { from: "", to: "", notes: "" };
  }
}

export async function saveTradeDefaults({ from, to, notes }) {
  if (isAdmin) {
    await Promise.all([
      updateSetting(ADMIN_KEYS.from, from || ""),
      updateSetting(ADMIN_KEYS.to, to || ""),
      updateSetting(ADMIN_KEYS.notes, notes || ""),
    ]);
    return;
  }
  if (isPcs) {
    const m = await _loadPcsData();
    await m.savePcsTradeDefaults({ from_name: from || "", to_name: to || "", notes: notes || "" });
    return;
  }
  if (!isGuestWasm) return; // legacy WASM guest only past this point
  const m = await _loadGuestSqlite();
  await m.setGuestMeta(
    GUEST_DEFAULTS_KEY,
    JSON.stringify({ from: from || "", to: to || "", notes: notes || "" }),
  );
}

// Guest-only: maintain a local list of slugs the guest has created so the
// guest's own TradesPage can manage them. The server doesn't track per-guest
// identity, so this is the only place that knows "these are mine."

export async function recordGuestTrade(entry) {
  // /pcs records ownership server-side at create time, so nothing to do here.
  if (!isGuestWasm) return;
  const m = await _loadGuestSqlite();
  const raw = await m.getGuestMeta(GUEST_TRADES_KEY);
  const list = raw ? JSON.parse(raw) : [];
  list.unshift(entry);
  await m.setGuestMeta(GUEST_TRADES_KEY, JSON.stringify(list));
}

export async function listGuestTrades() {
  if (isPcs) {
    const m = await _loadPcsData();
    return m.listPcsTrades(); // server already scopes to the caller + filters expired
  }
  if (!isGuestWasm) return [];
  const m = await _loadGuestSqlite();
  const raw = await m.getGuestMeta(GUEST_TRADES_KEY);
  if (!raw) return [];
  let list;
  try { list = JSON.parse(raw); } catch { return []; }
  const now = new Date();
  // Drop expired entries lazily so the guest doesn't see stale trades.
  return list.filter((e) => !e.expires_at || new Date(e.expires_at) > now);
}

export async function removeGuestTrade(slug) {
  if (isPcs) {
    const m = await _loadPcsData();
    await m.deletePcsTrade(slug); // also deletes the shared tbl_trades row
    return;
  }
  if (!isGuestWasm) return;
  const m = await _loadGuestSqlite();
  const raw = await m.getGuestMeta(GUEST_TRADES_KEY);
  const list = raw ? JSON.parse(raw) : [];
  const next = list.filter((e) => e.slug !== slug);
  await m.setGuestMeta(GUEST_TRADES_KEY, JSON.stringify(next));
}
