"""
Thumbnail cache backing the offline card book PDF.

Phase 1 of `docs/photocard_offline_card_book_plan.md`. One small JPEG per
photocard front, cached on the Railway volume at DATA_ROOT/pdf_thumbs/, so PDF
generation is a byte-copy of cached files rather than ~11.8k R2 fetches. That
distinction is the whole point: Cloudflare kills a proxied request at ~100s, and
a cold generation would never finish inside it.

Cache key is `{item_id}_{sha1(file_path)[:10]}.jpg`. Keying on the image URL —
rather than image_version — is deliberate: prod holds BOTH the old unversioned
R2 key (`skz_000003_f.jpg`) and the newer versioned one
(`skz_000003_f_v2.jpg`) that _replace_image introduced, so the URL is the only
identifier that always changes when the picture changes. A replaced image lands
on a new filename instead of serving a stale thumbnail; the old file is simply
left behind (sweep with --prune).

Reads come from R2 via boto3, NOT from images.collectcoreapp.com: that domain
403s non-browser user agents (measured 2026-09-10, 360/360 requests). Dev sets
COLLECTCORE_DISABLE_R2=1 and so has no R2 client at all, and falls back to the
public URL with a browser UA. Both paths are read-only — this module never
writes to R2.

CLI (backfill):
    python pdf_thumbs.py                 # fill what's missing
    python pdf_thumbs.py --limit 200     # try a slice first
    python pdf_thumbs.py --force         # rebuild every thumbnail
    python pdf_thumbs.py --prune         # delete thumbnails nothing points at
"""

import argparse
import hashlib
import io
import logging
import os
import sys
import threading
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Optional

from db import raw_connect
from file_helpers import DATA_ROOT

logger = logging.getLogger("collectcore.pdf_thumbs")


def _load_env_file() -> None:
    """Mirror of main.py's loader (same setdefault semantics, no dependency).

    Needed because this module also runs as a standalone CLI, where nothing has
    booted the app. Without it COLLECTCORE_DISABLE_R2 is unset and the dev
    kill-switch silently stops guarding the production bucket.
    """
    env_file = Path(__file__).parent / ".env"
    if not env_file.exists():
        return
    for line in env_file.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip())


_load_env_file()

THUMB_DIR = DATA_ROOT / "pdf_thumbs"

# Card art is 600x924 (RESIZE_MAX in catalog_publisher), so a 180px width lands
# at ~277px tall — about 5-8KB at q70, and still legible on a phone at the grid
# density the PDF uses. Tune after the carry-it-for-a-day test in the plan.
THUMB_WIDTH = 180
JPEG_QUALITY = 70

PHOTOCARDS_CODE = "photocards"

# Cloudflare fronts images.collectcoreapp.com and blocks scripty user agents.
# Only used on the dev fallback path; prod reads the bucket directly.
_BROWSER_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/128.0 Safari/537.36"
)

_local = threading.local()


# ---------- cache paths ----------

def thumb_name(item_id: int, file_path: str) -> str:
    digest = hashlib.sha1(file_path.encode("utf-8")).hexdigest()[:10]
    return f"{item_id}_{digest}.jpg"


def thumb_path(item_id: int, file_path: str) -> Path:
    return THUMB_DIR / thumb_name(item_id, file_path)


# ---------- fetching source bytes ----------

def _r2_key_from_url(file_path: str) -> str:
    """The object key is the URL path, minus the public base's own prefix."""
    from urllib.parse import urlparse

    public_base = os.environ.get("R2_PUBLIC_BASE_URL", "").strip().rstrip("/")
    if public_base and file_path.startswith(public_base):
        return file_path[len(public_base):].lstrip("/")
    return urlparse(file_path).path.lstrip("/")


def _s3():
    """One client per thread. botocore clients are thread-safe for calls, but a
    per-thread client keeps connection pools from serializing the backfill."""
    client = getattr(_local, "s3", None)
    if client is None:
        # Import through catalog_publisher on purpose: _make_r2_client is the
        # central chokepoint that refuses to build a client when the dev
        # kill-switch is set, so going around it would risk touching the
        # production bucket from dev.
        from catalog_publisher import _make_r2_client

        client = _make_r2_client()
        _local.s3 = client
    return client


def _fetch_hosted(file_path: str) -> bytes:
    from catalog_publisher import _r2_disabled

    if _r2_disabled():
        # Dev: no R2 client exists. The public URL serves the same bytes.
        req = urllib.request.Request(file_path, headers={"User-Agent": _BROWSER_UA})
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.read()

    bucket = os.environ.get("R2_BUCKET", "").strip()
    if not bucket:
        raise RuntimeError("R2_BUCKET is not set")
    obj = _s3().get_object(Bucket=bucket, Key=_r2_key_from_url(file_path))
    return obj["Body"].read()


def _fetch_local(file_path: str) -> bytes:
    full = DATA_ROOT / file_path.lstrip("/")
    return full.read_bytes()


def _fetch_source(file_path: str, storage_type: str) -> bytes:
    if storage_type == "hosted":
        return _fetch_hosted(file_path)
    return _fetch_local(file_path)


# ---------- thumbnail creation ----------

def make_thumb_bytes(src_bytes: bytes) -> bytes:
    """Downscale to THUMB_WIDTH; never upscale, and never re-encode needlessly.

    Most of the catalog is already small: a 25-image sample averaged 200px wide,
    with plenty at 100-150px. Scaling those UP to a fixed width cost ~17% more
    bytes for no added detail, and re-encoding an already-small JPEG only adds
    compression artifacts, so a small JPEG is stored exactly as it arrived.
    fpdf2 embeds JPEG bytes as-is, so whatever is cached here is what lands in
    the PDF.
    """
    from PIL import Image

    with Image.open(io.BytesIO(src_bytes)) as im:
        if im.format == "JPEG" and im.width <= THUMB_WIDTH and im.mode in ("RGB", "L"):
            return src_bytes
        if im.mode not in ("RGB", "L"):
            im = im.convert("RGB")
        im.thumbnail((THUMB_WIDTH, 10 ** 6), Image.Resampling.LANCZOS)
        buf = io.BytesIO()
        im.save(buf, format="JPEG", quality=JPEG_QUALITY, optimize=True)
        return buf.getvalue()


def ensure_thumb(item_id: int, file_path: str, storage_type: str, force: bool = False) -> str:
    """Build one thumbnail if it is missing. Returns 'cached', 'built' or 'failed'.

    Writes via a temp file + replace so an interrupted run can never leave a
    truncated JPEG that a later run would treat as done.
    """
    dest = thumb_path(item_id, file_path)
    if dest.exists() and not force:
        return "cached"

    try:
        data = make_thumb_bytes(_fetch_source(file_path, storage_type))
    except Exception as exc:
        logger.warning("thumb failed item_id=%s %s: %s", item_id, file_path, exc)
        return "failed"

    THUMB_DIR.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(f".tmp{os.getpid()}-{threading.get_ident()}")
    tmp.write_bytes(data)
    tmp.replace(dest)
    return "built"


# ---------- the card set ----------

def front_attachments() -> list[tuple[int, str, str]]:
    """(item_id, file_path, storage_type) for every photocard front.

    Includes non-catalog drafts: the admin book covers cards that have not been
    committed to the catalog yet.
    """
    conn = raw_connect()
    try:
        photocards_id = conn.execute(
            "SELECT collection_type_id FROM lkup_collection_types WHERE collection_type_code = ?",
            (PHOTOCARDS_CODE,),
        ).fetchone()[0]

        sql = """
            SELECT a.item_id, a.file_path, a.storage_type
            FROM tbl_attachments a
            JOIN tbl_items i ON i.item_id = a.item_id
            WHERE i.collection_type_id = ?
              AND a.attachment_type = 'front'
              AND a.file_path IS NOT NULL AND a.file_path <> ''
            ORDER BY a.item_id
        """
        return [(r[0], r[1], r[2]) for r in conn.execute(sql, [photocards_id])]
    finally:
        conn.close()


def pending_rows() -> list[tuple[int, str, str]]:
    """Fronts with no cached thumbnail yet.

    Filtering happens here rather than via SQL LIMIT so that a chunked caller
    makes progress: `LIMIT n` would hand back the same already-cached first n
    rows on every call and never reach the end of the library.
    """
    return [r for r in front_attachments() if not thumb_path(r[0], r[1]).exists()]


# ---------- backfill ----------

def _preflight(rows: list[tuple[int, str, str]]) -> str:
    """Name the source up front, and fail loudly rather than once per card."""
    from catalog_publisher import _r2_disabled

    if not any(st == "hosted" for _, _, st in rows):
        return "local files only"
    if _r2_disabled():
        return "public URLs (R2 disabled by COLLECTCORE_DISABLE_R2)"
    missing = [n for n in ("R2_BUCKET", "R2_ENDPOINT", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY")
               if not os.environ.get(n, "").strip()]
    if missing:
        raise RuntimeError(
            "R2 is enabled but these are not set: " + ", ".join(missing)
            + ". Set COLLECTCORE_DISABLE_R2=1 to read the public URLs instead."
        )
    return f"R2 bucket {os.environ['R2_BUCKET']}"


def build_all(limit: Optional[int] = None, workers: int = 8, force: bool = False,
              verbose: bool = True) -> dict:
    """Build missing thumbnails. `limit` caps the work done in THIS call, so a
    chunked caller (the admin endpoint) can stay inside Cloudflare's ~100s cap
    and resume where it left off."""
    rows = front_attachments() if force else pending_rows()
    outstanding = len(rows)
    if limit:
        rows = rows[:limit]
    if verbose:
        print(f"source: {_preflight(rows)}", flush=True)
    else:
        _preflight(rows)
    counts = {"built": 0, "cached": 0, "failed": 0}
    lock = threading.Lock()
    total = len(rows)

    def work(row):
        item_id, file_path, storage_type = row
        outcome = ensure_thumb(item_id, file_path, storage_type, force=force)
        with lock:
            counts[outcome] += 1
            done = sum(counts.values())
            if verbose and (done % 250 == 0 or done == total):
                print(f"  {done}/{total} built={counts['built']} "
                      f"cached={counts['cached']} failed={counts['failed']}", flush=True)

    if verbose:
        print(f"{total} to build this pass ({outstanding} outstanding); cache in {THUMB_DIR}",
              flush=True)
    with ThreadPoolExecutor(max_workers=workers) as ex:
        list(ex.map(work, rows))

    counts["total"] = total
    # What is still missing after this pass — the chunked caller loops until 0.
    counts["remaining"] = max(0, outstanding - counts["built"])
    counts["bytes"] = sum(p.stat().st_size for p in THUMB_DIR.glob("*.jpg")) if THUMB_DIR.exists() else 0
    return counts


def prune() -> dict:
    """Delete cached thumbnails that no current attachment points at."""
    if not THUMB_DIR.exists():
        return {"deleted": 0, "kept": 0}
    keep = {thumb_name(item_id, fp) for item_id, fp, _ in front_attachments()}
    deleted = 0
    for p in THUMB_DIR.glob("*.jpg"):
        if p.name not in keep:
            p.unlink()
            deleted += 1
    return {"deleted": deleted, "kept": len(keep)}


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    ap = argparse.ArgumentParser(description="Build the card-book thumbnail cache.")
    ap.add_argument("--limit", type=int, default=None, help="cap the work done this pass")
    ap.add_argument("--workers", type=int, default=8)
    ap.add_argument("--force", action="store_true", help="rebuild thumbnails that already exist")
    ap.add_argument("--prune", action="store_true", help="delete thumbnails nothing points at, then exit")
    args = ap.parse_args()

    if args.prune:
        print(prune())
        return 0

    counts = build_all(limit=args.limit, workers=args.workers, force=args.force)
    mb = counts["bytes"] / 1e6
    print(f"done: built={counts['built']} cached={counts['cached']} "
          f"failed={counts['failed']} of {counts['total']}; cache={mb:.1f} MB")
    return 1 if counts["failed"] else 0


if __name__ == "__main__":
    sys.exit(main())
