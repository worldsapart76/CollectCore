// Server-data adapter for the authenticated /pcs/ guest tier.
//
// Mirrors the read-function shape of guest/guestData.js (so the reused
// PhotocardLibraryPage needs no data-shape branching) but fetches from the
// server's /pcs/* endpoints — per-user annotations are stored server-side,
// not in browser SQLite. Selected in api.js when VITE_IS_PCS === "true";
// the admin and guest bundles tree-shake this module out.
//
// Cloudflare Access cookies must ride along on every call (credentials:
// include) so the edge can attach the verified identity header.

const API = import.meta.env.VITE_API_BASE_URL ?? "";
const _nativeFetch = window.fetch.bind(window);

function req(path, opts = {}) {
  return _nativeFetch(`${API}${path}`, { credentials: "include", ...opts });
}

async function asJson(res, fallbackMessage) {
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(errorText || fallbackMessage);
  }
  return res.json();
}

function jsonBody(method, body) {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

// --- Account ---

export async function getMe() {
  return asJson(await req("/pcs/me"), "Failed to load account");
}

// --- Reads (shape-matched to admin / guest adapters) ---

export async function listPhotocards() {
  return asJson(await req("/pcs/photocards"), "Failed to fetch photocards");
}

export async function fetchPhotocardGroups() {
  return asJson(await req("/pcs/photocards/groups"), "Failed to fetch photocard groups");
}

export async function fetchPhotocardMembers(groupId) {
  return asJson(
    await req(`/pcs/photocards/members?group_id=${encodeURIComponent(groupId)}`),
    "Failed to fetch photocard members",
  );
}

export async function fetchPhotocardSourceOrigins(groupId, categoryId) {
  return asJson(
    await req(
      `/pcs/photocards/source-origins?group_id=${encodeURIComponent(groupId)}` +
        `&category_id=${encodeURIComponent(categoryId)}`,
    ),
    "Failed to fetch source origins",
  );
}

export async function fetchTopLevelCategories() {
  // /pcs/ is photocard-only; any collection-type arg from callers is ignored.
  return asJson(await req("/pcs/categories"), "Failed to fetch top-level categories");
}

export async function fetchOwnershipStatuses() {
  // Guests see ALL statuses including Catalog (the point of the catalog view).
  return asJson(await req("/pcs/ownership-statuses"), "Failed to fetch ownership statuses");
}

// --- Writes (per-user annotations; scoped server-side to the caller) ---
// Signatures mirror guest/sqliteService so the /pcs write modals read the same.

export async function addPcsCardCopy({ catalogItemId, ownershipStatusId, notes = null }) {
  const data = await asJson(
    await req("/pcs/copies", jsonBody("POST", {
      catalog_item_id: catalogItemId,
      ownership_status_id: ownershipStatusId,
      notes,
    })),
    "Failed to add copy",
  );
  return data.copy_id;
}

export async function updatePcsCardCopy(copyId, { ownershipStatusId, notes } = {}) {
  // Partial update — only fields explicitly passed are sent. `notes: null`
  // clears; omitting notes leaves it untouched (backend uses exclude_unset).
  const body = {};
  if (ownershipStatusId !== undefined) body.ownership_status_id = ownershipStatusId;
  if (notes !== undefined) body.notes = notes;
  return asJson(
    await req(`/pcs/copies/${copyId}`, jsonBody("PUT", body)),
    "Failed to update copy",
  );
}

export async function deletePcsCardCopy(copyId) {
  return asJson(
    await req(`/pcs/copies/${copyId}`, { method: "DELETE" }),
    "Failed to delete copy",
  );
}

// Contribute a catalog image to a card's empty front/back slot. The upload
// becomes THE shared catalog image (first-write-wins; 409 if the side is
// already filled). Multipart — no JSON Content-Type, so the browser sets the
// multipart boundary itself. Keyed by item_id (matches tbl_attachments).
export async function uploadPcsImage(itemId, side, file) {
  const form = new FormData();
  form.append("file", file);
  return asJson(
    await req(`/pcs/photocards/${encodeURIComponent(itemId)}/upload-${side}`, {
      method: "POST",
      body: form,
    }),
    "Failed to upload image",
  );
}

// --- Migration: import a deprecated /guest/ WASM "Download Backup" file ---
// REPLACE strategy server-side (wipes this account's copies, then inserts the
// backup's). Pass the parsed backup JSON verbatim; returns import counts.
export async function importGuestBackup(snapshot) {
  return asJson(
    await req("/pcs/import-guest-backup", jsonBody("POST", snapshot)),
    "Failed to import guest backup",
  );
}

// --- Trades (server-backed per-user; mirrors the guest tier's local trades) ---

export async function createPcsTrade(body) {
  return asJson(await req("/pcs/trades", jsonBody("POST", body)), "Failed to create trade");
}

export async function listPcsTrades() {
  return asJson(await req("/pcs/trades"), "Failed to list trades");
}

export async function deletePcsTrade(slug) {
  return asJson(
    await req(`/pcs/trades/${encodeURIComponent(slug)}`, { method: "DELETE" }),
    "Failed to delete trade",
  );
}

export async function getPcsTradeDefaults() {
  return asJson(await req("/pcs/trade-defaults"), "Failed to load trade defaults");
}

export async function savePcsTradeDefaults(defaults) {
  return asJson(
    await req("/pcs/trade-defaults", jsonBody("PUT", defaults)),
    "Failed to save trade defaults",
  );
}
