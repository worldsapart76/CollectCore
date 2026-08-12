"""
Binder Designer — digital layout planning for physical photocard binders.

A binder has one pocket layout (2x2 / 2x3 / 3x3 / 3x4, cols x rows), an ordered
list of sheets, and at most one card per pocket. Slots are row-major and 0-based
within a page: slot_index = row * cols + col.

**Dev-only.** The UI is gated behind `import.meta.env.DEV`, so these endpoints
are unreachable from a production bundle and the tables stay empty in prod.

Design: docs/photocard_binder_designer_plan.md

Two invariants worth knowing before editing:

  * `tbl_binder_slots.item_id` is UNIQUE across the whole table — a card lives
    in at most one pocket of one binder, matching physical reality. A save that
    would place a card held by another binder returns 409 rather than moving it.
  * FK cascades do NOT fire (`PRAGMA foreign_keys` is off on request sessions),
    so every delete here removes child rows explicitly. Photocard deletion frees
    slots via _delete_binder_slots_for_items in routers/photocards.py.
"""

import logging
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text

from constants import PHOTOCARD_COLLECTION_TYPE_ID
from dependencies import get_db


logger = logging.getLogger("collectcore.binders")
router = APIRouter(prefix="/binders", tags=["binders"])

# Pocket count per layout, keyed ACROSS x DOWN. Mirrored (deliberately
# duplicated — four integers) in frontend/src/components/binder/binderLayout.js,
# which also owns the cols/rows split and the back-side mirroring maths.
# Legacy '2x3'/'3x4' codes are rewritten to '3x2'/'4x3' by db.py on startup.
LAYOUT_POCKETS = {"2x2": 4, "3x2": 6, "3x3": 9, "4x3": 12}

MAX_PAGES = 200


# ---------- Helpers ----------

def _get_binder_row(db, binder_id: int):
    row = db.execute(
        text(
            "SELECT binder_id, binder_name, layout_code, notes, created_at, updated_at "
            "FROM tbl_binders WHERE binder_id = :bid"
        ),
        {"bid": binder_id},
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Binder not found.")
    return row


def _binder_to_dict(row) -> dict:
    return {
        "binder_id": row[0],
        "binder_name": row[1],
        "layout_code": row[2],
        "notes": row[3],
        "created_at": row[4],
        "updated_at": row[5],
        "pockets": LAYOUT_POCKETS.get(row[2], 0),
    }


def _placed_count(db, binder_id: int) -> int:
    (count,) = db.execute(
        text(
            "SELECT COUNT(*) FROM tbl_binder_slots s "
            "JOIN tbl_binder_pages p ON p.page_id = s.page_id "
            "WHERE p.binder_id = :bid"
        ),
        {"bid": binder_id},
    ).fetchone()
    return count


def _delete_binder_contents(db, binder_id: int) -> None:
    """Drop every page + slot of a binder. Explicit because FK cascades are off."""
    db.execute(
        text(
            "DELETE FROM tbl_binder_slots WHERE page_id IN "
            "(SELECT page_id FROM tbl_binder_pages WHERE binder_id = :bid)"
        ),
        {"bid": binder_id},
    )
    db.execute(text("DELETE FROM tbl_binder_pages WHERE binder_id = :bid"), {"bid": binder_id})


def _touch(db, binder_id: int) -> None:
    db.execute(
        text("UPDATE tbl_binders SET updated_at = CURRENT_TIMESTAMP WHERE binder_id = :bid"),
        {"bid": binder_id},
    )


# ---------- List / create ----------

class CreateBinderBody(BaseModel):
    binder_name: str = Field(..., min_length=1, max_length=120)
    layout_code: str
    page_count: int = Field(1, ge=1, le=MAX_PAGES)
    notes: Optional[str] = Field(None, max_length=2000)


@router.get("")
def list_binders(db=Depends(get_db)):
    rows = db.execute(
        text(
            """
            SELECT b.binder_id, b.binder_name, b.layout_code, b.notes,
                   b.created_at, b.updated_at,
                   (SELECT COUNT(*) FROM tbl_binder_pages p
                     WHERE p.binder_id = b.binder_id) AS page_count,
                   (SELECT COUNT(*) FROM tbl_binder_slots s
                      JOIN tbl_binder_pages p2 ON p2.page_id = s.page_id
                     WHERE p2.binder_id = b.binder_id) AS placed_count
            FROM tbl_binders b
            ORDER BY b.binder_name COLLATE NOCASE
            """
        )
    ).fetchall()
    return [
        {**_binder_to_dict(r), "page_count": r[6], "placed_count": r[7]}
        for r in rows
    ]


@router.post("")
def create_binder(body: CreateBinderBody, db=Depends(get_db)):
    if body.layout_code not in LAYOUT_POCKETS:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown layout_code. Expected one of {', '.join(LAYOUT_POCKETS)}.",
        )
    name = body.binder_name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Binder name cannot be blank.")

    (binder_id,) = db.execute(
        text(
            "INSERT INTO tbl_binders (binder_name, layout_code, notes) "
            "VALUES (:name, :layout, :notes) RETURNING binder_id"
        ),
        {"name": name, "layout": body.layout_code, "notes": (body.notes or "").strip() or None},
    ).fetchone()

    for page_index in range(body.page_count):
        db.execute(
            text("INSERT INTO tbl_binder_pages (binder_id, page_index) VALUES (:bid, :idx)"),
            {"bid": binder_id, "idx": page_index},
        )
    db.commit()

    logger.info("Binder created id=%s layout=%s pages=%d", binder_id, body.layout_code, body.page_count)
    row = _get_binder_row(db, binder_id)
    return {**_binder_to_dict(row), "page_count": body.page_count, "placed_count": 0}


# ---------- Placements (must precede /{binder_id} — 'placements' is not an int) ----------

@router.get("/placements")
def list_placements(db=Depends(get_db)):
    """Every placed card, keyed by item_id (as a string, per JSON object keys).

    Drives the "once globally" rule in the designer's available-cards tray: a
    card held by any binder is unavailable everywhere. Joins tbl_items so a slot
    left behind by a deleted card never surfaces as a phantom placement.
    """
    rows = db.execute(
        text(
            """
            SELECT s.item_id, b.binder_id, b.binder_name, p.page_index, s.slot_index
            FROM tbl_binder_slots s
            JOIN tbl_binder_pages p ON p.page_id = s.page_id
            JOIN tbl_binders b ON b.binder_id = p.binder_id
            JOIN tbl_items i ON i.item_id = s.item_id
            """
        )
    ).fetchall()
    return {
        str(r[0]): {
            "binder_id": r[1],
            "binder_name": r[2],
            "page_index": r[3],
            "slot_index": r[4],
        }
        for r in rows
    }


# ---------- Single binder ----------

@router.get("/{binder_id}")
def get_binder(binder_id: int, db=Depends(get_db)):
    row = _get_binder_row(db, binder_id)

    # LEFT JOIN so empty pages still come back; the tbl_items join condition
    # drops slots whose card has since been deleted (see module docstring).
    rows = db.execute(
        text(
            """
            SELECT p.page_index, s.slot_index, s.item_id
            FROM tbl_binder_pages p
            LEFT JOIN tbl_binder_slots s ON s.page_id = p.page_id
            LEFT JOIN tbl_items i ON i.item_id = s.item_id
            WHERE p.binder_id = :bid
              AND (s.slot_id IS NULL OR i.item_id IS NOT NULL)
            ORDER BY p.page_index, s.slot_index
            """
        ),
        {"bid": binder_id},
    ).fetchall()

    pages: Dict[int, List[dict]] = {}
    for page_index, slot_index, item_id in rows:
        slots = pages.setdefault(page_index, [])
        if item_id is not None:
            slots.append({"slot_index": slot_index, "item_id": item_id})

    return {
        "binder": _binder_to_dict(row),
        "pages": [
            {"page_index": idx, "slots": pages[idx]}
            for idx in sorted(pages)
        ],
    }


class UpdateBinderBody(BaseModel):
    binder_name: Optional[str] = Field(None, min_length=1, max_length=120)
    notes: Optional[str] = Field(None, max_length=2000)
    layout_code: Optional[str] = None


@router.patch("/{binder_id}")
def update_binder(binder_id: int, body: UpdateBinderBody, db=Depends(get_db)):
    _get_binder_row(db, binder_id)

    updates = []
    params = {"bid": binder_id}

    if body.binder_name is not None:
        name = body.binder_name.strip()
        if not name:
            raise HTTPException(status_code=400, detail="Binder name cannot be blank.")
        updates.append("binder_name = :name")
        params["name"] = name

    if body.notes is not None:
        updates.append("notes = :notes")
        params["notes"] = body.notes.strip() or None

    if body.layout_code is not None:
        if body.layout_code not in LAYOUT_POCKETS:
            raise HTTPException(
                status_code=400,
                detail=f"Unknown layout_code. Expected one of {', '.join(LAYOUT_POCKETS)}.",
            )
        # Changing pocket count would leave cards in slots that no longer exist
        # (or silently re-flow a layout the user arranged by hand). Require an
        # empty binder rather than guessing what should happen to the cards.
        if _placed_count(db, binder_id) > 0:
            raise HTTPException(
                status_code=400,
                detail="Remove all cards before changing this binder's layout.",
            )
        updates.append("layout_code = :layout")
        params["layout"] = body.layout_code

    if not updates:
        raise HTTPException(status_code=400, detail="Nothing to update.")

    updates.append("updated_at = CURRENT_TIMESTAMP")
    db.execute(text(f"UPDATE tbl_binders SET {', '.join(updates)} WHERE binder_id = :bid"), params)
    db.commit()

    row = _get_binder_row(db, binder_id)
    return _binder_to_dict(row)


@router.delete("/{binder_id}")
def delete_binder(binder_id: int, db=Depends(get_db)):
    _get_binder_row(db, binder_id)
    _delete_binder_contents(db, binder_id)
    db.execute(text("DELETE FROM tbl_binders WHERE binder_id = :bid"), {"bid": binder_id})
    db.commit()
    logger.info("Binder deleted id=%s", binder_id)
    return {"binder_id": binder_id, "status": "deleted"}


# ---------- Save (full replace) ----------

class BinderSlotIn(BaseModel):
    slot_index: int = Field(..., ge=0)
    item_id: int


class BinderPageIn(BaseModel):
    slots: List[BinderSlotIn] = []


class SaveBinderPagesBody(BaseModel):
    # page_index is the list position — the client always holds the whole
    # structure, so there is nothing to reconcile.
    pages: List[BinderPageIn] = Field(..., max_length=MAX_PAGES)


@router.put("/{binder_id}/pages")
def save_binder_pages(binder_id: int, body: SaveBinderPagesBody, db=Depends(get_db)):
    """Replace a binder's entire page/slot structure in one transaction.

    The designer stages every change client-side (nothing hits the DB until
    Save), so at save time the client holds the authoritative structure — a
    full replace is both smaller and less error-prone than reconciling
    add/move/remove deltas, and a binder is at most a few hundred slots.
    """
    binder = _binder_to_dict(_get_binder_row(db, binder_id))
    pockets = LAYOUT_POCKETS.get(binder["layout_code"])
    if pockets is None:
        raise HTTPException(status_code=400, detail="Binder has an unknown layout_code.")

    # --- Validate the payload before touching anything ---
    all_item_ids: List[int] = []
    for page_index, page in enumerate(body.pages):
        seen_slots = set()
        for slot in page.slots:
            if slot.slot_index >= pockets:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"Page {page_index + 1}: slot {slot.slot_index} is outside a "
                        f"{binder['layout_code']} page ({pockets} pockets)."
                    ),
                )
            if slot.slot_index in seen_slots:
                raise HTTPException(
                    status_code=400,
                    detail=f"Page {page_index + 1}: slot {slot.slot_index} used twice.",
                )
            seen_slots.add(slot.slot_index)
            all_item_ids.append(slot.item_id)

    duplicates = {i for i in all_item_ids if all_item_ids.count(i) > 1}
    if duplicates:
        raise HTTPException(
            status_code=400,
            detail=f"Cards placed more than once in this binder: {sorted(duplicates)}.",
        )

    if all_item_ids:
        item_ph = ",".join(str(i) for i in all_item_ids)

        found = db.execute(
            text(
                f"SELECT item_id FROM tbl_items "
                f"WHERE item_id IN ({item_ph}) AND collection_type_id = :ct_id"
            ),
            {"ct_id": PHOTOCARD_COLLECTION_TYPE_ID},
        ).fetchall()
        if len(found) != len(set(all_item_ids)):
            missing = set(all_item_ids) - {r[0] for r in found}
            raise HTTPException(
                status_code=400,
                detail=f"Not photocards, or no longer exist: {sorted(missing)}.",
            )

        # A card held by a different binder is a conflict, not a move. Only
        # reachable from a stale tab; UNIQUE (item_id) is the backstop.
        conflicts = db.execute(
            text(
                f"""
                SELECT s.item_id, b.binder_id, b.binder_name
                FROM tbl_binder_slots s
                JOIN tbl_binder_pages p ON p.page_id = s.page_id
                JOIN tbl_binders b ON b.binder_id = p.binder_id
                WHERE s.item_id IN ({item_ph})
                  AND p.binder_id != :bid
                """
            ),
            {"bid": binder_id},
        ).fetchall()
        if conflicts:
            raise HTTPException(
                status_code=409,
                detail={
                    "message": "Some cards are already placed in another binder.",
                    "conflicts": [
                        {"item_id": c[0], "binder_id": c[1], "binder_name": c[2]}
                        for c in conflicts
                    ],
                },
            )

    # --- Replace ---
    _delete_binder_contents(db, binder_id)
    slot_total = 0
    for page_index, page in enumerate(body.pages):
        (page_id,) = db.execute(
            text(
                "INSERT INTO tbl_binder_pages (binder_id, page_index) "
                "VALUES (:bid, :idx) RETURNING page_id"
            ),
            {"bid": binder_id, "idx": page_index},
        ).fetchone()
        for slot in page.slots:
            db.execute(
                text(
                    "INSERT INTO tbl_binder_slots (page_id, slot_index, item_id) "
                    "VALUES (:pid, :sidx, :iid)"
                ),
                {"pid": page_id, "sidx": slot.slot_index, "iid": slot.item_id},
            )
            slot_total += 1

    _touch(db, binder_id)
    db.commit()

    logger.info("Binder %s saved: %d pages, %d cards", binder_id, len(body.pages), slot_total)
    return {
        "binder_id": binder_id,
        "page_count": len(body.pages),
        "placed_count": slot_total,
    }
