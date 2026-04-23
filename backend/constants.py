"""
Centralized constants for CollectCore.

Collection type IDs are resolved from the database at import time using the
seeded collection_type_code values.  Fallback integers match the seed order
so the app works even if the lookup fails.
"""

from db import SessionLocal
from sqlalchemy import text


def _resolve_collection_type_id(code: str, fallback: int) -> int:
    """Look up a collection_type_id by code at startup."""
    db = SessionLocal()
    try:
        row = db.execute(
            text("SELECT collection_type_id FROM lkup_collection_types WHERE collection_type_code = :code"),
            {"code": code},
        ).fetchone()
        return row[0] if row else fallback
    finally:
        db.close()


# Collection type IDs
PHOTOCARD_COLLECTION_TYPE_ID = _resolve_collection_type_id("photocards", 1)
BOOK_COLLECTION_TYPE_ID = _resolve_collection_type_id("books", 2)
GN_COLLECTION_TYPE_ID = _resolve_collection_type_id("graphicnovels", 3)
VIDEOGAMES_COLLECTION_TYPE_ID = _resolve_collection_type_id("videogames", 4)
MUSIC_COLLECTION_TYPE_ID = _resolve_collection_type_id("music", 5)
VIDEO_COLLECTION_TYPE_ID = _resolve_collection_type_id("video", 6)
BOARDGAMES_COLLECTION_TYPE_ID = _resolve_collection_type_id("boardgames", 7)
TTRPG_COLLECTION_TYPE_ID = _resolve_collection_type_id("ttrpg", 8)

# Ownership status IDs (from lkup_ownership_statuses seed data)
OWNED_STATUS_ID = 1
WANTED_STATUS_ID = 2
