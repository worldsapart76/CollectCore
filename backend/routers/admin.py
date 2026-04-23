import io
import shutil
import sqlite3
import tempfile
import zipfile
from datetime import datetime
from pathlib import Path
from typing import List

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse as _FileResponse
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from sqlalchemy import text

from db import DB_PATH
from dependencies import get_db
from file_helpers import APP_ROOT, DATA_ROOT, IMAGES_DIR, LIBRARY_DIR

FRONTEND_DIST = APP_ROOT / "frontend" / "dist"

router = APIRouter(tags=["admin"])


# ---------- Admin: Backup & Restore ----------


_backup_tokens: dict[str, dict] = {}  # token -> {path, filename, created}


@router.post("/admin/backup/prepare")
def prepare_backup():
    """Build the backup ZIP to a temp file and return metadata.

    The frontend calls this first to get progress info, then downloads
    via GET /admin/backup/download/{token}.
    """
    if not DB_PATH.exists():
        raise HTTPException(status_code=404, detail="Database file not found.")

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    zip_filename = f"collectcore_backup_{timestamp}.zip"

    # Count image files first (for progress reporting)
    image_files = []
    if LIBRARY_DIR.exists():
        image_files = [p for p in LIBRARY_DIR.rglob("*") if p.is_file()]

    tmp_zip = tempfile.NamedTemporaryFile(suffix=".zip", delete=False)
    tmp_zip_path = Path(tmp_zip.name)
    tmp_zip.close()

    try:
        with zipfile.ZipFile(str(tmp_zip_path), "w", compression=zipfile.ZIP_DEFLATED) as zf:
            # --- Database ---
            src_conn = sqlite3.connect(str(DB_PATH))
            dst_conn = sqlite3.connect(":memory:")
            src_conn.backup(dst_conn)
            src_conn.close()
            tmp_db = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
            tmp_db_path = Path(tmp_db.name)
            tmp_db.close()
            try:
                disk_conn = sqlite3.connect(str(tmp_db_path))
                dst_conn.backup(disk_conn)
                disk_conn.close()
                dst_conn.close()
                zf.write(tmp_db_path, "collectcore.db")
            finally:
                tmp_db_path.unlink(missing_ok=True)

            # --- Images ---
            for img_path in image_files:
                arcname = "images/library/" + img_path.relative_to(LIBRARY_DIR).as_posix()
                zf.write(img_path, arcname)

        size_bytes = tmp_zip_path.stat().st_size

        import uuid as _uuid
        token = _uuid.uuid4().hex[:16]
        _backup_tokens[token] = {
            "path": tmp_zip_path,
            "filename": zip_filename,
            "created": datetime.now(),
        }

        # Clean up old tokens (>30 min)
        cutoff = datetime.now()
        for k in list(_backup_tokens):
            info = _backup_tokens[k]
            if (cutoff - info["created"]).total_seconds() > 1800:
                try:
                    info["path"].unlink(missing_ok=True)
                except Exception:
                    pass
                del _backup_tokens[k]

        return {
            "token": token,
            "filename": zip_filename,
            "size_bytes": size_bytes,
            "image_count": len(image_files),
        }

    except Exception:
        tmp_zip_path.unlink(missing_ok=True)
        raise


@router.get("/admin/backup/download/{token}")
def download_backup_by_token(token: str):
    """Stream a previously prepared backup ZIP with Content-Length for progress tracking."""
    info = _backup_tokens.pop(token, None)
    if not info or not info["path"].exists():
        raise HTTPException(status_code=404, detail="Backup not found or expired. Please prepare a new backup.")

    zip_path: Path = info["path"]
    size = zip_path.stat().st_size

    def iterfile():
        with open(zip_path, "rb") as f:
            while chunk := f.read(1024 * 256):
                yield chunk
        zip_path.unlink(missing_ok=True)

    return StreamingResponse(
        iterfile(),
        media_type="application/zip",
        headers={
            "Content-Disposition": f"attachment; filename={info['filename']}",
            "Content-Length": str(size),
        },
    )


@router.get("/admin/backup")
def download_backup():
    """Legacy single-step backup — kept for backwards compatibility."""
    if not DB_PATH.exists():
        raise HTTPException(status_code=404, detail="Database file not found.")

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    zip_filename = f"collectcore_backup_{timestamp}.zip"

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        src_conn = sqlite3.connect(str(DB_PATH))
        dst_conn = sqlite3.connect(":memory:")
        src_conn.backup(dst_conn)
        src_conn.close()
        tmp_db = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        tmp_db_path = Path(tmp_db.name)
        tmp_db.close()
        try:
            disk_conn = sqlite3.connect(str(tmp_db_path))
            dst_conn.backup(disk_conn)
            disk_conn.close()
            dst_conn.close()
            zf.write(tmp_db_path, "collectcore.db")
        finally:
            tmp_db_path.unlink(missing_ok=True)

        if LIBRARY_DIR.exists():
            for img_path in LIBRARY_DIR.rglob("*"):
                if img_path.is_file():
                    arcname = "images/library/" + img_path.relative_to(LIBRARY_DIR).as_posix()
                    zf.write(img_path, arcname)

    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": f"attachment; filename={zip_filename}"},
    )


@router.post("/admin/restore")
async def upload_restore(file: UploadFile = File(...)):
    """
    Restore from a backup ZIP. Replaces the current database and library images.
    The ZIP must contain 'collectcore.db' at the root. The 'images/library/'
    folder inside the ZIP is optional — if present it replaces the current library.

    WARNING: This is destructive. The caller (UI) is responsible for confirming
    with the user before calling this endpoint.
    """
    if not file.filename.endswith(".zip"):
        raise HTTPException(status_code=400, detail="Uploaded file must be a .zip archive.")

    content = await file.read()

    try:
        with zipfile.ZipFile(io.BytesIO(content)) as zf:
            names = zf.namelist()

            if "collectcore.db" not in names:
                raise HTTPException(
                    status_code=400,
                    detail="Invalid backup: 'collectcore.db' not found in ZIP.",
                )

            # Write DB to a temp file first (outside the replace) so we can
            # dispose the engine before touching the live DB file.
            # On Windows, Path.replace() fails with PermissionError if the
            # destination file is held open by SQLAlchemy's connection pool.
            db_data = zf.read("collectcore.db")
            tmp_db = tempfile.NamedTemporaryFile(
                suffix=".db", dir=DB_PATH.parent, delete=False
            )
            tmp_db_path = Path(tmp_db.name)
            try:
                tmp_db.write(db_data)
                tmp_db.close()

                # Release all pooled connections before replacing the file
                from db import engine
                engine.dispose()

                tmp_db_path.replace(DB_PATH)
            except Exception:
                tmp_db_path.unlink(missing_ok=True)
                raise

            # Restore library images if present
            image_entries = [n for n in names if n.startswith("images/library/") and not n.endswith("/")]
            if image_entries:
                # Clear existing library images first
                if LIBRARY_DIR.exists():
                    shutil.rmtree(LIBRARY_DIR)
                LIBRARY_DIR.mkdir(parents=True, exist_ok=True)

                for entry in image_entries:
                    relative = entry[len("images/library/"):]
                    dest = LIBRARY_DIR / relative
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    dest.write_bytes(zf.read(entry))

    except zipfile.BadZipFile:
        raise HTTPException(status_code=400, detail="Uploaded file is not a valid ZIP archive.")

    return {
        "status": "restored",
        "db_restored": True,
        "images_restored": bool(image_entries) if "image_entries" in dir() else False,
    }


# ---------- Admin: Unused Lookup Cleanup ----------
# The cleanable set is derived from the shared lookup registry in
# routers/admin_lookups.py — see cleanable_lookups_for_scan() there.

from routers.admin_lookups import cleanable_lookups_for_scan


@router.get("/admin/unused-lookups")
def scan_unused_lookups(db=Depends(get_db)):
    """Scan all cleanable lookup tables and return values that are not
    referenced by any records (and are still active)."""
    results = []
    for label, lkup_table, pk_col, name_col, refs in cleanable_lookups_for_scan():
        # Build a WHERE clause: no references in any ref table
        not_exists_clauses = " AND ".join(
            f"NOT EXISTS (SELECT 1 FROM {ref_table} WHERE {ref_fk} = l.{pk_col})"
            for ref_table, ref_fk in refs
        )
        sql = (
            f"SELECT l.{pk_col}, l.{name_col} FROM {lkup_table} l "
            f"WHERE l.is_active = 1 AND {not_exists_clauses} "
            f"ORDER BY l.{name_col}"
        )
        rows = db.execute(text(sql)).fetchall()
        if rows:
            results.append({
                "label": label,
                "table": lkup_table,
                "values": [{"id": r[0], "name": r[1]} for r in rows],
            })
    return results


class DeactivateLookupRequest(BaseModel):
    table: str
    ids: List[int]


@router.post("/admin/deactivate-lookups")
def deactivate_unused_lookups(req: DeactivateLookupRequest, db=Depends(get_db)):
    """Soft-delete lookup values by setting is_active = 0.
    Only allows tables that are in the cleanable list."""
    # Validate table name against whitelist
    cleanables = cleanable_lookups_for_scan()
    valid = {entry[1]: entry for entry in cleanables}
    if req.table not in valid:
        raise HTTPException(status_code=400, detail=f"Table '{req.table}' is not a cleanable lookup table.")

    _, lkup_table, pk_col, name_col, refs = valid[req.table]

    if not req.ids:
        return {"deactivated": 0}

    # Verify all requested IDs are actually unreferenced before deactivating
    placeholders = ", ".join(str(int(i)) for i in req.ids)  # int() for safety
    not_exists_clauses = " AND ".join(
        f"NOT EXISTS (SELECT 1 FROM {ref_table} WHERE {ref_fk} = l.{pk_col})"
        for ref_table, ref_fk in refs
    )
    # SQLite doesn't support UPDATE with table alias — use subquery instead
    safe_ids_sql = (
        f"SELECT {pk_col} FROM {lkup_table} l "
        f"WHERE l.{pk_col} IN ({placeholders}) AND l.is_active = 1 "
        f"AND {not_exists_clauses}"
    )
    safe_rows = db.execute(text(safe_ids_sql)).fetchall()
    safe_ids = [r[0] for r in safe_rows]

    if not safe_ids:
        db.commit()
        return {"deactivated": 0}

    safe_placeholders = ", ".join(str(i) for i in safe_ids)
    update_sql = f"UPDATE {lkup_table} SET is_active = 0 WHERE {pk_col} IN ({safe_placeholders})"
    db.execute(text(update_sql))
    db.commit()
    return {"deactivated": len(safe_ids)}


# ---------- Admin: Status Visibility ----------


@router.get("/admin/status-visibility")
def get_status_visibility(db=Depends(get_db)):
    modules = db.execute(text("""
        SELECT collection_type_id, collection_type_code, collection_type_name
        FROM lkup_collection_types
        WHERE is_active = 1
        ORDER BY sort_order
    """)).fetchall()

    ownership = db.execute(text("""
        SELECT s.ownership_status_id, s.status_name, s.sort_order,
               GROUP_CONCAT(x.collection_type_id) AS module_ids
        FROM lkup_ownership_statuses s
        LEFT JOIN xref_ownership_status_modules x ON s.ownership_status_id = x.ownership_status_id
        WHERE s.is_active = 1
        GROUP BY s.ownership_status_id
        ORDER BY s.sort_order
    """)).fetchall()

    consumption = db.execute(text("""
        SELECT cs.read_status_id, cs.status_name, cs.sort_order,
               GROUP_CONCAT(x.collection_type_id) AS module_ids
        FROM lkup_consumption_statuses cs
        LEFT JOIN xref_consumption_status_modules x ON cs.read_status_id = x.read_status_id
        WHERE cs.is_active = 1
        GROUP BY cs.read_status_id
        ORDER BY cs.sort_order
    """)).fetchall()

    def parse_ids(raw):
        if not raw:
            return []
        return [int(i) for i in raw.split(",")]

    return {
        "modules": [
            {"collection_type_id": r[0], "code": r[1], "name": r[2]}
            for r in modules
        ],
        "ownership": [
            {
                "ownership_status_id": r[0],
                "status_name": r[1],
                "sort_order": r[2],
                "module_ids": parse_ids(r[3]),
            }
            for r in ownership
        ],
        "consumption": [
            {
                "read_status_id": r[0],
                "status_name": r[1],
                "sort_order": r[2],
                "module_ids": parse_ids(r[3]),
            }
            for r in consumption
        ],
    }


class StatusVisibilityToggle(BaseModel):
    status_type: str   # "ownership" | "consumption"
    status_id: int
    collection_type_id: int
    visible: bool


@router.put("/admin/status-visibility")
def toggle_status_visibility(payload: StatusVisibilityToggle, db=Depends(get_db)):
    if payload.status_type == "ownership":
        if payload.visible:
            db.execute(text("""
                INSERT OR IGNORE INTO xref_ownership_status_modules (ownership_status_id, collection_type_id)
                VALUES (:sid, :ctid)
            """), {"sid": payload.status_id, "ctid": payload.collection_type_id})
        else:
            db.execute(text("""
                DELETE FROM xref_ownership_status_modules
                WHERE ownership_status_id = :sid AND collection_type_id = :ctid
            """), {"sid": payload.status_id, "ctid": payload.collection_type_id})
    elif payload.status_type == "consumption":
        if payload.visible:
            db.execute(text("""
                INSERT OR IGNORE INTO xref_consumption_status_modules (read_status_id, collection_type_id)
                VALUES (:sid, :ctid)
            """), {"sid": payload.status_id, "ctid": payload.collection_type_id})
        else:
            db.execute(text("""
                DELETE FROM xref_consumption_status_modules
                WHERE read_status_id = :sid AND collection_type_id = :ctid
            """), {"sid": payload.status_id, "ctid": payload.collection_type_id})
    else:
        raise HTTPException(status_code=400, detail="status_type must be 'ownership' or 'consumption'")
    db.commit()
    return {"ok": True}


# ---------- Frontend static files (production) ----------
# Serve the pre-built React app so the frontend dev server is not needed.
# The /assets mount and /vite.svg route must be registered before the catch-all
# SPA route, and all API routes above must be registered first so they take priority.
#
# NOTE: The static file mount and catch-all route cannot be registered via a router
# because app.mount() requires the FastAPI app instance directly. Instead, we provide
# a helper function that main.py calls after including all routers.


def register_frontend_static(app):
    """Register frontend static file serving on the FastAPI app instance.

    Must be called AFTER all API routers are included, so the catch-all
    SPA route doesn't shadow API endpoints.
    """
    if not FRONTEND_DIST.exists():
        return

    app.mount("/assets", StaticFiles(directory=str(FRONTEND_DIST / "assets")), name="assets")

    @app.get("/vite.svg", include_in_schema=False)
    async def _serve_favicon():
        return _FileResponse(str(FRONTEND_DIST / "vite.svg"))

    @app.get("/{full_path:path}", include_in_schema=False)
    async def _serve_spa(full_path: str):
        return _FileResponse(str(FRONTEND_DIST / "index.html"))
