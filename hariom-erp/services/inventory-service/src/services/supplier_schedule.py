"""Supplier delivery schedule allocations on the existing purchase/GRN path.

A calendar row is a commitment, not a stock transaction. Receipt replay must
not insert a second allocation for the same receipt line.
"""
from __future__ import annotations

from datetime import date
from typing import Any, Optional
import uuid
import math

from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..models import (
    PurchaseLineSchedule,
    PurchaseOrderLine,
    PurchaseReceiptLine,
    ReceiptScheduleAllocation,
)


def _qty(value: Any) -> float:
    return float(value or 0.0)


def allocated_qty_for_schedule(db: Session, schedule_id: uuid.UUID) -> float:
    rows = (
        db.query(ReceiptScheduleAllocation)
        .filter(ReceiptScheduleAllocation.schedule_id == schedule_id)
        .all()
    )
    return round(sum(_qty(row.allocated_qty) for row in rows), 6)


def allocated_qty_for_receipt_line(db: Session, receipt_line_id: uuid.UUID) -> float:
    rows = (
        db.query(ReceiptScheduleAllocation)
        .filter(ReceiptScheduleAllocation.receipt_line_id == receipt_line_id)
        .all()
    )
    return round(sum(_qty(row.allocated_qty) for row in rows), 6)


def serialize_schedule(schedule: PurchaseLineSchedule, db: Session) -> dict[str, Any]:
    allocated = allocated_qty_for_schedule(db, schedule.id)
    ordered = _qty(schedule.order_line.qty_ordered) if schedule.order_line else 0.0
    received = _qty(schedule.order_line.qty_received) if schedule.order_line else 0.0
    return {
        "id": str(schedule.id),
        "purchase_order_line_id": str(schedule.purchase_order_line_id),
        "purchase_order_id": str(schedule.order_line.purchase_order_id) if schedule.order_line else None,
        "po_no": schedule.order_line.order.po_no if schedule.order_line and schedule.order_line.order else None,
        "item_id": str(schedule.order_line.item_id) if schedule.order_line else None,
        "item_code": schedule.order_line.item.item_code if schedule.order_line and schedule.order_line.item else None,
        "scheduled_qty": _qty(schedule.scheduled_qty),
        "allocated_qty": allocated,
        "remaining_qty": round(max(0.0, _qty(schedule.scheduled_qty) - allocated - _qty(schedule.cancelled_qty)), 6),
        "po_line_remaining_qty": round(max(0.0, ordered - received - _qty(getattr(schedule.order_line, "qty_short_closed", 0))), 6),
        "promised_date": schedule.promised_date.isoformat() if schedule.promised_date else None,
        "current_date": schedule.current_date.isoformat() if schedule.current_date else None,
        "confirmation_status": schedule.confirmation_status,
        "notes": schedule.notes,
        "ledger": False,
        "version": schedule.version,
        "change_history": schedule.change_history or [],
        "cancelled_qty": _qty(schedule.cancelled_qty),
    }


def active_scheduled_qty(db: Session, po_line_id: uuid.UUID, exclude_id: Optional[uuid.UUID] = None) -> float:
    query = db.query(PurchaseLineSchedule).filter(
        PurchaseLineSchedule.purchase_order_line_id == po_line_id,
        PurchaseLineSchedule.confirmation_status != "CANCELLED",
    )
    if exclude_id:
        query = query.filter(PurchaseLineSchedule.id != exclude_id)
    return round(sum(max(0, _qty(row.scheduled_qty) - _qty(row.cancelled_qty) - allocated_qty_for_schedule(db, row.id)) for row in query.all()), 6)


def allocate_receipt_to_schedule(
    db: Session,
    *,
    plant_id: str,
    receipt_line: PurchaseReceiptLine,
    schedule: PurchaseLineSchedule,
    qty: float,
) -> tuple[ReceiptScheduleAllocation, bool]:
    if schedule.confirmation_status == "CANCELLED":
        raise HTTPException(status_code=409, detail="Cannot allocate a receipt to a cancelled schedule row")
    if str(receipt_line.purchase_order_line_id) != str(schedule.purchase_order_line_id):
        raise HTTPException(status_code=409, detail="Schedule row does not belong to this purchase line")

    # Lock the receipt owner before measuring its unallocated quantity.
    db.query(PurchaseReceiptLine).filter(PurchaseReceiptLine.id == receipt_line.id).with_for_update().one()
    db.query(PurchaseLineSchedule).filter(PurchaseLineSchedule.id == schedule.id).with_for_update().one()
    if qty <= 0 or not math.isfinite(qty):
        raise HTTPException(status_code=400, detail="Allocation quantity must be positive and finite")
    if str(schedule.plant_id) != str(plant_id) or str(receipt_line.receipt.plant_id) != str(plant_id):
        raise HTTPException(status_code=404, detail="Schedule or receipt not found")
    existing = (
        db.query(ReceiptScheduleAllocation)
        .filter(ReceiptScheduleAllocation.receipt_line_id == receipt_line.id, ReceiptScheduleAllocation.schedule_id == schedule.id)
        .first()
    )
    if existing:
        same_schedule = str(existing.schedule_id) == str(schedule.id)
        same_qty = abs(_qty(existing.allocated_qty) - _qty(qty)) <= 1e-9
        if same_schedule and same_qty:
            return existing, True
        raise HTTPException(
            status_code=409,
            detail="Receipt replay cannot allocate twice. This receipt line already has a schedule allocation.",
        )

    remaining_schedule = _qty(schedule.scheduled_qty) - allocated_qty_for_schedule(db, schedule.id)
    remaining_receipt = _qty(receipt_line.qty_received) - allocated_qty_for_receipt_line(db, receipt_line.id)
    if qty > remaining_schedule + 1e-9:
        raise HTTPException(status_code=400, detail="Allocated quantity exceeds remaining scheduled quantity")
    if qty > remaining_receipt + 1e-9:
        raise HTTPException(status_code=400, detail="Allocated quantity exceeds unallocated receipt quantity")

    allocation = ReceiptScheduleAllocation(
        plant_id=plant_id,
        receipt_line_id=receipt_line.id,
        schedule_id=schedule.id,
        allocated_qty=qty,
    )
    db.add(allocation)
    try:
        db.flush()
    except IntegrityError as exc:
        raise HTTPException(status_code=409, detail="Receipt replay cannot allocate twice") from exc
    return allocation, False
