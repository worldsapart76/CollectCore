// Phase 7b: data-source adapter for guest mode.
//
// Mirrors the read-only subset of api.js that PhotocardLibraryPage and its
// dependents call. Each export here matches the admin endpoint's response
// shape verbatim — same field names, same order — so the page code doesn't
// branch on isAdmin for data shape, only for which adapter to call.
//
// Write operations are NOT exported here. Guest mode hides the admin write
// UI at the page level; the write paths in api.js are never reached. Guest's
// own writes (annotations) go through sqliteService directly via
// addGuestCardCopy / updateGuestCardCopy / deleteGuestCardCopy.
//
// All reads go through the worker via sqliteService.query(). Members + copies
// arrays are aggregated in JS rather than via SQLite GROUP_CONCAT/json_group
// — clearer, easier to evolve, performance is fine at <100k rows on modern
// devices.

import { query } from "./sqliteService";

// Admin's listPhotocards returns this shape per card:
// {
//   item_id, group_id, group_name, top_level_category_id, category,
//   notes, source_origin_id, source_origin, version,
//   members: [name strings],
//   front_image_path, back_image_path, is_special,
//   copies: [{ copy_id, ownership_status_id, ownership_status, notes }]
// }
//
// Guest reproduces it from the synced lookup tables + tbl_items +
// tbl_photocard_details + tbl_attachments (catalog data, sync-overwritten)
// and substitutes guest_card_copies for tbl_photocard_copies. The
// ownership_status column comes from the synced lkup_ownership_statuses
// (admin's vocabulary is the source of truth).
export async function listPhotocards() {
  const cardRows = await query(`
    SELECT
      i.item_id,
      i.catalog_item_id,
      g.group_id,
      g.group_name,
      i.top_level_category_id,
      c.category_name AS category,
      i.notes,
      d.source_origin_id,
      so.source_origin_name AS source_origin,
      d.version,
      d.is_special
    FROM tbl_items i
    JOIN tbl_photocard_details d ON d.item_id = i.item_id
    JOIN lkup_photocard_groups g ON g.group_id = d.group_id
    JOIN lkup_top_level_categories c ON c.top_level_category_id = i.top_level_category_id
    LEFT JOIN lkup_photocard_source_origins so ON so.source_origin_id = d.source_origin_id
    WHERE i.catalog_item_id IS NOT NULL
      AND i.collection_type_id = (
        SELECT collection_type_id FROM lkup_collection_types WHERE collection_type_code = 'photocards'
      )
    ORDER BY i.item_id
  `);

  if (!cardRows.length) return [];

  const itemIds = cardRows.map((r) => r.item_id);
  const catalogItemIds = cardRows.map((r) => r.catalog_item_id);

  // Members → array of name strings per item_id.
  const memberRows = await query(
    `SELECT x.item_id, m.member_name
     FROM xref_photocard_members x
     JOIN lkup_photocard_members m ON m.member_id = x.member_id
     WHERE x.item_id IN (${itemIds.map(() => "?").join(",")})
     ORDER BY m.member_id`,
    itemIds,
  );
  const membersByItem = new Map();
  for (const r of memberRows) {
    if (!membersByItem.has(r.item_id)) membersByItem.set(r.item_id, []);
    membersByItem.get(r.item_id).push(r.member_name);
  }

  // Front + back image URLs from tbl_attachments.
  const attRows = await query(
    `SELECT item_id, attachment_type, file_path
     FROM tbl_attachments
     WHERE item_id IN (${itemIds.map(() => "?").join(",")})
       AND attachment_type IN ('front', 'back')`,
    itemIds,
  );
  const attsByItem = new Map();
  for (const r of attRows) {
    if (!attsByItem.has(r.item_id)) attsByItem.set(r.item_id, {});
    attsByItem.get(r.item_id)[r.attachment_type] = r.file_path;
  }

  // Guest copies — keyed by catalog_item_id (not item_id), per the
  // schema-separation contract. Each catalog card may have 0..N guest copies.
  const copyRows = await query(
    `SELECT gc.copy_id, gc.catalog_item_id, gc.ownership_status_id, os.status_name, gc.notes
     FROM guest_card_copies gc
     JOIN lkup_ownership_statuses os ON os.ownership_status_id = gc.ownership_status_id
     WHERE gc.catalog_item_id IN (${catalogItemIds.map(() => "?").join(",")})
     ORDER BY gc.copy_id`,
    catalogItemIds,
  );
  const copiesByCatalogId = new Map();
  for (const r of copyRows) {
    if (!copiesByCatalogId.has(r.catalog_item_id)) {
      copiesByCatalogId.set(r.catalog_item_id, []);
    }
    copiesByCatalogId.get(r.catalog_item_id).push({
      copy_id: r.copy_id,
      ownership_status_id: r.ownership_status_id,
      ownership_status: r.status_name,
      notes: r.notes,
    });
  }

  return cardRows.map((r) => {
    const att = attsByItem.get(r.item_id) || {};
    return {
      item_id: r.item_id,
      // Expose catalog_item_id too — guest's add/update/delete copy calls
      // need it. Admin response has no equivalent (admin keys by item_id).
      catalog_item_id: r.catalog_item_id,
      group_id: r.group_id,
      group_name: r.group_name,
      top_level_category_id: r.top_level_category_id,
      category: r.category,
      notes: r.notes,
      source_origin_id: r.source_origin_id,
      source_origin: r.source_origin,
      version: r.version,
      members: membersByItem.get(r.item_id) || [],
      front_image_path: att.front || null,
      back_image_path: att.back || null,
      is_special: !!r.is_special,
      copies: copiesByCatalogId.get(r.catalog_item_id) || [],
    };
  });
}

export async function fetchPhotocardGroups() {
  return query(
    `SELECT group_id, group_code, group_name, sort_order, is_active
     FROM lkup_photocard_groups
     WHERE is_active = 1
     ORDER BY sort_order, group_name`,
  );
}

export async function fetchPhotocardMembers(groupId) {
  return query(
    `SELECT member_id, group_id, member_code, member_name, sort_order, is_active
     FROM lkup_photocard_members
     WHERE group_id = ? AND is_active = 1
     ORDER BY sort_order, member_name`,
    [groupId],
  );
}

export async function fetchPhotocardSourceOrigins(groupId, categoryId) {
  return query(
    `SELECT source_origin_id, group_id, top_level_category_id, source_origin_name, sort_order, is_active
     FROM lkup_photocard_source_origins
     WHERE group_id = ? AND top_level_category_id = ? AND is_active = 1
     ORDER BY sort_order, source_origin_name`,
    [groupId, categoryId],
  );
}

// Admin's fetchTopLevelCategories accepts either a numeric collection_type_id
// or the code string ("photocards"). We support both for parity.
export async function fetchTopLevelCategories(collectionTypeIdOrCode) {
  if (typeof collectionTypeIdOrCode === "string") {
    return query(
      `SELECT c.top_level_category_id, c.collection_type_id, c.category_name, c.sort_order, c.is_active
       FROM lkup_top_level_categories c
       JOIN lkup_collection_types t ON t.collection_type_id = c.collection_type_id
       WHERE t.collection_type_code = ? AND c.is_active = 1
       ORDER BY c.sort_order, c.category_name`,
      [collectionTypeIdOrCode],
    );
  }
  return query(
    `SELECT top_level_category_id, collection_type_id, category_name, sort_order, is_active
     FROM lkup_top_level_categories
     WHERE collection_type_id = ? AND is_active = 1
     ORDER BY sort_order, category_name`,
    [collectionTypeIdOrCode],
  );
}

// Guest sees ALL ownership statuses INCLUDING Catalog (per user's call —
// "Catalog should be in the guest filter, that's the entire point — guest
// filters to Catalog to see what they could collect"). Admin filters Catalog
// out; that branch lives in api.js.
export async function fetchOwnershipStatuses(collectionTypeId = null) {
  if (collectionTypeId == null) {
    return query(
      `SELECT ownership_status_id, status_code, status_name, sort_order, is_active
       FROM lkup_ownership_statuses
       WHERE is_active = 1
       ORDER BY sort_order, status_name`,
    );
  }
  return query(
    `SELECT os.ownership_status_id, os.status_code, os.status_name, os.sort_order, os.is_active
     FROM lkup_ownership_statuses os
     JOIN xref_ownership_status_modules x
       ON x.ownership_status_id = os.ownership_status_id
     WHERE x.collection_type_id = ? AND os.is_active = 1
     ORDER BY os.sort_order, os.status_name`,
    [collectionTypeId],
  );
}
