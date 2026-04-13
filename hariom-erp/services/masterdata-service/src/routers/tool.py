from __future__ import annotations

import uuid
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from .. import models
from ..database import get_db
from ..utils.auth import get_current_plant, get_plant_aliases, require_role

router = APIRouter(prefix="/master/tools", tags=["tools"])


class ToolCreate(BaseModel):
    category: str
    subcategory: Optional[str] = None
    name: str
    code: Optional[str] = None
    spec_text: Optional[str] = None
    department: str


class ToolUpdate(BaseModel):
    category: Optional[str] = None
    subcategory: Optional[str] = None
    name: Optional[str] = None
    code: Optional[str] = None
    spec_text: Optional[str] = None
    department: Optional[str] = None
    active: Optional[bool] = None


class ToolResponse(BaseModel):
    id: uuid.UUID
    category: str
    subcategory: Optional[str] = None
    name: str
    code: Optional[str] = None
    spec_text: Optional[str] = None
    department: str
    plant_id: str
    active: bool
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


@router.get("/", response_model=List[ToolResponse])
def get_tools(
    category: Optional[str] = Query(default=None),
    department: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
):
    plant_aliases = get_plant_aliases(plant_id)
    query = db.query(models.ToolMaster).filter(
        models.ToolMaster.plant_id.in_(plant_aliases),
        models.ToolMaster.active == True,
    )
    if category:
        query = query.filter(models.ToolMaster.category == category)
    if department:
        query = query.filter(models.ToolMaster.department == department)
    return query.order_by(models.ToolMaster.category.asc(), models.ToolMaster.name.asc()).all()


@router.post("/", response_model=ToolResponse)
def create_tool(
    payload: ToolCreate,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin"])),
):
    row = models.ToolMaster(**payload.model_dump(), plant_id=plant_id)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.put("/{tool_id}", response_model=ToolResponse)
def update_tool(
    tool_id: uuid.UUID,
    payload: ToolUpdate,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin"])),
):
    row = (
        db.query(models.ToolMaster)
        .filter(models.ToolMaster.id == tool_id, models.ToolMaster.plant_id == plant_id)
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Tool not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(row, field, value)
    db.commit()
    db.refresh(row)
    return row


@router.delete("/{tool_id}")
def delete_tool(
    tool_id: uuid.UUID,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin"])),
):
    row = (
        db.query(models.ToolMaster)
        .filter(models.ToolMaster.id == tool_id, models.ToolMaster.plant_id == plant_id)
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Tool not found")
    row.active = False
    db.commit()
    return {"message": "Tool deactivated successfully"}
