"""
Shared file and path helpers used across multiple router modules.

Centralizes path constants (APP_ROOT, DATA_ROOT, IMAGES_DIR, etc.)
and file operations (attachment cleanup, cover download/staging).
"""

import os
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Optional

from sqlalchemy import text

# ---------- Paths ----------
APP_ROOT = Path(__file__).resolve().parents[1]

_data_root_env = os.environ.get("COLLECTCORE_DATA_DIR")
DATA_ROOT = Path(_data_root_env) if _data_root_env else APP_ROOT

IMAGES_DIR = DATA_ROOT / "images"
INBOX_DIR = IMAGES_DIR / "inbox"
LIBRARY_DIR = IMAGES_DIR / "library"

COVER_DIRS: dict[str, Path] = {
    "books": LIBRARY_DIR / "books",
    "gn": LIBRARY_DIR / "gn",
    "videogames": LIBRARY_DIR / "videogames",
    "music": LIBRARY_DIR / "music",
    "video": LIBRARY_DIR / "video",
    "boardgames": LIBRARY_DIR / "boardgames",
    "ttrpg": LIBRARY_DIR / "ttrpg",
}


# ---------- Attachment / file cleanup ----------

def delete_attachment_files(db, item_id: int) -> list[str]:
    """Collect attachment file paths for an item, to be deleted after DB commit."""
    rows = db.execute(
        text("SELECT file_path FROM tbl_attachments WHERE item_id = :id"),
        {"id": item_id},
    ).fetchall()
    return [r[0] for r in rows if r[0]]


def collect_cover_file(db, detail_table: str, item_id: int) -> list[str]:
    """Collect a local cover_image_url from a detail table, if it points to a local file."""
    row = db.execute(
        text(f"SELECT cover_image_url FROM {detail_table} WHERE item_id = :id"),
        {"id": item_id},
    ).fetchone()
    if row and row[0] and row[0].startswith("/images/"):
        return [row[0].lstrip("/")]
    return []


def remove_files(file_paths: list[str]) -> None:
    """Delete image files from disk. Silently skips missing files."""
    for fp in file_paths:
        full = DATA_ROOT / fp
        if full.is_file():
            full.unlink()


# ---------- Cover download / staging ----------

def download_cover(url: str, module_code: str, item_id: int) -> Optional[str]:
    """Download a cover image, save locally, return the /images/… path."""
    cover_dir = COVER_DIRS.get(module_code)
    if not cover_dir:
        return None
    MIN_BYTES = 2048
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "CollectCore/1.0"})
        with urllib.request.urlopen(req, timeout=12) as resp:
            content_type = resp.headers.get("Content-Type", "image/jpeg")
            data = resp.read()
        if len(data) < MIN_BYTES:
            return None
        if "png" in content_type:
            ext = "png"
        elif "webp" in content_type:
            ext = "webp"
        elif "gif" in content_type:
            ext = "gif"
        else:
            ext = "jpg"
        filename = f"{module_code}_{item_id:06d}.{ext}"
        cover_dir.mkdir(parents=True, exist_ok=True)
        (cover_dir / filename).write_bytes(data)
        return f"/images/library/{module_code}/{filename}"
    except Exception:
        return None


def finalize_staged_cover(staged_path: str, module_code: str, item_id: int) -> Optional[str]:
    """Rename a staged cover upload to its final name based on item_id."""
    cover_dir = COVER_DIRS.get(module_code)
    if not cover_dir:
        return None
    try:
        src = DATA_ROOT / staged_path.lstrip("/")
        if not src.is_file():
            return None
        ext = src.suffix.lstrip(".")
        filename = f"{module_code}_{item_id:06d}.{ext}"
        dest = cover_dir / filename
        src.rename(dest)
        return f"/images/library/{module_code}/{filename}"
    except Exception:
        return None


def resolve_cover_url(url: Optional[str], module_code: str, item_id: int) -> Optional[str]:
    """Given a cover URL (external http, staged local, or final local), ensure it's local.

    - http/https URLs are downloaded
    - Staged paths (/images/library/{module}/staging_*) are renamed to final
    - Already-final local paths (/images/library/...) are left as-is
    Returns the final local path or the original value if nothing changed.
    """
    if not url:
        return url
    if url.startswith("http://") or url.startswith("https://"):
        local = download_cover(url, module_code, item_id)
        return local if local else url
    if "/staging_" in url:
        local = finalize_staged_cover(url, module_code, item_id)
        return local if local else url
    return url
