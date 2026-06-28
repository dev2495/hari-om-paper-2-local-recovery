from __future__ import annotations

from datetime import date, datetime, time, timezone
from typing import Any

from sqlalchemy import and_, or_
from sqlalchemy.orm import Session, joinedload

from ..models import (
    ItemMaster,
    PaperReel,
    ReelIssue,
    ReelIssueStatus,
    ReelScanEvent,
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


def _naive_datetime(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if getattr(value, "tzinfo", None) is not None:
        return value.astimezone(timezone.utc).replace(tzinfo=None)
    return value


def _issue_effective_datetime(issue: ReelIssue) -> datetime:
    closed_at = getattr(issue, "closed_at", None)
    if closed_at:
        return _naive_datetime(closed_at) or _day_end(issue.issue_date)
    if getattr(issue, "created_at", None):
        return _naive_datetime(issue.created_at) or _day_end(issue.issue_date)
    return _day_end(issue.issue_date)


def _issue_effective_date(issue: ReelIssue) -> date:
    return _issue_effective_datetime(issue).date()


def _issue_consumed_qty(issue: ReelIssue) -> float:
    consumed = float(getattr(issue, "consumed_weight_kg", 0.0) or 0.0)
    if consumed > 0:
        return consumed
    return max(0.0, float(issue.issued_weight_kg or 0.0) - float(issue.remaining_weight_kg or 0.0))


def _transaction_business_datetime(txn: StockTransaction) -> datetime:
    if getattr(txn, "effective_at", None):
        return _naive_datetime(txn.effective_at) or _day_end(date.today())
    if getattr(txn, "effective_date", None):
        return _day_end(txn.effective_date)
    if getattr(txn, "created_at", None):
        return _naive_datetime(txn.created_at) or _day_end(date.today())
    return _day_end(date.today())


def _transaction_business_date(txn: StockTransaction) -> date:
    return _transaction_business_datetime(txn).date()


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


def _scan_event_adjustment_datetime(event: ReelScanEvent) -> datetime:
    metadata = getattr(event, "event_metadata", None) or {}
    raw_effective_at = metadata.get("effective_at")
    if raw_effective_at:
        try:
            parsed = datetime.fromisoformat(str(raw_effective_at).replace("Z", "+00:00"))
            return _naive_datetime(parsed) or _day_end(date.today())
        except ValueError:
            pass
    raw_effective = metadata.get("effective_date")
    if raw_effective:
        try:
            return _day_end(date.fromisoformat(str(raw_effective)[:10]))
        except ValueError:
            pass
    if getattr(event, "timestamp", None):
        return _naive_datetime(event.timestamp) or _day_end(date.today())
    return _day_end(date.today())


def _scan_event_adjustment_date(event: ReelScanEvent) -> date:
    return _scan_event_adjustment_datetime(event).date()


def _reel_inward_datetime(reel: PaperReel) -> datetime | None:
    inward_date = getattr(reel, "inward_date", None)
    if not inward_date:
        return None
    created_at = _naive_datetime(getattr(reel, "created_at", None))
    if created_at and created_at.date() == inward_date:
        return created_at
    return _day_end(inward_date)


def _bulk_quantities(
    db: Session,
    item_id: str,
    start_date: date,
    end_date: date,
    as_of_at: datetime | None = None,
) -> dict[str, float]:
    start_at = _day_start(start_date)
    end_at = as_of_at or _day_end(end_date)
    candidate_txns = (
        db.query(StockTransaction)
        .filter(
            StockTransaction.item_id == item_id,
            or_(
                StockTransaction.effective_date <= end_date,
                StockTransaction.effective_at <= end_at,
                and_(
                    StockTransaction.effective_date.is_(None),
                    StockTransaction.created_at <= _day_end(end_date),
                ),
            ),
        )
        .all()
    )

    opening_qty = 0.0
    inward_qty = 0.0
    outward_qty = 0.0
    adjustment_qty = 0.0
    for txn in candidate_txns:
        txn_type = _enum_value(txn.transaction_type)
        qty = float(txn.qty_change or 0.0)
        if txn_type == TransactionType.MOVE.value:
            continue
        business_at = _transaction_business_datetime(txn)
        if business_at < start_at:
            opening_qty += qty
            continue
        if business_at > end_at:
            continue
        if txn_type in {TransactionType.OPENING.value, TransactionType.ADJUSTMENT.value}:
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
    as_of_at: datetime | None = None,
) -> dict[str, float]:
    start_at = _day_start(start_date)
    end_at = as_of_at or _day_end(end_date)
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
        inward_at = _reel_inward_datetime(reel)
        if not inward_at:
            continue
        qty = float(reel.inward_weight_kg or 0.0)
        if inward_at < start_at:
            opening_qty += qty
        elif start_at <= inward_at <= end_at:
            if _reel_source_type(reel) in {"OPENING_LOAD", "CARRY_FORWARD", "STOCK_ADJUSTMENT"}:
                adjustment_qty += qty
            else:
                inward_qty += qty

    consumed_before_start = 0.0
    outward_qty = 0.0
    for issue in issues:
        consumed = _issue_consumed_qty(issue)
        if consumed <= 0:
            continue
        effective_at = _issue_effective_datetime(issue)
        if effective_at < start_at:
            consumed_before_start += consumed
        elif start_at <= effective_at <= end_at:
            outward_qty += consumed

    adjustment_events = (
        db.query(ReelScanEvent)
        .join(PaperReel, ReelScanEvent.reel_id == PaperReel.id)
        .filter(PaperReel.paper_id == item_id)
        .all()
    )
    for event in adjustment_events:
        metadata = getattr(event, "event_metadata", None) or {}
        try:
            delta = float(metadata.get("adjustment_qty_delta") or 0.0)
        except (TypeError, ValueError):
            delta = 0.0
        if delta >= 0:
            continue
        effective_at = _scan_event_adjustment_datetime(event)
        if effective_at < start_at:
            opening_qty += delta
        elif start_at <= effective_at <= end_at:
            adjustment_qty += delta

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
    as_of_at: datetime | None = None,
) -> dict[str, Any]:
    normalized_as_of = _naive_datetime(as_of_at)
    statement_end_at = normalized_as_of or _day_end(end_date)
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
            _reel_quantities(db, item_id, start_date, end_date, statement_end_at)
            if tracking_mode == TrackingMode.REEL.value
            else _bulk_quantities(db, item_id, start_date, end_date, statement_end_at)
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
        "stock_as_of_at": statement_end_at.isoformat(),
        "scope": "ALL" if plant_scope.get("scope_all") else plant_scope.get("selected_plant_id"),
        "generated_at": datetime.utcnow().isoformat(),
        "rows": rows,
        "totals": totals,
    }
