import logging
import os
from pathlib import Path
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

logger = logging.getLogger("collectcore.db")

APP_ROOT = Path(__file__).resolve().parents[1]

# Allow the launcher to redirect user data to a separate directory (e.g. AppData)
# so that app updates don't overwrite the database or images.
# In development this variable is not set, so APP_ROOT is used as before.
_data_root_env = os.environ.get("COLLECTCORE_DATA_DIR")
DATA_ROOT = Path(_data_root_env) if _data_root_env else APP_ROOT

DB_PATH = DATA_ROOT / "data" / "collectcore.db"
logger.info("Using DB path: %s", DB_PATH)
SCHEMA_PATH = Path(__file__).resolve().parent / "sql" / "schema.sql"

DB_PATH.parent.mkdir(parents=True, exist_ok=True)

engine = create_engine(
    f"sqlite:///{DB_PATH}",
    connect_args={"check_same_thread": False},
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def _run_migrations(conn) -> None:
    """Apply incremental schema migrations for existing databases."""
    raw = conn.connection

    # Migration: rename lkup_book_read_statuses -> lkup_consumption_statuses
    tables = {r[0] for r in raw.execute(
        "SELECT name FROM sqlite_master WHERE type='table'"
    ).fetchall()}
    if "lkup_book_read_statuses" in tables and "lkup_consumption_statuses" not in tables:
        raw.execute("ALTER TABLE lkup_book_read_statuses RENAME TO lkup_consumption_statuses")
        logger.info("Migration: renamed lkup_book_read_statuses -> lkup_consumption_statuses")

    # Migration: deactivate Copper Age era (data quality — era was never used in GN module)
    # Guarded for fresh DBs where schema.sql hasn't run yet (migrations execute before schema).
    if "lkup_graphicnovel_eras" in tables:
        raw.execute(
            "UPDATE lkup_graphicnovel_eras SET is_active = 0 WHERE era_name = 'Copper Age'"
        )

    # Migration: rewrite R2 dev URLs (pub-*.r2.dev) to the custom domain.
    # The dev URL is throttled by Cloudflare; the custom domain routes through
    # the full CDN. Idempotent — REPLACE matches no rows after first run.
    _OLD_HOST = "https://pub-8156609abf504c058e10ac0f5b7f6e95.r2.dev"
    _NEW_HOST = "https://images.collectcoreapp.com"
    _REWRITE_TARGETS = [
        ("tbl_attachments", "file_path"),
        ("tbl_book_copies", "cover_image_url"),
        ("tbl_graphicnovel_details", "cover_image_url"),
        ("tbl_game_details", "cover_image_url"),
        ("tbl_music_release_details", "cover_image_url"),
        ("tbl_video_details", "cover_image_url"),
        ("tbl_boardgame_details", "cover_image_url"),
    ]
    for tbl, col in _REWRITE_TARGETS:
        if tbl in tables:
            cur = raw.execute(
                f"UPDATE {tbl} SET {col} = REPLACE({col}, ?, ?) WHERE {col} LIKE ?",
                (_OLD_HOST, _NEW_HOST, f"{_OLD_HOST}%"),
            )
            if cur.rowcount > 0:
                logger.info("R2 host rewrite: %s.%s -> %d rows", tbl, col, cur.rowcount)

    # Migration: tbl_video_details.on_media_server (boolean flag)
    if "tbl_video_details" in tables:
        cols = {r[1] for r in raw.execute("PRAGMA table_info(tbl_video_details)").fetchall()}
        if "on_media_server" not in cols:
            raw.execute("ALTER TABLE tbl_video_details ADD COLUMN on_media_server INTEGER NOT NULL DEFAULT 0")
            logger.info("Migration: added tbl_video_details.on_media_server")

    # Migration: tbl_video_season_copies (per-season multi-format copies)
    if "tbl_video_seasons" in tables and "tbl_video_season_copies" not in tables:
        raw.execute("""
            CREATE TABLE tbl_video_season_copies (
                copy_id             INTEGER PRIMARY KEY AUTOINCREMENT,
                season_id           INTEGER NOT NULL,
                format_type_id      INTEGER,
                ownership_status_id INTEGER,
                notes               TEXT,
                FOREIGN KEY (season_id) REFERENCES tbl_video_seasons(season_id) ON DELETE CASCADE,
                FOREIGN KEY (format_type_id) REFERENCES lkup_video_format_types(format_type_id),
                FOREIGN KEY (ownership_status_id) REFERENCES lkup_ownership_statuses(ownership_status_id)
            )
        """)
        raw.execute(
            "CREATE INDEX idx_video_season_copies_season ON tbl_video_season_copies(season_id)"
        )
        # Backfill: one copy row per pre-existing season that had inline format/ownership/notes set.
        # Skips seasons with no useful data and is naturally idempotent because the table is empty.
        raw.execute("""
            INSERT INTO tbl_video_season_copies (season_id, format_type_id, ownership_status_id, notes)
            SELECT season_id, format_type_id, ownership_status_id, notes
            FROM tbl_video_seasons
            WHERE format_type_id IS NOT NULL
               OR ownership_status_id IS NOT NULL
               OR (notes IS NOT NULL AND TRIM(notes) <> '')
        """)
        logger.info("Migration: created tbl_video_season_copies and backfilled from tbl_video_seasons")


def _seed_status_visibility_xref(conn) -> None:
    """Idempotent maintenance for status-visibility xref tables.

    1. Cleans up orphan collection_type_ids left behind by the canonicalize
       migration (FK references to ids that no longer exist in
       lkup_collection_types).
    2. Seeds the xref tables ONCE on a fresh DB. If either xref table is
       non-empty, the seed is skipped — preserving any user toggles made
       via Admin > Status Visibility across restarts.
    """
    raw = conn.connection

    raw.execute("""
        DELETE FROM xref_ownership_status_modules
        WHERE collection_type_id NOT IN (SELECT collection_type_id FROM lkup_collection_types)
    """)
    raw.execute("""
        DELETE FROM xref_consumption_status_modules
        WHERE collection_type_id NOT IN (SELECT collection_type_id FROM lkup_collection_types)
    """)

    own_count = raw.execute("SELECT COUNT(*) FROM xref_ownership_status_modules").fetchone()[0]
    if own_count == 0:
        raw.execute("""
            INSERT OR IGNORE INTO xref_ownership_status_modules (ownership_status_id, collection_type_id)
            SELECT s.ownership_status_id, c.collection_type_id
            FROM lkup_ownership_statuses s, lkup_collection_types c
            WHERE s.is_active = 1 AND c.is_active = 1 AND s.status_code != 'catalog'
        """)
        raw.execute("""
            INSERT OR IGNORE INTO xref_ownership_status_modules (ownership_status_id, collection_type_id)
            SELECT s.ownership_status_id, c.collection_type_id
            FROM lkup_ownership_statuses s, lkup_collection_types c
            WHERE s.status_code = 'catalog' AND c.collection_type_code = 'photocards'
        """)
        logger.info("Seeded xref_ownership_status_modules (fresh DB)")

    cons_count = raw.execute("SELECT COUNT(*) FROM xref_consumption_status_modules").fetchone()[0]
    if cons_count == 0:
        for ct_code, names in [
            ("books", ("Read", "Currently Reading", "Want to Read", "DNF")),
            ("graphicnovels", ("Read", "Want to Read")),
            ("videogames", ("Played", "Playing", "Want to Play", "Abandoned")),
            ("video", ("Watched", "Currently Watching", "Want to Watch", "Abandoned")),
        ]:
            placeholders = ",".join("?" * len(names))
            raw.execute(
                f"""
                INSERT OR IGNORE INTO xref_consumption_status_modules (read_status_id, collection_type_id)
                SELECT cs.read_status_id, ct.collection_type_id
                FROM lkup_consumption_statuses cs, lkup_collection_types ct
                WHERE ct.collection_type_code = ?
                  AND cs.status_name IN ({placeholders})
                """,
                (ct_code, *names),
            )
        logger.info("Seeded xref_consumption_status_modules (fresh DB)")


def init_db() -> None:
    if not SCHEMA_PATH.exists():
        raise FileNotFoundError(f"Schema file not found: {SCHEMA_PATH}")

    schema_sql = SCHEMA_PATH.read_text(encoding="utf-8")

    with engine.begin() as conn:
        conn.execute(text("PRAGMA foreign_keys = ON"))
        _run_migrations(conn)
        raw_conn = conn.connection
        raw_conn.executescript(schema_sql)
        _seed_status_visibility_xref(conn)