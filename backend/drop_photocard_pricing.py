"""Drop the retired photocard sell price tier tables. MANUAL, one-off.

    python backend/drop_photocard_pricing.py            # report only
    python backend/drop_photocard_pricing.py --apply    # actually drop
    python backend/drop_photocard_pricing.py --apply --force   # even if rows exist

Why this is a script and not a migration in db.py
-------------------------------------------------
Migrations in this project stay ADDITIVE and idempotent, so that a restart can
never alter data. A `DROP TABLE` on boot is the precise opposite: it would
destroy rows on every environment the moment a deploy landed, including any this
repo cannot inspect. Dev is not prod, and "it was empty in dev" is not evidence.

So the tables are simply orphaned by the code removal in phase 4 — nothing reads
or writes them any more — and disposing of them is a deliberate act you take when
you are ready, against a database you can see.

Safe by default: reports what it finds and changes nothing without `--apply`,
and refuses to proceed if `tbl_photocard_pricing` holds rows unless you also
pass `--force` -- a per-card assignment means cards WERE priced after all, and
that is worth seeing before it is gone.

The guard deliberately ignores `lkup_photocard_price_tiers`, which holds its
four seeded tier definitions in every database ever created, used or not. A
guard that trips every single time teaches you to pass --force reflexively,
which is worse than no guard at all.

NOT to be confused with mkt_cost_tier / mkt_item_cost, which hold acquisition
COST, are actively used by the market module, and must be left alone.
"""
import argparse
import os
import sqlite3
import sys

TABLES = ["tbl_photocard_pricing", "lkup_photocard_price_tiers"]

# Only per-card assignments are evidence the feature was used. The lookup
# table carries four seeded rows in every database ever created.
EVIDENCE_OF_USE = "tbl_photocard_pricing"


def resolve_db_path() -> str:
    """Same convention db.py uses, so this acts on the database the app does."""
    data_dir = os.environ.get("COLLECTCORE_DATA_DIR")
    if data_dir:
        return os.path.join(data_dir, "collectcore.db")
    here = os.path.dirname(os.path.abspath(__file__))
    return os.path.join(os.path.dirname(here), "data", "collectcore.db")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--apply", action="store_true",
                    help="actually drop the tables (default is report only)")
    ap.add_argument("--force", action="store_true",
                    help="drop even if a table still holds rows")
    ap.add_argument("--db", default=None, help="path to collectcore.db")
    args = ap.parse_args()

    path = args.db or resolve_db_path()
    if not os.path.exists(path):
        print(f"No database at {path}")
        return 1
    print(f"Database: {path}\n")

    conn = sqlite3.connect(path)
    present = {r[0] for r in conn.execute(
        "SELECT name FROM sqlite_master WHERE type = 'table'")}

    found, occupied = [], []
    for t in TABLES:
        if t not in present:
            print(f"  {t:32} already gone")
            continue
        n = conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
        print(f"  {t:32} {n} row(s)")
        found.append(t)
        if n and t == EVIDENCE_OF_USE:
            occupied.append(t)

    if not found:
        print("\nNothing to do.")
        return 0

    if occupied and not args.force:
        print("\nSTOPPING:", ", ".join(occupied), "still holds card rows.")
        print("Cards were priced after all. Look at them before dropping;")
        print("re-run with --apply --force once you are sure.")
        return 2

    if not args.apply:
        print("\nDry run. Re-run with --apply to drop"
              f" {len(found)} table(s).")
        return 0

    # Child table first: the FK clause is documentation only (cascades never
    # fire here), but dropping in dependency order keeps the intent readable.
    for t in found:
        conn.execute(f"DROP TABLE IF EXISTS {t}")
        print(f"  dropped {t}")
    conn.commit()
    # Reclaim the pages rather than leaving them as free space.
    conn.execute("VACUUM")
    print("\nDone.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
