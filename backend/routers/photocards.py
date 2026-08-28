from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text

from constants import PHOTOCARD_COLLECTION_TYPE_ID
from dependencies import get_db
from schemas.photocards import (
    BulkDeletePayload,
    BulkUpdatePayload,
    PhotocardCopyCreate,
    PhotocardCopyUpdate,
    PhotocardCreate,
    PhotocardPriceUpdate,
    PhotocardUpdate,
    PriceTierCreate,
    PriceTierUpdate,
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
        # Pricing (admin-only; see docs/photocard_pricing_and_trade_export_plan.md).
        # price_cents is the EFFECTIVE amount — custom when set, else the tier's,
        # never denormalized — so editing a tier reprices its cards on next read.
        # price_source saves the UI re-deriving the state from two nullables.
        "price_tier_id": row[13],
        "price_cents": row[14],
        "price_source": row[15],
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
        p.is_special,
        pr.price_tier_id,
        COALESCE(pr.price_cents, pt.price_cents) AS price_cents,
        CASE
            WHEN pr.price_cents IS NOT NULL THEN 'custom'
            WHEN pt.tier_id IS NOT NULL THEN 'tier'
        END AS price_source
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
    LEFT JOIN tbl_photocard_pricing pr
        ON pr.item_id = i.item_id
    LEFT JOIN lkup_photocard_price_tiers pt
        ON pt.tier_id = pr.price_tier_id
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
        p.is_special,
        pr.price_tier_id,
        pr.price_cents,
        pt.tier_id,
        pt.price_cents
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


# ownership_status_id carries two orthogonal kinds of fact:
#   * a standing DECISION about the card — undecided / wanted / not_wanted.
#     At most one per card, and it outlives the copies.
#   * a POSSESSION fact about a copy — owned / trade / pending_* / etc.
#     Zero or more per card.
# 'not_wanted' + 'trade' is legal on purpose: when a trade completes the trade
# copy row is deleted, and the "I don't want this" record has to survive it.
DECISION_CODES = ("undecided", "wanted", "not_wanted")

# Statuses 'wanted' cannot co-exist with (you don't want what you already hold).
WANTED_EXCLUSIVE_WITH = ("owned", "trade")


def _delete_binder_slots_for_items(db, item_ids):
    """Free any Binder Designer pockets holding the cards about to be deleted.

    tbl_binder_slots.item_id is UNIQUE across the table, so a slot left behind
    by a deleted card would block that item_id forever. FK cascades can't do
    this — `PRAGMA foreign_keys` is off on request sessions (db.py) — so it's
    explicit, mirroring the pcs_card_copies cleanup below. Guarded on table
    existence because the binder feature is dev-only: a prod DB that predates
    the schema block simply skips it.
    """
    if not item_ids:
        return
    has_binders = db.execute(
        text("SELECT 1 FROM sqlite_master WHERE type='table' AND name='tbl_binder_slots' LIMIT 1")
    ).fetchone()
    if not has_binders:
        return
    placeholders = ",".join(str(int(i)) for i in item_ids)
    db.execute(text(f"DELETE FROM tbl_binder_slots WHERE item_id IN ({placeholders})"))


def _status_lookup(db):
    """{status_code: {"id":, "name":}} for ownership statuses.

    Resolved per call rather than from constants: ids are DB-assigned and differ
    between environments (dev seeded 'undecided' as 2429, prod will differ), so
    hardcoding them is not safe.
    """
    rows = db.execute(
        text("SELECT status_code, ownership_status_id, status_name FROM lkup_ownership_statuses")
    ).fetchall()
    return {r[0]: {"id": r[1], "name": r[2]} for r in rows}


def _conflicting_codes(target_code: str):
    """Status codes that may not co-exist with target_code on one card."""
    if target_code in DECISION_CODES:
        conflicts = [c for c in DECISION_CODES if c != target_code]
        if target_code == "wanted":
            conflicts += list(WANTED_EXCLUSIVE_WITH)
        return conflicts
    if target_code in WANTED_EXCLUSIVE_WITH:
        return ["wanted"]
    return []


def _check_status_conflict(db, item_id: int, new_status_id: int, exclude_copy_id: int = None):
    """Raise 400 if new_status_id would violate the co-occurrence rules above."""
    statuses = _status_lookup(db)
    by_id = {v["id"]: code for code, v in statuses.items()}
    target_code = by_id.get(new_status_id)
    if target_code is None:
        return

    conflict_ids = [
        statuses[c]["id"] for c in _conflicting_codes(target_code) if c in statuses
    ]
    if not conflict_ids:
        return

    placeholders = ",".join(f":c{i}" for i in range(len(conflict_ids)))
    params = {"item_id": item_id}
    params.update({f"c{i}": cid for i, cid in enumerate(conflict_ids)})
    exclude_clause = ""
    if exclude_copy_id:
        exclude_clause = "AND pc.copy_id != :exclude"
        params["exclude"] = exclude_copy_id

    row = db.execute(
        text(f"""
            SELECT os.status_name
            FROM tbl_photocard_copies pc
            JOIN lkup_ownership_statuses os
                ON os.ownership_status_id = pc.ownership_status_id
            WHERE pc.item_id = :item_id
              AND pc.ownership_status_id IN ({placeholders})
              {exclude_clause}
            LIMIT 1
        """),
        params,
    ).fetchone()
    if row:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Cannot set copy to {statuses[target_code]['name']} — "
                f"this card already has a {row[0]} copy."
            ),
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


# ---------- Price tiers CRUD ----------
#
# Declared ahead of the /{item_id} routes: FastAPI matches in declaration
# order, and "price-tiers" would otherwise hit the int path param and 422.
#
# Editing a tier's amount is a first-class, routine operation, not a one-time
# seed. The effective price is derived on read and never denormalized, so a
# PUT here reprices every card on that tier with no sweep and no migration —
# which is the whole point of tiers, and why the amount must stay derived.

def _slugify_tier_code(name: str) -> str:
    cleaned = "".join(ch.lower() if ch.isalnum() else "_" for ch in name).strip("_")
    while "__" in cleaned:
        cleaned = cleaned.replace("__", "_")
    return cleaned or "tier"


@router.get("/price-tiers")
def list_price_tiers(db=Depends(get_db)):
    """All tiers with a live card count — inactive included.

    The caller filters: the bulk-edit dropdown wants active tiers only, while
    the Admin editor has to show retired ones (their cards still resolve).
    """
    rows = db.execute(
        text("""
            SELECT t.tier_id, t.tier_code, t.tier_name, t.price_cents,
                   t.sort_order, t.is_active,
                   COUNT(pr.item_id) AS card_count
            FROM lkup_photocard_price_tiers t
            LEFT JOIN tbl_photocard_pricing pr
                ON pr.price_tier_id = t.tier_id
            GROUP BY t.tier_id, t.tier_code, t.tier_name, t.price_cents,
                     t.sort_order, t.is_active
            ORDER BY t.sort_order, t.tier_id
        """)
    ).fetchall()
    return [
        {
            "tier_id": r[0],
            "tier_code": r[1],
            "tier_name": r[2],
            "price_cents": r[3],
            "sort_order": r[4],
            "is_active": bool(r[5]),
            "card_count": r[6],
        }
        for r in rows
    ]


@router.post("/price-tiers")
def create_price_tier(payload: PriceTierCreate, db=Depends(get_db)):
    clean_name = (payload.tier_name or "").strip()
    if not clean_name:
        raise HTTPException(status_code=400, detail="Tier name cannot be blank.")
    if payload.price_cents is None or payload.price_cents < 0:
        raise HTTPException(status_code=400, detail="Price must be zero or more.")

    base_code = _slugify_tier_code(payload.tier_code or clean_name)
    existing_codes = {
        r[0] for r in db.execute(
            text("SELECT tier_code FROM lkup_photocard_price_tiers")
        ).fetchall()
    }
    if payload.tier_code and base_code in existing_codes:
        raise HTTPException(status_code=409, detail="That tier code already exists.")
    code = base_code
    suffix = 2
    while code in existing_codes:
        code = f"{base_code}_{suffix}"
        suffix += 1

    if payload.sort_order is not None:
        sort_order = payload.sort_order
    else:
        row = db.execute(
            text("SELECT COALESCE(MAX(sort_order), 0) + 1 FROM lkup_photocard_price_tiers")
        ).fetchone()
        sort_order = row[0]

    result = db.execute(
        text("""
            INSERT INTO lkup_photocard_price_tiers
                (tier_code, tier_name, price_cents, sort_order)
            VALUES (:code, :name, :cents, :sort_order)
            RETURNING tier_id
        """),
        {"code": code, "name": clean_name, "cents": payload.price_cents,
         "sort_order": sort_order},
    ).fetchone()
    db.commit()

    return {
        "tier_id": result[0],
        "tier_code": code,
        "tier_name": clean_name,
        "price_cents": payload.price_cents,
        "sort_order": sort_order,
        "is_active": True,
        "card_count": 0,
        "status": "created",
    }


@router.put("/price-tiers/{tier_id}")
def update_price_tier(tier_id: int, payload: PriceTierUpdate, db=Depends(get_db)):
    existing = db.execute(
        text("SELECT tier_id FROM lkup_photocard_price_tiers WHERE tier_id = :id"),
        {"id": tier_id},
    ).fetchone()
    if not existing:
        raise HTTPException(status_code=404, detail="Price tier not found.")

    updates = []
    params = {"id": tier_id}

    if payload.tier_name is not None:
        clean_name = payload.tier_name.strip()
        if not clean_name:
            raise HTTPException(status_code=400, detail="Tier name cannot be blank.")
        updates.append("tier_name = :name")
        params["name"] = clean_name

    if payload.price_cents is not None:
        if payload.price_cents < 0:
            raise HTTPException(status_code=400, detail="Price must be zero or more.")
        updates.append("price_cents = :cents")
        params["cents"] = payload.price_cents

    if payload.sort_order is not None:
        updates.append("sort_order = :sort_order")
        params["sort_order"] = payload.sort_order

    if payload.is_active is not None:
        updates.append("is_active = :is_active")
        params["is_active"] = 1 if payload.is_active else 0

    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update.")

    db.execute(
        text(f"UPDATE lkup_photocard_price_tiers SET {', '.join(updates)} WHERE tier_id = :id"),
        params,
    )
    db.commit()

    (card_count,) = db.execute(
        text("SELECT COUNT(*) FROM tbl_photocard_pricing WHERE price_tier_id = :id"),
        {"id": tier_id},
    ).fetchone()
    row = db.execute(
        text("""
            SELECT tier_id, tier_code, tier_name, price_cents, sort_order, is_active
            FROM lkup_photocard_price_tiers WHERE tier_id = :id
        """),
        {"id": tier_id},
    ).fetchone()
    return {
        "tier_id": row[0],
        "tier_code": row[1],
        "tier_name": row[2],
        "price_cents": row[3],
        "sort_order": row[4],
        "is_active": bool(row[5]),
        "card_count": card_count,
        "status": "updated",
    }


@router.delete("/price-tiers/{tier_id}")
def delete_price_tier(tier_id: int, db=Depends(get_db)):
    """Refuse to delete a tier that cards still point at.

    FK cascades never fire here (PRAGMA foreign_keys is only ON for init_db's
    connection), so an unguarded delete would leave dangling price_tier_id
    values that silently resolve to no price. Retiring a tier is is_active = 0.
    """
    existing = db.execute(
        text("SELECT tier_id FROM lkup_photocard_price_tiers WHERE tier_id = :id"),
        {"id": tier_id},
    ).fetchone()
    if not existing:
        raise HTTPException(status_code=404, detail="Price tier not found.")

    (in_use,) = db.execute(
        text("SELECT COUNT(*) FROM tbl_photocard_pricing WHERE price_tier_id = :id"),
        {"id": tier_id},
    ).fetchone()
    if in_use:
        raise HTTPException(
            status_code=409,
            detail=(
                f"{in_use} card{'s' if in_use != 1 else ''} still use this tier. "
                "Move them to another tier, or deactivate this one instead."
            ),
        )

    db.execute(
        text("DELETE FROM lkup_photocard_price_tiers WHERE tier_id = :id"),
        {"id": tier_id},
    )
    db.commit()
    return {"tier_id": tier_id, "status": "deleted"}


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


@router.put("/{item_id}/price")
def set_photocard_price(item_id: int, payload: PhotocardPriceUpdate, db=Depends(get_db)):
    """Set a CUSTOM price on one card, or unprice it with a null amount.

    Deliberately not a field on PhotocardUpdate: clearing the card's tier is a
    distinct operation with a side effect, not a field assignment, and the
    detail modal saves it independently of the rest of the form.
    """
    existing = db.execute(
        text("SELECT item_id FROM tbl_items WHERE item_id = :item_id AND collection_type_id = :ct_id"),
        {"item_id": item_id, "ct_id": PHOTOCARD_COLLECTION_TYPE_ID},
    ).fetchone()
    if not existing:
        raise HTTPException(status_code=404, detail="Photocard not found.")

    if payload.price_cents is None:
        db.execute(
            text("DELETE FROM tbl_photocard_pricing WHERE item_id = :item_id"),
            {"item_id": item_id},
        )
        db.commit()
        return {
            "item_id": item_id,
            "price_tier_id": None,
            "price_cents": None,
            "price_source": None,
            "status": "cleared",
        }

    if payload.price_cents < 0:
        raise HTTPException(status_code=400, detail="Price must be zero or more.")

    db.execute(
        text("""
            INSERT INTO tbl_photocard_pricing
                (item_id, price_tier_id, price_cents, updated_at)
            VALUES (:item_id, NULL, :cents, CURRENT_TIMESTAMP)
            ON CONFLICT(item_id) DO UPDATE SET
                price_tier_id = NULL,
                price_cents   = excluded.price_cents,
                updated_at    = CURRENT_TIMESTAMP
        """),
        {"item_id": item_id, "cents": payload.price_cents},
    )
    db.commit()
    return {
        "item_id": item_id,
        "price_tier_id": None,
        "price_cents": payload.price_cents,
        "price_source": "custom",
        "status": "updated",
    }


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
    _delete_binder_slots_for_items(db, [item_id])
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
        text("DELETE FROM tbl_photocard_pricing WHERE item_id = :item_id"),
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

    # Bulk ownership changes rewrite the card's DECISION row only; possession
    # copies (owned / trade / pending_*) are never touched in bulk. Row-scoping
    # is what makes a triage sweep safe: sweeping a {not_wanted, trade} card to
    # Undecided rewrites the decision and leaves the trade copy intact, where a
    # card-scoped `WHERE item_id = ...` would flatten both into one status.
    # Cards whose target status would conflict (e.g. -> Wanted on a card that is
    # Owned) are excluded rather than silently corrupted, and counted as skipped.
    ownership_result = None
    if f.ownership_status_id is not None:
        statuses = _status_lookup(db)
        by_id = {v["id"]: code for code, v in statuses.items()}
        target_code = by_id.get(f.ownership_status_id)
        if target_code is None:
            raise HTTPException(status_code=400, detail="Unknown ownership_status_id.")

        decision_ids = [statuses[c]["id"] for c in DECISION_CODES if c in statuses]
        # Only POSSESSION conflicts can block a sweep. A conflicting decision row
        # is not a blocker because this very statement overwrites it — excluding
        # on it would skip exactly the cards the sweep is meant to retag
        # (e.g. undecided -> not_wanted would exclude every undecided card).
        conflict_ids = [
            statuses[c]["id"]
            for c in _conflicting_codes(target_code)
            if c in statuses and c not in DECISION_CODES
        ]

        item_ph = ",".join(str(i) for i in payload.item_ids)
        dec_ph = ",".join(f":d{i}" for i in range(len(decision_ids)))
        params = {"oid": f.ownership_status_id}
        params.update({f"d{i}": sid for i, sid in enumerate(decision_ids)})

        conflict_clause = ""
        if conflict_ids:
            cf_ph = ",".join(f":x{i}" for i in range(len(conflict_ids)))
            params.update({f"x{i}": sid for i, sid in enumerate(conflict_ids)})
            conflict_clause = f"""
              AND item_id NOT IN (
                  SELECT item_id FROM tbl_photocard_copies
                  WHERE ownership_status_id IN ({cf_ph})
              )"""

        # One set-based statement rather than a per-item loop: measured at
        # 1.60s vs 0.004s over the full 10k library, and it holds the SQLite
        # write lock for correspondingly less time.
        result = db.execute(
            text(f"""
                UPDATE tbl_photocard_copies
                SET ownership_status_id = :oid
                WHERE item_id IN ({item_ph})
                  AND ownership_status_id IN ({dec_ph})
                  {conflict_clause}
            """),
            params,
        )
        updated = result.rowcount if result.rowcount is not None else 0
        ownership_result = {
            "updated": updated,
            "skipped": max(0, len(payload.item_ids) - updated),
        }

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

    # Bulk price-tier assignment. Assigning a tier CLEARS any custom price on
    # the card — tier and custom price are mutually exclusive by design, so a
    # later sweep over a tier can't be silently subverted by a stale override.
    # That means a re-sweep genuinely destroys custom prices in the selection,
    # so count them and report it rather than losing them quietly.
    pricing_result = None
    if f.price_tier_id is not None:
        item_ph = ",".join(str(int(i)) for i in payload.item_ids)

        if f.price_tier_id > 0:
            tier = db.execute(
                text("SELECT tier_id FROM lkup_photocard_price_tiers WHERE tier_id = :id"),
                {"id": f.price_tier_id},
            ).fetchone()
            if not tier:
                raise HTTPException(status_code=400, detail="Unknown price_tier_id.")

            (replaced_custom,) = db.execute(
                text(f"""
                    SELECT COUNT(*) FROM tbl_photocard_pricing
                    WHERE item_id IN ({item_ph}) AND price_cents IS NOT NULL
                """)
            ).fetchone()

            for item_id in payload.item_ids:
                db.execute(
                    text("""
                        INSERT INTO tbl_photocard_pricing
                            (item_id, price_tier_id, price_cents, updated_at)
                        VALUES (:item_id, :tier_id, NULL, CURRENT_TIMESTAMP)
                        ON CONFLICT(item_id) DO UPDATE SET
                            price_tier_id = excluded.price_tier_id,
                            price_cents   = NULL,
                            updated_at    = CURRENT_TIMESTAMP
                    """),
                    {"item_id": item_id, "tier_id": f.price_tier_id},
                )
            pricing_result = {
                "updated": len(payload.item_ids),
                "replaced_custom": replaced_custom,
            }
        else:
            # 0 = unprice, matching the source_origin_id > 0 sentinel above.
            result = db.execute(
                text(f"DELETE FROM tbl_photocard_pricing WHERE item_id IN ({item_ph})")
            )
            cleared = result.rowcount if result.rowcount is not None else 0
            pricing_result = {"updated": cleared, "replaced_custom": 0, "cleared": cleared}

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

    response = {"item_ids": payload.item_ids, "status": "updated", "count": len(payload.item_ids)}
    if ownership_result is not None:
        response["ownership"] = ownership_result
    if pricing_result is not None:
        response["pricing"] = pricing_result
    return response


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

    # Capture catalog_item_ids before deletion so we can drop orphaned /pcs/
    # copies (a friend's annotation of a card that's about to cease to exist).
    # Catalog is no longer strictly monotonic — rare removals propagate; on
    # /pcs/ the card just vanishes (live query), we only clean the dead rows.
    catalog_ids = [
        r[0] for r in db.execute(
            text(f"SELECT catalog_item_id FROM tbl_items WHERE item_id IN ({placeholders}) AND catalog_item_id IS NOT NULL"),
        ).fetchall()
    ]

    _delete_binder_slots_for_items(db, payload.item_ids)

    all_files = []
    for item_id in payload.item_ids:
        all_files.extend(delete_attachment_files(db, item_id))
        db.execute(text("DELETE FROM tbl_photocard_copies WHERE item_id = :id"), {"id": item_id})
        db.execute(text("DELETE FROM xref_photocard_members WHERE item_id = :id"), {"id": item_id})
        db.execute(text("DELETE FROM tbl_attachments WHERE item_id = :id"), {"id": item_id})
        db.execute(text("DELETE FROM tbl_photocard_pricing WHERE item_id = :id"), {"id": item_id})
        db.execute(text("DELETE FROM tbl_photocard_details WHERE item_id = :id"), {"id": item_id})
        db.execute(text("DELETE FROM tbl_items WHERE item_id = :id"), {"id": item_id})

    # Silently drop friends' /pcs/ annotations for the removed catalog cards
    # (decided 2026-07-17 — removals are rare, mostly duplicate cleanup).
    if catalog_ids:
        has_pcs = db.execute(
            text("SELECT 1 FROM sqlite_master WHERE type='table' AND name='pcs_card_copies' LIMIT 1")
        ).fetchone()
        if has_pcs:
            cat_ph = ",".join(f":c{i}" for i in range(len(catalog_ids)))
            db.execute(
                text(f"DELETE FROM pcs_card_copies WHERE catalog_item_id IN ({cat_ph})"),
                {f"c{i}": cid for i, cid in enumerate(catalog_ids)},
            )

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

    _check_status_conflict(db, item_id, payload.ownership_status_id)

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

    _check_status_conflict(db, item_id, payload.ownership_status_id, exclude_copy_id=copy_id)

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
