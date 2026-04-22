from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text

from constants import PHOTOCARD_COLLECTION_TYPE_ID, OWNED_STATUS_ID, WANTED_STATUS_ID
from dependencies import get_db
from schemas.photocards import (
    BulkDeletePayload,
    BulkUpdatePayload,
    PhotocardCopyCreate,
    PhotocardCopyUpdate,
    PhotocardCreate,
    PhotocardUpdate,
    SourceOriginCreate,
)

router = APIRouter(prefix="/photocards", tags=["photocards"])


# ---------- Helpers ----------

def _photocard_row_to_dict(row):
    return {
        "item_id": row[0],
        "group_id": row[1],
        "group_name": row[2],
        "top_level_category_id": row[3],
        "category": row[4],
        "notes": row[5],
        "source_origin_id": row[6],
        "source_origin": row[7],
        "version": row[8],
        "members": list(dict.fromkeys(row[9].split(", "))) if row[9] else [],
        "front_image_path": row[10],
        "back_image_path": row[11],
        "is_special": bool(row[12]),
        "copies": [],  # populated by caller
    }


def _attach_copies(db, cards):
    """Fetch copies for a list of card dicts and attach them in-place."""
    if not cards:
        return cards
    item_ids = [c["item_id"] for c in cards]
    placeholders = ",".join(str(i) for i in item_ids)
    rows = db.execute(
        text(f"""
            SELECT pc.copy_id, pc.item_id, pc.ownership_status_id,
                   os.status_name, pc.notes
            FROM tbl_photocard_copies pc
            JOIN lkup_ownership_statuses os
                ON pc.ownership_status_id = os.ownership_status_id
            WHERE pc.item_id IN ({placeholders})
            ORDER BY pc.copy_id
        """)
    ).fetchall()
    copies_map = {}
    for r in rows:
        copies_map.setdefault(r[1], []).append({
            "copy_id": r[0],
            "ownership_status_id": r[2],
            "ownership_status": r[3],
            "notes": r[4],
        })
    for card in cards:
        card["copies"] = copies_map.get(card["item_id"], [])
    return cards


_PHOTOCARD_SELECT = """
    SELECT
        i.item_id,
        g.group_id,
        g.group_name,
        i.top_level_category_id,
        c.category_name,
        i.notes,
        p.source_origin_id,
        so.source_origin_name,
        p.version,
        COALESCE(
            (
                SELECT GROUP_CONCAT(m.member_name, ', ')
                FROM xref_photocard_members xpm
                JOIN lkup_photocard_members m ON xpm.member_id = m.member_id
                WHERE xpm.item_id = i.item_id
                ORDER BY m.member_id
            ),
            ''
        ) AS members,
        MAX(CASE WHEN a.attachment_type = 'front' THEN a.file_path END) AS front_image_path,
        MAX(CASE WHEN a.attachment_type = 'back' THEN a.file_path END) AS back_image_path,
        p.is_special
    FROM tbl_items i
    JOIN tbl_photocard_details p
        ON i.item_id = p.item_id
    JOIN lkup_top_level_categories c
        ON i.top_level_category_id = c.top_level_category_id
    JOIN lkup_photocard_groups g
        ON p.group_id = g.group_id
    LEFT JOIN lkup_photocard_source_origins so
        ON p.source_origin_id = so.source_origin_id
    LEFT JOIN tbl_attachments a
        ON i.item_id = a.item_id
    WHERE i.collection_type_id = 1
"""

_PHOTOCARD_GROUP_BY = """
    GROUP BY
        i.item_id,
        g.group_id,
        g.group_name,
        i.top_level_category_id,
        c.category_name,
        i.notes,
        p.source_origin_id,
        so.source_origin_name,
        p.version,
        p.is_special
"""


def _get_photocard(db, item_id: int):
    """Return full photocard dict for a single item, or None if not found."""
    row = db.execute(
        text(
            _PHOTOCARD_SELECT
            + " AND i.item_id = :item_id"
            + _PHOTOCARD_GROUP_BY
        ),
        {"item_id": item_id},
    ).fetchone()
    if not row:
        return None
    card = _photocard_row_to_dict(row)
    _attach_copies(db, [card])
    return card


def _check_owned_wanted_conflict(db, item_id: int, new_status_id: int, exclude_copy_id: int = None):
    """Raise 400 if adding/changing to Owned when Wanted exists, or vice versa."""
    if new_status_id not in (OWNED_STATUS_ID, WANTED_STATUS_ID):
        return
    conflict_id = WANTED_STATUS_ID if new_status_id == OWNED_STATUS_ID else OWNED_STATUS_ID
    exclude_clause = "AND copy_id != :exclude" if exclude_copy_id else ""
    row = db.execute(
        text(f"""
            SELECT COUNT(*) FROM tbl_photocard_copies
            WHERE item_id = :item_id AND ownership_status_id = :conflict_id {exclude_clause}
        """),
        {"item_id": item_id, "conflict_id": conflict_id, **({"exclude": exclude_copy_id} if exclude_copy_id else {})},
    ).fetchone()
    if row[0] > 0:
        conflict_name = "Wanted" if conflict_id == WANTED_STATUS_ID else "Owned"
        new_name = "Owned" if new_status_id == OWNED_STATUS_ID else "Wanted"
        raise HTTPException(
            status_code=400,
            detail=f"Cannot set copy to {new_name} — this card already has a {conflict_name} copy.",
        )


# ---------- Source origins CRUD ----------

@router.post("/source-origins")
def create_source_origin(payload: SourceOriginCreate, db=Depends(get_db)):
    clean_name = payload.source_origin_name.strip()

    if not clean_name:
        raise HTTPException(
            status_code=400,
            detail="Source origin name cannot be blank.",
        )

    existing = db.execute(
        text("""
            SELECT source_origin_id
            FROM lkup_photocard_source_origins
            WHERE group_id = :group_id
              AND top_level_category_id = :top_level_category_id
              AND LOWER(TRIM(source_origin_name)) = LOWER(TRIM(:source_origin_name))
        """),
        {
            "group_id": payload.group_id,
            "top_level_category_id": payload.top_level_category_id,
            "source_origin_name": clean_name,
        },
    ).fetchone()

    if existing:
        raise HTTPException(
            status_code=409,
            detail="That source origin already exists for this group and category.",
        )

    result = db.execute(
        text("""
            INSERT INTO lkup_photocard_source_origins (
                group_id,
                top_level_category_id,
                source_origin_name
            )
            VALUES (
                :group_id,
                :top_level_category_id,
                :source_origin_name
            )
            RETURNING source_origin_id
        """),
        {
            "group_id": payload.group_id,
            "top_level_category_id": payload.top_level_category_id,
            "source_origin_name": clean_name,
        },
    ).fetchone()

    source_origin_id = result[0]
    db.commit()

    return {
        "source_origin_id": source_origin_id,
        "group_id": payload.group_id,
        "top_level_category_id": payload.top_level_category_id,
        "source_origin_name": clean_name,
        "status": "created",
    }


# ---------- Photocard CRUD ----------

@router.get("")
def list_photocards(db=Depends(get_db)):
    result = db.execute(
        text(_PHOTOCARD_SELECT + _PHOTOCARD_GROUP_BY + " ORDER BY i.item_id")
    ).fetchall()
    cards = [_photocard_row_to_dict(row) for row in result]
    _attach_copies(db, cards)
    return cards


@router.get("/{item_id}")
def get_photocard(item_id: int, db=Depends(get_db)):
    row = db.execute(
        text(
            _PHOTOCARD_SELECT
            + " AND i.item_id = :item_id"
            + _PHOTOCARD_GROUP_BY
        ),
        {"item_id": item_id},
    ).fetchone()

    if not row:
        raise HTTPException(status_code=404, detail="Photocard not found.")

    card = _photocard_row_to_dict(row)
    _attach_copies(db, [card])
    return card


@router.post("")
def create_photocard(payload: PhotocardCreate, db=Depends(get_db)):
    item_result = db.execute(
        text("""
            INSERT INTO tbl_items (
                collection_type_id,
                top_level_category_id,
                ownership_status_id,
                notes
            )
            VALUES (
                :collection_type_id,
                :top_level_category_id,
                NULL,
                NULL
            )
            RETURNING item_id
        """),
        {
            "collection_type_id": payload.collection_type_id,
            "top_level_category_id": payload.top_level_category_id,
        },
    ).fetchone()

    item_id = item_result[0]

    db.execute(
        text("""
            INSERT INTO tbl_photocard_details (
                item_id,
                group_id,
                source_origin_id,
                version,
                is_special
            )
            VALUES (
                :item_id,
                :group_id,
                :source_origin_id,
                :version,
                :is_special
            )
        """),
        {
            "item_id": item_id,
            "group_id": payload.group_id,
            "source_origin_id": payload.source_origin_id,
            "version": payload.version,
            "is_special": 1 if payload.is_special else 0,
        },
    )

    # Create the first copy row
    db.execute(
        text("""
            INSERT INTO tbl_photocard_copies (item_id, ownership_status_id, notes)
            VALUES (:item_id, :ownership_status_id, :notes)
        """),
        {
            "item_id": item_id,
            "ownership_status_id": payload.ownership_status_id,
            "notes": payload.notes,
        },
    )

    for member_id in payload.member_ids:
        db.execute(
            text("""
                INSERT INTO xref_photocard_members (item_id, member_id)
                VALUES (:item_id, :member_id)
            """),
            {"item_id": item_id, "member_id": member_id},
        )

    db.commit()

    card = _get_photocard(db, item_id)
    return {"item_id": item_id, "status": "created", "photocard": card}


@router.put("/{item_id}")
def update_photocard(item_id: int, payload: PhotocardUpdate, db=Depends(get_db)):
    existing = db.execute(
        text("SELECT item_id FROM tbl_items WHERE item_id = :item_id AND collection_type_id = :ct_id"),
        {"item_id": item_id, "ct_id": PHOTOCARD_COLLECTION_TYPE_ID},
    ).fetchone()

    if not existing:
        raise HTTPException(status_code=404, detail="Photocard not found.")

    db.execute(
        text("""
            UPDATE tbl_items
            SET top_level_category_id = :top_level_category_id,
                updated_at = CURRENT_TIMESTAMP
            WHERE item_id = :item_id
        """),
        {
            "item_id": item_id,
            "top_level_category_id": payload.top_level_category_id,
        },
    )

    db.execute(
        text("""
            UPDATE tbl_photocard_details
            SET source_origin_id = :source_origin_id,
                version = :version,
                is_special = :is_special
            WHERE item_id = :item_id
        """),
        {
            "item_id": item_id,
            "source_origin_id": payload.source_origin_id,
            "version": payload.version,
            "is_special": 1 if payload.is_special else 0,
        },
    )

    db.execute(
        text("DELETE FROM xref_photocard_members WHERE item_id = :item_id"),
        {"item_id": item_id},
    )

    for member_id in payload.member_ids:
        db.execute(
            text("""
                INSERT INTO xref_photocard_members (item_id, member_id)
                VALUES (:item_id, :member_id)
            """),
            {"item_id": item_id, "member_id": member_id},
        )

    db.commit()

    card = _get_photocard(db, item_id)
    return {"item_id": item_id, "status": "updated", "photocard": card}


@router.delete("/{item_id}")
def delete_photocard(item_id: int, db=Depends(get_db)):
    from file_helpers import delete_attachment_files, remove_files

    existing = db.execute(
        text("SELECT item_id FROM tbl_items WHERE item_id = :item_id AND collection_type_id = :ct_id"),
        {"item_id": item_id, "ct_id": PHOTOCARD_COLLECTION_TYPE_ID},
    ).fetchone()

    if not existing:
        raise HTTPException(status_code=404, detail="Photocard not found.")

    files_to_delete = delete_attachment_files(db, item_id)
    db.execute(
        text("DELETE FROM tbl_photocard_copies WHERE item_id = :item_id"),
        {"item_id": item_id},
    )
    db.execute(
        text("DELETE FROM xref_photocard_members WHERE item_id = :item_id"),
        {"item_id": item_id},
    )
    db.execute(
        text("DELETE FROM tbl_attachments WHERE item_id = :item_id"),
        {"item_id": item_id},
    )
    db.execute(
        text("DELETE FROM tbl_photocard_details WHERE item_id = :item_id"),
        {"item_id": item_id},
    )
    db.execute(
        text("DELETE FROM tbl_items WHERE item_id = :item_id"),
        {"item_id": item_id},
    )

    db.commit()
    remove_files(files_to_delete)

    return {"item_id": item_id, "status": "deleted"}


@router.patch("/bulk")
def bulk_update_photocards(payload: BulkUpdatePayload, db=Depends(get_db)):
    if not payload.item_ids:
        raise HTTPException(status_code=400, detail="item_ids cannot be empty.")

    # Verify all items exist and are photocards
    placeholders = ",".join(str(i) for i in payload.item_ids)
    found = db.execute(
        text(f"""
            SELECT item_id FROM tbl_items
            WHERE item_id IN ({placeholders})
              AND collection_type_id = :ct_id
        """),
        {"ct_id": PHOTOCARD_COLLECTION_TYPE_ID},
    ).fetchall()

    if len(found) != len(payload.item_ids):
        raise HTTPException(status_code=404, detail="One or more item_ids not found.")

    f = payload.fields

    # Update tbl_items fields (card-level only — no ownership or notes)
    items_updates = []
    items_params = {}

    if f.top_level_category_id is not None:
        items_updates.append("top_level_category_id = :top_level_category_id")
        items_params["top_level_category_id"] = f.top_level_category_id

    if items_updates:
        items_updates.append("updated_at = CURRENT_TIMESTAMP")
        for item_id in payload.item_ids:
            db.execute(
                text(f"UPDATE tbl_items SET {', '.join(items_updates)} WHERE item_id = :item_id"),
                {**items_params, "item_id": item_id},
            )

    # Update ownership on all copies of selected cards
    if f.ownership_status_id is not None:
        for item_id in payload.item_ids:
            db.execute(
                text("UPDATE tbl_photocard_copies SET ownership_status_id = :oid WHERE item_id = :item_id"),
                {"oid": f.ownership_status_id, "item_id": item_id},
            )

    # Update tbl_photocard_details fields
    details_updates = []
    details_params = {}

    if f.source_origin_id is not None:
        details_updates.append("source_origin_id = :source_origin_id")
        details_params["source_origin_id"] = f.source_origin_id if f.source_origin_id > 0 else None

    if f.version is not None:
        details_updates.append("version = :version")
        details_params["version"] = f.version

    if f.is_special is not None:
        details_updates.append("is_special = :is_special")
        details_params["is_special"] = 1 if f.is_special else 0

    if details_updates:
        for item_id in payload.item_ids:
            db.execute(
                text(f"UPDATE tbl_photocard_details SET {', '.join(details_updates)} WHERE item_id = :item_id"),
                {**details_params, "item_id": item_id},
            )

    # Replace member associations
    if f.member_ids is not None:
        for item_id in payload.item_ids:
            db.execute(
                text("DELETE FROM xref_photocard_members WHERE item_id = :item_id"),
                {"item_id": item_id},
            )
            for member_id in f.member_ids:
                db.execute(
                    text("""
                        INSERT INTO xref_photocard_members (item_id, member_id)
                        VALUES (:item_id, :member_id)
                    """),
                    {"item_id": item_id, "member_id": member_id},
                )

    db.commit()

    return {"item_ids": payload.item_ids, "status": "updated", "count": len(payload.item_ids)}


@router.post("/bulk-delete")
def bulk_delete_photocards(payload: BulkDeletePayload, db=Depends(get_db)):
    from file_helpers import delete_attachment_files, remove_files

    if not payload.item_ids:
        raise HTTPException(status_code=400, detail="item_ids cannot be empty.")

    placeholders = ",".join(str(i) for i in payload.item_ids)
    found = db.execute(
        text(f"SELECT item_id FROM tbl_items WHERE item_id IN ({placeholders}) AND collection_type_id = :ct_id"),
        {"ct_id": PHOTOCARD_COLLECTION_TYPE_ID},
    ).fetchall()

    if len(found) != len(payload.item_ids):
        raise HTTPException(status_code=404, detail="One or more item_ids not found.")

    all_files = []
    for item_id in payload.item_ids:
        all_files.extend(delete_attachment_files(db, item_id))
        db.execute(text("DELETE FROM tbl_photocard_copies WHERE item_id = :id"), {"id": item_id})
        db.execute(text("DELETE FROM xref_photocard_members WHERE item_id = :id"), {"id": item_id})
        db.execute(text("DELETE FROM tbl_attachments WHERE item_id = :id"), {"id": item_id})
        db.execute(text("DELETE FROM tbl_photocard_details WHERE item_id = :id"), {"id": item_id})
        db.execute(text("DELETE FROM tbl_items WHERE item_id = :id"), {"id": item_id})

    db.commit()
    remove_files(all_files)
    return {"deleted": payload.item_ids, "count": len(payload.item_ids)}


# ---------- Photocard copy management ----------

@router.post("/{item_id}/copies")
def create_photocard_copy(item_id: int, payload: PhotocardCopyCreate, db=Depends(get_db)):
    existing = db.execute(
        text("SELECT item_id FROM tbl_photocard_details WHERE item_id = :item_id"),
        {"item_id": item_id},
    ).fetchone()
    if not existing:
        raise HTTPException(status_code=404, detail="Photocard not found.")

    _check_owned_wanted_conflict(db, item_id, payload.ownership_status_id)

    result = db.execute(
        text("""
            INSERT INTO tbl_photocard_copies (item_id, ownership_status_id, notes)
            VALUES (:item_id, :ownership_status_id, :notes)
            RETURNING copy_id
        """),
        {
            "item_id": item_id,
            "ownership_status_id": payload.ownership_status_id,
            "notes": payload.notes,
        },
    ).fetchone()
    db.commit()
    return {"copy_id": result[0], "item_id": item_id, "status": "created"}


@router.put("/{item_id}/copies/{copy_id}")
def update_photocard_copy(item_id: int, copy_id: int, payload: PhotocardCopyUpdate, db=Depends(get_db)):
    existing = db.execute(
        text("SELECT copy_id FROM tbl_photocard_copies WHERE copy_id = :copy_id AND item_id = :item_id"),
        {"copy_id": copy_id, "item_id": item_id},
    ).fetchone()
    if not existing:
        raise HTTPException(status_code=404, detail="Copy not found.")

    _check_owned_wanted_conflict(db, item_id, payload.ownership_status_id, exclude_copy_id=copy_id)

    db.execute(
        text("""
            UPDATE tbl_photocard_copies
            SET ownership_status_id = :ownership_status_id, notes = :notes
            WHERE copy_id = :copy_id
        """),
        {
            "copy_id": copy_id,
            "ownership_status_id": payload.ownership_status_id,
            "notes": payload.notes,
        },
    )
    db.commit()
    return {"copy_id": copy_id, "item_id": item_id, "status": "updated"}


@router.delete("/{item_id}/copies/{copy_id}")
def delete_photocard_copy(item_id: int, copy_id: int, db=Depends(get_db)):
    existing = db.execute(
        text("SELECT copy_id FROM tbl_photocard_copies WHERE copy_id = :copy_id AND item_id = :item_id"),
        {"copy_id": copy_id, "item_id": item_id},
    ).fetchone()
    if not existing:
        raise HTTPException(status_code=404, detail="Copy not found.")

    # Cannot delete the last copy
    (count,) = db.execute(
        text("SELECT COUNT(*) FROM tbl_photocard_copies WHERE item_id = :item_id"),
        {"item_id": item_id},
    ).fetchone()
    if count <= 1:
        raise HTTPException(status_code=400, detail="Cannot delete the last copy of a card.")

    db.execute(
        text("DELETE FROM tbl_photocard_copies WHERE copy_id = :copy_id"),
        {"copy_id": copy_id},
    )
    db.commit()
    return {"copy_id": copy_id, "item_id": item_id, "status": "deleted"}
