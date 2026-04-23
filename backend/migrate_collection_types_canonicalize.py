"""
Canonicalize lkup_collection_types.

Historical state: the photocards and books rows accumulated duplicates.
  ID 1  code='photocard'    (legacy — referenced by 5949 items)
  ID 2  code='book'         (legacy — referenced by 4724 items)
  ID 61 code='photocards'   (orphan — 0 references)
  ID 62 code='books'        (orphan — 0 references)

plus orphan rows in lkup_top_level_categories (IDs 8-11) scoped to the orphan
collection types.

Canonical state: rows 1 and 2 are renamed to the plural codes used by
schema.sql and the frontend; orphan rows are deleted. tbl_items keeps its
existing collection_type_id values — no data remapping needed.

Idempotent: re-running is a no-op once canonical.
"""

import sqlite3
import sys
from pathlib import Path


def canonicalize(db_path: Path) -> None:
    conn = sqlite3.connect(str(db_path))
    try:
        cur = conn.cursor()

        # Safety: verify the orphan rows really are orphans before deleting.
        orphan_ct_ids = (61, 62)
        for ct_id in orphan_ct_ids:
            (n_items,) = cur.execute(
                "SELECT COUNT(*) FROM tbl_items WHERE collection_type_id = ?",
                (ct_id,),
            ).fetchone()
            if n_items > 0:
                raise RuntimeError(
                    f"Refusing to delete collection_type_id={ct_id}: "
                    f"{n_items} tbl_items rows still reference it."
                )

        orphan_tlc_ids = (8, 9, 10, 11)
        for tlc_id in orphan_tlc_ids:
            (n_items,) = cur.execute(
                "SELECT COUNT(*) FROM tbl_items WHERE top_level_category_id = ?",
                (tlc_id,),
            ).fetchone()
            if n_items > 0:
                raise RuntimeError(
                    f"Refusing to delete top_level_category_id={tlc_id}: "
                    f"{n_items} tbl_items rows still reference it."
                )
            (n_sources,) = cur.execute(
                "SELECT COUNT(*) FROM lkup_photocard_source_origins "
                "WHERE top_level_category_id = ?",
                (tlc_id,),
            ).fetchone()
            if n_sources > 0:
                raise RuntimeError(
                    f"Refusing to delete top_level_category_id={tlc_id}: "
                    f"{n_sources} lkup_photocard_source_origins rows reference it."
                )

        # Rename legacy codes to plural.  Guard against a re-run by only
        # updating rows whose code is still singular.
        renames = [
            (1, "photocard", "photocards", "Photocards"),
            (2, "book",      "books",      "Books"),
        ]
        for ct_id, old_code, new_code, new_name in renames:
            row = cur.execute(
                "SELECT collection_type_code FROM lkup_collection_types "
                "WHERE collection_type_id = ?",
                (ct_id,),
            ).fetchone()
            if row is None:
                print(f"  row {ct_id} missing — skipping rename to '{new_code}'")
                continue
            if row[0] == new_code:
                print(f"  row {ct_id} already '{new_code}' — skipping")
                continue
            if row[0] != old_code:
                raise RuntimeError(
                    f"row {ct_id} has unexpected code '{row[0]}' — aborting"
                )
            # The orphan plural row (if still present) must be deleted first
            # to avoid colliding with the UNIQUE constraint on
            # collection_type_code.
            cur.execute(
                "DELETE FROM lkup_collection_types WHERE collection_type_code = ?",
                (new_code,),
            )
            cur.execute(
                "UPDATE lkup_collection_types "
                "SET collection_type_code = ?, collection_type_name = ? "
                "WHERE collection_type_id = ?",
                (new_code, new_name, ct_id),
            )
            print(f"  row {ct_id}: '{old_code}' -> '{new_code}' (name: '{new_name}')")

        # Delete the orphan top-level categories.  The duplicate ct rows may
        # already be gone (from the collision-avoidance delete above); this is
        # just in case.
        for tlc_id in orphan_tlc_ids:
            cur.execute(
                "DELETE FROM lkup_top_level_categories WHERE top_level_category_id = ?",
                (tlc_id,),
            )
        for ct_id in orphan_ct_ids:
            cur.execute(
                "DELETE FROM lkup_collection_types WHERE collection_type_id = ?",
                (ct_id,),
            )

        conn.commit()

        print("\nfinal state:")
        for r in cur.execute(
            "SELECT collection_type_id, collection_type_code, collection_type_name "
            "FROM lkup_collection_types ORDER BY sort_order"
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
        canonicalize(path)
