"""Market intel — capture ingest and price comps.

Admin only. Receives listing captures from the browser extension and answers
"what does this card actually go for". Design:
docs/photocard_market_intel_plan.md.

Strictly additive: nothing here reads or writes tbl_photocard_details, the
catalog, the pricing tables, or /pcs/. The only link to the library is a
nullable item_id on a line.
"""

import json
from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import text

from dependencies import get_db

router = APIRouter(tags=["market"], prefix="/market")


# ---------- Currency ----------
#
# The native amount is always the record. USD is derived, stored alongside, and
# labelled with the rate and where it came from — never substituted for the
# original. Storing only USD would destroy the ability to answer a different
# question later: "what would this have cost me then" wants the rate at
# observation, "what should I pay now" wants today's rate over native prices,
# and those diverge whenever a currency moves.


# Minor-unit exponents. JPY and KRW have no subdivision, so 2500 JPY is 2500
# yen, NOT 25.00. Assuming 2 everywhere is the classic currency bug and it
# produced a 100x error here: ¥2500 converted to $0.17 instead of $17.00.
CURRENCY_EXPONENT = {"USD": 2, "EUR": 2, "GBP": 2, "CAD": 2, "JPY": 0, "KRW": 0}


def minor_exp(currency: str) -> int:
    return CURRENCY_EXPONENT.get((currency or "USD").upper(), 2)


def to_usd_minor(amount_minor, currency: str, usd_per_unit) -> Optional[int]:
    """Native minor units -> USD cents, via major units so exponents cancel."""
    if amount_minor is None or usd_per_unit is None:
        return None
    major = amount_minor / (10 ** minor_exp(currency))
    return round(major * usd_per_unit * 100)


def implied_rate(amount_minor, currency: str, usd_minor) -> Optional[float]:
    """The USD-per-unit a marketplace's own conversion implies."""
    if not amount_minor or usd_minor is None:
        return None
    major = amount_minor / (10 ** minor_exp(currency))
    return (usd_minor / 100) / major if major else None


def marketplace_currency(db, code: str) -> str:
    row = db.execute(
        text(
            "SELECT currency FROM lkup_mkt_marketplaces "
            "WHERE marketplace_code = :c"
        ),
        {"c": code},
    ).fetchone()
    return row[0] if row else "USD"


def rate_for(db, currency: str, on_date: str) -> Optional[float]:
    """Most recent rate effective on or before `on_date`.

    Deliberately not interpolated and never extrapolated backwards: a rate
    entered today says nothing about what the yen did last month, and quietly
    applying it to older sightings would invent history.
    """
    if currency == "USD":
        return 1.0
    row = db.execute(
        text(
            "SELECT usd_per_unit FROM mkt_fx_rate "
            "WHERE currency = :c AND as_of_date <= :d "
            "ORDER BY as_of_date DESC LIMIT 1"
        ),
        {"c": currency, "d": on_date[:10]},
    ).fetchone()
    return row[0] if row else None


# ---------- Ingest ----------


class CaptureLine(BaseModel):
    lineType: str = "card"
    cardId: Optional[int] = None
    label: Optional[str] = None
    qty: int = 1
    notes: Optional[str] = None


class Sighting(BaseModel):
    observedAt: str
    priceCents: Optional[int] = None
    listingState: str
    rawStatus: Optional[str] = None
    # Set only when the marketplace did the conversion itself. Neokyo shows a
    # USD figure alongside the yen, and that is the amount actually charged, so
    # it beats any rate we would look up.
    priceUsd: Optional[int] = None
    # What the page said shipping costs, same currency and minor units as
    # priceCents. None means "not read"; 0 means the listing says free.
    shippingCents: Optional[int] = None


# Marketplaces are not consistent about scalar types, and pydantic v2 does not
# coerce: Mercari's seller id arrives as the integer 771088348, which rejected
# an entire sync batch with a bare 422. These fields are labels, not numbers, so
# a numeric one is stringified rather than refused — losing a whole capture
# batch over the type of an id nobody computes with is the worse outcome.
def _as_text(v):
    if v is None or isinstance(v, str):
        return v
    if isinstance(v, bool):
        return str(v).lower()
    if isinstance(v, (int, float)):
        return str(v)
    return str(v)


class Capture(BaseModel):
    marketplace: str
    currency: Optional[str] = None  # defaults from the marketplace
    externalId: str
    listingUrl: Optional[str] = None
    name: Optional[str] = None
    itemCondition: Optional[str] = None
    category: Optional[str] = None
    categoryId: Optional[int] = None
    brand: Optional[str] = None
    thumbnailUrl: Optional[str] = None
    searchQuery: Optional[str] = None
    isLot: bool = False
    suspectedLot: bool = False
    viaFallback: bool = False
    # Detail-page capture only; absent on sweeps. None means "not looked at",
    # which is NOT the same as "no shipping" — the fee model must never read a
    # null here as free shipping.
    captureTier: str = "sweep"
    shippingPayerCode: Optional[str] = None
    description: Optional[str] = None
    sellerId: Optional[str] = None
    # {originalFieldName: ISO8601}. Which key means posted vs sold is still
    # unconfirmed, so it is stored as found rather than mapped on the way in.
    dates: Optional[Dict[str, str]] = None
    capturedAt: str
    lines: List[CaptureLine] = Field(default_factory=list)
    sightings: List[Sighting] = Field(default_factory=list)

    @field_validator(
        "name", "itemCondition", "category", "brand", "thumbnailUrl",
        "searchQuery", "listingUrl", "shippingPayerCode", "description",
        "sellerId", "currency",
        mode="before",
    )
    @classmethod
    def _stringify(cls, v):
        return _as_text(v)


class CaptureBatch(BaseModel):
    captures: List[Capture]


@router.post("/captures")
def ingest_captures(batch: CaptureBatch, db=Depends(get_db)):
    """
    Upsert a batch of captures from the extension.

    Idempotent by design — the extension has no way to know what the server
    already holds, so re-syncing the same batch (or an overlapping one) must be
    harmless. Listings key on (marketplace, external_id) and sightings on
    (listing_id, observed_at); both are UNIQUE, so a repeat is a no-op update
    rather than a duplicate row.
    """
    listings_new = sightings_new = lines_new = 0
    # {(currency, YYYY-MM-DD): (usd_per_unit, native_price_it_came_from)}
    implied_fx: Dict[Any, Any] = {}
    # One entry per capture, so the panel can tell "this still needs
    # identifying" from "the server already knows what is in it". A record
    # re-captured after being cleared locally arrives with no lines and looks
    # unidentified, when the identification is safe on the server -- and
    # nothing in the aggregate counts below can say so.
    results: List[Dict[str, Any]] = []

    for cap in batch.captures:
        currency = cap.currency or marketplace_currency(db, cap.marketplace)
        row = db.execute(
            text(
                "SELECT listing_id FROM mkt_listing "
                "WHERE marketplace = :mp AND external_id = :ext"
            ),
            {"mp": cap.marketplace, "ext": cap.externalId},
        ).fetchone()

        seen = [s.observedAt for s in cap.sightings] or [cap.capturedAt]
        first_seen, last_seen = min(seen), max(seen)

        if row is None:
            listing_id = db.execute(
                text(
                    "INSERT INTO mkt_listing ("
                    " marketplace, external_id, listing_url, title_raw,"
                    " item_condition, category, category_id, brand,"
                    " thumbnail_url, search_query, is_lot, suspected_lot,"
                    " via_fallback, capture_tier, shipping_payer, description,"
                    " seller_id, source_dates, first_seen_at, last_seen_at) "
                    "VALUES (:mp, :ext, :url, :title, :cond, :cat, :cat_id,"
                    " :brand, :thumb, :q, :lot, :slot, :fb, :tier, :ship,"
                    " :descr, :seller, :sdates, :first, :last) "
                    "RETURNING listing_id"
                ),
                {
                    "mp": cap.marketplace,
                    "ext": cap.externalId,
                    "url": cap.listingUrl,
                    "title": cap.name,
                    "cond": cap.itemCondition,
                    "cat": cap.category,
                    "cat_id": cap.categoryId,
                    "brand": cap.brand,
                    "thumb": cap.thumbnailUrl,
                    "q": cap.searchQuery,
                    "lot": int(cap.isLot),
                    "slot": int(cap.suspectedLot),
                    "fb": int(cap.viaFallback),
                    "tier": cap.captureTier,
                    "ship": cap.shippingPayerCode,
                    "descr": cap.description,
                    "seller": cap.sellerId,
                    "sdates": json.dumps(cap.dates) if cap.dates else None,
                    "first": first_seen,
                    "last": last_seen,
                },
            ).scalar_one()
            listings_new += 1
        else:
            listing_id = row[0]
            # The extension is authoritative for judgement calls the user made
            # there (is_lot), and for the newest sighting time.
            db.execute(
                text(
                    # Upgrade-only on the detail fields. A later sweep of a
                    # listing already opened must not null out its shipping or
                    # description, so COALESCE keeps what is known and the tier
                    # only ever climbs.
                    "UPDATE mkt_listing SET "
                    " is_lot = :lot, suspected_lot = :slot,"
                    " last_seen_at = MAX(last_seen_at, :last),"
                    " capture_tier = CASE WHEN :tier = 'detail' THEN 'detail'"
                    "                     ELSE capture_tier END,"
                    " shipping_payer = COALESCE(:ship, shipping_payer),"
                    " description = COALESCE(:descr, description),"
                    " seller_id = COALESCE(:seller, seller_id),"
                    " source_dates = COALESCE(:sdates, source_dates) "
                    "WHERE listing_id = :id"
                ),
                {
                    "lot": int(cap.isLot),
                    "slot": int(cap.suspectedLot),
                    "last": last_seen,
                    "tier": cap.captureTier,
                    "ship": cap.shippingPayerCode,
                    "descr": cap.description,
                    "seller": cap.sellerId,
                    "sdates": json.dumps(cap.dates) if cap.dates else None,
                    "id": listing_id,
                },
            )

        # Lines are replaced wholesale rather than merged: the extension holds
        # the user's current answer for what is in this listing, and a removed
        # card must actually disappear. SQLite FK cascades never fire (only
        # init_db's connection sets the pragma), so the delete is explicit.
        #
        # A capture with NO lines leaves the server's alone, and that guard is
        # load-bearing. Refreshing a listing whose local record was cleared
        # sends it back with no lines -- the associations live only in the
        # extension -- and replacing wholesale there would silently unidentify
        # every card on it. Deleting a line is done in the app, where the
        # lines are visible; it is not something a re-capture should be able to
        # do by omission.
        if cap.lines:
            db.execute(
                text("DELETE FROM mkt_listing_line WHERE listing_id = :id"),
                {"id": listing_id},
            )
            for line in cap.lines:
                db.execute(
                    text(
                        "INSERT INTO mkt_listing_line ("
                        " listing_id, line_type, item_id, collection_type_id,"
                        " label, qty, notes) "
                        "SELECT :id, :type, :item, i.collection_type_id,"
                        " :label, :qty, :notes "
                        "FROM (SELECT 1) "
                        "LEFT JOIN tbl_items i ON i.item_id = :item"
                    ),
                    {
                        "id": listing_id,
                        "type": line.lineType,
                        "item": line.cardId,
                        "label": line.label,
                        "qty": line.qty,
                        "notes": line.notes,
                    },
                )
                lines_new += 1

        # What the server holds for this listing NOW -- which is the capture's
        # own lines when it brought some, and whatever survived when it did
        # not. Read back rather than inferred, so a line that failed to insert
        # cannot be reported as identified.
        on_server = db.execute(text(
            "SELECT COUNT(*) FROM mkt_listing_line WHERE listing_id = :id"),
            {"id": listing_id}).scalar() or 0
        results.append({
            "marketplace": cap.marketplace,
            "externalId": cap.externalId,
            "listingId": listing_id,
            "linesOnServer": on_server,
            # False means the capture brought no lines and the server's were
            # left alone -- the case that looks like lost work and is not.
            "linesReplaced": bool(cap.lines),
        })

        for s in cap.sightings:
            if s.priceUsd is not None:
                usd, fx_source = s.priceUsd, "marketplace"
                fx = implied_rate(s.priceCents, currency, s.priceUsd)
                # Keep the best implied rate seen per (currency, day). Best
                # means the LARGEST native price: the marketplace publishes a
                # rounded USD figure, so ¥350 -> $2.31 pins the rate to about
                # three digits while ¥12,000 -> $79.20 pins it to five.
                if fx is not None:
                    day = (s.observedAt or cap.capturedAt)[:10]
                    prev = implied_fx.get((currency, day))
                    if prev is None or (s.priceCents or 0) > prev[1]:
                        implied_fx[(currency, day)] = (fx, s.priceCents or 0)
            else:
                fx = rate_for(db, currency, s.observedAt)
                fx_source = "table" if fx is not None else None
                usd = to_usd_minor(s.priceCents, currency, fx)

            res = db.execute(
                text(
                    "INSERT OR IGNORE INTO mkt_sighting ("
                    " listing_id, observed_at, listing_state, raw_status,"
                    " price_cents, currency, price_usd, fx_rate, fx_source,"
                    " shipping_cents, shipping_usd) "
                    "VALUES (:id, :at, :state, :raw, :price, :cur, :usd,"
                    " :fx, :fxs, :ship, :shipusd)"
                ),
                {
                    "id": listing_id,
                    "at": s.observedAt,
                    "state": s.listingState,
                    "raw": s.rawStatus,
                    "price": s.priceCents,
                    "cur": currency,
                    "usd": usd,
                    "fx": fx,
                    "fxs": fx_source,
                    "ship": s.shippingCents,
                    # Converted with the SAME rate as the price it belongs to,
                    # including the marketplace's own implied rate -- shipping
                    # and price are quoted together and must not drift apart.
                    "shipusd": to_usd_minor(s.shippingCents, currency, fx),
                },
            )
            sightings_new += res.rowcount or 0

    # A marketplace that publishes its own USD conversion is also telling you
    # its exchange rate, and that is the rate you are actually charged -- spread
    # included -- rather than a mid-market number looked up later. Recording it
    # is what lets Neokyo's yen fees convert to USD without anyone having to go
    # and enter a rate by hand first.
    #
    # DO NOTHING on conflict: a rate already on file for that day was either
    # entered deliberately or derived from a bigger, more precise listing, and
    # neither should be overwritten by a later small one.
    rates_new = 0
    for (cur, day), (rate, _price) in implied_fx.items():
        if cur == "USD":
            continue
        res = db.execute(
            text(
                "INSERT INTO mkt_fx_rate (currency, as_of_date, usd_per_unit,"
                " source, note) VALUES (:c, :d, :r, 'marketplace', :n) "
                "ON CONFLICT(currency, as_of_date) DO NOTHING"
            ),
            {
                "c": cur,
                "d": day,
                "r": rate,
                "n": "implied by a captured listing's own USD conversion",
            },
        )
        rates_new += res.rowcount or 0

    db.commit()
    return {
        "ok": True,
        "received": len(batch.captures),
        "listings_new": listings_new,
        "sightings_new": sightings_new,
        "lines_written": lines_new,
        "fx_rates_new": rates_new,
        "results": results,
    }


# ---------- Marketplaces & FX ----------


@router.get("/marketplaces")
def list_marketplaces(db=Depends(get_db)):
    rows = db.execute(
        text(
            "SELECT marketplace_code, marketplace_name, currency, side,"
            " is_active, offer_discount_pct FROM lkup_mkt_marketplaces "
            "WHERE is_active = 1 ORDER BY sort_order"
        )
    ).mappings().all()
    return {"marketplaces": [
        # The UI cannot format an amount without knowing how many decimal
        # places the currency has: ¥350 is 350, not 3.50.
        {**dict(r), "minor_exponent": minor_exp(r["currency"])}
        for r in rows
    ]}


class FxRateIn(BaseModel):
    currency: str
    usdPerUnit: float
    asOfDate: Optional[str] = None      # defaults to today
    source: str = "manual"
    note: Optional[str] = None


@router.get("/fx")
def list_fx_rates(db=Depends(get_db)):
    """Every rate on file, newest first, plus the current rate per currency."""
    rows = db.execute(
        text(
            "SELECT currency, as_of_date, usd_per_unit, source, note "
            "FROM mkt_fx_rate ORDER BY currency, as_of_date DESC"
        )
    ).mappings().all()

    current = {}
    for r in rows:
        current.setdefault(r["currency"], dict(r))

    needed = db.execute(
        text(
            "SELECT DISTINCT currency FROM lkup_mkt_marketplaces "
            "WHERE is_active = 1 AND currency <> 'USD'"
        )
    ).scalars().all()

    return {
        "rates": [dict(r) for r in rows],
        "current": current,
        # Named explicitly so a missing rate is visible rather than silently
        # leaving JPY and KRW sightings unconvertible.
        "missing": [c for c in needed if c not in current],
    }


@router.put("/fx")
def set_fx_rate(rate: FxRateIn, db=Depends(get_db)):
    """Record a rate. Dated, never overwritten in place.

    Rates are kept as a history rather than a single current value so a
    sighting can be converted at the rate that applied when it was seen. One
    mutable "current rate" would silently rewrite the USD value of every past
    observation each time it changed.
    """
    as_of = (rate.asOfDate or datetime.now().date().isoformat())[:10]
    db.execute(
        text(
            "INSERT INTO mkt_fx_rate (currency, as_of_date, usd_per_unit,"
            " source, note) VALUES (:c, :d, :r, :s, :n) "
            "ON CONFLICT(currency, as_of_date) DO UPDATE SET"
            " usd_per_unit = excluded.usd_per_unit,"
            " source = excluded.source, note = excluded.note"
        ),
        {
            "c": rate.currency.upper(),
            "d": as_of,
            "r": rate.usdPerUnit,
            "s": rate.source,
            "n": rate.note,
        },
    )
    db.commit()
    return {"ok": True, "currency": rate.currency.upper(), "as_of_date": as_of}


@router.post("/fx/backfill")
def backfill_usd(db=Depends(get_db)):
    """Fill USD on sightings that had no rate on file when captured.

    Captures are never blocked on a missing rate — a JPY sighting with no rate
    is still a true record of the native price. This fills them in afterwards,
    and only where a rate now exists that was effective on or before the
    sighting; it will not invent history by reaching backwards.
    """
    rows = db.execute(
        text(
            "SELECT sighting_id, currency, observed_at, price_cents "
            "FROM mkt_sighting "
            "WHERE price_usd IS NULL AND price_cents IS NOT NULL"
        )
    ).mappings().all()

    filled = 0
    for r in rows:
        fx = rate_for(db, r["currency"], r["observed_at"])
        if fx is None:
            continue
        db.execute(
            text(
                "UPDATE mkt_sighting SET price_usd = :usd, fx_rate = :fx,"
                " fx_source = 'table' WHERE sighting_id = :id"
            ),
            {
                "usd": to_usd_minor(r["price_cents"], r["currency"], fx),
                "fx": fx,
                "id": r["sighting_id"],
            },
        )
        filled += 1

    db.commit()
    return {"ok": True, "candidates": len(rows), "filled": filled}


# ---------- Comps ----------

# A card's price series counts ONLY listings where that card is the sole line.
# A 12-card bundle at $27 is not that card selling for $27, and a handful of
# those distorts a series far worse than missing observations would.
SOLE_LINE_SQL = """
    FROM mkt_sighting s
    JOIN mkt_listing l ON l.listing_id = s.listing_id
    JOIN mkt_listing_line ln ON ln.listing_id = l.listing_id
   WHERE l.is_lot = 0
     AND (SELECT COUNT(*) FROM mkt_listing_line x
           WHERE x.listing_id = l.listing_id) = 1
     AND ln.item_id IS NOT NULL
"""


@router.get("/comps")
def comps_summary(db=Depends(get_db)):
    """Every card with usable comp data, with active and sold read separately.

    Active and sold are never blended: they answer different questions, and the
    buy and sell sides of a trade read different ones.
    """
    rows = db.execute(
        text(
            "SELECT ln.item_id,"
            " MAX(ln.label) AS label,"
            " COUNT(*) AS n,"
            " SUM(CASE WHEN s.listing_state = 'active' THEN 1 ELSE 0 END) AS n_active,"
            " SUM(CASE WHEN s.listing_state = 'sold' THEN 1 ELSE 0 END) AS n_sold,"
            " MIN(CASE WHEN s.listing_state = 'active' THEN s.price_cents END) AS active_min,"
            " MAX(CASE WHEN s.listing_state = 'active' THEN s.price_cents END) AS active_max,"
            " MIN(CASE WHEN s.listing_state = 'sold' THEN s.price_cents END) AS sold_min,"
            " MAX(CASE WHEN s.listing_state = 'sold' THEN s.price_cents END) AS sold_max,"
            " MIN(CASE WHEN s.listing_state = 'active' THEN s.price_usd END) AS active_usd_min,"
            " MAX(CASE WHEN s.listing_state = 'active' THEN s.price_usd END) AS active_usd_max,"
            " MIN(CASE WHEN s.listing_state = 'sold' THEN s.price_usd END) AS sold_usd_min,"
            " MAX(CASE WHEN s.listing_state = 'sold' THEN s.price_usd END) AS sold_usd_max,"
            " COUNT(DISTINCT s.currency) AS n_currencies,"
            " SUM(CASE WHEN s.price_usd IS NULL THEN 1 ELSE 0 END) AS n_unconverted,"
            " MAX(s.observed_at) AS last_seen"
            + SOLE_LINE_SQL
            + " GROUP BY ln.item_id ORDER BY n DESC, ln.item_id"
        )
    ).mappings().all()
    # Cards that appear only inside multi-card listings.
    #
    # The sole-line rule keeps a bundle's price out of any card's series, and
    # that is right. But it also kept those cards out of this LIST, so a card
    # whose only sighting is a lot had comp data at /comps/{item_id} and no row
    # anywhere to reach it from -- capture it, link it, sync it, and the app
    # showed nothing. Listed here with no price, which is the honest state:
    # seen in a bundle, not yet priced on its own.
    lot_rows = db.execute(
        text(
            "SELECT ln.item_id, MAX(ln.label) AS label,"
            " COUNT(DISTINCT l.listing_id) AS n_lots,"
            " MAX(s.observed_at) AS last_seen "
            "FROM mkt_listing l "
            "JOIN mkt_listing_line ln ON ln.listing_id = l.listing_id "
            "JOIN mkt_sighting s ON s.listing_id = l.listing_id "
            "WHERE ln.item_id IS NOT NULL "
            "  AND (l.is_lot = 1 OR (SELECT COUNT(*) FROM mkt_listing_line x"
            "        WHERE x.listing_id = l.listing_id) > 1) "
            "GROUP BY ln.item_id"
        )
    ).mappings().all()
    lots_by_item = {r["item_id"]: r for r in lot_rows}

    # How many ways there are to buy each card right now, so the list can be
    # filtered down to "what could I actually acquire" without loading every
    # card's detail to find out.
    buy_counts = {
        r[0]: r[1]
        for r in db.execute(text(
            "SELECT ln.item_id, COUNT(DISTINCT l.listing_id) "
            "FROM mkt_listing l "
            "JOIN mkt_listing_line ln ON ln.listing_id = l.listing_id "
            "JOIN mkt_sighting s ON s.listing_id = l.listing_id "
            "JOIN lkup_mkt_marketplaces m ON m.marketplace_code = l.marketplace "
            "WHERE ln.item_id IS NOT NULL AND s.listing_state = 'active' "
            "  AND m.side IN ('buy', 'both') AND l.delisted_at IS NULL "
            "GROUP BY ln.item_id"))
    }

    basis = {
        r[0]: (r[1] if r[1] is not None else r[2])
        for r in db.execute(text(
            "SELECT c.item_id, c.cost_cents, t.cost_cents FROM mkt_item_cost c "
            "LEFT JOIN mkt_cost_tier t ON t.cost_tier_id = c.cost_tier_id"))
    }
    cards = []
    seen = set()
    for r in rows:
        d = dict(r)
        d["basis_cents"] = basis.get(d["item_id"])
        d["n_lots"] = (lots_by_item.get(d["item_id"]) or {}).get("n_lots", 0)
        d["n_buy"] = buy_counts.get(d["item_id"], 0)
        d["lots_only"] = False
        seen.add(d["item_id"])
        cards.append(d)

    for item_id, r in lots_by_item.items():
        if item_id in seen:
            continue
        cards.append({
            "item_id": item_id,
            "label": r["label"],
            "n": 0, "n_active": 0, "n_sold": 0,
            "active_min": None, "active_max": None,
            "sold_min": None, "sold_max": None,
            "active_usd_min": None, "active_usd_max": None,
            "sold_usd_min": None, "sold_usd_max": None,
            "n_currencies": 0, "n_unconverted": 0,
            "last_seen": r["last_seen"],
            "basis_cents": basis.get(item_id),
            "n_lots": r["n_lots"],
            "n_buy": buy_counts.get(item_id, 0),
            # Sorted last and rendered without a price: a card seen only in a
            # bundle has no single-card figure, and inventing one from the
            # bundle is the exact error the sole-line rule exists to prevent.
            "lots_only": True,
        })

    return {"cards": cards}



def _ask_position(list_cents: Optional[int], active: List[int]) -> Dict[str, Any]:
    """Where `list_cents` would rank among the current asking prices.

    Deliberately NOT a verdict on whether the price is right -- it reports the
    standing and lets the caller judge. `n_active` of 0 is a real answer, not a
    missing one: no competition is itself worth knowing, and it is common on
    exactly the rare cards where sold comps are thin.
    """
    asks = sorted(a for a in active if a is not None)
    out: Dict[str, Any] = {
        "n_active": len(asks),
        "active_min": asks[0] if asks else None,
        "active_max": asks[-1] if asks else None,
        "active_median": (
            asks[len(asks) // 2] if len(asks) % 2
            else (asks[len(asks) // 2 - 1] + asks[len(asks) // 2]) // 2
        ) if asks else None,
        "list_cents": list_cents,
        "cheaper": None,
        "pricier": None,
        "standing": None,
    }
    if list_cents is None or not asks:
        return out
    out["cheaper"] = sum(1 for a in asks if a < list_cents)
    out["pricier"] = sum(1 for a in asks if a > list_cents)
    if out["cheaper"] == 0:
        out["standing"] = "undercuts_all"
    elif out["pricier"] == 0:
        out["standing"] = "above_all"
    else:
        out["standing"] = "mid_pack"
    return out


@router.get("/comps/{item_id}")
def comps_for_card(item_id: int, db=Depends(get_db)):
    """Full sighting series for one card, plus its excluded-lot appearances.

    The lot rows are returned separately rather than hidden: they are real
    market signal (a bundle's implied per-card price is the arbitrage thesis
    quantified), they just must never enter the single-card price series.
    """
    series = db.execute(
        text(
            "SELECT s.observed_at, s.listing_state, s.price_cents,"
            " s.currency, s.price_usd, s.fx_rate, s.fx_source, l.marketplace,"
            " l.listing_url, l.title_raw, l.item_condition, l.thumbnail_url"
            + SOLE_LINE_SQL
            + " AND ln.item_id = :id ORDER BY s.observed_at"
        ),
        {"id": item_id},
    ).mappings().all()

    # currency and price_usd come along because a lot can be on a marketplace
    # that does not price in dollars. Without them the panel rendered ¥3,399 as
    # "$33.99" -- the same currency bug as the fee fields, one layer down.
    lots = db.execute(
        text(
            "SELECT l.listing_id, l.marketplace, l.listing_url, l.title_raw,"
            " l.thumbnail_url, s.price_cents, s.currency, s.price_usd,"
            " s.listing_state, s.observed_at,"
            " (SELECT COUNT(*) FROM mkt_listing_line x"
            "   WHERE x.listing_id = l.listing_id) AS line_count "
            "FROM mkt_listing l "
            "JOIN mkt_listing_line ln ON ln.listing_id = l.listing_id "
            "JOIN mkt_sighting s ON s.listing_id = l.listing_id "
            "WHERE ln.item_id = :id "
            "  AND (l.is_lot = 1 OR (SELECT COUNT(*) FROM mkt_listing_line x"
            "        WHERE x.listing_id = l.listing_id) > 1) "
            "ORDER BY s.observed_at"
        ),
        {"id": item_id},
    ).mappings().all()

    # Stats are computed in USD, because mixing a yen figure into the same
    # min/max as a dollar one produces a number that means nothing. Sightings
    # with no conversion available are excluded from the stats and counted, so
    # a missing rate shows up rather than quietly shrinking the sample.
    # Competition, which is a SELL-side idea: where your ask would stand among
    # the asks a buyer sees instead of yours. A proxy like Neokyo is a place to
    # BUY, never somewhere you can list, so its asks are not competing with you
    # and pooling them in moved the standing around for no reason. Which
    # marketplaces you can sell on is a fact already on the lookup row.
    sellable = {
        r[0] for r in db.execute(text(
            "SELECT marketplace_code FROM lkup_mkt_marketplaces "
            "WHERE side IN ('sell', 'both')"))
    }
    active = [r["price_usd"] for r in series
              if r["listing_state"] == "active" and r["price_usd"] is not None
              and r["marketplace"] in sellable]
    sold = [r["price_usd"] for r in series
            if r["listing_state"] == "sold" and r["price_usd"] is not None]
    unconverted = sum(1 for r in series if r["price_usd"] is None)

    def stats(vals):
        if not vals:
            return None
        ordered = sorted(vals)
        mid = len(ordered) // 2
        median = (
            ordered[mid]
            if len(ordered) % 2
            else (ordered[mid - 1] + ordered[mid]) // 2
        )
        return {"n": len(ordered), "min": ordered[0], "max": ordered[-1],
                "median": median}

    if not series and not lots:
        raise HTTPException(status_code=404, detail="no comp data for this card")

    # Comps can span marketplaces; the fee model belongs to whichever one the
    # sales actually happened on. Sold rows decide it — that is the side being
    # modelled — falling back to the most common marketplace overall.
    sold_mkts = [r["marketplace"] for r in series if r["listing_state"] == "sold"]
    mkts = sold_mkts or [r["marketplace"] for r in series]
    mkt = max(set(mkts), key=mkts.count) if mkts else "mercari_us"
    # Explicitly the SELL side: this figure is what a sale nets. The buy side
    # is a different set of costs entirely (buyer protection, duty, PayPal) and
    # summing them would double-charge a card bought and then resold.
    fm = fee_model(db, mkt, "sell")

    sold_stats = stats(sold)
    basis = effective_basis(db, item_id)
    net_median = net_proceeds(sold_stats["median"], fm) if sold_stats else None
    margin = (
        net_median - basis["cost_cents"]
        if net_median is not None and basis else None
    )

    # ---- Where this card could be BOUGHT, landed ----------------------------
    #
    # The other half of the question the module exists to answer, and the half
    # that had no view at all: a Neokyo listing showed up under "excluded lots"
    # as though it were a data-quality problem, when it is a purchase option.
    #
    # Excluded from the SERIES is right -- a two-card bundle at ¥3,399 is not
    # this card at ¥3,399 -- but that says nothing about whether it is worth
    # buying. Divided by its line count it is exactly the per-card acquisition
    # price, which is the arbitrage thesis quantified.
    #
    # Landed, not listed: a price on a proxy is meaningless until the service
    # fee, PayPal, duty and shipping are on it. That is what makes a yen ask
    # and a dollar ask comparable at all.
    buy_rows = db.execute(
        text(
            "SELECT l.listing_id, l.marketplace, l.listing_url, l.title_raw,"
            " l.thumbnail_url, s.price_cents, s.currency, s.price_usd,"
            " s.observed_at, s.shipping_cents, s.shipping_usd,"
            f" {UNITS_SQL} AS line_count "
            "FROM mkt_listing l "
            "JOIN mkt_listing_line ln ON ln.listing_id = l.listing_id "
            "JOIN mkt_sighting s ON s.listing_id = l.listing_id "
            "JOIN lkup_mkt_marketplaces m ON m.marketplace_code = l.marketplace "
            "WHERE ln.item_id = :id AND s.listing_state = 'active' "
            "  AND m.side IN ('buy', 'both') "
            # Marked gone or sold: no longer a price anyone can pay.
            "  AND l.delisted_at IS NULL "
            # Only the latest sighting of each listing: an older, higher price
            # for a listing still on sale is history, not an option.
            "  AND s.observed_at = (SELECT MAX(s2.observed_at)"
            "        FROM mkt_sighting s2 WHERE s2.listing_id = l.listing_id) "
            "GROUP BY l.listing_id"
        ),
        {"id": item_id},
    ).mappings().all()

    buy_fees: Dict[str, Any] = {}
    buy_options = []
    for r in buy_rows:
        code = r["marketplace"]
        if code not in buy_fees:
            buy_fees[code] = fee_model(db, code, "buy")
        bfm = buy_fees[code]
        n = max(1, r["line_count"] or 1)
        landed = landed_cost(r["price_usd"], bfm, r["shipping_usd"])
        buy_options.append({
            **dict(r),
            "landed_cents": landed,
            # What one card costs out of this listing. For a single that IS the
            # landed cost; for a bundle it is the number that decides whether
            # buying the bundle for one card is worth it.
            "landed_per_card_cents": (
                None if landed is None else int(round(landed / n))
            ),
            "fees_configured": bfm["configured"],
            # No rate on file, so the yen could not be converted. Reported
            # rather than treated as zero, which would show it as free.
            "fx_missing": r["price_usd"] is None,
        })

    priced = [o for o in buy_options if o["landed_per_card_cents"] is not None]
    priced.sort(key=lambda o: o["landed_per_card_cents"])
    buy_options = priced + [o for o in buy_options
                            if o["landed_per_card_cents"] is None]
    cheapest = priced[0]["landed_per_card_cents"] if priced else None

    return {
        "item_id": item_id,
        "currency": "USD",
        "basis": basis,
        "fees": {**fm, "marketplace": mkt},
        # Every route to acquiring this card right now, cheapest landed first.
        "buy_options": buy_options,
        "buy": {
            "cheapest_landed_cents": cheapest,
            # The spread the whole module is pointed at: buy there, sell here.
            # Against the NET sold median, because gross is not what you keep.
            "spread_vs_net_cents": (
                None if cheapest is None or net_median is None
                else net_median - cheapest
            ),
        },
        # Where a proposed list price would sit among the listings actually
        # competing with it right now.
        #
        # This is the check that matters for a RARE card, where comp volume is
        # genuinely thin and gating on sold count would just suppress the cards
        # most in need of a price. It compares like with like -- your ask
        # against their asks -- and answers the two ways a price goes wrong:
        # under everything on the market (money left behind) or over everything
        # (it will not move while cheaper copies exist).
        "vs_active": _ask_position(
            list_price_for(basis["cost_cents"] + margin, fm)
            if margin is not None and basis else None,
            active,
        ),
        # Gross is what the market paid; net is what you would keep. Both are
        # returned because the difference is the entire point.
        "net": {
            "sold_median_net": net_median,
            "margin_vs_basis": margin,
            # What to list at to clear the basis plus the same margin again --
            # the number actually typed into the marketplace.
            "list_to_net": (
                list_price_for(basis["cost_cents"] + margin, fm)
                if margin is not None and basis else None
            ),
        },
        "unconverted": unconverted,
        "active": stats(active),
        "sold": stats(sold),
        "series": [dict(r) for r in series],
        "excluded_lots": [dict(r) for r in lots],
    }


# ─────────────────────────── Cost basis ──────────────────────────────────────
#
# What a card COST, so the comp view can answer "what would I make on this"
# rather than only "what does it sell for".
#
# Scope: this only means anything for cards actually held FOR SALE. A card in
# the catalog that was never owned has no basis to speak of, and a card being
# kept is a collecting cost, not a trading one. SALE_STATUSES is therefore the
# default population everywhere below — widen it deliberately, not by accident.
# (The monthly-flow metric will eventually want 'owned' too, for the cost of
# cards moved to KEEP in a month; that is a later, separate call.)
#
# Precedence, derived on read and never denormalized:
#     real logged purchase  -> exact      (ledger; not built yet)
#     cost tier / manual    -> ESTIMATED
#     neither               -> unknown

SALE_STATUSES = ("trade", "pending_outgoing")

# Era boundary: 2020 and earlier is "older", 2021 forward is "current".
DEFAULT_ERA_CUTOFF = "2020-12-31"


def _register_id_word(db) -> None:
    """Register a word-boundary \\bID\\b test; SQLite has no such operator.

    A real function rather than a LIKE approximation, because the approximation
    is exactly what goes wrong: measured against the live library,
    `version LIKE '%ID%'` matches 1,758 cards of which only 288 are ID cards.
    The other 1,470 are Polaroids ('Polaroid POB', 'Seoul Polaroid POB'), so the
    shortcut sweeps expensive cards into the cheapest tier — invisibly.
    """
    import re
    raw = db.connection().connection
    raw.create_function(
        "cc_is_id_version", 1,
        lambda v: 1 if v and re.search(r"\bID\b", v, re.I) else 0,
    )


def _basis_rows(db, era_cutoff: str, statuses=SALE_STATUSES):
    """One row per held copy, tagged with the tier the rules would give it.

    Rule order is priority order, first match wins. Deliberately few and blunt:
    on a blended basis an individual card's P&L is noise and only the aggregate
    is sound, so finer tiers would imply precision that isn't there.

    Note is_special — not the version text — identifies a store POB. "POB"
    covers both store POBs (valuable, flagged) and first-run POBs (ordinary,
    not flagged), and version naming is inconsistent, so the flag is the more
    reliable signal.
    """
    _register_id_word(db)
    marks = ", ".join(f"'{s}'" for s in statuses)
    return db.execute(text(f"""
        SELECT p.copy_id, p.item_id,
               TRIM(COALESCE(o.source_origin_name, '?')
                    || COALESCE(' - ' || NULLIF(d.version, ''), '')) AS card_label,
               CASE
                 WHEN d.is_special = 1 THEN 't4'
                 WHEN cc_is_id_version(d.version) = 1
                      OR o.source_origin_name = 'Collab: Nacific' THEN 't1'
                 WHEN o.start_date IS NOT NULL AND o.start_date <= :cutoff THEN 't2'
                 ELSE 't3'
               END AS tier_code
        FROM tbl_photocard_copies p
        JOIN lkup_ownership_statuses s ON s.ownership_status_id = p.ownership_status_id
        JOIN tbl_photocard_details d ON d.item_id = p.item_id
        LEFT JOIN lkup_photocard_source_origins o
               ON o.source_origin_id = d.source_origin_id
        WHERE s.status_code IN ({marks})
    """), {"cutoff": era_cutoff}).fetchall()


@router.get("/cost-tiers")
def list_cost_tiers(db=Depends(get_db)):
    tiers = [dict(r._mapping) for r in db.execute(text(
        "SELECT cost_tier_id, tier_code, tier_name, cost_cents, sort_order, is_active "
        "FROM mkt_cost_tier ORDER BY sort_order"
    ))]
    counts = {
        r[0]: r[1]
        for r in db.execute(text("""
            SELECT t.tier_code, COUNT(*) FROM mkt_item_cost c
            JOIN mkt_cost_tier t ON t.cost_tier_id = c.cost_tier_id
            GROUP BY t.tier_code"""))
    }
    for t in tiers:
        t["assigned_cards"] = counts.get(t["tier_code"], 0)
    return {"tiers": tiers, "era_cutoff": DEFAULT_ERA_CUTOFF}


class CostTierIn(BaseModel):
    tier_name: Optional[str] = None
    cost_cents: Optional[int] = None


@router.put("/cost-tiers/{cost_tier_id}")
def update_cost_tier(cost_tier_id: int, body: CostTierIn, db=Depends(get_db)):
    """Edit a tier.

    The effective basis is derived on read, so this reprices every card sitting
    on the tier. There is no backfill and that is the point — the same reason
    price tiers work this way.
    """
    sets, params = [], {"id": cost_tier_id}
    if body.tier_name is not None:
        name = body.tier_name.strip()
        if not name:
            raise HTTPException(status_code=400, detail="Tier name cannot be empty.")
        sets.append("tier_name = :n")
        params["n"] = name
    if body.cost_cents is not None:
        if body.cost_cents < 0:
            raise HTTPException(status_code=400, detail="cost_cents cannot be negative.")
        sets.append("cost_cents = :c")
        params["c"] = int(body.cost_cents)
    if not sets:
        return {"ok": True, "changed": False}

    res = db.execute(text(
        f"UPDATE mkt_cost_tier SET {', '.join(sets)} WHERE cost_tier_id = :id"), params)
    if res.rowcount == 0:
        raise HTTPException(status_code=404, detail=f"No cost tier {cost_tier_id}.")
    db.commit()
    return {"ok": True, "changed": True}


@router.get("/cost-basis/preview")
def preview_cost_basis(era_cutoff: str = DEFAULT_ERA_CUTOFF, db=Depends(get_db)):
    """Dry run: what the rules WOULD assign across the sale pile. Writes nothing.

    Worth actually looking at before assigning. A bad rule sweeps expensive
    cards into the cheapest tier, and once written the mistake looks exactly
    like a correct assignment.
    """
    rows = _basis_rows(db, era_cutoff)
    tiers = {
        r[0]: {"tier_name": r[1], "cost_cents": r[2]}
        for r in db.execute(text(
            "SELECT tier_code, tier_name, cost_cents FROM mkt_cost_tier ORDER BY sort_order"))
    }
    buckets: Dict[str, Dict[str, Any]] = {
        code: {"tier_code": code, "tier_name": t["tier_name"],
               "cost_cents": t["cost_cents"], "copies": 0,
               "subtotal_cents": 0, "samples": []}
        for code, t in tiers.items()
    }
    for _copy_id, _item_id, item_name, code in rows:
        b = buckets.get(code)
        if b is None:
            continue
        b["copies"] += 1
        b["subtotal_cents"] += b["cost_cents"]
        if len(b["samples"]) < 5:
            b["samples"].append(item_name)

    total = sum(b["subtotal_cents"] for b in buckets.values())
    copies = sum(b["copies"] for b in buckets.values())
    return {
        "scope": list(SALE_STATUSES),
        "era_cutoff": era_cutoff,
        "copies": copies,
        "total_cents": total,
        "avg_cents": round(total / copies) if copies else None,
        "tiers": [buckets[c] for c in tiers],
    }


@router.post("/cost-basis/assign")
def assign_cost_basis(
    era_cutoff: str = DEFAULT_ERA_CUTOFF,
    overwrite_manual: bool = False,
    db=Depends(get_db),
):
    """Apply the rules to the sale pile.

    One row per ITEM, not per copy — two copies of the same card share a basis.
    Rows whose source is 'manual' are left alone unless overwrite_manual is set,
    so a hand-corrected basis survives a later sweep.
    """
    rows = _basis_rows(db, era_cutoff)
    tier_ids = {r[0]: r[1] for r in db.execute(text(
        "SELECT tier_code, cost_tier_id FROM mkt_cost_tier"))}

    seen: set = set()
    assigned = skipped = 0
    for _copy_id, item_id, _name, code in rows:
        if item_id in seen:
            continue
        seen.add(item_id)
        tier_id = tier_ids.get(code)
        if tier_id is None:
            continue
        existing = db.execute(text(
            "SELECT source FROM mkt_item_cost WHERE item_id = :i"), {"i": item_id}).fetchone()
        if existing and existing[0] == "manual" and not overwrite_manual:
            skipped += 1
            continue
        db.execute(text("""
            INSERT INTO mkt_item_cost (item_id, cost_tier_id, cost_cents, source, updated_at)
            VALUES (:i, :t, NULL, 'rule', CURRENT_TIMESTAMP)
            ON CONFLICT(item_id) DO UPDATE SET
                cost_tier_id = excluded.cost_tier_id,
                cost_cents   = NULL,
                source       = 'rule',
                updated_at   = CURRENT_TIMESTAMP
        """), {"i": item_id, "t": tier_id})
        assigned += 1

    db.commit()
    return {"ok": True, "cards_assigned": assigned,
            "manual_rows_preserved": skipped, "era_cutoff": era_cutoff}


def effective_basis(db, item_id: int) -> Optional[Dict[str, Any]]:
    """The card's cost basis, resolved on read.

    Precedence, per the plan:
        real logged purchase  -> exact      (ledger; not built, hence no branch)
        cost tier / manual    -> ESTIMATED
        neither               -> None

    Never denormalized: a tier row carries no amount of its own, so editing the
    tier reprices every card sitting on it. `estimated` is returned rather than
    inferred by the caller, because a blended figure must never be presented as
    a measured one.
    """
    row = db.execute(text("""
        SELECT c.cost_cents, c.source, t.tier_code, t.tier_name, t.cost_cents
        FROM mkt_item_cost c
        LEFT JOIN mkt_cost_tier t ON t.cost_tier_id = c.cost_tier_id
        WHERE c.item_id = :i
    """), {"i": item_id}).fetchone()
    if row is None:
        return None
    own_cents, source, tier_code, tier_name, tier_cents = row
    cents = own_cents if own_cents is not None else tier_cents
    if cents is None:
        return None
    return {
        "cost_cents": cents,
        "source": source,
        "tier_code": tier_code,
        "tier_name": tier_name,
        # Everything available today is an estimate. When the ledger lands, a
        # row backed by a real purchase flips this to False.
        "estimated": True,
    }


class ItemBasisIn(BaseModel):
    """Tier XOR amount, matching the table's CHECK. Send neither to clear."""
    cost_tier_id: Optional[int] = None
    cost_cents: Optional[int] = None


@router.put("/cost-basis/item/{item_id}")
def set_item_basis(item_id: int, body: ItemBasisIn, db=Depends(get_db)):
    """Hand-set one card's basis, or clear it.

    Marked `source = 'manual'`, which the rule sweep then leaves alone unless
    explicitly told otherwise — so a correction made against a real comp is not
    undone by the next re-assign.
    """
    if body.cost_tier_id is not None and body.cost_cents is not None:
        raise HTTPException(
            status_code=400,
            detail="Set a tier or an amount, not both — they are mutually exclusive.")

    if body.cost_tier_id is None and body.cost_cents is None:
        db.execute(text("DELETE FROM mkt_item_cost WHERE item_id = :i"), {"i": item_id})
        db.commit()
        return {"ok": True, "cleared": True}

    if body.cost_cents is not None and body.cost_cents < 0:
        raise HTTPException(status_code=400, detail="cost_cents cannot be negative.")
    if body.cost_tier_id is not None:
        exists = db.execute(text(
            "SELECT 1 FROM mkt_cost_tier WHERE cost_tier_id = :t"),
            {"t": body.cost_tier_id}).fetchone()
        if not exists:
            raise HTTPException(status_code=404, detail=f"No cost tier {body.cost_tier_id}.")

    db.execute(text("""
        INSERT INTO mkt_item_cost (item_id, cost_tier_id, cost_cents, source, updated_at)
        VALUES (:i, :t, :c, 'manual', CURRENT_TIMESTAMP)
        ON CONFLICT(item_id) DO UPDATE SET
            cost_tier_id = excluded.cost_tier_id,
            cost_cents   = excluded.cost_cents,
            source       = 'manual',
            updated_at   = CURRENT_TIMESTAMP
    """), {"i": item_id, "t": body.cost_tier_id, "c": body.cost_cents})
    db.commit()
    return {"ok": True, "basis": effective_basis(db, item_id)}


# ───────────────────────── Net, not gross ────────────────────────────────────
#
# Three deductions, routinely conflated, and the comp view applied none of them:
#
#   marketplace fee   the platform's cut of a sale        sell side
#   shipping          whoever actually pays it            either side
#   the offer gap     buyers negotiate down from the ask  BEFORE listing
#
# The offer gap works the opposite way to the other two and is the one usually
# got wrong. Mercari's sold prices come back as odd amounts -- 407, 425, 567,
# 1045 -- because they are accepted offers and automatic price drops. So a sold
# median is ALREADY net of negotiation: it is what buyers paid, not what
# sellers asked. Nothing is deducted from it for haggling.
#
# It matters in the other direction: to CLEAR a number you must list above it,
# because the offer arrives against the ask. That is `list_price_for()`.

def fee_model(db, marketplace: str, side: str = "sell",
              on_date: Optional[str] = None) -> Dict[str, Any]:
    """The cost of transacting on `marketplace` from one SIDE.

    Sides are separate because they are separate costs. Mercari US charges a
    seller for selling and a buyer a protection fee for buying, and the same
    listing is both depending on which end you are on. Summing them together
    would double-charge a card you bought and then resold.

    Returns native figures (what the user typed, what the UI shows) and USD
    figures (what the arithmetic needs, since the comp series is USD).
    Returning only one of them is how a yen amount ends up subtracted from a
    dollar figure.
    """
    mrow = db.execute(text(
        "SELECT currency, offer_discount_pct, typical_items_per_shipment "
        "FROM lkup_mkt_marketplaces WHERE marketplace_code = :m"
    ), {"m": marketplace}).fetchone()
    currency = (mrow[0] if mrow else "USD") or "USD"
    offer = (mrow[1] if mrow else 0.0) or 0.0
    per_box_items = (mrow[2] if mrow else None) or None

    parts = db.execute(text(
        "SELECT component_id, label, pct, fixed_minor, scope, seed_key "
        "FROM mkt_fee_component "
        "WHERE marketplace_code = :m AND side = :s AND is_active = 1 "
        "ORDER BY sort_order, label"
    ), {"m": marketplace, "s": side}).mappings().all()

    # A percentage is proportional to price, so it is per-item and per-box
    # equivalently and needs no amortising. Only FIXED per-box amounts do.
    total_pct = sum(p["pct"] or 0.0 for p in parts)
    item_fixed = sum((p["fixed_minor"] or 0)
                     for p in parts if p["scope"] != "per_shipment")
    box_fixed = sum((p["fixed_minor"] or 0)
                    for p in parts if p["scope"] == "per_shipment")

    # Divided across a typical box. Without that figure the per-box lines are
    # left OUT and flagged, never guessed at: a ¥8,039 box cost charged to one
    # card instead of forty is not an approximation, it is a wrong answer.
    box_share = round(box_fixed / per_box_items) if (per_box_items and box_fixed) else 0
    total_fixed = item_fixed + box_share

    # Fees are a standing cost, not a historical observation, so today's rate
    # is the right one — unlike a sighting, which must use the rate as of when
    # it was seen.
    as_of = on_date or datetime.utcnow().strftime("%Y-%m-%d")
    rate = 1.0 if currency == "USD" else rate_for(db, currency, as_of)
    fixed_usd = (total_fixed if currency == "USD"
                 else to_usd_minor(total_fixed, currency, rate))

    return {
        "marketplace": marketplace,
        "side": side,
        "currency": currency,
        "minor_exponent": minor_exp(currency),
        "components": [dict(p) for p in parts],
        "total_pct": total_pct,
        "total_fixed_minor": total_fixed,
        "item_fixed_minor": item_fixed,
        "box_fixed_minor": box_fixed,
        "box_share_minor": box_share,
        "typical_items_per_shipment": per_box_items,
        # Per-box costs exist but there is no box size to divide them by, so
        # they are excluded. Said out loud, because silently dropping them
        # understates every purchase on this marketplace.
        "box_unallocated": bool(box_fixed and not per_box_items),
        # None, never 0, when a non-USD marketplace has no rate on file:
        # treating a missing rate as zero would silently understate every cost
        # on that marketplace.
        "total_fixed_usd": fixed_usd,
        # Sell-side only, and not a fee — it is how far buyers negotiate below
        # an ask, which is why nothing is deducted from a sold comp for it.
        "offer_discount_pct": offer,
        "configured": bool(total_pct or total_fixed),
        "fx_missing": currency != "USD" and rate is None and bool(total_fixed),
    }


def net_proceeds(gross_cents: Optional[int], fm: Dict[str, Any],
                 seller_pays_shipping: bool = True) -> Optional[int]:
    """What a sale at `gross_cents` actually leaves you.

    `seller_pays_shipping=False` drops any component whose label mentions
    shipping — a detail capture whose shippingPayer says the BUYER paid should
    not have the seller's shipping assumption taken off it. Sweeps cannot know,
    which is why the assumption exists at all.
    """
    if gross_cents is None:
        return None
    pct = fm["total_pct"]
    fixed = fm.get("total_fixed_usd") or 0
    if not seller_pays_shipping:
        for c in fm.get("components", []):
            if "shipping" in (c["label"] or "").lower():
                pct -= c["pct"] or 0.0
                # Native minor units; only correct to subtract directly when
                # the marketplace already reports in USD.
                if fm["currency"] == "USD":
                    fixed -= c["fixed_minor"] or 0
    return int(round(gross_cents * (1.0 - pct) - fixed))


def _shipping_fixed_usd(fm: Dict[str, Any]) -> int:
    """The fee model's own shipping estimate, in USD minor units.

    Only correct to subtract directly when the marketplace already reports in
    USD -- the same restriction net_proceeds works under, for the same reason.
    """
    if fm["currency"] != "USD":
        return 0
    return sum(
        c["fixed_minor"] or 0
        for c in fm.get("components", [])
        # per_item only. A per_shipment shipping line is the freight cost of a
        # consolidated box (Neokyo's ¥6,700), which a listing's own postage
        # quote does not replace and never covers -- and it enters total_fixed
        # as a share of the box, not at face value, so subtracting it whole
        # would take off more than was ever added.
        if c.get("scope") != "per_shipment"
        and (c.get("seed_key") in ("buy_ship", "sell_ship")
             or "shipping" in (c["label"] or "").lower())
    )


def landed_cost(price_cents: Optional[int], fm: Dict[str, Any],
                shipping_cents: Optional[int] = None) -> Optional[int]:
    """What a purchase at `price_cents` actually costs, all in.

    The buy-side mirror of net_proceeds, and what makes "is Mercari US a better
    deal than Neokyo for this card" answerable: both sides reduce to a USD
    number that includes their own fees, shipping and duty.

    `shipping_cents` is what the LISTING said postage costs, in USD. Where it is
    known it REPLACES the fee model's shipping line rather than adding to it --
    the standing figure exists precisely because the per-listing one is usually
    unavailable, and charging both double-counts. 0 is a real answer ("free
    shipping") and switches the estimate off exactly as a $5.48 would; None
    means the page was not read for it and the estimate stands.

    Not a percentage: postage does not scale with price. A $6 card with $5.48
    postage costs nearly twice a $6 card without, and no per-marketplace
    average can tell those apart.
    """
    if price_cents is None:
        return None
    fixed = fm.get("total_fixed_usd") or 0
    if shipping_cents is not None:
        fixed = fixed - _shipping_fixed_usd(fm) + shipping_cents
    return int(round(price_cents * (1.0 + fm["total_pct"]) + fixed))


def list_price_for(target_net_cents: int, fm: Dict[str, Any]) -> Optional[int]:
    """The number to actually type into the marketplace to clear a target."""
    denom = 1.0 - fm["total_pct"]
    if denom <= 0:
        return None
    gross = (target_net_cents + (fm.get("total_fixed_usd") or 0)) / denom
    pad = 1.0 - fm["offer_discount_pct"]
    if pad <= 0:
        return None
    return int(round(gross / pad))


class OfferDiscountIn(BaseModel):
    offer_discount_pct: float


class ComponentIn(BaseModel):
    marketplace_code: Optional[str] = None
    side: Optional[str] = None
    label: Optional[str] = None
    pct: Optional[float] = None
    # Minor units of the MARKETPLACE's currency — not cents, not USD.
    fixed_minor: Optional[int] = None
    # 'per_item' or 'per_shipment'. A per_shipment fixed amount lands once on
    # a consolidated box and is divided by typical_items_per_shipment.
    scope: Optional[str] = None


@router.get("/fees")
def list_fee_components(db=Depends(get_db)):
    """Every marketplace with its buy-side and sell-side cost lines."""
    out = []
    for m in db.execute(text(
        "SELECT marketplace_code, marketplace_name, currency, side, offer_discount_pct "
        "FROM lkup_mkt_marketplaces WHERE is_active = 1 ORDER BY sort_order"
    )).mappings():
        out.append({
            **dict(m),
            "minor_exponent": minor_exp(m["currency"]),
            "buy": fee_model(db, m["marketplace_code"], "buy"),
            "sell": fee_model(db, m["marketplace_code"], "sell"),
        })
    return {"marketplaces": out}


def _validate_component(pct, fixed):
    if pct is not None and not (0.0 <= pct < 1.0):
        raise HTTPException(
            status_code=400,
            detail=f"pct is a fraction between 0 and 1 (0.10 = 10%); got {pct}.")
    if fixed is not None and fixed < 0:
        raise HTTPException(status_code=400, detail="fixed_minor cannot be negative.")


@router.post("/fees/components", status_code=201)
def create_fee_component(body: ComponentIn, db=Depends(get_db)):
    if (not body.marketplace_code or body.side not in ("buy", "sell")
            or not (body.label or "").strip()):
        raise HTTPException(
            status_code=400,
            detail="marketplace_code, side ('buy' or 'sell') and label are required.")
    _validate_component(body.pct, body.fixed_minor)
    scope = body.scope or "per_item"
    if scope not in ("per_item", "per_shipment"):
        raise HTTPException(status_code=400,
                            detail="scope must be 'per_item' or 'per_shipment'.")
    try:
        cid = db.execute(text(
            "INSERT INTO mkt_fee_component "
            "(marketplace_code, side, label, pct, fixed_minor, scope, sort_order) "
            "VALUES (:m, :s, :l, :p, :f, :sc, 99) RETURNING component_id"
        ), {"m": body.marketplace_code, "s": body.side, "l": body.label.strip(),
            "p": body.pct or 0.0, "f": body.fixed_minor or 0, "sc": scope}).scalar_one()
        db.commit()
    except HTTPException:
        raise
    except Exception as ex:
        db.rollback()
        if "UNIQUE" in str(ex).upper():
            raise HTTPException(
                status_code=409,
                detail=f"'{body.label}' already exists on that marketplace and side.")
        raise
    return {"ok": True, "component_id": cid}


@router.put("/fees/components/{component_id}")
def update_fee_component(component_id: int, body: ComponentIn, db=Depends(get_db)):
    _validate_component(body.pct, body.fixed_minor)
    sets, params = [], {"id": component_id}
    if body.pct is not None:
        sets.append("pct = :p"); params["p"] = body.pct
    if body.fixed_minor is not None:
        sets.append("fixed_minor = :f"); params["f"] = body.fixed_minor
    if body.label is not None and body.label.strip():
        sets.append("label = :l"); params["l"] = body.label.strip()
    if body.scope is not None:
        if body.scope not in ("per_item", "per_shipment"):
            raise HTTPException(status_code=400,
                                detail="scope must be 'per_item' or 'per_shipment'.")
        sets.append("scope = :sc"); params["sc"] = body.scope
    if not sets:
        return {"ok": True, "changed": False}
    res = db.execute(text(
        f"UPDATE mkt_fee_component SET {', '.join(sets)} WHERE component_id = :id"),
        params)
    if res.rowcount == 0:
        raise HTTPException(status_code=404, detail=f"No component {component_id}.")
    db.commit()
    return {"ok": True, "changed": True}


@router.delete("/fees/components/{component_id}")
def delete_fee_component(component_id: int, db=Depends(get_db)):
    db.execute(text("DELETE FROM mkt_fee_component WHERE component_id = :id"),
               {"id": component_id})
    db.commit()
    return {"ok": True}


@router.put("/marketplaces/{code}/offer-discount")
def set_offer_discount(code: str, body: OfferDiscountIn, db=Depends(get_db)):
    """Not a fee — how far below an ask buyers typically settle.

    Sold prices are already net of it (they are accepted offers), so it is
    never deducted from a comp. It is what a LIST price must be padded by.
    """
    if not (0.0 <= body.offer_discount_pct < 1.0):
        raise HTTPException(
            status_code=400, detail="offer_discount_pct is a fraction between 0 and 1.")
    res = db.execute(text(
        "UPDATE lkup_mkt_marketplaces SET offer_discount_pct = :v "
        "WHERE marketplace_code = :m"), {"v": body.offer_discount_pct, "m": code})
    if res.rowcount == 0:
        raise HTTPException(status_code=404, detail=f"No marketplace '{code}'.")
    db.commit()
    return {"ok": True}


class BoxSizeIn(BaseModel):
    typical_items_per_shipment: Optional[int] = None


@router.put("/marketplaces/{code}/box-size")
def set_box_size(code: str, body: BoxSizeIn, db=Depends(get_db)):
    """How many cards a typical consolidated box holds.

    Divides the per_shipment cost lines into a per-card share. Null clears it,
    which puts those lines back to unallocated-and-flagged rather than
    silently charging a whole box's shipping to one card.
    """
    n = body.typical_items_per_shipment
    if n is not None and n < 1:
        raise HTTPException(status_code=400, detail="Must be at least 1, or empty.")
    res = db.execute(text(
        "UPDATE lkup_mkt_marketplaces SET typical_items_per_shipment = :n "
        "WHERE marketplace_code = :m"), {"n": n, "m": code})
    if res.rowcount == 0:
        raise HTTPException(status_code=404, detail=f"No marketplace '{code}'.")
    db.commit()
    return {"ok": True}


# ───────────────────────── The card grid ─────────────────────────────────────
#
# The front door, replacing "look up a card you already had in mind".
#
# Every card carries three values -- what it cost, what it could be bought for,
# what it could be sold for -- and the two margins that fall out of them. See
# `docs/photocard_market_intel_plan.md` -> v2, the market workspace.


def _photocard_type_id(db) -> Optional[int]:
    row = db.execute(text(
        "SELECT collection_type_id FROM lkup_collection_types "
        "WHERE collection_type_code = 'photocards'")).fetchone()
    return row[0] if row else None


def _labels_for(db, item_ids: List[int]) -> Dict[int, str]:
    """`Hyunjin · Rock Star · KM Station`, the same shape the picker uses.

    Built here rather than read off mkt_listing_line.label: that column holds
    whatever the label was WHEN CAPTURED, so a card renamed since would show
    under its old name in a view whose whole job is to be browsed.
    """
    if not item_ids:
        return {}
    ids = ",".join(str(int(i)) for i in item_ids)

    members: Dict[int, List[str]] = {}
    for item_id, name in db.execute(text(
        "SELECT x.item_id, m.member_name "
        "FROM xref_photocard_members x "
        "JOIN lkup_photocard_members m ON m.member_id = x.member_id "
        f"WHERE x.item_id IN ({ids}) "
        "ORDER BY x.item_id, m.sort_order"
    )):
        members.setdefault(item_id, []).append(name)

    out: Dict[int, str] = {}
    # source_origin_id is nullable -- LEFT JOIN it, always.
    for item_id, origin, version in db.execute(text(
        "SELECT d.item_id, so.source_origin_name, d.version "
        "FROM tbl_photocard_details d "
        "LEFT JOIN lkup_photocard_source_origins so "
        "       ON so.source_origin_id = d.source_origin_id "
        f"WHERE d.item_id IN ({ids})"
    )):
        parts = [" + ".join(members.get(item_id, [])) or "—"]
        if origin:
            parts.append(origin)
        if version:
            parts.append(version)
        out[item_id] = " · ".join(parts)
    return out


# Possession, not decision. `wanted` / `not_wanted` / `undecided` are standing
# decisions about the card and do not mean a copy is in hand; `borrowed` is in
# hand but not yours to sell. See CLAUDE.md on the two orthogonal facts.
HELD_STATUSES = ("owned", "trade", "pending_outgoing")

# How many CARDS a listing actually contains, counting quantity rather than
# rows. One line of `qty: 3` is three cards for one price -- not a single-card
# listing -- so a row count would treat it as a per-card comp and divide a lot's
# landed cost by the wrong number.
UNITS_SQL = ("(SELECT COALESCE(SUM(x.qty), 0) FROM mkt_listing_line x"
             "  WHERE x.listing_id = l.listing_id)")


def _median(values: List[int]) -> Optional[int]:
    if not values:
        return None
    v = sorted(values)
    mid = len(v) // 2
    return v[mid] if len(v) % 2 else (v[mid - 1] + v[mid]) // 2


def _net_sold_by_item(db, ids: Optional[str] = None) -> Dict[int, Dict[str, Any]]:
    """Median SOLD price per card, net of the selling fees where it sold.

    Sole-unit sold sightings only: an ask is what a seller hopes for, and a
    bundle's price is not this card's price. `is_lot` is checked as well as the
    unit count, matching SOLE_LINE_SQL: the common lot is one identified card
    and N unknowns never entered, which counts as one unit and would otherwise
    walk straight into the series as a sole comp.

    Unfiltered by default, because the lot analyzer's value ladder needs an era
    median and that is a statistic over the whole series. At this size the whole
    series costs nothing to compute.
    """
    where = f"AND ln.item_id IN ({ids}) " if ids else ""
    prices: Dict[int, List[int]] = {}
    mkts: Dict[int, List[str]] = {}
    for item_id, usd_cents, mkt in db.execute(text(
        "SELECT ln.item_id, s.price_usd, l.marketplace "
        "FROM mkt_sighting s "
        "JOIN mkt_listing l ON l.listing_id = s.listing_id "
        "JOIN mkt_listing_line ln ON ln.listing_id = l.listing_id "
        "WHERE ln.item_id IS NOT NULL " + where +
        "  AND s.listing_state = 'sold' AND s.price_usd IS NOT NULL "
        f"  AND l.is_lot = 0 AND {UNITS_SQL} = 1"
    )):
        prices.setdefault(item_id, []).append(usd_cents)
        mkts.setdefault(item_id, []).append(mkt)

    fees: Dict[str, Any] = {}
    out: Dict[int, Dict[str, Any]] = {}
    for item_id, vals in prices.items():
        median = _median(vals)
        ms = mkts[item_id]
        # The fee model belongs to wherever the sales actually happened.
        mkt = max(set(ms), key=ms.count)
        if mkt not in fees:
            fees[mkt] = fee_model(db, mkt, "sell")
        out[item_id] = {
            "median_cents": median,
            "net_cents": net_proceeds(median, fees[mkt]),
            "n": len(vals),
            "marketplace": mkt,
        }
    return out


def _buy_options(db, ids: str):
    """Cheapest live listing per card, as two routes that are never blended.

    The cheapest source for a card is often INSIDE a lot, and one card cannot be
    bought out of an 8-card lot -- the lot can. A single "cheapest" figure would
    rank listings that cannot be acted on: $12.50 is a real number and acting on
    it costs $118. So: cheapest single, cheapest via-lot, separately.
    """
    rows = db.execute(text(
        "SELECT ln.item_id, l.listing_id, l.marketplace, l.listing_url,"
        " s.price_cents, s.currency, s.price_usd, s.observed_at,"
        " s.shipping_cents, s.shipping_usd,"
        f" {UNITS_SQL} AS line_count "
        "FROM mkt_listing l "
        "JOIN mkt_listing_line ln ON ln.listing_id = l.listing_id "
        "JOIN mkt_sighting s ON s.listing_id = l.listing_id "
        "JOIN lkup_mkt_marketplaces m ON m.marketplace_code = l.marketplace "
        f"WHERE ln.item_id IN ({ids}) AND s.listing_state = 'active' "
        "  AND m.side IN ('buy', 'both') "
        # Gone means gone: a delisted listing is not a price you can pay.
        "  AND l.delisted_at IS NULL "
        "  AND s.observed_at = (SELECT MAX(s2.observed_at)"
        "        FROM mkt_sighting s2 WHERE s2.listing_id = l.listing_id) "
        "GROUP BY ln.item_id, l.listing_id"
    )).mappings().all()

    fees: Dict[str, Any] = {}
    best_single: Dict[int, Dict[str, Any]] = {}
    best_lot: Dict[int, Dict[str, Any]] = {}
    for r in rows:
        code = r["marketplace"]
        if code not in fees:
            fees[code] = fee_model(db, code, "buy")
        landed = landed_cost(r["price_usd"], fees[code], r["shipping_usd"])
        if landed is None:
            continue
        n = max(1, r["line_count"] or 1)
        option = {
            "listing_id": r["listing_id"],
            "marketplace": code,
            "listing_url": r["listing_url"],
            "price_cents": r["price_cents"],
            "currency": r["currency"],
            "line_count": n,
            "landed_cents": landed,
            "per_card_cents": int(round(landed / n)),
            # USD, and named for it. The native figure is shipping_cents and
            # printing THAT with a dollar sign is the currency bug this
            # module has already shipped three times.
            "shipping_usd": r["shipping_usd"],
            "shipping_known": r["shipping_usd"] is not None,
            "observed_at": r["observed_at"],
        }
        target = best_single if n == 1 else best_lot
        cur = target.get(r["item_id"])
        if cur is None or option["per_card_cents"] < cur["per_card_cents"]:
            target[r["item_id"]] = option
    return best_single, best_lot


@router.get("/grid")
def market_grid(db=Depends(get_db)):
    """Every card worth looking at, with its three values side by side.

    Scope is deliberately not the whole catalog: 11,347 rows in a table with no
    virtualization is not a view, and the useful set is cards that have market
    data plus cards marked Wanted -- the ones with no data being exactly the
    reminder of where to go browsing next.
    """
    type_id = _photocard_type_id(db)

    # ---- Scope ------------------------------------------------------------
    with_data = {r[0] for r in db.execute(text(
        "SELECT DISTINCT item_id FROM mkt_listing_line "
        "WHERE item_id IS NOT NULL"))}
    wanted = {r[0] for r in db.execute(text(
        "SELECT DISTINCT c.item_id FROM tbl_photocard_copies c "
        "JOIN lkup_ownership_statuses s"
        "  ON s.ownership_status_id = c.ownership_status_id "
        "WHERE s.status_code = 'wanted'"))}
    item_ids = sorted(with_data | wanted)
    if not item_ids:
        return {"cards": [], "generated_at": datetime.utcnow().isoformat()}

    ids = ",".join(str(int(i)) for i in item_ids)
    labels = _labels_for(db, item_ids)

    # ---- What I hold ------------------------------------------------------
    held: Dict[int, int] = {}
    for item_id, n in db.execute(text(
        "SELECT c.item_id, COUNT(*) FROM tbl_photocard_copies c "
        "JOIN lkup_ownership_statuses s"
        "  ON s.ownership_status_id = c.ownership_status_id "
        f"WHERE c.item_id IN ({ids}) AND s.status_code IN "
        "  ('owned', 'trade', 'pending_outgoing') "
        "GROUP BY c.item_id"
    )):
        held[item_id] = n

    # ---- What I paid ------------------------------------------------------
    # Card-level. Per-copy basis arrives with the ledger; until then this is a
    # single figure for every copy and the response says so rather than
    # implying a precision it does not have.
    basis: Dict[int, Dict[str, Any]] = {}
    for item_id, own_cents, source, tier_name, tier_cents in db.execute(text(
        "SELECT c.item_id, c.cost_cents, c.source, t.tier_name, t.cost_cents "
        "FROM mkt_item_cost c "
        "LEFT JOIN mkt_cost_tier t ON t.cost_tier_id = c.cost_tier_id "
        f"WHERE c.item_id IN ({ids})"
    )):
        cents = own_cents if own_cents is not None else tier_cents
        if cents is None:
            continue
        basis[item_id] = {
            "cost_cents": cents,
            "source": source,
            "tier_name": tier_name,
            # Everything available today is an estimate; the ledger flips this.
            "estimated": True,
            "per_copy": False,
        }

    # ---- What it sells for, and what it would cost to buy ------------------
    sold = _net_sold_by_item(db, ids)
    best_single, best_lot = _buy_options(db, ids)

    # ---- Comps per source, with age ---------------------------------------
    # Per source and not overall: nineteen Mercari comps two days old and one
    # Neokyo listing three weeks old is a different picture from "20 comps",
    # and the overall number hides exactly the part that decides whether to
    # trust it.
    comps: Dict[int, List[Dict[str, Any]]] = {}
    for item_id, mkt, n, last_seen in db.execute(text(
        "SELECT ln.item_id, l.marketplace, COUNT(*), MAX(s.observed_at) "
        "FROM mkt_sighting s "
        "JOIN mkt_listing l ON l.listing_id = s.listing_id "
        "JOIN mkt_listing_line ln ON ln.listing_id = l.listing_id "
        f"WHERE ln.item_id IN ({ids}) "
        "GROUP BY ln.item_id, l.marketplace"
    )):
        comps.setdefault(item_id, []).append(
            {"marketplace": mkt, "n": n, "last_seen": last_seen})

    # ---- Assemble ---------------------------------------------------------
    cards = []
    for item_id in item_ids:
        s = sold.get(item_id)
        sold_median = s["median_cents"] if s else None
        sell_net = s["net_cents"] if s else None
        sell_mkt = s["marketplace"] if s else None
        n_sold = s["n"] if s else 0

        paid = basis.get(item_id)
        single = best_single.get(item_id)
        lot = best_lot.get(item_id)

        # Cheapest route that can actually be acted on, for the arb margin.
        # A lot counts -- you can buy it -- but the commitment travels with it
        # so the UI can say what acting on that number really costs.
        routes = [o for o in (single, lot) if o]
        cheapest = min(routes, key=lambda o: o["per_card_cents"]) if routes else None

        cards.append({
            "item_id": item_id,
            "label": labels.get(item_id) or f"item {item_id}",
            "held": held.get(item_id, 0),
            "wanted": item_id in wanted,
            "paid": paid,
            "sold_median_cents": sold_median,
            "sell_net_cents": sell_net,
            "sell_marketplace": sell_mkt,
            "n_sold": n_sold,
            "buy_single": single,
            "buy_lot": lot,
            # sell - paid: margin on what is already held. Only meaningful
            # when something IS held, so it stays None otherwise rather than
            # reporting a profit on a card you do not have.
            "flip_cents": (
                sell_net - paid["cost_cents"]
                if sell_net is not None and paid and held.get(item_id) else None
            ),
            # sell - buy: margin on what could be sourced.
            "arb_cents": (
                sell_net - cheapest["per_card_cents"]
                if sell_net is not None and cheapest else None
            ),
            "arb_via_lot": bool(cheapest and cheapest["line_count"] > 1),
            "comps": comps.get(item_id, []),
        })

    return {
        "cards": cards,
        "generated_at": datetime.utcnow().isoformat(),
        # Card-level basis, stated so the UI never implies per-copy precision.
        "basis_is_per_card": True,
    }


# ───────────────────────── Sold vs gone ──────────────────────────────────────


class DelistIn(BaseModel):
    """What happened to a listing that is no longer up.

    Two different facts, and merging them corrupts the sell side. `sold` with a
    price is a new comp -- revisiting a listing is free price discovery. `gone`
    is the absence of an option and nothing more: a proxy listing that vanishes
    says nothing about what it fetched, and treating it as a sale at the asking
    price would inflate the median with every disappearance.
    """
    outcome: str                      # 'sold' | 'gone'
    price_cents: Optional[int] = None  # sold only, in the listing's currency
    observed_at: Optional[str] = None


@router.post("/listings/{listing_id}/outcome")
def listing_outcome(listing_id: int, body: DelistIn, db=Depends(get_db)):
    row = db.execute(text(
        "SELECT marketplace FROM mkt_listing WHERE listing_id = :i"
    ), {"i": listing_id}).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="No such listing.")
    when = body.observed_at or datetime.utcnow().isoformat()

    if body.outcome == "gone":
        db.execute(text(
            "UPDATE mkt_listing SET delisted_at = :t WHERE listing_id = :i"),
            {"t": when, "i": listing_id})
        db.commit()
        return {"ok": True, "outcome": "gone", "sighting_added": False}

    if body.outcome != "sold":
        raise HTTPException(status_code=400, detail="outcome must be sold or gone")
    if body.price_cents is None:
        raise HTTPException(
            status_code=400,
            detail="A sold price is required. If the price is unknown, "
                   "record it as gone instead — a guessed sale price becomes "
                   "a comp and drags the median.")

    currency = marketplace_currency(db, row[0])
    fx = rate_for(db, currency, when)
    usd = to_usd_minor(body.price_cents, currency, fx)
    db.execute(text(
        "INSERT OR IGNORE INTO mkt_sighting ("
        " listing_id, observed_at, listing_state, raw_status,"
        " price_cents, currency, price_usd, fx_rate, fx_source) "
        "VALUES (:i, :t, 'sold', 'marked_sold', :p, :c, :u, :fx, :fxs)"),
        {"i": listing_id, "t": when, "p": body.price_cents, "c": currency,
         "u": usd, "fx": fx, "fxs": "table" if fx is not None else None})
    # Sold is also gone: it should stop appearing as something to buy.
    db.execute(text(
        "UPDATE mkt_listing SET delisted_at = :t WHERE listing_id = :i"),
        {"t": when, "i": listing_id})
    db.commit()
    return {"ok": True, "outcome": "sold", "sighting_added": True,
            "price_usd": usd}


@router.delete("/listings/{listing_id}")
def delete_listing(listing_id: int, db=Depends(get_db)):
    """Remove a listing and everything hanging off it.

    Deliberately available, and deliberately rare. `gone` is the ordinary way a
    listing stops being a buying option, and it KEEPS the price history, which
    is real evidence about what this card was offered at. This is for a capture
    that should never have been recorded at all -- linked to the wrong card, a
    duplicate, a bad page read -- where the history is not evidence but noise.

    Re-capturing needs no delete: ingest keys listings on
    (marketplace, external_id), so browsing back to a page and capturing again
    updates the listing and appends a fresh sighting. Deleting is for rows that
    should not exist, not for rows that are out of date.

    Child rows go explicitly. SQLite's FK cascades never fire here -- PRAGMA
    foreign_keys is issued only on init_db's own connection -- so a FOREIGN KEY
    clause in schema.sql is documentation, and a delete that trusted it would
    leave orphaned sightings behind, still counted by every comp query.
    """
    row = db.execute(text(
        "SELECT marketplace, external_id, title_raw FROM mkt_listing "
        "WHERE listing_id = :i"), {"i": listing_id}).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="No such listing.")

    sightings = db.execute(text(
        "DELETE FROM mkt_sighting WHERE listing_id = :i"), {"i": listing_id}).rowcount
    lines = db.execute(text(
        "DELETE FROM mkt_listing_line WHERE listing_id = :i"), {"i": listing_id}).rowcount
    db.execute(text("DELETE FROM mkt_listing WHERE listing_id = :i"), {"i": listing_id})
    db.commit()
    return {
        "ok": True,
        "marketplace": row[0],
        "external_id": row[1],
        "title": row[2],
        "sightings_deleted": sightings,
        "lines_deleted": lines,
    }


# ───────────────────────── The lot analyzer ──────────────────────────────────
#
# A card-first model cannot answer "is this 8-card lot worth $118?", because
# that question is about the whole listing at once. This is the view that can.
#
# See docs/photocard_market_intel_plan.md -> v2, the lot analyzer.


def _eras_for(db, item_ids: List[int]) -> Dict[int, str]:
    """`old` (<=2020) or `new` (2021+), off the ORIGIN's ship date.

    The same split the cost tiers use, and for the same reason: it is the one
    boundary that reliably separates price levels. Dates live on the origin and
    never on the card -- 88 origin rows date all 11,323 cards -- and a NULL date
    reads as `new`, matching the tier rules rather than inventing a third case.
    """
    if not item_ids:
        return {}
    ids = ",".join(str(int(i)) for i in item_ids)
    out: Dict[int, str] = {}
    # source_origin_id is nullable -- LEFT JOIN it, always.
    for item_id, start in db.execute(text(
        "SELECT d.item_id, o.start_date FROM tbl_photocard_details d "
        "LEFT JOIN lkup_photocard_source_origins o "
        "       ON o.source_origin_id = d.source_origin_id "
        f"WHERE d.item_id IN ({ids})"
    )):
        out[item_id] = "old" if (start and start <= DEFAULT_ERA_CUTOFF) else "new"
    return out


def _value_ladder(db) -> Dict[str, Any]:
    """Two rungs, and both stay in SALE-value units the whole way down.

    1. the card's own net sold median
    2. otherwise the net sold median of its era

    Cost tiers are deliberately NOT a rung. A tier is an acquisition cost
    ($1-3) and a comp is a sale value ($10-75); mixing the scales would put
    no-comp cards on a different axis entirely and crush them toward zero,
    making them look free to buy. Tiers keep doing their real job -- basis for
    cards already owned.

    Finer rungs (same origin, same version type) are deferred until real lots
    show two to be insufficient.
    """
    net = _net_sold_by_item(db)
    eras = _eras_for(db, list(net))
    buckets: Dict[str, List[int]] = {"old": [], "new": []}
    for item_id, row in net.items():
        if row["net_cents"] is not None:
            buckets[eras.get(item_id, "new")].append(row["net_cents"])
    pooled = buckets["old"] + buckets["new"]
    return {
        "net": net,
        "era_median": {"old": _median(buckets["old"]),
                       "new": _median(buckets["new"])},
        "era_n": {"old": len(buckets["old"]), "new": len(buckets["new"])},
        "pooled_median": _median(pooled),
        "pooled_n": len(pooled),
    }


def _allocate(landed_cents: int, weights: List[Optional[int]]) -> List[Optional[int]]:
    """Split `landed_cents` across lines in proportion to their value.

    Value-weighted rather than even, and that choice IS decision-relevant.
    $100 landed over ten cards, one selling $75 and nine selling $10: an even
    split says the nine are worthless to buy and the one is a lottery win, which
    is false. Weighting by value shows a uniform ~65% margin -- the truth about
    a fairly-priced lot -- and surfaces that 45% of the cost rides on one card
    selling, which the totals hide.

    Largest-remainder, so the parts sum to the whole exactly. A lot whose
    allocation is a cent off its own cost invites the reader to hunt for the
    missing cent instead of reading the margin.

    A line with no value weighs nothing and is allocated nothing -- its share is
    absorbed by the valued lines. That overstates their basis, which is why the
    caller reports unvalued lines rather than letting them pass silently.
    """
    total = sum(w for w in weights if w)
    if not total or landed_cents is None:
        return [None] * len(weights)
    exact = [(landed_cents * w / total) if w else None for w in weights]
    out = [int(x) if x is not None else None for x in exact]
    short = landed_cents - sum(x for x in out if x is not None)
    order = sorted(
        (i for i, x in enumerate(exact) if x is not None),
        key=lambda i: exact[i] - out[i], reverse=True)
    for i in order[:max(0, short)]:
        out[i] += 1
    return out


def _lot_listings(db, listing_id: Optional[int] = None):
    """Listings that hold more than one card, plus anything flagged a lot.

    `is_lot` is explicit and never derived from the line count, because the
    common case is one identified card and N unknowns never entered -- which
    looks single. A flagged listing shows up here so those unknowns can be
    added.
    """
    one = " AND l.listing_id = :i " if listing_id else ""
    return db.execute(text(
        "SELECT l.listing_id, l.marketplace, l.title_raw, l.listing_url,"
        " l.thumbnail_url, l.is_lot, l.delisted_at,"
        f" {UNITS_SQL} AS units,"
        " (SELECT s.price_cents FROM mkt_sighting s WHERE s.listing_id = l.listing_id"
        "   ORDER BY s.observed_at DESC LIMIT 1) AS price_cents,"
        " (SELECT s.currency FROM mkt_sighting s WHERE s.listing_id = l.listing_id"
        "   ORDER BY s.observed_at DESC LIMIT 1) AS currency,"
        " (SELECT s.price_usd FROM mkt_sighting s WHERE s.listing_id = l.listing_id"
        "   ORDER BY s.observed_at DESC LIMIT 1) AS price_usd,"
        " (SELECT s.observed_at FROM mkt_sighting s WHERE s.listing_id = l.listing_id"
        "   ORDER BY s.observed_at DESC LIMIT 1) AS observed_at,"
        " (SELECT s.shipping_usd FROM mkt_sighting s WHERE s.listing_id = l.listing_id"
        "   ORDER BY s.observed_at DESC LIMIT 1) AS shipping_usd "
        "FROM mkt_listing l "
        f"WHERE ({UNITS_SQL} > 1 OR l.is_lot = 1){one} "
        "ORDER BY l.last_seen_at DESC"
    ), {"i": listing_id} if listing_id else {}).mappings().all()


def _analyze_lot(db, listing, ladder, wanted, buy_fees,
                 labels=None, single_routes=None) -> Dict[str, Any]:
    """One lot, valued line by line, with the keep/flip residual that decides it.

    `labels` and `single_routes` are passed in when a caller is doing many lots
    at once; both are looked up here otherwise.
    """
    code = listing["marketplace"]
    if code not in buy_fees:
        buy_fees[code] = fee_model(db, code, "buy")
    landed = landed_cost(listing["price_usd"], buy_fees[code],
                         listing["shipping_usd"])

    rows = db.execute(text(
        "SELECT line_id, line_type, item_id, label, qty, value_cents, disposition "
        "FROM mkt_listing_line WHERE listing_id = :i ORDER BY line_id"
    ), {"i": listing["listing_id"]}).mappings().all()

    card_ids = [r["item_id"] for r in rows if r["item_id"]]
    if labels is None:
        labels = _labels_for(db, card_ids)
    eras = _eras_for(db, card_ids)

    # An unidentified card has no era of its own, so it borrows the lot's --
    # a lot of 2018 cards very likely hides more 2018 cards. With nothing
    # identified at all there is nothing to borrow from and the pooled median
    # stands in.
    in_lot = [eras[i] for i in card_ids if i in eras]
    lot_era = max(set(in_lot), key=in_lot.count) if in_lot else None
    unknown_value = (ladder["era_median"].get(lot_era) if lot_era
                     else ladder["pooled_median"])

    lines = []
    for r in rows:
        qty = max(1, r["qty"] or 1)
        item_id = r["item_id"]
        sold = ladder["net"].get(item_id) if item_id else None

        # The ladder, in order. A manual value is an override and outranks it.
        if r["value_cents"] is not None:
            value, source = r["value_cents"], "manual"
        elif sold and sold["net_cents"] is not None:
            value, source = sold["net_cents"], "sold"
        elif item_id:
            value, source = ladder["era_median"].get(eras.get(item_id, "new")), "era"
        elif r["line_type"] == "unidentified":
            # Not zero. Zero would make the identified cards absorb the whole
            # lot cost, overstating their basis and making the lot look worse
            # than it is. "3 of 10 unidentified" is the signal that matters and
            # it is shown either way.
            value, source = unknown_value, "era"
        else:
            # A non-card line has no ladder to fall back on: an album and a
            # keychain are not the same guess. It stays unvalued until told.
            value, source = None, "none"
        if value is None:
            source = "none"

        # The standing decision about a card is already recorded in the
        # library, so Wanted defaults to keep and most lots need no toggling.
        if r["disposition"] in ("keep", "flip"):
            disposition, disp_source = r["disposition"], "manual"
        else:
            disposition = "keep" if item_id in wanted else "flip"
            disp_source = "library"

        lines.append({
            "line_id": r["line_id"],
            "line_type": r["line_type"],
            "item_id": item_id,
            "label": (labels.get(item_id) if item_id else None) or r["label"]
                     or ("unidentified" if r["line_type"] == "unidentified" else "—"),
            "qty": qty,
            "wanted": item_id in wanted,
            "value_cents": value,
            "value_source": source,
            "line_value_cents": value * qty if value is not None else None,
            "n_sold": sold["n"] if sold else 0,
            "disposition": disposition,
            "disposition_source": disp_source,
        })

    allocs = _allocate(landed, [ln["line_value_cents"] for ln in lines])
    for ln, alloc in zip(lines, allocs):
        ln["alloc_cents"] = alloc
        ln["margin_cents"] = (ln["line_value_cents"] - alloc
                              if alloc is not None and ln["line_value_cents"] is not None
                              else None)

    known = sum(ln["line_value_cents"] for ln in lines
                if ln["line_value_cents"] is not None)
    units = sum(ln["qty"] for ln in lines)
    unvalued = sum(ln["qty"] for ln in lines if ln["line_value_cents"] is None)

    # ---- Keep vs flip, stated as a residual --------------------------------
    # Every factor collapsed into one comparison: what the cards you are
    # keeping actually cost you, against what buying them separately would.
    keeps = [ln for ln in lines if ln["disposition"] == "keep"]
    flips = [ln for ln in lines if ln["disposition"] == "flip"]
    keep_units = sum(ln["qty"] for ln in keeps)
    flip_unvalued = sum(ln["qty"] for ln in flips if ln["line_value_cents"] is None)
    flip_net = sum(ln["line_value_cents"] for ln in flips
                   if ln["line_value_cents"] is not None)

    if single_routes is None:
        keep_ids = [ln["item_id"] for ln in keeps if ln["item_id"]]
        single_routes = _buy_options(
            db, ",".join(str(int(i)) for i in keep_ids))[0] if keep_ids else {}

    separate = 0
    priced = unpriced = 0
    for ln in keeps:
        route = single_routes.get(ln["item_id"]) if ln["item_id"] else None
        if route:
            separate += route["per_card_cents"] * ln["qty"]
            priced += ln["qty"]
        else:
            unpriced += ln["qty"]

    kept_cost = landed - flip_net if landed is not None else None
    # Only a comparison when every kept card has a separate price to compare
    # against. A partial total would read as the whole answer and understate
    # the alternative, which is the direction that talks you into the lot.
    comparable = bool(keep_units) and unpriced == 0 and kept_cost is not None
    residual = {
        "keep_units": keep_units,
        "flip_units": sum(ln["qty"] for ln in flips),
        "flip_net_cents": flip_net if flips else None,
        "flip_unvalued_units": flip_unvalued,
        "kept_cost_cents": kept_cost if keep_units else None,
        "kept_per_unit_cents": (int(round(kept_cost / keep_units))
                                if keep_units and kept_cost is not None else None),
        "separate_cost_cents": separate if comparable else None,
        "keep_units_unpriced": unpriced,
        # Positive means the lot saves you that much over buying the keepers
        # one at a time; negative means it costs you that much extra.
        "lot_advantage_cents": (separate - kept_cost) if comparable else None,
    }

    return {
        "listing_id": listing["listing_id"],
        "marketplace": code,
        "title": listing["title_raw"],
        "listing_url": listing["listing_url"],
        "thumbnail_url": listing["thumbnail_url"],
        "delisted_at": listing["delisted_at"],
        "price_cents": listing["price_cents"],
        "currency": listing["currency"],
        "price_usd": listing["price_usd"],
        "observed_at": listing["observed_at"],
        "landed_cents": landed,
        # A lot's postage is a real part of what it costs, and on eBay it is
        # stated per listing. USD, like every other figure on this response;
        # None means the page was not read for it and the marketplace
        # estimate is standing in.
        "shipping_usd": listing["shipping_usd"],
        "units": units,
        "n_lines": len(lines),
        "unidentified_units": sum(ln["qty"] for ln in lines
                                  if ln["line_type"] == "unidentified"),
        "unvalued_units": unvalued,
        "known_value_cents": known if known else None,
        # The lot-level number, which stays the authoritative one however the
        # cost is split across lines.
        "margin_cents": (known - landed) if (known and landed is not None) else None,
        "lot_era": lot_era,
        "lines": lines,
        "residual": residual,
    }


@router.get("/lots")
def list_lots(db=Depends(get_db)):
    listings = _lot_listings(db)
    if not listings:
        return {"lots": [], "generated_at": datetime.utcnow().isoformat()}

    ladder = _value_ladder(db)
    wanted = {r[0] for r in db.execute(text(
        "SELECT DISTINCT c.item_id FROM tbl_photocard_copies c "
        "JOIN lkup_ownership_statuses s"
        "  ON s.ownership_status_id = c.ownership_status_id "
        "WHERE s.status_code = 'wanted'"))}

    # Labels and single-card routes for every card in every lot, fetched once.
    all_ids = [r[0] for r in db.execute(text(
        "SELECT DISTINCT ln.item_id FROM mkt_listing_line ln "
        "JOIN mkt_listing l ON l.listing_id = ln.listing_id "
        f"WHERE ln.item_id IS NOT NULL AND ({UNITS_SQL} > 1 OR l.is_lot = 1)"))]
    labels = _labels_for(db, all_ids)
    routes = _buy_options(db, ",".join(str(int(i)) for i in all_ids))[0] if all_ids else {}

    fees: Dict[str, Any] = {}
    lots = []
    for listing in listings:
        a = _analyze_lot(db, listing, ladder, wanted, fees, labels, routes)
        a.pop("lines")
        lots.append(a)
    return {"lots": lots, "generated_at": datetime.utcnow().isoformat()}


@router.get("/lots/{listing_id}")
def get_lot(listing_id: int, db=Depends(get_db)):
    rows = _lot_listings(db, listing_id)
    if not rows:
        # Not 404 on a listing that exists but holds one card: the useful reply
        # is why it is not a lot, and that adding an unidentified line makes it
        # one.
        exists = db.execute(text(
            "SELECT 1 FROM mkt_listing WHERE listing_id = :i"), {"i": listing_id}
        ).fetchone()
        raise HTTPException(
            status_code=404,
            detail=("No such listing." if not exists else
                    "That listing holds a single card. Add an unidentified or "
                    "non-card line to analyze it as a lot."))
    ladder = _value_ladder(db)
    wanted = {r[0] for r in db.execute(text(
        "SELECT DISTINCT c.item_id FROM tbl_photocard_copies c "
        "JOIN lkup_ownership_statuses s"
        "  ON s.ownership_status_id = c.ownership_status_id "
        "WHERE s.status_code = 'wanted'"))}
    lot = _analyze_lot(db, rows[0], ladder, wanted, {})
    return {
        "lot": lot,
        # Said out loud so a card priced off rung 2 is visibly an estimate.
        "ladder": {"era_median": ladder["era_median"], "era_n": ladder["era_n"],
                   "pooled_median": ladder["pooled_median"]},
        "generated_at": datetime.utcnow().isoformat(),
    }


# ---- Editing a lot's lines --------------------------------------------------
# "Value the album at $12" and "adjust the lot cost by $12" are the same
# operation seen from two ends, so there is one model and not two: every line
# gets a value, the lot's value is their sum, and allocation runs over relative
# value.


class LotLineIn(BaseModel):
    line_type: str = "non_card"        # non_card | unidentified | card
    label: Optional[str] = None
    qty: int = 1
    item_id: Optional[int] = None
    value_cents: Optional[int] = None  # per unit, USD cents, net of sell fees
    disposition: Optional[str] = None  # keep | flip


class LotLinePatch(BaseModel):
    label: Optional[str] = None
    qty: Optional[int] = None
    value_cents: Optional[int] = None
    disposition: Optional[str] = None
    # Explicit, because None on the fields above already means "leave alone".
    # Without these there is no way to say "go back to deriving it", and the
    # derived value is the one most lines should be using.
    clear_value: bool = False
    clear_disposition: bool = False


def _check_line_fields(line_type=None, disposition=None, qty=None, value=None):
    if line_type is not None and line_type not in ("card", "non_card", "unidentified"):
        raise HTTPException(status_code=400,
                            detail="line_type must be card, non_card or unidentified")
    if disposition is not None and disposition not in ("keep", "flip"):
        raise HTTPException(status_code=400, detail="disposition must be keep or flip")
    if qty is not None and qty < 1:
        raise HTTPException(status_code=400, detail="qty must be at least 1")
    if value is not None and value < 0:
        raise HTTPException(status_code=400, detail="value cannot be negative")


def _lot_or_404(db, listing_id: int):
    if db.execute(text("SELECT 1 FROM mkt_listing WHERE listing_id = :i"),
                  {"i": listing_id}).fetchone() is None:
        raise HTTPException(status_code=404, detail="No such listing.")


@router.post("/lots/{listing_id}/lines", status_code=201)
def add_lot_line(listing_id: int, body: LotLineIn, db=Depends(get_db)):
    _lot_or_404(db, listing_id)
    _check_line_fields(body.line_type, body.disposition, body.qty, body.value_cents)
    if body.line_type == "card" and not body.item_id:
        raise HTTPException(status_code=400, detail="A card line needs an item_id.")

    type_id = _photocard_type_id(db) if body.item_id else None
    res = db.execute(text(
        "INSERT INTO mkt_listing_line (listing_id, line_type, item_id,"
        " collection_type_id, label, qty, value_cents, disposition) "
        "VALUES (:l, :t, :i, :c, :lab, :q, :v, :d)"),
        {"l": listing_id, "t": body.line_type, "i": body.item_id, "c": type_id,
         "lab": (body.label or "").strip() or None, "q": body.qty,
         "v": body.value_cents, "d": body.disposition})
    # Adding a line is what makes a one-card listing a lot, so say so on the
    # listing too rather than leaving the flag disagreeing with the contents.
    db.execute(text("UPDATE mkt_listing SET is_lot = 1 WHERE listing_id = :i"),
               {"i": listing_id})
    db.commit()
    return {"ok": True, "line_id": res.lastrowid}


@router.patch("/lots/{listing_id}/lines/{line_id}")
def update_lot_line(listing_id: int, line_id: int, body: LotLinePatch,
                    db=Depends(get_db)):
    _lot_or_404(db, listing_id)
    _check_line_fields(disposition=body.disposition, qty=body.qty,
                       value=body.value_cents)
    sets, params = [], {"l": line_id, "i": listing_id}
    if body.label is not None:
        sets.append("label = :lab")
        params["lab"] = body.label.strip() or None
    if body.qty is not None:
        sets.append("qty = :q")
        params["q"] = body.qty
    if body.clear_value:
        sets.append("value_cents = NULL")
    elif body.value_cents is not None:
        sets.append("value_cents = :v")
        params["v"] = body.value_cents
    if body.clear_disposition:
        sets.append("disposition = NULL")
    elif body.disposition is not None:
        sets.append("disposition = :d")
        params["d"] = body.disposition
    if not sets:
        return {"ok": True, "changed": False}

    res = db.execute(text(
        f"UPDATE mkt_listing_line SET {', '.join(sets)} "
        "WHERE line_id = :l AND listing_id = :i"), params)
    if res.rowcount == 0:
        raise HTTPException(status_code=404, detail="No such line on that listing.")
    db.commit()
    return {"ok": True, "changed": True}


@router.delete("/lots/{listing_id}/lines/{line_id}")
def delete_lot_line(listing_id: int, line_id: int, db=Depends(get_db)):
    _lot_or_404(db, listing_id)
    res = db.execute(text(
        "DELETE FROM mkt_listing_line WHERE line_id = :l AND listing_id = :i"),
        {"l": line_id, "i": listing_id})
    if res.rowcount == 0:
        raise HTTPException(status_code=404, detail="No such line on that listing.")
    db.commit()
    return {"ok": True}
