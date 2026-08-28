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
    # 0 = unprice (delete the pricing row), matching the source_origin_id > 0
    # sentinel convention already used by bulk_update_photocards.
    price_tier_id: Optional[int] = None


class BulkUpdatePayload(BaseModel):
    item_ids: List[int]
    fields: BulkUpdateFields


class BulkDeletePayload(BaseModel):
    item_ids: List[int]


class PriceTierCreate(BaseModel):
    tier_name: str
    price_cents: int
    sort_order: Optional[int] = None
    # Derived from tier_name when omitted. The code is the stable handle —
    # tier_ids autoincrement independently in dev and prod, so nothing may
    # resolve a tier by hardcoded integer.
    tier_code: Optional[str] = None


class PriceTierUpdate(BaseModel):
    tier_name: Optional[str] = None
    price_cents: Optional[int] = None
    sort_order: Optional[int] = None
    is_active: Optional[bool] = None


class PhotocardPriceUpdate(BaseModel):
    # None unprices the card entirely (deletes the row). Any amount makes the
    # card CUSTOM, clearing price_tier_id — tier and custom price never coexist.
    price_cents: Optional[int] = None


class PhotocardCopyCreate(BaseModel):
    ownership_status_id: int
    notes: Optional[str] = None


class PhotocardCopyUpdate(BaseModel):
    ownership_status_id: int
    notes: Optional[str] = None
