from datetime import date, datetime
from typing import Any, Optional
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import InventoryLocation, ToolAsset, ToolAssetAssignment, ToolAssetEvent, ToolReceipt
from ..utils.auth import get_current_plant, get_current_plant_scope, require_role

router = APIRouter(prefix="/inventory/tools", tags=["physical-tooling"])

VALID_STATUSES = {"AVAILABLE", "ISSUED", "MAINTENANCE", "GRINDING_OUT", "SCRAP"}
CANONICAL_TOOL_CATEGORIES = {"NOTCH", "BLADE", "HOLDER", "V_FLAT", "PUNCH"}


def _plant_values(plant_id: str) -> list[str]:
    normalized = str(plant_id or "").strip()
    aliases = {normalized, normalized.upper(), normalized.lower()}
    if normalized.upper() in {"PLANT_A", "PLANT-1", "PLANT1"}:
        aliases.update({"PLANT_A", "PLANT-1", "PLANT1"})
    if normalized.upper() in {"PLANT_B", "PLANT-2", "PLANT2"}:
        aliases.update({"PLANT_B", "PLANT-2", "PLANT2"})
    return sorted(value for value in aliases if value)


def _actor(user: dict) -> str:
    return str(user.get("name") or user.get("email") or user.get("actor_identity") or user.get("sub") or "system")


def _normalize_tool_category(value: str) -> str:
    category = str(value or "").strip().upper().replace(" ", "_")
    if category not in CANONICAL_TOOL_CATEGORIES:
        raise HTTPException(status_code=400, detail="Physical tool category must match one of the five tooling masters")
    return category


def _location(db: Session, location_id: uuid.UUID, plant_id: str) -> InventoryLocation:
    row = db.query(InventoryLocation).filter(
        InventoryLocation.id == location_id,
        InventoryLocation.plant_id.in_(_plant_values(plant_id)),
        InventoryLocation.active == "true",
    ).first()
    if not row:
        raise HTTPException(status_code=400, detail="Select an active location from Location Master")
    return row


def _asset(db: Session, asset_id: str | uuid.UUID, plant_id: str) -> ToolAsset:
    raw = str(asset_id).strip()
    query = db.query(ToolAsset).filter(ToolAsset.plant_id.in_(_plant_values(plant_id)))
    try:
        query = query.filter(ToolAsset.id == uuid.UUID(raw))
    except ValueError:
        query = query.filter((ToolAsset.asset_no.ilike(raw)) | (ToolAsset.qr_value.ilike(raw)))
    row = query.first()
    if not row:
        raise HTTPException(status_code=404, detail="Physical tool asset not found")
    return row


def _event(
    db: Session,
    asset: ToolAsset,
    event_type: str,
    user: dict,
    *,
    from_status: Optional[str] = None,
    to_status: Optional[str] = None,
    source_id: Optional[str] = None,
    job_card_id: Optional[str] = None,
    stage_type: Optional[str] = None,
    good_qty: Optional[float] = None,
    scrap_qty: Optional[float] = None,
    metadata: Optional[dict[str, Any]] = None,
) -> ToolAssetEvent:
    row = ToolAssetEvent(
        asset_id=asset.id,
        event_type=event_type,
        from_status=from_status,
        to_status=to_status,
        source_type="TOOLING",
        source_id=source_id,
        job_card_id=job_card_id,
        stage_type=stage_type,
        good_qty=good_qty,
        scrap_qty=scrap_qty,
        grind_version=asset.grind_version,
        metadata_json=metadata or None,
        actor=_actor(user),
    )
    db.add(row)
    return row


class ToolReceiptCreate(BaseModel):
    receipt_no: Optional[str] = Field(default=None, max_length=80)
    receipt_date: date
    supplier_name: Optional[str] = Field(default=None, max_length=200)
    po_reference: Optional[str] = Field(default=None, max_length=120)
    invoice_reference: Optional[str] = Field(default=None, max_length=120)
    location_id: uuid.UUID
    notes: Optional[str] = None
    tool_definition_id: uuid.UUID
    category: str
    definition_name: str
    attribute_snapshot: dict[str, Any] = Field(default_factory=dict)
    quantity: int = Field(gt=0, le=500)


class ToolMove(BaseModel):
    location_id: uuid.UUID
    notes: Optional[str] = None


class ToolIssue(BaseModel):
    job_card_id: str = Field(min_length=1, max_length=80)
    stage_type: str = Field(min_length=1, max_length=40)
    notes: Optional[str] = None


class ToolUsage(BaseModel):
    job_card_id: str = Field(min_length=1, max_length=80)
    stage_type: str = Field(min_length=1, max_length=40)
    good_qty: float = Field(default=0, ge=0)
    scrap_qty: float = Field(default=0, ge=0)
    usage_key: str = Field(min_length=1, max_length=160)
    notes: Optional[str] = None


class ToolAction(BaseModel):
    notes: Optional[str] = None


def _asset_payload(row: ToolAsset) -> dict[str, Any]:
    location = row.location
    return {
        "id": row.id,
        "asset_no": row.asset_no,
        "qr_value": row.qr_value,
        "tool_definition_id": row.tool_definition_id,
        "category": row.category,
        "definition_name": row.definition_name,
        "attribute_snapshot": row.attribute_snapshot or {},
        "status": row.status,
        "location_id": row.location_id,
        "location_label": "/".join(filter(None, [location.warehouse, location.zone, location.bin])) if location else None,
        "receipt_id": row.receipt_id,
        "grind_version": row.grind_version,
        "usage_count": row.usage_count,
        "produced_qty": row.produced_qty,
        "scrap_qty": row.scrap_qty,
        "current_job_card_id": row.current_job_card_id,
        "received_at": row.received_at,
        "created_at": row.created_at,
        "updated_at": row.updated_at,
    }


@router.post("/receipts")
def receive_tools(
    payload: ToolReceiptCreate,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin", "Owner", "Store"])),
):
    _location(db, payload.location_id, plant_id)
    category = _normalize_tool_category(payload.category)
    definition_name = str(payload.definition_name or "").strip()
    if not definition_name:
        raise HTTPException(status_code=400, detail="Physical tool definition is required")
    receipt_no = (payload.receipt_no or "").strip().upper() or f"TGRN-{payload.receipt_date:%Y%m%d}-{uuid.uuid4().hex[:6].upper()}"
    if db.query(ToolReceipt).filter(ToolReceipt.plant_id.in_(_plant_values(plant_id)), ToolReceipt.receipt_no == receipt_no).first():
        raise HTTPException(status_code=409, detail="Tool receipt number already exists")
    receipt = ToolReceipt(
        receipt_no=receipt_no,
        receipt_date=payload.receipt_date,
        supplier_name=payload.supplier_name,
        po_reference=payload.po_reference,
        invoice_reference=payload.invoice_reference,
        location_id=payload.location_id,
        notes=payload.notes,
        plant_id=plant_id,
        created_by=_actor(current_user),
    )
    db.add(receipt)
    db.flush()
    assets: list[ToolAsset] = []
    for _ in range(payload.quantity):
        asset_no = f"TA-{payload.receipt_date:%y%m%d}-{uuid.uuid4().hex[:8].upper()}"
        asset = ToolAsset(
            asset_no=asset_no,
            qr_value=f"hariom://tool/{asset_no}",
            tool_definition_id=payload.tool_definition_id,
            category=category,
            definition_name=definition_name,
            attribute_snapshot=payload.attribute_snapshot or {},
            status="AVAILABLE",
            location_id=payload.location_id,
            receipt_id=receipt.id,
            plant_id=plant_id,
        )
        db.add(asset)
        db.flush()
        _event(db, asset, "INWARD", current_user, to_status="AVAILABLE", source_id=str(receipt.id), metadata={"receipt_no": receipt_no})
        assets.append(asset)
    db.commit()
    return {"receipt": {"id": receipt.id, "receipt_no": receipt.receipt_no, "quantity": len(assets)}, "assets": [_asset_payload(row) for row in assets]}


@router.get("")
def list_tool_assets(
    category: Optional[str] = Query(default=None),
    status: Optional[str] = Query(default=None),
    search: Optional[str] = Query(default=None),
    limit: int = Query(default=200, ge=1, le=1000),
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
):
    query = db.query(ToolAsset)
    if plant_scope.get("scope_all"):
        allowed = plant_scope.get("allowed_plants") or []
        if allowed:
            query = query.filter(ToolAsset.plant_id.in_(allowed))
    else:
        query = query.filter(ToolAsset.plant_id == plant_scope["selected_plant_id"])
    if category:
        query = query.filter(ToolAsset.category == category.strip().upper())
    if status:
        normalized = status.strip().upper()
        if normalized not in VALID_STATUSES:
            raise HTTPException(status_code=400, detail="Invalid physical tool status")
        query = query.filter(ToolAsset.status == normalized)
    if search:
        value = f"%{search.strip()}%"
        query = query.filter(
            (ToolAsset.asset_no.ilike(value))
            | (ToolAsset.qr_value.ilike(value))
            | (ToolAsset.definition_name.ilike(value))
            | (ToolAsset.current_job_card_id.ilike(value))
        )
    return [_asset_payload(row) for row in query.order_by(ToolAsset.created_at.desc()).limit(limit).all()]


@router.get("/{asset_id}")
def get_tool_asset(asset_id: str, db: Session = Depends(get_db), plant_id: str = Depends(get_current_plant)):
    asset = _asset(db, asset_id, plant_id)
    return {"asset": _asset_payload(asset), "events": [
        {
            "id": event.id,
            "event_type": event.event_type,
            "from_status": event.from_status,
            "to_status": event.to_status,
            "job_card_id": event.job_card_id,
            "stage_type": event.stage_type,
            "good_qty": event.good_qty,
            "scrap_qty": event.scrap_qty,
            "grind_version": event.grind_version,
            "metadata": event.metadata_json or {},
            "actor": event.actor,
            "event_at": event.event_at,
        }
        for event in db.query(ToolAssetEvent).filter(ToolAssetEvent.asset_id == asset.id).order_by(ToolAssetEvent.event_at.desc()).all()
    ]}


@router.post("/{asset_id}/move")
def move_tool(asset_id: str, payload: ToolMove, db: Session = Depends(get_db), plant_id: str = Depends(get_current_plant), current_user: dict = Depends(require_role(["Admin", "Owner", "Store", "Production"]))):
    asset = _asset(db, asset_id, plant_id)
    if asset.status == "SCRAP":
        raise HTTPException(status_code=409, detail="Scrapped tools cannot be moved")
    _location(db, payload.location_id, plant_id)
    old_location = asset.location_id
    asset.location_id = payload.location_id
    _event(db, asset, "MOVE", current_user, source_id=str(old_location), metadata={"to_location_id": str(payload.location_id), "notes": payload.notes})
    db.commit()
    return _asset_payload(asset)


@router.post("/{asset_id}/issue")
def issue_tool(asset_id: str, payload: ToolIssue, db: Session = Depends(get_db), plant_id: str = Depends(get_current_plant), current_user: dict = Depends(require_role(["Admin", "Owner", "Production"]))):
    asset = _asset(db, asset_id, plant_id)
    if asset.status != "AVAILABLE":
        raise HTTPException(status_code=409, detail=f"Tool is {asset.status}; only AVAILABLE tools can be issued")
    assignment = ToolAssetAssignment(asset_id=asset.id, job_card_id=payload.job_card_id.strip(), stage_type=payload.stage_type.strip().upper(), notes=payload.notes)
    db.add(assignment)
    old_status = asset.status
    asset.status = "ISSUED"
    asset.current_job_card_id = assignment.job_card_id
    _event(db, asset, "ISSUE", current_user, from_status=old_status, to_status=asset.status, job_card_id=assignment.job_card_id, stage_type=assignment.stage_type)
    db.commit()
    return {"assignment_id": assignment.id, "asset": _asset_payload(asset)}


@router.post("/{asset_id}/usage")
def record_tool_usage(asset_id: str, payload: ToolUsage, db: Session = Depends(get_db), plant_id: str = Depends(get_current_plant), current_user: dict = Depends(require_role(["Admin", "Owner", "Production"]))):
    asset = _asset(db, asset_id, plant_id)
    existing = db.query(ToolAssetAssignment).filter(ToolAssetAssignment.usage_key == payload.usage_key).first()
    if existing:
        return {"assignment_id": existing.id, "asset": _asset_payload(asset), "idempotent": True}
    if asset.status != "ISSUED" or asset.current_job_card_id != payload.job_card_id:
        raise HTTPException(status_code=409, detail="Tool must be issued to this job card before production usage is recorded")
    assignment = db.query(ToolAssetAssignment).filter(
        ToolAssetAssignment.asset_id == asset.id,
        ToolAssetAssignment.job_card_id == payload.job_card_id,
        ToolAssetAssignment.stage_type == payload.stage_type.strip().upper(),
        ToolAssetAssignment.status == "OPEN",
    ).order_by(ToolAssetAssignment.issued_at.desc()).first()
    if not assignment:
        raise HTTPException(status_code=404, detail="Open tool assignment not found")
    assignment.usage_key = payload.usage_key
    assignment.good_qty += payload.good_qty
    assignment.scrap_qty += payload.scrap_qty
    asset.usage_count += 1
    asset.produced_qty += payload.good_qty
    asset.scrap_qty += payload.scrap_qty
    _event(db, asset, "PRODUCTION_USAGE", current_user, job_card_id=payload.job_card_id, stage_type=payload.stage_type.strip().upper(), good_qty=payload.good_qty, scrap_qty=payload.scrap_qty, metadata={"usage_key": payload.usage_key, "notes": payload.notes})
    db.commit()
    return {"assignment_id": assignment.id, "asset": _asset_payload(asset), "idempotent": False}


@router.post("/{asset_id}/return")
def return_tool(asset_id: str, payload: ToolAction, db: Session = Depends(get_db), plant_id: str = Depends(get_current_plant), current_user: dict = Depends(require_role(["Admin", "Owner", "Store", "Production"]))):
    asset = _asset(db, asset_id, plant_id)
    assignment = db.query(ToolAssetAssignment).filter(ToolAssetAssignment.asset_id == asset.id, ToolAssetAssignment.status == "OPEN").order_by(ToolAssetAssignment.issued_at.desc()).first()
    if not assignment:
        raise HTTPException(status_code=409, detail="No open production issue exists for this tool")
    old_status = asset.status
    assignment.status = "CLOSED"
    assignment.returned_at = datetime.utcnow()
    asset.current_job_card_id = None
    asset.status = "AVAILABLE"
    _event(db, asset, "RETURN", current_user, from_status=old_status, to_status=asset.status, job_card_id=assignment.job_card_id, stage_type=assignment.stage_type, good_qty=assignment.good_qty, scrap_qty=assignment.scrap_qty, metadata={"notes": payload.notes})
    db.commit()
    return _asset_payload(asset)


@router.post("/{asset_id}/grinding-out")
def grinding_out(asset_id: str, payload: ToolAction, db: Session = Depends(get_db), plant_id: str = Depends(get_current_plant), current_user: dict = Depends(require_role(["Admin", "Owner", "Store"]))):
    asset = _asset(db, asset_id, plant_id)
    if asset.category != "BLADE":
        raise HTTPException(status_code=400, detail="Grinding lifecycle is available only for Blade assets")
    if asset.status != "AVAILABLE":
        raise HTTPException(status_code=409, detail="Blade must be AVAILABLE before sending it for grinding")
    old_status = asset.status
    asset.status = "GRINDING_OUT"
    _event(db, asset, "GRINDING_OUT", current_user, from_status=old_status, to_status=asset.status, metadata={"notes": payload.notes, "grind_version": asset.grind_version})
    db.commit()
    return _asset_payload(asset)


@router.post("/{asset_id}/grinding-return")
def grinding_return(asset_id: str, payload: ToolAction, db: Session = Depends(get_db), plant_id: str = Depends(get_current_plant), current_user: dict = Depends(require_role(["Admin", "Owner", "Store"]))):
    asset = _asset(db, asset_id, plant_id)
    if asset.category != "BLADE" or asset.status != "GRINDING_OUT":
        raise HTTPException(status_code=409, detail="Only a Blade sent for grinding can be inwarded from grinding")
    old_version = asset.grind_version
    asset.grind_version += 1
    asset.status = "AVAILABLE"
    _event(db, asset, "GRINDING_RETURN", current_user, from_status="GRINDING_OUT", to_status="AVAILABLE", metadata={"notes": payload.notes, "previous_grind_version": old_version})
    db.commit()
    return _asset_payload(asset)


@router.post("/{asset_id}/maintenance")
def maintain_tool(asset_id: str, payload: ToolAction, db: Session = Depends(get_db), plant_id: str = Depends(get_current_plant), current_user: dict = Depends(require_role(["Admin", "Owner", "Store"]))):
    asset = _asset(db, asset_id, plant_id)
    if asset.status in {"ISSUED", "GRINDING_OUT", "SCRAP"}:
        raise HTTPException(status_code=409, detail="This tool cannot be moved to maintenance from its current lifecycle state")
    old_status = asset.status
    asset.status = "MAINTENANCE"
    _event(db, asset, "MAINTENANCE", current_user, from_status=old_status, to_status="MAINTENANCE", metadata={"notes": payload.notes})
    db.commit()
    return _asset_payload(asset)


@router.post("/{asset_id}/maintenance-complete")
def complete_maintenance(asset_id: str, payload: ToolAction, db: Session = Depends(get_db), plant_id: str = Depends(get_current_plant), current_user: dict = Depends(require_role(["Admin", "Owner", "Store"]))):
    asset = _asset(db, asset_id, plant_id)
    if asset.status != "MAINTENANCE":
        raise HTTPException(status_code=409, detail="Tool is not in maintenance")
    asset.status = "AVAILABLE"
    _event(db, asset, "MAINTENANCE_COMPLETE", current_user, from_status="MAINTENANCE", to_status="AVAILABLE", metadata={"notes": payload.notes})
    db.commit()
    return _asset_payload(asset)


@router.post("/{asset_id}/scrap")
def scrap_tool(asset_id: str, payload: ToolAction, db: Session = Depends(get_db), plant_id: str = Depends(get_current_plant), current_user: dict = Depends(require_role(["Admin", "Owner", "Store"]))):
    asset = _asset(db, asset_id, plant_id)
    if asset.status == "SCRAP":
        return _asset_payload(asset)
    if asset.status == "ISSUED":
        raise HTTPException(status_code=409, detail="Return an issued tool before scrapping it")
    old_status = asset.status
    asset.status = "SCRAP"
    asset.retired_at = datetime.utcnow()
    _event(db, asset, "SCRAP", current_user, from_status=old_status, to_status="SCRAP", metadata={"notes": payload.notes})
    db.commit()
    return _asset_payload(asset)


@router.get("/report/summary")
def tool_asset_report(db: Session = Depends(get_db), plant_scope: dict = Depends(get_current_plant_scope)):
    query = db.query(ToolAsset)
    if not plant_scope.get("scope_all"):
        query = query.filter(ToolAsset.plant_id == plant_scope["selected_plant_id"])
    rows = query.all()
    by_category: dict[str, dict[str, Any]] = {}
    for row in rows:
        bucket = by_category.setdefault(row.category, {"category": row.category, "assets": 0, "available": 0, "issued": 0, "maintenance": 0, "grinding_out": 0, "scrap": 0, "produced_qty": 0.0})
        bucket["assets"] += 1
        bucket[row.status.lower()] = bucket.get(row.status.lower(), 0) + 1
        bucket["produced_qty"] += float(row.produced_qty or 0)
    return {
        "summary": {
            "total_assets": len(rows),
            "available": sum(1 for row in rows if row.status == "AVAILABLE"),
            "issued": sum(1 for row in rows if row.status == "ISSUED"),
            "maintenance": sum(1 for row in rows if row.status == "MAINTENANCE"),
            "grinding_out": sum(1 for row in rows if row.status == "GRINDING_OUT"),
            "scrap": sum(1 for row in rows if row.status == "SCRAP"),
            "produced_qty": sum(float(row.produced_qty or 0) for row in rows),
        },
        "by_category": list(by_category.values()),
        "asset_output": [
            {
                "asset_no": row.asset_no,
                "qr_value": row.qr_value,
                "category": row.category,
                "definition_name": row.definition_name,
                "status": row.status,
                "grind_version": int(row.grind_version or 0),
                "produced_qty": float(row.produced_qty or 0),
                "scrap_qty": float(row.scrap_qty or 0),
                "usage_count": int(row.usage_count or 0),
                "current_job_card_id": row.current_job_card_id,
            }
            for row in sorted(rows, key=lambda item: (float(item.produced_qty or 0), item.asset_no), reverse=True)
        ],
    }
