"""
Admin CLI: publish photocards to the public Catalog on Cloudflare R2.

Per card:
  1. Assign catalog_item_id if NULL (from group_code + item_id)
  2. Resize front (and back, if present) to 600x924 JPEG 80%, upload to R2
     at catalog/images/{catalog_item_id}_f.jpg (and _b.jpg)
  3. Rewrite tbl_attachments: storage_type='hosted', file_path=<full R2 URL>,
     mime_type='image/jpeg'
  4. At end of run, bump catalog_version (global MAX + 1) on every card that
     had any attachment uploaded this run

Idempotent:
  - Attachments already storage_type='hosted' are skipped (no upload, no version bump)
  - A card whose attachments are all hosted is a no-op

Usage:
  python tools/publish_catalog.py --item-id 123
  python tools/publish_catalog.py --all           # publish everything needing it
  python tools/publish_catalog.py --all --limit 10    # test with first 10
  python tools/publish_catalog.py --all --dry-run     # show what would happen

Env (read from backend/.env):
  R2_ENDPOINT              e.g. https://<account-id>.r2.cloudflarestorage.com
  R2_BUCKET                bucket name
  R2_ACCESS_KEY_ID         S3-compatible access key
  R2_SECRET_ACCESS_KEY     S3-compatible secret
  R2_PUBLIC_BASE_URL       e.g. https://pub-xxx.r2.dev  OR  your custom domain
                           (no trailing slash)
"""

import argparse
import io
import os
import shutil
import sqlite3
import sys
from datetime import datetime
from pathlib import Path
from typing import Optional


SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent
DB_PATH = PROJECT_ROOT / "data" / "collectcore.db"
ENV_FILE = PROJECT_ROOT / "backend" / ".env"
IMAGES_ROOT = PROJECT_ROOT

CATALOG_PREFIX = "catalog/images"
RESIZE_MAX = (600, 924)
JPEG_QUALITY = 80
PHOTOCARDS_CODE = "photocards"


def load_env_file(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip())


def require_env(name: str) -> str:
    v = os.environ.get(name, "").strip()
    if not v:
        print(f"[error] missing env var: {name}", file=sys.stderr)
        sys.exit(2)
    return v


def make_r2_client(endpoint: str, key: str, secret: str):
    import boto3
    from botocore.config import Config

    return boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=key,
        aws_secret_access_key=secret,
        region_name="auto",
        config=Config(signature_version="s3v4"),
    )


def resize_to_jpeg(src_path: Path) -> bytes:
    from PIL import Image

    with Image.open(src_path) as im:
        if im.mode not in ("RGB", "L"):
            im = im.convert("RGB")
        im.thumbnail(RESIZE_MAX, Image.Resampling.LANCZOS)
        buf = io.BytesIO()
        im.save(buf, format="JPEG", quality=JPEG_QUALITY, optimize=True)
        return buf.getvalue()


def backup_db(db_path: Path) -> Path:
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup = db_path.with_name(f"collectcore_pre_publish_{ts}.db")
    shutil.copy2(db_path, backup)
    print(f"[backup] {backup}")
    return backup


def assign_catalog_item_id(
    conn: sqlite3.Connection, item_id: int, photocards_id: int
) -> str:
    row = conn.execute(
        """
        SELECT i.catalog_item_id, g.group_code, a.file_path
        FROM tbl_items i
        JOIN tbl_photocard_details d ON d.item_id = i.item_id
        JOIN lkup_photocard_groups g ON g.group_id = d.group_id
        LEFT JOIN tbl_attachments a
               ON a.item_id = i.item_id AND a.attachment_type = 'front'
        WHERE i.item_id = ? AND i.collection_type_id = ?
        """,
        (item_id, photocards_id),
    ).fetchone()
    if not row:
        raise RuntimeError(f"photocard item_id={item_id} not found")
    existing, group_code, front_path = row
    if existing:
        return existing

    import re
    derived = None
    if front_path:
        m = re.search(r"([a-z0-9]+)_(\d{6})_[fb]\.", front_path, re.IGNORECASE)
        if m:
            derived = f"{m.group(1)}_{m.group(2)}"
    if derived is None:
        derived = f"{group_code}_{item_id:06d}"

    conn.execute(
        "UPDATE tbl_items SET catalog_item_id = ? WHERE item_id = ?",
        (derived, item_id),
    )
    return derived


def select_candidates(conn: sqlite3.Connection, scope: str, item_id: Optional[int], limit: Optional[int]) -> list[int]:
    photocards_id = conn.execute(
        "SELECT collection_type_id FROM lkup_collection_types WHERE collection_type_code = ?",
        (PHOTOCARDS_CODE,),
    ).fetchone()[0]

    if scope == "one":
        return [item_id]

    sql = """
        SELECT DISTINCT i.item_id
        FROM tbl_items i
        WHERE i.collection_type_id = ?
          AND (
            i.catalog_item_id IS NULL
            OR EXISTS (
                SELECT 1 FROM tbl_attachments a
                WHERE a.item_id = i.item_id
                  AND a.attachment_type IN ('front', 'back')
                  AND a.storage_type = 'local'
            )
          )
        ORDER BY i.item_id
    """
    if limit:
        sql += f" LIMIT {int(limit)}"
    rows = conn.execute(sql, (photocards_id,)).fetchall()
    return [r[0] for r in rows]


def publish_item(
    conn: sqlite3.Connection,
    s3,
    bucket: str,
    public_base: str,
    item_id: int,
    photocards_id: int,
    dry_run: bool,
) -> tuple[int, int]:
    """Returns (uploaded_count, skipped_count) for this item's attachments."""
    catalog_item_id = assign_catalog_item_id(conn, item_id, photocards_id)

    attachments = conn.execute(
        """
        SELECT attachment_id, attachment_type, file_path, storage_type, image_version
        FROM tbl_attachments
        WHERE item_id = ? AND attachment_type IN ('front', 'back')
        ORDER BY attachment_type
        """,
        (item_id,),
    ).fetchall()

    uploaded = 0
    skipped = 0
    for att_id, atype, file_path, storage_type, image_version in attachments:
        side = "f" if atype == "front" else "b"
        # Versioned key — see catalog_publisher.py for the cache-bust rationale.
        key = f"{CATALOG_PREFIX}/{catalog_item_id}_{side}_v{image_version}.jpg"
        hosted_url = f"{public_base.rstrip('/')}/{key}"

        if storage_type == "hosted":
            skipped += 1
            continue

        src = IMAGES_ROOT / file_path
        if not src.is_file():
            print(f"[warn] item={item_id} {atype} file missing on disk: {file_path}")
            skipped += 1
            continue

        if dry_run:
            print(f"[dry-run] would upload {src} -> s3://{bucket}/{key}")
        else:
            body = resize_to_jpeg(src)
            s3.put_object(
                Bucket=bucket,
                Key=key,
                Body=body,
                ContentType="image/jpeg",
                CacheControl="public, max-age=31536000, immutable",
            )
            conn.execute(
                "UPDATE tbl_attachments SET storage_type = 'hosted', "
                "file_path = ?, mime_type = 'image/jpeg' WHERE attachment_id = ?",
                (hosted_url, att_id),
            )
        uploaded += 1

    return uploaded, skipped


def bump_catalog_version(conn: sqlite3.Connection, item_ids: list[int]) -> int:
    if not item_ids:
        return 0
    cur = conn.execute("SELECT COALESCE(MAX(catalog_version), 0) FROM tbl_items").fetchone()[0]
    next_ver = (cur or 0) + 1
    placeholders = ",".join("?" * len(item_ids))
    conn.execute(
        f"UPDATE tbl_items SET catalog_version = ? WHERE item_id IN ({placeholders})",
        (next_ver, *item_ids),
    )
    return next_ver


def main() -> int:
    p = argparse.ArgumentParser(description="Publish photocards to the Catalog on R2.")
    g = p.add_mutually_exclusive_group(required=True)
    g.add_argument("--item-id", type=int, help="Publish a single photocard by item_id")
    g.add_argument("--all", action="store_true", help="Publish every photocard needing it")
    p.add_argument("--limit", type=int, help="Cap how many cards to process (testing)")
    p.add_argument("--dry-run", action="store_true", help="Print actions, don't upload or write DB")
    p.add_argument("--no-backup", action="store_true", help="Skip DB backup (testing only)")
    args = p.parse_args()

    if not DB_PATH.exists():
        print(f"[error] DB not found: {DB_PATH}", file=sys.stderr)
        return 1

    load_env_file(ENV_FILE)
    endpoint = require_env("R2_ENDPOINT")
    bucket = require_env("R2_BUCKET")
    key_id = require_env("R2_ACCESS_KEY_ID")
    secret = require_env("R2_SECRET_ACCESS_KEY")
    public_base = require_env("R2_PUBLIC_BASE_URL")

    if not args.dry_run and not args.no_backup:
        backup_db(DB_PATH)

    s3 = make_r2_client(endpoint, key_id, secret)

    conn = sqlite3.connect(str(DB_PATH))
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        photocards_id = conn.execute(
            "SELECT collection_type_id FROM lkup_collection_types WHERE collection_type_code = ?",
            (PHOTOCARDS_CODE,),
        ).fetchone()[0]

        scope = "one" if args.item_id else "all"
        candidates = select_candidates(conn, scope, args.item_id, args.limit)
        print(f"[plan] {len(candidates)} card(s) to evaluate")

        changed_items: list[int] = []
        total_uploaded = 0
        total_skipped = 0
        for i, item_id in enumerate(candidates, 1):
            uploaded, skipped = publish_item(
                conn, s3, bucket, public_base, item_id, photocards_id, args.dry_run
            )
            total_uploaded += uploaded
            total_skipped += skipped
            if uploaded > 0 and not args.dry_run:
                changed_items.append(item_id)
            if i % 100 == 0:
                print(f"[progress] {i}/{len(candidates)} (uploaded={total_uploaded}, skipped={total_skipped})")
                conn.commit()

        if args.dry_run:
            print(
                f"[dry-run summary] would_upload={total_uploaded}, would_skip={total_skipped}, items={len(candidates)}"
            )
            return 0

        next_ver = bump_catalog_version(conn, changed_items)
        conn.commit()
        print(
            f"[done] uploaded={total_uploaded}, skipped={total_skipped}, "
            f"items_changed={len(changed_items)}, new_catalog_version={next_ver}"
        )
    finally:
        conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
