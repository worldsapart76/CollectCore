"""
migrate_gn_wishlist.py

Imports Amazon wishlist items into the GN module as ownership_status = Wanted (id=2).
Parses title/authors from the name field, classifies publisher/category/era/format
from title keywords, merges writers by name with existing lookup rows, and stores
the Amazon thumbnail as cover_image_url.
"""

import json
import re
import sqlite3
from pathlib import Path

WISHLIST_JSON = Path(__file__).parents[1] / "docs" / "amazon-wishlist-Omnibus-1776110082164.json"
DEV_DB        = Path(__file__).parents[1] / "data" / "collectcore.db"

# Dev schema constants
DEV_COLLECTION_TYPE_ID = 3   # graphicnovels
WANTED_STATUS_ID       = 2   # Wanted
FORMAT_OMNIBUS         = 1
FORMAT_GN              = 2   # Used for "Absolute" editions
FORMAT_TPB             = 3

CAT_MARVEL = 5
CAT_DC     = 6
CAT_OTHER  = 7

PUB_MARVEL     = 1
PUB_DC         = 2
PUB_IMAGE      = 3
PUB_DARK_HORSE = 4
PUB_IDW        = 5

# ---------------------------------------------------------------------------
# Classification helpers
# ---------------------------------------------------------------------------

# DC check runs first — some titles overlap (e.g. "DC Versus Marvel")
DC_KEYWORDS = [
    'batman', 'superman', 'wonder woman', 'green lantern', 'green arrow',
    'the flash', 'flash:', 'flash,', 'aquaman', 'justice league', 'teen titans',
    'titans by', 'titans omnibus', 'nightwing', 'batgirl', 'batwoman',
    'supergirl', 'superboy', 'power girl', 'hawkman', 'green arrow',
    'jsa ', 'jla ', 'suicide squad', 'swamp thing', 'doom patrol',
    'infinite crisis', 'final crisis', 'death metal', 'dark nights',
    'forever evil', 'injustice', 'dceased', 'earth 2', 'new 52',
    'rebirth omnibus', 'doomsday clock', 'before watchmen', 'watchmen',
    '52 omnibus', 'dc one million', 'dc versus marvel', 'knight terrors',
    'house of mystery', 'jonah hex', 'warlord by mike grell',
    'the authority', 'authority omnibus', 'secret six',
    'legends omnibus',   # DC crossover event
    'new teen titans', 'justice league dark', 'justice league international',
    'absolute doomsday', 'detective comics', 'batman &', 'batman by',
    'batman: detective', 'batman: the ', 'batman: war', 'batman: knightfall',
    'superman &', 'superman by', 'superman/', '/batman',
    'teen titans: the', 'teen titans:', 'batgirl: the',
    'jsа', 'earth 2', 'earth2',
]

MARVEL_KEYWORDS = [
    'spider-man', 'amazing spider', 'spectacular spider', 'spider-woman',
    'spider-verse', 'spider-geddon', 'avengers', 'x-men', 'x-factor',
    'x-force', 'new mutants', 'uncanny x-men', 'captain america',
    'invincible iron man', 'iron man omnibus', 'iron man vol',
    'black widow strikes', 'black widow &', 'black widow by',
    'hulk', 'incredible hulk', 'immortal hulk', 'world war hulk',
    'thor', 'daredevil', 'fantastic four', 'wolverine', 'ghost rider',
    'howard the duck', 's.h.i.e.l.d.', 'namor', 'alpha flight',
    'she-hulk', 'sensational she-hulk', 'marvel universe',
    'excalibur', 'guardians of the galaxy', 'blade:', 'doctor strange',
    'silver surfer', 'nova', 'punisher', 'marvel team-up', 'marvel two-in-one',
    'ultimate spider', 'ultimate x-men', 'ultimates', 'ultimate fantastic four',
    'secret wars', 'savage avengers', 'what if?', 'tomb of dracula',
    'doom patrol by john byrne',  # Marvel imprint at the time
    'krakoa', 'dawn of x', 'reign of x', 'fall of the house of x',
    'powers of x', 'judgment day', 'all-new x-men', 'x-men by',
    'x-men: age', 'x-men mutant', 'new mutants omnibus',
    'star wars', 'conan', 'savage sword',
    'timely', 'golden age captain america', 'golden age marvel',
    'marvel horror', 'captain marvel', 'ms. marvel',
    'godzilla: the original marvel',  # published by Marvel
    'marvel omnibus', 'marvel two',
]

OTHER_KEYWORDS = [
    'invincible omnibus', 'invincible vol',  # Robert Kirkman (Image)
    'witchblade', 'darkness volume', 'complete darkness',
    'tomb raider colossal',
    'aliens: the original', 'predator: the original',
    'godzilla: the original',  # IDW original run
]


def classify(title: str):
    """Return (publisher_id, top_level_category_id)."""
    tl = title.lower()

    # Other-universe check first (prevents e.g. "Godzilla Marvel" → Marvel)
    for kw in OTHER_KEYWORDS:
        if kw in tl:
            if 'witchblade' in tl or 'darkness' in tl or 'tomb raider' in tl or 'invincible' in tl:
                return PUB_IMAGE, CAT_OTHER
            if 'godzilla' in tl:
                return PUB_IDW, CAT_OTHER
            if 'aliens' in tl or 'predator' in tl:
                return PUB_DARK_HORSE, CAT_OTHER
            return None, CAT_OTHER

    # DC
    for kw in DC_KEYWORDS:
        if kw in tl:
            return PUB_DC, CAT_DC

    # Marvel
    for kw in MARVEL_KEYWORDS:
        if kw in tl:
            return PUB_MARVEL, CAT_MARVEL

    # Fallback: remaining Image/other titles
    if 'image' in tl:
        return PUB_IMAGE, CAT_OTHER
    return None, CAT_OTHER


def classify_era(title: str):
    """Return era_id (1–6) or None."""
    tl = title.lower()
    if 'golden age' in tl:
        return 1  # Golden Age
    if 'silver age' in tl:
        return 2  # Silver Age
    if 'bronze age' in tl:
        return 3  # Bronze Age
    if 'copper age' in tl:
        return 4  # Copper Age
    return None


def classify_format(title: str):
    """Return format_type_id."""
    tl = title.lower()
    if 'absolute ' in tl:
        return FORMAT_GN   # DC Absolute = deluxe GN format
    if 'omnibus' in tl or 'complete' in tl or 'colossal' in tl:
        return FORMAT_OMNIBUS
    if 'trade paperback' in tl or ' tpb' in tl:
        return FORMAT_TPB
    return FORMAT_OMNIBUS  # default (wishlist is called "Omnibus")


def make_title_sort(title: str) -> str:
    t = title.strip()
    for article in ('The ', 'A ', 'An '):
        if t.startswith(article):
            return t[len(article):].strip() + ', ' + article.strip()
    return t


def parse_name(raw: str):
    """
    Parse Amazon name string into (title, [author_name, ...]).
    Format: "Title by Author1, Author2 (Format)"
    Uses rfind(' by ') so "Batman by Tom King Omnibus ... by Tom King, ..." is handled correctly.
    """
    # Strip trailing parenthetical (format/edition note)
    name = re.sub(r'\s*\([^)]+\)\s*$', '', raw).strip()

    idx = name.rfind(' by ')
    if idx == -1:
        return name.strip(), []

    title   = name[:idx].strip()
    authors = name[idx + 4:].strip()

    if authors.lower() in ('', 'unknown author'):
        return title, []

    # Split on ', ' but keep compound names intact
    author_list = [a.strip() for a in authors.split(', ') if a.strip()]
    return title, author_list


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    with open(WISHLIST_JSON, encoding='utf-8') as f:
        data = json.load(f)
    items = data['items']
    print(f"Wishlist items to import: {len(items)}")

    dev = sqlite3.connect(DEV_DB)
    dev.row_factory = sqlite3.Row
    dev.execute("PRAGMA foreign_keys = OFF")

    # Build existing title set for dedup (normalised lowercase)
    existing_titles = {
        r['title'].lower().strip()
        for r in dev.execute(
            "SELECT title FROM tbl_graphicnovel_details g "
            "JOIN tbl_items i ON i.item_id = g.item_id "
            "WHERE i.collection_type_id = ?", (DEV_COLLECTION_TYPE_ID,)
        )
    }
    print(f"Existing GN titles in dev: {len(existing_titles)}")

    # Build writer lookup: name (lower) → writer_id
    writer_lookup = {
        r['writer_name'].lower(): r['writer_id']
        for r in dev.execute("SELECT writer_id, writer_name FROM lkup_graphicnovel_writers")
    }

    def get_or_create_writer(name: str) -> int:
        key = name.lower()
        if key in writer_lookup:
            return writer_lookup[key]
        cursor = dev.execute(
            "INSERT INTO lkup_graphicnovel_writers (writer_name, is_active) VALUES (?, 1)",
            (name,)
        )
        writer_lookup[key] = cursor.lastrowid
        return cursor.lastrowid

    inserted = 0
    skipped_dupes = 0
    unclassified = []

    for raw_item in items:
        title, authors = parse_name(raw_item['name'])
        title_lower = title.lower()

        # Dedup check
        if title_lower in existing_titles:
            skipped_dupes += 1
            print(f"  SKIP (duplicate): {title}")
            continue

        publisher_id, top_cat_id = classify(title)
        era_id      = classify_era(title)
        format_type = classify_format(title)
        title_sort  = make_title_sort(title)

        if top_cat_id == CAT_OTHER and publisher_id is None:
            unclassified.append(title)

        # Amazon thumbnail as cover image (external URL)
        cover_url = raw_item.get('imageUrl') or None

        # Insert tbl_items
        cursor = dev.execute(
            """INSERT INTO tbl_items
               (collection_type_id, top_level_category_id, ownership_status_id,
                reading_status_id, notes, created_at, updated_at)
               VALUES (?, ?, ?, NULL, NULL, datetime('now'), datetime('now'))""",
            (DEV_COLLECTION_TYPE_ID, top_cat_id, WANTED_STATUS_ID)
        )
        new_item_id = cursor.lastrowid

        # Insert tbl_graphicnovel_details
        dev.execute(
            """INSERT INTO tbl_graphicnovel_details
               (item_id, title, title_sort, publisher_id, format_type_id,
                era_id, cover_image_url)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (new_item_id, title, title_sort, publisher_id, format_type,
             era_id, cover_url)
        )

        # Insert writer xrefs
        for order, author_name in enumerate(authors, start=1):
            # Skip generic placeholders
            if author_name.lower() in ('various', 'marvel various'):
                continue
            wid = get_or_create_writer(author_name)
            dev.execute(
                """INSERT INTO xref_graphicnovel_item_writers (item_id, writer_id, writer_order)
                   VALUES (?, ?, ?)""",
                (new_item_id, wid, order)
            )

        existing_titles.add(title_lower)
        inserted += 1

    dev.commit()

    print(f"\n=== Results ===")
    print(f"Inserted:          {inserted}")
    print(f"Skipped (dupes):   {skipped_dupes}")
    print(f"Total writers now: {dev.execute('SELECT COUNT(*) FROM lkup_graphicnovel_writers').fetchone()[0]}")

    total_gn = dev.execute(
        "SELECT COUNT(*) FROM tbl_items WHERE collection_type_id=?",
        (DEV_COLLECTION_TYPE_ID,)
    ).fetchone()[0]
    print(f"Total GN items:    {total_gn}")

    by_cat = dev.execute(
        "SELECT top_level_category_id, COUNT(*) as c FROM tbl_items "
        "WHERE collection_type_id=? GROUP BY top_level_category_id",
        (DEV_COLLECTION_TYPE_ID,)
    ).fetchall()
    cat_names = {5: 'Marvel', 6: 'DC', 7: 'Other'}
    for row in by_cat:
        print(f"  {cat_names.get(row[0], row[0])}: {row[1]}")

    by_status = dev.execute(
        "SELECT o.status_name, COUNT(*) as c "
        "FROM tbl_items i JOIN lkup_ownership_statuses o ON o.ownership_status_id = i.ownership_status_id "
        "WHERE i.collection_type_id=? GROUP BY i.ownership_status_id",
        (DEV_COLLECTION_TYPE_ID,)
    ).fetchall()
    print(f"\nBy ownership:")
    for row in by_status:
        print(f"  {row[0]}: {row[1]}")

    if unclassified:
        print(f"\nUnclassified (mapped to Other, no publisher): {len(unclassified)}")
        for t in unclassified:
            print(f"  - {t}")

    dev.close()
    print("\nDone.")


if __name__ == "__main__":
    main()
