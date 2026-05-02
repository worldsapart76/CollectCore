"""
ONE-TIME CSV IMPORT TOOL — DELETABLE.

Self-contained module to bulk-import Movies / TV / Video Games / Music from
the four CSVs in `docs/`. Everything lives in this file plus
`frontend/src/csvImport/`. To remove after the import is done, run
`python tools/remove_csv_importer.py` and follow its print-out.

Mounted only when CSV_IMPORT_ENABLED=1 in the environment (see main.py).
"""

import csv
import json
import os
import re
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text

from constants import (
    MUSIC_COLLECTION_TYPE_ID,
    VIDEO_COLLECTION_TYPE_ID,
    VIDEOGAMES_COLLECTION_TYPE_ID,
)
from dependencies import get_db
from helpers import make_title_sort_suffixed

# Re-use the existing TMDB / RAWG / Discogs proxies and item-creation helpers.
from routers.video import (
    tmdb_search as _tmdb_search,
    tmdb_detail as _tmdb_detail,
    _insert_video_relationships,
    _insert_video_copies,
    _insert_video_seasons,
)
from routers.videogames import (
    rawg_search as _rawg_search,
    _insert_game_relationships,
    _insert_game_copies,
)
from routers.music import (
    discogs_search_music as _discogs_search,
    discogs_master_detail as _discogs_master_detail,
    _upsert_music_artist,
)
from schemas.video import VideoCopyEntry, VideoSeasonEntry
from schemas.videogames import GameCopyInput

router = APIRouter(prefix="/csv-import", tags=["csv-import"])

# ---------- Constants ----------
APP_ROOT = Path(__file__).resolve().parents[2]
DOCS = APP_ROOT / "docs"

CSV_FILES = [
    {"name": "Movies-Owned.csv",        "module": "video",      "kind": "movie"},
    {"name": "TV and Other-Owned.csv",  "module": "video",      "kind": "tv_or_other"},
    {"name": "Video Games-Owned.csv",   "module": "videogames", "kind": "videogame"},
    {"name": "Music-Owned.csv",         "module": "music",      "kind": "music"},
]

# Map raw CSV format strings to lkup_video_format_types.format_type_id.
# Note: lkup populated names: Blu-ray=1, 4K UHD=2, DVD=3, Digital=4, Streaming=5,
# VHS=6, Other=7. Blank → DVD per user instruction.
VIDEO_FORMAT_MAP = {
    "BluRay":         (1, None),         # (format_type_id, notes_prefix)
    "Blu-ray":        (1, None),
    "4K UltraHD":     (2, None),
    "4K UHD":         (2, None),
    "DVD":            (3, None),
    "DVD Collection": (3, "Collection"),
    "Digital amazon": (4, None),
    "Digital":        (4, None),
    "VHS":            (6, None),
    "":               (3, None),         # blank → DVD
}

OWNED_STATUS_ID = 1   # lkup_ownership_statuses: Owned
MUSIC_CD_FORMAT_ID = 1
MUSIC_ALBUM_CATEGORY_ID = 13


# ---------- Schema bootstrap ----------
def _ensure_queue_table(db) -> None:
    db.execute(text("""
        CREATE TABLE IF NOT EXISTS tbl_csv_import_queue (
            queue_id            INTEGER PRIMARY KEY AUTOINCREMENT,
            csv_file            TEXT NOT NULL,
            csv_row_index       INTEGER NOT NULL,
            module              TEXT NOT NULL,
            csv_data            TEXT NOT NULL,
            status              TEXT NOT NULL DEFAULT 'queued',
            sort_order          INTEGER NOT NULL DEFAULT 0,
            api_results_json    TEXT,
            api_pages_loaded    INTEGER NOT NULL DEFAULT 0,
            decision_json       TEXT,
            duplicate_item_id   INTEGER,
            created_item_id     INTEGER,
            last_error          TEXT,
            created_at          TEXT DEFAULT CURRENT_TIMESTAMP,
            decided_at          TEXT,
            UNIQUE(csv_file, csv_row_index)
        )
    """))
    db.execute(text(
        "CREATE INDEX IF NOT EXISTS idx_csvq_status ON tbl_csv_import_queue(status, module, sort_order)"
    ))
    db.commit()


# ---------- CSV parsing ----------
def _read_csv(path: Path) -> list[dict]:
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"CSV not found: {path.name}")
    with path.open("r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        rows = []
        for i, row in enumerate(reader):
            row = {k: (v.strip() if isinstance(v, str) else v) for k, v in row.items()}
            row["__row_index"] = i
            rows.append(row)
        return rows


def _normalize_title_for_dup(title: str) -> str:
    return re.sub(r"\s+", " ", (title or "")).strip().lower()


def _detect_tv_meta(title: str, type_col: str, number_col: str) -> dict:
    """
    Returns: {
      base_title: str (title with season tag stripped),
      is_tv: bool,
      seasons: [int, ...],   # parsed seasons (could be empty)
      kind: 'tv' | 'movie'   # routing
    }
    """
    is_tv = (type_col or "").strip().upper() == "TV"
    base = title or ""
    seasons: list[int] = []

    # Try title-embedded season tags: "S1", "Season 2", "Seasons 1-3", "S1-3"
    if is_tv:
        m = re.search(r"\bS(\d+)\s*[-–]\s*S?(\d+)\b", base, re.IGNORECASE)
        if m:
            a, b = int(m.group(1)), int(m.group(2))
            if 0 < a <= b <= 99:
                seasons = list(range(a, b + 1))
                base = re.sub(r"\s*\bS\d+\s*[-–]\s*S?\d+\b", "", base, flags=re.IGNORECASE).strip()
        else:
            m2 = re.findall(r"\bS(\d+)\b", base, re.IGNORECASE)
            if m2:
                seasons = sorted({int(x) for x in m2 if 0 < int(x) <= 99})
                base = re.sub(r"\s*\bS\d+\b", "", base, flags=re.IGNORECASE).strip()
            m3 = re.search(r"\bSeason\s+(\d+)\b", base, re.IGNORECASE)
            if not seasons and m3:
                seasons = [int(m3.group(1))]
                base = re.sub(r"\s*\bSeason\s+\d+\b", "", base, flags=re.IGNORECASE).strip()

        # Fallback to Number column ONLY if it parses as a small int and no
        # season was detected from the title. User flagged Number is sometimes
        # watch order, so cap at <=15 to avoid crazy values.
        if not seasons and number_col:
            try:
                n = int(str(number_col).strip())
                if 1 <= n <= 15:
                    seasons = [n]
            except (TypeError, ValueError):
                pass

    return {
        "base_title": base.strip(),
        "is_tv": is_tv,
        "seasons": seasons,
    }


# ---------- API search wrappers (return raw lists, not Responses) ----------
def _search_video(query: str, media_type: str, page: int = 1) -> dict:
    try:
        return _tmdb_search(q=query, media_type=media_type, page=page)
    except HTTPException as exc:
        return {"error": exc.detail, "results": [], "page": page, "total_pages": 0, "total_results": 0}
    except Exception as exc:
        return {"error": str(exc), "results": [], "page": page, "total_pages": 0, "total_results": 0}


def _search_videogame(query: str) -> list:
    try:
        return _rawg_search(q=query)
    except HTTPException as exc:
        return {"error": exc.detail, "results": []}
    except Exception as exc:
        return {"error": str(exc), "results": []}


def _search_music(query: str) -> list:
    try:
        return _discogs_search(q=query)
    except HTTPException as exc:
        return {"error": exc.detail, "results": []}
    except Exception as exc:
        return {"error": str(exc), "results": []}


# ---------- Duplicate detection ----------
def _find_duplicate(db, module: str, normalized_title: str) -> Optional[int]:
    if not normalized_title:
        return None
    if module == "video":
        row = db.execute(
            text("""
                SELECT i.item_id FROM tbl_items i JOIN tbl_video_details vd ON i.item_id=vd.item_id
                WHERE i.collection_type_id = :ct AND LOWER(TRIM(vd.title)) = :t LIMIT 1
            """),
            {"ct": VIDEO_COLLECTION_TYPE_ID, "t": normalized_title},
        ).fetchone()
    elif module == "videogames":
        row = db.execute(
            text("""
                SELECT i.item_id FROM tbl_items i JOIN tbl_game_details gd ON i.item_id=gd.item_id
                WHERE i.collection_type_id = :ct AND LOWER(TRIM(gd.title)) = :t LIMIT 1
            """),
            {"ct": VIDEOGAMES_COLLECTION_TYPE_ID, "t": normalized_title},
        ).fetchone()
    elif module == "music":
        row = db.execute(
            text("""
                SELECT i.item_id FROM tbl_items i JOIN tbl_music_release_details rd ON i.item_id=rd.item_id
                WHERE i.collection_type_id = :ct AND LOWER(TRIM(rd.title)) = :t LIMIT 1
            """),
            {"ct": MUSIC_COLLECTION_TYPE_ID, "t": normalized_title},
        ).fetchone()
    else:
        return None
    return row[0] if row else None


# ---------- Seed ----------
class SeedRequest(BaseModel):
    preview: bool = False  # if True, only seed the FIRST row of each file


@router.get("/status")
def status_endpoint(db=Depends(get_db)):
    """Quick check the import tool is mounted; returns counts if seeded."""
    _ensure_queue_table(db)
    files_present = []
    for f in CSV_FILES:
        p = DOCS / f["name"]
        files_present.append({"name": f["name"], "module": f["module"], "exists": p.exists()})

    counts_rows = db.execute(text("""
        SELECT module, status, COUNT(*) FROM tbl_csv_import_queue GROUP BY module, status
    """)).fetchall()
    counts: dict = {}
    for module, status, n in counts_rows:
        counts.setdefault(module, {})[status] = n

    return {"enabled": True, "files": files_present, "counts": counts}


@router.post("/seed")
def seed(payload: SeedRequest, db=Depends(get_db)):
    """
    Idempotent. Reads the four CSVs and inserts queue rows for any
    (csv_file, csv_row_index) not already present.

    preview=True: only inserts the FIRST data row from each file (4 rows total)
    so you can walk through one of each and tweak the UI before committing.
    Subsequent preview=False call seeds the rest.
    """
    _ensure_queue_table(db)

    inserted = 0
    duplicates_flagged = 0

    for spec in CSV_FILES:
        path = DOCS / spec["name"]
        if not path.exists():
            continue
        rows = _read_csv(path)
        if payload.preview:
            rows = rows[:1]

        for row in rows:
            row_index = row["__row_index"]
            existing = db.execute(
                text("SELECT queue_id, status FROM tbl_csv_import_queue WHERE csv_file = :f AND csv_row_index = :i"),
                {"f": spec["name"], "i": row_index},
            ).fetchone()
            if existing:
                continue

            module = spec["module"]
            kind = spec["kind"]

            # Build CSV data payload
            if module == "music":
                title = row.get("Album", "")
                artist = row.get("Artist", "")
                data = {
                    "kind": "music",
                    "title": title,
                    "artist": artist,
                    "search_query": f"{artist} {title}".strip(),
                }
            elif module == "videogames":
                title = row.get("Title", "")
                data = {
                    "kind": "videogame",
                    "title": title,
                    "style": row.get("Style", ""),
                    "format": row.get("Format", ""),     # platform string
                    "search_query": title,
                }
            else:
                # video
                title = row.get("Title", "")
                type_col = row.get("Type", "")
                meta = _detect_tv_meta(title, type_col, row.get("Number", ""))
                data = {
                    "kind": kind,
                    "title": title,
                    "type": type_col,
                    "format": row.get("Format", ""),
                    "style": row.get("Style", ""),
                    "series": row.get("Series", ""),
                    "number": row.get("Number", ""),
                    "is_tv": meta["is_tv"],
                    "seasons_detected": meta["seasons"],
                    "base_title": meta["base_title"] or title,
                    "search_query": meta["base_title"] or title,
                    "media_type": "tv" if meta["is_tv"] else "movie",
                }

            # Duplicate check (use base_title for TV merging)
            check_title = data.get("base_title") or data.get("title", "")
            dup = _find_duplicate(db, module, _normalize_title_for_dup(check_title))

            db.execute(
                text("""
                    INSERT INTO tbl_csv_import_queue
                        (csv_file, csv_row_index, module, csv_data, status,
                         sort_order, duplicate_item_id)
                    VALUES (:f, :i, :m, :d, :s, :so, :dup)
                """),
                {
                    "f": spec["name"],
                    "i": row_index,
                    "m": module,
                    "d": json.dumps(data),
                    "s": "duplicate" if dup else "queued",
                    "so": row_index,
                    "dup": dup,
                },
            )
            if dup:
                duplicates_flagged += 1
            inserted += 1

    db.commit()
    return {"inserted": inserted, "duplicates_flagged": duplicates_flagged, "preview": payload.preview}


# ---------- Chunk fetch ----------
def _maybe_load_results(db, queue_row, force_page: Optional[int] = None) -> dict:
    """
    Returns the api_results_json dict for the queue row, populating it on first
    access (or fetching the next page if force_page is given). Caches in DB.

    Shape: {pages: [{page, results: [...]}], total_pages: n, total_results: n}
    """
    queue_id = queue_row["queue_id"]
    module = queue_row["module"]
    data = json.loads(queue_row["csv_data"])
    cached = json.loads(queue_row["api_results_json"]) if queue_row["api_results_json"] else None

    if cached and force_page is None:
        return cached

    query = data.get("search_query") or data.get("title", "")

    if module == "video":
        media_type = data.get("media_type", "movie")
        page = force_page or 1
        resp = _search_video(query, media_type, page=page)
        new_pages = (cached.get("pages") if cached else []) or []
        # Replace if page exists; otherwise append
        new_pages = [p for p in new_pages if p["page"] != page]
        new_pages.append({"page": page, "results": resp.get("results", [])})
        new_pages.sort(key=lambda p: p["page"])
        cached = {
            "pages": new_pages,
            "total_pages": resp.get("total_pages", 1),
            "total_results": resp.get("total_results", 0),
            "error": resp.get("error"),
        }
    elif module == "videogames":
        # RAWG returns one big page; we don't paginate today.
        resp = _search_videogame(query)
        results = resp if isinstance(resp, list) else resp.get("results", [])
        cached = {
            "pages": [{"page": 1, "results": results}],
            "total_pages": 1,
            "total_results": len(results),
            "error": (resp.get("error") if isinstance(resp, dict) else None),
        }
    else:  # music
        resp = _search_music(query)
        results = resp if isinstance(resp, list) else resp.get("results", [])
        cached = {
            "pages": [{"page": 1, "results": results}],
            "total_pages": 1,
            "total_results": len(results),
            "error": (resp.get("error") if isinstance(resp, dict) else None),
        }

    db.execute(
        text("UPDATE tbl_csv_import_queue SET api_results_json = :j, api_pages_loaded = :n WHERE queue_id = :id"),
        {"j": json.dumps(cached), "n": len(cached["pages"]), "id": queue_id},
    )
    db.commit()
    return cached


@router.get("/chunk")
def get_chunk(
    module: str,
    size: int = 10,
    include_deferred: bool = False,
    db=Depends(get_db),
):
    """
    Returns up to `size` queued items for the module (with API search results
    fetched + cached on first access). Items in `duplicate` status are
    excluded — they'd otherwise clutter the chunk; duplicate counts are
    surfaced in /progress and the user can revisit them via a different mode
    later if desired.

    include_deferred=True: returns deferred rows AFTER the queued ones run
    out, ordered by queue_id ASC. UI calls this once everything else is done.
    """
    _ensure_queue_table(db)
    if module not in {"video", "videogames", "music"}:
        raise HTTPException(status_code=400, detail="Invalid module.")

    statuses = ["queued"]
    if include_deferred:
        statuses.append("deferred")

    placeholders = ",".join(f":s{i}" for i in range(len(statuses)))
    sql = f"""
        SELECT queue_id, csv_file, csv_row_index, module, csv_data, status,
               sort_order, api_results_json, api_pages_loaded, duplicate_item_id
        FROM tbl_csv_import_queue
        WHERE module = :m AND status IN ({placeholders})
        ORDER BY CASE status WHEN 'queued' THEN 0 ELSE 1 END, sort_order
        LIMIT :lim
    """
    params: dict = {"m": module, "lim": size}
    for i, s in enumerate(statuses):
        params[f"s{i}"] = s

    rows = db.execute(text(sql), params).fetchall()
    out = []
    for r in rows:
        rd = dict(r._mapping)
        results = _maybe_load_results(db, rd)
        out.append({
            "queue_id": rd["queue_id"],
            "csv_file": rd["csv_file"],
            "csv_row_index": rd["csv_row_index"],
            "module": rd["module"],
            "csv_data": json.loads(rd["csv_data"]),
            "status": rd["status"],
            "duplicate_item_id": rd["duplicate_item_id"],
            "results": results,
        })
    return {"items": out}


@router.post("/results/{queue_id}/more")
def fetch_more_results(queue_id: int, db=Depends(get_db)):
    """Fetch the next page of API results for this queue row (TMDB only)."""
    _ensure_queue_table(db)
    row = db.execute(
        text("SELECT * FROM tbl_csv_import_queue WHERE queue_id = :id"),
        {"id": queue_id},
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Queue row not found.")
    rd = dict(row._mapping)
    if rd["module"] != "video":
        # RAWG/Discogs return a single big page in our impl; nothing to expand.
        raise HTTPException(status_code=400, detail="More results only supported for TMDB (video).")
    cached = json.loads(rd["api_results_json"]) if rd["api_results_json"] else {"pages": []}
    next_page = (max((p["page"] for p in cached.get("pages", [])), default=0)) + 1
    if cached.get("total_pages") and next_page > cached["total_pages"]:
        return {"results": cached, "no_more": True}
    new_cached = _maybe_load_results(db, rd, force_page=next_page)
    return {"results": new_cached}


# ---------- Refine / re-run search ----------
class RefineRequest(BaseModel):
    refined_query: str
    media_type: Optional[str] = None  # 'movie' | 'tv' for video module


@router.post("/refine/{queue_id}")
def refine_search(queue_id: int, payload: RefineRequest, db=Depends(get_db)):
    _ensure_queue_table(db)
    row = db.execute(
        text("SELECT * FROM tbl_csv_import_queue WHERE queue_id = :id"),
        {"id": queue_id},
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Queue row not found.")
    rd = dict(row._mapping)
    data = json.loads(rd["csv_data"])
    data["search_query"] = payload.refined_query.strip()
    if payload.media_type and rd["module"] == "video":
        data["media_type"] = payload.media_type
    db.execute(
        text("""UPDATE tbl_csv_import_queue
                SET csv_data = :d, api_results_json = NULL, api_pages_loaded = 0
                WHERE queue_id = :id"""),
        {"d": json.dumps(data), "id": queue_id},
    )
    db.commit()
    rd2 = dict(db.execute(
        text("SELECT * FROM tbl_csv_import_queue WHERE queue_id = :id"),
        {"id": queue_id},
    ).fetchone()._mapping)
    fresh = _maybe_load_results(db, rd2)
    return {"queue_id": queue_id, "csv_data": data, "results": fresh}


# ---------- Decide ----------
class DecideRequest(BaseModel):
    queue_id: int
    action: str  # 'pick' | 'skip' | 'save_title_only' | 'defer'
    # video pick fields:
    tmdb_id: Optional[int] = None
    media_type: Optional[str] = None  # 'movie' | 'tv'
    season_numbers: Optional[list[int]] = None  # for TV
    # videogame pick fields:
    rawg_id: Optional[int] = None
    # music pick fields:
    discogs_id: Optional[int] = None
    # generic override (rare):
    override_format: Optional[str] = None  # CSV format string override


def _video_format_from_csv(fmt_str: str) -> tuple[int, Optional[str]]:
    fmt_str = (fmt_str or "").strip()
    if fmt_str in VIDEO_FORMAT_MAP:
        return VIDEO_FORMAT_MAP[fmt_str]
    return (3, None)  # default DVD


def _build_video_notes(data: dict) -> Optional[str]:
    pieces: list[str] = []
    fmt_str = data.get("format", "")
    _, fmt_note = _video_format_from_csv(fmt_str)
    if fmt_note:
        pieces.append(fmt_note)
    style = (data.get("style") or "").strip()
    if style:
        pieces.append(style)
    if data.get("type") == "Other":
        pieces.append("Imported as 'Other' from TV/Other CSV")
    series = (data.get("series") or "").strip()
    if series:
        pieces.append(f"Series: {series}")
    number = (data.get("number") or "").strip()
    if number and not data.get("is_tv"):
        pieces.append(f"Number: {number}")
    return ". ".join(pieces) if pieces else None


def _ensure_game_platform(db, name: str) -> int:
    """Find-or-create a game platform; returns platform_id."""
    name = (name or "").strip()
    if not name:
        # default to "Other"
        row = db.execute(text("SELECT platform_id FROM lkup_game_platforms WHERE platform_name='Other' LIMIT 1")).fetchone()
        if row:
            return row[0]
    row = db.execute(
        text("SELECT platform_id FROM lkup_game_platforms WHERE LOWER(TRIM(platform_name)) = LOWER(TRIM(:n))"),
        {"n": name},
    ).fetchone()
    if row:
        return row[0]
    max_sort = db.execute(text("SELECT COALESCE(MAX(sort_order), 0) FROM lkup_game_platforms")).fetchone()[0] or 0
    result = db.execute(
        text("INSERT INTO lkup_game_platforms (platform_name, sort_order, is_active) VALUES (:n, :so, 1) RETURNING platform_id"),
        {"n": name, "so": int(max_sort) + 10},
    ).fetchone()
    return result[0]


def _save_video(db, data: dict, tmdb_id: Optional[int], media_type: str, season_numbers: Optional[list[int]], title_only: bool) -> int:
    """Create OR merge into existing video record. Returns item_id."""
    notes = _build_video_notes(data)
    fmt_id, _ = _video_format_from_csv(data.get("format", ""))

    # Determine routing: TV uses seasons, Movie/Other uses copies.
    is_tv = (media_type == "tv") if media_type else bool(data.get("is_tv"))

    # Title-only fallback: skip API detail, just insert with CSV title.
    if title_only or not tmdb_id:
        title = data.get("base_title") or data.get("title", "")
        tlc_id = 20 if is_tv else 19  # TV Series vs Movie
        item_id = _create_video_item(db, title, tlc_id, notes=notes, api_source=None, external_work_id=None,
                                     description=None, release_date=None, runtime=None, cover=None,
                                     directors=[], cast=[])
        if is_tv:
            seasons_to_add = season_numbers or data.get("seasons_detected") or []
            for sn in seasons_to_add:
                _add_season(db, item_id, sn, fmt_id, episode_count=None)
        else:
            _add_copy(db, item_id, fmt_id, notes)
        db.commit()
        return item_id

    # Pull TMDB detail
    detail = _tmdb_detail(tmdb_id=tmdb_id, media_type=media_type)
    title = detail.get("title") or data.get("title", "")
    tlc_id = 20 if is_tv else 19

    # Look for existing record with same external_work_id (for TV merge)
    existing = db.execute(
        text("""SELECT i.item_id FROM tbl_items i JOIN tbl_video_details vd ON i.item_id=vd.item_id
                WHERE i.collection_type_id = :ct AND vd.external_work_id = :eid AND vd.api_source = 'tmdb'
                LIMIT 1"""),
        {"ct": VIDEO_COLLECTION_TYPE_ID, "eid": str(tmdb_id)},
    ).fetchone()

    if existing and is_tv:
        # Merge: add seasons that aren't already owned.
        item_id = existing[0]
        existing_seasons = {r[0] for r in db.execute(
            text("SELECT season_number FROM tbl_video_seasons WHERE item_id=:id"),
            {"id": item_id},
        ).fetchall()}
        seasons_to_add = season_numbers or data.get("seasons_detected") or []
        # Build episode-count lookup from TMDB detail
        tmdb_seasons = {s["season_number"]: s.get("episode_count") for s in detail.get("seasons", [])}
        for sn in seasons_to_add:
            if sn in existing_seasons:
                continue
            _add_season(db, item_id, sn, fmt_id, episode_count=tmdb_seasons.get(sn))
        db.commit()
        return item_id

    if existing and not is_tv:
        # Add another copy (different format) to the existing movie
        item_id = existing[0]
        _add_copy(db, item_id, fmt_id, notes)
        db.commit()
        return item_id

    # Create new
    item_id = _create_video_item(
        db,
        title=title,
        tlc_id=tlc_id,
        notes=notes,
        api_source="tmdb",
        external_work_id=str(tmdb_id),
        description=detail.get("overview"),
        release_date=detail.get("release_date"),
        runtime=detail.get("runtime_minutes"),
        cover=detail.get("cover_image_url"),
        directors=detail.get("directors", []),
        cast=detail.get("cast", []),
    )

    if is_tv:
        seasons_to_add = season_numbers or data.get("seasons_detected") or []
        tmdb_seasons = {s["season_number"]: s.get("episode_count") for s in detail.get("seasons", [])}
        for sn in seasons_to_add:
            _add_season(db, item_id, sn, fmt_id, episode_count=tmdb_seasons.get(sn))
    else:
        _add_copy(db, item_id, fmt_id, notes)

    db.commit()
    return item_id


def _create_video_item(db, title: str, tlc_id: int, notes: Optional[str], api_source, external_work_id,
                       description, release_date, runtime, cover, directors, cast) -> int:
    title_sort = make_title_sort_suffixed(title)
    item_result = db.execute(
        text("""
            INSERT INTO tbl_items (collection_type_id, top_level_category_id, ownership_status_id, notes)
            VALUES (:ct, :tlc, :own, :notes)
        """),
        {"ct": VIDEO_COLLECTION_TYPE_ID, "tlc": tlc_id, "own": OWNED_STATUS_ID, "notes": notes},
    )
    item_id = item_result.lastrowid
    db.execute(
        text("""
            INSERT INTO tbl_video_details
                (item_id, title, title_sort, description, release_date, runtime_minutes,
                 cover_image_url, api_source, external_work_id)
            VALUES (:iid, :t, :s, :d, :rd, :rt, :cv, :a, :e)
        """),
        {"iid": item_id, "t": title, "s": title_sort, "d": description, "rd": release_date,
         "rt": runtime, "cv": cover, "a": api_source, "e": external_work_id},
    )
    # Use a thin payload-like object for the existing helpers
    class _P:
        pass
    p = _P()
    p.director_names = directors or []
    p.cast_names = cast or []
    p.genres = []
    _insert_video_relationships(db, item_id, p)
    return item_id


def _add_copy(db, item_id: int, format_type_id: int, notes: Optional[str]) -> None:
    db.execute(
        text("""INSERT INTO tbl_video_copies (item_id, format_type_id, ownership_status_id, notes)
                VALUES (:iid, :fmt, :own, :notes)"""),
        {"iid": item_id, "fmt": format_type_id, "own": OWNED_STATUS_ID, "notes": notes},
    )


def _add_season(db, item_id: int, season_number: int, format_type_id: int, episode_count: Optional[int]) -> None:
    db.execute(
        text("""INSERT INTO tbl_video_seasons
                    (item_id, season_number, episode_count, format_type_id, ownership_status_id)
                VALUES (:iid, :n, :ep, :fmt, :own)"""),
        {"iid": item_id, "n": season_number, "ep": episode_count, "fmt": format_type_id, "own": OWNED_STATUS_ID},
    )


def _save_videogame(db, data: dict, rawg_id: Optional[int], title_only: bool) -> int:
    title = data.get("title", "")
    notes = _build_videogame_notes(data)
    platform_id = _ensure_game_platform(db, data.get("format", ""))

    if title_only or not rawg_id:
        item_id = _create_game_item(db, title, notes=notes, api_source=None, external_work_id=None,
                                    description=None, release_date=None, cover=None,
                                    developers=[], publishers=[])
        _add_game_copy(db, item_id, platform_id, notes)
        db.commit()
        return item_id

    # Fetch RAWG detail
    detail = _fetch_rawg_detail(rawg_id)
    title = detail.get("title") or title

    # Existing record check (same RAWG id)
    existing = db.execute(
        text("""SELECT i.item_id FROM tbl_items i JOIN tbl_game_details gd ON i.item_id=gd.item_id
                WHERE i.collection_type_id = :ct AND gd.external_work_id = :eid AND gd.api_source = 'rawg' LIMIT 1"""),
        {"ct": VIDEOGAMES_COLLECTION_TYPE_ID, "eid": str(rawg_id)},
    ).fetchone()
    if existing:
        item_id = existing[0]
        _add_game_copy(db, item_id, platform_id, notes)
        db.commit()
        return item_id

    item_id = _create_game_item(
        db,
        title=title,
        notes=notes,
        api_source="rawg",
        external_work_id=str(rawg_id),
        description=detail.get("description"),
        release_date=detail.get("released"),
        cover=detail.get("cover_image_url"),
        developers=detail.get("developers", []),
        publishers=detail.get("publishers", []),
    )
    _add_game_copy(db, item_id, platform_id, notes)
    db.commit()
    return item_id


def _build_videogame_notes(data: dict) -> Optional[str]:
    style = (data.get("style") or "").strip()
    return style or None


def _fetch_rawg_detail(rawg_id: int) -> dict:
    """Tiny RAWG detail fetcher inlined here so we don't have to add an endpoint to videogames.py."""
    rawg_key = os.environ.get("RAWG_API_KEY", "")
    url = f"https://api.rawg.io/api/games/{rawg_id}"
    if rawg_key:
        url += f"?key={urllib.parse.quote(rawg_key)}"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "CollectCore/1.0"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            d = json.loads(resp.read().decode())
        # Strip RAWG's HTML from description_raw
        desc = d.get("description_raw") or ""
        return {
            "title": d.get("name", ""),
            "released": d.get("released"),
            "cover_image_url": d.get("background_image"),
            "description": desc,
            "developers": [x["name"] for x in (d.get("developers") or []) if x.get("name")],
            "publishers": [x["name"] for x in (d.get("publishers") or []) if x.get("name")],
        }
    except Exception as exc:
        return {"title": "", "released": None, "cover_image_url": None, "description": None,
                "developers": [], "publishers": [], "_error": str(exc)}


def _create_game_item(db, title, notes, api_source, external_work_id, description, release_date,
                      cover, developers, publishers) -> int:
    cat = db.execute(text("""
        SELECT ltc.top_level_category_id FROM lkup_top_level_categories ltc
        JOIN lkup_collection_types lct ON ltc.collection_type_id = lct.collection_type_id
        WHERE lct.collection_type_code = 'videogames' LIMIT 1
    """)).fetchone()
    cat_id = cat[0]
    item_result = db.execute(
        text("""INSERT INTO tbl_items (collection_type_id, top_level_category_id, ownership_status_id, notes)
                VALUES (:ct, :cat, :own, :notes) RETURNING item_id"""),
        {"ct": VIDEOGAMES_COLLECTION_TYPE_ID, "cat": cat_id, "own": OWNED_STATUS_ID, "notes": notes},
    ).fetchone()
    item_id = item_result[0]
    from helpers import make_title_sort
    db.execute(
        text("""INSERT INTO tbl_game_details (item_id, title, title_sort, description, release_date,
                    cover_image_url, api_source, external_work_id)
                VALUES (:i, :t, :ts, :d, :r, :c, :a, :e)"""),
        {"i": item_id, "t": title, "ts": make_title_sort(title), "d": description, "r": release_date,
         "c": cover, "a": api_source, "e": external_work_id},
    )
    class _P: pass
    p = _P()
    p.developer_names = developers or []
    p.publisher_names = publishers or []
    p.genres = []
    _insert_game_relationships(db, item_id, p)
    return item_id


def _add_game_copy(db, item_id: int, platform_id: int, notes: Optional[str]) -> None:
    db.execute(
        text("""INSERT INTO tbl_game_copies (item_id, platform_id, ownership_status_id, notes)
                VALUES (:i, :p, :o, :n)"""),
        {"i": item_id, "p": platform_id, "o": OWNED_STATUS_ID, "n": notes},
    )


def _save_music(db, data: dict, discogs_id: Optional[int], title_only: bool) -> int:
    title = data.get("title", "")
    artist = (data.get("artist") or "").strip()

    if title_only or not discogs_id:
        item_id = _create_music_release(db, title=title, artist=artist, api_source=None,
                                        external_work_id=None, description=None, release_date=None,
                                        cover=None, songs=[])
        _add_music_edition(db, item_id)
        db.commit()
        return item_id

    detail = _discogs_master_detail(master_id=discogs_id)
    title = detail.get("title") or title
    artists = detail.get("artists") or ([artist] if artist else [])
    songs_raw = detail.get("tracklist", [])

    item_id = _create_music_release(
        db,
        title=title,
        artist=None,
        artists=artists,
        api_source="discogs",
        external_work_id=str(discogs_id),
        description=None,
        release_date=str(detail.get("year")) if detail.get("year") else None,
        cover=detail.get("cover_image_url"),
        songs=songs_raw,
    )
    _add_music_edition(db, item_id)
    db.commit()
    return item_id


def _create_music_release(db, title, artist=None, artists=None, *, api_source, external_work_id,
                          description, release_date, cover, songs) -> int:
    title_sort = make_title_sort_suffixed(title)
    item_result = db.execute(
        text("""INSERT INTO tbl_items (collection_type_id, top_level_category_id, ownership_status_id, notes)
                VALUES (:ct, :tlc, :own, NULL)"""),
        {"ct": MUSIC_COLLECTION_TYPE_ID, "tlc": MUSIC_ALBUM_CATEGORY_ID, "own": OWNED_STATUS_ID},
    )
    item_id = item_result.lastrowid
    db.execute(
        text("""INSERT INTO tbl_music_release_details
                    (item_id, title, title_sort, description, release_date, cover_image_url, api_source, external_work_id)
                VALUES (:i, :t, :ts, :d, :r, :c, :a, :e)"""),
        {"i": item_id, "t": title, "ts": title_sort, "d": description, "r": release_date,
         "c": cover, "a": api_source, "e": external_work_id},
    )
    artist_list = artists if artists else ([artist] if artist else [])
    for order, name in enumerate(artist_list):
        if not name or not name.strip():
            continue
        aid = _upsert_music_artist(db, name)
        db.execute(
            text("INSERT OR IGNORE INTO xref_music_release_artists (item_id, artist_id, artist_order) VALUES (:i, :a, :o)"),
            {"i": item_id, "a": aid, "o": order},
        )
    # Songs (from Discogs tracklist)
    for s in (songs or []):
        db.execute(
            text("""INSERT INTO tbl_music_songs (item_id, title, duration_seconds, track_number, disc_number)
                    VALUES (:i, :t, :d, :tr, :ds)"""),
            {"i": item_id, "t": s.get("title", ""), "d": s.get("duration_seconds"),
             "tr": s.get("track_number"), "ds": s.get("disc_number") or 1},
        )
    return item_id


def _add_music_edition(db, item_id: int) -> None:
    """Always CD, owned, no extras."""
    db.execute(
        text("""INSERT INTO tbl_music_editions
                    (item_id, format_type_id, ownership_status_id)
                VALUES (:i, :f, :o)"""),
        {"i": item_id, "f": MUSIC_CD_FORMAT_ID, "o": OWNED_STATUS_ID},
    )


@router.post("/decide")
def decide(payload: DecideRequest, db=Depends(get_db)):
    _ensure_queue_table(db)
    row = db.execute(
        text("SELECT * FROM tbl_csv_import_queue WHERE queue_id = :id"),
        {"id": payload.queue_id},
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Queue row not found.")
    rd = dict(row._mapping)
    data = json.loads(rd["csv_data"])
    module = rd["module"]
    decision: dict = {"action": payload.action}
    new_status = rd["status"]
    created_item_id: Optional[int] = None
    last_error: Optional[str] = None

    try:
        if payload.action == "skip":
            new_status = "skipped"
        elif payload.action == "defer":
            new_status = "deferred"
        elif payload.action in ("pick", "save_title_only"):
            title_only = payload.action == "save_title_only"
            if module == "video":
                media_type = payload.media_type or data.get("media_type", "movie")
                created_item_id = _save_video(
                    db, data, payload.tmdb_id if not title_only else None,
                    media_type, payload.season_numbers, title_only,
                )
                decision["tmdb_id"] = payload.tmdb_id
                decision["media_type"] = media_type
                decision["seasons"] = payload.season_numbers
            elif module == "videogames":
                created_item_id = _save_videogame(
                    db, data, payload.rawg_id if not title_only else None, title_only,
                )
                decision["rawg_id"] = payload.rawg_id
            elif module == "music":
                created_item_id = _save_music(
                    db, data, payload.discogs_id if not title_only else None, title_only,
                )
                decision["discogs_id"] = payload.discogs_id
            new_status = "saved"
        else:
            raise HTTPException(status_code=400, detail=f"Unknown action: {payload.action}")
    except HTTPException:
        raise
    except Exception as exc:
        db.rollback()
        new_status = "failed"
        last_error = str(exc)

    db.execute(
        text("""UPDATE tbl_csv_import_queue
                SET status = :s, decision_json = :d, decided_at = CURRENT_TIMESTAMP,
                    created_item_id = :iid, last_error = :err
                WHERE queue_id = :id"""),
        {"s": new_status, "d": json.dumps(decision), "iid": created_item_id,
         "err": last_error, "id": payload.queue_id},
    )
    db.commit()
    return {
        "queue_id": payload.queue_id,
        "status": new_status,
        "created_item_id": created_item_id,
        "error": last_error,
    }


# ---------- Progress ----------
@router.get("/progress")
def progress(db=Depends(get_db)):
    _ensure_queue_table(db)
    rows = db.execute(text("""
        SELECT csv_file, module, status, COUNT(*) AS n
        FROM tbl_csv_import_queue
        GROUP BY csv_file, module, status
        ORDER BY csv_file, status
    """)).fetchall()
    files: dict = {}
    totals: dict = {}
    for csv_file, module, status, n in rows:
        files.setdefault(csv_file, {"module": module, "counts": {}, "total": 0})
        files[csv_file]["counts"][status] = n
        files[csv_file]["total"] += n
        totals[status] = totals.get(status, 0) + n
    return {"files": files, "totals": totals}


# ---------- Reset (for testing) ----------
@router.post("/reset-row/{queue_id}")
def reset_row(queue_id: int, db=Depends(get_db)):
    """Test-only convenience: rewind a queue row back to 'queued' so you can
    re-decide it. Does NOT undo any items already created in the modules."""
    _ensure_queue_table(db)
    db.execute(
        text("""UPDATE tbl_csv_import_queue
                SET status = 'queued', decision_json = NULL, decided_at = NULL,
                    created_item_id = NULL, last_error = NULL
                WHERE queue_id = :id"""),
        {"id": queue_id},
    )
    db.commit()
    return {"queue_id": queue_id, "reset": True}
