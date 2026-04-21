import io
import json
import os
import re
import shutil
import sqlite3
import tempfile
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
from datetime import datetime
from pathlib import Path
from typing import List, Optional

# Load backend/.env if present (simple key=value, no dependencies needed)
_env_file = Path(__file__).parent / ".env"
if _env_file.exists():
    for _line in _env_file.read_text().splitlines():
        _line = _line.strip()
        if _line and not _line.startswith("#") and "=" in _line:
            _k, _v = _line.split("=", 1)
            os.environ.setdefault(_k.strip(), _v.strip())

COMIC_VINE_API_KEY = os.environ.get("COMIC_VINE_API_KEY", "")
GOOGLE_BOOKS_API_KEY = os.environ.get("GOOGLE_BOOKS_API_KEY", "")
RAWG_API_KEY = os.environ.get("RAWG_API_KEY", "")
TMDB_API_KEY = os.environ.get("TMDB_API_KEY", "")
DISCOGS_CONSUMER_KEY = os.environ.get("DISCOGS_CONSUMER_KEY", "")
DISCOGS_CONSUMER_SECRET = os.environ.get("DISCOGS_CONSUMER_SECRET", "")

from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from db import init_db

print("LOADED BACKEND FILE:", __file__)

# ---------- Paths ----------
APP_ROOT = Path(__file__).resolve().parents[1]

# Allow the launcher to redirect user data (DB + images) to a separate directory
# so app-file updates don't overwrite user data. Unset in development.
_data_root_env = os.environ.get("COLLECTCORE_DATA_DIR")
DATA_ROOT = Path(_data_root_env) if _data_root_env else APP_ROOT

IMAGES_DIR = DATA_ROOT / "images"


def _delete_attachment_files(db, item_id: int) -> list[str]:
    """Collect attachment file paths for an item, to be deleted after DB commit."""
    rows = db.execute(
        text("SELECT file_path FROM tbl_attachments WHERE item_id = :id"),
        {"id": item_id},
    ).fetchall()
    return [r[0] for r in rows if r[0]]


def _collect_cover_file(db, detail_table: str, item_id: int) -> list[str]:
    """Collect a local cover_image_url from a detail table, if it points to a local file."""
    row = db.execute(
        text(f"SELECT cover_image_url FROM {detail_table} WHERE item_id = :id"),
        {"id": item_id},
    ).fetchone()
    if row and row[0] and row[0].startswith("/images/"):
        return [row[0].lstrip("/")]
    return []


def _remove_files(file_paths: list[str]) -> None:
    """Delete image files from disk. Silently skips missing files."""
    for fp in file_paths:
        full = DATA_ROOT / fp
        if full.is_file():
            full.unlink()
INBOX_DIR = IMAGES_DIR / "inbox"
LIBRARY_DIR = IMAGES_DIR / "library"

GN_COVERS_DIR = LIBRARY_DIR / "gn"

# Cover directories for all modules (keyed by module code used in URLs)
COVER_DIRS: dict[str, Path] = {
    "books": LIBRARY_DIR / "books",
    "gn": GN_COVERS_DIR,
    "videogames": LIBRARY_DIR / "videogames",
    "music": LIBRARY_DIR / "music",
    "video": LIBRARY_DIR / "video",
    "boardgames": LIBRARY_DIR / "boardgames",
    "ttrpg": LIBRARY_DIR / "ttrpg",
}

INBOX_DIR.mkdir(parents=True, exist_ok=True)
LIBRARY_DIR.mkdir(parents=True, exist_ok=True)
for _d in COVER_DIRS.values():
    _d.mkdir(parents=True, exist_ok=True)

# ---------- App ----------
app = FastAPI(title="CollectCore API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------- DB init ----------
init_db()


def _resolve_collection_type_id(code: str, fallback: int) -> int:
    """Look up a collection_type_id by code at startup. Falls back to the
    hardcoded value if the code is not found (should never happen on a
    properly seeded DB, but guards against edge cases)."""
    _db = SessionLocal()
    try:
        row = _db.execute(
            text("SELECT collection_type_id FROM lkup_collection_types WHERE collection_type_code = :code"),
            {"code": code},
        ).fetchone()
        return row[0] if row else fallback
    finally:
        _db.close()

# ---------- Static files ----------
if IMAGES_DIR.exists():
    app.mount("/images", StaticFiles(directory=str(IMAGES_DIR)), name="images")


# ---------- Helpers ----------
from db import SessionLocal
from sqlalchemy import text


def _photocard_row_to_dict(row):
    return {
        "item_id": row[0],
        "group_id": row[1],
        "group_name": row[2],
        "top_level_category_id": row[3],
        "category": row[4],
        "ownership_status_id": row[5],
        "ownership_status": row[6],
        "notes": row[7],
        "source_origin_id": row[8],
        "source_origin": row[9],
        "version": row[10],
        "members": list(dict.fromkeys(row[11].split(", "))) if row[11] else [],
        "front_image_path": row[12],
        "back_image_path": row[13],
        "is_special": bool(row[14]),
    }


_PHOTOCARD_SELECT = """
    SELECT
        i.item_id,
        g.group_id,
        g.group_name,
        i.top_level_category_id,
        c.category_name,
        i.ownership_status_id,
        os.status_name,
        i.notes,
        p.source_origin_id,
        so.source_origin_name,
        p.version,
        COALESCE(
            (
                SELECT GROUP_CONCAT(m.member_name, ', ')
                FROM xref_photocard_members xpm
                JOIN lkup_photocard_members m ON xpm.member_id = m.member_id
                WHERE xpm.item_id = i.item_id
                ORDER BY m.member_id
            ),
            ''
        ) AS members,
        MAX(CASE WHEN a.attachment_type = 'front' THEN a.file_path END) AS front_image_path,
        MAX(CASE WHEN a.attachment_type = 'back' THEN a.file_path END) AS back_image_path,
        p.is_special
    FROM tbl_items i
    JOIN tbl_photocard_details p
        ON i.item_id = p.item_id
    JOIN lkup_top_level_categories c
        ON i.top_level_category_id = c.top_level_category_id
    JOIN lkup_ownership_statuses os
        ON i.ownership_status_id = os.ownership_status_id
    JOIN lkup_photocard_groups g
        ON p.group_id = g.group_id
    LEFT JOIN lkup_photocard_source_origins so
        ON p.source_origin_id = so.source_origin_id
    LEFT JOIN tbl_attachments a
        ON i.item_id = a.item_id
    WHERE i.collection_type_id = 1
"""

_PHOTOCARD_GROUP_BY = """
    GROUP BY
        i.item_id,
        g.group_id,
        g.group_name,
        i.top_level_category_id,
        c.category_name,
        i.ownership_status_id,
        os.status_name,
        i.notes,
        p.source_origin_id,
        so.source_origin_name,
        p.version,
        p.is_special
"""


# ---------- Routes ----------

@app.get("/health")
def health():
    return {"status": "ok", "app": "CollectCore API"}


# --- Lookup endpoints ---

@app.get("/ownership-statuses")
def get_ownership_statuses():
    db = SessionLocal()
    try:
        result = db.execute(text("""
            SELECT ownership_status_id, status_name, sort_order
            FROM lkup_ownership_statuses
            WHERE is_active = 1
            ORDER BY sort_order
        """)).fetchall()
        return [
            {
                "ownership_status_id": row[0],
                "status_name": row[1],
                "sort_order": row[2],
            }
            for row in result
        ]
    finally:
        db.close()


@app.get("/categories")
def get_top_level_categories(collection_type_id: Optional[int] = None, collection_type_code: Optional[str] = None):
    db = SessionLocal()
    try:
        if collection_type_code:
            result = db.execute(
                text("""
                    SELECT ltc.top_level_category_id, ltc.category_name
                    FROM lkup_top_level_categories ltc
                    JOIN lkup_collection_types ct ON ltc.collection_type_id = ct.collection_type_id
                    WHERE ct.collection_type_code = :code
                    ORDER BY ltc.sort_order
                """),
                {"code": collection_type_code},
            ).fetchall()
        else:
            result = db.execute(
                text("""
                    SELECT top_level_category_id, category_name
                    FROM lkup_top_level_categories
                    WHERE collection_type_id = :collection_type_id
                    ORDER BY sort_order
                """),
                {"collection_type_id": collection_type_id},
            ).fetchall()
        return [
            {
                "top_level_category_id": row[0],
                "category_name": row[1],
            }
            for row in result
        ]
    finally:
        db.close()


@app.get("/photocards/groups")
def get_photocard_groups():
    db = SessionLocal()
    try:
        result = db.execute(text("""
            SELECT group_id, group_code, group_name
            FROM lkup_photocard_groups
            ORDER BY sort_order
        """)).fetchall()
        return [
            {
                "group_id": row[0],
                "group_code": row[1],
                "group_name": row[2],
            }
            for row in result
        ]
    finally:
        db.close()


@app.get("/photocards/groups/{group_id}/members")
def get_photocard_members(group_id: int):
    db = SessionLocal()
    try:
        result = db.execute(
            text("""
                SELECT member_id, member_code, member_name
                FROM lkup_photocard_members
                WHERE group_id = :group_id
                ORDER BY sort_order
            """),
            {"group_id": group_id},
        ).fetchall()
        return [
            {
                "member_id": row[0],
                "member_code": row[1],
                "member_name": row[2],
            }
            for row in result
        ]
    finally:
        db.close()


@app.get("/photocards/source-origins")
def get_source_origins(group_id: int, category_id: int):
    db = SessionLocal()
    try:
        result = db.execute(
            text("""
                SELECT source_origin_id, source_origin_name
                FROM lkup_photocard_source_origins
                WHERE group_id = :group_id
                  AND top_level_category_id = :category_id
                ORDER BY sort_order, source_origin_name
            """),
            {
                "group_id": group_id,
                "category_id": category_id,
            },
        ).fetchall()
        return [
            {
                "source_origin_id": row[0],
                "source_origin_name": row[1],
            }
            for row in result
        ]
    finally:
        db.close()


# --- Pydantic models ---

class SourceOriginCreate(BaseModel):
    group_id: int
    top_level_category_id: int
    source_origin_name: str


class PhotocardCreate(BaseModel):
    collection_type_id: int
    top_level_category_id: int
    ownership_status_id: int
    notes: Optional[str] = None
    group_id: int
    source_origin_id: Optional[int] = None
    version: Optional[str] = None
    member_ids: List[int]
    is_special: bool = False


class PhotocardUpdate(BaseModel):
    top_level_category_id: int
    ownership_status_id: int
    notes: Optional[str] = None
    source_origin_id: Optional[int] = None
    version: Optional[str] = None
    member_ids: List[int]
    is_special: bool = False


class BulkUpdateFields(BaseModel):
    ownership_status_id: Optional[int] = None
    notes: Optional[str] = None
    notes_action: Optional[str] = None  # "set" | "append" | "clear"
    source_origin_id: Optional[int] = None
    version: Optional[str] = None
    member_ids: Optional[List[int]] = None
    top_level_category_id: Optional[int] = None
    is_special: Optional[bool] = None


class BulkUpdatePayload(BaseModel):
    item_ids: List[int]
    fields: BulkUpdateFields


# --- Source origins CRUD ---

@app.post("/photocards/source-origins")
def create_source_origin(payload: SourceOriginCreate):
    db = SessionLocal()
    try:
        clean_name = payload.source_origin_name.strip()

        if not clean_name:
            raise HTTPException(
                status_code=400,
                detail="Source origin name cannot be blank.",
            )

        existing = db.execute(
            text("""
                SELECT source_origin_id
                FROM lkup_photocard_source_origins
                WHERE group_id = :group_id
                  AND top_level_category_id = :top_level_category_id
                  AND LOWER(TRIM(source_origin_name)) = LOWER(TRIM(:source_origin_name))
            """),
            {
                "group_id": payload.group_id,
                "top_level_category_id": payload.top_level_category_id,
                "source_origin_name": clean_name,
            },
        ).fetchone()

        if existing:
            raise HTTPException(
                status_code=409,
                detail="That source origin already exists for this group and category.",
            )

        result = db.execute(
            text("""
                INSERT INTO lkup_photocard_source_origins (
                    group_id,
                    top_level_category_id,
                    source_origin_name
                )
                VALUES (
                    :group_id,
                    :top_level_category_id,
                    :source_origin_name
                )
                RETURNING source_origin_id
            """),
            {
                "group_id": payload.group_id,
                "top_level_category_id": payload.top_level_category_id,
                "source_origin_name": clean_name,
            },
        ).fetchone()

        source_origin_id = result[0]
        db.commit()

        return {
            "source_origin_id": source_origin_id,
            "group_id": payload.group_id,
            "top_level_category_id": payload.top_level_category_id,
            "source_origin_name": clean_name,
            "status": "created",
        }
    except HTTPException:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


# --- Photocard CRUD ---

@app.get("/photocards")
def list_photocards():
    db = SessionLocal()
    try:
        result = db.execute(
            text(_PHOTOCARD_SELECT + _PHOTOCARD_GROUP_BY + " ORDER BY i.item_id")
        ).fetchall()
        return [_photocard_row_to_dict(row) for row in result]
    finally:
        db.close()


@app.get("/photocards/{item_id}")
def get_photocard(item_id: int):
    db = SessionLocal()
    try:
        row = db.execute(
            text(
                _PHOTOCARD_SELECT
                + " AND i.item_id = :item_id"
                + _PHOTOCARD_GROUP_BY
            ),
            {"item_id": item_id},
        ).fetchone()

        if not row:
            raise HTTPException(status_code=404, detail="Photocard not found.")

        return _photocard_row_to_dict(row)
    finally:
        db.close()


@app.post("/photocards")
def create_photocard(payload: PhotocardCreate):
    db = SessionLocal()
    try:
        item_result = db.execute(
            text("""
                INSERT INTO tbl_items (
                    collection_type_id,
                    top_level_category_id,
                    ownership_status_id,
                    notes
                )
                VALUES (
                    :collection_type_id,
                    :top_level_category_id,
                    :ownership_status_id,
                    :notes
                )
                RETURNING item_id
            """),
            {
                "collection_type_id": payload.collection_type_id,
                "top_level_category_id": payload.top_level_category_id,
                "ownership_status_id": payload.ownership_status_id,
                "notes": payload.notes,
            },
        ).fetchone()

        item_id = item_result[0]

        db.execute(
            text("""
                INSERT INTO tbl_photocard_details (
                    item_id,
                    group_id,
                    source_origin_id,
                    version,
                    is_special
                )
                VALUES (
                    :item_id,
                    :group_id,
                    :source_origin_id,
                    :version,
                    :is_special
                )
            """),
            {
                "item_id": item_id,
                "group_id": payload.group_id,
                "source_origin_id": payload.source_origin_id,
                "version": payload.version,
                "is_special": 1 if payload.is_special else 0,
            },
        )

        for member_id in payload.member_ids:
            db.execute(
                text("""
                    INSERT INTO xref_photocard_members (item_id, member_id)
                    VALUES (:item_id, :member_id)
                """),
                {"item_id": item_id, "member_id": member_id},
            )

        db.commit()

        return {"item_id": item_id, "status": "created"}
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


@app.put("/photocards/{item_id}")
def update_photocard(item_id: int, payload: PhotocardUpdate):
    db = SessionLocal()
    try:
        existing = db.execute(
            text("SELECT item_id FROM tbl_items WHERE item_id = :item_id AND collection_type_id = 1"),
            {"item_id": item_id},
        ).fetchone()

        if not existing:
            raise HTTPException(status_code=404, detail="Photocard not found.")

        db.execute(
            text("""
                UPDATE tbl_items
                SET top_level_category_id = :top_level_category_id,
                    ownership_status_id = :ownership_status_id,
                    notes = :notes,
                    updated_at = CURRENT_TIMESTAMP
                WHERE item_id = :item_id
            """),
            {
                "item_id": item_id,
                "top_level_category_id": payload.top_level_category_id,
                "ownership_status_id": payload.ownership_status_id,
                "notes": payload.notes,
            },
        )

        db.execute(
            text("""
                UPDATE tbl_photocard_details
                SET source_origin_id = :source_origin_id,
                    version = :version,
                    is_special = :is_special
                WHERE item_id = :item_id
            """),
            {
                "item_id": item_id,
                "source_origin_id": payload.source_origin_id,
                "version": payload.version,
                "is_special": 1 if payload.is_special else 0,
            },
        )

        db.execute(
            text("DELETE FROM xref_photocard_members WHERE item_id = :item_id"),
            {"item_id": item_id},
        )

        for member_id in payload.member_ids:
            db.execute(
                text("""
                    INSERT INTO xref_photocard_members (item_id, member_id)
                    VALUES (:item_id, :member_id)
                """),
                {"item_id": item_id, "member_id": member_id},
            )

        db.commit()

        return {"item_id": item_id, "status": "updated"}
    except HTTPException:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


@app.delete("/photocards/{item_id}")
def delete_photocard(item_id: int):
    db = SessionLocal()
    try:
        existing = db.execute(
            text("SELECT item_id FROM tbl_items WHERE item_id = :item_id AND collection_type_id = 1"),
            {"item_id": item_id},
        ).fetchone()

        if not existing:
            raise HTTPException(status_code=404, detail="Photocard not found.")

        files_to_delete = _delete_attachment_files(db, item_id)
        db.execute(
            text("DELETE FROM xref_photocard_members WHERE item_id = :item_id"),
            {"item_id": item_id},
        )
        db.execute(
            text("DELETE FROM tbl_attachments WHERE item_id = :item_id"),
            {"item_id": item_id},
        )
        db.execute(
            text("DELETE FROM tbl_photocard_details WHERE item_id = :item_id"),
            {"item_id": item_id},
        )
        db.execute(
            text("DELETE FROM tbl_items WHERE item_id = :item_id"),
            {"item_id": item_id},
        )

        db.commit()
        _remove_files(files_to_delete)

        return {"item_id": item_id, "status": "deleted"}
    except HTTPException:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


@app.patch("/photocards/bulk")
def bulk_update_photocards(payload: BulkUpdatePayload):
    if not payload.item_ids:
        raise HTTPException(status_code=400, detail="item_ids cannot be empty.")

    db = SessionLocal()
    try:
        # Verify all items exist and are photocards
        placeholders = ",".join(str(i) for i in payload.item_ids)
        found = db.execute(
            text(f"""
                SELECT item_id FROM tbl_items
                WHERE item_id IN ({placeholders})
                  AND collection_type_id = 1
            """)
        ).fetchall()

        if len(found) != len(payload.item_ids):
            raise HTTPException(status_code=404, detail="One or more item_ids not found.")

        f = payload.fields

        # Update tbl_items fields
        items_updates = []
        items_params = {}

        if f.ownership_status_id is not None:
            items_updates.append("ownership_status_id = :ownership_status_id")
            items_params["ownership_status_id"] = f.ownership_status_id

        if f.top_level_category_id is not None:
            items_updates.append("top_level_category_id = :top_level_category_id")
            items_params["top_level_category_id"] = f.top_level_category_id

        if f.notes_action == "clear":
            items_updates.append("notes = NULL")
        elif f.notes_action == "set" and f.notes is not None:
            items_updates.append("notes = :notes")
            items_params["notes"] = f.notes
        elif f.notes_action == "append" and f.notes is not None:
            items_updates.append("notes = CASE WHEN notes IS NULL OR notes = '' THEN :notes ELSE notes || ' ' || :notes END")
            items_params["notes"] = f.notes

        if items_updates:
            items_updates.append("updated_at = CURRENT_TIMESTAMP")
            for item_id in payload.item_ids:
                db.execute(
                    text(f"UPDATE tbl_items SET {', '.join(items_updates)} WHERE item_id = :item_id"),
                    {**items_params, "item_id": item_id},
                )

        # Update tbl_photocard_details fields
        details_updates = []
        details_params = {}

        if f.source_origin_id is not None:
            details_updates.append("source_origin_id = :source_origin_id")
            details_params["source_origin_id"] = f.source_origin_id if f.source_origin_id > 0 else None

        if f.version is not None:
            details_updates.append("version = :version")
            details_params["version"] = f.version

        if f.is_special is not None:
            details_updates.append("is_special = :is_special")
            details_params["is_special"] = 1 if f.is_special else 0

        if details_updates:
            for item_id in payload.item_ids:
                db.execute(
                    text(f"UPDATE tbl_photocard_details SET {', '.join(details_updates)} WHERE item_id = :item_id"),
                    {**details_params, "item_id": item_id},
                )

        # Replace member associations
        if f.member_ids is not None:
            for item_id in payload.item_ids:
                db.execute(
                    text("DELETE FROM xref_photocard_members WHERE item_id = :item_id"),
                    {"item_id": item_id},
                )
                for member_id in f.member_ids:
                    db.execute(
                        text("""
                            INSERT INTO xref_photocard_members (item_id, member_id)
                            VALUES (:item_id, :member_id)
                        """),
                        {"item_id": item_id, "member_id": member_id},
                    )

        db.commit()

        return {"item_ids": payload.item_ids, "status": "updated", "count": len(payload.item_ids)}
    except HTTPException:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


class BulkDeletePayload(BaseModel):
    item_ids: List[int]


@app.post("/photocards/bulk-delete")
def bulk_delete_photocards(payload: BulkDeletePayload):
    if not payload.item_ids:
        raise HTTPException(status_code=400, detail="item_ids cannot be empty.")

    db = SessionLocal()
    try:
        placeholders = ",".join(str(i) for i in payload.item_ids)
        found = db.execute(
            text(f"SELECT item_id FROM tbl_items WHERE item_id IN ({placeholders}) AND collection_type_id = 1")
        ).fetchall()

        if len(found) != len(payload.item_ids):
            raise HTTPException(status_code=404, detail="One or more item_ids not found.")

        all_files = []
        for item_id in payload.item_ids:
            all_files.extend(_delete_attachment_files(db, item_id))
            db.execute(text("DELETE FROM xref_photocard_members WHERE item_id = :id"), {"id": item_id})
            db.execute(text("DELETE FROM tbl_attachments WHERE item_id = :id"), {"id": item_id})
            db.execute(text("DELETE FROM tbl_photocard_details WHERE item_id = :id"), {"id": item_id})
            db.execute(text("DELETE FROM tbl_items WHERE item_id = :id"), {"id": item_id})

        db.commit()
        _remove_files(all_files)
        return {"deleted": payload.item_ids, "count": len(payload.item_ids)}
    except HTTPException:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


# ---------- Books ----------

BOOK_COLLECTION_TYPE_ID = _resolve_collection_type_id("book", 2)


# --- Books Pydantic models ---

class BookGenreInput(BaseModel):
    top_level_genre_id: int
    sub_genre_id: Optional[int] = None


class BookBulkUpdateFields(BaseModel):
    ownership_status_id: Optional[int] = None
    reading_status_id: Optional[int] = None
    top_level_category_id: Optional[int] = None
    age_level_id: Optional[int] = None
    star_rating: Optional[float] = None
    format_detail_id: Optional[int] = None
    genres: Optional[List[BookGenreInput]] = None


class BookBulkUpdatePayload(BaseModel):
    item_ids: List[int]
    fields: BookBulkUpdateFields


class BookCreate(BaseModel):
    top_level_category_id: int
    ownership_status_id: int
    reading_status_id: Optional[int] = None
    notes: Optional[str] = None
    title: str
    description: Optional[str] = None
    age_level_id: Optional[int] = None
    star_rating: Optional[float] = None
    review: Optional[str] = None
    api_categories_raw: Optional[str] = None
    author_names: List[str]
    series_name: Optional[str] = None
    series_number: Optional[float] = None
    genres: Optional[List[BookGenreInput]] = None
    tag_names: Optional[List[str]] = None
    format_detail_id: Optional[int] = None
    isbn_13: Optional[str] = None
    isbn_10: Optional[str] = None
    publisher: Optional[str] = None
    published_date: Optional[str] = None
    page_count: Optional[int] = None
    language: Optional[str] = "en"
    cover_image_url: Optional[str] = None
    api_source: Optional[str] = None
    external_work_id: Optional[str] = None


class BookUpdate(BaseModel):
    top_level_category_id: int
    ownership_status_id: int
    reading_status_id: Optional[int] = None
    notes: Optional[str] = None
    title: str
    description: Optional[str] = None
    age_level_id: Optional[int] = None
    star_rating: Optional[float] = None
    review: Optional[str] = None
    api_categories_raw: Optional[str] = None
    author_names: List[str]
    series_name: Optional[str] = None
    series_number: Optional[float] = None
    genres: Optional[List[BookGenreInput]] = None
    tag_names: Optional[List[str]] = None
    format_detail_id: Optional[int] = None
    isbn_13: Optional[str] = None
    isbn_10: Optional[str] = None
    publisher: Optional[str] = None
    published_date: Optional[str] = None
    page_count: Optional[int] = None
    language: Optional[str] = "en"
    cover_image_url: Optional[str] = None
    api_source: Optional[str] = None
    external_work_id: Optional[str] = None


# --- Books helpers ---

def _make_title_sort(title: str) -> str:
    for article in ("The ", "A ", "An "):
        if title.startswith(article):
            return title[len(article):]
    return title


def _upsert_author(db, author_name: str) -> int:
    clean = author_name.strip()
    existing = db.execute(
        text("SELECT author_id FROM lkup_book_authors WHERE LOWER(TRIM(author_name)) = LOWER(TRIM(:name))"),
        {"name": clean},
    ).fetchone()
    if existing:
        return existing[0]
    result = db.execute(
        text("INSERT INTO lkup_book_authors (author_name) VALUES (:name) RETURNING author_id"),
        {"name": clean},
    ).fetchone()
    return result[0]


def _upsert_series(db, series_name: str) -> int:
    clean = series_name.strip()
    existing = db.execute(
        text("SELECT series_id FROM tbl_book_series WHERE LOWER(TRIM(series_name)) = LOWER(TRIM(:name))"),
        {"name": clean},
    ).fetchone()
    if existing:
        return existing[0]
    result = db.execute(
        text("INSERT INTO tbl_book_series (series_name) VALUES (:name) RETURNING series_id"),
        {"name": clean},
    ).fetchone()
    return result[0]


def _upsert_tag(db, tag_name: str) -> int:
    clean = tag_name.strip()
    existing = db.execute(
        text("SELECT tag_id FROM lkup_book_tags WHERE LOWER(TRIM(tag_name)) = LOWER(TRIM(:name))"),
        {"name": clean},
    ).fetchone()
    if existing:
        return existing[0]
    result = db.execute(
        text("INSERT INTO lkup_book_tags (tag_name) VALUES (:name) RETURNING tag_id"),
        {"name": clean},
    ).fetchone()
    return result[0]


def _insert_book_relationships(db, item_id: int, payload) -> None:
    """Insert all xref relationships and copy for a book. Caller clears existing rows first on update."""
    for order, name in enumerate(payload.author_names, start=1):
        if name.strip():
            author_id = _upsert_author(db, name)
            db.execute(
                text("""
                    INSERT OR IGNORE INTO xref_book_item_authors (item_id, author_id, author_order)
                    VALUES (:item_id, :author_id, :order)
                """),
                {"item_id": item_id, "author_id": author_id, "order": order},
            )

    if payload.series_name and payload.series_name.strip():
        series_id = _upsert_series(db, payload.series_name)
        db.execute(
            text("""
                INSERT OR IGNORE INTO xref_book_item_series (item_id, series_id, series_number)
                VALUES (:item_id, :series_id, :series_number)
            """),
            {"item_id": item_id, "series_id": series_id, "series_number": payload.series_number},
        )

    if payload.genres:
        for g in payload.genres:
            db.execute(
                text("""
                    INSERT OR IGNORE INTO xref_book_item_genres (item_id, top_level_genre_id, sub_genre_id)
                    VALUES (:item_id, :top_level_genre_id, :sub_genre_id)
                """),
                {"item_id": item_id, "top_level_genre_id": g.top_level_genre_id, "sub_genre_id": g.sub_genre_id},
            )

    if payload.tag_names:
        for name in payload.tag_names:
            if name.strip():
                tag_id = _upsert_tag(db, name)
                db.execute(
                    text("""
                        INSERT OR IGNORE INTO xref_book_item_tags (item_id, tag_id)
                        VALUES (:item_id, :tag_id)
                    """),
                    {"item_id": item_id, "tag_id": tag_id},
                )

    if payload.format_detail_id is not None:
        db.execute(
            text("""
                INSERT INTO tbl_book_copies (
                    item_id, format_detail_id, isbn_13, isbn_10, publisher,
                    published_date, page_count, language, cover_image_url,
                    api_source, external_work_id
                ) VALUES (
                    :item_id, :format_detail_id, :isbn_13, :isbn_10, :publisher,
                    :published_date, :page_count, :language, :cover_image_url,
                    :api_source, :external_work_id
                )
            """),
            {
                "item_id": item_id,
                "format_detail_id": payload.format_detail_id,
                "isbn_13": payload.isbn_13,
                "isbn_10": payload.isbn_10,
                "publisher": payload.publisher,
                "published_date": payload.published_date,
                "page_count": payload.page_count,
                "language": payload.language,
                "cover_image_url": payload.cover_image_url,
                "api_source": payload.api_source,
                "external_work_id": payload.external_work_id,
            },
        )


def _get_book_detail(db, item_id: int):
    """Return full detail dict for a single book, or None if not found."""
    row = db.execute(
        text("""
            SELECT
                i.item_id,
                i.top_level_category_id,
                c.category_name,
                i.ownership_status_id,
                os.status_name,
                i.reading_status_id,
                rs.status_name,
                i.notes,
                i.created_at,
                i.updated_at,
                bd.title,
                bd.title_sort,
                bd.description,
                bd.age_level_id,
                al.age_level_name,
                bd.star_rating,
                bd.review,
                bd.api_categories_raw
            FROM tbl_items i
            JOIN tbl_book_details bd ON i.item_id = bd.item_id
            JOIN lkup_top_level_categories c ON i.top_level_category_id = c.top_level_category_id
            JOIN lkup_ownership_statuses os ON i.ownership_status_id = os.ownership_status_id
            LEFT JOIN lkup_book_read_statuses rs ON i.reading_status_id = rs.read_status_id
            LEFT JOIN lkup_book_age_levels al ON bd.age_level_id = al.age_level_id
            WHERE i.item_id = :item_id AND i.collection_type_id = :ct
        """),
        {"item_id": item_id, "ct": BOOK_COLLECTION_TYPE_ID},
    ).fetchone()

    if not row:
        return None

    authors = db.execute(
        text("""
            SELECT la.author_id, la.author_name, xa.author_order
            FROM xref_book_item_authors xa
            JOIN lkup_book_authors la ON xa.author_id = la.author_id
            WHERE xa.item_id = :item_id
            ORDER BY xa.author_order
        """),
        {"item_id": item_id},
    ).fetchall()

    series = db.execute(
        text("""
            SELECT ts.series_id, ts.series_name, xs.series_number
            FROM xref_book_item_series xs
            JOIN tbl_book_series ts ON xs.series_id = ts.series_id
            WHERE xs.item_id = :item_id
        """),
        {"item_id": item_id},
    ).fetchall()

    genres = db.execute(
        text("""
            SELECT xg.top_level_genre_id, tg.genre_name, xg.sub_genre_id, sg.sub_genre_name
            FROM xref_book_item_genres xg
            JOIN lkup_book_top_level_genres tg ON xg.top_level_genre_id = tg.top_level_genre_id
            LEFT JOIN lkup_book_sub_genres sg ON xg.sub_genre_id = sg.sub_genre_id
            WHERE xg.item_id = :item_id
            ORDER BY tg.genre_name, sg.sub_genre_name
        """),
        {"item_id": item_id},
    ).fetchall()

    tags = db.execute(
        text("""
            SELECT lt.tag_id, lt.tag_name
            FROM xref_book_item_tags xt
            JOIN lkup_book_tags lt ON xt.tag_id = lt.tag_id
            WHERE xt.item_id = :item_id
            ORDER BY lt.tag_name
        """),
        {"item_id": item_id},
    ).fetchall()

    copies = db.execute(
        text("""
            SELECT bc.copy_id, bc.format_detail_id, fd.format_name, fd.top_level_format,
                   bc.isbn_13, bc.isbn_10, bc.publisher, bc.published_date,
                   bc.page_count, bc.language, bc.cover_image_url, bc.notes,
                   bc.api_source, bc.external_work_id
            FROM tbl_book_copies bc
            JOIN lkup_book_format_details fd ON bc.format_detail_id = fd.format_detail_id
            WHERE bc.item_id = :item_id
            ORDER BY bc.copy_id
        """),
        {"item_id": item_id},
    ).fetchall()

    return {
        "item_id": row[0],
        "top_level_category_id": row[1],
        "category": row[2],
        "ownership_status_id": row[3],
        "ownership_status": row[4],
        "reading_status_id": row[5],
        "reading_status": row[6],
        "notes": row[7],
        "created_at": row[8],
        "updated_at": row[9],
        "title": row[10],
        "title_sort": row[11],
        "description": row[12],
        "age_level_id": row[13],
        "age_level": row[14],
        "star_rating": row[15],
        "review": row[16],
        "api_categories_raw": row[17],
        "authors": [{"author_id": a[0], "author_name": a[1], "author_order": a[2]} for a in authors],
        "series": [{"series_id": s[0], "series_name": s[1], "series_number": s[2]} for s in series],
        "genres": [
            {
                "top_level_genre_id": g[0],
                "genre_name": g[1],
                "sub_genre_id": g[2],
                "sub_genre_name": g[3],
            }
            for g in genres
        ],
        "tags": [{"tag_id": t[0], "tag_name": t[1]} for t in tags],
        "copies": [
            {
                "copy_id": c[0],
                "format_detail_id": c[1],
                "format_name": c[2],
                "top_level_format": c[3],
                "isbn_13": c[4],
                "isbn_10": c[5],
                "publisher": c[6],
                "published_date": c[7],
                "page_count": c[8],
                "language": c[9],
                "cover_image_url": c[10],
                "notes": c[11],
                "api_source": c[12],
                "external_work_id": c[13],
            }
            for c in copies
        ],
    }


# --- Books lookup endpoints ---
# NOTE: specific paths (/genres, /format-details, etc.) must appear before /{item_id}

@app.get("/books/genres")
def get_book_genres(category_scope_id: Optional[int] = None):
    db = SessionLocal()
    try:
        query = """
            SELECT g.top_level_genre_id, g.genre_name, g.category_scope_id,
                   s.sub_genre_id, s.sub_genre_name
            FROM lkup_book_top_level_genres g
            LEFT JOIN lkup_book_sub_genres s
                ON g.top_level_genre_id = s.top_level_genre_id AND s.is_active = 1
            WHERE g.is_active = 1
        """
        params = {}
        if category_scope_id is not None:
            query += " AND g.category_scope_id = :category_scope_id"
            params["category_scope_id"] = category_scope_id
        query += " ORDER BY g.sort_order, g.genre_name, s.sort_order, s.sub_genre_name"

        rows = db.execute(text(query), params).fetchall()

        genres: dict = {}
        for row in rows:
            gid = row[0]
            if gid not in genres:
                genres[gid] = {
                    "top_level_genre_id": row[0],
                    "genre_name": row[1],
                    "category_scope_id": row[2],
                    "sub_genres": [],
                }
            if row[3] is not None:
                genres[gid]["sub_genres"].append({
                    "sub_genre_id": row[3],
                    "sub_genre_name": row[4],
                })

        return list(genres.values())
    finally:
        db.close()


@app.get("/books/format-details")
def get_book_format_details():
    db = SessionLocal()
    try:
        rows = db.execute(text("""
            SELECT format_detail_id, format_name, top_level_format, sort_order
            FROM lkup_book_format_details
            WHERE is_active = 1
            ORDER BY top_level_format, sort_order, format_name
        """)).fetchall()
        return [
            {
                "format_detail_id": row[0],
                "format_name": row[1],
                "top_level_format": row[2],
            }
            for row in rows
        ]
    finally:
        db.close()


@app.get("/books/age-levels")
def get_book_age_levels():
    db = SessionLocal()
    try:
        rows = db.execute(text("""
            SELECT age_level_id, age_level_name
            FROM lkup_book_age_levels
            WHERE is_active = 1
            ORDER BY sort_order
        """)).fetchall()
        return [{"age_level_id": row[0], "age_level_name": row[1]} for row in rows]
    finally:
        db.close()


@app.get("/books/read-statuses")
def get_book_read_statuses():
    db = SessionLocal()
    try:
        rows = db.execute(text("""
            SELECT read_status_id, status_name
            FROM lkup_book_read_statuses
            WHERE is_active = 1
            ORDER BY sort_order
        """)).fetchall()
        return [{"read_status_id": row[0], "status_name": row[1]} for row in rows]
    finally:
        db.close()


@app.get("/books/authors")
def get_book_authors(q: Optional[str] = None):
    db = SessionLocal()
    try:
        if q:
            rows = db.execute(
                text("""
                    SELECT author_id, author_name
                    FROM lkup_book_authors
                    WHERE is_active = 1 AND LOWER(author_name) LIKE LOWER(:q)
                    ORDER BY author_name
                    LIMIT 20
                """),
                {"q": f"%{q}%"},
            ).fetchall()
        else:
            rows = db.execute(text("""
                SELECT author_id, author_name
                FROM lkup_book_authors
                WHERE is_active = 1
                ORDER BY author_name
            """)).fetchall()
        return [{"author_id": row[0], "author_name": row[1]} for row in rows]
    finally:
        db.close()


@app.get("/books/series")
def get_book_series(q: Optional[str] = None):
    db = SessionLocal()
    try:
        if q:
            rows = db.execute(
                text("""
                    SELECT series_id, series_name
                    FROM tbl_book_series
                    WHERE is_active = 1 AND LOWER(series_name) LIKE LOWER(:q)
                    ORDER BY series_name
                    LIMIT 20
                """),
                {"q": f"%{q}%"},
            ).fetchall()
        else:
            rows = db.execute(text("""
                SELECT series_id, series_name
                FROM tbl_book_series
                WHERE is_active = 1
                ORDER BY series_name
            """)).fetchall()
        return [{"series_id": row[0], "series_name": row[1]} for row in rows]
    finally:
        db.close()


@app.get("/books/tags")
def get_book_tags(q: Optional[str] = None):
    db = SessionLocal()
    try:
        if q:
            rows = db.execute(
                text("""
                    SELECT tag_id, tag_name
                    FROM lkup_book_tags
                    WHERE is_active = 1 AND LOWER(tag_name) LIKE LOWER(:q)
                    ORDER BY tag_name
                    LIMIT 20
                """),
                {"q": f"%{q}%"},
            ).fetchall()
        else:
            rows = db.execute(text("""
                SELECT tag_id, tag_name
                FROM lkup_book_tags
                WHERE is_active = 1
                ORDER BY tag_name
            """)).fetchall()
        return [{"tag_id": row[0], "tag_name": row[1]} for row in rows]
    finally:
        db.close()


# --- External book search ---

def _normalize_google_book(volume: dict) -> dict:
    info = volume.get("volumeInfo", {})
    isbns = {i["type"]: i["identifier"] for i in info.get("industryIdentifiers", [])}
    image_links = info.get("imageLinks", {})
    raw_cover = image_links.get("thumbnail") or image_links.get("smallThumbnail")
    cover = raw_cover.replace("http://", "https://") if raw_cover else None
    return {
        "title": info.get("title"),
        "author_names": info.get("authors", []),
        "isbn_10": isbns.get("ISBN_10"),
        "isbn_13": isbns.get("ISBN_13"),
        "publisher": info.get("publisher"),
        "published_date": info.get("publishedDate"),
        "page_count": info.get("pageCount"),
        "language": info.get("language"),
        "description": info.get("description"),
        "cover_image_url": cover,
        "api_source": "google_books",
        "external_work_id": volume.get("id"),
        "api_categories_raw": ", ".join(info.get("categories", [])) or None,
        "_raw": {
            "volumeInfo": info,
            "saleInfo": volume.get("saleInfo"),
            "accessInfo": volume.get("accessInfo"),
        },
    }


@app.get("/books/search-external")
def search_external_books(q: str = Query(..., min_length=1)):
    encoded = urllib.parse.quote(q)
    url = f"https://www.googleapis.com/books/v1/volumes?q={encoded}&maxResults=10"
    try:
        with urllib.request.urlopen(url, timeout=6) as resp:
            data = json.loads(resp.read())
        return [_normalize_google_book(v) for v in data.get("items", [])]
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"External search failed: {e}")


@app.get("/books/lookup-isbn")
def lookup_isbn(isbn: str = Query(..., min_length=10)):
    encoded = urllib.parse.quote(f"isbn:{isbn}")
    url = f"https://www.googleapis.com/books/v1/volumes?q={encoded}&maxResults=1"
    try:
        with urllib.request.urlopen(url, timeout=6) as resp:
            data = json.loads(resp.read())
        items = data.get("items", [])
        if not items:
            return None
        return _normalize_google_book(items[0])
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"ISBN lookup failed: {e}")


# --- Books CRUD ---

@app.get("/books")
def list_books():
    db = SessionLocal()
    try:
        rows = db.execute(
            text("""
                SELECT
                    i.item_id,
                    i.top_level_category_id,
                    c.category_name,
                    i.ownership_status_id,
                    os.status_name,
                    i.reading_status_id,
                    rs.status_name,
                    i.notes,
                    bd.title,
                    bd.title_sort,
                    bd.star_rating,
                    al.age_level_name,
                    bd.age_level_id,
                    (SELECT GROUP_CONCAT(la.author_name, ', ')
                     FROM xref_book_item_authors xa
                     JOIN lkup_book_authors la ON xa.author_id = la.author_id
                     WHERE xa.item_id = i.item_id) AS authors_str,
                    (SELECT ts.series_name FROM xref_book_item_series xs
                     JOIN tbl_book_series ts ON xs.series_id = ts.series_id
                     WHERE xs.item_id = i.item_id LIMIT 1) AS series_name,
                    (SELECT xs.series_number FROM xref_book_item_series xs
                     WHERE xs.item_id = i.item_id LIMIT 1) AS series_number,
                    (SELECT bc.cover_image_url FROM tbl_book_copies bc
                     WHERE bc.item_id = i.item_id AND bc.cover_image_url IS NOT NULL LIMIT 1) AS cover_image_url,
                    (SELECT bc.isbn_13 FROM tbl_book_copies bc
                     WHERE bc.item_id = i.item_id AND bc.isbn_13 IS NOT NULL LIMIT 1) AS isbn_13,
                    (SELECT GROUP_CONCAT(lfd.format_name || '|' || lfd.top_level_format, '|||')
                     FROM tbl_book_copies bc2
                     JOIN lkup_book_format_details lfd ON bc2.format_detail_id = lfd.format_detail_id
                     WHERE bc2.item_id = i.item_id) AS formats_str,
                    (SELECT GROUP_CONCAT(lg.genre_name, '|||')
                     FROM xref_book_item_genres xg
                     JOIN lkup_book_top_level_genres lg ON xg.top_level_genre_id = lg.top_level_genre_id
                     WHERE xg.item_id = i.item_id) AS genres_str,
                    (SELECT GROUP_CONCAT(ls.sub_genre_name, '|||')
                     FROM xref_book_item_genres xg2
                     JOIN lkup_book_sub_genres ls ON xg2.sub_genre_id = ls.sub_genre_id
                     WHERE xg2.item_id = i.item_id AND xg2.sub_genre_id IS NOT NULL) AS subgenres_str,
                    (SELECT GROUP_CONCAT(lt.tag_name, '|||')
                     FROM xref_book_item_tags xt
                     JOIN lkup_book_tags lt ON xt.tag_id = lt.tag_id
                     WHERE xt.item_id = i.item_id) AS tags_str
                FROM tbl_items i
                JOIN tbl_book_details bd ON i.item_id = bd.item_id
                JOIN lkup_top_level_categories c ON i.top_level_category_id = c.top_level_category_id
                JOIN lkup_ownership_statuses os ON i.ownership_status_id = os.ownership_status_id
                LEFT JOIN lkup_book_read_statuses rs ON i.reading_status_id = rs.read_status_id
                LEFT JOIN lkup_book_age_levels al ON bd.age_level_id = al.age_level_id
                WHERE i.collection_type_id = :ct
                ORDER BY COALESCE(bd.title_sort, bd.title)
            """),
            {"ct": BOOK_COLLECTION_TYPE_ID},
        ).fetchall()

        def parse_formats(s):
            if not s:
                return []
            result = []
            for entry in s.split("|||"):
                parts = entry.split("|", 1)
                if len(parts) == 2:
                    result.append({"format_name": parts[0], "top_level_format": parts[1]})
            return result

        def parse_list(s):
            if not s:
                return []
            seen = set()
            out = []
            for v in s.split("|||"):
                if v not in seen:
                    seen.add(v)
                    out.append(v)
            return out

        return [
            {
                "item_id": row[0],
                "top_level_category_id": row[1],
                "category": row[2],
                "ownership_status_id": row[3],
                "ownership_status": row[4],
                "reading_status_id": row[5],
                "reading_status": row[6],
                "notes": row[7],
                "title": row[8],
                "title_sort": row[9],
                "star_rating": row[10],
                "age_level": row[11],
                "age_level_id": row[12],
                "authors": row[13].split(", ") if row[13] else [],
                "series_name": row[14],
                "series_number": row[15],
                "cover_image_url": row[16],
                "isbn_13": row[17],
                "formats": parse_formats(row[18]),
                "genres": parse_list(row[19]),
                "subgenres": parse_list(row[20]),
                "tags": parse_list(row[21]),
            }
            for row in rows
        ]
    finally:
        db.close()


@app.get("/books/{item_id}")
def get_book(item_id: int):
    db = SessionLocal()
    try:
        book = _get_book_detail(db, item_id)
        if not book:
            raise HTTPException(status_code=404, detail="Book not found.")
        return book
    finally:
        db.close()


@app.post("/books")
def create_book(payload: BookCreate):
    if not payload.author_names or not any(n.strip() for n in payload.author_names):
        raise HTTPException(status_code=400, detail="At least one author name is required.")

    db = SessionLocal()
    try:
        # Soft duplicate check: same title + same primary author
        primary_author = payload.author_names[0].strip()
        dupe = db.execute(
            text("""
                SELECT i.item_id
                FROM tbl_items i
                JOIN tbl_book_details bd ON i.item_id = bd.item_id
                JOIN xref_book_item_authors xa ON i.item_id = xa.item_id
                JOIN lkup_book_authors la ON xa.author_id = la.author_id
                WHERE i.collection_type_id = :ct
                  AND LOWER(TRIM(bd.title)) = LOWER(TRIM(:title))
                  AND LOWER(TRIM(la.author_name)) = LOWER(TRIM(:author))
                  AND xa.author_order = 1
            """),
            {"ct": BOOK_COLLECTION_TYPE_ID, "title": payload.title, "author": primary_author},
        ).fetchone()

        if dupe:
            raise HTTPException(
                status_code=409,
                detail=f"A book with that title and primary author already exists (item_id={dupe[0]}).",
            )

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
                "ct": BOOK_COLLECTION_TYPE_ID,
                "cat": payload.top_level_category_id,
                "own": payload.ownership_status_id,
                "rs": payload.reading_status_id,
                "notes": payload.notes,
            },
        ).fetchone()
        item_id = item_result[0]

        db.execute(
            text("""
                INSERT INTO tbl_book_details (
                    item_id, title, title_sort, description,
                    age_level_id, star_rating, review, api_categories_raw
                )
                VALUES (
                    :item_id, :title, :title_sort, :description,
                    :age_level_id, :star_rating, :review, :api_categories_raw
                )
            """),
            {
                "item_id": item_id,
                "title": payload.title.strip(),
                "title_sort": _make_title_sort(payload.title.strip()),
                "description": payload.description,
                "age_level_id": payload.age_level_id,
                "star_rating": payload.star_rating,
                "review": payload.review,
                "api_categories_raw": payload.api_categories_raw,
            },
        )

        # Download cover locally so external URLs never go stale
        if payload.cover_image_url:
            payload.cover_image_url = _resolve_cover_url(payload.cover_image_url, "books", item_id)

        _insert_book_relationships(db, item_id, payload)
        db.commit()

        book = _get_book_detail(db, item_id)
        return {"item_id": item_id, "status": "created", "book": book}

    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        if "ux_book_copies_isbn13" in str(e) or "UNIQUE constraint failed: tbl_book_copies.isbn_13" in str(e):
            raise HTTPException(status_code=409, detail="A book with that ISBN-13 already exists.")
        raise
    finally:
        db.close()


@app.put("/books/{item_id}")
def update_book(item_id: int, payload: BookUpdate):
    if not payload.author_names or not any(n.strip() for n in payload.author_names):
        raise HTTPException(status_code=400, detail="At least one author name is required.")

    db = SessionLocal()
    try:
        existing = db.execute(
            text("SELECT item_id FROM tbl_items WHERE item_id = :id AND collection_type_id = :ct"),
            {"id": item_id, "ct": BOOK_COLLECTION_TYPE_ID},
        ).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Book not found.")

        db.execute(
            text("""
                UPDATE tbl_items
                SET top_level_category_id = :cat,
                    ownership_status_id = :own,
                    reading_status_id = :rs,
                    notes = :notes,
                    updated_at = CURRENT_TIMESTAMP
                WHERE item_id = :id
            """),
            {
                "id": item_id,
                "cat": payload.top_level_category_id,
                "own": payload.ownership_status_id,
                "rs": payload.reading_status_id,
                "notes": payload.notes,
            },
        )

        db.execute(
            text("""
                UPDATE tbl_book_details
                SET title = :title,
                    title_sort = :title_sort,
                    description = :description,
                    age_level_id = :age_level_id,
                    star_rating = :star_rating,
                    review = :review,
                    api_categories_raw = :api_categories_raw
                WHERE item_id = :id
            """),
            {
                "id": item_id,
                "title": payload.title.strip(),
                "title_sort": _make_title_sort(payload.title.strip()),
                "description": payload.description,
                "age_level_id": payload.age_level_id,
                "star_rating": payload.star_rating,
                "review": payload.review,
                "api_categories_raw": payload.api_categories_raw,
            },
        )

        # Clear all xref rows and copies, then re-insert
        db.execute(text("DELETE FROM xref_book_item_authors WHERE item_id = :id"), {"id": item_id})
        db.execute(text("DELETE FROM xref_book_item_series WHERE item_id = :id"), {"id": item_id})
        db.execute(text("DELETE FROM xref_book_item_genres WHERE item_id = :id"), {"id": item_id})
        db.execute(text("DELETE FROM xref_book_item_tags WHERE item_id = :id"), {"id": item_id})
        db.execute(text("DELETE FROM tbl_book_copies WHERE item_id = :id"), {"id": item_id})

        # Download cover locally if an external URL was provided
        if payload.cover_image_url and not payload.cover_image_url.startswith("/images/"):
            payload.cover_image_url = _resolve_cover_url(payload.cover_image_url, "books", item_id)

        _insert_book_relationships(db, item_id, payload)
        db.commit()

        book = _get_book_detail(db, item_id)
        return {"item_id": item_id, "status": "updated", "book": book}

    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        if "ux_book_copies_isbn13" in str(e) or "UNIQUE constraint failed: tbl_book_copies.isbn_13" in str(e):
            raise HTTPException(status_code=409, detail="A book with that ISBN-13 already exists.")
        raise
    finally:
        db.close()


@app.delete("/books/{item_id}")
def delete_book(item_id: int):
    db = SessionLocal()
    try:
        existing = db.execute(
            text("SELECT item_id FROM tbl_items WHERE item_id = :id AND collection_type_id = :ct"),
            {"id": item_id, "ct": BOOK_COLLECTION_TYPE_ID},
        ).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Book not found.")

        files_to_delete = _delete_attachment_files(db, item_id)
        files_to_delete.extend(_collect_cover_file(db, "tbl_book_details", item_id))
        db.execute(text("DELETE FROM xref_book_item_authors WHERE item_id = :id"), {"id": item_id})
        db.execute(text("DELETE FROM xref_book_item_series WHERE item_id = :id"), {"id": item_id})
        db.execute(text("DELETE FROM xref_book_item_genres WHERE item_id = :id"), {"id": item_id})
        db.execute(text("DELETE FROM xref_book_item_tags WHERE item_id = :id"), {"id": item_id})
        db.execute(text("DELETE FROM tbl_book_copies WHERE item_id = :id"), {"id": item_id})
        db.execute(text("DELETE FROM tbl_attachments WHERE item_id = :id"), {"id": item_id})
        db.execute(text("DELETE FROM tbl_book_details WHERE item_id = :id"), {"id": item_id})
        db.execute(text("DELETE FROM tbl_items WHERE item_id = :id"), {"id": item_id})
        db.commit()
        _remove_files(files_to_delete)

        return {"item_id": item_id, "status": "deleted"}
    except HTTPException:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


@app.patch("/books/bulk")
def bulk_update_books(payload: BookBulkUpdatePayload):
    if not payload.item_ids:
        raise HTTPException(status_code=400, detail="item_ids cannot be empty.")

    db = SessionLocal()
    try:
        placeholders = ",".join(str(i) for i in payload.item_ids)
        found = db.execute(
            text(f"SELECT item_id FROM tbl_items WHERE item_id IN ({placeholders}) AND collection_type_id = :ct"),
            {"ct": BOOK_COLLECTION_TYPE_ID},
        ).fetchall()
        if len(found) != len(payload.item_ids):
            raise HTTPException(status_code=404, detail="One or more item_ids not found.")

        f = payload.fields

        # tbl_items updates
        item_updates = []
        item_params = {}
        if f.ownership_status_id is not None:
            item_updates.append("ownership_status_id = :ownership_status_id")
            item_params["ownership_status_id"] = f.ownership_status_id
        if f.reading_status_id is not None:
            item_updates.append("reading_status_id = :reading_status_id")
            item_params["reading_status_id"] = f.reading_status_id
        if f.top_level_category_id is not None:
            item_updates.append("top_level_category_id = :top_level_category_id")
            item_params["top_level_category_id"] = f.top_level_category_id

        if item_updates:
            item_updates.append("updated_at = CURRENT_TIMESTAMP")
            for item_id in payload.item_ids:
                db.execute(
                    text(f"UPDATE tbl_items SET {', '.join(item_updates)} WHERE item_id = :item_id"),
                    {**item_params, "item_id": item_id},
                )

        # tbl_book_details updates
        detail_updates = []
        detail_params = {}
        if f.age_level_id is not None:
            detail_updates.append("age_level_id = :age_level_id")
            detail_params["age_level_id"] = f.age_level_id
        if f.star_rating is not None:
            detail_updates.append("star_rating = :star_rating")
            detail_params["star_rating"] = f.star_rating

        if detail_updates:
            for item_id in payload.item_ids:
                db.execute(
                    text(f"UPDATE tbl_book_details SET {', '.join(detail_updates)} WHERE item_id = :item_id"),
                    {**detail_params, "item_id": item_id},
                )

        # tbl_book_copies: update first copy's format_detail_id per item
        if f.format_detail_id is not None:
            for item_id in payload.item_ids:
                first_copy = db.execute(
                    text("SELECT copy_id FROM tbl_book_copies WHERE item_id = :id ORDER BY copy_id LIMIT 1"),
                    {"id": item_id},
                ).fetchone()
                if first_copy:
                    db.execute(
                        text("UPDATE tbl_book_copies SET format_detail_id = :fd WHERE copy_id = :cid"),
                        {"fd": f.format_detail_id, "cid": first_copy[0]},
                    )

        # Genre replace: delete existing and insert new
        if f.genres is not None:
            for item_id in payload.item_ids:
                db.execute(text("DELETE FROM xref_book_item_genres WHERE item_id = :id"), {"id": item_id})
                for g in f.genres:
                    db.execute(
                        text("INSERT INTO xref_book_item_genres (item_id, top_level_genre_id, sub_genre_id) VALUES (:item_id, :tg, :sg)"),
                        {"item_id": item_id, "tg": g.top_level_genre_id, "sg": g.sub_genre_id},
                    )

        db.commit()
        return {"item_ids": payload.item_ids, "status": "updated", "count": len(payload.item_ids)}
    except HTTPException:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


@app.post("/books/bulk-delete")
def bulk_delete_books(payload: BulkDeletePayload):
    if not payload.item_ids:
        raise HTTPException(status_code=400, detail="item_ids cannot be empty.")

    db = SessionLocal()
    try:
        placeholders = ",".join(str(i) for i in payload.item_ids)
        found = db.execute(
            text(f"SELECT item_id FROM tbl_items WHERE item_id IN ({placeholders}) AND collection_type_id = :ct"),
            {"ct": BOOK_COLLECTION_TYPE_ID},
        ).fetchall()
        if len(found) != len(payload.item_ids):
            raise HTTPException(status_code=404, detail="One or more item_ids not found.")

        all_files = []
        for item_id in payload.item_ids:
            all_files.extend(_delete_attachment_files(db, item_id))
            all_files.extend(_collect_cover_file(db, "tbl_book_details", item_id))
            db.execute(text("DELETE FROM xref_book_item_authors WHERE item_id = :id"), {"id": item_id})
            db.execute(text("DELETE FROM xref_book_item_series WHERE item_id = :id"), {"id": item_id})
            db.execute(text("DELETE FROM xref_book_item_genres WHERE item_id = :id"), {"id": item_id})
            db.execute(text("DELETE FROM xref_book_item_tags WHERE item_id = :id"), {"id": item_id})
            db.execute(text("DELETE FROM tbl_book_copies WHERE item_id = :id"), {"id": item_id})
            db.execute(text("DELETE FROM tbl_attachments WHERE item_id = :id"), {"id": item_id})
            db.execute(text("DELETE FROM tbl_book_details WHERE item_id = :id"), {"id": item_id})
            db.execute(text("DELETE FROM tbl_items WHERE item_id = :id"), {"id": item_id})

        db.commit()
        _remove_files(all_files)
        return {"deleted": payload.item_ids, "count": len(payload.item_ids)}
    except HTTPException:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


# ---------- Graphic Novels ----------

GN_COLLECTION_TYPE_ID = _resolve_collection_type_id("graphicnovels", 3)
VIDEOGAMES_COLLECTION_TYPE_ID = _resolve_collection_type_id("videogames", 4)
MUSIC_COLLECTION_TYPE_ID = _resolve_collection_type_id("music", 5)


# --- Graphic Novels Pydantic models ---

class GnBulkUpdateFields(BaseModel):
    ownership_status_id: Optional[int] = None
    reading_status_id: Optional[int] = None
    top_level_category_id: Optional[int] = None
    format_type_id: Optional[int] = None
    era_id: Optional[int] = None
    publisher_id: Optional[int] = None
    star_rating: Optional[float] = None


class GnBulkUpdatePayload(BaseModel):
    item_ids: List[int]
    fields: GnBulkUpdateFields


class GnSourceSeriesEntry(BaseModel):
    source_series_name: str
    start_issue: Optional[int] = None
    end_issue: Optional[int] = None


class GraphicNovelCreate(BaseModel):
    top_level_category_id: int
    ownership_status_id: int
    reading_status_id: Optional[int] = None
    notes: Optional[str] = None
    title: str
    description: Optional[str] = None
    publisher_id: Optional[int] = None
    format_type_id: Optional[int] = None
    era_id: Optional[int] = None
    series_name: Optional[str] = None
    series_number: Optional[float] = None
    source_series: Optional[List[GnSourceSeriesEntry]] = None
    issue_notes: Optional[str] = None
    page_count: Optional[int] = None
    published_date: Optional[str] = None
    isbn_13: Optional[str] = None
    isbn_10: Optional[str] = None
    cover_image_url: Optional[str] = None
    edition_notes: Optional[str] = None
    star_rating: Optional[float] = None
    review: Optional[str] = None
    writer_names: Optional[List[str]] = None
    artist_names: Optional[List[str]] = None
    tag_names: Optional[List[str]] = None
    api_source: Optional[str] = None
    external_work_id: Optional[str] = None


class GraphicNovelUpdate(BaseModel):
    top_level_category_id: int
    ownership_status_id: int
    reading_status_id: Optional[int] = None
    notes: Optional[str] = None
    title: str
    description: Optional[str] = None
    publisher_id: Optional[int] = None
    format_type_id: Optional[int] = None
    era_id: Optional[int] = None
    series_name: Optional[str] = None
    series_number: Optional[float] = None
    source_series: Optional[List[GnSourceSeriesEntry]] = None
    issue_notes: Optional[str] = None
    page_count: Optional[int] = None
    published_date: Optional[str] = None
    isbn_13: Optional[str] = None
    isbn_10: Optional[str] = None
    cover_image_url: Optional[str] = None
    edition_notes: Optional[str] = None
    star_rating: Optional[float] = None
    review: Optional[str] = None
    writer_names: Optional[List[str]] = None
    artist_names: Optional[List[str]] = None
    tag_names: Optional[List[str]] = None
    api_source: Optional[str] = None
    external_work_id: Optional[str] = None


class GnPublisherCreate(BaseModel):
    publisher_name: str


# --- Graphic Novels helpers ---

def _upsert_gn_writer(db, name: str) -> int:
    clean = name.strip()
    existing = db.execute(
        text("SELECT writer_id FROM lkup_graphicnovel_writers WHERE LOWER(TRIM(writer_name)) = LOWER(TRIM(:name))"),
        {"name": clean},
    ).fetchone()
    if existing:
        return existing[0]
    result = db.execute(
        text("INSERT INTO lkup_graphicnovel_writers (writer_name) VALUES (:name) RETURNING writer_id"),
        {"name": clean},
    ).fetchone()
    return result[0]


def _upsert_gn_artist(db, name: str) -> int:
    clean = name.strip()
    existing = db.execute(
        text("SELECT artist_id FROM lkup_graphicnovel_artists WHERE LOWER(TRIM(artist_name)) = LOWER(TRIM(:name))"),
        {"name": clean},
    ).fetchone()
    if existing:
        return existing[0]
    result = db.execute(
        text("INSERT INTO lkup_graphicnovel_artists (artist_name) VALUES (:name) RETURNING artist_id"),
        {"name": clean},
    ).fetchone()
    return result[0]


def _upsert_gn_tag(db, name: str) -> int:
    clean = name.strip()
    existing = db.execute(
        text("SELECT tag_id FROM lkup_graphicnovel_tags WHERE LOWER(TRIM(tag_name)) = LOWER(TRIM(:name))"),
        {"name": clean},
    ).fetchone()
    if existing:
        return existing[0]
    result = db.execute(
        text("INSERT INTO lkup_graphicnovel_tags (tag_name) VALUES (:name) RETURNING tag_id"),
        {"name": clean},
    ).fetchone()
    return result[0]


def _insert_gn_relationships(db, item_id: int, payload) -> None:
    if payload.writer_names:
        for order, name in enumerate(payload.writer_names, start=1):
            if name.strip():
                writer_id = _upsert_gn_writer(db, name)
                db.execute(
                    text("""
                        INSERT OR IGNORE INTO xref_graphicnovel_item_writers (item_id, writer_id, writer_order)
                        VALUES (:item_id, :writer_id, :order)
                    """),
                    {"item_id": item_id, "writer_id": writer_id, "order": order},
                )

    if payload.artist_names:
        for order, name in enumerate(payload.artist_names, start=1):
            if name.strip():
                artist_id = _upsert_gn_artist(db, name)
                db.execute(
                    text("""
                        INSERT OR IGNORE INTO xref_graphicnovel_item_artists (item_id, artist_id, artist_order)
                        VALUES (:item_id, :artist_id, :order)
                    """),
                    {"item_id": item_id, "artist_id": artist_id, "order": order},
                )

    if payload.tag_names:
        for name in payload.tag_names:
            if name.strip():
                tag_id = _upsert_gn_tag(db, name)
                db.execute(
                    text("""
                        INSERT OR IGNORE INTO xref_graphicnovel_item_tags (item_id, tag_id)
                        VALUES (:item_id, :tag_id)
                    """),
                    {"item_id": item_id, "tag_id": tag_id},
                )

    if payload.source_series:
        for order, entry in enumerate(payload.source_series, start=0):
            if entry.source_series_name.strip():
                db.execute(
                    text("""
                        INSERT INTO xref_gn_source_series (item_id, source_series_name, start_issue, end_issue, sort_order)
                        VALUES (:item_id, :name, :start, :end, :order)
                    """),
                    {
                        "item_id": item_id,
                        "name": entry.source_series_name.strip(),
                        "start": entry.start_issue,
                        "end": entry.end_issue,
                        "order": order,
                    },
                )


def _get_gn_detail(db, item_id: int):
    row = db.execute(
        text("""
            SELECT
                i.item_id,
                i.top_level_category_id,
                c.category_name,
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
                gd.publisher_id,
                pub.publisher_name,
                gd.format_type_id,
                ft.format_type_name,
                gd.era_id,
                era.era_name,
                era.era_years,
                gd.series_name,
                gd.series_number,
                gd.issue_notes,
                gd.page_count,
                gd.published_date,
                gd.isbn_13,
                gd.isbn_10,
                gd.cover_image_url,
                gd.edition_notes,
                gd.star_rating,
                gd.review,
                gd.api_source,
                gd.external_work_id
            FROM tbl_items i
            JOIN tbl_graphicnovel_details gd ON i.item_id = gd.item_id
            JOIN lkup_top_level_categories c ON i.top_level_category_id = c.top_level_category_id
            JOIN lkup_ownership_statuses os ON i.ownership_status_id = os.ownership_status_id
            LEFT JOIN lkup_book_read_statuses rs ON i.reading_status_id = rs.read_status_id
            LEFT JOIN lkup_graphicnovel_publishers pub ON gd.publisher_id = pub.publisher_id
            LEFT JOIN lkup_graphicnovel_format_types ft ON gd.format_type_id = ft.format_type_id
            LEFT JOIN lkup_graphicnovel_eras era ON gd.era_id = era.era_id
            WHERE i.item_id = :item_id AND i.collection_type_id = :ct
        """),
        {"item_id": item_id, "ct": GN_COLLECTION_TYPE_ID},
    ).fetchone()

    if not row:
        return None

    writers = db.execute(
        text("""
            SELECT lw.writer_id, lw.writer_name, xw.writer_order
            FROM xref_graphicnovel_item_writers xw
            JOIN lkup_graphicnovel_writers lw ON xw.writer_id = lw.writer_id
            WHERE xw.item_id = :item_id
            ORDER BY xw.writer_order
        """),
        {"item_id": item_id},
    ).fetchall()

    artists = db.execute(
        text("""
            SELECT la.artist_id, la.artist_name, xa.artist_order
            FROM xref_graphicnovel_item_artists xa
            JOIN lkup_graphicnovel_artists la ON xa.artist_id = la.artist_id
            WHERE xa.item_id = :item_id
            ORDER BY xa.artist_order
        """),
        {"item_id": item_id},
    ).fetchall()

    tags = db.execute(
        text("""
            SELECT lt.tag_id, lt.tag_name
            FROM xref_graphicnovel_item_tags xt
            JOIN lkup_graphicnovel_tags lt ON xt.tag_id = lt.tag_id
            WHERE xt.item_id = :item_id
            ORDER BY lt.tag_name
        """),
        {"item_id": item_id},
    ).fetchall()

    source_series = db.execute(
        text("""
            SELECT xref_id, source_series_name, start_issue, end_issue
            FROM xref_gn_source_series
            WHERE item_id = :item_id
            ORDER BY sort_order
        """),
        {"item_id": item_id},
    ).fetchall()

    return {
        "item_id": row[0],
        "top_level_category_id": row[1],
        "category": row[2],
        "ownership_status_id": row[3],
        "ownership_status": row[4],
        "reading_status_id": row[5],
        "reading_status": row[6],
        "notes": row[7],
        "created_at": row[8],
        "updated_at": row[9],
        "title": row[10],
        "title_sort": row[11],
        "description": row[12],
        "publisher_id": row[13],
        "publisher_name": row[14],
        "format_type_id": row[15],
        "format_type_name": row[16],
        "era_id": row[17],
        "era_name": row[18],
        "era_years": row[19],
        "series_name": row[20],
        "series_number": row[21],
        "issue_notes": row[22],
        "page_count": row[23],
        "published_date": row[24],
        "isbn_13": row[25],
        "isbn_10": row[26],
        "cover_image_url": row[27],
        "edition_notes": row[28],
        "star_rating": row[29],
        "review": row[30],
        "api_source": row[31],
        "external_work_id": row[32],
        "writers": [{"writer_id": w[0], "writer_name": w[1], "writer_order": w[2]} for w in writers],
        "artists": [{"artist_id": a[0], "artist_name": a[1], "artist_order": a[2]} for a in artists],
        "tags": [{"tag_id": t[0], "tag_name": t[1]} for t in tags],
        "source_series": [{"xref_id": s[0], "source_series_name": s[1], "start_issue": s[2], "end_issue": s[3]} for s in source_series],
    }


# --- Graphic Novels lookup endpoints ---
# NOTE: specific paths must appear before /{item_id}

@app.get("/graphicnovels/publishers")
def get_gn_publishers():
    db = SessionLocal()
    try:
        rows = db.execute(text("""
            SELECT publisher_id, publisher_name
            FROM lkup_graphicnovel_publishers
            WHERE is_active = 1
            ORDER BY sort_order, publisher_name
        """)).fetchall()
        return [{"publisher_id": row[0], "publisher_name": row[1]} for row in rows]
    finally:
        db.close()


@app.post("/graphicnovels/publishers")
def create_gn_publisher(payload: GnPublisherCreate):
    db = SessionLocal()
    try:
        existing = db.execute(
            text("SELECT publisher_id FROM lkup_graphicnovel_publishers WHERE LOWER(TRIM(publisher_name)) = LOWER(TRIM(:name))"),
            {"name": payload.publisher_name.strip()},
        ).fetchone()
        if existing:
            raise HTTPException(status_code=409, detail="Publisher already exists.")
        result = db.execute(
            text("INSERT INTO lkup_graphicnovel_publishers (publisher_name) VALUES (:name) RETURNING publisher_id"),
            {"name": payload.publisher_name.strip()},
        ).fetchone()
        db.commit()
        return {"publisher_id": result[0], "publisher_name": payload.publisher_name.strip()}
    except HTTPException:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


@app.get("/graphicnovels/format-types")
def get_gn_format_types():
    db = SessionLocal()
    try:
        rows = db.execute(text("""
            SELECT format_type_id, format_type_name
            FROM lkup_graphicnovel_format_types
            WHERE is_active = 1
            ORDER BY sort_order, format_type_name
        """)).fetchall()
        return [{"format_type_id": row[0], "format_type_name": row[1]} for row in rows]
    finally:
        db.close()


@app.get("/graphicnovels/eras")
def get_gn_eras():
    db = SessionLocal()
    try:
        rows = db.execute(text("""
            SELECT era_id, era_name, era_years
            FROM lkup_graphicnovel_eras
            WHERE is_active = 1
            ORDER BY sort_order
        """)).fetchall()
        return [{"era_id": row[0], "era_name": row[1], "era_years": row[2]} for row in rows]
    finally:
        db.close()


@app.get("/graphicnovels/writers")
def get_gn_writers(q: Optional[str] = None):
    db = SessionLocal()
    try:
        if q:
            rows = db.execute(
                text("""
                    SELECT writer_id, writer_name
                    FROM lkup_graphicnovel_writers
                    WHERE is_active = 1 AND LOWER(writer_name) LIKE LOWER(:q)
                    ORDER BY writer_name
                    LIMIT 20
                """),
                {"q": f"%{q}%"},
            ).fetchall()
        else:
            rows = db.execute(text("""
                SELECT writer_id, writer_name
                FROM lkup_graphicnovel_writers
                WHERE is_active = 1
                ORDER BY writer_name
            """)).fetchall()
        return [{"writer_id": row[0], "writer_name": row[1]} for row in rows]
    finally:
        db.close()


@app.get("/graphicnovels/artists")
def get_gn_artists(q: Optional[str] = None):
    db = SessionLocal()
    try:
        if q:
            rows = db.execute(
                text("""
                    SELECT artist_id, artist_name
                    FROM lkup_graphicnovel_artists
                    WHERE is_active = 1 AND LOWER(artist_name) LIKE LOWER(:q)
                    ORDER BY artist_name
                    LIMIT 20
                """),
                {"q": f"%{q}%"},
            ).fetchall()
        else:
            rows = db.execute(text("""
                SELECT artist_id, artist_name
                FROM lkup_graphicnovel_artists
                WHERE is_active = 1
                ORDER BY artist_name
            """)).fetchall()
        return [{"artist_id": row[0], "artist_name": row[1]} for row in rows]
    finally:
        db.close()


@app.get("/graphicnovels/tags")
def get_gn_tags(q: Optional[str] = None):
    db = SessionLocal()
    try:
        if q:
            rows = db.execute(
                text("""
                    SELECT tag_id, tag_name
                    FROM lkup_graphicnovel_tags
                    WHERE is_active = 1 AND LOWER(tag_name) LIKE LOWER(:q)
                    ORDER BY tag_name
                    LIMIT 20
                """),
                {"q": f"%{q}%"},
            ).fetchall()
        else:
            rows = db.execute(text("""
                SELECT tag_id, tag_name
                FROM lkup_graphicnovel_tags
                WHERE is_active = 1
                ORDER BY tag_name
            """)).fetchall()
        return [{"tag_id": row[0], "tag_name": row[1]} for row in rows]
    finally:
        db.close()


# --- ISBN lookup for graphic novels ---

def _normalize_gn_isbn_result(volume: dict) -> dict:
    info = volume.get("volumeInfo", {})
    isbns = {i["type"]: i["identifier"] for i in info.get("industryIdentifiers", [])}
    volume_id = volume.get("id")
    # Use the thumbnail URL from the API response (always publicly accessible cross-origin).
    # The publisher/content endpoint requires authentication and fails in browsers.
    image_links = info.get("imageLinks", {})
    raw = image_links.get("thumbnail") or image_links.get("smallThumbnail")
    if raw:
        cover = raw.replace("http://", "https://")
    elif volume_id:
        cover = f"https://books.google.com/books/content?id={volume_id}&printsec=frontcover&img=1&zoom=1"
    else:
        cover = None
    return {
        "title": info.get("title"),
        "writer_names": info.get("authors", []),
        "publisher_name": info.get("publisher"),
        "isbn_10": isbns.get("ISBN_10"),
        "isbn_13": isbns.get("ISBN_13"),
        "published_date": info.get("publishedDate"),
        "page_count": info.get("pageCount"),
        "description": info.get("description"),
        "cover_image_url": cover,
        "api_source": "google_books",
        "external_work_id": volume.get("id"),
        "_raw": {
            "volumeInfo": info,
            "saleInfo": volume.get("saleInfo"),
            "accessInfo": volume.get("accessInfo"),
        },
    }


def _gn_isbn_from_open_library(isbn: str):
    url = f"https://openlibrary.org/api/books?bibkeys=ISBN:{isbn}&format=json&jscmd=data"
    with urllib.request.urlopen(url, timeout=8) as resp:
        data = json.loads(resp.read())
    entry = data.get(f"ISBN:{isbn}")
    if not entry:
        return None
    isbns = entry.get("identifiers", {})
    cover = entry.get("cover", {})
    authors = [a.get("name", "") for a in entry.get("authors", [])]
    publish_date = entry.get("publish_date", "")
    import re as _re
    year_match = _re.search(r"\b(\d{4})\b", publish_date)
    normalized_date = year_match.group(1) if year_match else publish_date or None
    # Use the largest size OL provides; fall back to the direct cover-by-ISBN
    # endpoint (returns a 1px placeholder when no cover exists — filtered at
    # download time by _download_gn_cover).
    cover_url = cover.get("large") or cover.get("medium") or cover.get("small")
    if not cover_url:
        cover_url = f"https://covers.openlibrary.org/b/isbn/{isbn}-L.jpg"
    return {
        "title": entry.get("title"),
        "writer_names": authors,
        "isbn_10": isbns.get("isbn_10", [None])[0],
        "isbn_13": isbns.get("isbn_13", [None])[0],
        "published_date": normalized_date,
        "page_count": entry.get("number_of_pages"),
        "description": None,
        "cover_image_url": cover_url,
        "api_source": "open_library",
        "external_work_id": entry.get("key"),
    }


def _download_cover(url: str, module_code: str, item_id: int) -> Optional[str]:
    """Download a cover image for any module, save locally, return the /images/… path.

    Returns None if the download fails or the image is too small to be real
    (Open Library returns a 1-pixel placeholder for missing covers).
    """
    cover_dir = COVER_DIRS.get(module_code)
    if not cover_dir:
        return None
    MIN_BYTES = 2048  # anything smaller is a placeholder or garbage
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "CollectCore/1.0"})
        with urllib.request.urlopen(req, timeout=12) as resp:
            content_type = resp.headers.get("Content-Type", "image/jpeg")
            data = resp.read()
        if len(data) < MIN_BYTES:
            return None
        if "png" in content_type:
            ext = "png"
        elif "webp" in content_type:
            ext = "webp"
        elif "gif" in content_type:
            ext = "gif"
        else:
            ext = "jpg"
        filename = f"{module_code}_{item_id:06d}.{ext}"
        (cover_dir / filename).write_bytes(data)
        return f"/images/library/{module_code}/{filename}"
    except Exception:
        return None


def _download_gn_cover(url: str, item_id: int) -> Optional[str]:
    """Backwards-compatible wrapper for graphic novel covers."""
    return _download_cover(url, "gn", item_id)


def _finalize_staged_cover(staged_path: str, module_code: str, item_id: int) -> Optional[str]:
    """Rename a staged cover upload to its final name based on item_id."""
    cover_dir = COVER_DIRS.get(module_code)
    if not cover_dir:
        return None
    try:
        src = DATA_ROOT / staged_path.lstrip("/")
        if not src.is_file():
            return None
        ext = src.suffix.lstrip(".")
        filename = f"{module_code}_{item_id:06d}.{ext}"
        dest = cover_dir / filename
        src.rename(dest)
        return f"/images/library/{module_code}/{filename}"
    except Exception:
        return None


def _resolve_cover_url(url: Optional[str], module_code: str, item_id: int) -> Optional[str]:
    """Given a cover URL (external http, staged local, or final local), ensure it's local.

    - http/https URLs are downloaded
    - Staged paths (/images/library/{module}/staging_*) are renamed to final
    - Already-final local paths (/images/library/...) are left as-is
    Returns the final local path or the original value if nothing changed.
    """
    if not url:
        return url
    if url.startswith("http://") or url.startswith("https://"):
        local = _download_cover(url, module_code, item_id)
        return local if local else url
    if "/staging_" in url:
        local = _finalize_staged_cover(url, module_code, item_id)
        return local if local else url
    return url


def _gn_isbn_from_ol_search(isbn: str):
    """Open Library search.json — broader coverage than the books API endpoint."""
    url = f"https://openlibrary.org/search.json?isbn={isbn}&fields=title,author_name,isbn,cover_i,publish_date,number_of_pages_median,key"
    with urllib.request.urlopen(url, timeout=8) as resp:
        data = json.loads(resp.read())
    docs = data.get("docs", [])
    if not docs:
        return None
    doc = docs[0]
    import re as _re
    raw_date = (doc.get("publish_date") or [""])[0]
    year_match = _re.search(r"\b(\d{4})\b", raw_date)
    normalized_date = year_match.group(1) if year_match else raw_date or None
    cover_i = doc.get("cover_i")
    cover_url = f"https://covers.openlibrary.org/b/id/{cover_i}-L.jpg" if cover_i else None
    # Grab any ISBN-13 from the isbn list
    isbn13 = next((i for i in (doc.get("isbn") or []) if len(i) == 13), None)
    isbn10 = next((i for i in (doc.get("isbn") or []) if len(i) == 10), None)
    return {
        "title": doc.get("title"),
        "writer_names": doc.get("author_name") or [],
        "isbn_10": isbn10,
        "isbn_13": isbn13 or isbn,
        "published_date": normalized_date,
        "page_count": doc.get("number_of_pages_median"),
        "description": None,
        "cover_image_url": cover_url,
        "api_source": "open_library",
        "external_work_id": doc.get("key"),
    }


def _gn_isbn_from_oclc(isbn: str):
    """OCLC Classify API — 586M records, no key, returns XML metadata.
    Provides title/author for recent books not yet indexed by Open Library.
    No cover images directly, but returns an OCLC number usable for OL covers."""
    url = f"http://classify.oclc.org/classify2/Classify?isbn={isbn}&summary=true"
    req = urllib.request.Request(url, headers={"User-Agent": "CollectCore/1.0"})
    with urllib.request.urlopen(req, timeout=8) as resp:
        xml_data = resp.read()
    root = ET.fromstring(xml_data)
    ns = {"c": "http://classify.oclc.org/classify2/xsd/classify.xsd"}
    code_el = root.find("c:response", ns)
    code = code_el.get("code") if code_el is not None else None
    if code not in ("0", "2"):  # 0=single match, 2=multiple
        return None
    work_el = root.find("c:work", ns) or root.find(".//c:work", ns)
    if work_el is None:
        return None
    title = work_el.get("title")
    author = work_el.get("author") or work_el.get("authors")
    oclc = work_el.get("oclc")
    # Try OL cover by OCLC number (more reliable than by ISBN for recent books)
    cover_url = f"https://covers.openlibrary.org/b/oclc/{oclc}-L.jpg" if oclc else None
    return {
        "title": title,
        "writer_names": [author] if author else [],
        "isbn_10": None,
        "isbn_13": isbn if len(isbn) == 13 else None,
        "published_date": None,
        "page_count": None,
        "description": None,
        "cover_image_url": cover_url,
        "api_source": "oclc",
        "external_work_id": oclc,
    }


def _gn_from_comic_vine_volume(vol: dict) -> dict:
    """Normalize a Comic Vine volume record to our lookup shape."""
    image = vol.get("image") or {}
    cover = image.get("super_url") or image.get("medium_url") or image.get("small_url")
    pub = vol.get("publisher") or {}
    writers = []
    if vol.get("name"):
        pass  # writers come separately; volume record has creators if fetched with detail
    return {
        "title": vol.get("name"),
        "writer_names": writers,
        "isbn_10": None,
        "isbn_13": None,
        "published_date": vol.get("start_year"),
        "page_count": None,
        "description": vol.get("description") or vol.get("deck"),
        "cover_image_url": cover,
        "api_source": "comic_vine",
        "external_work_id": str(vol.get("id", "")),
        "publisher_name": pub.get("name"),
    }


def _gn_from_comic_vine_isbn(isbn: str) -> list:
    """Search Comic Vine for a volume by ISBN. Comic Vine doesn't have a direct
    ISBN field on volumes, but issues do. We search issues by ISBN and then
    fetch the parent volume for the collected edition metadata."""
    if not COMIC_VINE_API_KEY:
        return []
    headers = {"User-Agent": "CollectCore/1.0"}

    # Comic Vine issue search supports isbn filter (used for collected editions)
    # Try volume search with isbn filter first
    params = urllib.parse.urlencode({
        "api_key": COMIC_VINE_API_KEY,
        "format": "json",
        "filter": f"isbn:{isbn}",
        "field_list": "id,name,image,start_year,description,deck,publisher,count_of_issues",
        "limit": 5,
    })
    url = f"https://comicvine.gamespot.com/api/volumes/?{params}"
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=10) as resp:
        data = json.loads(resp.read())

    results = data.get("results") or []
    if results:
        return [_gn_from_comic_vine_volume(v) for v in results]

    # Comic Vine volume ISBN filter may be empty for some editions.
    # Fall back: search issues by ISBN — issues in CV can have ISBNs for TPBs.
    params2 = urllib.parse.urlencode({
        "api_key": COMIC_VINE_API_KEY,
        "format": "json",
        "filter": f"isbn:{isbn}",
        "field_list": "id,name,image,volume,description,store_date,number_of_pages",
        "limit": 5,
    })
    url2 = f"https://comicvine.gamespot.com/api/issues/?{params2}"
    req2 = urllib.request.Request(url2, headers=headers)
    with urllib.request.urlopen(req2, timeout=10) as resp2:
        data2 = json.loads(resp2.read())

    issues = data2.get("results") or []
    if not issues:
        return []

    # For each matching issue, fetch its parent volume for the cover + metadata
    volumes_seen = set()
    out = []
    for issue in issues:
        vol_stub = issue.get("volume") or {}
        vol_id = vol_stub.get("id")
        if not vol_id or vol_id in volumes_seen:
            continue
        volumes_seen.add(vol_id)
        try:
            vparams = urllib.parse.urlencode({
                "api_key": COMIC_VINE_API_KEY,
                "format": "json",
                "field_list": "id,name,image,start_year,description,deck,publisher,count_of_issues",
            })
            vurl = f"https://comicvine.gamespot.com/api/volume/4050-{vol_id}/?{vparams}"
            vreq = urllib.request.Request(vurl, headers=headers)
            with urllib.request.urlopen(vreq, timeout=10) as vresp:
                vdata = json.loads(vresp.read())
            vol = vdata.get("results") or {}
            if vol:
                r = _gn_from_comic_vine_volume(vol)
                # Use the issue's image if the volume has no cover
                if not r["cover_image_url"]:
                    img = issue.get("image") or {}
                    r["cover_image_url"] = img.get("super_url") or img.get("medium_url")
                # Carry ISBN from the issue
                r["isbn_13"] = isbn if len(isbn) == 13 else None
                r["published_date"] = r["published_date"] or issue.get("store_date", "")[:4] or None
                r["page_count"] = issue.get("number_of_pages")
                out.append(r)
        except Exception:
            continue
    return out


@app.get("/graphicnovels/lookup-isbn")
def gn_lookup_isbn(isbn: str = Query(..., min_length=10), source: str = Query("all")):
    # source="google" skips Comic Vine and only queries Google Books.
    # source="all" (default) tries all sources in priority order.

    if source != "google":
        # 1. Comic Vine — purpose-built for comics, best coverage of trades/omnibuses
        if COMIC_VINE_API_KEY:
            try:
                cv_results = _gn_from_comic_vine_isbn(isbn)
                if cv_results:
                    return cv_results
            except Exception:
                pass

    # 2. Google Books — good general fallback with covers
    try:
        encoded = urllib.parse.quote(f"isbn:{isbn}")
        gb_url = f"https://www.googleapis.com/books/v1/volumes?q={encoded}&maxResults=5"
        if GOOGLE_BOOKS_API_KEY:
            gb_url += f"&key={GOOGLE_BOOKS_API_KEY}"
        req = urllib.request.Request(gb_url, headers={"User-Agent": "CollectCore/1.0"})
        with urllib.request.urlopen(req, timeout=6) as resp:
            data = json.loads(resp.read())
        items = data.get("items", [])
        if items:
            return [_normalize_gn_isbn_result(v) for v in items]
    except Exception:
        pass

    if source == "google":
        return []

    # 3. Open Library search.json
    try:
        r = _gn_isbn_from_ol_search(isbn)
        if r:
            return [r]
    except Exception:
        pass

    # 4. Open Library books API
    try:
        r = _gn_isbn_from_open_library(isbn)
        if r:
            return [r]
    except Exception:
        pass

    # 5. OCLC Classify — metadata only, no covers, but broad coverage
    try:
        r = _gn_isbn_from_oclc(isbn)
        if r:
            return [r]
    except Exception:
        pass

    return []


@app.get("/graphicnovels/search-external")
def gn_search_external(q: str = Query(..., min_length=1), source: str = Query("comicvine")):
    headers = {"User-Agent": "CollectCore/1.0"}

    if source == "comicvine":
        if not COMIC_VINE_API_KEY:
            raise HTTPException(status_code=400, detail="Comic Vine API key not configured.")
        try:
            params = urllib.parse.urlencode({
                "api_key": COMIC_VINE_API_KEY,
                "format": "json",
                "query": q,
                "resources": "volume",
                "field_list": "id,name,image,start_year,description,deck,publisher,count_of_issues",
                "limit": 50,
            })
            req = urllib.request.Request(f"https://comicvine.gamespot.com/api/search/?{params}", headers=headers)
            with urllib.request.urlopen(req, timeout=8) as resp:
                data = json.loads(resp.read())
            return [_gn_from_comic_vine_volume(v) for v in (data.get("results") or [])]
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"Comic Vine search failed: {e}")

    else:  # google
        encoded = urllib.parse.quote(q)
        url = f"https://www.googleapis.com/books/v1/volumes?q={encoded}&maxResults=40"
        if GOOGLE_BOOKS_API_KEY:
            url += f"&key={GOOGLE_BOOKS_API_KEY}"
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=6) as resp:
                data = json.loads(resp.read())
            return [_normalize_gn_isbn_result(v) for v in data.get("items", [])]
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"Google Books search failed: {e}")


# --- Graphic Novels CRUD ---

@app.get("/graphicnovels")
def list_graphicnovels():
    db = SessionLocal()
    try:
        rows = db.execute(
            text("""
                SELECT
                    i.item_id,
                    i.top_level_category_id,
                    c.category_name,
                    i.ownership_status_id,
                    os.status_name,
                    i.reading_status_id,
                    rs.status_name,
                    i.notes,
                    gd.title,
                    gd.title_sort,
                    gd.series_name,
                    gd.series_number,
                    gd.publisher_id,
                    pub.publisher_name,
                    gd.format_type_id,
                    ft.format_type_name,
                    gd.era_id,
                    era.era_name,
                    gd.issue_notes,
                    gd.page_count,
                    gd.cover_image_url,
                    gd.isbn_13,
                    gd.star_rating,
                    gd.edition_notes,
                    (SELECT GROUP_CONCAT(lw.writer_name, ', ')
                     FROM xref_graphicnovel_item_writers xw
                     JOIN lkup_graphicnovel_writers lw ON xw.writer_id = lw.writer_id
                     WHERE xw.item_id = i.item_id
                     ORDER BY xw.writer_order) AS writers_str,
                    (SELECT GROUP_CONCAT(la.artist_name, ', ')
                     FROM xref_graphicnovel_item_artists xa
                     JOIN lkup_graphicnovel_artists la ON xa.artist_id = la.artist_id
                     WHERE xa.item_id = i.item_id
                     ORDER BY xa.artist_order) AS artists_str,
                    (SELECT GROUP_CONCAT(lt.tag_name, '|||')
                     FROM xref_graphicnovel_item_tags xt
                     JOIN lkup_graphicnovel_tags lt ON xt.tag_id = lt.tag_id
                     WHERE xt.item_id = i.item_id) AS tags_str,
                    (SELECT GROUP_CONCAT(ss.source_series_name || '|||' || COALESCE(ss.start_issue, '') || '|||' || COALESCE(ss.end_issue, ''), '~|~')
                     FROM xref_gn_source_series ss
                     WHERE ss.item_id = i.item_id
                     ORDER BY ss.sort_order) AS source_series_str
                FROM tbl_items i
                JOIN tbl_graphicnovel_details gd ON i.item_id = gd.item_id
                JOIN lkup_top_level_categories c ON i.top_level_category_id = c.top_level_category_id
                JOIN lkup_ownership_statuses os ON i.ownership_status_id = os.ownership_status_id
                LEFT JOIN lkup_book_read_statuses rs ON i.reading_status_id = rs.read_status_id
                LEFT JOIN lkup_graphicnovel_publishers pub ON gd.publisher_id = pub.publisher_id
                LEFT JOIN lkup_graphicnovel_format_types ft ON gd.format_type_id = ft.format_type_id
                LEFT JOIN lkup_graphicnovel_eras era ON gd.era_id = era.era_id
                WHERE i.collection_type_id = :ct
                ORDER BY COALESCE(gd.title_sort, gd.title)
            """),
            {"ct": GN_COLLECTION_TYPE_ID},
        ).fetchall()

        def parse_tag_list(s):
            if not s:
                return []
            seen = set()
            out = []
            for v in s.split("|||"):
                if v not in seen:
                    seen.add(v)
                    out.append(v)
            return out

        def parse_source_series(s):
            if not s:
                return []
            result = []
            for chunk in s.split("~|~"):
                parts = chunk.split("|||")
                if len(parts) >= 1 and parts[0]:
                    result.append({
                        "source_series_name": parts[0],
                        "start_issue": int(parts[1]) if len(parts) > 1 and parts[1] else None,
                        "end_issue": int(parts[2]) if len(parts) > 2 and parts[2] else None,
                    })
            return result

        return [
            {
                "item_id": row[0],
                "top_level_category_id": row[1],
                "category": row[2],
                "ownership_status_id": row[3],
                "ownership_status": row[4],
                "reading_status_id": row[5],
                "reading_status": row[6],
                "notes": row[7],
                "title": row[8],
                "title_sort": row[9],
                "series_name": row[10],
                "series_number": row[11],
                "publisher_id": row[12],
                "publisher_name": row[13],
                "format_type_id": row[14],
                "format_type_name": row[15],
                "era_id": row[16],
                "era_name": row[17],
                "issue_notes": row[18],
                "page_count": row[19],
                "cover_image_url": row[20],
                "isbn_13": row[21],
                "star_rating": row[22],
                "edition_notes": row[23],
                "writers": row[24].split(", ") if row[24] else [],
                "artists": row[25].split(", ") if row[25] else [],
                "tags": parse_tag_list(row[26]),
                "source_series": parse_source_series(row[27]),
            }
            for row in rows
        ]
    finally:
        db.close()


@app.get("/graphicnovels/{item_id}")
def get_graphicnovel(item_id: int):
    db = SessionLocal()
    try:
        gn = _get_gn_detail(db, item_id)
        if not gn:
            raise HTTPException(status_code=404, detail="Graphic novel not found.")
        return gn
    finally:
        db.close()


@app.post("/graphicnovels")
def create_graphicnovel(payload: GraphicNovelCreate):
    db = SessionLocal()
    try:
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
                "ct": GN_COLLECTION_TYPE_ID,
                "cat": payload.top_level_category_id,
                "own": payload.ownership_status_id,
                "rs": payload.reading_status_id,
                "notes": payload.notes,
            },
        ).fetchone()
        item_id = item_result[0]

        db.execute(
            text("""
                INSERT INTO tbl_graphicnovel_details (
                    item_id, title, title_sort, description,
                    publisher_id, format_type_id, era_id,
                    series_name, series_number, series_sort,
                    issue_notes, page_count, published_date, isbn_13, isbn_10,
                    cover_image_url, edition_notes, star_rating, review,
                    api_source, external_work_id
                ) VALUES (
                    :item_id, :title, :title_sort, :description,
                    :publisher_id, :format_type_id, :era_id,
                    :series_name, :series_number, :series_sort,
                    :issue_notes, :page_count, :published_date, :isbn_13, :isbn_10,
                    :cover_image_url, :edition_notes, :star_rating, :review,
                    :api_source, :external_work_id
                )
            """),
            {
                "item_id": item_id,
                "title": payload.title.strip(),
                "title_sort": _make_title_sort(payload.title.strip()),
                "description": payload.description,
                "publisher_id": payload.publisher_id,
                "format_type_id": payload.format_type_id,
                "era_id": payload.era_id,
                "series_name": payload.series_name,
                "series_number": payload.series_number,
                "series_sort": payload.series_number,
                "issue_notes": payload.issue_notes,
                "page_count": payload.page_count,
                "published_date": payload.published_date,
                "isbn_13": payload.isbn_13,
                "isbn_10": payload.isbn_10,
                "cover_image_url": payload.cover_image_url,
                "edition_notes": payload.edition_notes,
                "star_rating": payload.star_rating,
                "review": payload.review,
                "api_source": payload.api_source,
                "external_work_id": payload.external_work_id,
            },
        )

        _insert_gn_relationships(db, item_id, payload)

        # Download cover and save locally so the URL never goes stale
        if payload.cover_image_url:
            local_cover = _download_gn_cover(payload.cover_image_url, item_id)
            if local_cover:
                db.execute(
                    text("UPDATE tbl_graphicnovel_details SET cover_image_url = :url WHERE item_id = :id"),
                    {"url": local_cover, "id": item_id},
                )

        db.commit()

        gn = _get_gn_detail(db, item_id)
        return {"item_id": item_id, "status": "created", "graphicnovel": gn}

    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        if "ux_graphicnovel_details_isbn13" in str(e):
            raise HTTPException(status_code=409, detail="A graphic novel with that ISBN-13 already exists.")
        raise
    finally:
        db.close()


@app.put("/graphicnovels/{item_id}")
def update_graphicnovel(item_id: int, payload: GraphicNovelUpdate):
    db = SessionLocal()
    try:
        existing = db.execute(
            text("SELECT item_id FROM tbl_items WHERE item_id = :id AND collection_type_id = :ct"),
            {"id": item_id, "ct": GN_COLLECTION_TYPE_ID},
        ).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Graphic novel not found.")

        db.execute(
            text("""
                UPDATE tbl_items
                SET top_level_category_id = :cat,
                    ownership_status_id = :own,
                    reading_status_id = :rs,
                    notes = :notes,
                    updated_at = CURRENT_TIMESTAMP
                WHERE item_id = :id
            """),
            {
                "id": item_id,
                "cat": payload.top_level_category_id,
                "own": payload.ownership_status_id,
                "rs": payload.reading_status_id,
                "notes": payload.notes,
            },
        )

        db.execute(
            text("""
                UPDATE tbl_graphicnovel_details
                SET title = :title,
                    title_sort = :title_sort,
                    description = :description,
                    publisher_id = :publisher_id,
                    format_type_id = :format_type_id,
                    era_id = :era_id,
                    series_name = :series_name,
                    series_number = :series_number,
                    series_sort = :series_sort,
                    issue_notes = :issue_notes,
                    page_count = :page_count,
                    published_date = :published_date,
                    isbn_13 = :isbn_13,
                    isbn_10 = :isbn_10,
                    cover_image_url = :cover_image_url,
                    edition_notes = :edition_notes,
                    star_rating = :star_rating,
                    review = :review,
                    api_source = :api_source,
                    external_work_id = :external_work_id
                WHERE item_id = :id
            """),
            {
                "id": item_id,
                "title": payload.title.strip(),
                "title_sort": _make_title_sort(payload.title.strip()),
                "description": payload.description,
                "publisher_id": payload.publisher_id,
                "format_type_id": payload.format_type_id,
                "era_id": payload.era_id,
                "series_name": payload.series_name,
                "series_number": payload.series_number,
                "series_sort": payload.series_number,
                "issue_notes": payload.issue_notes,
                "page_count": payload.page_count,
                "published_date": payload.published_date,
                "isbn_13": payload.isbn_13,
                "isbn_10": payload.isbn_10,
                "cover_image_url": payload.cover_image_url,
                "edition_notes": payload.edition_notes,
                "star_rating": payload.star_rating,
                "review": payload.review,
                "api_source": payload.api_source,
                "external_work_id": payload.external_work_id,
            },
        )

        db.execute(text("DELETE FROM xref_graphicnovel_item_writers WHERE item_id = :id"), {"id": item_id})
        db.execute(text("DELETE FROM xref_graphicnovel_item_artists WHERE item_id = :id"), {"id": item_id})
        db.execute(text("DELETE FROM xref_graphicnovel_item_tags WHERE item_id = :id"), {"id": item_id})
        db.execute(text("DELETE FROM xref_gn_source_series WHERE item_id = :id"), {"id": item_id})
        _insert_gn_relationships(db, item_id, payload)

        # Download cover locally if an external URL was provided
        if payload.cover_image_url and not payload.cover_image_url.startswith("/images/"):
            local_cover = _download_gn_cover(payload.cover_image_url, item_id)
            if local_cover:
                db.execute(
                    text("UPDATE tbl_graphicnovel_details SET cover_image_url = :url WHERE item_id = :id"),
                    {"url": local_cover, "id": item_id},
                )

        db.commit()

        gn = _get_gn_detail(db, item_id)
        return {"item_id": item_id, "status": "updated", "graphicnovel": gn}

    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        if "ux_graphicnovel_details_isbn13" in str(e):
            raise HTTPException(status_code=409, detail="A graphic novel with that ISBN-13 already exists.")
        raise
    finally:
        db.close()


@app.post("/graphicnovels/fix-covers")
def gn_fix_covers():
    """Re-download any covers stored as external URLs (http/https) to local storage."""
    db = SessionLocal()
    try:
        rows = db.execute(text("""
            SELECT item_id, cover_image_url, api_source, external_work_id
            FROM tbl_graphicnovel_details
            WHERE cover_image_url IS NOT NULL
              AND cover_image_url NOT LIKE '/images/%'
        """)).fetchall()

        fixed, failed = 0, []
        for item_id, cover_url, api_source, external_work_id in rows:
            local_cover = None

            # For Google Books: re-fetch the thumbnail URL via the volume API
            if api_source == "google_books" and external_work_id:
                try:
                    gb_url = f"https://www.googleapis.com/books/v1/volumes/{external_work_id}"
                    if GOOGLE_BOOKS_API_KEY:
                        gb_url += f"?key={GOOGLE_BOOKS_API_KEY}"
                    req = urllib.request.Request(gb_url, headers={"User-Agent": "CollectCore/1.0"})
                    with urllib.request.urlopen(req, timeout=6) as resp:
                        vol = json.loads(resp.read())
                    info = vol.get("volumeInfo", {})
                    image_links = info.get("imageLinks", {})
                    raw = image_links.get("thumbnail") or image_links.get("smallThumbnail")
                    if raw:
                        fresh_url = raw.replace("http://", "https://")
                        local_cover = _download_gn_cover(fresh_url, item_id)
                except Exception:
                    pass

            # Fallback: try the stored URL directly (works for Open Library etc.)
            if not local_cover and cover_url:
                local_cover = _download_gn_cover(cover_url, item_id)

            if local_cover:
                db.execute(
                    text("UPDATE tbl_graphicnovel_details SET cover_image_url = :url WHERE item_id = :id"),
                    {"url": local_cover, "id": item_id},
                )
                fixed += 1
            else:
                failed.append(item_id)

        db.commit()
        return {"fixed": fixed, "failed": failed}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        db.close()


@app.delete("/graphicnovels/{item_id}")
def delete_graphicnovel(item_id: int):
    db = SessionLocal()
    try:
        existing = db.execute(
            text("SELECT item_id FROM tbl_items WHERE item_id = :id AND collection_type_id = :ct"),
            {"id": item_id, "ct": GN_COLLECTION_TYPE_ID},
        ).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Graphic novel not found.")

        files_to_delete = _delete_attachment_files(db, item_id)
        files_to_delete.extend(_collect_cover_file(db, "tbl_graphicnovel_details", item_id))
        db.execute(text("DELETE FROM xref_graphicnovel_item_writers WHERE item_id = :id"), {"id": item_id})
        db.execute(text("DELETE FROM xref_graphicnovel_item_artists WHERE item_id = :id"), {"id": item_id})
        db.execute(text("DELETE FROM xref_graphicnovel_item_tags WHERE item_id = :id"), {"id": item_id})
        db.execute(text("DELETE FROM tbl_attachments WHERE item_id = :id"), {"id": item_id})
        db.execute(text("DELETE FROM tbl_graphicnovel_details WHERE item_id = :id"), {"id": item_id})
        db.execute(text("DELETE FROM tbl_items WHERE item_id = :id"), {"id": item_id})
        db.commit()
        _remove_files(files_to_delete)

        return {"item_id": item_id, "status": "deleted"}
    except HTTPException:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


@app.patch("/graphicnovels/bulk")
def bulk_update_graphicnovels(payload: GnBulkUpdatePayload):
    if not payload.item_ids:
        raise HTTPException(status_code=400, detail="item_ids cannot be empty.")

    db = SessionLocal()
    try:
        placeholders = ",".join(str(i) for i in payload.item_ids)
        found = db.execute(
            text(f"SELECT item_id FROM tbl_items WHERE item_id IN ({placeholders}) AND collection_type_id = :ct"),
            {"ct": GN_COLLECTION_TYPE_ID},
        ).fetchall()
        if len(found) != len(payload.item_ids):
            raise HTTPException(status_code=404, detail="One or more item_ids not found.")

        f = payload.fields

        item_updates = []
        item_params = {}
        if f.ownership_status_id is not None:
            item_updates.append("ownership_status_id = :ownership_status_id")
            item_params["ownership_status_id"] = f.ownership_status_id
        if f.reading_status_id is not None:
            item_updates.append("reading_status_id = :reading_status_id")
            item_params["reading_status_id"] = f.reading_status_id
        if f.top_level_category_id is not None:
            item_updates.append("top_level_category_id = :top_level_category_id")
            item_params["top_level_category_id"] = f.top_level_category_id

        if item_updates:
            item_updates.append("updated_at = CURRENT_TIMESTAMP")
            for item_id in payload.item_ids:
                db.execute(
                    text(f"UPDATE tbl_items SET {', '.join(item_updates)} WHERE item_id = :item_id"),
                    {**item_params, "item_id": item_id},
                )

        detail_updates = []
        detail_params = {}
        if f.format_type_id is not None:
            detail_updates.append("format_type_id = :format_type_id")
            detail_params["format_type_id"] = f.format_type_id
        if f.era_id is not None:
            detail_updates.append("era_id = :era_id")
            detail_params["era_id"] = f.era_id
        if f.publisher_id is not None:
            detail_updates.append("publisher_id = :publisher_id")
            detail_params["publisher_id"] = f.publisher_id
        if f.star_rating is not None:
            detail_updates.append("star_rating = :star_rating")
            detail_params["star_rating"] = f.star_rating

        if detail_updates:
            for item_id in payload.item_ids:
                db.execute(
                    text(f"UPDATE tbl_graphicnovel_details SET {', '.join(detail_updates)} WHERE item_id = :item_id"),
                    {**detail_params, "item_id": item_id},
                )

        db.commit()
        return {"item_ids": payload.item_ids, "status": "updated", "count": len(payload.item_ids)}
    except HTTPException:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


@app.post("/graphicnovels/bulk-delete")
def bulk_delete_graphicnovels(payload: BulkDeletePayload):
    if not payload.item_ids:
        raise HTTPException(status_code=400, detail="item_ids cannot be empty.")

    db = SessionLocal()
    try:
        placeholders = ",".join(str(i) for i in payload.item_ids)
        found = db.execute(
            text(f"SELECT item_id FROM tbl_items WHERE item_id IN ({placeholders}) AND collection_type_id = :ct"),
            {"ct": GN_COLLECTION_TYPE_ID},
        ).fetchall()
        if len(found) != len(payload.item_ids):
            raise HTTPException(status_code=404, detail="One or more item_ids not found.")

        all_files = []
        for item_id in payload.item_ids:
            all_files.extend(_delete_attachment_files(db, item_id))
            all_files.extend(_collect_cover_file(db, "tbl_graphicnovel_details", item_id))
            db.execute(text("DELETE FROM xref_graphicnovel_item_writers WHERE item_id = :id"), {"id": item_id})
            db.execute(text("DELETE FROM xref_graphicnovel_item_artists WHERE item_id = :id"), {"id": item_id})
            db.execute(text("DELETE FROM xref_graphicnovel_item_tags WHERE item_id = :id"), {"id": item_id})
            db.execute(text("DELETE FROM tbl_attachments WHERE item_id = :id"), {"id": item_id})
            db.execute(text("DELETE FROM tbl_graphicnovel_details WHERE item_id = :id"), {"id": item_id})
            db.execute(text("DELETE FROM tbl_items WHERE item_id = :id"), {"id": item_id})

        db.commit()
        _remove_files(all_files)
        return {"deleted": payload.item_ids, "count": len(payload.item_ids)}
    except HTTPException:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


# ---------- Video Games ----------

# --- Video Games Pydantic models ---

class GameGenreEntry(BaseModel):
    top_genre_id: int
    sub_genre_id: Optional[int] = None


class GameCopyInput(BaseModel):
    platform_id: Optional[int] = None
    edition: Optional[str] = None
    ownership_status_id: Optional[int] = None
    notes: Optional[str] = None


class VideoGameCreate(BaseModel):
    ownership_status_id: int
    play_status_id: Optional[int] = None
    notes: Optional[str] = None
    title: str
    description: Optional[str] = None
    release_date: Optional[str] = None
    cover_image_url: Optional[str] = None
    developer_names: Optional[List[str]] = None
    publisher_names: Optional[List[str]] = None
    genres: Optional[List[GameGenreEntry]] = None
    copies: Optional[List[GameCopyInput]] = None
    api_source: Optional[str] = None
    external_work_id: Optional[str] = None


class VideoGameUpdate(BaseModel):
    ownership_status_id: int
    play_status_id: Optional[int] = None
    notes: Optional[str] = None
    title: str
    description: Optional[str] = None
    release_date: Optional[str] = None
    cover_image_url: Optional[str] = None
    developer_names: Optional[List[str]] = None
    publisher_names: Optional[List[str]] = None
    genres: Optional[List[GameGenreEntry]] = None
    copies: Optional[List[GameCopyInput]] = None
    api_source: Optional[str] = None
    external_work_id: Optional[str] = None


class GameBulkUpdateFields(BaseModel):
    ownership_status_id: Optional[int] = None
    play_status_id: Optional[int] = None


class GameBulkUpdatePayload(BaseModel):
    item_ids: List[int]
    fields: GameBulkUpdateFields


# --- Video Games helpers ---

def _upsert_game_developer(db, name: str) -> int:
    clean = name.strip()
    existing = db.execute(
        text("SELECT developer_id FROM lkup_game_developers WHERE LOWER(TRIM(developer_name)) = LOWER(TRIM(:name))"),
        {"name": clean},
    ).fetchone()
    if existing:
        return existing[0]
    result = db.execute(
        text("INSERT INTO lkup_game_developers (developer_name) VALUES (:name) RETURNING developer_id"),
        {"name": clean},
    ).fetchone()
    return result[0]


def _upsert_game_publisher(db, name: str) -> int:
    clean = name.strip()
    existing = db.execute(
        text("SELECT publisher_id FROM lkup_game_publishers WHERE LOWER(TRIM(publisher_name)) = LOWER(TRIM(:name))"),
        {"name": clean},
    ).fetchone()
    if existing:
        return existing[0]
    result = db.execute(
        text("INSERT INTO lkup_game_publishers (publisher_name) VALUES (:name) RETURNING publisher_id"),
        {"name": clean},
    ).fetchone()
    return result[0]


def _insert_game_relationships(db, item_id: int, payload) -> None:
    if payload.developer_names:
        for name in payload.developer_names:
            if name.strip():
                dev_id = _upsert_game_developer(db, name)
                db.execute(
                    text("INSERT OR IGNORE INTO xref_game_developers (item_id, developer_id) VALUES (:item_id, :dev_id)"),
                    {"item_id": item_id, "dev_id": dev_id},
                )
    if payload.publisher_names:
        for name in payload.publisher_names:
            if name.strip():
                pub_id = _upsert_game_publisher(db, name)
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
            LEFT JOIN lkup_book_read_statuses rs ON i.reading_status_id = rs.read_status_id
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


# --- Video Games lookup endpoints ---
# NOTE: specific paths must appear before /{item_id}

@app.get("/videogames/genres")
def get_game_genres():
    db = SessionLocal()
    try:
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
    finally:
        db.close()


@app.get("/videogames/developers")
def get_game_developers(q: Optional[str] = None):
    db = SessionLocal()
    try:
        if q:
            rows = db.execute(
                text("SELECT developer_id, developer_name FROM lkup_game_developers WHERE is_active = 1 AND LOWER(developer_name) LIKE LOWER(:q) ORDER BY developer_name LIMIT 20"),
                {"q": f"%{q}%"},
            ).fetchall()
        else:
            rows = db.execute(text("SELECT developer_id, developer_name FROM lkup_game_developers WHERE is_active = 1 ORDER BY developer_name")).fetchall()
        return [{"developer_id": r[0], "developer_name": r[1]} for r in rows]
    finally:
        db.close()


@app.get("/videogames/publishers")
def get_game_publishers(q: Optional[str] = None):
    db = SessionLocal()
    try:
        if q:
            rows = db.execute(
                text("SELECT publisher_id, publisher_name FROM lkup_game_publishers WHERE is_active = 1 AND LOWER(publisher_name) LIKE LOWER(:q) ORDER BY publisher_name LIMIT 20"),
                {"q": f"%{q}%"},
            ).fetchall()
        else:
            rows = db.execute(text("SELECT publisher_id, publisher_name FROM lkup_game_publishers WHERE is_active = 1 ORDER BY publisher_name")).fetchall()
        return [{"publisher_id": r[0], "publisher_name": r[1]} for r in rows]
    finally:
        db.close()


@app.get("/videogames/play-statuses")
def get_game_play_statuses():
    """Returns play-status rows from the shared consumption status table."""
    db = SessionLocal()
    try:
        rows = db.execute(text("""
            SELECT read_status_id, status_name FROM lkup_book_read_statuses
            WHERE status_name IN ('Played', 'Playing', 'Want to Play', 'Abandoned')
            ORDER BY sort_order
        """)).fetchall()
        return [{"play_status_id": r[0], "status_name": r[1]} for r in rows]
    finally:
        db.close()


@app.get("/videogames/platforms")
def get_game_platforms():
    """Returns all active platforms from lkup_game_platforms."""
    db = SessionLocal()
    try:
        rows = db.execute(text(
            "SELECT platform_id, platform_name FROM lkup_game_platforms WHERE is_active = 1 ORDER BY sort_order"
        )).fetchall()
        return [{"platform_id": r[0], "platform_name": r[1]} for r in rows]
    finally:
        db.close()


@app.get("/videogames/rawg-search")
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


@app.get("/videogames")
def list_videogames():
    db = SessionLocal()
    try:
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
                LEFT JOIN lkup_book_read_statuses rs ON i.reading_status_id = rs.read_status_id
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
    finally:
        db.close()


@app.get("/videogames/{item_id}")
def get_videogame(item_id: int):
    db = SessionLocal()
    try:
        game = _get_game_detail(db, item_id)
        if not game:
            raise HTTPException(status_code=404, detail="Video game not found.")
        return game
    finally:
        db.close()


@app.post("/videogames")
def create_videogame(payload: VideoGameCreate):
    db = SessionLocal()
    try:
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
                "title_sort": _make_title_sort(payload.title.strip()),
                "description": payload.description,
                "release_date": payload.release_date,
                "cover_image_url": _resolve_cover_url(payload.cover_image_url, "videogames", item_id),
                "api_source": payload.api_source,
                "external_work_id": payload.external_work_id,
            },
        )

        _insert_game_relationships(db, item_id, payload)
        _insert_game_copies(db, item_id, payload.copies or [])
        db.commit()

        game = _get_game_detail(db, item_id)
        return {"item_id": item_id, "status": "created", "videogame": game}
    except HTTPException:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


@app.put("/videogames/{item_id}")
def update_videogame(item_id: int, payload: VideoGameUpdate):
    db = SessionLocal()
    try:
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
                "title_sort": _make_title_sort(payload.title.strip()),
                "description": payload.description,
                "release_date": payload.release_date,
                "cover_image_url": _resolve_cover_url(payload.cover_image_url, "videogames", item_id),
                "api_source": payload.api_source,
                "external_work_id": payload.external_work_id,
            },
        )

        # Replace all relationships
        db.execute(text("DELETE FROM xref_game_developers WHERE item_id = :id"), {"id": item_id})
        db.execute(text("DELETE FROM xref_game_publishers WHERE item_id = :id"), {"id": item_id})
        db.execute(text("DELETE FROM xref_game_genres WHERE item_id = :id"), {"id": item_id})
        db.execute(text("DELETE FROM tbl_game_copies WHERE item_id = :id"), {"id": item_id})
        _insert_game_relationships(db, item_id, payload)
        _insert_game_copies(db, item_id, payload.copies or [])

        db.commit()
        game = _get_game_detail(db, item_id)
        return {"item_id": item_id, "status": "updated", "videogame": game}
    except HTTPException:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


@app.delete("/videogames/{item_id}")
def delete_videogame(item_id: int):
    db = SessionLocal()
    try:
        existing = db.execute(
            text("SELECT item_id FROM tbl_items WHERE item_id = :id AND collection_type_id = :ct"),
            {"id": item_id, "ct": VIDEOGAMES_COLLECTION_TYPE_ID},
        ).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Video game not found.")

        files_to_delete = _delete_attachment_files(db, item_id)
        files_to_delete.extend(_collect_cover_file(db, "tbl_game_details", item_id))
        db.execute(text("DELETE FROM xref_game_developers WHERE item_id = :id"), {"id": item_id})
        db.execute(text("DELETE FROM xref_game_publishers WHERE item_id = :id"), {"id": item_id})
        db.execute(text("DELETE FROM xref_game_genres WHERE item_id = :id"), {"id": item_id})
        db.execute(text("DELETE FROM tbl_attachments WHERE item_id = :id"), {"id": item_id})
        db.execute(text("DELETE FROM tbl_game_details WHERE item_id = :id"), {"id": item_id})
        db.execute(text("DELETE FROM tbl_items WHERE item_id = :id"), {"id": item_id})

        db.commit()
        _remove_files(files_to_delete)
        return {"deleted": item_id}
    except HTTPException:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


@app.patch("/videogames/bulk")
def bulk_update_videogames(payload: GameBulkUpdatePayload):
    db = SessionLocal()
    try:
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
    except HTTPException:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


@app.post("/videogames/bulk-delete")
def bulk_delete_videogames(payload: BulkDeletePayload):
    db = SessionLocal()
    try:
        for item_id in payload.item_ids:
            existing = db.execute(
                text("SELECT item_id FROM tbl_items WHERE item_id = :id AND collection_type_id = :ct"),
                {"id": item_id, "ct": VIDEOGAMES_COLLECTION_TYPE_ID},
            ).fetchone()
            if not existing:
                raise HTTPException(status_code=404, detail=f"Item {item_id} not found.")

        all_files = []
        for item_id in payload.item_ids:
            all_files.extend(_delete_attachment_files(db, item_id))
            all_files.extend(_collect_cover_file(db, "tbl_game_details", item_id))
            db.execute(text("DELETE FROM xref_game_developers WHERE item_id = :id"), {"id": item_id})
            db.execute(text("DELETE FROM xref_game_publishers WHERE item_id = :id"), {"id": item_id})
            db.execute(text("DELETE FROM xref_game_genres WHERE item_id = :id"), {"id": item_id})
            db.execute(text("DELETE FROM tbl_attachments WHERE item_id = :id"), {"id": item_id})
            db.execute(text("DELETE FROM tbl_game_details WHERE item_id = :id"), {"id": item_id})
            db.execute(text("DELETE FROM tbl_items WHERE item_id = :id"), {"id": item_id})

        db.commit()
        _remove_files(all_files)
        return {"deleted": payload.item_ids, "count": len(payload.item_ids)}
    except HTTPException:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


# ---------- Music ----------

# --- Music Pydantic models ---

class MusicSongEntry(BaseModel):
    song_id: Optional[int] = None  # present on update
    title: str
    duration_seconds: Optional[int] = None
    track_number: Optional[int] = None
    disc_number: int = 1


class MusicEditionEntry(BaseModel):
    edition_id: Optional[int] = None  # present on update
    format_type_id: Optional[int] = None
    version_name: Optional[str] = None
    label: Optional[str] = None
    catalog_number: Optional[str] = None
    barcode: Optional[str] = None
    notes: Optional[str] = None
    ownership_status_id: Optional[int] = None


class MusicReleaseCreate(BaseModel):
    title: str
    top_level_category_id: int  # release type (Album, EP, Single, etc.)
    ownership_status_id: int
    release_date: Optional[str] = None
    description: Optional[str] = None
    cover_image_url: Optional[str] = None
    notes: Optional[str] = None
    api_source: Optional[str] = None
    external_work_id: Optional[str] = None
    artist_names: List[str] = []
    genres: List[dict] = []
    songs: List[MusicSongEntry] = []
    editions: List[MusicEditionEntry] = []


class MusicReleaseUpdate(BaseModel):
    title: Optional[str] = None
    top_level_category_id: Optional[int] = None
    ownership_status_id: Optional[int] = None
    release_date: Optional[str] = None
    description: Optional[str] = None
    cover_image_url: Optional[str] = None
    notes: Optional[str] = None
    api_source: Optional[str] = None
    external_work_id: Optional[str] = None
    artist_names: Optional[List[str]] = None
    genres: Optional[List[dict]] = None
    songs: Optional[List[MusicSongEntry]] = None
    editions: Optional[List[MusicEditionEntry]] = None


class MusicBulkUpdateFields(BaseModel):
    ownership_status_id: Optional[int] = None
    top_level_category_id: Optional[int] = None


class MusicBulkUpdatePayload(BaseModel):
    item_ids: List[int]
    fields: MusicBulkUpdateFields


# --- Music helpers ---

def _make_title_sort_music(title: str) -> str:
    for prefix in ("The ", "A ", "An "):
        if title.startswith(prefix):
            return title[len(prefix):] + ", " + prefix.strip()
    return title


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
        {"name": name, "sort": _make_title_sort_music(name)},
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


# --- Music lookup endpoints ---

@app.get("/music/release-types")
def get_music_release_types():
    db = SessionLocal()
    try:
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
    finally:
        db.close()


@app.get("/music/format-types")
def get_music_format_types():
    db = SessionLocal()
    try:
        rows = db.execute(
            text("SELECT format_type_id, format_name FROM lkup_music_format_types WHERE is_active=1 ORDER BY sort_order")
        ).fetchall()
        return [{"format_type_id": r[0], "format_name": r[1]} for r in rows]
    finally:
        db.close()


@app.get("/music/genres")
def get_music_genres():
    db = SessionLocal()
    try:
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
    finally:
        db.close()


@app.get("/music/artists")
def search_music_artists(q: Optional[str] = None):
    db = SessionLocal()
    try:
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
    finally:
        db.close()


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


# --- Discogs lookup endpoints ---

@app.get("/music/discogs-search")
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


@app.get("/music/discogs-master/{master_id}")
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


# --- Music CRUD endpoints ---

@app.get("/music")
def list_music(
    search: Optional[str] = None,
    release_type_id: Optional[int] = None,
    ownership_status_id: Optional[int] = None,
):
    db = SessionLocal()
    try:
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
    finally:
        db.close()


@app.get("/music/{item_id}")
def get_music_release(item_id: int):
    db = SessionLocal()
    try:
        detail = _get_music_detail(db, item_id)
        if not detail:
            raise HTTPException(status_code=404, detail="Music release not found.")
        return detail
    finally:
        db.close()


@app.post("/music")
def create_music_release(payload: MusicReleaseCreate):
    db = SessionLocal()
    try:
        title_sort = _make_title_sort_music(payload.title)

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
                "cover": _resolve_cover_url(payload.cover_image_url, "music", item_id),
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
    finally:
        db.close()


@app.put("/music/{item_id}")
def update_music_release(item_id: int, payload: MusicReleaseUpdate):
    db = SessionLocal()
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
            detail_params["sort"] = _make_title_sort_music(payload.title)
        if payload.description is not None:
            detail_updates.append("description = :desc")
            detail_params["desc"] = payload.description
        if payload.release_date is not None:
            detail_updates.append("release_date = :date")
            detail_params["date"] = payload.release_date
        if payload.cover_image_url is not None:
            detail_updates.append("cover_image_url = :cover")
            detail_params["cover"] = _resolve_cover_url(payload.cover_image_url, "music", item_id)
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
    finally:
        db.close()


@app.delete("/music/{item_id}")
def delete_music_release(item_id: int):
    db = SessionLocal()
    try:
        existing = db.execute(
            text("SELECT item_id FROM tbl_items WHERE item_id = :id AND collection_type_id = :ct"),
            {"id": item_id, "ct": MUSIC_COLLECTION_TYPE_ID},
        ).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Music release not found.")

        files_to_delete = _delete_attachment_files(db, item_id)
        files_to_delete.extend(_collect_cover_file(db, "tbl_music_release_details", item_id))
        db.execute(text("DELETE FROM xref_music_release_artists WHERE item_id = :id"), {"id": item_id})
        db.execute(text("DELETE FROM xref_music_release_genres WHERE item_id = :id"), {"id": item_id})
        db.execute(text("DELETE FROM tbl_music_songs WHERE item_id = :id"), {"id": item_id})
        db.execute(text("DELETE FROM tbl_music_editions WHERE item_id = :id"), {"id": item_id})
        db.execute(text("DELETE FROM tbl_attachments WHERE item_id = :id"), {"id": item_id})
        db.execute(text("DELETE FROM tbl_music_release_details WHERE item_id = :id"), {"id": item_id})
        db.execute(text("DELETE FROM tbl_items WHERE item_id = :id"), {"id": item_id})

        db.commit()
        _remove_files(files_to_delete)
        return {"deleted": item_id}
    except HTTPException:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


@app.patch("/music/bulk")
def bulk_update_music(payload: MusicBulkUpdatePayload):
    db = SessionLocal()
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
    finally:
        db.close()


@app.post("/music/bulk-delete")
def bulk_delete_music(payload: BulkDeletePayload):
    db = SessionLocal()
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
            all_files.extend(_delete_attachment_files(db, item_id))
            all_files.extend(_collect_cover_file(db, "tbl_music_release_details", item_id))
            db.execute(text("DELETE FROM xref_music_release_artists WHERE item_id = :id"), {"id": item_id})
            db.execute(text("DELETE FROM xref_music_release_genres WHERE item_id = :id"), {"id": item_id})
            db.execute(text("DELETE FROM tbl_music_songs WHERE item_id = :id"), {"id": item_id})
            db.execute(text("DELETE FROM tbl_music_editions WHERE item_id = :id"), {"id": item_id})
            db.execute(text("DELETE FROM tbl_attachments WHERE item_id = :id"), {"id": item_id})
            db.execute(text("DELETE FROM tbl_music_release_details WHERE item_id = :id"), {"id": item_id})
            db.execute(text("DELETE FROM tbl_items WHERE item_id = :id"), {"id": item_id})

        db.commit()
        _remove_files(all_files)
        return {"deleted": payload.item_ids, "count": len(payload.item_ids)}
    except HTTPException:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


# ---------- Video module ----------

VIDEO_COLLECTION_TYPE_ID = _resolve_collection_type_id("video", 6)

# Category names that use seasons sub-table (vs copies)
_VIDEO_SEASONS_CATEGORIES = {"TV Series"}


class VideoCopyEntry(BaseModel):
    copy_id: Optional[int] = None
    format_type_id: Optional[int] = None
    ownership_status_id: Optional[int] = None
    notes: Optional[str] = None


class VideoSeasonEntry(BaseModel):
    season_id: Optional[int] = None
    season_number: int
    episode_count: Optional[int] = None
    format_type_id: Optional[int] = None
    ownership_status_id: Optional[int] = None
    notes: Optional[str] = None


class VideoCreate(BaseModel):
    title: str
    top_level_category_id: int  # Movie, TV Series, Miniseries, Concert/Live
    ownership_status_id: int
    reading_status_id: Optional[int] = None  # watch status
    release_date: Optional[str] = None
    runtime_minutes: Optional[int] = None
    description: Optional[str] = None
    cover_image_url: Optional[str] = None
    notes: Optional[str] = None
    api_source: Optional[str] = None
    external_work_id: Optional[str] = None  # TMDB ID
    director_names: List[str] = []
    cast_names: List[str] = []
    genres: List[dict] = []
    copies: List[VideoCopyEntry] = []    # for Movie/Miniseries/Concert
    seasons: List[VideoSeasonEntry] = []  # for TV Series


class VideoUpdate(BaseModel):
    title: Optional[str] = None
    top_level_category_id: Optional[int] = None
    ownership_status_id: Optional[int] = None
    reading_status_id: Optional[int] = None
    release_date: Optional[str] = None
    runtime_minutes: Optional[int] = None
    description: Optional[str] = None
    cover_image_url: Optional[str] = None
    notes: Optional[str] = None
    api_source: Optional[str] = None
    external_work_id: Optional[str] = None
    director_names: Optional[List[str]] = None
    cast_names: Optional[List[str]] = None
    genres: Optional[List[dict]] = None
    copies: Optional[List[VideoCopyEntry]] = None
    seasons: Optional[List[VideoSeasonEntry]] = None


class VideoBulkUpdateFields(BaseModel):
    ownership_status_id: Optional[int] = None
    reading_status_id: Optional[int] = None
    top_level_category_id: Optional[int] = None


class VideoBulkUpdatePayload(BaseModel):
    item_ids: List[int]
    fields: VideoBulkUpdateFields


# --- Video helpers ---

def _make_title_sort_video(title: str) -> str:
    for prefix in ("The ", "A ", "An "):
        if title.startswith(prefix):
            return title[len(prefix):] + ", " + prefix.strip()
    return title


def _upsert_video_director(db, name: str) -> int:
    name = name.strip()
    row = db.execute(
        text("SELECT director_id FROM lkup_video_directors WHERE director_name = :name"),
        {"name": name},
    ).fetchone()
    if row:
        return row[0]
    result = db.execute(
        text("INSERT INTO lkup_video_directors (director_name) VALUES (:name)"),
        {"name": name},
    )
    return result.lastrowid


def _upsert_video_cast_member(db, name: str) -> int:
    name = name.strip()
    row = db.execute(
        text("SELECT cast_id FROM lkup_video_cast WHERE cast_name = :name"),
        {"name": name},
    ).fetchone()
    if row:
        return row[0]
    result = db.execute(
        text("INSERT INTO lkup_video_cast (cast_name) VALUES (:name)"),
        {"name": name},
    )
    return result.lastrowid


def _insert_video_relationships(db, item_id: int, payload):
    # Directors
    for order, name in enumerate(payload.director_names or []):
        name = name.strip()
        if not name:
            continue
        dir_id = _upsert_video_director(db, name)
        db.execute(
            text("INSERT OR IGNORE INTO xref_video_directors (item_id, director_id, director_order) VALUES (:iid, :did, :ord)"),
            {"iid": item_id, "did": dir_id, "ord": order},
        )

    # Cast
    for order, name in enumerate(payload.cast_names or []):
        name = name.strip()
        if not name:
            continue
        cast_id = _upsert_video_cast_member(db, name)
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
            LEFT JOIN lkup_book_read_statuses rs ON i.reading_status_id = rs.read_status_id
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

@app.get("/video/categories")
def get_video_categories():
    db = SessionLocal()
    try:
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
    finally:
        db.close()


@app.get("/video/format-types")
def get_video_format_types():
    db = SessionLocal()
    try:
        rows = db.execute(
            text("SELECT format_type_id, format_name FROM lkup_video_format_types WHERE is_active=1 ORDER BY sort_order")
        ).fetchall()
        return [{"format_type_id": r[0], "format_name": r[1]} for r in rows]
    finally:
        db.close()


@app.get("/video/genres")
def get_video_genres():
    db = SessionLocal()
    try:
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
    finally:
        db.close()


@app.get("/video/directors")
def search_video_directors(q: Optional[str] = None):
    db = SessionLocal()
    try:
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
    finally:
        db.close()


@app.get("/video/cast")
def search_video_cast(q: Optional[str] = None):
    db = SessionLocal()
    try:
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
    finally:
        db.close()


@app.get("/video/watch-statuses")
def get_video_watch_statuses():
    db = SessionLocal()
    try:
        rows = db.execute(
            text("""
                SELECT read_status_id, status_name
                FROM lkup_book_read_statuses
                WHERE status_name IN ('Watched', 'Currently Watching', 'Want to Watch', 'Abandoned')
                ORDER BY sort_order
            """)
        ).fetchall()
        return [{"read_status_id": r[0], "status_name": r[1]} for r in rows]
    finally:
        db.close()


@app.get("/video/tmdb-search")
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


@app.get("/video/tmdb-detail/{tmdb_id}")
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


@app.get("/video")
def list_video(
    search: Optional[str] = None,
    video_type_id: Optional[int] = None,
    ownership_status_id: Optional[int] = None,
    reading_status_id: Optional[int] = None,
):
    db = SessionLocal()
    try:
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
                LEFT JOIN lkup_book_read_statuses rs ON i.reading_status_id = rs.read_status_id
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
    finally:
        db.close()


@app.get("/video/{item_id}")
def get_video(item_id: int):
    db = SessionLocal()
    try:
        detail = _get_video_detail(db, item_id)
        if not detail:
            raise HTTPException(status_code=404, detail="Video not found.")
        return detail
    finally:
        db.close()


@app.post("/video")
def create_video(payload: VideoCreate):
    db = SessionLocal()
    try:
        title_sort = _make_title_sort_video(payload.title)

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
                "cover": _resolve_cover_url(payload.cover_image_url, "video", item_id),
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
    finally:
        db.close()


@app.put("/video/{item_id}")
def update_video(item_id: int, payload: VideoUpdate):
    db = SessionLocal()
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
            detail_params["sort"] = _make_title_sort_video(payload.title)
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
            detail_params["cover"] = _resolve_cover_url(payload.cover_image_url, "video", item_id)
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
                dir_id = _upsert_video_director(db, name)
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
                cast_id = _upsert_video_cast_member(db, name)
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
    finally:
        db.close()


@app.delete("/video/{item_id}")
def delete_video(item_id: int):
    db = SessionLocal()
    try:
        existing = db.execute(
            text("SELECT item_id FROM tbl_items WHERE item_id = :id AND collection_type_id = :ct"),
            {"id": item_id, "ct": VIDEO_COLLECTION_TYPE_ID},
        ).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Video not found.")

        files_to_delete = _delete_attachment_files(db, item_id)
        files_to_delete.extend(_collect_cover_file(db, "tbl_video_details", item_id))
        db.execute(text("DELETE FROM xref_video_directors WHERE item_id = :id"), {"id": item_id})
        db.execute(text("DELETE FROM xref_video_cast WHERE item_id = :id"), {"id": item_id})
        db.execute(text("DELETE FROM xref_video_genres WHERE item_id = :id"), {"id": item_id})
        db.execute(text("DELETE FROM tbl_video_copies WHERE item_id = :id"), {"id": item_id})
        db.execute(text("DELETE FROM tbl_video_seasons WHERE item_id = :id"), {"id": item_id})
        db.execute(text("DELETE FROM tbl_attachments WHERE item_id = :id"), {"id": item_id})
        db.execute(text("DELETE FROM tbl_video_details WHERE item_id = :id"), {"id": item_id})
        db.execute(text("DELETE FROM tbl_items WHERE item_id = :id"), {"id": item_id})

        db.commit()
        _remove_files(files_to_delete)
        return {"deleted": item_id}
    except HTTPException:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


@app.patch("/video/bulk")
def bulk_update_video(payload: VideoBulkUpdatePayload):
    db = SessionLocal()
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
    finally:
        db.close()


@app.post("/video/bulk-delete")
def bulk_delete_video(payload: BulkDeletePayload):
    db = SessionLocal()
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
            all_files.extend(_delete_attachment_files(db, item_id))
            all_files.extend(_collect_cover_file(db, "tbl_video_details", item_id))
            db.execute(text("DELETE FROM xref_video_directors WHERE item_id = :id"), {"id": item_id})
            db.execute(text("DELETE FROM xref_video_cast WHERE item_id = :id"), {"id": item_id})
            db.execute(text("DELETE FROM xref_video_genres WHERE item_id = :id"), {"id": item_id})
            db.execute(text("DELETE FROM tbl_video_copies WHERE item_id = :id"), {"id": item_id})
            db.execute(text("DELETE FROM tbl_video_seasons WHERE item_id = :id"), {"id": item_id})
            db.execute(text("DELETE FROM tbl_attachments WHERE item_id = :id"), {"id": item_id})
            db.execute(text("DELETE FROM tbl_video_details WHERE item_id = :id"), {"id": item_id})
            db.execute(text("DELETE FROM tbl_items WHERE item_id = :id"), {"id": item_id})

        db.commit()
        _remove_files(all_files)
        return {"deleted": payload.item_ids, "count": len(payload.item_ids)}
    except HTTPException:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


# ============================================================
# BOARD GAMES MODULE
# ============================================================

BOARDGAMES_COLLECTION_TYPE_ID = _resolve_collection_type_id("boardgames", 7)


class BoardgameExpansionEntry(BaseModel):
    expansion_id: Optional[int] = None
    title: str
    year_published: Optional[int] = None
    ownership_status_id: Optional[int] = None
    external_work_id: Optional[str] = None


class BoardgameCreate(BaseModel):
    top_level_category_id: int
    ownership_status_id: int
    notes: Optional[str] = None
    title: str
    description: Optional[str] = None
    year_published: Optional[int] = None
    min_players: Optional[int] = None
    max_players: Optional[int] = None
    publisher_name: Optional[str] = None
    designer_names: Optional[List[str]] = None
    expansions: Optional[List[BoardgameExpansionEntry]] = None
    cover_image_url: Optional[str] = None
    api_source: Optional[str] = None
    external_work_id: Optional[str] = None


class BoardgameUpdate(BaseModel):
    top_level_category_id: int
    ownership_status_id: int
    notes: Optional[str] = None
    title: str
    description: Optional[str] = None
    year_published: Optional[int] = None
    min_players: Optional[int] = None
    max_players: Optional[int] = None
    publisher_name: Optional[str] = None
    designer_names: Optional[List[str]] = None
    expansions: Optional[List[BoardgameExpansionEntry]] = None
    cover_image_url: Optional[str] = None
    api_source: Optional[str] = None
    external_work_id: Optional[str] = None


class BoardgameBulkUpdateFields(BaseModel):
    ownership_status_id: Optional[int] = None
    top_level_category_id: Optional[int] = None


class BoardgameBulkUpdatePayload(BaseModel):
    item_ids: List[int]
    fields: BoardgameBulkUpdateFields


# --- Board Games helpers ---

def _upsert_boardgame_designer(db, name: str) -> int:
    clean = name.strip()
    existing = db.execute(
        text("SELECT designer_id FROM lkup_boardgame_designers WHERE LOWER(TRIM(designer_name)) = LOWER(TRIM(:name))"),
        {"name": clean},
    ).fetchone()
    if existing:
        return existing[0]
    result = db.execute(
        text("INSERT INTO lkup_boardgame_designers (designer_name) VALUES (:name) RETURNING designer_id"),
        {"name": clean},
    ).fetchone()
    return result[0]


def _upsert_boardgame_publisher(db, name: str) -> int:
    clean = name.strip()
    existing = db.execute(
        text("SELECT publisher_id FROM lkup_boardgame_publishers WHERE LOWER(TRIM(publisher_name)) = LOWER(TRIM(:name))"),
        {"name": clean},
    ).fetchone()
    if existing:
        return existing[0]
    result = db.execute(
        text("INSERT INTO lkup_boardgame_publishers (publisher_name) VALUES (:name) RETURNING publisher_id"),
        {"name": clean},
    ).fetchone()
    return result[0]


def _insert_boardgame_designers(db, item_id: int, designer_names) -> None:
    if not designer_names:
        return
    for order, name in enumerate(designer_names):
        if name.strip():
            designer_id = _upsert_boardgame_designer(db, name)
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
                bd.cover_image_url,
                bd.api_source,
                bd.external_work_id
            FROM tbl_items i
            JOIN tbl_boardgame_details bd ON i.item_id = bd.item_id
            JOIN lkup_ownership_statuses os ON i.ownership_status_id = os.ownership_status_id
            JOIN lkup_top_level_categories ltc ON i.top_level_category_id = ltc.top_level_category_id
            WHERE i.item_id = :item_id AND i.collection_type_id = :ct
        """),
        {"item_id": item_id, "ct": BOARDGAMES_COLLECTION_TYPE_ID},
    ).fetchone()

    if not row:
        return None

    publisher = None
    publisher_name = None
    if row[14]:
        pub_row = db.execute(
            text("SELECT publisher_id, publisher_name FROM lkup_boardgame_publishers WHERE publisher_id = :id"),
            {"id": row[14]},
        ).fetchone()
        if pub_row:
            publisher = {"publisher_id": pub_row[0], "publisher_name": pub_row[1]}
            publisher_name = pub_row[1]

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
        "cover_image_url": row[15],
        "api_source": row[16],
        "external_work_id": row[17],
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


# --- Board Games lookup endpoints ---
# NOTE: specific paths must appear before /{item_id}

@app.get("/boardgames/categories")
def get_boardgame_categories():
    db = SessionLocal()
    try:
        rows = db.execute(text("""
            SELECT ltc.top_level_category_id, ltc.category_name FROM lkup_top_level_categories ltc
            JOIN lkup_collection_types lct ON ltc.collection_type_id = lct.collection_type_id
            WHERE lct.collection_type_code = 'boardgames' AND ltc.is_active = 1
            ORDER BY ltc.sort_order
        """)).fetchall()
        return [{"top_level_category_id": r[0], "category_name": r[1]} for r in rows]
    finally:
        db.close()


@app.get("/boardgames/designers")
def get_boardgame_designers(q: Optional[str] = None):
    db = SessionLocal()
    try:
        if q:
            rows = db.execute(
                text("SELECT designer_id, designer_name FROM lkup_boardgame_designers WHERE is_active = 1 AND LOWER(designer_name) LIKE LOWER(:q) ORDER BY designer_name LIMIT 20"),
                {"q": f"%{q}%"},
            ).fetchall()
        else:
            rows = db.execute(text("SELECT designer_id, designer_name FROM lkup_boardgame_designers WHERE is_active = 1 ORDER BY designer_name")).fetchall()
        return [{"designer_id": r[0], "designer_name": r[1]} for r in rows]
    finally:
        db.close()


@app.get("/boardgames/publishers")
def get_boardgame_publishers(q: Optional[str] = None):
    db = SessionLocal()
    try:
        if q:
            rows = db.execute(
                text("SELECT publisher_id, publisher_name FROM lkup_boardgame_publishers WHERE is_active = 1 AND LOWER(publisher_name) LIKE LOWER(:q) ORDER BY publisher_name LIMIT 20"),
                {"q": f"%{q}%"},
            ).fetchall()
        else:
            rows = db.execute(text("SELECT publisher_id, publisher_name FROM lkup_boardgame_publishers WHERE is_active = 1 ORDER BY publisher_name")).fetchall()
        return [{"publisher_id": r[0], "publisher_name": r[1]} for r in rows]
    finally:
        db.close()


@app.get("/boardgames/bgg-search")
def bgg_search(q: str):
    """Search BoardGameGeek XML API v2. Returns lightweight result list."""
    if not q or not q.strip():
        return []
    encoded = urllib.parse.quote(q.strip())
    url = f"https://boardgamegeek.com/xmlapi2/search?query={encoded}&type=boardgame"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "CollectCore/1.0"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            xml_data = resp.read().decode("utf-8")
        import xml.etree.ElementTree as ET
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


@app.get("/boardgames/bgg-detail/{bgg_id}")
def bgg_detail(bgg_id: str):
    """Fetch detailed info from BGG for a single game (used to pre-fill the form)."""
    url = f"https://boardgamegeek.com/xmlapi2/thing?id={bgg_id}&stats=0"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "CollectCore/1.0"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            xml_data = resp.read().decode("utf-8")
        import xml.etree.ElementTree as ET
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


@app.get("/boardgames")
def list_boardgames():
    db = SessionLocal()
    try:
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
    finally:
        db.close()


@app.get("/boardgames/{item_id}")
def get_boardgame(item_id: int):
    db = SessionLocal()
    try:
        game = _get_boardgame_detail(db, item_id)
        if not game:
            raise HTTPException(status_code=404, detail="Board game not found.")
        return game
    finally:
        db.close()


@app.post("/boardgames")
def create_boardgame(payload: BoardgameCreate):
    db = SessionLocal()
    try:
        publisher_id = None
        if payload.publisher_name and payload.publisher_name.strip():
            publisher_id = _upsert_boardgame_publisher(db, payload.publisher_name)

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
                "title_sort": _make_title_sort(payload.title.strip()),
                "description": payload.description,
                "year": payload.year_published,
                "min_p": payload.min_players,
                "max_p": payload.max_players,
                "pub_id": publisher_id,
                "cover": _resolve_cover_url(payload.cover_image_url, "boardgames", item_id),
                "api_source": payload.api_source,
                "ext_id": payload.external_work_id,
            },
        )

        _insert_boardgame_designers(db, item_id, payload.designer_names or [])
        _insert_boardgame_expansions(db, item_id, payload.expansions or [])
        db.commit()

        game = _get_boardgame_detail(db, item_id)
        return {"item_id": item_id, "status": "created", "boardgame": game}
    except HTTPException:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


@app.put("/boardgames/{item_id}")
def update_boardgame(item_id: int, payload: BoardgameUpdate):
    db = SessionLocal()
    try:
        existing = db.execute(
            text("SELECT item_id FROM tbl_items WHERE item_id = :id AND collection_type_id = :ct"),
            {"id": item_id, "ct": BOARDGAMES_COLLECTION_TYPE_ID},
        ).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Board game not found.")

        publisher_id = None
        if payload.publisher_name and payload.publisher_name.strip():
            publisher_id = _upsert_boardgame_publisher(db, payload.publisher_name)

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
                "title_sort": _make_title_sort(payload.title.strip()),
                "description": payload.description,
                "year": payload.year_published,
                "min_p": payload.min_players,
                "max_p": payload.max_players,
                "pub_id": publisher_id,
                "cover": _resolve_cover_url(payload.cover_image_url, "boardgames", item_id),
                "api_source": payload.api_source,
                "ext_id": payload.external_work_id,
            },
        )

        db.execute(text("DELETE FROM xref_boardgame_designers WHERE item_id = :id"), {"id": item_id})
        db.execute(text("DELETE FROM tbl_boardgame_expansions WHERE item_id = :id"), {"id": item_id})
        _insert_boardgame_designers(db, item_id, payload.designer_names or [])
        _insert_boardgame_expansions(db, item_id, payload.expansions or [])

        db.commit()
        game = _get_boardgame_detail(db, item_id)
        return {"item_id": item_id, "status": "updated", "boardgame": game}
    except HTTPException:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


@app.delete("/boardgames/{item_id}")
def delete_boardgame(item_id: int):
    db = SessionLocal()
    try:
        existing = db.execute(
            text("SELECT item_id FROM tbl_items WHERE item_id = :id AND collection_type_id = :ct"),
            {"id": item_id, "ct": BOARDGAMES_COLLECTION_TYPE_ID},
        ).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Board game not found.")

        files_to_delete = _delete_attachment_files(db, item_id)
        files_to_delete.extend(_collect_cover_file(db, "tbl_boardgame_details", item_id))
        db.execute(text("DELETE FROM xref_boardgame_designers WHERE item_id = :id"), {"id": item_id})
        db.execute(text("DELETE FROM tbl_boardgame_expansions WHERE item_id = :id"), {"id": item_id})
        db.execute(text("DELETE FROM tbl_attachments WHERE item_id = :id"), {"id": item_id})
        db.execute(text("DELETE FROM tbl_boardgame_details WHERE item_id = :id"), {"id": item_id})
        db.execute(text("DELETE FROM tbl_items WHERE item_id = :id"), {"id": item_id})

        db.commit()
        _remove_files(files_to_delete)
        return {"deleted": item_id}
    except HTTPException:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


@app.patch("/boardgames/bulk")
def bulk_update_boardgames(payload: BoardgameBulkUpdatePayload):
    db = SessionLocal()
    try:
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
    except HTTPException:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


@app.post("/boardgames/bulk-delete")
def bulk_delete_boardgames(payload: BulkDeletePayload):
    db = SessionLocal()
    try:
        for item_id in payload.item_ids:
            existing = db.execute(
                text("SELECT item_id FROM tbl_items WHERE item_id = :id AND collection_type_id = :ct"),
                {"id": item_id, "ct": BOARDGAMES_COLLECTION_TYPE_ID},
            ).fetchone()
            if not existing:
                raise HTTPException(status_code=404, detail=f"Item {item_id} not found.")

        all_files = []
        for item_id in payload.item_ids:
            all_files.extend(_delete_attachment_files(db, item_id))
            all_files.extend(_collect_cover_file(db, "tbl_boardgame_details", item_id))
            db.execute(text("DELETE FROM xref_boardgame_designers WHERE item_id = :id"), {"id": item_id})
            db.execute(text("DELETE FROM tbl_boardgame_expansions WHERE item_id = :id"), {"id": item_id})
            db.execute(text("DELETE FROM tbl_attachments WHERE item_id = :id"), {"id": item_id})
            db.execute(text("DELETE FROM tbl_boardgame_details WHERE item_id = :id"), {"id": item_id})
            db.execute(text("DELETE FROM tbl_items WHERE item_id = :id"), {"id": item_id})

        db.commit()
        _remove_files(all_files)
        return {"deleted": payload.item_ids, "count": len(payload.item_ids)}
    except HTTPException:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


# ---------- Cover image upload (all modules except photocards) ----------

_ALLOWED_IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp", ".gif"}

_VALID_COVER_MODULES = set(COVER_DIRS.keys()) - {"gn"}  # GN already handled; include all others
_VALID_COVER_MODULES.add("gn")  # actually include GN too for consistency


@app.post("/upload-cover")
async def upload_cover(
    file: UploadFile = File(...),
    module: str = Query(..., description="Module code: books, gn, videogames, music, video, boardgames, ttrpg"),
    item_id: Optional[int] = Query(None, description="Item ID (omit for staging during new-item creation)"),
):
    """Upload a cover image file for any module.

    If item_id is provided, saves directly as the final filename.
    If item_id is omitted, saves as a staging file and returns the path
    (the create endpoint will rename it to the final name).
    """
    if module not in COVER_DIRS:
        raise HTTPException(status_code=400, detail=f"Unknown module: {module}")
    ext = Path(file.filename).suffix.lower() if file.filename else ""
    if ext not in _ALLOWED_IMAGE_SUFFIXES:
        raise HTTPException(status_code=400, detail=f"Unsupported file type: {ext}")

    data = await file.read()
    cover_dir = COVER_DIRS[module]
    ext_clean = ext.lstrip(".")

    if item_id is not None:
        filename = f"{module}_{item_id:06d}.{ext_clean}"
    else:
        import uuid
        filename = f"staging_{uuid.uuid4().hex[:12]}.{ext_clean}"

    dest = cover_dir / filename
    dest.write_bytes(data)
    url_path = f"/images/library/{module}/{filename}"

    # If item_id was provided, update the cover in the DB too
    if item_id is not None:
        _update_cover_in_db(module, item_id, url_path)

    return {"url": url_path, "filename": filename}


def _update_cover_in_db(module: str, item_id: int, url_path: str):
    """Update cover_image_url in the appropriate detail table for the given module."""
    table_map = {
        "books": "tbl_book_copies",
        "gn": "tbl_graphicnovel_details",
        "videogames": "tbl_game_details",
        "music": "tbl_music_release_details",
        "video": "tbl_video_details",
        "boardgames": "tbl_boardgame_details",
        "ttrpg": "tbl_ttrpg_details",
    }
    table = table_map.get(module)
    if not table:
        return
    db = SessionLocal()
    try:
        db.execute(
            text(f"UPDATE {table} SET cover_image_url = :url WHERE item_id = :id"),
            {"url": url_path, "id": item_id},
        )
        db.commit()
    finally:
        db.close()


# ---------- Ingest endpoints ----------


@app.get("/ingest/inbox")
def list_inbox():
    files = []
    for f in INBOX_DIR.iterdir():
        if f.is_file() and f.suffix.lower() in _ALLOWED_IMAGE_SUFFIXES:
            stat = f.stat()
            files.append({
                "filename": f.name,
                "size": stat.st_size,
                "mtime": stat.st_mtime,
            })
    return sorted(files, key=lambda x: x["mtime"])


@app.delete("/ingest/inbox/{filename}")
def delete_inbox_file(filename: str):
    safe_name = Path(filename).name
    file_path = INBOX_DIR / safe_name
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found in inbox")
    file_path.unlink()
    return {"deleted": safe_name}


@app.post("/ingest/upload")
async def upload_to_inbox(file: UploadFile = File(...)):
    if Path(file.filename).suffix.lower() not in _ALLOWED_IMAGE_SUFFIXES:
        raise HTTPException(status_code=400, detail="Unsupported file type.")

    dest = INBOX_DIR / file.filename
    with open(dest, "wb") as out:
        shutil.copyfileobj(file.file, out)

    stat = dest.stat()
    return {"filename": file.filename, "size": stat.st_size, "mtime": stat.st_mtime, "status": "uploaded"}


class IngestFrontPayload(BaseModel):
    inbox_filename: str
    collection_type_id: int
    top_level_category_id: int
    ownership_status_id: int
    notes: Optional[str] = None
    group_id: int
    source_origin_id: Optional[int] = None
    version: Optional[str] = None
    member_ids: List[int]
    is_special: bool = False


@app.post("/ingest/front")
def ingest_front(payload: IngestFrontPayload):
    inbox_path = INBOX_DIR / payload.inbox_filename
    if not inbox_path.exists():
        raise HTTPException(status_code=404, detail=f"File not found in inbox: {payload.inbox_filename}")

    db = SessionLocal()
    try:
        group_row = db.execute(
            text("SELECT group_code FROM lkup_photocard_groups WHERE group_id = :gid"),
            {"gid": payload.group_id},
        ).fetchone()
        if not group_row:
            raise HTTPException(status_code=404, detail="Group not found.")
        group_code = group_row[0]

        item_result = db.execute(
            text("""
                INSERT INTO tbl_items (collection_type_id, top_level_category_id, ownership_status_id, notes)
                VALUES (:collection_type_id, :top_level_category_id, :ownership_status_id, :notes)
                RETURNING item_id
            """),
            {
                "collection_type_id": payload.collection_type_id,
                "top_level_category_id": payload.top_level_category_id,
                "ownership_status_id": payload.ownership_status_id,
                "notes": payload.notes,
            },
        ).fetchone()
        item_id = item_result[0]

        db.execute(
            text("""
                INSERT INTO tbl_photocard_details (item_id, group_id, source_origin_id, version, is_special)
                VALUES (:item_id, :group_id, :source_origin_id, :version, :is_special)
            """),
            {
                "item_id": item_id,
                "group_id": payload.group_id,
                "source_origin_id": payload.source_origin_id,
                "version": payload.version,
                "is_special": 1 if payload.is_special else 0,
            },
        )

        for member_id in payload.member_ids:
            db.execute(
                text("INSERT INTO xref_photocard_members (item_id, member_id) VALUES (:item_id, :member_id)"),
                {"item_id": item_id, "member_id": member_id},
            )

        ext = inbox_path.suffix.lower()
        library_filename = f"{group_code}_{item_id:06d}_f{ext}"
        library_path = LIBRARY_DIR / library_filename

        shutil.move(str(inbox_path), str(library_path))

        db.execute(
            text("""
                INSERT INTO tbl_attachments (item_id, attachment_type, file_path)
                VALUES (:item_id, 'front', :file_path)
            """),
            {"item_id": item_id, "file_path": f"images/library/{library_filename}"},
        )

        db.commit()

        return {"item_id": item_id, "filename": library_filename, "status": "ingested"}
    except HTTPException:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


@app.get("/ingest/candidates")
def get_ingest_candidates(
    group_id: int,
    category_id: int,
    missing_back_only: bool = True,
    member_ids: Optional[List[int]] = Query(default=None),
):
    db = SessionLocal()
    try:
        having_clause = ""
        if missing_back_only:
            having_clause = " HAVING MAX(CASE WHEN a.attachment_type = 'back' THEN 1 ELSE 0 END) = 0"

        member_filter = ""
        params: dict = {"group_id": group_id, "category_id": category_id}

        if member_ids:
            placeholders = ",".join(str(m) for m in member_ids)
            member_filter = f"""
                AND i.item_id IN (
                    SELECT item_id FROM xref_photocard_members
                    WHERE member_id IN ({placeholders})
                )
            """

        result = db.execute(
            text(
                _PHOTOCARD_SELECT
                + " AND p.group_id = :group_id AND i.top_level_category_id = :category_id"
                + member_filter
                + _PHOTOCARD_GROUP_BY
                + having_clause
                + " ORDER BY i.item_id DESC"
            ),
            params,
        ).fetchall()

        return [_photocard_row_to_dict(row) for row in result]
    finally:
        db.close()


class IngestPairPayload(BaseModel):
    front_filename: str
    back_filename: str
    collection_type_id: int
    top_level_category_id: int
    ownership_status_id: int
    notes: Optional[str] = None
    group_id: int
    source_origin_id: Optional[int] = None
    version: Optional[str] = None
    member_ids: List[int]
    is_special: bool = False


class AttachBackPayload(BaseModel):
    inbox_filename: str
    item_id: int


@app.post("/ingest/pair")
def ingest_pair(payload: IngestPairPayload):
    front_path = INBOX_DIR / payload.front_filename
    back_path = INBOX_DIR / payload.back_filename

    if not front_path.exists():
        raise HTTPException(status_code=404, detail=f"Front file not found in inbox: {payload.front_filename}")
    if not back_path.exists():
        raise HTTPException(status_code=404, detail=f"Back file not found in inbox: {payload.back_filename}")

    db = SessionLocal()
    try:
        group_row = db.execute(
            text("SELECT group_code FROM lkup_photocard_groups WHERE group_id = :gid"),
            {"gid": payload.group_id},
        ).fetchone()
        if not group_row:
            raise HTTPException(status_code=404, detail="Group not found.")
        group_code = group_row[0]

        item_result = db.execute(
            text("""
                INSERT INTO tbl_items (collection_type_id, top_level_category_id, ownership_status_id, notes)
                VALUES (:collection_type_id, :top_level_category_id, :ownership_status_id, :notes)
                RETURNING item_id
            """),
            {
                "collection_type_id": payload.collection_type_id,
                "top_level_category_id": payload.top_level_category_id,
                "ownership_status_id": payload.ownership_status_id,
                "notes": payload.notes,
            },
        ).fetchone()
        item_id = item_result[0]

        db.execute(
            text("""
                INSERT INTO tbl_photocard_details (item_id, group_id, source_origin_id, version, is_special)
                VALUES (:item_id, :group_id, :source_origin_id, :version, :is_special)
            """),
            {
                "item_id": item_id,
                "group_id": payload.group_id,
                "source_origin_id": payload.source_origin_id,
                "version": payload.version,
                "is_special": 1 if payload.is_special else 0,
            },
        )

        for member_id in payload.member_ids:
            db.execute(
                text("INSERT INTO xref_photocard_members (item_id, member_id) VALUES (:item_id, :member_id)"),
                {"item_id": item_id, "member_id": member_id},
            )

        front_ext = front_path.suffix.lower()
        front_lib = f"{group_code}_{item_id:06d}_f{front_ext}"
        shutil.move(str(front_path), str(LIBRARY_DIR / front_lib))
        db.execute(
            text("INSERT INTO tbl_attachments (item_id, attachment_type, file_path) VALUES (:item_id, 'front', :fp)"),
            {"item_id": item_id, "fp": f"images/library/{front_lib}"},
        )

        back_ext = back_path.suffix.lower()
        back_lib = f"{group_code}_{item_id:06d}_b{back_ext}"
        shutil.move(str(back_path), str(LIBRARY_DIR / back_lib))
        db.execute(
            text("INSERT INTO tbl_attachments (item_id, attachment_type, file_path) VALUES (:item_id, 'back', :fp)"),
            {"item_id": item_id, "fp": f"images/library/{back_lib}"},
        )

        db.commit()

        return {
            "item_id": item_id,
            "front_filename": front_lib,
            "back_filename": back_lib,
            "status": "ingested",
        }
    except HTTPException:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


@app.post("/ingest/attach-back")
def attach_back(payload: AttachBackPayload):
    inbox_path = INBOX_DIR / payload.inbox_filename
    if not inbox_path.exists():
        raise HTTPException(status_code=404, detail=f"File not found in inbox: {payload.inbox_filename}")

    db = SessionLocal()
    try:
        row = db.execute(
            text("""
                SELECT g.group_code
                FROM tbl_items i
                JOIN tbl_photocard_details p ON i.item_id = p.item_id
                JOIN lkup_photocard_groups g ON p.group_id = g.group_id
                WHERE i.item_id = :item_id AND i.collection_type_id = 1
            """),
            {"item_id": payload.item_id},
        ).fetchone()

        if not row:
            raise HTTPException(status_code=404, detail="Photocard not found.")

        group_code = row[0]

        existing_back = db.execute(
            text("SELECT attachment_id, file_path FROM tbl_attachments WHERE item_id = :item_id AND attachment_type = 'back'"),
            {"item_id": payload.item_id},
        ).fetchone()

        ext = inbox_path.suffix.lower()
        library_filename = f"{group_code}_{payload.item_id:06d}_b{ext}"
        library_path = LIBRARY_DIR / library_filename

        shutil.move(str(inbox_path), str(library_path))

        if existing_back:
            old_path = APP_ROOT / existing_back[1]
            if old_path.exists():
                old_path.unlink()
            db.execute(
                text("UPDATE tbl_attachments SET file_path = :file_path WHERE item_id = :item_id AND attachment_type = 'back'"),
                {"file_path": f"images/library/{library_filename}", "item_id": payload.item_id},
            )
        else:
            db.execute(
                text("INSERT INTO tbl_attachments (item_id, attachment_type, file_path) VALUES (:item_id, 'back', :file_path)"),
                {"item_id": payload.item_id, "file_path": f"images/library/{library_filename}"},
            )

        db.commit()

        return {"item_id": payload.item_id, "filename": library_filename, "status": "attached"}
    except HTTPException:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def _replace_image(item_id: int, side: str, file: UploadFile):
    """Shared logic for replace-front and replace-back."""
    db = SessionLocal()
    try:
        row = db.execute(
            text("""
                SELECT g.group_code
                FROM tbl_items i
                JOIN tbl_photocard_details p ON i.item_id = p.item_id
                JOIN lkup_photocard_groups g ON p.group_id = g.group_id
                WHERE i.item_id = :item_id AND i.collection_type_id = 1
            """),
            {"item_id": item_id},
        ).fetchone()

        if not row:
            raise HTTPException(status_code=404, detail="Photocard not found.")

        group_code = row[0]
        attachment_type = "front" if side == "f" else "back"

        existing = db.execute(
            text("SELECT file_path FROM tbl_attachments WHERE item_id = :item_id AND attachment_type = :atype"),
            {"item_id": item_id, "atype": attachment_type},
        ).fetchone()

        ext = Path(file.filename).suffix.lower()
        library_filename = f"{group_code}_{item_id:06d}_{side}{ext}"
        library_path = LIBRARY_DIR / library_filename

        with open(library_path, "wb") as out:
            shutil.copyfileobj(file.file, out)

        if existing:
            old_path = APP_ROOT / existing[0]
            if old_path.exists() and old_path != library_path:
                old_path.unlink()
            db.execute(
                text("UPDATE tbl_attachments SET file_path = :fp WHERE item_id = :item_id AND attachment_type = :atype"),
                {"fp": f"images/library/{library_filename}", "item_id": item_id, "atype": attachment_type},
            )
        else:
            db.execute(
                text("INSERT INTO tbl_attachments (item_id, attachment_type, file_path) VALUES (:item_id, :atype, :fp)"),
                {"item_id": item_id, "atype": attachment_type, "fp": f"images/library/{library_filename}"},
            )

        db.commit()

        return {"item_id": item_id, "filename": library_filename, "status": "replaced"}
    except HTTPException:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


@app.post("/photocards/{item_id}/replace-front")
async def replace_front(item_id: int, file: UploadFile = File(...)):
    if Path(file.filename).suffix.lower() not in _ALLOWED_IMAGE_SUFFIXES:
        raise HTTPException(status_code=400, detail="Unsupported file type.")
    return _replace_image(item_id, "f", file)


@app.post("/photocards/{item_id}/replace-back")
async def replace_back(item_id: int, file: UploadFile = File(...)):
    if Path(file.filename).suffix.lower() not in _ALLOWED_IMAGE_SUFFIXES:
        raise HTTPException(status_code=400, detail="Unsupported file type.")
    return _replace_image(item_id, "b", file)


# ---------- Settings endpoints ----------


class SettingUpdate(BaseModel):
    value: str


@app.get("/settings")
def get_settings():
    db = SessionLocal()
    try:
        rows = db.execute(text("SELECT key, value FROM tbl_app_settings")).fetchall()
        return {row[0]: row[1] for row in rows}
    finally:
        db.close()


@app.put("/settings/{key}")
def put_setting(key: str, body: SettingUpdate):
    db = SessionLocal()
    try:
        db.execute(
            text(
                "INSERT INTO tbl_app_settings (key, value) VALUES (:key, :value) "
                "ON CONFLICT(key) DO UPDATE SET value = excluded.value"
            ),
            {"key": key, "value": body.value},
        )
        db.commit()
        row = db.execute(
            text("SELECT key, value FROM tbl_app_settings WHERE key = :key"),
            {"key": key},
        ).fetchone()
        return {"key": row[0], "value": row[1]}
    finally:
        db.close()


# ---------- Export endpoints ----------

class ExportPayload(BaseModel):
    item_ids: List[int]
    include_captions: bool = True
    include_backs: bool = False


def _build_caption(card: dict) -> list:
    """Return up to 3 caption lines: [members, source_origin, version]."""
    lines = []
    member_str = ", ".join(card["members"]) if card.get("members") else None
    lines.append(member_str or "—")
    lines.append(card.get("source_origin") or "")
    lines.append(card.get("version") or "")
    # Strip trailing empty lines
    while lines and not lines[-1]:
        lines.pop()
    return lines


def _generate_pdf(entries: list, include_captions: bool) -> bytes:
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.utils import ImageReader
    from reportlab.pdfgen import canvas as rl_canvas

    page_w, page_h = A4  # 595.28 x 841.89 pts
    margin = 20.0
    cols = 4
    gap = 6.0
    line_h = 8.5  # pts per caption line
    max_caption_lines = 3
    caption_h = (line_h * max_caption_lines + 3.0) if include_captions else 0.0

    content_w = page_w - 2 * margin
    cell_w = (content_w - gap * (cols - 1)) / cols
    img_h = cell_w * 1.54  # standard photocard portrait ratio
    cell_h = img_h + caption_h + gap

    rows_per_page = max(1, int((page_h - 2 * margin + gap) / (cell_h + gap)))
    per_page = cols * rows_per_page

    buf = io.BytesIO()
    c = rl_canvas.Canvas(buf, pagesize=A4)
    c.setFont("Helvetica", 7)

    for idx, entry in enumerate(entries):
        within_page = idx % per_page
        row = within_page // cols
        col = within_page % cols

        if within_page == 0 and idx > 0:
            c.showPage()
            c.setFont("Helvetica", 7)

        x = margin + col * (cell_w + gap)
        y = page_h - margin - (row + 1) * (cell_h + gap) + gap

        img_y = y + caption_h

        if entry["exists"]:
            try:
                ir = ImageReader(str(entry["path"]))
                iw, ih = ir.getSize()
                scale = min(cell_w / iw, img_h / ih)
                draw_w = iw * scale
                draw_h = ih * scale
                offset_x = (cell_w - draw_w) / 2
                offset_y = (img_h - draw_h) / 2
                c.drawImage(ir, x + offset_x, img_y + offset_y, draw_w, draw_h)
            except Exception:
                c.setFillColorRGB(0.85, 0.85, 0.85)
                c.rect(x, img_y, cell_w, img_h, fill=1, stroke=0)
                c.setFillColorRGB(0, 0, 0)
        else:
            c.setFillColorRGB(0.85, 0.85, 0.85)
            c.rect(x, img_y, cell_w, img_h, fill=1, stroke=0)
            c.setFillColorRGB(0, 0, 0)

        if include_captions and entry["caption"]:
            c.setFillColorRGB(0, 0, 0)
            max_chars = max(20, int(cell_w / 5.5))
            for i, line in enumerate(entry["caption"]):
                if not line:
                    continue
                text = line if len(line) <= max_chars else line[:max_chars - 1] + "…"
                line_y = y + 3 + (len(entry["caption"]) - 1 - i) * line_h
                c.drawString(x, line_y, text)

    c.save()
    return buf.getvalue()


@app.post("/export/photocards")
def export_photocards(payload: ExportPayload):
    if not payload.item_ids:
        raise HTTPException(status_code=400, detail="item_ids cannot be empty.")

    db = SessionLocal()
    try:
        placeholders = ",".join(str(i) for i in payload.item_ids)
        rows = db.execute(
            text(
                _PHOTOCARD_SELECT
                + f" AND i.item_id IN ({placeholders})"
                + _PHOTOCARD_GROUP_BY
            )
        ).fetchall()
    finally:
        db.close()

    order_map = {iid: idx for idx, iid in enumerate(payload.item_ids)}
    cards = sorted(
        [_photocard_row_to_dict(r) for r in rows],
        key=lambda c: order_map.get(c["item_id"], 0),
    )

    entries = []
    for card in cards:
        caption = _build_caption(card) if payload.include_captions else []
        # Always include a front entry — use placeholder if no image so the card is never silently dropped
        if card["front_image_path"]:
            front_path = APP_ROOT / card["front_image_path"]
            entries.append({"path": front_path, "caption": caption, "exists": front_path.exists()})
        else:
            entries.append({"path": None, "caption": caption, "exists": False})
        if payload.include_backs:
            back_caption = (caption[:-1] + [caption[-1] + " [back]"]) if (payload.include_captions and caption) else []
            if card["back_image_path"]:
                back_path = APP_ROOT / card["back_image_path"]
                entries.append({"path": back_path, "caption": back_caption, "exists": back_path.exists()})
            else:
                # Placeholder keeps grid alignment when a card has no back image
                entries.append({"path": None, "caption": back_caption, "exists": False})

    pdf_bytes = _generate_pdf(entries, payload.include_captions)

    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": "attachment; filename=photocard_export.pdf"},
    )


# ---------- Admin: Backup & Restore ----------

from db import DB_PATH


_backup_tokens: dict[str, dict] = {}  # token -> {path, filename, created}


@app.post("/admin/backup/prepare")
def prepare_backup():
    """Build the backup ZIP to a temp file and return metadata.

    The frontend calls this first to get progress info, then downloads
    via GET /admin/backup/download/{token}.
    """
    if not DB_PATH.exists():
        raise HTTPException(status_code=404, detail="Database file not found.")

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    zip_filename = f"collectcore_backup_{timestamp}.zip"

    # Count image files first (for progress reporting)
    image_files = []
    if LIBRARY_DIR.exists():
        image_files = [p for p in LIBRARY_DIR.rglob("*") if p.is_file()]

    tmp_zip = tempfile.NamedTemporaryFile(suffix=".zip", delete=False)
    tmp_zip_path = Path(tmp_zip.name)
    tmp_zip.close()

    try:
        with zipfile.ZipFile(str(tmp_zip_path), "w", compression=zipfile.ZIP_DEFLATED) as zf:
            # --- Database ---
            src_conn = sqlite3.connect(str(DB_PATH))
            dst_conn = sqlite3.connect(":memory:")
            src_conn.backup(dst_conn)
            src_conn.close()
            tmp_db = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
            tmp_db_path = Path(tmp_db.name)
            tmp_db.close()
            try:
                disk_conn = sqlite3.connect(str(tmp_db_path))
                dst_conn.backup(disk_conn)
                disk_conn.close()
                dst_conn.close()
                zf.write(tmp_db_path, "collectcore.db")
            finally:
                tmp_db_path.unlink(missing_ok=True)

            # --- Images ---
            for img_path in image_files:
                arcname = "images/library/" + img_path.relative_to(LIBRARY_DIR).as_posix()
                zf.write(img_path, arcname)

        size_bytes = tmp_zip_path.stat().st_size

        import uuid as _uuid
        token = _uuid.uuid4().hex[:16]
        _backup_tokens[token] = {
            "path": tmp_zip_path,
            "filename": zip_filename,
            "created": datetime.now(),
        }

        # Clean up old tokens (>30 min)
        cutoff = datetime.now()
        for k in list(_backup_tokens):
            info = _backup_tokens[k]
            if (cutoff - info["created"]).total_seconds() > 1800:
                try:
                    info["path"].unlink(missing_ok=True)
                except Exception:
                    pass
                del _backup_tokens[k]

        return {
            "token": token,
            "filename": zip_filename,
            "size_bytes": size_bytes,
            "image_count": len(image_files),
        }

    except Exception:
        tmp_zip_path.unlink(missing_ok=True)
        raise


@app.get("/admin/backup/download/{token}")
def download_backup_by_token(token: str):
    """Stream a previously prepared backup ZIP with Content-Length for progress tracking."""
    info = _backup_tokens.pop(token, None)
    if not info or not info["path"].exists():
        raise HTTPException(status_code=404, detail="Backup not found or expired. Please prepare a new backup.")

    zip_path: Path = info["path"]
    size = zip_path.stat().st_size

    def iterfile():
        with open(zip_path, "rb") as f:
            while chunk := f.read(1024 * 256):
                yield chunk
        zip_path.unlink(missing_ok=True)

    return StreamingResponse(
        iterfile(),
        media_type="application/zip",
        headers={
            "Content-Disposition": f"attachment; filename={info['filename']}",
            "Content-Length": str(size),
        },
    )


@app.get("/admin/backup")
def download_backup():
    """Legacy single-step backup — kept for backwards compatibility."""
    if not DB_PATH.exists():
        raise HTTPException(status_code=404, detail="Database file not found.")

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    zip_filename = f"collectcore_backup_{timestamp}.zip"

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        src_conn = sqlite3.connect(str(DB_PATH))
        dst_conn = sqlite3.connect(":memory:")
        src_conn.backup(dst_conn)
        src_conn.close()
        tmp_db = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        tmp_db_path = Path(tmp_db.name)
        tmp_db.close()
        try:
            disk_conn = sqlite3.connect(str(tmp_db_path))
            dst_conn.backup(disk_conn)
            disk_conn.close()
            dst_conn.close()
            zf.write(tmp_db_path, "collectcore.db")
        finally:
            tmp_db_path.unlink(missing_ok=True)

        if LIBRARY_DIR.exists():
            for img_path in LIBRARY_DIR.rglob("*"):
                if img_path.is_file():
                    arcname = "images/library/" + img_path.relative_to(LIBRARY_DIR).as_posix()
                    zf.write(img_path, arcname)

    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": f"attachment; filename={zip_filename}"},
    )


@app.post("/admin/restore")
async def upload_restore(file: UploadFile = File(...)):
    """
    Restore from a backup ZIP. Replaces the current database and library images.
    The ZIP must contain 'collectcore.db' at the root. The 'images/library/'
    folder inside the ZIP is optional — if present it replaces the current library.

    WARNING: This is destructive. The caller (UI) is responsible for confirming
    with the user before calling this endpoint.
    """
    if not file.filename.endswith(".zip"):
        raise HTTPException(status_code=400, detail="Uploaded file must be a .zip archive.")

    content = await file.read()

    try:
        with zipfile.ZipFile(io.BytesIO(content)) as zf:
            names = zf.namelist()

            if "collectcore.db" not in names:
                raise HTTPException(
                    status_code=400,
                    detail="Invalid backup: 'collectcore.db' not found in ZIP.",
                )

            # Write DB to a temp file first (outside the replace) so we can
            # dispose the engine before touching the live DB file.
            # On Windows, Path.replace() fails with PermissionError if the
            # destination file is held open by SQLAlchemy's connection pool.
            db_data = zf.read("collectcore.db")
            tmp_db = tempfile.NamedTemporaryFile(
                suffix=".db", dir=DB_PATH.parent, delete=False
            )
            tmp_db_path = Path(tmp_db.name)
            try:
                tmp_db.write(db_data)
                tmp_db.close()

                # Release all pooled connections before replacing the file
                from db import engine
                engine.dispose()

                tmp_db_path.replace(DB_PATH)
            except Exception:
                tmp_db_path.unlink(missing_ok=True)
                raise

            # Restore library images if present
            image_entries = [n for n in names if n.startswith("images/library/") and not n.endswith("/")]
            if image_entries:
                # Clear existing library images first
                if LIBRARY_DIR.exists():
                    shutil.rmtree(LIBRARY_DIR)
                LIBRARY_DIR.mkdir(parents=True, exist_ok=True)

                for entry in image_entries:
                    relative = entry[len("images/library/"):]
                    dest = LIBRARY_DIR / relative
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    dest.write_bytes(zf.read(entry))

    except zipfile.BadZipFile:
        raise HTTPException(status_code=400, detail="Uploaded file is not a valid ZIP archive.")

    return {
        "status": "restored",
        "db_restored": True,
        "images_restored": bool(image_entries) if "image_entries" in dir() else False,
    }


# ============================================================
# TTRPG MODULE
# ============================================================

TTRPG_COLLECTION_TYPE_ID = _resolve_collection_type_id("ttrpg", 8)


class TTRPGCopyEntry(BaseModel):
    copy_id: Optional[int] = None
    format_type_id: Optional[int] = None
    isbn_13: Optional[str] = None
    isbn_10: Optional[str] = None
    ownership_status_id: Optional[int] = None
    notes: Optional[str] = None


class TTRPGCreate(BaseModel):
    top_level_category_id: int
    ownership_status_id: int
    notes: Optional[str] = None
    title: str
    description: Optional[str] = None
    system_edition_name: Optional[str] = None
    line_name: Optional[str] = None
    book_type_id: Optional[int] = None
    publisher_name: Optional[str] = None
    author_names: Optional[List[str]] = None
    release_date: Optional[str] = None
    cover_image_url: Optional[str] = None
    api_source: Optional[str] = None
    external_work_id: Optional[str] = None
    copies: Optional[List[TTRPGCopyEntry]] = None


class TTRPGUpdate(BaseModel):
    top_level_category_id: int
    ownership_status_id: int
    notes: Optional[str] = None
    title: str
    description: Optional[str] = None
    system_edition_name: Optional[str] = None
    line_name: Optional[str] = None
    book_type_id: Optional[int] = None
    publisher_name: Optional[str] = None
    author_names: Optional[List[str]] = None
    release_date: Optional[str] = None
    cover_image_url: Optional[str] = None
    api_source: Optional[str] = None
    external_work_id: Optional[str] = None
    copies: Optional[List[TTRPGCopyEntry]] = None


class TTRPGBulkUpdateFields(BaseModel):
    ownership_status_id: Optional[int] = None
    top_level_category_id: Optional[int] = None


class TTRPGBulkUpdatePayload(BaseModel):
    item_ids: List[int]
    fields: TTRPGBulkUpdateFields


# --- TTRPG helpers ---

def _upsert_ttrpg_author(db, name: str) -> int:
    clean = name.strip()
    existing = db.execute(
        text("SELECT author_id FROM lkup_ttrpg_authors WHERE LOWER(TRIM(author_name)) = LOWER(TRIM(:name))"),
        {"name": clean},
    ).fetchone()
    if existing:
        return existing[0]
    result = db.execute(
        text("INSERT INTO lkup_ttrpg_authors (author_name) VALUES (:name) RETURNING author_id"),
        {"name": clean},
    ).fetchone()
    return result[0]


def _upsert_ttrpg_publisher(db, name: str) -> int:
    clean = name.strip()
    existing = db.execute(
        text("SELECT publisher_id FROM lkup_ttrpg_publishers WHERE LOWER(TRIM(publisher_name)) = LOWER(TRIM(:name))"),
        {"name": clean},
    ).fetchone()
    if existing:
        return existing[0]
    result = db.execute(
        text("INSERT INTO lkup_ttrpg_publishers (publisher_name) VALUES (:name) RETURNING publisher_id"),
        {"name": clean},
    ).fetchone()
    return result[0]


def _upsert_ttrpg_system_edition(db, system_category_id: int, name: str) -> int:
    clean = name.strip()
    existing = db.execute(
        text("SELECT edition_id FROM lkup_ttrpg_system_editions WHERE system_category_id = :sys AND LOWER(TRIM(edition_name)) = LOWER(TRIM(:name))"),
        {"sys": system_category_id, "name": clean},
    ).fetchone()
    if existing:
        return existing[0]
    result = db.execute(
        text("INSERT INTO lkup_ttrpg_system_editions (system_category_id, edition_name) VALUES (:sys, :name) RETURNING edition_id"),
        {"sys": system_category_id, "name": clean},
    ).fetchone()
    return result[0]


def _upsert_ttrpg_line(db, system_category_id: int, name: str) -> int:
    clean = name.strip()
    existing = db.execute(
        text("SELECT line_id FROM lkup_ttrpg_lines WHERE system_category_id = :sys AND LOWER(TRIM(line_name)) = LOWER(TRIM(:name))"),
        {"sys": system_category_id, "name": clean},
    ).fetchone()
    if existing:
        return existing[0]
    result = db.execute(
        text("INSERT INTO lkup_ttrpg_lines (system_category_id, line_name) VALUES (:sys, :name) RETURNING line_id"),
        {"sys": system_category_id, "name": clean},
    ).fetchone()
    return result[0]


def _insert_ttrpg_authors(db, item_id: int, author_names) -> None:
    if not author_names:
        return
    for order, name in enumerate(author_names):
        if name.strip():
            author_id = _upsert_ttrpg_author(db, name)
            db.execute(
                text("INSERT OR IGNORE INTO xref_ttrpg_book_authors (item_id, author_id, author_order) VALUES (:item_id, :aid, :ord)"),
                {"item_id": item_id, "aid": author_id, "ord": order},
            )


def _insert_ttrpg_copies(db, item_id: int, copies) -> None:
    if not copies:
        return
    for copy in copies:
        db.execute(
            text("""
                INSERT INTO tbl_ttrpg_copies (item_id, format_type_id, isbn_13, isbn_10, ownership_status_id, notes)
                VALUES (:item_id, :fmt, :isbn13, :isbn10, :own, :notes)
            """),
            {
                "item_id": item_id,
                "fmt": copy.format_type_id,
                "isbn13": copy.isbn_13,
                "isbn10": copy.isbn_10,
                "own": copy.ownership_status_id,
                "notes": copy.notes,
            },
        )


def _get_ttrpg_detail(db, item_id: int):
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
                td.title,
                td.title_sort,
                td.description,
                td.system_edition_id,
                td.line_id,
                td.book_type_id,
                td.publisher_id,
                td.release_date,
                td.cover_image_url,
                td.api_source,
                td.external_work_id
            FROM tbl_items i
            JOIN tbl_ttrpg_details td ON i.item_id = td.item_id
            JOIN lkup_ownership_statuses os ON i.ownership_status_id = os.ownership_status_id
            JOIN lkup_top_level_categories ltc ON i.top_level_category_id = ltc.top_level_category_id
            WHERE i.item_id = :item_id AND i.collection_type_id = :ct
        """),
        {"item_id": item_id, "ct": TTRPG_COLLECTION_TYPE_ID},
    ).fetchone()

    if not row:
        return None

    # system edition
    system_edition_name = None
    if row[11]:
        se_row = db.execute(
            text("SELECT edition_name FROM lkup_ttrpg_system_editions WHERE edition_id = :id"),
            {"id": row[11]},
        ).fetchone()
        if se_row:
            system_edition_name = se_row[0]

    # line
    line_name = None
    if row[12]:
        ln_row = db.execute(
            text("SELECT line_name FROM lkup_ttrpg_lines WHERE line_id = :id"),
            {"id": row[12]},
        ).fetchone()
        if ln_row:
            line_name = ln_row[0]

    # book type
    book_type_name = None
    if row[13]:
        bt_row = db.execute(
            text("SELECT book_type_name FROM lkup_ttrpg_book_types WHERE book_type_id = :id"),
            {"id": row[13]},
        ).fetchone()
        if bt_row:
            book_type_name = bt_row[0]

    # publisher
    publisher_name = None
    if row[14]:
        pub_row = db.execute(
            text("SELECT publisher_name FROM lkup_ttrpg_publishers WHERE publisher_id = :id"),
            {"id": row[14]},
        ).fetchone()
        if pub_row:
            publisher_name = pub_row[0]

    authors = db.execute(
        text("""
            SELECT a.author_id, a.author_name, x.author_order
            FROM xref_ttrpg_book_authors x
            JOIN lkup_ttrpg_authors a ON x.author_id = a.author_id
            WHERE x.item_id = :item_id
            ORDER BY x.author_order
        """),
        {"item_id": item_id},
    ).fetchall()

    copies = db.execute(
        text("""
            SELECT c.copy_id, c.format_type_id, ft.format_name, c.isbn_13, c.isbn_10,
                   c.ownership_status_id, os.status_name, c.notes
            FROM tbl_ttrpg_copies c
            LEFT JOIN lkup_ttrpg_format_types ft ON c.format_type_id = ft.format_type_id
            LEFT JOIN lkup_ownership_statuses os ON c.ownership_status_id = os.ownership_status_id
            WHERE c.item_id = :item_id
            ORDER BY c.copy_id
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
        "system_edition_id": row[11],
        "system_edition_name": system_edition_name,
        "line_id": row[12],
        "line_name": line_name,
        "book_type_id": row[13],
        "book_type_name": book_type_name,
        "publisher_id": row[14],
        "publisher_name": publisher_name,
        "release_date": row[15],
        "cover_image_url": row[16],
        "api_source": row[17],
        "external_work_id": row[18],
        "authors": [{"author_id": a[0], "author_name": a[1]} for a in authors],
        "author_names": [a[1] for a in authors],
        "copies": [
            {
                "copy_id": c[0],
                "format_type_id": c[1],
                "format_name": c[2],
                "isbn_13": c[3],
                "isbn_10": c[4],
                "ownership_status_id": c[5],
                "ownership_status": c[6],
                "notes": c[7],
            }
            for c in copies
        ],
    }


# --- TTRPG lookup endpoints ---
# NOTE: specific paths must appear before /{item_id}

@app.get("/ttrpg/systems")
def get_ttrpg_systems():
    db = SessionLocal()
    try:
        rows = db.execute(text("""
            SELECT ltc.top_level_category_id, ltc.category_name FROM lkup_top_level_categories ltc
            JOIN lkup_collection_types lct ON ltc.collection_type_id = lct.collection_type_id
            WHERE lct.collection_type_code = 'ttrpg' AND ltc.is_active = 1
            ORDER BY ltc.sort_order
        """)).fetchall()
        return [{"top_level_category_id": r[0], "category_name": r[1]} for r in rows]
    finally:
        db.close()


@app.get("/ttrpg/system-editions")
def get_ttrpg_system_editions(system_id: Optional[int] = None):
    db = SessionLocal()
    try:
        if system_id:
            rows = db.execute(
                text("SELECT edition_id, edition_name FROM lkup_ttrpg_system_editions WHERE system_category_id = :sys AND is_active = 1 ORDER BY sort_order, edition_name"),
                {"sys": system_id},
            ).fetchall()
        else:
            rows = db.execute(
                text("SELECT edition_id, edition_name FROM lkup_ttrpg_system_editions WHERE is_active = 1 ORDER BY edition_name"),
            ).fetchall()
        return [{"edition_id": r[0], "edition_name": r[1]} for r in rows]
    finally:
        db.close()


@app.get("/ttrpg/lines")
def get_ttrpg_lines(system_id: Optional[int] = None):
    db = SessionLocal()
    try:
        if system_id:
            rows = db.execute(
                text("SELECT line_id, line_name FROM lkup_ttrpg_lines WHERE system_category_id = :sys AND is_active = 1 ORDER BY sort_order, line_name"),
                {"sys": system_id},
            ).fetchall()
        else:
            rows = db.execute(
                text("SELECT line_id, line_name FROM lkup_ttrpg_lines WHERE is_active = 1 ORDER BY line_name"),
            ).fetchall()
        return [{"line_id": r[0], "line_name": r[1]} for r in rows]
    finally:
        db.close()


@app.get("/ttrpg/book-types")
def get_ttrpg_book_types():
    db = SessionLocal()
    try:
        rows = db.execute(text("SELECT book_type_id, book_type_name FROM lkup_ttrpg_book_types WHERE is_active = 1 ORDER BY sort_order")).fetchall()
        return [{"book_type_id": r[0], "book_type_name": r[1]} for r in rows]
    finally:
        db.close()


@app.get("/ttrpg/format-types")
def get_ttrpg_format_types():
    db = SessionLocal()
    try:
        rows = db.execute(text("SELECT format_type_id, format_name FROM lkup_ttrpg_format_types WHERE is_active = 1 ORDER BY sort_order")).fetchall()
        return [{"format_type_id": r[0], "format_name": r[1]} for r in rows]
    finally:
        db.close()


@app.get("/ttrpg/publishers")
def get_ttrpg_publishers(q: Optional[str] = None):
    db = SessionLocal()
    try:
        if q:
            rows = db.execute(
                text("SELECT publisher_id, publisher_name FROM lkup_ttrpg_publishers WHERE is_active = 1 AND LOWER(publisher_name) LIKE LOWER(:q) ORDER BY publisher_name LIMIT 20"),
                {"q": f"%{q}%"},
            ).fetchall()
        else:
            rows = db.execute(text("SELECT publisher_id, publisher_name FROM lkup_ttrpg_publishers WHERE is_active = 1 ORDER BY publisher_name")).fetchall()
        return [{"publisher_id": r[0], "publisher_name": r[1]} for r in rows]
    finally:
        db.close()


@app.get("/ttrpg/authors")
def get_ttrpg_authors(q: Optional[str] = None):
    db = SessionLocal()
    try:
        if q:
            rows = db.execute(
                text("SELECT author_id, author_name FROM lkup_ttrpg_authors WHERE is_active = 1 AND LOWER(author_name) LIKE LOWER(:q) ORDER BY author_name LIMIT 20"),
                {"q": f"%{q}%"},
            ).fetchall()
        else:
            rows = db.execute(text("SELECT author_id, author_name FROM lkup_ttrpg_authors WHERE is_active = 1 ORDER BY author_name")).fetchall()
        return [{"author_id": r[0], "author_name": r[1]} for r in rows]
    finally:
        db.close()


@app.get("/ttrpg")
def list_ttrpg():
    db = SessionLocal()
    try:
        rows = db.execute(
            text("""
                SELECT
                    i.item_id,
                    i.top_level_category_id,
                    ltc.category_name,
                    i.ownership_status_id,
                    os.status_name,
                    i.notes,
                    td.title,
                    td.title_sort,
                    td.release_date,
                    td.cover_image_url,
                    td.system_edition_id,
                    td.line_id,
                    td.book_type_id,
                    td.publisher_id,
                    (SELECT bt.book_type_name FROM lkup_ttrpg_book_types bt WHERE bt.book_type_id = td.book_type_id) AS book_type_name,
                    (SELECT se.edition_name FROM lkup_ttrpg_system_editions se WHERE se.edition_id = td.system_edition_id) AS system_edition_name,
                    (SELECT ln.line_name FROM lkup_ttrpg_lines ln WHERE ln.line_id = td.line_id) AS line_name,
                    (SELECT pub.publisher_name FROM lkup_ttrpg_publishers pub WHERE pub.publisher_id = td.publisher_id) AS publisher_name,
                    (SELECT GROUP_CONCAT(a.author_name, ', ')
                     FROM xref_ttrpg_book_authors x
                     JOIN lkup_ttrpg_authors a ON x.author_id = a.author_id
                     WHERE x.item_id = i.item_id
                     ORDER BY x.author_order) AS authors_str,
                    (SELECT GROUP_CONCAT(
                         COALESCE(ft.format_name, 'Unknown') || CASE WHEN own2.status_name IS NOT NULL THEN ' (' || own2.status_name || ')' ELSE '' END,
                         ', ')
                     FROM tbl_ttrpg_copies c
                     LEFT JOIN lkup_ttrpg_format_types ft ON c.format_type_id = ft.format_type_id
                     LEFT JOIN lkup_ownership_statuses own2 ON c.ownership_status_id = own2.ownership_status_id
                     WHERE c.item_id = i.item_id) AS copies_summary,
                    (SELECT COUNT(*) FROM tbl_ttrpg_copies c WHERE c.item_id = i.item_id) AS copy_count
                FROM tbl_items i
                JOIN tbl_ttrpg_details td ON i.item_id = td.item_id
                JOIN lkup_ownership_statuses os ON i.ownership_status_id = os.ownership_status_id
                JOIN lkup_top_level_categories ltc ON i.top_level_category_id = ltc.top_level_category_id
                WHERE i.collection_type_id = :ct
                ORDER BY COALESCE(td.title_sort, td.title)
            """),
            {"ct": TTRPG_COLLECTION_TYPE_ID},
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
                "release_date": row[8],
                "cover_image_url": row[9],
                "system_edition_id": row[10],
                "line_id": row[11],
                "book_type_id": row[12],
                "publisher_id": row[13],
                "book_type_name": row[14],
                "system_edition_name": row[15],
                "line_name": row[16],
                "publisher_name": row[17],
                "authors": row[18].split(", ") if row[18] else [],
                "copies_summary": row[19],
                "copy_count": row[20],
            }
            for row in rows
        ]
    finally:
        db.close()


@app.get("/ttrpg/{item_id}")
def get_ttrpg(item_id: int):
    db = SessionLocal()
    try:
        book = _get_ttrpg_detail(db, item_id)
        if not book:
            raise HTTPException(status_code=404, detail="TTRPG book not found.")
        return book
    finally:
        db.close()


@app.post("/ttrpg")
def create_ttrpg(payload: TTRPGCreate):
    db = SessionLocal()
    try:
        publisher_id = None
        if payload.publisher_name and payload.publisher_name.strip():
            publisher_id = _upsert_ttrpg_publisher(db, payload.publisher_name)

        system_edition_id = None
        if payload.system_edition_name and payload.system_edition_name.strip():
            system_edition_id = _upsert_ttrpg_system_edition(db, payload.top_level_category_id, payload.system_edition_name)

        line_id = None
        if payload.line_name and payload.line_name.strip():
            line_id = _upsert_ttrpg_line(db, payload.top_level_category_id, payload.line_name)

        item_result = db.execute(
            text("""
                INSERT INTO tbl_items (collection_type_id, top_level_category_id, ownership_status_id, notes)
                VALUES (:ct, :cat, :own, :notes)
                RETURNING item_id
            """),
            {
                "ct": TTRPG_COLLECTION_TYPE_ID,
                "cat": payload.top_level_category_id,
                "own": payload.ownership_status_id,
                "notes": payload.notes,
            },
        ).fetchone()
        item_id = item_result[0]

        db.execute(
            text("""
                INSERT INTO tbl_ttrpg_details (
                    item_id, title, title_sort, description,
                    system_edition_id, line_id, book_type_id, publisher_id,
                    release_date, cover_image_url, api_source, external_work_id
                ) VALUES (
                    :item_id, :title, :title_sort, :description,
                    :edition_id, :line_id, :book_type_id, :pub_id,
                    :release_date, :cover, :api_source, :ext_id
                )
            """),
            {
                "item_id": item_id,
                "title": payload.title.strip(),
                "title_sort": _make_title_sort(payload.title.strip()),
                "description": payload.description,
                "edition_id": system_edition_id,
                "line_id": line_id,
                "book_type_id": payload.book_type_id,
                "pub_id": publisher_id,
                "release_date": payload.release_date,
                "cover": _resolve_cover_url(payload.cover_image_url, "ttrpg", item_id),
                "api_source": payload.api_source,
                "ext_id": payload.external_work_id,
            },
        )

        _insert_ttrpg_authors(db, item_id, payload.author_names or [])
        _insert_ttrpg_copies(db, item_id, payload.copies or [])
        db.commit()

        book = _get_ttrpg_detail(db, item_id)
        return {"item_id": item_id, "status": "created", "ttrpg": book}
    except HTTPException:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


@app.put("/ttrpg/{item_id}")
def update_ttrpg(item_id: int, payload: TTRPGUpdate):
    db = SessionLocal()
    try:
        existing = db.execute(
            text("SELECT item_id FROM tbl_items WHERE item_id = :id AND collection_type_id = :ct"),
            {"id": item_id, "ct": TTRPG_COLLECTION_TYPE_ID},
        ).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="TTRPG book not found.")

        publisher_id = None
        if payload.publisher_name and payload.publisher_name.strip():
            publisher_id = _upsert_ttrpg_publisher(db, payload.publisher_name)

        system_edition_id = None
        if payload.system_edition_name and payload.system_edition_name.strip():
            system_edition_id = _upsert_ttrpg_system_edition(db, payload.top_level_category_id, payload.system_edition_name)

        line_id = None
        if payload.line_name and payload.line_name.strip():
            line_id = _upsert_ttrpg_line(db, payload.top_level_category_id, payload.line_name)

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
                UPDATE tbl_ttrpg_details
                SET title = :title,
                    title_sort = :title_sort,
                    description = :description,
                    system_edition_id = :edition_id,
                    line_id = :line_id,
                    book_type_id = :book_type_id,
                    publisher_id = :pub_id,
                    release_date = :release_date,
                    cover_image_url = :cover,
                    api_source = :api_source,
                    external_work_id = :ext_id
                WHERE item_id = :id
            """),
            {
                "id": item_id,
                "title": payload.title.strip(),
                "title_sort": _make_title_sort(payload.title.strip()),
                "description": payload.description,
                "edition_id": system_edition_id,
                "line_id": line_id,
                "book_type_id": payload.book_type_id,
                "pub_id": publisher_id,
                "release_date": payload.release_date,
                "cover": _resolve_cover_url(payload.cover_image_url, "ttrpg", item_id),
                "api_source": payload.api_source,
                "ext_id": payload.external_work_id,
            },
        )

        db.execute(text("DELETE FROM xref_ttrpg_book_authors WHERE item_id = :id"), {"id": item_id})
        db.execute(text("DELETE FROM tbl_ttrpg_copies WHERE item_id = :id"), {"id": item_id})
        _insert_ttrpg_authors(db, item_id, payload.author_names or [])
        _insert_ttrpg_copies(db, item_id, payload.copies or [])

        db.commit()
        book = _get_ttrpg_detail(db, item_id)
        return {"item_id": item_id, "status": "updated", "ttrpg": book}
    except HTTPException:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


@app.delete("/ttrpg/{item_id}")
def delete_ttrpg(item_id: int):
    db = SessionLocal()
    try:
        existing = db.execute(
            text("SELECT item_id FROM tbl_items WHERE item_id = :id AND collection_type_id = :ct"),
            {"id": item_id, "ct": TTRPG_COLLECTION_TYPE_ID},
        ).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="TTRPG book not found.")

        files_to_delete = _delete_attachment_files(db, item_id)
        files_to_delete.extend(_collect_cover_file(db, "tbl_ttrpg_details", item_id))
        db.execute(text("DELETE FROM xref_ttrpg_book_authors WHERE item_id = :id"), {"id": item_id})
        db.execute(text("DELETE FROM tbl_ttrpg_copies WHERE item_id = :id"), {"id": item_id})
        db.execute(text("DELETE FROM tbl_attachments WHERE item_id = :id"), {"id": item_id})
        db.execute(text("DELETE FROM tbl_ttrpg_details WHERE item_id = :id"), {"id": item_id})
        db.execute(text("DELETE FROM tbl_items WHERE item_id = :id"), {"id": item_id})

        db.commit()
        _remove_files(files_to_delete)
        return {"deleted": item_id}
    except HTTPException:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


@app.patch("/ttrpg/bulk")
def bulk_update_ttrpg(payload: TTRPGBulkUpdatePayload):
    db = SessionLocal()
    try:
        for item_id in payload.item_ids:
            existing = db.execute(
                text("SELECT item_id FROM tbl_items WHERE item_id = :id AND collection_type_id = :ct"),
                {"id": item_id, "ct": TTRPG_COLLECTION_TYPE_ID},
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
    except HTTPException:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


@app.post("/ttrpg/bulk-delete")
def bulk_delete_ttrpg(payload: BulkDeletePayload):
    db = SessionLocal()
    try:
        all_files = []
        for item_id in payload.item_ids:
            existing = db.execute(
                text("SELECT item_id FROM tbl_items WHERE item_id = :id AND collection_type_id = :ct"),
                {"id": item_id, "ct": TTRPG_COLLECTION_TYPE_ID},
            ).fetchone()
            if not existing:
                raise HTTPException(status_code=404, detail=f"Item {item_id} not found.")

            all_files.extend(_delete_attachment_files(db, item_id))
            all_files.extend(_collect_cover_file(db, "tbl_ttrpg_details", item_id))
            db.execute(text("DELETE FROM xref_ttrpg_book_authors WHERE item_id = :id"), {"id": item_id})
            db.execute(text("DELETE FROM tbl_ttrpg_copies WHERE item_id = :id"), {"id": item_id})
            db.execute(text("DELETE FROM tbl_attachments WHERE item_id = :id"), {"id": item_id})
            db.execute(text("DELETE FROM tbl_ttrpg_details WHERE item_id = :id"), {"id": item_id})
            db.execute(text("DELETE FROM tbl_items WHERE item_id = :id"), {"id": item_id})

        db.commit()
        _remove_files(all_files)
        return {"deleted": payload.item_ids, "count": len(payload.item_ids)}
    except HTTPException:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


# ---------- Admin: Unused Lookup Cleanup ----------

# Each entry: (display_label, lookup_table, pk_column, name_column, [(ref_table, ref_fk_column), ...])
_CLEANABLE_LOOKUPS = [
    # Photocards
    ("Photocard Groups", "lkup_photocard_groups", "group_id", "group_name", [
        ("tbl_photocard_details", "group_id"),
        ("lkup_photocard_members", "group_id"),
        ("lkup_photocard_source_origins", "group_id"),
    ]),
    ("Photocard Members", "lkup_photocard_members", "member_id", "member_name", [
        ("xref_photocard_members", "member_id"),
    ]),
    ("Photocard Source Origins", "lkup_photocard_source_origins", "source_origin_id", "source_origin_name", [
        ("tbl_photocard_details", "source_origin_id"),
    ]),
    # Books
    ("Book Authors", "lkup_book_authors", "author_id", "author_name", [
        ("xref_book_item_authors", "author_id"),
    ]),
    ("Book Tags", "lkup_book_tags", "tag_id", "tag_name", [
        ("xref_book_item_tags", "tag_id"),
    ]),
    ("Book Series", "tbl_book_series", "series_id", "series_name", [
        ("xref_book_item_series", "series_id"),
    ]),
    # Graphic Novels
    ("GN Publishers", "lkup_graphicnovel_publishers", "publisher_id", "publisher_name", [
        ("tbl_graphicnovel_details", "publisher_id"),
    ]),
    ("GN Writers", "lkup_graphicnovel_writers", "writer_id", "writer_name", [
        ("xref_graphicnovel_item_writers", "writer_id"),
    ]),
    ("GN Artists", "lkup_graphicnovel_artists", "artist_id", "artist_name", [
        ("xref_graphicnovel_item_artists", "artist_id"),
    ]),
    ("GN Tags", "lkup_graphicnovel_tags", "tag_id", "tag_name", [
        ("xref_graphicnovel_item_tags", "tag_id"),
    ]),
    # Video Games
    ("Game Developers", "lkup_game_developers", "developer_id", "developer_name", [
        ("xref_game_developers", "developer_id"),
    ]),
    ("Game Publishers", "lkup_game_publishers", "publisher_id", "publisher_name", [
        ("xref_game_publishers", "publisher_id"),
    ]),
    ("Game Platforms", "lkup_game_platforms", "platform_id", "platform_name", [
        ("tbl_game_copies", "platform_id"),
    ]),
    # Music
    ("Music Artists", "lkup_music_artists", "artist_id", "artist_name", [
        ("xref_music_release_artists", "artist_id"),
    ]),
    # Video
    ("Video Directors", "lkup_video_directors", "director_id", "director_name", [
        ("xref_video_directors", "director_id"),
    ]),
    ("Video Cast", "lkup_video_cast", "cast_id", "cast_name", [
        ("xref_video_cast", "cast_id"),
    ]),
    # Board Games
    ("Board Game Designers", "lkup_boardgame_designers", "designer_id", "designer_name", [
        ("xref_boardgame_designers", "designer_id"),
    ]),
    ("Board Game Publishers", "lkup_boardgame_publishers", "publisher_id", "publisher_name", [
        ("tbl_boardgame_details", "publisher_id"),
    ]),
    # TTRPG
    ("TTRPG Authors", "lkup_ttrpg_authors", "author_id", "author_name", [
        ("xref_ttrpg_book_authors", "author_id"),
    ]),
    ("TTRPG Publishers", "lkup_ttrpg_publishers", "publisher_id", "publisher_name", [
        ("tbl_ttrpg_details", "publisher_id"),
    ]),
    ("TTRPG System Editions", "lkup_ttrpg_system_editions", "edition_id", "edition_name", [
        ("tbl_ttrpg_details", "system_edition_id"),
    ]),
    ("TTRPG Lines", "lkup_ttrpg_lines", "line_id", "line_name", [
        ("tbl_ttrpg_details", "line_id"),
    ]),
]


@app.get("/admin/unused-lookups")
def scan_unused_lookups():
    """Scan all cleanable lookup tables and return values that are not
    referenced by any records (and are still active)."""
    db = SessionLocal()
    try:
        results = []
        for label, lkup_table, pk_col, name_col, refs in _CLEANABLE_LOOKUPS:
            # Build a WHERE clause: no references in any ref table
            not_exists_clauses = " AND ".join(
                f"NOT EXISTS (SELECT 1 FROM {ref_table} WHERE {ref_fk} = l.{pk_col})"
                for ref_table, ref_fk in refs
            )
            sql = (
                f"SELECT l.{pk_col}, l.{name_col} FROM {lkup_table} l "
                f"WHERE l.is_active = 1 AND {not_exists_clauses} "
                f"ORDER BY l.{name_col}"
            )
            rows = db.execute(text(sql)).fetchall()
            if rows:
                results.append({
                    "label": label,
                    "table": lkup_table,
                    "values": [{"id": r[0], "name": r[1]} for r in rows],
                })
        return results
    finally:
        db.close()


class DeactivateLookupRequest(BaseModel):
    table: str
    ids: List[int]


@app.post("/admin/deactivate-lookups")
def deactivate_unused_lookups(req: DeactivateLookupRequest):
    """Soft-delete lookup values by setting is_active = 0.
    Only allows tables that are in the cleanable list."""
    # Validate table name against whitelist
    valid = {entry[1]: entry for entry in _CLEANABLE_LOOKUPS}
    if req.table not in valid:
        raise HTTPException(status_code=400, detail=f"Table '{req.table}' is not a cleanable lookup table.")

    _, lkup_table, pk_col, name_col, refs = valid[req.table]

    if not req.ids:
        return {"deactivated": 0}

    db = SessionLocal()
    try:
        # Verify all requested IDs are actually unreferenced before deactivating
        placeholders = ", ".join(str(int(i)) for i in req.ids)  # int() for safety
        not_exists_clauses = " AND ".join(
            f"NOT EXISTS (SELECT 1 FROM {ref_table} WHERE {ref_fk} = l.{pk_col})"
            for ref_table, ref_fk in refs
        )
        safe_sql = (
            f"UPDATE {lkup_table} l SET is_active = 0 "
            f"WHERE l.{pk_col} IN ({placeholders}) AND l.is_active = 1 "
            f"AND {not_exists_clauses}"
        )
        # SQLite doesn't support UPDATE with table alias — use subquery instead
        safe_ids_sql = (
            f"SELECT {pk_col} FROM {lkup_table} l "
            f"WHERE l.{pk_col} IN ({placeholders}) AND l.is_active = 1 "
            f"AND {not_exists_clauses}"
        )
        safe_rows = db.execute(text(safe_ids_sql)).fetchall()
        safe_ids = [r[0] for r in safe_rows]

        if not safe_ids:
            db.commit()
            return {"deactivated": 0}

        safe_placeholders = ", ".join(str(i) for i in safe_ids)
        update_sql = f"UPDATE {lkup_table} SET is_active = 0 WHERE {pk_col} IN ({safe_placeholders})"
        db.execute(text(update_sql))
        db.commit()
        return {"deactivated": len(safe_ids)}
    finally:
        db.close()


# ---------- Frontend static files (production) ----------
# Serve the pre-built React app so the frontend dev server is not needed.
# The /assets mount and /vite.svg route must be registered before the catch-all
# SPA route, and all API routes above must be registered first so they take priority.
from fastapi.responses import FileResponse as _FileResponse

FRONTEND_DIST = APP_ROOT / "frontend" / "dist"

if FRONTEND_DIST.exists():
    app.mount("/assets", StaticFiles(directory=str(FRONTEND_DIST / "assets")), name="assets")

    @app.get("/vite.svg", include_in_schema=False)
    async def _serve_favicon():
        return _FileResponse(str(FRONTEND_DIST / "vite.svg"))

    @app.get("/{full_path:path}", include_in_schema=False)
    async def _serve_spa(full_path: str):
        return _FileResponse(str(FRONTEND_DIST / "index.html"))
