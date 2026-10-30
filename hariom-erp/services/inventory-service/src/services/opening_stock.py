"""Opening stock for go-live (client 2026-10-30, spec part C3).

The plant starts on TubeOS with stock already on its racks. Owner or Admin enter it in batches:
  - the first posted batch fixes the plant's go-live date; every later batch uses the same date, so
    stores can enter rack by rack over a few days;
  - once the go-live month is closed, opening stock is closed (a stock count corrects stock after that);
  - each reel / coil / bulk lot gets a new system number dated the go-live date (AT-yymmdd-nnn for reels,
    RM-<item>-yymmdd-nnn for lots), a ledger receipt with source "Opening load", a location (default the
    RM store) and is either cleared (usable at once, no incoming QC: it is already in use in the plant)
    or on hold with a reason (incoming QC clears it like any held lot);
  - one batch posts all or nothing, once per request key (a double click posts once), inside the books
    lock like every store movement.

Opening reels are tagged ``source_document_type = OPENING_LOAD`` and opening lots post a ledger row of
type OPENING, which is how the stock book and the month figures show them as "Opening loads".
"""
from __future__ import annotations

import re
import uuid
from collections import defaultdict
from datetime import date, datetime, time, timedelta
from typing import Any, Iterable, Optional

from fastapi import HTTPException
from sqlalchemy import func, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..models import (
    CostSource,
    InventoryLocation,
    InventoryOpeningLoad,
    InventoryOpeningLoadLine,
    ItemMaster,
    ItemType,
    LotLabelRecord,
    PaperReel,
    ReelScanEvent,
    ReelScanEventType,
    ReelScanSource,
    ReelStatus,
    ReferenceType,
    StockBatch,
    StockTransaction,
    TrackingMode,
    TransactionType,
)
from .books import assert_books_open, ist_today, locked_months, month_label, month_start
from .labels import batch_label_payload, reel_label_payload, scan_url
from .locations import RECEIVING_DEFAULT_CODE, RECEIVING_PURPOSES, default_receiving_location
from .receipt_quality import initial_quality
from .stock_lots import batch_balances, location_brief, lot_row

OPENING_CLOSED = "Opening stock is closed. Use a stock count to correct stock."
SOURCE_WORD = "Opening load"
# Carry-forward proofs (the retired month-end "post opening") wrote opening documents without stock.
CARRY_FORWARD_PREFIX = "OPEN-FROM-"
NOT_OPENING_TYPES = {ItemType.FINISHED_GOOD.value, ItemType.TOOL.value}
CLEARED, ON_HOLD = "UNRESTRICTED", "QC_HOLD"
# Warnings only (the page shows them before posting); never a refusal.
LARGE_REEL_KG = 3000.0
LARGE_BULK_QTY = 50000.0
MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
UNIT_WORD = {"KG": "kg", "PCS": "pcs", "L": "L"}
# Places opening stock may not go (goods inward refuses them too): counts and rack moves never look at the
# floor or a dispatch bay, and stock in a scrap bay is not usable stock.
NOT_STORE_PURPOSES = {"WIP": "the production floor", "DISPATCH": "a dispatch bay", "SCRAP": "a scrap bay"}
# Units counted in whole things (as the web's isWholeUnit): 10.5 cartons cannot be opening stock.
WHOLE_UNITS = {"PCS", "NOS", "BOX", "ROLL", "SET", "PKT", "BAG", "DRUM"}
WHOLE_WORD = {"PCS": "pieces", "NOS": "numbers", "BOX": "boxes", "ROLL": "rolls", "SET": "sets", "PKT": "packets", "BAG": "bags", "DRUM": "drums"}


def _enum(value: Any) -> str:
    return str(getattr(value, "value", value) or "")


def day_words(value: date) -> str:
    """Indian date in words: 28 Oct 2026."""
    return f"{value.day} {MONTHS[value.month - 1]} {value.year}"


def indian_number(value: float) -> str:
    """12,34,567.5: Indian digit grouping (lakh, crore), up to 3 decimals, the way the page shows totals."""
    rounded = round(float(value or 0.0), 3)
    sign = "-" if rounded < 0 else ""
    whole, _, fraction = f"{abs(rounded):.3f}".partition(".")
    fraction = fraction.rstrip("0")
    if len(whole) > 3:
        head, tail = whole[:-3], whole[-3:]
        groups = []
        while len(head) > 2:
            groups.insert(0, head[-2:])
            head = head[:-2]
        whole = ",".join(([head] if head else []) + groups + [tail])
    return f"{sign}{whole}{'.' + fraction if fraction else ''}"


def qty_words(qty: float, uom: str) -> str:
    return f"{indian_number(qty)} {UNIT_WORD.get(uom, uom.lower())}"


def source_label(go_live: date) -> str:
    """What genealogy, /scan and labels show as the lot's source instead of a vendor GRN."""
    return f"Opening stock ({day_words(go_live)})"


def refuse(status: int, code: str, message: str) -> HTTPException:
    return HTTPException(status_code=status, detail={"code": code, "message": message})


def _plant_uuid(plant_id: str) -> uuid.UUID:
    try:
        return uuid.UUID(str(plant_id))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid plant_id: {plant_id}") from exc


def ist_day_end_utc(day: date) -> datetime:
    """23:59:59 IST of a business day as a naive UTC timestamp (what the server stores)."""
    return datetime.combine(day, time(23, 59, 59)) - timedelta(hours=5, minutes=30)


def stock_loads(db: Session, plant_id: str) -> list[InventoryOpeningLoad]:
    """Opening batches that put stock in the plant, oldest first (carry-forward proofs left out)."""
    rows = db.query(InventoryOpeningLoad).filter(
        InventoryOpeningLoad.plant_id == str(plant_id),
        ~InventoryOpeningLoad.document_no.like(f"{CARRY_FORWARD_PREFIX}%"),
    ).order_by(InventoryOpeningLoad.created_at.asc(), InventoryOpeningLoad.document_no.asc()).all()
    return rows


def go_live_date(db: Session, plant_id: str) -> Optional[date]:
    loads = stock_loads(db, plant_id)
    return min((row.effective_date for row in loads), default=None)


def opening_state(db: Session, plant_id: str) -> dict[str, Any]:
    """NOT_STARTED (no batch yet), OPEN (more batches on the go-live date) or CLOSED.

    Opening stock is closed once the go-live month (or any later month) is closed. A plant that has closed a
    month without any opening batch already runs its stock book on TubeOS, so a "go-live" batch would land
    in the middle of that history (before or between closed months): it is closed there too, and a stock
    count corrects stock instead.
    """
    go_live = go_live_date(db, plant_id)
    closed = locked_months(db, plant_id)
    if go_live is None:
        if closed:
            return {
                "state": "CLOSED", "go_live_date": None, "message": OPENING_CLOSED,
                "closed_reason": f"This plant's stock book is already running on TubeOS: {month_label(closed[-1])} is closed. "
                                 "Go-live opening stock is only for a plant that has not closed a month yet.",
            }
        return {"state": "NOT_STARTED", "go_live_date": None, "message": None, "closed_reason": None}
    after = [month for month in closed if month >= month_start(go_live)]
    if after:
        return {
            "state": "CLOSED", "go_live_date": go_live, "message": OPENING_CLOSED,
            "closed_reason": f"{month_label(after[0])} is closed, so the go-live stock of {day_words(go_live)} can no longer change.",
        }
    return {
        "closed_reason": None,
        "state": "OPEN",
        "go_live_date": go_live,
        "message": f"More batches can be added on {day_words(go_live)} until {month_label(go_live)} is closed.",
    }


def book_started_on(db: Session, plant_id: str, before: date) -> Optional[date]:
    """The first stock movement of the plant dated before ``before`` (GRNs, issues, corrections, reels), or None.

    Opening stock is the stock on the racks on the go-live day; movements before it mean the plant already
    runs on TubeOS, which the page says before the first batch fixes the date (a warning, not a refusal:
    a GRN or two before the opening stock is typed in is normal on a go-live day).
    """
    day = func.coalesce(StockTransaction.effective_date, func.date(StockTransaction.created_at))
    first_txn = db.query(func.min(day)).filter(
        StockTransaction.plant_id == str(plant_id),
        StockTransaction.transaction_type != TransactionType.OPENING,
        day < before,
    ).scalar()
    plant_uuid = _uuid_or_none(plant_id)
    first_reel = db.query(func.min(PaperReel.inward_date)).filter(
        PaperReel.plant_id == plant_uuid, PaperReel.inward_date < before,
    ).scalar() if plant_uuid else None
    found = [value for value in (first_txn, first_reel) if value is not None]
    return min(found) if found else None


def date_warning(db: Session, plant_id: str, effective_date: Optional[date]) -> Optional[str]:
    """A plain warning about the go-live date the first batch will fix (None when there is nothing to say)."""
    if effective_date is None or go_live_date(db, plant_id) is not None:
        return None
    started = book_started_on(db, plant_id, effective_date)
    if started is None:
        return None
    return (f"This plant already has stock movements from {day_words(started)}, before {day_words(effective_date)}. "
            "Opening stock is the stock on the racks on the go-live day. If the plant already runs on TubeOS, "
            "use a stock count to correct stock instead.")


def date_refusal(db: Session, plant_id: str, effective_date: Optional[date]) -> Optional[HTTPException]:
    """Why a batch dated ``effective_date`` cannot post, or None (the go-live date rule, then the books lock)."""
    state = opening_state(db, plant_id)
    go_live = state["go_live_date"]
    if state["state"] == "CLOSED":
        if go_live is None and effective_date is not None:
            # No go-live yet but the book already runs: a date inside a closed month gets the one closed-month
            # refusal every store movement gets (409 BOOKS_LOCKED); any other date is "opening stock is closed".
            try:
                assert_books_open(db, plant_id, effective_date)
            except HTTPException as exc:
                # The 409 body stays the one closed-month refusal of every store movement; the reason and
                # the check before posting (preview) say opening stock is closed here, so "re-open the month"
                # is never read as a way to open opening stock.
                if isinstance(exc.detail, dict) and exc.detail.get("code") == "BOOKS_LOCKED":
                    exc.detail = {**exc.detail, "reason": state.get("closed_reason"), "opening_closed": True}
                return exc
        # The message stays the one sentence the page shows; the reason says why (its month, or a running book).
        return HTTPException(status_code=409, detail={"code": "OPENING_CLOSED", "message": OPENING_CLOSED, "reason": state.get("closed_reason")})
    if effective_date is None:
        return refuse(422, "GO_LIVE_DATE_MISSING", "Choose the go-live date.")
    if go_live is not None and effective_date != go_live:
        return refuse(
            409,
            "GO_LIVE_DATE_FIXED",
            f"This plant went live on {day_words(go_live)}. Opening stock can only be added on {day_words(go_live)}, "
            f"not on {day_words(effective_date)}.",
        )
    if go_live is None and effective_date > ist_today():
        return refuse(422, "GO_LIVE_IN_FUTURE", f"The go-live date cannot be after today ({day_words(ist_today())}).")
    try:
        assert_books_open(db, plant_id, effective_date)
    except HTTPException as exc:
        return exc
    return None


# ---------------------------------------------------------------- lines


def _clean(value: Any, limit: int) -> Optional[str]:
    text_value = str(value or "").strip()
    return text_value[:limit] if text_value else None


def _old_mark(line: Any) -> Optional[str]:
    """The number or mark the reel / lot had before go-live (old callers sent it as reel_code / batch_no)."""
    return _clean(getattr(line, "old_mark", None) or getattr(line, "reel_code", None) or getattr(line, "batch_no", None), 120)


def _line_kind(item: Optional[ItemMaster]) -> str:
    return "REEL" if item is not None and _enum(item.tracking_mode) == TrackingMode.REEL.value else "BULK"


def _line_status(line: Any) -> str:
    status = str(getattr(line, "stock_status", "") or "").strip().upper() or CLEARED
    return ON_HOLD if getattr(line, "on_hold", False) or status == ON_HOLD else status


def _uuid_or_none(value: Any) -> Optional[uuid.UUID]:
    if value in (None, ""):
        return None
    if isinstance(value, uuid.UUID):
        return value
    try:
        return uuid.UUID(str(value))
    except ValueError:
        return None


def planned_default(locations: Iterable[InventoryLocation]) -> Optional[InventoryLocation]:
    """The RM store a row without a location goes to, read without writing: the same choice that
    locations.default_receiving_location makes when the batch posts (an active receiving default that is a
    store rack or QC bay, else the RM-STORE rack, else the oldest active store rack). None means posting
    creates "RM-STORE · RM store"."""
    rows = list(locations)
    purpose = lambda row: str(row.purpose or "").upper()  # noqa: E731
    receiving = [row for row in rows if purpose(row) in ("", *RECEIVING_PURPOSES)]
    current = next((row for row in receiving if row.is_receiving_default and row.active == "true"), None)
    if current is not None:
        return current
    store = next((row for row in receiving if row.code == RECEIVING_DEFAULT_CODE), None)
    if store is None and any(row.code == RECEIVING_DEFAULT_CODE for row in rows):
        stores = sorted((row for row in rows if row.active == "true" and purpose(row) == "STORAGE"), key=lambda row: row.created_at or datetime.min)
        store = stores[0] if stores else None
    return store


def check_lines(db: Session, plant_id: str, lines: list[Any]) -> dict[str, Any]:
    """Per-line errors and warnings plus the totals the page reviews before posting (nothing is written).

    Totals are per item and unit, and per unit: kg and pcs are never added together.
    """
    item_ids = {value for value in (_uuid_or_none(getattr(line, "item_id", None)) for line in lines) if value}
    items = {row.id: row for row in db.query(ItemMaster).filter(ItemMaster.id.in_(item_ids), ItemMaster.plant_id == str(plant_id)).all()} if item_ids else {}
    locations = {row.id: row for row in db.query(InventoryLocation).filter(InventoryLocation.plant_id == str(plant_id)).all()}
    default = planned_default(locations.values())

    # Old marks already in the plant: reels' vendor reel numbers and earlier opening lots' marks.
    # {MARK: "reel AT-261028-012" / "lot RM-…"}: the warning names what already has it, so the user checks that one.
    marks_in_plant: dict[str, str] = {}
    plant_uuid = _uuid_or_none(plant_id)
    wanted = {str(_old_mark(line) or "").upper() for line in lines} - {""}
    if wanted and plant_uuid:
        # Matched in SQL: the page checks after every pause in typing, and a plant has years of reels.
        reel_mark = func.upper(func.trim(PaperReel.source_reel_no))
        for mark, code, form in db.query(reel_mark, PaperReel.reel_code, PaperReel.physical_form).filter(PaperReel.plant_id == plant_uuid, reel_mark.in_(wanted)).order_by(PaperReel.created_at.asc()).all():
            marks_in_plant.setdefault(str(mark), f"{'coil' if str(form or '').upper() == 'COIL' else 'reel'} {code}")
        opening_lots = db.query(InventoryOpeningLoadLine.batch_id).join(InventoryOpeningLoad).filter(
            InventoryOpeningLoad.plant_id == str(plant_id), InventoryOpeningLoadLine.batch_id.isnot(None),
        )
        lot_mark = func.upper(func.trim(StockBatch.inward_metadata["old_mark"].as_string()))
        for mark, batch_no in db.query(lot_mark, StockBatch.batch_no).filter(StockBatch.id.in_(opening_lots), lot_mark.in_(wanted)).order_by(StockBatch.created_at.asc()).all():
            marks_in_plant.setdefault(str(mark), f"lot {batch_no}")
    seen_marks: dict[str, int] = {}

    checked: list[dict[str, Any]] = []
    by_item: dict[tuple[str, str], dict[str, Any]] = {}
    by_unit: dict[str, float] = defaultdict(float)
    reels = lots = held = 0
    no_rate_items: set[str] = set()
    for index, line in enumerate(lines, start=1):
        errors: list[dict[str, str]] = []
        warnings: list[str] = []
        item = items.get(_uuid_or_none(getattr(line, "item_id", None)))
        if getattr(line, "item_id", None) in (None, ""):
            errors.append({"field": "item", "message": "Choose the material."})
        elif item is None:
            errors.append({"field": "item", "message": "This material is not in this plant."})
        elif item.active != "true":
            errors.append({"field": "item", "message": f"{item.name} is switched off in the masters."})
        elif _enum(item.type) in NOT_OPENING_TYPES:
            errors.append({"field": "item", "message": f"{item.name} is not a raw material. Finished goods and tools are not opening stock."})
        kind = _line_kind(item)
        asked = str(getattr(line, "kind", "") or "").strip().upper()
        if item is not None and asked and asked != kind:
            errors.append({"field": "kind", "message": f"{item.name} is kept as {'reels / coils' if kind == 'REEL' else 'a bulk lot'}, so enter it as {'a reel' if kind == 'REEL' else 'a bulk lot'}."})
        uom = "KG" if kind == "REEL" else (_enum(item.uom) if item is not None else "")
        typed = getattr(line, "qty", None)
        try:
            qty = float(typed) if typed not in (None, "") else 0.0
        except (TypeError, ValueError):
            qty = 0.0
        if typed in (None, ""):
            errors.append({"field": "qty", "message": "Enter the weight in kg." if kind == "REEL" else "Enter the quantity."})
        elif qty <= 0:
            errors.append({"field": "qty", "message": "Weight must be more than 0 kg." if kind == "REEL" else "Quantity must be more than 0."})
        elif kind == "BULK" and uom.upper() in WHOLE_UNITS and abs(qty - round(qty)) > 1e-9:
            errors.append({"field": "qty", "message": f"{item.name if item else 'This material'} is counted in whole {WHOLE_WORD.get(uom.upper(), uom.lower())}: "
                                                      f"enter {int(qty)} or {int(qty) + 1}, not {indian_number(qty)}."})
        elif kind == "REEL" and qty > LARGE_REEL_KG:
            warnings.append(f"{qty_words(qty, 'KG')} is a very heavy reel. Check the weight.")
        elif kind == "BULK" and qty > LARGE_BULK_QTY:
            warnings.append(f"{qty_words(qty, uom)} is a very large lot. Check the quantity.")
        location = None
        location_id = _uuid_or_none(getattr(line, "location_id", None))
        if getattr(line, "location_id", None) not in (None, "") and location_id is None:
            errors.append({"field": "location", "message": "This location is not in this plant."})
        elif location_id is not None:
            location = locations.get(location_id)
            if location is None:
                errors.append({"field": "location", "message": "This location is not in this plant."})
            elif location.active != "true":
                errors.append({"field": "location", "message": f"{location.code} is switched off. Choose an active location."})
            elif str(location.purpose or "").upper() in NOT_STORE_PURPOSES:
                # As goods inward (spec 2.7): not the floor, a dispatch bay or a scrap bay.
                where = NOT_STORE_PURPOSES[str(location.purpose or "").upper()]
                errors.append({"field": "location", "message": f"{location.code} is {where}. Put opening stock on a store rack, such as the RM store."})
        else:
            location = default
        status = _line_status(line)
        if status not in {CLEARED, ON_HOLD}:
            errors.append({"field": "status", "message": "Opening stock is either cleared or on hold."})
        hold_reason = _clean(getattr(line, "hold_reason", None), 300)
        if status == ON_HOLD and not hold_reason:
            errors.append({"field": "hold_reason", "message": "Say why this lot is on hold."})
        mark = _old_mark(line)
        if mark:
            key = mark.upper()
            if key in seen_marks:
                warnings.append(f"Old mark {mark} is also on row {seen_marks[key]}.")
            else:
                seen_marks[key] = index
            if key in marks_in_plant:
                warnings.append(f"Old mark {mark} is already on {marks_in_plant[key]} in this plant.")
        rate = getattr(line, "unit_cost", None)
        rate = float(rate) if rate not in (None, "") else None
        if rate is not None and rate < 0:
            errors.append({"field": "rate", "message": "The rate cannot be below zero."})
        has_rate = (rate or 0) > 0 or float(getattr(item, "unit_cost", None) or 0.0) > 0
        # A material that cannot be opening stock (switched off, a finished good) gets no rate warning.
        if item is not None and not has_rate and not any(error["field"] == "item" for error in errors):
            warnings.append(f"No rate for {item.name}: it is counted at ₹0 until a rate is set.")
            if not errors:
                no_rate_items.add(str(item.id))
        row = {
            "index": index,
            "ok": not errors,
            "errors": errors,
            "warnings": warnings,
            "kind": kind,
            "item_id": str(item.id) if item else None,
            "item_code": item.item_code if item else None,
            "item_name": item.name if item else None,
            "item_type": _enum(item.type) if item else None,
            "uom": uom,
            "qty": round(qty, 3),
            "stock_status": status,
            "location": location_brief(location),
            "rate": rate if rate is not None else (float(item.unit_cost) if item is not None and item.unit_cost else None),
        }
        checked.append(row)
        # The review totals are what will post: a row with an error adds nothing until it is fixed.
        if not errors and item is not None and qty > 0:
            key = (str(item.id), uom)
            entry = by_item.setdefault(key, {"item_id": str(item.id), "item_code": item.item_code, "item_name": item.name, "uom": uom, "qty": 0.0, "reels": 0, "lots": 0, "held": 0})
            entry["qty"] = round(entry["qty"] + qty, 3)
            entry["reels" if kind == "REEL" else "lots"] += 1
            entry["held"] += 1 if status == ON_HOLD else 0
            by_unit[uom] = round(by_unit[uom] + qty, 3)
            reels += 1 if kind == "REEL" else 0
            lots += 0 if kind == "REEL" else 1
            held += 1 if status == ON_HOLD else 0
    return {
        "lines": checked,
        "error_count": sum(len(row["errors"]) for row in checked),
        "warning_count": sum(len(row["warnings"]) for row in checked),
        "totals": {
            "reels": reels,
            "lots": lots,
            "held": held,
            "units": [{"uom": uom, "qty": qty} for uom, qty in sorted(by_unit.items())],
            "items": sorted(by_item.values(), key=lambda row: (row["uom"], str(row["item_name"] or ""))),
            "items_without_rate": len(no_rate_items),
        },
        "default_location": location_brief(default),
    }


def preview(db: Session, plant_id: str, effective_date: Optional[date], lines: list[Any]) -> dict[str, Any]:
    result = check_lines(db, plant_id, lines)
    refusal = date_refusal(db, plant_id, effective_date)
    detail = refusal.detail if refusal is not None else None
    result["date"] = {
        "ok": refusal is None,
        "effective_date": effective_date.isoformat() if effective_date else None,
        # A closed month on a plant whose opening stock is closed reads as "opening stock is closed" here.
        "message": (OPENING_CLOSED if isinstance(detail, dict) and detail.get("opening_closed") else (detail.get("message") if isinstance(detail, dict) else detail)) if refusal is not None else None,
        "warning": date_warning(db, plant_id, effective_date) if refusal is None else None,
    }
    result["can_post"] = refusal is None and result["error_count"] == 0 and bool(result["lines"])
    result["opening"] = serialize_state(opening_state(db, plant_id))
    return result


# ---------------------------------------------------------------- numbers


def _token(value: Optional[str]) -> str:
    token = re.sub(r"[^A-Z0-9]+", "-", (value or "").strip().upper()).strip("-")
    return token[:32] or "ITEM"


def _next_reel_code(db: Session, plant_uuid: uuid.UUID, on_day: date) -> str:
    """AT-yymmdd-nnn dated the go-live date, the same series (and lock) goods inward uses."""
    db.execute(text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"), {"key": f"document:{plant_uuid}:AT"})
    base = f"AT-{on_day.strftime('%y%m%d')}"
    taken = {
        code for (code,) in db.query(PaperReel.reel_code).filter(PaperReel.plant_id == plant_uuid, PaperReel.reel_code.like(f"{base}-%")).all()
    }
    for seq in range(1, 10000):
        candidate = f"{base}-{seq:03d}"
        if candidate not in taken:
            return candidate
    raise HTTPException(status_code=500, detail="No reel number is left for this day")


def _next_lot_no(db: Session, plant_id: str, item: ItemMaster, on_day: date) -> str:
    """RM-<item>-yymmdd-nnn dated the go-live date, the system lot number of the stores inward."""
    prefix = f"RM-{_token(item.item_code or item.name)}-{on_day.strftime('%y%m%d')}"
    db.execute(text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"), {"key": f"batch:{plant_id}:{prefix}"})
    taken = {
        code for (code,) in db.query(StockBatch.batch_no).filter(StockBatch.plant_id == str(plant_id), StockBatch.batch_no.like(f"{prefix}-%")).all()
    }
    for seq in range(1, 10000):
        candidate = f"{prefix}-{seq:03d}"
        if candidate not in taken:
            return candidate
    raise HTTPException(status_code=500, detail="No lot number is left for this day")


def document_no_for(request_id: Optional[uuid.UUID], effective_date: date) -> str:
    """The batch's document number. With a request key it is derived from it, so the same key always
    names the same batch and the unique (plant, document) key makes a repeated post a no-op."""
    tail = (request_id.hex[:8] if request_id else uuid.uuid4().hex[:8]).upper()
    return f"OS-{effective_date.strftime('%Y%m%d')}-{tail}"


# ---------------------------------------------------------------- post


def post_batch(db: Session, plant_id: str, payload: Any, actor: str) -> dict[str, Any]:
    """Post one opening batch, all or nothing. Returns the serialized batch (``idempotent`` when replayed)."""
    request_id = getattr(payload, "request_id", None)
    document_no = payload.document_no or document_no_for(request_id, payload.effective_date)

    def already_posted() -> Optional[dict[str, Any]]:
        existing = db.query(InventoryOpeningLoad).filter(
            InventoryOpeningLoad.plant_id == str(plant_id),
            InventoryOpeningLoad.document_no == document_no,
        ).first()
        if existing is None:
            return None
        if request_id is not None and not payload.document_no:
            if not same_rows(db, existing, payload.lines):
                # The first post went through (its answer was lost) and the rows were changed since: never
                # answer "already posted" for rows that were not posted (goods inward refuses a reused key too).
                raise request_changed(db, plant_id, existing)
            return {**serialize_batch(db, existing, ordinal=batch_ordinal(db, plant_id, existing), with_labels=True), "idempotent": True}
        raise HTTPException(status_code=400, detail="Opening load document already exists")

    replay = already_posted()
    if replay is not None:
        return replay

    # One opening post at a time per plant, so two first batches cannot fix two go-live dates.
    db.execute(text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"), {"key": f"opening-stock:{plant_id}"})
    # Look again under the lock: a second post with the same key (a second tab, a retry on a slow network)
    # waited here while the first one committed, so it answers with that batch instead of inserting again.
    replay = already_posted()
    if replay is not None:
        db.rollback()  # releases the advisory lock; nothing was written
        return replay
    refusal = date_refusal(db, plant_id, payload.effective_date)
    if refusal is not None:
        raise refusal
    checked = check_lines(db, plant_id, payload.lines)
    problems = [f"Row {row['index']}: {error['message']}" for row in checked["lines"] for error in row["errors"]]
    if problems:
        raise refuse(422, "OPENING_ROWS_INVALID", " ".join(problems[:5]) + (f" (+{len(problems) - 5} more)" if len(problems) > 5 else ""))

    go_live = payload.effective_date
    label = source_label(go_live)
    effective_at = ist_day_end_utc(go_live)
    plant_uuid = _plant_uuid(plant_id)
    default = default_receiving_location(db, plant_id, actor=actor)
    header = InventoryOpeningLoad(
        plant_id=str(plant_id), document_no=document_no, effective_date=go_live,
        notes=payload.notes, created_by=actor,
    )
    db.add(header)
    try:
        db.flush()
    except IntegrityError as exc:
        # Belt and braces next to the re-check above (e.g. READ COMMITTED snapshot edge cases): the same
        # document number was committed by another post, so a request key answers with that batch.
        db.rollback()
        replay = already_posted() if request_id is not None and not payload.document_no else None
        if replay is not None:
            return replay
        raise HTTPException(status_code=409, detail="Opening stock could not be posted because a number is already taken. Try again.") from exc
    items = {row.id: row for row in db.query(ItemMaster).filter(ItemMaster.id.in_([line.item_id for line in payload.lines])).all()}
    locations = {row.id: row for row in db.query(InventoryLocation).filter(InventoryLocation.plant_id == str(plant_id)).all()}
    response_lines: list[dict[str, Any]] = []
    for index, line in enumerate(payload.lines, start=1):
        item = items[line.item_id]
        location = locations.get(line.location_id) if line.location_id else default
        status = _line_status(line)
        hold_reason = _clean(line.hold_reason, 300) if status == ON_HOLD else None
        old_mark = _old_mark(line)
        vendor = _clean(line.vendor_name, 200)
        vendor_ref = _clean(line.vendor_ref, 120)
        unit_cost = float(line.unit_cost if line.unit_cost is not None else (item.unit_cost or 0.0))
        cost_source = (line.cost_source or ("MANUAL" if line.unit_cost is not None else (item.cost_source or "MANUAL"))).upper()
        if cost_source not in {source.value for source in CostSource}:
            cost_source = CostSource.MANUAL.value
        quality_meta, _ = initial_quality(item, plant_id, go_live)
        # Opening stock is already in use in the plant: no incoming QC unless it is put on hold.
        quality_meta["incoming_qc_task"] = {"status": "PENDING" if status == ON_HOLD else "NOT_REQUIRED", "source": "OPENING_LOAD"}
        meta = {
            **quality_meta,
            "source": "OPENING_LOAD",
            "source_label": label,
            # /scan and the labels show the inward reference; for opening stock that is the go-live load.
            "grn_no": label,
            "opening_load_id": str(header.id),
            "document_no": document_no,
            "go_live_date": go_live.isoformat(),
            "line_no": index,
            "old_mark": old_mark,
            "vendor_name": vendor,
            "vendor_ref": vendor_ref,
            "rate": unit_cost if unit_cost > 0 else None,
            "location_code": location.code if location else None,
            "hold_reason": hold_reason,
            "notes": line.notes,
        }
        if _line_kind(item) == "REEL":
            reel_code = _next_reel_code(db, plant_uuid, go_live)
            nominals = item.qc_nominals or {}
            form = (line.physical_form or ("COIL" if _enum(item.type) == ItemType.PARCHMENT.value else "REEL")).upper()
            reel = PaperReel(
                plant_id=plant_uuid, reel_code=reel_code, paper_id=item.id,
                gsm=nominals.get("gsm"), bf=nominals.get("bf"),
                supplier_name=vendor or label, supplier_name_snapshot=vendor or label,
                inward_weight_kg=line.qty, net_weight_kg=line.qty, current_weight_kg=line.qty,
                physical_form=form if form in {"REEL", "COIL"} else "REEL",
                source_reel_no=old_mark, vendor_batch_no=vendor_ref,
                unit_cost=unit_cost if unit_cost > 0 else None, cost_source=CostSource(cost_source),
                status=ReelStatus.IN_STOCK, stock_status=status, location_id=location.id if location else None,
                genealogy_metadata={
                    "source_document_type": "OPENING_LOAD", "opening_load_id": str(header.id),
                    "document_no": document_no, "line_no": index, "go_live_date": go_live.isoformat(), "source_label": label,
                },
                inward_metadata=meta, inward_date=go_live,
            )
            db.add(reel)
            db.flush()
            db.add(LotLabelRecord(plant_id=str(plant_id), reel_id=reel.id, label_code=reel_code, content_snapshot=reel_label_payload(reel, item)))
            db.add(ReelScanEvent(
                plant_id=plant_uuid, reel_id=reel.id, event_type=ReelScanEventType.INWARD_SCAN, source=ReelScanSource.INVENTORY,
                event_metadata={"source_document_type": "OPENING_LOAD", "document_no": document_no, "line_no": index,
                                "effective_date": go_live.isoformat(), "effective_at": effective_at.isoformat(), "at_no": reel_code},
            ))
            db.add(InventoryOpeningLoadLine(
                opening_load_id=header.id, item_id=item.id, reel_id=reel.id, reel_code=reel_code, qty=line.qty,
                location_id=reel.location_id, stock_status=status, unit_cost=unit_cost if unit_cost > 0 else None,
                notes=_line_note(old_mark, hold_reason, line.notes),
            ))
            response_lines.append({"item_code": item.item_code, "reel_code": reel_code, "qty": line.qty})
        else:
            batch_no = _next_lot_no(db, plant_id, item, go_live)
            batch = StockBatch(
                item_id=item.id, batch_no=batch_no, received_qty=line.qty,
                unit_cost=unit_cost if unit_cost > 0 else None, cost_source=cost_source,
                supplier_name_snapshot=vendor or label, location=location.code if location else None,
                location_id=location.id if location else None, stock_status=status, plant_id=str(plant_id),
                inward_metadata=meta,
            )
            db.add(batch)
            db.flush()
            batch.inward_metadata = {**meta, "saved_label": batch_label_payload(batch, item, inward_date=go_live)}
            db.add(StockTransaction(
                item_id=item.id, batch_id=batch.id, transaction_type=TransactionType.OPENING, qty_change=line.qty,
                reference_type=ReferenceType.INTERNAL, reference_id=header.id, plant_id=str(plant_id),
                location_id=batch.location_id, stock_status=status,
                movement_metadata={"source_document_type": "OPENING_LOAD", "source": SOURCE_WORD, "document_no": document_no,
                                   "line_no": index, "old_mark": old_mark, "notes": line.notes},
                external_ref=f"OPENING:{document_no}:{index}", effective_date=go_live, effective_at=effective_at,
            ))
            db.add(InventoryOpeningLoadLine(
                opening_load_id=header.id, item_id=item.id, batch_id=batch.id, batch_no=batch_no, qty=line.qty,
                location_id=batch.location_id, stock_status=status, unit_cost=unit_cost if unit_cost > 0 else None,
                notes=_line_note(old_mark, hold_reason, line.notes),
            ))
            response_lines.append({"item_code": item.item_code, "batch_no": batch_no, "qty": line.qty})
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        # The same request key raced in from a second click: the first one posted it.
        again = db.query(InventoryOpeningLoad).filter(
            InventoryOpeningLoad.plant_id == str(plant_id), InventoryOpeningLoad.document_no == document_no,
        ).first()
        if again is not None and request_id is not None:
            if not same_rows(db, again, payload.lines):
                raise request_changed(db, plant_id, again) from exc
            return {**serialize_batch(db, again, ordinal=batch_ordinal(db, plant_id, again), with_labels=True), "idempotent": True}
        raise HTTPException(status_code=409, detail="Opening stock could not be posted because a number is already taken. Try again.") from exc
    db.refresh(header)
    return {**serialize_batch(db, header, ordinal=batch_ordinal(db, plant_id, header), with_labels=True), "lines": response_lines, "idempotent": False}


def _row_key(item_id: Any, qty: Any, status: Any, mark: Any, vendor: Any, vendor_ref: Any) -> tuple:
    return (str(item_id), round(float(qty or 0.0), 3), str(status or CLEARED), str(mark or "").upper(), str(vendor or ""), str(vendor_ref or ""))


def same_rows(db: Session, header: InventoryOpeningLoad, lines: list[Any]) -> bool:
    """Whether a repeated post with the same request key carries the rows that batch posted.

    Compared as a set of rows (material, qty, cleared / on hold, old mark, vendor and ref); a location or
    rate is compared only when the repeat names one, because an empty one took the RM store / item rate.
    """
    posted = list(header.lines or [])
    if len(posted) != len(lines):
        return False
    reels, batches, _ = _lot_entities(db, posted)
    stored = []
    for line in posted:
        entity = reels.get(line.reel_id) if line.reel_id else batches.get(line.batch_id)
        meta = (entity.inward_metadata if entity is not None else None) or {}
        stored.append((
            _row_key(line.item_id, line.qty, line.stock_status, meta.get("old_mark"), meta.get("vendor_name"), meta.get("vendor_ref")),
            str(line.location_id) if line.location_id else None,
            round(float(line.unit_cost or 0.0), 4),
        ))
    wanted = []
    for line in lines:
        location = getattr(line, "location_id", None)
        rate = getattr(line, "unit_cost", None)
        wanted.append((
            _row_key(line.item_id, line.qty, _line_status(line), _old_mark(line), _clean(line.vendor_name, 200), _clean(line.vendor_ref, 120)),
            str(location) if location else None,
            round(float(rate), 4) if rate is not None else None,
        ))
    # Rows naming a place / rate first, so a row without one cannot take the match a stricter row needs.
    wanted.sort(key=lambda row: (row[1] is None, row[2] is None))
    for key, location, rate in wanted:
        match = next((index for index, (s_key, s_location, s_rate) in enumerate(stored)
                      if s_key == key and (location is None or location == s_location) and (rate is None or rate == s_rate)), None)
        if match is None:
            return False
        stored.pop(match)
    return True


def request_changed(db: Session, plant_id: str, header: InventoryOpeningLoad) -> HTTPException:
    ordinal = batch_ordinal(db, plant_id, header)
    count = len(header.lines or [])
    return refuse(
        409,
        "OPENING_REQUEST_CHANGED",
        f"These rows were not posted. This post already went through earlier as batch {ordinal} ({header.document_no}, "
        f"{count} row{'s' if count != 1 else ''}), and the rows have changed since. Check that batch below, "
        "then post only what is still missing.",
    )


def _line_note(old_mark: Optional[str], hold_reason: Optional[str], notes: Optional[str]) -> Optional[str]:
    parts = [f"Old mark {old_mark}" if old_mark else "", f"On hold: {hold_reason}" if hold_reason else "", notes or ""]
    joined = " · ".join(part for part in parts if part)
    return joined[:500] or None


# ---------------------------------------------------------------- read


def serialize_state(state: dict[str, Any]) -> dict[str, Any]:
    go_live = state.get("go_live_date")
    return {
        "state": state["state"],
        "go_live_date": go_live.isoformat() if go_live else None,
        "go_live_label": day_words(go_live) if go_live else None,
        "month_label": month_label(go_live) if go_live else None,
        "message": state.get("message"),
        "closed_reason": state.get("closed_reason"),
    }


def _lot_entities(db: Session, lines: Iterable[InventoryOpeningLoadLine]) -> tuple[dict, dict, dict]:
    lines = list(lines)
    reel_ids = [line.reel_id for line in lines if line.reel_id]
    batch_ids = [line.batch_id for line in lines if line.batch_id]
    reels = {row.id: row for row in db.query(PaperReel).filter(PaperReel.id.in_(reel_ids)).all()} if reel_ids else {}
    batches = {row.id: row for row in db.query(StockBatch).filter(StockBatch.id.in_(batch_ids)).all()} if batch_ids else {}
    return reels, batches, batch_balances(db, batch_ids)


def batch_labels(db: Session, header: InventoryOpeningLoad) -> list[dict[str, Any]]:
    """One label per reel / lot of a batch: the lot row the label component draws, plus the old mark."""
    lines = sorted(header.lines or [], key=lambda row: (row.created_at or datetime.min, str(row.id)))
    reels, batches, balances = _lot_entities(db, lines)
    items = {row.id: row for row in db.query(ItemMaster).filter(ItemMaster.id.in_([line.item_id for line in lines])).all()} if lines else {}
    locations = {str(row.id): row for row in db.query(InventoryLocation).filter(InventoryLocation.plant_id == str(header.plant_id)).all()}
    labels: list[dict[str, Any]] = []
    for line in lines:
        entity = reels.get(line.reel_id) if line.reel_id else batches.get(line.batch_id)
        if entity is None:
            continue
        item = items.get(line.item_id)
        qty = float(entity.current_weight_kg or 0.0) if line.reel_id else balances.get(str(entity.id), 0.0)
        row = lot_row(entity, item, qty, locations=locations)
        meta = entity.inward_metadata or {}
        payload = reel_label_payload(entity, item) if line.reel_id else batch_label_payload(entity, item, inward_date=header.effective_date)
        row.update({
            # The label prints the go-live date, not the day the batch was typed in.
            "created_at": header.effective_date.isoformat(),
            "in_since": header.effective_date.isoformat(),
            "posted_qty": round(float(line.qty or 0.0), 3),
            "old_mark": meta.get("old_mark"),
            "vendor_name": meta.get("vendor_name"),
            "vendor_ref": meta.get("vendor_ref"),
            "hold_reason": meta.get("hold_reason"),
            "rate": meta.get("rate"),
            "source_label": meta.get("source_label") or source_label(header.effective_date),
            "qr_value": payload["qr_value"],
            "scan_url": scan_url(payload["qr_value"]),
        })
        labels.append(row)
    return labels


def serialize_batch(db: Session, header: InventoryOpeningLoad, *, ordinal: Optional[int] = None, with_labels: bool = False) -> dict[str, Any]:
    lines = list(header.lines or [])
    items = {row.id: row for row in db.query(ItemMaster).filter(ItemMaster.id.in_([line.item_id for line in lines])).all()} if lines else {}
    units: dict[str, float] = defaultdict(float)
    per_item: dict[tuple[str, str], dict[str, Any]] = {}
    value = 0.0
    reels = lots = held = 0
    for line in lines:
        item = items.get(line.item_id)
        uom = "KG" if line.reel_id else (_enum(item.uom) if item else "KG")
        qty = round(float(line.qty or 0.0), 3)
        units[uom] = round(units[uom] + qty, 3)
        key = (str(line.item_id), uom)
        entry = per_item.setdefault(key, {"item_id": str(line.item_id), "item_code": getattr(item, "item_code", None), "item_name": getattr(item, "name", None), "uom": uom, "qty": 0.0, "reels": 0, "lots": 0})
        entry["qty"] = round(entry["qty"] + qty, 3)
        entry["reels" if line.reel_id else "lots"] += 1
        reels += 1 if line.reel_id else 0
        lots += 0 if line.reel_id else 1
        held += 1 if line.stock_status == ON_HOLD else 0
        value += qty * float(line.unit_cost or 0.0)
    data = {
        "id": str(header.id),
        "plant_id": header.plant_id,
        "document_no": header.document_no,
        "batch_no": ordinal,
        "effective_date": header.effective_date.isoformat(),
        "status": header.status,
        "notes": header.notes,
        "created_by": header.created_by,
        "created_at": header.created_at.isoformat() if header.created_at else None,
        "line_count": len(lines),
        "reel_count": reels,
        "lot_count": lots,
        "held_count": held,
        "total_qty": round(sum(float(line.qty or 0.0) for line in lines), 3),
        "units": [{"uom": uom, "qty": qty} for uom, qty in sorted(units.items())],
        "items": sorted(per_item.values(), key=lambda row: (row["uom"], str(row["item_name"] or ""))),
        "value": round(value, 2),
        "source_label": source_label(header.effective_date),
    }
    if with_labels:
        data["labels"] = batch_labels(db, header)
    return data


def overview(db: Session, plant_id: str, *, can_post: bool) -> dict[str, Any]:
    """What is already posted: the go-live state, every batch (who and when) and the totals so far."""
    loads = stock_loads(db, plant_id)
    batches = [serialize_batch(db, header, ordinal=index) for index, header in enumerate(loads, start=1)]
    units: dict[str, float] = defaultdict(float)
    for batch in batches:
        for unit in batch["units"]:
            units[unit["uom"]] = round(units[unit["uom"]] + unit["qty"], 3)
    state = serialize_state(opening_state(db, plant_id))
    default = planned_default(db.query(InventoryLocation).filter(InventoryLocation.plant_id == str(plant_id)).all())
    return {
        "plant_id": str(plant_id),
        "opening": state,
        "today": ist_today().isoformat(),
        "can_post": bool(can_post) and state["state"] != "CLOSED",
        "default_location": location_brief(default),
        "batches": list(reversed(batches)),
        "totals": {
            "batches": len(batches),
            "reels": sum(batch["reel_count"] for batch in batches),
            "lots": sum(batch["lot_count"] for batch in batches),
            "held": sum(batch["held_count"] for batch in batches),
            "units": [{"uom": uom, "qty": qty} for uom, qty in sorted(units.items())],
            "value": round(sum(batch["value"] for batch in batches), 2),
        },
    }


def get_batch(db: Session, plant_id: str, load_id: uuid.UUID) -> InventoryOpeningLoad:
    header = db.query(InventoryOpeningLoad).filter(
        InventoryOpeningLoad.id == load_id, InventoryOpeningLoad.plant_id == str(plant_id),
    ).first()
    if header is None:
        raise HTTPException(status_code=404, detail="This opening stock batch is not in this plant.")
    return header


def batch_ordinal(db: Session, plant_id: str, header: InventoryOpeningLoad) -> Optional[int]:
    for index, row in enumerate(stock_loads(db, plant_id), start=1):
        if row.id == header.id:
            return index
    return None
