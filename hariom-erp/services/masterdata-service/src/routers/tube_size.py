from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Optional
from pydantic import BaseModel
import uuid
from ..database import get_db
from .. import models
from ..utils.auth import get_current_user, require_role, get_current_plant

router = APIRouter(prefix="/master/tube-sizes", tags=["tube-sizes"])

class TubeSizeCreate(BaseModel):
    inner_diameter_mm: int
    outer_diameter_mm: int
    length_mm: int
    description: Optional[str] = None

class TubeSizeUpdate(BaseModel):
    inner_diameter_mm: Optional[int] = None
    outer_diameter_mm: Optional[int] = None
    length_mm: Optional[int] = None
    description: Optional[str] = None
    active: Optional[bool] = None

from datetime import datetime

class TubeSizeResponse(BaseModel):
    id: uuid.UUID
    inner_diameter_mm: int
    outer_diameter_mm: int
    length_mm: int
    description: Optional[str]
    plant_id: str
    active: bool
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True

@router.get("/", response_model=List[TubeSizeResponse])
def get_tube_sizes(
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant)
):
    return db.query(models.TubeSize).filter(
        models.TubeSize.plant_id == plant_id,
        models.TubeSize.active == True
    ).all()

@router.get("/{size_id}", response_model=TubeSizeResponse)
def get_tube_size(
    size_id: uuid.UUID,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant)
):
    size = db.query(models.TubeSize).filter(
        models.TubeSize.id == size_id,
        models.TubeSize.plant_id == plant_id,
        models.TubeSize.active == True
    ).first()
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
    db_size = db.query(models.TubeSize).filter(
        models.TubeSize.id == size_id,
        models.TubeSize.plant_id == plant_id
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
    db_size = db.query(models.TubeSize).filter(
        models.TubeSize.id == size_id,
        models.TubeSize.plant_id == plant_id
    ).first()
    if not db_size:
        raise HTTPException(status_code=404, detail="Tube size not found")
    
    db_size.active = False
    db.commit()
    return {"message": "Tube size deactivated successfully"}
