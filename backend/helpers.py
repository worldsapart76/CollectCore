"""
Shared helper functions used across multiple CollectCore modules.

generic_upsert / generic_scoped_upsert replace 15+ identical per-module
upsert functions.  Table and column names come from hardcoded registries
(never from user input), so the f-string SQL is safe.
"""

from sqlalchemy import text

# ---------------------------------------------------------------------------
# Upsert registry — (table, id_column, name_column)
# ---------------------------------------------------------------------------
UPSERT_REGISTRY: dict[str, tuple[str, str, str]] = {
    # Books
    "book_author":          ("lkup_book_authors",           "author_id",    "author_name"),
    "book_series":          ("tbl_book_series",             "series_id",    "series_name"),
    "book_tag":             ("lkup_book_tags",              "tag_id",       "tag_name"),
    # Graphic Novels
    "gn_writer":            ("lkup_graphicnovel_writers",   "writer_id",    "writer_name"),
    "gn_artist":            ("lkup_graphicnovel_artists",   "artist_id",    "artist_name"),
    "gn_tag":               ("lkup_graphicnovel_tags",      "tag_id",       "tag_name"),
    # Video Games
    "game_developer":       ("lkup_game_developers",        "developer_id", "developer_name"),
    "game_publisher":       ("lkup_game_publishers",        "publisher_id", "publisher_name"),
    # Video
    "video_director":       ("lkup_video_directors",        "director_id",  "director_name"),
    "video_cast":           ("lkup_video_cast",             "cast_id",      "cast_name"),
    # Board Games
    "boardgame_designer":   ("lkup_boardgame_designers",    "designer_id",  "designer_name"),
    "boardgame_publisher":  ("lkup_boardgame_publishers",   "publisher_id", "publisher_name"),
    # TTRPG
    "ttrpg_author":         ("lkup_ttrpg_authors",          "author_id",    "author_name"),
    "ttrpg_publisher":      ("lkup_ttrpg_publishers",       "publisher_id", "publisher_name"),
}

# Scoped upserts — (table, id_column, name_column, scope_column)
SCOPED_UPSERT_REGISTRY: dict[str, tuple[str, str, str, str]] = {
    "ttrpg_system_edition": ("lkup_ttrpg_system_editions", "edition_id", "edition_name", "system_category_id"),
    "ttrpg_line":           ("lkup_ttrpg_lines",           "line_id",    "line_name",    "system_category_id"),
}


def generic_upsert(db, key: str, value: str) -> int:
    """Find-or-create a row in a lookup table.  Returns the row's ID."""
    if key not in UPSERT_REGISTRY:
        raise ValueError(f"Unknown upsert key: {key}")
    table, id_col, name_col = UPSERT_REGISTRY[key]
    clean = value.strip()
    row = db.execute(
        text(f"SELECT {id_col} FROM {table} WHERE LOWER(TRIM({name_col})) = LOWER(TRIM(:name))"),
        {"name": clean},
    ).fetchone()
    if row:
        return row[0]
    result = db.execute(
        text(f"INSERT INTO {table} ({name_col}) VALUES (:name) RETURNING {id_col}"),
        {"name": clean},
    ).fetchone()
    return result[0]


def generic_scoped_upsert(db, key: str, scope_value: int, value: str) -> int:
    """Find-or-create a row scoped by a parent ID (e.g. TTRPG editions per system)."""
    if key not in SCOPED_UPSERT_REGISTRY:
        raise ValueError(f"Unknown scoped upsert key: {key}")
    table, id_col, name_col, scope_col = SCOPED_UPSERT_REGISTRY[key]
    clean = value.strip()
    row = db.execute(
        text(f"SELECT {id_col} FROM {table} WHERE {scope_col} = :scope AND LOWER(TRIM({name_col})) = LOWER(TRIM(:name))"),
        {"scope": scope_value, "name": clean},
    ).fetchone()
    if row:
        return row[0]
    result = db.execute(
        text(f"INSERT INTO {table} ({scope_col}, {name_col}) VALUES (:scope, :name) RETURNING {id_col}"),
        {"scope": scope_value, "name": clean},
    ).fetchone()
    return result[0]


# ---------------------------------------------------------------------------
# Title sort helpers
# ---------------------------------------------------------------------------

def make_title_sort(title: str) -> str:
    """Strip leading article for sort order.  'The Great Gatsby' → 'Great Gatsby'."""
    for article in ("The ", "A ", "An "):
        if title.startswith(article):
            return title[len(article):]
    return title


def make_title_sort_suffixed(title: str) -> str:
    """Move leading article to suffix.  'The Wall' → 'Wall, The'."""
    for article in ("The ", "A ", "An "):
        if title.startswith(article):
            return title[len(article):] + ", " + article.strip()
    return title
