"""The card grid, and sold-vs-gone marking, on a fresh DB.

    python tools/test_market_grid.py <a scratch directory>

Creates a throwaway database in that directory; touches nothing real, and sets
COLLECTCORE_DISABLE_R2 so a dev run cannot reach production R2.

Builds real photocard rows -- groups, members, origins, copies -- so labels,
ownership and Wanted come from the same tables the library uses. A grid tested
against synthetic ids would not catch a wrong join, and joins are most of what
this endpoint is.
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


# --- A small real library --------------------------------------------------
type_id = s.execute(text("SELECT collection_type_id FROM lkup_collection_types"
                         " WHERE collection_type_code = 'photocards'")).scalar()
s.execute(text("INSERT INTO lkup_photocard_groups (group_id, group_name, group_code)"
               " VALUES (1, 'Stray Kids', 'SKZ')"))
s.execute(text("INSERT INTO lkup_photocard_members (member_id, member_code,"
               " member_name, group_id, sort_order)"
               " VALUES (1, 'hyunjin', 'Hyunjin', 1, 1),"
               "        (2, 'felix', 'Felix', 1, 2)"))
tlc = s.execute(text("SELECT top_level_category_id FROM lkup_top_level_categories"
                     " LIMIT 1")).scalar()
s.execute(text("INSERT INTO lkup_photocard_source_origins (source_origin_id,"
               " group_id, top_level_category_id, source_origin_name)"
               " VALUES (1, 1, :t, 'Rock Star')"), {"t": tlc})

CARDS = {101: ("KM Station", 1), 102: ("Yes24", 2), 103: ("HMV", 1)}
for item_id, (version, member) in CARDS.items():
    s.execute(text("INSERT INTO tbl_items (item_id, collection_type_id,"
                   " top_level_category_id) VALUES (:i, :t, :c)"),
              {"i": item_id, "t": type_id, "c": tlc})
    s.execute(text("INSERT INTO tbl_photocard_details (item_id, group_id,"
                   " source_origin_id, version) VALUES (:i, 1, 1, :v)"),
              {"i": item_id, "v": version})
    s.execute(text("INSERT INTO xref_photocard_members (item_id, member_id)"
                   " VALUES (:i, :m)"), {"i": item_id, "m": member})

# 101: two copies held, one for trade. 102: wanted, no data at all.
s.execute(text("INSERT INTO tbl_photocard_copies (item_id, ownership_status_id)"
               " VALUES (101, :o), (101, :t)"),
          {"o": status_id("owned"), "t": status_id("trade")})
s.execute(text("INSERT INTO tbl_photocard_copies (item_id, ownership_status_id)"
               " VALUES (102, :w)"), {"w": status_id("wanted")})

# Cost basis on 101 only.
s.execute(text("INSERT INTO mkt_item_cost (item_id, cost_cents, source, updated_at)"
               " VALUES (101, 250, 'manual', CURRENT_TIMESTAMP)"))
s.execute(text("UPDATE mkt_fee_component SET pct = 0.10 WHERE"
               " marketplace_code='mercari_us' AND side='sell' AND seed_key='sell_fee'"))
s.execute(text("UPDATE mkt_fee_component SET fixed_minor = 350 WHERE"
               " marketplace_code='neokyo' AND side='buy' AND seed_key='svc'"))
s.commit()

# --- Captures --------------------------------------------------------------
c.post("/market/captures", json={"captures": [
    # 101 sold twice on Mercari US, single-card listings.
    {"marketplace": "mercari_us", "currency": "USD", "externalId": "m1",
     "name": "Hyunjin KM Station", "capturedAt": "2026-08-30T00:00:00Z",
     "lines": [{"lineType": "card", "cardId": 101, "label": "Hyunjin", "qty": 1}],
     "sightings": [{"observedAt": "2026-08-28T00:00:00Z", "priceCents": 1800,
                    "listingState": "sold", "rawStatus": "trading"}]},
    {"marketplace": "mercari_us", "currency": "USD", "externalId": "m2",
     "name": "Hyunjin KM Station", "capturedAt": "2026-08-30T00:00:00Z",
     "lines": [{"lineType": "card", "cardId": 101, "label": "Hyunjin", "qty": 1}],
     "sightings": [{"observedAt": "2026-08-29T00:00:00Z", "priceCents": 2200,
                    "listingState": "sold", "rawStatus": "trading"}]},
    # 101 buyable two ways: a single at $16, and a 2-card Neokyo lot.
    {"marketplace": "mercari_us", "currency": "USD", "externalId": "m3",
     "name": "Hyunjin KM Station", "capturedAt": "2026-08-30T00:00:00Z",
     "lines": [{"lineType": "card", "cardId": 101, "label": "Hyunjin", "qty": 1}],
     "sightings": [{"observedAt": "2026-08-30T00:00:00Z", "priceCents": 1600,
                    "listingState": "active", "rawStatus": "on_sale"}]},
    {"marketplace": "neokyo", "currency": "JPY", "externalId": "nk1",
     "name": "SKZ 2-card set", "capturedAt": "2026-08-30T00:00:00Z",
     "lines": [{"lineType": "card", "cardId": 101, "label": "Hyunjin", "qty": 1},
               {"lineType": "card", "cardId": 103, "label": "Hyunjin HMV", "qty": 1}],
     "sightings": [{"observedAt": "2026-08-30T00:00:00Z", "priceCents": 2000,
                    "priceUsd": 1300, "listingState": "active", "rawStatus": "on_sale"}]},
]})

g = c.get("/market/grid")
assert g.status_code == 200, g.text
grid = {x["item_id"]: x for x in g.json()["cards"]}

print("--- scope: market data, plus Wanted even with none ---")
check("three cards in scope", sorted(grid), [101, 102, 103])
check("the wanted card is there with no data", grid[102]["wanted"], True)
check("and it has no comps", grid[102]["comps"], [])
check("labels come from the library, not the capture",
      grid[101]["label"], "Hyunjin · Rock Star · KM Station")

print("\n--- the name in pieces, each its own sortable column ---")
# "Everything from Rock Star" and "every POB" are the two questions a browsable
# list has to answer, and neither is expressible by sorting one composed string.
check("member", grid[101]["members"], "Hyunjin")
check("origin", grid[101]["origin"], "Rock Star")
check("version", grid[101]["version"], "KM Station")
check("and the composed label still comes along",
      grid[101]["label"], "Hyunjin · Rock Star · KM Station")
check("wanted is its own field, not a prefix on the name",
      grid[102]["wanted"], True)

print("\n--- when it was last seen ---")
# Nothing to backfill: mkt_sighting.observed_at is NOT NULL, so every sighting
# ever recorded already carries the date it was seen.
check("the newest observation from ANY source, not the newest per source",
      grid[101]["last_seen"][:10], "2026-08-30")
check("a card with no market data has no date", grid[102]["last_seen"], None)
# 103 is only ever inside the neokyo lot, so its date comes from that sighting
# rather than from a comp of its own.
check("a lot-only card is dated by the lot",
      grid[103]["last_seen"][:10], "2026-08-30")

print("\n--- what I hold ---")
check("owned + trade both count as held", grid[101]["held"], 2)
check("a wanted card is not held", grid[102]["held"], 0)
check("basis is card-level and says so", g.json()["basis_is_per_card"], True)
check("cost", grid[101]["cost"]["cost_cents"], 250)

print("\n--- what it sells for ---")
check("median of the two sold", grid[101]["sell_price_cents"], 2000)
check("net of the 10% sell fee", grid[101]["net_proceeds_cents"], 1800)
check("sold count", grid[101]["n_sold"], 2)
check("flip = net - paid", grid[101]["flip_profit_cents"], 1800 - 250)
check("no flip margin on a card not held", grid[102]["flip_profit_cents"], None)

print("\n--- two buy numbers, never blended ---")
single = grid[101]["buy_single"]
lot = grid[101]["buy_lot"]
check("cheapest single is the $16 Mercari listing", single["per_card_cents"], 1600)
check("the lot is a separate number", lot["line_count"], 2)
print(f"       lot: {lot['currency']} {lot['price_cents']} -> landed"
      f" ${lot['landed_cents']/100:.2f} -> ${lot['per_card_cents']/100:.2f}/card")
check("lot per-card is the landed total split", lot["per_card_cents"],
      round(lot["landed_cents"] / 2))
check("arb uses the cheaper route", grid[101]["resell_profit_cents"],
      1800 - min(single["per_card_cents"], lot["per_card_cents"]))
check("and says when that route is a lot", grid[101]["arb_via_lot"],
      lot["per_card_cents"] < single["per_card_cents"])
# 103 is only ever inside the lot, so it has no single-card route at all.
check("a lot-only card has no single route", grid[103]["buy_single"], None)
check("but does have a lot route", grid[103]["buy_lot"]["line_count"], 2)

print("\n--- comps per source, with age ---")
by_src = {x["marketplace"]: x for x in grid[101]["comps"]}
check("mercari comps counted", by_src["mercari_us"]["n"], 3)
check("neokyo counted separately", by_src["neokyo"]["n"], 1)
check("newest mercari sighting", by_src["mercari_us"]["last_seen"][:10], "2026-08-30")

print("\n--- gone is not sold ---")
lid = lot["listing_id"]
r = c.post(f"/market/listings/{lid}/outcome", json={"outcome": "gone"})
check("marking gone succeeds", r.status_code, 200)
check("it adds no sighting", r.json()["sighting_added"], False)
g2 = {x["item_id"]: x for x in c.get("/market/grid").json()["cards"]}
check("the lot stops being a buy option", g2[101]["buy_lot"], None)
check("the single survives", g2[101]["buy_single"]["per_card_cents"], 1600)
check("no phantom sold comp appeared", g2[101]["n_sold"], 2)

print("\n--- sold WITH a price is a new comp ---")
sid = g2[101]["buy_single"]["listing_id"]
r = c.post(f"/market/listings/{sid}/outcome",
           json={"outcome": "sold", "price_cents": 1500,
                 "observed_at": "2026-08-31T00:00:00Z"})
check("marking sold succeeds", r.status_code, 200)
check("it records a sighting", r.json()["sighting_added"], True)
g3 = {x["item_id"]: x for x in c.get("/market/grid").json()["cards"]}
check("the sale joined the series", g3[101]["n_sold"], 3)
check("median moved to the middle of 15.00/18.00/22.00",
      g3[101]["sell_price_cents"], 1800)
check("and it is no longer buyable", g3[101]["buy_single"], None)

print("\n--- postage rides on the listing, not on an average ---")
# A standing "Shipping I pay" estimate exists precisely because per-listing
# postage is usually unavailable. Where the listing states it, it REPLACES that
# estimate rather than adding to it -- charging both double-counts.
s.execute(text("UPDATE mkt_fee_component SET fixed_minor = 400 WHERE"
               " marketplace_code='mercari_us' AND side='buy' AND seed_key='buy_ship'"))
s.commit()
c.post("/market/captures", json={"captures": [
    # $10.00 with $5.48 of stated postage, and $10.00 with none stated.
    {"marketplace": "mercari_us", "currency": "USD", "externalId": "ship1",
     "name": "Felix Yes24", "capturedAt": "2026-09-01T00:00:00Z",
     "lines": [{"lineType": "card", "cardId": 102, "label": "Felix", "qty": 1}],
     "sightings": [{"observedAt": "2026-09-01T00:00:00Z", "priceCents": 1000,
                    "shippingCents": 548,
                    "listingState": "active", "rawStatus": "on_sale"}]},
    {"marketplace": "mercari_us", "currency": "USD", "externalId": "ship2",
     "name": "Hyunjin HMV", "capturedAt": "2026-09-01T00:00:00Z",
     "lines": [{"lineType": "card", "cardId": 103, "label": "Hyunjin", "qty": 1}],
     "sightings": [{"observedAt": "2026-09-01T00:00:00Z", "priceCents": 1000,
                    "listingState": "active", "rawStatus": "on_sale"}]},
]})
g4 = {x["item_id"]: x for x in c.get("/market/grid").json()["cards"]}
check("stated postage replaces the estimate",
      g4[102]["buy_single"]["landed_cents"], 1000 + 548)
check("and is reported as known", g4[102]["buy_single"]["shipping_known"], True)
check("no stated postage leaves the estimate standing",
      g4[103]["buy_single"]["landed_cents"], 1000 + 400)
check("and says the postage is not real",
      g4[103]["buy_single"]["shipping_known"], False)

# Free shipping is a real answer and switches the estimate off; unread does not.
c.post("/market/captures", json={"captures": [
    {"marketplace": "mercari_us", "currency": "USD", "externalId": "ship3",
     "name": "Felix Yes24 free post", "capturedAt": "2026-09-02T00:00:00Z",
     "lines": [{"lineType": "card", "cardId": 102, "label": "Felix", "qty": 1}],
     "sightings": [{"observedAt": "2026-09-02T00:00:00Z", "priceCents": 900,
                    "shippingCents": 0,
                    "listingState": "active", "rawStatus": "on_sale"}]},
]})
g5 = {x["item_id"]: x for x in c.get("/market/grid").json()["cards"]}
check("free shipping means free, not the estimate",
      g5[102]["buy_single"]["landed_cents"], 900)

print("\n--- deleting a listing takes its children with it ---")
# SQLite FK cascades never fire here -- PRAGMA foreign_keys is issued only on
# init_db's own connection -- so a delete that trusted the FOREIGN KEY clauses
# would leave orphaned sightings behind, still counted by every comp query.
before = s.execute(text("SELECT COUNT(*) FROM mkt_sighting")).scalar()
victim = c.get("/market/grid").json()["cards"]
vid = [x for x in victim if x["item_id"] == 103][0]["buy_single"]["listing_id"]
kids = s.execute(text("SELECT COUNT(*) FROM mkt_sighting WHERE listing_id = :i"),
                 {"i": vid}).scalar()
r = c.delete(f"/market/listings/{vid}")
check("delete succeeds", r.status_code, 200)
check("it reports what it removed", r.json()["sightings_deleted"], kids)
check("no orphaned sightings",
      s.execute(text("SELECT COUNT(*) FROM mkt_sighting WHERE listing_id = :i"),
                {"i": vid}).scalar(), 0)
check("no orphaned lines",
      s.execute(text("SELECT COUNT(*) FROM mkt_listing_line WHERE listing_id = :i"),
                {"i": vid}).scalar(), 0)
check("and only that listing's sightings went",
      s.execute(text("SELECT COUNT(*) FROM mkt_sighting")).scalar(), before - kids)
check("the listing is gone from buy options",
      c.get("/market/grid").json()["cards"] and
      [x for x in c.get("/market/grid").json()["cards"]
       if x["item_id"] == 103][0]["buy_single"], None)
check("deleting it twice is a 404",
      c.delete(f"/market/listings/{vid}").status_code, 404)
check("and a listing that never existed too",
      c.delete("/market/listings/999999").status_code, 404)

print("\n--- re-capturing needs no delete ---")
# Ingest keys listings on (marketplace, external_id), so browsing back to a
# page and capturing again updates that row and appends a sighting. That is the
# refresh path: it keeps the history, where delete throws it away.
#
# `ship1` was captured earlier at $10.00 with $5.48 postage. Re-capture it at a
# dropped price -- which is what pressing the extension's refresh button does.
def listing_row(ext):
    return s.execute(text(
        "SELECT listing_id, (SELECT COUNT(*) FROM mkt_sighting v"
        "   WHERE v.listing_id = l.listing_id) AS n "
        "FROM mkt_listing l WHERE l.external_id = :e"), {"e": ext}).fetchone()

was_id, was_n = listing_row("ship1")
listings_before = s.execute(text("SELECT COUNT(*) FROM mkt_listing")).scalar()
c.post("/market/captures", json={"captures": [
    {"marketplace": "mercari_us", "currency": "USD", "externalId": "ship1",
     "name": "Felix Yes24", "capturedAt": "2026-09-03T00:00:00Z",
     "lines": [{"lineType": "card", "cardId": 102, "label": "Felix", "qty": 1}],
     "sightings": [{"observedAt": "2026-09-03T00:00:00Z", "priceCents": 800,
                    "shippingCents": 300,
                    "listingState": "active", "rawStatus": "on_sale"}]},
]})
now_id, now_n = listing_row("ship1")
check("the same listing row, not a second one", now_id, was_id)
check("no new listing was created",
      s.execute(text("SELECT COUNT(*) FROM mkt_listing")).scalar(), listings_before)
check("a sighting was appended", now_n, was_n + 1)
# The old observation is kept -- it really was seen at $10.00 -- and the buy
# side reads only the newest, which is what makes a refresh a refresh.
opts = {o["listing_id"]: o for o in c.get("/market/comps/102").json()["buy_options"]}
check("the buy side prices it off the newest sighting",
      opts[was_id]["landed_cents"], 800 + 300)
check("and the earlier sighting is still on file", now_n >= 2, True)

print("\n--- a re-capture with no lines does not unidentify ---")
# The card associations live in the EXTENSION. A listing re-captured after its
# local record was cleared comes back with no lines at all, and replacing lines
# wholesale there would silently unidentify every card on it -- destroying work
# through an omission rather than a decision.
def lines_on(ext):
    return s.execute(text(
        "SELECT COUNT(*) FROM mkt_listing_line ln JOIN mkt_listing l"
        "  ON l.listing_id = ln.listing_id WHERE l.external_id = :e"),
        {"e": ext}).scalar()

check("the lot came in with two cards", lines_on("nk1"), 2)
r = c.post("/market/captures", json={"captures": [
    {"marketplace": "neokyo", "currency": "JPY", "externalId": "nk1",
     "name": "SKZ 2-card set", "capturedAt": "2026-09-04T00:00:00Z",
     "lines": [],
     "sightings": [{"observedAt": "2026-09-04T00:00:00Z", "priceCents": 1800,
                    "priceUsd": 1200, "listingState": "active",
                    "rawStatus": "on_sale"}]},
]})
check("the re-capture is accepted", r.status_code, 200)
check("and the cards are still on it", lines_on("nk1"), 2)
check("it merged rather than making a second listing",
      r.json()["listings_new"], 0)

# The panel cannot know any of that on its own, so the response says it --
# otherwise a record that reads as unidentified work is indistinguishable from
# one that really is.
res = {x["externalId"]: x for x in r.json()["results"]}
check("the response reports what the server holds",
      res["nk1"]["linesOnServer"], 2)
check("and that the capture did not replace them",
      res["nk1"]["linesReplaced"], False)

# A capture that DOES bring lines is still authoritative: removing a card in
# the extension has to remove it here.
r2 = c.post("/market/captures", json={"captures": [
    {"marketplace": "neokyo", "currency": "JPY", "externalId": "nk1",
     "name": "SKZ 2-card set", "capturedAt": "2026-09-05T00:00:00Z",
     "lines": [{"lineType": "card", "cardId": 101, "label": "Hyunjin", "qty": 1}],
     "sightings": [{"observedAt": "2026-09-05T00:00:00Z", "priceCents": 1800,
                    "priceUsd": 1200, "listingState": "active",
                    "rawStatus": "on_sale"}]},
]})
check("a capture WITH lines still replaces them", lines_on("nk1"), 1)
check("and says so", {x["externalId"]: x for x in r2.json()["results"]}
      ["nk1"]["linesReplaced"], True)

print("\n--- a sale with no price is refused ---")
r = c.post(f"/market/listings/{lid}/outcome", json={"outcome": "sold"})
check("refused", r.status_code, 400)
check("and says why", "gone instead" in r.json()["detail"], True)

print("\n" + (f"{len(fails)} FAILED: {fails}" if fails else "all passed"))
sys.exit(1 if fails else 0)
