"""Incoming QC by bill (6 Nov 2026): one card per bill or challan, every reel and lot inside it.

The desk lists bills (a GRN, or one supplier invoice that spans several GRNs), shows each lot's bill qty
(reel ``inward_weight_kg``, batch ``billed_qty``) beside the actual qty QC weighs, and saves the rows of a
bill in one request: each row is the existing inspection path plus the actual qty, in its own savepoint.
Stock stays on the bill weight; the actual qty only feeds the weight check (``services.weight_variance``).
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any, Iterable, Optional

from fastapi import HTTPException
from sqlalchemy import func, or_
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from ..models import (
    InventoryQualityInspection,
    PaperReel,
    PurchaseOrder,
    PurchaseReceipt,
    ReceiptStockAllocation,
    ReelStatus,
    StockBatch,
    StockTransaction,
    SupplierInvoice,
)
from ..models_weight import IncomingQcEntryKey, PurchaseWeightVariance
from ..quality_pin import is_missing_profile_pin, pin_quality_profile_metadata
from ..quality_templates import RETIRED_WEIGHT_PARAMETERS
from ..reasons import resolve_reason, token_of
from ..schema_incoming_bill import relax_profile
from .books import IST
from .procurement import canonical_hash
from . import weight_variance as wv

ENTRY_STATES = {"QC_HOLD", "BLOCKED", "UNRESTRICTED"}
TYPO_GUARD = Decimal("0.15")
MAX_QTY = Decimal("10000000")
RETIRED_CODES = {code for _, code in RETIRED_WEIGHT_PARAMETERS}
TABS = ("TO_WEIGH", "PART_DONE", "OWNER_DECISION", "DONE_TODAY", "HELD")


def actor_of(current_user: dict) -> str:
    return str(current_user.get("actor_identity") or current_user.get("actual_sub") or current_user.get("sub") or "system")


def ctx_of(current_user: dict) -> wv.Context:
    return wv.Context(actor=actor_of(current_user), token=token_of(current_user))


def _iso(value) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.isoformat()
    return str(value)


def _f(value) -> Optional[float]:
    return float(value) if value is not None else None


def _today_start_utc() -> datetime:
    now = datetime.now(IST)
    start = datetime(now.year, now.month, now.day, tzinfo=IST)
    return start.astimezone(timezone.utc).replace(tzinfo=None)


def _norm(value: Any) -> str:
    return "".join(ch for ch in str(value or "").upper() if ch.isalnum())


def material_type(item) -> str:
    from ..routers.quality import _material_type_for_item

    return _material_type_for_item(item) if item is not None else "OTHER"


def effective_profile(lot: wv.LotFact) -> Optional[dict[str, Any]]:
    """The lot's standard as the desk shows it: every check optional, retired weight checks hidden."""
    from ..routers.quality import _effective_profile

    profile = _effective_profile(lot.item, lot.entity)
    relaxed, _ = relax_profile(profile)
    return relaxed


def relax_entity_profile(lot: wv.LotFact) -> None:
    """Pin the approved standard on the lot (as the inspection would) with every check optional."""
    meta = pin_quality_profile_metadata(lot.entity.inward_metadata, getattr(lot.item, "quality_profile", None))
    pinned = meta.get("quality_profile")
    if isinstance(pinned, dict) and not is_missing_profile_pin(pinned):
        relaxed, changed = relax_profile(pinned)
        if changed:
            meta = {**meta, "quality_profile": relaxed}
    lot.entity.inward_metadata = meta
    flag_modified(lot.entity, "inward_metadata")


def _lot_balance(db: Session, lot: wv.LotFact) -> Decimal:
    if lot.entity_type == "REEL":
        return Decimal(str(lot.entity.current_weight_kg or 0))
    total = db.query(func.coalesce(func.sum(StockTransaction.qty_change), 0)).filter(StockTransaction.batch_id == lot.entity_id).scalar()
    return Decimal(str(total or 0))


def issued_reason(db: Session, lot: wv.LotFact) -> Optional[str]:
    """Why a lot's weight can no longer be corrected: it already went to the floor."""
    if lot.entity_type == "REEL":
        reel = lot.entity
        status = getattr(reel.status, "value", reel.status)
        if status != ReelStatus.IN_STOCK.value or Decimal(str(reel.current_weight_kg or 0)) + Decimal("0.001") < Decimal(str(reel.inward_weight_kg or 0)):
            return f"{reel.reel_code} is already issued; its weight can no longer be corrected."
        return None
    billed = lot.bill_qty or Decimal("0")
    if _lot_balance(db, lot) + Decimal("0.001") < billed:
        return f"{lot.code} is already partly issued; its weight can no longer be corrected."
    return None


def lot_state(lot: wv.LotFact) -> tuple[str, str]:
    """(queue state, plain words) of one lot."""
    status = str(lot.entity.stock_status or "").upper()
    inspection = lot.inspection
    disposition = str(getattr(inspection, "disposition", "") or "").upper()
    verdict = str(getattr(inspection, "status", "") or "").upper()
    if status == "RETURNED":
        return "RETURNED", "Returned to supplier"
    if lot.rejected:
        return "REJECTED", "Rejected"
    if status == "UNRESTRICTED":
        return "DONE", "Issuable"
    if status == "CONCESSION":
        return "DONE", "Concession"
    if status in {"WIP", "SCRAP", "DISPATCH_STAGING"}:
        return "DONE", status.replace("_", " ").title()
    if inspection is None:
        return "AWAITING_INSPECTION", "Waiting"
    if verdict in {"FAIL", "INVALID", "INCOMPLETE"} or disposition == "HOLD" or lot.holds:
        return "FAILED", "Held"
    return "AWAITING_INSPECTION", "Waiting"


def lot_payload(db: Session, lot: wv.LotFact, frozen: Optional[str]) -> dict[str, Any]:
    entity = lot.entity
    item = lot.item
    queue_state, word = lot_state(lot)
    inspection = lot.inspection
    issued = issued_reason(db, lot) if lot.weighed else None
    meta = entity.inward_metadata or {}
    nominal = {}
    if lot.entity_type == "REEL":
        nominal = {key: value for key, value in (("gsm", entity.gsm), ("bf", entity.bf), ("width_mm", entity.width_mm)) if value is not None}
    diff = (lot.actual_qty - lot.bill_qty) if lot.weighed and lot.bill_qty is not None else None
    return {
        "key": lot.key, "entity_type": lot.entity_type, "entity_id": str(lot.entity_id), "code": lot.code,
        "unit_label": lot.code, "label": f"{lot.code} · {getattr(item, 'name', None) or 'material'}",
        "unit_ref": lot.vendor_ref, "vendor_ref": lot.vendor_ref,
        "item_id": str(item.id) if item is not None else None, "item_code": getattr(item, "item_code", None),
        "item_name": getattr(item, "name", None), "material_type": material_type(item), "nominal": nominal,
        "uom": lot.uom, "is_kg": lot.kg,
        "bill_qty": _f(lot.bill_qty), "actual_qty": _f(lot.actual_qty), "diff_qty": _f(diff),
        "weighed_by": entity.weighed_by, "weighed_at": _iso(entity.weighed_at), "weigh_note": entity.weigh_note,
        "weigh_history": meta.get("weigh_history") or [],
        "qty": float(_lot_balance(db, lot)), "stock_status": entity.stock_status, "queue_state": queue_state, "status_word": word,
        "rejected": lot.rejected, "returned": str(entity.stock_status or "").upper() == "RETURNED",
        "last_inspection": None if inspection is None else {
            "id": str(inspection.id), "status": inspection.status, "disposition": inspection.disposition,
            "created_at": _iso(inspection.created_at), "created_by": inspection.created_by,
            "reason_code": inspection.reason_code, "reason_label": inspection.reason_label, "reason_note": inspection.reason_note,
            "readings": {key: value for key, value in (inspection.readings or {}).items() if key not in RETIRED_CODES},
            "failures": [str(row.get("label") or row.get("parameter") or row.get("code") or "") for row in (inspection.failures or []) if isinstance(row, dict)][:8],
        },
        "inspection_holds": [{"id": str(hold.id), "reason": hold.reason, "inspection_id": str(hold.source_inspection_id) if hold.source_inspection_id else None}
                             for hold in lot.holds if hold.hold_kind == "INSPECTION" and hold.source_inspection_id],
        "quality_profile": effective_profile(lot),
        "plant_id": str(lot.receipt.plant_id) if lot.receipt is not None else str(entity.plant_id),
        "receipt_line_id": str(lot.line.id) if lot.line is not None else None,
        "receipt_id": str(lot.receipt.id) if lot.receipt is not None else None,
        "grn_no": lot.receipt.grn_no if lot.receipt is not None else None,
        "weight_required_for_accept": lot.bill_qty is not None,
        "can_enter": str(entity.stock_status or "").upper() in ENTRY_STATES and not lot.rejected,
        "can_weigh": not lot.weighed and not frozen and str(entity.stock_status or "").upper() != "RETURNED",
        "reweigh_blocked": None if not lot.weighed else (frozen or issued),
        "origin": "OPENING_LOAD" if str(meta.get("source") or "") == "OPENING_LOAD" else None,
        "hold_reason": meta.get("hold_reason"),
    }


# ── Bill summary ───────────────────────────────────────────────────────────────────────────────

def _invoice_of(db: Session, receipts: list[PurchaseReceipt]) -> Optional[SupplierInvoice]:
    for receipt in receipts:
        if receipt.supplier_invoice_id and not receipt.invoice_pending:
            invoice = db.get(SupplierInvoice, receipt.supplier_invoice_id)
            if invoice is not None and invoice.status != wv.PENDING_INVOICE_STATUS:
                return invoice
    return None


def _last_activity(lots: list[wv.LotFact]) -> Optional[datetime]:
    stamps = [lot.entity.weighed_at for lot in lots if lot.entity.weighed_at]
    stamps += [lot.inspection.created_at for lot in lots if lot.inspection is not None and lot.inspection.created_at]
    return max(stamps) if stamps else None


def bill_summary(db: Session, key: str, receipts: list[PurchaseReceipt], lots: list[wv.LotFact],
                 variance: Optional[PurchaseWeightVariance]) -> dict[str, Any]:
    figures = wv.bill_figures(lots)
    states = [lot_state(lot)[0] for lot in lots]
    open_lots = [lot for lot in lots if not lot.rejected and lot.bill_qty is not None and not lot.weighed]
    undecided = [lot for lot, state in zip(lots, states) if state == "AWAITING_INSPECTION"]
    touched = any(lot.weighed or lot.inspection is not None for lot in lots)
    held = any(state in {"FAILED", "REJECTED"} for state in states)
    last = _last_activity(lots)
    today = last is not None and last >= _today_start_utc()
    tabs: list[str] = []
    if open_lots or undecided:
        tabs.append("PART_DONE" if touched else "TO_WEIGH")
    if variance is not None and variance.status == "AWAITING_OWNER":
        tabs.append("OWNER_DECISION")
    if held:
        tabs.append("HELD")
    if not open_lots and not undecided and today:
        tabs.append("DONE_TODAY")
    invoice = _invoice_of(db, receipts) if receipts else None
    first = receipts[0] if receipts else None
    created = min((r.created_at for r in receipts if r.created_at), default=None) if receipts else None
    due = created + timedelta(hours=24) if created else None
    overdue = bool(due and (open_lots or undecided) and datetime.utcnow() > due)
    orders = [r.order for r in receipts if r.order is not None]
    title = wv.bill_label(db, receipts) if receipts else (f"Opening stock · {lots[0].code}" if lots else key)
    ready = sum(1 for state in states if state == "DONE")
    return {
        "key": key, "title": title, "plant_id": str(first.plant_id) if first else (str(lots[0].entity.plant_id) if lots else None),
        "receipt_ids": [str(r.id) for r in receipts], "grn_nos": [r.grn_no for r in receipts],
        "challan_nos": [r.supplier_challan_no for r in receipts if r.supplier_challan_no],
        "invoice_no": invoice.invoice_no if invoice is not None else None, "invoice_id": str(invoice.id) if invoice is not None else None,
        "invoice_date": _iso(invoice.invoice_date) if invoice is not None else None,
        "invoice_pending": invoice is None and bool(receipts),
        "supplier_name": (first.supplier_name_snapshot if first else None) or (lots[0].entity.supplier_name_snapshot if lots else None),
        "received_date": _iso(first.received_date) if first else None,
        "po_nos": list(dict.fromkeys(order.po_no for order in orders)), "po_ids": list(dict.fromkeys(str(order.id) for order in orders)),
        "po_raiser": wv._po_raiser(receipts) if receipts else None,
        "receipt_kind": first.receipt_kind if first else "OPENING",
        "material_types": sorted({material_type(lot.item) for lot in lots}),
        "lots_total": figures.lots_total, "lots_weighed": figures.lots_weighed, "lots_excluded": figures.lots_excluded,
        "lots_open": len(open_lots), "lots_undecided": len(undecided), "lots_ready": ready,
        "lots_held": sum(1 for state in states if state == "FAILED"),
        "bill_total": float(figures.bill_total), "bill_weighed": float(figures.bill_weighed), "actual_total": float(figures.actual_total),
        "diff_so_far": float(-(figures.kg_short if figures.has_kg else figures.short_so_far)),
        "uom": figures.uom, "is_final": figures.final and bool(receipts),
        "variance": None if variance is None else {
            "id": str(variance.id), "status": variance.status, "band": variance.band, "short_qty": float(variance.short_qty),
            "excess_qty": float(variance.excess_qty), "claim_amount": float(variance.claim_amount),
            "debit_note_id": str(variance.debit_note_id) if variance.debit_note_id else None,
            "decision": variance.decision, "reminder_due": wv.reminder_due(variance),
        },
        "tabs": tabs, "overdue": overdue, "due_at": _iso(due), "last_activity_at": _iso(last),
        "search_text": " ".join(filter(None, [
            title, *(r.grn_no for r in receipts), *(r.supplier_challan_no or "" for r in receipts),
            invoice.invoice_no if invoice is not None else "", first.supplier_name_snapshot if first else "",
            *(order.po_no for order in orders), *(lot.code for lot in lots), *(lot.vendor_ref or "" for lot in lots),
        ])),
        "lot_codes": [{"key": lot.key, "code": lot.code, "vendor_ref": lot.vendor_ref} for lot in lots],
    }


def _variance_for(db: Session, plant_id: str, key: str) -> Optional[PurchaseWeightVariance]:
    variance = db.query(PurchaseWeightVariance).filter(PurchaseWeightVariance.plant_id == str(plant_id), PurchaseWeightVariance.bill_key == key).first()
    if variance is not None and wv.sync_closed(db, variance):
        db.flush()
    return variance


def _lot_receipt_ids(db: Session, entity_ids: list) -> dict[Any, Any]:
    if not entity_ids:
        return {}
    rows = db.query(ReceiptStockAllocation).filter(or_(ReceiptStockAllocation.reel_id.in_(entity_ids), ReceiptStockAllocation.batch_id.in_(entity_ids))).all()
    line_ids = {row.receipt_line_id for row in rows}
    from ..models import PurchaseReceiptLine

    lines = {line.id: line.receipt_id for line in db.query(PurchaseReceiptLine).filter(PurchaseReceiptLine.id.in_(list(line_ids))).all()} if line_ids else {}
    return {(row.reel_id or row.batch_id): lines.get(row.receipt_line_id) for row in rows}


def _plant_uuids(plants: list[str]) -> list[uuid.UUID]:
    out = []
    for plant in plants:
        try:
            out.append(uuid.UUID(str(plant)))
        except ValueError:
            continue
    return out


def find_lot(db: Session, plants: list[str], entity_type: str, entity_id) -> Any:
    entity_type = str(entity_type or "").upper()
    if entity_type == "REEL":
        return db.query(PaperReel).filter(PaperReel.id == entity_id, PaperReel.plant_id.in_(_plant_uuids(plants))).first()
    if entity_type == "BATCH":
        return db.query(StockBatch).filter(StockBatch.id == entity_id, StockBatch.plant_id.in_(plants)).first()
    return None


def bill_key_of_lot(db: Session, plants: list[str], entity_type: str, entity_id) -> Optional[str]:
    entity = find_lot(db, plants, entity_type, entity_id)
    if entity is None:
        return None
    receipt_id = _lot_receipt_ids(db, [entity.id]).get(entity.id)
    if receipt_id is None:
        return f"L:{entity_type.upper()}:{entity.id}"
    receipt = db.get(PurchaseReceipt, receipt_id)
    return wv.receipt_bill_key(db, receipt) if receipt is not None else None


def load_bill(db: Session, plants: list[str], key: str) -> tuple[list[PurchaseReceipt], list[wv.LotFact]]:
    kind, value = wv.parse_bill_key(key)
    if kind == "L":
        entity_type, entity_id = value.split(":", 1)
        entity = find_lot(db, plants, entity_type, uuid.UUID(entity_id))
        if entity is None:
            raise HTTPException(status_code=404, detail="Lot not found in this plant")
        return [], [wv.lone_lot_fact(db, entity_type, entity)]
    receipts = wv.bill_receipts(db, plants, key)
    if not receipts:
        raise HTTPException(status_code=404, detail="Bill not found in this plant")
    return receipts, wv.load_lots(db, receipts)


def list_bills(db: Session, plants: list[str], *, tab: Optional[str] = None, q: Optional[str] = None,
               lot: Optional[str] = None, limit: int = 200) -> dict[str, Any]:
    plant_uuids = _plant_uuids(plants)
    receipt_ids: set = set()
    lone: list[tuple[str, Any]] = []
    # 1. Lots still held for QC.
    held_reels = db.query(PaperReel.id).filter(PaperReel.plant_id.in_(plant_uuids), PaperReel.stock_status.in_(["QC_HOLD", "BLOCKED"])).limit(600).all() if plant_uuids else []
    held_batches = db.query(StockBatch.id).filter(StockBatch.plant_id.in_(plants), StockBatch.stock_status.in_(["QC_HOLD", "BLOCKED"])).limit(600).all()
    entity_ids = [row[0] for row in held_reels] + [row[0] for row in held_batches]
    # 2. Lots weighed or inspected today.
    start = _today_start_utc()
    today_reels = db.query(PaperReel.id).filter(PaperReel.plant_id.in_(plant_uuids), PaperReel.weighed_at >= start).limit(400).all() if plant_uuids else []
    today_batches = db.query(StockBatch.id).filter(StockBatch.plant_id.in_(plants), StockBatch.weighed_at >= start).limit(400).all()
    today_inspected = db.query(InventoryQualityInspection.entity_id).filter(
        InventoryQualityInspection.plant_id.in_(plants), InventoryQualityInspection.entity_type.in_(["REEL", "BATCH"]),
        InventoryQualityInspection.source == "INWARD", InventoryQualityInspection.created_at >= start).limit(400).all()
    entity_ids += [row[0] for row in today_reels] + [row[0] for row in today_batches] + [row[0] for row in today_inspected]
    held_set = {row[0] for row in held_reels} | {row[0] for row in held_batches}
    lot_receipts = _lot_receipt_ids(db, list(set(entity_ids)))
    for entity_id in set(entity_ids):
        receipt_id = lot_receipts.get(entity_id)
        if receipt_id is not None:
            receipt_ids.add(receipt_id)
        elif entity_id in held_set:
            lone.append(("REEL" if any(entity_id == row[0] for row in held_reels) else "BATCH", entity_id))
    # 3. Owner decisions waiting.
    for variance in db.query(PurchaseWeightVariance).filter(PurchaseWeightVariance.plant_id.in_(plants), PurchaseWeightVariance.status == "AWAITING_OWNER").all():
        for value in variance.receipt_ids or []:
            receipt_ids.add(uuid.UUID(value))
    # 4. Search: a bill, challan, GRN, PO, vendor, AIT or vendor reel number from the last 120 days.
    text_q = str(q or "").strip()
    if text_q:
        like = f"%{text_q}%"
        since = datetime.utcnow() - timedelta(days=120)
        receipt_hits = db.query(PurchaseReceipt.id).outerjoin(PurchaseOrder, PurchaseOrder.id == PurchaseReceipt.purchase_order_id).outerjoin(
            SupplierInvoice, SupplierInvoice.id == PurchaseReceipt.supplier_invoice_id).filter(
            PurchaseReceipt.plant_id.in_(plants), PurchaseReceipt.created_at >= since,
            or_(PurchaseReceipt.grn_no.ilike(like), PurchaseReceipt.supplier_challan_no.ilike(like), PurchaseReceipt.supplier_name_snapshot.ilike(like),
                PurchaseOrder.po_no.ilike(like), SupplierInvoice.invoice_no.ilike(like))).limit(60).all()
        receipt_ids.update(row[0] for row in receipt_hits)
        norm = _norm(text_q)
        serial = norm[3:] if norm.startswith("AIT") else norm
        reel_filters = [PaperReel.reel_code.ilike(like), PaperReel.source_reel_no.ilike(like)]
        if serial and serial.isdigit():
            reel_filters.append(PaperReel.reel_code.ilike(f"%{serial}%"))
        reel_hits = db.query(PaperReel.id).filter(PaperReel.plant_id.in_(plant_uuids), PaperReel.created_at >= since, or_(*reel_filters)).limit(60).all() if plant_uuids else []
        batch_hits = db.query(StockBatch.id).filter(StockBatch.plant_id.in_(plants), StockBatch.created_at >= since, StockBatch.batch_no.ilike(like)).limit(60).all()
        hits = [row[0] for row in reel_hits] + [row[0] for row in batch_hits]
        for entity_id, receipt_id in _lot_receipt_ids(db, hits).items():
            if receipt_id is not None:
                receipt_ids.add(receipt_id)
    # 5. A linked lot (?lot=REEL:<id>): its own bill, wherever it is.
    lot_key = None
    if lot:
        entity_type, _, entity_id = str(lot).partition(":")
        try:
            lot_key = bill_key_of_lot(db, plants, entity_type, uuid.UUID(entity_id))
        except ValueError:
            lot_key = None
    receipts = db.query(PurchaseReceipt).filter(PurchaseReceipt.id.in_(list(receipt_ids)), PurchaseReceipt.plant_id.in_(plants)).all() if receipt_ids else []
    keys: dict[str, str] = {}
    for receipt in receipts:
        keys.setdefault(wv.receipt_bill_key(db, receipt), str(receipt.plant_id))
    for entity_type, entity_id in lone:
        keys.setdefault(f"L:{entity_type}:{entity_id}", "")
    if lot_key:
        keys.setdefault(lot_key, "")
    items: list[dict[str, Any]] = []
    for key in list(keys)[:limit]:
        try:
            bill_receipt_rows, lots = load_bill(db, plants, key)
        except HTTPException:
            continue
        if not lots:
            continue
        variance = _variance_for(db, bill_receipt_rows[0].plant_id, key) if bill_receipt_rows else None
        summary = bill_summary(db, key, bill_receipt_rows, lots, variance)
        summary["matched_lot"] = key == lot_key
        items.append(summary)
    counts = {name: sum(1 for item in items if name in item["tabs"]) for name in TABS}
    if text_q:
        needle, norm = text_q.lower(), _norm(text_q)
        serial = norm[3:] if norm.startswith("AIT") else norm
        items = [item for item in items if needle in item["search_text"].lower() or (serial and serial in _norm(item["search_text"]))]
    if tab and tab.upper() in TABS and not text_q and not lot:
        items = [item for item in items if tab.upper() in item["tabs"]]
    items.sort(key=lambda item: (not item.get("matched_lot"), "OWNER_DECISION" not in item["tabs"], not item["overdue"],
                                 item.get("due_at") or "9999", item["title"]))
    for item in items:
        item.pop("search_text", None)
    return {"items": items, "counts": counts}


def bill_detail(db: Session, plants: list[str], key: str) -> dict[str, Any]:
    receipts, lots = load_bill(db, plants, key)
    variance = _variance_for(db, receipts[0].plant_id, key) if receipts else None
    frozen = wv.weights_frozen(db, variance)
    summary = bill_summary(db, key, receipts, lots, variance)
    summary.pop("search_text", None)
    return {
        **summary,
        "lots": [lot_payload(db, lot, frozen) for lot in lots],
        "weight_check": wv.variance_payload(db, variance) if variance is not None else None,
        "weights_frozen": frozen,
        "limits": dict(zip(("notify_kg", "auto_kg"), (float(v) for v in (
            (variance.notify_kg, variance.auto_kg) if variance is not None else wv.plant_limits(db, receipts[0].plant_id) if receipts else (wv.DEFAULT_NOTIFY_KG, wv.DEFAULT_AUTO_KG))))),
    }


# ── Saving rows ────────────────────────────────────────────────────────────────────────────────

def _qty_text(value: Decimal, uom: str) -> str:
    unit = "kg" if wv.is_kg(uom) else str(uom or "").lower()
    return f"{value:,.3f}".rstrip("0").rstrip(".") + f" {unit}"


def typo_guard(actual: Decimal, bill: Optional[Decimal], uom: str) -> Optional[str]:
    if bill is None or bill <= 0:
        return None
    if abs(actual - bill) / bill > TYPO_GUARD:
        return f"Check: {_qty_text(actual, uom)} vs bill {_qty_text(bill, uom)}. Confirm the weight to save it."
    return None


def _row_fingerprint(row: dict[str, Any]) -> str:
    return canonical_hash({key: value for key, value in row.items() if key not in {"idempotency_key", "base_inspection_id", "confirm_far"}})


def _saved_key(db: Session, plant_id: str, key: str) -> Optional[IncomingQcEntryKey]:
    return db.query(IncomingQcEntryKey).filter(IncomingQcEntryKey.plant_id == plant_id, IncomingQcEntryKey.idempotency_key == key).first()


def save_entries(db: Session, plant_id: str, key: str, rows: list[dict[str, Any]], current_user: dict) -> dict[str, Any]:
    from ..routers.quality import QualityInspectionCreate, record_quality_inspection
    from .receipt_quality import refresh_receipt_stock

    receipts, _ = load_bill(db, [plant_id], key)
    actor = actor_of(current_user)
    results: list[dict[str, Any]] = []
    for row in rows:
        entity_type = str(row["entity_type"]).upper()
        entity_id = uuid.UUID(str(row["entity_id"]))
        result: dict[str, Any] = {"entity_type": entity_type, "entity_id": str(entity_id), "idempotency_key": row["idempotency_key"]}
        fingerprint = _row_fingerprint(row)
        saved = _saved_key(db, plant_id, row["idempotency_key"])
        if saved is not None:
            if saved.fingerprint != fingerprint or saved.entity_id != entity_id:
                results.append({**result, "ok": False, "status_code": 409, "message": "This row was already saved with other values. Refresh the bill."})
            else:
                results.append({**(saved.result or {}), "idempotent": True})
            continue
        try:
            with db.begin_nested():
                outcome = _save_row(db, plant_id, key, receipts, row, entity_type, entity_id, current_user, actor,
                                    QualityInspectionCreate, record_quality_inspection, refresh_receipt_stock)
                stored = {**result, "ok": True, **outcome}
                db.add(IncomingQcEntryKey(plant_id=plant_id, idempotency_key=row["idempotency_key"], kind="ENTRY", entity_type=entity_type,
                                          entity_id=entity_id, fingerprint=fingerprint, result=stored, created_by=actor))
                db.flush()
            results.append(stored)
        except HTTPException as exc:
            detail = exc.detail if isinstance(exc.detail, str) else (exc.detail or {}).get("message") if isinstance(exc.detail, dict) else str(exc.detail)
            results.append({**result, "ok": False, "status_code": exc.status_code, "message": detail or "Not saved"})
    variance_error = None
    if any(item.get("ok") and not item.get("idempotent") for item in results) and receipts:
        try:
            with db.begin_nested():
                wv.recompute(db, plant_id, key, ctx_of(current_user))
        except HTTPException as exc:
            variance_error = str(exc.detail)
    db.commit()
    detail = bill_detail(db, [plant_id], key)
    return {"rows": results, "saved": sum(1 for item in results if item.get("ok")), "failed": sum(1 for item in results if not item.get("ok")),
            "variance_error": variance_error, "bill": detail}


def _save_row(db, plant_id, key, receipts, row, entity_type, entity_id, current_user, actor, QualityInspectionCreate,
              record_quality_inspection, refresh_receipt_stock) -> dict[str, Any]:
    _, lots = load_bill(db, [plant_id], key)
    lot = next((item for item in lots if item.entity_type == entity_type and item.entity_id == entity_id), None)
    if lot is None:
        other = bill_key_of_lot(db, [plant_id], entity_type, entity_id)
        raise HTTPException(status_code=404, detail="This lot is on another bill; open that bill to enter it." if other else "Lot not found in this plant")
    decision = str(row.get("decision") or "ACCEPT").upper()
    actual = row.get("actual_qty")
    actual = wv.dec(actual) if actual is not None else None
    if actual is not None and (actual <= 0 or actual > MAX_QTY):
        raise HTTPException(status_code=422, detail="Enter the actual weight as a number above zero.")
    if actual is not None:
        actual = wv.q3(actual)
    variance = db.query(PurchaseWeightVariance).filter(PurchaseWeightVariance.plant_id == plant_id, PurchaseWeightVariance.bill_key == key).first()
    if actual is not None and lot.actual_qty is not None and actual != lot.actual_qty:
        when = lot.entity.weighed_at.strftime("%d %b %H:%M") if lot.entity.weighed_at else ""
        raise HTTPException(status_code=409, detail=f"Already weighed by {lot.entity.weighed_by or 'someone'} {when}: {_qty_text(lot.actual_qty, lot.uom)}. Use Re-weigh with a reason to change it.")
    new_weight = actual is not None and lot.actual_qty is None
    if new_weight:
        frozen = wv.weights_frozen(db, variance)
        if frozen:
            raise HTTPException(status_code=409, detail=frozen)
        if not row.get("confirm_far"):
            warning = typo_guard(actual, lot.bill_qty, lot.uom)
            if warning:
                raise HTTPException(status_code=422, detail=warning)
    if decision == "ACCEPT" and lot.bill_qty is not None and actual is None and lot.actual_qty is None:
        raise HTTPException(status_code=422, detail="Weigh it first: Accept needs the actual weight. Hold or Reject do not.")
    if decision == "NONE" and not new_weight:
        raise HTTPException(status_code=422, detail="Nothing to save on this row.")
    base = row.get("base_inspection_id")
    current_inspection = str(lot.inspection.id) if lot.inspection is not None else ""
    if decision != "NONE" and base is not None and str(base) != current_inspection:
        who = lot.inspection.created_by if lot.inspection is not None else "someone"
        raise HTTPException(status_code=409, detail=f"Already checked by {who} since you opened the bill. Refresh the bill.")
    if decision != "NONE" and (str(lot.entity.stock_status or "").upper() not in ENTRY_STATES or lot.rejected):
        raise HTTPException(status_code=409, detail=f"{lot.code} is {lot_state(lot)[1].lower()}; it cannot be inspected here.")
    if new_weight:
        lot.entity.actual_qty = actual
        lot.entity.weighed_at = datetime.utcnow()
        lot.entity.weighed_by = actor
        lot.entity.weigh_note = (str(row.get("note") or "").strip() or None) if decision == "NONE" else lot.entity.weigh_note
    outcome: dict[str, Any] = {"actual_qty": float(actual if actual is not None else lot.actual_qty) if (actual is not None or lot.actual_qty is not None) else None,
                               "weighed": new_weight}
    if decision != "NONE":
        relax_entity_profile(lot)
    # The inspection path re-reads the lot with populate_existing: flush the weight and the relaxed
    # standard first so they are not overwritten.
    db.flush()
    if decision != "NONE":
        readings = {code: value for code, value in (row.get("readings") or {}).items() if code not in RETIRED_CODES and value not in (None, "")}
        reason_code = str(row.get("reason_code") or "").strip().upper() or None
        holds = [hold for hold in lot.holds if hold.hold_kind == "INSPECTION" and hold.source_inspection_id]
        close = bool(row.get("close_holds")) and decision == "ACCEPT" and holds
        payload = QualityInspectionCreate(
            entity_type=entity_type, entity_id=entity_id, source="INWARD", readings=readings,
            reasons={code: "x" for code in readings} if reason_code else {},
            disposition=None if decision == "ACCEPT" else decision,
            notes=(str(row.get("note") or "").strip() or None) if not reason_code else None,
            reason_code=reason_code, reason_note=(str(row.get("reason_note") or "").strip() or None),
            resolve_hold_ids=[hold.id for hold in holds] if close else [],
        )
        response = record_quality_inspection(payload, db, plant_id, current_user, commit=False)
        if response.status in {"FAIL", "INVALID"} and not reason_code:
            failing = ", ".join(str(item.get("label") or item.get("code") or "") for item in response.failures if isinstance(item, dict)) or "a check"
            raise HTTPException(status_code=422, detail=f"{failing} is out of band: choose a reason (Incoming QC) to hold it.")
        outcome.update({"inspection_id": str(response.id), "status": response.status, "disposition": response.disposition,
                        "stock_status": response.stock_status})
    if lot.line is not None:
        db.flush()
        refresh_receipt_stock(db, lot.line)
    db.flush()
    db.refresh(lot.entity)
    outcome["stock_status"] = lot.entity.stock_status
    released = str(lot.entity.stock_status).upper() == "UNRESTRICTED"
    outcome["message"] = (("Weighed · " if new_weight else "") + ("released for issue" if released else "held" if decision != "NONE" else "saved"))
    outcome["released"] = released
    return outcome


def reweigh(db: Session, plant_id: str, entity_type: str, entity_id: uuid.UUID, body: dict[str, Any], current_user: dict) -> dict[str, Any]:
    actor = actor_of(current_user)
    request_key = f"reweigh:{body['request_id']}"
    fingerprint = canonical_hash({key: value for key, value in body.items() if key != "request_id"})
    saved = _saved_key(db, plant_id, request_key)
    if saved is not None:
        if saved.fingerprint != fingerprint:
            raise HTTPException(status_code=409, detail="This correction was already saved with other values.")
        return {**(saved.result or {}), "idempotent": True}
    key = bill_key_of_lot(db, [plant_id], entity_type, entity_id)
    if key is None:
        raise HTTPException(status_code=404, detail="Lot not found in this plant")
    receipts, lots = load_bill(db, [plant_id], key)
    lot = next((item for item in lots if item.entity_type == entity_type.upper() and item.entity_id == entity_id), None)
    if lot is None:
        raise HTTPException(status_code=404, detail="Lot not found in this plant")
    if lot.actual_qty is None:
        raise HTTPException(status_code=409, detail="Not weighed yet: enter the weight on the bill sheet.")
    expected = wv.dec(body.get("expected_actual_qty")) if body.get("expected_actual_qty") is not None else None
    if expected is not None and wv.q3(expected) != lot.actual_qty:
        raise HTTPException(status_code=409, detail=f"The weight changed to {_qty_text(lot.actual_qty, lot.uom)} since you opened it. Refresh the bill.")
    actual = wv.dec(body.get("actual_qty"))
    if actual is None or actual <= 0 or actual > MAX_QTY:
        raise HTTPException(status_code=422, detail="Enter the corrected weight as a number above zero.")
    actual = wv.q3(actual)
    if actual == lot.actual_qty:
        raise HTTPException(status_code=422, detail="That is the weight already saved.")
    variance = db.query(PurchaseWeightVariance).filter(PurchaseWeightVariance.plant_id == plant_id, PurchaseWeightVariance.bill_key == key).with_for_update().first()
    if variance is not None:
        wv.sync_closed(db, variance)
    frozen = wv.weights_frozen(db, variance)
    if frozen:
        raise HTTPException(status_code=409, detail=frozen)
    if variance is not None and variance.status == "CLOSED":
        raise HTTPException(status_code=409, detail="The weight case of this bill is closed; its weights can no longer change.")
    issued = issued_reason(db, lot)
    if issued:
        raise HTTPException(status_code=409, detail=issued)
    if not body.get("confirm_far"):
        warning = typo_guard(actual, lot.bill_qty, lot.uom)
        if warning:
            raise HTTPException(status_code=422, detail=warning)
    choice = resolve_reason(category="WEIGH_CORRECTION", code=body.get("reason_code"), note=body.get("reason_note"),
                            plant_id=plant_id, token=token_of(current_user), what="the weight correction")
    entity = lot.entity
    meta = dict(entity.inward_metadata or {})
    meta["weigh_history"] = [*(meta.get("weigh_history") or []), {
        "from": str(lot.actual_qty), "to": str(actual), "by": actor, "at": datetime.utcnow().isoformat(),
        "previous_by": entity.weighed_by, "previous_at": _iso(entity.weighed_at),
        "reason_code": choice.code, "reason_label": choice.label, "reason_note": choice.note,
    }][-20:]
    entity.inward_metadata = meta
    flag_modified(entity, "inward_metadata")
    entity.actual_qty = actual
    entity.weighed_at = datetime.utcnow()
    entity.weighed_by = actor
    entity.weigh_note = choice.text
    db.flush()
    if receipts:
        wv.recompute(db, plant_id, key, ctx_of(current_user))
    result = {"ok": True, "entity_type": lot.entity_type, "entity_id": str(entity_id), "actual_qty": float(actual), "bill_key": key}
    db.add(IncomingQcEntryKey(plant_id=plant_id, idempotency_key=request_key, kind="REWEIGH", entity_type=lot.entity_type,
                              entity_id=entity_id, fingerprint=fingerprint, result=result, created_by=actor))
    db.commit()
    return {**result, "bill": bill_detail(db, [plant_id], key)}
