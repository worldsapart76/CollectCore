import json
import os
import re
import urllib.parse
import urllib.request
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text

from constants import MUSIC_COLLECTION_TYPE_ID
from dependencies import get_db
from file_helpers import delete_attachment_files, collect_cover_file, remove_files, resolve_cover_url
from helpers import make_title_sort_suffixed
from schemas.music import (
    MusicBulkUpdatePayload,
    MusicReleaseCreate,
    MusicReleaseUpdate,
)
from schemas.photocards import BulkDeletePayload

router = APIRouter(prefix="/music", tags=["music"])

# ---------- API keys ----------
DISCOGS_CONSUMER_KEY = os.environ.get("DISCOGS_CONSUMER_KEY", "")
DISCOGS_CONSUMER_SECRET = os.environ.get("DISCOGS_CONSUMER_SECRET", "")


# ---------- Music helpers ----------

def _upsert_music_artist(db, name: str) -> int:
    name = name.strip()
    row = db.execute(
        text("SELECT artist_id FROM lkup_music_artists WHERE artist_name = :name"),
        {"name": name},
    ).fetchone()
    if row:
        return row[0]
    result = db.execute(
        text("INSERT INTO lkup_music_artists (artist_name, artist_sort) VALUES (:name, :sort)"),
        {"name": name, "sort": make_title_sort_suffixed(name)},
    )
    return result.lastrowid


def _insert_music_relationships(db, item_id: int, payload):
    # Artists
    for order, name in enumerate(payload.artist_names or []):
        name = name.strip()
        if not name:
            continue
        artist_id = _upsert_music_artist(db, name)
        db.execute(
            text("INSERT OR IGNORE INTO xref_music_release_artists (item_id, artist_id, artist_order) VALUES (:iid, :aid, :ord)"),
            {"iid": item_id, "aid": artist_id, "ord": order},
        )

    # Genres
    for g in (payload.genres or []):
        top_id = g.get("top_genre_id")
        sub_id = g.get("sub_genre_id")
        if not top_id:
            continue
        db.execute(
            text("INSERT OR IGNORE INTO xref_music_release_genres (item_id, top_genre_id, sub_genre_id) VALUES (:iid, :tg, :sg)"),
            {"iid": item_id, "tg": top_id, "sg": sub_id},
        )


def _insert_music_songs(db, item_id: int, songs: list):
    for s in songs:
        db.execute(
            text("""
                INSERT INTO tbl_music_songs (item_id, title, duration_seconds, track_number, disc_number)
                VALUES (:iid, :title, :dur, :track, :disc)
            """),
            {
                "iid": item_id,
                "title": s.title.strip(),
                "dur": s.duration_seconds,
                "track": s.track_number,
                "disc": s.disc_number,
            },
        )


def _insert_music_editions(db, item_id: int, editions: list):
    for e in editions:
        db.execute(
            text("""
                INSERT INTO tbl_music_editions
                    (item_id, format_type_id, version_name, label, catalog_number, barcode, notes, ownership_status_id)
                VALUES (:iid, :fmt, :ver, :lbl, :cat, :bar, :notes, :own)
            """),
            {
                "iid": item_id,
                "fmt": e.format_type_id,
                "ver": e.version_name or None,
                "lbl": e.label or None,
                "cat": e.catalog_number or None,
                "bar": e.barcode or None,
                "notes": e.notes or None,
                "own": e.ownership_status_id,
            },
        )


def _get_music_detail(db, item_id: int):
    row = db.execute(
        text("""
            SELECT
                i.item_id,
                i.ownership_status_id,
                os.status_name AS ownership_status,
                i.top_level_category_id,
                tlc.category_name AS release_type,
                i.notes,
                i.created_at,
                i.updated_at,
                rd.title,
                rd.title_sort,
                rd.description,
                rd.release_date,
                rd.cover_image_url,
                rd.api_source,
                rd.external_work_id
            FROM tbl_items i
            JOIN tbl_music_release_details rd ON i.item_id = rd.item_id
            JOIN lkup_ownership_statuses os ON i.ownership_status_id = os.ownership_status_id
            JOIN lkup_top_level_categories tlc ON i.top_level_category_id = tlc.top_level_category_id
            WHERE i.item_id = :item_id AND i.collection_type_id = :ct
        """),
        {"item_id": item_id, "ct": MUSIC_COLLECTION_TYPE_ID},
    ).fetchone()

    if not row:
        return None

    artists = db.execute(
        text("""
            SELECT a.artist_id, a.artist_name
            FROM xref_music_release_artists xa
            JOIN lkup_music_artists a ON xa.artist_id = a.artist_id
            WHERE xa.item_id = :item_id
            ORDER BY xa.artist_order
        """),
        {"item_id": item_id},
    ).fetchall()

    genres = db.execute(
        text("""
            SELECT xg.xref_id, xg.top_genre_id, tg.genre_name, xg.sub_genre_id, sg.sub_genre_name
            FROM xref_music_release_genres xg
            JOIN lkup_music_top_genres tg ON xg.top_genre_id = tg.top_genre_id
            LEFT JOIN lkup_music_sub_genres sg ON xg.sub_genre_id = sg.sub_genre_id
            WHERE xg.item_id = :item_id
        """),
        {"item_id": item_id},
    ).fetchall()

    songs = db.execute(
        text("""
            SELECT song_id, title, duration_seconds, track_number, disc_number
            FROM tbl_music_songs
            WHERE item_id = :item_id
            ORDER BY disc_number, track_number NULLS LAST, song_id
        """),
        {"item_id": item_id},
    ).fetchall()

    editions = db.execute(
        text("""
            SELECT e.edition_id, e.format_type_id, ft.format_name, e.version_name,
                   e.label, e.catalog_number, e.barcode, e.notes, e.ownership_status_id,
                   os.status_name AS ownership_status
            FROM tbl_music_editions e
            LEFT JOIN lkup_music_format_types ft ON e.format_type_id = ft.format_type_id
            LEFT JOIN lkup_ownership_statuses os ON e.ownership_status_id = os.ownership_status_id
            WHERE e.item_id = :item_id
            ORDER BY e.edition_id
        """),
        {"item_id": item_id},
    ).fetchall()

    return {
        "item_id": row[0],
        "ownership_status_id": row[1],
        "ownership_status": row[2],
        "top_level_category_id": row[3],
        "release_type": row[4],
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
        "artists": [{"artist_id": a[0], "artist_name": a[1]} for a in artists],
        "artist_names": [a[1] for a in artists],
        "genres": [
            {
                "top_genre_id": g[1],
                "genre_name": g[2],
                "sub_genre_id": g[3],
                "sub_genre_name": g[4],
            }
            for g in genres
        ],
        "genre_labels": [
            g[2] + (" — " + g[4] if g[4] else "") for g in genres
        ],
        "songs": [
            {
                "song_id": s[0],
                "title": s[1],
                "duration_seconds": s[2],
                "track_number": s[3],
                "disc_number": s[4],
            }
            for s in songs
        ],
        "editions": [
            {
                "edition_id": e[0],
                "format_type_id": e[1],
                "format_name": e[2],
                "version_name": e[3],
                "label": e[4],
                "catalog_number": e[5],
                "barcode": e[6],
                "notes": e[7],
                "ownership_status_id": e[8],
                "ownership_status": e[9],
            }
            for e in editions
        ],
    }


# --- Discogs API helpers ---

def _discogs_request(url: str) -> dict:
    headers = {
        "User-Agent": "CollectCore/1.0",
        "Authorization": f"Discogs key={DISCOGS_CONSUMER_KEY}, secret={DISCOGS_CONSUMER_SECRET}",
    }
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read().decode())


def _parse_discogs_position(pos: str):
    """Return (track_number, disc_number) from a Discogs position string."""
    if not pos:
        return None, 1
    pos = pos.strip()
    # Multi-disc CD: "1-1", "2-3"
    m = re.match(r'^(\d+)-(\d+)$', pos)
    if m:
        return int(m.group(2)), int(m.group(1))
    # Vinyl: "A1", "B2" — each letter is a disc side
    m = re.match(r'^([A-Za-z])(\d+)$', pos)
    if m:
        disc = ord(m.group(1).upper()) - ord('A') + 1
        return int(m.group(2)), disc
    # Simple number
    m = re.match(r'^(\d+)$', pos)
    if m:
        return int(m.group(1)), 1
    return None, 1


def _parse_discogs_duration(dur: str):
    """Parse Discogs 'm:ss' duration string to seconds."""
    if not dur:
        return None
    m = re.match(r'^(\d+):(\d{2})$', dur.strip())
    if m:
        return int(m.group(1)) * 60 + int(m.group(2))
    return None


def _clean_discogs_artist(name: str) -> str:
    """Strip Discogs disambiguation suffix like ' (2)'."""
    return re.sub(r'\s*\(\d+\)\s*$', '', name).strip()


# ---------- Lookup endpoints ----------

@router.get("/release-types")
def get_music_release_types(db=Depends(get_db)):
    rows = db.execute(
        text("""
            SELECT tlc.top_level_category_id, tlc.category_name
            FROM lkup_top_level_categories tlc
            JOIN lkup_collection_types lct ON tlc.collection_type_id = lct.collection_type_id
            WHERE lct.collection_type_code = 'music'
            ORDER BY tlc.sort_order
        """)
    ).fetchall()
    return [{"top_level_category_id": r[0], "category_name": r[1]} for r in rows]


@router.get("/format-types")
def get_music_format_types(db=Depends(get_db)):
    rows = db.execute(
        text("SELECT format_type_id, format_name FROM lkup_music_format_types WHERE is_active=1 ORDER BY sort_order")
    ).fetchall()
    return [{"format_type_id": r[0], "format_name": r[1]} for r in rows]


@router.get("/genres")
def get_music_genres(db=Depends(get_db)):
    top = db.execute(
        text("SELECT top_genre_id, genre_name FROM lkup_music_top_genres WHERE is_active=1 ORDER BY sort_order")
    ).fetchall()
    sub = db.execute(
        text("SELECT sub_genre_id, top_genre_id, sub_genre_name FROM lkup_music_sub_genres WHERE is_active=1 ORDER BY sort_order")
    ).fetchall()
    sub_map = {}
    for s in sub:
        sub_map.setdefault(s[1], []).append({"sub_genre_id": s[0], "sub_genre_name": s[2]})
    return [
        {"top_genre_id": t[0], "genre_name": t[1], "sub_genres": sub_map.get(t[0], [])}
        for t in top
    ]


@router.get("/artists")
def search_music_artists(q: Optional[str] = None, db=Depends(get_db)):
    if q:
        rows = db.execute(
            text("SELECT artist_id, artist_name FROM lkup_music_artists WHERE artist_name LIKE :q ORDER BY artist_sort LIMIT 20"),
            {"q": f"%{q}%"},
        ).fetchall()
    else:
        rows = db.execute(
            text("SELECT artist_id, artist_name FROM lkup_music_artists ORDER BY artist_sort")
        ).fetchall()
    return [{"artist_id": r[0], "artist_name": r[1]} for r in rows]


# ---------- Discogs lookup endpoints ----------

@router.get("/discogs-search")
def discogs_search_music(q: str):
    """Search Discogs master releases. Returns lightweight list for release picker."""
    if not q or not q.strip():
        return []
    if not DISCOGS_CONSUMER_KEY:
        raise HTTPException(status_code=503, detail="Discogs API not configured")
    encoded = urllib.parse.quote(q.strip())
    url = f"https://api.discogs.com/database/search?q={encoded}&type=master&per_page=15"
    try:
        data = _discogs_request(url)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Discogs search failed: {exc}")

    results = []
    for r in data.get("results", []):
        raw_title = r.get("title", "")
        # Discogs formats master titles as "Artist - Album"; split if present
        if " - " in raw_title:
            parts = raw_title.split(" - ", 1)
            artist_guess = [parts[0].strip()]
            title_clean = parts[1].strip()
        else:
            artist_guess = []
            title_clean = raw_title

        results.append({
            "discogs_id": r.get("master_id") or r.get("id"),
            "title": title_clean,
            "artists": artist_guess,
            "year": r.get("year"),
            "thumb_url": r.get("thumb"),
            "cover_image_url": r.get("cover_image"),
        })
    return results


@router.get("/discogs-master/{master_id}")
def discogs_master_detail(master_id: int):
    """Fetch full detail for a Discogs master release (title, artists, tracklist, cover)."""
    if not DISCOGS_CONSUMER_KEY:
        raise HTTPException(status_code=503, detail="Discogs API not configured")
    try:
        data = _discogs_request(f"https://api.discogs.com/masters/{master_id}")
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Discogs fetch failed: {exc}")

    # Artists — skip "Various" and clean disambiguation suffixes
    artists = [
        _clean_discogs_artist(a.get("name", ""))
        for a in data.get("artists", [])
        if a.get("name") and a.get("name") not in ("Various", "Various Artists")
    ]

    # Cover image — prefer primary, fall back to first
    cover = None
    images = data.get("images", [])
    primary = next((img for img in images if img.get("type") == "primary"), None)
    if primary:
        cover = primary.get("uri") or primary.get("uri150")
    elif images:
        cover = images[0].get("uri") or images[0].get("uri150")

    # Tracklist — skip heading entries
    tracklist = []
    for t in data.get("tracklist", []):
        if t.get("type_") == "heading":
            continue
        track_num, disc_num = _parse_discogs_position(t.get("position", ""))
        tracklist.append({
            "title": t.get("title", ""),
            "track_number": track_num,
            "disc_number": disc_num,
            "duration_seconds": _parse_discogs_duration(t.get("duration")),
        })

    return {
        "discogs_id": data.get("id"),
        "title": data.get("title", ""),
        "artists": artists,
        "year": data.get("year"),
        "genres": data.get("genres", []),
        "styles": data.get("styles", []),
        "cover_image_url": cover,
        "tracklist": tracklist,
    }


# ---------- CRUD endpoints ----------

@router.get("")
def list_music(
    search: Optional[str] = None,
    release_type_id: Optional[int] = None,
    ownership_status_id: Optional[int] = None,
    db=Depends(get_db),
):
    where = ["i.collection_type_id = :ct"]
    params: dict = {"ct": MUSIC_COLLECTION_TYPE_ID}

    if search:
        where.append("rd.title LIKE :search")
        params["search"] = f"%{search}%"
    if release_type_id is not None:
        where.append("i.top_level_category_id = :rt")
        params["rt"] = release_type_id
    if ownership_status_id is not None:
        where.append("i.ownership_status_id = :own")
        params["own"] = ownership_status_id

    where_clause = " AND ".join(where)

    rows = db.execute(
        text(f"""
            SELECT
                i.item_id,
                i.ownership_status_id,
                os.status_name AS ownership_status,
                i.top_level_category_id,
                tlc.category_name AS release_type,
                i.notes,
                rd.title,
                rd.title_sort,
                rd.release_date,
                rd.cover_image_url,
                (
                    SELECT GROUP_CONCAT(a.artist_name, ', ')
                    FROM xref_music_release_artists xa
                    JOIN lkup_music_artists a ON xa.artist_id = a.artist_id
                    WHERE xa.item_id = i.item_id
                    ORDER BY xa.artist_order
                ) AS artists,
                (
                    SELECT GROUP_CONCAT(ft.format_name, ', ')
                    FROM tbl_music_editions e
                    LEFT JOIN lkup_music_format_types ft ON e.format_type_id = ft.format_type_id
                    WHERE e.item_id = i.item_id
                ) AS formats,
                (
                    SELECT GROUP_CONCAT(tg.genre_name, ', ')
                    FROM xref_music_release_genres xg
                    JOIN lkup_music_top_genres tg ON xg.top_genre_id = tg.top_genre_id
                    WHERE xg.item_id = i.item_id
                ) AS genres,
                (
                    SELECT GROUP_CONCAT(
                        CASE
                            WHEN e.version_name IS NOT NULL AND e.version_name != ''
                            THEN e.version_name || ' (' || COALESCE(ft.format_name, '?') || ', ' || COALESCE(os.status_name, '?') || ')'
                            ELSE '(' || COALESCE(ft.format_name, '?') || ', ' || COALESCE(os.status_name, '?') || ')'
                        END,
                        ', '
                    )
                    FROM tbl_music_editions e
                    LEFT JOIN lkup_music_format_types ft ON e.format_type_id = ft.format_type_id
                    LEFT JOIN lkup_ownership_statuses os ON e.ownership_status_id = os.ownership_status_id
                    WHERE e.item_id = i.item_id
                ) AS editions_summary
            FROM tbl_items i
            JOIN tbl_music_release_details rd ON i.item_id = rd.item_id
            JOIN lkup_ownership_statuses os ON i.ownership_status_id = os.ownership_status_id
            JOIN lkup_top_level_categories tlc ON i.top_level_category_id = tlc.top_level_category_id
            WHERE {where_clause}
            ORDER BY rd.title_sort, rd.title
        """),
        params,
    ).fetchall()

    return [
        {
            "item_id": r[0],
            "ownership_status_id": r[1],
            "ownership_status": r[2],
            "top_level_category_id": r[3],
            "release_type": r[4],
            "notes": r[5],
            "title": r[6],
            "title_sort": r[7],
            "release_date": r[8],
            "cover_image_url": r[9],
            "artists": r[10].split(", ") if r[10] else [],
            "formats": list(dict.fromkeys(r[11].split(", "))) if r[11] else [],
            "genres": r[12].split(", ") if r[12] else [],
            "editions_summary": r[13] or "",
        }
        for r in rows
    ]


@router.get("/{item_id}")
def get_music_release(item_id: int, db=Depends(get_db)):
    detail = _get_music_detail(db, item_id)
    if not detail:
        raise HTTPException(status_code=404, detail="Music release not found.")
    return detail


@router.post("")
def create_music_release(payload: MusicReleaseCreate, db=Depends(get_db)):
    try:
        title_sort = make_title_sort_suffixed(payload.title)

        item_result = db.execute(
            text("""
                INSERT INTO tbl_items (collection_type_id, top_level_category_id, ownership_status_id, notes)
                VALUES (:ct, :tlc, :own, :notes)
            """),
            {
                "ct": MUSIC_COLLECTION_TYPE_ID,
                "tlc": payload.top_level_category_id,
                "own": payload.ownership_status_id,
                "notes": payload.notes,
            },
        )
        item_id = item_result.lastrowid

        db.execute(
            text("""
                INSERT INTO tbl_music_release_details
                    (item_id, title, title_sort, description, release_date, cover_image_url, api_source, external_work_id)
                VALUES (:iid, :title, :sort, :desc, :date, :cover, :api_src, :ext_id)
            """),
            {
                "iid": item_id,
                "title": payload.title,
                "sort": title_sort,
                "desc": payload.description,
                "date": payload.release_date,
                "cover": resolve_cover_url(payload.cover_image_url, "music", item_id),
                "api_src": payload.api_source,
                "ext_id": payload.external_work_id,
            },
        )

        _insert_music_relationships(db, item_id, payload)
        _insert_music_songs(db, item_id, payload.songs)
        _insert_music_editions(db, item_id, payload.editions)

        db.commit()
        release = _get_music_detail(db, item_id)
        return {"item_id": item_id, "status": "created", "release": release}
    except Exception:
        db.rollback()
        raise


@router.put("/{item_id}")
def update_music_release(item_id: int, payload: MusicReleaseUpdate, db=Depends(get_db)):
    try:
        existing = db.execute(
            text("SELECT item_id FROM tbl_items WHERE item_id = :id AND collection_type_id = :ct"),
            {"id": item_id, "ct": MUSIC_COLLECTION_TYPE_ID},
        ).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Music release not found.")

        # Update tbl_items
        item_updates = []
        item_params: dict = {"id": item_id}
        if payload.top_level_category_id is not None:
            item_updates.append("top_level_category_id = :tlc")
            item_params["tlc"] = payload.top_level_category_id
        if payload.ownership_status_id is not None:
            item_updates.append("ownership_status_id = :own")
            item_params["own"] = payload.ownership_status_id
        if payload.notes is not None:
            item_updates.append("notes = :notes")
            item_params["notes"] = payload.notes
        if item_updates:
            item_updates.append("updated_at = CURRENT_TIMESTAMP")
            db.execute(
                text(f"UPDATE tbl_items SET {', '.join(item_updates)} WHERE item_id = :id"),
                item_params,
            )

        # Update release details
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
        if payload.cover_image_url is not None:
            detail_updates.append("cover_image_url = :cover")
            detail_params["cover"] = resolve_cover_url(payload.cover_image_url, "music", item_id)
        if payload.api_source is not None:
            detail_updates.append("api_source = :api_src")
            detail_params["api_src"] = payload.api_source
        if payload.external_work_id is not None:
            detail_updates.append("external_work_id = :ext_id")
            detail_params["ext_id"] = payload.external_work_id
        if detail_updates:
            db.execute(
                text(f"UPDATE tbl_music_release_details SET {', '.join(detail_updates)} WHERE item_id = :id"),
                detail_params,
            )

        # Replace relationships
        if payload.artist_names is not None:
            db.execute(text("DELETE FROM xref_music_release_artists WHERE item_id = :id"), {"id": item_id})
            for order, name in enumerate(payload.artist_names):
                name = name.strip()
                if not name:
                    continue
                artist_id = _upsert_music_artist(db, name)
                db.execute(
                    text("INSERT OR IGNORE INTO xref_music_release_artists (item_id, artist_id, artist_order) VALUES (:iid, :aid, :ord)"),
                    {"iid": item_id, "aid": artist_id, "ord": order},
                )

        if payload.genres is not None:
            db.execute(text("DELETE FROM xref_music_release_genres WHERE item_id = :id"), {"id": item_id})
            for g in payload.genres:
                top_id = g.get("top_genre_id")
                sub_id = g.get("sub_genre_id")
                if not top_id:
                    continue
                db.execute(
                    text("INSERT OR IGNORE INTO xref_music_release_genres (item_id, top_genre_id, sub_genre_id) VALUES (:iid, :tg, :sg)"),
                    {"iid": item_id, "tg": top_id, "sg": sub_id},
                )

        if payload.songs is not None:
            db.execute(text("DELETE FROM tbl_music_songs WHERE item_id = :id"), {"id": item_id})
            _insert_music_songs(db, item_id, payload.songs)

        if payload.editions is not None:
            db.execute(text("DELETE FROM tbl_music_editions WHERE item_id = :id"), {"id": item_id})
            _insert_music_editions(db, item_id, payload.editions)

        db.commit()
        release = _get_music_detail(db, item_id)
        return {"item_id": item_id, "status": "updated", "release": release}
    except HTTPException:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise


@router.delete("/{item_id}")
def delete_music_release(item_id: int, db=Depends(get_db)):
    try:
        existing = db.execute(
            text("SELECT item_id FROM tbl_items WHERE item_id = :id AND collection_type_id = :ct"),
            {"id": item_id, "ct": MUSIC_COLLECTION_TYPE_ID},
        ).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Music release not found.")

        files_to_delete = delete_attachment_files(db, item_id)
        files_to_delete.extend(collect_cover_file(db, "tbl_music_release_details", item_id))
        db.execute(text("DELETE FROM xref_music_release_artists WHERE item_id = :id"), {"id": item_id})
        db.execute(text("DELETE FROM xref_music_release_genres WHERE item_id = :id"), {"id": item_id})
        db.execute(text("DELETE FROM tbl_music_songs WHERE item_id = :id"), {"id": item_id})
        db.execute(text("DELETE FROM tbl_music_editions WHERE item_id = :id"), {"id": item_id})
        db.execute(text("DELETE FROM tbl_attachments WHERE item_id = :id"), {"id": item_id})
        db.execute(text("DELETE FROM tbl_music_release_details WHERE item_id = :id"), {"id": item_id})
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
def bulk_update_music(payload: MusicBulkUpdatePayload, db=Depends(get_db)):
    try:
        for item_id in payload.item_ids:
            existing = db.execute(
                text("SELECT item_id FROM tbl_items WHERE item_id = :id AND collection_type_id = :ct"),
                {"id": item_id, "ct": MUSIC_COLLECTION_TYPE_ID},
            ).fetchone()
            if not existing:
                raise HTTPException(status_code=404, detail=f"Item {item_id} not found.")

            updates = []
            params = {"id": item_id}
            if payload.fields.ownership_status_id is not None:
                updates.append("ownership_status_id = :own")
                params["own"] = payload.fields.ownership_status_id
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
def bulk_delete_music(payload: BulkDeletePayload, db=Depends(get_db)):
    try:
        for item_id in payload.item_ids:
            existing = db.execute(
                text("SELECT item_id FROM tbl_items WHERE item_id = :id AND collection_type_id = :ct"),
                {"id": item_id, "ct": MUSIC_COLLECTION_TYPE_ID},
            ).fetchone()
            if not existing:
                raise HTTPException(status_code=404, detail=f"Item {item_id} not found.")

        all_files = []
        for item_id in payload.item_ids:
            all_files.extend(delete_attachment_files(db, item_id))
            all_files.extend(collect_cover_file(db, "tbl_music_release_details", item_id))
            db.execute(text("DELETE FROM xref_music_release_artists WHERE item_id = :id"), {"id": item_id})
            db.execute(text("DELETE FROM xref_music_release_genres WHERE item_id = :id"), {"id": item_id})
            db.execute(text("DELETE FROM tbl_music_songs WHERE item_id = :id"), {"id": item_id})
            db.execute(text("DELETE FROM tbl_music_editions WHERE item_id = :id"), {"id": item_id})
            db.execute(text("DELETE FROM tbl_attachments WHERE item_id = :id"), {"id": item_id})
            db.execute(text("DELETE FROM tbl_music_release_details WHERE item_id = :id"), {"id": item_id})
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
