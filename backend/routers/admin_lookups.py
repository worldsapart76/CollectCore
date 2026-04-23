"""Admin: lookup management (view / edit / merge / re-activate / hard-delete).

The registry `_LOOKUP_REGISTRY_LIST` below describes every managed lookup table.
It is the single source of truth for both this router and the legacy "Unused
Lookup Cleanup" scanner in `admin.py`, which consumes it via
`cleanable_lookups_for_scan()`.

Registry fields (per entry):
    label          Human name shown in the UI.
    table          Lookup table name.
    pk             Primary-key column.
    name_col       Main editable name column.
    sort_col       sort_order column, or None if the table lacks one.
    secondary_cols List of (col, label) — extra editable string columns
                   (e.g., author_sort, group_code).
    scope          List of dicts; merging is forbidden across different scope
                   values. Each: {"col", "label", "src_table", "src_pk", "src_name"}.
    refs           List of dicts, one per FK referencing this lookup. Each:
                      {"table", "fk", "dedupe_cols"}
                   dedupe_cols names the columns that, together with fk, form a
                   unique row — merges delete source-rows that would collide
                   with existing target-rows before the UPDATE rewrite. None
                   means the fk column has no uniqueness involvement and a
                   plain UPDATE is safe.
    cleanable      If True, rows appear in the scan-for-unused cleanup.
    mergeable      If False, merge is blocked (cascades into other lookup
                   tables, or rich-data copy rows would be lost).
"""

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text

from dependencies import get_db

router = APIRouter(tags=["admin"])


# ---------- Registry ----------

_LOOKUP_REGISTRY_LIST: List[Dict[str, Any]] = [
    # ── Photocards ───────────────────────────────────────────────────────────
    {
        "label": "Photocard Groups",
        "table": "lkup_photocard_groups",
        "pk": "group_id", "name_col": "group_name",
        "sort_col": "sort_order",
        "secondary_cols": [("group_code", "Code")],
        "scope": [],
        "refs": [
            {"table": "tbl_photocard_details",         "fk": "group_id", "dedupe_cols": None},
            {"table": "lkup_photocard_members",        "fk": "group_id", "dedupe_cols": None},
            {"table": "lkup_photocard_source_origins", "fk": "group_id", "dedupe_cols": None},
        ],
        "cleanable": True, "mergeable": False,  # cascades into child lookup tables
    },
    {
        "label": "Photocard Members",
        "table": "lkup_photocard_members",
        "pk": "member_id", "name_col": "member_name",
        "sort_col": "sort_order",
        "secondary_cols": [("member_code", "Code")],
        "scope": [
            {"col": "group_id", "label": "Group",
             "src_table": "lkup_photocard_groups", "src_pk": "group_id", "src_name": "group_name"},
        ],
        "refs": [
            {"table": "xref_photocard_members", "fk": "member_id", "dedupe_cols": ["item_id"]},
        ],
        "cleanable": True, "mergeable": True,
    },
    {
        "label": "Photocard Source Origins",
        "table": "lkup_photocard_source_origins",
        "pk": "source_origin_id", "name_col": "source_origin_name",
        "sort_col": "sort_order",
        "secondary_cols": [],
        "scope": [
            {"col": "group_id", "label": "Group",
             "src_table": "lkup_photocard_groups", "src_pk": "group_id", "src_name": "group_name"},
            {"col": "top_level_category_id", "label": "Category",
             "src_table": "lkup_top_level_categories", "src_pk": "top_level_category_id", "src_name": "category_name"},
        ],
        "refs": [
            {"table": "tbl_photocard_details", "fk": "source_origin_id", "dedupe_cols": None},
        ],
        "cleanable": True, "mergeable": True,
    },
    # ── Books ────────────────────────────────────────────────────────────────
    {
        "label": "Book Format Details",
        "table": "lkup_book_format_details",
        "pk": "format_detail_id", "name_col": "format_name",
        "sort_col": "sort_order",
        "secondary_cols": [("top_level_format", "Top-Level Format")],
        "scope": [],
        "refs": [
            {"table": "tbl_book_copies", "fk": "format_detail_id", "dedupe_cols": ["item_id"]},
        ],
        "cleanable": False, "mergeable": False,  # merging would drop per-format copy rows (ISBN, publisher, etc.)
    },
    {
        "label": "Book Top-Level Genres",
        "table": "lkup_book_top_level_genres",
        "pk": "top_level_genre_id", "name_col": "genre_name",
        "sort_col": "sort_order",
        "secondary_cols": [],
        "scope": [
            {"col": "category_scope_id", "label": "Category Scope",
             "src_table": "lkup_top_level_categories", "src_pk": "top_level_category_id", "src_name": "category_name"},
        ],
        "refs": [
            {"table": "xref_book_item_genres", "fk": "top_level_genre_id", "dedupe_cols": ["item_id", "sub_genre_id"]},
            {"table": "lkup_book_sub_genres",  "fk": "top_level_genre_id", "dedupe_cols": None},
        ],
        "cleanable": False, "mergeable": False,  # cascades into sub_genres
    },
    {
        "label": "Book Sub-Genres",
        "table": "lkup_book_sub_genres",
        "pk": "sub_genre_id", "name_col": "sub_genre_name",
        "sort_col": "sort_order",
        "secondary_cols": [],
        "scope": [
            {"col": "top_level_genre_id", "label": "Top-Level Genre",
             "src_table": "lkup_book_top_level_genres", "src_pk": "top_level_genre_id", "src_name": "genre_name"},
        ],
        "refs": [
            {"table": "xref_book_item_genres", "fk": "sub_genre_id", "dedupe_cols": ["item_id", "top_level_genre_id"]},
        ],
        "cleanable": False, "mergeable": True,
    },
    {
        "label": "Book Age Levels",
        "table": "lkup_book_age_levels",
        "pk": "age_level_id", "name_col": "age_level_name",
        "sort_col": "sort_order",
        "secondary_cols": [],
        "scope": [],
        "refs": [
            {"table": "tbl_book_details", "fk": "age_level_id", "dedupe_cols": None},
        ],
        "cleanable": False, "mergeable": True,
    },
    {
        "label": "Book Authors",
        "table": "lkup_book_authors",
        "pk": "author_id", "name_col": "author_name",
        "sort_col": "sort_order",
        "secondary_cols": [("author_sort", "Sort As")],
        "scope": [],
        "refs": [
            {"table": "xref_book_item_authors", "fk": "author_id", "dedupe_cols": ["item_id"]},
        ],
        "cleanable": True, "mergeable": True,
    },
    {
        "label": "Book Tags",
        "table": "lkup_book_tags",
        "pk": "tag_id", "name_col": "tag_name",
        "sort_col": "sort_order",
        "secondary_cols": [],
        "scope": [],
        "refs": [
            {"table": "xref_book_item_tags", "fk": "tag_id", "dedupe_cols": ["item_id"]},
        ],
        "cleanable": True, "mergeable": True,
    },
    {
        "label": "Book Series",
        "table": "tbl_book_series",
        "pk": "series_id", "name_col": "series_name",
        "sort_col": None,
        "secondary_cols": [("series_sort", "Sort As")],
        "scope": [],
        "refs": [
            {"table": "xref_book_item_series", "fk": "series_id", "dedupe_cols": ["item_id"]},
        ],
        "cleanable": True, "mergeable": True,
    },
    # ── Graphic Novels ───────────────────────────────────────────────────────
    {
        "label": "GN Publishers", "table": "lkup_graphicnovel_publishers",
        "pk": "publisher_id", "name_col": "publisher_name",
        "sort_col": "sort_order", "secondary_cols": [], "scope": [],
        "refs": [{"table": "tbl_graphicnovel_details", "fk": "publisher_id", "dedupe_cols": None}],
        "cleanable": True, "mergeable": True,
    },
    {
        "label": "GN Format Types", "table": "lkup_graphicnovel_format_types",
        "pk": "format_type_id", "name_col": "format_type_name",
        "sort_col": "sort_order", "secondary_cols": [], "scope": [],
        "refs": [{"table": "tbl_graphicnovel_details", "fk": "format_type_id", "dedupe_cols": None}],
        "cleanable": False, "mergeable": True,
    },
    {
        "label": "GN Eras", "table": "lkup_graphicnovel_eras",
        "pk": "era_id", "name_col": "era_name",
        "sort_col": "sort_order",
        "secondary_cols": [("era_years", "Years")],
        "scope": [],
        "refs": [{"table": "tbl_graphicnovel_details", "fk": "era_id", "dedupe_cols": None}],
        "cleanable": False, "mergeable": True,
    },
    {
        "label": "GN Writers", "table": "lkup_graphicnovel_writers",
        "pk": "writer_id", "name_col": "writer_name",
        "sort_col": None, "secondary_cols": [], "scope": [],
        "refs": [{"table": "xref_graphicnovel_item_writers", "fk": "writer_id", "dedupe_cols": ["item_id"]}],
        "cleanable": True, "mergeable": True,
    },
    {
        "label": "GN Artists", "table": "lkup_graphicnovel_artists",
        "pk": "artist_id", "name_col": "artist_name",
        "sort_col": None, "secondary_cols": [], "scope": [],
        "refs": [{"table": "xref_graphicnovel_item_artists", "fk": "artist_id", "dedupe_cols": ["item_id"]}],
        "cleanable": True, "mergeable": True,
    },
    {
        "label": "GN Tags", "table": "lkup_graphicnovel_tags",
        "pk": "tag_id", "name_col": "tag_name",
        "sort_col": None, "secondary_cols": [], "scope": [],
        "refs": [{"table": "xref_graphicnovel_item_tags", "fk": "tag_id", "dedupe_cols": ["item_id"]}],
        "cleanable": True, "mergeable": True,
    },
    # ── Video Games ──────────────────────────────────────────────────────────
    {
        "label": "Game Platforms", "table": "lkup_game_platforms",
        "pk": "platform_id", "name_col": "platform_name",
        "sort_col": "sort_order", "secondary_cols": [], "scope": [],
        "refs": [{"table": "tbl_game_copies", "fk": "platform_id", "dedupe_cols": None}],
        "cleanable": True, "mergeable": True,
    },
    {
        "label": "Game Developers", "table": "lkup_game_developers",
        "pk": "developer_id", "name_col": "developer_name",
        "sort_col": None, "secondary_cols": [], "scope": [],
        "refs": [{"table": "xref_game_developers", "fk": "developer_id", "dedupe_cols": ["item_id"]}],
        "cleanable": True, "mergeable": True,
    },
    {
        "label": "Game Publishers", "table": "lkup_game_publishers",
        "pk": "publisher_id", "name_col": "publisher_name",
        "sort_col": None, "secondary_cols": [], "scope": [],
        "refs": [{"table": "xref_game_publishers", "fk": "publisher_id", "dedupe_cols": ["item_id"]}],
        "cleanable": True, "mergeable": True,
    },
    {
        "label": "Game Top Genres", "table": "lkup_game_top_genres",
        "pk": "top_genre_id", "name_col": "genre_name",
        "sort_col": "sort_order", "secondary_cols": [], "scope": [],
        "refs": [
            {"table": "xref_game_genres",     "fk": "top_genre_id", "dedupe_cols": ["item_id", "sub_genre_id"]},
            {"table": "lkup_game_sub_genres", "fk": "top_genre_id", "dedupe_cols": None},
        ],
        "cleanable": False, "mergeable": False,  # cascades into sub_genres
    },
    {
        "label": "Game Sub-Genres", "table": "lkup_game_sub_genres",
        "pk": "sub_genre_id", "name_col": "sub_genre_name",
        "sort_col": "sort_order", "secondary_cols": [],
        "scope": [
            {"col": "top_genre_id", "label": "Top Genre",
             "src_table": "lkup_game_top_genres", "src_pk": "top_genre_id", "src_name": "genre_name"},
        ],
        "refs": [
            {"table": "xref_game_genres", "fk": "sub_genre_id", "dedupe_cols": ["item_id", "top_genre_id"]},
        ],
        "cleanable": False, "mergeable": True,
    },
    # ── Music ────────────────────────────────────────────────────────────────
    {
        "label": "Music Format Types", "table": "lkup_music_format_types",
        "pk": "format_type_id", "name_col": "format_name",
        "sort_col": "sort_order", "secondary_cols": [], "scope": [],
        "refs": [{"table": "tbl_music_editions", "fk": "format_type_id", "dedupe_cols": None}],
        "cleanable": False, "mergeable": True,
    },
    {
        "label": "Music Artists", "table": "lkup_music_artists",
        "pk": "artist_id", "name_col": "artist_name",
        "sort_col": None,
        "secondary_cols": [("artist_sort", "Sort As")],
        "scope": [],
        "refs": [{"table": "xref_music_release_artists", "fk": "artist_id", "dedupe_cols": ["item_id"]}],
        "cleanable": True, "mergeable": True,
    },
    {
        "label": "Music Top Genres", "table": "lkup_music_top_genres",
        "pk": "top_genre_id", "name_col": "genre_name",
        "sort_col": "sort_order", "secondary_cols": [], "scope": [],
        "refs": [
            {"table": "xref_music_release_genres", "fk": "top_genre_id", "dedupe_cols": ["item_id", "sub_genre_id"]},
            {"table": "lkup_music_sub_genres",     "fk": "top_genre_id", "dedupe_cols": None},
        ],
        "cleanable": False, "mergeable": False,  # cascades
    },
    {
        "label": "Music Sub-Genres", "table": "lkup_music_sub_genres",
        "pk": "sub_genre_id", "name_col": "sub_genre_name",
        "sort_col": "sort_order", "secondary_cols": [],
        "scope": [
            {"col": "top_genre_id", "label": "Top Genre",
             "src_table": "lkup_music_top_genres", "src_pk": "top_genre_id", "src_name": "genre_name"},
        ],
        "refs": [
            {"table": "xref_music_release_genres", "fk": "sub_genre_id", "dedupe_cols": ["item_id", "top_genre_id"]},
        ],
        "cleanable": False, "mergeable": True,
    },
    # ── Video ────────────────────────────────────────────────────────────────
    {
        "label": "Video Format Types", "table": "lkup_video_format_types",
        "pk": "format_type_id", "name_col": "format_name",
        "sort_col": "sort_order", "secondary_cols": [], "scope": [],
        "refs": [
            {"table": "tbl_video_copies",  "fk": "format_type_id", "dedupe_cols": None},
            {"table": "tbl_video_seasons", "fk": "format_type_id", "dedupe_cols": None},
        ],
        "cleanable": False, "mergeable": True,
    },
    {
        "label": "Video Directors", "table": "lkup_video_directors",
        "pk": "director_id", "name_col": "director_name",
        "sort_col": None, "secondary_cols": [], "scope": [],
        "refs": [{"table": "xref_video_directors", "fk": "director_id", "dedupe_cols": ["item_id"]}],
        "cleanable": True, "mergeable": True,
    },
    {
        "label": "Video Cast", "table": "lkup_video_cast",
        "pk": "cast_id", "name_col": "cast_name",
        "sort_col": None, "secondary_cols": [], "scope": [],
        "refs": [{"table": "xref_video_cast", "fk": "cast_id", "dedupe_cols": ["item_id"]}],
        "cleanable": True, "mergeable": True,
    },
    {
        "label": "Video Top Genres", "table": "lkup_video_top_genres",
        "pk": "top_genre_id", "name_col": "genre_name",
        "sort_col": "sort_order", "secondary_cols": [], "scope": [],
        "refs": [
            {"table": "xref_video_genres",     "fk": "top_genre_id", "dedupe_cols": ["item_id", "sub_genre_id"]},
            {"table": "lkup_video_sub_genres", "fk": "top_genre_id", "dedupe_cols": None},
        ],
        "cleanable": False, "mergeable": False,  # cascades
    },
    {
        "label": "Video Sub-Genres", "table": "lkup_video_sub_genres",
        "pk": "sub_genre_id", "name_col": "sub_genre_name",
        "sort_col": "sort_order", "secondary_cols": [],
        "scope": [
            {"col": "top_genre_id", "label": "Top Genre",
             "src_table": "lkup_video_top_genres", "src_pk": "top_genre_id", "src_name": "genre_name"},
        ],
        "refs": [
            {"table": "xref_video_genres", "fk": "sub_genre_id", "dedupe_cols": ["item_id", "top_genre_id"]},
        ],
        "cleanable": False, "mergeable": True,
    },
    # ── Board Games ──────────────────────────────────────────────────────────
    {
        "label": "Board Game Publishers", "table": "lkup_boardgame_publishers",
        "pk": "publisher_id", "name_col": "publisher_name",
        "sort_col": None, "secondary_cols": [], "scope": [],
        "refs": [{"table": "tbl_boardgame_details", "fk": "publisher_id", "dedupe_cols": None}],
        "cleanable": True, "mergeable": True,
    },
    {
        "label": "Board Game Designers", "table": "lkup_boardgame_designers",
        "pk": "designer_id", "name_col": "designer_name",
        "sort_col": None, "secondary_cols": [], "scope": [],
        "refs": [{"table": "xref_boardgame_designers", "fk": "designer_id", "dedupe_cols": ["item_id"]}],
        "cleanable": True, "mergeable": True,
    },
    # ── TTRPG ────────────────────────────────────────────────────────────────
    {
        "label": "TTRPG System Editions", "table": "lkup_ttrpg_system_editions",
        "pk": "edition_id", "name_col": "edition_name",
        "sort_col": "sort_order", "secondary_cols": [],
        "scope": [
            {"col": "system_category_id", "label": "System",
             "src_table": "lkup_top_level_categories", "src_pk": "top_level_category_id", "src_name": "category_name"},
        ],
        "refs": [{"table": "tbl_ttrpg_details", "fk": "system_edition_id", "dedupe_cols": None}],
        "cleanable": True, "mergeable": True,
    },
    {
        "label": "TTRPG Lines", "table": "lkup_ttrpg_lines",
        "pk": "line_id", "name_col": "line_name",
        "sort_col": "sort_order", "secondary_cols": [],
        "scope": [
            {"col": "system_category_id", "label": "System",
             "src_table": "lkup_top_level_categories", "src_pk": "top_level_category_id", "src_name": "category_name"},
        ],
        "refs": [{"table": "tbl_ttrpg_details", "fk": "line_id", "dedupe_cols": None}],
        "cleanable": True, "mergeable": True,
    },
    {
        "label": "TTRPG Book Types", "table": "lkup_ttrpg_book_types",
        "pk": "book_type_id", "name_col": "book_type_name",
        "sort_col": "sort_order", "secondary_cols": [], "scope": [],
        "refs": [{"table": "tbl_ttrpg_details", "fk": "book_type_id", "dedupe_cols": None}],
        "cleanable": False, "mergeable": True,
    },
    {
        "label": "TTRPG Format Types", "table": "lkup_ttrpg_format_types",
        "pk": "format_type_id", "name_col": "format_type_name",
        "sort_col": "sort_order", "secondary_cols": [], "scope": [],
        "refs": [{"table": "tbl_ttrpg_copies", "fk": "format_type_id", "dedupe_cols": None}],
        "cleanable": False, "mergeable": True,
    },
    {
        "label": "TTRPG Publishers", "table": "lkup_ttrpg_publishers",
        "pk": "publisher_id", "name_col": "publisher_name",
        "sort_col": "sort_order", "secondary_cols": [], "scope": [],
        "refs": [{"table": "tbl_ttrpg_details", "fk": "publisher_id", "dedupe_cols": None}],
        "cleanable": True, "mergeable": True,
    },
    {
        "label": "TTRPG Authors", "table": "lkup_ttrpg_authors",
        "pk": "author_id", "name_col": "author_name",
        "sort_col": "sort_order", "secondary_cols": [], "scope": [],
        "refs": [{"table": "xref_ttrpg_book_authors", "fk": "author_id", "dedupe_cols": ["item_id"]}],
        "cleanable": True, "mergeable": True,
    },
]

_LOOKUP_REGISTRY: Dict[str, Dict[str, Any]] = {e["table"]: e for e in _LOOKUP_REGISTRY_LIST}


def cleanable_lookups_for_scan():
    """Legacy tuple shape consumed by admin.py's scan/deactivate endpoints:
    (label, table, pk, name_col, [(ref_table, ref_fk), ...])."""
    return [
        (e["label"], e["table"], e["pk"], e["name_col"],
         [(r["table"], r["fk"]) for r in e["refs"]])
        for e in _LOOKUP_REGISTRY_LIST if e["cleanable"]
    ]


# ---------- Endpoints ----------


@router.get("/admin/lookups/registry")
def get_lookup_registry():
    """Metadata about every managed lookup table (for the UI table picker)."""
    return [
        {
            "table": e["table"],
            "label": e["label"],
            "pk": e["pk"],
            "name_col": e["name_col"],
            "sort_col": e["sort_col"],
            "secondary_cols": [{"col": c, "label": lbl} for c, lbl in e["secondary_cols"]],
            "scope": [{"col": s["col"], "label": s["label"]} for s in e["scope"]],
            "mergeable": e["mergeable"],
            "cleanable": e["cleanable"],
        }
        for e in _LOOKUP_REGISTRY_LIST
    ]


def _load_scope_options(db, entry) -> List[Dict[str, Any]]:
    """Return available scope options (IDs + names) for each scope column, so the
    UI can group/filter rows and offer pickers for merge targets."""
    out = []
    for s in entry["scope"]:
        rows = db.execute(text(
            f"SELECT {s['src_pk']} AS id, {s['src_name']} AS name "
            f"FROM {s['src_table']} "
            f"ORDER BY {s['src_name']}"
        )).fetchall()
        out.append({
            "col": s["col"],
            "label": s["label"],
            "options": [{"id": r[0], "name": r[1]} for r in rows],
        })
    return out


@router.get("/admin/lookups/{table}")
def list_lookup_rows(table: str, db=Depends(get_db)):
    """Return every row (active and inactive) for a managed lookup, with usage counts."""
    entry = _LOOKUP_REGISTRY.get(table)
    if entry is None:
        raise HTTPException(status_code=404, detail=f"Unknown lookup table: {table}")

    # Column order must match the positional access below.
    select_parts: List[str] = [
        f"l.{entry['pk']}",            # 0 id
        f"l.{entry['name_col']}",      # 1 name
        "l.is_active",                 # 2 is_active
    ]
    if entry["sort_col"]:
        select_parts.append(f"l.{entry['sort_col']}")          # sort_order
    for col, _ in entry["secondary_cols"]:
        select_parts.append(f"l.{col}")                        # each secondary
    scope_value_slots: List[str] = []  # tuples: (col, has_name)
    joins: List[str] = []
    for i, s in enumerate(entry["scope"]):
        alias = f"sc{i}"
        select_parts.append(f"l.{s['col']}")                   # scope id
        select_parts.append(f"{alias}.{s['src_name']}")        # scope name
        joins.append(
            f"LEFT JOIN {s['src_table']} {alias} "
            f"ON {alias}.{s['src_pk']} = l.{s['col']}"
        )
        scope_value_slots.append(s["col"])

    # Usage count — sum across all ref tables via correlated subqueries.
    if entry["refs"]:
        usage_expr = " + ".join(
            f"(SELECT COUNT(*) FROM {r['table']} WHERE {r['fk']} = l.{entry['pk']})"
            for r in entry["refs"]
        )
    else:
        usage_expr = "0"
    select_parts.append(f"({usage_expr})")                      # usage_count (last)

    order_by = (
        f"l.{entry['sort_col']}, l.{entry['name_col']}"
        if entry["sort_col"] else f"l.{entry['name_col']}"
    )
    sql = (
        f"SELECT {', '.join(select_parts)} FROM {table} l "
        f"{' '.join(joins)} ORDER BY {order_by}"
    )

    rows = db.execute(text(sql)).fetchall()

    has_sort = bool(entry["sort_col"])
    sec_cols = [c for c, _ in entry["secondary_cols"]]
    n_scope = len(entry["scope"])

    results: List[Dict[str, Any]] = []
    for r in rows:
        idx = 0
        row_id = r[idx]; idx += 1
        name = r[idx]; idx += 1
        is_active = bool(r[idx]); idx += 1
        sort_order = r[idx] if has_sort else None
        if has_sort:
            idx += 1
        secondary = {c: r[idx + i] for i, c in enumerate(sec_cols)}
        idx += len(sec_cols)
        scope_values: Dict[str, Any] = {}
        for j, s in enumerate(entry["scope"]):
            scope_values[s["col"]] = {
                "id": r[idx],
                "name": r[idx + 1],
            }
            idx += 2
        usage_count = r[idx]
        results.append({
            "id": row_id,
            "name": name,
            "is_active": is_active,
            "sort_order": sort_order,
            "secondary": secondary,
            "scope": scope_values,
            "usage_count": usage_count,
        })

    return {
        "table": table,
        "label": entry["label"],
        "pk": entry["pk"],
        "name_col": entry["name_col"],
        "sort_col": entry["sort_col"],
        "secondary_cols": [{"col": c, "label": lbl} for c, lbl in entry["secondary_cols"]],
        "scope": [{"col": s["col"], "label": s["label"]} for s in entry["scope"]],
        "scope_options": _load_scope_options(db, entry),
        "mergeable": entry["mergeable"],
        "rows": results,
    }


class LookupPatchRequest(BaseModel):
    name: Optional[str] = None
    sort_order: Optional[int] = None
    is_active: Optional[bool] = None
    secondary: Optional[Dict[str, Optional[str]]] = None


@router.patch("/admin/lookups/{table}/{row_id}")
def patch_lookup_row(table: str, row_id: int, req: LookupPatchRequest, db=Depends(get_db)):
    entry = _LOOKUP_REGISTRY.get(table)
    if entry is None:
        raise HTTPException(status_code=404, detail=f"Unknown lookup table: {table}")

    existing = db.execute(text(
        f"SELECT {entry['pk']} FROM {table} WHERE {entry['pk']} = :id"
    ), {"id": row_id}).fetchone()
    if not existing:
        raise HTTPException(status_code=404, detail=f"Row {row_id} not found in {entry['label']}.")

    sets: List[str] = []
    params: Dict[str, Any] = {"id": row_id}

    if req.name is not None:
        name = req.name.strip()
        if not name:
            raise HTTPException(status_code=400, detail="Name cannot be empty.")
        sets.append(f"{entry['name_col']} = :name")
        params["name"] = name

    if req.sort_order is not None:
        if not entry["sort_col"]:
            raise HTTPException(status_code=400, detail=f"{entry['label']} does not support sort_order.")
        sets.append(f"{entry['sort_col']} = :sort_order")
        params["sort_order"] = int(req.sort_order)

    if req.is_active is not None:
        sets.append("is_active = :is_active")
        params["is_active"] = 1 if req.is_active else 0

    if req.secondary:
        valid_secondary = {c for c, _ in entry["secondary_cols"]}
        for col, val in req.secondary.items():
            if col not in valid_secondary:
                raise HTTPException(status_code=400, detail=f"Unknown field: {col}")
            sets.append(f"{col} = :sec_{col}")
            params[f"sec_{col}"] = val

    if not sets:
        return {"ok": True, "changed": False}

    try:
        db.execute(text(f"UPDATE {table} SET {', '.join(sets)} WHERE {entry['pk']} = :id"), params)
        db.commit()
    except Exception as ex:
        db.rollback()
        msg = str(ex)
        if "UNIQUE" in msg.upper() or "constraint" in msg.lower():
            raise HTTPException(
                status_code=409,
                detail="Another row in the same scope already uses this value. Consider merging instead.",
            )
        raise HTTPException(status_code=500, detail=f"Update failed: {msg}")

    return {"ok": True, "changed": True}


class LookupMergeRequest(BaseModel):
    source_id: int
    target_id: int


@router.post("/admin/lookups/{table}/merge")
def merge_lookup_rows(table: str, req: LookupMergeRequest, db=Depends(get_db)):
    """Rewrite every FK reference from source_id to target_id (deduping rows
    that would violate unique constraints), then soft-delete source_id."""
    entry = _LOOKUP_REGISTRY.get(table)
    if entry is None:
        raise HTTPException(status_code=404, detail=f"Unknown lookup table: {table}")
    if not entry["mergeable"]:
        raise HTTPException(status_code=400, detail=f"Merging is not supported for {entry['label']}.")
    if req.source_id == req.target_id:
        raise HTTPException(status_code=400, detail="Source and target must differ.")

    pk = entry["pk"]
    scope_cols = [s["col"] for s in entry["scope"]]

    # Load both rows in one query
    col_list = [pk, *scope_cols]
    rows = db.execute(text(
        f"SELECT {', '.join(col_list)} FROM {table} WHERE {pk} IN (:a, :b)"
    ), {"a": req.source_id, "b": req.target_id}).fetchall()
    by_id = {r[0]: r for r in rows}

    if req.source_id not in by_id:
        raise HTTPException(status_code=404, detail=f"Source id {req.source_id} not found.")
    if req.target_id not in by_id:
        raise HTTPException(status_code=404, detail=f"Target id {req.target_id} not found.")

    if scope_cols:
        src_scope = tuple(by_id[req.source_id][1 + i] for i in range(len(scope_cols)))
        tgt_scope = tuple(by_id[req.target_id][1 + i] for i in range(len(scope_cols)))
        if src_scope != tgt_scope:
            raise HTTPException(
                status_code=400,
                detail="Cannot merge across different scope values.",
            )

    try:
        affected = 0
        deduped = 0
        for r in entry["refs"]:
            ref_table = r["table"]
            fk = r["fk"]
            dedupe_cols = r["dedupe_cols"]

            if dedupe_cols:
                # Delete source-side rows that would collide with existing target-side rows.
                match_clause = " AND ".join(
                    f"t2.{c} IS {ref_table}.{c}" for c in dedupe_cols
                )
                dedupe_sql = (
                    f"DELETE FROM {ref_table} "
                    f"WHERE {fk} = :src "
                    f"AND EXISTS ("
                    f"  SELECT 1 FROM {ref_table} t2 "
                    f"  WHERE t2.{fk} = :tgt AND {match_clause}"
                    f")"
                )
                res = db.execute(text(dedupe_sql), {"src": req.source_id, "tgt": req.target_id})
                deduped += (res.rowcount or 0)

            res = db.execute(text(
                f"UPDATE {ref_table} SET {fk} = :tgt WHERE {fk} = :src"
            ), {"src": req.source_id, "tgt": req.target_id})
            affected += (res.rowcount or 0)

        db.execute(text(
            f"UPDATE {table} SET is_active = 0 WHERE {pk} = :src"
        ), {"src": req.source_id})
        db.commit()
    except Exception as ex:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Merge failed: {ex}")

    return {
        "ok": True,
        "source_id": req.source_id,
        "target_id": req.target_id,
        "rewritten": affected,
        "deduped": deduped,
    }


@router.delete("/admin/lookups/{table}/{row_id}")
def hard_delete_lookup_row(table: str, row_id: int, db=Depends(get_db)):
    """Hard-delete a lookup row. Only permitted when the row is already
    soft-deleted (is_active = 0) AND has zero remaining references."""
    entry = _LOOKUP_REGISTRY.get(table)
    if entry is None:
        raise HTTPException(status_code=404, detail=f"Unknown lookup table: {table}")

    row = db.execute(text(
        f"SELECT is_active FROM {table} WHERE {entry['pk']} = :id"
    ), {"id": row_id}).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail=f"Row {row_id} not found.")
    if row[0]:
        raise HTTPException(
            status_code=409,
            detail="Row must be deactivated before hard-delete.",
        )

    for r in entry["refs"]:
        n = db.execute(text(
            f"SELECT COUNT(*) FROM {r['table']} WHERE {r['fk']} = :id"
        ), {"id": row_id}).fetchone()[0]
        if n > 0:
            raise HTTPException(
                status_code=409,
                detail=f"Row still referenced by {r['table']} ({n} rows).",
            )

    db.execute(text(f"DELETE FROM {table} WHERE {entry['pk']} = :id"), {"id": row_id})
    db.commit()
    return {"ok": True}
