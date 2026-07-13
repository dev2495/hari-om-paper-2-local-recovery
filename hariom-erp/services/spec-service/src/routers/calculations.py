from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from typing import Dict, Any, List, Optional
import uuid
from ..database import get_db
from ..models import RecipeHeader, SpecificationSheet
from ..utils.auth import apply_plant_scope, get_current_plant_scope, get_current_user
from ..calculators import calculate_weights, calculate_yield, generate_bom
from .. import spec_math

router = APIRouter(prefix="/calculate", tags=["calculations"])


class PreviewRecipeRow(BaseModel):
    paper_id: str = ""
    code: str = ""
    variety: str = ""
    category: str = ""
    gsm: float = 0.0
    thickness_per_ply: float = 0.0
    ply_count: int = 1


class PreviewAdhesiveComponent(BaseModel):
    id: Optional[str] = None
    name: str = ""
    base_percent: float = 15.0
    ratio_percent: float = 0.0


class CalculatePreviewPayload(BaseModel):
    tube_length_mm: float = 0.0
    tube_od_mm: float = 0.0
    tube_id_mm: float = 0.0
    target_dry_weight_g: float = 0.0
    drying_percent: float = 9.0
    parchment_percent: float = 1.5
    parchment_allowed: bool = True
    adhesive_percent: Optional[float] = None
    recipe_rows: List[PreviewRecipeRow] = []
    adhesive_components: List[PreviewAdhesiveComponent] = []


@router.get("/weight/{recipe_id}")
def get_weight_calculation(
    recipe_id: uuid.UUID,
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
    current_user: dict = Depends(get_current_user)
):
    """Calculate weights for a recipe"""
    # Verify recipe exists and belongs to plant
    recipe = apply_plant_scope(
        db.query(RecipeHeader).filter(RecipeHeader.id == recipe_id),
        RecipeHeader.plant_id,
        plant_scope,
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
    plant_scope: dict = Depends(get_current_plant_scope),
    current_user: dict = Depends(get_current_user)
):
    """Calculate tubes per bamboo for a specification"""
    # Verify spec exists and belongs to plant
    spec = apply_plant_scope(
        db.query(SpecificationSheet).filter(SpecificationSheet.id == spec_id),
        SpecificationSheet.plant_id,
        plant_scope,
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
    plant_scope: dict = Depends(get_current_plant_scope),
    current_user: dict = Depends(get_current_user)
):
    """Generate Bill of Materials for one bamboo"""
    # Verify recipe exists and belongs to plant
    recipe = apply_plant_scope(
        db.query(RecipeHeader).filter(RecipeHeader.id == recipe_id),
        RecipeHeader.plant_id,
        plant_scope,
    ).first()
    if not recipe:
        raise HTTPException(status_code=404, detail="Recipe not found")
    
    try:
        result = generate_bom(str(recipe_id), tube_length_mm, tube_od_mm, db)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"BOM generation error: {str(e)}")


@router.post("/preview")
def calculate_preview(
    payload: CalculatePreviewPayload,
    _db: Session = Depends(get_db),
    _plant_scope: dict = Depends(get_current_plant_scope),
    _current_user: dict = Depends(get_current_user),
):
    adhesive_percent = (
        float(payload.adhesive_percent)
        if payload.adhesive_percent is not None
        else float(payload.adhesive_components[0].base_percent)
        if payload.adhesive_components
        else spec_math.GLOBAL_ADHESIVE_PERCENT
    )

    papers: List[spec_math.RecipePaper] = []
    for row in payload.recipe_rows:
        gsm = float(row.gsm or 0.0)
        thickness = float(row.thickness_per_ply or 0.0)
        bulk = (thickness * 1000.0 / gsm) if gsm > 0 else 0.0
        papers.append(
            spec_math.RecipePaper(
                paper_id=row.paper_id,
                gsm=gsm,
                bulk=bulk,
                ply_count=max(int(row.ply_count or 1), 1),
                code=row.code,
            )
        )

    preview = spec_math.compute_preview(
        mandrel_od_mm=float(payload.tube_id_mm or 0.0),
        tube_length_mm=float(payload.tube_length_mm or 0.0),
        papers=papers,
        target_dry_g=float(payload.target_dry_weight_g or 0.0),
        adhesive_percent=adhesive_percent,
        parchment_percent=float(payload.parchment_percent or 0.0),
        moisture_loss_percent=float(payload.drying_percent or 0.0),
        parchment_allowed=bool(payload.parchment_allowed),
    )

    ratio_total = sum(float(component.ratio_percent or 0.0) for component in payload.adhesive_components)
    adhesive_components = []
    for index, component in enumerate(payload.adhesive_components):
        ratio = float(component.ratio_percent or 0.0)
        weight = (preview.tube.adhesive_g * ratio / ratio_total) if ratio_total > 0 else 0.0
        adhesive_components.append(
            {
                "id": component.id or str(index + 1),
                "name": component.name or f"Adhesive {index + 1}",
                "ratio_percent": ratio,
                "base_percent": adhesive_percent,
                "weight_g": round(weight, 2),
            }
        )

    ply_cursor = 0
    ply_details = []
    for row in payload.recipe_rows:
        row_ply_count = max(int(row.ply_count or 1), 1)
        row_weight_per_mm = sum(preview.per_ply_weight_per_mm_g[ply_cursor: ply_cursor + row_ply_count])
        ply_cursor += row_ply_count
        ply_details.append(
            {
                "paper_id": row.paper_id,
                "code": row.code,
                "variety": row.variety,
                "gsm": row.gsm,
                "ply_count": row_ply_count,
                "weightG": round(row_weight_per_mm * float(payload.tube_length_mm or 0.0), 2),
            }
        )

    divisor = max(1.0 - float(payload.drying_percent or 0.0) / 100.0, 0.01)
    pre_moisture_target = float(payload.target_dry_weight_g or 0.0) / divisor if divisor else 0.0

    return {
        "summary": {
            "paper_total_g": round(preview.tube.paper_g, 2),
            "parchment_weight_g": round(preview.tube.parchment_g, 2),
            "adhesive_total_g": round(preview.tube.adhesive_g, 2),
            "adhesive_components": adhesive_components,
            "drying_percent_used": float(payload.drying_percent or 0.0),
            "pre_oven_divisor": round(divisor, 4),
            "pre_moisture_target_tube_g": round(pre_moisture_target, 2),
            "predicted_dry_tube_g": round(preview.tube.dry_g, 2),
            "predicted_wet_tube_g": round(preview.tube.wet_g, 2),
            "dry_delta_g": round(preview.validation.delta_g, 2),
            "wet_delta_g": round(preview.tube.wet_g - pre_moisture_target, 2),
            "weight_per_mm_g": round(preview.tube.wet_g / max(float(payload.tube_length_mm or 0.0), 1.0), 4),
            "paper_required_g": round(preview.paper_required_g, 2),
            "bamboo_required_wet_g": round(preview.bamboo.wet_g, 2),
            "bamboo_required_dry_g": round(preview.bamboo.dry_g, 2),
            "bamboo_required_paper_g": round(preview.bamboo.paper_g, 2),
            "selected_bamboo_length_mm": preview.bamboo_plan.bamboo_length_mm,
            "usable_length_mm": preview.bamboo_plan.usable_length_mm,
            "tube_length_mm": float(payload.tube_length_mm or 0.0),
            "tubes_per_bamboo": preview.bamboo_plan.tubes_per_bamboo,
            "ply_details": ply_details,
        },
        "validation": {
            "distinct_papers": preview.validation.distinct_papers,
            "total_plies": preview.validation.total_plies,
            "papers_ok": preview.validation.papers_ok,
            "plies_ok": preview.validation.plies_ok,
            "delta_g": preview.validation.delta_g,
            "delta_tolerance_g": preview.validation.delta_tolerance_g,
            "delta_ok": preview.validation.delta_ok,
            "ok": preview.validation.ok,
        },
    }
