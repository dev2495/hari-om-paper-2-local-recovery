"""Stock counts by rack (spec 2.3, client 2026-10-28).

A count is an ``inventory_certifications`` row (the header) with one ``stock_count_locations`` row per
rack (plus an "Unassigned" bucket) and one ``stock_count_entries`` row per counted thing: a reel or coil,
a lot with its counted quantity, or loose stock of an item with no label.

  - SPOT counts happen any time (a few racks or items); one MONTH_END count per plant and month.
  - Any logged-in role starts a count, counts and submits; every line keeps who counted it and when.
  - Expected qty = the live book qty of the reel / lot at the moment it is counted. Marking a rack done
    turns every lot still expected there into a MISSING line (expected = live book then); a lot issued
    since the rack was started is "used during the count", never missing.
  - Only the Owner approves, sends back for a recount (with a note) or cancels (the creator may cancel
    a count still being counted). Approval, in one transaction and idempotent: moves lots found in the
    wrong place, posts one correction voucher with exact reel / lot lines (gains on a known lot add to
    that lot and keep its QC state; unknown or loose stock becomes a new lot ON QC HOLD), dates it on the
    approval day (MONTH_END: min(approval day, the month's last day)) and, for MONTH_END, makes the count
    the month's stock certificate (status CERTIFIED with per-item lines).
  - A reel the system says was issued but is found in the store is flagged; the Owner leaves it as used
    or adds it as new stock on QC hold. The issue is never reversed.
"""
from __future__ import annotations

import logging
import re
import uuid
from collections import defaultdict
from datetime import date, datetime, timedelta
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import case, func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import (
    InventoryCertification,
    InventoryCertificationLine,
    InventoryLocation,
    ItemMaster,
    PaperReel,
    PurchaseOrderRevisionLine,
    ReelIssue,
    ReelScanEvent,
    ReelScanEventType,
    ReelStatus,
    StockAdjustmentLine,
    StockAdjustmentVoucher,
    StockBatch,
    StockCountEntry,
    StockCountLocation,
    StockTransaction,
    TransactionType,
)
from ..services.books import assert_books_open, ist_day, ist_today, is_month_locked, locked_months, month_key, month_label, month_start, next_month, parse_month
from ..services.locations import default_receiving_location
from ..services.rm_calendar import _approved_rate_rows, default_rate
from ..services.stock_control import book_period, book_txn_day
from ..services.stock_lots import (
    NOT_COUNTED_TYPES,
    batch_balances,
    entity_qty,
    get_one_plant,
    location_brief,
    location_stock,
    lot_code,
    posted_since,
    resolve_lot,
    stock_summary_by_location,
)
from ..utils.audit_client import emit_audit_event
from ..utils.auth import get_current_plant, get_current_user, is_actual_owner, require_owner
from .stock_control import (
    LINE_STATUSES,
    _fiscal_year_label,
    _next_count_session_no,
    _post_adjustment_voucher,
    changed_items_payload,
    count_changes_after_approval,
    ist_day_end_utc,
    lock_voucher_numbers,
)
from .stock_moves import apply_move

_logger = logging.getLogger(__name__)

router = APIRouter(prefix="/inventory/counts", tags=["inventory-counts"])

# Racks of a count: every active store location; the production floor and the dispatch bay only when
# material sits there (it should not, but material that does is still counted, never left out of a count).
NOT_COUNTED_PURPOSES = {"WIP", "DISPATCH"}
# The month-end count of a running month opens in its last days (a count weeks before the month ends would
# become the month's certificate for good); a month that has ended can be counted any time until it closes.
MONTH_END_OPENS_DAYS = 3
OPEN_STATUSES = {"DRAFT", "SUBMITTED"}
DONE_STATUSES = {"APPROVED", "CERTIFIED"}
STATUS_WORDS = {
    "DRAFT": "Counting",
    "SUBMITTED": "Waiting for the Owner",
    "APPROVED": "Approved",
    "CERTIFIED": "Approved · month certificate",
    "CANCELLED": "Cancelled",
}
# Lines made by "Rack done" (not scanned by a person); they are rebuilt when a rack is counted again.
#   MISSING  on the rack when counting started, not scanned: written off on approval;
#   USED     issued to the floor during the count: consumed, nothing to post;
#   ARRIVED  came to the rack after counting started (a GRN or a put-away): not counted, never missing;
#   MOVED    on the rack when counting started, moved to another place before Rack done: not missing.
# A MISSING line whose lot was moved somewhere else later (it was plainly in store) also reads as MOVED:
# approval writes nothing off for it, so the review never counts it as a loss.
AUTO_STATUSES = {"MISSING", "USED", "ARRIVED", "MOVED"}
NOT_POSTED_STATUSES = {"USED", "ARRIVED", "MOVED"}
DECISIONS = {"LEAVE_AS_USED", "ADD_ON_QC_HOLD"}
MONTH_KEY = re.compile(r"\d{4}-(0[1-9]|1[0-2])")
_LOOKUP = object()  # "work it out" (vs a value the caller already has)


def _actor(current_user: dict) -> str:
    return str(current_user.get("actor_identity") or current_user.get("actual_sub") or current_user.get("sub") or "system")


def _iso(value: Any) -> Optional[str]:
    return value.isoformat() if value else None


def _day_text(value: Any) -> str:
    return value.strftime("%d %b %Y").lstrip("0") if value else ""


def _q(value: Any) -> float:
    return round(float(value or 0.0), 3)


def _plant_uuid(plant_id: str) -> uuid.UUID:
    return uuid.UUID(str(plant_id))


def _audit(current_user: dict, plant_id: str, count: InventoryCertification, event: str, summary: str) -> None:
    try:
        emit_audit_event(
            token=current_user.get("token", ""), event_type=event, entity_type="stock_count", entity_id=str(count.id),
            plant_id=str(plant_id), actor_role=str((current_user.get("roles") or ["?"])[0]), actor_email=current_user.get("sub"),
            summary=summary, payload={"count_no": count.count_session_no, "kind": count.kind, "status": count.status},
        )
    except Exception as exc:  # pragma: no cover - audit is best effort
        _logger.warning("audit emit failed for %s %s: %s", event, count.id, exc)


# ----------------------------------------------------------------------------------------------- loading


def _count(db: Session, plant_id: str, count_id: uuid.UUID, *, lock: bool = False) -> InventoryCertification:
    query = db.query(InventoryCertification).filter(
        InventoryCertification.id == count_id, InventoryCertification.plant_id == str(plant_id),
    )
    if lock:
        query = query.with_for_update()
    count = query.first()
    if count is None or not db.query(StockCountLocation.id).filter(StockCountLocation.count_id == count_id).first():
        raise HTTPException(status_code=404, detail={"code": "COUNT_NOT_FOUND", "message": "This count does not exist in this plant."})
    return count


def _racks(db: Session, count: InventoryCertification) -> list[StockCountLocation]:
    rows = db.query(StockCountLocation).filter(StockCountLocation.count_id == count.id).all()
    return sorted(rows, key=lambda rack: (rack.bucket == "UNASSIGNED", getattr(rack.inventory_location, "code", "") or ""))


def _rack_key(rack: StockCountLocation) -> str:
    return str(rack.location_id) if rack.location_id else "unassigned"


def _rack(db: Session, count: InventoryCertification, key: str, *, lock: bool = False) -> StockCountLocation:
    query = db.query(StockCountLocation).filter(StockCountLocation.count_id == count.id)
    if str(key).lower() == "unassigned":
        query = query.filter(StockCountLocation.bucket == "UNASSIGNED")
    else:
        try:
            query = query.filter(StockCountLocation.location_id == uuid.UUID(str(key)))
        except ValueError:
            raise HTTPException(status_code=404, detail={"code": "RACK_NOT_IN_COUNT", "message": "That rack is not part of this count."}) from None
    if lock:
        query = query.with_for_update()
    rack = query.first()
    if rack is None:
        raise HTTPException(status_code=404, detail={"code": "RACK_NOT_IN_COUNT", "message": "That rack is not part of this count."})
    return rack


def _scope_items(count: InventoryCertification) -> list[str]:
    return [str(value) for value in (count.scope_item_ids or []) if value]


def _expected(db: Session, plant_id: str, count: InventoryCertification, rack: StockCountLocation) -> list[dict[str, Any]]:
    stock = location_stock(db, plant_id, rack.location_id, materials_only=True, item_ids=_scope_items(count) or None)
    return [*stock["reels"], *stock["lots"]]


def _arrived_late(row: dict[str, Any], rack: StockCountLocation) -> bool:
    """A lot that came to this rack after counting on it started (a GRN or a put-away): not to be found."""
    since = rack.started_at
    here = row.get("here_since")
    if since is None or not here:
        return False
    try:
        return datetime.fromisoformat(str(here)) > since
    except ValueError:
        return False


def _to_find(db: Session, plant_id: str, count: InventoryCertification, rack: StockCountLocation, counted_ids: set) -> int:
    return sum(1 for row in _expected(db, plant_id, count, rack) if row["id"] not in counted_ids and not _arrived_late(row, rack))


def _line_rate(db: Session, plant_id: str, item: Any, entity: Any = None, known: Any = None) -> float:
    """Rate for a count line's value: the lot's own cost, else the item's, else the last Owner-approved PO
    rate for the item (any vendor), else the RM costing base rate. A lot from a GRN whose invoice is still
    pending has no cost of its own; 0 means "value not known" and is shown as such (checker 2026-10-28)."""
    rate = float(known or getattr(entity, "unit_cost", None) or getattr(item, "unit_cost", None) or 0.0)
    if rate > 0 or item is None:
        return rate
    try:
        last = _approved_rate_rows(db, str(plant_id)).filter(PurchaseOrderRevisionLine.item_id == item.id).first()
        if last and float(last[3] or 0) > 0:
            return float(last[3])
        return float(default_rate(db, str(plant_id), None, item.id)[0] or 0.0)
    except Exception:  # pragma: no cover - a rate lookup never stops a count
        _logger.warning("count line rate lookup failed for item %s", getattr(item, "id", None), exc_info=True)
        return 0.0


def _entries(db: Session, count: InventoryCertification) -> list[StockCountEntry]:
    return db.query(StockCountEntry).filter(StockCountEntry.count_id == count.id).order_by(StockCountEntry.counted_at.asc().nullsfirst(), StockCountEntry.created_at.asc()).all()


def _entity(db: Session, entry: StockCountEntry):
    if entry.entity_type == "REEL" and entry.reel_id:
        return "REEL", db.get(PaperReel, entry.reel_id)
    if entry.entity_type == "BATCH" and entry.batch_id:
        return "BATCH", db.get(StockBatch, entry.batch_id)
    return "LOOSE", None


# ------------------------------------------------------------------------------------------- serializing


RESULT_WORDS = {
    "FOUND": ("emerald", "Found"),
    "WRONG_PLACE": ("amber", "In the wrong place"),
    "EXTRA": ("blue", "Extra stock"),
    "ISSUED_FOUND": ("rose", "Issued, but found in store"),
    "MISSING": ("rose", "Not found"),
    "USED": ("slate", "Used during the count"),
    "ARRIVED": ("slate", "Arrived during the count"),
    "MOVED": ("slate", "Moved away during the count"),
}
FLAG_WORDS = {
    "ISSUED_AFTER_COUNT": "Issued after it was counted",
    "RECEIVED_AFTER_COUNT": "Received after it was counted",
    "ISSUED_DURING_COUNT": "Issued during the count",
    "RECEIVED_DURING_COUNT": "Received during the count",
    "MOVED_AFTER_COUNT": "Moved to another place after it was counted",
    "MOVED_DURING_COUNT": "Moved to another place during the count",
}


def _entry_view(entry: StockCountEntry, items: dict[str, ItemMaster], locations: dict[str, InventoryLocation], lots: dict[str, Any], flags: dict[str, str],
                places: Optional[dict[str, Any]] = None) -> dict[str, Any]:
    """One count line for the pages. ``places``: {lot id: location id} where moved lots were when an approved
    count was approved, so its record keeps naming that place after later moves."""
    item = items.get(str(entry.item_id))
    lot = lots.get(str(entry.reel_id or entry.batch_id)) if (entry.reel_id or entry.batch_id) else None
    location = locations.get(str(entry.location_id)) if entry.location_id else None
    expected_location = locations.get(str(entry.expected_location_id)) if entry.expected_location_id else None
    status = entry.status
    # A lot that had no location and was counted on a rack is found (filed there on approval), never
    # "in the wrong place" (older counts saved it as WRONG_PLACE).
    filed_here = status in {"FOUND", "WRONG_PLACE"} and entry.location_id is not None and entry.expected_location_id is None and entry.entity_type != "LOOSE"
    if filed_here:
        status = "FOUND"
    tone, word = RESULT_WORDS.get(status, ("slate", status.title()))
    if filed_here:
        word = "Found · had no location"
    if entry.entity_type == "LOOSE":
        tone, word = "blue", "Loose stock, no label"
    flag = flags.get(str(entry.id)) or entry.movement_flag
    flag_word = FLAG_WORDS.get(flag or "")
    variance = _q(entry.variance_qty)
    if flag == "MOVED_AFTER_COUNT" and lot is not None:
        key = str(lot.id)
        place_id = places[key] if places is not None and key in places else lot.location_id
        now_at = locations.get(str(place_id)) if place_id else None
        place = (str(now_at.name or "").strip() or now_at.code) if now_at is not None else "no location"
        flag_word = f"Moved to {place} after it was counted · it stays there"
        if status == "MISSING" and not entry.adjustment_line_id:
            # Marked not found at Rack done, then moved somewhere else: it was in store, so approval writes
            # nothing off. It reads as moved (0 change), never as a loss in the lines or the totals.
            status = "MOVED"
            tone, word = RESULT_WORDS["MOVED"]
            word = "Not scanned here, then moved · not written off"
            flag_word = f"Moved to {place} after Rack done · it stays there, nothing written off"
            variance = 0.0
    unit_cost = float(entry.unit_cost or 0.0)
    return {
        "id": str(entry.id),
        "rack": str(entry.location_id) if entry.location_id else "unassigned",
        "entity_type": entry.entity_type,
        "entity_id": str(entry.reel_id or entry.batch_id) if (entry.reel_id or entry.batch_id) else None,
        "code": lot_code(lot) if lot is not None else (entry.scan_code or None),
        "item_id": str(entry.item_id),
        "item_code": getattr(item, "item_code", None),
        "item_name": getattr(item, "name", None),
        "item_type": str(getattr(getattr(item, "type", None), "value", "") or ""),
        "uom": entry.uom or "KG",
        "stock_status": getattr(lot, "stock_status", None) if lot is not None else ("QC_HOLD" if entry.entity_type == "LOOSE" else None),
        "status": status,
        "filed_here": filed_here,
        "result_word": word,
        "tone": tone,
        "expected_qty": _q(entry.expected_qty),
        "counted_qty": _q(entry.counted_qty) if entry.counted_qty is not None else None,
        "variance_qty": variance,
        # No rate for a line that changes stock = "value not known", never a silent ₹0.
        "value": round(variance * unit_cost, 2) if unit_cost > 0 or abs(variance) <= 0.0005 else None,
        "value_known": unit_cost > 0 or abs(variance) <= 0.0005,
        "unit_cost": round(unit_cost, 4),
        "location_code": location.code if location else None,
        "location_name": (str(location.name or "").strip() or location.code) if location else None,
        "expected_location_code": expected_location.code if expected_location else None,
        "movement_flag": flag,
        "movement_word": flag_word,
        "decision": entry.decision,
        "decided_by": entry.decided_by,
        "note": entry.note,
        "counted_by": entry.counted_by,
        "counted_at": _iso(entry.counted_at),
        "auto": entry.status in AUTO_STATUSES and not entry.client_ref,
        "adjustment_line_id": str(entry.adjustment_line_id) if entry.adjustment_line_id else None,
        "created_lot_id": str(entry.created_reel_id or entry.created_batch_id) if (entry.created_reel_id or entry.created_batch_id) else None,
        "created_lot_type": "REEL" if entry.created_reel_id else "BATCH" if entry.created_batch_id else None,
        "created_lot_code": lot_code(created) if (created := lots.get(str(entry.created_reel_id or entry.created_batch_id))) is not None else None,
    }


def _lookups(db: Session, plant_id: str, entries: list[StockCountEntry]):
    item_ids = {entry.item_id for entry in entries}
    items = {str(row.id): row for row in db.query(ItemMaster).filter(ItemMaster.id.in_(item_ids)).all()} if item_ids else {}
    locations = {str(row.id): row for row in db.query(InventoryLocation).filter(InventoryLocation.plant_id == str(plant_id)).all()}
    reel_ids = [entry.reel_id for entry in entries if entry.reel_id] + [entry.created_reel_id for entry in entries if entry.created_reel_id]
    batch_ids = [entry.batch_id for entry in entries if entry.batch_id] + [entry.created_batch_id for entry in entries if entry.created_batch_id]
    lots: dict[str, Any] = {}
    if reel_ids:
        lots.update({str(row.id): row for row in db.query(PaperReel).filter(PaperReel.id.in_(reel_ids)).all()})
    if batch_ids:
        lots.update({str(row.id): row for row in db.query(StockBatch).filter(StockBatch.id.in_(batch_ids)).all()})
    return items, locations, lots


def _moved_after_count(db: Session, entries: list[StockCountEntry]) -> dict[str, Any]:
    """Counted reels / lots that really went to another place after they were counted (a scan move, a
    put-away, another count or correction filing them): {entry id: where the lot is now (location id or
    None)}. Approval leaves these where they are now and the review flags them; moving one back to the rack
    it was counted on would undo a real move (checker 2026-10-30).

    A move is seen two ways: a move record after the line was counted (a reel's move event, a lot's 0-qty
    MOVE row), or the lot's place in the book now differing from its place when it was counted."""
    counted = [entry for entry in entries if entry.status in {"FOUND", "WRONG_PLACE", "EXTRA", "MISSING"} and entry.counted_at and entry.entity_type != "LOOSE"]
    reel_entries = {entry.reel_id: entry for entry in counted if entry.reel_id}
    batch_entries = {entry.batch_id: entry for entry in counted if entry.batch_id}
    moved: set[str] = set()
    places: dict[str, Any] = {}
    if reel_entries:
        since = min(entry.counted_at for entry in reel_entries.values())
        for reel_id, at, metadata in db.query(ReelScanEvent.reel_id, ReelScanEvent.timestamp, ReelScanEvent.event_metadata).filter(
            ReelScanEvent.reel_id.in_(list(reel_entries)), ReelScanEvent.event_type == ReelScanEventType.MOVE_SCAN, ReelScanEvent.timestamp > since,
        ).all():
            entry = reel_entries.get(reel_id)
            # Correction and supplier-return events share the event type; only a move names where it went.
            if entry is not None and at and at > entry.counted_at and "to_location_id" in (metadata or {}):
                moved.add(str(entry.id))
        for reel_id, location_id in db.query(PaperReel.id, PaperReel.location_id).filter(PaperReel.id.in_(list(reel_entries))).all():
            places[str(reel_id)] = location_id
    if batch_entries:
        since = min(entry.counted_at for entry in batch_entries.values())
        for batch_id, at in db.query(StockTransaction.batch_id, StockTransaction.created_at).filter(
            StockTransaction.batch_id.in_(list(batch_entries)), StockTransaction.transaction_type == TransactionType.MOVE,
            StockTransaction.qty_change == 0, StockTransaction.created_at > since,
        ).all():
            entry = batch_entries.get(batch_id)
            if entry is not None and at and at > entry.counted_at:
                moved.add(str(entry.id))
        for batch_id, location_id in db.query(StockBatch.id, StockBatch.location_id).filter(StockBatch.id.in_(list(batch_entries))).all():
            places[str(batch_id)] = location_id
    out: dict[str, Any] = {}
    for entry in counted:
        key = str(entry.reel_id or entry.batch_id)
        if key not in places:
            continue
        now_at = places[key]
        if (str(entry.id) in moved or now_at != entry.expected_location_id) and now_at != entry.location_id:
            out[str(entry.id)] = now_at
    return out


def _places_when_approved(db: Session, count: InventoryCertification, entries: list[StockCountEntry]) -> dict[str, Any]:
    """{lot id: location id} for lines flagged "moved after it was counted" on an approved count: the place
    named by the lot's last move record up to the approval (a reel's MOVE_SCAN event, a lot's 0-qty MOVE
    row). A move after the approval never changes what the approved record says (checker 2026-10-30)."""
    at = count.approved_at
    flagged = [entry for entry in entries if entry.movement_flag == "MOVED_AFTER_COUNT" and (entry.reel_id or entry.batch_id)]
    if at is None or not flagged:
        return {}
    places: dict[str, Any] = {}
    reel_ids = [entry.reel_id for entry in flagged if entry.reel_id]
    batch_ids = [entry.batch_id for entry in flagged if entry.batch_id]
    if reel_ids:
        rows = db.query(ReelScanEvent.reel_id, ReelScanEvent.timestamp, ReelScanEvent.event_metadata).filter(
            ReelScanEvent.reel_id.in_(reel_ids), ReelScanEvent.event_type == ReelScanEventType.MOVE_SCAN, ReelScanEvent.timestamp <= at,
        ).order_by(ReelScanEvent.timestamp.asc()).all()
        for reel_id, _at, metadata in rows:
            if "to_location_id" in (metadata or {}):
                value = (metadata or {}).get("to_location_id")
                places[str(reel_id)] = uuid.UUID(str(value)) if value else None
    if batch_ids:
        rows = db.query(StockTransaction.batch_id, StockTransaction.location_id).filter(
            StockTransaction.batch_id.in_(batch_ids), StockTransaction.transaction_type == TransactionType.MOVE,
            StockTransaction.qty_change == 0, StockTransaction.created_at <= at,
        ).order_by(StockTransaction.created_at.asc()).all()
        for batch_id, location_id in rows:
            places[str(batch_id)] = location_id
    return places


def _movement_flags(db: Session, entries: list[StockCountEntry], moved: Optional[dict[str, Any]] = None) -> dict[str, str]:
    """Label lots that moved after they were counted (the floor never stops during a count): issued,
    received, or put in another place."""
    flags: dict[str, str] = {}
    counted = [entry for entry in entries if entry.status in {"FOUND", "WRONG_PLACE", "MISSING"} and entry.counted_at]
    reel_entries = {entry.reel_id: entry for entry in counted if entry.reel_id}
    batch_entries = {entry.batch_id: entry for entry in counted if entry.batch_id}
    if reel_entries:
        for issue in db.query(ReelIssue).filter(ReelIssue.reel_id.in_(list(reel_entries))).all():
            entry = reel_entries.get(issue.reel_id)
            if entry is not None and issue.created_at and issue.created_at > entry.counted_at:
                flags[str(entry.id)] = "ISSUED_AFTER_COUNT"
    if batch_entries:
        rows = db.query(StockTransaction.batch_id, StockTransaction.transaction_type, StockTransaction.qty_change, StockTransaction.created_at).filter(
            StockTransaction.batch_id.in_(list(batch_entries)),
        ).all()
        for batch_id, kind, qty, created_at in rows:
            entry = batch_entries.get(batch_id)
            if entry is None or not created_at or created_at <= entry.counted_at:
                continue
            kind_value = str(getattr(kind, "value", kind))
            if kind_value in {TransactionType.ISSUE_PRODUCTION.value} or (kind_value == TransactionType.MOVE.value and float(qty or 0) < 0):
                flags[str(entry.id)] = "ISSUED_AFTER_COUNT"
            elif kind_value == TransactionType.INWARD.value and float(qty or 0) > 0 and str(entry.id) not in flags:
                flags[str(entry.id)] = "RECEIVED_AFTER_COUNT"
    for entry_id in (moved if moved is not None else _moved_after_count(db, entries)):
        if flags.get(entry_id) != "ISSUED_AFTER_COUNT":
            flags[entry_id] = "MOVED_AFTER_COUNT"
    return flags


def _summary(views: list[dict[str, Any]]) -> dict[str, Any]:
    counts: dict[str, int] = defaultdict(int)
    by_unit: dict[str, dict[str, float]] = defaultdict(lambda: {"gain": 0.0, "loss": 0.0})
    gain_value = loss_value = 0.0
    unpriced: dict[str, dict[str, Any]] = defaultdict(lambda: {"lines": 0, "gain": 0.0, "loss": 0.0})
    for view in views:
        key = "LOOSE" if view["entity_type"] == "LOOSE" else view["status"]
        counts[key] += 1
        if view["status"] == "FOUND" and abs(view["variance_qty"]) > 0.0005:
            counts["QTY_DIFFERENT"] += 1
        if view["filed_here"]:
            counts["FILED"] += 1
        variance = view["variance_qty"]
        if view["status"] in NOT_POSTED_STATUSES or (view["status"] == "ISSUED_FOUND" and view["decision"] != "ADD_ON_QC_HOLD"):
            continue
        if view["value"] is None and abs(variance) > 0.0005:
            row = unpriced[view["uom"]]
            row["lines"] += 1
            row["gain" if variance > 0 else "loss"] += variance
        if variance > 0:
            by_unit[view["uom"]]["gain"] += variance
            gain_value += view["value"] or 0.0
        elif variance < 0:
            by_unit[view["uom"]]["loss"] += variance
            loss_value += view["value"] or 0.0
    return {
        "found": counts["FOUND"], "missing": counts["MISSING"], "extra": counts["EXTRA"], "wrong_place": counts["WRONG_PLACE"],
        "issued_found": counts["ISSUED_FOUND"], "loose": counts["LOOSE"], "used": counts["USED"], "arrived": counts["ARRIVED"],
        "moved": counts["MOVED"],
        "qty_different": counts["QTY_DIFFERENT"], "filed": counts["FILED"],
        "lines": len(views),
        "gain_value": round(gain_value, 2), "loss_value": round(loss_value, 2), "net_value": round(gain_value + loss_value, 2),
        "by_unit": [{"uom": uom, "gain": _q(row["gain"]), "loss": _q(row["loss"]), "net": _q(row["gain"] + row["loss"])} for uom, row in sorted(by_unit.items())],
        "undecided": sum(1 for view in views if view["status"] == "ISSUED_FOUND" and not view["decision"]),
        # Lines that change stock but have no rate: the rupee figures above leave them out.
        "unpriced_lines": sum(row["lines"] for row in unpriced.values()),
        "unpriced_by_unit": [{"uom": uom, "lines": row["lines"], "gain": _q(row["gain"]), "loss": _q(row["loss"])} for uom, row in sorted(unpriced.items())],
    }


def _rack_progress(rack: StockCountLocation, views: list[dict[str, Any]], to_find: Optional[int]) -> dict[str, Any]:
    """One definition of the numbers for the rack tile, the rack page and the count summary:
    found (as the book says or filed here), wrong place (belongs to another rack), extra (a known lot the
    book had used up, or stock without a label), issued but found, not found, used / arrived during the
    count; expected = found + not found + still to find."""
    here = [view for view in views if view["rack"] == _rack_key(rack)]
    found = sum(1 for view in here if view["status"] == "FOUND")
    missing = sum(1 for view in here if view["status"] == "MISSING")
    return {
        "found": found,
        "wrong_place": sum(1 for view in here if view["status"] == "WRONG_PLACE"),
        "extra": sum(1 for view in here if view["status"] == "EXTRA"),
        "issued_found": sum(1 for view in here if view["status"] == "ISSUED_FOUND"),
        "missing": missing,
        "used": sum(1 for view in here if view["status"] == "USED"),
        "arrived": sum(1 for view in here if view["status"] == "ARRIVED"),
        "moved": sum(1 for view in here if view["status"] == "MOVED"),
        "to_find": to_find if to_find is not None else 0,
        "expected": found + missing + (to_find or 0),
        "scanned": sum(1 for view in here if not view["auto"]),
    }


def _rack_view(rack: StockCountLocation, views: list[dict[str, Any]], to_find: Optional[int]) -> dict[str, Any]:
    location = rack.inventory_location
    return {
        "key": _rack_key(rack),
        "id": str(rack.id),
        "bucket": rack.bucket,
        "location": location_brief(location),
        "label": location.code if location else "Not in any location",
        "name": (str(location.name or "").strip() or location.code) if location else "Stock with no location yet",
        "status": rack.status,
        "counted_by": rack.counted_by,
        "started_by": rack.started_by,
        "started_at": _iso(rack.started_at),
        "done_by": rack.done_by,
        "done_at": _iso(rack.done_at),
        "recount_note": rack.recount_note,
        "progress": _rack_progress(rack, views, to_find),
    }


def _header_view(count: InventoryCertification, racks: list[StockCountLocation]) -> dict[str, Any]:
    done = sum(1 for rack in racks if rack.status == "DONE")
    month = count.month
    return {
        "id": str(count.id),
        "plant_id": count.plant_id,
        "count_no": count.count_session_no,
        "kind": count.kind,
        "kind_word": f"Month-end count · {month_label(month)}" if count.kind == "MONTH_END" and month else "Spot count",
        "month": month_key(month) if month else None,
        "month_label": month_label(month) if month else None,
        "status": count.status,
        "status_word": STATUS_WORDS.get(count.status, count.status.title()),
        "period_start": _iso(count.period_start),
        "period_end": _iso(count.period_end),
        "scope_item_ids": _scope_items(count),
        "scope_location_ids": [str(value) for value in (count.scope_location_ids or [])],
        "notes": count.notes,
        "created_by": count.created_by,
        "created_at": _iso(count.created_at),
        "counted_by": count.counted_by,
        "submitted_by": count.submitted_by,
        "submitted_at": _iso(count.submitted_at),
        "submit_note": count.submit_note,
        "approved_by": count.approved_by,
        "approved_at": _iso(count.approved_at),
        "approve_note": count.approve_note,
        "sent_back_by": count.sent_back_by,
        "sent_back_at": _iso(count.sent_back_at),
        "sent_back_note": count.sent_back_note,
        "cancelled_by": count.cancelled_by,
        "cancelled_at": _iso(count.cancelled_at),
        "cancel_note": count.cancel_note,
        "racks_total": len(racks),
        "racks_done": done,
    }


def _can(count: InventoryCertification, current_user: dict) -> dict[str, bool]:
    from .locations import location_rights

    owner = is_actual_owner(current_user)
    rights = location_rights(current_user)
    counting = count.status == "DRAFT"
    return {
        "count": counting,
        "submit": counting,
        "approve": owner and count.status == "SUBMITTED",
        "send_back": owner and count.status == "SUBMITTED",
        "decide": owner and count.status == "SUBMITTED",
        "cancel": count.status in OPEN_STATUSES and (owner or (counting and _actor(current_user) == count.created_by)),
        # The same people the lot-label sheet lets print (spec 2.8: a button only for who may use it).
        "print_labels": bool(rights["manage"] or rights["move"]),
    }


def _detail(db: Session, plant_id: str, count: InventoryCertification, current_user: dict, *, with_entries: bool = True) -> dict[str, Any]:
    racks = _racks(db, count)
    entries = _entries(db, count)
    items, locations, lots = _lookups(db, plant_id, entries)
    flags = _movement_flags(db, entries) if count.status in OPEN_STATUSES else {}
    places = _places_when_approved(db, count, entries) if count.status in DONE_STATUSES else None
    views = [_entry_view(entry, items, locations, lots, flags, places) for entry in entries]
    counted_ids = {view["entity_id"] for view in views if view["entity_id"]}
    rack_views = []
    for rack in racks:
        to_find = None
        if count.status == "DRAFT" and rack.status != "DONE":
            to_find = _to_find(db, plant_id, count, rack, counted_ids)
        rack_views.append(_rack_view(rack, views, to_find))
    vouchers = db.query(StockAdjustmentVoucher).filter(
        StockAdjustmentVoucher.count_id == count.id, StockAdjustmentVoucher.status != "CANCELLED",
    ).order_by(StockAdjustmentVoucher.effective_date.asc(), StockAdjustmentVoucher.created_at.asc()).all()
    voucher_views = [
        {"id": str(row.id), "voucher_no": row.voucher_no, "status": row.status, "effective_date": _iso(row.effective_date), "line_count": len(row.lines or [])}
        for row in vouchers
    ]
    payload = {
        **_header_view(count, racks),
        "racks": rack_views,
        "summary": _summary(views),
        "counters": sorted({view["counted_by"] for view in views if view["counted_by"] and not view["auto"]}),
        "voucher": voucher_views[0] if voucher_views else None,
        # A month-end count approved after the month ended: lines on lots received after the month end go on a
        # second voucher dated the approval day (stock is never changed before a lot existed).
        "vouchers": voucher_views,
        "can": _can(count, current_user),
        # A month-end count waiting while a later month got closed: approving is refused (it would change that
        # closed month); the Owner sees why and may send it back or cancel it.
        "approve_refusal": None,
    }
    if count.status == "SUBMITTED":
        refusal = _later_month_closed(db, plant_id, count)
        if refusal:
            payload["approve_refusal"] = refusal["message"]
            payload["can"]["approve"] = False
            payload["can"]["decide"] = False
    if with_entries:
        payload["entries"] = views
        # An approved month-end count whose month got back-dated stock entries afterwards: the certificate
        # no longer matches the book for these items (flag, not a block: spec 0.3).
        payload["changed_after_count"] = changed_items_payload(db, plant_id, count_changes_after_approval(db, plant_id, count))
    return payload


# ------------------------------------------------------------------------------------------------ create


class CountCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: str = "SPOT"
    month: Optional[str] = None
    location_ids: list[uuid.UUID] = Field(default_factory=list)
    item_ids: list[uuid.UUID] = Field(default_factory=list)
    include_unassigned: bool = False
    # From a rack page: join an open count that has this rack instead of starting another.
    join_open: bool = False
    note: Optional[str] = Field(default=None, max_length=500)


def _countable_locations(db: Session, plant_id: str) -> list[InventoryLocation]:
    rows = db.query(InventoryLocation).filter(InventoryLocation.plant_id == str(plant_id), InventoryLocation.active == "true").order_by(InventoryLocation.code.asc()).all()
    holding: Optional[set[str]] = None
    out = []
    for row in rows:
        if str(row.purpose or "").upper() not in NOT_COUNTED_PURPOSES:
            out.append(row)
            continue
        if holding is None:
            holding = {key for key, value in stock_summary_by_location(db, plant_id, materials_only=True).items() if key and (value["reels"] or value["lots"])}
        if str(row.id) in holding:
            out.append(row)
    return out


def _first_stock_month(db: Session, plant_id: str) -> Optional[date]:
    """The month the plant's stock book starts: its first receipt, opening load or issue (count and
    correction postings alone do not start a book)."""
    days: list[date] = []
    # created_at is naive UTC: a row with no effective date belongs to its IST day (00:00–05:29 IST on the
    # 1st is still that month, never the month before).
    ist_created_day = func.date(func.timezone("Asia/Kolkata", func.timezone("UTC", StockTransaction.created_at)))
    first_txn = db.query(func.min(func.coalesce(StockTransaction.effective_date, ist_created_day))).filter(
        StockTransaction.plant_id == str(plant_id),
        ~StockTransaction.transaction_type.in_([TransactionType.ADJUSTMENT, TransactionType.MOVE]),
    ).scalar()
    if first_txn:
        days.append(first_txn if isinstance(first_txn, date) else date.fromisoformat(str(first_txn)[:10]))
    for inward_date, genealogy in db.query(PaperReel.inward_date, PaperReel.genealogy_metadata).filter(
        PaperReel.plant_id == _plant_uuid(plant_id), PaperReel.inward_date.isnot(None),
    ).order_by(PaperReel.inward_date.asc()).limit(200).all():
        source = str((genealogy or {}).get("source_document_type") or (genealogy or {}).get("source") or "").upper()
        if source != "STOCK_ADJUSTMENT":
            days.append(inward_date)
            break
    first_issue = db.query(func.min(ReelIssue.issue_date)).join(PaperReel, PaperReel.id == ReelIssue.reel_id).filter(PaperReel.plant_id == _plant_uuid(plant_id)).scalar()
    if first_issue:
        days.append(first_issue)
    return month_start(min(days)) if days else None


def _month_end_refusal(db: Session, plant_id: str, month: date, today: date, *, first: Any = _LOOKUP) -> Optional[tuple[int, str]]:
    """Why a month-end count of ``month`` cannot start now (status, plain words), or None.

    Closed months never change: a month that is closed, or that has a later closed month, is refused (its
    variance would be dated back into history). A month before the stock book starts has nothing to count,
    and the running month opens only in its last days.
    """
    current = month_start(today)
    label = month_label(month)
    if month > current:
        return 422, f"{label} has not started yet."
    locks = locked_months(db, plant_id)
    if month in locks:
        return 409, f"{label} is closed. Ask the owner to re-open it."
    later = [value for value in locks if value > month]
    if later:
        return 409, f"{month_label(max(later))} is already closed, so {label} can no longer be counted. Ask the owner to re-open {month_label(min(later))} first."
    first = _first_stock_month(db, plant_id) if first is _LOOKUP else first
    if first and month < first:
        return 409, f"The stock book starts in {month_label(first)}. There is nothing to count for {label}."
    opens = next_month(month) - timedelta(days=MONTH_END_OPENS_DAYS)
    if month == current and today < opens:
        return 409, f"The {label} month-end count opens on {_day_text(opens)}, in the last {MONTH_END_OPENS_DAYS} days of the month."
    return None


def _later_month_closed(db: Session, plant_id: str, count: InventoryCertification) -> Optional[dict[str, Any]]:
    """Why a month-end count cannot be approved now because a LATER month closed after it was started, or None.

    The start rule (``_month_end_refusal``) refuses such a count; one started earlier and approved after the
    later month closed would date its variance back under that closed month and change its frozen figures."""
    if count.kind != "MONTH_END" or not count.month:
        return None
    later = [value for value in locked_months(db, plant_id) if value > count.month]
    if not later:
        return None
    label = month_label(count.month)
    return {
        "code": "LATER_MONTH_CLOSED",
        "message": f"{month_label(max(later))} is already closed, so the {label} count can no longer change stock. "
                   f"Ask the owner to re-open {month_label(min(later))} first, or cancel this count.",
        "month": count.month.strftime("%Y-%m"),
    }


def _month_end_count(db: Session, plant_id: str, month: date) -> Optional[InventoryCertification]:
    return db.query(InventoryCertification).filter(
        InventoryCertification.plant_id == str(plant_id), InventoryCertification.kind == "MONTH_END",
        InventoryCertification.month == month, InventoryCertification.status != "CANCELLED",
    ).order_by(InventoryCertification.created_at.desc()).first()


def _month_end_target(db: Session, plant_id: str, today: date, *, first: Any = _LOOKUP) -> date:
    """The month the store should count at month end now: the oldest ended month (from the start of the
    stock book, after the last closed month) with no approved month-end count yet, else the running month."""
    current = month_start(today)
    locks = locked_months(db, plant_id)
    bounds = [value for value in [next_month(max(locks)) if locks else None, _first_stock_month(db, plant_id) if first is _LOOKUP else first] if value]
    cursor = min(max(bounds), current) if bounds else current
    while cursor < current:
        row = _month_end_count(db, plant_id, cursor)
        if cursor not in locks and (row is None or row.status not in DONE_STATUSES):
            return cursor
        cursor = next_month(cursor)
    return current


def _overlapping_count(db: Session, plant_id: str, location_ids: list[Any], unassigned: bool, item_ids: list[str], *, all_racks: bool = False) -> Optional[tuple[InventoryCertification, str]]:
    """An open count (counting or waiting for the Owner) that already covers one of these racks for the same
    materials, and the rack it shares: two open counts of one lot would both post their difference."""
    query = db.query(InventoryCertification, StockCountLocation).join(StockCountLocation, StockCountLocation.count_id == InventoryCertification.id).filter(
        InventoryCertification.plant_id == str(plant_id), InventoryCertification.status.in_(sorted(OPEN_STATUSES)),
    )
    wanted = {str(value) for value in location_ids}
    mine = set(item_ids)
    for other, rack in query.order_by(InventoryCertification.created_at.asc()).all():
        shares_rack = all_racks or (rack.bucket == "UNASSIGNED" and unassigned) or (rack.location_id is not None and str(rack.location_id) in wanted)
        if not shares_rack:
            continue
        theirs = set(_scope_items(other))
        if mine and theirs and not (mine & theirs):
            continue
        return other, (rack.inventory_location.code if rack.inventory_location else "stock with no location")
    return None


def _overlap_refusal(other: InventoryCertification, rack_label: str) -> HTTPException:
    what = f"the {month_label(other.month)} month-end count" if other.kind == "MONTH_END" and other.month else f"spot count {other.count_session_no}"
    state = "waiting for the Owner" if other.status == "SUBMITTED" else "still being counted"
    return HTTPException(status_code=409, detail={
        "code": "RACK_IN_OPEN_COUNT",
        "message": f"{rack_label} is already in {what}, which is {state}. Count it there, or finish that count first, so nothing is counted twice.",
        "count_id": str(other.id),
    })


def _list_progress(db: Session, counts: list[InventoryCertification]) -> dict[str, tuple[list[StockCountLocation], dict[str, int], set[str]]]:
    """Racks, line results and counters for many counts in three queries (never two per count)."""
    ids = [count.id for count in counts]
    out: dict[str, tuple[list[StockCountLocation], dict[str, int], set[str]]] = {str(value): ([], defaultdict(int), set()) for value in ids}
    if not ids:
        return out
    for rack in db.query(StockCountLocation).filter(StockCountLocation.count_id.in_(ids)).all():
        out[str(rack.count_id)][0].append(rack)
    # Lines that "had no location" (WRONG_PLACE with no expected place) read as found; grouped in SQL.
    filed = case((StockCountEntry.location_id.isnot(None) & StockCountEntry.expected_location_id.is_(None) & (StockCountEntry.entity_type != "LOOSE"), 1), else_=0)
    # A stored "not found" line whose lot was moved later posts nothing: it reads as moved, as on the review.
    shown = case(
        ((StockCountEntry.status == "MISSING") & (StockCountEntry.movement_flag == "MOVED_AFTER_COUNT") & StockCountEntry.adjustment_line_id.is_(None), "MOVED"),
        else_=StockCountEntry.status,
    )
    for count_id, status, total, filed_total in db.query(
        StockCountEntry.count_id, shown, func.count(StockCountEntry.id), func.sum(filed),
    ).filter(StockCountEntry.count_id.in_(ids)).group_by(StockCountEntry.count_id, shown).all():
        moved = int(filed_total or 0) if status == "WRONG_PLACE" else 0
        out[str(count_id)][1][status] += int(total or 0) - moved
        if moved:
            out[str(count_id)][1]["FOUND"] += moved
    for count_id, counted_by in db.query(StockCountEntry.count_id, StockCountEntry.counted_by).filter(
        StockCountEntry.count_id.in_(ids), StockCountEntry.counted_by.isnot(None), StockCountEntry.client_ref.isnot(None),
    ).distinct().all():
        out[str(count_id)][2].add(counted_by)
    return out


def _list_row(db: Session, count: InventoryCertification, progress: Optional[tuple[list[StockCountLocation], dict[str, int], set[str]]] = None) -> dict[str, Any]:
    racks, statuses, counters = progress if progress is not None else _list_progress(db, [count])[str(count.id)]
    return {
        **_header_view(count, racks),
        "racks_counting": sum(1 for rack in racks if rack.status == "COUNTING"),
        "lines": sum(statuses.values()),
        "found": statuses["FOUND"], "missing": statuses["MISSING"], "extra": statuses["EXTRA"],
        "issued_found": statuses["ISSUED_FOUND"], "wrong_place": statuses["WRONG_PLACE"],
        # Who scanned lines in this count (the person who started it is in created_by).
        "counters": sorted(counters),
    }


@router.get("")
def list_counts(
    status: Optional[str] = Query(default=None),
    kind: Optional[str] = Query(default=None),
    limit: int = Query(default=60, ge=1, le=200),
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_one_plant),
    current_user: dict = Depends(get_current_user),
    brief: bool = Query(default=False, description="Only id, kind, month and status of each count (no rack progress, no month-end cards)"),
):
    """Counts of the plant, newest first, with rack progress and who is counting (every role).

    ``brief=true`` is for callers that only need which counts exist (production's month-end pages): one query.
    """
    query = db.query(InventoryCertification).filter(
        InventoryCertification.plant_id == str(plant_id),
        InventoryCertification.id.in_(db.query(StockCountLocation.count_id)),
    )
    if status:
        wanted = [value.strip().upper() for value in status.split(",") if value.strip()]
        query = query.filter(InventoryCertification.status.in_(wanted))
    if kind:
        query = query.filter(InventoryCertification.kind == kind.strip().upper())
    rows = query.order_by(InventoryCertification.created_at.desc()).limit(limit).all()
    today = ist_today()
    if brief is True:
        return {
            "items": [
                {"id": str(row.id), "count_no": row.count_session_no, "kind": row.kind, "month": month_key(row.month) if row.month else None,
                 "status": row.status, "approved_by": row.approved_by, "approved_at": _iso(row.approved_at)}
                for row in rows
            ],
            "today": today.isoformat(),
        }
    first = _first_stock_month(db, plant_id)
    target = _month_end_target(db, plant_id, today, first=first)
    progress = _list_progress(db, rows)

    def month_state(month: date) -> dict[str, Any]:
        row = _month_end_count(db, plant_id, month)
        count = None
        if row is not None:
            row_progress = progress.get(str(row.id)) or _list_progress(db, [row])[str(row.id)]
            count = _list_row(db, row, row_progress) if row_progress[0] else None
        refusal = None if row is not None else _month_end_refusal(db, plant_id, month, today, first=first)
        return {
            "month": month_key(month), "month_label": month_label(month), "closed": is_month_locked(db, plant_id, month),
            "count": count, "can_start": row is None and refusal is None,
            "opens_on": (next_month(month) - timedelta(days=MONTH_END_OPENS_DAYS)).isoformat() if month == month_start(today) else None,
            "note": refusal[1] if refusal else None,
        }

    # One month-end card: the month the store should count now. The month before it is shown too while its
    # approved count waits for the Owner to close the month.
    states = [month_state(target)]
    before = month_start(target - timedelta(days=1))
    earlier = _month_end_count(db, plant_id, before)
    if earlier is not None and earlier.status != "CANCELLED" and not is_month_locked(db, plant_id, before) and before >= (first or before):
        states.insert(0, month_state(before))
    return {
        "items": [_list_row(db, row, progress[str(row.id)]) for row in rows],
        "month_end": states,
        "today": today.isoformat(),
    }


@router.post("")
def start_count(
    payload: CountCreate,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_one_plant),
    current_user: dict = Depends(get_current_user),
):
    """Start a SPOT or MONTH_END count (any logged-in role). A month-end count that already exists for the
    month is returned instead of a second one."""
    kind = str(payload.kind or "SPOT").strip().upper()
    if kind not in {"SPOT", "MONTH_END"}:
        raise HTTPException(status_code=422, detail="kind must be SPOT or MONTH_END")
    actor = _actor(current_user)
    today = ist_today()
    countable = _countable_locations(db, plant_id)
    by_id = {row.id: row for row in countable}

    if kind == "MONTH_END":
        if not payload.month:
            raise HTTPException(status_code=422, detail="Choose the month to count.")
        if not MONTH_KEY.fullmatch(payload.month.strip()):
            # "2026-5" or "2026-05-01" is not a month key; one spelling only, so every caller agrees.
            raise HTTPException(status_code=422, detail="Give the month as YYYY-MM, for example 2026-10.")
        month = parse_month(payload.month)
        existing = _month_end_count(db, plant_id, month)
        if existing is not None:
            if not db.query(StockCountLocation.id).filter(StockCountLocation.count_id == existing.id).first():
                raise HTTPException(status_code=409, detail=f"{month_label(month)} already has a stock certificate from the old count sheet.")
            return {**_detail(db, plant_id, existing, current_user, with_entries=False), "existing": True}
        refusal = _month_end_refusal(db, plant_id, month, today)
        if refusal:
            raise HTTPException(status_code=refusal[0], detail=refusal[1])
        locations = countable
        unassigned = True
        start, end = month, next_month(month) - timedelta(days=1)
        overlap = _overlapping_count(db, plant_id, [], True, [], all_racks=True)
        if overlap:
            raise _overlap_refusal(*overlap)
    else:
        month = None
        start = end = today
        wanted_locations = list(dict.fromkeys(payload.location_ids))
        for location_id in wanted_locations:
            if location_id not in by_id:
                raise HTTPException(status_code=404, detail="One of the racks is not an active store location of this plant.")
        if payload.join_open and len(wanted_locations) == 1:
            joined = db.query(InventoryCertification).join(StockCountLocation, StockCountLocation.count_id == InventoryCertification.id).filter(
                InventoryCertification.plant_id == str(plant_id), InventoryCertification.status == "DRAFT",
                StockCountLocation.location_id == wanted_locations[0],
            ).order_by(InventoryCertification.created_at.desc()).first()
            if joined is not None:
                return {**_detail(db, plant_id, joined, current_user, with_entries=False), "existing": True}
        if wanted_locations:
            locations = [by_id[location_id] for location_id in wanted_locations]
            unassigned = payload.include_unassigned
        elif payload.item_ids:
            stock_locations: set[Any] = set()
            unassigned = False
            for location in [*countable, None]:
                stock = location_stock(db, plant_id, location.id if location else None, materials_only=True, item_ids=payload.item_ids)
                if stock["reels"] or stock["lots"]:
                    if location is None:
                        unassigned = True
                    else:
                        stock_locations.add(location.id)
            locations = [row for row in countable if row.id in stock_locations]
            if not locations and not unassigned:
                raise HTTPException(status_code=409, detail="None of these materials is in store right now. Nothing to count.")
        else:
            locations, unassigned = countable, True
        if not locations and not unassigned:
            raise HTTPException(status_code=422, detail="Choose at least one rack.")
        overlap = _overlapping_count(db, plant_id, [row.id for row in locations], unassigned, [str(value) for value in payload.item_ids])
        if overlap:
            raise _overlap_refusal(*overlap)

    item_ids = [str(value) for value in dict.fromkeys(payload.item_ids)]
    if item_ids:
        found = {str(row.id) for row in db.query(ItemMaster.id).filter(ItemMaster.id.in_(item_ids), ItemMaster.plant_id == str(plant_id)).all()}
        if len(found) != len(item_ids):
            raise HTTPException(status_code=404, detail="One of the materials is not in this plant.")
    count = InventoryCertification(
        plant_id=str(plant_id),
        period_start=start,
        period_end=end,
        fiscal_year_label=_fiscal_year_label(end),
        status="DRAFT",
        count_state="DRAFT",
        count_session_no=_next_count_session_no(db, str(plant_id), today),
        count_location_scope=("All racks" if kind == "MONTH_END" else f"{len(locations)} rack{'s' if len(locations) != 1 else ''}" + (" + no location" if unassigned else ""))[:200],
        notes=payload.note,
        attachment_refs=[],
        created_by=actor,
        kind=kind,
        month=month,
        scope_location_ids=[] if kind == "MONTH_END" else [str(row.id) for row in locations],
        scope_item_ids=item_ids,
        updated_at=datetime.utcnow(),
    )
    try:
        db.add(count)
        db.flush()
        for location in locations:
            db.add(StockCountLocation(count_id=count.id, plant_id=str(plant_id), bucket="LOCATION", location_id=location.id, status="TODO"))
        if unassigned:
            db.add(StockCountLocation(count_id=count.id, plant_id=str(plant_id), bucket="UNASSIGNED", status="TODO"))
        db.commit()
    except IntegrityError:
        # Two people started the same month-end count at once: the first one wins, the second joins it.
        db.rollback()
        existing = _month_end_count(db, plant_id, month) if kind == "MONTH_END" and month else None
        if existing is None:
            raise
        return {**_detail(db, plant_id, existing, current_user, with_entries=False), "existing": True}
    db.refresh(count)
    _audit(current_user, plant_id, count, "stock_count_started", f"{'Month-end' if kind == 'MONTH_END' else 'Spot'} count {count.count_session_no} started")
    return {**_detail(db, plant_id, count, current_user, with_entries=False), "existing": False}


@router.get("/{count_id}")
def get_count(
    count_id: uuid.UUID,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_one_plant),
    current_user: dict = Depends(get_current_user),
):
    """The count hub: racks with progress and who counts them, every line with its result, and the totals."""
    return _detail(db, plant_id, _count(db, plant_id, count_id), current_user)


@router.get("/{count_id}/racks/{rack_key}")
def get_rack(
    count_id: uuid.UUID,
    rack_key: str,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_one_plant),
    current_user: dict = Depends(get_current_user),
):
    """One rack of a count: what the book expects there now (live) and what has been counted on it."""
    count = _count(db, plant_id, count_id)
    rack = _rack(db, count, rack_key)
    return _rack_payload(db, plant_id, count, rack, current_user)


def _rack_payload(db: Session, plant_id: str, count: InventoryCertification, rack: StockCountLocation, current_user: dict) -> dict[str, Any]:
    entries = _entries(db, count)
    items, locations, lots = _lookups(db, plant_id, entries)
    flags = _movement_flags(db, entries) if count.status in OPEN_STATUSES else {}
    places = _places_when_approved(db, count, entries) if count.status in DONE_STATUSES else None
    views = [_entry_view(entry, items, locations, lots, flags, places) for entry in entries]
    counted = {view["entity_id"]: view for view in views if view["entity_id"]}
    expected = []
    if count.status == "DRAFT" and rack.status != "DONE":
        for row in _expected(db, plant_id, count, rack):
            view = counted.get(row["id"])
            expected.append({**row, "entry_id": view["id"] if view else None, "counted_rack": view["rack"] if view else None,
                             "counted_qty": view["counted_qty"] if view else None,
                             # Came here after counting on this rack started: scan it if seen, never "not found".
                             "arrived_during_count": _arrived_late(row, rack)})
    here = [view for view in views if view["rack"] == _rack_key(rack)]
    to_find = sum(1 for row in expected if not row["entry_id"] and not row["arrived_during_count"]) if count.status == "DRAFT" and rack.status != "DONE" else None
    racks = _racks(db, count)
    return {
        "count": {**_header_view(count, racks), "can": _can(count, current_user)},
        "rack": _rack_view(rack, views, to_find),
        "expected": expected,
        "entries": list(reversed(here)),
        "other_racks": [
            {"key": _rack_key(row), "label": row.inventory_location.code if row.inventory_location else "Not in any location", "status": row.status}
            for row in racks if row.id != rack.id
        ],
    }


# -------------------------------------------------------------------------------------------- counting


def _require_counting(count: InventoryCertification) -> None:
    if count.status == "SUBMITTED":
        raise HTTPException(status_code=409, detail="Counting is locked: this count is waiting for the Owner.")
    if count.status != "DRAFT":
        raise HTTPException(status_code=409, detail=f"This count is {STATUS_WORDS.get(count.status, count.status).lower()}. Nothing more can be counted on it.")


def _open_rack(rack: StockCountLocation, actor: str) -> None:
    if rack.status == "DONE":
        raise HTTPException(status_code=409, detail="This rack is marked done. Re-open it to count more.")
    if rack.status in {"TODO", "RECOUNT"}:
        rack.status = "COUNTING"
        rack.started_by = rack.started_by or actor
        rack.started_at = rack.started_at or datetime.utcnow()
    names = [name for name in (rack.counted_by or "").split(", ") if name]
    if actor not in names:
        rack.counted_by = ", ".join([*names, actor])[:200]
    rack.updated_at = datetime.utcnow()


class ScanPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    rack: str = Field(min_length=1, max_length=80)
    code: str = Field(min_length=1, max_length=500)
    counted_qty: Optional[float] = Field(default=None, ge=0)
    client_ref: str = Field(min_length=4, max_length=120)
    note: Optional[str] = Field(default=None, max_length=500)


def _issue_of(db: Session, entity_type: str, entity: Any) -> Optional[dict[str, Any]]:
    """When the system says a lot went to the floor: the latest issue's date and weight."""
    if entity_type == "REEL":
        issue = db.query(ReelIssue).filter(ReelIssue.reel_id == entity.id).order_by(ReelIssue.created_at.desc()).first()
        if issue is None:
            return None
        return {"day": issue.issue_date, "qty": _q(issue.issued_weight_kg), "at": issue.created_at}
    row = db.query(StockTransaction).filter(
        StockTransaction.batch_id == entity.id,
        StockTransaction.transaction_type == TransactionType.ISSUE_PRODUCTION,
    ).order_by(StockTransaction.created_at.desc()).first()
    if row is None:
        return None
    return {"day": row.effective_date or (row.created_at.date() if row.created_at else None), "qty": abs(_q(row.qty_change)), "at": row.created_at}


def _result(view: dict[str, Any], *, repeat: bool = False) -> dict[str, Any]:
    status = view["status"]
    code = view["code"] or view["item_name"]
    qty = view["counted_qty"]
    unit = str(view["uom"] or "").lower()
    if repeat:
        return {"tone": "slate", "title": f"{code} already counted", "detail": f"{qty:g} {unit} on {view['location_code'] or 'this rack'}." if qty is not None else ""}
    if status == "FOUND":
        filed = ". It had no location; it is filed here when approved" if not view["expected_location_code"] and view["location_code"] else ""
        return {"tone": "emerald", "title": f"Found {code}", "detail": f"{view['item_name']} · {qty:g} {unit}" + (f" (book {view['expected_qty']:g})" if abs(view["variance_qty"]) > 0.0005 else "") + filed}
    if status == "WRONG_PLACE":
        where = view["expected_location_code"] or "no location"
        return {"tone": "amber", "title": f"{code} belongs to {where}", "detail": "It will be moved here when the count is approved."}
    if status == "ISSUED_FOUND":
        return {"tone": "rose", "title": f"{code}: system says issued", "detail": f"{view['note'] or ''} The Owner will decide.".strip()}
    if status == "EXTRA":
        return {"tone": "blue", "title": f"Extra: {code}", "detail": f"Book says nothing left. {qty:g} {unit} will be added back when approved."}
    return {"tone": "slate", "title": code or "Counted", "detail": ""}


def _progress_payload(db: Session, plant_id: str, count: InventoryCertification, rack: StockCountLocation) -> dict[str, Any]:
    entries = _entries(db, count)
    items, locations, lots = _lookups(db, plant_id, entries)
    views = [_entry_view(entry, items, locations, lots, {}) for entry in entries]
    counted_ids = {view["entity_id"] for view in views if view["entity_id"]}
    to_find = None
    if rack.status != "DONE":
        to_find = _to_find(db, plant_id, count, rack, counted_ids)
    return _rack_view(rack, views, to_find)


@router.post("/{count_id}/scan")
def scan_in_count(
    payload: ScanPayload,
    count_id: uuid.UUID,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_one_plant),
    current_user: dict = Depends(get_current_user),
):
    """Count one scanned reel or lot on a rack (idempotent on ``client_ref``).

    A reel counts at its label weight unless re-weighed; a lot needs the counted quantity (the answer
    says ``needs_qty`` and nothing is saved). Rack, tool, job-card and other-plant labels are refused in
    plain words; a label the system does not know answers UNKNOWN_LABEL so the counter can add it as
    loose stock.
    """
    count = _count(db, plant_id, count_id, lock=True)
    _require_counting(count)
    rack = _rack(db, count, payload.rack, lock=True)
    actor = _actor(current_user)
    previous = db.query(StockCountEntry).filter(StockCountEntry.count_id == count.id, StockCountEntry.client_ref == payload.client_ref).first()
    if previous is not None:
        items, locations, lots = _lookups(db, plant_id, [previous])
        view = _entry_view(previous, items, locations, lots, {})
        return {"entry": view, "result": _result(view), "rack": _progress_payload(db, plant_id, count, rack), "replayed": True}
    if rack.status == "DONE":
        raise HTTPException(status_code=409, detail="This rack is marked done. Re-open it to count more.")
    found = resolve_lot(db, plant_id, payload.code)
    entity_type, entity, item = found["entity_type"], found["entity"], found["item"]
    item_type = str(getattr(getattr(item, "type", None), "value", "") or "")
    if item_type in NOT_COUNTED_TYPES:
        raise HTTPException(status_code=409, detail={"code": "NOT_COUNTED", "message": f"{found['code']} is {'finished goods' if item_type == 'FINISHED_GOOD' else 'a tool'}; it is not part of the material count."})
    scope = _scope_items(count)
    if scope and str(item.id) not in scope:
        raise HTTPException(status_code=409, detail={"code": "NOT_IN_SCOPE", "message": f"{item.name} is not part of this count."})

    live = entity_qty(db, entity_type, entity)
    in_store = live > 0.0005 and str(entity.stock_status or "") not in {"RETURNED", "WIP"}
    uom = "KG" if entity_type == "REEL" else str(getattr(item.uom, "value", item.uom) or "KG")
    issue = None if in_store else _issue_of(db, entity_type, entity)
    if in_store:
        # Stock with no location yet that is found on a rack is simply found (and filed there on approval).
        unfiled = entity.location_id is None and rack.location_id is not None
        status = "FOUND" if entity.location_id == rack.location_id or unfiled else "WRONG_PLACE"
        expected = live
        default_qty = live if entity_type == "REEL" else None
    elif issue is not None and str(entity.stock_status or "") != "RETURNED":
        status, expected, default_qty = "ISSUED_FOUND", 0.0, (issue["qty"] if entity_type == "REEL" else None)
    else:
        status, expected = "EXTRA", 0.0
        default_qty = float(entity.inward_weight_kg or 0.0) if entity_type == "REEL" else None
    counted = payload.counted_qty if payload.counted_qty is not None else default_qty
    if counted is None:
        # A lot needs a number: ask for it, keyed to this label (nothing saved yet).
        return {
            "needs_qty": True,
            "lot": {"entity_type": entity_type, "entity_id": str(entity.id), "code": found["code"], "item_name": item.name, "item_code": item.item_code,
                    "uom": uom, "status": status, "expected_location": location_brief(db.get(InventoryLocation, entity.location_id)) if entity.location_id else None},
            "rack": _progress_payload(db, plant_id, count, rack),
        }
    counted = _q(counted)
    if entity_type == "REEL" and counted > float(entity.inward_weight_kg or 0.0) + 0.0005:
        raise HTTPException(status_code=422, detail=f"{found['code']} came in at {float(entity.inward_weight_kg or 0):g} kg; it cannot weigh more.")

    _open_rack(rack, actor)
    now = datetime.utcnow()
    existing = db.query(StockCountEntry).filter(
        StockCountEntry.count_id == count.id,
        (StockCountEntry.reel_id == entity.id) if entity_type == "REEL" else (StockCountEntry.batch_id == entity.id),
    ).first()
    repeat = existing is not None and existing.status not in AUTO_STATUSES and existing.location_id == rack.location_id and payload.counted_qty is None
    entry = existing or StockCountEntry(count_id=count.id, plant_id=str(plant_id), entity_type=entity_type, item_id=item.id)
    if not repeat:
        if existing is not None and existing.location_id != rack.location_id and existing.status not in AUTO_STATUSES:
            # Counted on another rack before: the latest scan says where it really is.
            other = existing.count_location
            if other is not None and other.status == "DONE" and other.id != rack.id:
                raise HTTPException(status_code=409, detail=f"{found['code']} is already counted on {other.inventory_location.code if other.inventory_location else 'another rack'}, which is marked done.")
        entry.count_location_id = rack.id
        entry.reel_id = entity.id if entity_type == "REEL" else None
        entry.batch_id = entity.id if entity_type == "BATCH" else None
        entry.uom = uom
        entry.location_id = rack.location_id
        entry.expected_location_id = entity.location_id
        entry.expected_qty = _q(expected)
        entry.counted_qty = counted
        entry.variance_qty = _q(counted - expected)
        entry.unit_cost = _line_rate(db, plant_id, item, entity)
        entry.status = status
        entry.movement_flag = None
        if status in {"FOUND", "WRONG_PLACE"} and entity.created_at and count.created_at and entity.created_at > count.created_at:
            entry.movement_flag = "RECEIVED_DURING_COUNT"
        if status == "ISSUED_FOUND" and issue is not None:
            entry.note = f"Issued on {_day_text(issue['day'])}, found in store."
            if issue["at"] and count.created_at and issue["at"] > count.created_at:
                entry.movement_flag = "ISSUED_DURING_COUNT"
        elif payload.note:
            entry.note = payload.note
        elif status == "EXTRA" and str(entity.stock_status or "") == "RETURNED":
            entry.note = "Was returned to the supplier; found in store."
        entry.scan_code = payload.code[:300]
        entry.client_ref = payload.client_ref
        entry.counted_by = actor
        entry.counted_at = now
        entry.decision = None
        entry.updated_at = now
        if existing is None:
            db.add(entry)
    count.updated_at = now
    db.commit()
    db.refresh(entry)
    items, locations, lots = _lookups(db, plant_id, [entry])
    view = _entry_view(entry, items, locations, lots, {})
    return {"entry": view, "result": _result(view, repeat=repeat), "rack": _progress_payload(db, plant_id, count, rack), "replayed": False}


class LoosePayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    rack: str = Field(min_length=1, max_length=80)
    item_id: uuid.UUID
    counted_qty: float = Field(gt=0)
    client_ref: str = Field(min_length=4, max_length=120)
    scan_code: Optional[str] = Field(default=None, max_length=300)
    note: Optional[str] = Field(default=None, max_length=500)


@router.post("/{count_id}/loose")
def add_loose_stock(
    payload: LoosePayload,
    count_id: uuid.UUID,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_one_plant),
    current_user: dict = Depends(get_current_user),
):
    """Stock found with no label (or an unknown label): item and quantity. Approval adds it ON QC HOLD."""
    count = _count(db, plant_id, count_id, lock=True)
    _require_counting(count)
    rack = _rack(db, count, payload.rack, lock=True)
    previous = db.query(StockCountEntry).filter(StockCountEntry.count_id == count.id, StockCountEntry.client_ref == payload.client_ref).first()
    if previous is None:
        item = db.query(ItemMaster).filter(ItemMaster.id == payload.item_id, ItemMaster.plant_id == str(plant_id)).first()
        if item is None or str(getattr(item.type, "value", item.type)) in NOT_COUNTED_TYPES:
            raise HTTPException(status_code=404, detail="Choose a material of this plant.")
        scope = _scope_items(count)
        if scope and str(item.id) not in scope:
            raise HTTPException(status_code=409, detail=f"{item.name} is not part of this count.")
        _open_rack(rack, _actor(current_user))
        now = datetime.utcnow()
        previous = StockCountEntry(
            count_id=count.id, count_location_id=rack.id, plant_id=str(plant_id), entity_type="LOOSE", item_id=item.id,
            uom=str(getattr(item.uom, "value", item.uom) or "KG"), location_id=rack.location_id, expected_qty=0.0,
            counted_qty=_q(payload.counted_qty), variance_qty=_q(payload.counted_qty), unit_cost=_line_rate(db, plant_id, item),
            status="EXTRA", scan_code=(payload.scan_code or None), client_ref=payload.client_ref, note=payload.note or ("Label not in the system" if payload.scan_code else "No label"),
            counted_by=_actor(current_user), counted_at=now, updated_at=now,
        )
        db.add(previous)
        count.updated_at = now
        db.commit()
        db.refresh(previous)
    items, locations, lots = _lookups(db, plant_id, [previous])
    view = _entry_view(previous, items, locations, lots, {})
    return {
        "entry": view,
        "result": {"tone": "blue", "title": f"Added {view['counted_qty']:g} {str(view['uom']).lower()} of {view['item_name']}", "detail": "No label: it will be added as new stock on QC hold when approved."},
        "rack": _progress_payload(db, plant_id, count, rack),
    }


class EntryUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    counted_qty: Optional[float] = Field(default=None, ge=0)
    note: Optional[str] = Field(default=None, max_length=500)


def _entry(db: Session, count: InventoryCertification, entry_id: uuid.UUID) -> StockCountEntry:
    entry = db.query(StockCountEntry).filter(StockCountEntry.id == entry_id, StockCountEntry.count_id == count.id).first()
    if entry is None:
        raise HTTPException(status_code=404, detail="That line is not in this count")
    return entry


@router.patch("/{count_id}/entries/{entry_id}")
def update_entry(
    payload: EntryUpdate,
    count_id: uuid.UUID,
    entry_id: uuid.UUID,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_one_plant),
    current_user: dict = Depends(get_current_user),
):
    """Change a counted quantity (or note) while the count is still being counted."""
    count = _count(db, plant_id, count_id, lock=True)
    _require_counting(count)
    entry = _entry(db, count, entry_id)
    if entry.count_location is not None and entry.count_location.status == "DONE":
        raise HTTPException(status_code=409, detail="This rack is marked done. Re-open it to change a line.")
    if payload.counted_qty is not None:
        if entry.entity_type == "LOOSE" and payload.counted_qty <= 0.0005:
            raise HTTPException(status_code=422, detail="Stock without a label needs a quantity above zero. To take the line back, use Undo.")
        if entry.entity_type == "REEL" and entry.reel is not None and payload.counted_qty > float(entry.reel.inward_weight_kg or 0.0) + 0.0005:
            raise HTTPException(status_code=422, detail=f"{entry.reel.reel_code} came in at {float(entry.reel.inward_weight_kg or 0):g} kg; it cannot weigh more.")
        entry.counted_qty = _q(payload.counted_qty)
        entry.variance_qty = _q(entry.counted_qty - float(entry.expected_qty or 0.0))
        entry.counted_by = _actor(current_user)
        entry.counted_at = datetime.utcnow()
    if payload.note is not None:
        entry.note = payload.note or None
    entry.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(entry)
    items, locations, lots = _lookups(db, plant_id, [entry])
    return _entry_view(entry, items, locations, lots, {})


@router.post("/{count_id}/entries/{entry_id}/undo")
def undo_entry(
    count_id: uuid.UUID,
    entry_id: uuid.UUID,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_one_plant),
    current_user: dict = Depends(get_current_user),
):
    """Take back a counted line (a wrong scan) while its rack is still being counted."""
    count = _count(db, plant_id, count_id, lock=True)
    _require_counting(count)
    entry = _entry(db, count, entry_id)
    rack = entry.count_location
    if rack is not None and rack.status == "DONE":
        raise HTTPException(status_code=409, detail="This rack is marked done. Re-open it to take a line back.")
    db.delete(entry)
    count.updated_at = datetime.utcnow()
    db.commit()
    return {"undone": True, "rack": _progress_payload(db, plant_id, count, rack) if rack is not None else None}


@router.post("/{count_id}/racks/{rack_key}/start")
def start_rack(
    count_id: uuid.UUID,
    rack_key: str,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_one_plant),
    current_user: dict = Depends(get_current_user),
):
    count = _count(db, plant_id, count_id, lock=True)
    _require_counting(count)
    rack = _rack(db, count, rack_key, lock=True)
    _open_rack(rack, _actor(current_user))
    db.commit()
    return _rack_payload(db, plant_id, count, rack, current_user)


def _moved_off_rack(db: Session, plant_id: str, count: InventoryCertification, location_id: Any, since: datetime, skip: set[str]) -> list[dict[str, Any]]:
    """Reels / lots whose first move after ``since`` took them off this rack and which are elsewhere now
    (a scan move or put-away while the rack was being counted). ``skip``: lots already on a line."""
    rack_id = str(location_id)
    scope = _scope_items(count)
    out: list[dict[str, Any]] = []

    def to_word(metadata: dict[str, Any]) -> str:
        return str((metadata or {}).get("to_location_code") or "no location")

    first: dict[Any, tuple[datetime, dict[str, Any]]] = {}
    for reel_id, at, metadata in db.query(ReelScanEvent.reel_id, ReelScanEvent.timestamp, ReelScanEvent.event_metadata).filter(
        ReelScanEvent.plant_id == _plant_uuid(plant_id), ReelScanEvent.event_type == ReelScanEventType.MOVE_SCAN, ReelScanEvent.timestamp >= since,
    ).order_by(ReelScanEvent.timestamp.asc()).all():
        if reel_id not in first and "to_location_id" in (metadata or {}):
            first[reel_id] = (at, metadata or {})
    candidates = {reel_id: value for reel_id, value in first.items() if str(value[1].get("from_location_id") or "") == rack_id and str(reel_id) not in skip}
    if candidates:
        for reel in db.query(PaperReel).filter(PaperReel.id.in_(list(candidates))).all():
            if str(reel.location_id or "") == rack_id or reel.status != ReelStatus.IN_STOCK or (scope and str(reel.paper_id) not in scope):
                continue
            at, metadata = candidates[reel.id]
            out.append({"entity_type": "REEL", "id": str(reel.id), "item_id": reel.paper_id, "uom": "KG", "at": at, "to": to_word(metadata)})
    first_batch: dict[Any, tuple[datetime, dict[str, Any]]] = {}
    for batch_id, at, metadata in db.query(StockTransaction.batch_id, StockTransaction.created_at, StockTransaction.movement_metadata).filter(
        StockTransaction.plant_id == str(plant_id), StockTransaction.transaction_type == TransactionType.MOVE,
        StockTransaction.qty_change == 0, StockTransaction.created_at >= since, StockTransaction.batch_id.isnot(None),
    ).order_by(StockTransaction.created_at.asc()).all():
        if batch_id not in first_batch and "to_location_id" in (metadata or {}):
            first_batch[batch_id] = (at, metadata or {})
    batch_candidates = {batch_id: value for batch_id, value in first_batch.items() if str(value[1].get("from_location_id") or "") == rack_id and str(batch_id) not in skip}
    if batch_candidates:
        for batch in db.query(StockBatch).filter(StockBatch.id.in_(list(batch_candidates))).all():
            if str(batch.location_id or "") == rack_id or (scope and str(batch.item_id) not in scope):
                continue
            item = db.get(ItemMaster, batch.item_id)
            if str(getattr(getattr(item, "type", None), "value", getattr(item, "type", "")) or "") in NOT_COUNTED_TYPES:
                continue
            if entity_qty(db, "BATCH", batch) <= 0.0005:
                continue
            at, metadata = batch_candidates[batch.id]
            out.append({"entity_type": "BATCH", "id": str(batch.id), "item_id": batch.item_id, "uom": getattr(item, "uom", None) or "KG", "at": at, "to": to_word(metadata)})
    return out


@router.post("/{count_id}/racks/{rack_key}/done")
def finish_rack(
    count_id: uuid.UUID,
    rack_key: str,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_one_plant),
    current_user: dict = Depends(get_current_user),
):
    """Rack done: every lot the book still expects here and nobody scanned becomes a MISSING line (expected
    = live book now); a lot issued since the rack was started is recorded as used during the count."""
    count = _count(db, plant_id, count_id, lock=True)
    _require_counting(count)
    rack = _rack(db, count, rack_key, lock=True)
    if rack.status == "DONE":
        return _rack_payload(db, plant_id, count, rack, current_user)
    actor = _actor(current_user)
    now = datetime.utcnow()
    counted_ids = {
        str(value) for row in db.query(StockCountEntry.reel_id, StockCountEntry.batch_id).filter(StockCountEntry.count_id == count.id).all()
        for value in row if value
    }
    missing = arrived = 0
    for row in _expected(db, plant_id, count, rack):
        if row["id"] in counted_ids:
            continue
        if _arrived_late(row, rack):
            # Received or put here after counting on this rack started: it was not here to count. Labelled
            # "received during the count" for the Owner, and never posted as missing.
            arrived += 1
            db.add(StockCountEntry(
                count_id=count.id, count_location_id=rack.id, plant_id=str(plant_id), entity_type=row["entity_type"],
                reel_id=uuid.UUID(row["id"]) if row["entity_type"] == "REEL" else None,
                batch_id=uuid.UUID(row["id"]) if row["entity_type"] == "BATCH" else None,
                item_id=uuid.UUID(row["item_id"]), uom=row["uom"], location_id=rack.location_id, expected_location_id=rack.location_id,
                expected_qty=0.0, counted_qty=0.0, variance_qty=0.0, unit_cost=row["unit_cost"], status="ARRIVED",
                movement_flag="RECEIVED_DURING_COUNT",
                note=f"Came to this rack on {_day_text(ist_day(datetime.fromisoformat(row['here_since'])))} after counting started: not counted, not missing.",
                counted_by=actor, counted_at=now, updated_at=now,
            ))
            continue
        missing += 1
        db.add(StockCountEntry(
            count_id=count.id, count_location_id=rack.id, plant_id=str(plant_id), entity_type=row["entity_type"],
            reel_id=uuid.UUID(row["id"]) if row["entity_type"] == "REEL" else None,
            batch_id=uuid.UUID(row["id"]) if row["entity_type"] == "BATCH" else None,
            item_id=uuid.UUID(row["item_id"]), uom=row["uom"], location_id=rack.location_id, expected_location_id=rack.location_id,
            expected_qty=row["qty"], counted_qty=0.0, variance_qty=-row["qty"],
            unit_cost=row["unit_cost"] or _line_rate(db, plant_id, db.get(ItemMaster, uuid.UUID(row["item_id"]))), status="MISSING",
            counted_by=actor, counted_at=now, updated_at=now,
        ))
    # Reels that sat on this rack and went to the floor after the rack was started: used, not missing.
    since = rack.started_at or count.created_at
    if rack.location_id is not None and since is not None:
        issued = db.query(ReelIssue, PaperReel).join(PaperReel, PaperReel.id == ReelIssue.reel_id).filter(
            PaperReel.plant_id == _plant_uuid(plant_id), PaperReel.location_id == rack.location_id,
            ReelIssue.created_at >= since, PaperReel.status != ReelStatus.IN_STOCK,
        ).all()
        scope = _scope_items(count)
        for issue, reel in issued:
            if str(reel.id) in counted_ids or (scope and str(reel.paper_id) not in scope):
                continue
            counted_ids.add(str(reel.id))
            db.add(StockCountEntry(
                count_id=count.id, count_location_id=rack.id, plant_id=str(plant_id), entity_type="REEL", reel_id=reel.id,
                item_id=reel.paper_id, uom="KG", location_id=rack.location_id, expected_location_id=rack.location_id,
                expected_qty=0.0, counted_qty=0.0, variance_qty=0.0, status="USED", movement_flag="ISSUED_DURING_COUNT",
                note=f"Issued to the floor on {_day_text(issue.issue_date)} during the count: used, not missing.",
                counted_by=actor, counted_at=now, updated_at=now,
            ))
    # Reels / lots that sat on this rack when it was started and were moved to another place before Rack
    # done: not counted here and not missing, but the Owner sees that they left during the count (spec 2.3).
    if rack.location_id is not None and since is not None:
        moved_away = _moved_off_rack(db, plant_id, count, rack.location_id, since, counted_ids)
        for row in moved_away:
            counted_ids.add(row["id"])
            db.add(StockCountEntry(
                count_id=count.id, count_location_id=rack.id, plant_id=str(plant_id), entity_type=row["entity_type"],
                reel_id=uuid.UUID(row["id"]) if row["entity_type"] == "REEL" else None,
                batch_id=uuid.UUID(row["id"]) if row["entity_type"] == "BATCH" else None,
                item_id=row["item_id"], uom=row["uom"], location_id=rack.location_id, expected_location_id=rack.location_id,
                expected_qty=0.0, counted_qty=0.0, variance_qty=0.0, status="MOVED", movement_flag="MOVED_DURING_COUNT",
                note=f"Moved to {row['to']} on {_day_text(ist_day(row['at']))} during the count: not counted here, not missing.",
                counted_by=actor, counted_at=now, updated_at=now,
            ))
    rack.status = "DONE"
    rack.done_by = actor
    rack.done_at = now
    rack.started_by = rack.started_by or actor
    rack.started_at = rack.started_at or now
    rack.counted_by = rack.counted_by or actor
    rack.updated_at = now
    count.updated_at = now
    db.commit()
    payload = _rack_payload(db, plant_id, count, rack, current_user)
    payload["marked_missing"] = missing
    payload["marked_arrived"] = arrived
    return payload


@router.post("/{count_id}/racks/{rack_key}/reopen")
def reopen_rack(
    count_id: uuid.UUID,
    rack_key: str,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_one_plant),
    current_user: dict = Depends(get_current_user),
):
    """Count a done rack again ("Look again"): its not-found lines are taken back until it is done again."""
    count = _count(db, plant_id, count_id, lock=True)
    _require_counting(count)
    rack = _rack(db, count, rack_key, lock=True)
    _drop_auto_lines(db, count, rack)
    rack.status = "COUNTING"
    rack.done_by = None
    rack.done_at = None
    rack.updated_at = datetime.utcnow()
    db.commit()
    return _rack_payload(db, plant_id, count, rack, current_user)


def _drop_auto_lines(db: Session, count: InventoryCertification, rack: StockCountLocation) -> None:
    db.query(StockCountEntry).filter(
        StockCountEntry.count_id == count.id, StockCountEntry.count_location_id == rack.id,
        StockCountEntry.status.in_(sorted(AUTO_STATUSES)), StockCountEntry.client_ref.is_(None),
    ).delete(synchronize_session=False)


# ---------------------------------------------------------------------------------- submit and decide


class NotePayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    note: Optional[str] = Field(default=None, max_length=500)


class SendBackPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    note: str = Field(min_length=3, max_length=500)
    racks: list[str] = Field(default_factory=list)


class DecisionPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    decision: str


def _counters(db: Session, count: InventoryCertification) -> str:
    names = sorted({row[0] for row in db.query(StockCountEntry.counted_by).filter(
        StockCountEntry.count_id == count.id, StockCountEntry.client_ref.isnot(None),
    ).all() if row[0]})
    return ", ".join(names)[:200] or (count.created_by or "")[:200]


@router.post("/{count_id}/submit")
def submit_count(
    payload: NotePayload,
    count_id: uuid.UUID,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_one_plant),
    current_user: dict = Depends(get_current_user),
):
    """Send the count to the Owner (any role). Every rack must be marked done; counting locks."""
    count = _count(db, plant_id, count_id, lock=True)
    if count.status == "SUBMITTED":
        return _detail(db, plant_id, count, current_user)
    _require_counting(count)
    open_racks = [rack for rack in _racks(db, count) if rack.status != "DONE"]
    if open_racks:
        names = ", ".join(rack.inventory_location.code if rack.inventory_location else "Not in any location" for rack in open_racks[:6])
        raise HTTPException(status_code=409, detail=f"{len(open_racks)} rack{'s are' if len(open_racks) != 1 else ' is'} not done yet: {names}{'…' if len(open_racks) > 6 else ''}.")
    now = datetime.utcnow()
    count.status = "SUBMITTED"
    count.count_state = "SUBMITTED"
    count.submitted_by = _actor(current_user)
    count.submitted_at = now
    count.submit_note = payload.note
    count.counted_by = _counters(db, count)
    count.counted_at = now
    count.count_taken_at = now
    count.updated_at = now
    db.commit()
    db.refresh(count)
    _audit(current_user, plant_id, count, "stock_count_submitted", f"Count {count.count_session_no} sent to the Owner")
    return _detail(db, plant_id, count, current_user)


@router.post("/{count_id}/send-back")
def send_back_count(
    payload: SendBackPayload,
    count_id: uuid.UUID,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_one_plant),
    current_user: dict = Depends(require_owner),
):
    """Owner only: back to counting for a recount of some racks (or all), with a note."""
    count = _count(db, plant_id, count_id, lock=True)
    if count.status != "SUBMITTED":
        raise HTTPException(status_code=409, detail="Only a count waiting for the Owner can be sent back.")
    racks = _racks(db, count)
    chosen = [rack for rack in racks if not payload.racks or _rack_key(rack) in set(payload.racks)]
    if not chosen:
        raise HTTPException(status_code=422, detail="Choose the racks to count again.")
    note = " ".join(payload.note.split())
    now = datetime.utcnow()
    for rack in chosen:
        _drop_auto_lines(db, count, rack)
        rack.status = "RECOUNT"
        rack.recount_note = note
        rack.done_by = None
        rack.done_at = None
        rack.updated_at = now
    count.status = "DRAFT"
    count.count_state = "DRAFT"
    count.sent_back_by = _actor(current_user)
    count.sent_back_at = now
    count.sent_back_note = note
    count.updated_at = now
    db.commit()
    db.refresh(count)
    _audit(current_user, plant_id, count, "stock_count_sent_back", f"Count {count.count_session_no} sent back for a recount: {note}")
    return _detail(db, plant_id, count, current_user)


@router.post("/{count_id}/cancel")
def cancel_count(
    payload: NotePayload,
    count_id: uuid.UUID,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_one_plant),
    current_user: dict = Depends(get_current_user),
):
    """Owner, or the person who started it while it is still being counted. Stock does not change."""
    count = _count(db, plant_id, count_id, lock=True)
    if count.status == "CANCELLED":
        return _detail(db, plant_id, count, current_user)
    if not _can(count, current_user)["cancel"]:
        if count.status in DONE_STATUSES:
            raise HTTPException(status_code=409, detail="An approved count cannot be cancelled.")
        raise HTTPException(status_code=403, detail="Only the Owner can cancel this count.")
    now = datetime.utcnow()
    count.status = "CANCELLED"
    count.count_state = "CANCELLED"
    count.cancelled_by = _actor(current_user)
    count.cancelled_at = now
    count.cancel_note = " ".join((payload.note or "").split()) or None
    count.updated_at = now
    db.commit()
    db.refresh(count)
    _audit(current_user, plant_id, count, "stock_count_cancelled", f"Count {count.count_session_no} cancelled")
    return _detail(db, plant_id, count, current_user)


@router.post("/{count_id}/entries/{entry_id}/decide")
def decide_issued_found(
    payload: DecisionPayload,
    count_id: uuid.UUID,
    entry_id: uuid.UUID,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_one_plant),
    current_user: dict = Depends(require_owner),
):
    """Owner only: a reel or lot issued earlier but found in the store is either left as used (no change)
    or added as new stock on QC hold (a new lot with a new label). The issue is never reversed."""
    count = _count(db, plant_id, count_id, lock=True)
    if count.status != "SUBMITTED":
        raise HTTPException(status_code=409, detail="Decide while the count is waiting for the Owner.")
    decision = str(payload.decision or "").strip().upper()
    if decision not in DECISIONS:
        raise HTTPException(status_code=422, detail="Choose: leave as used, or add as new stock on QC hold.")
    entry = _entry(db, count, entry_id)
    if entry.status != "ISSUED_FOUND":
        raise HTTPException(status_code=409, detail="Only a lot the system says was issued needs this decision.")
    entry.decision = decision
    entry.decided_by = _actor(current_user)
    entry.decided_at = datetime.utcnow()
    db.commit()
    db.refresh(entry)
    items, locations, lots = _lookups(db, plant_id, [entry])
    return _entry_view(entry, items, locations, lots, {})


# ---------------------------------------------------------------------------------------------- approve


def _next_variance_no(db: Session, plant_id: str, day: date) -> str:
    lock_voucher_numbers(db, str(plant_id))  # same series lock as ADJ- numbers (one unique key per plant)
    prefix = f"VAR-{day.strftime('%Y%m%d')}"
    for sequence in range(1, 10000):
        candidate = f"{prefix}-{sequence:03d}"
        if not db.query(StockAdjustmentVoucher.id).filter(StockAdjustmentVoucher.plant_id == str(plant_id), StockAdjustmentVoucher.voucher_no == candidate).first():
            return candidate
    raise HTTPException(status_code=500, detail="Unable to number the count voucher")


def _line_status(status: Any) -> str:
    value = str(status or "UNRESTRICTED")
    return value if value in LINE_STATUSES else "UNRESTRICTED"


def _posting_line(db: Session, plant_id: str, count: InventoryCertification, entry: StockCountEntry, receiving_id: Any, *, moved: bool = False) -> tuple[Optional[StockAdjustmentLine], Optional[str]]:
    """The exact correction line for one count line, against the live stock now; and a movement flag.

    ``moved``: the lot really went to another place after it was counted, so its line stays where the lot
    is now; a lot marked missing that was moved later was plainly there, so it is not written off."""
    entity_type, entity = _entity(db, entry)
    variance = _q(entry.variance_qty)
    where = entry.location_id or (entity.location_id if entity is not None else None) or receiving_id
    if moved and entity is not None:
        if entry.status == "MISSING":
            return None, "MOVED_AFTER_COUNT"
        where = entity.location_id or receiving_id
    note_base = f"Count {count.count_session_no}"

    def new_lot(qty: float, note: str) -> StockAdjustmentLine:
        # Unknown, loose or issued-but-found stock: a NEW lot on QC hold (incoming QC stays the only gate).
        return StockAdjustmentLine(item_id=entry.item_id, qty_delta=_q(qty), unit_cost=entry.unit_cost or None,
                                   location_id=where, stock_status="QC_HOLD", reason_code="PHYSICAL_COUNT_VARIANCE", notes=note[:500])

    if entry.status in NOT_POSTED_STATUSES:
        return None, None
    if entity_type == "LOOSE":
        if float(entry.counted_qty or 0) <= 0.0005:
            return None, None
        return new_lot(float(entry.counted_qty or 0), f"{note_base}: found without a label" + (f" ({entry.scan_code})" if entry.scan_code else "")), None
    code = lot_code(entity)
    if entry.status == "ISSUED_FOUND":
        if entry.decision == "ADD_ON_QC_HOLD" and float(entry.counted_qty or 0) > 0:
            return new_lot(float(entry.counted_qty), f"{note_base}: {code} was issued, found in store; added as new stock on QC hold"), None
        return None, None
    if entry.status == "EXTRA":
        if str(entity.stock_status or "") == "RETURNED" or float(entry.counted_qty or 0) <= 0:
            return (new_lot(float(entry.counted_qty), f"{note_base}: {code} found in store after its return") if float(entry.counted_qty or 0) > 0 else None), None
        gain = _q(float(entry.counted_qty) - max(0.0, posted_since(db, entity_type, entity.id, entry.counted_at)))
        if gain <= 0.0005:
            return None, None  # another count or correction already put it back
        return StockAdjustmentLine(item_id=entry.item_id, reel_id=entity.id if entity_type == "REEL" else None, batch_id=entity.id if entity_type == "BATCH" else None,
                                   qty_delta=gain, unit_cost=entry.unit_cost or None, location_id=where,
                                   stock_status=_line_status(entity.stock_status), reason_code="PHYSICAL_COUNT_VARIANCE",
                                   notes=f"{note_base}: {code} found again, book had nothing"), None
    if abs(variance) < 0.0005:
        return None, None
    # Only what is still different after other postings on this lot since it was counted.
    variance = _q(variance - posted_since(db, entity_type, entity.id, entry.counted_at))
    if abs(variance) < 0.0005:
        return None, None
    live = entity_qty(db, entity_type, entity)
    if live <= 0.0005:
        return None, "ISSUED_AFTER_COUNT"  # it went to the floor after it was counted: consumed, nothing to post
    delta = max(variance, -live)
    if entity_type == "REEL" and delta > 0:
        delta = min(delta, float(entity.inward_weight_kg or 0.0) - live)
    if abs(delta) < 0.0005:
        return None, None
    word = "not found" if entry.status == "MISSING" else f"counted {float(entry.counted_qty or 0):g}, book {float(entry.expected_qty or 0):g}"
    return StockAdjustmentLine(item_id=entry.item_id, reel_id=entity.id if entity_type == "REEL" else None, batch_id=entity.id if entity_type == "BATCH" else None,
                               qty_delta=_q(delta), unit_cost=entry.unit_cost or None, location_id=where if entry.status != "MISSING" else entity.location_id,
                               stock_status=_line_status(entity.stock_status), reason_code="PHYSICAL_COUNT_VARIANCE",
                               notes=f"{note_base}: {code} {word}"[:500]), None


def _lot_first_day(db: Session, line: StockAdjustmentLine) -> Optional[date]:
    """The day a reel / lot came into the book (reel inward day, or a lot's first ledger day); None for a new lot."""
    if line.reel_id:
        reel = db.get(PaperReel, line.reel_id)
        return reel.inward_date if reel is not None else None
    if not line.batch_id:
        return None
    rows = db.query(StockTransaction).filter(StockTransaction.batch_id == line.batch_id).all()
    return min((book_txn_day(row) for row in rows), default=None)


@router.post("/{count_id}/approve")
def approve_count(
    payload: NotePayload,
    count_id: uuid.UUID,
    db: Session = Depends(get_db),
    plant_id: str = Depends(get_one_plant),
    current_user: dict = Depends(require_owner),
):
    """Owner only. In one transaction: move wrong-place lots, post the exact correction voucher, and for a
    month-end count write the month's stock certificate. Approving twice changes nothing."""
    count = _count(db, plant_id, count_id, lock=True)
    if count.status in DONE_STATUSES:
        return _detail(db, plant_id, count, current_user)
    if count.status != "SUBMITTED":
        raise HTTPException(status_code=409, detail="Only a count waiting for the Owner can be approved. Submit it first.")
    actor = _actor(current_user)
    today = ist_today()
    effective = min(today, next_month(count.month) - timedelta(days=1)) if count.kind == "MONTH_END" and count.month else today
    assert_books_open(db, plant_id, effective)
    later_closed = _later_month_closed(db, plant_id, count)
    if later_closed:
        raise HTTPException(status_code=409, detail=later_closed)
    entries = _entries(db, count)
    # The Owner chooses for every "issued, but found" line (spec 2.3): approval never picks for him.
    undecided = [entry for entry in entries if entry.status == "ISSUED_FOUND" and not entry.decision]
    if undecided:
        raise HTTPException(status_code=409, detail={
            "code": "COUNT_UNDECIDED",
            "message": f"Decide the {len(undecided)} issued-but-found line{'s' if len(undecided) != 1 else ''} first: leave as used, or add as new stock on QC hold.",
            "undecided": len(undecided),
        })
    receiving = default_receiving_location(db, plant_id, actor=actor)

    # What moved while the count ran, worked out before this approval moves anything: a lot that really
    # moved after it was counted keeps its newer place and is flagged (never put back on the counted rack).
    moved_after = _moved_after_count(db, entries)
    flags = _movement_flags(db, entries, moved_after)
    for entry in entries:
        flag = flags.get(str(entry.id))
        if flag and (not entry.movement_flag or flag in {"ISSUED_AFTER_COUNT", "MOVED_AFTER_COUNT"}):
            entry.movement_flag = flag

    # (b) Lots counted in another place move to where they were found (held lots stay held).
    for entry in entries:
        if entry.status not in {"FOUND", "WRONG_PLACE", "EXTRA"} or entry.location_id is None or entry.entity_type == "LOOSE":
            continue
        if str(entry.id) in moved_after:
            continue
        entity_type, entity = _entity(db, entry)
        if entity is None or entity.location_id == entry.location_id or str(entity.stock_status or "") == "RETURNED":
            continue
        if entry.status != "EXTRA" and entity_qty(db, entity_type, entity) <= 0.0005:
            continue
        apply_move(db, plant_id=plant_id, entity_type=entity_type, entity=entity, location=db.get(InventoryLocation, entry.location_id),
                   actor=actor, source="COUNT", ref=None, extra={"count_id": str(count.id), "count_no": count.count_session_no})

    figures_before = book_period(db, plant_id, count.month, next_month(count.month) - timedelta(days=1)) if count.kind == "MONTH_END" and count.month else None

    # (a) One voucher with exact reel / lot lines.
    planned: list[tuple[StockCountEntry, StockAdjustmentLine]] = []
    late: list[tuple[StockCountEntry, StockAdjustmentLine]] = []
    for entry in entries:
        line, flag = _posting_line(db, plant_id, count, entry, receiving.id, moved=str(entry.id) in moved_after)
        if flag:
            entry.movement_flag = flag
        if line is None:
            continue
        # A month-end count approved after the month ended never changes a lot before it existed: a line on a
        # reel / lot received after the month end goes on a second voucher dated the approval day.
        lot_day = _lot_first_day(db, line) if effective < today else None
        (late if lot_day is not None and lot_day > effective else planned).append((entry, line))
    for day, pairs in ((effective, planned), (today, late)):
        if not pairs:
            continue
        assert_books_open(db, plant_id, day)
        header = StockAdjustmentVoucher(
            plant_id=str(plant_id), voucher_no=_next_variance_no(db, plant_id, day), effective_date=day,
            effective_at=ist_day_end_utc(day), reason_code="PHYSICAL_COUNT_VARIANCE",
            reason_notes=(f"{'Month-end' if count.kind == 'MONTH_END' else 'Spot'} count {count.count_session_no}"
                          + (" · lots received after the month end" if day != effective else ""))[:500],
            source_type="STOCK_COUNT", source_id=count.id, count_id=count.id, attachment_refs=[],
            created_by=count.submitted_by or count.created_by, status="DRAFT",
        )
        db.add(header)
        db.flush()
        for _entry_row, line in pairs:
            line.adjustment_id = header.id
            db.add(line)
        db.flush()
        db.refresh(header)
        _post_adjustment_voucher(db, header=header, plant_id=str(plant_id), actor=actor)
        db.flush()
        for entry, line in pairs:
            entry.adjustment_line_id = line.id
            entry.created_reel_id = line.created_reel_id
            entry.created_batch_id = line.created_batch_id

    if figures_before is not None and planned and effective < today:
        # A back-dated month-end posting must never leave the month below zero (an item, or one lot).
        _refuse_month_below_zero(db, plant_id, count, figures_before, {str(line.item_id) for _entry_row, line in planned})

    # (c/d) Close the count; a month-end count becomes the month's stock certificate.
    now = datetime.utcnow()
    count.status = "CERTIFIED" if count.kind == "MONTH_END" else "APPROVED"
    count.count_state = "CERTIFIED"
    count.approved_by = actor
    count.approved_at = now
    count.approve_note = payload.note
    count.checked_by = actor
    count.checked_at = now
    count.counted_by = count.counted_by or _counters(db, count)
    count.updated_at = now
    if count.kind == "MONTH_END":
        count.certified_by = actor
        count.certified_at = now
        count.stock_as_of_at = ist_day_end_utc(effective)
        _write_certificate_lines(db, count, entries, planned, figures_before)
    db.commit()
    db.refresh(count)
    _audit(current_user, plant_id, count, "stock_count_approved", f"Count {count.count_session_no} approved; {len(planned) + len(late)} correction line(s) posted")
    return _detail(db, plant_id, count, current_user)


def _refuse_month_below_zero(db: Session, plant_id: str, count: InventoryCertification, before: dict[str, Any], item_ids: set[str]) -> None:
    after = book_period(db, plant_id, count.month, next_month(count.month) - timedelta(days=1), item_ids=sorted(item_ids))
    was_bad = {row["item_id"] for row in before.get("items") or [] if row.get("book_problem") in {"NEGATIVE", "LOT_BELOW_ZERO"}}
    for row in after["items"]:
        if row["item_id"] in was_bad or row.get("book_problem") not in {"NEGATIVE", "LOT_BELOW_ZERO"}:
            continue
        where = "its closing stock" if row["book_problem"] == "NEGATIVE" else "one of its lots"
        raise HTTPException(
            status_code=409,
            detail=f"Approving would put {row['item_name']} ({row['item_code']}) below zero in {count.month.strftime('%B %Y')}: {where} "
                   "would go under nothing. Send the count back to recount that rack.",
        )


def _write_certificate_lines(db: Session, count: InventoryCertification, entries: list[StockCountEntry], planned: list, figures: Optional[dict[str, Any]]) -> None:
    """Per-item book vs counted lines on the month's certificate (closing before this count + its variance)."""
    db.query(InventoryCertificationLine).filter(InventoryCertificationLine.certification_id == count.id).delete(synchronize_session=False)
    posted: dict[str, float] = defaultdict(float)
    for _entry_row, line in planned:
        posted[str(line.item_id)] += float(line.qty_delta or 0.0)
    counters: dict[str, str] = {}
    for entry in entries:
        if entry.counted_by and entry.client_ref:
            counters.setdefault(str(entry.item_id), entry.counted_by)
    rows = (figures or {}).get("items") or []
    items = {str(row.id): row for row in db.query(ItemMaster).filter(ItemMaster.id.in_([row["item_id"] for row in rows])).all()} if rows else {}
    for row in rows:
        variance = _q(posted.get(row["item_id"], 0.0))
        if abs(row["closing"]) < 0.0005 and abs(variance) < 0.0005 and not row.get("has_movement"):
            continue
        item = items.get(row["item_id"])
        unit_cost = float(getattr(item, "unit_cost", 0.0) or 0.0)
        db.add(InventoryCertificationLine(
            certification_id=count.id, item_id=uuid.UUID(row["item_id"]), item_code=row["item_code"], item_name=row["item_name"],
            item_type=row["item_type"], tracking_mode=row["tracking_mode"], uom=row["uom"], stock_status="UNRESTRICTED",
            opening_qty=row["opening"], inward_qty=row["received"], outward_qty=_q(row["issued"] + row["sent_back"]),
            adjustment_qty=row["corrections"], closing_qty=row["closing"], physical_qty=_q(row["closing"] + variance),
            variance_qty=variance, unit_cost=unit_cost, closing_value=round(row["closing"] * unit_cost, 2), variance_value=round(variance * unit_cost, 2),
            count_state="COUNTED", counted_by=counters.get(row["item_id"]) or count.counted_by, checked_by=count.approved_by,
            counted_at=count.counted_at, checked_at=count.approved_at,
        ))
