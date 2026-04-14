from datetime import date, datetime
from typing import List, Optional
import uuid
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session, joinedload

from ..database import get_db
from ..models import (
    SalesOrder,
    SalesOrderLine,
    SalesOrderStatus,
    SalesOrderDispatchLog,
)
from ..utils.auth import require_role, get_current_user, enforce_maker_checker, get_current_plant

router = APIRouter(prefix="/sales-orders", tags=["sales-orders"])


class SalesOrderLineInput(BaseModel):
    approved_spec_id: uuid.UUID
    parchment_color: Optional[str] = None
    qty: float
    due_date: date


class SalesOrderCreate(BaseModel):
    customer_id: uuid.UUID
    notes: Optional[str] = None
    lines: List[SalesOrderLineInput]


class SalesOrderUpdate(BaseModel):
    customer_id: Optional[uuid.UUID] = None
    notes: Optional[str] = None
    status: Optional[str] = None
    lines: Optional[List[SalesOrderLineInput]] = None


class DispatchValidationPayload(BaseModel):
    qty: float
    approved_spec_id: Optional[uuid.UUID] = None


class RecordDispatchPayload(BaseModel):
    qty: float
    dispatch_line_ref: str


class SalesOrderLineResponse(BaseModel):
    id: uuid.UUID
    approved_spec_id: uuid.UUID
    parchment_color: Optional[str]
    qty: float
    due_date: date
    fulfilled_qty: float
    remaining_qty: float


class SalesOrderResponse(BaseModel):
    id: uuid.UUID
    order_no: str
    plant_id: str
    customer_id: uuid.UUID
    notes: Optional[str]
    status: str
    created_by: str
    approved_by: Optional[str]
    released_by: Optional[str]
    created_at: datetime
    approved_at: Optional[datetime]
    released_at: Optional[datetime]
    lines: List[SalesOrderLineResponse]


class ActionResponse(BaseModel):
    message: str
    order_id: uuid.UUID
    status: str


class DispatchValidationResponse(BaseModel):
    order_id: uuid.UUID
    order_status: str
    line_id: uuid.UUID
    qty: float
    remaining_qty: float
    valid: bool


def _serialize_line(line: SalesOrderLine) -> dict:
    return {
        "id": line.id,
        "approved_spec_id": line.approved_spec_id,
        "parchment_color": line.parchment_color,
        "qty": line.qty,
        "due_date": line.due_date,
        "fulfilled_qty": line.fulfilled_qty,
        "remaining_qty": max(0.0, line.qty - line.fulfilled_qty),
    }


def _serialize_order(order: SalesOrder) -> dict:
    return {
        "id": order.id,
        "order_no": order.order_no,
        "customer_id": order.customer_id,
        "notes": order.notes,
        "status": order.status.value,
        "created_by": order.created_by,
        "approved_by": order.approved_by,
        "released_by": order.released_by,
        "created_at": order.created_at,
        "approved_at": order.approved_at,
        "released_at": order.released_at,
        "plant_id": order.plant_id,
        "lines": [_serialize_line(line) for line in order.lines],
    }


def _next_order_no(db: Session) -> str:
    date_part = datetime.utcnow().strftime("%Y%m%d")
    like_pattern = f"SO-{date_part}-%"
    count = db.query(SalesOrder).filter(SalesOrder.order_no.like(like_pattern)).count()
    return f"SO-{date_part}-{count + 1:04d}"


def _sync_order_status(order: SalesOrder):
    total_qty = sum(line.qty for line in order.lines)
    fulfilled_qty = sum(line.fulfilled_qty for line in order.lines)

    if total_qty <= 0:
        return

    if fulfilled_qty <= 0:
        return

    if fulfilled_qty < total_qty:
        order.status = SalesOrderStatus.PARTIALLY_DISPATCHED
    else:
        order.status = SalesOrderStatus.CLOSED


@router.post("", response_model=SalesOrderResponse)
def create_sales_order(
    payload: SalesOrderCreate,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin", "SOMaker"])),
):
    if not payload.lines:
        raise HTTPException(status_code=400, detail="At least one line is required")

    order = SalesOrder(
        order_no=_next_order_no(db),
        customer_id=payload.customer_id,
        notes=payload.notes,
        plant_id=plant_id,
        status=SalesOrderStatus.DRAFT,
        created_by=current_user.get("sub", "unknown"),
    )
    db.add(order)
    db.flush()

    for line in payload.lines:
        db.add(
            SalesOrderLine(
                sales_order_id=order.id,
                approved_spec_id=line.approved_spec_id,
                parchment_color=line.parchment_color,
                qty=line.qty,
                due_date=line.due_date,
                fulfilled_qty=0.0,
            )
        )

    db.commit()
    db.refresh(order)
    order = db.query(SalesOrder).options(joinedload(SalesOrder.lines)).filter(SalesOrder.id == order.id).first()
    return _serialize_order(order)


@router.get("", response_model=List[SalesOrderResponse])
def list_sales_orders(
    status: Optional[str] = Query(None),
    customer_id: Optional[uuid.UUID] = Query(None),
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(get_current_user),
):
    query = db.query(SalesOrder).options(joinedload(SalesOrder.lines)).filter(SalesOrder.plant_id == plant_id)
    if status:
        try:
            status_enum = SalesOrderStatus(status)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid status")
        query = query.filter(SalesOrder.status == status_enum)
    if customer_id:
        query = query.filter(SalesOrder.customer_id == customer_id)

    orders = query.order_by(SalesOrder.created_at.desc()).all()
    return [_serialize_order(order) for order in orders]


@router.get("/{order_id}", response_model=SalesOrderResponse)
def get_sales_order(
    order_id: uuid.UUID,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(get_current_user),
):
    order = (
        db.query(SalesOrder)
        .options(joinedload(SalesOrder.lines))
        .filter(SalesOrder.id == order_id, SalesOrder.plant_id == plant_id)
        .first()
    )
    if not order:
        raise HTTPException(status_code=404, detail="Sales order not found")
    return _serialize_order(order)


@router.put("/{order_id}", response_model=SalesOrderResponse)
def update_sales_order(
    order_id: uuid.UUID,
    payload: SalesOrderUpdate,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin", "SOMaker"])),
):
    order = db.query(SalesOrder).options(joinedload(SalesOrder.lines)).filter(
        SalesOrder.id == order_id, SalesOrder.plant_id == plant_id
    ).first()
    if not order:
        raise HTTPException(status_code=404, detail="Sales order not found")

    if order.status in [
        SalesOrderStatus.RELEASED,
        SalesOrderStatus.PARTIALLY_RELEASED,
        SalesOrderStatus.PARTIALLY_DISPATCHED,
        SalesOrderStatus.CLOSED,
    ]:
        raise HTTPException(status_code=400, detail="Released/dispatched orders cannot be edited")

    if payload.customer_id is not None:
        order.customer_id = payload.customer_id
    if payload.notes is not None:
        order.notes = payload.notes

    if payload.status is not None:
        try:
            requested = SalesOrderStatus(payload.status)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid status")
        if requested not in [SalesOrderStatus.DRAFT, SalesOrderStatus.SUBMITTED]:
            raise HTTPException(status_code=400, detail="Only draft/submitted status can be set here")
        order.status = requested

    if payload.lines is not None:
        if order.status not in [SalesOrderStatus.DRAFT, SalesOrderStatus.SUBMITTED]:
            raise HTTPException(status_code=400, detail="Cannot edit lines after approval")
        order.lines.clear()
        db.flush()
        for line in payload.lines:
            order.lines.append(
                SalesOrderLine(
                    approved_spec_id=line.approved_spec_id,
                    parchment_color=line.parchment_color,
                    qty=line.qty,
                    due_date=line.due_date,
                    fulfilled_qty=0.0,
                )
            )

    db.commit()
    db.refresh(order)
    return _serialize_order(order)


@router.post("/{order_id}/approve", response_model=ActionResponse)
def approve_sales_order(
    order_id: uuid.UUID,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin", "SOApprover"])),
):
    order = db.query(SalesOrder).filter(
        SalesOrder.id == order_id, SalesOrder.plant_id == plant_id
    ).first()
    if not order:
        raise HTTPException(status_code=404, detail="Sales order not found")

    if order.status not in [SalesOrderStatus.DRAFT, SalesOrderStatus.SUBMITTED]:
        raise HTTPException(status_code=400, detail="Only draft/submitted orders can be approved")

    enforce_maker_checker(current_user, order.created_by)
    order.status = SalesOrderStatus.APPROVED
    order.approved_by = current_user.get("sub")
    order.approved_at = datetime.utcnow()
    db.commit()

    return {
        "message": "Sales order approved",
        "order_id": order.id,
        "status": order.status.value,
    }


@router.post("/{order_id}/release", response_model=ActionResponse)
def release_sales_order(
    order_id: uuid.UUID,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin", "SOApprover"])),
):
    order = db.query(SalesOrder).filter(
        SalesOrder.id == order_id, SalesOrder.plant_id == plant_id
    ).first()
    if not order:
        raise HTTPException(status_code=404, detail="Sales order not found")

    if order.status != SalesOrderStatus.APPROVED:
        raise HTTPException(status_code=400, detail="Only approved orders can be released")

    enforce_maker_checker(current_user, order.created_by)
    order.status = SalesOrderStatus.RELEASED
    order.released_by = current_user.get("sub")
    order.released_at = datetime.utcnow()
    db.commit()

    return {
        "message": "Sales order released",
        "order_id": order.id,
        "status": order.status.value,
    }


@router.get("/lines/{line_id}", response_model=SalesOrderLineResponse)
def get_sales_order_line(
    line_id: uuid.UUID,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(get_current_user),
):
    line = db.query(SalesOrderLine).join(SalesOrder).filter(
        SalesOrderLine.id == line_id,
        SalesOrder.plant_id == plant_id
    ).first()
    if not line:
        raise HTTPException(status_code=404, detail="Sales order line not found")
    return _serialize_line(line)


@router.post("/lines/{line_id}/validate-dispatch", response_model=DispatchValidationResponse)
def validate_dispatch_for_line(
    line_id: uuid.UUID,
    payload: DispatchValidationPayload,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(get_current_user),
):
    line = (
        db.query(SalesOrderLine)
        .join(SalesOrder)
        .options(joinedload(SalesOrderLine.sales_order))
        .filter(SalesOrderLine.id == line_id, SalesOrder.plant_id == plant_id)
        .first()
    )
    if not line:
        raise HTTPException(status_code=404, detail="Sales order line not found")

    order = line.sales_order
    if order.status not in [
        SalesOrderStatus.RELEASED,
        SalesOrderStatus.PARTIALLY_RELEASED,
        SalesOrderStatus.PARTIALLY_DISPATCHED,
    ]:
        raise HTTPException(status_code=400, detail="Sales order line not released for dispatch")

    if payload.approved_spec_id and line.approved_spec_id != payload.approved_spec_id:
        raise HTTPException(status_code=400, detail="Spec mismatch for this sales order line")

    remaining = max(0.0, line.qty - line.fulfilled_qty)
    if payload.qty > remaining:
        raise HTTPException(status_code=400, detail=f"Dispatch qty exceeds remaining qty ({remaining})")

    return {
        "order_id": order.id,
        "order_status": order.status.value,
        "line_id": line.id,
        "qty": payload.qty,
        "remaining_qty": remaining,
        "valid": True,
    }


@router.post("/lines/{line_id}/record-dispatch")
def record_dispatch_for_line(
    line_id: uuid.UUID,
    payload: RecordDispatchPayload,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin", "DispatchApprover", "DispatchMaker"])),
):
    line = (
        db.query(SalesOrderLine)
        .join(SalesOrder)
        .options(joinedload(SalesOrderLine.sales_order), joinedload(SalesOrderLine.dispatch_logs))
        .filter(SalesOrderLine.id == line_id, SalesOrder.plant_id == plant_id)
        .first()
    )
    if not line:
        raise HTTPException(status_code=404, detail="Sales order line not found")

    existing_log = db.query(SalesOrderDispatchLog).filter(
        SalesOrderDispatchLog.dispatch_line_ref == payload.dispatch_line_ref
    ).first()
    if existing_log:
        return {
            "message": "Dispatch already recorded",
            "line_id": str(line.id),
            "dispatch_line_ref": payload.dispatch_line_ref,
            "fulfilled_qty": line.fulfilled_qty,
            "remaining_qty": max(0.0, line.qty - line.fulfilled_qty),
        }

    remaining = max(0.0, line.qty - line.fulfilled_qty)
    if payload.qty > remaining:
        raise HTTPException(status_code=400, detail=f"Dispatch qty exceeds remaining qty ({remaining})")

    line.fulfilled_qty = line.fulfilled_qty + payload.qty
    db.add(
        SalesOrderDispatchLog(
            line_id=line.id,
            dispatch_line_ref=payload.dispatch_line_ref,
            qty=payload.qty,
        )
    )

    _sync_order_status(line.sales_order)

    db.commit()
    db.refresh(line)
    db.refresh(line.sales_order)

    return {
        "message": "Dispatch recorded",
        "line_id": str(line.id),
        "dispatch_line_ref": payload.dispatch_line_ref,
        "fulfilled_qty": line.fulfilled_qty,
        "remaining_qty": max(0.0, line.qty - line.fulfilled_qty),
        "order_status": line.sales_order.status.value,
    }
