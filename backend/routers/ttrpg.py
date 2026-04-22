from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text

from constants import TTRPG_COLLECTION_TYPE_ID
from dependencies import get_db
from file_helpers import delete_attachment_files, collect_cover_file, remove_files, resolve_cover_url
from helpers import generic_upsert, generic_scoped_upsert, make_title_sort
from schemas.ttrpg import (
    TTRPGBulkUpdatePayload,
    TTRPGCreate,
    TTRPGUpdate,
)
from schemas.photocards import BulkDeletePayload

router = APIRouter(prefix="/ttrpg", tags=["ttrpg"])


# ---------- TTRPG helpers ----------

def _insert_ttrpg_authors(db, item_id: int, author_names) -> None:
    if not author_names:
        return
    for order, name in enumerate(author_names):
        if name.strip():
            author_id = generic_upsert(db, "ttrpg_author", name)
            db.execute(
                text("INSERT OR IGNORE INTO xref_ttrpg_book_authors (item_id, author_id, author_order) VALUES (:item_id, :aid, :ord)"),
                {"item_id": item_id, "aid": author_id, "ord": order},
            )


def _insert_ttrpg_copies(db, item_id: int, copies) -> None:
    if not copies:
        return
    for copy in copies:
        db.execute(
            text("""
                INSERT INTO tbl_ttrpg_copies (item_id, format_type_id, isbn_13, isbn_10, ownership_status_id, notes)
                VALUES (:item_id, :fmt, :isbn13, :isbn10, :own, :notes)
            """),
            {
                "item_id": item_id,
                "fmt": copy.format_type_id,
                "isbn13": copy.isbn_13,
                "isbn10": copy.isbn_10,
                "own": copy.ownership_status_id,
                "notes": copy.notes,
            },
        )


def _get_ttrpg_detail(db, item_id: int):
    row = db.execute(
        text("""
            SELECT
                i.item_id,
                i.top_level_category_id,
                ltc.category_name,
                i.ownership_status_id,
                os.status_name,
                i.notes,
                i.created_at,
                i.updated_at,
                td.title,
                td.title_sort,
                td.description,
                td.system_edition_id,
                se.edition_name,
                td.line_id,
                ln.line_name,
                td.book_type_id,
                bt.book_type_name,
                td.publisher_id,
                pub.publisher_name,
                td.release_date,
                td.cover_image_url,
                td.api_source,
                td.external_work_id
            FROM tbl_items i
            JOIN tbl_ttrpg_details td ON i.item_id = td.item_id
            JOIN lkup_ownership_statuses os ON i.ownership_status_id = os.ownership_status_id
            JOIN lkup_top_level_categories ltc ON i.top_level_category_id = ltc.top_level_category_id
            LEFT JOIN lkup_ttrpg_system_editions se ON td.system_edition_id = se.edition_id
            LEFT JOIN lkup_ttrpg_lines ln ON td.line_id = ln.line_id
            LEFT JOIN lkup_ttrpg_book_types bt ON td.book_type_id = bt.book_type_id
            LEFT JOIN lkup_ttrpg_publishers pub ON td.publisher_id = pub.publisher_id
            WHERE i.item_id = :item_id AND i.collection_type_id = :ct
        """),
        {"item_id": item_id, "ct": TTRPG_COLLECTION_TYPE_ID},
    ).fetchone()

    if not row:
        return None

    authors = db.execute(
        text("""
            SELECT a.author_id, a.author_name, x.author_order
            FROM xref_ttrpg_book_authors x
            JOIN lkup_ttrpg_authors a ON x.author_id = a.author_id
            WHERE x.item_id = :item_id
            ORDER BY x.author_order
        """),
        {"item_id": item_id},
    ).fetchall()

    copies = db.execute(
        text("""
            SELECT c.copy_id, c.format_type_id, ft.format_name, c.isbn_13, c.isbn_10,
                   c.ownership_status_id, os.status_name, c.notes
            FROM tbl_ttrpg_copies c
            LEFT JOIN lkup_ttrpg_format_types ft ON c.format_type_id = ft.format_type_id
            LEFT JOIN lkup_ownership_statuses os ON c.ownership_status_id = os.ownership_status_id
            WHERE c.item_id = :item_id
            ORDER BY c.copy_id
        """),
        {"item_id": item_id},
    ).fetchall()

    return {
        "item_id": row[0],
        "top_level_category_id": row[1],
        "category_name": row[2],
        "ownership_status_id": row[3],
        "ownership_status": row[4],
        "notes": row[5],
        "created_at": row[6],
        "updated_at": row[7],
        "title": row[8],
        "title_sort": row[9],
        "description": row[10],
        "system_edition_id": row[11],
        "system_edition_name": row[12],
        "line_id": row[13],
        "line_name": row[14],
        "book_type_id": row[15],
        "book_type_name": row[16],
        "publisher_id": row[17],
        "publisher_name": row[18],
        "release_date": row[19],
        "cover_image_url": row[20],
        "api_source": row[21],
        "external_work_id": row[22],
        "authors": [{"author_id": a[0], "author_name": a[1]} for a in authors],
        "author_names": [a[1] for a in authors],
        "copies": [
            {
                "copy_id": c[0],
                "format_type_id": c[1],
                "format_name": c[2],
                "isbn_13": c[3],
                "isbn_10": c[4],
                "ownership_status_id": c[5],
                "ownership_status": c[6],
                "notes": c[7],
            }
            for c in copies
        ],
    }


# --- TTRPG lookup endpoints ---
# NOTE: specific paths must appear before /{item_id}

@router.get("/systems")
def get_ttrpg_systems(db=Depends(get_db)):
    rows = db.execute(text("""
        SELECT ltc.top_level_category_id, ltc.category_name FROM lkup_top_level_categories ltc
        JOIN lkup_collection_types lct ON ltc.collection_type_id = lct.collection_type_id
        WHERE lct.collection_type_code = 'ttrpg' AND ltc.is_active = 1
        ORDER BY ltc.sort_order
    """)).fetchall()
    return [{"top_level_category_id": r[0], "category_name": r[1]} for r in rows]


@router.get("/system-editions")
def get_ttrpg_system_editions(system_id: Optional[int] = None, db=Depends(get_db)):
    if system_id:
        rows = db.execute(
            text("SELECT edition_id, edition_name FROM lkup_ttrpg_system_editions WHERE system_category_id = :sys AND is_active = 1 ORDER BY sort_order, edition_name"),
            {"sys": system_id},
        ).fetchall()
    else:
        rows = db.execute(
            text("SELECT edition_id, edition_name FROM lkup_ttrpg_system_editions WHERE is_active = 1 ORDER BY edition_name"),
        ).fetchall()
    return [{"edition_id": r[0], "edition_name": r[1]} for r in rows]


@router.get("/lines")
def get_ttrpg_lines(system_id: Optional[int] = None, db=Depends(get_db)):
    if system_id:
        rows = db.execute(
            text("SELECT line_id, line_name FROM lkup_ttrpg_lines WHERE system_category_id = :sys AND is_active = 1 ORDER BY sort_order, line_name"),
            {"sys": system_id},
        ).fetchall()
    else:
        rows = db.execute(
            text("SELECT line_id, line_name FROM lkup_ttrpg_lines WHERE is_active = 1 ORDER BY line_name"),
        ).fetchall()
    return [{"line_id": r[0], "line_name": r[1]} for r in rows]


@router.get("/book-types")
def get_ttrpg_book_types(db=Depends(get_db)):
    rows = db.execute(text("SELECT book_type_id, book_type_name FROM lkup_ttrpg_book_types WHERE is_active = 1 ORDER BY sort_order")).fetchall()
    return [{"book_type_id": r[0], "book_type_name": r[1]} for r in rows]


@router.get("/format-types")
def get_ttrpg_format_types(db=Depends(get_db)):
    rows = db.execute(text("SELECT format_type_id, format_name FROM lkup_ttrpg_format_types WHERE is_active = 1 ORDER BY sort_order")).fetchall()
    return [{"format_type_id": r[0], "format_name": r[1]} for r in rows]


@router.get("/publishers")
def get_ttrpg_publishers(q: Optional[str] = None, db=Depends(get_db)):
    if q:
        rows = db.execute(
            text("SELECT publisher_id, publisher_name FROM lkup_ttrpg_publishers WHERE is_active = 1 AND LOWER(publisher_name) LIKE LOWER(:q) ORDER BY publisher_name LIMIT 20"),
            {"q": f"%{q}%"},
        ).fetchall()
    else:
        rows = db.execute(text("SELECT publisher_id, publisher_name FROM lkup_ttrpg_publishers WHERE is_active = 1 ORDER BY publisher_name")).fetchall()
    return [{"publisher_id": r[0], "publisher_name": r[1]} for r in rows]


@router.get("/authors")
def get_ttrpg_authors(q: Optional[str] = None, db=Depends(get_db)):
    if q:
        rows = db.execute(
            text("SELECT author_id, author_name FROM lkup_ttrpg_authors WHERE is_active = 1 AND LOWER(author_name) LIKE LOWER(:q) ORDER BY author_name LIMIT 20"),
            {"q": f"%{q}%"},
        ).fetchall()
    else:
        rows = db.execute(text("SELECT author_id, author_name FROM lkup_ttrpg_authors WHERE is_active = 1 ORDER BY author_name")).fetchall()
    return [{"author_id": r[0], "author_name": r[1]} for r in rows]


@router.get("")
def list_ttrpg(db=Depends(get_db)):
    rows = db.execute(
        text("""
            SELECT
                i.item_id,
                i.top_level_category_id,
                ltc.category_name,
                i.ownership_status_id,
                os.status_name,
                i.notes,
                td.title,
                td.title_sort,
                td.release_date,
                td.cover_image_url,
                td.system_edition_id,
                td.line_id,
                td.book_type_id,
                td.publisher_id,
                (SELECT bt.book_type_name FROM lkup_ttrpg_book_types bt WHERE bt.book_type_id = td.book_type_id) AS book_type_name,
                (SELECT se.edition_name FROM lkup_ttrpg_system_editions se WHERE se.edition_id = td.system_edition_id) AS system_edition_name,
                (SELECT ln.line_name FROM lkup_ttrpg_lines ln WHERE ln.line_id = td.line_id) AS line_name,
                (SELECT pub.publisher_name FROM lkup_ttrpg_publishers pub WHERE pub.publisher_id = td.publisher_id) AS publisher_name,
                (SELECT GROUP_CONCAT(a.author_name, ', ')
                 FROM xref_ttrpg_book_authors x
                 JOIN lkup_ttrpg_authors a ON x.author_id = a.author_id
                 WHERE x.item_id = i.item_id
                 ORDER BY x.author_order) AS authors_str,
                (SELECT GROUP_CONCAT(
                     COALESCE(ft.format_name, 'Unknown') || CASE WHEN own2.status_name IS NOT NULL THEN ' (' || own2.status_name || ')' ELSE '' END,
                     ', ')
                 FROM tbl_ttrpg_copies c
                 LEFT JOIN lkup_ttrpg_format_types ft ON c.format_type_id = ft.format_type_id
                 LEFT JOIN lkup_ownership_statuses own2 ON c.ownership_status_id = own2.ownership_status_id
                 WHERE c.item_id = i.item_id) AS copies_summary,
                (SELECT COUNT(*) FROM tbl_ttrpg_copies c WHERE c.item_id = i.item_id) AS copy_count
            FROM tbl_items i
            JOIN tbl_ttrpg_details td ON i.item_id = td.item_id
            JOIN lkup_ownership_statuses os ON i.ownership_status_id = os.ownership_status_id
            JOIN lkup_top_level_categories ltc ON i.top_level_category_id = ltc.top_level_category_id
            WHERE i.collection_type_id = :ct
            ORDER BY COALESCE(td.title_sort, td.title)
        """),
        {"ct": TTRPG_COLLECTION_TYPE_ID},
    ).fetchall()

    return [
        {
            "item_id": row[0],
            "top_level_category_id": row[1],
            "category_name": row[2],
            "ownership_status_id": row[3],
            "ownership_status": row[4],
            "notes": row[5],
            "title": row[6],
            "title_sort": row[7],
            "release_date": row[8],
            "cover_image_url": row[9],
            "system_edition_id": row[10],
            "line_id": row[11],
            "book_type_id": row[12],
            "publisher_id": row[13],
            "book_type_name": row[14],
            "system_edition_name": row[15],
            "line_name": row[16],
            "publisher_name": row[17],
            "authors": row[18].split(", ") if row[18] else [],
            "copies_summary": row[19],
            "copy_count": row[20],
        }
        for row in rows
    ]


@router.get("/{item_id}")
def get_ttrpg(item_id: int, db=Depends(get_db)):
    book = _get_ttrpg_detail(db, item_id)
    if not book:
        raise HTTPException(status_code=404, detail="TTRPG book not found.")
    return book


@router.post("")
def create_ttrpg(payload: TTRPGCreate, db=Depends(get_db)):
    try:
        publisher_id = None
        if payload.publisher_name and payload.publisher_name.strip():
            publisher_id = generic_upsert(db, "ttrpg_publisher", payload.publisher_name)

        system_edition_id = None
        if payload.system_edition_name and payload.system_edition_name.strip():
            system_edition_id = generic_scoped_upsert(db, "ttrpg_system_edition", payload.top_level_category_id, payload.system_edition_name)

        line_id = None
        if payload.line_name and payload.line_name.strip():
            line_id = generic_scoped_upsert(db, "ttrpg_line", payload.top_level_category_id, payload.line_name)

        item_result = db.execute(
            text("""
                INSERT INTO tbl_items (collection_type_id, top_level_category_id, ownership_status_id, notes)
                VALUES (:ct, :cat, :own, :notes)
                RETURNING item_id
            """),
            {
                "ct": TTRPG_COLLECTION_TYPE_ID,
                "cat": payload.top_level_category_id,
                "own": payload.ownership_status_id,
                "notes": payload.notes,
            },
        ).fetchone()
        item_id = item_result[0]

        db.execute(
            text("""
                INSERT INTO tbl_ttrpg_details (
                    item_id, title, title_sort, description,
                    system_edition_id, line_id, book_type_id, publisher_id,
                    release_date, cover_image_url, api_source, external_work_id
                ) VALUES (
                    :item_id, :title, :title_sort, :description,
                    :edition_id, :line_id, :book_type_id, :pub_id,
                    :release_date, :cover, :api_source, :ext_id
                )
            """),
            {
                "item_id": item_id,
                "title": payload.title.strip(),
                "title_sort": make_title_sort(payload.title.strip()),
                "description": payload.description,
                "edition_id": system_edition_id,
                "line_id": line_id,
                "book_type_id": payload.book_type_id,
                "pub_id": publisher_id,
                "release_date": payload.release_date,
                "cover": resolve_cover_url(payload.cover_image_url, "ttrpg", item_id),
                "api_source": payload.api_source,
                "ext_id": payload.external_work_id,
            },
        )

        _insert_ttrpg_authors(db, item_id, payload.author_names or [])
        _insert_ttrpg_copies(db, item_id, payload.copies or [])
        db.commit()

        book = _get_ttrpg_detail(db, item_id)
        return {"item_id": item_id, "status": "created", "ttrpg": book}
    except HTTPException:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise


@router.put("/{item_id}")
def update_ttrpg(item_id: int, payload: TTRPGUpdate, db=Depends(get_db)):
    try:
        existing = db.execute(
            text("SELECT item_id FROM tbl_items WHERE item_id = :id AND collection_type_id = :ct"),
            {"id": item_id, "ct": TTRPG_COLLECTION_TYPE_ID},
        ).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="TTRPG book not found.")

        publisher_id = None
        if payload.publisher_name and payload.publisher_name.strip():
            publisher_id = generic_upsert(db, "ttrpg_publisher", payload.publisher_name)

        system_edition_id = None
        if payload.system_edition_name and payload.system_edition_name.strip():
            system_edition_id = generic_scoped_upsert(db, "ttrpg_system_edition", payload.top_level_category_id, payload.system_edition_name)

        line_id = None
        if payload.line_name and payload.line_name.strip():
            line_id = generic_scoped_upsert(db, "ttrpg_line", payload.top_level_category_id, payload.line_name)

        db.execute(
            text("""
                UPDATE tbl_items
                SET top_level_category_id = :cat,
                    ownership_status_id = :own,
                    notes = :notes,
                    updated_at = CURRENT_TIMESTAMP
                WHERE item_id = :id
            """),
            {"id": item_id, "cat": payload.top_level_category_id, "own": payload.ownership_status_id, "notes": payload.notes},
        )

        db.execute(
            text("""
                UPDATE tbl_ttrpg_details
                SET title = :title,
                    title_sort = :title_sort,
                    description = :description,
                    system_edition_id = :edition_id,
                    line_id = :line_id,
                    book_type_id = :book_type_id,
                    publisher_id = :pub_id,
                    release_date = :release_date,
                    cover_image_url = :cover,
                    api_source = :api_source,
                    external_work_id = :ext_id
                WHERE item_id = :id
            """),
            {
                "id": item_id,
                "title": payload.title.strip(),
                "title_sort": make_title_sort(payload.title.strip()),
                "description": payload.description,
                "edition_id": system_edition_id,
                "line_id": line_id,
                "book_type_id": payload.book_type_id,
                "pub_id": publisher_id,
                "release_date": payload.release_date,
                "cover": resolve_cover_url(payload.cover_image_url, "ttrpg", item_id),
                "api_source": payload.api_source,
                "ext_id": payload.external_work_id,
            },
        )

        db.execute(text("DELETE FROM xref_ttrpg_book_authors WHERE item_id = :id"), {"id": item_id})
        db.execute(text("DELETE FROM tbl_ttrpg_copies WHERE item_id = :id"), {"id": item_id})
        _insert_ttrpg_authors(db, item_id, payload.author_names or [])
        _insert_ttrpg_copies(db, item_id, payload.copies or [])

        db.commit()
        book = _get_ttrpg_detail(db, item_id)
        return {"item_id": item_id, "status": "updated", "ttrpg": book}
    except HTTPException:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise


@router.delete("/{item_id}")
def delete_ttrpg(item_id: int, db=Depends(get_db)):
    try:
        existing = db.execute(
            text("SELECT item_id FROM tbl_items WHERE item_id = :id AND collection_type_id = :ct"),
            {"id": item_id, "ct": TTRPG_COLLECTION_TYPE_ID},
        ).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="TTRPG book not found.")

        files_to_delete = delete_attachment_files(db, item_id)
        files_to_delete.extend(collect_cover_file(db, "tbl_ttrpg_details", item_id))
        db.execute(text("DELETE FROM xref_ttrpg_book_authors WHERE item_id = :id"), {"id": item_id})
        db.execute(text("DELETE FROM tbl_ttrpg_copies WHERE item_id = :id"), {"id": item_id})
        db.execute(text("DELETE FROM tbl_attachments WHERE item_id = :id"), {"id": item_id})
        db.execute(text("DELETE FROM tbl_ttrpg_details WHERE item_id = :id"), {"id": item_id})
        db.execute(text("DELETE FROM tbl_items WHERE item_id = :id"), {"id": item_id})

        db.commit()
        remove_files(files_to_delete)
        return {"deleted": item_id}
    except HTTPException:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise


@router.patch("/bulk")
def bulk_update_ttrpg(payload: TTRPGBulkUpdatePayload, db=Depends(get_db)):
    try:
        for item_id in payload.item_ids:
            existing = db.execute(
                text("SELECT item_id FROM tbl_items WHERE item_id = :id AND collection_type_id = :ct"),
                {"id": item_id, "ct": TTRPG_COLLECTION_TYPE_ID},
            ).fetchone()
            if not existing:
                raise HTTPException(status_code=404, detail=f"Item {item_id} not found.")

            updates = []
            params = {"id": item_id}
            if payload.fields.ownership_status_id is not None:
                updates.append("ownership_status_id = :own")
                params["own"] = payload.fields.ownership_status_id
            if payload.fields.top_level_category_id is not None:
                updates.append("top_level_category_id = :cat")
                params["cat"] = payload.fields.top_level_category_id

            if updates:
                updates.append("updated_at = CURRENT_TIMESTAMP")
                db.execute(
                    text(f"UPDATE tbl_items SET {', '.join(updates)} WHERE item_id = :id"),
                    params,
                )

        db.commit()
        return {"updated": payload.item_ids, "count": len(payload.item_ids)}
    except HTTPException:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise


@router.post("/bulk-delete")
def bulk_delete_ttrpg(payload: BulkDeletePayload, db=Depends(get_db)):
    try:
        all_files = []
        for item_id in payload.item_ids:
            existing = db.execute(
                text("SELECT item_id FROM tbl_items WHERE item_id = :id AND collection_type_id = :ct"),
                {"id": item_id, "ct": TTRPG_COLLECTION_TYPE_ID},
            ).fetchone()
            if not existing:
                raise HTTPException(status_code=404, detail=f"Item {item_id} not found.")

            all_files.extend(delete_attachment_files(db, item_id))
            all_files.extend(collect_cover_file(db, "tbl_ttrpg_details", item_id))
            db.execute(text("DELETE FROM xref_ttrpg_book_authors WHERE item_id = :id"), {"id": item_id})
            db.execute(text("DELETE FROM tbl_ttrpg_copies WHERE item_id = :id"), {"id": item_id})
            db.execute(text("DELETE FROM tbl_attachments WHERE item_id = :id"), {"id": item_id})
            db.execute(text("DELETE FROM tbl_ttrpg_details WHERE item_id = :id"), {"id": item_id})
            db.execute(text("DELETE FROM tbl_items WHERE item_id = :id"), {"id": item_id})

        db.commit()
        remove_files(all_files)
        return {"deleted": payload.item_ids, "count": len(payload.item_ids)}
    except HTTPException:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise
