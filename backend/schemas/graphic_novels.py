from pydantic import BaseModel
from typing import List, Optional


class GnBulkUpdateFields(BaseModel):
    ownership_status_id: Optional[int] = None
    reading_status_id: Optional[int] = None
    top_level_category_id: Optional[int] = None
    format_type_id: Optional[int] = None
    era_id: Optional[int] = None
    publisher_id: Optional[int] = None
    star_rating: Optional[float] = None


class GnBulkUpdatePayload(BaseModel):
    item_ids: List[int]
    fields: GnBulkUpdateFields


class GnSourceSeriesEntry(BaseModel):
    source_series_name: str
    start_issue: Optional[int] = None
    end_issue: Optional[int] = None


class GraphicNovelCreate(BaseModel):
    top_level_category_id: int
    ownership_status_id: int
    reading_status_id: Optional[int] = None
    notes: Optional[str] = None
    title: str
    description: Optional[str] = None
    publisher_id: Optional[int] = None
    format_type_id: Optional[int] = None
    era_id: Optional[int] = None
    series_name: Optional[str] = None
    series_number: Optional[float] = None
    source_series: Optional[List[GnSourceSeriesEntry]] = None
    issue_notes: Optional[str] = None
    page_count: Optional[int] = None
    published_date: Optional[str] = None
    isbn_13: Optional[str] = None
    isbn_10: Optional[str] = None
    cover_image_url: Optional[str] = None
    edition_notes: Optional[str] = None
    star_rating: Optional[float] = None
    review: Optional[str] = None
    writer_names: Optional[List[str]] = None
    artist_names: Optional[List[str]] = None
    tag_names: Optional[List[str]] = None
    api_source: Optional[str] = None
    external_work_id: Optional[str] = None


class GraphicNovelUpdate(BaseModel):
    top_level_category_id: int
    ownership_status_id: int
    reading_status_id: Optional[int] = None
    notes: Optional[str] = None
    title: str
    description: Optional[str] = None
    publisher_id: Optional[int] = None
    format_type_id: Optional[int] = None
    era_id: Optional[int] = None
    series_name: Optional[str] = None
    series_number: Optional[float] = None
    source_series: Optional[List[GnSourceSeriesEntry]] = None
    issue_notes: Optional[str] = None
    page_count: Optional[int] = None
    published_date: Optional[str] = None
    isbn_13: Optional[str] = None
    isbn_10: Optional[str] = None
    cover_image_url: Optional[str] = None
    edition_notes: Optional[str] = None
    star_rating: Optional[float] = None
    review: Optional[str] = None
    writer_names: Optional[List[str]] = None
    artist_names: Optional[List[str]] = None
    tag_names: Optional[List[str]] = None
    api_source: Optional[str] = None
    external_work_id: Optional[str] = None


class GnPublisherCreate(BaseModel):
    publisher_name: str
