from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Optional
from pydantic import BaseModel
import uuid
from ..database import get_db
from .. import models
from ..utils.auth import accepted_persisted_plant_ids, apply_plant_scope, get_current_plant, get_current_plant_scope, get_current_user, require_role

router = APIRouter(prefix="/master/tube-sizes", tags=["tube-sizes"])

class TubeSizeCreate(BaseModel):
    inner_diameter_mm: float
    outer_diameter_mm: float
    length_mm: float
    description: Optional[str] = None

class TubeSizeUpdate(BaseModel):
    inner_diameter_mm: Optional[float] = None
    outer_diameter_mm: Optional[float] = None
    length_mm: Optional[float] = None
    description: Optional[str] = None
    active: Optional[bool] = None

from datetime import datetime

class TubeSizeResponse(BaseModel):
    id: uuid.UUID
    inner_diameter_mm: float
    outer_diameter_mm: float
    length_mm: float
    description: Optional[str]
    plant_id: str
    active: bool
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True

@router.get("/", response_model=List[TubeSizeResponse])
def get_tube_sizes(
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope)
):
    query = db.query(models.TubeSize).filter(models.TubeSize.active == True)
    return apply_plant_scope(query, models.TubeSize.plant_id, plant_scope).all()

@router.get("/{size_id}", response_model=TubeSizeResponse)
def get_tube_size(
    size_id: uuid.UUID,
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope)
):
    query = db.query(models.TubeSize).filter(
        models.TubeSize.id == size_id,
        models.TubeSize.active == True
    )
    size = apply_plant_scope(query, models.TubeSize.plant_id, plant_scope).first()
    if not size:
        raise HTTPException(status_code=404, detail="Tube size not found")
    return size

@router.post("/", response_model=TubeSizeResponse)
def create_tube_size(
    size: TubeSizeCreate,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin"]))
):
    db_size = models.TubeSize(**size.model_dump(), plant_id=plant_id)
    db.add(db_size)
    db.commit()
    db.refresh(db_size)
    return db_size

@router.put("/{size_id}", response_model=TubeSizeResponse)
def update_tube_size(
    size_id: uuid.UUID,
    size_update: TubeSizeUpdate,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin"]))
):
    plant_values = accepted_persisted_plant_ids(plant_id)
    db_size = db.query(models.TubeSize).filter(
        models.TubeSize.id == size_id,
        models.TubeSize.plant_id.in_(plant_values)
    ).first()
    if not db_size:
        raise HTTPException(status_code=404, detail="Tube size not found")
    
    update_data = size_update.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(db_size, field, value)
    
    db.commit()
    db.refresh(db_size)
    return db_size

@router.delete("/{size_id}")
def delete_tube_size(
    size_id: uuid.UUID,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin"]))
):
    plant_values = accepted_persisted_plant_ids(plant_id)
    db_size = db.query(models.TubeSize).filter(
        models.TubeSize.id == size_id,
        models.TubeSize.plant_id.in_(plant_values)
    ).first()
    if not db_size:
        raise HTTPException(status_code=404, detail="Tube size not found")
    
    db_size.active = False
    db.commit()
    return {"message": "Tube size deactivated successfully"}
