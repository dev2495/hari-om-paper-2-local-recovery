"""Cancelled / short-closed by reason (owner decision 4, 1 Nov 2026).

Groups closed orders by their "Order cancel / short close" reason, customer and month: how many orders
and how many pieces were lost. A cancelled order loses its whole ordered qty; a short-closed order loses
the qty that was dropped (``short_closed_qty`` on its lines). Value uses each line's rate when it has one.
"""
from __future__ import annotations

from collections import defaultdict
from typing import Any, Iterable

CANCELLED = "CANCELLED"
SHORT_CLOSED = "SHORT_CLOSED"


def _num(value: Any) -> float:
    try:
        return float(value or 0.0)
    except (TypeError, ValueError):
        return 0.0


def lost_qty_and_value(order: Any) -> tuple[float, float]:
    kind = str(getattr(order, "closure_kind", "") or "").upper()
    qty = value = 0.0
    for line in getattr(order, "lines", None) or []:
        lost = _num(line.qty) if kind == CANCELLED else _num(getattr(line, "short_closed_qty", 0.0))
        qty += lost
        value += lost * _num(getattr(line, "rate_per_pc", 0.0))
    return round(qty, 4), round(value, 2)


def closure_rows(orders: Iterable[Any]) -> list[dict[str, Any]]:
    out = []
    for order in orders:
        kind = str(getattr(order, "closure_kind", "") or "").upper()
        if kind not in (CANCELLED, SHORT_CLOSED):
            continue
        qty, value = lost_qty_and_value(order)
        at = getattr(order, "closure_at", None)
        out.append({
            "order_id": str(order.id),
            "order_no": order.order_no,
            "po_number": getattr(order, "po_number", None),
            "customer_id": str(order.customer_id) if getattr(order, "customer_id", None) else None,
            "kind": kind,
            "reason_code": getattr(order, "closure_reason_code", None) or "(none)",
            "reason_label": getattr(order, "closure_reason", None) or getattr(order, "closure_reason_code", None) or "No reason recorded",
            "note": getattr(order, "closure_note", None),
            "month": at.strftime("%Y-%m") if at else None,
            "closed_at": at.isoformat() if at else None,
            "closed_by": getattr(order, "closure_by", None),
            "qty": qty,
            "value": value,
        })
    return out


def _group(rows: list[dict[str, Any]], keys: tuple[str, ...]) -> list[dict[str, Any]]:
    buckets: dict[tuple, dict[str, Any]] = {}
    for row in rows:
        key = tuple(row.get(k) for k in keys)
        bucket = buckets.get(key)
        if bucket is None:
            bucket = {k: row.get(k) for k in keys}
            bucket.update({"orders": 0, "cancelled": 0, "short_closed": 0, "qty": 0.0, "value": 0.0})
            buckets[key] = bucket
        bucket["orders"] += 1
        bucket["cancelled" if row["kind"] == CANCELLED else "short_closed"] += 1
        bucket["qty"] = round(bucket["qty"] + row["qty"], 4)
        bucket["value"] = round(bucket["value"] + row["value"], 2)
    return sorted(buckets.values(), key=lambda item: (-item["qty"], -item["orders"], str(item.get(keys[0]))))


def closure_report(orders: Iterable[Any]) -> dict[str, Any]:
    rows = closure_rows(orders)
    labels: dict[str, str] = defaultdict(str)
    for row in rows:
        labels[row["reason_code"]] = labels[row["reason_code"]] or row["reason_label"]
    by_reason = _group(rows, ("reason_code",))
    detail = _group(rows, ("reason_code", "customer_id", "month"))
    for item in [*by_reason, *detail]:
        item["reason_label"] = labels[item["reason_code"]]
    return {
        "totals": {
            "orders": len(rows),
            "cancelled": sum(1 for row in rows if row["kind"] == CANCELLED),
            "short_closed": sum(1 for row in rows if row["kind"] == SHORT_CLOSED),
            "qty": round(sum(row["qty"] for row in rows), 4),
            "value": round(sum(row["value"] for row in rows), 2),
        },
        "by_reason": by_reason,
        "by_customer": _group(rows, ("customer_id",)),
        "by_month": sorted(_group(rows, ("month",)), key=lambda item: str(item.get("month") or "")),
        "by_reason_customer_month": detail,
        "orders": sorted(rows, key=lambda row: row["closed_at"] or "", reverse=True),
    }
