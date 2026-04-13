from __future__ import annotations

import re
import uuid
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from .. import models
from ..database import get_db
from ..utils.auth import get_current_plant, get_plant_aliases, require_role

router = APIRouter(prefix="/master/packaging", tags=["packaging"])

BOX_DIMENSION_PATTERN = re.compile(r"(?P<l>\d+(?:\.\d+)?)\s*[xX]\s*(?P<w>\d+(?:\.\d+)?)\s*[xX]\s*(?P<h>\d+(?:\.\d+)?)")


class PackagingBoxCreate(BaseModel):
    code: str
    length_mm: float
    width_mm: float
    height_mm: float
    size_label: str
    weight_kg: Optional[float] = None
    rate_per_piece: Optional[float] = None


class PackagingBoxUpdate(BaseModel):
    code: Optional[str] = None
    length_mm: Optional[float] = None
    width_mm: Optional[float] = None
    height_mm: Optional[float] = None
    size_label: Optional[str] = None
    weight_kg: Optional[float] = None
    rate_per_piece: Optional[float] = None
    active: Optional[bool] = None


class PackagingBoxResponse(BaseModel):
    id: uuid.UUID | str
    code: str
    length_mm: float
    width_mm: float
    height_mm: float
    size_label: str
    weight_kg: Optional[float] = None
    rate_per_piece: Optional[float] = None
    plant_id: str
    active: bool
    created_at: Optional[datetime] = None
    source: str = "PACKAGING_BOX"

    class Config:
        from_attributes = True


class PackagingPlasticSheetCreate(BaseModel):
    sku: str
    size_label: str
    weight_kg: Optional[float] = None
    rate_per_kg: Optional[float] = None
    rate_per_piece: Optional[float] = None


class PackagingPlasticSheetUpdate(BaseModel):
    sku: Optional[str] = None
    size_label: Optional[str] = None
    weight_kg: Optional[float] = None
    rate_per_kg: Optional[float] = None
    rate_per_piece: Optional[float] = None
    active: Optional[bool] = None


class PackagingPlasticSheetResponse(BaseModel):
    id: uuid.UUID
    sku: str
    size_label: str
    weight_kg: Optional[float] = None
    rate_per_kg: Optional[float] = None
    rate_per_piece: Optional[float] = None
    plant_id: str
    active: bool
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class PackagingFaddaCreate(BaseModel):
    sku: str
    weight_kg: Optional[float] = None
    rate_per_kg: Optional[float] = None
    rate_per_piece: Optional[float] = None


class PackagingFaddaUpdate(BaseModel):
    sku: Optional[str] = None
    weight_kg: Optional[float] = None
    rate_per_kg: Optional[float] = None
    rate_per_piece: Optional[float] = None
    active: Optional[bool] = None


class PackagingFaddaResponse(BaseModel):
    id: uuid.UUID
    sku: str
    weight_kg: Optional[float] = None
    rate_per_kg: Optional[float] = None
    rate_per_piece: Optional[float] = None
    plant_id: str
    active: bool
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


def _tool_box_fallback(db: Session, plant_id: str) -> list[PackagingBoxResponse]:
    plant_aliases = get_plant_aliases(plant_id)
    tools = (
        db.query(models.ToolMaster)
        .filter(
            models.ToolMaster.plant_id.in_(plant_aliases),
            models.ToolMaster.category == "BOX",
            models.ToolMaster.active == True,
        )
        .order_by(models.ToolMaster.name.asc())
        .all()
    )
    derived: list[PackagingBoxResponse] = []
    for tool in tools:
        match = BOX_DIMENSION_PATTERN.search(str(tool.name or ""))
        if not match:
            continue
        dims = {key: float(value) for key, value in match.groupdict().items()}
        code = str(tool.code or tool.name.split("Size")[0].strip() or tool.name).strip()
        derived.append(
            PackagingBoxResponse(
                id=str(tool.id),
                code=code,
                length_mm=dims["l"],
                width_mm=dims["w"],
                height_mm=dims["h"],
                size_label=str(tool.name),
                weight_kg=None,
                rate_per_piece=None,
                plant_id=plant_id,
                active=bool(tool.active),
                created_at=tool.created_at,
                source="TOOL_MASTER",
            )
        )
    return derived


@router.get("/boxes", response_model=List[PackagingBoxResponse])
def get_boxes(
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
):
    plant_aliases = get_plant_aliases(plant_id)
    rows = (
        db.query(models.PackagingBox)
        .filter(models.PackagingBox.plant_id.in_(plant_aliases), models.PackagingBox.active == True)
        .order_by(models.PackagingBox.code.asc())
        .all()
    )
    if rows:
        return [PackagingBoxResponse.model_validate(row, from_attributes=True) for row in rows]
    return _tool_box_fallback(db, plant_id)


@router.post("/boxes", response_model=PackagingBoxResponse)
def create_box(
    payload: PackagingBoxCreate,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin"])),
):
    row = models.PackagingBox(**payload.model_dump(), plant_id=plant_id)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.put("/boxes/{box_id}", response_model=PackagingBoxResponse)
def update_box(
    box_id: uuid.UUID,
    payload: PackagingBoxUpdate,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin"])),
):
    row = (
        db.query(models.PackagingBox)
        .filter(models.PackagingBox.id == box_id, models.PackagingBox.plant_id == plant_id)
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Packaging box not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(row, field, value)
    db.commit()
    db.refresh(row)
    return row


@router.delete("/boxes/{box_id}")
def delete_box(
    box_id: uuid.UUID,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin"])),
):
    row = (
        db.query(models.PackagingBox)
        .filter(models.PackagingBox.id == box_id, models.PackagingBox.plant_id == plant_id)
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Packaging box not found")
    row.active = False
    db.commit()
    return {"message": "Packaging box deactivated successfully"}


@router.get("/plastic-sheets", response_model=List[PackagingPlasticSheetResponse])
def get_plastic_sheets(
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
):
    plant_aliases = get_plant_aliases(plant_id)
    return (
        db.query(models.PackagingPlasticSheet)
        .filter(
            models.PackagingPlasticSheet.plant_id.in_(plant_aliases),
            models.PackagingPlasticSheet.active == True,
        )
        .order_by(models.PackagingPlasticSheet.sku.asc())
        .all()
    )


@router.post("/plastic-sheets", response_model=PackagingPlasticSheetResponse)
def create_plastic_sheet(
    payload: PackagingPlasticSheetCreate,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin"])),
):
    row = models.PackagingPlasticSheet(**payload.model_dump(), plant_id=plant_id)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.put("/plastic-sheets/{plastic_id}", response_model=PackagingPlasticSheetResponse)
def update_plastic_sheet(
    plastic_id: uuid.UUID,
    payload: PackagingPlasticSheetUpdate,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin"])),
):
    row = (
        db.query(models.PackagingPlasticSheet)
        .filter(models.PackagingPlasticSheet.id == plastic_id, models.PackagingPlasticSheet.plant_id == plant_id)
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Plastic sheet not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(row, field, value)
    db.commit()
    db.refresh(row)
    return row


@router.delete("/plastic-sheets/{plastic_id}")
def delete_plastic_sheet(
    plastic_id: uuid.UUID,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin"])),
):
    row = (
        db.query(models.PackagingPlasticSheet)
        .filter(models.PackagingPlasticSheet.id == plastic_id, models.PackagingPlasticSheet.plant_id == plant_id)
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Plastic sheet not found")
    row.active = False
    db.commit()
    return {"message": "Plastic sheet deactivated successfully"}


@router.get("/fadda", response_model=List[PackagingFaddaResponse])
def get_fadda(
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
):
    plant_aliases = get_plant_aliases(plant_id)
    return (
        db.query(models.PackagingFadda)
        .filter(models.PackagingFadda.plant_id.in_(plant_aliases), models.PackagingFadda.active == True)
        .order_by(models.PackagingFadda.sku.asc())
        .all()
    )


@router.post("/fadda", response_model=PackagingFaddaResponse)
def create_fadda(
    payload: PackagingFaddaCreate,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin"])),
):
    row = models.PackagingFadda(**payload.model_dump(), plant_id=plant_id)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.put("/fadda/{fadda_id}", response_model=PackagingFaddaResponse)
def update_fadda(
    fadda_id: uuid.UUID,
    payload: PackagingFaddaUpdate,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin"])),
):
    row = (
        db.query(models.PackagingFadda)
        .filter(models.PackagingFadda.id == fadda_id, models.PackagingFadda.plant_id == plant_id)
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Fadda not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(row, field, value)
    db.commit()
    db.refresh(row)
    return row


@router.delete("/fadda/{fadda_id}")
def delete_fadda(
    fadda_id: uuid.UUID,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin"])),
):
    row = (
        db.query(models.PackagingFadda)
        .filter(models.PackagingFadda.id == fadda_id, models.PackagingFadda.plant_id == plant_id)
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Fadda not found")
    row.active = False
    db.commit()
    return {"message": "Fadda deactivated successfully"}
