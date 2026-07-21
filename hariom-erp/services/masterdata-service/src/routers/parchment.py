from __future__ import annotations

from datetime import datetime
from typing import List, Optional
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session

from .. import models
from ..database import get_db
from ..utils.auth import (
    accepted_persisted_plant_ids,
    apply_plant_scope,
    get_current_plant,
    get_current_plant_scope,
    require_role,
)

router = APIRouter(prefix="/master/parchment", tags=["parchment"])


class VendorCreate(BaseModel):
    name: str


class VendorUpdate(BaseModel):
    name: Optional[str] = None
    active: Optional[bool] = None


class VendorResponse(BaseModel):
    id: uuid.UUID
    name: str
    plant_id: str
    active: bool
    created_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


def _clean_company_name(value: str) -> str:
    cleaned = str(value or "").strip()
    if not cleaned:
        raise HTTPException(status_code=400, detail="Parchment company name is required")
    return cleaned


class ColorCreate(BaseModel):
    vendor_id: uuid.UUID
    color_name: str


class ColorUpdate(BaseModel):
    vendor_id: Optional[uuid.UUID] = None
    color_name: Optional[str] = None
    active: Optional[bool] = None


class ColorResponse(BaseModel):
    id: uuid.UUID
    vendor_id: uuid.UUID
    color_name: str
    plant_id: str
    active: bool
    created_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


@router.get("/vendors", response_model=List[VendorResponse])
def get_vendors(
    include_inactive: bool = Query(False, description="Include disabled parchment vendors for maintenance"),
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
):
    query = db.query(models.ParchmentVendor)
    if not include_inactive:
        query = query.filter(models.ParchmentVendor.active == True)
    query = apply_plant_scope(query, models.ParchmentVendor.plant_id, plant_scope)
    return query.order_by(models.ParchmentVendor.name.asc()).all()


@router.post("/vendors", response_model=VendorResponse)
def create_vendor(
    payload: VendorCreate,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin"])),
):
    del current_user
    plant_values = accepted_persisted_plant_ids(plant_id)
    name = _clean_company_name(payload.name)
    existing = db.query(models.ParchmentVendor).filter(
        models.ParchmentVendor.plant_id.in_(plant_values),
        models.ParchmentVendor.name == name,
    ).first()
    if existing:
        return existing

    model = models.ParchmentVendor(name=name, plant_id=plant_id)
    db.add(model)
    db.commit()
    db.refresh(model)
    return model


@router.put("/vendors/{vendor_id}", response_model=VendorResponse)
def update_vendor(
    vendor_id: uuid.UUID,
    payload: VendorUpdate,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin"])),
):
    del current_user
    plant_values = accepted_persisted_plant_ids(plant_id)
    model = db.query(models.ParchmentVendor).filter(
        models.ParchmentVendor.id == vendor_id,
        models.ParchmentVendor.plant_id.in_(plant_values),
    ).first()
    if not model:
        raise HTTPException(status_code=404, detail="Parchment company not found")

    updates = payload.model_dump(exclude_unset=True)
    if "name" in updates and updates["name"] is not None:
        name = _clean_company_name(updates["name"])
        duplicate = db.query(models.ParchmentVendor).filter(
            models.ParchmentVendor.id != vendor_id,
            models.ParchmentVendor.plant_id.in_(plant_values),
            models.ParchmentVendor.name == name,
        ).first()
        if duplicate:
            raise HTTPException(status_code=409, detail="Parchment company already exists in this plant")
        model.name = name
    if "active" in updates:
        if updates["active"] is False:
            active_color_count = db.query(models.ParchmentColor).filter(
                models.ParchmentColor.vendor_id == vendor_id,
                models.ParchmentColor.plant_id.in_(plant_values),
                models.ParchmentColor.active == True,
            ).count()
            if active_color_count:
                raise HTTPException(
                    status_code=409,
                    detail="Cannot remove parchment company while sub parchment entries exist",
                )
        model.active = updates["active"]

    db.commit()
    db.refresh(model)
    return model


@router.delete("/vendors/{vendor_id}")
def delete_vendor(
    vendor_id: uuid.UUID,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin"])),
):
    del current_user
    plant_values = accepted_persisted_plant_ids(plant_id)
    model = db.query(models.ParchmentVendor).filter(
        models.ParchmentVendor.id == vendor_id,
        models.ParchmentVendor.plant_id.in_(plant_values),
    ).first()
    if not model:
        raise HTTPException(status_code=404, detail="Parchment company not found")

    active_color_count = db.query(models.ParchmentColor).filter(
        models.ParchmentColor.vendor_id == vendor_id,
        models.ParchmentColor.plant_id.in_(plant_values),
        models.ParchmentColor.active == True,
    ).count()
    if active_color_count:
        raise HTTPException(
            status_code=409,
            detail="Cannot remove parchment company while sub parchment entries exist",
        )

    model.active = False
    db.commit()
    return {"message": "Parchment company deactivated successfully"}


@router.get("/colors", response_model=List[ColorResponse])
def get_colors(
    vendor_id: Optional[uuid.UUID] = None,
    include_inactive: bool = Query(False, description="Include disabled parchment colours for maintenance"),
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
):
    query = db.query(models.ParchmentColor)
    if not include_inactive:
        query = query.filter(models.ParchmentColor.active == True)
    query = apply_plant_scope(query, models.ParchmentColor.plant_id, plant_scope)
    if vendor_id:
        query = query.filter(models.ParchmentColor.vendor_id == vendor_id)
    return query.order_by(models.ParchmentColor.color_name.asc()).all()


@router.post("/colors", response_model=ColorResponse)
def create_color(
    payload: ColorCreate,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin"])),
):
    plant_values = accepted_persisted_plant_ids(plant_id)
    vendor = db.query(models.ParchmentVendor).filter(
        models.ParchmentVendor.id == payload.vendor_id,
        models.ParchmentVendor.plant_id.in_(plant_values),
        models.ParchmentVendor.active == True,
    ).first()
    if not vendor:
        raise HTTPException(status_code=404, detail="Parchment company not found")

    existing = db.query(models.ParchmentColor).filter(
        models.ParchmentColor.vendor_id == payload.vendor_id,
        models.ParchmentColor.color_name == payload.color_name,
        models.ParchmentColor.plant_id.in_(plant_values),
    ).first()
    if existing:
        return existing

    model = models.ParchmentColor(
        vendor_id=payload.vendor_id,
        color_name=payload.color_name,
        plant_id=plant_id,
    )
    db.add(model)
    db.commit()
    db.refresh(model)
    return model


@router.put("/colors/{color_id}", response_model=ColorResponse)
def update_color(
    color_id: uuid.UUID,
    payload: ColorUpdate,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin"])),
):
    plant_values = accepted_persisted_plant_ids(plant_id)
    model = db.query(models.ParchmentColor).filter(
        models.ParchmentColor.id == color_id,
        models.ParchmentColor.plant_id.in_(plant_values),
    ).first()
    if not model:
        raise HTTPException(status_code=404, detail="Parchment color not found")

    if payload.vendor_id is not None:
        vendor = db.query(models.ParchmentVendor).filter(
            models.ParchmentVendor.id == payload.vendor_id,
            models.ParchmentVendor.plant_id.in_(plant_values),
            models.ParchmentVendor.active == True,
        ).first()
        if not vendor:
            raise HTTPException(status_code=404, detail="Parchment company not found")

    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(model, key, value)
    db.commit()
    db.refresh(model)
    return model


@router.delete("/colors/{color_id}")
def delete_color(
    color_id: uuid.UUID,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin"])),
):
    plant_values = accepted_persisted_plant_ids(plant_id)
    model = db.query(models.ParchmentColor).filter(
        models.ParchmentColor.id == color_id,
        models.ParchmentColor.plant_id.in_(plant_values),
    ).first()
    if not model:
        raise HTTPException(status_code=404, detail="Parchment color not found")

    model.active = False
    db.commit()
    return {"message": "Parchment color deactivated successfully"}
