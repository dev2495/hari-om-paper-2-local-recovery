from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Optional
from pydantic import BaseModel
import uuid
from datetime import datetime
from ..database import get_db
from .. import models
from ..utils.auth import get_current_user, require_role, get_current_plant, get_plant_aliases

router = APIRouter(prefix="/master/parchment", tags=["parchment"])

class VendorCreate(BaseModel):
    name: str

class VendorUpdate(BaseModel):
    name: Optional[str] = None
    active: Optional[bool] = None

class VendorResponse(BaseModel):
    id: uuid.UUID
    name: str
    plant_id: str
    active: bool
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True

class ColorCreate(BaseModel):
    vendor_id: uuid.UUID
    color_name: str

class ColorUpdate(BaseModel):
    vendor_id: Optional[uuid.UUID] = None
    color_name: Optional[str] = None
    active: Optional[bool] = None

class ColorResponse(BaseModel):
    id: uuid.UUID
    vendor_id: uuid.UUID
    color_name: str
    plant_id: str
    active: bool
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True

class VendorWithColors(VendorResponse):
    colors: List[ColorResponse]

@router.get("/vendors", response_model=List[VendorResponse])
def get_vendors(
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant)
):
    plant_aliases = get_plant_aliases(plant_id)
    return db.query(models.ParchmentVendor).filter(
        models.ParchmentVendor.plant_id.in_(plant_aliases),
        models.ParchmentVendor.active == True
    ).all()

@router.get("/vendors/{vendor_id}", response_model=VendorWithColors)
def get_vendor(
    vendor_id: uuid.UUID,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant)
):
    vendor = db.query(models.ParchmentVendor).filter(
        models.ParchmentVendor.id == vendor_id,
        models.ParchmentVendor.plant_id == plant_id,
        models.ParchmentVendor.active == True
    ).first()
    if not vendor:
        raise HTTPException(status_code=404, detail="Vendor not found")
    return vendor

@router.post("/vendors", response_model=VendorResponse)
def create_vendor(
    vendor: VendorCreate,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin"]))
):
    db_vendor = models.ParchmentVendor(**vendor.model_dump(), plant_id=plant_id)
    db.add(db_vendor)
    db.commit()
    db.refresh(db_vendor)
    return db_vendor

@router.put("/vendors/{vendor_id}", response_model=VendorResponse)
def update_vendor(
    vendor_id: uuid.UUID,
    vendor_update: VendorUpdate,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin"]))
):
    db_vendor = db.query(models.ParchmentVendor).filter(
        models.ParchmentVendor.id == vendor_id,
        models.ParchmentVendor.plant_id == plant_id
    ).first()
    if not db_vendor:
        raise HTTPException(status_code=404, detail="Vendor not found")
    
    update_data = vendor_update.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(db_vendor, field, value)
    
    db.commit()
    db.refresh(db_vendor)
    return db_vendor

@router.delete("/vendors/{vendor_id}")
def delete_vendor(
    vendor_id: uuid.UUID,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin"]))
):
    db_vendor = db.query(models.ParchmentVendor).filter(
        models.ParchmentVendor.id == vendor_id,
        models.ParchmentVendor.plant_id == plant_id
    ).first()
    if not db_vendor:
        raise HTTPException(status_code=404, detail="Vendor not found")
    
    db_vendor.active = False
    db.commit()
    return {"message": "Vendor deactivated successfully"}

@router.get("/colors", response_model=List[ColorResponse])
def get_colors(
    vendor_id: Optional[uuid.UUID] = None,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant)
):
    plant_aliases = get_plant_aliases(plant_id)
    query = db.query(models.ParchmentColor).filter(
        models.ParchmentColor.plant_id.in_(plant_aliases),
        models.ParchmentColor.active == True
    )
    if vendor_id:
        query = query.filter(models.ParchmentColor.vendor_id == vendor_id)
    return query.all()

@router.get("/colors/{color_id}", response_model=ColorResponse)
def get_color(
    color_id: uuid.UUID,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant)
):
    color = db.query(models.ParchmentColor).filter(
        models.ParchmentColor.id == color_id,
        models.ParchmentColor.plant_id == plant_id,
        models.ParchmentColor.active == True
    ).first()
    if not color:
        raise HTTPException(status_code=404, detail="Color not found")
    return color

@router.post("/colors", response_model=ColorResponse)
def create_color(
    color: ColorCreate,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin"]))
):
    db_color = models.ParchmentColor(**color.model_dump(), plant_id=plant_id)
    db.add(db_color)
    db.commit()
    db.refresh(db_color)
    return db_color

@router.put("/colors/{color_id}", response_model=ColorResponse)
def update_color(
    color_id: uuid.UUID,
    color_update: ColorUpdate,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin"]))
):
    db_color = db.query(models.ParchmentColor).filter(
        models.ParchmentColor.id == color_id,
        models.ParchmentColor.plant_id == plant_id
    ).first()
    if not db_color:
        raise HTTPException(status_code=404, detail="Color not found")
    
    update_data = color_update.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(db_color, field, value)
    
    db.commit()
    db.refresh(db_color)
    return db_color

@router.delete("/colors/{color_id}")
def delete_color(
    color_id: uuid.UUID,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin"]))
):
    db_color = db.query(models.ParchmentColor).filter(
        models.ParchmentColor.id == color_id,
        models.ParchmentColor.plant_id == plant_id
    ).first()
    if not db_color:
        raise HTTPException(status_code=404, detail="Color not found")
    
    db_color.active = False
    db.commit()
    return {"message": "Color deactivated successfully"}
