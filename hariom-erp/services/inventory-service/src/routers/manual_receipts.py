"""Manual procurement receipts are real documents, never fabricated purchase orders."""
from datetime import datetime
from decimal import Decimal
import uuid

from fastapi import Depends, HTTPException
from pydantic import Field, field_validator
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .procurement import (
    router, GovernedReceiptCreate, GovernedReceiptLineInput, _validate_receipt,
    _enum, _plant_uuid, _receipt_payload, _refresh_receipt_line_stock,
)
from .purchase import _actor, _next_doc_no
from ..database import get_db
from ..models import (
    ItemMaster, PurchaseReceipt, PurchaseReceiptLine, PaperReel, StockBatch,
    StockTransaction, ReceiptStockAllocation, SupplierInvoice, SupplierInvoiceLine,
    ReceiptInvoiceAllocation, PurchaseDiscrepancy, LotLabelRecord, ReelScanEvent, ReelScanEventType,
    ReelScanSource, ReelStatus, CostSource, TransactionType, ReferenceType,
)
from ..quality_task_queue import enqueue_incoming_qc_task
from ..services.labels import reel_label_payload
from ..services.receipt_quality import initial_quality
from ..services.procurement import canonical_hash, normalize_invoice_number
from ..utils.auth import get_current_plant, require_role


class ManualReceiptLine(GovernedReceiptLineInput):
    po_line_id: None = None
    item_id: uuid.UUID
    incoming_qc_required: bool = True


class ManualReceiptCreate(GovernedReceiptCreate):
    purchase_order_id: None = None
    supplier_id: uuid.UUID
    supplier_name: str = Field(min_length=1, max_length=200)
    reason: str = Field(min_length=3, max_length=1000)
    lines: list[ManualReceiptLine] = Field(min_length=1, max_length=100)

    @field_validator("reason", "supplier_name")
    @classmethod
    def clean_required_text(cls, value):
        value = value.strip()
        if not value:
            raise ValueError("A non-blank value is required")
        return value


def _manual_checks(payload, db, plant_id):
    _validate_receipt(payload, db, plant_id)
    rows = []
    seen = set()
    for index, requested in enumerate(payload.lines, 1):
        item = db.query(ItemMaster).filter(ItemMaster.id == requested.item_id, ItemMaster.plant_id == plant_id).first()
        if not item or item.active != "true" or _enum(item.type) == "FINISHED_GOOD":
            raise HTTPException(422, f"Line {index}: select a raw or packing material in this plant")
        is_reel = _enum(item.tracking_mode) == "REEL"
        qty = sum((Decimal(str(lot.net_weight_kg)) for lot in requested.lots), Decimal(0)) if is_reel else Decimal(str(requested.quantity or 0))
        if qty <= 0 or (is_reel != bool(requested.lots)):
            raise HTTPException(422, f"Line {index}: physical lots must match material tracking mode")
        if not payload.invoice_pending and requested.invoice_rate is None:
            raise HTTPException(422, f"Line {index}: enter the invoice rate")
        for lot in requested.lots:
            source = lot.source_reel_no.strip().upper()
            if not source or source in seen:
                raise HTTPException(422, f"Duplicate or blank vendor reel number: {source}")
            seen.add(source)
            if not lot.physical_form:
                raise HTTPException(422, f"Select reel or coil for vendor lot {source}")
            if lot.gross_weight_kg is not None and lot.tare_weight_kg is not None and abs(Decimal(str(lot.gross_weight_kg)) - Decimal(str(lot.tare_weight_kg)) - Decimal(str(lot.net_weight_kg))) > Decimal("0.001"):
                raise HTTPException(422, f"Gross minus tare must equal net kg for {source}")
            if db.query(PaperReel.id).filter(PaperReel.plant_id == _plant_uuid(plant_id), PaperReel.supplier_id == payload.supplier_id, PaperReel.source_reel_no == source).first():
                raise HTTPException(409, f"Vendor reel {source} is already inwarded")
        rows.append((requested, item, qty, is_reel))
    return rows


@router.post("/manual-receipts/preview")
def preview_manual_receipt(payload: ManualReceiptCreate, db: Session = Depends(get_db), plant_id: str = Depends(get_current_plant), current_user: dict = Depends(require_role(["Store", "PlantManager"]))):
    rows = _manual_checks(payload, db, plant_id)
    return {"receipt_kind": "MANUAL", "commercial_status": "INVOICE_PENDING" if payload.invoice_pending else "MANUAL_REVIEW",
            "lines": [{"item_code": item.item_code, "uom": _enum(item.uom), "quantity_kg": float(qty), "physical_unit_count": len(requested.lots), "invoice_rate": requested.invoice_rate} for requested, item, qty, _ in rows],
            "totals": {"quantity_kg": float(sum(row[2] for row in rows)), "physical_unit_count": sum(len(row[0].lots) for row in rows)}}


def _queue_qc_task(db: Session, lot, *, plant_id: str, receipt: PurchaseReceipt, **lot_ref) -> None:
    """Durable incoming-QC task per held lot, committed with the manual receipt."""
    event_id = enqueue_incoming_qc_task(db, plant_id=plant_id, receipt_id=str(receipt.id),
        grn_no=receipt.grn_no, stock_status=lot.stock_status, **lot_ref)
    lot.inward_metadata = {**lot.inward_metadata,
        "incoming_qc_task": {**lot.inward_metadata["incoming_qc_task"], "outbox_event_id": event_id}}


@router.post("/manual-receipts")
def post_manual_receipt(payload: ManualReceiptCreate, db: Session = Depends(get_db), plant_id: str = Depends(get_current_plant), current_user: dict = Depends(require_role(["Store", "PlantManager"]))):
    fingerprint = canonical_hash(payload.model_dump(mode="json", exclude={"request_id"}))
    existing = db.query(PurchaseReceipt).filter_by(plant_id=plant_id, request_id=payload.request_id).first()
    if existing:
        if existing.request_fingerprint != fingerprint:
            raise HTTPException(409, "This request key has already been used with different receipt details")
        return {**_receipt_payload(existing, db), "idempotent": True}
    rows = _manual_checks(payload, db, plant_id)
    invoice = None
    if not payload.invoice_pending:
        normalized = normalize_invoice_number(payload.invoice_no)
        invoice = db.query(SupplierInvoice).filter_by(plant_id=plant_id, supplier_id=payload.supplier_id, normalized_invoice_no=normalized).first()
        if invoice and (invoice.invoice_date != payload.invoice_date or invoice.currency != payload.currency):
            raise HTTPException(409, "Existing invoice has a different date or currency")
        if not invoice:
            invoice = SupplierInvoice(plant_id=plant_id, supplier_id=payload.supplier_id, invoice_no=payload.invoice_no, normalized_invoice_no=normalized, invoice_date=payload.invoice_date, currency=payload.currency, created_by=_actor(current_user))
            db.add(invoice)
            db.flush()
    state = "INVOICE_PENDING" if payload.invoice_pending else "MANUAL_REVIEW"
    receipt = PurchaseReceipt(plant_id=plant_id, receipt_kind="MANUAL", supplier_id=payload.supplier_id,
        supplier_name_snapshot=payload.supplier_name.strip(), manual_reason=payload.reason.strip(), request_id=payload.request_id,
        request_fingerprint=fingerprint, supplier_invoice_id=invoice.id if invoice else None, invoice_pending=payload.invoice_pending,
        commercial_status=state, grn_no=_next_doc_no(db, PurchaseReceipt, plant_id, "grn_no", "MGRN"), received_date=payload.received_date,
        status="QC_PENDING", created_by=_actor(current_user),
        approval_history=[{"action": "MANUAL_RECEIPT_CREATED", "actor": _actor(current_user), "at": datetime.utcnow().isoformat(), "reason": payload.reason}])
    db.add(receipt)
    db.flush()
    for index, (requested, item, qty, is_reel) in enumerate(rows, 1):
        metadata, qc_status = initial_quality(item, plant_id, payload.received_date)
        rate = requested.invoice_rate or 0
        line = PurchaseReceiptLine(receipt_id=receipt.id, item_id=item.id, qty_received=float(qty), unit_cost=rate,
            invoice_rate=requested.invoice_rate, tracking_mode="REEL" if is_reel else "BULK", commercial_status=state,
            qc_status=qc_status)
        db.add(line)
        db.flush()
        metadata = {**metadata, "receipt_id": str(receipt.id), "grn_no": receipt.grn_no, "receipt_kind": "MANUAL", "manual_reason": payload.reason, "invoice_no": payload.invoice_no, "invoice_rate": requested.invoice_rate}
        if is_reel:
            for lot in requested.lots:
                at_no = _next_doc_no(db, PaperReel, _plant_uuid(plant_id), "reel_code", "AT")
                reel = PaperReel(plant_id=_plant_uuid(plant_id), reel_code=at_no, purchase_receipt_line_id=line.id,
                    paper_id=item.id, supplier_id=payload.supplier_id, supplier_name=payload.supplier_name,
                    supplier_name_snapshot=payload.supplier_name, source_reel_no=lot.source_reel_no.strip().upper(),
                    vendor_batch_no=lot.vendor_batch_no, inward_weight_kg=lot.net_weight_kg, net_weight_kg=lot.net_weight_kg,
                    current_weight_kg=lot.net_weight_kg, gross_weight_kg=lot.gross_weight_kg, tare_weight_kg=lot.tare_weight_kg,
                    width_mm=lot.width_mm, physical_form=lot.physical_form, location_id=lot.location_id,
                    unit_cost=rate, cost_source=CostSource.SUPPLIER, status=ReelStatus.IN_STOCK, stock_status="BLOCKED",
                    commercial_status=state, inward_date=payload.received_date, inward_metadata=metadata)
                db.add(reel)
                db.flush()
                if qc_status == "PENDING":
                    _queue_qc_task(db, reel, plant_id=plant_id, receipt=receipt, reel_id=str(reel.id))
                db.add(ReceiptStockAllocation(receipt_line_id=line.id, reel_id=reel.id, allocated_qty=lot.net_weight_kg))
                db.add(LotLabelRecord(plant_id=plant_id, reel_id=reel.id, label_code=at_no, content_snapshot=reel_label_payload(reel, item)))
                db.add(ReelScanEvent(plant_id=_plant_uuid(plant_id), reel_id=reel.id, event_type=ReelScanEventType.INWARD_SCAN, source=ReelScanSource.INVENTORY, event_metadata=metadata))
        else:
            batch = StockBatch(plant_id=plant_id, item_id=item.id, batch_no=(requested.batch_no or f"{receipt.grn_no}-{index}").strip().upper(),
                received_qty=float(qty), stock_status="BLOCKED", unit_cost=rate, cost_source="SUPPLIER", supplier_id=payload.supplier_id,
                supplier_name_snapshot=payload.supplier_name, location_id=requested.location_id, inward_metadata=metadata)
            db.add(batch)
            db.flush()
            line.batch_id = batch.id
            if qc_status == "PENDING":
                _queue_qc_task(db, batch, plant_id=plant_id, receipt=receipt, batch_id=str(batch.id))
            db.add(ReceiptStockAllocation(receipt_line_id=line.id, batch_id=batch.id, allocated_qty=qty))
            db.add(StockTransaction(plant_id=plant_id, item_id=item.id, batch_id=batch.id, transaction_type=TransactionType.INWARD,
                qty_change=float(qty), reference_type=ReferenceType.PURCHASE, reference_id=receipt.id, effective_date=payload.received_date,
                stock_status="BLOCKED", external_ref=f"MGRN:{receipt.id}:{index}", movement_metadata=metadata))
        if invoice:
            invoice_qty = Decimal(str(requested.invoice_quantity)) if requested.invoice_quantity is not None else qty
            invoice_line = SupplierInvoiceLine(invoice_id=invoice.id, item_id=item.id, qty=invoice_qty, rate=rate, uom=_enum(item.uom), tax_amount=requested.tax_amount, charge_amount=requested.charge_amount)
            db.add(invoice_line)
            db.flush()
            allocation = ReceiptInvoiceAllocation(receipt_line_id=line.id, invoice_line_id=invoice_line.id, allocated_qty=qty,
                po_rate=rate, invoice_rate=rate, rate_delta=0, claimable_amount=0)
            db.add(allocation); db.flush()
            if invoice_qty != qty:
                db.add(PurchaseDiscrepancy(plant_id=plant_id, allocation_id=allocation.id, discrepancy_type="QUANTITY",
                    quantity=qty, po_rate=rate, invoice_rate=rate, delta=invoice_qty - qty,
                    claimable_amount=max(Decimal(0), (invoice_qty - qty) * Decimal(str(rate))), status="OPEN"))
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(409, "Receipt, invoice, vendor lot or batch reference already exists") from exc
    result = _receipt_payload(receipt, db)
    return {**result, "created_lots": result["lots"]}


from .procurement import VersionAction


@router.post("/receipts/{receipt_id}/approve-manual")
def approve_manual_receipt(receipt_id: uuid.UUID, payload: VersionAction, db: Session = Depends(get_db), plant_id: str = Depends(get_current_plant), current_user: dict = Depends(require_role(["PlantManager", "Accounts"]))):
    receipt = db.query(PurchaseReceipt).filter_by(id=receipt_id, plant_id=plant_id).with_for_update().first()
    if not receipt or receipt.receipt_kind != "MANUAL":
        raise HTTPException(404, "Manual receipt not found")
    if receipt.created_by == _actor(current_user):
        raise HTTPException(409, "The receipt maker cannot approve their own manual receipt")
    if receipt.posting_version != payload.expected_version or receipt.commercial_status != "MANUAL_REVIEW":
        raise HTTPException(409, "Refresh this receipt; only a pending manual review can be approved")
    if receipt.invoice_pending:
        raise HTTPException(409, "Attach the invoice before approving manual receipt rates")
    cases = db.query(PurchaseDiscrepancy).join(ReceiptInvoiceAllocation, ReceiptInvoiceAllocation.id == PurchaseDiscrepancy.allocation_id).join(PurchaseReceiptLine, PurchaseReceiptLine.id == ReceiptInvoiceAllocation.receipt_line_id).filter(PurchaseReceiptLine.receipt_id == receipt.id).all()
    if any(case.status not in {"ACCEPTED", "RESOLVED", "CLAIMED"} for case in cases):
        raise HTTPException(409, "Resolve invoice quantity differences or issue the approved claim before manual approval")
    receipt.approval_history = [*(receipt.approval_history or []), {"action": "MANUAL_RECEIPT_APPROVED", "actor": _actor(current_user), "at": datetime.utcnow().isoformat(), "reason": payload.reason}]
    receipt.commercial_status = "RELEASED_WITH_CLAIM" if any(case.status == "CLAIMED" for case in cases) else "CLEAR"
    receipt.posting_version += 1
    for line in receipt.lines:
        line.commercial_status = receipt.commercial_status
        _refresh_receipt_line_stock(db, line)
    db.commit()
    return _receipt_payload(receipt, db)
