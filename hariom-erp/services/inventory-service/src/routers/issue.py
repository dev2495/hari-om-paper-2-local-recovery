from datetime import date
import logging
from typing import Optional
import uuid
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import (
    ItemMaster,
    ItemType,
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
from ..utils.audit_client import emit_audit_event
from ..utils.auth import require_role, get_current_plant

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/issue", tags=["issue"])
MANUAL_REASON_CODES = {
    "NON_RECIPE_CONSUMABLE",
    "DIRECT_CORRECTION",
    "CONTROLLED_FALLBACK",
}


class IssueCreate(BaseModel):
    item_id: uuid.UUID
    batch_id: Optional[uuid.UUID] = None
    qty: float
    production_job_id: uuid.UUID
    reason_code: str
    notes: Optional[str] = None
    allow_raw_paper_exception: bool = False
    external_ref: Optional[str] = None
    effective_date: Optional[date] = None


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
    reason_code = str(issue.reason_code or "").strip().upper()
    if reason_code not in MANUAL_REASON_CODES:
        raise HTTPException(
            status_code=400,
            detail=f"reason_code must be one of {', '.join(sorted(MANUAL_REASON_CODES))}",
        )

    item = db.query(ItemMaster).filter(
        ItemMaster.id == issue.item_id,
        ItemMaster.plant_id == plant_id
    ).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    if item.type == ItemType.FINISHED_GOOD:
        raise HTTPException(status_code=400, detail="Finished goods cannot be manually issued to production")
    if item.type == ItemType.RAW_PAPER and not issue.allow_raw_paper_exception:
        raise HTTPException(
            status_code=400,
            detail="Use RM Issue to Section for raw paper. Manual raw-paper issue is exception-only and requires an explicit raw-paper override.",
        )

    if not validate_sufficient_stock(str(issue.item_id), issue.qty, db):
        raise HTTPException(
            status_code=400,
            detail=f"Insufficient stock for {item.name}. Available: {get_item_balance(str(issue.item_id), db)} {item.uom.value}",
        )

    selected_batch_id = issue.batch_id
    batch = None

    if selected_batch_id:
        batch = db.query(StockBatch).filter(
            StockBatch.id == selected_batch_id,
            StockBatch.plant_id == plant_id
        ).first()
        if not batch:
            raise HTTPException(status_code=404, detail="Batch not found in this plant")
        if batch.stock_status not in {"UNRESTRICTED", "WIP"}:
            raise HTTPException(status_code=400, detail=f"Batch is not issuable ({batch.stock_status})")
        if not validate_batch_sufficient_stock(str(selected_batch_id), issue.qty, db):
            raise HTTPException(
                status_code=400,
                detail=f"Insufficient stock in batch {batch.batch_no if batch else selected_batch_id}",
            )
    else:
        batches = (
            db.query(StockBatch)
            .filter(
                StockBatch.item_id == issue.item_id,
                StockBatch.plant_id == plant_id,
                StockBatch.stock_status.in_(["UNRESTRICTED", "WIP"])
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

    effective_date_value = issue.effective_date or date.today()

    transaction = StockTransaction(
        item_id=issue.item_id,
        batch_id=selected_batch_id,
        transaction_type=TransactionType.ISSUE_PRODUCTION,
        qty_change=-issue.qty,
        reference_type=ReferenceType.PRODUCTION_JOB,
        reference_id=issue.production_job_id,
        plant_id=plant_id,
        location_id=batch.location_id if batch else None,
        stock_status=batch.stock_status if batch else "WIP",
        movement_metadata={
            "production_job_id": str(issue.production_job_id),
            "reason_code": reason_code,
            "notes": issue.notes,
            "allow_raw_paper_exception": bool(issue.allow_raw_paper_exception),
            "manual_exception": True,
        },
        external_ref=issue.external_ref,
        effective_date=effective_date_value,
    )
    db.add(transaction)
    db.commit()

    try:
        emit_audit_event(
            token=current_user.get("token", ""),
            event_type="stock_issued",
            entity_type="stock_transaction",
            entity_id=str(transaction.id),
            plant_id=str(plant_id),
            actor_role=current_user.get("role"),
            actor_email=current_user.get("sub"),
            summary=f"Manual issue: {issue.qty} {item.uom.value} of {item.name} ({reason_code})",
            payload={
                "item_id": str(issue.item_id),
                "batch_id": str(selected_batch_id),
                "qty": float(issue.qty),
                "production_job_id": str(issue.production_job_id),
                "reason_code": reason_code,
                "effective_date": effective_date_value.isoformat(),
                "manual_exception": True,
            },
        )
    except Exception as exc:
        logger.warning("audit emit failed for stock_issued (%s): %s", transaction.id, exc)

    return IssueResponse(
        transaction_id=transaction.id,
        item_id=issue.item_id,
        batch_id=selected_batch_id,
        qty_issued=issue.qty,
        item_balance=get_item_balance(str(issue.item_id), db),
        batch_balance=get_batch_balance(str(selected_batch_id), db),
        message=f"Issued {issue.qty} {item.uom.value} of {item.name} as a manual exception against production",
    )
