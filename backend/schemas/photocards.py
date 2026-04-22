from typing import List, Optional

from pydantic import BaseModel


class SourceOriginCreate(BaseModel):
    group_id: int
    top_level_category_id: int
    source_origin_name: str


class PhotocardCreate(BaseModel):
    collection_type_id: int
    top_level_category_id: int
    ownership_status_id: int
    notes: Optional[str] = None
    group_id: int
    source_origin_id: Optional[int] = None
    version: Optional[str] = None
    member_ids: List[int]
    is_special: bool = False


class PhotocardUpdate(BaseModel):
    top_level_category_id: int
    source_origin_id: Optional[int] = None
    version: Optional[str] = None
    member_ids: List[int]
    is_special: bool = False


class BulkUpdateFields(BaseModel):
    ownership_status_id: Optional[int] = None
    notes: Optional[str] = None
    notes_action: Optional[str] = None  # "set" | "append" | "clear"
    source_origin_id: Optional[int] = None
    version: Optional[str] = None
    member_ids: Optional[List[int]] = None
    top_level_category_id: Optional[int] = None
    is_special: Optional[bool] = None


class BulkUpdatePayload(BaseModel):
    item_ids: List[int]
    fields: BulkUpdateFields


class BulkDeletePayload(BaseModel):
    item_ids: List[int]


class PhotocardCopyCreate(BaseModel):
    ownership_status_id: int
    notes: Optional[str] = None


class PhotocardCopyUpdate(BaseModel):
    ownership_status_id: int
    notes: Optional[str] = None
