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
SCHEMA_PATH = APP_ROOT / "backend" / "sql" / "schema.sql"

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
    raw.execute(
        "UPDATE lkup_graphicnovel_eras SET is_active = 0 WHERE era_name = 'Copper Age'"
    )


def init_db() -> None:
    if not SCHEMA_PATH.exists():
        raise FileNotFoundError(f"Schema file not found: {SCHEMA_PATH}")

    schema_sql = SCHEMA_PATH.read_text(encoding="utf-8")

    with engine.begin() as conn:
        conn.execute(text("PRAGMA foreign_keys = ON"))
        _run_migrations(conn)
        raw_conn = conn.connection
        raw_conn.executescript(schema_sql)