"""
export_gn_backup.py

Creates a CollectCore-compatible backup ZIP containing only Graphic Novel data.
Intended for restoring the distributed copy (which uses GN as its only active module).

Steps:
1. Download Amazon thumbnail images for all Wanted items → save locally in dev
2. Update dev DB cover_image_url to local paths
3. Build export DB from original backup + 209 Wanted items (source schema IDs)
4. Package export DB + all 246 images into a restore-compatible ZIP
"""

import sqlite3
import shutil
import zipfile
import tempfile
import urllib.request
import time
from datetime import datetime
from pathlib import Path

BACKUP_ZIP   = Path(__file__).parents[1] / "docs" / "collectcore_backup_20260413_145737.zip"
DEV_DB       = Path(__file__).parents[1] / "data" / "collectcore.db"
IMAGES_DIR   = Path(__file__).parents[1] / "images" / "library" / "gn"
OUTPUT_DIR   = Path(__file__).parents[1] / "docs"

# Source (distributed) schema constants
SRC_COLLECTION_TYPE_ID = 1
SRC_WANTED_STATUS_ID   = 2

# top_level_category_id: dev → source
DEV_TO_SRC_TOP_CAT = {5: 1, 6: 2, 7: 3}

# Dev constants
DEV_COLLECTION_TYPE_ID = 3
DEV_WANTED_STATUS_ID   = 2

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    )
}


def download_image(url: str, dest: Path) -> bool:
    """Download url to dest. Returns True on success."""
    try:
        req = urllib.request.Request(url, headers=HEADERS)
        with urllib.request.urlopen(req, timeout=15) as resp:
            dest.write_bytes(resp.read())
        return True
    except Exception as e:
        print(f"    WARN: download failed for {url}: {e}")
        return False


def main():
    IMAGES_DIR.mkdir(parents=True, exist_ok=True)

    # Copy DB to /tmp (native Linux FS) before opening — avoids 9p disk I/O errors
    # when the backend server has the file open on the Windows-mounted drive
    import subprocess
    dev_copy = Path("/tmp/dev_export_copy.db")
    subprocess.run(
        ["cp", "-f", str(DEV_DB), str(dev_copy)],
        check=True
    )
    dev = sqlite3.connect(str(dev_copy))
    dev.row_factory = sqlite3.Row

    # =========================================================
    # STEP 1: Download Amazon images for all Wanted items
    # =========================================================
    wanted_rows = dev.execute(
        """SELECT i.item_id, g.title, g.cover_image_url
           FROM tbl_items i JOIN tbl_graphicnovel_details g ON g.item_id=i.item_id
           WHERE i.collection_type_id=? AND i.ownership_status_id=?
           ORDER BY i.item_id""",
        (DEV_COLLECTION_TYPE_ID, DEV_WANTED_STATUS_ID)
    ).fetchall()

    print(f"Downloading images for {len(wanted_rows)} Wanted items...")
    downloaded = 0
    skipped    = 0
    failed     = []

    for row in wanted_rows:
        item_id   = row["item_id"]
        amazon_url = row["cover_image_url"]
        dest      = IMAGES_DIR / f"gn_{item_id:06d}.jpg"

        if dest.exists():
            skipped += 1
            continue

        if not amazon_url or not amazon_url.startswith("http"):
            print(f"  SKIP (no URL): [{item_id}] {row['title']}")
            failed.append(item_id)
            continue

        # Use a larger image size — replace SS135 with SS300 for better quality
        url = amazon_url.replace("._SS135_.", "._SS300_.")

        if download_image(url, dest):
            downloaded += 1
            if downloaded % 25 == 0:
                print(f"  ... {downloaded} downloaded")
        else:
            failed.append(item_id)
        time.sleep(0.1)   # polite delay

    print(f"  Downloaded: {downloaded}  |  Already existed: {skipped}  |  Failed: {len(failed)}")

    # =========================================================
    # STEP 2: Update dev DB — set cover_image_url to local path
    #         for any item whose image now exists
    # =========================================================
    print("\nUpdating dev DB cover_image_url to local paths...")
    updated = 0
    for row in wanted_rows:
        item_id = row["item_id"]
        local_path = f"/images/library/gn/gn_{item_id:06d}.jpg"
        img_file   = IMAGES_DIR / f"gn_{item_id:06d}.jpg"

        if img_file.exists() and row["cover_image_url"] != local_path:
            dev.execute(
                "UPDATE tbl_graphicnovel_details SET cover_image_url=? WHERE item_id=?",
                (local_path, item_id)
            )
            updated += 1

    dev.commit()
    print(f"  Updated {updated} rows in dev copy")

    # Write the URL updates back to the real dev DB
    print("  Writing cover_image_url updates back to live dev DB...")
    live_dev = sqlite3.connect(str(DEV_DB))
    live_dev.row_factory = sqlite3.Row
    live_updated = 0
    for row in wanted_rows:
        item_id    = row["item_id"]
        local_path = f"/images/library/gn/gn_{item_id:06d}.jpg"
        img_file   = IMAGES_DIR / f"gn_{item_id:06d}.jpg"
        if img_file.exists():
            live_dev.execute(
                "UPDATE tbl_graphicnovel_details SET cover_image_url=? WHERE item_id=?",
                (local_path, item_id)
            )
            live_updated += 1
    live_dev.commit()
    live_dev.close()
    print(f"  Updated {live_updated} rows in live dev DB")

    # Re-fetch with updated URLs
    wanted_rows = dev.execute(
        """SELECT i.item_id, i.top_level_category_id, i.ownership_status_id,
                  i.reading_status_id, i.notes, i.created_at, i.updated_at,
                  g.title, g.title_sort, g.description, g.publisher_id,
                  g.format_type_id, g.era_id, g.series_name, g.series_number,
                  g.series_sort, g.source_series_name, g.start_issue, g.end_issue,
                  g.issue_notes, g.page_count, g.published_date, g.isbn_13, g.isbn_10,
                  g.cover_image_url, g.edition_notes, g.star_rating, g.review,
                  g.api_source, g.external_work_id
           FROM tbl_items i
           JOIN tbl_graphicnovel_details g ON g.item_id = i.item_id
           WHERE i.collection_type_id=? AND i.ownership_status_id=?
           ORDER BY i.item_id""",
        (DEV_COLLECTION_TYPE_ID, DEV_WANTED_STATUS_ID)
    ).fetchall()

    dev_writers_by_id = {
        r["writer_id"]: r["writer_name"]
        for r in dev.execute("SELECT writer_id, writer_name FROM lkup_graphicnovel_writers")
    }
    dev_item_ids = [r["item_id"] for r in wanted_rows]
    placeholders = ",".join("?" * len(dev_item_ids))
    dev_writer_assignments = {}
    for row in dev.execute(
        f"SELECT item_id, writer_id, writer_order FROM xref_graphicnovel_item_writers "
        f"WHERE item_id IN ({placeholders}) ORDER BY item_id, writer_order",
        dev_item_ids
    ):
        dev_writer_assignments.setdefault(row["item_id"], []).append(
            (dev_writers_by_id[row["writer_id"]], row["writer_order"])
        )

    # =========================================================
    # STEP 3: Build export DB from original backup + Wanted items
    # =========================================================
    print("\nBuilding export DB...")
    tmp_dir = Path(tempfile.mkdtemp())
    with zipfile.ZipFile(BACKUP_ZIP) as z:
        z.extract("collectcore.db", tmp_dir)
    export_db_path = tmp_dir / "collectcore.db"

    src = sqlite3.connect(str(export_db_path))
    src.row_factory = sqlite3.Row
    src.execute("PRAGMA foreign_keys = OFF")

    # Writer merge map
    src_writer_map = {
        r["writer_name"].lower(): r["writer_id"]
        for r in src.execute("SELECT writer_id, writer_name FROM lkup_graphicnovel_writers")
    }

    def get_or_create_src_writer(name: str) -> int:
        key = name.lower()
        if key in src_writer_map:
            return src_writer_map[key]
        cur = src.execute(
            "INSERT INTO lkup_graphicnovel_writers (writer_name, is_active) VALUES (?, 1)",
            (name,)
        )
        src_writer_map[key] = cur.lastrowid
        return cur.lastrowid

    # Track dev_item_id → new src_item_id so we can rename images correctly
    dev_to_src_item_id = {}
    inserted = 0

    for item in wanted_rows:
        dev_id  = item["item_id"]
        src_cat = DEV_TO_SRC_TOP_CAT.get(item["top_level_category_id"], 3)

        cur = src.execute(
            """INSERT INTO tbl_items
               (collection_type_id, top_level_category_id, ownership_status_id,
                reading_status_id, notes, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (SRC_COLLECTION_TYPE_ID, src_cat, SRC_WANTED_STATUS_ID,
             item["reading_status_id"], item["notes"],
             item["created_at"], item["updated_at"])
        )
        new_src_id = cur.lastrowid
        dev_to_src_item_id[dev_id] = new_src_id

        # Remap cover_image_url: local dev path → local src path using new src item ID
        cover = item["cover_image_url"]
        if cover and cover.startswith("/images/library/gn/"):
            cover = f"/images/library/gn/gn_{new_src_id:06d}.jpg"

        src.execute(
            """INSERT INTO tbl_graphicnovel_details
               (item_id, title, title_sort, description, publisher_id, format_type_id,
                era_id, series_name, series_number, series_sort, source_series_name,
                start_issue, end_issue, issue_notes, page_count, published_date,
                isbn_13, isbn_10, cover_image_url, edition_notes, star_rating, review,
                api_source, external_work_id)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                new_src_id,
                item["title"], item["title_sort"], item["description"],
                item["publisher_id"], item["format_type_id"], item["era_id"],
                item["series_name"], item["series_number"], item["series_sort"],
                item["source_series_name"],
                item["start_issue"], item["end_issue"], item["issue_notes"],
                item["page_count"], item["published_date"],
                item["isbn_13"], item["isbn_10"],
                cover,
                item["edition_notes"], item["star_rating"], item["review"],
                item["api_source"], item["external_work_id"],
            )
        )

        for writer_name, writer_order in dev_writer_assignments.get(dev_id, []):
            src_wid = get_or_create_src_writer(writer_name)
            src.execute(
                "INSERT INTO xref_graphicnovel_item_writers (item_id, writer_id, writer_order) VALUES (?,?,?)",
                (new_src_id, src_wid, writer_order)
            )

        inserted += 1

    src.commit()

    total = src.execute(
        "SELECT COUNT(*) FROM tbl_items WHERE collection_type_id=?",
        (SRC_COLLECTION_TYPE_ID,)
    ).fetchone()[0]
    print(f"  Export DB: {total} total GN items ({inserted} Wanted inserted)")

    src.close()

    # =========================================================
    # STEP 4: Build the ZIP
    # =========================================================
    timestamp  = datetime.now().strftime("%Y%m%d_%H%M%S")
    output_zip = OUTPUT_DIR / f"collectcore_gn_export_{timestamp}.zip"

    print(f"\nBuilding backup ZIP...")
    img_count = 0

    with zipfile.ZipFile(output_zip, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        # Database
        zf.write(export_db_path, "collectcore.db")

        # Owned item images — pull directly from the original backup ZIP
        # (they live there as gn_000001.jpg – gn_000037.jpg, the correct source IDs)
        with zipfile.ZipFile(BACKUP_ZIP) as src_zip:
            for entry in src_zip.namelist():
                if entry.startswith("images/library/gn/") and entry.endswith(".jpg"):
                    zf.writestr(entry, src_zip.read(entry))
                    img_count += 1

        # Wanted item images — downloaded to IMAGES_DIR under dev IDs;
        # rename to source IDs (38 onwards) in the ZIP
        for dev_id, src_id in dev_to_src_item_id.items():
            dev_img = IMAGES_DIR / f"gn_{dev_id:06d}.jpg"
            if dev_img.exists():
                zf.write(dev_img, f"images/library/gn/gn_{src_id:06d}.jpg")
                img_count += 1

    print(f"  Added database + {img_count} images")

    shutil.rmtree(tmp_dir)
    dev.close()

    print(f"\nOutput: {output_zip}")
    print(f"Size:   {output_zip.stat().st_size / 1024 / 1024:.2f} MB")

    if failed:
        print(f"\nNote: {len(failed)} images failed to download (no image in ZIP for those items):")
        for fid in failed:
            print(f"  item_id {fid}")

    print("\nDone. Import via Admin > Restore in the distributed app.")


if __name__ == "__main__":
    main()
