const API = "http://127.0.0.1:8001";

/**
 * Small helper so API errors come back with useful text.
 */
async function handleJsonResponse(res, fallbackMessage) {
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(errorText || fallbackMessage);
  }
  return res.json();
}

/**
 * ------------------------------------------------------------------
 * CollectCore - current active endpoints
 * ------------------------------------------------------------------
 */

export async function fetchHealth() {
  const res = await fetch(`${API}/health`);
  return handleJsonResponse(res, "Failed to fetch health status");
}

export async function fetchTopLevelCategories(collectionTypeId) {
  const res = await fetch(
    `${API}/categories?collection_type_id=${encodeURIComponent(
      collectionTypeId
    )}`
  );
  return handleJsonResponse(res, "Failed to fetch top-level categories");
}

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
    `${API}/photocards/source-origins?group_id=${encodeURIComponent(
      groupId
    )}&category_id=${encodeURIComponent(categoryId)}`
  );
  return handleJsonResponse(res, "Failed to fetch photocard source origins");
}

export async function createPhotocardSourceOrigin({
  groupId,
  categoryId,
  sourceOriginName,
}) {
  const res = await fetch(`${API}/photocards/source-origins`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      group_id: groupId,
      top_level_category_id: categoryId,
      source_origin_name: sourceOriginName,
    }),
  });

  return handleJsonResponse(
    res,
    "Failed to create photocard source origin"
  );
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
    headers: {
      "Content-Type": "application/json",
    },
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

export async function listPhotocards() {
  const res = await fetch(`${API}/photocards`);
  return handleJsonResponse(res, "Failed to fetch photocards");
}

/**
 * ------------------------------------------------------------------
 * Legacy exports kept temporarily so old imports do not break.
 * These belong to the old PhotocardTracker workflow and are not yet
 * implemented in CollectCore.
 * ------------------------------------------------------------------
 */

function legacyNotImplemented(fnName) {
  throw new Error(
    `${fnName} is part of the old PhotocardTracker API flow and has not been rebuilt for CollectCore yet.`
  );
}

export async function fetchInbox() {
  return legacyNotImplemented("fetchInbox");
}

export async function fetchSubcategoryOptions() {
  return legacyNotImplemented("fetchSubcategoryOptions");
}

export async function fetchSourceOptions() {
  return legacyNotImplemented("fetchSourceOptions");
}

export async function ingestFront() {
  return legacyNotImplemented("ingestFront");
}

export async function fetchCardCandidates() {
  return legacyNotImplemented("fetchCardCandidates");
}

export async function attachBack() {
  return legacyNotImplemented("attachBack");
}