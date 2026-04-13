from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import Dict, Any
import uuid
from ..database import get_db
from ..models import RecipeHeader, SpecificationSheet
from ..utils.auth import get_current_user, get_current_plant
from ..calculators import calculate_weights, calculate_yield, generate_bom

router = APIRouter(prefix="/calculate", tags=["calculations"])

@router.get("/weight/{recipe_id}")
def get_weight_calculation(
    recipe_id: uuid.UUID,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(get_current_user)
):
    """Calculate weights for a recipe"""
    # Verify recipe exists and belongs to plant
    recipe = db.query(RecipeHeader).filter(
        RecipeHeader.id == recipe_id,
        RecipeHeader.plant_id == plant_id
    ).first()
    if not recipe:
        raise HTTPException(status_code=404, detail="Recipe not found")
    
    try:
        result = calculate_weights(str(recipe_id), db)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Calculation error: {str(e)}")

@router.get("/yield/{spec_id}")
def get_yield_calculation(
    spec_id: uuid.UUID,
    tube_length_mm: int = 150,  # Default tube length, should come from masterdata
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(get_current_user)
):
    """Calculate tubes per bamboo for a specification"""
    # Verify spec exists and belongs to plant
    spec = db.query(SpecificationSheet).filter(
        SpecificationSheet.id == spec_id,
        SpecificationSheet.plant_id == plant_id
    ).first()
    if not spec:
        raise HTTPException(status_code=404, detail="Specification not found")
    
    try:
        result = calculate_yield(str(spec_id), tube_length_mm, db)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Calculation error: {str(e)}")

@router.get("/bom/{recipe_id}")
def get_bom(
    recipe_id: uuid.UUID,
    tube_length_mm: int = 150,
    tube_od_mm: int = 122,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(get_current_user)
):
    """Generate Bill of Materials for one bamboo"""
    # Verify recipe exists and belongs to plant
    recipe = db.query(RecipeHeader).filter(
        RecipeHeader.id == recipe_id,
        RecipeHeader.plant_id == plant_id
    ).first()
    if not recipe:
        raise HTTPException(status_code=404, detail="Recipe not found")
    
    try:
        result = generate_bom(str(recipe_id), tube_length_mm, tube_od_mm, db)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"BOM generation error: {str(e)}")
