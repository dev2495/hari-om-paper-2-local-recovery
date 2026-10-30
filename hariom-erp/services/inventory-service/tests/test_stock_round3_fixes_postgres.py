"""Checker round 3 (2026-10-28) on stock: the stock book, scan-move undo, count value, after-count changes,
supplier returns of bulk lots and the goods-inward location rule (live PostgreSQL)."""
import os
import uuid
from datetime import date, datetime

import pytest
from fastapi import HTTPException

if "procurement_test" not in os.environ.get("DATABASE_URL", ""):
    pytest.skip("Requires isolated procurement_test PostgreSQL database", allow_module_level=True)

from src.main import ensure_runtime_schema, ensure_stock_count_and_schedule_schema
from src.database import Base, SessionLocal, engine
from src.models import InventoryQualityInspection, PaperReel, ReelIssue, ReelIssueStatus, ReelStatus, StockBatch, StockTransaction
from src.routers.procurement import GovernedReceiptCreate, GovernedReceiptLineInput, _validate_receipt
from src.routers.quality import SupplierReturnCreate, _post_batch_partition_ledger, return_rejected_lot_to_supplier
from src.routers.stock_control import month_figures
from src.routers.stock_count import (
    CountCreate, NotePayload, ScanPayload, approve_count, finish_rack, get_count, scan_in_count, start_count, submit_count,
)
from src.routers.stock_moves import ScanMovePayload, ScanMoveUndoPayload, scan_move, undo_scan_move
from src.services.books import ist_today
from src.services.stock_control import book_period

from test_stock_count_flow_postgres import OWNER, STORE, _floor_issue, _item, _lot, _rack, _reel, _refused, _row


def setup_module() -> None:
    Base.metadata.create_all(engine)
    ensure_runtime_schema()
    ensure_stock_count_and_schedule_schema()


def _month(day: date) -> tuple[date, date]:
    start = day.replace(day=1)
    return start, day


def test_a_concession_split_is_not_received_twice():
    """Part of a lot / reel released on concession moves to a child lot: the item total does not change."""
    plant = str(uuid.uuid4())
    today = ist_today()
    with SessionLocal() as db:
        glue = _item(db, plant, "ADHESIVE", tracking="BULK")
        paper = _item(db, plant)
        rack = _rack(db, plant, "RM-S-01")
        parent = _lot(db, plant, glue, 100, at=rack, status="QC_HOLD", day=today)
        child = StockBatch(item_id=glue.id, batch_no=f"{parent.batch_no}-C1", received_qty=40, plant_id=plant,
                           stock_status="UNRESTRICTED", location_id=rack.id, unit_cost=90.0)
        db.add(child)
        db.flush()
        _post_batch_partition_ledger(db, parent=parent, child=child, qty=40, child_status="UNRESTRICTED", plant_id=plant, inspection_id=uuid.uuid4())
        reel = _reel(db, plant, paper, 500, at=rack, status="QC_HOLD", inward=today)
        released = PaperReel(plant_id=uuid.UUID(plant), reel_code=f"{reel.reel_code}-C1", paper_id=paper.id, inward_weight_kg=200,
                             current_weight_kg=200, status=ReelStatus.IN_STOCK, stock_status="UNRESTRICTED", location_id=rack.id,
                             parent_reel_id=reel.id, genealogy_metadata={"concession_partition": True, "parent_reel_id": str(reel.id)},
                             inward_date=reel.inward_date, unit_cost=40.0)
        db.add(released)
        reel.current_weight_kg = 300
        db.flush()
        # The released part goes to the floor: no lot of either item may look below zero.
        db.add(StockTransaction(item_id=glue.id, batch_id=child.id, transaction_type="ISSUE_PRODUCTION", qty_change=-40, reference_type="INTERNAL",
                                reference_id=child.id, plant_id=plant, stock_status="UNRESTRICTED", effective_date=today))
        _floor_issue(db, plant, released, today, section="WINDER_SECTION")
        db.commit()

        result = book_period(db, plant, *_month(today))
        glue_row, paper_row = _row(result, glue), _row(result, paper)
        assert (glue_row["received"], glue_row["issued"], glue_row["closing"]) == (100, 40, 60), glue_row
        assert glue_row["identity_ok"], glue_row.get("book_problem")
        assert (paper_row["received"], paper_row["issued"], paper_row["closing"]) == (500, 200, 300), paper_row
        assert paper_row["identity_ok"], paper_row.get("book_problem")


def test_undoing_a_scan_move_never_moves_an_issued_reel():
    plant = str(uuid.uuid4())
    with SessionLocal() as db:
        paper = _item(db, plant)
        first, second = _rack(db, plant, "RM-U-01"), _rack(db, plant, "RM-U-02")
        reel = _reel(db, plant, paper, 240, at=first)
        db.commit()
        scan_move(ScanMovePayload(to_location_id=second.id, code=reel.reel_code, client_ref="undo-0001"), db, plant, STORE)
        _floor_issue(db, plant, reel, ist_today(), section="WINDER_SECTION")
        db.commit()
        _refused(lambda: undo_scan_move(ScanMoveUndoPayload(client_ref="undo-0001"), db, plant, STORE), 409, "Nothing comes back from the floor")
        db.expire_all()
        assert db.get(PaperReel, reel.id).location_id == second.id  # still where it was used up


def test_count_lines_with_no_rate_say_value_not_known():
    plant = str(uuid.uuid4())
    with SessionLocal() as db:
        paper = _item(db, plant, cost=0.0)
        rack = _rack(db, plant, "RM-V-01")
        priced = _reel(db, plant, paper, 100, at=rack)
        unpriced = _reel(db, plant, paper, 320.25, at=rack)
        unpriced.unit_cost = 0.0  # a GRN whose invoice is still pending
        db.commit()
        count = start_count(CountCreate(kind="SPOT", location_ids=[rack.id]), db, plant, STORE)
        cid = uuid.UUID(count["id"])
        scan_in_count(ScanPayload(rack=str(rack.id), code=priced.reel_code, counted_qty=90, client_ref="val-1"), cid, db, plant, STORE)
        finish_rack(cid, str(rack.id), db, plant, STORE)
        detail = get_count(cid, db, plant, OWNER)
        summary = detail["summary"]
        missing = next(entry for entry in detail["entries"] if entry["status"] == "MISSING")
        assert missing["value"] is None and missing["value_known"] is False
        assert summary["loss_value"] == -400.0  # only the priced 10 kg at 40
        assert summary["unpriced_lines"] == 1
        assert summary["unpriced_by_unit"] == [{"uom": "KG", "lines": 1, "gain": 0.0, "loss": -320.25}]


def test_back_dated_stock_after_an_approved_month_end_count_is_flagged():
    plant = str(uuid.uuid4())
    with SessionLocal() as db:
        paper = _item(db, plant)
        glue = _item(db, plant, "ADHESIVE", tracking="BULK")
        rack = _rack(db, plant, "RM-B-01")
        reel = _reel(db, plant, paper, 600, at=rack, inward=date(2026, 8, 5))
        db.commit()
        count = start_count(CountCreate(kind="MONTH_END", month="2026-08"), db, plant, STORE)
        cid = uuid.UUID(count["id"])
        scan_in_count(ScanPayload(rack=str(rack.id), code=reel.reel_code, counted_qty=590, client_ref="bd-1"), cid, db, plant, STORE)
        finish_rack(cid, str(rack.id), db, plant, STORE)
        finish_rack(cid, "unassigned", db, plant, STORE)
        submit_count(NotePayload(), cid, db, plant, STORE)
        assert approve_count(NotePayload(), cid, db, plant, OWNER)["status"] == "CERTIFIED"
        # The count's own posting is not a change after the count.
        august = month_figures("2026-08", db, plant, OWNER)
        assert august["month_end_count"]["changed_after_count"] is False and _row(august, paper)["changed_after_count"] is None

        # A GRN entered later but dated 25 Aug: August's closing now holds stock the count never saw.
        _lot(db, plant, glue, 10, at=rack, day=date(2026, 8, 25))
        db.commit()
        august = month_figures("2026-08", db, plant, OWNER)
        changed = august["month_end_count"]["changed_items"]
        assert august["month_end_count"]["changed_after_count"] is True and august["month_end_count"]["status"] == "CERTIFIED"
        assert [(row["item_code"], row["qty"]) for row in changed] == [(glue.item_code, 10.0)]
        assert _row(august, glue)["changed_after_count"] == 10.0 and _row(august, paper)["changed_after_count"] is None
        assert get_count(cid, db, plant, OWNER)["changed_after_count"][0]["item_id"] == str(glue.id)


def test_a_rejected_bulk_lot_goes_back_to_the_supplier():
    plant = str(uuid.uuid4())
    with SessionLocal() as db:
        glue = _item(db, plant, "ADHESIVE", tracking="BULK")
        rack = _rack(db, plant, "RM-R-01")
        lot = _lot(db, plant, glue, 40, at=rack, status="QC_HOLD", day=ist_today())
        db.add(InventoryQualityInspection(plant_id=plant, entity_type="BATCH", entity_id=lot.id, material_type="ADHESIVE",
                                          status="FAIL", disposition="REJECT"))
        db.commit()
        result = return_rejected_lot_to_supplier(SupplierReturnCreate(entity_type="BATCH", entity_id=lot.id, reason="Wrong viscosity, sent back"), db, plant, OWNER)
        assert result["entity_id"] == str(lot.id)
        db.expire_all()
        assert db.get(StockBatch, lot.id).stock_status == "RETURNED"
        row = _row(book_period(db, plant, *_month(ist_today())), glue)
        assert (row["received"], row["sent_back"], row["closing"]) == (40, 40, 0) and row["identity_ok"]


def test_goods_inward_never_lands_on_the_floor_or_a_dispatch_bay():
    plant = str(uuid.uuid4())
    with SessionLocal() as db:
        floor = _rack(db, plant, "WIP-G-01", purpose="WIP")
        bay = _rack(db, plant, "DSP-G-01", purpose="DISPATCH")
        store = _rack(db, plant, "RM-G-01")
        db.commit()

        def receipt(location):
            return GovernedReceiptCreate(request_id=uuid.uuid4(), purchase_order_id=uuid.uuid4(), received_date=ist_today(), supplier_challan_no="CH-1",
                                         invoice_pending=True, lines=[GovernedReceiptLineInput(po_line_id=uuid.uuid4(), quantity=1, location_id=location.id)])

        _refused(lambda: _validate_receipt(receipt(floor), db, plant), 422, "production floor")
        _refused(lambda: _validate_receipt(receipt(bay), db, plant), 422, "dispatch bay")
        _validate_receipt(receipt(store), db, plant)
