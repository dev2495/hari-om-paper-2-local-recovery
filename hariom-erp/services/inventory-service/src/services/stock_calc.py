"""
Stock balance calculation service.

Physical stock is computed from stock transactions. Active reservations reduce
availability until they are released or consumed.
"""
from typing import Dict, List, Optional, Sequence
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload
from ..models import ItemMaster, PaperReel, ReelIssue, ReelIssueStatus, Reservation, ReservationStatus, StockBatch, StockTransaction, TrackingMode


def get_item_balance(item_id: str, db: Session) -> float:
    item = db.query(ItemMaster).filter(ItemMaster.id == item_id).first()
    if item and item.tracking_mode == TrackingMode.REEL:
        result = db.query(func.sum(PaperReel.current_weight_kg)).filter(
            PaperReel.paper_id == item_id
        ).scalar()
        return float(result or 0.0)

    result = db.query(func.sum(StockTransaction.qty_change)).filter(
        StockTransaction.item_id == item_id
    ).scalar()
    return float(result or 0.0)


def get_batch_balance(batch_id: str, db: Session) -> float:
    result = db.query(func.sum(StockTransaction.qty_change)).filter(
        StockTransaction.batch_id == batch_id
    ).scalar()
    return float(result or 0.0)


def get_reserved_qty(
    db: Session,
    item_id: Optional[str] = None,
    batch_id: Optional[str] = None,
) -> float:
    if not item_id and not batch_id:
        return 0.0
    query = db.query(func.sum(Reservation.reserved_qty - Reservation.consumed_qty)).filter(
        Reservation.status == ReservationStatus.ACTIVE,
    )
    if item_id:
        query = query.filter(Reservation.item_id == item_id)
    if batch_id:
        query = query.filter(Reservation.batch_id == batch_id)
    return max(0.0, float(query.scalar() or 0.0))


def get_dispatch_allocated_qty(
    db: Session,
    item_id: Optional[str] = None,
    batch_id: Optional[str] = None,
) -> float:
    return get_reserved_qty(db=db, item_id=item_id, batch_id=batch_id)


def get_available_item_qty(item_id: str, db: Session) -> float:
    physical = get_item_balance(item_id, db)
    reserved = get_reserved_qty(db=db, item_id=item_id)
    return round(physical - reserved, 2)


def get_available_batch_qty(batch_id: str, db: Session) -> float:
    physical = get_batch_balance(batch_id, db)
    reserved = get_reserved_qty(db=db, batch_id=batch_id)
    return round(physical - reserved, 2)


def get_batch_weighted_cost(item_id: str, db: Session) -> tuple[float, str]:
    batches = db.query(StockBatch).filter(StockBatch.item_id == item_id).all()
    total_qty = 0.0
    total_value = 0.0
    for batch in batches:
        unit_cost = float(getattr(batch, "unit_cost", 0.0) or 0.0)
        if unit_cost <= 0:
            continue
        balance = max(0.0, get_batch_balance(str(batch.id), db))
        if balance <= 0:
            continue
        total_qty += balance
        total_value += balance * unit_cost
    if total_qty <= 0:
        return 0.0, "UNAVAILABLE"
    return total_value / total_qty, "AVG_BATCH"


def get_item_ledger(item_id: str, db: Session) -> List[Dict]:
    item = db.query(ItemMaster).filter(ItemMaster.id == item_id).first()
    if item and item.tracking_mode == TrackingMode.REEL:
        events: list[dict] = []
        reels = db.query(PaperReel).filter(PaperReel.paper_id == item_id).all()
        for reel in reels:
            events.append(
                {
                    "transaction_id": str(reel.id),
                    "date": reel.inward_date.isoformat(),
                    "type": "REEL_INWARD",
                    "qty_change": float(reel.inward_weight_kg or 0.0),
                    "reference": f"REEL:{reel.reel_code}",
                    "reference_type": "REEL",
                    "reference_id": str(reel.id),
                    "external_ref": reel.reel_code,
                    "batch_id": None,
                    "item_id": str(item_id),
                    "location_id": str(reel.location_id) if reel.location_id else None,
                    "stock_status": reel.stock_status,
                    "movement_metadata": {
                        "reel_id": str(reel.id),
                        "reel_code": reel.reel_code,
                        "current_weight_kg": round(float(reel.current_weight_kg or 0.0), 2),
                    },
                    "running_balance": 0.0,
                }
            )

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
        for issue in issues:
            consumed = float(getattr(issue, "consumed_weight_kg", 0.0) or 0.0)
            if consumed <= 0:
                consumed = max(0.0, float(issue.issued_weight_kg or 0.0) - float(issue.remaining_weight_kg or 0.0))
            if consumed <= 0:
                continue
            effective_date = getattr(issue, "closed_at", None) or issue.created_at
            events.append(
                {
                    "transaction_id": str(issue.id),
                    "date": effective_date.isoformat(),
                    "type": "REEL_CONSUMED",
                    "qty_change": -consumed,
                    "reference": f"REEL_ISSUE:{str(issue.id)}",
                    "reference_type": "REEL_ISSUE",
                    "reference_id": str(issue.id),
                    "external_ref": None,
                    "batch_id": None,
                    "item_id": str(item_id),
                    "location_id": str(issue.reel.location_id) if issue.reel and issue.reel.location_id else None,
                    "stock_status": issue.reel.stock_status if issue.reel else "WIP",
                    "movement_metadata": {
                        "reel_id": str(issue.reel_id),
                        "issue_section": issue.issue_section,
                        "shift": issue.shift,
                    },
                    "running_balance": 0.0,
                }
            )

        running_balance = 0.0
        ordered = sorted(events, key=lambda row: row["date"])
        for row in ordered:
            running_balance += float(row["qty_change"] or 0.0)
            row["running_balance"] = round(running_balance, 2)
        return list(reversed(ordered))

    transactions = db.query(StockTransaction).filter(
        StockTransaction.item_id == item_id
    ).order_by(StockTransaction.created_at.asc()).all()

    running_balance = 0.0
    ledger = []
    for txn in transactions:
        running_balance += txn.qty_change
        ledger.append(
            {
                "transaction_id": str(txn.id),
                "date": txn.created_at.isoformat(),
                "type": txn.transaction_type.value,
                "qty_change": txn.qty_change,
                "reference": f"{txn.reference_type.value}:{str(txn.reference_id)}",
                "reference_type": txn.reference_type.value,
                "reference_id": str(txn.reference_id),
                "external_ref": txn.external_ref,
                "batch_id": str(txn.batch_id) if txn.batch_id else None,
                "item_id": str(txn.item_id) if txn.item_id else None,
                "location_id": str(txn.location_id) if txn.location_id else None,
                "stock_status": txn.stock_status,
                "movement_metadata": txn.movement_metadata or {},
                "running_balance": round(running_balance, 2),
            }
        )

    return list(reversed(ledger))


def get_batch_ledger(batch_id: str, db: Session) -> List[Dict]:
    transactions = db.query(StockTransaction).filter(
        StockTransaction.batch_id == batch_id
    ).order_by(StockTransaction.created_at.asc()).all()

    running_balance = 0.0
    ledger = []
    for txn in transactions:
        running_balance += txn.qty_change
        ledger.append(
            {
                "transaction_id": str(txn.id),
                "date": txn.created_at.isoformat(),
                "type": txn.transaction_type.value,
                "qty_change": txn.qty_change,
                "reference": f"{txn.reference_type.value}:{str(txn.reference_id)}",
                "reference_type": txn.reference_type.value,
                "reference_id": str(txn.reference_id),
                "external_ref": txn.external_ref,
                "batch_id": str(txn.batch_id) if txn.batch_id else None,
                "item_id": str(txn.item_id) if txn.item_id else None,
                "location_id": str(txn.location_id) if txn.location_id else None,
                "stock_status": txn.stock_status,
                "movement_metadata": txn.movement_metadata or {},
                "running_balance": round(running_balance, 2),
            }
        )

    return list(reversed(ledger))


def get_all_items_balance(
    db: Session,
    plant_id: Optional[str] = None,
    plant_ids: Optional[Sequence[str]] = None,
) -> List[Dict]:
    query = db.query(ItemMaster).filter(ItemMaster.active == "true")
    if plant_ids:
        query = query.filter(ItemMaster.plant_id.in_(list(plant_ids)))
    elif plant_id:
        query = query.filter(ItemMaster.plant_id == plant_id)
    items = query.all()
    balances = []

    for item in items:
        physical = get_item_balance(str(item.id), db)
        reserved = get_reserved_qty(db=db, item_id=str(item.id))
        available = physical - reserved
        batch_cost, batch_cost_source = get_batch_weighted_cost(str(item.id), db)
        item_cost = float(getattr(item, "unit_cost", 0.0) or 0.0)
        resolved_cost = batch_cost if batch_cost > 0 else item_cost
        resolved_source = batch_cost_source if batch_cost > 0 else getattr(item, "cost_source", None)
        balances.append(
            {
                "item_id": str(item.id),
                "item_code": item.item_code,
                "name": item.name,
                "type": item.type.value,
                "tracking_mode": item.tracking_mode.value,
                "uom": item.uom.value,
                "unit_cost": round(resolved_cost, 4),
                "cost_source": resolved_source,
                "reorder_level": round(float(getattr(item, "reorder_level", 0.0) or 0.0), 2),
                "safety_stock": round(float(getattr(item, "safety_stock", 0.0) or 0.0), 2),
                "lead_time_days": round(float(getattr(item, "lead_time_days", 0.0) or 0.0), 1),
                "balance": round(physical, 2),
                "reserved_qty": round(reserved, 2),
                "dispatch_allocated_qty": round(reserved, 2),
                "available_qty": round(available, 2),
            }
        )

    return balances


def get_batch_details(batch_id: str, db: Session) -> Optional[Dict]:
    batch = db.query(StockBatch).filter(StockBatch.id == batch_id).first()
    if not batch:
        return None

    physical = get_batch_balance(batch_id, db)
    reserved = get_reserved_qty(db=db, batch_id=batch_id)
    available = physical - reserved

    return {
        "batch_id": str(batch.id),
        "batch_no": batch.batch_no,
        "item_id": str(batch.item_id),
        "item_name": batch.item.name,
        "spec_id": str(batch.spec_id) if batch.spec_id else None,
        "received_qty": batch.received_qty,
        "unit_cost": round(float(getattr(batch, "unit_cost", 0.0) or 0.0), 4),
        "cost_source": getattr(batch, "cost_source", None),
        "supplier_id": str(batch.supplier_id) if getattr(batch, "supplier_id", None) else None,
        "supplier_name": getattr(batch, "supplier_name_snapshot", None),
        "current_balance": round(physical, 2),
        "reserved_qty": round(reserved, 2),
        "dispatch_allocated_qty": round(reserved, 2),
        "available_qty": round(available, 2),
        "location": batch.location,
        "location_id": str(batch.location_id) if batch.location_id else None,
        "stock_status": batch.stock_status,
        "created_at": batch.created_at.isoformat(),
    }


def get_item_batches(item_id: str, db: Session) -> List[Dict]:
    batches = db.query(StockBatch).filter(StockBatch.item_id == item_id).all()
    result = []

    for batch in batches:
        physical = get_batch_balance(str(batch.id), db)
        reserved = get_reserved_qty(db=db, batch_id=str(batch.id))
        result.append(
            {
                "batch_id": str(batch.id),
                "batch_no": batch.batch_no,
                "spec_id": str(batch.spec_id) if batch.spec_id else None,
                "received_qty": batch.received_qty,
                "unit_cost": round(float(getattr(batch, "unit_cost", 0.0) or 0.0), 4),
                "cost_source": getattr(batch, "cost_source", None),
                "supplier_id": str(batch.supplier_id) if getattr(batch, "supplier_id", None) else None,
                "supplier_name": getattr(batch, "supplier_name_snapshot", None),
                "current_balance": round(physical, 2),
                "reserved_qty": round(reserved, 2),
                "dispatch_allocated_qty": round(reserved, 2),
                "available_qty": round(physical - reserved, 2),
                "location": batch.location,
                "location_id": str(batch.location_id) if batch.location_id else None,
                "stock_status": batch.stock_status,
                "created_at": batch.created_at.isoformat(),
            }
        )

    return result


def validate_sufficient_stock(item_id: str, qty_required: float, db: Session) -> bool:
    return get_item_balance(item_id, db) >= qty_required


def validate_batch_sufficient_stock(batch_id: str, qty_required: float, db: Session) -> bool:
    return get_batch_balance(batch_id, db) >= qty_required


def validate_sufficient_available_stock(item_id: str, qty_required: float, db: Session) -> bool:
    return get_available_item_qty(item_id, db) >= qty_required


def validate_batch_sufficient_available_stock(batch_id: str, qty_required: float, db: Session) -> bool:
    return get_available_batch_qty(batch_id, db) >= qty_required
