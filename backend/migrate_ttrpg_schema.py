"""
Migration: Add TTRPG module tables to live CollectCore database.

Run from the backend/ directory:
    python migrate_ttrpg_schema.py

Safe to re-run — all DDL uses IF NOT EXISTS, all inserts use INSERT OR IGNORE.
"""
import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).resolve().parents[1] / "data" / "collectcore.db"

DDL = """
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS lkup_ttrpg_system_editions (
    edition_id         INTEGER PRIMARY KEY AUTOINCREMENT,
    system_category_id INTEGER NOT NULL,
    edition_name       TEXT NOT NULL,
    sort_order         INTEGER NOT NULL DEFAULT 0,
    is_active          INTEGER NOT NULL DEFAULT 1,
    FOREIGN KEY (system_category_id) REFERENCES lkup_top_level_categories(top_level_category_id),
    UNIQUE (system_category_id, edition_name)
);

CREATE TABLE IF NOT EXISTS lkup_ttrpg_lines (
    line_id            INTEGER PRIMARY KEY AUTOINCREMENT,
    system_category_id INTEGER NOT NULL,
    line_name          TEXT NOT NULL,
    sort_order         INTEGER NOT NULL DEFAULT 0,
    is_active          INTEGER NOT NULL DEFAULT 1,
    FOREIGN KEY (system_category_id) REFERENCES lkup_top_level_categories(top_level_category_id),
    UNIQUE (system_category_id, line_name)
);

CREATE TABLE IF NOT EXISTS lkup_ttrpg_book_types (
    book_type_id   INTEGER PRIMARY KEY AUTOINCREMENT,
    book_type_name TEXT NOT NULL UNIQUE,
    sort_order     INTEGER NOT NULL DEFAULT 0,
    is_active      INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS lkup_ttrpg_format_types (
    format_type_id INTEGER PRIMARY KEY AUTOINCREMENT,
    format_name    TEXT NOT NULL UNIQUE,
    sort_order     INTEGER NOT NULL DEFAULT 0,
    is_active      INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS lkup_ttrpg_publishers (
    publisher_id   INTEGER PRIMARY KEY AUTOINCREMENT,
    publisher_name TEXT NOT NULL UNIQUE,
    is_active      INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS lkup_ttrpg_authors (
    author_id   INTEGER PRIMARY KEY AUTOINCREMENT,
    author_name TEXT NOT NULL UNIQUE,
    is_active   INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS tbl_ttrpg_details (
    item_id           INTEGER PRIMARY KEY,
    title             TEXT NOT NULL,
    title_sort        TEXT,
    description       TEXT,
    system_edition_id INTEGER,
    line_id           INTEGER,
    book_type_id      INTEGER,
    publisher_id      INTEGER,
    release_date      TEXT,
    cover_image_url   TEXT,
    api_source        TEXT,
    external_work_id  TEXT,
    FOREIGN KEY (item_id) REFERENCES tbl_items(item_id) ON DELETE CASCADE,
    FOREIGN KEY (system_edition_id) REFERENCES lkup_ttrpg_system_editions(edition_id),
    FOREIGN KEY (line_id) REFERENCES lkup_ttrpg_lines(line_id),
    FOREIGN KEY (book_type_id) REFERENCES lkup_ttrpg_book_types(book_type_id),
    FOREIGN KEY (publisher_id) REFERENCES lkup_ttrpg_publishers(publisher_id)
);

CREATE TABLE IF NOT EXISTS tbl_ttrpg_copies (
    copy_id             INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id             INTEGER NOT NULL,
    format_type_id      INTEGER,
    isbn_13             TEXT,
    isbn_10             TEXT,
    ownership_status_id INTEGER,
    notes               TEXT,
    FOREIGN KEY (item_id) REFERENCES tbl_ttrpg_details(item_id) ON DELETE CASCADE,
    FOREIGN KEY (format_type_id) REFERENCES lkup_ttrpg_format_types(format_type_id),
    FOREIGN KEY (ownership_status_id) REFERENCES lkup_ownership_statuses(ownership_status_id)
);

CREATE TABLE IF NOT EXISTS xref_ttrpg_book_authors (
    xref_id      INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id      INTEGER NOT NULL,
    author_id    INTEGER NOT NULL,
    author_order INTEGER NOT NULL DEFAULT 0,
    UNIQUE (item_id, author_id),
    FOREIGN KEY (item_id) REFERENCES tbl_ttrpg_details(item_id) ON DELETE CASCADE,
    FOREIGN KEY (author_id) REFERENCES lkup_ttrpg_authors(author_id)
);

CREATE INDEX IF NOT EXISTS idx_ttrpg_details_title ON tbl_ttrpg_details(title);
CREATE INDEX IF NOT EXISTS idx_ttrpg_copies_item ON tbl_ttrpg_copies(item_id);
CREATE INDEX IF NOT EXISTS idx_ttrpg_system_editions_system ON lkup_ttrpg_system_editions(system_category_id);
CREATE INDEX IF NOT EXISTS idx_ttrpg_lines_system ON lkup_ttrpg_lines(system_category_id);
"""

SEED = """
-- Collection type
INSERT OR IGNORE INTO lkup_collection_types (collection_type_code, collection_type_name, sort_order)
VALUES ('ttrpg', 'TTRPG', 8);

-- Top-level categories (game systems)
INSERT OR IGNORE INTO lkup_top_level_categories (collection_type_id, category_name, sort_order)
SELECT (SELECT collection_type_id FROM lkup_collection_types WHERE collection_type_code = 'ttrpg'), 'Dungeons & Dragons', 1
WHERE NOT EXISTS (
    SELECT 1 FROM lkup_top_level_categories ltc
    JOIN lkup_collection_types lct ON ltc.collection_type_id = lct.collection_type_id
    WHERE lct.collection_type_code = 'ttrpg' AND ltc.category_name = 'Dungeons & Dragons'
);
INSERT OR IGNORE INTO lkup_top_level_categories (collection_type_id, category_name, sort_order)
SELECT (SELECT collection_type_id FROM lkup_collection_types WHERE collection_type_code = 'ttrpg'), 'Pathfinder', 2
WHERE NOT EXISTS (
    SELECT 1 FROM lkup_top_level_categories ltc
    JOIN lkup_collection_types lct ON ltc.collection_type_id = lct.collection_type_id
    WHERE lct.collection_type_code = 'ttrpg' AND ltc.category_name = 'Pathfinder'
);
INSERT OR IGNORE INTO lkup_top_level_categories (collection_type_id, category_name, sort_order)
SELECT (SELECT collection_type_id FROM lkup_collection_types WHERE collection_type_code = 'ttrpg'), 'Blades in the Dark', 3
WHERE NOT EXISTS (
    SELECT 1 FROM lkup_top_level_categories ltc
    JOIN lkup_collection_types lct ON ltc.collection_type_id = lct.collection_type_id
    WHERE lct.collection_type_code = 'ttrpg' AND ltc.category_name = 'Blades in the Dark'
);
INSERT OR IGNORE INTO lkup_top_level_categories (collection_type_id, category_name, sort_order)
SELECT (SELECT collection_type_id FROM lkup_collection_types WHERE collection_type_code = 'ttrpg'), 'Call of Cthulhu', 4
WHERE NOT EXISTS (
    SELECT 1 FROM lkup_top_level_categories ltc
    JOIN lkup_collection_types lct ON ltc.collection_type_id = lct.collection_type_id
    WHERE lct.collection_type_code = 'ttrpg' AND ltc.category_name = 'Call of Cthulhu'
);
INSERT OR IGNORE INTO lkup_top_level_categories (collection_type_id, category_name, sort_order)
SELECT (SELECT collection_type_id FROM lkup_collection_types WHERE collection_type_code = 'ttrpg'), 'Shadowrun', 5
WHERE NOT EXISTS (
    SELECT 1 FROM lkup_top_level_categories ltc
    JOIN lkup_collection_types lct ON ltc.collection_type_id = lct.collection_type_id
    WHERE lct.collection_type_code = 'ttrpg' AND ltc.category_name = 'Shadowrun'
);
INSERT OR IGNORE INTO lkup_top_level_categories (collection_type_id, category_name, sort_order)
SELECT (SELECT collection_type_id FROM lkup_collection_types WHERE collection_type_code = 'ttrpg'), 'Other', 99
WHERE NOT EXISTS (
    SELECT 1 FROM lkup_top_level_categories ltc
    JOIN lkup_collection_types lct ON ltc.collection_type_id = lct.collection_type_id
    WHERE lct.collection_type_code = 'ttrpg' AND ltc.category_name = 'Other'
);

-- Book types
INSERT OR IGNORE INTO lkup_ttrpg_book_types (book_type_name, sort_order) VALUES ('Core Rulebook', 1);
INSERT OR IGNORE INTO lkup_ttrpg_book_types (book_type_name, sort_order) VALUES ('Adventure Module', 2);
INSERT OR IGNORE INTO lkup_ttrpg_book_types (book_type_name, sort_order) VALUES ('Sourcebook', 3);
INSERT OR IGNORE INTO lkup_ttrpg_book_types (book_type_name, sort_order) VALUES ('Supplement', 4);
INSERT OR IGNORE INTO lkup_ttrpg_book_types (book_type_name, sort_order) VALUES ('Campaign Setting', 5);
INSERT OR IGNORE INTO lkup_ttrpg_book_types (book_type_name, sort_order) VALUES ('Other', 99);

-- Format types
INSERT OR IGNORE INTO lkup_ttrpg_format_types (format_name, sort_order) VALUES ('Physical', 1);
INSERT OR IGNORE INTO lkup_ttrpg_format_types (format_name, sort_order) VALUES ('PDF', 2);
INSERT OR IGNORE INTO lkup_ttrpg_format_types (format_name, sort_order) VALUES ('Other', 99);

-- Update modules_enabled to include ttrpg
UPDATE tbl_app_settings
SET value = (
    SELECT CASE
        WHEN value LIKE '%"ttrpg"%' THEN value
        ELSE REPLACE(value, ']', ',"ttrpg"]')
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
        "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%ttrpg%'"
    ).fetchall()]
    print(f"  Tables created: {tables}")

    ct = conn.execute(
        "SELECT collection_type_id FROM lkup_collection_types WHERE collection_type_code = 'ttrpg'"
    ).fetchone()
    print(f"  Collection type id: {ct[0] if ct else 'NOT FOUND'}")

    systems = conn.execute("""
        SELECT ltc.category_name FROM lkup_top_level_categories ltc
        JOIN lkup_collection_types lct ON ltc.collection_type_id = lct.collection_type_id
        WHERE lct.collection_type_code = 'ttrpg'
        ORDER BY ltc.sort_order
    """).fetchall()
    print(f"  Game systems seeded: {[s[0] for s in systems]}")

    book_types = conn.execute("SELECT book_type_name FROM lkup_ttrpg_book_types ORDER BY sort_order").fetchall()
    print(f"  Book types seeded: {[b[0] for b in book_types]}")

    modules = conn.execute("SELECT value FROM tbl_app_settings WHERE key = 'modules_enabled'").fetchone()
    print(f"  modules_enabled: {modules[0] if modules else 'NOT FOUND'}")

    conn.close()
    print("Migration complete.")


if __name__ == "__main__":
    main()
