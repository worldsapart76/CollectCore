"""
Migration: Photocard pricing tiers + Mercari listing-title templates.

Background
----------
Cards are priced by assigning a *tier* in one bulk sweep, with a per-card
custom amount as the escape hatch. Tier and custom price are mutually
exclusive, not layered — setting a custom price REMOVES the card from its
tier, so a later sweep over that tier can't silently reset it. The three
legal states are enforced by a CHECK constraint rather than by application
code:

    no row at all       -> unpriced
    price_tier_id set   -> tiered   (price_cents NULL)
    price_cents set     -> custom   (price_tier_id NULL)

Pricing lives in its own table rather than on tbl_photocard_details because
two guest-facing paths copy that table by reflection (catalog.py's `SELECT *`
and seed_builder's PRAGMA-driven column copy), so any column added there
would ship to the catalog delta endpoint and the guest seed with nothing in
the diff to warn you. A side table is invisible to both by construction.

Steps:
  1. Back up the database
  2. CREATE TABLE IF NOT EXISTS both tables + the tier index
  3. INSERT OR IGNORE the four seed tiers (resolved by tier_code, never by a
     hardcoded id — dev and prod autoincrement independently)
  4. INSERT OR IGNORE the three listing-title/description template settings
  5. Verify

Purely additive and idempotent: it creates empty tables and touches no
existing row, so it is safe to re-run at any point.

Usage:
  python backend/migrate_photocard_pricing.py [path/to/collectcore.db]

Design: docs/photocard_pricing_and_trade_export_plan.md
"""

import shutil
import sqlite3
import sys
from datetime import datetime
from pathlib import Path


SCRIPT_DIR = Path(__file__).parent
PROJECT_ROOT = SCRIPT_DIR.parent
DEFAULT_DB_PATH = PROJECT_ROOT / "data" / "collectcore.db"

CREATE_TIERS = """
CREATE TABLE IF NOT EXISTS lkup_photocard_price_tiers (
    tier_id     INTEGER PRIMARY KEY AUTOINCREMENT,
    tier_code   TEXT NOT NULL UNIQUE,
    tier_name   TEXT NOT NULL,
    price_cents INTEGER NOT NULL,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    is_active   INTEGER NOT NULL DEFAULT 1
)
"""

CREATE_PRICING = """
CREATE TABLE IF NOT EXISTS tbl_photocard_pricing (
    item_id       INTEGER PRIMARY KEY,
    price_tier_id INTEGER,
    price_cents   INTEGER,
    updated_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CHECK ((price_tier_id IS NULL) <> (price_cents IS NULL)),
    FOREIGN KEY (item_id) REFERENCES tbl_items(item_id),
    FOREIGN KEY (price_tier_id) REFERENCES lkup_photocard_price_tiers(tier_id)
)
"""

CREATE_INDEX = """
CREATE INDEX IF NOT EXISTS idx_photocard_pricing_tier
    ON tbl_photocard_pricing (price_tier_id)
"""

# (tier_code, tier_name, price_cents, sort_order)
SEED_TIERS = [
    ("t1", "Tier 1", 400, 1),
    ("t2", "Tier 2", 600, 2),
    ("t3", "Tier 3", 900, 3),
    ("t4", "Tier 4", 1200, 4),
]

SEED_SETTINGS = [
    ("photocard_title_template", "{group} {member} {source} {version} Official Photocard"),
    ("photocard_title_template_pc", "{group} {member} {source} Official {version}"),
    ("photocard_description_template",
     "{title}. Ships in a toploader and sleeve inside a bubble mailer."),
]


def backup_db(db_path: Path) -> Path:
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup = db_path.with_name(f"collectcore_pre_pricing_migration_{ts}.db")
    shutil.copy2(db_path, backup)
    print(f"[backup] {backup}")
    return backup


def ensure_tables(conn: sqlite3.Connection) -> None:
    for label, ddl in (
        ("lkup_photocard_price_tiers", CREATE_TIERS),
        ("tbl_photocard_pricing", CREATE_PRICING),
        ("idx_photocard_pricing_tier", CREATE_INDEX),
    ):
        existed = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE name = ? LIMIT 1", (label,)
        ).fetchone()
        conn.execute(ddl)
        print(f"[schema] {label} {'already present' if existed else 'created'}")
    conn.commit()


def ensure_tiers(conn: sqlite3.Connection) -> None:
    for code, name, cents, sort_order in SEED_TIERS:
        before = conn.total_changes
        conn.execute(
            "INSERT OR IGNORE INTO lkup_photocard_price_tiers "
            "(tier_code, tier_name, price_cents, sort_order) VALUES (?, ?, ?, ?)",
            (code, name, cents, sort_order),
        )
        added = conn.total_changes - before
        tier_id = conn.execute(
            "SELECT tier_id FROM lkup_photocard_price_tiers WHERE tier_code = ?", (code,)
        ).fetchone()[0]
        print(
            f"[tier] {name} ${cents / 100:.2f} "
            f"{'inserted' if added else 'already present'} (tier_id={tier_id})"
        )
    conn.commit()


def ensure_settings(conn: sqlite3.Connection) -> None:
    for key, value in SEED_SETTINGS:
        before = conn.total_changes
        conn.execute(
            "INSERT OR IGNORE INTO tbl_app_settings (key, value) VALUES (?, ?)",
            (key, value),
        )
        added = conn.total_changes - before
        current = conn.execute(
            "SELECT value FROM tbl_app_settings WHERE key = ?", (key,)
        ).fetchone()[0]
        print(f"[setting] {key} {'seeded' if added else 'kept'}: {current}")
    conn.commit()


def verify(conn: sqlite3.Connection) -> None:
    print("\n[verify] tiers:")
    for tier_id, code, name, cents, sort_order, active in conn.execute(
        "SELECT tier_id, tier_code, tier_name, price_cents, sort_order, is_active "
        "FROM lkup_photocard_price_tiers ORDER BY sort_order"
    ):
        state = "" if active else "   (inactive)"
        print(f"          {sort_order}. {name} [{code}] ${cents / 100:.2f} (id={tier_id}){state}")

    priced = conn.execute("SELECT COUNT(*) FROM tbl_photocard_pricing").fetchone()[0]
    tiered = conn.execute(
        "SELECT COUNT(*) FROM tbl_photocard_pricing WHERE price_tier_id IS NOT NULL"
    ).fetchone()[0]
    print(f"\n[verify] priced cards: {priced} ({tiered} tiered / {priced - tiered} custom)")

    # The CHECK is the whole enforcement story for tier-XOR-custom; prove it
    # holds on this database rather than trusting that the DDL was applied.
    for label, sql in (
        ("both set", "INSERT INTO tbl_photocard_pricing (item_id, price_tier_id, price_cents) "
                     "VALUES (-1, 1, 500)"),
        ("neither set", "INSERT INTO tbl_photocard_pricing (item_id, price_tier_id, price_cents) "
                        "VALUES (-1, NULL, NULL)"),
    ):
        try:
            conn.execute(sql)
        except sqlite3.IntegrityError:
            print(f"[verify] CHECK rejects '{label}' — ok")
        else:
            print(f"[verify] WARNING: CHECK accepted '{label}' — constraint missing")
        finally:
            conn.rollback()

    trade = conn.execute(
        """
        SELECT COUNT(DISTINCT i.item_id), COUNT(*)
        FROM tbl_items i
        JOIN tbl_photocard_copies pc ON pc.item_id = i.item_id
        JOIN lkup_ownership_statuses os ON os.ownership_status_id = pc.ownership_status_id
        WHERE os.status_code = 'trade'
        """
    ).fetchone()
    print(f"[verify] trade shelf: {trade[0]} cards across {trade[1]} copies")


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
        ensure_tables(conn)
        ensure_tiers(conn)
        ensure_settings(conn)
        verify(conn)
    finally:
        conn.close()
    print("\n[done]")


if __name__ == "__main__":
    main()
