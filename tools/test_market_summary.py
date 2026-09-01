"""Phase 2: GET /market/summary -- the library's single source of market facts.

    python tools/test_market_summary.py <a scratch directory>

The claim under test is that ONE payload feeds four library surfaces (the `$`
badge, the has-comps filter, the caption line, the detail modal) and cannot
disagree with the market workspace. So the assertions that matter most are the
ones comparing summary against /grid field for field.

Also pinned: sparseness. Absence from the map IS the "no data" answer, and a
card creeping in with all-null values would silently put a `$` badge on a card
with nothing behind it.
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
               " (1, 'hyunjin', 'Hyunjin', 1, 1), (2, 'felix', 'Felix', 1, 2),"
               " (3, 'han', 'Han', 1, 3), (4, 'chan', 'Bang Chan', 1, 4)"))
s.execute(text("INSERT INTO lkup_photocard_source_origins (source_origin_id,"
               " group_id, top_level_category_id, source_origin_name, start_date)"
               " VALUES (1, 1, :t, 'This & That', '2025-11-01')"), {"t": tlc})

# 501 full data  502 proxy-only  503 WANTED but no data  504 no data, not wanted
for item_id, member in ((501, 1), (502, 2), (503, 3), (504, 4)):
    s.execute(text("INSERT INTO tbl_items (item_id, collection_type_id,"
                   " top_level_category_id) VALUES (:i, :t, :c)"),
              {"i": item_id, "t": type_id, "c": tlc})
    s.execute(text("INSERT INTO tbl_photocard_details (item_id, group_id,"
                   " source_origin_id, version) VALUES (:i, 1, 1, 'This Ver.')"),
              {"i": item_id})
    s.execute(text("INSERT INTO xref_photocard_members (item_id, member_id)"
                   " VALUES (:i, :m)"), {"i": item_id, "m": member})
s.execute(text("INSERT INTO tbl_photocard_copies (item_id, ownership_status_id)"
               " VALUES (503, :w)"), {"w": status_id("wanted")})

s.execute(text("UPDATE mkt_fee_component SET pct = 0.10 WHERE"
               " marketplace_code='mercari_us' AND side='sell' AND seed_key='sell_fee'"))
s.execute(text("INSERT INTO mkt_fx_rate (currency, as_of_date, usd_per_unit, source)"
               " VALUES ('JPY', '2026-01-01', 0.0068, 'manual')"))
# A cost basis on 501 only, via a tier -- so the derived-on-read path is what
# the summary exercises, not a denormalized amount.
tier = s.execute(text("SELECT cost_tier_id FROM mkt_cost_tier WHERE tier_code='t3'")).scalar()
s.execute(text("INSERT INTO mkt_item_cost (item_id, cost_tier_id, source)"
               " VALUES (501, :t, 'rule')"), {"t": tier})
s.commit()


def cap(ext, mkt, cur, price, state, lines, when):
    return {"marketplace": mkt, "currency": cur, "externalId": ext,
            "name": ext, "capturedAt": when, "isLot": False, "lines": lines,
            "sightings": [{"observedAt": when, "priceCents": price,
                           "listingState": state,
                           "rawStatus": "trading" if state == "sold" else "on_sale"}]}


ONE = lambda i: [{"lineType": "card", "cardId": i, "qty": 1}]

r = c.post("/market/captures", json={"captures": [
    cap("m1", "mercari_us", "USD", 2000, "sold",   ONE(501), "2026-08-20T00:00:00Z"),
    cap("m2", "mercari_us", "USD", 2400, "sold",   ONE(501), "2026-08-21T00:00:00Z"),
    cap("m3", "mercari_us", "USD", 3000, "active", ONE(501), "2026-08-22T00:00:00Z"),
    # A proxy ask on the same card: live, so it counts toward "can I get one",
    # but it is not competition and never a sell comp.
    cap("n1", "neokyo",     "JPY", 2500, "active", ONE(501), "2026-08-23T00:00:00Z"),
    # 502 exists only on a proxy. It HAS market data -- a place to buy it --
    # but no sell price at all.
    cap("n2", "neokyo",     "JPY", 1800, "active", ONE(502), "2026-08-24T00:00:00Z"),
]})
assert r.status_code == 200, r.text

summ = c.get("/market/summary").json()
grid = {x["item_id"]: x for x in c.get("/market/grid").json()["cards"]}
cards = summ["cards"]


print("--- sparse: only cards with market data ---")
check("501 present", "501" in cards, True)
check("502 present (proxy data is data)", "502" in cards, True)
# The important one. /grid deliberately includes Wanted cards with no data as a
# go-browse reminder; the library must not badge them, because a `$` on a card
# with nothing behind it is a lie the user cannot check without clicking.
check("503 is Wanted but has no data -- absent", "503" in cards, False)
check("503 IS in the grid, though", 503 in grid, True)
check("504 absent", "504" in cards, False)
check("nothing else crept in", len(cards), 2)

print("\n--- keys are strings, because this is JSON ---")
check("string key works", cards["501"] is not None, True)
check("every key is a string", all(isinstance(k, str) for k in cards), True)

print("\n--- one source: summary and grid agree field for field ---")
for f in ("sell_price_cents", "net_proceeds_cents", "sell_marketplace",
          "n_sold", "last_seen"):
    check(f"501 {f}", cards["501"][f], grid[501][f])
check("501 cost matches the grid's", cards["501"]["cost_cents"],
      grid[501]["cost"]["cost_cents"])

print("\n--- the numbers themselves ---")
check("sell price is the median of 2000 and 2400", cards["501"]["sell_price_cents"], 2200)
check("net proceeds take the 10% fee", cards["501"]["net_proceeds_cents"], 1980)
check("cost resolves through the tier, not a stored amount",
      cards["501"]["cost_cents"], 300)
check("and is flagged as an estimate", cards["501"]["cost_estimated"], True)

print("\n--- n_active answers 'can I get one', not 'who competes with me' ---")
# Both the Mercari US ask and the Neokyo ask. vs_active in the card detail
# counts only the first, and that difference is deliberate.
check("501 has two live asks across both marketplaces", cards["501"]["n_active"], 2)
d501 = c.get("/market/comps/501").json()
check("competition counts only the sellable one", d501["vs_active"]["n_active"], 1)

print("\n--- a proxy-only card: data, but no sell price ---")
check("502 has a live ask", cards["502"]["n_active"], 1)
check("no sell price", cards["502"]["sell_price_cents"], None)
check("no net proceeds", cards["502"]["net_proceeds_cents"], None)
check("no sold comps", cards["502"]["n_sold"], 0)
check("no cost basis recorded", cards["502"]["cost_cents"], None)

print("\n--- last seen is the newest observation from any source ---")
check("501 last seen is the Neokyo ask", cards["501"]["last_seen"][:10], "2026-08-23")

print("\n--- a delisted listing stops counting as available ---")
lid = s.execute(text("SELECT listing_id FROM mkt_listing WHERE external_id = 'n1'")).scalar()
r = c.post(f"/market/listings/{lid}/outcome", json={"outcome": "gone"})
assert r.status_code == 200, r.text
after = c.get("/market/summary").json()["cards"]
check("501 is down to one live ask", after["501"]["n_active"], 1)
check("but the card is still in the map", "501" in after, True)

print()
if fails:
    print(f"{len(fails)} FAILED: " + ", ".join(fails)); sys.exit(1)
print("all passed")
