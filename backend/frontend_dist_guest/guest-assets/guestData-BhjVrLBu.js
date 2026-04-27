import{q as o}from"./sqliteService-DkVMywa_.js";async function E(){const e=await o(`
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
  `);if(!e.length)return[];const _=e.map(t=>t.item_id),c=e.map(t=>t.catalog_item_id),p=await o(`SELECT x.item_id, m.member_name
     FROM xref_photocard_members x
     JOIN lkup_photocard_members m ON m.member_id = x.member_id
     WHERE x.item_id IN (${_.map(()=>"?").join(",")})
     ORDER BY m.member_id`,_),i=new Map;for(const t of p)i.has(t.item_id)||i.set(t.item_id,[]),i.get(t.item_id).push(t.member_name);const m=await o(`SELECT item_id, attachment_type, file_path
     FROM tbl_attachments
     WHERE item_id IN (${_.map(()=>"?").join(",")})
       AND attachment_type IN ('front', 'back')`,_),s=new Map;for(const t of m)s.has(t.item_id)||s.set(t.item_id,{}),s.get(t.item_id)[t.attachment_type]=t.file_path;const u=await o(`SELECT gc.copy_id, gc.catalog_item_id, gc.ownership_status_id, os.status_name, gc.notes
     FROM guest_card_copies gc
     JOIN lkup_ownership_statuses os ON os.ownership_status_id = gc.ownership_status_id
     WHERE gc.catalog_item_id IN (${c.map(()=>"?").join(",")})
     ORDER BY gc.copy_id`,c),a=new Map;for(const t of u)a.has(t.catalog_item_id)||a.set(t.catalog_item_id,[]),a.get(t.catalog_item_id).push({copy_id:t.copy_id,ownership_status_id:t.ownership_status_id,ownership_status:t.status_name,notes:t.notes});const r=(await o("SELECT ownership_status_id, status_name FROM lkup_ownership_statuses WHERE status_code = 'catalog' LIMIT 1"))[0];return e.map(t=>{const n=s.get(t.item_id)||{},d=a.get(t.catalog_item_id)||[],l=d.length>0?d:r?[{copy_id:null,ownership_status_id:r.ownership_status_id,ownership_status:r.status_name,notes:null}]:[];return{item_id:t.item_id,catalog_item_id:t.catalog_item_id,group_id:t.group_id,group_name:t.group_name,top_level_category_id:t.top_level_category_id,category:t.category,notes:t.notes,source_origin_id:t.source_origin_id,source_origin:t.source_origin,version:t.version,members:i.get(t.item_id)||[],front_image_path:n.front||null,back_image_path:n.back||null,is_special:!!t.is_special,copies:l}})}async function h(){return o(`SELECT group_id, group_code, group_name, sort_order, is_active
     FROM lkup_photocard_groups
     WHERE is_active = 1
     ORDER BY sort_order, group_name`)}async function R(e){return o(`SELECT member_id, group_id, member_code, member_name, sort_order, is_active
     FROM lkup_photocard_members
     WHERE group_id = ? AND is_active = 1
     ORDER BY sort_order, member_name`,[e])}async function y(e,_){return o(`SELECT source_origin_id, group_id, top_level_category_id, source_origin_name, sort_order, is_active
     FROM lkup_photocard_source_origins
     WHERE group_id = ? AND top_level_category_id = ? AND is_active = 1
     ORDER BY sort_order, source_origin_name`,[e,_])}async function O(e){return typeof e=="string"?o(`SELECT c.top_level_category_id, c.collection_type_id, c.category_name, c.sort_order, c.is_active
       FROM lkup_top_level_categories c
       JOIN lkup_collection_types t ON t.collection_type_id = c.collection_type_id
       WHERE t.collection_type_code = ? AND c.is_active = 1
       ORDER BY c.sort_order, c.category_name`,[e]):o(`SELECT top_level_category_id, collection_type_id, category_name, sort_order, is_active
     FROM lkup_top_level_categories
     WHERE collection_type_id = ? AND is_active = 1
     ORDER BY sort_order, category_name`,[e])}async function f(e=null){return e==null?o(`SELECT ownership_status_id, status_code, status_name, sort_order, is_active
       FROM lkup_ownership_statuses
       WHERE is_active = 1
       ORDER BY sort_order, status_name`):o(`SELECT os.ownership_status_id, os.status_code, os.status_name, os.sort_order, os.is_active
     FROM lkup_ownership_statuses os
     JOIN xref_ownership_status_modules x
       ON x.ownership_status_id = os.ownership_status_id
     WHERE x.collection_type_id = ? AND os.is_active = 1
     ORDER BY os.sort_order, os.status_name`,[e])}export{f as fetchOwnershipStatuses,h as fetchPhotocardGroups,R as fetchPhotocardMembers,y as fetchPhotocardSourceOrigins,O as fetchTopLevelCategories,E as listPhotocards};
