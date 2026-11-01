"""Store books lock per closed month (spec 2.5, client 2026-10-28).

Production's month-end close calls these with the Owner's token (service to service); the web reads the
list through the BFF. Locking and unlocking are Owner only and idempotent, so a retried close or
re-open never fails half way.
"""
from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy.orm import Session

from ..database import get_db
from ..reasons import reason_input, resolve_reason, token_of
from ..models import InventoryBooksLock
from ..services.books import (
    ist_today,
    lock_month,
    month_key,
    month_label,
    month_start,
    next_month,
    parse_month,
    serialize_lock,
    unlock_month,
)
from ..utils.audit_client import emit_audit_event
from ..utils.auth import get_current_plant, get_current_plant_scope, get_current_user, require_owner

_audit_logger = logging.getLogger(__name__)

router = APIRouter(prefix="/inventory/books", tags=["inventory-books"])

MONTH_PATTERN = r"^\d{4}-(0[1-9]|1[0-2])$"


def _actor(current_user: dict) -> str:
    return str(current_user.get("actor_identity") or current_user.get("actual_sub") or current_user.get("sub") or "system")


class BooksLockPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    month: str = Field(pattern=MONTH_PATTERN)
    note: Optional[str] = Field(default=None, max_length=500)


class BooksUnlockPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    month: str = Field(pattern=MONTH_PATTERN)
    # A BOOKS_UNLOCK code from Masters › Reason codes is required (owner decision 4, 1 Nov 2026), for the
    # Owner's own re-open and for production's month-end re-open (which passes the Owner's code on).
    reason_code: Optional[str] = Field(default=None, max_length=80)
    reason_note: Optional[str] = Field(default=None, max_length=500)
    # Old free-text field: ignored for the decision, kept so older callers still validate.
    reason: Optional[str] = Field(default=None, max_length=500)
    # System undo of a month-end close that did not finish (production's compensating call right after it
    # locked the month). Allowed without a code only while the lock is fresh; it records a fixed system text.
    rollback: bool = False

    @field_validator("reason")
    @classmethod
    def clean_reason(cls, value: Optional[str]) -> Optional[str]:
        cleaned = " ".join(str(value or "").split())
        return cleaned or None


def _audit(current_user: dict, plant_id: str, event_type: str, summary: str, payload: dict) -> None:
    try:
        emit_audit_event(
            token=current_user.get("token", ""), event_type=event_type, entity_type="inventory_books_lock",
            entity_id=payload.get("id"), plant_id=str(plant_id), actor_role=current_user.get("role"),
            actor_email=current_user.get("sub"), summary=summary, payload=payload,
        )
    except Exception as exc:  # pragma: no cover - audit is best effort
        _audit_logger.warning("audit emit failed for %s: %s", event_type, exc)


@router.get("/locks")
def list_books_locks(
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
    current_user: dict = Depends(get_current_user),
):
    """Closed months of the plant (or of every allowed plant for an ALL view), oldest first. An ALL view
    with no allowed plants lists nothing: it never falls back to every plant's locks."""
    query = db.query(InventoryBooksLock)
    if plant_scope.get("scope_all"):
        allowed = [str(value).strip() for value in (plant_scope.get("allowed_plants") or []) if str(value).strip()]
        if not allowed:
            return {"plant_id": None, "locked_months": [], "items": []}
        query = query.filter(InventoryBooksLock.plant_id.in_(allowed))
    else:
        query = query.filter(InventoryBooksLock.plant_id == plant_scope["selected_plant_id"])
    rows = query.order_by(InventoryBooksLock.plant_id, InventoryBooksLock.month.asc()).all()
    return {
        "plant_id": None if plant_scope.get("scope_all") else plant_scope.get("selected_plant_id"),
        "locked_months": [month_key(row.month) for row in rows if row.status == "LOCKED"],
        "items": [serialize_lock(row) for row in rows],
    }


@router.post("/lock")
def lock_books_month(
    payload: BooksLockPayload,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_owner),
):
    month = parse_month(payload.month)
    today = ist_today()
    if month >= month_start(today):
        raise HTTPException(
            status_code=409,
            detail=f"{month_label(month)} is still running. It can be closed from 1 {month_label(next_month(month))}.",
        )
    row = lock_month(db, plant_id, month, _actor(current_user), (payload.note or "").strip() or None)
    db.commit()
    db.refresh(row)
    result = serialize_lock(row)
    _audit(current_user, plant_id, "inventory_books_locked", f"Store books closed for {month_label(month)}", result)
    return result


ROLLBACK_REASON = "Month-end close did not finish (undone automatically)"
ROLLBACK_WINDOW_MINUTES = 15


def rollback_allowed(db: Session, plant_id: str, month, *, now=None) -> bool:
    """A system undo may re-open a month only if it was locked moments ago (the close it undoes)."""
    from datetime import datetime, timedelta

    row = db.query(InventoryBooksLock).filter(
        InventoryBooksLock.plant_id == str(plant_id), InventoryBooksLock.month == month_start(month),
    ).first()
    if row is None or row.status != "LOCKED":
        return True  # nothing to undo: unlock_month is a no-op
    locked_at = getattr(row, "locked_at", None)
    return bool(locked_at) and (now or datetime.utcnow()) - locked_at <= timedelta(minutes=ROLLBACK_WINDOW_MINUTES)


@router.post("/unlock")
def unlock_books_month(
    payload: BooksUnlockPayload,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_current_plant),
    current_user: dict = Depends(require_owner),
):
    month = parse_month(payload.month)
    code, note = reason_input(payload)
    choice = None
    if payload.rollback and not code:
        if not rollback_allowed(db, plant_id, month):
            raise HTTPException(
                status_code=409,
                detail="Only a month-end close that did not finish can be undone without a reason. Choose a reason to re-open this month.",
            )
        reason_text = ROLLBACK_REASON
    else:
        choice = resolve_reason(category="BOOKS_UNLOCK", code=code, note=note, plant_id=plant_id,
                                token=token_of(current_user), required=True, what="re-opening the month")
        reason_text = choice.text
    row = unlock_month(db, plant_id, month, _actor(current_user), reason_text[:500],
                       coded=({"reason_code": choice.code, "reason_label": choice.label, "reason_note": choice.note} if choice else None))
    db.commit()
    if row is None:
        return {"plant_id": str(plant_id), "month": month_key(month), "month_label": month_label(month), "status": "OPEN",
                "locked_by": None, "locked_at": None, "lock_note": None, "unlocked_by": None, "unlocked_at": None,
                "unlock_reason": None, "history": []}
    db.refresh(row)
    result = serialize_lock(row)
    _audit(current_user, plant_id, "inventory_books_unlocked", f"Store books re-opened for {month_label(month)}: {reason_text}", result)
    return result
