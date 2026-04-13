from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from pydantic import BaseModel
from datetime import datetime
import uuid
from ..database import get_db
from ..models import ReelIssue, ProductionJob
from ..utils.auth import get_current_user, require_role, get_current_plant

router = APIRouter(tags=["reel_issues"])

# Pydantic schemas
class ReelIssueCreate(BaseModel):
    reel_barcode: str
    weight_used: float

class ReelIssueResponse(BaseModel):
    id: uuid.UUID
    job_id: uuid.UUID
    reel_barcode: str
    weight_used: float
    created_at: datetime

    class Config:
        from_attributes = True

@router.post("/jobs/{job_id}/reels", response_model=ReelIssueResponse)
def add_reel_issue(
    job_id: uuid.UUID,
    reel: ReelIssueCreate,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Production", "Admin"]))
):
    """Add reel issue to job (Production or Admin)"""
    # Verify job exists
    job = db.query(ProductionJob).filter(
        ProductionJob.id == job_id,
        ProductionJob.plant_id == plant_id
    ).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    
    db_reel = ReelIssue(
        job_id=job_id,
        reel_barcode=reel.reel_barcode,
        weight_used=reel.weight_used
    )
    
    db.add(db_reel)
    db.commit()
    db.refresh(db_reel)
    return db_reel

@router.get("/jobs/{job_id}/reels", response_model=List[ReelIssueResponse])
def get_reel_issues(
    job_id: uuid.UUID,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(get_current_user)
):
    """Get all reel issues for a job"""
    # Verify job exists
    job = db.query(ProductionJob).filter(
        ProductionJob.id == job_id,
        ProductionJob.plant_id == plant_id
    ).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    
    reels = db.query(ReelIssue).filter(ReelIssue.job_id == job_id).all()
    return reels
