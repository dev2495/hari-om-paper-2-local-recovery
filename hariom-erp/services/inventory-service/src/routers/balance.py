import uuid
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import ItemMaster
from ..services import (
    get_all_items_balance,
    get_available_item_qty,
    get_item_balance,
    get_item_batches,
    get_reserved_qty,
    get_batch_details,
)
from ..utils.auth import get_current_user, get_current_plant

router = APIRouter(tags=["balance"])


@router.get("/balance/{item_id}")
def get_item_balance_endpoint(
    item_id: uuid.UUID,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(get_current_user),
):
    item = db.query(ItemMaster).filter(
        ItemMaster.id == item_id,
        ItemMaster.plant_id == plant_id
    ).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")

    return {
        "item_id": str(item_id),
        "item_code": item.item_code,
        "name": item.name,
        "type": item.type.value,
        "uom": item.uom.value,
        "current_balance": round(get_item_balance(str(item_id), db), 2),
        "reserved_qty": round(get_reserved_qty(db=db, item_id=str(item_id)), 2),
        "available_qty": round(get_available_item_qty(str(item_id), db), 2),
        "batches": get_item_batches(str(item_id), db),
    }


@router.get("/batch-balance/{batch_id}")
def get_batch_balance_endpoint(
    batch_id: uuid.UUID,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(get_current_user),
):
    from ..models import StockBatch
    batch = db.query(StockBatch).filter(
        StockBatch.id == batch_id,
        StockBatch.plant_id == plant_id
    ).first()
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found in this plant")
        
    batch_details = get_batch_details(str(batch_id), db)
    if not batch_details:
        raise HTTPException(status_code=404, detail="Batch not found")
    return batch_details


@router.get("/all-balances")
def get_all_balances(
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(get_current_user),
):
    balances = get_all_items_balance(db, plant_id=plant_id)
    return {
        "item_count": len(balances),
        "items": balances,
    }
