from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from pydantic import BaseModel
import uuid
from ..database import get_db
from .. import models
from ..utils.auth import get_current_user, require_role, get_current_plant, get_plant_aliases

router = APIRouter(prefix="/master/mandrels", tags=["mandrels"])

class MandrelCreate(BaseModel):
    mandrel_code: str
    outer_diameter_mm: int
    length_mm: int
    material: Optional[str] = None

class MandrelUpdate(BaseModel):
    mandrel_code: Optional[str] = None
    outer_diameter_mm: Optional[int] = None
    length_mm: Optional[int] = None
    material: Optional[str] = None
    active: Optional[bool] = None

from datetime import datetime

class MandrelResponse(BaseModel):
    id: uuid.UUID
    mandrel_code: str
    outer_diameter_mm: int
    length_mm: int
    material: Optional[str]
    plant_id: str
    active: bool
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True

@router.get("/", response_model=List[MandrelResponse])
def get_mandrels(
    code: Optional[str] = Query(None, description="Filter by mandrel code"),
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant)
):
    plant_aliases = get_plant_aliases(plant_id)
    query = db.query(models.Mandrel).filter(
        models.Mandrel.plant_id.in_(plant_aliases),
        models.Mandrel.active == True
    )
    if code:
        query = query.filter(models.Mandrel.mandrel_code.ilike(f"%{code}%"))
    return query.all()

@router.get("/{mandrel_id}", response_model=MandrelResponse)
def get_mandrel(
    mandrel_id: uuid.UUID,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant)
):
    mandrel = db.query(models.Mandrel).filter(
        models.Mandrel.id == mandrel_id,
        models.Mandrel.plant_id == plant_id,
        models.Mandrel.active == True
    ).first()
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
    db_mandrel = models.Mandrel(**mandrel.model_dump(), plant_id=plant_id)
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
    db_mandrel = db.query(models.Mandrel).filter(
        models.Mandrel.id == mandrel_id,
        models.Mandrel.plant_id == plant_id
    ).first()
    if not db_mandrel:
        raise HTTPException(status_code=404, detail="Mandrel not found")
    
    update_data = mandrel_update.model_dump(exclude_unset=True)
    for field, value in update_data.items():
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
    db_mandrel = db.query(models.Mandrel).filter(
        models.Mandrel.id == mandrel_id,
        models.Mandrel.plant_id == plant_id
    ).first()
    if not db_mandrel:
        raise HTTPException(status_code=404, detail="Mandrel not found")
    
    db_mandrel.active = False
    db.commit()
    return {"message": "Mandrel deactivated successfully"}
