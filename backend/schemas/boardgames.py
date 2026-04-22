from pydantic import BaseModel
from typing import List, Optional


class BoardgameExpansionEntry(BaseModel):
    expansion_id: Optional[int] = None
    title: str
    year_published: Optional[int] = None
    ownership_status_id: Optional[int] = None
    external_work_id: Optional[str] = None


class BoardgameCreate(BaseModel):
    top_level_category_id: int
    ownership_status_id: int
    notes: Optional[str] = None
    title: str
    description: Optional[str] = None
    year_published: Optional[int] = None
    min_players: Optional[int] = None
    max_players: Optional[int] = None
    publisher_name: Optional[str] = None
    designer_names: Optional[List[str]] = None
    expansions: Optional[List[BoardgameExpansionEntry]] = None
    cover_image_url: Optional[str] = None
    api_source: Optional[str] = None
    external_work_id: Optional[str] = None


class BoardgameUpdate(BaseModel):
    top_level_category_id: int
    ownership_status_id: int
    notes: Optional[str] = None
    title: str
    description: Optional[str] = None
    year_published: Optional[int] = None
    min_players: Optional[int] = None
    max_players: Optional[int] = None
    publisher_name: Optional[str] = None
    designer_names: Optional[List[str]] = None
    expansions: Optional[List[BoardgameExpansionEntry]] = None
    cover_image_url: Optional[str] = None
    api_source: Optional[str] = None
    external_work_id: Optional[str] = None


class BoardgameBulkUpdateFields(BaseModel):
    ownership_status_id: Optional[int] = None
    top_level_category_id: Optional[int] = None


class BoardgameBulkUpdatePayload(BaseModel):
    item_ids: List[int]
    fields: BoardgameBulkUpdateFields
