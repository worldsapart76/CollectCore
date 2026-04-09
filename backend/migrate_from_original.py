"""
Migration script: original PhotocardTracker → CollectCore

Wipes test data from CollectCore, then migrates 1,036 cards from the original DB.

Mapping rules:
  - ownership: Owned→1, Want→2 (Wanted), For Trade→3 (Trade)
  - top_level_category: Album→1, Non-Album→2
  - group: skz→1
  - member: Bang Chan→1, Lee Know→2, Changbin→3, Hyunjin→4, Han→5,
            Felix→6, Seungmin→7, I.N→8, Multiple→1 (Bang Chan)
  - sub_category → source_origin_name (find/create, scoped by group+category)
  - source → version
  - front_image_path / back_image_path → tbl_attachments
"""

import shutil
import sqlite3
import sys
from pathlib import Path

ORIGINAL_DB   = "F:/Dropbox/Apps/PhotocardTracker/data/photocards.db"
COLLECTCORE_DB = "F:/Dropbox/Apps/CollectCore/data/collectcore.db"

ORIGINAL_IMAGES_DIR   = Path("F:/Dropbox/Apps/PhotocardTracker")
COLLECTCORE_IMAGES_DIR = Path("F:/Dropbox/Apps/CollectCore")

OWNERSHIP_MAP = {
    "Owned":     1,
    "Want":      2,
    "For Trade": 3,
}

CATEGORY_MAP = {
    "Album":     1,
    "Non-Album": 2,
}

MEMBER_MAP = {
    "Bang Chan": 1,
    "Lee Know":  2,
    "Changbin":  3,
    "Hyunjin":   4,
    "Han":       5,
    "Felix":     6,
    "Seungmin":  7,
    "I.N":       8,
    "Multiple":  1,  # → Bang Chan per migration rule
}

COLLECTION_TYPE_ID = 1   # photocards
GROUP_ID_SKZ       = 1


def wipe_test_data(cc):
    print("Wiping test data...")
    cc.execute("DELETE FROM tbl_attachments")
    cc.execute("DELETE FROM xref_photocard_members")
    cc.execute("DELETE FROM tbl_photocard_details")
    cc.execute("DELETE FROM tbl_items")
    cc.execute("DELETE FROM lkup_photocard_source_origins")
    # Reset autoincrement counters
    for table in ("tbl_items", "tbl_attachments", "lkup_photocard_source_origins"):
        cc.execute(f"DELETE FROM sqlite_sequence WHERE name='{table}'")
    print("  done.")


def seed_collection_type(cc):
    existing = cc.execute(
        "SELECT collection_type_id FROM lkup_collection_types WHERE collection_type_id = ?",
        (COLLECTION_TYPE_ID,)
    ).fetchone()
    if not existing:
        print("Seeding lkup_collection_types (photocards)...")
        cc.execute(
            "INSERT INTO lkup_collection_types (collection_type_id, collection_type_code, collection_type_name, sort_order, is_active) VALUES (?, ?, ?, ?, ?)",
            (COLLECTION_TYPE_ID, "photocard", "Photocard", 1, 1)
        )
        print("  done.")
    else:
        print("lkup_collection_types already has photocard row — skipping seed.")


def get_or_create_source_origin(cc, group_id, top_level_category_id, name, cache):
    key = (group_id, top_level_category_id, name)
    if key in cache:
        return cache[key]
    row = cc.execute(
        "SELECT source_origin_id FROM lkup_photocard_source_origins WHERE group_id=? AND top_level_category_id=? AND source_origin_name=?",
        (group_id, top_level_category_id, name)
    ).fetchone()
    if row:
        cache[key] = row[0]
    else:
        cur = cc.execute(
            "INSERT INTO lkup_photocard_source_origins (group_id, top_level_category_id, source_origin_name, sort_order, is_active) VALUES (?, ?, ?, 0, 1)",
            (group_id, top_level_category_id, name)
        )
        cache[key] = cur.lastrowid
    return cache[key]


def migrate(dry_run=False):
    orig = sqlite3.connect(ORIGINAL_DB)
    orig.row_factory = sqlite3.Row
    cc = sqlite3.connect(COLLECTCORE_DB)

    try:
        wipe_test_data(cc)
        seed_collection_type(cc)

        cards = orig.execute(
            "SELECT id, group_code, front_image_path, back_image_path, member, notes, created_at, "
            "top_level_category, sub_category, source, ownership_status FROM cards ORDER BY id"
        ).fetchall()

        print(f"Migrating {len(cards)} cards...")

        source_origin_cache = {}
        skipped = []
        migrated = 0

        for card in cards:
            # Resolve ownership
            ownership_id = OWNERSHIP_MAP.get(card["ownership_status"])
            if ownership_id is None:
                skipped.append((card["id"], f"unknown ownership_status: {card['ownership_status']}"))
                continue

            # Resolve top-level category
            category_id = CATEGORY_MAP.get(card["top_level_category"])
            if category_id is None:
                skipped.append((card["id"], f"unknown top_level_category: {card['top_level_category']}"))
                continue

            # Resolve member
            member_id = MEMBER_MAP.get(card["member"])
            if member_id is None and card["member"]:
                skipped.append((card["id"], f"unknown member: {card['member']}"))
                continue

            # Resolve source_origin (sub_category → source_origin_id, nullable)
            source_origin_id = None
            if card["sub_category"]:
                source_origin_id = get_or_create_source_origin(
                    cc, GROUP_ID_SKZ, category_id, card["sub_category"], source_origin_cache
                )

            # version = original source field
            version = card["source"] or None

            if dry_run:
                migrated += 1
                continue

            # Insert tbl_items
            cur = cc.execute(
                "INSERT INTO tbl_items (collection_type_id, top_level_category_id, ownership_status_id, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
                (COLLECTION_TYPE_ID, category_id, ownership_id, card["notes"], card["created_at"], card["created_at"])
            )
            item_id = cur.lastrowid

            # Insert tbl_photocard_details
            cc.execute(
                "INSERT INTO tbl_photocard_details (item_id, group_id, source_origin_id, version) VALUES (?, ?, ?, ?)",
                (item_id, GROUP_ID_SKZ, source_origin_id, version)
            )

            # Insert xref_photocard_members (only if member is known)
            if member_id is not None:
                cc.execute(
                    "INSERT INTO xref_photocard_members (item_id, member_id) VALUES (?, ?)",
                    (item_id, member_id)
                )

            # Copy image files and insert tbl_attachments
            for attach_type, rel_path, order in (
                ("front", card["front_image_path"], 1),
                ("back",  card["back_image_path"],  2),
            ):
                if not rel_path:
                    continue
                src = ORIGINAL_IMAGES_DIR / rel_path
                dst = COLLECTCORE_IMAGES_DIR / rel_path
                dst.parent.mkdir(parents=True, exist_ok=True)
                if src.exists():
                    shutil.copy2(src, dst)
                else:
                    print(f"  WARNING: image not found: {src}")
                cc.execute(
                    "INSERT INTO tbl_attachments (item_id, attachment_type, file_path, storage_type, display_order) VALUES (?, ?, ?, 'local', ?)",
                    (item_id, attach_type, rel_path, order)
                )

            migrated += 1

        if dry_run:
            print(f"DRY RUN — would migrate {migrated} cards, skip {len(skipped)}")
            if skipped:
                print("\nWould skip:")
                for card_id, reason in skipped:
                    print(f"  id={card_id}: {reason}")
            orig.close()
            cc.close()
            return

        cc.commit()

        print(f"\nMigration complete.")
        print(f"  Cards migrated: {migrated}")
        print(f"  Cards skipped:  {len(skipped)}")
        if skipped:
            print("\nSkipped cards:")
            for card_id, reason in skipped:
                print(f"  id={card_id}: {reason}")

        # Verify
        print("\nVerification:")
        print(f"  tbl_items:                  {cc.execute('SELECT COUNT(*) FROM tbl_items').fetchone()[0]}")
        print(f"  tbl_photocard_details:      {cc.execute('SELECT COUNT(*) FROM tbl_photocard_details').fetchone()[0]}")
        print(f"  xref_photocard_members:     {cc.execute('SELECT COUNT(*) FROM xref_photocard_members').fetchone()[0]}")
        print(f"  tbl_attachments:            {cc.execute('SELECT COUNT(*) FROM tbl_attachments').fetchone()[0]}")
        print(f"  lkup_photocard_source_origins: {cc.execute('SELECT COUNT(*) FROM lkup_photocard_source_origins').fetchone()[0]}")

    except Exception as e:
        cc.rollback()
        print(f"ERROR: {e}")
        raise
    finally:
        orig.close()
        cc.close()


if __name__ == "__main__":
    dry_run = "--dry-run" in sys.argv
    if dry_run:
        print("=== DRY RUN (no changes will be written) ===\n")
    migrate(dry_run=dry_run)
