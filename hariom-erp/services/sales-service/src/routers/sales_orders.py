from datetime import date, datetime
from typing import List, Optional
import logging
import uuid
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, or_
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session, joinedload

from ..database import get_db
from ..open_demand import collect_open_demand
from ..models import (
    SalesOrder,
    SalesOrderLine,
    SalesOrderNumberCounter,
    SalesOrderReleaseLot,
    SalesOrderStatus,
    SalesOrderDispatchLog,
)
from ..commercial import (
    ORIGIN_CUSTOMER_PO,
    ORIGIN_REVIEW,
    SalesCommercialError,
    validate_delivery_schedule_input,
    validate_origin_and_external_po,
    validate_order_lines_delivery_dates,
    validate_persisted_order,
    resolve_parchment_variant,
)
from ..pending_workspace import (
    build_pending_workspace,
    export_pending_csv,
    load_open_orders,
)
from ..schedule_service import (
    commit_entire_po,
    commit_line_schedules,
    list_order_schedules,
    load_order_for_schedule,
    mutate_schedule_row,
    preview_entire_po,
    preview_line_schedules,
    serialize_schedule_row,
)
from ..utils.auth import (
    apply_plant_scope,
    get_current_plant,
    get_current_plant_scope,
    get_current_user,
    require_role,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/sales-orders", tags=["sales-orders"])


class SalesOrderLineInput(BaseModel):
    id: Optional[uuid.UUID] = None
    approved_spec_id: uuid.UUID
    line_no: Optional[int] = None
    product_code: Optional[str] = None
    parchment_required: Optional[bool] = None
    parchment_color_id: Optional[uuid.UUID] = None
    parchment_color: Optional[str] = None
    rate_per_pc: Optional[float] = Field(default=None, ge=0)
    qty: float = Field(..., gt=0)
    due_date: date


class DeliveryScheduleInput(BaseModel):
    """Dated quantity row. Validated with the same R05 rule as line delivery dates."""
    line_no: Optional[int] = None
    delivery_date: date
    qty: float = Field(..., gt=0)


class SalesOrderCreate(BaseModel):
    customer_id: uuid.UUID
    origin: Optional[str] = None
    po_number: Optional[str] = None
    po_date: Optional[date] = None
    internal_order_date: Optional[date] = None
    notes: Optional[str] = None
    lines: List[SalesOrderLineInput] = Field(..., min_length=1)
    delivery_schedules: Optional[List[DeliveryScheduleInput]] = None


class SalesOrderUpdate(BaseModel):
    customer_id: Optional[uuid.UUID] = None
    origin: Optional[str] = None
    po_number: Optional[str] = None
    po_date: Optional[date] = None
    internal_order_date: Optional[date] = None
    notes: Optional[str] = None
    status: Optional[str] = None
    lines: Optional[List[SalesOrderLineInput]] = None
    delivery_schedules: Optional[List[DeliveryScheduleInput]] = None


class DispatchValidationPayload(BaseModel):
    qty: float = Field(..., gt=0)
    approved_spec_id: Optional[uuid.UUID] = None


class RecordDispatchPayload(BaseModel):
    qty: float = Field(..., gt=0)
    dispatch_line_ref: str = Field(..., min_length=1, max_length=100)


class SalesOrderLineReleasePayload(BaseModel):
    release_qty: float = Field(..., gt=0)
    winder_machine_id: uuid.UUID
    product_code: Optional[str] = None
    release_lot_id: Optional[uuid.UUID] = None


class ReleaseLotJobCardSyncPayload(BaseModel):
    job_card_id: uuid.UUID


class ReleaseLotReallocatePayload(BaseModel):
    carry_forward_job_card_id: uuid.UUID
    gap_qty: float = Field(..., gt=0)
    release_lot_id: Optional[uuid.UUID] = None


def carry_forward_lot_split(original_released_qty: float, gap_qty: float) -> tuple[float, float]:
    """Compute the P1.10 release-lot split (pure, no DB).

    The original lot shrinks to the produced portion; a NEW lot carries the
    gap. Total released qty across both lots is conserved (modulo float
    rounding) and the original never goes negative.

    Returns ``(shrunk_original_qty, new_lot_qty)``.
    """
    gap = float(gap_qty or 0.0)
    shrunk = max(0.0, round(float(original_released_qty or 0.0) - gap, 4))
    return shrunk, gap


class SalesOrderLineShortClosePayload(BaseModel):
    job_card_id: uuid.UUID
    produced_qty: float = Field(..., ge=0)
    gap_qty: float = Field(..., gt=0)
    reason_code: str
    notes: Optional[str] = None


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


class SalesOrderDeliveryScheduleResponse(BaseModel):
    id: uuid.UUID
    order_id: uuid.UUID
    line_id: uuid.UUID
    plant_id: str
    delivery_date: date
    quantity: float
    status: str
    revision: int
    immutable: bool = False
    created_by: Optional[str] = None
    created_at: Optional[datetime] = None
    allocations: List[dict] = Field(default_factory=list)


class SalesOrderLineResponse(BaseModel):
    id: uuid.UUID
    line_no: int
    approved_spec_id: uuid.UUID
    product_code: Optional[str]
    parchment_required: bool = False
    parchment_color_id: Optional[uuid.UUID] = None
    parchment_color: Optional[str]
    rate_per_pc: Optional[float]
    qty: float
    due_date: date
    released_qty: float
    fulfilled_qty: float
    remaining_qty: float
    release_remaining_qty: float
    release_lots: List[SalesOrderReleaseLotResponse] = Field(default_factory=list)
    dispatch_logs: List[dict] = Field(default_factory=list)
    delivery_schedules: List[dict] = Field(default_factory=list)
    remaining_to_schedule_qty: float = 0.0


class SalesOrderResponse(BaseModel):
    id: uuid.UUID
    order_no: str
    plant_id: str
    customer_id: uuid.UUID
    origin: str = ORIGIN_CUSTOMER_PO
    origin_review_required: bool = False
    po_number: Optional[str]
    po_date: Optional[date]
    internal_order_date: Optional[date] = None
    notes: Optional[str]
    status: str
    created_by: str
    approved_by: Optional[str]
    released_by: Optional[str]
    created_at: datetime
    approved_at: Optional[datetime]
    released_at: Optional[datetime]
    schedule_revision: int = 0
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


def _timeline_event(
    *,
    event_id: str,
    event_type: str,
    title: str,
    message: str,
    created_at: Optional[datetime],
    actor: Optional[str] = None,
    line_id: Optional[uuid.UUID] = None,
    qty: Optional[float] = None,
    metadata: Optional[dict] = None,
) -> dict:
    return {
        "id": event_id,
        "event_type": event_type,
        "title": title,
        "message": message,
        "created_at": created_at,
        "actor": actor or "system",
        "line_id": str(line_id) if line_id else None,
        "qty": round(float(qty), 2) if qty is not None else None,
        "metadata": metadata or {},
    }


def _serialize_line(line: SalesOrderLine) -> dict:
    from ..schedule_policy import remaining_to_schedule

    release_lots = [lot for lot in getattr(line, "release_lots", []) if str(lot.status or "").lower() != "cancelled"]
    released_qty = sum(float(lot.released_qty or 0.0) for lot in release_lots)
    parchment_required = bool(getattr(line, "parchment_required", False))
    parchment_color = getattr(line, "parchment_color", None) if parchment_required else None
    parchment_color_id = getattr(line, "parchment_color_id", None) if parchment_required else None
    schedules = list(getattr(line, "delivery_schedules", []) or [])
    return {
        "id": line.id,
        "line_no": int(line.line_no or 1),
        "approved_spec_id": line.approved_spec_id,
        "product_code": line.product_code,
        "parchment_required": parchment_required,
        "parchment_color_id": parchment_color_id,
        "parchment_color": parchment_color,
        "rate_per_pc": line.rate_per_pc,
        "qty": line.qty,
        "due_date": line.due_date,
        "released_qty": round(released_qty, 2),
        "fulfilled_qty": line.fulfilled_qty,
        "remaining_qty": max(0.0, line.qty - line.fulfilled_qty),
        "release_remaining_qty": max(0.0, line.qty - released_qty),
        "remaining_to_schedule_qty": remaining_to_schedule(line, schedules),
        "delivery_schedules": [
            serialize_schedule_row(row)
            for row in sorted(schedules, key=lambda item: (item.delivery_date or date.max, str(item.id)))
        ],
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
        "dispatch_logs": [
            {
                "id": str(log.id),
                "dispatch_line_ref": log.dispatch_line_ref,
                "qty": float(log.qty or 0.0),
                "created_at": log.created_at,
            }
            for log in sorted(getattr(line, "dispatch_logs", []), key=lambda log: log.created_at or datetime.min)
        ],
    }


def _serialize_order(order: SalesOrder) -> dict:
    origin = str(getattr(order, "origin", None) or ORIGIN_CUSTOMER_PO)
    return {
        "id": order.id,
        "order_no": order.order_no,
        "customer_id": order.customer_id,
        "origin": origin,
        "origin_review_required": bool(getattr(order, "origin_review_required", False)) or origin == ORIGIN_REVIEW,
        "po_number": order.po_number,
        "po_date": order.po_date,
        "internal_order_date": getattr(order, "internal_order_date", None),
        "notes": order.notes,
        "status": order.status.value,
        "created_by": order.created_by,
        "approved_by": order.approved_by,
        "released_by": order.released_by,
        "created_at": order.created_at,
        "approved_at": order.approved_at,
        "released_at": order.released_at,
        "schedule_revision": int(getattr(order, "schedule_revision", 0) or 0),
        "plant_id": str(order.plant_id),
        "lines": [
            _serialize_line(line)
            for line in sorted(order.lines, key=lambda item: (int(item.line_no or 0), str(item.id)))
        ],
    }


def _next_order_no(db: Session) -> str:
    """Allocate the next ``SO-YYYYMMDD-NNNN`` reference atomically.

    A single counter row per date key is incremented with an atomic upsert that
    returns the new value, so concurrent creates can never collide on the same
    sequence number. The reference format is unchanged from the count-based
    allocator it replaces.
    """
    date_part = datetime.utcnow().strftime("%Y%m%d")
    stmt = (
        pg_insert(SalesOrderNumberCounter)
        .values(date_key=date_part, last_seq=1)
        .on_conflict_do_update(
            index_elements=[SalesOrderNumberCounter.date_key],
            set_={"last_seq": SalesOrderNumberCounter.last_seq + 1},
        )
        .returning(SalesOrderNumberCounter.last_seq)
    )
    seq = db.execute(stmt).scalar_one()
    return f"SO-{date_part}-{int(seq):04d}"


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
    # A later partial release must not erase real dispatch progress already recorded on the order.
    if order.status == SalesOrderStatus.PARTIALLY_DISPATCHED:
        return
    if released_qty < total_qty:
        order.status = SalesOrderStatus.PARTIALLY_RELEASED
    elif order.status not in [SalesOrderStatus.PARTIALLY_DISPATCHED, SalesOrderStatus.CLOSED]:
        order.status = SalesOrderStatus.RELEASED


def _http_commercial(exc: SalesCommercialError) -> HTTPException:
    return HTTPException(status_code=400, detail=str(exc))


def _apply_line_fields(target: SalesOrderLine, incoming: SalesOrderLineInput, index: int) -> None:
    required, color_id, color = resolve_parchment_variant(
        parchment_required=incoming.parchment_required,
        parchment_color=incoming.parchment_color,
        parchment_color_id=incoming.parchment_color_id,
        line_no=incoming.line_no or index,
    )
    target.line_no = incoming.line_no or index
    target.approved_spec_id = incoming.approved_spec_id
    target.product_code = (incoming.product_code or "").strip() or None
    target.parchment_required = required
    target.parchment_color_id = color_id
    target.parchment_color = color
    target.rate_per_pc = incoming.rate_per_pc
    target.qty = incoming.qty
    target.due_date = incoming.due_date


def _upsert_order_lines(order: SalesOrder, lines: List[SalesOrderLineInput]) -> None:
    existing = {str(line.id): line for line in list(order.lines)}
    kept: set[str] = set()
    for index, incoming in enumerate(lines, start=1):
        target = None
        if incoming.id is not None and str(incoming.id) in existing:
            target = existing[str(incoming.id)]
            kept.add(str(incoming.id))
        if target is None:
            target = SalesOrderLine(fulfilled_qty=0.0)
            order.lines.append(target)
        _apply_line_fields(target, incoming, index)
    for line_id, line in existing.items():
        if line_id in kept:
            continue
        if _released_qty(line) > 0 or float(line.fulfilled_qty or 0.0) > 0:
            raise HTTPException(
                status_code=400,
                detail=f"Cannot remove line {int(line.line_no or 0)} after release or dispatch",
            )
        order.lines.remove(line)


def _validate_commercial_payload(
    *,
    origin: Optional[str],
    customer_id,
    po_number: Optional[str],
    po_date,
    internal_order_date,
    lines: List[SalesOrderLineInput],
    delivery_schedules: Optional[List[DeliveryScheduleInput]] = None,
):
    try:
        resolved_origin, resolved_po_number, resolved_po_date, resolved_internal_date = validate_origin_and_external_po(
            origin=origin or ORIGIN_CUSTOMER_PO,
            customer_id=customer_id,
            po_number=po_number,
            po_date=po_date,
            internal_order_date=internal_order_date,
        )
        validate_order_lines_delivery_dates(
            origin=resolved_origin,
            customer_po_date=resolved_po_date,
            lines=lines,
        )
        validate_delivery_schedule_input(
            origin=resolved_origin,
            customer_po_date=resolved_po_date,
            schedule_rows=[
                {"line_no": row.line_no, "delivery_date": row.delivery_date, "qty": row.qty}
                for row in (delivery_schedules or [])
            ],
        )
        for index, line in enumerate(lines, start=1):
            resolve_parchment_variant(
                parchment_required=line.parchment_required,
                parchment_color=line.parchment_color,
                parchment_color_id=line.parchment_color_id,
                line_no=line.line_no or index,
            )
    except SalesCommercialError as exc:
        raise _http_commercial(exc) from exc
    return resolved_origin, resolved_po_number, resolved_po_date, resolved_internal_date


@router.post("", response_model=SalesOrderResponse)
def create_sales_order(
    payload: SalesOrderCreate,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin", "Sales"])),
):
    if not payload.lines:
        raise HTTPException(status_code=400, detail="At least one line is required")

    origin, po_number, po_date, internal_order_date = _validate_commercial_payload(
        origin=payload.origin,
        customer_id=payload.customer_id,
        po_number=payload.po_number,
        po_date=payload.po_date,
        internal_order_date=payload.internal_order_date,
        lines=payload.lines,
        delivery_schedules=payload.delivery_schedules,
    )

    order = SalesOrder(
        order_no=_next_order_no(db),
        customer_id=payload.customer_id,
        origin=origin,
        origin_review_required=origin == ORIGIN_REVIEW,
        po_number=po_number,
        po_date=po_date,
        internal_order_date=internal_order_date,
        notes=payload.notes,
        plant_id=plant_id,
        status=SalesOrderStatus.DRAFT,
        created_by=current_user.get("sub", "unknown"),
    )
    db.add(order)
    db.flush()

    for index, line in enumerate(payload.lines, start=1):
        target = SalesOrderLine(
            sales_order_id=order.id,
            fulfilled_qty=0.0,
        )
        _apply_line_fields(target, line, index)
        db.add(target)

    db.commit()
    db.refresh(order)
    order = (
        db.query(SalesOrder)
        .options(joinedload(SalesOrder.lines).joinedload(SalesOrderLine.release_lots))
        .filter(SalesOrder.id == order.id)
        .first()
    )
    try:
        from ..utils.audit_client import emit_audit_event
        emit_audit_event(
            token=current_user.get("token", ""),
            event_type="sales_order_created",
            entity_type="sales_order",
            entity_id=str(order.id),
            plant_id=str(plant_id),
            actor_role="Sales",
            actor_email=current_user.get("sub"),
            summary=f"Sales order {order.order_no} created with {len(payload.lines)} line(s)",
            payload={"order_no": order.order_no, "customer_id": str(payload.customer_id), "line_count": len(payload.lines)},
        )
    except Exception:
        pass
    return _serialize_order(order)


class SalesOrderBulkImport(BaseModel):
    orders: List[SalesOrderCreate] = Field(..., min_length=1)


@router.post("/import", response_model=List[SalesOrderResponse])
def bulk_import_sales_orders(
    payload: SalesOrderBulkImport,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin", "Sales"])),
):
    """Bulk create uses the same commercial contract as single-order create (R05/R08/R10)."""
    if not payload.orders:
        raise HTTPException(status_code=400, detail="At least one sales order is required")
    for index, row in enumerate(payload.orders, start=1):
        try:
            _validate_commercial_payload(
                origin=row.origin,
                customer_id=row.customer_id,
                po_number=row.po_number,
                po_date=row.po_date,
                internal_order_date=row.internal_order_date,
                lines=row.lines,
                delivery_schedules=row.delivery_schedules,
            )
        except HTTPException as exc:
            detail = exc.detail
            raise HTTPException(status_code=400, detail=f"Import row {index}: {detail}") from exc
    return [create_sales_order(row, db, plant_id, current_user) for row in payload.orders]


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
        db.query(SalesOrder).options(
            joinedload(SalesOrder.lines).joinedload(SalesOrderLine.release_lots),
            joinedload(SalesOrder.lines).joinedload(SalesOrderLine.dispatch_logs),
            joinedload(SalesOrder.lines).joinedload(SalesOrderLine.delivery_schedules),
        ),
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
            SalesOrder.origin.ilike(needle),
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


class SalesOrderAggregatesResponse(BaseModel):
    draft_count: int
    ready_count: int
    approved_count: int
    planner_synced_count: int
    open_order_count: int
    total_order_count: int
    open_qty: float
    remaining_qty: float
    booked_value: float = 0.0
    open_order_book_value: float = 0.0
    released_open_value: float = 0.0
    dispatched_value: float = 0.0
    open_value_by_customer: List[dict] = Field(default_factory=list)


class DeliveryScheduleRowInput(BaseModel):
    id: Optional[uuid.UUID] = None
    line_id: uuid.UUID
    delivery_date: date
    quantity: float = Field(..., gt=0)
    status: Optional[str] = "committed"


class DeliverySchedulePreviewPayload(BaseModel):
    rows: List[DeliveryScheduleRowInput] = Field(..., min_length=1)


class DeliveryScheduleCommitPayload(BaseModel):
    expected_revision: int = 0
    rows: List[DeliveryScheduleRowInput] = Field(..., min_length=1)
    allocations: Optional[List[dict]] = None


class ScheduleEntirePoLineSplit(BaseModel):
    delivery_date: date
    quantity: float = Field(..., gt=0)
    status: Optional[str] = "committed"


class ScheduleEntirePoPayload(BaseModel):
    expected_revision: int = 0
    default_date: Optional[date] = None
    line_splits: Optional[dict[str, List[ScheduleEntirePoLineSplit]]] = None


class DeliverySchedulePatchPayload(BaseModel):
    quantity: Optional[float] = Field(default=None, gt=0)
    delivery_date: Optional[date] = None
    status: Optional[str] = None


@router.get("/aggregates", response_model=SalesOrderAggregatesResponse)
def get_sales_order_aggregates(
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
    current_user: dict = Depends(get_current_user),
):
    del current_user
    base = apply_plant_scope(db.query(SalesOrder), SalesOrder.plant_id, plant_scope)
    total_order_count = int(base.count() or 0)
    draft_count = int(base.filter(SalesOrder.status.in_([SalesOrderStatus.DRAFT, SalesOrderStatus.SUBMITTED])).count() or 0)
    ready_statuses = [
        SalesOrderStatus.APPROVED,
        SalesOrderStatus.RELEASED,
        SalesOrderStatus.PARTIALLY_RELEASED,
        SalesOrderStatus.PARTIALLY_DISPATCHED,
    ]
    ready_count = int(base.filter(SalesOrder.status.in_(ready_statuses)).count() or 0)
    approved_count = int(base.filter(SalesOrder.status == SalesOrderStatus.APPROVED).count() or 0)
    open_order_count = int(base.filter(SalesOrder.status != SalesOrderStatus.CLOSED).count() or 0)

    open_qty_query = apply_plant_scope(
        db.query(func.coalesce(func.sum(SalesOrderLine.qty - SalesOrderLine.fulfilled_qty), 0.0)).join(
            SalesOrder, SalesOrder.id == SalesOrderLine.sales_order_id
        ).filter(SalesOrder.status != SalesOrderStatus.CLOSED),
        SalesOrder.plant_id,
        plant_scope,
    )
    open_qty = float(open_qty_query.scalar() or 0.0)

    synced_query = apply_plant_scope(
        db.query(func.count(func.distinct(SalesOrderReleaseLot.sales_order_id)))
        .join(SalesOrder, SalesOrder.id == SalesOrderReleaseLot.sales_order_id)
        .filter(SalesOrderReleaseLot.job_card_id.isnot(None))
        .filter(func.lower(func.coalesce(SalesOrderReleaseLot.status, "")) != "cancelled"),
        SalesOrder.plant_id,
        plant_scope,
    )
    planner_synced_count = int(synced_query.scalar() or 0)

    booked_value = float(
        apply_plant_scope(
            db.query(func.coalesce(func.sum(SalesOrderLine.qty * func.coalesce(SalesOrderLine.rate_per_pc, 0.0)), 0.0)).join(
                SalesOrder, SalesOrder.id == SalesOrderLine.sales_order_id
            ),
            SalesOrder.plant_id,
            plant_scope,
        ).scalar()
        or 0.0
    )
    open_order_book_value = float(
        apply_plant_scope(
            db.query(
                func.coalesce(
                    func.sum((SalesOrderLine.qty - SalesOrderLine.fulfilled_qty) * func.coalesce(SalesOrderLine.rate_per_pc, 0.0)),
                    0.0,
                )
            )
            .join(SalesOrder, SalesOrder.id == SalesOrderLine.sales_order_id)
            .filter(SalesOrder.status != SalesOrderStatus.CLOSED),
            SalesOrder.plant_id,
            plant_scope,
        ).scalar()
        or 0.0
    )
    dispatched_value = float(
        apply_plant_scope(
            db.query(func.coalesce(func.sum(SalesOrderLine.fulfilled_qty * func.coalesce(SalesOrderLine.rate_per_pc, 0.0)), 0.0)).join(
                SalesOrder, SalesOrder.id == SalesOrderLine.sales_order_id
            ),
            SalesOrder.plant_id,
            plant_scope,
        ).scalar()
        or 0.0
    )
    released_rows = apply_plant_scope(
        db.query(
            SalesOrderLine.id,
            SalesOrderLine.fulfilled_qty,
            SalesOrderLine.rate_per_pc,
            SalesOrderReleaseLot.released_qty,
            SalesOrderReleaseLot.status,
        )
        .join(SalesOrder, SalesOrder.id == SalesOrderLine.sales_order_id)
        .outerjoin(SalesOrderReleaseLot, SalesOrderReleaseLot.sales_order_line_id == SalesOrderLine.id)
        .filter(SalesOrder.status != SalesOrderStatus.CLOSED),
        SalesOrder.plant_id,
        plant_scope,
    ).all()
    released_by_line: dict[str, dict[str, float]] = {}
    for row in released_rows:
        bucket = released_by_line.setdefault(
            str(row.id),
            {"fulfilled": float(row.fulfilled_qty or 0.0), "rate": float(row.rate_per_pc or 0.0), "released": 0.0},
        )
        if str(row.status or "").lower() != "cancelled":
            bucket["released"] += float(row.released_qty or 0.0)
    released_open_value = sum(
        max(0.0, bucket["released"] - bucket["fulfilled"]) * bucket["rate"] for bucket in released_by_line.values()
    )

    customer_open_value = func.coalesce(
        func.sum((SalesOrderLine.qty - SalesOrderLine.fulfilled_qty) * func.coalesce(SalesOrderLine.rate_per_pc, 0.0)),
        0.0,
    ).label("open_value")
    customer_value_query = (
        apply_plant_scope(
            db.query(
                SalesOrder.customer_id,
                customer_open_value,
            )
            .join(SalesOrderLine, SalesOrderLine.sales_order_id == SalesOrder.id)
            .filter(SalesOrder.status != SalesOrderStatus.CLOSED)
            .group_by(SalesOrder.customer_id),
            SalesOrder.plant_id,
            plant_scope,
        )
        .order_by(customer_open_value.desc())
        .limit(5)
    )
    open_value_by_customer = [
        {"customer_id": str(row.customer_id), "open_value": round(float(row.open_value or 0.0), 2)}
        for row in customer_value_query.all()
        if float(row.open_value or 0.0) > 0
    ]

    return {
        "draft_count": draft_count,
        "ready_count": ready_count,
        "approved_count": approved_count,
        "planner_synced_count": planner_synced_count,
        "open_order_count": open_order_count,
        "total_order_count": total_order_count,
        "open_qty": round(open_qty, 2),
        "remaining_qty": round(max(open_qty, 0.0), 2),
        "booked_value": round(booked_value, 2),
        "open_order_book_value": round(open_order_book_value, 2),
        "released_open_value": round(released_open_value, 2),
        "dispatched_value": round(dispatched_value, 2),
        "open_value_by_customer": open_value_by_customer,
    }


def _pending_filters(
    *,
    search: Optional[str],
    customer_id: Optional[uuid.UUID],
    source: Optional[str],
    status: Optional[str],
    product: Optional[str],
    due_from: Optional[date],
    due_to: Optional[date],
    due_risk: Optional[str],
    missing_schedule: Optional[bool],
) -> dict:
    return {
        "search": search,
        "customer_id": str(customer_id) if customer_id else None,
        "source": source,
        "status": status,
        "product": product,
        "due_from": due_from,
        "due_to": due_to,
        "due_risk": due_risk,
        "missing_schedule": missing_schedule,
    }


@router.get("/pending")
def list_pending_orders(
    search: Optional[str] = Query(None, min_length=1, max_length=120),
    customer_id: Optional[uuid.UUID] = Query(None),
    source: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    product: Optional[str] = Query(None),
    due_from: Optional[date] = Query(None),
    due_to: Optional[date] = Query(None),
    due_risk: Optional[str] = Query(None),
    missing_schedule: Optional[bool] = Query(None),
    sort: str = Query("due_date"),
    direction: str = Query("asc"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
    current_user: dict = Depends(get_current_user),
):
    del current_user
    orders = load_open_orders(db, plant_scope)
    return build_pending_workspace(
        orders,
        filters=_pending_filters(
            search=search,
            customer_id=customer_id,
            source=source,
            status=status,
            product=product,
            due_from=due_from,
            due_to=due_to,
            due_risk=due_risk,
            missing_schedule=missing_schedule,
        ),
        limit=limit,
        offset=offset,
        sort=sort,
        direction=direction,
        plant_scope=plant_scope,
    )


@router.get("/pending/export")
def export_pending_orders(
    search: Optional[str] = Query(None, min_length=1, max_length=120),
    customer_id: Optional[uuid.UUID] = Query(None),
    source: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    product: Optional[str] = Query(None),
    due_from: Optional[date] = Query(None),
    due_to: Optional[date] = Query(None),
    due_risk: Optional[str] = Query(None),
    missing_schedule: Optional[bool] = Query(None),
    sort: str = Query("due_date"),
    direction: str = Query("asc"),
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
    current_user: dict = Depends(get_current_user),
):
    del current_user
    orders = load_open_orders(db, plant_scope)
    payload = build_pending_workspace(
        orders,
        filters=_pending_filters(
            search=search,
            customer_id=customer_id,
            source=source,
            status=status,
            product=product,
            due_from=due_from,
            due_to=due_to,
            due_risk=due_risk,
            missing_schedule=missing_schedule,
        ),
        limit=10_000_000,
        offset=0,
        sort=sort,
        direction=direction,
        plant_scope=plant_scope,
    )
    csv_body = export_pending_csv(payload)
    return StreamingResponse(
        iter([csv_body]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=pending-orders.csv"},
    )


def _group_rows_by_line(rows: List[DeliveryScheduleRowInput]) -> dict[str, list[dict]]:
    grouped: dict[str, list[dict]] = {}
    for row in rows:
        grouped.setdefault(str(row.line_id), []).append(
            {
                "id": str(row.id) if row.id else None,
                "line_id": str(row.line_id),
                "delivery_date": row.delivery_date,
                "quantity": row.quantity,
                "status": row.status or "committed",
            }
        )
    return grouped


@router.get("/{order_id}/delivery-schedules")
def get_order_delivery_schedules(
    order_id: uuid.UUID,
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
    current_user: dict = Depends(get_current_user),
):
    del current_user
    order = load_order_for_schedule(db, order_id, plant_scope)
    return list_order_schedules(order)


@router.post("/{order_id}/delivery-schedules/preview")
def preview_order_delivery_schedules(
    order_id: uuid.UUID,
    payload: DeliverySchedulePreviewPayload,
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
    current_user: dict = Depends(require_role(["Owner", "Admin", "Sales", "Planner"])),
):
    del current_user
    order = load_order_for_schedule(db, order_id, plant_scope)
    return preview_line_schedules(order, _group_rows_by_line(payload.rows))


@router.post("/{order_id}/delivery-schedules/commit")
def commit_order_delivery_schedules(
    order_id: uuid.UUID,
    payload: DeliveryScheduleCommitPayload,
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
    current_user: dict = Depends(require_role(["Owner", "Admin", "Sales", "Planner"])),
):
    order = load_order_for_schedule(db, order_id, plant_scope)
    return commit_line_schedules(
        db,
        order=order,
        proposed_by_line=_group_rows_by_line(payload.rows),
        expected_revision=payload.expected_revision,
        actor=str(current_user.get("sub") or "unknown"),
        allocations=payload.allocations,
    )


@router.post("/{order_id}/schedule-entire-po/preview")
def preview_schedule_entire_po(
    order_id: uuid.UUID,
    payload: ScheduleEntirePoPayload,
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
    current_user: dict = Depends(require_role(["Owner", "Admin", "Sales", "Planner"])),
):
    del current_user
    order = load_order_for_schedule(db, order_id, plant_scope)
    splits = None
    if payload.line_splits:
        splits = {
            line_id: [item.model_dump() if hasattr(item, "model_dump") else item.dict() for item in rows]
            for line_id, rows in payload.line_splits.items()
        }
    return preview_entire_po(order, default_date=payload.default_date, line_splits=splits)


@router.post("/{order_id}/schedule-entire-po/commit")
def commit_schedule_entire_po(
    order_id: uuid.UUID,
    payload: ScheduleEntirePoPayload,
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
    current_user: dict = Depends(require_role(["Owner", "Admin", "Sales", "Planner"])),
):
    order = load_order_for_schedule(db, order_id, plant_scope)
    splits = None
    if payload.line_splits:
        splits = {
            line_id: [item.model_dump() if hasattr(item, "model_dump") else item.dict() for item in rows]
            for line_id, rows in payload.line_splits.items()
        }
    return commit_entire_po(
        db,
        order=order,
        expected_revision=payload.expected_revision,
        actor=str(current_user.get("sub") or "unknown"),
        default_date=payload.default_date,
        line_splits=splits,
    )


@router.patch("/{order_id}/delivery-schedules/{schedule_id}")
def patch_delivery_schedule_row(
    order_id: uuid.UUID,
    schedule_id: uuid.UUID,
    payload: DeliverySchedulePatchPayload,
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
    current_user: dict = Depends(require_role(["Owner", "Admin", "Sales", "Planner"])),
):
    order = load_order_for_schedule(db, order_id, plant_scope)
    return mutate_schedule_row(
        db,
        order=order,
        schedule_id=schedule_id,
        updates=payload.model_dump() if hasattr(payload, "model_dump") else payload.dict(),
        actor=str(current_user.get("sub") or "unknown"),
    )


@router.get("/open-demand")
def list_open_demand(
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
    current_user: dict = Depends(get_current_user),
):
    """All in-scope open sales lines. Not the first page of /sales-orders."""
    return collect_open_demand(db, plant_scope)




@router.get("/{order_id}/timeline")
def get_sales_order_timeline(
    order_id: uuid.UUID,
    depth: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
    current_user: dict = Depends(get_current_user),
):
    query = apply_plant_scope(
        db.query(SalesOrder)
        .options(
            joinedload(SalesOrder.lines).joinedload(SalesOrderLine.release_lots),
            joinedload(SalesOrder.lines).joinedload(SalesOrderLine.dispatch_logs),
        )
        .filter(SalesOrder.id == order_id),
        SalesOrder.plant_id,
        plant_scope,
    )
    order = query.first()
    if not order:
        raise HTTPException(status_code=404, detail="Sales order not found")

    events = [
        _timeline_event(
            event_id=f"{order.id}:created",
            event_type="SALES_ORDER_CREATED",
            title="Sales order created",
            message="Commercial demand entered into the queue.",
            created_at=order.created_at,
            actor=order.created_by,
            metadata={
                "order_no": order.order_no,
                "status": order.status.value,
                "origin": getattr(order, "origin", None),
            },
        )
    ]
    warnings = []

    if order.approved_at:
        events.append(
            _timeline_event(
                event_id=f"{order.id}:approved",
                event_type="SALES_ORDER_APPROVED",
                title="Sales order approved",
                message="Commercial approval completed.",
                created_at=order.approved_at,
                actor=order.approved_by,
                metadata={"order_no": order.order_no, "status": order.status.value},
            )
        )

    if order.released_at:
        events.append(
            _timeline_event(
                event_id=f"{order.id}:released",
                event_type="SALES_ORDER_RELEASED",
                title="Released to production",
                message="Order is eligible for planning sync and job-card creation.",
                created_at=order.released_at,
                actor=order.released_by,
                metadata={"order_no": order.order_no, "status": order.status.value},
            )
        )

    if not order.lines:
        warnings.append("Sales order has no lines.")

    for line in sorted(order.lines, key=lambda item: int(item.line_no or 0)):
        events.append(
            _timeline_event(
                event_id=f"{line.id}:line",
                event_type="SALES_ORDER_LINE_CREATED",
                title=f"Line {int(line.line_no or 0)} entered",
                message=f"{round(float(line.qty or 0.0), 2)} pcs requested for {line.product_code or 'product'}.",
                created_at=order.created_at,
                actor=order.created_by,
                line_id=line.id,
                qty=line.qty,
                metadata={
                    "approved_spec_id": str(line.approved_spec_id),
                    "product_code": line.product_code,
                    "parchment_required": bool(getattr(line, "parchment_required", False)),
                    "parchment_color": line.parchment_color if getattr(line, "parchment_required", False) else None,
                    "due_date": str(line.due_date),
                },
            )
        )

        release_lots = [lot for lot in getattr(line, "release_lots", []) if str(lot.status or "").lower() != "cancelled"]
        released_qty = sum(float(lot.released_qty or 0.0) for lot in release_lots)
        if released_qty - float(line.qty or 0.0) > 0.001:
            warnings.append(f"Line {int(line.line_no or 0)} released qty exceeds order qty.")

        for lot in sorted(release_lots, key=lambda item: item.created_at or datetime.min):
            events.append(
                _timeline_event(
                    event_id=f"{lot.id}:release",
                    event_type="SALES_ORDER_LINE_RELEASED",
                    title=f"Line {int(line.line_no or 0)} released",
                    message=f"{round(float(lot.released_qty or 0.0), 2)} pcs released to planning.",
                    created_at=lot.released_at or lot.created_at,
                    actor=lot.released_by_identity or lot.released_by,
                    line_id=line.id,
                    qty=lot.released_qty,
                    metadata={
                        "release_lot_id": str(lot.id),
                        "job_card_id": str(lot.job_card_id) if lot.job_card_id else None,
                        "winder_machine_id": str(lot.winder_machine_id) if lot.winder_machine_id else None,
                        "product_code": lot.product_code,
                        "status": lot.status,
                    },
                )
            )

        if float(line.fulfilled_qty or 0.0) - float(line.qty or 0.0) > 0.001:
            warnings.append(f"Line {int(line.line_no or 0)} fulfilled qty exceeds order qty.")

        for log in sorted(getattr(line, "dispatch_logs", []), key=lambda item: item.created_at or datetime.min):
            events.append(
                _timeline_event(
                    event_id=f"{log.id}:dispatch",
                    event_type="SALES_ORDER_DISPATCH_RECORDED",
                    title=f"Line {int(line.line_no or 0)} dispatched",
                    message=f"{round(float(log.qty or 0.0), 2)} pcs recorded against dispatch {log.dispatch_line_ref}.",
                    created_at=log.created_at,
                    actor="dispatch",
                    line_id=line.id,
                    qty=log.qty,
                    metadata={"dispatch_line_ref": log.dispatch_line_ref},
                )
            )

    events = sorted(events, key=lambda event: event.get("created_at") or datetime.min)
    return {
        "order_id": str(order.id),
        "order_no": order.order_no,
        "plant_id": str(order.plant_id),
        "status": order.status.value,
        "depth": depth or "summary",
        "events": events,
        "items": events,
        "warnings": warnings,
    }


@router.get("/{order_id}", response_model=SalesOrderResponse)
def get_sales_order(
    order_id: uuid.UUID,
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
    current_user: dict = Depends(get_current_user),
):
    query = apply_plant_scope(
        db.query(SalesOrder)
        .options(
            joinedload(SalesOrder.lines).joinedload(SalesOrderLine.release_lots),
            joinedload(SalesOrder.lines).joinedload(SalesOrderLine.delivery_schedules),
        )
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
        SalesOrderStatus.APPROVED,
        SalesOrderStatus.RELEASED,
        SalesOrderStatus.PARTIALLY_RELEASED,
        SalesOrderStatus.PARTIALLY_DISPATCHED,
        SalesOrderStatus.CLOSED,
    ]:
        raise HTTPException(status_code=400, detail="Only draft/submitted orders can be edited; approved commercial terms are locked")

    if payload.customer_id is not None:
        order.customer_id = payload.customer_id
    if payload.origin is not None:
        order.origin = payload.origin
    if payload.po_number is not None:
        order.po_number = payload.po_number
    if payload.po_date is not None:
        order.po_date = payload.po_date
    if payload.internal_order_date is not None:
        order.internal_order_date = payload.internal_order_date
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
        _upsert_order_lines(order, payload.lines)

    working_lines = payload.lines if payload.lines is not None else [
        SalesOrderLineInput(
            id=line.id,
            approved_spec_id=line.approved_spec_id,
            line_no=int(line.line_no or 0) or None,
            product_code=line.product_code,
            parchment_required=bool(getattr(line, "parchment_required", False)),
            parchment_color_id=getattr(line, "parchment_color_id", None),
            parchment_color=line.parchment_color,
            rate_per_pc=line.rate_per_pc,
            qty=line.qty,
            due_date=line.due_date,
        )
        for line in order.lines
    ]
    origin, po_number, po_date, internal_order_date = _validate_commercial_payload(
        origin=order.origin,
        customer_id=order.customer_id,
        po_number=order.po_number,
        po_date=order.po_date,
        internal_order_date=order.internal_order_date,
        lines=working_lines,
        delivery_schedules=payload.delivery_schedules,
    )
    order.origin = origin
    order.origin_review_required = origin == ORIGIN_REVIEW
    order.po_number = po_number
    order.po_date = po_date
    order.internal_order_date = internal_order_date

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
    order = (
        db.query(SalesOrder)
        .options(joinedload(SalesOrder.lines))
        .filter(SalesOrder.id == order_id, SalesOrder.plant_id == plant_id)
        .first()
    )
    if not order:
        raise HTTPException(status_code=404, detail="Sales order not found")

    if order.status not in [SalesOrderStatus.DRAFT, SalesOrderStatus.SUBMITTED]:
        raise HTTPException(status_code=400, detail="Only draft/submitted orders can be approved")

    try:
        validate_persisted_order(order)
    except SalesCommercialError as exc:
        raise _http_commercial(exc) from exc

    actor = str(current_user.get("actual_sub") or current_user.get("sub") or "").strip().lower()
    if str(order.created_by or "").strip().lower() == actor:
        raise HTTPException(status_code=403, detail="A different authorized person must approve this sales order")
    order.status = SalesOrderStatus.APPROVED
    order.approved_by = actor
    order.approved_at = datetime.utcnow()
    db.commit()

    try:
        from ..utils.audit_client import emit_audit_event
        emit_audit_event(
            token=current_user.get("token", ""),
            event_type="sales_order_approved",
            entity_type="sales_order",
            entity_id=str(order.id),
            plant_id=str(plant_id),
            actor_role=str((current_user.get("roles") or ["?"])[0]),
            actor_email=current_user.get("sub"),
            summary=f"Sales order {order.order_no} approved",
        )
    except Exception:
        pass

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
    current_user: dict = Depends(require_role(["Owner", "Admin", "Sales", "Planner"])),
):
    order = db.query(SalesOrder).filter(
        SalesOrder.id == order_id, SalesOrder.plant_id == plant_id
    ).first()
    if not order:
        raise HTTPException(status_code=404, detail="Sales order not found")

    if order.status != SalesOrderStatus.APPROVED:
        raise HTTPException(status_code=400, detail="Only approved orders can be released")

    order.status = SalesOrderStatus.RELEASED
    order.released_by = current_user.get("sub")
    order.released_at = datetime.utcnow()
    db.commit()

    try:
        from ..utils.audit_client import emit_audit_event
        emit_audit_event(
            token=current_user.get("token", ""),
            event_type="sales_order_released",
            entity_type="sales_order",
            entity_id=str(order.id),
            plant_id=str(plant_id),
            actor_role=str((current_user.get("roles") or ["?"])[0]),
            actor_email=current_user.get("sub"),
            summary=f"Sales order {order.order_no} released",
        )
    except Exception:
        pass

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
    current_user: dict = Depends(require_role(["Owner", "Admin", "Sales", "Planner"])),
):
    # Lock the quantity-owning line row for the duration of the transaction so
    # concurrent or retried releases serialize instead of each reading a stale
    # unreleased balance and inserting a lot (audit finding S04 — over-allocation).
    # FOR UPDATE OF sales_order_lines locks only the fulfillment row; a joinedload
    # of the nullable release_lots side would make PostgreSQL reject the lock.
    line = (
        db.query(SalesOrderLine)
        .join(SalesOrder)
        .options(joinedload(SalesOrderLine.sales_order))
        .filter(SalesOrderLine.id == line_id, SalesOrder.plant_id == plant_id)
        .with_for_update(of=SalesOrderLine)
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
        if abs(float(existing_lot.released_qty or 0.0) - float(payload.release_qty)) > 0.0001:
            raise HTTPException(status_code=409, detail="An existing release lot quantity cannot be changed")
        if existing_lot.job_card_id and existing_lot.winder_machine_id != payload.winder_machine_id:
            raise HTTPException(status_code=409, detail="A planner-linked release lot cannot change its winder")
        if not existing_lot.job_card_id:
            existing_lot.winder_machine_id = payload.winder_machine_id
            existing_lot.product_code = (payload.product_code or line.product_code or "").strip() or None
            db.commit()
            db.refresh(existing_lot)
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

    # Re-read the already-released quantity from committed rows *inside* the locked
    # transaction (not from a possibly-stale relationship snapshot) before deciding
    # whether this new lot fits within the unreleased balance.
    already_released = (
        db.query(func.coalesce(func.sum(SalesOrderReleaseLot.released_qty), 0.0))
        .filter(
            SalesOrderReleaseLot.sales_order_line_id == line.id,
            func.lower(func.coalesce(SalesOrderReleaseLot.status, "")) != "cancelled",
        )
        .scalar()
    )
    unreleased_qty = max(0.0, float(line.qty or 0.0) - float(already_released or 0.0))
    if payload.release_qty > unreleased_qty + 1e-9:
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
    if lot not in list(line.release_lots or []):
        line.release_lots.append(lot)
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
    current_user: dict = Depends(require_role(["Owner", "Admin", "Sales", "Planner", "PlantManager"])),
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


@router.post("/release-lots/{release_lot_id}/reallocate-carry-forward", response_model=SalesOrderReleaseLotResponse)
def reallocate_release_lot_carry_forward(
    release_lot_id: uuid.UUID,
    payload: ReleaseLotReallocatePayload,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin", "Owner", "Sales", "Planner", "PlantManager"])),
):
    """Split a release lot so a carry-forward top-up job card owns the gap qty.

    Called server-to-server from production-service when a short-close carries the
    gap forward. Total released qty across the two lots stays constant: the original
    lot shrinks to the produced portion and a new lot is minted for the gap, pointed
    at the top-up job card.
    """
    requested_lot_id = payload.release_lot_id or uuid.uuid5(
        uuid.NAMESPACE_URL,
        f"hariom:carry-release:{payload.carry_forward_job_card_id}",
    )
    existing = db.query(SalesOrderReleaseLot).filter(SalesOrderReleaseLot.id == requested_lot_id).first()
    if existing:
        if existing.job_card_id != payload.carry_forward_job_card_id:
            raise HTTPException(status_code=409, detail="Carry-forward release lot id belongs to another job card")
        if abs(float(existing.released_qty or 0.0) - float(payload.gap_qty or 0.0)) > 0.0001:
            raise HTTPException(status_code=409, detail="Carry-forward release lot was already used with a different quantity")
        return {
            "id": existing.id,
            "order_id": existing.sales_order_id,
            "line_id": existing.sales_order_line_id,
            "release_lot_id": existing.id,
            "release_qty": existing.released_qty,
            "winder_machine_id": existing.winder_machine_id,
            "product_code": existing.product_code,
            "status": existing.status,
            "job_card_id": existing.job_card_id,
            "created_by": existing.released_by or "unknown",
            "approved_by": existing.released_by_identity or existing.released_by,
            "created_at": existing.created_at,
        }

    original = (
        db.query(SalesOrderReleaseLot)
        .join(SalesOrderLine)
        .join(SalesOrder)
        .options(joinedload(SalesOrderReleaseLot.line).joinedload(SalesOrderLine.sales_order))
        .filter(SalesOrderReleaseLot.id == release_lot_id, SalesOrder.plant_id == plant_id)
        .first()
    )
    if not original:
        raise HTTPException(status_code=404, detail="Release lot not found")

    shrunk_qty, gap_qty = carry_forward_lot_split(original.released_qty, payload.gap_qty)
    original.released_qty = shrunk_qty

    new_lot = SalesOrderReleaseLot(
        id=requested_lot_id,
        sales_order_id=original.sales_order_id,
        sales_order_line_id=original.sales_order_line_id,
        product_code=original.product_code,
        released_qty=gap_qty,
        winder_machine_id=original.winder_machine_id,
        job_card_id=payload.carry_forward_job_card_id,
        status="released",
        released_by=current_user.get("sub", "unknown"),
        released_by_identity=current_user.get("sub"),
        released_at=datetime.utcnow(),
    )
    db.add(new_lot)
    db.commit()
    db.refresh(new_lot)

    try:
        from ..utils.audit_client import emit_audit_event
        emit_audit_event(
            token=current_user.get("token", ""),
            event_type="release_lot_reallocated_carry_forward",
            entity_type="sales_order_release_lot",
            entity_id=str(new_lot.id),
            plant_id=str(plant_id),
            actor_role=str((current_user.get("roles") or ["?"])[0]),
            actor_email=current_user.get("sub"),
            summary=(
                f"Split release lot {release_lot_id} for carry-forward: "
                f"{round(gap_qty, 2)} pcs reallocated to job card "
                f"{payload.carry_forward_job_card_id} (new lot {new_lot.id})."
            ),
        )
    except Exception as exc:  # pragma: no cover - audit is best-effort
        logger.warning("Failed to emit release_lot_reallocated_carry_forward audit event: %s", exc)

    return {
        "id": new_lot.id,
        "order_id": original.sales_order_id,
        "line_id": new_lot.sales_order_line_id,
        "release_lot_id": new_lot.id,
        "release_qty": new_lot.released_qty,
        "winder_machine_id": new_lot.winder_machine_id,
        "product_code": new_lot.product_code,
        "status": new_lot.status,
        "job_card_id": new_lot.job_card_id,
        "created_by": new_lot.released_by or "unknown",
        "approved_by": new_lot.released_by_identity or new_lot.released_by,
        "created_at": new_lot.created_at,
    }


@router.post("/lines/{line_id}/short-close", response_model=SalesOrderLineResponse)
def short_close_sales_order_line(
    line_id: uuid.UUID,
    payload: SalesOrderLineShortClosePayload,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin", "Owner", "Sales", "Planner", "PlantManager"])),
):
    """Reduce a sales line/release lot after production short-closes the gap."""
    line = (
        db.query(SalesOrderLine)
        .join(SalesOrder)
        .options(joinedload(SalesOrderLine.sales_order), joinedload(SalesOrderLine.release_lots))
        .filter(SalesOrderLine.id == line_id, SalesOrder.plant_id == plant_id)
        .first()
    )
    if not line:
        raise HTTPException(status_code=404, detail="Sales order line not found")

    reason = (payload.reason_code or "").strip().upper()
    if not reason:
        raise HTTPException(status_code=422, detail="reason_code is required")

    active_lots = [
        lot for lot in getattr(line, "release_lots", [])
        if str(lot.status or "").lower() != "cancelled"
    ]
    matched_lot = next((lot for lot in active_lots if str(lot.job_card_id) == str(payload.job_card_id)), None)
    if matched_lot is None and active_lots:
        matched_lot = sorted(active_lots, key=lambda lot: lot.created_at or datetime.min)[-1]

    if matched_lot is not None:
        matched_lot.released_qty = max(0.0, round(float(matched_lot.released_qty or 0.0) - float(payload.gap_qty or 0.0), 4))
        if matched_lot.released_qty <= 0.0001:
            matched_lot.status = "short_closed"

    released_after = sum(
        float(lot.released_qty or 0.0)
        for lot in active_lots
        if str(lot.status or "").lower() != "cancelled"
    )
    old_qty = float(line.qty or 0.0)
    requested_qty = max(0.0, old_qty - float(payload.gap_qty or 0.0))
    line.qty = round(max(float(line.fulfilled_qty or 0.0), released_after, requested_qty), 4)
    order = line.sales_order
    note = (
        f"Short-closed line {int(line.line_no or 0)} by {round(float(payload.gap_qty or 0.0), 2)} pcs "
        f"from job card {payload.job_card_id} ({reason})."
    )
    order.notes = "\n".join([text for text in [order.notes, note, payload.notes] if text])
    _sync_release_status(order)
    _sync_order_status(order)
    db.commit()
    db.refresh(line)

    try:
        from ..utils.audit_client import emit_audit_event
        emit_audit_event(
            token=current_user.get("token", ""),
            event_type="sales_order_line_short_closed",
            entity_type="sales_order_line",
            entity_id=str(line.id),
            plant_id=str(plant_id),
            actor_role=str((current_user.get("roles") or ["?"])[0]),
            actor_email=current_user.get("sub"),
            summary=note,
        )
    except Exception:
        pass

    return _serialize_line(line)


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
    current_user: dict = Depends(require_role(["Admin", "Owner", "Dispatch"])),
):
    line = (
        db.query(SalesOrderLine)
        .join(SalesOrder)
        .filter(SalesOrderLine.id == line_id, SalesOrder.plant_id == plant_id)
        # Lock only the fulfillment row. Locking a joinedload-generated outer
        # join also tries to lock nullable dispatch-log rows, which PostgreSQL
        # rejects and would make every real dispatch fail after inventory posts.
        .with_for_update(of=SalesOrderLine)
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
