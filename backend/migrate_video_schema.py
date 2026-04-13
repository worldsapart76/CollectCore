"""
Migration: Add Video module tables to live CollectCore database.

Run from the backend/ directory:
    python migrate_video_schema.py

Safe to re-run — all DDL uses IF NOT EXISTS, all inserts use INSERT OR IGNORE.
"""
import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).resolve().parents[1] / "data" / "collectcore.db"

DDL = """
PRAGMA foreign_keys = ON;

-- ============================================================
-- VIDEO LOOKUP TABLES
-- ============================================================

CREATE TABLE IF NOT EXISTS lkup_video_format_types (
    format_type_id  INTEGER PRIMARY KEY AUTOINCREMENT,
    format_name     TEXT NOT NULL UNIQUE,
    sort_order      INTEGER NOT NULL DEFAULT 0,
    is_active       INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS lkup_video_directors (
    director_id    INTEGER PRIMARY KEY AUTOINCREMENT,
    director_name  TEXT NOT NULL UNIQUE,
    is_active      INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS lkup_video_cast (
    cast_id    INTEGER PRIMARY KEY AUTOINCREMENT,
    cast_name  TEXT NOT NULL UNIQUE,
    is_active  INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS lkup_video_top_genres (
    top_genre_id  INTEGER PRIMARY KEY AUTOINCREMENT,
    genre_name    TEXT NOT NULL UNIQUE,
    sort_order    INTEGER NOT NULL DEFAULT 0,
    is_active     INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS lkup_video_sub_genres (
    sub_genre_id   INTEGER PRIMARY KEY AUTOINCREMENT,
    top_genre_id   INTEGER NOT NULL,
    sub_genre_name TEXT NOT NULL,
    sort_order     INTEGER NOT NULL DEFAULT 0,
    is_active      INTEGER NOT NULL DEFAULT 1,
    UNIQUE (sub_genre_name, top_genre_id),
    FOREIGN KEY (top_genre_id) REFERENCES lkup_video_top_genres(top_genre_id)
);

-- ============================================================
-- VIDEO CORE TABLES
-- ============================================================

CREATE TABLE IF NOT EXISTS tbl_video_details (
    item_id           INTEGER PRIMARY KEY,
    title             TEXT NOT NULL,
    title_sort        TEXT,
    description       TEXT,
    release_date      TEXT,
    runtime_minutes   INTEGER,
    cover_image_url   TEXT,
    api_source        TEXT,
    external_work_id  TEXT,
    FOREIGN KEY (item_id) REFERENCES tbl_items(item_id) ON DELETE CASCADE
);

-- Used by Movie, Miniseries, Concert/Live (not TV Series)
CREATE TABLE IF NOT EXISTS tbl_video_copies (
    copy_id             INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id             INTEGER NOT NULL,
    format_type_id      INTEGER,
    ownership_status_id INTEGER,
    notes               TEXT,
    FOREIGN KEY (item_id) REFERENCES tbl_video_details(item_id) ON DELETE CASCADE,
    FOREIGN KEY (format_type_id) REFERENCES lkup_video_format_types(format_type_id),
    FOREIGN KEY (ownership_status_id) REFERENCES lkup_ownership_statuses(ownership_status_id)
);

-- Used by TV Series only
CREATE TABLE IF NOT EXISTS tbl_video_seasons (
    season_id           INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id             INTEGER NOT NULL,
    season_number       INTEGER NOT NULL,
    episode_count       INTEGER,
    format_type_id      INTEGER,
    ownership_status_id INTEGER,
    notes               TEXT,
    FOREIGN KEY (item_id) REFERENCES tbl_video_details(item_id) ON DELETE CASCADE,
    FOREIGN KEY (format_type_id) REFERENCES lkup_video_format_types(format_type_id),
    FOREIGN KEY (ownership_status_id) REFERENCES lkup_ownership_statuses(ownership_status_id)
);

-- ============================================================
-- VIDEO XREF TABLES
-- ============================================================

CREATE TABLE IF NOT EXISTS xref_video_directors (
    xref_id        INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id        INTEGER NOT NULL,
    director_id    INTEGER NOT NULL,
    director_order INTEGER NOT NULL DEFAULT 0,
    UNIQUE (item_id, director_id),
    FOREIGN KEY (item_id) REFERENCES tbl_video_details(item_id) ON DELETE CASCADE,
    FOREIGN KEY (director_id) REFERENCES lkup_video_directors(director_id)
);

CREATE TABLE IF NOT EXISTS xref_video_cast (
    xref_id    INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id    INTEGER NOT NULL,
    cast_id    INTEGER NOT NULL,
    cast_order INTEGER NOT NULL DEFAULT 0,
    UNIQUE (item_id, cast_id),
    FOREIGN KEY (item_id) REFERENCES tbl_video_details(item_id) ON DELETE CASCADE,
    FOREIGN KEY (cast_id) REFERENCES lkup_video_cast(cast_id)
);

CREATE TABLE IF NOT EXISTS xref_video_genres (
    xref_id       INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id       INTEGER NOT NULL,
    top_genre_id  INTEGER NOT NULL,
    sub_genre_id  INTEGER,
    FOREIGN KEY (item_id) REFERENCES tbl_video_details(item_id) ON DELETE CASCADE,
    FOREIGN KEY (top_genre_id) REFERENCES lkup_video_top_genres(top_genre_id),
    FOREIGN KEY (sub_genre_id) REFERENCES lkup_video_sub_genres(sub_genre_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_video_genres_with_sub
ON xref_video_genres(item_id, top_genre_id, sub_genre_id)
WHERE sub_genre_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_video_genres_no_sub
ON xref_video_genres(item_id, top_genre_id)
WHERE sub_genre_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_video_details_title ON tbl_video_details(title);
CREATE INDEX IF NOT EXISTS idx_video_copies_item ON tbl_video_copies(item_id);
CREATE INDEX IF NOT EXISTS idx_video_seasons_item ON tbl_video_seasons(item_id);
"""

SEED = """
-- Video format types
INSERT OR IGNORE INTO lkup_video_format_types (format_name, sort_order) VALUES ('Blu-ray',   1);
INSERT OR IGNORE INTO lkup_video_format_types (format_name, sort_order) VALUES ('4K UHD',    2);
INSERT OR IGNORE INTO lkup_video_format_types (format_name, sort_order) VALUES ('DVD',       3);
INSERT OR IGNORE INTO lkup_video_format_types (format_name, sort_order) VALUES ('Digital',   4);
INSERT OR IGNORE INTO lkup_video_format_types (format_name, sort_order) VALUES ('Streaming', 5);
INSERT OR IGNORE INTO lkup_video_format_types (format_name, sort_order) VALUES ('VHS',       6);
INSERT OR IGNORE INTO lkup_video_format_types (format_name, sort_order) VALUES ('Other',     7);

-- Video top genres
INSERT OR IGNORE INTO lkup_video_top_genres (genre_name, sort_order) VALUES ('Action',      1);
INSERT OR IGNORE INTO lkup_video_top_genres (genre_name, sort_order) VALUES ('Comedy',      2);
INSERT OR IGNORE INTO lkup_video_top_genres (genre_name, sort_order) VALUES ('Drama',       3);
INSERT OR IGNORE INTO lkup_video_top_genres (genre_name, sort_order) VALUES ('Sci-Fi',      4);
INSERT OR IGNORE INTO lkup_video_top_genres (genre_name, sort_order) VALUES ('Horror',      5);
INSERT OR IGNORE INTO lkup_video_top_genres (genre_name, sort_order) VALUES ('Romance',     6);
INSERT OR IGNORE INTO lkup_video_top_genres (genre_name, sort_order) VALUES ('Documentary', 7);
INSERT OR IGNORE INTO lkup_video_top_genres (genre_name, sort_order) VALUES ('Animation',   8);
INSERT OR IGNORE INTO lkup_video_top_genres (genre_name, sort_order) VALUES ('K-drama',     9);
INSERT OR IGNORE INTO lkup_video_top_genres (genre_name, sort_order) VALUES ('Other',      10);

-- Watch statuses (add to shared consumption status table)
INSERT OR IGNORE INTO lkup_book_read_statuses (status_name, sort_order) VALUES ('Watched',           20);
INSERT OR IGNORE INTO lkup_book_read_statuses (status_name, sort_order) VALUES ('Currently Watching', 21);
INSERT OR IGNORE INTO lkup_book_read_statuses (status_name, sort_order) VALUES ('Want to Watch',      22);
-- 'Abandoned' was already added by the Video Games migration

-- Collection type
INSERT OR IGNORE INTO lkup_collection_types (collection_type_code, collection_type_name, sort_order)
VALUES ('video', 'Video', 6);

-- Top-level categories (video types)
INSERT OR IGNORE INTO lkup_top_level_categories (collection_type_id, category_name, sort_order)
SELECT (SELECT collection_type_id FROM lkup_collection_types WHERE collection_type_code = 'video'), 'Movie', 1
WHERE NOT EXISTS (
    SELECT 1 FROM lkup_top_level_categories ltc
    JOIN lkup_collection_types lct ON ltc.collection_type_id = lct.collection_type_id
    WHERE lct.collection_type_code = 'video' AND ltc.category_name = 'Movie'
);
INSERT OR IGNORE INTO lkup_top_level_categories (collection_type_id, category_name, sort_order)
SELECT (SELECT collection_type_id FROM lkup_collection_types WHERE collection_type_code = 'video'), 'TV Series', 2
WHERE NOT EXISTS (
    SELECT 1 FROM lkup_top_level_categories ltc
    JOIN lkup_collection_types lct ON ltc.collection_type_id = lct.collection_type_id
    WHERE lct.collection_type_code = 'video' AND ltc.category_name = 'TV Series'
);
INSERT OR IGNORE INTO lkup_top_level_categories (collection_type_id, category_name, sort_order)
SELECT (SELECT collection_type_id FROM lkup_collection_types WHERE collection_type_code = 'video'), 'Miniseries', 3
WHERE NOT EXISTS (
    SELECT 1 FROM lkup_top_level_categories ltc
    JOIN lkup_collection_types lct ON ltc.collection_type_id = lct.collection_type_id
    WHERE lct.collection_type_code = 'video' AND ltc.category_name = 'Miniseries'
);
INSERT OR IGNORE INTO lkup_top_level_categories (collection_type_id, category_name, sort_order)
SELECT (SELECT collection_type_id FROM lkup_collection_types WHERE collection_type_code = 'video'), 'Concert/Live', 4
WHERE NOT EXISTS (
    SELECT 1 FROM lkup_top_level_categories ltc
    JOIN lkup_collection_types lct ON ltc.collection_type_id = lct.collection_type_id
    WHERE lct.collection_type_code = 'video' AND ltc.category_name = 'Concert/Live'
);

-- Update modules_enabled to include video
UPDATE tbl_app_settings
SET value = (
    SELECT CASE
        WHEN value LIKE '%"video"%' THEN value
        ELSE REPLACE(value, ']', ',"video"]')
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
        "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%video%'"
    ).fetchall()]
    print(f"  Tables created: {tables}")

    formats = conn.execute("SELECT format_name FROM lkup_video_format_types ORDER BY sort_order").fetchall()
    print(f"  Format types seeded: {[f[0] for f in formats]}")

    genres = conn.execute("SELECT genre_name FROM lkup_video_top_genres ORDER BY sort_order").fetchall()
    print(f"  Genres seeded: {[g[0] for g in genres]}")

    ct = conn.execute(
        "SELECT collection_type_id FROM lkup_collection_types WHERE collection_type_code = 'video'"
    ).fetchone()
    print(f"  Collection type id: {ct[0] if ct else 'NOT FOUND'}")

    cats = conn.execute("""
        SELECT ltc.category_name FROM lkup_top_level_categories ltc
        JOIN lkup_collection_types lct ON ltc.collection_type_id = lct.collection_type_id
        WHERE lct.collection_type_code = 'video'
        ORDER BY ltc.sort_order
    """).fetchall()
    print(f"  Video types seeded: {[c[0] for c in cats]}")

    watch = conn.execute(
        "SELECT status_name FROM lkup_book_read_statuses WHERE status_name IN ('Watched','Currently Watching','Want to Watch') ORDER BY sort_order"
    ).fetchall()
    print(f"  Watch statuses seeded: {[w[0] for w in watch]}")

    modules = conn.execute("SELECT value FROM tbl_app_settings WHERE key = 'modules_enabled'").fetchone()
    print(f"  modules_enabled: {modules[0] if modules else 'NOT FOUND'}")

    conn.close()
    print("Migration complete.")


if __name__ == "__main__":
    main()
