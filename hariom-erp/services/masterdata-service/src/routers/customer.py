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
    require_role,
    get_current_plant,
    get_current_plant_scope,
)

router = APIRouter(prefix="/master/customers", tags=["customers"])


class CustomerCreate(BaseModel):
    customer_code: str
    name: str
    address: Optional[str] = None
    billing_address: Optional[str] = None
    shipping_address: Optional[str] = None
    pan_no: Optional[str] = None
    gst_no: Optional[str] = None
    primary_contact_name: Optional[str] = None
    primary_contact_phone: Optional[str] = None
    primary_contact_email: Optional[EmailStr] = None
    contact_email: Optional[EmailStr] = None
    contact_phone: Optional[str] = None
    dispatch_contact_name: Optional[str] = None
    dispatch_contact_phone: Optional[str] = None
    tax_id: Optional[str] = None


class CustomerUpdate(BaseModel):
    customer_code: Optional[str] = None
    name: Optional[str] = None
    address: Optional[str] = None
    billing_address: Optional[str] = None
    shipping_address: Optional[str] = None
    pan_no: Optional[str] = None
    gst_no: Optional[str] = None
    primary_contact_name: Optional[str] = None
    primary_contact_phone: Optional[str] = None
    primary_contact_email: Optional[EmailStr] = None
    contact_email: Optional[EmailStr] = None
    contact_phone: Optional[str] = None
    dispatch_contact_name: Optional[str] = None
    dispatch_contact_phone: Optional[str] = None
    tax_id: Optional[str] = None
    active: Optional[bool] = None


class CustomerResponse(BaseModel):
    id: uuid.UUID
    customer_code: str
    name: str
    address: Optional[str]
    pan_no: Optional[str]
    gst_no: Optional[str]
    primary_contact_name: Optional[str]
    primary_contact_phone: Optional[str]
    primary_contact_email: Optional[str]
    contact_email: Optional[str]
    contact_phone: Optional[str]
    billing_address: Optional[str]
    shipping_address: Optional[str]
    tax_id: Optional[str]
    dispatch_contact_name: Optional[str]
    dispatch_contact_phone: Optional[str]
    plant_id: str
    active: bool
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class CustomerContactCreate(BaseModel):
    department: str
    contact_name: str
    contact_phone: Optional[str] = None
    contact_email: Optional[EmailStr] = None
    notes: Optional[str] = None


class CustomerContactUpdate(BaseModel):
    department: Optional[str] = None
    contact_name: Optional[str] = None
    contact_phone: Optional[str] = None
    contact_email: Optional[EmailStr] = None
    notes: Optional[str] = None
    active: Optional[bool] = None


class CustomerContactResponse(BaseModel):
    id: uuid.UUID
    customer_id: uuid.UUID
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


def _normalized_code(value: Optional[str]) -> str:
    resolved = str(value or "").strip().upper()
    if not resolved:
        raise HTTPException(status_code=422, detail="customer_code is required")
    return resolved


def _normalized_name(value: Optional[str]) -> str:
    resolved = str(value or "").strip()
    if not resolved:
        raise HTTPException(status_code=422, detail="name is required")
    return resolved


def _customer_payload(data: dict) -> dict:
    address = data.get("address")
    primary_contact_email = data.get("primary_contact_email")
    primary_contact_phone = data.get("primary_contact_phone")
    primary_contact_name = data.get("primary_contact_name")
    gst_no = data.get("gst_no")
    contact_email = data.get("contact_email") or primary_contact_email
    contact_phone = data.get("contact_phone") or primary_contact_phone
    billing_address = data.get("billing_address") or address
    shipping_address = data.get("shipping_address") or address
    tax_id = data.get("tax_id") or gst_no
    dispatch_contact_name = data.get("dispatch_contact_name") or primary_contact_name
    dispatch_contact_phone = data.get("dispatch_contact_phone") or primary_contact_phone
    return {
        "customer_code": _normalized_code(data.get("customer_code")),
        "name": _normalized_name(data.get("name")),
        "address": address,
        "billing_address": billing_address,
        "shipping_address": shipping_address,
        "pan_no": data.get("pan_no"),
        "gst_no": gst_no,
        "primary_contact_name": primary_contact_name,
        "primary_contact_phone": primary_contact_phone,
        "primary_contact_email": primary_contact_email,
        "contact_email": contact_email,
        "contact_phone": contact_phone,
        "tax_id": tax_id,
        "dispatch_contact_name": dispatch_contact_name,
        "dispatch_contact_phone": dispatch_contact_phone,
    }


def _apply_customer_update(model: models.Customer, update_data: dict) -> None:
    if "customer_code" in update_data:
        model.customer_code = _normalized_code(update_data.get("customer_code"))
    if "name" in update_data:
        model.name = _normalized_name(update_data.get("name"))
    if "address" in update_data:
        model.address = update_data.get("address")
        if "billing_address" not in update_data:
            model.billing_address = update_data.get("address")
        if "shipping_address" not in update_data:
            model.shipping_address = update_data.get("address")
    if "billing_address" in update_data:
        model.billing_address = update_data.get("billing_address") or model.address
    if "shipping_address" in update_data:
        model.shipping_address = update_data.get("shipping_address") or model.address
    if "pan_no" in update_data:
        model.pan_no = update_data.get("pan_no")
    if "gst_no" in update_data:
        model.gst_no = update_data.get("gst_no")
        model.tax_id = update_data.get("gst_no")
    if "primary_contact_name" in update_data:
        model.primary_contact_name = update_data.get("primary_contact_name")
        model.dispatch_contact_name = update_data.get("primary_contact_name")
    if "primary_contact_phone" in update_data:
        model.primary_contact_phone = update_data.get("primary_contact_phone")
        model.contact_phone = update_data.get("primary_contact_phone")
        model.dispatch_contact_phone = update_data.get("primary_contact_phone")
    if "primary_contact_email" in update_data:
        model.primary_contact_email = update_data.get("primary_contact_email")
        model.contact_email = update_data.get("primary_contact_email")
    if "contact_phone" in update_data:
        model.contact_phone = update_data.get("contact_phone")
    if "contact_email" in update_data:
        model.contact_email = update_data.get("contact_email")
    if "dispatch_contact_name" in update_data:
        model.dispatch_contact_name = update_data.get("dispatch_contact_name")
    if "dispatch_contact_phone" in update_data:
        model.dispatch_contact_phone = update_data.get("dispatch_contact_phone")
    if "tax_id" in update_data:
        model.tax_id = update_data.get("tax_id")
    if "active" in update_data:
        model.active = bool(update_data.get("active"))


@router.get("/", response_model=List[CustomerResponse])
def get_customers(
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope)
):
    query = db.query(models.Customer).filter(models.Customer.active == True)
    query = apply_plant_scope(query, models.Customer.plant_id, plant_scope)
    return query.order_by(models.Customer.name.asc()).all()


@router.get("/{customer_id}", response_model=CustomerResponse)
def get_customer(
    customer_id: uuid.UUID,
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope)
):
    query = db.query(models.Customer).filter(models.Customer.id == customer_id)
    customer = apply_plant_scope(query, models.Customer.plant_id, plant_scope).first()
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    return customer


@router.post("/", response_model=CustomerResponse)
def create_customer(
    customer: CustomerCreate,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin"]))
):
    del current_user
    plant_values = accepted_persisted_plant_ids(plant_id)
    payload = _customer_payload(customer.model_dump())
    exists = db.query(models.Customer).filter(
        models.Customer.plant_id.in_(plant_values),
        (models.Customer.customer_code == payload["customer_code"]) | (models.Customer.name == payload["name"])
    ).first()
    if exists:
        raise HTTPException(status_code=400, detail="Customer code or name already exists in this plant")
    db_customer = models.Customer(**payload, plant_id=plant_id)
    db.add(db_customer)
    db.commit()
    db.refresh(db_customer)
    return db_customer


@router.put("/{customer_id}", response_model=CustomerResponse)
def update_customer(
    customer_id: uuid.UUID,
    customer_update: CustomerUpdate,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin"]))
):
    del current_user
    plant_values = accepted_persisted_plant_ids(plant_id)
    db_customer = db.query(models.Customer).filter(
        models.Customer.id == customer_id,
        models.Customer.plant_id.in_(plant_values),
    ).first()
    if not db_customer:
        raise HTTPException(status_code=404, detail="Customer not found")

    update_data = customer_update.model_dump(exclude_unset=True)
    next_code = _normalized_code(update_data.get("customer_code", db_customer.customer_code))
    next_name = _normalized_name(update_data.get("name", db_customer.name))
    duplicate = db.query(models.Customer).filter(
        models.Customer.id != customer_id,
        models.Customer.plant_id.in_(plant_values),
        (models.Customer.customer_code == next_code) | (models.Customer.name == next_name),
    ).first()
    if duplicate:
        raise HTTPException(status_code=400, detail="Customer code or name already exists in this plant")

    _apply_customer_update(db_customer, update_data)
    db.commit()
    db.refresh(db_customer)
    return db_customer


@router.delete("/{customer_id}")
def deactivate_customer(
    customer_id: uuid.UUID,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin"]))
):
    del current_user
    plant_values = accepted_persisted_plant_ids(plant_id)
    db_customer = db.query(models.Customer).filter(
        models.Customer.id == customer_id,
        models.Customer.plant_id.in_(plant_values),
    ).first()
    if not db_customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    db_customer.active = False
    db.commit()
    return {"message": "Customer deactivated successfully"}


@router.get("/{customer_id}/contacts", response_model=List[CustomerContactResponse])
def get_customer_contacts(
    customer_id: uuid.UUID,
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
):
    customer_query = db.query(models.Customer).filter(models.Customer.id == customer_id)
    customer = apply_plant_scope(customer_query, models.Customer.plant_id, plant_scope).first()
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    query = db.query(models.CustomerContact).filter(
        models.CustomerContact.customer_id == customer_id,
        models.CustomerContact.active == True,
    )
    query = apply_plant_scope(query, models.CustomerContact.plant_id, plant_scope)
    return query.order_by(models.CustomerContact.department.asc(), models.CustomerContact.contact_name.asc()).all()


@router.post("/{customer_id}/contacts", response_model=CustomerContactResponse)
def create_customer_contact(
    customer_id: uuid.UUID,
    payload: CustomerContactCreate,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin"])),
):
    del current_user
    plant_values = accepted_persisted_plant_ids(plant_id)
    customer = db.query(models.Customer).filter(
        models.Customer.id == customer_id,
        models.Customer.plant_id.in_(plant_values),
    ).first()
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    model = models.CustomerContact(
        customer_id=customer_id,
        department=payload.department.strip(),
        contact_name=payload.contact_name.strip(),
        contact_phone=payload.contact_phone,
        contact_email=str(payload.contact_email) if payload.contact_email else None,
        notes=payload.notes,
        plant_id=plant_id,
    )
    db.add(model)
    db.commit()
    db.refresh(model)
    return model


@router.put("/{customer_id}/contacts/{contact_id}", response_model=CustomerContactResponse)
def update_customer_contact(
    customer_id: uuid.UUID,
    contact_id: uuid.UUID,
    payload: CustomerContactUpdate,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin"])),
):
    del current_user
    plant_values = accepted_persisted_plant_ids(plant_id)
    model = db.query(models.CustomerContact).filter(
        models.CustomerContact.id == contact_id,
        models.CustomerContact.customer_id == customer_id,
        models.CustomerContact.plant_id.in_(plant_values),
    ).first()
    if not model:
        raise HTTPException(status_code=404, detail="Customer contact not found")
    update_data = payload.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        if field in {"department", "contact_name"} and value is not None:
            setattr(model, field, str(value).strip())
        elif field == "contact_email" and value is not None:
            model.contact_email = str(value)
        else:
            setattr(model, field, value)
    db.commit()
    db.refresh(model)
    return model


@router.delete("/{customer_id}/contacts/{contact_id}")
def delete_customer_contact(
    customer_id: uuid.UUID,
    contact_id: uuid.UUID,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin"])),
):
    del current_user
    plant_values = accepted_persisted_plant_ids(plant_id)
    model = db.query(models.CustomerContact).filter(
        models.CustomerContact.id == contact_id,
        models.CustomerContact.customer_id == customer_id,
        models.CustomerContact.plant_id.in_(plant_values),
    ).first()
    if not model:
        raise HTTPException(status_code=404, detail="Customer contact not found")
    model.active = False
    db.commit()
    return {"message": "Customer contact deactivated successfully"}
