from pathlib import Path
from datetime import datetime
import shutil

from sqlalchemy import text
from db import engine


def backup_database():
    db_path = engine.url.database
    if not db_path:
        raise RuntimeError("Could not determine SQLite database path from engine.")

    db_file = Path(db_path)
    if not db_file.exists():
        raise RuntimeError(f"Database file not found: {db_file}")

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_path = db_file.with_name(
        f"{db_file.stem}_backup_before_source_migration_{timestamp}{db_file.suffix}"
    )
    shutil.copy2(db_file, backup_path)
    print(f"Backup created: {backup_path}")


def column_exists(conn, table_name: str, column_name: str) -> bool:
    rows = conn.execute(text(f"PRAGMA table_info({table_name})")).fetchall()
    return any(row[1] == column_name for row in rows)


def table_exists(conn, table_name: str) -> bool:
    row = conn.execute(
        text(
            "SELECT name FROM sqlite_master WHERE type='table' AND name=:table_name"
        ),
        {"table_name": table_name},
    ).fetchone()
    return row is not None


def migrate():
    backup_database()

    with engine.begin() as conn:
        if not table_exists(conn, "source_options"):
            print("Table source_options does not exist. Nothing to migrate.")
            return

        if column_exists(conn, "source_options", "group_code"):
            print("source_options already has group_code. Migration already applied.")
            return

        print("Migrating source_options...")

        conn.execute(text("""
            CREATE TABLE source_options_new (
                id INTEGER PRIMARY KEY,
                group_code VARCHAR NOT NULL DEFAULT 'skz',
                top_level_category VARCHAR NOT NULL,
                sub_category VARCHAR NOT NULL,
                value VARCHAR NOT NULL,
                CONSTRAINT uq_source_group_top_level_sub_value
                    UNIQUE (group_code, top_level_category, sub_category, value)
            )
        """))

        conn.execute(text("""
            INSERT INTO source_options_new (group_code, top_level_category, sub_category, value)
            SELECT 'skz', top_level_category, sub_category, value
            FROM source_options
            GROUP BY top_level_category, sub_category, value
        """))

        conn.execute(text("DROP TABLE source_options"))
        conn.execute(text("ALTER TABLE source_options_new RENAME TO source_options"))

        conn.execute(text("""
            CREATE INDEX IF NOT EXISTS ix_source_options_id
            ON source_options (id)
        """))

        print("Migration complete.")


if __name__ == "__main__":
    migrate()