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
from .commercial import SalesCommercialError, validate_delivery_after_customer_po_date
from .schedule_policy import (
    EDITABLE_STATUSES,
    PATCHABLE_STATUSES,
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


def load_order_for_schedule(
    db: Session, order_id: uuid.UUID, plant_scope: dict, *, lock: bool = False
) -> SalesOrder:
    query = apply_plant_scope(
        db.query(SalesOrder)
        .options(
            joinedload(SalesOrder.lines).joinedload(SalesOrderLine.release_lots),
            joinedload(SalesOrder.lines).joinedload(SalesOrderLine.delivery_schedules).joinedload(
                SalesOrderDeliverySchedule.allocations
            ),
        )
        .filter(SalesOrder.id == order_id),
        SalesOrder.plant_id,
        plant_scope,
    )
    if lock:
        query = query.with_for_update()
    order = query.first()
    if not order:
        raise HTTPException(status_code=404, detail="Sales order not found")
    return order


def _assert_delivery_date(order: SalesOrder, delivery_date: Any) -> None:
    try:
        validate_delivery_after_customer_po_date(
            delivery_date,
            getattr(order, "po_date", None),
            origin=getattr(order, "origin", None) or "customer_po",
        )
    except SalesCommercialError as exc:
        raise SchedulePolicyError(str(exc), code="INVALID_DATE", field="delivery_date") from exc


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
    mode: str = "replace",
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
            dated_rows = []
            for row in payload_rows:
                delivery_date = _as_date(row.get("delivery_date"))
                _assert_delivery_date(order, delivery_date)
                dated_rows.append({**row, "delivery_date": delivery_date})
            merged = merge_line_schedules(
                line=line,
                existing=list(getattr(line, "delivery_schedules", []) or []),
                proposed=dated_rows,
                default_status=default_status,
                mode=mode,
            )
            proposed_rows.extend(merged)
        except SchedulePolicyError as exc:
            errors.append(exc.as_dict())

    return {
        "order_id": str(order.id),
        "schedule_revision": int(order.schedule_revision or 0),
        "calendar": "customer_delivery",
        "calendar_note": "Customer call-off calendar only. Production segments and supplier receipts are separate ledgers.",
        "merge_mode": mode,
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
        if default_date is not None:
            _assert_delivery_date(order, default_date)
        proposed = propose_entire_po_rows(order.lines or [], default_date=default_date, line_splits=line_splits)
        for row in proposed:
            _assert_delivery_date(order, row.get("delivery_date"))
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
    payload = preview_line_schedules(order, grouped, mode="append")
    payload["action"] = "schedule_entire_po"
    payload["default_date"] = default_date.isoformat() if default_date else None
    return payload


def _apply_merged_rows(
    db: Session,
    *,
    order: SalesOrder,
    line: SalesOrderLine,
    proposed: list[dict[str, Any]],
    actor: str,
    revision: int,
    mode: str,
) -> list[SalesOrderDeliverySchedule]:
    existing = {str(row.id): row for row in list(getattr(line, "delivery_schedules", []) or [])}
    proposed_ids = {str(item.get("id")) for item in proposed if item.get("id")}
    if mode == "replace":
        for row in list(getattr(line, "delivery_schedules", []) or []):
            if str(row.status or "").lower() in EDITABLE_STATUSES and str(row.id) not in proposed_ids:
                db.delete(row)
        db.flush()
    applied = []
    for item in proposed:
        if item.get("immutable") or item.get("kept"):
            if item.get("id") and str(item["id"]) in existing:
                applied.append(existing[str(item["id"])])
            continue
        row_id = item.get("id")
        if row_id and str(row_id) in existing:
            row = existing[str(row_id)]
            assert_row_mutable(row)
            row.delivery_date = _as_date(item.get("delivery_date"))
            row.quantity = float(item.get("quantity") or 0.0)
            row.status = str(item.get("status") or "committed")
            row.revision = revision
            row.updated_at = datetime.utcnow()
            applied.append(row)
            continue
        row = SalesOrderDeliverySchedule(
            id=uuid.UUID(str(row_id)) if row_id else uuid.uuid4(),
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
        applied.append(row)
    return applied


def _allocation_parent_maps(order: SalesOrder) -> tuple[dict[str, Any], dict[str, Any]]:
    schedules = {}
    lots = {}
    for line in order.lines or []:
        for row in getattr(line, "delivery_schedules", []) or []:
            schedules[str(row.id)] = row
        for lot in getattr(line, "release_lots", []) or []:
            lots[str(lot.id)] = lot
    return schedules, lots


def _existing_allocation_payloads(order: SalesOrder) -> list[dict[str, Any]]:
    rows = []
    for line in order.lines or []:
        for schedule in getattr(line, "delivery_schedules", []) or []:
            for alloc in getattr(schedule, "allocations", []) or []:
                rows.append(
                    {
                        "delivery_schedule_id": str(alloc.delivery_schedule_id),
                        "release_lot_id": str(alloc.release_lot_id),
                        "quantity": float(alloc.quantity or 0.0),
                    }
                )
    return rows


def commit_line_schedules(
    db: Session,
    *,
    order: SalesOrder,
    proposed_by_line: dict[str, list[dict[str, Any]]],
    expected_revision: int,
    actor: str,
    allocations: Optional[list[dict[str, Any]]] = None,
    mode: str = "replace",
) -> dict[str, Any]:
    locked = (
        db.query(SalesOrder)
        .filter(SalesOrder.id == order.id)
        .with_for_update()
        .first()
    )
    if not locked:
        raise HTTPException(status_code=404, detail="Sales order not found")
    current_revision = int(locked.schedule_revision or 0)
    if int(expected_revision) != current_revision:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "STALE_PREVIEW",
                "message": "Schedule revision changed since preview. Reload and review again.",
                "current_revision": current_revision,
            },
        )
    db.refresh(order)
    preview = preview_line_schedules(order, proposed_by_line, mode=mode)
    if not preview["valid"]:
        raise HTTPException(status_code=400, detail={"code": "SCHEDULE_REJECTED", "errors": preview["errors"]})

    next_revision = current_revision + 1
    lines = _line_map(order)
    for line_id, payload_rows in proposed_by_line.items():
        line = lines[str(line_id)]
        dated_rows = []
        for row in payload_rows:
            delivery_date = _as_date(row.get("delivery_date"))
            try:
                _assert_delivery_date(order, delivery_date)
            except SchedulePolicyError as exc:
                raise HTTPException(status_code=400, detail=exc.as_dict()) from exc
            dated_rows.append({**row, "delivery_date": delivery_date})
        merged = merge_line_schedules(
            line=line,
            existing=list(getattr(line, "delivery_schedules", []) or []),
            proposed=dated_rows,
            mode=mode,
        )
        _apply_merged_rows(
            db, order=order, line=line, proposed=merged, actor=actor, revision=next_revision, mode=mode
        )

    db.flush()
    if allocations:
        schedule_rows, lot_rows = _allocation_parent_maps(order)
        for item in allocations:
            schedule = schedule_rows.get(str(item.get("delivery_schedule_id") or ""))
            lot = lot_rows.get(str(item.get("release_lot_id") or ""))
            if schedule is None or lot is None:
                raise HTTPException(
                    status_code=400,
                    detail={"code": "UNKNOWN_ALLOCATION_PARENT", "message": "Allocation parents must exist on this order."},
                )
            if str(schedule.sales_order_line_id) != str(lot.sales_order_line_id):
                raise HTTPException(
                    status_code=400,
                    detail={
                        "code": "INCOMPATIBLE_PARENTS",
                        "message": "A delivery row cannot allocate a release lot from another line or spec.",
                    },
                )
            if str(schedule.plant_id) != str(order.plant_id) or str(getattr(lot, "plant_id", order.plant_id) or order.plant_id) != str(order.plant_id):
                raise HTTPException(
                    status_code=400,
                    detail={"code": "INCOMPATIBLE_PARENTS", "message": "Allocations must stay on the order plant."},
                )
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
        combined = _existing_allocation_payloads(order) + [
            {
                "delivery_schedule_id": str(item["delivery_schedule_id"]),
                "release_lot_id": str(item["release_lot_id"]),
                "quantity": float(item["quantity"]),
            }
            for item in allocations
        ]
        try:
            validate_schedule_to_release_allocations(
                combined, schedule_qty_by_id=schedule_qty, lot_qty_by_id=lot_qty
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

    locked.schedule_revision = next_revision
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
    result["merge_mode"] = mode
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
        if row.get("immutable") or row.get("kept"):
            continue
        grouped.setdefault(str(row["line_id"]), []).append(row)
    return commit_line_schedules(
        db,
        order=order,
        proposed_by_line=grouped,
        expected_revision=expected_revision,
        actor=actor,
        mode="append",
    )


def mutate_schedule_row(
    db: Session,
    *,
    order: SalesOrder,
    schedule_id: uuid.UUID,
    updates: dict[str, Any],
    actor: str,
) -> dict[str, Any]:
    del actor
    locked = db.query(SalesOrder).filter(SalesOrder.id == order.id).with_for_update().first()
    if not locked:
        raise HTTPException(status_code=404, detail="Sales order not found")
    row = (
        db.query(SalesOrderDeliverySchedule)
        .filter(
            SalesOrderDeliverySchedule.id == schedule_id,
            SalesOrderDeliverySchedule.sales_order_id == order.id,
        )
        .with_for_update()
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
        delivery_date = _as_date(updates["delivery_date"])
        try:
            _assert_delivery_date(order, delivery_date)
        except SchedulePolicyError as exc:
            raise HTTPException(status_code=400, detail=exc.as_dict()) from exc
        row.delivery_date = delivery_date
    if "status" in updates and updates["status"] is not None:
        status = str(updates["status"]).strip().lower()
        if status == "delivered":
            raise HTTPException(
                status_code=400,
                detail={
                    "code": "INVALID_STATUS",
                    "message": "Delivered status is derived from authorized fulfillment, not a generic patch.",
                },
            )
        if status == "locked" and str(row.status or "").lower() in EDITABLE_STATUSES:
            row.status = "locked"
        elif status not in PATCHABLE_STATUSES:
            raise HTTPException(
                status_code=400,
                detail={"code": "INVALID_STATUS", "message": f"Unsupported delivery-schedule status '{status}'."},
            )
        else:
            row.status = status
    row.updated_at = datetime.utcnow()
    line = next((item for item in order.lines or [] if item.id == row.sales_order_line_id), None)
    if line is not None:
        try:
            from .schedule_policy import validate_active_sum

            validate_active_sum(line, list(getattr(line, "delivery_schedules", []) or []))
        except SchedulePolicyError as exc:
            raise HTTPException(status_code=400, detail=exc.as_dict()) from exc
    locked.schedule_revision = int(locked.schedule_revision or 0) + 1
    db.commit()
    return serialize_schedule_row(row)
