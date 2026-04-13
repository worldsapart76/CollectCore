"""
Migration: Add Music module tables to live CollectCore database.

Run from the backend/ directory:
    python migrate_music_schema.py

Safe to re-run — all DDL uses IF NOT EXISTS, all inserts use INSERT OR IGNORE.
"""
import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).resolve().parents[1] / "data" / "collectcore.db"

DDL = """
PRAGMA foreign_keys = ON;

-- ============================================================
-- MUSIC LOOKUP TABLES
-- ============================================================

CREATE TABLE IF NOT EXISTS lkup_music_format_types (
    format_type_id  INTEGER PRIMARY KEY AUTOINCREMENT,
    format_name     TEXT NOT NULL UNIQUE,
    sort_order      INTEGER NOT NULL DEFAULT 0,
    is_active       INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS lkup_music_artists (
    artist_id    INTEGER PRIMARY KEY AUTOINCREMENT,
    artist_name  TEXT NOT NULL UNIQUE,
    artist_sort  TEXT,
    is_active    INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS lkup_music_top_genres (
    top_genre_id  INTEGER PRIMARY KEY AUTOINCREMENT,
    genre_name    TEXT NOT NULL UNIQUE,
    sort_order    INTEGER NOT NULL DEFAULT 0,
    is_active     INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS lkup_music_sub_genres (
    sub_genre_id   INTEGER PRIMARY KEY AUTOINCREMENT,
    top_genre_id   INTEGER NOT NULL,
    sub_genre_name TEXT NOT NULL,
    sort_order     INTEGER NOT NULL DEFAULT 0,
    is_active      INTEGER NOT NULL DEFAULT 1,
    UNIQUE (sub_genre_name, top_genre_id),
    FOREIGN KEY (top_genre_id) REFERENCES lkup_music_top_genres(top_genre_id)
);

-- ============================================================
-- MUSIC CORE TABLES
-- ============================================================

CREATE TABLE IF NOT EXISTS tbl_music_release_details (
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

CREATE TABLE IF NOT EXISTS tbl_music_songs (
    song_id           INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id           INTEGER NOT NULL,
    title             TEXT NOT NULL,
    duration_seconds  INTEGER,
    track_number      INTEGER,
    disc_number       INTEGER NOT NULL DEFAULT 1,
    FOREIGN KEY (item_id) REFERENCES tbl_music_release_details(item_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tbl_music_editions (
    edition_id          INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id             INTEGER NOT NULL,
    format_type_id      INTEGER,
    version_name        TEXT,
    label               TEXT,
    catalog_number      TEXT,
    barcode             TEXT,
    notes               TEXT,
    ownership_status_id INTEGER,
    FOREIGN KEY (item_id) REFERENCES tbl_music_release_details(item_id) ON DELETE CASCADE,
    FOREIGN KEY (format_type_id) REFERENCES lkup_music_format_types(format_type_id),
    FOREIGN KEY (ownership_status_id) REFERENCES lkup_ownership_statuses(ownership_status_id)
);

-- ============================================================
-- MUSIC XREF TABLES
-- ============================================================

CREATE TABLE IF NOT EXISTS xref_music_release_artists (
    xref_id      INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id      INTEGER NOT NULL,
    artist_id    INTEGER NOT NULL,
    artist_order INTEGER NOT NULL DEFAULT 0,
    UNIQUE (item_id, artist_id),
    FOREIGN KEY (item_id) REFERENCES tbl_music_release_details(item_id) ON DELETE CASCADE,
    FOREIGN KEY (artist_id) REFERENCES lkup_music_artists(artist_id)
);

CREATE TABLE IF NOT EXISTS xref_music_release_genres (
    xref_id       INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id       INTEGER NOT NULL,
    top_genre_id  INTEGER NOT NULL,
    sub_genre_id  INTEGER,
    FOREIGN KEY (item_id) REFERENCES tbl_music_release_details(item_id) ON DELETE CASCADE,
    FOREIGN KEY (top_genre_id) REFERENCES lkup_music_top_genres(top_genre_id),
    FOREIGN KEY (sub_genre_id) REFERENCES lkup_music_sub_genres(sub_genre_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_music_genres_with_sub
ON xref_music_release_genres(item_id, top_genre_id, sub_genre_id)
WHERE sub_genre_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_music_genres_no_sub
ON xref_music_release_genres(item_id, top_genre_id)
WHERE sub_genre_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_music_release_details_title
ON tbl_music_release_details(title);

CREATE INDEX IF NOT EXISTS idx_music_songs_item
ON tbl_music_songs(item_id);

CREATE INDEX IF NOT EXISTS idx_music_editions_item
ON tbl_music_editions(item_id);
"""

SEED = """
-- format types
INSERT OR IGNORE INTO lkup_music_format_types (format_name, sort_order) VALUES ('CD',        1);
INSERT OR IGNORE INTO lkup_music_format_types (format_name, sort_order) VALUES ('Vinyl',     2);
INSERT OR IGNORE INTO lkup_music_format_types (format_name, sort_order) VALUES ('Cassette',  3);
INSERT OR IGNORE INTO lkup_music_format_types (format_name, sort_order) VALUES ('Digital',   4);
INSERT OR IGNORE INTO lkup_music_format_types (format_name, sort_order) VALUES ('Streaming', 5);
INSERT OR IGNORE INTO lkup_music_format_types (format_name, sort_order) VALUES ('Other',     6);

-- collection type
INSERT OR IGNORE INTO lkup_collection_types (collection_type_code, collection_type_name, sort_order)
VALUES ('music', 'Music', 5);

-- top-level categories (release types)
INSERT OR IGNORE INTO lkup_top_level_categories (collection_type_id, category_name, sort_order)
SELECT (SELECT collection_type_id FROM lkup_collection_types WHERE collection_type_code = 'music'), 'Album', 1
WHERE NOT EXISTS (
    SELECT 1 FROM lkup_top_level_categories ltc
    JOIN lkup_collection_types lct ON ltc.collection_type_id = lct.collection_type_id
    WHERE lct.collection_type_code = 'music' AND ltc.category_name = 'Album'
);
INSERT OR IGNORE INTO lkup_top_level_categories (collection_type_id, category_name, sort_order)
SELECT (SELECT collection_type_id FROM lkup_collection_types WHERE collection_type_code = 'music'), 'EP', 2
WHERE NOT EXISTS (
    SELECT 1 FROM lkup_top_level_categories ltc
    JOIN lkup_collection_types lct ON ltc.collection_type_id = lct.collection_type_id
    WHERE lct.collection_type_code = 'music' AND ltc.category_name = 'EP'
);
INSERT OR IGNORE INTO lkup_top_level_categories (collection_type_id, category_name, sort_order)
SELECT (SELECT collection_type_id FROM lkup_collection_types WHERE collection_type_code = 'music'), 'Single', 3
WHERE NOT EXISTS (
    SELECT 1 FROM lkup_top_level_categories ltc
    JOIN lkup_collection_types lct ON ltc.collection_type_id = lct.collection_type_id
    WHERE lct.collection_type_code = 'music' AND ltc.category_name = 'Single'
);
INSERT OR IGNORE INTO lkup_top_level_categories (collection_type_id, category_name, sort_order)
SELECT (SELECT collection_type_id FROM lkup_collection_types WHERE collection_type_code = 'music'), 'Compilation', 4
WHERE NOT EXISTS (
    SELECT 1 FROM lkup_top_level_categories ltc
    JOIN lkup_collection_types lct ON ltc.collection_type_id = lct.collection_type_id
    WHERE lct.collection_type_code = 'music' AND ltc.category_name = 'Compilation'
);
INSERT OR IGNORE INTO lkup_top_level_categories (collection_type_id, category_name, sort_order)
SELECT (SELECT collection_type_id FROM lkup_collection_types WHERE collection_type_code = 'music'), 'Live', 5
WHERE NOT EXISTS (
    SELECT 1 FROM lkup_top_level_categories ltc
    JOIN lkup_collection_types lct ON ltc.collection_type_id = lct.collection_type_id
    WHERE lct.collection_type_code = 'music' AND ltc.category_name = 'Live'
);
INSERT OR IGNORE INTO lkup_top_level_categories (collection_type_id, category_name, sort_order)
SELECT (SELECT collection_type_id FROM lkup_collection_types WHERE collection_type_code = 'music'), 'Soundtrack', 6
WHERE NOT EXISTS (
    SELECT 1 FROM lkup_top_level_categories ltc
    JOIN lkup_collection_types lct ON ltc.collection_type_id = lct.collection_type_id
    WHERE lct.collection_type_code = 'music' AND ltc.category_name = 'Soundtrack'
);

-- top genres
INSERT OR IGNORE INTO lkup_music_top_genres (genre_name, sort_order) VALUES ('K-pop',       1);
INSERT OR IGNORE INTO lkup_music_top_genres (genre_name, sort_order) VALUES ('Pop',         2);
INSERT OR IGNORE INTO lkup_music_top_genres (genre_name, sort_order) VALUES ('Rock',        3);
INSERT OR IGNORE INTO lkup_music_top_genres (genre_name, sort_order) VALUES ('Electronic',  4);
INSERT OR IGNORE INTO lkup_music_top_genres (genre_name, sort_order) VALUES ('Hip-Hop',     5);
INSERT OR IGNORE INTO lkup_music_top_genres (genre_name, sort_order) VALUES ('R&B',         6);
INSERT OR IGNORE INTO lkup_music_top_genres (genre_name, sort_order) VALUES ('Jazz',        7);
INSERT OR IGNORE INTO lkup_music_top_genres (genre_name, sort_order) VALUES ('Classical',   8);
INSERT OR IGNORE INTO lkup_music_top_genres (genre_name, sort_order) VALUES ('Country',     9);
INSERT OR IGNORE INTO lkup_music_top_genres (genre_name, sort_order) VALUES ('Other',      10);

-- update modules_enabled to include music
UPDATE tbl_app_settings
SET value = (
    SELECT CASE
        WHEN value LIKE '%"music"%' THEN value
        ELSE REPLACE(value, ']', ',"music"]')
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
        "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%music%'"
    ).fetchall()]
    print(f"  Tables created: {tables}")

    formats = conn.execute("SELECT format_name FROM lkup_music_format_types ORDER BY sort_order").fetchall()
    print(f"  Format types seeded: {[f[0] for f in formats]}")

    genres = conn.execute("SELECT genre_name FROM lkup_music_top_genres ORDER BY sort_order").fetchall()
    print(f"  Genres seeded: {[g[0] for g in genres]}")

    ct = conn.execute(
        "SELECT collection_type_id FROM lkup_collection_types WHERE collection_type_code = 'music'"
    ).fetchone()
    print(f"  Collection type id: {ct[0] if ct else 'NOT FOUND'}")

    cats = conn.execute("""
        SELECT ltc.category_name FROM lkup_top_level_categories ltc
        JOIN lkup_collection_types lct ON ltc.collection_type_id = lct.collection_type_id
        WHERE lct.collection_type_code = 'music'
        ORDER BY ltc.sort_order
    """).fetchall()
    print(f"  Release types seeded: {[c[0] for c in cats]}")

    modules = conn.execute("SELECT value FROM tbl_app_settings WHERE key = 'modules_enabled'").fetchone()
    print(f"  modules_enabled: {modules[0] if modules else 'NOT FOUND'}")

    conn.close()
    print("Migration complete.")


if __name__ == "__main__":
    main()
