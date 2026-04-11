const API = "http://127.0.0.1:8001";

async function handleJsonResponse(res, fallbackMessage) {
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(errorText || fallbackMessage);
  }
  return res.json();
}

// --- Shared lookups ---

export async function fetchHealth() {
  const res = await fetch(`${API}/health`);
  return handleJsonResponse(res, "Failed to fetch health status");
}

export async function fetchTopLevelCategories(collectionTypeId) {
  const res = await fetch(
    `${API}/categories?collection_type_id=${encodeURIComponent(collectionTypeId)}`
  );
  return handleJsonResponse(res, "Failed to fetch top-level categories");
}

export async function fetchOwnershipStatuses() {
  const res = await fetch(`${API}/ownership-statuses`);
  return handleJsonResponse(res, "Failed to fetch ownership statuses");
}

// --- Photocard lookups ---

export async function fetchPhotocardGroups() {
  const res = await fetch(`${API}/photocards/groups`);
  return handleJsonResponse(res, "Failed to fetch photocard groups");
}

export async function fetchPhotocardMembers(groupId) {
  const res = await fetch(
    `${API}/photocards/groups/${encodeURIComponent(groupId)}/members`
  );
  return handleJsonResponse(res, "Failed to fetch photocard members");
}

export async function fetchPhotocardSourceOrigins(groupId, categoryId) {
  const res = await fetch(
    `${API}/photocards/source-origins?group_id=${encodeURIComponent(groupId)}&category_id=${encodeURIComponent(categoryId)}`
  );
  return handleJsonResponse(res, "Failed to fetch photocard source origins");
}

export async function createPhotocardSourceOrigin({ groupId, categoryId, sourceOriginName }) {
  const res = await fetch(`${API}/photocards/source-origins`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      group_id: groupId,
      top_level_category_id: categoryId,
      source_origin_name: sourceOriginName,
    }),
  });
  return handleJsonResponse(res, "Failed to create photocard source origin");
}

// --- Photocard CRUD ---

export async function listPhotocards() {
  const res = await fetch(`${API}/photocards`);
  return handleJsonResponse(res, "Failed to fetch photocards");
}

export async function getPhotocard(itemId) {
  const res = await fetch(`${API}/photocards/${encodeURIComponent(itemId)}`);
  return handleJsonResponse(res, "Failed to fetch photocard");
}

export async function createPhotocard({
  collectionTypeId,
  topLevelCategoryId,
  ownershipStatusId,
  notes = null,
  groupId,
  sourceOriginId,
  version = null,
  memberIds,
}) {
  const res = await fetch(`${API}/photocards`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      collection_type_id: collectionTypeId,
      top_level_category_id: topLevelCategoryId,
      ownership_status_id: ownershipStatusId,
      notes,
      group_id: groupId,
      source_origin_id: sourceOriginId,
      version,
      member_ids: memberIds,
    }),
  });
  return handleJsonResponse(res, "Failed to create photocard");
}

export async function updatePhotocard(itemId, {
  topLevelCategoryId,
  ownershipStatusId,
  notes = null,
  sourceOriginId = null,
  version = null,
  memberIds,
}) {
  const res = await fetch(`${API}/photocards/${encodeURIComponent(itemId)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      top_level_category_id: topLevelCategoryId,
      ownership_status_id: ownershipStatusId,
      notes,
      source_origin_id: sourceOriginId,
      version,
      member_ids: memberIds,
    }),
  });
  return handleJsonResponse(res, "Failed to update photocard");
}

export async function deletePhotocard(itemId) {
  const res = await fetch(`${API}/photocards/${encodeURIComponent(itemId)}`, {
    method: "DELETE",
  });
  return handleJsonResponse(res, "Failed to delete photocard");
}

export async function bulkUpdatePhotocards(itemIds, fields) {
  const res = await fetch(`${API}/photocards/bulk`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ item_ids: itemIds, fields }),
  });
  return handleJsonResponse(res, "Failed to bulk update photocards");
}

export async function bulkDeletePhotocards(itemIds) {
  const res = await fetch(`${API}/photocards/bulk-delete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ item_ids: itemIds }),
  });
  return handleJsonResponse(res, "Failed to bulk delete photocards");
}

// --- Ingest ---

export async function fetchInbox() {
  const res = await fetch(`${API}/ingest/inbox`);
  return handleJsonResponse(res, "Failed to fetch inbox");
}

export async function deleteFromInbox(filename) {
  const res = await fetch(`${API}/ingest/inbox/${encodeURIComponent(filename)}`, {
    method: "DELETE",
  });
  return handleJsonResponse(res, "Failed to delete inbox file");
}

export async function uploadToInbox(file) {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${API}/ingest/upload`, { method: "POST", body: form });
  return handleJsonResponse(res, "Failed to upload file");
}

export async function ingestFront({
  inboxFilename,
  collectionTypeId,
  topLevelCategoryId,
  ownershipStatusId,
  notes = null,
  groupId,
  sourceOriginId = null,
  version = null,
  memberIds,
}) {
  const res = await fetch(`${API}/ingest/front`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      inbox_filename: inboxFilename,
      collection_type_id: collectionTypeId,
      top_level_category_id: topLevelCategoryId,
      ownership_status_id: ownershipStatusId,
      notes,
      group_id: groupId,
      source_origin_id: sourceOriginId,
      version,
      member_ids: memberIds,
    }),
  });
  return handleJsonResponse(res, "Failed to ingest front image");
}

export async function fetchIngestCandidates(groupId, categoryId, missingBackOnly = true, memberIds = []) {
  const params = new URLSearchParams({
    group_id: groupId,
    category_id: categoryId,
    missing_back_only: missingBackOnly,
  });
  for (const id of memberIds) {
    params.append("member_ids", id);
  }
  const res = await fetch(`${API}/ingest/candidates?${params}`);
  return handleJsonResponse(res, "Failed to fetch candidates");
}

export async function ingestPair({
  frontFilename,
  backFilename,
  collectionTypeId,
  topLevelCategoryId,
  ownershipStatusId,
  notes = null,
  groupId,
  sourceOriginId = null,
  version = null,
  memberIds,
}) {
  const res = await fetch(`${API}/ingest/pair`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      front_filename: frontFilename,
      back_filename: backFilename,
      collection_type_id: collectionTypeId,
      top_level_category_id: topLevelCategoryId,
      ownership_status_id: ownershipStatusId,
      notes,
      group_id: groupId,
      source_origin_id: sourceOriginId,
      version,
      member_ids: memberIds,
    }),
  });
  return handleJsonResponse(res, "Failed to ingest pair");
}

export async function attachBack(inboxFilename, itemId) {
  const res = await fetch(`${API}/ingest/attach-back`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ inbox_filename: inboxFilename, item_id: itemId }),
  });
  return handleJsonResponse(res, "Failed to attach back image");
}

export async function replaceFrontImage(itemId, file) {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${API}/photocards/${encodeURIComponent(itemId)}/replace-front`, {
    method: "POST",
    body: form,
  });
  return handleJsonResponse(res, "Failed to replace front image");
}

export async function replaceBackImage(itemId, file) {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${API}/photocards/${encodeURIComponent(itemId)}/replace-back`, {
    method: "POST",
    body: form,
  });
  return handleJsonResponse(res, "Failed to replace back image");
}

// --- Books lookups ---

export async function fetchBookGenres(categoryScopeId) {
  const url = categoryScopeId
    ? `${API}/books/genres?category_scope_id=${encodeURIComponent(categoryScopeId)}`
    : `${API}/books/genres`;
  const res = await fetch(url);
  return handleJsonResponse(res, "Failed to fetch book genres");
}

export async function fetchBookFormatDetails() {
  const res = await fetch(`${API}/books/format-details`);
  return handleJsonResponse(res, "Failed to fetch book format details");
}

export async function fetchBookAgeLevels() {
  const res = await fetch(`${API}/books/age-levels`);
  return handleJsonResponse(res, "Failed to fetch book age levels");
}

export async function fetchBookReadStatuses() {
  const res = await fetch(`${API}/books/read-statuses`);
  return handleJsonResponse(res, "Failed to fetch book read statuses");
}

export async function searchBookAuthors(q) {
  const url = q
    ? `${API}/books/authors?q=${encodeURIComponent(q)}`
    : `${API}/books/authors`;
  const res = await fetch(url);
  return handleJsonResponse(res, "Failed to fetch book authors");
}

export async function searchBookSeries(q) {
  const url = q
    ? `${API}/books/series?q=${encodeURIComponent(q)}`
    : `${API}/books/series`;
  const res = await fetch(url);
  return handleJsonResponse(res, "Failed to fetch book series");
}

export async function searchBookTags(q) {
  const url = q
    ? `${API}/books/tags?q=${encodeURIComponent(q)}`
    : `${API}/books/tags`;
  const res = await fetch(url);
  return handleJsonResponse(res, "Failed to fetch book tags");
}

export async function searchBooksExternal(q) {
  const res = await fetch(`${API}/books/search-external?q=${encodeURIComponent(q)}`);
  return handleJsonResponse(res, "Failed to search external books");
}

export async function lookupBookIsbn(isbn) {
  const res = await fetch(`${API}/books/lookup-isbn?isbn=${encodeURIComponent(isbn)}`);
  return handleJsonResponse(res, "Failed to lookup ISBN");
}

// --- Books CRUD ---

export async function listBooks() {
  const res = await fetch(`${API}/books`);
  return handleJsonResponse(res, "Failed to fetch books");
}

export async function getBook(itemId) {
  const res = await fetch(`${API}/books/${encodeURIComponent(itemId)}`);
  return handleJsonResponse(res, "Failed to fetch book");
}

export async function createBook(payload) {
  const res = await fetch(`${API}/books`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return handleJsonResponse(res, "Failed to create book");
}

export async function updateBook(itemId, payload) {
  const res = await fetch(`${API}/books/${encodeURIComponent(itemId)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return handleJsonResponse(res, "Failed to update book");
}

export async function deleteBook(itemId) {
  const res = await fetch(`${API}/books/${encodeURIComponent(itemId)}`, {
    method: "DELETE",
  });
  return handleJsonResponse(res, "Failed to delete book");
}

export async function bulkUpdateBooks(itemIds, fields) {
  const res = await fetch(`${API}/books/bulk`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ item_ids: itemIds, fields }),
  });
  return handleJsonResponse(res, "Failed to bulk update books");
}

export async function bulkDeleteBooks(itemIds) {
  const res = await fetch(`${API}/books/bulk-delete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ item_ids: itemIds }),
  });
  return handleJsonResponse(res, "Failed to bulk delete books");
}

// --- Graphic Novels lookups ---

export async function fetchGnPublishers() {
  const res = await fetch(`${API}/graphicnovels/publishers`);
  return handleJsonResponse(res, "Failed to fetch publishers");
}

export async function createGnPublisher(publisherName) {
  const res = await fetch(`${API}/graphicnovels/publishers`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ publisher_name: publisherName }),
  });
  return handleJsonResponse(res, "Failed to create publisher");
}

export async function fetchGnFormatTypes() {
  const res = await fetch(`${API}/graphicnovels/format-types`);
  return handleJsonResponse(res, "Failed to fetch format types");
}

export async function fetchGnEras() {
  const res = await fetch(`${API}/graphicnovels/eras`);
  return handleJsonResponse(res, "Failed to fetch eras");
}

export async function searchGnWriters(q) {
  const url = q
    ? `${API}/graphicnovels/writers?q=${encodeURIComponent(q)}`
    : `${API}/graphicnovels/writers`;
  const res = await fetch(url);
  return handleJsonResponse(res, "Failed to fetch writers");
}

export async function searchGnArtists(q) {
  const url = q
    ? `${API}/graphicnovels/artists?q=${encodeURIComponent(q)}`
    : `${API}/graphicnovels/artists`;
  const res = await fetch(url);
  return handleJsonResponse(res, "Failed to fetch artists");
}

export async function searchGnTags(q) {
  const url = q
    ? `${API}/graphicnovels/tags?q=${encodeURIComponent(q)}`
    : `${API}/graphicnovels/tags`;
  const res = await fetch(url);
  return handleJsonResponse(res, "Failed to fetch graphic novel tags");
}

export async function lookupGnIsbn(isbn, source = "all") {
  const res = await fetch(`${API}/graphicnovels/lookup-isbn?isbn=${encodeURIComponent(isbn)}&source=${source}`);
  return handleJsonResponse(res, "Failed to lookup ISBN");
}

export async function searchGnExternal(q, source = "comicvine") {
  const res = await fetch(`${API}/graphicnovels/search-external?q=${encodeURIComponent(q)}&source=${source}`);
  return handleJsonResponse(res, "External search failed");
}

export async function fixGnCovers() {
  const res = await fetch(`${API}/graphicnovels/fix-covers`, { method: "POST" });
  return handleJsonResponse(res, "Fix covers failed");
}

// --- Graphic Novels CRUD ---

export async function listGraphicNovels() {
  const res = await fetch(`${API}/graphicnovels`);
  return handleJsonResponse(res, "Failed to fetch graphic novels");
}

export async function getGraphicNovel(itemId) {
  const res = await fetch(`${API}/graphicnovels/${encodeURIComponent(itemId)}`);
  return handleJsonResponse(res, "Failed to fetch graphic novel");
}

export async function createGraphicNovel(payload) {
  const res = await fetch(`${API}/graphicnovels`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return handleJsonResponse(res, "Failed to create graphic novel");
}

export async function updateGraphicNovel(itemId, payload) {
  const res = await fetch(`${API}/graphicnovels/${encodeURIComponent(itemId)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return handleJsonResponse(res, "Failed to update graphic novel");
}

export async function deleteGraphicNovel(itemId) {
  const res = await fetch(`${API}/graphicnovels/${encodeURIComponent(itemId)}`, {
    method: "DELETE",
  });
  return handleJsonResponse(res, "Failed to delete graphic novel");
}

export async function bulkUpdateGraphicNovels(itemIds, fields) {
  const res = await fetch(`${API}/graphicnovels/bulk`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ item_ids: itemIds, fields }),
  });
  return handleJsonResponse(res, "Failed to bulk update graphic novels");
}

export async function bulkDeleteGraphicNovels(itemIds) {
  const res = await fetch(`${API}/graphicnovels/bulk-delete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ item_ids: itemIds }),
  });
  return handleJsonResponse(res, "Failed to bulk delete graphic novels");
}

// --- Settings ---

export async function fetchSettings() {
  const res = await fetch(`${API}/settings`);
  return handleJsonResponse(res, "Failed to fetch settings");
}

export async function updateSetting(key, value) {
  const res = await fetch(`${API}/settings/${encodeURIComponent(key)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ value }),
  });
  return handleJsonResponse(res, "Failed to update setting");
}

// --- Admin: Backup & Restore ---

export async function downloadBackup() {
  const res = await fetch(`${API}/admin/backup`);
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(errorText || "Backup failed.");
  }
  // Extract filename from Content-Disposition header if present
  const disposition = res.headers.get("Content-Disposition") || "";
  const match = disposition.match(/filename=([^\s;]+)/);
  const filename = match ? match[1] : "collectcore_backup.zip";
  const blob = await res.blob();
  return { blob, filename };
}

export async function restoreBackup(file) {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${API}/admin/restore`, { method: "POST", body: form });
  return handleJsonResponse(res, "Restore failed.");
}

// --- Export ---

export async function exportPhotocards({ itemIds, includeCaptions, includeBacks }) {
  const res = await fetch(`${API}/export/photocards`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      item_ids: itemIds,
      include_captions: includeCaptions,
      include_backs: includeBacks,
    }),
  });
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(errorText || "Export failed.");
  }
  return res.blob();
}
