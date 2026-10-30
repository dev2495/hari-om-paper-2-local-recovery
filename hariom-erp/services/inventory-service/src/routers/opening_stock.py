"""Opening stock page endpoints (client 2026-10-30): what is posted, a check before posting, and labels.

Posting itself stays ``POST /inventory/stock-control/opening-loads`` (stock_control.py), compatible
with its old callers. Owner and Admin enter and post; every role may view.
"""
from __future__ import annotations

import uuid
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..database import get_db
from ..services import opening_stock
from ..services.stock_lots import get_one_plant
from ..utils.auth import SUPER_ROLES, get_current_user, require_role

router = APIRouter(prefix="/inventory/stock-control", tags=["inventory-opening-stock"])


class PreviewLine(BaseModel):
    """A row as typed or pasted: anything may still be missing or wrong, the check says what."""
    item_id: Optional[str] = Field(default=None, max_length=64)
    kind: Optional[str] = Field(default=None, max_length=10)
    qty: Optional[float] = None
    location_id: Optional[str] = Field(default=None, max_length=64)
    old_mark: Optional[str] = Field(default=None, max_length=120)
    vendor_name: Optional[str] = Field(default=None, max_length=200)
    vendor_ref: Optional[str] = Field(default=None, max_length=120)
    stock_status: Optional[str] = Field(default=None, max_length=20)
    on_hold: bool = False
    hold_reason: Optional[str] = Field(default=None, max_length=300)
    unit_cost: Optional[float] = None


class PreviewPayload(BaseModel):
    effective_date: Optional[date] = None
    lines: list[PreviewLine] = Field(default_factory=list, max_length=1000)


def _may_post(current_user: dict) -> bool:
    return bool(set(current_user.get("roles") or []) & SUPER_ROLES)


@router.get("/opening-stock")
def get_opening_stock(
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_one_plant),
    current_user: dict = Depends(get_current_user),
):
    """Go-live date and state, every posted batch with who and when, and the totals per unit."""
    return opening_stock.overview(db, plant_id, can_post=_may_post(current_user))


@router.post("/opening-loads/preview")
def preview_opening_load(
    payload: PreviewPayload,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_one_plant),
    # Only the people who post check a batch (Owner and Admin, spec 2.3).
    current_user: dict = Depends(require_role([])),
):
    """Check a batch before posting: errors and warnings per row, the date rule, totals per item and unit."""
    return opening_stock.preview(db, plant_id, payload.effective_date, payload.lines)


@router.get("/opening-loads/{load_id}/labels")
def opening_load_labels(
    load_id: uuid.UUID,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_one_plant),
    current_user: dict = Depends(get_current_user),
):
    """The batch with one label per reel / lot (QR /scan link, item, weight or qty, location, old mark)."""
    header = opening_stock.get_batch(db, plant_id, load_id)
    return opening_stock.serialize_batch(db, header, ordinal=opening_stock.batch_ordinal(db, plant_id, header), with_labels=True)
