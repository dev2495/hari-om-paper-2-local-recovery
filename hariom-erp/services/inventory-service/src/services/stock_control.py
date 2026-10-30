from __future__ import annotations

from datetime import date, datetime, time, timezone
from typing import Any

from sqlalchemy import and_, func, or_
from sqlalchemy.orm import Session, joinedload

from ..models import (
    ItemMaster,
    PaperReel,
    ReelIssue,
    ReelIssueStatus,
    ReelScanEvent,
    ReelScanEventType,
    StockBatch,
    StockTransaction,
    TrackingMode,
    TransactionType,
)
from .stock_calc import get_batch_balance


def _enum_value(value: Any) -> str:
    return str(getattr(value, "value", value) or "")


def _apply_item_scope(query, plant_scope: dict):
    if plant_scope.get("scope_all"):
        allowed = plant_scope.get("allowed_plants") or []
        if allowed:
            return query.filter(ItemMaster.plant_id.in_(allowed))
        return query
    selected_plant_id = plant_scope.get("selected_plant_id")
    if not selected_plant_id:
        return query.filter(False)
    return query.filter(ItemMaster.plant_id == selected_plant_id)


def _day_start(value: date) -> datetime:
    return datetime.combine(value, time.min)


def _day_end(value: date) -> datetime:
    return datetime.combine(value, time.max)


def _naive_datetime(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if getattr(value, "tzinfo", None) is not None:
        return value.astimezone(timezone.utc).replace(tzinfo=None)
    return value


def _issue_effective_datetime(issue: ReelIssue) -> datetime:
    # A FLOOR issue is consumed in full on its issue date (spec 2.1), even while its slitting card is
    # still open; the card date must never move it into a later month.
    if str(getattr(issue, "issue_mode", "") or "").upper() == "FLOOR" and getattr(issue, "issue_date", None):
        created_at = _naive_datetime(getattr(issue, "created_at", None))
        if created_at and created_at.date() == issue.issue_date:
            return created_at
        return _day_end(issue.issue_date)
    closed_at = getattr(issue, "closed_at", None)
    if closed_at:
        return _naive_datetime(closed_at) or _day_end(issue.issue_date)
    if getattr(issue, "created_at", None):
        return _naive_datetime(issue.created_at) or _day_end(issue.issue_date)
    return _day_end(issue.issue_date)


def _issue_effective_date(issue: ReelIssue) -> date:
    return _issue_effective_datetime(issue).date()


def _issue_consumed_qty(issue: ReelIssue) -> float:
    consumed = float(getattr(issue, "consumed_weight_kg", 0.0) or 0.0)
    if consumed > 0:
        return consumed
    return max(0.0, float(issue.issued_weight_kg or 0.0) - float(issue.remaining_weight_kg or 0.0))


def _transaction_business_datetime(txn: StockTransaction) -> datetime:
    if getattr(txn, "effective_at", None):
        return _naive_datetime(txn.effective_at) or _day_end(date.today())
    if getattr(txn, "effective_date", None):
        return _day_end(txn.effective_date)
    if getattr(txn, "created_at", None):
        return _naive_datetime(txn.created_at) or _day_end(date.today())
    return _day_end(date.today())


def _transaction_business_date(txn: StockTransaction) -> date:
    return _transaction_business_datetime(txn).date()


def _unit_cost_for_item(item: ItemMaster) -> tuple[float, str]:
    unit_cost = float(getattr(item, "unit_cost", 0.0) or 0.0)
    source = str(getattr(item, "cost_source", None) or "").strip().upper() or "UNAVAILABLE"
    if unit_cost <= 0:
        return 0.0, "UNAVAILABLE"
    return unit_cost, source


def batch_weighted_unit_cost_for_item(
    db: Session,
    item: ItemMaster,
    balance_getter=get_batch_balance,
) -> tuple[float, str]:
    batches = db.query(StockBatch).filter(StockBatch.item_id == item.id).all()
    weighted_value = 0.0
    weighted_qty = 0.0
    missing_cost = False

    for batch in batches:
        balance = float(balance_getter(str(batch.id), db) or 0.0)
        if balance <= 0:
            continue
        unit_cost = getattr(batch, "unit_cost", None)
        if unit_cost is None or float(unit_cost or 0.0) <= 0:
            missing_cost = True
            continue
        weighted_qty += balance
        weighted_value += balance * float(unit_cost)

    if weighted_qty <= 0:
        return 0.0, "COST_MISSING" if missing_cost else "UNAVAILABLE"
    return round(weighted_value / weighted_qty, 6), "AVG_BATCH"


def reel_weighted_unit_cost_for_item(db: Session, item: ItemMaster) -> tuple[float, str]:
    reels = db.query(PaperReel).filter(PaperReel.paper_id == item.id).all()
    weighted_value = 0.0
    weighted_qty = 0.0
    missing_cost = False
    for reel in reels:
        qty = float(getattr(reel, "current_weight_kg", 0.0) or 0.0)
        if qty <= 0:
            continue
        unit_cost = getattr(reel, "unit_cost", None)
        if unit_cost is None or float(unit_cost or 0.0) <= 0:
            missing_cost = True
            continue
        weighted_qty += qty
        weighted_value += qty * float(unit_cost)
    if weighted_qty <= 0:
        return 0.0, "COST_MISSING" if missing_cost else "UNAVAILABLE"
    return round(weighted_value / weighted_qty, 6), "AVG_REEL"


def _risk_level(closing_qty: float, reorder_level: float, safety_stock: float) -> str:
    if reorder_level <= 0 and safety_stock <= 0:
        return "POLICY_MISSING"
    if safety_stock > 0 and closing_qty <= safety_stock:
        return "CRITICAL"
    if reorder_level > 0 and closing_qty <= reorder_level:
        return "REORDER"
    return "OK"


def _reel_source_type(reel: PaperReel) -> str:
    metadata = getattr(reel, "genealogy_metadata", None) or {}
    return str(metadata.get("source_document_type") or metadata.get("source") or "").upper()


def _scan_event_adjustment_datetime(event: ReelScanEvent) -> datetime:
    metadata = getattr(event, "event_metadata", None) or {}
    raw_effective_at = metadata.get("effective_at")
    if raw_effective_at:
        try:
            parsed = datetime.fromisoformat(str(raw_effective_at).replace("Z", "+00:00"))
            return _naive_datetime(parsed) or _day_end(date.today())
        except ValueError:
            pass
    raw_effective = metadata.get("effective_date")
    if raw_effective:
        try:
            return _day_end(date.fromisoformat(str(raw_effective)[:10]))
        except ValueError:
            pass
    if getattr(event, "timestamp", None):
        return _naive_datetime(event.timestamp) or _day_end(date.today())
    return _day_end(date.today())


def _creates_reel(event: ReelScanEvent) -> bool:
    """The +qty event written when a correction makes a new reel; the reel's own inward already counts it."""
    metadata = getattr(event, "event_metadata", None) or {}
    if metadata.get("creates_reel"):
        return True
    reel = getattr(event, "reel", None)
    genealogy = (getattr(reel, "genealogy_metadata", None) or {}) if reel is not None else {}
    return bool(metadata.get("adjustment_line_id")) and metadata.get("adjustment_line_id") == genealogy.get("adjustment_line_id")


def _scan_event_adjustment_date(event: ReelScanEvent) -> date:
    return _scan_event_adjustment_datetime(event).date()


def _reel_inward_datetime(reel: PaperReel) -> datetime | None:
    inward_date = getattr(reel, "inward_date", None)
    if not inward_date:
        return None
    created_at = _naive_datetime(getattr(reel, "created_at", None))
    if created_at and created_at.date() == inward_date:
        return created_at
    return _day_end(inward_date)


def _bulk_quantities(
    db: Session,
    item_id: str,
    start_date: date,
    end_date: date,
    as_of_at: datetime | None = None,
) -> dict[str, float]:
    start_at = _day_start(start_date)
    end_at = as_of_at or _day_end(end_date)
    candidate_txns = (
        db.query(StockTransaction)
        .filter(
            StockTransaction.item_id == item_id,
            or_(
                StockTransaction.effective_date <= end_date,
                StockTransaction.effective_at <= end_at,
                and_(
                    StockTransaction.effective_date.is_(None),
                    StockTransaction.created_at <= _day_end(end_date),
                ),
            ),
        )
        .all()
    )

    opening_qty = 0.0
    inward_qty = 0.0
    outward_qty = 0.0
    adjustment_qty = 0.0
    for txn in candidate_txns:
        txn_type = _enum_value(txn.transaction_type)
        qty = float(txn.qty_change or 0.0)
        if txn_type == TransactionType.MOVE.value or _is_split_meta(txn.movement_metadata or {}):
            # A QC concession split moves part of a lot onto a new lot of the same item: not a receipt.
            continue
        business_at = _transaction_business_datetime(txn)
        if business_at < start_at:
            opening_qty += qty
            continue
        if business_at > end_at:
            continue
        if txn_type in {TransactionType.OPENING.value, TransactionType.ADJUSTMENT.value}:
            adjustment_qty += qty
        elif qty >= 0:
            inward_qty += qty
        else:
            outward_qty += abs(qty)

    closing_qty = opening_qty + inward_qty - outward_qty + adjustment_qty
    return {
        "opening_qty": opening_qty,
        "inward_qty": inward_qty,
        "outward_qty": outward_qty,
        "adjustment_qty": adjustment_qty,
        "closing_qty": closing_qty,
    }


def _reel_quantities(
    db: Session,
    item_id: str,
    start_date: date,
    end_date: date,
    as_of_at: datetime | None = None,
) -> dict[str, float]:
    start_at = _day_start(start_date)
    end_at = as_of_at or _day_end(end_date)
    reels = db.query(PaperReel).filter(PaperReel.paper_id == item_id).all()
    issues = (
        db.query(ReelIssue)
        .options(joinedload(ReelIssue.reel))
        .join(PaperReel, ReelIssue.reel_id == PaperReel.id)
        .filter(
            PaperReel.paper_id == item_id,
            or_(ReelIssue.status == ReelIssueStatus.CLOSED, ReelIssue.issue_mode == "FLOOR"),
        )
        .all()
    )

    opening_qty = 0.0
    inward_qty = 0.0
    adjustment_qty = 0.0
    for reel in reels:
        inward_at = _reel_inward_datetime(reel)
        if not inward_at or _is_split_meta(reel.genealogy_metadata or {}):
            # A concession child reel's weight is already inside its parent's inward weight.
            continue
        qty = float(reel.inward_weight_kg or 0.0)
        if inward_at < start_at:
            opening_qty += qty
        elif start_at <= inward_at <= end_at:
            if _reel_source_type(reel) in {"OPENING_LOAD", "CARRY_FORWARD", "STOCK_ADJUSTMENT"}:
                adjustment_qty += qty
            else:
                inward_qty += qty

    consumed_before_start = 0.0
    outward_qty = 0.0
    for issue in issues:
        consumed = _issue_consumed_qty(issue)
        if consumed <= 0:
            continue
        effective_at = _issue_effective_datetime(issue)
        if effective_at < start_at:
            consumed_before_start += consumed
        elif start_at <= effective_at <= end_at:
            outward_qty += consumed

    adjustment_events = (
        db.query(ReelScanEvent)
        .join(PaperReel, ReelScanEvent.reel_id == PaperReel.id)
        .filter(PaperReel.paper_id == item_id)
        .all()
    )
    for event in adjustment_events:
        metadata = getattr(event, "event_metadata", None) or {}
        try:
            delta = float(metadata.get("adjustment_qty_delta") or 0.0)
        except (TypeError, ValueError):
            delta = 0.0
        if delta == 0 or (delta > 0 and _creates_reel(event)):
            continue
        effective_at = _scan_event_adjustment_datetime(event)
        if effective_at < start_at:
            opening_qty += delta
        elif start_at <= effective_at <= end_at:
            adjustment_qty += delta

    opening_qty -= consumed_before_start
    closing_qty = opening_qty + inward_qty - outward_qty + adjustment_qty
    return {
        "opening_qty": opening_qty,
        "inward_qty": inward_qty,
        "outward_qty": outward_qty,
        "adjustment_qty": adjustment_qty,
        "closing_qty": closing_qty,
    }


def compute_stock_statement(
    db: Session,
    plant_scope: dict,
    start_date: date,
    end_date: date,
    as_of_at: datetime | None = None,
) -> dict[str, Any]:
    normalized_as_of = _naive_datetime(as_of_at)
    statement_end_at = normalized_as_of or _day_end(end_date)
    item_query = _apply_item_scope(db.query(ItemMaster).filter(ItemMaster.active == "true"), plant_scope)
    items = item_query.order_by(ItemMaster.type.asc(), ItemMaster.item_code.asc()).all()

    rows: list[dict[str, Any]] = []
    totals = {
        "opening_value": 0.0,
        "closing_value": 0.0,
        "variance_value": 0.0,
        "kg_closing_qty": 0.0,
        "pcs_closing_qty": 0.0,
        "critical_count": 0,
        "policy_missing_count": 0,
        "line_count": 0,
    }

    for item in items:
        item_id = str(item.id)
        tracking_mode = _enum_value(item.tracking_mode)
        quantities = (
            _reel_quantities(db, item_id, start_date, end_date, statement_end_at)
            if tracking_mode == TrackingMode.REEL.value
            else _bulk_quantities(db, item_id, start_date, end_date, statement_end_at)
        )
        if tracking_mode == TrackingMode.REEL.value:
            unit_cost, cost_source = reel_weighted_unit_cost_for_item(db, item)
        else:
            unit_cost, cost_source = batch_weighted_unit_cost_for_item(db, item)
        closing_qty = round(float(quantities["closing_qty"] or 0.0), 3)
        opening_qty = round(float(quantities["opening_qty"] or 0.0), 3)
        inward_qty = round(float(quantities["inward_qty"] or 0.0), 3)
        outward_qty = round(float(quantities["outward_qty"] or 0.0), 3)
        adjustment_qty = round(float(quantities["adjustment_qty"] or 0.0), 3)
        reorder_level = float(getattr(item, "reorder_level", 0.0) or 0.0)
        safety_stock = float(getattr(item, "safety_stock", 0.0) or 0.0)
        lead_time_days = float(getattr(item, "lead_time_days", 0.0) or 0.0)
        risk_level = _risk_level(closing_qty, reorder_level, safety_stock)
        closing_value = round(closing_qty * unit_cost, 2)
        opening_value = round(opening_qty * unit_cost, 2)

        row = {
            "item_id": item_id,
            "item_code": item.item_code,
            "item_name": item.name,
            "item_type": _enum_value(item.type),
            "tracking_mode": tracking_mode,
            "uom": _enum_value(item.uom),
            "opening_qty": opening_qty,
            "inward_qty": inward_qty,
            "outward_qty": outward_qty,
            "adjustment_qty": adjustment_qty,
            "closing_qty": closing_qty,
            "physical_qty": closing_qty,
            "variance_qty": 0.0,
            "unit_cost": round(unit_cost, 4),
            "cost_source": cost_source,
            "opening_value": opening_value,
            "closing_value": closing_value,
            "variance_value": 0.0,
            "reorder_level": round(reorder_level, 2),
            "safety_stock": round(safety_stock, 2),
            "lead_time_days": round(lead_time_days, 1),
            "risk_level": risk_level,
            "policy_missing": risk_level == "POLICY_MISSING",
            "is_below_reorder": risk_level in {"CRITICAL", "REORDER"},
        }
        rows.append(row)
        totals["opening_value"] += opening_value
        totals["closing_value"] += closing_value
        if row["uom"] == "KG":
            totals["kg_closing_qty"] += closing_qty
        if row["uom"] == "PCS":
            totals["pcs_closing_qty"] += closing_qty
        if risk_level in {"CRITICAL", "REORDER"}:
            totals["critical_count"] += 1
        if risk_level == "POLICY_MISSING":
            totals["policy_missing_count"] += 1
        totals["line_count"] += 1

    for key in ("opening_value", "closing_value", "variance_value", "kg_closing_qty", "pcs_closing_qty"):
        totals[key] = round(float(totals[key]), 2)

    return {
        "period_start": start_date.isoformat(),
        "period_end": end_date.isoformat(),
        "stock_as_of_at": statement_end_at.isoformat(),
        "scope": "ALL" if plant_scope.get("scope_all") else plant_scope.get("selected_plant_id"),
        "generated_at": datetime.utcnow().isoformat(),
        "rows": rows,
        "totals": totals,
    }


# ---------------------------------------------------------------------------------------------------
# Stock book (spec 2.1, client 2026-10-28): one statement per plant, item and period built from every
# store movement, each dated on its IST business day. The book is continuous, so a month's opening is
# the sum of everything before its 1st and
#     Closing = Opening + Received - Sent back - Issued + Corrections
# holds by construction, in the item's own unit. Movements are rounded to 3 decimals as they are read,
# so one month's closing is exactly the next month's opening.
#   Received    GRN / manual GRN / old inward, plus go-live opening loads (also shown on their own)
#   Sent back   QC-rejected lots returned to the supplier
#   Issued      every issue to the floor: material issues, reel / coil issues of every mode (a FLOOR
#               issue is out at full weight on its issue date, open slitting card or not), parchment
#               by weight; old slitting coils that came back as new coils are netted off
#   Corrections approved count variances (spot and month-end), approved corrections, system write-offs
# Finished goods and tools are not part of the material book.
# ---------------------------------------------------------------------------------------------------

BOOK_EXCLUDED_TYPES = frozenset({"FINISHED_GOOD", "TOOL"})
BOOK_KINDS = ("RECEIVED", "OPENING_LOAD", "SENT_BACK", "ISSUED", "CORRECTION", "COUNT_VARIANCE")
BOOK_KIND_LABELS = {
    "RECEIVED": "Received (GRN)",
    "OPENING_LOAD": "Opening load",
    "SENT_BACK": "Sent back to supplier",
    "ISSUED": "Issued to the floor",
    "CORRECTION": "Correction",
    "COUNT_VARIANCE": "Count difference",
}
COUNT_REASON = "PHYSICAL_COUNT_VARIANCE"
# A lot or reel split inside the store (QC concession partition). It moves quantity between two lots of
# one item: it keeps each lot's own balance right (lot-below-zero check) but never enters the figures.
SPLIT_KIND = "SPLIT"


def _ist_day_of(value: datetime | None) -> date | None:
    from .books import ist_day

    return ist_day(value) if value is not None else None


def _q3(value: Any) -> float:
    try:
        return round(float(value or 0.0), 3)
    except (TypeError, ValueError):
        return 0.0


def _meta_date(metadata: dict, *keys: str) -> date | None:
    for key in keys:
        raw = metadata.get(key)
        if not raw:
            continue
        try:
            if key.endswith("_at"):
                parsed = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
                return _ist_day_of(_naive_datetime(parsed))
            return date.fromisoformat(str(raw)[:10])
        except ValueError:
            continue
    return None


def book_txn_day(txn: StockTransaction) -> date:
    """IST business day of a ledger row: its effective date, else the IST day of its timestamps."""
    if getattr(txn, "effective_date", None):
        return txn.effective_date
    return _ist_day_of(_naive_datetime(getattr(txn, "effective_at", None)) or _naive_datetime(getattr(txn, "created_at", None))) or date.today()


def _is_split_meta(metadata: dict) -> bool:
    """A QC concession partition (quality._post_batch_partition_ledger / the concession child reel): part of
    a lot or reel moved onto a new lot of the same item. Stock of the item does not change."""
    return bool(metadata.get("concession_partition"))


def _is_count_meta(metadata: dict) -> bool:
    return bool(metadata.get("count_id")) or str(metadata.get("reason_code") or "").upper() == COUNT_REASON


def _txn_kind(txn: StockTransaction) -> str | None:
    kind = _enum_value(txn.transaction_type)
    metadata = getattr(txn, "movement_metadata", None) or {}
    if _is_split_meta(metadata):
        # Both sides of a concession split (MOVE -q on the parent lot, INWARD +q on the child): the item
        # total is unchanged, so neither side is Received or Issued (checker 2026-10-28: it counted twice).
        return SPLIT_KIND
    if kind == TransactionType.MOVE.value:
        # Issue-to-WIP leaves the store as a STORE_OUT move; its WIP_IN twin is floor stock, not store stock.
        return "ISSUED" if metadata.get("side") == "STORE_OUT" else None
    if kind in {TransactionType.INWARD.value, TransactionType.FG_INWARD.value}:
        return "RECEIVED"
    if kind == TransactionType.OPENING.value:
        return "OPENING_LOAD"
    if kind in {TransactionType.ISSUE_PRODUCTION.value, TransactionType.DISPATCH.value}:
        return "ISSUED"
    if kind == TransactionType.PRODUCTION_RETURN.value:
        # Rule 0.1: Issued has no return deduction. An old floor return (before the rule) shows as a correction.
        return "CORRECTION"
    if kind == TransactionType.ADJUSTMENT.value:
        if str(metadata.get("kind") or "").upper() == "SUPPLIER_RETURN":
            return "SENT_BACK"
        return "COUNT_VARIANCE" if _is_count_meta(metadata) else "CORRECTION"
    return None


def _plant_uuid(plant_id: Any):
    import uuid as _uuid

    return plant_id if isinstance(plant_id, _uuid.UUID) else _uuid.UUID(str(plant_id))


def _book_move(item_id: Any, day: date, kind: str, qty: float, source: dict[str, Any]) -> dict[str, Any]:
    return {"item_id": str(item_id), "day": day, "kind": kind, "qty": _q3(qty), "source": source}


def _stamp_bound(until: date) -> datetime:
    """A naive-UTC moment after every stamp whose IST day is on or before ``until`` (a few hours of slack;
    the exact IST day is still checked row by row), for SQL bounds on the book reads."""
    from datetime import timedelta

    return datetime.combine(until + timedelta(days=1), time.min)


def _ledger_until_filter(until: date):
    """SQL superset of the ledger rows whose book day (book_txn_day) is on or before ``until``."""
    stamp = func.coalesce(StockTransaction.effective_at, StockTransaction.created_at)
    return or_(
        StockTransaction.effective_date <= until,
        and_(StockTransaction.effective_date.is_(None), or_(stamp.is_(None), stamp < _stamp_bound(until))),
    )


def book_movements(
    db: Session,
    plant_id: str,
    items: dict[str, ItemMaster],
    until: date | None = None,
    *,
    entered_after: datetime | None = None,
    places: bool = True,
) -> list[dict[str, Any]]:
    """Every store movement of ``items`` (one plant), dated on its IST day, ``qty`` signed as its effect on stock.

    ``until`` bounds the reads in SQL too (ledger, reel issues, and with ``places=False`` the reels and
    their adjustments), so a month reads the history up to its end, not the whole plant history (checker
    r2). ``entered_after`` (naive UTC) reads only rows entered after that moment (callers still check each
    row's ``at``). ``places=False`` skips the rack-move history, which only names where a row happened;
    such rows carry no ``location_id``.
    """
    from .books import ist_day

    moves: list[dict[str, Any]] = []
    if not items:
        return moves
    bulk_ids = [item.id for item in items.values() if _enum_value(item.tracking_mode) != TrackingMode.REEL.value]
    reel_ids = [item.id for item in items.values() if _enum_value(item.tracking_mode) == TrackingMode.REEL.value]
    bound = _stamp_bound(until) if until else None

    if bulk_ids:
        txn_query = db.query(StockTransaction).filter(StockTransaction.item_id.in_(bulk_ids))
        if until:
            txn_query = txn_query.filter(_ledger_until_filter(until))
        if entered_after is not None:
            txn_query = txn_query.filter(StockTransaction.created_at > entered_after)
        txns = txn_query.all()
        lot_ids = list({txn.batch_id for txn in txns if txn.batch_id})
        batch_codes = {
            str(row.id): row.batch_no
            for row in db.query(StockBatch.id, StockBatch.batch_no).filter(StockBatch.id.in_(lot_ids)).all()
        } if lot_ids else {}
        for txn in txns:
            kind = _txn_kind(txn)
            qty = _q3(txn.qty_change)
            if kind is None or qty == 0:
                continue
            day = book_txn_day(txn)
            if until and day > until:
                continue
            metadata = txn.movement_metadata or {}
            moves.append(_book_move(txn.item_id, day, kind, qty, {
                "type": "LEDGER",
                "id": str(txn.id),
                "movement": _enum_value(txn.transaction_type),
                "lot": batch_codes.get(str(txn.batch_id)) if txn.batch_id else None,
                "batch_id": str(txn.batch_id) if txn.batch_id else None,
                "doc": metadata.get("grn_no") or metadata.get("voucher_no") or metadata.get("document_no") or metadata.get("return_reference") or txn.external_ref,
                "reason": "FLOOR_RETURN" if kind == "CORRECTION" and _enum_value(txn.transaction_type) == TransactionType.PRODUCTION_RETURN.value
                else metadata.get("reason_code") or metadata.get("reason") or metadata.get("reason_label"),
                "shift": metadata.get("shift"),
                "note": metadata.get("notes") or metadata.get("note"),
                "location_id": str(txn.location_id) if txn.location_id else None,
                "at": txn.created_at.isoformat() if txn.created_at else None,
            }))

    if reel_ids:
        plant_uuid = _plant_uuid(plant_id)
        of_plant = (PaperReel.paper_id.in_(reel_ids), PaperReel.plant_id == plant_uuid)
        issue_query = db.query(ReelIssue).join(PaperReel, ReelIssue.reel_id == PaperReel.id).filter(*of_plant)
        if until:
            # Issued on its issue date; an old-style close puts weight back on its close day.
            issue_query = issue_query.filter(or_(ReelIssue.issue_date <= until, ReelIssue.closed_at < bound))
        if entered_after is not None:
            issue_query = issue_query.filter(or_(ReelIssue.created_at > entered_after, ReelIssue.closed_at > entered_after))
        issues = issue_query.all()
        event_query = db.query(ReelScanEvent).join(PaperReel, ReelScanEvent.reel_id == PaperReel.id).filter(
            *of_plant, ReelScanEvent.event_type == ReelScanEventType.MOVE_SCAN,
        )
        if places:
            # Every rack move of the reels is needed to name where a row happened: one item's drawer.
            reels = db.query(PaperReel).filter(*of_plant).all()
        else:
            if until:
                # An adjustment is dated by its effective date (kept in the event), else its IST day.
                stated = func.substr(ReelScanEvent.event_metadata["effective_date"].as_string(), 1, 10)
                stated_at = func.substr(ReelScanEvent.event_metadata["effective_at"].as_string(), 1, 10)
                event_query = event_query.filter(or_(
                    ReelScanEvent.timestamp < bound,
                    stated <= until.isoformat(),
                    stated_at <= bound.date().isoformat(),
                ))
            if entered_after is not None:
                event_query = event_query.filter(ReelScanEvent.timestamp > entered_after)
            events = event_query.all()
            # Reels that came in by ``until`` (entered after ``entered_after``), plus any reel an issue or
            # adjustment read above belongs to.
            wanted = {issue.reel_id for issue in issues} | {event.reel_id for event in events}
            came_in = [PaperReel.inward_date <= until] if until else []
            if entered_after is not None:
                came_in.append(PaperReel.created_at > entered_after)
            reel_query = db.query(PaperReel).filter(*of_plant)
            if came_in:
                reel_query = reel_query.filter(or_(and_(*came_in), PaperReel.id.in_(list(wanted))) if wanted else and_(*came_in))
            reels = reel_query.all()
        reel_by_id = {reel.id: reel for reel in reels}
        if places:
            events = event_query.all() if reels else []
        # Rack moves of each reel, oldest first (a move names where it went; correction events do not), so a
        # receipt or an issue shows the place it happened at, not where the reel sits now.
        rack_moves: dict[Any, list[tuple[datetime, Any, Any]]] = {}
        for event in events if places else []:
            metadata = event.event_metadata or {}
            if event.timestamp and "to_location_id" in metadata:
                rack_moves.setdefault(event.reel_id, []).append((event.timestamp, metadata.get("from_location_id"), metadata.get("to_location_id")))
        for rows in rack_moves.values():
            rows.sort(key=lambda row: row[0])

        def place_at(reel: PaperReel, at: datetime | None = None) -> str | None:
            """Where ``reel`` was at ``at`` (naive UTC; None = when it came in)."""
            if not places:
                return None
            rows = rack_moves.get(reel.id)
            if not rows:
                return str(reel.location_id) if reel.location_id else None
            earlier = [row for row in rows if at is not None and row[0] <= at]
            place = earlier[-1][2] if earlier else rows[0][1]
            return str(place) if place else None

        for reel in reels:
            genealogy = reel.genealogy_metadata or {}
            source = str(genealogy.get("source_document_type") or genealogy.get("source") or "").upper()
            qty = _q3(reel.inward_weight_kg)
            if qty == 0 or not reel.inward_date or (until and reel.inward_date > until):
                continue
            if _is_split_meta(genealogy):
                # Concession child reel: its weight came off the parent, whose inward weight stays as it
                # came in. The split only moves the lot balance from parent to child.
                split = {"type": "REEL_SPLIT", "id": str(reel.id), "lot": reel.reel_code, "reel_id": str(reel.id)}
                moves.append(_book_move(reel.paper_id, reel.inward_date, SPLIT_KIND, qty, split))
                if reel.parent_reel_id:
                    moves.append(_book_move(reel.paper_id, reel.inward_date, SPLIT_KIND, -qty, {**split, "reel_id": str(reel.parent_reel_id)}))
                continue
            info = {
                "type": "REEL_IN", "id": str(reel.id), "lot": reel.reel_code, "reel_id": str(reel.id),
                "doc": (reel.inward_metadata or {}).get("grn_no") or genealogy.get("voucher_no") or genealogy.get("document_no"),
                "reason": genealogy.get("reason_code"),
                "location_id": place_at(reel),
                "at": reel.created_at.isoformat() if reel.created_at else None,
            }
            if source == "SLIT":
                # Old slitting flow: the coils came back as new coils, so they are taken off what was issued.
                moves.append(_book_move(reel.paper_id, reel.inward_date, "ISSUED", qty, {**info, "type": "SLIT_COIL", "note": f"Coil from slitting reel {genealogy.get('parent_reel_code') or ''}".strip()}))
            elif source in {"OPENING_LOAD", "CARRY_FORWARD"}:
                moves.append(_book_move(reel.paper_id, reel.inward_date, "OPENING_LOAD", qty, info))
            elif source == "STOCK_ADJUSTMENT":
                moves.append(_book_move(reel.paper_id, reel.inward_date, "COUNT_VARIANCE" if _is_count_meta(genealogy) else "CORRECTION", qty, info))
            else:
                moves.append(_book_move(reel.paper_id, reel.inward_date, "RECEIVED", qty, info))

        if reels:
            for issue in issues:
                reel = reel_by_id.get(issue.reel_id)
                if reel is None:
                    continue
                # Every issue mode (FLOOR, WINDER, old LEGACY) is Issued at its full issued weight on its issue
                # date, open or closed (spec 2.1: nothing comes back from the floor).
                qty, day = _q3(issue.issued_weight_kg), issue.issue_date
                where = place_at(reel, _naive_datetime(issue.created_at))
                if qty and day and not (until and day > until):
                    moves.append(_book_move(reel.paper_id, day, "ISSUED", -qty, {
                        "type": "REEL_ISSUE", "id": str(issue.id), "lot": reel.reel_code, "reel_id": str(reel.id),
                        "shift": issue.shift, "section": issue.issue_section, "mode": issue.issue_mode,
                        "doc": None, "location_id": where,
                        "at": issue.created_at.isoformat() if issue.created_at else None,
                    }))
                if str(issue.issue_mode or "").upper() == "FLOOR" or issue.status != ReelIssueStatus.CLOSED:
                    continue
                # An old-style issue that was closed put its unused weight back on the reel (the old flow).
                # The reel holds that weight again, so it shows as a correction on the close day.
                back = _q3(float(issue.issued_weight_kg or 0.0) - _issue_consumed_qty(issue))
                back_day = ist_day(issue.closed_at) if issue.closed_at else issue.issue_date
                if back > 0 and back_day and not (until and back_day > until):
                    moves.append(_book_move(reel.paper_id, back_day, "CORRECTION", back, {
                        "type": "REEL_ISSUE_BACK", "id": f"{issue.id}:back", "lot": reel.reel_code, "reel_id": str(reel.id),
                        "reason": "FLOOR_RETURN", "note": "Unused weight put back on the reel when an old-style issue was closed",
                        "shift": issue.shift, "section": issue.issue_section, "mode": issue.issue_mode, "doc": None, "location_id": where,
                        "at": issue.closed_at.isoformat() if issue.closed_at else None,
                    }))

            for event in events:
                metadata = event.event_metadata or {}
                delta = _q3(metadata.get("adjustment_qty_delta"))
                reel = reel_by_id.get(event.reel_id)
                if delta == 0 or reel is None:
                    continue
                if delta > 0 and _creates_reel_for(metadata, reel):
                    continue
                if str(metadata.get("source_document_type") or "").upper() == "SUPPLIER_RETURN" or str(metadata.get("kind") or "").upper() == "SUPPLIER_RETURN":
                    kind, day = "SENT_BACK", ist_day(event.timestamp)
                else:
                    kind = "COUNT_VARIANCE" if _is_count_meta(metadata) else "CORRECTION"
                    day = _meta_date(metadata, "effective_date", "effective_at") or ist_day(event.timestamp)
                if until and day > until:
                    continue
                moves.append(_book_move(reel.paper_id, day, kind, delta, {
                    "type": "REEL_ADJUST", "id": str(event.id), "lot": reel.reel_code, "reel_id": str(reel.id),
                    "doc": metadata.get("voucher_no") or metadata.get("return_reference") or metadata.get("grn_no"),
                    "reason": metadata.get("reason_code") or metadata.get("reason"),
                    # Where it was written off / found: the voucher line's place, else where the reel sits.
                    "location_id": str(metadata.get("location_id") or place_at(reel, event.timestamp) or "") or None,
                    "at": event.timestamp.isoformat() if event.timestamp else None,
                }))
    return moves


def _creates_reel_for(metadata: dict, reel: PaperReel) -> bool:
    if metadata.get("creates_reel"):
        return True
    genealogy = reel.genealogy_metadata or {}
    return bool(metadata.get("adjustment_line_id")) and metadata.get("adjustment_line_id") == genealogy.get("adjustment_line_id")


def book_items(db: Session, plant_id: str, item_ids: list[str] | None = None) -> dict[str, ItemMaster]:
    query = db.query(ItemMaster).filter(ItemMaster.plant_id == str(plant_id))
    if item_ids:
        query = query.filter(ItemMaster.id.in_(item_ids))
    return {str(item.id): item for item in query.all() if _enum_value(item.type) not in BOOK_EXCLUDED_TYPES}


def _live_store_qty(db: Session, items: dict[str, ItemMaster], plant_id: str) -> dict[str, float]:
    """Book stock right now from the stock records themselves (reel weights, ledger sums), for the identity check."""
    live: dict[str, float] = {key: 0.0 for key in items}
    reel_ids = [item.id for item in items.values() if _enum_value(item.tracking_mode) == TrackingMode.REEL.value]
    bulk_ids = [item.id for item in items.values() if _enum_value(item.tracking_mode) != TrackingMode.REEL.value]
    from sqlalchemy import func

    if reel_ids:
        for paper_id, total in db.query(PaperReel.paper_id, func.sum(PaperReel.current_weight_kg)).filter(
            PaperReel.paper_id.in_(reel_ids), PaperReel.plant_id == _plant_uuid(plant_id),
        ).group_by(PaperReel.paper_id).all():
            live[str(paper_id)] = float(total or 0.0)
        # An old-style issue still open left its weight on the reel record, but the reel is on the floor:
        # the book counts it as issued, so the stock now leaves it out too.
        for paper_id, total in db.query(PaperReel.paper_id, func.sum(ReelIssue.issued_weight_kg)).join(
            ReelIssue, ReelIssue.reel_id == PaperReel.id,
        ).filter(
            PaperReel.paper_id.in_(reel_ids), PaperReel.plant_id == _plant_uuid(plant_id),
            ReelIssue.status == ReelIssueStatus.OPEN, func.upper(func.coalesce(ReelIssue.issue_mode, "LEGACY")) != "FLOOR",
        ).group_by(PaperReel.paper_id).all():
            live[str(paper_id)] = live.get(str(paper_id), 0.0) - float(total or 0.0)
    if bulk_ids:
        # Summed in SQL (checker r2: every ledger row was read again for the running month). The WIP_IN twin
        # of an issue-to-WIP move is floor stock, not store stock.
        wip_in = and_(
            StockTransaction.transaction_type == TransactionType.MOVE,
            func.coalesce(StockTransaction.movement_metadata["side"].as_string(), "") == "WIP_IN",
        )
        for item_id, total in db.query(StockTransaction.item_id, func.sum(StockTransaction.qty_change)).filter(
            StockTransaction.item_id.in_(bulk_ids), ~wip_in,
        ).group_by(StockTransaction.item_id).all():
            live[str(item_id)] = live.get(str(item_id), 0.0) + float(total or 0.0)
    return live


def _ledger_balance_until(db: Session, items: dict[str, ItemMaster], until: date) -> dict[str, float]:
    """Bulk materials: every ledger row of the item dated up to ``until`` (IST day), whatever its kind.

    The book adds only the rows it knows how to read (received, issued, corrections …); this sum takes all
    of them, so a row the book leaves out shows as a difference instead of silently changing the stock.
    """
    bulk_ids = [item.id for item in items.values() if _enum_value(item.tracking_mode) != TrackingMode.REEL.value]
    out: dict[str, float] = {}
    if not bulk_ids:
        return out
    for txn in db.query(StockTransaction).filter(StockTransaction.item_id.in_(bulk_ids), _ledger_until_filter(until)).all():
        if _enum_value(txn.transaction_type) == TransactionType.MOVE.value and (txn.movement_metadata or {}).get("side") == "WIP_IN":
            continue
        if book_txn_day(txn) > until:
            continue
        out[str(txn.item_id)] = out.get(str(txn.item_id), 0.0) + float(txn.qty_change or 0.0)
    return out


BOOK_PROBLEM_WORDS = {
    "NEGATIVE": "Closing stock is below zero",
    "LOT_BELOW_ZERO": "A lot goes below zero by the month end",
    "LEDGER": "The book leaves out a stock movement",
    "LIVE": "The book and the stock in the store now differ",
}


def _empty_figures() -> dict[str, float]:
    return {"opening": 0.0, "received": 0.0, "opening_loads": 0.0, "sent_back": 0.0, "issued": 0.0, "corrections": 0.0, "count_variance": 0.0}


def book_period(
    db: Session,
    plant_id: str,
    start: date,
    end: date,
    *,
    item_ids: list[str] | None = None,
    include_idle: bool = False,
) -> dict[str, Any]:
    """Identity figures for every material item of a plant over [start, end] (IST days), grouped by unit."""
    from .books import ist_today

    items = book_items(db, plant_id, item_ids)
    figures: dict[str, dict[str, float]] = {key: _empty_figures() for key in items}
    moved: set[str] = set()
    # Per reel / lot balance at the period end: a lot below zero means something was dated before the lot
    # existed (or posted twice), even when the item total still looks fine.
    lot_end: dict[tuple[str, str], float] = {}
    for move in book_movements(db, plant_id, items, until=end, places=False):
        row = figures.get(move["item_id"])
        if row is None:
            continue
        qty = move["qty"]
        lot_key = move["source"].get("batch_id") or move["source"].get("reel_id")
        if lot_key:
            key_pair = (move["item_id"], str(lot_key))
            lot_end[key_pair] = lot_end.get(key_pair, 0.0) + qty
        if move["kind"] == SPLIT_KIND:
            continue
        if move["day"] < start:
            row["opening"] += qty
            continue
        moved.add(move["item_id"])
        kind = move["kind"]
        if kind in {"RECEIVED", "OPENING_LOAD"}:
            row["received"] += qty
            if kind == "OPENING_LOAD":
                row["opening_loads"] += qty
        elif kind == "SENT_BACK":
            row["sent_back"] -= qty
        elif kind == "ISSUED":
            row["issued"] -= qty
        else:
            row["corrections"] += qty
            if kind == "COUNT_VARIANCE":
                row["count_variance"] += qty

    running = end >= ist_today()
    live = _live_store_qty(db, items, plant_id) if running else {}
    ledger = _ledger_balance_until(db, items, end)
    below_zero = {item_key for (item_key, _lot), balance in lot_end.items() if balance < -0.0005}
    rows: list[dict[str, Any]] = []
    for key, item in items.items():
        row = {name: _q3(value) for name, value in figures[key].items()}
        closing = _q3(row["opening"] + row["received"] - row["sent_back"] - row["issued"] + row["corrections"])
        active = str(getattr(item, "active", "true")) == "true"
        has_figures = any(abs(row[name]) > 0.0005 for name in row) or abs(closing) > 0.0005
        if not include_idle and not has_figures and not active:
            continue
        # Closing is opening + flows by construction, so "balances" means checks that can fail: no negative
        # stock, no lot below zero, the bulk ledger agrees up to the period end, and (running month) the
        # closing equals the stock records now.
        problem = None
        if closing < -0.0005:
            problem = "NEGATIVE"
        elif key in below_zero:
            problem = "LOT_BELOW_ZERO"
        elif key in ledger and abs(closing - _q3(ledger[key])) >= 0.01:
            problem = "LEDGER"
        elif running and abs(closing - _q3(live.get(key, 0.0))) >= 0.01:
            problem = "LIVE"
        identity_ok = problem is None
        rows.append({
            "item_id": key,
            "item_code": item.item_code,
            "item_name": item.name,
            "item_type": _enum_value(item.type),
            "tracking_mode": _enum_value(item.tracking_mode),
            "uom": _enum_value(item.uom),
            **row,
            "closing": closing,
            "actual_used": _q3(row["opening"] + row["received"] - row["sent_back"] - closing),
            "identity_ok": identity_ok,
            "book_problem": problem,
            "book_problem_word": BOOK_PROBLEM_WORDS.get(problem or ""),
            "has_movement": key in moved,
            **({"book_now": _q3(live.get(key, 0.0))} if running else {}),
        })
    type_order = {name: index for index, name in enumerate(("RAW_PAPER", "PARCHMENT", "ADHESIVE", "PACKAGING", "OTHER"))}
    rows.sort(key=lambda row: (type_order.get(row["item_type"], 9), row["item_code"]))
    units: dict[str, dict[str, Any]] = {}
    for row in rows:
        unit = units.setdefault(row["uom"], {"uom": row["uom"], "item_count": 0, **_empty_figures(), "closing": 0.0, "actual_used": 0.0, "problem_items": 0, "negative_items": 0})
        unit["item_count"] += 1
        unit["problem_items"] += 0 if row["identity_ok"] else 1
        unit["negative_items"] += 1 if row["closing"] < -0.0005 else 0
        for name in ("opening", "received", "opening_loads", "sent_back", "issued", "corrections", "count_variance", "closing", "actual_used"):
            unit[name] = _q3(unit[name] + row[name])
    return {
        "period_start": start.isoformat(),
        "period_end": end.isoformat(),
        "running": running,
        "units": sorted(units.values(), key=lambda unit: unit["uom"]),
        "items": rows,
    }


def book_item_sources(db: Session, plant_id: str, item_id: str, start: date, end: date) -> dict[str, Any]:
    """The movements behind one item's figures for [start, end], newest last, for the month-end drawer."""
    items = book_items(db, plant_id, [item_id])
    item = items.get(str(item_id))
    if item is None:
        return {}
    opening = 0.0
    rows: list[dict[str, Any]] = []
    for move in book_movements(db, plant_id, items, until=end):
        if move["kind"] == SPLIT_KIND:
            continue
        if move["day"] < start:
            opening += move["qty"]
            continue
        source = move["source"]
        rows.append({
            "day": move["day"].isoformat(),
            "kind": move["kind"],
            "label": BOOK_KIND_LABELS[move["kind"]] if source.get("type") != "SLIT_COIL" else "Coil back from slitting (old flow)",
            "qty": move["qty"],
            **{key: value for key, value in source.items() if value is not None},
        })
    rows.sort(key=lambda row: (row["day"], row.get("at") or ""))
    totals: dict[str, float] = {}
    for row in rows:
        totals[row["kind"]] = _q3(totals.get(row["kind"], 0.0) + row["qty"])
    opening = _q3(opening)
    return {
        "item_id": str(item.id),
        "item_code": item.item_code,
        "item_name": item.name,
        "item_type": _enum_value(item.type),
        "uom": _enum_value(item.uom),
        "period_start": start.isoformat(),
        "period_end": end.isoformat(),
        "opening": opening,
        "closing": _q3(opening + sum(row["qty"] for row in rows)),
        "totals": totals,
        "rows": rows,
    }


def changes_after_count(
    db: Session,
    plant_id: str,
    count: Any,
    *,
    items: dict[str, ItemMaster] | None = None,
    own_docs: set[str] | None = None,
) -> dict[str, dict[str, Any]]:
    """Store movements posted AFTER an approved month-end count but dated back into what it counted.

    The count measured the stock at its approval. A GRN, issue or correction entered later with a date on
    or before the counted day (the month end when it was approved after the month; the day before approval
    when approved in the month's last days) changes a closing the count never saw: the certificate and the
    book then disagree. Spec 2.5 locks only closed months, so this is flagged, not refused (checker
    2026-10-28). Returns {item_id: {qty, rows, docs, first_day}}; the count's own postings are left out.
    """
    from datetime import timedelta

    from .books import ist_day, next_month

    approved = getattr(count, "approved_at", None) or getattr(count, "certified_at", None)
    month = getattr(count, "month", None)
    if approved is None or month is None:
        return {}
    end = next_month(month) - timedelta(days=1)
    approved_day = ist_day(approved)
    cutoff = end if approved_day > end else approved_day - timedelta(days=1)
    docs = {str(doc) for doc in (own_docs or set()) if doc}
    out: dict[str, dict[str, Any]] = {}
    # Only rows entered after the approval can be such a change: read just those (checker r2: a second
    # whole-history read for every item touched since the approval).
    for move in book_movements(db, plant_id, items if items is not None else book_items(db, plant_id), until=cutoff, entered_after=_naive_datetime(approved), places=False):
        if move["kind"] == SPLIT_KIND:
            continue
        source = move["source"]
        raw = source.get("at")
        if not raw or (source.get("doc") and str(source.get("doc")) in docs):
            continue
        try:
            at = datetime.fromisoformat(str(raw))
        except ValueError:
            continue
        if at <= approved:
            continue
        row = out.setdefault(move["item_id"], {"qty": 0.0, "rows": 0, "docs": [], "first_day": None})
        row["qty"] = _q3(row["qty"] + move["qty"])
        row["rows"] += 1
        doc = source.get("doc") or source.get("lot")
        if doc and doc not in row["docs"] and len(row["docs"]) < 5:
            row["docs"].append(doc)
        day = move["day"].isoformat()
        row["first_day"] = day if row["first_day"] is None or day < row["first_day"] else row["first_day"]
    return out
