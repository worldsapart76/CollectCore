from pydantic import BaseModel
from typing import List, Optional


class MusicSongEntry(BaseModel):
    song_id: Optional[int] = None  # present on update
    title: str
    duration_seconds: Optional[int] = None
    track_number: Optional[int] = None
    disc_number: int = 1


class MusicEditionEntry(BaseModel):
    edition_id: Optional[int] = None  # present on update
    format_type_id: Optional[int] = None
    version_name: Optional[str] = None
    label: Optional[str] = None
    catalog_number: Optional[str] = None
    barcode: Optional[str] = None
    notes: Optional[str] = None
    ownership_status_id: Optional[int] = None


class MusicReleaseCreate(BaseModel):
    title: str
    top_level_category_id: int  # release type (Album, EP, Single, etc.)
    ownership_status_id: int
    release_date: Optional[str] = None
    description: Optional[str] = None
    cover_image_url: Optional[str] = None
    notes: Optional[str] = None
    api_source: Optional[str] = None
    external_work_id: Optional[str] = None
    artist_names: List[str] = []
    genres: List[dict] = []
    songs: List[MusicSongEntry] = []
    editions: List[MusicEditionEntry] = []


class MusicReleaseUpdate(BaseModel):
    title: Optional[str] = None
    top_level_category_id: Optional[int] = None
    ownership_status_id: Optional[int] = None
    release_date: Optional[str] = None
    description: Optional[str] = None
    cover_image_url: Optional[str] = None
    notes: Optional[str] = None
    api_source: Optional[str] = None
    external_work_id: Optional[str] = None
    artist_names: Optional[List[str]] = None
    genres: Optional[List[dict]] = None
    songs: Optional[List[MusicSongEntry]] = None
    editions: Optional[List[MusicEditionEntry]] = None


class MusicBulkUpdateFields(BaseModel):
    ownership_status_id: Optional[int] = None
    top_level_category_id: Optional[int] = None


class MusicBulkUpdatePayload(BaseModel):
    item_ids: List[int]
    fields: MusicBulkUpdateFields
