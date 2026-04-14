from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import List, Optional
import uuid
from ..database import get_db
from ..models import StockTransaction
from ..utils.auth import get_current_user, get_current_plant_scope
from ..services import get_item_ledger, get_batch_ledger

router = APIRouter(tags=["ledger"])

@router.get("/ledger")
def get_ledger(
    item_id: Optional[uuid.UUID] = Query(None, description="Filter by item ID"),
    batch_id: Optional[uuid.UUID] = Query(None, description="Filter by batch ID"),
    location_id: Optional[uuid.UUID] = Query(None, description="Filter by inventory location"),
    status: Optional[str] = Query(None, description="Filter by stock status"),
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
        transactions = query.order_by(StockTransaction.created_at.desc()).limit(200).all()
        return {
            "type": "all",
            "transaction_count": len(transactions),
            "ledger": [
                {
                    "transaction_id": str(txn.id),
                    "date": txn.created_at.isoformat(),
                    "type": txn.transaction_type.value,
                    "qty_change": txn.qty_change,
                    "reference": f"{txn.reference_type.value}:{str(txn.reference_id)}",
                    "external_ref": txn.external_ref,
                    "batch_id": str(txn.batch_id) if txn.batch_id else None,
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
        if location_id or normalized_status:
            filtered = []
            for row in ledger:
                if location_id and row.get("location_id") != str(location_id):
                    continue
                if normalized_status and row.get("stock_status") != normalized_status:
                    continue
                filtered.append(row)
            ledger = filtered
        return {
            "type": "item",
            "item_id": str(item_id),
            "transaction_count": len(ledger),
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
        if location_id or normalized_status:
            filtered = []
            for row in ledger:
                if location_id and row.get("location_id") != str(location_id):
                    continue
                if normalized_status and row.get("stock_status") != normalized_status:
                    continue
                filtered.append(row)
            ledger = filtered
        return {
            "type": "batch",
            "batch_id": str(batch_id),
            "transaction_count": len(ledger),
            "ledger": ledger
        }
