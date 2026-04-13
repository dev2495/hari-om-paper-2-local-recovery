"""
Stock and Reservation Calculation Service.

Physical stock is always computed from stock transactions.
Reservations are tracked separately and deducted to compute availability.
"""
from typing import Dict, List, Optional
from sqlalchemy import func
from sqlalchemy.orm import Session
from ..models import ItemMaster, Reservation, ReservationStatus, StockBatch, StockTransaction


def get_item_balance(item_id: str, db: Session) -> float:
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
    query = db.query(
        func.sum(Reservation.reserved_qty - Reservation.consumed_qty)
    ).filter(Reservation.status == ReservationStatus.ACTIVE)

    if item_id:
        query = query.filter(Reservation.item_id == item_id)
    if batch_id:
        query = query.filter(Reservation.batch_id == batch_id)

    result = query.scalar()
    return float(result or 0.0)


def get_available_item_qty(item_id: str, db: Session) -> float:
    physical = get_item_balance(item_id, db)
    reserved = get_reserved_qty(db=db, item_id=item_id)
    return round(physical - reserved, 2)


def get_available_batch_qty(batch_id: str, db: Session) -> float:
    physical = get_batch_balance(batch_id, db)
    reserved = get_reserved_qty(db=db, batch_id=batch_id)
    return round(physical - reserved, 2)


def get_item_ledger(item_id: str, db: Session) -> List[Dict]:
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
                "external_ref": txn.external_ref,
                "batch_id": str(txn.batch_id) if txn.batch_id else None,
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
                "external_ref": txn.external_ref,
                "running_balance": round(running_balance, 2),
            }
        )

    return list(reversed(ledger))


def get_all_items_balance(db: Session, plant_id: Optional[str] = None) -> List[Dict]:
    query = db.query(ItemMaster).filter(ItemMaster.active == "true")
    if plant_id:
        query = query.filter(ItemMaster.plant_id == plant_id)
    items = query.all()
    balances = []

    for item in items:
        physical = get_item_balance(str(item.id), db)
        reserved = get_reserved_qty(db=db, item_id=str(item.id))
        available = physical - reserved
        balances.append(
            {
                "item_id": str(item.id),
                "item_code": item.item_code,
                "name": item.name,
                "type": item.type.value,
                "uom": item.uom.value,
                "balance": round(physical, 2),
                "reserved_qty": round(reserved, 2),
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
        "current_balance": round(physical, 2),
        "reserved_qty": round(reserved, 2),
        "available_qty": round(available, 2),
        "location": batch.location,
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
                "current_balance": round(physical, 2),
                "reserved_qty": round(reserved, 2),
                "available_qty": round(physical - reserved, 2),
                "location": batch.location,
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
