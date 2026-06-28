from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session
from typing import List, Optional
import uuid
from datetime import date, datetime
from ..database import get_db
from ..models import ItemMaster, ReferenceType, StockTransaction, TransactionType
from ..utils.auth import get_current_user, get_current_plant_scope
from ..services import get_item_ledger, get_batch_ledger

router = APIRouter(tags=["ledger"])


def _safe_row_date(value: object) -> Optional[date]:
    if value is None:
        return None
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    if isinstance(value, datetime):
        return value.date()
    try:
        text = str(value).replace("Z", "+00:00")
        return datetime.fromisoformat(text).date()
    except ValueError:
        return None


def _business_date_expression():
    return func.coalesce(StockTransaction.effective_date, func.date(StockTransaction.created_at))


@router.get("/ledger")
def get_ledger(
    item_id: Optional[uuid.UUID] = Query(None, description="Filter by item ID"),
    batch_id: Optional[uuid.UUID] = Query(None, description="Filter by batch ID"),
    reference_type: Optional[str] = Query(None, description="Filter by reference type"),
    reference_id: Optional[uuid.UUID] = Query(None, description="Filter by reference ID"),
    transaction_type: Optional[str] = Query(None, description="Filter by transaction type"),
    external_ref: Optional[str] = Query(None, description="Filter by idempotent external reference"),
    location_id: Optional[uuid.UUID] = Query(None, description="Filter by inventory location"),
    status: Optional[str] = Query(None, description="Filter by stock status"),
    date_from: Optional[date] = Query(None, description="Filter ledger from this date"),
    date_to: Optional[date] = Query(None, description="Filter ledger through this date"),
    limit: int = Query(200, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
    current_user: dict = Depends(get_current_user)
):
    """
    Get transaction ledger for item or batch.
    
    Query params:
    - item_id: Show all transactions for an item
    - batch_id: Show all transactions for a specific batch
    """
    normalized_status = status.strip().upper() if status else None
    if normalized_status and normalized_status not in {"UNRESTRICTED", "WIP", "QC_HOLD", "BLOCKED", "DISPATCH_STAGING", "SCRAP"}:
        raise HTTPException(status_code=400, detail="Invalid status filter")
    normalized_reference_type = reference_type.strip().upper() if reference_type else None
    normalized_transaction_type = transaction_type.strip().upper() if transaction_type else None
    if normalized_reference_type and normalized_reference_type not in {item.value for item in ReferenceType}:
        raise HTTPException(status_code=400, detail="Invalid reference_type filter")
    if normalized_transaction_type and normalized_transaction_type not in {item.value for item in TransactionType}:
        raise HTTPException(status_code=400, detail="Invalid transaction_type filter")
    if date_from and date_to and date_from > date_to:
        raise HTTPException(status_code=400, detail="date_from cannot be after date_to")

    if not item_id and not batch_id:
        query = db.query(StockTransaction)
        if plant_scope.get("scope_all"):
            allowed_plants = plant_scope.get("allowed_plants") or []
            if allowed_plants:
                query = query.filter(StockTransaction.plant_id.in_(allowed_plants))
        else:
            query = query.filter(StockTransaction.plant_id == plant_scope["selected_plant_id"])
        if location_id:
            query = query.filter(StockTransaction.location_id == location_id)
        if normalized_status:
            query = query.filter(StockTransaction.stock_status == normalized_status)
        if normalized_reference_type:
            query = query.filter(StockTransaction.reference_type == ReferenceType(normalized_reference_type))
        if reference_id:
            query = query.filter(StockTransaction.reference_id == reference_id)
        if normalized_transaction_type:
            query = query.filter(StockTransaction.transaction_type == TransactionType(normalized_transaction_type))
        if external_ref:
            query = query.filter(StockTransaction.external_ref == external_ref)
        business_date = _business_date_expression()
        if date_from:
            query = query.filter(business_date >= date_from)
        if date_to:
            query = query.filter(business_date <= date_to)
        transactions = query.order_by(StockTransaction.created_at.desc()).offset(offset).limit(limit).all()
        return {
            "type": "all",
            "transaction_count": len(transactions),
            "ledger": [
                {
                    "transaction_id": str(txn.id),
                    "date": txn.effective_date.isoformat() if txn.effective_date else txn.created_at.date().isoformat(),
                    "created_at": txn.created_at.isoformat(),
                    "type": txn.transaction_type.value,
                    "qty_change": txn.qty_change,
                    "reference": f"{txn.reference_type.value}:{str(txn.reference_id)}",
                    "external_ref": txn.external_ref,
                    "batch_id": str(txn.batch_id) if txn.batch_id else None,
                    "item_id": str(txn.item_id) if txn.item_id else None,
                    "reference_type": txn.reference_type.value,
                    "reference_id": str(txn.reference_id),
                    "location_id": str(txn.location_id) if txn.location_id else None,
                    "stock_status": txn.stock_status,
                    "movement_metadata": txn.movement_metadata or {},
                }
                for txn in transactions
            ],
        }
    
    if item_id and batch_id:
        raise HTTPException(status_code=400, detail="Provide only one of item_id or batch_id, not both")
    
    if item_id:
        # Verify item ownership
        from ..models import ItemMaster
        item_query = db.query(ItemMaster).filter(ItemMaster.id == item_id)
        if plant_scope.get("scope_all"):
            allowed_plants = plant_scope.get("allowed_plants") or []
            if allowed_plants:
                item_query = item_query.filter(ItemMaster.plant_id.in_(allowed_plants))
        else:
            item_query = item_query.filter(ItemMaster.plant_id == plant_scope["selected_plant_id"])
        item = item_query.first()
        if not item:
            raise HTTPException(status_code=404, detail="Item not found plus plant isolation")
            
        ledger = get_item_ledger(str(item_id), db)
        if location_id or normalized_status or normalized_reference_type or reference_id or normalized_transaction_type or external_ref or date_from or date_to:
            filtered = []
            for row in ledger:
                if location_id and row.get("location_id") != str(location_id):
                    continue
                if normalized_status and row.get("stock_status") != normalized_status:
                    continue
                if normalized_reference_type and row.get("reference_type") != normalized_reference_type:
                    continue
                if reference_id and row.get("reference_id") != str(reference_id):
                    continue
                if normalized_transaction_type and row.get("type") != normalized_transaction_type:
                    continue
                if external_ref and row.get("external_ref") != external_ref:
                    continue
                row_date = _safe_row_date(row.get("date"))
                if row_date is None:
                    continue
                if date_from and row_date < date_from:
                    continue
                if date_to and row_date > date_to:
                    continue
                filtered.append(row)
            ledger = filtered
        total_count = len(ledger)
        ledger = ledger[offset : offset + limit]
        return {
            "type": "item",
            "item_id": str(item_id),
            "transaction_count": total_count,
            "limit": limit,
            "offset": offset,
            "has_more": (offset + len(ledger)) < total_count,
            "ledger": ledger
        }
    
    if batch_id:
        # Verify batch ownership
        from ..models import StockBatch
        batch_query = db.query(StockBatch).filter(StockBatch.id == batch_id)
        if plant_scope.get("scope_all"):
            allowed_plants = plant_scope.get("allowed_plants") or []
            if allowed_plants:
                batch_query = batch_query.filter(StockBatch.plant_id.in_(allowed_plants))
        else:
            batch_query = batch_query.filter(StockBatch.plant_id == plant_scope["selected_plant_id"])
        batch = batch_query.first()
        if not batch:
            raise HTTPException(status_code=404, detail="Batch not found plus plant isolation")
            
        ledger = get_batch_ledger(str(batch_id), db)
        if location_id or normalized_status or normalized_reference_type or reference_id or normalized_transaction_type or external_ref or date_from or date_to:
            filtered = []
            for row in ledger:
                if location_id and row.get("location_id") != str(location_id):
                    continue
                if normalized_status and row.get("stock_status") != normalized_status:
                    continue
                if normalized_reference_type and row.get("reference_type") != normalized_reference_type:
                    continue
                if reference_id and row.get("reference_id") != str(reference_id):
                    continue
                if normalized_transaction_type and row.get("type") != normalized_transaction_type:
                    continue
                if external_ref and row.get("external_ref") != external_ref:
                    continue
                row_date = _safe_row_date(row.get("date"))
                if row_date is None:
                    continue
                if date_from and row_date < date_from:
                    continue
                if date_to and row_date > date_to:
                    continue
                filtered.append(row)
            ledger = filtered
        total_count = len(ledger)
        ledger = ledger[offset : offset + limit]
        return {
            "type": "batch",
            "batch_id": str(batch_id),
            "transaction_count": total_count,
            "limit": limit,
            "offset": offset,
            "has_more": (offset + len(ledger)) < total_count,
            "ledger": ledger
        }


# ──────────────────────────────────────────────────────────────────────────
# Gap 1: aggregate-by-item — sum of ISSUE_PRODUCTION (+ ISSUE_FROM_REEL) per
# item across a date range. Used by production-service to surface ledger
# consumption in the monthly reconciliation table.
# ──────────────────────────────────────────────────────────────────────────


@router.get("/transactions/aggregate-by-item")
def aggregate_transactions_by_item(
    start_date: date = Query(...),
    end_date: date = Query(...),
    transaction_types: str = Query("ISSUE_PRODUCTION,ISSUE_FROM_REEL"),
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
    current_user: dict = Depends(get_current_user),
):
    """Sum |qty_change| per item across the given transaction types and range.

    Response: [{ item_id, item_code, item_name, item_type, issued_kg, txn_count }]
    """
    types_requested = {t.strip().upper() for t in (transaction_types or "").split(",") if t.strip()}
    valid_types = {t.value for t in TransactionType}
    type_filter = [t for t in types_requested if t in valid_types]
    if not type_filter:
        type_filter = ["ISSUE_PRODUCTION"]

    business_date = _business_date_expression()

    query = (
        db.query(
            ItemMaster.id.label("item_id"),
            ItemMaster.item_code.label("item_code"),
            ItemMaster.name.label("item_name"),
            ItemMaster.type.label("item_type"),
            func.coalesce(func.sum(func.abs(StockTransaction.qty_change)), 0.0).label("issued_kg"),
            func.count(StockTransaction.id).label("txn_count"),
        )
        .join(ItemMaster, ItemMaster.id == StockTransaction.item_id)
        .filter(
            StockTransaction.transaction_type.in_(type_filter),
            business_date >= start_date,
            business_date <= end_date,
        )
    )

    if plant_scope.get("scope_all"):
        allowed = plant_scope.get("allowed_plants") or []
        if allowed:
            query = query.filter(StockTransaction.plant_id.in_(allowed))
    else:
        query = query.filter(StockTransaction.plant_id == plant_scope["selected_plant_id"])

    rows = query.group_by(
        ItemMaster.id, ItemMaster.item_code, ItemMaster.name, ItemMaster.type
    ).all()

    out = []
    for row in rows:
        item_type_value = row.item_type.value if row.item_type and hasattr(row.item_type, "value") else (str(row.item_type) if row.item_type else None)
        out.append(
            {
                "item_id": str(row.item_id),
                "item_code": row.item_code,
                "item_name": row.item_name,
                "item_type": item_type_value,
                "issued_kg": float(row.issued_kg or 0.0),
                "txn_count": int(row.txn_count or 0),
            }
        )
    return out
