"""
Migration: Add photocard triage statuses (Undecided / Not Wanted).

Background
----------
`ownership_status_id` carries two orthogonal kinds of fact:

  * a standing DECISION about a card  — undecided / wanted / not_wanted
    (at most one per card; it outlives the copies)
  * a POSSESSION fact about a copy    — owned / trade / pending_* / etc.

Before this migration the photocard library had no way to express the decision:
the 2026-04 import and BulkCreatePage both stamped every card 'wanted', so
'wanted' meant "this card exists in my library" rather than "I want this".

Steps:
  1. Back up the database
  2. INSERT 'undecided' (sort_order 9) and 'not_wanted' (sort_order 10).
     Appended deliberately: they are set once per card, so they belong behind
     the filter sidebar's "+N more" fold, unlike the frequently-changed
     statuses above them. No existing row is renumbered.
  3. INSERT xref_ownership_status_modules rows: both x photocards only
     (same targeted treatment 'catalog' gets — NOT the all-modules cross-join)
  4. Reclassify every 'wanted' photocard copy row to 'undecided', resetting the
     wanted list so it can be rebuilt deliberately. Row-scoped, so a
     co-occurring possession copy on the same card is untouched by construction.
  5. Verify counts

Idempotent: safe to re-run. Step 4 is a no-op on a second run because no
'wanted' rows remain (any Wanted set deliberately AFTER the migration would be
reclassified by a re-run, so do not re-run once triage has begun).

Usage:
  python backend/migrate_triage_statuses.py [path/to/collectcore.db]
"""

import shutil
import sqlite3
import sys
from datetime import datetime
from pathlib import Path


SCRIPT_DIR = Path(__file__).parent
PROJECT_ROOT = SCRIPT_DIR.parent
DEFAULT_DB_PATH = PROJECT_ROOT / "data" / "collectcore.db"

PHOTOCARDS_CODE = "photocards"

# (status_code, status_name, sort_order)
NEW_STATUSES = [
    ("undecided", "Undecided", 9),
    ("not_wanted", "Not Wanted", 10),
]


def backup_db(db_path: Path) -> Path:
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup = db_path.with_name(f"collectcore_pre_triage_migration_{ts}.db")
    shutil.copy2(db_path, backup)
    print(f"[backup] {backup}")
    return backup


def status_id(conn: sqlite3.Connection, code: str):
    row = conn.execute(
        "SELECT ownership_status_id FROM lkup_ownership_statuses WHERE status_code = ?",
        (code,),
    ).fetchone()
    return row[0] if row else None


def ensure_statuses(conn: sqlite3.Connection) -> dict:
    ids = {}
    for code, name, sort_order in NEW_STATUSES:
        existing = status_id(conn, code)
        if existing is not None:
            print(f"[status] {name} already present (id={existing})")
            ids[code] = existing
            continue
        conn.execute(
            "INSERT INTO lkup_ownership_statuses (status_code, status_name, sort_order, is_active) "
            "VALUES (?, ?, ?, 1)",
            (code, name, sort_order),
        )
        ids[code] = status_id(conn, code)
        print(f"[status] inserted {name} (id={ids[code]}, sort_order={sort_order})")
    conn.commit()
    return ids


def ensure_xref(conn: sqlite3.Connection) -> None:
    row = conn.execute(
        "SELECT collection_type_id FROM lkup_collection_types WHERE collection_type_code = ?",
        (PHOTOCARDS_CODE,),
    ).fetchone()
    if not row:
        raise RuntimeError(f"collection_type_code '{PHOTOCARDS_CODE}' not found")
    photocards_id = row[0]

    for code, name, _ in NEW_STATUSES:
        sid = status_id(conn, code)
        before = conn.total_changes
        conn.execute(
            "INSERT OR IGNORE INTO xref_ownership_status_modules "
            "(ownership_status_id, collection_type_id) VALUES (?, ?)",
            (sid, photocards_id),
        )
        added = conn.total_changes - before
        print(
            f"[xref] {name} x photocards "
            f"{'enabled' if added else 'already enabled'} (collection_type_id={photocards_id})"
        )
    conn.commit()


def reclassify_wanted(conn: sqlite3.Connection) -> int:
    wanted_id = status_id(conn, "wanted")
    undecided_id = status_id(conn, "undecided")
    if wanted_id is None:
        raise RuntimeError("'wanted' status missing — unexpected schema state")

    before = conn.execute(
        "SELECT COUNT(*) FROM tbl_photocard_copies WHERE ownership_status_id = ?",
        (wanted_id,),
    ).fetchone()[0]
    if before == 0:
        print("[reclassify] no 'wanted' photocard copies — nothing to do")
        return 0

    # Row-scoped on purpose: a card may legitimately hold a possession copy
    # (e.g. trade) alongside its decision row, and that copy must survive.
    conn.execute(
        "UPDATE tbl_photocard_copies SET ownership_status_id = ? WHERE ownership_status_id = ?",
        (undecided_id, wanted_id),
    )
    conn.commit()
    print(f"[reclassify] {before} 'wanted' copy rows -> 'undecided'")
    return before


def verify(conn: sqlite3.Connection) -> None:
    print("\n[verify] photocard copies by status:")
    rows = conn.execute(
        """
        SELECT os.status_code, COUNT(*)
        FROM tbl_photocard_copies pc
        JOIN lkup_ownership_statuses os USING(ownership_status_id)
        GROUP BY 1 ORDER BY 2 DESC
        """
    ).fetchall()
    for code, n in rows:
        print(f"          {code:<18} {n}")

    print("\n[verify] statuses visible to photocards (sidebar order):")
    rows = conn.execute(
        """
        SELECT s.status_name, s.sort_order
        FROM lkup_ownership_statuses s
        JOIN xref_ownership_status_modules x ON s.ownership_status_id = x.ownership_status_id
        JOIN lkup_collection_types c ON c.collection_type_id = x.collection_type_id
        WHERE s.is_active = 1 AND c.collection_type_code = ?
        ORDER BY s.sort_order
        """,
        (PHOTOCARDS_CODE,),
    ).fetchall()
    for i, (name, sort_order) in enumerate(rows, start=1):
        fold = "" if i <= 5 else "   (behind '+N more')"
        print(f"          {i}. {name} (sort_order={sort_order}){fold}")

    orphans = conn.execute(
        """
        SELECT COUNT(*) FROM (
            SELECT item_id FROM tbl_photocard_copies pc
            JOIN lkup_ownership_statuses os USING(ownership_status_id)
            WHERE os.status_code IN ('undecided', 'wanted', 'not_wanted')
            GROUP BY item_id HAVING COUNT(*) > 1
        )
        """
    ).fetchone()[0]
    print(f"\n[verify] cards with >1 decision row (must be 0): {orphans}")


def main() -> None:
    db_path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_DB_PATH
    if not db_path.exists():
        print(f"ERROR: database not found: {db_path}")
        sys.exit(1)

    print(f"[db] {db_path}")
    backup_db(db_path)

    conn = sqlite3.connect(db_path)
    try:
        conn.execute("PRAGMA foreign_keys = ON")
        ensure_statuses(conn)
        ensure_xref(conn)
        reclassify_wanted(conn)
        verify(conn)
    finally:
        conn.close()
    print("\n[done]")


if __name__ == "__main__":
    main()
