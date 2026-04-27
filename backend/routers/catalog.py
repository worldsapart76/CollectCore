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

from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from sqlalchemy import text

from constants import PHOTOCARD_COLLECTION_TYPE_ID
from dependencies import get_db
from file_helpers import DATA_ROOT


router = APIRouter(prefix="/catalog", tags=["catalog"])

# Two places we look for the seed DB, in order:
#   1. The volume-mounted DATA_ROOT/data/mobile_seed.db — used in dev (where
#      DATA_ROOT == project root) and as the preferred path on Railway if
#      something pre-stages it on the volume.
#   2. backend/data/mobile_seed.db — committed into the repo, ships with the
#      Railway deploy. This is the production fallback after we abandoned the
#      R2 redirect / proxy approach (R2 CORS doesn't apply to custom-domain
#      requests; Cloudflare Transform Rules and inline urllib proxy both
#      proved fragile). Bumping the seed = re-running prepare_mobile_seed.py
#      and committing the new file.
SEED_DB_PATH = DATA_ROOT / "data" / "mobile_seed.db"
SEED_DB_PATH_BAKED = Path(__file__).resolve().parents[1] / "data" / "mobile_seed.db"


def _find_seed_db() -> Path | None:
    if SEED_DB_PATH.is_file():
        return SEED_DB_PATH
    if SEED_DB_PATH_BAKED.is_file():
        return SEED_DB_PATH_BAKED
    return None


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

    Lookup tables (lkup_* + xref_ownership_status_modules) ship in FULL on
    every delta call — they're tiny (a few KB total) and lookup edits like
    "uncheck Formerly Owned for photocards" or "rename a group" don't bump
    any item's catalog_version, so the alternative (only ship rows
    referenced by changed items) silently lost lookup-only updates. The
    worker upserts via INSERT OR REPLACE so wholesale shipment overwrites
    cleanly. Cost is negligible; correctness is decisive.
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

    # Full lookup payload — always shipped, regardless of whether any items
    # changed. See docstring for rationale.
    full_lookups = {
        "lkup_collection_types": _rows_as_dicts(db.execute(
            text("SELECT * FROM lkup_collection_types")
        )),
        "lkup_ownership_statuses": _rows_as_dicts(db.execute(
            text("SELECT * FROM lkup_ownership_statuses")
        )),
        "xref_ownership_status_modules": _rows_as_dicts(db.execute(
            text("SELECT * FROM xref_ownership_status_modules")
        )),
        "lkup_top_level_categories": _rows_as_dicts(db.execute(
            text(
                "SELECT * FROM lkup_top_level_categories WHERE collection_type_id = :pc"
            ),
            {"pc": PHOTOCARD_COLLECTION_TYPE_ID},
        )),
        "lkup_photocard_groups": _rows_as_dicts(db.execute(
            text("SELECT * FROM lkup_photocard_groups")
        )),
        "lkup_photocard_members": _rows_as_dicts(db.execute(
            text("SELECT * FROM lkup_photocard_members")
        )),
        "lkup_photocard_source_origins": _rows_as_dicts(db.execute(
            text("SELECT * FROM lkup_photocard_source_origins")
        )),
    }

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
                **full_lookups,
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

    return {
        "since": since,
        "max_version": max_version,
        "tables": {
            "tbl_items": item_rows,
            "tbl_photocard_details": detail_rows,
            "xref_photocard_members": xref_rows,
            "tbl_attachments": att_rows,
            **full_lookups,
        },
    }


@router.get("/seed.db")
def catalog_seed_db():
    """
    Return the current guest seed DB. FileResponse from local disk —
    CORS headers come from CORSMiddleware uniformly.

    See module docstring on _find_seed_db() for the lookup order. To
    publish a new seed: run `python tools/prepare_mobile_seed.py`,
    copy the resulting `data/mobile_seed.db` to `backend/data/mobile_seed.db`,
    commit, push.
    """
    seed = _find_seed_db()
    if seed is None:
        raise HTTPException(
            status_code=404,
            detail="Seed DB not found. Run tools/prepare_mobile_seed.py and "
                   "commit data/mobile_seed.db to backend/data/mobile_seed.db.",
        )
    return FileResponse(
        path=str(seed),
        media_type="application/x-sqlite3",
        filename="seed.db",
    )
