from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from pydantic import BaseModel, ConfigDict, Field
import uuid
from datetime import datetime
from ..database import get_db
from ..models import RecipeHeader, RecipeLayer, SpecificationSheet
from ..utils.auth import apply_plant_scope, get_current_plant, get_current_plant_scope, get_current_user, require_role
from ..services.approval import ApprovalService
from ..spec_math import RECIPE_MAX_PLIES

router = APIRouter(prefix="/recipes", tags=["recipes"])

# Pydantic schemas
class RecipeCreate(BaseModel):
    notes: Optional[str] = None

class LayerCreate(BaseModel):
    ply_no: int
    paper_id: uuid.UUID
    gsm_snapshot: int
    bf_snapshot: int
    bulk_snapshot: Optional[float] = None


class RecipeReplace(BaseModel):
    notes: Optional[str] = None
    layers: List[LayerCreate] = Field(default_factory=list)

class RecipeResponse(BaseModel):
    id: uuid.UUID
    spec_id: uuid.UUID
    version: int
    status: str
    notes: Optional[str]
    plant_id: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)

class LayerResponse(BaseModel):
    id: uuid.UUID
    recipe_id: uuid.UUID
    ply_no: int
    paper_id: uuid.UUID
    gsm_snapshot: int
    bf_snapshot: int
    bulk_snapshot: Optional[float] = None

    model_config = ConfigDict(from_attributes=True)

class RecipeWithLayers(RecipeResponse):
    layers: List[LayerResponse]

@router.post("/{spec_id}", response_model=RecipeResponse)
def create_recipe(
    spec_id: uuid.UUID,
    recipe: RecipeCreate,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin", "Owner"]))
):
    """Create new recipe for specification (Admin only)"""
    # Verify spec exists and is not obsolete
    spec = db.query(SpecificationSheet).filter(
        SpecificationSheet.id == spec_id,
        SpecificationSheet.plant_id == plant_id
    ).first()
    if not spec:
        raise HTTPException(status_code=404, detail="Specification not found")
    
    if spec.status == "obsolete":
        raise HTTPException(status_code=400, detail="Cannot create recipe for obsolete specification")
    
    # Get next version number
    max_version = db.query(RecipeHeader).filter(
        RecipeHeader.spec_id == spec_id,
        RecipeHeader.plant_id == plant_id
    ).count()
    
    db_recipe = RecipeHeader(
        spec_id=spec_id,
        version=max_version + 1,
        status="trial",
        notes=recipe.notes,
        created_by=current_user.get("sub"),
        plant_id=plant_id
    )
    
    db.add(db_recipe)
    db.commit()
    db.refresh(db_recipe)
    return db_recipe

@router.post("/{recipe_id}/layers", response_model=LayerResponse)
def add_layer(
    recipe_id: uuid.UUID,
    layer: LayerCreate,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin", "Owner"]))
):
    """Add layer to recipe (Admin only, only if trial)"""
    recipe = db.query(RecipeHeader).filter(
        RecipeHeader.id == recipe_id,
        RecipeHeader.plant_id == plant_id
    ).first()
    if not recipe:
        raise HTTPException(status_code=404, detail="Recipe not found")
    
    # Can only add layers to trial recipes (immutable after approval)
    if recipe.status != "trial":
        raise HTTPException(
            status_code=400,
            detail=f"Cannot add layers to recipe with status '{recipe.status}'. Recipe is immutable after approval."
        )

    if layer.ply_no < 1 or layer.ply_no > RECIPE_MAX_PLIES:
        raise HTTPException(
            status_code=400,
            detail=f"Ply number must be between 1 and {RECIPE_MAX_PLIES}",
        )

    layer_count = db.query(RecipeLayer).filter(RecipeLayer.recipe_id == recipe_id).count()
    if layer_count >= RECIPE_MAX_PLIES:
        raise HTTPException(
            status_code=400,
            detail=f"A recipe can contain at most {RECIPE_MAX_PLIES} plies",
        )
    
    # Check for duplicate ply numbers
    existing = db.query(RecipeLayer).filter(
        RecipeLayer.recipe_id == recipe_id,
        RecipeLayer.ply_no == layer.ply_no
    ).first()
    
    if existing:
        raise HTTPException(
            status_code=400,
            detail=f"Ply number {layer.ply_no} already exists in this recipe"
        )
    
    db_layer = RecipeLayer(
        recipe_id=recipe_id,
        plant_id=plant_id,
        ply_no=layer.ply_no,
        paper_id=layer.paper_id,
        gsm_snapshot=layer.gsm_snapshot,
        bf_snapshot=layer.bf_snapshot,
        bulk_snapshot=layer.bulk_snapshot,
    )
    
    db.add(db_layer)
    db.commit()
    db.refresh(db_layer)
    return db_layer

@router.get("/spec/{spec_id}", response_model=List[RecipeResponse])
def get_recipes_for_spec(
    spec_id: uuid.UUID,
    status: Optional[str] = Query(None, description="Filter by status"),
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
    current_user: dict = Depends(get_current_user)
):
    """Get all recipes for a specification"""
    query = apply_plant_scope(
        db.query(RecipeHeader).filter(RecipeHeader.spec_id == spec_id),
        RecipeHeader.plant_id,
        plant_scope,
    )
    
    if status:
        query = query.filter(RecipeHeader.status == status)
    
    return query.order_by(RecipeHeader.version.desc()).all()

@router.get("/{recipe_id}", response_model=RecipeWithLayers)
def get_recipe(
    recipe_id: uuid.UUID,
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
    current_user: dict = Depends(get_current_user)
):
    """Get recipe with layers"""
    recipe = apply_plant_scope(
        db.query(RecipeHeader).filter(RecipeHeader.id == recipe_id),
        RecipeHeader.plant_id,
        plant_scope,
    ).first()
    if not recipe:
        raise HTTPException(status_code=404, detail="Recipe not found")
    
    return recipe


@router.put("/{recipe_id}", response_model=RecipeWithLayers)
def replace_trial_recipe(
    recipe_id: uuid.UUID,
    payload: RecipeReplace,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin", "Owner"])),
):
    recipe = db.query(RecipeHeader).filter(
        RecipeHeader.id == recipe_id,
        RecipeHeader.plant_id == plant_id,
    ).first()
    if not recipe:
        raise HTTPException(status_code=404, detail="Recipe not found")
    if recipe.status != "trial" or recipe.specification.status != "draft":
        raise HTTPException(status_code=409, detail="Only the current draft recipe can be edited")
    if len(payload.layers) > RECIPE_MAX_PLIES:
        raise HTTPException(status_code=400, detail=f"A recipe can contain at most {RECIPE_MAX_PLIES} plies")
    ply_numbers = [layer.ply_no for layer in payload.layers]
    if any(number < 1 or number > RECIPE_MAX_PLIES for number in ply_numbers):
        raise HTTPException(status_code=400, detail=f"Ply number must be between 1 and {RECIPE_MAX_PLIES}")
    if len(set(ply_numbers)) != len(ply_numbers):
        raise HTTPException(status_code=400, detail="Recipe contains duplicate ply numbers")

    recipe.notes = payload.notes
    recipe.layers.clear()
    db.flush()
    for layer in payload.layers:
        recipe.layers.append(
            RecipeLayer(
                plant_id=plant_id,
                ply_no=layer.ply_no,
                paper_id=layer.paper_id,
                gsm_snapshot=layer.gsm_snapshot,
                bf_snapshot=layer.bf_snapshot,
                bulk_snapshot=layer.bulk_snapshot,
            )
        )
    db.commit()
    db.refresh(recipe)
    return recipe

@router.post("/{recipe_id}/approve")
def approve_recipe(
    recipe_id: uuid.UUID,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin", "Owner"]))
):
    """Approve recipe (SpecApprover or Admin)"""
    # Verify ownership before approving via service
    recipe = db.query(RecipeHeader).filter(
        RecipeHeader.id == recipe_id,
        RecipeHeader.plant_id == plant_id
    ).first()
    if not recipe:
        raise HTTPException(status_code=404, detail="Recipe not found")
        
    approval_service = ApprovalService(db)
    result = approval_service.approve_recipe(str(recipe_id), approved_by=current_user.get("sub"))
    return result
