const API = import.meta.env.VITE_API_BASE_URL ?? '';

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

export async function fetchTopLevelCategories(collectionTypeIdOrCode) {
  const param = typeof collectionTypeIdOrCode === "string"
    ? `collection_type_code=${encodeURIComponent(collectionTypeIdOrCode)}`
    : `collection_type_id=${encodeURIComponent(collectionTypeIdOrCode)}`;
  const res = await fetch(`${API}/categories?${param}`);
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
  isSpecial = false,
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
      is_special: isSpecial,
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
  isSpecial = false,
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
      is_special: isSpecial,
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
  isSpecial = false,
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
      is_special: isSpecial,
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

export async function prepareBackup() {
  const res = await fetch(`${API}/admin/backup/prepare`, { method: "POST" });
  return handleJsonResponse(res, "Backup preparation failed.");
}

export async function downloadBackupByToken(token, onProgress) {
  const res = await fetch(`${API}/admin/backup/download/${token}`);
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(errorText || "Backup download failed.");
  }
  const contentLength = parseInt(res.headers.get("Content-Length") || "0", 10);
  const disposition = res.headers.get("Content-Disposition") || "";
  const match = disposition.match(/filename=([^\s;]+)/);
  const filename = match ? match[1] : "collectcore_backup.zip";

  if (!contentLength || !res.body) {
    const blob = await res.blob();
    return { blob, filename };
  }

  const reader = res.body.getReader();
  const chunks = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    if (onProgress) onProgress(received, contentLength);
  }
  const blob = new Blob(chunks);
  return { blob, filename };
}

export async function downloadBackup() {
  const res = await fetch(`${API}/admin/backup`);
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(errorText || "Backup failed.");
  }
  const disposition = res.headers.get("Content-Disposition") || "";
  const match = disposition.match(/filename=([^\s;]+)/);
  const filename = match ? match[1] : "collectcore_backup.zip";
  const blob = await res.blob();
  return { blob, filename };
}

export async function uploadCover(file, module, itemId = null) {
  const form = new FormData();
  form.append("file", file);
  let url = `${API}/upload-cover?module=${encodeURIComponent(module)}`;
  if (itemId != null) url += `&item_id=${itemId}`;
  const res = await fetch(url, { method: "POST", body: form });
  return handleJsonResponse(res, "Cover upload failed.");
}

export async function restoreBackup(file) {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${API}/admin/restore`, { method: "POST", body: form });
  return handleJsonResponse(res, "Restore failed.");
}

// --- Admin: Unused Lookup Cleanup ---

export async function scanUnusedLookups() {
  const res = await fetch(`${API}/admin/unused-lookups`);
  return handleJsonResponse(res, "Failed to scan unused lookups.");
}

export async function deactivateLookups(table, ids) {
  const res = await fetch(`${API}/admin/deactivate-lookups`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ table, ids }),
  });
  return handleJsonResponse(res, "Failed to deactivate lookups.");
}

// --- Video Games ---

export async function fetchGameGenres() {
  const res = await fetch(`${API}/videogames/genres`);
  return handleJsonResponse(res, "Failed to fetch game genres");
}

export async function fetchGameDevelopers(q) {
  const url = q ? `${API}/videogames/developers?q=${encodeURIComponent(q)}` : `${API}/videogames/developers`;
  const res = await fetch(url);
  return handleJsonResponse(res, "Failed to fetch game developers");
}

export async function fetchGamePublishers(q) {
  const url = q ? `${API}/videogames/publishers?q=${encodeURIComponent(q)}` : `${API}/videogames/publishers`;
  const res = await fetch(url);
  return handleJsonResponse(res, "Failed to fetch game publishers");
}

export async function fetchGamePlatforms() {
  const res = await fetch(`${API}/videogames/platforms`);
  return handleJsonResponse(res, "Failed to fetch game platforms");
}

export async function rawgSearchGames(q) {
  const res = await fetch(`${API}/videogames/rawg-search?q=${encodeURIComponent(q)}`);
  return handleJsonResponse(res, "Failed to search RAWG");
}

export async function fetchGamePlayStatuses() {
  const res = await fetch(`${API}/videogames/play-statuses`);
  return handleJsonResponse(res, "Failed to fetch play statuses");
}

export async function listVideoGames() {
  const res = await fetch(`${API}/videogames`);
  return handleJsonResponse(res, "Failed to fetch video games");
}

export async function getVideoGame(itemId) {
  const res = await fetch(`${API}/videogames/${encodeURIComponent(itemId)}`);
  return handleJsonResponse(res, "Failed to fetch video game");
}

export async function createVideoGame(payload) {
  const res = await fetch(`${API}/videogames`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return handleJsonResponse(res, "Failed to create video game");
}

export async function updateVideoGame(itemId, payload) {
  const res = await fetch(`${API}/videogames/${encodeURIComponent(itemId)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return handleJsonResponse(res, "Failed to update video game");
}

export async function deleteVideoGame(itemId) {
  const res = await fetch(`${API}/videogames/${encodeURIComponent(itemId)}`, {
    method: "DELETE",
  });
  return handleJsonResponse(res, "Failed to delete video game");
}

export async function bulkUpdateVideoGames(itemIds, fields) {
  const res = await fetch(`${API}/videogames/bulk`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ item_ids: itemIds, fields }),
  });
  return handleJsonResponse(res, "Failed to bulk update video games");
}

export async function bulkDeleteVideoGames(itemIds) {
  const res = await fetch(`${API}/videogames/bulk-delete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ item_ids: itemIds }),
  });
  return handleJsonResponse(res, "Failed to bulk delete video games");
}

// --- Music ---

export async function fetchMusicReleaseTypes() {
  const res = await fetch(`${API}/music/release-types`);
  return handleJsonResponse(res, "Failed to fetch music release types");
}

export async function fetchMusicFormatTypes() {
  const res = await fetch(`${API}/music/format-types`);
  return handleJsonResponse(res, "Failed to fetch music format types");
}

export async function fetchMusicGenres() {
  const res = await fetch(`${API}/music/genres`);
  return handleJsonResponse(res, "Failed to fetch music genres");
}

export async function searchMusicArtists(q) {
  const params = q ? `?q=${encodeURIComponent(q)}` : "";
  const res = await fetch(`${API}/music/artists${params}`);
  return handleJsonResponse(res, "Failed to search music artists");
}

export async function listMusicReleases(params = {}) {
  const qs = new URLSearchParams();
  if (params.search) qs.set("search", params.search);
  if (params.release_type_id) qs.set("release_type_id", params.release_type_id);
  if (params.ownership_status_id) qs.set("ownership_status_id", params.ownership_status_id);
  const res = await fetch(`${API}/music?${qs}`);
  return handleJsonResponse(res, "Failed to list music releases");
}

export async function getMusicRelease(itemId) {
  const res = await fetch(`${API}/music/${encodeURIComponent(itemId)}`);
  return handleJsonResponse(res, "Failed to get music release");
}

export async function createMusicRelease(payload) {
  const res = await fetch(`${API}/music`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return handleJsonResponse(res, "Failed to create music release");
}

export async function updateMusicRelease(itemId, payload) {
  const res = await fetch(`${API}/music/${encodeURIComponent(itemId)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return handleJsonResponse(res, "Failed to update music release");
}

export async function deleteMusicRelease(itemId) {
  const res = await fetch(`${API}/music/${encodeURIComponent(itemId)}`, {
    method: "DELETE",
  });
  return handleJsonResponse(res, "Failed to delete music release");
}

export async function bulkUpdateMusic(itemIds, fields) {
  const res = await fetch(`${API}/music/bulk`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ item_ids: itemIds, fields }),
  });
  return handleJsonResponse(res, "Failed to bulk update music releases");
}

export async function bulkDeleteMusic(itemIds) {
  const res = await fetch(`${API}/music/bulk-delete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ item_ids: itemIds }),
  });
  return handleJsonResponse(res, "Failed to bulk delete music releases");
}

export async function discogsSearchMusic(q) {
  const params = new URLSearchParams({ q });
  const res = await fetch(`${API}/music/discogs-search?${params}`);
  return handleJsonResponse(res, "Discogs search failed");
}

export async function discogsFetchMaster(masterId) {
  const res = await fetch(`${API}/music/discogs-master/${encodeURIComponent(masterId)}`);
  return handleJsonResponse(res, "Failed to fetch Discogs master");
}

// --- Video ---

export async function fetchVideoCategories() {
  const res = await fetch(`${API}/video/categories`);
  return handleJsonResponse(res, "Failed to fetch video categories");
}

export async function fetchVideoFormatTypes() {
  const res = await fetch(`${API}/video/format-types`);
  return handleJsonResponse(res, "Failed to fetch video format types");
}

export async function fetchVideoGenres() {
  const res = await fetch(`${API}/video/genres`);
  return handleJsonResponse(res, "Failed to fetch video genres");
}

export async function fetchVideoWatchStatuses() {
  const res = await fetch(`${API}/video/watch-statuses`);
  return handleJsonResponse(res, "Failed to fetch watch statuses");
}

export async function tmdbSearch(q, mediaType = "movie") {
  const params = new URLSearchParams({ q, media_type: mediaType });
  const res = await fetch(`${API}/video/tmdb-search?${params}`);
  return handleJsonResponse(res, "TMDB search failed");
}

export async function tmdbDetail(tmdbId, mediaType = "movie") {
  const params = new URLSearchParams({ media_type: mediaType });
  const res = await fetch(`${API}/video/tmdb-detail/${encodeURIComponent(tmdbId)}?${params}`);
  return handleJsonResponse(res, "Failed to fetch TMDB detail");
}

export async function listVideo(params = {}) {
  const qs = new URLSearchParams();
  if (params.search) qs.set("search", params.search);
  if (params.video_type_id) qs.set("video_type_id", params.video_type_id);
  if (params.ownership_status_id) qs.set("ownership_status_id", params.ownership_status_id);
  if (params.reading_status_id) qs.set("reading_status_id", params.reading_status_id);
  const res = await fetch(`${API}/video?${qs}`);
  return handleJsonResponse(res, "Failed to list video");
}

export async function getVideo(itemId) {
  const res = await fetch(`${API}/video/${encodeURIComponent(itemId)}`);
  return handleJsonResponse(res, "Failed to get video");
}

export async function createVideo(payload) {
  const res = await fetch(`${API}/video`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return handleJsonResponse(res, "Failed to create video");
}

export async function updateVideo(itemId, payload) {
  const res = await fetch(`${API}/video/${encodeURIComponent(itemId)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return handleJsonResponse(res, "Failed to update video");
}

export async function deleteVideo(itemId) {
  const res = await fetch(`${API}/video/${encodeURIComponent(itemId)}`, {
    method: "DELETE",
  });
  return handleJsonResponse(res, "Failed to delete video");
}

export async function bulkUpdateVideo(itemIds, fields) {
  const res = await fetch(`${API}/video/bulk`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ item_ids: itemIds, fields }),
  });
  return handleJsonResponse(res, "Failed to bulk update video");
}

export async function bulkDeleteVideo(itemIds) {
  const res = await fetch(`${API}/video/bulk-delete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ item_ids: itemIds }),
  });
  return handleJsonResponse(res, "Failed to bulk delete video");
}

// --- Board Games ---

export async function fetchBoardgameCategories() {
  const res = await fetch(`${API}/boardgames/categories`);
  return handleJsonResponse(res, "Failed to fetch board game categories");
}

export async function fetchBoardgameDesigners(q) {
  const url = q ? `${API}/boardgames/designers?q=${encodeURIComponent(q)}` : `${API}/boardgames/designers`;
  const res = await fetch(url);
  return handleJsonResponse(res, "Failed to fetch board game designers");
}

export async function fetchBoardgamePublishers(q) {
  const url = q ? `${API}/boardgames/publishers?q=${encodeURIComponent(q)}` : `${API}/boardgames/publishers`;
  const res = await fetch(url);
  return handleJsonResponse(res, "Failed to fetch board game publishers");
}

export async function bggSearchGames(q) {
  const res = await fetch(`${API}/boardgames/bgg-search?q=${encodeURIComponent(q)}`);
  return handleJsonResponse(res, "Failed to search BGG");
}

export async function bggGetDetail(bggId) {
  const res = await fetch(`${API}/boardgames/bgg-detail/${encodeURIComponent(bggId)}`);
  return handleJsonResponse(res, "Failed to fetch BGG detail");
}

export async function listBoardgames() {
  const res = await fetch(`${API}/boardgames`);
  return handleJsonResponse(res, "Failed to fetch board games");
}

export async function getBoardgame(itemId) {
  const res = await fetch(`${API}/boardgames/${encodeURIComponent(itemId)}`);
  return handleJsonResponse(res, "Failed to fetch board game");
}

export async function createBoardgame(data) {
  const res = await fetch(`${API}/boardgames`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return handleJsonResponse(res, "Failed to create board game");
}

export async function updateBoardgame(itemId, data) {
  const res = await fetch(`${API}/boardgames/${encodeURIComponent(itemId)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return handleJsonResponse(res, "Failed to update board game");
}

export async function deleteBoardgame(itemId) {
  const res = await fetch(`${API}/boardgames/${encodeURIComponent(itemId)}`, { method: "DELETE" });
  return handleJsonResponse(res, "Failed to delete board game");
}

export async function bulkUpdateBoardgames(itemIds, fields) {
  const res = await fetch(`${API}/boardgames/bulk`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ item_ids: itemIds, fields }),
  });
  return handleJsonResponse(res, "Failed to bulk update board games");
}

export async function bulkDeleteBoardgames(itemIds) {
  const res = await fetch(`${API}/boardgames/bulk-delete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ item_ids: itemIds }),
  });
  return handleJsonResponse(res, "Failed to bulk delete board games");
}

// --- TTRPG ---

export async function fetchTtrpgSystems() {
  const res = await fetch(`${API}/ttrpg/systems`);
  return handleJsonResponse(res, "Failed to fetch TTRPG systems");
}

export async function fetchTtrpgSystemEditions(systemId) {
  const url = systemId ? `${API}/ttrpg/system-editions?system_id=${systemId}` : `${API}/ttrpg/system-editions`;
  const res = await fetch(url);
  return handleJsonResponse(res, "Failed to fetch TTRPG system editions");
}

export async function fetchTtrpgLines(systemId) {
  const url = systemId ? `${API}/ttrpg/lines?system_id=${systemId}` : `${API}/ttrpg/lines`;
  const res = await fetch(url);
  return handleJsonResponse(res, "Failed to fetch TTRPG lines");
}

export async function fetchTtrpgBookTypes() {
  const res = await fetch(`${API}/ttrpg/book-types`);
  return handleJsonResponse(res, "Failed to fetch TTRPG book types");
}

export async function fetchTtrpgFormatTypes() {
  const res = await fetch(`${API}/ttrpg/format-types`);
  return handleJsonResponse(res, "Failed to fetch TTRPG format types");
}

export async function fetchTtrpgPublishers(q) {
  const url = q ? `${API}/ttrpg/publishers?q=${encodeURIComponent(q)}` : `${API}/ttrpg/publishers`;
  const res = await fetch(url);
  return handleJsonResponse(res, "Failed to fetch TTRPG publishers");
}

export async function fetchTtrpgAuthors(q) {
  const url = q ? `${API}/ttrpg/authors?q=${encodeURIComponent(q)}` : `${API}/ttrpg/authors`;
  const res = await fetch(url);
  return handleJsonResponse(res, "Failed to fetch TTRPG authors");
}

export async function listTtrpg() {
  const res = await fetch(`${API}/ttrpg`);
  return handleJsonResponse(res, "Failed to fetch TTRPG books");
}

export async function getTtrpg(itemId) {
  const res = await fetch(`${API}/ttrpg/${encodeURIComponent(itemId)}`);
  return handleJsonResponse(res, "Failed to fetch TTRPG book");
}

export async function createTtrpg(data) {
  const res = await fetch(`${API}/ttrpg`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return handleJsonResponse(res, "Failed to create TTRPG book");
}

export async function updateTtrpg(itemId, data) {
  const res = await fetch(`${API}/ttrpg/${encodeURIComponent(itemId)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return handleJsonResponse(res, "Failed to update TTRPG book");
}

export async function deleteTtrpg(itemId) {
  const res = await fetch(`${API}/ttrpg/${encodeURIComponent(itemId)}`, { method: "DELETE" });
  return handleJsonResponse(res, "Failed to delete TTRPG book");
}

export async function bulkUpdateTtrpg(payload) {
  const res = await fetch(`${API}/ttrpg/bulk`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return handleJsonResponse(res, "Failed to bulk update TTRPG");
}

export async function bulkDeleteTtrpg(payload) {
  const res = await fetch(`${API}/ttrpg/bulk-delete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return handleJsonResponse(res, "Failed to bulk delete TTRPG");
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
