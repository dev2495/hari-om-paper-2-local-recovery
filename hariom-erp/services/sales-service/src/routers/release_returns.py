"""Stage short-close returns from production (owner decision 1, 2026-11-01).

When a job card stage closes short, the unmade balance goes back to its order line at once as unreleased
qty: Sales can release it again or short-close the order. Reopening that stage takes the pcs back, only
while the line still has them unreleased and the order is not short-closed or cancelled."""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import SalesOrder, SalesOrderReleaseLot, SalesOrderReleaseLotReturn, SalesOrderStatus
from ..order_closure import CANCELLED as CLOSURE_CANCELLED, SHORT_CLOSED as CLOSURE_SHORT_CLOSED, active_released
from ..utils.auth import get_current_plant, require_role
from .sales_orders import _drop_unreleased_balance, _emit_lot_audit, _locked_line, _lot_payload, _released_qty, _sync_release_status

router = APIRouter(prefix="/sales-orders", tags=["sales-orders"])
# Create comes only from production's service-to-service effects worker (or an Owner/Admin by hand). Reverse is
# called by production's reopen with the reopening user's own token, and reopen is Owner/Admin only.
CREATE_ROLES = ["Owner", "Admin", "ProductionEffects"]
REVERSE_ROLES = ["Owner", "Admin", "ProductionEffects"]
_EPS = 1e-6


class StageReturnPayload(BaseModel):
    job_card_id: uuid.UUID
    return_key: str = Field(..., min_length=8, max_length=160)
    qty: float = Field(..., gt=0, allow_inf_nan=False)
    stage: Optional[str] = Field(default=None, max_length=20)
    reason: Optional[str] = Field(default=None, max_length=2000)
    # Master reason production already checked (owner decision 4): stored as sent, not re-validated here.
    reason_code: Optional[str] = Field(default=None, max_length=40)
    reason_label: Optional[str] = Field(default=None, max_length=200)
    reason_note: Optional[str] = Field(default=None, max_length=2000)


class StageReturnReversePayload(BaseModel):
    job_card_id: uuid.UUID
    return_key: str = Field(..., min_length=8, max_length=160)
    reason: Optional[str] = Field(default=None, max_length=2000)
    reason_code: Optional[str] = Field(default=None, max_length=40)
    reason_label: Optional[str] = Field(default=None, max_length=200)


def _return_row(row: SalesOrderReleaseLotReturn) -> dict:
    return {"id": str(row.id), "return_key": row.return_key, "stage": row.stage, "qty": row.qty, "status": row.status, "dropped": bool(row.dropped),
            "reason": row.reason, "reason_code": getattr(row, "reason_code", None), "reason_label": getattr(row, "reason_label", None),
            "reason_note": getattr(row, "reason_note", None), "created_at": row.created_at, "reversed_at": row.reversed_at}


def _lot_for(db: Session, release_lot_id: uuid.UUID, plant_id: str, job_card_id: uuid.UUID):
    lot = db.query(SalesOrderReleaseLot).filter(SalesOrderReleaseLot.id == release_lot_id).first()
    if not lot:
        raise HTTPException(status_code=404, detail="Release lot not found")
    line = _locked_line(db, lot.sales_order_line_id, plant_id)
    if lot.job_card_id and lot.job_card_id != job_card_id:
        raise HTTPException(status_code=409, detail="Release lot belongs to another job card")
    return lot, line


@router.post("/release-lots/{release_lot_id}/stage-returns")
def stage_return(release_lot_id: uuid.UUID, payload: StageReturnPayload, db: Session = Depends(get_db), plant_id: str = Depends(get_current_plant),
                 current_user: dict = Depends(require_role(CREATE_ROLES))):
    """Give ``qty`` pcs of this card's lot back to the order line (idempotent per return key)."""
    lot, line = _lot_for(db, release_lot_id, plant_id, payload.job_card_id)
    qty = round(float(payload.qty), 4)
    existing = db.query(SalesOrderReleaseLotReturn).filter_by(release_lot_id=lot.id, return_key=payload.return_key).first()
    if existing is not None:
        if abs(existing.qty - qty) > _EPS:
            raise HTTPException(status_code=409, detail="This return key was already used for a different quantity")
        if existing.status == "ACTIVE":
            return {"lot": _lot_payload(lot, lot.sales_order_id), "return": _return_row(existing), "replayed": True}
    if qty > float(lot.released_qty or 0.0) + _EPS:
        raise HTTPException(status_code=400, detail=f"Cannot return {qty:,.0f} pcs: the job card holds only {float(lot.released_qty or 0.0):,.0f} pcs of this order")
    lot.released_qty = round(float(lot.released_qty or 0.0) - qty, 4)
    lot.returned_qty = round(float(lot.returned_qty or 0.0) + qty, 4)
    if lot.released_qty <= _EPS:
        lot.status = "cancelled"
    order = line.sales_order
    if order.status in (SalesOrderStatus.RELEASED, SalesOrderStatus.PARTIALLY_RELEASED):
        order.status = SalesOrderStatus.APPROVED if sum(_released_qty(row) for row in order.lines) <= _EPS else SalesOrderStatus.PARTIALLY_RELEASED
    row = existing or SalesOrderReleaseLotReturn(release_lot_id=lot.id, sales_order_id=lot.sales_order_id, sales_order_line_id=lot.sales_order_line_id,
                                                  job_card_id=payload.job_card_id, return_key=payload.return_key, qty=qty)
    row.stage = payload.stage
    row.reason = payload.reason
    row.reason_code = (payload.reason_code or "").strip().upper() or None
    row.reason_label = payload.reason_label
    row.reason_note = payload.reason_note
    row.status = "ACTIVE"
    row.dropped = False
    row.created_by = current_user.get("sub")
    row.created_at = datetime.utcnow()
    if existing is None:
        db.add(row)
    kind = str(getattr(order, "closure_kind", "") or "").upper()
    if kind == CLOSURE_SHORT_CLOSED:
        # The order was short-closed: the handed-back balance is dropped, not released again.
        _drop_unreleased_balance(order)
        row.dropped = True
    db.commit()
    db.refresh(lot)
    _emit_lot_audit(current_user, plant_id, "release_lot_stage_returned", lot,
                    f"{(payload.stage or 'Stage').title()} closed short: {qty:,.0f} pcs back to the order" + (" (dropped: order short-closed)" if row.dropped else "")
                    + (f" — {payload.reason_label}" if payload.reason_label else ""),
                    {"returned_qty": qty, "return_key": payload.return_key, "job_card_id": str(payload.job_card_id), "reason": payload.reason,
                     "reason_code": row.reason_code, "reason_label": payload.reason_label, "reason_note": payload.reason_note, "dropped": row.dropped})
    return {"lot": _lot_payload(lot, lot.sales_order_id), "return": _return_row(row), "replayed": False}


@router.post("/release-lots/{release_lot_id}/stage-returns/reverse")
def reverse_stage_return(release_lot_id: uuid.UUID, payload: StageReturnReversePayload, db: Session = Depends(get_db), plant_id: str = Depends(get_current_plant),
                         current_user: dict = Depends(require_role(REVERSE_ROLES))):
    """A reopened stage takes its returned pcs back, if the line still has them unreleased."""
    lot, line = _lot_for(db, release_lot_id, plant_id, payload.job_card_id)
    row = db.query(SalesOrderReleaseLotReturn).filter_by(release_lot_id=lot.id, return_key=payload.return_key).first()
    if row is None:
        raise HTTPException(status_code=404, detail="This short close gave nothing back to the order")
    if row.status == "REVERSED":
        return {"lot": _lot_payload(lot, lot.sales_order_id), "return": _return_row(row), "replayed": True}
    order = line.sales_order
    kind = str(getattr(order, "closure_kind", "") or "").upper()
    if row.dropped or kind == CLOSURE_SHORT_CLOSED:
        raise HTTPException(status_code=409, detail=f"the {row.qty:,.0f} pcs this close gave back were dropped when order {order.order_no} was short-closed")
    if kind == CLOSURE_CANCELLED:
        raise HTTPException(status_code=409, detail=f"order {order.order_no} is cancelled")
    free = round(float(line.qty or 0.0) - active_released(line), 4)
    if free + _EPS < row.qty:
        raise HTTPException(status_code=409, detail=f"only {max(0.0, free):,.0f} of the {row.qty:,.0f} pcs this close gave back are still unreleased on order {order.order_no}; the rest was released again on another job card. Short-close or edit that card first")
    lot.released_qty = round(float(lot.released_qty or 0.0) + row.qty, 4)
    lot.returned_qty = round(max(0.0, float(lot.returned_qty or 0.0) - row.qty), 4)
    if str(lot.status or "").lower() == "cancelled" and lot.released_qty > _EPS:
        lot.status = "released"
    row.status = "REVERSED"
    row.reversed_by = current_user.get("sub")
    row.reversed_at = datetime.utcnow()
    row.reverse_reason = payload.reason
    row.reverse_reason_code = (payload.reason_code or "").strip().upper() or None
    row.reverse_reason_label = payload.reason_label
    if order.status == SalesOrderStatus.APPROVED:
        order.status = SalesOrderStatus.PARTIALLY_RELEASED
    _sync_release_status(order)
    db.commit()
    db.refresh(lot)
    _emit_lot_audit(current_user, plant_id, "release_lot_stage_return_reversed", lot,
                    f"Stage reopened: {row.qty:,.0f} pcs taken back from the order onto the job card" + (f" — {payload.reason_label}" if payload.reason_label else ""),
                    {"qty": row.qty, "return_key": payload.return_key, "job_card_id": str(payload.job_card_id), "reason": payload.reason,
                     "reason_code": row.reverse_reason_code, "reason_label": payload.reason_label})
    return {"lot": _lot_payload(lot, lot.sales_order_id), "return": _return_row(row), "replayed": False}


@router.get("/release-lots/{release_lot_id}/stage-returns")
def list_stage_returns(release_lot_id: uuid.UUID, db: Session = Depends(get_db), plant_id: str = Depends(get_current_plant),
                       current_user: dict = Depends(require_role(["Owner", "Admin", "Planner", "PlantManager", "Sales", "ProductionEffects"]))):
    # Only a lot of an order in the caller's plant: another plant's lot is "not found".
    lot = (
        db.query(SalesOrderReleaseLot)
        .join(SalesOrder, SalesOrderReleaseLot.sales_order_id == SalesOrder.id)
        .filter(SalesOrderReleaseLot.id == release_lot_id, SalesOrder.plant_id == plant_id)
        .first()
    )
    if not lot:
        raise HTTPException(status_code=404, detail="Release lot not found")
    rows = db.query(SalesOrderReleaseLotReturn).filter_by(release_lot_id=lot.id).order_by(SalesOrderReleaseLotReturn.created_at).all()
    return [_return_row(row) for row in rows]
