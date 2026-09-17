"""Full-scope open sales demand sources for MRP coverage.

This is a rebuildable read of commercial lines. It is not a stock ledger.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy.orm import Session, joinedload

from .models import SalesOrder, SalesOrderLine, SalesOrderStatus
from .utils.auth import apply_plant_scope

# Drafts are captured but not treated as procurement-authoritative demand.
OPEN_COMMERCIAL_STATUSES = {
    SalesOrderStatus.SUBMITTED,
    SalesOrderStatus.APPROVED,
    SalesOrderStatus.RELEASED,
    SalesOrderStatus.PARTIALLY_RELEASED,
    SalesOrderStatus.PARTIALLY_DISPATCHED,
}


def _released_qty(line: SalesOrderLine) -> float:
    lots = [lot for lot in getattr(line, "release_lots", []) if str(lot.status or "").lower() != "cancelled"]
    return round(sum(float(lot.released_qty or 0.0) for lot in lots), 4)


def serialize_open_demand_line(order: SalesOrder, line: SalesOrderLine) -> dict[str, Any] | None:
    remaining_qty = max(0.0, float(line.qty or 0.0) - float(line.fulfilled_qty or 0.0))
    if remaining_qty <= 1e-9:
        return None
    released_qty = _released_qty(line)
    return {
        "order_id": str(order.id),
        "order_no": order.order_no,
        "plant_id": str(order.plant_id),
        "customer_id": str(order.customer_id),
        "order_status": order.status.value if hasattr(order.status, "value") else str(order.status),
        "po_number": order.po_number,
        "line_id": str(line.id),
        "line_no": int(line.line_no or 1),
        "approved_spec_id": str(line.approved_spec_id) if line.approved_spec_id else None,
        "product_code": line.product_code,
        "parchment_color": line.parchment_color,
        "qty_ordered": float(line.qty or 0.0),
        "fulfilled_qty": float(line.fulfilled_qty or 0.0),
        "remaining_qty": round(remaining_qty, 4),
        "released_qty": released_qty,
        "unreleased_qty": round(max(0.0, float(line.qty or 0.0) - released_qty), 4),
        "due_date": line.due_date.isoformat() if line.due_date else None,
        "source_revision": {
            "sales_order_id": str(order.id),
            "sales_order_line_id": str(line.id),
            "approved_spec_id": str(line.approved_spec_id) if line.approved_spec_id else None,
            "order_status": order.status.value if hasattr(order.status, "value") else str(order.status),
        },
    }


def collect_open_demand(db: Session, plant_scope: dict) -> dict[str, Any]:
    query = apply_plant_scope(
        db.query(SalesOrder).options(
            joinedload(SalesOrder.lines).joinedload(SalesOrderLine.release_lots),
        ),
        SalesOrder.plant_id,
        plant_scope,
    ).filter(SalesOrder.status.in_(list(OPEN_COMMERCIAL_STATUSES)))

    orders = query.order_by(SalesOrder.created_at.asc()).all()
    lines: list[dict[str, Any]] = []
    for order in orders:
        for line in order.lines or []:
            payload = serialize_open_demand_line(order, line)
            if payload:
                lines.append(payload)

    skipped_drafts = apply_plant_scope(
        db.query(SalesOrder),
        SalesOrder.plant_id,
        plant_scope,
    ).filter(SalesOrder.status == SalesOrderStatus.DRAFT).count()
    return {
        "as_of": datetime.now(timezone.utc).isoformat(),
        "measure": "open_sales_demand",
        "ledger": False,
        "plant_scope": {
            "scope_all": bool(plant_scope.get("scope_all")),
            "selected_plant_id": plant_scope.get("selected_plant_id"),
            "allowed_plants": list(plant_scope.get("allowed_plants") or []),
        },
        "total_orders": len(orders),
        "total_open_lines": len(lines),
        "coverage": "all_open_lines",
        "page": None,
        "skipped_draft_orders": skipped_drafts,
        "lines": lines,
    }
