import csv
import io
import re
from datetime import datetime
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import text

from dependencies import get_db

router = APIRouter(tags=["export"])

PHOTOCARDS_TYPE_ID = 1

# Fallbacks for installs whose tbl_app_settings predates the pricing migration.
# The live values are settings, not code — listing conventions get tuned
# constantly once you're actually selling, and a redeploy per tweak is absurd.
DEFAULT_TITLE_TEMPLATE = "{group} {member} {source} {version} Official Photocard"
DEFAULT_TITLE_TEMPLATE_PC = "{group} {member} {source} Official {version}"
DEFAULT_DESCRIPTION_TEMPLATE = (
    "{title}. Ships in a toploader and sleeve inside a bubble mailer."
)

_PLACEHOLDER_RE = re.compile(r"\{(\w+)\}")


# ---------- Settings endpoints ----------
#
# These live here because this router was their closest existing home back
# when the photocard PDF export (POST /export/photocards) was retired
# 2026-05-09 in favor of the trade-page architecture (plans/photocard-trading-v2.md)
# and left the router empty. They can move once another module owns app settings.


class SettingUpdate(BaseModel):
    value: str


@router.get("/settings")
def get_settings(db=Depends(get_db)):
    rows = db.execute(text("SELECT key, value FROM tbl_app_settings")).fetchall()
    return {row[0]: row[1] for row in rows}


@router.put("/settings/{key}")
def put_setting(key: str, body: SettingUpdate, db=Depends(get_db)):
    db.execute(
        text(
            "INSERT INTO tbl_app_settings (key, value) VALUES (:key, :value) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value"
        ),
        {"key": key, "value": body.value},
    )
    db.commit()
    row = db.execute(
        text("SELECT key, value FROM tbl_app_settings WHERE key = :key"),
        {"key": key},
    ).fetchone()
    return {"key": row[0], "value": row[1]}


# ---------- Photocard trade CSV export ----------
#
# A paste-ready Mercari listing worksheet for the trade shelf: one row per
# card, with a pre-composed title and a bare price.
#
# The CLIENT drives the selection. The photocard notes search is client-side
# and searches copy notes as well as card notes, so a server-side "select all
# trade copies" query would be blind to it — and the intended workflow is
# "search `for sale` -> export what I see". Same shape as the trade-page flow
# (TradeCreateModal -> POST /trade with item_ids): the backend only formats.
#
# Design: docs/photocard_pricing_and_trade_export_plan.md


class TradeExportPayload(BaseModel):
    item_ids: List[int]


def _render_template(template: str, values: dict) -> str:
    """Substitute {placeholders}, dropping unknown ones and collapsing gaps.

    Unknown placeholders render empty rather than raising — the templates are
    user-editable settings, and a typo should not 500 the export. Collapsing
    whitespace is what keeps a missing `source` or `version` from leaving a
    double space in the middle of a title.
    """
    rendered = _PLACEHOLDER_RE.sub(lambda m: str(values.get(m.group(1)) or ""), template)
    return " ".join(rendered.split())


def _build_title(templates: dict, group: str, member: str, source: str, version: str) -> str:
    """Compose the listing title, branching on whether `version` already says
    "photocard".

    1,444 version values in the library contain the word already ("Photocard
    (Jewel Case Version)", "Film Photocard Set (POB)"). Appending the phrase
    unconditionally reads as redundant AND pushes titles past Mercari's
    80-character cap; branching keeps the full trade set at 42-74 chars.
    """
    version = version or ""
    key = "pc" if "photocard" in version.lower() else "plain"
    template = templates[key]
    return _render_template(
        template,
        {"group": group, "member": member, "source": source, "version": version},
    )


def _format_price(price_cents) -> str:
    """Bare decimal with no currency symbol, so it pastes into Mercari's price
    field directly. Integer math — money is INTEGER cents throughout."""
    if price_cents is None:
        return ""
    return f"{price_cents // 100}.{price_cents % 100:02d}"


@router.post("/export/photocard-trades.csv")
def export_photocard_trades(payload: TradeExportPayload, db=Depends(get_db)):
    if not payload.item_ids:
        raise HTTPException(status_code=400, detail="item_ids cannot be empty.")

    settings = {
        r[0]: r[1] for r in db.execute(
            text(
                "SELECT key, value FROM tbl_app_settings WHERE key IN "
                "('photocard_title_template', 'photocard_title_template_pc', "
                "'photocard_description_template')"
            )
        ).fetchall()
    }
    templates = {
        "plain": settings.get("photocard_title_template") or DEFAULT_TITLE_TEMPLATE,
        "pc": settings.get("photocard_title_template_pc") or DEFAULT_TITLE_TEMPLATE_PC,
    }
    description_template = (
        settings.get("photocard_description_template") or DEFAULT_DESCRIPTION_TEMPLATE
    )

    trade = db.execute(
        text("SELECT ownership_status_id FROM lkup_ownership_statuses WHERE status_code = 'trade'")
    ).fetchone()
    if not trade:
        raise HTTPException(status_code=500, detail="'trade' ownership status is missing.")
    trade_status_id = trade[0]

    item_ph = ",".join(str(int(i)) for i in payload.item_ids)

    # One row per distinct CARD, not per copy: each Mercari listing is one
    # physical card, and only one copy of a stack gets listed at a time. The
    # trade-copy count rides along so a stack is still visible as something to
    # relist. Members join with a SPACE — Mercari's search is token-based, so
    # "Hyunjin Seungmin" reads as two keywords. (Note this deliberately differs
    # from _build_caption in trades.py, which joins with ", " for human
    # display. Different consumers, different joins.)
    rows = db.execute(
        text(f"""
            SELECT
                i.item_id,
                g.group_name,
                COALESCE(
                    (
                        SELECT GROUP_CONCAT(m.member_name, ' ')
                        FROM xref_photocard_members xpm
                        JOIN lkup_photocard_members m ON xpm.member_id = m.member_id
                        WHERE xpm.item_id = i.item_id
                        ORDER BY m.member_id
                    ),
                    ''
                ) AS members,
                so.source_origin_name,
                p.version,
                p.is_special,
                i.notes,
                COUNT(pc.copy_id) AS trade_copies,
                COALESCE(pr.price_cents, pt.price_cents) AS price_cents
            FROM tbl_items i
            JOIN tbl_photocard_details p
                ON p.item_id = i.item_id
            JOIN lkup_photocard_groups g
                ON g.group_id = p.group_id
            JOIN tbl_photocard_copies pc
                ON pc.item_id = i.item_id
               AND pc.ownership_status_id = :trade_id
            LEFT JOIN lkup_photocard_source_origins so
                ON so.source_origin_id = p.source_origin_id
            LEFT JOIN tbl_photocard_pricing pr
                ON pr.item_id = i.item_id
            LEFT JOIN lkup_photocard_price_tiers pt
                ON pt.tier_id = pr.price_tier_id
            WHERE i.item_id IN ({item_ph})
              AND i.collection_type_id = :ct_id
            GROUP BY i.item_id, g.group_name, so.source_origin_name,
                     p.version, p.is_special, i.notes,
                     pr.price_cents, pt.price_cents
        """),
        {"trade_id": trade_status_id, "ct_id": PHOTOCARDS_TYPE_ID},
    ).fetchall()

    # Copy notes, scoped to ALL copies rather than just the trade ones: the
    # client-side search that drives this selection matches any copy's notes,
    # so restricting here would drop the very note that caused the match.
    # Distinct non-empty values joined with " | " so a stack with differing
    # notes loses nothing silently.
    copy_notes = {}
    for item_id, note in db.execute(
        text(f"""
            SELECT item_id, notes FROM tbl_photocard_copies
            WHERE item_id IN ({item_ph}) AND notes IS NOT NULL AND TRIM(notes) != ''
            ORDER BY copy_id
        """)
    ).fetchall():
        copy_notes.setdefault(item_id, []).append(note.strip())

    by_id = {r[0]: r for r in rows}

    buf = io.StringIO(newline="")
    # csv.writer, not manual joining — titles are full of commas, colons and
    # parens ("Cle: Levanter", "Photocard (Jewel Case Version)").
    writer = csv.writer(buf)
    writer.writerow([
        "item_id", "title", "price", "group", "member", "source_origin",
        "version", "special", "copies", "notes", "description",
    ])

    # Preserve the client's order — it posted the ids in the order the user is
    # looking at them, and the worksheet should match the screen.
    exported = 0
    for item_id in payload.item_ids:
        row = by_id.get(item_id)
        if row is None:
            continue  # not a photocard, or has no trade copy
        (_, group_name, members, source_origin, version,
         is_special, card_notes, trade_copies, price_cents) = row

        title = _build_title(
            templates, group_name, members, source_origin or "", version or ""
        )
        notes_parts = []
        if card_notes and card_notes.strip():
            notes_parts.append(card_notes.strip())
        notes_parts.extend(copy_notes.get(item_id, []))
        notes = " | ".join(dict.fromkeys(notes_parts))

        writer.writerow([
            item_id,
            title,
            # Unpriced cards export BLANK rather than being excluded, so the
            # CSV doubles as a "what still needs pricing" worklist.
            _format_price(price_cents),
            group_name,
            members,
            source_origin or "",
            version or "",
            "Yes" if is_special else "",
            trade_copies,
            notes,
            _render_template(description_template, {"title": title}),
        ])
        exported += 1

    # utf-8-sig: Excel on Windows mangles member and album names otherwise.
    data = buf.getvalue().encode("utf-8-sig")
    filename = f"photocard_trades_{datetime.now().strftime('%Y%m%d')}.csv"
    return StreamingResponse(
        iter([data]),
        media_type="text/csv",
        headers={
            "Content-Disposition": f"attachment; filename={filename}",
            "Content-Length": str(len(data)),
            "X-Exported-Rows": str(exported),
        },
    )
