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
    category_label: Optional[str] = None
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
    category_label: Optional[str] = None
    contact_name: Optional[str] = None
    contact_phone: Optional[str] = None
    contact_email: Optional[str] = None
    gst_no: Optional[str] = None
    pan_no: Optional[str] = None
    address: Optional[str] = None
    active: Optional[bool] = None
    # UI cockpit alias — backend stores `active`.
    is_active: Optional[bool] = None


class SupplierResponse(BaseModel):
    id: uuid.UUID
    supplier_code: str
    name: str
    category: str
    category_label: Optional[str] = None
    contact_name: Optional[str]
    contact_phone: Optional[str]
    contact_email: Optional[str]
    gst_no: Optional[str]
    pan_no: Optional[str]
    address: Optional[str]
    plant_id: str
    active: bool
    # Mirrored for the cockpit UI.
    is_active: Optional[bool] = None
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class SupplierContactCreate(BaseModel):
    department: Optional[str] = "General"
    contact_name: str
    contact_phone: Optional[str] = None
    contact_email: Optional[EmailStr] = None
    notes: Optional[str] = None
    is_primary: Optional[bool] = None
    designation: Optional[str] = None


class SupplierContactUpdate(BaseModel):
    department: Optional[str] = None
    contact_name: Optional[str] = None
    contact_phone: Optional[str] = None
    contact_email: Optional[EmailStr] = None
    notes: Optional[str] = None
    active: Optional[bool] = None
    is_primary: Optional[bool] = None
    designation: Optional[str] = None


class SupplierContactResponse(BaseModel):
    id: uuid.UUID
    supplier_id: uuid.UUID
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


def _clean_code(value: str) -> str:
    return str(value or "").strip().upper().replace(" ", "-")


@router.get("/", response_model=List[SupplierResponse])
def get_suppliers(
    include_inactive: bool = True,
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
):
    """Return suppliers in scope. Defaults to including inactive rows so the new
    vendor cockpit can filter client-side."""
    query = db.query(models.Supplier)
    if not include_inactive:
        query = query.filter(models.Supplier.active == True)
    query = apply_plant_scope(query, models.Supplier.plant_id, plant_scope)
    rows = query.order_by(models.Supplier.name.asc()).all()
    for r in rows:
        setattr(r, "is_active", bool(r.active))
    return rows


@router.post("/", response_model=SupplierResponse)
def create_supplier(
    supplier: SupplierCreate,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin", "Owner"])),
):
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

    label = (supplier.category_label or supplier.category or "").strip() or None
    # Map common cockpit categories down to the canonical enum so reports keep working.
    category_canon_map = {
        "Raw paper": "RAW_MATERIAL",
        "Parchment": "PARCHMENT",
        "Adhesive": "ADHESIVE",
        "Packaging": "PACKAGING",
        "Service": "SERVICE",
        "Other": "OTHER",
    }
    raw_category = supplier.category.strip()
    canon_category = category_canon_map.get(raw_category, raw_category.upper()) or "RAW_MATERIAL"
    model = models.Supplier(
        supplier_code=code,
        name=name,
        category=canon_category,
        category_label=label,
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
    setattr(model, "is_active", bool(model.active))
    try:
        from ..utils.audit_client import emit_audit_event
        emit_audit_event(
            token=current_user.get("token", "") if isinstance(current_user, dict) else "",
            event_type="supplier_created",
            entity_type="supplier",
            entity_id=str(model.id),
            plant_id=str(plant_id),
            actor_role=str((current_user.get("roles") or ["?"])[0]) if isinstance(current_user, dict) else None,
            actor_email=current_user.get("sub") if isinstance(current_user, dict) else None,
            summary=f"Supplier {model.name} created",
            payload={"code": model.supplier_code, "name": model.name, "category": model.category},
        )
    except Exception:
        pass
    return model


@router.put("/{supplier_id}", response_model=SupplierResponse)
def update_supplier(
    supplier_id: uuid.UUID,
    payload: SupplierUpdate,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin", "Owner"])),
):
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
            # Preserve the user-visible label and persist the canonical enum.
            category_canon_map = {
                "Raw paper": "RAW_MATERIAL",
                "Parchment": "PARCHMENT",
                "Adhesive": "ADHESIVE",
                "Packaging": "PACKAGING",
                "Service": "SERVICE",
                "Other": "OTHER",
            }
            raw = str(value).strip()
            canon = category_canon_map.get(raw, raw.upper()) or "RAW_MATERIAL"
            setattr(model, key, canon)
            # If the UI passed a friendly label, capture it for display.
            if raw and raw not in category_canon_map.values():
                model.category_label = raw
        elif key == "category_label" and value is not None:
            model.category_label = str(value).strip() or None
        elif key == "is_active" and value is not None:
            model.active = bool(value)
        else:
            setattr(model, key, value)
    db.commit()
    db.refresh(model)
    setattr(model, "is_active", bool(model.active))
    try:
        from ..utils.audit_client import emit_audit_event
        emit_audit_event(
            token=current_user.get("token", "") if isinstance(current_user, dict) else "",
            event_type="supplier_updated",
            entity_type="supplier",
            entity_id=str(model.id),
            plant_id=str(plant_id),
            actor_role=str((current_user.get("roles") or ["?"])[0]) if isinstance(current_user, dict) else None,
            actor_email=current_user.get("sub") if isinstance(current_user, dict) else None,
            summary=f"Supplier {model.name} updated",
            payload={"fields_changed": list(updates.keys())},
        )
    except Exception:
        pass
    return model


@router.delete("/{supplier_id}")
def delete_supplier(
    supplier_id: uuid.UUID,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin", "Owner"])),
):
    plant_values = accepted_persisted_plant_ids(plant_id)
    model = db.query(models.Supplier).filter(
        models.Supplier.id == supplier_id,
        models.Supplier.plant_id.in_(plant_values),
    ).first()
    if not model:
        raise HTTPException(status_code=404, detail="Supplier not found")
    model.active = False
    db.commit()
    try:
        from ..utils.audit_client import emit_audit_event
        emit_audit_event(
            token=current_user.get("token", "") if isinstance(current_user, dict) else "",
            event_type="supplier_deactivated",
            entity_type="supplier",
            entity_id=str(model.id),
            plant_id=str(plant_id),
            actor_role=str((current_user.get("roles") or ["?"])[0]) if isinstance(current_user, dict) else None,
            actor_email=current_user.get("sub") if isinstance(current_user, dict) else None,
            summary=f"Supplier {model.name} deactivated",
        )
    except Exception:
        pass
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
    return query.order_by(
        models.SupplierContact.is_primary.desc(),
        models.SupplierContact.department.asc(),
        models.SupplierContact.contact_name.asc(),
    ).all()


@router.post("/{supplier_id}/contacts", response_model=SupplierContactResponse)
def create_supplier_contact(
    supplier_id: uuid.UUID,
    payload: SupplierContactCreate,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin", "Owner"])),
):
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
    has_primary = (
        db.query(models.SupplierContact)
        .filter(
            models.SupplierContact.supplier_id == supplier_id,
            models.SupplierContact.is_primary == True,
            models.SupplierContact.active == True,
        )
        .first()
        is not None
    )
    designation = (payload.designation or "").strip() if payload.designation else ""
    department_value = designation or (payload.department or "General").strip() or "General"
    explicit_primary = bool(payload.is_primary)
    model = models.SupplierContact(
        supplier_id=supplier_id,
        department=department_value,
        contact_name=contact_name,
        contact_phone=payload.contact_phone,
        contact_email=str(payload.contact_email) if payload.contact_email else None,
        notes=payload.notes,
        is_primary=explicit_primary or not has_primary,
        plant_id=plant_id,
    )
    db.add(model)
    db.flush()
    if model.is_primary:
        db.query(models.SupplierContact).filter(
            models.SupplierContact.supplier_id == supplier_id,
            models.SupplierContact.id != model.id,
            models.SupplierContact.is_primary == True,
        ).update({"is_primary": False}, synchronize_session=False)
    db.commit()
    db.refresh(model)
    try:
        from ..utils.audit_client import emit_audit_event
        emit_audit_event(
            token=current_user.get("token", "") if isinstance(current_user, dict) else "",
            event_type="supplier_contact_created",
            entity_type="supplier_contact",
            entity_id=str(model.id),
            plant_id=str(plant_id),
            actor_role=str((current_user.get("roles") or ["?"])[0]) if isinstance(current_user, dict) else None,
            actor_email=current_user.get("sub") if isinstance(current_user, dict) else None,
            summary=f"Supplier contact {model.contact_name} created for {supplier.name}",
            payload={
                "supplier_id": str(supplier_id),
                "contact_name": model.contact_name,
                "department": model.department,
                "is_primary": bool(model.is_primary),
            },
        )
    except Exception:
        pass
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
    plant_values = accepted_persisted_plant_ids(plant_id)
    model = db.query(models.SupplierContact).filter(
        models.SupplierContact.id == contact_id,
        models.SupplierContact.supplier_id == supplier_id,
        models.SupplierContact.plant_id.in_(plant_values),
    ).first()
    if not model:
        raise HTTPException(status_code=404, detail="Supplier contact not found")
    update_data = payload.model_dump(exclude_unset=True)
    promote_to_primary = False
    for field, value in update_data.items():
        if field == "designation" and value is not None:
            model.department = str(value).strip() or "General"
            continue
        if field == "department" and value is not None:
            model.department = str(value).strip() or "General"
        elif field == "contact_name" and value is not None:
            resolved_name = str(value).strip()
            if not resolved_name:
                raise HTTPException(status_code=422, detail="contact_name is required")
            model.contact_name = resolved_name
        elif field == "contact_email" and value is not None:
            model.contact_email = str(value)
        elif field == "is_primary":
            new_primary = bool(value)
            model.is_primary = new_primary
            promote_to_primary = new_primary
        else:
            setattr(model, field, value)
    if promote_to_primary:
        db.query(models.SupplierContact).filter(
            models.SupplierContact.supplier_id == supplier_id,
            models.SupplierContact.id != contact_id,
        ).update({"is_primary": False}, synchronize_session=False)
    db.commit()
    db.refresh(model)
    try:
        from ..utils.audit_client import emit_audit_event
        emit_audit_event(
            token=current_user.get("token", "") if isinstance(current_user, dict) else "",
            event_type="supplier_contact_updated",
            entity_type="supplier_contact",
            entity_id=str(model.id),
            plant_id=str(plant_id),
            actor_role=str((current_user.get("roles") or ["?"])[0]) if isinstance(current_user, dict) else None,
            actor_email=current_user.get("sub") if isinstance(current_user, dict) else None,
            summary=f"Supplier contact {model.contact_name} updated",
            payload={
                "supplier_id": str(supplier_id),
                "fields_changed": list(update_data.keys()),
            },
        )
    except Exception:
        pass
    return model


@router.delete("/{supplier_id}/contacts/{contact_id}")
def delete_supplier_contact(
    supplier_id: uuid.UUID,
    contact_id: uuid.UUID,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin", "Owner"])),
):
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
    try:
        from ..utils.audit_client import emit_audit_event
        emit_audit_event(
            token=current_user.get("token", "") if isinstance(current_user, dict) else "",
            event_type="supplier_contact_deleted",
            entity_type="supplier_contact",
            entity_id=str(model.id),
            plant_id=str(plant_id),
            actor_role=str((current_user.get("roles") or ["?"])[0]) if isinstance(current_user, dict) else None,
            actor_email=current_user.get("sub") if isinstance(current_user, dict) else None,
            summary=f"Supplier contact {model.contact_name} deactivated",
            payload={"supplier_id": str(supplier_id)},
        )
    except Exception:
        pass
    return {"message": "Supplier contact deactivated successfully"}
