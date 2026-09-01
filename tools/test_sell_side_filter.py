"""Phase 0: buy-side marketplaces must not reach the sell-price median.

    python tools/test_sell_side_filter.py <a scratch directory>

The defect this pins: the capture extension sets sold state from page text --
Neokyo's "out of stock", Pocamarket's "sold out" -- so proxy listings became
`listing_state = 'sold'` with no user action, and pooled into a median labelled
"what this card sells for on Mercari US". Domestic JP/KR prices sit below US
resale, so the error drags the sell price DOWN and understates every flip and
arb margin.

The fix is a pooling rule, not a data fix. These tests therefore assert BOTH
halves: that the buy-side rows stop counting, and that they are still in the
table -- because a filter that deleted them would also destroy the Pocamarket
popularity signal those same rows carry.
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


# --- library ---------------------------------------------------------------
type_id = s.execute(text("SELECT collection_type_id FROM lkup_collection_types"
                         " WHERE collection_type_code = 'photocards'")).scalar()
tlc = s.execute(text("SELECT top_level_category_id FROM lkup_top_level_categories"
                     " LIMIT 1")).scalar()
s.execute(text("INSERT INTO lkup_photocard_groups (group_id, group_name, group_code)"
               " VALUES (1, 'Stray Kids', 'SKZ')"))
s.execute(text("INSERT INTO lkup_photocard_members (member_id, member_code,"
               " member_name, group_id, sort_order) VALUES"
               " (1, 'hyunjin', 'Hyunjin', 1, 1), (2, 'felix', 'Felix', 1, 2)"))
s.execute(text("INSERT INTO lkup_photocard_source_origins (source_origin_id,"
               " group_id, top_level_category_id, source_origin_name, start_date)"
               " VALUES (1, 1, :t, 'This & That', '2025-11-01')"), {"t": tlc})

# 401 has comps on all three marketplaces. 402 has them ONLY on a proxy.
for item_id, member, version in ((401, 1, 'This Ver.'), (402, 2, 'That Ver.')):
    s.execute(text("INSERT INTO tbl_items (item_id, collection_type_id,"
                   " top_level_category_id) VALUES (:i, :t, :c)"),
              {"i": item_id, "t": type_id, "c": tlc})
    s.execute(text("INSERT INTO tbl_photocard_details (item_id, group_id,"
                   " source_origin_id, version) VALUES (:i, 1, 1, :v)"),
              {"i": item_id, "v": version})
    s.execute(text("INSERT INTO xref_photocard_members (item_id, member_id)"
                   " VALUES (:i, :m)"), {"i": item_id, "m": member})

# A real sell fee, so "net proceeds" is distinguishable from "sell price" and a
# fee model silently resolving to a marketplace with no sell components fails.
s.execute(text("UPDATE mkt_fee_component SET pct = 0.10 WHERE"
               " marketplace_code='mercari_us' AND side='sell' AND seed_key='sell_fee'"))
s.execute(text("INSERT INTO mkt_fx_rate (currency, as_of_date, usd_per_unit, source)"
               " VALUES ('JPY', '2026-01-01', 0.0068, 'manual')"))
s.commit()


def cap(ext, mkt, cur, price, state, lines, when, ship=None, usd=None):
    return {"marketplace": mkt, "currency": cur, "externalId": ext,
            "name": ext, "capturedAt": when, "isLot": False,
            "lines": lines,
            "sightings": [{"observedAt": when, "priceCents": price,
                           "priceUsd": usd, "shippingCents": ship,
                           "listingState": state,
                           "rawStatus": "trading" if state == "sold" else "on_sale"}]}


ONE = lambda i: [{"lineType": "card", "cardId": i, "qty": 1}]

r = c.post("/market/captures", json={"captures": [
    # 401 sold twice on Mercari US: $20 and $24 -> sell price 2200.
    cap("m1", "mercari_us", "USD", 2000, "sold", ONE(401), "2026-08-25T00:00:00Z"),
    cap("m2", "mercari_us", "USD", 2400, "sold", ONE(401), "2026-08-26T00:00:00Z"),
    # The contamination: a Neokyo listing that went out of stock (Y1000 ~ $6.80)
    # and a Pocamarket one that read "sold out" ($5). Both land as 'sold'.
    # Unfiltered these pool to a median of 1340 -- 39% below the truth.
    cap("n1", "neokyo", "JPY", 1000, "sold", ONE(401), "2026-08-27T00:00:00Z"),
    cap("p1", "pocamarket", "USD", 500, "sold", ONE(401), "2026-08-27T00:00:00Z"),
    # 402 has proxy comps and nothing else.
    cap("n2", "neokyo", "JPY", 1200, "sold", ONE(402), "2026-08-27T00:00:00Z"),
    # Live buy routes, to prove the filter did not break the buy side.
    cap("p2", "pocamarket", "USD", 700, "active", ONE(401), "2026-08-30T00:00:00Z"),
    cap("n3", "neokyo", "JPY", 900, "active", ONE(402), "2026-08-30T00:00:00Z"),
]})
assert r.status_code == 200, r.text

grid = {x["item_id"]: x for x in c.get("/market/grid").json()["cards"]}
d401 = c.get("/market/comps/401").json()
d402 = c.get("/market/comps/402").json()


print("--- the seeded side, corrected in place ---")
check("pocamarket is buy-only",
      s.execute(text("SELECT side FROM lkup_mkt_marketplaces"
                     " WHERE marketplace_code = 'pocamarket'")).scalar(), "buy")
check("neokyo unchanged",
      s.execute(text("SELECT side FROM lkup_mkt_marketplaces"
                     " WHERE marketplace_code = 'neokyo'")).scalar(), "buy")
check("mercari_us still sellable",
      s.execute(text("SELECT side FROM lkup_mkt_marketplaces"
                     " WHERE marketplace_code = 'mercari_us'")).scalar(), "both")

print("\n--- the sell price pools Mercari US only ---")
# Median of 2000 and 2400. Unfiltered it would be 1340.
check("sell price is the US median", grid[401]["sell_price_cents"], 2200)
check("built from two comps, not four", grid[401]["n_sold"], 2)
check("and it is credited to Mercari US", grid[401]["sell_marketplace"], "mercari_us")
check("net proceeds take the 10% sell fee", grid[401]["net_proceeds_cents"], 1980)

print("\n--- a card with only proxy comps has NO sell price ---")
# The honest answer. A median of Japanese domestic prices is not evidence of
# what this fetches in the US, and reporting one would be worse than silence.
check("no sell price", grid[402]["sell_price_cents"], None)
check("no net proceeds", grid[402]["net_proceeds_cents"], None)
check("no sold count", grid[402]["n_sold"], 0)
check("but the card is still in the grid", 402 in grid, True)

print("\n--- the same rule on the card detail ---")
check("detail sold stats exclude the proxies", d401["sold"]["n"], 2)
check("detail sell price matches the grid", d401["sold"]["median"], 2200)
check("402's sold stats are empty, not wrong", d402["sold"], None)

print("\n--- the rows are still there: a pooling rule, not a data fix ---")
# The Pocamarket popularity signal lives in exactly these rows. A filter that
# deleted them would fix the median and destroy the signal.
check("all four sold sightings persist for 401",
      s.execute(text(
          "SELECT COUNT(*) FROM mkt_sighting s"
          " JOIN mkt_listing_line ln ON ln.listing_id = s.listing_id"
          " WHERE ln.item_id = 401 AND s.listing_state = 'sold'")).scalar(), 4)
check("including the pocamarket sold-out",
      s.execute(text(
          "SELECT COUNT(*) FROM mkt_sighting s"
          " JOIN mkt_listing l ON l.listing_id = s.listing_id"
          " WHERE l.marketplace = 'pocamarket'"
          "   AND s.listing_state = 'sold'")).scalar(), 1)

print("\n--- the buy side is untouched ---")
# The whole point of these marketplaces. Breaking this to fix the sell side
# would trade one wrong number for another.
check("401 can still be bought on pocamarket",
      grid[401]["buy_single"]["marketplace"], "pocamarket")
check("402 can still be bought on neokyo",
      grid[402]["buy_single"]["marketplace"], "neokyo")
check("proxy asks still reach Buy to Keep",
      d402["keep"]["cheapest_single"]["marketplace"], "neokyo")

print("\n--- competition still excludes places you cannot list ---")
# This half was already right; asserted so the two halves stay in step.
check("no US competition recorded for 402", d402["vs_active"]["n_active"], 0)

print()
if fails:
    print(f"{len(fails)} FAILED: " + ", ".join(fails)); sys.exit(1)
print("all passed")
