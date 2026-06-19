import logging
from datetime import datetime
from typing import List, Optional
import uuid
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

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
    get_reserved_qty,
)
from ..utils.audit_client import emit_audit_event
from ..utils.auth import get_current_user, require_role, get_current_plant

_audit_logger = logging.getLogger(__name__)

router = APIRouter(tags=["reservations"])


class ReservationCreate(BaseModel):
    sales_order_id: uuid.UUID
    sales_order_line_id: uuid.UUID
    item_id: uuid.UUID
    qty: float
    batch_id: Optional[uuid.UUID] = None
    spec_id: Optional[uuid.UUID] = None


class ReservationConsume(BaseModel):
    qty: float
    dispatch_ref: str


class ReservationResponse(BaseModel):
    id: uuid.UUID
    sales_order_id: uuid.UUID
    sales_order_line_id: uuid.UUID
    item_id: uuid.UUID
    batch_id: Optional[uuid.UUID]
    spec_id: Optional[uuid.UUID]
    reserved_qty: float
    consumed_qty: float
    remaining_qty: float
    status: str
    created_by: str
    created_at: datetime


class ReservationActionResponse(BaseModel):
    message: str
    reservation_id: uuid.UUID
    status: str


def _serialize_reservation(r: Reservation) -> dict:
    remaining = max(0.0, r.reserved_qty - r.consumed_qty)
    return {
        "id": r.id,
        "sales_order_id": r.sales_order_id,
        "sales_order_line_id": r.sales_order_line_id,
        "item_id": r.item_id,
        "batch_id": r.batch_id,
        "spec_id": r.spec_id,
        "reserved_qty": r.reserved_qty,
        "consumed_qty": r.consumed_qty,
        "remaining_qty": remaining,
        "status": r.status.value,
        "created_by": r.created_by,
        "created_at": r.created_at,
    }


@router.post("/reservations", response_model=ReservationResponse)
def create_reservation(
    payload: ReservationCreate,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin", "Store", "Dispatch"])),
):
    item = db.query(ItemMaster).filter(
        ItemMaster.id == payload.item_id,
        ItemMaster.plant_id == plant_id
    ).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")

    selected_batch_id = payload.batch_id
    if selected_batch_id:
        batch = db.query(StockBatch).filter(
            StockBatch.id == selected_batch_id,
            StockBatch.plant_id == plant_id
        ).first()
        if not batch:
            raise HTTPException(status_code=404, detail="Batch not found")
        if str(batch.item_id) != str(payload.item_id):
            raise HTTPException(status_code=400, detail="Batch does not belong to the item")
        if payload.spec_id and batch.spec_id and str(batch.spec_id) != str(payload.spec_id):
            raise HTTPException(status_code=400, detail="Batch spec does not match requested spec")

        available = get_available_batch_qty(str(selected_batch_id), db)
        if available < payload.qty:
            raise HTTPException(status_code=400, detail=f"Insufficient batch availability ({available})")
    else:
        available = get_available_item_qty(str(payload.item_id), db)
        if available < payload.qty:
            raise HTTPException(status_code=400, detail=f"Insufficient item availability ({available})")

    reservation = Reservation(
        sales_order_id=payload.sales_order_id,
        sales_order_line_id=payload.sales_order_line_id,
        item_id=payload.item_id,
        batch_id=selected_batch_id,
        spec_id=payload.spec_id,
        reserved_qty=payload.qty,
        consumed_qty=0.0,
        status=ReservationStatus.ACTIVE,
        plant_id=plant_id,
        created_by=current_user.get("sub", "unknown"),
    )
    db.add(reservation)
    db.commit()
    db.refresh(reservation)
    try:
        emit_audit_event(
            token=current_user.get("token", ""),
            event_type="reservation_created",
            entity_type="reservation",
            entity_id=str(reservation.id),
            plant_id=str(plant_id),
            actor_role=str((current_user.get("roles") or ["?"])[0]),
            actor_email=current_user.get("sub"),
            summary=f"Reserved {payload.qty} of item {payload.item_id} for SO line {payload.sales_order_line_id}",
            payload={
                "sales_order_id": str(payload.sales_order_id),
                "sales_order_line_id": str(payload.sales_order_line_id),
                "item_id": str(payload.item_id),
                "batch_id": str(selected_batch_id) if selected_batch_id else None,
                "spec_id": str(payload.spec_id) if payload.spec_id else None,
                "reserved_qty": float(payload.qty),
            },
        )
    except Exception as exc:
        _audit_logger.warning("audit emit failed for reservation_created %s: %s", reservation.id, exc)
    return _serialize_reservation(reservation)


@router.get("/reservations", response_model=List[ReservationResponse])
def list_reservations(
    sales_order_id: Optional[uuid.UUID] = Query(None),
    line_id: Optional[uuid.UUID] = Query(None),
    item_id: Optional[uuid.UUID] = Query(None),
    status: Optional[str] = Query(None),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(get_current_user),
):
    query = db.query(Reservation).filter(Reservation.plant_id == plant_id)
    if sales_order_id:
        query = query.filter(Reservation.sales_order_id == sales_order_id)
    if line_id:
        query = query.filter(Reservation.sales_order_line_id == line_id)
    if item_id:
        query = query.filter(Reservation.item_id == item_id)
    if status:
        try:
            status_enum = ReservationStatus(status)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid reservation status")
        query = query.filter(Reservation.status == status_enum)

    rows = query.order_by(Reservation.created_at.desc()).offset(offset).limit(limit).all()
    return [_serialize_reservation(row) for row in rows]


@router.post("/reservations/{reservation_id}/release", response_model=ReservationActionResponse)
def release_reservation(
    reservation_id: uuid.UUID,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin", "Store", "Dispatch"])),
):
    reservation = db.query(Reservation).filter(
        Reservation.id == reservation_id,
        Reservation.plant_id == plant_id
    ).first()
    if not reservation:
        raise HTTPException(status_code=404, detail="Reservation not found")

    if reservation.consumed_qty > 0:
        raise HTTPException(status_code=400, detail="Cannot release partially consumed reservation")

    reservation.status = ReservationStatus.RELEASED
    reservation.released_at = datetime.utcnow()
    db.commit()
    try:
        emit_audit_event(
            token=current_user.get("token", ""),
            event_type="reservation_released",
            entity_type="reservation",
            entity_id=str(reservation.id),
            plant_id=str(plant_id),
            actor_role=str((current_user.get("roles") or ["?"])[0]),
            actor_email=current_user.get("sub"),
            summary=f"Reservation {reservation.id} released",
            payload={
                "sales_order_id": str(reservation.sales_order_id),
                "sales_order_line_id": str(reservation.sales_order_line_id),
                "item_id": str(reservation.item_id),
                "batch_id": str(reservation.batch_id) if reservation.batch_id else None,
                "reserved_qty": float(reservation.reserved_qty),
            },
        )
    except Exception as exc:
        _audit_logger.warning("audit emit failed for reservation_released %s: %s", reservation.id, exc)

    return {
        "message": "Reservation released",
        "reservation_id": reservation.id,
        "status": reservation.status.value,
    }


@router.post("/reservations/{reservation_id}/consume")
def consume_reservation(
    reservation_id: uuid.UUID,
    payload: ReservationConsume,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin", "Dispatch", "Store"])),
):
    reservation = db.query(Reservation).filter(
        Reservation.id == reservation_id,
        Reservation.plant_id == plant_id
    ).first()
    if not reservation:
        raise HTTPException(status_code=404, detail="Reservation not found")

    if reservation.status != ReservationStatus.ACTIVE:
        raise HTTPException(status_code=400, detail=f"Reservation is not active ({reservation.status.value})")

    if reservation.batch_id is None:
        raise HTTPException(status_code=400, detail="Reservation must be lot specific for dispatch consumption")

    existing_txn = db.query(StockTransaction).filter(StockTransaction.external_ref == payload.dispatch_ref).first()
    if existing_txn:
        return {
            "message": "Reservation consumption already posted (idempotent)",
            "reservation_id": str(reservation.id),
            "transaction_id": str(existing_txn.id),
            "remaining_qty": max(0.0, reservation.reserved_qty - reservation.consumed_qty),
        }

    remaining_qty = reservation.reserved_qty - reservation.consumed_qty
    if payload.qty > remaining_qty:
        raise HTTPException(status_code=400, detail=f"Consumption qty exceeds reserved remaining ({remaining_qty})")

    # get_available_batch_qty subtracts all ACTIVE reservations, including this one.
    # Add this reservation's remaining qty back so dispatch can consume what was reserved.
    batch_available = get_available_batch_qty(str(reservation.batch_id), db)
    effective_available = batch_available + remaining_qty
    if payload.qty > effective_available:
        raise HTTPException(
            status_code=400,
            detail=f"Insufficient batch availability ({round(effective_available, 2)})",
        )

    txn = StockTransaction(
        item_id=reservation.item_id,
        batch_id=reservation.batch_id,
        transaction_type=TransactionType.DISPATCH,
        qty_change=-payload.qty,
        reference_type=ReferenceType.DISPATCH,
        reference_id=uuid.uuid5(uuid.NAMESPACE_URL, payload.dispatch_ref),
        plant_id=plant_id,
        external_ref=payload.dispatch_ref,
    )
    db.add(txn)

    reservation.consumed_qty = reservation.consumed_qty + payload.qty
    if reservation.consumed_qty >= reservation.reserved_qty:
        reservation.status = ReservationStatus.CONSUMED

    db.commit()
    db.refresh(reservation)
    try:
        emit_audit_event(
            token=current_user.get("token", ""),
            event_type="reservation_consumed",
            entity_type="reservation",
            entity_id=str(reservation.id),
            plant_id=str(plant_id),
            actor_role=str((current_user.get("roles") or ["?"])[0]),
            actor_email=current_user.get("sub"),
            summary=f"Reservation {reservation.id} consumed {payload.qty} via dispatch {payload.dispatch_ref}",
            payload={
                "sales_order_id": str(reservation.sales_order_id),
                "sales_order_line_id": str(reservation.sales_order_line_id),
                "item_id": str(reservation.item_id),
                "batch_id": str(reservation.batch_id) if reservation.batch_id else None,
                "qty_consumed": float(payload.qty),
                "dispatch_ref": payload.dispatch_ref,
                "transaction_id": str(txn.id),
                "remaining_qty": max(0.0, reservation.reserved_qty - reservation.consumed_qty),
                "status": reservation.status.value,
            },
        )
    except Exception as exc:
        _audit_logger.warning("audit emit failed for reservation_consumed %s: %s", reservation.id, exc)

    return {
        "message": "Reservation consumed and dispatch transaction posted",
        "reservation_id": str(reservation.id),
        "transaction_id": str(txn.id),
        "remaining_qty": max(0.0, reservation.reserved_qty - reservation.consumed_qty),
        "status": reservation.status.value,
    }


@router.get("/lots/availability")
def lot_availability(
    item_id: uuid.UUID,
    spec_id: Optional[uuid.UUID] = Query(None),
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(get_current_user),
):
    query = db.query(StockBatch).filter(
        StockBatch.item_id == item_id,
        StockBatch.plant_id == plant_id
    )
    if spec_id:
        query = query.filter(StockBatch.spec_id == spec_id)

    lots = query.order_by(StockBatch.created_at.asc()).all()
    result = []
    for lot in lots:
        reserved = get_reserved_qty(db=db, batch_id=str(lot.id))
        available = get_available_batch_qty(str(lot.id), db)
        result.append(
            {
                "batch_id": str(lot.id),
                "batch_no": lot.batch_no,
                "spec_id": str(lot.spec_id) if lot.spec_id else None,
                "received_qty": lot.received_qty,
                "reserved_qty": round(reserved, 2),
                "available_qty": round(available, 2),
                "location": lot.location,
                "created_at": lot.created_at.isoformat(),
            }
        )

    return {
        "item_id": str(item_id),
        "spec_id": str(spec_id) if spec_id else None,
        "lots": result,
    }
