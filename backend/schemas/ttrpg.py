from pydantic import BaseModel
from typing import List, Optional


class TTRPGCopyEntry(BaseModel):
    copy_id: Optional[int] = None
    format_type_id: Optional[int] = None
    isbn_13: Optional[str] = None
    isbn_10: Optional[str] = None
    ownership_status_id: Optional[int] = None
    notes: Optional[str] = None


class TTRPGCreate(BaseModel):
    top_level_category_id: int
    ownership_status_id: int
    notes: Optional[str] = None
    title: str
    description: Optional[str] = None
    system_edition_name: Optional[str] = None
    line_name: Optional[str] = None
    book_type_id: Optional[int] = None
    publisher_name: Optional[str] = None
    author_names: Optional[List[str]] = None
    release_date: Optional[str] = None
    cover_image_url: Optional[str] = None
    api_source: Optional[str] = None
    external_work_id: Optional[str] = None
    copies: Optional[List[TTRPGCopyEntry]] = None


class TTRPGUpdate(BaseModel):
    top_level_category_id: int
    ownership_status_id: int
    notes: Optional[str] = None
    title: str
    description: Optional[str] = None
    system_edition_name: Optional[str] = None
    line_name: Optional[str] = None
    book_type_id: Optional[int] = None
    publisher_name: Optional[str] = None
    author_names: Optional[List[str]] = None
    release_date: Optional[str] = None
    cover_image_url: Optional[str] = None
    api_source: Optional[str] = None
    external_work_id: Optional[str] = None
    copies: Optional[List[TTRPGCopyEntry]] = None


class TTRPGBulkUpdateFields(BaseModel):
    ownership_status_id: Optional[int] = None
    top_level_category_id: Optional[int] = None


class TTRPGBulkUpdatePayload(BaseModel):
    item_ids: List[int]
    fields: TTRPGBulkUpdateFields
