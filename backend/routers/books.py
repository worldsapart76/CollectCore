import json
import os
import urllib.parse
import urllib.request
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text

from constants import BOOK_COLLECTION_TYPE_ID
from dependencies import get_db
from helpers import generic_upsert, make_title_sort
from schemas.books import (
    BookBulkUpdatePayload,
    BookCreate,
    BookUpdate,
)

from file_helpers import (
    delete_attachment_files,
    remove_files,
    resolve_cover_url,
)
from schemas.photocards import BulkDeletePayload

GOOGLE_BOOKS_API_KEY = os.environ.get("GOOGLE_BOOKS_API_KEY", "")

router = APIRouter(prefix="/books", tags=["books"])


# --- Books helpers (module-specific) ---

def _insert_book_relationships(db, item_id: int, payload) -> None:
    """Insert all xref relationships and copy for a book. Caller clears existing rows first on update."""
    for order, name in enumerate(payload.author_names, start=1):
        if name.strip():
            author_id = generic_upsert(db, "book_author", name)
            db.execute(
                text("""
                    INSERT OR IGNORE INTO xref_book_item_authors (item_id, author_id, author_order)
                    VALUES (:item_id, :author_id, :order)
                """),
                {"item_id": item_id, "author_id": author_id, "order": order},
            )

    if payload.series_name and payload.series_name.strip():
        series_id = generic_upsert(db, "book_series", payload.series_name)
        db.execute(
            text("""
                INSERT OR IGNORE INTO xref_book_item_series (item_id, series_id, series_number)
                VALUES (:item_id, :series_id, :series_number)
            """),
            {"item_id": item_id, "series_id": series_id, "series_number": payload.series_number},
        )

    if payload.genres:
        for g in payload.genres:
            db.execute(
                text("""
                    INSERT OR IGNORE INTO xref_book_item_genres (item_id, top_level_genre_id, sub_genre_id)
                    VALUES (:item_id, :top_level_genre_id, :sub_genre_id)
                """),
                {"item_id": item_id, "top_level_genre_id": g.top_level_genre_id, "sub_genre_id": g.sub_genre_id},
            )

    if payload.tag_names:
        for name in payload.tag_names:
            if name.strip():
                tag_id = generic_upsert(db, "book_tag", name)
                db.execute(
                    text("""
                        INSERT OR IGNORE INTO xref_book_item_tags (item_id, tag_id)
                        VALUES (:item_id, :tag_id)
                    """),
                    {"item_id": item_id, "tag_id": tag_id},
                )

    if payload.format_detail_id is not None:
        db.execute(
            text("""
                INSERT INTO tbl_book_copies (
                    item_id, format_detail_id, isbn_13, isbn_10, publisher,
                    published_date, page_count, language, cover_image_url,
                    api_source, external_work_id
                ) VALUES (
                    :item_id, :format_detail_id, :isbn_13, :isbn_10, :publisher,
                    :published_date, :page_count, :language, :cover_image_url,
                    :api_source, :external_work_id
                )
            """),
            {
                "item_id": item_id,
                "format_detail_id": payload.format_detail_id,
                "isbn_13": payload.isbn_13,
                "isbn_10": payload.isbn_10,
                "publisher": payload.publisher,
                "published_date": payload.published_date,
                "page_count": payload.page_count,
                "language": payload.language,
                "cover_image_url": payload.cover_image_url,
                "api_source": payload.api_source,
                "external_work_id": payload.external_work_id,
            },
        )


def _get_book_detail(db, item_id: int):
    """Return full detail dict for a single book, or None if not found."""
    row = db.execute(
        text("""
            SELECT
                i.item_id,
                i.top_level_category_id,
                c.category_name,
                i.ownership_status_id,
                os.status_name,
                i.reading_status_id,
                rs.status_name,
                i.notes,
                i.created_at,
                i.updated_at,
                bd.title,
                bd.title_sort,
                bd.description,
                bd.age_level_id,
                al.age_level_name,
                bd.star_rating,
                bd.review,
                bd.api_categories_raw
            FROM tbl_items i
            JOIN tbl_book_details bd ON i.item_id = bd.item_id
            JOIN lkup_top_level_categories c ON i.top_level_category_id = c.top_level_category_id
            JOIN lkup_ownership_statuses os ON i.ownership_status_id = os.ownership_status_id
            LEFT JOIN lkup_book_read_statuses rs ON i.reading_status_id = rs.read_status_id
            LEFT JOIN lkup_book_age_levels al ON bd.age_level_id = al.age_level_id
            WHERE i.item_id = :item_id AND i.collection_type_id = :ct
        """),
        {"item_id": item_id, "ct": BOOK_COLLECTION_TYPE_ID},
    ).fetchone()

    if not row:
        return None

    authors = db.execute(
        text("""
            SELECT la.author_id, la.author_name, xa.author_order
            FROM xref_book_item_authors xa
            JOIN lkup_book_authors la ON xa.author_id = la.author_id
            WHERE xa.item_id = :item_id
            ORDER BY xa.author_order
        """),
        {"item_id": item_id},
    ).fetchall()

    series = db.execute(
        text("""
            SELECT ts.series_id, ts.series_name, xs.series_number
            FROM xref_book_item_series xs
            JOIN tbl_book_series ts ON xs.series_id = ts.series_id
            WHERE xs.item_id = :item_id
        """),
        {"item_id": item_id},
    ).fetchall()

    genres = db.execute(
        text("""
            SELECT xg.top_level_genre_id, tg.genre_name, xg.sub_genre_id, sg.sub_genre_name
            FROM xref_book_item_genres xg
            JOIN lkup_book_top_level_genres tg ON xg.top_level_genre_id = tg.top_level_genre_id
            LEFT JOIN lkup_book_sub_genres sg ON xg.sub_genre_id = sg.sub_genre_id
            WHERE xg.item_id = :item_id
            ORDER BY tg.genre_name, sg.sub_genre_name
        """),
        {"item_id": item_id},
    ).fetchall()

    tags = db.execute(
        text("""
            SELECT lt.tag_id, lt.tag_name
            FROM xref_book_item_tags xt
            JOIN lkup_book_tags lt ON xt.tag_id = lt.tag_id
            WHERE xt.item_id = :item_id
            ORDER BY lt.tag_name
        """),
        {"item_id": item_id},
    ).fetchall()

    copies = db.execute(
        text("""
            SELECT bc.copy_id, bc.format_detail_id, fd.format_name, fd.top_level_format,
                   bc.isbn_13, bc.isbn_10, bc.publisher, bc.published_date,
                   bc.page_count, bc.language, bc.cover_image_url, bc.notes,
                   bc.api_source, bc.external_work_id
            FROM tbl_book_copies bc
            JOIN lkup_book_format_details fd ON bc.format_detail_id = fd.format_detail_id
            WHERE bc.item_id = :item_id
            ORDER BY bc.copy_id
        """),
        {"item_id": item_id},
    ).fetchall()

    return {
        "item_id": row[0],
        "top_level_category_id": row[1],
        "category": row[2],
        "ownership_status_id": row[3],
        "ownership_status": row[4],
        "reading_status_id": row[5],
        "reading_status": row[6],
        "notes": row[7],
        "created_at": row[8],
        "updated_at": row[9],
        "title": row[10],
        "title_sort": row[11],
        "description": row[12],
        "age_level_id": row[13],
        "age_level": row[14],
        "star_rating": row[15],
        "review": row[16],
        "api_categories_raw": row[17],
        "authors": [{"author_id": a[0], "author_name": a[1], "author_order": a[2]} for a in authors],
        "series": [{"series_id": s[0], "series_name": s[1], "series_number": s[2]} for s in series],
        "genres": [
            {
                "top_level_genre_id": g[0],
                "genre_name": g[1],
                "sub_genre_id": g[2],
                "sub_genre_name": g[3],
            }
            for g in genres
        ],
        "tags": [{"tag_id": t[0], "tag_name": t[1]} for t in tags],
        "copies": [
            {
                "copy_id": c[0],
                "format_detail_id": c[1],
                "format_name": c[2],
                "top_level_format": c[3],
                "isbn_13": c[4],
                "isbn_10": c[5],
                "publisher": c[6],
                "published_date": c[7],
                "page_count": c[8],
                "language": c[9],
                "cover_image_url": c[10],
                "notes": c[11],
                "api_source": c[12],
                "external_work_id": c[13],
            }
            for c in copies
        ],
    }


def _normalize_google_book(volume: dict) -> dict:
    info = volume.get("volumeInfo", {})
    isbns = {i["type"]: i["identifier"] for i in info.get("industryIdentifiers", [])}
    image_links = info.get("imageLinks", {})
    raw_cover = image_links.get("thumbnail") or image_links.get("smallThumbnail")
    cover = raw_cover.replace("http://", "https://") if raw_cover else None
    return {
        "title": info.get("title"),
        "author_names": info.get("authors", []),
        "isbn_10": isbns.get("ISBN_10"),
        "isbn_13": isbns.get("ISBN_13"),
        "publisher": info.get("publisher"),
        "published_date": info.get("publishedDate"),
        "page_count": info.get("pageCount"),
        "language": info.get("language"),
        "description": info.get("description"),
        "cover_image_url": cover,
        "api_source": "google_books",
        "external_work_id": volume.get("id"),
        "api_categories_raw": ", ".join(info.get("categories", [])) or None,
        "_raw": {
            "volumeInfo": info,
            "saleInfo": volume.get("saleInfo"),
            "accessInfo": volume.get("accessInfo"),
        },
    }


# --- Books lookup endpoints ---
# NOTE: specific paths (/genres, /format-details, etc.) must appear before /{item_id}

@router.get("/genres")
def get_book_genres(category_scope_id: Optional[int] = None, db=Depends(get_db)):
    query = """
        SELECT g.top_level_genre_id, g.genre_name, g.category_scope_id,
               s.sub_genre_id, s.sub_genre_name
        FROM lkup_book_top_level_genres g
        LEFT JOIN lkup_book_sub_genres s
            ON g.top_level_genre_id = s.top_level_genre_id AND s.is_active = 1
        WHERE g.is_active = 1
    """
    params = {}
    if category_scope_id is not None:
        query += " AND g.category_scope_id = :category_scope_id"
        params["category_scope_id"] = category_scope_id
    query += " ORDER BY g.sort_order, g.genre_name, s.sort_order, s.sub_genre_name"

    rows = db.execute(text(query), params).fetchall()

    genres: dict = {}
    for row in rows:
        gid = row[0]
        if gid not in genres:
            genres[gid] = {
                "top_level_genre_id": row[0],
                "genre_name": row[1],
                "category_scope_id": row[2],
                "sub_genres": [],
            }
        if row[3] is not None:
            genres[gid]["sub_genres"].append({
                "sub_genre_id": row[3],
                "sub_genre_name": row[4],
            })

    return list(genres.values())


@router.get("/format-details")
def get_book_format_details(db=Depends(get_db)):
    rows = db.execute(text("""
        SELECT format_detail_id, format_name, top_level_format, sort_order
        FROM lkup_book_format_details
        WHERE is_active = 1
        ORDER BY top_level_format, sort_order, format_name
    """)).fetchall()
    return [
        {
            "format_detail_id": row[0],
            "format_name": row[1],
            "top_level_format": row[2],
        }
        for row in rows
    ]


@router.get("/age-levels")
def get_book_age_levels(db=Depends(get_db)):
    rows = db.execute(text("""
        SELECT age_level_id, age_level_name
        FROM lkup_book_age_levels
        WHERE is_active = 1
        ORDER BY sort_order
    """)).fetchall()
    return [{"age_level_id": row[0], "age_level_name": row[1]} for row in rows]


@router.get("/read-statuses")
def get_book_read_statuses(db=Depends(get_db)):
    rows = db.execute(text("""
        SELECT read_status_id, status_name
        FROM lkup_book_read_statuses
        WHERE is_active = 1
        ORDER BY sort_order
    """)).fetchall()
    return [{"read_status_id": row[0], "status_name": row[1]} for row in rows]


@router.get("/authors")
def get_book_authors(q: Optional[str] = None, db=Depends(get_db)):
    if q:
        rows = db.execute(
            text("""
                SELECT author_id, author_name
                FROM lkup_book_authors
                WHERE is_active = 1 AND LOWER(author_name) LIKE LOWER(:q)
                ORDER BY author_name
                LIMIT 20
            """),
            {"q": f"%{q}%"},
        ).fetchall()
    else:
        rows = db.execute(text("""
            SELECT author_id, author_name
            FROM lkup_book_authors
            WHERE is_active = 1
            ORDER BY author_name
        """)).fetchall()
    return [{"author_id": row[0], "author_name": row[1]} for row in rows]


@router.get("/series")
def get_book_series(q: Optional[str] = None, db=Depends(get_db)):
    if q:
        rows = db.execute(
            text("""
                SELECT series_id, series_name
                FROM tbl_book_series
                WHERE is_active = 1 AND LOWER(series_name) LIKE LOWER(:q)
                ORDER BY series_name
                LIMIT 20
            """),
            {"q": f"%{q}%"},
        ).fetchall()
    else:
        rows = db.execute(text("""
            SELECT series_id, series_name
            FROM tbl_book_series
            WHERE is_active = 1
            ORDER BY series_name
        """)).fetchall()
    return [{"series_id": row[0], "series_name": row[1]} for row in rows]


@router.get("/tags")
def get_book_tags(q: Optional[str] = None, db=Depends(get_db)):
    if q:
        rows = db.execute(
            text("""
                SELECT tag_id, tag_name
                FROM lkup_book_tags
                WHERE is_active = 1 AND LOWER(tag_name) LIKE LOWER(:q)
                ORDER BY tag_name
                LIMIT 20
            """),
            {"q": f"%{q}%"},
        ).fetchall()
    else:
        rows = db.execute(text("""
            SELECT tag_id, tag_name
            FROM lkup_book_tags
            WHERE is_active = 1
            ORDER BY tag_name
        """)).fetchall()
    return [{"tag_id": row[0], "tag_name": row[1]} for row in rows]


# --- External book search ---

@router.get("/search-external")
def search_external_books(q: str = Query(..., min_length=1)):
    encoded = urllib.parse.quote(q)
    url = f"https://www.googleapis.com/books/v1/volumes?q={encoded}&maxResults=10"
    try:
        with urllib.request.urlopen(url, timeout=6) as resp:
            data = json.loads(resp.read())
        return [_normalize_google_book(v) for v in data.get("items", [])]
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"External search failed: {e}")


@router.get("/lookup-isbn")
def lookup_isbn(isbn: str = Query(..., min_length=10)):
    encoded = urllib.parse.quote(f"isbn:{isbn}")
    url = f"https://www.googleapis.com/books/v1/volumes?q={encoded}&maxResults=1"
    try:
        with urllib.request.urlopen(url, timeout=6) as resp:
            data = json.loads(resp.read())
        items = data.get("items", [])
        if not items:
            return None
        return _normalize_google_book(items[0])
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"ISBN lookup failed: {e}")


# --- Books CRUD ---

@router.get("")
def list_books(db=Depends(get_db)):
    rows = db.execute(
        text("""
            SELECT
                i.item_id,
                i.top_level_category_id,
                c.category_name,
                i.ownership_status_id,
                os.status_name,
                i.reading_status_id,
                rs.status_name,
                i.notes,
                bd.title,
                bd.title_sort,
                bd.star_rating,
                al.age_level_name,
                bd.age_level_id,
                (SELECT GROUP_CONCAT(la.author_name, ', ')
                 FROM xref_book_item_authors xa
                 JOIN lkup_book_authors la ON xa.author_id = la.author_id
                 WHERE xa.item_id = i.item_id) AS authors_str,
                (SELECT ts.series_name FROM xref_book_item_series xs
                 JOIN tbl_book_series ts ON xs.series_id = ts.series_id
                 WHERE xs.item_id = i.item_id LIMIT 1) AS series_name,
                (SELECT xs.series_number FROM xref_book_item_series xs
                 WHERE xs.item_id = i.item_id LIMIT 1) AS series_number,
                (SELECT bc.cover_image_url FROM tbl_book_copies bc
                 WHERE bc.item_id = i.item_id AND bc.cover_image_url IS NOT NULL LIMIT 1) AS cover_image_url,
                (SELECT bc.isbn_13 FROM tbl_book_copies bc
                 WHERE bc.item_id = i.item_id AND bc.isbn_13 IS NOT NULL LIMIT 1) AS isbn_13,
                (SELECT GROUP_CONCAT(lfd.format_name || '|' || lfd.top_level_format, '|||')
                 FROM tbl_book_copies bc2
                 JOIN lkup_book_format_details lfd ON bc2.format_detail_id = lfd.format_detail_id
                 WHERE bc2.item_id = i.item_id) AS formats_str,
                (SELECT GROUP_CONCAT(lg.genre_name, '|||')
                 FROM xref_book_item_genres xg
                 JOIN lkup_book_top_level_genres lg ON xg.top_level_genre_id = lg.top_level_genre_id
                 WHERE xg.item_id = i.item_id) AS genres_str,
                (SELECT GROUP_CONCAT(ls.sub_genre_name, '|||')
                 FROM xref_book_item_genres xg2
                 JOIN lkup_book_sub_genres ls ON xg2.sub_genre_id = ls.sub_genre_id
                 WHERE xg2.item_id = i.item_id AND xg2.sub_genre_id IS NOT NULL) AS subgenres_str,
                (SELECT GROUP_CONCAT(lt.tag_name, '|||')
                 FROM xref_book_item_tags xt
                 JOIN lkup_book_tags lt ON xt.tag_id = lt.tag_id
                 WHERE xt.item_id = i.item_id) AS tags_str
            FROM tbl_items i
            JOIN tbl_book_details bd ON i.item_id = bd.item_id
            JOIN lkup_top_level_categories c ON i.top_level_category_id = c.top_level_category_id
            JOIN lkup_ownership_statuses os ON i.ownership_status_id = os.ownership_status_id
            LEFT JOIN lkup_book_read_statuses rs ON i.reading_status_id = rs.read_status_id
            LEFT JOIN lkup_book_age_levels al ON bd.age_level_id = al.age_level_id
            WHERE i.collection_type_id = :ct
            ORDER BY COALESCE(bd.title_sort, bd.title)
        """),
        {"ct": BOOK_COLLECTION_TYPE_ID},
    ).fetchall()

    def parse_formats(s):
        if not s:
            return []
        result = []
        for entry in s.split("|||"):
            parts = entry.split("|", 1)
            if len(parts) == 2:
                result.append({"format_name": parts[0], "top_level_format": parts[1]})
        return result

    def parse_list(s):
        if not s:
            return []
        seen = set()
        out = []
        for v in s.split("|||"):
            if v not in seen:
                seen.add(v)
                out.append(v)
        return out

    return [
        {
            "item_id": row[0],
            "top_level_category_id": row[1],
            "category": row[2],
            "ownership_status_id": row[3],
            "ownership_status": row[4],
            "reading_status_id": row[5],
            "reading_status": row[6],
            "notes": row[7],
            "title": row[8],
            "title_sort": row[9],
            "star_rating": row[10],
            "age_level": row[11],
            "age_level_id": row[12],
            "authors": row[13].split(", ") if row[13] else [],
            "series_name": row[14],
            "series_number": row[15],
            "cover_image_url": row[16],
            "isbn_13": row[17],
            "formats": parse_formats(row[18]),
            "genres": parse_list(row[19]),
            "subgenres": parse_list(row[20]),
            "tags": parse_list(row[21]),
        }
        for row in rows
    ]


@router.get("/{item_id}")
def get_book(item_id: int, db=Depends(get_db)):
    book = _get_book_detail(db, item_id)
    if not book:
        raise HTTPException(status_code=404, detail="Book not found.")
    return book


@router.post("")
def create_book(payload: BookCreate, db=Depends(get_db)):
    if not payload.author_names or not any(n.strip() for n in payload.author_names):
        raise HTTPException(status_code=400, detail="At least one author name is required.")

    try:
        # Soft duplicate check: same title + same primary author
        primary_author = payload.author_names[0].strip()
        dupe = db.execute(
            text("""
                SELECT i.item_id
                FROM tbl_items i
                JOIN tbl_book_details bd ON i.item_id = bd.item_id
                JOIN xref_book_item_authors xa ON i.item_id = xa.item_id
                JOIN lkup_book_authors la ON xa.author_id = la.author_id
                WHERE i.collection_type_id = :ct
                  AND LOWER(TRIM(bd.title)) = LOWER(TRIM(:title))
                  AND LOWER(TRIM(la.author_name)) = LOWER(TRIM(:author))
                  AND xa.author_order = 1
            """),
            {"ct": BOOK_COLLECTION_TYPE_ID, "title": payload.title, "author": primary_author},
        ).fetchone()

        if dupe:
            raise HTTPException(
                status_code=409,
                detail=f"A book with that title and primary author already exists (item_id={dupe[0]}).",
            )

        item_result = db.execute(
            text("""
                INSERT INTO tbl_items (
                    collection_type_id, top_level_category_id, ownership_status_id,
                    reading_status_id, notes
                )
                VALUES (:ct, :cat, :own, :rs, :notes)
                RETURNING item_id
            """),
            {
                "ct": BOOK_COLLECTION_TYPE_ID,
                "cat": payload.top_level_category_id,
                "own": payload.ownership_status_id,
                "rs": payload.reading_status_id,
                "notes": payload.notes,
            },
        ).fetchone()
        item_id = item_result[0]

        db.execute(
            text("""
                INSERT INTO tbl_book_details (
                    item_id, title, title_sort, description,
                    age_level_id, star_rating, review, api_categories_raw
                )
                VALUES (
                    :item_id, :title, :title_sort, :description,
                    :age_level_id, :star_rating, :review, :api_categories_raw
                )
            """),
            {
                "item_id": item_id,
                "title": payload.title.strip(),
                "title_sort": make_title_sort(payload.title.strip()),
                "description": payload.description,
                "age_level_id": payload.age_level_id,
                "star_rating": payload.star_rating,
                "review": payload.review,
                "api_categories_raw": payload.api_categories_raw,
            },
        )

        # Download cover locally so external URLs never go stale
        if payload.cover_image_url:
            payload.cover_image_url = resolve_cover_url(payload.cover_image_url, "books", item_id)

        _insert_book_relationships(db, item_id, payload)
        db.commit()

        book = _get_book_detail(db, item_id)
        return {"item_id": item_id, "status": "created", "book": book}

    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        if "ux_book_copies_isbn13" in str(e) or "UNIQUE constraint failed: tbl_book_copies.isbn_13" in str(e):
            raise HTTPException(status_code=409, detail="A book with that ISBN-13 already exists.")
        raise


@router.put("/{item_id}")
def update_book(item_id: int, payload: BookUpdate, db=Depends(get_db)):
    if not payload.author_names or not any(n.strip() for n in payload.author_names):
        raise HTTPException(status_code=400, detail="At least one author name is required.")

    try:
        existing = db.execute(
            text("SELECT item_id FROM tbl_items WHERE item_id = :id AND collection_type_id = :ct"),
            {"id": item_id, "ct": BOOK_COLLECTION_TYPE_ID},
        ).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Book not found.")

        db.execute(
            text("""
                UPDATE tbl_items
                SET top_level_category_id = :cat,
                    ownership_status_id = :own,
                    reading_status_id = :rs,
                    notes = :notes,
                    updated_at = CURRENT_TIMESTAMP
                WHERE item_id = :id
            """),
            {
                "id": item_id,
                "cat": payload.top_level_category_id,
                "own": payload.ownership_status_id,
                "rs": payload.reading_status_id,
                "notes": payload.notes,
            },
        )

        db.execute(
            text("""
                UPDATE tbl_book_details
                SET title = :title,
                    title_sort = :title_sort,
                    description = :description,
                    age_level_id = :age_level_id,
                    star_rating = :star_rating,
                    review = :review,
                    api_categories_raw = :api_categories_raw
                WHERE item_id = :id
            """),
            {
                "id": item_id,
                "title": payload.title.strip(),
                "title_sort": make_title_sort(payload.title.strip()),
                "description": payload.description,
                "age_level_id": payload.age_level_id,
                "star_rating": payload.star_rating,
                "review": payload.review,
                "api_categories_raw": payload.api_categories_raw,
            },
        )

        # Clear all xref rows and copies, then re-insert
        db.execute(text("DELETE FROM xref_book_item_authors WHERE item_id = :id"), {"id": item_id})
        db.execute(text("DELETE FROM xref_book_item_series WHERE item_id = :id"), {"id": item_id})
        db.execute(text("DELETE FROM xref_book_item_genres WHERE item_id = :id"), {"id": item_id})
        db.execute(text("DELETE FROM xref_book_item_tags WHERE item_id = :id"), {"id": item_id})
        db.execute(text("DELETE FROM tbl_book_copies WHERE item_id = :id"), {"id": item_id})

        # Download cover locally if an external URL was provided
        if payload.cover_image_url and not payload.cover_image_url.startswith("/images/"):
            payload.cover_image_url = resolve_cover_url(payload.cover_image_url, "books", item_id)

        _insert_book_relationships(db, item_id, payload)
        db.commit()

        book = _get_book_detail(db, item_id)
        return {"item_id": item_id, "status": "updated", "book": book}

    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        if "ux_book_copies_isbn13" in str(e) or "UNIQUE constraint failed: tbl_book_copies.isbn_13" in str(e):
            raise HTTPException(status_code=409, detail="A book with that ISBN-13 already exists.")
        raise


@router.delete("/{item_id}")
def delete_book(item_id: int, db=Depends(get_db)):
    try:
        existing = db.execute(
            text("SELECT item_id FROM tbl_items WHERE item_id = :id AND collection_type_id = :ct"),
            {"id": item_id, "ct": BOOK_COLLECTION_TYPE_ID},
        ).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Book not found.")

        files_to_delete = delete_attachment_files(db, item_id)
        db.execute(text("DELETE FROM xref_book_item_authors WHERE item_id = :id"), {"id": item_id})
        db.execute(text("DELETE FROM xref_book_item_series WHERE item_id = :id"), {"id": item_id})
        db.execute(text("DELETE FROM xref_book_item_genres WHERE item_id = :id"), {"id": item_id})
        db.execute(text("DELETE FROM xref_book_item_tags WHERE item_id = :id"), {"id": item_id})
        db.execute(text("DELETE FROM tbl_book_copies WHERE item_id = :id"), {"id": item_id})
        db.execute(text("DELETE FROM tbl_attachments WHERE item_id = :id"), {"id": item_id})
        db.execute(text("DELETE FROM tbl_book_details WHERE item_id = :id"), {"id": item_id})
        db.execute(text("DELETE FROM tbl_items WHERE item_id = :id"), {"id": item_id})
        db.commit()
        remove_files(files_to_delete)

        return {"item_id": item_id, "status": "deleted"}
    except HTTPException:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise


@router.patch("/bulk")
def bulk_update_books(payload: BookBulkUpdatePayload, db=Depends(get_db)):
    if not payload.item_ids:
        raise HTTPException(status_code=400, detail="item_ids cannot be empty.")

    try:
        placeholders = ",".join(str(i) for i in payload.item_ids)
        found = db.execute(
            text(f"SELECT item_id FROM tbl_items WHERE item_id IN ({placeholders}) AND collection_type_id = :ct"),
            {"ct": BOOK_COLLECTION_TYPE_ID},
        ).fetchall()
        if len(found) != len(payload.item_ids):
            raise HTTPException(status_code=404, detail="One or more item_ids not found.")

        f = payload.fields

        # tbl_items updates
        item_updates = []
        item_params = {}
        if f.ownership_status_id is not None:
            item_updates.append("ownership_status_id = :ownership_status_id")
            item_params["ownership_status_id"] = f.ownership_status_id
        if f.reading_status_id is not None:
            item_updates.append("reading_status_id = :reading_status_id")
            item_params["reading_status_id"] = f.reading_status_id
        if f.top_level_category_id is not None:
            item_updates.append("top_level_category_id = :top_level_category_id")
            item_params["top_level_category_id"] = f.top_level_category_id

        if item_updates:
            item_updates.append("updated_at = CURRENT_TIMESTAMP")
            for item_id in payload.item_ids:
                db.execute(
                    text(f"UPDATE tbl_items SET {', '.join(item_updates)} WHERE item_id = :item_id"),
                    {**item_params, "item_id": item_id},
                )

        # tbl_book_details updates
        detail_updates = []
        detail_params = {}
        if f.age_level_id is not None:
            detail_updates.append("age_level_id = :age_level_id")
            detail_params["age_level_id"] = f.age_level_id
        if f.star_rating is not None:
            detail_updates.append("star_rating = :star_rating")
            detail_params["star_rating"] = f.star_rating

        if detail_updates:
            for item_id in payload.item_ids:
                db.execute(
                    text(f"UPDATE tbl_book_details SET {', '.join(detail_updates)} WHERE item_id = :item_id"),
                    {**detail_params, "item_id": item_id},
                )

        # tbl_book_copies: update first copy's format_detail_id per item
        if f.format_detail_id is not None:
            for item_id in payload.item_ids:
                first_copy = db.execute(
                    text("SELECT copy_id FROM tbl_book_copies WHERE item_id = :id ORDER BY copy_id LIMIT 1"),
                    {"id": item_id},
                ).fetchone()
                if first_copy:
                    db.execute(
                        text("UPDATE tbl_book_copies SET format_detail_id = :fd WHERE copy_id = :cid"),
                        {"fd": f.format_detail_id, "cid": first_copy[0]},
                    )

        # Genre replace: delete existing and insert new
        if f.genres is not None:
            for item_id in payload.item_ids:
                db.execute(text("DELETE FROM xref_book_item_genres WHERE item_id = :id"), {"id": item_id})
                for g in f.genres:
                    db.execute(
                        text("INSERT INTO xref_book_item_genres (item_id, top_level_genre_id, sub_genre_id) VALUES (:item_id, :tg, :sg)"),
                        {"item_id": item_id, "tg": g.top_level_genre_id, "sg": g.sub_genre_id},
                    )

        db.commit()
        return {"item_ids": payload.item_ids, "status": "updated", "count": len(payload.item_ids)}
    except HTTPException:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise


@router.post("/bulk-delete")
def bulk_delete_books(payload: BulkDeletePayload, db=Depends(get_db)):
    if not payload.item_ids:
        raise HTTPException(status_code=400, detail="item_ids cannot be empty.")

    try:
        placeholders = ",".join(str(i) for i in payload.item_ids)
        found = db.execute(
            text(f"SELECT item_id FROM tbl_items WHERE item_id IN ({placeholders}) AND collection_type_id = :ct"),
            {"ct": BOOK_COLLECTION_TYPE_ID},
        ).fetchall()
        if len(found) != len(payload.item_ids):
            raise HTTPException(status_code=404, detail="One or more item_ids not found.")

        all_files = []
        for item_id in payload.item_ids:
            all_files.extend(delete_attachment_files(db, item_id))
            db.execute(text("DELETE FROM xref_book_item_authors WHERE item_id = :id"), {"id": item_id})
            db.execute(text("DELETE FROM xref_book_item_series WHERE item_id = :id"), {"id": item_id})
            db.execute(text("DELETE FROM xref_book_item_genres WHERE item_id = :id"), {"id": item_id})
            db.execute(text("DELETE FROM xref_book_item_tags WHERE item_id = :id"), {"id": item_id})
            db.execute(text("DELETE FROM tbl_book_copies WHERE item_id = :id"), {"id": item_id})
            db.execute(text("DELETE FROM tbl_attachments WHERE item_id = :id"), {"id": item_id})
            db.execute(text("DELETE FROM tbl_book_details WHERE item_id = :id"), {"id": item_id})
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
