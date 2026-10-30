from datetime import datetime
from typing import List, Optional
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, EmailStr
from sqlalchemy.orm import Session

from .. import models
from ..database import get_db
from ..utils import party_formats as formats
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
    legal_name: Optional[str] = None
    trade_name: Optional[str] = None
    alt_phone: Optional[str] = None
    address_line2: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    state_code: Optional[str] = None
    pin_code: Optional[str] = None
    country: Optional[str] = None
    payment_terms_days: Optional[int] = None
    credit_days: Optional[int] = None
    credit_limit: Optional[float] = None
    bank_name: Optional[str] = None
    bank_account_no: Optional[str] = None
    bank_ifsc: Optional[str] = None
    msme_no: Optional[str] = None
    notes: Optional[str] = None


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
    legal_name: Optional[str] = None
    trade_name: Optional[str] = None
    alt_phone: Optional[str] = None
    address_line2: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    state_code: Optional[str] = None
    pin_code: Optional[str] = None
    country: Optional[str] = None
    payment_terms_days: Optional[int] = None
    credit_days: Optional[int] = None
    credit_limit: Optional[float] = None
    bank_name: Optional[str] = None
    bank_account_no: Optional[str] = None
    bank_ifsc: Optional[str] = None
    msme_no: Optional[str] = None
    notes: Optional[str] = None
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
    legal_name: Optional[str] = None
    trade_name: Optional[str] = None
    alt_phone: Optional[str] = None
    address_line2: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    state_code: Optional[str] = None
    pin_code: Optional[str] = None
    country: Optional[str] = None
    payment_terms_days: Optional[int] = None
    credit_days: Optional[int] = None
    credit_limit: Optional[float] = None
    bank_name: Optional[str] = None
    bank_account_no: Optional[str] = None
    bank_ifsc: Optional[str] = None
    msme_no: Optional[str] = None
    notes: Optional[str] = None
    # Address line 1 + line 2 + city, state - PIN, for documents (PO supplier block).
    full_address: Optional[str] = None
    plant_id: str
    active: bool
    # Mirrored for the cockpit UI.
    is_active: Optional[bool] = None
    created_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


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

    model_config = ConfigDict(from_attributes=True)


def _clean_code(value: str) -> str:
    return str(value or "").strip().upper().replace(" ", "-")


# Field -> (label for messages, normaliser). Every field is optional; blank clears it.
_DETAIL_FORMATS = {
    "gst_no": ("GSTIN", formats.normalize_gstin),
    "pan_no": ("PAN", formats.normalize_pan),
    "bank_ifsc": ("IFSC", formats.normalize_ifsc),
    "pin_code": ("PIN code", formats.normalize_pin),
    "state_code": ("State code", formats.normalize_state_code),
    "contact_phone": ("Phone", formats.normalize_phone),
    "alt_phone": ("Alternate phone", formats.normalize_phone),
    "contact_email": ("Email", formats.normalize_email),
    "bank_account_no": ("Bank account number", formats.normalize_account_no),
    "msme_no": ("MSME / Udyam number", lambda value: (formats.blank_to_none(value) or "").upper() or None),
}
_TEXT_FIELDS = (
    "category_label", "contact_name", "address", "legal_name", "trade_name", "address_line2", "city",
    "state", "country", "bank_name", "notes",
)
_DAY_FIELDS = {"payment_terms_days": "Payment terms", "credit_days": "Credit days"}


def _clean_details(values: dict) -> dict:
    """Trim, upper-case and format-check the optional vendor details present in ``values``.

    Raises a 422 with a plain message naming the field, e.g. "GSTIN must be 15 characters".
    """
    cleaned = dict(values)
    for key, (label, normalise) in _DETAIL_FORMATS.items():
        if key in cleaned:
            try:
                cleaned[key] = normalise(cleaned[key])
            except ValueError as exc:
                message = str(exc)
                raise HTTPException(status_code=422, detail=message if message.startswith(label) else f"{label}: {message}")
    for key in _TEXT_FIELDS:
        if key in cleaned:
            cleaned[key] = formats.blank_to_none(cleaned[key])
    for key, label in _DAY_FIELDS.items():
        if cleaned.get(key) is not None and not 0 <= int(cleaned[key]) <= 365:
            raise HTTPException(status_code=422, detail=f"{label} must be 0 to 365 days")
    if cleaned.get("credit_limit") is not None and float(cleaned["credit_limit"]) < 0:
        raise HTTPException(status_code=422, detail="Credit limit cannot be negative")
    return cleaned


def _fill_from_gstin(model: models.Supplier) -> None:
    """A GSTIN carries the PAN and the state code; fill those (and the state name) when empty."""
    gstin = model.gst_no or ""
    if len(gstin) == 15:
        if not model.pan_no:
            model.pan_no = gstin[2:12]
        if not model.state_code:
            model.state_code = gstin[:2]
    if model.state_code and not model.state:
        model.state = formats.state_for_code(model.state_code)
    if model.state and not model.state_code:
        wanted = model.state.strip().lower()
        model.state_code = next((code for code, name in formats.GST_STATE_CODES.items() if name.lower() == wanted), None)


def _state_code_for(name: Optional[str]) -> Optional[str]:
    wanted = str(name or "").strip().lower()
    if not wanted:
        return None
    return next((code for code, state in formats.GST_STATE_CODES.items() if state.lower() == wanted), None)


def _check_state_pair(values: dict) -> None:
    """A state name and a state code sent together must be the same state (e.g. Karnataka is 29)."""
    state = values.get("state")
    code = values.get("state_code")
    expected = _state_code_for(state)
    if state and code and expected and expected != code:
        raise HTTPException(status_code=422, detail=f"State {state} has GST state code {expected}, not {code}. Pick the state again.")


def _follow_new_gstin(model: models.Supplier, before: dict, updates: dict) -> None:
    """When the GSTIN changes, the PAN and state that came from the old GSTIN follow the new one.

    A PAN or state that is still the old GSTIN's (or empty) is replaced, also when the form sends it back
    unchanged; a value typed in the same request is kept and then checked below.
    """
    new_gstin = model.gst_no or ""
    old_gstin = before.get("gst_no") or ""
    if new_gstin == old_gstin or len(new_gstin) != 15:
        return
    pan_sent = "pan_no" in updates and updates.get("pan_no") != before.get("pan_no")
    old_pan = before.get("pan_no")
    if not pan_sent and (not old_pan or (len(old_gstin) == 15 and old_pan == old_gstin[2:12])):
        model.pan_no = new_gstin[2:12]
    state_sent = any(key in updates and updates.get(key) != before.get(key) for key in ("state", "state_code"))
    old_code = before.get("state_code")
    if not state_sent and (not old_code or (len(old_gstin) == 15 and old_code == old_gstin[:2])):
        model.state_code = new_gstin[:2]
        model.state = formats.state_for_code(new_gstin[:2])


def _check_gstin_matches(model: models.Supplier, before: dict, updates: dict) -> None:
    """The PAN and the state must be the GSTIN's (both print beside it on the PO); refused in plain words.

    Checked only when the GSTIN, PAN or state changes, so an old row that already disagrees can still be
    edited for other details.
    """
    gstin = model.gst_no or ""
    if len(gstin) != 15:
        return
    def changed(*keys: str) -> bool:
        return any(key in updates and updates.get(key) != before.get(key) for key in keys)
    gstin_changed = gstin != (before.get("gst_no") or "")
    if (gstin_changed or changed("pan_no")) and model.pan_no and model.pan_no != gstin[2:12]:
        raise HTTPException(
            status_code=422,
            detail=f"PAN {model.pan_no} does not match GSTIN {gstin}, which carries PAN {gstin[2:12]}. Correct the PAN or the GSTIN.",
        )
    code = model.state_code or ""
    if (gstin_changed or changed("state", "state_code")) and code and code != gstin[:2]:
        state = model.state or formats.state_for_code(code) or code
        raise HTTPException(
            status_code=422,
            detail=(
                f"GSTIN {gstin} is registered in {formats.state_for_code(gstin[:2]) or gstin[:2]} ({gstin[:2]}), "
                f"but the state is {state} ({code}). Correct the state or the GSTIN."
            ),
        )


def _for_response(model: models.Supplier) -> models.Supplier:
    setattr(model, "is_active", bool(model.active))
    setattr(model, "full_address", formats.full_address(model))
    return model


@router.get("/", response_model=List[SupplierResponse])
def get_suppliers(
    include_inactive: bool = Query(False, description="Include disabled suppliers for master maintenance"),
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
):
    """Return active suppliers unless a maintenance screen requests history."""
    query = db.query(models.Supplier)
    if not include_inactive:
        query = query.filter(models.Supplier.active == True)
    query = apply_plant_scope(query, models.Supplier.plant_id, plant_scope)
    rows = query.order_by(models.Supplier.name.asc()).all()
    for r in rows:
        _for_response(r)
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
    details = _clean_details(supplier.model_dump())

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
    detail_keys = (
        "contact_name", "contact_phone", "contact_email", "gst_no", "pan_no", "address", "legal_name", "trade_name",
        "alt_phone", "address_line2", "city", "state", "state_code", "pin_code", "payment_terms_days", "credit_days",
        "credit_limit", "bank_name", "bank_account_no", "bank_ifsc", "msme_no", "notes",
    )
    _check_state_pair(details)
    model = models.Supplier(
        supplier_code=code,
        name=name,
        category=canon_category,
        category_label=label,
        country=details.get("country") or "India",
        plant_id=plant_id,
        **{key: details.get(key) for key in detail_keys},
    )
    _fill_from_gstin(model)
    _check_gstin_matches(model, {}, details)
    db.add(model)
    db.commit()
    db.refresh(model)
    _for_response(model)
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

    updates = _clean_details(payload.model_dump(exclude_unset=True))
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

    _check_state_pair(updates)
    before = {key: getattr(model, key, None) for key in ("gst_no", "pan_no", "state", "state_code")}
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
        elif key == "active" and value is None:
            continue
        else:
            setattr(model, key, value)
    # A state name sent alone takes its own code (and a code alone its name), instead of keeping the old pair.
    if "state" in updates and "state_code" not in updates:
        model.state_code = _state_code_for(model.state)
    if "state_code" in updates and "state" not in updates:
        model.state = formats.state_for_code(model.state_code) if model.state_code else None
    _follow_new_gstin(model, before, updates)
    _fill_from_gstin(model)
    _check_gstin_matches(model, before, updates)
    db.commit()
    db.refresh(model)
    _for_response(model)
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
