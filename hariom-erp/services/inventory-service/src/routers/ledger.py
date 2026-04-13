from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import List, Optional
import uuid
from ..database import get_db
from ..models import StockTransaction
from ..utils.auth import get_current_user, get_current_plant
from ..services import get_item_ledger, get_batch_ledger

router = APIRouter(tags=["ledger"])

@router.get("/ledger")
def get_ledger(
    item_id: Optional[uuid.UUID] = Query(None, description="Filter by item ID"),
    batch_id: Optional[uuid.UUID] = Query(None, description="Filter by batch ID"),
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(get_current_user)
):
    """
    Get transaction ledger for item or batch.
    
    Query params:
    - item_id: Show all transactions for an item
    - batch_id: Show all transactions for a specific batch
    """
    if not item_id and not batch_id:
        transactions = db.query(StockTransaction).filter(
            StockTransaction.plant_id == plant_id
        ).order_by(StockTransaction.created_at.desc()).limit(200).all()
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
                }
                for txn in transactions
            ],
        }
    
    if item_id and batch_id:
        raise HTTPException(status_code=400, detail="Provide only one of item_id or batch_id, not both")
    
    if item_id:
        # Verify item ownership
        from ..models import ItemMaster
        item = db.query(ItemMaster).filter(ItemMaster.id == item_id, ItemMaster.plant_id == plant_id).first()
        if not item:
            raise HTTPException(status_code=404, detail="Item not found plus plant isolation")
            
        ledger = get_item_ledger(str(item_id), db)
        return {
            "type": "item",
            "item_id": str(item_id),
            "transaction_count": len(ledger),
            "ledger": ledger
        }
    
    if batch_id:
        # Verify batch ownership
        from ..models import StockBatch
        batch = db.query(StockBatch).filter(StockBatch.id == batch_id, StockBatch.plant_id == plant_id).first()
        if not batch:
            raise HTTPException(status_code=404, detail="Batch not found plus plant isolation")
            
        ledger = get_batch_ledger(str(batch_id), db)
        return {
            "type": "batch",
            "batch_id": str(batch_id),
            "transaction_count": len(ledger),
            "ledger": ledger
        }
