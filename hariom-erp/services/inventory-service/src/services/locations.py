"""Where stock sits (spec 2.7, client 2026-10-28).

Every plant has one receiving default location, the "RM store". Goods inward puts a line or reel there
when the caller gives no location, so new stock is never left without a place.
"""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy import func, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..models import InventoryLocation

RECEIVING_DEFAULT_CODE = "RM-STORE"
RECEIVING_DEFAULT_NAME = "RM store"
# Where goods inward may put stock by default: a store rack or the QC bay. A dispatch bay, the scrap area
# or the floor would hold material that no count looks at while the book still has it.
RECEIVING_PURPOSES = ("STORAGE", "QC")


def _receiving_purpose():
    return or_(InventoryLocation.purpose.is_(None), InventoryLocation.purpose == "", func.upper(InventoryLocation.purpose).in_(RECEIVING_PURPOSES))


def location_payload_name(location: InventoryLocation) -> str:
    """The plain name shown beside the code; falls back to the code for unnamed racks."""
    return str(location.name or "").strip() or location.code


def _clear_inactive_defaults(db: Session, plant: str) -> None:
    db.query(InventoryLocation).filter(
        InventoryLocation.plant_id == plant,
        InventoryLocation.is_receiving_default.is_(True),
    ).update({InventoryLocation.is_receiving_default: False}, synchronize_session="fetch")


def default_receiving_location(db: Session, plant_id: str, *, actor: Optional[str] = None) -> InventoryLocation:
    """The plant's active receiving default; creates "RM-STORE · RM store" when the plant has none.

    Runs inside the caller's transaction (the row commits with the GRN). A concurrent first GRN that
    creates the same row is absorbed by a savepoint and the existing row is returned. A default that is
    not a store rack or QC bay (older data: a dispatch bay or the scrap area) is never used: the RM-STORE
    rack, else the oldest active store rack, becomes the RM store instead.
    """
    plant = str(plant_id)
    current = db.query(InventoryLocation).filter(
        InventoryLocation.plant_id == plant,
        InventoryLocation.is_receiving_default.is_(True),
        InventoryLocation.active == "true",
        _receiving_purpose(),
    ).first()
    if current is not None:
        return current
    now = datetime.utcnow()
    store = db.query(InventoryLocation).filter(
        InventoryLocation.plant_id == plant, InventoryLocation.code == RECEIVING_DEFAULT_CODE, _receiving_purpose(),
    ).first()
    code_taken = store is None and db.query(InventoryLocation.id).filter(InventoryLocation.plant_id == plant, InventoryLocation.code == RECEIVING_DEFAULT_CODE).first() is not None
    if code_taken:
        # RM-STORE exists but was made a dispatch bay / scrap area: the oldest active store rack takes over.
        store = db.query(InventoryLocation).filter(
            InventoryLocation.plant_id == plant, InventoryLocation.active == "true", func.upper(InventoryLocation.purpose) == "STORAGE",
        ).order_by(InventoryLocation.created_at.asc()).first()
    _clear_inactive_defaults(db, plant)
    if store is not None:
        store.is_receiving_default = True
        store.active = "true"
        store.name = store.name or RECEIVING_DEFAULT_NAME
        store.updated_by = actor or store.updated_by
        store.updated_at = now
        db.flush()
        return store
    savepoint = db.begin_nested()
    try:
        store = InventoryLocation(
            plant_id=plant, code=f"{RECEIVING_DEFAULT_CODE}-2" if code_taken else RECEIVING_DEFAULT_CODE, name=RECEIVING_DEFAULT_NAME,
            warehouse="RAW MATERIAL STORE", purpose="STORAGE", active="true",
            is_receiving_default=True, updated_by=actor, updated_at=now,
        )
        db.add(store)
        db.flush()
        savepoint.commit()
        return store
    except IntegrityError:
        savepoint.rollback()
    return db.query(InventoryLocation).filter(
        InventoryLocation.plant_id == plant, _receiving_purpose(),
        or_(InventoryLocation.is_receiving_default.is_(True), InventoryLocation.code.in_([RECEIVING_DEFAULT_CODE, f"{RECEIVING_DEFAULT_CODE}-2"])),
    ).order_by(InventoryLocation.is_receiving_default.desc()).first()
