"""
Build the guest mobile seed DB from the live admin DB.

Backend-side equivalent of `tools/prepare_mobile_seed.py`. Used by the
`POST /admin/regenerate-seed` endpoint so the user can refresh the guest
seed from the admin UI without dev-machine sync + git push.

The CLI script remains for offline/automation use; this module is the
production path.

Path strategy:
  - Reads from `db.DB_PATH` (DATA_ROOT / data / collectcore.db) — the live
    admin DB on Railway's volume (or the local dev DB).
  - Writes to DATA_ROOT / data / mobile_seed.db — the same path
    `routers/catalog.py:_find_seed_db()` checks first. Once written,
    `/catalog/seed.db` serves it instead of the baked-into-repo fallback.
  - Schema source: `backend/sql/schema.sql` (always shipped with the deploy).
"""

import logging
import sqlite3
from pathlib import Path

from db import DB_PATH
from file_helpers import DATA_ROOT


logger = logging.getLogger("collectcore.seed_builder")

SCHEMA_SQL = Path(__file__).resolve().parent / "sql" / "schema.sql"
SEED_DB_PATH = DATA_ROOT / "data" / "mobile_seed.db"

PHOTOCARDS_CODE = "photocards"
CATALOG_STATUS_CODE = "catalog"

# Lookup + xref tables copied wholesale (module-neutral). Same set as
# tools/prepare_mobile_seed.py; keep in sync if either changes.
LOOKUP_TABLES = [
    "lkup_collection_types",
    "lkup_ownership_statuses",
    "lkup_consumption_statuses",
    "lkup_top_level_categories",
    "xref_ownership_status_modules",
    "xref_consumption_status_modules",
    # Photocard-scoped lookups
    "lkup_photocard_groups",
    "lkup_photocard_members",
    "lkup_photocard_source_origins",
]


def _copy_table(src: sqlite3.Connection, dst: sqlite3.Connection, table: str) -> int:
    cols = [r[1] for r in src.execute(f"PRAGMA table_info({table})").fetchall()]
    if not cols:
        return 0
    placeholders = ",".join("?" * len(cols))
    col_list = ",".join(cols)
    rows = src.execute(f"SELECT {col_list} FROM {table}").fetchall()
    dst.executemany(
        f"INSERT OR REPLACE INTO {table} ({col_list}) VALUES ({placeholders})",
        rows,
    )
    return len(rows)


def build_seed(seed_db_path: Path = SEED_DB_PATH) -> dict:
    """
    Build the guest seed DB at `seed_db_path` from the live admin DB.
    Returns a summary dict with row counts and file size.

    Idempotent: deletes any existing file at the target path first.
    """
    if not DB_PATH.exists():
        raise FileNotFoundError(f"Admin DB not found at {DB_PATH}")
    if not SCHEMA_SQL.exists():
        raise FileNotFoundError(f"Schema SQL not found at {SCHEMA_SQL}")

    if seed_db_path.exists():
        seed_db_path.unlink()
    seed_db_path.parent.mkdir(parents=True, exist_ok=True)

    dst = sqlite3.connect(str(seed_db_path))
    try:
        dst.executescript(SCHEMA_SQL.read_text(encoding="utf-8"))
        # Schema seeds some lookup data via cross-joins; wipe what we're
        # about to overwrite so admin's exact rows replace it cleanly.
        # Disable FK checks during the wholesale copy.
        dst.execute("PRAGMA foreign_keys = OFF")
        for table in LOOKUP_TABLES:
            dst.execute(f"DELETE FROM {table}")
        dst.commit()

        src = sqlite3.connect(f"file:{DB_PATH.as_posix()}?mode=ro", uri=True)
        try:
            counts = {}
            for table in LOOKUP_TABLES:
                counts[table] = _copy_table(src, dst, table)

            photocards_id = src.execute(
                "SELECT collection_type_id FROM lkup_collection_types WHERE collection_type_code = ?",
                (PHOTOCARDS_CODE,),
            ).fetchone()[0]
            catalog_status_id = src.execute(
                "SELECT ownership_status_id FROM lkup_ownership_statuses WHERE status_code = ?",
                (CATALOG_STATUS_CODE,),
            ).fetchone()[0]

            # tbl_items: photocards with catalog_item_id set
            item_cols = [r[1] for r in src.execute("PRAGMA table_info(tbl_items)").fetchall()]
            item_col_list = ",".join(item_cols)
            item_placeholders = ",".join("?" * len(item_cols))
            item_rows = src.execute(
                f"""
                SELECT {item_col_list} FROM tbl_items
                WHERE collection_type_id = ? AND catalog_item_id IS NOT NULL
                ORDER BY item_id
                """,
                (photocards_id,),
            ).fetchall()
            dst.executemany(
                f"INSERT INTO tbl_items ({item_col_list}) VALUES ({item_placeholders})",
                item_rows,
            )
            counts["tbl_items"] = len(item_rows)

            item_ids = [r[item_cols.index("item_id")] for r in item_rows]
            placeholders = ",".join("?" * len(item_ids)) if item_ids else "NULL"

            if item_ids:
                detail_cols = [r[1] for r in src.execute("PRAGMA table_info(tbl_photocard_details)").fetchall()]
                detail_col_list = ",".join(detail_cols)
                detail_rows = src.execute(
                    f"SELECT {detail_col_list} FROM tbl_photocard_details WHERE item_id IN ({placeholders})",
                    item_ids,
                ).fetchall()
                dst.executemany(
                    f"INSERT INTO tbl_photocard_details ({detail_col_list}) VALUES "
                    f"({','.join('?' * len(detail_cols))})",
                    detail_rows,
                )
                counts["tbl_photocard_details"] = len(detail_rows)

                member_rows = src.execute(
                    f"SELECT item_id, member_id FROM xref_photocard_members WHERE item_id IN ({placeholders})",
                    item_ids,
                ).fetchall()
                dst.executemany(
                    "INSERT OR IGNORE INTO xref_photocard_members (item_id, member_id) VALUES (?, ?)",
                    member_rows,
                )
                counts["xref_photocard_members"] = len(member_rows)

                att_cols = [r[1] for r in src.execute("PRAGMA table_info(tbl_attachments)").fetchall()]
                att_col_list = ",".join(att_cols)
                att_rows = src.execute(
                    f"""
                    SELECT {att_col_list} FROM tbl_attachments
                    WHERE item_id IN ({placeholders})
                      AND attachment_type IN ('front', 'back')
                    """,
                    item_ids,
                ).fetchall()
                dst.executemany(
                    f"INSERT INTO tbl_attachments ({att_col_list}) VALUES "
                    f"({','.join('?' * len(att_cols))})",
                    att_rows,
                )
                counts["tbl_attachments"] = len(att_rows)
                local_count = sum(
                    1 for r in att_rows if r[att_cols.index("storage_type")] == "local"
                )
                if local_count:
                    logger.warning(
                        "%d attachments are still storage_type='local' — run publish_catalog.py first",
                        local_count,
                    )

                # One Catalog copy row per item, mirroring prepare_mobile_seed.py.
                copy_rows = [(iid, catalog_status_id, None) for iid in item_ids]
                dst.executemany(
                    "INSERT INTO tbl_photocard_copies (item_id, ownership_status_id, notes) VALUES (?, ?, ?)",
                    copy_rows,
                )
                counts["tbl_photocard_copies"] = len(copy_rows)

            dst.execute("PRAGMA foreign_keys = ON")
            dst.commit()

            max_version = (
                dst.execute(
                    "SELECT MAX(catalog_version) FROM tbl_items WHERE catalog_item_id IS NOT NULL"
                ).fetchone()[0]
                or 0
            )
            card_count = dst.execute(
                "SELECT COUNT(*) FROM tbl_items WHERE catalog_item_id IS NOT NULL"
            ).fetchone()[0]
        finally:
            src.close()
    finally:
        dst.close()

    size_bytes = seed_db_path.stat().st_size
    logger.info(
        "Built seed at %s: %d cards, max_version=%d, %.2f MB",
        seed_db_path, card_count, max_version, size_bytes / (1024 * 1024),
    )
    return {
        "path": str(seed_db_path),
        "card_count": card_count,
        "max_version": max_version,
        "size_bytes": size_bytes,
        "row_counts": counts,
    }
