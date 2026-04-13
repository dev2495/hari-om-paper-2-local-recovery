from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from pydantic import BaseModel
from datetime import datetime
import uuid
from ..database import get_db
from ..models import ItemMaster
from ..utils.auth import get_current_user, require_role, get_current_plant

router = APIRouter(prefix="/items", tags=["items"])

# Pydantic schemas
class ItemCreate(BaseModel):
    item_code: str
    name: str
    type: str  # RAW_PAPER, ADHESIVE, PARCHMENT, FINISHED_GOOD
    uom: str   # KG, PCS

class ItemResponse(BaseModel):
    id: uuid.UUID
    item_code: str
    name: str
    type: str
    uom: str
    plant_id: str
    active: str
    created_at: datetime

    class Config:
        from_attributes = True

@router.get("/", response_model=List[ItemResponse])
def get_items(
    type: str = None,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(get_current_user)
):
    """List all active items"""
    query = db.query(ItemMaster).filter(
        ItemMaster.active == "true",
        ItemMaster.plant_id == plant_id
    )
    
    if type:
        query = query.filter(ItemMaster.type == type)
    
    return query.all()

@router.post("/", response_model=ItemResponse)
def create_item(
    item: ItemCreate,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin"]))
):
    """Create new item (Admin only)"""
    # Check if item_code already exists in this plant
    existing = db.query(ItemMaster).filter(
        ItemMaster.item_code == item.item_code,
        ItemMaster.plant_id == plant_id
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail=f"Item code '{item.item_code}' already exists in this plant")
    
    db_item = ItemMaster(**item.model_dump(), plant_id=plant_id)
    db.add(db_item)
    db.commit()
    db.refresh(db_item)
    return db_item

@router.get("/{item_id}", response_model=ItemResponse)
def get_item(
    item_id: uuid.UUID,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(get_current_user)
):
    """Get item details"""
    item = db.query(ItemMaster).filter(
        ItemMaster.id == item_id,
        ItemMaster.plant_id == plant_id
    ).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    return item
