from __future__ import annotations

from datetime import datetime
import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import InventoryLocation
from ..utils.auth import get_current_plant, get_current_plant_scope, get_current_user, require_role

router = APIRouter(prefix="/inventory/locations", tags=["inventory-locations"])


class LocationCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: str = Field(min_length=1, max_length=80)
    warehouse: str = Field(min_length=1, max_length=80)
    zone: str | None = Field(default=None, max_length=80)
    bin: str | None = Field(default=None, max_length=80)
    purpose: str = "STORAGE"


class LocationResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    plant_id: uuid.UUID
    code: str
    warehouse: str
    zone: str | None = None
    bin: str | None = None
    purpose: str
    active: str
    created_at: datetime


@router.post("", response_model=LocationResponse)
def create_location(
    payload: LocationCreate,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin", "Store"])),
):
    normalized_purpose = payload.purpose.strip().upper()
    if normalized_purpose not in {"STORAGE", "WIP", "QC", "DISPATCH", "SCRAP"}:
        raise HTTPException(status_code=400, detail="purpose must be STORAGE, WIP, QC, DISPATCH, or SCRAP")

    existing = db.query(InventoryLocation).filter(
        InventoryLocation.plant_id == plant_id,
        InventoryLocation.code == payload.code.strip().upper(),
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="Location code already exists in this plant")

    location = InventoryLocation(
        plant_id=plant_id,
        code=payload.code.strip().upper(),
        warehouse=payload.warehouse.strip().upper(),
        zone=(payload.zone or "").strip().upper() or None,
        bin=(payload.bin or "").strip().upper() or None,
        purpose=normalized_purpose,
    )
    db.add(location)
    db.commit()
    db.refresh(location)
    return location


@router.get("", response_model=list[LocationResponse])
def list_locations(
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
    current_user: dict = Depends(get_current_user),
):
    query = db.query(InventoryLocation).filter(InventoryLocation.active == "true")
    if plant_scope.get("scope_all"):
        allowed = plant_scope.get("allowed_plants") or []
        if allowed:
            query = query.filter(InventoryLocation.plant_id.in_(allowed))
    else:
        query = query.filter(InventoryLocation.plant_id == plant_scope["selected_plant_id"])
    return query.order_by(InventoryLocation.warehouse.asc(), InventoryLocation.zone.asc().nullsfirst(), InventoryLocation.bin.asc().nullsfirst()).all()
