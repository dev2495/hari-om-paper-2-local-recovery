"""Incoming QC is the only gate between inward stock and the floor.

Client decision 2026-10-27: a reel or batch that passes incoming QC can be issued even when its
invoice is still pending or differs from the PO. Invoice pending, rate / quantity differences and
manual-inward approval stay with Accounts (claims, debit notes) and never hold physical stock.
"""
from ..quality_pin import pin_quality_profile_metadata
from ..quality_eval import exemption_scope_applies
from ..models import (InventoryQualityHold, InventoryQualityInspection, PaperReel,
    StockBatch, StockTransaction, TransactionType, ReceiptStockAllocation)

CLEAR_COMMERCIAL = frozenset({"CLEAR", "RELEASED_WITH_CLAIM"})
QUALITY_BLOCK_DISPOSITIONS = frozenset({"REJECT", "BLOCK"})


def initial_quality(item, plant_id, received_date, metadata=None):
    metadata = pin_quality_profile_metadata(metadata, getattr(item, "quality_profile", None))
    exempt = exemption_scope_applies(metadata["quality_profile"], plant_id=plant_id,
        as_of=received_date, item_id=item.id)
    status = "NOT_REQUIRED" if exempt else "PENDING"
    metadata["incoming_qc_task"] = {"status": status}
    return metadata, status


def inward_stock_status(qc_status):
    """Stock status of a lot at inward: held for incoming QC unless the item is exempt."""
    return "QC_HOLD" if qc_status == "PENDING" else "UNRESTRICTED"


def refresh_receipt_stock(db, line):
    """Re-derive each lot's stock status from its own QC verdict and holds.

    Evaluate each physical lot independently; one passing reel does not release
    every reel received on the same inward line. The commercial status is copied
    onto the lot for Accounts but does not decide whether it can be issued.
    """
    allocations = db.query(ReceiptStockAllocation).filter_by(receipt_line_id=line.id).all()
    outcomes = []
    rejected = False
    for allocation in allocations:
        entity_type = "REEL" if allocation.reel_id else "BATCH"
        model = PaperReel if allocation.reel_id else StockBatch
        entity_id = allocation.reel_id or allocation.batch_id
        entity = db.query(model).filter_by(id=entity_id).with_for_update().first()
        if entity is None:
            continue
        holds = db.query(InventoryQualityHold).filter_by(entity_type=entity_type,
            entity_id=entity_id, status="HOLD").all()
        inspection = db.query(InventoryQualityInspection).filter_by(entity_type=entity_type,
            entity_id=entity_id).order_by(InventoryQualityInspection.created_at.desc(), InventoryQualityInspection.id.desc()).first()
        pinned = (entity.inward_metadata or {}).get("quality_profile")
        exempt = exemption_scope_applies(pinned, plant_id=line.receipt.plant_id,
            as_of=line.receipt.received_date, item_id=line.item_id)
        verdict = inspection.status if inspection else ("NOT_REQUIRED" if exempt else "PENDING")
        outcomes.append(verdict)
        if entity.stock_status == "RETURNED" or (inspection is not None and inspection.disposition in {"REJECT", "BLOCK", "SCRAP"}):
            rejected = True
        acceptable = verdict in {"PASS", "NOT_REQUIRED"} and (not inspection or inspection.disposition in {None, "ACCEPT"})
        # Never erase a physical staging/scrap state or scoped concession partition.
        if entity.stock_status not in {"UNRESTRICTED", "QC_HOLD", "BLOCKED"}:
            continue
        # A concession already released this lot despite its FAIL; refreshing must not re-hold it.
        if inspection is not None and getattr(inspection, "concession_approved_at", None) and entity.stock_status == "UNRESTRICTED":
            continue
        disposition = str(getattr(inspection, "disposition", "") or "").upper()
        # QC rejected it, or a FAIL was accepted without the concession it needs: stays blocked.
        quality_block = inspection is not None and (
            disposition in QUALITY_BLOCK_DISPOSITIONS
            or (str(inspection.status or "").upper() == "FAIL" and disposition == "ACCEPT" and entity.stock_status == "BLOCKED")
        )
        status = "BLOCKED" if quality_block else ("QC_HOLD" if holds or not acceptable else "UNRESTRICTED")
        entity.stock_status = status
        if hasattr(entity, "commercial_status"):
            entity.commercial_status = line.commercial_status
        if allocation.batch_id:
            for txn in db.query(StockTransaction).filter_by(batch_id=entity_id,
                    transaction_type=TransactionType.INWARD).all():
                if txn.stock_status in {"UNRESTRICTED", "QC_HOLD", "BLOCKED"}:
                    txn.stock_status = status
    if outcomes:
        line.qc_status = (
            "REJECTED"
            if rejected
            else "PASS" if all(v in {"PASS", "NOT_REQUIRED"} for v in outcomes) else "PENDING"
        )


def release_blocked_receipt_lines(db):
    """Re-derive every inward line that still has a BLOCKED reel or batch; returns the line count."""
    from ..models import PurchaseReceiptLine

    line_ids = {
        row[0]
        for row in db.query(ReceiptStockAllocation.receipt_line_id)
        .outerjoin(PaperReel, PaperReel.id == ReceiptStockAllocation.reel_id)
        .outerjoin(StockBatch, StockBatch.id == ReceiptStockAllocation.batch_id)
        .filter((PaperReel.stock_status == "BLOCKED") | (StockBatch.stock_status == "BLOCKED"))
        .distinct()
        .all()
    }
    if not line_ids:
        return 0
    for line in db.query(PurchaseReceiptLine).filter(PurchaseReceiptLine.id.in_(line_ids)).all():
        refresh_receipt_stock(db, line)
    db.flush()
    return len(line_ids)
