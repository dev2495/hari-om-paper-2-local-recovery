from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Any, Optional
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import (
    CostSource,
    InventoryCarryForward,
    InventoryCarryForwardLine,
    InventoryCertification,
    InventoryCertificationLine,
    InventoryLocation,
    InventoryOpeningLoad,
    InventoryOpeningLoadLine,
    ItemMaster,
    ItemType,
    PaperReel,
    ReelScanEvent,
    ReelScanEventType,
    ReelScanSource,
    ReelStatus,
    ReferenceType,
    StockBatch,
    StockTransaction,
    TrackingMode,
    TransactionType,
)
from ..services.stock_control import compute_stock_statement
from ..utils.auth import get_current_plant, get_current_plant_scope, get_current_user, require_role

router = APIRouter(prefix="/inventory/stock-control", tags=["inventory-stock-control"])

STOCK_STATUSES = {"UNRESTRICTED", "WIP", "QC_HOLD", "BLOCKED", "DISPATCH_STAGING", "SCRAP"}


def _actor(current_user: dict) -> str:
    return str(
        current_user.get("actor_identity")
        or current_user.get("actual_sub")
        or current_user.get("sub")
        or "system"
    )


def _to_uuid(value: str, field: str = "plant_id") -> uuid.UUID:
    try:
        return uuid.UUID(str(value))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid {field}: {value}") from exc


def _fiscal_year_label(end_date: date) -> str:
    start_year = end_date.year if end_date.month >= 4 else end_date.year - 1
    return f"FY {start_year}-{str(start_year + 1)[-2:]}"


def _normalize_cost_source(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    normalized = value.strip().upper()
    if normalized not in {source.value for source in CostSource}:
        raise HTTPException(status_code=400, detail="cost_source must be MANUAL, SUPPLIER, or AVG_BATCH")
    return normalized


def _item_cost_source(item: ItemMaster) -> Optional[CostSource]:
    raw = str(getattr(item, "cost_source", "") or "").strip().upper()
    if raw in {source.value for source in CostSource}:
        return CostSource(raw)
    return None


def _validate_status(value: str) -> str:
    normalized = str(value or "").strip().upper() or "UNRESTRICTED"
    if normalized not in STOCK_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid stock_status")
    return normalized


def _apply_cert_scope(query, plant_scope: dict):
    if plant_scope.get("scope_all"):
        allowed = plant_scope.get("allowed_plants") or []
        if allowed:
            return query.filter(InventoryCertification.plant_id.in_(allowed))
        return query
    return query.filter(InventoryCertification.plant_id == plant_scope["selected_plant_id"])


def _serialize_line(line: InventoryCertificationLine) -> dict[str, Any]:
    return {
        "id": str(line.id),
        "item_id": str(line.item_id),
        "item_code": line.item_code,
        "item_name": line.item_name,
        "item_type": line.item_type,
        "tracking_mode": line.tracking_mode,
        "uom": line.uom,
        "opening_qty": round(float(line.opening_qty or 0.0), 3),
        "inward_qty": round(float(line.inward_qty or 0.0), 3),
        "outward_qty": round(float(line.outward_qty or 0.0), 3),
        "adjustment_qty": round(float(line.adjustment_qty or 0.0), 3),
        "closing_qty": round(float(line.closing_qty or 0.0), 3),
        "physical_qty": round(float(line.physical_qty if line.physical_qty is not None else line.closing_qty or 0.0), 3),
        "variance_qty": round(float(line.variance_qty or 0.0), 3),
        "unit_cost": round(float(line.unit_cost or 0.0), 4),
        "closing_value": round(float(line.closing_value or 0.0), 2),
        "variance_value": round(float(line.variance_value or 0.0), 2),
        "reorder_level": round(float(line.reorder_level or 0.0), 2),
        "safety_stock": round(float(line.safety_stock or 0.0), 2),
        "lead_time_days": round(float(line.lead_time_days or 0.0), 1),
        "notes": line.notes,
    }


def _serialize_certification(header: InventoryCertification, include_lines: bool = False) -> dict[str, Any]:
    lines = list(header.lines or [])
    total_closing_value = round(sum(float(line.closing_value or 0.0) for line in lines), 2)
    total_variance_value = round(sum(float(line.variance_value or 0.0) for line in lines), 2)
    total_variance_qty = round(sum(abs(float(line.variance_qty or 0.0)) for line in lines), 3)
    payload = {
        "id": str(header.id),
        "plant_id": header.plant_id,
        "period_start": header.period_start.isoformat(),
        "period_end": header.period_end.isoformat(),
        "fiscal_year_label": header.fiscal_year_label,
        "status": header.status,
        "notes": header.notes,
        "created_by": header.created_by,
        "certified_by": header.certified_by,
        "certified_at": header.certified_at.isoformat() if header.certified_at else None,
        "carried_forward_at": header.carried_forward_at.isoformat() if header.carried_forward_at else None,
        "created_at": header.created_at.isoformat() if header.created_at else None,
        "line_count": len(lines),
        "totals": {
            "closing_value": total_closing_value,
            "variance_value": total_variance_value,
            "absolute_variance_qty": total_variance_qty,
        },
    }
    if include_lines:
        payload["lines"] = [_serialize_line(line) for line in lines]
    return payload


def _line_from_statement(cert_id: uuid.UUID, row: dict[str, Any]) -> InventoryCertificationLine:
    physical_qty = float(row.get("physical_qty") or row.get("closing_qty") or 0.0)
    closing_qty = float(row.get("closing_qty") or 0.0)
    unit_cost = float(row.get("unit_cost") or 0.0)
    variance = physical_qty - closing_qty
    return InventoryCertificationLine(
        certification_id=cert_id,
        item_id=uuid.UUID(str(row["item_id"])),
        item_code=row["item_code"],
        item_name=row["item_name"],
        item_type=row["item_type"],
        tracking_mode=row["tracking_mode"],
        uom=row["uom"],
        opening_qty=float(row.get("opening_qty") or 0.0),
        inward_qty=float(row.get("inward_qty") or 0.0),
        outward_qty=float(row.get("outward_qty") or 0.0),
        adjustment_qty=float(row.get("adjustment_qty") or 0.0),
        closing_qty=closing_qty,
        physical_qty=physical_qty,
        variance_qty=variance,
        unit_cost=unit_cost,
        closing_value=round(closing_qty * unit_cost, 2),
        variance_value=round(variance * unit_cost, 2),
        reorder_level=float(row.get("reorder_level") or 0.0),
        safety_stock=float(row.get("safety_stock") or 0.0),
        lead_time_days=float(row.get("lead_time_days") or 0.0),
    )


class OpeningLoadLinePayload(BaseModel):
    item_id: uuid.UUID
    qty: float = Field(gt=0)
    batch_no: Optional[str] = Field(default=None, max_length=100)
    reel_code: Optional[str] = Field(default=None, max_length=100)
    location_id: Optional[uuid.UUID] = None
    stock_status: str = "UNRESTRICTED"
    unit_cost: Optional[float] = Field(default=None, ge=0)
    cost_source: Optional[str] = None
    notes: Optional[str] = Field(default=None, max_length=500)

    @field_validator("stock_status")
    @classmethod
    def validate_stock_status(cls, value: str) -> str:
        normalized = str(value or "").strip().upper() or "UNRESTRICTED"
        if normalized not in STOCK_STATUSES:
            raise ValueError("Invalid stock_status")
        return normalized

    @field_validator("cost_source")
    @classmethod
    def validate_cost_source(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        normalized = value.strip().upper()
        if normalized not in {source.value for source in CostSource}:
            raise ValueError("cost_source must be MANUAL, SUPPLIER, or AVG_BATCH")
        return normalized


class OpeningLoadPayload(BaseModel):
    document_no: Optional[str] = Field(default=None, max_length=80)
    effective_date: date
    notes: Optional[str] = Field(default=None, max_length=500)
    lines: list[OpeningLoadLinePayload] = Field(min_length=1)


class CertificationCreatePayload(BaseModel):
    period_start: date
    period_end: date
    fiscal_year_label: Optional[str] = Field(default=None, max_length=30)
    notes: Optional[str] = Field(default=None, max_length=500)


class CertificationLineUpdatePayload(BaseModel):
    line_id: Optional[uuid.UUID] = None
    item_id: Optional[uuid.UUID] = None
    physical_qty: float = Field(ge=0)
    notes: Optional[str] = Field(default=None, max_length=500)


class CertificationUpdatePayload(BaseModel):
    notes: Optional[str] = Field(default=None, max_length=500)
    lines: list[CertificationLineUpdatePayload] = Field(default_factory=list)


class CertificationActionPayload(BaseModel):
    notes: Optional[str] = Field(default=None, max_length=500)


class CarryForwardPayload(BaseModel):
    opening_date: Optional[date] = None
    fiscal_year_label: Optional[str] = Field(default=None, max_length=30)
    document_no: Optional[str] = Field(default=None, max_length=80)
    notes: Optional[str] = Field(default=None, max_length=500)


@router.get("/statement")
def stock_statement(
    start_date: date = Query(...),
    end_date: date = Query(...),
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
    current_user: dict = Depends(get_current_user),
):
    if start_date > end_date:
        raise HTTPException(status_code=400, detail="start_date cannot be after end_date")
    return compute_stock_statement(db=db, plant_scope=plant_scope, start_date=start_date, end_date=end_date)


@router.get("/opening-loads")
def list_opening_loads(
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
    current_user: dict = Depends(get_current_user),
):
    query = db.query(InventoryOpeningLoad)
    if plant_scope.get("scope_all"):
        allowed = plant_scope.get("allowed_plants") or []
        if allowed:
            query = query.filter(InventoryOpeningLoad.plant_id.in_(allowed))
    else:
        query = query.filter(InventoryOpeningLoad.plant_id == plant_scope["selected_plant_id"])
    rows = query.order_by(InventoryOpeningLoad.effective_date.desc(), InventoryOpeningLoad.created_at.desc()).limit(50).all()
    return {
        "items": [
            {
                "id": str(row.id),
                "plant_id": row.plant_id,
                "document_no": row.document_no,
                "effective_date": row.effective_date.isoformat(),
                "status": row.status,
                "notes": row.notes,
                "created_by": row.created_by,
                "created_at": row.created_at.isoformat() if row.created_at else None,
                "line_count": len(row.lines or []),
                "total_qty": round(sum(float(line.qty or 0.0) for line in row.lines or []), 3),
            }
            for row in rows
        ]
    }


@router.post("/opening-loads")
def create_opening_load(
    payload: OpeningLoadPayload,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin", "Store"])),
):
    document_no = payload.document_no or f"OPEN-{payload.effective_date.strftime('%Y%m%d')}-{uuid.uuid4().hex[:5].upper()}"
    existing = db.query(InventoryOpeningLoad).filter(
        InventoryOpeningLoad.plant_id == plant_id,
        InventoryOpeningLoad.document_no == document_no,
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="Opening load document already exists")

    header = InventoryOpeningLoad(
        plant_id=plant_id,
        document_no=document_no,
        effective_date=payload.effective_date,
        notes=payload.notes,
        created_by=_actor(current_user),
    )
    db.add(header)
    db.flush()

    plant_uuid = _to_uuid(plant_id)
    response_lines: list[dict[str, Any]] = []
    for index, line in enumerate(payload.lines, start=1):
        item = db.query(ItemMaster).filter(ItemMaster.id == line.item_id, ItemMaster.plant_id == plant_id).first()
        if not item:
            raise HTTPException(status_code=404, detail=f"Item not found for opening line {index}")

        location = None
        if line.location_id:
            location = db.query(InventoryLocation).filter(
                InventoryLocation.id == line.location_id,
                InventoryLocation.plant_id == plant_id,
            ).first()
            if not location:
                raise HTTPException(status_code=404, detail=f"Location not found for opening line {index}")

        unit_cost = float(line.unit_cost if line.unit_cost is not None else getattr(item, "unit_cost", 0.0) or 0.0)
        stock_status = _validate_status(line.stock_status)
        if item.tracking_mode == TrackingMode.REEL:
            if item.type != ItemType.RAW_PAPER:
                raise HTTPException(status_code=400, detail="Only raw paper can be reel-tracked")
            reel_code = (line.reel_code or f"{document_no}-R{index:03d}").strip().upper()
            duplicate_reel = db.query(PaperReel).filter(
                PaperReel.plant_id == plant_uuid,
                PaperReel.reel_code == reel_code,
            ).first()
            if duplicate_reel:
                raise HTTPException(status_code=400, detail=f"Reel code already exists: {reel_code}")
            reel = PaperReel(
                plant_id=plant_uuid,
                reel_code=reel_code,
                paper_id=item.id,
                supplier_name="OPENING STOCK",
                supplier_name_snapshot="OPENING STOCK",
                inward_weight_kg=line.qty,
                current_weight_kg=line.qty,
                unit_cost=unit_cost if unit_cost > 0 else None,
                cost_source=CostSource(_normalize_cost_source(line.cost_source) or _item_cost_source(item) or CostSource.MANUAL.value),
                status=ReelStatus.IN_STOCK,
                stock_status=stock_status,
                location_id=line.location_id,
                genealogy_metadata={
                    "source_document_type": "OPENING_LOAD",
                    "opening_load_id": str(header.id),
                    "document_no": document_no,
                    "line_no": index,
                },
                inward_date=payload.effective_date,
            )
            db.add(reel)
            db.flush()
            db.add(
                ReelScanEvent(
                    plant_id=plant_uuid,
                    reel_id=reel.id,
                    event_type=ReelScanEventType.INWARD_SCAN,
                    source=ReelScanSource.INVENTORY,
                    operator_id=None,
                    event_metadata={
                        "source_document_type": "OPENING_LOAD",
                        "document_no": document_no,
                        "line_no": index,
                    },
                )
            )
            line_row = InventoryOpeningLoadLine(
                opening_load_id=header.id,
                item_id=item.id,
                reel_id=reel.id,
                reel_code=reel_code,
                qty=line.qty,
                location_id=line.location_id,
                stock_status=stock_status,
                unit_cost=unit_cost if unit_cost > 0 else None,
                notes=line.notes,
            )
            response_lines.append({"item_code": item.item_code, "reel_code": reel_code, "qty": line.qty})
        else:
            batch_no = (line.batch_no or f"{document_no}-B{index:03d}").strip().upper()
            batch = StockBatch(
                item_id=item.id,
                batch_no=batch_no,
                received_qty=line.qty,
                unit_cost=unit_cost if unit_cost > 0 else None,
                cost_source=_normalize_cost_source(line.cost_source) or "MANUAL",
                supplier_name_snapshot="OPENING STOCK",
                location=location.code if location else None,
                location_id=line.location_id,
                stock_status=stock_status,
                plant_id=plant_id,
            )
            db.add(batch)
            db.flush()
            txn = StockTransaction(
                item_id=item.id,
                batch_id=batch.id,
                transaction_type=TransactionType.OPENING,
                qty_change=line.qty,
                reference_type=ReferenceType.INTERNAL,
                reference_id=header.id,
                plant_id=plant_id,
                location_id=line.location_id,
                stock_status=stock_status,
                movement_metadata={
                    "source_document_type": "OPENING_LOAD",
                    "document_no": document_no,
                    "line_no": index,
                    "notes": line.notes,
                },
                external_ref=f"OPENING:{document_no}:{index}",
            )
            db.add(txn)
            line_row = InventoryOpeningLoadLine(
                opening_load_id=header.id,
                item_id=item.id,
                batch_id=batch.id,
                batch_no=batch_no,
                qty=line.qty,
                location_id=line.location_id,
                stock_status=stock_status,
                unit_cost=unit_cost if unit_cost > 0 else None,
                notes=line.notes,
            )
            response_lines.append({"item_code": item.item_code, "batch_no": batch_no, "qty": line.qty})
        db.add(line_row)

    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail="Opening load could not be posted; check duplicate refs") from exc
    db.refresh(header)
    return {
        "id": str(header.id),
        "document_no": header.document_no,
        "effective_date": header.effective_date.isoformat(),
        "status": header.status,
        "line_count": len(header.lines or []),
        "lines": response_lines,
    }


@router.get("/certifications")
def list_certifications(
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
    current_user: dict = Depends(get_current_user),
):
    query = _apply_cert_scope(db.query(InventoryCertification), plant_scope)
    rows = query.order_by(InventoryCertification.period_end.desc(), InventoryCertification.created_at.desc()).limit(50).all()
    return {"items": [_serialize_certification(row, include_lines=False) for row in rows]}


@router.post("/certifications")
def create_certification(
    payload: CertificationCreatePayload,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin", "Store"])),
):
    if payload.period_start > payload.period_end:
        raise HTTPException(status_code=400, detail="period_start cannot be after period_end")

    existing = db.query(InventoryCertification).filter(
        InventoryCertification.plant_id == plant_id,
        InventoryCertification.period_start == payload.period_start,
        InventoryCertification.period_end == payload.period_end,
    ).first()
    if existing and existing.status != "DRAFT":
        raise HTTPException(status_code=400, detail="Certified periods cannot be regenerated")

    header = existing or InventoryCertification(
        plant_id=plant_id,
        period_start=payload.period_start,
        period_end=payload.period_end,
        created_by=_actor(current_user),
    )
    header.fiscal_year_label = payload.fiscal_year_label or _fiscal_year_label(payload.period_end)
    header.notes = payload.notes
    header.status = "DRAFT"
    if not existing:
        db.add(header)
        db.flush()
    else:
        for old_line in list(header.lines or []):
            db.delete(old_line)
        db.flush()

    statement = compute_stock_statement(
        db=db,
        plant_scope={"scope_all": False, "selected_plant_id": plant_id},
        start_date=payload.period_start,
        end_date=payload.period_end,
    )
    for row in statement["rows"]:
        db.add(_line_from_statement(header.id, row))
    db.commit()
    db.refresh(header)
    return _serialize_certification(header, include_lines=True)


@router.get("/certifications/{certification_id}")
def get_certification(
    certification_id: uuid.UUID,
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
    current_user: dict = Depends(get_current_user),
):
    query = _apply_cert_scope(db.query(InventoryCertification).filter(InventoryCertification.id == certification_id), plant_scope)
    header = query.first()
    if not header:
        raise HTTPException(status_code=404, detail="Certification not found")
    return _serialize_certification(header, include_lines=True)


@router.patch("/certifications/{certification_id}")
def update_certification(
    certification_id: uuid.UUID,
    payload: CertificationUpdatePayload,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin", "Store"])),
):
    header = db.query(InventoryCertification).filter(
        InventoryCertification.id == certification_id,
        InventoryCertification.plant_id == plant_id,
    ).first()
    if not header:
        raise HTTPException(status_code=404, detail="Certification not found")
    if header.status != "DRAFT":
        raise HTTPException(status_code=400, detail="Only draft certifications can be edited")
    if payload.notes is not None:
        header.notes = payload.notes

    line_by_id = {str(line.id): line for line in header.lines or []}
    line_by_item = {str(line.item_id): line for line in header.lines or []}
    for patch in payload.lines:
        target = None
        if patch.line_id:
            target = line_by_id.get(str(patch.line_id))
        if target is None and patch.item_id:
            target = line_by_item.get(str(patch.item_id))
        if target is None:
            raise HTTPException(status_code=404, detail="Certification line not found")
        target.physical_qty = patch.physical_qty
        target.variance_qty = float(patch.physical_qty) - float(target.closing_qty or 0.0)
        target.variance_value = round(float(target.variance_qty or 0.0) * float(target.unit_cost or 0.0), 2)
        if patch.notes is not None:
            target.notes = patch.notes

    db.commit()
    db.refresh(header)
    return _serialize_certification(header, include_lines=True)


@router.post("/certifications/{certification_id}/certify")
def certify_stock(
    certification_id: uuid.UUID,
    payload: CertificationActionPayload,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin", "Store"])),
):
    header = db.query(InventoryCertification).filter(
        InventoryCertification.id == certification_id,
        InventoryCertification.plant_id == plant_id,
    ).first()
    if not header:
        raise HTTPException(status_code=404, detail="Certification not found")
    if header.status == "CARRIED_FORWARD":
        raise HTTPException(status_code=400, detail="Certification already carried forward")
    header.status = "CERTIFIED"
    header.certified_by = _actor(current_user)
    header.certified_at = datetime.utcnow()
    if payload.notes is not None:
        header.notes = payload.notes
    db.commit()
    db.refresh(header)
    return _serialize_certification(header, include_lines=True)


@router.get("/carry-forwards")
def list_carry_forwards(
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
    current_user: dict = Depends(get_current_user),
):
    query = db.query(InventoryCarryForward)
    if plant_scope.get("scope_all"):
        allowed = plant_scope.get("allowed_plants") or []
        if allowed:
            query = query.filter(InventoryCarryForward.plant_id.in_(allowed))
    else:
        query = query.filter(InventoryCarryForward.plant_id == plant_scope["selected_plant_id"])
    rows = query.order_by(InventoryCarryForward.opening_date.desc(), InventoryCarryForward.created_at.desc()).limit(50).all()
    return {
        "items": [
            {
                "id": str(row.id),
                "certification_id": str(row.certification_id),
                "plant_id": row.plant_id,
                "opening_date": row.opening_date.isoformat(),
                "fiscal_year_label": row.fiscal_year_label,
                "document_no": row.document_no,
                "status": row.status,
                "notes": row.notes,
                "created_by": row.created_by,
                "created_at": row.created_at.isoformat() if row.created_at else None,
                "line_count": len(row.lines or []),
                "opening_value": round(sum(float(line.opening_value or 0.0) for line in row.lines or []), 2),
            }
            for row in rows
        ]
    }


@router.post("/certifications/{certification_id}/carry-forward")
def create_carry_forward(
    certification_id: uuid.UUID,
    payload: CarryForwardPayload,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin", "Store"])),
):
    header = db.query(InventoryCertification).filter(
        InventoryCertification.id == certification_id,
        InventoryCertification.plant_id == plant_id,
    ).first()
    if not header:
        raise HTTPException(status_code=404, detail="Certification not found")
    if header.status not in {"CERTIFIED", "CARRIED_FORWARD"}:
        raise HTTPException(status_code=400, detail="Only certified stock can be carried forward")

    existing = db.query(InventoryCarryForward).filter(
        InventoryCarryForward.certification_id == header.id,
        InventoryCarryForward.plant_id == plant_id,
    ).first()
    if existing:
        return {
            "id": str(existing.id),
            "document_no": existing.document_no,
            "opening_date": existing.opening_date.isoformat(),
            "status": existing.status,
            "line_count": len(existing.lines or []),
            "message": "Carry-forward already exists for this certification",
        }

    opening_date = payload.opening_date or (header.period_end + timedelta(days=1))
    document_no = payload.document_no or f"CF-{header.period_end.strftime('%Y%m%d')}-{uuid.uuid4().hex[:4].upper()}"
    carry = InventoryCarryForward(
        certification_id=header.id,
        plant_id=plant_id,
        opening_date=opening_date,
        fiscal_year_label=payload.fiscal_year_label or _fiscal_year_label(opening_date),
        document_no=document_no,
        notes=payload.notes,
        created_by=_actor(current_user),
    )
    db.add(carry)
    db.flush()
    for line in header.lines or []:
        opening_qty = float(line.physical_qty if line.physical_qty is not None else line.closing_qty or 0.0)
        db.add(
            InventoryCarryForwardLine(
                carry_forward_id=carry.id,
                item_id=line.item_id,
                item_code=line.item_code,
                item_name=line.item_name,
                item_type=line.item_type,
                tracking_mode=line.tracking_mode,
                uom=line.uom,
                opening_qty=opening_qty,
                unit_cost=float(line.unit_cost or 0.0),
                opening_value=round(opening_qty * float(line.unit_cost or 0.0), 2),
                source_variance_qty=float(line.variance_qty or 0.0),
                notes=line.notes,
            )
        )
    header.status = "CARRIED_FORWARD"
    header.carried_forward_at = datetime.utcnow()
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail="Carry-forward document already exists") from exc
    db.refresh(carry)
    return {
        "id": str(carry.id),
        "document_no": carry.document_no,
        "opening_date": carry.opening_date.isoformat(),
        "status": carry.status,
        "line_count": len(carry.lines or []),
        "opening_value": round(sum(float(line.opening_value or 0.0) for line in carry.lines or []), 2),
    }


# ──────────────────────────────────────────────────────────────────────────
# Gap 5: post-opening from carry-forward — one-click conversion of the CF
# proof document into an actual InventoryOpeningLoad + ledger OPENING txns
# for next-period seeding.
# ──────────────────────────────────────────────────────────────────────────


@router.post("/carry-forwards/{cf_id}/post-opening")
def post_opening_from_carry_forward(
    cf_id: uuid.UUID,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin", "Store", "Owner"])),
):
    cf = db.query(InventoryCarryForward).filter(
        InventoryCarryForward.id == cf_id,
        InventoryCarryForward.plant_id == plant_id,
    ).first()
    if not cf:
        raise HTTPException(status_code=404, detail="Carry-forward not found")

    # Idempotency: if a CF-derived opening load already exists, return it.
    existing = db.query(InventoryOpeningLoad).filter(
        InventoryOpeningLoad.plant_id == plant_id,
        InventoryOpeningLoad.document_no == f"OPEN-FROM-{cf.document_no}",
    ).first()
    if existing:
        return {
            "opening_load_id": str(existing.id),
            "document_no": existing.document_no,
            "carry_forward_id": str(cf.id),
            "status": existing.status,
            "line_count": len(existing.lines or []),
            "message": "Opening load already created from this carry-forward (idempotent)",
            "already_existed": True,
        }

    if not (cf.lines or []):
        raise HTTPException(status_code=400, detail="Carry-forward has no lines to post")

    header = InventoryOpeningLoad(
        plant_id=plant_id,
        document_no=f"OPEN-FROM-{cf.document_no}",
        effective_date=cf.opening_date,
        status="POSTED",
        notes=f"Auto-posted from carry-forward {cf.document_no}",
        created_by=_actor(current_user),
    )
    db.add(header)
    db.flush()

    posted_lines = 0
    for idx, line in enumerate(cf.lines or [], start=1):
        if not line.item_id:
            continue
        opening_qty = float(line.opening_qty or 0.0)
        if opening_qty <= 0:
            continue
        line_row = InventoryOpeningLoadLine(
            opening_load_id=header.id,
            item_id=line.item_id,
            qty=opening_qty,
            unit_cost=float(line.unit_cost or 0.0),
            stock_status="UNRESTRICTED",
            notes=f"From CF {cf.document_no} line {idx}",
        )
        db.add(line_row)
        # Ledger posting
        batch = StockBatch(
            item_id=line.item_id,
            batch_no=f"OPEN-{cf.document_no}-{idx:03d}",
            received_qty=opening_qty,
            unit_cost=float(line.unit_cost or 0.0) if float(line.unit_cost or 0.0) > 0 else None,
            cost_source="AVG_BATCH" if float(line.unit_cost or 0.0) > 0 else None,
            supplier_name_snapshot=f"CARRY FORWARD {cf.document_no}",
            stock_status="UNRESTRICTED",
            plant_id=plant_id,
        )
        db.add(batch)
        db.flush()
        external_ref = f"OPENING:CF:{cf.id}:{idx}"
        db.add(
            StockTransaction(
                item_id=line.item_id,
                batch_id=batch.id,
                transaction_type=TransactionType.OPENING,
                qty_change=opening_qty,
                reference_type=ReferenceType.ADJUSTMENT,
                reference_id=cf.id,
                plant_id=plant_id,
                stock_status="UNRESTRICTED",
                movement_metadata={"carry_forward_id": str(cf.id), "carry_forward_doc": cf.document_no},
                external_ref=external_ref,
            )
        )
        posted_lines += 1

    cf.status = "POSTED"
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail="Failed to post opening load") from exc
    db.refresh(header)
    return {
        "opening_load_id": str(header.id),
        "document_no": header.document_no,
        "carry_forward_id": str(cf.id),
        "status": header.status,
        "line_count": posted_lines,
        "effective_date": header.effective_date.isoformat(),
        "message": f"Posted {posted_lines} opening lines from carry-forward {cf.document_no}",
        "already_existed": False,
    }
