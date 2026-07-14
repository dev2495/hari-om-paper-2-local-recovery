from __future__ import annotations

import logging
from datetime import date, datetime, time, timedelta, timezone
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
    StockAdjustmentLine,
    StockAdjustmentVoucher,
    StockTransaction,
    TrackingMode,
    TransactionType,
)
from ..services.stock_control import compute_stock_statement
from ..utils.audit_client import emit_audit_event
from ..utils.auth import get_current_plant, get_current_plant_scope, get_current_user, require_role

_audit_logger = logging.getLogger(__name__)

router = APIRouter(prefix="/inventory/stock-control", tags=["inventory-stock-control"])

STOCK_STATUSES = {"UNRESTRICTED", "WIP", "QC_HOLD", "BLOCKED", "DISPATCH_STAGING", "SCRAP"}
COUNT_STATES = {"DRAFT", "COUNTED", "RECOUNT_REQUIRED", "REVIEWED", "CERTIFIED"}


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


def _naive_datetime(value: Optional[datetime]) -> Optional[datetime]:
    if value is None:
        return None
    if getattr(value, "tzinfo", None) is not None:
        return value.astimezone(timezone.utc).replace(tzinfo=None)
    return value


def _day_end(value: date) -> datetime:
    return datetime.combine(value, time.max)


def _effective_at_for_date(effective_date: date, provided: Optional[datetime] = None) -> datetime:
    normalized = _naive_datetime(provided)
    return normalized or _day_end(effective_date)


def _stock_as_of_at(period_start: date, period_end: date, provided: Optional[datetime] = None) -> datetime:
    normalized = _effective_at_for_date(period_end, provided)
    if normalized.date() < period_start or normalized.date() > period_end:
        raise HTTPException(status_code=400, detail="stock_as_of_at must be within the certification period")
    return normalized


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


def _validate_count_state(value: Optional[str], fallback: str = "DRAFT") -> str:
    normalized = str(value or fallback).strip().upper() or fallback
    if normalized not in COUNT_STATES:
        raise HTTPException(status_code=400, detail="Invalid count_state")
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
        "batch_id": str(line.batch_id) if line.batch_id else None,
        "reel_id": str(line.reel_id) if line.reel_id else None,
        "stock_status": line.stock_status,
        "location_id": str(line.location_id) if line.location_id else None,
        "bin_code": line.bin_code,
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
        "count_state": line.count_state,
        "counted_by": line.counted_by,
        "checked_by": line.checked_by,
        "counted_at": line.counted_at.isoformat() if line.counted_at else None,
        "checked_at": line.checked_at.isoformat() if line.checked_at else None,
        "recount_required": bool(line.recount_required),
        "recount_qty": round(float(line.recount_qty), 3) if line.recount_qty is not None else None,
        "recount_notes": line.recount_notes,
        "attachment_refs": list(line.attachment_refs or []),
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
        "count_session_no": header.count_session_no,
        "count_location_scope": header.count_location_scope,
        "count_state": header.count_state,
        "notes": header.notes,
        "attachment_refs": list(header.attachment_refs or []),
        "created_by": header.created_by,
        "counted_by": header.counted_by,
        "checked_by": header.checked_by,
        "certified_by": header.certified_by,
        "stock_as_of_at": header.stock_as_of_at.isoformat() if header.stock_as_of_at else None,
        "count_taken_at": header.count_taken_at.isoformat() if header.count_taken_at else None,
        "counted_at": header.counted_at.isoformat() if header.counted_at else None,
        "checked_at": header.checked_at.isoformat() if header.checked_at else None,
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
        stock_status="UNRESTRICTED",
        count_state="DRAFT",
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
    stock_as_of_at: Optional[datetime] = None
    count_taken_at: Optional[datetime] = None
    fiscal_year_label: Optional[str] = Field(default=None, max_length=30)
    count_session_no: Optional[str] = Field(default=None, max_length=80)
    count_location_scope: Optional[str] = Field(default=None, max_length=200)
    counted_by: Optional[str] = Field(default=None, max_length=200)
    checked_by: Optional[str] = Field(default=None, max_length=200)
    notes: Optional[str] = Field(default=None, max_length=500)
    attachment_refs: list[str] = Field(default_factory=list)


class CertificationLineUpdatePayload(BaseModel):
    line_id: Optional[uuid.UUID] = None
    item_id: Optional[uuid.UUID] = None
    physical_qty: float = Field(ge=0)
    stock_status: Optional[str] = None
    location_id: Optional[uuid.UUID] = None
    bin_code: Optional[str] = Field(default=None, max_length=120)
    count_state: Optional[str] = None
    counted_by: Optional[str] = Field(default=None, max_length=200)
    checked_by: Optional[str] = Field(default=None, max_length=200)
    recount_required: Optional[bool] = None
    recount_qty: Optional[float] = Field(default=None, ge=0)
    recount_notes: Optional[str] = Field(default=None, max_length=500)
    attachment_refs: Optional[list[str]] = None
    notes: Optional[str] = Field(default=None, max_length=500)

    @field_validator("stock_status")
    @classmethod
    def validate_stock_status(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return value
        normalized = str(value or "").strip().upper() or "UNRESTRICTED"
        if normalized not in STOCK_STATUSES:
            raise ValueError("Invalid stock_status")
        return normalized

    @field_validator("count_state")
    @classmethod
    def validate_count_state(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return value
        normalized = str(value or "").strip().upper()
        if normalized not in COUNT_STATES:
            raise ValueError("Invalid count_state")
        return normalized


class CertificationUpdatePayload(BaseModel):
    notes: Optional[str] = Field(default=None, max_length=500)
    count_session_no: Optional[str] = Field(default=None, max_length=80)
    count_location_scope: Optional[str] = Field(default=None, max_length=200)
    count_taken_at: Optional[datetime] = None
    count_state: Optional[str] = None
    counted_by: Optional[str] = Field(default=None, max_length=200)
    checked_by: Optional[str] = Field(default=None, max_length=200)
    attachment_refs: Optional[list[str]] = None
    lines: list[CertificationLineUpdatePayload] = Field(default_factory=list)

    @field_validator("count_state")
    @classmethod
    def validate_count_state(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return value
        normalized = str(value or "").strip().upper()
        if normalized not in COUNT_STATES:
            raise ValueError("Invalid count_state")
        return normalized


class CertificationActionPayload(BaseModel):
    notes: Optional[str] = Field(default=None, max_length=500)


class CarryForwardPayload(BaseModel):
    opening_date: Optional[date] = None
    fiscal_year_label: Optional[str] = Field(default=None, max_length=30)
    document_no: Optional[str] = Field(default=None, max_length=80)
    notes: Optional[str] = Field(default=None, max_length=500)


class AdjustmentLinePayload(BaseModel):
    item_id: uuid.UUID
    qty_delta: float
    batch_id: Optional[uuid.UUID] = None
    reel_id: Optional[uuid.UUID] = None
    location_id: Optional[uuid.UUID] = None
    stock_status: str = "UNRESTRICTED"
    unit_cost: Optional[float] = Field(default=None, ge=0)
    reason_code: Optional[str] = Field(default=None, max_length=80)
    notes: Optional[str] = Field(default=None, max_length=500)

    @field_validator("qty_delta")
    @classmethod
    def validate_qty_delta(cls, value: float) -> float:
        if abs(float(value or 0.0)) <= 0.000001:
            raise ValueError("qty_delta cannot be zero")
        return value

    @field_validator("stock_status")
    @classmethod
    def validate_stock_status(cls, value: str) -> str:
        normalized = str(value or "").strip().upper() or "UNRESTRICTED"
        if normalized not in STOCK_STATUSES:
            raise ValueError("Invalid stock_status")
        return normalized


class AdjustmentVoucherPayload(BaseModel):
    voucher_no: Optional[str] = Field(default=None, max_length=80)
    effective_date: date
    effective_at: Optional[datetime] = None
    reason_code: str = Field(min_length=1, max_length=80)
    reason_notes: Optional[str] = Field(default=None, max_length=500)
    source_type: str = Field(default="MANUAL", max_length=60)
    source_id: Optional[uuid.UUID] = None
    attachment_refs: list[str] = Field(default_factory=list)
    post_now: bool = False
    lines: list[AdjustmentLinePayload] = Field(min_length=1)


def _doc_token(value: str, fallback: str = "DOC") -> str:
    token = "".join(ch if ch.isalnum() else "-" for ch in str(value or "").upper()).strip("-")
    while "--" in token:
        token = token.replace("--", "-")
    return (token or fallback)[:48]


def _next_adjustment_no(db: Session, plant_id: str, effective_date: date) -> str:
    prefix = f"ADJ-{effective_date.strftime('%Y%m%d')}"
    for sequence in range(1, 10000):
        candidate = f"{prefix}-{sequence:03d}"
        exists = db.query(StockAdjustmentVoucher.id).filter(
            StockAdjustmentVoucher.plant_id == plant_id,
            StockAdjustmentVoucher.voucher_no == candidate,
        ).first()
        if not exists:
            return candidate
    raise HTTPException(status_code=500, detail="Unable to generate adjustment voucher number")


def _next_count_session_no(db: Session, plant_id: str, period_end: date) -> str:
    prefix = f"CNT-{period_end.strftime('%Y%m%d')}"
    for sequence in range(1, 10000):
        candidate = f"{prefix}-{sequence:03d}"
        exists = db.query(InventoryCertification.id).filter(
            InventoryCertification.plant_id == plant_id,
            InventoryCertification.count_session_no == candidate,
        ).first()
        if not exists:
            return candidate
    raise HTTPException(status_code=500, detail="Unable to generate count session number")


def _line_unit_cost(item: ItemMaster, line: StockAdjustmentLine) -> float:
    if line.unit_cost is not None:
        return float(line.unit_cost or 0.0)
    return float(getattr(item, "unit_cost", 0.0) or 0.0)


def _serialize_adjustment_line(line: StockAdjustmentLine) -> dict[str, Any]:
    return {
        "id": str(line.id),
        "item_id": str(line.item_id),
        "item_code": getattr(line.item, "item_code", None),
        "item_name": getattr(line.item, "name", None),
        "batch_id": str(line.batch_id) if line.batch_id else None,
        "reel_id": str(line.reel_id) if line.reel_id else None,
        "created_batch_id": str(line.created_batch_id) if line.created_batch_id else None,
        "created_reel_id": str(line.created_reel_id) if line.created_reel_id else None,
        "transaction_id": str(line.transaction_id) if line.transaction_id else None,
        "qty_delta": round(float(line.qty_delta or 0.0), 3),
        "unit_cost": round(float(line.unit_cost or 0.0), 4) if line.unit_cost is not None else None,
        "stock_status": line.stock_status,
        "location_id": str(line.location_id) if line.location_id else None,
        "reason_code": line.reason_code,
        "notes": line.notes,
    }


def _serialize_adjustment_voucher(header: StockAdjustmentVoucher, include_lines: bool = False) -> dict[str, Any]:
    lines = list(header.lines or [])
    payload = {
        "id": str(header.id),
        "plant_id": header.plant_id,
        "voucher_no": header.voucher_no,
        "effective_date": header.effective_date.isoformat(),
        "effective_at": header.effective_at.isoformat() if header.effective_at else None,
        "reason_code": header.reason_code,
        "reason_notes": header.reason_notes,
        "source_type": header.source_type,
        "source_id": str(header.source_id) if header.source_id else None,
        "attachment_refs": list(header.attachment_refs or []),
        "status": header.status,
        "created_by": header.created_by,
        "approved_by": header.approved_by,
        "posted_at": header.posted_at.isoformat() if header.posted_at else None,
        "created_at": header.created_at.isoformat() if header.created_at else None,
        "line_count": len(lines),
        "total_abs_qty": round(sum(abs(float(line.qty_delta or 0.0)) for line in lines), 3),
    }
    if include_lines:
        payload["lines"] = [_serialize_adjustment_line(line) for line in lines]
    return payload


def _add_reel_adjustment_event(
    db: Session,
    *,
    plant_uuid: uuid.UUID,
    reel: PaperReel,
    line: StockAdjustmentLine,
    header: StockAdjustmentVoucher,
    qty_delta: float,
    actor: str,
) -> None:
    db.add(
        ReelScanEvent(
            plant_id=plant_uuid,
            reel_id=reel.id,
            event_type=ReelScanEventType.MOVE_SCAN,
            source=ReelScanSource.INVENTORY,
            operator_id=None,
            event_metadata={
                "source_document_type": "STOCK_ADJUSTMENT",
                "adjustment_id": str(header.id),
                "adjustment_line_id": str(line.id),
                "voucher_no": header.voucher_no,
                "reason_code": line.reason_code or header.reason_code,
                "adjustment_qty_delta": round(float(qty_delta), 3),
                "effective_date": header.effective_date.isoformat(),
                "effective_at": header.effective_at.isoformat() if header.effective_at else None,
                "actor": actor,
            },
        )
    )


def _post_reel_adjustment_line(
    db: Session,
    *,
    plant_uuid: uuid.UUID,
    item: ItemMaster,
    header: StockAdjustmentVoucher,
    line: StockAdjustmentLine,
    line_index: int,
    actor: str,
) -> None:
    qty_delta = float(line.qty_delta or 0.0)
    unit_cost = _line_unit_cost(item, line)
    if qty_delta > 0 and line.reel_id:
        raise HTTPException(
            status_code=400,
            detail="Positive reel adjustment creates a new adjustment reel; remove reel_id.",
        )

    if qty_delta > 0:
        doc_token = _doc_token(header.voucher_no, "ADJ")
        reel_code = f"ADJ-{doc_token}-R{line_index:03d}"
        if db.query(PaperReel.id).filter(PaperReel.plant_id == plant_uuid, PaperReel.reel_code == reel_code).first():
            reel_code = f"{reel_code}-{uuid.uuid4().hex[:4].upper()}"[:100]
        reel = PaperReel(
            plant_id=plant_uuid,
            reel_code=reel_code,
            paper_id=item.id,
            supplier_name="STOCK ADJUSTMENT",
            supplier_name_snapshot="STOCK ADJUSTMENT",
            inward_weight_kg=qty_delta,
            current_weight_kg=qty_delta,
            unit_cost=unit_cost if unit_cost > 0 else None,
            cost_source=CostSource.MANUAL if unit_cost > 0 else _item_cost_source(item),
            status=ReelStatus.IN_STOCK,
            stock_status=line.stock_status,
            location_id=line.location_id,
            genealogy_metadata={
                "source_document_type": "STOCK_ADJUSTMENT",
                "adjustment_id": str(header.id),
                "adjustment_line_id": str(line.id),
                "voucher_no": header.voucher_no,
                "reason_code": line.reason_code or header.reason_code,
            },
            inward_date=header.effective_date,
        )
        db.add(reel)
        db.flush()
        line.created_reel_id = reel.id
        _add_reel_adjustment_event(
            db,
            plant_uuid=plant_uuid,
            reel=reel,
            line=line,
            header=header,
            qty_delta=qty_delta,
            actor=actor,
        )
        return

    remaining_to_reduce = abs(qty_delta)
    reels: list[PaperReel]
    if line.reel_id:
        reel = db.query(PaperReel).filter(
            PaperReel.id == line.reel_id,
            PaperReel.plant_id == plant_uuid,
            PaperReel.paper_id == item.id,
        ).first()
        if not reel:
            raise HTTPException(status_code=404, detail="Adjustment reel not found")
        reels = [reel]
    else:
        reels = (
            db.query(PaperReel)
            .filter(
                PaperReel.plant_id == plant_uuid,
                PaperReel.paper_id == item.id,
                PaperReel.current_weight_kg > 0,
            )
            .order_by(PaperReel.inward_date.asc(), PaperReel.created_at.asc())
            .all()
        )

    for reel in reels:
        if remaining_to_reduce <= 0.000001:
            break
        available = float(reel.current_weight_kg or 0.0)
        if available <= 0:
            continue
        consume_qty = min(available, remaining_to_reduce)
        reel.current_weight_kg = round(available - consume_qty, 3)
        if reel.current_weight_kg <= 0.000001:
            reel.current_weight_kg = 0.0
            reel.status = ReelStatus.CONSUMED
        _add_reel_adjustment_event(
            db,
            plant_uuid=plant_uuid,
            reel=reel,
            line=line,
            header=header,
            qty_delta=-consume_qty,
            actor=actor,
        )
        remaining_to_reduce = round(remaining_to_reduce - consume_qty, 3)

    if remaining_to_reduce > 0.000001:
        raise HTTPException(status_code=400, detail=f"Insufficient reel stock for {item.item_code} adjustment")


def _post_bulk_adjustment_line(
    db: Session,
    *,
    plant_id: str,
    item: ItemMaster,
    header: StockAdjustmentVoucher,
    line: StockAdjustmentLine,
    line_index: int,
) -> None:
    qty_delta = float(line.qty_delta or 0.0)
    unit_cost = _line_unit_cost(item, line)
    batch_id = line.batch_id
    if batch_id:
        batch = db.query(StockBatch).filter(
            StockBatch.id == batch_id,
            StockBatch.item_id == item.id,
            StockBatch.plant_id == plant_id,
        ).first()
        if not batch:
            raise HTTPException(status_code=404, detail="Adjustment batch not found")
        if line.unit_cost is None and batch.unit_cost is not None:
            line.unit_cost = float(batch.unit_cost or 0.0)
    elif qty_delta > 0:
        batch_no = f"ADJ-{_doc_token(header.voucher_no, 'ADJ')}-B{line_index:03d}"
        if db.query(StockBatch.id).filter(StockBatch.plant_id == plant_id, StockBatch.batch_no == batch_no).first():
            batch_no = f"{batch_no}-{uuid.uuid4().hex[:4].upper()}"[:100]
        batch = StockBatch(
            item_id=item.id,
            batch_no=batch_no,
            received_qty=qty_delta,
            unit_cost=unit_cost if unit_cost > 0 else None,
            cost_source="MANUAL" if unit_cost > 0 else None,
            supplier_name_snapshot="STOCK ADJUSTMENT",
            location_id=line.location_id,
            stock_status=line.stock_status,
            plant_id=plant_id,
        )
        db.add(batch)
        db.flush()
        line.created_batch_id = batch.id
        batch_id = batch.id

    txn = StockTransaction(
        item_id=item.id,
        batch_id=batch_id,
        transaction_type=TransactionType.ADJUSTMENT,
        qty_change=qty_delta,
        reference_type=ReferenceType.ADJUSTMENT,
        reference_id=header.id,
        plant_id=plant_id,
        location_id=line.location_id,
        stock_status=line.stock_status,
        movement_metadata={
            "source_document_type": "STOCK_ADJUSTMENT",
            "adjustment_id": str(header.id),
            "adjustment_line_id": str(line.id),
            "voucher_no": header.voucher_no,
            "reason_code": line.reason_code or header.reason_code,
            "notes": line.notes,
        },
        external_ref=f"ADJ:{header.id}:{line.id}",
        effective_date=header.effective_date,
        effective_at=header.effective_at,
    )
    db.add(txn)
    db.flush()
    line.transaction_id = txn.id


def _post_adjustment_voucher(
    db: Session,
    *,
    header: StockAdjustmentVoucher,
    plant_id: str,
    actor: str,
) -> None:
    if header.status == "POSTED":
        return
    if header.status != "DRAFT":
        raise HTTPException(status_code=400, detail="Only draft adjustment vouchers can be posted")
    if not (header.lines or []):
        raise HTTPException(status_code=400, detail="Adjustment voucher has no lines")

    plant_uuid = _to_uuid(plant_id)
    for index, line in enumerate(header.lines or [], start=1):
        item = db.query(ItemMaster).filter(ItemMaster.id == line.item_id, ItemMaster.plant_id == plant_id).first()
        if not item:
            raise HTTPException(status_code=404, detail=f"Adjustment item not found on line {index}")
        if abs(float(line.qty_delta or 0.0)) <= 0.000001:
            raise HTTPException(status_code=400, detail=f"Adjustment qty cannot be zero on line {index}")
        line.stock_status = _validate_status(line.stock_status)
        if line.location_id:
            location = db.query(InventoryLocation).filter(
                InventoryLocation.id == line.location_id,
                InventoryLocation.plant_id == plant_id,
            ).first()
            if not location:
                raise HTTPException(status_code=404, detail=f"Adjustment location not found on line {index}")
        if item.tracking_mode == TrackingMode.REEL:
            _post_reel_adjustment_line(
                db,
                plant_uuid=plant_uuid,
                item=item,
                header=header,
                line=line,
                line_index=index,
                actor=actor,
            )
        else:
            _post_bulk_adjustment_line(
                db,
                plant_id=plant_id,
                item=item,
                header=header,
                line=line,
                line_index=index,
            )

    header.status = "POSTED"
    header.approved_by = actor
    header.posted_at = datetime.utcnow()


@router.get("/statement")
def stock_statement(
    start_date: date = Query(...),
    end_date: date = Query(...),
    stock_as_of_at: Optional[datetime] = Query(default=None),
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
    current_user: dict = Depends(get_current_user),
):
    if start_date > end_date:
        raise HTTPException(status_code=400, detail="start_date cannot be after end_date")
    statement_as_of = _stock_as_of_at(start_date, end_date, stock_as_of_at)
    return compute_stock_statement(
        db=db,
        plant_scope=plant_scope,
        start_date=start_date,
        end_date=end_date,
        as_of_at=statement_as_of,
    )


@router.get("/adjustment-vouchers")
def list_adjustment_vouchers(
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
    current_user: dict = Depends(get_current_user),
):
    query = db.query(StockAdjustmentVoucher)
    if plant_scope.get("scope_all"):
        allowed = plant_scope.get("allowed_plants") or []
        if allowed:
            query = query.filter(StockAdjustmentVoucher.plant_id.in_(allowed))
    else:
        query = query.filter(StockAdjustmentVoucher.plant_id == plant_scope["selected_plant_id"])
    rows = query.order_by(
        StockAdjustmentVoucher.effective_at.desc().nullslast(),
        StockAdjustmentVoucher.effective_date.desc(),
        StockAdjustmentVoucher.created_at.desc(),
    ).limit(100).all()
    return {"items": [_serialize_adjustment_voucher(row, include_lines=False) for row in rows]}


@router.post("/adjustment-vouchers")
def create_adjustment_voucher(
    payload: AdjustmentVoucherPayload,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Owner", "Admin", "Store"])),
):
    effective_at = _effective_at_for_date(payload.effective_date, payload.effective_at)
    voucher_no = (payload.voucher_no or "").strip().upper() or _next_adjustment_no(db, plant_id, payload.effective_date)
    existing = db.query(StockAdjustmentVoucher).filter(
        StockAdjustmentVoucher.plant_id == plant_id,
        StockAdjustmentVoucher.voucher_no == voucher_no,
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="Adjustment voucher already exists")
    header = StockAdjustmentVoucher(
        plant_id=plant_id,
        voucher_no=voucher_no,
        effective_date=payload.effective_date,
        effective_at=effective_at,
        reason_code=payload.reason_code.strip().upper(),
        reason_notes=payload.reason_notes,
        source_type=payload.source_type.strip().upper() or "MANUAL",
        source_id=payload.source_id,
        attachment_refs=list(payload.attachment_refs or []),
        created_by=_actor(current_user),
    )
    db.add(header)
    db.flush()
    for line_payload in payload.lines:
        db.add(
            StockAdjustmentLine(
                adjustment_id=header.id,
                item_id=line_payload.item_id,
                batch_id=line_payload.batch_id,
                reel_id=line_payload.reel_id,
                qty_delta=float(line_payload.qty_delta),
                unit_cost=line_payload.unit_cost,
                location_id=line_payload.location_id,
                stock_status=_validate_status(line_payload.stock_status),
                reason_code=(line_payload.reason_code or payload.reason_code).strip().upper(),
                notes=line_payload.notes,
            )
        )
    db.flush()
    if payload.post_now:
        _post_adjustment_voucher(db, header=header, plant_id=plant_id, actor=_actor(current_user))
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail="Adjustment voucher could not be saved") from exc
    db.refresh(header)
    try:
        emit_audit_event(
            token=current_user.get("token", ""),
            event_type="stock_adjustment_posted" if header.status == "POSTED" else "stock_adjustment_created",
            entity_type="stock_adjustment_voucher",
            entity_id=str(header.id),
            plant_id=str(plant_id),
            actor_role=str((current_user.get("roles") or ["?"])[0]),
            actor_email=current_user.get("sub"),
            summary=f"Stock adjustment {header.voucher_no} {header.status.lower()} with {len(header.lines or [])} line(s)",
            payload=_serialize_adjustment_voucher(header, include_lines=True),
        )
    except Exception as exc:
        _audit_logger.warning("audit emit failed for stock_adjustment %s: %s", header.id, exc)
    return _serialize_adjustment_voucher(header, include_lines=True)


@router.post("/adjustment-vouchers/{voucher_id}/post")
def post_adjustment_voucher(
    voucher_id: uuid.UUID,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Owner", "Admin", "Store"])),
):
    header = db.query(StockAdjustmentVoucher).filter(
        StockAdjustmentVoucher.id == voucher_id,
        StockAdjustmentVoucher.plant_id == plant_id,
    ).first()
    if not header:
        raise HTTPException(status_code=404, detail="Adjustment voucher not found")
    _post_adjustment_voucher(db, header=header, plant_id=plant_id, actor=_actor(current_user))
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail="Adjustment voucher could not be posted") from exc
    db.refresh(header)
    try:
        emit_audit_event(
            token=current_user.get("token", ""),
            event_type="stock_adjustment_posted",
            entity_type="stock_adjustment_voucher",
            entity_id=str(header.id),
            plant_id=str(plant_id),
            actor_role=str((current_user.get("roles") or ["?"])[0]),
            actor_email=current_user.get("sub"),
            summary=f"Stock adjustment {header.voucher_no} posted",
            payload=_serialize_adjustment_voucher(header, include_lines=True),
        )
    except Exception as exc:
        _audit_logger.warning("audit emit failed for stock_adjustment_posted %s: %s", header.id, exc)
    return _serialize_adjustment_voucher(header, include_lines=True)


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
    current_user: dict = Depends(require_role(["Owner", "Admin", "Store"])),
):
    document_no = payload.document_no or f"OPEN-{payload.effective_date.strftime('%Y%m%d')}-{uuid.uuid4().hex[:5].upper()}"
    existing = db.query(InventoryOpeningLoad).filter(
        InventoryOpeningLoad.plant_id == plant_id,
        InventoryOpeningLoad.document_no == document_no,
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="Opening load document already exists")
    initialized = db.query(InventoryOpeningLoad.id).filter(
        InventoryOpeningLoad.plant_id == plant_id,
    ).first()
    if initialized:
        raise HTTPException(
            status_code=400,
            detail="Opening stock is already initialized for this plant; use stock count carry-forward or adjustment voucher.",
        )

    effective_at = _day_end(payload.effective_date)
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
                        "effective_date": payload.effective_date.isoformat(),
                        "effective_at": effective_at.isoformat(),
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
                effective_date=payload.effective_date,
                effective_at=effective_at,
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
    try:
        emit_audit_event(
            token=current_user.get("token", ""),
            event_type="stock_control_adjusted",
            entity_type="inventory_opening_load",
            entity_id=str(header.id),
            plant_id=str(plant_id),
            actor_role=str((current_user.get("roles") or ["?"])[0]),
            actor_email=current_user.get("sub"),
            summary=f"Opening load {header.document_no} posted with {len(header.lines or [])} line(s)",
            payload={
                "document_no": header.document_no,
                "effective_date": header.effective_date.isoformat(),
                "status": header.status,
                "line_count": len(header.lines or []),
            },
        )
    except Exception as exc:
        _audit_logger.warning("audit emit failed for stock_control_adjusted (opening_load) %s: %s", header.id, exc)
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
    rows = query.order_by(
        InventoryCertification.stock_as_of_at.desc().nullslast(),
        InventoryCertification.period_end.desc(),
        InventoryCertification.created_at.desc(),
    ).limit(50).all()
    return {"items": [_serialize_certification(row, include_lines=False) for row in rows]}


@router.post("/certifications")
def create_certification(
    payload: CertificationCreatePayload,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Owner", "Admin", "Store"])),
):
    if payload.period_start > payload.period_end:
        raise HTTPException(status_code=400, detail="period_start cannot be after period_end")
    stock_as_of_at = _stock_as_of_at(payload.period_start, payload.period_end, payload.stock_as_of_at)
    count_taken_at = _naive_datetime(payload.count_taken_at) or stock_as_of_at

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
    header.count_session_no = (
        (payload.count_session_no or "").strip().upper()
        or header.count_session_no
        or _next_count_session_no(db, plant_id, payload.period_end)
    )
    header.count_location_scope = payload.count_location_scope or header.count_location_scope or "ALL_LOCATIONS"
    header.count_state = "DRAFT"
    header.stock_as_of_at = stock_as_of_at
    header.count_taken_at = count_taken_at
    header.counted_by = payload.counted_by or header.counted_by
    header.checked_by = payload.checked_by or header.checked_by
    header.attachment_refs = list(payload.attachment_refs or [])
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
        as_of_at=stock_as_of_at,
    )
    for row in statement["rows"]:
        db.add(_line_from_statement(header.id, row))
    db.commit()
    db.refresh(header)
    try:
        emit_audit_event(
            token=current_user.get("token", ""),
            event_type="stock_certification_created",
            entity_type="inventory_certification",
            entity_id=str(header.id),
            plant_id=str(plant_id),
            actor_role=str((current_user.get("roles") or ["?"])[0]),
            actor_email=current_user.get("sub"),
            summary=f"Stock certification draft created for {payload.period_start} → {payload.period_end}",
            payload={
                "period_start": payload.period_start.isoformat(),
                "period_end": payload.period_end.isoformat(),
                "stock_as_of_at": stock_as_of_at.isoformat(),
                "count_taken_at": count_taken_at.isoformat(),
                "fiscal_year_label": header.fiscal_year_label,
                "count_session_no": header.count_session_no,
                "count_location_scope": header.count_location_scope,
                "count_state": header.count_state,
                "status": header.status,
                "line_count": len(header.lines or []),
            },
        )
    except Exception as exc:
        _audit_logger.warning("audit emit failed for stock_certification_created %s: %s", header.id, exc)
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
    current_user: dict = Depends(require_role(["Owner", "Admin", "Store"])),
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
    if payload.count_session_no is not None:
        header.count_session_no = payload.count_session_no.strip().upper() or header.count_session_no
    if payload.count_location_scope is not None:
        header.count_location_scope = payload.count_location_scope
    if payload.count_taken_at is not None:
        header.count_taken_at = _naive_datetime(payload.count_taken_at)
    if payload.count_state is not None:
        header.count_state = _validate_count_state(payload.count_state)
    if payload.counted_by is not None:
        header.counted_by = payload.counted_by
    if payload.checked_by is not None:
        header.checked_by = payload.checked_by
    if payload.attachment_refs is not None:
        header.attachment_refs = list(payload.attachment_refs or [])

    line_by_id = {str(line.id): line for line in header.lines or []}
    line_by_item = {str(line.item_id): line for line in header.lines or []}
    actor = _actor(current_user)
    count_taken_at = header.count_taken_at or datetime.utcnow()
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
        if patch.stock_status is not None:
            target.stock_status = _validate_status(patch.stock_status)
        if patch.location_id is not None:
            target.location_id = patch.location_id
        if patch.bin_code is not None:
            target.bin_code = patch.bin_code
        if patch.count_state is not None:
            target.count_state = _validate_count_state(patch.count_state)
        elif target.count_state == "DRAFT":
            target.count_state = "COUNTED"
        if patch.counted_by is not None:
            target.counted_by = patch.counted_by
        elif not target.counted_by:
            target.counted_by = actor
        if patch.checked_by is not None:
            target.checked_by = patch.checked_by
            target.checked_at = target.checked_at or datetime.utcnow()
            if target.count_state == "COUNTED":
                target.count_state = "REVIEWED"
        if patch.recount_required is not None:
            target.recount_required = bool(patch.recount_required)
            if target.recount_required:
                target.count_state = "RECOUNT_REQUIRED"
            elif target.count_state == "RECOUNT_REQUIRED":
                target.count_state = "REVIEWED"
        if patch.recount_qty is not None:
            target.recount_qty = patch.recount_qty
            target.physical_qty = patch.recount_qty
            target.variance_qty = float(patch.recount_qty) - float(target.closing_qty or 0.0)
            target.variance_value = round(float(target.variance_qty or 0.0) * float(target.unit_cost or 0.0), 2)
            target.recount_required = False
            target.count_state = "REVIEWED"
        if patch.recount_notes is not None:
            target.recount_notes = patch.recount_notes
        if patch.attachment_refs is not None:
            target.attachment_refs = list(patch.attachment_refs or [])
        target.counted_at = count_taken_at
        if patch.notes is not None:
            target.notes = patch.notes

    lines = list(header.lines or [])
    if any(bool(line.recount_required) or line.count_state == "RECOUNT_REQUIRED" for line in lines):
        header.count_state = "RECOUNT_REQUIRED"
    elif payload.lines:
        header.count_state = payload.count_state or "COUNTED"
        header.counted_by = header.counted_by or actor
        header.count_taken_at = header.count_taken_at or count_taken_at
        header.counted_at = count_taken_at

    db.commit()
    db.refresh(header)
    try:
        emit_audit_event(
            token=current_user.get("token", ""),
            event_type="stock_certification_updated",
            entity_type="inventory_certification",
            entity_id=str(header.id),
            plant_id=str(plant_id),
            actor_role=str((current_user.get("roles") or ["?"])[0]),
            actor_email=current_user.get("sub"),
            summary=f"Stock certification draft updated ({len(payload.lines)} line patch(es))",
            payload={
                "period_start": header.period_start.isoformat(),
                "period_end": header.period_end.isoformat(),
                "stock_as_of_at": header.stock_as_of_at.isoformat() if header.stock_as_of_at else None,
                "count_taken_at": header.count_taken_at.isoformat() if header.count_taken_at else None,
                "line_patches": len(payload.lines),
                "notes_changed": payload.notes is not None,
                "count_state": header.count_state,
            },
        )
    except Exception as exc:
        _audit_logger.warning("audit emit failed for stock_certification_updated %s: %s", header.id, exc)
    return _serialize_certification(header, include_lines=True)


@router.post("/certifications/{certification_id}/certify")
def certify_stock(
    certification_id: uuid.UUID,
    payload: CertificationActionPayload,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Owner", "Admin", "Store"])),
):
    header = db.query(InventoryCertification).filter(
        InventoryCertification.id == certification_id,
        InventoryCertification.plant_id == plant_id,
    ).first()
    if not header:
        raise HTTPException(status_code=404, detail="Certification not found")
    if header.status == "CARRIED_FORWARD":
        raise HTTPException(status_code=400, detail="Certification already carried forward")
    recount_lines = [
        line for line in header.lines or []
        if bool(line.recount_required) or line.count_state == "RECOUNT_REQUIRED"
    ]
    if recount_lines:
        raise HTTPException(status_code=400, detail="Review or clear recount-required lines before certification")
    header.status = "CERTIFIED"
    header.count_state = "CERTIFIED"
    header.certified_by = _actor(current_user)
    header.checked_by = header.checked_by or _actor(current_user)
    header.count_taken_at = header.count_taken_at or header.counted_at or datetime.utcnow()
    header.counted_at = header.counted_at or header.count_taken_at
    header.checked_at = header.checked_at or datetime.utcnow()
    header.certified_at = datetime.utcnow()
    if payload.notes is not None:
        header.notes = payload.notes
    db.commit()
    db.refresh(header)
    try:
        emit_audit_event(
            token=current_user.get("token", ""),
            event_type="stock_certified",
            entity_type="inventory_certification",
            entity_id=str(header.id),
            plant_id=str(plant_id),
            actor_role=str((current_user.get("roles") or ["?"])[0]),
            actor_email=current_user.get("sub"),
            summary=f"Stock certified for {header.period_start} → {header.period_end}",
            payload={
                "period_start": header.period_start.isoformat(),
                "period_end": header.period_end.isoformat(),
                "stock_as_of_at": header.stock_as_of_at.isoformat() if header.stock_as_of_at else None,
                "count_taken_at": header.count_taken_at.isoformat() if header.count_taken_at else None,
                "fiscal_year_label": header.fiscal_year_label,
                "certified_by": _actor(current_user),
                "count_session_no": header.count_session_no,
                "count_state": header.count_state,
                "line_count": len(header.lines or []),
            },
        )
    except Exception as exc:
        _audit_logger.warning("audit emit failed for stock_certified %s: %s", header.id, exc)
    return _serialize_certification(header, include_lines=True)


@router.post("/certifications/{certification_id}/post-variance")
def post_certification_variance(
    certification_id: uuid.UUID,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Owner", "Admin", "Store"])),
):
    certification = db.query(InventoryCertification).filter(
        InventoryCertification.id == certification_id,
        InventoryCertification.plant_id == plant_id,
    ).first()
    if not certification:
        raise HTTPException(status_code=404, detail="Certification not found")
    if certification.status not in {"CERTIFIED", "CARRIED_FORWARD"}:
        raise HTTPException(status_code=400, detail="Only certified stock counts can post variance")

    existing = db.query(StockAdjustmentVoucher).filter(
        StockAdjustmentVoucher.plant_id == plant_id,
        StockAdjustmentVoucher.source_type == "CERTIFICATION_VARIANCE",
        StockAdjustmentVoucher.source_id == certification.id,
    ).first()
    if existing:
        if existing.status == "DRAFT":
            _post_adjustment_voucher(db, header=existing, plant_id=plant_id, actor=_actor(current_user))
            db.commit()
            db.refresh(existing)
        return _serialize_adjustment_voucher(existing, include_lines=True)

    variance_lines = [
        line for line in certification.lines or []
        if abs(float(line.variance_qty or 0.0)) > 0.000001
    ]
    if not variance_lines:
        return {
            "posted": False,
            "message": "No variance to post for this certification",
            "certification_id": str(certification.id),
        }

    effective_at = certification.stock_as_of_at or _day_end(certification.period_end)
    voucher_no = f"VAR-{certification.period_end.strftime('%Y%m%d')}-{uuid.uuid4().hex[:4].upper()}"
    header = StockAdjustmentVoucher(
        plant_id=plant_id,
        voucher_no=voucher_no,
        effective_date=effective_at.date(),
        effective_at=effective_at,
        reason_code="PHYSICAL_COUNT_VARIANCE",
        reason_notes=f"Posted from stock certification {certification.period_start} to {certification.period_end}",
        source_type="CERTIFICATION_VARIANCE",
        source_id=certification.id,
        attachment_refs=list(certification.attachment_refs or []),
        created_by=_actor(current_user),
    )
    db.add(header)
    db.flush()
    for cert_line in variance_lines:
        db.add(
            StockAdjustmentLine(
                adjustment_id=header.id,
                item_id=cert_line.item_id,
                qty_delta=float(cert_line.variance_qty or 0.0),
                unit_cost=float(cert_line.unit_cost or 0.0),
                stock_status="UNRESTRICTED",
                reason_code="PHYSICAL_COUNT_VARIANCE",
                notes=f"Book {round(float(cert_line.closing_qty or 0.0), 3)} vs physical {round(float(cert_line.physical_qty or 0.0), 3)}",
            )
        )
    db.flush()
    _post_adjustment_voucher(db, header=header, plant_id=plant_id, actor=_actor(current_user))
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail="Certification variance could not be posted") from exc
    db.refresh(header)
    try:
        emit_audit_event(
            token=current_user.get("token", ""),
            event_type="stock_certification_variance_posted",
            entity_type="stock_adjustment_voucher",
            entity_id=str(header.id),
            plant_id=str(plant_id),
            actor_role=str((current_user.get("roles") or ["?"])[0]),
            actor_email=current_user.get("sub"),
            summary=f"Stock count variance posted for {certification.period_end}",
            payload={
                "certification_id": str(certification.id),
                "stock_as_of_at": effective_at.isoformat(),
                "count_taken_at": certification.count_taken_at.isoformat() if certification.count_taken_at else None,
                "voucher": _serialize_adjustment_voucher(header, include_lines=True),
            },
        )
    except Exception as exc:
        _audit_logger.warning("audit emit failed for stock_certification_variance_posted %s: %s", header.id, exc)
    return _serialize_adjustment_voucher(header, include_lines=True)


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
    current_user: dict = Depends(require_role(["Owner", "Admin", "Store"])),
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

    has_variance = any(
        abs(float(line.variance_qty or 0.0)) > 0.000001
        for line in (header.lines or [])
    )
    if has_variance:
        posted_variance = db.query(StockAdjustmentVoucher.id).filter(
            StockAdjustmentVoucher.plant_id == plant_id,
            StockAdjustmentVoucher.source_type == "CERTIFICATION_VARIANCE",
            StockAdjustmentVoucher.source_id == header.id,
            StockAdjustmentVoucher.status == "POSTED",
        ).first()
        if not posted_variance:
            raise HTTPException(
                status_code=409,
                detail="Post the certified physical-count variance before carrying stock forward",
            )

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
    try:
        emit_audit_event(
            token=current_user.get("token", ""),
            event_type="stock_carry_forward_created",
            entity_type="inventory_carry_forward",
            entity_id=str(carry.id),
            plant_id=str(plant_id),
            actor_role=str((current_user.get("roles") or ["?"])[0]),
            actor_email=current_user.get("sub"),
            summary=f"Carry-forward {carry.document_no} created from certification {header.id}",
            payload={
                "document_no": carry.document_no,
                "opening_date": carry.opening_date.isoformat(),
                "fiscal_year_label": carry.fiscal_year_label,
                "certification_id": str(header.id),
                "line_count": len(carry.lines or []),
            },
        )
    except Exception as exc:
        _audit_logger.warning("audit emit failed for stock_carry_forward_created %s: %s", carry.id, exc)
    return {
        "id": str(carry.id),
        "document_no": carry.document_no,
        "opening_date": carry.opening_date.isoformat(),
        "status": carry.status,
        "line_count": len(carry.lines or []),
        "opening_value": round(sum(float(line.opening_value or 0.0) for line in carry.lines or []), 2),
    }


# ──────────────────────────────────────────────────────────────────────────
# Activate a carry-forward proof for the next period. The stock ledger is
# continuous: prior-period closing already becomes next-period opening in the
# statement calculation. This action deliberately creates no stock movement.
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
        notes=f"Opening proof activated from carry-forward {cf.document_no}; no duplicate ledger movement",
        created_by=_actor(current_user),
    )
    db.add(header)
    db.flush()

    posted_lines = 0
    for idx, line in enumerate(cf.lines or [], start=1):
        if not line.item_id:
            continue
        opening_qty = float(line.opening_qty or 0.0)
        item = db.query(ItemMaster).filter(ItemMaster.id == line.item_id, ItemMaster.plant_id == plant_id).first()
        if not item:
            raise HTTPException(status_code=404, detail=f"Carry-forward item not found on line {idx}")
        db.add(
            InventoryOpeningLoadLine(
                opening_load_id=header.id,
                item_id=line.item_id,
                qty=opening_qty,
                unit_cost=float(line.unit_cost or 0.0),
                stock_status="UNRESTRICTED",
                notes=f"Opening proof from CF {cf.document_no} line {idx}; ledger remains continuous",
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
    try:
        emit_audit_event(
            token=current_user.get("token", ""),
            event_type="stock_control_adjusted",
            entity_type="inventory_opening_load",
            entity_id=str(header.id),
            plant_id=str(plant_id),
            actor_role=str((current_user.get("roles") or ["?"])[0]),
            actor_email=current_user.get("sub"),
            summary=f"Opening load {header.document_no} posted from carry-forward {cf.document_no} ({posted_lines} line(s))",
            payload={
                "document_no": header.document_no,
                "effective_date": header.effective_date.isoformat(),
                "carry_forward_id": str(cf.id),
                "carry_forward_doc_no": cf.document_no,
                "line_count": posted_lines,
                "status": header.status,
            },
        )
    except Exception as exc:
        _audit_logger.warning("audit emit failed for stock_control_adjusted (cf-post) %s: %s", header.id, exc)
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
