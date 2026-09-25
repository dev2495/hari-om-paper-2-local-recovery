"""Incoming quality and commercial controls are independent release gates."""
from ..quality_pin import pin_quality_profile_metadata
from ..quality_eval import exemption_scope_applies
from ..models import (InventoryQualityHold, InventoryQualityInspection, PaperReel,
    StockBatch, StockTransaction, TransactionType, ReceiptStockAllocation)

CLEAR_COMMERCIAL = frozenset({"CLEAR", "RELEASED_WITH_CLAIM"})


def initial_quality(item, plant_id, received_date, metadata=None):
    metadata = pin_quality_profile_metadata(metadata, getattr(item, "quality_profile", None))
    exempt = exemption_scope_applies(metadata["quality_profile"], plant_id=plant_id,
        as_of=received_date, item_id=item.id)
    status = "NOT_REQUIRED" if exempt else "PENDING"
    metadata["incoming_qc_task"] = {"status": status}
    return metadata, status


def refresh_receipt_stock(db, line):
    """Commercial approval cannot change inspections, concessions or other holds.

    Evaluate each physical lot independently; one passing reel does not release
    every reel received on the same commercial line.
    """
    allocations = db.query(ReceiptStockAllocation).filter_by(receipt_line_id=line.id).all()
    outcomes = []
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
        acceptable = verdict in {"PASS", "NOT_REQUIRED"} and (not inspection or inspection.disposition in {None, "ACCEPT"})
        # Never erase a physical staging/scrap state or scoped concession partition.
        if entity.stock_status not in {"UNRESTRICTED", "QC_HOLD", "BLOCKED"}:
            continue
        status = "BLOCKED" if line.commercial_status not in CLEAR_COMMERCIAL else (
            "QC_HOLD" if holds or not acceptable else "UNRESTRICTED")
        entity.stock_status = status
        if hasattr(entity, "commercial_status"):
            entity.commercial_status = line.commercial_status
        if allocation.batch_id:
            for txn in db.query(StockTransaction).filter_by(batch_id=entity_id,
                    transaction_type=TransactionType.INWARD).all():
                if txn.stock_status in {"UNRESTRICTED", "QC_HOLD", "BLOCKED"}:
                    txn.stock_status = status
    if outcomes:
        line.qc_status = "PASS" if all(v in {"PASS", "NOT_REQUIRED"} for v in outcomes) else "PENDING"
