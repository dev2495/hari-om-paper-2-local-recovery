from datetime import datetime
import re
import uuid
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import InventoryLocation, ItemType, ItemMaster, ReferenceType, StockBatch, StockTransaction, TransactionType
from ..services import get_item_balance
from ..utils.auth import require_role, get_current_plant

router = APIRouter(prefix="/fg-inward", tags=["fg-inward"])


def _clean_fg_batch_token(value: Optional[str]) -> str:
    token = re.sub(r"[^A-Z0-9]+", "-", (value or "").strip().upper()).strip("-")
    return token[:32] or "FG"


def _next_system_fg_batch_no(db: Session, item: ItemMaster, plant_id: str) -> str:
    date_part = datetime.utcnow().strftime("%y%m%d")
    item_token = _clean_fg_batch_token(item.item_code or item.name)
    prefix = f"FG-{item_token}-{date_part}"
    for sequence in range(1, 10000):
        candidate = f"{prefix}-{sequence:03d}"
        exists = db.query(StockBatch.id).filter(
            StockBatch.plant_id == plant_id,
            StockBatch.batch_no == candidate,
        ).first()
        if not exists:
            return candidate
    raise HTTPException(status_code=500, detail="Unable to generate FG batch number")


class FGInwardCreate(BaseModel):
    item_id: uuid.UUID
    batch_no: Optional[str] = None
    qty: float
    production_job_id: uuid.UUID
    spec_id: Optional[uuid.UUID] = None
    location_id: Optional[uuid.UUID] = None
    stock_status: str = "UNRESTRICTED"
    external_ref: Optional[str] = None


class FGInwardResponse(BaseModel):
    batch_id: uuid.UUID
    transaction_id: uuid.UUID
    item_id: uuid.UUID
    batch_no: str
    qty_received: float
    location_id: Optional[uuid.UUID] = None
    stock_status: str
    item_balance: float
    message: str


@router.post("/", response_model=FGInwardResponse)
def create_fg_inward(
    fg_inward: FGInwardCreate,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin", "PlantManager", "Operator", "Production", "SupervisorEntry"])),
):
    item = db.query(ItemMaster).filter(
        ItemMaster.id == fg_inward.item_id,
        ItemMaster.plant_id == plant_id
    ).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")

    if item.type != ItemType.FINISHED_GOOD:
        raise HTTPException(
            status_code=400,
            detail=f"Item {item.name} is not a finished good. Type: {item.type.value}",
        )

    location_id = fg_inward.location_id
    if location_id:
        location = db.query(InventoryLocation).filter(
            InventoryLocation.id == location_id,
            InventoryLocation.plant_id == plant_id,
        ).first()
        if not location:
            raise HTTPException(status_code=404, detail="Inventory location not found")

    stock_status = fg_inward.stock_status.strip().upper()
    if stock_status not in {"UNRESTRICTED", "WIP", "QC_HOLD", "BLOCKED", "DISPATCH_STAGING", "SCRAP"}:
        raise HTTPException(status_code=400, detail="Invalid stock_status")

    batch_no = (fg_inward.batch_no or "").strip() or _next_system_fg_batch_no(db, item, plant_id)

    if fg_inward.external_ref:
        existing_txn = db.query(StockTransaction).filter(
            StockTransaction.external_ref == fg_inward.external_ref,
            StockTransaction.plant_id == plant_id
        ).first()
        if existing_txn:
            existing_batch = db.query(StockBatch).filter(StockBatch.id == existing_txn.batch_id).first()
            return FGInwardResponse(
                batch_id=existing_txn.batch_id,
                transaction_id=existing_txn.id,
                item_id=existing_txn.item_id,
                batch_no=existing_batch.batch_no if existing_batch else batch_no,
                qty_received=abs(existing_txn.qty_change),
                location_id=existing_batch.location_id if existing_batch else None,
                stock_status=existing_batch.stock_status if existing_batch else stock_status,
                item_balance=get_item_balance(str(existing_txn.item_id), db),
                message="FG inward already posted (idempotent)",
            )

    batch = StockBatch(
        item_id=fg_inward.item_id,
        batch_no=batch_no,
        received_qty=fg_inward.qty,
        location_id=location_id,
        stock_status=stock_status,
        spec_id=fg_inward.spec_id,
        plant_id=plant_id,
    )
    db.add(batch)
    db.flush()

    transaction = StockTransaction(
        item_id=fg_inward.item_id,
        batch_id=batch.id,
        transaction_type=TransactionType.FG_INWARD,
        qty_change=fg_inward.qty,
        reference_type=ReferenceType.PRODUCTION_JOB,
        reference_id=fg_inward.production_job_id,
        plant_id=plant_id,
        location_id=location_id,
        stock_status=stock_status,
        movement_metadata={"batch_no": batch_no},
        external_ref=fg_inward.external_ref,
    )
    db.add(transaction)
    db.commit()

    return FGInwardResponse(
        batch_id=batch.id,
        transaction_id=transaction.id,
        item_id=fg_inward.item_id,
        batch_no=batch_no,
        qty_received=fg_inward.qty,
        location_id=location_id,
        stock_status=stock_status,
        item_balance=get_item_balance(str(fg_inward.item_id), db),
        message=f"FG inward recorded: {fg_inward.qty} {item.uom.value} of {item.name}",
    )
