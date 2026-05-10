"""
Photocard trade pages — server-hosted shareable URLs.

Created from the photocard library multi-select in either the admin or guest
bundle. Anyone with the link can view; CollectCore viewers (admin or guest)
get ownership badges layered on at view time via a separate library lookup.

Plan: C:\\Users\\world\\.claude\\plans\\photocard-trading-v2.md

Security model (Cloudflare Access at the network layer):
  Bypass policy on /trade/*    → POST/GET visible to the public.
  Default policy on /admin/*   → list/delete restricted to admins.
"""

import json
import logging
import secrets
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text

from dependencies import get_db


logger = logging.getLogger("collectcore.trades")
router = APIRouter(tags=["trades"])

PHOTOCARDS_TYPE_ID = 1
GUEST_TRADE_LIFETIME = "+30 days"


# ---------- Payload helpers ----------

def _build_caption(members: List[str], source_origin: Optional[str], version: Optional[str]) -> List[str]:
    """[members joined, source_origin, version] with trailing empties stripped."""
    lines: List[str] = []
    lines.append(", ".join(members) if members else "—")
    lines.append(source_origin or "")
    lines.append(version or "")
    while lines and not lines[-1]:
        lines.pop()
    return lines


def _resolve_catalog_item_ids(db, item_ids: List[int]) -> List[str]:
    """Map a list of admin-side item_ids to catalog_item_ids, dropping items
    that haven't been published to the catalog yet. Preserves input order
    (best effort — duplicates and non-photocards are silently dropped)."""
    if not item_ids:
        return []
    placeholders = ",".join(str(i) for i in item_ids)
    rows = db.execute(
        text(
            f"SELECT item_id, catalog_item_id FROM tbl_items "
            f"WHERE item_id IN ({placeholders}) "
            f"AND collection_type_id = {PHOTOCARDS_TYPE_ID} "
            f"AND catalog_item_id IS NOT NULL"
        )
    ).fetchall()
    cat_by_item = {r[0]: r[1] for r in rows}
    return [cat_by_item[i] for i in item_ids if i in cat_by_item]


def _fetch_payload_cards(db, catalog_item_ids: List[str], include_backs: bool) -> List[dict]:
    """Pull payload-shape rows for the given catalog_item_ids in input order.
    Returns one dict per card with catalog_item_id, front_url, optional
    back_url, and a caption list. Cards without a front image are silently
    skipped (a trade page with grey rectangles isn't useful)."""
    if not catalog_item_ids:
        return []

    # Quote each id once via SQLAlchemy bind params keyed by index.
    placeholders = ",".join(f":id{i}" for i in range(len(catalog_item_ids)))
    binds = {f"id{i}": cid for i, cid in enumerate(catalog_item_ids)}

    sql = f"""
        SELECT
            i.catalog_item_id,
            so.source_origin_name,
            p.version,
            COALESCE(
                (SELECT GROUP_CONCAT(m.member_name, ', ')
                 FROM xref_photocard_members xpm
                 JOIN lkup_photocard_members m ON xpm.member_id = m.member_id
                 WHERE xpm.item_id = i.item_id
                 ORDER BY m.member_id),
                ''
            ) AS members,
            MAX(CASE WHEN a.attachment_type = 'front' THEN a.file_path END) AS front_url,
            MAX(CASE WHEN a.attachment_type = 'back'  THEN a.file_path END) AS back_url
        FROM tbl_items i
        JOIN tbl_photocard_details p ON i.item_id = p.item_id
        LEFT JOIN lkup_photocard_source_origins so ON p.source_origin_id = so.source_origin_id
        LEFT JOIN tbl_attachments a ON a.item_id = i.item_id
                                    AND a.attachment_type IN ('front', 'back')
        WHERE i.catalog_item_id IN ({placeholders})
        GROUP BY i.item_id, so.source_origin_name, p.version
    """
    rows = db.execute(text(sql), binds).fetchall()

    by_cid = {}
    for cid, source_origin, version, members_csv, front_url, back_url in rows:
        if not front_url or not str(front_url).startswith("http"):
            # Card hasn't been published to R2 — skip; the trade page would
            # otherwise reference a local-only path that the recipient cannot resolve.
            continue
        members = [m for m in (members_csv.split(", ") if members_csv else []) if m]
        card = {
            "catalog_item_id": cid,
            "front_url": front_url,
            "caption": _build_caption(members, source_origin, version),
        }
        if include_backs and back_url and str(back_url).startswith("http"):
            card["back_url"] = back_url
        by_cid[cid] = card

    return [by_cid[cid] for cid in catalog_item_ids if cid in by_cid]


# ---------- POST /trade ----------

class CreateTradeBody(BaseModel):
    created_by: str = Field(..., pattern="^(admin|guest)$")
    from_name: str = Field(..., min_length=1, max_length=120)
    to_name: Optional[str] = Field(None, max_length=120)
    notes: Optional[str] = Field(None, max_length=2000)
    include_backs: bool = False
    item_ids: Optional[List[int]] = None
    catalog_item_ids: Optional[List[str]] = None


def _generate_slug(db) -> str:
    for _ in range(8):
        candidate = secrets.token_urlsafe(7).rstrip("=")  # ~10 chars URL-safe
        existing = db.execute(
            text("SELECT 1 FROM tbl_trades WHERE slug = :s"),
            {"s": candidate},
        ).fetchone()
        if not existing:
            return candidate
    raise HTTPException(status_code=500, detail="Failed to generate unique slug.")


@router.post("/trade")
def create_trade(body: CreateTradeBody, db=Depends(get_db)):
    if (body.item_ids is None) == (body.catalog_item_ids is None):
        raise HTTPException(status_code=400, detail="Provide exactly one of item_ids or catalog_item_ids.")

    if body.item_ids is not None:
        catalog_item_ids = _resolve_catalog_item_ids(db, body.item_ids)
        unpublished_count = len(body.item_ids) - len(catalog_item_ids)
    else:
        catalog_item_ids = body.catalog_item_ids or []
        unpublished_count = 0

    cards = _fetch_payload_cards(db, catalog_item_ids, body.include_backs)
    if not cards:
        raise HTTPException(
            status_code=400,
            detail="No eligible cards in selection (all are missing catalog_item_id or a published front image).",
        )

    payload = {"version": 1, "cards": cards}
    payload_json = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))

    slug = _generate_slug(db)
    if body.created_by == "guest":
        expires_clause = f"datetime('now', '{GUEST_TRADE_LIFETIME}')"
    else:
        expires_clause = "NULL"

    db.execute(
        text(
            f"INSERT INTO tbl_trades "
            f"(slug, created_by, from_name, to_name, notes, include_backs, payload_json, expires_at) "
            f"VALUES (:slug, :cb, :fn, :tn, :nt, :ib, :pj, {expires_clause})"
        ),
        {
            "slug": slug,
            "cb": body.created_by,
            "fn": body.from_name.strip(),
            "tn": (body.to_name or "").strip() or None,
            "nt": (body.notes or "").strip() or None,
            "ib": 1 if body.include_backs else 0,
            "pj": payload_json,
        },
    )
    row = db.execute(
        text("SELECT created_at, expires_at FROM tbl_trades WHERE slug = :s"),
        {"s": slug},
    ).fetchone()
    db.commit()

    logger.info("Trade created slug=%s by=%s cards=%d", slug, body.created_by, len(cards))

    return {
        "slug": slug,
        "url": f"/trade/{slug}",
        "card_count": len(cards),
        "skipped_unpublished": unpublished_count + max(0, len(catalog_item_ids) - len(cards)),
        "created_at": row[0],
        "expires_at": row[1],
    }


# ---------- GET /trade/data/<slug> ----------

@router.get("/trade/data/{slug}")
def get_trade_data(slug: str, db=Depends(get_db)):
    row = db.execute(
        text(
            "SELECT slug, created_by, from_name, to_name, notes, include_backs, "
            "payload_json, created_at, expires_at "
            "FROM tbl_trades WHERE slug = :s"
        ),
        {"s": slug},
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Trade not found.")

    expires_at = row[8]
    if expires_at:
        # Lazy delete: drop the row + report 404 if it's past its expiry.
        expired = db.execute(
            text("SELECT 1 WHERE :exp <= datetime('now')"),
            {"exp": expires_at},
        ).fetchone()
        if expired:
            db.execute(text("DELETE FROM tbl_trades WHERE slug = :s"), {"s": slug})
            db.commit()
            raise HTTPException(status_code=404, detail="Trade has expired.")

    return {
        "slug": row[0],
        "created_by": row[1],
        "from_name": row[2],
        "to_name": row[3],
        "notes": row[4],
        "include_backs": bool(row[5]),
        "payload": json.loads(row[6]),
        "created_at": row[7],
        "expires_at": expires_at,
    }


# ---------- Admin-only management ----------
# Mounted under /admin/* so Cloudflare Access default policy gates them while
# /trade/* stays bypassed for public viewing.

@router.get("/admin/trades")
def list_trades(db=Depends(get_db)):
    rows = db.execute(
        text(
            "SELECT slug, created_by, from_name, to_name, notes, "
            "created_at, expires_at, "
            "(SELECT COUNT(*) FROM json_each(json_extract(payload_json, '$.cards'))) AS card_count "
            "FROM tbl_trades "
            "ORDER BY created_at DESC"
        )
    ).fetchall()
    return [
        {
            "slug": r[0],
            "created_by": r[1],
            "from_name": r[2],
            "to_name": r[3],
            "notes": r[4],
            "created_at": r[5],
            "expires_at": r[6],
            "card_count": r[7],
            "url": f"/trade/{r[0]}",
        }
        for r in rows
    ]


@router.delete("/admin/trade/{slug}")
def delete_trade(slug: str, db=Depends(get_db)):
    result = db.execute(text("DELETE FROM tbl_trades WHERE slug = :s"), {"s": slug})
    db.commit()
    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="Trade not found.")
    return {"deleted": slug}


# ---------- Viewer-mode probe ----------
# The trade page calls this on mount to detect whether the viewer is admin
# (Cloudflare Access auth cookie present → request reaches us with admin
# headers) or unauthenticated (CF Access blocks → 401/403 returned by Cloudflare,
# never reaches here). Guest mode is detected client-side from OPFS presence.

@router.get("/admin/me")
def admin_me():
    # If this code runs, the request passed CF Access. We don't currently
    # consume CF identity headers, but expose a constant probe response so
    # the trade page can branch on "did this 200 or 401". Future: surface
    # cf-access-authenticated-user-email here once user attribution lands.
    return {"is_admin": True}


# ---------- Trade-page badge lookup (admin viewer mode) ----------

@router.get("/admin/trade-ownership")
def trade_ownership(ids: str, db=Depends(get_db)):
    """For a comma-separated list of catalog_item_ids, return the admin's
    ownership state per id: 'owned' | 'wanted' | 'in_catalog'. Cards not
    found in the admin's library are absent from the result (which the
    trade page renders as 'Not yet in your catalog')."""
    cat_ids = [x.strip() for x in ids.split(",") if x.strip()]
    if not cat_ids:
        return {}
    placeholders = ",".join(f":c{i}" for i in range(len(cat_ids)))
    binds = {f"c{i}": cid for i, cid in enumerate(cat_ids)}
    rows = db.execute(
        text(
            f"""
            SELECT i.catalog_item_id,
                   MAX(CASE WHEN os.status_code = 'owned'  THEN 1 ELSE 0 END) AS is_owned,
                   MAX(CASE WHEN os.status_code = 'wanted' THEN 1 ELSE 0 END) AS is_wanted
            FROM tbl_items i
            LEFT JOIN tbl_photocard_copies pc ON pc.item_id = i.item_id
            LEFT JOIN lkup_ownership_statuses os ON pc.ownership_status_id = os.ownership_status_id
            WHERE i.catalog_item_id IN ({placeholders})
              AND i.collection_type_id = {PHOTOCARDS_TYPE_ID}
            GROUP BY i.catalog_item_id
            """
        ),
        binds,
    ).fetchall()

    result = {}
    for cid, is_owned, is_wanted in rows:
        if is_owned:
            result[cid] = "owned"
        elif is_wanted:
            result[cid] = "wanted"
        else:
            result[cid] = "in_catalog"
    return result
