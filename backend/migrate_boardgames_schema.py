"""
Migration: Add Board Games module tables to live CollectCore database.

Run from the backend/ directory:
    python migrate_boardgames_schema.py

Safe to re-run — all DDL uses IF NOT EXISTS, all inserts use INSERT OR IGNORE.
"""
import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).resolve().parents[1] / "data" / "collectcore.db"

DDL = """
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS lkup_boardgame_publishers (
    publisher_id    INTEGER PRIMARY KEY AUTOINCREMENT,
    publisher_name  TEXT NOT NULL UNIQUE,
    is_active       INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS lkup_boardgame_designers (
    designer_id    INTEGER PRIMARY KEY AUTOINCREMENT,
    designer_name  TEXT NOT NULL UNIQUE,
    is_active      INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS tbl_boardgame_details (
    item_id           INTEGER PRIMARY KEY,
    title             TEXT NOT NULL,
    title_sort        TEXT,
    description       TEXT,
    year_published    INTEGER,
    min_players       INTEGER,
    max_players       INTEGER,
    publisher_id      INTEGER,
    cover_image_url   TEXT,
    api_source        TEXT,
    external_work_id  TEXT,
    FOREIGN KEY (item_id) REFERENCES tbl_items(item_id) ON DELETE CASCADE,
    FOREIGN KEY (publisher_id) REFERENCES lkup_boardgame_publishers(publisher_id)
);

CREATE TABLE IF NOT EXISTS tbl_boardgame_expansions (
    expansion_id        INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id             INTEGER NOT NULL,
    title               TEXT NOT NULL,
    year_published      INTEGER,
    ownership_status_id INTEGER,
    external_work_id    TEXT,
    FOREIGN KEY (item_id) REFERENCES tbl_boardgame_details(item_id) ON DELETE CASCADE,
    FOREIGN KEY (ownership_status_id) REFERENCES lkup_ownership_statuses(ownership_status_id)
);

CREATE TABLE IF NOT EXISTS xref_boardgame_designers (
    xref_id        INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id        INTEGER NOT NULL,
    designer_id    INTEGER NOT NULL,
    designer_order INTEGER NOT NULL DEFAULT 0,
    UNIQUE (item_id, designer_id),
    FOREIGN KEY (item_id) REFERENCES tbl_boardgame_details(item_id) ON DELETE CASCADE,
    FOREIGN KEY (designer_id) REFERENCES lkup_boardgame_designers(designer_id)
);

CREATE INDEX IF NOT EXISTS idx_boardgame_details_title ON tbl_boardgame_details(title);
CREATE INDEX IF NOT EXISTS idx_boardgame_expansions_item ON tbl_boardgame_expansions(item_id);
"""

SEED = """
-- Collection type
INSERT OR IGNORE INTO lkup_collection_types (collection_type_code, collection_type_name, sort_order)
VALUES ('boardgames', 'Board Games', 7);

-- Top-level categories (player count)
INSERT OR IGNORE INTO lkup_top_level_categories (collection_type_id, category_name, sort_order)
SELECT (SELECT collection_type_id FROM lkup_collection_types WHERE collection_type_code = 'boardgames'), 'Solo (1 player)', 1
WHERE NOT EXISTS (
    SELECT 1 FROM lkup_top_level_categories ltc
    JOIN lkup_collection_types lct ON ltc.collection_type_id = lct.collection_type_id
    WHERE lct.collection_type_code = 'boardgames' AND ltc.category_name = 'Solo (1 player)'
);
INSERT OR IGNORE INTO lkup_top_level_categories (collection_type_id, category_name, sort_order)
SELECT (SELECT collection_type_id FROM lkup_collection_types WHERE collection_type_code = 'boardgames'), '2-Player', 2
WHERE NOT EXISTS (
    SELECT 1 FROM lkup_top_level_categories ltc
    JOIN lkup_collection_types lct ON ltc.collection_type_id = lct.collection_type_id
    WHERE lct.collection_type_code = 'boardgames' AND ltc.category_name = '2-Player'
);
INSERT OR IGNORE INTO lkup_top_level_categories (collection_type_id, category_name, sort_order)
SELECT (SELECT collection_type_id FROM lkup_collection_types WHERE collection_type_code = 'boardgames'), 'Small Group (3-4)', 3
WHERE NOT EXISTS (
    SELECT 1 FROM lkup_top_level_categories ltc
    JOIN lkup_collection_types lct ON ltc.collection_type_id = lct.collection_type_id
    WHERE lct.collection_type_code = 'boardgames' AND ltc.category_name = 'Small Group (3-4)'
);
INSERT OR IGNORE INTO lkup_top_level_categories (collection_type_id, category_name, sort_order)
SELECT (SELECT collection_type_id FROM lkup_collection_types WHERE collection_type_code = 'boardgames'), 'Large Group (5+)', 4
WHERE NOT EXISTS (
    SELECT 1 FROM lkup_top_level_categories ltc
    JOIN lkup_collection_types lct ON ltc.collection_type_id = lct.collection_type_id
    WHERE lct.collection_type_code = 'boardgames' AND ltc.category_name = 'Large Group (5+)'
);

-- Update modules_enabled to include boardgames
UPDATE tbl_app_settings
SET value = (
    SELECT CASE
        WHEN value LIKE '%"boardgames"%' THEN value
        ELSE REPLACE(value, ']', ',"boardgames"]')
    END
    FROM tbl_app_settings WHERE key = 'modules_enabled'
)
WHERE key = 'modules_enabled';
"""


def main():
    if not DB_PATH.exists():
        print(f"ERROR: Database not found at {DB_PATH}")
        return

    print(f"Migrating: {DB_PATH}")
    conn = sqlite3.connect(DB_PATH)
    conn.executescript(DDL)
    conn.executescript(SEED)
    conn.commit()

    tables = [r[0] for r in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%boardgame%'"
    ).fetchall()]
    print(f"  Tables created: {tables}")

    ct = conn.execute(
        "SELECT collection_type_id FROM lkup_collection_types WHERE collection_type_code = 'boardgames'"
    ).fetchone()
    print(f"  Collection type id: {ct[0] if ct else 'NOT FOUND'}")

    cats = conn.execute("""
        SELECT ltc.category_name FROM lkup_top_level_categories ltc
        JOIN lkup_collection_types lct ON ltc.collection_type_id = lct.collection_type_id
        WHERE lct.collection_type_code = 'boardgames'
        ORDER BY ltc.sort_order
    """).fetchall()
    print(f"  Categories seeded: {[c[0] for c in cats]}")

    modules = conn.execute("SELECT value FROM tbl_app_settings WHERE key = 'modules_enabled'").fetchone()
    print(f"  modules_enabled: {modules[0] if modules else 'NOT FOUND'}")

    conn.close()
    print("Migration complete.")


if __name__ == "__main__":
    main()
