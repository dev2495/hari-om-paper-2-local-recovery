from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from pydantic import BaseModel
import uuid
from ..database import get_db
from .. import models
from ..utils.auth import accepted_persisted_plant_ids, apply_plant_scope, get_current_plant, get_current_plant_scope, get_current_user, require_role

router = APIRouter(prefix="/master/mandrels", tags=["mandrels"])

class MandrelCreate(BaseModel):
    mandrel_code: Optional[str] = None
    outer_diameter_mm: float
    od_tolerance_mm: float = 0.1
    length_mm: float
    material: Optional[str] = None

class MandrelUpdate(BaseModel):
    mandrel_code: Optional[str] = None
    outer_diameter_mm: Optional[float] = None
    od_tolerance_mm: Optional[float] = None
    length_mm: Optional[float] = None
    material: Optional[str] = None
    active: Optional[bool] = None

from datetime import datetime

class MandrelResponse(BaseModel):
    id: uuid.UUID
    mandrel_code: str
    outer_diameter_mm: float
    od_tolerance_mm: float = 0.1
    length_mm: float
    material: Optional[str]
    plant_id: str
    active: bool
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


def _dimension_code(value: float) -> str:
    return ("%g" % float(value)).replace(".", "P")


def _generated_mandrel_code(outer_diameter_mm: float, length_mm: float) -> str:
    return f"OD{_dimension_code(outer_diameter_mm)}-L{_dimension_code(length_mm)}"


@router.get("/", response_model=List[MandrelResponse])
def get_mandrels(
    code: Optional[str] = Query(None, description="Filter by mandrel code"),
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope)
):
    query = db.query(models.Mandrel).filter(models.Mandrel.active == True)
    query = apply_plant_scope(query, models.Mandrel.plant_id, plant_scope)
    if code:
        query = query.filter(models.Mandrel.mandrel_code.ilike(f"%{code}%"))
    return query.all()

@router.get("/{mandrel_id}", response_model=MandrelResponse)
def get_mandrel(
    mandrel_id: uuid.UUID,
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope)
):
    query = db.query(models.Mandrel).filter(
        models.Mandrel.id == mandrel_id,
        models.Mandrel.active == True
    )
    mandrel = apply_plant_scope(query, models.Mandrel.plant_id, plant_scope).first()
    if not mandrel:
        raise HTTPException(status_code=404, detail="Mandrel not found")
    return mandrel

@router.post("/", response_model=MandrelResponse)
def create_mandrel(
    mandrel: MandrelCreate,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin"]))
):
    del current_user
    mandrel_code = (
        mandrel.mandrel_code.strip()
        if mandrel.mandrel_code and mandrel.mandrel_code.strip()
        else _generated_mandrel_code(mandrel.outer_diameter_mm, mandrel.length_mm)
    )
    plant_values = accepted_persisted_plant_ids(plant_id)
    existing = db.query(models.Mandrel).filter(
        models.Mandrel.plant_id.in_(plant_values),
        models.Mandrel.mandrel_code == mandrel_code,
        models.Mandrel.active == True,
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail="Mandrel with this OD and length already exists for this plant")

    payload = mandrel.model_dump()
    payload["mandrel_code"] = mandrel_code
    db_mandrel = models.Mandrel(**payload, plant_id=plant_id)
    db.add(db_mandrel)
    db.commit()
    db.refresh(db_mandrel)
    return db_mandrel

@router.put("/{mandrel_id}", response_model=MandrelResponse)
def update_mandrel(
    mandrel_id: uuid.UUID,
    mandrel_update: MandrelUpdate,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin"]))
):
    del current_user
    plant_values = accepted_persisted_plant_ids(plant_id)
    db_mandrel = db.query(models.Mandrel).filter(
        models.Mandrel.id == mandrel_id,
        models.Mandrel.plant_id.in_(plant_values)
    ).first()
    if not db_mandrel:
        raise HTTPException(status_code=404, detail="Mandrel not found")
    
    update_data = mandrel_update.model_dump(exclude_unset=True)
    next_od = update_data.get("outer_diameter_mm", db_mandrel.outer_diameter_mm)
    next_length = update_data.get("length_mm", db_mandrel.length_mm)
    next_code = (
        str(update_data.get("mandrel_code") or "").strip()
        or _generated_mandrel_code(next_od, next_length)
    )
    duplicate = db.query(models.Mandrel).filter(
        models.Mandrel.id != mandrel_id,
        models.Mandrel.plant_id.in_(plant_values),
        models.Mandrel.mandrel_code == next_code,
        models.Mandrel.active == True,
    ).first()
    if duplicate:
        raise HTTPException(status_code=409, detail="Mandrel with this OD and length already exists for this plant")

    db_mandrel.mandrel_code = next_code
    for field, value in update_data.items():
        if field == "mandrel_code":
            continue
        setattr(db_mandrel, field, value)
    
    db.commit()
    db.refresh(db_mandrel)
    return db_mandrel

@router.delete("/{mandrel_id}")
def delete_mandrel(
    mandrel_id: uuid.UUID,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin"]))
):
    plant_values = accepted_persisted_plant_ids(plant_id)
    db_mandrel = db.query(models.Mandrel).filter(
        models.Mandrel.id == mandrel_id,
        models.Mandrel.plant_id.in_(plant_values)
    ).first()
    if not db_mandrel:
        raise HTTPException(status_code=404, detail="Mandrel not found")
    
    db_mandrel.active = False
    db.commit()
    return {"message": "Mandrel deactivated successfully"}
