"""The plant's own reel serial (owner decision 6, 1 Nov 2026): ``AIT 06243``.

``AIT`` + a space + 5 digits, one running series of reels per plant and financial year, starting again at
00001 on 1 April. The plant is mid-year on its own paper series, so the Owner / Admin sets the next number of
the current year once (audited); afterwards it can only be raised, never lowered, so a number is never given
twice in a year. Coils slit from a reel carry the parent serial plus ``-1``, ``-2``… Existing AT-… numbers stay
as they are and are still found by scan, search and genealogy.

The serial a person reads is kept in ``inward_metadata.amigo_no`` (what every label and list prints). The
reel_code is the same text; only when an earlier financial year already used that number in the plant does it
get the year added (``AIT 00001/27-28``), because reel_code is unique per plant while the printed series
restarts every April.
"""
from __future__ import annotations

import re
import uuid
from datetime import date, datetime
from typing import Any, Optional

from fastapi import HTTPException
from sqlalchemy import Integer, cast, func, or_, text
from sqlalchemy.orm import Session

from ..models import DocumentSeries, PaperReel, ReelSerialSetting

PREFIX = "AIT"
DOCUMENT_TYPE = "REEL_SERIAL"
MAX_NUMBER = 99999
_TYPED = re.compile(r"^\s*AIT[\s\-/._]*0*(\d{1,6})(?:\s*-\s*(\d{1,3}))?\s*$", re.IGNORECASE)


def financial_year(on_date: date) -> int:
    """Start year of the Indian financial year (April to March) of ``on_date``."""
    return on_date.year if on_date.month >= 4 else on_date.year - 1


def year_label(fy: int) -> str:
    """``2026-27`` for the year that starts on 1 April 2026."""
    return f"{fy}-{(fy + 1) % 100:02d}"


def serial_text(number: int) -> str:
    return f"{PREFIX} {int(number):05d}"


def coil_serial(parent_serial: str, index: int) -> str:
    """``AIT 06243-1``: the parent reel's printed serial and the coil's place."""
    return f"{str(parent_serial or '').strip()}-{int(index)}"


def normal_serial(typed: Any) -> Optional[str]:
    """``ait6243``, ``AIT-06243``, ``AIT 6243 - 2`` -> ``AIT 06243`` / ``AIT 06243-2``; None for anything else."""
    match = _TYPED.match(str(typed or ""))
    if not match:
        return None
    base = serial_text(int(match.group(1)))
    return f"{base}-{int(match.group(2))}" if match.group(2) else base


def _category(fy: int) -> str:
    return f"{PREFIX}-{fy % 100:02d}"


def _plant_key(plant_id: Any) -> str:
    return str(plant_id)


def _lock(db: Session, plant_id: Any, fy: int) -> None:
    db.execute(text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"), {"key": f"reel-serial:{plant_id}:{fy}"})


def _counter(db: Session, plant_id: Any, fy: int, *, create: bool) -> Optional[DocumentSeries]:
    query = db.query(DocumentSeries).filter(
        DocumentSeries.plant_id == _plant_key(plant_id), DocumentSeries.document_type == DOCUMENT_TYPE,
        DocumentSeries.category == _category(fy),
    )
    counter = query.with_for_update().first()
    if counter is None and create:
        counter = DocumentSeries(plant_id=_plant_key(plant_id), document_type=DOCUMENT_TYPE, category=_category(fy),
                                 prefix=PREFIX, next_value=1)
        db.add(counter)
        db.flush()
    return counter


def _plant_uuid(plant_id: Any) -> uuid.UUID:
    return plant_id if isinstance(plant_id, uuid.UUID) else uuid.UUID(str(plant_id))


def _this_year(fy: int):
    """Reels of the series in that year (coils carry their parent's number and year too)."""
    return PaperReel.inward_metadata["serial_fy"].as_string() == str(fy)


def highest_issued(db: Session, plant_id: Any, fy: int) -> int:
    """The highest serial number given to a reel of this plant in that year (0 when none yet)."""
    value = db.query(func.max(cast(PaperReel.inward_metadata["serial_no"].as_string(), Integer))).filter(
        PaperReel.plant_id == _plant_uuid(plant_id), _this_year(fy),
    ).scalar()
    return int(value or 0)


def _number_used(db: Session, plant_id: Any, fy: int, serial: str) -> bool:
    return db.query(PaperReel.id).filter(
        PaperReel.plant_id == _plant_uuid(plant_id), _this_year(fy),
        PaperReel.inward_metadata["amigo_no"].as_string() == serial,
    ).first() is not None


def _reel_code_for(db: Session, plant_id: Any, fy: int, serial: str) -> str:
    """The serial itself, or (when an earlier year used it in the plant) the serial with the year added."""
    taken = db.query(PaperReel.id).filter(PaperReel.plant_id == _plant_uuid(plant_id), PaperReel.reel_code == serial).first()
    if taken is None:
        return serial
    return f"{serial}/{fy % 100:02d}-{(fy + 1) % 100:02d}"


def next_reel_serial(db: Session, plant_id: Any, on_date: date) -> dict[str, Any]:
    """Take the next serial of the plant's series for the financial year of ``on_date`` (the received date).

    Concurrency-safe: an advisory lock per plant and year plus a row lock on the counter, inside the
    caller's transaction, so two receipts posted at once never get one number. Returns
    ``{"serial", "reel_code", "metadata"}``; ``metadata`` goes into the reel's ``inward_metadata``.
    """
    fy = financial_year(on_date)
    _lock(db, plant_id, fy)
    counter = _counter(db, plant_id, fy, create=True)
    number = max(int(counter.next_value or 1), 1)
    while number <= MAX_NUMBER and _number_used(db, plant_id, fy, serial_text(number)):
        number += 1
    if number > MAX_NUMBER:
        raise HTTPException(status_code=409, detail=f"The reel serial series of {year_label(fy)} is full (AIT 99999)")
    counter.next_value = number + 1
    counter.version = int(counter.version or 1) + 1
    serial = serial_text(number)
    return {
        "serial": serial,
        "reel_code": _reel_code_for(db, plant_id, fy, serial),
        "metadata": {"amigo_no": serial, "serial_no": number, "serial_fy": fy},
    }


def kept_serial_number(typed: Any) -> Optional[int]:
    """The number of a reel's own serial typed for opening stock (``AIT 06243`` -> 6243); None when it is not a
    whole-reel serial of the series (coil serials ``AIT 06243-1`` are made by slitting, not typed)."""
    serial = normal_serial(typed)
    if serial is None or "-" in serial:
        return None
    number = int(serial.split()[1])
    return number if 1 <= number <= MAX_NUMBER else None


def keep_reel_serial(db: Session, plant_id: Any, on_date: date, typed: Any) -> dict[str, Any]:
    """Give an opening-stock reel the serial it already carries in the plant (client 2026-11-03: the reel
    register's AIT numbers stay), in the financial year of ``on_date``. The counter moves past it, so the
    next goods inward continues after the highest kept number and never repeats one. 409 when it is taken.
    Same return shape as ``next_reel_serial``."""
    number = kept_serial_number(typed)
    if number is None:
        raise HTTPException(status_code=422, detail=f"{typed} is not a reel serial like AIT 06243")
    fy = financial_year(on_date)
    _lock(db, plant_id, fy)
    counter = _counter(db, plant_id, fy, create=True)
    serial = serial_text(number)
    if _number_used(db, plant_id, fy, serial):
        raise HTTPException(status_code=409, detail=f"{serial} is already a reel of {year_label(fy)} in this plant")
    if int(counter.next_value or 1) <= number:
        counter.next_value = number + 1
        counter.version = int(counter.version or 1) + 1
    return {
        "serial": serial,
        "reel_code": _reel_code_for(db, plant_id, fy, serial),
        "metadata": {"amigo_no": serial, "serial_no": number, "serial_fy": fy, "serial_kept": True},
    }


def serials_in_use(db: Session, plant_id: Any, on_date: date, serials: set[str]) -> set[str]:
    """Which of ``serials`` (normal ``AIT 06243`` texts) are already reels of the plant in that year."""
    if not serials:
        return set()
    fy = financial_year(on_date)
    rows = db.query(PaperReel.inward_metadata["amigo_no"].as_string()).filter(
        PaperReel.plant_id == _plant_uuid(plant_id), _this_year(fy),
        PaperReel.inward_metadata["amigo_no"].as_string().in_(sorted(serials)),
    ).all()
    return {str(row[0]) for row in rows}


def child_serial(db: Session, parent: PaperReel, index: int) -> dict[str, Any]:
    """Serial of the ``index``-th coil slit from ``parent``: printed ``AIT 06243-1``; reel_code from the parent's
    (unique) reel_code the same way, so an old AT-… reel's coils read ``AT-261030-004-1``."""
    meta = parent.inward_metadata or {}
    printed = str(meta.get("amigo_no") or parent.reel_code or "").strip().upper()
    return {
        "serial": coil_serial(printed, index),
        "reel_code": coil_serial(parent.reel_code, index),
    }


def series_state(db: Session, plant_id: Any, today: date) -> dict[str, Any]:
    """What the setting shows: this year's next number, the highest given, and who set it (newest first)."""
    fy = financial_year(today)
    counter = _counter(db, plant_id, fy, create=False)
    highest = highest_issued(db, plant_id, fy)
    next_value = max(int(counter.next_value) if counter else 1, highest + 1)
    # Glue tank settings (kind TANK) are their own series; rows from before 3 Nov 2026 have no kind: reels.
    history = db.query(ReelSerialSetting).filter(
        ReelSerialSetting.plant_id == _plant_key(plant_id), ReelSerialSetting.financial_year == fy,
        or_(ReelSerialSetting.kind.is_(None), ReelSerialSetting.kind == "REEL"),
    ).order_by(ReelSerialSetting.created_at.desc()).all()
    return {
        "plant_id": _plant_key(plant_id),
        "financial_year": fy,
        "year_label": year_label(fy),
        "restarts_on": date(fy + 1, 4, 1).isoformat(),
        "next_number": next_value,
        "next_serial": serial_text(next_value),
        "highest_issued": highest,
        "last_serial": serial_text(highest) if highest else None,
        "issued": highest > 0,
        "set": bool(history),
        "history": [{
            "from_number": row.from_number, "to_number": row.to_number, "reason": row.reason,
            "reason_code": getattr(row, "reason_code", None), "reason_label": getattr(row, "reason_label", None),
            "set_by": row.set_by, "set_at": row.created_at.isoformat() if row.created_at else None,
        } for row in history],
    }


def set_next_number(db: Session, plant_id: Any, number: int, *, actor: str, reason: str, today: date,
                    reason_code: Optional[str] = None, reason_label: Optional[str] = None,
                    reason_note: Optional[str] = None) -> dict[str, Any]:
    """The Owner / Admin sets the number the next new reel of this year gets (the plant's own series).

    Before any reel of the year has a serial it may be set freely; after that only raised above the highest
    serial given, never lowered (a number is never given twice in a year). Every change is kept with who,
    when and why (``reason`` is the "Label — note" text of the REEL_SERIAL code the router checked; the code,
    label and note are kept beside it).
    """
    fy = financial_year(today)
    number = int(number)
    if number < 1 or number > MAX_NUMBER:
        raise HTTPException(status_code=422, detail=f"The next reel number must be between 1 and {MAX_NUMBER}")
    reason = str(reason or "").strip()
    if len(reason) < 3:
        raise HTTPException(status_code=422, detail="Say why the reel number is being set (at least 3 characters)")
    _lock(db, plant_id, fy)
    counter = _counter(db, plant_id, fy, create=True)
    highest = highest_issued(db, plant_id, fy)
    current = max(int(counter.next_value or 1), highest + 1)
    if highest and number <= highest:
        raise HTTPException(
            status_code=409,
            detail=f"{serial_text(highest)} is already on a reel this year. The next number can only be raised above {highest:05d}, never lowered.",
        )
    if number == current:
        raise HTTPException(status_code=409, detail=f"The next reel already gets {serial_text(number)}")
    counter.next_value = number
    counter.version = int(counter.version or 1) + 1
    counter.updated_at = datetime.utcnow()
    db.add(ReelSerialSetting(plant_id=_plant_key(plant_id), kind="REEL", financial_year=fy, from_number=current, to_number=number,
                             reason=reason, reason_code=reason_code, reason_label=reason_label, reason_note=reason_note,
                             set_by=actor))
    db.flush()
    return {"from_number": current, "to_number": number}
