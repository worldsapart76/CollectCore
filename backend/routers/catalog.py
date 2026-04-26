"""
Public Catalog endpoints for guest mobile clients.

These are unauthenticated — they serve the shared photocard catalog so guest apps
can download a starter seed and pull deltas thereafter. All write operations
require admin auth (not implemented in v1 — admin runs locally).

Endpoints:
  GET /catalog/version          -> { max_version, card_count }
  GET /catalog/delta?since=N    -> [{ ...card }], cards with catalog_version > N
  GET /catalog/seed.db          -> redirect to R2 (if configured) or local file
"""

import os
from collections import defaultdict
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse, RedirectResponse
from sqlalchemy import text

from constants import PHOTOCARD_COLLECTION_TYPE_ID
from dependencies import get_db
from file_helpers import DATA_ROOT


router = APIRouter(prefix="/catalog", tags=["catalog"])

SEED_DB_PATH = DATA_ROOT / "data" / "mobile_seed.db"


@router.get("/version")
def catalog_version(db=Depends(get_db)):
    row = db.execute(
        text(
            """
            SELECT COALESCE(MAX(catalog_version), 0) AS max_version,
                   COUNT(*) AS card_count
            FROM tbl_items
            WHERE collection_type_id = :pc AND catalog_item_id IS NOT NULL
            """
        ),
        {"pc": PHOTOCARD_COLLECTION_TYPE_ID},
    ).fetchone()
    return {"max_version": row[0], "card_count": row[1]}


@router.get("/delta")
def catalog_delta(
    since: int = Query(0, ge=0, description="Return cards with catalog_version > since"),
    db=Depends(get_db),
):
    card_rows = db.execute(
        text(
            """
            SELECT i.item_id,
                   i.catalog_item_id,
                   i.catalog_version,
                   i.top_level_category_id,
                   tlc.category_name,
                   i.notes,
                   g.group_code,
                   g.group_name,
                   d.version,
                   d.is_special,
                   so.source_origin_name
            FROM tbl_items i
            JOIN tbl_photocard_details d ON d.item_id = i.item_id
            JOIN lkup_photocard_groups g ON g.group_id = d.group_id
            LEFT JOIN lkup_photocard_source_origins so ON so.source_origin_id = d.source_origin_id
            LEFT JOIN lkup_top_level_categories tlc ON tlc.top_level_category_id = i.top_level_category_id
            WHERE i.collection_type_id = :pc
              AND i.catalog_item_id IS NOT NULL
              AND i.catalog_version > :since
            ORDER BY i.item_id
            """
        ),
        {"pc": PHOTOCARD_COLLECTION_TYPE_ID, "since": since},
    ).fetchall()

    if not card_rows:
        return {"since": since, "count": 0, "cards": []}

    item_ids = [r[0] for r in card_rows]
    placeholders = ",".join(f":id{i}" for i in range(len(item_ids)))
    id_params = {f"id{i}": v for i, v in enumerate(item_ids)}

    member_rows = db.execute(
        text(
            f"""
            SELECT x.item_id, m.member_code, m.member_name
            FROM xref_photocard_members x
            JOIN lkup_photocard_members m ON m.member_id = x.member_id
            WHERE x.item_id IN ({placeholders})
            ORDER BY m.sort_order, m.member_name
            """
        ),
        id_params,
    ).fetchall()
    members_by_item: dict[int, list[dict]] = defaultdict(list)
    for item_id, code, name in member_rows:
        members_by_item[item_id].append({"code": code, "name": name})

    att_rows = db.execute(
        text(
            f"""
            SELECT item_id, attachment_type, file_path, storage_type
            FROM tbl_attachments
            WHERE item_id IN ({placeholders})
              AND attachment_type IN ('front', 'back')
            """
        ),
        id_params,
    ).fetchall()
    atts_by_item: dict[int, dict[str, dict]] = defaultdict(dict)
    for item_id, atype, file_path, storage_type in att_rows:
        atts_by_item[item_id][atype] = {"url": file_path, "storage_type": storage_type}

    cards = []
    for (
        item_id, cat_id, cat_ver, top_cat_id, cat_name,
        notes, group_code, group_name, version, is_special, source_origin_name,
    ) in card_rows:
        att = atts_by_item.get(item_id, {})
        cards.append({
            "catalog_item_id": cat_id,
            "catalog_version": cat_ver,
            "group_code": group_code,
            "group_name": group_name,
            "top_level_category_id": top_cat_id,
            "category": cat_name,
            "source_origin": source_origin_name,
            "version": version,
            "is_special": bool(is_special),
            "members": members_by_item.get(item_id, []),
            "notes": notes,
            "front": att.get("front"),
            "back": att.get("back"),
        })

    return {"since": since, "count": len(cards), "cards": cards}


@router.get("/seed.db")
def catalog_seed_db():
    """
    Return the current guest seed DB.

    - Local dev: serves data/mobile_seed.db directly (avoids the cross-origin
      redirect that would otherwise break a fetch from localhost:5181 because
      R2's public domain isn't CORS-configured for dev origins).
    - Production (Railway): no local file present, so falls through to a 302
      redirect to R2 where the seed has been uploaded by
      tools/prepare_mobile_seed.py --upload.
    """
    if SEED_DB_PATH.is_file():
        return FileResponse(
            path=str(SEED_DB_PATH),
            media_type="application/x-sqlite3",
            filename="seed.db",
        )

    public_base = os.environ.get("R2_PUBLIC_BASE_URL", "").strip().rstrip("/")
    if public_base:
        return RedirectResponse(f"{public_base}/catalog/seed.db", status_code=302)

    raise HTTPException(
        status_code=404,
        detail="Seed DB unavailable: run tools/prepare_mobile_seed.py or set R2_PUBLIC_BASE_URL",
    )
