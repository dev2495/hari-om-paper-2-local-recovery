from __future__ import annotations

from datetime import datetime
from typing import List, Optional
import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from .. import models
from ..database import get_db
from ..utils.auth import (
    accepted_persisted_plant_ids,
    apply_plant_scope,
    get_current_plant,
    get_current_plant_scope,
    require_role,
)

router = APIRouter(prefix="/master/packaging", tags=["packaging"])


class BoxCreate(BaseModel):
    code: str
    length_mm: float
    width_mm: float
    height_mm: float
    size_label: str
    weight_kg: Optional[float] = None


class BoxUpdate(BaseModel):
    code: Optional[str] = None
    length_mm: Optional[float] = None
    width_mm: Optional[float] = None
    height_mm: Optional[float] = None
    size_label: Optional[str] = None
    weight_kg: Optional[float] = None
    active: Optional[bool] = None


class BoxResponse(BaseModel):
    id: uuid.UUID
    code: str
    length_mm: float
    width_mm: float
    height_mm: float
    size_label: str
    weight_kg: Optional[float]
    plant_id: str
    active: bool
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class PlasticSheetCreate(BaseModel):
    sku: str
    size_label: str
    weight_kg: Optional[float] = None


class PlasticSheetUpdate(BaseModel):
    sku: Optional[str] = None
    size_label: Optional[str] = None
    weight_kg: Optional[float] = None
    active: Optional[bool] = None


class PlasticSheetResponse(BaseModel):
    id: uuid.UUID
    sku: str
    size_label: str
    weight_kg: Optional[float]
    plant_id: str
    active: bool
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class FaddaCreate(BaseModel):
    sku: str
    weight_kg: Optional[float] = None


class FaddaUpdate(BaseModel):
    sku: Optional[str] = None
    weight_kg: Optional[float] = None
    active: Optional[bool] = None


class FaddaResponse(BaseModel):
    id: uuid.UUID
    sku: str
    weight_kg: Optional[float]
    plant_id: str
    active: bool
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


def _normalize_code(value: Optional[str], label: str) -> str:
    resolved = str(value or "").strip().upper()
    if not resolved:
        raise HTTPException(status_code=422, detail=f"{label} is required")
    return resolved


def _get_box_or_404(db: Session, plant_values: list[str], box_id: uuid.UUID) -> models.PackagingBox:
    model = db.query(models.PackagingBox).filter(
        models.PackagingBox.id == box_id,
        models.PackagingBox.plant_id.in_(plant_values),
    ).first()
    if not model:
        raise HTTPException(status_code=404, detail="Packaging box not found")
    return model


def _get_plastic_or_404(db: Session, plant_values: list[str], plastic_id: uuid.UUID) -> models.PackagingPlasticSheet:
    model = db.query(models.PackagingPlasticSheet).filter(
        models.PackagingPlasticSheet.id == plastic_id,
        models.PackagingPlasticSheet.plant_id.in_(plant_values),
    ).first()
    if not model:
        raise HTTPException(status_code=404, detail="Plastic sheet not found")
    return model


def _get_fadda_or_404(db: Session, plant_values: list[str], fadda_id: uuid.UUID) -> models.PackagingFadda:
    model = db.query(models.PackagingFadda).filter(
        models.PackagingFadda.id == fadda_id,
        models.PackagingFadda.plant_id.in_(plant_values),
    ).first()
    if not model:
        raise HTTPException(status_code=404, detail="Fadda not found")
    return model


@router.get("/boxes", response_model=List[BoxResponse])
def get_boxes(
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
):
    query = db.query(models.PackagingBox).filter(models.PackagingBox.active == True)
    query = apply_plant_scope(query, models.PackagingBox.plant_id, plant_scope)
    return query.order_by(models.PackagingBox.code.asc()).all()


@router.post("/boxes", response_model=BoxResponse)
def create_box(
    payload: BoxCreate,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin"])),
):
    del current_user
    plant_values = accepted_persisted_plant_ids(plant_id)
    code = _normalize_code(payload.code, "code")
    existing = db.query(models.PackagingBox).filter(
        models.PackagingBox.plant_id.in_(plant_values),
        models.PackagingBox.code == code,
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail="Packaging box code already exists in this plant")
    model = models.PackagingBox(
        code=code,
        length_mm=payload.length_mm,
        width_mm=payload.width_mm,
        height_mm=payload.height_mm,
        size_label=payload.size_label.strip(),
        weight_kg=payload.weight_kg,
        plant_id=plant_id,
    )
    db.add(model)
    db.commit()
    db.refresh(model)
    return model


@router.put("/boxes/{box_id}", response_model=BoxResponse)
def update_box(
    box_id: uuid.UUID,
    payload: BoxUpdate,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin"])),
):
    del current_user
    plant_values = accepted_persisted_plant_ids(plant_id)
    model = _get_box_or_404(db, plant_values, box_id)
    update_data = payload.model_dump(exclude_unset=True)
    if "code" in update_data:
        code = _normalize_code(update_data["code"], "code")
        duplicate = db.query(models.PackagingBox).filter(
            models.PackagingBox.id != box_id,
            models.PackagingBox.plant_id.in_(plant_values),
            models.PackagingBox.code == code,
        ).first()
        if duplicate:
            raise HTTPException(status_code=409, detail="Packaging box code already exists in this plant")
        model.code = code
    for key, value in update_data.items():
        if key == "code":
            continue
        if key == "size_label" and value is not None:
            model.size_label = str(value).strip()
        else:
            setattr(model, key, value)
    db.commit()
    db.refresh(model)
    return model


@router.delete("/boxes/{box_id}")
def delete_box(
    box_id: uuid.UUID,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin"])),
):
    del current_user
    plant_values = accepted_persisted_plant_ids(plant_id)
    model = _get_box_or_404(db, plant_values, box_id)
    model.active = False
    db.commit()
    return {"message": "Packaging box deactivated successfully"}


@router.get("/plastic-sheets", response_model=List[PlasticSheetResponse])
def get_plastic_sheets(
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
):
    query = db.query(models.PackagingPlasticSheet).filter(models.PackagingPlasticSheet.active == True)
    query = apply_plant_scope(query, models.PackagingPlasticSheet.plant_id, plant_scope)
    return query.order_by(models.PackagingPlasticSheet.sku.asc()).all()


@router.post("/plastic-sheets", response_model=PlasticSheetResponse)
def create_plastic_sheet(
    payload: PlasticSheetCreate,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin"])),
):
    del current_user
    plant_values = accepted_persisted_plant_ids(plant_id)
    sku = _normalize_code(payload.sku, "sku")
    existing = db.query(models.PackagingPlasticSheet).filter(
        models.PackagingPlasticSheet.plant_id.in_(plant_values),
        models.PackagingPlasticSheet.sku == sku,
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail="Plastic sheet SKU already exists in this plant")
    model = models.PackagingPlasticSheet(
        sku=sku,
        size_label=payload.size_label.strip(),
        weight_kg=payload.weight_kg,
        plant_id=plant_id,
    )
    db.add(model)
    db.commit()
    db.refresh(model)
    return model


@router.put("/plastic-sheets/{plastic_id}", response_model=PlasticSheetResponse)
def update_plastic_sheet(
    plastic_id: uuid.UUID,
    payload: PlasticSheetUpdate,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin"])),
):
    del current_user
    plant_values = accepted_persisted_plant_ids(plant_id)
    model = _get_plastic_or_404(db, plant_values, plastic_id)
    update_data = payload.model_dump(exclude_unset=True)
    if "sku" in update_data:
        sku = _normalize_code(update_data["sku"], "sku")
        duplicate = db.query(models.PackagingPlasticSheet).filter(
            models.PackagingPlasticSheet.id != plastic_id,
            models.PackagingPlasticSheet.plant_id.in_(plant_values),
            models.PackagingPlasticSheet.sku == sku,
        ).first()
        if duplicate:
            raise HTTPException(status_code=409, detail="Plastic sheet SKU already exists in this plant")
        model.sku = sku
    for key, value in update_data.items():
        if key == "sku":
            continue
        if key == "size_label" and value is not None:
            model.size_label = str(value).strip()
        else:
            setattr(model, key, value)
    db.commit()
    db.refresh(model)
    return model


@router.delete("/plastic-sheets/{plastic_id}")
def delete_plastic_sheet(
    plastic_id: uuid.UUID,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin"])),
):
    del current_user
    plant_values = accepted_persisted_plant_ids(plant_id)
    model = _get_plastic_or_404(db, plant_values, plastic_id)
    model.active = False
    db.commit()
    return {"message": "Plastic sheet deactivated successfully"}


@router.get("/fadda", response_model=List[FaddaResponse])
def get_fadda(
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
):
    query = db.query(models.PackagingFadda).filter(models.PackagingFadda.active == True)
    query = apply_plant_scope(query, models.PackagingFadda.plant_id, plant_scope)
    return query.order_by(models.PackagingFadda.sku.asc()).all()


@router.post("/fadda", response_model=FaddaResponse)
def create_fadda(
    payload: FaddaCreate,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin"])),
):
    del current_user
    plant_values = accepted_persisted_plant_ids(plant_id)
    sku = _normalize_code(payload.sku, "sku")
    existing = db.query(models.PackagingFadda).filter(
        models.PackagingFadda.plant_id.in_(plant_values),
        models.PackagingFadda.sku == sku,
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail="Fadda SKU already exists in this plant")
    model = models.PackagingFadda(
        sku=sku,
        weight_kg=payload.weight_kg,
        plant_id=plant_id,
    )
    db.add(model)
    db.commit()
    db.refresh(model)
    return model


@router.put("/fadda/{fadda_id}", response_model=FaddaResponse)
def update_fadda(
    fadda_id: uuid.UUID,
    payload: FaddaUpdate,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin"])),
):
    del current_user
    plant_values = accepted_persisted_plant_ids(plant_id)
    model = _get_fadda_or_404(db, plant_values, fadda_id)
    update_data = payload.model_dump(exclude_unset=True)
    if "sku" in update_data:
        sku = _normalize_code(update_data["sku"], "sku")
        duplicate = db.query(models.PackagingFadda).filter(
            models.PackagingFadda.id != fadda_id,
            models.PackagingFadda.plant_id.in_(plant_values),
            models.PackagingFadda.sku == sku,
        ).first()
        if duplicate:
            raise HTTPException(status_code=409, detail="Fadda SKU already exists in this plant")
        model.sku = sku
    for key, value in update_data.items():
        if key != "sku":
            setattr(model, key, value)
    db.commit()
    db.refresh(model)
    return model


@router.delete("/fadda/{fadda_id}")
def delete_fadda(
    fadda_id: uuid.UUID,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin"])),
):
    del current_user
    plant_values = accepted_persisted_plant_ids(plant_id)
    model = _get_fadda_or_404(db, plant_values, fadda_id)
    model.active = False
    db.commit()
    return {"message": "Fadda deactivated successfully"}
