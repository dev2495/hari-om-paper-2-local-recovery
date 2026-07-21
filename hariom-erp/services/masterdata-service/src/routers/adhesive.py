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

router = APIRouter(prefix="/master/adhesives", tags=["adhesives"])


def _normalized_variety(variety: Optional[str], name: Optional[str] = None) -> str:
    resolved = str(variety or name or "").strip()
    if not resolved:
        raise HTTPException(status_code=422, detail="variety is required")
    return resolved


class AdhesiveCreate(BaseModel):
    variety: Optional[str] = None
    name: Optional[str] = None
    internal_code: str
    solid_content_percent: Optional[float] = None
    viscosity: Optional[float] = None
    ph: Optional[float] = None


class AdhesiveUpdate(BaseModel):
    variety: Optional[str] = None
    name: Optional[str] = None
    internal_code: Optional[str] = None
    solid_content_percent: Optional[float] = None
    viscosity: Optional[float] = None
    ph: Optional[float] = None
    active: Optional[bool] = None


class AdhesiveResponse(BaseModel):
    id: uuid.UUID
    name: str
    variety: str
    internal_code: str
    solid_content_percent: Optional[float]
    viscosity: Optional[float]
    ph: Optional[float]
    plant_id: str
    active: bool
    created_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


def _serialize_adhesive(model: models.AdhesiveMaster) -> AdhesiveResponse:
    payload = {
        "id": model.id,
        "name": model.variety or model.name,
        "variety": model.variety or model.name,
        "internal_code": model.internal_code,
        "solid_content_percent": model.solid_content_percent,
        "viscosity": model.viscosity,
        "ph": model.ph,
        "plant_id": model.plant_id,
        "active": model.active,
        "created_at": model.created_at,
    }
    return AdhesiveResponse.model_validate(payload)


@router.get("/", response_model=List[AdhesiveResponse])
def get_adhesives(
    include_inactive: bool = Query(False, description="Include disabled adhesives for master maintenance"),
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
):
    query = db.query(models.AdhesiveMaster)
    if not include_inactive:
        query = query.filter(models.AdhesiveMaster.active == True)
    query = apply_plant_scope(query, models.AdhesiveMaster.plant_id, plant_scope)
    return [_serialize_adhesive(row) for row in query.order_by(models.AdhesiveMaster.internal_code.asc()).all()]


@router.post("/", response_model=AdhesiveResponse)
def create_adhesive(
    payload: AdhesiveCreate,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin"])),
):
    del current_user
    variety = _normalized_variety(payload.variety, payload.name)
    code = payload.internal_code.strip()
    plant_values = accepted_persisted_plant_ids(plant_id)
    existing = db.query(models.AdhesiveMaster).filter(
        models.AdhesiveMaster.plant_id.in_(plant_values),
        (
            (models.AdhesiveMaster.name == variety)
            | (models.AdhesiveMaster.variety == variety)
            | (models.AdhesiveMaster.internal_code == code)
        ),
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail="Adhesive variety or code already exists in this plant")

    model = models.AdhesiveMaster(
        name=variety,
        variety=variety,
        internal_code=code,
        solid_content_percent=payload.solid_content_percent,
        viscosity=payload.viscosity,
        ph=payload.ph,
        plant_id=plant_id,
    )
    db.add(model)
    db.commit()
    db.refresh(model)
    return _serialize_adhesive(model)


@router.put("/{adhesive_id}", response_model=AdhesiveResponse)
def update_adhesive(
    adhesive_id: uuid.UUID,
    payload: AdhesiveUpdate,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin"])),
):
    del current_user
    plant_values = accepted_persisted_plant_ids(plant_id)
    model = db.query(models.AdhesiveMaster).filter(
        models.AdhesiveMaster.id == adhesive_id,
        models.AdhesiveMaster.plant_id.in_(plant_values),
    ).first()
    if not model:
        raise HTTPException(status_code=404, detail="Adhesive not found")

    update_data = payload.model_dump(exclude_unset=True)
    if "variety" in update_data or "name" in update_data:
        resolved = _normalized_variety(update_data.get("variety"), update_data.get("name"))
        duplicate = db.query(models.AdhesiveMaster).filter(
            models.AdhesiveMaster.id != adhesive_id,
            models.AdhesiveMaster.plant_id.in_(plant_values),
            (
                (models.AdhesiveMaster.name == resolved)
                | (models.AdhesiveMaster.variety == resolved)
            ),
        ).first()
        if duplicate:
            raise HTTPException(status_code=409, detail="Adhesive variety already exists in this plant")
        model.name = resolved
        model.variety = resolved

    if "internal_code" in update_data:
        code = str(update_data["internal_code"]).strip()
        duplicate = db.query(models.AdhesiveMaster).filter(
            models.AdhesiveMaster.id != adhesive_id,
            models.AdhesiveMaster.plant_id.in_(plant_values),
            models.AdhesiveMaster.internal_code == code,
        ).first()
        if duplicate:
            raise HTTPException(status_code=409, detail="Adhesive code already exists in this plant")
        model.internal_code = code

    for key in ("solid_content_percent", "viscosity", "ph", "active"):
        if key in update_data:
            setattr(model, key, update_data[key])

    db.commit()
    db.refresh(model)
    return _serialize_adhesive(model)


@router.delete("/{adhesive_id}")
def delete_adhesive(
    adhesive_id: uuid.UUID,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin"])),
):
    del current_user
    plant_values = accepted_persisted_plant_ids(plant_id)
    model = db.query(models.AdhesiveMaster).filter(
        models.AdhesiveMaster.id == adhesive_id,
        models.AdhesiveMaster.plant_id.in_(plant_values),
    ).first()
    if not model:
        raise HTTPException(status_code=404, detail="Adhesive not found")

    model.active = False
    db.commit()
    return {"message": "Adhesive deactivated successfully"}
