from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Optional
from pydantic import BaseModel
import uuid
from datetime import datetime
from ..database import get_db
from ..models import TrialResult, RecipeHeader
from ..utils.auth import accepted_persisted_plant_ids, apply_plant_scope, get_current_plant, get_current_plant_scope, get_current_user, require_role

router = APIRouter(prefix="/trials", tags=["trials"])

# Pydantic schemas
class TrialCreate(BaseModel):
    actual_cs: Optional[float] = None
    actual_weight: Optional[float] = None
    actual_shrink: Optional[float] = None
    remarks: Optional[str] = None
    approved: bool = False

class TrialResponse(BaseModel):
    id: uuid.UUID
    recipe_id: uuid.UUID
    actual_cs: Optional[float]
    actual_weight: Optional[float]
    actual_shrink: Optional[float]
    remarks: Optional[str]
    approved: bool
    tested_at: datetime

    class Config:
        from_attributes = True

@router.post("/{recipe_id}", response_model=TrialResponse)
def create_trial(
    recipe_id: uuid.UUID,
    trial: TrialCreate,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin", "Owner"]))
):
    """Record trial results"""
    # Verify recipe exists and belongs to plant
    recipe = db.query(RecipeHeader).filter(
        RecipeHeader.id == recipe_id,
        RecipeHeader.plant_id.in_(accepted_persisted_plant_ids(plant_id))
    ).first()
    if not recipe:
        raise HTTPException(status_code=404, detail="Recipe not found")
    
    # Can only add trials to trial recipes
    if recipe.status != "trial":
        raise HTTPException(
            status_code=400,
            detail=f"Cannot add trials to recipe with status '{recipe.status}'"
        )
    
    # Validate CS meets required threshold if approved
    if trial.approved and trial.actual_cs is not None:
        spec = recipe.specification
        if trial.actual_cs < spec.required_cs:
            raise HTTPException(
                status_code=400,
                detail=f"Trial CS ({trial.actual_cs}) is below required CS ({spec.required_cs}). Cannot approve this trial."
            )
    
    db_trial = TrialResult(
        plant_id=recipe.plant_id,
        recipe_id=recipe_id,
        actual_cs=trial.actual_cs,
        actual_weight=trial.actual_weight,
        actual_shrink=trial.actual_shrink,
        remarks=trial.remarks,
        approved=trial.approved
    )
    
    db.add(db_trial)
    db.commit()
    db.refresh(db_trial)
    return db_trial

@router.get("/{recipe_id}", response_model=List[TrialResponse])
def get_trials(
    recipe_id: uuid.UUID,
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
    current_user: dict = Depends(get_current_user)
):
    """Get all trials for a recipe"""
    # Verify recipe ownership
    recipe = apply_plant_scope(
        db.query(RecipeHeader).filter(RecipeHeader.id == recipe_id),
        RecipeHeader.plant_id,
        plant_scope,
    ).first()
    if not recipe:
        raise HTTPException(status_code=404, detail="Recipe not found")
        
    trials = db.query(TrialResult).filter(
        TrialResult.recipe_id == recipe_id
    ).order_by(TrialResult.tested_at.desc()).all()
    
    return trials
