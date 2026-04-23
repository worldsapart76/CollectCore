import json
import os
import re as _re
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text

from constants import GN_COLLECTION_TYPE_ID
from dependencies import get_db
from external_apis import (
    google_books_get_volume,
    google_books_lookup_isbn,
    google_books_search,
)
from file_helpers import (
    delete_attachment_files,
    collect_cover_file,
    remove_files,
    download_cover,
    resolve_cover_url,
    COVER_DIRS,
    DATA_ROOT,
)
from helpers import generic_upsert, make_title_sort
from schemas.graphic_novels import (
    GnBulkUpdatePayload,
    GnPublisherCreate,
    GraphicNovelCreate,
    GraphicNovelUpdate,
)
from schemas.photocards import BulkDeletePayload

# ---------- API keys ----------
COMIC_VINE_API_KEY = os.environ.get("COMIC_VINE_API_KEY", "")

router = APIRouter(prefix="/graphicnovels", tags=["graphicnovels"])


def _insert_gn_relationships(db, item_id: int, payload) -> None:
    if payload.writer_names:
        for order, name in enumerate(payload.writer_names, start=1):
            if name.strip():
                writer_id = generic_upsert(db, "gn_writer", name)
                db.execute(
                    text("""
                        INSERT OR IGNORE INTO xref_graphicnovel_item_writers (item_id, writer_id, writer_order)
                        VALUES (:item_id, :writer_id, :order)
                    """),
                    {"item_id": item_id, "writer_id": writer_id, "order": order},
                )

    if payload.artist_names:
        for order, name in enumerate(payload.artist_names, start=1):
            if name.strip():
                artist_id = generic_upsert(db, "gn_artist", name)
                db.execute(
                    text("""
                        INSERT OR IGNORE INTO xref_graphicnovel_item_artists (item_id, artist_id, artist_order)
                        VALUES (:item_id, :artist_id, :order)
                    """),
                    {"item_id": item_id, "artist_id": artist_id, "order": order},
                )

    if payload.tag_names:
        for name in payload.tag_names:
            if name.strip():
                tag_id = generic_upsert(db, "gn_tag", name)
                db.execute(
                    text("""
                        INSERT OR IGNORE INTO xref_graphicnovel_item_tags (item_id, tag_id)
                        VALUES (:item_id, :tag_id)
                    """),
                    {"item_id": item_id, "tag_id": tag_id},
                )

    if payload.source_series:
        for order, entry in enumerate(payload.source_series, start=0):
            if entry.source_series_name.strip():
                db.execute(
                    text("""
                        INSERT INTO xref_gn_source_series (item_id, source_series_name, start_issue, end_issue, sort_order)
                        VALUES (:item_id, :name, :start, :end, :order)
                    """),
                    {
                        "item_id": item_id,
                        "name": entry.source_series_name.strip(),
                        "start": entry.start_issue,
                        "end": entry.end_issue,
                        "order": order,
                    },
                )


def _get_gn_detail(db, item_id: int):
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
                gd.title,
                gd.title_sort,
                gd.description,
                gd.publisher_id,
                pub.publisher_name,
                gd.format_type_id,
                ft.format_type_name,
                gd.era_id,
                era.era_name,
                era.era_years,
                gd.series_name,
                gd.series_number,
                gd.issue_notes,
                gd.page_count,
                gd.published_date,
                gd.isbn_13,
                gd.isbn_10,
                gd.cover_image_url,
                gd.edition_notes,
                gd.star_rating,
                gd.review,
                gd.api_source,
                gd.external_work_id
            FROM tbl_items i
            JOIN tbl_graphicnovel_details gd ON i.item_id = gd.item_id
            JOIN lkup_top_level_categories c ON i.top_level_category_id = c.top_level_category_id
            JOIN lkup_ownership_statuses os ON i.ownership_status_id = os.ownership_status_id
            LEFT JOIN lkup_consumption_statuses rs ON i.reading_status_id = rs.read_status_id
            LEFT JOIN lkup_graphicnovel_publishers pub ON gd.publisher_id = pub.publisher_id
            LEFT JOIN lkup_graphicnovel_format_types ft ON gd.format_type_id = ft.format_type_id
            LEFT JOIN lkup_graphicnovel_eras era ON gd.era_id = era.era_id
            WHERE i.item_id = :item_id AND i.collection_type_id = :ct
        """),
        {"item_id": item_id, "ct": GN_COLLECTION_TYPE_ID},
    ).fetchone()

    if not row:
        return None

    writers = db.execute(
        text("""
            SELECT lw.writer_id, lw.writer_name, xw.writer_order
            FROM xref_graphicnovel_item_writers xw
            JOIN lkup_graphicnovel_writers lw ON xw.writer_id = lw.writer_id
            WHERE xw.item_id = :item_id
            ORDER BY xw.writer_order
        """),
        {"item_id": item_id},
    ).fetchall()

    artists = db.execute(
        text("""
            SELECT la.artist_id, la.artist_name, xa.artist_order
            FROM xref_graphicnovel_item_artists xa
            JOIN lkup_graphicnovel_artists la ON xa.artist_id = la.artist_id
            WHERE xa.item_id = :item_id
            ORDER BY xa.artist_order
        """),
        {"item_id": item_id},
    ).fetchall()

    tags = db.execute(
        text("""
            SELECT lt.tag_id, lt.tag_name
            FROM xref_graphicnovel_item_tags xt
            JOIN lkup_graphicnovel_tags lt ON xt.tag_id = lt.tag_id
            WHERE xt.item_id = :item_id
            ORDER BY lt.tag_name
        """),
        {"item_id": item_id},
    ).fetchall()

    source_series = db.execute(
        text("""
            SELECT xref_id, source_series_name, start_issue, end_issue
            FROM xref_gn_source_series
            WHERE item_id = :item_id
            ORDER BY sort_order
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
        "publisher_id": row[13],
        "publisher_name": row[14],
        "format_type_id": row[15],
        "format_type_name": row[16],
        "era_id": row[17],
        "era_name": row[18],
        "era_years": row[19],
        "series_name": row[20],
        "series_number": row[21],
        "issue_notes": row[22],
        "page_count": row[23],
        "published_date": row[24],
        "isbn_13": row[25],
        "isbn_10": row[26],
        "cover_image_url": row[27],
        "edition_notes": row[28],
        "star_rating": row[29],
        "review": row[30],
        "api_source": row[31],
        "external_work_id": row[32],
        "writers": [{"writer_id": w[0], "writer_name": w[1], "writer_order": w[2]} for w in writers],
        "artists": [{"artist_id": a[0], "artist_name": a[1], "artist_order": a[2]} for a in artists],
        "tags": [{"tag_id": t[0], "tag_name": t[1]} for t in tags],
        "source_series": [{"xref_id": s[0], "source_series_name": s[1], "start_issue": s[2], "end_issue": s[3]} for s in source_series],
    }


# --- ISBN / cover helpers ---

def _normalize_gn_isbn_result(volume: dict) -> dict:
    info = volume.get("volumeInfo", {})
    isbns = {i["type"]: i["identifier"] for i in info.get("industryIdentifiers", [])}
    volume_id = volume.get("id")
    # Use the thumbnail URL from the API response (always publicly accessible cross-origin).
    # The publisher/content endpoint requires authentication and fails in browsers.
    image_links = info.get("imageLinks", {})
    raw = image_links.get("thumbnail") or image_links.get("smallThumbnail")
    if raw:
        cover = raw.replace("http://", "https://")
    elif volume_id:
        cover = f"https://books.google.com/books/content?id={volume_id}&printsec=frontcover&img=1&zoom=1"
    else:
        cover = None
    return {
        "title": info.get("title"),
        "writer_names": info.get("authors", []),
        "publisher_name": info.get("publisher"),
        "isbn_10": isbns.get("ISBN_10"),
        "isbn_13": isbns.get("ISBN_13"),
        "published_date": info.get("publishedDate"),
        "page_count": info.get("pageCount"),
        "description": info.get("description"),
        "cover_image_url": cover,
        "api_source": "google_books",
        "external_work_id": volume.get("id"),
        "_raw": {
            "volumeInfo": info,
            "saleInfo": volume.get("saleInfo"),
            "accessInfo": volume.get("accessInfo"),
        },
    }


def _gn_isbn_from_open_library(isbn: str):
    url = f"https://openlibrary.org/api/books?bibkeys=ISBN:{isbn}&format=json&jscmd=data"
    with urllib.request.urlopen(url, timeout=8) as resp:
        data = json.loads(resp.read())
    entry = data.get(f"ISBN:{isbn}")
    if not entry:
        return None
    isbns = entry.get("identifiers", {})
    cover = entry.get("cover", {})
    authors = [a.get("name", "") for a in entry.get("authors", [])]
    publish_date = entry.get("publish_date", "")
    year_match = _re.search(r"\b(\d{4})\b", publish_date)
    normalized_date = year_match.group(1) if year_match else publish_date or None
    # Use the largest size OL provides; fall back to the direct cover-by-ISBN
    # endpoint (returns a 1px placeholder when no cover exists — filtered at
    # download time by _download_gn_cover).
    cover_url = cover.get("large") or cover.get("medium") or cover.get("small")
    if not cover_url:
        cover_url = f"https://covers.openlibrary.org/b/isbn/{isbn}-L.jpg"
    return {
        "title": entry.get("title"),
        "writer_names": authors,
        "isbn_10": isbns.get("isbn_10", [None])[0],
        "isbn_13": isbns.get("isbn_13", [None])[0],
        "published_date": normalized_date,
        "page_count": entry.get("number_of_pages"),
        "description": None,
        "cover_image_url": cover_url,
        "api_source": "open_library",
        "external_work_id": entry.get("key"),
    }


def _download_gn_cover(url: str, item_id: int) -> Optional[str]:
    """Backwards-compatible wrapper for graphic novel covers."""
    return download_cover(url, "gn", item_id)


def _gn_isbn_from_ol_search(isbn: str):
    """Open Library search.json — broader coverage than the books API endpoint."""
    url = f"https://openlibrary.org/search.json?isbn={isbn}&fields=title,author_name,isbn,cover_i,publish_date,number_of_pages_median,key"
    with urllib.request.urlopen(url, timeout=8) as resp:
        data = json.loads(resp.read())
    docs = data.get("docs", [])
    if not docs:
        return None
    doc = docs[0]
    raw_date = (doc.get("publish_date") or [""])[0]
    year_match = _re.search(r"\b(\d{4})\b", raw_date)
    normalized_date = year_match.group(1) if year_match else raw_date or None
    cover_i = doc.get("cover_i")
    cover_url = f"https://covers.openlibrary.org/b/id/{cover_i}-L.jpg" if cover_i else None
    # Grab any ISBN-13 from the isbn list
    isbn13 = next((i for i in (doc.get("isbn") or []) if len(i) == 13), None)
    isbn10 = next((i for i in (doc.get("isbn") or []) if len(i) == 10), None)
    return {
        "title": doc.get("title"),
        "writer_names": doc.get("author_name") or [],
        "isbn_10": isbn10,
        "isbn_13": isbn13 or isbn,
        "published_date": normalized_date,
        "page_count": doc.get("number_of_pages_median"),
        "description": None,
        "cover_image_url": cover_url,
        "api_source": "open_library",
        "external_work_id": doc.get("key"),
    }


def _gn_isbn_from_oclc(isbn: str):
    """OCLC Classify API — 586M records, no key, returns XML metadata.
    Provides title/author for recent books not yet indexed by Open Library.
    No cover images directly, but returns an OCLC number usable for OL covers."""
    url = f"http://classify.oclc.org/classify2/Classify?isbn={isbn}&summary=true"
    req = urllib.request.Request(url, headers={"User-Agent": "CollectCore/1.0"})
    with urllib.request.urlopen(req, timeout=8) as resp:
        xml_data = resp.read()
    root = ET.fromstring(xml_data)
    ns = {"c": "http://classify.oclc.org/classify2/xsd/classify.xsd"}
    code_el = root.find("c:response", ns)
    code = code_el.get("code") if code_el is not None else None
    if code not in ("0", "2"):  # 0=single match, 2=multiple
        return None
    work_el = root.find("c:work", ns) or root.find(".//c:work", ns)
    if work_el is None:
        return None
    title = work_el.get("title")
    author = work_el.get("author") or work_el.get("authors")
    oclc = work_el.get("oclc")
    # Try OL cover by OCLC number (more reliable than by ISBN for recent books)
    cover_url = f"https://covers.openlibrary.org/b/oclc/{oclc}-L.jpg" if oclc else None
    return {
        "title": title,
        "writer_names": [author] if author else [],
        "isbn_10": None,
        "isbn_13": isbn if len(isbn) == 13 else None,
        "published_date": None,
        "page_count": None,
        "description": None,
        "cover_image_url": cover_url,
        "api_source": "oclc",
        "external_work_id": oclc,
    }


def _gn_from_comic_vine_volume(vol: dict) -> dict:
    """Normalize a Comic Vine volume record to our lookup shape."""
    image = vol.get("image") or {}
    cover = image.get("super_url") or image.get("medium_url") or image.get("small_url")
    pub = vol.get("publisher") or {}
    writers = []
    if vol.get("name"):
        pass  # writers come separately; volume record has creators if fetched with detail
    return {
        "title": vol.get("name"),
        "writer_names": writers,
        "isbn_10": None,
        "isbn_13": None,
        "published_date": vol.get("start_year"),
        "page_count": None,
        "description": vol.get("description") or vol.get("deck"),
        "cover_image_url": cover,
        "api_source": "comic_vine",
        "external_work_id": str(vol.get("id", "")),
        "publisher_name": pub.get("name"),
    }


def _gn_from_comic_vine_isbn(isbn: str) -> list:
    """Search Comic Vine for a volume by ISBN. Comic Vine doesn't have a direct
    ISBN field on volumes, but issues do. We search issues by ISBN and then
    fetch the parent volume for the collected edition metadata."""
    if not COMIC_VINE_API_KEY:
        return []
    headers = {"User-Agent": "CollectCore/1.0"}

    # Comic Vine issue search supports isbn filter (used for collected editions)
    # Try volume search with isbn filter first
    params = urllib.parse.urlencode({
        "api_key": COMIC_VINE_API_KEY,
        "format": "json",
        "filter": f"isbn:{isbn}",
        "field_list": "id,name,image,start_year,description,deck,publisher,count_of_issues",
        "limit": 5,
    })
    url = f"https://comicvine.gamespot.com/api/volumes/?{params}"
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=10) as resp:
        data = json.loads(resp.read())

    results = data.get("results") or []
    if results:
        return [_gn_from_comic_vine_volume(v) for v in results]

    # Comic Vine volume ISBN filter may be empty for some editions.
    # Fall back: search issues by ISBN — issues in CV can have ISBNs for TPBs.
    params2 = urllib.parse.urlencode({
        "api_key": COMIC_VINE_API_KEY,
        "format": "json",
        "filter": f"isbn:{isbn}",
        "field_list": "id,name,image,volume,description,store_date,number_of_pages",
        "limit": 5,
    })
    url2 = f"https://comicvine.gamespot.com/api/issues/?{params2}"
    req2 = urllib.request.Request(url2, headers=headers)
    with urllib.request.urlopen(req2, timeout=10) as resp2:
        data2 = json.loads(resp2.read())

    issues = data2.get("results") or []
    if not issues:
        return []

    # For each matching issue, fetch its parent volume for the cover + metadata
    volumes_seen = set()
    out = []
    for issue in issues:
        vol_stub = issue.get("volume") or {}
        vol_id = vol_stub.get("id")
        if not vol_id or vol_id in volumes_seen:
            continue
        volumes_seen.add(vol_id)
        try:
            vparams = urllib.parse.urlencode({
                "api_key": COMIC_VINE_API_KEY,
                "format": "json",
                "field_list": "id,name,image,start_year,description,deck,publisher,count_of_issues",
            })
            vurl = f"https://comicvine.gamespot.com/api/volume/4050-{vol_id}/?{vparams}"
            vreq = urllib.request.Request(vurl, headers=headers)
            with urllib.request.urlopen(vreq, timeout=10) as vresp:
                vdata = json.loads(vresp.read())
            vol = vdata.get("results") or {}
            if vol:
                r = _gn_from_comic_vine_volume(vol)
                # Use the issue's image if the volume has no cover
                if not r["cover_image_url"]:
                    img = issue.get("image") or {}
                    r["cover_image_url"] = img.get("super_url") or img.get("medium_url")
                # Carry ISBN from the issue
                r["isbn_13"] = isbn if len(isbn) == 13 else None
                r["published_date"] = r["published_date"] or issue.get("store_date", "")[:4] or None
                r["page_count"] = issue.get("number_of_pages")
                out.append(r)
        except Exception:
            continue
    return out


# ---------- Lookup endpoints ----------
# NOTE: specific paths must appear before /{item_id}

@router.get("/publishers")
def get_gn_publishers(db=Depends(get_db)):
    rows = db.execute(text("""
        SELECT publisher_id, publisher_name
        FROM lkup_graphicnovel_publishers
        WHERE is_active = 1
        ORDER BY sort_order, publisher_name
    """)).fetchall()
    return [{"publisher_id": row[0], "publisher_name": row[1]} for row in rows]


@router.post("/publishers")
def create_gn_publisher(payload: GnPublisherCreate, db=Depends(get_db)):
    try:
        existing = db.execute(
            text("SELECT publisher_id FROM lkup_graphicnovel_publishers WHERE LOWER(TRIM(publisher_name)) = LOWER(TRIM(:name))"),
            {"name": payload.publisher_name.strip()},
        ).fetchone()
        if existing:
            raise HTTPException(status_code=409, detail="Publisher already exists.")
        result = db.execute(
            text("INSERT INTO lkup_graphicnovel_publishers (publisher_name) VALUES (:name) RETURNING publisher_id"),
            {"name": payload.publisher_name.strip()},
        ).fetchone()
        db.commit()
        return {"publisher_id": result[0], "publisher_name": payload.publisher_name.strip()}
    except HTTPException:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise


@router.get("/format-types")
def get_gn_format_types(db=Depends(get_db)):
    rows = db.execute(text("""
        SELECT format_type_id, format_type_name
        FROM lkup_graphicnovel_format_types
        WHERE is_active = 1
        ORDER BY sort_order, format_type_name
    """)).fetchall()
    return [{"format_type_id": row[0], "format_type_name": row[1]} for row in rows]


@router.get("/eras")
def get_gn_eras(db=Depends(get_db)):
    rows = db.execute(text("""
        SELECT era_id, era_name, era_years
        FROM lkup_graphicnovel_eras
        WHERE is_active = 1
        ORDER BY sort_order
    """)).fetchall()
    return [{"era_id": row[0], "era_name": row[1], "era_years": row[2]} for row in rows]


@router.get("/writers")
def get_gn_writers(q: Optional[str] = None, db=Depends(get_db)):
    if q:
        rows = db.execute(
            text("""
                SELECT writer_id, writer_name
                FROM lkup_graphicnovel_writers
                WHERE is_active = 1 AND LOWER(writer_name) LIKE LOWER(:q)
                ORDER BY writer_name
                LIMIT 20
            """),
            {"q": f"%{q}%"},
        ).fetchall()
    else:
        rows = db.execute(text("""
            SELECT writer_id, writer_name
            FROM lkup_graphicnovel_writers
            WHERE is_active = 1
            ORDER BY writer_name
        """)).fetchall()
    return [{"writer_id": row[0], "writer_name": row[1]} for row in rows]


@router.get("/artists")
def get_gn_artists(q: Optional[str] = None, db=Depends(get_db)):
    if q:
        rows = db.execute(
            text("""
                SELECT artist_id, artist_name
                FROM lkup_graphicnovel_artists
                WHERE is_active = 1 AND LOWER(artist_name) LIKE LOWER(:q)
                ORDER BY artist_name
                LIMIT 20
            """),
            {"q": f"%{q}%"},
        ).fetchall()
    else:
        rows = db.execute(text("""
            SELECT artist_id, artist_name
            FROM lkup_graphicnovel_artists
            WHERE is_active = 1
            ORDER BY artist_name
        """)).fetchall()
    return [{"artist_id": row[0], "artist_name": row[1]} for row in rows]


@router.get("/tags")
def get_gn_tags(q: Optional[str] = None, db=Depends(get_db)):
    if q:
        rows = db.execute(
            text("""
                SELECT tag_id, tag_name
                FROM lkup_graphicnovel_tags
                WHERE is_active = 1 AND LOWER(tag_name) LIKE LOWER(:q)
                ORDER BY tag_name
                LIMIT 20
            """),
            {"q": f"%{q}%"},
        ).fetchall()
    else:
        rows = db.execute(text("""
            SELECT tag_id, tag_name
            FROM lkup_graphicnovel_tags
            WHERE is_active = 1
            ORDER BY tag_name
        """)).fetchall()
    return [{"tag_id": row[0], "tag_name": row[1]} for row in rows]


# --- ISBN lookup for graphic novels ---

@router.get("/lookup-isbn")
def gn_lookup_isbn(isbn: str = Query(..., min_length=10), source: str = Query("all")):
    # source="google" skips Comic Vine and only queries Google Books.
    # source="all" (default) tries all sources in priority order.

    if source != "google":
        # 1. Comic Vine — purpose-built for comics, best coverage of trades/omnibuses
        if COMIC_VINE_API_KEY:
            try:
                cv_results = _gn_from_comic_vine_isbn(isbn)
                if cv_results:
                    return cv_results
            except Exception:
                pass

    # 2. Google Books — good general fallback with covers
    try:
        items = google_books_lookup_isbn(isbn, max_results=5)
        if items:
            return [_normalize_gn_isbn_result(v) for v in items]
    except Exception:
        pass

    if source == "google":
        return []

    # 3. Open Library search.json
    try:
        r = _gn_isbn_from_ol_search(isbn)
        if r:
            return [r]
    except Exception:
        pass

    # 4. Open Library books API
    try:
        r = _gn_isbn_from_open_library(isbn)
        if r:
            return [r]
    except Exception:
        pass

    # 5. OCLC Classify — metadata only, no covers, but broad coverage
    try:
        r = _gn_isbn_from_oclc(isbn)
        if r:
            return [r]
    except Exception:
        pass

    return []


@router.get("/search-external")
def gn_search_external(q: str = Query(..., min_length=1), source: str = Query("comicvine")):
    headers = {"User-Agent": "CollectCore/1.0"}

    if source == "comicvine":
        if not COMIC_VINE_API_KEY:
            raise HTTPException(status_code=400, detail="Comic Vine API key not configured.")
        try:
            params = urllib.parse.urlencode({
                "api_key": COMIC_VINE_API_KEY,
                "format": "json",
                "query": q,
                "resources": "volume",
                "field_list": "id,name,image,start_year,description,deck,publisher,count_of_issues",
                "limit": 50,
            })
            req = urllib.request.Request(f"https://comicvine.gamespot.com/api/search/?{params}", headers=headers)
            with urllib.request.urlopen(req, timeout=8) as resp:
                data = json.loads(resp.read())
            return [_gn_from_comic_vine_volume(v) for v in (data.get("results") or [])]
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"Comic Vine search failed: {e}")

    else:  # google
        try:
            items = google_books_search(q, max_results=40)
            return [_normalize_gn_isbn_result(v) for v in items]
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"Google Books search failed: {e}")


# --- Graphic Novels CRUD ---

@router.get("")
def list_graphicnovels(db=Depends(get_db)):
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
                gd.title,
                gd.title_sort,
                gd.series_name,
                gd.series_number,
                gd.publisher_id,
                pub.publisher_name,
                gd.format_type_id,
                ft.format_type_name,
                gd.era_id,
                era.era_name,
                gd.issue_notes,
                gd.page_count,
                gd.cover_image_url,
                gd.isbn_13,
                gd.star_rating,
                gd.edition_notes,
                (SELECT GROUP_CONCAT(lw.writer_name, ', ')
                 FROM xref_graphicnovel_item_writers xw
                 JOIN lkup_graphicnovel_writers lw ON xw.writer_id = lw.writer_id
                 WHERE xw.item_id = i.item_id
                 ORDER BY xw.writer_order) AS writers_str,
                (SELECT GROUP_CONCAT(la.artist_name, ', ')
                 FROM xref_graphicnovel_item_artists xa
                 JOIN lkup_graphicnovel_artists la ON xa.artist_id = la.artist_id
                 WHERE xa.item_id = i.item_id
                 ORDER BY xa.artist_order) AS artists_str,
                (SELECT GROUP_CONCAT(lt.tag_name, '|||')
                 FROM xref_graphicnovel_item_tags xt
                 JOIN lkup_graphicnovel_tags lt ON xt.tag_id = lt.tag_id
                 WHERE xt.item_id = i.item_id) AS tags_str,
                (SELECT GROUP_CONCAT(ss.source_series_name || '|||' || COALESCE(ss.start_issue, '') || '|||' || COALESCE(ss.end_issue, ''), '~|~')
                 FROM xref_gn_source_series ss
                 WHERE ss.item_id = i.item_id
                 ORDER BY ss.sort_order) AS source_series_str
            FROM tbl_items i
            JOIN tbl_graphicnovel_details gd ON i.item_id = gd.item_id
            JOIN lkup_top_level_categories c ON i.top_level_category_id = c.top_level_category_id
            JOIN lkup_ownership_statuses os ON i.ownership_status_id = os.ownership_status_id
            LEFT JOIN lkup_consumption_statuses rs ON i.reading_status_id = rs.read_status_id
            LEFT JOIN lkup_graphicnovel_publishers pub ON gd.publisher_id = pub.publisher_id
            LEFT JOIN lkup_graphicnovel_format_types ft ON gd.format_type_id = ft.format_type_id
            LEFT JOIN lkup_graphicnovel_eras era ON gd.era_id = era.era_id
            WHERE i.collection_type_id = :ct
            ORDER BY COALESCE(gd.title_sort, gd.title)
        """),
        {"ct": GN_COLLECTION_TYPE_ID},
    ).fetchall()

    def parse_tag_list(s):
        if not s:
            return []
        seen = set()
        out = []
        for v in s.split("|||"):
            if v not in seen:
                seen.add(v)
                out.append(v)
        return out

    def parse_source_series(s):
        if not s:
            return []
        result = []
        for chunk in s.split("~|~"):
            parts = chunk.split("|||")
            if len(parts) >= 1 and parts[0]:
                result.append({
                    "source_series_name": parts[0],
                    "start_issue": int(parts[1]) if len(parts) > 1 and parts[1] else None,
                    "end_issue": int(parts[2]) if len(parts) > 2 and parts[2] else None,
                })
        return result

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
            "series_name": row[10],
            "series_number": row[11],
            "publisher_id": row[12],
            "publisher_name": row[13],
            "format_type_id": row[14],
            "format_type_name": row[15],
            "era_id": row[16],
            "era_name": row[17],
            "issue_notes": row[18],
            "page_count": row[19],
            "cover_image_url": row[20],
            "isbn_13": row[21],
            "star_rating": row[22],
            "edition_notes": row[23],
            "writers": row[24].split(", ") if row[24] else [],
            "artists": row[25].split(", ") if row[25] else [],
            "tags": parse_tag_list(row[26]),
            "source_series": parse_source_series(row[27]),
        }
        for row in rows
    ]


@router.get("/{item_id}")
def get_graphicnovel(item_id: int, db=Depends(get_db)):
    gn = _get_gn_detail(db, item_id)
    if not gn:
        raise HTTPException(status_code=404, detail="Graphic novel not found.")
    return gn


@router.post("")
def create_graphicnovel(payload: GraphicNovelCreate, db=Depends(get_db)):
    try:
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
                "ct": GN_COLLECTION_TYPE_ID,
                "cat": payload.top_level_category_id,
                "own": payload.ownership_status_id,
                "rs": payload.reading_status_id,
                "notes": payload.notes,
            },
        ).fetchone()
        item_id = item_result[0]

        db.execute(
            text("""
                INSERT INTO tbl_graphicnovel_details (
                    item_id, title, title_sort, description,
                    publisher_id, format_type_id, era_id,
                    series_name, series_number, series_sort,
                    issue_notes, page_count, published_date, isbn_13, isbn_10,
                    cover_image_url, edition_notes, star_rating, review,
                    api_source, external_work_id
                ) VALUES (
                    :item_id, :title, :title_sort, :description,
                    :publisher_id, :format_type_id, :era_id,
                    :series_name, :series_number, :series_sort,
                    :issue_notes, :page_count, :published_date, :isbn_13, :isbn_10,
                    :cover_image_url, :edition_notes, :star_rating, :review,
                    :api_source, :external_work_id
                )
            """),
            {
                "item_id": item_id,
                "title": payload.title.strip(),
                "title_sort": make_title_sort(payload.title.strip()),
                "description": payload.description,
                "publisher_id": payload.publisher_id,
                "format_type_id": payload.format_type_id,
                "era_id": payload.era_id,
                "series_name": payload.series_name,
                "series_number": payload.series_number,
                "series_sort": payload.series_number,
                "issue_notes": payload.issue_notes,
                "page_count": payload.page_count,
                "published_date": payload.published_date,
                "isbn_13": payload.isbn_13,
                "isbn_10": payload.isbn_10,
                "cover_image_url": payload.cover_image_url,
                "edition_notes": payload.edition_notes,
                "star_rating": payload.star_rating,
                "review": payload.review,
                "api_source": payload.api_source,
                "external_work_id": payload.external_work_id,
            },
        )

        _insert_gn_relationships(db, item_id, payload)

        # Download cover and save locally so the URL never goes stale
        if payload.cover_image_url:
            local_cover = _download_gn_cover(payload.cover_image_url, item_id)
            if local_cover:
                db.execute(
                    text("UPDATE tbl_graphicnovel_details SET cover_image_url = :url WHERE item_id = :id"),
                    {"url": local_cover, "id": item_id},
                )

        db.commit()

        gn = _get_gn_detail(db, item_id)
        return {"item_id": item_id, "status": "created", "graphicnovel": gn}

    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        if "ux_graphicnovel_details_isbn13" in str(e):
            raise HTTPException(status_code=409, detail="A graphic novel with that ISBN-13 already exists.")
        raise


@router.put("/{item_id}")
def update_graphicnovel(item_id: int, payload: GraphicNovelUpdate, db=Depends(get_db)):
    try:
        existing = db.execute(
            text("SELECT item_id FROM tbl_items WHERE item_id = :id AND collection_type_id = :ct"),
            {"id": item_id, "ct": GN_COLLECTION_TYPE_ID},
        ).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Graphic novel not found.")

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
                UPDATE tbl_graphicnovel_details
                SET title = :title,
                    title_sort = :title_sort,
                    description = :description,
                    publisher_id = :publisher_id,
                    format_type_id = :format_type_id,
                    era_id = :era_id,
                    series_name = :series_name,
                    series_number = :series_number,
                    series_sort = :series_sort,
                    issue_notes = :issue_notes,
                    page_count = :page_count,
                    published_date = :published_date,
                    isbn_13 = :isbn_13,
                    isbn_10 = :isbn_10,
                    cover_image_url = :cover_image_url,
                    edition_notes = :edition_notes,
                    star_rating = :star_rating,
                    review = :review,
                    api_source = :api_source,
                    external_work_id = :external_work_id
                WHERE item_id = :id
            """),
            {
                "id": item_id,
                "title": payload.title.strip(),
                "title_sort": make_title_sort(payload.title.strip()),
                "description": payload.description,
                "publisher_id": payload.publisher_id,
                "format_type_id": payload.format_type_id,
                "era_id": payload.era_id,
                "series_name": payload.series_name,
                "series_number": payload.series_number,
                "series_sort": payload.series_number,
                "issue_notes": payload.issue_notes,
                "page_count": payload.page_count,
                "published_date": payload.published_date,
                "isbn_13": payload.isbn_13,
                "isbn_10": payload.isbn_10,
                "cover_image_url": payload.cover_image_url,
                "edition_notes": payload.edition_notes,
                "star_rating": payload.star_rating,
                "review": payload.review,
                "api_source": payload.api_source,
                "external_work_id": payload.external_work_id,
            },
        )

        db.execute(text("DELETE FROM xref_graphicnovel_item_writers WHERE item_id = :id"), {"id": item_id})
        db.execute(text("DELETE FROM xref_graphicnovel_item_artists WHERE item_id = :id"), {"id": item_id})
        db.execute(text("DELETE FROM xref_graphicnovel_item_tags WHERE item_id = :id"), {"id": item_id})
        db.execute(text("DELETE FROM xref_gn_source_series WHERE item_id = :id"), {"id": item_id})
        _insert_gn_relationships(db, item_id, payload)

        # Download cover locally if an external URL was provided
        if payload.cover_image_url and not payload.cover_image_url.startswith("/images/"):
            local_cover = _download_gn_cover(payload.cover_image_url, item_id)
            if local_cover:
                db.execute(
                    text("UPDATE tbl_graphicnovel_details SET cover_image_url = :url WHERE item_id = :id"),
                    {"url": local_cover, "id": item_id},
                )

        db.commit()

        gn = _get_gn_detail(db, item_id)
        return {"item_id": item_id, "status": "updated", "graphicnovel": gn}

    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        if "ux_graphicnovel_details_isbn13" in str(e):
            raise HTTPException(status_code=409, detail="A graphic novel with that ISBN-13 already exists.")
        raise


@router.post("/fix-covers")
def gn_fix_covers(db=Depends(get_db)):
    """Re-download any covers stored as external URLs (http/https) to local storage."""
    try:
        rows = db.execute(text("""
            SELECT item_id, cover_image_url, api_source, external_work_id
            FROM tbl_graphicnovel_details
            WHERE cover_image_url IS NOT NULL
              AND cover_image_url NOT LIKE '/images/%'
        """)).fetchall()

        fixed, failed = 0, []
        for item_id, cover_url, api_source, external_work_id in rows:
            local_cover = None

            # For Google Books: re-fetch the thumbnail URL via the volume API
            if api_source == "google_books" and external_work_id:
                try:
                    vol = google_books_get_volume(external_work_id)
                    info = vol.get("volumeInfo", {})
                    image_links = info.get("imageLinks", {})
                    raw = image_links.get("thumbnail") or image_links.get("smallThumbnail")
                    if raw:
                        fresh_url = raw.replace("http://", "https://")
                        local_cover = _download_gn_cover(fresh_url, item_id)
                except Exception:
                    pass

            # Fallback: try the stored URL directly (works for Open Library etc.)
            if not local_cover and cover_url:
                local_cover = _download_gn_cover(cover_url, item_id)

            if local_cover:
                db.execute(
                    text("UPDATE tbl_graphicnovel_details SET cover_image_url = :url WHERE item_id = :id"),
                    {"url": local_cover, "id": item_id},
                )
                fixed += 1
            else:
                failed.append(item_id)

        db.commit()
        return {"fixed": fixed, "failed": failed}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{item_id}")
def delete_graphicnovel(item_id: int, db=Depends(get_db)):
    try:
        existing = db.execute(
            text("SELECT item_id FROM tbl_items WHERE item_id = :id AND collection_type_id = :ct"),
            {"id": item_id, "ct": GN_COLLECTION_TYPE_ID},
        ).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Graphic novel not found.")

        files_to_delete = delete_attachment_files(db, item_id)
        files_to_delete.extend(collect_cover_file(db, "tbl_graphicnovel_details", item_id))
        db.execute(text("DELETE FROM xref_graphicnovel_item_writers WHERE item_id = :id"), {"id": item_id})
        db.execute(text("DELETE FROM xref_graphicnovel_item_artists WHERE item_id = :id"), {"id": item_id})
        db.execute(text("DELETE FROM xref_graphicnovel_item_tags WHERE item_id = :id"), {"id": item_id})
        db.execute(text("DELETE FROM tbl_attachments WHERE item_id = :id"), {"id": item_id})
        db.execute(text("DELETE FROM tbl_graphicnovel_details WHERE item_id = :id"), {"id": item_id})
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
def bulk_update_graphicnovels(payload: GnBulkUpdatePayload, db=Depends(get_db)):
    if not payload.item_ids:
        raise HTTPException(status_code=400, detail="item_ids cannot be empty.")

    try:
        placeholders = ",".join(str(i) for i in payload.item_ids)
        found = db.execute(
            text(f"SELECT item_id FROM tbl_items WHERE item_id IN ({placeholders}) AND collection_type_id = :ct"),
            {"ct": GN_COLLECTION_TYPE_ID},
        ).fetchall()
        if len(found) != len(payload.item_ids):
            raise HTTPException(status_code=404, detail="One or more item_ids not found.")

        f = payload.fields

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

        detail_updates = []
        detail_params = {}
        if f.format_type_id is not None:
            detail_updates.append("format_type_id = :format_type_id")
            detail_params["format_type_id"] = f.format_type_id
        if f.era_id is not None:
            detail_updates.append("era_id = :era_id")
            detail_params["era_id"] = f.era_id
        if f.publisher_id is not None:
            detail_updates.append("publisher_id = :publisher_id")
            detail_params["publisher_id"] = f.publisher_id
        if f.star_rating is not None:
            detail_updates.append("star_rating = :star_rating")
            detail_params["star_rating"] = f.star_rating

        if detail_updates:
            for item_id in payload.item_ids:
                db.execute(
                    text(f"UPDATE tbl_graphicnovel_details SET {', '.join(detail_updates)} WHERE item_id = :item_id"),
                    {**detail_params, "item_id": item_id},
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
def bulk_delete_graphicnovels(payload: BulkDeletePayload, db=Depends(get_db)):
    if not payload.item_ids:
        raise HTTPException(status_code=400, detail="item_ids cannot be empty.")

    try:
        placeholders = ",".join(str(i) for i in payload.item_ids)
        found = db.execute(
            text(f"SELECT item_id FROM tbl_items WHERE item_id IN ({placeholders}) AND collection_type_id = :ct"),
            {"ct": GN_COLLECTION_TYPE_ID},
        ).fetchall()
        if len(found) != len(payload.item_ids):
            raise HTTPException(status_code=404, detail="One or more item_ids not found.")

        all_files = []
        for item_id in payload.item_ids:
            all_files.extend(delete_attachment_files(db, item_id))
            all_files.extend(collect_cover_file(db, "tbl_graphicnovel_details", item_id))
            db.execute(text("DELETE FROM xref_graphicnovel_item_writers WHERE item_id = :id"), {"id": item_id})
            db.execute(text("DELETE FROM xref_graphicnovel_item_artists WHERE item_id = :id"), {"id": item_id})
            db.execute(text("DELETE FROM xref_graphicnovel_item_tags WHERE item_id = :id"), {"id": item_id})
            db.execute(text("DELETE FROM tbl_attachments WHERE item_id = :id"), {"id": item_id})
            db.execute(text("DELETE FROM tbl_graphicnovel_details WHERE item_id = :id"), {"id": item_id})
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
