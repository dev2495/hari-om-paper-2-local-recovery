"""The plant's own glue tank number (owner, 3 Nov 2026): ``AIT 00546``.

The same shape as the reel serial (``services/reel_serial.py``) but its own series: one running number of glue
(adhesive) tanks per plant and financial year, starting again at AIT 00001 on 1 April, never given twice in a
year. A reel and a tank may carry the same number, once in each series. The Owner / Admin sets the next number
of the current year once (audited); afterwards it can only be raised.

The number lives on the tank's StockBatch: ``inward_metadata.amigo_no`` (what labels and lists print) plus
``serial_no`` / ``serial_fy``. The batch_no is the same text; only when an earlier year already used it in the
plant does it get the year added (``AIT 00001/27-28``), the way a reel_code does.
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Any, Optional

from fastapi import HTTPException
from sqlalchemy import Integer, cast, func, text
from sqlalchemy.orm import Session

from ..models import DocumentSeries, ItemMaster, ItemType, ReelSerialSetting, StockBatch
from .reel_serial import MAX_NUMBER, PREFIX, financial_year, kept_serial_number, serial_text, year_label

DOCUMENT_TYPE = "TANK_SERIAL"
KIND = "TANK"


def is_tank_item(item: Any) -> bool:
    """Glue (adhesive) is kept in tanks that carry the plant's tank number; other bulk lots keep their numbers."""
    value = getattr(getattr(item, "type", None), "value", getattr(item, "type", None))
    return str(value or "").upper() == ItemType.ADHESIVE.value


def _category(fy: int) -> str:
    return f"{PREFIX}-{fy % 100:02d}"


def _plant_key(plant_id: Any) -> str:
    return str(plant_id)


def _lock(db: Session, plant_id: Any, fy: int) -> None:
    db.execute(text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"), {"key": f"tank-serial:{plant_id}:{fy}"})


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


def _tanks(db: Session, plant_id: Any, fy: int, *columns):
    """Glue lots of the series in that year in this plant."""
    return db.query(*columns).join(ItemMaster, ItemMaster.id == StockBatch.item_id).filter(
        StockBatch.plant_id == _plant_key(plant_id), ItemMaster.type == ItemType.ADHESIVE,
        StockBatch.inward_metadata["serial_fy"].as_string() == str(fy),
    )


def highest_issued(db: Session, plant_id: Any, fy: int) -> int:
    """The highest tank number given in this plant in that year (0 when none yet)."""
    value = _tanks(db, plant_id, fy, func.max(cast(StockBatch.inward_metadata["serial_no"].as_string(), Integer))).scalar()
    return int(value or 0)


def _number_used(db: Session, plant_id: Any, fy: int, serial: str) -> bool:
    return _tanks(db, plant_id, fy, StockBatch.id).filter(StockBatch.inward_metadata["amigo_no"].as_string() == serial).first() is not None


def _batch_no_for(db: Session, plant_id: Any, fy: int, serial: str) -> str:
    """The number itself, or (when an earlier year's lot already has it as batch_no) the number with the year."""
    taken = db.query(StockBatch.id).filter(StockBatch.plant_id == _plant_key(plant_id), StockBatch.batch_no == serial).first()
    if taken is None:
        return serial
    return f"{serial}/{fy % 100:02d}-{(fy + 1) % 100:02d}"


def _given(db: Session, plant_id: Any, fy: int, number: int, *, kept: bool) -> dict[str, Any]:
    serial = serial_text(number)
    metadata = {"amigo_no": serial, "serial_no": number, "serial_fy": fy, "serial_kind": KIND}
    if kept:
        metadata["serial_kept"] = True
    return {"serial": serial, "batch_no": _batch_no_for(db, plant_id, fy, serial), "metadata": metadata}


def next_tank_serial(db: Session, plant_id: Any, on_date: date) -> dict[str, Any]:
    """Take the next tank number of the plant for the financial year of ``on_date`` (the received date).

    Concurrency-safe like the reel serial: an advisory lock per plant and year plus a row lock on the counter,
    inside the caller's transaction. Numbers already on a tank of the year (kept from opening stock) are
    skipped. Returns ``{"serial", "batch_no", "metadata"}``; ``metadata`` goes into the lot's ``inward_metadata``.
    """
    fy = financial_year(on_date)
    _lock(db, plant_id, fy)
    counter = _counter(db, plant_id, fy, create=True)
    number = max(int(counter.next_value or 1), 1)
    while number <= MAX_NUMBER and _number_used(db, plant_id, fy, serial_text(number)):
        number += 1
    if number > MAX_NUMBER:
        raise HTTPException(status_code=409, detail=f"The glue tank number series of {year_label(fy)} is full (AIT 99999)")
    counter.next_value = number + 1
    counter.version = int(counter.version or 1) + 1
    return _given(db, plant_id, fy, number, kept=False)


def keep_tank_serial(db: Session, plant_id: Any, on_date: date, typed: Any) -> dict[str, Any]:
    """Give an opening-stock glue tank the number it already carries in the plant (owner, 3 Nov 2026), in the
    financial year of ``on_date``. The counter moves past it, so the next new tank continues after the highest
    kept number. 409 when it is taken. Same return shape as ``next_tank_serial``."""
    number = kept_serial_number(typed)
    if number is None:
        raise HTTPException(status_code=422, detail=f"{typed} is not a tank number like AIT 00546")
    fy = financial_year(on_date)
    _lock(db, plant_id, fy)
    counter = _counter(db, plant_id, fy, create=True)
    serial = serial_text(number)
    if _number_used(db, plant_id, fy, serial):
        raise HTTPException(status_code=409, detail=f"{serial} is already a glue tank of {year_label(fy)} in this plant")
    if int(counter.next_value or 1) <= number:
        counter.next_value = number + 1
        counter.version = int(counter.version or 1) + 1
    return _given(db, plant_id, fy, number, kept=True)


def serials_in_use(db: Session, plant_id: Any, on_date: date, serials: set[str]) -> set[str]:
    """Which of ``serials`` (normal ``AIT 00546`` texts) are already glue tanks of the plant in that year."""
    if not serials:
        return set()
    amigo = StockBatch.inward_metadata["amigo_no"].as_string()
    rows = _tanks(db, plant_id, financial_year(on_date), amigo).filter(amigo.in_(sorted(serials))).all()
    return {str(row[0]) for row in rows}


def _settings(db: Session):
    return db.query(ReelSerialSetting).filter(ReelSerialSetting.kind == KIND)


def series_state(db: Session, plant_id: Any, today: date) -> dict[str, Any]:
    """What the setting shows: this year's next tank number, the highest given, and who set it (newest first)."""
    fy = financial_year(today)
    counter = _counter(db, plant_id, fy, create=False)
    highest = highest_issued(db, plant_id, fy)
    next_value = max(int(counter.next_value) if counter else 1, highest + 1)
    history = _settings(db).filter(
        ReelSerialSetting.plant_id == _plant_key(plant_id), ReelSerialSetting.financial_year == fy,
    ).order_by(ReelSerialSetting.created_at.desc()).all()
    return {
        "plant_id": _plant_key(plant_id),
        "kind": KIND,
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
            "reason_code": row.reason_code, "reason_label": row.reason_label,
            "set_by": row.set_by, "set_at": row.created_at.isoformat() if row.created_at else None,
        } for row in history],
    }


def set_next_number(db: Session, plant_id: Any, number: int, *, actor: str, reason: str, today: date,
                    reason_code: Optional[str] = None, reason_label: Optional[str] = None,
                    reason_note: Optional[str] = None) -> dict[str, Any]:
    """The Owner / Admin sets the number the next new glue tank of this year gets. Free before any tank of the
    year has a number; after that only raised above the highest given. Every change is kept with who, when, why."""
    fy = financial_year(today)
    number = int(number)
    if number < 1 or number > MAX_NUMBER:
        raise HTTPException(status_code=422, detail=f"The next tank number must be between 1 and {MAX_NUMBER}")
    reason = str(reason or "").strip()
    if len(reason) < 3:
        raise HTTPException(status_code=422, detail="Say why the tank number is being set (at least 3 characters)")
    _lock(db, plant_id, fy)
    counter = _counter(db, plant_id, fy, create=True)
    highest = highest_issued(db, plant_id, fy)
    current = max(int(counter.next_value or 1), highest + 1)
    if highest and number <= highest:
        raise HTTPException(
            status_code=409,
            detail=f"{serial_text(highest)} is already on a glue tank this year. The next number can only be raised above {highest:05d}, never lowered.",
        )
    if number == current:
        raise HTTPException(status_code=409, detail=f"The next glue tank already gets {serial_text(number)}")
    counter.next_value = number
    counter.version = int(counter.version or 1) + 1
    counter.updated_at = datetime.utcnow()
    db.add(ReelSerialSetting(plant_id=_plant_key(plant_id), kind=KIND, financial_year=fy, from_number=current, to_number=number,
                             reason=reason, reason_code=reason_code, reason_label=reason_label, reason_note=reason_note,
                             set_by=actor))
    db.flush()
    return {"from_number": current, "to_number": number}

