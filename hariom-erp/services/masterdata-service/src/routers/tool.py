from datetime import datetime
from typing import List, Optional
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from .. import models
from ..utils.auth import (
    accepted_persisted_plant_ids,
    apply_plant_scope,
    get_current_plant,
    get_current_plant_scope,
    require_role,
)


router = APIRouter(prefix="/master/tools", tags=["tools"])


class ToolCreate(BaseModel):
    category: str
    subcategory: Optional[str] = None
    name: str
    code: Optional[str] = None
    spec_text: Optional[str] = None
    department: str = "COMMON"


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
    subcategory: Optional[str]
    name: str
    code: Optional[str]
    spec_text: Optional[str]
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
    plant_scope: dict = Depends(get_current_plant_scope),
):
    query = db.query(models.ToolMaster).filter(models.ToolMaster.active == True)
    query = apply_plant_scope(query, models.ToolMaster.plant_id, plant_scope)
    if category:
        query = query.filter(models.ToolMaster.category.ilike(category.strip()))
    if department:
        query = query.filter(models.ToolMaster.department.ilike(department.strip()))
    return query.order_by(models.ToolMaster.category.asc(), models.ToolMaster.name.asc()).all()


@router.get("/{tool_id}", response_model=ToolResponse)
def get_tool(
    tool_id: uuid.UUID,
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
):
    query = db.query(models.ToolMaster).filter(
        models.ToolMaster.id == tool_id,
        models.ToolMaster.active == True,
    )
    tool = apply_plant_scope(query, models.ToolMaster.plant_id, plant_scope).first()
    if not tool:
        raise HTTPException(status_code=404, detail="Tool not found")
    return tool


@router.post("/", response_model=ToolResponse)
def create_tool(
    payload: ToolCreate,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin"])),
):
    model = models.ToolMaster(**payload.model_dump(), plant_id=plant_id)
    db.add(model)
    db.commit()
    db.refresh(model)
    return model


@router.put("/{tool_id}", response_model=ToolResponse)
def update_tool(
    tool_id: uuid.UUID,
    payload: ToolUpdate,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin"])),
):
    plant_values = accepted_persisted_plant_ids(plant_id)
    model = db.query(models.ToolMaster).filter(
        models.ToolMaster.id == tool_id,
        models.ToolMaster.plant_id.in_(plant_values),
    ).first()
    if not model:
        raise HTTPException(status_code=404, detail="Tool not found")

    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(model, key, value)
    db.commit()
    db.refresh(model)
    return model


@router.delete("/{tool_id}")
def delete_tool(
    tool_id: uuid.UUID,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin"])),
):
    plant_values = accepted_persisted_plant_ids(plant_id)
    model = db.query(models.ToolMaster).filter(
        models.ToolMaster.id == tool_id,
        models.ToolMaster.plant_id.in_(plant_values),
    ).first()
    if not model:
        raise HTTPException(status_code=404, detail="Tool not found")

    model.active = False
    db.commit()
    return {"message": "Tool deactivated successfully"}
