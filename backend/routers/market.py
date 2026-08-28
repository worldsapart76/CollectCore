"""Market intel — capture ingest and price comps.

Admin only. Receives listing captures from the browser extension and answers
"what does this card actually go for". Design:
docs/photocard_market_intel_plan.md.

Strictly additive: nothing here reads or writes tbl_photocard_details, the
catalog, the pricing tables, or /pcs/. The only link to the library is a
nullable item_id on a line.
"""

from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
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
    capturedAt: str
    lines: List[CaptureLine] = Field(default_factory=list)
    sightings: List[Sighting] = Field(default_factory=list)


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
                    " via_fallback, first_seen_at, last_seen_at) "
                    "VALUES (:mp, :ext, :url, :title, :cond, :cat, :cat_id,"
                    " :brand, :thumb, :q, :lot, :slot, :fb, :first, :last) "
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
                    "UPDATE mkt_listing SET "
                    " is_lot = :lot, suspected_lot = :slot,"
                    " last_seen_at = MAX(last_seen_at, :last) "
                    "WHERE listing_id = :id"
                ),
                {
                    "lot": int(cap.isLot),
                    "slot": int(cap.suspectedLot),
                    "last": last_seen,
                    "id": listing_id,
                },
            )

        # Lines are replaced wholesale rather than merged: the extension holds
        # the user's current answer for what is in this listing, and a removed
        # card must actually disappear. SQLite FK cascades never fire (only
        # init_db's connection sets the pragma), so the delete is explicit.
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

        for s in cap.sightings:
            if s.priceUsd is not None:
                usd, fx_source = s.priceUsd, "marketplace"
                fx = implied_rate(s.priceCents, currency, s.priceUsd)
            else:
                fx = rate_for(db, currency, s.observedAt)
                fx_source = "table" if fx is not None else None
                usd = to_usd_minor(s.priceCents, currency, fx)

            res = db.execute(
                text(
                    "INSERT OR IGNORE INTO mkt_sighting ("
                    " listing_id, observed_at, listing_state, raw_status,"
                    " price_cents, currency, price_usd, fx_rate, fx_source) "
                    "VALUES (:id, :at, :state, :raw, :price, :cur, :usd,"
                    " :fx, :fxs)"
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
                },
            )
            sightings_new += res.rowcount or 0

    db.commit()
    return {
        "ok": True,
        "received": len(batch.captures),
        "listings_new": listings_new,
        "sightings_new": sightings_new,
        "lines_written": lines_new,
    }


# ---------- Marketplaces & FX ----------


@router.get("/marketplaces")
def list_marketplaces(db=Depends(get_db)):
    rows = db.execute(
        text(
            "SELECT marketplace_code, marketplace_name, currency, side,"
            " is_active FROM lkup_mkt_marketplaces "
            "WHERE is_active = 1 ORDER BY sort_order"
        )
    ).mappings().all()
    return {"marketplaces": [dict(r) for r in rows]}


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
    return {"cards": [dict(r) for r in rows]}


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

    lots = db.execute(
        text(
            "SELECT l.listing_id, l.listing_url, l.title_raw,"
            " l.thumbnail_url, s.price_cents, s.listing_state, s.observed_at,"
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
    active = [r["price_usd"] for r in series
              if r["listing_state"] == "active" and r["price_usd"] is not None]
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

    return {
        "item_id": item_id,
        "currency": "USD",
        "unconverted": unconverted,
        "active": stats(active),
        "sold": stats(sold),
        "series": [dict(r) for r in series],
        "excluded_lots": [dict(r) for r in lots],
    }
