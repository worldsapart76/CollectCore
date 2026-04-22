import json
import os
import urllib.parse
import urllib.request
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text

from constants import VIDEO_COLLECTION_TYPE_ID
from dependencies import get_db
from file_helpers import delete_attachment_files, collect_cover_file, remove_files, resolve_cover_url
from helpers import generic_upsert, make_title_sort_suffixed
from schemas.photocards import BulkDeletePayload

router = APIRouter(prefix="/video", tags=["video"])
from schemas.video import (
    VideoBulkUpdatePayload,
    VideoCopyEntry,
    VideoCreate,
    VideoSeasonEntry,
    VideoUpdate,
)

# ---------- API keys ----------
TMDB_API_KEY = os.environ.get("TMDB_API_KEY", "")

# Category names that use seasons sub-table (vs copies)
_VIDEO_SEASONS_CATEGORIES = {"TV Series"}


# ---------- Video helpers ----------

def _insert_video_relationships(db, item_id: int, payload):
    # Directors
    for order, name in enumerate(payload.director_names or []):
        name = name.strip()
        if not name:
            continue
        dir_id = generic_upsert(db, "video_director", name)
        db.execute(
            text("INSERT OR IGNORE INTO xref_video_directors (item_id, director_id, director_order) VALUES (:iid, :did, :ord)"),
            {"iid": item_id, "did": dir_id, "ord": order},
        )

    # Cast
    for order, name in enumerate(payload.cast_names or []):
        name = name.strip()
        if not name:
            continue
        cast_id = generic_upsert(db, "video_cast", name)
        db.execute(
            text("INSERT OR IGNORE INTO xref_video_cast (item_id, cast_id, cast_order) VALUES (:iid, :cid, :ord)"),
            {"iid": item_id, "cid": cast_id, "ord": order},
        )

    # Genres
    for g in (payload.genres or []):
        top_id = g.get("top_genre_id")
        sub_id = g.get("sub_genre_id")
        if not top_id:
            continue
        db.execute(
            text("INSERT OR IGNORE INTO xref_video_genres (item_id, top_genre_id, sub_genre_id) VALUES (:iid, :tg, :sg)"),
            {"iid": item_id, "tg": top_id, "sg": sub_id},
        )


def _insert_video_copies(db, item_id: int, copies: list):
    for c in copies:
        db.execute(
            text("""
                INSERT INTO tbl_video_copies (item_id, format_type_id, ownership_status_id, notes)
                VALUES (:iid, :fmt, :own, :notes)
            """),
            {
                "iid": item_id,
                "fmt": c.format_type_id,
                "own": c.ownership_status_id,
                "notes": c.notes or None,
            },
        )


def _insert_video_seasons(db, item_id: int, seasons: list):
    for s in seasons:
        db.execute(
            text("""
                INSERT INTO tbl_video_seasons
                    (item_id, season_number, episode_count, format_type_id, ownership_status_id, notes)
                VALUES (:iid, :num, :eps, :fmt, :own, :notes)
            """),
            {
                "iid": item_id,
                "num": s.season_number,
                "eps": s.episode_count,
                "fmt": s.format_type_id,
                "own": s.ownership_status_id,
                "notes": s.notes or None,
            },
        )


def _get_video_detail(db, item_id: int):
    row = db.execute(
        text("""
            SELECT
                i.item_id,
                i.ownership_status_id,
                os.status_name AS ownership_status,
                i.top_level_category_id,
                tlc.category_name AS video_type,
                i.reading_status_id,
                rs.status_name AS watch_status,
                i.notes,
                i.created_at,
                i.updated_at,
                vd.title,
                vd.title_sort,
                vd.description,
                vd.release_date,
                vd.runtime_minutes,
                vd.cover_image_url,
                vd.api_source,
                vd.external_work_id
            FROM tbl_items i
            JOIN tbl_video_details vd ON i.item_id = vd.item_id
            JOIN lkup_ownership_statuses os ON i.ownership_status_id = os.ownership_status_id
            JOIN lkup_top_level_categories tlc ON i.top_level_category_id = tlc.top_level_category_id
            LEFT JOIN lkup_consumption_statuses rs ON i.reading_status_id = rs.read_status_id
            WHERE i.item_id = :item_id AND i.collection_type_id = :ct
        """),
        {"item_id": item_id, "ct": VIDEO_COLLECTION_TYPE_ID},
    ).fetchone()

    if not row:
        return None

    directors = db.execute(
        text("""
            SELECT d.director_id, d.director_name
            FROM xref_video_directors xd
            JOIN lkup_video_directors d ON xd.director_id = d.director_id
            WHERE xd.item_id = :item_id
            ORDER BY xd.director_order
        """),
        {"item_id": item_id},
    ).fetchall()

    cast = db.execute(
        text("""
            SELECT c.cast_id, c.cast_name
            FROM xref_video_cast xc
            JOIN lkup_video_cast c ON xc.cast_id = c.cast_id
            WHERE xc.item_id = :item_id
            ORDER BY xc.cast_order
        """),
        {"item_id": item_id},
    ).fetchall()

    genres = db.execute(
        text("""
            SELECT xg.xref_id, xg.top_genre_id, tg.genre_name, xg.sub_genre_id, sg.sub_genre_name
            FROM xref_video_genres xg
            JOIN lkup_video_top_genres tg ON xg.top_genre_id = tg.top_genre_id
            LEFT JOIN lkup_video_sub_genres sg ON xg.sub_genre_id = sg.sub_genre_id
            WHERE xg.item_id = :item_id
        """),
        {"item_id": item_id},
    ).fetchall()

    copies = db.execute(
        text("""
            SELECT c.copy_id, c.format_type_id, ft.format_name, c.ownership_status_id,
                   os.status_name AS ownership_status, c.notes
            FROM tbl_video_copies c
            LEFT JOIN lkup_video_format_types ft ON c.format_type_id = ft.format_type_id
            LEFT JOIN lkup_ownership_statuses os ON c.ownership_status_id = os.ownership_status_id
            WHERE c.item_id = :item_id
            ORDER BY c.copy_id
        """),
        {"item_id": item_id},
    ).fetchall()

    seasons = db.execute(
        text("""
            SELECT s.season_id, s.season_number, s.episode_count, s.format_type_id,
                   ft.format_name, s.ownership_status_id, os.status_name AS ownership_status, s.notes
            FROM tbl_video_seasons s
            LEFT JOIN lkup_video_format_types ft ON s.format_type_id = ft.format_type_id
            LEFT JOIN lkup_ownership_statuses os ON s.ownership_status_id = os.ownership_status_id
            WHERE s.item_id = :item_id
            ORDER BY s.season_number
        """),
        {"item_id": item_id},
    ).fetchall()

    return {
        "item_id": row[0],
        "ownership_status_id": row[1],
        "ownership_status": row[2],
        "top_level_category_id": row[3],
        "video_type": row[4],
        "reading_status_id": row[5],
        "watch_status": row[6],
        "notes": row[7],
        "created_at": row[8],
        "updated_at": row[9],
        "title": row[10],
        "title_sort": row[11],
        "description": row[12],
        "release_date": row[13],
        "runtime_minutes": row[14],
        "cover_image_url": row[15],
        "api_source": row[16],
        "external_work_id": row[17],
        "director_names": [d[1] for d in directors],
        "cast_names": [c[1] for c in cast],
        "genres": [
            {
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
                "format_type_id": c[1],
                "format_name": c[2],
                "ownership_status_id": c[3],
                "ownership_status": c[4],
                "notes": c[5],
            }
            for c in copies
        ],
        "seasons": [
            {
                "season_id": s[0],
                "season_number": s[1],
                "episode_count": s[2],
                "format_type_id": s[3],
                "format_name": s[4],
                "ownership_status_id": s[5],
                "ownership_status": s[6],
                "notes": s[7],
            }
            for s in seasons
        ],
    }


# --- Video lookup endpoints ---

@router.get("/categories")
def get_video_categories(db=Depends(get_db)):
    rows = db.execute(
        text("""
            SELECT tlc.top_level_category_id, tlc.category_name
            FROM lkup_top_level_categories tlc
            JOIN lkup_collection_types lct ON tlc.collection_type_id = lct.collection_type_id
            WHERE lct.collection_type_code = 'video'
            ORDER BY tlc.sort_order
        """)
    ).fetchall()
    return [{"top_level_category_id": r[0], "category_name": r[1]} for r in rows]


@router.get("/format-types")
def get_video_format_types(db=Depends(get_db)):
    rows = db.execute(
        text("SELECT format_type_id, format_name FROM lkup_video_format_types WHERE is_active=1 ORDER BY sort_order")
    ).fetchall()
    return [{"format_type_id": r[0], "format_name": r[1]} for r in rows]


@router.get("/genres")
def get_video_genres(db=Depends(get_db)):
    top = db.execute(
        text("SELECT top_genre_id, genre_name FROM lkup_video_top_genres WHERE is_active=1 ORDER BY sort_order")
    ).fetchall()
    sub = db.execute(
        text("SELECT sub_genre_id, top_genre_id, sub_genre_name FROM lkup_video_sub_genres WHERE is_active=1 ORDER BY sort_order")
    ).fetchall()
    sub_map = {}
    for s in sub:
        sub_map.setdefault(s[1], []).append({"sub_genre_id": s[0], "sub_genre_name": s[2]})
    return [
        {"top_genre_id": t[0], "genre_name": t[1], "sub_genres": sub_map.get(t[0], [])}
        for t in top
    ]


@router.get("/directors")
def search_video_directors(q: Optional[str] = None, db=Depends(get_db)):
    if q:
        rows = db.execute(
            text("SELECT director_id, director_name FROM lkup_video_directors WHERE director_name LIKE :q ORDER BY director_name LIMIT 20"),
            {"q": f"%{q}%"},
        ).fetchall()
    else:
        rows = db.execute(
            text("SELECT director_id, director_name FROM lkup_video_directors ORDER BY director_name LIMIT 100")
        ).fetchall()
    return [{"director_id": r[0], "director_name": r[1]} for r in rows]


@router.get("/cast")
def search_video_cast(q: Optional[str] = None, db=Depends(get_db)):
    if q:
        rows = db.execute(
            text("SELECT cast_id, cast_name FROM lkup_video_cast WHERE cast_name LIKE :q ORDER BY cast_name LIMIT 20"),
            {"q": f"%{q}%"},
        ).fetchall()
    else:
        rows = db.execute(
            text("SELECT cast_id, cast_name FROM lkup_video_cast ORDER BY cast_name LIMIT 100")
        ).fetchall()
    return [{"cast_id": r[0], "cast_name": r[1]} for r in rows]




@router.get("/tmdb-search")
def tmdb_search(q: str, media_type: str = "movie"):
    """Proxy TMDB search. media_type = 'movie' or 'tv'."""
    if not q or not q.strip():
        return []
    if not TMDB_API_KEY:
        raise HTTPException(status_code=503, detail="TMDB_API_KEY not configured.")
    if media_type not in ("movie", "tv"):
        media_type = "movie"
    encoded = urllib.parse.quote(q.strip())
    url = f"https://api.themoviedb.org/3/search/{media_type}?api_key={urllib.parse.quote(TMDB_API_KEY)}&query={encoded}&page=1"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "CollectCore/1.0"})
        with urllib.request.urlopen(req, timeout=8) as resp:
            data = json.loads(resp.read().decode())
        results = []
        img_base = "https://image.tmdb.org/t/p/w300"
        for item in data.get("results", [])[:10]:
            poster = item.get("poster_path")
            title = item.get("title") or item.get("name") or ""
            year = ""
            date_str = item.get("release_date") or item.get("first_air_date") or ""
            if date_str:
                year = date_str[:4]
            results.append({
                "tmdb_id": item.get("id"),
                "title": title,
                "year": year,
                "overview": (item.get("overview") or "")[:300],
                "cover_image_url": img_base + poster if poster else None,
                "media_type": media_type,
            })
        return results
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"TMDB search failed: {str(e)}")


@router.get("/tmdb-detail/{tmdb_id}")
def tmdb_detail(tmdb_id: int, media_type: str = "movie"):
    """Fetch full TMDB detail with credits. media_type = 'movie' or 'tv'."""
    if not TMDB_API_KEY:
        raise HTTPException(status_code=503, detail="TMDB_API_KEY not configured.")
    if media_type not in ("movie", "tv"):
        media_type = "movie"
    url = f"https://api.themoviedb.org/3/{media_type}/{tmdb_id}?api_key={urllib.parse.quote(TMDB_API_KEY)}&append_to_response=credits"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "CollectCore/1.0"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            d = json.loads(resp.read().decode())

        img_base = "https://image.tmdb.org/t/p/w500"
        poster = d.get("poster_path")
        credits = d.get("credits") or {}
        crew = credits.get("crew") or []
        cast_list = credits.get("cast") or []

        if media_type == "movie":
            directors = [c["name"] for c in crew if c.get("job") == "Director"]
            title = d.get("title", "")
            release_date = d.get("release_date", "")
            runtime = d.get("runtime")
            seasons = []
        else:
            # TV: creator(s) as directors
            directors = [c["name"] for c in (d.get("created_by") or [])]
            title = d.get("name", "")
            release_date = d.get("first_air_date", "")
            runtime = None
            # Return season stubs so frontend can pre-fill seasons editor
            seasons = [
                {
                    "season_number": s["season_number"],
                    "episode_count": s.get("episode_count"),
                    "name": s.get("name", ""),
                }
                for s in (d.get("seasons") or [])
                if s.get("season_number", 0) > 0  # skip specials (season 0)
            ]

        top_cast = [c["name"] for c in cast_list[:10]]

        return {
            "tmdb_id": d.get("id"),
            "title": title,
            "release_date": release_date,
            "runtime_minutes": runtime,
            "overview": d.get("overview", ""),
            "cover_image_url": img_base + poster if poster else None,
            "media_type": media_type,
            "directors": directors,
            "cast": top_cast,
            "seasons": seasons,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"TMDB detail fetch failed: {str(e)}")


@router.get("")
def list_video(
    search: Optional[str] = None,
    video_type_id: Optional[int] = None,
    ownership_status_id: Optional[int] = None,
    reading_status_id: Optional[int] = None,
    db=Depends(get_db),
):
    where = ["i.collection_type_id = :ct"]
    params: dict = {"ct": VIDEO_COLLECTION_TYPE_ID}

    if search:
        where.append("vd.title LIKE :search")
        params["search"] = f"%{search}%"
    if video_type_id is not None:
        where.append("i.top_level_category_id = :vt")
        params["vt"] = video_type_id
    if ownership_status_id is not None:
        where.append("i.ownership_status_id = :own")
        params["own"] = ownership_status_id
    if reading_status_id is not None:
        where.append("i.reading_status_id = :rs")
        params["rs"] = reading_status_id

    where_clause = " AND ".join(where)

    rows = db.execute(
        text(f"""
            SELECT
                i.item_id,
                i.ownership_status_id,
                os.status_name AS ownership_status,
                i.top_level_category_id,
                tlc.category_name AS video_type,
                i.reading_status_id,
                rs.status_name AS watch_status,
                i.notes,
                vd.title,
                vd.title_sort,
                vd.release_date,
                vd.runtime_minutes,
                vd.cover_image_url,
                (
                    SELECT GROUP_CONCAT(d.director_name, ', ')
                    FROM xref_video_directors xd
                    JOIN lkup_video_directors d ON xd.director_id = d.director_id
                    WHERE xd.item_id = i.item_id
                    ORDER BY xd.director_order
                ) AS directors,
                (
                    SELECT GROUP_CONCAT(tg.genre_name, ', ')
                    FROM xref_video_genres xg
                    JOIN lkup_video_top_genres tg ON xg.top_genre_id = tg.top_genre_id
                    WHERE xg.item_id = i.item_id
                ) AS genres,
                (
                    SELECT GROUP_CONCAT(ft.format_name, ', ')
                    FROM tbl_video_copies c
                    LEFT JOIN lkup_video_format_types ft ON c.format_type_id = ft.format_type_id
                    WHERE c.item_id = i.item_id
                ) AS copy_formats,
                (SELECT COUNT(*) FROM tbl_video_seasons s WHERE s.item_id = i.item_id) AS season_count,
                (SELECT COUNT(*) FROM tbl_video_copies c WHERE c.item_id = i.item_id) AS copy_count
            FROM tbl_items i
            JOIN tbl_video_details vd ON i.item_id = vd.item_id
            JOIN lkup_ownership_statuses os ON i.ownership_status_id = os.ownership_status_id
            JOIN lkup_top_level_categories tlc ON i.top_level_category_id = tlc.top_level_category_id
            LEFT JOIN lkup_consumption_statuses rs ON i.reading_status_id = rs.read_status_id
            WHERE {where_clause}
            ORDER BY vd.title_sort, vd.title
        """),
        params,
    ).fetchall()

    return [
        {
            "item_id": r[0],
            "ownership_status_id": r[1],
            "ownership_status": r[2],
            "top_level_category_id": r[3],
            "video_type": r[4],
            "reading_status_id": r[5],
            "watch_status": r[6],
            "notes": r[7],
            "title": r[8],
            "title_sort": r[9],
            "release_date": r[10],
            "runtime_minutes": r[11],
            "cover_image_url": r[12],
            "directors": r[13].split(", ") if r[13] else [],
            "genres": r[14].split(", ") if r[14] else [],
            "copy_formats": list(dict.fromkeys(r[15].split(", "))) if r[15] else [],
            "season_count": r[16],
            "copy_count": r[17],
        }
        for r in rows
    ]


@router.get("/{item_id}")
def get_video(item_id: int, db=Depends(get_db)):
    detail = _get_video_detail(db, item_id)
    if not detail:
        raise HTTPException(status_code=404, detail="Video not found.")
    return detail


@router.post("")
def create_video(payload: VideoCreate, db=Depends(get_db)):
    try:
        title_sort = make_title_sort_suffixed(payload.title)

        item_result = db.execute(
            text("""
                INSERT INTO tbl_items
                    (collection_type_id, top_level_category_id, ownership_status_id, reading_status_id, notes)
                VALUES (:ct, :tlc, :own, :rs, :notes)
            """),
            {
                "ct": VIDEO_COLLECTION_TYPE_ID,
                "tlc": payload.top_level_category_id,
                "own": payload.ownership_status_id,
                "rs": payload.reading_status_id,
                "notes": payload.notes,
            },
        )
        item_id = item_result.lastrowid

        db.execute(
            text("""
                INSERT INTO tbl_video_details
                    (item_id, title, title_sort, description, release_date, runtime_minutes,
                     cover_image_url, api_source, external_work_id)
                VALUES (:iid, :title, :sort, :desc, :date, :runtime, :cover, :api_src, :ext_id)
            """),
            {
                "iid": item_id,
                "title": payload.title,
                "sort": title_sort,
                "desc": payload.description,
                "date": payload.release_date,
                "runtime": payload.runtime_minutes,
                "cover": resolve_cover_url(payload.cover_image_url, "video", item_id),
                "api_src": payload.api_source,
                "ext_id": payload.external_work_id,
            },
        )

        _insert_video_relationships(db, item_id, payload)
        _insert_video_copies(db, item_id, payload.copies)
        _insert_video_seasons(db, item_id, payload.seasons)

        db.commit()
        detail = _get_video_detail(db, item_id)
        return {"item_id": item_id, "status": "created", "video": detail}
    except Exception:
        db.rollback()
        raise


@router.put("/{item_id}")
def update_video(item_id: int, payload: VideoUpdate, db=Depends(get_db)):
    try:
        existing = db.execute(
            text("SELECT item_id FROM tbl_items WHERE item_id = :id AND collection_type_id = :ct"),
            {"id": item_id, "ct": VIDEO_COLLECTION_TYPE_ID},
        ).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Video not found.")

        item_updates = []
        item_params: dict = {"id": item_id}
        if payload.top_level_category_id is not None:
            item_updates.append("top_level_category_id = :tlc")
            item_params["tlc"] = payload.top_level_category_id
        if payload.ownership_status_id is not None:
            item_updates.append("ownership_status_id = :own")
            item_params["own"] = payload.ownership_status_id
        if payload.reading_status_id is not None:
            item_updates.append("reading_status_id = :rs")
            item_params["rs"] = payload.reading_status_id
        if payload.notes is not None:
            item_updates.append("notes = :notes")
            item_params["notes"] = payload.notes
        if item_updates:
            item_updates.append("updated_at = CURRENT_TIMESTAMP")
            db.execute(
                text(f"UPDATE tbl_items SET {', '.join(item_updates)} WHERE item_id = :id"),
                item_params,
            )

        detail_updates = []
        detail_params: dict = {"id": item_id}
        if payload.title is not None:
            detail_updates.append("title = :title")
            detail_updates.append("title_sort = :sort")
            detail_params["title"] = payload.title
            detail_params["sort"] = make_title_sort_suffixed(payload.title)
        if payload.description is not None:
            detail_updates.append("description = :desc")
            detail_params["desc"] = payload.description
        if payload.release_date is not None:
            detail_updates.append("release_date = :date")
            detail_params["date"] = payload.release_date
        if payload.runtime_minutes is not None:
            detail_updates.append("runtime_minutes = :runtime")
            detail_params["runtime"] = payload.runtime_minutes
        if payload.cover_image_url is not None:
            detail_updates.append("cover_image_url = :cover")
            detail_params["cover"] = resolve_cover_url(payload.cover_image_url, "video", item_id)
        if payload.api_source is not None:
            detail_updates.append("api_source = :api_src")
            detail_params["api_src"] = payload.api_source
        if payload.external_work_id is not None:
            detail_updates.append("external_work_id = :ext_id")
            detail_params["ext_id"] = payload.external_work_id
        if detail_updates:
            db.execute(
                text(f"UPDATE tbl_video_details SET {', '.join(detail_updates)} WHERE item_id = :id"),
                detail_params,
            )

        if payload.director_names is not None:
            db.execute(text("DELETE FROM xref_video_directors WHERE item_id = :id"), {"id": item_id})
            for order, name in enumerate(payload.director_names):
                name = name.strip()
                if not name:
                    continue
                dir_id = generic_upsert(db, "video_director", name)
                db.execute(
                    text("INSERT OR IGNORE INTO xref_video_directors (item_id, director_id, director_order) VALUES (:iid, :did, :ord)"),
                    {"iid": item_id, "did": dir_id, "ord": order},
                )

        if payload.cast_names is not None:
            db.execute(text("DELETE FROM xref_video_cast WHERE item_id = :id"), {"id": item_id})
            for order, name in enumerate(payload.cast_names):
                name = name.strip()
                if not name:
                    continue
                cast_id = generic_upsert(db, "video_cast", name)
                db.execute(
                    text("INSERT OR IGNORE INTO xref_video_cast (item_id, cast_id, cast_order) VALUES (:iid, :cid, :ord)"),
                    {"iid": item_id, "cid": cast_id, "ord": order},
                )

        if payload.genres is not None:
            db.execute(text("DELETE FROM xref_video_genres WHERE item_id = :id"), {"id": item_id})
            for g in payload.genres:
                top_id = g.get("top_genre_id")
                sub_id = g.get("sub_genre_id")
                if not top_id:
                    continue
                db.execute(
                    text("INSERT OR IGNORE INTO xref_video_genres (item_id, top_genre_id, sub_genre_id) VALUES (:iid, :tg, :sg)"),
                    {"iid": item_id, "tg": top_id, "sg": sub_id},
                )

        if payload.copies is not None:
            db.execute(text("DELETE FROM tbl_video_copies WHERE item_id = :id"), {"id": item_id})
            _insert_video_copies(db, item_id, payload.copies)

        if payload.seasons is not None:
            db.execute(text("DELETE FROM tbl_video_seasons WHERE item_id = :id"), {"id": item_id})
            _insert_video_seasons(db, item_id, payload.seasons)

        db.commit()
        detail = _get_video_detail(db, item_id)
        return {"item_id": item_id, "status": "updated", "video": detail}
    except HTTPException:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise


@router.delete("/{item_id}")
def delete_video(item_id: int, db=Depends(get_db)):
    try:
        existing = db.execute(
            text("SELECT item_id FROM tbl_items WHERE item_id = :id AND collection_type_id = :ct"),
            {"id": item_id, "ct": VIDEO_COLLECTION_TYPE_ID},
        ).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Video not found.")

        files_to_delete = delete_attachment_files(db, item_id)
        files_to_delete.extend(collect_cover_file(db, "tbl_video_details", item_id))
        db.execute(text("DELETE FROM xref_video_directors WHERE item_id = :id"), {"id": item_id})
        db.execute(text("DELETE FROM xref_video_cast WHERE item_id = :id"), {"id": item_id})
        db.execute(text("DELETE FROM xref_video_genres WHERE item_id = :id"), {"id": item_id})
        db.execute(text("DELETE FROM tbl_video_copies WHERE item_id = :id"), {"id": item_id})
        db.execute(text("DELETE FROM tbl_video_seasons WHERE item_id = :id"), {"id": item_id})
        db.execute(text("DELETE FROM tbl_attachments WHERE item_id = :id"), {"id": item_id})
        db.execute(text("DELETE FROM tbl_video_details WHERE item_id = :id"), {"id": item_id})
        db.execute(text("DELETE FROM tbl_items WHERE item_id = :id"), {"id": item_id})

        db.commit()
        remove_files(files_to_delete)
        return {"deleted": item_id}
    except HTTPException:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise


@router.patch("/bulk")
def bulk_update_video(payload: VideoBulkUpdatePayload, db=Depends(get_db)):
    try:
        for item_id in payload.item_ids:
            existing = db.execute(
                text("SELECT item_id FROM tbl_items WHERE item_id = :id AND collection_type_id = :ct"),
                {"id": item_id, "ct": VIDEO_COLLECTION_TYPE_ID},
            ).fetchone()
            if not existing:
                raise HTTPException(status_code=404, detail=f"Item {item_id} not found.")

            updates = []
            params = {"id": item_id}
            if payload.fields.ownership_status_id is not None:
                updates.append("ownership_status_id = :own")
                params["own"] = payload.fields.ownership_status_id
            if payload.fields.reading_status_id is not None:
                updates.append("reading_status_id = :rs")
                params["rs"] = payload.fields.reading_status_id
            if payload.fields.top_level_category_id is not None:
                updates.append("top_level_category_id = :tlc")
                params["tlc"] = payload.fields.top_level_category_id

            if updates:
                updates.append("updated_at = CURRENT_TIMESTAMP")
                db.execute(
                    text(f"UPDATE tbl_items SET {', '.join(updates)} WHERE item_id = :id"),
                    params,
                )

        db.commit()
        return {"updated": payload.item_ids, "count": len(payload.item_ids)}
    except HTTPException:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise


@router.post("/bulk-delete")
def bulk_delete_video(payload: BulkDeletePayload, db=Depends(get_db)):
    try:
        for item_id in payload.item_ids:
            existing = db.execute(
                text("SELECT item_id FROM tbl_items WHERE item_id = :id AND collection_type_id = :ct"),
                {"id": item_id, "ct": VIDEO_COLLECTION_TYPE_ID},
            ).fetchone()
            if not existing:
                raise HTTPException(status_code=404, detail=f"Item {item_id} not found.")

        all_files = []
        for item_id in payload.item_ids:
            all_files.extend(delete_attachment_files(db, item_id))
            all_files.extend(collect_cover_file(db, "tbl_video_details", item_id))
            db.execute(text("DELETE FROM xref_video_directors WHERE item_id = :id"), {"id": item_id})
            db.execute(text("DELETE FROM xref_video_cast WHERE item_id = :id"), {"id": item_id})
            db.execute(text("DELETE FROM xref_video_genres WHERE item_id = :id"), {"id": item_id})
            db.execute(text("DELETE FROM tbl_video_copies WHERE item_id = :id"), {"id": item_id})
            db.execute(text("DELETE FROM tbl_video_seasons WHERE item_id = :id"), {"id": item_id})
            db.execute(text("DELETE FROM tbl_attachments WHERE item_id = :id"), {"id": item_id})
            db.execute(text("DELETE FROM tbl_video_details WHERE item_id = :id"), {"id": item_id})
            db.execute(text("DELETE FROM tbl_items WHERE item_id = :id"), {"id": item_id})

        db.commit()
        remove_files(all_files)
        return {"deleted": payload.item_ids, "count": len(payload.item_ids)}
    except HTTPException:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise
