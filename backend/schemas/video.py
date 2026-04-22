from pydantic import BaseModel
from typing import List, Optional


class VideoCopyEntry(BaseModel):
    copy_id: Optional[int] = None
    format_type_id: Optional[int] = None
    ownership_status_id: Optional[int] = None
    notes: Optional[str] = None


class VideoSeasonEntry(BaseModel):
    season_id: Optional[int] = None
    season_number: int
    episode_count: Optional[int] = None
    format_type_id: Optional[int] = None
    ownership_status_id: Optional[int] = None
    notes: Optional[str] = None


class VideoCreate(BaseModel):
    title: str
    top_level_category_id: int  # Movie, TV Series, Miniseries, Concert/Live
    ownership_status_id: int
    reading_status_id: Optional[int] = None  # watch status
    release_date: Optional[str] = None
    runtime_minutes: Optional[int] = None
    description: Optional[str] = None
    cover_image_url: Optional[str] = None
    notes: Optional[str] = None
    api_source: Optional[str] = None
    external_work_id: Optional[str] = None  # TMDB ID
    director_names: List[str] = []
    cast_names: List[str] = []
    genres: List[dict] = []
    copies: List[VideoCopyEntry] = []    # for Movie/Miniseries/Concert
    seasons: List[VideoSeasonEntry] = []  # for TV Series


class VideoUpdate(BaseModel):
    title: Optional[str] = None
    top_level_category_id: Optional[int] = None
    ownership_status_id: Optional[int] = None
    reading_status_id: Optional[int] = None
    release_date: Optional[str] = None
    runtime_minutes: Optional[int] = None
    description: Optional[str] = None
    cover_image_url: Optional[str] = None
    notes: Optional[str] = None
    api_source: Optional[str] = None
    external_work_id: Optional[str] = None
    director_names: Optional[List[str]] = None
    cast_names: Optional[List[str]] = None
    genres: Optional[List[dict]] = None
    copies: Optional[List[VideoCopyEntry]] = None
    seasons: Optional[List[VideoSeasonEntry]] = None


class VideoBulkUpdateFields(BaseModel):
    ownership_status_id: Optional[int] = None
    reading_status_id: Optional[int] = None
    top_level_category_id: Optional[int] = None


class VideoBulkUpdatePayload(BaseModel):
    item_ids: List[int]
    fields: VideoBulkUpdateFields
