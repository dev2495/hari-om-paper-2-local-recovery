from datetime import datetime
from typing import List, Optional
import uuid
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session
from ..database import get_db
from ..models import (
    RecipeHeader,
    SpecDynamicField,
    SpecDynamicFieldValue,
    SpecificationSheet,
)
from ..services.approval import ApprovalService
from ..utils.auth import enforce_maker_checker, get_current_user, require_role, get_current_plant
from ..config import get_settings

router = APIRouter(prefix="/specs", tags=["specifications"])
settings = get_settings()


class DynamicFieldValueInput(BaseModel):
    field_key: str
    value: Optional[str] = None


class DynamicFieldValueResponse(BaseModel):
    field_key: str
    label: str
    value: Optional[str]
    field_type: str


class SpecCreate(BaseModel):
    customer_name: str
    tube_size_id: uuid.UUID
    mandrel_id: uuid.UUID
    required_cs: float
    target_tube_weight: float
    parchment_percent: Optional[float] = settings.DEFAULT_PARCHMENT_PERCENT
    parchment_color: Optional[str] = None
    adhesive_20100_percent: Optional[float] = None
    adhesive_30100_percent: Optional[float] = None
    shrink_percent: Optional[float] = settings.DEFAULT_SHRINK_PERCENT
    dynamic_fields: Optional[List[DynamicFieldValueInput]] = None


class SpecUpdate(BaseModel):
    customer_name: Optional[str] = None
    tube_size_id: Optional[uuid.UUID] = None
    mandrel_id: Optional[uuid.UUID] = None
    required_cs: Optional[float] = None
    target_tube_weight: Optional[float] = None
    parchment_percent: Optional[float] = None
    parchment_color: Optional[str] = None
    adhesive_20100_percent: Optional[float] = None
    adhesive_30100_percent: Optional[float] = None
    shrink_percent: Optional[float] = None
    dynamic_fields: Optional[List[DynamicFieldValueInput]] = None


class SpecResponse(BaseModel):
    id: uuid.UUID
    customer_name: str
    tube_size_id: uuid.UUID
    mandrel_id: uuid.UUID
    required_cs: float
    approved_cs: Optional[float]
    target_tube_weight: float
    parchment_percent: float
    parchment_color: Optional[str]
    adhesive_20100_percent: Optional[float]
    adhesive_30100_percent: Optional[float]
    shrink_percent: float
    bamboo_max_length: int
    cut_loss_mm: int
    status: str
    version: int
    active: bool
    created_by: Optional[str]
    approved_by: Optional[str]
    plant_id: str
    created_at: datetime
    dynamic_fields: List[DynamicFieldValueResponse]


def _serialize_spec(spec: SpecificationSheet) -> dict:
    dynamic_values = []
    for value in spec.dynamic_values:
        if not value.field:
            continue
        dynamic_values.append(
            {
                "field_key": value.field.key,
                "label": value.field.label,
                "value": value.value,
                "field_type": value.field.field_type,
            }
        )

    return {
        "id": spec.id,
        "customer_name": spec.customer_name,
        "tube_size_id": spec.tube_size_id,
        "mandrel_id": spec.mandrel_id,
        "required_cs": spec.required_cs,
        "approved_cs": spec.approved_cs,
        "target_tube_weight": spec.target_tube_weight,
        "parchment_percent": spec.parchment_percent,
        "parchment_color": spec.parchment_color,
        "adhesive_20100_percent": spec.adhesive_20100_percent,
        "adhesive_30100_percent": spec.adhesive_30100_percent,
        "shrink_percent": spec.shrink_percent,
        "bamboo_max_length": spec.bamboo_max_length,
        "cut_loss_mm": spec.cut_loss_mm,
        "status": spec.status,
        "version": spec.version,
        "active": spec.active,
        "created_by": spec.created_by,
        "approved_by": spec.approved_by,
        "plant_id": spec.plant_id,
        "created_at": spec.created_at,
        "dynamic_fields": sorted(dynamic_values, key=lambda x: x["field_key"]),
    }


def _upsert_dynamic_values(spec_id: uuid.UUID, dynamic_fields: Optional[List[DynamicFieldValueInput]], db: Session):
    if dynamic_fields is None:
        return

    field_map = {
        field.key: field
        for field in db.query(SpecDynamicField).filter(
            SpecDynamicField.active == True
        ).all()
    }

    for entry in dynamic_fields:
        field = field_map.get(entry.field_key)
        if not field:
            raise HTTPException(status_code=400, detail=f"Unknown dynamic field: {entry.field_key}")

        value_model = db.query(SpecDynamicFieldValue).filter(
            SpecDynamicFieldValue.spec_id == spec_id,
            SpecDynamicFieldValue.field_id == field.id
        ).first()

        if not value_model:
            value_model = SpecDynamicFieldValue(
                spec_id=spec_id,
                field_id=field.id,
                value=entry.value
            )
            db.add(value_model)
        else:
            value_model.value = entry.value


@router.get("/constants")
def get_spec_constants(
    current_user: dict = Depends(get_current_user)
):
    return {
        "bamboo_max_length_mm": settings.BAMBOO_MAX_LENGTH,
        "cut_loss_mm": settings.CUT_LOSS_MM,
        "default_parchment_percent": settings.DEFAULT_PARCHMENT_PERCENT,
        "default_shrink_percent": settings.DEFAULT_SHRINK_PERCENT,
    }


@router.post("/", response_model=SpecResponse)
def create_spec(
    spec: SpecCreate,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin", "SpecMaker"]))
):
    model = SpecificationSheet(
        customer_name=spec.customer_name,
        tube_size_id=spec.tube_size_id,
        mandrel_id=spec.mandrel_id,
        required_cs=spec.required_cs,
        target_tube_weight=spec.target_tube_weight,
        parchment_percent=spec.parchment_percent,
        parchment_color=spec.parchment_color,
        adhesive_20100_percent=spec.adhesive_20100_percent,
        adhesive_30100_percent=spec.adhesive_30100_percent,
        shrink_percent=spec.shrink_percent,
        bamboo_max_length=settings.BAMBOO_MAX_LENGTH,
        cut_loss_mm=settings.CUT_LOSS_MM,
        created_by=current_user.get("sub"),
        plant_id=plant_id,
    )
    db.add(model)
    db.flush()

    _upsert_dynamic_values(model.id, spec.dynamic_fields, db)

    db.commit()
    db.refresh(model)
    return _serialize_spec(model)


@router.get("/", response_model=List[SpecResponse])
def get_specs(
    status: Optional[str] = Query(None),
    customer_name: Optional[str] = Query(None),
    active_only: bool = Query(True),
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(get_current_user)
):
    query = db.query(SpecificationSheet).filter(SpecificationSheet.plant_id == plant_id)
    if status:
        query = query.filter(SpecificationSheet.status == status)
    if customer_name:
        query = query.filter(SpecificationSheet.customer_name.ilike(f"%{customer_name}%"))
    if active_only:
        query = query.filter(SpecificationSheet.active == True)
    specs = query.order_by(SpecificationSheet.created_at.desc()).all()
    return [_serialize_spec(spec) for spec in specs]


@router.get("/{spec_id}", response_model=SpecResponse)
def get_spec(
    spec_id: uuid.UUID,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(get_current_user)
):
    spec = db.query(SpecificationSheet).filter(
        SpecificationSheet.id == spec_id,
        SpecificationSheet.plant_id == plant_id
    ).first()
    if not spec:
        raise HTTPException(status_code=404, detail="Specification not found")
    return _serialize_spec(spec)


@router.put("/{spec_id}", response_model=SpecResponse)
def update_spec(
    spec_id: uuid.UUID,
    payload: SpecUpdate,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin", "SpecMaker"]))
):
    spec = db.query(SpecificationSheet).filter(
        SpecificationSheet.id == spec_id,
        SpecificationSheet.plant_id == plant_id
    ).first()
    if not spec:
        raise HTTPException(status_code=404, detail="Specification not found")
    if spec.status not in ["draft", "trial"]:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot edit spec with status '{spec.status}'. Only draft or trial specs can be edited."
        )

    updates = payload.model_dump(exclude_unset=True, exclude={"dynamic_fields"})
    for field, value in updates.items():
        setattr(spec, field, value)

    _upsert_dynamic_values(spec.id, payload.dynamic_fields, db)

    db.commit()
    db.refresh(spec)
    return _serialize_spec(spec)


class ApproveSpecPayload(BaseModel):
    recipe_id: Optional[uuid.UUID] = None

@router.post("/{spec_id}/approve")
def approve_spec(
    spec_id: uuid.UUID,
    payload: ApproveSpecPayload,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin", "SpecApprover"]))
):
    spec = db.query(SpecificationSheet).filter(
        SpecificationSheet.id == spec_id,
        SpecificationSheet.plant_id == plant_id
    ).first()
    if not spec:
        raise HTTPException(status_code=404, detail="Specification not found")

    if spec.created_by:
        enforce_maker_checker(current_user, spec.created_by)

    duplicate = db.query(SpecificationSheet).filter(
        SpecificationSheet.id != spec.id,
        SpecificationSheet.plant_id == plant_id,
        SpecificationSheet.active == True,
        SpecificationSheet.status == "approved",
        SpecificationSheet.tube_size_id == spec.tube_size_id,
        SpecificationSheet.required_cs == spec.required_cs,
        SpecificationSheet.target_tube_weight == spec.target_tube_weight,
    ).first()
    if duplicate:
        raise HTTPException(
            status_code=400,
            detail="An active approved spec already exists for this tube size + CS + target weight"
        )

    recipe = None
    if payload.recipe_id:
        recipe = db.query(RecipeHeader).filter(
            RecipeHeader.id == payload.recipe_id,
            RecipeHeader.spec_id == spec.id
        ).first()
    else:
        recipe = db.query(RecipeHeader).filter(
            RecipeHeader.spec_id == spec.id,
            RecipeHeader.status == "trial"
        ).order_by(RecipeHeader.version.desc()).first()

    if not recipe:
        raise HTTPException(status_code=400, detail="No trial recipe found for this specification")

    service = ApprovalService(db)
    result = service.approve_recipe(str(recipe.id), approved_by=current_user.get("sub"))
    return result


@router.post("/{spec_id}/obsolete")
def obsolete_spec(
    spec_id: uuid.UUID,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin", "SpecApprover"]))
):
    spec = db.query(SpecificationSheet).filter(
        SpecificationSheet.id == spec_id,
        SpecificationSheet.plant_id == plant_id
    ).first()
    if not spec:
        raise HTTPException(status_code=404, detail="Specification not found")
        
    service = ApprovalService(db)
    return service.obsolete_spec(str(spec_id))
