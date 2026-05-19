from datetime import datetime
from typing import List, Optional
import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr
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

router = APIRouter(prefix="/master/suppliers", tags=["suppliers"])


class SupplierCreate(BaseModel):
    supplier_code: str
    name: str
    category: str = "RAW_MATERIAL"
    contact_name: Optional[str] = None
    contact_phone: Optional[str] = None
    contact_email: Optional[str] = None
    gst_no: Optional[str] = None
    pan_no: Optional[str] = None
    address: Optional[str] = None


class SupplierUpdate(BaseModel):
    supplier_code: Optional[str] = None
    name: Optional[str] = None
    category: Optional[str] = None
    contact_name: Optional[str] = None
    contact_phone: Optional[str] = None
    contact_email: Optional[str] = None
    gst_no: Optional[str] = None
    pan_no: Optional[str] = None
    address: Optional[str] = None
    active: Optional[bool] = None


class SupplierResponse(BaseModel):
    id: uuid.UUID
    supplier_code: str
    name: str
    category: str
    contact_name: Optional[str]
    contact_phone: Optional[str]
    contact_email: Optional[str]
    gst_no: Optional[str]
    pan_no: Optional[str]
    address: Optional[str]
    plant_id: str
    active: bool
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class SupplierContactCreate(BaseModel):
    department: Optional[str] = "General"
    contact_name: str
    contact_phone: Optional[str] = None
    contact_email: Optional[EmailStr] = None
    notes: Optional[str] = None


class SupplierContactUpdate(BaseModel):
    department: Optional[str] = None
    contact_name: Optional[str] = None
    contact_phone: Optional[str] = None
    contact_email: Optional[EmailStr] = None
    notes: Optional[str] = None
    active: Optional[bool] = None


class SupplierContactResponse(BaseModel):
    id: uuid.UUID
    supplier_id: uuid.UUID
    department: str
    contact_name: str
    contact_phone: Optional[str]
    contact_email: Optional[str]
    notes: Optional[str]
    plant_id: str
    active: bool
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


def _clean_code(value: str) -> str:
    return str(value or "").strip().upper().replace(" ", "-")


@router.get("/", response_model=List[SupplierResponse])
def get_suppliers(
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
):
    query = db.query(models.Supplier).filter(models.Supplier.active == True)
    query = apply_plant_scope(query, models.Supplier.plant_id, plant_scope)
    return query.order_by(models.Supplier.name.asc()).all()


@router.post("/", response_model=SupplierResponse)
def create_supplier(
    supplier: SupplierCreate,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin", "Owner"])),
):
    del current_user
    plant_values = accepted_persisted_plant_ids(plant_id)
    code = _clean_code(supplier.supplier_code)
    name = supplier.name.strip()
    if not code or not name:
        raise HTTPException(status_code=400, detail="supplier_code and name are required")

    existing = db.query(models.Supplier).filter(
        models.Supplier.plant_id.in_(plant_values),
        (models.Supplier.supplier_code == code) | (models.Supplier.name == name),
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail="Supplier code or name already exists in this plant")

    model = models.Supplier(
        supplier_code=code,
        name=name,
        category=supplier.category.strip().upper() or "RAW_MATERIAL",
        contact_name=supplier.contact_name,
        contact_phone=supplier.contact_phone,
        contact_email=supplier.contact_email,
        gst_no=supplier.gst_no,
        pan_no=supplier.pan_no,
        address=supplier.address,
        plant_id=plant_id,
    )
    db.add(model)
    db.commit()
    db.refresh(model)
    return model


@router.put("/{supplier_id}", response_model=SupplierResponse)
def update_supplier(
    supplier_id: uuid.UUID,
    payload: SupplierUpdate,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin", "Owner"])),
):
    del current_user
    plant_values = accepted_persisted_plant_ids(plant_id)
    model = db.query(models.Supplier).filter(
        models.Supplier.id == supplier_id,
        models.Supplier.plant_id.in_(plant_values),
    ).first()
    if not model:
        raise HTTPException(status_code=404, detail="Supplier not found")

    updates = payload.model_dump(exclude_unset=True)
    if updates.get("supplier_code") is None and "supplier_code" in updates:
        raise HTTPException(status_code=400, detail="supplier_code cannot be empty")
    if updates.get("name") is None and "name" in updates:
        raise HTTPException(status_code=400, detail="name cannot be empty")
    next_code = _clean_code(updates.get("supplier_code") if "supplier_code" in updates else model.supplier_code)
    next_name = str(updates.get("name") if "name" in updates else model.name).strip()
    if not next_code or not next_name:
        raise HTTPException(status_code=400, detail="supplier_code and name are required")
    duplicate = db.query(models.Supplier).filter(
        models.Supplier.id != supplier_id,
        models.Supplier.plant_id.in_(plant_values),
        (models.Supplier.supplier_code == next_code) | (models.Supplier.name == next_name),
    ).first()
    if duplicate:
        raise HTTPException(status_code=409, detail="Supplier code or name already exists in this plant")

    for key, value in updates.items():
        if key == "supplier_code" and value is not None:
            setattr(model, key, _clean_code(value))
        elif key == "name" and value is not None:
            setattr(model, key, str(value).strip())
        elif key == "category" and value is not None:
            setattr(model, key, str(value).strip().upper())
        else:
            setattr(model, key, value)
    db.commit()
    db.refresh(model)
    return model


@router.delete("/{supplier_id}")
def delete_supplier(
    supplier_id: uuid.UUID,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin", "Owner"])),
):
    del current_user
    plant_values = accepted_persisted_plant_ids(plant_id)
    model = db.query(models.Supplier).filter(
        models.Supplier.id == supplier_id,
        models.Supplier.plant_id.in_(plant_values),
    ).first()
    if not model:
        raise HTTPException(status_code=404, detail="Supplier not found")
    model.active = False
    db.commit()
    return {"message": "Supplier deactivated successfully"}


@router.get("/{supplier_id}/contacts", response_model=List[SupplierContactResponse])
def get_supplier_contacts(
    supplier_id: uuid.UUID,
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
):
    supplier_query = db.query(models.Supplier).filter(models.Supplier.id == supplier_id)
    supplier = apply_plant_scope(supplier_query, models.Supplier.plant_id, plant_scope).first()
    if not supplier:
        raise HTTPException(status_code=404, detail="Supplier not found")
    query = db.query(models.SupplierContact).filter(
        models.SupplierContact.supplier_id == supplier_id,
        models.SupplierContact.active == True,
    )
    query = apply_plant_scope(query, models.SupplierContact.plant_id, plant_scope)
    return query.order_by(models.SupplierContact.department.asc(), models.SupplierContact.contact_name.asc()).all()


@router.post("/{supplier_id}/contacts", response_model=SupplierContactResponse)
def create_supplier_contact(
    supplier_id: uuid.UUID,
    payload: SupplierContactCreate,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin", "Owner"])),
):
    del current_user
    plant_values = accepted_persisted_plant_ids(plant_id)
    supplier = db.query(models.Supplier).filter(
        models.Supplier.id == supplier_id,
        models.Supplier.plant_id.in_(plant_values),
    ).first()
    if not supplier:
        raise HTTPException(status_code=404, detail="Supplier not found")
    contact_name = payload.contact_name.strip()
    if not contact_name:
        raise HTTPException(status_code=422, detail="contact_name is required")
    model = models.SupplierContact(
        supplier_id=supplier_id,
        department=(payload.department or "General").strip() or "General",
        contact_name=contact_name,
        contact_phone=payload.contact_phone,
        contact_email=str(payload.contact_email) if payload.contact_email else None,
        notes=payload.notes,
        plant_id=plant_id,
    )
    db.add(model)
    db.commit()
    db.refresh(model)
    return model


@router.put("/{supplier_id}/contacts/{contact_id}", response_model=SupplierContactResponse)
def update_supplier_contact(
    supplier_id: uuid.UUID,
    contact_id: uuid.UUID,
    payload: SupplierContactUpdate,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin", "Owner"])),
):
    del current_user
    plant_values = accepted_persisted_plant_ids(plant_id)
    model = db.query(models.SupplierContact).filter(
        models.SupplierContact.id == contact_id,
        models.SupplierContact.supplier_id == supplier_id,
        models.SupplierContact.plant_id.in_(plant_values),
    ).first()
    if not model:
        raise HTTPException(status_code=404, detail="Supplier contact not found")
    update_data = payload.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        if field == "department" and value is not None:
            model.department = str(value).strip() or "General"
        elif field == "contact_name" and value is not None:
            resolved_name = str(value).strip()
            if not resolved_name:
                raise HTTPException(status_code=422, detail="contact_name is required")
            model.contact_name = resolved_name
        elif field == "contact_email" and value is not None:
            model.contact_email = str(value)
        else:
            setattr(model, field, value)
    db.commit()
    db.refresh(model)
    return model


@router.delete("/{supplier_id}/contacts/{contact_id}")
def delete_supplier_contact(
    supplier_id: uuid.UUID,
    contact_id: uuid.UUID,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin", "Owner"])),
):
    del current_user
    plant_values = accepted_persisted_plant_ids(plant_id)
    model = db.query(models.SupplierContact).filter(
        models.SupplierContact.id == contact_id,
        models.SupplierContact.supplier_id == supplier_id,
        models.SupplierContact.plant_id.in_(plant_values),
    ).first()
    if not model:
        raise HTTPException(status_code=404, detail="Supplier contact not found")
    model.active = False
    db.commit()
    return {"message": "Supplier contact deactivated successfully"}
