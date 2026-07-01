from datetime import datetime
from typing import Any, Dict, List, Optional
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func
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

TOOL_STATUSES = {"ACTIVE", "MAINTENANCE", "SCRAP"}
TOOL_USAGE_EVENTS = {"SPEC_SELECTED", "PRODUCTION_USED", "MAINTENANCE", "SCRAP", "STATUS_CHANGE"}
NOTCH_TOOL_CATEGORIES = {
    "NOTCH_TYPE": "Notch",
    "NOTCHING_BLADE": "Blade",
    "NOTCHING_HOLDER": "Holder",
    "V_FLAT": "V + Flat",
    "PUNCH": "Punch",
    "NOTCH_WIDER": "Notch Wider",
    "NOTCH_PATTI": "Notch Patti",
    "NOTCH_DIRECTION": "Notch Direction",
}


def _normalize_text(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _normalize_category(value: Optional[str]) -> str:
    text = _normalize_text(value)
    if not text:
        raise HTTPException(status_code=400, detail="Tool category is required")
    return text.upper().replace(" ", "_")


def _normalize_status(value: Optional[str]) -> str:
    status = (_normalize_text(value) or "ACTIVE").upper()
    if status not in TOOL_STATUSES:
        raise HTTPException(status_code=400, detail=f"Tool status must be one of {sorted(TOOL_STATUSES)}")
    return status


def _normalize_event(value: Optional[str]) -> str:
    event = (_normalize_text(value) or "SPEC_SELECTED").upper()
    if event not in TOOL_USAGE_EVENTS:
        raise HTTPException(status_code=400, detail=f"Tool event must be one of {sorted(TOOL_USAGE_EVENTS)}")
    return event


def _plant_values(plant_id: str) -> list[str]:
    return list(accepted_persisted_plant_ids(plant_id))


def _current_actor(current_user: Optional[dict]) -> Optional[str]:
    if not current_user:
        return None
    return (
        current_user.get("name")
        or current_user.get("email")
        or current_user.get("username")
        or current_user.get("sub")
    )


def _log_tool_event(
    *,
    db: Session,
    tool: Optional[models.ToolMaster],
    plant_id: str,
    category: str,
    tool_name: str,
    event_type: str,
    source_type: str,
    source_id: Optional[str] = None,
    source_ref: Optional[str] = None,
    production_qty: Optional[float] = None,
    actor: Optional[str] = None,
    notes: Optional[str] = None,
    metadata_json: Optional[Dict[str, Any]] = None,
) -> models.ToolUsageLog:
    log = models.ToolUsageLog(
        tool_id=tool.id if tool else None,
        category=_normalize_category(category),
        tool_name=_normalize_text(tool_name) or (tool.name if tool else ""),
        event_type=_normalize_event(event_type),
        source_type=(_normalize_text(source_type) or "MASTER_TOOL").upper(),
        source_id=_normalize_text(source_id),
        source_ref=_normalize_text(source_ref),
        production_qty=production_qty,
        actor=_normalize_text(actor),
        notes=_normalize_text(notes),
        plant_id=plant_id,
        metadata_json=metadata_json or None,
    )
    db.add(log)
    if tool and log.event_type in {"SPEC_SELECTED", "PRODUCTION_USED"}:
        tool.usage_count = int(tool.usage_count or 0) + 1
        tool.updated_at = datetime.utcnow()
    return log


def _resolve_tool_for_log(
    *,
    db: Session,
    plant_id: str,
    tool_id: Optional[uuid.UUID],
    category: Optional[str],
    tool_name: Optional[str],
) -> Optional[models.ToolMaster]:
    plant_values = _plant_values(plant_id)
    if tool_id:
        return (
            db.query(models.ToolMaster)
            .filter(models.ToolMaster.id == tool_id, models.ToolMaster.plant_id.in_(plant_values))
            .first()
        )
    normalized_category = _normalize_category(category)
    name = _normalize_text(tool_name)
    if not name:
        return None
    return (
        db.query(models.ToolMaster)
        .filter(
            models.ToolMaster.plant_id.in_(plant_values),
            models.ToolMaster.category == normalized_category,
            models.ToolMaster.name.ilike(name),
            models.ToolMaster.active == True,
        )
        .order_by(models.ToolMaster.status.asc(), models.ToolMaster.created_at.asc())
        .first()
    )


class ToolCreate(BaseModel):
    category: str
    subcategory: Optional[str] = None
    name: str
    code: Optional[str] = None
    spec_text: Optional[str] = None
    department: str = "COMMON"
    status: Optional[str] = "ACTIVE"
    location: Optional[str] = None
    condition_notes: Optional[str] = None
    last_maintenance_at: Optional[datetime] = None
    next_maintenance_due: Optional[datetime] = None


class ToolUpdate(BaseModel):
    category: Optional[str] = None
    subcategory: Optional[str] = None
    name: Optional[str] = None
    code: Optional[str] = None
    spec_text: Optional[str] = None
    department: Optional[str] = None
    status: Optional[str] = None
    location: Optional[str] = None
    condition_notes: Optional[str] = None
    last_maintenance_at: Optional[datetime] = None
    next_maintenance_due: Optional[datetime] = None
    scrapped_at: Optional[datetime] = None
    usage_count: Optional[int] = None
    active: Optional[bool] = None


class ToolStatusUpdate(BaseModel):
    status: str
    notes: Optional[str] = None
    location: Optional[str] = None
    condition_notes: Optional[str] = None
    next_maintenance_due: Optional[datetime] = None


class ToolUsageLogCreate(BaseModel):
    tool_id: Optional[uuid.UUID] = None
    category: Optional[str] = None
    tool_name: Optional[str] = None
    event_type: str = "SPEC_SELECTED"
    source_type: str = "SPEC_SHEET"
    source_id: Optional[str] = None
    source_ref: Optional[str] = None
    production_qty: Optional[float] = None
    actor: Optional[str] = None
    notes: Optional[str] = None
    metadata_json: Optional[Dict[str, Any]] = None


class ToolResponse(BaseModel):
    id: uuid.UUID
    category: str
    subcategory: Optional[str]
    name: str
    code: Optional[str]
    spec_text: Optional[str]
    department: str
    plant_id: str
    status: str
    location: Optional[str] = None
    condition_notes: Optional[str] = None
    last_maintenance_at: Optional[datetime] = None
    next_maintenance_due: Optional[datetime] = None
    scrapped_at: Optional[datetime] = None
    usage_count: int = 0
    active: bool
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class ToolUsageLogResponse(BaseModel):
    id: uuid.UUID
    tool_id: Optional[uuid.UUID] = None
    category: str
    tool_name: str
    event_type: str
    source_type: str
    source_id: Optional[str] = None
    source_ref: Optional[str] = None
    production_qty: Optional[float] = None
    actor: Optional[str] = None
    notes: Optional[str] = None
    plant_id: str
    metadata_json: Optional[Dict[str, Any]] = None
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


@router.get("/", response_model=List[ToolResponse])
def get_tools(
    category: Optional[str] = Query(default=None),
    department: Optional[str] = Query(default=None),
    status: Optional[str] = Query(default=None),
    include_inactive: bool = Query(default=False),
    include_unavailable: bool = Query(default=False),
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
):
    query = db.query(models.ToolMaster)
    if not include_inactive:
        query = query.filter(models.ToolMaster.active == True)
    if status:
        query = query.filter(models.ToolMaster.status == _normalize_status(status))
    elif not include_unavailable:
        query = query.filter(models.ToolMaster.status == "ACTIVE")
    query = apply_plant_scope(query, models.ToolMaster.plant_id, plant_scope)
    if category:
        query = query.filter(models.ToolMaster.category == _normalize_category(category))
    if department:
        query = query.filter(models.ToolMaster.department.ilike(department.strip()))
    return query.order_by(models.ToolMaster.category.asc(), models.ToolMaster.name.asc()).all()


@router.get("/categories")
def get_tool_categories():
    return [{"value": value, "label": label} for value, label in NOTCH_TOOL_CATEGORIES.items()]


@router.get("/logs", response_model=List[ToolUsageLogResponse])
def get_tool_logs(
    category: Optional[str] = Query(default=None),
    tool_id: Optional[uuid.UUID] = Query(default=None),
    event_type: Optional[str] = Query(default=None),
    source_type: Optional[str] = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
):
    query = db.query(models.ToolUsageLog)
    query = apply_plant_scope(query, models.ToolUsageLog.plant_id, plant_scope)
    if category:
        query = query.filter(models.ToolUsageLog.category == _normalize_category(category))
    if tool_id:
        query = query.filter(models.ToolUsageLog.tool_id == tool_id)
    if event_type:
        query = query.filter(models.ToolUsageLog.event_type == _normalize_event(event_type))
    if source_type:
        query = query.filter(models.ToolUsageLog.source_type == source_type.strip().upper())
    return query.order_by(models.ToolUsageLog.created_at.desc()).limit(limit).all()


@router.get("/report")
def get_tool_report(
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
):
    tool_query = apply_plant_scope(db.query(models.ToolMaster), models.ToolMaster.plant_id, plant_scope)
    tool_query = tool_query.filter(models.ToolMaster.active == True)
    log_query = apply_plant_scope(db.query(models.ToolUsageLog), models.ToolUsageLog.plant_id, plant_scope)

    by_status = {
        status: int(count or 0)
        for status, count in tool_query.with_entities(models.ToolMaster.status, func.count(models.ToolMaster.id))
        .group_by(models.ToolMaster.status)
        .all()
    }
    by_category_rows = (
        tool_query.with_entities(
            models.ToolMaster.category,
            models.ToolMaster.status,
            func.count(models.ToolMaster.id),
            func.coalesce(func.sum(models.ToolMaster.usage_count), 0),
        )
        .group_by(models.ToolMaster.category, models.ToolMaster.status)
        .order_by(models.ToolMaster.category.asc(), models.ToolMaster.status.asc())
        .all()
    )
    usage_rows = (
        log_query.with_entities(
            models.ToolUsageLog.category,
            models.ToolUsageLog.tool_name,
            models.ToolUsageLog.event_type,
            func.count(models.ToolUsageLog.id),
            func.max(models.ToolUsageLog.created_at),
            func.coalesce(func.sum(models.ToolUsageLog.production_qty), 0),
        )
        .group_by(models.ToolUsageLog.category, models.ToolUsageLog.tool_name, models.ToolUsageLog.event_type)
        .order_by(func.max(models.ToolUsageLog.created_at).desc())
        .limit(100)
        .all()
    )
    recent_logs = log_query.order_by(models.ToolUsageLog.created_at.desc()).limit(50).all()

    return {
        "summary": {
            "total_tools": sum(by_status.values()),
            "active": by_status.get("ACTIVE", 0),
            "maintenance": by_status.get("MAINTENANCE", 0),
            "scrap": by_status.get("SCRAP", 0),
        },
        "by_category": [
            {
                "category": category,
                "status": status,
                "count": int(count or 0),
                "usage_count": int(usage_count or 0),
            }
            for category, status, count, usage_count in by_category_rows
        ],
        "usage": [
            {
                "category": category,
                "tool_name": tool_name,
                "event_type": event_type,
                "count": int(count or 0),
                "last_used_at": last_used_at,
                "production_qty": float(production_qty or 0),
            }
            for category, tool_name, event_type, count, last_used_at, production_qty in usage_rows
        ],
        "recent_logs": [ToolUsageLogResponse.model_validate(row).model_dump() for row in recent_logs],
    }


@router.post("/log-usage", response_model=ToolUsageLogResponse)
def log_tool_usage(
    payload: ToolUsageLogCreate,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin", "Owner", "PlantManager", "Planner", "Sales", "Production"])),
):
    tool = _resolve_tool_for_log(
        db=db,
        plant_id=plant_id,
        tool_id=payload.tool_id,
        category=payload.category,
        tool_name=payload.tool_name,
    )
    category = _normalize_category(payload.category or (tool.category if tool else None))
    tool_name = _normalize_text(payload.tool_name or (tool.name if tool else None))
    if not tool_name:
        raise HTTPException(status_code=400, detail="Tool name is required for usage logging")
    event_type = _normalize_event(payload.event_type)
    source_type = (_normalize_text(payload.source_type) or "SPEC_SHEET").upper()
    source_id = _normalize_text(payload.source_id)
    existing = None
    if source_id:
        existing = (
            db.query(models.ToolUsageLog)
            .filter(
                models.ToolUsageLog.plant_id.in_(_plant_values(plant_id)),
                models.ToolUsageLog.event_type == event_type,
                models.ToolUsageLog.source_type == source_type,
                models.ToolUsageLog.source_id == source_id,
                models.ToolUsageLog.category == category,
                models.ToolUsageLog.tool_name.ilike(tool_name),
            )
            .first()
        )
    if existing:
        return existing
    log = _log_tool_event(
        db=db,
        tool=tool,
        plant_id=plant_id,
        category=category,
        tool_name=tool_name,
        event_type=event_type,
        source_type=source_type,
        source_id=source_id,
        source_ref=payload.source_ref,
        production_qty=payload.production_qty,
        actor=payload.actor or _current_actor(current_user),
        notes=payload.notes,
        metadata_json=payload.metadata_json,
    )
    db.commit()
    db.refresh(log)
    return log


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
    data = payload.model_dump()
    data["category"] = _normalize_category(data.get("category"))
    data["status"] = _normalize_status(data.get("status"))
    data["name"] = _normalize_text(data.get("name")) or ""
    data["code"] = _normalize_text(data.get("code"))
    data["department"] = (_normalize_text(data.get("department")) or "COMMON").upper()
    if not data["name"]:
        raise HTTPException(status_code=400, detail="Tool name is required")
    if data["status"] == "SCRAP" and not data.get("scrapped_at"):
        data["scrapped_at"] = datetime.utcnow()
    model = models.ToolMaster(**data, plant_id=plant_id)
    db.add(model)
    db.flush()
    _log_tool_event(
        db=db,
        tool=model,
        plant_id=plant_id,
        category=model.category,
        tool_name=model.name,
        event_type="STATUS_CHANGE",
        source_type="MASTER_TOOL",
        actor=_current_actor(current_user),
        notes="Tool master created",
    )
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

    incoming = payload.model_dump(exclude_unset=True)
    old_status = model.status
    if "category" in incoming and incoming["category"] is not None:
        incoming["category"] = _normalize_category(incoming["category"])
    if "status" in incoming and incoming["status"] is not None:
        incoming["status"] = _normalize_status(incoming["status"])
    if "department" in incoming and incoming["department"] is not None:
        incoming["department"] = str(incoming["department"]).strip().upper()
    if "code" in incoming:
        incoming["code"] = _normalize_text(incoming.get("code"))
    if "name" in incoming and incoming["name"] is not None:
        incoming["name"] = _normalize_text(incoming["name"]) or model.name
    for key, value in incoming.items():
        setattr(model, key, value)
    if model.status == "SCRAP" and model.scrapped_at is None:
        model.scrapped_at = datetime.utcnow()
    if model.status == "ACTIVE":
        model.scrapped_at = None
    model.updated_at = datetime.utcnow()
    if old_status != model.status:
        _log_tool_event(
            db=db,
            tool=model,
            plant_id=plant_id,
            category=model.category,
            tool_name=model.name,
            event_type="STATUS_CHANGE",
            source_type="MASTER_TOOL",
            actor=_current_actor(current_user),
            notes=f"Status changed from {old_status} to {model.status}",
        )
    db.commit()
    db.refresh(model)
    return model


@router.post("/{tool_id}/status", response_model=ToolResponse)
def update_tool_status(
    tool_id: uuid.UUID,
    payload: ToolStatusUpdate,
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

    old_status = model.status
    next_status = _normalize_status(payload.status)
    model.status = next_status
    model.location = _normalize_text(payload.location) or model.location
    model.condition_notes = _normalize_text(payload.condition_notes) or model.condition_notes
    if payload.next_maintenance_due is not None:
        model.next_maintenance_due = payload.next_maintenance_due
    if next_status == "MAINTENANCE":
        model.last_maintenance_at = datetime.utcnow()
    if next_status == "SCRAP":
        model.scrapped_at = model.scrapped_at or datetime.utcnow()
    if next_status == "ACTIVE":
        model.scrapped_at = None
    model.updated_at = datetime.utcnow()
    event_type = "SCRAP" if next_status == "SCRAP" else "MAINTENANCE" if next_status == "MAINTENANCE" else "STATUS_CHANGE"
    _log_tool_event(
        db=db,
        tool=model,
        plant_id=plant_id,
        category=model.category,
        tool_name=model.name,
        event_type=event_type,
        source_type="MASTER_TOOL",
        actor=_current_actor(current_user),
        notes=payload.notes or f"Status changed from {old_status} to {next_status}",
    )
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
    model.updated_at = datetime.utcnow()
    _log_tool_event(
        db=db,
        tool=model,
        plant_id=plant_id,
        category=model.category,
        tool_name=model.name,
        event_type="STATUS_CHANGE",
        source_type="MASTER_TOOL",
        actor=_current_actor(current_user),
        notes="Tool deactivated from dropdowns",
    )
    db.commit()
    return {"message": "Tool deactivated successfully"}
