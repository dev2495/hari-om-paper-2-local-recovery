"""Customer delivery-schedule invariants (commercial calendar only).

This module does not schedule production segments or supplier receipts. Those
calendars stay separate. A whole-order commit may only write delivery-schedule
rows; it must not mutate release lots, started jobs, or locked/delivered rows.
"""

from __future__ import annotations

from datetime import date
from typing import Any, Iterable, Optional

ACTIVE_STATUSES = frozenset({"planned", "committed", "locked", "delivered"})
EDITABLE_STATUSES = frozenset({"planned", "committed"})
IMMUTABLE_STATUSES = frozenset({"locked", "delivered"})
CANCELLED_STATUS = "cancelled"


class SchedulePolicyError(ValueError):
    def __init__(self, message: str, *, code: str, field: Optional[str] = None, line_id: Optional[str] = None):
        super().__init__(message)
        self.code = code
        self.field = field
        self.line_id = line_id
        self.message = message

    def as_dict(self) -> dict[str, Any]:
        payload = {"code": self.code, "message": self.message}
        if self.field:
            payload["field"] = self.field
        if self.line_id:
            payload["line_id"] = self.line_id
        return payload


def _qty(value: Any) -> float:
    return round(float(value or 0.0), 4)


def _status(value: Any) -> str:
    return str(value or "").strip().lower()


def is_active_status(status: Any) -> bool:
    return _status(status) in ACTIVE_STATUSES


def is_immutable_status(status: Any) -> bool:
    return _status(status) in IMMUTABLE_STATUSES


def active_schedule_qty(schedules: Iterable[Any]) -> float:
    return round(sum(_qty(getattr(row, "quantity", None) or (row.get("quantity") if isinstance(row, dict) else 0))
                     for row in schedules if is_active_status(_row_status(row))), 4)


def _row_status(row: Any) -> str:
    if isinstance(row, dict):
        return _status(row.get("status"))
    return _status(getattr(row, "status", None))


def _row_qty(row: Any) -> float:
    if isinstance(row, dict):
        return _qty(row.get("quantity"))
    return _qty(getattr(row, "quantity", None))


def delivered_schedule_qty(schedules: Iterable[Any]) -> float:
    return round(sum(_row_qty(row) for row in schedules if _row_status(row) == "delivered"), 4)


def fulfilled_unscheduled_qty(line: Any, schedules: Iterable[Any]) -> float:
    fulfilled = _qty(getattr(line, "fulfilled_qty", 0))
    delivered = delivered_schedule_qty(schedules)
    return round(max(0.0, fulfilled - delivered), 4)


def remaining_to_schedule(line: Any, schedules: Iterable[Any]) -> float:
    """Quantity still free for new/edited call-offs.

    Caps by ordered qty. Subtracts active schedules and any fulfilled quantity
    that is not already represented as a delivered schedule row, so historical
    dispatches without call-off rows cannot be double-promised.
    """
    ordered = _qty(getattr(line, "qty", 0))
    active = active_schedule_qty(schedules)
    extra_fulfilled = fulfilled_unscheduled_qty(line, schedules)
    return round(max(0.0, ordered - active - extra_fulfilled), 4)


def allocatable_line_qty(line: Any) -> float:
    return _qty(getattr(line, "qty", 0))


def validate_active_sum(line: Any, schedules: Iterable[Any]) -> None:
    total = active_schedule_qty(schedules)
    cap = allocatable_line_qty(line)
    if total - cap > 1e-9:
        raise SchedulePolicyError(
            f"Active delivery allocations {total} exceed allocatable line quantity {cap}.",
            code="OVER_ALLOCATED",
            field="quantity",
            line_id=str(getattr(line, "id", "") or ""),
        )


def assert_row_mutable(existing: Any) -> None:
    if existing is None:
        return
    if is_immutable_status(_row_status(existing)):
        if isinstance(existing, dict):
            line_id = str(existing.get("line_id") or "")
        else:
            line_id = str(getattr(existing, "sales_order_line_id", "") or "")
        raise SchedulePolicyError(
            "Delivered or locked delivery-schedule rows cannot be mutated.",
            code="IMMUTABLE_SCHEDULE_ROW",
            field="status",
            line_id=line_id,
        )


def merge_line_schedules(
    *,
    line: Any,
    existing: list[Any],
    proposed: list[dict[str, Any]],
    default_status: str = "committed",
) -> list[dict[str, Any]]:
    """Replace editable rows, keep immutable ones, validate the resulting set."""
    immutable = []
    editable_ids = set()
    for row in existing:
        status = _row_status(row)
        row_id = str(getattr(row, "id", "") or "")
        if status == CANCELLED_STATUS:
            continue
        if is_immutable_status(status):
            immutable.append(
                {
                    "id": row_id,
                    "line_id": str(getattr(row, "sales_order_line_id", getattr(line, "id", ""))),
                    "delivery_date": getattr(row, "delivery_date", None),
                    "quantity": _row_qty(row),
                    "status": status,
                    "revision": int(getattr(row, "revision", 1) or 1),
                    "plant_id": str(getattr(row, "plant_id", "") or ""),
                    "immutable": True,
                }
            )
        elif is_active_status(status):
            editable_ids.add(row_id)

    merged = list(immutable)
    for item in proposed:
        row_id = str(item.get("id") or "").strip()
        status = _status(item.get("status") or default_status)
        if status == CANCELLED_STATUS:
            continue
        if row_id:
            existing_row = next((row for row in existing if str(getattr(row, "id", "")) == row_id), None)
            if existing_row is not None:
                assert_row_mutable(existing_row)
        qty = _qty(item.get("quantity"))
        if qty <= 0:
            raise SchedulePolicyError(
                "Delivery-schedule quantity must be greater than zero.",
                code="INVALID_QUANTITY",
                field="quantity",
                line_id=str(getattr(line, "id", "")),
            )
        delivery_date = item.get("delivery_date")
        if delivery_date is None:
            raise SchedulePolicyError(
                "Delivery-schedule date is required.",
                code="MISSING_DATE",
                field="delivery_date",
                line_id=str(getattr(line, "id", "")),
            )
        if status not in ACTIVE_STATUSES:
            raise SchedulePolicyError(
                f"Unsupported delivery-schedule status '{status}'.",
                code="INVALID_STATUS",
                field="status",
                line_id=str(getattr(line, "id", "")),
            )
        if is_immutable_status(status) and not row_id:
            raise SchedulePolicyError(
                "New rows cannot be created as locked or delivered.",
                code="INVALID_STATUS",
                field="status",
                line_id=str(getattr(line, "id", "")),
            )
        merged.append(
            {
                "id": row_id or None,
                "line_id": str(getattr(line, "id", "")),
                "delivery_date": delivery_date,
                "quantity": qty,
                "status": status,
                "replace_editable": True,
                "immutable": False,
            }
        )

    validate_active_sum(line, merged)
    return merged


def propose_entire_po_rows(
    lines: Iterable[Any],
    *,
    default_date: Optional[date] = None,
    line_splits: Optional[dict[str, list[dict[str, Any]]]] = None,
) -> list[dict[str, Any]]:
    """Propose remaining unscheduled quantity for every eligible line.

    Existing locked/delivered rows and release lots are left untouched. Only
    remaining-to-schedule quantity is allocated.
    """
    proposed: list[dict[str, Any]] = []
    splits = line_splits or {}
    for line in lines:
        existing = list(getattr(line, "delivery_schedules", []) or [])
        remaining = remaining_to_schedule(line, existing)
        line_id = str(getattr(line, "id", ""))
        custom = splits.get(line_id) or splits.get(getattr(line, "id", None))
        if custom:
            qty_sum = round(sum(_qty(item.get("quantity")) for item in custom), 4)
            if qty_sum - remaining > 1e-9:
                raise SchedulePolicyError(
                    f"Line splits {qty_sum} exceed remaining-to-schedule {remaining}.",
                    code="OVER_ALLOCATED",
                    field="quantity",
                    line_id=line_id,
                )
            for item in custom:
                proposed.append(
                    {
                        "line_id": line_id,
                        "delivery_date": item.get("delivery_date") or default_date or getattr(line, "due_date", None),
                        "quantity": _qty(item.get("quantity")),
                        "status": _status(item.get("status") or "committed"),
                    }
                )
            continue
        if remaining <= 0:
            continue
        proposed.append(
            {
                "line_id": line_id,
                "delivery_date": default_date or getattr(line, "due_date", None),
                "quantity": remaining,
                "status": "committed",
            }
        )
    return proposed


def validate_schedule_to_release_allocations(
    allocations: list[dict[str, Any]],
    *,
    schedule_qty_by_id: dict[str, float],
    lot_qty_by_id: dict[str, float],
) -> None:
    """Sums of allocations cannot exceed either parent; pairs cannot duplicate."""
    seen_pairs: set[tuple[str, str]] = set()
    by_schedule: dict[str, float] = {}
    by_lot: dict[str, float] = {}
    for item in allocations:
        schedule_id = str(item.get("delivery_schedule_id") or "").strip()
        lot_id = str(item.get("release_lot_id") or "").strip()
        qty = _qty(item.get("quantity"))
        if not schedule_id or not lot_id:
            raise SchedulePolicyError(
                "Schedule-to-release allocations need both parent ids.",
                code="ALLOCATION_IDENTITY",
            )
        if qty <= 0:
            raise SchedulePolicyError(
                "Allocation quantity must be greater than zero.",
                code="INVALID_QUANTITY",
                field="quantity",
            )
        pair = (schedule_id, lot_id)
        if pair in seen_pairs:
            raise SchedulePolicyError(
                "Duplicate demand: the same delivery row cannot allocate twice to one release lot.",
                code="DUPLICATE_ALLOCATION",
            )
        seen_pairs.add(pair)
        by_schedule[schedule_id] = round(by_schedule.get(schedule_id, 0.0) + qty, 4)
        by_lot[lot_id] = round(by_lot.get(lot_id, 0.0) + qty, 4)

    for schedule_id, total in by_schedule.items():
        cap = _qty(schedule_qty_by_id.get(schedule_id))
        if schedule_id not in schedule_qty_by_id:
            raise SchedulePolicyError(
                f"Unknown delivery-schedule parent {schedule_id}.",
                code="UNKNOWN_SCHEDULE",
            )
        if total - cap > 1e-9:
            raise SchedulePolicyError(
                f"Allocations {total} exceed delivery-schedule quantity {cap}.",
                code="ALLOCATION_EXCEEDS_SCHEDULE",
            )
    for lot_id, total in by_lot.items():
        cap = _qty(lot_qty_by_id.get(lot_id))
        if lot_id not in lot_qty_by_id:
            raise SchedulePolicyError(
                f"Unknown release-lot parent {lot_id}.",
                code="UNKNOWN_RELEASE_LOT",
            )
        if total - cap > 1e-9:
            raise SchedulePolicyError(
                f"Allocations {total} exceed release-lot quantity {cap}.",
                code="ALLOCATION_EXCEEDS_LOT",
            )


def serialize_release_lots_preserved(line: Any) -> list[dict[str, Any]]:
    lots = []
    for lot in getattr(line, "release_lots", []) or []:
        if str(getattr(lot, "status", "") or "").lower() == "cancelled":
            continue
        lots.append(
            {
                "id": str(getattr(lot, "id", "")),
                "released_qty": _qty(getattr(lot, "released_qty", 0)),
                "job_card_id": str(getattr(lot, "job_card_id", "") or "") or None,
                "status": str(getattr(lot, "status", "") or "released"),
                "winder_machine_id": str(getattr(lot, "winder_machine_id", "") or "") or None,
            }
        )
    return lots
