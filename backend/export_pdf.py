from pathlib import Path
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import letter
from reportlab.lib.utils import ImageReader

APP_ROOT = Path(__file__).resolve().parents[1]

PAGE_WIDTH, PAGE_HEIGHT = letter

MARGIN_X = 14
MARGIN_TOP = 12
MARGIN_BOTTOM = 12
CARD_GAP_X = 10
CARD_GAP_Y = 8
CAPTION_GAP = 1
HEADER_FONT = "Helvetica-Bold"
BODY_FONT = "Helvetica"
HEADER_SIZE = 13
BODY_SIZE = 7
DISCLAIMER_SIZE = 6

DISCLAIMER = (
    "These are imperfect scans for collection cataloging purposes and not intended to represent "
    "the actual quality of the card itself. Photographs can be provided upon request or as part "
    "of the trading process."
)


def _safe_text(value):
    return (value or "").strip()


def _build_caption(card):
    sub = _safe_text(card.get("sub_category"))
    version = _safe_text(card.get("source"))

    if sub and version:
        return f"{sub} | {version}"
    if sub:
        return sub
    if version:
        return version
    return ""


def _wrap_text(text, max_width, font_name, font_size, canv):
    if not text:
        return []

    words = text.split()
    lines = []
    current = ""

    for word in words:
        candidate = word if not current else f"{current} {word}"
        if canv.stringWidth(candidate, font_name, font_size) <= max_width:
            current = candidate
        else:
            if current:
                lines.append(current)
            current = word

    if current:
        lines.append(current)

    return lines


def _draw_image(canv, image_path, x, y_bottom, width, height):
    try:
        img = ImageReader(str(image_path))
        canv.drawImage(
            img,
            x,
            y_bottom,
            width=width,
            height=height,
            preserveAspectRatio=True,
            anchor="sw",
            mask="auto",
        )
    except Exception:
        canv.setStrokeColorRGB(0.7, 0.7, 0.7)
        canv.rect(x, y_bottom, width, height)
        canv.setFont(BODY_FONT, BODY_SIZE)
        canv.drawCentredString(x + width / 2, y_bottom + height / 2, "Image unavailable")


def _draw_card_block(
    canv,
    card,
    x,
    y_top,
    block_width,
    image_width,
    image_height,
    include_captions,
    include_backs,
):
    front_path = APP_ROOT / card["front_image_path"]
    _draw_image(
        canv,
        front_path,
        x,
        y_top - image_height,
        image_width,
        image_height,
    )

    if include_backs and card.get("back_image_path"):
        back_path = APP_ROOT / card["back_image_path"]
        back_x = x + image_width + 4
        _draw_image(
            canv,
            back_path,
            back_x,
            y_top - image_height,
            image_width,
            image_height,
        )

    if include_captions:
        caption = _build_caption(card)
        if caption:
            lines = _wrap_text(caption, block_width, BODY_FONT, BODY_SIZE, canv)
            canv.setFont(BODY_FONT, BODY_SIZE)
            text_y = y_top - image_height - CAPTION_GAP - BODY_SIZE
            for line in lines[:2]:
                canv.drawString(x, text_y, line)
                text_y -= BODY_SIZE + 1


def _draw_section_header(canv, status, y_top):
    y = y_top

    canv.setFont(HEADER_FONT, HEADER_SIZE)
    canv.drawString(MARGIN_X, y, status)
    y -= HEADER_SIZE + 3

    if status == "For Trade":
        disclaimer_lines = _wrap_text(
            DISCLAIMER,
            PAGE_WIDTH - (MARGIN_X * 2),
            BODY_FONT,
            DISCLAIMER_SIZE,
            canv,
        )
        canv.setFont(BODY_FONT, DISCLAIMER_SIZE)
        for line in disclaimer_lines:
            canv.drawString(MARGIN_X, y, line)
            y -= DISCLAIMER_SIZE + 1

    return y - 4


def build_pdf(cards_by_status, include_captions, include_backs, output_path):
    canv = canvas.Canvas(str(output_path), pagesize=letter)

    ordered_statuses = [status for status in ["Owned", "Want", "For Trade"] if status in cards_by_status]

    for status in ordered_statuses:
        cards = cards_by_status.get(status, [])
        if not cards:
            continue

        y_top = PAGE_HEIGHT - MARGIN_TOP
        y_top = _draw_section_header(canv, status, y_top)

        usable_width = PAGE_WIDTH - (MARGIN_X * 2)

        if include_backs:
            columns = 2
            image_width = 108
            image_height = 151
            block_width = (image_width * 2) + 4
            row_height = image_height + (16 if include_captions else 0)
        else:
            columns = 4
            rows = 4
            block_width = (usable_width - (CARD_GAP_X * (columns - 1))) / columns
            image_width = block_width
            image_height = block_width * (85 / 55)
            # tighten to fit 4 rows with captions
            available_height = y_top - MARGIN_BOTTOM
            row_height = available_height / rows - CARD_GAP_Y
            max_image_height = row_height - (14 if include_captions else 0)
            if image_height > max_image_height:
                scale = max_image_height / image_height
                image_width *= scale
                image_height *= scale
                block_width = image_width

            row_height = image_height + (14 if include_captions else 0)

        total_blocks_width = columns * block_width + (columns - 1) * CARD_GAP_X
        start_x = (PAGE_WIDTH - total_blocks_width) / 2
        x_positions = [start_x + i * (block_width + CARD_GAP_X) for i in range(columns)]

        current_row_top = y_top
        col_index = 0

        for card in cards:
            if current_row_top - row_height < MARGIN_BOTTOM:
                canv.showPage()
                y_top = PAGE_HEIGHT - MARGIN_TOP
                y_top = _draw_section_header(canv, status, y_top)
                current_row_top = y_top
                col_index = 0

            x = x_positions[col_index]

            _draw_card_block(
                canv,
                card,
                x=x,
                y_top=current_row_top,
                block_width=block_width,
                image_width=image_width,
                image_height=image_height,
                include_captions=include_captions,
                include_backs=include_backs,
            )

            col_index += 1
            if col_index >= columns:
                col_index = 0
                current_row_top -= row_height + CARD_GAP_Y

        canv.showPage()

    canv.save()