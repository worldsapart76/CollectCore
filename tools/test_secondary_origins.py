"""Secondary source origins: a card in two origins at once.

    python tools/test_secondary_origins.py <a scratch directory>

A Non-Album tour set (Dominate) whose backs read an album (Hollow) is in BOTH
origins: Dominate stays the primary (tbl_photocard_details.source_origin_id),
Hollow is a row in xref_photocard_secondary_origins. Pinned here:

  * reads attach `secondary_origins` with the category, which the shared
    filter needs so Album -> Hollow doesn't hide a Non-Album card;
  * invariant 1 -- a card's secondary list never holds its own primary;
  * invariant 2 -- moving the primary onto a current secondary drops that row,
    on the single-card PUT and on bulk;
  * invariant 3 -- same group only (400 on PUT, skipped in bulk);
  * a PUT that doesn't send secondary_origin_ids leaves them alone (the Inbox
    and older callers don't know about the field);
  * both delete paths leave no orphan xref rows (FK cascades never fire);
  * the lookup admin counts a secondary as a reference, and merge doesn't leave
    a card holding its primary as a secondary;
  * the card book repeats the card under each origin, labelled correctly.
"""
import os, sys, sqlite3

SCRATCH = sys.argv[1]
os.environ["COLLECTCORE_DATA_DIR"] = SCRATCH
os.environ["COLLECTCORE_DISABLE_R2"] = "1"
sys.path.insert(0, os.path.abspath("backend"))

import db as dbmod
dbmod.init_db()

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import text
from routers import photocards, shared, admin_lookups
from db import SessionLocal

app = FastAPI()
# Same order as main.py: shared first, or /photocards/{item_id} swallows
# /photocards/source-origins.
app.include_router(shared.router)
app.include_router(photocards.router)
app.include_router(admin_lookups.router)
c = TestClient(app)
s = SessionLocal()

fails = []
def check(label, got, want):
    ok = got == want
    print(f"{'ok  ' if ok else 'FAIL'}  {label}  got={got!r} want={want!r}")
    if not ok: fails.append(label)


# --- fixtures ----------------------------------------------------------------
type_id = s.execute(text("SELECT collection_type_id FROM lkup_collection_types"
                         " WHERE collection_type_code = 'photocards'")).scalar()
cats = [r[0] for r in s.execute(text(
    "SELECT top_level_category_id FROM lkup_top_level_categories"
    " WHERE collection_type_id = :t ORDER BY top_level_category_id"), {"t": type_id})]
while len(cats) < 2:
    cats.append(s.execute(text(
        "INSERT INTO lkup_top_level_categories (collection_type_id, category_name, sort_order)"
        " VALUES (:t, :n, 9) RETURNING top_level_category_id"),
        {"t": type_id, "n": f"TestCat{len(cats)}"}).scalar())
ALBUM, NON_ALBUM = cats[0], cats[1]

s.execute(text("INSERT INTO lkup_photocard_groups (group_id, group_name, group_code)"
               " VALUES (1, 'Stray Kids', 'SKZ'), (2, 'Other Group', 'OTH')"))

def origin(group, cat, name):
    return s.execute(text(
        "INSERT INTO lkup_photocard_source_origins"
        " (group_id, top_level_category_id, source_origin_name)"
        " VALUES (:g, :c, :n) RETURNING source_origin_id"),
        {"g": group, "c": cat, "n": name}).scalar()

DOMINATE = origin(1, NON_ALBUM, "Dominate")
HOLLOW   = origin(1, ALBUM, "Hollow")
HOP      = origin(1, ALBUM, "Hop")
HOLLOW2  = origin(1, ALBUM, "Hollow (dup)")
FOREIGN  = origin(2, ALBUM, "Foreign")
s.commit()

status = s.execute(text("SELECT ownership_status_id FROM lkup_ownership_statuses"
                        " WHERE status_code = 'owned'")).scalar()

def new_card(primary, cat=NON_ALBUM):
    r = c.post("/photocards", json={
        "collection_type_id": type_id, "top_level_category_id": cat,
        "ownership_status_id": status, "group_id": 1,
        "source_origin_id": primary, "member_ids": [],
    })
    assert r.status_code == 200, r.text
    return r.json()["item_id"]

def put(item_id, primary, cat=NON_ALBUM, **extra):
    return c.put(f"/photocards/{item_id}", json={
        "top_level_category_id": cat, "source_origin_id": primary,
        "member_ids": [], **extra})

def secondaries(item_id):
    return [o["source_origin_id"] for o in c.get(f"/photocards/{item_id}").json()["secondary_origins"]]

def xref_rows(item_id):
    return s.execute(text("SELECT COUNT(*) FROM xref_photocard_secondary_origins"
                          " WHERE item_id = :i"), {"i": item_id}).scalar()


# --- reads + single-card replace ----------------------------------------------
a = new_card(DOMINATE)
check("new card has no secondaries", secondaries(a), [])

r = put(a, DOMINATE, secondary_origin_ids=[HOLLOW, DOMINATE])
check("PUT ok", r.status_code, 200)
check("own primary dropped silently (inv 1)", secondaries(a), [HOLLOW])
so = r.json()["photocard"]["secondary_origins"][0]
check("secondary carries its category", so["top_level_category_id"], ALBUM)
check("secondary carries its name", so["source_origin_name"], "Hollow")
check("list endpoint attaches too",
      [x["secondary_origins"] for x in c.get("/photocards").json() if x["item_id"] == a][0][0]["source_origin_id"],
      HOLLOW)

put(a, DOMINATE)  # no secondary_origin_ids at all
check("PUT without the field leaves them alone", secondaries(a), [HOLLOW])

r = put(a, DOMINATE, secondary_origin_ids=[FOREIGN])
check("cross-group PUT is a 400 (inv 3)", r.status_code, 400)
check("...and changes nothing", secondaries(a), [HOLLOW])

r = put(a, DOMINATE, secondary_origin_ids=[999999])
check("unknown origin is a 400", r.status_code, 400)

put(a, HOLLOW, cat=ALBUM)
check("primary moved onto secondary drops it (inv 2, PUT)", secondaries(a), [])
put(a, DOMINATE, secondary_origin_ids=[])  # reset


# --- bulk add / remove --------------------------------------------------------
b1, b2, b3 = new_card(DOMINATE), new_card(DOMINATE), new_card(HOLLOW, cat=ALBUM)
ids = [b1, b2, b3]

r = c.patch("/photocards/bulk", json={"item_ids": ids,
                                       "fields": {"secondary_origins_add": [HOLLOW]}})
check("bulk add result", r.json()["secondary_origins"], {"added": 2, "removed": 0, "skipped": 1})
check("b1 tagged", secondaries(b1), [HOLLOW])
check("b3 (Hollow primary) not tagged with itself", secondaries(b3), [])

r = c.patch("/photocards/bulk", json={"item_ids": ids,
                                       "fields": {"secondary_origins_add": [HOLLOW]}})
check("bulk add is idempotent", r.json()["secondary_origins"], {"added": 0, "removed": 0, "skipped": 1})

r = c.patch("/photocards/bulk", json={"item_ids": [b1], "fields": {"secondary_origins_add": [FOREIGN]}})
check("bulk cross-group add is skipped, not a 400", (r.status_code, r.json()["secondary_origins"]["skipped"]), (200, 1))

c.patch("/photocards/bulk", json={"item_ids": [b1], "fields": {"secondary_origins_add": [HOP]}})
check("bulk add keeps existing (add, not replace)", sorted(secondaries(b1)), sorted([HOLLOW, HOP]))

r = c.patch("/photocards/bulk", json={"item_ids": ids, "fields": {"secondary_origins_remove": [HOP]}})
check("bulk remove result", r.json()["secondary_origins"]["removed"], 1)
check("b1 back to Hollow only", secondaries(b1), [HOLLOW])

c.patch("/photocards/bulk", json={"item_ids": [b2], "fields": {"source_origin_id": HOLLOW}})
check("bulk primary moved onto secondary drops it (inv 2, bulk)", secondaries(b2), [])

r = c.patch("/photocards/bulk", json={"item_ids": [b2], "fields": {"is_special": True}})
check("bulk edit without secondary fields reports none", "secondary_origins" in r.json(), False)


# --- origin picker endpoint -----------------------------------------------------
all_g1 = c.get("/photocards/source-origins", params={"group_id": 1}).json()
check("no category -> every category in the group",
      sorted(o["source_origin_id"] for o in all_g1), sorted([DOMINATE, HOLLOW, HOP, HOLLOW2]))
check("rows carry category_name", all(o.get("category_name") for o in all_g1), True)
scoped = c.get("/photocards/source-origins", params={"group_id": 1, "category_id": ALBUM}).json()
check("with category -> old shape unchanged",
      sorted(scoped[0].keys()), ["source_origin_id", "source_origin_name"])


# --- lookup admin: reference counting + merge --------------------------------------
m = new_card(HOLLOW2, cat=ALBUM)        # primary Hollow(dup), secondary Hollow
put(m, HOLLOW2, cat=ALBUM, secondary_origin_ids=[HOLLOW])
n = new_card(HOLLOW, cat=ALBUM)         # primary Hollow, secondary Hollow(dup)
put(n, HOLLOW, cat=ALBUM, secondary_origin_ids=[HOLLOW2])

r = c.post("/admin/lookups/lkup_photocard_source_origins/merge",
           json={"source_id": HOLLOW2, "target_id": HOLLOW})
check("merge ok", r.status_code, 200)
check("merge: card m (primary merged away) keeps no self-secondary", secondaries(m), [])
check("merge: card n (secondary merged away) keeps no self-secondary", secondaries(n), [])

only_secondary = origin(1, ALBUM, "Only Secondary")
s.commit()
put(b1, DOMINATE, secondary_origin_ids=[HOLLOW, only_secondary])
s.execute(text("UPDATE lkup_photocard_source_origins SET is_active = 0"
               " WHERE source_origin_id = :o"), {"o": only_secondary})
s.commit()
r = c.delete(f"/admin/lookups/lkup_photocard_source_origins/{only_secondary}")
check("hard-delete blocked while used only as a secondary", r.status_code, 409)


# --- card book ----------------------------------------------------------------
import pdf_card_book
conn = sqlite3.connect(str(dbmod.DB_PATH))
cards, _, _ = pdf_card_book.load_cards(conn, {})
book_b1 = [x for x in cards if x.item_id == b1][0]
check("card book loads secondaries", sorted(o for o, _ in book_b1.secondary_origins),
      sorted([HOLLOW, only_secondary]))
conn.close()


# --- delete paths leave no orphans --------------------------------------------
check("before delete b1 has rows", xref_rows(b1) > 0, True)
c.delete(f"/photocards/{b1}")
check("single delete cleans xref", xref_rows(b1), 0)

put(a, DOMINATE, secondary_origin_ids=[HOLLOW])
c.post("/photocards/bulk-delete", json={"item_ids": [a]})
check("bulk delete cleans xref", xref_rows(a), 0)


print()
print("FAILED:" if fails else "all passed", *fails)
sys.exit(1 if fails else 0)
