from typing import Optional

from pydantic import BaseModel


class PcsCopyCreate(BaseModel):
    catalog_item_id: str
    ownership_status_id: int
    notes: Optional[str] = None


class PcsCopyUpdate(BaseModel):
    # Partial update — only fields present in the request body are applied
    # (resolved via model_dump(exclude_unset=True) in the router), so notes can
    # be explicitly cleared by sending `"notes": null`.
    ownership_status_id: Optional[int] = None
    notes: Optional[str] = None
