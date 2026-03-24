from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import List

from db import init_db

print("LOADED BACKEND FILE:", __file__)

# ---------- Paths ----------
APP_ROOT = Path(__file__).resolve().parents[1]
IMAGES_DIR = APP_ROOT / "images"

# ---------- App ----------
app = FastAPI(title="CollectCore API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------- DB init ----------
init_db()

# ---------- Static files ----------
if IMAGES_DIR.exists():
    app.mount("/images", StaticFiles(directory=str(IMAGES_DIR)), name="images")


# ---------- Routes ----------
@app.get("/health")
def health():
    return {"status": "ok", "app": "CollectCore API"}

from db import SessionLocal
from sqlalchemy import text


@app.get("/photocards/groups")
def get_photocard_groups():
    db = SessionLocal()
    try:
        result = db.execute(text("""
            SELECT group_id, group_code, group_name
            FROM lkup_photocard_groups
            ORDER BY sort_order
        """)).fetchall()

        return [
            {
                "group_id": row[0],
                "group_code": row[1],
                "group_name": row[2],
            }
            for row in result
        ]
    finally:
        db.close()


@app.get("/photocards/groups/{group_id}/members")
def get_photocard_members(group_id: int):
    db = SessionLocal()
    try:
        result = db.execute(
            text("""
                SELECT member_id, member_code, member_name
                FROM lkup_photocard_members
                WHERE group_id = :group_id
                ORDER BY sort_order
            """),
            {"group_id": group_id},
        ).fetchall()

        return [
            {
                "member_id": row[0],
                "member_code": row[1],
                "member_name": row[2],
            }
            for row in result
        ]
    finally:
        db.close()


class PhotocardCreate(BaseModel):
    collection_type_id: int
    top_level_category_id: int
    ownership_status_id: int
    notes: str | None = None
    group_id: int
    source_origin_id: int | None = None
    version: str | None = None
    member_ids: List[int]


class SourceOriginCreate(BaseModel):
    group_id: int
    top_level_category_id: int
    source_origin_name: str


@app.post("/photocards")
def create_photocard(payload: PhotocardCreate):
    db = SessionLocal()
    try:
        item_result = db.execute(
            text("""
                INSERT INTO tbl_items (
                    collection_type_id,
                    top_level_category_id,
                    ownership_status_id,
                    notes
                )
                VALUES (
                    :collection_type_id,
                    :top_level_category_id,
                    :ownership_status_id,
                    :notes
                )
                RETURNING item_id
            """),
            {
                "collection_type_id": payload.collection_type_id,
                "top_level_category_id": payload.top_level_category_id,
                "ownership_status_id": payload.ownership_status_id,
                "notes": payload.notes,
            },
        ).fetchone()

        item_id = item_result[0]

        db.execute(
            text("""
                INSERT INTO tbl_photocard_details (
                    item_id,
                    group_id,
                    source_origin_id,
                    version
                )
                VALUES (
                    :item_id,
                    :group_id,
                    :source_origin_id,
                    :version
                )
            """),
            {
                "item_id": item_id,
                "group_id": payload.group_id,
                "source_origin_id": payload.source_origin_id,
                "version": payload.version,
            },
        )

        for member_id in payload.member_ids:
            db.execute(
                text("""
                    INSERT INTO xref_photocard_members (
                        item_id,
                        member_id
                    )
                    VALUES (
                        :item_id,
                        :member_id
                    )
                """),
                {
                    "item_id": item_id,
                    "member_id": member_id,
                },
            )

        db.commit()

        return {
            "item_id": item_id,
            "status": "created",
        }
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


@app.get("/photocards/source-origins")
def get_source_origins(group_id: int, category_id: int):
    db = SessionLocal()
    try:
        result = db.execute(
            text("""
                SELECT source_origin_id, source_origin_name
                FROM lkup_photocard_source_origins
                WHERE group_id = :group_id
                  AND top_level_category_id = :category_id
                ORDER BY sort_order, source_origin_name
            """),
            {
                "group_id": group_id,
                "category_id": category_id,
            },
        ).fetchall()

        return [
            {
                "source_origin_id": row[0],
                "source_origin_name": row[1],
            }
            for row in result
        ]
    finally:
        db.close()


@app.post("/photocards/source-origins")
def create_source_origin(payload: SourceOriginCreate):
    db = SessionLocal()
    try:
        clean_name = payload.source_origin_name.strip()

        if not clean_name:
            raise HTTPException(
                status_code=400,
                detail="Source origin name cannot be blank.",
            )

        existing = db.execute(
            text("""
                SELECT source_origin_id
                FROM lkup_photocard_source_origins
                WHERE group_id = :group_id
                  AND top_level_category_id = :top_level_category_id
                  AND LOWER(TRIM(source_origin_name)) = LOWER(TRIM(:source_origin_name))
            """),
            {
                "group_id": payload.group_id,
                "top_level_category_id": payload.top_level_category_id,
                "source_origin_name": clean_name,
            },
        ).fetchone()

        if existing:
            raise HTTPException(
                status_code=409,
                detail="That source origin already exists for this group and category.",
            )

        result = db.execute(
            text("""
                INSERT INTO lkup_photocard_source_origins (
                    group_id,
                    top_level_category_id,
                    source_origin_name
                )
                VALUES (
                    :group_id,
                    :top_level_category_id,
                    :source_origin_name
                )
                RETURNING source_origin_id
            """),
            {
                "group_id": payload.group_id,
                "top_level_category_id": payload.top_level_category_id,
                "source_origin_name": clean_name,
            },
        ).fetchone()

        source_origin_id = result[0]

        db.commit()

        return {
            "source_origin_id": source_origin_id,
            "group_id": payload.group_id,
            "top_level_category_id": payload.top_level_category_id,
            "source_origin_name": clean_name,
            "status": "created",
        }
    except HTTPException:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


@app.get("/photocards")
def list_photocards():
    db = SessionLocal()
    try:
        result = db.execute(
            text("""
                SELECT
                    i.item_id,
                    c.category_name,
                    os.status_name,
                    i.notes,
                    g.group_name,
                    so.source_origin_name,
                    p.version,
                    COALESCE(
                        GROUP_CONCAT(m.member_name, ', '),
                        ''
                    ) AS members
                FROM tbl_items i
                JOIN tbl_photocard_details p
                    ON i.item_id = p.item_id
                JOIN lkup_top_level_categories c
                    ON i.top_level_category_id = c.top_level_category_id
                JOIN lkup_ownership_statuses os
                    ON i.ownership_status_id = os.ownership_status_id
                JOIN lkup_photocard_groups g
                    ON p.group_id = g.group_id
                LEFT JOIN lkup_photocard_source_origins so
                    ON p.source_origin_id = so.source_origin_id
                LEFT JOIN xref_photocard_members xpm
                    ON i.item_id = xpm.item_id
                LEFT JOIN lkup_photocard_members m
                    ON xpm.member_id = m.member_id
                WHERE i.collection_type_id = 1
                GROUP BY
                    i.item_id,
                    c.category_name,
                    os.status_name,
                    i.notes,
                    g.group_name,
                    so.source_origin_name,
                    p.version
                ORDER BY i.item_id
            """)
        ).fetchall()

        return [
            {
                "item_id": row[0],
                "category": row[1],
                "ownership_status": row[2],
                "notes": row[3],
                "group": row[4],
                "source_origin": row[5],
                "version": row[6],
                "members": row[7].split(", ") if row[7] else [],
            }
            for row in result
        ]
    finally:
        db.close()


@app.get("/categories")
def get_top_level_categories(collection_type_id: int):
    db = SessionLocal()
    try:
        result = db.execute(
            text("""
                SELECT top_level_category_id, category_name
                FROM lkup_top_level_categories
                WHERE collection_type_id = :collection_type_id
                ORDER BY sort_order
            """),
            {"collection_type_id": collection_type_id},
        ).fetchall()

        return [
            {
                "top_level_category_id": row[0],
                "category_name": row[1],
            }
            for row in result
        ]
    finally:
        db.close()