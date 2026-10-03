from datetime import date, datetime, timedelta
from math import isfinite, isclose
from typing import List, Optional
import logging
import uuid
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import and_, func, literal, or_, select, text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session, joinedload

from ..database import get_db
from ..open_demand import collect_open_demand
from ..due_risk import plant_today
from ..models import (
    SalesOrder,
    SalesOrderLine,
    SalesOrderNumberCounter,
    SalesOrderReleaseLot,
    SalesOrderStatus,
    SalesOrderDispatchLog,
    SalesOrderLineColor,
)
from ..color_allocation import (
    ColorAllocationError,
    ColorSplit,
    color_key,
    color_summary,
    normalize_color_splits,
    plan_color_release,
    released_by_color,
    validate_splits_cover_releases,
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
    group_move_remainder,
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


class LineColorInput(BaseModel):
    color: str = Field(..., min_length=1, max_length=100)
    color_id: Optional[uuid.UUID] = None
    qty: float = Field(..., ge=0)


class SalesOrderLineInput(BaseModel):
    id: Optional[uuid.UUID] = None
    approved_spec_id: uuid.UUID
    line_no: Optional[int] = None
    product_code: Optional[str] = None
    size_label: Optional[str] = Field(default=None, max_length=160)
    parchment_required: Optional[bool] = None
    parchment_color_id: Optional[uuid.UUID] = None
    parchment_color: Optional[str] = None
    # Optional color breakup (parchment lines). Sum may stay below qty; the rest is "unassigned".
    color_splits: Optional[List[LineColorInput]] = None
    rate_per_pc: Optional[float] = Field(default=None, ge=0)
    qty: float = Field(..., gt=0)
    due_date: date

    @field_validator("qty")
    @classmethod
    def qty_must_be_finite(cls, value: float) -> float:
        if not isfinite(value):
            raise ValueError("Quantity must be a finite number")
        return value


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
    expiry_date: Optional[date] = None
    lines: List[SalesOrderLineInput] = Field(..., min_length=1)
    delivery_schedules: Optional[List[DeliveryScheduleInput]] = None


class SalesOrderUpdate(BaseModel):
    customer_id: Optional[uuid.UUID] = None
    origin: Optional[str] = None
    po_number: Optional[str] = None
    po_date: Optional[date] = None
    internal_order_date: Optional[date] = None
    notes: Optional[str] = None
    expiry_date: Optional[date] = None
    status: Optional[str] = None
    lines: Optional[List[SalesOrderLineInput]] = None
    delivery_schedules: Optional[List[DeliveryScheduleInput]] = None


class DispatchValidationPayload(BaseModel):
    qty: float = Field(..., gt=0)
    approved_spec_id: Optional[uuid.UUID] = None
    dispatch_line_ref: Optional[str] = Field(default=None, min_length=1, max_length=100)


class RecordDispatchPayload(BaseModel):
    qty: float = Field(..., gt=0)
    dispatch_line_ref: str = Field(..., min_length=1, max_length=100)


class SalesOrderLineReleasePayload(BaseModel):
    release_qty: float = Field(..., gt=0)
    winder_machine_id: uuid.UUID
    product_code: Optional[str] = None
    release_lot_id: Optional[uuid.UUID] = None
    # Required for parchment lines: one release lot (= one job card) is exactly one color.
    parchment_color: Optional[str] = Field(default=None, max_length=100)
    parchment_color_id: Optional[uuid.UUID] = None

    @field_validator("release_qty")
    @classmethod
    def release_qty_must_be_finite(cls, value: float) -> float:
        if not isfinite(value):
            raise ValueError("Release quantity must be a finite number")
        return value


class ReleaseLotJobCardSyncPayload(BaseModel):
    job_card_id: uuid.UUID


class LineColorsPayload(BaseModel):
    color_splits: List[LineColorInput] = Field(default_factory=list)


class ReleaseLotAmendPayload(BaseModel):
    """Planner edit of a queued (not yet scheduled) job card: qty and/or color."""

    job_card_id: uuid.UUID
    release_qty: Optional[float] = Field(default=None, gt=0)
    parchment_color: Optional[str] = Field(default=None, max_length=100)
    parchment_color_id: Optional[uuid.UUID] = None
    reason: Optional[str] = Field(default=None, max_length=500)


class ReleaseLotReturnPayload(BaseModel):
    """Force-close: the unmade balance of a job card goes back to the line as unreleased."""

    job_card_id: uuid.UUID
    returned_qty: float = Field(..., ge=0)
    reason: Optional[str] = Field(default=None, max_length=500)


class ReleaseLotReallocatePayload(BaseModel):
    carry_forward_job_card_id: uuid.UUID
    gap_qty: float = Field(..., gt=0, allow_inf_nan=False)
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
    produced_qty: float = Field(..., ge=0, allow_inf_nan=False)
    gap_qty: float = Field(..., gt=0, allow_inf_nan=False)
    reason_code: str
    notes: Optional[str] = None
    # V2 uses an absolute released-allocation target so a committed Sales call
    # can be retried after its response was lost without shortening the SO twice.
    expected_release_qty: Optional[float] = Field(None, gt=0, allow_inf_nan=False)


class SalesOrderReleaseLotResponse(BaseModel):
    id: uuid.UUID
    order_id: uuid.UUID
    line_id: uuid.UUID
    release_lot_id: uuid.UUID
    release_qty: float
    source_release_lot_id: Optional[uuid.UUID] = None
    winder_machine_id: Optional[uuid.UUID]
    product_code: Optional[str]
    status: str
    job_card_id: Optional[uuid.UUID]
    parchment_color: Optional[str] = None
    parchment_color_id: Optional[uuid.UUID] = None
    returned_qty: float = 0.0
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
    size_label: Optional[str] = None
    parchment_required: bool = False
    parchment_color_id: Optional[uuid.UUID] = None
    parchment_color: Optional[str]
    rate_per_pc: Optional[float]
    qty: float
    due_date: date
    earliest_delivery_date: Optional[date] = None
    released_qty: float
    fulfilled_qty: float
    remaining_qty: float
    release_remaining_qty: float
    hold_qty: float = 0.0
    pending_qty: float = 0.0
    release_lots: List[SalesOrderReleaseLotResponse] = Field(default_factory=list)
    color_splits: List[dict] = Field(default_factory=list)
    unassigned_color_qty: float = 0.0
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
    expiry_date: Optional[date] = None
    is_held: bool = False
    hold_reason: Optional[str] = None
    held_at: Optional[datetime] = None
    held_by: Optional[str] = None
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
    from ..schedule_policy import remaining_to_schedule, earliest_pending_delivery

    release_lots = [lot for lot in getattr(line, "release_lots", []) if str(lot.status or "").lower() != "cancelled"]
    released_qty = sum(float(lot.released_qty or 0.0) for lot in release_lots)
    parchment_required = bool(getattr(line, "parchment_required", False))
    parchment_color = getattr(line, "parchment_color", None) if parchment_required else None
    parchment_color_id = getattr(line, "parchment_color_id", None) if parchment_required else None
    schedules = list(getattr(line, "delivery_schedules", []) or [])
    colors = color_summary(line.qty, _line_splits(line), released_by_color(release_lots)) if parchment_required else {"color_splits": [], "unassigned_color_qty": 0.0}
    return {
        **colors,
        "id": line.id,
        "line_no": int(line.line_no or 1),
        "approved_spec_id": line.approved_spec_id,
        "product_code": line.product_code,
        "size_label": getattr(line, "size_label", None),
        "parchment_required": parchment_required,
        "parchment_color_id": parchment_color_id,
        "parchment_color": parchment_color,
        "rate_per_pc": line.rate_per_pc,
        "qty": line.qty,
        "due_date": line.due_date,
        "earliest_delivery_date": earliest_pending_delivery(line),
        "released_qty": round(released_qty, 2),
        "fulfilled_qty": line.fulfilled_qty,
        "remaining_qty": max(0.0, line.qty - line.fulfilled_qty),
        "release_remaining_qty": max(0.0, line.qty - released_qty),
        "hold_qty": round(float(getattr(line, "hold_qty", 0.0) or 0.0), 2),
        "pending_qty": round(max(0.0, float(line.qty or 0.0) - float(line.fulfilled_qty or 0.0) - float(getattr(line, "hold_qty", 0.0) or 0.0)), 2),
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
                "source_release_lot_id": getattr(lot, "source_release_lot_id", None),
                "winder_machine_id": lot.winder_machine_id,
                "product_code": lot.product_code,
                "status": lot.status,
                "job_card_id": lot.job_card_id,
                "parchment_color": getattr(lot, "parchment_color", None),
                "parchment_color_id": getattr(lot, "parchment_color_id", None),
                "returned_qty": float(getattr(lot, "returned_qty", 0.0) or 0.0),
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
        "expiry_date": getattr(order, "expiry_date", None),
        "is_held": getattr(order, "held_at", None) is not None,
        "hold_reason": getattr(order, "hold_reason", None),
        "held_at": getattr(order, "held_at", None),
        "held_by": getattr(order, "held_by", None),
        "plant_id": str(order.plant_id),
        "lines": [
            _serialize_line(line)
            for line in sorted(order.lines, key=lambda item: (int(item.line_no or 0), str(item.id)))
        ],
    }


def existing_order_seq_max(db: Session, date_part: str) -> int:
    """Highest ``NNNN`` already persisted for ``SO-{date_part}-NNNN``."""
    value = db.execute(
        text(
            "SELECT COALESCE(MAX(CAST(substring(order_no FROM 13) AS INTEGER)), 0) "
            "FROM sales_orders "
            "WHERE order_no LIKE :pfx"
        ),
        {"pfx": f"SO-{date_part}-%"},
    ).scalar()
    return int(value or 0)


def next_counter_seq(current_last_seq: int | None, max_existing: int) -> int:
    """Jump the allocator past both the counter and any pre-counter rows."""
    base = int(current_last_seq or 0)
    return max(base, int(max_existing or 0)) + 1


def _next_order_no(db: Session) -> str:
    """Allocate the next ``SO-YYYYMMDD-NNNN`` reference atomically.

    A single counter row per date key is incremented with an atomic upsert that
    returns the new value, so concurrent creates can never collide on the same
    sequence number. The upsert also jumps past any ``sales_orders.order_no``
    values minted before the counter existed, otherwise UniqueViolation 500s
    appear once the counter lags the live table.
    """
    date_part = datetime.utcnow().strftime("%Y%m%d")
    max_existing = existing_order_seq_max(db, date_part)
    stmt = (
        pg_insert(SalesOrderNumberCounter)
        .values(date_key=date_part, last_seq=next_counter_seq(None, max_existing))
        .on_conflict_do_update(
            index_elements=[SalesOrderNumberCounter.date_key],
            set_={
                "last_seq": func.greatest(SalesOrderNumberCounter.last_seq, literal(max_existing)) + 1
            },
        )
        .returning(SalesOrderNumberCounter.last_seq)
    )
    seq = db.execute(stmt).scalar_one()
    return f"SO-{date_part}-{int(seq):04d}"


DEFAULT_EXPIRY_DAYS = 45


def default_expiry_date(po_date: Optional[date], internal_order_date: Optional[date], today: Optional[date] = None) -> date:
    """Commercial validity: PO (or internal order) date + 45 days."""
    base = po_date or internal_order_date or today or date.today()
    return base + timedelta(days=DEFAULT_EXPIRY_DAYS)


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


def _lot_payload(lot: SalesOrderReleaseLot, order_id) -> dict:
    return {
        "id": lot.id,
        "order_id": order_id,
        "line_id": lot.sales_order_line_id,
        "release_lot_id": lot.id,
        "release_qty": lot.released_qty,
        "source_release_lot_id": getattr(lot, "source_release_lot_id", None),
        "winder_machine_id": lot.winder_machine_id,
        "product_code": lot.product_code,
        "status": lot.status,
        "job_card_id": lot.job_card_id,
        "parchment_color": getattr(lot, "parchment_color", None),
        "parchment_color_id": getattr(lot, "parchment_color_id", None),
        "returned_qty": float(getattr(lot, "returned_qty", 0.0) or 0.0),
        "created_by": lot.released_by or "unknown",
        "approved_by": lot.released_by_identity or lot.released_by,
        "created_at": lot.created_at,
    }


def _resolve_release_color(
    line: SalesOrderLine,
    color: Optional[str],
    color_id: Optional[uuid.UUID],
    release_qty: float,
    *,
    exclude_lot_id: Optional[uuid.UUID] = None,
) -> tuple[Optional[str], Optional[uuid.UUID]]:
    """One release lot = one color. Validates the color balance and tops it up from unassigned."""
    if not bool(getattr(line, "parchment_required", False)):
        return None, None
    splits = _line_splits(line)
    name = (color or "").strip()
    if not name and color_id is not None:
        name = next((split.color for split in splits if split.color_id == color_id), "")
    if not name and len(splits) == 1 and splits[0].qty + 1e-6 >= float(line.qty or 0.0):
        # Whole line is one color: releasing it needs no extra choice.
        name, color_id = splits[0].color, splits[0].color_id
    if not name:
        raise HTTPException(
            status_code=400,
            detail=f"Line {int(line.line_no or 0)}: choose the parchment color for this release — one job card is one color",
        )
    lots = [lot for lot in (line.release_lots or []) if exclude_lot_id is None or lot.id != exclude_lot_id]
    try:
        extra = plan_color_release(
            line_qty=float(line.qty or 0.0),
            splits=splits,
            released=released_by_color(lots),
            color=name,
            color_id=color_id,
            release_qty=float(release_qty),
            line_no=int(line.line_no or 0) or None,
        )
    except ColorAllocationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if extra > 0:
        key = color_key(color_id, name)
        grown = [
            ColorSplit(color=split.color, qty=split.qty + (extra if split.key == key else 0.0), color_id=split.color_id)
            for split in splits
        ]
        if not any(split.key == key for split in splits):
            grown.append(ColorSplit(color=name, qty=extra, color_id=color_id))
        _write_line_splits(line, grown)
    return name, color_id


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
    target.size_label = (incoming.size_label or "").strip() or None
    target.parchment_required = required
    target.parchment_color_id = color_id
    target.parchment_color = color
    target.rate_per_pc = incoming.rate_per_pc
    target.qty = incoming.qty
    target.due_date = incoming.due_date
    _apply_color_splits(target, incoming, index)


def _line_splits(line: SalesOrderLine) -> list[ColorSplit]:
    return [
        ColorSplit(color=row.color, qty=float(row.qty or 0.0), color_id=row.color_id)
        for row in (getattr(line, "color_splits", None) or [])
    ]


def _write_line_splits(line: SalesOrderLine, splits: list[ColorSplit]) -> None:
    existing = {color_key(row.color_id, row.color): row for row in list(line.color_splits or [])}
    wanted = {split.key: split for split in splits}
    for key, row in existing.items():
        if key not in wanted:
            line.color_splits.remove(row)
    for key, split in wanted.items():
        row = existing.get(key)
        if row is None:
            line.color_splits.append(SalesOrderLineColor(color=split.color, color_id=split.color_id, qty=round(split.qty, 4)))
        else:
            row.qty = round(split.qty, 4)
            row.color = split.color
    # Line-level color stays meaningful for older screens: the single color, or none when mixed.
    if len(splits) == 1:
        line.parchment_color, line.parchment_color_id = splits[0].color, splits[0].color_id
    elif len(splits) > 1:
        line.parchment_color, line.parchment_color_id = "Multiple colors", None
    else:
        line.parchment_color, line.parchment_color_id = None, None


def _apply_color_splits(target: SalesOrderLine, incoming: SalesOrderLineInput, index: int) -> None:
    line_no = incoming.line_no or index
    if not target.parchment_required:
        if released_by_color(getattr(target, "release_lots", []) or []).keys() - {color_key(None, None)}:
            raise HTTPException(status_code=400, detail=f"Line {line_no}: colored quantity is already released; parchment cannot be removed")
        for row in list(target.color_splits or []):
            target.color_splits.remove(row)
        return
    try:
        if incoming.color_splits is not None:
            splits = normalize_color_splits(incoming.color_splits, line_qty=incoming.qty, line_no=line_no)
        elif target.parchment_color and not list(target.color_splits or []):
            # Legacy single-color payload: the whole line is that color.
            splits = [ColorSplit(color=target.parchment_color, qty=float(incoming.qty), color_id=target.parchment_color_id)]
        else:
            splits = normalize_color_splits(
                [{"color": row.color, "color_id": row.color_id, "qty": row.qty} for row in (target.color_splits or [])],
                line_qty=incoming.qty,
                line_no=line_no,
            )
        validate_splits_cover_releases(splits, released_by_color(getattr(target, "release_lots", []) or []), line_no=line_no)
    except ColorAllocationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    _write_line_splits(target, splits)


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
        expiry_date=payload.expiry_date or default_expiry_date(po_date, internal_order_date),
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
    origin: Optional[str] = Query(None, description="CUSTOMER_PO | INTERNAL"),
    due: Optional[str] = Query(None, description="overdue | week (due within 7 days) — open lines only"),
    unreleased: bool = Query(False, description="Only orders with quantity not yet released"),
    held: bool = Query(False),
    expired: bool = Query(False),
    date_from: Optional[date] = Query(None, description="PO / internal order date from"),
    date_to: Optional[date] = Query(None),
    sort: Optional[str] = Query(None, description="newest | oldest | due | po_date"),
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
            SalesOrder.lines.any(SalesOrderLine.size_label.ilike(needle)),
            SalesOrder.lines.any(SalesOrderLine.color_splits.any(SalesOrderLineColor.color.ilike(needle))),
        ]
        try:
            clauses.append(SalesOrder.customer_id == uuid.UUID(search.strip()))
        except ValueError:
            pass
        query = query.filter(or_(*clauses))

    today = plant_today()
    open_line = SalesOrderLine.fulfilled_qty + SalesOrderLine.hold_qty < SalesOrderLine.qty
    if origin:
        query = query.filter(SalesOrder.origin == origin.strip().upper())
    if due == "overdue":
        query = query.filter(SalesOrder.lines.any(and_(open_line, SalesOrderLine.due_date < today)))
    elif due == "week":
        query = query.filter(SalesOrder.lines.any(and_(open_line, SalesOrderLine.due_date >= today, SalesOrderLine.due_date <= today + timedelta(days=7))))
    if unreleased:
        released_subq = (
            select(func.coalesce(func.sum(SalesOrderReleaseLot.released_qty), 0.0))
            .where(
                SalesOrderReleaseLot.sales_order_line_id == SalesOrderLine.id,
                func.lower(func.coalesce(SalesOrderReleaseLot.status, "")) != "cancelled",
            )
            .correlate(SalesOrderLine)
            .scalar_subquery()
        )
        query = query.filter(SalesOrder.status != SalesOrderStatus.CLOSED, SalesOrder.lines.any(SalesOrderLine.qty - SalesOrderLine.hold_qty > released_subq + 0.001))
    if held:
        query = query.filter(SalesOrder.held_at.isnot(None))
    if expired:
        query = query.filter(SalesOrder.expiry_date < today, SalesOrder.status != SalesOrderStatus.CLOSED)
    order_date = func.coalesce(SalesOrder.po_date, SalesOrder.internal_order_date)
    if date_from:
        query = query.filter(order_date >= date_from)
    if date_to:
        query = query.filter(order_date <= date_to)
    sort_key = (sort or "newest").lower()
    if sort_key == "oldest":
        ordering = [SalesOrder.created_at.asc()]
    elif sort_key == "po_date":
        ordering = [order_date.desc().nullslast(), SalesOrder.created_at.desc()]
    elif sort_key == "due":
        earliest_due = (
            select(func.min(SalesOrderLine.due_date))
            .where(SalesOrderLine.sales_order_id == SalesOrder.id, open_line)
            .correlate(SalesOrder)
            .scalar_subquery()
        )
        ordering = [earliest_due.asc().nullslast(), SalesOrder.created_at.desc()]
    else:
        ordering = [SalesOrder.created_at.desc()]
    orders = query.order_by(*ordering).offset(offset).limit(limit).all()
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
    expired_open_count: int = 0
    expiring_7d_count: int = 0
    held_order_count: int = 0
    hold_qty: float = 0.0


class DeliveryScheduleRowInput(BaseModel):
    model_config = {"allow_inf_nan": False}
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
    model_config = {"allow_inf_nan": False}
    delivery_date: date
    quantity: float = Field(..., gt=0)
    status: Optional[str] = "committed"


class ScheduleEntirePoPayload(BaseModel):
    expected_revision: int = 0
    default_date: Optional[date] = None
    line_splits: Optional[dict[str, List[ScheduleEntirePoLineSplit]]] = None


class DeliverySchedulePatchPayload(BaseModel):
    model_config = {"allow_inf_nan": False}
    quantity: Optional[float] = Field(default=None, gt=0)
    delivery_date: Optional[date] = None
    status: Optional[str] = None


class GroupMoveRemainderPayload(BaseModel):
    day_delta: int = Field(ge=-366, le=366)
    expected_revision: int = 0
    preview_only: bool = False


class BulkReleaseLinePayload(BaseModel):
    line_id: uuid.UUID
    release_qty: float = Field(..., gt=0)
    winder_machine_id: uuid.UUID
    product_code: Optional[str] = None
    release_lot_id: Optional[uuid.UUID] = None
    parchment_color: Optional[str] = Field(default=None, max_length=100)
    parchment_color_id: Optional[uuid.UUID] = None


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

    today = plant_today()
    open_orders = base.filter(SalesOrder.status != SalesOrderStatus.CLOSED)
    expired_open_count = int(open_orders.filter(SalesOrder.expiry_date < today).count() or 0)
    expiring_7d_count = int(
        open_orders.filter(SalesOrder.expiry_date >= today, SalesOrder.expiry_date <= today + timedelta(days=7)).count() or 0
    )
    held_order_count = int(base.filter(SalesOrder.held_at.isnot(None)).count() or 0)
    hold_qty_query = apply_plant_scope(
        db.query(func.coalesce(func.sum(SalesOrderLine.hold_qty), 0.0)).join(
            SalesOrder, SalesOrder.id == SalesOrderLine.sales_order_id
        ).filter(SalesOrder.held_at.isnot(None)),
        SalesOrder.plant_id,
        plant_scope,
    )
    hold_qty = float(hold_qty_query.scalar() or 0.0)

    return {
        "expired_open_count": expired_open_count,
        "expiring_7d_count": expiring_7d_count,
        "held_order_count": held_order_count,
        "hold_qty": round(hold_qty, 2),
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


@router.post("/{order_id}/delivery-schedules/group-move")
def group_move_order_remainder(
    order_id: uuid.UUID,
    payload: GroupMoveRemainderPayload,
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
    current_user: dict = Depends(require_role(["Owner", "Admin", "Sales", "Planner"])),
):
    order = load_order_for_schedule(db, order_id, plant_scope)
    return group_move_remainder(
        db,
        order=order,
        day_delta=payload.day_delta,
        expected_revision=payload.expected_revision,
        actor=str(current_user.get("sub") or "unknown"),
        preview_only=payload.preview_only,
    )


@router.post("/release-bulk")
def bulk_release_sales_order_lines(
    payload: List[BulkReleaseLinePayload],
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Owner", "Admin", "Sales", "Planner"])),
):
    """Release several rows (lines and colours) together: every lot is created, or none is.

    Pass a release_lot_id per row so a retry after a lost response returns the same lots.
    """
    if not payload:
        raise HTTPException(status_code=400, detail="Bulk release requires at least one line")
    created = []
    try:
        for index, item in enumerate(payload, start=1):
            try:
                created.append(_release_line_in_transaction(
                    db,
                    item.line_id,
                    SalesOrderLineReleasePayload(
                        release_qty=item.release_qty,
                        winder_machine_id=item.winder_machine_id,
                        product_code=item.product_code,
                        release_lot_id=item.release_lot_id,
                        parchment_color=item.parchment_color,
                        parchment_color_id=item.parchment_color_id,
                    ),
                    plant_id,
                    current_user,
                ))
            except HTTPException as exc:
                raise HTTPException(status_code=exc.status_code, detail=f"Row {index}: {exc.detail}. Nothing was released.") from exc
        db.commit()
    except Exception:
        db.rollback()
        raise
    lots = []
    for lot, order_id in created:
        db.refresh(lot)
        lots.append(_lot_payload(lot, order_id))
    return {"lots": lots, "count": len(lots), "policy": "all_or_nothing"}


@router.get("/spec-usage/{spec_id}")
def get_spec_usage(
    spec_id: uuid.UUID,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(get_current_user),
):
    """Open order lines still using a specification (live-spec edit lock)."""
    rows = (
        db.query(SalesOrderLine, SalesOrder)
        .join(SalesOrder)
        .filter(
            SalesOrderLine.approved_spec_id == spec_id,
            SalesOrder.status != SalesOrderStatus.CLOSED,
            SalesOrderLine.fulfilled_qty + SalesOrderLine.hold_qty < SalesOrderLine.qty,
        )
        .all()
    )
    return {
        "spec_id": str(spec_id),
        "open_lines": len(rows),
        "orders": sorted({order.order_no for _line, order in rows})[:20],
    }


@router.get("/delivery-calendar")
def get_delivery_calendar(
    date_from: date = Query(...),
    date_to: date = Query(...),
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
    current_user: dict = Depends(get_current_user),
):
    """Customer delivery commitments across open orders, by date, for the planner and purchase calendars.

    Each saved call-off is one row. A line with no call-off yet contributes its unscheduled balance
    on the line due date (source "LINE_DUE"), so nothing the customer expects is left off.
    """
    del current_user
    if (date_to - date_from).days > 400:
        raise HTTPException(status_code=422, detail="Choose at most 400 days")
    orders = (
        apply_plant_scope(db.query(SalesOrder), SalesOrder.plant_id, plant_scope)
        .options(joinedload(SalesOrder.lines).joinedload(SalesOrderLine.delivery_schedules), joinedload(SalesOrder.lines).joinedload(SalesOrderLine.release_lots))
        .filter(SalesOrder.status.notin_([SalesOrderStatus.DRAFT, SalesOrderStatus.CLOSED]))
        .all()
    )
    rows = []
    for order in orders:
        for line in order.lines or []:
            open_qty = max(0.0, float(line.qty or 0.0) - float(line.fulfilled_qty or 0.0) - float(line.hold_qty or 0.0))
            if open_qty <= 1e-6:
                continue
            base = {
                "order_id": str(order.id), "order_no": order.order_no, "customer_id": str(order.customer_id) if order.customer_id else None,
                "po_number": order.po_number, "line_id": str(line.id), "line_no": int(line.line_no or 1),
                "product_code": line.product_code, "size_label": getattr(line, "size_label", None),
                "parchment_color": line.parchment_color if getattr(line, "parchment_required", False) else None,
                "line_qty": float(line.qty or 0.0), "line_open_qty": round(open_qty, 2),
                "released_qty": round(sum(float(lot.released_qty or 0.0) for lot in (line.release_lots or []) if str(lot.status or "").lower() != "cancelled"), 2),
                "is_held": bool(getattr(order, "is_held", False)),
            }
            schedules = [row for row in (line.delivery_schedules or []) if str(row.status or "").lower() not in {"cancelled"}]
            scheduled_qty = 0.0
            for schedule in schedules:
                scheduled_qty += float(schedule.quantity or 0.0)
                if schedule.delivery_date and date_from <= schedule.delivery_date <= date_to:
                    rows.append({**base, "date": schedule.delivery_date.isoformat(), "qty": round(float(schedule.quantity or 0.0), 2),
                                 "status": schedule.status, "schedule_id": str(schedule.id), "source": "CALL_OFF"})
            unscheduled = max(0.0, float(line.qty or 0.0) - scheduled_qty - float(line.fulfilled_qty or 0.0))
            if unscheduled > 1e-6 and line.due_date and date_from <= line.due_date <= date_to:
                rows.append({**base, "date": line.due_date.isoformat(), "qty": round(unscheduled, 2), "status": "unscheduled",
                             "schedule_id": None, "source": "LINE_DUE"})
    rows.sort(key=lambda row: (row["date"], row["order_no"] or "", row["line_no"]))
    return {"date_from": date_from.isoformat(), "date_to": date_to.isoformat(), "items": rows}


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

        all_lots = sorted(getattr(line, "release_lots", []) or [], key=lambda item: item.created_at or datetime.min)
        for lot in all_lots:
            returned = float(getattr(lot, "returned_qty", 0.0) or 0.0)
            if returned > 0:
                events.append(
                    _timeline_event(
                        event_id=f"{lot.id}:returned",
                        event_type="SALES_ORDER_LOT_RETURNED",
                        title=f"Line {int(line.line_no or 0)} balance returned",
                        message=(
                            f"Job card force-closed: {round(returned, 2)} pcs {lot.parchment_color or ''} back to unreleased; "
                            f"{round(float(lot.released_qty or 0.0), 2)} pcs stay on the card."
                        ).replace("  ", " "),
                        created_at=lot.released_at or lot.created_at,
                        actor=lot.released_by_identity or lot.released_by,
                        line_id=line.id,
                        qty=returned,
                        metadata={"release_lot_id": str(lot.id), "job_card_id": str(lot.job_card_id) if lot.job_card_id else None, "status": lot.status},
                    )
                )
        for lot in sorted(release_lots, key=lambda item: item.created_at or datetime.min):
            events.append(
                _timeline_event(
                    event_id=f"{lot.id}:release",
                    event_type="SALES_ORDER_LINE_RELEASED",
                    title=f"Line {int(line.line_no or 0)} released" + (f" · {lot.parchment_color}" if getattr(lot, "parchment_color", None) else ""),
                    message=f"{round(float(lot.released_qty or 0.0) + float(getattr(lot, 'returned_qty', 0.0) or 0.0), 2)} pcs released to planning.",
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
        .options(
            joinedload(SalesOrder.lines).joinedload(SalesOrderLine.release_lots),
            joinedload(SalesOrder.lines).joinedload(SalesOrderLine.delivery_schedules),
        )
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

    proposed_customer_id = payload.customer_id if payload.customer_id is not None else order.customer_id
    proposed_origin = payload.origin if payload.origin is not None else order.origin
    proposed_po_number = payload.po_number if payload.po_number is not None else order.po_number
    proposed_po_date = payload.po_date if payload.po_date is not None else order.po_date
    proposed_internal_date = (
        payload.internal_order_date if payload.internal_order_date is not None else order.internal_order_date
    )
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
    stored_schedules = [
        {"delivery_date": row.delivery_date, "line_no": getattr(line, "line_no", None)}
        for line in order.lines or []
        for row in getattr(line, "delivery_schedules", []) or []
    ]
    origin, po_number, po_date, internal_order_date = _validate_commercial_payload(
        origin=proposed_origin,
        customer_id=proposed_customer_id,
        po_number=proposed_po_number,
        po_date=proposed_po_date,
        internal_order_date=proposed_internal_date,
        lines=working_lines,
        delivery_schedules=payload.delivery_schedules if payload.delivery_schedules is not None else stored_schedules,
    )

    if payload.customer_id is not None:
        order.customer_id = payload.customer_id
    if payload.notes is not None:
        order.notes = payload.notes
    if payload.expiry_date is not None:
        order.expiry_date = payload.expiry_date

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

    order.origin = origin
    order.origin_review_required = origin == ORIGIN_REVIEW
    order.po_number = po_number
    order.po_date = po_date
    order.internal_order_date = internal_order_date

    db.commit()
    db.refresh(order)
    return _serialize_order(order)


class SalesOrderHoldPayload(BaseModel):
    reason: str = Field(..., min_length=3, max_length=500)


def _load_scoped_order(db: Session, order_id: uuid.UUID, plant_id: str) -> SalesOrder:
    order = (
        db.query(SalesOrder)
        .options(
            joinedload(SalesOrder.lines).joinedload(SalesOrderLine.release_lots),
            joinedload(SalesOrder.lines).joinedload(SalesOrderLine.delivery_schedules),
        )
        .filter(SalesOrder.id == order_id, SalesOrder.plant_id == plant_id)
        .first()
    )
    if not order:
        raise HTTPException(status_code=404, detail="Sales order not found")
    return order


@router.post("/{order_id}/hold", response_model=SalesOrderResponse)
def hold_sales_order(
    order_id: uuid.UUID,
    payload: SalesOrderHoldPayload,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin", "Sales"])),
):
    """Customer hold: freeze the undelivered balance as hold qty and close the PO.

    Used when a customer stops lifting material (typically 2–3 months). Delivered
    quantities and release lots are untouched; resume restores the prior status.
    """
    order = _load_scoped_order(db, order_id, plant_id)
    if order.held_at is not None:
        raise HTTPException(status_code=409, detail="This order is already on customer hold")
    if order.status == SalesOrderStatus.CLOSED:
        raise HTTPException(status_code=400, detail="Closed orders have no open balance to hold")
    held_total = 0.0
    for line in order.lines:
        balance = max(0.0, float(line.qty or 0.0) - float(line.fulfilled_qty or 0.0))
        line.hold_qty = round(balance, 4)
        held_total += balance
    if held_total <= 0:
        raise HTTPException(status_code=400, detail="Nothing is pending on this order, so there is nothing to hold")
    order.hold_prev_status = order.status.value
    order.hold_reason = payload.reason.strip()
    order.held_at = datetime.utcnow()
    order.held_by = current_user.get("sub", "unknown")
    order.status = SalesOrderStatus.CLOSED
    db.commit()
    try:
        from ..utils.audit_client import emit_audit_event
        emit_audit_event(
            token=current_user.get("token", ""),
            event_type="sales_order_customer_hold",
            entity_type="sales_order",
            entity_id=str(order.id),
            plant_id=str(plant_id),
            actor_role="Sales",
            actor_email=current_user.get("sub"),
            summary=f"Sales order {order.order_no} put on customer hold and closed ({held_total:,.0f} pcs held)",
            payload={"order_no": order.order_no, "hold_qty": held_total, "reason": order.hold_reason},
        )
    except Exception:
        pass
    return _serialize_order(_load_scoped_order(db, order_id, plant_id))


@router.post("/{order_id}/resume", response_model=SalesOrderResponse)
def resume_sales_order(
    order_id: uuid.UUID,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin", "Sales"])),
):
    """Lift a customer hold: clear hold qty and restore the status the order had."""
    order = _load_scoped_order(db, order_id, plant_id)
    if order.held_at is None:
        raise HTTPException(status_code=409, detail="This order is not on customer hold")
    for line in order.lines:
        line.hold_qty = 0.0
    try:
        order.status = SalesOrderStatus(order.hold_prev_status or SalesOrderStatus.APPROVED.value)
    except ValueError:
        order.status = SalesOrderStatus.APPROVED
    order.hold_reason = None
    order.held_at = None
    order.held_by = None
    order.hold_prev_status = None
    db.commit()
    try:
        from ..utils.audit_client import emit_audit_event
        emit_audit_event(
            token=current_user.get("token", ""),
            event_type="sales_order_hold_lifted",
            entity_type="sales_order",
            entity_id=str(order.id),
            plant_id=str(plant_id),
            actor_role="Sales",
            actor_email=current_user.get("sub"),
            summary=f"Customer hold lifted on sales order {order.order_no}",
            payload={"order_no": order.order_no},
        )
    except Exception:
        pass
    return _serialize_order(_load_scoped_order(db, order_id, plant_id))


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
    # No order is "released" without its quantity actually standing in a winder queue:
    # every line goes through line release (one color + one winder per job card).
    pending_lines = [
        int(line.line_no or 0)
        for line in order.lines
        if float(line.qty or 0.0) - float(getattr(line, "hold_qty", 0.0) or 0.0) - _released_qty(line) > 1e-6
    ]
    if pending_lines:
        raise HTTPException(
            status_code=400,
            detail=(
                "Release each line with its color and winder queue first "
                f"(unreleased: line {', '.join(str(n) for n in pending_lines)})."
            ),
        )

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
    try:
        lot, order_id = _release_line_in_transaction(db, line_id, payload, plant_id, current_user)
        db.commit()
    except Exception:
        db.rollback()
        raise
    db.refresh(lot)
    return _lot_payload(lot, order_id)


def _release_line_in_transaction(db: Session, line_id: uuid.UUID, payload: SalesOrderLineReleasePayload, plant_id: str, current_user: dict):
    """One release lot, flushed but not committed: the caller commits (a whole batch commits once)."""
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
            db.flush()
        return existing_lot, order.id

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

    lot_color, lot_color_id = _resolve_release_color(line, payload.parchment_color, payload.parchment_color_id, payload.release_qty)

    lot = SalesOrderReleaseLot(
        id=release_lot_id,
        sales_order_id=order.id,
        sales_order_line_id=line.id,
        released_qty=payload.release_qty,
        winder_machine_id=payload.winder_machine_id,
        product_code=(payload.product_code or line.product_code or "").strip() or None,
        parchment_color=lot_color,
        parchment_color_id=lot_color_id,
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
    db.flush()
    return lot, order.id


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
    return _lot_payload(lot, lot.line.sales_order_id)


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
    # Serialize every commercial adjustment on the same line as dispatch and
    # release. Reload after the lock to prevent stale quantities losing a split.
    _locked_line(db, original.sales_order_line_id, plant_id)
    db.refresh(original)
    existing = db.query(SalesOrderReleaseLot).filter(SalesOrderReleaseLot.id == requested_lot_id).first()
    if existing:
        if (existing.job_card_id != payload.carry_forward_job_card_id
                or existing.sales_order_line_id != original.sales_order_line_id
                or existing.sales_order_id != original.sales_order_id):
            raise HTTPException(status_code=409, detail="Carry-forward release lot id belongs to another source or job card")
        if abs(float(existing.released_qty or 0.0) - float(payload.gap_qty)) > 0.0001:
            raise HTTPException(status_code=409, detail="Carry-forward release lot was already used with a different quantity")
        if existing.source_release_lot_id is None:
            # Older V2 carry-forward IDs cryptographically bind the parent card
            # and gap. This proof permits recovery after a pre-upgrade Sales
            # commit; a same-line sibling or arbitrary historical split cannot
            # claim provenance merely by presenting the same child lot ID.
            expected_child = uuid.uuid5(uuid.NAMESPACE_URL,
                f"hariom:carry:{original.job_card_id}:{float(payload.gap_qty):.4f}")
            expected_lot = uuid.uuid5(uuid.NAMESPACE_URL, f"hariom:carry-release:{expected_child}")
            if (original.job_card_id is None or existing.job_card_id != expected_child
                    or existing.id != expected_lot):
                raise HTTPException(409, "Historical release-lot source cannot be verified for this replay")
            existing.source_release_lot_id = original.id
            db.commit()
            db.refresh(existing)
        elif existing.source_release_lot_id != release_lot_id:
            raise HTTPException(409, "Carry-forward release lot belongs to another source release lot")
        return _lot_payload(existing, existing.sales_order_id)
    if str(original.status or "").lower() in {"cancelled", "short_closed"}:
        raise HTTPException(409, "This release lot is already closed")
    if float(payload.gap_qty) > float(original.released_qty or 0) + 0.0001:
        raise HTTPException(409, "The carry-forward quantity exceeds the source release allocation")

    shrunk_qty, gap_qty = carry_forward_lot_split(original.released_qty, payload.gap_qty)
    original.released_qty = shrunk_qty

    new_lot = SalesOrderReleaseLot(
        id=requested_lot_id,
        source_release_lot_id=original.id,
        sales_order_id=original.sales_order_id,
        sales_order_line_id=original.sales_order_line_id,
        product_code=original.product_code,
        released_qty=gap_qty,
        winder_machine_id=original.winder_machine_id,
        job_card_id=payload.carry_forward_job_card_id,
        parchment_color=getattr(original, "parchment_color", None),
        parchment_color_id=getattr(original, "parchment_color_id", None),
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

    return _lot_payload(new_lot, original.sales_order_id)


def _emit_lot_audit(current_user: dict, plant_id: str, event_type: str, lot: SalesOrderReleaseLot, summary: str, payload: dict) -> None:
    try:
        from ..utils.audit_client import emit_audit_event
        emit_audit_event(
            token=current_user.get("token", ""),
            event_type=event_type,
            entity_type="sales_order_release_lot",
            entity_id=str(lot.id),
            plant_id=str(plant_id),
            actor_role=str((current_user.get("roles") or ["?"])[0]),
            actor_email=current_user.get("sub"),
            summary=summary,
            payload={**payload, "sales_order_id": str(lot.sales_order_id), "sales_order_line_id": str(lot.sales_order_line_id)},
        )
    except Exception as exc:  # pragma: no cover - audit is best-effort
        logger.warning("Failed to emit %s audit event: %s", event_type, exc)


def _locked_line(db: Session, line_id: uuid.UUID, plant_id: str) -> SalesOrderLine:
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
    return line


@router.put("/lines/{line_id}/colors", response_model=SalesOrderLineResponse)
def update_line_colors(
    line_id: uuid.UUID,
    payload: LineColorsPayload,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Owner", "Admin", "Sales", "Planner", "PlantManager"])),
):
    """Edit a line's color breakup at any time before close; never below what is released per color."""
    line = _locked_line(db, line_id, plant_id)
    order = line.sales_order
    if order.status == SalesOrderStatus.CLOSED:
        raise HTTPException(status_code=400, detail="Closed orders cannot change colors")
    if not bool(line.parchment_required):
        raise HTTPException(status_code=400, detail="This line has no parchment; there is no color to split")
    before = color_summary(line.qty, _line_splits(line), released_by_color(line.release_lots or []))
    try:
        splits = normalize_color_splits(payload.color_splits, line_qty=float(line.qty or 0.0), line_no=int(line.line_no or 0) or None)
        validate_splits_cover_releases(splits, released_by_color(line.release_lots or []), line_no=int(line.line_no or 0) or None)
    except ColorAllocationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    _write_line_splits(line, splits)
    db.commit()
    db.refresh(line)
    try:
        from ..utils.audit_client import emit_audit_event
        emit_audit_event(
            token=current_user.get("token", ""),
            event_type="sales_order_line_colors_updated",
            entity_type="sales_order",
            entity_id=str(order.id),
            plant_id=str(plant_id),
            actor_role=str((current_user.get("roles") or ["?"])[0]),
            actor_email=current_user.get("sub"),
            summary=f"{order.order_no} line {int(line.line_no or 0)} colors: " + ", ".join(f"{split.color} {split.qty:,.0f}" for split in splits),
            payload={"line_id": str(line.id), "before": before, "after": [split.__dict__ | {"color_id": str(split.color_id) if split.color_id else None} for split in splits]},
        )
    except Exception:
        pass
    return _serialize_line(line)


@router.post("/release-lots/{release_lot_id}/amend", response_model=SalesOrderReleaseLotResponse)
def amend_release_lot(
    release_lot_id: uuid.UUID,
    payload: ReleaseLotAmendPayload,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Owner", "Admin", "Planner", "PlantManager", "Sales"])),
):
    """Change qty/color of a release lot whose job card is still unscheduled (called by production)."""
    lot = db.query(SalesOrderReleaseLot).filter(SalesOrderReleaseLot.id == release_lot_id).first()
    if not lot:
        raise HTTPException(status_code=404, detail="Release lot not found")
    line = _locked_line(db, lot.sales_order_line_id, plant_id)
    if lot.job_card_id and lot.job_card_id != payload.job_card_id:
        raise HTTPException(status_code=409, detail="Release lot belongs to another job card")
    if str(lot.status or "").lower() == "cancelled":
        raise HTTPException(status_code=409, detail="Release lot is cancelled")
    new_qty = float(payload.release_qty if payload.release_qty is not None else lot.released_qty or 0.0)
    others = sum(float(row.released_qty or 0.0) for row in (line.release_lots or []) if row.id != lot.id and str(row.status or "").lower() != "cancelled")
    if new_qty > float(line.qty or 0.0) - others + 1e-6:
        raise HTTPException(
            status_code=400,
            detail=f"Only {max(0.0, float(line.qty or 0.0) - others):,.0f} pcs of this line are free to release",
        )
    before = {"release_qty": lot.released_qty, "parchment_color": lot.parchment_color}
    color_name = payload.parchment_color if payload.parchment_color is not None else lot.parchment_color
    color_id = payload.parchment_color_id if payload.parchment_color is not None else lot.parchment_color_id
    lot.parchment_color, lot.parchment_color_id = _resolve_release_color(line, color_name, color_id, new_qty, exclude_lot_id=lot.id)
    lot.released_qty = round(new_qty, 4)
    _sync_release_status(line.sales_order)
    db.commit()
    db.refresh(lot)
    _emit_lot_audit(
        current_user,
        plant_id,
        "release_lot_amended",
        lot,
        f"Job card lot changed: {before['release_qty']:,.0f} {before['parchment_color'] or ''} -> {lot.released_qty:,.0f} {lot.parchment_color or ''}".strip(),
        {"before": before, "after": {"release_qty": lot.released_qty, "parchment_color": lot.parchment_color}, "job_card_id": str(payload.job_card_id), "reason": payload.reason},
    )
    return _lot_payload(lot, lot.sales_order_id)


@router.post("/release-lots/{release_lot_id}/return-balance", response_model=SalesOrderReleaseLotResponse)
def return_release_lot_balance(
    release_lot_id: uuid.UUID,
    payload: ReleaseLotReturnPayload,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Owner", "Admin", "Planner", "PlantManager"])),
):
    """Force-close: shrink the lot to what was made; the rest becomes unreleased on the line again.

    Idempotent per job card: replaying the same return is a no-op.
    """
    lot = db.query(SalesOrderReleaseLot).filter(SalesOrderReleaseLot.id == release_lot_id).first()
    if not lot:
        raise HTTPException(status_code=404, detail="Release lot not found")
    line = _locked_line(db, lot.sales_order_line_id, plant_id)
    if lot.job_card_id and lot.job_card_id != payload.job_card_id:
        raise HTTPException(status_code=409, detail="Release lot belongs to another job card")
    returned = round(float(payload.returned_qty or 0.0), 4)
    if abs(float(lot.returned_qty or 0.0) - returned) <= 1e-6 and returned > 0:
        return _lot_payload(lot, lot.sales_order_id)
    if float(lot.returned_qty or 0.0) > 0:
        raise HTTPException(status_code=409, detail="A different balance was already returned for this job card")
    if returned > float(lot.released_qty or 0.0) + 1e-6:
        raise HTTPException(status_code=400, detail="Cannot return more than the lot released")
    lot.released_qty = round(float(lot.released_qty or 0.0) - returned, 4)
    lot.returned_qty = returned
    lot.status = "cancelled" if lot.released_qty <= 1e-6 else "short_closed"
    order = line.sales_order
    if order.status in (SalesOrderStatus.RELEASED, SalesOrderStatus.PARTIALLY_RELEASED):
        if sum(_released_qty(row) for row in order.lines) <= 1e-6:
            order.status = SalesOrderStatus.APPROVED
        else:
            order.status = SalesOrderStatus.PARTIALLY_RELEASED
    db.commit()
    db.refresh(lot)
    _emit_lot_audit(
        current_user,
        plant_id,
        "release_lot_balance_returned",
        lot,
        f"Force-close returned {returned:,.0f} pcs {lot.parchment_color or ''} to the order; job card keeps {lot.released_qty:,.0f} pcs".strip(),
        {"returned_qty": returned, "kept_qty": lot.released_qty, "job_card_id": str(payload.job_card_id), "reason": payload.reason},
    )
    return _lot_payload(lot, lot.sales_order_id)


@router.post("/lines/{line_id}/short-close", response_model=SalesOrderLineResponse)
def short_close_sales_order_line(
    line_id: uuid.UUID,
    payload: SalesOrderLineShortClosePayload,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_role(["Admin", "Owner", "Sales", "Planner", "PlantManager"])),
):
    """Reduce a sales line/release lot after production short-closes the gap."""
    line = _locked_line(db, line_id, plant_id)
    db.refresh(line)
    db.expire(line, ["release_lots"])

    reason = (payload.reason_code or "").strip().upper()
    if not reason:
        raise HTTPException(status_code=422, detail="reason_code is required")

    active_lots = [
        lot for lot in getattr(line, "release_lots", [])
        if str(lot.status or "").lower() != "cancelled"
    ]
    matched_lot = next((lot for lot in active_lots if str(lot.job_card_id) == str(payload.job_card_id)), None)
    if payload.expected_release_qty is not None:
        if matched_lot is None:
            raise HTTPException(409, "The job card's exact release lot was not found on this sales line")
        expected = float(payload.expected_release_qty)
        kept = float(payload.produced_qty)
        if kept >= expected or abs(expected - kept - float(payload.gap_qty)) > 0.0001:
            raise HTTPException(422, "The shortage must equal original allocation minus final QC accepted quantity")
        current = float(matched_lot.released_qty or 0)
        if str(matched_lot.status or "").lower() == "short_closed":
            if abs(current - kept) <= 0.0001:
                return _serialize_line(line)
            raise HTTPException(409, "This job card was already short-closed to a different quantity")
        if abs(current - expected) > 0.0001:
            raise HTTPException(409, "The source release allocation changed before short-close")
        matched_lot.released_qty = round(kept, 4)
        matched_lot.status = "short_closed"
    else:
        # Preserve the legacy stage-level short-close contract.
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


def _exact_dispatch_replay(db: Session, line: SalesOrderLine, ref: Optional[str], qty: float):
    if not ref:
        return None
    existing = db.query(SalesOrderDispatchLog).filter(SalesOrderDispatchLog.dispatch_line_ref == ref).first()
    if existing and (existing.line_id != line.id or not isclose(float(existing.qty), float(qty), rel_tol=0, abs_tol=1e-9)):
        raise HTTPException(status_code=409, detail="Dispatch reference was already used for another line or quantity")
    return existing


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
    if payload.approved_spec_id and line.approved_spec_id != payload.approved_spec_id:
        raise HTTPException(status_code=400, detail="Spec mismatch for this sales order line")

    # A receiver may commit fulfillment and lose its response. Recognize the
    # exact immutable shipment before checking the now-reduced commercial balance.
    replay = _exact_dispatch_replay(db, line, payload.dispatch_line_ref, payload.qty)
    if replay:
        return {"order_id": order.id, "order_status": order.status.value,
                "line_id": line.id, "qty": payload.qty,
                "remaining_qty": max(0.0, line.qty - line.fulfilled_qty), "valid": True}
    if order.status not in [
        SalesOrderStatus.RELEASED,
        SalesOrderStatus.PARTIALLY_RELEASED,
        SalesOrderStatus.PARTIALLY_DISPATCHED,
    ]:
        raise HTTPException(status_code=400, detail="Sales order line not released for dispatch")

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
    # The reference is globally unique. Serialize even requests for different
    # lines so a collision becomes an explicit replay conflict, never a 500.
    db.execute(text("SELECT pg_advisory_xact_lock(hashtext(:key))"),
               {"key": "sales-dispatch-ref:" + payload.dispatch_line_ref})
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

    existing_log = _exact_dispatch_replay(db, line, payload.dispatch_line_ref, payload.qty)
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
