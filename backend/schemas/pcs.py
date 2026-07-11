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


# ── Guest-backup import (migration off the deprecated /guest/ WASM tier) ──
# Shape mirrors the JSON produced by the guest tier's "Download Backup"
# (frontend/src/guest/sqliteWorker.js → exportGuestData). Only guest_card_copies
# is consumed; guest_meta (a version cursor) is ignored. Rows carry extra
# columns (copy_id, created_at, updated_at) which Pydantic drops by default.

class GuestBackupCopyRow(BaseModel):
    catalog_item_id: str
    ownership_status_id: int
    notes: Optional[str] = None


class GuestBackupTables(BaseModel):
    guest_card_copies: list[GuestBackupCopyRow] = []


class PcsGuestBackupImport(BaseModel):
    version: int = 1
    tables: GuestBackupTables
