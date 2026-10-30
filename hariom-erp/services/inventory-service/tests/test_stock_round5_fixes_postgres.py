"""Checker round 5 (2026-10-30) on stock: a month-end count approved after a later month closed, unknown ids
on a correction voucher, the raiser of a waiting correction as its own field, the "in since" day of a lot a
back-dated count creates, a correction whose reel was issued since, and a rack's last count while it still
waits for the Owner (live PostgreSQL)."""
import os
import uuid
from datetime import date

import pytest

if "procurement_test" not in os.environ.get("DATABASE_URL", ""):
    pytest.skip("Requires isolated procurement_test PostgreSQL database", allow_module_level=True)

from src.main import ensure_runtime_schema, ensure_stock_count_and_schedule_schema
from src.database import Base, SessionLocal, engine
from src.models import PaperReel, StockAdjustmentVoucher, StockBatch
from src.routers import stock_count
from src.routers.books import BooksLockPayload, lock_books_month
from src.routers.locations import get_location, locations_overview
from src.routers.stock_control import (
    AdjustmentLinePayload, AdjustmentVoucherPayload, CorrectionDecisionPayload, CorrectionPayload, approve_correction,
    create_adjustment_voucher, list_corrections, raise_correction,
)
from src.routers.stock_count import (
    CountCreate, LoosePayload, NotePayload, ScanPayload, add_loose_stock, approve_count, finish_rack, get_count, scan_in_count, start_count, submit_count,
)
from src.services.locations import default_receiving_location
from src.services.stock_lots import lot_row

from test_stock_count_flow_postgres import OWNER, STORE, _item, _lot, _rack, _reel, _refused

GRN = {"sub": "grn.desk@example.com", "roles": ["GRN"], "actual_roles": ["GRN"], "role": "GRN", "token": ""}


def setup_module() -> None:
    Base.metadata.create_all(engine)
    ensure_runtime_schema()
    ensure_stock_count_and_schedule_schema()


def _month_end_count(db, plant, rack, code, counted):
    count = start_count(CountCreate(kind="MONTH_END", month="2026-08"), db, plant, STORE)
    cid = uuid.UUID(count["id"])
    scan_in_count(ScanPayload(rack=str(rack.id), code=code, counted_qty=counted, client_ref=f"r5-{uuid.uuid4().hex[:6]}"), cid, db, plant, STORE)
    finish_rack(cid, str(rack.id), db, plant, STORE)
    finish_rack(cid, "unassigned", db, plant, STORE)
    submit_count(NotePayload(), cid, db, plant, STORE)
    return cid


def test_a_month_end_count_is_not_approved_once_a_later_month_is_closed(monkeypatch):
    plant = str(uuid.uuid4())
    monkeypatch.setattr(stock_count, "ist_today", lambda: date(2026, 10, 10))
    with SessionLocal() as db:
        paper = _item(db, plant)
        rack = _rack(db, plant, "R5-ME-01")
        reel = _reel(db, plant, paper, 500, at=rack, inward=date(2026, 8, 5))
        db.commit()
        cid = _month_end_count(db, plant, rack, reel.reel_code, 499)
        # September closes while the August count waits for the Owner.
        lock_books_month(BooksLockPayload(month="2026-09"), db, plant, OWNER)
        detail = get_count(cid, db, plant, OWNER)
        assert detail["can"]["approve"] is False and "September 2026 is already closed" in detail["approve_refusal"]
        error = _refused(lambda: approve_count(NotePayload(), cid, db, plant, OWNER), 409, "September 2026 is already closed")
        assert error.detail["code"] == "LATER_MONTH_CLOSED"
        db.rollback()
        db.expire_all()
        assert db.get(PaperReel, reel.id).current_weight_kg == 500
        assert not db.query(StockAdjustmentVoucher).filter(StockAdjustmentVoucher.plant_id == plant).count()
        assert get_count(cid, db, plant, OWNER)["status"] == "SUBMITTED"


def test_a_back_dated_count_lot_is_in_since_the_voucher_day(monkeypatch):
    plant = str(uuid.uuid4())
    monkeypatch.setattr(stock_count, "ist_today", lambda: date(2026, 10, 10))
    with SessionLocal() as db:
        glue = _item(db, plant, "ADHESIVE", tracking="BULK")
        rack = _rack(db, plant, "R5-IN-01")
        _lot(db, plant, glue, 10, at=rack, day=date(2026, 8, 3))
        db.commit()
        count = start_count(CountCreate(kind="MONTH_END", month="2026-08"), db, plant, STORE)
        cid = uuid.UUID(count["id"])
        # Loose stock with no label: a new lot on QC hold, posted dated 31 Aug.
        add_loose_stock(LoosePayload(rack=str(rack.id), item_id=glue.id, counted_qty=4, client_ref="r5-loose"), cid, db, plant, STORE)
        finish_rack(cid, str(rack.id), db, plant, STORE)
        finish_rack(cid, "unassigned", db, plant, STORE)
        submit_count(NotePayload(), cid, db, plant, STORE)
        approve_count(NotePayload(), cid, db, plant, OWNER)
        entry = next(row for row in get_count(cid, db, plant, OWNER)["entries"] if row["created_lot_id"])
        lot = db.get(StockBatch, uuid.UUID(entry["created_lot_id"]))
        assert lot_row(lot, glue, 4)["in_since"] == "2026-08-31"


def test_unknown_ids_on_a_correction_voucher_are_refused_in_words():
    plant = str(uuid.uuid4())
    with SessionLocal() as db:
        glue = _item(db, plant, "ADHESIVE", tracking="BULK")
        other = _item(db, plant, "ADHESIVE", tracking="BULK")
        lot = _lot(db, plant, other, 10, at=_rack(db, plant, "R5-V-01"))
        db.commit()

        def voucher(**line):
            return AdjustmentVoucherPayload(effective_date=date(2026, 10, 30), reason_code="DAMAGED", lines=[AdjustmentLinePayload(**line)])

        _refused(lambda: create_adjustment_voucher(voucher(item_id=uuid.uuid4(), qty_delta=2), db, plant, STORE), 404, "material is not in this plant")
        _refused(lambda: create_adjustment_voucher(voucher(item_id=glue.id, qty_delta=-2, batch_id=uuid.uuid4()), db, plant, STORE), 404, "lot is not in this plant")
        _refused(lambda: create_adjustment_voucher(voucher(item_id=glue.id, qty_delta=-2, reel_id=uuid.uuid4()), db, plant, STORE), 404, "reel is not in this plant")
        _refused(lambda: create_adjustment_voucher(voucher(item_id=glue.id, qty_delta=-2, batch_id=lot.id), db, plant, STORE), 422, f"lot {lot.batch_no} is not")
        _refused(lambda: create_adjustment_voucher(voucher(item_id=glue.id, qty_delta=2, location_id=uuid.uuid4()), db, plant, STORE), 404, "location is not in this plant")
        assert not db.query(StockAdjustmentVoucher).filter(StockAdjustmentVoucher.plant_id == plant).count()


def test_a_waiting_correction_names_its_raiser_as_a_field():
    plant = str(uuid.uuid4())
    with SessionLocal() as db:
        glue = _item(db, plant, "ADHESIVE", tracking="BULK")
        lot = _lot(db, plant, glue, 10, at=_rack(db, plant, "R5-W-01"))
        db.commit()
        first = raise_correction(CorrectionPayload(code=lot.batch_no, new_qty=8, reason="COUNT_SHORT"), db, plant, GRN)
        error = _refused(lambda: raise_correction(CorrectionPayload(code=lot.batch_no, new_qty=7, reason="COUNT_SHORT"), db, plant, STORE), 409, "already has a correction waiting")
        assert error.detail["code"] == "CORRECTION_WAITING" and error.detail["raised_by"] == "grn.desk@example.com"
        assert error.detail["voucher_no"] == first["voucher_no"]


def test_a_correction_whose_reel_was_issued_since_posts_nothing_and_says_why():
    plant = str(uuid.uuid4())
    with SessionLocal() as db:
        paper = _item(db, plant)
        reel = _reel(db, plant, paper, 100, at=_rack(db, plant, "R5-I-01"))
        db.commit()
        draft = raise_correction(CorrectionPayload(code=reel.reel_code, new_qty=98, reason="COUNT_SHORT"), db, plant, STORE)
        # The reel goes to the floor before the Owner looks: the book is 0, nothing is left to correct.
        db.get(PaperReel, reel.id).current_weight_kg = 0
        db.commit()
        row = next(item for item in list_corrections("DRAFT", db, plant, OWNER)["items"] if item["id"] == draft["id"])
        assert row["lines"][0]["live_qty"] == 0 and row["lines"][0]["changed_since"] == 0 and row["lines"][0]["still_to_post"] == 0
        _refused(lambda: approve_correction(uuid.UUID(draft["id"]), CorrectionDecisionPayload(), db, plant, OWNER), 409, "it was issued or used since this was raised")


def test_a_rack_count_waiting_for_the_owner_is_not_its_last_count():
    plant = str(uuid.uuid4())
    with SessionLocal() as db:
        glue = _item(db, plant, "ADHESIVE", tracking="BULK")
        rack = _rack(db, plant, "R5-L-01")
        lot = _lot(db, plant, glue, 10, at=rack)
        db.commit()
        count = start_count(CountCreate(kind="SPOT", location_ids=[str(rack.id)]), db, plant, STORE)
        cid = uuid.UUID(count["id"])
        scan_in_count(ScanPayload(rack=str(rack.id), code=lot.batch_no, counted_qty=10, client_ref="r5-l"), cid, db, plant, STORE)
        finish_rack(cid, str(rack.id), db, plant, STORE)
        submit_count(NotePayload(), cid, db, plant, STORE)
        place = get_location(rack.id, db, plant, STORE)
        assert place["last_counted_at"] and place["last_count_approved"] is False
        approve_count(NotePayload(), cid, db, plant, OWNER)
        assert get_location(rack.id, db, plant, STORE)["last_count_approved"] is True
        # The RM store (receiving default) leads the list; a switched-off rack goes last.
        off = _rack(db, plant, "A5-OFF")
        off.active = "false"
        db.commit()
        codes = [row["code"] for row in locations_overview(True, db, plant, STORE)["items"]]
        assert codes[0] == default_receiving_location(db, plant).code and codes[-1] == "A5-OFF", codes
