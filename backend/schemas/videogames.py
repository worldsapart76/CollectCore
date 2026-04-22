from pydantic import BaseModel
from typing import List, Optional


class GameGenreEntry(BaseModel):
    top_genre_id: int
    sub_genre_id: Optional[int] = None


class GameCopyInput(BaseModel):
    platform_id: Optional[int] = None
    edition: Optional[str] = None
    ownership_status_id: Optional[int] = None
    notes: Optional[str] = None


class VideoGameCreate(BaseModel):
    ownership_status_id: int
    play_status_id: Optional[int] = None
    notes: Optional[str] = None
    title: str
    description: Optional[str] = None
    release_date: Optional[str] = None
    cover_image_url: Optional[str] = None
    developer_names: Optional[List[str]] = None
    publisher_names: Optional[List[str]] = None
    genres: Optional[List[GameGenreEntry]] = None
    copies: Optional[List[GameCopyInput]] = None
    api_source: Optional[str] = None
    external_work_id: Optional[str] = None


class VideoGameUpdate(BaseModel):
    ownership_status_id: int
    play_status_id: Optional[int] = None
    notes: Optional[str] = None
    title: str
    description: Optional[str] = None
    release_date: Optional[str] = None
    cover_image_url: Optional[str] = None
    developer_names: Optional[List[str]] = None
    publisher_names: Optional[List[str]] = None
    genres: Optional[List[GameGenreEntry]] = None
    copies: Optional[List[GameCopyInput]] = None
    api_source: Optional[str] = None
    external_work_id: Optional[str] = None


class GameBulkUpdateFields(BaseModel):
    ownership_status_id: Optional[int] = None
    play_status_id: Optional[int] = None


class GameBulkUpdatePayload(BaseModel):
    item_ids: List[int]
    fields: GameBulkUpdateFields
