from pydantic import BaseModel
from typing import List, Optional


class BookGenreInput(BaseModel):
    top_level_genre_id: int
    sub_genre_id: Optional[int] = None


class BookBulkUpdateFields(BaseModel):
    ownership_status_id: Optional[int] = None
    reading_status_id: Optional[int] = None
    top_level_category_id: Optional[int] = None
    age_level_id: Optional[int] = None
    star_rating: Optional[float] = None
    format_detail_id: Optional[int] = None
    genres: Optional[List[BookGenreInput]] = None


class BookBulkUpdatePayload(BaseModel):
    item_ids: List[int]
    fields: BookBulkUpdateFields


class BookCreate(BaseModel):
    top_level_category_id: int
    ownership_status_id: int
    reading_status_id: Optional[int] = None
    notes: Optional[str] = None
    title: str
    description: Optional[str] = None
    age_level_id: Optional[int] = None
    star_rating: Optional[float] = None
    review: Optional[str] = None
    api_categories_raw: Optional[str] = None
    author_names: List[str]
    series_name: Optional[str] = None
    series_number: Optional[float] = None
    genres: Optional[List[BookGenreInput]] = None
    tag_names: Optional[List[str]] = None
    format_detail_id: Optional[int] = None
    isbn_13: Optional[str] = None
    isbn_10: Optional[str] = None
    publisher: Optional[str] = None
    published_date: Optional[str] = None
    page_count: Optional[int] = None
    language: Optional[str] = "en"
    cover_image_url: Optional[str] = None
    api_source: Optional[str] = None
    external_work_id: Optional[str] = None


class BookUpdate(BaseModel):
    top_level_category_id: int
    ownership_status_id: int
    reading_status_id: Optional[int] = None
    notes: Optional[str] = None
    title: str
    description: Optional[str] = None
    age_level_id: Optional[int] = None
    star_rating: Optional[float] = None
    review: Optional[str] = None
    api_categories_raw: Optional[str] = None
    author_names: List[str]
    series_name: Optional[str] = None
    series_number: Optional[float] = None
    genres: Optional[List[BookGenreInput]] = None
    tag_names: Optional[List[str]] = None
    format_detail_id: Optional[int] = None
    isbn_13: Optional[str] = None
    isbn_10: Optional[str] = None
    publisher: Optional[str] = None
    published_date: Optional[str] = None
    page_count: Optional[int] = None
    language: Optional[str] = "en"
    cover_image_url: Optional[str] = None
    api_source: Optional[str] = None
    external_work_id: Optional[str] = None
