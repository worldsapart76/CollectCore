"""
migrate_gn_from_backup.py

Imports all Graphic Novel records from a backup ZIP into the dev database.
- Clears all existing GN data (items, details, xrefs, lookup rows)
- Remaps all IDs between source and dev schemas
- Copies and renames cover images to match new item_ids
"""

import sqlite3
import zipfile
import shutil
import os
from pathlib import Path

# --- Paths ---
BACKUP_ZIP = Path(__file__).parents[1] / "docs" / "collectcore_backup_20260413_145737.zip"
DEV_DB     = Path(__file__).parents[1] / "data" / "collectcore.db"
IMAGES_DIR = Path(__file__).parents[1] / "images" / "library" / "gn"
TMP_DIR    = Path("/tmp/cc_backup_gn")

# --- Constants from schema analysis ---
SRC_COLLECTION_TYPE_ID = 1   # GN in source DB
DEV_COLLECTION_TYPE_ID = 3   # GN in dev DB

# top_level_category_id mapping: source → dev
TOP_LEVEL_CAT_MAP = {1: 5, 2: 6, 3: 7}  # Marvel, DC, Other

def main():
    TMP_DIR.mkdir(parents=True, exist_ok=True)

    # --- Extract source DB from zip ---
    print("Extracting backup DB...")
    with zipfile.ZipFile(BACKUP_ZIP) as z:
        z.extract("collectcore.db", TMP_DIR)
        # Extract all GN images to tmp
        gn_images = [name for name in z.namelist() if name.startswith("images/library/gn/")]
        for img in gn_images:
            z.extract(img, TMP_DIR)
    print(f"  Extracted {len(gn_images)} GN images")

    src = sqlite3.connect(TMP_DIR / "collectcore.db")
    src.row_factory = sqlite3.Row
    dev = sqlite3.connect(DEV_DB)
    dev.row_factory = sqlite3.Row
    dev.execute("PRAGMA foreign_keys = OFF")

    # =========================================================
    # STEP 1: Clear all existing GN data from dev
    # =========================================================
    print("\nClearing existing GN data from dev...")
    gn_item_ids = [r["item_id"] for r in dev.execute(
        "SELECT item_id FROM tbl_items WHERE collection_type_id=?", (DEV_COLLECTION_TYPE_ID,)
    )]
    if gn_item_ids:
        ids_placeholder = ",".join("?" * len(gn_item_ids))
        for tbl in [
            "xref_graphicnovel_item_tags",
            "xref_graphicnovel_item_artists",
            "xref_graphicnovel_item_writers",
            "xref_gn_source_series",
            "tbl_graphicnovel_details",
        ]:
            cnt = dev.execute(f"DELETE FROM {tbl} WHERE item_id IN ({ids_placeholder})", gn_item_ids).rowcount
            print(f"  Deleted {cnt} rows from {tbl}")
        cnt = dev.execute(
            f"DELETE FROM tbl_items WHERE item_id IN ({ids_placeholder})", gn_item_ids
        ).rowcount
        print(f"  Deleted {cnt} rows from tbl_items")

    # Clear existing GN lookup tables (writers, artists — publishers/eras/format_types are shared seeds)
    cnt = dev.execute("DELETE FROM lkup_graphicnovel_writers").rowcount
    print(f"  Deleted {cnt} rows from lkup_graphicnovel_writers")
    cnt = dev.execute("DELETE FROM lkup_graphicnovel_artists").rowcount
    print(f"  Deleted {cnt} rows from lkup_graphicnovel_artists")

    # Delete existing GN images
    existing_imgs = list(IMAGES_DIR.glob("gn_*.jpg")) if IMAGES_DIR.exists() else []
    # Only delete images NOT referenced by remaining non-GN items (all gn_ images belong to GN module)
    for img in existing_imgs:
        img.unlink()
        print(f"  Deleted image: {img.name}")

    dev.commit()

    # =========================================================
    # STEP 2: Build lookup ID maps
    # =========================================================

    # --- Writers: insert all source writers, building src_id → dev_id map ---
    print("\nInserting GN writers...")
    writer_id_map = {}  # src writer_id → dev writer_id
    for row in src.execute("SELECT * FROM lkup_graphicnovel_writers ORDER BY writer_id"):
        cursor = dev.execute(
            "INSERT INTO lkup_graphicnovel_writers (writer_name, is_active) VALUES (?, ?)",
            (row["writer_name"], row["is_active"])
        )
        writer_id_map[row["writer_id"]] = cursor.lastrowid
    print(f"  Inserted {len(writer_id_map)} writers")

    # --- Artists: insert all source artists, building src_id → dev_id map ---
    print("Inserting GN artists...")
    artist_id_map = {}  # src artist_id → dev artist_id
    for row in src.execute("SELECT * FROM lkup_graphicnovel_artists ORDER BY artist_id"):
        cursor = dev.execute(
            "INSERT INTO lkup_graphicnovel_artists (artist_name, is_active) VALUES (?, ?)",
            (row["artist_name"], row["is_active"])
        )
        artist_id_map[row["artist_id"]] = cursor.lastrowid
    print(f"  Inserted {len(artist_id_map)} artists")

    dev.commit()

    # Publishers, eras, format_types: same IDs in both DBs — no mapping needed
    # ownership_status_id: all source GN items use 1 (Owned) — same in dev

    # =========================================================
    # STEP 3: Insert tbl_items and tbl_graphicnovel_details
    # =========================================================
    print("\nInserting GN items...")
    src_items = src.execute(
        "SELECT * FROM tbl_items WHERE collection_type_id=? ORDER BY item_id",
        (SRC_COLLECTION_TYPE_ID,)
    ).fetchall()

    item_id_map = {}  # src item_id → dev item_id

    IMAGES_DIR.mkdir(parents=True, exist_ok=True)

    for item in src_items:
        src_id = item["item_id"]

        # Map top_level_category_id
        dev_top_cat = TOP_LEVEL_CAT_MAP.get(item["top_level_category_id"])
        if dev_top_cat is None:
            print(f"  WARNING: unmapped top_level_category_id {item['top_level_category_id']} for src item {src_id}, skipping")
            continue

        # Insert into tbl_items
        cursor = dev.execute(
            """INSERT INTO tbl_items
               (collection_type_id, top_level_category_id, ownership_status_id,
                reading_status_id, notes, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (
                DEV_COLLECTION_TYPE_ID,
                dev_top_cat,
                item["ownership_status_id"],
                item["reading_status_id"],
                item["notes"],
                item["created_at"],
                item["updated_at"],
            )
        )
        dev_id = cursor.lastrowid
        item_id_map[src_id] = dev_id

        # Get source GN detail
        detail = src.execute(
            "SELECT * FROM tbl_graphicnovel_details WHERE item_id=?", (src_id,)
        ).fetchone()
        if not detail:
            print(f"  WARNING: no detail found for src item {src_id}")
            continue

        # Remap cover_image_url to use new dev item_id
        old_url = detail["cover_image_url"]
        new_url = None
        if old_url and "/images/library/gn/" in old_url:
            new_url = f"/images/library/gn/gn_{dev_id:06d}.jpg"
        elif old_url:
            new_url = old_url  # preserve external URLs as-is

        # Insert GN detail
        dev.execute(
            """INSERT INTO tbl_graphicnovel_details
               (item_id, title, title_sort, description, publisher_id, format_type_id,
                era_id, series_name, series_number, series_sort, source_series_name,
                start_issue, end_issue, issue_notes, page_count, published_date,
                isbn_13, isbn_10, cover_image_url, edition_notes, star_rating, review,
                api_source, external_work_id)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                dev_id,
                detail["title"], detail["title_sort"], detail["description"],
                detail["publisher_id"], detail["format_type_id"], detail["era_id"],
                detail["series_name"], detail["series_number"], detail["series_sort"],
                detail["source_series_name"],
                detail["start_issue"], detail["end_issue"], detail["issue_notes"],
                detail["page_count"], detail["published_date"],
                detail["isbn_13"], detail["isbn_10"],
                new_url,
                detail["edition_notes"], detail["star_rating"], detail["review"],
                detail["api_source"], detail["external_work_id"],
            )
        )

        # Copy and rename image file
        src_img_name = f"gn_{src_id:06d}.jpg"
        src_img_path = TMP_DIR / "images" / "library" / "gn" / src_img_name
        if src_img_path.exists():
            dst_img_path = IMAGES_DIR / f"gn_{dev_id:06d}.jpg"
            shutil.copy2(src_img_path, dst_img_path)

    print(f"  Inserted {len(item_id_map)} items (src IDs {min(item_id_map)} – {max(item_id_map)} → dev IDs {min(item_id_map.values())} – {max(item_id_map.values())})")
    dev.commit()

    # =========================================================
    # STEP 4: Insert xref tables
    # =========================================================
    print("\nInserting xref data...")

    # xref_gn_source_series
    count = 0
    for row in src.execute("SELECT * FROM xref_gn_source_series"):
        if row["item_id"] not in item_id_map:
            continue
        dev.execute(
            """INSERT INTO xref_gn_source_series
               (item_id, source_series_name, start_issue, end_issue, sort_order)
               VALUES (?, ?, ?, ?, ?)""",
            (item_id_map[row["item_id"]], row["source_series_name"],
             row["start_issue"], row["end_issue"], row["sort_order"])
        )
        count += 1
    print(f"  Inserted {count} rows into xref_gn_source_series")

    # xref_graphicnovel_item_writers
    count = 0
    for row in src.execute("SELECT * FROM xref_graphicnovel_item_writers"):
        if row["item_id"] not in item_id_map:
            continue
        if row["writer_id"] not in writer_id_map:
            print(f"  WARNING: unmapped writer_id {row['writer_id']}")
            continue
        dev.execute(
            """INSERT INTO xref_graphicnovel_item_writers (item_id, writer_id, writer_order)
               VALUES (?, ?, ?)""",
            (item_id_map[row["item_id"]], writer_id_map[row["writer_id"]], row["writer_order"])
        )
        count += 1
    print(f"  Inserted {count} rows into xref_graphicnovel_item_writers")

    # xref_graphicnovel_item_artists
    count = 0
    for row in src.execute("SELECT * FROM xref_graphicnovel_item_artists"):
        if row["item_id"] not in item_id_map:
            continue
        if row["artist_id"] not in artist_id_map:
            print(f"  WARNING: unmapped artist_id {row['artist_id']}")
            continue
        dev.execute(
            """INSERT INTO xref_graphicnovel_item_artists (item_id, artist_id, artist_order)
               VALUES (?, ?, ?)""",
            (item_id_map[row["item_id"]], artist_id_map[row["artist_id"]], row["artist_order"])
        )
        count += 1
    print(f"  Inserted {count} rows into xref_graphicnovel_item_artists")

    # xref_graphicnovel_item_tags (0 rows in source, included for completeness)
    count = 0
    for row in src.execute("SELECT * FROM xref_graphicnovel_item_tags"):
        if row["item_id"] not in item_id_map:
            continue
        dev.execute(
            "INSERT INTO xref_graphicnovel_item_tags (item_id, tag_id) VALUES (?, ?)",
            (item_id_map[row["item_id"]], row["tag_id"])
        )
        count += 1
    print(f"  Inserted {count} rows into xref_graphicnovel_item_tags")

    dev.commit()

    # =========================================================
    # STEP 5: Verify
    # =========================================================
    print("\n=== Verification ===")
    gn_count = dev.execute(
        "SELECT COUNT(*) as c FROM tbl_items WHERE collection_type_id=?", (DEV_COLLECTION_TYPE_ID,)
    ).fetchone()["c"]
    print(f"GN items in dev: {gn_count}")

    detail_count = dev.execute(
        "SELECT COUNT(*) as c FROM tbl_graphicnovel_details"
    ).fetchone()["c"]
    print(f"GN details in dev: {detail_count}")

    img_count = len(list(IMAGES_DIR.glob("gn_*.jpg")))
    print(f"GN images in dev: {img_count}")

    print("\nSample imported records:")
    for r in dev.execute("""
        SELECT i.item_id, g.title, g.cover_image_url, i.top_level_category_id
        FROM tbl_items i JOIN tbl_graphicnovel_details g ON g.item_id=i.item_id
        WHERE i.collection_type_id=?
        ORDER BY i.item_id LIMIT 5
    """, (DEV_COLLECTION_TYPE_ID,)):
        print(f"  [{r['item_id']}] {r['title']} | cat={r['top_level_category_id']} | img={r['cover_image_url']}")

    dev.close()
    src.close()
    print("\nDone.")

if __name__ == "__main__":
    main()
