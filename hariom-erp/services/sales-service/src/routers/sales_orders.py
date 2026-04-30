from datetime import date, datetime
from typing import List, Optional
import uuid
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import or_
from sqlalchemy.orm import Session, joinedload

from ..database import get_db
from ..models import (
    SalesOrder,
    SalesOrderLine,
    SalesOrderReleaseLot,
    SalesOrderStatus,
    SalesOrderDispatchLog,
)
from ..utils.auth import (
    apply_plant_scope,
    enforce_maker_checker,
    get_current_plant,
    get_current_plant_scope,
    get_current_user,
    require_role,
)

router = APIRouter(prefix="/sales-orders", tags=["sales-orders"])


class SalesOrderLineInput(BaseModel):
    approved_spec_id: uuid.UUID
    line_no: Optional[int] = None
    product_code: Optional[str] = None
    parchment_color: Optional[str] = None
    rate_per_pc: Optional[float] = None
    qty: float
    due_date: date


class SalesOrderCreate(BaseModel):
    customer_id: uuid.UUID
    po_number: Optional[str] = None
    po_date: Optional[date] = None
    notes: Optional[str] = None
    lines: List[SalesOrderLineInput]


class SalesOrderUpdate(BaseModel):
    customer_id: Optional[uuid.UUID] = None
    po_number: Optional[str] = None
    po_date: Optional[date] = None
    notes: Optional[str] = None
    status: Optional[str] = None
    lines: Optional[List[SalesOrderLineInput]] = None


class DispatchValidationPayload(BaseModel):
    qty: float
    approved_spec_id: Optional[uuid.UUID] = None


class RecordDispatchPayload(BaseModel):
    qty: float
    dispatch_line_ref: str


class SalesOrderLineReleasePayload(BaseModel):
    release_qty: float
    winder_machine_id: uuid.UUID
    product_code: Optional[str] = None
    release_lot_id: Optional[uuid.UUID] = None


class ReleaseLotJobCardSyncPayload(BaseModel):
    job_card_id: uuid.UUID


class SalesOrderReleaseLotResponse(BaseModel):
    id: uuid.UUID
    order_id: uuid.UUID
    line_id: uuid.UUID
    release_lot_id: uuid.UUID
    release_qty: float
    winder_machine_id: Optional[uuid.UUID]
    product_code: Optional[str]
    status: str
    job_card_id: Optional[uuid.UUID]
    created_by: str
    approved_by: Optional[str]
    created_at: datetime


class SalesOrderLineResponse(BaseModel):
    id: uuid.UUID
    line_no: int
    approved_spec_id: uuid.UUID
    product_code: Optional[str]
    parchment_color: Optional[str]
    rate_per_pc: Optional[float]
    qty: float
    due_date: date
    released_qty: float
    fulfilled_qty: float
    remaining_qty: float
    release_remaining_qty: float
    release_lots: List[SalesOrderReleaseLotResponse] = Field(default_factory=list)


class SalesOrderResponse(BaseModel):
    id: uuid.UUID
    order_no: str
    plant_id: str
    customer_id: uuid.UUID
    po_number: Optional[str]
    po_date: Optional[date]
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
    release_lots = [lot for lot in getattr(line, "release_lots", []) if str(lot.status or "").lower() != "cancelled"]
    released_qty = sum(float(lot.released_qty or 0.0) for lot in release_lots)
    return {
        "id": line.id,
        "line_no": int(line.line_no or 1),
        "approved_spec_id": line.approved_spec_id,
        "product_code": line.product_code,
        "parchment_color": line.parchment_color,
        "rate_per_pc": line.rate_per_pc,
        "qty": line.qty,
        "due_date": line.due_date,
        "released_qty": round(released_qty, 2),
        "fulfilled_qty": line.fulfilled_qty,
        "remaining_qty": max(0.0, line.qty - line.fulfilled_qty),
        "release_remaining_qty": max(0.0, line.qty - released_qty),
        "release_lots": [
            {
                "id": lot.id,
                "order_id": line.sales_order_id,
                "line_id": lot.sales_order_line_id,
                "release_lot_id": lot.id,
                "release_qty": lot.released_qty,
                "winder_machine_id": lot.winder_machine_id,
                "product_code": lot.product_code,
                "status": lot.status,
                "job_card_id": lot.job_card_id,
                "created_by": lot.released_by or "unknown",
                "approved_by": lot.released_by_identity or lot.released_by,
                "created_at": lot.created_at,
            }
            for lot in sorted(release_lots, key=lambda lot: lot.created_at or datetime.min)
        ],
    }


def _serialize_order(order: SalesOrder) -> dict:
    return {
        "id": order.id,
        "order_no": order.order_no,
        "customer_id": order.customer_id,
        "po_number": order.po_number,
        "po_date": order.po_date,
        "notes": order.notes,
        "status": order.status.value,
        "created_by": order.created_by,
        "approved_by": order.approved_by,
        "released_by": order.released_by,
        "created_at": order.created_at,
        "approved_at": order.approved_at,
        "released_at": order.released_at,
        "plant_id": str(order.plant_id),
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


def _released_qty(line: SalesOrderLine) -> float:
    return sum(
        float(lot.released_qty or 0.0)
        for lot in getattr(line, "release_lots", [])
        if str(lot.status or "").lower() != "cancelled"
    )


def _sync_release_status(order: SalesOrder):
    total_qty = sum(float(line.qty or 0.0) for line in order.lines)
    released_qty = sum(_released_qty(line) for line in order.lines)
    if total_qty <= 0 or released_qty <= 0:
        return
    if released_qty < total_qty:
        order.status = SalesOrderStatus.PARTIALLY_RELEASED
    elif order.status not in [SalesOrderStatus.PARTIALLY_DISPATCHED, SalesOrderStatus.CLOSED]:
        order.status = SalesOrderStatus.RELEASED


@router.post("", response_model=SalesOrderResponse)
def create_sales_order(
    payload: SalesOrderCreate,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin", "Sales"])),
):
    if not payload.lines:
        raise HTTPException(status_code=400, detail="At least one line is required")

    order = SalesOrder(
        order_no=_next_order_no(db),
        customer_id=payload.customer_id,
        po_number=payload.po_number,
        po_date=payload.po_date,
        notes=payload.notes,
        plant_id=plant_id,
        status=SalesOrderStatus.DRAFT,
        created_by=current_user.get("sub", "unknown"),
    )
    db.add(order)
    db.flush()

    for index, line in enumerate(payload.lines, start=1):
        db.add(
            SalesOrderLine(
                sales_order_id=order.id,
                line_no=line.line_no or index,
                approved_spec_id=line.approved_spec_id,
                product_code=(line.product_code or "").strip() or None,
                parchment_color=line.parchment_color,
                rate_per_pc=line.rate_per_pc,
                qty=line.qty,
                due_date=line.due_date,
                fulfilled_qty=0.0,
            )
        )

    db.commit()
    db.refresh(order)
    order = (
        db.query(SalesOrder)
        .options(joinedload(SalesOrder.lines).joinedload(SalesOrderLine.release_lots))
        .filter(SalesOrder.id == order.id)
        .first()
    )
    return _serialize_order(order)


@router.get("", response_model=List[SalesOrderResponse])
def list_sales_orders(
    status: Optional[str] = Query(None),
    status_group: Optional[str] = Query(None),
    customer_id: Optional[uuid.UUID] = Query(None),
    search: Optional[str] = Query(None, min_length=1, max_length=120),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
    current_user: dict = Depends(get_current_user),
):
    query = apply_plant_scope(
        db.query(SalesOrder).options(joinedload(SalesOrder.lines).joinedload(SalesOrderLine.release_lots)),
        SalesOrder.plant_id,
        plant_scope,
    )
    if status:
        try:
            status_enum = SalesOrderStatus(status)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid status")
        query = query.filter(SalesOrder.status == status_enum)
    elif status_group:
        normalized_group = status_group.strip().lower()
        if normalized_group != "open":
            raise HTTPException(status_code=400, detail="Invalid status_group")
        query = query.filter(SalesOrder.status != SalesOrderStatus.CLOSED)
    if customer_id:
        query = query.filter(SalesOrder.customer_id == customer_id)
    if search:
        needle = f"%{search.strip()}%"
        clauses = [
            SalesOrder.order_no.ilike(needle),
            SalesOrder.po_number.ilike(needle),
            SalesOrder.notes.ilike(needle),
            SalesOrder.lines.any(SalesOrderLine.product_code.ilike(needle)),
            SalesOrder.lines.any(SalesOrderLine.parchment_color.ilike(needle)),
        ]
        try:
            clauses.append(SalesOrder.customer_id == uuid.UUID(search.strip()))
        except ValueError:
            pass
        query = query.filter(or_(*clauses))

    orders = query.order_by(SalesOrder.created_at.desc()).offset(offset).limit(limit).all()
    return [_serialize_order(order) for order in orders]


@router.get("/{order_id}", response_model=SalesOrderResponse)
def get_sales_order(
    order_id: uuid.UUID,
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
    current_user: dict = Depends(get_current_user),
):
    query = apply_plant_scope(
        db.query(SalesOrder)
        .options(joinedload(SalesOrder.lines).joinedload(SalesOrderLine.release_lots))
        .filter(SalesOrder.id == order_id),
        SalesOrder.plant_id,
        plant_scope,
    )
    order = query.first()
    if not order:
        raise HTTPException(status_code=404, detail="Sales order not found")
    return _serialize_order(order)


@router.put("/{order_id}", response_model=SalesOrderResponse)
def update_sales_order(
    order_id: uuid.UUID,
    payload: SalesOrderUpdate,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin", "Sales"])),
):
    order = (
        db.query(SalesOrder)
        .options(joinedload(SalesOrder.lines).joinedload(SalesOrderLine.release_lots))
        .filter(SalesOrder.id == order_id, SalesOrder.plant_id == plant_id)
        .first()
    )
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
    if payload.po_number is not None:
        order.po_number = payload.po_number
    if payload.po_date is not None:
        order.po_date = payload.po_date
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
        for index, line in enumerate(payload.lines, start=1):
            order.lines.append(
                SalesOrderLine(
                    line_no=line.line_no or index,
                    approved_spec_id=line.approved_spec_id,
                    product_code=(line.product_code or "").strip() or None,
                    parchment_color=line.parchment_color,
                    rate_per_pc=line.rate_per_pc,
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
    current_user: dict = Depends(require_role(["Admin", "Sales", "Planner"])),
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
    current_user: dict = Depends(require_role(["Admin", "Sales", "Planner"])),
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
    plant_scope: dict = Depends(get_current_plant_scope),
    current_user: dict = Depends(get_current_user),
):
    query = apply_plant_scope(
        db.query(SalesOrderLine)
        .join(SalesOrder)
        .options(joinedload(SalesOrderLine.release_lots))
        .filter(SalesOrderLine.id == line_id),
        SalesOrder.plant_id,
        plant_scope,
    )
    line = query.first()
    if not line:
        raise HTTPException(status_code=404, detail="Sales order line not found")
    return _serialize_line(line)


@router.post("/lines/{line_id}/release", response_model=SalesOrderReleaseLotResponse)
def release_sales_order_line(
    line_id: uuid.UUID,
    payload: SalesOrderLineReleasePayload,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin", "Sales", "Planner"])),
):
    line = (
        db.query(SalesOrderLine)
        .join(SalesOrder)
        .options(joinedload(SalesOrderLine.sales_order), joinedload(SalesOrderLine.release_lots))
        .filter(SalesOrderLine.id == line_id, SalesOrder.plant_id == plant_id)
        .first()
    )
    if not line:
        raise HTTPException(status_code=404, detail="Sales order line not found")

    order = line.sales_order
    if order.status not in [
        SalesOrderStatus.APPROVED,
        SalesOrderStatus.RELEASED,
        SalesOrderStatus.PARTIALLY_RELEASED,
        SalesOrderStatus.PARTIALLY_DISPATCHED,
    ]:
        raise HTTPException(status_code=400, detail="Only approved or released sales orders can release line quantities")

    if payload.release_qty <= 0:
        raise HTTPException(status_code=400, detail="Release quantity must be positive")

    release_lot_id = payload.release_lot_id or uuid.uuid4()
    existing_lot = db.query(SalesOrderReleaseLot).filter(SalesOrderReleaseLot.id == release_lot_id).first()
    if existing_lot:
        if existing_lot.sales_order_line_id != line.id:
            raise HTTPException(status_code=409, detail="Release lot id already belongs to another line")
        return {
            "id": existing_lot.id,
            "order_id": order.id,
            "line_id": existing_lot.sales_order_line_id,
            "release_lot_id": existing_lot.id,
            "release_qty": existing_lot.released_qty,
            "winder_machine_id": existing_lot.winder_machine_id,
            "product_code": existing_lot.product_code,
            "status": existing_lot.status,
            "job_card_id": existing_lot.job_card_id,
            "created_by": existing_lot.released_by or "unknown",
            "approved_by": existing_lot.released_by_identity or existing_lot.released_by,
            "created_at": existing_lot.created_at,
        }

    unreleased_qty = max(0.0, float(line.qty or 0.0) - _released_qty(line))
    if payload.release_qty > unreleased_qty:
        raise HTTPException(status_code=400, detail=f"Release qty exceeds unreleased balance ({round(unreleased_qty, 2)})")

    lot = SalesOrderReleaseLot(
        id=release_lot_id,
        sales_order_id=order.id,
        sales_order_line_id=line.id,
        released_qty=payload.release_qty,
        winder_machine_id=payload.winder_machine_id,
        product_code=(payload.product_code or line.product_code or "").strip() or None,
        status="released",
        released_by=current_user.get("sub", "unknown"),
        released_by_identity=current_user.get("sub"),
        released_at=datetime.utcnow(),
    )
    db.add(lot)
    db.flush()
    _sync_release_status(order)
    order.released_by = current_user.get("sub")
    order.released_at = order.released_at or datetime.utcnow()
    db.commit()
    db.refresh(lot)

    return {
        "id": lot.id,
        "order_id": order.id,
        "line_id": lot.sales_order_line_id,
        "release_lot_id": lot.id,
        "release_qty": lot.released_qty,
        "winder_machine_id": lot.winder_machine_id,
        "product_code": lot.product_code,
        "status": lot.status,
        "job_card_id": lot.job_card_id,
        "created_by": lot.released_by or "unknown",
        "approved_by": lot.released_by_identity or lot.released_by,
        "created_at": lot.created_at,
    }


@router.post("/release-lots/{release_lot_id}/sync-job-card", response_model=SalesOrderReleaseLotResponse)
def sync_release_lot_job_card(
    release_lot_id: uuid.UUID,
    payload: ReleaseLotJobCardSyncPayload,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin", "Sales", "Planner", "PlantManager"])),
):
    lot = (
        db.query(SalesOrderReleaseLot)
        .join(SalesOrderLine)
        .join(SalesOrder)
        .options(joinedload(SalesOrderReleaseLot.line).joinedload(SalesOrderLine.sales_order))
        .filter(SalesOrderReleaseLot.id == release_lot_id, SalesOrder.plant_id == plant_id)
        .first()
    )
    if not lot:
        raise HTTPException(status_code=404, detail="Release lot not found")
    lot.job_card_id = payload.job_card_id
    db.commit()
    db.refresh(lot)
    return {
        "id": lot.id,
        "order_id": lot.line.sales_order_id,
        "line_id": lot.sales_order_line_id,
        "release_lot_id": lot.id,
        "release_qty": lot.released_qty,
        "winder_machine_id": lot.winder_machine_id,
        "product_code": lot.product_code,
        "status": lot.status,
        "job_card_id": lot.job_card_id,
        "created_by": lot.released_by or "unknown",
        "approved_by": lot.released_by_identity or lot.released_by,
        "created_at": lot.created_at,
    }


@router.post("/lines/{line_id}/validate-dispatch", response_model=DispatchValidationResponse)
def validate_dispatch_for_line(
    line_id: uuid.UUID,
    payload: DispatchValidationPayload,
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
    current_user: dict = Depends(get_current_user),
):
    line = apply_plant_scope(
        db.query(SalesOrderLine)
        .join(SalesOrder)
        .options(joinedload(SalesOrderLine.sales_order))
        .filter(SalesOrderLine.id == line_id),
        SalesOrder.plant_id,
        plant_scope,
    )
    line = line.first()
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
    current_user: dict = Depends(require_role(["Admin", "Dispatch"])),
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
