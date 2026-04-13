from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Optional
from pydantic import BaseModel
import uuid
from ..database import get_db
from .. import models
from ..utils.auth import get_current_user, require_role, get_current_plant

router = APIRouter(prefix="/master/adhesives", tags=["adhesives"])

class AdhesiveCreate(BaseModel):
    name: str
    internal_code: str

class AdhesiveUpdate(BaseModel):
    name: Optional[str] = None
    internal_code: Optional[str] = None
    active: Optional[bool] = None

class AdhesiveResponse(BaseModel):
    id: uuid.UUID
    name: str
    internal_code: str
    plant_id: str
    active: bool
    created_at: Optional[str] = None

    class Config:
        from_attributes = True

@router.get("/", response_model=List[AdhesiveResponse])
def get_adhesives(
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant)
):
    return db.query(models.AdhesiveMaster).filter(
        models.AdhesiveMaster.plant_id == plant_id,
        models.AdhesiveMaster.active == True
    ).all()

@router.get("/{adhesive_id}", response_model=AdhesiveResponse)
def get_adhesive(
    adhesive_id: uuid.UUID,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant)
):
    adhesive = db.query(models.AdhesiveMaster).filter(
        models.AdhesiveMaster.id == adhesive_id,
        models.AdhesiveMaster.plant_id == plant_id,
        models.AdhesiveMaster.active == True
    ).first()
    if not adhesive:
        raise HTTPException(status_code=404, detail="Adhesive not found")
    return adhesive

@router.post("/", response_model=AdhesiveResponse)
def create_adhesive(
    adhesive: AdhesiveCreate,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin"]))
):
    db_adhesive = models.AdhesiveMaster(**adhesive.model_dump(), plant_id=plant_id)
    db.add(db_adhesive)
    db.commit()
    db.refresh(db_adhesive)
    return db_adhesive

@router.put("/{adhesive_id}", response_model=AdhesiveResponse)
def update_adhesive(
    adhesive_id: uuid.UUID,
    adhesive_update: AdhesiveUpdate,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin"]))
):
    db_adhesive = db.query(models.AdhesiveMaster).filter(
        models.AdhesiveMaster.id == adhesive_id,
        models.AdhesiveMaster.plant_id == plant_id
    ).first()
    if not db_adhesive:
        raise HTTPException(status_code=404, detail="Adhesive not found")
    
    update_data = adhesive_update.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(db_adhesive, field, value)
    
    db.commit()
    db.refresh(db_adhesive)
    return db_adhesive

@router.delete("/{adhesive_id}")
def delete_adhesive(
    adhesive_id: uuid.UUID,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin"]))
):
    db_adhesive = db.query(models.AdhesiveMaster).filter(
        models.AdhesiveMaster.id == adhesive_id,
        models.AdhesiveMaster.plant_id == plant_id
    ).first()
    if not db_adhesive:
        raise HTTPException(status_code=404, detail="Adhesive not found")
    
    db_adhesive.active = False
    db.commit()
    return {"message": "Adhesive deactivated successfully"}
