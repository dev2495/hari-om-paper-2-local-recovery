"""Preview/commit persistence for customer delivery schedules."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Any, Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session, joinedload

from .models import (
    SalesOrder,
    SalesOrderDeliverySchedule,
    SalesOrderLine,
    SalesOrderReleaseLot,
    SalesOrderScheduleAllocation,
)
from .schedule_policy import (
    EDITABLE_STATUSES,
    SchedulePolicyError,
    assert_row_mutable,
    is_immutable_status,
    merge_line_schedules,
    propose_entire_po_rows,
    remaining_to_schedule,
    serialize_release_lots_preserved,
    validate_schedule_to_release_allocations,
)
from .utils.auth import apply_plant_scope


def _line_map(order: SalesOrder) -> dict[str, SalesOrderLine]:
    return {str(line.id): line for line in order.lines or []}


def load_order_for_schedule(db: Session, order_id: uuid.UUID, plant_scope: dict) -> SalesOrder:
    query = apply_plant_scope(
        db.query(SalesOrder)
        .options(
            joinedload(SalesOrder.lines).joinedload(SalesOrderLine.release_lots),
            joinedload(SalesOrder.lines).joinedload(SalesOrderLine.delivery_schedules),
        )
        .filter(SalesOrder.id == order_id),
        SalesOrder.plant_id,
        plant_scope,
    )
    order = query.first()
    if not order:
        raise HTTPException(status_code=404, detail="Sales order not found")
    return order


def serialize_schedule_row(row: SalesOrderDeliverySchedule) -> dict[str, Any]:
    return {
        "id": str(row.id),
        "order_id": str(row.sales_order_id),
        "line_id": str(row.sales_order_line_id),
        "plant_id": str(row.plant_id),
        "delivery_date": row.delivery_date.isoformat() if row.delivery_date else None,
        "quantity": round(float(row.quantity or 0.0), 4),
        "status": row.status,
        "revision": int(row.revision or 1),
        "immutable": is_immutable_status(row.status),
        "created_by": row.created_by,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "allocations": [
            {
                "id": str(alloc.id),
                "delivery_schedule_id": str(alloc.delivery_schedule_id),
                "release_lot_id": str(alloc.release_lot_id),
                "quantity": round(float(alloc.quantity or 0.0), 4),
            }
            for alloc in getattr(row, "allocations", []) or []
        ],
    }


def list_order_schedules(order: SalesOrder) -> dict[str, Any]:
    rows = []
    for line in sorted(order.lines or [], key=lambda item: int(item.line_no or 1)):
        for row in sorted(getattr(line, "delivery_schedules", []) or [], key=lambda item: (item.delivery_date or date.max, str(item.id))):
            rows.append(serialize_schedule_row(row))
    return {
        "order_id": str(order.id),
        "schedule_revision": int(order.schedule_revision or 0),
        "calendar": "customer_delivery",
        "items": rows,
        "lines": [
            {
                "line_id": str(line.id),
                "line_no": int(line.line_no or 1),
                "product_code": line.product_code,
                "qty": float(line.qty or 0.0),
                "fulfilled_qty": float(line.fulfilled_qty or 0.0),
                "remaining_to_schedule_qty": remaining_to_schedule(line, getattr(line, "delivery_schedules", []) or []),
                "release_lots": serialize_release_lots_preserved(line),
            }
            for line in sorted(order.lines or [], key=lambda item: int(item.line_no or 1))
        ],
    }


def _as_date(value: Any) -> date:
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    text = str(value or "").strip()[:10]
    return date.fromisoformat(text)


def preview_line_schedules(
    order: SalesOrder,
    proposed_by_line: dict[str, list[dict[str, Any]]],
    *,
    default_status: str = "committed",
) -> dict[str, Any]:
    lines = _line_map(order)
    errors = []
    proposed_rows = []
    preserved_lots = []
    for line_id, payload_rows in proposed_by_line.items():
        line = lines.get(str(line_id))
        if line is None:
            errors.append({"code": "UNKNOWN_LINE", "line_id": str(line_id), "message": "Line is not on this order."})
            continue
        preserved_lots.extend(serialize_release_lots_preserved(line))
        try:
            merged = merge_line_schedules(
                line=line,
                existing=list(getattr(line, "delivery_schedules", []) or []),
                proposed=[{**row, "delivery_date": _as_date(row.get("delivery_date"))} for row in payload_rows],
                default_status=default_status,
            )
            proposed_rows.extend(merged)
        except SchedulePolicyError as exc:
            errors.append(exc.as_dict())

    return {
        "order_id": str(order.id),
        "schedule_revision": int(order.schedule_revision or 0),
        "calendar": "customer_delivery",
        "valid": not errors,
        "errors": errors,
        "proposed_rows": proposed_rows,
        "preserved_release_lots": preserved_lots,
        "unscheduled_remainder": [
            {
                "line_id": str(line.id),
                "remaining_to_schedule_qty": remaining_to_schedule(
                    line,
                    [row for row in proposed_rows if str(row.get("line_id")) == str(line.id)]
                    or list(getattr(line, "delivery_schedules", []) or []),
                ),
            }
            for line in order.lines or []
        ],
    }


def preview_entire_po(
    order: SalesOrder,
    *,
    default_date: Optional[date] = None,
    line_splits: Optional[dict[str, list[dict[str, Any]]]] = None,
) -> dict[str, Any]:
    try:
        proposed = propose_entire_po_rows(order.lines or [], default_date=default_date, line_splits=line_splits)
    except SchedulePolicyError as exc:
        return {
            "order_id": str(order.id),
            "schedule_revision": int(order.schedule_revision or 0),
            "calendar": "customer_delivery",
            "valid": False,
            "errors": [exc.as_dict()],
            "proposed_rows": [],
            "preserved_release_lots": [
                lot for line in order.lines or [] for lot in serialize_release_lots_preserved(line)
            ],
            "action": "schedule_entire_po",
        }
    grouped: dict[str, list[dict[str, Any]]] = {}
    for row in proposed:
        grouped.setdefault(str(row["line_id"]), []).append(row)
    payload = preview_line_schedules(order, grouped)
    payload["action"] = "schedule_entire_po"
    payload["default_date"] = default_date.isoformat() if default_date else None
    return payload


def _replace_editable_rows(
    db: Session,
    *,
    order: SalesOrder,
    line: SalesOrderLine,
    proposed: list[dict[str, Any]],
    actor: str,
    revision: int,
) -> list[SalesOrderDeliverySchedule]:
    existing = list(getattr(line, "delivery_schedules", []) or [])
    for row in existing:
        if str(row.status or "").lower() in EDITABLE_STATUSES:
            db.delete(row)
    db.flush()
    created = []
    for item in proposed:
        if item.get("immutable"):
            continue
        row = SalesOrderDeliverySchedule(
            id=uuid.UUID(item["id"]) if item.get("id") else uuid.uuid4(),
            sales_order_id=order.id,
            sales_order_line_id=line.id,
            plant_id=str(order.plant_id),
            delivery_date=_as_date(item.get("delivery_date")),
            quantity=float(item.get("quantity") or 0.0),
            status=str(item.get("status") or "committed"),
            revision=revision,
            created_by=actor,
        )
        db.add(row)
        created.append(row)
    return created


def commit_line_schedules(
    db: Session,
    *,
    order: SalesOrder,
    proposed_by_line: dict[str, list[dict[str, Any]]],
    expected_revision: int,
    actor: str,
    allocations: Optional[list[dict[str, Any]]] = None,
) -> dict[str, Any]:
    current_revision = int(order.schedule_revision or 0)
    if int(expected_revision) != current_revision:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "STALE_PREVIEW",
                "message": "Schedule revision changed since preview. Reload and review again.",
                "current_revision": current_revision,
            },
        )
    preview = preview_line_schedules(order, proposed_by_line)
    if not preview["valid"]:
        raise HTTPException(status_code=400, detail={"code": "SCHEDULE_REJECTED", "errors": preview["errors"]})

    next_revision = current_revision + 1
    lines = _line_map(order)
    for line_id, payload_rows in proposed_by_line.items():
        line = lines[str(line_id)]
        merged = merge_line_schedules(
            line=line,
            existing=list(getattr(line, "delivery_schedules", []) or []),
            proposed=[{**row, "delivery_date": _as_date(row.get("delivery_date"))} for row in payload_rows],
        )
        _replace_editable_rows(db, order=order, line=line, proposed=merged, actor=actor, revision=next_revision)

    if allocations:
        db.flush()
        schedule_qty = {
            str(row.id): float(row.quantity or 0.0)
            for line in order.lines or []
            for row in getattr(line, "delivery_schedules", []) or []
        }
        # Newly added rows are in the session; refresh qty map after flush.
        db.flush()
        schedule_qty = {
            str(row.id): float(row.quantity or 0.0)
            for line in order.lines or []
            for row in db.query(SalesOrderDeliverySchedule).filter(SalesOrderDeliverySchedule.sales_order_line_id == line.id)
        }
        lot_qty = {
            str(lot.id): float(lot.released_qty or 0.0)
            for line in order.lines or []
            for lot in getattr(line, "release_lots", []) or []
            if str(lot.status or "").lower() != "cancelled"
        }
        try:
            validate_schedule_to_release_allocations(
                allocations, schedule_qty_by_id=schedule_qty, lot_qty_by_id=lot_qty
            )
        except SchedulePolicyError as exc:
            raise HTTPException(status_code=400, detail=exc.as_dict()) from exc
        for item in allocations:
            db.add(
                SalesOrderScheduleAllocation(
                    delivery_schedule_id=uuid.UUID(str(item["delivery_schedule_id"])),
                    release_lot_id=uuid.UUID(str(item["release_lot_id"])),
                    quantity=float(item["quantity"]),
                )
            )

    order.schedule_revision = next_revision
    db.commit()
    db.refresh(order)
    order = (
        db.query(SalesOrder)
        .options(
            joinedload(SalesOrder.lines).joinedload(SalesOrderLine.release_lots),
            joinedload(SalesOrder.lines).joinedload(SalesOrderLine.delivery_schedules),
        )
        .filter(SalesOrder.id == order.id)
        .first()
    )
    result = list_order_schedules(order)
    result["preserved_release_lots"] = [
        lot for line in order.lines or [] for lot in serialize_release_lots_preserved(line)
    ]
    result["message"] = "Customer delivery schedule committed. Release lots and started work were not modified."
    return result


def commit_entire_po(
    db: Session,
    *,
    order: SalesOrder,
    expected_revision: int,
    actor: str,
    default_date: Optional[date] = None,
    line_splits: Optional[dict[str, list[dict[str, Any]]]] = None,
) -> dict[str, Any]:
    preview = preview_entire_po(order, default_date=default_date, line_splits=line_splits)
    if not preview["valid"]:
        raise HTTPException(status_code=400, detail={"code": "SCHEDULE_REJECTED", "errors": preview["errors"]})
    grouped: dict[str, list[dict[str, Any]]] = {}
    for row in preview.get("proposed_rows") or []:
        if row.get("immutable"):
            continue
        grouped.setdefault(str(row["line_id"]), []).append(row)
    return commit_line_schedules(
        db,
        order=order,
        proposed_by_line=grouped,
        expected_revision=expected_revision,
        actor=actor,
    )


def mutate_schedule_row(
    db: Session,
    *,
    order: SalesOrder,
    schedule_id: uuid.UUID,
    updates: dict[str, Any],
    actor: str,
) -> dict[str, Any]:
    row = (
        db.query(SalesOrderDeliverySchedule)
        .filter(
            SalesOrderDeliverySchedule.id == schedule_id,
            SalesOrderDeliverySchedule.sales_order_id == order.id,
        )
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Delivery schedule row not found")
    try:
        assert_row_mutable(row)
    except SchedulePolicyError as exc:
        raise HTTPException(status_code=409, detail=exc.as_dict()) from exc
    if "quantity" in updates and updates["quantity"] is not None:
        row.quantity = float(updates["quantity"])
    if "delivery_date" in updates and updates["delivery_date"] is not None:
        row.delivery_date = _as_date(updates["delivery_date"])
    if "status" in updates and updates["status"] is not None:
        status = str(updates["status"]).strip().lower()
        if is_immutable_status(row.status) or is_immutable_status(status) and status != row.status:
            # Allow planned/committed -> locked/delivered (lifecycle), but not reverse.
            if is_immutable_status(row.status):
                raise HTTPException(status_code=409, detail={"code": "IMMUTABLE_SCHEDULE_ROW", "message": "Delivered or locked rows cannot be mutated."})
        row.status = status
    row.updated_at = datetime.utcnow()
    line = next((item for item in order.lines or [] if item.id == row.sales_order_line_id), None)
    if line is not None:
        try:
            from .schedule_policy import validate_active_sum

            validate_active_sum(line, list(getattr(line, "delivery_schedules", []) or []))
        except SchedulePolicyError as exc:
            raise HTTPException(status_code=400, detail=exc.as_dict()) from exc
    order.schedule_revision = int(order.schedule_revision or 0) + 1
    db.commit()
    return serialize_schedule_row(row)
