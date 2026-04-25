import shutil
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from pydantic import BaseModel
from sqlalchemy import text

from dependencies import get_db
from file_helpers import DATA_ROOT, IMAGES_DIR, INBOX_DIR, LIBRARY_DIR, COVER_DIRS

_ALLOWED_IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp", ".gif"}

_VALID_COVER_MODULES = set(COVER_DIRS.keys()) - {"gn"}  # GN already handled; include all others
_VALID_COVER_MODULES.add("gn")  # actually include GN too for consistency

router = APIRouter(tags=["ingest"])


# ---------- Cover image upload (all modules except photocards) ----------


@router.post("/upload-cover")
async def upload_cover(
    file: UploadFile = File(...),
    module: str = Query(..., description="Module code: books, gn, videogames, music, video, boardgames, ttrpg"),
    item_id: Optional[int] = Query(None, description="Item ID (omit for staging during new-item creation)"),
):
    """Upload a cover image file for any module.

    If item_id is provided, saves directly as the final filename.
    If item_id is omitted, saves as a staging file and returns the path
    (the create endpoint will rename it to the final name).
    """
    if module not in COVER_DIRS:
        raise HTTPException(status_code=400, detail=f"Unknown module: {module}")
    ext = Path(file.filename).suffix.lower() if file.filename else ""
    if ext not in _ALLOWED_IMAGE_SUFFIXES:
        raise HTTPException(status_code=400, detail=f"Unsupported file type: {ext}")

    data = await file.read()
    cover_dir = COVER_DIRS[module]
    ext_clean = ext.lstrip(".")

    if item_id is not None:
        filename = f"{module}_{item_id:06d}.{ext_clean}"
    else:
        import uuid
        filename = f"staging_{uuid.uuid4().hex[:12]}.{ext_clean}"

    dest = cover_dir / filename
    dest.write_bytes(data)
    url_path = f"/images/library/{module}/{filename}"

    # If item_id was provided, update the cover in the DB too
    if item_id is not None:
        _update_cover_in_db(module, item_id, url_path)

    return {"url": url_path, "filename": filename}


def _update_cover_in_db(module: str, item_id: int, url_path: str):
    """Update cover_image_url in the appropriate detail table for the given module."""
    table_map = {
        "books": "tbl_book_copies",
        "gn": "tbl_graphicnovel_details",
        "videogames": "tbl_game_details",
        "music": "tbl_music_release_details",
        "video": "tbl_video_details",
        "boardgames": "tbl_boardgame_details",
        "ttrpg": "tbl_ttrpg_details",
    }
    table = table_map.get(module)
    if not table:
        return
    from db import SessionLocal
    db = SessionLocal()
    try:
        db.execute(
            text(f"UPDATE {table} SET cover_image_url = :url WHERE item_id = :id"),
            {"url": url_path, "id": item_id},
        )
        db.commit()
    finally:
        db.close()


# ---------- Ingest endpoints ----------


@router.get("/ingest/inbox")
def list_inbox():
    files = []
    for f in INBOX_DIR.iterdir():
        if f.is_file() and f.suffix.lower() in _ALLOWED_IMAGE_SUFFIXES:
            stat = f.stat()
            files.append({
                "filename": f.name,
                "size": stat.st_size,
                "mtime": stat.st_mtime,
            })
    return sorted(files, key=lambda x: x["mtime"])


@router.delete("/ingest/inbox/{filename}")
def delete_inbox_file(filename: str):
    safe_name = Path(filename).name
    file_path = INBOX_DIR / safe_name
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found in inbox")
    file_path.unlink()
    return {"deleted": safe_name}


@router.post("/ingest/upload")
async def upload_to_inbox(file: UploadFile = File(...)):
    if Path(file.filename).suffix.lower() not in _ALLOWED_IMAGE_SUFFIXES:
        raise HTTPException(status_code=400, detail="Unsupported file type.")

    safe_name = Path(file.filename).name
    dest = INBOX_DIR / safe_name
    with open(dest, "wb") as out:
        shutil.copyfileobj(file.file, out)

    stat = dest.stat()
    return {"filename": safe_name, "size": stat.st_size, "mtime": stat.st_mtime, "status": "uploaded"}


class IngestFrontPayload(BaseModel):
    inbox_filename: str
    collection_type_id: int
    top_level_category_id: int
    ownership_status_id: int
    notes: Optional[str] = None
    group_id: int
    source_origin_id: Optional[int] = None
    version: Optional[str] = None
    member_ids: List[int]
    is_special: bool = False


@router.post("/ingest/front")
def ingest_front(payload: IngestFrontPayload, db=Depends(get_db)):
    inbox_path = INBOX_DIR / payload.inbox_filename
    if not inbox_path.exists():
        raise HTTPException(status_code=404, detail=f"File not found in inbox: {payload.inbox_filename}")

    group_row = db.execute(
        text("SELECT group_code FROM lkup_photocard_groups WHERE group_id = :gid"),
        {"gid": payload.group_id},
    ).fetchone()
    if not group_row:
        raise HTTPException(status_code=404, detail="Group not found.")
    group_code = group_row[0]

    item_result = db.execute(
        text("""
            INSERT INTO tbl_items (collection_type_id, top_level_category_id, ownership_status_id, notes)
            VALUES (:collection_type_id, :top_level_category_id, NULL, NULL)
            RETURNING item_id
        """),
        {
            "collection_type_id": payload.collection_type_id,
            "top_level_category_id": payload.top_level_category_id,
        },
    ).fetchone()
    item_id = item_result[0]

    db.execute(
        text("""
            INSERT INTO tbl_photocard_details (item_id, group_id, source_origin_id, version, is_special)
            VALUES (:item_id, :group_id, :source_origin_id, :version, :is_special)
        """),
        {
            "item_id": item_id,
            "group_id": payload.group_id,
            "source_origin_id": payload.source_origin_id,
            "version": payload.version,
            "is_special": 1 if payload.is_special else 0,
        },
    )

    # Create the first copy row
    db.execute(
        text("""
            INSERT INTO tbl_photocard_copies (item_id, ownership_status_id, notes)
            VALUES (:item_id, :ownership_status_id, :notes)
        """),
        {
            "item_id": item_id,
            "ownership_status_id": payload.ownership_status_id,
            "notes": payload.notes,
        },
    )

    for member_id in payload.member_ids:
        db.execute(
            text("INSERT INTO xref_photocard_members (item_id, member_id) VALUES (:item_id, :member_id)"),
            {"item_id": item_id, "member_id": member_id},
        )

    ext = inbox_path.suffix.lower()
    library_filename = f"{group_code}_{item_id:06d}_f{ext}"
    library_path = LIBRARY_DIR / library_filename

    shutil.move(str(inbox_path), str(library_path))

    db.execute(
        text("""
            INSERT INTO tbl_attachments (item_id, attachment_type, file_path)
            VALUES (:item_id, 'front', :file_path)
        """),
        {"item_id": item_id, "file_path": f"images/library/{library_filename}"},
    )

    db.commit()

    return {"item_id": item_id, "filename": library_filename, "status": "ingested"}


@router.get("/ingest/candidates")
def get_ingest_candidates(
    group_id: int,
    category_id: int,
    missing_back_only: bool = True,
    member_ids: Optional[List[int]] = Query(default=None),
    db=Depends(get_db),
):
    from routers.photocards import _PHOTOCARD_SELECT, _PHOTOCARD_GROUP_BY, _photocard_row_to_dict, _attach_copies

    having_clause = ""
    if missing_back_only:
        having_clause = " HAVING MAX(CASE WHEN a.attachment_type = 'back' THEN 1 ELSE 0 END) = 0"

    member_filter = ""
    params: dict = {"group_id": group_id, "category_id": category_id}

    if member_ids:
        placeholders = ",".join(str(m) for m in member_ids)
        member_filter = f"""
            AND i.item_id IN (
                SELECT item_id FROM xref_photocard_members
                WHERE member_id IN ({placeholders})
            )
        """

    result = db.execute(
        text(
            _PHOTOCARD_SELECT
            + " AND p.group_id = :group_id AND i.top_level_category_id = :category_id"
            + member_filter
            + _PHOTOCARD_GROUP_BY
            + having_clause
            + " ORDER BY i.item_id DESC"
        ),
        params,
    ).fetchall()

    cards = [_photocard_row_to_dict(row) for row in result]
    _attach_copies(db, cards)
    return cards


class IngestPairPayload(BaseModel):
    front_filename: str
    back_filename: str
    collection_type_id: int
    top_level_category_id: int
    ownership_status_id: int
    notes: Optional[str] = None
    group_id: int
    source_origin_id: Optional[int] = None
    version: Optional[str] = None
    member_ids: List[int]
    is_special: bool = False


class AttachBackPayload(BaseModel):
    inbox_filename: str
    item_id: int


@router.post("/ingest/pair")
def ingest_pair(payload: IngestPairPayload, db=Depends(get_db)):
    front_path = INBOX_DIR / payload.front_filename
    back_path = INBOX_DIR / payload.back_filename

    if not front_path.exists():
        raise HTTPException(status_code=404, detail=f"Front file not found in inbox: {payload.front_filename}")
    if not back_path.exists():
        raise HTTPException(status_code=404, detail=f"Back file not found in inbox: {payload.back_filename}")

    group_row = db.execute(
        text("SELECT group_code FROM lkup_photocard_groups WHERE group_id = :gid"),
        {"gid": payload.group_id},
    ).fetchone()
    if not group_row:
        raise HTTPException(status_code=404, detail="Group not found.")
    group_code = group_row[0]

    item_result = db.execute(
        text("""
            INSERT INTO tbl_items (collection_type_id, top_level_category_id, ownership_status_id, notes)
            VALUES (:collection_type_id, :top_level_category_id, NULL, NULL)
            RETURNING item_id
        """),
        {
            "collection_type_id": payload.collection_type_id,
            "top_level_category_id": payload.top_level_category_id,
        },
    ).fetchone()
    item_id = item_result[0]

    db.execute(
        text("""
            INSERT INTO tbl_photocard_details (item_id, group_id, source_origin_id, version, is_special)
            VALUES (:item_id, :group_id, :source_origin_id, :version, :is_special)
        """),
        {
            "item_id": item_id,
            "group_id": payload.group_id,
            "source_origin_id": payload.source_origin_id,
            "version": payload.version,
            "is_special": 1 if payload.is_special else 0,
        },
    )

    # Create the first copy row
    db.execute(
        text("""
            INSERT INTO tbl_photocard_copies (item_id, ownership_status_id, notes)
            VALUES (:item_id, :ownership_status_id, :notes)
        """),
        {
            "item_id": item_id,
            "ownership_status_id": payload.ownership_status_id,
            "notes": payload.notes,
        },
    )

    for member_id in payload.member_ids:
        db.execute(
            text("INSERT INTO xref_photocard_members (item_id, member_id) VALUES (:item_id, :member_id)"),
            {"item_id": item_id, "member_id": member_id},
        )

    front_ext = front_path.suffix.lower()
    front_lib = f"{group_code}_{item_id:06d}_f{front_ext}"
    shutil.move(str(front_path), str(LIBRARY_DIR / front_lib))
    db.execute(
        text("INSERT INTO tbl_attachments (item_id, attachment_type, file_path) VALUES (:item_id, 'front', :fp)"),
        {"item_id": item_id, "fp": f"images/library/{front_lib}"},
    )

    back_ext = back_path.suffix.lower()
    back_lib = f"{group_code}_{item_id:06d}_b{back_ext}"
    shutil.move(str(back_path), str(LIBRARY_DIR / back_lib))
    db.execute(
        text("INSERT INTO tbl_attachments (item_id, attachment_type, file_path) VALUES (:item_id, 'back', :fp)"),
        {"item_id": item_id, "fp": f"images/library/{back_lib}"},
    )

    db.commit()

    return {
        "item_id": item_id,
        "front_filename": front_lib,
        "back_filename": back_lib,
        "status": "ingested",
    }


@router.post("/ingest/attach-back")
def attach_back(payload: AttachBackPayload, db=Depends(get_db)):
    inbox_path = INBOX_DIR / payload.inbox_filename
    if not inbox_path.exists():
        raise HTTPException(status_code=404, detail=f"File not found in inbox: {payload.inbox_filename}")

    row = db.execute(
        text("""
            SELECT g.group_code
            FROM tbl_items i
            JOIN tbl_photocard_details p ON i.item_id = p.item_id
            JOIN lkup_photocard_groups g ON p.group_id = g.group_id
            WHERE i.item_id = :item_id AND i.collection_type_id = 1
        """),
        {"item_id": payload.item_id},
    ).fetchone()

    if not row:
        raise HTTPException(status_code=404, detail="Photocard not found.")

    group_code = row[0]

    existing_back = db.execute(
        text("SELECT attachment_id, file_path FROM tbl_attachments WHERE item_id = :item_id AND attachment_type = 'back'"),
        {"item_id": payload.item_id},
    ).fetchone()

    ext = inbox_path.suffix.lower()
    library_filename = f"{group_code}_{payload.item_id:06d}_b{ext}"
    library_path = LIBRARY_DIR / library_filename

    shutil.move(str(inbox_path), str(library_path))

    if existing_back:
        old_path = DATA_ROOT / existing_back[1]
        if old_path.exists():
            old_path.unlink()
        db.execute(
            text("UPDATE tbl_attachments SET file_path = :file_path WHERE item_id = :item_id AND attachment_type = 'back'"),
            {"file_path": f"images/library/{library_filename}", "item_id": payload.item_id},
        )
    else:
        db.execute(
            text("INSERT INTO tbl_attachments (item_id, attachment_type, file_path) VALUES (:item_id, 'back', :file_path)"),
            {"item_id": payload.item_id, "file_path": f"images/library/{library_filename}"},
        )

    db.commit()

    return {"item_id": payload.item_id, "filename": library_filename, "status": "attached"}


def _replace_image(item_id: int, side: str, file: UploadFile, db):
    """Shared logic for replace-front and replace-back."""
    row = db.execute(
        text("""
            SELECT g.group_code
            FROM tbl_items i
            JOIN tbl_photocard_details p ON i.item_id = p.item_id
            JOIN lkup_photocard_groups g ON p.group_id = g.group_id
            WHERE i.item_id = :item_id AND i.collection_type_id = 1
        """),
        {"item_id": item_id},
    ).fetchone()

    if not row:
        raise HTTPException(status_code=404, detail="Photocard not found.")

    group_code = row[0]
    attachment_type = "front" if side == "f" else "back"

    existing = db.execute(
        text("SELECT file_path FROM tbl_attachments WHERE item_id = :item_id AND attachment_type = :atype"),
        {"item_id": item_id, "atype": attachment_type},
    ).fetchone()

    ext = Path(file.filename).suffix.lower()
    library_filename = f"{group_code}_{item_id:06d}_{side}{ext}"
    library_path = LIBRARY_DIR / library_filename

    with open(library_path, "wb") as out:
        shutil.copyfileobj(file.file, out)

    if existing:
        old_path = (DATA_ROOT / existing[0]).resolve()
        if old_path.is_relative_to(IMAGES_DIR.resolve()) and old_path.exists() and old_path != library_path:
            old_path.unlink()
        db.execute(
            text("UPDATE tbl_attachments SET file_path = :fp WHERE item_id = :item_id AND attachment_type = :atype"),
            {"fp": f"images/library/{library_filename}", "item_id": item_id, "atype": attachment_type},
        )
    else:
        db.execute(
            text("INSERT INTO tbl_attachments (item_id, attachment_type, file_path) VALUES (:item_id, :atype, :fp)"),
            {"item_id": item_id, "atype": attachment_type, "fp": f"images/library/{library_filename}"},
        )

    db.commit()

    return {"item_id": item_id, "filename": library_filename, "status": "replaced"}


@router.post("/photocards/{item_id}/replace-front")
async def replace_front(item_id: int, file: UploadFile = File(...), db=Depends(get_db)):
    if Path(file.filename).suffix.lower() not in _ALLOWED_IMAGE_SUFFIXES:
        raise HTTPException(status_code=400, detail="Unsupported file type.")
    return _replace_image(item_id, "f", file, db)


@router.post("/photocards/{item_id}/replace-back")
async def replace_back(item_id: int, file: UploadFile = File(...), db=Depends(get_db)):
    if Path(file.filename).suffix.lower() not in _ALLOWED_IMAGE_SUFFIXES:
        raise HTTPException(status_code=400, detail="Unsupported file type.")
    return _replace_image(item_id, "b", file, db)
