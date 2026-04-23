import os
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text

BGG_API_KEY = os.getenv("BGG_API_KEY", "").strip()

from constants import BOARDGAMES_COLLECTION_TYPE_ID
from dependencies import get_db
from file_helpers import delete_attachment_files, collect_cover_file, remove_files, resolve_cover_url
from helpers import generic_upsert, make_title_sort
from schemas.boardgames import (
    BoardgameBulkUpdatePayload,
    BoardgameCreate,
    BoardgameUpdate,
)
from schemas.photocards import BulkDeletePayload

router = APIRouter(prefix="/boardgames", tags=["boardgames"])


# ---------- Domain helpers ----------

def _insert_boardgame_designers(db, item_id: int, designer_names) -> None:
    if not designer_names:
        return
    for order, name in enumerate(designer_names):
        if name.strip():
            designer_id = generic_upsert(db, "boardgame_designer", name)
            db.execute(
                text("INSERT OR IGNORE INTO xref_boardgame_designers (item_id, designer_id, designer_order) VALUES (:item_id, :did, :ord)"),
                {"item_id": item_id, "did": designer_id, "ord": order},
            )


def _insert_boardgame_expansions(db, item_id: int, expansions) -> None:
    if not expansions:
        return
    for exp in expansions:
        db.execute(
            text("""
                INSERT INTO tbl_boardgame_expansions (item_id, title, year_published, ownership_status_id, external_work_id)
                VALUES (:item_id, :title, :year, :own, :ext)
            """),
            {
                "item_id": item_id,
                "title": exp.title.strip(),
                "year": exp.year_published,
                "own": exp.ownership_status_id,
                "ext": exp.external_work_id,
            },
        )


def _get_boardgame_detail(db, item_id: int):
    row = db.execute(
        text("""
            SELECT
                i.item_id,
                i.top_level_category_id,
                ltc.category_name,
                i.ownership_status_id,
                os.status_name,
                i.notes,
                i.created_at,
                i.updated_at,
                bd.title,
                bd.title_sort,
                bd.description,
                bd.year_published,
                bd.min_players,
                bd.max_players,
                bd.publisher_id,
                pub.publisher_name,
                bd.cover_image_url,
                bd.api_source,
                bd.external_work_id
            FROM tbl_items i
            JOIN tbl_boardgame_details bd ON i.item_id = bd.item_id
            JOIN lkup_ownership_statuses os ON i.ownership_status_id = os.ownership_status_id
            JOIN lkup_top_level_categories ltc ON i.top_level_category_id = ltc.top_level_category_id
            LEFT JOIN lkup_boardgame_publishers pub ON bd.publisher_id = pub.publisher_id
            WHERE i.item_id = :item_id AND i.collection_type_id = :ct
        """),
        {"item_id": item_id, "ct": BOARDGAMES_COLLECTION_TYPE_ID},
    ).fetchone()

    if not row:
        return None

    publisher_id = row[14]
    publisher_name = row[15]
    publisher = {"publisher_id": publisher_id, "publisher_name": publisher_name} if publisher_id else None

    designers = db.execute(
        text("""
            SELECT d.designer_id, d.designer_name, x.designer_order
            FROM xref_boardgame_designers x
            JOIN lkup_boardgame_designers d ON x.designer_id = d.designer_id
            WHERE x.item_id = :item_id
            ORDER BY x.designer_order
        """),
        {"item_id": item_id},
    ).fetchall()

    expansions = db.execute(
        text("""
            SELECT e.expansion_id, e.title, e.year_published, e.ownership_status_id, os.status_name, e.external_work_id
            FROM tbl_boardgame_expansions e
            LEFT JOIN lkup_ownership_statuses os ON e.ownership_status_id = os.ownership_status_id
            WHERE e.item_id = :item_id
            ORDER BY e.expansion_id
        """),
        {"item_id": item_id},
    ).fetchall()

    return {
        "item_id": row[0],
        "top_level_category_id": row[1],
        "category_name": row[2],
        "ownership_status_id": row[3],
        "ownership_status": row[4],
        "notes": row[5],
        "created_at": row[6],
        "updated_at": row[7],
        "title": row[8],
        "title_sort": row[9],
        "description": row[10],
        "year_published": row[11],
        "min_players": row[12],
        "max_players": row[13],
        "publisher_id": row[14],
        "publisher_name": publisher_name,
        "publisher": publisher,
        "cover_image_url": row[16],
        "api_source": row[17],
        "external_work_id": row[18],
        "designers": [{"designer_id": d[0], "designer_name": d[1]} for d in designers],
        "designer_names": [d[1] for d in designers],
        "expansions": [
            {
                "expansion_id": e[0],
                "title": e[1],
                "year_published": e[2],
                "ownership_status_id": e[3],
                "ownership_status": e[4],
                "external_work_id": e[5],
            }
            for e in expansions
        ],
    }


# ---------- Lookup endpoints ----------
# NOTE: specific paths must appear before /{item_id}

@router.get("/categories")
def get_boardgame_categories(db=Depends(get_db)):
    rows = db.execute(text("""
        SELECT ltc.top_level_category_id, ltc.category_name FROM lkup_top_level_categories ltc
        JOIN lkup_collection_types lct ON ltc.collection_type_id = lct.collection_type_id
        WHERE lct.collection_type_code = 'boardgames' AND ltc.is_active = 1
        ORDER BY ltc.sort_order
    """)).fetchall()
    return [{"top_level_category_id": r[0], "category_name": r[1]} for r in rows]


@router.get("/designers")
def get_boardgame_designers(q: Optional[str] = None, db=Depends(get_db)):
    if q:
        rows = db.execute(
            text("SELECT designer_id, designer_name FROM lkup_boardgame_designers WHERE is_active = 1 AND LOWER(designer_name) LIKE LOWER(:q) ORDER BY designer_name LIMIT 20"),
            {"q": f"%{q}%"},
        ).fetchall()
    else:
        rows = db.execute(text("SELECT designer_id, designer_name FROM lkup_boardgame_designers WHERE is_active = 1 ORDER BY designer_name")).fetchall()
    return [{"designer_id": r[0], "designer_name": r[1]} for r in rows]


@router.get("/publishers")
def get_boardgame_publishers(q: Optional[str] = None, db=Depends(get_db)):
    if q:
        rows = db.execute(
            text("SELECT publisher_id, publisher_name FROM lkup_boardgame_publishers WHERE is_active = 1 AND LOWER(publisher_name) LIKE LOWER(:q) ORDER BY publisher_name LIMIT 20"),
            {"q": f"%{q}%"},
        ).fetchall()
    else:
        rows = db.execute(text("SELECT publisher_id, publisher_name FROM lkup_boardgame_publishers WHERE is_active = 1 ORDER BY publisher_name")).fetchall()
    return [{"publisher_id": r[0], "publisher_name": r[1]} for r in rows]


@router.get("/bgg-search")
def bgg_search(q: str):
    """Search BoardGameGeek XML API v2. Returns lightweight result list."""
    if not q or not q.strip():
        return []
    encoded = urllib.parse.quote(q.strip())
    url = f"https://boardgamegeek.com/xmlapi2/search?query={encoded}&type=boardgame"
    try:
        headers = {"User-Agent": "CollectCore/1.0"}
        if BGG_API_KEY:
            headers["Authorization"] = f"Bearer {BGG_API_KEY}"
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=10) as resp:
            xml_data = resp.read().decode("utf-8")
        root = ET.fromstring(xml_data)
        results = []
        for item in root.findall("item"):
            bgg_id = item.get("id")
            name_el = item.find("name[@type='primary']") or item.find("name")
            title = name_el.get("value") if name_el is not None else None
            year_el = item.find("yearpublished")
            year = year_el.get("value") if year_el is not None else None
            if title:
                results.append({
                    "bgg_id": bgg_id,
                    "title": title,
                    "year_published": int(year) if year and year.isdigit() else None,
                })
        return results[:20]
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"BGG search failed: {str(e)}")


@router.get("/bgg-detail/{bgg_id}")
def bgg_detail(bgg_id: str):
    """Fetch detailed info from BGG for a single game (used to pre-fill the form)."""
    url = f"https://boardgamegeek.com/xmlapi2/thing?id={bgg_id}&stats=0"
    try:
        headers = {"User-Agent": "CollectCore/1.0"}
        if BGG_API_KEY:
            headers["Authorization"] = f"Bearer {BGG_API_KEY}"
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=10) as resp:
            xml_data = resp.read().decode("utf-8")
        root = ET.fromstring(xml_data)
        item = root.find("item")
        if item is None:
            raise HTTPException(status_code=404, detail="BGG item not found.")

        name_el = item.find("name[@type='primary']") or item.find("name")
        title = name_el.get("value") if name_el is not None else None
        year_el = item.find("yearpublished")
        year = int(year_el.get("value")) if year_el is not None and year_el.get("value", "").isdigit() else None
        min_p = item.find("minplayers")
        max_p = item.find("maxplayers")
        min_players = int(min_p.get("value")) if min_p is not None and min_p.get("value", "").isdigit() else None
        max_players = int(max_p.get("value")) if max_p is not None and max_p.get("value", "").isdigit() else None
        desc_el = item.find("description")
        description = desc_el.text.strip() if desc_el is not None and desc_el.text else None
        img_el = item.find("image")
        cover_image_url = img_el.text.strip() if img_el is not None and img_el.text else None
        if cover_image_url and not cover_image_url.startswith("http"):
            cover_image_url = "https:" + cover_image_url

        designers = []
        for link in item.findall("link[@type='boardgamedesigner']"):
            name = link.get("value")
            if name:
                designers.append(name)

        publisher = None
        for link in item.findall("link[@type='boardgamepublisher']"):
            publisher = link.get("value")
            break

        expansions = []
        for link in item.findall("link[@type='boardgameexpansion']"):
            exp_title = link.get("value")
            exp_id = link.get("id")
            if exp_title and link.get("inbound") != "true":
                expansions.append({"title": exp_title, "external_work_id": exp_id})

        return {
            "bgg_id": bgg_id,
            "title": title,
            "year_published": year,
            "min_players": min_players,
            "max_players": max_players,
            "description": description,
            "cover_image_url": cover_image_url,
            "designers": designers,
            "publisher": publisher,
            "expansions": expansions[:10],
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"BGG detail fetch failed: {str(e)}")


# ---------- CRUD endpoints ----------

@router.get("")
def list_boardgames(db=Depends(get_db)):
    rows = db.execute(
        text("""
            SELECT
                i.item_id,
                i.top_level_category_id,
                ltc.category_name,
                i.ownership_status_id,
                os.status_name,
                i.notes,
                bd.title,
                bd.title_sort,
                bd.year_published,
                bd.min_players,
                bd.max_players,
                bd.cover_image_url,
                bd.external_work_id,
                (SELECT p.publisher_name FROM lkup_boardgame_publishers p WHERE p.publisher_id = bd.publisher_id) AS publisher_name,
                (SELECT GROUP_CONCAT(d.designer_name, ', ')
                 FROM xref_boardgame_designers x
                 JOIN lkup_boardgame_designers d ON x.designer_id = d.designer_id
                 WHERE x.item_id = i.item_id
                 ORDER BY x.designer_order) AS designers_str,
                (SELECT COUNT(*) FROM tbl_boardgame_expansions e WHERE e.item_id = i.item_id) AS expansion_count
            FROM tbl_items i
            JOIN tbl_boardgame_details bd ON i.item_id = bd.item_id
            JOIN lkup_ownership_statuses os ON i.ownership_status_id = os.ownership_status_id
            JOIN lkup_top_level_categories ltc ON i.top_level_category_id = ltc.top_level_category_id
            WHERE i.collection_type_id = :ct
            ORDER BY COALESCE(bd.title_sort, bd.title)
        """),
        {"ct": BOARDGAMES_COLLECTION_TYPE_ID},
    ).fetchall()

    return [
        {
            "item_id": row[0],
            "top_level_category_id": row[1],
            "category_name": row[2],
            "ownership_status_id": row[3],
            "ownership_status": row[4],
            "notes": row[5],
            "title": row[6],
            "title_sort": row[7],
            "year_published": row[8],
            "min_players": row[9],
            "max_players": row[10],
            "cover_image_url": row[11],
            "external_work_id": row[12],
            "publisher_name": row[13],
            "designers": row[14].split(", ") if row[14] else [],
            "expansion_count": row[15],
        }
        for row in rows
    ]


@router.get("/{item_id}")
def get_boardgame(item_id: int, db=Depends(get_db)):
    game = _get_boardgame_detail(db, item_id)
    if not game:
        raise HTTPException(status_code=404, detail="Board game not found.")
    return game


@router.post("")
def create_boardgame(payload: BoardgameCreate, db=Depends(get_db)):
    publisher_id = None
    if payload.publisher_name and payload.publisher_name.strip():
        publisher_id = generic_upsert(db, "boardgame_publisher", payload.publisher_name)

    item_result = db.execute(
        text("""
            INSERT INTO tbl_items (collection_type_id, top_level_category_id, ownership_status_id, notes)
            VALUES (:ct, :cat, :own, :notes)
            RETURNING item_id
        """),
        {
            "ct": BOARDGAMES_COLLECTION_TYPE_ID,
            "cat": payload.top_level_category_id,
            "own": payload.ownership_status_id,
            "notes": payload.notes,
        },
    ).fetchone()
    item_id = item_result[0]

    db.execute(
        text("""
            INSERT INTO tbl_boardgame_details (
                item_id, title, title_sort, description,
                year_published, min_players, max_players,
                publisher_id, cover_image_url, api_source, external_work_id
            ) VALUES (
                :item_id, :title, :title_sort, :description,
                :year, :min_p, :max_p,
                :pub_id, :cover, :api_source, :ext_id
            )
        """),
        {
            "item_id": item_id,
            "title": payload.title.strip(),
            "title_sort": make_title_sort(payload.title.strip()),
            "description": payload.description,
            "year": payload.year_published,
            "min_p": payload.min_players,
            "max_p": payload.max_players,
            "pub_id": publisher_id,
            "cover": resolve_cover_url(payload.cover_image_url, "boardgames", item_id),
            "api_source": payload.api_source,
            "ext_id": payload.external_work_id,
        },
    )

    try:
        _insert_boardgame_designers(db, item_id, payload.designer_names or [])
        _insert_boardgame_expansions(db, item_id, payload.expansions or [])
        db.commit()
    except Exception:
        db.rollback()
        raise

    game = _get_boardgame_detail(db, item_id)
    return {"item_id": item_id, "status": "created", "boardgame": game}


@router.put("/{item_id}")
def update_boardgame(item_id: int, payload: BoardgameUpdate, db=Depends(get_db)):
    existing = db.execute(
        text("SELECT item_id FROM tbl_items WHERE item_id = :id AND collection_type_id = :ct"),
        {"id": item_id, "ct": BOARDGAMES_COLLECTION_TYPE_ID},
    ).fetchone()
    if not existing:
        raise HTTPException(status_code=404, detail="Board game not found.")

    publisher_id = None
    if payload.publisher_name and payload.publisher_name.strip():
        publisher_id = generic_upsert(db, "boardgame_publisher", payload.publisher_name)

    db.execute(
        text("""
            UPDATE tbl_items
            SET top_level_category_id = :cat,
                ownership_status_id = :own,
                notes = :notes,
                updated_at = CURRENT_TIMESTAMP
            WHERE item_id = :id
        """),
        {"id": item_id, "cat": payload.top_level_category_id, "own": payload.ownership_status_id, "notes": payload.notes},
    )

    db.execute(
        text("""
            UPDATE tbl_boardgame_details
            SET title = :title,
                title_sort = :title_sort,
                description = :description,
                year_published = :year,
                min_players = :min_p,
                max_players = :max_p,
                publisher_id = :pub_id,
                cover_image_url = :cover,
                api_source = :api_source,
                external_work_id = :ext_id
            WHERE item_id = :id
        """),
        {
            "id": item_id,
            "title": payload.title.strip(),
            "title_sort": make_title_sort(payload.title.strip()),
            "description": payload.description,
            "year": payload.year_published,
            "min_p": payload.min_players,
            "max_p": payload.max_players,
            "pub_id": publisher_id,
            "cover": resolve_cover_url(payload.cover_image_url, "boardgames", item_id),
            "api_source": payload.api_source,
            "ext_id": payload.external_work_id,
        },
    )

    try:
        db.execute(text("DELETE FROM xref_boardgame_designers WHERE item_id = :id"), {"id": item_id})
        db.execute(text("DELETE FROM tbl_boardgame_expansions WHERE item_id = :id"), {"id": item_id})
        _insert_boardgame_designers(db, item_id, payload.designer_names or [])
        _insert_boardgame_expansions(db, item_id, payload.expansions or [])
        db.commit()
    except Exception:
        db.rollback()
        raise

    game = _get_boardgame_detail(db, item_id)
    return {"item_id": item_id, "status": "updated", "boardgame": game}


@router.delete("/{item_id}")
def delete_boardgame(item_id: int, db=Depends(get_db)):
    existing = db.execute(
        text("SELECT item_id FROM tbl_items WHERE item_id = :id AND collection_type_id = :ct"),
        {"id": item_id, "ct": BOARDGAMES_COLLECTION_TYPE_ID},
    ).fetchone()
    if not existing:
        raise HTTPException(status_code=404, detail="Board game not found.")

    files_to_delete = delete_attachment_files(db, item_id)
    files_to_delete.extend(collect_cover_file(db, "tbl_boardgame_details", item_id))
    db.execute(text("DELETE FROM xref_boardgame_designers WHERE item_id = :id"), {"id": item_id})
    db.execute(text("DELETE FROM tbl_boardgame_expansions WHERE item_id = :id"), {"id": item_id})
    db.execute(text("DELETE FROM tbl_attachments WHERE item_id = :id"), {"id": item_id})
    db.execute(text("DELETE FROM tbl_boardgame_details WHERE item_id = :id"), {"id": item_id})
    db.execute(text("DELETE FROM tbl_items WHERE item_id = :id"), {"id": item_id})

    db.commit()
    remove_files(files_to_delete)
    return {"deleted": item_id}


# ---------- Bulk endpoints ----------

@router.patch("/bulk")
def bulk_update_boardgames(payload: BoardgameBulkUpdatePayload, db=Depends(get_db)):
    for item_id in payload.item_ids:
        existing = db.execute(
            text("SELECT item_id FROM tbl_items WHERE item_id = :id AND collection_type_id = :ct"),
            {"id": item_id, "ct": BOARDGAMES_COLLECTION_TYPE_ID},
        ).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail=f"Item {item_id} not found.")

        updates = []
        params = {"id": item_id}
        if payload.fields.ownership_status_id is not None:
            updates.append("ownership_status_id = :own")
            params["own"] = payload.fields.ownership_status_id
        if payload.fields.top_level_category_id is not None:
            updates.append("top_level_category_id = :cat")
            params["cat"] = payload.fields.top_level_category_id

        if updates:
            updates.append("updated_at = CURRENT_TIMESTAMP")
            db.execute(
                text(f"UPDATE tbl_items SET {', '.join(updates)} WHERE item_id = :id"),
                params,
            )

    db.commit()
    return {"updated": payload.item_ids, "count": len(payload.item_ids)}


@router.post("/bulk-delete")
def bulk_delete_boardgames(payload: BulkDeletePayload, db=Depends(get_db)):
    for item_id in payload.item_ids:
        existing = db.execute(
            text("SELECT item_id FROM tbl_items WHERE item_id = :id AND collection_type_id = :ct"),
            {"id": item_id, "ct": BOARDGAMES_COLLECTION_TYPE_ID},
        ).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail=f"Item {item_id} not found.")

    all_files = []
    for item_id in payload.item_ids:
        all_files.extend(delete_attachment_files(db, item_id))
        all_files.extend(collect_cover_file(db, "tbl_boardgame_details", item_id))
        db.execute(text("DELETE FROM xref_boardgame_designers WHERE item_id = :id"), {"id": item_id})
        db.execute(text("DELETE FROM tbl_boardgame_expansions WHERE item_id = :id"), {"id": item_id})
        db.execute(text("DELETE FROM tbl_attachments WHERE item_id = :id"), {"id": item_id})
        db.execute(text("DELETE FROM tbl_boardgame_details WHERE item_id = :id"), {"id": item_id})
        db.execute(text("DELETE FROM tbl_items WHERE item_id = :id"), {"id": item_id})

    db.commit()
    remove_files(all_files)
    return {"deleted": payload.item_ids, "count": len(payload.item_ids)}
