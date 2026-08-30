"""The lot analyzer, on a fresh DB.

Real photocard rows again, for the same reason the grid test builds them: the
value ladder reads eras off origin ship dates and dispositions off library
ownership status, so a synthetic fixture would pass while a wrong join shipped.

Run:  python tools/test_lot_analyzer.py <scratch-dir>
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
# Two origins on opposite sides of the 2020 era boundary, so rung 2 has two
# buckets to be wrong about.
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
               " VALUES (1, 1, :t, 'Rock Star', '2023-11-10'),"
               "        (2, 1, :t, 'I Am NOT', '2018-03-26')"),
          {"t": tlc})

# 201 Hyunjin (new era)  202 Felix (new)  203 Han (old)  204 Chan (new, wanted)
CARDS = {201: (1, 1, "KM Station"), 202: (2, 1, "Yes24"),
         203: (3, 2, "HMV"), 204: (4, 1, "POB")}
for item_id, (member, origin, version) in CARDS.items():
    s.execute(text("INSERT INTO tbl_items (item_id, collection_type_id,"
                   " top_level_category_id) VALUES (:i, :t, :c)"),
              {"i": item_id, "t": type_id, "c": tlc})
    s.execute(text("INSERT INTO tbl_photocard_details (item_id, group_id,"
                   " source_origin_id, version) VALUES (:i, 1, :o, :v)"),
              {"i": item_id, "o": origin, "v": version})
    s.execute(text("INSERT INTO xref_photocard_members (item_id, member_id)"
                   " VALUES (:i, :m)"), {"i": item_id, "m": member})

# 204 is Wanted -- the standing decision that makes it a keep with no toggling.
s.execute(text("INSERT INTO tbl_photocard_copies (item_id, ownership_status_id)"
               " VALUES (204, :w)"), {"w": status_id("wanted")})
# No fees anywhere, so landed == price and net == gross: this suite is about
# allocation, and a fee model in the middle only makes the arithmetic unreadable.
s.execute(text("UPDATE mkt_fee_component SET pct = 0, fixed_minor = 0"))
s.commit()


def sold(ext, item_id, cents, when):
    """A sole-line sold comp -- rung 1 of the ladder."""
    return {"marketplace": "mercari_us", "currency": "USD", "externalId": ext,
            "name": f"card {item_id}", "capturedAt": "2026-08-30T00:00:00Z",
            "lines": [{"lineType": "card", "cardId": item_id, "qty": 1}],
            "sightings": [{"observedAt": when, "priceCents": cents,
                           "listingState": "sold", "rawStatus": "trading"}]}


# 201 sells $75. 202 sells $10. 203 (old era) sells $40. 204: no comps at all.
c.post("/market/captures", json={"captures": [
    sold("s201", 201, 7500, "2026-08-20T00:00:00Z"),
    sold("s202", 202, 1000, "2026-08-21T00:00:00Z"),
    sold("s203", 203, 4000, "2026-08-22T00:00:00Z"),
    # An active single for 204, so the residual has something to compare against.
    {"marketplace": "mercari_us", "currency": "USD", "externalId": "a204",
     "name": "Chan POB", "capturedAt": "2026-08-30T00:00:00Z",
     "lines": [{"lineType": "card", "cardId": 204, "qty": 1}],
     "sightings": [{"observedAt": "2026-08-30T00:00:00Z", "priceCents": 2200,
                    "listingState": "active", "rawStatus": "on_sale"}]},
    # The lot: $100 for 201 ($75) + 202 ($10) + 204 (no comps, new era).
    {"marketplace": "mercari_us", "currency": "USD", "externalId": "lot1",
     "name": "SKZ 3-card set", "capturedAt": "2026-08-30T00:00:00Z",
     "isLot": True,
     "lines": [{"lineType": "card", "cardId": 201, "qty": 1},
               {"lineType": "card", "cardId": 202, "qty": 1},
               {"lineType": "card", "cardId": 204, "qty": 1}],
     "sightings": [{"observedAt": "2026-08-30T00:00:00Z", "priceCents": 10000,
                    "listingState": "active", "rawStatus": "on_sale"}]},
]})

# A listing FLAGGED a lot but holding one entered card is the common shape --
# one identified card and N unknowns never typed in. Its price is not that
# card's price, and by unit count alone it looks exactly like a sole comp.
c.post("/market/captures", json={"captures": [
    {"marketplace": "mercari_us", "currency": "USD", "externalId": "flagged",
     "name": "Hyunjin + others", "capturedAt": "2026-08-30T00:00:00Z",
     "isLot": True,
     "lines": [{"lineType": "card", "cardId": 202, "qty": 1}],
     "sightings": [{"observedAt": "2026-08-23T00:00:00Z", "priceCents": 9900,
                    "listingState": "sold", "rawStatus": "trading"}]},
]})

lots = c.get("/market/lots")
assert lots.status_code == 200, lots.text
by_id = {x["listing_id"]: x for x in lots.json()["lots"]}
print("--- only lots are lots ---")
check("both the 3-card set and the flagged single are lots", len(by_id), 2)
lot_id = [k for k, v in by_id.items() if v["units"] == 3][0]
check("units counted", by_id[lot_id]["units"], 3)
check("summary carries no lines", "lines" in by_id[lot_id], False)

d = c.get(f"/market/lots/{lot_id}")
assert d.status_code == 200, d.text
lot = d.json()["lot"]
lines = {ln["item_id"]: ln for ln in lot["lines"]}
ladder = d.json()["ladder"]

print("\n--- the value ladder, two rungs ---")
check("landed is the price, fees zeroed", lot["landed_cents"], 10000)
check("201 priced off its own comp", lines[201]["value_cents"], 7500)
check("and says which rung", lines[201]["value_source"], "sold")
check("202 likewise", lines[202]["value_cents"], 1000)
# The $99 flagged-lot sale must not have joined 202's series -- one card of an
# unknown number is not a comp, however few lines were typed in.
check("a flagged lot is not a sole comp", lines[202]["n_sold"], 1)
# New-era comps are 7500 and 1000; their median is 4250. 203 is old era and
# must not leak into it.
check("new-era median excludes the old-era card",
      ladder["era_median"]["new"], (7500 + 1000) // 2)
check("old era has its own median", ladder["era_median"]["old"], 4000)
check("204 has no comp so it falls to its era",
      lines[204]["value_cents"], ladder["era_median"]["new"])
check("and is visibly an estimate", lines[204]["value_source"], "era")

print("\n--- allocation is value-weighted and sums to the lot ---")
allocs = {i: ln["alloc_cents"] for i, ln in lines.items()}
print(f"       {allocs}  total={sum(allocs.values())}")
check("the parts sum to the whole", sum(allocs.values()), 10000)
check("the $75 card carries the most cost",
      max(allocs, key=lambda i: allocs[i]), 201)
# 7500 / (7500+1000+4250) = 58.82% of $100, and the odd cent left over by
# flooring goes to the largest remainder -- which is this line.
check("201's share is its share of value", allocs[201], 5883)
check("margin is value minus allocation",
      lines[202]["margin_cents"], 1000 - allocs[202])
check("lot margin is value minus landed",
      lot["margin_cents"], (7500 + 1000 + 4250) - 10000)

print("\n--- keep/flip defaults come from the library ---")
check("the Wanted card is a keep", lines[204]["disposition"], "keep")
check("derived, not typed", lines[204]["disposition_source"], "library")
check("everything else flips", lines[201]["disposition"], "flip")
r = lot["residual"]
check("keep units", r["keep_units"], 1)
check("flips net the sum of their values", r["flip_net_cents"], 8500)
check("so the keeper costs the residual", r["kept_cost_cents"], 10000 - 8500)
check("buying it separately", r["separate_cost_cents"], 2200)
check("and the lot is better by the difference",
      r["lot_advantage_cents"], 2200 - 1500)

print("\n--- a manual value overrides the ladder ---")
lid = lines[204]["line_id"]
r2 = c.patch(f"/market/lots/{lot_id}/lines/{lid}", json={"value_cents": 2000})
check("patch succeeds", r2.status_code, 200)
lot2 = c.get(f"/market/lots/{lot_id}").json()["lot"]
l2 = {ln["item_id"]: ln for ln in lot2["lines"]}
check("value taken", l2[204]["value_cents"], 2000)
check("and labelled manual", l2[204]["value_source"], "manual")
check("allocation still sums to the whole",
      sum(ln["alloc_cents"] for ln in lot2["lines"]), 10000)
c.patch(f"/market/lots/{lot_id}/lines/{lid}", json={"clear_value": True})
check("clearing goes back to deriving",
      c.get(f"/market/lots/{lot_id}").json()["lot"]["lines"][2]["value_source"], "era")

print("\n--- a flip override beats the library ---")
c.patch(f"/market/lots/{lot_id}/lines/{lid}", json={"disposition": "flip"})
lot3 = c.get(f"/market/lots/{lot_id}").json()["lot"]
check("override taken", lot3["lines"][2]["disposition"], "flip")
check("and marked as typed", lot3["lines"][2]["disposition_source"], "manual")
check("nothing kept, so no comparison", lot3["residual"]["kept_cost_cents"], None)
c.patch(f"/market/lots/{lot_id}/lines/{lid}", json={"clear_disposition": True})

print("\n--- an unvalued non-card line is absorbed, and says so ---")
add = c.post(f"/market/lots/{lot_id}/lines",
             json={"line_type": "non_card", "label": "album", "qty": 1})
check("added", add.status_code, 201)
album_id = add.json()["line_id"]
lot4 = c.get(f"/market/lots/{lot_id}").json()["lot"]
album = [ln for ln in lot4["lines"] if ln["line_id"] == album_id][0]
check("no ladder for a non-card line", album["value_cents"], None)
check("and no allocation", album["alloc_cents"], None)
check("the unvalued unit is reported", lot4["unvalued_units"], 1)
check("the cards still absorb the whole cost",
      sum(ln["alloc_cents"] or 0 for ln in lot4["lines"]), 10000)

c.patch(f"/market/lots/{lot_id}/lines/{album_id}", json={"value_cents": 1200})
lot5 = c.get(f"/market/lots/{lot_id}").json()["lot"]
check("valuing it pulls cost off the cards", lot5["unvalued_units"], 0)
check("and it now takes a share",
      [ln for ln in lot5["lines"] if ln["line_id"] == album_id][0]["alloc_cents"] > 0,
      True)
check("still summing to the whole",
      sum(ln["alloc_cents"] for ln in lot5["lines"]), 10000)

print("\n--- unidentified cards value at the lot's era, not zero ---")
u = c.post(f"/market/lots/{lot_id}/lines",
           json={"line_type": "unidentified", "qty": 2})
uid = u.json()["line_id"]
lot6 = c.get(f"/market/lots/{lot_id}").json()["lot"]
unk = [ln for ln in lot6["lines"] if ln["line_id"] == uid][0]
check("valued off the era, not written off", unk["value_cents"], ladder["era_median"]["new"])
check("qty multiplies the line value", unk["line_value_cents"],
      ladder["era_median"]["new"] * 2)
check("units now count them", lot6["units"], 3 + 1 + 2)
check("and they are called out", lot6["unidentified_units"], 2)
check("allocation holds", sum(ln["alloc_cents"] for ln in lot6["lines"]), 10000)

print("\n--- deleting a line ---")
check("delete works", c.delete(f"/market/lots/{lot_id}/lines/{uid}").status_code, 200)
check("gone twice is a 404",
      c.delete(f"/market/lots/{lot_id}/lines/{uid}").status_code, 404)

print("\n--- two creation paths, two lifetimes ---")
# Ingest replaces a listing's lines wholesale, because the extension holds the
# user's current answer for what is in it. Unscoped, that also erased a non-card
# line added in the analyzer -- silently, through a workflow that looks like
# ordinary re-identification.
app_line = c.post(f"/market/lots/{lot_id}/lines", json={
    "line_type": "non_card", "label": "photobook", "qty": 1,
    "value_cents": 1500}).json()["line_id"]
c.post("/market/captures", json={"captures": [
    {"marketplace": "mercari_us", "currency": "USD", "externalId": "lot1",
     "name": "SKZ 3-card set", "capturedAt": "2026-09-06T00:00:00Z",
     "isLot": True,
     "lines": [{"lineType": "card", "cardId": 201, "qty": 1},
               {"lineType": "card", "cardId": 202, "qty": 1}],
     "sightings": [{"observedAt": "2026-09-06T00:00:00Z", "priceCents": 10000,
                    "listingState": "active", "rawStatus": "on_sale"}]},
]})
after = c.get(f"/market/lots/{lot_id}").json()["lot"]
ids = [ln["line_id"] for ln in after["lines"]]
check("the analyzer's line survives a re-sync", app_line in ids, True)
check("and keeps its value",
      [ln for ln in after["lines"] if ln["line_id"] == app_line][0]["value_cents"],
      1500)
# The extension is still authoritative for its OWN lines: 204 was dropped from
# the capture, so it has to be gone here.
check("a card dropped in the extension is dropped here",
      204 in [ln["item_id"] for ln in after["lines"]], False)
check("and the two it kept are there",
      sorted(ln["item_id"] for ln in after["lines"] if ln["item_id"]), [201, 202])

print("\n--- a value set while capturing arrives with the line ---")
# An album's worth is a judgement made looking at the listing; nothing in the
# value ladder can derive it. So the extension can send it, rather than leaving
# every lot needing a second pass in the app.
c.post("/market/captures", json={"captures": [
    {"marketplace": "mercari_us", "currency": "USD", "externalId": "lot2",
     "name": "SKZ set + album", "capturedAt": "2026-09-07T00:00:00Z",
     "isLot": True,
     "lines": [{"lineType": "card", "cardId": 201, "qty": 1},
               {"lineType": "non_card", "label": "album", "qty": 1,
                "valueCents": 1200},
               {"lineType": "unidentified", "qty": 3}],
     "sightings": [{"observedAt": "2026-09-07T00:00:00Z", "priceCents": 6000,
                    "listingState": "active", "rawStatus": "on_sale"}]},
]})
lot2 = [x for x in c.get("/market/lots").json()["lots"]
        if x["title"] == "SKZ set + album"][0]
detail2 = c.get(f"/market/lots/{lot2['listing_id']}").json()["lot"]
album2 = [ln for ln in detail2["lines"] if ln["line_type"] == "non_card"][0]
check("the captured value is used as-is", album2["value_cents"], 1200)
check("and is labelled as set by hand", album2["value_source"], "manual")
check("so nothing is left unvalued", detail2["unvalued_units"], 0)
check("unidentified cards count toward the units", detail2["units"], 1 + 1 + 3)
check("and are called out", detail2["unidentified_units"], 3)
check("allocation still sums to the whole",
      sum(ln["alloc_cents"] for ln in detail2["lines"]), detail2["landed_cents"])

print("\n--- guards ---")
check("bad disposition refused",
      c.patch(f"/market/lots/{lot_id}/lines/{lid}",
              json={"disposition": "maybe"}).status_code, 400)
check("qty under one refused",
      c.patch(f"/market/lots/{lot_id}/lines/{lid}", json={"qty": 0}).status_code, 400)
check("a single-card listing is not a lot",
      c.get("/market/lots/1").status_code, 404)
check("and the reason says what to do",
      "unidentified" in c.get("/market/lots/1").json()["detail"], True)
check("no such listing", c.get("/market/lots/9999").status_code, 404)

print("\n--- adding a line makes a single listing analyzable ---")
single = c.get("/market/lots/1").status_code
add2 = c.post("/market/lots/1/lines", json={"line_type": "unidentified", "qty": 1})
check("was not a lot", single, 404)
check("line added", add2.status_code, 201)
check("now it is", c.get("/market/lots/1").status_code, 200)

print("\n" + (f"{len(fails)} FAILED: {fails}" if fails else "all passed"))
sys.exit(1 if fails else 0)
