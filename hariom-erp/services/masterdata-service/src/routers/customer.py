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
    primary_contact_email: Optional[str] = None
    contact_email: Optional[str] = None
    contact_phone: Optional[str] = None
    dispatch_contact_name: Optional[str] = None
    dispatch_contact_phone: Optional[str] = None
    tax_id: Optional[str] = None
    # Billing and dispatch (ship-to) place for the delivery challan (client 2026-10-28).
    billing_city: Optional[str] = None
    billing_state: Optional[str] = None
    billing_state_code: Optional[str] = None
    billing_pin_code: Optional[str] = None
    shipping_city: Optional[str] = None
    shipping_state: Optional[str] = None
    shipping_state_code: Optional[str] = None
    shipping_pin_code: Optional[str] = None
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
    primary_contact_email: Optional[str] = None
    contact_email: Optional[str] = None
    contact_phone: Optional[str] = None
    dispatch_contact_name: Optional[str] = None
    dispatch_contact_phone: Optional[str] = None
    tax_id: Optional[str] = None
    # Billing and dispatch (ship-to) place for the delivery challan (client 2026-10-28).
    billing_city: Optional[str] = None
    billing_state: Optional[str] = None
    billing_state_code: Optional[str] = None
    billing_pin_code: Optional[str] = None
    shipping_city: Optional[str] = None
    shipping_state: Optional[str] = None
    shipping_state_code: Optional[str] = None
    shipping_pin_code: Optional[str] = None
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
    billing_city: Optional[str] = None
    billing_state: Optional[str] = None
    billing_state_code: Optional[str] = None
    billing_pin_code: Optional[str] = None
    shipping_city: Optional[str] = None
    shipping_state: Optional[str] = None
    shipping_state_code: Optional[str] = None
    shipping_pin_code: Optional[str] = None
    # One line each for documents (street lines, city, state - PIN); the dispatch address falls back
    # to the billing address when no separate ship-to address is kept.
    billing_full_address: Optional[str] = None
    shipping_full_address: Optional[str] = None
    plant_id: str
    active: bool
    # Mirrored "is_active" so the UI cockpit's expectation matches the response.
    is_active: Optional[bool] = None
    category: Optional[str] = None
    credit_limit: Optional[float] = None
    payment_terms: Optional[str] = None
    created_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


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

    model_config = ConfigDict(from_attributes=True)


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


_PLACE_FIELDS = (
    "billing_city", "billing_state", "billing_state_code", "billing_pin_code",
    "shipping_city", "shipping_state", "shipping_state_code", "shipping_pin_code",
)
# Field -> (label for messages, normaliser). Every detail is optional; blank clears it.
_DETAIL_FORMATS = {
    "gst_no": ("GSTIN", formats.normalize_gstin),
    "tax_id": ("GSTIN", formats.normalize_gstin),
    "pan_no": ("PAN", formats.normalize_pan),
    "billing_pin_code": ("Billing PIN code", formats.normalize_pin),
    "shipping_pin_code": ("Dispatch PIN code", formats.normalize_pin),
    "billing_state_code": ("Billing state code", formats.normalize_state_code),
    "shipping_state_code": ("Dispatch state code", formats.normalize_state_code),
    "primary_contact_phone": ("Phone", formats.normalize_phone),
    "contact_phone": ("Phone", formats.normalize_phone),
    "dispatch_contact_phone": ("Dispatch contact phone", formats.normalize_phone),
    "primary_contact_email": ("Email", formats.normalize_email),
    "contact_email": ("Email", formats.normalize_email),
}
_TEXT_FIELDS = (
    "address", "billing_address", "shipping_address", "primary_contact_name", "dispatch_contact_name",
    "billing_city", "billing_state", "shipping_city", "shipping_state",
)


def _clean_details(values: dict) -> dict:
    """Trim and format-check the customer details present in ``values`` (blank becomes NULL).

    Raises a 422 with a plain message naming the field, e.g. "GSTIN must be 15 characters".
    """
    cleaned = dict(values)
    for key, (label, normalise) in _DETAIL_FORMATS.items():
        if key in cleaned:
            try:
                cleaned[key] = normalise(cleaned[key])
            except ValueError as exc:
                message = str(exc)
                if message.startswith("PIN code") and label != "PIN code":
                    message = f"{label}{message[len('PIN code'):]}"
                elif message.startswith("State code") and label.endswith("state code"):
                    message = f"{label}{message[len('State code'):]}"
                raise HTTPException(status_code=422, detail=message if message.startswith(label) else f"{label}: {message}")
    for key in _TEXT_FIELDS:
        if key in cleaned:
            cleaned[key] = formats.blank_to_none(cleaned[key])
    return cleaned


def _state_code_for(name: Optional[str]) -> Optional[str]:
    wanted = str(name or "").strip().lower()
    if not wanted:
        return None
    return next((code for code, state in formats.GST_STATE_CODES.items() if state.lower() == wanted), None)


def _fill_places(model: models.Customer) -> None:
    """A GSTIN carries the PAN and the billing state; fill those when empty, and keep state name and code together.

    A typed state name keeps its own code ("Karnataka" is 29); _check_gstin_state then refuses a billing state
    that is not the GSTIN's. The GSTIN only fills the billing state when neither the state name nor the code is given.
    """
    for prefix in ("billing", "shipping"):
        code = getattr(model, f"{prefix}_state_code", None)
        state = getattr(model, f"{prefix}_state", None)
        if state and not code:
            setattr(model, f"{prefix}_state_code", _state_code_for(state))
    gstin = model.gst_no or ""
    if len(gstin) == 15:
        if not model.pan_no:
            model.pan_no = gstin[2:12]
        if not model.billing_state_code and not model.billing_state:
            model.billing_state_code = gstin[:2]
    for prefix in ("billing", "shipping"):
        code = getattr(model, f"{prefix}_state_code", None)
        state = getattr(model, f"{prefix}_state", None)
        if code and not state:
            setattr(model, f"{prefix}_state", formats.state_for_code(code))


def _check_state_pairs(values: dict) -> None:
    """A state name and a state code sent together must be the same state (e.g. Karnataka is 29)."""
    for prefix, label in (("billing", "Billing"), ("shipping", "Dispatch")):
        state = values.get(f"{prefix}_state")
        code = values.get(f"{prefix}_state_code")
        expected = _state_code_for(state)
        if state and code and expected and expected != code:
            raise HTTPException(
                status_code=422,
                detail=f"{label} state {state} has GST state code {expected}, not {code}. Pick the state again.",
            )


def _follow_new_gstin(model: models.Customer, before: dict, update_data: dict) -> None:
    """When the GSTIN changes, the PAN and billing state that came from the old GSTIN follow the new one.

    A PAN or billing state that is still the old GSTIN's (unchanged, or sent back unchanged by the form)
    is replaced; a PAN typed in the same request that does not match the new GSTIN is refused in plain words.
    """
    new_gstin = model.gst_no or ""
    old_gstin = before.get("gst_no") or ""
    gstin_changed = new_gstin != old_gstin
    pan_sent = "pan_no" in update_data and update_data.get("pan_no") != before.get("pan_no")
    if gstin_changed and len(new_gstin) == 15:
        old_pan = before.get("pan_no")
        if not pan_sent and (not old_pan or (len(old_gstin) == 15 and old_pan == old_gstin[2:12])):
            model.pan_no = new_gstin[2:12]
        code_sent = "billing_state_code" in update_data and update_data.get("billing_state_code") != before.get("billing_state_code")
        state_sent = "billing_state" in update_data and update_data.get("billing_state") != before.get("billing_state")
        old_code = before.get("billing_state_code")
        if not code_sent and not state_sent and (not old_code or (len(old_gstin) == 15 and old_code == old_gstin[:2])):
            model.billing_state_code = new_gstin[:2]
            model.billing_state = formats.state_for_code(new_gstin[:2])
    if (gstin_changed or pan_sent) and len(new_gstin) == 15 and model.pan_no and model.pan_no != new_gstin[2:12]:
        raise HTTPException(
            status_code=422,
            detail=f"PAN {model.pan_no} does not match GSTIN {new_gstin}, which carries PAN {new_gstin[2:12]}. Correct the PAN or the GSTIN.",
        )


def _check_gstin_state(model: models.Customer, before: dict, update_data: dict) -> None:
    """A GSTIN is registered in one state, and the billing address is that registration's address.

    When the GSTIN or the billing state changes, a billing state that is not the GSTIN's state is refused in
    plain words (the challan prints both side by side). Old rows that already disagree can still be edited
    as long as neither is touched. The dispatch (ship-to) address may be in any state.
    """
    gstin = model.gst_no or ""
    code = model.billing_state_code or ""
    if len(gstin) != 15 or not code or code == gstin[:2]:
        return
    gstin_changed = gstin != (before.get("gst_no") or "")
    state_changed = any(
        key in update_data and update_data.get(key) != before.get(key) for key in ("billing_state", "billing_state_code")
    )
    if gstin_changed or state_changed:
        state = model.billing_state or formats.state_for_code(code) or code
        raise HTTPException(
            status_code=422,
            detail=(
                f"GSTIN {gstin} is registered in {formats.state_for_code(gstin[:2]) or gstin[:2]} ({gstin[:2]}), "
                f"but the billing state is {state} ({code}). The billing address must be in the GSTIN's state: "
                "correct the billing state or the GSTIN."
            ),
        )


def _place_line(street: Optional[str], city: Optional[str], state: Optional[str], pin: Optional[str]) -> Optional[str]:
    place = ", ".join(part for part in (formats.blank_to_none(city), formats.blank_to_none(state)) if part)
    pin = formats.blank_to_none(pin)
    if pin:
        place = f"{place} - {pin}" if place else pin
    lines = [line.strip() for line in str(street or "").replace("\r", "").split("\n") if line.strip()]
    joined = ", ".join([*lines, *([place] if place else [])])
    return joined or None


def _has_street(street: Optional[str]) -> bool:
    """True when an address has a street line (plot / building, street, area), not only city, state or PIN."""
    return any(line.strip() for line in str(street or "").replace("\r", "").split("\n"))


def _for_response(model: models.Customer) -> models.Customer:
    setattr(model, "is_active", bool(model.active))
    billing_street = model.billing_address or model.address
    billing = _place_line(billing_street, model.billing_city, model.billing_state, model.billing_pin_code)
    # Older rows copy the one address into shipping_address; that is not a separate ship-to address.
    separate = any((model.shipping_city, model.shipping_state, model.shipping_pin_code)) or (
        formats.blank_to_none(model.shipping_address) and (model.shipping_address or "").strip() != (billing_street or "").strip()
    )
    # Goods cannot be sent to "Gujarat": the dispatch address counts only when it has a street line.
    # A GSTIN fills the billing state by itself, so a customer with only a GSTIN (or only a city) has none.
    if separate:
        shipping = _place_line(model.shipping_address, model.shipping_city, model.shipping_state, model.shipping_pin_code) if _has_street(model.shipping_address) else None
    else:
        shipping = billing if _has_street(billing_street) else None
    setattr(model, "billing_full_address", billing)
    setattr(model, "shipping_full_address", shipping)
    return model


def _customer_payload(data: dict) -> dict:
    data = _clean_details(data)
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
        **{key: data.get(key) for key in _PLACE_FIELDS},
    }


def _apply_customer_update(model: models.Customer, update_data: dict) -> None:
    before = {key: getattr(model, key, None) for key in ("gst_no", "pan_no", "billing_state", "billing_state_code")}
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
    for key in _PLACE_FIELDS:
        if key in update_data:
            setattr(model, key, update_data.get(key))
    if "billing_state" in update_data and "billing_state_code" not in update_data:
        model.billing_state_code = None
    if "shipping_state" in update_data and "shipping_state_code" not in update_data:
        model.shipping_state_code = None
    if "billing_state_code" in update_data and "billing_state" not in update_data:
        model.billing_state = None
    if "shipping_state_code" in update_data and "shipping_state" not in update_data:
        model.shipping_state = None
    _check_state_pairs(update_data)
    _follow_new_gstin(model, before, update_data)
    _fill_places(model)
    _check_gstin_state(model, before, update_data)


@router.get("/", response_model=List[CustomerResponse])
def get_customers(
    include_inactive: bool = Query(False, description="Include disabled customers for master maintenance"),
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
):
    """Return customer rows for the active plant scope.

    Operational callers receive active rows only. Master maintenance screens
    must explicitly opt in to disabled history.
    """
    query = db.query(models.Customer)
    if not include_inactive:
        query = query.filter(models.Customer.active == True)
    query = apply_plant_scope(query, models.Customer.plant_id, plant_scope)
    rows = query.order_by(models.Customer.name.asc()).all()
    # Mirror `active` → `is_active` for the cockpit UI.
    for r in rows:
        _for_response(r)
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
    _for_response(customer)
    return customer


@router.post("/", response_model=CustomerResponse)
def create_customer(
    customer: CustomerCreate,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin", "Owner"]))
):
    plant_values = accepted_persisted_plant_ids(plant_id)
    payload = _customer_payload(customer.model_dump())
    exists = db.query(models.Customer).filter(
        models.Customer.plant_id.in_(plant_values),
        (models.Customer.customer_code == payload["customer_code"]) | (models.Customer.name == payload["name"])
    ).first()
    if exists:
        raise HTTPException(status_code=400, detail="Customer code or name already exists in this plant")
    db_customer = models.Customer(**payload, plant_id=plant_id)
    _check_state_pairs(payload)
    _follow_new_gstin(db_customer, {}, payload)
    _fill_places(db_customer)
    _check_gstin_state(db_customer, {}, payload)
    db.add(db_customer)
    db.commit()
    db.refresh(db_customer)
    _for_response(db_customer)
    try:
        from ..utils.audit_client import emit_audit_event
        emit_audit_event(
            token=current_user.get("token", "") if isinstance(current_user, dict) else "",
            event_type="customer_created",
            entity_type="customer",
            entity_id=str(db_customer.id),
            plant_id=str(plant_id),
            actor_role=str((current_user.get("roles") or ["?"])[0]) if isinstance(current_user, dict) else None,
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
    plant_values = accepted_persisted_plant_ids(plant_id)
    db_customer = db.query(models.Customer).filter(
        models.Customer.id == customer_id,
        models.Customer.plant_id.in_(plant_values),
    ).first()
    if not db_customer:
        raise HTTPException(status_code=404, detail="Customer not found")

    update_data = _clean_details(customer_update.model_dump(exclude_unset=True))
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
    _for_response(db_customer)
    try:
        from ..utils.audit_client import emit_audit_event
        emit_audit_event(
            token=current_user.get("token", "") if isinstance(current_user, dict) else "",
            event_type="customer_updated",
            entity_type="customer",
            entity_id=str(db_customer.id),
            plant_id=str(plant_id),
            actor_role=str((current_user.get("roles") or ["?"])[0]) if isinstance(current_user, dict) else None,
            actor_email=current_user.get("sub") if isinstance(current_user, dict) else None,
            summary=f"Customer {db_customer.name} updated",
            payload={"fields_changed": list(update_data.keys())},
        )
    except Exception:
        pass
    return db_customer


@router.delete("/{customer_id}")
def deactivate_customer(
    customer_id: uuid.UUID,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin", "Owner"]))
):
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
            actor_role=str((current_user.get("roles") or ["?"])[0]) if isinstance(current_user, dict) else None,
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
    try:
        from ..utils.audit_client import emit_audit_event
        emit_audit_event(
            token=current_user.get("token", "") if isinstance(current_user, dict) else "",
            event_type="customer_contact_created",
            entity_type="customer_contact",
            entity_id=str(model.id),
            plant_id=str(plant_id),
            actor_role=str((current_user.get("roles") or ["?"])[0]) if isinstance(current_user, dict) else None,
            actor_email=current_user.get("sub") if isinstance(current_user, dict) else None,
            summary=f"Customer contact {model.contact_name} created for {customer.name}",
            payload={
                "customer_id": str(customer_id),
                "contact_name": model.contact_name,
                "department": model.department,
                "is_primary": bool(model.is_primary),
            },
        )
    except Exception:
        pass
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
    try:
        from ..utils.audit_client import emit_audit_event
        emit_audit_event(
            token=current_user.get("token", "") if isinstance(current_user, dict) else "",
            event_type="customer_contact_updated",
            entity_type="customer_contact",
            entity_id=str(model.id),
            plant_id=str(plant_id),
            actor_role=str((current_user.get("roles") or ["?"])[0]) if isinstance(current_user, dict) else None,
            actor_email=current_user.get("sub") if isinstance(current_user, dict) else None,
            summary=f"Customer contact {model.contact_name} updated",
            payload={
                "customer_id": str(customer_id),
                "fields_changed": list(update_data.keys()),
            },
        )
    except Exception:
        pass
    return model


@router.delete("/{customer_id}/contacts/{contact_id}")
def delete_customer_contact(
    customer_id: uuid.UUID,
    contact_id: uuid.UUID,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin", "Owner"])),
):
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
    try:
        from ..utils.audit_client import emit_audit_event
        emit_audit_event(
            token=current_user.get("token", "") if isinstance(current_user, dict) else "",
            event_type="customer_contact_deleted",
            entity_type="customer_contact",
            entity_id=str(model.id),
            plant_id=str(plant_id),
            actor_role=str((current_user.get("roles") or ["?"])[0]) if isinstance(current_user, dict) else None,
            actor_email=current_user.get("sub") if isinstance(current_user, dict) else None,
            summary=f"Customer contact {model.contact_name} deactivated",
            payload={"customer_id": str(customer_id)},
        )
    except Exception:
        pass
    return {"message": "Customer contact deactivated successfully"}
