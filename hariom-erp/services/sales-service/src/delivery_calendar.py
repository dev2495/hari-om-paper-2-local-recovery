"""Portfolio delivery calendar: every in-scope order's customer commitments by day.

Read-only. Two kinds of entries land on a day:

* ``call_off``  — a persisted delivery schedule row (planned/committed/locked/delivered).
* ``unscheduled`` — line quantity with no call-off yet, placed on the line's earliest
  pending delivery date so demand never disappears from the calendar just because
  nobody has split it into call-offs.

Overdue means a call-off (or unscheduled demand) dated before plant-today that has
not been delivered. Totals are computed over the whole in-scope portfolio, not the
visible window, so the overdue banner is honest.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date, timedelta
from typing import Any, Iterable, Optional

from .schedule_policy import ACTIVE_STATUSES, earliest_pending_delivery, remaining_to_schedule

MAX_WINDOW_DAYS = 100


def _status(value: Any) -> str:
    return str(getattr(value, "value", value) or "").strip().lower()


def _order_ref(order: Any) -> str:
    return str(order.po_number or order.order_no or str(order.id)[:8])


def _line_progress(line: Any) -> dict[str, float]:
    qty = float(line.qty or 0.0)
    fulfilled = float(line.fulfilled_qty or 0.0)
    return {"ordered_qty": round(qty, 2), "fulfilled_qty": round(fulfilled, 2), "outstanding_qty": round(max(0.0, qty - fulfilled), 2)}


def _base_entry(order: Any, line: Any) -> dict[str, Any]:
    return {
        "order_id": str(order.id),
        "order_no": order.order_no,
        "order_ref": _order_ref(order),
        "po_number": order.po_number,
        "customer_id": str(order.customer_id) if order.customer_id else None,
        "plant_id": str(order.plant_id) if order.plant_id else None,
        "order_status": _status(order.status),
        "line_id": str(line.id),
        "line_no": int(line.line_no or 1),
        "product_code": line.product_code,
        **_line_progress(line),
    }


def build_delivery_calendar(
    orders: Iterable[Any],
    *,
    start: date,
    end: date,
    today: date,
    customer_id: Optional[str] = None,
    search: Optional[str] = None,
) -> dict[str, Any]:
    if end < start:
        start, end = end, start
    if (end - start).days > MAX_WINDOW_DAYS:
        end = start + timedelta(days=MAX_WINDOW_DAYS)
    needle = (search or "").strip().lower()

    days: dict[str, list[dict[str, Any]]] = defaultdict(list)
    overdue_entries: list[dict[str, Any]] = []
    unscheduled_lines: list[dict[str, Any]] = []
    order_ids_in_window: set[str] = set()
    totals = {"call_off_qty": 0.0, "delivered_qty": 0.0, "unscheduled_qty": 0.0, "overdue_qty": 0.0}

    for order in orders:
        if customer_id and str(order.customer_id) != customer_id:
            continue
        if needle:
            haystack = " ".join(
                str(part or "") for part in (order.po_number, order.order_no, *(line.product_code for line in order.lines or []))
            ).lower()
            if needle not in haystack:
                continue
        for line in order.lines or []:
            schedules = list(getattr(line, "delivery_schedules", []) or [])
            for row in schedules:
                status = _status(row.status)
                if status not in ACTIVE_STATUSES or not row.delivery_date:
                    continue
                delivered = status == "delivered"
                overdue = not delivered and row.delivery_date < today
                entry = {
                    **_base_entry(order, line),
                    "id": str(row.id),
                    "kind": "call_off",
                    "delivery_date": row.delivery_date.isoformat(),
                    "quantity": round(float(row.quantity or 0.0), 2),
                    "status": status,
                    "locked": status in {"locked", "delivered"},
                    "delivered": delivered,
                    "overdue": overdue,
                    "revision": int(row.revision or 1),
                }
                if overdue:
                    totals["overdue_qty"] += entry["quantity"]
                    overdue_entries.append(entry)
                if start <= row.delivery_date <= end:
                    days[entry["delivery_date"]].append(entry)
                    order_ids_in_window.add(entry["order_id"])
                    totals["call_off_qty"] += entry["quantity"]
                    if delivered:
                        totals["delivered_qty"] += entry["quantity"]

            remaining = remaining_to_schedule(line, schedules)
            if remaining <= 1e-9:
                continue
            due = getattr(line, "due_date", None) or earliest_pending_delivery(line)
            if isinstance(due, str):
                due = date.fromisoformat(due[:10])
            entry = {
                **_base_entry(order, line),
                "id": f"unscheduled:{line.id}",
                "kind": "unscheduled",
                "delivery_date": due.isoformat() if due else None,
                "quantity": round(remaining, 2),
                "status": "unscheduled",
                "locked": False,
                "delivered": False,
                "overdue": bool(due and due < today),
                "revision": None,
            }
            unscheduled_lines.append(entry)
            totals["unscheduled_qty"] += entry["quantity"]
            if entry["overdue"]:
                totals["overdue_qty"] += entry["quantity"]
                overdue_entries.append(entry)
            if due and start <= due <= end:
                days[entry["delivery_date"]].append(entry)
                order_ids_in_window.add(entry["order_id"])

    day_rows = []
    cursor = start
    while cursor <= end:
        key = cursor.isoformat()
        entries = sorted(days.get(key, []), key=lambda item: (item["kind"] != "call_off", item["order_ref"], item["line_no"]))
        day_rows.append(
            {
                "date": key,
                "entries": entries,
                "total_qty": round(sum(item["quantity"] for item in entries), 2),
                "order_count": len({item["order_id"] for item in entries}),
                "overdue": any(item["overdue"] for item in entries),
            }
        )
        cursor += timedelta(days=1)

    overdue_entries.sort(key=lambda item: (item["delivery_date"] or "", item["order_ref"]))
    unscheduled_lines.sort(key=lambda item: (item["delivery_date"] or "9999", item["order_ref"]))
    return {
        "plant_today": today.isoformat(),
        "start": start.isoformat(),
        "end": end.isoformat(),
        "days": day_rows,
        "overdue": overdue_entries[:200],
        "unscheduled": unscheduled_lines[:200],
        "summary": {
            "orders_in_window": len(order_ids_in_window),
            "call_off_qty": round(totals["call_off_qty"], 2),
            "delivered_qty": round(totals["delivered_qty"], 2),
            "unscheduled_qty": round(totals["unscheduled_qty"], 2),
            "overdue_qty": round(totals["overdue_qty"], 2),
            "overdue_count": len(overdue_entries),
            "unscheduled_count": len(unscheduled_lines),
        },
    }
