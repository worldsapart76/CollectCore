from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import text

from dependencies import get_db

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


# Photocard PDF export (POST /export/photocards) was retired 2026-05-09 in
# favor of the trade-page architecture (see plans/photocard-trading-v2.md).
# The /settings endpoints above are kept here because this router was their
# closest existing home; they can move once another module owns app settings.
