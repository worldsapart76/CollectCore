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

import json

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text

from auth import is_admin, require_user
from constants import PHOTOCARD_COLLECTION_TYPE_ID
from dependencies import get_db
from schemas.pcs import (
    PcsCopyCreate,
    PcsCopyUpdate,
    PcsGuestBackupImport,
    PcsTradeCreate,
    PcsTradeDefaults,
)

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


@router.post("/import-guest-backup")
def pcs_import_guest_backup(
    payload: PcsGuestBackupImport,
    email: str = Depends(require_user),
    db=Depends(get_db),
):
    """
    Migrate a friend's deprecated /guest/ WASM backup into their /pcs account.

    REPLACE strategy: the caller's existing pcs_card_copies are deleted, then the
    backup's guest_card_copies rows are inserted. Idempotent — re-importing the
    same file yields the same end state, so a friend can't double-migrate into
    duplicates.

    Rows are validated against the live catalog. The catalog is monotonic (ids
    never leave), so an unknown catalog_item_id means a hand-edited/foreign file;
    it's skipped (counted, not fatal). The synthetic 'catalog' status is skipped
    too — it marks an untouched card, never a real annotation.
    """
    if payload.version != 1:
        raise HTTPException(status_code=422, detail=f"Unsupported backup version {payload.version}")
    user_id = _get_or_create_user(db, email)

    # Fetch the valid-id sets once, then validate rows in Python (cheaper than a
    # per-row existence query for a multi-thousand-row library).
    valid_catalog_ids = {
        r[0] for r in db.execute(
            text(
                "SELECT catalog_item_id FROM tbl_items "
                "WHERE catalog_item_id IS NOT NULL AND collection_type_id = :pc"
            ),
            {"pc": PHOTOCARD_COLLECTION_TYPE_ID},
        )
    }
    valid_status_ids = {
        r[0] for r in db.execute(
            text("SELECT ownership_status_id FROM lkup_ownership_statuses")
        )
    }
    cat_row = db.execute(
        text("SELECT ownership_status_id FROM lkup_ownership_statuses WHERE status_code = 'catalog' LIMIT 1")
    ).fetchone()
    catalog_status_id = cat_row[0] if cat_row else None

    to_insert = []
    skipped_unknown_card = 0
    skipped_bad_status = 0
    for row in payload.tables.guest_card_copies:
        if row.catalog_item_id not in valid_catalog_ids:
            skipped_unknown_card += 1
            continue
        if row.ownership_status_id not in valid_status_ids or row.ownership_status_id == catalog_status_id:
            skipped_bad_status += 1
            continue
        to_insert.append({
            "uid": user_id,
            "ci": row.catalog_item_id,
            "s": row.ownership_status_id,
            "n": row.notes,
        })

    try:
        deleted = db.execute(
            text("DELETE FROM pcs_card_copies WHERE user_id = :uid"),
            {"uid": user_id},
        ).rowcount
        if to_insert:
            db.execute(
                text(
                    "INSERT INTO pcs_card_copies "
                    "(user_id, catalog_item_id, ownership_status_id, notes) "
                    "VALUES (:uid, :ci, :s, :n)"
                ),
                to_insert,
            )
        db.commit()
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Import failed: {exc}")

    return {
        "ok": True,
        "imported": len(to_insert),
        "skipped_unknown_card": skipped_unknown_card,
        "skipped_bad_status": skipped_bad_status,
        "replaced_existing": deleted if deleted and deleted > 0 else 0,
    }


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


# ── Trades (server-backed, per-user) ──────────────────────────────────────
# The deprecated guest tier kept a user's trade list + default fields in
# browser-local SQLite; the /pcs tier stores them server-side instead. Trade
# rows live in the shared tbl_trades (so the public /trade/<slug> view is
# unchanged); pcs_trades records which /pcs user owns each slug. Reuses the
# trade-page builder from routers.trades to keep the payload format identical.

@router.post("/trades", status_code=201)
def pcs_create_trade(
    payload: PcsTradeCreate,
    email: str = Depends(require_user),
    db=Depends(get_db),
):
    from routers.trades import _fetch_payload_cards, _generate_slug, GUEST_TRADE_LIFETIME

    user_id = _get_or_create_user(db, email)
    cards = _fetch_payload_cards(db, payload.catalog_item_ids, payload.include_backs)
    if not cards:
        raise HTTPException(
            status_code=400,
            detail="No eligible cards in selection (missing catalog_item_id or a published front image).",
        )
    payload_json = json.dumps(
        {"version": 1, "cards": cards}, ensure_ascii=False, separators=(",", ":")
    )
    slug = _generate_slug(db)
    db.execute(
        text(
            "INSERT INTO tbl_trades "
            "(slug, created_by, from_name, to_name, notes, include_backs, payload_json, expires_at) "
            f"VALUES (:slug, 'guest', :fn, :tn, :nt, :ib, :pj, datetime('now', '{GUEST_TRADE_LIFETIME}'))"
        ),
        {
            "slug": slug,
            "fn": payload.from_name.strip(),
            "tn": (payload.to_name or "").strip() or None,
            "nt": (payload.notes or "").strip() or None,
            "ib": 1 if payload.include_backs else 0,
            "pj": payload_json,
        },
    )
    db.execute(
        text("INSERT INTO pcs_trades (user_id, slug) VALUES (:uid, :slug)"),
        {"uid": user_id, "slug": slug},
    )
    row = db.execute(
        text("SELECT created_at, expires_at FROM tbl_trades WHERE slug = :s"),
        {"s": slug},
    ).fetchone()
    db.commit()
    return {
        "slug": slug,
        "url": f"/trade/{slug}",
        "card_count": len(cards),
        "skipped_unpublished": max(0, len(payload.catalog_item_ids) - len(cards)),
        "created_at": row[0],
        "expires_at": row[1],
    }


@router.get("/trades")
def pcs_list_trades(email: str = Depends(require_user), db=Depends(get_db)):
    """The caller's own, non-expired trade pages (shape matches the guest tier
    so the reused TradesPage renders without branching)."""
    user_id = _get_or_create_user(db, email)
    rows = db.execute(
        text(
            """
            SELECT t.slug, t.from_name, t.to_name, t.notes, t.created_at, t.expires_at,
                   (SELECT COUNT(*) FROM json_each(json_extract(t.payload_json, '$.cards'))) AS card_count
            FROM pcs_trades p
            JOIN tbl_trades t ON t.slug = p.slug
            WHERE p.user_id = :uid
              AND (t.expires_at IS NULL OR t.expires_at > datetime('now'))
            ORDER BY t.created_at DESC
            """
        ),
        {"uid": user_id},
    )
    out = []
    for r in rows:
        m = r._mapping
        out.append({
            "slug": m["slug"],
            "from_name": m["from_name"],
            "to_name": m["to_name"],
            "name": m["to_name"],
            "notes": m["notes"],
            "card_count": m["card_count"],
            "created_at": m["created_at"],
            "expires_at": m["expires_at"],
        })
    return out


@router.delete("/trades/{slug}")
def pcs_delete_trade(slug: str, email: str = Depends(require_user), db=Depends(get_db)):
    user_id = _get_or_create_user(db, email)
    own = db.execute(
        text("SELECT 1 FROM pcs_trades WHERE user_id = :uid AND slug = :s"),
        {"uid": user_id, "s": slug},
    ).fetchone()
    if own is None:
        raise HTTPException(status_code=404, detail="Trade not found")
    db.execute(text("DELETE FROM tbl_trades WHERE slug = :s"), {"s": slug})
    db.execute(
        text("DELETE FROM pcs_trades WHERE user_id = :uid AND slug = :s"),
        {"uid": user_id, "s": slug},
    )
    db.commit()
    return {"ok": True}


@router.get("/trade-defaults")
def pcs_get_trade_defaults(email: str = Depends(require_user), db=Depends(get_db)):
    user_id = _get_or_create_user(db, email)
    row = db.execute(
        text("SELECT value FROM pcs_user_meta WHERE user_id = :uid AND key = 'trade_defaults'"),
        {"uid": user_id},
    ).fetchone()
    data = {}
    if row and row[0]:
        try:
            data = json.loads(row[0])
        except (ValueError, TypeError):
            data = {}
    return {
        "from_name": data.get("from_name", ""),
        "to_name": data.get("to_name", ""),
        "notes": data.get("notes", ""),
    }


@router.put("/trade-defaults")
def pcs_put_trade_defaults(
    payload: PcsTradeDefaults,
    email: str = Depends(require_user),
    db=Depends(get_db),
):
    user_id = _get_or_create_user(db, email)
    value = json.dumps({
        "from_name": payload.from_name or "",
        "to_name": payload.to_name or "",
        "notes": payload.notes or "",
    })
    db.execute(
        text(
            """
            INSERT INTO pcs_user_meta (user_id, key, value)
            VALUES (:uid, 'trade_defaults', :v)
            ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value
            """
        ),
        {"uid": user_id, "v": value},
    )
    db.commit()
    return {"ok": True}
