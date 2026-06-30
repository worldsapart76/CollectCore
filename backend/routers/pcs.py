"""
Authenticated guest tier (`/pcs/`) — server-stored per-user photocard
annotations over the shared catalog. Replaces the deprecated browser-local
`/guest/` WASM tier; see docs/guest_cloud_accounts_plan.md.

Every endpoint requires an authenticated identity (Cloudflare Access at the
edge; see auth.py). Writes are scoped to the caller's own user_id — a
client-supplied user id is never accepted. Per-card annotations are keyed by
the stable `catalog_item_id` contract, mirroring the deprecated tier's
`guest_card_copies` model but stored server-side.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text

from auth import is_admin, require_user
from constants import PHOTOCARD_COLLECTION_TYPE_ID
from dependencies import get_db
from schemas.pcs import PcsCopyCreate, PcsCopyUpdate

router = APIRouter(prefix="/pcs", tags=["pcs"])


def _get_or_create_user(db, email: str) -> int:
    """Resolve the caller's pcs_users.user_id, provisioning on first sight."""
    row = db.execute(
        text("SELECT user_id FROM pcs_users WHERE email = :e"), {"e": email}
    ).fetchone()
    if row:
        db.execute(
            text("UPDATE pcs_users SET last_seen_at = CURRENT_TIMESTAMP WHERE user_id = :id"),
            {"id": row[0]},
        )
        db.commit()
        return row[0]
    res = db.execute(
        text("INSERT INTO pcs_users (email, last_seen_at) VALUES (:e, CURRENT_TIMESTAMP)"),
        {"e": email},
    )
    db.commit()
    return res.lastrowid


def _in_clause(ids, prefix):
    """Build a parameterized IN (...) clause + params dict for a list of ids."""
    placeholders = ",".join(f":{prefix}{i}" for i in range(len(ids)))
    params = {f"{prefix}{i}": v for i, v in enumerate(ids)}
    return placeholders, params


def _status_exists(db, status_id: int) -> bool:
    return db.execute(
        text("SELECT 1 FROM lkup_ownership_statuses WHERE ownership_status_id = :s LIMIT 1"),
        {"s": status_id},
    ).fetchone() is not None


@router.get("/me")
def pcs_me(email: str = Depends(require_user), db=Depends(get_db)):
    """Provision-on-first-hit; return the current user + admin flag."""
    user_id = _get_or_create_user(db, email)
    row = db.execute(
        text("SELECT user_id, email, display_name FROM pcs_users WHERE user_id = :id"),
        {"id": user_id},
    ).fetchone()
    return {
        "user_id": row[0],
        "email": row[1],
        "display_name": row[2],
        "is_admin": is_admin(email),
    }


@router.get("/photocards")
def pcs_photocards(email: str = Depends(require_user), db=Depends(get_db)):
    """
    Catalog photocards joined with THIS user's annotations. Same response shape
    as admin's listPhotocards (plus catalog_item_id), so the reused library page
    needs no data-shape branching. Untouched cards surface a synthetic
    Catalog-status copy (copy_id: null), matching the deprecated guest adapter.
    """
    user_id = _get_or_create_user(db, email)

    card_rows = [dict(r._mapping) for r in db.execute(
        text(
            """
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
              AND i.collection_type_id = :pc
            ORDER BY i.item_id
            """
        ),
        {"pc": PHOTOCARD_COLLECTION_TYPE_ID},
    )]

    if not card_rows:
        return []

    item_ids = [r["item_id"] for r in card_rows]
    catalog_ids = [r["catalog_item_id"] for r in card_rows]

    # Members → list of names per item_id.
    ph, params = _in_clause(item_ids, "it")
    members_by_item: dict = {}
    for r in db.execute(
        text(
            f"""
            SELECT x.item_id, m.member_name
            FROM xref_photocard_members x
            JOIN lkup_photocard_members m ON m.member_id = x.member_id
            WHERE x.item_id IN ({ph})
            ORDER BY m.member_id
            """
        ),
        params,
    ):
        m = r._mapping
        members_by_item.setdefault(m["item_id"], []).append(m["member_name"])

    # Front/back image URLs per item_id.
    ph, params = _in_clause(item_ids, "it")
    atts_by_item: dict = {}
    for r in db.execute(
        text(
            f"""
            SELECT item_id, attachment_type, file_path
            FROM tbl_attachments
            WHERE item_id IN ({ph}) AND attachment_type IN ('front', 'back')
            """
        ),
        params,
    ):
        m = r._mapping
        atts_by_item.setdefault(m["item_id"], {})[m["attachment_type"]] = m["file_path"]

    # This user's copies, keyed by catalog_item_id.
    ph, params = _in_clause(catalog_ids, "ci")
    params["uid"] = user_id
    copies_by_cat: dict = {}
    for r in db.execute(
        text(
            f"""
            SELECT gc.copy_id, gc.catalog_item_id, gc.ownership_status_id,
                   os.status_name, gc.notes
            FROM pcs_card_copies gc
            JOIN lkup_ownership_statuses os ON os.ownership_status_id = gc.ownership_status_id
            WHERE gc.user_id = :uid AND gc.catalog_item_id IN ({ph})
            ORDER BY gc.copy_id
            """
        ),
        params,
    ):
        m = r._mapping
        copies_by_cat.setdefault(m["catalog_item_id"], []).append({
            "copy_id": m["copy_id"],
            "ownership_status_id": m["ownership_status_id"],
            "ownership_status": m["status_name"],
            "notes": m["notes"],
        })

    catalog_status = db.execute(
        text(
            "SELECT ownership_status_id, status_name FROM lkup_ownership_statuses "
            "WHERE status_code = 'catalog' LIMIT 1"
        )
    ).fetchone()

    out = []
    for r in card_rows:
        att = atts_by_item.get(r["item_id"], {})
        real = copies_by_cat.get(r["catalog_item_id"], [])
        if real:
            copies = real
        elif catalog_status is not None:
            copies = [{
                "copy_id": None,  # synthetic — no DB row
                "ownership_status_id": catalog_status[0],
                "ownership_status": catalog_status[1],
                "notes": None,
            }]
        else:
            copies = []
        out.append({
            "item_id": r["item_id"],
            "catalog_item_id": r["catalog_item_id"],
            "group_id": r["group_id"],
            "group_name": r["group_name"],
            "top_level_category_id": r["top_level_category_id"],
            "category": r["category"],
            "notes": r["notes"],
            "source_origin_id": r["source_origin_id"],
            "source_origin": r["source_origin"],
            "version": r["version"],
            "members": members_by_item.get(r["item_id"], []),
            "front_image_path": att.get("front"),
            "back_image_path": att.get("back"),
            "is_special": bool(r["is_special"]),
            "copies": copies,
        })
    return out


# ── Read-only lookups (namespaced under /pcs so the whole guest surface sits
#    behind one authorization rule). Mirror the deprecated guest adapter. ──

@router.get("/ownership-statuses")
def pcs_ownership_statuses(email: str = Depends(require_user), db=Depends(get_db)):
    # Guests see ALL statuses including Catalog (filtering to Catalog shows what
    # they could collect — the whole point of the guest catalog view).
    return [dict(r._mapping) for r in db.execute(
        text(
            """
            SELECT ownership_status_id, status_code, status_name, sort_order, is_active
            FROM lkup_ownership_statuses
            WHERE is_active = 1
            ORDER BY sort_order, status_name
            """
        )
    )]


@router.get("/categories")
def pcs_categories(email: str = Depends(require_user), db=Depends(get_db)):
    # /pcs/ is photocard-only; always scoped to the photocard collection type.
    return [dict(r._mapping) for r in db.execute(
        text(
            """
            SELECT top_level_category_id, collection_type_id, category_name,
                   sort_order, is_active
            FROM lkup_top_level_categories
            WHERE collection_type_id = :pc AND is_active = 1
            ORDER BY sort_order, category_name
            """
        ),
        {"pc": PHOTOCARD_COLLECTION_TYPE_ID},
    )]


@router.get("/photocards/groups")
def pcs_groups(email: str = Depends(require_user), db=Depends(get_db)):
    return [dict(r._mapping) for r in db.execute(
        text(
            """
            SELECT group_id, group_code, group_name, sort_order, is_active
            FROM lkup_photocard_groups
            WHERE is_active = 1
            ORDER BY sort_order, group_name
            """
        )
    )]


@router.get("/photocards/members")
def pcs_members(group_id: int, email: str = Depends(require_user), db=Depends(get_db)):
    return [dict(r._mapping) for r in db.execute(
        text(
            """
            SELECT member_id, group_id, member_code, member_name, sort_order, is_active
            FROM lkup_photocard_members
            WHERE group_id = :g AND is_active = 1
            ORDER BY sort_order, member_name
            """
        ),
        {"g": group_id},
    )]


@router.get("/photocards/source-origins")
def pcs_source_origins(
    group_id: int,
    category_id: int,
    email: str = Depends(require_user),
    db=Depends(get_db),
):
    return [dict(r._mapping) for r in db.execute(
        text(
            """
            SELECT source_origin_id, group_id, top_level_category_id,
                   source_origin_name, sort_order, is_active
            FROM lkup_photocard_source_origins
            WHERE group_id = :g AND top_level_category_id = :c AND is_active = 1
            ORDER BY sort_order, source_origin_name
            """
        ),
        {"g": group_id, "c": category_id},
    )]


# ── Per-user annotation writes (scoped to the caller). ──

@router.post("/copies", status_code=201)
def pcs_create_copy(
    payload: PcsCopyCreate,
    email: str = Depends(require_user),
    db=Depends(get_db),
):
    user_id = _get_or_create_user(db, email)
    card = db.execute(
        text(
            """
            SELECT 1 FROM tbl_items
            WHERE catalog_item_id = :ci
              AND collection_type_id = :pc
              AND catalog_item_id IS NOT NULL
            LIMIT 1
            """
        ),
        {"ci": payload.catalog_item_id, "pc": PHOTOCARD_COLLECTION_TYPE_ID},
    ).fetchone()
    if card is None:
        raise HTTPException(status_code=404, detail="Catalog card not found")
    if not _status_exists(db, payload.ownership_status_id):
        raise HTTPException(status_code=422, detail="Invalid ownership_status_id")
    res = db.execute(
        text(
            """
            INSERT INTO pcs_card_copies (user_id, catalog_item_id, ownership_status_id, notes)
            VALUES (:uid, :ci, :s, :n)
            """
        ),
        {"uid": user_id, "ci": payload.catalog_item_id,
         "s": payload.ownership_status_id, "n": payload.notes},
    )
    db.commit()
    return {"copy_id": res.lastrowid}


@router.put("/copies/{copy_id}")
def pcs_update_copy(
    copy_id: int,
    payload: PcsCopyUpdate,
    email: str = Depends(require_user),
    db=Depends(get_db),
):
    user_id = _get_or_create_user(db, email)
    row = db.execute(
        text("SELECT user_id FROM pcs_card_copies WHERE copy_id = :id"),
        {"id": copy_id},
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Copy not found")
    if row[0] != user_id:
        raise HTTPException(status_code=403, detail="Not your copy")

    data = payload.model_dump(exclude_unset=True)
    sets = []
    params = {"id": copy_id}
    if "ownership_status_id" in data:
        if not _status_exists(db, data["ownership_status_id"]):
            raise HTTPException(status_code=422, detail="Invalid ownership_status_id")
        sets.append("ownership_status_id = :s")
        params["s"] = data["ownership_status_id"]
    if "notes" in data:
        sets.append("notes = :n")
        params["n"] = data["notes"]
    if sets:
        sets.append("updated_at = CURRENT_TIMESTAMP")
        db.execute(
            text(f"UPDATE pcs_card_copies SET {', '.join(sets)} WHERE copy_id = :id"),
            params,
        )
        db.commit()
    return {"ok": True}


@router.delete("/copies/{copy_id}")
def pcs_delete_copy(
    copy_id: int,
    email: str = Depends(require_user),
    db=Depends(get_db),
):
    user_id = _get_or_create_user(db, email)
    row = db.execute(
        text("SELECT user_id FROM pcs_card_copies WHERE copy_id = :id"),
        {"id": copy_id},
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Copy not found")
    if row[0] != user_id:
        raise HTTPException(status_code=403, detail="Not your copy")
    db.execute(text("DELETE FROM pcs_card_copies WHERE copy_id = :id"), {"id": copy_id})
    db.commit()
    return {"ok": True}
