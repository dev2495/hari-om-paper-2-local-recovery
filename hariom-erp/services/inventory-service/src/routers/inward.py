from typing import Optional
import uuid
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import ItemMaster, ReferenceType, StockBatch, StockTransaction, TransactionType
from ..services import get_batch_balance, get_item_balance
from ..utils.auth import require_role, get_current_plant

router = APIRouter(prefix="/inward", tags=["inward"])


class InwardCreate(BaseModel):
    item_id: uuid.UUID
    batch_no: str
    qty: float
    location: Optional[str] = None
    reference_type: str = "PURCHASE"
    reference_id: Optional[uuid.UUID] = None
    spec_id: Optional[uuid.UUID] = None
    external_ref: Optional[str] = None


class InwardResponse(BaseModel):
    batch_id: uuid.UUID
    transaction_id: uuid.UUID
    item_id: uuid.UUID
    batch_no: str
    qty_received: float
    item_balance: float
    batch_balance: float
    message: str


@router.post("/", response_model=InwardResponse)
def create_inward(
    inward: InwardCreate,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Store", "Admin"])),
):
    item = db.query(ItemMaster).filter(
        ItemMaster.id == inward.item_id,
        ItemMaster.plant_id == plant_id
    ).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")

    batch = StockBatch(
        item_id=inward.item_id,
        batch_no=inward.batch_no,
        received_qty=inward.qty,
        location=inward.location,
        spec_id=inward.spec_id,
        plant_id=plant_id,
    )
    db.add(batch)
    db.flush()

    try:
        ref_type = ReferenceType(inward.reference_type)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid reference_type")

    transaction = StockTransaction(
        item_id=inward.item_id,
        batch_id=batch.id,
        transaction_type=TransactionType.INWARD,
        qty_change=inward.qty,
        reference_type=ref_type,
        reference_id=inward.reference_id or batch.id,
        plant_id=plant_id,
        external_ref=inward.external_ref,
    )
    db.add(transaction)
    db.commit()

    return InwardResponse(
        batch_id=batch.id,
        transaction_id=transaction.id,
        item_id=inward.item_id,
        batch_no=inward.batch_no,
        qty_received=inward.qty,
        item_balance=get_item_balance(str(inward.item_id), db),
        batch_balance=get_batch_balance(str(batch.id), db),
        message=f"Inward recorded: {inward.qty} {item.uom.value} of {item.name}",
    )
