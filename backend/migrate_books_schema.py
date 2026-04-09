"""
Phase 1: Books module schema migration.

Drops the old book tables (tbl_book_works-based schema) from the live DB,
creates the new 3-layer schema (tbl_items → tbl_book_details → tbl_book_copies),
adds reading_status_id to tbl_items, and seeds all book lookup data.

Safe to run multiple times (idempotent).
"""

import sqlite3
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parents[1]
DB_PATH = APP_ROOT / "data" / "collectcore.db"

BOOK_COLLECTION_TYPE_CODE = "book"
BOOK_COLLECTION_TYPE_NAME = "Book"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def get_columns(conn, table_name):
    rows = conn.execute(f"PRAGMA table_info({table_name})").fetchall()
    return {row[1] for row in rows}


def table_exists(conn, table_name):
    row = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table_name,)
    ).fetchone()
    return row is not None


# ---------------------------------------------------------------------------
# Step 1: Drop old book tables
# ---------------------------------------------------------------------------

OLD_BOOK_TABLES = [
    # xrefs first (they reference the tables below)
    "xref_book_work_tags",
    "xref_book_work_genres",
    "xref_book_work_series",
    "xref_book_work_authors",
    # item-level table (references tbl_items and tbl_book_works)
    "tbl_book_details",
    # work table
    "tbl_book_works",
    # lookup tables
    "lkup_book_sub_genres",
    "lkup_book_top_level_genres",
    "lkup_book_authors",
    "tbl_book_series",
    "tbl_book_tags",
    "lkup_book_sources",
    "lkup_book_read_statuses",
    "lkup_book_age_levels",
]


def drop_old_tables(conn):
    print("Dropping old book tables...")
    conn.execute("PRAGMA foreign_keys = OFF")
    for t in OLD_BOOK_TABLES:
        conn.execute(f"DROP TABLE IF EXISTS {t}")
        print(f"  dropped (if existed): {t}")
    conn.execute("PRAGMA foreign_keys = ON")
    print("  done.")


# ---------------------------------------------------------------------------
# Step 2: Alter tbl_items
# ---------------------------------------------------------------------------

def alter_tbl_items(conn):
    print("Checking tbl_items for reading_status_id...")
    cols = get_columns(conn, "tbl_items")
    if "reading_status_id" not in cols:
        conn.execute(
            "ALTER TABLE tbl_items ADD COLUMN reading_status_id INTEGER"
        )
        print("  added column: tbl_items.reading_status_id")
    else:
        print("  column already exists: tbl_items.reading_status_id — skipping.")


# ---------------------------------------------------------------------------
# Step 3: Create new book tables
# ---------------------------------------------------------------------------

CREATE_BOOK_TABLES_SQL = """
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS lkup_book_read_statuses (
    read_status_id  INTEGER PRIMARY KEY AUTOINCREMENT,
    status_name     TEXT NOT NULL UNIQUE,
    sort_order      INTEGER NOT NULL DEFAULT 0,
    is_active       INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS lkup_book_format_details (
    format_detail_id  INTEGER PRIMARY KEY AUTOINCREMENT,
    format_name       TEXT NOT NULL UNIQUE,
    top_level_format  TEXT NOT NULL CHECK (top_level_format IN ('Physical', 'Digital', 'Audio')),
    sort_order        INTEGER NOT NULL DEFAULT 0,
    is_active         INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS lkup_book_top_level_genres (
    top_level_genre_id  INTEGER PRIMARY KEY AUTOINCREMENT,
    category_scope_id   INTEGER NOT NULL,
    genre_name          TEXT NOT NULL,
    sort_order          INTEGER NOT NULL DEFAULT 0,
    is_active           INTEGER NOT NULL DEFAULT 1,
    UNIQUE (genre_name, category_scope_id),
    FOREIGN KEY (category_scope_id) REFERENCES lkup_top_level_categories(top_level_category_id)
);

CREATE TABLE IF NOT EXISTS lkup_book_sub_genres (
    sub_genre_id        INTEGER PRIMARY KEY AUTOINCREMENT,
    top_level_genre_id  INTEGER NOT NULL,
    sub_genre_name      TEXT NOT NULL,
    sort_order          INTEGER NOT NULL DEFAULT 0,
    is_active           INTEGER NOT NULL DEFAULT 1,
    UNIQUE (sub_genre_name, top_level_genre_id),
    FOREIGN KEY (top_level_genre_id) REFERENCES lkup_book_top_level_genres(top_level_genre_id)
);

CREATE TABLE IF NOT EXISTS lkup_book_age_levels (
    age_level_id    INTEGER PRIMARY KEY AUTOINCREMENT,
    age_level_name  TEXT NOT NULL UNIQUE,
    sort_order      INTEGER NOT NULL DEFAULT 0,
    is_active       INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS lkup_book_authors (
    author_id    INTEGER PRIMARY KEY AUTOINCREMENT,
    author_name  TEXT NOT NULL UNIQUE,
    author_sort  TEXT,
    sort_order   INTEGER NOT NULL DEFAULT 0,
    is_active    INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS lkup_book_tags (
    tag_id     INTEGER PRIMARY KEY AUTOINCREMENT,
    tag_name   TEXT NOT NULL UNIQUE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_active  INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS tbl_book_series (
    series_id    INTEGER PRIMARY KEY AUTOINCREMENT,
    series_name  TEXT NOT NULL UNIQUE,
    series_sort  TEXT,
    is_active    INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS tbl_book_details (
    item_id             INTEGER PRIMARY KEY,
    title               TEXT NOT NULL,
    title_sort          TEXT,
    description         TEXT,
    age_level_id        INTEGER,
    star_rating         INTEGER CHECK (star_rating BETWEEN 1 AND 5),
    review              TEXT,
    api_categories_raw  TEXT,
    FOREIGN KEY (item_id) REFERENCES tbl_items(item_id) ON DELETE CASCADE,
    FOREIGN KEY (age_level_id) REFERENCES lkup_book_age_levels(age_level_id)
);

CREATE TABLE IF NOT EXISTS tbl_book_copies (
    copy_id           INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id           INTEGER NOT NULL,
    format_detail_id  INTEGER NOT NULL,
    isbn_13           TEXT,
    isbn_10           TEXT,
    publisher         TEXT,
    published_date    TEXT,
    page_count        INTEGER,
    language          TEXT DEFAULT 'en',
    cover_image_url   TEXT,
    notes             TEXT,
    api_source        TEXT,
    external_work_id  TEXT,
    UNIQUE (item_id, format_detail_id),
    FOREIGN KEY (item_id) REFERENCES tbl_book_details(item_id) ON DELETE CASCADE,
    FOREIGN KEY (format_detail_id) REFERENCES lkup_book_format_details(format_detail_id)
);

CREATE TABLE IF NOT EXISTS xref_book_item_authors (
    item_id       INTEGER NOT NULL,
    author_id     INTEGER NOT NULL,
    author_order  INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (item_id, author_id),
    FOREIGN KEY (item_id) REFERENCES tbl_book_details(item_id) ON DELETE CASCADE,
    FOREIGN KEY (author_id) REFERENCES lkup_book_authors(author_id)
);

CREATE TABLE IF NOT EXISTS xref_book_item_series (
    item_id        INTEGER NOT NULL,
    series_id      INTEGER NOT NULL,
    series_number  REAL,
    PRIMARY KEY (item_id, series_id),
    FOREIGN KEY (item_id) REFERENCES tbl_book_details(item_id) ON DELETE CASCADE,
    FOREIGN KEY (series_id) REFERENCES tbl_book_series(series_id)
);

CREATE TABLE IF NOT EXISTS xref_book_item_genres (
    xref_id             INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id             INTEGER NOT NULL,
    top_level_genre_id  INTEGER NOT NULL,
    sub_genre_id        INTEGER,
    FOREIGN KEY (item_id) REFERENCES tbl_book_details(item_id) ON DELETE CASCADE,
    FOREIGN KEY (top_level_genre_id) REFERENCES lkup_book_top_level_genres(top_level_genre_id),
    FOREIGN KEY (sub_genre_id) REFERENCES lkup_book_sub_genres(sub_genre_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_book_item_genres_with_sub
ON xref_book_item_genres(item_id, top_level_genre_id, sub_genre_id)
WHERE sub_genre_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_book_item_genres_no_sub
ON xref_book_item_genres(item_id, top_level_genre_id)
WHERE sub_genre_id IS NULL;

CREATE TABLE IF NOT EXISTS xref_book_item_tags (
    item_id   INTEGER NOT NULL,
    tag_id    INTEGER NOT NULL,
    PRIMARY KEY (item_id, tag_id),
    FOREIGN KEY (item_id) REFERENCES tbl_book_details(item_id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id) REFERENCES lkup_book_tags(tag_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_book_copies_isbn13
ON tbl_book_copies(isbn_13)
WHERE isbn_13 IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_book_details_title
ON tbl_book_details(title);
"""


def create_new_tables(conn):
    print("Creating new book tables...")
    conn.executescript(CREATE_BOOK_TABLES_SQL)
    print("  done.")


# ---------------------------------------------------------------------------
# Step 4: Seed lookup data
# ---------------------------------------------------------------------------

def seed_collection_type(conn):
    """Ensure book collection type exists; return its ID."""
    row = conn.execute(
        "SELECT collection_type_id FROM lkup_collection_types WHERE collection_type_code = ?",
        (BOOK_COLLECTION_TYPE_CODE,)
    ).fetchone()
    if row:
        print(f"  lkup_collection_types (book) already exists — skipping.")
        return row[0]

    conn.execute(
        "INSERT INTO lkup_collection_types (collection_type_code, collection_type_name, sort_order, is_active) "
        "VALUES (?, ?, 2, 1)",
        (BOOK_COLLECTION_TYPE_CODE, BOOK_COLLECTION_TYPE_NAME)
    )
    book_type_id = conn.execute(
        "SELECT collection_type_id FROM lkup_collection_types WHERE collection_type_code = ?",
        (BOOK_COLLECTION_TYPE_CODE,)
    ).fetchone()[0]
    print(f"  seeded: lkup_collection_types (book, id={book_type_id})")
    return book_type_id


def seed_top_level_categories(conn, book_type_id):
    """Ensure Fiction and Non-Fiction exist for books; return their IDs."""
    categories = ["Fiction", "Non-Fiction"]
    ids = {}
    for i, name in enumerate(categories, start=1):
        row = conn.execute(
            "SELECT top_level_category_id FROM lkup_top_level_categories "
            "WHERE collection_type_id = ? AND category_name = ?",
            (book_type_id, name)
        ).fetchone()
        if row:
            ids[name] = row[0]
        else:
            conn.execute(
                "INSERT INTO lkup_top_level_categories (collection_type_id, category_name, sort_order, is_active) "
                "VALUES (?, ?, ?, 1)",
                (book_type_id, name, i)
            )
            ids[name] = conn.execute(
                "SELECT top_level_category_id FROM lkup_top_level_categories "
                "WHERE collection_type_id = ? AND category_name = ?",
                (book_type_id, name)
            ).fetchone()[0]
    print(f"  seeded: lkup_top_level_categories (Fiction id={ids['Fiction']}, Non-Fiction id={ids['Non-Fiction']})")
    return ids


def seed_ownership_statuses(conn):
    """Add Borrowed ownership status if not present."""
    row = conn.execute(
        "SELECT 1 FROM lkup_ownership_statuses WHERE status_code = 'borrowed'"
    ).fetchone()
    if not row:
        # Get current max sort_order
        max_order = conn.execute(
            "SELECT COALESCE(MAX(sort_order), 0) FROM lkup_ownership_statuses"
        ).fetchone()[0]
        conn.execute(
            "INSERT INTO lkup_ownership_statuses (status_code, status_name, sort_order, is_active) "
            "VALUES ('borrowed', 'Borrowed', ?, 1)",
            (max_order + 1,)
        )
        print("  seeded: lkup_ownership_statuses (Borrowed)")
    else:
        print("  lkup_ownership_statuses (Borrowed) already exists — skipping.")


def seed_read_statuses(conn):
    statuses = [
        ("Read", 1),
        ("Currently Reading", 2),
        ("Want to Read", 3),
        ("DNF", 4),
    ]
    for name, order in statuses:
        conn.execute(
            "INSERT OR IGNORE INTO lkup_book_read_statuses (status_name, sort_order) VALUES (?, ?)",
            (name, order)
        )
    print("  seeded: lkup_book_read_statuses (Read, Currently Reading, Want to Read, DNF)")


def seed_format_details(conn):
    formats = [
        ("Hardcover",              "Physical", 1),
        ("Paperback",              "Physical", 2),
        ("Mass Market Paperback",  "Physical", 3),
        ("Kindle",                 "Digital",  4),
        ("Kobo",                   "Digital",  5),
        ("Other Ebook",            "Digital",  6),
        ("Audible",                "Audio",    7),
        ("Other Audio",            "Audio",    8),
    ]
    for name, top_level, order in formats:
        conn.execute(
            "INSERT OR IGNORE INTO lkup_book_format_details (format_name, top_level_format, sort_order) "
            "VALUES (?, ?, ?)",
            (name, top_level, order)
        )
    print(f"  seeded: lkup_book_format_details ({len(formats)} formats)")


def seed_age_levels(conn):
    levels = [
        ("Children's",   1),
        ("Middle Grade", 2),
        ("Young Adult",  3),
        ("New Adult",    4),
        ("Adult",        5),
    ]
    for name, order in levels:
        conn.execute(
            "INSERT OR IGNORE INTO lkup_book_age_levels (age_level_name, sort_order) VALUES (?, ?)",
            (name, order)
        )
    print(f"  seeded: lkup_book_age_levels ({len(levels)} levels)")


def seed_genres(conn, category_ids):
    """
    Seed lkup_book_top_level_genres and lkup_book_sub_genres.
    Genres are scoped to Fiction or Non-Fiction via category_scope_id.
    """
    fiction_id = category_ids["Fiction"]
    nonfiction_id = category_ids["Non-Fiction"]

    genre_data = [
        # (category_scope_id, genre_name, sort_order, subgenres)
        (fiction_id,    "Fantasy",         1, ["Epic Fantasy", "Urban Fantasy", "Fairy Tale", "Mythology", "Magical Realism"]),
        (fiction_id,    "Science Fiction", 2, ["Hard SF", "Soft SF", "Space Opera", "Dystopian", "Steampunk", "Time Travel"]),
        (fiction_id,    "Romance",         3, ["Contemporary", "Historical", "Paranormal", "Romantic Suspense", "Fantasy", "Dark", "Sci-Fi"]),
        (fiction_id,    "Crime",           4, ["Mystery", "Suspense/Thriller", "Police Procedural", "Historical"]),
        (fiction_id,    "Horror",          5, ["Paranormal", "Gothic"]),
        (fiction_id,    "Other",           6, ["Contemporary", "Historical Fiction"]),
        (nonfiction_id, "Biography",       1, []),
        (nonfiction_id, "History",         2, []),
        (nonfiction_id, "Learning",        3, ["Writing", "Filmmaking"]),
        (nonfiction_id, "True Crime",      4, []),
        (nonfiction_id, "Other",           5, ["Cookbook", "Art/Photography", "Religion", "Humor", "Reference"]),
    ]

    total_genres = 0
    total_subgenres = 0

    for category_scope_id, genre_name, sort_order, subgenres in genre_data:
        # Upsert genre
        conn.execute(
            "INSERT OR IGNORE INTO lkup_book_top_level_genres "
            "(category_scope_id, genre_name, sort_order) VALUES (?, ?, ?)",
            (category_scope_id, genre_name, sort_order)
        )
        genre_id = conn.execute(
            "SELECT top_level_genre_id FROM lkup_book_top_level_genres "
            "WHERE category_scope_id = ? AND genre_name = ?",
            (category_scope_id, genre_name)
        ).fetchone()[0]
        total_genres += 1

        for sub_order, sub_name in enumerate(subgenres, start=1):
            conn.execute(
                "INSERT OR IGNORE INTO lkup_book_sub_genres "
                "(top_level_genre_id, sub_genre_name, sort_order) VALUES (?, ?, ?)",
                (genre_id, sub_name, sub_order)
            )
            total_subgenres += 1

    print(f"  seeded: lkup_book_top_level_genres ({total_genres} genres)")
    print(f"  seeded: lkup_book_sub_genres ({total_subgenres} subgenres)")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def migrate():
    print(f"Books schema migration — DB: {DB_PATH}")
    print()

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row

    try:
        # Step 1: Drop old tables
        drop_old_tables(conn)
        print()

        # Step 2: Alter tbl_items
        alter_tbl_items(conn)
        print()

        # Step 3: Create new tables
        create_new_tables(conn)
        print()

        # Step 4: Seed
        print("Seeding lookup data...")
        book_type_id = seed_collection_type(conn)
        category_ids = seed_top_level_categories(conn, book_type_id)
        seed_ownership_statuses(conn)
        seed_read_statuses(conn)
        seed_format_details(conn)
        seed_age_levels(conn)
        seed_genres(conn, category_ids)

        conn.commit()
        print()
        print("Migration complete.")

    except Exception as e:
        conn.rollback()
        print(f"\nERROR: {e}")
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    migrate()
