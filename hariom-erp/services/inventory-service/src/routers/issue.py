from datetime import date, datetime
from zoneinfo import ZoneInfo
import logging
from typing import Optional
import uuid
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, text
from sqlalchemy.orm import Session
from ..services.procurement import canonical_hash

from ..concession_use import guard_concession_stock
from ..database import get_db
from ..models import (
    ItemMaster,
    ItemType,
    ReferenceType,
    StockBatch,
    StockTransaction,
    TransactionType,
)
from ..services.books import assert_books_open, ist_today
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
    "FLOOR_ISSUE",
    "NON_RECIPE_CONSUMABLE",
    "DIRECT_CORRECTION",
    "CONTROLLED_FALLBACK",
}
VALID_SHIFTS = {"A", "B", "C", "GENERAL", "DAY", "NIGHT"}
ISSUABLE_BATCH_STATUSES = ("UNRESTRICTED", "WIP")


def _qty_text(value: float, uom: str) -> str:
    unit = {"KG": "kg", "PCS": "pcs", "L": "L"}.get(str(uom or "").upper(), str(uom or "").lower())
    return f"{round(float(value or 0.0), 3):g} {unit}"


def check_issue_quantity(qty: float, uom: str, on_hand: float, item_name: str) -> None:
    """Issue units follow the item master (client 2026-10-26): pieces are whole numbers, and
    nothing beyond the cleared (on-hand) stock can go to the floor."""
    if str(uom or "").upper() == "PCS" and abs(float(qty) - round(float(qty))) > 1e-9:
        raise HTTPException(status_code=422, detail=f"{item_name} is counted in pieces. Enter a whole number.")
    if float(qty) > float(on_hand) + 1e-9:
        raise HTTPException(
            status_code=400,
            detail=f"Only {_qty_text(on_hand, uom)} of {item_name} is in stock and cleared for issue. You asked for {_qty_text(qty, uom)}.",
        )


def _issuable_batches(db: Session, item_id, plant_id: str) -> list[tuple[StockBatch, float]]:
    """Cleared lots of the item, oldest first, with their balances (lots with nothing left are skipped)."""
    batches = (
        db.query(StockBatch)
        .filter(
            StockBatch.item_id == item_id,
            StockBatch.plant_id == plant_id,
            StockBatch.stock_status.in_(ISSUABLE_BATCH_STATUSES),
        )
        .order_by(StockBatch.created_at.asc())
        .with_for_update()
        .populate_existing()
        .all()
    )
    if not batches:
        return []
    balances = dict(
        db.query(StockTransaction.batch_id, func.sum(StockTransaction.qty_change))
        .filter(StockTransaction.batch_id.in_([batch.id for batch in batches]))
        .group_by(StockTransaction.batch_id)
        .all()
    )
    return [(batch, float(balances.get(batch.id) or 0.0)) for batch in batches if float(balances.get(batch.id) or 0.0) > 1e-9]


class IssueCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    item_id: uuid.UUID
    batch_id: Optional[uuid.UUID] = None
    qty: float = Field(gt=0)
    # Floor issue (client rule 2026-10-18): material goes to the floor for a shift, not to a job
    # card; the job card records what the floor made and the stock count settles consumption.
    production_job_id: Optional[uuid.UUID] = None
    shift: Optional[str] = None
    reason_code: str = "FLOOR_ISSUE"
    notes: Optional[str] = None
    allow_raw_paper_exception: bool = False
    external_ref: Optional[str] = None
    effective_date: Optional[date] = None
    customer_id: Optional[uuid.UUID] = None
    sales_order_id: Optional[uuid.UUID] = None


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
    # PlantManager issues material as they issue reels and parchment (role matrix); returns stay with Stores.
    current_user: dict = Depends(require_role(["Store", "PlantManager", "Admin", "RMIssue"])),
):
    reason_code = str(issue.reason_code or "FLOOR_ISSUE").strip().upper()
    shift = str(issue.shift or "").strip().upper() or None
    if shift and shift not in VALID_SHIFTS:
        raise HTTPException(status_code=400, detail="Invalid shift")
    if reason_code == "FLOOR_ISSUE" and not shift:
        raise HTTPException(status_code=422, detail="Choose the shift the material is issued for")
    if reason_code != "FLOOR_ISSUE" and issue.production_job_id is None:
        raise HTTPException(status_code=422, detail="A correction issue names the job card it corrects")
    if reason_code not in MANUAL_REASON_CODES:
        raise HTTPException(
            status_code=400,
            detail=f"reason_code must be one of {', '.join(sorted(MANUAL_REASON_CODES))}",
        )

    item = db.query(ItemMaster).filter(
        ItemMaster.id == issue.item_id,
        ItemMaster.plant_id == plant_id
    ).with_for_update().populate_existing().first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    if item.type == ItemType.FINISHED_GOOD:
        raise HTTPException(status_code=400, detail="Finished goods cannot be manually issued to production")
    if str(getattr(item.tracking_mode, "value", item.tracking_mode)) == "REEL":
        raise HTTPException(
            status_code=400,
            detail="Use reel/coil issue so physical identities and mandatory slitting are preserved.",
        )

    uom = item.uom.value
    # The issue day is the IST business day; a closed month takes no more issues (spec 2.5).
    effective_date_value = issue.effective_date or ist_today()
    assert_books_open(db, plant_id, effective_date_value)
    # A chosen lot is checked on its own balance below (it may be released by concession).
    cleared = [] if issue.batch_id else _issuable_batches(db, issue.item_id, plant_id)
    check_issue_quantity(issue.qty, uom, float("inf") if issue.batch_id else sum(balance for _, balance in cleared), item.name)

    selected_batch_id = issue.batch_id
    batch = None
    # (batch, qty) pieces: one lot when chosen, else the oldest cleared lots first.
    allocations: list[tuple[StockBatch, float]] = []

    if selected_batch_id:
        batch = db.query(StockBatch).filter(
            StockBatch.id == selected_batch_id,
            StockBatch.item_id == issue.item_id,
            StockBatch.plant_id == plant_id
        ).with_for_update().populate_existing().first()
        if not batch:
            raise HTTPException(status_code=404, detail="Batch not found in this plant")
        guard_concession_stock(
            db,
            plant_id=plant_id,
            entity=batch,
            customer_id=issue.customer_id,
            sales_order_id=issue.sales_order_id,
            allowed_statuses={"UNRESTRICTED", "WIP"},
            blocked_detail=f"Batch is not issuable ({batch.stock_status})",
        )
        batch_left = get_batch_balance(str(selected_batch_id), db)
        if float(issue.qty) > batch_left + 1e-9:
            raise HTTPException(
                status_code=400,
                detail=f"Only {_qty_text(batch_left, uom)} is left in lot {batch.batch_no}. Choose another lot or issue less.",
            )
        allocations = [(batch, float(issue.qty))]
    else:
        left = float(issue.qty)
        for candidate, balance in cleared:
            if left <= 1e-9:
                break
            take = round(min(left, balance), 6)
            allocations.append((candidate, take))
            left = round(left - take, 6)
        if not allocations or left > 1e-6:
            raise HTTPException(status_code=400, detail=f"Not enough cleared stock of {item.name} to issue {_qty_text(issue.qty, uom)}.")
        batch, selected_batch_id = allocations[0][0], allocations[0][0].id

    reference_id = issue.production_job_id or uuid.uuid4()

    transactions: list[StockTransaction] = []
    for index, (lot, take) in enumerate(allocations, start=1):
        transactions.append(StockTransaction(
            item_id=issue.item_id,
            batch_id=lot.id,
            transaction_type=TransactionType.ISSUE_PRODUCTION,
            qty_change=-take,
            reference_type=ReferenceType.PRODUCTION_JOB if issue.production_job_id else ReferenceType.INTERNAL,
            reference_id=reference_id,
            plant_id=plant_id,
            location_id=lot.location_id,
            stock_status=lot.stock_status,
            movement_metadata={
                "production_job_id": str(issue.production_job_id) if issue.production_job_id else None,
                "destination": "FLOOR" if reason_code == "FLOOR_ISSUE" else "JOB_CARD",
                "shift": shift,
                "reason_code": reason_code,
                "notes": issue.notes,
                "allow_raw_paper_exception": bool(issue.allow_raw_paper_exception),
                "manual_exception": reason_code != "FLOOR_ISSUE",
                **({"split_part": index, "split_parts": len(allocations)} if len(allocations) > 1 else {}),
            },
            # One request may draw on several lots (oldest first); each part keeps a unique ref.
            external_ref=(issue.external_ref if index == 1 or not issue.external_ref else f"{issue.external_ref[:114]}#{index}"),
            effective_date=effective_date_value,
        ))
    db.add_all(transactions)
    db.commit()
    transaction = transactions[0]

    try:
        emit_audit_event(
            token=current_user.get("token", ""),
            event_type="stock_issued",
            entity_type="stock_transaction",
            entity_id=str(transaction.id),
            plant_id=str(plant_id),
            actor_role=current_user.get("role"),
            actor_email=current_user.get("sub"),
            summary=(f"Floor issue: {issue.qty} {item.uom.value} of {item.name} for shift {shift}" if reason_code == "FLOOR_ISSUE" else f"Manual issue: {issue.qty} {item.uom.value} of {item.name} ({reason_code})"),
            payload={
                "item_id": str(issue.item_id),
                "batch_id": str(selected_batch_id),
                "qty": float(issue.qty),
                "production_job_id": str(issue.production_job_id) if issue.production_job_id else None,
                "shift": shift,
                "reason_code": reason_code,
                "effective_date": effective_date_value.isoformat(),
                "manual_exception": reason_code != "FLOOR_ISSUE",
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
        message=(f"Issued {issue.qty} {item.uom.value} of {item.name} to the floor for shift {shift}" if reason_code == "FLOOR_ISSUE" else f"Issued {issue.qty} {item.uom.value} of {item.name} as a manual exception against production"),
    )


class ProductionReturnCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    request_id: uuid.UUID
    issue_id: uuid.UUID
    quantity: float = Field(gt=0)
    effective_date: date
    reason: str = Field(min_length=3, max_length=1000)


FLOOR_RETURN_RETIRED = "Nothing comes back from the floor: issued material is used when it is issued. If it is still in the store, record it in a stock count."


def _returned_quantity(db, plant_id, issue_id):
    return float(db.query(func.coalesce(func.sum(StockTransaction.qty_change), 0)).filter(
        StockTransaction.plant_id == plant_id,
        StockTransaction.transaction_type == TransactionType.PRODUCTION_RETURN,
        StockTransaction.movement_metadata["original_issue_id"].as_string() == str(issue_id),
    ).scalar())


@router.get("/returnable")
def list_returnable_issues(db: Session = Depends(get_db), plant_id: str = Depends(get_current_plant), current_user: dict = Depends(require_role(["Store", "Admin", "RMIssue"]))):
    # Rule 0.1: nothing returns from the floor; everything issued is consumed when it is issued.
    return {"items": [], "retired": True, "message": FLOOR_RETURN_RETIRED}
    issues = db.query(StockTransaction, ItemMaster, StockBatch).join(ItemMaster, ItemMaster.id == StockTransaction.item_id).join(
        StockBatch, StockBatch.id == StockTransaction.batch_id).filter(
        StockTransaction.plant_id == plant_id, StockTransaction.transaction_type == TransactionType.ISSUE_PRODUCTION,
    ).order_by(StockTransaction.created_at.desc()).all()
    returned = dict(db.query(StockTransaction.movement_metadata["original_issue_id"].as_string(),
        func.sum(StockTransaction.qty_change)).filter(StockTransaction.plant_id == plant_id,
        StockTransaction.transaction_type == TransactionType.PRODUCTION_RETURN).group_by(
        StockTransaction.movement_metadata["original_issue_id"].as_string()).all())
    rows = []
    for issue, item, batch in issues:
        remaining = round(-float(issue.qty_change) - float(returned.get(str(issue.id), 0)), 6)
        if remaining > 0 and (issue.movement_metadata or {}).get("destination") != "FLOOR":
            rows.append({"id": str(issue.id), "item_code": item.item_code, "item_name": item.name,
                "batch_no": batch.batch_no, "uom": str(getattr(item.uom, "value", item.uom)),
                "issued": -float(issue.qty_change), "returnable": remaining,
                "issue_date": issue.effective_date, "production_job_id": str(issue.reference_id)})
    return {"items": rows}


@router.post("/returns")
def return_from_production(payload: ProductionReturnCreate, db: Session = Depends(get_db), plant_id: str = Depends(get_current_plant), current_user: dict = Depends(require_role(["Store", "Admin", "RMIssue"]))):
    # Rule 0.1: nothing returns from the floor. Material found in the store after it was issued is recorded in a
    # stock count (the Owner adds it as new stock on QC hold); the issue itself is never reversed.
    raise HTTPException(409, FLOOR_RETURN_RETIRED)
    fingerprint = canonical_hash(payload.model_dump(mode="json", exclude={"request_id"}))
    db.execute(text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"), {"key": f"production-return:{plant_id}:{payload.request_id}"})
    existing = db.query(StockTransaction).filter(StockTransaction.plant_id == plant_id,
        StockTransaction.transaction_type == TransactionType.PRODUCTION_RETURN,
        StockTransaction.movement_metadata["request_id"].as_string() == str(payload.request_id)).first()
    if existing:
        if existing.movement_metadata.get("request_fingerprint") != fingerprint:
            raise HTTPException(409, "Request key already used with different return details")
        return {"transaction_id": str(existing.id), "returned": float(existing.qty_change), "idempotent": True}
    # Lock the source issue before measuring remaining returns: concurrent returns cannot over-credit stock.
    issue = db.query(StockTransaction).filter_by(id=payload.issue_id, plant_id=plant_id,
        transaction_type=TransactionType.ISSUE_PRODUCTION).with_for_update().populate_existing().first()
    if not issue or not issue.batch_id:
        raise HTTPException(404, "Production issue not found in this plant")
    if (issue.movement_metadata or {}).get("destination") == "FLOOR":
        raise HTTPException(409, "Material issued to the floor is consumed in full; nothing comes back to store")
    if payload.effective_date > datetime.now(ZoneInfo("Asia/Kolkata")).date() or (issue.effective_date and payload.effective_date < issue.effective_date):
        raise HTTPException(422, "Return date must be between the original issue date and today")
    if len(payload.reason.strip()) < 3:
        raise HTTPException(422, "Explain why the material is being returned")
    assert_books_open(db, plant_id, payload.effective_date)
    remaining = -float(issue.qty_change) - _returned_quantity(db, plant_id, issue.id)
    if payload.quantity > remaining + 0.000001:
        raise HTTPException(409, f"Return exceeds the {remaining:g} still outstanding from this issue")
    batch = db.query(StockBatch).filter_by(id=issue.batch_id, plant_id=plant_id).with_for_update().populate_existing().one()
    transaction = StockTransaction(item_id=issue.item_id, batch_id=batch.id,
        plant_id=plant_id, transaction_type=TransactionType.PRODUCTION_RETURN, qty_change=payload.quantity,
        reference_type=issue.reference_type, reference_id=issue.reference_id, location_id=batch.location_id,
        stock_status=batch.stock_status, effective_date=payload.effective_date,
        movement_metadata={"original_issue_id": str(issue.id), "request_id": str(payload.request_id),
            "request_fingerprint": fingerprint, "reason": payload.reason.strip(), "returned_by": current_user.get("sub")})
    db.add(transaction); db.commit(); db.refresh(transaction)
    return {"transaction_id": str(transaction.id), "returned": float(transaction.qty_change), "idempotent": False}
