"""Phase 4: the trade CSV's price column, now derived from comps.

    python tools/test_trade_export.py <a scratch directory>

The sell price tiers are gone. The column they fed is now `list_price`, walked
back up the vocabulary from observed sold data:

    list price  -offer discount->  sell price  -fees->  net proceeds

A sold comp observes the SELL PRICE, so listing at that bare figure clears less
on every negotiated sale. `list_price_for` grosses the net back up through the
fees and pads for the offer discount, and these tests pin that the padding is
really there -- an unpadded number would look perfectly plausible.

Also pinned: a card with no comps exports BLANK rather than being dropped, so
the CSV keeps working as a "what still needs pricing" worklist.
"""
import csv
import io as _io
import os, sys

SCRATCH = sys.argv[1]
os.environ["COLLECTCORE_DATA_DIR"] = SCRATCH
os.environ["COLLECTCORE_DISABLE_R2"] = "1"
sys.path.insert(0, os.path.abspath("backend"))

import db as dbmod
dbmod.init_db()

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import text
from routers import market, export as export_router
from db import SessionLocal

app = FastAPI()
app.include_router(market.router)
app.include_router(export_router.router)
c = TestClient(app)
s = SessionLocal()

fails = []
def check(label, got, want):
    ok = got == want
    print(f"{'ok  ' if ok else 'FAIL'}  {label}  got={got!r} want={want!r}")
    if not ok: fails.append(label)


def status_id(code):
    return s.execute(text("SELECT ownership_status_id FROM lkup_ownership_statuses"
                          " WHERE status_code = :c"), {"c": code}).scalar()


# --- library ---------------------------------------------------------------
type_id = s.execute(text("SELECT collection_type_id FROM lkup_collection_types"
                         " WHERE collection_type_code = 'photocards'")).scalar()
tlc = s.execute(text("SELECT top_level_category_id FROM lkup_top_level_categories"
                     " LIMIT 1")).scalar()
s.execute(text("INSERT INTO lkup_photocard_groups (group_id, group_name, group_code)"
               " VALUES (1, 'Stray Kids', 'SKZ')"))
s.execute(text("INSERT INTO lkup_photocard_members (member_id, member_code,"
               " member_name, group_id, sort_order) VALUES"
               " (1, 'hyunjin', 'Hyunjin', 1, 1), (2, 'felix', 'Felix', 1, 2),"
               " (3, 'han', 'Han', 1, 3)"))
s.execute(text("INSERT INTO lkup_photocard_source_origins (source_origin_id,"
               " group_id, top_level_category_id, source_origin_name)"
               " VALUES (1, 1, :t, 'This & That')"), {"t": tlc})

# 601 comped   602 proxy-only (data, but no sold comp)   603 no data at all
for item_id, member in ((601, 1), (602, 2), (603, 3)):
    s.execute(text("INSERT INTO tbl_items (item_id, collection_type_id,"
                   " top_level_category_id) VALUES (:i, :t, :c)"),
              {"i": item_id, "t": type_id, "c": tlc})
    s.execute(text("INSERT INTO tbl_photocard_details (item_id, group_id,"
                   " source_origin_id, version) VALUES (:i, 1, 1, 'Photocard')"),
              {"i": item_id})
    s.execute(text("INSERT INTO xref_photocard_members (item_id, member_id)"
                   " VALUES (:i, :m)"), {"i": item_id, "m": member})
    # Every card needs a trade copy or the export skips it entirely.
    s.execute(text("INSERT INTO tbl_photocard_copies (item_id, ownership_status_id)"
                   " VALUES (:i, :t)"), {"i": item_id, "t": status_id("trade")})

# 10% selling fee and a 10% offer discount: both must show up in the answer,
# and they compound rather than adding.
s.execute(text("UPDATE mkt_fee_component SET pct = 0.10 WHERE"
               " marketplace_code='mercari_us' AND side='sell' AND seed_key='sell_fee'"))
s.execute(text("UPDATE lkup_mkt_marketplaces SET offer_discount_pct = 0.10"
               " WHERE marketplace_code = 'mercari_us'"))
s.execute(text("INSERT INTO mkt_fx_rate (currency, as_of_date, usd_per_unit, source)"
               " VALUES ('JPY', '2026-01-01', 0.0068, 'manual')"))
s.commit()


def cap(ext, mkt, cur, price, state, item_id, when):
    return {"marketplace": mkt, "currency": cur, "externalId": ext, "name": ext,
            "capturedAt": when, "isLot": False,
            "lines": [{"lineType": "card", "cardId": item_id, "qty": 1}],
            "sightings": [{"observedAt": when, "priceCents": price,
                           "listingState": state,
                           "rawStatus": "trading" if state == "sold" else "on_sale"}]}


r = c.post("/market/captures", json={"captures": [
    cap("e1", "mercari_us", "USD", 2000, "sold", 601, "2026-08-20T00:00:00Z"),
    cap("e2", "mercari_us", "USD", 2000, "sold", 601, "2026-08-21T00:00:00Z"),
    # A proxy ask on 602: market data, but nothing ever sold, so no list price.
    cap("e3", "neokyo", "JPY", 1500, "active", 602, "2026-08-22T00:00:00Z"),
]})
assert r.status_code == 200, r.text

r = c.post("/export/photocard-trades.csv", json={"item_ids": [601, 602, 603]})
assert r.status_code == 200, r.text
# utf-8-sig, not utf-8: the endpoint writes a BOM so Excel on Windows does not
# mangle member and album names. Decoding without it leaves a BOM glued to the
# first header, which is exactly how a caller discovers the BOM the hard way.
rows = list(csv.DictReader(_io.StringIO(r.content.decode("utf-8-sig"))))
by_id = {int(x["item_id"]): x for x in rows}


print("--- the worksheet still opens cleanly in Excel ---")
check("BOM preserved", r.content[:3], b"\xef\xbb\xbf")

print("\n--- the column is named for the rung it holds ---")
check("header says list_price, not price", "list_price" in rows[0], True)
check("no stale price column", "price" in rows[0], False)

print("\n--- a comped card gets a list price, padded for offers ---")
# sell price 2000 -> net 1800 (10% fee) -> back up through the fee to 2000
# -> padded by the 10% offer discount -> 2222. Listing at the bare 20.00 would
# clear 18.00 on an accepted offer, which is the whole point of the padding.
check("list price is padded above the sell price",
      by_id[601]["list_price"], "22.22")

print("\n--- cards with no SOLD comps export blank, not excluded ---")
# The CSV doubles as a worklist. Blank now means "no comp yet" where it used to
# mean "no tier assigned" -- the more useful of the two.
check("602 is present", 602 in by_id, True)
check("602 has no list price", by_id[602]["list_price"], "")
check("603 is present", 603 in by_id, True)
check("603 has no list price", by_id[603]["list_price"], "")

print("\n--- the rest of the worksheet is unchanged ---")
check("title still composed", by_id[601]["title"].startswith("Stray Kids Hyunjin"), True)
check("member column intact", by_id[601]["member"], "Hyunjin")
check("trade copy count intact", by_id[601]["copies"], "1")

print("\n--- a buy-side sold comp cannot create a list price ---")
# Same rule as phase 0, reached through a different door: if a Neokyo sold row
# could set an asking price, the proxy contamination would come back as a
# number typed straight into a Mercari listing.
r = c.post("/market/captures", json={"captures": [
    cap("e4", "neokyo", "JPY", 900, "sold", 602, "2026-08-23T00:00:00Z"),
]})
assert r.status_code == 200, r.text
r = c.post("/export/photocard-trades.csv", json={"item_ids": [602]})
again = list(csv.DictReader(_io.StringIO(r.content.decode("utf-8-sig"))))[0]
check("still blank after a proxy 'sale'", again["list_price"], "")

print()
if fails:
    print(f"{len(fails)} FAILED: " + ", ".join(fails)); sys.exit(1)
print("all passed")
