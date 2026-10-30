"""Closed months in the store books (spec 2.5, client 2026-10-28).

Month-end close in production locks a month here (POST /inventory/books/lock) and re-open unlocks it.
Every store write path calls ``assert_books_open`` with the movement's business date, so GRN, issues,
reel issues, corrections, count postings, supplier returns and opening loads dated inside a closed
month are refused with 409 ``{"code": "BOOKS_LOCKED", "message": "October 2026 is closed. Ask the owner
to re-open it.", "month": "2026-10"}``, the same body production and the BFF send. Exactly the CLOSED
months are locked (spec 2.5, confirmed 2026-10-30): an open month before a closed month stays open.

Business dates are IST calendar days. Server timestamps are naive UTC, so a ``datetime`` given here is
converted to its IST day first.
"""
from __future__ import annotations

import re
from datetime import date, datetime, timezone
from typing import Any, Optional
from zoneinfo import ZoneInfo

from fastapi import HTTPException
from sqlalchemy.orm import Session

from ..models import InventoryBooksLock

IST = ZoneInfo("Asia/Kolkata")
_MONTH_KEY = re.compile(r"\d{4}-\d{2}")
MONTH_NAMES = (
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
)


def ist_today() -> date:
    return datetime.now(IST).date()


def ist_day(value: date | datetime | None) -> date:
    """IST calendar day of a business date (as it is) or a naive-UTC server timestamp; None = today."""
    if value is None:
        return ist_today()
    if isinstance(value, datetime):
        aware = value if value.tzinfo else value.replace(tzinfo=timezone.utc)
        return aware.astimezone(IST).date()
    return value


def month_start(value: date) -> date:
    return value.replace(day=1)


def month_key(value: date) -> str:
    return f"{value.year:04d}-{value.month:02d}"


def month_label(value: date) -> str:
    """"October 2026" — how a month is named in every message."""
    return f"{MONTH_NAMES[value.month - 1]} {value.year}"


def next_month(value: date) -> date:
    return date(value.year + (value.month == 12), value.month % 12 + 1, 1)


def parse_month(value: str) -> date:
    """First day of a "YYYY-MM" month; 422 with a plain message otherwise.

    Strict: four-digit year and two-digit month ("2026-5" and "26-05" are refused, not read as May).
    """
    text = str(value or "").strip()
    if not _MONTH_KEY.fullmatch(text):
        raise HTTPException(status_code=422, detail="Give the month as YYYY-MM, for example 2026-10.")
    try:
        return date(int(text[:4]), int(text[5:]), 1)
    except ValueError:
        raise HTTPException(status_code=422, detail="Give the month as YYYY-MM, for example 2026-10.") from None


def closed_message(month: date) -> str:
    return f"{month_label(month)} is closed. Ask the owner to re-open it."


def locked_months(db: Session, plant_id: str) -> list[date]:
    rows = db.query(InventoryBooksLock.month).filter(
        InventoryBooksLock.plant_id == str(plant_id),
        InventoryBooksLock.status == "LOCKED",
    ).order_by(InventoryBooksLock.month.asc()).all()
    return [row[0] for row in rows]


def is_month_locked(db: Session, plant_id: str, month: date) -> bool:
    return db.query(InventoryBooksLock.id).filter(
        InventoryBooksLock.plant_id == str(plant_id),
        InventoryBooksLock.month == month_start(month),
        InventoryBooksLock.status == "LOCKED",
    ).first() is not None


def books_refusal(locks: list[date], month: date) -> Optional[str]:
    """Why a movement dated in ``month`` is refused, given the plant's closed months; None when it may post.
    Only a closed month itself refuses: an open month before a closed one stays open (spec 2.5)."""
    month = month_start(month)
    return closed_message(month) if month in locks else None


def books_locked_detail(month: date) -> dict[str, Any]:
    """The one refusal body for a closed month, shared by every service (409, code BOOKS_LOCKED)."""
    month = month_start(month)
    return {"code": "BOOKS_LOCKED", "message": closed_message(month), "month": month_key(month)}


def books_locked_error(month: date) -> HTTPException:
    return HTTPException(status_code=409, detail=books_locked_detail(month))


def assert_books_open(db: Session, plant_id: str, effective_date: date | datetime | None) -> None:
    """Refuse a store movement dated inside a closed month (409, code BOOKS_LOCKED, plain words).

    ``effective_date`` is the movement's business date; None means a movement dated now (IST today).
    """
    month = month_start(ist_day(effective_date))
    if is_month_locked(db, plant_id, month):
        raise books_locked_error(month)


def _event(action: str, actor: str, at: datetime, text: Optional[str]) -> dict[str, Any]:
    return {"action": action, "by": actor, "at": at.isoformat(), "note": text}


def lock_month(db: Session, plant_id: str, month: date, actor: str, note: Optional[str] = None) -> InventoryBooksLock:
    """Lock one month (idempotent: an already locked month keeps its first lock)."""
    month = month_start(month)
    row = db.query(InventoryBooksLock).filter(
        InventoryBooksLock.plant_id == str(plant_id), InventoryBooksLock.month == month,
    ).with_for_update().first()
    if row is not None and row.status == "LOCKED":
        return row
    now = datetime.utcnow()
    if row is None:
        row = InventoryBooksLock(plant_id=str(plant_id), month=month, history=[])
        db.add(row)
    row.status = "LOCKED"
    row.locked_by = actor
    row.locked_at = now
    row.lock_note = note
    row.updated_at = now
    row.history = [*(row.history or []), _event("LOCKED", actor, now, note)]
    db.flush()
    return row


def unlock_month(db: Session, plant_id: str, month: date, actor: str, reason: str) -> Optional[InventoryBooksLock]:
    """Re-open one month; returns None when the month was never locked (nothing to do)."""
    month = month_start(month)
    row = db.query(InventoryBooksLock).filter(
        InventoryBooksLock.plant_id == str(plant_id), InventoryBooksLock.month == month,
    ).with_for_update().first()
    if row is None or row.status != "LOCKED":
        return row
    now = datetime.utcnow()
    row.status = "UNLOCKED"
    row.unlocked_by = actor
    row.unlocked_at = now
    row.unlock_reason = reason
    row.updated_at = now
    row.history = [*(row.history or []), _event("UNLOCKED", actor, now, reason)]
    db.flush()
    return row


def serialize_lock(row: InventoryBooksLock) -> dict[str, Any]:
    return {
        "id": str(row.id),
        "plant_id": row.plant_id,
        "month": month_key(row.month),
        "month_label": month_label(row.month),
        "status": row.status,
        "locked_by": row.locked_by,
        "locked_at": row.locked_at.isoformat() if row.locked_at else None,
        "lock_note": row.lock_note,
        "unlocked_by": row.unlocked_by,
        "unlocked_at": row.unlocked_at.isoformat() if row.unlocked_at else None,
        "unlock_reason": row.unlock_reason,
        "history": list(row.history or []),
    }
