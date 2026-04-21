"""
Migration: Add tbl_photocard_copies and consolidate duplicate photocards.

Steps:
  1. Back up the database
  2. Create tbl_photocard_copies table
  3. Populate one copy row per existing photocard (ownership + notes from tbl_items)
  4. Merge sub-edition records per mapping file:
     - Re-parent sub-edition copy rows to their main item
     - Delete sub-edition attachment rows and image files
     - Delete sub-edition tbl_photocard_details + xref_photocard_members + tbl_items rows
  5. Verify integrity

Usage:
  python backend/migrate_photocard_copies.py
"""

import json
import os
import shutil
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

# ── Paths ────────────────────────────────────────────────────────────────────
SCRIPT_DIR = Path(__file__).parent
PROJECT_ROOT = SCRIPT_DIR.parent
DB_PATH = PROJECT_ROOT / "data" / "collectcore.db"
MAPPING_PATH = PROJECT_ROOT / "docs" / "photocard-duplicate-mapping-2026-04-21.json"
IMAGES_DIR = PROJECT_ROOT / "images" / "library"

# IDs to skip (already deleted from DB)
DELETED_IDS = {10425}


def backup_db(db_path: Path) -> Path:
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup = db_path.with_name(f"collectcore_pre_copies_migration_{ts}.db")
    shutil.copy2(db_path, backup)
    print(f"[backup] {backup}")
    return backup


def create_table(conn: sqlite3.Connection):
    conn.execute("""
        CREATE TABLE IF NOT EXISTS tbl_photocard_copies (
            copy_id             INTEGER PRIMARY KEY AUTOINCREMENT,
            item_id             INTEGER NOT NULL,
            ownership_status_id INTEGER NOT NULL,
            notes               TEXT,
            created_at          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (item_id) REFERENCES tbl_photocard_details(item_id) ON DELETE CASCADE,
            FOREIGN KEY (ownership_status_id) REFERENCES lkup_ownership_statuses(ownership_status_id)
        )
    """)
    conn.commit()
    print("[create] tbl_photocard_copies created")


def populate_copies(conn: sqlite3.Connection) -> int:
    """Create one copy row per existing photocard, pulling ownership + notes from tbl_items."""
    cur = conn.execute("""
        INSERT INTO tbl_photocard_copies (item_id, ownership_status_id, notes, created_at)
        SELECT i.item_id, i.ownership_status_id, i.notes, i.created_at
        FROM tbl_items i
        JOIN tbl_photocard_details pd ON i.item_id = pd.item_id
        WHERE i.collection_type_id = 1
    """)
    conn.commit()
    print(f"[populate] {cur.rowcount} copy rows created")
    return cur.rowcount


def load_mapping(path: Path) -> list:
    with open(path) as f:
        data = json.load(f)
    # Filter to reviewed entries that have sub-editions to merge
    merges = []
    for entry in data:
        if entry.get("status") != "reviewed":
            continue
        subs = entry.get("sub_edition_item_ids", [])
        subs = [s for s in subs if s not in DELETED_IDS]
        if not subs or not entry.get("main_item_id"):
            continue
        merges.append({
            "main_item_id": entry["main_item_id"],
            "sub_item_ids": subs,
            "label": f"{entry['source_origin']} / {entry['version']} / {entry['members']}",
        })
    return merges


def delete_image_files(conn: sqlite3.Connection, item_ids: list) -> int:
    """Delete image files for the given item IDs. Returns count of files deleted."""
    if not item_ids:
        return 0
    placeholders = ",".join("?" * len(item_ids))
    rows = conn.execute(
        f"SELECT file_path FROM tbl_attachments WHERE item_id IN ({placeholders})",
        item_ids,
    ).fetchall()

    deleted = 0
    for (file_path,) in rows:
        full_path = PROJECT_ROOT / file_path
        if full_path.exists():
            full_path.unlink()
            deleted += 1
    return deleted


def merge_sub_editions(conn: sqlite3.Connection, merges: list):
    """Re-parent sub-edition copies to main item, then delete sub-edition records."""
    total_subs = 0
    total_files_deleted = 0

    for m in merges:
        main_id = m["main_item_id"]
        sub_ids = m["sub_item_ids"]
        total_subs += len(sub_ids)
        placeholders = ",".join("?" * len(sub_ids))

        # 1. Re-parent copy rows: update item_id from sub -> main
        conn.execute(
            f"UPDATE tbl_photocard_copies SET item_id = ? WHERE item_id IN ({placeholders})",
            [main_id] + sub_ids,
        )

        # 2. Delete image files
        files_deleted = delete_image_files(conn, sub_ids)
        total_files_deleted += files_deleted

        # 3. Delete attachment rows
        conn.execute(
            f"DELETE FROM tbl_attachments WHERE item_id IN ({placeholders})",
            sub_ids,
        )

        # 4. Delete xref_photocard_members rows
        conn.execute(
            f"DELETE FROM xref_photocard_members WHERE item_id IN ({placeholders})",
            sub_ids,
        )

        # 5. Delete tbl_photocard_details rows
        conn.execute(
            f"DELETE FROM tbl_photocard_details WHERE item_id IN ({placeholders})",
            sub_ids,
        )

        # 6. Delete tbl_items rows
        conn.execute(
            f"DELETE FROM tbl_items WHERE item_id IN ({placeholders})",
            sub_ids,
        )

    conn.commit()
    print(f"[merge] {total_subs} sub-edition records merged across {len(merges)} groups")
    print(f"[merge] {total_files_deleted} image files deleted")


def verify(conn: sqlite3.Connection, original_count: int, expected_subs: int):
    """Run integrity checks after migration."""
    # Count remaining photocards
    (remaining,) = conn.execute(
        "SELECT COUNT(*) FROM tbl_items WHERE collection_type_id = 1"
    ).fetchone()
    print(f"\n[verify] Photocards before: {original_count}")
    print(f"[verify] Sub-editions removed: {expected_subs}")
    print(f"[verify] Photocards after: {remaining}")
    print(f"[verify] Expected: {original_count - expected_subs}")
    assert remaining == original_count - expected_subs, "MISMATCH in photocard count!"

    # Count copies
    (copy_count,) = conn.execute(
        "SELECT COUNT(*) FROM tbl_photocard_copies"
    ).fetchone()
    print(f"[verify] Total copy rows: {copy_count}")

    # Every photocard should have at least one copy
    (no_copies,) = conn.execute("""
        SELECT COUNT(*) FROM tbl_photocard_details pd
        WHERE NOT EXISTS (
            SELECT 1 FROM tbl_photocard_copies pc WHERE pc.item_id = pd.item_id
        )
    """).fetchone()
    assert no_copies == 0, f"{no_copies} photocards have no copy rows!"
    print(f"[verify] Photocards without copies: {no_copies} (OK)")

    # No orphan copies (copy pointing to non-existent photocard)
    (orphans,) = conn.execute("""
        SELECT COUNT(*) FROM tbl_photocard_copies pc
        WHERE NOT EXISTS (
            SELECT 1 FROM tbl_photocard_details pd WHERE pd.item_id = pc.item_id
        )
    """).fetchone()
    assert orphans == 0, f"{orphans} orphan copy rows!"
    print(f"[verify] Orphan copy rows: {orphans} (OK)")

    # No leftover attachments for deleted items
    (leftover_att,) = conn.execute("""
        SELECT COUNT(*) FROM tbl_attachments a
        WHERE NOT EXISTS (
            SELECT 1 FROM tbl_items i WHERE i.item_id = a.item_id
        )
    """).fetchone()
    assert leftover_att == 0, f"{leftover_att} orphan attachment rows!"
    print(f"[verify] Orphan attachment rows: {leftover_att} (OK)")

    # Multi-copy items (sanity check)
    multi = conn.execute("""
        SELECT pc.item_id, COUNT(*) as cnt
        FROM tbl_photocard_copies pc
        GROUP BY pc.item_id
        HAVING cnt > 1
        ORDER BY cnt DESC
        LIMIT 10
    """).fetchall()
    print(f"[verify] Items with multiple copies: {len(multi)} (showing top 10)")
    for item_id, cnt in multi:
        print(f"         item_id={item_id}: {cnt} copies")

    print("\n[verify] All checks passed!")


def main():
    if not DB_PATH.exists():
        print(f"Database not found: {DB_PATH}")
        sys.exit(1)
    if not MAPPING_PATH.exists():
        print(f"Mapping file not found: {MAPPING_PATH}")
        sys.exit(1)

    # Get original count before anything
    conn = sqlite3.connect(str(DB_PATH))
    conn.execute("PRAGMA foreign_keys = ON")
    (original_count,) = conn.execute(
        "SELECT COUNT(*) FROM tbl_items WHERE collection_type_id = 1"
    ).fetchone()
    conn.close()

    # Step 1: Backup
    backup_db(DB_PATH)

    # Reconnect
    conn = sqlite3.connect(str(DB_PATH))
    conn.execute("PRAGMA foreign_keys = ON")

    try:
        # Step 2: Create table
        create_table(conn)

        # Step 3: Populate copies
        populate_copies(conn)

        # Step 4: Merge sub-editions
        merges = load_mapping(MAPPING_PATH)
        total_subs = sum(len(m["sub_item_ids"]) for m in merges)
        print(f"[merge] {len(merges)} groups with {total_subs} sub-editions to merge")
        merge_sub_editions(conn, merges)

        # Step 5: Verify
        verify(conn, original_count, total_subs)

        conn.close()
        print("\nMigration complete!")

    except Exception as e:
        conn.close()
        print(f"\nMigration FAILED: {e}")
        print("The database backup can be used to restore.")
        sys.exit(1)


if __name__ == "__main__":
    main()
