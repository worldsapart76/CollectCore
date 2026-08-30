"""Fee-component seeding, across a restart.

    python tools/test_fee_seeding.py <a scratch directory>

Seeding runs on every boot, so what it OWNS and what it must leave alone is a
correctness question, not a style one: a seed that reapplies a user's setting is
a silent edit arriving with no action and nothing on screen to show for it.

Creates a throwaway database in that directory; touches nothing real.
"""
import os, sys

SCRATCH = sys.argv[1]
os.environ["COLLECTCORE_DATA_DIR"] = SCRATCH
os.environ["COLLECTCORE_DISABLE_R2"] = "1"
sys.path.insert(0, os.path.abspath("backend"))

import db as dbmod
dbmod.init_db()

from sqlalchemy import text
from db import SessionLocal

s = SessionLocal()

fails = []
def check(label, got, want):
    ok = got == want
    print(f"{'ok  ' if ok else 'FAIL'}  {label}  got={got!r} want={want!r}")
    if not ok: fails.append(label)


def line(code, side, key):
    return s.execute(text(
        "SELECT label, scope, pct, fixed_minor FROM mkt_fee_component "
        "WHERE marketplace_code = :c AND side = :s AND seed_key = :k"),
        {"c": code, "s": side, "k": key}).fetchone()


def reboot():
    """What a deploy does: run the seeds again over an existing database."""
    s.commit()
    dbmod.init_db()


print("--- Pocamarket charges one fee, so it seeds one line ---")
check("shipping is there", line("pocamarket", "buy", "ship") is not None, True)
check("and it is a per-BOX charge", line("pocamarket", "buy", "ship")[1],
      "per_shipment")
# Three permanently blank rows are not neutral: a blank amount reads as "still
# to fill in", forever.
for key in ("svc", "pay", "duty"):
    check(f"no {key} line", line("pocamarket", "buy", key), None)
check("neokyo keeps its four", s.execute(text(
    "SELECT COUNT(*) FROM mkt_fee_component "
    "WHERE marketplace_code = 'neokyo' AND side = 'buy'")).scalar(), 4)

print("\n--- a seed never overwrites what someone set ---")
# scope has a control in the UI (per item / per box). Re-applying the seeded
# value on every boot silently reverted it -- for a per-box shipping charge
# that is the whole amount landing on ONE card instead of forty.
s.execute(text(
    "UPDATE mkt_fee_component SET scope = 'per_item', fixed_minor = 1200 "
    "WHERE marketplace_code = 'pocamarket' AND side = 'buy' AND seed_key = 'ship'"))
s.commit()
reboot()
after = line("pocamarket", "buy", "ship")
check("the scope someone chose survives a restart", after[1], "per_item")
check("and so does the amount", after[3], 1200)

# Labels and ordering ARE the seed's, which is the point of seed_key: a label
# can be improved without creating a second generation of the same row.
s.execute(text(
    "UPDATE mkt_fee_component SET label = 'renamed by hand' "
    "WHERE marketplace_code = 'pocamarket' AND side = 'buy' AND seed_key = 'ship'"))
s.commit()
reboot()
check("the label is the seed's to set", line("pocamarket", "buy", "ship")[0],
      "Shipping + handling")
check("still exactly one shipping row", s.execute(text(
    "SELECT COUNT(*) FROM mkt_fee_component WHERE marketplace_code = 'pocamarket'"
    " AND side = 'buy' AND seed_key = 'ship'")).scalar(), 1)

print("\n--- retirement never destroys a filled-in line ---")
# The rule the LEGACY block already works under: a line someone deliberately
# put a number in is evidence, and a seed does not get to delete evidence.
s.execute(text(
    "INSERT INTO mkt_fee_component (marketplace_code, side, seed_key, label,"
    " scope, pct, fixed_minor, sort_order) VALUES"
    " ('pocamarket', 'buy', 'duty', 'Import tax / duty', 'per_item', 0.05, 0, 3),"
    " ('pocamarket', 'buy', 'pay',  'Payment fee',        'per_item', 0, 0, 2)"))
s.commit()
reboot()
check("a duty line with a rate on it stays",
      line("pocamarket", "buy", "duty")[2], 0.05)
check("an empty one is retired again", line("pocamarket", "buy", "pay"), None)

print("\n--- and the whole thing is idempotent ---")
before = s.execute(text("SELECT COUNT(*) FROM mkt_fee_component")).scalar()
reboot()
reboot()
check("no rows accumulate across boots",
      s.execute(text("SELECT COUNT(*) FROM mkt_fee_component")).scalar(), before)

print("\n" + (f"{len(fails)} FAILED: {fails}" if fails else "all passed"))
sys.exit(1 if fails else 0)
