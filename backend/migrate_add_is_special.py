"""
Migration: Add is_special column to tbl_photocard_details.

  is_special = 1 → Special (all existing records default to this)
  is_special = 0 → Regular

Run from the backend/ directory:
    python migrate_add_is_special.py

Safe to re-run — uses column existence check before altering.
"""
import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).resolve().parents[1] / "data" / "collectcore.db"


def main():
    if not DB_PATH.exists():
        print(f"ERROR: Database not found at {DB_PATH}")
        return

    print(f"Migrating: {DB_PATH}")
    conn = sqlite3.connect(DB_PATH)

    # Check if column already exists
    cols = [row[1] for row in conn.execute("PRAGMA table_info(tbl_photocard_details)").fetchall()]
    if "is_special" in cols:
        print("  is_special column already exists — nothing to do.")
        conn.close()
        return

    conn.execute("""
        ALTER TABLE tbl_photocard_details
        ADD COLUMN is_special INTEGER NOT NULL DEFAULT 1
    """)
    conn.commit()

    count = conn.execute("SELECT COUNT(*) FROM tbl_photocard_details").fetchone()[0]
    print(f"  Added is_special column (DEFAULT 1 = Special). {count} existing rows set to Special.")

    conn.close()
    print("Migration complete.")


if __name__ == "__main__":
    main()
