from typing import Optional

from fastapi import APIRouter, Depends
from sqlalchemy import text

from dependencies import get_db

router = APIRouter(tags=["shared"])


@router.get("/health")
def health():
    return {"status": "ok", "app": "CollectCore API"}


# --- Lookup endpoints ---

@router.get("/ownership-statuses")
def get_ownership_statuses(collection_type_id: Optional[int] = None, db=Depends(get_db)):
    if collection_type_id is not None:
        result = db.execute(text("""
            SELECT s.ownership_status_id, s.status_code, s.status_name, s.sort_order
            FROM lkup_ownership_statuses s
            JOIN xref_ownership_status_modules x ON s.ownership_status_id = x.ownership_status_id
            WHERE s.is_active = 1 AND x.collection_type_id = :ctid
            ORDER BY s.sort_order
        """), {"ctid": collection_type_id}).fetchall()
    else:
        result = db.execute(text("""
            SELECT ownership_status_id, status_code, status_name, sort_order
            FROM lkup_ownership_statuses
            WHERE is_active = 1
            ORDER BY sort_order
        """)).fetchall()
    return [
        {
            "ownership_status_id": row[0],
            "status_code": row[1],
            "status_name": row[2],
            "sort_order": row[3],
        }
        for row in result
    ]


@router.get("/consumption-statuses")
def get_consumption_statuses(collection_type_id: int, db=Depends(get_db)):
    result = db.execute(text("""
        SELECT cs.read_status_id, cs.status_name
        FROM lkup_consumption_statuses cs
        JOIN xref_consumption_status_modules x ON cs.read_status_id = x.read_status_id
        WHERE cs.is_active = 1 AND x.collection_type_id = :ctid
        ORDER BY cs.sort_order
    """), {"ctid": collection_type_id}).fetchall()
    return [{"read_status_id": row[0], "status_name": row[1]} for row in result]


@router.get("/categories")
def get_top_level_categories(collection_type_id: Optional[int] = None, collection_type_code: Optional[str] = None, db=Depends(get_db)):
    if collection_type_code:
        result = db.execute(
            text("""
                SELECT ltc.top_level_category_id, ltc.category_name
                FROM lkup_top_level_categories ltc
                JOIN lkup_collection_types ct ON ltc.collection_type_id = ct.collection_type_id
                WHERE ct.collection_type_code = :code
                ORDER BY ltc.sort_order
            """),
            {"code": collection_type_code},
        ).fetchall()
    else:
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


@router.get("/photocards/groups")
def get_photocard_groups(db=Depends(get_db)):
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


@router.get("/photocards/groups/{group_id}/members")
def get_photocard_members(group_id: int, db=Depends(get_db)):
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


@router.get("/photocards/source-origins")
def get_source_origins(group_id: int, category_id: int, db=Depends(get_db)):
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
