from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List, Optional
from pydantic import BaseModel
import uuid
from ..database import get_db
from .. import models
from ..utils.auth import get_current_user, require_role, get_current_plant

router = APIRouter(prefix="/master/papers", tags=["papers"])

class PaperCreate(BaseModel):
    gsm: int
    strength_type: str
    strength_value: int

class PaperUpdate(BaseModel):
    gsm: Optional[int] = None
    strength_type: Optional[str] = None
    strength_value: Optional[int] = None
    category: Optional[str] = None
    active: Optional[bool] = None

from datetime import datetime

class PaperResponse(BaseModel):
    id: uuid.UUID
    gsm: int
    strength_type: str
    strength_value: int
    category: str
    plant_id: str
    active: bool
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True

@router.get("/", response_model=List[PaperResponse])
def get_papers(
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant)
):
    papers = db.query(models.PaperMaster).filter(
        models.PaperMaster.plant_id == plant_id,
        models.PaperMaster.active == True
    ).all()
    return papers

@router.get("/{paper_id}", response_model=PaperResponse)
def get_paper(
    paper_id: uuid.UUID,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant)
):
    paper = db.query(models.PaperMaster).filter(
        models.PaperMaster.id == paper_id,
        models.PaperMaster.plant_id == plant_id,
        models.PaperMaster.active == True
    ).first()
    if not paper:
        raise HTTPException(status_code=404, detail="Paper not found")
    return paper

@router.post("/", response_model=PaperResponse)
def create_paper(
    paper: PaperCreate,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin"]))
):
    db_paper = models.PaperMaster(**paper.model_dump(), plant_id=plant_id)
    db.add(db_paper)
    db.commit()
    db.refresh(db_paper)
    return db_paper

@router.put("/{paper_id}", response_model=PaperResponse)
def update_paper(
    paper_id: uuid.UUID,
    paper_update: PaperUpdate,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin"]))
):
    db_paper = db.query(models.PaperMaster).filter(
        models.PaperMaster.id == paper_id,
        models.PaperMaster.plant_id == plant_id
    ).first()
    if not db_paper:
        raise HTTPException(status_code=404, detail="Paper not found")
    
    update_data = paper_update.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(db_paper, field, value)
    
    db.commit()
    db.refresh(db_paper)
    return db_paper

@router.delete("/{paper_id}")
def delete_paper(
    paper_id: uuid.UUID,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin"]))
):
    db_paper = db.query(models.PaperMaster).filter(
        models.PaperMaster.id == paper_id,
        models.PaperMaster.plant_id == plant_id
    ).first()
    if not db_paper:
        raise HTTPException(status_code=404, detail="Paper not found")
    
    db_paper.active = False
    db.commit()
    return {"message": "Paper deactivated successfully"}
