from __future__ import annotations

from datetime import date, datetime, time
from typing import Any

from sqlalchemy.orm import Session, joinedload

from ..models import (
    ItemMaster,
    PaperReel,
    ReelIssue,
    ReelIssueStatus,
    StockBatch,
    StockTransaction,
    TrackingMode,
    TransactionType,
)
from .stock_calc import get_batch_balance


def _enum_value(value: Any) -> str:
    return str(getattr(value, "value", value) or "")


def _apply_item_scope(query, plant_scope: dict):
    if plant_scope.get("scope_all"):
        allowed = plant_scope.get("allowed_plants") or []
        if allowed:
            return query.filter(ItemMaster.plant_id.in_(allowed))
        return query
    selected_plant_id = plant_scope.get("selected_plant_id")
    if not selected_plant_id:
        return query.filter(False)
    return query.filter(ItemMaster.plant_id == selected_plant_id)


def _day_start(value: date) -> datetime:
    return datetime.combine(value, time.min)


def _day_end(value: date) -> datetime:
    return datetime.combine(value, time.max)


def _issue_effective_date(issue: ReelIssue) -> date:
    closed_at = getattr(issue, "closed_at", None)
    if closed_at:
        return closed_at.date()
    if getattr(issue, "created_at", None):
        return issue.created_at.date()
    return issue.issue_date


def _issue_consumed_qty(issue: ReelIssue) -> float:
    consumed = float(getattr(issue, "consumed_weight_kg", 0.0) or 0.0)
    if consumed > 0:
        return consumed
    return max(0.0, float(issue.issued_weight_kg or 0.0) - float(issue.remaining_weight_kg or 0.0))


def _unit_cost_for_item(item: ItemMaster) -> tuple[float, str]:
    unit_cost = float(getattr(item, "unit_cost", 0.0) or 0.0)
    source = str(getattr(item, "cost_source", None) or "").strip().upper() or "UNAVAILABLE"
    if unit_cost <= 0:
        return 0.0, "UNAVAILABLE"
    return unit_cost, source


def batch_weighted_unit_cost_for_item(
    db: Session,
    item: ItemMaster,
    balance_getter=get_batch_balance,
) -> tuple[float, str]:
    batches = db.query(StockBatch).filter(StockBatch.item_id == item.id).all()
    weighted_value = 0.0
    weighted_qty = 0.0
    missing_cost = False

    for batch in batches:
        balance = float(balance_getter(str(batch.id), db) or 0.0)
        if balance <= 0:
            continue
        unit_cost = getattr(batch, "unit_cost", None)
        if unit_cost is None or float(unit_cost or 0.0) <= 0:
            missing_cost = True
            continue
        weighted_qty += balance
        weighted_value += balance * float(unit_cost)

    if weighted_qty <= 0:
        return 0.0, "COST_MISSING" if missing_cost else "UNAVAILABLE"
    return round(weighted_value / weighted_qty, 6), "AVG_BATCH"


def reel_weighted_unit_cost_for_item(db: Session, item: ItemMaster) -> tuple[float, str]:
    reels = db.query(PaperReel).filter(PaperReel.paper_id == item.id).all()
    weighted_value = 0.0
    weighted_qty = 0.0
    missing_cost = False
    for reel in reels:
        qty = float(getattr(reel, "current_weight_kg", 0.0) or 0.0)
        if qty <= 0:
            continue
        unit_cost = getattr(reel, "unit_cost", None)
        if unit_cost is None or float(unit_cost or 0.0) <= 0:
            missing_cost = True
            continue
        weighted_qty += qty
        weighted_value += qty * float(unit_cost)
    if weighted_qty <= 0:
        return 0.0, "COST_MISSING" if missing_cost else "UNAVAILABLE"
    return round(weighted_value / weighted_qty, 6), "AVG_REEL"


def _risk_level(closing_qty: float, reorder_level: float, safety_stock: float) -> str:
    if reorder_level <= 0 and safety_stock <= 0:
        return "POLICY_MISSING"
    if safety_stock > 0 and closing_qty <= safety_stock:
        return "CRITICAL"
    if reorder_level > 0 and closing_qty <= reorder_level:
        return "REORDER"
    return "OK"


def _reel_source_type(reel: PaperReel) -> str:
    metadata = getattr(reel, "genealogy_metadata", None) or {}
    return str(metadata.get("source_document_type") or metadata.get("source") or "").upper()


def _bulk_quantities(
    db: Session,
    item_id: str,
    start_date: date,
    end_date: date,
) -> dict[str, float]:
    opening_txns = (
        db.query(StockTransaction)
        .filter(
            StockTransaction.item_id == item_id,
            StockTransaction.created_at < _day_start(start_date),
        )
        .all()
    )
    period_txns = (
        db.query(StockTransaction)
        .filter(
            StockTransaction.item_id == item_id,
            StockTransaction.created_at >= _day_start(start_date),
            StockTransaction.created_at <= _day_end(end_date),
        )
        .all()
    )

    opening_qty = sum(float(txn.qty_change or 0.0) for txn in opening_txns)
    inward_qty = 0.0
    outward_qty = 0.0
    adjustment_qty = 0.0
    for txn in period_txns:
        txn_type = _enum_value(txn.transaction_type)
        qty = float(txn.qty_change or 0.0)
        if txn_type == TransactionType.MOVE.value:
            continue
        if txn_type == TransactionType.OPENING.value:
            adjustment_qty += qty
        elif qty >= 0:
            inward_qty += qty
        else:
            outward_qty += abs(qty)

    closing_qty = opening_qty + inward_qty - outward_qty + adjustment_qty
    return {
        "opening_qty": opening_qty,
        "inward_qty": inward_qty,
        "outward_qty": outward_qty,
        "adjustment_qty": adjustment_qty,
        "closing_qty": closing_qty,
    }


def _reel_quantities(
    db: Session,
    item_id: str,
    start_date: date,
    end_date: date,
) -> dict[str, float]:
    reels = db.query(PaperReel).filter(PaperReel.paper_id == item_id).all()
    issues = (
        db.query(ReelIssue)
        .options(joinedload(ReelIssue.reel))
        .join(PaperReel, ReelIssue.reel_id == PaperReel.id)
        .filter(
            PaperReel.paper_id == item_id,
            ReelIssue.status == ReelIssueStatus.CLOSED,
        )
        .all()
    )

    opening_qty = 0.0
    inward_qty = 0.0
    adjustment_qty = 0.0
    for reel in reels:
        if not reel.inward_date:
            continue
        qty = float(reel.inward_weight_kg or 0.0)
        if reel.inward_date < start_date:
            opening_qty += qty
        elif start_date <= reel.inward_date <= end_date:
            if _reel_source_type(reel) == "OPENING_LOAD":
                adjustment_qty += qty
            else:
                inward_qty += qty

    consumed_before_start = 0.0
    outward_qty = 0.0
    for issue in issues:
        consumed = _issue_consumed_qty(issue)
        if consumed <= 0:
            continue
        effective_date = _issue_effective_date(issue)
        if effective_date < start_date:
            consumed_before_start += consumed
        elif start_date <= effective_date <= end_date:
            outward_qty += consumed

    opening_qty -= consumed_before_start
    closing_qty = opening_qty + inward_qty - outward_qty + adjustment_qty
    return {
        "opening_qty": opening_qty,
        "inward_qty": inward_qty,
        "outward_qty": outward_qty,
        "adjustment_qty": adjustment_qty,
        "closing_qty": closing_qty,
    }


def compute_stock_statement(
    db: Session,
    plant_scope: dict,
    start_date: date,
    end_date: date,
) -> dict[str, Any]:
    item_query = _apply_item_scope(db.query(ItemMaster).filter(ItemMaster.active == "true"), plant_scope)
    items = item_query.order_by(ItemMaster.type.asc(), ItemMaster.item_code.asc()).all()

    rows: list[dict[str, Any]] = []
    totals = {
        "opening_value": 0.0,
        "closing_value": 0.0,
        "variance_value": 0.0,
        "kg_closing_qty": 0.0,
        "pcs_closing_qty": 0.0,
        "critical_count": 0,
        "policy_missing_count": 0,
        "line_count": 0,
    }

    for item in items:
        item_id = str(item.id)
        tracking_mode = _enum_value(item.tracking_mode)
        quantities = (
            _reel_quantities(db, item_id, start_date, end_date)
            if tracking_mode == TrackingMode.REEL.value
            else _bulk_quantities(db, item_id, start_date, end_date)
        )
        if tracking_mode == TrackingMode.REEL.value:
            unit_cost, cost_source = reel_weighted_unit_cost_for_item(db, item)
        else:
            unit_cost, cost_source = batch_weighted_unit_cost_for_item(db, item)
        closing_qty = round(float(quantities["closing_qty"] or 0.0), 3)
        opening_qty = round(float(quantities["opening_qty"] or 0.0), 3)
        inward_qty = round(float(quantities["inward_qty"] or 0.0), 3)
        outward_qty = round(float(quantities["outward_qty"] or 0.0), 3)
        adjustment_qty = round(float(quantities["adjustment_qty"] or 0.0), 3)
        reorder_level = float(getattr(item, "reorder_level", 0.0) or 0.0)
        safety_stock = float(getattr(item, "safety_stock", 0.0) or 0.0)
        lead_time_days = float(getattr(item, "lead_time_days", 0.0) or 0.0)
        risk_level = _risk_level(closing_qty, reorder_level, safety_stock)
        closing_value = round(closing_qty * unit_cost, 2)
        opening_value = round(opening_qty * unit_cost, 2)

        row = {
            "item_id": item_id,
            "item_code": item.item_code,
            "item_name": item.name,
            "item_type": _enum_value(item.type),
            "tracking_mode": tracking_mode,
            "uom": _enum_value(item.uom),
            "opening_qty": opening_qty,
            "inward_qty": inward_qty,
            "outward_qty": outward_qty,
            "adjustment_qty": adjustment_qty,
            "closing_qty": closing_qty,
            "physical_qty": closing_qty,
            "variance_qty": 0.0,
            "unit_cost": round(unit_cost, 4),
            "cost_source": cost_source,
            "opening_value": opening_value,
            "closing_value": closing_value,
            "variance_value": 0.0,
            "reorder_level": round(reorder_level, 2),
            "safety_stock": round(safety_stock, 2),
            "lead_time_days": round(lead_time_days, 1),
            "risk_level": risk_level,
            "policy_missing": risk_level == "POLICY_MISSING",
            "is_below_reorder": risk_level in {"CRITICAL", "REORDER"},
        }
        rows.append(row)
        totals["opening_value"] += opening_value
        totals["closing_value"] += closing_value
        if row["uom"] == "KG":
            totals["kg_closing_qty"] += closing_qty
        if row["uom"] == "PCS":
            totals["pcs_closing_qty"] += closing_qty
        if risk_level in {"CRITICAL", "REORDER"}:
            totals["critical_count"] += 1
        if risk_level == "POLICY_MISSING":
            totals["policy_missing_count"] += 1
        totals["line_count"] += 1

    for key in ("opening_value", "closing_value", "variance_value", "kg_closing_qty", "pcs_closing_qty"):
        totals[key] = round(float(totals[key]), 2)

    return {
        "period_start": start_date.isoformat(),
        "period_end": end_date.isoformat(),
        "scope": "ALL" if plant_scope.get("scope_all") else plant_scope.get("selected_plant_id"),
        "generated_at": datetime.utcnow().isoformat(),
        "rows": rows,
        "totals": totals,
    }
