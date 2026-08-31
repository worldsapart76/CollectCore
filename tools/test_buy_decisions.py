"""Buy to Keep, Buy to Resell, and a lot's "% useful" verdict.

    python tools/test_buy_decisions.py <a scratch directory>

Real photocard rows, because every one of these readings turns on library facts
-- what is Wanted, what a card's origin era is -- and a synthetic fixture would
pass while a wrong join shipped.

Fees are set to real-looking values here rather than zeroed: the whole claim of
these views is that they compare LANDED cost against NET proceeds, and a suite
run with both at zero would pass just as happily on code that ignored fees.
"""
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
from routers import market
from db import SessionLocal

app = FastAPI(); app.include_router(market.router)
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
               " (1, 'chan', 'Bang Chan', 1, 1), (2, 'felix', 'Felix', 1, 2),"
               " (3, 'han', 'Han', 1, 3)"))
s.execute(text("INSERT INTO lkup_photocard_source_origins (source_origin_id,"
               " group_id, top_level_category_id, source_origin_name, start_date)"
               " VALUES (1, 1, :t, '5 Star', '2023-06-02')"), {"t": tlc})

# 301 Bang Chan (WANTED, the test card)  302 Felix  303 Han
for item_id, member, version in ((301, 1, 'Digipack POB'), (302, 2, 'Yes24'),
                                 (303, 3, 'HMV')):
    s.execute(text("INSERT INTO tbl_items (item_id, collection_type_id,"
                   " top_level_category_id) VALUES (:i, :t, :c)"),
              {"i": item_id, "t": type_id, "c": tlc})
    s.execute(text("INSERT INTO tbl_photocard_details (item_id, group_id,"
                   " source_origin_id, version) VALUES (:i, 1, 1, :v)"),
              {"i": item_id, "v": version})
    s.execute(text("INSERT INTO xref_photocard_members (item_id, member_id)"
                   " VALUES (:i, :m)"), {"i": item_id, "m": member})
s.execute(text("INSERT INTO tbl_photocard_copies (item_id, ownership_status_id)"
               " VALUES (301, :w), (303, :w)"), {"w": status_id("wanted")})

# Real-looking fees on both sides, so a view that ignored them fails here.
s.execute(text("UPDATE mkt_fee_component SET pct = 0.10 WHERE"
               " marketplace_code='mercari_us' AND side='sell' AND seed_key='sell_fee'"))
s.execute(text("UPDATE mkt_fee_component SET fixed_minor = 350 WHERE"
               " marketplace_code='neokyo' AND side='buy' AND seed_key='svc'"))
s.execute(text("INSERT INTO mkt_fx_rate (currency, as_of_date, usd_per_unit, source)"
               " VALUES ('JPY', '2026-01-01', 0.0068, 'manual')"))
s.commit()


def cap(ext, mkt, cur, price, state, lines, when, ship=None, usd=None, lot=False):
    return {"marketplace": mkt, "currency": cur, "externalId": ext,
            "name": ext, "capturedAt": when, "isLot": lot,
            "lines": lines,
            "sightings": [{"observedAt": when, "priceCents": price,
                           "priceUsd": usd, "shippingCents": ship,
                           "listingState": state,
                           "rawStatus": "trading" if state == "sold" else "on_sale"}]}


ONE = lambda i, q=1: [{"lineType": "card", "cardId": i, "qty": q}]

c.post("/market/captures", json={"captures": [
    # 301 sold three times on Mercari US at 18/20/24, each with $4 postage.
    cap("s1", "mercari_us", "USD", 1800, "sold", ONE(301), "2026-08-25T00:00:00Z", ship=400),
    cap("s2", "mercari_us", "USD", 2000, "sold", ONE(301), "2026-08-26T00:00:00Z", ship=400),
    cap("s3", "mercari_us", "USD", 2400, "sold", ONE(301), "2026-08-27T00:00:00Z", ship=400),
    # Three singles you could buy it from now: $12, $15, $30.
    cap("a1", "mercari_us", "USD", 1200, "active", ONE(301), "2026-08-30T00:00:00Z", ship=0),
    cap("a2", "mercari_us", "USD", 1500, "active", ONE(301), "2026-08-30T00:00:00Z", ship=0),
    cap("a3", "mercari_us", "USD", 3000, "active", ONE(301), "2026-08-30T00:00:00Z", ship=0),
    # A Neokyo lot: 301 + 302 + 303 for Y3000 (~$20.40 + Y350 service).
    cap("nk1", "neokyo", "JPY", 3000, "active",
        [{"lineType": "card", "cardId": 301, "qty": 1},
         {"lineType": "card", "cardId": 302, "qty": 1},
         {"lineType": "card", "cardId": 303, "qty": 1}],
        "2026-08-30T00:00:00Z", lot=True),
    # 302 sells for $9 net-ish; 303 has no comps at all.
    cap("s4", "mercari_us", "USD", 1000, "sold", ONE(302), "2026-08-28T00:00:00Z", ship=0),
]})

d = c.get("/market/comps/301")
assert d.status_code == 200, d.text
keep = d.json()["keep"]
resell = d.json()["resell"]

print("--- Buy to Keep: the cheapest of each kind, kept apart ---")
check("cheapest single is the $12 listing",
      keep["cheapest_single"]["landed_cents"], 1200)
check("the lot is a separate figure, per card",
      keep["cheapest_lot"] is not None, True)
check("and it is not counted as a single",
      keep["cheapest_single"]["line_count"], 1)

print("\n--- two medians, side by side ---")
# Singles: 1200 / 1500 / 3000 -> 1500. Adding the lot's per-card share moves it,
# and the gap between the two IS how much the lots shift this card's market.
check("median over things you can buy one of", keep["median_single_cents"], 1500)
check("counted", keep["n_single"], 3)
check("the all-routes median includes the lot", keep["n_all"], 4)
check("and differs from the singles median",
      keep["median_all_per_card_cents"] != keep["median_single_cents"], True)

print("\n--- sold, landed, so it compares with the asks ---")
# 18/20/24 each plus $4 postage -> 22/24/28, median 24. A bare median would be
# 20 and would make every landed ask look worse than it is.
check("median of what buyers actually paid, all in",
      keep["sold"]["median_cents"], 2400)
check("three of them", keep["sold"]["n"], 3)
check("all three carried a real postage figure",
      keep["sold"]["n_shipping_known"], 3)

print("\n--- how much of a listing you actually want ---")
by_id = {o["listing_id"]: o for o in d.json()["buy_options"]}
lot_opt = [o for o in by_id.values() if o["line_count"] == 3][0]
single_opt = [o for o in by_id.values() if o["landed_cents"] == 1200][0]
check("a single of a wanted card counts one", single_opt["wanted_count"], 1)
# 301 and 303 are wanted; 302 is not.
check("two of the lot's three are wanted", lot_opt["wanted_count"], 2)

print("\n--- Buy to Resell: Neokyo only, against Mercari US ---")
check("scoped to neokyo", resell["sources"], ["neokyo"])
check("selling on mercari US", resell["sell_marketplace"], "mercari_us")
# Median sold GROSS is 2000; net of the 10% selling fee is 1800.
check("the estimate is net of selling fees", resell["sell_net_cents"], 1800)
check("one neokyo route", len(resell["rows"]), 1)
row = resell["rows"][0]
check("it is a lot", row["is_lot"], True)
# The lot's landed cost split by VALUE, not evenly -- the same allocation the
# lot screen shows, so the two cannot disagree.
check("the buy cost is this card's SHARE, not the box",
      row["buy_cost_cents"] < row["landed_cents"], True)
check("profit is the estimate less that share",
      row["profit_cents"], 1800 - row["buy_cost_cents"])
check("and the default target is $5", resell["target_profit_cents"], 500)
check("which this clears", row["meets_target"], True)

print("\n--- with no sold comps the question inverts ---")
r303 = c.get("/market/comps/303").json()["resell"]
check("no estimate to compare against", r303["sell_net_cents"], None)
row303 = r303["rows"][0]
check("so no profit figure", row303["profit_cents"], None)
# What it would have to fetch to be worth doing at all -- a requirement, not a
# measurement, which is why the view shows it in red in the estimate's place.
check("a required list price stands in", row303["required_list_cents"] > 0, True)
check("and it clears the cost plus the target",
      row303["required_list_cents"] > row303["buy_cost_cents"] + 500, True)

print("\n--- the lot's verdict ---")
lot_id = lot_opt["listing_id"]
u = c.get(f"/market/lots/{lot_id}").json()["useful"]
lines = {ln["item_id"]: ln for ln in u["lines"]}
check("three cards judged", u["card_units"], 3)
check("target carried through", u["target_profit_cents"], 500)
# 301 is wanted; its share of the lot against the cheapest single ($12 landed).
check("the wanted card is compared with buying it alone",
      lines[301]["best_single_cents"], 1200)
check("and that comparison is recorded",
      lines[301]["wanted_ok"], lines[301]["alloc_per_unit_cents"] <= 1200)
check("either reason is enough",
      lines[301]["useful"], lines[301]["wanted_ok"] or lines[301]["flip_ok"])
# 303 is wanted but has no single-card listing anywhere, so there is nothing to
# be cheaper THAN. It can still earn its place by reselling.
check("a wanted card with nothing to price against says so",
      lines[303]["best_single_cents"], None)
check("and is not silently marked good", lines[303]["wanted_ok"], False)
check("the percentage is over cards, not lines",
      u["pct_useful"], round(100 * u["useful_units"] / 3))
check("and how much of it rests on era estimates is stated",
      "estimated_units" in u, True)

print("\n--- a non-card line is listed, not judged ---")
c.post(f"/market/lots/{lot_id}/lines",
       json={"line_type": "non_card", "label": "album", "value_cents": 1200})
u2 = c.get(f"/market/lots/{lot_id}").json()["useful"]
album = [ln for ln in u2["lines"] if ln["line_type"] == "non_card"][0]
check("it appears", album["label"], "album")
check("but carries no verdict", album["useful"], None)
check("and does not move the count", u2["card_units"], 3)

print("\n--- the target is one number, shared ---")
# The resell view and the lot verdict must not be able to disagree about what
# "worth doing" means.
c.put("/market/settings", json={"target_profit_cents": 5000})
check("resell sees it",
      c.get("/market/comps/301").json()["resell"]["target_profit_cents"], 5000)
check("the lot verdict sees the same",
      c.get(f"/market/lots/{lot_id}").json()["useful"]["target_profit_cents"], 5000)
check("a negative target is refused",
      c.put("/market/settings", json={"target_profit_cents": -1}).status_code, 400)

print("\n" + (f"{len(fails)} FAILED: {fails}" if fails else "all passed"))
sys.exit(1 if fails else 0)
