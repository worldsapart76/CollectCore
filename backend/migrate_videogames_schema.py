"""
Migration: Add Video Games module tables to live CollectCore database.

Run from the backend/ directory:
    python migrate_videogames_schema.py

Safe to re-run — all DDL uses IF NOT EXISTS, all inserts use INSERT OR IGNORE.

NOTE: If you previously ran the old migration (which put platform/edition on
tbl_game_details), you will need a fresh database. The new schema moves
platform to lkup_game_platforms + tbl_game_copies (per-copy ownership model).
"""
import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).resolve().parents[1] / "data" / "collectcore.db"

DDL = """
PRAGMA foreign_keys = ON;

-- ============================================================
-- VIDEO GAMES LOOKUP TABLES
-- ============================================================

CREATE TABLE IF NOT EXISTS lkup_game_platforms (
    platform_id    INTEGER PRIMARY KEY AUTOINCREMENT,
    platform_name  TEXT NOT NULL UNIQUE,
    sort_order     INTEGER NOT NULL DEFAULT 0,
    is_active      INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS lkup_game_developers (
    developer_id    INTEGER PRIMARY KEY AUTOINCREMENT,
    developer_name  TEXT NOT NULL UNIQUE,
    is_active       INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS lkup_game_publishers (
    publisher_id    INTEGER PRIMARY KEY AUTOINCREMENT,
    publisher_name  TEXT NOT NULL UNIQUE,
    is_active       INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS lkup_game_top_genres (
    top_genre_id  INTEGER PRIMARY KEY AUTOINCREMENT,
    genre_name    TEXT NOT NULL UNIQUE,
    sort_order    INTEGER NOT NULL DEFAULT 0,
    is_active     INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS lkup_game_sub_genres (
    sub_genre_id   INTEGER PRIMARY KEY AUTOINCREMENT,
    top_genre_id   INTEGER NOT NULL,
    sub_genre_name TEXT NOT NULL,
    sort_order     INTEGER NOT NULL DEFAULT 0,
    is_active      INTEGER NOT NULL DEFAULT 1,
    UNIQUE (sub_genre_name, top_genre_id),
    FOREIGN KEY (top_genre_id) REFERENCES lkup_game_top_genres(top_genre_id)
);

-- ============================================================
-- VIDEO GAMES CORE TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS tbl_game_details (
    item_id           INTEGER PRIMARY KEY,
    title             TEXT NOT NULL,
    title_sort        TEXT,
    description       TEXT,
    release_date      TEXT,
    cover_image_url   TEXT,
    api_source        TEXT,
    external_work_id  TEXT,
    FOREIGN KEY (item_id) REFERENCES tbl_items(item_id) ON DELETE CASCADE
);

-- ============================================================
-- VIDEO GAMES COPIES (per-platform ownership)
-- ============================================================

CREATE TABLE IF NOT EXISTS tbl_game_copies (
    copy_id              INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id              INTEGER NOT NULL,
    platform_id          INTEGER,
    edition              TEXT,
    ownership_status_id  INTEGER,
    notes                TEXT,
    FOREIGN KEY (item_id) REFERENCES tbl_game_details(item_id) ON DELETE CASCADE,
    FOREIGN KEY (platform_id) REFERENCES lkup_game_platforms(platform_id),
    FOREIGN KEY (ownership_status_id) REFERENCES lkup_ownership_statuses(ownership_status_id)
);

-- ============================================================
-- VIDEO GAMES XREF TABLES
-- ============================================================

CREATE TABLE IF NOT EXISTS xref_game_developers (
    item_id       INTEGER NOT NULL,
    developer_id  INTEGER NOT NULL,
    PRIMARY KEY (item_id, developer_id),
    FOREIGN KEY (item_id) REFERENCES tbl_game_details(item_id) ON DELETE CASCADE,
    FOREIGN KEY (developer_id) REFERENCES lkup_game_developers(developer_id)
);

CREATE TABLE IF NOT EXISTS xref_game_publishers (
    item_id       INTEGER NOT NULL,
    publisher_id  INTEGER NOT NULL,
    PRIMARY KEY (item_id, publisher_id),
    FOREIGN KEY (item_id) REFERENCES tbl_game_details(item_id) ON DELETE CASCADE,
    FOREIGN KEY (publisher_id) REFERENCES lkup_game_publishers(publisher_id)
);

CREATE TABLE IF NOT EXISTS xref_game_genres (
    xref_id       INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id       INTEGER NOT NULL,
    top_genre_id  INTEGER NOT NULL,
    sub_genre_id  INTEGER,
    FOREIGN KEY (item_id) REFERENCES tbl_game_details(item_id) ON DELETE CASCADE,
    FOREIGN KEY (top_genre_id) REFERENCES lkup_game_top_genres(top_genre_id),
    FOREIGN KEY (sub_genre_id) REFERENCES lkup_game_sub_genres(sub_genre_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_game_genres_with_sub
ON xref_game_genres(item_id, top_genre_id, sub_genre_id)
WHERE sub_genre_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_game_genres_no_sub
ON xref_game_genres(item_id, top_genre_id)
WHERE sub_genre_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_game_details_title
ON tbl_game_details(title);

CREATE INDEX IF NOT EXISTS idx_game_copies_item
ON tbl_game_copies(item_id);
"""

SEED = """
-- collection type
INSERT OR IGNORE INTO lkup_collection_types (collection_type_code, collection_type_name, sort_order)
VALUES ('videogames', 'Video Games', 4);

-- single catch-all top-level category
INSERT OR IGNORE INTO lkup_top_level_categories (collection_type_id, category_name, sort_order)
SELECT (SELECT collection_type_id FROM lkup_collection_types WHERE collection_type_code = 'videogames'), 'Video Games', 1
WHERE NOT EXISTS (
    SELECT 1 FROM lkup_top_level_categories ltc
    JOIN lkup_collection_types lct ON ltc.collection_type_id = lct.collection_type_id
    WHERE lct.collection_type_code = 'videogames' AND ltc.category_name = 'Video Games'
);

-- play statuses
INSERT OR IGNORE INTO lkup_book_read_statuses (status_name, sort_order) VALUES ('Played',       10);
INSERT OR IGNORE INTO lkup_book_read_statuses (status_name, sort_order) VALUES ('Playing',      11);
INSERT OR IGNORE INTO lkup_book_read_statuses (status_name, sort_order) VALUES ('Want to Play', 12);
INSERT OR IGNORE INTO lkup_book_read_statuses (status_name, sort_order) VALUES ('Abandoned',    13);

-- platforms
INSERT OR IGNORE INTO lkup_game_platforms (platform_name, sort_order) VALUES ('Xbox',           1);
INSERT OR IGNORE INTO lkup_game_platforms (platform_name, sort_order) VALUES ('Xbox Series X',  2);
INSERT OR IGNORE INTO lkup_game_platforms (platform_name, sort_order) VALUES ('Xbox One',       3);
INSERT OR IGNORE INTO lkup_game_platforms (platform_name, sort_order) VALUES ('PS5',            4);
INSERT OR IGNORE INTO lkup_game_platforms (platform_name, sort_order) VALUES ('PS4',            5);
INSERT OR IGNORE INTO lkup_game_platforms (platform_name, sort_order) VALUES ('Nintendo Switch',6);
INSERT OR IGNORE INTO lkup_game_platforms (platform_name, sort_order) VALUES ('PC (Steam)',     7);
INSERT OR IGNORE INTO lkup_game_platforms (platform_name, sort_order) VALUES ('PC (Epic)',      8);
INSERT OR IGNORE INTO lkup_game_platforms (platform_name, sort_order) VALUES ('PC (GOG)',       9);
INSERT OR IGNORE INTO lkup_game_platforms (platform_name, sort_order) VALUES ('PC (Game Pass)', 10);
INSERT OR IGNORE INTO lkup_game_platforms (platform_name, sort_order) VALUES ('PC (Origin)',    11);
INSERT OR IGNORE INTO lkup_game_platforms (platform_name, sort_order) VALUES ('Other',         12);

-- top genres
INSERT OR IGNORE INTO lkup_game_top_genres (genre_name, sort_order) VALUES ('RPG',         1);
INSERT OR IGNORE INTO lkup_game_top_genres (genre_name, sort_order) VALUES ('Action',      2);
INSERT OR IGNORE INTO lkup_game_top_genres (genre_name, sort_order) VALUES ('Adventure',   3);
INSERT OR IGNORE INTO lkup_game_top_genres (genre_name, sort_order) VALUES ('Strategy',    4);
INSERT OR IGNORE INTO lkup_game_top_genres (genre_name, sort_order) VALUES ('Puzzle',      5);
INSERT OR IGNORE INTO lkup_game_top_genres (genre_name, sort_order) VALUES ('Simulation',  6);
INSERT OR IGNORE INTO lkup_game_top_genres (genre_name, sort_order) VALUES ('Sports',      7);
INSERT OR IGNORE INTO lkup_game_top_genres (genre_name, sort_order) VALUES ('Horror',      8);
INSERT OR IGNORE INTO lkup_game_top_genres (genre_name, sort_order) VALUES ('Other',       9);

-- update modules_enabled to include videogames (only if not already present)
UPDATE tbl_app_settings
SET value = (
    SELECT CASE
        WHEN value LIKE '%"videogames"%' THEN value
        ELSE REPLACE(value, ']', ',"videogames"]')
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

    # Verify
    tables = [r[0] for r in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%game%'"
    ).fetchall()]
    print(f"  Tables created: {tables}")

    platforms = conn.execute("SELECT platform_name FROM lkup_game_platforms ORDER BY sort_order").fetchall()
    print(f"  Platforms seeded: {[p[0] for p in platforms]}")

    genres = conn.execute("SELECT genre_name FROM lkup_game_top_genres ORDER BY sort_order").fetchall()
    print(f"  Genres seeded: {[g[0] for g in genres]}")

    statuses = conn.execute(
        "SELECT status_name FROM lkup_book_read_statuses WHERE status_name IN ('Played','Playing','Want to Play','Abandoned')"
    ).fetchall()
    print(f"  Play statuses seeded: {[s[0] for s in statuses]}")

    ct = conn.execute(
        "SELECT collection_type_id FROM lkup_collection_types WHERE collection_type_code = 'videogames'"
    ).fetchone()
    print(f"  Collection type id: {ct[0] if ct else 'NOT FOUND'}")

    modules = conn.execute("SELECT value FROM tbl_app_settings WHERE key = 'modules_enabled'").fetchone()
    print(f"  modules_enabled: {modules[0] if modules else 'NOT FOUND'}")

    conn.close()
    print("Migration complete.")


if __name__ == "__main__":
    main()
