from __future__ import annotations

import logging
from datetime import date, datetime, time, timedelta, timezone
from typing import Any, Optional
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import text
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
    StockCountLocation,
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
from ..services.books import (
    assert_books_open, ist_today, is_month_locked, month_key, month_label, month_start, next_month, parse_month,
)
from ..services.stock_control import book_item_sources, book_items, book_period, changes_after_count, compute_stock_statement
from ..services import opening_stock
from ..services.stock_calc import get_batch_balance, get_item_balance
from ..services.stock_lots import QC_WORDS, get_one_plant, entity_qty, in_store, location_brief, lot_code, lot_row, posted_since, resolve_lot
from ..utils.audit_client import emit_audit_event
from ..utils.auth import get_current_plant, get_current_plant_scope, get_current_user, is_actual_owner, require_owner, require_role

_audit_logger = logging.getLogger(__name__)

router = APIRouter(prefix="/inventory/stock-control", tags=["inventory-stock-control"])

STOCK_STATUSES = {"UNRESTRICTED", "WIP", "QC_HOLD", "BLOCKED", "DISPATCH_STAGING", "SCRAP"}
COUNT_STATES = {"DRAFT", "COUNTED", "RECOUNT_REQUIRED", "REVIEWED", "CERTIFIED"}


def _enum(value: Any) -> str:
    return str(getattr(value, "value", value) or "")


# Who may raise a stock correction (spec 2.4); only the Owner approves it.
CORRECTION_RAISE_ROLES = ["Store", "RMIssue", "GRN", "PlantManager"]
LINE_STATUSES = {"UNRESTRICTED", "WIP", "QC_HOLD", "BLOCKED", "DISPATCH_STAGING", "SCRAP"}
# A new lot from a voucher keeps these statuses; anything else (UNRESTRICTED …) goes on QC hold.
NEW_LOT_KEEP_STATUSES = {"QC_HOLD", "BLOCKED", "SCRAP"}
# Reasons only a stock count writes: a hand-made voucher never shows as a "count difference".
COUNT_ONLY_REASONS = {"PHYSICAL_COUNT_VARIANCE"}
CORRECTION_REASONS = {
    "COUNT_SHORT": "Count short",
    "COUNT_EXTRA": "Count extra",
    "DAMAGED_IN_STORE": "Damaged in store",
    "WRONG_GRN_WEIGHT": "Wrong GRN weight",
    "LABEL_LOST_FOUND": "Label lost / found",
    "OTHER": "Other",
}


def ist_day_end_utc(day: date) -> datetime:
    """23:59:59 IST of a business day as a naive UTC timestamp (what the server stores)."""
    return datetime.combine(day, time(23, 59, 59)) - timedelta(hours=5, minutes=30)


def _refuse_rack_count(db: Session, header: Optional[InventoryCertification]) -> None:
    """Counts made by rack (client 2026-10-28) are worked on their own count page, never by the old sheet."""
    if header is not None and db.query(StockCountLocation.id).filter(StockCountLocation.count_id == header.id).first():
        raise HTTPException(status_code=409, detail="This count is done rack by rack. Open it from Stock counts & book.")


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
        # Counts (client 2026-10-28): kind, month and who submitted / approved.
        "kind": header.kind,
        "month": header.month.isoformat() if header.month else None,
        "submitted_by": header.submitted_by,
        "submitted_at": header.submitted_at.isoformat() if header.submitted_at else None,
        "approved_by": header.approved_by,
        "approved_at": header.approved_at.isoformat() if header.approved_at else None,
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


COUNTED_STATES = {"COUNTED", "REVIEWED"}


def _sync_draft_lines(db: Session, header: InventoryCertification, plant_id: str, as_of: datetime) -> dict[str, int]:
    """Bring a draft count sheet up to date without losing work.

    Every active item gets a line (items created after the draft are added), book figures move to
    ``as_of``, counts already entered are kept and their variance recomputed. Uncounted lines for
    items that are no longer active are dropped.
    """
    statement = compute_stock_statement(
        db=db, plant_scope={"scope_all": False, "selected_plant_id": plant_id},
        start_date=header.period_start, end_date=header.period_end, as_of_at=as_of,
    )
    by_item = {str(line.item_id): line for line in header.lines or []}
    seen: set[str] = set()
    added = updated = removed = 0
    for row in statement["rows"]:
        item_id = str(row["item_id"])
        seen.add(item_id)
        line = by_item.get(item_id)
        if line is None:
            db.add(_line_from_statement(header.id, row))
            added += 1
            continue
        counted = str(line.count_state or "").upper() in COUNTED_STATES or bool(line.recount_required)
        for key in ("opening_qty", "inward_qty", "outward_qty", "adjustment_qty", "closing_qty", "unit_cost", "reorder_level", "safety_stock", "lead_time_days"):
            setattr(line, key, float(row.get(key) or 0.0))
        line.item_code, line.item_name = row["item_code"], row["item_name"]
        if not counted:
            line.physical_qty = line.closing_qty
        line.variance_qty = float(line.physical_qty if line.physical_qty is not None else line.closing_qty) - float(line.closing_qty or 0.0)
        line.closing_value = round(float(line.closing_qty or 0.0) * float(line.unit_cost or 0.0), 2)
        line.variance_value = round(float(line.variance_qty or 0.0) * float(line.unit_cost or 0.0), 2)
        updated += 1
    for item_id, line in by_item.items():
        if item_id not in seen and str(line.count_state or "").upper() not in COUNTED_STATES:
            db.delete(line)
            removed += 1
    header.stock_as_of_at = as_of
    return {"added": added, "updated": updated, "removed": removed}


class OpeningLoadLinePayload(BaseModel):
    """One reel / coil (qty = kg) or bulk lot (qty in the item's unit) of go-live opening stock.

    Every reel or lot gets a new system number dated the go-live date; ``batch_no`` / ``reel_code`` are
    still accepted from old callers but the old number is kept as ``old_mark`` instead.
    """
    item_id: uuid.UUID
    qty: float = Field(gt=0)
    kind: Optional[str] = Field(default=None, max_length=10)
    batch_no: Optional[str] = Field(default=None, max_length=100)
    reel_code: Optional[str] = Field(default=None, max_length=100)
    old_mark: Optional[str] = Field(default=None, max_length=120)
    vendor_name: Optional[str] = Field(default=None, max_length=200)
    vendor_ref: Optional[str] = Field(default=None, max_length=120)
    physical_form: Optional[str] = Field(default=None, max_length=10)
    location_id: Optional[uuid.UUID] = None
    stock_status: str = "UNRESTRICTED"
    on_hold: bool = False
    hold_reason: Optional[str] = Field(default=None, max_length=300)
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
    # Idempotency key: the same key posts the batch once (a double click returns the first post).
    request_id: Optional[uuid.UUID] = None
    effective_date: date
    notes: Optional[str] = Field(default=None, max_length=500)
    lines: list[OpeningLoadLinePayload] = Field(min_length=1, max_length=1000)


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


def _new_lot_prefix(voucher_no: str) -> str:
    """Lot / reel code stem for stock a voucher creates: the voucher number itself (ADJ-…, VAR-…), never ADJ-ADJ-…."""
    token = _doc_token(voucher_no, "ADJ")
    return token if token.startswith(("ADJ-", "VAR-")) else f"ADJ-{token}"


def lock_voucher_numbers(db: Session, plant_id: str, series: str = "stock-voucher") -> None:
    """Serialize "first free number" per plant until this transaction ends, so two approvals or raises at
    the same moment never pick the same ADJ- / VAR- / CNT- number (that was a unique-key 500)."""
    bind = db.get_bind()
    if getattr(getattr(bind, "dialect", None), "name", "") == "postgresql":
        db.execute(text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"), {"key": f"{series}:{plant_id}"})


def _next_adjustment_no(db: Session, plant_id: str, effective_date: date) -> str:
    lock_voucher_numbers(db, plant_id)
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
    lock_voucher_numbers(db, plant_id, "stock-count-no")
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
    creates_reel: bool = False,
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
                "count_id": str(header.count_id) if header.count_id else None,
                "creates_reel": creates_reel or None,
                "location_id": str(line.location_id or reel.location_id) if (line.location_id or reel.location_id) else None,
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
        # A count gain on a known reel (found again, or re-weighed heavier) adds to that same reel,
        # which keeps its QC status; a reel never weighs more than it came in at (spec 2.3).
        reel = db.query(PaperReel).filter(
            PaperReel.id == line.reel_id, PaperReel.plant_id == plant_uuid, PaperReel.paper_id == item.id,
        ).with_for_update().first()
        if not reel:
            raise HTTPException(status_code=404, detail="Adjustment reel not found")
        new_weight = round(float(reel.current_weight_kg or 0.0) + qty_delta, 3)
        if new_weight > float(reel.inward_weight_kg or 0.0) + 0.0005:
            raise HTTPException(status_code=409, detail=f"{reel.reel_code} cannot weigh more than the {float(reel.inward_weight_kg or 0):g} kg it came in at.")
        reel.current_weight_kg = min(new_weight, float(reel.inward_weight_kg or 0.0))
        reel.status = ReelStatus.IN_STOCK
        if line.location_id:
            reel.location_id = line.location_id
        _add_reel_adjustment_event(db, plant_uuid=plant_uuid, reel=reel, line=line, header=header, qty_delta=qty_delta, actor=actor)
        return

    if qty_delta > 0:
        reel_code = f"{_new_lot_prefix(header.voucher_no)}-R{line_index:03d}"
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
                "count_id": str(header.count_id) if header.count_id else None,
                "notes": line.notes,
            },
            inward_metadata={"amigo_no": reel_code, "source_document_type": "STOCK_ADJUSTMENT", "voucher_no": header.voucher_no},
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
            creates_reel=True,
        )
        return

    remaining_to_reduce = abs(qty_delta)
    reels: list[PaperReel]
    if line.reel_id:
        reel = db.query(PaperReel).filter(
            PaperReel.id == line.reel_id,
            PaperReel.plant_id == plant_uuid,
            PaperReel.paper_id == item.id,
        ).with_for_update().first()
        if not reel:
            raise HTTPException(status_code=404, detail="Adjustment reel not found")
        reels = [reel]
    else:
        # No reel named: oldest cleared reels in store only, never a held one (a count or correction
        # names its reel; this is for old item-level vouchers).
        reels = (
            db.query(PaperReel)
            .filter(
                PaperReel.plant_id == plant_uuid,
                PaperReel.paper_id == item.id,
                PaperReel.current_weight_kg > 0,
                PaperReel.status == ReelStatus.IN_STOCK,
                PaperReel.stock_status == "UNRESTRICTED",
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
        if qty_delta < 0:
            balance = float(get_batch_balance(str(batch.id), db) or 0.0)
            if balance + qty_delta < -0.0005:
                raise HTTPException(status_code=409, detail=f"Lot {batch.batch_no} has only {round(balance, 3):g} {_enum(item.uom).lower()} left; it cannot go down by {abs(qty_delta):g}.")
        # The ledger row carries the lot's own QC state: a correction never clears or holds a lot.
        txn_status = batch.stock_status
        txn_location = batch.location_id
    elif qty_delta > 0:
        batch_no = f"{_new_lot_prefix(header.voucher_no)}-B{line_index:03d}"
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
            location=(db.get(InventoryLocation, line.location_id).code if line.location_id else None),
            stock_status=line.stock_status,
            plant_id=plant_id,
            # "In since" the voucher's own day (a back-dated month-end count's lot is in the book from then).
            inward_metadata={"source_document_type": "STOCK_ADJUSTMENT", "voucher_no": header.voucher_no, "notes": line.notes,
                             "received_date": header.effective_date.isoformat() if header.effective_date else None},
        )
        db.add(batch)
        db.flush()
        line.created_batch_id = batch.id
        batch_id = batch.id
        txn_status = line.stock_status
        txn_location = line.location_id
    else:
        txn_status = line.stock_status
        txn_location = line.location_id

    txn = StockTransaction(
        item_id=item.id,
        batch_id=batch_id,
        transaction_type=TransactionType.ADJUSTMENT,
        qty_change=qty_delta,
        reference_type=ReferenceType.ADJUSTMENT,
        reference_id=header.id,
        plant_id=plant_id,
        location_id=line.location_id or txn_location,
        stock_status=txn_status,
        movement_metadata={
            "source_document_type": "STOCK_ADJUSTMENT",
            "adjustment_id": str(header.id),
            "adjustment_line_id": str(line.id),
            "voucher_no": header.voucher_no,
            "reason_code": line.reason_code or header.reason_code,
            "notes": line.notes,
            "count_id": str(header.count_id) if header.count_id else None,
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
    """Post a DRAFT voucher line by line (exact reel / lot when the line names one). Callers decide who
    may approve: corrections and counts are Owner-only (spec 2.3, 2.4); system write-offs post directly."""
    if header.status == "POSTED":
        return
    if header.status != "DRAFT":
        raise HTTPException(status_code=400, detail="Only draft adjustment vouchers can be posted")
    if not (header.lines or []):
        raise HTTPException(status_code=400, detail="Adjustment voucher has no lines")
    # Corrections and count postings dated in a closed month are refused (spec 2.5).
    assert_books_open(db, plant_id, header.effective_date)

    plant_uuid = _to_uuid(plant_id)
    for index, line in enumerate(header.lines or [], start=1):
        item = db.query(ItemMaster).filter(ItemMaster.id == line.item_id, ItemMaster.plant_id == plant_id).first()
        if not item:
            raise HTTPException(status_code=404, detail=f"Adjustment item not found on line {index}")
        if abs(float(line.qty_delta or 0.0)) <= 0.000001:
            raise HTTPException(status_code=400, detail=f"Adjustment qty cannot be zero on line {index}")
        line.stock_status = _validate_status(line.stock_status)
        if not line.reel_id and not line.batch_id and float(line.qty_delta or 0.0) > 0:
            # Stock gained without a known lot is a NEW lot on QC hold (incoming QC is the only gate for
            # issue), kept in the RM store unless the line names a place.
            if line.stock_status not in NEW_LOT_KEEP_STATUSES:
                line.stock_status = "QC_HOLD"
            if not line.location_id:
                from ..services.locations import default_receiving_location

                line.location_id = default_receiving_location(db, plant_id, actor=actor).id
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


def _check_adjustment_lines(db: Session, plant_id: str, lines: list[AdjustmentLinePayload]) -> None:
    """Every material, reel, lot and location named on a voucher must exist in this plant (and belong
    together), so a wrong id is refused in plain words instead of failing on save."""
    plant = str(plant_id).lower()
    for index, line in enumerate(lines, start=1):
        item = db.get(ItemMaster, line.item_id)
        if item is None or str(item.plant_id or "").lower() != plant:
            raise HTTPException(status_code=404, detail=f"Line {index}: that material is not in this plant. Pick it again from the list.")
        if line.reel_id:
            reel = db.get(PaperReel, line.reel_id)
            if reel is None or str(reel.plant_id or "").lower() != plant:
                raise HTTPException(status_code=404, detail=f"Line {index}: that reel is not in this plant. Scan its label again.")
            if str(reel.paper_id) != str(item.id):
                raise HTTPException(status_code=422, detail=f"Line {index}: reel {reel.reel_code} is not {item.name}.")
        if line.batch_id:
            batch = db.get(StockBatch, line.batch_id)
            if batch is None or str(batch.plant_id or "").lower() != plant:
                raise HTTPException(status_code=404, detail=f"Line {index}: that lot is not in this plant. Scan its label again.")
            if str(batch.item_id) != str(item.id):
                raise HTTPException(status_code=422, detail=f"Line {index}: lot {batch.batch_no} is not {item.name}.")
        if line.location_id:
            location = db.get(InventoryLocation, line.location_id)
            if location is None or str(location.plant_id or "").lower() != plant:
                raise HTTPException(status_code=404, detail=f"Line {index}: that location is not in this plant.")
            if str(location.active or "true") != "true":
                raise HTTPException(status_code=422, detail=f"Line {index}: location {location.code} is switched off. Choose an active one.")


@router.post("/adjustment-vouchers")
def create_adjustment_voucher(
    payload: AdjustmentVoucherPayload,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(CORRECTION_RAISE_ROLES)),
):
    """Raise a correction voucher. It is saved as a DRAFT for the Owner to approve (spec 2.4); only an
    Owner's own ``post_now`` posts at once. System write-offs (customer complaint scrap) post elsewhere."""
    if payload.post_now:
        # Dated inside a closed month: refused before anything else (spec 2.5).
        assert_books_open(db, plant_id, payload.effective_date)
    # Returned goods must enter under QC hold with a customer-return record, never as a
    # plain positive adjustment that lands sellable stock with no trace.
    if (payload.source_type or "").strip().upper() != "CUSTOMER_REJECTION" and any(
        float(line.qty_delta) > 0
        and (line.reason_code or payload.reason_code or "").strip().upper() in {"CUSTOMER_REJECTION", "CUSTOMER_RETURN"}
        for line in payload.lines
    ):
        raise HTTPException(
            status_code=400,
            detail="Customer returns are received in Quality → Results & holds → Inward rejected FG, so they are held for QC and linked to the customer and dispatch.",
        )
    source_type = (payload.source_type or "").strip().upper() or "MANUAL"
    if source_type in {"STOCK_COUNT", "CERTIFICATION_VARIANCE"} or payload.reason_code.strip().upper() in COUNT_ONLY_REASONS or any(
        (line.reason_code or "").strip().upper() in COUNT_ONLY_REASONS for line in payload.lines
    ):
        raise HTTPException(status_code=422, detail="A count difference comes only from an approved stock count. Choose another reason, or start a count.")
    for index, line in enumerate(payload.lines, start=1):
        if float(line.qty_delta) < 0 and not line.reel_id and not line.batch_id:
            # Taking stock off "the item" splits the item total from its lots; the reel or lot must be named.
            raise HTTPException(status_code=422, detail=f"Line {index}: name the reel or lot to take stock off (scan its label). Use Stock counts & book → Raise a correction.")
    _check_adjustment_lines(db, plant_id, payload.lines)
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
        source_type=source_type,
        source_id=payload.source_id,
        attachment_refs=list(payload.attachment_refs or []),
        created_by=_actor(current_user),
    )
    db.add(header)
    db.flush()
    receiving_id = None
    for line_payload in payload.lines:
        status_value = _validate_status(line_payload.stock_status)
        location_id = line_payload.location_id
        if not line_payload.reel_id and not line_payload.batch_id and float(line_payload.qty_delta) > 0:
            # Stock gained without a known lot is a new lot ON QC HOLD in the RM store (rule 0.2): the draft
            # shows the Owner exactly what approving it will post.
            if status_value not in NEW_LOT_KEEP_STATUSES:
                status_value = "QC_HOLD"
            if not location_id:
                if receiving_id is None:
                    from ..services.locations import default_receiving_location

                    receiving_id = default_receiving_location(db, plant_id, actor=_actor(current_user)).id
                location_id = receiving_id
        db.add(
            StockAdjustmentLine(
                adjustment_id=header.id,
                item_id=line_payload.item_id,
                batch_id=line_payload.batch_id,
                reel_id=line_payload.reel_id,
                qty_delta=float(line_payload.qty_delta),
                unit_cost=line_payload.unit_cost,
                location_id=location_id,
                stock_status=status_value,
                reason_code=(line_payload.reason_code or payload.reason_code).strip().upper(),
                notes=line_payload.notes,
            )
        )
    db.flush()
    if payload.post_now and is_actual_owner(current_user):
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
    current_user: dict = Depends(require_owner),
):
    """Owner only: post a draft correction voucher (spec 2.4). The same path as Approve on Stock counts &
    book: the voucher row is locked (a double submit posts once and returns the posted voucher), it is
    dated today and re-based on the stock now. A count's posting is approved on its count."""
    header = _draft_correction(db, plant_id, voucher_id)
    if header.status == "POSTED":
        return _serialize_adjustment_voucher(header, include_lines=True)
    if header.status != "DRAFT":
        raise HTTPException(status_code=409, detail="This correction was rejected. Raise a new one if needed.")
    if _voucher_kind(header) == "COUNT":
        raise HTTPException(status_code=409, detail="A stock count posts its own differences when the Owner approves the count. Open the count to approve it.")
    _approve_waiting_voucher(db, header, str(plant_id), _actor(current_user))
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
    # Go-live tool only (spec 2.3): Owner and Admin.
    current_user: dict = Depends(require_role([])),
):
    # Go-live rule (client 2026-10-30): the first batch fixes the go-live date, later batches use the same
    # date until that month is closed; each reel / lot gets a new system number, all or nothing, once per
    # request key. The rules and the posting live in services/opening_stock.py.
    result = opening_stock.post_batch(db, plant_id, payload, _actor(current_user))
    if result.get("idempotent"):
        return result
    header = db.query(InventoryOpeningLoad).filter(InventoryOpeningLoad.id == uuid.UUID(result["id"])).one()
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
    return result


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
        ~InventoryCertification.id.in_(db.query(StockCountLocation.count_id)),
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
    # A re-draft of the same period keeps counts already entered (never wipes a count in progress).
    _sync_draft_lines(db, header, plant_id, stock_as_of_at)
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
    result = _serialize_certification(header, include_lines=True)
    # Live stock right now next to the book figure the sheet was drafted at, so a count taken
    # later (or movements after the draft) are visible, and items created since are flagged.
    for line in result.get("lines") or []:
        line["live_qty"] = round(float(get_item_balance(line["item_id"], db)), 3)
        line["counted"] = str(line.get("count_state") or "").upper() in COUNTED_STATES
    if header.status == "DRAFT":
        active = db.query(ItemMaster.id).filter(ItemMaster.plant_id == header.plant_id, ItemMaster.active == "true").all()
        on_sheet = {line["item_id"] for line in result.get("lines") or []}
        result["missing_item_count"] = sum(1 for (item_id,) in active if str(item_id) not in on_sheet)
        result["moved_since_draft_count"] = sum(1 for line in result.get("lines") or [] if abs(line["live_qty"] - line["closing_qty"]) > 0.0005)
    return result


@router.post("/certifications/{certification_id}/refresh")
def refresh_certification(
    certification_id: uuid.UUID,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Owner", "Admin", "Store"])),
):
    """Re-sync a draft count sheet: add new items, move book stock to now, keep counts entered."""
    header = db.query(InventoryCertification).filter(
        InventoryCertification.id == certification_id, InventoryCertification.plant_id == plant_id,
    ).first()
    if not header:
        raise HTTPException(status_code=404, detail="Certification not found")
    _refuse_rack_count(db, header)
    if header.status != "DRAFT":
        raise HTTPException(status_code=400, detail="Only a draft count sheet can be refreshed")
    stats = _sync_draft_lines(db, header, plant_id, datetime.utcnow())
    db.commit()
    db.refresh(header)
    return {**_serialize_certification(header, include_lines=True), "refresh": stats}


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
    _refuse_rack_count(db, header)
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
    current_user: dict = Depends(require_owner),
):
    header = db.query(InventoryCertification).filter(
        InventoryCertification.id == certification_id,
        InventoryCertification.plant_id == plant_id,
    ).first()
    if not header:
        raise HTTPException(status_code=404, detail="Certification not found")
    _refuse_rack_count(db, header)
    if header.status == "CARRIED_FORWARD":
        raise HTTPException(status_code=400, detail="Certification already carried forward")
    recount_lines = [
        line for line in header.lines or []
        if bool(line.recount_required) or line.count_state == "RECOUNT_REQUIRED"
    ]
    if recount_lines:
        raise HTTPException(status_code=400, detail="Review or clear recount-required lines before certification")
    if header.status == "DRAFT":
        uncounted = [line for line in header.lines or [] if str(line.count_state or "").upper() not in COUNTED_STATES]
        if uncounted:
            names = ", ".join(line.item_code for line in uncounted[:5])
            raise HTTPException(status_code=409, detail=f"{len(uncounted)} line(s) are not counted yet ({names}{'…' if len(uncounted) > 5 else ''}). Count them, or mark them as matching book stock, before certifying.")
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
    current_user: dict = Depends(require_owner),
):
    certification = db.query(InventoryCertification).filter(
        InventoryCertification.id == certification_id,
        InventoryCertification.plant_id == plant_id,
    ).first()
    if not certification:
        raise HTTPException(status_code=404, detail="Certification not found")
    _refuse_rack_count(db, certification)
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
    current_user: dict = Depends(require_owner),
):
    header = db.query(InventoryCertification).filter(
        InventoryCertification.id == certification_id,
        InventoryCertification.plant_id == plant_id,
    ).first()
    if not header:
        raise HTTPException(status_code=404, detail="Certification not found")
    _refuse_rack_count(db, header)
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
    current_user: dict = Depends(require_owner),
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
    # No ledger movement, but the opening document is dated, so a closed month refuses it too.
    assert_books_open(db, plant_id, cf.opening_date)

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


# ---------------------------------------------------------------------------------------------------
# Month figures (spec 2.1 / 5): the store side of month-end close. Every number is in the item's unit.
# ---------------------------------------------------------------------------------------------------


def _month_bounds(month: str) -> tuple[date, date]:
    start = parse_month(month)
    if start > month_start(ist_today()):
        raise HTTPException(status_code=422, detail=f"{month_label(start)} has not started yet.")
    return start, next_month(start) - timedelta(days=1)


def month_end_count_row(db: Session, plant_id: str, start: date) -> Optional[InventoryCertification]:
    return db.query(InventoryCertification).filter(
        InventoryCertification.plant_id == str(plant_id),
        InventoryCertification.kind == "MONTH_END",
        InventoryCertification.month == start,
        InventoryCertification.status != "CANCELLED",
    ).order_by(InventoryCertification.created_at.desc()).first()


def count_changes_after_approval(db: Session, plant_id: str, count: Optional[InventoryCertification], items: Optional[dict] = None) -> dict[str, dict[str, Any]]:
    """Back-dated store movements entered after an approved month-end count (see changes_after_count)."""
    if count is None or count.kind != "MONTH_END" or count.status not in {"CERTIFIED", "APPROVED"}:
        return {}
    approved = count.approved_at or count.certified_at
    if approved is None:
        return {}
    # Only items with a store row entered after the approval can have changed (bounded SQL), so the book
    # is not read again in full on every month-figures call (r4: two whole-history reads per call).
    touched = _items_entered_after(db, plant_id, approved)
    if items is not None:
        touched &= set(items)
    if not touched:
        return {}
    docs = {
        voucher_no for (voucher_no,) in db.query(StockAdjustmentVoucher.voucher_no).filter(
            StockAdjustmentVoucher.plant_id == str(plant_id), StockAdjustmentVoucher.count_id == count.id,
        ).all()
    }
    return changes_after_count(db, plant_id, count, items=book_items(db, plant_id, sorted(touched)), own_docs=docs)


def _items_entered_after(db: Session, plant_id: str, after: datetime) -> set[str]:
    """Material ids of the plant with a ledger row, reel, reel issue or reel adjustment entered after
    ``after`` (naive UTC): the only items whose book can differ from what a count saw at ``after``."""
    from ..models import ReelIssue

    plant_items = db.query(ItemMaster.id).filter(ItemMaster.plant_id == str(plant_id))
    touched = {str(value) for (value,) in db.query(StockTransaction.item_id).filter(
        StockTransaction.item_id.in_(plant_items), StockTransaction.created_at > after,
    ).distinct().all()}
    try:
        plant_uuid = uuid.UUID(str(plant_id))
    except ValueError:
        return touched
    reels = db.query(PaperReel.paper_id).filter(PaperReel.plant_id == plant_uuid)
    touched |= {str(value) for (value,) in reels.filter(PaperReel.created_at > after).distinct().all()}
    touched |= {str(value) for (value,) in db.query(PaperReel.paper_id).join(ReelIssue, ReelIssue.reel_id == PaperReel.id).filter(
        PaperReel.plant_id == plant_uuid, ReelIssue.created_at > after,
    ).distinct().all()}
    touched |= {str(value) for (value,) in db.query(PaperReel.paper_id).join(ReelScanEvent, ReelScanEvent.reel_id == PaperReel.id).filter(
        PaperReel.plant_id == plant_uuid, ReelScanEvent.event_type == ReelScanEventType.MOVE_SCAN, ReelScanEvent.timestamp > after,
    ).distinct().all()}
    return touched


def changed_items_payload(db: Session, plant_id: str, changes: dict[str, dict[str, Any]], items: Optional[dict] = None) -> list[dict[str, Any]]:
    if not changes:
        return []
    items = items if items is not None else book_items(db, plant_id, list(changes))
    rows = []
    for key, change in changes.items():
        item = items.get(key)
        rows.append({
            "item_id": key,
            "item_code": getattr(item, "item_code", None),
            "item_name": getattr(item, "name", None),
            "uom": _enum(getattr(item, "uom", None)) if item is not None else None,
            "qty": change["qty"], "rows": change["rows"], "docs": change["docs"], "first_day": change["first_day"],
        })
    return sorted(rows, key=lambda row: str(row["item_code"] or ""))


def month_end_count_brief(db: Session, plant_id: str, start: date, *, changes: Optional[dict[str, dict[str, Any]]] = None) -> Optional[dict[str, Any]]:
    row = month_end_count_row(db, plant_id, start)
    if row is None:
        return None
    if changes is None:
        changes = count_changes_after_approval(db, plant_id, row)
    return {
        "id": str(row.id),
        "count_no": row.count_session_no,
        "status": row.status,
        "submitted_by": row.submitted_by,
        "submitted_at": row.submitted_at.isoformat() if row.submitted_at else None,
        "approved_by": row.approved_by or row.certified_by,
        "approved_at": (row.approved_at or row.certified_at).isoformat() if (row.approved_at or row.certified_at) else None,
        # Stock entered after the approval but dated into the counted month: the certificate no longer
        # matches the book. The Owner recounts those items (a spot count) or checks the entries before closing.
        "changed_after_count": bool(changes),
        "changed_items": changed_items_payload(db, plant_id, changes),
    }


@router.get("/month-figures")
def month_figures(
    month: str = Query(..., description="YYYY-MM"),
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_one_plant),
    current_user: dict = Depends(get_current_user),
):
    """Opening, received, sent back, issued, corrections and closing per material for one IST month.

    ``received`` includes ``opening_loads``; ``corrections`` includes ``count_variance``. Closing =
    opening + received - sent_back - issued + corrections and actual_used = opening + received -
    sent_back - closing (= issued - corrections). A running month is figured up to now; its
    ``identity_ok`` also checks the closing against the live stock records.
    """
    start, end = _month_bounds(month)
    previous = month_start(start - timedelta(days=1))
    result = book_period(db, plant_id, start, end)
    count = month_end_count_row(db, plant_id, start)
    changes = count_changes_after_approval(db, plant_id, count)
    for row in result["items"]:
        change = changes.get(row["item_id"])
        row["changed_after_count"] = change["qty"] if change else None
    return {
        "plant_id": str(plant_id),
        "month": month_key(start),
        "month_label": month_label(start),
        "period_start": start.isoformat(),
        "period_end": end.isoformat(),
        "running": result["running"],
        "closed": is_month_locked(db, plant_id, start),
        "opening_source": "PREVIOUS_CLOSE" if is_month_locked(db, plant_id, previous) else "BOOK_AT_START",
        "month_end_count": month_end_count_brief(db, plant_id, start, changes=changes),
        "units": result["units"],
        "items": result["items"],
        "generated_at": datetime.utcnow().isoformat(),
    }


@router.get("/month-figures/{item_id}/sources")
def month_figure_sources(
    item_id: uuid.UUID,
    month: str = Query(..., description="YYYY-MM"),
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_one_plant),
    current_user: dict = Depends(get_current_user),
):
    """The receipts, returns, issues and corrections behind one item's month figures (month-end drawer)."""
    start, end = _month_bounds(month)
    result = book_item_sources(db, plant_id, str(item_id), start, end)
    if not result:
        raise HTTPException(status_code=404, detail="That material is not in this plant's stock book.")
    places = {str(row.id): row for row in db.query(InventoryLocation).filter(InventoryLocation.plant_id == str(plant_id)).all()}
    for row in result["rows"]:
        place = places.get(str(row.get("location_id") or ""))
        if place is not None:
            row["location_code"] = place.code
            row["location_name"] = str(place.name or "").strip() or place.code
    _return_references(db, result["rows"])
    return {**result, "month": month_key(start), "month_label": month_label(start)}


def _return_references(db: Session, rows: list[dict[str, Any]]) -> None:
    """A supplier return reads by its own return reference ("RTV-…"), with the GRN it came in on beside
    it, instead of the GRN number alone (r4: the drawer showed IN/25/002 for the return)."""
    ledger_ids = [row["id"] for row in rows if row.get("kind") == "SENT_BACK" and row.get("type") == "LEDGER" and row.get("id")]
    event_ids = [row["id"] for row in rows if row.get("kind") == "SENT_BACK" and row.get("type") == "REEL_ADJUST" and row.get("id")]
    meta: dict[str, dict[str, Any]] = {}
    if ledger_ids:
        meta.update({str(key): value or {} for key, value in db.query(StockTransaction.id, StockTransaction.movement_metadata).filter(
            StockTransaction.id.in_([uuid.UUID(str(value)) for value in ledger_ids]),
        ).all()})
    if event_ids:
        meta.update({str(key): value or {} for key, value in db.query(ReelScanEvent.id, ReelScanEvent.event_metadata).filter(
            ReelScanEvent.id.in_([uuid.UUID(str(value)) for value in event_ids]),
        ).all()})
    for row in rows:
        data = meta.get(str(row.get("id") or ""))
        if not data:
            continue
        reference = str(data.get("return_reference") or "").strip()
        grn = str(data.get("grn_no") or "").strip()
        if reference:
            row["doc"] = reference
        if grn and grn != row.get("doc"):
            row["against_grn"] = grn


# ---------------------------------------------------------------------------------------------------
# Corrections outside counts (spec 2.4): Store, RMIssue, GRN, PlantManager, Owner or Admin raise one
# for a lot or reel (new qty, or "not here / damaged") or for loose stock found without a label; it is
# saved as a DRAFT and only the Owner approves (posts) or rejects (cancels with a note) it.
# ---------------------------------------------------------------------------------------------------



class CorrectionPayload(BaseModel):
    code: Optional[str] = Field(default=None, max_length=500)
    entity_type: Optional[str] = None
    entity_id: Optional[uuid.UUID] = None
    item_id: Optional[uuid.UUID] = None
    location_id: Optional[uuid.UUID] = None
    new_qty: Optional[float] = Field(default=None, ge=0)
    not_here: bool = False
    reason: str = Field(min_length=1, max_length=40)
    note: Optional[str] = Field(default=None, max_length=500)


class CorrectionDecisionPayload(BaseModel):
    note: Optional[str] = Field(default=None, max_length=500)


def _voucher_kind(header: StockAdjustmentVoucher) -> str:
    source = str(header.source_type or "").upper()
    if header.count_id or source in {"STOCK_COUNT", "CERTIFICATION_VARIANCE"}:
        return "COUNT"
    if source in {"CORRECTION", "MANUAL"}:
        return "CORRECTION"
    return "SYSTEM"


def _rebased_delta(line: StockAdjustmentLine, changed_since: float, live: float) -> float:
    """A waiting correction's change after other postings on the same lot since it was raised."""
    delta = round(float(line.qty_delta or 0.0) - changed_since, 3)
    if float(line.qty_delta or 0.0) < 0 < delta or float(line.qty_delta or 0.0) > 0 > delta:
        return 0.0  # the other posting already went past what this one asked for
    return round(max(delta, -live), 3)


def _issued_since(db: Session, entity_type: str, lot: Any, since: Optional[datetime]) -> Optional[date]:
    """The day a reel / lot was issued to the floor after ``since`` (naive UTC), or None.

    Issues are not adjustment postings, so ``posted_since`` never sees them: a waiting gain on a lot
    the floor has since used up would otherwise put the issued weight back into store stock."""
    if since is None or lot is None:
        return None
    if entity_type == "REEL":
        from ..models import ReelIssue

        row = db.query(ReelIssue).filter(ReelIssue.reel_id == lot.id, ReelIssue.created_at > since).order_by(ReelIssue.created_at.desc()).first()
        return row.issue_date if row is not None else None
    row = db.query(StockTransaction).filter(
        StockTransaction.batch_id == lot.id, StockTransaction.transaction_type == TransactionType.ISSUE_PRODUCTION,
        StockTransaction.created_at > since,
    ).order_by(StockTransaction.created_at.desc()).first()
    if row is None:
        return None
    from ..services.books import ist_day

    return row.effective_date or ist_day(row.created_at)


def _still_to_post(db: Session, header: StockAdjustmentVoucher, line: StockAdjustmentLine, entity_type: str, lot: Any) -> tuple[float, float, float, Optional[date]]:
    """(changed since raised, live qty, what approving still posts, issued-to-floor day) for one waiting line.

    Nothing returns from the floor: a gain on a lot that was issued since it was raised and is now empty
    in the store posts nothing (as count approval does for "issued after it was counted")."""
    changed = posted_since(db, entity_type, lot.id, header.created_at, exclude_voucher_id=header.id)
    live = entity_qty(db, entity_type, lot)
    delta = _rebased_delta(line, changed, live)
    issued = None
    if live <= 0.0005:
        issued = _issued_since(db, entity_type, lot, header.created_at)
        if issued is not None:
            delta = 0.0
    return changed, live, delta, issued


def _correction_view(db: Session, header: StockAdjustmentVoucher) -> dict[str, Any]:
    payload = _serialize_adjustment_voucher(header, include_lines=True)
    reel_ids = [line.reel_id for line in header.lines or [] if line.reel_id] + [line.created_reel_id for line in header.lines or [] if line.created_reel_id]
    batch_ids = [line.batch_id for line in header.lines or [] if line.batch_id] + [line.created_batch_id for line in header.lines or [] if line.created_batch_id]
    reels = {str(row.id): row for row in db.query(PaperReel).filter(PaperReel.id.in_(reel_ids)).all()} if reel_ids else {}
    batches = {str(row.id): row for row in db.query(StockBatch).filter(StockBatch.id.in_(batch_ids)).all()} if batch_ids else {}
    codes = {str(row.id): row.code for row in db.query(InventoryLocation).filter(InventoryLocation.plant_id == header.plant_id).all()}
    for line, row in zip(header.lines or [], payload.get("lines") or []):
        lot = reels.get(str(line.reel_id or line.created_reel_id)) if (line.reel_id or line.created_reel_id) else batches.get(str(line.batch_id or line.created_batch_id)) if (line.batch_id or line.created_batch_id) else None
        row["uom"] = "KG" if isinstance(lot, PaperReel) else _enum(getattr(line.item, "uom", None))
        row["lot_code"] = (lot.reel_code if isinstance(lot, PaperReel) else lot.batch_no) if lot is not None else None
        row["new_lot"] = bool(line.created_reel_id or line.created_batch_id) or (not line.reel_id and not line.batch_id and float(line.qty_delta or 0) > 0)
        row["location_code"] = codes.get(str(line.location_id)) if line.location_id else None
        if header.status == "DRAFT" and lot is not None:
            kind = "REEL" if isinstance(lot, PaperReel) else "BATCH"
            # Another count or correction already changed this lot after this one was raised, or the floor
            # used it up: approving posts only what is still different (shown to the Owner before approving).
            changed, live, still, issued = _still_to_post(db, header, line, kind, lot)
            row["live_qty"] = live
            row["changed_since"] = changed
            row["still_to_post"] = still
            row["issued_since"] = issued.isoformat() if issued is not None else None
    payload["kind"] = _voucher_kind(header)
    payload["reason_label"] = CORRECTION_REASONS.get(header.reason_code) or {"PHYSICAL_COUNT_VARIANCE": "Stock count", "CUSTOMER_REJECTION_SCRAP": "Customer complaint scrap"}.get(header.reason_code, header.reason_code.replace("_", " ").capitalize())
    payload["count_id"] = str(header.count_id) if header.count_id else None
    payload["cancelled_by"] = header.cancelled_by
    payload["cancelled_at"] = header.cancelled_at.isoformat() if header.cancelled_at else None
    payload["cancel_note"] = header.cancel_note
    return payload


@router.get("/corrections")
def list_corrections(
    status: str = Query(default="ALL"),
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_one_plant),
    current_user: dict = Depends(get_current_user),
):
    """Corrections waiting for the Owner, and posted / rejected ones (count and system vouchers included)."""
    query = db.query(StockAdjustmentVoucher).filter(StockAdjustmentVoucher.plant_id == str(plant_id))
    wanted = status.strip().upper()
    if wanted in {"DRAFT", "POSTED", "CANCELLED"}:
        query = query.filter(StockAdjustmentVoucher.status == wanted)
    rows = query.order_by(StockAdjustmentVoucher.created_at.desc()).limit(150).all()
    waiting = db.query(StockAdjustmentVoucher.id).filter(
        StockAdjustmentVoucher.plant_id == str(plant_id), StockAdjustmentVoucher.status == "DRAFT",
    ).count()
    roles = set(current_user.get("roles") or [])
    return {
        "items": [_correction_view(db, row) for row in rows], "waiting_count": waiting, "reasons": CORRECTION_REASONS,
        "can": {"approve": is_actual_owner(current_user), "raise": bool(roles & {"Owner", "Admin", *CORRECTION_RAISE_ROLES}),
                "opening_load": bool(roles & {"Owner", "Admin"})},
    }


@router.get("/corrections/lookup")
def correction_lookup(
    code: str = Query(..., min_length=1, max_length=500),
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_one_plant),
    current_user: dict = Depends(get_current_user),
):
    """What a typed or scanned label is, before raising a correction: material, place, book qty now, QC
    state, and a correction already waiting on it (plain-word 404 / 409 for an unknown or rack label)."""
    found = resolve_lot(db, plant_id, code)
    entity_type, entity, item = found["entity_type"], found["entity"], found["item"]
    locations = {str(row.id): row for row in db.query(InventoryLocation).filter(InventoryLocation.plant_id == str(plant_id)).all()}
    row = lot_row(entity, item, entity_qty(db, entity_type, entity), locations=locations)
    waiting = _waiting_correction(db, plant_id, entity_type, entity.id)
    status = str(entity.stock_status or "")
    issued = None
    if entity_type == "REEL" and float(entity.current_weight_kg or 0) <= 0.0005:
        from ..models import ReelIssue

        issue = db.query(ReelIssue).filter(ReelIssue.reel_id == entity.id).order_by(ReelIssue.created_at.desc()).first()
        issued = issue.issue_date.isoformat() if issue is not None else None
    return {
        **row,
        "qc_word": QC_WORDS.get(status, row["qc_word"]),
        "inward_qty": round(float(entity.inward_weight_kg or 0.0), 3) if entity_type == "REEL" else None,
        "returned": status == "RETURNED",
        "issued_on": issued,
        "waiting": {"id": str(waiting.id), "voucher_no": waiting.voucher_no, "created_by": waiting.created_by} if waiting is not None else None,
    }


def _waiting_correction(db: Session, plant_id: str, entity_type: str, entity_id: Any) -> Optional[StockAdjustmentVoucher]:
    column = StockAdjustmentLine.reel_id if entity_type == "REEL" else StockAdjustmentLine.batch_id
    return db.query(StockAdjustmentVoucher).join(StockAdjustmentLine, StockAdjustmentLine.adjustment_id == StockAdjustmentVoucher.id).filter(
        StockAdjustmentVoucher.plant_id == str(plant_id), StockAdjustmentVoucher.status == "DRAFT", column == entity_id,
    ).order_by(StockAdjustmentVoucher.created_at.asc()).first()


@router.post("/corrections")
def raise_correction(
    payload: CorrectionPayload,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_one_plant),
    current_user: dict = Depends(require_role(CORRECTION_RAISE_ROLES)),
):
    reason = payload.reason.strip().upper()
    if reason not in CORRECTION_REASONS:
        raise HTTPException(status_code=422, detail="Choose a reason: count short, count extra, damaged in store, wrong GRN weight, label lost / found, or other.")
    note = " ".join((payload.note or "").split()) or None
    if reason == "OTHER" and len(note or "") < 3:
        raise HTTPException(status_code=422, detail="Write what happened when the reason is Other.")
    today = ist_today()
    assert_books_open(db, plant_id, today)
    # Two raises at the same moment: the second waits here, then sees the first one's waiting correction
    # and gets its own voucher number (never a duplicate-number 500).
    lock_voucher_numbers(db, str(plant_id))
    actor = _actor(current_user)
    entity = None
    entity_type = ""
    if payload.code or payload.entity_id:
        if payload.code:
            found = resolve_lot(db, plant_id, payload.code)
            entity_type, entity = found["entity_type"], found["entity"]
        else:
            entity_type = str(payload.entity_type or "").upper()
            model = PaperReel if entity_type == "REEL" else StockBatch if entity_type == "BATCH" else None
            if model is None:
                raise HTTPException(status_code=422, detail="entity_type must be REEL or BATCH")
            entity = db.get(model, payload.entity_id)
            if entity is None or str(getattr(entity, "plant_id", "")).lower() != str(plant_id).lower():
                raise HTTPException(status_code=404, detail="That reel or lot is not in this plant.")
        item = db.query(ItemMaster).filter(ItemMaster.id == (entity.paper_id if entity_type == "REEL" else entity.item_id)).first()
        code = entity.reel_code if entity_type == "REEL" else entity.batch_no
        if str(entity.stock_status or "") == "RETURNED":
            raise HTTPException(status_code=409, detail=f"{code} was returned to the supplier. It is not in stock.")
        if entity_type == "REEL":
            from ..models import ReelIssue

            issue = db.query(ReelIssue).filter(ReelIssue.reel_id == entity.id).order_by(ReelIssue.created_at.desc()).first()
            if issue is not None and float(entity.current_weight_kg or 0) <= 0.0005:
                raise HTTPException(status_code=409, detail=f"{code} was issued to the floor on {issue.issue_date.strftime('%d %b %Y')}. Nothing comes back from the floor; if it is in the store, record it in a stock count.")
        waiting = _waiting_correction(db, plant_id, entity_type, entity.id)
        if waiting is not None:
            # Two waiting corrections of one lot would both post their difference.
            # The raiser goes as its own field too: the web shows the person's directory name, never a login.
            raiser = str(waiting.created_by or "").strip()
            raise HTTPException(status_code=409, detail={
                "code": "CORRECTION_WAITING",
                "message": f"{code} already has a correction waiting for the Owner ({waiting.voucher_no}, raised by {raiser.split('@')[0] or 'the store'}). The Owner approves or rejects that one first.",
                "voucher_no": waiting.voucher_no,
                "raised_by": raiser or None,
            })
        live = entity_qty(db, entity_type, entity)
        if not payload.not_here and payload.new_qty is None:
            raise HTTPException(status_code=422, detail="Enter the quantity really there, or mark it not here / damaged.")
        target = 0.0 if payload.not_here else round(float(payload.new_qty or 0.0), 3)
        if entity_type == "REEL" and target > float(entity.inward_weight_kg or 0.0) + 0.0005:
            raise HTTPException(status_code=422, detail=f"{code} came in at {float(entity.inward_weight_kg or 0):g} kg; it cannot weigh more.")
        delta = round(target - live, 3)
        if abs(delta) < 0.0005:
            raise HTTPException(status_code=422, detail=f"The book already says {live:g} for {code}. Nothing to correct.")
        status_value = str(entity.stock_status or "UNRESTRICTED")
        line = StockAdjustmentLine(
            item_id=item.id,
            reel_id=entity.id if entity_type == "REEL" else None,
            batch_id=entity.id if entity_type == "BATCH" else None,
            qty_delta=delta,
            unit_cost=float(entity.unit_cost) if getattr(entity, "unit_cost", None) else None,
            location_id=entity.location_id,
            stock_status=status_value if status_value in LINE_STATUSES else "UNRESTRICTED",
            reason_code=reason,
            notes=f"{code}: book {live:g} → {target:g}" + (" (not here / damaged)" if payload.not_here else ""),
        )
    else:
        if not payload.item_id or not payload.new_qty:
            raise HTTPException(status_code=422, detail="Scan the lot, or choose the material and the quantity found.")
        item = db.query(ItemMaster).filter(ItemMaster.id == payload.item_id, ItemMaster.plant_id == str(plant_id)).first()
        if item is None or _enum(item.type) in {"FINISHED_GOOD", "TOOL"}:
            raise HTTPException(status_code=404, detail="Choose a material of this plant.")
        location_id = payload.location_id
        if location_id and not db.query(InventoryLocation.id).filter(InventoryLocation.id == location_id, InventoryLocation.plant_id == str(plant_id)).first():
            raise HTTPException(status_code=404, detail="That location is not in this plant.")
        if not location_id:
            from ..services.locations import default_receiving_location

            location_id = default_receiving_location(db, plant_id, actor=actor).id
        # Stock found without a label is added as a new lot ON QC HOLD: incoming QC stays the only gate.
        line = StockAdjustmentLine(
            item_id=item.id, qty_delta=round(float(payload.new_qty), 3), location_id=location_id,
            stock_status="QC_HOLD", reason_code=reason, notes="Found without a label; new lot on QC hold",
        )
    header = StockAdjustmentVoucher(
        plant_id=str(plant_id),
        voucher_no=_next_adjustment_no(db, str(plant_id), today),
        effective_date=today,
        effective_at=ist_day_end_utc(today),
        reason_code=reason,
        reason_notes=note,
        source_type="CORRECTION",
        attachment_refs=[],
        created_by=actor,
        status="DRAFT",
    )
    db.add(header)
    db.flush()
    line.adjustment_id = header.id
    db.add(line)
    db.commit()
    db.refresh(header)
    return _correction_view(db, header)


def _draft_correction(db: Session, plant_id: str, voucher_id: uuid.UUID) -> StockAdjustmentVoucher:
    header = db.query(StockAdjustmentVoucher).filter(
        StockAdjustmentVoucher.id == voucher_id, StockAdjustmentVoucher.plant_id == str(plant_id),
    ).with_for_update().first()
    if header is None:
        raise HTTPException(status_code=404, detail="Correction not found")
    return header


def _approve_waiting_voucher(db: Session, header: StockAdjustmentVoucher, plant_id: str, actor: str, note: Optional[str] = None) -> None:
    """Post a waiting (DRAFT) voucher the Owner approves now. The caller has locked the header row
    (``_draft_correction``), so a double submit waits and then finds it POSTED.

    It is dated today (IST), and each named reel / lot line is re-based on the stock now: a count or
    another correction that changed the same lot after this one was raised is taken off, so one
    difference is never posted twice."""
    today = ist_today()
    header.effective_date = today
    header.effective_at = ist_day_end_utc(today)
    for line in list(header.lines or []):
        # The lot row is locked, so an issue running at the same moment either finishes first (and is seen
        # below) or waits for this approval.
        model = PaperReel if line.reel_id else StockBatch if line.batch_id else None
        lot = db.query(model).filter(model.id == (line.reel_id or line.batch_id)).with_for_update().populate_existing().first() if model is not None else None
        if lot is None:
            if float(line.qty_delta or 0.0) < 0:
                # An old item-level voucher: posting it would split the item total from its lots.
                raise HTTPException(status_code=409, detail=f"{header.voucher_no} takes stock off without naming the reel or lot. Reject it and raise a correction for the lot.")
            continue
        kind = "REEL" if line.reel_id else "BATCH"
        changed, live, delta, issued = _still_to_post(db, header, line, kind, lot)
        if issued is not None:
            # Nothing returns from the floor: a gain on a lot the floor has used up would put it back in store.
            raise HTTPException(status_code=409, detail={
                "code": "ISSUED_SINCE_RAISED",
                "message": f"{lot_code(lot)} was issued to the floor on {issued.strftime('%d %b %Y')}, after this correction was raised. Nothing comes back from the floor, so reject this correction. If it is really in the store, record it in a stock count.",
                "issued_on": issued.isoformat(),
            })
        if abs(delta) < 0.0005:
            why = (f"the book already changed by {changed:+g} since this was raised" if abs(changed) >= 0.0005
                   else "it was issued or used since this was raised")
            raise HTTPException(status_code=409, detail=f"Nothing left to correct on {lot_code(lot)}: {why} (now {live:g}). Reject this correction.")
        if abs(delta - float(line.qty_delta or 0.0)) >= 0.0005:
            line.notes = f"{line.notes or ''} · re-based on the book now ({float(line.qty_delta or 0.0):+g} → {delta:+g})".strip(" ·")[:500]
            line.qty_delta = delta
    if note and note.strip():
        header.reason_notes = " · ".join(filter(None, [header.reason_notes, f"Owner: {note.strip()}"]))[:500]
    _post_adjustment_voucher(db, header=header, plant_id=str(plant_id), actor=actor)


@router.post("/corrections/{voucher_id}/approve")
def approve_correction(
    voucher_id: uuid.UUID,
    payload: CorrectionDecisionPayload,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_one_plant),
    current_user: dict = Depends(require_owner),
):
    """Owner only: post the correction today (IST). Idempotent: an approved one is returned as it is."""
    header = _draft_correction(db, plant_id, voucher_id)
    if header.status == "POSTED":
        return _correction_view(db, header)
    if header.status != "DRAFT":
        raise HTTPException(status_code=409, detail="This correction was rejected. Raise a new one if needed.")
    _approve_waiting_voucher(db, header, str(plant_id), _actor(current_user), payload.note)
    db.commit()
    db.refresh(header)
    try:
        emit_audit_event(
            token=current_user.get("token", ""), event_type="stock_correction_approved", entity_type="stock_adjustment_voucher",
            entity_id=str(header.id), plant_id=str(plant_id), actor_role="Owner", actor_email=current_user.get("sub"),
            summary=f"Correction {header.voucher_no} approved", payload=_serialize_adjustment_voucher(header, include_lines=True),
        )
    except Exception as exc:
        _audit_logger.warning("audit emit failed for stock_correction_approved %s: %s", header.id, exc)
    return _correction_view(db, header)


@router.post("/corrections/{voucher_id}/cancel")
def reject_correction(
    voucher_id: uuid.UUID,
    payload: CorrectionDecisionPayload,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_one_plant),
    current_user: dict = Depends(require_owner),
):
    """Owner only: reject a waiting correction with a note; stock does not change."""
    note = " ".join((payload.note or "").split())
    if len(note) < 3:
        raise HTTPException(status_code=422, detail="Write why the correction is rejected.")
    header = _draft_correction(db, plant_id, voucher_id)
    if header.status == "CANCELLED":
        return _correction_view(db, header)
    if header.status != "DRAFT":
        raise HTTPException(status_code=409, detail="This correction is already posted.")
    header.status = "CANCELLED"
    header.cancelled_by = _actor(current_user)
    header.cancelled_at = datetime.utcnow()
    header.cancel_note = note
    db.commit()
    db.refresh(header)
    return _correction_view(db, header)
