"""Market intel — capture ingest and price comps.

Admin only. Receives listing captures from the browser extension and answers
"what does this card actually go for". Design:
docs/photocard_market_intel_plan.md.

Strictly additive: nothing here reads or writes tbl_photocard_details, the
catalog, the pricing tables, or /pcs/. The only link to the library is a
nullable item_id on a line.
"""

from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text

from dependencies import get_db

router = APIRouter(tags=["market"], prefix="/market")


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


class Capture(BaseModel):
    marketplace: str
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
            res = db.execute(
                text(
                    "INSERT OR IGNORE INTO mkt_sighting ("
                    " listing_id, observed_at, listing_state, raw_status,"
                    " price_cents) "
                    "VALUES (:id, :at, :state, :raw, :price)"
                ),
                {
                    "id": listing_id,
                    "at": s.observedAt,
                    "state": s.listingState,
                    "raw": s.rawStatus,
                    "price": s.priceCents,
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

    active = [r["price_cents"] for r in series
              if r["listing_state"] == "active" and r["price_cents"] is not None]
    sold = [r["price_cents"] for r in series
            if r["listing_state"] == "sold" and r["price_cents"] is not None]

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
        "active": stats(active),
        "sold": stats(sold),
        "series": [dict(r) for r in series],
        "excluded_lots": [dict(r) for r in lots],
    }
