from pathlib import Path
import shutil
import subprocess
from tempfile import NamedTemporaryFile

print("LOADED BACKEND FILE:", __file__)

from pydantic import BaseModel
from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select
from sqlalchemy.orm import Session

from db import SessionLocal, engine, Base
from models import Card, SubcategoryOption, SourceOption
from export_pdf import build_pdf

# ---------- Paths ----------
APP_ROOT = Path(__file__).resolve().parents[1]
IMAGES_DIR = APP_ROOT / "images"
INBOX_DIR = IMAGES_DIR / "inbox"
LIBRARY_DIR = IMAGES_DIR / "library"

INBOX_DIR.mkdir(parents=True, exist_ok=True)
LIBRARY_DIR.mkdir(parents=True, exist_ok=True)

# ---------- App ----------
app = FastAPI(title="Photocard Tracker")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/images", StaticFiles(directory=str(IMAGES_DIR)), name="images")

# ---------- DB init ----------
Base.metadata.create_all(bind=engine)


def get_db() -> Session:
    return SessionLocal()


def get_image_version(rel_path: str | None):
    if not rel_path:
        return None

    file_path = APP_ROOT / rel_path
    if not file_path.exists() or not file_path.is_file():
        return None

    return int(file_path.stat().st_mtime_ns)


def delete_image_file(rel_path: str | None):
    if not rel_path:
        return

    file_path = APP_ROOT / rel_path
    if file_path.exists() and file_path.is_file():
        file_path.unlink()


def rebuild_option_tables(db: Session):
    db.query(SubcategoryOption).delete()
    db.query(SourceOption).delete()

    cards = db.query(Card).all()

    subcategory_keys = set()
    source_keys = set()

    for card in cards:
        if card.group_code and card.top_level_category and card.sub_category:
            subcategory_keys.add(
                (card.group_code, card.top_level_category, card.sub_category)
            )

        if card.group_code and card.top_level_category and card.sub_category and card.source:
            source_keys.add(
                (card.group_code, card.top_level_category, card.sub_category, card.source)
            )

    for group_code, top_level_category, sub_category in sorted(subcategory_keys):
        db.add(
            SubcategoryOption(
                group_code=group_code,
                top_level_category=top_level_category,
                value=sub_category,
            )
        )

    for group_code, top_level_category, sub_category, source_value in sorted(source_keys):
        db.add(
            SourceOption(
                group_code=group_code,
                top_level_category=top_level_category,
                sub_category=sub_category,
                value=source_value,
            )
        )

    db.flush()


# ---------- Request models ----------
class CardUpdateRequest(BaseModel):
    group_code: str | None = None
    member: str | None = None
    top_level_category: str | None = None
    sub_category: str | None = None
    source: str | None = None
    ownership_status: str | None = None
    price: int | None = None
    notes: str | None = None


class ExportPdfRequest(BaseModel):
    card_ids: list[int]
    include_captions: bool = True
    include_backs: bool = False


class BulkUpdateFieldAction(BaseModel):
    action: str
    value: str | None = None


class BulkUpdateRequest(BaseModel):
    card_ids: list[int]
    member: BulkUpdateFieldAction | None = None
    top_level_category: BulkUpdateFieldAction | None = None
    sub_category: BulkUpdateFieldAction | None = None
    source: BulkUpdateFieldAction | None = None
    ownership_status: BulkUpdateFieldAction | None = None
    price: BulkUpdateFieldAction | None = None
    notes: BulkUpdateFieldAction | None = None


# ---------- Basic routes ----------
@app.get("/health")
def health():
    return {"status": "ok", "marker": "EXPORT_ROUTE_PRESENT"}


@app.post("/shutdown")
def shutdown_app():
    shutdown_script = APP_ROOT / "Stop-CollectCore.bat"

    if not shutdown_script.exists():
        raise HTTPException(
            status_code=500,
            detail=f"Shutdown script not found: {shutdown_script}",
        )

    try:
        subprocess.Popen(
            ["cmd", "/c", str(shutdown_script)],
            creationflags=subprocess.CREATE_NO_WINDOW,
        )
        return {"ok": True, "message": "Shutdown started"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to start shutdown: {e}")


@app.get("/inbox")
def list_inbox():
    files = [p.name for p in INBOX_DIR.iterdir() if p.is_file()]
    files = sorted(files)

    return {
        "count": len(files),
        "files": [
            {
                "filename": name,
                "url": f"/images/inbox/{name}",
            }
            for name in files
        ],
    }


@app.post("/upload-to-inbox")
def upload_to_inbox(file: UploadFile = File(...)):
    original_name = file.filename or "upload.bin"
    safe_name = Path(original_name).name

    dest_path = INBOX_DIR / safe_name

    if dest_path.exists():
        raise HTTPException(
            status_code=409,
            detail=f"File already exists in inbox: {safe_name}",
        )

    try:
        with dest_path.open("wb") as buffer:
            shutil.copyfileobj(file.file, buffer)

        return {
            "ok": True,
            "filename": safe_name,
            "message": f"Uploaded {safe_name} to inbox",
        }
    finally:
        file.file.close()


@app.get("/cards")
def list_cards(limit: int | None = None):
    db = get_db()
    try:
        stmt = select(Card).order_by(Card.id.desc())

        if limit is not None:
            stmt = stmt.limit(limit)

        cards = db.execute(stmt).scalars().all()

        return [
            {
                "id": c.id,
                "group_code": c.group_code,
                "front_image_path": c.front_image_path,
                "back_image_path": c.back_image_path,
                "front_image_version": get_image_version(c.front_image_path),
                "back_image_version": get_image_version(c.back_image_path),
                "member": c.member,
                "top_level_category": c.top_level_category,
                "sub_category": c.sub_category,
                "source": c.source,
                "ownership_status": c.ownership_status,
                "price": c.price,
                "notes": c.notes,
                "created_at": str(c.created_at),
            }
            for c in cards
        ]
    finally:
        db.close()


def format_card_filename(group_code: str, card_id: int, side: str, original_ext: str) -> str:
    return f"{group_code}_{card_id:06d}_{side}{original_ext.lower()}"


# ---------- Ingest ----------
@app.post("/ingest/front")
def ingest_front(
    filename: str,
    group_code: str = "skz",
    member: str | None = None,
    top_level_category: str | None = None,
    sub_category: str | None = None,
    source: str | None = None,
    ownership_status: str | None = None,
    price: int | None = None,
):
    source_path = INBOX_DIR / filename
    if not source_path.exists() or not source_path.is_file():
        raise HTTPException(status_code=404, detail=f"File not found in inbox: {filename}")

    ext = source_path.suffix
    if ext == "":
        raise HTTPException(status_code=400, detail="File has no extension (.jpg/.png/etc).")

    db = get_db()
    try:
        card = Card(
            group_code=group_code,
            front_image_path="PENDING",
            member=member,
            top_level_category=top_level_category,
            sub_category=sub_category,
            source=source,
            ownership_status=ownership_status,
            price=price,
        )
        db.add(card)
        db.flush()

        new_name = format_card_filename(group_code, card.id, "f", ext)
        dest_path = LIBRARY_DIR / new_name

        if dest_path.exists():
            raise HTTPException(status_code=409, detail=f"Destination already exists: {dest_path.name}")

        shutil.move(str(source_path), str(dest_path))

        rel_path = str(dest_path.relative_to(APP_ROOT)).replace("\\", "/")
        card.front_image_path = rel_path

        rebuild_option_tables(db)

        db.commit()
        db.refresh(card)

        return {
            "id": card.id,
            "front_image_path": card.front_image_path,
            "member": card.member,
            "top_level_category": card.top_level_category,
            "sub_category": card.sub_category,
            "source": card.source,
            "ownership_status": card.ownership_status,
            "price": card.price,
            "message": f"Ingested {filename} -> {dest_path.name}",
        }
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        db.close()


@app.post("/ingest/back")
def ingest_back(card_id: int, filename: str):
    source_path = INBOX_DIR / filename
    if not source_path.exists() or not source_path.is_file():
        raise HTTPException(status_code=404, detail=f"File not found in inbox: {filename}")

    ext = source_path.suffix
    if ext == "":
        raise HTTPException(status_code=400, detail="File has no extension (.jpg/.png/etc).")

    db = get_db()
    try:
        card = db.get(Card, card_id)
        if card is None:
            raise HTTPException(status_code=404, detail=f"Card not found: id={card_id}")

        if card.back_image_path is not None:
            raise HTTPException(
                status_code=409,
                detail=f"Card id={card_id} already has a back image (refusing overwrite).",
            )

        group_code = card.group_code
        new_name = format_card_filename(group_code, card.id, "b", ext)
        dest_path = LIBRARY_DIR / new_name

        if dest_path.exists():
            raise HTTPException(status_code=409, detail=f"Destination already exists: {dest_path.name}")

        shutil.move(str(source_path), str(dest_path))

        rel_path = str(dest_path.relative_to(APP_ROOT)).replace("\\", "/")
        card.back_image_path = rel_path
        db.commit()

        return {
            "id": card.id,
            "back_image_path": card.back_image_path,
            "message": f"Attached back {filename} -> {dest_path.name}",
        }
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        db.close()


# ---------- Single card operations ----------
@app.get("/cards/{card_id}")
def get_card(card_id: int):
    db = get_db()
    try:
        card = db.get(Card, card_id)
        if card is None:
            raise HTTPException(status_code=404, detail="Card not found")
        return {
            "id": card.id,
            "group_code": card.group_code,
            "front_image_path": card.front_image_path,
            "back_image_path": card.back_image_path,
            "front_image_version": get_image_version(card.front_image_path),
            "back_image_version": get_image_version(card.back_image_path),
            "member": card.member,
            "top_level_category": card.top_level_category,
            "sub_category": card.sub_category,
            "source": card.source,
            "ownership_status": card.ownership_status,
            "price": card.price,
            "notes": card.notes,
            "created_at": str(card.created_at),
        }
    finally:
        db.close()


@app.put("/cards/{card_id}")
def update_card(card_id: int, payload: CardUpdateRequest):
    db = get_db()
    try:
        card = db.get(Card, card_id)
        if card is None:
            raise HTTPException(status_code=404, detail="Card not found")

        updates = payload.model_dump(exclude_unset=True)

        allowed_fields = {
            "group_code",
            "member",
            "top_level_category",
            "sub_category",
            "source",
            "ownership_status",
            "price",
            "notes",
        }

        for key, value in updates.items():
            if key in allowed_fields:
                setattr(card, key, value)

        db.flush()
        rebuild_option_tables(db)
        db.commit()
        db.refresh(card)

        return {
            "id": card.id,
            "group_code": card.group_code,
            "front_image_path": card.front_image_path,
            "back_image_path": card.back_image_path,
            "front_image_version": get_image_version(card.front_image_path),
            "back_image_version": get_image_version(card.back_image_path),
            "member": card.member,
            "top_level_category": card.top_level_category,
            "sub_category": card.sub_category,
            "source": card.source,
            "ownership_status": card.ownership_status,
            "price": card.price,
            "notes": card.notes,
            "created_at": str(card.created_at),
        }
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        db.close()


@app.delete("/cards/{card_id}")
def delete_card(card_id: int):
    db = get_db()
    try:
        card = db.get(Card, card_id)
        if card is None:
            raise HTTPException(status_code=404, detail="Card not found")

        front_image_path = card.front_image_path
        back_image_path = card.back_image_path

        db.delete(card)
        db.flush()
        rebuild_option_tables(db)
        db.commit()

        delete_image_file(front_image_path)
        delete_image_file(back_image_path)

        return {
            "ok": True,
            "deleted_id": card_id,
            "deleted_front_image": bool(front_image_path),
            "deleted_back_image": bool(back_image_path),
        }
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        db.close()


# ---------- Replace images ----------
@app.post("/cards/{card_id}/replace-front")
def replace_front_image(card_id: int, filename: str):
    source_path = INBOX_DIR / filename
    if not source_path.exists() or not source_path.is_file():
        raise HTTPException(status_code=404, detail=f"File not found in inbox: {filename}")

    ext = source_path.suffix
    if ext == "":
        raise HTTPException(status_code=400, detail="File has no extension (.jpg/.png/etc).")

    db = get_db()
    try:
        card = db.get(Card, card_id)
        if card is None:
            raise HTTPException(status_code=404, detail="Card not found")

        new_name = format_card_filename(card.group_code, card.id, "f", ext)
        dest_path = LIBRARY_DIR / new_name

        if card.front_image_path:
            old_path = APP_ROOT / card.front_image_path
            if old_path.exists() and old_path.is_file():
                old_path.unlink()

        if dest_path.exists():
            dest_path.unlink()

        shutil.move(str(source_path), str(dest_path))

        rel_path = str(dest_path.relative_to(APP_ROOT)).replace("\\", "/")
        card.front_image_path = rel_path
        db.commit()
        db.refresh(card)

        return {
            "id": card.id,
            "group_code": card.group_code,
            "front_image_path": card.front_image_path,
            "back_image_path": card.back_image_path,
            "front_image_version": get_image_version(card.front_image_path),
            "back_image_version": get_image_version(card.back_image_path),
            "member": card.member,
            "top_level_category": card.top_level_category,
            "sub_category": card.sub_category,
            "source": card.source,
            "ownership_status": card.ownership_status,
            "price": card.price,
            "notes": card.notes,
            "created_at": str(card.created_at),
            "message": f"Replaced front image with {dest_path.name}",
        }
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        db.close()


@app.post("/cards/{card_id}/replace-back")
def replace_back_image(card_id: int, filename: str):
    source_path = INBOX_DIR / filename
    if not source_path.exists() or not source_path.is_file():
        raise HTTPException(status_code=404, detail=f"File not found in inbox: {filename}")

    ext = source_path.suffix
    if ext == "":
        raise HTTPException(status_code=400, detail="File has no extension (.jpg/.png/etc).")

    db = get_db()
    try:
        card = db.get(Card, card_id)
        if card is None:
            raise HTTPException(status_code=404, detail="Card not found")

        new_name = format_card_filename(card.group_code, card.id, "b", ext)
        dest_path = LIBRARY_DIR / new_name

        if card.back_image_path:
            old_path = APP_ROOT / card.back_image_path
            if old_path.exists() and old_path.is_file():
                old_path.unlink()

        if dest_path.exists():
            dest_path.unlink()

        shutil.move(str(source_path), str(dest_path))

        rel_path = str(dest_path.relative_to(APP_ROOT)).replace("\\", "/")
        card.back_image_path = rel_path
        db.commit()
        db.refresh(card)

        return {
            "id": card.id,
            "group_code": card.group_code,
            "front_image_path": card.front_image_path,
            "back_image_path": card.back_image_path,
            "front_image_version": get_image_version(card.front_image_path),
            "back_image_version": get_image_version(card.back_image_path),
            "member": card.member,
            "top_level_category": card.top_level_category,
            "sub_category": card.sub_category,
            "source": card.source,
            "ownership_status": card.ownership_status,
            "price": card.price,
            "notes": card.notes,
            "created_at": str(card.created_at),
            "message": f"Replaced back image with {dest_path.name}",
        }
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        db.close()


@app.get("/cards/{card_id}/image_urls")
def get_card_image_urls(card_id: int):
    db = get_db()
    try:
        card = db.get(Card, card_id)
        if card is None:
            raise HTTPException(status_code=404, detail="Card not found")

        def to_url(rel_path):
            if not rel_path:
                return None
            rp = str(rel_path).replace("\\", "/")
            if rp.startswith("images/"):
                rp = rp[len("images/"):]
            return f"/images/{rp}"

        return {
            "id": card.id,
            "front_url": to_url(card.front_image_path),
            "back_url": to_url(card.back_image_path),
        }
    finally:
        db.close()


# ---------- Option routes ----------
@app.get("/subcategory-options")
def get_subcategory_options(group_code: str, top_level_category: str):
    db = get_db()
    try:
        options = (
            db.query(SubcategoryOption)
            .filter(
                SubcategoryOption.group_code == group_code,
                SubcategoryOption.top_level_category == top_level_category,
            )
            .order_by(SubcategoryOption.value.asc())
            .all()
        )

        return [option.value for option in options]
    finally:
        db.close()


@app.get("/source-options")
def get_source_options(group_code: str, top_level_category: str, sub_category: str):
    db = get_db()
    try:
        options = (
            db.query(SourceOption)
            .filter(
                SourceOption.group_code == group_code,
                SourceOption.top_level_category == top_level_category,
                SourceOption.sub_category == sub_category,
            )
            .order_by(SourceOption.value.asc())
            .all()
        )

        return [option.value for option in options]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        db.close()


# ---------- Candidate matching ----------
@app.get("/card-candidates")
def get_card_candidates(
    group_code: str | None = None,
    member: str | None = None,
    top_level_category: str | None = None,
    sub_category: str | None = None,
    include_cards_with_back: bool = False,
):
    db = get_db()
    try:
        query = db.query(Card)

        if group_code:
            query = query.filter(Card.group_code == group_code)

        if member:
            query = query.filter(Card.member == member)

        if top_level_category:
            query = query.filter(Card.top_level_category == top_level_category)

        if sub_category:
            query = query.filter(Card.sub_category == sub_category)

        if not include_cards_with_back:
            query = query.filter(Card.back_image_path.is_(None))

        cards = query.order_by(Card.id.desc()).all()

        return [
            {
                "id": card.id,
                "member": card.member,
                "top_level_category": card.top_level_category,
                "sub_category": card.sub_category,
                "front_image_path": card.front_image_path,
                "back_image_path": card.back_image_path,
                "front_url": f"/{card.front_image_path.replace('\\', '/')}" if card.front_image_path else None,
                "has_back": card.back_image_path is not None,
            }
            for card in cards
        ]
    finally:
        db.close()


@app.post("/attach-back")
def attach_back(
    card_id: int,
    filename: str,
    force_replace: bool = False,
):
    source_path = INBOX_DIR / filename
    if not source_path.exists() or not source_path.is_file():
        raise HTTPException(status_code=404, detail=f"File not found in inbox: {filename}")

    ext = source_path.suffix
    if ext == "":
        raise HTTPException(status_code=400, detail="File has no extension (.jpg/.png/etc).")

    db = get_db()
    try:
        card = db.get(Card, card_id)
        if card is None:
            raise HTTPException(status_code=404, detail=f"Card not found: id={card_id}")

        if card.back_image_path is not None and not force_replace:
            return {
                "ok": False,
                "needs_confirmation": True,
                "message": f"Card id={card_id} already has a back image.",
                "existing_back_image_path": card.back_image_path,
            }

        new_name = format_card_filename(card.group_code, card.id, "b", ext)
        dest_path = LIBRARY_DIR / new_name

        if dest_path.exists() and not force_replace:
            raise HTTPException(status_code=409, detail=f"Destination already exists: {dest_path.name}")

        if dest_path.exists() and force_replace:
            dest_path.unlink()

        shutil.move(str(source_path), str(dest_path))

        rel_path = str(dest_path.relative_to(APP_ROOT)).replace("\\", "/")
        card.back_image_path = rel_path
        db.commit()

        return {
            "ok": True,
            "needs_confirmation": False,
            "id": card.id,
            "back_image_path": card.back_image_path,
            "message": f"Attached back {filename} -> {dest_path.name}",
            "replaced_existing": force_replace,
        }
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        db.close()


# ---------- Export ----------
@app.post("/export/pdf")
def export_pdf_endpoint(payload: ExportPdfRequest):
    db = get_db()
    try:
        if not payload.card_ids:
            raise HTTPException(status_code=400, detail="No cards provided.")

        cards = (
            db.query(Card)
            .filter(Card.id.in_(payload.card_ids))
            .all()
        )

        card_map = {card.id: card for card in cards}
        ordered_cards = [card_map[card_id] for card_id in payload.card_ids if card_id in card_map]

        grouped = {}
        for card in ordered_cards:
            grouped.setdefault(card.ownership_status, []).append(
                {
                    "front_image_path": card.front_image_path,
                    "back_image_path": card.back_image_path,
                    "sub_category": card.sub_category,
                    "source": card.source,
                }
            )

        temp_file = NamedTemporaryFile(delete=False, suffix=".pdf")
        output_path = Path(temp_file.name)
        temp_file.close()

        build_pdf(
            grouped,
            payload.include_captions,
            payload.include_backs,
            output_path,
        )

        return FileResponse(
            path=output_path,
            filename="photocard_export.pdf",
            media_type="application/pdf",
        )
    finally:
        db.close()


# ---------- Bulk update ----------
@app.post("/cards/bulk-update")
def bulk_update_cards(payload: BulkUpdateRequest):
    db = get_db()
    try:
        if not payload.card_ids:
            raise HTTPException(status_code=400, detail="No card IDs provided.")

        cards = (
            db.query(Card)
            .filter(Card.id.in_(payload.card_ids))
            .all()
        )

        if not cards:
            raise HTTPException(status_code=404, detail="No matching cards found.")

        def apply_action(card, field_name: str, action_obj: BulkUpdateFieldAction | None):
            if action_obj is None or action_obj.action == "leave":
                return

            if field_name in {"member", "top_level_category", "ownership_status"}:
                if action_obj.action == "set":
                    setattr(card, field_name, action_obj.value or None)
                return

            if field_name in {"sub_category", "source"}:
                if action_obj.action == "set":
                    setattr(card, field_name, action_obj.value or None)
                elif action_obj.action == "clear":
                    setattr(card, field_name, None)
                return

            if field_name == "price":
                if action_obj.action == "set":
                    if action_obj.value in (None, ""):
                        setattr(card, field_name, None)
                    else:
                        setattr(card, field_name, int(action_obj.value))
                elif action_obj.action == "clear":
                    setattr(card, field_name, None)
                return

            if field_name == "notes":
                if action_obj.action == "set":
                    setattr(card, field_name, action_obj.value or None)
                elif action_obj.action == "append":
                    existing = card.notes or ""
                    addition = action_obj.value or ""
                    if existing and addition:
                        card.notes = f"{existing}\n{addition}"
                    elif addition:
                        card.notes = addition
                elif action_obj.action == "clear":
                    setattr(card, field_name, None)
                return

        for card in cards:
            apply_action(card, "member", payload.member)
            apply_action(card, "top_level_category", payload.top_level_category)
            apply_action(card, "sub_category", payload.sub_category)
            apply_action(card, "source", payload.source)
            apply_action(card, "ownership_status", payload.ownership_status)
            apply_action(card, "price", payload.price)
            apply_action(card, "notes", payload.notes)

        db.flush()
        rebuild_option_tables(db)
        db.commit()

        refreshed_cards = (
            db.query(Card)
            .filter(Card.id.in_(payload.card_ids))
            .all()
        )

        return {
            "updated_ids": [card.id for card in refreshed_cards],
            "cards": [
                {
                    "id": c.id,
                    "group_code": c.group_code,
                    "front_image_path": c.front_image_path,
                    "back_image_path": c.back_image_path,
                    "front_image_version": get_image_version(c.front_image_path),
                    "back_image_version": get_image_version(c.back_image_path),
                    "member": c.member,
                    "top_level_category": c.top_level_category,
                    "sub_category": c.sub_category,
                    "source": c.source,
                    "ownership_status": c.ownership_status,
                    "price": c.price,
                    "notes": c.notes,
                    "created_at": str(c.created_at),
                }
                for c in refreshed_cards
            ],
        }
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        db.close()