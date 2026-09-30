"""
The offline card book: a PDF of the photocard library to carry where there is
no signal.

Phase 2 of `docs/photocard_offline_card_book_plan.md`. One PDF, bookmarked by
member then source origin, every card marked with whether it is held. Built from
the thumbnail cache in `pdf_thumbs.py` — embedding cached JPEGs as-is is what
keeps generation inside Cloudflare's ~100s proxy cap.

Unit cards (multiple members) are repeated in EVERY member's section: in a shop
you look under the member, not under "OT8". fpdf2 embeds a repeated image once
and references it again, so the ~473 repeats cost almost nothing.

Statuses are passed in as {item_id: {status_code}}, so the /pcs/ wrapper can
supply a user's own pcs_card_copies without this module knowing about tiers.
`held` — the "do I already have this?" the whole book exists to answer — means
an `owned` or `pending_incoming` copy. A card whose only copy is `trade` reads
as not held, by decision (see the plan).
"""

import logging
from dataclasses import dataclass, field
from datetime import date
from typing import Optional

from pdf_thumbs import thumb_path

logger = logging.getLogger("collectcore.pdf_card_book")

PHOTOCARDS_CODE = "photocards"

HELD_CODES = ("owned", "pending_incoming")

# Shared with the routers so admin and /pcs/ validate identically.
# `mine` = cards this person has actually annotated. It is the /pcs/ default:
# a friend with two cards should not be handed the whole 11.8k-card, 90MB
# catalog, and their library page already defaults to the same scope.
CARD_FILTERS = ("all", "mine", "hide_not_wanted", "wanted_only", "owned_only")
PAGE_SIZES = ("a4", "phone")

@dataclass
class Geometry:
    """Page shape and grid.

    Two presets. `a4` is the printable/desktop book. `phone` is a page shaped
    like a phone screen, so a PDF viewer's fit-to-width shows tiles at a usable
    size instead of an A4 page shrunk to a sixth — the difference between
    reading the book and pinch-zooming every row.
    """
    page_w: float
    page_h: float
    cols: int
    margin: float = 8.0
    gap: float = 1.6
    header_h: float = 7.0
    band_h: float = 5.6
    mark_h: float = 3.4
    cap_h: float = 3.6

    @property
    def tile_w(self) -> float:
        return (self.page_w - 2 * self.margin - (self.cols - 1) * self.gap) / self.cols

    @property
    def img_h(self) -> float:
        return self.tile_w * 1.54          # card art is 600x924

    @property
    def tile_h(self) -> float:
        return self.img_h + self.mark_h + self.cap_h + 1.5


PAGES = {
    "a4": Geometry(page_w=210.0, page_h=297.0, cols=6),
    # ~2:1, the shape of a phone screen held upright.
    "phone": Geometry(page_w=95.0, page_h=185.0, cols=3, margin=4.0, gap=1.3),
}

# Status strip colours: (fill RGB, label)
MARKS = {
    "held": ((22, 101, 52), "HAVE"),
    "wanted": ((30, 64, 175), "WANT"),
    "trade": ((180, 83, 9), "TRADE"),
    # lomo_fanmade is "an unofficial fan-printed card, held INSTEAD of Owned"
    # (db.py migration note). It gets its own mark rather than counting as
    # HAVE: you do hold something, but not the official card, so folding it
    # into HAVE could talk you out of a card you still want. Leaving it blank
    # was worse — it read as "you don't have this" for a card you do.
    "lomo_fanmade": ((109, 40, 217), "LOMO"),
    "not_wanted": ((120, 113, 108), "NO"),
}


@dataclass
class BookOptions:
    member_ids: Optional[list[int]] = None
    # all | hide_not_wanted | wanted_only | owned_only
    card_filter: str = "all"
    # a4 = printable/desktop; phone = phone-shaped page, so fit-to-width in a
    # phone PDF viewer shows tiles big enough to identify a card.
    page: str = "a4"
    # /pcs/ users only see committed catalog cards; admin also sees drafts.
    catalog_only: bool = False
    title: str = "Photocard Card Book"


@dataclass
class Card:
    item_id: int
    version: Optional[str]
    is_special: bool
    origin_id: Optional[int]
    origin_name: str
    front_path: Optional[str]
    codes: set = field(default_factory=set)

    @property
    def held(self) -> bool:
        return any(c in self.codes for c in HELD_CODES)

    def mark(self) -> Optional[tuple]:
        if self.held:
            return MARKS["held"]
        for code in ("lomo_fanmade", "wanted", "trade", "not_wanted"):
            if code in self.codes:
                return MARKS[code]
        return None


# ---------- data ----------

def load_cards(conn, statuses: dict[int, set],
               catalog_only: bool = False) -> tuple[list[Card], dict[int, list], list[tuple]]:
    """Returns (cards, members_by_item, members) using a raw sqlite3 connection.

    `catalog_only` scopes to committed catalog cards, which is what /pcs/ users
    can see; the admin book also includes not-yet-published drafts.
    """
    photocards_id = conn.execute(
        "SELECT collection_type_id FROM lkup_collection_types WHERE collection_type_code = ?",
        (PHOTOCARDS_CODE,),
    ).fetchone()[0]

    # LEFT JOIN the origin: source_origin_id is nullable.
    rows = conn.execute(
        """
        SELECT i.item_id, p.version, p.is_special, p.source_origin_id,
               so.source_origin_name,
               MAX(CASE WHEN a.attachment_type = 'front' THEN a.file_path END) AS front_path
        FROM tbl_items i
        JOIN tbl_photocard_details p ON p.item_id = i.item_id
        LEFT JOIN lkup_photocard_source_origins so ON so.source_origin_id = p.source_origin_id
        LEFT JOIN tbl_attachments a ON a.item_id = i.item_id
        WHERE i.collection_type_id = ?
        """
        + ("  AND i.catalog_item_id IS NOT NULL\n" if catalog_only else "")
        + """
        GROUP BY i.item_id
        """,
        (photocards_id,),
    ).fetchall()

    cards = [
        Card(
            item_id=r[0],
            version=r[1],
            is_special=bool(r[2]),
            origin_id=r[3],
            origin_name=r[4] or "No source origin",
            front_path=r[5],
            codes=statuses.get(r[0], set()),
        )
        for r in rows
    ]

    members = conn.execute(
        """
        SELECT member_id, member_name FROM lkup_photocard_members
        ORDER BY sort_order, member_id
        """
    ).fetchall()

    members_by_item: dict[int, list] = {}
    for item_id, member_id in conn.execute(
        "SELECT item_id, member_id FROM xref_photocard_members"
    ):
        members_by_item.setdefault(item_id, []).append(member_id)

    return cards, members_by_item, members


def load_admin_statuses(conn) -> dict[int, set]:
    """Status codes per card from the admin's own copies.

    Resolved by status_code, never by id: ids are not stable between dev and
    prod.
    """
    out: dict[int, set] = {}
    for item_id, code in conn.execute(
        """
        SELECT c.item_id, s.status_code
        FROM tbl_photocard_copies c
        JOIN lkup_ownership_statuses s ON s.ownership_status_id = c.ownership_status_id
        """
    ):
        out.setdefault(item_id, set()).add(code)
    return out


def load_pcs_statuses(conn, user_id: int) -> dict[int, set]:
    """Status codes per card from ONE /pcs/ user's own copies.

    pcs_card_copies is keyed by catalog_item_id (the stable cross-tier
    contract), so it joins back to item_id here rather than the generator
    knowing anything about tiers. Scoped to the caller's user_id — never a
    client-supplied one.
    """
    out: dict[int, set] = {}
    for item_id, code in conn.execute(
        """
        SELECT i.item_id, s.status_code
        FROM pcs_card_copies p
        JOIN tbl_items i ON i.catalog_item_id = p.catalog_item_id
        JOIN lkup_ownership_statuses s ON s.ownership_status_id = p.ownership_status_id
        WHERE p.user_id = ?
        """,
        (user_id,),
    ):
        out.setdefault(item_id, set()).add(code)
    return out


def origin_order(conn) -> dict[int, tuple]:
    """Sort key per origin: ship date first (that is how sets are remembered),
    NULL dates last, then the lookup's own order."""
    keys = {}
    for oid, start, sort_order, name in conn.execute(
        """
        SELECT source_origin_id, start_date, sort_order, source_origin_name
        FROM lkup_photocard_source_origins
        """
    ):
        keys[oid] = (0, start, sort_order or 0, name or "") if start else (1, "", sort_order or 0, name or "")
    return keys


def _keep(card: Card, card_filter: str) -> bool:
    if card_filter == "mine":
        return bool(card.codes)
    if card_filter == "wanted_only":
        return "wanted" in card.codes
    if card_filter == "owned_only":
        return card.held
    if card_filter == "hide_not_wanted":
        # A not_wanted card you nonetheless hold (e.g. a trade copy) stays: the
        # decision and the possession co-exist on purpose.
        return not ("not_wanted" in card.codes and not card.held)
    return True


# ---------- rendering ----------

def _safe(text: str) -> str:
    """Core PDF fonts are latin-1. Names are ASCII today (verified across 73
    origins, 626 versions, 8 members), so rather than ship a Unicode font this
    normalises the punctuation that a rename is likely to introduce and replaces
    anything else unencodable. Hangul would come through as '?' — revisit by
    embedding a CJK font if names ever stop being ASCII."""
    if not text:
        return ""
    for bad, good in (("’", "'"), ("‘", "'"), ("“", '"'),
                      ("”", '"'), ("–", "-"), ("—", "-"),
                      ("…", "...")):
        text = text.replace(bad, good)
    return text.encode("latin-1", "replace").decode("latin-1")


class _Book:
    def __init__(self, pdf, options: BookOptions, stamp: str, geometry: Geometry):
        self.pdf = pdf
        self.options = options
        self.stamp = stamp
        self.g = geometry
        self.section = ""
        self.x = geometry.margin
        self.y = geometry.margin + geometry.header_h
        self.col = 0
        self.missing_thumbs = 0

    # -- page plumbing --
    def new_page(self):
        self.pdf.add_page()
        self._page_header()
        g = self.g
        self.x, self.y, self.col = g.margin, g.margin + g.header_h, 0

    def _page_header(self):
        pdf, g = self.pdf, self.g
        stamp_w = min(60.0, (g.page_w - 2 * g.margin) * 0.45)
        pdf.set_font("Helvetica", "B", 8)
        pdf.set_text_color(60, 60, 60)
        pdf.set_xy(g.margin, g.margin - 2)
        pdf.cell(g.page_w - 2 * g.margin - stamp_w, 4, _safe(self.section), align="L")
        pdf.set_font("Helvetica", "", 6.5)
        pdf.set_xy(g.page_w - g.margin - stamp_w, g.margin - 2)
        pdf.cell(stamp_w, 4, f"as of {self.stamp}", align="R")
        pdf.set_draw_color(220, 220, 220)
        pdf.line(g.margin, g.margin + 2.6, g.page_w - g.margin, g.margin + 2.6)

    def _need(self, h: float):
        if self.y + h > self.g.page_h - self.g.margin:
            self.new_page()

    def _row_break(self):
        self.x = self.g.margin
        self.col = 0
        self.y += self.g.tile_h + self.g.gap

    # -- content --
    def origin_band(self, name: str, count: int):
        if self.col:
            self._row_break()
        pdf, g = self.pdf, self.g
        # Keep a band with at least one row of tiles under it.
        self._need(g.band_h + g.tile_h)
        count_w = min(40.0, (g.page_w - 2 * g.margin) * 0.3)
        pdf.set_fill_color(238, 240, 243)
        pdf.rect(g.margin, self.y, g.page_w - 2 * g.margin, g.band_h, style="F")
        pdf.set_font("Helvetica", "B", 7.5)
        pdf.set_text_color(40, 40, 40)
        pdf.set_xy(g.margin + 1.5, self.y + 0.9)
        pdf.cell(g.page_w - 2 * g.margin - count_w - 3, 4, _safe(name))
        pdf.set_font("Helvetica", "", 6.5)
        pdf.set_text_color(90, 90, 90)
        pdf.set_xy(g.page_w - g.margin - count_w - 1.5, self.y + 0.9)
        pdf.cell(count_w, 4, f"{count} card{'' if count == 1 else 's'}", align="R")
        self.y += g.band_h + g.gap

    def tile(self, card: Card, is_unit: bool):
        g = self.g
        if self.col >= g.cols:
            self._row_break()
        self._need(g.tile_h)
        pdf, x, y = self.pdf, self.x, self.y

        drawn = False
        if card.front_path:
            path = thumb_path(card.item_id, card.front_path)
            if path.exists():
                try:
                    pdf.image(str(path), x=x, y=y, w=g.tile_w, h=g.img_h)
                    drawn = True
                except Exception as exc:  # noqa: BLE001
                    logger.warning("embed failed item_id=%s: %s", card.item_id, exc)
        if not drawn:
            self.missing_thumbs += 1
            pdf.set_fill_color(244, 244, 246)
            pdf.set_draw_color(215, 215, 218)
            pdf.rect(x, y, g.tile_w, g.img_h, style="FD")
            pdf.set_font("Helvetica", "", 6)
            pdf.set_text_color(150, 150, 150)
            pdf.set_xy(x, y + g.img_h / 2 - 2)
            pdf.cell(g.tile_w, 4, "no image", align="C")

        # status strip
        mark = card.mark()
        if mark:
            rgb, label = mark
            pdf.set_fill_color(*rgb)
            pdf.rect(x, y + g.img_h, g.tile_w, g.mark_h, style="F")
            pdf.set_font("Helvetica", "B", 5.6)
            pdf.set_text_color(255, 255, 255)
            pdf.set_xy(x, y + g.img_h + 0.15)
            pdf.cell(g.tile_w, g.mark_h, label, align="C")

        # caption: version, unit and special markers
        bits = []
        if is_unit:
            bits.append("[unit]")
        if card.is_special:
            bits.append("*")
        if card.version:
            bits.append(card.version)
        pdf.set_font("Helvetica", "", 5.4)
        pdf.set_text_color(70, 70, 70)
        pdf.set_xy(x, y + g.img_h + g.mark_h + 0.2)
        # Truncate to what fits the tile rather than a fixed character count,
        # which clipped mid-word on the wider A4 tiles.
        caption = _safe(" ".join(bits))
        while caption and pdf.get_string_width(caption) > g.tile_w - 1:
            caption = caption[:-1]
        pdf.cell(g.tile_w, g.cap_h, caption, align="C")

        self.x += g.tile_w + g.gap
        self.col += 1

    def cover(self, total: int, held: int):
        pdf, g = self.pdf, self.g
        big = g.page_w > 150          # A4 has room for a fuller cover
        self.section = self.options.title
        self.new_page()
        pdf.set_font("Helvetica", "B", 16 if big else 12)
        pdf.set_text_color(20, 20, 20)
        pdf.set_xy(g.margin, g.margin + (12 if big else 6))
        pdf.cell(0, 8, _safe(self.options.title))
        pdf.set_font("Helvetica", "", 9.5 if big else 8)
        pdf.set_text_color(70, 70, 70)
        pdf.set_xy(g.margin, g.margin + (24 if big else 16))
        pdf.multi_cell(g.page_w - 2 * g.margin, 4.6, _safe(
            f"Snapshot taken {self.stamp}. {total} cards, {held} of them held.\n"
            f"Filter: {self.options.card_filter.replace('_', ' ')}.\n\n"
            "Bookmarked by member, then by source origin in ship-date order. "
            "Unit cards appear under every member they include."
        ))

        y = pdf.get_y() + 6
        pdf.set_font("Helvetica", "B", 9)
        pdf.set_text_color(30, 30, 30)
        pdf.set_xy(g.margin, y)
        pdf.cell(0, 5, "Legend")
        y += 7
        for key, note in (("held", "owned, or bought and on its way"),
                          ("wanted", "on the wishlist"),
                          ("trade", "held as a spare for trading"),
                          ("lomo_fanmade", "unofficial fan-printed copy"),
                          ("not_wanted", "decided against")):
            rgb, label = MARKS[key]
            pdf.set_fill_color(*rgb)
            pdf.rect(g.margin, y, 16, g.mark_h + 0.6, style="F")
            pdf.set_font("Helvetica", "B", 5.6)
            pdf.set_text_color(255, 255, 255)
            pdf.set_xy(g.margin, y + 0.2)
            pdf.cell(16, g.mark_h, label, align="C")
            pdf.set_font("Helvetica", "", 8 if big else 7)
            pdf.set_text_color(70, 70, 70)
            pdf.set_xy(g.margin + 19, y - 0.4)
            pdf.cell(0, 5, note)
            y += 6.4
        pdf.set_font("Helvetica", "", 7.5 if big else 6.5)
        pdf.set_xy(g.margin, y + 1)
        pdf.multi_cell(g.page_w - 2 * g.margin, 4,
                       "no strip = undecided    [unit] = multi-member card    * = special")


def build_book(conn, statuses: dict[int, set], options: Optional[BookOptions] = None) -> tuple[bytes, dict]:
    """Render the book. Returns (pdf_bytes, summary)."""
    from fpdf import FPDF

    options = options or BookOptions()
    cards, members_by_item, members = load_cards(conn, statuses, options.catalog_only)
    okeys = origin_order(conn)

    cards = [c for c in cards if _keep(c, options.card_filter)]
    by_item = {c.item_id: c for c in cards}

    wanted_members = set(options.member_ids) if options.member_ids else None
    sections: list[tuple[str, list[Card]]] = []
    for member_id, member_name in members:
        if wanted_members and member_id not in wanted_members:
            continue
        items = [by_item[i] for i, mids in members_by_item.items()
                 if member_id in mids and i in by_item]
        if items:
            sections.append((member_name, items))

    if not wanted_members:
        orphans = [c for c in cards if not members_by_item.get(c.item_id)]
        if orphans:
            sections.append(("No member", orphans))

    geometry = PAGES.get(options.page, PAGES["a4"])
    pdf = FPDF(orientation="P", unit="mm", format=(geometry.page_w, geometry.page_h))
    pdf.set_auto_page_break(False)
    pdf.set_title(options.title)
    pdf.set_creator("CollectCore")
    pdf.set_compression(True)

    stamp = date.today().isoformat()
    book = _Book(pdf, options, stamp, geometry)
    total = len(cards)
    # Count what is actually in THIS book, not the whole library: a
    # member-filtered book would otherwise report the full card count.
    in_book = {c.item_id for _, items in sections for c in items}
    book.cover(len(in_book), sum(1 for i in in_book if by_item[i].held))

    tiles = 0
    rendered: set[int] = set()
    for member_name, items in sections:
        book.section = member_name
        book.new_page()
        pdf.start_section(_safe(member_name), level=0, strict=False)

        groups: dict[Optional[int], list[Card]] = {}
        for c in items:
            groups.setdefault(c.origin_id, []).append(c)

        def gkey(oid):
            return okeys.get(oid, (2, "", 0, "")) if oid is not None else (2, "", 0, "")

        for oid in sorted(groups, key=gkey):
            rows = sorted(groups[oid], key=lambda c: ((c.version or "").lower(), c.item_id))
            book.section = member_name
            book.origin_band(rows[0].origin_name, len(rows))
            pdf.start_section(_safe(rows[0].origin_name), level=1, strict=False)
            for c in rows:
                book.tile(c, is_unit=len(members_by_item.get(c.item_id, [])) > 1)
                tiles += 1
                rendered.add(c.item_id)

    out = bytes(pdf.output())
    return out, {
        # Distinct cards in the book; `tiles` is higher because a unit card is
        # repeated under each of its members.
        "cards": len(rendered),
        "cards_in_library": total,
        "tiles": tiles,
        "members": len(sections),
        "pages": pdf.pages_count,
        "missing_thumbs": book.missing_thumbs,
        "bytes": len(out),
        "page": options.page,
        "generated": stamp,
    }
