"""Weight check of a bill (6 Nov 2026).

short = Σ bill qty − Σ actual qty over the lots of the bill that are not rejected. The check is final only
when every such lot is weighed; before that it is a "so far" figure and nothing fires.

Bands (plant limits, default notify 20 kg and auto 50 kg, snapshotted on the variance):
- short ≤ notify          WITHIN          recorded only
- notify < short ≤ auto   OWNER_DECIDES   Owner gets Make debit note / Skip… (reason WEIGHT_SHORT_SKIP)
- short > auto            AUTO_DEBIT      QUANTITY case + DN draft at once (DN on invoice attach if pending)
- short < 0               EXCESS          recorded only
- any shortage on an item not in kg        OWNER_INFO   notify only

A claim is a ``PurchaseDiscrepancy`` (QUANTITY, case_source QC_WEIGH) on each short bill line's invoice
allocation, assigned to the PO raiser, then a DRAFT debit note through ``services.debit_notes`` (the same
rules as ``POST /debit-notes``). Stock is never posted from a weight.
"""
from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal
from typing import Any, Iterable, Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session

from ..models import (
    InventoryQualityHold,
    InventoryQualityInspection,
    PaperReel,
    PurchaseDebitNote,
    PurchaseDebitNoteLine,
    PurchaseDiscrepancy,
    PurchaseOrder,
    PurchaseReceipt,
    PurchaseReceiptLine,
    ReceiptInvoiceAllocation,
    ReceiptStockAllocation,
    StockBatch,
    SupplierInvoice,
    SupplierInvoiceLine,
)
from ..models_weight import PlantSetting, PurchaseWeightVariance
from ..notify_outbox import enqueue_notification
from ..reasons import ReasonChoice, resolve_reason
from .books import ist_today
from .procurement import canonical_hash

log = logging.getLogger(__name__)

QTY = Decimal("0.001")
MONEY = Decimal("0.01")
ZERO = Decimal("0")
DEFAULT_NOTIFY_KG = Decimal("20")
DEFAULT_AUTO_KG = Decimal("50")
REMINDER_AFTER = timedelta(hours=48)
SYSTEM_ACTOR = "system:weight-check"
WEIGHT_DN_REASON = "DN-WEIGHT-SHORT"
SKIP_CATEGORY = "WEIGHT_SHORT_SKIP"
CASE_SOURCE = "QC_WEIGH"
PENDING_INVOICE_STATUS = "PENDING"
REJECT_DISPOSITIONS = {"REJECT", "BLOCK", "SCRAP"}
KG_UNITS = {"KG", "KGS", "KILOGRAM"}
UNDECIDED = {"PROVISIONAL", "WITHIN", "INFO_SENT", "AWAITING_OWNER"}
CLAIM_STATES = {"CLAIM_RAISED", "WAITING_INVOICE", "DN_DRAFTED"}
# Once the weight case is in a debit note at or past SUBMITTED, weights of the bill are frozen.
DN_FROZEN = {"SUBMITTED", "APPROVED", "ISSUED", "PARTIALLY_SETTLED", "SETTLED"}
DN_CLOSED = {"ISSUED", "PARTIALLY_SETTLED", "SETTLED", "VOID"}


def dec(value: Any) -> Optional[Decimal]:
    if value is None or value == "":
        return None
    try:
        result = Decimal(str(value))
    except Exception:
        return None
    return result if result.is_finite() else None


def q3(value: Decimal) -> Decimal:
    return value.quantize(QTY, rounding=ROUND_HALF_UP)


def money(value: Decimal) -> Decimal:
    return value.quantize(MONEY, rounding=ROUND_HALF_UP)


def is_kg(uom: Any) -> bool:
    return str(getattr(uom, "value", uom) or "").strip().upper() in KG_UNITS


def band_for(short: Decimal, *, kg: bool, notify_kg: Decimal, auto_kg: Decimal) -> str:
    """The band of a final weight check (short > 0 is a shortage, < 0 an excess)."""
    if short < 0:
        return "EXCESS"
    if short == 0:
        return "WITHIN"
    if not kg:
        return "OWNER_INFO"
    if short <= notify_kg:
        return "WITHIN"
    if short <= auto_kg:
        return "OWNER_DECIDES"
    return "AUTO_DEBIT"


# ── Plant settings ─────────────────────────────────────────────────────────────────────────────

def plant_limits(db: Session, plant_id: str) -> tuple[Decimal, Decimal]:
    row = db.get(PlantSetting, str(plant_id))
    if row is None:
        return DEFAULT_NOTIFY_KG, DEFAULT_AUTO_KG
    return Decimal(str(row.weight_short_notify_kg)), Decimal(str(row.weight_short_auto_kg))


# ── Bills and their lots ───────────────────────────────────────────────────────────────────────

def receipt_bill_key(db: Session, receipt: PurchaseReceipt) -> str:
    """One card per GRN; one per supplier invoice when an attached invoice spans several GRNs."""
    if receipt.supplier_invoice_id and not receipt.invoice_pending:
        invoice = db.get(SupplierInvoice, receipt.supplier_invoice_id)
        if invoice is not None and invoice.status != PENDING_INVOICE_STATUS:
            count = db.query(PurchaseReceipt.id).filter(
                PurchaseReceipt.plant_id == receipt.plant_id,
                PurchaseReceipt.supplier_invoice_id == receipt.supplier_invoice_id,
            ).count()
            if count > 1:
                return f"I:{receipt.supplier_invoice_id}"
    return f"R:{receipt.id}"


def parse_bill_key(raw: str) -> tuple[str, str]:
    text_value = str(raw or "").strip()
    if ":" not in text_value:
        try:
            return "R", str(uuid.UUID(text_value))
        except ValueError as exc:
            raise HTTPException(status_code=404, detail="Bill not found") from exc
    kind, _, rest = text_value.partition(":")
    kind = kind.upper()
    if kind in {"R", "I"}:
        try:
            return kind, str(uuid.UUID(rest))
        except ValueError as exc:
            raise HTTPException(status_code=404, detail="Bill not found") from exc
    if kind == "L":
        entity_type, _, entity_id = rest.partition(":")
        try:
            return "L", f"{entity_type.upper()}:{uuid.UUID(entity_id)}"
        except ValueError as exc:
            raise HTTPException(status_code=404, detail="Lot not found") from exc
    raise HTTPException(status_code=404, detail="Bill not found")


def bill_receipts(db: Session, plant_ids: Iterable[str], key: str) -> list[PurchaseReceipt]:
    kind, value = parse_bill_key(key)
    plants = [str(plant) for plant in plant_ids]
    if kind == "R":
        receipt = db.query(PurchaseReceipt).filter(PurchaseReceipt.id == uuid.UUID(value), PurchaseReceipt.plant_id.in_(plants)).first()
        return [receipt] if receipt else []
    if kind == "I":
        return db.query(PurchaseReceipt).filter(PurchaseReceipt.supplier_invoice_id == uuid.UUID(value),
                                                PurchaseReceipt.plant_id.in_(plants)).order_by(PurchaseReceipt.created_at).all()
    return []


@dataclass
class LotFact:
    entity_type: str
    entity: Any
    line: Optional[PurchaseReceiptLine]
    receipt: Optional[PurchaseReceipt]
    item: Any
    uom: str
    bill_qty: Optional[Decimal]
    actual_qty: Optional[Decimal]
    inspection: Optional[InventoryQualityInspection] = None
    holds: list = field(default_factory=list)

    @property
    def entity_id(self):
        return self.entity.id

    @property
    def key(self) -> str:
        return f"{self.entity_type}:{self.entity.id}"

    @property
    def code(self) -> str:
        return self.entity.reel_code if self.entity_type == "REEL" else self.entity.batch_no

    @property
    def vendor_ref(self) -> Optional[str]:
        if self.entity_type == "REEL":
            return self.entity.source_reel_no or self.entity.vendor_batch_no
        meta = self.entity.inward_metadata or {}
        return meta.get("vendor_batch_no") or None

    @property
    def rejected(self) -> bool:
        if str(self.entity.stock_status or "").upper() == "RETURNED":
            return True
        return self.inspection is not None and str(self.inspection.disposition or "").upper() in REJECT_DISPOSITIONS

    @property
    def weighed(self) -> bool:
        return self.actual_qty is not None

    @property
    def kg(self) -> bool:
        return is_kg(self.uom)


def _uom_of(line: Optional[PurchaseReceiptLine], item: Any) -> str:
    if line is not None and line.order_line is not None and line.order_line.uom:
        return str(line.order_line.uom).upper()
    return str(getattr(getattr(item, "uom", None), "value", getattr(item, "uom", None)) or "KG").upper()


def load_lots(db: Session, receipts: list[PurchaseReceipt]) -> list[LotFact]:
    """Every reel and lot of the bill's GRN lines, with its last inspection and open holds."""
    line_ids = [line.id for receipt in receipts for line in (receipt.lines or [])]
    if not line_ids:
        return []
    lines = {line.id: line for receipt in receipts for line in (receipt.lines or [])}
    allocations = db.query(ReceiptStockAllocation).filter(ReceiptStockAllocation.receipt_line_id.in_(line_ids)).order_by(ReceiptStockAllocation.created_at).all()
    reel_ids = [row.reel_id for row in allocations if row.reel_id]
    batch_ids = [row.batch_id for row in allocations if row.batch_id]
    reels = {row.id: row for row in db.query(PaperReel).filter(PaperReel.id.in_(reel_ids)).all()} if reel_ids else {}
    batches = {row.id: row for row in db.query(StockBatch).filter(StockBatch.id.in_(batch_ids)).all()} if batch_ids else {}
    return _facts(db, [(allocation, lines.get(allocation.receipt_line_id)) for allocation in allocations], reels, batches)


def _facts(db: Session, pairs, reels: dict, batches: dict) -> list[LotFact]:
    entity_ids = list(reels) + list(batches)
    latest: dict[Any, InventoryQualityInspection] = {}
    holds: dict[Any, list] = {}
    if entity_ids:
        for inspection in db.query(InventoryQualityInspection).filter(InventoryQualityInspection.entity_id.in_(entity_ids)).order_by(
                InventoryQualityInspection.created_at.desc(), InventoryQualityInspection.id.desc()).all():
            latest.setdefault(inspection.entity_id, inspection)
        for hold in db.query(InventoryQualityHold).filter(InventoryQualityHold.entity_id.in_(entity_ids), InventoryQualityHold.status == "HOLD").all():
            holds.setdefault(hold.entity_id, []).append(hold)
    facts: list[LotFact] = []
    for allocation, line in pairs:
        if allocation.reel_id and allocation.reel_id in reels:
            reel = reels[allocation.reel_id]
            item = reel.paper
            facts.append(LotFact("REEL", reel, line, line.receipt if line else None, item, _uom_of(line, item),
                                 dec(reel.inward_weight_kg), dec(reel.actual_qty), latest.get(reel.id), holds.get(reel.id, [])))
        elif allocation.batch_id and allocation.batch_id in batches:
            batch = batches[allocation.batch_id]
            item = batch.item
            billed = dec(batch.billed_qty) if batch.billed_qty is not None else dec(batch.received_qty)
            facts.append(LotFact("BATCH", batch, line, line.receipt if line else None, item, _uom_of(line, item),
                                 billed, dec(batch.actual_qty), latest.get(batch.id), holds.get(batch.id, [])))
    return facts


def lone_lot_fact(db: Session, entity_type: str, entity) -> LotFact:
    """A held lot with no GRN (opening stock put on hold at go-live): no bill weight to check."""
    reels = {entity.id: entity} if entity_type == "REEL" else {}
    batches = {entity.id: entity} if entity_type == "BATCH" else {}

    class _Alloc:
        reel_id = entity.id if entity_type == "REEL" else None
        batch_id = entity.id if entity_type == "BATCH" else None

    fact = _facts(db, [(_Alloc, None)], reels, batches)[0]
    fact.bill_qty = None
    return fact


# ── Figures ────────────────────────────────────────────────────────────────────────────────────

@dataclass
class BillFigures:
    lots_total: int
    lots_weighed: int
    lots_excluded: int
    bill_total: Decimal
    bill_weighed: Decimal
    actual_total: Decimal
    short_so_far: Decimal
    final: bool
    kg_short: Decimal
    non_kg_short: bool
    all_kg: bool
    has_kg: bool
    uom: str

    @property
    def short(self) -> Decimal:
        return self.short_so_far


def bill_figures(lots: list[LotFact]) -> BillFigures:
    counted = [lot for lot in lots if not lot.rejected and lot.bill_qty is not None]
    weighed = [lot for lot in counted if lot.weighed]
    bill_total = sum((lot.bill_qty for lot in counted), ZERO)
    bill_weighed = sum((lot.bill_qty for lot in weighed), ZERO)
    actual_total = sum((lot.actual_qty for lot in weighed), ZERO)
    kg_lots = [lot for lot in weighed if lot.kg]
    kg_short = sum((lot.bill_qty - lot.actual_qty for lot in kg_lots), ZERO)
    non_kg: dict[str, Decimal] = {}
    for lot in weighed:
        if not lot.kg:
            non_kg[lot.uom] = non_kg.get(lot.uom, ZERO) + lot.bill_qty - lot.actual_qty
    units = {lot.uom for lot in counted}
    return BillFigures(
        lots_total=len(lots), lots_weighed=len(weighed), lots_excluded=len(lots) - len(counted),
        bill_total=q3(bill_total), bill_weighed=q3(bill_weighed), actual_total=q3(actual_total),
        short_so_far=q3(bill_weighed - actual_total), final=len(weighed) == len(counted),
        kg_short=q3(kg_short), non_kg_short=any(value > 0 for value in non_kg.values()),
        all_kg=all(is_kg(unit) for unit in units) if units else True,
        has_kg=any(is_kg(unit) for unit in units),
        uom=(next(iter(units)) if len(units) == 1 else "MIXED") if units else "KG",
    )


def figures_band(figures: BillFigures, notify_kg: Decimal, auto_kg: Decimal) -> str:
    """Band of a final check. kg lines decide the band; a shortage on a non-kg line is OWNER_INFO only."""
    if figures.all_kg:
        return band_for(figures.kg_short, kg=True, notify_kg=notify_kg, auto_kg=auto_kg)
    kg_band = band_for(figures.kg_short, kg=True, notify_kg=notify_kg, auto_kg=auto_kg)
    if kg_band in {"OWNER_DECIDES", "AUTO_DEBIT"}:
        return kg_band
    return "OWNER_INFO" if figures.non_kg_short else kg_band


# ── Claim lines ────────────────────────────────────────────────────────────────────────────────

ACTIVE_CASE = {"OPEN", "UNDER_REVIEW", "CLAIM_DRAFTED", "CLAIMED", "ACCEPTED"}


def _real_allocation(db: Session, line: PurchaseReceiptLine):
    row = db.query(ReceiptInvoiceAllocation, SupplierInvoiceLine, SupplierInvoice).join(
        SupplierInvoiceLine, SupplierInvoiceLine.id == ReceiptInvoiceAllocation.invoice_line_id,
    ).join(SupplierInvoice, SupplierInvoice.id == SupplierInvoiceLine.invoice_id).filter(
        ReceiptInvoiceAllocation.receipt_line_id == line.id, SupplierInvoice.status != PENDING_INVOICE_STATUS,
    ).order_by(ReceiptInvoiceAllocation.created_at).first()
    return row if row else (None, None, None)


def claim_lines(db: Session, lots: list[LotFact], net_short: Decimal) -> list[dict[str, Any]]:
    """Per GRN line: bill / actual / short, rate (invoice rate, else PO rate) and the kg to claim.

    kg already claimed on the line by the GRN's own QUANTITY case (invoice qty above the GRN) is never
    claimed again: claim kg = min(line short, billed − actual − kg claimed by that case), where billed is the
    invoice qty of the line (less rejected lots), else the bill weights."""
    by_line: dict[Any, list[LotFact]] = {}
    for lot in lots:
        if lot.line is not None and lot.kg:
            by_line.setdefault(lot.line.id, []).append(lot)
    rows: list[dict[str, Any]] = []
    for line_id, group in by_line.items():
        line = group[0].line
        counted = [lot for lot in group if not lot.rejected and lot.bill_qty is not None]
        rejected_bill = sum((lot.bill_qty or ZERO for lot in group if lot.rejected), ZERO)
        weighed = [lot for lot in counted if lot.weighed]
        bill = sum((lot.bill_qty for lot in counted), ZERO)
        actual = sum((lot.actual_qty for lot in weighed), ZERO)
        short = q3(sum((lot.bill_qty for lot in weighed), ZERO) - actual)
        allocation, invoice_line, invoice = _real_allocation(db, line)
        grn_claimed = ZERO
        if allocation is not None:
            grn_case = db.query(PurchaseDiscrepancy).filter(
                PurchaseDiscrepancy.allocation_id == allocation.id, PurchaseDiscrepancy.discrepancy_type == "QUANTITY",
                PurchaseDiscrepancy.case_source == "GRN",
            ).first()
            if grn_case is not None and grn_case.status in ACTIVE_CASE - {"ACCEPTED"}:
                grn_claimed = max(dec(grn_case.delta) or ZERO, ZERO)
            billed_basis = (dec(invoice_line.qty) or bill) - rejected_bill
            rate = dec(invoice_line.rate)
            rate_source = "INVOICE"
        else:
            billed_basis = bill
            rate = dec(line.po_rate) if line.po_rate is not None else dec(line.unit_cost)
            rate_source = "PO"
        claim_kg = max(ZERO, min(short, billed_basis - actual - grn_claimed)) if short > 0 else ZERO
        rows.append({
            "receipt_line_id": str(line.id), "receipt_id": str(line.receipt_id),
            "allocation_id": str(allocation.id) if allocation is not None else None,
            "item_id": str(line.item_id), "item_code": getattr(line.item, "item_code", None), "item_name": getattr(line.item, "name", None),
            "uom": group[0].uom, "lots": len(group), "bill_qty": str(q3(bill)), "actual_qty": str(q3(actual)),
            "short_qty": str(short), "grn_claimed_qty": str(q3(grn_claimed)), "billed_basis_qty": str(q3(billed_basis)),
            "claim_qty": str(q3(claim_kg)), "rate": str(rate) if rate is not None else None, "rate_source": rate_source,
            "invoice_pending": allocation is None, "invoice_no": invoice.invoice_no if invoice is not None else None,
        })
    total_claim = sum((Decimal(row["claim_qty"]) for row in rows), ZERO)
    if net_short > 0 and total_claim > net_short:
        # One line short, another over: never claim more kg than the bill as a whole is short.
        scale = net_short / total_claim
        for row in rows:
            row["claim_qty"] = str(q3(Decimal(row["claim_qty"]) * scale))
    for row in rows:
        rate = dec(row["rate"])
        row["amount"] = str(money(Decimal(row["claim_qty"]) * rate)) if rate is not None else "0.00"
    return rows


def _rate_basis(lines: list[dict[str, Any]]) -> str:
    sources = {row["rate_source"] for row in lines if Decimal(row["claim_qty"]) > 0}
    if not sources:
        return "NONE"
    return next(iter(sources)) if len(sources) == 1 else "MIXED"


# ── Recompute ──────────────────────────────────────────────────────────────────────────────────

def _po_raiser(receipts: list[PurchaseReceipt]) -> Optional[str]:
    for receipt in receipts:
        if receipt.order is not None and receipt.order.created_by:
            return receipt.order.created_by
    return receipts[0].created_by if receipts else None


def bill_label(db: Session, receipts: list[PurchaseReceipt]) -> str:
    invoice = None
    for receipt in receipts:
        if receipt.supplier_invoice_id and not receipt.invoice_pending:
            invoice = db.get(SupplierInvoice, receipt.supplier_invoice_id)
            if invoice is not None and invoice.status == PENDING_INVOICE_STATUS:
                invoice = None
            if invoice is not None:
                break
    challans = ", ".join(dict.fromkeys(r.supplier_challan_no for r in receipts if r.supplier_challan_no)) or None
    if invoice is not None:
        return f"Bill {invoice.invoice_no}" + (f" · Challan {challans}" if challans else "")
    if challans:
        return f"Challan {challans} · bill to follow"
    return f"GRN {', '.join(r.grn_no for r in receipts)}"


def _lots_evidence(lots: list[LotFact]) -> list[dict[str, Any]]:
    return [{
        "entity_type": lot.entity_type, "entity_id": str(lot.entity_id), "code": lot.code, "vendor_ref": lot.vendor_ref,
        "uom": lot.uom, "bill_qty": str(lot.bill_qty) if lot.bill_qty is not None else None,
        "actual_qty": str(lot.actual_qty) if lot.actual_qty is not None else None,
        "weighed_by": lot.entity.weighed_by, "weighed_at": lot.entity.weighed_at.isoformat() if lot.entity.weighed_at else None,
        "rejected": lot.rejected, "receipt_line_id": str(lot.line.id) if lot.line is not None else None,
    } for lot in lots]


def _history(variance: PurchaseWeightVariance, event: str, actor: str, **extra: Any) -> None:
    variance.history = [*(variance.history or []), {"event": event, "by": actor, "at": datetime.utcnow().isoformat(), **extra}][-60:]


def get_or_create_variance(db: Session, plant_id: str, key: str, receipts: list[PurchaseReceipt]) -> PurchaseWeightVariance:
    variance = db.query(PurchaseWeightVariance).filter(PurchaseWeightVariance.plant_id == plant_id,
                                                       PurchaseWeightVariance.bill_key == key).with_for_update().first()
    if variance is None:
        notify_kg, auto_kg = plant_limits(db, plant_id)
        first = receipts[0]
        variance = PurchaseWeightVariance(
            plant_id=plant_id, bill_key=key, receipt_id=first.id,
            supplier_invoice_id=uuid.UUID(key[2:]) if key.startswith("I:") else (first.supplier_invoice_id if not first.invoice_pending else None),
            receipt_ids=[str(r.id) for r in receipts], supplier_id=first.supplier_id, supplier_name=first.supplier_name_snapshot,
            purchase_order_id=first.purchase_order_id, po_no=first.order.po_no if first.order is not None else None,
            po_raiser=_po_raiser(receipts), notify_kg=notify_kg, auto_kg=auto_kg, status="PROVISIONAL",
            discrepancy_ids=[], lines_json=[], lots_json=[], history=[], claim_cycle=0, version=1,
        )
        db.add(variance)
        db.flush()
    return variance


def regroup_receipt(db: Session, receipt: PurchaseReceipt, actor: str) -> str:
    """A GRN that now shares an attached invoice with another GRN is checked as one bill (by invoice):
    undecided per-GRN checks of those GRNs are dropped; decided ones stay as they are."""
    key = receipt_bill_key(db, receipt)
    if key.startswith("I:"):
        others = [r for r in bill_receipts(db, [receipt.plant_id], key)]
        old_keys = [f"R:{r.id}" for r in others]
        for old in db.query(PurchaseWeightVariance).filter(PurchaseWeightVariance.plant_id == receipt.plant_id,
                                                           PurchaseWeightVariance.bill_key.in_(old_keys)).all():
            if old.status in UNDECIDED and not old.discrepancy_ids:
                db.delete(old)
        db.flush()
    return key


def variance_dn(db: Session, variance: PurchaseWeightVariance) -> Optional[PurchaseDebitNote]:
    return db.get(PurchaseDebitNote, variance.debit_note_id) if variance.debit_note_id else None


def weights_frozen(db: Session, variance: Optional[PurchaseWeightVariance]) -> Optional[str]:
    """Why the bill's weights can no longer change (its case is in a submitted or later DN), else None."""
    if variance is None:
        return None
    note = variance_dn(db, variance)
    if note is not None and note.status in DN_FROZEN:
        return f"Debit note {note.debit_note_no} for this bill's weight is {note.status.lower()}; weights can no longer change."
    return None


@dataclass
class Context:
    actor: str
    token: Optional[str]


def recompute(db: Session, plant_id: str, key: str, ctx: Context, *, receipts: Optional[list[PurchaseReceipt]] = None) -> Optional[PurchaseWeightVariance]:
    """Refresh the bill's weight check and run what its band calls for. Flushes, never commits."""
    receipts = receipts if receipts is not None else bill_receipts(db, [plant_id], key)
    if not receipts:
        return None
    lots = load_lots(db, receipts)
    if not lots:
        return None
    existing = db.query(PurchaseWeightVariance).filter(PurchaseWeightVariance.plant_id == plant_id,
                                                       PurchaseWeightVariance.bill_key == key).first()
    figures = bill_figures(lots)
    if existing is None and figures.lots_weighed == 0:
        return None
    variance = existing or get_or_create_variance(db, plant_id, key, receipts)
    sync_closed(db, variance)
    if variance.status == "CLOSED":
        return variance
    if weights_frozen(db, variance):
        return variance
    # kg lines decide the bill (Σ bill − Σ actual so far, final once all are weighed); a bill with no kg
    # line at all shows its own unit.
    net_short = figures.kg_short if figures.has_kg else figures.short_so_far
    lines = claim_lines(db, lots, figures.kg_short if figures.final else ZERO)
    variance.receipt_ids = [str(r.id) for r in receipts]
    variance.uom = figures.uom[:12]
    variance.bill_total = figures.bill_total
    variance.actual_total = figures.actual_total
    variance.lots_total = figures.lots_total
    variance.lots_weighed = figures.lots_weighed
    variance.lots_excluded = figures.lots_excluded
    variance.short_qty = max(net_short, ZERO)
    variance.excess_qty = max(-net_short, ZERO)
    variance.lines_json = lines
    variance.lots_json = _lots_evidence(lots)
    variance.rate_basis = _rate_basis(lines)
    variance.claim_amount = sum((Decimal(row["amount"]) for row in lines), ZERO) if figures.final else ZERO
    variance.is_final = figures.final
    variance.updated_at = datetime.utcnow()
    if not figures.final:
        if variance.status in UNDECIDED:
            variance.status = "PROVISIONAL"
            variance.band = None
        variance.version += 1
        db.flush()
        return variance
    band = figures_band(figures, Decimal(str(variance.notify_kg)), Decimal(str(variance.auto_kg)))
    previous_status = variance.status
    variance.band = band
    if variance.final_at is None or previous_status == "PROVISIONAL":
        variance.final_at = datetime.utcnow()
    _apply_band(db, variance, band, receipts, ctx)
    variance.version += 1
    db.flush()
    return variance


def _apply_band(db: Session, variance: PurchaseWeightVariance, band: str, receipts: list[PurchaseReceipt], ctx: Context) -> None:
    status = variance.status
    if status in UNDECIDED:
        if band in {"WITHIN", "EXCESS"}:
            variance.status = "WITHIN"
        elif band == "OWNER_INFO":
            variance.status = "INFO_SENT"
            if variance.notified_status != "INFO_SENT":
                _notify_info(db, variance, receipts)
        elif band == "OWNER_DECIDES":
            variance.status = "AWAITING_OWNER"
            if variance.notified_status != "AWAITING_OWNER":
                _notify_decide(db, variance, receipts)
        elif band == "AUTO_DEBIT":
            _start_claim(db, variance, "AUTO", SYSTEM_ACTOR, receipts, ctx)
        return
    if status == "SKIPPED":
        if band == "AUTO_DEBIT":
            _history(variance, "REOPENED", ctx.actor, reason="Re-weighed above the auto limit")
            _start_claim(db, variance, "AUTO", SYSTEM_ACTOR, receipts, ctx)
        elif band in {"WITHIN", "EXCESS"}:
            variance.status = "WITHIN"
        return
    if status in CLAIM_STATES:
        keep = band == "AUTO_DEBIT" or (band == "OWNER_DECIDES" and variance.decision == "MAKE_DEBIT_NOTE")
        if not keep:
            withdraw_claim(db, variance, ctx, why="Re-weighed: the bill is no longer short beyond the limit")
            variance.decision = None
            variance.decided_by = None
            variance.decided_at = None
            variance.status = "PROVISIONAL"
            variance.notified_status = None
            _apply_band(db, variance, band, receipts, ctx)
            return
        ensure_claim(db, variance, receipts, ctx)


def _start_claim(db: Session, variance: PurchaseWeightVariance, decision: str, actor: str, receipts: list[PurchaseReceipt], ctx: Context) -> None:
    variance.decision = decision
    variance.decided_by = actor
    variance.decided_at = datetime.utcnow()
    variance.status = "CLAIM_RAISED"
    variance.claim_cycle = int(variance.claim_cycle or 0) + 1
    _history(variance, "CLAIM_RAISED", actor, decision=decision, short_qty=str(variance.short_qty))
    ensure_claim(db, variance, receipts, ctx)
    if decision == "AUTO":
        _notify_auto(db, variance, receipts)


def ensure_claim(db: Session, variance: PurchaseWeightVariance, receipts: list[PurchaseReceipt], ctx: Context) -> None:
    """Cases on every claimable line that has its invoice; then the DRAFT debit note (or its update)."""
    lines = variance.lines_json or []
    claimable = [row for row in lines if Decimal(row["claim_qty"]) > 0]
    if not claimable:
        variance.last_error = "Nothing to claim on any line (no rate, or the kg are already claimed on the GRN)."
        return
    if any(row["invoice_pending"] for row in claimable):
        variance.status = "WAITING_INVOICE"
        variance.last_error = None
        return
    lots = variance.lots_json or []
    weighed_by = sorted({lot["weighed_by"] for lot in lots if lot.get("weighed_by")})
    weighed_at = max((lot["weighed_at"] for lot in lots if lot.get("weighed_at")), default=None)
    case_ids: list[str] = []
    for row in lines:
        allocation_id = row.get("allocation_id")
        if not allocation_id:
            continue
        case = db.query(PurchaseDiscrepancy).filter(PurchaseDiscrepancy.allocation_id == uuid.UUID(allocation_id),
                                                    PurchaseDiscrepancy.discrepancy_type == "QUANTITY",
                                                    PurchaseDiscrepancy.case_source == CASE_SOURCE).with_for_update().first()
        claim_qty = Decimal(row["claim_qty"])
        amount = Decimal(row["amount"])
        if claim_qty <= 0 or amount <= 0:
            if case is not None and case.status in {"OPEN", "UNDER_REVIEW"}:
                case.status = "REJECTED"
                case.resolution_reason = "Withdrawn: this line is not short after weighing"
                case.resolved_at = datetime.utcnow()
                case.version += 1
            continue
        allocation = db.get(ReceiptInvoiceAllocation, uuid.UUID(allocation_id))
        evidence = {
            "source": "QC_WEIGH", "variance_id": str(variance.id), "bill_key": variance.bill_key,
            "bill_qty": row["bill_qty"], "actual_qty": row["actual_qty"], "short_qty": row["short_qty"],
            "grn_claimed_qty": row["grn_claimed_qty"], "claim_qty": row["claim_qty"], "rate": row["rate"],
            "rate_source": row["rate_source"], "weighed_by": weighed_by, "weighed_at": weighed_at,
            "lots": [lot for lot in lots if lot.get("receipt_line_id") == row["receipt_line_id"]],
            "band": variance.band, "decision": variance.decision, "po_raiser": variance.po_raiser,
            "gate_photo_doc_ids": [],
        }
        if case is None:
            case = PurchaseDiscrepancy(
                plant_id=variance.plant_id, allocation_id=allocation.id, discrepancy_type="QUANTITY", case_source=CASE_SOURCE,
                quantity=claim_qty, po_rate=allocation.po_rate, invoice_rate=Decimal(row["rate"]), delta=claim_qty,
                claimable_amount=amount, evidence_json=evidence, status="OPEN", assignee=variance.po_raiser, version=1,
            )
            db.add(case)
            db.flush()
        else:
            if case.status in {"REJECTED", "RESOLVED"}:
                case.status = "OPEN"
                case.resolution_reason = None
                case.resolved_at = None
            if case.status in {"OPEN", "UNDER_REVIEW", "CLAIM_DRAFTED"}:
                case.quantity = claim_qty
                case.delta = claim_qty
                case.invoice_rate = Decimal(row["rate"])
                case.po_rate = allocation.po_rate
                case.claimable_amount = amount
                case.evidence_json = evidence
                case.assignee = case.assignee or variance.po_raiser
                case.version += 1
        case_ids.append(str(case.id))
    variance.discrepancy_ids = case_ids
    variance.discrepancy_id = uuid.UUID(case_ids[0]) if case_ids else None
    db.flush()
    _draft_or_update_dn(db, variance, ctx)


def _dn_reason(variance: PurchaseWeightVariance, ctx: Context) -> ReasonChoice:
    note = f"Bill weighed {variance.short_qty} kg short at incoming QC ({variance.bill_key})."
    return resolve_reason(category="DEBIT_NOTE", code=WEIGHT_DN_REASON, note=note, plant_id=variance.plant_id,
                          token=ctx.token, what="the weight debit note")


def _draft_or_update_dn(db: Session, variance: PurchaseWeightVariance, ctx: Context) -> None:
    from .debit_notes import create_debit_note

    cases = [db.get(PurchaseDiscrepancy, uuid.UUID(case_id)) for case_id in variance.discrepancy_ids or []]
    cases = [case for case in cases if case is not None]
    note = variance_dn(db, variance)
    if note is not None and note.status == "DRAFT":
        lines = {line.discrepancy_id: line for line in note.lines or []}
        for case in cases:
            line = lines.get(case.id)
            if line is None and case.status in {"OPEN", "UNDER_REVIEW"} and case.claimable_amount > 0:
                db.add(PurchaseDebitNoteLine(debit_note_id=note.id, discrepancy_id=case.id, claimed_amount=case.claimable_amount))
                case.status = "CLAIM_DRAFTED"
            elif line is not None:
                line.claimed_amount = case.claimable_amount
        db.flush()
        db.refresh(note)
        note.total_amount = sum((Decimal(str(line.claimed_amount)) for line in note.lines or []), ZERO)
        note.version += 1
        variance.status = "DN_DRAFTED"
        _history(variance, "DN_UPDATED", ctx.actor, debit_note_no=note.debit_note_no, total=str(note.total_amount))
        return
    if note is not None and note.status != "VOID":
        variance.status = "DN_DRAFTED"
        return
    open_cases = [case for case in cases if case.status in {"OPEN", "UNDER_REVIEW"} and case.claimable_amount > 0]
    if not open_cases:
        drafted = [case for case in cases if case.status == "CLAIM_DRAFTED"]
        if drafted:
            line = db.query(PurchaseDebitNoteLine).filter(PurchaseDebitNoteLine.discrepancy_id == drafted[0].id).first()
            if line is not None:
                variance.debit_note_id = line.debit_note_id
                variance.status = "DN_DRAFTED"
        return
    request_id = uuid.uuid5(uuid.NAMESPACE_URL, f"hariom:weight-variance:{variance.id}:{variance.claim_cycle}")
    fingerprint = canonical_hash({"variance_id": str(variance.id), "cycle": variance.claim_cycle,
                                  "discrepancy_ids": sorted(str(case.id) for case in open_cases)})
    try:
        with db.begin_nested():
            choice = _dn_reason(variance, ctx)
            note, _ = create_debit_note(
                db, plant_id=variance.plant_id, request_id=request_id, request_fingerprint=fingerprint,
                note_date=ist_today(), discrepancy_ids=[case.id for case in open_cases], reason_code=choice.code,
                reason_note=choice.note, actor=SYSTEM_ACTOR, token=ctx.token, choice=choice,
            )
    except HTTPException as exc:
        variance.last_error = f"Debit note not drafted yet: {exc.detail}"
        log.warning("weight variance %s: debit note not drafted: %s", variance.id, exc.detail)
        return
    variance.debit_note_id = note.id
    variance.status = "DN_DRAFTED"
    variance.last_error = None
    _history(variance, "DN_DRAFTED", SYSTEM_ACTOR, debit_note_no=note.debit_note_no, total=str(note.total_amount))
    _notify_follow_up(db, variance, note)


def withdraw_claim(db: Session, variance: PurchaseWeightVariance, ctx: Context, *, why: str) -> None:
    """Take back the weight claim of a bill (re-weighed): its DRAFT debit note is voided, its cases closed."""
    note = variance_dn(db, variance)
    case_ids = {uuid.UUID(value) for value in variance.discrepancy_ids or []}
    if note is not None and note.status not in {"VOID"}:
        if note.status != "DRAFT":
            raise HTTPException(status_code=409, detail=f"Debit note {note.debit_note_no} is {note.status.lower()}; the weight claim cannot change now.")
        foreign = [line for line in note.lines or [] if line.discrepancy_id not in case_ids]
        if foreign:
            raise HTTPException(status_code=409, detail=f"Debit note {note.debit_note_no} also carries other cases. Void it on Debit notes first, then re-weigh.")
        void = resolve_reason(category="DEBIT_NOTE", code="DN-VOID-ERROR", note=why, plant_id=variance.plant_id,
                              token=ctx.token, what="voiding the weight debit note")
        note.void_reason, note.void_reason_code, note.void_reason_label, note.void_reason_note = void.text, void.code, void.label, void.note
        note.status = "VOID"
        note.version += 1
        _history(variance, "DN_VOIDED", ctx.actor, debit_note_no=note.debit_note_no, reason=why)
    for case_id in case_ids:
        case = db.get(PurchaseDiscrepancy, case_id)
        if case is not None and case.status in {"OPEN", "UNDER_REVIEW", "CLAIM_DRAFTED"}:
            case.status = "REJECTED"
            case.resolution_reason = f"Withdrawn: {why}"
            case.resolved_at = datetime.utcnow()
            case.version += 1
    variance.debit_note_id = None
    variance.discrepancy_ids = []
    variance.discrepancy_id = None
    db.flush()


def sync_closed(db: Session, variance: PurchaseWeightVariance) -> bool:
    """A weight case whose debit note was issued or voided is CLOSED (read on every look)."""
    if variance.status == "CLOSED" or not variance.debit_note_id:
        return False
    note = variance_dn(db, variance)
    if note is not None and note.status in DN_CLOSED:
        variance.status = "CLOSED"
        _history(variance, "CLOSED", SYSTEM_ACTOR, debit_note_no=note.debit_note_no, debit_note_status=note.status)
        variance.version += 1
        return True
    return False


# ── Owner decision ─────────────────────────────────────────────────────────────────────────────

def decide(db: Session, variance: PurchaseWeightVariance, *, decision: str, reason_code: Optional[str], reason_note: Optional[str],
           ctx: Context) -> dict[str, Any]:
    decision = str(decision or "").strip().upper()
    if decision not in {"MAKE_DEBIT_NOTE", "SKIP"}:
        raise HTTPException(status_code=422, detail="Choose Make debit note or Skip")
    sync_closed(db, variance)
    who = variance.decided_by or "someone"
    if variance.status == "SKIPPED":
        if decision == "SKIP":
            return {"idempotent": True}
        raise HTTPException(status_code=409, detail=f"Already skipped by {who} ({variance.reason_label or 'reason on the case'}).")
    if variance.status in CLAIM_STATES | {"CLOSED"}:
        if decision == "SKIP":
            word = "made automatically" if variance.decision == "AUTO" else f"sent for a debit note by {who}"
            raise HTTPException(status_code=409, detail=f"The debit note was already {word}.")
        if variance.status != "CLAIM_RAISED":
            return {"idempotent": True}
    elif variance.status != "AWAITING_OWNER":
        raise HTTPException(status_code=409, detail="This bill is not waiting for an Owner decision.")
    receipts = bill_receipts(db, [variance.plant_id], variance.bill_key)
    if decision == "SKIP":
        choice = resolve_reason(category=SKIP_CATEGORY, code=reason_code, note=reason_note, plant_id=variance.plant_id,
                                token=ctx.token, what="skipping the debit note")
        variance.decision = "SKIP"
        variance.decided_by = ctx.actor
        variance.decided_at = datetime.utcnow()
        variance.reason_code, variance.reason_label, variance.note = choice.code, choice.label, choice.note
        variance.status = "SKIPPED"
        _history(variance, "SKIPPED", ctx.actor, reason_code=choice.code, reason=choice.text)
    elif variance.status == "CLAIM_RAISED":
        _history(variance, "RETRY", ctx.actor)
        ensure_claim(db, variance, receipts, ctx)
    else:
        if variance.short_qty <= 0:
            raise HTTPException(status_code=409, detail="The bill is not short any more.")
        _start_claim(db, variance, "MAKE_DEBIT_NOTE", ctx.actor, receipts, ctx)
        variance.decided_by = ctx.actor
    variance.version += 1
    db.flush()
    return {"idempotent": False}


# ── Invoice attached later ─────────────────────────────────────────────────────────────────────

def on_invoice_attached(db: Session, receipt: PurchaseReceipt, ctx: Context) -> None:
    """Called inside POST /receipts/{id}/attach-invoice before it commits. Regroups the bill by invoice
    and lets a waiting weight claim draft its debit note. A failure here never stops the attachment."""
    try:
        with db.begin_nested():
            db.flush()
            key = regroup_receipt(db, receipt, ctx.actor)
            recompute(db, receipt.plant_id, key, ctx)
    except HTTPException as exc:
        log.warning("weight check after invoice attach of %s: %s", receipt.id, exc.detail)
    except Exception:  # pragma: no cover - never block the invoice
        log.exception("weight check after invoice attach of %s failed", receipt.id)


# ── Notifications ──────────────────────────────────────────────────────────────────────────────

def _kg(value: Any) -> str:
    number = Decimal(str(value or 0))
    text_value = f"{number:,.3f}".rstrip("0").rstrip(".")
    return text_value


def _rupees(value: Any) -> str:
    return f"₹{Decimal(str(value or 0)):,.2f}"


def _summary(db: Session, variance: PurchaseWeightVariance, receipts: list[PurchaseReceipt]) -> tuple[str, str]:
    label = bill_label(db, receipts)
    lots = variance.lots_json or []
    weighed = [lot for lot in lots if lot.get("actual_qty") is not None and not lot.get("rejected")]
    people = sorted({lot["weighed_by"] for lot in weighed if lot.get("weighed_by")})
    rates = sorted({row["rate"] for row in variance.lines_json or [] if row.get("rate") and Decimal(row["claim_qty"]) > 0})
    rate_text = f" at ₹{Decimal(rates[0]):,.2f}/kg" if len(rates) == 1 else ""
    pending = any(row.get("invoice_pending") for row in variance.lines_json or [])
    message = (
        f"{len(weighed)} lot{'s' if len(weighed) != 1 else ''} weighed by {', '.join(people) or 'QC'}. "
        f"Bill {_kg(variance.bill_total)} kg, scale {_kg(variance.actual_total)} kg. "
        f"Claim {_rupees(variance.claim_amount)}{rate_text}{' (PO rate; invoice still to come)' if pending else ''}. "
        f"PO raised by {variance.po_raiser or '—'}{f' (PO {variance.po_no})' if variance.po_no else ''}."
    )
    return label, message


def _bill_href(variance: PurchaseWeightVariance) -> str:
    return f"/quality/incoming?bill={variance.bill_key}"


def decide_action(variance: PurchaseWeightVariance) -> dict[str, Any]:
    path = f"/api/purchase/v2/weight-variances/{variance.id}/decide"
    return {"kind": "WEIGHT_VARIANCE", "id": str(variance.id), "buttons": [
        {"key": "make", "label": "Make debit note", "method": "POST", "path": path, "body": {"decision": "MAKE_DEBIT_NOTE"}, "tone": "primary"},
        {"key": "skip", "label": "Skip…", "method": "POST", "path": path, "body": {"decision": "SKIP"},
         "reason_category": SKIP_CATEGORY, "tone": "secondary"},
        {"key": "open", "label": "Open bill", "href": _bill_href(variance), "tone": "link"},
    ]}


def _notify_decide(db: Session, variance: PurchaseWeightVariance, receipts: list[PurchaseReceipt], *, reminder: bool = False) -> None:
    label, message = _summary(db, variance, receipts)
    enqueue_notification(
        db, plant_id=variance.plant_id, event_type="PURCHASE_WEIGHT_SHORT_DECIDE",
        title=f"{'Reminder · ' if reminder else ''}Weight short {_kg(variance.short_qty)} kg · {label} · {variance.supplier_name or 'vendor'}",
        message=message + " Make a debit note, or skip it with a reason.",
        href=f"/purchase/discrepancies?view=weight&variance={variance.id}", recipient_roles=["Owner"], role_context="Owner",
        action=decide_action(variance), priority="action", entity_type="purchase_weight_variance", entity_id=str(variance.id),
        payload={"variance_id": str(variance.id), "bill_key": variance.bill_key, "reminder": reminder},
    )
    if reminder:
        variance.reminder_sent_at = datetime.utcnow()
    else:
        variance.notified_status = "AWAITING_OWNER"
        variance.notified_at = datetime.utcnow()


def _notify_info(db: Session, variance: PurchaseWeightVariance, receipts: list[PurchaseReceipt]) -> None:
    label, _ = _summary(db, variance, receipts)
    short_lines = [lot for lot in variance.lots_json or [] if lot.get("actual_qty") is not None and not lot.get("rejected")
                   and Decimal(lot["bill_qty"]) > Decimal(lot["actual_qty"])]
    detail = "; ".join(f"{lot['code']}: bill {_kg(lot['bill_qty'])} {lot['uom'].lower()}, found {_kg(lot['actual_qty'])}" for lot in short_lines[:6])
    enqueue_notification(
        db, plant_id=variance.plant_id, event_type="PURCHASE_WEIGHT_SHORT_INFO",
        title=f"Short on count · {label} · {variance.supplier_name or 'vendor'}",
        message=f"Items not billed in kg came short ({detail or 'see the bill'}). For information: no debit note is made automatically.",
        href=_bill_href(variance), recipient_roles=["Owner"], role_context="Owner", priority="info",
        action={"kind": "WEIGHT_VARIANCE", "id": str(variance.id), "buttons": [{"key": "open", "label": "Open bill", "href": _bill_href(variance), "tone": "link"}]},
        entity_type="purchase_weight_variance", entity_id=str(variance.id), payload={"variance_id": str(variance.id)},
    )
    variance.notified_status = "INFO_SENT"
    variance.notified_at = datetime.utcnow()


def _notify_auto(db: Session, variance: PurchaseWeightVariance, receipts: list[PurchaseReceipt]) -> None:
    label, message = _summary(db, variance, receipts)
    note = variance_dn(db, variance)
    waiting = variance.status == "WAITING_INVOICE"
    tail = (f" Debit note {note.debit_note_no} drafted for {_rupees(note.total_amount)}; PlantManager or Accounts submits and approves it."
            if note is not None else " The debit note drafts as soon as the invoice is attached to the GRN." if waiting
            else f" The debit note is not drafted yet: {variance.last_error or 'see Purchase › Invoice differences'}.")
    enqueue_notification(
        db, plant_id=variance.plant_id, event_type="PURCHASE_WEIGHT_SHORT_AUTO",
        title=f"Weight short {_kg(variance.short_qty)} kg · {label} · {variance.supplier_name or 'vendor'}",
        message=message + tail, href="/purchase/debit-notes" if note is not None else f"/purchase/discrepancies?view=weight&variance={variance.id}",
        recipient_roles=["Owner", "PlantManager"], role_context="PlantManager", priority="info",
        action={"kind": "WEIGHT_VARIANCE", "id": str(variance.id), "buttons": [
            {"key": "open_dn", "label": "Open debit note" if note is not None else "Open weight differences",
             "href": "/purchase/debit-notes" if note is not None else f"/purchase/discrepancies?view=weight&variance={variance.id}", "tone": "link"},
            {"key": "open", "label": "Open bill", "href": _bill_href(variance), "tone": "link"}]},
        entity_type="purchase_weight_variance", entity_id=str(variance.id), payload={"variance_id": str(variance.id)},
    )


def _notify_follow_up(db: Session, variance: PurchaseWeightVariance, note: PurchaseDebitNote) -> None:
    if not variance.po_raiser:
        return
    receipts = bill_receipts(db, [variance.plant_id], variance.bill_key)
    label = bill_label(db, receipts) if receipts else variance.bill_key
    enqueue_notification(
        db, plant_id=variance.plant_id, event_type="PURCHASE_WEIGHT_SHORT_FOLLOW_UP",
        title=f"Follow up with {variance.supplier_name or 'the vendor'}: {label} weighed {_kg(variance.short_qty)} kg short",
        message=(f"Debit note {note.debit_note_no} ({note.status.lower()}) for {_rupees(note.total_amount)} is on your PO"
                 f"{f' {variance.po_no}' if variance.po_no else ''}. Please take it up with the vendor."),
        href="/purchase/debit-notes", recipient_user_emails=[variance.po_raiser], role_context="PO raiser", priority="action",
        action={"kind": "DEBIT_NOTE", "id": str(note.id), "buttons": [{"key": "open_dn", "label": "Open debit note", "href": "/purchase/debit-notes", "tone": "link"}]},
        entity_type="purchase_debit_note", entity_id=str(note.id), payload={"variance_id": str(variance.id), "debit_note_id": str(note.id)},
    )


def send_due_reminders(db: Session, *, now: Optional[datetime] = None) -> int:
    """Owner decisions open for 48 h get one reminder (the periodic worker calls this)."""
    now = now or datetime.utcnow()
    rows = db.query(PurchaseWeightVariance).filter(
        PurchaseWeightVariance.status == "AWAITING_OWNER", PurchaseWeightVariance.reminder_sent_at.is_(None),
        PurchaseWeightVariance.final_at.isnot(None), PurchaseWeightVariance.final_at <= now - REMINDER_AFTER,
    ).with_for_update(skip_locked=True).limit(100).all()
    for variance in rows:
        receipts = bill_receipts(db, [variance.plant_id], variance.bill_key)
        _notify_decide(db, variance, receipts, reminder=True)
        _history(variance, "REMINDER_SENT", SYSTEM_ACTOR)
    return len(rows)


def reminder_due(variance: PurchaseWeightVariance, now: Optional[datetime] = None) -> bool:
    now = now or datetime.utcnow()
    return variance.status == "AWAITING_OWNER" and variance.final_at is not None and variance.final_at <= now - REMINDER_AFTER


def variance_payload(db: Session, variance: PurchaseWeightVariance) -> dict[str, Any]:
    note = variance_dn(db, variance)
    receipts = bill_receipts(db, [variance.plant_id], variance.bill_key)
    grn_cases = []
    for row in variance.lines_json or []:
        if Decimal(row.get("grn_claimed_qty") or 0) > 0:
            grn_cases.append({"receipt_line_id": row["receipt_line_id"], "item_code": row.get("item_code"), "claimed_qty": float(row["grn_claimed_qty"])})
    return {
        "id": str(variance.id), "plant_id": variance.plant_id, "bill_key": variance.bill_key,
        "bill_label": bill_label(db, receipts) if receipts else variance.bill_key,
        "receipt_ids": variance.receipt_ids or [], "grn_nos": [r.grn_no for r in receipts],
        "challan_nos": [r.supplier_challan_no for r in receipts if r.supplier_challan_no],
        "supplier_id": str(variance.supplier_id) if variance.supplier_id else None, "supplier_name": variance.supplier_name,
        "purchase_order_id": str(variance.purchase_order_id) if variance.purchase_order_id else None, "po_no": variance.po_no,
        "po_raiser": variance.po_raiser, "uom": variance.uom,
        "bill_total": float(variance.bill_total), "actual_total": float(variance.actual_total),
        "lots_total": variance.lots_total, "lots_weighed": variance.lots_weighed, "lots_excluded": variance.lots_excluded,
        "short_qty": float(variance.short_qty), "excess_qty": float(variance.excess_qty),
        "rate_basis": variance.rate_basis, "claim_amount": float(variance.claim_amount), "band": variance.band,
        "status": variance.status, "is_final": bool(variance.is_final),
        "notify_kg": float(variance.notify_kg), "auto_kg": float(variance.auto_kg),
        "decision": variance.decision, "decided_by": variance.decided_by,
        "decided_at": variance.decided_at.isoformat() if variance.decided_at else None,
        "reason_code": variance.reason_code, "reason_label": variance.reason_label, "note": variance.note,
        "discrepancy_ids": variance.discrepancy_ids or [], "debit_note_id": str(variance.debit_note_id) if variance.debit_note_id else None,
        "debit_note_no": note.debit_note_no if note is not None else None, "debit_note_status": note.status if note is not None else None,
        "lines": variance.lines_json or [], "lots": variance.lots_json or [], "grn_quantity_cases": grn_cases,
        "final_at": variance.final_at.isoformat() if variance.final_at else None,
        "reminder_due": reminder_due(variance), "reminder_sent_at": variance.reminder_sent_at.isoformat() if variance.reminder_sent_at else None,
        "last_error": variance.last_error, "history": variance.history or [], "version": variance.version,
        "created_at": variance.created_at.isoformat() if variance.created_at else None,
        "updated_at": variance.updated_at.isoformat() if variance.updated_at else None,
        "weights_frozen": weights_frozen(db, variance),
    }
