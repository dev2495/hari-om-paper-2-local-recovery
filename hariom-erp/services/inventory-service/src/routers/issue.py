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
    get_batch_balance,
    get_item_balance,
    validate_batch_sufficient_stock,
    validate_sufficient_stock,
)
from ..utils.auth import require_role, get_current_plant

router = APIRouter(prefix="/issue", tags=["issue"])


class IssueCreate(BaseModel):
    item_id: uuid.UUID
    batch_id: Optional[uuid.UUID] = None
    qty: float
    production_job_id: uuid.UUID
    external_ref: Optional[str] = None


class IssueResponse(BaseModel):
    transaction_id: uuid.UUID
    item_id: uuid.UUID
    batch_id: uuid.UUID
    qty_issued: float
    item_balance: float
    batch_balance: float
    message: str


@router.post("/", response_model=IssueResponse)
def create_issue(
    issue: IssueCreate,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Store", "Admin"])),
):
    item = db.query(ItemMaster).filter(
        ItemMaster.id == issue.item_id,
        ItemMaster.plant_id == plant_id
    ).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")

    if not validate_sufficient_stock(str(issue.item_id), issue.qty, db):
        raise HTTPException(
            status_code=400,
            detail=f"Insufficient stock for {item.name}. Available: {get_item_balance(str(issue.item_id), db)} {item.uom.value}",
        )

    selected_batch_id = issue.batch_id

    if selected_batch_id:
        if not validate_batch_sufficient_stock(str(selected_batch_id), issue.qty, db):
            batch = db.query(StockBatch).filter(
                StockBatch.id == selected_batch_id,
                StockBatch.plant_id == plant_id
            ).first()
            if not batch:
                 raise HTTPException(status_code=404, detail="Batch not found in this plant")
            raise HTTPException(
                status_code=400,
                detail=f"Insufficient stock in batch {batch.batch_no if batch else selected_batch_id}",
            )
    else:
        batches = (
            db.query(StockBatch)
            .filter(
                StockBatch.item_id == issue.item_id,
                StockBatch.plant_id == plant_id
            )
            .order_by(StockBatch.created_at.asc())
            .all()
        )
        for batch in batches:
            if validate_batch_sufficient_stock(str(batch.id), issue.qty, db):
                selected_batch_id = batch.id
                break

        if not selected_batch_id:
            raise HTTPException(status_code=400, detail="No batch with sufficient stock found")

    transaction = StockTransaction(
        item_id=issue.item_id,
        batch_id=selected_batch_id,
        transaction_type=TransactionType.ISSUE_PRODUCTION,
        qty_change=-issue.qty,
        reference_type=ReferenceType.PRODUCTION_JOB,
        reference_id=issue.production_job_id,
        plant_id=plant_id,
        external_ref=issue.external_ref,
    )
    db.add(transaction)
    db.commit()

    return IssueResponse(
        transaction_id=transaction.id,
        item_id=issue.item_id,
        batch_id=selected_batch_id,
        qty_issued=issue.qty,
        item_balance=get_item_balance(str(issue.item_id), db),
        batch_balance=get_batch_balance(str(selected_batch_id), db),
        message=f"Issued {issue.qty} {item.uom.value} of {item.name} to production job",
    )
