from datetime import datetime
from typing import List, Optional
import uuid
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from ..database import get_db
from ..models import SpecDynamicField
from ..utils.auth import get_current_user, require_role, get_current_plant

router = APIRouter(prefix="/spec-fields", tags=["spec-fields"])


class FieldCreate(BaseModel):
    key: str
    label: str
    field_type: str  # text, number, boolean, select
    required: bool = False
    options: Optional[list[str]] = None


class FieldUpdate(BaseModel):
    label: Optional[str] = None
    field_type: Optional[str] = None
    required: Optional[bool] = None
    options: Optional[list[str]] = None
    active: Optional[bool] = None


class FieldResponse(BaseModel):
    id: uuid.UUID
    key: str
    label: str
    field_type: str
    required: bool
    options: Optional[list[str]]
    plant_id: str
    active: bool
    created_at: datetime

    class Config:
        from_attributes = True


@router.post("/", response_model=FieldResponse)
def create_field(
    payload: FieldCreate,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin", "SpecMaker"]))
):
    existing = db.query(SpecDynamicField).filter(
        SpecDynamicField.key == payload.key,
        SpecDynamicField.plant_id == plant_id
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="Field key already exists in this plant")
    model = SpecDynamicField(**payload.model_dump(), plant_id=plant_id)
    db.add(model)
    db.commit()
    db.refresh(model)
    return model


@router.get("/", response_model=List[FieldResponse])
def get_fields(
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(get_current_user)
):
    return db.query(SpecDynamicField).filter(
        SpecDynamicField.plant_id == plant_id
    ).order_by(SpecDynamicField.key.asc()).all()


@router.put("/{field_id}", response_model=FieldResponse)
def update_field(
    field_id: uuid.UUID,
    payload: FieldUpdate,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin", "SpecMaker"]))
):
    field = db.query(SpecDynamicField).filter(
        SpecDynamicField.id == field_id,
        SpecDynamicField.plant_id == plant_id
    ).first()
    if not field:
        raise HTTPException(status_code=404, detail="Field not found")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(field, key, value)
    db.commit()
    db.refresh(field)
    return field


@router.delete("/{field_id}")
def delete_field(
    field_id: uuid.UUID,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin"]))
):
    field = db.query(SpecDynamicField).filter(
        SpecDynamicField.id == field_id,
        SpecDynamicField.plant_id == plant_id
    ).first()
    if not field:
        raise HTTPException(status_code=404, detail="Field not found")
    field.active = False
    db.commit()
    return {"message": "Field deactivated"}
