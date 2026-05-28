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
    # Master redesign fields (additive — optional, default None).
    category: Optional[str] = None
    credit_limit: Optional[float] = None
    payment_terms: Optional[str] = None


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
    # Allow the UI cockpit to write back its is_active alias; downstream the
    # handler maps both `active` and `is_active` to the model.
    is_active: Optional[bool] = None
    category: Optional[str] = None
    credit_limit: Optional[float] = None
    payment_terms: Optional[str] = None


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
    # Mirrored "is_active" so the UI cockpit's expectation matches the response.
    is_active: Optional[bool] = None
    category: Optional[str] = None
    credit_limit: Optional[float] = None
    payment_terms: Optional[str] = None
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class CustomerContactCreate(BaseModel):
    department: Optional[str] = "General"
    contact_name: str
    contact_phone: Optional[str] = None
    contact_email: Optional[EmailStr] = None
    notes: Optional[str] = None
    is_primary: Optional[bool] = None
    designation: Optional[str] = None  # convenience alias the UI may pass as a label


class CustomerContactUpdate(BaseModel):
    department: Optional[str] = None
    contact_name: Optional[str] = None
    contact_phone: Optional[str] = None
    contact_email: Optional[EmailStr] = None
    notes: Optional[str] = None
    active: Optional[bool] = None
    is_primary: Optional[bool] = None
    designation: Optional[str] = None


class CustomerContactResponse(BaseModel):
    id: uuid.UUID
    customer_id: uuid.UUID
    department: str
    contact_name: str
    contact_phone: Optional[str]
    contact_email: Optional[str]
    notes: Optional[str]
    is_primary: bool = False
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
        "category": (data.get("category") or None),
        "credit_limit": data.get("credit_limit"),
        "payment_terms": (data.get("payment_terms") or None),
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
    # UI cockpit alias — `is_active` maps to the same field.
    if "is_active" in update_data and update_data.get("is_active") is not None:
        model.active = bool(update_data.get("is_active"))
    if "category" in update_data:
        model.category = update_data.get("category") or None
    if "credit_limit" in update_data:
        raw_limit = update_data.get("credit_limit")
        try:
            model.credit_limit = float(raw_limit) if raw_limit is not None and raw_limit != "" else None
        except (TypeError, ValueError):
            model.credit_limit = None
    if "payment_terms" in update_data:
        model.payment_terms = update_data.get("payment_terms") or None


@router.get("/", response_model=List[CustomerResponse])
def get_customers(
    include_inactive: bool = True,
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
):
    """Return customer rows for the active plant scope.

    Default behaviour is to include inactive rows — the new master cockpit
    expects to filter client-side. Pass ``include_inactive=false`` to restore
    the legacy "active-only" behaviour any older callers depended on.
    """
    query = db.query(models.Customer)
    if not include_inactive:
        query = query.filter(models.Customer.active == True)
    query = apply_plant_scope(query, models.Customer.plant_id, plant_scope)
    rows = query.order_by(models.Customer.name.asc()).all()
    # Mirror `active` → `is_active` for the cockpit UI.
    for r in rows:
        setattr(r, "is_active", bool(r.active))
    return rows


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
    setattr(customer, "is_active", bool(customer.active))
    return customer


@router.post("/", response_model=CustomerResponse)
def create_customer(
    customer: CustomerCreate,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin", "Owner"]))
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
    setattr(db_customer, "is_active", bool(db_customer.active))
    try:
        from ..utils.audit_client import emit_audit_event
        emit_audit_event(
            token=current_user.get("token", "") if isinstance(current_user, dict) else "",
            event_type="customer_created",
            entity_type="customer",
            entity_id=str(db_customer.id),
            plant_id=str(plant_id),
            actor_email=current_user.get("sub") if isinstance(current_user, dict) else None,
            summary=f"Customer {db_customer.name} created",
            payload={"code": db_customer.customer_code, "name": db_customer.name},
        )
    except Exception:
        pass
    return db_customer


@router.put("/{customer_id}", response_model=CustomerResponse)
def update_customer(
    customer_id: uuid.UUID,
    customer_update: CustomerUpdate,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin", "Owner"]))
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
    setattr(db_customer, "is_active", bool(db_customer.active))
    return db_customer


@router.delete("/{customer_id}")
def deactivate_customer(
    customer_id: uuid.UUID,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin", "Owner"]))
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
    try:
        from ..utils.audit_client import emit_audit_event
        emit_audit_event(
            token=current_user.get("token", "") if isinstance(current_user, dict) else "",
            event_type="customer_deactivated",
            entity_type="customer",
            entity_id=str(db_customer.id),
            plant_id=str(plant_id),
            actor_email=current_user.get("sub") if isinstance(current_user, dict) else None,
            summary=f"Customer {db_customer.name} deactivated",
        )
    except Exception:
        pass
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
    return query.order_by(
        models.CustomerContact.is_primary.desc(),
        models.CustomerContact.department.asc(),
        models.CustomerContact.contact_name.asc(),
    ).all()


@router.post("/{customer_id}/contacts", response_model=CustomerContactResponse)
def create_customer_contact(
    customer_id: uuid.UUID,
    payload: CustomerContactCreate,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin", "Owner"])),
):
    del current_user
    plant_values = accepted_persisted_plant_ids(plant_id)
    customer = db.query(models.Customer).filter(
        models.Customer.id == customer_id,
        models.Customer.plant_id.in_(plant_values),
    ).first()
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    # If no other primary contact exists yet, the first one we add becomes primary.
    has_primary = (
        db.query(models.CustomerContact)
        .filter(
            models.CustomerContact.customer_id == customer_id,
            models.CustomerContact.is_primary == True,
            models.CustomerContact.active == True,
        )
        .first()
        is not None
    )
    designation = (payload.designation or "").strip() if payload.designation else ""
    department_value = designation or (payload.department or "General").strip() or "General"
    explicit_primary = bool(payload.is_primary)
    model = models.CustomerContact(
        customer_id=customer_id,
        department=department_value,
        contact_name=payload.contact_name.strip(),
        contact_phone=payload.contact_phone,
        contact_email=str(payload.contact_email) if payload.contact_email else None,
        notes=payload.notes,
        is_primary=explicit_primary or not has_primary,
        plant_id=plant_id,
    )
    db.add(model)
    db.flush()
    # If this new contact is primary, demote everyone else.
    if model.is_primary:
        db.query(models.CustomerContact).filter(
            models.CustomerContact.customer_id == customer_id,
            models.CustomerContact.id != model.id,
            models.CustomerContact.is_primary == True,
        ).update({"is_primary": False}, synchronize_session=False)
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
    current_user: dict = Depends(require_role(["Admin", "Owner"])),
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
    promote_to_primary = False
    for field, value in update_data.items():
        if field == "designation" and value is not None:
            model.department = str(value).strip() or "General"
            continue
        if field in {"department", "contact_name"} and value is not None:
            setattr(model, field, str(value).strip())
        elif field == "contact_email" and value is not None:
            model.contact_email = str(value)
        elif field == "is_primary":
            new_primary = bool(value)
            model.is_primary = new_primary
            promote_to_primary = new_primary
        else:
            setattr(model, field, value)
    if promote_to_primary:
        # Demote every other contact under the same customer.
        db.query(models.CustomerContact).filter(
            models.CustomerContact.customer_id == customer_id,
            models.CustomerContact.id != contact_id,
        ).update({"is_primary": False}, synchronize_session=False)
    db.commit()
    db.refresh(model)
    return model


@router.delete("/{customer_id}/contacts/{contact_id}")
def delete_customer_contact(
    customer_id: uuid.UUID,
    contact_id: uuid.UUID,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin", "Owner"])),
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
