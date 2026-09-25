"""Server-backed all-pending-orders workspace (R17).

Totals, filters, sort, pagination and export run against the full in-scope set,
never the visible page. Production WIP/QC-held is an overlay from production;
inventory shortage and supplier calendars are explicitly unavailable here.
"""

from __future__ import annotations

import csv
import io
from datetime import date, datetime
from typing import Any, Optional
from uuid import UUID

from sqlalchemy.orm import Session, joinedload

from .due_risk import (
    DUE_RISK_OVERDUE,
    DUE_RISK_PRIORITY,
    classify_due_risk,
    due_risk_label,
    overdue_label,
    plant_today,
    priority_window,
    PLANT_TIMEZONE_NAME,
)
from .models import SalesOrder, SalesOrderLine, SalesOrderStatus
from .schedule_policy import active_schedule_qty, remaining_to_schedule, earliest_pending_delivery
from .utils.auth import apply_plant_scope

SORT_KEYS = {
    "due_date",
    "order_no",
    "outstanding_qty",
    "unreleased_qty",
    "created_at",
    "open_value",
}

PENDING_EXPORT_FIELDS = [
    "order_id",
    "order_no",
    "plant_id",
    "customer_id",
    "source",
    "po_number",
    "status",
    "line_id",
    "line_no",
    "product_code",
    "approved_spec_id",
    "parchment_color",
    "due_date",
    "due_risk",
    "ordered_qty",
    "fulfilled_qty",
    "outstanding_qty",
    "released_qty",
    "unreleased_qty",
    "scheduled_qty",
    "released_not_scheduled_qty",
    "remaining_to_schedule_qty",
    "rate_per_pc",
    "outstanding_value",
    "missing_schedule",
]


def infer_source(order: Any) -> str:
    """Prefer the persisted origin. Blank PO numbers are REVIEW, not guessed INTERNAL."""
    origin = str(getattr(order, "origin", "") or "").strip().upper()
    if origin in {"INTERNAL", "INTERNAL_SO", "INTERNAL-SO"}:
        return "internal"
    if origin in {"CUSTOMER_PO", "CUSTOMER-PO", "CUSTOMERPO", "PO", "CUSTOMER"}:
        return "customer_po"
    if origin in {"REVIEW", "ORIGIN_REVIEW", "UNKNOWN"}:
        return "review"
    if bool(getattr(order, "origin_review_required", False)):
        return "review"
    po = str(getattr(order, "po_number", "") or "").strip()
    if po:
        return "customer_po"
    return "review"


def _released_qty(line: Any) -> float:
    return round(
        sum(
            float(lot.released_qty or 0.0)
            for lot in getattr(line, "release_lots", []) or []
            if str(getattr(lot, "status", "") or "").lower() != "cancelled"
        ),
        4,
    )


def _schedules(line: Any) -> list[Any]:
    return list(getattr(line, "delivery_schedules", []) or [])


def serialize_pending_line(line: Any, order: Any, today: date) -> dict[str, Any]:
    qty = float(line.qty or 0.0)
    fulfilled = float(line.fulfilled_qty or 0.0)
    outstanding = max(0.0, qty - fulfilled)
    released = _released_qty(line)
    unreleased = max(0.0, qty - released)
    schedules = _schedules(line)
    scheduled = active_schedule_qty(schedules)
    remaining_schedule = remaining_to_schedule(line, schedules)
    rate = float(line.rate_per_pc or 0.0)
    due = earliest_pending_delivery(line)
    risk = classify_due_risk(due, today)
    missing = remaining_schedule > 1e-9
    return {
        "id": str(line.id),
        "line_id": str(line.id),
        "line_no": int(line.line_no or 1),
        "product_code": line.product_code,
        "approved_spec_id": str(line.approved_spec_id) if line.approved_spec_id else None,
        "parchment_color": line.parchment_color,
        "due_date": due.isoformat() if due else None,
        "due_risk": risk,
        "ordered_qty": round(qty, 2),
        "fulfilled_qty": round(fulfilled, 2),
        "outstanding_qty": round(outstanding, 2),
        "released_qty": round(released, 2),
        "unreleased_qty": round(unreleased, 2),
        "scheduled_qty": round(scheduled, 2),
        "released_not_scheduled_qty": round(max(0.0, released - scheduled), 2),
        "remaining_to_schedule_qty": round(remaining_schedule, 2),
        "rate_per_pc": round(rate, 4) if line.rate_per_pc is not None else None,
        "outstanding_value": round(outstanding * rate, 2),
        "missing_schedule": missing,
        "wip_qty": None,
        "qc_held_qty": None,
        "allocated_fg_qty": None,
        "coverage": {
            "wip": "unavailable",
            "qc_held": "unavailable",
            "allocated_fg": "unavailable",
            "material_shortage": "unavailable",
        },
    }


def serialize_pending_order(order: Any, today: date) -> dict[str, Any]:
    lines = [serialize_pending_line(line, order, today) for line in sorted(order.lines or [], key=lambda row: int(row.line_no or 1))]
    outstanding_qty = round(sum(line["outstanding_qty"] for line in lines), 2)
    unreleased_qty = round(sum(line["unreleased_qty"] for line in lines), 2)
    scheduled_qty = round(sum(line["scheduled_qty"] for line in lines), 2)
    outstanding_value = round(sum(line["outstanding_value"] for line in lines), 2)
    due_dates = [earliest_pending_delivery(line) for line in (order.lines or [])]
    due_dates = [value for value in due_dates if value]
    earliest = min(due_dates) if due_dates else None
    return {
        "id": str(order.id),
        "order_no": order.order_no,
        "plant_id": str(order.plant_id),
        "customer_id": str(order.customer_id),
        "source": infer_source(order),
        "po_number": order.po_number,
        "po_date": order.po_date.isoformat() if order.po_date else None,
        "status": order.status.value if hasattr(order.status, "value") else str(order.status),
        "created_at": order.created_at.isoformat() if order.created_at else None,
        "earliest_due": earliest.isoformat() if earliest else None,
        "due_risk": classify_due_risk(earliest, today),
        "line_count": len(lines),
        "outstanding_qty": outstanding_qty,
        "unreleased_qty": unreleased_qty,
        "scheduled_qty": scheduled_qty,
        "open_value": outstanding_value,
        "missing_schedule": any(line["missing_schedule"] for line in lines),
        "last_sync_state": "sales_only",
        "lines": lines,
    }


def line_matches_filters(line: dict[str, Any], filters: dict[str, Any]) -> bool:
    product = (filters.get("product") or "").strip().lower()
    if product:
        hay = " ".join(
            str(part or "")
            for part in (line.get("product_code"), line.get("parchment_color"), line.get("approved_spec_id"))
        ).lower()
        if product not in hay:
            return False
    due_from = filters.get("due_from")
    due_to = filters.get("due_to")
    due = line.get("due_date")
    if due_from and (not due or due < due_from.isoformat()):
        return False
    if due_to and (not due or due > due_to.isoformat()):
        return False
    due_risk = (filters.get("due_risk") or "").strip().upper()
    if due_risk:
        if due_risk in {"PRIORITY", DUE_RISK_PRIORITY} and line.get("due_risk") != DUE_RISK_PRIORITY:
            return False
        if due_risk in {"OVERDUE", DUE_RISK_OVERDUE} and line.get("due_risk") != DUE_RISK_OVERDUE:
            return False
    if filters.get("missing_schedule") is True and not line.get("missing_schedule"):
        return False
    return True


def order_matches_filters(order: dict[str, Any], filters: dict[str, Any]) -> bool:
    search = (filters.get("search") or "").strip().lower()
    if search:
        hay = " ".join(
            [
                str(order.get("order_no") or ""),
                str(order.get("po_number") or ""),
                str(order.get("customer_id") or ""),
                str(order.get("status") or ""),
                " ".join(
                    str(part or "")
                    for line in order.get("lines") or []
                    for part in (line.get("product_code"), line.get("parchment_color"))
                ),
            ]
        ).lower()
        if search not in hay:
            return False
    source = (filters.get("source") or "").strip().lower()
    if source and order.get("source") != source:
        return False
    status = (filters.get("status") or "").strip().lower()
    if status and str(order.get("status") or "").lower() != status:
        return False
    customer_id = filters.get("customer_id")
    if customer_id and str(order.get("customer_id") or "") != str(customer_id):
        return False
    matching_lines = [line for line in order.get("lines") or [] if line_matches_filters(line, filters)]
    if not matching_lines:
        return False
    order["lines"] = matching_lines
    order["line_count"] = len(matching_lines)
    order["outstanding_qty"] = round(sum(line["outstanding_qty"] for line in matching_lines), 2)
    order["unreleased_qty"] = round(sum(line["unreleased_qty"] for line in matching_lines), 2)
    order["scheduled_qty"] = round(sum(line["scheduled_qty"] for line in matching_lines), 2)
    order["open_value"] = round(sum(line["outstanding_value"] for line in matching_lines), 2)
    order["missing_schedule"] = any(line["missing_schedule"] for line in matching_lines)
    due_dates = [line.get("due_date") for line in matching_lines if line.get("due_date")]
    order["earliest_due"] = min(due_dates) if due_dates else None
    return True


def sort_pending_orders(orders: list[dict[str, Any]], sort: str, direction: str) -> list[dict[str, Any]]:
    key = (sort or "due_date").strip().lower()
    if key not in SORT_KEYS:
        key = "due_date"
    reverse = (direction or "asc").strip().lower() == "desc"

    def sort_value(order: dict[str, Any]):
        if key == "order_no":
            return str(order.get("order_no") or "")
        if key == "outstanding_qty":
            return float(order.get("outstanding_qty") or 0)
        if key == "unreleased_qty":
            return float(order.get("unreleased_qty") or 0)
        if key == "open_value":
            return float(order.get("open_value") or 0)
        if key == "created_at":
            return str(order.get("created_at") or "")
        return str(order.get("earliest_due") or "9999-12-31")

    return sorted(orders, key=lambda order: (sort_value(order), str(order.get("order_no") or "")), reverse=reverse)


def summarize_pending_orders(orders: list[dict[str, Any]], today: date) -> dict[str, Any]:
    start, end = priority_window(today)
    line_count = sum(int(order.get("line_count") or 0) for order in orders)
    return {
        "order_count": len(orders),
        "line_count": line_count,
        "outstanding_qty": round(sum(float(order.get("outstanding_qty") or 0) for order in orders), 2),
        "unreleased_qty": round(sum(float(order.get("unreleased_qty") or 0) for order in orders), 2),
        "scheduled_qty": round(sum(float(order.get("scheduled_qty") or 0) for order in orders), 2),
        "missing_schedule_count": sum(1 for order in orders if order.get("missing_schedule")),
        "due_priority_count": sum(1 for order in orders if order.get("due_risk") == DUE_RISK_PRIORITY),
        "due_overdue_count": sum(1 for order in orders if order.get("due_risk") == DUE_RISK_OVERDUE),
        "open_order_book_value": round(sum(float(order.get("open_value") or 0) for order in orders), 2),
        "priority_start": start.isoformat(),
        "priority_end": end.isoformat(),
        "priority_label": due_risk_label(today),
        "overdue_label": overdue_label(),
    }


def paginate_items(items: list[Any], *, offset: int, limit: int) -> tuple[list[Any], dict[str, Any]]:
    total = len(items)
    start = max(0, int(offset or 0))
    size = max(1, int(limit or 50))
    page = items[start : start + size]
    return page, {
        "total_count": total,
        "limit": size,
        "offset": start,
        "has_more": start + size < total,
        "returned_count": len(page),
    }


def coverage_block() -> dict[str, Any]:
    return {
        "sales": "complete",
        "production_wip": "overlay",
        "qc_held": "unavailable",
        "allocated_fg": "unavailable",
        "material_shortage": "unavailable",
        "supplier_calendar": "deferred",
        "notes": [
            "Counts and rupee totals are server-scoped for authorized plants.",
            "WIP/QC-held overlay is published by GET /job-cards/pending-by-order.",
            "Supplier receipt calendar and BOM shortage are not in this slice.",
        ],
    }


def load_open_orders(db: Session, plant_scope: dict) -> list[SalesOrder]:
    query = apply_plant_scope(
        db.query(SalesOrder).options(
            joinedload(SalesOrder.lines).joinedload(SalesOrderLine.release_lots),
            joinedload(SalesOrder.lines).joinedload(SalesOrderLine.delivery_schedules),
            joinedload(SalesOrder.lines).joinedload(SalesOrderLine.dispatch_logs),
        ).filter(SalesOrder.status != SalesOrderStatus.CLOSED),
        SalesOrder.plant_id,
        plant_scope,
    )
    return query.order_by(SalesOrder.created_at.desc()).all()


def build_pending_workspace(
    orders: list[Any],
    *,
    filters: dict[str, Any],
    today: Optional[date] = None,
    limit: int = 50,
    offset: int = 0,
    sort: str = "due_date",
    direction: str = "asc",
    plant_scope: Optional[dict] = None,
) -> dict[str, Any]:
    current = today or plant_today()
    serialized = [serialize_pending_order(order, current) for order in orders]
    matched = []
    for order in serialized:
        if order_matches_filters(order, filters):
            matched.append(order)
    matched = sort_pending_orders(matched, sort, direction)
    summary = summarize_pending_orders(matched, current)
    page, page_meta = paginate_items(matched, offset=offset, limit=limit)
    as_of = datetime.now().astimezone()
    return {
        "as_of": as_of.isoformat(),
        "timezone": PLANT_TIMEZONE_NAME,
        "plant_today": current.isoformat(),
        "plant_scope": {
            "scope_all": bool((plant_scope or {}).get("scope_all")),
            "selected_plant_id": (plant_scope or {}).get("selected_plant_id"),
        },
        "coverage": coverage_block(),
        "summary": summary,
        "items": page,
        **page_meta,
    }


def export_pending_csv(payload: dict[str, Any]) -> str:
    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=PENDING_EXPORT_FIELDS)
    writer.writeheader()
    for order in payload.get("items") or []:
        for line in order.get("lines") or []:
            writer.writerow(
                {
                    "order_id": order.get("id"),
                    "order_no": order.get("order_no"),
                    "plant_id": order.get("plant_id"),
                    "customer_id": order.get("customer_id"),
                    "source": order.get("source"),
                    "po_number": order.get("po_number") or "",
                    "status": order.get("status"),
                    "line_id": line.get("line_id"),
                    "line_no": line.get("line_no"),
                    "product_code": line.get("product_code") or "",
                    "approved_spec_id": line.get("approved_spec_id") or "",
                    "parchment_color": line.get("parchment_color") or "",
                    "due_date": line.get("due_date") or "",
                    "due_risk": line.get("due_risk") or "",
                    "ordered_qty": line.get("ordered_qty"),
                    "fulfilled_qty": line.get("fulfilled_qty"),
                    "outstanding_qty": line.get("outstanding_qty"),
                    "released_qty": line.get("released_qty"),
                    "unreleased_qty": line.get("unreleased_qty"),
                    "scheduled_qty": line.get("scheduled_qty"),
                    "released_not_scheduled_qty": line.get("released_not_scheduled_qty"),
                    "remaining_to_schedule_qty": line.get("remaining_to_schedule_qty"),
                    "rate_per_pc": line.get("rate_per_pc") if line.get("rate_per_pc") is not None else "",
                    "outstanding_value": line.get("outstanding_value"),
                    "missing_schedule": line.get("missing_schedule"),
                }
            )
    return buffer.getvalue()


def parse_customer_id(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    try:
        return str(UUID(str(value)))
    except (TypeError, ValueError):
        return str(value)
