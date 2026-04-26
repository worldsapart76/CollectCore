"""
Public Catalog endpoints for the guest webview.

These are unauthenticated (Cloudflare Access bypass on /catalog/*) — they serve
the shared photocard catalog so the guest browser can download a starter seed
and pull deltas thereafter. All write operations require admin auth (admin runs
behind Cloudflare Access at the apex domain).

Endpoints:
  GET /catalog/version          -> { max_version, card_count }
  GET /catalog/delta?since=N    -> raw table-row deltas the guest worker
                                   replays into its local SQLite mirror.
                                   See `catalog_delta` for the payload shape.
  GET /catalog/seed.db          -> local file (dev) or redirect to R2 (prod)
"""

import os
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse, RedirectResponse
from sqlalchemy import text

from constants import PHOTOCARD_COLLECTION_TYPE_ID
from dependencies import get_db
from file_helpers import DATA_ROOT


router = APIRouter(prefix="/catalog", tags=["catalog"])

SEED_DB_PATH = DATA_ROOT / "data" / "mobile_seed.db"


def _rows_as_dicts(result) -> list[dict]:
    """SQLAlchemy Row -> plain dict, suitable for JSON + worker INSERT-OR-REPLACE."""
    return [dict(r._mapping) for r in result]


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
    since: int = Query(0, ge=0, description="Return rows for items with catalog_version > since"),
    db=Depends(get_db),
):
    """
    Return raw table-row deltas the guest worker can replay into its local
    SQLite mirror with INSERT OR REPLACE. The guest schema mirrors admin's, so
    column names and IDs match verbatim.

    Shape:
      {
        "since": N,
        "max_version": M,
        "tables": {
          "tbl_items":                    [...rows],
          "tbl_photocard_details":        [...rows],
          "xref_photocard_members":       [...rows],   # all rows for touched items
          "tbl_attachments":              [...rows],   # front + back, all rows for touched items
          "lkup_photocard_groups":        [...rows],   # only rows referenced by touched items
          "lkup_photocard_source_origins":[...rows],
          "lkup_photocard_members":       [...rows],
          "lkup_top_level_categories":    [...rows]
        }
      }

    Tombstones (items removed from the catalog) are not yet emitted — admin has
    no remove-from-catalog flow today. When that flow lands (admin publish UI,
    PD1) a `tombstones` key will be added carrying catalog_item_id values to
    delete locally. Until then, items only ever get added/updated.

    Lookup tables only ship rows referenced by the changed items. A pure
    lookup edit (e.g. renaming a group with no item changes) won't propagate
    until something forces those items to bump their catalog_version. Known
    limitation; revisit if it becomes an actual user-visible problem.
    """
    max_version_row = db.execute(
        text(
            """
            SELECT COALESCE(MAX(catalog_version), 0) AS max_version
            FROM tbl_items
            WHERE collection_type_id = :pc AND catalog_item_id IS NOT NULL
            """
        ),
        {"pc": PHOTOCARD_COLLECTION_TYPE_ID},
    ).fetchone()
    max_version = max_version_row[0]

    item_rows = _rows_as_dicts(db.execute(
        text(
            """
            SELECT *
            FROM tbl_items
            WHERE collection_type_id = :pc
              AND catalog_item_id IS NOT NULL
              AND catalog_version > :since
            ORDER BY item_id
            """
        ),
        {"pc": PHOTOCARD_COLLECTION_TYPE_ID, "since": since},
    ))

    if not item_rows:
        return {
            "since": since,
            "max_version": max_version,
            "tables": {
                "tbl_items": [],
                "tbl_photocard_details": [],
                "xref_photocard_members": [],
                "tbl_attachments": [],
                "lkup_photocard_groups": [],
                "lkup_photocard_source_origins": [],
                "lkup_photocard_members": [],
                "lkup_top_level_categories": [],
            },
        }

    item_ids = [r["item_id"] for r in item_rows]
    placeholders = ",".join(f":id{i}" for i in range(len(item_ids)))
    id_params = {f"id{i}": v for i, v in enumerate(item_ids)}

    detail_rows = _rows_as_dicts(db.execute(
        text(f"SELECT * FROM tbl_photocard_details WHERE item_id IN ({placeholders})"),
        id_params,
    ))

    # All xref rows for touched items — guest replays as delete-by-item then
    # reinsert, so a removed member shows up as the absence of its row in this set.
    xref_rows = _rows_as_dicts(db.execute(
        text(f"SELECT * FROM xref_photocard_members WHERE item_id IN ({placeholders})"),
        id_params,
    ))

    # Same shape contract for attachments: guest deletes all front/back rows
    # for the touched item, then reinserts these. Handles cover swaps cleanly
    # (admin replaces an attachment row → old row gone from this payload).
    att_rows = _rows_as_dicts(db.execute(
        text(
            f"""
            SELECT * FROM tbl_attachments
            WHERE item_id IN ({placeholders})
              AND attachment_type IN ('front', 'back')
            """
        ),
        id_params,
    ))

    # Lookup rows referenced by the changed items. Includes the union of all
    # FKs the guest needs to insert these items without FK violations.
    group_ids = sorted({r["group_id"] for r in detail_rows})
    source_origin_ids = sorted({
        r["source_origin_id"] for r in detail_rows if r["source_origin_id"] is not None
    })
    member_ids = sorted({r["member_id"] for r in xref_rows})
    top_cat_ids = sorted({r["top_level_category_id"] for r in item_rows})

    def _fetch_lkup(table: str, pk: str, ids: list[int]) -> list[dict]:
        if not ids:
            return []
        ph = ",".join(f":v{i}" for i in range(len(ids)))
        params = {f"v{i}": v for i, v in enumerate(ids)}
        return _rows_as_dicts(db.execute(
            text(f"SELECT * FROM {table} WHERE {pk} IN ({ph})"), params,
        ))

    return {
        "since": since,
        "max_version": max_version,
        "tables": {
            "tbl_items": item_rows,
            "tbl_photocard_details": detail_rows,
            "xref_photocard_members": xref_rows,
            "tbl_attachments": att_rows,
            "lkup_photocard_groups": _fetch_lkup("lkup_photocard_groups", "group_id", group_ids),
            "lkup_photocard_source_origins": _fetch_lkup(
                "lkup_photocard_source_origins", "source_origin_id", source_origin_ids,
            ),
            "lkup_photocard_members": _fetch_lkup(
                "lkup_photocard_members", "member_id", member_ids,
            ),
            "lkup_top_level_categories": _fetch_lkup(
                "lkup_top_level_categories", "top_level_category_id", top_cat_ids,
            ),
        },
    }


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
