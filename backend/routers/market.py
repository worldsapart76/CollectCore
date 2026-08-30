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
    basis = {
        r[0]: (r[1] if r[1] is not None else r[2])
        for r in db.execute(text(
            "SELECT c.item_id, c.cost_cents, t.cost_cents FROM mkt_item_cost c "
            "LEFT JOIN mkt_cost_tier t ON t.cost_tier_id = c.cost_tier_id"))
    }
    cards = []
    for r in rows:
        d = dict(r)
        d["basis_cents"] = basis.get(d["item_id"])
        cards.append(d)
    return {"cards": cards}


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
        "basis": effective_basis(db, item_id),
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
