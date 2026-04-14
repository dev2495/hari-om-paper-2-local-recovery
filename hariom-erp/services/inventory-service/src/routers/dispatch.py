from typing import Optional
import uuid
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import (
    ItemMaster,
    ReferenceType,
    StockBatch,
    StockTransaction,
    TransactionType,
)
from ..services import (
    get_available_batch_qty,
    get_available_item_qty,
    get_batch_balance,
    get_item_balance,
    validate_batch_sufficient_available_stock,
)
from ..utils.auth import require_role, get_current_plant

router = APIRouter(prefix="/dispatch", tags=["dispatch"])


class DispatchCreate(BaseModel):
    item_id: uuid.UUID
    batch_id: Optional[uuid.UUID] = None
    qty: float
    dispatch_ref: str
    external_ref: Optional[str] = None


class DispatchResponse(BaseModel):
    transaction_id: uuid.UUID
    item_id: uuid.UUID
    batch_id: uuid.UUID
    qty_dispatched: float
    item_balance: float
    batch_balance: float
    message: str


@router.post("/", response_model=DispatchResponse)
def create_dispatch(
    dispatch: DispatchCreate,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Store", "Admin", "DispatchApprover", "DispatchMaker"])),
):
    item = db.query(ItemMaster).filter(
        ItemMaster.id == dispatch.item_id,
        ItemMaster.plant_id == plant_id
    ).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")

    external_ref = dispatch.external_ref or dispatch.dispatch_ref
    existing = db.query(StockTransaction).filter(
        StockTransaction.external_ref == external_ref,
        StockTransaction.plant_id == plant_id
    ).first()
    if existing:
        return DispatchResponse(
            transaction_id=existing.id,
            item_id=existing.item_id,
            batch_id=existing.batch_id,
            qty_dispatched=abs(existing.qty_change),
            item_balance=get_item_balance(str(existing.item_id), db),
            batch_balance=get_batch_balance(str(existing.batch_id), db),
            message="Dispatch already posted (idempotent)",
        )

    selected_batch_id = dispatch.batch_id
    batch = None
    if selected_batch_id is None:
        batches = (
            db.query(StockBatch)
            .filter(
                StockBatch.item_id == dispatch.item_id,
                StockBatch.plant_id == plant_id,
                StockBatch.stock_status.in_(["UNRESTRICTED", "DISPATCH_STAGING"])
            )
            .order_by(StockBatch.created_at.asc())
            .all()
        )
        for candidate in batches:
            if validate_batch_sufficient_available_stock(str(candidate.id), dispatch.qty, db):
                selected_batch_id = candidate.id
                batch = candidate
                break
        if selected_batch_id is None:
            raise HTTPException(
                status_code=400,
                detail=f"Insufficient available stock. Available: {get_available_item_qty(str(dispatch.item_id), db)}",
            )

    if batch is None:
        batch = db.query(StockBatch).filter(
            StockBatch.id == selected_batch_id,
            StockBatch.plant_id == plant_id
        ).first()
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")
    if batch.stock_status not in {"UNRESTRICTED", "DISPATCH_STAGING"}:
        raise HTTPException(status_code=400, detail=f"Batch is not dispatchable ({batch.stock_status})")

    if not validate_batch_sufficient_available_stock(str(selected_batch_id), dispatch.qty, db):
        raise HTTPException(
            status_code=400,
            detail=f"Insufficient available qty in batch {batch.batch_no}. Available: {get_available_batch_qty(str(selected_batch_id), db)}",
        )

    transaction = StockTransaction(
        item_id=dispatch.item_id,
        batch_id=selected_batch_id,
        transaction_type=TransactionType.DISPATCH,
        qty_change=-dispatch.qty,
        reference_type=ReferenceType.DISPATCH,
        reference_id=uuid.uuid5(uuid.NAMESPACE_URL, dispatch.dispatch_ref),
        plant_id=plant_id,
        location_id=batch.location_id,
        stock_status=batch.stock_status,
        movement_metadata={"dispatch_ref": dispatch.dispatch_ref},
        external_ref=external_ref,
    )
    db.add(transaction)
    db.commit()

    return DispatchResponse(
        transaction_id=transaction.id,
        item_id=dispatch.item_id,
        batch_id=selected_batch_id,
        qty_dispatched=dispatch.qty,
        item_balance=get_item_balance(str(dispatch.item_id), db),
        batch_balance=get_batch_balance(str(selected_batch_id), db),
        message=f"Dispatched {dispatch.qty} {item.uom.value} of {item.name} (Ref: {dispatch.dispatch_ref})",
    )
