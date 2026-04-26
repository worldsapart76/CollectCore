import{q as o}from"./sqliteService-DlmyuGyx.js";async function u(){const t=await o(`
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
  `);if(!t.length)return[];const _=t.map(e=>e.item_id),a=t.map(e=>e.catalog_item_id),n=await o(`SELECT x.item_id, m.member_name
     FROM xref_photocard_members x
     JOIN lkup_photocard_members m ON m.member_id = x.member_id
     WHERE x.item_id IN (${_.map(()=>"?").join(",")})
     ORDER BY m.member_id`,_),i=new Map;for(const e of n)i.has(e.item_id)||i.set(e.item_id,[]),i.get(e.item_id).push(e.member_name);const d=await o(`SELECT item_id, attachment_type, file_path
     FROM tbl_attachments
     WHERE item_id IN (${_.map(()=>"?").join(",")})
       AND attachment_type IN ('front', 'back')`,_),s=new Map;for(const e of d)s.has(e.item_id)||s.set(e.item_id,{}),s.get(e.item_id)[e.attachment_type]=e.file_path;const p=await o(`SELECT gc.copy_id, gc.catalog_item_id, gc.ownership_status_id, os.status_name, gc.notes
     FROM guest_card_copies gc
     JOIN lkup_ownership_statuses os ON os.ownership_status_id = gc.ownership_status_id
     WHERE gc.catalog_item_id IN (${a.map(()=>"?").join(",")})
     ORDER BY gc.copy_id`,a),r=new Map;for(const e of p)r.has(e.catalog_item_id)||r.set(e.catalog_item_id,[]),r.get(e.catalog_item_id).push({copy_id:e.copy_id,ownership_status_id:e.ownership_status_id,ownership_status:e.status_name,notes:e.notes});return t.map(e=>{const c=s.get(e.item_id)||{};return{item_id:e.item_id,catalog_item_id:e.catalog_item_id,group_id:e.group_id,group_name:e.group_name,top_level_category_id:e.top_level_category_id,category:e.category,notes:e.notes,source_origin_id:e.source_origin_id,source_origin:e.source_origin,version:e.version,members:i.get(e.item_id)||[],front_image_path:c.front||null,back_image_path:c.back||null,is_special:!!e.is_special,copies:r.get(e.catalog_item_id)||[]}})}async function g(){return o(`SELECT group_id, group_code, group_name, sort_order, is_active
     FROM lkup_photocard_groups
     WHERE is_active = 1
     ORDER BY sort_order, group_name`)}async function l(t){return o(`SELECT member_id, group_id, member_code, member_name, sort_order, is_active
     FROM lkup_photocard_members
     WHERE group_id = ? AND is_active = 1
     ORDER BY sort_order, member_name`,[t])}async function E(t,_){return o(`SELECT source_origin_id, group_id, top_level_category_id, source_origin_name, sort_order, is_active
     FROM lkup_photocard_source_origins
     WHERE group_id = ? AND top_level_category_id = ? AND is_active = 1
     ORDER BY sort_order, source_origin_name`,[t,_])}async function R(t){return typeof t=="string"?o(`SELECT c.top_level_category_id, c.collection_type_id, c.category_name, c.sort_order, c.is_active
       FROM lkup_top_level_categories c
       JOIN lkup_collection_types t ON t.collection_type_id = c.collection_type_id
       WHERE t.collection_type_code = ? AND c.is_active = 1
       ORDER BY c.sort_order, c.category_name`,[t]):o(`SELECT top_level_category_id, collection_type_id, category_name, sort_order, is_active
     FROM lkup_top_level_categories
     WHERE collection_type_id = ? AND is_active = 1
     ORDER BY sort_order, category_name`,[t])}async function h(t=null){return t==null?o(`SELECT ownership_status_id, status_code, status_name, sort_order, is_active
       FROM lkup_ownership_statuses
       WHERE is_active = 1
       ORDER BY sort_order, status_name`):o(`SELECT os.ownership_status_id, os.status_code, os.status_name, os.sort_order, os.is_active
     FROM lkup_ownership_statuses os
     JOIN xref_ownership_status_modules x
       ON x.ownership_status_id = os.ownership_status_id
     WHERE x.collection_type_id = ? AND os.is_active = 1
     ORDER BY os.sort_order, os.status_name`,[t])}export{h as fetchOwnershipStatuses,g as fetchPhotocardGroups,l as fetchPhotocardMembers,E as fetchPhotocardSourceOrigins,R as fetchTopLevelCategories,u as listPhotocards};
