import logging
import os
import sqlite3
from pathlib import Path
from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import sessionmaker

logger = logging.getLogger("collectcore.db")

APP_ROOT = Path(__file__).resolve().parents[1]

# Allow the launcher to redirect user data to a separate directory (e.g. AppData)
# so that app updates don't overwrite the database or images.
# In development this variable is not set, so APP_ROOT is used as before.
_data_root_env = os.environ.get("COLLECTCORE_DATA_DIR")
DATA_ROOT = Path(_data_root_env) if _data_root_env else APP_ROOT

DB_PATH = DATA_ROOT / "data" / "collectcore.db"
logger.info("Using DB path: %s", DB_PATH)
SCHEMA_PATH = Path(__file__).resolve().parent / "sql" / "schema.sql"

DB_PATH.parent.mkdir(parents=True, exist_ok=True)

# SQLite concurrency settings, applied to EVERY connection (SQLAlchemy pool and
# the raw sqlite3 connections used by the publishers/backup code).
#
# journal_mode=WAL — readers no longer block the writer and vice versa. Under the
# default rollback journal a single slow write (an image-publish sweep, a restore)
# makes every concurrent request fail with "database is locked". WAL is persisted
# in the DB header, but we re-issue it per connection so a freshly restored or
# replaced DB file picks it up without a redeploy.
#
# busy_timeout — wait for a held write lock instead of failing instantly.
# pysqlite defaults to 5s, which a publish run blows through easily.
BUSY_TIMEOUT_MS = 15000


def _apply_sqlite_pragmas(dbapi_conn) -> None:
    cur = dbapi_conn.cursor()
    try:
        cur.execute("PRAGMA journal_mode=WAL")
        cur.execute(f"PRAGMA busy_timeout={BUSY_TIMEOUT_MS}")
    finally:
        cur.close()


engine = create_engine(
    f"sqlite:///{DB_PATH}",
    connect_args={"check_same_thread": False, "timeout": BUSY_TIMEOUT_MS / 1000},
)


@event.listens_for(engine, "connect")
def _set_sqlite_pragmas(dbapi_conn, _connection_record) -> None:
    _apply_sqlite_pragmas(dbapi_conn)


def raw_connect(**kwargs) -> sqlite3.Connection:
    """Open a plain sqlite3 connection to the app DB with the shared PRAGMAs.

    Use this instead of `sqlite3.connect(DB_PATH)` anywhere in the running app —
    a connection without busy_timeout raises "database is locked" the moment any
    other request holds the write lock.
    """
    kwargs.setdefault("timeout", BUSY_TIMEOUT_MS / 1000)
    conn = sqlite3.connect(str(DB_PATH), **kwargs)
    _apply_sqlite_pragmas(conn)
    return conn


SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def _run_migrations(conn) -> None:
    """Apply incremental schema migrations for existing databases."""
    raw = conn.connection

    # Migration: rename lkup_book_read_statuses -> lkup_consumption_statuses
    tables = {r[0] for r in raw.execute(
        "SELECT name FROM sqlite_master WHERE type='table'"
    ).fetchall()}
    if "lkup_book_read_statuses" in tables and "lkup_consumption_statuses" not in tables:
        raw.execute("ALTER TABLE lkup_book_read_statuses RENAME TO lkup_consumption_statuses")
        logger.info("Migration: renamed lkup_book_read_statuses -> lkup_consumption_statuses")

    # Migration: deactivate Copper Age era (data quality — era was never used in GN module)
    # Guarded for fresh DBs where schema.sql hasn't run yet (migrations execute before schema).
    if "lkup_graphicnovel_eras" in tables:
        raw.execute(
            "UPDATE lkup_graphicnovel_eras SET is_active = 0 WHERE era_name = 'Copper Age'"
        )

    # Migration: rewrite R2 dev URLs (pub-*.r2.dev) to the custom domain.
    # The dev URL is throttled by Cloudflare; the custom domain routes through
    # the full CDN. Idempotent — REPLACE matches no rows after first run.
    _OLD_HOST = "https://pub-8156609abf504c058e10ac0f5b7f6e95.r2.dev"
    _NEW_HOST = "https://images.collectcoreapp.com"
    _REWRITE_TARGETS = [
        ("tbl_attachments", "file_path"),
        ("tbl_book_copies", "cover_image_url"),
        ("tbl_graphicnovel_details", "cover_image_url"),
        ("tbl_game_details", "cover_image_url"),
        ("tbl_music_release_details", "cover_image_url"),
        ("tbl_video_details", "cover_image_url"),
        ("tbl_boardgame_details", "cover_image_url"),
    ]
    for tbl, col in _REWRITE_TARGETS:
        if tbl in tables:
            cur = raw.execute(
                f"UPDATE {tbl} SET {col} = REPLACE({col}, ?, ?) WHERE {col} LIKE ?",
                (_OLD_HOST, _NEW_HOST, f"{_OLD_HOST}%"),
            )
            if cur.rowcount > 0:
                logger.info("R2 host rewrite: %s.%s -> %d rows", tbl, col, cur.rowcount)

    # Migration: tbl_attachments.image_version (cache-bust suffix for R2 keys)
    if "tbl_attachments" in tables:
        cols = {r[1] for r in raw.execute("PRAGMA table_info(tbl_attachments)").fetchall()}
        if "image_version" not in cols:
            raw.execute("ALTER TABLE tbl_attachments ADD COLUMN image_version INTEGER NOT NULL DEFAULT 1")
            logger.info("Migration: added tbl_attachments.image_version")

    # Migration: tbl_video_details.on_media_server (boolean flag)
    if "tbl_video_details" in tables:
        cols = {r[1] for r in raw.execute("PRAGMA table_info(tbl_video_details)").fetchall()}
        if "on_media_server" not in cols:
            raw.execute("ALTER TABLE tbl_video_details ADD COLUMN on_media_server INTEGER NOT NULL DEFAULT 0")
            logger.info("Migration: added tbl_video_details.on_media_server")

    # Migration: mkt_sighting USD conversion columns.
    # The native amount stays the record; USD is derived and labelled, so these
    # are nullable — a JPY sighting captured before any rate was on file is
    # still a valid record of what the listing actually cost in yen.
    if "mkt_sighting" in tables:
        cols = {r[1] for r in raw.execute("PRAGMA table_info(mkt_sighting)").fetchall()}
        for col, ddl in (
            ("price_usd", "ALTER TABLE mkt_sighting ADD COLUMN price_usd INTEGER"),
            ("fx_rate", "ALTER TABLE mkt_sighting ADD COLUMN fx_rate REAL"),
            ("fx_source", "ALTER TABLE mkt_sighting ADD COLUMN fx_source TEXT"),
        ):
            if col not in cols:
                raw.execute(ddl)
                logger.info("Migration: added mkt_sighting.%s", col)

    # Migration: the fee columns shipped as *_cents, which is wrong for the
    # JPY and KRW marketplaces -- those have no minor unit at all. Renamed to
    # *_minor before anyone had filled them in. Rename first so the ADD COLUMN
    # below sees the new names and does not create a second, empty pair.
    if "lkup_mkt_marketplaces" in tables:
        cols = {r[1] for r in raw.execute(
            "PRAGMA table_info(lkup_mkt_marketplaces)").fetchall()}
        for old_c, new_c in (
            ("fee_fixed_cents", "fee_fixed_minor"),
            ("ship_absorbed_cents", "ship_absorbed_minor"),
        ):
            if old_c in cols and new_c not in cols:
                raw.execute(
                    f"ALTER TABLE lkup_mkt_marketplaces RENAME COLUMN {old_c} TO {new_c}")
                logger.info("Migration: renamed lkup_mkt_marketplaces.%s -> %s",
                            old_c, new_c)

    # Migration: marketplace fee model.
    if "lkup_mkt_marketplaces" in tables:
        cols = {r[1] for r in raw.execute(
            "PRAGMA table_info(lkup_mkt_marketplaces)").fetchall()}
        for col, ddl in (
            ("fee_pct",
             "ALTER TABLE lkup_mkt_marketplaces ADD COLUMN fee_pct REAL NOT NULL DEFAULT 0"),
            ("fee_fixed_minor",
             "ALTER TABLE lkup_mkt_marketplaces ADD COLUMN fee_fixed_minor INTEGER NOT NULL DEFAULT 0"),
            ("ship_absorbed_minor",
             "ALTER TABLE lkup_mkt_marketplaces ADD COLUMN ship_absorbed_minor INTEGER NOT NULL DEFAULT 0"),
            ("offer_discount_pct",
             "ALTER TABLE lkup_mkt_marketplaces ADD COLUMN offer_discount_pct REAL NOT NULL DEFAULT 0"),
        ):
            if col not in cols:
                raw.execute(ddl)
                logger.info("Migration: added lkup_mkt_marketplaces.%s", col)

    # Migration: detail-page capture fields on mkt_listing.
    if "mkt_listing" in tables:
        cols = {r[1] for r in raw.execute("PRAGMA table_info(mkt_listing)").fetchall()}
        for col, ddl in (
            ("capture_tier",
             "ALTER TABLE mkt_listing ADD COLUMN capture_tier TEXT NOT NULL DEFAULT 'sweep'"),
            ("shipping_payer", "ALTER TABLE mkt_listing ADD COLUMN shipping_payer TEXT"),
            ("description", "ALTER TABLE mkt_listing ADD COLUMN description TEXT"),
            ("seller_id", "ALTER TABLE mkt_listing ADD COLUMN seller_id TEXT"),
            ("source_dates", "ALTER TABLE mkt_listing ADD COLUMN source_dates TEXT"),
        ):
            if col not in cols:
                raw.execute(ddl)
                logger.info("Migration: added mkt_listing.%s", col)

    # Migration: source-origin ship dates.
    # Origin-level, not card-level: 88 origin rows date all 11,323 photocards,
    # and every card has an origin (source_origin_id has no NULLs in prod). The
    # date lives here rather than on tbl_photocard_details both because that is
    # the correct normalization and because that table's guest paths make new
    # columns there a hazard.
    if "lkup_photocard_source_origins" in tables:
        cols = {r[1] for r in raw.execute(
            "PRAGMA table_info(lkup_photocard_source_origins)").fetchall()}
        for col, ddl in (
            ("start_date",
             "ALTER TABLE lkup_photocard_source_origins ADD COLUMN start_date TEXT"),
            ("date_precision",
             "ALTER TABLE lkup_photocard_source_origins ADD COLUMN date_precision TEXT"),
        ):
            if col not in cols:
                raw.execute(ddl)
                logger.info("Migration: added lkup_photocard_source_origins.%s", col)

    # Migration: binder layout codes now read ACROSS x DOWN consistently.
    # The 6- and 12-pocket layouts were first stored with rows and columns
    # swapped ('2x3', '3x4'). Idempotent — matches nothing after the first run.
    # Note this transposes the sheet, so any card already placed in one of those
    # binders lands in a different pocket; only ever ran against empty dev rows.
    if "tbl_binders" in tables:
        for old, new in (("2x3", "3x2"), ("3x4", "4x3")):
            cur = raw.execute(
                "UPDATE tbl_binders SET layout_code = ? WHERE layout_code = ?",
                (new, old),
            )
            if cur.rowcount > 0:
                logger.info("Migration: binder layout %s -> %s (%d rows)", old, new, cur.rowcount)

    # Migration: tbl_video_season_copies (per-season multi-format copies)
    if "tbl_video_seasons" in tables and "tbl_video_season_copies" not in tables:
        raw.execute("""
            CREATE TABLE tbl_video_season_copies (
                copy_id             INTEGER PRIMARY KEY AUTOINCREMENT,
                season_id           INTEGER NOT NULL,
                format_type_id      INTEGER,
                ownership_status_id INTEGER,
                notes               TEXT,
                FOREIGN KEY (season_id) REFERENCES tbl_video_seasons(season_id) ON DELETE CASCADE,
                FOREIGN KEY (format_type_id) REFERENCES lkup_video_format_types(format_type_id),
                FOREIGN KEY (ownership_status_id) REFERENCES lkup_ownership_statuses(ownership_status_id)
            )
        """)
        raw.execute(
            "CREATE INDEX idx_video_season_copies_season ON tbl_video_season_copies(season_id)"
        )
        # Backfill: one copy row per pre-existing season that had inline format/ownership/notes set.
        # Skips seasons with no useful data and is naturally idempotent because the table is empty.
        raw.execute("""
            INSERT INTO tbl_video_season_copies (season_id, format_type_id, ownership_status_id, notes)
            SELECT season_id, format_type_id, ownership_status_id, notes
            FROM tbl_video_seasons
            WHERE format_type_id IS NOT NULL
               OR ownership_status_id IS NOT NULL
               OR (notes IS NOT NULL AND TRIM(notes) <> '')
        """)
        logger.info("Migration: created tbl_video_season_copies and backfilled from tbl_video_seasons")

    # Migration: 'lomo_fanmade' ownership status (Lomo/Fanmade), photocards only.
    # Requested by a /pcs/ user: a possession fact for an unofficial fan-printed
    # card, held INSTEAD of Owned. Appended (sort_order 11) so no existing status
    # is renumbered -- these rows are shared with every other module's sidebar.
    #
    # Runs at most once: migrations execute BEFORE schema.sql, so on the first
    # boot after this deploy the status is absent and both rows are written; on
    # every later boot the guard is false, which is what lets an admin turn the
    # status off again in Admin > Status Visibility without it coming back.
    # (_seed_status_visibility_xref can't do this -- it only seeds a fresh DB.)
    if "lkup_ownership_statuses" in tables and "xref_ownership_status_modules" in tables:
        already = raw.execute(
            "SELECT 1 FROM lkup_ownership_statuses WHERE status_code = 'lomo_fanmade'"
        ).fetchone()
        if not already:
            raw.execute(
                "INSERT INTO lkup_ownership_statuses "
                "(status_code, status_name, sort_order, is_active) "
                "VALUES ('lomo_fanmade', 'Lomo/Fanmade', 11, 1)"
            )
            raw.execute("""
                INSERT OR IGNORE INTO xref_ownership_status_modules
                    (ownership_status_id, collection_type_id)
                SELECT s.ownership_status_id, c.collection_type_id
                FROM lkup_ownership_statuses s, lkup_collection_types c
                WHERE s.status_code = 'lomo_fanmade'
                  AND c.collection_type_code = 'photocards'
            """)
            logger.info("Migration: added 'lomo_fanmade' ownership status (photocards)")


def _seed_status_visibility_xref(conn) -> None:
    """Idempotent maintenance for status-visibility xref tables.

    1. Cleans up orphan collection_type_ids left behind by the canonicalize
       migration (FK references to ids that no longer exist in
       lkup_collection_types).
    2. Seeds the xref tables ONCE on a fresh DB. If either xref table is
       non-empty, the seed is skipped — preserving any user toggles made
       via Admin > Status Visibility across restarts.
    """
    raw = conn.connection

    raw.execute("""
        DELETE FROM xref_ownership_status_modules
        WHERE collection_type_id NOT IN (SELECT collection_type_id FROM lkup_collection_types)
    """)
    raw.execute("""
        DELETE FROM xref_consumption_status_modules
        WHERE collection_type_id NOT IN (SELECT collection_type_id FROM lkup_collection_types)
    """)

    own_count = raw.execute("SELECT COUNT(*) FROM xref_ownership_status_modules").fetchone()[0]
    if own_count == 0:
        raw.execute("""
            INSERT OR IGNORE INTO xref_ownership_status_modules (ownership_status_id, collection_type_id)
            SELECT s.ownership_status_id, c.collection_type_id
            FROM lkup_ownership_statuses s, lkup_collection_types c
            WHERE s.is_active = 1 AND c.is_active = 1
              AND s.status_code NOT IN ('catalog', 'undecided', 'not_wanted', 'lomo_fanmade')
        """)
        raw.execute("""
            INSERT OR IGNORE INTO xref_ownership_status_modules (ownership_status_id, collection_type_id)
            SELECT s.ownership_status_id, c.collection_type_id
            FROM lkup_ownership_statuses s, lkup_collection_types c
            WHERE s.status_code IN ('catalog', 'undecided', 'not_wanted', 'lomo_fanmade')
              AND c.collection_type_code = 'photocards'
        """)
        logger.info("Seeded xref_ownership_status_modules (fresh DB)")

    cons_count = raw.execute("SELECT COUNT(*) FROM xref_consumption_status_modules").fetchone()[0]
    if cons_count == 0:
        for ct_code, names in [
            ("books", ("Read", "Currently Reading", "Want to Read", "DNF")),
            ("graphicnovels", ("Read", "Want to Read")),
            ("videogames", ("Played", "Playing", "Want to Play", "Abandoned")),
            ("video", ("Watched", "Currently Watching", "Want to Watch", "Abandoned")),
        ]:
            placeholders = ",".join("?" * len(names))
            raw.execute(
                f"""
                INSERT OR IGNORE INTO xref_consumption_status_modules (read_status_id, collection_type_id)
                SELECT cs.read_status_id, ct.collection_type_id
                FROM lkup_consumption_statuses cs, lkup_collection_types ct
                WHERE ct.collection_type_code = ?
                  AND cs.status_name IN ({placeholders})
                """,
                (ct_code, *names),
            )
        logger.info("Seeded xref_consumption_status_modules (fresh DB)")



def _seed_origin_start_dates(raw) -> None:
    """Fill in known origin ship dates. Idempotent and non-destructive.

    Two guards, both load-bearing:

      * Matched on (id AND name). source_origin_id is NOT stable across
        databases -- in the 2026-08 dev copy id 77 was "This & That" while in
        prod id 77 is "Season's Greetings 2025 (Japan) Your Hero". Seeding on
        id alone would silently write the wrong date. Rows whose name does not
        match are skipped and logged, never guessed at.

      * Only writes where start_date IS NULL, so a date corrected by hand in
        the admin UI survives every later restart.
    """
    from seed_origin_dates import ORIGIN_START_DATES

    applied = 0
    mismatched: list[str] = []
    for origin_id, name, start_date, precision in ORIGIN_START_DATES:
        cur = raw.execute(
            "UPDATE lkup_photocard_source_origins "
            "   SET start_date = ?, date_precision = ? "
            " WHERE source_origin_id = ? AND source_origin_name = ? "
            "   AND start_date IS NULL",
            (start_date, precision, origin_id, name),
        )
        if cur.rowcount:
            applied += cur.rowcount
            continue
        # Distinguish "already dated" (fine) from "id/name disagree" (loud).
        row = raw.execute(
            "SELECT source_origin_name, start_date FROM lkup_photocard_source_origins "
            " WHERE source_origin_id = ?", (origin_id,)).fetchone()
        if row is not None and row[0] != name:
            mismatched.append(f"id {origin_id}: seed={name!r} db={row[0]!r}")

    if applied:
        logger.info("Seeded %d source-origin start dates", applied)
    if mismatched:
        logger.warning(
            "Origin date seed skipped %d row(s) whose id/name disagree with this "
            "database -- dates NOT applied: %s",
            len(mismatched), "; ".join(mismatched),
        )



def _seed_cost_tiers(raw) -> None:
    """Seed the four default cost tiers. Runs after the schema is applied.

    Amounts derive from the album slot weights (ID 2 / album 3 / first-run 3 /
    store POB 4 over a ~$12 card pool) and are meant to be edited in the UI --
    the effective basis is derived on read, so changing a tier reprices every
    card sitting on it. INSERT OR IGNORE keys on tier_code, so an edited amount
    is never overwritten on restart.
    """
    for code, name, cents, order in (
        ("t1", "ID cards, Nacific, common",   200, 1),
        ("t2", "Older era (2020 and before)", 250, 2),
        ("t3", "Current era (2021+)",         300, 3),
        ("t4", "Store POB",                   400, 4),
    ):
        raw.execute(
            "INSERT OR IGNORE INTO mkt_cost_tier "
            "(tier_code, tier_name, cost_cents, sort_order) VALUES (?, ?, ?, ?)",
            (code, name, cents, order),
        )



def _seed_fee_components(raw) -> None:
    """Create the cost components each marketplace actually has, at zero.

    The LABELS are seeded, the AMOUNTS are not. Naming the real cost lines --
    Mercari's buyer protection fee, Neokyo's proxy and consolidation charges,
    import duty, PayPal -- tells you what needs filling in without inventing a
    number. Rates change, differ per account, and a wrong figure shown
    confidently is worse than an obviously blank one.

    INSERT OR IGNORE on (marketplace, side, label): an edited amount is never
    overwritten, and a component deleted on purpose stays deleted only until a
    restart re-adds it at zero, which is harmless.
    """
    # (marketplace, side, label, sort)
    COMPONENTS = (
        # Mercari US -- both sides. The buyer protection fee is visible on
        # every listing page; the selling side is what a sale nets.
        ("mercari_us", "sell", "Selling fee", 1),
        ("mercari_us", "sell", "Payment processing", 2),
        ("mercari_us", "sell", "Shipping I absorb", 3),
        ("mercari_us", "buy", "Buyer protection fee", 1),
        ("mercari_us", "buy", "Shipping I pay", 2),
        ("mercari_us", "buy", "Sales tax", 3),

        # Neokyo -- buy only. A proxy purchase has more cost lines than a
        # direct one, and they land at different times: some per item, some
        # per consolidated box.
        ("neokyo", "buy", "Service fee", 1),
        ("neokyo", "buy", "Domestic shipping (JP)", 2),
        ("neokyo", "buy", "Payment fee (PayPal)", 3),
        ("neokyo", "buy", "International shipping", 4),
        ("neokyo", "buy", "Customs / import duty", 5),

        ("pocamarket", "buy", "Service fee", 1),
        ("pocamarket", "buy", "Domestic shipping (KR)", 2),
        ("pocamarket", "buy", "Payment fee", 3),
        ("pocamarket", "buy", "International shipping", 4),
        ("pocamarket", "buy", "Customs / import duty", 5),

        ("ebay", "sell", "Final value fee", 1),
        ("ebay", "sell", "Payment processing", 2),
        ("ebay", "sell", "Shipping I absorb", 3),
        ("ebay", "buy", "Shipping I pay", 1),
        ("ebay", "buy", "Sales tax", 2),
    )
    for code, side, label, order in COMPONENTS:
        raw.execute(
            "INSERT OR IGNORE INTO mkt_fee_component "
            "(marketplace_code, side, label, sort_order) VALUES (?, ?, ?, ?)",
            (code, side, label, order),
        )

    # Carry over whatever was already entered under the old flat columns, so
    # the redesign does not quietly discard it. Runs once: the UPDATE only
    # matches a component still sitting at zero.
    cols = {r[1] for r in raw.execute(
        "PRAGMA table_info(lkup_mkt_marketplaces)").fetchall()}
    if {"fee_pct", "fee_fixed_minor", "ship_absorbed_minor"} <= cols:
        for code, pct, fixed, ship in raw.execute(
            "SELECT marketplace_code, fee_pct, fee_fixed_minor, ship_absorbed_minor "
            "FROM lkup_mkt_marketplaces"
        ).fetchall():
            if pct:
                raw.execute(
                    "UPDATE mkt_fee_component SET pct = ? "
                    " WHERE marketplace_code = ? AND side = 'sell'"
                    "   AND label = 'Selling fee' AND pct = 0",
                    (pct, code))
            if fixed:
                raw.execute(
                    "UPDATE mkt_fee_component SET fixed_minor = ? "
                    " WHERE marketplace_code = ? AND side = 'sell'"
                    "   AND label = 'Payment processing' AND fixed_minor = 0",
                    (fixed, code))
            if ship:
                raw.execute(
                    "UPDATE mkt_fee_component SET fixed_minor = ? "
                    " WHERE marketplace_code = ? AND side = 'sell'"
                    "   AND label = 'Shipping I absorb' AND fixed_minor = 0",
                    (ship, code))


def init_db() -> None:
    if not SCHEMA_PATH.exists():
        raise FileNotFoundError(f"Schema file not found: {SCHEMA_PATH}")

    schema_sql = SCHEMA_PATH.read_text(encoding="utf-8")

    with engine.begin() as conn:
        conn.execute(text("PRAGMA foreign_keys = ON"))
        _run_migrations(conn)
        raw_conn = conn.connection
        raw_conn.executescript(schema_sql)
        # Seeds run AFTER the schema: _run_migrations executes before the
        # CREATE TABLEs, so anything guarded on a table existing would silently
        # skip on the first boot that creates it.
        _seed_cost_tiers(raw_conn)
        _seed_fee_components(raw_conn)
        _seed_origin_start_dates(raw_conn)
        _seed_status_visibility_xref(conn)