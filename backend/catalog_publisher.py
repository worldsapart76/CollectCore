"""
Publish photocard images from Railway local storage to Cloudflare R2.

Backend-side equivalent of `tools/publish_catalog.py`. Used by the
`POST /admin/publish-catalog` endpoint so the user can sweep newly-uploaded
images to R2 from the admin UI without dev-machine sync + CLI invocation.

The CLI script remains for offline/automation use; this module is the
production path.

Per attachment with storage_type='local':
  1. Resize to 600x924 JPEG q80 in memory
  2. Upload to R2 at catalog/images/{catalog_item_id}_{f|b}.jpg
  3. Rewrite tbl_attachments: storage_type='hosted', file_path=<R2 URL>,
     mime_type='image/jpeg'

After all uploads complete, bumps catalog_version (global MAX + 1) on every
touched item so guests pick up the new R2 URLs via the next /catalog/delta.

Idempotent: rows with storage_type='hosted' are skipped — no re-upload,
no version bump.
"""

import io
import logging
import os
import re
import sqlite3
from typing import Optional

from db import DB_PATH
from file_helpers import IMAGES_DIR


logger = logging.getLogger("collectcore.catalog_publisher")

PHOTOCARDS_CODE = "photocards"
CATALOG_PREFIX = "catalog/images"
RESIZE_MAX = (600, 924)
JPEG_QUALITY = 80


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
        im.thumbnail(RESIZE_MAX, Image.Resampling.LANCZOS)
        buf = io.BytesIO()
        im.save(buf, format="JPEG", quality=JPEG_QUALITY, optimize=True)
        return buf.getvalue()


def _assign_catalog_item_id(
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


def publish_pending(limit: Optional[int] = None) -> dict:
    """
    Sweep all photocard attachments with storage_type='local' to R2.
    Returns a summary dict.

    `limit` caps how many ITEMS (not attachments) get processed in one
    call — useful if the admin wants to publish in chunks. None = all.
    """
    public_base = _require_env("R2_PUBLIC_BASE_URL").rstrip("/")
    bucket = _require_env("R2_BUCKET")
    s3 = _make_r2_client()

    conn = sqlite3.connect(str(DB_PATH))
    try:
        photocards_id = conn.execute(
            "SELECT collection_type_id FROM lkup_collection_types WHERE collection_type_code = ?",
            (PHOTOCARDS_CODE,),
        ).fetchone()[0]

        sql = """
            SELECT DISTINCT i.item_id
            FROM tbl_items i
            WHERE i.collection_type_id = ?
              AND EXISTS (
                  SELECT 1 FROM tbl_attachments a
                  WHERE a.item_id = i.item_id
                    AND a.attachment_type IN ('front', 'back')
                    AND a.storage_type = 'local'
              )
            ORDER BY i.item_id
        """
        if limit:
            sql += f" LIMIT {int(limit)}"
        item_ids = [r[0] for r in conn.execute(sql, (photocards_id,)).fetchall()]

        uploaded_total = 0
        skipped_total = 0
        missing_files = []
        touched_items = []

        for item_id in item_ids:
            catalog_item_id = _assign_catalog_item_id(conn, item_id, photocards_id)
            attachments = conn.execute(
                """
                SELECT attachment_id, attachment_type, file_path, storage_type
                FROM tbl_attachments
                WHERE item_id = ? AND attachment_type IN ('front', 'back')
                ORDER BY attachment_type
                """,
                (item_id,),
            ).fetchall()

            item_uploaded = 0
            for att_id, atype, file_path, storage_type in attachments:
                if storage_type == "hosted":
                    skipped_total += 1
                    continue

                # file_path is stored as "images/library/xxx.jpg" (relative to
                # DATA_ROOT). IMAGES_DIR is DATA_ROOT/images so the actual file
                # is at DATA_ROOT/file_path.
                src = (IMAGES_DIR.parent / file_path).resolve()
                if not src.is_file():
                    logger.warning("item=%d %s file missing on disk: %s", item_id, atype, file_path)
                    missing_files.append({"item_id": item_id, "type": atype, "path": file_path})
                    continue

                with open(src, "rb") as f:
                    raw = f.read()
                body = _resize_to_jpeg(raw)

                side = "f" if atype == "front" else "b"
                key = f"{CATALOG_PREFIX}/{catalog_item_id}_{side}.jpg"
                hosted_url = f"{public_base}/{key}"

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
                uploaded_total += 1
                item_uploaded += 1

            if item_uploaded > 0:
                touched_items.append(item_id)

        # Bump catalog_version on touched items so the guest delta sync picks
        # up the new R2 URLs on its next call.
        new_version = None
        if touched_items:
            cur = conn.execute("SELECT COALESCE(MAX(catalog_version), 0) FROM tbl_items").fetchone()[0]
            new_version = (cur or 0) + 1
            placeholders = ",".join("?" * len(touched_items))
            conn.execute(
                f"UPDATE tbl_items SET catalog_version = ? WHERE item_id IN ({placeholders})",
                (new_version, *touched_items),
            )

        conn.commit()
    finally:
        conn.close()

    logger.info(
        "Published %d attachments across %d items (skipped %d hosted, %d missing files)",
        uploaded_total, len(touched_items), skipped_total, len(missing_files),
    )
    return {
        "uploaded": uploaded_total,
        "skipped_hosted": skipped_total,
        "items_touched": len(touched_items),
        "items_scanned": len(item_ids),
        "missing_files": missing_files,
        "new_catalog_version": new_version,
    }
