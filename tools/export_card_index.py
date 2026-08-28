"""Export a compact photocard index for the capture extension.

The extension needs to let you pick a card while browsing Mercari, and to
narrow that picker from listing-title tokens. Both need a local copy of the
library — it cannot query the API from a content script, and would not want to
per keystroke anyway.

This writes a single JSON file you import through the extension's side panel.
Deliberately a one-off script rather than an endpoint: it stays out of the
request path, out of git, and out of the deployed app until the picker has
proven what it actually needs.

Usage:
    python tools/export_card_index.py [--db PATH] [--out PATH]

Read-only. Touches nothing.

**The dev DB lags production.** Cards and whole eras present in prod can be
missing from dev, or sit there as placeholder rows. An index exported from dev
is fine for developing the picker and tuning the matcher; it is NOT fit to
actually sweep against, because cards you own will fail to match and get pushed
down the create-the-card path for no reason.

For real use, source from prod — either a downloaded prod backup
(Admin -> Backup & Restore) passed via --db, or the admin card-index endpoint
once that exists.
"""

from __future__ import annotations

import argparse
import json
import sqlite3
from collections import defaultdict
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DEFAULT_DB = REPO / "data" / "collectcore.db"
DEFAULT_OUT = REPO / "data" / "card-index.json"

PHOTOCARD_TYPE_CODE = "photocards"


def collection_type_id(cur: sqlite3.Cursor) -> int:
    row = cur.execute(
        "SELECT collection_type_id FROM lkup_collection_types "
        "WHERE collection_type_code = ?",
        (PHOTOCARD_TYPE_CODE,),
    ).fetchone()
    if row is None:
        raise SystemExit(f"no collection type {PHOTOCARD_TYPE_CODE!r}")
    return row[0]


def members_by_item(cur: sqlite3.Cursor) -> dict[int, list[str]]:
    out: dict[int, list[str]] = defaultdict(list)
    for item_id, name in cur.execute(
        """
        SELECT x.item_id, m.member_name
          FROM xref_photocard_members x
          JOIN lkup_photocard_members m ON m.member_id = x.member_id
         ORDER BY x.item_id, m.sort_order
        """
    ):
        out[item_id].append(name)
    return out


def front_images(cur: sqlite3.Cursor) -> dict[int, str]:
    # display_order picks the front when several attachments share a type.
    return {
        item_id: path
        for item_id, path in cur.execute(
            """
            SELECT item_id, file_path
              FROM tbl_attachments
             WHERE attachment_type = 'front'
             ORDER BY item_id, display_order DESC
            """
        )
    }


def build(db_path: Path) -> dict:
    con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    cur = con.cursor()

    type_id = collection_type_id(cur)
    members = members_by_item(cur)
    images = front_images(cur)

    cards = []
    # source_origin_id is nullable — LEFT JOIN it, always (CLAUDE.md).
    for item_id, group_name, group_code, origin, version, is_special in cur.execute(
        """
        SELECT d.item_id,
               g.group_name,
               g.group_code,
               so.source_origin_name,
               d.version,
               d.is_special
          FROM tbl_photocard_details d
          JOIN tbl_items i  ON i.item_id  = d.item_id
          JOIN lkup_photocard_groups g ON g.group_id = d.group_id
          LEFT JOIN lkup_photocard_source_origins so
                 ON so.source_origin_id = d.source_origin_id
         WHERE i.collection_type_id = ?
         ORDER BY d.item_id
        """,
        (type_id,),
    ):
        cards.append(
            {
                "id": item_id,
                "group": group_name,
                "groupCode": group_code,
                "members": members.get(item_id, []),
                "origin": origin,
                "version": version,
                "special": bool(is_special),
                "image": images.get(item_id),
            }
        )

    # The lexicon the title pre-filter matches against. Shipping the distinct
    # values with the index means the extension never has to derive them, and
    # they stay in step with the library they came from.
    lexicon = {
        "groups": sorted({c["group"] for c in cards if c["group"]}),
        "members": sorted({m for c in cards for m in c["members"]}),
        "origins": sorted({c["origin"] for c in cards if c["origin"]}),
        "versions": sorted({c["version"] for c in cards if c["version"]}),
    }

    con.close()
    return {"version": 1, "cards": cards, "lexicon": lexicon}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--db", type=Path, default=DEFAULT_DB)
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    args = ap.parse_args()

    if not args.db.exists():
        raise SystemExit(f"database not found: {args.db}")

    index = build(args.db)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(
        json.dumps(index, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )

    cards = index["cards"]
    lex = index["lexicon"]
    size_mb = args.out.stat().st_size / 1_048_576
    no_image = sum(1 for c in cards if not c["image"])
    no_origin = sum(1 for c in cards if not c["origin"])

    print(f"wrote {args.out}  ({size_mb:.2f} MB)")
    print(f"  cards      {len(cards):,}")
    print(f"  no image   {no_image:,}")
    print(f"  no origin  {no_origin:,}")
    print(
        "  lexicon    "
        f"{len(lex['groups'])} groups, {len(lex['members'])} members, "
        f"{len(lex['origins'])} origins, {len(lex['versions'])} versions"
    )


if __name__ == "__main__":
    main()
