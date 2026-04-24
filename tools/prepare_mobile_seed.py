"""
Build the guest mobile seed DB (Catalog snapshot) from the admin DB.

Output: data/mobile_seed.db + data/catalog_version.json

For each photocard with catalog_item_id IS NOT NULL:
  - Copy tbl_items, tbl_photocard_details, xref_photocard_members
  - Copy tbl_attachments (front + back) — these should already be storage_type='hosted'
    after publish_catalog.py has run; local attachments are copied as-is but logged
  - Insert ONE tbl_photocard_copies row with ownership_status_id = Catalog
  - Admin's own copies (Owned, Wanted, etc.) are NOT copied

All lookup + xref tables are copied wholesale from admin. This keeps UI dropdowns
populated for photocards without fragile per-table scoping.

Optionally uploads seed.db and catalog_version.json to R2 (requires R2 env).

Usage:
  python tools/prepare_mobile_seed.py                  # build only
  python tools/prepare_mobile_seed.py --upload         # build + upload to R2
  python tools/prepare_mobile_seed.py --output path.db # custom output
"""

import argparse
import json
import os
import sqlite3
import sys
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent
ADMIN_DB = PROJECT_ROOT / "data" / "collectcore.db"
DEFAULT_SEED_DB = PROJECT_ROOT / "data" / "mobile_seed.db"
DEFAULT_VERSION_FILE = PROJECT_ROOT / "data" / "catalog_version.json"
SCHEMA_SQL = PROJECT_ROOT / "backend" / "sql" / "schema.sql"
ENV_FILE = PROJECT_ROOT / "backend" / ".env"

PHOTOCARDS_CODE = "photocards"
CATALOG_STATUS_CODE = "catalog"

# Lookup + xref tables copied wholesale (module-neutral). Safe to include all.
LOOKUP_TABLES = [
    "lkup_collection_types",
    "lkup_ownership_statuses",
    "lkup_consumption_statuses",
    "lkup_top_level_categories",
    "xref_ownership_status_modules",
    "xref_consumption_status_modules",
    # Photocard-scoped lookups
    "lkup_photocard_groups",
    "lkup_photocard_members",
    "lkup_photocard_source_origins",
]


def load_env_file(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip())


def copy_table(src: sqlite3.Connection, dst: sqlite3.Connection, table: str) -> int:
    cols = [r[1] for r in src.execute(f"PRAGMA table_info({table})").fetchall()]
    if not cols:
        print(f"[warn] table {table} does not exist in source, skipping")
        return 0
    placeholders = ",".join("?" * len(cols))
    col_list = ",".join(cols)
    rows = src.execute(f"SELECT {col_list} FROM {table}").fetchall()
    dst.executemany(f"INSERT OR REPLACE INTO {table} ({col_list}) VALUES ({placeholders})", rows)
    return len(rows)


def build_seed(admin_db: Path, seed_db: Path) -> dict:
    if seed_db.exists():
        seed_db.unlink()
    seed_db.parent.mkdir(parents=True, exist_ok=True)

    dst = sqlite3.connect(str(seed_db))
    dst.executescript(SCHEMA_SQL.read_text(encoding="utf-8"))
    # Schema.sql seeds some lookup data via cross-joins; overwrite with admin's exact rows
    # to avoid drift. Disable FK checks during the wholesale copy so REPLACE can shuffle
    # rows without triggering cascades; re-enable before finishing.
    dst.execute("PRAGMA foreign_keys = OFF")
    # Wipe seeded data from tables we're about to overwrite (keeps table schemas intact).
    for table in LOOKUP_TABLES:
        dst.execute(f"DELETE FROM {table}")
    dst.commit()

    src = sqlite3.connect(f"file:{admin_db.as_posix()}?mode=ro", uri=True)

    # --- 1. Lookup + xref tables ---
    for table in LOOKUP_TABLES:
        n = copy_table(src, dst, table)
        print(f"[copy] {table}: {n} rows")

    # Resolve ids that we need for insert
    photocards_id = src.execute(
        "SELECT collection_type_id FROM lkup_collection_types WHERE collection_type_code = ?",
        (PHOTOCARDS_CODE,),
    ).fetchone()[0]
    catalog_status_id = src.execute(
        "SELECT ownership_status_id FROM lkup_ownership_statuses WHERE status_code = ?",
        (CATALOG_STATUS_CODE,),
    ).fetchone()[0]

    # --- 2. Photocard items (Catalog only) ---
    item_cols = [r[1] for r in src.execute("PRAGMA table_info(tbl_items)").fetchall()]
    item_col_list = ",".join(item_cols)
    item_placeholders = ",".join("?" * len(item_cols))

    item_rows = src.execute(
        f"""
        SELECT {item_col_list} FROM tbl_items
        WHERE collection_type_id = ? AND catalog_item_id IS NOT NULL
        ORDER BY item_id
        """,
        (photocards_id,),
    ).fetchall()
    dst.executemany(
        f"INSERT INTO tbl_items ({item_col_list}) VALUES ({item_placeholders})", item_rows
    )
    print(f"[copy] tbl_items (photocards with catalog_item_id): {len(item_rows)} rows")

    item_ids = [r[item_cols.index("item_id")] for r in item_rows]
    if not item_ids:
        print("[warn] no Catalog photocards found; seed DB will be empty.")
    placeholders = ",".join("?" * len(item_ids)) if item_ids else "NULL"

    # --- 3. tbl_photocard_details ---
    detail_cols = [r[1] for r in src.execute("PRAGMA table_info(tbl_photocard_details)").fetchall()]
    detail_col_list = ",".join(detail_cols)
    if item_ids:
        detail_rows = src.execute(
            f"SELECT {detail_col_list} FROM tbl_photocard_details WHERE item_id IN ({placeholders})",
            item_ids,
        ).fetchall()
        dst.executemany(
            f"INSERT INTO tbl_photocard_details ({detail_col_list}) VALUES "
            f"({','.join('?' * len(detail_cols))})",
            detail_rows,
        )
        print(f"[copy] tbl_photocard_details: {len(detail_rows)} rows")

    # --- 4. xref_photocard_members ---
    if item_ids:
        member_rows = src.execute(
            f"SELECT item_id, member_id FROM xref_photocard_members WHERE item_id IN ({placeholders})",
            item_ids,
        ).fetchall()
        dst.executemany(
            "INSERT OR IGNORE INTO xref_photocard_members (item_id, member_id) VALUES (?, ?)",
            member_rows,
        )
        print(f"[copy] xref_photocard_members: {len(member_rows)} rows")

    # --- 5. tbl_attachments (front + back only) ---
    att_cols = [r[1] for r in src.execute("PRAGMA table_info(tbl_attachments)").fetchall()]
    att_col_list = ",".join(att_cols)
    if item_ids:
        att_rows = src.execute(
            f"""
            SELECT {att_col_list} FROM tbl_attachments
            WHERE item_id IN ({placeholders})
              AND attachment_type IN ('front', 'back')
            """,
            item_ids,
        ).fetchall()
        dst.executemany(
            f"INSERT INTO tbl_attachments ({att_col_list}) VALUES "
            f"({','.join('?' * len(att_cols))})",
            att_rows,
        )
        local_count = sum(1 for r in att_rows if r[att_cols.index("storage_type")] == "local")
        print(f"[copy] tbl_attachments: {len(att_rows)} rows (local={local_count})")
        if local_count:
            print("[warn] some attachments are still storage_type='local' — run publish_catalog.py first")

    # --- 6. tbl_photocard_copies: exactly one Catalog copy per item ---
    if item_ids:
        rows = [(iid, catalog_status_id, None) for iid in item_ids]
        dst.executemany(
            "INSERT INTO tbl_photocard_copies (item_id, ownership_status_id, notes) VALUES (?, ?, ?)",
            rows,
        )
        print(f"[copy] tbl_photocard_copies (Catalog status): {len(rows)} rows")

    dst.execute("PRAGMA foreign_keys = ON")
    dst.commit()

    # Version metadata
    max_version = dst.execute(
        "SELECT MAX(catalog_version) FROM tbl_items WHERE catalog_item_id IS NOT NULL"
    ).fetchone()[0] or 0
    card_count = dst.execute(
        "SELECT COUNT(*) FROM tbl_items WHERE catalog_item_id IS NOT NULL"
    ).fetchone()[0]

    dst.close()
    src.close()

    size_mb = seed_db.stat().st_size / (1024 * 1024)
    print(f"[done] {seed_db}: {size_mb:.2f} MB, {card_count} cards, max_version={max_version}")
    return {"max_version": max_version, "card_count": card_count}


def upload_to_r2(seed_db: Path, version_file: Path) -> None:
    import boto3
    from botocore.config import Config

    endpoint = os.environ["R2_ENDPOINT"]
    bucket = os.environ["R2_BUCKET"]
    key_id = os.environ["R2_ACCESS_KEY_ID"]
    secret = os.environ["R2_SECRET_ACCESS_KEY"]

    s3 = boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=key_id,
        aws_secret_access_key=secret,
        region_name="auto",
        config=Config(signature_version="s3v4"),
    )

    s3.upload_file(
        str(seed_db), bucket, "catalog/seed.db",
        ExtraArgs={"ContentType": "application/x-sqlite3"},
    )
    print(f"[upload] catalog/seed.db ({seed_db.stat().st_size} bytes)")

    s3.upload_file(
        str(version_file), bucket, "catalog/version.json",
        ExtraArgs={"ContentType": "application/json", "CacheControl": "public, max-age=60"},
    )
    print(f"[upload] catalog/version.json")


def main() -> int:
    p = argparse.ArgumentParser(description="Build + optionally upload mobile seed DB.")
    p.add_argument("--output", type=Path, default=DEFAULT_SEED_DB)
    p.add_argument("--version-file", type=Path, default=DEFAULT_VERSION_FILE)
    p.add_argument("--upload", action="store_true", help="Upload to R2 after build")
    args = p.parse_args()

    if not ADMIN_DB.exists():
        print(f"[error] admin DB not found: {ADMIN_DB}", file=sys.stderr)
        return 1
    if not SCHEMA_SQL.exists():
        print(f"[error] schema.sql not found: {SCHEMA_SQL}", file=sys.stderr)
        return 1

    load_env_file(ENV_FILE)

    info = build_seed(ADMIN_DB, args.output)

    args.version_file.parent.mkdir(parents=True, exist_ok=True)
    args.version_file.write_text(json.dumps(info, indent=2))
    print(f"[done] {args.version_file}: {info}")

    if args.upload:
        for var in ("R2_ENDPOINT", "R2_BUCKET", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"):
            if not os.environ.get(var):
                print(f"[error] --upload requires {var}", file=sys.stderr)
                return 2
        upload_to_r2(args.output, args.version_file)
    return 0


if __name__ == "__main__":
    sys.exit(main())
