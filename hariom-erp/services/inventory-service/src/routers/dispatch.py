import logging
from typing import Optional
import uuid
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from ..database import get_db
from ..models import (
    ItemMaster,
    ReferenceType,
    Reservation,
    ReservationStatus,
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
from ..utils.audit_client import emit_audit_event
from ..utils.auth import require_role, get_current_plant

_audit_logger = logging.getLogger(__name__)

router = APIRouter(prefix="/dispatch", tags=["dispatch"])


class DispatchCreate(BaseModel):
    item_id: uuid.UUID
    batch_id: Optional[uuid.UUID] = None
    qty: float = Field(..., gt=0)
    dispatch_ref: str = Field(..., min_length=1, max_length=100)
    external_ref: Optional[str] = None
    existing_transaction_id: Optional[uuid.UUID] = None
    production_job_id: Optional[uuid.UUID] = None
    sales_order_id: Optional[uuid.UUID] = None
    sales_order_line_id: Optional[uuid.UUID] = None


class DispatchResponse(BaseModel):
    transaction_id: uuid.UUID
    item_id: uuid.UUID
    batch_id: uuid.UUID
    qty_dispatched: float
    item_balance: float
    batch_balance: float
    message: str


def _backfill_dispatch_lineage(transaction: StockTransaction, dispatch: DispatchCreate) -> None:
    metadata = dict(transaction.movement_metadata or {})
    updates = {
        "dispatch_ref": dispatch.dispatch_ref,
        "production_job_id": str(dispatch.production_job_id) if dispatch.production_job_id else None,
        "sales_order_id": str(dispatch.sales_order_id) if dispatch.sales_order_id else None,
        "sales_order_line_id": str(dispatch.sales_order_line_id) if dispatch.sales_order_line_id else None,
    }
    changed = False
    for key, value in updates.items():
        if value and not metadata.get(key):
            metadata[key] = value
            changed = True
    if changed:
        transaction.movement_metadata = metadata
        flag_modified(transaction, "movement_metadata")


def _existing_dispatch_response(transaction: StockTransaction, dispatch: DispatchCreate, db: Session) -> DispatchResponse:
    if transaction.item_id != dispatch.item_id:
        raise HTTPException(status_code=409, detail="Existing dispatch transaction belongs to a different item")
    if dispatch.batch_id and transaction.batch_id != dispatch.batch_id:
        raise HTTPException(status_code=409, detail="Existing dispatch transaction belongs to a different batch")
    if transaction.transaction_type != TransactionType.DISPATCH:
        raise HTTPException(status_code=409, detail="Existing transaction is not a dispatch transaction")

    _backfill_dispatch_lineage(transaction, dispatch)

    return DispatchResponse(
        transaction_id=transaction.id,
        item_id=transaction.item_id,
        batch_id=transaction.batch_id,
        qty_dispatched=abs(transaction.qty_change),
        item_balance=get_item_balance(str(transaction.item_id), db),
        batch_balance=get_batch_balance(str(transaction.batch_id), db),
        message="Dispatch already posted (idempotent)",
    )


@router.post("/", response_model=DispatchResponse)
def create_dispatch(
    dispatch: DispatchCreate,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Owner", "Admin", "Dispatch"])),
):
    item = db.query(ItemMaster).filter(
        ItemMaster.id == dispatch.item_id,
        ItemMaster.plant_id == plant_id
    ).with_for_update().first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")

    reservation = None
    reservation_remaining = 0.0
    if dispatch.sales_order_line_id:
        reservation_query = (
            db.query(Reservation)
            .filter(
                Reservation.plant_id == plant_id,
                Reservation.sales_order_line_id == dispatch.sales_order_line_id,
                Reservation.item_id == dispatch.item_id,
                Reservation.status == ReservationStatus.ACTIVE,
            )
        )
        if dispatch.batch_id:
            reservation = reservation_query.filter(Reservation.batch_id == dispatch.batch_id).order_by(Reservation.created_at.asc()).first()
            if reservation is None and reservation_query.first() is not None:
                raise HTTPException(status_code=409, detail="Dispatch batch does not match an active sales-line reservation")
        else:
            reservation = reservation_query.order_by(Reservation.created_at.asc()).first()
        if reservation:
            reservation_remaining = max(0.0, float(reservation.reserved_qty or 0.0) - float(reservation.consumed_qty or 0.0))
            if dispatch.qty > reservation_remaining + 0.0001:
                raise HTTPException(
                    status_code=409,
                    detail=f"Dispatch qty exceeds reserved remaining ({round(reservation_remaining, 2)})",
                )
            if reservation.batch_id and dispatch.batch_id and reservation.batch_id != dispatch.batch_id:
                raise HTTPException(status_code=409, detail="Dispatch batch does not match the sales-line reservation")

    if dispatch.existing_transaction_id:
        existing_by_id = db.query(StockTransaction).filter(
            StockTransaction.id == dispatch.existing_transaction_id,
            StockTransaction.plant_id == plant_id,
        ).first()
        if not existing_by_id:
            raise HTTPException(status_code=404, detail="Existing dispatch transaction not found")
        response = _existing_dispatch_response(existing_by_id, dispatch, db)
        db.commit()
        try:
            emit_audit_event(
                token=current_user.get("token", ""),
                event_type="dispatch_recorded",
                entity_type="stock_transaction",
                entity_id=str(existing_by_id.id),
                plant_id=str(plant_id),
                actor_role=str((current_user.get("roles") or ["?"])[0]),
                actor_email=current_user.get("sub"),
                summary=f"Dispatch lineage backfilled for ref {dispatch.dispatch_ref} (idempotent)",
                payload={
                    "dispatch_ref": dispatch.dispatch_ref,
                    "item_id": str(dispatch.item_id),
                    "batch_id": str(existing_by_id.batch_id) if existing_by_id.batch_id else None,
                    "qty_dispatched": float(abs(existing_by_id.qty_change)),
                    "production_job_id": str(dispatch.production_job_id) if dispatch.production_job_id else None,
                    "sales_order_id": str(dispatch.sales_order_id) if dispatch.sales_order_id else None,
                    "idempotent": True,
                },
            )
        except Exception as exc:
            _audit_logger.warning("audit emit failed for dispatch_recorded (idempotent) %s: %s", existing_by_id.id, exc)
        return response

    external_ref = dispatch.external_ref or dispatch.dispatch_ref
    existing = db.query(StockTransaction).filter(
        StockTransaction.external_ref == external_ref,
        StockTransaction.plant_id == plant_id
    ).first()
    if existing:
        response = _existing_dispatch_response(existing, dispatch, db)
        db.commit()
        try:
            emit_audit_event(
                token=current_user.get("token", ""),
                event_type="dispatch_recorded",
                entity_type="stock_transaction",
                entity_id=str(existing.id),
                plant_id=str(plant_id),
                actor_role=str((current_user.get("roles") or ["?"])[0]),
                actor_email=current_user.get("sub"),
                summary=f"Dispatch lineage backfilled for ref {dispatch.dispatch_ref} (idempotent)",
                payload={
                    "dispatch_ref": dispatch.dispatch_ref,
                    "external_ref": external_ref,
                    "item_id": str(dispatch.item_id),
                    "batch_id": str(existing.batch_id) if existing.batch_id else None,
                    "qty_dispatched": float(abs(existing.qty_change)),
                    "idempotent": True,
                },
            )
        except Exception as exc:
            _audit_logger.warning("audit emit failed for dispatch_recorded (idempotent) %s: %s", existing.id, exc)
        return response

    selected_batch_id = reservation.batch_id if reservation and reservation.batch_id else dispatch.batch_id
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
        ).with_for_update().first()
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")
    if batch.stock_status not in {"UNRESTRICTED", "DISPATCH_STAGING"}:
        raise HTTPException(status_code=400, detail=f"Batch is not dispatchable ({batch.stock_status})")

    effective_batch_available = get_available_batch_qty(str(selected_batch_id), db)
    if reservation and reservation.batch_id == selected_batch_id:
        effective_batch_available += reservation_remaining
    if effective_batch_available + 0.0001 < dispatch.qty:
        raise HTTPException(
            status_code=400,
            detail=f"Insufficient available qty in batch {batch.batch_no}. Available: {round(effective_batch_available, 2)}",
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
        movement_metadata={
            "dispatch_ref": dispatch.dispatch_ref,
            "production_job_id": str(dispatch.production_job_id) if dispatch.production_job_id else None,
            "sales_order_id": str(dispatch.sales_order_id) if dispatch.sales_order_id else None,
            "sales_order_line_id": str(dispatch.sales_order_line_id) if dispatch.sales_order_line_id else None,
            "reservation_id": str(reservation.id) if reservation else None,
        },
        external_ref=external_ref,
    )
    db.add(transaction)
    if reservation:
        reservation.consumed_qty = float(reservation.consumed_qty or 0.0) + float(dispatch.qty)
        if reservation.consumed_qty + 0.0001 >= float(reservation.reserved_qty or 0.0):
            reservation.status = ReservationStatus.CONSUMED
    db.commit()
    try:
        emit_audit_event(
            token=current_user.get("token", ""),
            event_type="dispatch_recorded",
            entity_type="stock_transaction",
            entity_id=str(transaction.id),
            plant_id=str(plant_id),
            actor_role=str((current_user.get("roles") or ["?"])[0]),
            actor_email=current_user.get("sub"),
            summary=f"Dispatched {dispatch.qty} of {item.item_code} (Ref: {dispatch.dispatch_ref})",
            payload={
                "dispatch_ref": dispatch.dispatch_ref,
                "external_ref": external_ref,
                "item_id": str(dispatch.item_id),
                "item_code": item.item_code,
                "batch_id": str(selected_batch_id),
                "qty_dispatched": float(dispatch.qty),
                "production_job_id": str(dispatch.production_job_id) if dispatch.production_job_id else None,
                "sales_order_id": str(dispatch.sales_order_id) if dispatch.sales_order_id else None,
                "sales_order_line_id": str(dispatch.sales_order_line_id) if dispatch.sales_order_line_id else None,
                "reservation_id": str(reservation.id) if reservation else None,
            },
        )
    except Exception as exc:
        _audit_logger.warning("audit emit failed for dispatch_recorded %s: %s", transaction.id, exc)

    return DispatchResponse(
        transaction_id=transaction.id,
        item_id=dispatch.item_id,
        batch_id=selected_batch_id,
        qty_dispatched=dispatch.qty,
        item_balance=get_item_balance(str(dispatch.item_id), db),
        batch_balance=get_batch_balance(str(selected_batch_id), db),
        message=f"Dispatched {dispatch.qty} {item.uom.value} of {item.name} (Ref: {dispatch.dispatch_ref})",
    )
