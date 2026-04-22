import json
import os
import urllib.parse
import urllib.request
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text

from constants import VIDEOGAMES_COLLECTION_TYPE_ID
from dependencies import get_db
from file_helpers import delete_attachment_files, collect_cover_file, remove_files, resolve_cover_url
from helpers import generic_upsert, make_title_sort
from schemas.videogames import (
    GameBulkUpdatePayload,
    VideoGameCreate,
    VideoGameUpdate,
)
from schemas.photocards import BulkDeletePayload

router = APIRouter(prefix="/videogames", tags=["videogames"])

# ---------- API keys ----------
RAWG_API_KEY = os.environ.get("RAWG_API_KEY", "")


# ---------- Domain helpers ----------

def _insert_game_relationships(db, item_id: int, payload) -> None:
    if payload.developer_names:
        for name in payload.developer_names:
            if name.strip():
                dev_id = generic_upsert(db, "game_developer", name)
                db.execute(
                    text("INSERT OR IGNORE INTO xref_game_developers (item_id, developer_id) VALUES (:item_id, :dev_id)"),
                    {"item_id": item_id, "dev_id": dev_id},
                )
    if payload.publisher_names:
        for name in payload.publisher_names:
            if name.strip():
                pub_id = generic_upsert(db, "game_publisher", name)
                db.execute(
                    text("INSERT OR IGNORE INTO xref_game_publishers (item_id, publisher_id) VALUES (:item_id, :pub_id)"),
                    {"item_id": item_id, "pub_id": pub_id},
                )
    if payload.genres:
        for g in payload.genres:
            db.execute(
                text("""
                    INSERT OR IGNORE INTO xref_game_genres (item_id, top_genre_id, sub_genre_id)
                    VALUES (:item_id, :top, :sub)
                """),
                {"item_id": item_id, "top": g.top_genre_id, "sub": g.sub_genre_id},
            )


def _insert_game_copies(db, item_id: int, copies) -> None:
    if not copies:
        return
    for copy in copies:
        db.execute(
            text("""
                INSERT INTO tbl_game_copies (item_id, platform_id, edition, ownership_status_id, notes)
                VALUES (:item_id, :platform_id, :edition, :ownership_status_id, :notes)
            """),
            {
                "item_id": item_id,
                "platform_id": copy.platform_id,
                "edition": copy.edition,
                "ownership_status_id": copy.ownership_status_id,
                "notes": copy.notes,
            },
        )


def _get_game_detail(db, item_id: int):
    row = db.execute(
        text("""
            SELECT
                i.item_id,
                i.ownership_status_id,
                os.status_name,
                i.reading_status_id,
                rs.status_name,
                i.notes,
                i.created_at,
                i.updated_at,
                gd.title,
                gd.title_sort,
                gd.description,
                gd.release_date,
                gd.cover_image_url,
                gd.api_source,
                gd.external_work_id
            FROM tbl_items i
            JOIN tbl_game_details gd ON i.item_id = gd.item_id
            JOIN lkup_ownership_statuses os ON i.ownership_status_id = os.ownership_status_id
            LEFT JOIN lkup_consumption_statuses rs ON i.reading_status_id = rs.read_status_id
            WHERE i.item_id = :item_id AND i.collection_type_id = :ct
        """),
        {"item_id": item_id, "ct": VIDEOGAMES_COLLECTION_TYPE_ID},
    ).fetchone()

    if not row:
        return None

    developers = db.execute(
        text("""
            SELECT d.developer_id, d.developer_name
            FROM xref_game_developers xd
            JOIN lkup_game_developers d ON xd.developer_id = d.developer_id
            WHERE xd.item_id = :item_id
            ORDER BY d.developer_name
        """),
        {"item_id": item_id},
    ).fetchall()

    publishers = db.execute(
        text("""
            SELECT p.publisher_id, p.publisher_name
            FROM xref_game_publishers xp
            JOIN lkup_game_publishers p ON xp.publisher_id = p.publisher_id
            WHERE xp.item_id = :item_id
            ORDER BY p.publisher_name
        """),
        {"item_id": item_id},
    ).fetchall()

    genres = db.execute(
        text("""
            SELECT xg.xref_id, xg.top_genre_id, tg.genre_name, xg.sub_genre_id, sg.sub_genre_name
            FROM xref_game_genres xg
            JOIN lkup_game_top_genres tg ON xg.top_genre_id = tg.top_genre_id
            LEFT JOIN lkup_game_sub_genres sg ON xg.sub_genre_id = sg.sub_genre_id
            WHERE xg.item_id = :item_id
            ORDER BY tg.sort_order, sg.sort_order
        """),
        {"item_id": item_id},
    ).fetchall()

    copies = db.execute(
        text("""
            SELECT gc.copy_id, gc.platform_id, p.platform_name,
                   gc.edition, gc.ownership_status_id, os.status_name, gc.notes
            FROM tbl_game_copies gc
            LEFT JOIN lkup_game_platforms p ON gc.platform_id = p.platform_id
            LEFT JOIN lkup_ownership_statuses os ON gc.ownership_status_id = os.ownership_status_id
            WHERE gc.item_id = :item_id
            ORDER BY gc.copy_id
        """),
        {"item_id": item_id},
    ).fetchall()

    return {
        "item_id": row[0],
        "ownership_status_id": row[1],
        "ownership_status": row[2],
        "play_status_id": row[3],
        "play_status": row[4],
        "notes": row[5],
        "created_at": row[6],
        "updated_at": row[7],
        "title": row[8],
        "title_sort": row[9],
        "description": row[10],
        "release_date": row[11],
        "cover_image_url": row[12],
        "api_source": row[13],
        "external_work_id": row[14],
        "developers": [{"developer_id": d[0], "developer_name": d[1]} for d in developers],
        "publisher_names": [p[1] for p in publishers],
        "publishers": [{"publisher_id": p[0], "publisher_name": p[1]} for p in publishers],
        "genres": [
            {
                "xref_id": g[0],
                "top_genre_id": g[1],
                "genre_name": g[2],
                "sub_genre_id": g[3],
                "sub_genre_name": g[4],
            }
            for g in genres
        ],
        "copies": [
            {
                "copy_id": c[0],
                "platform_id": c[1],
                "platform_name": c[2],
                "edition": c[3],
                "ownership_status_id": c[4],
                "ownership_status": c[5],
                "notes": c[6],
            }
            for c in copies
        ],
    }


# ---------- Lookup endpoints ----------
# NOTE: specific paths must appear before /{item_id}

@router.get("/genres")
def get_game_genres(db=Depends(get_db)):
    top_rows = db.execute(text("""
        SELECT top_genre_id, genre_name FROM lkup_game_top_genres
        WHERE is_active = 1 ORDER BY sort_order
    """)).fetchall()
    sub_rows = db.execute(text("""
        SELECT sub_genre_id, top_genre_id, sub_genre_name FROM lkup_game_sub_genres
        WHERE is_active = 1 ORDER BY sort_order
    """)).fetchall()
    sub_by_top = {}
    for s in sub_rows:
        sub_by_top.setdefault(s[1], []).append({"sub_genre_id": s[0], "sub_genre_name": s[2]})
    return [
        {"top_genre_id": t[0], "genre_name": t[1], "sub_genres": sub_by_top.get(t[0], [])}
        for t in top_rows
    ]


@router.get("/developers")
def get_game_developers(q: Optional[str] = None, db=Depends(get_db)):
    if q:
        rows = db.execute(
            text("SELECT developer_id, developer_name FROM lkup_game_developers WHERE is_active = 1 AND LOWER(developer_name) LIKE LOWER(:q) ORDER BY developer_name LIMIT 20"),
            {"q": f"%{q}%"},
        ).fetchall()
    else:
        rows = db.execute(text("SELECT developer_id, developer_name FROM lkup_game_developers WHERE is_active = 1 ORDER BY developer_name")).fetchall()
    return [{"developer_id": r[0], "developer_name": r[1]} for r in rows]


@router.get("/publishers")
def get_game_publishers(q: Optional[str] = None, db=Depends(get_db)):
    if q:
        rows = db.execute(
            text("SELECT publisher_id, publisher_name FROM lkup_game_publishers WHERE is_active = 1 AND LOWER(publisher_name) LIKE LOWER(:q) ORDER BY publisher_name LIMIT 20"),
            {"q": f"%{q}%"},
        ).fetchall()
    else:
        rows = db.execute(text("SELECT publisher_id, publisher_name FROM lkup_game_publishers WHERE is_active = 1 ORDER BY publisher_name")).fetchall()
    return [{"publisher_id": r[0], "publisher_name": r[1]} for r in rows]


@router.get("/platforms")
def get_game_platforms(db=Depends(get_db)):
    """Returns all active platforms from lkup_game_platforms."""
    rows = db.execute(text(
        "SELECT platform_id, platform_name FROM lkup_game_platforms WHERE is_active = 1 ORDER BY sort_order"
    )).fetchall()
    return [{"platform_id": r[0], "platform_name": r[1]} for r in rows]


@router.get("/rawg-search")
def rawg_search(q: str):
    """Proxy search to RAWG API. Returns lightweight result list for game picker."""
    if not q or not q.strip():
        return []
    encoded = urllib.parse.quote(q.strip())
    url = f"https://api.rawg.io/api/games?search={encoded}&page_size=10"
    if RAWG_API_KEY:
        url += f"&key={urllib.parse.quote(RAWG_API_KEY)}"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "CollectCore/1.0"})
        with urllib.request.urlopen(req, timeout=8) as resp:
            data = json.loads(resp.read().decode())
        results = []
        for g in data.get("results", []):
            platforms = [p["platform"]["name"] for p in (g.get("platforms") or []) if p.get("platform")]
            results.append({
                "rawg_id": g.get("id"),
                "title": g.get("name"),
                "released": g.get("released"),
                "cover_image_url": g.get("background_image"),
                "platforms": platforms,
            })
        return results
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"RAWG search failed: {str(e)}")


# ---------- CRUD endpoints ----------

@router.get("")
def list_videogames(db=Depends(get_db)):
    rows = db.execute(
        text("""
            SELECT
                i.item_id,
                i.ownership_status_id,
                os.status_name,
                i.reading_status_id,
                rs.status_name,
                i.notes,
                gd.title,
                gd.title_sort,
                gd.release_date,
                gd.cover_image_url,
                (SELECT GROUP_CONCAT(d.developer_name, ', ')
                 FROM xref_game_developers xd
                 JOIN lkup_game_developers d ON xd.developer_id = d.developer_id
                 WHERE xd.item_id = i.item_id
                 ORDER BY d.developer_name) AS developers_str,
                (SELECT GROUP_CONCAT(p.publisher_name, ', ')
                 FROM xref_game_publishers xp
                 JOIN lkup_game_publishers p ON xp.publisher_id = p.publisher_id
                 WHERE xp.item_id = i.item_id
                 ORDER BY p.publisher_name) AS publishers_str,
                (SELECT GROUP_CONCAT(tg.genre_name || COALESCE(' — ' || sg.sub_genre_name, ''), '|||')
                 FROM xref_game_genres xg
                 JOIN lkup_game_top_genres tg ON xg.top_genre_id = tg.top_genre_id
                 LEFT JOIN lkup_game_sub_genres sg ON xg.sub_genre_id = sg.sub_genre_id
                 WHERE xg.item_id = i.item_id
                 ORDER BY tg.sort_order) AS genres_str,
                (SELECT GROUP_CONCAT(COALESCE(p2.platform_name, '?'), '|||')
                 FROM tbl_game_copies gc
                 LEFT JOIN lkup_game_platforms p2 ON gc.platform_id = p2.platform_id
                 WHERE gc.item_id = i.item_id
                 ORDER BY p2.sort_order) AS platforms_str
            FROM tbl_items i
            JOIN tbl_game_details gd ON i.item_id = gd.item_id
            JOIN lkup_ownership_statuses os ON i.ownership_status_id = os.ownership_status_id
            LEFT JOIN lkup_consumption_statuses rs ON i.reading_status_id = rs.read_status_id
            WHERE i.collection_type_id = :ct
            ORDER BY COALESCE(gd.title_sort, gd.title)
        """),
        {"ct": VIDEOGAMES_COLLECTION_TYPE_ID},
    ).fetchall()

    return [
        {
            "item_id": row[0],
            "ownership_status_id": row[1],
            "ownership_status": row[2],
            "play_status_id": row[3],
            "play_status": row[4],
            "notes": row[5],
            "title": row[6],
            "title_sort": row[7],
            "release_date": row[8],
            "cover_image_url": row[9],
            "developers": row[10].split(", ") if row[10] else [],
            "publishers": row[11].split(", ") if row[11] else [],
            "genres": row[12].split("|||") if row[12] else [],
            "platforms": row[13].split("|||") if row[13] else [],
        }
        for row in rows
    ]


@router.get("/{item_id}")
def get_videogame(item_id: int, db=Depends(get_db)):
    game = _get_game_detail(db, item_id)
    if not game:
        raise HTTPException(status_code=404, detail="Video game not found.")
    return game


@router.post("")
def create_videogame(payload: VideoGameCreate, db=Depends(get_db)):
    # Get the single catch-all top-level category for videogames
    cat_row = db.execute(
        text("""
            SELECT ltc.top_level_category_id FROM lkup_top_level_categories ltc
            JOIN lkup_collection_types lct ON ltc.collection_type_id = lct.collection_type_id
            WHERE lct.collection_type_code = 'videogames' LIMIT 1
        """)
    ).fetchone()
    if not cat_row:
        raise HTTPException(status_code=500, detail="Video games collection type not properly seeded.")
    top_level_category_id = cat_row[0]

    item_result = db.execute(
        text("""
            INSERT INTO tbl_items (
                collection_type_id, top_level_category_id, ownership_status_id,
                reading_status_id, notes
            )
            VALUES (:ct, :cat, :own, :rs, :notes)
            RETURNING item_id
        """),
        {
            "ct": VIDEOGAMES_COLLECTION_TYPE_ID,
            "cat": top_level_category_id,
            "own": payload.ownership_status_id,
            "rs": payload.play_status_id,
            "notes": payload.notes,
        },
    ).fetchone()
    item_id = item_result[0]

    db.execute(
        text("""
            INSERT INTO tbl_game_details (
                item_id, title, title_sort, description,
                release_date, cover_image_url,
                api_source, external_work_id
            ) VALUES (
                :item_id, :title, :title_sort, :description,
                :release_date, :cover_image_url,
                :api_source, :external_work_id
            )
        """),
        {
            "item_id": item_id,
            "title": payload.title.strip(),
            "title_sort": make_title_sort(payload.title.strip()),
            "description": payload.description,
            "release_date": payload.release_date,
            "cover_image_url": resolve_cover_url(payload.cover_image_url, "videogames", item_id),
            "api_source": payload.api_source,
            "external_work_id": payload.external_work_id,
        },
    )

    try:
        _insert_game_relationships(db, item_id, payload)
        _insert_game_copies(db, item_id, payload.copies or [])
        db.commit()
    except Exception:
        db.rollback()
        raise

    game = _get_game_detail(db, item_id)
    return {"item_id": item_id, "status": "created", "videogame": game}


@router.put("/{item_id}")
def update_videogame(item_id: int, payload: VideoGameUpdate, db=Depends(get_db)):
    existing = db.execute(
        text("SELECT item_id FROM tbl_items WHERE item_id = :id AND collection_type_id = :ct"),
        {"id": item_id, "ct": VIDEOGAMES_COLLECTION_TYPE_ID},
    ).fetchone()
    if not existing:
        raise HTTPException(status_code=404, detail="Video game not found.")

    db.execute(
        text("""
            UPDATE tbl_items
            SET ownership_status_id = :own,
                reading_status_id = :rs,
                notes = :notes,
                updated_at = CURRENT_TIMESTAMP
            WHERE item_id = :id
        """),
        {
            "id": item_id,
            "own": payload.ownership_status_id,
            "rs": payload.play_status_id,
            "notes": payload.notes,
        },
    )

    db.execute(
        text("""
            UPDATE tbl_game_details
            SET title = :title,
                title_sort = :title_sort,
                description = :description,
                release_date = :release_date,
                cover_image_url = :cover_image_url,
                api_source = :api_source,
                external_work_id = :external_work_id
            WHERE item_id = :id
        """),
        {
            "id": item_id,
            "title": payload.title.strip(),
            "title_sort": make_title_sort(payload.title.strip()),
            "description": payload.description,
            "release_date": payload.release_date,
            "cover_image_url": resolve_cover_url(payload.cover_image_url, "videogames", item_id),
            "api_source": payload.api_source,
            "external_work_id": payload.external_work_id,
        },
    )

    try:
        # Replace all relationships
        db.execute(text("DELETE FROM xref_game_developers WHERE item_id = :id"), {"id": item_id})
        db.execute(text("DELETE FROM xref_game_publishers WHERE item_id = :id"), {"id": item_id})
        db.execute(text("DELETE FROM xref_game_genres WHERE item_id = :id"), {"id": item_id})
        db.execute(text("DELETE FROM tbl_game_copies WHERE item_id = :id"), {"id": item_id})
        _insert_game_relationships(db, item_id, payload)
        _insert_game_copies(db, item_id, payload.copies or [])
        db.commit()
    except Exception:
        db.rollback()
        raise

    game = _get_game_detail(db, item_id)
    return {"item_id": item_id, "status": "updated", "videogame": game}


@router.delete("/{item_id}")
def delete_videogame(item_id: int, db=Depends(get_db)):
    existing = db.execute(
        text("SELECT item_id FROM tbl_items WHERE item_id = :id AND collection_type_id = :ct"),
        {"id": item_id, "ct": VIDEOGAMES_COLLECTION_TYPE_ID},
    ).fetchone()
    if not existing:
        raise HTTPException(status_code=404, detail="Video game not found.")

    files_to_delete = delete_attachment_files(db, item_id)
    files_to_delete.extend(collect_cover_file(db, "tbl_game_details", item_id))
    db.execute(text("DELETE FROM xref_game_developers WHERE item_id = :id"), {"id": item_id})
    db.execute(text("DELETE FROM xref_game_publishers WHERE item_id = :id"), {"id": item_id})
    db.execute(text("DELETE FROM xref_game_genres WHERE item_id = :id"), {"id": item_id})
    db.execute(text("DELETE FROM tbl_attachments WHERE item_id = :id"), {"id": item_id})
    db.execute(text("DELETE FROM tbl_game_details WHERE item_id = :id"), {"id": item_id})
    db.execute(text("DELETE FROM tbl_items WHERE item_id = :id"), {"id": item_id})

    db.commit()
    remove_files(files_to_delete)
    return {"deleted": item_id}


# ---------- Bulk endpoints ----------

@router.patch("/bulk")
def bulk_update_videogames(payload: GameBulkUpdatePayload, db=Depends(get_db)):
    for item_id in payload.item_ids:
        existing = db.execute(
            text("SELECT item_id FROM tbl_items WHERE item_id = :id AND collection_type_id = :ct"),
            {"id": item_id, "ct": VIDEOGAMES_COLLECTION_TYPE_ID},
        ).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail=f"Item {item_id} not found.")

        updates = []
        params = {"id": item_id}
        if payload.fields.ownership_status_id is not None:
            updates.append("ownership_status_id = :own")
            params["own"] = payload.fields.ownership_status_id
        if payload.fields.play_status_id is not None:
            updates.append("reading_status_id = :rs")
            params["rs"] = payload.fields.play_status_id

        if updates:
            updates.append("updated_at = CURRENT_TIMESTAMP")
            db.execute(
                text(f"UPDATE tbl_items SET {', '.join(updates)} WHERE item_id = :id"),
                params,
            )

    db.commit()
    return {"updated": payload.item_ids, "count": len(payload.item_ids)}


@router.post("/bulk-delete")
def bulk_delete_videogames(payload: BulkDeletePayload, db=Depends(get_db)):
    for item_id in payload.item_ids:
        existing = db.execute(
            text("SELECT item_id FROM tbl_items WHERE item_id = :id AND collection_type_id = :ct"),
            {"id": item_id, "ct": VIDEOGAMES_COLLECTION_TYPE_ID},
        ).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail=f"Item {item_id} not found.")

    all_files = []
    for item_id in payload.item_ids:
        all_files.extend(delete_attachment_files(db, item_id))
        all_files.extend(collect_cover_file(db, "tbl_game_details", item_id))
        db.execute(text("DELETE FROM xref_game_developers WHERE item_id = :id"), {"id": item_id})
        db.execute(text("DELETE FROM xref_game_publishers WHERE item_id = :id"), {"id": item_id})
        db.execute(text("DELETE FROM xref_game_genres WHERE item_id = :id"), {"id": item_id})
        db.execute(text("DELETE FROM tbl_attachments WHERE item_id = :id"), {"id": item_id})
        db.execute(text("DELETE FROM tbl_game_details WHERE item_id = :id"), {"id": item_id})
        db.execute(text("DELETE FROM tbl_items WHERE item_id = :id"), {"id": item_id})

    db.commit()
    remove_files(all_files)
    return {"deleted": payload.item_ids, "count": len(payload.item_ids)}
