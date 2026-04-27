"""
Publish non-photocard cover images from Railway local storage / external URLs
to Cloudflare R2.

Backend-side equivalent of `tools/sync_admin_images.py`. Used by the
`POST /admin/publish-admin-images` endpoint so the admin can sweep newly-added
covers (uploaded from any device, including phone) to R2 from the admin UI
without dev-machine sync + CLI invocation.

The CLI script remains for offline/automation use; this module is the
production path.

Per row across the 7 non-photocard modules:
  1. Read `cover_image_url`.
     - If already on our R2 base, skip.
     - If a local path ('/images/library/...'), open from disk.
     - If an external URL (TMDB, Discogs, etc.), download.
  2. Resize to <= 1200px long-edge JPEG q85 in memory.
  3. Upload to admin/images/{prefix}/{prefix}_{pk:06d}.jpg.
  4. Rewrite cover_image_url to the R2 URL.

No catalog_version bump — these modules don't participate in guest sync.

Idempotent: rows already pointing at our R2 prefix are skipped.
"""

import io
import logging
import os
import sqlite3
import urllib.request
from typing import Optional

from db import DB_PATH


logger = logging.getLogger("collectcore.admin_image_publisher")

RESIZE_LONG_EDGE = 1200
JPEG_QUALITY = 85

# module_code -> (table, primary_key_col, url_col, r2_prefix)
# Mirrors tools/sync_admin_images.py MODULES and backend/file_helpers.py COVER_DIRS.
MODULES = {
    "graphicnovels": ("tbl_graphicnovel_details", "item_id", "cover_image_url", "gn"),
    "music":         ("tbl_music_release_details", "item_id", "cover_image_url", "music"),
    "videogames":    ("tbl_game_details", "item_id", "cover_image_url", "videogames"),
    "video":         ("tbl_video_details", "item_id", "cover_image_url", "video"),
    "boardgames":    ("tbl_boardgame_details", "item_id", "cover_image_url", "boardgames"),
    "ttrpg":         ("tbl_ttrpg_details", "item_id", "cover_image_url", "ttrpg"),
    "books":         ("tbl_book_copies", "copy_id", "cover_image_url", "books"),
}


def _make_r2_client():
    import boto3
    from botocore.config import Config

    endpoint = _require_env("R2_ENDPOINT")
    key = _require_env("R2_ACCESS_KEY_ID")
    secret = _require_env("R2_SECRET_ACCESS_KEY")

    return boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=key,
        aws_secret_access_key=secret,
        region_name="auto",
        config=Config(signature_version="s3v4"),
    )


def _require_env(name: str) -> str:
    val = os.environ.get(name, "").strip()
    if not val:
        raise RuntimeError(f"Required env var {name} is not set")
    return val


def _resize_to_jpeg(src_bytes: bytes) -> bytes:
    from PIL import Image

    with Image.open(io.BytesIO(src_bytes)) as im:
        if im.mode not in ("RGB", "L"):
            im = im.convert("RGB")
        w, h = im.size
        long_edge = max(w, h)
        if long_edge > RESIZE_LONG_EDGE:
            scale = RESIZE_LONG_EDGE / long_edge
            im = im.resize(
                (int(w * scale), int(h * scale)), Image.Resampling.LANCZOS
            )
        buf = io.BytesIO()
        im.save(buf, format="JPEG", quality=JPEG_QUALITY, optimize=True)
        return buf.getvalue()


def _fetch_source_bytes(url: str) -> Optional[bytes]:
    """Return raw image bytes for a cover_image_url. None on failure."""
    if url.startswith("http://") or url.startswith("https://"):
        try:
            req = urllib.request.Request(
                url, headers={"User-Agent": "CollectCore/admin-publish"}
            )
            with urllib.request.urlopen(req, timeout=15) as resp:
                return resp.read()
        except Exception as exc:  # noqa: BLE001
            logger.warning("download failed: %s (%s)", url, exc)
            return None

    # Local path. file_helpers.IMAGES_DIR.parent == DATA_ROOT, but the CLI
    # equivalent uses project-root-relative paths and the URL is stored as
    # "/images/library/..." with a leading slash. Strip and resolve under
    # DATA_ROOT.
    from file_helpers import DATA_ROOT
    rel = url.lstrip("/")
    path = (DATA_ROOT / rel).resolve()
    if not path.is_file():
        logger.warning("local file missing: %s", path)
        return None
    return path.read_bytes()


def _publish_module(
    conn: sqlite3.Connection,
    s3,
    bucket: str,
    public_base: str,
    module_code: str,
) -> dict:
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
    skipped_hosted = 0
    failed = 0
    errors = []

    for pk, url in rows:
        if url.startswith(r2_prefix_url):
            skipped_hosted += 1
            continue

        data = _fetch_source_bytes(url)
        if data is None:
            failed += 1
            errors.append({"pk": pk, "stage": "fetch", "url": url[:120]})
            continue

        try:
            body = _resize_to_jpeg(data)
        except Exception as exc:  # noqa: BLE001
            logger.warning("resize failed for %s pk=%s: %s", module_code, pk, exc)
            failed += 1
            errors.append({"pk": pk, "stage": "resize", "error": str(exc)})
            continue

        key = f"admin/images/{prefix}/{prefix}_{pk:06d}.jpg"
        hosted_url = f"{public_base.rstrip('/')}/{key}"

        try:
            s3.put_object(
                Bucket=bucket,
                Key=key,
                Body=body,
                ContentType="image/jpeg",
                CacheControl="public, max-age=31536000, immutable",
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("upload failed for %s pk=%s: %s", module_code, pk, exc)
            failed += 1
            errors.append({"pk": pk, "stage": "upload", "error": str(exc)})
            continue

        conn.execute(
            f"UPDATE {table} SET {url_col} = ? WHERE {pk_col} = ?",
            (hosted_url, pk),
        )
        uploaded += 1

    return {
        "module": module_code,
        "uploaded": uploaded,
        "skipped_hosted": skipped_hosted,
        "failed": failed,
        "errors": errors,
    }


def publish_pending() -> dict:
    """
    Sweep all non-photocard cover images that aren't already on R2.
    Returns a per-module + grand-total summary dict.
    """
    public_base = _require_env("R2_PUBLIC_BASE_URL").rstrip("/")
    bucket = _require_env("R2_BUCKET")
    s3 = _make_r2_client()

    conn = sqlite3.connect(str(DB_PATH))
    try:
        modules = []
        for module_code in MODULES:
            try:
                summary = _publish_module(conn, s3, bucket, public_base, module_code)
            except sqlite3.OperationalError as exc:
                # Table missing (module not yet migrated, dev-only state, etc.)
                logger.warning("skipping %s: %s", module_code, exc)
                summary = {
                    "module": module_code,
                    "uploaded": 0,
                    "skipped_hosted": 0,
                    "failed": 0,
                    "errors": [{"stage": "table_missing", "error": str(exc)}],
                }
            modules.append(summary)
        conn.commit()
    finally:
        conn.close()

    total_uploaded = sum(m["uploaded"] for m in modules)
    total_skipped = sum(m["skipped_hosted"] for m in modules)
    total_failed = sum(m["failed"] for m in modules)

    logger.info(
        "Admin image publish: uploaded=%d skipped_hosted=%d failed=%d",
        total_uploaded, total_skipped, total_failed,
    )
    return {
        "total_uploaded": total_uploaded,
        "total_skipped_hosted": total_skipped,
        "total_failed": total_failed,
        "modules": modules,
    }
