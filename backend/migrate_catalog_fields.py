"""
Migration: Add Catalog architecture fields for guest/mobile sync.

Steps:
  1. Back up the database
  2. ALTER tbl_items: ADD catalog_item_id TEXT, catalog_version INTEGER
  3. Create partial UNIQUE INDEX on catalog_item_id WHERE NOT NULL
  4. INSERT Catalog row into lkup_ownership_statuses (photocards-only scope)
  5. INSERT xref_ownership_status_modules row: Catalog x photocards
  6. Backfill all photocards:
       catalog_item_id = '{group_code}_{item_id:06d}', catalog_version = 1
  7. Verify counts

Idempotent: safe to re-run.

Usage:
  python backend/migrate_catalog_fields.py
"""

import shutil
import sqlite3
import sys
from datetime import datetime
from pathlib import Path


SCRIPT_DIR = Path(__file__).parent
PROJECT_ROOT = SCRIPT_DIR.parent
DB_PATH = PROJECT_ROOT / "data" / "collectcore.db"

PHOTOCARDS_CODE = "photocards"
CATALOG_STATUS_CODE = "catalog"
CATALOG_STATUS_NAME = "Catalog"


def backup_db(db_path: Path) -> Path:
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup = db_path.with_name(f"collectcore_pre_catalog_migration_{ts}.db")
    shutil.copy2(db_path, backup)
    print(f"[backup] {backup}")
    return backup


def column_exists(conn: sqlite3.Connection, table: str, column: str) -> bool:
    rows = conn.execute(f"PRAGMA table_info({table})").fetchall()
    return any(r[1] == column for r in rows)


def add_catalog_columns(conn: sqlite3.Connection) -> None:
    if column_exists(conn, "tbl_items", "catalog_item_id"):
        print("[alter] catalog_item_id already exists, skipping")
    else:
        conn.execute("ALTER TABLE tbl_items ADD COLUMN catalog_item_id TEXT")
        print("[alter] added tbl_items.catalog_item_id")

    if column_exists(conn, "tbl_items", "catalog_version"):
        print("[alter] catalog_version already exists, skipping")
    else:
        conn.execute("ALTER TABLE tbl_items ADD COLUMN catalog_version INTEGER")
        print("[alter] added tbl_items.catalog_version")

    conn.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_tbl_items_catalog_item_id "
        "ON tbl_items(catalog_item_id) WHERE catalog_item_id IS NOT NULL"
    )
    print("[index] idx_tbl_items_catalog_item_id (partial UNIQUE)")
    conn.commit()


def ensure_catalog_status(conn: sqlite3.Connection) -> int:
    row = conn.execute(
        "SELECT ownership_status_id FROM lkup_ownership_statuses WHERE status_code = ?",
        (CATALOG_STATUS_CODE,),
    ).fetchone()
    if row:
        print(f"[status] Catalog already present (id={row[0]})")
        return row[0]

    max_sort = conn.execute(
        "SELECT COALESCE(MAX(sort_order), 0) FROM lkup_ownership_statuses"
    ).fetchone()[0]
    conn.execute(
        "INSERT INTO lkup_ownership_statuses (status_code, status_name, sort_order, is_active) "
        "VALUES (?, ?, ?, 1)",
        (CATALOG_STATUS_CODE, CATALOG_STATUS_NAME, max_sort + 1),
    )
    status_id = conn.execute(
        "SELECT ownership_status_id FROM lkup_ownership_statuses WHERE status_code = ?",
        (CATALOG_STATUS_CODE,),
    ).fetchone()[0]
    conn.commit()
    print(f"[status] inserted Catalog (id={status_id}, sort_order={max_sort + 1})")
    return status_id


def ensure_catalog_xref(conn: sqlite3.Connection, status_id: int) -> None:
    row = conn.execute(
        "SELECT collection_type_id FROM lkup_collection_types WHERE collection_type_code = ?",
        (PHOTOCARDS_CODE,),
    ).fetchone()
    if not row:
        raise RuntimeError(f"collection_type_code '{PHOTOCARDS_CODE}' not found")
    photocards_id = row[0]

    conn.execute(
        "INSERT OR IGNORE INTO xref_ownership_status_modules (ownership_status_id, collection_type_id) "
        "VALUES (?, ?)",
        (status_id, photocards_id),
    )
    conn.commit()
    print(f"[xref] Catalog enabled for photocards (collection_type_id={photocards_id})")


def backfill_catalog_ids(conn: sqlite3.Connection) -> int:
    """
    Derive catalog_item_id from the existing attachment filename, not from item_id.

    Some legacy photocards have attachment filenames whose embedded id does not match
    their current item_id (drift from earlier consolidation migrations). Matching the
    filename keeps catalog images addressable without renaming files on disk.

    For each photocard: parse '{group_code}_{NNNNNN}_[fb].ext' from one of its
    attachments. Fall back to item_id if the item has no attachment yet (unusual).
    """
    import re

    photocards_id = conn.execute(
        "SELECT collection_type_id FROM lkup_collection_types WHERE collection_type_code = ?",
        (PHOTOCARDS_CODE,),
    ).fetchone()[0]

    pat = re.compile(r"([a-z0-9]+)_(\d{6})_[fb]\.", re.IGNORECASE)

    rows = conn.execute(
        """
        SELECT i.item_id, g.group_code, i.catalog_item_id, a.file_path
        FROM tbl_items i
        JOIN tbl_photocard_details d ON d.item_id = i.item_id
        JOIN lkup_photocard_groups g ON g.group_id = d.group_id
        LEFT JOIN tbl_attachments a
               ON a.item_id = i.item_id
              AND a.attachment_type IN ('front', 'back')
        WHERE i.collection_type_id = ?
        ORDER BY i.item_id, a.attachment_type
        """,
        (photocards_id,),
    ).fetchall()

    # Collapse to one row per item: prefer a matched filename, fall back to item_id
    per_item: dict[int, tuple[str, str]] = {}
    for item_id, group_code, existing_cid, file_path in rows:
        if item_id in per_item and per_item[item_id][1] != "fallback":
            continue
        derived = None
        source = "fallback"
        if file_path:
            m = pat.search(file_path)
            if m:
                derived = f"{m.group(1)}_{m.group(2)}"
                source = "filename"
        if derived is None:
            derived = f"{group_code}_{item_id:06d}"
        per_item[item_id] = (derived, source)

    # Detect whether existing catalog_item_ids already match the target; skip shuffle if so.
    existing = dict(
        conn.execute(
            "SELECT item_id, catalog_item_id FROM tbl_items WHERE collection_type_id = ?",
            (photocards_id,),
        ).fetchall()
    )
    needs_change = any(existing.get(iid) != target for iid, (target, _) in per_item.items())
    needs_version = conn.execute(
        "SELECT 1 FROM tbl_items WHERE collection_type_id = ? AND catalog_version IS NULL LIMIT 1",
        (photocards_id,),
    ).fetchone() is not None
    if not needs_change and not needs_version:
        print("[backfill] all photocards already have correct catalog_item_id/version, skipping")
        return 0

    # Clear first to avoid in-flight UNIQUE collisions during the shuffle.
    conn.execute(
        "UPDATE tbl_items SET catalog_item_id = NULL WHERE collection_type_id = ?",
        (photocards_id,),
    )

    changed = 0
    for item_id, (target_cid, _) in per_item.items():
        conn.execute(
            "UPDATE tbl_items SET catalog_item_id = ?, "
            "catalog_version = COALESCE(catalog_version, 1) WHERE item_id = ?",
            (target_cid, item_id),
        )
        changed += 1
    conn.commit()
    print(f"[backfill] wrote catalog_item_id for {changed} photocards (cleared + repopulated)")
    return changed


def verify(conn: sqlite3.Connection) -> None:
    photocards_id = conn.execute(
        "SELECT collection_type_id FROM lkup_collection_types WHERE collection_type_code = ?",
        (PHOTOCARDS_CODE,),
    ).fetchone()[0]

    total = conn.execute(
        "SELECT COUNT(*) FROM tbl_items WHERE collection_type_id = ?",
        (photocards_id,),
    ).fetchone()[0]
    with_id = conn.execute(
        "SELECT COUNT(*) FROM tbl_items "
        "WHERE collection_type_id = ? AND catalog_item_id IS NOT NULL",
        (photocards_id,),
    ).fetchone()[0]
    distinct = conn.execute(
        "SELECT COUNT(DISTINCT catalog_item_id) FROM tbl_items "
        "WHERE collection_type_id = ? AND catalog_item_id IS NOT NULL",
        (photocards_id,),
    ).fetchone()[0]

    print(f"[verify] photocards total={total}, with_catalog_id={with_id}, distinct_ids={distinct}")
    if with_id != total:
        raise RuntimeError(f"Expected all {total} photocards to have catalog_item_id, got {with_id}")
    if distinct != with_id:
        raise RuntimeError(f"catalog_item_id collisions: {with_id} rows vs {distinct} distinct")

    non_pc_with_id = conn.execute(
        "SELECT COUNT(*) FROM tbl_items "
        "WHERE collection_type_id != ? AND catalog_item_id IS NOT NULL",
        (photocards_id,),
    ).fetchone()[0]
    if non_pc_with_id:
        raise RuntimeError(f"{non_pc_with_id} non-photocard rows have catalog_item_id (unexpected)")


def main() -> int:
    if not DB_PATH.exists():
        print(f"[error] DB not found: {DB_PATH}", file=sys.stderr)
        return 1

    backup_db(DB_PATH)
    conn = sqlite3.connect(str(DB_PATH))
    try:
        conn.execute("PRAGMA foreign_keys = ON")
        add_catalog_columns(conn)
        status_id = ensure_catalog_status(conn)
        ensure_catalog_xref(conn, status_id)
        backfill_catalog_ids(conn)
        verify(conn)
    finally:
        conn.close()
    print("[done] catalog migration complete")
    return 0


if __name__ == "__main__":
    sys.exit(main())
