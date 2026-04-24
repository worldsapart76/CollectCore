"""
Admin CLI: migrate non-photocard cover images to Cloudflare R2.

For each non-photocard module, walks the detail/copy table's `cover_image_url`
column. Any value that isn't already an R2 URL is handled:

  * Local path ('/images/library/...')  -> open from disk, resize, upload
  * Remote URL ('https://tmdb...', etc)  -> download, resize, upload

Then the column is rewritten to the R2 URL. Admin's desktop + mobile both
render from R2 after the sync.

Photocards are NOT handled here — see tools/publish_catalog.py.

Image policy: long-edge resized to <= 1200 px, re-encoded as JPEG 85%
(~250-400 KB). Portrait, landscape, and square inputs are all preserved.

Idempotent:
  - Rows whose cover_image_url already points at R2_PUBLIC_BASE_URL are skipped
  - Re-runnable; incremental

Usage:
  python tools/sync_admin_images.py --all
  python tools/sync_admin_images.py --module graphicnovels
  python tools/sync_admin_images.py --all --dry-run
  python tools/sync_admin_images.py --all --limit 5
"""

import argparse
import io
import os
import shutil
import sqlite3
import sys
import urllib.request
from datetime import datetime
from pathlib import Path
from typing import Optional


SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent
DB_PATH = PROJECT_ROOT / "data" / "collectcore.db"
ENV_FILE = PROJECT_ROOT / "backend" / ".env"
DATA_ROOT = PROJECT_ROOT

RESIZE_LONG_EDGE = 1200
JPEG_QUALITY = 85

# module_code -> (table, primary_key_col, url_col, r2_prefix)
# r2_prefix matches backend/file_helpers.py COVER_DIRS layout.
MODULES = {
    "graphicnovels": ("tbl_graphicnovel_details", "item_id", "cover_image_url", "gn"),
    "music":         ("tbl_music_release_details", "item_id", "cover_image_url", "music"),
    "videogames":    ("tbl_game_details", "item_id", "cover_image_url", "videogames"),
    "video":         ("tbl_video_details", "item_id", "cover_image_url", "video"),
    "boardgames":    ("tbl_boardgame_details", "item_id", "cover_image_url", "boardgames"),
    "ttrpg":         ("tbl_ttrpg_details", "item_id", "cover_image_url", "ttrpg"),
    "books":         ("tbl_book_copies", "copy_id", "cover_image_url", "books"),
}


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


def resize_to_jpeg(data: bytes) -> bytes:
    from PIL import Image

    with Image.open(io.BytesIO(data)) as im:
        if im.mode not in ("RGB", "L"):
            im = im.convert("RGB")
        w, h = im.size
        long_edge = max(w, h)
        if long_edge > RESIZE_LONG_EDGE:
            scale = RESIZE_LONG_EDGE / long_edge
            im = im.resize((int(w * scale), int(h * scale)), Image.Resampling.LANCZOS)
        out = io.BytesIO()
        im.save(out, format="JPEG", quality=JPEG_QUALITY, optimize=True)
        return out.getvalue()


def fetch_source_bytes(url: str) -> Optional[bytes]:
    """Resolve a cover_image_url to raw image bytes."""
    if url.startswith("http://") or url.startswith("https://"):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "CollectCore/admin-sync"})
            with urllib.request.urlopen(req, timeout=15) as resp:
                return resp.read()
        except Exception as e:
            print(f"[warn] download failed: {url} ({e})")
            return None

    rel = url.lstrip("/")
    path = DATA_ROOT / rel
    if not path.is_file():
        print(f"[warn] local file missing: {path}")
        return None
    return path.read_bytes()


def backup_db(db_path: Path) -> Path:
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup = db_path.with_name(f"collectcore_pre_admin_sync_{ts}.db")
    shutil.copy2(db_path, backup)
    print(f"[backup] {backup}")
    return backup


def sync_module(
    conn: sqlite3.Connection,
    s3,
    bucket: str,
    public_base: str,
    module_code: str,
    limit: Optional[int],
    dry_run: bool,
) -> tuple[int, int, int]:
    """Returns (uploaded, skipped_already_hosted, failed) for this module."""
    table, pk_col, url_col, prefix = MODULES[module_code]

    r2_prefix_url = f"{public_base.rstrip('/')}/admin/images/{prefix}/"

    rows = conn.execute(
        f"""
        SELECT {pk_col}, {url_col}
        FROM {table}
        WHERE {url_col} IS NOT NULL AND {url_col} != ''
        ORDER BY {pk_col}
        """
    ).fetchall()

    uploaded = 0
    skipped = 0
    failed = 0
    processed = 0

    for pk, url in rows:
        if limit and processed >= limit:
            break
        if url.startswith(r2_prefix_url):
            skipped += 1
            continue
        processed += 1

        key = f"admin/images/{prefix}/{prefix}_{pk:06d}.jpg"
        hosted_url = f"{public_base.rstrip('/')}/{key}"

        if dry_run:
            print(f"[dry-run] {module_code} {pk_col}={pk}: {url[:80]!r} -> s3://{bucket}/{key}")
            uploaded += 1
            continue

        data = fetch_source_bytes(url)
        if data is None:
            failed += 1
            continue

        try:
            body = resize_to_jpeg(data)
        except Exception as e:
            print(f"[warn] resize failed for {module_code} {pk_col}={pk}: {e}")
            failed += 1
            continue

        try:
            s3.put_object(
                Bucket=bucket,
                Key=key,
                Body=body,
                ContentType="image/jpeg",
                CacheControl="public, max-age=31536000, immutable",
            )
        except Exception as e:
            print(f"[warn] upload failed for {module_code} {pk_col}={pk}: {e}")
            failed += 1
            continue

        conn.execute(
            f"UPDATE {table} SET {url_col} = ? WHERE {pk_col} = ?",
            (hosted_url, pk),
        )
        uploaded += 1

    return uploaded, skipped, failed


def main() -> int:
    p = argparse.ArgumentParser(description="Sync admin cover images to R2.")
    g = p.add_mutually_exclusive_group(required=True)
    g.add_argument("--all", action="store_true", help="Process every non-photocard module")
    g.add_argument("--module", choices=list(MODULES.keys()),
                   help="Process a single module")
    p.add_argument("--limit", type=int, help="Cap rows per module (testing)")
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

    modules = list(MODULES.keys()) if args.all else [args.module]

    conn = sqlite3.connect(str(DB_PATH))
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        grand_up = grand_skip = grand_fail = 0
        for m in modules:
            up, sk, fa = sync_module(conn, s3, bucket, public_base, m, args.limit, args.dry_run)
            print(f"[{m}] uploaded={up} skipped={sk} failed={fa}")
            grand_up += up
            grand_skip += sk
            grand_fail += fa
            if not args.dry_run:
                conn.commit()
        print(
            f"[done] totals: uploaded={grand_up} already-hosted={grand_skip} failed={grand_fail}"
        )
    finally:
        conn.close()
    return 0 if grand_fail == 0 else 3


if __name__ == "__main__":
    sys.exit(main())
