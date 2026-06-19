"""Shop-floor masters router.

Single router file covering four masters introduced by the operations honesty pass:

    • /employees       — Employee master (operators, supervisors, etc.)
    • /shifts          — Shift definitions (Day A, Night C, ...)
    • /holidays        — Plant calendar (public holidays, maintenance days)
    • /reason-codes    — Reason taxonomy (downtime, scrap, short-close, ...)

Each master follows the same lean shape: GET list (with optional category /
active filters), POST create, PUT update, DELETE deactivate. Owner/Admin role
gated on every write. Plant scope honoured via `apply_plant_scope` on every
read. Free-text plant_id columns stay aligned with the rest of masterdata so
the existing scope helpers Just Work.
"""

from __future__ import annotations

import logging
import uuid
from datetime import date, datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, EmailStr, Field
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


logger = logging.getLogger(__name__)


# ──────────────────────────────────────────────────────────────────────────
# Shared helpers
# ──────────────────────────────────────────────────────────────────────────


def _trim(v: Optional[str]) -> Optional[str]:
    if v is None:
        return None
    t = str(v).strip()
    return t or None


def _attach_is_active(row):
    setattr(row, "is_active", bool(row.active))
    return row


def _actor_role(current_user: dict) -> str:
    """Best-effort actor role string from the JWT claims."""
    if not isinstance(current_user, dict):
        return "?"
    role = current_user.get("acting_role")
    if role:
        return str(role)
    roles = current_user.get("roles") or []
    if isinstance(roles, list) and roles:
        return str(roles[0])
    return str(current_user.get("role") or "?")


def _actor_token(current_user: dict) -> str:
    if not isinstance(current_user, dict):
        return ""
    return str(current_user.get("token") or "")


def _actor_email(current_user: dict) -> Optional[str]:
    if not isinstance(current_user, dict):
        return None
    return current_user.get("sub") or current_user.get("email")


# Shift HH:MM 24-hour regex: 00:00 … 23:59.
SHIFT_TIME_PATTERN = r"^([01]\d|2[0-3]):[0-5]\d$"


# ──────────────────────────────────────────────────────────────────────────
# Employee master
# ──────────────────────────────────────────────────────────────────────────

employee_router = APIRouter(prefix="/master/employees", tags=["Master · Employees"])


class EmployeeCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    employee_code: str
    name: str
    role: Optional[str] = None
    department: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[EmailStr] = None
    skills: Optional[str] = None
    default_shift: Optional[str] = None
    joining_date: Optional[date] = None


class EmployeeUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    employee_code: Optional[str] = None
    name: Optional[str] = None
    role: Optional[str] = None
    department: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[EmailStr] = None
    skills: Optional[str] = None
    default_shift: Optional[str] = None
    joining_date: Optional[date] = None
    active: Optional[bool] = None
    is_active: Optional[bool] = None


class EmployeeResponse(BaseModel):
    id: uuid.UUID
    employee_code: str
    name: str
    role: Optional[str]
    department: Optional[str]
    phone: Optional[str]
    email: Optional[str]
    skills: Optional[str]
    default_shift: Optional[str]
    joining_date: Optional[datetime] = None
    plant_id: str
    active: bool
    is_active: Optional[bool] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


@employee_router.get("/", response_model=List[EmployeeResponse])
def list_employees(
    include_inactive: bool = True,
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
):
    query = db.query(models.Employee)
    if not include_inactive:
        query = query.filter(models.Employee.active == True)
    query = apply_plant_scope(query, models.Employee.plant_id, plant_scope)
    rows = query.order_by(models.Employee.name.asc()).all()
    return [_attach_is_active(r) for r in rows]


@employee_router.post("/", response_model=EmployeeResponse)
def create_employee(
    payload: EmployeeCreate,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin", "Owner"])),
):
    plant_values = accepted_persisted_plant_ids(plant_id)
    code = (payload.employee_code or "").strip().upper()
    name = (payload.name or "").strip()
    if not code or not name:
        raise HTTPException(status_code=422, detail="employee_code and name are required")
    exists = (
        db.query(models.Employee)
        .filter(models.Employee.plant_id.in_(plant_values), models.Employee.employee_code == code)
        .first()
    )
    if exists:
        raise HTTPException(status_code=409, detail="Employee code already exists in this plant")
    model = models.Employee(
        employee_code=code,
        name=name,
        role=_trim(payload.role),
        department=_trim(payload.department),
        phone=_trim(payload.phone),
        email=str(payload.email) if payload.email else None,
        skills=_trim(payload.skills),
        default_shift=_trim(payload.default_shift),
        joining_date=payload.joining_date,
        plant_id=plant_id,
    )
    db.add(model)
    db.commit()
    db.refresh(model)
    try:
        from ..utils.audit_client import emit_audit_event
        emit_audit_event(
            token=_actor_token(current_user),
            event_type="employee_created",
            entity_type="employee",
            entity_id=str(model.id),
            plant_id=str(plant_id),
            actor_role=_actor_role(current_user),
            actor_email=_actor_email(current_user),
            summary=f"Employee {model.name} ({model.employee_code}) created",
            payload={"code": model.employee_code, "name": model.name, "role": model.role},
        )
    except Exception as exc:
        logger.warning("audit emit failed (employee_created): %s", exc)
    return _attach_is_active(model)


@employee_router.put("/{employee_id}", response_model=EmployeeResponse)
def update_employee(
    employee_id: uuid.UUID,
    payload: EmployeeUpdate,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin", "Owner"])),
):
    plant_values = accepted_persisted_plant_ids(plant_id)
    model = (
        db.query(models.Employee)
        .filter(models.Employee.id == employee_id, models.Employee.plant_id.in_(plant_values))
        .first()
    )
    if not model:
        raise HTTPException(status_code=404, detail="Employee not found")
    updates = payload.model_dump(exclude_unset=True)
    for key, value in updates.items():
        if key == "employee_code" and value is not None:
            model.employee_code = str(value).strip().upper()
        elif key == "name" and value is not None:
            model.name = str(value).strip()
        elif key == "email" and value is not None:
            model.email = str(value)
        elif key == "is_active":
            if value is not None:
                model.active = bool(value)
        else:
            setattr(model, key, value)
    db.commit()
    db.refresh(model)
    try:
        from ..utils.audit_client import emit_audit_event
        emit_audit_event(
            token=_actor_token(current_user),
            event_type="employee_updated",
            entity_type="employee",
            entity_id=str(model.id),
            plant_id=str(plant_id),
            actor_role=_actor_role(current_user),
            actor_email=_actor_email(current_user),
            summary=f"Employee {model.name} ({model.employee_code}) updated",
            payload={"changed_keys": sorted(updates.keys())},
        )
    except Exception as exc:
        logger.warning("audit emit failed (employee_updated): %s", exc)
    return _attach_is_active(model)


@employee_router.delete("/{employee_id}")
def deactivate_employee(
    employee_id: uuid.UUID,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin", "Owner"])),
):
    plant_values = accepted_persisted_plant_ids(plant_id)
    model = (
        db.query(models.Employee)
        .filter(models.Employee.id == employee_id, models.Employee.plant_id.in_(plant_values))
        .first()
    )
    if not model:
        raise HTTPException(status_code=404, detail="Employee not found")
    model.active = False
    db.commit()
    try:
        from ..utils.audit_client import emit_audit_event
        emit_audit_event(
            token=_actor_token(current_user),
            event_type="employee_deactivated",
            entity_type="employee",
            entity_id=str(model.id),
            plant_id=str(plant_id),
            actor_role=_actor_role(current_user),
            actor_email=_actor_email(current_user),
            summary=f"Employee {model.name} ({model.employee_code}) deactivated",
        )
    except Exception as exc:
        logger.warning("audit emit failed (employee_deactivated): %s", exc)
    return {"message": "Employee deactivated"}


# ──────────────────────────────────────────────────────────────────────────
# Shift definition master
# ──────────────────────────────────────────────────────────────────────────

shift_router = APIRouter(prefix="/master/shifts", tags=["Master · Shifts"])


class ShiftCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    code: str
    name: str
    start_time: str = Field(
        ...,
        pattern=SHIFT_TIME_PATTERN,
        description="24-hour clock time in HH:MM (00:00–23:59).",
    )
    end_time: str = Field(
        ...,
        pattern=SHIFT_TIME_PATTERN,
        description="24-hour clock time in HH:MM (00:00–23:59).",
    )
    hours: float = 8.0
    is_night: bool = False
    break_minutes: int = 30
    night_premium_percent: float = 0.0


class ShiftUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    code: Optional[str] = None
    name: Optional[str] = None
    start_time: Optional[str] = Field(
        default=None,
        pattern=SHIFT_TIME_PATTERN,
        description="24-hour clock time in HH:MM (00:00–23:59).",
    )
    end_time: Optional[str] = Field(
        default=None,
        pattern=SHIFT_TIME_PATTERN,
        description="24-hour clock time in HH:MM (00:00–23:59).",
    )
    hours: Optional[float] = None
    is_night: Optional[bool] = None
    break_minutes: Optional[int] = None
    night_premium_percent: Optional[float] = None
    active: Optional[bool] = None
    is_active: Optional[bool] = None


class ShiftResponse(BaseModel):
    id: uuid.UUID
    code: str
    name: str
    start_time: str
    end_time: str
    hours: float
    is_night: bool
    break_minutes: int
    night_premium_percent: float
    plant_id: str
    active: bool
    is_active: Optional[bool] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


@shift_router.get("/", response_model=List[ShiftResponse])
def list_shifts(
    include_inactive: bool = True,
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
):
    query = db.query(models.ShiftDefinition)
    if not include_inactive:
        query = query.filter(models.ShiftDefinition.active == True)
    query = apply_plant_scope(query, models.ShiftDefinition.plant_id, plant_scope)
    rows = query.order_by(models.ShiftDefinition.start_time.asc()).all()
    return [_attach_is_active(r) for r in rows]


@shift_router.post("/", response_model=ShiftResponse)
def create_shift(
    payload: ShiftCreate,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin", "Owner"])),
):
    plant_values = accepted_persisted_plant_ids(plant_id)
    code = (payload.code or "").strip().upper()
    name = (payload.name or "").strip()
    if not code or not name:
        raise HTTPException(status_code=422, detail="code and name are required")
    exists = (
        db.query(models.ShiftDefinition)
        .filter(models.ShiftDefinition.plant_id.in_(plant_values), models.ShiftDefinition.code == code)
        .first()
    )
    if exists:
        raise HTTPException(status_code=409, detail="Shift code already exists in this plant")
    model = models.ShiftDefinition(
        code=code,
        name=name,
        start_time=payload.start_time,
        end_time=payload.end_time,
        hours=float(payload.hours or 8.0),
        is_night=bool(payload.is_night),
        break_minutes=int(payload.break_minutes or 30),
        night_premium_percent=float(payload.night_premium_percent or 0.0),
        plant_id=plant_id,
    )
    db.add(model)
    db.commit()
    db.refresh(model)
    try:
        from ..utils.audit_client import emit_audit_event
        emit_audit_event(
            token=_actor_token(current_user),
            event_type="shift_created",
            entity_type="shift",
            entity_id=str(model.id),
            plant_id=str(plant_id),
            actor_role=_actor_role(current_user),
            actor_email=_actor_email(current_user),
            summary=f"Shift {model.name} ({model.code}) created {model.start_time}-{model.end_time}",
            payload={
                "code": model.code,
                "name": model.name,
                "start_time": model.start_time,
                "end_time": model.end_time,
                "is_night": bool(model.is_night),
            },
        )
    except Exception as exc:
        logger.warning("audit emit failed (shift_created): %s", exc)
    return _attach_is_active(model)


@shift_router.put("/{shift_id}", response_model=ShiftResponse)
def update_shift(
    shift_id: uuid.UUID,
    payload: ShiftUpdate,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin", "Owner"])),
):
    plant_values = accepted_persisted_plant_ids(plant_id)
    model = (
        db.query(models.ShiftDefinition)
        .filter(models.ShiftDefinition.id == shift_id, models.ShiftDefinition.plant_id.in_(plant_values))
        .first()
    )
    if not model:
        raise HTTPException(status_code=404, detail="Shift not found")
    updates = payload.model_dump(exclude_unset=True)
    for key, value in updates.items():
        if key == "code" and value is not None:
            model.code = str(value).strip().upper()
        elif key == "name" and value is not None:
            model.name = str(value).strip()
        elif key == "is_active":
            if value is not None:
                model.active = bool(value)
        else:
            setattr(model, key, value)
    db.commit()
    db.refresh(model)
    try:
        from ..utils.audit_client import emit_audit_event
        emit_audit_event(
            token=_actor_token(current_user),
            event_type="shift_updated",
            entity_type="shift",
            entity_id=str(model.id),
            plant_id=str(plant_id),
            actor_role=_actor_role(current_user),
            actor_email=_actor_email(current_user),
            summary=f"Shift {model.name} ({model.code}) updated",
            payload={"changed_keys": sorted(updates.keys())},
        )
    except Exception as exc:
        logger.warning("audit emit failed (shift_updated): %s", exc)
    return _attach_is_active(model)


@shift_router.delete("/{shift_id}")
def deactivate_shift(
    shift_id: uuid.UUID,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin", "Owner"])),
):
    plant_values = accepted_persisted_plant_ids(plant_id)
    model = (
        db.query(models.ShiftDefinition)
        .filter(models.ShiftDefinition.id == shift_id, models.ShiftDefinition.plant_id.in_(plant_values))
        .first()
    )
    if not model:
        raise HTTPException(status_code=404, detail="Shift not found")
    model.active = False
    db.commit()
    try:
        from ..utils.audit_client import emit_audit_event
        emit_audit_event(
            token=_actor_token(current_user),
            event_type="shift_deactivated",
            entity_type="shift",
            entity_id=str(model.id),
            plant_id=str(plant_id),
            actor_role=_actor_role(current_user),
            actor_email=_actor_email(current_user),
            summary=f"Shift {model.name} ({model.code}) deactivated",
        )
    except Exception as exc:
        logger.warning("audit emit failed (shift_deactivated): %s", exc)
    return {"message": "Shift deactivated"}


# ──────────────────────────────────────────────────────────────────────────
# Plant holiday master
# ──────────────────────────────────────────────────────────────────────────

holiday_router = APIRouter(prefix="/master/holidays", tags=["Master · Holidays"])


class HolidayCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    holiday_date: date
    holiday_type: str = "PUBLIC_HOLIDAY"
    description: Optional[str] = None
    impact_shifts: Optional[str] = None


class HolidayUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    holiday_date: Optional[date] = None
    holiday_type: Optional[str] = None
    description: Optional[str] = None
    impact_shifts: Optional[str] = None


class HolidayResponse(BaseModel):
    id: uuid.UUID
    holiday_date: datetime
    holiday_type: str
    description: Optional[str]
    impact_shifts: Optional[str]
    plant_id: str
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


@holiday_router.get("/", response_model=List[HolidayResponse])
def list_holidays(
    year: Optional[int] = None,
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
):
    query = db.query(models.PlantHoliday)
    if year:
        query = query.filter(
            models.PlantHoliday.holiday_date >= datetime(year, 1, 1),
            models.PlantHoliday.holiday_date < datetime(year + 1, 1, 1),
        )
    query = apply_plant_scope(query, models.PlantHoliday.plant_id, plant_scope)
    return query.order_by(models.PlantHoliday.holiday_date.asc()).all()


@holiday_router.post("/", response_model=HolidayResponse)
def create_holiday(
    payload: HolidayCreate,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin", "Owner"])),
):
    plant_values = accepted_persisted_plant_ids(plant_id)
    h_type = (payload.holiday_type or "").strip().upper() or "PUBLIC_HOLIDAY"
    dt_value = datetime.combine(payload.holiday_date, datetime.min.time())
    exists = (
        db.query(models.PlantHoliday)
        .filter(
            models.PlantHoliday.plant_id.in_(plant_values),
            models.PlantHoliday.holiday_date == dt_value,
            models.PlantHoliday.holiday_type == h_type,
        )
        .first()
    )
    if exists:
        raise HTTPException(status_code=409, detail="Holiday with same date+type already exists")
    model = models.PlantHoliday(
        holiday_date=dt_value,
        holiday_type=h_type,
        description=_trim(payload.description),
        impact_shifts=_trim(payload.impact_shifts),
        plant_id=plant_id,
    )
    db.add(model)
    db.commit()
    db.refresh(model)
    try:
        from ..utils.audit_client import emit_audit_event
        emit_audit_event(
            token=_actor_token(current_user),
            event_type="holiday_created",
            entity_type="holiday",
            entity_id=str(model.id),
            plant_id=str(plant_id),
            actor_role=_actor_role(current_user),
            actor_email=_actor_email(current_user),
            summary=f"Holiday {h_type} on {payload.holiday_date.isoformat()} created",
            payload={
                "holiday_date": payload.holiday_date.isoformat(),
                "holiday_type": h_type,
                "description": model.description,
            },
        )
    except Exception as exc:
        logger.warning("audit emit failed (holiday_created): %s", exc)
    return model


@holiday_router.put("/{holiday_id}", response_model=HolidayResponse)
def update_holiday(
    holiday_id: uuid.UUID,
    payload: HolidayUpdate,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin", "Owner"])),
):
    plant_values = accepted_persisted_plant_ids(plant_id)
    model = (
        db.query(models.PlantHoliday)
        .filter(models.PlantHoliday.id == holiday_id, models.PlantHoliday.plant_id.in_(plant_values))
        .first()
    )
    if not model:
        raise HTTPException(status_code=404, detail="Holiday not found")
    updates = payload.model_dump(exclude_unset=True)
    if "holiday_date" in updates and updates["holiday_date"] is not None:
        model.holiday_date = datetime.combine(updates["holiday_date"], datetime.min.time())
    if "holiday_type" in updates and updates["holiday_type"] is not None:
        model.holiday_type = str(updates["holiday_type"]).strip().upper()
    if "description" in updates:
        model.description = _trim(updates["description"])
    if "impact_shifts" in updates:
        model.impact_shifts = _trim(updates["impact_shifts"])
    db.commit()
    db.refresh(model)
    try:
        from ..utils.audit_client import emit_audit_event
        emit_audit_event(
            token=_actor_token(current_user),
            event_type="holiday_updated",
            entity_type="holiday",
            entity_id=str(model.id),
            plant_id=str(plant_id),
            actor_role=_actor_role(current_user),
            actor_email=_actor_email(current_user),
            summary=f"Holiday {model.holiday_type} on {model.holiday_date.date().isoformat()} updated",
            payload={"changed_keys": sorted(updates.keys())},
        )
    except Exception as exc:
        logger.warning("audit emit failed (holiday_updated): %s", exc)
    return model


@holiday_router.delete("/{holiday_id}")
def delete_holiday(
    holiday_id: uuid.UUID,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin", "Owner"])),
):
    plant_values = accepted_persisted_plant_ids(plant_id)
    model = (
        db.query(models.PlantHoliday)
        .filter(models.PlantHoliday.id == holiday_id, models.PlantHoliday.plant_id.in_(plant_values))
        .first()
    )
    if not model:
        raise HTTPException(status_code=404, detail="Holiday not found")
    holiday_summary = f"Holiday {model.holiday_type} on {model.holiday_date.date().isoformat()} removed"
    holiday_id_str = str(model.id)
    db.delete(model)
    db.commit()
    try:
        from ..utils.audit_client import emit_audit_event
        emit_audit_event(
            token=_actor_token(current_user),
            event_type="holiday_deleted",
            entity_type="holiday",
            entity_id=holiday_id_str,
            plant_id=str(plant_id),
            actor_role=_actor_role(current_user),
            actor_email=_actor_email(current_user),
            summary=holiday_summary,
        )
    except Exception as exc:
        logger.warning("audit emit failed (holiday_deleted): %s", exc)
    return {"message": "Holiday removed"}


# ──────────────────────────────────────────────────────────────────────────
# Reason code master
# ──────────────────────────────────────────────────────────────────────────

reason_router = APIRouter(prefix="/master/reason-codes", tags=["Master · Reason Codes"])


REASON_CATEGORIES = {"DOWNTIME", "SCRAP", "QC_REJECT", "SHORT_CLOSE", "RM_ISSUE", "RETURN", "OTHER"}
REASON_SEVERITIES = {"OK", "WATCH", "CRITICAL"}


class ReasonCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    code: str
    label: str
    category: str
    severity: str = "WATCH"
    description: Optional[str] = None


class ReasonUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    code: Optional[str] = None
    label: Optional[str] = None
    category: Optional[str] = None
    severity: Optional[str] = None
    description: Optional[str] = None
    active: Optional[bool] = None
    is_active: Optional[bool] = None


class ReasonResponse(BaseModel):
    id: uuid.UUID
    code: str
    label: str
    category: str
    severity: str
    description: Optional[str]
    plant_id: str
    active: bool
    is_active: Optional[bool] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


@reason_router.get("/", response_model=List[ReasonResponse])
def list_reasons(
    category: Optional[str] = Query(None),
    include_inactive: bool = True,
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
):
    query = db.query(models.ReasonCode)
    if not include_inactive:
        query = query.filter(models.ReasonCode.active == True)
    if category:
        cat = category.strip().upper()
        if cat in REASON_CATEGORIES:
            query = query.filter(models.ReasonCode.category == cat)
    query = apply_plant_scope(query, models.ReasonCode.plant_id, plant_scope)
    rows = query.order_by(models.ReasonCode.category.asc(), models.ReasonCode.code.asc()).all()
    return [_attach_is_active(r) for r in rows]


@reason_router.post("/", response_model=ReasonResponse)
def create_reason(
    payload: ReasonCreate,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin", "Owner", "PlantManager"])),
):
    plant_values = accepted_persisted_plant_ids(plant_id)
    code = (payload.code or "").strip().upper()
    label = (payload.label or "").strip()
    cat = (payload.category or "").strip().upper()
    sev = (payload.severity or "WATCH").strip().upper()
    if not code or not label:
        raise HTTPException(status_code=422, detail="code and label are required")
    if cat not in REASON_CATEGORIES:
        raise HTTPException(status_code=422, detail=f"category must be one of {sorted(REASON_CATEGORIES)}")
    if sev not in REASON_SEVERITIES:
        raise HTTPException(status_code=422, detail=f"severity must be one of {sorted(REASON_SEVERITIES)}")
    exists = (
        db.query(models.ReasonCode)
        .filter(models.ReasonCode.plant_id.in_(plant_values), models.ReasonCode.code == code)
        .first()
    )
    if exists:
        raise HTTPException(status_code=409, detail="Reason code already exists in this plant")
    model = models.ReasonCode(
        code=code,
        label=label,
        category=cat,
        severity=sev,
        description=_trim(payload.description),
        plant_id=plant_id,
    )
    db.add(model)
    db.commit()
    db.refresh(model)
    try:
        from ..utils.audit_client import emit_audit_event
        emit_audit_event(
            token=_actor_token(current_user),
            event_type="reason_code_created",
            entity_type="reason_code",
            entity_id=str(model.id),
            plant_id=str(plant_id),
            actor_role=_actor_role(current_user),
            actor_email=_actor_email(current_user),
            summary=f"Reason code {model.code} ({model.category}/{model.severity}) created",
            payload={
                "code": model.code,
                "label": model.label,
                "category": model.category,
                "severity": model.severity,
            },
        )
    except Exception as exc:
        logger.warning("audit emit failed (reason_code_created): %s", exc)
    return _attach_is_active(model)


@reason_router.put("/{reason_id}", response_model=ReasonResponse)
def update_reason(
    reason_id: uuid.UUID,
    payload: ReasonUpdate,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin", "Owner", "PlantManager"])),
):
    plant_values = accepted_persisted_plant_ids(plant_id)
    model = (
        db.query(models.ReasonCode)
        .filter(models.ReasonCode.id == reason_id, models.ReasonCode.plant_id.in_(plant_values))
        .first()
    )
    if not model:
        raise HTTPException(status_code=404, detail="Reason code not found")
    updates = payload.model_dump(exclude_unset=True)
    for key, value in updates.items():
        if key == "code" and value is not None:
            model.code = str(value).strip().upper()
        elif key == "label" and value is not None:
            model.label = str(value).strip()
        elif key == "category" and value is not None:
            c = str(value).strip().upper()
            if c not in REASON_CATEGORIES:
                raise HTTPException(status_code=422, detail="bad category")
            model.category = c
        elif key == "severity" and value is not None:
            s = str(value).strip().upper()
            if s not in REASON_SEVERITIES:
                raise HTTPException(status_code=422, detail="bad severity")
            model.severity = s
        elif key == "is_active":
            if value is not None:
                model.active = bool(value)
        else:
            setattr(model, key, value)
    db.commit()
    db.refresh(model)
    try:
        from ..utils.audit_client import emit_audit_event
        emit_audit_event(
            token=_actor_token(current_user),
            event_type="reason_code_updated",
            entity_type="reason_code",
            entity_id=str(model.id),
            plant_id=str(plant_id),
            actor_role=_actor_role(current_user),
            actor_email=_actor_email(current_user),
            summary=f"Reason code {model.code} updated",
            payload={"changed_keys": sorted(updates.keys())},
        )
    except Exception as exc:
        logger.warning("audit emit failed (reason_code_updated): %s", exc)
    return _attach_is_active(model)


@reason_router.delete("/{reason_id}")
def deactivate_reason(
    reason_id: uuid.UUID,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin", "Owner", "PlantManager"])),
):
    plant_values = accepted_persisted_plant_ids(plant_id)
    model = (
        db.query(models.ReasonCode)
        .filter(models.ReasonCode.id == reason_id, models.ReasonCode.plant_id.in_(plant_values))
        .first()
    )
    if not model:
        raise HTTPException(status_code=404, detail="Reason code not found")
    model.active = False
    db.commit()
    try:
        from ..utils.audit_client import emit_audit_event
        emit_audit_event(
            token=_actor_token(current_user),
            event_type="reason_code_deactivated",
            entity_type="reason_code",
            entity_id=str(model.id),
            plant_id=str(plant_id),
            actor_role=_actor_role(current_user),
            actor_email=_actor_email(current_user),
            summary=f"Reason code {model.code} deactivated",
        )
    except Exception as exc:
        logger.warning("audit emit failed (reason_code_deactivated): %s", exc)
    return {"message": "Reason code deactivated"}
