"""RM inward calendar (spec 3, client 2026-10-28): arrivals, Owner approval into draft POs, sending.

An arrival is one ``procurement_plan_entries`` row in a hidden per plant-month container. It is
PROPOSED (Planner / Store / plant head, or "Suggest arrivals"), APPROVED by the Owner, then ON_PO:
a dated TENTATIVE ``purchase_line_schedules`` row on a DRAFT PO (one PO per vendor per ISO week,
``source='SCHEDULE'``). The PO keeps the hash of what the Owner approved; when the desk sends it
unchanged the Owner's schedule approval is the PO approval (``approval_source='SCHEDULE'``).

Router modules import this file, so the purchase-router helpers it needs are imported lazily.
"""
from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta
from decimal import Decimal, ROUND_HALF_UP
from typing import Any, Iterable, Optional

from fastapi import HTTPException
from sqlalchemy import func, text
from sqlalchemy.orm import Session

from ..models import (
    ItemMaster,
    PlanConversion,
    ProcurementPlan,
    ProcurementPlanEntry,
    PurchaseApprovalDecision,
    PurchaseLineSchedule,
    PurchaseOrder,
    PurchaseOrderLine,
    PurchaseOrderRevision,
    PurchaseOrderRevisionLine,
    RmCostSheet,
    RmCostVersion,
    StockAlertPolicy,
)
from .books import ist_day, ist_today
from .procurement import canonical_hash, month_start

CALENDAR_PLAN_NAME = "RM inward calendar"
CALENDAR_PLAN_STATUS = "CALENDAR"
RM_ITEM_TYPES = ("RAW_PAPER", "ADHESIVE", "PARCHMENT", "PACKAGING", "OTHER")
CLASS_OF_TYPE = {"RAW_PAPER": "PAPER", "ADHESIVE": "CHEMICAL", "PARCHMENT": "CHEMICAL", "OTHER": "CHEMICAL", "PACKAGING": "PACKING"}
# PO states whose dated rows are cover; drafts and POs waiting for approval are not commitments yet.
COUNTED_PO_STATUSES = {"APPROVED", "PARTIALLY_RECEIVED"}
OPEN_DRAFT_PO_STATUSES = {"DRAFT", "SUBMITTED"}
# The Owner sent the PO back: nothing will arrive until the desk revises it and he approves it again,
# so it is never cover (checker 2026-10-28: a rejected PO made a shortage look smaller).
RETURNED_PO_STATUSES = {"REJECTED", "REVISION_REQUIRED"}
CLOSED_PO_STATUSES = {"CANCELLED", "SHORT_CLOSED"}
STATE_LABELS = {
    "PROPOSED": "Proposed", "APPROVED": "Approved", "ON_PO": "On PO", "SENT": "Sent",
    "CONFIRMED": "Confirmed", "RECEIVED": "Received", "CANCELLED": "Cancelled", "REJECTED": "PO rejected",
}
# Same defaults as the purchase-order form, so a scheduled draft reads like a hand-made PO.
DEFAULT_PO_TERMS = {
    "payment_terms": "60 days from invoice date.",
    "freight_terms": "Freight included in landed rate.",
    "tax_terms": "GST extra as applicable.",
    "delivery_terms": "Delivery on the dates in the delivery schedule of this PO.",
    "test_report_terms": "Attach PB/GSM/RCT/COBB test report with each delivery.",
    "special_instruction": "FOR AMIGO INDUSTRIES UNIT-2",
}
VENDOR_DETAIL_KEYS = (
    "supplier_contact", "supplier_address", "supplier_gst_no", "supplier_legal_name", "supplier_pan_no",
    "supplier_state", "supplier_state_code", "supplier_phone", "supplier_email", "supplier_msme_no",
)
QTY = Decimal("0.001")


def _enum(value: Any) -> str:
    return str(getattr(value, "value", value) or "")


def _dec(value: Any) -> Decimal:
    return Decimal(str(value or 0))


def _q(value: Any) -> float:
    return float(_dec(value).quantize(QTY, rounding=ROUND_HALF_UP))


def iso_week_start(day: date) -> date:
    return day - timedelta(days=day.weekday())


def week_label(monday: date) -> str:
    return f"Week of {monday.day} {monday.strftime('%b %Y')}"


def indian_date(day: Optional[date]) -> str:
    return f"{day.day} {day.strftime('%b %Y')}" if day else "-"


def _en_in(value: Decimal, places: int) -> str:
    """1234567.5 -> "12,34,567.5" (Indian grouping, trailing zeros dropped)."""
    text = f"{abs(value):.{places}f}"
    whole, _, fraction = text.partition(".")
    fraction = fraction.rstrip("0")
    if len(whole) > 3:
        head, tail = whole[:-3], whole[-3:]
        groups = []
        while len(head) > 2:
            groups.insert(0, head[-2:])
            head = head[:-2]
        whole = ",".join([head, *groups, tail]) if head else ",".join([*groups, tail])
    return ("-" if value < 0 else "") + whole + (f".{fraction}" if fraction else "")


def qty_words(value: Any, uom: Optional[str]) -> str:
    """"1,234.5 kg", "40 pcs": plain words for reasons the desk and the Owner read."""
    unit = (uom or "").upper()
    return f"{_en_in(_dec(value), 0 if unit == 'PCS' else 3)} {UNIT_WORDS.get(unit, unit.lower())}".strip()


def rate_words(value: Any, uom: Optional[str]) -> str:
    """"₹44.50 / kg", "₹12 / piece"."""
    unit = (uom or "").upper()
    rate = _dec(value).quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)
    fraction = f"{rate:.4f}".split(".")[1].rstrip("0")
    text = _en_in(Decimal(int(rate)), 0) + (f".{fraction.ljust(2, '0')}" if fraction else "")
    return f"₹{text} / {'piece' if unit == 'PCS' else UNIT_WORDS.get(unit, unit.lower())}"


UNIT_WORDS = {"KG": "kg", "PCS": "pcs", "L": "L", "MT": "t"}


def material_name(line: Any) -> str:
    item = getattr(line, "item", None)
    return (item.name or item.item_code) if item else str(getattr(line, "item_id", "material"))


# ---------------------------------------------------------------- who may do what (spec 2.8)

# View the calendar, its supply and Expected arrivals (Owner and Admin pass require_role as super roles).
CALENDAR_VIEWERS = ["PlantManager", "Planner", "Store", "GRN"]
# Propose / move arrivals, and the purchase desk that sends and records vendor confirmations. Spec 2.8
# leaves Admin out of both, so these use desk_role, not require_role (which lets Admin through).
CALENDAR_PROPOSERS = ["Planner", "Store", "PlantManager", "Owner"]
PURCHASE_DESK = ["Store", "Planner", "PlantManager", "Owner"]


def desk_role(roles: list[str], message: str):
    """FastAPI dependency: one of ``roles`` in effect now; "Owner" means a real Owner (Admin alone fails)."""
    from fastapi import Depends

    from ..utils.auth import get_current_user, is_actual_owner

    named = {role for role in roles if role != "Owner"}

    def checker(current_user: dict = Depends(get_current_user)) -> dict:
        if ("Owner" in roles and is_actual_owner(current_user)) or named & set(current_user.get("roles") or []):
            return current_user
        raise HTTPException(403, message)
    return checker


# ---------------------------------------------------------------- containers and defaults


def calendar_plan(db: Session, plant_id: str, day: date, actor: str) -> ProcurementPlan:
    """The hidden per plant-month container for calendar arrivals; made once, safe under concurrency."""
    month = month_start(day)
    db.execute(text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"), {"key": f"rm-calendar:{plant_id}:{month.isoformat()}"})
    plan = db.query(ProcurementPlan).filter(
        ProcurementPlan.plant_id == plant_id, ProcurementPlan.month == month, ProcurementPlan.name == CALENDAR_PLAN_NAME,
    ).first()
    if plan:
        return plan
    request_id = uuid.uuid5(uuid.NAMESPACE_URL, f"rm-calendar:{plant_id}:{month.isoformat()}")
    plan = ProcurementPlan(plant_id=plant_id, month=month, request_id=request_id,
        request_fingerprint=canonical_hash({"calendar": str(plant_id), "month": month.isoformat()}),
        name=CALENDAR_PLAN_NAME, status=CALENDAR_PLAN_STATUS, target_mode="ARRIVAL", working_calendar={"kind": "RM_INWARD_CALENDAR"},
        created_by=actor)
    db.add(plan)
    db.flush()
    return plan


def is_calendar_plan(plan: Optional[ProcurementPlan]) -> bool:
    return bool(plan) and plan.name == CALENDAR_PLAN_NAME and plan.status == CALENDAR_PLAN_STATUS


def _effective_cost(db: Session, plant_id: str, item_id: Any, as_of: date) -> Optional[RmCostVersion]:
    sheet = db.query(RmCostSheet).filter(RmCostSheet.plant_id == plant_id, RmCostSheet.item_id == item_id, RmCostSheet.currency == "INR").first()
    if not sheet:
        return None
    return db.query(RmCostVersion).filter(
        RmCostVersion.sheet_id == sheet.id,
        RmCostVersion.status.in_(["ACTIVE", "SCHEDULED"]),
        RmCostVersion.effective_from <= as_of,
        (RmCostVersion.effective_to.is_(None)) | (RmCostVersion.effective_to > as_of),
    ).order_by(RmCostVersion.effective_from.desc(), RmCostVersion.version_no.desc()).first()


def _approved_rate_rows(db: Session, plant_id: str):
    """Rates the Owner approved: lines of APPROVED PO revisions (a normal Owner approval, a send on the
    Owner's schedule approval, or a dates-only revision), newest approval first. A rate typed on a
    draft nobody approved yet is never "the vendor's last rate" (checker 2026-10-28)."""
    return (
        db.query(PurchaseOrderRevisionLine.item_id, PurchaseOrder.supplier_id, PurchaseOrder.supplier_name_snapshot,
                 PurchaseOrderRevisionLine.unit_rate, PurchaseOrder.po_no)
        .join(PurchaseOrderRevision, PurchaseOrderRevision.id == PurchaseOrderRevisionLine.revision_id)
        .join(PurchaseOrder, PurchaseOrder.id == PurchaseOrderRevision.purchase_order_id)
        .filter(PurchaseOrder.plant_id == plant_id, PurchaseOrderRevision.approval_state == "APPROVED",
                PurchaseOrder.status.notin_(["CANCELLED", "REJECTED"]), PurchaseOrderRevisionLine.unit_rate > 0)
        .order_by(PurchaseOrderRevision.approved_at.desc().nullslast(), PurchaseOrderRevision.revision_no.desc())
    )


def default_rate(db: Session, plant_id: str, supplier_id: Any, item_id: Any, as_of: Optional[date] = None) -> tuple[float, str]:
    """Rate for a scheduled draft line: the vendor's last Owner-approved PO rate for the item, else the
    RM costing base rate (never the landed rate: freight is not the vendor's price), else 0 = "rate needed"."""
    if supplier_id:
        last = (
            _approved_rate_rows(db, plant_id)
            .filter(PurchaseOrder.supplier_id == supplier_id, PurchaseOrderRevisionLine.item_id == item_id)
            .first()
        )
        if last and float(last[3] or 0) > 0:
            return float(last[3]), "VENDOR_LAST_PO"
    cost = _effective_cost(db, plant_id, item_id, as_of or ist_today())
    if cost and float(cost.base_cost or 0) > 0:
        return float(cost.base_cost), "RM_COSTING"
    return 0.0, "RATE_NEEDED"


class RateBook:
    """Every rate the calendar needs, read in three queries instead of two or three per material
    (checker 2026-10-29: the 12-week calendar took 3.6 s). Same rule as ``default_rate``: the vendor's
    last Owner-approved PO rate for the item, else the RM costing base rate, else "rate needed"."""

    def __init__(self, db: Session, plant_id: str, item_ids: Iterable[Any], as_of: Optional[date] = None):
        wanted = list({uuid.UUID(str(value)) for value in item_ids if value})
        self.vendor_rate: dict[tuple[str, str], float] = {}
        self.last_vendor: dict[str, dict[str, Any]] = {}
        self.cost: dict[str, float] = {}
        if not wanted:
            return
        for item_id, supplier_id, supplier_name, rate, po_no in _approved_rate_rows(db, plant_id).filter(
                PurchaseOrderRevisionLine.item_id.in_(wanted)).all():
            self.vendor_rate.setdefault((str(supplier_id), str(item_id)), float(rate or 0))
            self.last_vendor.setdefault(str(item_id), {"supplier_id": str(supplier_id), "supplier_name": supplier_name,
                                                       "rate": float(rate or 0), "po_no": po_no})
        day = as_of or ist_today()
        sheets = dict(db.query(RmCostSheet.id, RmCostSheet.item_id).filter(
            RmCostSheet.plant_id == plant_id, RmCostSheet.item_id.in_(wanted), RmCostSheet.currency == "INR").all())
        if sheets:
            versions = db.query(RmCostVersion.sheet_id, RmCostVersion.base_cost).filter(
                RmCostVersion.sheet_id.in_(list(sheets)),
                RmCostVersion.status.in_(["ACTIVE", "SCHEDULED"]),
                RmCostVersion.effective_from <= day,
                (RmCostVersion.effective_to.is_(None)) | (RmCostVersion.effective_to > day),
            ).order_by(RmCostVersion.effective_from.desc(), RmCostVersion.version_no.desc()).all()
            for sheet_id, base_cost in versions:
                self.cost.setdefault(str(sheets[sheet_id]), float(base_cost or 0))

    def rate(self, supplier_id: Any, item_id: Any) -> tuple[float, str]:
        if supplier_id:
            last = self.vendor_rate.get((str(supplier_id), str(item_id)))
            if last and last > 0:
                return last, "VENDOR_LAST_PO"
        cost = self.cost.get(str(item_id))
        if cost and cost > 0:
            return cost, "RM_COSTING"
        return 0.0, "RATE_NEEDED"


def last_vendors(db: Session, plant_id: str, item_ids: Iterable[Any]) -> dict[str, dict[str, Any]]:
    """Most recent vendor per item, from Owner-approved PO revisions only (drafts are not decisions)."""
    wanted = list({str(value) for value in item_ids})
    if not wanted:
        return {}
    rows = _approved_rate_rows(db, plant_id).filter(
        PurchaseOrderRevisionLine.item_id.in_([uuid.UUID(value) for value in wanted])).all()
    found: dict[str, dict[str, Any]] = {}
    for item_id, supplier_id, supplier_name, rate, po_no in rows:
        key = str(item_id)
        if key not in found:
            found[key] = {"supplier_id": str(supplier_id), "supplier_name": supplier_name,
                          "rate": float(rate or 0), "po_no": po_no}
    return found


def incoming_qc_pending(db: Session, plant_id: str, item_ids: Iterable[Any]) -> dict[str, float]:
    """Stock waiting for incoming QC, per item (spec 3 "QC pending"): lots and reels on QC hold that
    came in on a GRN (purchase or manual) and that nobody has failed, held or rejected yet.

    A count gain put on hold, a failed lot waiting for a decision or a plant-head hold is not
    "arriving tomorrow", so it is not cover."""
    from ..models import InventoryQualityHold, InventoryQualityInspection, PaperReel, ReceiptStockAllocation, StockBatch, StockTransaction

    wanted = [uuid.UUID(str(value)) for value in item_ids]
    if not wanted:
        return {}
    batches = db.query(StockBatch.id, StockBatch.item_id).filter(
        StockBatch.plant_id == str(plant_id), StockBatch.item_id.in_(wanted), StockBatch.stock_status == "QC_HOLD",
        db.query(ReceiptStockAllocation.id).filter(ReceiptStockAllocation.batch_id == StockBatch.id).exists(),
    ).all()
    try:
        plant_uuid = uuid.UUID(str(plant_id))
    except ValueError:
        plant_uuid = None
    reels = db.query(PaperReel.id, PaperReel.paper_id, PaperReel.current_weight_kg).filter(
        PaperReel.plant_id == plant_uuid, PaperReel.paper_id.in_(wanted), PaperReel.stock_status == "QC_HOLD",
        PaperReel.current_weight_kg > 0, PaperReel.purchase_receipt_line_id.isnot(None),
    ).all() if plant_uuid else []
    entity_ids = [row[0] for row in batches] + [row[0] for row in reels]
    if not entity_ids:
        return {}
    decided: set[Any] = set()
    for entity_id, status, disposition in db.query(InventoryQualityInspection.entity_id, InventoryQualityInspection.status,
            InventoryQualityInspection.disposition).filter(InventoryQualityInspection.entity_id.in_(entity_ids)).all():
        if str(status or "").upper() in {"FAIL", "INVALID", "INCOMPLETE"} or str(disposition or "").upper() in {"HOLD", "REJECT", "BLOCK", "SCRAP"}:
            decided.add(entity_id)
    decided.update(row[0] for row in db.query(InventoryQualityHold.entity_id).filter(
        InventoryQualityHold.entity_id.in_(entity_ids), InventoryQualityHold.status == "HOLD").all())
    out: dict[str, Decimal] = {}
    batch_ids = [batch_id for batch_id, _ in batches if batch_id not in decided]
    held = dict(db.query(StockTransaction.batch_id, func.sum(StockTransaction.qty_change)).filter(
        StockTransaction.batch_id.in_(batch_ids), StockTransaction.stock_status == "QC_HOLD",
    ).group_by(StockTransaction.batch_id).all()) if batch_ids else {}
    for batch_id, item_id in batches:
        if batch_id in decided:
            continue
        out[str(item_id)] = out.get(str(item_id), Decimal(0)) + max(Decimal(0), _dec(held.get(batch_id)))
    for reel_id, item_id, weight in reels:
        if reel_id in decided:
            continue
        out[str(item_id)] = out.get(str(item_id), Decimal(0)) + _dec(weight)
    return {key: _q(value) for key, value in out.items() if value > 0}


def active_policies(db: Session, plant_id: str) -> dict[str, StockAlertPolicy]:
    rows = db.query(StockAlertPolicy).filter(StockAlertPolicy.plant_id == plant_id, StockAlertPolicy.status == "ACTIVE",
        StockAlertPolicy.item_id.isnot(None)).order_by(StockAlertPolicy.version.desc()).all()
    policies: dict[str, StockAlertPolicy] = {}
    for row in rows:
        policies.setdefault(str(row.item_id), row)
    return policies


# ---------------------------------------------------------------- hash and draft revision


def _row_open(row: PurchaseLineSchedule) -> Decimal:
    return max(Decimal(0), _dec(row.scheduled_qty) - _dec(row.received_qty) - _dec(row.cancelled_qty))


# What the vendor reads on the PO besides quantities, rates and dates. A desk edit to any of these after
# the Owner approved the arrivals sends the PO back through Submit → Owner approval (spec 3; checker
# 2026-10-29: terms, specs and the QC tick could change and still go out "approved by the Owner").
PO_TERM_LABELS = {
    "supplier_name": "Vendor name", "supplier_contact": "Vendor contact", "supplier_address": "Vendor address",
    "supplier_gst_no": "Vendor GSTIN", "supplier_legal_name": "Vendor legal name", "supplier_pan_no": "Vendor PAN",
    "supplier_state": "Vendor state", "supplier_state_code": "Vendor state code", "supplier_phone": "Vendor phone",
    "supplier_email": "Vendor email", "supplier_msme_no": "Vendor MSME number", "legal_entity": "Buyer name",
    "payment_terms": "Payment terms", "freight_terms": "Freight terms", "tax_terms": "Tax terms",
    "delivery_terms": "Delivery terms", "test_report_terms": "Test report terms", "special_instruction": "Special instruction",
    "expected_date": "Expected date", "notes": "PO note",
}
# Line metadata the system keeps for itself (where the rate came from), never printed as a spec.
INTERNAL_LINE_KEYS = {"rate_source", "rate_needed", "source"}


def _plain(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, str):
        return value.strip() or None
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float, Decimal)):
        # 230, 230.0 and Decimal("230.000") are the same figure on paper.
        return format(Decimal(str(value)).normalize(), "f")
    return value


def po_terms(order: PurchaseOrder) -> dict[str, Any]:
    """The order-level words the vendor reads: vendor facts, terms, expected date and the PO note."""
    metadata = dict(order.metadata_json or {})
    values = {key: _plain(metadata.get(key)) for key in PO_TERM_LABELS if key not in {"supplier_name", "expected_date", "notes"}}
    values.update(supplier_name=_plain(order.supplier_name_snapshot), expected_date=_plain(order.expected_date), notes=_plain(order.notes))
    return {key: value for key, value in values.items() if value is not None}


def line_terms(line: PurchaseOrderLine) -> dict[str, Any]:
    """A line's specification, note, QC tick and unit count: everything on it but qty, rate and dates."""
    spec = {key: _plain(value) for key, value in dict(line.metadata_json or {}).items() if key not in INTERNAL_LINE_KEYS}
    # A blank description prints the material name, so the two are the same to the vendor.
    spec["description"] = spec.get("description") or (_plain(line.item.name) if getattr(line, "item", None) else None)
    unit_count = _plain(line.expected_unit_count)
    return {
        "spec": {key: value for key, value in sorted(spec.items()) if value is not None},
        # Every PO line needs incoming QC (C2), so an old false never makes a PO look changed.
        "note": _plain(line.notes), "qc": True,
        # The basis means nothing without a count (the PO form sends ESTIMATED by default).
        "unit_count": [unit_count, _plain(line.count_basis) or "ESTIMATED"] if unit_count else None,
    }


def schedule_hash_for(order: PurchaseOrder, rows_by_line: dict[Any, list[PurchaseLineSchedule]]) -> str:
    """Vendor + items + qty + rate + dated rows (what the Owner approved on the calendar), plus every term,
    vendor fact and line specification the PO prints, so any change after his approval shows."""
    lines = []
    for line in order.lines or []:
        rows = sorted(
            (row.current_date.isoformat(), f"{(_dec(row.scheduled_qty) - _dec(row.cancelled_qty)).quantize(QTY)}")
            for row in rows_by_line.get(line.id, []) if row.confirmation_status != "CANCELLED"
        )
        lines.append({"item_id": str(line.item_id), "qty": f"{_dec(line.qty_ordered).quantize(QTY)}",
                      "rate": f"{_dec(line.unit_cost).quantize(Decimal('0.0001'))}", "uom": line.uom, "rows": rows,
                      "terms": line_terms(line)})
    lines.sort(key=lambda row: (row["item_id"], row["qty"], row["rate"]))
    return canonical_hash({"supplier_id": str(order.supplier_id), "lines": lines, "terms": po_terms(order)})


def schedule_hash(db: Session, order: PurchaseOrder) -> str:
    db.flush()
    line_ids = [line.id for line in order.lines or []]
    rows = db.query(PurchaseLineSchedule).filter(PurchaseLineSchedule.purchase_order_line_id.in_(line_ids)).all() if line_ids else []
    grouped: dict[Any, list[PurchaseLineSchedule]] = {}
    for row in rows:
        grouped.setdefault(row.purchase_order_line_id, []).append(row)
    return schedule_hash_for(order, grouped)


def serialized_schedule_hash(order: PurchaseOrder) -> str:
    """Same hash from the loaded relationships (read paths, no flush)."""
    return schedule_hash_for(order, {line.id: list(line.schedules or []) for line in order.lines or []})


def approved_snapshot(order: PurchaseOrder, rows_by_line: Optional[dict[Any, list[PurchaseLineSchedule]]] = None) -> dict[str, Any]:
    """What the Owner approved, in words-ready form: vendor, and per material its qty, rate and dated rows.
    Kept next to the hash so the desk can be told exactly what changed since (checker 2026-10-28)."""
    lines = {}
    for line in order.lines or []:
        rows = (rows_by_line or {}).get(line.id) if rows_by_line is not None else list(line.schedules or [])
        lines[str(line.item_id)] = {
            "name": material_name(line), "uom": line.uom, "qty": f"{_dec(line.qty_ordered).quantize(QTY)}",
            "rate": f"{_dec(line.unit_cost).quantize(Decimal('0.0001'))}",
            "rows": sorted([row.current_date.isoformat(), f"{(_dec(row.scheduled_qty) - _dec(row.cancelled_qty)).quantize(QTY)}"]
                           for row in rows or [] if row.confirmation_status != "CANCELLED"),
            "terms": line_terms(line),
        }
    return {"supplier_id": str(order.supplier_id), "supplier_name": order.supplier_name_snapshot, "lines": lines, "terms": po_terms(order)}


def stamp_approved(db: Session, order: PurchaseOrder, actor: Optional[str] = None) -> None:
    """Record the PO's current content as what the Owner approved (hash + a readable snapshot)."""
    db.flush()
    rows = _order_rows(db, order)
    grouped: dict[Any, list[PurchaseLineSchedule]] = {}
    for row in rows:
        grouped.setdefault(row.purchase_order_line_id, []).append(row)
    order.approved_schedule_hash = schedule_hash_for(order, grouped)
    order.metadata_json = {**dict(order.metadata_json or {}), "approved_schedule": approved_snapshot(order, grouped)}
    if actor:
        order.scheduled_by, order.scheduled_at = actor, datetime.utcnow()


def _short_dates(rows: list[list[str]]) -> str:
    return ", ".join(f"{date.fromisoformat(day).day} {date.fromisoformat(day).strftime('%b')}" for day, _ in rows) or "no date"


def change_reasons(order: PurchaseOrder) -> list[str]:
    """Plain list of what changed after the Owner's approval: vendor, quantity, rate, dates."""
    approved = (order.metadata_json or {}).get("approved_schedule")
    if not approved:
        return ["Something changed after the Owner approved the arrivals (quantity, date, vendor or rate)."]
    now = approved_snapshot(order)
    out: list[str] = []
    if approved.get("supplier_id") != now["supplier_id"]:
        out.append(f"Vendor changed from {approved.get('supplier_name') or 'the approved vendor'} to {now['supplier_name']}.")
    before_lines = approved.get("lines") or {}
    for key, line in now["lines"].items():
        before = before_lines.get(key)
        name, uom = line["name"], line["uom"]
        if not before:
            out.append(f"{name} added: {qty_words(line['qty'], uom)}.")
            continue
        if _dec(before["qty"]) != _dec(line["qty"]):
            out.append(f"Quantity of {name} changed from {qty_words(before['qty'], uom)} to {qty_words(line['qty'], uom)}.")
        if _dec(before["rate"]) != _dec(line["rate"]):
            out.append(f"Rate for {name} filled in: {rate_words(line['rate'], uom)}." if _dec(before["rate"]) <= 0
                       else f"Rate for {name} changed from {rate_words(before['rate'], uom)} to {rate_words(line['rate'], uom)}.")
        if [row[0] for row in before.get("rows") or []] != [row[0] for row in line["rows"]]:
            out.append(f"Delivery dates of {name} changed from {_short_dates(before.get('rows') or [])} to {_short_dates(line['rows'])}.")
        elif before.get("rows") != line["rows"]:
            out.append(f"Delivery quantities of {name} changed.")
        if "terms" in before:
            out.extend(_line_term_reasons(name, before["terms"] or {}, line["terms"]))
    for key, line in before_lines.items():
        if key not in now["lines"]:
            out.append(f"{line.get('name') or 'A material'} removed.")
    if "terms" in approved:
        before_terms, now_terms = approved.get("terms") or {}, now["terms"]
        for key, label in PO_TERM_LABELS.items():
            if before_terms.get(key) == now_terms.get(key) or (key == "supplier_name" and approved.get("supplier_id") != now["supplier_id"]):
                continue
            if key == "expected_date" and before_terms.get(key) and now_terms.get(key):
                out.append(f"Expected date changed from {indian_date(date.fromisoformat(before_terms[key]))} to {indian_date(date.fromisoformat(now_terms[key]))}.")
            else:
                out.append(f"{label} changed.")
    return out or ["Something changed after the Owner approved the arrivals (quantity, date, vendor, rate, terms or specification)."]


def _line_term_reasons(name: str, before: dict[str, Any], now: dict[str, Any]) -> list[str]:
    out: list[str] = []
    # No QC reason: every PO line needs incoming QC and the server stores it so (C2, 30 Oct).
    if (before.get("spec") or {}) != (now.get("spec") or {}):
        out.append(f"Specification of {name} changed.")
    if before.get("note") != now.get("note"):
        out.append(f"Line note of {name} changed.")
    if before.get("unit_count") != now.get("unit_count"):
        out.append(f"Unit count of {name} changed.")
    return out


def send_check(order: PurchaseOrder) -> dict[str, Any]:
    """Can the desk send this PO now, and on whose approval? Plain reasons for the PO page."""
    needing = [line for line in order.lines or [] if float(line.unit_cost or 0) <= 0]
    rate_needed = [line.item.item_code if line.item else str(line.item_id) for line in needing]
    unchanged = bool(order.source == "SCHEDULE" and order.approved_schedule_hash
                     and serialized_schedule_hash(order) == order.approved_schedule_hash)
    reasons: list[str] = []
    changes: list[str] = []
    if order.status == "DRAFT":
        if order.source != "SCHEDULE":
            reasons.append("Hand-made POs need the Owner's approval before sending.")
        elif not unchanged:
            changes = change_reasons(order)
            reasons.extend(changes)
        if needing:
            reasons.append(f"Rate needed for {', '.join(material_name(line) for line in needing)}.")
    mode = (
        "SEND_ON_SCHEDULE" if order.status == "DRAFT" and unchanged and not rate_needed
        else "SUBMIT_FOR_APPROVAL" if order.status in {"DRAFT", "REJECTED", "REVISION_REQUIRED"}
        else "WAITING_APPROVAL" if order.status == "SUBMITTED"
        else "SEND" if order.status in COUNTED_PO_STATUSES
        else "CLOSED"
    )
    return {"mode": mode, "unchanged_since_owner_approval": unchanged, "rate_needed": rate_needed,
            "rate_needed_names": [material_name(line) for line in needing], "changes": changes, "reasons": reasons}


def refresh_draft_revision(db: Session, order: PurchaseOrder, actor: str) -> PurchaseOrderRevision:
    """Rewrite the current DRAFT revision from the PO lines (a draft nobody has submitted yet).

    Revision lines are updated in place so delivery rows keep pointing at them."""
    from ..routers.purchase import _persist_revision, _revision_snapshot  # lazy: the router imports this module

    db.flush()
    revision = db.query(PurchaseOrderRevision).filter(
        PurchaseOrderRevision.purchase_order_id == order.id,
        PurchaseOrderRevision.revision_no == order.current_revision_no,
    ).with_for_update().first()
    lines = list(order.lines or [])
    if revision is None:
        revision = _persist_revision(db, order, lines, revision_no=int(order.current_revision_no or 1), request_id=order.request_id or uuid.uuid4(), actor=actor)
        db.flush()
        return revision
    if revision.approval_state != "DRAFT":
        raise HTTPException(409, f"{order.po_no} is no longer a draft; reload the calendar")
    snapshot = _revision_snapshot(order, lines)
    revision.snapshot_json = snapshot
    revision.content_hash = canonical_hash(snapshot)
    existing = {row.source_order_line_id: row for row in revision.lines or []}
    for line in lines:
        revision_line = existing.pop(line.id, None)
        if revision_line is None:
            db.add(PurchaseOrderRevisionLine(revision_id=revision.id, logical_line_id=line.logical_line_id, source_order_line_id=line.id,
                item_id=line.item_id, qty_ordered=line.qty_ordered, unit_rate=line.unit_cost, uom=line.uom,
                expected_unit_count=line.expected_unit_count, count_basis=line.count_basis,
                specification_json=dict(line.metadata_json or {}), delivery_date=order.expected_date))
        else:
            revision_line.qty_ordered = line.qty_ordered
            revision_line.unit_rate = line.unit_cost
            revision_line.uom = line.uom
            revision_line.specification_json = dict(line.metadata_json or {})
            revision_line.delivery_date = order.expected_date
    for stale in existing.values():
        db.query(PurchaseLineSchedule).filter(PurchaseLineSchedule.revision_line_id == stale.id).update({"revision_line_id": None})
        db.delete(stale)
    db.flush()
    db.expire(revision, ["lines"])
    return revision


def _revision_line_for(db: Session, order: PurchaseOrder, line: PurchaseOrderLine) -> Optional[PurchaseOrderRevisionLine]:
    revision = db.query(PurchaseOrderRevision).filter(
        PurchaseOrderRevision.purchase_order_id == order.id, PurchaseOrderRevision.revision_no == order.current_revision_no).first()
    if not revision:
        return None
    return next((row for row in revision.lines or [] if row.source_order_line_id == line.id), None)


def _sync_order_dates(order: PurchaseOrder, rows: Iterable[PurchaseLineSchedule]) -> None:
    dates = [row.current_date for row in rows if row.confirmation_status != "CANCELLED"]
    if dates:
        order.expected_date = min(dates)


def _order_rows(db: Session, order: PurchaseOrder) -> list[PurchaseLineSchedule]:
    line_ids = [line.id for line in order.lines or []]
    return db.query(PurchaseLineSchedule).filter(PurchaseLineSchedule.purchase_order_line_id.in_(line_ids)).all() if line_ids else []


def _row_change(row: PurchaseLineSchedule, actor: str, reason: str, *, status: Optional[str] = None) -> None:
    row.change_history = [*(row.change_history or []), {
        "version": int(row.version or 1) + 1, "previous_date": row.current_date.isoformat(), "current_date": row.current_date.isoformat(),
        "previous_status": row.confirmation_status, "status": status or row.confirmation_status, "reason": reason, "actor": actor,
        "changed_at": datetime.utcnow().isoformat() + "Z",
    }]
    row.version = int(row.version or 1) + 1


def sync_rows_to_lines(db: Session, order: PurchaseOrder, actor: str, *, revision_no: int, default_note: str,
                       revision_lines: Optional[dict[Any, Any]] = None, vendor_changed: bool = False,
                       lines: Optional[list[PurchaseOrderLine]] = None) -> None:
    """After a PO revision, make every line's dated delivery rows add up to its ordered quantity.

    The PO line is the commitment: a desk quantity change must reach the delivery rows, or the
    calendar cover, Expected arrivals and the vendor's PDF keep the old quantity (checker
    2026-10-28). A cut comes off the latest open rows first (never a received part; a row left
    with nothing becomes CANCELLED); an increase goes on the latest row nothing was received on,
    else on a new row. Calendar arrivals on those rows follow, and every change is in the row history."""
    today = ist_today()
    revision_lines = revision_lines or {}
    for line in lines if lines is not None else list(order.lines or []):
        rows = db.query(PurchaseLineSchedule).filter(PurchaseLineSchedule.purchase_order_line_id == line.id).with_for_update().all()
        active = [row for row in rows if row.confirmation_status != "CANCELLED"]
        for row in active:
            if revision_lines.get(line.id):
                row.revision_line_id = revision_lines[line.id]
        target = max(Decimal(0), _dec(line.qty_ordered) - _dec(line.qty_short_closed))
        planned = sum((_dec(row.scheduled_qty) - _dec(row.cancelled_qty) for row in active), Decimal(0))
        delta = target - planned
        reason = f"Quantity changed in revision {revision_no}"
        if not rows:
            raw = (line.metadata_json or {}).get("delivery_date")
            try:
                day = date.fromisoformat(str(raw)[:10]) if raw else order.expected_date
            except ValueError:
                day = order.expected_date
            if day and target > 0:
                db.add(PurchaseLineSchedule(plant_id=order.plant_id, purchase_order_line_id=line.id, scheduled_qty=float(target),
                    promised_date=day, current_date=day, confirmation_status="TENTATIVE", notes=default_note, created_by=actor,
                    revision_line_id=revision_lines.get(line.id), cancelled_qty=0, version=1, change_history=[]))
        elif delta > QTY:
            fresh = sorted((row for row in active if _dec(row.received_qty) <= 0), key=lambda row: row.current_date)
            if fresh:
                row = fresh[-1]
                _row_change(row, actor, f"{reason}: {_q(_dec(row.scheduled_qty) - _dec(row.cancelled_qty))} → {_q(_dec(row.scheduled_qty) - _dec(row.cancelled_qty) + delta)}")
                row.scheduled_qty = float(_dec(row.scheduled_qty) + delta)
            else:
                latest = max((row.current_date for row in rows), default=today)
                day = max(latest, today)
                db.add(PurchaseLineSchedule(plant_id=order.plant_id, purchase_order_line_id=line.id, scheduled_qty=float(delta),
                    promised_date=day, current_date=day, confirmation_status="TENTATIVE", notes=f"Added in revision {revision_no}",
                    created_by=actor, revision_line_id=revision_lines.get(line.id), cancelled_qty=0, version=1, change_history=[]))
        elif delta < -QTY:
            cut = -delta
            for row in sorted(active, key=lambda value: (value.current_date, value.created_at or datetime.min), reverse=True):
                if cut <= 0:
                    break
                free = _dec(row.scheduled_qty) - _dec(row.cancelled_qty) - _dec(row.received_qty)
                take = min(max(free, Decimal(0)), cut)
                if take <= 0:
                    continue
                before = _dec(row.scheduled_qty) - _dec(row.cancelled_qty)
                if before - take <= QTY:
                    # Nothing left on this row (nothing was received on it either): keep it as history.
                    _row_change(row, actor, f"{reason}: {_q(before)} → 0", status="CANCELLED")
                    row.cancelled_qty = float(_dec(row.scheduled_qty))
                    row.confirmation_status = "CANCELLED"
                    row.cancelled_at = datetime.utcnow()
                else:
                    _row_change(row, actor, f"{reason}: {_q(before)} → {_q(before - take)}")
                    row.scheduled_qty = float(_dec(row.scheduled_qty) - take)
                cut -= take
        db.flush()
        # Calendar arrivals on these rows follow their row (quantity, vendor, material).
        for row in rows:
            for entry in db.query(ProcurementPlanEntry).filter(ProcurementPlanEntry.schedule_row_id == row.id).all():
                entry.item_id = line.item_id
                if vendor_changed:
                    entry.supplier_id, entry.supplier_name_snapshot = order.supplier_id, order.supplier_name_snapshot
                if row.confirmation_status == "CANCELLED":
                    if entry.approval_status != "CANCELLED":
                        entry.approval_status = "CANCELLED"
                        entry.cancelled_by, entry.cancelled_at = actor, datetime.utcnow()
                        entry.notes = ((f"{entry.notes} · " if entry.notes else "") + f"Removed when {order.po_no} revision {revision_no} cut the quantity")[:1000]
                else:
                    entry.qty_kg = _dec(row.scheduled_qty) - _dec(row.cancelled_qty)
                entry.updated_by, entry.updated_at = actor, datetime.utcnow()
    db.flush()


# ---------------------------------------------------------------- arrivals


def entry_payload(entry: ProcurementPlanEntry) -> dict[str, Any]:
    return {
        "id": str(entry.id), "item_id": str(entry.item_id),
        "item_code": entry.item.item_code if entry.item else None, "item_name": entry.item.name if entry.item else None,
        "uom": _enum(entry.item.uom) if entry.item else None,
        "entry_date": entry.entry_date.isoformat(), "qty": _q(entry.qty_kg),
        "supplier_id": str(entry.supplier_id) if entry.supplier_id else None, "supplier_name": entry.supplier_name_snapshot,
        "approval_status": entry.approval_status, "source": entry.source, "note": entry.notes,
        "proposed_by": entry.proposed_by, "proposed_at": entry.proposed_at.isoformat() if entry.proposed_at else None,
        "approved_by": entry.approved_by, "approved_at": entry.approved_at.isoformat() if entry.approved_at else None,
        "po_id": str(entry.po_id) if entry.po_id else None, "po_line_id": str(entry.po_line_id) if entry.po_line_id else None,
        "schedule_row_id": str(entry.schedule_row_id) if entry.schedule_row_id else None,
    }


def _check_item(db: Session, plant_id: str, item_id: Any) -> ItemMaster:
    item = db.query(ItemMaster).filter(ItemMaster.id == item_id, ItemMaster.plant_id == plant_id).first()
    if not item or _enum(item.type) not in RM_ITEM_TYPES:
        raise HTTPException(404, "Pick a raw material or packing item of this plant")
    return item


def propose_entries(db: Session, plant_id: str, rows: list[dict[str, Any]], actor: str) -> list[ProcurementPlanEntry]:
    today = ist_today()
    created: list[ProcurementPlanEntry] = []
    for index, row in enumerate(rows, start=1):
        item = _check_item(db, plant_id, row["item_id"])
        day: date = row["entry_date"]
        if day < today:
            raise HTTPException(422, f"Arrival {index}: pick today or a later day")
        qty = _dec(row["qty"])
        if qty <= 0:
            raise HTTPException(422, f"Arrival {index}: quantity must be more than 0")
        plan = calendar_plan(db, plant_id, day, actor)
        entry = ProcurementPlanEntry(plan_id=plan.id, entry_date=day, item_id=item.id,
            supplier_id=row.get("supplier_id"), supplier_name_snapshot=(row.get("supplier_name") or None),
            material_form="REEL" if _enum(item.tracking_mode) == "REEL" else "BULK", qty_kg=qty,
            status="PLANNED", notes=(row.get("note") or None), approval_status="PROPOSED",
            source=row.get("source") or "MANUAL", proposed_by=actor, proposed_at=datetime.utcnow(),
            updated_by=actor, updated_at=datetime.utcnow())
        db.add(entry)
        created.append(entry)
    db.flush()
    return created


def _load_entry(db: Session, plant_id: str, entry_id: Any, *, lock: bool = True) -> ProcurementPlanEntry:
    query = db.query(ProcurementPlanEntry).join(ProcurementPlan, ProcurementPlan.id == ProcurementPlanEntry.plan_id).filter(
        ProcurementPlanEntry.id == entry_id, ProcurementPlan.plant_id == plant_id)
    if lock:
        query = query.with_for_update(of=ProcurementPlanEntry)
    entry = query.first()
    if not entry or not is_calendar_plan(entry.plan):
        raise HTTPException(404, "Arrival not found in this plant")
    return entry


def _rehome(db: Session, plant_id: str, entry: ProcurementPlanEntry, day: date, actor: str) -> None:
    if month_start(day) != entry.plan.month:
        entry.plan_id = calendar_plan(db, plant_id, day, actor).id


def _lock_order(db: Session, order_id: Any) -> PurchaseOrder:
    order = db.query(PurchaseOrder).filter(PurchaseOrder.id == order_id).with_for_update().first()
    if not order:
        raise HTTPException(404, "Purchase order not found")
    return order


def update_entry(db: Session, plant_id: str, entry_id: Any, changes: dict[str, Any], actor: str, *, is_owner: bool) -> ProcurementPlanEntry:
    """Move / change an arrival. A proposal changes freely; an approved one only by the Owner."""
    entry = _load_entry(db, plant_id, entry_id)
    if entry.approval_status == "CANCELLED":
        raise HTTPException(409, "This arrival was cancelled")
    new_date: Optional[date] = changes.get("entry_date")
    new_qty = _dec(changes["qty"]) if changes.get("qty") is not None else None
    if new_qty is not None and new_qty <= 0:
        raise HTTPException(422, "Quantity must be more than 0; cancel the arrival instead")
    if new_date and new_date < ist_today() and new_date != entry.entry_date:
        raise HTTPException(422, "Pick today or a later day")
    vendor_change = "supplier_id" in changes and str(changes.get("supplier_id") or "") != str(entry.supplier_id or "")
    now = datetime.utcnow()
    if entry.approval_status == "PROPOSED":
        if new_date:
            _rehome(db, plant_id, entry, new_date, actor)
            entry.entry_date = new_date
        if new_qty is not None:
            entry.qty_kg = new_qty
        if vendor_change or "supplier_name" in changes:
            entry.supplier_id = changes.get("supplier_id")
            entry.supplier_name_snapshot = changes.get("supplier_name") or None
        if "note" in changes:
            entry.notes = changes.get("note") or None
        entry.updated_by, entry.updated_at = actor, now
        db.flush()
        return entry
    if not is_owner:
        raise HTTPException(403, "Only the Owner can change an approved arrival.")
    if vendor_change:
        raise HTTPException(409, "An approved arrival keeps its vendor. Cancel it and propose a new one for the other vendor.")
    if "note" in changes:
        entry.notes = changes.get("note") or None
    if entry.approval_status == "APPROVED" or not entry.po_id:
        if new_date:
            _rehome(db, plant_id, entry, new_date, actor)
            entry.entry_date = new_date
        if new_qty is not None:
            entry.qty_kg = new_qty
        entry.updated_by, entry.updated_at = actor, now
        db.flush()
        return entry
    order = _lock_order(db, entry.po_id)
    row = db.query(PurchaseLineSchedule).filter(PurchaseLineSchedule.id == entry.schedule_row_id).with_for_update().first()
    line = db.query(PurchaseOrderLine).filter(PurchaseOrderLine.id == entry.po_line_id).with_for_update().first()
    if not row or not line:
        raise HTTPException(409, "This arrival's delivery row is missing; refresh the calendar")
    if order.status in CLOSED_PO_STATUSES or order.status == "RECEIVED":
        raise HTTPException(409, f"{order.po_no} is closed; this arrival can no longer move")
    if order.status == "DRAFT":
        was_unchanged = bool(order.approved_schedule_hash) and schedule_hash(db, order) == order.approved_schedule_hash
        week = (order.metadata_json or {}).get("schedule_week")
        if new_date and order.source == "SCHEDULE" and week and iso_week_start(new_date).isoformat() != week:
            # Spec 3: one draft PO per vendor per ISO week. A move into another week takes the
            # arrival off this week's draft and puts it on (or makes) that week's draft.
            vendor_facts = {key: value for key, value in (order.metadata_json or {}).items()
                            if key in VENDOR_DETAIL_KEYS or key == "payment_terms"}
            _take_off_draft(db, order, entry, line, row, actor, was_unchanged=was_unchanged,
                            emptied_note="Every arrival moved to another week")
            _rehome(db, plant_id, entry, new_date, actor)
            entry.entry_date = new_date
            if new_qty is not None:
                entry.qty_kg = new_qty
            entry.approval_status = "APPROVED"
            entry.po_id = entry.po_line_id = entry.schedule_row_id = None
            entry.updated_by, entry.updated_at = actor, now
            db.flush()
            _place_on_week_drafts(db, plant_id, [entry], actor, now, {str(entry.supplier_id): vendor_facts})
            db.flush()
            return entry
        if new_qty is not None and new_qty != _dec(entry.qty_kg):
            delta = new_qty - _dec(entry.qty_kg)
            line.qty_ordered = float(_dec(line.qty_ordered) + delta)
            row.scheduled_qty = float(new_qty)
            entry.qty_kg = new_qty
        if new_date and new_date != row.current_date:
            row.current_date = new_date
            row.promised_date = new_date
            _rehome(db, plant_id, entry, new_date, actor)
            entry.entry_date = new_date
        row.version = int(row.version or 1) + 1
        _sync_order_dates(order, _order_rows(db, order))
        refresh_draft_revision(db, order, actor)
        order.version = int(order.version or 1) + 1
        if was_unchanged:
            # The Owner changed his own approved schedule: the new content is what he approved.
            stamp_approved(db, order)
            order.scheduled_at = now
        entry.updated_by, entry.updated_at = actor, now
        db.flush()
        return entry
    if new_qty is not None and new_qty != _dec(entry.qty_kg):
        raise HTTPException(409, f"{order.po_no} is past draft. Change the quantity on the PO itself (Edit / vendor change), which goes to the Owner again.")
    if not new_date or new_date == row.current_date:
        db.flush()
        return entry
    if order.status in {"SUBMITTED", "REJECTED", "REVISION_REQUIRED"}:
        _move_row(row, new_date, actor, f"Moved on the RM inward calendar by {actor}")
        row.promised_date = new_date
        _rehome(db, plant_id, entry, new_date, actor)
        entry.entry_date = new_date
        _sync_order_dates(order, _order_rows(db, order))
        order.version = int(order.version or 1) + 1
        entry.updated_by, entry.updated_at = actor, now
        db.flush()
        return entry
    # APPROVED / PARTIALLY_RECEIVED: the PO may already be with the vendor.
    if order.sent_at and not changes.get("confirm_po_change"):
        raise HTTPException(409, f"PO already sent — change the PO? {order.po_no} goes to the vendor again as a new revision with the new date.")
    old_date = row.current_date
    _move_row(row, new_date, actor, f"Moved by the Owner from {indian_date(old_date)} to {indian_date(new_date)}")
    _rehome(db, plant_id, entry, new_date, actor)
    entry.entry_date = new_date
    _sync_order_dates(order, _order_rows(db, order))
    _date_only_revision(db, order, actor, f"Delivery date moved from {indian_date(old_date)} to {indian_date(new_date)}")
    entry.updated_by, entry.updated_at = actor, now
    db.flush()
    return entry


def _move_row(row: PurchaseLineSchedule, new_date: date, actor: str, reason: str) -> None:
    row.change_history = [*(row.change_history or []), {
        "version": int(row.version or 1) + 1, "previous_date": row.current_date.isoformat(), "current_date": new_date.isoformat(),
        "previous_status": row.confirmation_status, "status": "TENTATIVE", "reason": reason, "actor": actor,
        "changed_at": datetime.utcnow().isoformat() + "Z",
    }]
    row.current_date = new_date
    row.confirmation_status = "TENTATIVE"
    row.version = int(row.version or 1) + 1


def _date_only_revision(db: Session, order: PurchaseOrder, actor: str, reason: str) -> PurchaseOrderRevision:
    """A new PO revision when only delivery dates of an approved PO move (qty and rates unchanged).

    The commercial content is the one already approved, so the revision is recorded as approved by
    the Owner who moved the date, and the PO must be sent to the vendor again."""
    from ..routers.purchase import _persist_revision

    previous = db.query(PurchaseOrderRevision).filter(PurchaseOrderRevision.purchase_order_id == order.id,
        PurchaseOrderRevision.revision_no == order.current_revision_no).first()
    order.current_revision_no = int(order.current_revision_no or 1) + 1
    revision = _persist_revision(db, order, list(order.lines or []), revision_no=order.current_revision_no,
        request_id=uuid.uuid4(), actor=actor, change_reason=reason)
    now = datetime.utcnow()
    revision.approval_state = "APPROVED"
    revision.approved_by = actor
    revision.approved_at = now
    db.add(PurchaseApprovalDecision(revision_id=revision.id, decision="APPROVED", content_hash=revision.content_hash, actor=actor,
        actor_role="Owner", reason=f"{reason}. Quantities and rates are as approved in revision {previous.revision_no if previous else '-'}."))
    metadata = dict(order.metadata_json or {})
    if order.sent_at:
        metadata["send_history"] = [*(metadata.get("send_history") or []), {"sent_at": order.sent_at.isoformat(), "sent_by": order.sent_by, "channel": order.sent_channel, "revision_no": int(order.current_revision_no) - 1}]
    metadata["resend_reason"] = reason
    order.metadata_json = metadata
    order.sent_at = order.sent_by = order.sent_channel = None
    order.vendor_confirmed_at = order.vendor_confirmed_by = None
    order.version = int(order.version or 1) + 1
    db.flush()
    return revision


def _take_off_draft(db: Session, order: PurchaseOrder, entry: ProcurementPlanEntry, line: Optional[PurchaseOrderLine],
                    row: Optional[PurchaseLineSchedule], actor: str, *, was_unchanged: bool, emptied_note: str) -> None:
    """Remove one arrival from its DRAFT PO: its dated row goes, its line shrinks (or goes), and a PO
    left with nothing is cancelled. A draft the Owner's approval still covers keeps that approval."""
    entry.schedule_row_id = None
    if row:
        db.delete(row)
    if line:
        remaining = _dec(line.qty_ordered) - _dec(entry.qty_kg)
        if remaining > 0:
            line.qty_ordered = float(remaining)
        else:
            revision_line = _revision_line_for(db, order, line)
            db.flush()
            for other in db.query(ProcurementPlanEntry).filter(ProcurementPlanEntry.po_line_id == line.id).all():
                other.po_line_id = None
            if revision_line:
                db.delete(revision_line)
            db.flush()
            order.lines.remove(line)
            db.delete(line)
    db.flush()
    if not order.lines:
        order.status = "CANCELLED"
        order.notes = (f"{order.notes or ''} · {emptied_note}").strip(" ·")[:500]
        revision = db.query(PurchaseOrderRevision).filter(PurchaseOrderRevision.purchase_order_id == order.id,
            PurchaseOrderRevision.revision_no == order.current_revision_no).first()
        if revision and revision.approval_state == "DRAFT":
            revision.approval_state = "WITHDRAWN"
    else:
        _sync_order_dates(order, _order_rows(db, order))
        refresh_draft_revision(db, order, actor)
        if was_unchanged:
            stamp_approved(db, order)
    order.version = int(order.version or 1) + 1
    db.flush()


def cancel_entry(db: Session, plant_id: str, entry_id: Any, actor: str, *, is_owner: bool, reason: Optional[str] = None) -> ProcurementPlanEntry:
    entry = _load_entry(db, plant_id, entry_id)
    if entry.approval_status == "CANCELLED":
        return entry
    now = datetime.utcnow()
    if entry.approval_status != "PROPOSED" and not is_owner:
        raise HTTPException(403, "Only the Owner can cancel an approved arrival.")
    if entry.approval_status == "ON_PO" and entry.po_id:
        order = _lock_order(db, entry.po_id)
        if order.status != "DRAFT":
            raise HTTPException(409, f"{order.po_no} is past draft. Short-close or cancel the PO to drop this arrival.")
        row = db.query(PurchaseLineSchedule).filter(PurchaseLineSchedule.id == entry.schedule_row_id).with_for_update().first()
        line = db.query(PurchaseOrderLine).filter(PurchaseOrderLine.id == entry.po_line_id).with_for_update().first()
        was_unchanged = bool(order.approved_schedule_hash) and schedule_hash(db, order) == order.approved_schedule_hash
        if not was_unchanged:
            raise HTTPException(409, f"The purchase desk changed {order.po_no} after your approval. Open the PO to change or cancel it.")
        _take_off_draft(db, order, entry, line, row, actor, was_unchanged=True, emptied_note="Every scheduled arrival was cancelled")
    entry.approval_status = "CANCELLED"
    entry.cancelled_by, entry.cancelled_at = actor, now
    entry.updated_by, entry.updated_at = actor, now
    if reason:
        entry.notes = f"{entry.notes + ' · ' if entry.notes else ''}Cancelled: {reason}"[:1000]
    db.flush()
    return entry


def _vendor_metadata(vendor_details: dict[str, Any] | None) -> dict[str, Any]:
    details = dict(vendor_details or {})
    meta = {key: details.get(key) for key in VENDOR_DETAIL_KEYS if details.get(key)}
    if details.get("payment_terms"):
        meta["payment_terms"] = details["payment_terms"]
    return meta


def approve_entries(db: Session, plant_id: str, entry_ids: list[Any], owner: str, *, request_id: Any,
                    vendor_details: Optional[dict[str, dict[str, Any]]] = None, vendor_master_checked: bool = False) -> dict[str, Any]:
    """Owner approval of one or many arrivals: each becomes a dated row on a DRAFT PO, one PO per
    vendor per ISO week, made or extended in this transaction. Idempotent by request and by entry.

    With ``vendor_master_checked`` (the BFF sends the plant's whole active vendor master), an arrival
    whose vendor is not in it is skipped, and the draft prints the master name."""
    payload_hash = canonical_hash({"entries": sorted(str(value) for value in entry_ids)})
    prior = db.query(PlanConversion).filter(PlanConversion.plant_id == plant_id, PlanConversion.request_id == request_id).first()
    if prior:
        if prior.payload_hash != payload_hash:
            raise HTTPException(409, "This approval request key was already used for other arrivals")
        return {"approved": [], "already": [str(value) for value in prior.entry_ids], "skipped": [],
                "purchase_orders": _po_summaries(db, prior.purchase_order_ids), "idempotent": True}
    entries = (
        db.query(ProcurementPlanEntry).join(ProcurementPlan, ProcurementPlan.id == ProcurementPlanEntry.plan_id)
        .filter(ProcurementPlanEntry.id.in_(entry_ids), ProcurementPlan.plant_id == plant_id)
        .order_by(ProcurementPlanEntry.entry_date, ProcurementPlanEntry.created_at)
        .with_for_update(of=ProcurementPlanEntry).all()
    )
    if len({str(row.id) for row in entries}) != len({str(value) for value in entry_ids}):
        raise HTTPException(404, "One or more arrivals were not found in this plant")
    now = datetime.utcnow()
    approved: list[ProcurementPlanEntry] = []
    already: list[str] = []
    skipped: list[dict[str, str]] = []
    for entry in entries:
        name = f"{(entry.item.name or entry.item.item_code) if entry.item else 'Material'} on {indian_date(entry.entry_date)}"
        if not is_calendar_plan(entry.plan):
            skipped.append({"id": str(entry.id), "reason": f"{name} is not a calendar arrival"})
        elif entry.approval_status in {"APPROVED", "ON_PO"}:
            already.append(str(entry.id))
        elif entry.approval_status == "CANCELLED":
            skipped.append({"id": str(entry.id), "reason": f"{name} was cancelled"})
        elif not entry.supplier_id or not entry.supplier_name_snapshot:
            skipped.append({"id": str(entry.id), "reason": f"{name} needs a vendor"})
        elif vendor_master_checked and str(entry.supplier_id) not in (vendor_details or {}):
            skipped.append({"id": str(entry.id), "reason": f"{name}: {entry.supplier_name_snapshot} is not an active vendor of this plant. Pick a vendor from the vendor list."})
        elif _dec(entry.qty_kg) <= 0:
            skipped.append({"id": str(entry.id), "reason": f"{name} has no quantity"})
        else:
            master_name = ((vendor_details or {}).get(str(entry.supplier_id)) or {}).get("supplier_name") if vendor_master_checked else None
            if master_name:
                entry.supplier_name_snapshot = master_name
            today = ist_today()
            if entry.entry_date < today:
                # Approved after its date: it is wanted now, so it goes on today (never a back-dated PO row).
                old_day = entry.entry_date
                _rehome(db, plant_id, entry, today, owner)
                entry.entry_date = today
                entry.notes = (f"{entry.notes} · " if entry.notes else "") + f"Proposed for {indian_date(old_day)}; approved late, so it comes on {indian_date(today)}"
                entry.notes = entry.notes[:1000]
            entry.approval_status = "APPROVED"
            entry.approved_by, entry.approved_at = owner, now
            entry.updated_by, entry.updated_at = owner, now
            approved.append(entry)
    touched = _place_on_week_drafts(db, plant_id, approved, owner, now, vendor_details)
    po_ids = list(dict.fromkeys(str(order.id) for order in touched))
    if entries:
        db.add(PlanConversion(plant_id=plant_id, request_id=request_id, plan_id=entries[0].plan_id,
            entry_ids=[str(entry.id) for entry in approved], purchase_order_ids=po_ids, payload_hash=payload_hash, created_by=owner))
    db.flush()
    return {"approved": [str(entry.id) for entry in approved], "already": already, "skipped": skipped,
            "purchase_orders": _po_summaries(db, po_ids), "idempotent": False}


def _place_on_week_drafts(db: Session, plant_id: str, approved: list[ProcurementPlanEntry], owner: str, now: datetime,
                         vendor_details: Optional[dict[str, dict[str, Any]]] = None) -> list[PurchaseOrder]:
    """Put Owner-approved arrivals on DRAFT POs: one per vendor per ISO week (spec 3), made or extended
    here. Each arrival becomes a dated TENTATIVE row on its material's line; the PO keeps what the
    Owner approved (hash + snapshot)."""
    from ..routers.purchase import _next_purchase_order_no, _persist_revision

    groups: dict[tuple[str, date], list[ProcurementPlanEntry]] = {}
    for entry in approved:
        groups.setdefault((str(entry.supplier_id), iso_week_start(entry.entry_date)), []).append(entry)
    touched: list[PurchaseOrder] = []
    for (supplier_id, monday), grouped in sorted(groups.items(), key=lambda pair: (pair[0][1], pair[0][0])):
        db.execute(text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"), {"key": f"rm-schedule-po:{plant_id}:{supplier_id}:{monday.isoformat()}"})
        order = _open_schedule_draft(db, plant_id, supplier_id, monday)
        is_new = order is None
        if is_new:
            supplier_name = grouped[0].supplier_name_snapshot
            order = PurchaseOrder(plant_id=plant_id, request_id=uuid.uuid4(), po_no=_next_purchase_order_no(db, plant_id, "RM_PM"),
                request_fingerprint=canonical_hash({"schedule": str(plant_id), "vendor": supplier_id, "week": monday.isoformat(), "at": now.isoformat()}),
                category="RM_PM", current_revision_no=1, version=1, supplier_id=uuid.UUID(supplier_id), supplier_name_snapshot=supplier_name,
                expected_date=min(entry.entry_date for entry in grouped), status="DRAFT", source="SCHEDULE",
                notes=f"Scheduled by the Owner on the RM inward calendar · {week_label(monday)}",
                metadata_json={"po_date": ist_today().isoformat(), "schedule_week": monday.isoformat(), **DEFAULT_PO_TERMS,
                               **_vendor_metadata((vendor_details or {}).get(supplier_id))},
                created_by=owner, scheduled_by=owner, scheduled_at=now)
            db.add(order)
            db.flush()
        lines_by_item = {str(line.item_id): line for line in order.lines or []}
        placed: list[tuple[ProcurementPlanEntry, PurchaseOrderLine]] = []
        for entry in grouped:
            line = lines_by_item.get(str(entry.item_id))
            if line is None:
                rate, rate_source = default_rate(db, plant_id, entry.supplier_id, entry.item_id)
                item = entry.item
                uom = "KG" if _enum(item.type) == "RAW_PAPER" else (_enum(item.uom) or "KG")
                line = PurchaseOrderLine(purchase_order_id=order.id, logical_line_id=uuid.uuid4(), item_id=entry.item_id,
                    qty_ordered=float(entry.qty_kg), qty_received=0, unit_cost=rate, uom=uom, line_status="OPEN",
                    incoming_qc_required=True, metadata_json={"description": item.name, "rate_source": rate_source,
                        "rate_needed": rate_source == "RATE_NEEDED", "source": "SCHEDULE"})
                db.add(line)
                order.lines.append(line)
                lines_by_item[str(entry.item_id)] = line
            else:
                line.qty_ordered = float(_dec(line.qty_ordered) + _dec(entry.qty_kg))
            placed.append((entry, line))
        db.flush()
        revision = refresh_draft_revision(db, order, owner) if not is_new else _persist_revision(
            db, order, list(order.lines), revision_no=1, request_id=order.request_id, actor=owner,
            change_reason="Scheduled by the Owner on the RM inward calendar")
        db.flush()
        revision_lines = {row.source_order_line_id: row for row in revision.lines or []}
        for entry, line in placed:
            row = PurchaseLineSchedule(plant_id=plant_id, purchase_order_line_id=line.id, scheduled_qty=float(entry.qty_kg),
                promised_date=entry.entry_date, current_date=entry.entry_date, confirmation_status="TENTATIVE",
                notes="Owner-approved arrival", created_by=owner, revision_line_id=revision_lines[line.id].id if line.id in revision_lines else None,
                source_plan_entry_id=entry.id, cancelled_qty=0, version=1, change_history=[])
            db.add(row)
            db.flush()
            entry.approval_status = "ON_PO"
            entry.po_id, entry.po_line_id, entry.schedule_row_id = order.id, line.id, row.id
        _sync_order_dates(order, _order_rows(db, order))
        order.scheduled_by, order.scheduled_at = owner, now
        stamp_approved(db, order)
        order.version = int(order.version or 1) + (0 if is_new else 1)
        touched.append(order)
    return touched


def _open_schedule_draft(db: Session, plant_id: str, supplier_id: str, monday: date) -> Optional[PurchaseOrder]:
    """The vendor-week draft this approval extends: still DRAFT, never sent, and unchanged since the
    Owner's last approval (a draft the desk edited keeps its changes for the normal approval)."""
    candidates = db.query(PurchaseOrder).filter(PurchaseOrder.plant_id == plant_id, PurchaseOrder.source == "SCHEDULE",
        PurchaseOrder.status == "DRAFT", PurchaseOrder.supplier_id == uuid.UUID(supplier_id), PurchaseOrder.sent_at.is_(None)
    ).order_by(PurchaseOrder.created_at).with_for_update().all()
    for order in candidates:
        if (order.metadata_json or {}).get("schedule_week") != monday.isoformat():
            continue
        if order.approved_schedule_hash and schedule_hash(db, order) == order.approved_schedule_hash:
            return order
    return None


def _po_summaries(db: Session, po_ids: Iterable[Any]) -> list[dict[str, Any]]:
    ids = [uuid.UUID(str(value)) for value in po_ids]
    orders = db.query(PurchaseOrder).filter(PurchaseOrder.id.in_(ids)).all() if ids else []
    by_id = {str(order.id): order for order in orders}
    out = []
    for value in ids:
        order = by_id.get(str(value))
        if not order:
            continue
        week = (order.metadata_json or {}).get("schedule_week")
        out.append({"id": str(order.id), "po_no": order.po_no, "supplier_name": order.supplier_name_snapshot, "status": order.status,
                    "schedule_week": week, "week_label": week_label(date.fromisoformat(week)) if week else None,
                    "lines": len(order.lines or []), "rate_needed": any(float(line.unit_cost or 0) <= 0 for line in order.lines or [])})
    return out


# ---------------------------------------------------------------- send and vendor confirmation


def send_order(db: Session, order: PurchaseOrder, *, channel: str, actor: str, actor_role: str, note: Optional[str] = None) -> dict[str, Any]:
    """Send to vendor. A scheduled draft that still matches the Owner's approved hash is approved by
    that schedule approval (approval_source SCHEDULE); anything changed goes Submit → Owner → Send."""
    now = datetime.utcnow()
    approved_on_schedule = False
    if order.status == "DRAFT":
        check = send_check(order)
        if check["mode"] != "SEND_ON_SCHEDULE":
            raise HTTPException(409, {"code": "NEEDS_APPROVAL", "message": "This PO needs the Owner's approval before it can go to the vendor. " + " ".join(check["reasons"]),
                                      "reasons": check["reasons"]})
        from ..routers.purchase import _current_revision

        revision = _current_revision(db, order, lock=True)
        if revision.approval_state != "DRAFT":
            raise HTTPException(409, "This PO revision is no longer a draft; reload")
        approver = order.scheduled_by or "Owner"
        approved_at = order.scheduled_at or now
        revision.approval_state = "APPROVED"
        revision.approved_by = approver
        revision.approved_at = approved_at
        revision.version = int(revision.version or 1) + 1
        db.add(PurchaseApprovalDecision(revision_id=revision.id, decision="APPROVED", content_hash=revision.content_hash, actor=approver,
            actor_role="Owner (RM inward calendar)", decided_at=approved_at,
            reason=f"Approved on the RM inward calendar on {indian_date(ist_day(approved_at))}; sent unchanged by {actor} on {indian_date(ist_day(now))}."))
        order.status = "APPROVED"
        order.approved_by = approver
        order.approved_at = approved_at
        order.approval_source = "SCHEDULE"
        approved_on_schedule = True
    elif order.status == "SUBMITTED":
        raise HTTPException(409, f"{order.po_no} is waiting for the Owner's approval")
    elif order.status not in COUNTED_PO_STATUSES:
        raise HTTPException(409, f"{order.po_no} is {order.status.replace('_', ' ').lower()} and cannot be sent")
    metadata = dict(order.metadata_json or {})
    if order.sent_at:
        metadata["send_history"] = [*(metadata.get("send_history") or []), {"sent_at": order.sent_at.isoformat(), "sent_by": order.sent_by,
            "channel": order.sent_channel, "revision_no": order.current_revision_no}]
    metadata.pop("resend_reason", None)
    if note:
        metadata["send_note"] = note
    order.metadata_json = metadata
    order.sent_at, order.sent_by, order.sent_channel = now, actor, channel
    order.version = int(order.version or 1) + 1
    db.flush()
    return {"approved_on_schedule": approved_on_schedule}


def confirm_vendor_dates(db: Session, order: PurchaseOrder, rows: list[dict[str, Any]], actor: str, note: Optional[str] = None) -> list[PurchaseLineSchedule]:
    if order.status not in COUNTED_PO_STATUSES:
        raise HTTPException(409, "Send the approved PO to the vendor first; the vendor confirms an approved PO")
    line_ids = {line.id for line in order.lines or []}
    wanted = {str(row["schedule_id"]): row for row in rows}
    found = db.query(PurchaseLineSchedule).filter(PurchaseLineSchedule.id.in_([uuid.UUID(key) for key in wanted])).with_for_update().all()
    if len(found) != len(wanted) or any(row.purchase_order_line_id not in line_ids for row in found):
        raise HTTPException(404, "A delivery row is not on this PO")
    now = datetime.utcnow()
    today = ist_today()
    for row in found:
        if row.confirmation_status == "CANCELLED":
            raise HTTPException(409, "A cancelled delivery row cannot be confirmed")
        confirmed_date: date = wanted[str(row.id)].get("confirmed_date") or row.current_date
        if confirmed_date < today:
            # Same rule as proposing and moving an arrival: a vendor promise is today or later.
            raise HTTPException(422, f"{indian_date(confirmed_date)} has passed. Pick today or a later day for the date the vendor confirms."
                                if wanted[str(row.id)].get("confirmed_date") else
                                f"{indian_date(confirmed_date)} has passed. Pick the day the vendor now promises (today or later).")
        row.change_history = [*(row.change_history or []), {
            "version": int(row.version or 1) + 1, "previous_date": row.current_date.isoformat(), "current_date": confirmed_date.isoformat(),
            "previous_status": row.confirmation_status, "status": "CONFIRMED",
            "reason": note or ("Vendor confirmed" if confirmed_date == row.current_date else f"Vendor confirmed for {indian_date(confirmed_date)}"),
            "actor": actor, "changed_at": now.isoformat() + "Z",
        }]
        row.current_date = confirmed_date
        row.confirmation_status = "CONFIRMED"
        row.version = int(row.version or 1) + 1
        for entry in db.query(ProcurementPlanEntry).filter(ProcurementPlanEntry.schedule_row_id == row.id).all():
            entry.entry_date = confirmed_date
            entry.updated_by, entry.updated_at = actor, now
    order.vendor_confirmed_at, order.vendor_confirmed_by = now, actor
    _sync_order_dates(order, _order_rows(db, order))
    order.version = int(order.version or 1) + 1
    db.flush()
    return found


# ---------------------------------------------------------------- read model for the calendar


def _arrival_base(**values: Any) -> dict[str, Any]:
    state = values.get("state")
    return {**values, "state_label": STATE_LABELS.get(state, state)}


def supply_view(db: Session, plant_id: str, start: date, end: date) -> dict[str, Any]:
    """Stock, policies, vendors and every arrival the calendar shows, per item, in the item's unit.

    ``counted_qty`` is what an arrival adds to cover: Owner-approved arrivals and open rows of
    approved POs (remaining qty only). Proposals and hand-made drafts are shown, not counted.
    Received rows show as received and add nothing: that qty is stock now."""
    from .stock_calc import get_all_items_balance

    today = ist_today()
    items = db.query(ItemMaster).filter(ItemMaster.plant_id == plant_id, ItemMaster.active == "true",
        ItemMaster.type.in_(list(RM_ITEM_TYPES))).all()
    item_ids = [item.id for item in items]
    balances = {row["item_id"]: row for row in get_all_items_balance(db, plant_id=plant_id)}
    policies = active_policies(db, plant_id)
    arrivals: list[dict[str, Any]] = []
    seen_rows: set[str] = set()

    entries = (
        db.query(ProcurementPlanEntry).join(ProcurementPlan, ProcurementPlan.id == ProcurementPlanEntry.plan_id)
        .filter(ProcurementPlan.plant_id == plant_id, ProcurementPlan.name == CALENDAR_PLAN_NAME,
                ProcurementPlan.status == CALENDAR_PLAN_STATUS, ProcurementPlanEntry.approval_status != "CANCELLED",
                # Every waiting proposal comes back whatever the window, so "waiting for your approval"
                # never depends on the window (checker 2026-10-28); a proposal nobody approved by its
                # date stays visible (as late) until it is decided.
                ((ProcurementPlanEntry.entry_date <= end) & (ProcurementPlanEntry.entry_date >= start - timedelta(days=120)))
                | (ProcurementPlanEntry.approval_status == "PROPOSED"))
        .all()
    )
    rates = RateBook(db, plant_id, [*item_ids, *(entry.item_id for entry in entries)], today)
    vendors = rates.last_vendor
    rows_by_id = {}
    row_ids = [entry.schedule_row_id for entry in entries if entry.schedule_row_id]
    if row_ids:
        rows_by_id = {row.id: row for row in db.query(PurchaseLineSchedule).filter(PurchaseLineSchedule.id.in_(row_ids)).all()}
    # What the Owner approves on a proposal: the rate its draft PO line will get, so he sees the value.
    def preview_rate(entry: ProcurementPlanEntry) -> tuple[Optional[float], Optional[str]]:
        if not entry.supplier_id:
            return None, None
        return rates.rate(entry.supplier_id, entry.item_id)

    for entry in entries:
        row = rows_by_id.get(entry.schedule_row_id)
        order = row.order_line.order if row and row.order_line else None
        base = {"kind": "ENTRY", "id": f"entry:{entry.id}", "entry_id": str(entry.id), "item_id": str(entry.item_id),
                "supplier_id": str(entry.supplier_id) if entry.supplier_id else None, "supplier_name": entry.supplier_name_snapshot,
                "note": entry.notes, "source": entry.source, "approval_status": entry.approval_status,
                "proposed_by": entry.proposed_by, "proposed_at": entry.proposed_at.isoformat() if entry.proposed_at else None,
                "approved_by": entry.approved_by, "approved_at": entry.approved_at.isoformat() if entry.approved_at else None}
        if entry.approval_status in {"PROPOSED", "APPROVED"} or not row or not order:
            qty = _q(entry.qty_kg)
            state = entry.approval_status if entry.approval_status in {"PROPOSED", "APPROVED"} else "APPROVED"
            day = entry.entry_date
            rate, rate_source = preview_rate(entry) if state == "PROPOSED" else (None, None)
            arrivals.append(_arrival_base(**base, date=day.isoformat(), qty=qty, received_qty=0.0, open_qty=qty,
                counted_qty=qty if state == "APPROVED" else 0.0, state=state, overdue=day < today,
                # A late proposal goes on today when the Owner approves it.
                late_proposal=state == "PROPOSED" and day < today,
                schedule_id=None, po_id=None, po_no=None, po_status=None, po_line_id=None, confirmation=None,
                sent_at=None, sent_channel=None, rate=rate, rate_source=rate_source,
                rate_needed=rate_source == "RATE_NEEDED", movable=True))
            continue
        seen_rows.add(str(row.id))
        arrival = _row_arrival(row, order, today, start)
        if arrival is None:
            continue
        arrivals.append({**arrival, **base, "kind": "ENTRY", "id": f"entry:{entry.id}"})

    rows = (
        db.query(PurchaseLineSchedule).join(PurchaseOrderLine, PurchaseOrderLine.id == PurchaseLineSchedule.purchase_order_line_id)
        .join(PurchaseOrder, PurchaseOrder.id == PurchaseOrderLine.purchase_order_id)
        .filter(PurchaseOrder.plant_id == plant_id, PurchaseLineSchedule.confirmation_status != "CANCELLED",
                PurchaseOrder.status.notin_(list(CLOSED_PO_STATUSES)),
                # A row received early shows on its GRN day, which may be inside the window.
                (PurchaseLineSchedule.current_date <= end) | PurchaseLineSchedule.allocations.any())
        .all()
    )
    listed_rows = {row.id for row in rows}
    scheduled_open: dict[Any, Decimal] = {}
    for row in rows:
        order = row.order_line.order
        if order.status in COUNTED_PO_STATUSES:
            scheduled_open[row.purchase_order_line_id] = scheduled_open.get(row.purchase_order_line_id, Decimal(0)) + _row_open(row)
        if str(row.id) in seen_rows:
            continue
        arrival = _row_arrival(row, order, today, start)
        if arrival:
            arrivals.append({**arrival, "kind": "PO_ROW", "id": f"row:{row.id}", "entry_id": None, "source": "PO",
                             "supplier_id": str(order.supplier_id), "supplier_name": order.supplier_name_snapshot, "note": row.notes,
                             "approval_status": None, "proposed_by": None, "proposed_at": None, "approved_by": order.approved_by,
                             "approved_at": order.approved_at.isoformat() if order.approved_at else None})
    # Rows dated after the window still hold their PO qty: they must not turn into undated cover.
    later = (
        db.query(PurchaseLineSchedule).join(PurchaseOrderLine, PurchaseOrderLine.id == PurchaseLineSchedule.purchase_order_line_id)
        .join(PurchaseOrder, PurchaseOrder.id == PurchaseOrderLine.purchase_order_id)
        .filter(PurchaseOrder.plant_id == plant_id, PurchaseLineSchedule.confirmation_status != "CANCELLED",
                PurchaseOrder.status.in_(list(COUNTED_PO_STATUSES)), PurchaseLineSchedule.current_date > end)
        .all()
    )
    for row in later:
        if row.id in listed_rows:
            continue
        scheduled_open[row.purchase_order_line_id] = scheduled_open.get(row.purchase_order_line_id, Decimal(0)) + _row_open(row)
    # Approved PO quantity with no dated row (hand-made POs from before rows existed, or a revision
    # that added qty): one open arrival on the line date, else the PO date, else today.
    open_lines = (
        db.query(PurchaseOrderLine).join(PurchaseOrder, PurchaseOrder.id == PurchaseOrderLine.purchase_order_id)
        .filter(PurchaseOrder.plant_id == plant_id, PurchaseOrder.status.in_(list(COUNTED_PO_STATUSES)))
        .all()
    )
    for line in open_lines:
        order = line.order
        open_qty = max(Decimal(0), _dec(line.qty_ordered) - _dec(line.qty_received) - _dec(line.qty_short_closed))
        unscheduled = open_qty - scheduled_open.get(line.id, Decimal(0))
        if unscheduled <= QTY:
            continue
        raw = (line.metadata_json or {}).get("delivery_date")
        try:
            day = date.fromisoformat(str(raw)[:10]) if raw else order.expected_date
        except ValueError:
            day = order.expected_date
        no_date = day is None
        day = day or today
        if day > end:
            continue
        state = "SENT" if order.sent_at else "ON_PO"
        arrivals.append(_arrival_base(kind="PO_OPEN", id=f"open:{line.id}", entry_id=None, schedule_id=None, item_id=str(line.item_id),
            po_id=str(order.id), po_no=order.po_no, po_status=order.status, po_line_id=str(line.id), date=day.isoformat(),
            qty=_q(unscheduled), received_qty=0.0, open_qty=_q(unscheduled), counted_qty=_q(unscheduled), state=state,
            overdue=day < today, no_date=no_date, confirmation=None, sent_at=order.sent_at.isoformat() if order.sent_at else None,
            sent_channel=order.sent_channel, rate=float(line.unit_cost or 0), rate_needed=float(line.unit_cost or 0) <= 0,
            movable=False, supplier_id=str(order.supplier_id), supplier_name=order.supplier_name_snapshot, note=None, source="PO",
            approval_status=None, proposed_by=None, proposed_at=None, approved_by=order.approved_by,
            approved_at=order.approved_at.isoformat() if order.approved_at else None))

    qc_waiting = incoming_qc_pending(db, plant_id, item_ids)
    out_items = []
    for item in items:
        key = str(item.id)
        balance = balances.get(key, {})
        policy = policies.get(key)
        vendor = vendors.get(key)
        rate, rate_source = rates.rate(vendor["supplier_id"] if vendor else None, item.id)
        out_items.append({
            "item_id": key, "item_code": item.item_code, "item_name": item.name, "item_type": _enum(item.type),
            "material_class": CLASS_OF_TYPE.get(_enum(item.type), "CHEMICAL"), "uom": _enum(item.uom),
            "usable_qty": float(balance.get("usable_qty") or 0), "qc_pending_qty": qc_waiting.get(key, 0.0),
            # Every other held quantity (failed, plant-head hold, count gains on hold): shown, never cover.
            "other_held_qty": max(0.0, round(float(balance.get("qc_held_qty") or 0) - qc_waiting.get(key, 0.0), 3)),
            "policy": {"min_stock": float(policy.safety_stock_kg or 0), "reorder_point": float(policy.reorder_point_kg or 0),
                       "target_stock": float(policy.target_stock_kg or 0), "lead_time_days": int(policy.lead_time_days or 0),
                       "minimum_order": float(policy.minimum_order_kg or 0), "order_multiple": float(policy.order_multiple_kg or 0)} if policy else None,
            "last_vendor": vendor, "rate": {"rate": rate, "source": rate_source},
        })
    return {"plant_id": plant_id, "today": today.isoformat(), "start": start.isoformat(), "end": end.isoformat(),
            "items": out_items, "arrivals": arrivals}


def _row_arrival(row: PurchaseLineSchedule, order: PurchaseOrder, today: date, start: date) -> Optional[dict[str, Any]]:
    line = row.order_line
    planned = _dec(row.scheduled_qty) - _dec(row.cancelled_qty)
    received = _dec(row.received_qty)
    open_qty = max(Decimal(0), planned - received)
    day = row.current_date
    if order.status in CLOSED_PO_STATUSES and received <= 0:
        return None
    if open_qty <= QTY and received > 0:
        state, counted = "RECEIVED", Decimal(0)
    elif order.status in COUNTED_PO_STATUSES:
        state = "CONFIRMED" if row.confirmation_status == "CONFIRMED" else "SENT" if order.sent_at else "ON_PO"
        counted = open_qty
    elif order.status in OPEN_DRAFT_PO_STATUSES:
        # A scheduled draft is the Owner's approved arrival: cover. A hand-made draft is not yet.
        state, counted = "ON_PO", (open_qty if order.source == "SCHEDULE" else Decimal(0))
    elif order.status in RETURNED_PO_STATUSES:
        # The Owner rejected the PO: nothing comes until the desk revises it and he approves it again.
        state, counted = "REJECTED", Decimal(0)
    else:
        state, counted = "RECEIVED", Decimal(0)
    received_on = None
    if state == "RECEIVED":
        # Show received goods on the day they came (the GRN date), not on the planned day.
        days = [allocation.receipt_line.receipt.received_date for allocation in row.allocations or []
                if allocation.receipt_line and allocation.receipt_line.receipt and allocation.receipt_line.receipt.received_date]
        if days:
            received_on = max(days)
            day = received_on
    if day < start and state == "RECEIVED":
        return None
    return _arrival_base(schedule_id=str(row.id), item_id=str(line.item_id), po_id=str(order.id), po_no=order.po_no,
        po_status=order.status, po_source=order.source, po_line_id=str(line.id), date=day.isoformat(), promised_date=row.promised_date.isoformat(),
        planned_date=row.current_date.isoformat(), received_on=received_on.isoformat() if received_on else None,
        qty=_q(planned), received_qty=_q(received), open_qty=_q(open_qty), counted_qty=_q(counted), state=state,
        overdue=day < today and state not in {"RECEIVED", "REJECTED"}, confirmation=row.confirmation_status,
        sent_at=order.sent_at.isoformat() if order.sent_at else None, sent_channel=order.sent_channel,
        rate=float(line.unit_cost or 0), rate_needed=float(line.unit_cost or 0) <= 0,
        movable=order.status not in CLOSED_PO_STATUSES and state != "RECEIVED", schedule_version=int(row.version or 1))


def expected_arrivals(db: Session, plant_id: str) -> dict[str, Any]:
    """Open delivery rows of approved POs for the GRN desk, plus approved quantity with no dated row."""
    today = ist_today()
    far = today + timedelta(days=3650)
    view = supply_view(db, plant_id, today - timedelta(days=3650), far)
    rows = [row for row in view["arrivals"] if row.get("po_id") and row.get("po_status") in COUNTED_PO_STATUSES and float(row.get("open_qty") or 0) > 0]
    items = {row["item_id"]: row for row in view["items"]}
    out = []
    for row in rows:
        item = items.get(row["item_id"], {})
        day = date.fromisoformat(row["date"])
        bucket = "OVERDUE" if day < today else "TODAY" if day == today else "THIS_WEEK" if day <= iso_week_start(today) + timedelta(days=6) else "LATER"
        out.append({**row, "bucket": bucket, "item_code": item.get("item_code"), "item_name": item.get("item_name"), "uom": item.get("uom")})
    out.sort(key=lambda row: (row["date"], row.get("po_no") or ""))
    return {"today": today.isoformat(), "items": out}
