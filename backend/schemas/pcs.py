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


# ── Trades (server-backed per-user, mirrors the guest tier's local trades) ──

class PcsTradeCreate(BaseModel):
    from_name: str
    to_name: Optional[str] = None
    notes: Optional[str] = None
    include_backs: bool = False
    catalog_item_ids: list[str] = []


class PcsTradeDefaults(BaseModel):
    # Field names avoid the Python `from` keyword; the frontend adapter maps
    # to/from its {from, to, notes} shape.
    from_name: Optional[str] = ""
    to_name: Optional[str] = ""
    notes: Optional[str] = ""
