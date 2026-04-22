import io
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import text

from dependencies import get_db
from file_helpers import APP_ROOT

router = APIRouter(tags=["export"])


# ---------- Settings endpoints ----------


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


# ---------- Export endpoints ----------

class ExportPayload(BaseModel):
    item_ids: List[int]
    include_captions: bool = True
    include_backs: bool = False


def _build_caption(card: dict) -> list:
    """Return up to 3 caption lines: [members, source_origin, version]."""
    lines = []
    member_str = ", ".join(card["members"]) if card.get("members") else None
    lines.append(member_str or "\u2014")
    lines.append(card.get("source_origin") or "")
    lines.append(card.get("version") or "")
    # Strip trailing empty lines
    while lines and not lines[-1]:
        lines.pop()
    return lines


def _generate_pdf(entries: list, include_captions: bool) -> bytes:
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.utils import ImageReader
    from reportlab.pdfgen import canvas as rl_canvas

    page_w, page_h = A4  # 595.28 x 841.89 pts
    margin = 20.0
    cols = 4
    gap = 6.0
    line_h = 8.5  # pts per caption line
    max_caption_lines = 3
    caption_h = (line_h * max_caption_lines + 3.0) if include_captions else 0.0

    content_w = page_w - 2 * margin
    cell_w = (content_w - gap * (cols - 1)) / cols
    img_h = cell_w * 1.54  # standard photocard portrait ratio
    cell_h = img_h + caption_h + gap

    rows_per_page = max(1, int((page_h - 2 * margin + gap) / (cell_h + gap)))
    per_page = cols * rows_per_page

    buf = io.BytesIO()
    c = rl_canvas.Canvas(buf, pagesize=A4)
    c.setFont("Helvetica", 7)

    for idx, entry in enumerate(entries):
        within_page = idx % per_page
        row = within_page // cols
        col = within_page % cols

        if within_page == 0 and idx > 0:
            c.showPage()
            c.setFont("Helvetica", 7)

        x = margin + col * (cell_w + gap)
        y = page_h - margin - (row + 1) * (cell_h + gap) + gap

        img_y = y + caption_h

        if entry["exists"]:
            try:
                ir = ImageReader(str(entry["path"]))
                iw, ih = ir.getSize()
                scale = min(cell_w / iw, img_h / ih)
                draw_w = iw * scale
                draw_h = ih * scale
                offset_x = (cell_w - draw_w) / 2
                offset_y = (img_h - draw_h) / 2
                c.drawImage(ir, x + offset_x, img_y + offset_y, draw_w, draw_h)
            except Exception:
                c.setFillColorRGB(0.85, 0.85, 0.85)
                c.rect(x, img_y, cell_w, img_h, fill=1, stroke=0)
                c.setFillColorRGB(0, 0, 0)
        else:
            c.setFillColorRGB(0.85, 0.85, 0.85)
            c.rect(x, img_y, cell_w, img_h, fill=1, stroke=0)
            c.setFillColorRGB(0, 0, 0)

        if include_captions and entry["caption"]:
            c.setFillColorRGB(0, 0, 0)
            max_chars = max(20, int(cell_w / 5.5))
            for i, line in enumerate(entry["caption"]):
                if not line:
                    continue
                text_str = line if len(line) <= max_chars else line[:max_chars - 1] + "\u2026"
                line_y = y + 3 + (len(entry["caption"]) - 1 - i) * line_h
                c.drawString(x, line_y, text_str)

    c.save()
    return buf.getvalue()


@router.post("/export/photocards")
def export_photocards(payload: ExportPayload, db=Depends(get_db)):
    from main import _PHOTOCARD_SELECT, _PHOTOCARD_GROUP_BY, _photocard_row_to_dict, _attach_copies

    if not payload.item_ids:
        raise HTTPException(status_code=400, detail="item_ids cannot be empty.")

    placeholders = ",".join(str(i) for i in payload.item_ids)
    rows = db.execute(
        text(
            _PHOTOCARD_SELECT
            + f" AND i.item_id IN ({placeholders})"
            + _PHOTOCARD_GROUP_BY
        )
    ).fetchall()
    cards = [_photocard_row_to_dict(r) for r in rows]
    _attach_copies(db, cards)

    order_map = {iid: idx for idx, iid in enumerate(payload.item_ids)}
    cards = sorted(
        cards,
        key=lambda c: order_map.get(c["item_id"], 0),
    )

    entries = []
    for card in cards:
        caption = _build_caption(card) if payload.include_captions else []
        # Always include a front entry — use placeholder if no image so the card is never silently dropped
        if card["front_image_path"]:
            front_path = APP_ROOT / card["front_image_path"]
            entries.append({"path": front_path, "caption": caption, "exists": front_path.exists()})
        else:
            entries.append({"path": None, "caption": caption, "exists": False})
        if payload.include_backs:
            back_caption = (caption[:-1] + [caption[-1] + " [back]"]) if (payload.include_captions and caption) else []
            if card["back_image_path"]:
                back_path = APP_ROOT / card["back_image_path"]
                entries.append({"path": back_path, "caption": back_caption, "exists": back_path.exists()})
            else:
                # Placeholder keeps grid alignment when a card has no back image
                entries.append({"path": None, "caption": back_caption, "exists": False})

    pdf_bytes = _generate_pdf(entries, payload.include_captions)

    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": "attachment; filename=photocard_export.pdf"},
    )
