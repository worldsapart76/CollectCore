"""
Teardown script for the one-time CSV importer.

Drops `tbl_csv_import_queue` and prints the file paths + lines you need to
remove manually. Safe to run multiple times.

Usage:
    python tools/remove_csv_importer.py            # dry-run (default)
    python tools/remove_csv_importer.py --apply    # actually drop the table
"""
import argparse
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "data" / "collectcore.db"

FILES_TO_DELETE = [
    ROOT / "backend" / "routers" / "csv_import.py",
    ROOT / "frontend" / "src" / "csvImport",     # whole folder
    ROOT / "tools" / "remove_csv_importer.py",   # this script
]

EDIT_INSTRUCTIONS = """\
Manual edits required (the importer is small enough to remove by hand):

1) backend/main.py
   Remove the block:
       if os.environ.get("CSV_IMPORT_ENABLED") == "1":
           from routers import csv_import
           app.include_router(csv_import.router)
           logger.info("CSV importer mounted at /csv-import (CSV_IMPORT_ENABLED=1)")

2) backend/.env
   Remove the line:  CSV_IMPORT_ENABLED=1
   (if you added it)

3) frontend/vite.config.js
   Remove '/csv-import' from PROXY_PATHS.

4) frontend/src/App.jsx
   Remove:
       import CsvImportPage from "./csvImport/CsvImportPage";
       <Route path="/admin/csv-import" element={<CsvImportPage />} />

5) frontend/src/pages/AdminPage.jsx
   Remove the csvImportEnabled state + useEffect, and the
   "One-Time CSV Import" section in the Backup tab.

6) Re-run `npm run build` from frontend/ and commit.
"""


def main() -> int:
    parser = argparse.ArgumentParser(description="Teardown the one-time CSV importer.")
    parser.add_argument("--apply", action="store_true", help="Drop tbl_csv_import_queue.")
    args = parser.parse_args()

    print(f"DB: {DB}")
    if not DB.exists():
        print(f"  (DB not found — nothing to drop here.)")
    else:
        conn = sqlite3.connect(DB)
        try:
            row = conn.execute(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='tbl_csv_import_queue'"
            ).fetchone()
            if not row or row[0] == 0:
                print("  Queue table not present — nothing to drop.")
            else:
                count = conn.execute("SELECT COUNT(*) FROM tbl_csv_import_queue").fetchone()[0]
                print(f"  Queue table has {count} row(s).")
                if args.apply:
                    conn.execute("DROP TABLE tbl_csv_import_queue")
                    conn.commit()
                    print("  Dropped tbl_csv_import_queue.")
                else:
                    print("  (dry-run) Pass --apply to drop the table.")
        finally:
            conn.close()

    print("\nFiles to delete (manual):")
    for f in FILES_TO_DELETE:
        marker = "EXISTS" if f.exists() else "absent"
        print(f"  [{marker}] {f}")

    print()
    print(EDIT_INSTRUCTIONS)
    return 0


if __name__ == "__main__":
    sys.exit(main())
