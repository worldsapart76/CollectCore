"""
Resequence the non-sequential collection_type_id values from the legacy
live DB (94, 155, 202, 258, 274) to 4-8, matching what schema.sql produces
on a fresh install.

Why: the frontend used to hardcode the large numbers, which meant a fresh
install (Railway, new laptop) would produce IDs 1-8 and the hardcoded
frontend constants would mismatch.  After this migration, the live DB
and a fresh DB agree on IDs 1-8 for the eight modules.

FK enforcement is off in this project's sqlite3 usage, so we can reassign
primary keys directly.  We update FK references first, then the PK,
then the sqlite_sequence row so the AUTOINCREMENT counter restarts
near the end of the sequential range.

Idempotent: re-running is a no-op once already resequenced.
"""

import sqlite3
import sys
from pathlib import Path

REMAP = [
    ("videogames", 94,  4),
    ("music",      155, 5),
    ("video",      202, 6),
    ("boardgames", 258, 7),
    ("ttrpg",      274, 8),
]


def resequence(db_path: Path) -> None:
    conn = sqlite3.connect(str(db_path))
    try:
        cur = conn.cursor()

        # Assume FKs are off (project default).  Belt-and-braces: turn them
        # off explicitly for this session so we can reassign PKs safely.
        cur.execute("PRAGMA foreign_keys = OFF")

        for code, old_id, new_id in REMAP:
            row = cur.execute(
                "SELECT collection_type_id FROM lkup_collection_types "
                "WHERE collection_type_code = ?",
                (code,),
            ).fetchone()
            if row is None:
                print(f"  {code}: row missing — skipping")
                continue
            current_id = row[0]
            if current_id == new_id:
                print(f"  {code}: already at {new_id} — skipping")
                continue
            if current_id != old_id:
                raise RuntimeError(
                    f"{code}: expected id {old_id}, found {current_id}"
                )
            # Verify the target slot is free
            clash = cur.execute(
                "SELECT collection_type_code FROM lkup_collection_types "
                "WHERE collection_type_id = ?",
                (new_id,),
            ).fetchone()
            if clash is not None:
                raise RuntimeError(
                    f"cannot remap {code} to id {new_id}: slot occupied by "
                    f"'{clash[0]}'"
                )

            cur.execute(
                "UPDATE tbl_items SET collection_type_id = ? "
                "WHERE collection_type_id = ?",
                (new_id, old_id),
            )
            cur.execute(
                "UPDATE lkup_top_level_categories SET collection_type_id = ? "
                "WHERE collection_type_id = ?",
                (new_id, old_id),
            )
            cur.execute(
                "UPDATE lkup_collection_types SET collection_type_id = ? "
                "WHERE collection_type_id = ?",
                (new_id, old_id),
            )
            print(f"  {code}: {old_id} -> {new_id}")

        # Reset the AUTOINCREMENT counter so future inserts continue from 9.
        max_id = cur.execute(
            "SELECT COALESCE(MAX(collection_type_id), 0) FROM lkup_collection_types"
        ).fetchone()[0]
        cur.execute(
            "UPDATE sqlite_sequence SET seq = ? WHERE name = 'lkup_collection_types'",
            (max_id,),
        )

        conn.commit()

        print("\nfinal state:")
        for r in cur.execute(
            "SELECT collection_type_id, collection_type_code, collection_type_name "
            "FROM lkup_collection_types ORDER BY collection_type_id"
        ).fetchall():
            print(f"  {r}")
    finally:
        conn.close()


if __name__ == "__main__":
    paths = sys.argv[1:] or [
        str(Path(__file__).resolve().parents[1] / "data" / "collectcore.db"),
    ]
    for p in paths:
        path = Path(p)
        print(f"\n=== {path} ===")
        if not path.exists():
            print("  NOT FOUND — skipping")
            continue
        resequence(path)
